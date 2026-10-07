"""Floor wind over above-canopy wind at the AmeriFlux towers (SCALE-PLAN.md
phase 1): the ratio the bake guesses with in_stand() (build_microclimate),
measured for years.

    python pipeline/towers/fit.py            # all sites in raw/towers
    python pipeline/towers/fit.py US-xBN     # one

Per site: the floor level (the lowest WS at 1.5-3 m, else the lowest over
1 m), the reference level (the lowest WS above the canopy top, else the
top), Sep-Nov of every year, 30-min rows with both present and the
reference >= 0.5 m/s. The ratio by reference speed, by day/night, by the
air's layering (the tower's own TA at the reference and floor levels:
warmer aloft = stable), and in leaf (Sep) against bare (Nov) where the
stand is deciduous. Writes raw/towers/fit.json and prints a table."""
from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

RAW = Path(__file__).resolve().parents[1] / "raw" / "towers"
HEIGHTS = RAW / "BASE_MeasurementHeight.csv"
MONTHS = (9, 10, 11)
BINS = [0.5, 1, 2, 3, 5, 8, 30]  # reference speed, m/s
# the floor the hunter stands on: a sensor in this band
FLOOR = (1.4, 3.1)

# canopy height (m) and deciduous share, from the BADM / site pages, when the
# BIF has no HEIGHTC; checked 2026-10-07 (docs/research/canopy-wind-sites.md)
SITE = {
    "US-Prr": ("Poker Flat AK, open black spruce", 3.0, 0.0),
    "US-Uaf": ("Fairbanks AK, open black spruce", 4.0, 0.0),
    "US-xBN": ("NEON Bonanza Creek AK, black spruce", 6.4, 0.1),
    "US-xDJ": ("NEON Delta Junction AK, spruce + aspen", 6.1, 0.3),
    "US-xST": ("NEON Steigerwaldt WI, aspen/maple regrowth", 9.5, 0.9),
    "US-xTR": ("NEON Treehaven WI, mixedwood", 24.0, 0.5),
    "US-xUN": ("NEON UNDERC MI, northern hardwood-mixed", 24.0, 0.7),
    "US-xHA": ("NEON Harvard MA, hardwood + hemlock", 26.0, 0.8),
    "US-xRM": ("NEON Rocky Mtn CO, lodgepole pine", 19.0, 0.0),
    "US-MMS": ("Morgan-Monroe IN, hardwood", 27.0, 1.0),
}


def heights(site: str) -> dict[str, float]:
    out = {}
    for r in csv.DictReader(open(HEIGHTS, encoding="utf-8")):
        if r["Site_ID"] == site and r["Variable"].startswith("WS_") and "MAX" not in r["Variable"] and "PI_F" not in r["Variable"] and r["Height"]:
            out[r["Variable"]] = float(r["Height"])
    return out


def badm_canopy(site: str) -> float | None:
    xs = list((RAW / site).glob("*_BIF_*.xlsx"))
    if not xs:
        return None
    df = pd.read_excel(xs[0])
    hc = df[df["VARIABLE"] == "HEIGHTC"]
    if hc.empty:
        return None
    return float(pd.to_numeric(hc["DATAVALUE"], errors="coerce").dropna().median())


def in_stand(h: float, crown: float, conifer: float) -> float:
    """build_microclimate.in_stand, for one stand: the bake's guess of the 2 m share of the 10 m wind."""
    zc0 = max(0.1 * h, 0.3)
    d = 0.67 * h
    f_top = np.log(max(h - d, 0.5) / zc0) / np.log(10 / zc0)
    a = 1.0 + 2.2 * min(max(crown, 0.2), 1) + 0.6 * min(max(conifer, 0), 1)
    return float(f_top * np.exp(-a * (1 - 2 / max(h, 2.1))))


