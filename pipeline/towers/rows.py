"""Tower records in one shared row format, for the floor model (floor.py).

    py -3.14 pipeline/towers/rows.py              # every source below
    py -3.14 pipeline/towers/rows.py US-xTR SMEAR # some (substring match)

Writes raw/towers/rows/<SITE>.csv.gz, one row per averaging interval (30 min;
60 min at US-MMS and Harvard's EMS tower) with a floor and a top wind speed
both present, September to November only. Columns, in this order:

    site, t_utc, lat, lon, canopy_h, z_top, ws_top, wd_top, z_floor, ws_floor,
    wd_floor, ta_hi, z_ta_hi, ta_lo, z_ta_lo, ustar, h_flux

- t_utc: START of the averaging interval, UTC, ISO 8601 ("2019-09-01T00:30Z").
  AmeriFlux TIMESTAMP_START is local standard time (BIF UTC_OFFSET, no DST);
  SMEAR II is UTC+2 all year; Harvard Forest is EST.
- heights in m above ground; speeds m/s; directions FROM, degrees; temperatures
  degC; ustar m/s; h_flux = sensible heat flux, W/m2 (positive up).
- Levels follow fit.py: the floor is the lowest wind sensor at 1.4-3.1 m (other
  sensors in that band fill its gaps, with z_floor per row), else the lowest
  over 1 m; the top is the lowest level above 1.1 x the canopy height, else the
  highest. canopy_h is the BIF HEIGHTC median, else fit.py's SITE table.
- ta_hi / ta_lo: the air ABOVE the stand (SMEAR II: stability measured at the
  floor predicts nothing). ta_hi = the highest temperature level; ta_lo = the
  lowest level at or above the canopy top that is at least 2 m under ta_hi,
  else the highest level below that (the crowns). NaN where there is no pair.
- ustar / h_flux from the above-canopy eddy covariance (NaN where none).

Missing values are empty cells. Another writer (NEON towers) uses the same
format and the same folder; floor.py globs rows/*.csv.gz.
"""
from __future__ import annotations

import csv
import glob
import sys
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
RAW = HERE.parents[0] / "raw"
TOWERS = RAW / "towers"
OUT = TOWERS / "rows"
HEIGHTS = TOWERS / "BASE_MeasurementHeight.csv"
MONTHS = (9, 10, 11)
FLOOR = (1.4, 3.1)
COLS = ["site", "t_utc", "lat", "lon", "canopy_h", "z_top", "ws_top", "wd_top", "z_floor", "ws_floor", "wd_floor",
        "ta_hi", "z_ta_hi", "ta_lo", "z_ta_lo", "ustar", "h_flux"]

sys.path.insert(0, str(HERE))
from fit import SITE, badm_canopy  # noqa: E402  (canopy heights and the BIF reader, as fit.py uses them)


def amf_heights(site: str, prefix: str) -> dict[str, float]:
    """BASE_MeasurementHeight: variable -> height for one prefix (WS_, WD_, TA_), replicates and PI_F left out."""
    out = {}
    for r in csv.DictReader(open(HEIGHTS, encoding="utf-8")):
        v = r["Variable"]
        if r["Site_ID"] == site and v.startswith(prefix) and "MAX" not in v and "PI_F" not in v and r["Height"]:
            out[v] = float(r["Height"])
    return out


def bif(site: str) -> dict[str, str]:
    xs = list((TOWERS / site).glob("*_BIF_*.xlsx"))
    d = pd.read_excel(xs[0])
    return {k: str(g["DATAVALUE"].iloc[0]) for k, g in d.groupby("VARIABLE")}


def pick_ta(tas: dict[str, float], hc: float) -> tuple[str | None, str | None]:
    """ta_hi, ta_lo: the pair that best spans the air above the canopy."""
    if not tas:
        return None, None
    hi = max(tas, key=lambda v: (tas[v], v.endswith("_1")))
    rest = {v: z for v, z in tas.items() if z <= tas[hi] - 2.0}
    if not rest:
        return hi, None
    above = [v for v, z in rest.items() if z >= hc]
    lo = min(above, key=lambda v: rest[v]) if above else max(rest, key=lambda v: rest[v])
    return hi, lo


def first(df: pd.DataFrame, names: list[str]) -> pd.Series:
    """The first of these columns present, its gaps filled from the next ones."""
    s = pd.Series(np.nan, index=df.index)
    for n in names:
        if n in df:
            s = s.fillna(df[n])
    return s


