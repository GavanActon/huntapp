"""First look at the NEON forested towers: does the floor follow the wind above the trees?

    py -3.14 pipeline/towers/neon_look.py            # every raw/towers/rows/NEON-*.csv.gz
    py -3.14 pipeline/towers/neon_look.py GRSM MLBS  # some

Reads the rows written by neon.py, the site notes in raw/regimes/neon/<SITE>/ and the AOP
DTM tiles; writes raw/regimes/neon/first_look.md and first_look.json.

Same classes, thresholds and table layout as raw/regimes/smear-ii/first_look.py, so the
numbers compare one to one, with two NEON changes from the brief: calm floor = under
0.3 m/s (the 2D sonics' direction is unreliable below it, SMEAR used 0.25), and "follows"
is the share of NON-calm half-hours with the floor within 45 deg of the top (SMEAR's
within45 counted calm half-hours in the denominator; that column is kept as within45_all).
Half-hours with the top under 1.5 m/s are left out, as at SMEAR II.

Stability is read ABOVE the canopy (SMEAR II: stability at the floor predicts nothing).
NEON's eddy covariance (DP4.00200, HDF5) is out of scope, so z/L comes from the
temperature pair above the stand (ta_lo, ta_hi) and the top wind by Monin-Obukhov
similarity: d = 0.67 h, z0 = 0.1 h, Paulson (unstable) and Beljaars-Holtslag (stable)
stability functions, solved for L; zeta = 0.73 h / L, the height SMEAR II's 27 m sits at
over its ~19 m stand ((27 - 13) / L), or (z_top - d) / L under a canopy of less than 5 m.
h = canopy_h from the rows (the CHM's p90 within 100 m). The gradient zeta is multiplied by
RSL = 1.5, a roughness-sublayer factor fitted to the eddy-covariance check below; the
very stable class from gradients stays unreliable (about 1 in 4 caught), so read stable and
very stable together where it matters. Before solving, each site-year's temperature pair is
zeroed on its well-mixed half-hours (top in its windiest 10% and >= 3 m/s): two aspirated
sensors 10 m apart disagree by tenths of a degree, which at low wind is the whole class.
The method is checked against eddy-covariance z/L where rows with ustar and h_flux exist
(AmeriFlux's NEON mirrors and SMEAR II, from rows.py).

Terrain from the AOP DTM (1 m, averaged to 5 m): slope and downslope bearing from a plane
fitted within 150 m of the tower; TPI = mean height within 50 m minus the mean within 500 m
(and 1000 m), standardised by the spread of TPI500 over the 2 km around the tower.
"""
from __future__ import annotations

import glob
import json
import math
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "raw" / "regimes" / "neon"
ROWS = ROOT / "raw" / "towers" / "rows"
TOP_MIN, CALM = 1.5, 0.3          # m/s at the top; m/s at the floor
KAPPA, G = 0.4, 9.81
SLOPED, GENTLE, FLAT = 5.0, 3.0, 2.0   # deg
# Roughness-sublayer factor on the gradient zeta: just above the crowns the temperature
# gradient is weaker than Monin-Obukhov expects, so the gradient under-calls stable air.
# 1.5 maximised class agreement with eddy-covariance zeta at the seven NEON mirrors and
# SMEAR II (81.5%; stable hit 59% -> 75%, false stable 4% -> 6%), checked 2026-10-12.
RSL = 1.5
CLASSES = ["unstable", "neutral", "stable", "very stable"]
AMF = {"BONA": "US-xBN", "DEJU": "US-xDJ", "HARV": "US-xHA", "RMNP": "US-xRM", "STEI": "US-xST",
       "TREE": "US-xTR", "UNDE": "US-xUN"}


# ---------------------------------------------------------------- shared with smear-ii/first_look.py

def solar_elev(t_utc: pd.DatetimeIndex, lat: float, lon: float) -> np.ndarray:
    t = pd.DatetimeIndex(t_utc).tz_localize(None) + pd.Timedelta(minutes=15)   # mid-interval, UTC
    doy = t.dayofyear.values; hr = t.hour.values + t.minute.values / 60
    g = 2 * np.pi / 365 * (doy - 1 + (hr - 12) / 24)
    decl = (0.006918 - 0.399912*np.cos(g) + 0.070257*np.sin(g) - 0.006758*np.cos(2*g)
            + 0.000907*np.sin(2*g) - 0.002697*np.cos(3*g) + 0.00148*np.sin(3*g))
    eqt = 229.18 * (0.000075 + 0.001868*np.cos(g) - 0.032077*np.sin(g) - 0.014615*np.cos(2*g) - 0.040849*np.sin(2*g))
    ha = np.radians((hr*60 + eqt + 4*lon) / 4 - 180); la = np.radians(lat)
    return np.degrees(np.arcsin(np.sin(la)*np.sin(decl) + np.cos(la)*np.cos(decl)*np.cos(ha)))


def resultant(deg) -> float:
    r = np.radians(pd.Series(deg).dropna())
    return float(np.hypot(np.sin(r).mean(), np.cos(r).mean())) if len(r) else np.nan


def circ_mean(deg) -> float:
    r = np.radians(pd.Series(deg).dropna())
    return float(np.degrees(np.arctan2(np.sin(r).mean(), np.cos(r).mean())) % 360) if len(r) else np.nan


