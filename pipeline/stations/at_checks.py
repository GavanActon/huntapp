"""The station correction at every felt check, for the check replay
(pipeline/inverse/replay_inverse.py, the "pair" variant: the corrected 10 m
speed feeding the floor model from the towers; docs/WIND-LEARNING.md).

    py -3.14 pipeline/stations/at_checks.py [--run seed2-all] [--damp 0.6]

Per check in pipeline/raw/inverse/params.json (the replay's 76):
  - the forecast's air at the check's hour, from the same archive the
    stations were fitted on (Open-Meteo's past HRDPS: 10, 80 and 120 m wind,
    2, 80 and 120 m temperature, cloud, sunshine);
  - the ground (terrain.py's relief, hollow and rise), the trees (cover.py)
    and the SD net's response (surrogate_at.py) at the check's spot;
  - correct.py's "learned + trees" fit, here fitted on every station, run
    on those inputs: the corrected 10 m speed as a station there would read
    it, and the same with the trees taken away (the open-ground 10 m wind at
    that place and hour);
  - ws_top, the wind just above the trees the floor model is fed: the
    open-ground speed through the bake's roughness ratio for the cover round
    the spot (app_ratio). That ratio is the convention under which the
    towers' first level over the canopy matched the bake's local 10 m within
    10% (pipeline/towers/fit.py, 2026-10-07). ws_top_alt is the corrected
    speed with the trees as they are (a mast in a clearing there), the
    lower bound;
  - cls_grad for the floor model from the phone's own layering at the check
    (the replay's `stable` and `convective`): 2 stable when stable >= 0.25,
    0 unstable when convective >= 0.2, else 1 neutral. Not yet calibrated
    against the towers' gradient classes.

Writes pipeline/raw/inverse/pair-speed.csv (one row a check) and keeps the
fitted boosters in pipeline/raw/stations/correct-models/.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import correct as C  # noqa: E402
import cover as CV  # noqa: E402
import hrdps as H  # noqa: E402
import terrain as T  # noqa: E402

INV = HERE.parent / "raw" / "inverse"
MODELS = C.OUT / "correct-models"
SPOT_DEG = 0.0003  # checks within ~30 m share a spot's ground and net
STABLE_S, CONV_S = 0.25, 0.2


def fit_all(run: str, damp: float) -> tuple[dict, list[str]]:
    """correct.py's learned + trees fit on every station-hour (SD base)."""
    df = C.load(run, damp)
    feats = C.AIR + C.SUN + C.GROUND + C.NET + C.COVER
    r = np.radians(((df["obsDir"] - df["sdDir"] + 180) % 360) - 180)
    ys = {"cos": np.cos(r), "sin": np.sin(r), "spd": np.log((df["obsSpd"] + 1) / (df["sdSpd"] + 1))}
    MODELS.mkdir(parents=True, exist_ok=True)
    models = {}
    for y in ("cos", "sin", "spd"):
        rows = df["vane"] if y != "spd" else np.ones(len(df), bool)
        m = lgb.LGBMRegressor(**C.PARAMS).fit(df.loc[rows, feats], ys[y][rows])
        m.booster_.save_model(str(MODELS / f"trees_{y}.txt"))
        models[y] = m
    print(f"fitted on {len(df):,} station-hours at {df['id'].nunique()} stations", flush=True)
    return models, feats


def air_at(checks: list[dict]) -> dict[str, list[float]]:
    """id -> [dir10, spd10, ws80, ws120, t2, t80, t120, cloud, sw] at the
    check's nearest hour, from the HRDPS archive, one request a day."""
    want = {**H.WIND, **H.EXTRA}
    by_day: dict[str, list[dict]] = {}
    for c in checks:
        day = datetime.fromtimestamp(c["ts"] / 1000, timezone.utc).strftime("%Y-%m-%d")
        by_day.setdefault(day, []).append(c)
    out = {}
    for day, cs in sorted(by_day.items()):
        res = H.fetch([(c["id"], c) for c in cs], day, day, want)
        for c, loc in zip(cs, res):
            h = loc.get("hourly") or {}
            hour = datetime.fromtimestamp(round(c["ts"] / 3_600_000) * 3600, timezone.utc).strftime("%Y-%m-%dT%H:00")
            if hour not in (h.get("time") or []):
                continue
            i = h["time"].index(hour)
            vals = [h.get(v, [None] * (i + 1))[i] for v in want.values()]
            if all(x is not None for x in vals):
                out[c["id"]] = [float(x) for x in vals]
        time.sleep(2)
    return out


