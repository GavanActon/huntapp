"""The forecast's doubt over several falls, nationally: how far the 10 m wind's
direction is off HRDPS, as the phone has it, on every Sep-Nov that Open-Meteo
keeps HRDPS for, at ECCC's climate stations in hunting country. One fall
(Sep 12 - Oct 10 2026, the swob-realtime scoreboard: score.py) gave the doubt
as sd(U) = 6 + 155/(1 + U/1.5) degrees at forecast speed U km/h, about 30%
more in stable air; this asks whether that holds year on year.

    py -3.14 pipeline/stations/history.py stations   # pick the stations
    py -3.14 pipeline/stations/history.py obs        # their hourly wind
    py -3.14 pipeline/stations/history.py forecast   # HRDPS at them
    py -3.14 pipeline/stations/history.py score      # the tables and the fit
    py -3.14 pipeline/stations/history.py all        # the four in turn

Every step keeps what it has and fetches only what is missing, so a run that
stops can be run again.

The truth is ECCC's climate archive, collection `climate-hourly` of the MSC
GeoMet OGC API (no key): the wind on the hour (direction in tens of degrees,
from; speed km/h; the 2-minute mean ending on the hour at most automatic
stations), its datetime filter in the station's local standard time, each
reading carrying its UTC_DATE, which is what is used. The partners' networks
(fire weather, road weather) are not in it; ECCC's own and NAV CANADA's are.

The stations (`stations`): every climate station with hourly data running
into the falls (the climate-stations collection, HAS_HOURLY_DATA=Y), its
ground cover from cover.csv where a collected SWOB station is the same site
(the same climate id, or within 0.5 km; 2 km with the same name), else
measured the same way (cover.py's measure, the NRCan 2020 land cover and
SCANFI). Hunting country is forest1k >= 0.3 and urban1k < 0.1 (cover.py),
as in this fall's fit; sites within 1 km of each other are one (an
airport's NAV CANADA and MSC sensors). The archive has only ~70 such sites,
so its edge (forest1k 0.1-0.3, urban1k < 0.1) is kept too, as a check on
cover, not in the fit. Kept as well, whatever their cover: every station
within 150 km of the areas (Pickle, Whitefish, Searchmont, Lac Bailey,
Duhamel), for their own table.

The forecast (`forecast`): HRDPS continental (gem_hrdps_continental) from
Open-Meteo's historical-forecast API (the first hours of each run, stitched
hour by hour, as hrdps.py), 10 m wind and the 2 and 80 m temperature, whose
difference is the forecast's own inversion. Its archive starts 2023-03-02,
so the falls are 2023, 2024, 2025 and 2026 (to two days ago); GEM regional
and global start 2022-11-23, so no GEM model has fall 2022. Asked 25
stations a request and paced under the free API's hourly allowance (a
station-fall weighs ~6.5 calls: 91 days is 6.5 fortnights).

The score (`score`): hourly pairs, direction error |wrap(obs - forecast)|
where the station measured 5 km/h or more; the median and the 68th
percentile (the half-width that holds 68%, a normal's 1 sd) by fall, by
forecast speed, by the forecast's stability (t80 - t2: < -0.5, -0.5..1,
> 1 K), by the sun (night < -6 deg, dawn and dusk between -6 and 8 deg,
before and after solar noon, day above), by region and near each area.
Then sd(U) = a + b/(1 + U/c), times m in stable hours (t80 - t2 > 1 K),
fitted as the 68th percentile itself (the pinball loss at 0.68 over every
pair, hunting country), on all falls pooled and leaving one fall out, with
the share of the left-out fall inside its sd (it should be near 68%); and
the same as a + b exp(-U/c), a form that holds 68% at every speed. Two
checks against this fall's fit: SWOB's readings and the archive's at the
same station-hours (does the truth change the number?), and this fall's
SWOB stations by network (score.py's truth, hrdps.py's forecast: are the
archive's stations the same kind as the fit's?).

Writes pipeline/raw/stations/history/:
  climate-stations-hourly.json  the climate stations with hourly data
  stations.csv                  every candidate, its cover, hunt/edge/near/kept
  obs/<year>/<climate id>.json.gz   the API's answer, as it came
  hrdps/<year>/b<nnn>.csv.gz    id, t (UTC hour), dir, spd, t2, t80
  pairs.csv.gz                  the scored hours
  fit.json                      the fits
and pipeline/raw/stations/history.md (the tables), and prints it.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import json
import math
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

OUT = Path(__file__).resolve().parents[1] / "raw" / "stations"
HIST = OUT / "history"
GEOMET = "https://api.weather.gc.ca/collections"
OPEN_METEO = "https://historical-forecast-api.open-meteo.com/v1/forecast"
MODEL = "gem_hrdps_continental"
HOURLY = {"dir": "wind_direction_10m", "spd": "wind_speed_10m", "t2": "temperature_2m", "t80": "temperature_80m"}
UA = {"User-Agent": "groundwind-stations (history.py)"}
HRDPS_FROM = date(2023, 3, 2)  # the first hour Open-Meteo has HRDPS for (probed 2026-10-16)
FALL = ((9, 1), (11, 30))
BATCH = 25
HOURLY_ALLOWANCE = 4000  # of the free API's 5,000 weighted calls an hour, the share this takes
MIN_KMH = 5.0
AREAS = {"Pickle": (48.93, -85.59), "Whitefish": (48.15, -80.82), "Searchmont": (46.77, -84.05),
         "Lac Bailey": (49.40, -69.55), "Duhamel": (46.10, -75.15)}
NEAR_KM = 150
REGION = {"ON": "ON", "QC": "QC", "AB": "prairies", "SK": "prairies", "MB": "prairies", "BC": "BC",
          "NB": "Atlantic", "NS": "Atlantic", "PE": "Atlantic", "NL": "Atlantic", "YT": "north", "NT": "north", "NU": "north"}
REGIONS = ["ON", "QC", "prairies", "BC", "Atlantic", "north"]
U_BINS = [0, 3, 5, 7.5, 10, 12.5, 15, 20, 25, 35, np.inf]
U_LABELS = ["0-3", "3-5", "5-7.5", "7.5-10", "10-12.5", "12.5-15", "15-20", "20-25", "25-35", "35+"]
TIERS = ["hunting country", "its edge (forest1k 0.1-0.3)", "open (near the areas only)"]
STAB_LABELS = ["< -0.5 K (mixed)", "-0.5..1 K (neutral)", "> 1 K (stable)"]
SUN_LABELS = ["night", "dawn", "day", "dusk"]
CURRENT = {"a": 6.0, "b": 155.0, "c": 1.5, "m": 1.3}  # this fall's fit, the one to beat
TAU = 0.68


# ---------------------------------------------------------------- helpers

def get_json(url: str, tries: int = 6, timeout: int = 180) -> dict | list:
    """GET with backoff: 10, 20, 40 ... s; a 429 waits longer."""
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            body = e.read()[:300].decode("utf-8", "replace")
            if e.code == 429 and "Daily" in body:
                raise RuntimeError(f"daily limit reached: {body}") from e
            if e.code == 400:
                raise RuntimeError(f"HTTP 400: {body}") from e
            wait = 300 * (i + 1) if e.code == 429 else 10 * 2**i
            print(f"    HTTP {e.code} {body[:120]!r}; again in {wait} s", flush=True)
            time.sleep(wait)
        except (urllib.error.URLError, TimeoutError, ConnectionError, json.JSONDecodeError) as e:
            wait = 10 * 2**i
            print(f"    {e}; again in {wait} s", flush=True)
            time.sleep(wait)
    raise RuntimeError(f"gave up on {url[:160]}")


def km(lat1, lon1, lat2, lon2):
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dl = np.radians(np.asarray(lon2) - lon1)
    c = np.sin(p1) * np.sin(p2) + np.cos(p1) * np.cos(p2) * np.cos(dl)
    return 6371.0 * np.arccos(np.clip(c, -1, 1))


def falls() -> dict[int, tuple[date, date]]:
    """Every Sep-Nov with HRDPS, the last cut at two days ago."""
    last = date.today() - timedelta(days=2)
    out = {}
    for y in range(HRDPS_FROM.year, last.year + 1):
        a, b = date(y, *FALL[0]), date(y, *FALL[1])
        if a < HRDPS_FROM or a > last:
            continue
        out[y] = (a, min(b, last))
    return out


def wrap(d):
    return (d + 180) % 360 - 180


def sun(t: pd.Series, lat: np.ndarray, lon: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Sun elevation (deg) and whether it is before solar noon: NOAA's simple
    position (score.py's sun_elev), on arrays."""
    doy = t.dt.dayofyear.to_numpy()
    hour = t.dt.hour.to_numpy() + t.dt.minute.to_numpy() / 60
    g = 2 * np.pi / 365 * (doy - 1 + (hour - 12) / 24)
    decl = (0.006918 - 0.399912 * np.cos(g) + 0.070257 * np.sin(g) - 0.006758 * np.cos(2 * g) + 0.000907 * np.sin(2 * g)
            - 0.002697 * np.cos(3 * g) + 0.00148 * np.sin(3 * g))
    eqt = 229.18 * (0.000075 + 0.001868 * np.cos(g) - 0.032077 * np.sin(g) - 0.014615 * np.cos(2 * g) - 0.040849 * np.sin(2 * g))
    tst = (hour * 60 + eqt + 4 * lon) % 1440
    ha = np.radians(tst / 4 - 180)
    la = np.radians(lat)
    cz = np.sin(la) * np.sin(decl) + np.cos(la) * np.cos(decl) * np.cos(ha)
    return np.degrees(np.arcsin(np.clip(cz, -1, 1))), tst < 720


