"""The HD wind at US stations inside the seed boxes (the terrain number
hd_at.py could not give: only three Canadian stations fell inside any box,
all on flat ground). Gavan, 2026-10-13: how accurate is HD at the weather
sites.

    py -3.14 pipeline/stations/us_hd.py [--run seed2-all] [--start 2026-09-12 --end 2026-10-11]

The six stations with wind that IEM (Iowa Environmental Mesonet) archives
inside the 17 US boxes, over the same 29 days the ECCC scoreboard covers:
ASOS/AWOS (knots), RWIS (road weather, knots) and HADS DCP (satellite-
relayed stations, SHEF wind in mph). The forecast is HRRR (CONUS) from
Open-Meteo's past forecasts, HRDPS at Poker Flat (HRRR CONUS stops short
of Alaska). Then, as hd_at.py does: WindNinja's momentum field at the
station's 30 m cell (pipeline/raw/surrogate/<box>.npz, turned to true
north) and the SD net run over the same box (in-sample: it trained on these
boxes), each turning and scaling the forecast; score.py's measures, and the
gap between the net and its teacher at the station, by the ground round it
(the box's own 30 m DEM: relief within 3 km, height against the 1 km mean,
slope over 150 m).

Writes pipeline/raw/stations/us/ (the readings and forecasts, kept) and
pipeline/raw/stations/hd-score-us.md.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import math
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
from pyproj import Transformer
from scipy import ndimage

HERE = Path(__file__).resolve().parent
PIPE = HERE.parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(PIPE / "surrogate"))
from score import MIN_KMH, OUT, sd_call  # noqa: E402
from surrogate_at import DIRS, RUNS, to_true_north  # noqa: E402

US = OUT / "us"
FIELDS = PIPE / "raw" / "surrogate"
IEM = "https://mesonet.agron.iastate.edu/cgi-bin/request"
OM = "https://historical-forecast-api.open-meteo.com/v1/forecast"
KN = 1.852
MPH = 1.609344

# the six IEM stations with wind inside a US box (found 2026-10-13 from the
# IEM network lists; the rest are river gauges or ended)
STATIONS = [
    {"id": "4S2", "kind": "asos", "net": "OR_ASOS", "box": "seed-gorge-or", "name": "Hood River airport (Columbia Gorge)", "lat": 45.6727, "lon": -121.5363},
    {"id": "CO045", "kind": "rwis", "net": "CO_RWIS", "box": "seed-rmnp-co", "name": "Lily Lake road weather (Estes Park, 2,700 m)"},
    {"id": "CMTA4", "kind": "dcp", "net": "AR_DCP", "box": "seed-buffalo-ar", "name": "Compton RAWS (Ozarks)"},
    {"id": "CLJT2", "kind": "dcp", "net": "TX_DCP", "box": "seed-hillcountry-tx", "name": "Hunt (Texas Hill Country)"},
    {"id": "CPKA2", "kind": "dcp", "net": "AK_DCP", "box": "seed-pokerflat-ak", "name": "Poker Creek RAWS (Alaska)", "model": "gem_hrdps_continental"},
    {"id": "PPQ", "kind": "asos", "net": "IL_ASOS", "box": "seed-pike-il", "name": "Pittsfield airport (Illinois, flat)"},
]


def get(url: str, tries: int = 6, timeout: int = 180) -> bytes:
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "groundwind-stations"}), timeout=timeout) as r:
                return r.read()
        except (urllib.error.URLError, TimeoutError) as e:
            wait = 15 * (i + 1)
            print(f"    {str(e)[:80]}; again in {wait} s", flush=True)
            time.sleep(wait)
    raise RuntimeError(f"gave up on {url[:120]}")


def locate(st: dict) -> None:
    """Fill a station's lat/lon from its IEM network list where not given."""
    if "lat" in st:
        return
    feats = json.loads(get(f"https://mesonet.agron.iastate.edu/geojson/network/{st['net']}.geojson"))["features"]
    f = next(f for f in feats if f["id"] == st["id"])
    st["lon"], st["lat"] = f["geometry"]["coordinates"][:2]


