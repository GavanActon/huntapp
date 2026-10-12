"""The SD terrain wind at every station: the surrogate net (docs/SURROGATE.md)
run over a 15 x 15 km box of the 30 m MRDEM round each station, in its UTM
zone, and read at the station's own cell for the 16 directions. The second
column of the scoreboard (docs/WIND-LEARNING.md, "Stations"): HRDPS turned
and scaled by this, against HRDPS alone.

    py -3.14 pipeline/stations/surrogate_at.py [--run seed2-all] [--limit N]

Reads pipeline/raw/stations/terrain.csv (terrain.py: the stations on the
MRDEM); writes pipeline/raw/stations/surrogate-<run>.json, msc_id -> the net's
local wind at the station for a unit wind from each of the 16 directions,
as true east and north (`u`, `v`, in units of the ambient) and turbulence
(`t`), and the box's relief. Kept between runs: a station already there is
skipped. About 3 s a station on XEVO's GPU, most of it reading the MRDEM.

A station inside an area the net trained on is marked `inSample`.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import sys
import time
from pathlib import Path

import numpy as np
import rasterio
from pyproj import Transformer
from rasterio.transform import from_origin
from rasterio.warp import Resampling, reproject

HERE = Path(__file__).resolve().parent
PIPE = HERE.parent
sys.path.insert(0, str(PIPE / "surrogate"))
sys.path.insert(0, str(PIPE))

from fields import Area, fill_dem, grid_convergence, predict_domain, terrain_features  # noqa: E402

OUT = PIPE / "raw" / "stations"
RUNS = PIPE / "raw" / "surrogate" / "runs"
MRDEM = "https://canelevation-dem.s3.ca-central-1.amazonaws.com/mrdem-30/mrdem-30-dtm.tif"
CELL = 30.0
HALF = 7500.0
DIRS = [i * 22.5 for i in range(16)]


def to_true_north(u, v, gamma_deg: float):
    """As build_windsd.to_true_north: grid axes to true east and north."""
    g = math.radians(gamma_deg)
    c, s = math.cos(g), math.sin(g)
    return u * c + v * s, -u * s + v * c


def box(src, lon: float, lat: float):
    epsg = 32600 + int((lon + 180) // 6) + 1
    t = Transformer.from_crs(4326, epsg, always_xy=True)
    x, y = t.transform(lon, lat)
    x0, y1 = math.floor((x - HALF) / CELL) * CELL, math.ceil((y + HALF) / CELL) * CELL
    n = int(2 * HALF / CELL)
    dem = np.full((n, n), -9999, np.float32)
    reproject(rasterio.band(src, 1), dem, dst_transform=from_origin(x0, y1, CELL, CELL), dst_crs=f"EPSG:{epsg}", resampling=Resampling.bilinear, dst_nodata=-9999)
    r, c = int((y1 - y) / CELL), int((x - x0) / CELL)
    return dem, epsg, [x0, y1 - n * CELL, x0 + n * CELL, y1], (r, c)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--run", default="seed2-all", help="the net, runs/<run>/ckpt.pt (seed2-all: the serving net, all 35 areas)")
    ap.add_argument("--limit", type=int, help="this many stations, for a try")
    args = ap.parse_args()
    import torch
    from train import load_checkpoint

    device = "cuda" if torch.cuda.is_available() else "cpu"
    model, config = load_checkpoint(RUNS / args.run / "ckpt.pt", device)
    trained = set(config.get("train_areas") or [])
    # the trained areas' regions, to mark a station inside one
    areas = []
    for p in (PIPE.parent / "app" / "src" / "areas").glob("*.json"):
        a = json.loads(p.read_text(encoding="utf-8"))
        if a["id"] in trained:
            areas.append(a["region"])
    stations = list(csv.DictReader(open(OUT / "terrain.csv", encoding="utf-8")))
    path = OUT / f"surrogate-{args.run}.json"
    done = json.loads(path.read_text()) if path.exists() else {}
    todo = [s for s in stations if s["id"] not in done][: args.limit]
    print(f"net {args.run} on {device}; {len(todo)} stations to do, {len(done)} kept", flush=True)
    t0 = time.time()
    with rasterio.open(MRDEM) as src:
        for k, s in enumerate(todo):
            lon, lat = float(s["lon"]), float(s["lat"])
            try:
                dem, epsg, bounds, (r, c) = box(src, lon, lat)
            except Exception as e:  # noqa: BLE001
                print(f"  {s['id']}: no DEM ({e})", flush=True)
                continue
            if (dem == -9999).mean() > 0.2:
                continue  # mostly off the MRDEM (sea, border): not fit for the net
            dem = np.where(dem == -9999, np.nan, dem)
            R, C = dem.shape
            meta = {"epsg": epsg, "bounds": bounds}
            zeros = np.zeros((16, R, C), np.float32)
            dom = Area(name=s["id"], dem=fill_dem(dem), u=zeros, v=zeros, turb=zeros, directions=np.array(DIRS, np.float32),
                       core=np.ones((R, C), bool), valid=np.ones((R, C), bool), meta=meta, conv=grid_convergence(meta))
            dom.rel, dom.gx, dom.gy = terrain_features(dom.dem)
            pu, pv, pt = predict_domain(model, dom, DIRS, device=device, tta=True)
            tu, tv = to_true_north(pu[:, r, c], pv[:, r, c], dom.conv)
            inside = any(a["west"] <= lon <= a["east"] and a["south"] <= lat <= a["north"] for a in areas)
            done[s["id"]] = {"u": [round(float(x), 4) for x in tu], "v": [round(float(x), 4) for x in tv],
                             "t": [round(float(x), 4) for x in pt[:, r, c]], "relief": round(float(np.nanmax(dem) - np.nanmin(dem))),
                             "run": args.run, **({"inSample": True} if inside else {})}
            if (k + 1) % 25 == 0 or k + 1 == len(todo):
                path.write_text(json.dumps(done))
                rate = (time.time() - t0) / (k + 1)
                print(f"  {k + 1}/{len(todo)} · {rate:.1f} s a station · ~{rate * (len(todo) - k - 1) / 60:.0f} min left", flush=True)
    path.write_text(json.dumps(done))
    print(f"{len(done)} stations in {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
