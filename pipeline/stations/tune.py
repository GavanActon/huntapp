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


def fit_sits2(sd_dir, sd_spd, checks_dir, checks_band, check_w, prior_turn, prior_ln, dir_sigma, tail=0.0):
    """fit_sits with each check's weight (the app's fitWeight: age and puffs) and a prior with a tail:
    (1 - tail) of a Gaussian and tail spread evenly over every turn and ratio, so checks that agree can
    overrule a forecast that is far off. Returns (turn, lnRatio, gain per check), the gain as ambientFit's."""
    turns = np.arange(-180, 180, 5.0)
    lns = np.linspace(-1.0, 1.2, 12)
    T, L = np.meshgrid(turns, lns, indexing="ij")
    S, k = checks_dir.shape
    g = -0.5 * (T / prior_turn[:, None, None]) ** 2 - 0.5 * (L / prior_ln[:, None, None]) ** 2
    if tail > 0:
        # the tail's density against the Gaussian's peak: tail/(1 - tail) of the Gaussian's mass, spread over 360 deg x 2.2 ln
        c = tail / (1 - tail) * 2 * math.pi * prior_turn * prior_ln / (360 * 2.2)
        prior = np.log((1 - tail) * np.exp(g) + c[:, None, None])
    else:
        prior = g
    score = prior.copy()
    lo_hi = {n: (lo, hi) for n, lo, hi in BANDS}
    for j in range(k):
        call = sd_dir[:, None] + turns[None, :]
        z = wrap(checks_dir[:, j : j + 1] - call) / dir_sigma[:, j : j + 1]
        ld = np.log(0.9 * np.exp(-0.5 * z * z) + 0.1)
        m = np.log(np.maximum(sd_spd[:, None] * np.exp(lns[None, :]), 0.2))
        lo = np.array([lo_hi[b][0] for b in checks_band[:, j]])[:, None]
        hi = np.array([lo_hi[b][1] for b in checks_band[:, j]])[:, None]
        upper = np.where(np.isinf(hi), 1.0, Phi((np.log(np.where(np.isinf(hi), 1, hi)) - m) / SPEED_SIGMA))
        lower = np.where(lo <= 0, 0.0, Phi((np.log(np.maximum(lo, 1e-9)) - m) / SPEED_SIGMA))
        ls = np.log(np.maximum(upper - lower, 0.02))
        score += check_w[:, j][:, None, None] * (ld[:, :, None] + ls[:, None, :])
    flat = score.reshape(S, -1)
    bi = flat.argmax(axis=1)
    best = flat[np.arange(S), bi]
    base = score[:, int(np.argmin(np.abs(turns))), int(np.argmin(np.abs(lns)))]
    gain = (best - base) / np.maximum(1, check_w.sum(axis=1))
    return T.reshape(-1)[bi], L.reshape(-1)[bi], gain