def readings(st: dict, start: str, end: str) -> list[tuple[datetime, float, float]]:
    """(UTC time, dir from, km/h), every reading in the window, kept in raw/stations/us."""
    path = US / f"obs-{st['id']}-{start}-{end}.csv"
    if not path.exists():
        sts, ets = f"{start}T00:00Z", f"{end}T23:59Z"
        if st["kind"] == "asos":
            a, b = datetime.fromisoformat(start), datetime.fromisoformat(end)
            url = (f"{IEM}/asos.py?station={st['id']}&data=drct&data=sknt&year1={a.year}&month1={a.month}&day1={a.day}"
                   f"&year2={b.year}&month2={b.month}&day2={b.day + 1}&tz=Etc/UTC&format=onlycomma&latlon=no&report_type=3&report_type=4")
        elif st["kind"] == "rwis":
            url = f"{IEM}/rwis.py?network={st['net']}&stations={st['id']}&sts={sts}&ets={ets}&vars=sknt&vars=drct&what=txt&delim=comma&tz=UTC"
        else:
            url = f"{IEM}/hads.py?stations={st['id']}&sts={sts}&ets={ets}&what=txt&delim=comma"
        US.mkdir(parents=True, exist_ok=True)
        path.write_bytes(get(url))
    rows = list(csv.reader(io.StringIO(path.read_text(encoding="utf-8", errors="replace"))))
    hdr, out = rows[0], []
    for r in rows[1:]:
        rec = dict(zip(hdr, r))
        try:
            if st["kind"] in ("asos", "rwis"):
                t = datetime.fromisoformat((rec.get("valid") or rec.get("obtime"))[:16]).replace(tzinfo=timezone.utc)
                d, s = float(rec["drct"]), float(rec["sknt"]) * KN
            else:
                t = datetime.fromisoformat(rec["utc_valid"][:16]).replace(tzinfo=timezone.utc)
                d = float(next(v for k, v in rec.items() if k.startswith("UD") and v not in ("", "M")))
                s = float(next(v for k, v in rec.items() if k.startswith("US") and v not in ("", "M"))) * MPH
        except (ValueError, KeyError, StopIteration, TypeError):
            continue
        if 0 <= d <= 360 and 0 <= s < 200:
            out.append((t, d % 360, s))
    return out


def on_the_hour(obs: list[tuple[datetime, float, float]], within: float = 10) -> dict[str, tuple[float, float]]:
    """'YYYY-MM-DDTHH' -> (dir, km/h): the reading nearest each hour, within 10 minutes (score.py's
    rule), or `within` for a station that reports once an hour at its own minute (a RAWS at :23)."""
    best: dict[str, tuple[float, float, float]] = {}
    for t, d, s in obs:
        h = (t + timedelta(minutes=30)).replace(minute=0, second=0)
        off = abs((t - h).total_seconds()) / 60
        if off > within:
            continue
        k = h.strftime("%Y-%m-%dT%H")
        if k not in best or off < best[k][0]:
            best[k] = (off, d, s)
    return {k: (v[1], v[2]) for k, v in best.items()}


def forecast(st: dict, start: str, end: str) -> dict[str, tuple[float, float]]:
    model = st.get("model", "ncep_hrrr_conus")
    path = US / f"fc-{st['id']}-{model}-{start}-{end}.json"
    if not path.exists():
        q = {"latitude": f"{st['lat']:.4f}", "longitude": f"{st['lon']:.4f}", "hourly": "wind_speed_10m,wind_direction_10m",
             "models": model, "start_date": start, "end_date": end, "timezone": "GMT", "wind_speed_unit": "kmh"}
        path.write_bytes(get(OM + "?" + urllib.parse.urlencode(q)))
    h = json.loads(path.read_text()).get("hourly") or {}
    return {t[:13]: (d, s) for t, s, d in zip(h.get("time", []), h.get("wind_speed_10m", []), h.get("wind_direction_10m", [])) if s is not None and d is not None}