def net_at_spots(spots: dict[str, tuple[float, float]], run: str) -> dict[str, dict]:
    """The SD net's 16-direction response at each spot (surrogate_at.py's
    15 km box of MRDEM round it, the spot's own cell)."""
    import rasterio
    import torch

    import surrogate_at as S
    from fields import Area, fill_dem, grid_convergence, predict_domain, terrain_features
    from train import load_checkpoint

    device = "cuda" if torch.cuda.is_available() else "cpu"
    model, _ = load_checkpoint(S.RUNS / run / "ckpt.pt", device)
    out = {}
    with rasterio.open(S.MRDEM) as src:
        for sid, (lat, lon) in spots.items():
            dem, epsg, bounds, (r, c) = S.box(src, lon, lat)
            dem = np.where(dem == -9999, np.nan, dem)
            R, Cc = dem.shape
            meta = {"epsg": epsg, "bounds": bounds}
            zeros = np.zeros((16, R, Cc), np.float32)
            dom = Area(name=sid, dem=fill_dem(dem), u=zeros, v=zeros, turb=zeros, directions=np.array(S.DIRS, np.float32),
                       core=np.ones((R, Cc), bool), valid=np.ones((R, Cc), bool), meta=meta, conv=grid_convergence(meta))
            dom.rel, dom.gx, dom.gy = terrain_features(dom.dem)
            pu, pv, pt = predict_domain(model, dom, S.DIRS, device=device, tta=True)
            tu, tv = S.to_true_north(pu[:, r, c], pv[:, r, c], dom.conv)
            out[sid] = {"u": [float(x) for x in tu], "v": [float(x) for x in tv], "t": [float(x) for x in pt[:, r, c]]}
    return out


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--run", default="seed2-all")
    ap.add_argument("--damp", type=float, default=0.6)
    args = ap.parse_args()
    t0 = time.time()
    checks = json.loads((INV / "params.json").read_text(encoding="utf-8"))
    spot_of, spots = {}, {}
    for c in checks:
        key = f"{round(c['lat'] / SPOT_DEG)}_{round(c['lon'] / SPOT_DEG)}"
        spot_of[c["id"]] = key
        spots.setdefault(key, (c["lat"], c["lon"]))
    print(f"{len(checks)} checks at {len(spots)} spots", flush=True)

    models, feats = fit_all(args.run, args.damp)
    air = air_at(checks)
    print(f"forecast air at {len(air)} of {len(checks)} checks · {time.time() - t0:.0f} s", flush=True)
    ground = {k: T.measure((k, {"name": k, "provider": "check", "lat": la, "lon": lo})) for k, (la, lo) in spots.items()}
    trees = {k: CV.measure((k, {"lat": la, "lon": lo})) for k, (la, lo) in spots.items()}
    trees = {k: ({kk: float(v) if v not in ("", None) else float("nan") for kk, v in r.items() if kk != "id"} if r else None)
             for k, r in trees.items()}
    print(f"ground and trees at the spots · {time.time() - t0:.0f} s", flush=True)
    nets = net_at_spots(spots, args.run)
    print(f"net at the spots · {time.time() - t0:.0f} s", flush=True)

    open_cover = {"atForest": 0.0, "forest300": 0.0, "forest1k": 0.0, "distForest": 2000.0, "h300": 0.0, "h1k": 0.0,
                  "cc300": 0.0, "cc1k": 0.0, "upForest": 0.0}
    rows, X, X_open = [], [], []
    nan = float("nan")
    for c in checks:
        a, k = air.get(c["id"]), spot_of[c["id"]]
        g, tr, net = ground.get(k), trees.get(k), nets.get(k)
        if not (a and g and net):
            continue
        fdir, fspd, ws80, ws120, t2, t80, t120, cloud, sw = a
        t = datetime.fromtimestamp(c["ts"] / 1000, timezone.utc)
        sh = C.solar_hour(t, c["lon"])
        turn, spdf, turb = C.net_at(net, fdir, args.damp)
        n = C.station_net(net)
        x = {"fspd": fspd, "shear80": ws80 / (fspd + 1), "shear120": ws120 / (fspd + 1), "dt80": t80 - t2, "dt120": t120 - t2,
             "cloud": cloud, "sw": sw, "sunEl": C.sun_elev(t, c["lat"], c["lon"]),
             "solarSin": math.sin(2 * math.pi * sh / 24), "solarCos": math.cos(2 * math.pi * sh / 24),
             "relief3": float(g["relief3"]), "tpi1": float(g["tpi1"]), "rise3": float(g["rise3"]),
             "netTurn": turn, "netSpd": spdf, "netTurb": turb, "shelter": n["shelter"], "axisK": n["axisK"],
             "axisCos2": math.cos(math.radians(2 * (fdir - n["axis"]))), "axisSin2": math.sin(math.radians(2 * (fdir - n["axis"])))}
        x.update(dict(zip(C.COVER, C.cover_at(tr, fdir, nan))))
        X.append(x)
        X_open.append({**x, **{kk: v for kk, v in open_cover.items()}})
        sd = fspd * spdf
        rows.append({"id": c["id"], "set": c["set"], "area": c["area"], "ts": c["ts"], "felt": c["strength"],
                     "hrdps10Dir": fdir, "hrdps10Kmh": fspd, "sd10Dir": round((fdir + turn) % 360, 1), "sd10Kmh": sd,
                     "roughRatio": C.app_ratio(tr), "stable": c.get("stable"), "convective": c.get("convective"),
                     "forest300": x["forest300"], "h300": x["h300"], "cc300": x["cc300"], "upForest": x["upForest"],
                     "relief3": x["relief3"], "tpi1": x["tpi1"]})
    Xd, Xo = pd.DataFrame(X)[feats], pd.DataFrame(X_open)[feats]
    for r, sp, so in zip(rows, models["spd"].predict(Xd), models["spd"].predict(Xo)):
        u10c = max(0.0, (r["sd10Kmh"] + 1) * math.exp(sp) - 1)
        u10o = max(0.0, (r["sd10Kmh"] + 1) * math.exp(so) - 1)
        ratio = r["roughRatio"] if math.isfinite(r["roughRatio"]) else 1.0
        s, cv = r["stable"] or 0.0, r["convective"] or 0.0
        r.update({"corrected10Kmh": round(u10c, 2), "corrected10OpenKmh": round(u10o, 2),
                  "wsTop": round(u10o * ratio / 3.6, 3), "wsTopAlt": round(u10c / 3.6, 3),
                  "clsGrad": 2 if s >= STABLE_S else 0 if cv >= CONV_S else 1})
    keys = ["id", "set", "area", "ts", "felt", "hrdps10Dir", "hrdps10Kmh", "sd10Dir", "sd10Kmh", "corrected10Kmh", "corrected10OpenKmh",
            "roughRatio", "wsTop", "wsTopAlt", "clsGrad", "stable", "convective", "forest300", "h300", "cc300", "upForest", "relief3", "tpi1"]
    out = INV / "pair-speed.csv"
    with open(out, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=keys, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow({k: (round(v, 3) if isinstance(v, float) else v) for k, v in r.items()})
    df = pd.DataFrame(rows)
    print(f"\n{len(rows)} of {len(checks)} checks -> {out} · {time.time() - t0:.0f} s")
    print(df.groupby("felt")[["hrdps10Kmh", "sd10Kmh", "corrected10Kmh", "corrected10OpenKmh", "wsTop"]].median().round(2).to_string())
    return 0


if __name__ == "__main__":
    sys.exit(main())
