"""Forest/open wind pairs: a head-height gauge under the canopy against a nearby open gauge at
about the same height, for the floor-wind scoring.

    py -3.14 pipeline/towers/pairs.py               # fetch what is missing, write every pair + pairs.md
    py -3.14 pipeline/towers/pairs.py MARMOT        # some (substring match on the pair name)

Writes raw/towers/pairs/<PAIR>.csv.gz, one row per averaging interval with both speeds present,
September to November only (by the UTC month), every year available, and raw/towers/pairs/pairs.md
(counts and a first look). Columns, in this order:

    site, t_utc, lat, lon, canopy_h, z_forest, ws_forest, wd_forest, z_open, ws_open, wd_open,
    open_kind, ta, rh, interval_min

- t_utc: START of the averaging interval, UTC, ISO 8601 ("2012-10-01T06:00Z"), as rows.py.
- heights in m above ground; speeds m/s (interval means, as published); directions FROM,
  degrees; ta degC; rh %. lat/lon = the forest gauge. open_kind = clearing | fen | cutblock.
- ta/rh: the OPEN station's (the air the stand sits in; rows.py's reason for using the air
  above the stand), empty where it has none. Every station here measures both.
- canopy_h: empty. Neither package documents a stand height at the forest gauge (the Marcell
  EML names the species only; Fang et al. 2019 call the Marmot stands "mature spruce" and
  "mature lodgepole" with no height).
- wd_forest / wd_open are empty where the gauge gives none or the interval-mean speed is under
  the vane's threshold (the stall, below). Speeds are kept as published at every value: a
  propeller under its starting threshold reads low or 0, so calm shares at a propeller gauge
  are partly the instrument.
- Missing values are empty cells.

Sources, licences, instruments
------------------------------
1. Marcell Experimental Forest, Itasca County MN (USDA FS Northern Research Station).
   Sebestyen & Lany, "Marcell Experimental Forest 30-minute resolution meteorological data,
   2006 - ongoing", EDI edi.859.6, doi:10.6073/pasta/bd5765c89772d6e93c2c5092bb90ac5e, CC BY 4.0
   (cite it; acknowledge the NRS). EDI's API answers 403 to anonymous calls; the DataONE member
   node gmn.edirepository.org serves the EML and the tables (MD5s match the EML).
     S2 forest  47.5132496, -93.4684821  under upland aspen / white birch / red maple / balsam
                fir (last cut in the 1910s), next to the S2S runoff collector; branches trimmed
                round the vane every 1-2 years. Since 2007-11-06.        entity e287aa0b...
     NADP       47.530964, -93.468842   mown-grass clearing in the same upland forest, 1.97 km
                N of S2. Since 2008-05-09; moved ~15 m SE onto a 3 m Rohn tower section on
                2019-10-28.                                                entity e1e7792f...
     Bog Lake   47.505132, -93.489323   44 ha poor fen (leatherleaf, Sphagnum, sparse tamarack
                under 3 m), 1.81 km WSW of S2. Since 2006-10-25.          entity aa6a0857...
   Every station: R.M. Young 05103 wind monitor on a cross bar "about 3 m" up (z = 3.0 here),
   HMP45C T/RH at ~2.5 m, LI190 PAR. 05103 thresholds: propeller 1.0 m/s, vane 1.1 m/s (10 deg
   displacement), so the direction stall here is 1.1 m/s. Under the canopy that leaves very few
   directions: in Sep-Nov 98% of S2's intervals average under 1.0 m/s, 32% read exactly 0 and
   1.4% clear 1.1 m/s. Canopy height at S2: not documented (canopy_h empty).
   Time: the EML says Central Standard Time (no DST: no repeated or missing hours at the spring
   and autumn changes); Campbell stamps mark the END of the 30-min interval (the PAR centroid sits
   ~15 min after solar noon), so t_utc = stamp - 30 min + 6 h. NADP repeats Jan-Nov 2025 three
   times with identical values (deduplicated).
   Pairs: MARCELL-S2-NADP (open_kind clearing), MARCELL-S2-BOG (open_kind fen).

2. Marmot Creek Research Basin, Kananaskis AB (U. Saskatchewan Centre for Hydrology).
   Fang, Pomeroy, DeBeer, Harder & Siemens, "Hydrometeorological data from Marmot Creek Research
   Basin, Canadian Rockies", FRDR, doi:10.20383/101.09, Version 03, CC BY 4.0; described in Fang
   et al. 2019, ESSD 11:455 (cite both). The landing page says "No files"; plain HTTPS works via
   www.frdr-dfdr.ca/repo/files/... (302 to the Globus HTTPS server). Quality-controlled 15-min
   files (Meteorology/Recent_QC_data/*_slim_merge*.txt), 2005 to 2016-09-30 (so the last
   "autumn" is September 2016), -9999 missing; Level Forest has no wind in autumn 2005.
   Heights and instruments from README_v3 and ESSD Table 2, coordinates from Table 2:
     Upper Forest   50.9569, -115.1762, 1848 m  mature Engelmann spruce / subalpine fir;
                    RM Young 05305 at 2.77 m; T/RH 2.33 m
     Upper Clearing 50.9565, -115.1754, 1845 m  forest clearing 70 m from Upper Forest;
                    RM Young 05305 at 2.85 m; T/RH 2.15 m ("wind-sheltered", Fang et al.)
     Level Forest   50.9466, -115.1464, 1492 m  mature lodgepole pine; Met One 50.5 2-D sonic at
                    2.45 m; T/RH 2.27 m
     Hay Meadow     50.9441, -115.1389, 1436 m  open grassland valley floor 0.6 km ESE of Level
                    Forest; RM Young 05305 at 7 m (NOT head height); T/RH 1.86 m
     Vista View     50.9712, -115.1722, 1956 m  large 1970s cut block, sparse young trees;
                    RM Young "05105-10" (as printed; read as the 05103 family) at 4.11 m
   05305 thresholds: propeller 0.4 m/s, vane 0.5 m/s (10 deg) -> direction stall 0.5 m/s. The
   50.5 sonic has no stall (accuracy +-0.2 m/s; its 15-min means sit on a ~0.25 m/s noise floor,
   5% of Sep-Nov intervals under 0.27 m/s, none at 0) -> directions kept from 0.5 m/s, the same
   cut as its partner. 05103 family: 1.1 m/s.
   Time: Fang et al. 2019: "all data are measured in central standard time (CST) ... GMT-6";
   stamps mark the END of the 15-min interval (the open stations' solar centroid sits ~7 min
   after solar noon), so t_utc = stamp - 15 min + 6 h. Autumns 2005 and 2006 are off: the
   stamps run 1 h behind CST (i.e. MST) at Upper Clearing until 2005-11-16, at Level Forest and
   Hay Meadow through autumn 2005, and at all four stations through autumn 2006; the clock check
   shifts them.
   Pairs: MARMOT-UPPERFOREST-UPPERCLEARING (clearing), MARMOT-LEVELFOREST-HAYMEADOW (clearing;
   z_open = 7 m, adjust before comparing ratios with the head-height pairs). Vista View is not
   paired: 1.6 km and 108 m above Upper Forest, its directions agree within 45 deg only 36%
   of the time with Upper Forest's and 28% with Upper Clearing's (69% between those two), so
   it sees another flow.

Clock check (both datasets; every action is listed at the foot of pairs.md)
--------------------------------------------------------------------------
a. Sun, per station, against that station's own median for the same half-month of the year
   (PAR at Marcell, incoming shortwave at Marmot). A departure of a whole hour (|dev| >= 0.7 h
   and within 0.3 h of a whole hour) shifts the stamps back by it; nothing is dropped here.
   - open gauges: per day, the midpoint between the first and last stamp over 10% of the day's
     peak, as a centred 9-day running median; runs of 3+ days. Where the half-month says a
     whole hour and the day does not say the clock was right (|dev| < 0.4 h), the half-month's
     shift fills in (mountain horizons make single Marmot days noisy).
   - forest gauges: per half-month only, the radiation-weighted mean time of day (sunflecks
     make single days useless under a canopy: daily midpoints wander by about an hour).
   Rows that collide after a shift are dropped.
b. Pair, after (a): per 5-day window from Sep 1 (UTC), the lag (+-3 h) that best lines up the
   first differences of the two stations' air temperature. The window is dropped when a lag of
   30 min or more beats lag 0 by over 0.05 in correlation, or the best correlation is under 0.3
   (a broken sensor or clock).
   What it found at Marcell, inside Sep-Nov (CST otherwise): from 2022-11-18/19 into December
   the stamps run 2 h behind at S2 and Bog Lake and 1 h behind at NADP; NADP runs 2 h ahead
   until 2023-09-27; all three run 1 h ahead from about 2025-10-10/15 to 2025-11-02 (daylight
   time); Bog Lake runs ~45 min behind 2017-09-16 to 10-14, with its air temperature unusable
   then (those windows dropped by b).

Vanes (VANE_OFF): a station's direction is blanked where its median difference to every
neighbour stepped by ~100 deg or more for months: NADP from summer 2018 to the end (~+135 deg
against Bog Lake and S2; the 2019 move did not fix it), Upper Forest 2006-10-30 to 2012-10-29
(~-110 deg against Upper Clearing and Vista View), Hay Meadow 2006-10-09 to 2008-06-23 (~-110
deg against Level Forest). Smaller standing offsets remain and are not corrected: S2 reads
~20 deg anticlockwise of Bog Lake and ~40 deg of NADP; Level Forest ~15-30 deg clockwise of
Hay Meadow; whether that is the flow or the vane's north is unknown.
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd
import requests

HERE = Path(__file__).resolve().parent
TOWERS = HERE.parents[0] / "raw" / "towers"
SRC = TOWERS / "src"
OUT = TOWERS / "pairs"
MONTHS = (9, 10, 11)
COLS = ["site", "t_utc", "lat", "lon", "canopy_h", "z_forest", "ws_forest", "wd_forest", "z_open", "ws_open",
        "wd_open", "open_kind", "ta", "rh", "interval_min"]
MAX_BYTES = 2_000_000_000

GMN = "https://gmn.edirepository.org/mn/v2/object/"
PASTA = "https%3A%2F%2Fpasta.lternet.edu%2Fpackage%2F"
MARCELL = {  # name: (entity, file, lat, lon)
    "S2": ("e287aa0b28418604c31698c69157bda6", "S2forest_Met_data_30min.csv", 47.5132496226, -93.4684821369),
    "NADP": ("e1e7792f8465017e133535bccbba4b6c", "NADP_Met_data_30min.csv", 47.530964, -93.468842),
    "BOG": ("aa6a08572b9b08905a21804a0e062e1c", "BogLake_Met_data_30min.csv", 47.505132, -93.489323),
}
FRDR = "https://www.frdr-dfdr.ca/repo/files/6/published/publication_9/submitted_data/Version%2003/"
MARMOT = {  # name: (file, lat, lon, z_wind, direction stall)
    "UPPERFOREST": ("Upper_Forest_15min_2005_16_slim_merge.txt", 50.9569, -115.1762, 2.77, 0.5),
    "UPPERCLEARING": ("Upper_Clearing_15min_2005_16_slim_merge.txt", 50.9565, -115.1754, 2.85, 0.5),
    "LEVELFOREST": ("Level_Forest_15min_2005_16_slim_merge.txt", 50.9466, -115.1464, 2.45, 0.5),
    "HAYMEADOW": ("Hay_Meadow_15min_2005_16_slim_merge_v2.txt", 50.9441, -115.1389, 7.0, 0.5),
    "VISTAVIEW": ("Vista_View_15min_2005_16_slim_merge.txt", 50.9712, -115.1722, 4.11, 1.1),
}
# Vane turned against every neighbour for months on end (station-local dates, end None = to the end of the
# record): directions blanked, speeds kept. Found by the median direction difference to each other station.
VANE_OFF = {
    "NADP": [("2018-06-01", None)],                    # ~+135 deg against Bog Lake and S2 from summer 2018 on
    "UPPERFOREST": [("2006-10-30", "2012-10-29")],     # ~-110 deg against Upper Clearing, Vista View
    "HAYMEADOW": [("2006-10-09", "2008-06-23")],       # ~-110 deg against Level Forest, ~-80 against Vista View
}
_fetched = 0


def vane_off(s: pd.DataFrame, name: str) -> pd.DataFrame:
    for lo, hi in VANE_OFF.get(name, []):
        s.loc[(s.index >= lo) & ((s.index < hi) if hi else True), "wd"] = np.nan
    return s


def fetch(url: str, path: Path) -> Path:
    """Download once (a file already there is kept); prints the size; stops past MAX_BYTES in all."""
    global _fetched
    if path.exists() and path.stat().st_size > 0:
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    with requests.get(url, stream=True, timeout=120, allow_redirects=True) as r:
        r.raise_for_status()
        size = int(r.headers.get("Content-Length") or 0)
        if _fetched + size > MAX_BYTES:
            raise SystemExit(f"stop: {url} would take the downloads past {MAX_BYTES / 1e9:.0f} GB")
        tmp = path.with_suffix(path.suffix + ".part")
        with open(tmp, "wb") as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)
        tmp.replace(path)
    _fetched += path.stat().st_size
    print(f"  fetched {path.relative_to(TOWERS)}  {path.stat().st_size / 1e6:.1f} MB  (total {_fetched / 1e6:.0f} MB)")
    return path


def sun_elev(t: pd.DatetimeIndex, lat: float, lon: float) -> np.ndarray:
    """Solar elevation, degrees, at UTC times (USNO low-precision formulae, ~0.1 deg)."""
    d = (t - pd.Timestamp("2000-01-01 12:00")).total_seconds().to_numpy() / 86400.0
    g = np.radians((357.529 + 0.98560028 * d) % 360)
    q = (280.459 + 0.98564736 * d) % 360
    lam = np.radians(q + 1.915 * np.sin(g) + 0.020 * np.sin(2 * g))
    eps = np.radians(23.439 - 0.00000036 * d)
    ra = np.arctan2(np.cos(eps) * np.sin(lam), np.cos(lam))
    dec = np.arcsin(np.sin(eps) * np.sin(lam))
    ha = np.radians(((18.697374558 + 24.06570982441908 * d) % 24) * 15 + lon) - ra
    la = np.radians(lat)
    return np.degrees(np.arcsin(np.sin(la) * np.sin(dec) + np.cos(la) * np.cos(dec) * np.cos(ha)))


def _dev(x: pd.Series) -> pd.Series:
    """Departure from the station's median for the same half-month of the year (>= 3 years)."""
    moy = x.index.strftime("%m") + np.where(x.index.day <= 15, "a", "b")
    yrs = pd.Series(x.index.year, index=x.index).groupby(moy).transform("nunique")
    return (x - x.groupby(moy).transform("median")).where(yrs >= 3).dropna()


