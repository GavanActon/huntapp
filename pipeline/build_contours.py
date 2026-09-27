"""NRCan HRDEM 1 m LiDAR → 1 m contour lines as vector PMTiles for the core.

Toporama's contours are fixed at 10 m. This bakes every whole metre from
the LiDAR grid build_hillshade.py already cached (pipeline/raw/lidar-<region>.npz)
so the app can pick the interval itself: each line carries

    elev  metres (integer)
    step  the coarsest of 10 / 5 / 2 / 1 that divides elev

and the style keeps lines with step >= the chosen interval. One bake, four
intervals. Lakes are masked with the LIO waterbody polygons (a flat lake
surface in LiDAR is noise rings otherwise) and the grid is averaged to 2 m
and lightly smoothed before tracing, which is plenty at z16 (2.4 m/px here).

    python pipeline/build_contours.py
"""

from __future__ import annotations

import gzip
import json
import math
import time

import mapbox_vector_tile
import numpy as np
import rasterio
import shapely
from contourpy import contour_generator
from rasterio import features
from rasterio.warp import transform as warp_xy, transform_geom
from scipy import ndimage

from common import CACHE_DIR, CORE, OUT_DIR, REGION, REGION_MAXZOOM, lat_to_tile, lon_to_tile, tile_bounds_3857
from pmtiles.tile import Compression, TileType, zxy_to_tileid
from pmtiles.writer import Writer

DOWNSAMPLE = 2  # 1 m → 2 m cells
SMOOTH_SIGMA = 1.0  # cells, after downsampling
MIN_RING_M = 40.0  # closed rings shorter than this are LiDAR noise (a stump, a rock)
MINZOOM = REGION_MAXZOOM + 1
MAXZOOM = CORE["maxzoom"]
EXTENT = 4096
TILE_BUFFER_PX = 64  # in extent units, so lines run cleanly across tile edges


def load_lidar():
    cache = CACHE_DIR / f"lidar-{REGION['id']}.npz"
    if not cache.exists():
        raise SystemExit(f"{cache} missing: run build_hillshade.py first (it downloads and caches the LiDAR)")
    z = np.load(cache, allow_pickle=True)
    elev = z["elev"].astype(np.float32)
    transform = rasterio.Affine(*z["transform"])
    crs = str(z["crs"])
    nodata = float(z["nodata"])
    print(f"lidar {elev.shape} at {transform.a:g} m · {crs}")
    return elev, transform, crs, nodata


def water_mask(shape, transform, crs) -> np.ndarray:
    path = OUT_DIR / f"waterbody-{REGION['id']}.geojson"
    if not path.exists():
        print("no waterbody GeoJSON: lakes left unmasked (run build_vectors.py waterbody)")
        return np.zeros(shape, dtype=bool)
    gj = json.loads(path.read_text(encoding="utf-8"))
    geoms = [transform_geom("EPSG:4326", crs, f["geometry"]) for f in gj["features"] if f.get("geometry")]
    mask = features.rasterize(((g, 1) for g in geoms), out_shape=shape, transform=transform, fill=0, dtype=np.uint8, all_touched=True)
    # grow the mask a cell so the shoreline itself does not ring
    mask = ndimage.binary_dilation(mask.astype(bool), iterations=2)
    print(f"water mask · {mask.mean() * 100:.1f}% of cells from {len(geoms)} polygons")
    return mask


def prepare(elev, transform, nodata):
    """Averaged to DOWNSAMPLE m and smoothed; returns (masked array, transform)."""
    H, W = elev.shape
    h, w = H // DOWNSAMPLE, W // DOWNSAMPLE
    e = elev[: h * DOWNSAMPLE, : w * DOWNSAMPLE]
    bad = e == nodata
    e = np.where(bad, np.nan, e).reshape(h, DOWNSAMPLE, w, DOWNSAMPLE)
    with np.errstate(all="ignore"):
        e = np.nanmean(e, axis=(1, 3)).astype(np.float32)
    t = transform * rasterio.Affine.scale(DOWNSAMPLE)
    nan = np.isnan(e)
    if SMOOTH_SIGMA > 0:
        filled = np.where(nan, np.nanmean(e), e)
        e = ndimage.gaussian_filter(filled, SMOOTH_SIGMA).astype(np.float32)
        e[nan] = np.nan
    return e, t


def step_of(elev_m: int) -> int:
    for s in (10, 5, 2, 1):
        if elev_m % s == 0:
            return s
    return 1