def box_fields(box: str, cells: list[tuple[int, int]], run: str) -> tuple[list[dict], list[dict], dict]:
    """WindNinja's and the net's responses at the cells (true east, north, units of the ambient), and the box's meta."""
    import torch

    from fields import load_area, predict_domain
    from train import load_checkpoint

    z = np.load(FIELDS / f"{box}.npz", allow_pickle=False)
    meta = json.loads(str(z["meta"]))
    g = float(meta.get("gridConvergenceDeg", 0.0))
    hd = []
    for r, c in cells:
        tu, tv = to_true_north(z["u"][:, r, c].astype(np.float64), z["v"][:, r, c].astype(np.float64), g)
        hd.append({"u": list(map(float, tu)), "v": list(map(float, tv))})
    device = "cuda" if torch.cuda.is_available() else "cpu"
    model, _ = load_checkpoint(RUNS / run / "ckpt.pt", device)
    area = load_area(box, FIELDS)
    pu, pv, _pt = predict_domain(model, area, DIRS, device=device, tta=True)
    sd = []
    for r, c in cells:
        tu, tv = to_true_north(pu[:, r, c].astype(np.float64), pv[:, r, c].astype(np.float64), area.conv)
        sd.append({"u": list(map(float, tu)), "v": list(map(float, tv))})
    return hd, sd, {"meta": meta, "dem": z["dem"].astype(np.float64)}


def ground(dem: np.ndarray, r: int, c: int, cell: float = 30.0) -> dict:
    rr, cc = np.mgrid[: dem.shape[0], : dem.shape[1]]
    dist = np.hypot(rr - r, cc - c) * cell
    z0 = dem[r, c]
    smooth = ndimage.uniform_filter(dem, 5)
    gy, gx = np.gradient(smooth, cell)
    return {"elev": round(float(z0)), "relief3": round(float(dem[dist <= 3000].max() - dem[dist <= 3000].min())),
            "tpi1": round(float(z0 - dem[dist <= 1000].mean())), "slope": round(float(np.degrees(np.arctan(np.hypot(gx[r, c], gy[r, c])))), 1)}


