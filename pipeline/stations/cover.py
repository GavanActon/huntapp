"""The ground cover round every collected station, for the station
correction (correct.py): whether a 10 m anemometer stands at an airport or
in a clearing in the bush, which the terrain alone can't say. From national
30 m rasters, so the same numbers exist on any cell in Canada (the SD grade):
  - NRCan land cover 2020 (19 classes) in a 2 km window: forest, water,
    wetland, crop, urban and shrub shares within 300 m and 1 km; whether the
    station's own cell is forest; the distance to the nearest forest cell;
    and, for 16 directions, the forest share of the ground 50 m to 1 km
    upwind (the sector +-11.25 deg about the bearing the wind comes from);
  - SCANFI v2 2025 (NFI) tree height and crown closure, means within 300 m
    and 1 km, over every cell (0 where there are no trees).

    py -3.14 pipeline/stations/cover.py

Reads pipeline/raw/stations/stations.json; writes cover.csv beside it
(id, the shares, distForest m, h300/h1k m, cc300/cc1k %, up0..up15). Read
from the national COGs over HTTP, eight at a time.
"""

from __future__ import annotations

import csv
import json
import math
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import rasterio
from pyproj import Transformer
from rasterio.windows import from_bounds
from scipy import ndimage

OUT = Path(__file__).resolve().parents[1] / "raw" / "stations"
LANDCOVER = "https://datacube-prod-data-public.s3.ca-central-1.amazonaws.com/store/land/landcover/landcover-2020-classification.tif"
SCANFI = "https://ftp.maps.canada.ca/pub/nrcan_rncan/Forests_Foret/SCANFI/v2/SCANFI_att_{layer}_2025_v2_20260119.tif"
CLASSES = {"forest": (1, 2, 5, 6), "water": (18,), "wetland": (14,), "crop": (15,), "urban": (17,), "shrub": (8, 11)}
local = threading.local()


def ds(url: str):
    """One open dataset and transformer per thread and raster."""
    cache = local.__dict__.setdefault("open", {})
    if url not in cache:
        d = rasterio.open(url)
        cache[url] = (d, Transformer.from_crs(4326, d.crs, always_xy=True))
    return cache[url]


def window(url: str, lon: float, lat: float, half: float) -> tuple[np.ndarray, float]:
    d, t = ds(url)
    x, y = t.transform(lon, lat)
    a = d.read(1, window=from_bounds(x - half, y - half, x + half, y + half, d.transform), boundless=True, fill_value=0)
    return a, abs(d.transform.a)


def measure(item: tuple[str, dict]) -> dict | None:
    sid, s = item
    try:
        lc, res = window(LANDCOVER, s["lon"], s["lat"], 2000)
    except Exception:  # noqa: BLE001  (off the map, or a read that failed: left out)
        return None
    if (lc == 0).mean() > 0.5:
        return None
    rows, cols = lc.shape
    cy, cx = rows // 2, cols // 2
    yy, xx = np.mgrid[:rows, :cols]
    dx, dy = (xx - cx) * res, (cy - yy) * res
    r = np.hypot(dx, dy)
    brg = (np.degrees(np.arctan2(dx, dy)) + 360) % 360  # from the station toward the cell: where a wind from there comes from
    forest = np.isin(lc, CLASSES["forest"])
    out = {"id": sid, "lcAt": int(lc[cy, cx]), "atForest": int(forest[cy, cx])}
    for name, cl in CLASSES.items():
        m = np.isin(lc, cl)
        out[f"{name}300"] = round(float(m[r <= 300].mean()), 3)
        out[f"{name}1k"] = round(float(m[r <= 1000].mean()), 3)
    out["distForest"] = round(float(ndimage.distance_transform_edt(~forest)[cy, cx] * res)) if forest.any() else 2000
    for k in range(16):
        b = k * 22.5
        sector = (np.abs((brg - b + 180) % 360 - 180) <= 11.25) & (r >= 50) & (r <= 1000)
        out[f"up{k}"] = round(float(forest[sector].mean()), 3)
    for layer, key in (("height", "h"), ("closure", "cc")):
        try:
            a, res2 = window(SCANFI.format(layer=layer), s["lon"], s["lat"], 1000)
            a = a.astype("float32")
            a[(a < 0) | (a > 200)] = np.nan
            ry, rx = a.shape
            gy, gx = np.mgrid[:ry, :rx]
            rr = np.hypot(gx - rx // 2, gy - ry // 2) * res2
            out[f"{key}300"] = round(float(np.nanmean(a[rr <= 300])), 1)
            out[f"{key}1k"] = round(float(np.nanmean(a[rr <= 1000])), 1)
        except Exception:  # noqa: BLE001
            out[f"{key}300"] = out[f"{key}1k"] = ""
    return out


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    stations = json.loads((OUT / "stations.json").read_text(encoding="utf-8"))
    t0 = time.time()
    out = []
    with ThreadPoolExecutor(8) as ex:
        for i, r in enumerate(ex.map(measure, stations.items()), 1):
            if r:
                out.append(r)
            if i % 100 == 0:
                print(f"  {i}/{len(stations)} · {len(out)} measured · {time.time() - t0:.0f} s", flush=True)
    keys = list(out[0].keys())
    with open(OUT / "cover.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=keys)
        w.writeheader()
        w.writerows(out)
    print(f"{len(out)} of {len(stations)} stations measured -> {OUT / 'cover.csv'} · {time.time() - t0:.0f} s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
