"""MRDEM 30 m → 10 m contour lines as vector PMTiles over the whole region.

build_contours.py traces every metre from the 1 m LiDAR, but only for the
core and only from z14, so zooming out (or looking past the core) lost the
elevation altogether. This bakes the coarse picture from the same MRDEM
grids build_dem.py cached (pipeline/raw/mrdem-wide-<region>.npz at 30 m,
mrdem-coarse-<region>.npz at 240 m): every 10 m, each line carrying

    elev  metres (integer)
    step  the coarsest of 100 / 50 / 20 / 10 that divides elev
    core  1 inside the CORE box, 0 outside

so the style can thin the lines by zoom (step >= 50 as the index lines) and,
where the LiDAR contours take over inside the core, drop the `core` ones.
Each zoom is baked with only the lines it will draw:

    z8-9    240 m grid, 50 m lines
    z10-11  30 m grid, 20 m lines
    z12-14  30 m grid, 10 m lines (z14 overzooms to 15/16)

Lakes are masked with the LIO waterbody polygons, the grids are lightly
smoothed before tracing, and short closed rings are dropped.

    py -3.14 pipeline/build_contours_wide.py
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
from rasterio.warp import transform as warp_xy, transform_bounds, transform_geom
from scipy import ndimage

from common import CACHE_DIR, CORE, OUT_DIR, REGION, region_tiles, tile_bounds_3857
from pmtiles.tile import Compression, TileType, zxy_to_tileid
from pmtiles.writer import Writer

MINZOOM = 8
MAXZOOM = 14
INTERVAL = 10
EXTENT = 4096
TILE_BUFFER_PX = 64
SMOOTH_SIGMA = 1.0  # cells

# which grid, and the coarsest step kept, per zoom
PLAN = {8: ("mrdem-coarse", 50), 9: ("mrdem-coarse", 50), 10: ("mrdem-wide", 20), 11: ("mrdem-wide", 20)}
for _z in range(12, MAXZOOM + 1):
    PLAN[_z] = ("mrdem-wide", 10)


def load_grid(name: str):
    cache = CACHE_DIR / f"{name}-{REGION['id']}.npz"
    if not cache.exists():
        raise SystemExit(f"{cache} missing: run build_dem.py first (it downloads and caches the MRDEM windows)")
    z = np.load(cache)
    elev = z["data"].astype(np.float32)
    transform = rasterio.Affine(*z["transform"].tolist()[:6])
    crs = str(z["crs"])
    nodata = float(z["nodata"])
    print(f"{name} {elev.shape} at {transform.a:g} m · {crs}")
    return elev, transform, crs, nodata


def water_mask(shape, transform, crs) -> np.ndarray:
    path = OUT_DIR / f"waterbody-{REGION['id']}.geojson"
    if not path.exists():
        print("no waterbody GeoJSON: lakes left unmasked (run build_vectors.py waterbody)")
        return np.zeros(shape, dtype=bool)
    gj = json.loads(path.read_text(encoding="utf-8"))
    geoms = [transform_geom("EPSG:4326", crs, f["geometry"]) for f in gj["features"] if f.get("geometry")]
    mask = features.rasterize(((g, 1) for g in geoms), out_shape=shape, transform=transform, fill=0, dtype=np.uint8, all_touched=True)
    mask = ndimage.binary_dilation(mask.astype(bool), iterations=1)
    print(f"water mask · {mask.mean() * 100:.1f}% of cells from {len(geoms)} polygons")
    return mask


def prepare(elev, nodata):
    nan = np.isnan(elev) | (elev == nodata)
    e = np.where(nan, np.nan, elev)
    if SMOOTH_SIGMA > 0:
        filled = np.where(nan, np.nanmean(e), e)
        e = ndimage.gaussian_filter(filled, SMOOTH_SIGMA).astype(np.float32)
        e[nan] = np.nan
    return e


def step_of(elev_m: int) -> int:
    for s in (100, 50, 20, 10):
        if elev_m % s == 0:
            return s
    return INTERVAL


def trace(e: np.ndarray, t: rasterio.Affine, crs: str, mask: np.ndarray, min_ring_m: float):
    """Every 10 m contour as shapely lines in EPSG:3857, with props."""
    z = np.ma.array(e, mask=np.isnan(e) | mask)
    lo = int(math.floor(np.nanmin(e) / INTERVAL)) * INTERVAL
    hi = int(math.ceil(np.nanmax(e) / INTERVAL)) * INTERVAL
    print(f"levels {lo}..{hi} m every {INTERVAL} m")
    h, w = e.shape
    xs = t.c + (np.arange(w) + 0.5) * t.a
    ys = t.f + (np.arange(h) + 0.5) * t.e
    gen = contour_generator(x=xs, y=ys, z=z, name="serial", corner_mask=True, line_type="Separate")
    lines, props = [], []
    t0 = time.time()
    for level in range(lo, hi + 1, INTERVAL):
        for seg in gen.lines(float(level)):
            if len(seg) < 3:
                continue
            closed = np.allclose(seg[0], seg[-1])
            length = float(np.sum(np.hypot(*np.diff(seg, axis=0).T)))
            if closed and length < min_ring_m:
                continue
            gx, gy = warp_xy(crs, "EPSG:3857", seg[:, 0].tolist(), seg[:, 1].tolist())
            lines.append(shapely.LineString(np.column_stack([gx, gy])))
            props.append({"elev": level, "step": step_of(level)})
    print(f"traced {len(lines)} lines in {time.time() - t0:.0f} s")
    return lines, props


def split_core(lines, props, core_box):
    """Each line cut at the core edge, the parts tagged core 1 / 0."""
    out_lines, out_props = [], []
    for g, p in zip(lines, props):
        if not g.intersects(core_box):
            out_lines.append(g)
            out_props.append({**p, "core": 0})
            continue
        for part, flag in ((shapely.intersection(g, core_box), 1), (shapely.difference(g, core_box), 0)):
            if part.is_empty:
                continue
            out_lines.append(part)
            out_props.append({**p, "core": flag})
    return out_lines, out_props


def build_set(name: str, core_box, min_ring_m: float):
    elev, transform, crs, nodata = load_grid(name)
    e = prepare(elev, nodata)
    mask = water_mask(e.shape, transform, crs)
    lines, props = trace(e, transform, crs, mask, min_ring_m)
    lines, props = split_core(lines, props, core_box)
    return lines, props, shapely.STRtree(lines)


def main():
    w, s, e, n = transform_bounds("EPSG:4326", "EPSG:3857", CORE["west"], CORE["south"], CORE["east"], CORE["north"])
    core_box = shapely.box(w, s, e, n)
    sets = {}
    for name, ring in (("mrdem-coarse", 2000.0), ("mrdem-wide", 250.0)):
        sets[name] = build_set(name, core_box, ring)

    out = OUT_DIR / f"contours-wide-{REGION['id']}.pmtiles"
    count, total = 0, 0
    with open(out, "wb") as f:
        writer = Writer(f)
        for z in range(MINZOOM, MAXZOOM + 1):
            grid, min_step = PLAN[z]
            lines, props, tree = sets[grid]
            px_m = 2 * math.pi * 6378137.0 / (2**z * 256)
            tol = px_m * 0.5
            simplified = [shapely.simplify(g, tol) for g in lines]
            for _, x, y in region_tiles(z):
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
            print(f"z{z} ({grid}, {min_step} m+): {count} tiles, {total / 1e6:.1f} MB so far")
        writer.finalize(
            {
                "tile_type": TileType.MVT,
                "tile_compression": Compression.GZIP,
                "min_lon_e7": int(REGION["west"] * 1e7),
                "min_lat_e7": int(REGION["south"] * 1e7),
                "max_lon_e7": int(REGION["east"] * 1e7),
                "max_lat_e7": int(REGION["north"] * 1e7),
                "min_zoom": MINZOOM,
                "max_zoom": MAXZOOM,
                "center_zoom": 11,
                "center_lon_e7": int((REGION["west"] + REGION["east"]) / 2 * 1e7),
                "center_lat_e7": int((REGION["south"] + REGION["north"]) / 2 * 1e7),
            },
            {
                "name": f"contours-wide-{REGION['id']}",
                "attribution": "MRDEM © Natural Resources Canada",
                "vector_layers": [
                    {
                        "id": "contours",
                        "minzoom": MINZOOM,
                        "maxzoom": MAXZOOM,
                        "fields": {"elev": "Number", "step": "Number", "core": "Number"},
                    }
                ],
            },
        )
    print(f"wrote {out.name} ({out.stat().st_size / 1e6:.1f} MB, {count} tiles)")


if __name__ == "__main__":
    main()
