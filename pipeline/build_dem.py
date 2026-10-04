"""Elevation tiles for MapLibre's own hillshade and colour-by-height layers:
a raster-dem PMTiles, Mapbox Terrain-RGB encoded, lossless, 256 px.

    height_m = -10000 + (R * 65536 + G * 256 + B) * 0.1

Three NRCan sources, each laid over the one below and feathered in at its
edge so no seam or cliff shows where one ends:

  * MRDEM 30 m DTM (mrdem-30), 240 m overview: the low zooms, whose tiles
    reach 100 km past the region (pipeline/raw/mrdem-coarse-<region>.npz)
  * MRDEM 30 m at full resolution over every region tile to z10
    (pipeline/raw/mrdem-wide-<region>.npz). The habitat bake's
    mrdem-<region>.npz stops 2 km past the region, short of the edge tiles.
  * HRDEM 1 m LiDAR DTM for the core, the cache build_hillshade.py makes
    from the area's own surveys (pipeline/raw/lidar-<region>.npz). LiDAR
    wins wherever it exists, at every zoom, so the heights and colours in
    the core do not jump as you zoom in past REGION_MAXZOOM.

The region is baked from MINZOOM to REGION_MAXZOOM and the core on to
CORE.maxzoom, as the other rasters are. Every tile is a full 256 px square:
core tiles reach past the LiDAR, and MRDEM fills that part. Downsampling is
an area mean (GDAL "average"). The LiDAR is also pre-averaged into 4, 16 and
64 m levels so the low zooms do not read a 10k square each time. Upsampling
uses bilinear for the LiDAR and cubic for the 30 m MRDEM, which bilinear
would leave faceted under a hillshade. Heights keep 0.1 m steps, the
format's resolution.

The MRDEM reads are windowed HTTP reads of a national COG (a minute or two
each, cached after the first run). The LiDAR cache normally exists already
(build_hillshade.py runs first); without it the area's surveys are read
as build_hillshade.py would.

    py -3.14 pipeline/build_dem.py                 # z8-16, lossless WebP
    py -3.14 pipeline/build_dem.py --maxzoom 15    # stop the core a zoom lower
    py -3.14 pipeline/build_dem.py --format png

The archive's metadata carries encoding "mapbox" and tileSize 256 for the
raster-dem source. Its header zooms are MINZOOM..maxzoom.
"""

from __future__ import annotations

import argparse
import math
import os
import time
from pathlib import Path

import numpy as np
import rasterio
from pyproj import Transformer
from rasterio.transform import from_bounds
from rasterio.warp import Resampling, reproject, transform_bounds
from rasterio.windows import from_bounds as window_from_bounds

from build_hillshade import fetch_core
from build_tiles import in_core
from common import CACHE_DIR, CORE, OUT_DIR, REGION, REGION_MAXZOOM, grid_covers, region_tiles, tile_bounds_3857, write_raster_pmtiles
from rasters import MRDEM

MINZOOM = 8
TILE = 256
NODATA = -32767.0
LIDAR_LEVELS = (1, 4, 16, 64)  # block-mean factors of the 1 m grid

GDAL_ENV = dict(
    GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR",
    CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif",
    GDAL_HTTP_MAX_RETRY="6",
    GDAL_HTTP_RETRY_DELAY="2",
)


def union_bounds(z: int, pad_deg: float) -> tuple[float, float, float, float]:
    """lon/lat box around every region tile at zoom z, padded."""
    t = region_tiles(z)
    xs = [x for _, x, _ in t]
    ys = [y for _, _, y in t]
    w, s, _, _ = tile_bounds_3857(z, min(xs), max(ys))
    _, _, e, n = tile_bounds_3857(z, max(xs), min(ys))
    w, s, e, n = transform_bounds("EPSG:3857", "EPSG:4326", w, s, e, n)
    return w - pad_deg, s - pad_deg, e + pad_deg, n + pad_deg


