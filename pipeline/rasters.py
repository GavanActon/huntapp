"""Fetch the two national 30 m rasters the habitat bake needs and cache them
as .npz next to the other raw inputs. Windowed HTTP reads of these COGs are
slow on this machine (minutes per read, see docs/DATA-SOURCES.md) but do
finish; so each is read once for the region, in its native EPSG:3979 grid,
and every later run starts from the cache.

    python pipeline/rasters.py            # fetch both if not cached
"""

from __future__ import annotations

import sys
import time
from pathlib import Path

import numpy as np
import rasterio
from rasterio.warp import transform_bounds
from rasterio.windows import from_bounds

import stage
from common import CACHE_DIR, REGION, grid_covers

MRDEM = "https://canelevation-dem.s3.ca-central-1.amazonaws.com/mrdem-30/mrdem-30-dtm.tif"
LANDCOVER = "https://datacube-prod-data-public.s3.ca-central-1.amazonaws.com/store/land/landcover/landcover-2020-classification.tif"
PAD_DEG = 0.02  # a margin so slopes and distances are right at the region edge

SOURCES = {"mrdem": MRDEM, "landcover": LANDCOVER}


def cache_path(name: str) -> Path:
    return CACHE_DIR / f"{name}-{REGION['id']}.npz"


def fetch(name: str) -> dict:
    path = cache_path(name)
    if path.exists():
        z = np.load(path)
        out = {k: z[k] for k in z.files}
        if not grid_covers(rasterio.Affine(*out["transform"][:6]), out["data"].shape, str(out["crs"]), REGION):
            raise SystemExit(f"{path.name} does not reach over this area's region (moved or grown since it was read?): delete it to fetch again")
        return out
    url = SOURCES[name]
    t = time.time()
    box = (REGION["west"] - PAD_DEG, REGION["south"] - PAD_DEG, REGION["east"] + PAD_DEG, REGION["north"] + PAD_DEG)
    path_in = stage.source(url, box)  # a local copy when one holds the box (stage.py)
    print(f"fetching {name} from {path_in}" + (" (slow: minutes)" if path_in.startswith("/vsicurl/") else ""))
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif", GDAL_HTTP_MAX_RETRY="6", GDAL_HTTP_RETRY_DELAY="2"):
        with rasterio.open(path_in) as src:
            b = transform_bounds("EPSG:4326", src.crs, *box)
            w = from_bounds(*b, src.transform).round_offsets().round_lengths()
            arr = src.read(1, window=w)
            tr = src.window_transform(w)
            out = {
                "data": arr,
                "transform": np.array([tr.a, tr.b, tr.c, tr.d, tr.e, tr.f], dtype=np.float64),
                "crs": np.array(src.crs.to_string()),
                "nodata": np.array(src.nodata if src.nodata is not None else np.nan),
            }
    np.savez_compressed(path, **out)
    print(f"  {name}: {arr.shape} in {time.time() - t:.0f}s -> {path.name}")
    return out


if __name__ == "__main__":
    for n in sys.argv[1:] or list(SOURCES):
        fetch(n)