def _whole_hours(dev: pd.Series) -> pd.Series:
    """Hours to add to the stamps where the departure is a whole hour (|dev| >= 0.7 h, within 0.3 h of one)."""
    w = dev.round()
    act = (-w).where((dev.abs() >= 0.7) & ((dev - w).abs() <= 0.3), 0.0)
    return act[act != 0]


def solar_clock(st: pd.DataFrame, is_open: bool, name: str, log: list) -> pd.DataFrame:
    """Check (a): whole-hour clock errors found from the sun, shifted back (see the docstring)."""
    r = st["rad"].dropna()
    r = r[r.index.month.isin((8, 9, 10, 11, 12))]
    if r.empty:
        return st
    # per half-month: the radiation-weighted mean time of day
    key = r.index.strftime("%Y-%m-") + np.where(r.index.day <= 15, "01", "16")
    cen = {}
    for k, g in r.groupby(key):
        h = g.groupby(g.index.hour + g.index.minute / 60).mean()
        h = h - h.min()
        if g.index.normalize().nunique() >= 8 and h.sum() > 0:
            cen[pd.Timestamp(k)] = float((h.index * h).sum() / h.sum())
    hm = _dev(pd.Series(cen, dtype=float).sort_index())
    days = pd.date_range(r.index.min().normalize(), r.index.max().normalize(), freq="D")
    days = days[days.month.isin(MONTHS)]
    dev_hm = pd.Series(hm.reindex(days.to_period("M").to_timestamp()
                                  + pd.to_timedelta(np.where(days.day <= 15, 0, 15), unit="D")).to_numpy(), index=days)
    act = _whole_hours(dev_hm.dropna())
    dev = dev_hm
    if is_open:  # per day: midpoint of the first and last stamp over 10% of the day's peak, 9-day running median
        full = r.groupby(r.index.normalize()).size().median()
        mid = {}
        for day, g in r.groupby(r.index.normalize()):
            on = g[g > max(0.1 * g.max(), 5.0)]
            if len(g) >= 0.8 * full and len(on) >= 4:
                h = on.index.hour + on.index.minute / 60
                mid[day] = (h.min() + h.max()) / 2
        dev = _dev(pd.Series(mid, dtype=float).sort_index()).rolling("9D", center=True, min_periods=5).median()
        dev = dev[dev.index.month.isin(MONTHS)]
        daily = _whole_hours(dev)
        runs = (daily.diff() != 0) | (daily.index.to_series().diff() != pd.Timedelta(days=1))
        daily = daily.groupby(runs.cumsum()).filter(lambda g: len(g) >= 3)
        # the half-month answer only where the day's own reading does not say the clock was right
        act = act[~act.index.isin(dev[dev.abs() < 0.4].index)]
        act = pd.concat([daily, act[~act.index.isin(daily.index)]]).sort_index()
        dev = dev.combine_first(dev_hm)
    if act.empty:
        return st
    runs = (act.diff() != 0) | (act.index.to_series().diff() != pd.Timedelta(days=1))
    for _, g in act.groupby(runs.cumsum()):
        log.append(f"{name} {g.index[0]:%Y-%m-%d}..{g.index[-1]:%Y-%m-%d}: sun {dev.reindex(g.index).median():+.2f} h "
                   f"-> stamps {g.iloc[0]:+.0f} h")
    shift = act.reindex(st.index.normalize()).fillna(0.0).to_numpy()
    st = st.copy()
    st.index = st.index + pd.to_timedelta(shift, unit="h")
    return st[~st.index.duplicated(keep=False)].sort_index()


