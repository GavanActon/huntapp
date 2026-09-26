"""Any georeferenced GeoTIFF(s) → one raster PMTiles for the region.

Used for the historical NTS sheets (NRCan CanMatrix2, 042C13 + 042C14) and
for a pre-rendered Toporama. The sheets are reprojected on the fly into
Web Mercator tiles; several inputs are mosaicked first-wins per tile.

    python pipeline/build_raster.py historical raw/canmatrix2_042c13.tif raw/canmatrix2_042c14.tif
    python pipeline/build_raster.py topo raw/toporama_042c13_utm.tif --minz 8 --maxz 14

Fetch the CanMatrix2 zips from
https://ftp.maps.canada.ca/pub/nrcan_rncan/raster/canmatrix2/50k_tif/042/c/
and unzip into pipeline/raw/ first (17 MB and 12 MB).
"""

from __future__ import annotations

import argparse

import numpy as np
import rasterio
from rasterio.warp import Resampling, reproject

from common import CORE, OUT_DIR, REGION, REGION_MAXZOOM, lat_to_tile, lon_to_tile, tile_bounds_3857, write_raster_pmtiles


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("key", help="output layer key: historical | topo | satellite")
    ap.add_argument("tifs", nargs="+")
    ap.add_argument("--minz", type=int, default=8)
    ap.add_argument("--maxz", type=int, default=14)
    ap.add_argument("--jpeg", action="store_true", help="JPEG tiles (no transparency, smaller)")
    a = ap.parse_args()

    srcs = [rasterio.open(p) for p in a.tifs]
    for s in srcs:
        print(f"{s.name}: {s.crs} {s.width}x{s.height} bands {s.count} {s.dtypes[0]}")

    def read_rgba(src, b):
        size = 256
        transform = rasterio.transform.from_bounds(*b, size, size)
        n = min(src.count, 3)
        dst = np.zeros((n, size, size), dtype=np.uint8)
        alpha = np.zeros((size, size), dtype=np.uint8)
        reproject(
            source=rasterio.band(src, list(range(1, n + 1))),
            destination=dst,
            dst_transform=transform,
            dst_crs="EPSG:3857",
            resampling=Resampling.bilinear,
            src_nodata=src.nodata,
            dst_nodata=0,
        )
        # coverage mask: reproject a ones band to learn where the sheet is
        ones = np.ones((src.height, src.width), dtype=np.uint8)
        reproject(
            source=ones,
            destination=alpha,
            src_transform=src.transform,
            src_crs=src.crs,
            dst_transform=transform,
            dst_crs="EPSG:3857",
            resampling=Resampling.nearest,
        )
        cmap = None
        if n == 1:
            try:
                cmap = src.colormap(1)
            except ValueError:
                cmap = None
        if cmap:
            lut = np.array([cmap.get(i, (0, 0, 0, 0))[:3] for i in range(256)], dtype=np.uint8)
            rgb = lut[dst[0]]
        elif n == 1:
            rgb = np.repeat(dst[0][..., None], 3, axis=-1)
        else:
            rgb = np.moveaxis(dst, 0, -1)
        return rgb, alpha * 255

    def in_core(z, x, y):
        return (
            lon_to_tile(CORE["west"], z) <= x <= lon_to_tile(CORE["east"] - 1e-9, z)
            and lat_to_tile(CORE["north"], z) <= y <= lat_to_tile(CORE["south"] + 1e-9, z)
        )

    def render(z, x, y):
        if z > REGION_MAXZOOM and not in_core(z, x, y):
            return None
        b = tile_bounds_3857(z, x, y)
        out = None
        for src in srcs:
            # skip sheets that do not touch the tile
            sb = rasterio.warp.transform_bounds(src.crs, "EPSG:3857", *src.bounds)
            if sb[2] < b[0] or sb[0] > b[2] or sb[3] < b[1] or sb[1] > b[3]:
                continue
            rgb, alpha = read_rgba(src, b)
            if out is None:
                out = np.dstack([rgb, alpha])
            else:
                fill = (out[..., 3] == 0) & (alpha > 0)
                out[fill, :3] = rgb[fill]
                out[fill, 3] = alpha[fill]
        if out is None or out[..., 3].max() == 0:
            return None
        return out

    write_raster_pmtiles(
        OUT_DIR / f"{a.key}-{REGION['id']}.pmtiles",
        f"{a.key}-{REGION['id']}",
        "© Natural Resources Canada",
        a.minz,
        a.maxz,
        render,
        fmt="JPEG" if a.jpeg else "PNG",
    )


if __name__ == "__main__":
    main()
