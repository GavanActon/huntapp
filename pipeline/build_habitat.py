"""The habitat grid: everything the Spots scorer needs about a place, on a
30 m lon/lat lattice over the region, in one small file the phone keeps.

Inputs (all already on disk after rasters.py, build_vectors.py and
build_forest.py):
  raw/mrdem-<region>.npz         NRCan MRDEM 30 m DTM (EPSG:3979)
  raw/landcover-<region>.npz     NRCan 2020 land cover 30 m (EPSG:3979)
  data/forest-<region>.geojson   FRI stands: species, age, height, closure
  data/waterbody-…, watercourse-…, wetland-…, roads-…, fire-…, ara-…

Output: app/public/data/habitat-<region>.hab — gzip of
  [u32 header length][JSON header][band 0][band 1]…
each band a row-major array over the grid (rows north→south). The header
lists every band with its dtype, scale and meaning, plus the lakes and
what the Aquatic Resource Area survey knows about them. The browser side
(app/src/spots/habitatGrid.ts) reads the header and never hard-codes
offsets.

Everything a rule in docs/HUNT-FISH-SCIENCE.md needs is precomputed here
as a static feature; the weather, the hour and the season are applied in
the browser. Estimated lake depth is a shape model (distance from shore,
calibrated to the survey's mean and maximum depth) because the camp lakes
have no digitised contours; it is labelled as an estimate everywhere.

    python pipeline/build_habitat.py
"""

from __future__ import annotations

import gzip
import json
import math
import struct
import time
from datetime import date
from pathlib import Path

import numpy as np
import rasterio
import shapely
from rasterio import features
from rasterio.transform import from_origin
from rasterio.warp import Resampling, reproject
from scipy import ndimage

from common import OUT_DIR, REGION
from rasters import fetch

D_LON = 0.0004  # ≈ 29 m at 48.9° N
D_LAT = 0.00027  # ≈ 30 m
YEAR = date.today().year

W, S, E, N = REGION["west"], REGION["south"], REGION["east"], REGION["north"]
COLS = int(round((E - W) / D_LON))
ROWS = int(round((N - S) / D_LAT))
TRANSFORM = from_origin(W, N, D_LON, D_LAT)
LAT_MID = (S + N) / 2
DX_M = D_LON * 111_320 * math.cos(math.radians(LAT_MID))
DY_M = D_LAT * 110_574

# cover classes (band `cover`)
NODATA, WATER, OPEN_WET, TREED_WET, CONIFER_DENSE, CONIFER_OPEN, MIXED, HARDWOOD, SHRUB, REGEN, BARREN, ROAD = range(12)
COVER_NAMES = ["nodata", "water", "open wetland", "treed wetland", "dense conifer", "open conifer", "mixedwood", "hardwood", "shrub / alder", "young regen", "rock / barren", "road"]
# landform classes (band `landform`)
LF_FLAT, LF_RIDGE, LF_VALLEY, LF_SADDLE, LF_BENCH, LF_PEAK, LF_SLOPE = range(7)
LANDFORM_NAMES = ["flat", "ridge", "valley", "saddle", "bench", "peak", "slope"]

# NRCan 2020 land cover codes we use
LC_WATER = 18
LC_WETLAND = 14
LC_SHRUB = (8, 11)
LC_BARREN = (13, 16)

CONIFER_LEAD = {"Sb", "Sw", "Bf", "Pj", "Pw", "Pr", "Cw", "La"}


def load_geo(theme: str) -> list[dict]:
    p = OUT_DIR / f"{theme}-{REGION['id']}.geojson"
    if not p.exists():
        print(f"  (no {p.name}, skipping)")
        return []
    return json.loads(p.read_text(encoding="utf-8"))["features"]


def geoms(feats: list[dict]) -> list[shapely.Geometry]:
    return [shapely.geometry.shape(f["geometry"]) for f in feats]


def burn(shapes, dtype=np.uint8, fill=0, all_touched=False) -> np.ndarray:
    shapes = [(g, v) for g, v in shapes if g is not None and not g.is_empty]
    if not shapes:
        return np.full((ROWS, COLS), fill, dtype=dtype)
    return features.rasterize(shapes, out_shape=(ROWS, COLS), transform=TRANSFORM, fill=fill, dtype=dtype, all_touched=all_touched)


