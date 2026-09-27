"""Vegetation structure from the SPL point cloud: canopy height, canopy cover
and understory density ("bush thickness") on a 10 m grid, plus a coloured
understory raster for the map.

Input:  pipeline/raw/pointcloud/laz/*.copc.laz and dem/*_DEM.tif, fetched by
        fetch_pointcloud.py (Ontario FRI leaf-on single-photon LiDAR,
        project White Lake 2021, flown late Sept 2021, ~35 pts/m² and 2-4x
        that where flight lines overlap). Whatever tiles are on disk are
        used; cells of tiles not fetched are nodata.
        app/public/data/waterbody-<region>.geojson (LIO OHN) for the water mask.
        app/public/data/forest-<region>.geojson (FRI 2010) for the sanity check.

Returns. The provider classifies by height above ground: 2 ground, 3 low
veg (0-0.3 m), 4 medium (0.3-2 m), 5 high (>2 m), 7/18 noise, and 12, which
Ontario lists among its vegetation classes but which here sits within 0.2 m
of the DEM (ground-level returns, dense where flight lines overlap). Noise
(7, 18) is dropped; everything else, 12 included, is binned by its own
height, so the classes only matter for the noise. Dropping 12 would thin
the ground layer alone and push the understory ratio up. Heights are
z minus the provider's 0.5 m DEM of the same tile (bilinear); returns below
-1 m or above 45 m are dropped as residual noise, -1..0 m counts as 0.
SPL (Leica SPL100) splits each pulse into 100 beamlets, each counting
single photons; 95 % of returns here are "single returns" and return numbers
do not mean what they do for linear-mode lidar, so every metric uses ALL
returns, each one an independent sample of where the beam was intercepted.

Metrics per 10 m cell (a 100-cell block per 1 km tile, aligned to the tiles):
  density        returns per m² of land (cells under MIN_DENSITY are nodata)
  canopy_height  95th percentile height of returns above 2 m (m); 0 when
                 fewer than 10 returns are above 2 m (White et al. 2013's
                 2 m threshold; p95 is the usual robust top height)
  canopy_cover   share of returns above 2 m (0-1); with SPL, all returns
                 in place of first returns
  understory     returns 0.5-3 m / returns 0-3 m (0-1): of what reached
                 the top of the shrub layer, the share intercepted in it.
                 Normalising by the returns that reached the layer, not by
                 all returns, is the occlusion correction: this is the
                 normalised relative density (NRD) of Campbell et al. 2018,
                 the understory lidar cover density of Wing et al. 2012.
  understory_pad Beer-Lambert version of the same ratio, plant area density
                 in the layer (m²/m³): ln(N<3 / N<0.5) / (G dz) with G 0.5
                 (spherical leaf angles) and dz 2.5 m, the MacArthur-Horn
                 (1969) gap-fraction inversion. Linear in "how much stuff
                 per cubic metre" where the ratio saturates.
  n_reach        returns 0-3 m (how many samples the understory rests on;
                 understory is nodata below MIN_REACH)
  strata         return counts in height bands STRATA_EDGES, so other
                 thresholds (browse height 0.5-2 m, say) need no rerun
  water_frac     share of the cell that is DEM-flattened water (returns
                 there are dropped; cells under MIN_LAND land are nodata)
  water          water_frac >= 0.5 where there is lidar, else the cell
                 centre is in an LIO OHN waterbody

Output: pipeline/raw/vegstructure-<region>.npz  (grids, transform, crs, nodata)
        app/public/data/understory-<region>.pmtiles  (z14-16, the core only)
        pipeline/bake-vegstructure-summary.json  (FRI stand-class check)

    python pipeline/build_vegstructure.py            # metrics + tiles + check (~20 s a tile)
    python pipeline/build_vegstructure.py --tiles    # re-render tiles from the npz
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import laspy
import numpy as np
import rasterio
from rasterio.features import rasterize
from rasterio.transform import from_bounds, from_origin
from rasterio.warp import Resampling, reproject, transform_geom
from scipy.ndimage import label, maximum_filter, minimum_filter

from common import CACHE_DIR, CORE, OUT_DIR, REGION, REGION_MAXZOOM, lat_to_tile, lon_to_tile, tile_bounds_3857, write_raster_pmtiles

PC_DIR = CACHE_DIR / "pointcloud"
INDEX = PC_DIR / f"tiles-{REGION['id']}.json"
NPZ = CACHE_DIR / f"vegstructure-{REGION['id']}.npz"
SUMMARY = Path(__file__).resolve().parent / "bake-vegstructure-summary.json"

CELL = 10.0  # m
TILE = 1000.0  # m, the provider's tiles
NOISE = (7, 18)
H_MIN, H_MAX = -1.0, 45.0
BIN = 0.1  # m, height histogram resolution
NBIN = int(H_MAX / BIN)
CANOPY_H = 2.0
UNDER_LO, UNDER_HI = 0.5, 3.0
G_PROJ = 0.5  # leaf projection, spherical
MIN_CANOPY_RETURNS = 10
MIN_REACH = 50  # returns reaching 3 m for an understory value (0.5 per m²)
MIN_DENSITY = 5.0  # returns per m² of land for any value at all
MIN_LAND = 0.25  # share of a cell that must be land (not DEM-flattened water)
WATER_MIN_M2 = 100.0  # zero-relief DEM patches this big are water
CHUNK_POINTS = 8_000_000
STRATA_EDGES = np.array([0.0, 0.5, 1.0, 2.0, 3.0, 5.0, 10.0, 15.0, 20.0, 25.0, H_MAX], dtype=np.float32)
NODATA = -1.0
CRS = "EPSG:3160"  # NAD83(CSRS) / UTM 16N, the tiles' own CRS


def grid_frame() -> tuple[float, float, int, int]:
    """The 10 m grid: the union of the core's 1 km tiles (x0, ytop, W, H)."""
    rows = json.loads(INDEX.read_text())
    x0 = min(r["x0"] for r in rows)
    x1 = max(r["x0"] for r in rows) + TILE
    y0 = min(r["y0"] for r in rows)
    y1 = max(r["y0"] for r in rows) + TILE
    return x0, y1, int((x1 - x0) / CELL), int((y1 - y0) / CELL)


