"""Forest stands for an area no province publishes them for, inferred from
the Canadian Forest Service's national 30 m maps -> forest-<id>.geojson, in
the normal form build_forest.py writes from Ontario's FRI: group, species,
year, ht, cc, sc, conif, hard, poly, dep, deptype, eco.

  SCANFI v2 (2025)  per 30 m pixel: the land cover, crown closure, height,
                    median stand age, and each species' share of the crown
                    closure (black spruce, balsam fir, jack pine, white and
                    red pine, tamarack, lodgepole pine, Douglas-fir,
                    ponderosa pine, other conifers, broadleaf). OGL-Canada.
  CanLaD v1.1       per 30 m pixel: the latest cut or burn, 1985-2025, and
                    its year. CC BY 4.0.

Both are national GeoTIFFs on NRCan's FTP server, tiled, so only the area's
window is read (/vsicurl range requests, about a minute), and cached under
pipeline/raw/ca/<id>/.

The pixels are classed (cover group, lead species, a cut's or burn's year),
patches under MMU_HA are merged into their neighbours, and each patch left
becomes a stand with its pixels' mean composition, height, closure and age.
These are a model's estimates, not a photo-interpreted inventory: conifer
against hardwood holds up, the lead species less so, and broadleaf is one
class (aspen, birch and maple alike). The habitat bake replaces the height
and closure with the LiDAR's wherever the area has a point cloud.

Tried and dropped (Sault test, 2026-10-04): telling hardwood from conifer by
the leaf-off (April 2024) against the leaf-on (October 2023) HRDEM surface
models. The bare branches still hold the surface up: 90% of the 10 m tree
cells kept more than 80% of their leaf-on height.

    py -3.14 pipeline/ca_forest.py --area sault-test
"""

from __future__ import annotations

import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
os.environ.setdefault("CPL_VSIL_CURL_ALLOWED_EXTENSIONS", ".tif")
os.environ.setdefault("GDAL_HTTP_MERGE_CONSECUTIVE_RANGES", "YES")

import numpy as np
import rasterio
import shapely
from pyproj import Transformer
from rasterio.features import rasterize, shapes, sieve
from rasterio.warp import transform_bounds
from rasterio.windows import from_bounds

sys.path.insert(0, str(Path(__file__).resolve().parent))
import area  # noqa: E402  (first: it takes --area out of argv)
import stage  # noqa: E402
from common import OUT_DIR, REGION  # noqa: E402

SCANFI = "https://ftp.maps.canada.ca/pub/nrcan_rncan/Forests_Foret/SCANFI/v2/SCANFI_{kind}_{layer}_{year}_v2_20260119.tif"
SCANFI_YEAR = 2025
CANLAD = (
    "https://ftp.maps.canada.ca/pub/nrcan_rncan/Forests_Foret/canlad_including_insect_defoliation/v1.1/"
    "Latest_filtered_CAN_20260508/canlad_1985_2025_latest_{layer}_v1_1_20260508.tif"
)
# SCANFI's species layers and the FRI-style code each stand's composition is
# written in, so build_habitat's lead codes and the map's names read them.
# White and red pine are one layer (Px, "pine"); broadleaf is one (Hx).
SPECIES = {
    "blackSpruce": "Sb",
    "balsamFir": "Bf",
    "jackPine": "Pj",
    "whiteRedPine": "Px",
    "tamarack": "La",
    "lodgepolePine": "Pl",
    "douglasFir": "Fd",
    "ponderosaPine": "Py",
    "otherConiferous": "Cx",
    "broadleaf": "Hx",
}
CONIFER = [k for k, code in SPECIES.items() if code != "Hx"]
# SCANFI's NFI land cover: 1 bryoid, 2 herbs, 3 rock, 4 shrub, 5 treed
# broadleaf, 6 treed conifer, 7 treed mixed, 8 water
LC_OPEN, LC_SHRUB, LC_TREED, LC_WATER = (1, 2, 3), 4, (5, 6, 7), 8
# CanLaD's disturbance types: 1 fire, 2 harvest, 5 defoliation then harvest
CANLAD_FIRE, CANLAD_HARVEST = (1,), (2, 5)