def to_grid(src: dict, resampling: Resampling, dtype) -> np.ndarray:
    a, b, c, d, e, f = src["transform"].tolist()
    out = np.zeros((ROWS, COLS), dtype=dtype)
    nodata = float(src["nodata"]) if np.isfinite(float(src["nodata"])) else None
    reproject(
        source=src["data"],
        destination=out,
        src_transform=rasterio.Affine(a, b, c, d, e, f),
        src_crs=str(src["crs"]),
        src_nodata=nodata,
        dst_transform=TRANSFORM,
        dst_crs="EPSG:4326",
        dst_nodata=nodata if nodata is not None else 0,
        resampling=resampling,
    )
    return out


def edt_m(mask: np.ndarray) -> np.ndarray:
    """Distance in metres from every cell to the nearest True cell."""
    if not mask.any():
        return np.full(mask.shape, 1e6, dtype=np.float32)
    return ndimage.distance_transform_edt(~mask, sampling=(DY_M, DX_M)).astype(np.float32)


def q8(values: np.ndarray, step: float) -> np.ndarray:
    return np.clip(np.round(values / step), 0, 255).astype(np.uint8)


def fetch_cells(water: np.ndarray, lake_id: np.ndarray) -> dict[str, np.ndarray]:
    """For each compass direction the wind blows FROM, how many water cells
    lie upwind of every water cell before land: the fetch, in cells. The
    run stops at a lake boundary, so a channel into the next lake does not
    lend its neighbour a fetch it does not have."""
    w = water.astype(np.uint16)
    lid = np.where(water, lake_id.astype(np.int32), -1)
    out: dict[str, np.ndarray] = {}
    # (dr, dc) is the step toward where the wind comes from; row 0 is north
    steps = {"N": (-1, 0), "NE": (-1, 1), "E": (0, 1), "SE": (1, 1), "S": (1, 0), "SW": (1, -1), "W": (0, -1), "NW": (-1, -1)}

    def shifted(arr: np.ndarray, dr: int, dc: int, fill) -> np.ndarray:
        outp = np.full_like(arr, fill)
        rs = slice(max(0, -dr), arr.shape[0] - max(0, dr))
        rd = slice(max(0, dr), arr.shape[0] - max(0, -dr))
        cs = slice(max(0, -dc), arr.shape[1] - max(0, dc))
        cd = slice(max(0, dc), arr.shape[1] - max(0, -dc))
        outp[rd, cd] = arr[rs, cs]
        return outp

    for name, (dr, dc) in steps.items():
        same = lid == shifted(lid, -dr, -dc, -2)  # the upwind neighbour is the same lake
        f = np.zeros_like(w)
        if dr != 0:
            rows = range(ROWS) if dr < 0 else range(ROWS - 1, -1, -1)
            for r in rows:
                rr = r + dr
                prev = np.zeros(COLS, dtype=np.uint16)
                if 0 <= rr < ROWS:
                    src = f[rr]
                    if dc > 0:
                        prev[:-1] = src[1:]
                    elif dc < 0:
                        prev[1:] = src[:-1]
                    else:
                        prev = src
                f[r] = w[r] * (1 + prev * same[r])
        else:
            cols = range(COLS - 1, -1, -1) if dc > 0 else range(COLS)
            for c in cols:
                cc = c + dc
                prev = f[:, cc] if 0 <= cc < COLS else 0
                f[:, c] = w[:, c] * (1 + prev * same[:, c])
        out[name] = np.clip(f, 0, 255).astype(np.uint8)
    return out


def species_keys(summary: str | None) -> list[str]:
    if not summary:
        return []
    m = {
        "Walleye": "walleye",
        "Northern Pike": "pike",
        "Lake Trout": "laketrout",
        "Brook Trout": "brooktrout",
        "Lake Whitefish": "whitefish",
        "Yellow Perch": "perch",
        "Cisco": "cisco",
        "Herrings": "cisco",
        "Burbot": "burbot",
        "Smallmouth Bass": "bass",
    }
    out = []
    for s in summary.split(","):
        k = m.get(s.strip())
        if k and k not in out:
            out.append(k)
    return out