def lag_windows(f: pd.Series, o: pd.Series, step_min: int, name: str, log: list) -> pd.DatetimeIndex:
    """Check (b): 5-day Sep-Nov windows (UTC starts) where the two stations' air temperature is out of step."""
    lo, hi = max(f.index.min(), o.index.min()), min(f.index.max(), o.index.max())
    grid = pd.date_range(lo.floor("D"), hi.ceil("D"), freq=f"{step_min}min")
    a, b = f.reindex(grid).to_numpy(), o.reindex(grid).to_numpy()
    L = 180 // step_min
    bad = []
    for y in range(grid[0].year, grid[-1].year + 1):
        for w0 in pd.date_range(f"{y}-09-01", f"{y}-11-30", freq="5D"):
            i0 = grid.searchsorted(w0)
            i1 = grid.searchsorted(min(w0 + pd.Timedelta(days=5), pd.Timestamp(f"{y}-12-01")))
            if i0 - L < 0 or i1 + L > len(grid) or i1 - i0 < 50:
                continue
            da = np.diff(a[i0:i1])
            best, c0 = (0, -2.0), np.nan
            for l in range(-L, L + 1):
                db = np.diff(b[i0 - l:i1 - l])
                m = np.isfinite(da) & np.isfinite(db)
                if m.sum() < 100:
                    best = None
                    break
                c = np.corrcoef(da[m], db[m])[0, 1]
                if l == 0:
                    c0 = c
                if c > best[1]:
                    best = (l, c)
            if best is None:
                continue
            l, c = best
            if (l != 0 and abs(l) * step_min >= 30 and c - c0 > 0.05) or c < 0.3:
                bad.append(w0)
                log.append(f"{name} {w0:%Y-%m-%d}+5d: air temperature lag {l * step_min:+d} min (r {c:.2f} vs {c0:.2f} at 0) -> dropped")
    return pd.DatetimeIndex(bad)