def read_dem(dem_path: Path):
    """The tile DEM (NaN for nodata) and its hydro-flattened water: the DEM
    sets lakes and rivers to one exact elevation, so any patch of 100 m² or
    more with zero relief is water. Water returns sit 0.5-1 m above that
    flattened level and would read as shrubs, so they are dropped."""
    with rasterio.open(dem_path) as s:
        dem = s.read(1).astype(np.float32)
        tr = s.transform
        nod = s.nodata
    if nod is not None:
        dem[dem == nod] = np.nan
    flat = (maximum_filter(dem, 3) - minimum_filter(dem, 3)) == 0
    lab, _ = label(flat)
    sizes = np.bincount(lab.ravel())
    sizes[0] = 0
    min_px = int(WATER_MIN_M2 / abs(tr.a * tr.e))
    water = (sizes >= min_px)[lab]
    return dem, water, tr


def dem_heights(x: np.ndarray, y: np.ndarray, z: np.ndarray, dem: np.ndarray, water: np.ndarray, tr) -> tuple[np.ndarray, np.ndarray]:
    """z minus the tile DEM (bilinear), and whether each point is over water."""
    fc = (x - tr.c) / tr.a - 0.5
    fr = (y - tr.f) / tr.e - 0.5
    c0 = np.clip(np.floor(fc).astype(np.int32), 0, dem.shape[1] - 2)
    r0 = np.clip(np.floor(fr).astype(np.int32), 0, dem.shape[0] - 2)
    wc = np.clip(fc - c0, 0, 1).astype(np.float32)
    wr = np.clip(fr - r0, 0, 1).astype(np.float32)
    g = (
        dem[r0, c0] * (1 - wc) * (1 - wr)
        + dem[r0, c0 + 1] * wc * (1 - wr)
        + dem[r0 + 1, c0] * (1 - wc) * wr
        + dem[r0 + 1, c0 + 1] * wc * wr
    )
    on_water = water[np.clip(np.round(fr).astype(np.int32), 0, dem.shape[0] - 1), np.clip(np.round(fc).astype(np.int32), 0, dem.shape[1] - 1)]
    return (z - g).astype(np.float32), on_water


