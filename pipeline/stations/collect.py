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
    py -3.14 pipeline/stations/collect.py --low        # the gauge wind for kept days

Writes pipeline/raw/stations/:
  obs/<yyyy>/obs-<yyyymmdd>.csv.gz   one row per reading with wind:
      t        UTC, minute
      id       the station's msc_id (stations.json)
      dir, spd the wind at 10 m, from, degrees true, and km/h
      gust     the 10-minute maximum, km/h, where the station gives one
      temp     air temperature, C
      avg      what the wind is averaged over: 10m (minutes), 2m, 1m, 1h
      qa       the lower of the two quality flags (100 is good)
  stations.json    msc_id -> name, lat, lon, elev, prov, provider, last seen,
                   and snsrH, the wind sensor's true height in m where the
                   station reports it (wnd_snsr_vert_disp: the partners' "10m"
                   names are nominal; Parks Canada quick-deploy masts are 3-4 m,
                   BC roads 5-12 m)
  obs/<yyyy>/low-<yyyymmdd>.csv.gz   wind below or off the 10 m standard, one
      row per station and kind every 10 minutes (the readings on minutes 00,
      10, ...; one per station, time and kind, the quality-flagged one first):
      t, id    as above
      kind     gauge: the rain gauge's height (about 2 m), speed only, open
               sites (MSC's own stations, ~400 an hour);
               mast: a partner's wind under the keys with no height in them
               (Parks Canada, BC roads, the Yukon), with its true height (h),
               which the 10 m file never read (2026-10-16)
      h        the sensor's height, m, where reported
      dir      from, degrees true (mast only)
      spd      the 10-minute mean, km/h
      qa       its quality flag
      spd10    the same reading's 10 m mean, km/h, where it has one
      (2026-10-16: nothing archives these, so the collector does; with --low
      the days already kept get theirs while they are still in the window)
  low-stations.json  the same facts for the stations in the low files
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
    "wnd_snsr_vert_disp-value", "avg_wnd_spd_pcpn_gag_pst10mts", "avg_wnd_spd_pcpn_gag_pst10mts-qa",
    "avg_wnd_spd_pst10mts", "avg_wnd_spd_pst10mts-qa", "avg_wnd_dir_pst10mts", "avg_wnd_dir_pst10mts-qa",
]
# what the gauge-height file asks for on its own (--low)
LOW_ONLY = ["msc_id-value", "stn_nam-value", "prov-value", "data_pvdr-value", "date_tm-value", "avg_wnd_spd_10m_pst10mts",
            "wnd_snsr_vert_disp-value", "avg_wnd_spd_pcpn_gag_pst10mts", "avg_wnd_spd_pcpn_gag_pst10mts-qa",
            "avg_wnd_spd_pst10mts", "avg_wnd_spd_pst10mts-qa", "avg_wnd_dir_pst10mts", "avg_wnd_dir_pst10mts-qa"]
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


def hour_features(start: datetime, fields: list[str] = FIELDS) -> list[dict]:
    """Every reading in one UTC hour, page by page."""
    end = start + timedelta(hours=1) - timedelta(seconds=1)
    span = f"{start:%Y-%m-%dT%H:%M:%SZ}/{end:%Y-%m-%dT%H:%M:%SZ}"
    feats: list[dict] = []
    offset = 0
    while True:
        d = fetch({"f": "json", "bbox": CANADA, "datetime": span, "limit": PAGE, "offset": offset, "properties": ",".join(fields)})
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
        row = [p["date_tm-value"][:16] + "Z", sid, d, v, p.get("max_wnd_spd_10m_pst10mts"), p.get("air_temp"), avg, min(qa) if qa else None]
        return row, station_facts(f)
    return None


def station_facts(f: dict) -> dict:
    p = f["properties"]
    c = f["geometry"]["coordinates"]
    stn = {"name": p.get("stn_nam-value"), "lat": round(c[1], 5), "lon": round(c[0], 5), "elev": round(c[2], 1) if len(c) > 2 and c[2] is not None else None, "prov": p.get("prov-value"), "provider": p.get("data_pvdr-value")}
    h = p.get("wnd_snsr_vert_disp-value")
    try:
        if h is not None:
            stn["snsrH"] = float(h)
    except (TypeError, ValueError):
        pass
    return stn