def cls(z):
    return pd.cut(z, [-1e9, -0.1, 0.1, 1, 1e9], labels=CLASSES)


def table(x: pd.DataFrame, by) -> pd.DataFrame:
    x = x[x.ws_top >= TOP_MIN]
    rows = []
    for k, g in x.groupby(by, observed=True):
        calm = g.ws_floor < CALM
        h = g[~calm]
        hd = h[h.adiff.notna()]
        rows.append(dict(group=k, halfhours=len(g), calm_floor=calm.mean(),
                         follows=(hd.adiff <= 45).mean() if len(hd) else np.nan,
                         within45_all=(hd.adiff <= 45).sum() / len(g),
                         turned45_90=((hd.adiff > 45) & (hd.adiff <= 90)).sum() / len(g),
                         against90=(hd.adiff > 90).sum() / len(g),
                         decoupled=(calm | (g.adiff > 90)).mean(),
                         ratio_med=g.ratio.median(), R_turn=resultant(hd.turn), R_floor=resultant(hd.wd_floor)))
    return pd.DataFrame(rows).set_index("group") if rows else pd.DataFrame()


# ---------------------------------------------------------------- stability above the canopy

def psi_m(z):
    z = np.asarray(z, float); out = np.zeros_like(z)
    u = z < 0
    x = (1 - 16 * z[u]) ** 0.25
    out[u] = 2*np.log((1 + x)/2) + np.log((1 + x*x)/2) - 2*np.arctan(x) + np.pi/2
    s = ~u; zs = z[s]; a, b, c, d = 1.0, 2/3, 5.0, 0.35
    out[s] = -(a*zs + b*(zs - c/d)*np.exp(-d*zs) + b*c/d)
    return out


def psi_h(z):
    z = np.asarray(z, float); out = np.zeros_like(z)
    u = z < 0
    x = (1 - 16 * z[u]) ** 0.25
    out[u] = 2*np.log((1 + x*x)/2)
    s = ~u; zs = z[s]; a, b, c, d = 1.0, 2/3, 5.0, 0.35
    out[s] = -((1 + 2*a*zs/3)**1.5 + b*(zs - c/d)*np.exp(-d*zs) + b*c/d - 1)
    return out


def zeta_gradient(dtheta, U, T_k, h, z_r, z_hi, z_lo):
    """zeta = 0.73 h / L from a potential-temperature difference between z_lo and z_hi and the
    wind U at z_r, all above the canopy, by Monin-Obukhov similarity (bisection on zeta at z_r)."""
    dtheta, U, T_k, z_r, z_hi, z_lo = (np.asarray(a, float) for a in (dtheta, U, T_k, z_r, z_hi, z_lo))
    d, z0 = 0.67 * h, max(0.1 * h, 0.02)
    zr, zh, zl = np.maximum(z_r - d, 2 * z0), np.maximum(z_hi - d, 3 * z0), np.maximum(z_lo - d, 2 * z0)
    B = G * dtheta * zr / (T_k * np.maximum(U, 0.1) ** 2)

    def f(zeta):
        Fm = np.log(zr / z0) - psi_m(zeta) + psi_m(zeta * z0 / zr)
        Fh = np.log(zh / zl) - psi_h(zeta * zh / zr) + psi_h(zeta * zl / zr)
        return zeta * Fh - B * Fm ** 2

    lo = np.where(B >= 0, 0.0, -20.0); hi = np.where(B >= 0, 50.0, 0.0)
    flo = f(lo)
    for _ in range(60):
        mid = (lo + hi) / 2; fm = f(mid)
        same = np.sign(fm) == np.sign(flo)
        lo = np.where(same, mid, lo); flo = np.where(same, fm, flo); hi = np.where(same, hi, mid)
    zeta_r = (lo + hi) / 2
    zeta_r = np.where(np.isfinite(B), zeta_r, np.nan)
    return zeta_r * z_ref(h, z_r) / zr


def z_ref(h, z_top):
    """Height above d where zeta is read: 0.73 h (SMEAR II's 27 m over its ~19 m stand), or the
    top sensor above d under a canopy of less than 5 m (tundra, scrub)."""
    z_top = np.asarray(z_top, float)
    return np.where(h >= 5, 0.73 * h, np.maximum(z_top - 0.67 * h, 1.0))


def zeta_ec(ustar, hflux, T_k, h, elev, z_top=None):
    """zeta = z_ref / L from eddy covariance (ustar, sensible heat flux)."""
    p = 101325 * (1 - 2.25577e-5 * (elev or 0)) ** 5.25588
    rho_cp = p / (287.05 * T_k) * 1005.0
    kin = hflux / rho_cp
    L = -(ustar ** 3) * T_k / (KAPPA * G * kin)
    return z_ref(h, z_top if z_top is not None else 0.73 * h) / L


def dtheta_raw(r: pd.DataFrame) -> pd.Series:
    return (r.ta_hi - r.ta_lo) + 0.0098 * (r.z_ta_hi - r.z_ta_lo)