def tile_metrics(laz: Path, dem_path: Path, tx0: float, ty0: float) -> dict:
    """One 1 km tile → 100×100 cells of height histograms, reduced to metrics.
    Read in chunks so memory stays flat whatever the tile's point count."""
    dem, water, tr = read_dem(dem_path)
    n = int(TILE / CELL)
    hist = np.zeros(n * n * NBIN, np.int64)
    raw = noise = dropped = wet = 0
    with laspy.open(laz) as f:
        for pts in f.chunk_iterator(CHUNK_POINTS):
            cls = np.asarray(pts.classification)
            keep = ~np.isin(cls, NOISE)
            raw += cls.size
            noise += int((~keep).sum())
            x = np.asarray(pts.x)[keep]
            y = np.asarray(pts.y)[keep]
            z = np.asarray(pts.z)[keep]
            h, on_water = dem_heights(x, y, z, dem, water, tr)
            ok = np.isfinite(h) & (h >= H_MIN) & (h < H_MAX)
            dropped += int((~ok & ~on_water).sum())
            wet += int(on_water.sum())
            ok &= ~on_water
            ci = np.clip(((x - tx0) // CELL).astype(np.int64), 0, n - 1)
            ri = np.clip(((ty0 + TILE - y) // CELL).astype(np.int64), 0, n - 1)
            hb = np.clip((np.maximum(h[ok], 0) / BIN).astype(np.int64), 0, NBIN - 1)
            hist += np.bincount((ri * n + ci)[ok] * NBIN + hb, minlength=n * n * NBIN)
    # water share of each 10 m cell, from the DEM's 0.5 m pixels
    k = int(round(CELL / abs(tr.a)))
    water_frac = water[: n * k, : n * k].reshape(n, k, n, k).mean(axis=(1, 3))
    out = reduce_hist(hist.reshape(n * n, NBIN), n, land_m2=(1 - water_frac) * CELL * CELL)
    return out | {"water_frac": water_frac, "raw_points": raw, "noise": noise, "dropped": dropped, "water_points": wet}


def reduce_hist(hist: np.ndarray, n: int, land_m2: np.ndarray) -> dict:
    """Per-cell histograms of height (BIN m) → the metric grids. Density is
    per m² of land, so a shoreline cell is not penalised for its water."""
    b = lambda m: int(round(m / BIN))  # noqa: E731
    n_all = hist.sum(1).astype(np.float64)
    n_low = hist[:, : b(UNDER_LO)].sum(1).astype(np.float64)
    n_reach = hist[:, : b(UNDER_HI)].sum(1).astype(np.float64)
    n_layer = n_reach - n_low
    above = hist[:, b(CANOPY_H) :]
    n_above = above.sum(1).astype(np.float64)
    # p95 of returns above 2 m, interpolated inside the 0.1 m bin
    cum = np.cumsum(above, axis=1)
    target = 0.95 * n_above
    k = np.argmax(cum >= target[:, None], axis=1)
    prev = np.where(k > 0, cum[np.arange(len(k)), k - 1], 0)
    inbin = above[np.arange(len(k)), k]
    frac = np.where(inbin > 0, (target - prev) / np.maximum(inbin, 1), 0)
    p95 = CANOPY_H + (k + frac) * BIN
    with np.errstate(divide="ignore", invalid="ignore"):
        density = np.where(land_m2.ravel() > 0, n_all / np.maximum(land_m2.ravel(), 1e-9), 0.0)
        cover = np.where(n_all > 0, n_above / n_all, np.nan)
        height = np.where(n_above >= MIN_CANOPY_RETURNS, p95, 0.0)
        under = np.where(n_reach > 0, n_layer / n_reach, np.nan)
        # an empty ground layer caps the gap fraction at half a return
        pad = np.where(n_reach > 0, np.log(n_reach / np.maximum(n_low, 0.5)) / (G_PROJ * (UNDER_HI - UNDER_LO)), np.nan)
    edges = np.round(STRATA_EDGES / BIN).astype(int)
    strata = np.stack([hist[:, edges[i] : edges[i + 1]].sum(1) for i in range(len(edges) - 1)])
    sh = (n, n)
    return {
        "density": density.reshape(sh),
        "canopy_height": height.reshape(sh),
        "canopy_cover": cover.reshape(sh),
        "understory": under.reshape(sh),
        "understory_pad": pad.reshape(sh),
        "n_reach": n_reach.reshape(sh),
        "strata": strata.reshape(len(edges) - 1, *sh),
    }


def water_mask(transform, W: int, H: int) -> np.ndarray:
    src = OUT_DIR / f"waterbody-{REGION['id']}.geojson"
    fc = json.loads(src.read_text(encoding="utf-8"))
    shapes = [(transform_geom("EPSG:4326", CRS, f["geometry"]), 1) for f in fc["features"] if f.get("geometry")]
    return rasterize(shapes, out_shape=(H, W), transform=transform, fill=0, dtype="uint8").astype(bool)


def build() -> dict:
    rows = json.loads(INDEX.read_text())
    x0, ytop, W, H = grid_frame()
    transform = from_origin(x0, ytop, CELL, CELL)
    grids = {k: np.full((H, W), NODATA, np.float32) for k in ("density", "canopy_height", "canopy_cover", "understory", "understory_pad", "water_frac")}
    n_reach = np.zeros((H, W), np.uint16)
    strata = np.zeros((len(STRATA_EDGES) - 1, H, W), np.uint16)
    n = int(TILE / CELL)
    t0 = time.time()
    done = []
    stats = {"raw_points": 0, "noise": 0, "dropped": 0, "water_points": 0}
    for r in rows:
        laz = PC_DIR / "laz" / f"{r['Tilename']}.copc.laz"
        dem = PC_DIR / "dem" / f"{r['Tilename']}_DEM.tif"
        if not (laz.exists() and dem.exists()):
            continue
        m = tile_metrics(laz, dem, r["x0"], r["y0"])
        for k in stats:
            stats[k] += m[k]
        c0 = int((r["x0"] - x0) / CELL)
        r0 = int((ytop - (r["y0"] + TILE)) / CELL)
        win = (slice(r0, r0 + n), slice(c0, c0 + n))
        ok = (m["density"] >= MIN_DENSITY) & (m["water_frac"] <= 1 - MIN_LAND)
        for k in grids:
            if k == "water_frac":
                grids[k][win] = m["water_frac"].astype(np.float32)
                continue
            v = np.where(ok & np.isfinite(m[k]), m[k], NODATA)
            if k in ("understory", "understory_pad"):
                v = np.where(m["n_reach"] >= MIN_REACH, v, NODATA)
            grids[k][win] = v.astype(np.float32)
        n_reach[win] = np.minimum(m["n_reach"], 65535).astype(np.uint16)
        strata[:, win[0], win[1]] = np.minimum(m["strata"], 65535).astype(np.uint16)
        done.append(r["Tilename"])
        print(f"  {len(done):3d} {r['Tilename']}  {m['raw_points'] / 1e6:5.1f} M pts · {time.time() - t0:5.0f} s", flush=True)
    if not done:
        raise SystemExit("no tiles on disk: run fetch_pointcloud.py first")
    # water: the DEM's flattened water where there is lidar, OHN polygons elsewhere
    have = grids["water_frac"] >= 0
    water = np.where(have, grids["water_frac"] >= 0.5, water_mask(transform, W, H))
    np.savez_compressed(
        NPZ,
        **grids,
        n_reach=n_reach,
        strata=strata,
        strata_edges=STRATA_EDGES,
        water=water,
        transform=np.array(transform)[:6],
        crs=CRS,
        nodata=NODATA,
        cell_m=CELL,
        tiles=np.array(done),
        source="Ontario MNR FRI leaf-on SPL LiDAR, White Lake 2021 (flown late Sept 2021)",
    )
    print(f"wrote {NPZ.name} ({NPZ.stat().st_size / 1e6:.1f} MB, {len(done)} tiles, {W}x{H} cells) in {time.time() - t0:.0f} s")
    print(f"  {stats['raw_points'] / 1e9:.2f} G points: {stats['noise']} noise, {stats['water_points']} on water, {stats['dropped']} out of height range")
    return stats


def load() -> dict:
    z = np.load(NPZ, allow_pickle=True)
    return {k: z[k] for k in z.files}


# ---- display raster -----------------------------------------------------

# Understory ratio classes and colours (ColorBrewer YlOrRd; open ground
# faint). Upper bounds; the last is open-ended. Breaks sit near the land
# quantiles (5/25/50/75/90 % = 0.12/0.29/0.44/0.63/0.78) and the FRI
# classes: open muskeg ~0.12, mature conifer ~0.38, hardwood-leading ~0.59,
# alder brush and young stands ~0.7.
RAMP = [
    (0.15, (255, 255, 178, 60)),  # open: little between knee and head height
    (0.30, (254, 217, 118, 110)),  # light
    (0.45, (254, 178, 76, 145)),  # moderate
    (0.60, (253, 141, 60, 170)),  # thick
    (0.75, (240, 59, 32, 190)),  # very thick
    (9.99, (189, 0, 38, 205)),  # thicket: three quarters stopped by 3 m
]


def colourise(v: np.ndarray) -> np.ndarray:
    out = np.zeros((*v.shape, 4), np.uint8)
    lo = -np.inf
    valid = np.isfinite(v)
    for hi, rgba in RAMP:
        m = valid & (v >= lo) & (v < hi)
        out[m] = rgba
        lo = hi
    return out


def render_tiles(d: dict) -> None:
    under = np.where((d["understory"] >= 0) & ~d["water"], d["understory"], np.nan).astype(np.float32)
    transform = rasterio.Affine(*d["transform"])
    crs = str(d["crs"])

    def in_core(z, x, y):
        return (
            lon_to_tile(CORE["west"], z) <= x <= lon_to_tile(CORE["east"] - 1e-9, z)
            and lat_to_tile(CORE["north"], z) <= y <= lat_to_tile(CORE["south"] + 1e-9, z)
        )

    def render(z, x, y):
        if not in_core(z, x, y):
            return None
        b = tile_bounds_3857(z, x, y)
        dst = np.full((256, 256), np.nan, np.float32)
        reproject(
            source=under,
            destination=dst,
            src_transform=transform,
            src_crs=crs,
            src_nodata=np.nan,
            dst_transform=from_bounds(*b, 256, 256),
            dst_crs="EPSG:3857",
            dst_nodata=np.nan,
            resampling=Resampling.bilinear,
        )
        if not np.isfinite(dst).any():
            return None
        return colourise(dst)

    write_raster_pmtiles(
        OUT_DIR / f"understory-{REGION['id']}.pmtiles",
        f"understory-{REGION['id']}",
        "Understory from Ontario FRI SPL LiDAR 2021 · contains information licensed under the Open Government Licence – Ontario",
        REGION_MAXZOOM + 1,
        CORE["maxzoom"],
        render,
    )


# ---- sanity check against the FRI -------------------------------------------


def fri_classes(p: dict) -> str | None:
    poly, yr, cc, conif, hard = p.get("poly"), p.get("year") or 0, p.get("cc") or 0, p.get("conif") or 0, p.get("hard") or 0
    if poly == "WAT":
        return "water (FRI WAT)"
    if poly == "OMS":
        return "open muskeg (OMS)"
    if poly == "TMS":
        return "treed muskeg (TMS)"
    if poly == "BSH":
        return "brush / alder (BSH)"
    if poly != "FOR":
        return None
    if p.get("group") in ("cut", "burn") or yr >= 1985:
        return "young forest, origin 1985+ or cut/burn"
    if conif >= 70 and 0 < yr <= 1945 and cc >= 70:
        return "mature closed conifer (origin <=1945, cc>=70)"
    if conif >= 70 and 0 < yr <= 1945 and cc < 60:
        return "mature open conifer (origin <=1945, cc<60)"
    if hard >= 50 and 0 < yr <= 1960:
        return "mature hardwood-leading (origin <=1960)"
    return None


def check(d: dict) -> dict:
    transform = rasterio.Affine(*d["transform"])
    H, W = d["density"].shape
    fc = json.loads((OUT_DIR / f"forest-{REGION['id']}.geojson").read_text(encoding="utf-8"))
    feats = [(f, fri_classes(f["properties"])) for f in fc["features"]]
    feats = [(f, c) for f, c in feats if c]
    # stand id raster: cells whose centre is in a stand
    shapes = [(transform_geom("EPSG:4326", CRS, f["geometry"]), i + 1) for i, (f, _) in enumerate(feats)]
    sid = rasterize(shapes, out_shape=(H, W), transform=transform, fill=0, dtype="int32")
    # only cells whose 8 neighbours are the same stand: no half-and-half edge cells
    interior = (minimum_filter(sid, size=3) == maximum_filter(sid, size=3)) & (sid > 0)
    valid = d["density"] >= 0
    out = {}
    names = sorted({c for _, c in feats})
    for name in names:
        ids = np.array([i + 1 for i, (_, c) in enumerate(feats) if c == name])
        m = interior & valid & np.isin(sid, ids)
        if m.sum() < 10:
            continue
        row = {"cells": int(m.sum()), "stands": int(len(np.unique(sid[m])))}
        for k in ("canopy_height", "canopy_cover", "understory", "understory_pad", "density"):
            v = d[k][m]
            v = v[v >= 0]
            if v.size:
                row[k] = {q: round(float(np.percentile(v, p)), 3) for q, p in (("p25", 25), ("median", 50), ("p75", 75))}
        out[name] = row
    # water: DEM-flattened cells inside the fetched tiles; returns there are dropped
    m = d["water"] & (d["water_frac"] >= 0)
    if m.any():
        out["water (DEM-flattened)"] = {"cells": int(m.sum()), "share_with_any_value": round(float((d["density"][m] >= 0).mean()), 4)}
    # FRI 2010 stand height vs lidar 2021 p95, stand medians
    pairs = []
    for i, (f, c) in enumerate(feats):
        ht = f["properties"].get("ht")
        if not ht or f["properties"].get("poly") != "FOR":
            continue
        m = interior & valid & (sid == i + 1)
        if m.sum() >= 10:
            pairs.append((ht, float(np.median(d["canopy_height"][m])), (f["properties"].get("cc") or 0), float(np.median(d["canopy_cover"][m]))))
    if len(pairs) >= 5:
        a = np.array(pairs)
        out["_fri_vs_lidar"] = {
            "stands": len(pairs),
            "height_r": round(float(np.corrcoef(a[:, 0], a[:, 1])[0, 1]), 3),
            "height_median_diff_m (lidar2021 - fri2010)": round(float(np.median(a[:, 1] - a[:, 0])), 2),
            "closure_vs_cover_r": round(float(np.corrcoef(a[:, 2], a[:, 3])[0, 1]), 3) if a[:, 2].std() > 0 else None,
        }
    return out


def main(argv: list[str]) -> None:
    if "--tiles" not in argv:
        build()
    d = load()
    render_tiles(d)
    summary = check(d)
    SUMMARY.write_text(json.dumps(summary, indent=1))
    for k, v in summary.items():
        if k.startswith("_"):
            print(k, v)
            continue
        med = lambda key: v.get(key, {}).get("median", float("nan"))  # noqa: E731
        if "canopy_height" not in v:
            print(f"{k:48s} {v}")
            continue
        print(f"{k:48s} {v['cells']:6d} cells  height {med('canopy_height'):5.1f} m  cover {med('canopy_cover'):.2f}  understory {med('understory'):.2f}  pad {med('understory_pad'):.2f}")


if __name__ == "__main__":
    main(sys.argv[1:])