def low_readings(f: dict) -> tuple[list[list], dict] | None:
    """A reading's low winds on a whole ten minutes (the gauge's, a height-tagged mast's), as rows and its station's facts."""
    p = f["properties"]
    t = p.get("date_tm-value") or ""
    sid = p.get("msc_id-value") or p.get("stn_nam-value")
    if not sid or len(t) < 16 or t[15] != "0":
        return None
    facts = station_facts(f)
    tz, spd10, h = t[:16] + "Z", p.get("avg_wnd_spd_10m_pst10mts"), facts.get("snsrH")
    rows = []
    if p.get("avg_wnd_spd_pcpn_gag_pst10mts") is not None:
        rows.append([tz, sid, "gauge", None, None, p["avg_wnd_spd_pcpn_gag_pst10mts"], p.get("avg_wnd_spd_pcpn_gag_pst10mts-qa"), spd10])
    if p.get("avg_wnd_spd_pst10mts") is not None:
        qa = [q for q in (p.get("avg_wnd_spd_pst10mts-qa"), p.get("avg_wnd_dir_pst10mts-qa")) if q is not None]
        rows.append([tz, sid, "mast", h, p.get("avg_wnd_dir_pst10mts"), p["avg_wnd_spd_pst10mts"], min(qa) if qa else None, spd10])
    return (rows, facts) if rows else None


def low_path(day: date) -> Path:
    return OUT / "obs" / f"{day:%Y}" / f"low-{day:%Y%m%d}.csv.gz"


def write_low(day: date, rows: list[list]) -> Path:
    path = low_path(day)
    path.parent.mkdir(parents=True, exist_ok=True)
    # the feed sends some readings twice, with and without the quality flag: keep one, the flagged first
    best: dict[tuple, list] = {}
    for r in rows:
        k = (r[0], r[1], r[2])
        if k not in best or (best[k][6] in (None, "") and r[6] not in (None, "")):
            best[k] = r
    rows = sorted(best.values(), key=lambda r: (r[0], r[1], r[2]))
    tmp = path.with_suffix(".tmp")
    with gzip.open(tmp, "wt", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["t", "id", "kind", "h", "dir", "spd", "qa", "spd10"])
        w.writerows(rows)
    tmp.replace(path)
    return path


def keep(stations: dict, sid: str, facts: dict, day: date) -> None:
    """A station's facts as last seen, keeping a sensor height once reported."""
    old = stations.get(sid) or {}
    new = {**facts, "seen": day.isoformat()}
    if "snsrH" not in new and "snsrH" in old:
        new["snsrH"] = old["snsrH"]
    stations[sid] = new


def collect_low_day(day: date, low_stations: dict) -> tuple[Path, int]:
    """Only the gauge-height wind of a day already kept (--low)."""
    rows: list[list] = []
    t0 = time.time()
    for h in range(24):
        start = datetime(day.year, day.month, day.day, h, tzinfo=timezone.utc)
        for f in hour_features(start, LOW_ONLY):
            r = low_readings(f)
            if r:
                rows += r[0]
                keep(low_stations, r[0][0][1], r[1], day)
        time.sleep(0.5)
    path = write_low(day, rows)
    print(f"  {day}: {len(rows):,} low readings ({sum(r[2] == 'mast' for r in rows):,} masts), {len({r[1] for r in rows})} stations, {path.stat().st_size / 1e6:.1f} MB · {time.time() - t0:.0f} s", flush=True)
    return path, len(rows)


