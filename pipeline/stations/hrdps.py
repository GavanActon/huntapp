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

    py -3.14 pipeline/stations/hrdps.py --extra

--extra fetches the same hours' air instead, for the station correction
(correct.py): the wind at 80 and 120 m (km/h), the temperature at 2, 80 and
120 m (°C, the 120 m less the 2 m being the forecast's own inversion),
cloud cover (%) and sunshine (W/m²), into hrdps-extra-<start>-<end>.csv.gz.
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
WIND = {"dir": "wind_direction_10m", "spd": "wind_speed_10m"}
EXTRA = {"ws80": "wind_speed_80m", "ws120": "wind_speed_120m", "t2": "temperature_2m", "t80": "temperature_80m",
         "t120": "temperature_120m", "cloud": "cloud_cover", "sw": "shortwave_radiation"}


def fetch(stations: list[tuple[str, dict]], start: str, end: str, hourly: dict[str, str] = WIND, tries: int = 6) -> list[dict]:
    q = {
        "latitude": ",".join(f"{s['lat']:.4f}" for _, s in stations),
        "longitude": ",".join(f"{s['lon']:.4f}" for _, s in stations),
        "hourly": ",".join(hourly.values()),
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
    ap.add_argument("--extra", action="store_true", help="the air aloft, temperatures and cloud instead of the 10 m wind")
    args = ap.parse_args()
    days = sorted(json.loads((OUT / "done.json").read_text()))
    start = (args.start and f"{args.start[:4]}-{args.start[4:6]}-{args.start[6:]}") or days[0]
    end = (args.end and f"{args.end[:4]}-{args.end[4:6]}-{args.end[6:]}") or days[-1]
    stations = sorted(json.loads((OUT / "stations.json").read_text(encoding="utf-8")).items())
    hourly = EXTRA if args.extra else WIND
    out = OUT / "hrdps" / f"hrdps{'-extra' if args.extra else ''}-{start.replace('-', '')}-{end.replace('-', '')}.csv.gz"
    out.parent.mkdir(parents=True, exist_ok=True)
    print(f"HRDPS {start}..{end} at {len(stations)} stations, {BATCH} a request", flush=True)
    rows = kept = 0
    t0 = time.time()
    tmp = out.with_suffix(".tmp")
    with gzip.open(tmp, "wt", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["id", "t", *hourly])
        for i in range(0, len(stations), BATCH):
            chunk = stations[i : i + BATCH]
            res = fetch(chunk, start, end, hourly)
            for (sid, _), loc in zip(chunk, res):
                h = loc.get("hourly") or {}
                n = 0
                for t, *vals in zip(h.get("time", []), *(h.get(v, []) for v in hourly.values())):
                    if any(x is None for x in vals):
                        continue
                    w.writerow([sid, t + "Z", *vals])
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
