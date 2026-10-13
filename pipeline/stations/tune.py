"""The check tuner's numbers, measured at the stations (docs/WIND-LEARNING.md,
layer 3; app/src/weather/micro/ambientFit.ts).

    py -3.14 pipeline/stations/tune.py [--sits 20000] [--puff 60]

The app reads a sit's wind checks the other way round: the forecast's error
is the unknown, a turn and a speed ratio on it, with a prior on each
(PRIOR_TURN, PRIOR_LN_RATIO); each check is scored by how likely it is
under a candidate (DIR_SIGMA by strength, SPEED_SIGMA); the best candidate
is applied, fading after the last check (HOLD_MS) and with distance
(FIT_SCALE_M). Every one of those numbers was set by hand. Here the 1,131
stations (correct.py's station-hours: HRDPS through the SD net, 29 days)
measure them:

Part 1, what the call's error looks like:
  - its spread, by situation (the forecast's 10 m speed, the sun and the
    forecast's inversion, the relief within 3 km): the prior's widths;
  - how much of it holds L hours later at the same station, as the
    regression weight of the error at h+L on the error at h: the weight a
    check's offset should carry L hours on, for the turn and the speed
    apart, and how much of the speed's is the station's own lasting bias;
  - how much holds at another station the same hour, by distance.

Part 2, virtual hunters: at sampled station-hours a hunter takes k checks
of the station's own reading with puff-sized noise added (--puff degrees,
one sigma; the field's puffs differ by about 60, docs/INVERSE.md), and the
speed felt as the station's band. The app's fit (a grid over turn and
ratio, the prior, a Gaussian-plus-floor direction likelihood, the band
likelihood; the best candidate) is run with today's numbers and with the
measured ones, and the corrected call is scored against what the station
read 0, 1, 2, 3 and 6 hours on, beside the call alone.

Writes pipeline/raw/stations/tune.md and tune.json (the measured numbers).
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import correct as C  # noqa: E402

OUT = C.OUT
LAGS = (1, 2, 3, 6, 12, 24)
# ambientFit.ts / windChecks.ts today
APP = {"priorTurn": 40.0, "priorLn": 0.45, "dirSigma": {"drift": 50, "light": 35, "breezy": 28, "windy": 25}, "holdH": 3.0}
BANDS = [("calm", 0, 1), ("drift", 1, 2.5), ("light", 2.5, 6), ("breezy", 6, 13), ("windy", 13, 1e9)]
SPEED_SIGMA = math.log(2)


def wrap(a):
    return (a + 180) % 360 - 180


def situation(df: pd.DataFrame) -> pd.DataFrame:
    wind = pd.cut(df["fspd"], [-1, 8, 20, 1e9], labels=["forecast under 8 km/h", "8–20 km/h", "over 20 km/h"])
    sun = np.where(df["sunEl"] >= 8, "day", np.where(df["sunEl"] >= -6, "low sun", np.where(df["dt120"] >= 2, "night, inversion 2 °C+", "night, weak or none")))
    ground = pd.cut(df["relief3"], [-1, 150, 400, 1e9], labels=["flat or gentle (relief < 150 m)", "hilly (150–400 m)", "mountain (400 m+)"])
    return df.assign(wind=wind.astype(str), sun=sun, ground=ground.astype(str))


def spread(r: pd.Series) -> tuple[float, float]:
    """A robust one-sigma (1.4826 MAD about 0) and the share of the tail past three of it."""
    s = 1.4826 * float(np.median(np.abs(r)))
    return s, float(np.mean(np.abs(r) > 3 * s))


def part1(df: pd.DataFrame) -> tuple[list[str], dict]:
    v = df[df["vane"]]
    md = ["## Part 1: the call's error at the stations", "",
          "Turn: what the station read less the call (HRDPS through the SD net), degrees, where it read 5 km/h or more. "
          "Speed: ln((read + 1) / (call + 1)), every hour. One sigma is 1.4826 x the median absolute value; the tail is the share past three of it.", "",
          "| situation | hours | turn: sigma · tail past 3 sigma | speed (ln): sigma · tail |", "|---|---|---|---|"]
    res: dict = {"bySituation": {}}
    for col in ("wind", "sun", "ground"):
        for k, g in v.groupby(col):
            st, tt = spread(g["rT"])
            sl, tl = spread(df.loc[df[col] == k, "rL"])
            md.append(f"| {k} | {len(g):,} | {st:.0f}° · {100 * tt:.0f}% | {sl:.2f} · {100 * tl:.0f}% |")
            res["bySituation"][k] = {"turn": round(st, 1), "turnTail": round(tt, 3), "ln": round(sl, 3), "lnTail": round(tl, 3)}
    st, tt = spread(v["rT"])
    sl, tl = spread(df["rL"])
    md.append(f"| **all** | {len(v):,} | **{st:.0f}° · {100 * tt:.0f}%** | **{sl:.2f} · {100 * tl:.0f}%** |")
    res["all"] = {"turn": round(st, 1), "turnTail": round(tt, 3), "ln": round(sl, 3), "lnTail": round(tl, 3)}
    # persistence: the regression weight of the error L hours on, on the error now
    s = df.set_index(["id", "t"]).sort_index()
    md += ["", "### How much of a check's offset still holds later, same station", "",
           "The weight w that best carries an offset measured now to L hours on (least squares of the error then on the error now). "
           "Turn on pairs where both read 5 km/h or more and both turns are within 90°. "
           "Speed apart: as measured, and with each station's own mean taken out first (what is left is the weather's).", "",
           "| hours on | turn: w (pairs) | speed: w | speed, station's mean out: w | station's mean share of the speed error |", "|---|---|---|---|---|"]
    res["lag"] = {}
    bias = df.groupby("id")["rL"].transform("mean")
    s["rLx"] = (df.set_index(["id", "t"])["rL"] - bias.to_numpy()).sort_index()
    var_bias = float(np.var(bias)) / float(np.var(df["rL"]))
    for lag in LAGS:
        a = s.reset_index()
        b = a.assign(t=a["t"] - pd.Timedelta(hours=lag))
        m = a.merge(b, on=["id", "t"], suffixes=("", "_l"))
        tv = m["vane"] & m["vane_l"] & (m["rT"].abs() < 90) & (m["rT_l"].abs() < 90)
        wT = float((m.loc[tv, "rT"] * m.loc[tv, "rT_l"]).sum() / (m.loc[tv, "rT"] ** 2).sum())
        wL = float((m["rL"] * m["rL_l"]).sum() / (m["rL"] ** 2).sum())
        wLx = float((m["rLx"] * m["rLx_l"]).sum() / (m["rLx"] ** 2).sum())
        md.append(f"| {lag} | {wT:.2f} ({int(tv.sum()):,}) | {wL:.2f} | {wLx:.2f} | {100 * var_bias:.0f}% |")
        res["lag"][lag] = {"turn": round(wT, 3), "ln": round(wL, 3), "lnWeather": round(wLx, 3)}
    # e-folding fits on 1–6 h
    hs = np.array([1, 2, 3, 6])
    for key in ("turn", "ln", "lnWeather"):
        w = np.array([res["lag"][h][key] for h in hs])
        ok = w > 0.02
        if ok.sum() >= 2:
            slope, icpt = np.polyfit(hs[ok], np.log(w[ok]), 1)
            res[f"{key}Tau"] = round(float(-1 / slope), 2) if slope < 0 else None
            res[f"{key}W0"] = round(float(math.exp(icpt)), 3)
    md += ["", f"Fitted on 1–6 h as w0 · exp(−L / tau): turn w0 {res.get('turnW0')}, tau {res.get('turnTau')} h; "
               f"speed w0 {res.get('lnW0')}, tau {res.get('lnTau')} h; the speed's weather part w0 {res.get('lnWeatherW0')}, tau {res.get('lnWeatherTau')} h. "
               f"The stations' own means are {100 * var_bias:.0f}% of the speed error's variance: that part is the place's, and lasts."]
    res["speedBiasShare"] = round(var_bias, 3)
    # by distance, the same hour
    st_ = df.groupby("id")[["lat", "lon"]].first()
    lat, lon = np.radians(st_["lat"].to_numpy()), np.radians(st_["lon"].to_numpy())
    dist = 6371 * np.arccos(np.clip(np.sin(lat)[:, None] * np.sin(lat)[None, :] + np.cos(lat)[:, None] * np.cos(lat)[None, :] * np.cos(lon[:, None] - lon[None, :]), -1, 1))
    ids = st_.index.to_numpy()
    piv_t = df[df["vane"] & (df["rT"].abs() < 90)].pivot_table(index="t", columns="id", values="rT")
    piv_l = df.pivot_table(index="t", columns="id", values="rL")
    md += ["", "### How much holds at another station the same hour, by distance", "",
           "| km | turn: w (pairs) | speed: w |", "|---|---|---|"]
    res["distance"] = {}
    for lo, hi in ((0.5, 10), (10, 25), (25, 50), (50, 100)):
        ii, jj = np.where((dist > lo) & (dist <= hi))
        num_t = den_t = num_l = den_l = 0.0
        n = 0
        for i, j in zip(ii, jj):
            a, b = ids[i], ids[j]
            if a not in piv_t or b not in piv_t:
                continue
            x, y = piv_t[a].to_numpy(), piv_t[b].to_numpy()
            ok = ~np.isnan(x) & ~np.isnan(y)
            num_t += float(np.sum(x[ok] * y[ok]))
            den_t += float(np.sum(x[ok] ** 2))
            n += int(ok.sum())
            xl, yl = piv_l[a].to_numpy(), piv_l[b].to_numpy()
            okl = ~np.isnan(xl) & ~np.isnan(yl)
            num_l += float(np.sum(xl[okl] * yl[okl]))
            den_l += float(np.sum(xl[okl] ** 2))
        if den_t:
            md.append(f"| {lo:g}–{hi:g} | {num_t / den_t:.2f} ({n:,}) | {num_l / den_l:.2f} |")
            res["distance"][f"{lo:g}-{hi:g}"] = {"turn": round(num_t / den_t, 3), "ln": round(num_l / den_l, 3)}
    return md, res


def band_of(kmh: np.ndarray) -> np.ndarray:
    out = np.empty(kmh.shape, dtype=object)
    for name, lo, hi in BANDS:
        out[(kmh >= lo) & (kmh < hi)] = name
    return out


def Phi(z: np.ndarray) -> np.ndarray:
    from scipy.special import ndtr

    return ndtr(z)


def fit_sits(sd_dir, sd_spd, checks_dir, checks_band, prior_turn, prior_ln, dir_sigma):
    """The app's fit, vectorised over sits: (turn, lnRatio) for each sit, the best on the grid.
    sd_dir, sd_spd: (S,); checks_dir: (S, k) degrees; checks_band: (S, k) band names; dir_sigma: (S, k)."""
    turns = np.arange(-180, 180, 5.0)
    lns = np.linspace(-1.0, 1.2, 12)
    T, L = np.meshgrid(turns, lns, indexing="ij")  # (nt, nl)
    S, k = checks_dir.shape
    prior = -0.5 * (T / prior_turn[:, None, None]) ** 2 - 0.5 * (L / prior_ln[:, None, None]) ** 2  # (S, nt, nl)
    score = prior.copy()
    lo_hi = {n: (lo, hi) for n, lo, hi in BANDS}
    for j in range(k):
        call = sd_dir[:, None] + turns[None, :]  # (S, nt)
        z = wrap(checks_dir[:, j : j + 1] - call) / dir_sigma[:, j : j + 1]
        ld = np.log(0.9 * np.exp(-0.5 * z * z) + 0.1)  # (S, nt)
        m = np.log(np.maximum(sd_spd[:, None] * np.exp(lns[None, :]), 0.2))  # (S, nl)
        lo = np.array([lo_hi[b][0] for b in checks_band[:, j]])[:, None]
        hi = np.array([lo_hi[b][1] for b in checks_band[:, j]])[:, None]
        upper = np.where(np.isinf(hi), 1.0, Phi((np.log(np.where(np.isinf(hi), 1, hi)) - m) / SPEED_SIGMA))
        lower = np.where(lo <= 0, 0.0, Phi((np.log(np.maximum(lo, 1e-9)) - m) / SPEED_SIGMA))
        ls = np.log(np.maximum(upper - lower, 0.02))  # (S, nl)
        score += ld[:, :, None] + ls[:, None, :]
    flat = score.reshape(S, -1).argmax(axis=1)
    return T.reshape(-1)[flat], L.reshape(-1)[flat]


def part2(df: pd.DataFrame, res: dict, sits: int, puff: float, seed: int = 7) -> list[str]:
    rng = np.random.default_rng(seed)
    s = df.set_index(["id", "t"]).sort_index()
    start = df[df["vane"]].sample(n=min(sits, int(df["vane"].sum())), random_state=seed)
    S = len(start)
    # the prior widths measured, by the sit's situation (the forecast speed band), else overall
    by = res["bySituation"]
    p_turn = np.array([by.get(w, res["all"])["turn"] for w in start["wind"]], float)
    p_ln = np.array([by.get(w, res["all"])["ln"] for w in start["wind"]], float)
    lagw = res["lag"]

    def w_at(key: str, L: int) -> float:
        if L == 0:
            return 1.0
        if L in lagw:
            return max(0.0, lagw[L][key])
        return max(0.0, res.get(f"{key}W0", 1) * math.exp(-L / (res.get(f"{key}Tau") or 3)))

    md = ["## Part 2: virtual hunters", "",
          f"{S:,} sits at sampled station-hours. A check is the station's own reading with a puff's noise added "
          f"({puff:.0f}° one sigma) and the station's speed band as felt; the fit picks the best turn and speed ratio on the call. "
          "Scored against what the station read L hours on (direction where it read 5 km/h or more; speed within ×2, every hour).", "",
          "Settings: **today** = ambientFit.ts as it is (turn prior 40°, ln-ratio prior 0.45, the puff's sigma by strength 25–50°, "
          "both fading over 3 h); **measured** = the priors from Part 1 by the forecast's speed, the puff's sigma as it is, "
          "the turn and the speed each carried L hours on by Part 1's weights.", "",
          "| checks | hours on | within 45°: call / today / measured | median miss | speed within ×2: call / today / measured |", "|---|---|---|---|---|"]
    for k in (1, 2, 4, 8):
        dirs = wrap(start["obsDir"].to_numpy()[:, None] + rng.normal(0, puff, (S, k)))
        bands = np.repeat(band_of(start["obsSpd"].to_numpy())[:, None], k, axis=1)
        sig_app = np.vectorize(lambda b: APP["dirSigma"].get(b, 90))(bands).astype(float)
        sd_dir, sd_spd = start["sdDir"].to_numpy(), start["sdSpd"].to_numpy()
        tA, lA = fit_sits(sd_dir, sd_spd, dirs, bands, np.full(S, APP["priorTurn"]), np.full(S, APP["priorLn"]), sig_app)
        tM, lM = fit_sits(sd_dir, sd_spd, dirs, bands, p_turn, p_ln, np.full((S, k), float(puff)))
        if k == 1:  # the app does not move the air for one check (fitMatters: two or more)
            tA, lA = np.zeros(S), np.zeros(S)
        for L in (0, 1, 2, 3, 6):
            idx = list(zip(start["id"], start["t"] + pd.Timedelta(hours=L)))
            fut = s.reindex(idx)
            ok = fut["obsDir"].notna().to_numpy()
            if ok.sum() < 200:
                continue
            f = fut[ok]
            od, osp = f["obsDir"].to_numpy(), f["obsSpd"].to_numpy()
            cd, cs = f["sdDir"].to_numpy(), f["sdSpd"].to_numpy()
            fa = math.exp(-L / APP["holdH"])
            outs = []
            for tt, ll, wt, wl in ((0, 0, 0, 0), (tA[ok], lA[ok], fa, fa), (tM[ok], lM[ok], w_at("turn", L), w_at("ln", L))):
                d = cd + np.asarray(tt) * wt
                sp = cs * np.exp(np.asarray(ll) * wl)
                vane = osp >= 5
                miss = np.abs(wrap(d - od))[vane]
                r = (sp + 1) / (osp + 1)
                outs.append((100 * np.mean(miss <= 45), float(np.median(miss)), 100 * np.mean((r >= 0.5) & (r <= 2))))
            md.append(f"| {k} | {L} | " + " / ".join(f"{o[0]:.0f}%" for o in outs) + " | " + " / ".join(f"{o[1]:.0f}°" for o in outs)
                      + " | " + " / ".join(f"{o[2]:.0f}%" for o in outs) + " |")
    return md


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--sits", type=int, default=20000)
    ap.add_argument("--puff", type=float, default=60.0, help="a felt puff's direction noise, degrees one sigma")
    args = ap.parse_args()
    df = C.load("seed2-all", 0.6)
    df["t"] = pd.to_datetime(df["hour"] + ":00", utc=True)
    df["rT"] = wrap(df["obsDir"] - df["sdDir"])
    df["rL"] = np.log((df["obsSpd"] + 1) / (df["sdSpd"] + 1))
    df = situation(df)
    md1, res = part1(df)
    print("\n".join(md1), flush=True)
    md2 = part2(df, res, args.sits, args.puff)
    md2b = part2(df, res, args.sits, 30.0) if args.puff != 30 else []
    text = "\n".join(["# The check tuner's numbers, measured at the stations", "", *md1, "", *md2, "",
                      *(["### The same with a steadier check (30°: the treetops seen, or a puff watched for long)", ""] + md2b[md2b.index("| checks | hours on | within 45°: call / today / measured | median miss | speed within ×2: call / today / measured |"):] if md2b else [])])
    print("\n".join(md2), flush=True)
    if md2b:
        print("\n".join(md2b), flush=True)
    (OUT / "tune.md").write_text(text + "\n", encoding="utf-8")
    (OUT / "tune.json").write_text(json.dumps(res, indent=1), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
