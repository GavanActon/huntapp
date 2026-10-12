"""The forecast the phone had, at every collected station: HRDPS (2.5 km)
from Open-Meteo's historical-forecast API, which stitches the first hours of
each run, hour by hour, for the days the station readings cover. The first
column of the scoreboard (docs/WIND-LEARNING.md, "Stations").

    py -3.14 pipeline/stations/hrdps.py                 # every kept day
    py -3.14 pipeline/stations/hrdps.py --start 20260912 --end 20261010

Reads pipeline/raw/stations/stations.json and done.json (collect.py);
writes pipeline/raw/stations/hrdps/hrdps-<start>-<end>.csv.gz with id, t
(UTC hour), dir (from, degrees), spd (km/h, 10 m). Stations outside HRDPS's
domain come back empty and are left out. Asks 50 stations at a time, with
a pause between, inside the free API's limits.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / "raw" / "stations"
API = "https://historical-forecast-api.open-meteo.com/v1/forecast"
BATCH = 50


def fetch(stations: list[tuple[str, dict]], start: str, end: str, tries: int = 6) -> list[dict]:
    q = {
        "latitude": ",".join(f"{s['lat']:.4f}" for _, s in stations),
        "longitude": ",".join(f"{s['lon']:.4f}" for _, s in stations),
        "hourly": "wind_speed_10m,wind_direction_10m",
        "models": "gem_hrdps_continental",
        "start_date": start,
        "end_date": end,
        "timezone": "GMT",
    }
    url = API + "?" + urllib.parse.urlencode(q)
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "groundwind-stations"}), timeout=180) as r:
                d = json.loads(r.read())
            return d if isinstance(d, list) else [d]
        except urllib.error.HTTPError as e:
            wait = 60 if e.code == 429 else 10 * 2**i
            print(f"    HTTP {e.code}; again in {wait} s", flush=True)
            time.sleep(wait)
        except (urllib.error.URLError, TimeoutError) as e:
            print(f"    {e}; again in {10 * 2**i} s", flush=True)
            time.sleep(10 * 2**i)
    raise RuntimeError("the API kept refusing")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--start", help="yyyymmdd (default: the first kept day)")
    ap.add_argument("--end", help="yyyymmdd (default: the last kept day)")
    args = ap.parse_args()
    days = sorted(json.loads((OUT / "done.json").read_text()))
    start = (args.start and f"{args.start[:4]}-{args.start[4:6]}-{args.start[6:]}") or days[0]
    end = (args.end and f"{args.end[:4]}-{args.end[4:6]}-{args.end[6:]}") or days[-1]
    stations = sorted(json.loads((OUT / "stations.json").read_text(encoding="utf-8")).items())
    out = OUT / "hrdps" / f"hrdps-{start.replace('-', '')}-{end.replace('-', '')}.csv.gz"
    out.parent.mkdir(parents=True, exist_ok=True)
    print(f"HRDPS {start}..{end} at {len(stations)} stations, {BATCH} a request", flush=True)
    rows = kept = 0
    t0 = time.time()
    tmp = out.with_suffix(".tmp")
    with gzip.open(tmp, "wt", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["id", "t", "dir", "spd"])
        for i in range(0, len(stations), BATCH):
            chunk = stations[i : i + BATCH]
            res = fetch(chunk, start, end)
            for (sid, _), loc in zip(chunk, res):
                h = loc.get("hourly") or {}
                n = 0
                for t, sp, d in zip(h.get("time", []), h.get("wind_speed_10m", []), h.get("wind_direction_10m", [])):
                    if sp is None or d is None:
                        continue
                    w.writerow([sid, t + "Z", d, sp])
                    n += 1
                rows += n
                kept += n > 0
            print(f"  {min(i + BATCH, len(stations))}/{len(stations)} stations · {rows:,} hours · {time.time() - t0:.0f} s", flush=True)
            time.sleep(8)
    tmp.replace(out)
    print(f"{kept} of {len(stations)} stations inside HRDPS · {rows:,} hours -> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