def part3(df: pd.DataFrame, res: dict, sits: int, seed: int = 11) -> list[str]:
    """The rules for several checks, on virtual hunters: the prior's tail, the app's gate (two checks,
    a turn of 8 deg or speed off a fifth, gain of 1 a check), and how checks of a sit spread over three
    hours age (FIT_TAU)."""
    rng = np.random.default_rng(seed)
    s = df.set_index(["id", "t"]).sort_index()
    start = df[df["vane"]].sample(n=min(sits, int(df["vane"].sum())), random_state=seed)
    S = len(start)
    by = res["bySituation"]
    p_turn = np.array([by.get(w, res["all"])["turn"] for w in start["wind"]], float)
    p_ln = np.array([by.get(w, res["all"])["ln"] for w in start["wind"]], float)
    sd_dir, sd_spd = start["sdDir"].to_numpy(), start["sdSpd"].to_numpy()
    fit_sig = {"calm": 90, "drift": 55, "light": 50, "breezy": 45, "windy": 40}
    off = np.abs(start["rT"].to_numpy()) > 45  # the call far off when the checks are taken

    futs = {L: s.reindex(list(zip(start["id"], start["t"] + pd.Timedelta(hours=L)))) for L in (0, 1, 2)}

    def scores(tt, ll, L, wT=1.0, wL=1.0, sel=None):
        f = futs[L]
        ok = f["obsDir"].notna().to_numpy()
        if sel is not None:
            ok = ok & sel
        od, osp = f["obsDir"].to_numpy()[ok], f["obsSpd"].to_numpy()[ok]
        d = f["sdDir"].to_numpy()[ok] + np.asarray(tt)[ok] * wT
        sp = f["sdSpd"].to_numpy()[ok] * np.exp(np.asarray(ll)[ok] * wL)
        vane = osp >= 5
        miss = np.abs(wrap(d - od))[vane]
        r = (sp + 1) / (osp + 1)
        return 100 * np.mean(miss <= 45), float(np.median(miss)), 100 * np.mean((r >= 0.5) & (r <= 2)), int(ok.sum())

    wt = {L: (1.0 if L == 0 else max(0.0, res["lag"][L]["turn"])) for L in (0, 1, 2)}
    wl = {L: (1.0 if L == 0 else max(0.0, res["lag"][L]["ln"])) for L in (0, 1, 2)}
    zeros = np.zeros(S)
    md = ["## Part 3: the rules for several checks", "",
          f"{S:,} virtual sits; {int(off.sum()):,} of them ({100 * off.mean():.0f}%) with the call more than 45° off when the checks are taken. "
          "Settings as deployed 2026-10-13 (the measured prior by the forecast's speed, puffs read at 40–55°) unless the row says otherwise. "
          "Scored now and 1 h on, all sits, and the far-off ones on their own.", ""]
    for puff in (60.0, 45.0):
        md += [f"### Checks all at once, puffs ±{puff:.0f}°", "",
               "| checks | rule | within 45° now: all · call far off | median miss now | 1 h on: within 45° | speed within ×2 now |", "|---|---|---|---|---|---|"]
        for k in (2, 4, 8):
            dirs = wrap(start["obsDir"].to_numpy()[:, None] + rng.normal(0, puff, (S, k)))
            bands = np.repeat(band_of(start["obsSpd"].to_numpy())[:, None], k, axis=1)
            sig = np.vectorize(lambda b: fit_sig.get(b, 90))(bands).astype(float)
            w1 = np.ones((S, k))
            rows = [("the call alone", scores(zeros, zeros, 0), scores(zeros, zeros, 0, sel=off), scores(zeros, zeros, 1))]
            for name, tail, gate in (("Gaussian prior (deployed)", 0.0, False), ("Gaussian prior, with the app's gate", 0.0, True),
                                     ("tail 3%", 0.03, False), ("tail 6%", 0.06, False), ("tail 10%", 0.10, False), ("tail 6%, with the app's gate", 0.06, True)):
                tt, ll, gain = fit_sits2(sd_dir, sd_spd, dirs, bands, w1, p_turn, p_ln, sig, tail)
                if gate:
                    keep = (k >= 2) & ((np.abs(tt) >= 8) | (np.abs(ll) >= math.log(1.2))) & (gain >= 1)
                    tt, ll = np.where(keep, tt, 0), np.where(keep, ll, 0)
                rows.append((name, scores(tt, ll, 0), scores(tt, ll, 0, sel=off), scores(tt, ll, 1, wt[1], wl[1])))
            for name, a, o, h1 in rows:
                md.append(f"| {k} | {name} | {a[0]:.0f}% · {o[0]:.0f}% | {a[1]:.0f}° | {h1[0]:.0f}% | {a[2]:.0f}% |")
        md.append("")
    # four checks spread over the sit: at the hour and the three before, each the station's own reading then
    md += ["### Four checks spread over three hours (each the station's reading at its hour, puffs ±60°): how fast older ones should count less", "",
           "| check aging (FIT_TAU) | within 45° now: all · call far off | median miss now | 1 h on | 2 h on |", "|---|---|---|---|---|"]
    k = 4
    past = [s.reindex(list(zip(start["id"], start["t"] - pd.Timedelta(hours=j)))) for j in range(k)]
    have = np.all([p_["obsDir"].notna().to_numpy() & p_["sdDir"].notna().to_numpy() for p_ in past], axis=0)
    # each check read against the call of its own hour: its offset carried onto the call now
    dirs = np.stack([wrap(np.nan_to_num(p_["obsDir"].to_numpy()) - np.nan_to_num(p_["sdDir"].to_numpy()) + sd_dir + rng.normal(0, 60.0, S)) for p_ in past], axis=1)
    bands = np.stack([band_of(np.nan_to_num(p_["obsSpd"].to_numpy())) for p_ in past], axis=1)
    sig = np.vectorize(lambda b: fit_sig.get(b, 90))(bands).astype(float)
    for tau in (0.5, 1.0, 2.0, 4.0, None):
        age = np.tile(np.arange(k, dtype=float), (S, 1))
        w = np.ones((S, k)) if tau is None else np.exp(-age / tau)
        tt, ll, _ = fit_sits2(sd_dir, sd_spd, dirs, bands, w, p_turn, p_ln, sig, 0.06)
        tt, ll = np.where(have, tt, 0), np.where(have, ll, 0)
        a = scores(tt, ll, 0, sel=have)
        o = scores(tt, ll, 0, sel=have & off)
        h1 = scores(tt, ll, 1, wt[1], wl[1], sel=have)
        h2 = scores(tt, ll, 2, wt[2], wl[2], sel=have)
        md.append(f"| {'none (all count the same)' if tau is None else f'{tau:g} h'} | {a[0]:.0f}% · {o[0]:.0f}% | {a[1]:.0f}° | {h1[0]:.0f}% | {h2[0]:.0f}% |")
    b0 = scores(zeros, zeros, 0, sel=have)
    md.append(f"| (the call alone) | {b0[0]:.0f}% · {scores(zeros, zeros, 0, sel=have & off)[0]:.0f}% | {b0[1]:.0f}° | {scores(zeros, zeros, 1, sel=have)[0]:.0f}% | {scores(zeros, zeros, 2, sel=have)[0]:.0f}% |")
    return md