def main() -> None:
    t0 = time.time()
    print(f"grid {COLS}×{ROWS} cells of {DX_M:.0f}×{DY_M:.0f} m over {REGION['name']}")

    # ---- rasters ----
    dem = to_grid(fetch("mrdem"), Resampling.bilinear, np.float32)
    lc = to_grid(fetch("landcover"), Resampling.nearest, np.uint8)
    dem = np.where(dem < -1000, np.nan, dem)
    if np.isnan(dem).any():
        dem = np.where(np.isnan(dem), np.nanmedian(dem), dem)

    # ---- vectors ----
    wb = load_geo("waterbody")
    wc = load_geo("watercourse")
    wet = load_geo("wetland")
    roads = load_geo("roads")
    fire = load_geo("fire")
    forest = load_geo("forest")
    ara = load_geo("ara")

    wb_geoms = geoms(wb)
    lake_idx = [i for i, f in enumerate(wb) if f["properties"].get("WATERBODY_TYPE") in ("Lake", "Pond")]
    lake_id = burn([(wb_geoms[i], k + 1) for k, i in enumerate(lake_idx)], dtype=np.uint16)
    water = burn([(g, 1) for g in wb_geoms]).astype(bool)
    water |= lc == LC_WATER
    stream = burn([(g, 1) for g in geoms(wc)], all_touched=True).astype(bool)
    wetland = burn([(g, 1) for g in geoms(wet)]).astype(bool)
    road = burn([(g, 1) for g in geoms(roads)], all_touched=True).astype(bool)
    fire_year = burn([(g, int(f["properties"].get("FIRE_YEAR") or 0)) for g, f in zip(geoms(fire), fire)], dtype=np.uint16)

    fg = geoms(forest)
    fp = [f["properties"] for f in forest]
    poly_code = {"FOR": 1, "OMS": 2, "TMS": 3, "BSH": 4, "WAT": 5, "GRS": 6, "ISL": 7, "UCL": 8}
    f_poly = burn([(g, poly_code.get(p["poly"], 0)) for g, p in zip(fg, fp)])
    f_year = burn([(g, int(p["year"] or 0)) for g, p in zip(fg, fp)], dtype=np.uint16)
    f_ht = burn([(g, int(round(p["ht"] or 0))) for g, p in zip(fg, fp)])
    f_cc = burn([(g, int(p["cc"] or 0)) for g, p in zip(fg, fp)])
    f_conif = burn([(g, int(p["conif"] or 0)) for g, p in zip(fg, fp)])
    f_hard = burn([(g, int(p["hard"] or 0)) for g, p in zip(fg, fp)])
    f_dep = burn([(g, int(p["dep"] or 0)) for g, p in zip(fg, fp)], dtype=np.uint16)
    lead_code = {"Sb": 1, "Pj": 2, "Sw": 3, "Bf": 4, "Cw": 5, "La": 6, "Pt": 7, "Bw": 8, "Po": 7}
    f_lead = burn([(g, lead_code.get((p["species"] or "  ")[:2], 0)) for g, p in zip(fg, fp)])
    print(f"  vectors burnt · {time.time() - t0:.0f}s")

    # ---- disturbance age: burns, FRI depletions, and cuts the 2020 land cover shows on 2010 forest ----
    dist_age = np.full((ROWS, COLS), 255, dtype=np.uint8)
    fy = np.where(fire_year > 0, YEAR - fire_year.astype(int), 255)
    dy = np.where(f_dep > 0, YEAR - f_dep.astype(int), 255)
    inferred_cut = (f_poly == 1) & (f_year > 0) & (f_year < 2000) & (np.isin(lc, LC_SHRUB) | np.isin(lc, LC_BARREN)) & ~water & ~wetland
    ic = np.where(inferred_cut, YEAR - 2015, 255)
    dist_age = np.minimum(np.minimum(fy, dy), ic).clip(0, 255).astype(np.uint8)

    # ---- cover class ----
    cover = np.zeros((ROWS, COLS), dtype=np.uint8)
    is_for = f_poly == 1
    cover[is_for & (f_conif >= 70) & (f_cc < 60)] = CONIFER_OPEN
    cover[is_for & (f_conif >= 70) & (f_cc >= 60)] = CONIFER_DENSE
    cover[is_for & (f_conif < 70) & (f_conif > 30)] = MIXED
    cover[is_for & (f_conif <= 30) & (f_hard > 0)] = HARDWOOD
    cover[(f_poly == 0) & np.isin(lc, (1, 2))] = CONIFER_DENSE  # outside FRI: land cover only
    cover[(f_poly == 0) & (lc == 6)] = MIXED
    cover[(f_poly == 0) & (lc == 5)] = HARDWOOD
    cover[f_poly == 4] = SHRUB
    cover[(cover == 0) & np.isin(lc, LC_SHRUB)] = SHRUB
    cover[f_poly == 3] = TREED_WET
    cover[(f_poly == 2) | ((cover == 0) & (lc == LC_WETLAND))] = OPEN_WET
    cover[wetland & ~is_for] = OPEN_WET
    cover[np.isin(lc, LC_BARREN) & (cover == 0)] = BARREN
    cover[(dist_age <= 5)] = REGEN
    cover[inferred_cut] = REGEN
    cover[water] = WATER
    cover[road & ~water] = ROAD

    stand_age = np.where(f_year > 0, YEAR - f_year.astype(int), 0)
    stand_age = np.where(dist_age < 255, dist_age, stand_age).clip(0, 255).astype(np.uint8)

    # ---- terrain ----
    gy, gx = np.gradient(dem, DY_M, DX_M)
    slope = np.degrees(np.arctan(np.hypot(gx, gy)))
    aspect = (np.degrees(np.arctan2(gx, -gy)) + 360) % 360  # 0 = N, clockwise; gy is +south→ -gy is north
    aspect_q = np.where(slope < 1.5, 255, np.round(aspect / 360 * 250)).astype(np.uint8)
    smooth = ndimage.gaussian_filter(dem, 1.2)
    tpi300 = smooth - ndimage.uniform_filter(smooth, size=21)
    tpi100 = smooth - ndimage.uniform_filter(smooth, size=7)
    ring_slope = ndimage.uniform_filter(slope, size=11)
    landform = np.full((ROWS, COLS), LF_FLAT, dtype=np.uint8)
    landform[slope >= 6] = LF_SLOPE
    landform[(slope < 5) & (ring_slope > 8) & (np.abs(tpi300) < 3)] = LF_BENCH
    landform[tpi300 > 4] = LF_RIDGE
    landform[tpi300 < -4] = LF_VALLEY
    # saddle: a maximum along one axis and a minimum along the other, 3 cells out
    ex = np.pad(smooth, 3, mode="edge")
    cx = ex[3:-3, 3:-3]
    xmax = (cx > ex[3:-3, :-6] + 1.5) & (cx > ex[3:-3, 6:] + 1.5)
    xmin = (cx < ex[3:-3, :-6] - 1.5) & (cx < ex[3:-3, 6:] - 1.5)
    ymax = (cx > ex[:-6, 3:-3] + 1.5) & (cx > ex[6:, 3:-3] + 1.5)
    ymin = (cx < ex[:-6, 3:-3] - 1.5) & (cx < ex[6:, 3:-3] - 1.5)
    landform[(xmax & ymin) | (xmin & ymax)] = LF_SADDLE
    landform[(tpi300 > 8) & (smooth >= ndimage.maximum_filter(smooth, size=9) - 0.01)] = LF_PEAK
    landform[water] = LF_FLAT

    # ---- distances (m) ----
    lake_mask = lake_id > 0
    d_water = edt_m(water | stream)
    d_lake = edt_m(lake_mask)
    d_wetland = edt_m(wetland | (cover == OPEN_WET) | (cover == TREED_WET))
    d_road = edt_m(road)
    cover_mask = np.isin(cover, (CONIFER_DENSE, TREED_WET))
    d_cover = edt_m(cover_mask)
    browse_mask = np.isin(cover, (HARDWOOD, SHRUB, REGEN)) | ((cover == MIXED) & (f_hard >= 40)) | ((dist_age >= 5) & (dist_age <= 30) & ~water)
    d_browse = edt_m(browse_mask)
    if browse_mask.any():
        _, (ir, ic_) = ndimage.distance_transform_edt(~browse_mask, sampling=(DY_M, DX_M), return_indices=True)
        rr, cc = np.indices((ROWS, COLS))
        dxm = (ic_ - cc) * DX_M
        dym = (rr - ir) * DY_M  # +north
        bearing = (np.degrees(np.arctan2(dxm, dym)) + 360) % 360
        bear_q = np.where(browse_mask, 255, np.round(bearing / 360 * 250)).astype(np.uint8)
    else:
        bear_q = np.full((ROWS, COLS), 255, dtype=np.uint8)

    # inlets and outlets: stream ends within 60 m of a lake
    ends = []
    for g in geoms(wc):
        for part in getattr(g, "geoms", [g]):
            cs = list(part.coords)
            ends.append(shapely.Point(cs[0]))
            ends.append(shapely.Point(cs[-1]))
    end_mask = burn([(p, 1) for p in ends], all_touched=True).astype(bool)
    inlet_mask = end_mask & (d_lake <= 60)
    d_inlet = edt_m(inlet_mask)

    # ---- lake shape: shore distance, land fraction, estimated depth, fetch ----
    d_shore = edt_m(~water)  # for water cells: distance to land
    land_frac = ndimage.uniform_filter((~water).astype(np.float32), size=11)
    depth_est = np.full((ROWS, COLS), 255, dtype=np.uint8)
    lakes = []
    ara_by_name = {(f["properties"].get("OFFICIAL_WATERBODY_NAME") or "").lower(): f["properties"] for f in ara}
    ara_geoms = [(shapely.geometry.shape(f["geometry"]), f["properties"]) for f in ara]
    fetch_dirs = fetch_cells(water, lake_id)
    for k, i in enumerate(lake_idx):
        lid = k + 1
        cells = lake_id == lid
        n = int(cells.sum())
        if n < 4:
            continue
        name = wb[i]["properties"].get("OFFICIAL_NAME_LABEL")
        props = ara_by_name.get((name or "").lower())
        if props is None:
            rep = wb_geoms[i].representative_point()
            for g, p in ara_geoms:
                if g.contains(rep):
                    props = p
                    break
        area_ha = n * DX_M * DY_M / 1e4
        dmax_shore = float(d_shore[cells].max())
        fmax = max(int(fetch_dirs[d][cells].max()) for d in fetch_dirs)
        entry = {
            "id": lid,
            "name": name,
            "areaHa": round(area_ha, 1),
            "fetchMaxM": int(fmax * max(DX_M, DY_M)),
            "maxDepth": None,
            "meanDepth": None,
            "secchi": None,
            "species": [],
            "depthModel": None,
        }
        if props:
            rnd = lambda v: round(float(v), 1) if v is not None else None  # noqa: E731  (ArcGIS float32 noise)
            entry["maxDepth"] = rnd(props.get("MAXIMUM_DEPTH"))
            entry["meanDepth"] = rnd(props.get("MEAN_DEPTH"))
            entry["secchi"] = rnd(props.get("SECCHI_DEPTH"))
            entry["species"] = species_keys(props.get("FISH_SPECIES_SUMMARY"))
        dmax = entry["maxDepth"]
        if dmax and dmax_shore > 0:
            frac = d_shore[cells] / dmax_shore
            dmean = entry["meanDepth"]
            kexp = 1.0
            if dmean and 0 < dmean < dmax:
                lo, hi = 0.2, 6.0
                for _ in range(40):
                    kexp = (lo + hi) / 2
                    m = float((dmax * frac**kexp).mean())
                    if m > dmean:
                        lo = kexp
                    else:
                        hi = kexp
            depth = dmax * frac**kexp
            depth_est[cells] = np.clip(np.round(depth * 4), 0, 254).astype(np.uint8)
            entry["depthModel"] = {"k": round(kexp, 2), "shoreMaxM": round(dmax_shore)}
        lakes.append(entry)
    print(f"  {len(lakes)} lakes, {sum(1 for l in lakes if l['depthModel'])} with a depth model · {time.time() - t0:.0f}s")

    # ---- assemble ----
    bands: list[tuple[str, np.ndarray, float, str]] = [
        ("elev", np.clip(np.round(dem), 0, 65535).astype(np.uint16), 1, "elevation m"),
        ("slope", q8(slope, 1), 1, "slope degrees"),
        ("aspect", aspect_q, 360 / 250, "aspect degrees (0..250 → 0..360; 255 flat)"),
        ("tpi", np.clip(np.round(tpi300) + 128, 0, 255).astype(np.uint8), 1, "topographic position 300 m, m (value-128)"),
        ("tpi100", np.clip(np.round(tpi100 * 2) + 128, 0, 255).astype(np.uint8), 0.5, "topographic position 100 m, m ((value-128)/2)"),
        ("landform", landform, 1, "landform class, see landformNames"),
        ("cover", cover, 1, "cover class, see coverNames"),
        ("age", stand_age, 1, "stand age years (FRI origin, or years since disturbance)"),
        ("height", f_ht, 1, "stand height m (FRI)"),
        ("crown", f_cc, 1, "crown closure % (FRI)"),
        ("conifer", f_conif, 1, "conifer % of composition (FRI)"),
        ("hardwood", f_hard, 1, "hardwood % of composition (FRI)"),
        ("lead", f_lead, 1, "leading species: 1 Sb 2 Pj 3 Sw 4 Bf 5 Cw 6 La 7 Pt 8 Bw"),
        ("disturbAge", dist_age, 1, "years since fire / cut (255 none)"),
        ("distWater", q8(d_water, 10), 10, "m to lake, pond, river or stream (×10)"),
        ("distLake", q8(d_lake, 10), 10, "m to a lake or pond (×10)"),
        ("distWetland", q8(d_wetland, 10), 10, "m to wetland (×10)"),
        ("distCover", q8(d_cover, 10), 10, "m to dense conifer / treed wetland cover (×10)"),
        ("distBrowse", q8(d_browse, 10), 10, "m to browse habitat (×10)"),
        ("bearBrowse", bear_q, 360 / 250, "compass bearing to nearest browse (255 = in browse)"),
        ("distRoad", q8(d_road, 20), 20, "m to a bush road (×20)"),
        ("distInlet", q8(d_inlet, 10), 10, "m to a stream inlet or outlet on a lake (×10)"),
        ("lakeId", lake_id, 1, "lake index into lakes[] (0 land)"),
        ("distShore", q8(d_shore, 10), 10, "water cells: m to land (×10)"),
        ("landFrac", np.round(land_frac * 255).astype(np.uint8), 1 / 255, "fraction of land within ~160 m"),
        ("depthEst", depth_est, 0.25, "estimated depth m (×0.25; 255 unknown)"),
    ]
    for d, arr in fetch_dirs.items():
        bands.append((f"fetch{d}", arr, 1, f"water cells: fetch in cells with wind from {d}"))

    header = {
        "region": REGION["id"],
        "generated": date.today().isoformat(),
        "cols": COLS,
        "rows": ROWS,
        "west": W,
        "north": N,
        "dLon": D_LON,
        "dLat": D_LAT,
        "cellM": [round(DX_M, 1), round(DY_M, 1)],
        "coverNames": COVER_NAMES,
        "landformNames": LANDFORM_NAMES,
        "lakes": lakes,
        "bands": [],
    }
    payload = bytearray()
    for name, arr, scale, meaning in bands:
        arr = np.ascontiguousarray(arr)
        header["bands"].append({"name": name, "dtype": str(arr.dtype), "scale": scale, "offset": len(payload), "meaning": meaning})
        payload += arr.tobytes()
    hj = json.dumps(header, separators=(",", ":")).encode("utf-8")
    raw = struct.pack("<I", len(hj)) + hj + bytes(payload)
    out = OUT_DIR / f"habitat-{REGION['id']}.hab"
    out.write_bytes(gzip.compress(raw, 9))
    print(f"wrote {out.name}: {len(raw) / 1e6:.1f} MB raw, {out.stat().st_size / 1e6:.2f} MB gzipped, {len(bands)} bands · {time.time() - t0:.0f}s")
    # a human-readable summary next to it
    summary = {
        "cover": {COVER_NAMES[i]: int((cover == i).sum()) for i in range(len(COVER_NAMES))},
        "landform": {LANDFORM_NAMES[i]: int((landform == i).sum()) for i in range(len(LANDFORM_NAMES))},
        "disturbed": int((dist_age < 255).sum()),
        "inferredCuts": int(inferred_cut.sum()),
        "lakes": lakes,
    }
    (Path(__file__).resolve().parent / "bake-habitat-summary.json").write_text(json.dumps(summary, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