def trace(e: np.ndarray, t: rasterio.Affine, crs: str, mask: np.ndarray):
    """Every whole-metre contour as shapely LineStrings in EPSG:3857, with props."""
    z = np.ma.array(e, mask=np.isnan(e) | mask)
    lo, hi = int(math.floor(np.nanmin(e))), int(math.ceil(np.nanmax(e)))
    print(f"levels {lo}..{hi} m")
    # pixel-centre coordinates in the source CRS
    h, w = e.shape
    xs = t.c + (np.arange(w) + 0.5) * t.a
    ys = t.f + (np.arange(h) + 0.5) * t.e
    gen = contour_generator(x=xs, y=ys, z=z, name="serial", corner_mask=True, line_type="Separate")
    lines, props = [], []
    t0 = time.time()
    for level in range(lo, hi + 1):
        for seg in gen.lines(float(level)):
            if len(seg) < 3:
                continue
            closed = np.allclose(seg[0], seg[-1])
            length = float(np.sum(np.hypot(*np.diff(seg, axis=0).T)))
            if closed and length < MIN_RING_M:
                continue
            gx, gy = warp_xy(crs, "EPSG:3857", seg[:, 0].tolist(), seg[:, 1].tolist())
            lines.append(shapely.LineString(np.column_stack([gx, gy])))
            props.append({"elev": level, "step": step_of(level)})
    print(f"traced {len(lines)} lines in {time.time() - t0:.0f} s")
    return lines, props


def core_tiles(z: int):
    x0, x1 = lon_to_tile(CORE["west"], z), lon_to_tile(CORE["east"] - 1e-9, z)
    y0, y1 = lat_to_tile(CORE["north"], z), lat_to_tile(CORE["south"] + 1e-9, z)
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            yield x, y


def main():
    elev, transform, crs, nodata = load_lidar()
    e, t = prepare(elev, transform, nodata)
    del elev
    mask = water_mask(e.shape, t, crs)
    lines, props = trace(e, t, crs, mask)
    tree = shapely.STRtree(lines)

    out = OUT_DIR / f"contours-{REGION['id']}.pmtiles"
    count, total = 0, 0
    with open(out, "wb") as f:
        writer = Writer(f)
        for z in range(MINZOOM, MAXZOOM + 1):
            # simplify to about half a screen pixel at this zoom
            px_m = 2 * math.pi * 6378137.0 / (2**z * 256)
            tol = px_m * 0.5
            # at the coarse end the 1 m lines are mush: keep 2 m+ at z14
            min_step = 2 if z <= REGION_MAXZOOM + 1 else 1
            simplified = [shapely.simplify(g, tol) for g in lines]
            for x, y in core_tiles(z):
                minx, miny, maxx, maxy = tile_bounds_3857(z, x, y)
                buf = (maxx - minx) * TILE_BUFFER_PX / EXTENT
                idx = tree.query(shapely.box(minx - buf, miny - buf, maxx + buf, maxy + buf))
                feats = []
                for i in idx:
                    if props[i]["step"] < min_step:
                        continue
                    g = shapely.clip_by_rect(simplified[i], minx - buf, miny - buf, maxx + buf, maxy + buf)
                    if g.is_empty:
                        continue
                    feats.append({"geometry": g, "properties": props[i]})
                if not feats:
                    continue
                pbf = mapbox_vector_tile.encode(
                    [{"name": "contours", "features": feats}],
                    default_options={"quantize_bounds": (minx, miny, maxx, maxy), "extents": EXTENT},
                )
                data = gzip.compress(pbf, 6)
                writer.write_tile(zxy_to_tileid(z, x, y), data)
                count += 1
                total += len(data)
            print(f"z{z}: {count} tiles, {total / 1e6:.1f} MB so far")
        writer.finalize(
            {
                "tile_type": TileType.MVT,
                "tile_compression": Compression.GZIP,
                "min_lon_e7": int(CORE["west"] * 1e7),
                "min_lat_e7": int(CORE["south"] * 1e7),
                "max_lon_e7": int(CORE["east"] * 1e7),
                "max_lat_e7": int(CORE["north"] * 1e7),
                "min_zoom": MINZOOM,
                "max_zoom": MAXZOOM,
                "center_zoom": MINZOOM,
                "center_lon_e7": int((CORE["west"] + CORE["east"]) / 2 * 1e7),
                "center_lat_e7": int((CORE["south"] + CORE["north"]) / 2 * 1e7),
            },
            {
                "name": f"contours-{REGION['id']}",
                "attribution": "HRDEM LiDAR © Natural Resources Canada",
                "vector_layers": [
                    {
                        "id": "contours",
                        "minzoom": MINZOOM,
                        "maxzoom": MAXZOOM,
                        "fields": {"elev": "Number", "step": "Number"},
                    }
                ],
            },
        )
    print(f"wrote {out.name} ({out.stat().st_size / 1e6:.1f} MB, {count} tiles)")


if __name__ == "__main__":
    main()