def hunting_hours(df: pd.DataFrame) -> pd.DataFrame:
    """Legal light: the sun at -5 deg or higher, about half an hour before sunrise to half an hour after
    sunset at these latitudes in the fall. Dawn and dusk: the first and last three legal hours of each
    station's day (its solar date)."""
    legal = df["sunEl"] >= -5
    day = (df["t"] + pd.to_timedelta(df["lon"] / 15, unit="h")).dt.date
    lg = df.loc[legal, ["id", "t"]].assign(d=day[legal])
    r1 = lg.groupby(["id", "d"])["t"].rank(method="first")
    r2 = lg.groupby(["id", "d"])["t"].rank(method="first", ascending=False)
    prime = pd.Series(False, index=df.index)
    prime.loc[lg.index] = ((r1 <= 3) | (r2 <= 3)).to_numpy()
    return df.assign(legal=legal.to_numpy(), prime=prime.to_numpy())


def priors_of(df: pd.DataFrame) -> dict:
    """The fit's prior widths, by the forecast's speed, measured on these station-hours."""
    v = df[df["vane"]]
    out = {}
    for k, g in v.groupby("wind"):
        st, tt = spread(g["rT"])
        sl, tl = spread(df.loc[df["wind"] == k, "rL"])
        out[k] = {"turn": st, "turnTail": tt, "ln": sl, "lnTail": tl, "hours": len(g)}
    st, tt = spread(v["rT"])
    sl, tl = spread(df["rL"])
    out["all"] = {"turn": st, "turnTail": tt, "ln": sl, "lnTail": tl, "hours": len(v)}
    return out