MMU_HA = 2.0  # the smallest stand kept; FRI stands run about 8 ha at the median
SMOOTH_M = 22  # the 30 m pixels' stair-steps, simplified across the shared edges into slopes
GROUPS = ["", "water", "other", "brush", "conifer", "mixed", "hardwood", "cut", "burn"]
POLY = {"water": "WAT", "other": "UCL", "brush": "BSH"}
CACHE = Path(__file__).resolve().parent / "raw" / "ca" / area.ID


def layers() -> dict[str, str]:
    out = {f"sp_{k}": SCANFI.format(kind="spsCC", layer=k, year=SCANFI_YEAR) for k in SPECIES}
    for k in ("nfiLandcover", "closure", "height"):
        out[k] = SCANFI.format(kind="att", layer=k, year=SCANFI_YEAR)
    out["age"] = SCANFI.format(kind="age", layer="median", year=SCANFI_YEAR)
    out["dist_type"] = CANLAD.format(layer="type")
    out["dist_year"] = CANLAD.format(layer="start_year")
    return out


def read_all() -> tuple[dict[str, np.ndarray], rasterio.Affine, str]:
    """Every layer's window over the region, on SCANFI's grid (CanLaD shares it)."""
    cache = CACHE / "scanfi-canlad.npz"
    if cache.exists():
        z = np.load(cache)
        print(f"cached {cache.name}")
        return {k: z[k] for k in z.files if k not in ("transform", "crs")}, rasterio.Affine(*z["transform"]), str(z["crs"])
    box = (REGION["west"], REGION["south"], REGION["east"], REGION["north"])

    def one(item):
        name, url = item
        for attempt in range(5):
            try:
                with rasterio.open(stage.source(url, box)) as ds:  # a local copy when one holds the box
                    b = transform_bounds("EPSG:4326", ds.crs, *box, densify_pts=21)
                    w = from_bounds(*b, ds.transform).round_offsets().round_lengths()
                    a = ds.read(1, window=w, boundless=True, fill_value=ds.nodata)
                    return name, a, ds.window_transform(w), ds.crs.to_wkt(), ds.nodata
            except rasterio.errors.RasterioIOError as e:
                print(f"  {name}: retry {attempt + 1} ({str(e)[:80]})")
                time.sleep(3 * (attempt + 1))
        raise SystemExit(f"could not read {url}")

    t = time.time()
    with ThreadPoolExecutor(8) as ex:
        got = list(ex.map(one, layers().items()))
    tr, crs = got[0][2], got[0][3]
    for name, a, t2, _, _ in got:
        if a.shape != got[0][1].shape or tuple(t2)[:6] != tuple(tr)[:6]:
            raise SystemExit(f"{name} is not on SCANFI's grid ({a.shape}, {t2})")
    arrays = {}
    for name, a, _, _, nodata in got:
        # one nodata convention: -1 for everything
        a = a.astype(np.int16)
        if nodata is not None:
            a[a == int(nodata)] = -1
        arrays[name] = a
    CACHE.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(cache, **arrays, transform=np.array(tr)[:6], crs=np.array(crs))
    print(f"read {len(got)} layers {got[0][1].shape} in {time.time() - t:.0f} s")
    return arrays, tr, crs


