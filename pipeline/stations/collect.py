"""Wind at every public weather station in Canada, kept day by day: the
scoreboard's truth (docs/WIND-LEARNING.md, "Data").

The source is Environment Canada's MSC GeoMet OGC API, collection
`swob-realtime`: the surface observations of ECCC's own stations and the
partners' networks (the provinces' fire weather networks, MTO road weather,
BC forestry, the Yukon's avalanche stations and more), about 970 stations
and 466,000 readings a day. It keeps the last 30 days and nothing older,
so this keeps them: each run fetches every whole UTC day of the window it
does not have yet, hour by hour (an hour is ~19,000 readings, two pages
of 10,000), and a day it missed is fetched next time, as long as it is
still in the window. Open data, Open Government Licence - Canada.

    py -3.14 pipeline/stations/collect.py              # fill the window
    py -3.14 pipeline/stations/collect.py --r2         # and copy new days to R2
    py -3.14 pipeline/stations/collect.py --day 20261010

Writes pipeline/raw/stations/:
  obs/<yyyy>/obs-<yyyymmdd>.csv.gz   one row per reading with wind:
      t        UTC, minute
      id       the station's msc_id (stations.json)
      dir, spd the wind at 10 m, from, degrees true, and km/h
      gust     the 10-minute maximum, km/h, where the station gives one
      temp     air temperature, C
      avg      what the wind is averaged over: 10m (minutes), 2m, 1m, 1h
      qa       the lower of the two quality flags (100 is good)
  stations.json    msc_id -> name, lat, lon, elev, prov, provider, last seen
  done.json        the days fetched whole
  collect.log      one line per run

With --r2 each new day and stations.json go to the R2 bucket
groundwind-data under stations/ (keys R2_ACCESS_KEY_ID and
R2_SECRET_ACCESS_KEY in the user's environment). The bucket is public
through data.groundwind.app; the data is open anyway.

Run daily by a Windows scheduled task on XEVO ("Groundwind stations"),
which runs late when the PC was off; with a 30-day window a few days off
lose nothing.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "raw" / "stations"
API = "https://api.weather.gc.ca/collections/swob-realtime/items"
CANADA = "-142,41,-52,84"
WINDOW_DAYS = 30  # what the API keeps
PAGE = 10000
# wind at 10 m by averaging period, the longest first: a station reports what
# it has, ECCC's often every minute with the 10-minute mean on some of them
WIND = [("10m", "pst10mts"), ("2m", "pst2mts"), ("1m", "pst1mt"), ("1h", "pst1hr")]
FIELDS = [
    "msc_id-value", "stn_nam-value", "prov-value", "data_pvdr-value", "date_tm-value",
    "max_wnd_spd_10m_pst10mts", "air_temp",
    *[f"avg_wnd_{k}_10m_{s}{q}" for _, s in WIND for k in ("dir", "spd") for q in ("", "-qa")],
]
R2_ENDPOINT = "https://ebcafd8e3dbdaad405e17dfb174c0f0f.r2.cloudflarestorage.com"
R2_BUCKET = "groundwind-data"


def fetch(params: dict, tries: int = 5) -> dict:
    url = API + "?" + urllib.parse.urlencode(params)
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "groundwind-stations"}), timeout=120) as r:
                return json.loads(r.read())
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
            if i == tries - 1:
                raise
            wait = 10 * 2**i
            print(f"    {e}; again in {wait} s", flush=True)
            time.sleep(wait)
    raise RuntimeError("unreachable")


def hour_features(start: datetime) -> list[dict]:
    """Every reading in one UTC hour, page by page."""
    end = start + timedelta(hours=1) - timedelta(seconds=1)
    span = f"{start:%Y-%m-%dT%H:%M:%SZ}/{end:%Y-%m-%dT%H:%M:%SZ}"
    feats: list[dict] = []
    offset = 0
    while True:
        d = fetch({"f": "json", "bbox": CANADA, "datetime": span, "limit": PAGE, "offset": offset, "properties": ",".join(FIELDS)})
        got = d.get("features", [])
        feats += got
        matched = d.get("numberMatched")
        offset += len(got)
        if not got or (matched is not None and offset >= matched) or len(got) < PAGE:
            return feats


def reading(f: dict) -> tuple[list, dict] | None:
    """A feature as a csv row and its station's facts, or None with no wind."""
    p = f["properties"]
    for avg, s in WIND:
        d, v = p.get(f"avg_wnd_dir_10m_{s}"), p.get(f"avg_wnd_spd_10m_{s}")
        if d is None or v is None:
            continue
        qa = [q for q in (p.get(f"avg_wnd_dir_10m_{s}-qa"), p.get(f"avg_wnd_spd_10m_{s}-qa")) if q is not None]
        sid = p.get("msc_id-value") or p.get("stn_nam-value")
        if not sid:
            return None
        c = f["geometry"]["coordinates"]
        row = [p["date_tm-value"][:16] + "Z", sid, d, v, p.get("max_wnd_spd_10m_pst10mts"), p.get("air_temp"), avg, min(qa) if qa else None]
        stn = {"name": p.get("stn_nam-value"), "lat": round(c[1], 5), "lon": round(c[0], 5), "elev": round(c[2], 1) if len(c) > 2 and c[2] is not None else None, "prov": p.get("prov-value"), "provider": p.get("data_pvdr-value")}
        return row, stn
    return None