def fetch_mrdem(name: str, bounds: tuple[float, float, float, float], factor: int) -> dict:
    """An MRDEM window at 30 m x factor, cached as pipeline/raw/<name>-<region>.npz
    (the same layout rasters.py writes)."""
    cache = CACHE_DIR / f"{name}-{REGION['id']}.npz"
    if not cache.exists():
        t = time.time()
        print(f"fetching {name}: MRDEM at {30 * factor} m over {[round(v, 3) for v in bounds]} (slow)")
        with rasterio.Env(**GDAL_ENV), rasterio.open(f"/vsicurl/{MRDEM}") as src:
            b = transform_bounds("EPSG:4326", src.crs, *bounds)
            w = window_from_bounds(*b, transform=src.transform).round_offsets().round_lengths()
            H, W = int(w.height) // factor, int(w.width) // factor
            arr = src.read(1, window=w, out_shape=(H, W), resampling=Resampling.average)
            tr = src.window_transform(w) * rasterio.Affine.scale(w.width / W, w.height / H)
            out = {
                "data": arr,
                "transform": np.array([tr.a, tr.b, tr.c, tr.d, tr.e, tr.f], dtype=np.float64),
                "crs": np.array(src.crs.to_string()),
                "nodata": np.array(src.nodata if src.nodata is not None else np.nan),
            }
        np.savez_compressed(cache, **out)
        print(f"  {arr.shape} in {time.time() - t:.0f} s -> {cache.name}")
    z = np.load(cache)
    out = {k: z[k] for k in z.files}
    if not grid_covers(rasterio.Affine(*out["transform"][:6]), out["data"].shape, str(out["crs"]), REGION):
        raise SystemExit(f"{cache.name} does not reach over this area's region (moved or grown since it was read?): delete it to fetch again")
    return out


