"""The national rasters a bake reads, staged for a US area from US sources under
the Canadian names (stage.py), so rasters.py, ca_forest.py, habitat_lite.py and
the bush model run unchanged: each layer is a GeoTIFF in pipeline/raw/stage/
us-<id>/ on one 30 m grid in the MRDEM's CRS (EPSG:3979), listed in the stage's
index.json under the URL the Canadian step would read.

  landcover.tif     NLCD land cover, recoded to the NALCMS legend the 2020 Canadian land
                    cover uses (build_habitat.py LC_*: 18 water, 14 wetland, 8 shrub, 10 grass,
                    16 barren, 1/5/6 needleleaf/broadleaf/mixed forest, 15 crop, 17 urban)
  sp_<species>.tif  SCANFI's species crown closure (%), from LANDFIRE's existing vegetation
                    type (EVT) read as a share of each of SCANFI's ten species groups, times
                    the canopy cover
  nfiLandcover.tif  SCANFI's land cover class (2 open, 4 shrub, 5 hardwood, 6 conifer,
                    7 mixed, 8 water), from EVT's life form and the conifer share
  closure.tif       canopy cover %, LANDFIRE CC (else the EVC tree class)
  height.tif        canopy height m, LANDFIRE CH (else the EVH tree class)
  age.tif           stand age: unknown (-1) except where a disturbance dates it
  dist_type.tif     CanLaD's codes: 1 fire, 2 harvest (LANDFIRE FDist mechanical removal
                    or unknown mechanical), from the fuel disturbance layer
  dist_year.tif     the disturbance's year, from FDist's time-since class (0 none)

Inputs, downloaded beforehand into pipeline/raw/us3dep/<stage>/ (us_terrain.py
holds the DEMs): nlcd/nlcd_<year>_lc.tif (the MRLC WCS clip) and landfire/
<job>.tif (the LANDFIRE Product Service clip: EVT, EVH, EVC, CC, CH, FDist bands)
with the EVT attribute CSV (landfire.gov CSV/LF2023/LF23_EVT_240.csv).

    py -3.14 pipeline/us_stage.py --area luther
"""
from __future__ import annotations

import csv
import glob
import json
import sys
import time
from pathlib import Path

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.warp import calculate_default_transform, reproject, transform_bounds

sys.path.insert(0, str(Path(__file__).resolve().parent))
import area  # noqa: E402  (first: it takes --area out of argv)
import stage  # noqa: E402
from common import REGION, ROOT  # noqa: E402

BAKE = area.load(area.ID).get("bake") or {}
STAGE_NAME = (BAKE.get("us3dep") or {}).get("stage") or area.ID
RAW = ROOT / "pipeline" / "raw" / "us3dep" / STAGE_NAME
STAGE = ROOT / "pipeline" / "raw" / "stage" / f"us-{area.ID}"
CRS = "EPSG:3979"
CELL = 30.0
# the stage must hold every reader's box: ca_forest reads the region, the bush model the grid
# plus 0.02°, rasters.py the region plus 0.02°; a quarter degree each way holds them all
PAD_DEG = 0.25
ND = -9999
LF_YEAR = 2024

SPECIES = ["blackSpruce", "balsamFir", "jackPine", "whiteRedPine", "tamarack", "lodgepolePine", "douglasFir", "ponderosaPine", "otherConiferous", "broadleaf"]
CONIFER = SPECIES[:-1]

# NLCD class -> NALCMS (Canadian 2020 land cover) class
NLCD_TO_NALCMS = {
    11: 18,  # open water
    12: 19,  # perennial ice/snow
    21: 17, 22: 17, 23: 17, 24: 17,  # developed
    31: 16,  # barren
    41: 5,  # deciduous forest -> temperate broadleaf deciduous
    42: 1,  # evergreen forest -> temperate needleleaf
    43: 6,  # mixed forest
    52: 8,  # shrub/scrub -> temperate shrubland
    71: 10,  # grassland/herbaceous
    81: 10,  # pasture/hay: open grass for a deer (the Canadian legend's cropland has no habitat rule)
    82: 15,  # cultivated crops
    90: 14,  # woody wetlands
    95: 14,  # emergent herbaceous wetlands
}

