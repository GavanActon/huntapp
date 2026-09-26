"""NRCan HRDEM 1 m LiDAR → hillshade PMTiles for the core around the camp.

The single-photon LiDAR project that covers Pickle Lake is
ON-SPL_ON_White_Lake_UTM16_2021-1m (Oct 2021), a COG on S3. Windowed
reads through GDAL's /vsicurl work but are slow from here (minutes per
request), so the core is read ONCE at full resolution in the file's own
CRS, cached to pipeline/raw/lidar-<region>.npz, and every tile is rendered
from that array in memory. Only the core (z12+) comes from LiDAR; the
wider region's low zooms keep the MRDEM hillshade from build_tiles.py.

    python pipeline/build_hillshade.py
"""

from __future__ import annotations

import sys
import time

import numpy as np
import rasterio
from rasterio.transform import from_bounds
from rasterio.warp import Resampling, reproject, transform_bounds
from rasterio.windows import from_bounds as window_from_bounds

from common import CACHE_DIR, CORE, OUT_DIR, REGION, REGION_MAXZOOM, hillshade, lat_to_tile, lon_to_tile, tile_bounds_3857, write_raster_pmtiles

S3 = "https://canelevation-dem.s3.ca-central-1.amazonaws.com"
WHITE_LAKE = f"{S3}/hrdem-lidar/ON-SPL_ON_White_Lake_UTM16_2021-1m-dtm.tif"
MARGIN_DEG = 0.004  # a few hundred metres past the core, so edge tiles shade cleanly
OVERSAMPLE = 2

GDAL_ENV = dict(
    GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR",
    CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif",
    CPL_VSIL_CURL_CHUNK_SIZE="16777216",
    CPL_VSIL_CURL_CACHE_SIZE="400000000",
    GDAL_HTTP_MULTIRANGE="YES",
    GDAL_HTTP_MERGE_CONSECUTIVE_RANGES="YES",
    GDAL_HTTP_MAX_RETRY="6",
    GDAL_HTTP_RETRY_DELAY="5",
)


def fetch_core(source: str):
    """The core's elevation grid in the source CRS: (array, transform, crs, nodata)."""
    cache = CACHE_DIR / f"lidar-{REGION['id']}.npz"
    if cache.exists():
        z = np.load(cache, allow_pickle=True)
        print(f"cached {cache.name} {z['elev'].shape}")
        return z["elev"], rasterio.Affine(*z["transform"]), str(z["crs"]), float(z["nodata"])
    t = time.time()
    with rasterio.Env(**GDAL_ENV):
        with rasterio.open(f"/vsicurl/{source}") as src:
            nodata = src.nodata if src.nodata is not None else -32767.0
            wb = transform_bounds(
                "EPSG:4326", src.crs, CORE["west"] - MARGIN_DEG, CORE["south"] - MARGIN_DEG, CORE["east"] + MARGIN_DEG, CORE["north"] + MARGIN_DEG
            )
            w = window_from_bounds(*wb, transform=src.transform).round_offsets().round_lengths()
            W, H = int(w.width), int(w.height)
            print(f"reading {W}x{H} px at {src.res[0]} m from {source.split('/')[-1]} in blocks …")
            transform = src.window_transform(w)
            crs = src.crs.to_string()
            # block by block with retries, checkpointed: the link drops often
            part = CACHE_DIR / f"lidar-{REGION['id']}-partial.npy"
            done = CACHE_DIR / f"lidar-{REGION['id']}-done.npy"
            BS = 1024
            nbx, nby = -(-W // BS), -(-H // BS)
            if part.exists() and done.exists():
                elev = np.load(part)
                flags = np.load(done)
            else:
                elev = np.full((H, W), nodata, dtype=np.float32)
                flags = np.zeros((nby, nbx), dtype=bool)
            from rasterio.windows import Window

            todo = int((~flags).sum())
            n = 0
            for by in range(nby):
                for bx in range(nbx):
                    if flags[by, bx]:
                        continue
                    x0, y0 = bx * BS, by * BS
                    bw, bh = min(BS, W - x0), min(BS, H - y0)
                    win = Window(w.col_off + x0, w.row_off + y0, bw, bh)
                    for attempt in range(8):
                        try:
                            elev[y0 : y0 + bh, x0 : x0 + bw] = src.read(1, window=win)
                            break
                        except Exception as e:  # noqa: BLE001
                            print(f"  block {by},{bx} retry {attempt + 1}: {str(e)[:80]}")
                            time.sleep(5 * (attempt + 1))
                    else:
                        raise SystemExit("gave up on a block; rerun to resume")
                    flags[by, bx] = True
                    n += 1
                    if n % 4 == 0 or n == todo:
                        np.save(part, elev)
                        np.save(done, flags)
                        print(f"  {n}/{todo} blocks · {time.time() - t:.0f} s")
    print(f"  read in {time.time() - t:.0f} s · nodata px {(elev == nodata).sum()}")
    np.savez_compressed(cache, elev=elev, transform=np.array(transform)[:6], crs=crs, nodata=nodata)
    return elev, transform, crs, nodata


def main(source: str = WHITE_LAKE):
    elev, transform, crs, nodata = fetch_core(source)
    elev = np.where(elev == nodata, np.nan, elev)
    fill = np.nanmean(elev)
    lat = (CORE["south"] + CORE["north"]) / 2

    def in_core(z, x, y):
        return (
            lon_to_tile(CORE["west"], z) <= x <= lon_to_tile(CORE["east"] - 1e-9, z)
            and lat_to_tile(CORE["north"], z) <= y <= lat_to_tile(CORE["south"] + 1e-9, z)
        )

    def render(z, x, y):
        if not in_core(z, x, y):
            return None
        b = tile_bounds_3857(z, x, y)
        size = 256 * OVERSAMPLE
        dst = np.full((size, size), np.nan, dtype=np.float32)
        reproject(
            source=np.nan_to_num(elev, nan=nodata),
            destination=dst,
            src_transform=transform,
            src_crs=crs,
            src_nodata=nodata,
            dst_transform=from_bounds(*b, size, size),
            dst_crs="EPSG:3857",
            dst_nodata=np.nan,
            resampling=Resampling.bilinear,
        )
        valid = ~np.isnan(dst)
        if valid.mean() < 0.01:
            return None
        cell_m = ((b[2] - b[0]) / size) * np.cos(np.radians(lat))
        sh = hillshade(np.where(valid, dst, fill), cell_m)
        sh = sh.reshape(256, OVERSAMPLE, 256, OVERSAMPLE).mean(axis=(1, 3))
        v = valid.reshape(256, OVERSAMPLE, 256, OVERSAMPLE).mean(axis=(1, 3))
        shade = (sh - 0.5) * 2
        rgb = np.where(shade[..., None] < 0, 0, 255).astype(np.uint8).repeat(3, axis=-1)
        alpha = (np.abs(shade) * 0.85 * 255 * v).astype(np.uint8)
        return np.dstack([rgb, alpha])

    write_raster_pmtiles(
        OUT_DIR / f"hillshade-lidar-{REGION['id']}.pmtiles",
        f"hillshade-lidar-{REGION['id']}",
        "HRDEM LiDAR © Natural Resources Canada",
        REGION_MAXZOOM + 1,
        CORE["maxzoom"],
        render,
    )
    print("Rename to hillshade-<region>.pmtiles to replace the MRDEM bake, or merge the two.")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else WHITE_LAKE)