def write(site: str, d: pd.DataFrame) -> int:
    d = d[d.ws_top.notna() & d.ws_floor.notna()].copy()
    d = d[pd.DatetimeIndex(d.t_utc).month.isin(MONTHS)]
    d["site"] = site
    d["t_utc"] = pd.DatetimeIndex(d.t_utc).strftime("%Y-%m-%dT%H:%MZ")
    d = d.drop_duplicates("t_utc").sort_values("t_utc")
    OUT.mkdir(parents=True, exist_ok=True)
    d[COLS].to_csv(OUT / f"{site}.csv.gz", index=False, float_format="%.5g")
    return len(d)


def amf(site: str) -> tuple[str, int, dict]:
    ws = amf_heights(site, "WS_")
    wd = amf_heights(site, "WD_")
    ta = {v: z for v, z in amf_heights(site, "TA_").items() if v.count("_") == 3 and v.endswith("_1")}
    f = next(iter(sorted((TOWERS / site).glob("*_BASE_H*_*.csv"))))
    header = pd.read_csv(f, comment="#", nrows=0).columns
    ws = {v: z for v, z in ws.items() if v in header}
    wd = {v: z for v, z in wd.items() if v in header}
    ta = {v: z for v, z in ta.items() if v in header}
    b = bif(site)
    hc = badm_canopy(site) or SITE[site][1]
    lat, lon, utc = float(b["LOCATION_LAT"]), float(b["LOCATION_LONG"]), float(b["UTC_OFFSET"])
    above = [v for v, z in ws.items() if z > hc * 1.1]
    top = min(above, key=lambda v: (ws[v], not v.endswith("_1"))) if above else max(ws, key=lambda v: ws[v])
    tops = [top] + sorted(v for v, z in ws.items() if z == ws[top] and v != top)  # replicates fill gaps
    under = {v: z for v, z in ws.items() if z < ws[top]}  # the floor is never the top (US-Prr: top 3.0 m)
    band = sorted([v for v, z in under.items() if FLOOR[0] <= z <= FLOOR[1]], key=lambda v: ws[v])
    if not band:
        band = sorted([v for v, z in under.items() if z > 1.0], key=lambda v: ws[v])[:1]
    ta_hi, ta_lo = pick_ta(ta, hc)
    ust = [c for c in ("USTAR", "USTAR_1_1_1", "USTAR_1_1_2") if c in header]
    hfl = [c for c in ("H", "H_1_1_1", "H_1_1_2") if c in header]
    use = set(["TIMESTAMP_START"] + band + tops + [v.replace("WS_", "WD_") for v in band + tops] + ust + hfl
              + [x for x in (ta_hi, ta_lo) if x])
    raw = pd.read_csv(f, comment="#", usecols=lambda c: c in use, na_values=["-9999", -9999], low_memory=False)
    t_loc = pd.to_datetime(raw["TIMESTAMP_START"].astype(str), format="%Y%m%d%H%M")
    keep = t_loc.dt.month.isin(MONTHS) | (t_loc - pd.Timedelta(hours=utc)).dt.month.isin(MONTHS)
    raw, t_loc = raw[keep], t_loc[keep]
    d = pd.DataFrame(index=raw.index)
    d["t_utc"] = t_loc - pd.Timedelta(hours=utc)
    d["lat"], d["lon"], d["canopy_h"] = lat, lon, hc
    d["ws_top"] = first(raw, tops)
    d["wd_top"] = first(raw, [v.replace("WS_", "WD_") for v in tops if v.replace("WS_", "WD_") in wd])
    d["z_top"] = ws[top]
    d["ws_floor"] = np.nan
    d["wd_floor"] = np.nan
    d["z_floor"] = np.nan
    for v in band:  # lowest in the band first, the others fill its gaps
        m = d.ws_floor.isna() & raw[v].notna()
        d.loc[m, "ws_floor"] = raw.loc[m, v]
        w = v.replace("WS_", "WD_")
        if w in raw:
            d.loc[m, "wd_floor"] = raw.loc[m, w]
        d.loc[m, "z_floor"] = ws[v]
    d["ta_hi"] = raw[ta_hi] if ta_hi else np.nan
    d["z_ta_hi"] = ta[ta_hi] if ta_hi else np.nan
    d["ta_lo"] = raw[ta_lo] if ta_lo else np.nan
    d["z_ta_lo"] = ta[ta_lo] if ta_lo else np.nan
    d["ustar"] = first(raw, ust)
    d["h_flux"] = first(raw, hfl)
    name = f"AMF-{site}"
    n = write(name, d)
    info = dict(canopy_h=hc, floor=[(v, ws[v], v.replace("WS_", "WD_") in wd) for v in band], top=[(v, ws[v]) for v in tops],
                ta_hi=(ta_hi, ta.get(ta_hi)), ta_lo=(ta_lo, ta.get(ta_lo)), ustar=ust, h=hfl, utc_offset=utc)
    return name, n, info