def block_mean(a: np.ndarray, k: int) -> np.ndarray:
    """Mean of k x k blocks (a ragged last row/column is dropped); NaN spreads."""
    h, w = a.shape[0] // k * k, a.shape[1] // k * k
    return a[:h, :w].reshape(h // k, k, w // k, k).mean(axis=(1, 3), dtype=np.float64).astype(np.float32)


class Layer:
    """One source grid (with coarser pre-averaged levels) that can be warped
    into a web-mercator tile, and a weight that ramps it in from its edge."""

    def __init__(self, name, arr, transform, crs, skip_m, feather_m, upsample, factors=(1,)):
        a = np.asarray(arr, dtype=np.float32)
        self.name = name
        self.crs = crs
        self.t0 = rasterio.Affine(*transform[:6]) if not isinstance(transform, rasterio.Affine) else transform
        self.res = abs(self.t0.a)
        self.shape = a.shape
        self.skip_m, self.feather_m, self.upsample = skip_m, feather_m, upsample
        self.levels = []  # (res m, sentinel-filled array, transform)
        for k in factors:
            lv = a if k == 1 else block_mean(a, k)
            self.levels.append((self.res * k, np.where(np.isnan(lv), NODATA, lv).astype(np.float32), self.t0 * rasterio.Affine.scale(k)))

    def warp(self, b, px_m) -> np.ndarray | None:
        """The layer in tile bounds b (EPSG:3857) at TILE px; NaN where it has no data."""
        # the coarsest level still at least 4x finer than the tile pixel
        res, arr, tr = next((lv for lv in reversed(self.levels) if lv[0] * 4 <= px_m), self.levels[0])
        resampling = Resampling.average if px_m >= 1.5 * res else self.upsample
        # read only the part of the grid under the tile, with a few pixels to spare
        minx, miny, maxx, maxy = transform_bounds("EPSG:3857", self.crs, *b, densify_pts=21)
        inv = ~tr
        c0, r0 = inv * (minx, maxy)
        c1, r1 = inv * (maxx, miny)
        pad = 4
        c0, r0 = max(int(math.floor(c0)) - pad, 0), max(int(math.floor(r0)) - pad, 0)
        c1, r1 = min(int(math.ceil(c1)) + pad, arr.shape[1]), min(int(math.ceil(r1)) + pad, arr.shape[0])
        if c1 <= c0 or r1 <= r0:
            return None
        dst = np.full((TILE, TILE), np.nan, dtype=np.float32)
        reproject(
            source=np.ascontiguousarray(arr[r0:r1, c0:c1]),
            destination=dst,
            src_transform=tr * rasterio.Affine.translation(c0, r0),
            src_crs=self.crs,
            src_nodata=NODATA,
            dst_transform=from_bounds(*b, TILE, TILE),
            dst_crs="EPSG:3857",
            dst_nodata=np.nan,
            resampling=resampling,
        )
        return None if np.isnan(dst).all() else dst

    def edge_weight(self, X, Y) -> np.ndarray:
        """0 at the grid's edge (and skip_m in from it) rising smoothly to 1
        feather_m further in; X, Y are pixel centres in the layer's CRS."""
        inv = ~self.t0
        col, row = inv * (X, Y)
        H, W = self.shape
        d = np.minimum.reduce([col, W - col, row, H - row]) * self.res
        s = np.clip((d - self.skip_m) / self.feather_m, 0, 1)
        return s * s * (3 - 2 * s)


def fill_nan(a: np.ndarray) -> np.ndarray:
    """Pull-push fill of any hole left (none, with all three sources): a
    smooth surface from the edges in, so a hole never becomes a cliff."""
    if not np.isnan(a).any():
        return a
    pyramid = [a]
    while np.isnan(pyramid[-1]).any() and min(pyramid[-1].shape) > 1:
        p = pyramid[-1]
        h, w = -(-p.shape[0] // 2) * 2, -(-p.shape[1] // 2) * 2
        q = np.full((h, w), np.nan, dtype=np.float32)
        q[: p.shape[0], : p.shape[1]] = p
        blocks = q.reshape(h // 2, 2, w // 2, 2)
        n = (~np.isnan(blocks)).sum(axis=(1, 3))
        with np.errstate(invalid="ignore"):
            pyramid.append(np.where(n > 0, np.nansum(blocks, axis=(1, 3)) / np.maximum(n, 1), np.nan).astype(np.float32))
    if np.isnan(pyramid[-1]).all():
        raise SystemExit("a tile with no elevation from any source")
    for i in range(len(pyramid) - 2, -1, -1):
        p = pyramid[i]
        up = np.repeat(np.repeat(pyramid[i + 1], 2, axis=0), 2, axis=1)[: p.shape[0], : p.shape[1]]
        pyramid[i] = np.where(np.isnan(p), up, p)
    return pyramid[0]


def encode(h: np.ndarray) -> np.ndarray:
    """Heights in metres -> Terrain-RGB (256 x 256 x 3 uint8), 0.1 m steps."""
    v = np.clip(np.round((h.astype(np.float64) + 10000.0) * 10.0), 0, 2**24 - 1).astype(np.uint32)
    return np.dstack([(v >> 16) & 255, (v >> 8) & 255, v & 255]).astype(np.uint8)


def decode(rgb: np.ndarray) -> np.ndarray:
    rgb = rgb.astype(np.float64)
    return -10000.0 + (rgb[..., 0] * 65536 + rgb[..., 1] * 256 + rgb[..., 2]) * 0.1


def load_layers() -> list[Layer]:
    """Coarse to fine: each later layer is laid over the ones before."""
    coarse = fetch_mrdem("mrdem-coarse", union_bounds(MINZOOM, 0.1), 8)
    wide = fetch_mrdem("mrdem-wide", union_bounds(10, 0.02), 1)
    t = time.time()
    elev, transform, crs, nodata = fetch_core()  # the area's own surveys (bake.hrdem), never another area's
    elev = np.where(elev == nodata, np.nan, elev)
    layers = []
    for name, m, skip, feather in (("mrdem-coarse", coarse, 1000.0, 3000.0), ("mrdem-wide", wide, 90.0, 600.0)):
        a = np.where(m["data"] == m["nodata"], np.nan, m["data"])
        layers.append(Layer(name, a, m["transform"], str(m["crs"]), skip, feather, Resampling.cubic))
    # the LiDAR runs 300-450 m past the core: feathered over its outer 150 m
    layers.append(Layer("lidar", elev, transform, crs, 5.0, 150.0, Resampling.bilinear, LIDAR_LEVELS))
    print(f"sources ready in {time.time() - t:.0f} s: " + ", ".join(f"{l.name} {l.shape[1]}x{l.shape[0]} @ {l.res:g} m" for l in layers))
    return layers


def make_render(layers: list[Layer]):
    to_src = Transformer.from_crs("EPSG:3857", layers[0].crs, always_xy=True)
    centres = (np.arange(TILE) + 0.5) / TILE

    def heights(z: int, x: int, y: int) -> np.ndarray:
        b = tile_bounds_3857(z, x, y)
        lat = math.degrees(math.atan(math.sinh((b[1] + b[3]) / 2 / 6378137.0)))
        px_m = (b[2] - b[0]) / TILE * math.cos(math.radians(lat))  # ground metres per pixel
        mx, my = np.meshgrid(b[0] + centres * (b[2] - b[0]), b[3] - centres * (b[3] - b[1]))
        X, Y = to_src.transform(mx, my)
        out = np.full((TILE, TILE), np.nan, dtype=np.float32)
        for layer in layers:
            v = layer.warp(b, px_m)
            if v is None:
                continue
            w = np.where(np.isnan(v), 0.0, layer.edge_weight(X, Y))
            out = np.where(np.isnan(out), v, out + (np.nan_to_num(v) - out) * w).astype(np.float32)
        return fill_nan(out)

    def render(z: int, x: int, y: int):
        if z > REGION_MAXZOOM and not in_core(z, x, y):
            return None
        return encode(heights(z, x, y))

    return render, heights


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--minzoom", type=int, default=MINZOOM)
    ap.add_argument("--maxzoom", type=int, default=CORE["maxzoom"])
    ap.add_argument("--format", choices=("webp", "png"), default="webp")
    ap.add_argument("--out", default=str(OUT_DIR / f"dem-{REGION['id']}.pmtiles"))
    args = ap.parse_args()

    t = time.time()
    render, _ = make_render(load_layers())
    out = Path(args.out).resolve()
    tmp = out.with_name(out.name + ".part")  # the old archive stays usable until the new one is whole
    stats = write_raster_pmtiles(
        tmp,
        f"dem-{REGION['id']}",
        "MRDEM, HRDEM LiDAR © Natural Resources Canada",
        args.minzoom,
        args.maxzoom,
        render,
        fmt=args.format.upper(),
        metadata={
            "type": "baselayer",
            "format": args.format,
            "encoding": "mapbox",
            "tileSize": TILE,
            "minzoom": args.minzoom,
            "maxzoom": args.maxzoom,
            "region_maxzoom": REGION_MAXZOOM,
            "core_bounds": [CORE["west"], CORE["south"], CORE["east"], CORE["north"]],
            "description": (
                "Terrain-RGB elevation (m = -10000 + (R*65536 + G*256 + B) * 0.1). "
                f"Region z{args.minzoom}-{REGION_MAXZOOM} from the 30 m MRDEM, core z{REGION_MAXZOOM + 1}-{args.maxzoom} "
                "from 1 m HRDEM LiDAR; LiDAR wins wherever it exists."
            ),
        },
    )
    os.replace(tmp, out)
    for z, (n, nb) in stats.items():
        print(f"  z{z}: {n} tiles, {nb / 1e6:.1f} MB ({nb / max(n, 1) / 1e3:.0f} kB/tile)")
    print(f"done in {time.time() - t:.0f} s")


if __name__ == "__main__":
    main()