def make_pair(name: str, f: pd.DataFrame, o: pd.DataFrame, meta: dict, step_min: int, log: list) -> pd.DataFrame:
    """f, o: station frames on UTC interval-START stamps (ta, rh, ws, wd); meta: lat, lon, z_forest, z_open,
    stall_forest, stall_open, open_kind."""
    bad = lag_windows(f["ta"], o["ta"], step_min, name, log)
    d = f.join(o, how="inner", lsuffix="_f", rsuffix="_o")
    d = d[d.ws_f.notna() & d.ws_o.notna() & d.index.month.isin(MONTHS)]
    for w0 in bad:
        d = d[(d.index < w0) | (d.index >= w0 + pd.Timedelta(days=5))]
    out = pd.DataFrame(index=d.index)
    out["site"] = name
    out["t_utc"] = d.index.strftime("%Y-%m-%dT%H:%MZ")
    out["lat"], out["lon"], out["canopy_h"] = meta["lat"], meta["lon"], np.nan
    out["z_forest"], out["ws_forest"] = meta["z_forest"], d.ws_f
    out["wd_forest"] = d.wd_f.where(d.ws_f >= meta["stall_forest"])
    out["z_open"], out["ws_open"] = meta["z_open"], d.ws_o
    out["wd_open"] = d.wd_o.where(d.ws_o >= meta["stall_open"])
    out["open_kind"] = meta["open_kind"]
    out["ta"], out["rh"] = d.ta_o, d.rh_o
    out["interval_min"] = step_min
    for c in ("wd_forest", "wd_open"):
        out[c] = out[c] % 360
    out = out.sort_index()
    OUT.mkdir(parents=True, exist_ok=True)
    out[COLS].to_csv(OUT / f"{name}.csv.gz", index=False, float_format="%.5g")
    return out