def part4(df: pd.DataFrame, res: dict, sits: int, seed: int = 13) -> tuple[list[str], dict]:
    """The same numbers in hunting hours: the prior's widths, how long an offset holds, and the virtual
    hunters, with sits started in legal light and at dawn and dusk."""
    df = hunting_hours(df)
    scopes = {"all hours": df, "legal light": df[df["legal"]], "dawn and dusk": df[df["prime"]], "night": df[~df["legal"]]}
    pri = {name: priors_of(d) for name, d in scopes.items()}
    md = ["## Part 4: hunting hours", "",
          "Legal light: the sun at −5° or higher (about half an hour before sunrise to half an hour after sunset). "
          "Dawn and dusk: the first and last three legal hours of each station's day. "
          f"Of {len(df):,} station-hours, {100 * df['legal'].mean():.0f}% are legal light and {100 * df['prime'].mean():.0f}% dawn and dusk.", "",
          "### How wrong the call runs, by the forecast's speed (one sigma · the share past three of it)", "",
          "| forecast 10 m | " + " | ".join(f"{n}: turn · speed (ln)" for n in scopes) + " |", "|---|" + "---|" * len(scopes)]
    for w in ("forecast under 8 km/h", "8–20 km/h", "over 20 km/h", "all"):
        cells = []
        for n in scopes:
            p = pri[n].get(w)
            cells.append("—" if p is None else f"{p['turn']:.0f}° · {100 * p['turnTail']:.0f}% · {p['ln']:.2f} ({p['hours']:,})")
        md.append(f"| {w} | " + " | ".join(cells) + " |")

    # how long an offset holds, the pair's first hour in the scope and the second in legal light
    md += ["", "### How much of an offset holds L hours on (both hours in legal light; the first in the scope)", "",
           "| hours on | all hours: turn · speed | legal light | dawn and dusk |", "|---|---|---|---|"]
    s = df.set_index(["id", "t"]).sort_index()
    a = s.reset_index()
    lagw: dict = {}
    for lag in (1, 2, 3, 6):
        b = a.assign(t=a["t"] - pd.Timedelta(hours=lag))
        m = a.merge(b, on=["id", "t"], suffixes=("", "_l"))
        cells = []
        for n, sel in (("all hours", np.ones(len(m), bool)), ("legal light", (m["legal"] & m["legal_l"]).to_numpy()),
                       ("dawn and dusk", (m["prime"] & m["legal_l"]).to_numpy())):
            mm = m[sel]
            tv = mm["vane"] & mm["vane_l"] & (mm["rT"].abs() < 90) & (mm["rT_l"].abs() < 90)
            wT = float((mm.loc[tv, "rT"] * mm.loc[tv, "rT_l"]).sum() / (mm.loc[tv, "rT"] ** 2).sum())
            wL = float((mm["rL"] * mm["rL_l"]).sum() / (mm["rL"] ** 2).sum())
            lagw.setdefault(n, {})[lag] = (wT, wL)
            cells.append(f"{wT:.2f} · {wL:.2f}")
        md.append(f"| {lag} | " + " | ".join(cells) + " |")

    # virtual hunters started in each scope: today's priors (all hours) against the scope's own
    rng = np.random.default_rng(seed)
    fit_sig = {"calm": 90, "drift": 55, "light": 50, "breezy": 45, "windy": 40}
    md += ["", "### Virtual hunters by when the sit is, puffs ±60°, the deployed fit with the 6% tail and no gain gate", "",
           "Within 45° of the station now: all sits · the sits where the call was more than 45° off; then 1 h on (the turn carried by the measured weight).", "",
           "| sits in | checks | the call alone | priors from all hours | priors from these hours | 1 h on (all-hours priors) |", "|---|---|---|---|---|---|"]
    out: dict = {"priors": {n: {k: {kk: round(vv, 3) for kk, vv in p.items()} for k, p in pri[n].items()} for n in pri}}
    for n in ("all hours", "legal light", "dawn and dusk"):
        d = scopes[n]
        start = d[d["vane"]].sample(n=min(sits, int(d["vane"].sum())), random_state=seed)
        S = len(start)
        sd_dir, sd_spd = start["sdDir"].to_numpy(), start["sdSpd"].to_numpy()
        off = np.abs(start["rT"].to_numpy()) > 45
        f1 = s.reindex(list(zip(start["id"], start["t"] + pd.Timedelta(hours=1))))
        wT1 = max(0.0, lagw[n][1][0])

        def sc(tt, ll, fut=None, wT=1.0, sel=None):
            f = start if fut is None else fut
            ok = f["obsDir"].notna().to_numpy() if fut is not None else np.ones(S, bool)
            if sel is not None:
                ok = ok & sel
            od, osp = f["obsDir"].to_numpy()[ok], f["obsSpd"].to_numpy()[ok]
            dd = f["sdDir"].to_numpy()[ok] + np.asarray(tt)[ok] * wT
            miss = np.abs(wrap(dd - od))[osp >= 5]
            return 100 * np.mean(miss <= 45)

        def priors_for(p):
            return (np.array([p.get(w, p["all"])["turn"] for w in start["wind"]], float),
                    np.array([p.get(w, p["all"])["ln"] for w in start["wind"]], float))

        z = np.zeros(S)
        for k in (2, 4, 8):
            dirs = wrap(start["obsDir"].to_numpy()[:, None] + rng.normal(0, 60.0, (S, k)))
            bands = np.repeat(band_of(start["obsSpd"].to_numpy())[:, None], k, axis=1)
            sig = np.vectorize(lambda bb: fit_sig.get(bb, 90))(bands).astype(float)
            w1 = np.ones((S, k))
            pa = priors_for(pri["all hours"])
            ph = priors_for(pri[n])
            ta, la, _ = fit_sits2(sd_dir, sd_spd, dirs, bands, w1, pa[0], pa[1], sig, 0.06)
            th, lh, _ = fit_sits2(sd_dir, sd_spd, dirs, bands, w1, ph[0], ph[1], sig, 0.06)
            md.append(f"| {n} ({S:,}; {100 * off.mean():.0f}% far off) | {k} | {sc(z, z):.0f}% · 0% | {sc(ta, la):.0f}% · {sc(ta, la, sel=off):.0f}% | "
                      f"{sc(th, lh):.0f}% · {sc(th, lh, sel=off):.0f}% | {sc(z, z, f1):.0f}% → {sc(ta, la, f1, wT1):.0f}% |")
    # how many checks settle it, (50 / the prior's turn)^2, by the scope's priors
    md += ["", "### Checks to settle the air, (50° / the prior's turn)², by the forecast's speed", "",
           "| forecast 10 m | " + " | ".join(scopes) + " |", "|---|" + "---|" * len(scopes)]
    for w in ("forecast under 8 km/h", "8–20 km/h", "over 20 km/h"):
        md.append(f"| {w} | " + " | ".join(f"{max(2, math.ceil((50 / pri[n][w]['turn']) ** 2))}" for n in scopes) + " |")
    out["lag"] = {n: {L: {"turn": round(v[0], 3), "ln": round(v[1], 3)} for L, v in lw.items()} for n, lw in lagw.items()}
    return md, out


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--sits", type=int, default=20000)
    ap.add_argument("--puff", type=float, default=60.0, help="a felt puff's direction noise, degrees one sigma")
    ap.add_argument("--part3", action="store_true", help="only the rules for several checks (needs tune.json from a full run)")
    ap.add_argument("--part4", action="store_true", help="only hunting hours (needs tune.json from a full run)")
    args = ap.parse_args()
    df = C.load("seed2-all", 0.6)
    df["t"] = pd.to_datetime(df["hour"] + ":00", utc=True)
    df["rT"] = wrap(df["obsDir"] - df["sdDir"])
    df["rL"] = np.log((df["obsSpd"] + 1) / (df["sdSpd"] + 1))
    df = situation(df)
    if args.part4:
        res = json.loads((OUT / "tune.json").read_text(encoding="utf-8"))
        md4, out4 = part4(df, res, args.sits)
        print("\n".join(md4), flush=True)
        (OUT / "tune-hours.md").write_text("\n".join(["# The check tuner in hunting hours", "", *md4]) + "\n", encoding="utf-8")
        (OUT / "tune-hours.json").write_text(json.dumps(out4, indent=1, default=str), encoding="utf-8")
        return 0
    if args.part3:
        res = json.loads((OUT / "tune.json").read_text(encoding="utf-8"))
        res["lag"] = {int(k): v for k, v in res["lag"].items()}
        md3 = part3(df, res, args.sits)
        print("\n".join(md3), flush=True)
        (OUT / "tune-multi.md").write_text("\n".join(["# The check tuner: the rules for several checks", "", *md3]) + "\n", encoding="utf-8")
        return 0
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