# FDist: type (hundreds), severity (tens), time since (units); CanLaD: 1 fire, 2 harvest
FDIST_TYPE = {1: 1, 3: 2, 6: 2}  # fire; mechanical remove; mechanical unknown
FDIST_YEARS_AGO = {1: 0, 2: 3, 3: 8}  # one year; two to five; six to ten


def shares(name: str, phys: str, lf: str) -> dict[str, int] | None:
    """A LANDFIRE vegetation type's make-up in SCANFI's species groups (percent of the
    canopy). The Laurentian types around Michigan; a type not named falls to its physiognomy."""
    n = name
    if lf != "Tree":
        return None
    if "Plantation" in n:
        return {"whiteRedPine": 100}  # red pine plantations, by and large
    if "Pine-Black Spruce" in n:
        return {"jackPine": 60, "blackSpruce": 40}
    if "Jack Pine" in n or "Pine Barrens" in n:
        return {"jackPine": 70, "whiteRedPine": 30}
    if "Pine-(Oak)" in n or "Pine-Oak" in n:
        return {"whiteRedPine": 60, "broadleaf": 40}
    if "Pine-Hemlock-Hardwood" in n:
        return {"whiteRedPine": 30, "otherConiferous": 30, "broadleaf": 40}
    if "Pine-Hemlock" in n:
        return {"whiteRedPine": 50, "otherConiferous": 50}
    if "Northern Pine" in n:
        return {"whiteRedPine": 100}
    if "Balsam Fir" in n or "Spruce-Fir" in n or "Fir-Spruce" in n:
        return {"balsamFir": 50, "otherConiferous": 30, "blackSpruce": 20}
    if "Acidic Swamp" in n or "Poor Fen" in n or "Peatland" in n or "Bog" in n:
        return {"blackSpruce": 50, "tamarack": 30, "otherConiferous": 20}
    if "Conifer-Hardwood Swamp" in n:
        return {"otherConiferous": 40, "tamarack": 10, "broadleaf": 50}  # cedar, tamarack, black ash
    if "Evergreen" in n:
        return {"whiteRedPine": 60, "otherConiferous": 40}
    if "Mixed Forest" in n:
        return {"whiteRedPine": 30, "otherConiferous": 20, "broadleaf": 50}
    if phys == "Conifer":
        return {"whiteRedPine": 60, "otherConiferous": 40}
    if phys == "Conifer-Hardwood":
        return {"whiteRedPine": 25, "otherConiferous": 25, "broadleaf": 50}
    return {"broadleaf": 100}  # oak, northern hardwoods, aspen-birch, floodplain, ruderal, swamp hardwoods


def grid():
    """The stage grid: EPSG:3979 at 30 m over the region plus the pad."""
    box = (REGION["west"] - PAD_DEG, REGION["south"] - PAD_DEG, REGION["east"] + PAD_DEG, REGION["north"] + PAD_DEG)
    w, s, e, n = transform_bounds("EPSG:4326", CRS, *box, densify_pts=21)
    # on 30 m lines, so a later stage of the same ground lands on the same pixels
    w, s = np.floor(w / CELL) * CELL, np.floor(s / CELL) * CELL
    e, n = np.ceil(e / CELL) * CELL, np.ceil(n / CELL) * CELL
    tr = rasterio.Affine(CELL, 0, w, 0, -CELL, n)
    return box, tr, int(round((n - s) / CELL)), int(round((e - w) / CELL))


def onto(src_path: str, band: int, tr, h, w, categorical: bool, dtype=np.int32, nodata_out=ND) -> np.ndarray:
    with rasterio.open(src_path) as src:
        a = src.read(band)
        out = np.full((h, w), nodata_out, dtype=dtype)
        reproject(a, out, src_transform=src.transform, src_crs=src.crs, src_nodata=src.nodata, dst_transform=tr, dst_crs=CRS, dst_nodata=nodata_out,
                  resampling=Resampling.nearest if categorical else Resampling.bilinear)
    return out


