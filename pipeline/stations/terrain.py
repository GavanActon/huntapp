"""The ground round every collected station, from the 30 m MRDEM: how much
relief there is within 3 km, and whether the station sits on a rise or in
a hollow against the ground within 1 km. It sorts the stations into the
scoreboard's groups (docs/WIND-LEARNING.md, "Stations"): valley floors,
ridges, flat open ground.

    py -3.14 pipeline/stations/terrain.py

Reads pipeline/raw/stations/stations.json (collect.py); writes
pipeline/raw/stations/terrain.csv with id, name, provider, lat, lon, elev
(the MRDEM's, m), relief3 (max - min within 3 km), tpi1 (the station's
height less the mean within 1 km: + on a rise, - in a hollow) and rise3
(the highest ground within 3 km above the station). About 1,200 windows
read from the national COG, ~15 minutes.
"""

from __future__ import annotations

import csv
import json
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import rasterio
from pyproj import Transformer
from rasterio.windows import from_bounds

OUT = Path(__file__).resolve().parents[1] / "raw" / "stations"
MRDEM = "https://canelevation-dem.s3.ca-central-1.amazonaws.com/mrdem-30/mrdem-30-dtm.tif"
local = threading.local()


def dataset():
    if not hasattr(local, "d"):
        local.d = rasterio.open(MRDEM)
        local.t = Transformer.from_crs(4326, local.d.crs, always_xy=True)
    return local.d, local.t


def measure(item: tuple[str, dict]) -> dict | None:
    sid, s = item
    try:
        d, t = dataset()
        x, y = t.transform(s["lon"], s["lat"])
        a = d.read(1, window=from_bounds(x - 3000, y - 3000, x + 3000, y + 3000, d.transform), boundless=True, fill_value=-32767).astype("float32")
    except Exception:  # noqa: BLE001  (off the MRDEM, or a read that failed: left out)
        return None
    a[a < -1000] = np.nan
    if np.isnan(a).mean() > 0.5:
        return None
    rows, cols = a.shape
    yy, xx = np.mgrid[:rows, :cols]
    r = np.hypot(yy - rows / 2, xx - cols / 2) * 30
    c = a[rows // 2, cols // 2]
    r3, r1 = a[r <= 3000], a[r <= 1000]
    return {"id": sid, "name": s["name"], "provider": s["provider"], "lat": s["lat"], "lon": s["lon"], "elev": round(float(c)),
            "relief3": round(float(np.nanmax(r3) - np.nanmin(r3))), "tpi1": round(float(c - np.nanmean(r1))), "rise3": round(float(np.nanmax(r3) - c))}


def main() -> None:
    stations = json.loads((OUT / "stations.json").read_text(encoding="utf-8"))
    with ThreadPoolExecutor(8) as ex:
        out = [r for r in ex.map(measure, stations.items()) if r]
    with open(OUT / "terrain.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(out[0].keys()))
        w.writeheader()
        w.writerows(out)
    print(f"{len(out)} of {len(stations)} stations measured -> {OUT / 'terrain.csv'}")


if __name__ == "__main__":
    main()