def zero_offsets(r: pd.DataFrame, dth: pd.Series) -> tuple[pd.Series, dict]:
    """Zero each site-year's temperature pair (and each pair of heights) on its well-mixed half-hours."""
    out = dth.copy(); offs = {}
    key = pd.Series(r.index.year.astype(str), index=r.index)
    if r.z_ta_lo.nunique() > 1 or r.z_ta_hi.nunique() > 1:
        key = key + " " + r.z_ta_lo.astype(str) + "/" + r.z_ta_hi.astype(str)
    yr = key.values
    for y in sorted(set(yr)):
        m = yr == y
        ws = r.ws_top[m]
        thr = max(ws.quantile(0.9), 3.0)
        mixed = dth[m][(ws >= thr) & dth[m].notna()]
        if len(mixed) < 30:
            mixed = dth[(r.ws_top >= max(r.ws_top.quantile(0.9), 3.0)) & dth.notna()]
        if len(mixed) < 30:
            offs[y] = None; continue
        o = float(mixed.median()); offs[y] = round(o, 3)
        out[m] = dth[m] - o
    return out, offs


# ---------------------------------------------------------------- terrain

def terrain(site: str, lat: float, lon: float) -> dict | None:
    import rasterio
    from pyproj import Transformer
    from scipy.signal import fftconvolve
    am = RAW / site / "DP3.30024.001" / "aop.json"
    if not am.exists():
        return None
    am = json.loads(am.read_text())
    fs = [RAW / site / "DP3.30024.001" / am["month"] / t for t in am["tiles"]]
    fs = [f for f in fs if f.exists()]
    if not fs:
        return None
    RES = 5
    tiles = []
    for f in fs:
        with rasterio.open(f) as r:
            a = r.read(1).astype(float)
            a[a <= -9000] = np.nan
            if r.nodata is not None:
                a[a == r.nodata] = np.nan
            k = int(round(RES / r.res[0]))
            ny, nx = a.shape[0] // k, a.shape[1] // k
            a = np.nanmean(a[:ny*k, :nx*k].reshape(ny, k, nx, k), axis=(1, 3)) if k > 1 else a
            tiles.append((r.bounds.left, r.bounds.top, a, r.crs))
    crs = tiles[0][3]
    x0 = min(t[0] for t in tiles); y1 = max(t[1] for t in tiles)
    x1 = max(t[0] + t[2].shape[1] * RES for t in tiles); y0 = min(t[1] - t[2].shape[0] * RES for t in tiles)
    nx, ny = int(round((x1 - x0) / RES)), int(round((y1 - y0) / RES))
    Z = np.full((ny, nx), np.nan)
    for left, top, a, _ in tiles:
        c0, r0 = int(round((left - x0) / RES)), int(round((y1 - top) / RES))
        Z[r0:r0 + a.shape[0], c0:c0 + a.shape[1]] = a
    tx, ty = Transformer.from_crs(4326, crs, always_xy=True).transform(lon, lat)
    xs = x0 + (np.arange(nx) + 0.5) * RES; ys = y1 - (np.arange(ny) + 0.5) * RES
    XX, YY = np.meshgrid(xs - tx, ys - ty)
    D = np.hypot(XX, YY)

    def disk_mean(rad):
        m = (D <= rad) & np.isfinite(Z)
        return float(Z[m].mean()) if m.sum() > 10 else np.nan, float(m.sum() / max((D <= rad).sum(), 1))

    out = {"dtm_cover_1500": float(np.isfinite(Z[(np.abs(XX) <= 1500) & (np.abs(YY) <= 1500)]).mean())}
    for rad in (75, 150, 300, 500, 1000):
        m = (D <= rad) & np.isfinite(Z)
        if m.sum() < 30:
            continue
        A = np.c_[XX[m], YY[m], np.ones(m.sum())]
        (a, b, c), *_ = np.linalg.lstsq(A, Z[m], rcond=None)
        slope = math.degrees(math.atan(math.hypot(a, b)))
        up = math.degrees(math.atan2(a, b)) % 360
        out[f"r{rad}"] = {"slope": round(slope, 2), "upslope": round(up, 1), "downslope": round((up + 180) % 360, 1),
                          "elev": round(float(c), 1)}
    z50, _ = disk_mean(50)
    for rad in (500, 1000):
        zm, cov = disk_mean(rad)
        out[f"tpi{rad}"] = round(z50 - zm, 2) if np.isfinite(zm) else None
        out[f"cover{rad}"] = round(cov, 2)
    m1 = (D <= 1000) & np.isfinite(Z)
    out["relief1000"] = round(float(np.nanmax(Z[m1]) - np.nanmin(Z[m1])), 1) if m1.any() else None
    # spread of TPI500 over the 2 km around the tower (10 m grid), to standardise
    k = 2
    Zc = Z[:ny // k * k, :nx // k * k].reshape(ny // k, k, nx // k, k).mean(axis=(1, 3))
    ok = np.isfinite(Zc); Z0 = np.where(ok, Zc, 0.0)
    def conv(rad):
        n = int(rad / (RES * k)); yy, xx = np.mgrid[-n:n+1, -n:n+1]
        ker = ((xx**2 + yy**2) <= n*n).astype(float)
        s = fftconvolve(Z0, ker, mode="same"); w = fftconvolve(ok.astype(float), ker, mode="same")
        return np.where(w > 0.8 * ker.sum(), s / np.maximum(w, 1e-9), np.nan)
    tpi = conv(50) - conv(500)
    Dc = D[:ny // k * k, :nx // k * k].reshape(ny // k, k, nx // k, k).mean(axis=(1, 3))
    sd = float(np.nanstd(tpi[Dc <= 1000]))
    out["tpi500_sd"] = round(sd, 2)
    out["tpi500_z"] = round(out["tpi500"] / sd, 2) if out.get("tpi500") is not None and sd > 0 else None
    return out


# ---------------------------------------------------------------- per site

def ang(a, b):
    return np.abs(((a - b + 180) % 360) - 180)


def prep(r: pd.DataFrame, lat: float, lon: float) -> pd.DataFrame:
    r = r.copy()
    r["sun"] = solar_elev(r.index, lat, lon)
    r["phase"] = np.select([r.sun > 6, r.sun < -6], ["day", "night"], "twilight")
    r["turn"] = ((r.wd_floor - r.wd_top + 180) % 360) - 180
    r["adiff"] = r.turn.abs()
    r["ratio"] = r.ws_floor / r.ws_top
    r["month"] = r.index.month
    return r


def stability(r: pd.DataFrame, h: float, zero=True) -> tuple[pd.Series, dict]:
    if r.ta_hi.notna().sum() == 0 or r.ta_lo.notna().sum() == 0:
        return pd.Series(np.nan, index=r.index), {}
    dth = dtheta_raw(r)
    offs = {}
    if zero:
        dth, offs = zero_offsets(r, dth)
    T = (r.ta_hi + r.ta_lo) / 2 + 273.15
    z = zeta_gradient(dth.values, r.ws_top.values, T.values, h, r.z_top.values, r.z_ta_hi.values, r.z_ta_lo.values)
    z = pd.Series(RSL * z, index=r.index).where(dth.notna())
    return z, offs


def load_rows(f: str) -> pd.DataFrame:
    r = pd.read_csv(f)
    r.index = pd.to_datetime(r.t_utc, utc=True)
    return r


def tdict(t: pd.DataFrame) -> dict:
    return {str(k): {c: (None if pd.isna(v) else round(float(v), 3)) for c, v in row.items()} for k, row in t.iterrows()}


def look(site: str) -> dict | None:
    f = ROWS / f"NEON-{site}.csv.gz"
    if not f.exists():
        return None
    r = load_rows(str(f))
    info = json.loads((RAW / site / "rows.json").read_text()) if (RAW / site / "rows.json").exists() else {}
    meta = json.loads((RAW / site / "site.json").read_text()) if (RAW / site / "site.json").exists() else {}
    lat, lon, h = float(r.lat.iloc[0]), float(r.lon.iloc[0]), float(r.canopy_h.iloc[0])
    r = prep(r, lat, lon)
    r["zeta"], offs = stability(r, h)
    r["top_stab"] = cls(r.zeta)
    zr, _ = stability(r, h, zero=False)
    raw_cls = cls(zr)
    ter = terrain(site, lat, lon)
    out = {"site": site, "name": meta.get("name"), "eco": meta.get("type_eco"), "lat": lat, "lon": lon,
           "elev": meta.get("tower_elev") or meta.get("elev"), "canopy_h": h, "canopy_src": info.get("canopy_src"),
           "canopy_neon": meta.get("canopy_h"), "chm": info.get("chm"),
           "z_floor": float(r.z_floor.mode().iloc[0]), "z_top": float(r.z_top.mode().iloc[0]),
           "z_floor_all": sorted(set(r.z_floor.dropna().tolist())), "z_top_all": sorted(set(r.z_top.dropna().tolist())),
           "z_ta": [info.get("ta_lo"), info.get("ta_hi")], "wind_levels": info.get("wind_levels"),
           "temp_levels": info.get("temp_levels"), "floor_note": info.get("floor_note"), "top_note": info.get("top_note"),
           "height_changes": info.get("height_changes"), "years": sorted(set(int(y) for y in r.index.year)),
           "rows": int(len(r)), "rows_top_min": int((r.ws_top >= TOP_MIN).sum()),
           "wd_floor_missing": float(r.wd_floor.isna().mean()), "ta_offsets": offs,
           "stab_share": {c: float((r.top_stab[r.ws_top >= TOP_MIN] == c).mean()) for c in CLASSES},
           "stab_agree_without_zeroing": float((raw_cls == r.top_stab)[r.zeta.notna()].mean()) if r.zeta.notna().any() else None,
           "terrain": ter}
    out["by_stab"] = tdict(table(r, "top_stab"))
    qf = RAW / site / "wd_qf.csv.gz"
    if qf.exists():                       # strict: NEON's direction flags (tower wake) applied
        q = pd.read_csv(qf); q.index = pd.to_datetime(q.t_utc, utc=True)
        q = q[~q.index.duplicated()].reindex(r.index)
        rs = r.copy()
        bad = (q.wd_top_qf == 1) | (q.wd_floor_qf == 1)
        rs.loc[bad, ["turn", "adiff"]] = np.nan
        out["by_stab_strict"] = tdict(table(rs, "top_stab"))
        out["wd_flagged"] = {"top": float((q.wd_top_qf == 1).mean()), "floor": float((q.wd_floor_qf == 1).mean())}
    out["by_phase"] = tdict(table(r, "phase"))
    out["night_by_stab"] = tdict(table(r[r.phase == "night"], "top_stab"))
    out["phase_x_stab"] = tdict(table(r, ["phase", "top_stab"]))
    n = r[r.phase == "night"].assign(tb=pd.cut(r.ws_top, [TOP_MIN, 3, 5, 99], labels=["1.5-3", "3-5", ">5"]))
    out["night_by_top"] = tdict(table(n, "tb"))
    out["by_month"] = tdict(table(r, "month"))
    s = r[(r.ws_top > 4) & r.turn.notna() & (r.ws_floor >= CALM)]
    out["turn_top_gt4"] = {"median": None if s.empty else float(s.turn.median()),
                           "iqr": None if s.empty else [float(q) for q in s.turn.quantile([.25, .75])], "n": int(len(s))}
    # drainage: floor heading downslope (wind FROM the uphill side) at night under stable air
    if ter and "r150" in ter:
        dn, up = ter["r150"]["downslope"], ter["r150"]["upslope"]
        x = r[(r.ws_top >= TOP_MIN) & (r.ws_floor >= CALM) & r.wd_floor.notna()]
        heading_f, heading_t = (x.wd_floor + 180) % 360, (x.wd_top + 180) % 360
        def share(mask, heading, target):
            m = mask & heading.notna()
            return (None if m.sum() == 0 else round(float((ang(heading[m], target) <= 45).mean()), 3)), int(m.sum())
        ns = (x.phase == "night") & x.top_stab.isin(["stable", "very stable"])
        nn = (x.phase == "night") & (x.top_stab == "neutral")
        dy = (x.phase == "day") & x.top_stab.isin(["unstable", "neutral"])
        out["slope_flow"] = {
            "night_stable_floor_downslope": share(ns, heading_f, dn),
            "night_stable_top_downslope": share(ns, heading_t, dn),
            "night_neutral_floor_downslope": share(nn, heading_f, dn),
            "day_floor_upslope": share(dy, heading_f, up),
            "day_top_upslope": share(dy, heading_t, up),
            "night_stable_floor_mean_from": round(circ_mean(x.wd_floor[ns]), 0) if ns.any() else None,
            "night_stable_floor_R": round(resultant(x.wd_floor[ns]), 2) if ns.any() else None,
        }
    return out


def validate() -> dict:
    """Gradient z/L classes against eddy-covariance z/L where both exist."""
    res = {}
    pairs = [(s, f"AMF-{a}") for s, a in AMF.items()] + [(None, "SMEAR-II")]
    for site, src in pairs:
        fa = ROWS / f"{src}.csv.gz"
        if not fa.exists():
            continue
        a = load_rows(str(fa))
        a = a[a.ustar.notna() & a.h_flux.notna() & (a.ustar > 0.05)]
        if site is None:                                    # SMEAR II: its own pair and wind
            b = a.copy(); elev = 181.0
        else:
            fn = ROWS / f"NEON-{site}.csv.gz"
            if not fn.exists():
                continue
            b = load_rows(str(fn))
            meta = json.loads((RAW / site / "site.json").read_text())
            elev = meta.get("tower_elev") or meta.get("elev") or 0
            b = b.join(a[["ustar", "h_flux"]].rename(columns={"ustar": "u_ec", "h_flux": "h_ec"}), how="inner")
            b["ustar"], b["h_flux"] = b.u_ec, b.h_ec
        if b.empty or b.ta_hi.isna().all():
            continue
        h = float(b.canopy_h.iloc[0])
        b = b[b.ws_top >= TOP_MIN]
        zg, _ = stability(b, h)
        zg0, _ = stability(b, h, zero=False)
        T = b.ta_hi + 273.15
        ze = pd.Series(zeta_ec(b.ustar, b.h_flux, T, h, elev, b.z_top.values), index=b.index)
        ok = zg.notna() & ze.notna()
        cg, cg0, ce = cls(zg[ok]), cls(zg0[ok]), cls(ze[ok])
        conf = pd.crosstab(ce, cg).reindex(index=CLASSES, columns=CLASSES, fill_value=0)
        stable_ec = ce.isin(["stable", "very stable"])
        stable_g = cg.isin(["stable", "very stable"])
        res[src] = {"site": site or "SMEAR-II", "n": int(ok.sum()),
                    "agree": round(float((cg == ce).mean()), 3), "agree_unzeroed": round(float((cg0 == ce).mean()), 3),
                    "stable_hit": round(float(stable_g[stable_ec].mean()), 3) if stable_ec.any() else None,
                    "stable_false": round(float(stable_g[~stable_ec].mean()), 3) if (~stable_ec).any() else None,
                    "spearman": round(float(pd.Series(zg[ok]).rank().corr(pd.Series(ze[ok]).rank())), 3),
                    "confusion_ec_rows_grad_cols": conf.values.tolist()}
    return res


# ---------------------------------------------------------------- report

def pct(v):
    return "–" if v is None or (isinstance(v, float) and np.isnan(v)) else f"{100 * v:.0f}%"


def num(v, f="{:.2f}"):
    return "–" if v is None or (isinstance(v, float) and np.isnan(v)) else f.format(v)


def report(res: list[dict], val: dict, smear: dict | None) -> str:
    L = []
    def cell(s, c, k):
        g = s["by_stab"].get(c)
        return g and g.get(k)
    def n_of(s, c):
        g = s["by_stab"].get(c); return g["halfhours"] if g else 0
    sloped = [s for s in res if s.get("terrain") and s["terrain"].get("r150", {}).get("slope", 0) >= SLOPED]
    valley = [s for s in res if s.get("terrain") and s.get("valley")]
    L.append("# NEON forested towers: does the floor follow the wind above the trees?\n")
    L.append("First look, written by `pipeline/towers/neon_look.py` from the rows `pipeline/towers/neon.py` "
             "writes (raw/towers/rows/NEON-*.csv.gz). Sep–Nov, 2017–2025, 30-min, top ≥ 1.5 m/s.\n")
    L.append("## Sloped and valley-bottom towers (for the regime classifier)\n")
    L.append("| site | stand | slope | ground falls to | TPI500 (m, z) | valley | night, stable: floor runs downslope (top) | n | night-stable floor from (R) |")
    L.append("|---|---|---|---|---|---|---|---|---|")
    def drains(x):
        sf = x.get("slope_flow") or {}
        a, n = sf.get("night_stable_floor_downslope", (None, 0))
        return a is not None and n >= 200 and a >= 0.5
    gentle = [s for s in res if s.get("terrain") and GENTLE <= s["terrain"].get("r150", {}).get("slope", 0) < SLOPED
              and drains(s) and s["canopy_h"] >= 5]
    for s in sorted(set(x["site"] for x in sloped + valley + gentle)):
        s = next(x for x in res if x["site"] == s)
        t = s["terrain"]; sf = s.get("slope_flow", {})
        a, n = sf.get("night_stable_floor_downslope", (None, 0)); b, _ = sf.get("night_stable_top_downslope", (None, 0))
        tag = "" if (t["r150"]["slope"] >= SLOPED or s.get("valley")) else " (gentle)"
        L.append(f"| **{s['site']}**{tag} | {s['stand']} | {t['r150']['slope']:.1f}° | {t['r150']['downslope']:.0f}° ({compass(t['r150']['downslope'])}) "
                 f"| {num(t.get('tpi500'), '{:+.0f}')} ({num(t.get('tpi500_z'), '{:+.1f}')}) | {'**yes**' if s.get('valley') else ''} "
                 f"| {pct(a)} ({pct(b)}) | {n} | {num(sf.get('night_stable_floor_mean_from'), '{:.0f}°')} ({num(sf.get('night_stable_floor_R'))}) |")
    L.append("\nChance alone puts a direction within 45° of a bearing 25% of the time. \"Ground falls to\" is the "
             "downslope bearing (the way the slope faces); a drainage wind comes FROM the opposite, uphill bearing. "
             f"Sloped = plane fit within 150 m ≥ {SLOPED:.0f}°. Valley = TPI500 ≤ −5 m and ≤ −1 SD of TPI500 within 1 km. "
             f"(gentle) = {GENTLE:.0f}–{SLOPED:.0f}° with the floor running downslope on at least half the stable nights: "
             "drainage shows well below the 5° cut. NIWO is tundra (the 'floor' is 1.6 m over low cover). Flat towers "
             "for contrast: DELA, LENO, STEI, OSBS, JERC, TREE (under 2°, floor downslope 3–24%).\n")

    # headline pooled
    forest = [s for s in res if s["canopy_h"] >= 5]
    L.append("## Headline\n")
    L.append(f"{len(res)} towers, {sum(s['rows'] for s in res):,} half-hours with both levels "
             f"({sum(s['rows_top_min'] for s in res):,} with the top ≥ 1.5 m/s). Forested (canopy ≥ 5 m): {len(forest)}.\n")
    L.append("Median across the forested towers, by stability above the canopy (half-hours, top ≥ 1.5 m/s):\n")
    L.append("| stability above | towers | floor follows (≤ 45°, of non-calm) | within 45° (of all, SMEAR layout) | calm floor (< 0.3 m/s) | floor/top speed |")
    L.append("|---|---|---|---|---|---|")
    for c in CLASSES:
        ss = [s for s in forest if n_of(s, c) >= 30]
        med = lambda k: np.nanmedian([cell(s, c, k) for s in ss]) if ss else np.nan
        L.append(f"| {c} | {len(ss)} | {pct(med('follows'))} | {pct(med('within45_all'))} | {pct(med('calm_floor'))} | {num(med('ratio_med'))} |")
    def calm_stable(xs):
        v = [cell(x, "stable", "calm_floor") for x in xs if n_of(x, "stable") >= 30]
        v = [a for a in v if a is not None]
        return (float(np.median(v)) if v else None), len(v)
    flat = [x for x in forest if (x.get("terrain") or {}).get("r150", {}).get("slope", 9) < FLAT and not x.get("valley")]
    hilly = [x for x in forest if (x.get("terrain") or {}).get("r150", {}).get("slope", 0) >= GENTLE or x.get("valley")]
    cf, nf = calm_stable(flat); ch, nh = calm_stable(hilly)
    L.append(f"\nUnder stable air the floor goes calm on flat ground and keeps moving on slopes: median calm share "
             f"{pct(cf)} at the {nf} flat towers (< {FLAT:.0f}°) against {pct(ch)} at the {nh} sloped or valley towers "
             f"(≥ {GENTLE:.0f}°), where it drains instead (see the terrain table).\n")
    if smear:
        L.append("\nSMEAR II's own rows put through the same method (gradient stability, calm < 0.3 m/s): " + "; ".join(
            f"{c} {pct(smear['by_stab'].get(c, {}).get('follows'))} follow, {pct(smear['by_stab'].get(c, {}).get('calm_floor'))} calm"
            for c in CLASSES if c in smear["by_stab"]) + ". The doc's SMEAR II table (EC z/L, calm < 0.25, within45 of all): "
            "neutral 84% / 6%, stable 54% / 24%, very stable 18% / 60%.\n")

    L.append("## Per tower, by stability above the canopy\n")
    L.append("Each cell: floor follows the top (within 45°, of non-calm) / calm floor / median floor÷top speed, and the half-hours. "
             "Stand, canopy (CHM p90 within 100 m), floor and top heights in m.\n")
    L.append("| site | stand | canopy | floor | top | unstable | neutral | stable | very stable | slope | TPI500 |")
    L.append("|---|---|---|---|---|---|---|---|---|---|---|")
    for s in res:
        t = s.get("terrain") or {}
        cells = []
        for c in CLASSES:
            g = s["by_stab"].get(c)
            cells.append("–" if not g else f"{pct(g['follows'])} / {pct(g['calm_floor'])} / {num(g['ratio_med'])} ({int(g['halfhours'])})")
        flag = "".join([" ⛰" if t.get("r150", {}).get("slope", 0) >= SLOPED else "", " ▽" if s.get("valley") else ""])
        L.append(f"| **{s['site']}**{flag} | {s['stand']} | {s['canopy_h']:.1f} | {s['z_floor']:.2f} | {s['z_top']:.2f} | "
                 + " | ".join(cells) + f" | {num(t.get('r150', {}).get('slope'), '{:.1f}°')} | {num(t.get('tpi500'), '{:+.0f}')} |")
    L.append("\n⛰ sloped (≥ 5°), ▽ valley bottom.\n")

    L.append("## Night, by top speed\n")
    L.append("| site | top 1.5–3 m/s | 3–5 | > 5 |")
    L.append("|---|---|---|---|")
    for s in res:
        cs = []
        for k in ("1.5-3", "3-5", ">5"):
            g = s["night_by_top"].get(k)
            cs.append("–" if not g else f"{pct(g['follows'])} / {pct(g['calm_floor'])} ({int(g['halfhours'])})")
        L.append(f"| {s['site']} | " + " | ".join(cs) + " |")
    L.append("\nCells: floor follows / calm floor (half-hours).\n")

    L.append("## Terrain and slope flows\n")
    L.append("| site | slope r75 / r150 / r300 | ground falls to | relief 1 km | TPI500 / TPI1000 | night-stable floor runs downslope | top | night-neutral floor | day floor runs upslope | top |")
    L.append("|---|---|---|---|---|---|---|---|---|---|")
    for s in res:
        t = s.get("terrain")
        if not t:
            L.append(f"| {s['site']} | no DTM | | | | | | | | |"); continue
        sf = s.get("slope_flow", {})
        sl = " / ".join(num(t.get(f"r{r}", {}).get("slope"), "{:.1f}") for r in (75, 150, 300))
        g = lambda k: f"{pct(sf.get(k, (None, 0))[0])} ({sf.get(k, (None, 0))[1]})"
        L.append(f"| {s['site']} | {sl}° | {t['r150']['downslope']:.0f}° {compass(t['r150']['downslope'])} | {num(t.get('relief1000'), '{:.0f}')} m "
                 f"| {num(t.get('tpi500'), '{:+.0f}')} / {num(t.get('tpi1000'), '{:+.0f}')} m | {g('night_stable_floor_downslope')} "
                 f"| {pct(sf.get('night_stable_top_downslope', (None,))[0])} | {g('night_neutral_floor_downslope')} | {g('day_floor_upslope')} "
                 f"| {pct(sf.get('day_top_upslope', (None,))[0])} |")
    L.append("\nOn ground under 2° the downslope bearing is noise; read those rows as direction-only controls.\n")

    L.append("## Stability method check\n")
    L.append("Gradient z/L (this script) against eddy-covariance z/L (ustar, H) on the same half-hours, where another "
             "writer's rows carry them. Agree = same of the four classes; stable hit = EC stable or very stable that the "
             "gradient also calls stable; false = EC neutral/unstable that the gradient calls stable.\n")
    L.append("| rows | n | agree | agree, not zeroed | stable hit | stable false | rank corr |")
    L.append("|---|---|---|---|---|---|---|")
    for k, v in val.items():
        L.append(f"| {k} ({v['site']}) | {v['n']:,} | {pct(v['agree'])} | {pct(v['agree_unzeroed'])} | {pct(v['stable_hit'])} | {pct(v['stable_false'])} | {v['spearman']:.2f} |")
    strict = []
    for c in CLASSES:
        v = [s["by_stab_strict"][c]["follows"] for s in res if s["canopy_h"] >= 5 and s.get("by_stab_strict", {}).get(c)
             and s["by_stab_strict"][c]["halfhours"] >= 30 and s["by_stab_strict"][c]["follows"] is not None]
        strict.append(f"{c} {pct(float(np.median(v)) if v else None)}")
    L.append("\nNEON's direction flags (mostly the tower-wake sector) are not applied in the tables above. Applied, the "
             "median share following across the forested towers would be: " + "; ".join(strict) + ".\n")
    L.append("\n## Notes per tower\n")
    for s in res:
        notes = []
        if s["floor_note"]: notes.append(s["floor_note"])
        if s["top_note"]: notes.append(s["top_note"])
        if s["z_floor"] > 0.5 * s["canopy_h"] and s["canopy_h"] >= 5: notes.append(f"floor at {s['z_floor']:.1f} m is over half the canopy height")
        if s["canopy_h"] < 5: notes.append(f"open or short stand (canopy {s['canopy_h']:.1f} m): the 'floor' is 2 m over low cover")
        if s["canopy_neon"] and s["canopy_neon"] != "NA" and abs(float(s["canopy_neon"]) - s["canopy_h"]) > 0.3 * float(s["canopy_neon"]):
            notes.append(f"CHM p90 {s['canopy_h']:.1f} m vs NEON's {s['canopy_neon']} m")
        if s["height_changes"]: notes.append(f"sensor heights changed over the record: {s['height_changes']}")
        offs = [v for v in s["ta_offsets"].values() if v is not None]
        if offs and max(abs(v) for v in offs) > 0.3: notes.append(f"temperature pair offset up to {max(offs, key=abs):+.2f} K (zeroed)")
        if not s["z_ta"][0]: notes.append("no temperature pair above the canopy: no stability classes")
        wf = s.get("wd_flagged") or {}
        if wf.get("floor", 0) > 0.2 or wf.get("top", 0) > 0.2:
            notes.append(f"NEON flags the direction (tower wake) in {pct(wf.get('floor'))} of floor and {pct(wf.get('top'))} of top half-hours")
        if notes:
            L.append(f"- **{s['site']}**: " + "; ".join(notes) + ".")
    return "\n".join(L) + "\n"


def compass(b):
    return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][int(((b + 22.5) % 360) // 45)]


STAND = {  # short names from NEON's TypeEco site property
    "ABBY": "young Douglas-fir", "BART": "northern hardwood", "BONA": "black spruce, permafrost",
    "CLBJ": "oak woodland / grass", "DEJU": "black spruce", "DELA": "bottomland hardwood",
    "GRSM": "oak-maple hardwood", "HARV": "hardwood-hemlock", "HEAL": "tussock tundra",
    "JERC": "longleaf pine-hardwood", "LENO": "bottomland oak", "MLBS": "oak hardwood",
    "NIWO": "alpine tundra", "ORNL": "upland hardwood", "OSBS": "open longleaf pine",
    "RMNP": "ponderosa pine", "SCBI": "tulip poplar-oak", "SERC": "tulip poplar-oak-ash",
    "SOAP": "pine (Sierra foothill)", "STEI": "aspen regrowth", "TALL": "longleaf pine",
    "TEAK": "red fir-pine", "TREE": "mixedwood (maple, hemlock)", "UKFS": "oak-hickory-elm",
    "UNDE": "sugar maple hardwood", "WREF": "old-growth Douglas-fir", "YELL": "open pine",
}


def stand(s: dict) -> str:
    return STAND.get(s["site"]) or (s.get("eco") or "").split(",")[0][:28]


def main() -> None:
    sites = [a.upper() for a in sys.argv[1:]] or sorted(Path(f).name[5:-7] for f in glob.glob(str(ROWS / "NEON-*.csv.gz")))
    res = []
    for site in sites:
        try:
            s = look(site)
        except Exception as e:  # noqa: BLE001
            print(site, "failed:", type(e).__name__, e); continue
        if not s:
            continue
        t = s.get("terrain") or {}
        s["stand"] = stand(s)
        s["valley"] = bool(t.get("tpi500") is not None and t["tpi500"] <= -5 and (t.get("tpi500_z") or 0) <= -1)
        res.append(s)
        g = s["by_stab"]
        print(f"{site}: {s['rows']} rows, canopy {s['canopy_h']:.1f}, floor {s['z_floor']}, top {s['z_top']}, "
              f"slope {t.get('r150', {}).get('slope')}, tpi500 {t.get('tpi500')}, "
              + ", ".join(f"{c}: {pct(g[c]['follows'])}/{pct(g[c]['calm_floor'])}" for c in CLASSES if c in g))
    # SMEAR II through the same method, for the one-to-one line
    smear = None
    fs = ROWS / "SMEAR-II.csv.gz"
    if fs.exists():
        r = load_rows(str(fs))
        r = prep(r, 61.8475, 24.2948)
        r["zeta"], _ = stability(r, float(r.canopy_h.iloc[0]))
        r["top_stab"] = cls(r.zeta)
        smear = {"by_stab": tdict(table(r, "top_stab"))}
    val = validate()
    for k, v in val.items():
        print("check", k, v["n"], "agree", v["agree"], "unzeroed", v["agree_unzeroed"], "stable hit", v["stable_hit"], "false", v["stable_false"])
    RAW.mkdir(parents=True, exist_ok=True)
    (RAW / "first_look.json").write_text(json.dumps({"sites": res, "stability_check": val, "smear_same_method": smear},
                                                    indent=1, default=lambda o: None if isinstance(o, float) and np.isnan(o) else str(o)))
    (RAW / "first_look.md").write_text(report(res, val, smear), encoding="utf-8")
    print("wrote", RAW / "first_look.md")


if __name__ == "__main__":
    main()