def to_utc_start(st: pd.DataFrame, step_min: int, utc_offset_h: int) -> pd.DataFrame:
    st = st.copy()
    st.index = st.index - pd.Timedelta(minutes=step_min) - pd.Timedelta(hours=utc_offset_h)
    return st


def marcell(log: list) -> list[tuple[str, pd.DataFrame, dict]]:
    src = SRC / "marcell"
    fetch(GMN + PASTA + "metadata%2Feml%2Fedi%2F859%2F6", src / "edi.859.6.xml")
    st = {}
    for k, (ent, fn, lat, lon) in MARCELL.items():
        p = fetch(GMN + PASTA + "data%2Feml%2Fedi%2F859%2F6%2F" + ent, src / fn)
        d = pd.read_csv(p, na_values=["NA"], parse_dates=["TIMESTAMP"]).drop_duplicates()
        d = d.drop_duplicates("TIMESTAMP", keep=False).set_index("TIMESTAMP").sort_index()
        s = pd.DataFrame({"ta": d.Air_TempC_Avg, "rh": d.RH, "ws": d.WS_Tot, "wd": d.WindDir_D, "rad": d.PAR_Den_Avg})
        s = solar_clock(vane_off(s, k), is_open=(k != "S2"), name=f"Marcell {k}", log=log)
        st[k] = to_utc_start(s, 30, -6)
    f = st["S2"]
    meta = dict(lat=MARCELL["S2"][2], lon=MARCELL["S2"][3], z_forest=3.0, z_open=3.0, stall_forest=1.1, stall_open=1.1)
    res = []
    for k, kind in (("NADP", "clearing"), ("BOG", "fen")):
        name = f"MARCELL-S2-{k}"
        res.append((name, make_pair(name, f, st[k], dict(meta, open_kind=kind), 30, log), meta | {"open_kind": kind}))
    return res


