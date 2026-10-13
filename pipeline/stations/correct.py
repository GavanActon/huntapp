"""The station correction (docs/WIND-LEARNING.md, layer 5 on the stations):
what the public stations measured against what we would have called there,
learned from the forecast's own air and the ground round each station, and
tested on regions it never saw.

    py -3.14 pipeline/stations/correct.py [--run seed2-all] [--damp 0.6]

The call it corrects is HRDPS at 10 m (hrdps.py). Per station-hour it learns
the turn from HRDPS's direction to the measured one (as the turn's cosine
and sine, over the hours the station measured 5 km/h or more, where a vane
points somewhere) and the speed against HRDPS's (log of (measured + 1) /
(forecast + 1), km/h), by gradient boosting (LightGBM), from inputs that
exist on any cell, not only at a station:
  - the forecast's air (hrdps.py --extra): the 10 m speed, the 80 and 120 m
    speeds against it (shear), the 80 and 120 m temperatures less the 2 m
    (its own inversion), cloud, sunshine;
  - the sun: elevation, and the hour of the solar day;
  - the ground (terrain.py): relief within 3 km, rise or hollow within 1 km,
    the highest ground within 3 km above;
  - the SD net at the station (surrogate_at.py): its turn and speed for this
    wind (speed damped as the SD bake ships it), its turbulence, the
    station's shelter (mean speed over the 16 directions) and its channel
    (the axis the 16 local winds line up on, how strongly, and this wind's
    angle to it).
No station id, network or position goes in, so what it learns can travel
to a cell with no station on it. The two stations inside areas the net
trained on are left out.

Tested two ways, each against HRDPS alone, HRDPS through the SD net
(score.py's columns) and the app's own 10 m call (the SD call through the
bake's roughness ratio and the phone's night cut: app_ratio, app_dec), on
the same hours:
  - by region: five folds of 3° x 5° blocks, each block's stations scored
    by a fit that never saw them;
  - by region and time: fitted on the other blocks' hours to 30 September,
    scored on the left-out blocks from 1 October on.
A fourth column adds the trees round the station (cover.py: land cover
shares, the distance to the forest, SCANFI height and closure, the forest
upwind), which says whether a reading is an airport's or a clearing's;
without cover.csv it is a fit without the net's inputs, to say what the
net adds.

Writes pipeline/raw/stations/correct-<run>.md (the tables) and .json (the
numbers and the inputs' weights), and prints them.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import json
import math
import sys
import time
from datetime import datetime
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.model_selection import GroupKFold

sys.path.insert(0, str(Path(__file__).resolve().parent))
from score import MIN_KMH, OUT, load_obs, sun_elev  # noqa: E402

AIR = ["fspd", "shear80", "shear120", "dt80", "dt120", "cloud", "sw"]
SUN = ["sunEl", "solarSin", "solarCos"]
GROUND = ["relief3", "tpi1", "rise3"]
NET = ["netTurn", "netSpd", "netTurb", "shelter", "axisK", "axisCos2", "axisSin2"]
# the trees round the station (cover.py), when it has run: the shares of
# land cover within 300 m and 1 km, the distance to the forest, SCANFI's
# height and closure, and the forest share upwind of this wind
COVER = ["atForest", "forest300", "forest1k", "water1k", "wetland1k", "crop1k", "urban1k", "shrub1k", "distForest",
         "h300", "h1k", "cc300", "cc1k", "upForest"]
SPLIT = "2026-10-01"
PARAMS = dict(n_estimators=300, learning_rate=0.06, num_leaves=31, min_child_samples=300, subsample=0.8,
              subsample_freq=1, colsample_bytree=0.8, reg_lambda=1.0, n_jobs=6, verbose=-1)


def solar_hour(t: datetime, lon: float) -> float:
    """Local solar time, hours: the clock hour turned by the longitude and
    the equation of time (score.sun_elev's terms)."""
    doy = t.timetuple().tm_yday
    hour = t.hour + t.minute / 60
    g = 2 * math.pi / 365 * (doy - 1 + (hour - 12) / 24)
    eqt = 229.18 * (0.000075 + 0.001868 * math.cos(g) - 0.032077 * math.sin(g) - 0.014615 * math.cos(2 * g) - 0.040849 * math.sin(2 * g))
    return ((hour * 60 + eqt + 4 * lon) / 60) % 24


def station_net(resp: dict) -> dict:
    """The station's ground as the net sees it, whatever the wind: shelter
    (mean local speed over the 16 directions, in units of the ambient) and
    the channel, the axis its local winds line up on (doubled-angle mean,
    weighted by speed; 0 on open ground where they point every way, 1 in a
    slot that takes every wind along it)."""
    u, v = np.asarray(resp["u"], float), np.asarray(resp["v"], float)
    spd = np.hypot(u, v)
    frm = np.arctan2(-u, -v)
    a = np.sum(spd * np.exp(2j * frm)) / max(spd.sum(), 1e-9)
    return {"shelter": float(spd.mean()), "axis": float((math.degrees(np.angle(a)) / 2) % 180), "axisK": float(abs(a))}


def net_at(resp: dict, fdir: float, damp: float) -> tuple[float, float, float]:
    """The net's call for a wind from fdir: (turn from fdir, degrees; speed
    factor, damped as the SD bake does; turbulence), between the two baked
    directions either side, as score.sd_call does."""
    k = (fdir % 360) / 22.5
    i0 = int(math.floor(k)) % 16
    i1 = (i0 + 1) % 16
    f = k - math.floor(k)
    u = (1 - f) * resp["u"][i0] + f * resp["u"][i1]
    v = (1 - f) * resp["v"][i0] + f * resp["v"][i1]
    frm = (math.degrees(math.atan2(-u, -v)) + 360) % 360
    turn = (frm - fdir + 180) % 360 - 180
    t = (1 - f) * resp["t"][i0] + f * resp["t"][i1] if "t" in resp else float("nan")
    return turn, 1 + damp * (math.hypot(u, v) - 1), t


def app_ratio(c: dict | None) -> float:
    """The bake's roughness speed ratio at a station (build_microclimate
    speed_ratio: the log law through a 60 m blending height, against the
    0.5 m boreal mosaic), with ln z0 averaged over the cover shares within
    300 m in place of its ~90 m smoothing, and z0 by class as roughness()
    gives it: trees 0.1 h (0.3–2.5 m, h the forest's own SCANFI height),
    water 0.0002, wetland 0.03, shrub 0.2, everything else 0.1. NaN without
    cover.py."""
    if not c or not math.isfinite(c.get("forest300", float("nan"))):
        return float("nan")
    f = c["forest300"]
    h = c["h300"] / f if f > 0.05 and math.isfinite(c["h300"]) else 12.0
    parts = {"forest": (f, min(2.5, max(0.3, 0.1 * h))), "water": (c["water300"], 0.0002),
             "wetland": (c["wetland300"], 0.03), "shrub": (c["shrub300"], 0.2)}
    rest = max(0.0, 1 - sum(s for s, _ in parts.values()))
    lz = sum(s * math.log(z) for s, z in parts.values()) + rest * math.log(0.1)
    z0 = math.exp(lz)
    return math.log(10 / z0) / math.log(60 / z0) * (math.log(60 / 0.5) / math.log(10 / 0.5))


def app_dec(t2: float, t80: float, w10: float, w80: float, tpi1: float) -> float:
    """The phone's night cut on the 10 m wind (model.ts: NWP models mix
    stable nights too much, and low ground keeps its cold layer): (1 - 0.3 s)
    (1 - 0.7 s lowness), with s from the bulk Richardson number over 2–80 m
    exactly as boundaryLayer.ts layeringAt reads it off the same HRDPS
    hour, and lowness from the 1 km hollow (the pool depth isn't known at a
    station, so taken as none)."""
    d_theta = t80 - t2 + 0.0098 * 78
    du = max(0.6, (w80 - w10) / 3.6)
    ri = (9.81 / (273.15 + t2)) * d_theta * 78 / (du * du)
    s = min(1, max(0, (ri - 0.1) / 0.9)) * min(1, max(0, d_theta / 0.8)) if d_theta > 0 else 0.0
    lowness = min(1, max(0, -tpi1 / 6))
    return (1 - 0.3 * s) * (1 - 0.7 * s * lowness)


def cover_at(c: dict | None, fdir: float, nan: float) -> list[float]:
    """COVER's values at a station for a wind from fdir: the static shares,
    and the forest share upwind between the two sectors either side."""
    if not c:
        return [nan] * len(COVER)
    k = (fdir % 360) / 22.5
    i0 = int(math.floor(k)) % 16
    f = k - math.floor(k)
    up = (1 - f) * c[f"up{i0}"] + f * c[f"up{(i0 + 1) % 16}"]
    return [c[x] for x in COVER[:-1]] + [up]


def load(run: str, damp: float) -> pd.DataFrame:
    terrain = {r["id"]: r for r in csv.DictReader(open(OUT / "terrain.csv", encoding="utf-8"))}
    stations = json.loads((OUT / "stations.json").read_text(encoding="utf-8"))
    sur = json.loads((OUT / f"surrogate-{run}.json").read_text())
    nets = {sid: station_net(r) for sid, r in sur.items()}
    cover = {}
    if (OUT / "cover.csv").exists():
        for r in csv.DictReader(open(OUT / "cover.csv", encoding="utf-8")):
            cover[r["id"]] = {k: (float(v) if v not in ("", None) else float("nan")) for k, v in r.items() if k != "id"}
    nan = float("nan")
    ratios: dict[str, float] = {}
    extra: dict[tuple[str, str], list[float]] = {}
    for p in sorted((OUT / "hrdps").glob("hrdps-extra-*.csv.gz")):
        with gzip.open(p, "rt", encoding="utf-8") as fh:
            for r in csv.DictReader(fh):
                extra[(r["id"], r["t"][:13])] = [float(r[k]) for k in ("ws80", "ws120", "t2", "t80", "t120", "cloud", "sw")]
    if not extra:
        raise SystemExit("no hrdps-extra-*.csv.gz: run py -3.14 pipeline/stations/hrdps.py --extra first")
    obs = load_obs()
    print(f"{len(obs):,} station-hours measured · {len(extra):,} with the forecast's air · net at {len(sur)} stations", flush=True)
    rows = []
    for p in sorted((OUT / "hrdps").glob("hrdps-2*.csv.gz")):
        with gzip.open(p, "rt", encoding="utf-8") as fh:
            for r in csv.DictReader(fh):
                sid, hour = r["id"], r["t"][:13]
                o = obs.get((sid, hour))
                x = extra.get((sid, hour))
                resp = sur.get(sid)
                te = terrain.get(sid)
                s = stations.get(sid)
                if not (o and x and resp and te and s) or resp.get("inSample"):
                    continue
                fdir, fspd = float(r["dir"]), float(r["spd"])
                ws80, ws120, t2, t80, t120, cloud, sw = x
                t = datetime.fromisoformat(r["t"].replace("Z", "+00:00"))
                lat, lon = float(s["lat"]), float(s["lon"])
                sh = solar_hour(t, lon)
                turn, spdf, turb = net_at(resp, fdir, damp)
                n = nets[sid]
                if sid not in ratios:
                    ratios[sid] = app_ratio(cover.get(sid))
                app_f = ratios[sid] * app_dec(t2, t80, fspd, ws80, float(te["tpi1"]))
                rows.append((sid, hour, lat, lon, s.get("provider") or "?", o[0], o[1], fdir, fspd, app_f,
                             fspd, ws80 / (fspd + 1), ws120 / (fspd + 1), t80 - t2, t120 - t2, cloud, sw,
                             sun_elev(t, lat, lon), math.sin(2 * math.pi * sh / 24), math.cos(2 * math.pi * sh / 24),
                             float(te["relief3"]), float(te["tpi1"]), float(te["rise3"]),
                             turn, spdf, turb, n["shelter"], n["axisK"],
                             math.cos(math.radians(2 * (fdir - n["axis"]))), math.sin(math.radians(2 * (fdir - n["axis"]))),
                             *cover_at(cover.get(sid), fdir, nan)))
    cols = ["id", "hour", "lat", "lon", "provider", "obsDir", "obsSpd", "hrdpsDir", "hrdpsSpd", "appF", *AIR, *SUN, *GROUND, *NET, *COVER]
    df = pd.DataFrame(rows, columns=cols)
    df["block"] = (np.floor(df["lat"] / 3).astype(int)).astype(str) + "_" + (np.floor(df["lon"] / 5).astype(int)).astype(str)
    df["sdDir"] = (df["hrdpsDir"] + df["netTurn"]) % 360
    df["sdSpd"] = df["hrdpsSpd"] * df["netSpd"]
    # the phone's own 10 m call: the SD call through the bake's roughness
    # ratio and the phone's night cut (its stable lid taken as the net's)
    df["appDir"] = df["sdDir"]
    df["appSpd"] = df["sdSpd"] * df["appF"].fillna(1.0)
    df["vane"] = df["obsSpd"] >= MIN_KMH
    return df


def fit_predict(train: pd.DataFrame, test: pd.DataFrame, feats: list[str], base: str) -> tuple[np.ndarray, np.ndarray, dict]:
    """(direction, speed) for the test hours, and the inputs' gain. The fit
    learns what is left over from a base call (`base` "sd": HRDPS through
    the net; "hrdps": HRDPS alone), so where it learns nothing it hands the
    base back: the turn from the base's direction to the measured one (its
    cosine and sine, on the hours a vane points somewhere) and the speed
    against the base's, log of (measured + 1) / (base + 1) km/h, on every
    hour, calms included."""
    bd, bs = f"{base}Dir", f"{base}Spd"
    r = np.radians(((train["obsDir"] - train[bd] + 180) % 360) - 180)
    ys = {"cos": np.cos(r), "sin": np.sin(r), "spd": np.log((train["obsSpd"] + 1) / (train[bs] + 1))}
    gain: dict[str, float] = {f: 0.0 for f in feats}
    preds = {}
    for y in ("cos", "sin", "spd"):
        rows = train["vane"] if y != "spd" else np.ones(len(train), bool)
        m = lgb.LGBMRegressor(**PARAMS)
        m.fit(train.loc[rows, feats], ys[y][rows])
        preds[y] = m.predict(test[feats])
        for f, g in zip(feats, m.booster_.feature_importance("gain")):
            gain[f] += float(g)
    turn = np.degrees(np.arctan2(preds["sin"], preds["cos"]))
    d = (test[bd].to_numpy() + turn) % 360
    s = np.maximum(0.0, (test[bs].to_numpy() + 1) * np.exp(preds["spd"]) - 1)
    return d, s, gain


def summary(df: pd.DataFrame, dcol: str, scol: str) -> dict | None:
    """Direction on the hours a vane points somewhere (5 km/h or more), as
    score.py does. Speed on every hour, calms included, as (call + 1) /
    (measured + 1) km/h: score.py's speed is on the 5 km/h hours only, which
    picks hours by what was measured and so marks down any call that has
    learned the calms (kept here as spd2Vane / spdMedVane)."""
    v = df[df["vane"]]
    if len(v) < 50:
        return None
    miss = np.abs(((v[dcol] - v["obsDir"] + 180) % 360) - 180)
    ratio = (df[scol] + 1) / (df["obsSpd"] + 1)
    rv = v[scol] / v["obsSpd"]
    return {"n": int(len(v)), "hours": int(len(df)), "dir45": float(100 * (miss <= 45).mean()), "dirMed": float(miss.median()),
            "spd2": float(100 * ((ratio >= 0.5) & (ratio <= 2)).mean()), "spdMed": float(ratio.median()),
            "spd2Vane": float(100 * ((rv >= 0.5) & (rv <= 2)).mean()), "spdMedVane": float(rv.median())}


METHODS = (("HRDPS", "hrdpsDir", "hrdpsSpd"), ("SD", "sdDir", "sdSpd"), ("app", "appDir", "appSpd"), ("learned", "lDir", "lSpd"),
           ("learned, no net", "nDir", "nSpd"))


def table(df: pd.DataFrame, methods=METHODS) -> list[str]:
    names = " / ".join(m[0] for m in methods)
    head = [f"| | hours (5 km/h+ / all) | dir within 45°: {names} | median miss | speed within ×2, every hour | median speed ratio, every hour |", "|---|---|---|---|---|---|"]

    def line(label: str, sel: pd.DataFrame) -> str | None:
        ss = [summary(sel, d, s) for _, d, s in methods]
        if any(x is None for x in ss):
            return None
        return (f"| {label} | {ss[0]['n']:,} / {ss[0]['hours']:,} | " + " / ".join(f"{x['dir45']:.0f}%" for x in ss) + " | "
                + " / ".join(f"{x['dirMed']:.0f}°" for x in ss) + " | " + " / ".join(f"{x['spd2']:.0f}%" for x in ss) + " | "
                + " / ".join(f"×{x['spdMed']:.2f}" for x in ss) + " |")

    def relief(x):
        return "flat (<50 m)" if x < 50 else "gentle (50–150 m)" if x < 150 else "hilly (150–400 m)" if x < 400 else "mountain (400 m+)"

    df = df.assign(rc=df["relief3"].map(relief),
                   pos=np.where(df["relief3"] < 150, None, np.where(df["tpi1"] <= -15, "valley floor", np.where(df["tpi1"] >= 15, "ridge", "slope"))),
                   sun=np.where(df["sunEl"] < -6, "night", np.where(df["sunEl"] < 8, "low sun", "day")))
    out = ["#### All", *head, line("all", df)]
    out += ["", "#### By the ground round the station", *head]
    out += [line(k, df[df["rc"] == k]) for k in ("flat (<50 m)", "gentle (50–150 m)", "hilly (150–400 m)", "mountain (400 m+)")]
    out += ["", "#### Hills and mountains, by position (within 1 km)", *head]
    for k in ("valley floor", "slope", "ridge"):
        for sun in (None, "night", "low sun", "day"):
            sel = df[(df["pos"] == k) & ((df["sun"] == sun) if sun else True)]
            out.append(line(k + (f", {sun}" if sun else ""), sel))
    out += ["", "#### By the sun", *head]
    out += [line(k, df[df["sun"] == k]) for k in ("night", "low sun", "day")]
    out += ["", "#### By network (not an input: it says whether a gain is the air or a station's siting)", *head]
    out += [line(k, df[df["provider"] == k]) for k in df["provider"].value_counts().index[:6]]
    out += ["", "#### By the forecast's inversion (120 m less 2 m) at night", *head]
    night = df[df["sunEl"] < -6]
    for lo, hi, lab in ((-99, 0, "none (< 0 °C)"), (0, 2, "weak (0–2 °C)"), (2, 99, "strong (2 °C+)")):
        out.append(line(lab, night[(night["dt120"] >= lo) & (night["dt120"] < hi)]))
    return [x for x in out if x is not None]


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--run", default="seed2-all", help="the net whose SD terrain goes in (surrogate-<run>.json)")
    ap.add_argument("--damp", type=float, default=0.6, help="the speed-contrast damping the SD bake ships with")
    args = ap.parse_args()
    t0 = time.time()
    df = load(args.run, args.damp)
    print(f"{len(df):,} station-hours at {df['id'].nunique()} stations in {df['block'].nunique()} blocks · {time.time() - t0:.0f} s", flush=True)
    full, bare = AIR + SUN + GROUND + NET, AIR + SUN + GROUND
    # the fourth column: with the trees round the station where cover.py has
    # run (on top of the SD call), else without the net (on top of HRDPS)
    trees = bool(df["forest1k"].notna().any())
    fourth, fbase = (full + COVER, "sd") if trees else (bare, "hrdps")
    methods = METHODS[:4] + ((("learned + trees", "nDir", "nSpd"),) if trees else METHODS[4:])
    print(f"last column: {methods[4][0]} ({df['forest1k'].notna().mean():.0%} of hours have the cover)", flush=True)
    gkf = GroupKFold(n_splits=5)
    results = {}
    for name, timed in (("region", False), ("region-time", True)):
        df[["lDir", "lSpd", "nDir", "nSpd"]] = np.nan
        gains = {f: 0.0 for f in fourth if trees} or {f: 0.0 for f in full}
        scored = np.zeros(len(df), bool)
        for k, (tr, te) in enumerate(gkf.split(df, groups=df["block"])):
            train, test = df.iloc[tr], df.iloc[te]
            if timed:
                train, test = train[train["hour"] < SPLIT], test[test["hour"] >= SPLIT]
            d, s, g = fit_predict(train, test, full, "sd")
            df.loc[test.index, "lDir"], df.loc[test.index, "lSpd"] = d, s
            d, s, g4 = fit_predict(train, test, fourth, fbase)
            df.loc[test.index, "nDir"], df.loc[test.index, "nSpd"] = d, s
            for f, v in (g4 if trees else g).items():
                gains[f] += v
            scored[df.index.get_indexer(test.index)] = True
            print(f"  {name} fold {k + 1}/5: fitted on {len(train):,}, scored {len(test):,} · {time.time() - t0:.0f} s", flush=True)
        sel = df[scored]
        tot = sum(gains.values()) or 1
        results[name] = {"hours": int(len(sel)), "stations": int(sel["id"].nunique()),
                         "all": {m[0]: summary(sel, m[1], m[2]) for m in methods},
                         "gain": {f: round(100 * v / tot, 1) for f, v in sorted(gains.items(), key=lambda kv: -kv[1])},
                         "table": table(sel, methods)}
    fourth_txt = ("the same with the trees round the station (cover.py)" if trees
                  else "a learned correction on top of HRDPS without the net's inputs")
    out = [f"# The station correction, net {args.run} (speed damping {args.damp})", "",
           f"Columns: HRDPS alone / HRDPS through the SD net / the app's own 10 m call (the SD call through the bake's roughness ratio "
           f"and the phone's night cut) / the learned correction on top of the SD call / "
           f"{fourth_txt}. Every number is on stations the fit never saw. "
           f"Speed is (call + 1) / (measured + 1) km/h over every hour, calms included. "
           f"Inputs by weight are the {methods[4][0] if trees else 'learned'} fits'.", ""]
    for name, lab in (("region", "Left-out regions, all hours"), ("region-time", f"Left-out regions, hours from {SPLIT} (fitted on hours before)")):
        r = results[name]
        out += [f"## {lab}", "", f"{r['hours']:,} hours at {r['stations']} stations.", "", *r["table"], "",
                "Inputs by weight (gain, % of the fits'): " + ", ".join(f"{f} {v}" for f, v in r["gain"].items()), ""]
    text = "\n".join(out)
    print(text)
    (OUT / f"correct-{args.run}.md").write_text(text + "\n", encoding="utf-8")
    (OUT / f"correct-{args.run}.json").write_text(json.dumps({k: {kk: vv for kk, vv in v.items() if kk != "table"} for k, v in results.items()}, indent=1), encoding="utf-8")
    print(f"\n{OUT / f'correct-{args.run}.md'} · {time.time() - t0:.0f} s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