def collect_day(day: date, stations: dict) -> tuple[Path, int]:
    path = OUT / "obs" / f"{day:%Y}" / f"obs-{day:%Y%m%d}.csv.gz"
    path.parent.mkdir(parents=True, exist_ok=True)
    rows: list[list] = []
    t0 = time.time()
    for h in range(24):
        start = datetime(day.year, day.month, day.day, h, tzinfo=timezone.utc)
        for f in hour_features(start):
            r = reading(f)
            if r:
                rows.append(r[0])
                stations[r[0][1]] = {**r[1], "seen": day.isoformat()}
        time.sleep(0.5)  # gently: the API is a shared public service
    rows.sort(key=lambda r: (r[0], r[1]))
    tmp = path.with_suffix(".tmp")
    with gzip.open(tmp, "wt", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["t", "id", "dir", "spd", "gust", "temp", "avg", "qa"])
        w.writerows(rows)
    tmp.replace(path)
    print(f"  {day}: {len(rows):,} readings, {len({r[1] for r in rows})} stations, {path.stat().st_size / 1e6:.1f} MB · {time.time() - t0:.0f} s", flush=True)
    return path, len(rows)


def r2_client():
    key, secret = os.environ.get("R2_ACCESS_KEY_ID"), os.environ.get("R2_SECRET_ACCESS_KEY")
    if not (key and secret) and sys.platform == "win32":
        # a shell started before the keys were set has none: read the user's own
        import winreg

        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment") as k:
            key = key or winreg.QueryValueEx(k, "R2_ACCESS_KEY_ID")[0]
            secret = secret or winreg.QueryValueEx(k, "R2_SECRET_ACCESS_KEY")[0]
    import boto3

    # the saved secret has a stray character at an end (65 for R2's 64)
    key, secret = (s.strip().strip('"').strip() for s in (key, secret))
    return boto3.client("s3", endpoint_url=R2_ENDPOINT, aws_access_key_id=key, aws_secret_access_key=secret, region_name="auto")


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--day", action="append", help="fetch this UTC day (yyyymmdd) again, whole")
    ap.add_argument("--r2", action="store_true", help="copy new days and stations.json to R2")
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    done_path, stn_path = OUT / "done.json", OUT / "stations.json"
    done = set(json.loads(done_path.read_text())) if done_path.exists() else set()
    stations = json.loads(stn_path.read_text(encoding="utf-8")) if stn_path.exists() else {}
    today = datetime.now(timezone.utc).date()
    # whole days only; the oldest is left out, as the API trims it while we read
    window = [today - timedelta(days=n) for n in range(WINDOW_DAYS - 1, 0, -1)]
    todo = [datetime.strptime(d, "%Y%m%d").date() for d in args.day] if args.day else [d for d in window if d.isoformat() not in done]
    print(f"{datetime.now():%Y-%m-%d %H:%M} stations: {len(done)} days kept, {len(todo)} to fetch", flush=True)
    r2 = r2_client() if args.r2 and todo else None
    new, failed = 0, []
    for day in todo:
        try:
            path, n = collect_day(day, stations)
        except Exception as e:  # noqa: BLE001  (left for the next run while it is in the window)
            print(f"  {day}: failed, {e}", flush=True)
            failed.append(day.isoformat())
            continue
        done.add(day.isoformat())
        done_path.write_text(json.dumps(sorted(done)))
        stn_path.write_text(json.dumps(stations, ensure_ascii=False, sort_keys=True), encoding="utf-8")
        new += 1
        if r2:
            r2.upload_file(str(path), R2_BUCKET, f"stations/obs/{day:%Y}/{path.name}", ExtraArgs={"ContentType": "application/gzip"})
    if r2 and new:
        r2.put_object(Bucket=R2_BUCKET, Key="stations/stations.json", Body=stn_path.read_bytes(), ContentType="application/json")
    line = f"{datetime.now():%Y-%m-%d %H:%M} {new} new day(s), {len(failed)} failed{' ' + ','.join(failed) if failed else ''}, {len(done)} kept, {len(stations)} stations{', R2' if r2 and new else ''}"
    with open(OUT / "collect.log", "a", encoding="utf-8") as fh:
        fh.write(line + "\n")
    print(line)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