def summary(rows: list[dict], key: str) -> dict | None:
    vane = [x for x in rows if x["obsSpd"] >= MIN_KMH]
    if len(vane) < 20:
        return None
    miss = np.array([abs((x[f"{key}Dir"] - x["obsDir"] + 180) % 360 - 180) for x in vane])
    rv = np.array([x[f"{key}Spd"] / x["obsSpd"] for x in vane])
    ra = np.array([(x[f"{key}Spd"] + 1) / (x["obsSpd"] + 1) for x in rows])
    return {"n": len(vane), "hours": len(rows), "dir45": float(100 * np.mean(miss <= 45)), "dirMed": float(np.median(miss)),
            "spd2": float(100 * np.mean((rv >= 0.5) & (rv <= 2))), "spdMed": float(np.median(rv)),
            "spd2All": float(100 * np.mean((ra >= 0.5) & (ra <= 2))), "spdMedAll": float(np.median(ra))}


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--run", default="seed2-all")
    ap.add_argument("--start", default="2026-09-12")
    ap.add_argument("--end", default="2026-10-11")
    args = ap.parse_args()
    US.mkdir(parents=True, exist_ok=True)
    methods = {"fc": "forecast", "hd": "HD (WindNinja)", "sd": "SD net, damped 0.6", "sdRaw": "SD net, undamped"}
    by_box: dict[str, list[dict]] = {}
    for st in STATIONS:
        locate(st)
        by_box.setdefault(st["box"], []).append(st)
    allrows: list[dict] = []
    lines: list[str] = []
    gaps: list[str] = []
    for box, sts in by_box.items():
        z = np.load(FIELDS / f"{box}.npz", allow_pickle=False)
        meta = json.loads(str(z["meta"]))
        x0, y0, x1, y1 = meta["bounds"]
        tr = Transformer.from_crs(4326, int(meta["epsg"]), always_xy=True)
        cells = []
        for st in sts:
            x, y = tr.transform(st["lon"], st["lat"])
            cells.append((int((y1 - y) / 30.0), int((x - x0) / 30.0)))
        hd, sd, extra = box_fields(box, cells, args.run)
        for st, (r, c), h, s in zip(sts, cells, hd, sd):
            st["ground"] = ground(extra["dem"], r, c)
            obs = on_the_hour(readings(st, args.start, args.end), 30 if st["kind"] == "dcp" else 10)
            fc = forecast(st, args.start, args.end)
            rows = []
            for k, (od, os_) in obs.items():
                f = fc.get(k)
                if not f:
                    continue
                fd, fs = f
                row = {"obsDir": od, "obsSpd": os_, "fcDir": fd, "fcSpd": fs}
                row["hdDir"], row["hdSpd"] = sd_call(h, fd, fs, 1.0)
                row["sdDir"], row["sdSpd"] = sd_call(s, fd, fs, 0.6)
                row["sdRawDir"], row["sdRawSpd"] = sd_call(s, fd, fs, 1.0)
                rows.append(row)
            allrows += rows
            gd = st["ground"]
            label = f"{st['name']} ({gd['relief3']} m relief, {gd['slope']}° slope, {gd['tpi1']:+d} m vs 1 km)"
            print(f"  {st['id']}: {len(obs)} hours read, {len(rows)} with a forecast · {label}", flush=True)
            for key, name in methods.items():
                sm = summary(rows, key)
                if sm:
                    lines.append(f"| {label} | {name} | {sm['n']:,} / {sm['hours']:,} | {sm['dir45']:.0f}% | {sm['dirMed']:.0f}° | "
                                 f"{sm['spd2']:.0f}% · ×{sm['spdMed']:.2f} | {sm['spd2All']:.0f}% · ×{sm['spdMedAll']:.2f} |")
            if rows:
                turn = np.median([abs((x["sdDir"] - x["hdDir"] + 180) % 360 - 180) for x in rows])
                ratio = np.median([x["sdRawSpd"] / max(x["hdSpd"], 0.1) for x in rows])
                gaps.append(f"| {label} | {turn:.0f}° | ×{ratio:.2f} |")
    head = ["| station | call | hours (5 km/h+ / all) | dir within 45° | median miss | speed within ×2 · median, 5 km/h+ hours | the same, every hour |",
            "|---|---|---|---|---|---|---|"]
    pooled = []
    for key, name in methods.items():
        sm = summary(allrows, key)
        if sm:
            pooled.append(f"| all six | {name} | {sm['n']:,} / {sm['hours']:,} | {sm['dir45']:.0f}% | {sm['dirMed']:.0f}° | "
                          f"{sm['spd2']:.0f}% · ×{sm['spdMed']:.2f} | {sm['spd2All']:.0f}% · ×{sm['spdMedAll']:.2f} |")
    md = [f"# The HD wind at US stations inside the seed boxes (net {args.run}, {args.start} to {args.end})", "",
          "Forecast: HRRR CONUS (HRDPS at Poker Creek). HD: WindNinja momentum at the station's 30 m cell. "
          "The SD net trained on these boxes, so its rows are in-sample.", "", "## Pooled", "", *head, *pooled, "",
          "## Station by station", "", *head, *lines, "",
          "## The net against its teacher at the station (every hour)", "", "| station | median turn between the two | net's speed / teacher's |", "|---|---|---|", *gaps]
    text = "\n".join(md)
    print(text)
    (OUT / "hd-score-us.md").write_text(text + "\n", encoding="utf-8")
    (US / "stations.json").write_text(json.dumps(STATIONS, indent=1))
    return 0


if __name__ == "__main__":
    sys.exit(main())