def smear() -> tuple[str, int, dict]:
    """SMEAR II (Hyytiala): floor = the 3 m subcanopy EC, top = the 33.6 m sonic, u* and H from the 27 m EC,
    T at 33.6 and 67.2 m, as first_look.py reads them. Times UTC+2."""
    src = RAW / "regimes" / "smear-ii"
    d = pd.concat([pd.read_csv(f, index_col=0, parse_dates=True) for f in sorted(glob.glob(str(src / "smear2_*.csv")))])
    d.columns = [c.split(".")[1] for c in d.columns]
    o = pd.DataFrame(index=d.index)
    o["t_utc"] = d.index - pd.Timedelta(hours=2)
    o["lat"], o["lon"], o["canopy_h"] = 61.8475, 24.2948, 19.0
    o["z_top"], o["ws_top"], o["wd_top"] = 33.6, d.WSU336, d.WDU336
    o["z_floor"], o["ws_floor"], o["wd_floor"] = 3.0, d.U_subm, d.wind_dir_subm
    o["ta_hi"], o["z_ta_hi"], o["ta_lo"], o["z_ta_lo"] = d.T672, 67.2, d.T336, 33.6
    o["ustar"], o["h_flux"] = d.u_star_270, d.H_270
    o = o.reset_index(drop=True)
    return "SMEAR-II", write("SMEAR-II", o), dict(canopy_h=19.0, floor="U_subm 3 m EC", top="WSU336", ta="T336/T672",
                                                   flux="27 m EC")


def harvard() -> tuple[str, int, dict]:
    """Harvard Forest EMS tower (HF004, hourly, 29 m sonic) with the 2 m sonic 14 m W of it (HF288-03, 30 min
    averaged to the hour as first_look.py does). EST. Only 2010-11 to 2012-02, so Sep-Nov is 2011 (and late
    Nov 2010). ta_lo is empty: the profile under 27.9 m starts 2012-01. The floor's absolute direction is
    unverified (it may be 180 deg out; see the README there)."""
    src = RAW / "regimes" / "harvard-forest"
    a = pd.read_csv(src / "hf288-03-sonic-data.csv", parse_dates=["datetime"]).dropna(subset=["wspd.2m"])
    r = np.radians(a["wdir.2m"])
    a["u"] = -a["wspd.2m"] * np.sin(r)
    a["v"] = -a["wspd.2m"] * np.cos(r)
    a["hour"] = a.datetime.dt.floor("h")
    f = a.groupby("hour").agg(ws2=("wspd.2m", "mean"), u=("u", "mean"), v=("v", "mean"))
    f["wd2"] = (np.degrees(np.arctan2(-f.u, -f.v)) + 360) % 360
    b = pd.read_csv(src / "hf004-01-final.csv", parse_dates=["datetime"],
                    usecols=["datetime", "wind.sp", "wind.dir", "f.mom", "f.heat", "ta.27.9m"])
    b = b[(b.datetime >= "2010-11-20") & (b.datetime < "2012-03-05")].set_index("datetime")
    d = f.join(b, how="inner")
    o = pd.DataFrame(index=d.index)
    o["t_utc"] = d.index + pd.Timedelta(hours=5)
    o["lat"], o["lon"], o["canopy_h"] = 42.5378, -72.1715, 23.0
    o["z_top"], o["ws_top"], o["wd_top"] = 29.0, d["wind.sp"], d["wind.dir"]
    o["z_floor"], o["ws_floor"], o["wd_floor"] = 2.0, d.ws2, d.wd2
    o["ta_hi"], o["z_ta_hi"], o["ta_lo"], o["z_ta_lo"] = d["ta.27.9m"], 27.9, np.nan, np.nan
    o["ustar"] = np.sqrt(-d["f.mom"].where(d["f.mom"] < 0)) / 100
    o["h_flux"] = d["f.heat"]
    o = o.reset_index(drop=True)
    return "HF-EMS", write("HF-EMS", o), dict(canopy_h=23.0, floor="2 m CSAT3 (HF288-03)", top="29 m sonic (HF004)",
                                               ta="27.9 m only", note="floor direction unverified")


def main() -> None:
    want = sys.argv[1:]
    jobs = [(s, lambda s=s: amf(s)) for s in sorted(p.name for p in TOWERS.iterdir() if p.is_dir() and p.name.startswith("US-"))]
    jobs += [("SMEAR", smear), ("HF-EMS", harvard)]
    for key, fn in jobs:
        if want and not any(w.lower() in key.lower() for w in want):
            continue
        name, n, info = fn()
        print(f"{name:12s} {n:7d} rows  {info}")


if __name__ == "__main__":
    main()