def write(name: str, a: np.ndarray, tr, dtype: str, nodata) -> None:
    STAGE.mkdir(parents=True, exist_ok=True)
    tif = STAGE / f"{name}.tif"
    profile = {"driver": "GTiff", "width": a.shape[1], "height": a.shape[0], "count": 1, "dtype": dtype, "crs": CRS, "transform": tr, "nodata": nodata,
               "tiled": True, "blockxsize": 512, "blockysize": 512, "compress": "deflate", "zlevel": 6}
    with rasterio.open(tif, "w", **profile) as dst:
        dst.write(a.astype(dtype), 1)
    (STAGE / f"{name}.tif.done").write_text("", encoding="utf-8")


def main() -> int:
    t0 = time.time()
    box, tr, h, w = grid()
    print(f"{REGION['name']} ({area.ID}): the stage grid {w} x {h} at {CELL:g} m ({CRS}) over {[round(v, 3) for v in box]}")
    urls = stage.sources()
    ix_path = STAGE / "index.json"
    ix = json.loads(ix_path.read_text(encoding="utf-8")) if ix_path.exists() else {"box": list(box), "layers": {}}
    if [round(v, 6) for v in ix["box"]] != [round(v, 6) for v in list(box)]:
        # the index is one box for every layer: the terrain's stage is wider (build_dem reads the region's z10 tiles),
        # so the index keeps the widest box; these layers' readers ask the region plus 0.02°, well inside this grid
        ix["box"] = [min(ix["box"][0], box[0]), min(ix["box"][1], box[1]), max(ix["box"][2], box[2]), max(ix["box"][3], box[3])]
        print(f"  the index box stays the widest: {[round(v, 3) for v in ix['box']]}")

    # ---- land cover
    nlcd = sorted(glob.glob(str(RAW / "nlcd" / "nlcd_*_lc.tif")))
    if not nlcd:
        raise SystemExit(f"no NLCD clip in {RAW / 'nlcd'}")
    lc_in = onto(nlcd[-1], 1, tr, h, w, categorical=True, dtype=np.int32, nodata_out=0)
    lc = np.zeros((h, w), np.uint8)
    for k, v in NLCD_TO_NALCMS.items():
        lc[lc_in == k] = v
    write("landcover", lc, tr, "uint8", 0)
    ix["layers"]["landcover"] = {"url": urls["landcover"], "source": f"NLCD land cover ({Path(nlcd[-1]).name}), recoded to the NALCMS legend"}
    print(f"  landcover: {int((lc > 0).sum())} px classed of {h * w}")

    # ---- the stands from LANDFIRE
    lf = sorted(glob.glob(str(RAW / "landfire" / "*.tif")))
    if not lf:
        raise SystemExit(f"no LANDFIRE clip in {RAW / 'landfire'}")
    with rasterio.open(lf[-1]) as src:
        bands = {d.split("_")[1]: i + 1 for i, d in enumerate(src.descriptions)}
    need = ["EVT", "EVH", "EVC", "CC", "CH", "FDist"]
    if any(k not in bands for k in need):
        raise SystemExit(f"{Path(lf[-1]).name} has bands {list(bands)}; it needs {need}")
    L = {k: onto(lf[-1], bands[k], tr, h, w, categorical=True) for k in need}
    csvs = sorted(glob.glob(str(RAW / "landfire" / "*EVT*.csv")))
    if not csvs:
        raise SystemExit("no EVT attribute CSV beside the LANDFIRE clip (landfire.gov CSV/LF2023/LF23_EVT_240.csv)")
    rows = {int(r["VALUE"]): r for r in csv.DictReader(open(csvs[-1], encoding="utf-8-sig"))}
    evt = L["EVT"]
    codes = [int(v) for v in np.unique(evt) if v > 0]
    # per EVT code: the species shares, the life form
    share = {c: shares(rows[c]["EVT_NAME"], rows[c]["EVT_PHYS"], rows[c]["EVT_LF"]) if c in rows else None for c in codes}
    lifeform = {c: rows[c]["EVT_LF"] if c in rows else "" for c in codes}
    unknown = [c for c in codes if c not in rows]
    if unknown:
        print(f"  EVT codes not in the CSV, read as open ground: {unknown}")
    # closure and height: the forest layers first, the vegetation classes where they are 0
    cc = np.where(L["CC"] > 0, L["CC"], np.where((L["EVC"] >= 101) & (L["EVC"] <= 199), L["EVC"] - 100, 0)).astype(np.int16)
    ht = np.where(L["CH"] > 0, np.round(L["CH"] / 10.0), np.where((L["EVH"] >= 101) & (L["EVH"] <= 199), L["EVH"] - 100, 0)).astype(np.int16)
    sp = {k: np.zeros((h, w), np.int16) for k in SPECIES}
    conif_share = np.zeros((h, w), np.float32)
    lf_class = np.zeros((h, w), np.int16)
    for c in codes:
        m = evt == c
        sh = share[c]
        if sh:
            tot = sum(sh.values())
            cs = 0
            for k, v in sh.items():
                sp[k][m] = np.round(cc[m] * v / tot).astype(np.int16)
                if k in CONIFER:
                    cs += v
            conif_share[m] = 100 * cs / tot
            lf_class[m] = 1  # tree
        elif lifeform[c] == "Shrub":
            lf_class[m] = 2
        elif lifeform[c] == "Water":
            lf_class[m] = 3
    treed = lf_class == 1
    nfi = np.full((h, w), 2, np.int16)  # open
    nfi[lf_class == 2] = 4
    nfi[lf_class == 3] = 8
    nfi[treed & (conif_share >= 70)] = 6
    nfi[treed & (conif_share <= 30)] = 5
    nfi[treed & (conif_share > 30) & (conif_share < 70)] = 7
    nfi[lc == 18] = 8  # NLCD's water wins
    # a treed pixel with no closure at all is open ground to the classifier (no species share)
    ht[~treed] = 0
    cc[~treed] = 0
    # disturbance
    fd = L["FDist"]
    typ = np.where(fd > 0, fd // 100, 0)
    tsd = np.where(fd > 0, fd % 10, 0)
    dist_type = np.zeros((h, w), np.int16)
    dist_year = np.zeros((h, w), np.int16)
    for t, code in FDIST_TYPE.items():
        m = typ == t
        dist_type[m] = code
        for s, ago in FDIST_YEARS_AGO.items():
            dist_year[m & (tsd == s)] = LF_YEAR - ago
    age = np.full((h, w), -1, np.int16)
    dated = treed & (dist_year > 0)
    age[dated] = (LF_YEAR - dist_year[dated]).astype(np.int16)
    nd = evt <= 0
    for name, a in [("nfiLandcover", nfi), ("closure", cc), ("height", ht), ("age", age), ("dist_type", dist_type), ("dist_year", dist_year), *[(f"sp_{k}", sp[k]) for k in SPECIES]]:
        a = a.copy()
        a[nd] = ND
        write(name, a, tr, "int16", ND)
        ix["layers"][name] = {"url": urls[name], "source": f"LANDFIRE LF{LF_YEAR} EVT/EVH/EVC/CC/CH/FDist, read as SCANFI's {name}"}
    ix_path.write_text(json.dumps(ix, indent=1), encoding="utf-8")
    by = {g: int((nfi == v).sum()) for g, v in (("open", 2), ("shrub", 4), ("hardwood", 5), ("conifer", 6), ("mixed", 7), ("water", 8))}
    print(f"  stands: {by}; cut {int((dist_type == 2).sum())} px, burn {int((dist_type == 1).sum())} px; in {time.time() - t0:.0f} s -> {STAGE}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