def marmot(log: list) -> list[tuple[str, pd.DataFrame, dict]]:
    src = SRC / "marmot"
    fetch(FRDR + "README_v3.txt", src / "README_v3.txt")
    st = {}
    for k in ("UPPERFOREST", "UPPERCLEARING", "LEVELFOREST", "HAYMEADOW"):
        fn = MARMOT[k][0]
        p = fetch(FRDR + "Meteorology/Recent_QC_data/" + fn, src / fn)
        d = pd.read_csv(p, skiprows=[0, 2, 3], na_values=[-9999, "-9999"], low_memory=False)
        d.index = pd.to_datetime(d.TIMESTAMP)
        d = d[~d.index.duplicated(keep=False)].sort_index()
        s = pd.DataFrame({"ta": d["Air Temperature"], "rh": d["Relative Humidity"], "ws": d["Wind Speed"],
                          "wd": d["Wind Direction"], "rad": d["Incoming Solar Radiation"]})
        s = solar_clock(vane_off(s, k), is_open=("FOREST" not in k), name=f"Marmot {k}", log=log)
        st[k] = to_utc_start(s, 15, -6)
    res = []
    for fk, ok, kind in (("UPPERFOREST", "UPPERCLEARING", "clearing"), ("LEVELFOREST", "HAYMEADOW", "clearing")):
        _, lat, lon, zf, sf = MARMOT[fk]
        _, _, _, zo, so = MARMOT[ok]
        meta = dict(lat=lat, lon=lon, z_forest=zf, z_open=zo, stall_forest=sf, stall_open=so, open_kind=kind)
        name = f"MARMOT-{fk}-{ok}"
        res.append((name, make_pair(name, st[fk], st[ok], meta, 15, log), meta))
    return res