def classify(a: dict[str, np.ndarray]) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Per pixel: the stand key (group, then lead species or event year), and
    the species closures, the conifer share and the group."""
    lc = a["nfiLandcover"]
    sp = np.stack([np.clip(a[f"sp_{k}"], 0, 100) for k in SPECIES]).astype(np.float32)
    total = sp.sum(0)
    conif = np.where(total > 0, 100 * sp[[list(SPECIES).index(k) for k in CONIFER]].sum(0) / np.maximum(total, 1), -1)
    lead = sp.argmax(0)
    group = np.zeros(lc.shape, np.int16)
    group[lc == LC_WATER] = GROUPS.index("water")
    group[np.isin(lc, LC_OPEN)] = GROUPS.index("other")
    group[lc == LC_SHRUB] = GROUPS.index("brush")
    treed = np.isin(lc, LC_TREED)
    # the split the FRI's groups use (build_forest.py), else SCANFI's own class
    by_share = np.where(conif >= 70, GROUPS.index("conifer"), np.where(conif <= 30, GROUPS.index("hardwood"), GROUPS.index("mixed")))
    by_class = np.select([lc == 6, lc == 5], [GROUPS.index("conifer"), GROUPS.index("hardwood")], GROUPS.index("mixed"))
    group[treed] = np.where(total[treed] > 0, by_share[treed], by_class[treed])
    dtype, dyear = a["dist_type"], a["dist_year"]
    event = (dyear > 0) & (lc != LC_WATER)
    group[event & np.isin(dtype, CANLAD_HARVEST)] = GROUPS.index("cut")
    group[event & np.isin(dtype, CANLAD_FIRE)] = GROUPS.index("burn")
    key = group.astype(np.int32) * 10_000
    forest = np.isin(group, [GROUPS.index(g) for g in ("conifer", "mixed", "hardwood")])
    key[forest] += np.where(total[forest] > 0, lead[forest] + 1, 0)
    dist = np.isin(group, [GROUPS.index("cut"), GROUPS.index("burn")])
    key[dist] += dyear[dist] - 1900
    return key, sp, conif, group


def stands(a, tr, crs) -> list[dict]:
    key, sp, conif, group = classify(a)
    px_ha = abs(tr.a * tr.e) / 1e4
    key = sieve(key, size=int(round(MMU_HA / px_ha)), mask=key > 0, connectivity=8)
    polys = [(shapely.geometry.shape(g), int(v)) for g, v in shapes(key, mask=key > 0, transform=tr, connectivity=8)]
    print(f"  {len(polys)} stands of {MMU_HA:g} ha or more")
    ids = rasterize(((p, i + 1) for i, (p, _) in enumerate(polys)), out_shape=key.shape, transform=tr, dtype="int32")
    n = len(polys) + 1
    flat = ids.ravel()

    def mean(values: np.ndarray, valid: np.ndarray) -> np.ndarray:
        s = np.bincount(flat, weights=np.where(valid, values, 0).ravel().astype(np.float64), minlength=n)
        c = np.bincount(flat, weights=valid.ravel().astype(np.float64), minlength=n)
        return np.where(c > 0, s / np.maximum(c, 1), np.nan)

    comp = np.stack([mean(sp[i], sp[i] >= 0) for i in range(len(SPECIES))])
    ht = mean(a["height"].astype(np.float32), a["height"] >= 0)
    cc = mean(a["closure"].astype(np.float32), a["closure"] >= 0)
    age = mean(a["age"].astype(np.float32), a["age"] >= 0)
    codes = list(SPECIES.values())
    conif_i = [codes.index(SPECIES[k]) for k in CONIFER]

    # smooth the stair-steps across the shared edges, then to lon/lat. GEOS's
    # coverage simplify throws on some coverages (Highland Lake: "Points of
    # LinearRing do not form a closed linestring"); each stand on its own then,
    # which can leave slivers of up to SMOOTH_M between neighbours.
    raw = np.array([p for p, _ in polys], dtype=object)
    try:
        geoms = shapely.coverage_simplify(raw, SMOOTH_M)
    except shapely.errors.GEOSException as e:
        print(f"  coverage simplify failed ({e}): stand by stand")
        geoms = shapely.simplify(raw, SMOOTH_M, preserve_topology=True)
    to_ll = Transformer.from_crs(crs, "EPSG:4326", always_xy=True)
    box = shapely.box(REGION["west"], REGION["south"], REGION["east"], REGION["north"])
    out = []
    for i, ((_, k), g) in enumerate(zip(polys, geoms), start=1):
        name = GROUPS[k // 10_000]
        g = shapely.make_valid(shapely.transform(g, lambda xy: np.column_stack(to_ll.transform(xy[:, 0], xy[:, 1]))))
        g = shapely.intersection(g, box)
        if g.is_empty or g.geom_type not in ("Polygon", "MultiPolygon"):
            g = shapely.make_valid(g)
            g = shapely.MultiPolygon([p for p in shapely.get_parts(g) if p.geom_type == "Polygon"]) if not g.is_empty else g
            if g.is_empty:
                continue
        c = comp[:, i]
        tot = float(np.nansum(c))
        species, conif_pct, hard_pct = "", 0, 0
        if tot > 0:
            share = 100 * np.nan_to_num(c) / tot
            top = np.argsort(-share)[:3]
            species = " ".join(f"{codes[j]}{int(round(share[j] / 10) * 10)}" for j in top if round(share[j] / 10) > 0)
            conif_pct = int(round(sum(share[j] for j in conif_i)))
            hard_pct = 100 - conif_pct
        dep = (k % 10_000) + 1900 if name in ("cut", "burn") else None
        stand_age = None if np.isnan(age[i]) else int(round(age[i]))
        year = dep or (SCANFI_YEAR - stand_age if stand_age is not None and name in ("conifer", "mixed", "hardwood") else None)
        props = {
            "group": name,
            "species": species if name not in ("water", "other") else "",
            "year": year,
            "ht": None if np.isnan(ht[i]) or name in ("water", "other") else round(float(ht[i]), 1),
            "cc": None if np.isnan(cc[i]) or name in ("water", "other") else int(round(cc[i])),
            "sc": None,
            "conif": conif_pct if name not in ("water", "other") else 0,
            "hard": hard_pct if name not in ("water", "other") else 0,
            "poly": POLY.get(name, "FOR"),
            "dep": dep,
            "deptype": {"cut": "HARVEST", "burn": "FIRE"}.get(name),
            "eco": None,
        }
        out.append({"type": "Feature", "geometry": json.loads(shapely.to_geojson(shapely.set_precision(g, 0.000001))), "properties": props})
    return out


def main() -> int:
    t0 = time.time()
    a, tr, crs = read_all()
    feats = stands(a, tr, crs)
    path = OUT_DIR / f"forest-{area.ID}.geojson"
    fc = {"type": "FeatureCollection", "name": "Inferred stands: SCANFI v2 2025 and CanLaD 1985-2025 (NRCan)", "features": feats}
    path.write_text(json.dumps(fc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {path.name} ({path.stat().st_size / 1e6:.2f} MB, {len(feats)} stands)")
    source = "inferred from SCANFI v2 (species, closure, height, age, 30 m) and CanLaD v1.1 (cuts and burns), Canadian Forest Service"
    for f in (f"forest-{area.ID}.geojson", f"forest-{area.ID}.pmtiles"):
        area.note_source(f, source=source, licence="OGL-Canada; CanLaD CC BY 4.0", vintage=f"SCANFI {SCANFI_YEAR}; CanLaD 1985-2025")
    tally: dict[str, int] = {}
    for f in feats:
        tally[f["properties"]["group"]] = tally.get(f["properties"]["group"], 0) + 1
    print("  group: " + json.dumps(tally))
    here = shapely.Point(*area.HOME)
    at = next((f["properties"] for f in feats if shapely.geometry.shape(f["geometry"]).covers(here)), None)
    print(f"  the stand at the centre: {at}")
    print(f"done in {time.time() - t0:.0f} s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