def collect_day(day: date, stations: dict, low_stations: dict | None = None) -> tuple[Path, int]:
    path = OUT / "obs" / f"{day:%Y}" / f"obs-{day:%Y%m%d}.csv.gz"
    path.parent.mkdir(parents=True, exist_ok=True)
    rows: list[list] = []
    low: list[list] = []
    t0 = time.time()
    for h in range(24):
        start = datetime(day.year, day.month, day.day, h, tzinfo=timezone.utc)
        for f in hour_features(start):
            r = reading(f)
            if r:
                rows.append(r[0])
                keep(stations, r[0][1], r[1], day)
            lr = low_readings(f)
            if lr and low_stations is not None:
                low += lr[0]
                keep(low_stations, lr[0][0][1], lr[1], day)
        time.sleep(0.5)  # gently: the API is a shared public service
    if low_stations is not None:
        write_low(day, low)
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
    ap.add_argument("--low", action="store_true", help="only the gauge-height wind, for kept days in the window that have no low file")
    args = ap.parse_args()
    if args.r2:
        sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "app" / "scripts"))
        import r2_sync  # noqa: E402  (the machines' upload hold)

        if h := r2_sync.held():
            print(f"uploads held ({h}): kept here, not sent to R2", flush=True)
            args.r2 = False
    OUT.mkdir(parents=True, exist_ok=True)
    done_path, stn_path = OUT / "done.json", OUT / "stations.json"
    done = set(json.loads(done_path.read_text())) if done_path.exists() else set()
    stations = json.loads(stn_path.read_text(encoding="utf-8")) if stn_path.exists() else {}
    low_stn_path = OUT / "low-stations.json"
    low_stations = json.loads(low_stn_path.read_text(encoding="utf-8")) if low_stn_path.exists() else {}
    today = datetime.now(timezone.utc).date()
    # whole days only; the oldest is left out, as the API trims it while we read
    window = [today - timedelta(days=n) for n in range(WINDOW_DAYS - 1, 0, -1)]
    if args.low:
        return low_backfill(window, low_stations, low_stn_path, args.r2)
    todo = [datetime.strptime(d, "%Y%m%d").date() for d in args.day] if args.day else [d for d in window if d.isoformat() not in done]
    print(f"{datetime.now():%Y-%m-%d %H:%M} stations: {len(done)} days kept, {len(todo)} to fetch", flush=True)
    r2 = r2_client() if args.r2 and todo else None
    new, failed = 0, []
    for day in todo:
        try:
            path, n = collect_day(day, stations, low_stations)
        except Exception as e:  # noqa: BLE001  (left for the next run while it is in the window)
            print(f"  {day}: failed, {e}", flush=True)
            failed.append(day.isoformat())
            continue
        done.add(day.isoformat())
        done_path.write_text(json.dumps(sorted(done)))
        stn_path.write_text(json.dumps(stations, ensure_ascii=False, sort_keys=True), encoding="utf-8")
        low_stn_path.write_text(json.dumps(low_stations, ensure_ascii=False, sort_keys=True), encoding="utf-8")
        new += 1
        if r2:
            r2.upload_file(str(path), R2_BUCKET, f"stations/obs/{day:%Y}/{path.name}", ExtraArgs={"ContentType": "application/gzip"})
            lp = low_path(day)
            if lp.exists():
                r2.upload_file(str(lp), R2_BUCKET, f"stations/obs/{day:%Y}/{lp.name}", ExtraArgs={"ContentType": "application/gzip"})
    if r2 and new:
        r2.put_object(Bucket=R2_BUCKET, Key="stations/stations.json", Body=stn_path.read_bytes(), ContentType="application/json")
        r2.put_object(Bucket=R2_BUCKET, Key="stations/low-stations.json", Body=low_stn_path.read_bytes(), ContentType="application/json")
    line = f"{datetime.now():%Y-%m-%d %H:%M} {new} new day(s), {len(failed)} failed{' ' + ','.join(failed) if failed else ''}, {len(done)} kept, {len(stations)} stations{', R2' if r2 and new else ''}"
    with open(OUT / "collect.log", "a", encoding="utf-8") as fh:
        fh.write(line + "\n")
    print(line)
    return 1 if failed else 0


def low_backfill(window: list[date], low_stations: dict, low_stn_path: Path, to_r2: bool) -> int:
    """The gauge-height wind for the window's days that have none yet: obs files, done.json and stations.json untouched."""
    todo = [d for d in window if not low_path(d).exists()]
    print(f"{datetime.now():%Y-%m-%d %H:%M} gauge-height wind: {len(todo)} days to fetch", flush=True)
    r2 = r2_client() if to_r2 and todo else None
    new, failed = 0, []
    for day in todo:
        try:
            path, _ = collect_low_day(day, low_stations)
        except Exception as e:  # noqa: BLE001
            print(f"  {day}: failed, {e}", flush=True)
            failed.append(day.isoformat())
            continue
        low_stn_path.write_text(json.dumps(low_stations, ensure_ascii=False, sort_keys=True), encoding="utf-8")
        new += 1
        if r2:
            r2.upload_file(str(path), R2_BUCKET, f"stations/obs/{day:%Y}/{path.name}", ExtraArgs={"ContentType": "application/gzip"})
    if r2 and new:
        r2.put_object(Bucket=R2_BUCKET, Key="stations/low-stations.json", Body=low_stn_path.read_bytes(), ContentType="application/json")
    line = f"{datetime.now():%Y-%m-%d %H:%M} low: {new} new day(s), {len(failed)} failed{' ' + ','.join(failed) if failed else ''}, {len(low_stations)} gauge stations{', R2' if r2 and new else ''}"
    with open(OUT / "collect.log", "a", encoding="utf-8") as fh:
        fh.write(line + "\n")
    print(line)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