BANDS = [("night", -90, -6), ("dawn/dusk", -6, 10), ("day", 10, 90)]


def first_look(d: pd.DataFrame, meta: dict) -> str:
    t = pd.DatetimeIndex(d.index) + pd.Timedelta(minutes=int(d.interval_min.iloc[0]) / 2)
    el = sun_elev(t, meta["lat"], meta["lon"])
    yrs = d.groupby(d.index.year).size()
    lines = [f"Years {yrs.index.min()}-{yrs.index.max()}, {len(d):,} Sep-Nov intervals of {int(d.interval_min.iloc[0])} min "
             f"(z_forest {meta['z_forest']} m, z_open {meta['z_open']} m, open_kind {meta['open_kind']}).", "",
             "Per year: " + ", ".join(f"{y} {n:,}" for y, n in yrs.items()), "",
             "| hour band | ws_open | n | median ws_forest/ws_open | mean ws_forest / mean ws_open |",
             "|---|---|---:|---:|---:|"]
    for bn, lo, hi in BANDS:
        b = (el >= lo) & (el < hi)
        for gn, g in (("< 1.5 m/s (> 0)", (d.ws_open > 0) & (d.ws_open < 1.5)), (">= 1.5 m/s", d.ws_open >= 1.5)):
            x = d[b & g]
            if len(x) == 0:
                lines.append(f"| {bn} | {gn} | 0 | | |")
                continue
            lines.append(f"| {bn} | {gn} | {len(x):,} | {(x.ws_forest / x.ws_open).median():.2f} | "
                         f"{x.ws_forest.mean() / x.ws_open.mean():.2f} |")
    calm = (d.ws_forest < 0.3).mean()
    both = d.wd_forest.notna() & d.wd_open.notna()
    dd = ((d.wd_forest[both] - d.wd_open[both] + 180) % 360 - 180).abs()
    calm_b = ", ".join(f"{bn} {(d.ws_forest[(el >= lo) & (el < hi)] < 0.3).mean():.0%}" for bn, lo, hi in BANDS)
    lines += ["", f"Forest calm (ws_forest < 0.3 m/s): {calm:.0%} of intervals ({calm_b}).",
              f"Both directions present (above both stalls): {both.sum():,} intervals; forest within 45 deg of open: "
              f"{(dd <= 45).mean():.0%}" + (f" (median |difference| {dd.median():.0f} deg)." if both.any() else ".")]
    return "\n".join(lines)