# ---------------------------------------------------------------- stations

def step_stations() -> None:
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    import cover  # the same measure as cover.csv; imported, not changed

    HIST.mkdir(parents=True, exist_ok=True)
    cs_path = HIST / "climate-stations-hourly.json"
    if not cs_path.exists():
        d = get_json(f"{GEOMET}/climate-stations/items?f=json&limit=10000&HAS_HOURLY_DATA=Y")
        cs_path.write_text(json.dumps(d), encoding="utf-8")
    feats = json.loads(cs_path.read_text(encoding="utf-8"))["features"]
    fl = falls()
    first_fall, last_fall = min(fl.values())[0], max(fl.values())[1]
    cand = []
    for f in feats:
        p = f["properties"]
        if p.get("COUNTRY") not in (None, "CAN") or not f.get("geometry"):
            continue
        hf, hl = (p.get("HLY_FIRST_DATE") or "")[:10], (p.get("HLY_LAST_DATE") or "")[:10]
        if not hf or not hl or hl < first_fall.isoformat() or hf > last_fall.isoformat():
            continue
        lon, lat = f["geometry"]["coordinates"][:2]
        cand.append({"cid": p["CLIMATE_IDENTIFIER"], "name": p["STATION_NAME"], "prov": p["PROV_STATE_TERR_CODE"],
                     "region": REGION.get(p["PROV_STATE_TERR_CODE"], "?"), "lat": round(lat, 5), "lon": round(lon, 5),
                     "elev": p.get("ELEVATION"), "tz": p.get("TIMEZONE"), "hly_first": hf, "hly_last": hl})
    print(f"{len(cand)} climate stations with hourly data in {first_fall}..{last_fall}", flush=True)

    swob = json.loads((OUT / "stations.json").read_text(encoding="utf-8"))
    cov = {r["id"]: r for r in csv.DictReader(open(OUT / "cover.csv", encoding="utf-8"))}
    sids = [k for k in cov if k in swob]
    slat = np.array([swob[k]["lat"] for k in sids])
    slon = np.array([swob[k]["lon"] for k in sids])
    todo = []
    for c in cand:
        src = None
        if c["cid"] in cov:
            src = c["cid"]
        else:
            d = km(c["lat"], c["lon"], slat, slon)
            j = int(np.argmin(d))
            w0 = lambda s: (s or "").upper().replace("-", " ").split()[0] if (s or "").strip() else ""
            if d[j] <= 0.5 or (d[j] <= 2.0 and w0(c["name"]) == w0(swob[sids[j]]["name"])):
                src = sids[j]
        if src:
            r = cov[src]
            c.update(cover_src=src, forest1k=float(r["forest1k"]), urban1k=float(r["urban1k"]), forest300=float(r["forest300"]))
        else:
            todo.append(c)
    print(f"  cover from cover.csv for {len(cand) - len(todo)}; measuring {len(todo)} more (NRCan land cover, SCANFI)", flush=True)
    t0 = time.time()
    with ThreadPoolExecutor(8) as ex:
        for i, (c, r) in enumerate(zip(todo, ex.map(cover.measure, [(c["cid"], c) for c in todo])), 1):
            if r:
                c.update(cover_src="measured", forest1k=r["forest1k"], urban1k=r["urban1k"], forest300=r["forest300"])
            else:
                c.update(cover_src="", forest1k=None, urban1k=None, forest300=None)
            if i % 100 == 0:
                print(f"    {i}/{len(todo)} · {time.time() - t0:.0f} s", flush=True)

    for c in cand:
        c["hunt"] = c["forest1k"] is not None and c["forest1k"] >= 0.3 and c["urban1k"] < 0.1
        c["edge"] = c["forest1k"] is not None and 0.1 <= c["forest1k"] < 0.3 and c["urban1k"] < 0.1
        d = {a: float(km(c["lat"], c["lon"], la, lo)) for a, (la, lo) in AREAS.items()}
        a = min(d, key=d.get)
        c["near"], c["near_km"] = (a, round(d[a])) if d[a] <= NEAR_KM else ("", round(d[a]))
    # one station a site: of those within 1 km, the one whose hourly record spans the falls best
    def span(c):
        a = max(c["hly_first"], first_fall.isoformat())
        b = min(c["hly_last"], last_fall.isoformat())
        return (date.fromisoformat(b) - date.fromisoformat(a)).days
    order = sorted(cand, key=lambda c: (-span(c), c["cid"]))
    kept: list[dict] = []
    for c in order:
        twin = next((k for k in kept if km(c["lat"], c["lon"], k["lat"], k["lon"]) <= 1.0), None)
        c["twin_of"] = twin["cid"] if twin else ""
        if not twin:
            kept.append(c)
    for c in cand:
        c["kept"] = not c["twin_of"] and (c["hunt"] or c["edge"] or bool(c["near"]))
    keys = ["cid", "name", "prov", "region", "lat", "lon", "elev", "tz", "hly_first", "hly_last", "cover_src",
            "forest1k", "urban1k", "forest300", "hunt", "edge", "near", "near_km", "twin_of", "kept"]
    with open(HIST / "stations.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=keys)
        w.writeheader()
        w.writerows(sorted(cand, key=lambda c: c["cid"]))
    k = [c for c in cand if c["kept"]]
    print(f"{len(k)} kept: {sum(c['hunt'] for c in k)} in hunting country, {sum(c['edge'] for c in k)} at its edge, "
          f"{sum(bool(c['near']) and not c['hunt'] and not c['edge'] for c in k)} more near the areas", flush=True)
    for r in REGIONS:
        print(f"  {r}: {sum(c['hunt'] and c['region'] == r for c in k)} hunting country", flush=True)
    for a in AREAS:
        print(f"  near {a}: {sum(c['near'] == a for c in k)}", flush=True)


def kept_stations() -> list[dict]:
    rows = list(csv.DictReader(open(HIST / "stations.csv", encoding="utf-8")))
    for r in rows:
        r["lat"], r["lon"] = float(r["lat"]), float(r["lon"])
        r["hunt"], r["edge"], r["kept"] = r["hunt"] == "True", r["edge"] == "True", r["kept"] == "True"
    return [r for r in rows if r["kept"]]


# ---------------------------------------------------------------- obs

OBS_PROPS = "UTC_DATE,LOCAL_DATE,WIND_DIRECTION,WIND_DIRECTION_FLAG,WIND_SPEED,WIND_SPEED_FLAG"


def step_obs() -> None:
    st = kept_stations()
    t0 = time.time()
    n = got = 0
    for y, (a, b) in falls().items():
        d = HIST / "obs" / str(y)
        d.mkdir(parents=True, exist_ok=True)
        for s in st:
            if s["hly_last"] < a.isoformat() or s["hly_first"] > b.isoformat():
                continue
            p = d / f"{s['cid']}.json.gz"
            if p.exists():
                continue
            # local standard time, a day either side; the UTC hours are cut later
            lo, hi = a - timedelta(days=1), b + timedelta(days=1)
            feats: list = []
            offset = 0
            while True:
                q = {"CLIMATE_IDENTIFIER": s["cid"], "datetime": f"{lo}T00:00:00/{hi}T23:00:00", "f": "json",
                     "limit": 10000, "offset": offset, "properties": OBS_PROPS, "skipGeometry": "true", "sortby": "LOCAL_DATE"}
                r = get_json(f"{GEOMET}/climate-hourly/items?" + urllib.parse.urlencode(q))
                feats += r.get("features", [])
                if len(r.get("features", [])) < 10000:
                    break
                offset += 10000
                time.sleep(1)
            with gzip.open(p, "wt", encoding="utf-8") as fh:
                json.dump({"cid": s["cid"], "fall": y, "features": [f["properties"] for f in feats]}, fh)
            n += 1
            got += len(feats)
            if n % 25 == 0:
                print(f"  {y}: {n} station-falls · {got:,} hours · {time.time() - t0:.0f} s", flush=True)
            time.sleep(0.5)
    print(f"obs: {n} station-falls fetched · {got:,} hours · {time.time() - t0:.0f} s", flush=True)


def load_obs() -> pd.DataFrame:
    rows = []
    for p in sorted((HIST / "obs").glob("*/*.json.gz")):
        with gzip.open(p, "rt", encoding="utf-8") as fh:
            d = json.load(fh)
        for f in d["features"]:
            rows.append((d["cid"], d["fall"], f["UTC_DATE"], f["LOCAL_DATE"], f["WIND_DIRECTION"], f["WIND_DIRECTION_FLAG"],
                         f["WIND_SPEED"], f["WIND_SPEED_FLAG"]))
    df = pd.DataFrame(rows, columns=["cid", "fall", "utc", "local", "odir10", "dflag", "ospd", "sflag"])
    df["t"] = pd.to_datetime(df["utc"]).dt.floor("h")
    df["lst_off"] = (pd.to_datetime(df["local"]) - pd.to_datetime(df["utc"])).dt.total_seconds() / 3600
    return df


# ---------------------------------------------------------------- forecast

def step_forecast() -> None:
    st = kept_stations()
    for y, (a, b) in falls().items():
        d = HIST / "hrdps" / str(y)
        d.mkdir(parents=True, exist_ok=True)
        weight_each = max(1.0, (b - a).days / 14 + 1 / 14) * max(1.0, len(HOURLY) / 10)
        for i in range(0, len(st), BATCH):
            p = d / f"b{i // BATCH:03d}.csv.gz"
            if p.exists():
                continue
            chunk = st[i : i + BATCH]
            q = {"latitude": ",".join(f"{s['lat']:.4f}" for s in chunk), "longitude": ",".join(f"{s['lon']:.4f}" for s in chunk),
                 "hourly": ",".join(HOURLY.values()), "models": MODEL, "start_date": a.isoformat(), "end_date": b.isoformat(),
                 "timezone": "GMT"}
            t0 = time.time()
            res = get_json(OPEN_METEO + "?" + urllib.parse.urlencode(q))
            res = res if isinstance(res, list) else [res]
            n = kept = 0
            tmp = p.with_suffix(".tmp")
            with gzip.open(tmp, "wt", newline="", encoding="utf-8") as fh:
                w = csv.writer(fh)
                w.writerow(["id", "t", *HOURLY])
                for s, loc in zip(chunk, res):
                    h = loc.get("hourly") or {}
                    m = 0
                    for t, *vals in zip(h.get("time", []), *(h.get(v, []) for v in HOURLY.values())):
                        if vals[0] is None or vals[1] is None:
                            continue
                        w.writerow([s["cid"], t, *vals])
                        m += 1
                    n += m
                    kept += m > 0
            tmp.replace(p)
            weight = weight_each * len(chunk)
            pause = max(10.0, weight / HOURLY_ALLOWANCE * 3600 - (time.time() - t0))
            print(f"  {y} b{i // BATCH:03d}: {kept}/{len(chunk)} stations inside HRDPS · {n:,} hours · "
                  f"~{weight:.0f} calls · next in {pause:.0f} s", flush=True)
            time.sleep(pause)
    print("forecast: done", flush=True)


def load_forecast() -> pd.DataFrame:
    parts = []
    for p in sorted((HIST / "hrdps").glob("*/b*.csv.gz")):
        parts.append(pd.read_csv(p, dtype={"id": str}))
    df = pd.concat(parts, ignore_index=True).rename(columns={"id": "cid", "dir": "fdir", "spd": "fspd"})
    df["t"] = pd.to_datetime(df["t"])
    return df.drop_duplicates(["cid", "t"])


# ---------------------------------------------------------------- score

def sd_model(p, U, stable, form: str = "hyp"):
    """hyp (the form asked for): a + b/(1 + U/c); exp (an alternative that
    holds 68% at every speed): a + b exp(-U/c); times m in stable hours."""
    a, b, c, m = p
    base = a + b / (1 + U / c) if form == "hyp" else a + b * np.exp(-U / c)
    return base * np.where(stable, m, 1.0)


def pinball(p, U, stable, e, form="hyp", tau=TAU):
    a, b, c, m = p
    if c <= 0.05 or m <= 0.2 or a < 0 or b < 0:
        return 1e12
    r = e - sd_model(p, U, stable, form)
    return float(np.mean(np.maximum(tau * r, (tau - 1) * r)))


STARTS = {"hyp": ([6, 155, 1.5, 1.3], [10, 80, 4, 1.2], [15, 40, 8, 1.1], [3, 300, 0.6, 1.3]),
          "exp": ([12, 110, 3, 1.2], [8, 140, 2, 1.2], [15, 80, 5, 1.1])}


def fit(df: pd.DataFrame, with_m: bool = True, starts: list | None = None, form: str = "hyp") -> dict:
    from scipy.optimize import minimize

    U, e = df["fspd"].to_numpy(), df["err"].to_numpy()
    st = df["stable"].to_numpy() if with_m else np.zeros(len(df), bool)
    best = None
    for x0 in starts or STARTS[form]:
        r = minimize(lambda p: pinball(p if with_m else [*p[:3], 1.0], U, st, e, form), x0 if with_m else x0[:3], method="Nelder-Mead",
                     options={"maxiter": 4000, "xatol": 1e-3, "fatol": 1e-6})
        if best is None or r.fun < best.fun:
            best = r
    p = list(best.x) if with_m else [*best.x, 1.0]
    return {"form": form, "a": round(p[0], 2), "b": round(p[1], 1), "c": round(p[2], 3), "m": round(p[3], 3), "loss": round(best.fun, 4), "n": len(df)}


def sd_of(p: dict, U, stable):
    return sd_model([p["a"], p["b"], p["c"], p["m"]], np.asarray(U, float), np.asarray(stable, bool), p.get("form", "hyp"))


def inside(p: dict, df: pd.DataFrame) -> float:
    return float(100 * np.mean(df["err"].to_numpy() <= sd_of(p, df["fspd"].to_numpy(), df["stable"].to_numpy())))


def q(x, f):
    return float(np.quantile(x, f)) if len(x) else float("nan")


def cell(g: pd.DataFrame, min_n: int = 100) -> str:
    if len(g) < min_n:
        return "–"
    return f"{q(g['err'], 0.5):.0f}° / {q(g['err'], TAU):.0f}°"


def table(df: pd.DataFrame, col: str, labels: list, years: list[int], label_head: str) -> list[str]:
    head = f"| {label_head} | " + " | ".join(str(y) for y in years) + " | all falls | hours | sd(U)·m, pooled fit: inside |"
    out = [head, "|" + "---|" * (len(years) + 4)]
    for lab in labels:
        g = df[df[col] == lab]
        if not len(g):
            continue
        cells = [cell(g[g["fall"] == y]) for y in years]
        out.append(f"| {lab} | " + " | ".join(cells) + f" | {cell(g)} | {len(g):,} | {g['inside_pooled'].mean() * 100:.0f}% |")
    return out


def bridge(df: pd.DataFrame, st: dict) -> tuple[list[str], dict]:
    """This fall's SWOB readings (collect.py, the 10-minute mean on the hour
    where the station gives one) against the climate archive's at the same
    station-hours, both scored against the same HRDPS: what changing the
    truth does to the numbers, before comparing falls."""
    ids = {s["cover_src"]: c for c, s in st.items() if s.get("cover_src") not in ("", "measured", None)}
    rows = []
    for p in sorted((OUT / "obs").glob("*/obs-*.csv.gz")):
        with gzip.open(p, "rt", encoding="utf-8") as fh:
            for r in csv.DictReader(fh):
                if r["id"] in ids and r["t"][14:16] == "00" and r["qa"] in ("100", "") and r["dir"] and r["spd"]:
                    rows.append((ids[r["id"]], r["t"][:13], float(r["dir"]), float(r["spd"]), r["avg"]))
    if not rows:
        return [], {}
    sw = pd.DataFrame(rows, columns=["cid", "t", "sdir", "sspd", "avg"])
    sw["t"] = pd.to_datetime(sw["t"])
    sw = sw.sort_values("avg", key=lambda a: a.map({"10m": 0, "2m": 1, "1m": 2, "1h": 3})).drop_duplicates(["cid", "t"])
    b = df.merge(sw, on=["cid", "t"])
    b = b[(b["sspd"] >= MIN_KMH)].copy()
    if len(b) < 100:
        return [], {}
    b["serr"] = np.abs(wrap(b["sdir"] - b["fdir"]))
    out = ["## The truth changed: this fall's SWOB readings against the archive's, same hours", "",
           f"_SWOB on the hour (collect.py) and climate-hourly at the same station-hours, {b['t'].min():%b %d}–{b['t'].max():%b %d} "
           f"{b['t'].max():%Y}, both ≥ {MIN_KMH:g} km/h, against the same HRDPS. Cells: median / 68th percentile of the direction error._", "",
           "| stations | SWOB averaging | station-hours | SWOB truth | climate-hourly truth | SWOB vs archive direction, median / 68th |",
           "|---|---|---|---|---|---|"]
    b["d"] = np.abs(wrap(b["sdir"] - b["odir"]))
    for name, g0 in (("hunting country", b[b["tier"] == TIERS[0]]), ("all kept", b)):
        for avg in ("10m", "all"):
            g = g0 if avg == "all" else g0[g0["avg"] == avg]
            if len(g) < 100:
                continue
            out.append(f"| {name} ({g['cid'].nunique()}) | {avg if avg != 'all' else 'any'} | {len(g):,} | {q(g['serr'], .5):.0f}° / {q(g['serr'], TAU):.0f}° | "
                       f"{q(g['err'], .5):.0f}° / {q(g['err'], TAU):.0f}° | {q(g['d'], .5):.0f}° / {q(g['d'], TAU):.0f}° |")
    h = b[b["tier"] == TIERS[0]]
    return out, {"swob": q(h["serr"], TAU), "archive": q(h["err"], TAU), "n": len(h)}


def this_fall(pooled: dict) -> tuple[list[str], dict]:
    """This fall's fit on its own ground: score.py's on-hour SWOB readings
    against hrdps.py's HRDPS (Sep 12 - Oct 10 2026) at the collected stations
    in hunting country (cover.csv), by network, under the pooled sd and the
    current one. The archive has ECCC's and NAV CANADA's stations only; the
    fall's fit had the partners' too (fire weather in clearings)."""
    import score  # this fall's truth exactly as the fit had it; imported, not changed

    cov = {r["id"]: r for r in csv.DictReader(open(OUT / "cover.csv", encoding="utf-8"))}
    swob = json.loads((OUT / "stations.json").read_text(encoding="utf-8"))
    hunt = {k for k, r in cov.items() if float(r["forest1k"]) >= 0.3 and float(r["urban1k"]) < 0.1}
    fw = [pd.read_csv(p, dtype={"id": str}) for p in sorted((OUT / "hrdps").glob("hrdps-2*.csv.gz"))]
    fx = [pd.read_csv(p, dtype={"id": str}, usecols=["id", "t", "t2", "t80"]) for p in sorted((OUT / "hrdps").glob("hrdps-extra-*.csv.gz"))]
    if not fw or not fx:
        return [], {}
    f = pd.concat(fw).merge(pd.concat(fx), on=["id", "t"], how="inner")
    f = f[f["id"].isin(hunt)].copy()
    f["key"] = f["t"].str[:13]
    obs = score.load_obs()
    o = pd.DataFrame([(k[0], k[1], v[0], v[1]) for k, v in obs.items() if k[0] in hunt], columns=["id", "key", "odir", "ospd"])
    b = f.merge(o, on=["id", "key"])
    b = b[(b["ospd"] >= MIN_KMH) & b["t2"].notna() & b["t80"].notna()].copy()
    b["err"] = np.abs(wrap(b["odir"] - b["dir"]))
    b["fspd"] = b["spd"]
    b["stable"] = (b["t80"] - b["t2"]) > 1.0
    b["net"] = b["id"].map(lambda k: (swob.get(k) or {}).get("provider") or "?")
    out = ["## This fall's fit on its own stations, by network", "",
           f"_score.py's on-hour SWOB truth against hrdps.py's HRDPS, {b['t'].min()[:10]} to {b['t'].max()[:10]}, the collected stations in "
           f"hunting country (cover.csv), ≥ {MIN_KMH:g} km/h. The climate archive above has ECCC's and NAV CANADA's stations only._", "",
           "| network | stations | hours | median / 68th pct | hours with U < 5 km/h | stable hours | inside pooled sd·m | inside current |",
           "|---|---|---|---|---|---|---|---|"]
    nets = [n for n, c in b["net"].value_counts().items() if c >= 1000]
    for n in [*nets, "all"]:
        g = b if n == "all" else b[b["net"] == n]
        out.append(f"| {n} | {g['id'].nunique()} | {len(g):,} | {q(g['err'], .5):.0f}° / {q(g['err'], TAU):.0f}° | "
                   f"{(g['fspd'] < 5).mean() * 100:.0f}% | {g['stable'].mean() * 100:.0f}% | {inside(pooled, g):.1f}% | {inside(CURRENT, g):.1f}% |")
    summ = {}
    eccc = b["net"].isin(["MSC", "NAV CANADA"])
    for k, g in (("eccc", b[eccc]), ("partners", b[~eccc]), ("all", b)):
        summ[k] = {"p68": q(g["err"], TAU), "pooled": inside(pooled, g), "current": inside(CURRENT, g), "n": len(g)}
    return out, summ


def note(H: pd.DataFrame, years: list[int], pooled: dict, pooled_x: dict, loyo: dict, mult: dict, br: dict, tf: dict) -> list[str]:
    """Against this fall's fit, in numbers."""
    p68 = {y: q(H[H["fall"] == y]["err"], TAU) for y in years}
    med = {y: q(H[H["fall"] == y]["err"], 0.5) for y in years}
    sd10 = lambda p, st=False: float(sd_of(p, [10.0], [st])[0])
    reg = {r: q(H[H["region"] == r]["err"], TAU) for r in REGIONS if (H["region"] == r).any()}
    ub = H.groupby("ubin")["inside_pooled"].mean() * 100
    ux = {lab: inside(pooled_x, H[H["ubin"] == lab]) for lab in U_LABELS if (H["ubin"] == lab).any()}
    held = [f["held_out_inside"] for f in loyo.values()]
    stab = {lab: q(H[H["stab"] == lab]["err"], TAU) for lab in STAB_LABELS}
    def rng(v: list[float]) -> str:
        a, b = round(min(v)), round(max(v))
        return f"{a}%" if a == b else f"{a}–{b}%"

    out = ["## Against this fall's fit", ""]
    out.append(f"- **Year on year it holds.** The 68th percentile in hunting country is "
               + ", ".join(f"{p68[y]:.0f}° ({y})" for y in years) + " (median " + "/".join(f"{med[y]:.0f}" for y in years)
               + "°); this fall's SWOB fit said ≈ 24°.")
    if br:
        out.append(f"- **The truth isn't the difference.** At the same station-hours this fall, SWOB (the 10-minute mean) gives "
                   f"{br['swob']:.0f}° and the archive (a 2-minute mean, in tens of degrees) {br['archive']:.0f}°.")
    if tf:
        out.append(f"- **The stations are.** This fall on SWOB in hunting country, ECCC and NAV CANADA sites run {tf['eccc']['p68']:.0f}° and "
                   f"the partners' (fire weather, forestry) {tf['partners']['p68']:.0f}°, {tf['all']['p68']:.0f}° together. The archive "
                   f"has only the first kind, so this fall's 24° is the mix and these falls' 22° is ECCC's sites alone.")
    out.append(f"- **The refit keeps b and c, lowers a and m:** a = {pooled['a']:.1f}, b = {pooled['b']:.0f}, c = {pooled['c']:.2f}, "
               f"m = {pooled['m']:.2f} against 6, 155, 1.5, 1.3. At 10 km/h that is {sd10(pooled):.0f}° (stable {sd10(pooled, True):.0f}°) "
               f"against {sd10(CURRENT):.0f}° ({sd10(CURRENT, True):.0f}°). The current fit holds {inside(CURRENT, H):.0f}% of these falls' "
               f"hours, not 68%" + (f"; on this fall's partner stations it holds {tf['partners']['current']:.0f}% and the refit "
               f"{tf['partners']['pooled']:.0f}%." if tf else "."))
    out.append(f"- **Left-out falls:** the refit on the other falls holds {min(held):.1f}–{max(held):.1f}% of the fall left out.")
    out.append(f"- **Stable air:** the raw 68th percentile is {stab[STAB_LABELS[2]]:.0f}° in stable hours against "
               f"{stab[STAB_LABELS[1]]:.0f}° neutral, but most of that is light wind: at matched speeds stable is ×{pooled['m']:.2f} "
               f"(fitted m), ×{mult[STAB_LABELS[2]]:.2f} on the speed-only fit, and the same in every fall; not +30%.")
    out.append("- **Where it moves is place, not year:** " + ", ".join(f"{r} {v:.0f}°" for r, v in reg.items()) + ".")
    lo = [lab for lab in ("0-3", "3-5") if lab in ub]
    hi = [lab for lab in ("25-35", "35+") if lab in ub]
    out.append(f"- **The hyperbola's shape:** it holds {', '.join(f'{ub[l]:.0f}%' for l in lo)} below 5 km/h, "
               f"{rng([ub[l] for l in ('7.5-10', '10-12.5', '12.5-15') if l in ub])} at 7.5–15 and "
               f"{', '.join(f'{ub[l]:.0f}%' for l in hi)} above 25; a + b·exp(−U/c) "
               f"(a = {pooled_x['a']:.1f}, b = {pooled_x['b']:.0f}, c = {pooled_x['c']:.2f}, m = {pooled_x['m']:.2f}) holds "
               f"{rng(list(ux.values()))} in every bin. Its ~{pooled_x['a']:.0f}° floor is partly the archive's "
               f"10° rounding.")
    return out


def step_score() -> None:
    st = {s["cid"]: s for s in kept_stations()}
    obs = load_obs()
    fc = load_forecast()
    fl = falls()
    years = sorted(fl)
    notes = []
    # the UTC the archive gives against its local standard time: one offset a station
    offs = obs.groupby("cid")["lst_off"].agg(["min", "max"])
    odd = offs[(offs["min"] != offs["max"])]
    if len(odd):
        notes.append(f"{len(odd)} stations with more than one LST offset in the archive: {', '.join(odd.index[:8])}")
    tzh = {"NST": -3.5, "AST": -4, "EST": -5, "CST": -6, "MST": -7, "PST": -8}
    bad = [c for c, r in offs.iterrows() if c in st and st[c]["tz"] in tzh and r["min"] != tzh[st[c]["tz"]]]
    if bad:
        notes.append(f"{len(bad)} stations whose archive offset isn't their TIMEZONE's: {', '.join(bad[:8])}")
    n_obs = len(obs)
    obs = obs[obs["t"].dt.month.between(9, 11)]
    obs = obs[obs["t"].dt.year == obs["fall"]]
    ok = (obs["dflag"].isna() | (obs["dflag"] == "")) & (obs["sflag"].isna() | (obs["sflag"] == "")) & \
        obs["odir10"].between(1, 36) & obs["ospd"].notna()
    obs = obs[ok].copy()
    obs["odir"] = (obs["odir10"].astype(float) * 10) % 360
    obs = obs.drop_duplicates(["cid", "t"])
    df = obs.merge(fc, on=["cid", "t"], how="inner")
    df = df[df["ospd"] >= MIN_KMH].copy()
    df["err"] = np.abs(wrap(df["odir"] - df["fdir"]))
    df["sgn"] = wrap(df["fdir"] - df["odir"])
    df["dT"] = df["t80"] - df["t2"]
    df["stable"] = df["dT"] > 1.0
    df["stab"] = np.select([df["dT"] < -0.5, df["dT"] <= 1.0], STAB_LABELS[:2], STAB_LABELS[2])
    df.loc[df["dT"].isna(), "stab"] = "?"
    df["ubin"] = pd.cut(df["fspd"], U_BINS, labels=U_LABELS, right=False).astype(str)
    lat = df["cid"].map(lambda c: st[c]["lat"]).to_numpy()
    lon = df["cid"].map(lambda c: st[c]["lon"]).to_numpy()
    el, am = sun(df["t"], lat, lon)
    df["sun"] = np.where(el < -6, "night", np.where(el >= 8, "day", np.where(am, "dawn", "dusk")))
    df["region"] = df["cid"].map(lambda c: st[c]["region"])
    df["hunt"] = df["cid"].map(lambda c: st[c]["hunt"])
    df["tier"] = df["cid"].map(lambda c: TIERS[0] if st[c]["hunt"] else TIERS[1] if st[c]["edge"] else TIERS[2])
    df["near"] = df["cid"].map(lambda c: st[c]["near"])
    df.to_csv(HIST / "pairs.csv.gz", index=False, columns=["cid", "t", "fall", "odir", "ospd", "fdir", "fspd", "t2", "t80", "err",
                                                          "sun", "region", "tier", "near"])
    H = df[df["hunt"] & df["dT"].notna()].copy()
    print(f"{n_obs:,} archive hours · {len(df):,} scored pairs (measured >= {MIN_KMH:g} km/h) · {len(H):,} in hunting country", flush=True)

    # the fits
    pooled = fit(H)
    pooled_u = fit(H, with_m=False)
    pooled_x = fit(H, form="exp")
    H["inside_pooled"] = H["err"] <= sd_of(pooled, H["fspd"], H["stable"])
    loyo, single, loyo_x = {}, {}, {}
    for y in years:
        tr, te = H[H["fall"] != y], H[H["fall"] == y]
        if not len(te) or not len(tr):
            continue
        f = fit(tr, starts=[[pooled[k] for k in "abcm"], [6, 155, 1.5, 1.3]])
        loyo[y] = {**f, "held_out_inside": round(inside(f, te), 1),
                   "held_out_inside_stable": round(inside(f, te[te["stable"]]), 1),
                   "held_out_inside_not_stable": round(inside(f, te[~te["stable"]]), 1),
                   "current_inside": round(inside(CURRENT, te), 1), "n_held_out": len(te)}
        single[y] = fit(te, starts=[[pooled[k] for k in "abcm"], [6, 155, 1.5, 1.3]])
        fx = fit(tr, form="exp", starts=[[pooled_x[k] for k in "abcm"]])
        loyo_x[y] = {**fx, "held_out_inside": round(inside(fx, te), 1),
                     "held_out_inside_stable": round(inside(fx, te[te["stable"]]), 1),
                     "held_out_inside_not_stable": round(inside(fx, te[~te["stable"]]), 1)}
    # the multiplier by class, given the speed-only fit: the ratio that brings each class to 68%
    mult = {}
    base = sd_of(pooled_u, H["fspd"], np.zeros(len(H), bool))
    for lab in STAB_LABELS:
        s = (H["stab"] == lab).to_numpy()
        mult[lab] = round(float(np.quantile(H["err"].to_numpy()[s] / base[s], TAU)), 3)
    fits = {"pooled": pooled, "pooled_speed_only": pooled_u, "leave_one_fall_out": loyo, "each_fall_alone": single,
            "pooled_exp": pooled_x, "leave_one_fall_out_exp": loyo_x,
            "class_multiplier_on_speed_only_fit": mult, "current": CURRENT,
            "current_inside_pooled": round(inside(CURRENT, H), 1)}
    (HIST / "fit.json").write_text(json.dumps(fits, indent=1), encoding="utf-8")

    br_lines, br = bridge(df[df["fall"] == max(years)], st)
    tf_lines, tf = this_fall(pooled)

    # the tables
    W = []
    W.append("# The forecast's doubt over several falls")
    W.append("")
    W.append(f"_pipeline/stations/history.py, {date.today()}. HRDPS continental (Open-Meteo historical-forecast, `{MODEL}`) at 10 m "
             f"against ECCC climate-hourly; direction error |wrap(obs − forecast)| where the station measured ≥ {MIN_KMH:g} km/h. "
             f"Cells are median / 68th percentile. Hunting country: forest1k ≥ 0.3 and urban1k < 0.1 (cover.py)._")
    W.append("")
    spans = ", ".join(f"{y}: {a:%b %d}–{b:%b %d}" for y, (a, b) in fl.items())
    nst = H.groupby("fall")["cid"].nunique()
    W.append(f"Falls: {spans}. HRDPS on Open-Meteo starts {HRDPS_FROM}; GEM regional/global start 2022-11-23, so no fall 2022 "
             f"for any GEM model.")
    W.append("")
    W += note(H, years, pooled, pooled_x, loyo, mult, br, tf)
    W.append("")
    W.append("## By fall (hunting country)")
    W.append("")
    W.append("| fall | stations | hours | median | 68th pct | within 45° | bias (fc − obs) | inside pooled sd(U)·m | inside current fit |")
    W.append("|---|---|---|---|---|---|---|---|---|")
    for y in years + ["all"]:
        g = H if y == "all" else H[H["fall"] == y]
        if not len(g):
            continue
        W.append(f"| {y} | {g['cid'].nunique()} | {len(g):,} | {q(g['err'], .5):.1f}° | {q(g['err'], TAU):.1f}° | "
                 f"{(g['err'] <= 45).mean() * 100:.0f}% | {g['sgn'].mean():+.1f}° | {g['inside_pooled'].mean() * 100:.1f}% | {inside(CURRENT, g):.1f}% |")
    W.append("")
    W.append("## By forecast speed U (km/h), hunting country")
    W.append("")
    W += table(H, "ubin", U_LABELS, years, "U")
    W.append("")
    W.append("Pooled 68th percentile against the fits, by speed bin:")
    W.append("")
    W.append("| U | hours | 68th pct | pooled sd(U) (neutral) | current sd(U) | stable hours: 68th pct | pooled sd·m | inside pooled | inside exp form | inside current |")
    W.append("|---|---|---|---|---|---|---|---|---|---|")
    mids = [1.5, 4, 6.25, 8.75, 11.25, 13.75, 17.5, 22.5, 30, 45]
    for lab, mid in zip(U_LABELS, mids):
        g = H[H["ubin"] == lab]
        if not len(g):
            continue
        gs = g[g["stable"]]
        um = float(g["fspd"].median())
        W.append(f"| {lab} | {len(g):,} | {q(g['err'], TAU):.0f}° | {pooled['a'] + pooled['b'] / (1 + um / pooled['c']):.0f}° | "
                 f"{CURRENT['a'] + CURRENT['b'] / (1 + um / CURRENT['c']):.0f}° | {q(gs['err'], TAU) if len(gs) >= 100 else float('nan'):.0f}° | "
                 f"{(pooled['a'] + pooled['b'] / (1 + um / pooled['c'])) * pooled['m']:.0f}° | {g['inside_pooled'].mean() * 100:.0f}% | "
                 f"{inside(pooled_x, g):.0f}% | {inside(CURRENT, g):.0f}% |")
    W.append("")
    W.append("_The fit columns are at the bin's median forecast speed._")
    W.append("")
    W.append("## By the forecast's stability (t80 − t2), hunting country")
    W.append("")
    W += table(H, "stab", STAB_LABELS, years, "t80 − t2")
    W.append("")
    W.append("Stability at matched speeds (the class's 68th percentile of err / speed-only sd(U)): "
             + ", ".join(f"{k}: ×{v:.2f}" for k, v in mult.items()) + ".")
    W.append("")
    W.append("## By month, hunting country")
    W.append("")
    H["month"] = H["t"].dt.strftime("%b")
    W += table(H, "month", ["Sep", "Oct", "Nov"], years, "month")
    W.append("")
    W.append("## By the sun, hunting country")
    W.append("")
    W.append("_night: sun below −6°; dawn and dusk: −6° to 8°, before and after solar noon; day: above 8°._")
    W.append("")
    W += table(H, "sun", SUN_LABELS, years, "sun")
    W.append("")
    W.append("## By region, hunting country")
    W.append("")
    rs = H.groupby("region")["cid"].nunique()
    W += table(H, "region", REGIONS, years, "region")
    W.append("")
    W.append("Stations: " + ", ".join(f"{r} {rs.get(r, 0)}" for r in REGIONS) + ".")
    W.append("")
    W.append("## By the cover round the station (all kept stations)")
    W.append("")
    A = df[df["dT"].notna()].copy()
    A["inside_pooled"] = A["err"] <= sd_of(pooled, A["fspd"], A["stable"])
    W += table(A, "tier", TIERS, years, "cover")
    W.append("")
    W.append("Stations: " + ", ".join(f"{k} {A[A['tier'] == k]['cid'].nunique()}" for k in TIERS) + ".")
    W.append("")
    W.append(f"## Near the areas (every station within {NEAR_KM} km, any cover)")
    W.append("")
    N = df[df["near"] != ""].copy()
    N["inside_pooled"] = N["err"] <= sd_of(pooled, N["fspd"], N["stable"])
    W += table(N, "near", list(AREAS), years, "area")
    W.append("")
    W.append("Stations: " + ", ".join(f"{a} {N[N['near'] == a]['cid'].nunique()} "
                                      f"({N[(N['near'] == a) & N['hunt']]['cid'].nunique()} hunting country)" for a in AREAS) + ".")
    W.append("")
    W += br_lines
    W.append("")
    W += tf_lines
    W.append("")
    W.append("## The fit: sd(U) = a + b / (1 + U/c), × m when t80 − t2 > 1 K")
    W.append("")
    W.append("_Fitted as the 68th percentile itself: the pinball loss at 0.68 over every hunting-country pair, Nelder–Mead._")
    W.append("")
    W.append("| fitted on | a | b | c | m (stable) | hours | held-out fall inside sd | held-out: stable / not | current fit on that fall |")
    W.append("|---|---|---|---|---|---|---|---|---|")
    W.append(f"| all falls | {pooled['a']:.1f} | {pooled['b']:.0f} | {pooled['c']:.2f} | {pooled['m']:.2f} | {pooled['n']:,} | "
             f"(in sample {H['inside_pooled'].mean() * 100:.1f}%) | | {fits['current_inside_pooled']:.1f}% |")
    W.append(f"| all falls, speed only | {pooled_u['a']:.1f} | {pooled_u['b']:.0f} | {pooled_u['c']:.2f} | – | {pooled_u['n']:,} | | | |")
    for y, f in loyo.items():
        W.append(f"| all but {y} | {f['a']:.1f} | {f['b']:.0f} | {f['c']:.2f} | {f['m']:.2f} | {f['n']:,} | {f['held_out_inside']:.1f}% | "
                 f"{f['held_out_inside_stable']:.0f}% / {f['held_out_inside_not_stable']:.0f}% | {f['current_inside']:.1f}% |")
    for y, f in single.items():
        W.append(f"| {y} alone | {f['a']:.1f} | {f['b']:.0f} | {f['c']:.2f} | {f['m']:.2f} | {f['n']:,} | | | |")
    W.append(f"| current (fall 2026, SWOB) | {CURRENT['a']:.0f} | {CURRENT['b']:.0f} | {CURRENT['c']:.1f} | {CURRENT['m']:.1f} | | | | |")
    W.append("")
    W.append("The same, as sd(U) = a + b·exp(−U/c), × m when stable (an alternative form, not the one asked for; it holds 68% "
             "in every speed bin where the hyperbola runs 64–71% and 56% above 35 km/h):")
    W.append("")
    W.append("| fitted on | a | b | c | m (stable) | hours | held-out fall inside sd | held-out: stable / not |")
    W.append("|---|---|---|---|---|---|---|---|")
    W.append(f"| all falls | {pooled_x['a']:.1f} | {pooled_x['b']:.0f} | {pooled_x['c']:.2f} | {pooled_x['m']:.2f} | {pooled_x['n']:,} | "
             f"(in sample {inside(pooled_x, H):.1f}%) | |")
    for y, f in loyo_x.items():
        W.append(f"| all but {y} | {f['a']:.1f} | {f['b']:.0f} | {f['c']:.2f} | {f['m']:.2f} | {f['n']:,} | {f['held_out_inside']:.1f}% | "
                 f"{f['held_out_inside_stable']:.0f}% / {f['held_out_inside_not_stable']:.0f}% |")
    W.append("")
    W.append("sd at a few speeds (neutral / stable):")
    W.append("")
    W.append("| U km/h | " + " | ".join(str(u) for u in (2, 5, 10, 15, 20, 30)) + " |")
    W.append("|---|" + "---|" * 6)
    for name, p in (("pooled", pooled), ("pooled, exp form", pooled_x), ("current", CURRENT)):
        W.append(f"| {name} | " + " | ".join(f"{sd_of(p, [u], [False])[0]:.0f}° / {sd_of(p, [u], [True])[0]:.0f}°"
                                           for u in (2, 5, 10, 15, 20, 30)) + " |")
    if notes:
        W += ["", "## Notes", ""] + [f"- {n}" for n in notes]
    text = "\n".join(W) + "\n"
    print(text)
    (OUT / "history.md").write_text(text, encoding="utf-8")


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("step", choices=["stations", "obs", "forecast", "score", "all"])
    args = ap.parse_args()
    steps = {"stations": step_stations, "obs": step_obs, "forecast": step_forecast, "score": step_score}
    for name in (list(steps) if args.step == "all" else [args.step]):
        if name == "stations" and args.step == "all" and (HIST / "stations.csv").exists():
            continue
        steps[name]()
    return 0


if __name__ == "__main__":
    sys.exit(main())