def fit_site(site: str) -> dict | None:
    hs = heights(site)
    if not hs:
        print(site, "no heights"); return None
    name, h_can, decid = SITE.get(site, (site, None, 0.5))
    hc = badm_canopy(site) or h_can
    floor = [v for v, z in hs.items() if FLOOR[0] <= z <= FLOOR[1]]
    if not floor:
        floor = [v for v, z in hs.items() if 1.0 <= z <= 4.5]
    if not floor:
        print(site, "no floor level in", hs); return None
    fv = min(floor, key=lambda v: abs(hs[v] - 2.0))
    above = [v for v, z in hs.items() if z > (hc or 0) * 1.1]
    rv = min(above, key=lambda v: hs[v]) if above else max(hs, key=lambda v: hs[v])
    f = next(iter(sorted((RAW / site).glob("*_BASE_H*_*.csv"))), None)
    if f is None:
        print(site, "no BASE csv"); return None
    use = ["TIMESTAMP_START", fv, rv] + [c for c in ("TA_1_1_1", "TA_1_5_1", "TA_1_4_1", "TA_1_6_1", "USTAR", "H", "SW_IN_1_1_1", "SW_IN") if True]
    df = pd.read_csv(f, comment="#", usecols=lambda c: c in use, na_values=["-9999"], low_memory=False)
    ts = pd.to_datetime(df["TIMESTAMP_START"].astype(str), format="%Y%m%d%H%M")
    df = df[ts.dt.month.isin(MONTHS)].copy()
    ts = ts[ts.dt.month.isin(MONTHS)]
    df["hour"] = ts.dt.hour
    df["month"] = ts.dt.month
    df["year"] = ts.dt.year
    ok = df[fv].notna() & df[rv].notna() & (df[rv] >= 0.5)
    df = df[ok].copy()
    df["ratio"] = df[fv] / df[rv]
    sw = next((c for c in ("SW_IN_1_1_1", "SW_IN") if c in df), None)
    df["day"] = (df[sw] > 20) if sw else df["hour"].between(9, 16)
    # stability: the tower's own layering, warmer aloft than at the floor = stable
    ta_top = "TA_1_1_1" if "TA_1_1_1" in df else None
    ta_low = next((c for c in ("TA_1_5_1", "TA_1_6_1", "TA_1_4_1") if c in df), None)
    if ta_top and ta_low:
        d = df[ta_top] - df[ta_low]
        df["stab"] = np.where(d > 0.5, "stable", np.where(d < -0.5, "unstable", "neutral"))
    elif "H" in df:
        df["stab"] = np.where(df["H"] < -10, "stable", np.where(df["H"] > 30, "unstable", "neutral"))
    else:
        df["stab"] = "unknown"
    out = {"site": site, "name": name, "canopy_m": hc, "floor": [fv, hs[fv]], "ref": [rv, hs[rv]],
           "n": int(len(df)), "years": sorted(int(y) for y in df["year"].unique()),
           "median": float(df["ratio"].median()),
           "by_speed": {}, "by_daynight": {}, "by_stab": {}, "by_month": {},
           "bake_guess": {"closed": in_stand(hc, 0.8, 1 - decid), "open": in_stand(hc, 0.4, 1 - decid)} if hc else None}
    cut = pd.cut(df[rv], BINS)
    for k, g in df.groupby(cut, observed=True):
        out["by_speed"][f"{k.left}-{k.right}"] = [float(g["ratio"].median()), int(len(g))]
    for k, g in df.groupby("day"):
        out["by_daynight"]["day" if k else "night"] = [float(g["ratio"].median()), int(len(g))]
    for k, g in df.groupby("stab"):
        out["by_stab"][k] = [float(g["ratio"].median()), int(len(g))]
    for k, g in df.groupby("month"):
        out["by_month"][int(k)] = [float(g["ratio"].median()), int(len(g))]
    return out


def main() -> None:
    sites = sys.argv[1:] or sorted(p.name for p in RAW.iterdir() if p.is_dir() and p.name.startswith("US-"))
    res = [r for r in (fit_site(s) for s in sites) if r]
    (RAW / "fit.json").write_text(json.dumps(res, indent=1))
    print(f"\n{'site':7s} {'canopy':>6s} {'floor':>6s} {'ref':>6s} {'n':>6s} {'median':>6s}  {'day':>5s} {'night':>5s}  {'stable':>6s} {'neutr':>6s} {'unst':>6s}   {'Sep':>5s} {'Oct':>5s} {'Nov':>5s}   bake closed/open")
    for r in res:
        bs, bd, bm = r["by_stab"], r["by_daynight"], r["by_month"]
        g = r["bake_guess"] or {}
        print(f"{r['site']:7s} {r['canopy_m'] or 0:6.1f} {r['floor'][1]:6.2f} {r['ref'][1]:6.2f} {r['n']:6d} {r['median']:6.2f}  "
              f"{bd.get('day', [np.nan])[0]:5.2f} {bd.get('night', [np.nan])[0]:5.2f}  "
              f"{bs.get('stable', [np.nan])[0]:6.2f} {bs.get('neutral', [np.nan])[0]:6.2f} {bs.get('unstable', [np.nan])[0]:6.2f}   "
              f"{bm.get(9, [np.nan])[0]:5.2f} {bm.get(10, [np.nan])[0]:5.2f} {bm.get(11, [np.nan])[0]:5.2f}   "
              f"{g.get('closed', np.nan):.3f} / {g.get('open', np.nan):.3f}")
    print("\nby reference speed (m/s): median ratio [n]")
    for r in res:
        print(f"{r['site']:7s} " + "  ".join(f"{k}: {v[0]:.2f} [{v[1]}]" for k, v in r["by_speed"].items()))


if __name__ == "__main__":
    main()