NOTES = """Ratios: median of the per-interval ratio (intervals with ws_open > 0 only) and the ratio of the band's
mean speeds. Hour bands by the sun's elevation at the middle of the interval at the forest gauge:
night < -6 deg, dawn/dusk -6 to +10 deg (civil twilight through roughly the first and last 1.5 h
of sun in autumn), day > 10 deg. Directions only where both interval-mean speeds clear the vane
stall (Marcell 05103: 1.1 m/s; Marmot 05305: 0.5 m/s; Level Forest's sonic: 0.5 m/s cut) and
outside the blanked vane periods (NADP from mid-2018; Upper Forest 2006-10-30 to 2012-10-29;
Hay Meadow 2006-10-09 to 2008-06-23: each turned ~110-135 deg against all its neighbours).

Read with care:
- Marcell: every gauge is an R.M. Young 05103 (starts at 1.0 m/s). In Sep-Nov S2 averages under
  1.0 m/s in 98% of intervals and reads exactly 0 in 32%, so its speeds below ~1 m/s are "below
  threshold", not measurements: the calm share and the medians are mostly the instrument (the
  ratio of means holds up better). Its directions exist only in the 1.4% of intervals over
  1.1 m/s, i.e. strong-wind days. NADP's mown clearing is itself sheltered (Sep-Nov max 2.8 m/s,
  ws_open >= 1.5 in 2% of intervals); Bog Lake is the better open reference (>= 1.5 in 43%).
- Marmot: Upper Clearing is a sheltered clearing (Fang et al. 2019 group it with the forest
  stations, 0.1-0.6 m/s 11-year means), 70 m from Upper Forest. Hay Meadow's wind is at 7 m over
  open grass: a log profile with z0 ~0.03 m makes 2.5 m about 0.8 of 7 m, so head-height ratios
  against it would be ~1.2x the table's. Level Forest is a 2-D sonic whose 15-min means sit on a
  ~0.25 m/s floor, so its calm share is near zero by construction and its low-wind ratios are
  inflated (night < 1.5 m/s reads ~0.75).
- Vista View (cut block, 4.11 m) was tested and not paired: hourly speed r = 0.62-0.63 with
  Upper Forest and Upper Clearing, but directions (Sep-Nov, both over their stalls, bad vane
  periods out) agree within 45 deg only 36% with Upper Forest and 28% with Upper Clearing
  (median offset 35-40 deg), against 69% between Upper Forest and Upper Clearing. It sits
  1.6 km away and 108 m higher, in another slope's flow.
- Clock fixes and dropped windows are listed at the foot of this page; t_utc is CST + 6 h
  after them.
"""


def main() -> None:
    want = sys.argv[1:]
    jobs = [("MARCELL", marcell), ("MARMOT", marmot)]
    t0 = time.time()
    done, log = [], []
    for key, fn in jobs:
        if want and not any(w.lower() in key.lower() for w in want):
            continue
        for name, d, meta in fn(log):
            done.append((name, d, meta))
            print(f"{name:34s} {len(d):8,d} rows  {d.index.min():%Y-%m-%d} .. {d.index.max():%Y-%m-%d}  -> {OUT / (name + '.csv.gz')}")
    for line in log:
        print("  clock:", line)
    if not want:
        md = ["# Forest / open wind pairs: first look", "",
              "Written by pipeline/towers/pairs.py (see its docstring for sources, heights, units, time and stalls). "
              f"Sep-Nov only, {time.strftime('%Y-%m-%d')}.", "", NOTES]
        for name, d, meta in done:
            md += [f"## {name}", "", first_look(d, meta), ""]
        md += ["## Clock check log", "", *[f"- {line}" for line in log], ""]
        (OUT / "pairs.md").write_text("\n".join(md), encoding="utf-8")
        print(f"wrote {OUT / 'pairs.md'}  ({time.time() - t0:.0f} s)")


if __name__ == "__main__":
    main()
