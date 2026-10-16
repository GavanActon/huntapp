"""Why the measured floor wind at the forest flux towers is faster or slower than the app's.

    py -3.14 pipeline/towers/why_floor.py            # after aop_structure.py features (~15 min, mostly permutations)
    py -3.14 pipeline/towers/why_floor.py --report   # rebuild why_floor.md from the saved outputs
    py -3.14 pipeline/towers/why_floor.py --json card.json   # the towers' floor card for the nightly loop, from the saved outputs

The rows, stability classes, censoring, site files and the app's canopy rule come from
floor.py (imported, not changed; its terrain cache is read from a copy). The app is scored
two ways:
- old: floor.app_rule as floor.py has it (in_stand blended to leaves-down by date, x (1 - 0.3 s));
- new: model.ts since 2026-10-15: min(FLOOR_OPEN_SHARE 0.7, in_stand x FLOOR_DEFAULT.trees 1.5)
  x (1 - 0.3 s) in a stand; open ground (h < 3 m) unchanged, cf x (1 - 0.45 s).
bias = measured floor/top over the app's (new unless named); above 1 the app is too slow.

Sections (all written to raw/towers/why/):
1. Response by unit (a tower: NEON-HARV and Harvard's EMS tower are two units of one site)
   and by unit x stability above x leaf state (leaf-on before 20 Sep, falling to 15 Oct, bare
   after) x deciduous class: response_unit.csv, response_cells.csv.
   Trunk-space profile: at the four NEON towers with a level near 2 m and another at 0.35-0.45 h
   (OSBS, TEAK, TREE, UKFS) the speed ratio between them gives an exponent alpha, u ~ z^alpha,
   used to carry the 3.3-11 m floor sensors down to 2 m as a sensitivity check (bias_adj).
2. Stand structure from the AOP point clouds (aop_structure.py -> aop_structure.csv), joined with
   the site files (CHM, terrain) into site_features.csv.
3. Site level: Spearman of log bias against every feature, partial Spearman holding the canopy
   height and closure (and z_floor/h) fixed, leave-one-site-out range of rho. Row level: LightGBM
   of log bias, leave-one-site-out, two feature sets (what the app has / plus the point cloud),
   held-out within-2x against the app, grouped permutation importance: row_model.json.
   Also site-level stats of the measured ratio itself, the direction follow and the calm share
   (site_stats_*.csv), the leaves-down lift per deciduous tower (leaf_effect.csv) and the follow by
   stand height.
4. A rule in the app's own terms: log-linear in closure, leaves down, stability (and candidate extra
   terms), fitted on the tower x stability x leaf cells, scored leave-one-site-out (row_model.json "rules").
5. Proxies: how well each point-cloud feature is predicted (leave-one-out) from what the app
   has (CHM height, closure, gap, CHM spread, deciduous share): proxies.csv.
why_floor.md has the tables and the summary (SUMMARY below, written by hand from a run's numbers).

--json writes the card the nightly loop carries as its "floor against towers" line (docs/SCENT-TESTSET.md):
the towers, and for the app now, the app before 2026-10-15, the constant (the other towers' median) and the
candidate rule (CANDIDATE), each held out: within 2x of the measured floor/top (the mean over towers), the
median |log error|, and the calm share called against measured. The bar for a rule is to beat the app now and
the constant. "top" is the tower's wind just above the canopy (1.0-1.7 h), not a forecast's 10 m: REF_CHECKED
lists the towers where that has been checked against a forecast 10 m (HRRR/ERA5), and the card carries it.
"""
from __future__ import annotations

import json
import math
import shutil
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import floor as F  # noqa: E402

TOWERS = HERE.parents[0] / "raw" / "towers"
WHY = TOWERS / "why"
NEON_RAW = HERE.parents[0] / "raw" / "regimes" / "neon"
HEAD = (1.4, 3.1)            # m: a head-height floor sensor
CAP = 0.7                    # model.ts FLOOR_OPEN_SHARE
TREES = 1.5                  # model.ts FLOOR_DEFAULT.trees
MIN_CELL = 100               # rows for a response cell
PER_SITE = 8000              # rows per site per fit
SEED = 11
LEAF_STATES = ["leaf-on", "falling", "bare"]
STAB = {0: "unstable", 1: "neutral", 2: "stable", 3: "very stable"}
PROFILE_SITES = {"OSBS": ("000.020", "000.030"), "TEAK": ("000.020", "000.030"),
                 "TREE": ("000.020", "000.030"), "UKFS": ("000.020", "000.030")}
LGB = dict(n_estimators=250, learning_rate=0.04, num_leaves=7, min_child_samples=1500, subsample=0.7,
           subsample_freq=1, colsample_bytree=0.8, reg_lambda=1.0, n_jobs=4, verbose=-1, random_state=SEED)


def low_priority() -> None:
    if sys.platform == "win32":
        import ctypes
        k = ctypes.windll.kernel32
        k.SetPriorityClass(k.GetCurrentProcess(), 0x00004000)


# ---------------------------------------------------------------- 1. rows and the app, old and new

def load_rows() -> tuple[pd.DataFrame, dict]:
    WHY.mkdir(parents=True, exist_ok=True)
    cache = WHY / "terrain_cache.json"
    if not cache.exists() and F.TERRAIN.exists():
        shutil.copy(F.TERRAIN, cache)
    F.TERRAIN = cache                       # floor.load rewrites its cache: point it at our copy
    d, info = F.load()
    d = F.features(d)
    d = d[d.elig & (d.canopy_h >= F.MIN_CANOPY) & (d.z_floor <= F.MAX_FLOOR)].copy()
    cmask, _ = F.censor(d)
    d["dir_ok"] = cmask.reindex(d.index, fill_value=False).values
    groups = sorted(d.group.unique())
    sf = F.site_files({g: sorted(d.stem[d.group == g].unique()) for g in groups})
    F.add_site_features(d, sf)
    closure, height = dict(F.CLOSURE), {}
    for g, rec in sf.items():
        hd = rec.get("hd")
        if hd and np.isfinite(hd["closure100"]) and np.isfinite(hd["h_med"]):
            closure[g], height[g] = hd["closure100"] * 100, hd["h_med"]
    old = F.app_rule(d, closure, height)
    h_app = d.group.map(height).fillna(d.canopy_h).values.astype(float)
    stand = h_app >= 3
    s = old.s.values
    new = np.where(stand, np.minimum(CAP, old.cf.values * TREES) * (1 - 0.3 * s), old.cf.values * (1 - 0.45 * s))
    d["app_h"] = h_app
    d["app_closure"] = d.group.map(closure).fillna(F.CLOSURE_DEFAULT).values
    d["app_old"] = old.ratio.values
    d["app_new"] = new
    d["app_cf"] = old.cf.values
    d["app_s"] = s
    d["app_capped"] = stand & (old.cf.values * TREES > CAP)
    d["leaf_off"] = old.off.values
    d["meas"] = np.exp(d.logratio)
    d["lb_new"] = d.logratio - np.log(d.app_new)
    d["lb_old"] = d.logratio - np.log(d.app_old)
    d["calm_app_new"] = (d.app_new * d.ws_top < F.CALM).astype(float)
    d["calm_app_old"] = (d.app_old * d.ws_top < F.CALM).astype(float)
    d["unit"] = np.where(d.stem == "HF-EMS", "HARV-EMS", d.group)
    loc = d.t_mid + pd.to_timedelta(d.lon / 15, unit="h")
    md = loc.dt.month * 100 + loc.dt.day
    d["leaf_state"] = np.select([md < 920, md <= 1015], ["leaf-on", "falling"], "bare")
    d["decid_cls"] = np.select([d.decid < 0.3, d.decid <= 0.7], ["conifer (<0.3)", "mixed (0.3-0.7)"], "deciduous (>0.7)")
    d["stab"] = d.cls_tower.map(STAB).fillna("no class")
    d["headh"] = d.z_floor.between(*HEAD)
    return d, dict(closure=closure, height=height, site_files=sf, info=info)


def trunk_profile() -> dict:
    """u(upper trunk level) / u(~2 m level), top >= 1 m/s, both moving (>= 0.3 m/s): alpha = ln ratio / ln z ratio."""
    import neon
    out = {}
    for site, (lo, hi) in PROFILE_SITES.items():
        lv = neon._read_levels(site, "DP1.00001.001", "2DWSD", ["windSpeedMean", "windSpeedFinalQF"])
        meta = json.loads((NEON_RAW / site / "rows.json").read_text())
        z = meta["wind_levels"]
        top = meta["top"][0]
        if lo not in lv or hi not in lv or top not in lv:
            continue
        a, b, t = (lv[k].windSpeedMean.where(lv[k].windSpeedFinalQF != 1) for k in (lo, hi, top))
        x = pd.concat(dict(a=a, b=b, t=t), axis=1).dropna()
        x = x[(x.t >= 1) & (x.a >= 0.3) & (x.b >= 0.3) & x.index.month.isin([9, 10, 11])]
        if len(x) < 200:
            continue
        r = float(np.median(x.b / x.a))
        alpha = math.log(r) / math.log(z[hi] / z[lo])
        out[site] = dict(z_lo=z[lo], z_hi=z[hi], h=round(meta["canopy_h"], 1), n=int(len(x)), ratio=round(r, 3),
                         alpha=round(alpha, 3))
    if out:
        out["alpha_median"] = float(np.median([v["alpha"] for v in out.values()]))
    return out


def block(x: pd.DataFrame) -> dict:
    q = x.meas / x.app_new
    mv = x.ws_floor >= F.CALM
    dr = x[x.dir_ok]
    return dict(n=int(len(x)), z_floor=float(x.z_floor.median()), h=float(x.app_h.iloc[0]),
                ws_top=float(x.ws_top.median()), ws_floor=float(x.ws_floor.median()),
                measured=float(x.meas.median()), app_old=float(x.app_old.median()), app_new=float(x.app_new.median()),
                bias_old=float((x.meas / x.app_old).median()), bias_new=float(q.median()),
                bias_adj=float((x.meas_adj / x.app_new).median()),
                within2_new=float(((q >= 0.5) & (q <= 2)).mean()),
                within2_old=float((((x.meas / x.app_old) >= 0.5) & ((x.meas / x.app_old) <= 2)).mean()),
                calm_meas=float(x.calm.mean()), calm_app_new=float(x.calm_app_new.mean()),
                calm_app_old=float(x.calm_app_old.mean()),
                follow=float(dr.coupled.mean()) if len(dr) >= 30 else np.nan, n_dir=int(len(dr)),
                capped=float(x.app_capped.mean()), s=float(x.app_s.mean()))


def responses(d: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    unit = []
    for u, x in d.groupby("unit"):
        unit.append(dict(unit=u, group=x.group.iloc[0], decid=float(x.decid.iloc[0]), head=bool(x.headh.mean() > 0.5),
                         closure=float(x.app_closure.iloc[0]), **block(x)))
    cells = []
    for (u, st, lf), x in d.groupby(["unit", "stab", "leaf_state"]):
        if len(x) >= MIN_CELL:
            cells.append(dict(unit=u, stab=st, leaf=lf, decid=float(x.decid.iloc[0]), decid_cls=x.decid_cls.iloc[0],
                              head=bool(x.headh.mean() > 0.5), **block(x)))
    return pd.DataFrame(unit), pd.DataFrame(cells)


# ---------------------------------------------------------------- 2. site features

STRUCT = ["h", "chm_gap", "chm_sd", "b_0_05", "b_05_2", "b_2_5", "b_5_halfh", "b_halfh_h", "b_above_h", "nrd_05_2",
          "nrd_2_5", "nrd_05_3", "bush_nrd", "cbh10", "cbh25", "cbh25_rel", "depth10", "depth25", "trunk_open",
          "gap_all", "lai_all", "gap_first", "lai_first", "density"]
SECTOR_FEATS = ["h", "chm_gap", "b_05_2", "nrd_05_2", "nrd_2_5", "trunk_open", "lai_first", "cbh25", "bush_nrd"]


def unit_stem(unit: str) -> str:
    if unit == "HARV-EMS":
        return "HF-EMS"
    if unit.startswith("US-"):
        return "AMF-" + unit
    if unit == "SMEAR-II":
        return unit
    return "NEON-" + unit


def site_features(units: pd.DataFrame, meta: dict) -> pd.DataFrame:
    aop = pd.read_csv(WHY / "aop_structure.csv") if (WHY / "aop_structure.csv").exists() else pd.DataFrame()
    rows = []
    for _, u in units.iterrows():
        r = dict(unit=u.unit, group=u.group)
        stem = unit_stem(u.unit)
        a = aop[aop.stem == stem] if len(aop) else aop
        if len(a):
            r["flight"] = a.flight_date.iloc[0] if isinstance(a.flight_date.iloc[0], str) else a.flight_month.iloc[0]
            for reg in ("r50", "r100", "r250"):
                x = a[a.region == reg]
                if len(x):
                    for k in STRUCT:
                        if k in x:
                            r[f"{k}_{reg}"] = float(x[k].iloc[0])
            sec = a[a.region.str.startswith("s")]
            for k in ("chm_gap", "trunk_open", "b_05_2", "lai_first"):
                if k in sec and sec[k].notna().any():
                    r[f"{k}_sec_min"] = float(sec[k].min())
                    r[f"{k}_sec_max"] = float(sec[k].max())
        sfr = meta["site_files"].get(u.group) or {}
        hd = sfr.get("hd") or {}
        sd = sfr.get("sd") or {}
        for k in ("h", "h_med", "closure100", "closure250", "edge_m", "in_opening"):
            r[f"hd_{k}"] = hd.get(k, np.nan)
            r[f"sd_{k}"] = sd.get(k, np.nan)
        if hd.get("rose"):
            r["hd_fetch_med"] = float(np.median(hd["rose"]))
        # terrain from the site file (NEON DTM)
        f = TOWERS / "sites" / f"{stem if stem != 'HF-EMS' else 'NEON-HARV'}.json"
        if f.exists():
            t = (json.loads(f.read_text()).get("hd") or {}).get("terrain") or {}
            r["slope"] = t.get("slope_deg")
            r["tpi500"] = t.get("tpi500_m")
            r["relief1000"] = t.get("relief1000_m")
        r["decid"] = u.decid
        r["z_floor"] = u.z_floor
        r["zf_rel"] = u.z_floor / u.h if u.h > 0 else np.nan
        r["app_h"] = u.h
        r["app_closure"] = u.closure
        r["head"] = bool(u["head"])
        for k in ("measured", "app_old", "app_new", "bias_old", "bias_new", "bias_adj", "within2_new", "calm_meas",
                  "calm_app_new", "follow", "n"):
            r[k] = u[k]
        r["logbias_new"] = math.log(u.bias_new)
        r["logbias_old"] = math.log(u.bias_old)
        r["logbias_adj"] = math.log(u.bias_adj)
        rows.append(r)
    return pd.DataFrame(rows)


# ---------------------------------------------------------------- 3a. site level statistics

def _rank(x):
    return pd.Series(x).rank().values


def spearman(x, y) -> tuple[float, float, int]:
    from scipy import stats
    m = np.isfinite(x) & np.isfinite(y)
    if m.sum() < 6:
        return np.nan, np.nan, int(m.sum())
    r, p = stats.spearmanr(x[m], y[m])
    return float(r), float(p), int(m.sum())


def partial_spearman(x, y, Z) -> tuple[float, float, int]:
    """Spearman of x and y with the ranks of Z regressed out of both (OLS on ranks)."""
    from scipy import stats
    m = np.isfinite(x) & np.isfinite(y) & np.all(np.isfinite(Z), axis=1)
    n, k = int(m.sum()), Z.shape[1]
    if n < k + 6:
        return np.nan, np.nan, n
    rx, ry = _rank(x[m]), _rank(y[m])
    Rz = np.column_stack([np.ones(n)] + [_rank(Z[m, j]) for j in range(k)])
    ex = rx - Rz @ np.linalg.lstsq(Rz, rx, rcond=None)[0]
    ey = ry - Rz @ np.linalg.lstsq(Rz, ry, rcond=None)[0]
    r = float(np.corrcoef(ex, ey)[0, 1])
    df = n - 2 - k
    t = r * math.sqrt(df / max(1 - r * r, 1e-9))
    return r, float(2 * stats.t.sf(abs(t), df)), n


def loo_range(x, y) -> tuple[float, float]:
    m = np.where(np.isfinite(x) & np.isfinite(y))[0]
    rs = []
    for i in m:
        k = m[m != i]
        rs.append(spearman(x[k], y[k])[0])
    return (float(np.nanmin(rs)), float(np.nanmax(rs))) if rs else (np.nan, np.nan)


def site_stats(sf: pd.DataFrame, target: str, units: list[str]) -> pd.DataFrame:
    s = sf[sf.unit.isin(units)].reset_index(drop=True)
    y = s[target].values.astype(float)
    skip = {"unit", "group", "flight", "head", "measured", "app_old", "app_new", "bias_old", "bias_new", "bias_adj",
            "within2_new", "calm_meas", "calm_app_new", "follow", "n", "logbias_new", "logbias_old", "logbias_adj",
            "log_measured", "app_h", "app_closure"}
    feats = [c for c in s.columns if c not in skip and pd.api.types.is_numeric_dtype(s[c])]
    Z1 = s[["hd_h_med", "hd_closure100"]].values.astype(float)
    Z2 = s[["hd_h_med", "hd_closure100", "zf_rel"]].values.astype(float)
    out = []
    for f in feats:
        x = s[f].values.astype(float)
        if np.isfinite(x).sum() < 6 or np.nanstd(x) == 0:
            continue
        r, p, n = spearman(x, y)
        lo, hi = loo_range(x, y)
        pr, pp, _ = partial_spearman(x, y, Z1) if f not in ("hd_h_med", "hd_closure100") else (np.nan, np.nan, 0)
        pr2, pp2, _ = partial_spearman(x, y, Z2) if f not in ("hd_h_med", "hd_closure100", "zf_rel") else (np.nan, np.nan, 0)
        out.append(dict(feature=f, n=n, rho=r, p=p, rho_loo_min=lo, rho_loo_max=hi, prho_h_cl=pr, p_h_cl=pp,
                        prho_h_cl_zf=pr2, p_h_cl_zf=pp2))
    return pd.DataFrame(out).sort_values("p")


# ---------------------------------------------------------------- 3b. row model

def sector_cols(d: pd.DataFrame, aop: pd.DataFrame) -> list[str]:
    """Columns up_<feat>: the AOP sector (45 deg, 3-250 m) the row's top wind comes from."""
    sec = aop[aop.region.str.startswith("s")].copy()
    sec["sector"] = sec.region.str[1:].astype(int)
    cols = []
    stem_of = d.unit.map(unit_stem)
    sector = ((np.round(d.wd_top.values / 45) % 8) * 45)
    key = pd.DataFrame(dict(stem=stem_of.values, sector=sector))
    for f in SECTOR_FEATS:
        if f not in sec:
            continue
        m = sec.set_index(["stem", "sector"])[f]
        idx = pd.MultiIndex.from_arrays([key.stem, key.sector.fillna(-1).astype(int)])
        d[f"up_{f}"] = m.reindex(idx).values
        cols.append(f"up_{f}")
    return cols


def build_row_features(d: pd.DataFrame, sf: pd.DataFrame) -> dict[str, list[str]]:
    aop = pd.read_csv(WHY / "aop_structure.csv")
    site_cols = [c for c in sf.columns if any(c.startswith(k + "_r") for k in STRUCT)]
    m = sf.set_index("unit")
    for c in site_cols + ["slope", "tpi500", "relief1000"]:
        d[c] = d.unit.map(m[c]) if c in m else np.nan
    up = sector_cols(d, aop)
    d["leafless"] = d.leaf_off * d.decid
    d["log_ws_top"] = np.log(d.ws_top)
    air = ["ws_top", "zeta_grad", "cls_grad", "sun", "h_since_sunset", "month", "leafless"]
    app_stand = ["hd_h", "hd_h_med", "hd_closure100", "hd_closure250", "hd_edge_m", "hd_fetch_up", "decid", "slope",
                 "tpi500", "zfloor_rel", "z_floor"]
    d["hd_zf"] = d.z_floor
    # CHM-derivable from the cloud's own canopy grid (the app's HD CHM gives the same)
    chm = ["chm_gap_r250", "chm_sd_r100", "up_chm_gap", "up_h"]
    cloud = [c for c in site_cols if not c.startswith(("h_", "chm_", "density_"))] + \
            [c for c in up if c not in ("up_chm_gap", "up_h")]
    return {"app": air + app_stand + chm, "cloud": air + app_stand + chm + cloud}


def fit_loso(d: pd.DataFrame, feats: list[str], rng) -> tuple[pd.Series, dict]:
    import lightgbm as lgb
    pred = pd.Series(np.nan, index=d.index)
    models = {}
    for g in sorted(d.group.unique()):
        tr = d[d.group != g]
        parts = [rng.choice(ix, PER_SITE, replace=False) if len(ix) > PER_SITE else ix
                 for ix in tr.groupby("group").indices.values()]
        a = tr.iloc[np.sort(np.concatenate(parts))]
        w = (len(a) / a.group.nunique() / a.group.map(a.group.value_counts())).values
        mdl = lgb.LGBMRegressor(objective="l1", **LGB).fit(a[feats], a.lb_new, sample_weight=w)
        te = d.index[d.group == g]
        pred.loc[te] = mdl.predict(d.loc[te, feats])
        models[g] = mdl
    return pred, models


def score_pred(d: pd.DataFrame, lb_pred: pd.Series) -> dict:
    """Held-out: the app's new ratio x exp(predicted log bias) against the measured ratio."""
    q = d.meas / (d.app_new * np.exp(lb_pred))
    w2 = ((q >= 0.5) & (q <= 2))
    err = np.abs(d.lb_new - lb_pred)
    per = pd.DataFrame(dict(w2=w2, err=err, unit=d.unit)).groupby("unit").agg(w2=("w2", "mean"), err=("err", "median"))
    return dict(within2_pooled=float(w2.mean()), within2_site_mean=float(per.w2.mean()),
                mae_log_site_mean=float(per.err.mean()), per_unit=per.round(3).to_dict(orient="index"))


GROUPS = {
    "top wind": ["ws_top"],
    "stability / time of day": ["zeta_grad", "cls_grad", "sun", "h_since_sunset", "month"],
    "leaves down (date x deciduous)": ["leafless"],
    "deciduous share": ["decid"],
    "sensor height (z_floor, z/h)": ["zfloor_rel", "z_floor"],
    "CHM height": ["hd_h", "hd_h_med", "up_h"],
    "CHM closure / gaps": ["hd_closure100", "hd_closure250", "chm_gap_r250", "up_chm_gap", "chm_sd_r100", "hd_edge_m",
                           "hd_fetch_up"],
    "terrain": ["slope", "tpi500"],
    "bush 0.5-2/0.5-3 m (cloud)": ["b_05_2", "nrd_05_2", "nrd_05_3", "bush_nrd", "up_b_05_2", "up_nrd_05_2", "up_bush_nrd"],
    "lower trunk 2-5 m (cloud)": ["b_2_5", "nrd_2_5", "up_nrd_2_5"],
    "crown base / depth / trunk openness (cloud)": ["cbh10", "cbh25", "cbh25_rel", "depth10", "depth25", "trunk_open",
                                                    "b_5_halfh", "b_halfh_h", "b_above_h", "up_trunk_open", "up_cbh25"],
    "leaf area / gap (cloud)": ["gap_all", "lai_all", "gap_first", "lai_first", "b_0_05", "up_lai_first"],
}


def group_of(f: str) -> str:
    for g, ks in GROUPS.items():
        for k in ks:
            if f == k or f.startswith(k + "_r"):
                return g
    return "other"


def perm_importance(d: pd.DataFrame, models: dict, feats: list[str], lb_pred: pd.Series, rng) -> tuple[dict, dict]:
    """Held-out permutation importance: a feature (or a group) shuffled across ALL rows (so site-constant
    features take other sites' values), each held-out site predicted by its own fold's model; the rise in
    the site-mean median |log error| and the fall in the site-mean within-2x share."""
    base = score_pred(d, lb_pred)

    def run(cols):
        dd = d[feats].copy()
        perm = rng.permutation(len(dd))
        for c in cols:
            dd[c] = dd[c].values[perm]
        p = pd.Series(np.nan, index=d.index)
        for g, mdl in models.items():
            te = d.index[d.group == g]
            p.loc[te] = mdl.predict(dd.loc[te, feats])
        s = score_pred(d, p)
        return dict(d_mae=s["mae_log_site_mean"] - base["mae_log_site_mean"],
                    d_within2=base["within2_site_mean"] - s["within2_site_mean"])
    single = {f: run([f]) for f in feats}
    grouped = {}
    for g in GROUPS:
        cols = [f for f in feats if group_of(f) == g]
        if cols:
            grouped[g] = dict(run(cols), n_feats=len(cols))
    return single, grouped


# ---------------------------------------------------------------- 4. proxies

def proxies(sf: pd.DataFrame, units: list[str]) -> pd.DataFrame:
    """Each cloud feature from what the app has: leave-one-out OLS on ranks-free standardised inputs."""
    s = sf[sf.unit.isin(units)].reset_index(drop=True)
    have = ["hd_h_med", "hd_closure100", "chm_gap_r250", "chm_sd_r100", "decid"]
    out = []
    targets = [f"{k}_r100" for k in ("b_05_2", "nrd_05_2", "nrd_05_3", "bush_nrd", "nrd_2_5", "cbh25", "cbh25_rel",
                                     "depth25", "trunk_open", "lai_first", "b_2_5")]
    for t in targets:
        if t not in s:
            continue
        m = s[have + [t]].notna().all(axis=1).values
        X, y = s.loc[m, have].values.astype(float), s.loc[m, t].values.astype(float)
        n = len(y)
        if n < 10:
            continue
        pred = np.zeros(n)
        for i in range(n):
            k = np.arange(n) != i
            mu, sd = X[k].mean(0), X[k].std(0) + 1e-9
            A = np.c_[np.ones(k.sum()), (X[k] - mu) / sd]
            # ridge, lambda 1: 5 inputs on ~24 sites
            beta = np.linalg.solve(A.T @ A + np.diag([0] + [1.0] * X.shape[1]), A.T @ y[k])
            pred[i] = np.r_[1, (X[i] - mu) / sd] @ beta
        r2 = 1 - ((y - pred) ** 2).sum() / ((y - y.mean()) ** 2).sum()
        best = max(have, key=lambda h: abs(spearman(s.loc[m, h].values.astype(float), y)[0]))
        out.append(dict(feature=t, n=n, loo_r2=float(r2), best_single=best,
                        rho_best=spearman(s.loc[m, best].values.astype(float), y)[0]))
    return pd.DataFrame(out)


# ---------------------------------------------------------------- 5. a rule the app can carry

RULES = [  # (label, terms): log(floor/top at 2 m) = b0 + sum b_k x_k, fitted on tower x stability x leaf cells
    ("stability only", ["s", "unst"]),
    ("closure + stability", ["closure", "s", "unst"]),
    ("closure + leaves down + stability", ["closure", "leafless", "s", "unst"]),
    ("+ conifer share", ["closure", "conifer", "leafless", "s", "unst"]),
    ("+ log h", ["closure", "logh", "leafless", "s", "unst"]),
    ("+ relief 1 km", ["closure", "leafless", "s", "unst", "relief"]),
    ("+ mid-story 5 m-h/2 (cloud)", ["closure", "leafless", "s", "unst", "mid"]),
    ("+ crown base / h (cloud)", ["closure", "leafless", "s", "unst", "cbhrel"]),
    ("+ trunk openness (cloud)", ["closure", "leafless", "s", "unst", "trunk"]),
    ("+ bush 0.5-3 m NRD (cloud)", ["closure", "leafless", "s", "unst", "bush"]),
    ("CHM gap 50 m in place of closure", ["gap50", "leafless", "s", "unst"]),
]
RULE_SRC = {"gap50": "chm_gap_r50", "relief": "relief1000", "mid": "b_5_halfh_r100", "cbhrel": "cbh25_rel_r100",
            "trunk": "trunk_open_r100", "bush": "bush_nrd_r100"}
CANDIDATE = "closure + leaves down + stability"   # the rule offered for model.ts (why_floor.md, "Suggested change")
REF_CHECKED: dict[str, str] = {}   # tower -> how its top wind compares with a forecast 10 m there (none checked yet)


def rule_terms(t: pd.DataFrame, terms: list[str]) -> np.ndarray:
    cols = []
    for k in terms:
        if k == "closure":
            cols.append(t.app_closure / 100)
        elif k == "logh":
            cols.append(np.log(np.maximum(t.app_h, 2)))
        elif k == "conifer":
            cols.append(1 - t.decid)
        elif k == "s":
            cols.append(t.app_s)
        else:
            cols.append(t[k])
    return np.column_stack([np.ones(len(t))] + [np.asarray(c, float) for c in cols])


def rules(d: pd.DataFrame, sf: pd.DataFrame, alpha: float) -> dict:
    """Constant baselines and log-linear rules, leave-one-site-out, on the towers with the point cloud (so
    every rule is scored on the same towers). A rule is fitted by weighted least squares on the tower x
    stability x leaf cells' median floor/top (carried to 2 m by alpha), each site weight 1; it predicts 2 m and
    is scored against the sensor (carried back up). Within 2x and median |log error| per tower, then the mean
    over towers; calm = the rule's floor speed under 0.3 m/s against the measured share."""
    m = sf.set_index("unit")
    x = d[d.unit.isin(m.index[m.h_r100.notna()])].copy()
    for k, c in RULE_SRC.items():
        x[k] = x.unit.map(m[c])
    x["leafless"] = x.leaf_off * x.decid
    x["unst"] = (x.cls_tower == 0).astype(float)
    x["cell"] = x.unit + "|" + x.stab + "|" + x.leaf_state
    up = np.where(x.z_floor > HEAD[1], (x.z_floor / 2.0) ** alpha, 1.0)
    agg = {k: (k, "mean") for k in ["leafless", "app_s", "unst", "app_closure", "app_h", "decid"] + list(RULE_SRC)}
    C = x.groupby("cell").agg(group=("group", "first"), n=("meas", "size"), y=("meas_adj", "median"), **agg)
    C = C[C.n >= MIN_CELL]
    C["w"] = C.n / C.groupby("group").n.transform("sum")
    groups = sorted(x.group.unique())

    def score(pred) -> dict:
        q = x.meas / pred
        ok = (q >= 0.5) & (q <= 2)
        per = pd.DataFrame(dict(ok=ok, err=np.abs(np.log(q)), unit=x.unit, cm=x.calm,
                                cc=(pred * x.ws_top < F.CALM).astype(float))).groupby("unit").mean(numeric_only=True)
        err = np.abs(np.log(q)).groupby(x.unit).median()
        return dict(within2=float(per.ok.mean()), mae=float(err.mean()), calm_gap=float((per.cc - per.cm).abs().mean()),
                    calm_called=float(per.cc.mean()), calm_meas=float(per.cm.mean()),
                    worst=", ".join(f"{u} {v:.0%}" for u, v in per.ok.sort_values().head(3).items()))
    out = {"app old": score(x.app_old), "app new": score(x.app_new)}
    pc, pm = pd.Series(np.nan, index=x.index), pd.Series(np.nan, index=x.index)
    for g in groups:
        tr = x[x.group != g]
        pc[x.group == g] = tr.groupby("group").meas.median().median()
        pm[x.group == g] = x.app_new[x.group == g] * np.exp(tr.groupby("group").lb_new.median().median())
    out["constant (other towers' median)"] = score(pc)
    out["app new x other towers' median bias"] = score(pm)
    coefs = {}
    for label, terms in RULES:
        pred = pd.Series(np.nan, index=x.index)
        bs = []
        for g in groups:
            tr = C[C.group != g].dropna()
            X = rule_terms(tr, terms)
            w = np.sqrt(tr.w.values)
            b = np.linalg.lstsq(X * w[:, None], np.log(tr.y.values) * w, rcond=None)[0]
            bs.append(b)
            te = x[x.group == g]
            pred[te.index] = np.exp(rule_terms(te, terms) @ b)
        out[f"rule: {label}"] = score(pred * up)
        tr = C.dropna()
        w = np.sqrt(tr.w.values)
        b = np.linalg.lstsq(rule_terms(tr, terms) * w[:, None], np.log(tr.y.values) * w, rcond=None)[0]
        coefs[label] = dict(terms=["const"] + terms, all_sites=[round(float(v), 3) for v in b],
                            fold_sd=[round(float(v), 3) for v in np.std(bs, axis=0)])
    return dict(scores=out, coefs=coefs, towers=sorted(x.unit.unique()))


def leaf_table(d: pd.DataFrame) -> pd.DataFrame:
    x = d[d.decid >= 0.6]
    t = x.groupby(["unit", "leaf_state"]).meas.median().unstack()
    a = x.groupby(["unit", "leaf_state"]).app_new.median().unstack()
    return pd.DataFrame(dict(decid=x.groupby("unit").decid.first(), meas_on=t["leaf-on"], meas_bare=t["bare"],
                             meas_ratio=t["bare"] / t["leaf-on"], app_on=a["leaf-on"], app_bare=a["bare"],
                             app_ratio=a["bare"] / a["leaf-on"])).reset_index()


def follow_by_height(d: pd.DataFrame) -> pd.DataFrame:
    x = d[d.dir_ok].copy()
    x["hc"] = pd.cut(x.app_h, [0, 10, 20, 30, 60], labels=["<10 m", "10-20 m", "20-30 m", "30+ m"])
    x["night_stable"] = (x.sun < -6) & (x.cls_tower >= 2)
    rows = []
    for (hc, ns), s in x.groupby(["hc", "night_stable"], observed=True):
        per = s.groupby("unit").coupled.mean()
        rows.append(dict(h=hc, air="night, stable above" if ns else "other", towers=len(per), follow=float(per.mean()),
                         lo=float(per.min()), hi=float(per.max())))
    return pd.DataFrame(rows)


# ---------------------------------------------------------------- report

def f2(v, p=2):
    return "" if v is None or (isinstance(v, float) and not np.isfinite(v)) else f"{v:.{p}f}"


def md_table(df: pd.DataFrame, cols: list[tuple[str, str, str]]) -> list[str]:
    L = ["| " + " | ".join(c[1] for c in cols) + " |", "|" + "---|" * len(cols)]
    for _, r in df.iterrows():
        cells = []
        for c, _, fmt in cols:
            v = r.get(c)
            if fmt == "s":
                cells.append(str(v))
            elif fmt == "%":
                cells.append("" if v is None or not np.isfinite(v) else f"{v:.0%}")
            elif fmt == "x":
                cells.append("" if v is None or not np.isfinite(v) else f"{v:.2f}x")
            else:
                cells.append(f2(v, int(fmt)))
        L.append("| " + " | ".join(cells) + " |")
    return L


def main() -> None:
    low_priority()
    t0 = time.time()
    d, meta = load_rows()
    print(f"{len(d)} rows, {d.unit.nunique()} units, {time.time() - t0:.0f} s")
    prof = trunk_profile()
    alpha = prof.get("alpha_median", 0.0)
    d["meas_adj"] = np.where(d.z_floor > HEAD[1], d.meas * (2.0 / d.z_floor) ** alpha, d.meas)
    units, cells = responses(d)
    units.to_csv(WHY / "response_unit.csv", index=False, float_format="%.4g")
    cells.to_csv(WHY / "response_cells.csv", index=False, float_format="%.4g")
    sf = site_features(units, meta)
    sf.to_csv(WHY / "site_features.csv", index=False, float_format="%.4g")
    have_aop = sf.unit[sf.get("h_r100", pd.Series(np.nan, index=sf.index)).notna()].tolist()
    all_units = [u for u in have_aop if u != "HARV-EMS"]          # HARV once (NEON's tower)
    head_units = [u for u in have_aop if bool(sf.set_index("unit").loc[u, "head"])]
    res = {"trunk_profile": prof, "units_with_aop": have_aop}
    st_all = site_stats(sf, "logbias_new", all_units)
    st_adj = site_stats(sf, "logbias_adj", all_units)
    st_head = site_stats(sf, "logbias_new", head_units)
    st_all.to_csv(WHY / "site_stats_all.csv", index=False, float_format="%.4g")
    st_adj.to_csv(WHY / "site_stats_heightadj.csv", index=False, float_format="%.4g")
    st_head.to_csv(WHY / "site_stats_head.csv", index=False, float_format="%.4g")
    sf["log_measured"] = np.log(sf.measured)
    st_meas = site_stats(sf, "log_measured", all_units)       # the measured ratio itself, no app in it
    st_follow = site_stats(sf, "follow", [u for u in all_units if np.isfinite(sf.set_index("unit").loc[u, "follow"])])
    st_calm = site_stats(sf, "calm_meas", all_units)
    st_meas.to_csv(WHY / "site_stats_measured.csv", index=False, float_format="%.4g")
    st_follow.to_csv(WHY / "site_stats_follow.csv", index=False, float_format="%.4g")
    st_calm.to_csv(WHY / "site_stats_calm.csv", index=False, float_format="%.4g")
    res["other_targets"] = {k: v.head(12).to_dict(orient="records") for k, v in
                            (("log measured floor/top", st_meas), ("follows", st_follow), ("calm", st_calm))}
    # row model
    rng = np.random.default_rng(SEED)
    dm = d[d.unit.isin(have_aop)].copy()
    sets = build_row_features(dm, sf)
    preds, scores, imps = {}, {}, {}
    for name, feats in sets.items():
        feats = [f for f in feats if f in dm and dm[f].notna().any()]
        sets[name] = feats
        p, models = fit_loso(dm, feats, rng)
        preds[name] = p
        scores[name] = score_pred(dm, p)
        single, grouped = perm_importance(dm, models, feats, p, rng)
        imps[name] = dict(single=single, grouped=grouped)
        print(f"row model [{name}] {len(feats)} feats: held-out within 2x {scores[name]['within2_site_mean']:.0%} "
              f"(site mean), {time.time() - t0:.0f} s", flush=True)
    zero = pd.Series(0.0, index=dm.index)
    scores["app_new"] = score_pred(dm, zero)
    scores["app_old"] = score_pred(dm, dm.lb_new - dm.lb_old)  # app_new x exp(lb_new - lb_old) = app_old
    # app_old check: meas / (app_new * exp(lb_new - lb_old)) = meas / app_old
    res.update(row_model=dict(features=sets, scores=scores, importance=imps, lgb=LGB, per_site=PER_SITE))
    pd.DataFrame({f"lb_pred_{k}": v for k, v in preds.items()} | dict(unit=dm.unit, lb_new=dm.lb_new)).groupby("unit").median() \
        .to_csv(WHY / "row_model_by_unit.csv", float_format="%.4g")
    ru = rules(d, sf, alpha)
    res["rules"] = ru
    lt = leaf_table(d)
    lt.to_csv(WHY / "leaf_effect.csv", index=False, float_format="%.4g")
    fh = follow_by_height(d)
    res["leaf_effect"] = lt.to_dict(orient="records")
    res["follow_by_height"] = fh.to_dict(orient="records")
    print("rules:", {k: round(v["within2"], 3) for k, v in ru["scores"].items()}, flush=True)
    px = proxies(sf, all_units)
    px.to_csv(WHY / "proxies.csv", index=False, float_format="%.4g")
    (WHY / "row_model.json").write_text(json.dumps(res, indent=1, default=float))
    md = report(d, units, cells, sf, st_all, st_adj, st_head, res, px, head_units, all_units)
    (WHY / "why_floor.md").write_text(md, encoding="utf-8")
    print(md)
    print(f"done in {time.time() - t0:.0f} s")


SUMMARY = """## Summary (written from the 2026-10-16 run; the tables below are regenerated each run)

**The app's new floor (x1.5) is within 2x of the measured floor/top on 59% of half-hours (mean of 26 towers; old
rule 36%). A single constant, 0.28 of the top wind, gets 84%.** The measured floor/top hardly changes from stand to
stand (0.15-0.40 in every closed stand). Over 29 towers its rank correlation with the app's is -0.03. The app's
value swings from stand to stand for the wrong reasons, and that swing is most of its error. A three-term rule
using inputs the app already has (closure, leaves down, stability) gets 89% held out. So does a LightGBM fed
everything the app has. Adding the point-cloud structure gives 88%: no gain.

**Too slow (measured faster than the app):**
- every conifer stand, by about 2.1x whatever the leaves are doing:
  - open western pine and juniper, SOAP 4.0x and YELL 3.7x;
  - the young dense Douglas-fir at ABBY, 3.8x;
  - montane conifer: RMNP, TEAK and WREF, 2.2x;
  - southern pine, 1.6-2.2x;
  - boreal spruce, 1.7-1.9x.
- every deciduous stand while it is still in leaf (1-19 Sep), 2.0x.

**Too fast (measured slower than the app):**
- tall, closed deciduous stands once the leaves are down: 0.80x on average after 15 Oct. The worst are US-MMS
  0.35x, LENO 0.61x and SERC 0.65x; Harvard's 2 m sonic reads 0.77x.

**The features that explain it:**
1. **Leaves down x deciduous share.** The biggest single term in the row model: shuffling it costs 18 points of
   within-2x. Across the 15 deciduous towers, the measured floor/top with leaves down over leaves on is 0.97-1.47
   (median 1.18). The app's goes up 2.4-3.8x. The bias's partial rho with deciduous share, holding height and
   closure fixed, is -0.60 (p 0.003). Every deciduous tower shows this.
2. **The level for evergreen and in-leaf stands.** Under a closed canopy, in_stand x 1.5 gives 0.08-0.13; the
   towers measure 0.21-0.24, about 2x more. The in_stand level sits between leaves-on and leaves-down because of
   the oversized leaves-down blend. With closure held fixed, conifer share and hardwood-in-leaf share do nothing
   to the measured ratio (coefficients -0.007 and +0.007, fold sd 0.06). The app's `+0.5 conifer` and `+0.3
   hardwood_leaf` terms in `a` cost another x0.85 or so.
3. **Closure / openness.** The CHM closure, the CHM gap at 50-250 m and the cloud's gap fraction and LAI all act as
   one variable. The measured ratio falls as exp(-1.34 C), about x0.26 from open to closed. The app's closure slope
   is about right. LAI and gap from the cloud add nothing beyond the CHM closure (partials about 0).
4. **Stand height.** With closure held fixed, the measured ratio is flat in h (log h coefficient -0.02 +- 0.03).
   From 10 m to 33 m stands the app's share climbs x1.4 in leaf and x1.7 with leaves down (f_top and the 1 - 2/h
   shape). That feeds both the tall-deciduous over-call and the short-conifer under-call.
5. **Stability.** Measured against neutral: unstable x1.2, stable x0.84, very stable x0.70. The app's (1 - 0.3 s)
   is right. It has no lift for unstable air, but adding one barely changes within-2x.
- A lead, not a rule: **terrain relief within 1 km.** About +0.2% per m (150 m of relief gives x1.35), and it
  takes the held-out rule from 89% to 94%. But only 9 hilly towers carry it, including the two open western
  stands. It is strongest at night in light wind, which is partly what the app's drainage and upslope layers
  already model.

**What the point clouds add:** some understanding, no held-out skill.
- Past height and closure, three structure features go with the measured ratio:
  - mid-story density (returns 5 m to h/2): partial rho -0.48, p 0.02;
  - crown base / h: +0.50, p 0.015;
  - open trunk space in the most open sector: +0.49.
- None of them raises a held-out score: the rules stay at 88-89%, and LightGBM goes from 89% to 88%.
- Over all towers, bush NRD (0.5-2 m and the bush model's 0.5-3 m) has no relation once closure is held fixed. At
  the 8 head-height towers (2 m sonics) it is the strongest correlate of the measured ratio itself (rho -0.86,
  p 0.007). OSBS and TALL, with no understory, read 0.30-0.37. DEJU and HARV-EMS, with NRD 0.22-0.25, read 0.17-0.20.
  That is roughly x0.6 over NRD 0.0-0.25. But 8 towers, all with bush below "thick", are not enough for a rule.
- None of these towers sits in thick bush (only SCBI reaches NRD 0.45+), and 17 of the 30 floor sensors are at
  3.3-11 m, above the bush layer. What a hazel or alder thicket does at a hunter's nose is still open.

**Calm and direction:**
- The new rule calls the floor calm far too often. Its calm share is off from the measured share by 29% on
  average (old rule 47%; the three-term rule 13%). ABBY: 96% called vs 14% measured; TEAK 87% vs 42%; WREF 83%
  vs 17%.
- The floor follows the top (within 45 deg):
  - 95% of the time under stands below 10 m;
  - 86% at 20-30 m;
  - 57% at 30 m and up, 48% on stable nights (WREF 21%).
- Following drops with stand height (rho -0.72, leave-one-out -0.79 to -0.69). The app assumes it always follows.
- Calm floors are rarer in hilly country (relief rho -0.59, partial -0.57) and more common under a dense mid-story
  (+0.47).

**Sensor heights don't explain it.** Four NEON towers have one level near 2 m and another at 0.35-0.45 h. The
trunk space between them is nearly uniform: u ~ z^alpha with alpha 0.02-0.21 (median 0.055). So the 3.3-11 m floor
sensors read only 3-8% above 2 m, and the "bias adj" column barely moves.

### Suggested change in model.ts (only inputs the app has)

In a stand (th > 0), replace `Math.min(FLOOR_OPEN_SHARE, cf * floorTune.trees)` with the towers' share:

```
C   = crown closure 0-1 (leaf-on, the bake's crown)      D = hardwood share 0-1
off = leaves.ts season, 0 in leaf -> 1 bare
share = min(0.7, 0.21 * exp(1.34 * (1 - C)) * (1 + 0.31 * D * off))
gm    = share * (1 - 0.3 * s)            // optional: * (1 + 0.2 * convective), unstable air x1.2
```

What this changes:
- no conifer, hardwood-in-leaf or stand-height term in the stand's share;
- leaves down raise the share at most x1.3, not x3.

Scores:
- held out (coefficients refitted without the tower being scored): within 2x on 89% of half-hours (app new 59%),
  and the calm share is off by 13% (app new 29%);
- with these all-tower coefficients: 92% on the 26 point-cloud towers, 88% on all 30. US-MMS stays the outlier at
  10%: it measures 0.11, under a closure that is only assumed.

To keep in_stand instead, make three changes:
- set `a`'s conifer and hardwood_leaf weights to 0;
- set build_microclimate.BARE from 0.35 to 0.8 (the towers' leaves-down lift equals 20% less closure, not 65%);
- set FLOOR_DEFAULT.trees from 1.5 to 2.5.

This keeps the f_top height shape. It scores 89% on the 26 point-cloud towers (85% on all 30), with the calm share
off by 15%. The x2.5 was picked on these same towers (x2.0 gives 86%, x3.0 gives 83%).

Direction: widen modelErr with stand height. Under 30 m+ stands the floor follows the top only about half the
time, and stable nights are worse.

**Caveat on the reference wind.** These ratios are the floor over the wind just above the canopy (the tower top,
1.0-1.7 h). floor.py treats that as the app's local 10 m wind, and in_stand was fitted that way. A forecast's 10 m
wind over tall forest may be lower than the wind above the canopy. If so, part of the app's rise with h (f_top)
is a 10 m-to-canopy-top conversion: it belongs in the chain, but not in the stand's share. Check that against
forecast 10 m winds at a few towers (HRRR/ERA5) before removing f_top outright.

### What the app has for each feature

| feature | what the app has | proxy |
|---|---|---|
| closure, gap, LAI-like openness | HD: LiDAR CHM / vegstructure canopy_cover. SD: ETH height + Hansen/SCANFI cover | same variable (LAI from returns vs closure rho 0.97); LiDAR closure is enough |
| deciduous share x leaf state | habitat hardwood share (FRI / SCANFI) + leaves.ts season | direct |
| stand height | CHM | direct (not wanted in the share) |
| stability | the app's s (layeringAt); unstable: its convective term | direct |
| terrain relief 1 km | the DEM in every bake | direct (a lead only) |
| crown base, depth | HD: computable from vegstructure `strata` (return counts at 0/0.5/1/2/3/5/10/15/20/25/45 m per 10 m cell, already in the npz, read by nothing). SD: none | cbh25 is ~0.55 h: LOO R2 0.90 from CHM height, but cbh25/h only 0.43 |
| mid-story 5 m-h/2, trunk openness | HD: from `strata` (its 5-10/10-15 m bins). SD: none | trunk openness LOO R2 0.45 from CHM + decid |
| bush 0.5-2 m / 0.5-3 m | HD: vegstructure understory NRD. SD: the bush model (Sentinel-2 LightGBM, CV r 0.54 in Canada) | from CHM alone LOO R2 0.22. A lead at head height only |

**The bush model was not run at the towers.** Its inputs are Canada-only: SCANFI species, closure, height and age;
CanLaD disturbance; MRDEM elevation (its second most important feature); and the 2020 Canadian land cover. At US
towers about 20 of its features would be missing, a domain it never trained on. Instead, each tower got the
model's own target from the point cloud: bush_nrd, build_vegstructure's 0.5-3 m NRD.

### How far to trust it

Robust:
- leaves down lift the share x1.2, not x3 (15 of 15 deciduous towers);
- conifer stands are under-called (every conifer tower is over 1.2x);
- a constant beats the app's stand-to-stand swing;
- the closure slope and the stability factors (fold sd 0.03-0.10);
- direction follows less under tall stands.

Not robust:
- the relief term;
- every point-cloud structure term (partials at p 0.02-0.07 among ~100 features, no held-out gain);
- the head-height-only bush signal (8 towers);
- ABBY: a 12 m regrowth stand flown in 2023, against tower years 2017-2025;
- closure at US-MMS, US-Uaf and SMEAR-II is assumed (no AOP flight);
- US-Prr sits just outside BONA's flight.

HARV-EMS is scored but left out of the site statistics, so the one physical site counts once. Sep-Nov only."""




def geo(x):
    x = np.asarray(x, float)
    x = x[np.isfinite(x) & (x > 0)]
    return float(np.exp(np.log(x).mean())) if x.size else np.nan


def report(d, units, cells, sf, st_all, st_adj, st_head, res, px, head_units, all_units) -> str:
    L = ["# Why the floor wind is faster or slower than the app's: the forest flux towers", "",
         "Written by `pipeline/towers/why_floor.py` (structure from `pipeline/towers/aop_structure.py`). "
         f"Rows as floor.py: Sep-Nov half-hours, top at {F.TOP_MIN}+ m/s, canopy {F.MIN_CANOPY}+ m, floor sensor "
         f"up to {F.MAX_FLOOR} m. **bias = measured floor/top over the app's** (median over rows); above 1 the app is "
         "too slow. App old = floor.py's emulation (in_stand blended to leaves-down by date, x (1 - 0.3 s)); app new "
         f"= model.ts now: min({CAP}, in_stand x {TREES}) x (1 - 0.3 s) in a stand. The {CAP} cap never binds at a "
         "tower (in_stand x 1.5 stays under it everywhere), so new = old x 1.5 throughout.", ""]
    L += [SUMMARY, ""]
    # 1
    prof = res["trunk_profile"]
    u = units.sort_values("bias_new", ascending=False)
    u = u.assign(unit_l=[f"{r.unit}{' (2 m)' if r.head else ''}" for r in u.itertuples()],
                 calm=[f"{r.calm_meas:.0%} / {r.calm_app_new:.0%}" for r in u.itertuples()])
    L += ["## 1. Response by tower", "",
          "Measured and app floor/top are row medians; within 2x = share of rows where measured/app new is 0.5-2; "
          "calm = floor under 0.3 m/s, measured / the app new's call (its floor speed under 0.3); follows = floor "
          "within 45 deg of the top when the floor is 0.3+ m/s (censored sectors left out; the app always follows). "
          "bias adj = the floor sensor carried down to 2 m by the trunk-space profile below. (2 m) marks the "
          f"head-height towers (floor {HEAD[0]}-{HEAD[1]} m).", ""]
    L += md_table(u, [("unit_l", "tower", "s"), ("z_floor", "floor m", "1"), ("h", "h m (CHM)", "1"),
                      ("closure", "closure %", "0"), ("decid", "decid", "2"), ("measured", "measured", "3"),
                      ("app_old", "app old", "3"), ("app_new", "app new", "3"), ("bias_new", "bias new", "x"),
                      ("bias_adj", "bias adj", "x"), ("within2_new", "within 2x new", "%"), ("calm", "calm meas / app", "s"),
                      ("follow", "follows", "%"), ("n", "rows", "0")])
    L += ["", "Trunk-space profile (u ~ z^alpha between a level near 2 m and one at 0.35-0.45 h, top 1+ m/s, both "
          "levels moving): " + "; ".join(f"{k} {v['z_lo']:g} to {v['z_hi']:g} m (h {v['h']:g}): x{v['ratio']:.2f}, "
                                         f"alpha {v['alpha']:.3f}" for k, v in prof.items() if k != "alpha_median")
          + f". Median alpha {prof.get('alpha_median', float('nan')):.3f}: the trunk space is close to uniform, so the "
          "3.3-11 m floor sensors read only a few % faster than 2 m would (bias adj).", ""]
    # 1b cells
    c = cells.copy()
    L += ["### By the air above and the leaves (site-equal: geometric mean of the towers' biases, mean of their rates)", ""]
    rows = []
    for (st, lf), x in c.groupby(["stab", "leaf"]):
        rows.append(dict(stab=st, leaf=lf, n=len(x), bias=geo(x.bias_new), bias_old=geo(x.bias_old),
                         meas=x.measured.mean(), app=x.app_new.mean(),
                         calm=f"{x.calm_meas.mean():.0%} / {x.calm_app_new.mean():.0%}", follow=x.follow.mean()))
    order = {"unstable": 0, "neutral": 1, "stable": 2, "very stable": 3, "no class": 4}
    t = pd.DataFrame(rows)
    t = t.assign(o=t.stab.map(order), o2=t.leaf.map({k: i for i, k in enumerate(LEAF_STATES)})).sort_values(["o", "o2"])
    L += md_table(t, [("stab", "above the stand", "s"), ("leaf", "leaves", "s"), ("n", "towers", "0"),
                      ("meas", "measured", "3"), ("app", "app new", "3"), ("bias", "bias new", "x"),
                      ("bias_old", "bias old", "x"), ("calm", "calm meas / app", "s"), ("follow", "follows", "%")])
    rows = []
    for (dc, lf), x in c.groupby(["decid_cls", "leaf"]):
        g = d[(d.decid_cls == dc) & (d.leaf_state == lf)].groupby("unit")
        rows.append(dict(dc=dc, leaf=lf, n=g.ngroups, bias=geo((g.meas.median() / g.app_new.median()).values),
                         meas=g.meas.median().mean(), app=g.app_new.median().mean(),
                         calm=f"{g.calm.mean().mean():.0%} / {g.calm_app_new.mean().mean():.0%}"))
    t = pd.DataFrame(rows)
    t = t.assign(o2=t.leaf.map({k: i for i, k in enumerate(LEAF_STATES)})).sort_values(["dc", "o2"])
    L += ["", "By deciduous share and the date (all stabilities together; bias here = a tower's median measured over "
          "its median app, then the geometric mean over towers):", ""]
    L += md_table(t, [("dc", "stand", "s"), ("leaf", "leaves", "s"), ("n", "towers", "0"), ("meas", "measured", "3"),
                      ("app", "app new", "3"), ("bias", "bias new", "x"), ("calm", "calm meas / app", "s")])
    L += ["", "Every tower x stability x leaf cell (100+ rows) is in `response_cells.csv`.", ""]
    # 2 structure
    s = sf[sf.unit.isin(res["units_with_aop"])].sort_values("logbias_new", ascending=False)
    L += ["## 2. Stand structure from the point clouds", "",
          "NEON AOP discrete-return LiDAR (DP1.30003.001), one leaf-on flight per site (month below; see "
          "`aop_structure.csv` and `raw/towers/aop/<SITE>/manifest.json` for why each flight), heights above the "
          "cloud's own ground. Within 100 m of the tower unless named. Band shares are of all returns; nrd = "
          "the band's returns over the returns at or below its top; bush = the bush model's own label (0.5-3 m NRD "
          "per 10 m cell); cbh25 = the height by which 25% of the returns over 2 m are passed; trunk open = "
          "1 - returns 1 m-0.5 h / returns over 1 m; lai = -ln(first-return ground share). Ordered by bias new.", ""]
    s = s.assign(bias=np.exp(s.logbias_new))
    L += md_table(s, [("unit", "tower", "s"), ("bias", "bias new", "x"), ("flight", "flight", "s"), ("h_r100", "h p90", "1"),
                      ("chm_gap_r100", "gap 100", "2"), ("chm_gap_r250", "gap 250", "2"), ("b_05_2_r100", "share 0.5-2", "3"),
                      ("nrd_05_2_r100", "nrd 0.5-2", "2"), ("bush_nrd_r100", "bush", "2"), ("nrd_2_5_r100", "nrd 2-5", "2"),
                      ("cbh25_r100", "cbh25 m", "1"), ("cbh25_rel_r100", "cbh25/h", "2"), ("trunk_open_r100", "trunk open", "2"),
                      ("lai_first_r100", "lai", "2"), ("density_r100", "pts/m2", "0")])
    # 3 site stats
    L += ["", "## 3. What goes with the bias", "",
          f"### Site level: Spearman of log bias (new) against each feature, {len(all_units)} towers (HARV once)", "",
          "rho with p; the range of rho leaving one tower out; partial rho holding the CHM height and closure fixed "
          "(ranks), and also z_floor/h. With ~25 towers |rho| > 0.40 is p < 0.05, and with ~100 features several pass "
          "that by chance: read the ones whose leave-one-out range keeps its sign and whose partial holds. "
          "Suffixes: _r50/_r100/_r250 = disc radius; _sec_min/_max = the lowest/highest of the 8 sectors; "
          "hd_ = the site file's 1 m CHM; sd_ = ETH/Hansen. Features with p < 0.2:", ""]
    top = st_all[st_all.p < 0.2].head(40)
    L += md_table(top, [("feature", "feature", "s"), ("n", "n", "0"), ("rho", "rho", "2"), ("p", "p", "3"),
                        ("rho_loo_min", "LOO min", "2"), ("rho_loo_max", "LOO max", "2"), ("prho_h_cl", "partial | h, closure", "2"),
                        ("p_h_cl", "p", "3"), ("prho_h_cl_zf", "partial | h, closure, z/h", "2"), ("p_h_cl_zf", "p", "3")])
    adj = st_adj.set_index("feature")
    L += ["", "With the floor sensors carried to 2 m (bias adj) the same features read: "
          + ", ".join(f"{f} {adj.loc[f, 'rho']:.2f}" for f in top.feature.head(12) if f in adj.index) + ".", ""]
    L += [f"### Head-height towers only ({len(head_units)}: {', '.join(head_units)})", "",
          "Too few for a test; shown for direction only.", ""]
    L += md_table(st_head.head(15), [("feature", "feature", "s"), ("n", "n", "0"), ("rho", "rho", "2"), ("p", "p", "3"),
                                      ("rho_loo_min", "LOO min", "2"), ("rho_loo_max", "LOO max", "2")])
    L += ["", "### The other targets, site level (Spearman, features with the lowest p)", ""]
    for name, recs in res.get("other_targets", {}).items():
        L.append(f"- **{name}**: " + "; ".join(f"{r['feature']} {r['rho']:+.2f} (p {r['p']:.3f}, LOO {r['rho_loo_min']:+.2f} to "
                                                f"{r['rho_loo_max']:+.2f})" for r in recs[:8]))
    L.append("")
    # row model
    rm = res["row_model"]
    sc = rm["scores"]
    L += ["", "### Row level: LightGBM of log bias, leave-one-site-out", "",
          f"Target log(measured/app new) per half-hour; {PER_SITE} rows per site per fit, sites weighted equally, "
          f"strongly regularised ({LGB['num_leaves']} leaves, {LGB['min_child_samples']} rows per leaf, "
          f"{LGB['n_estimators']} trees). `app` = what the app has (top wind, stability from the temperature pair, sun, "
          "month, leaves-down share, CHM height / closure / gap / spread / edge / upwind fetch / the upwind sector's "
          "CHM gap and height, deciduous share, slope, TPI, floor height); `cloud` = that plus the point-cloud "
          "structure (bands, nrd, crown base, depth, trunk openness, lai) round the tower and in the upwind sector. "
          "Prediction = app new x exp(predicted log bias). Held out:", "",
          "| | within 2x (mean of towers) | within 2x (pooled rows) | median abs log error (mean of towers) |",
          "|---|---|---|---|"]
    for k in ("app_old", "app_new", "app", "cloud"):
        v = sc[k]
        lab = {"app_old": "app old", "app_new": "app new (x1.5)", "app": "model, app's inputs",
               "cloud": "model, + point cloud"}[k]
        L.append(f"| {lab} | {v['within2_site_mean']:.0%} | {v['within2_pooled']:.0%} | {v['mae_log_site_mean']:.3f} |")
    L += ["", "Per tower, held out, within 2x (app new / model app / model cloud): "
          + "; ".join(f"{un} {sc['app_new']['per_unit'][un]['w2']:.0%} / {sc['app']['per_unit'][un]['w2']:.0%} / "
                      f"{sc['cloud']['per_unit'][un]['w2']:.0%}" for un in sorted(sc["app_new"]["per_unit"])) + ".", ""]
    for k in ("app", "cloud"):
        g = rm["importance"][k]["grouped"]
        L += [f"Grouped permutation importance, `{k}` (held out; rise in the towers' mean median |log error|, fall in "
              "within 2x):", "", "| group | features | + error | - within 2x |", "|---|---|---|---|"]
        for name, v in sorted(g.items(), key=lambda kv: -kv[1]["d_mae"]):
            L.append(f"| {name} | {v['n_feats']} | {v['d_mae']:+.3f} | {v['d_within2']:+.1%} |")
        sg = sorted(rm["importance"][k]["single"].items(), key=lambda kv: -kv[1]["d_mae"])[:10]
        L += ["", "Top single features: " + ", ".join(f"{f} {v['d_mae']:+.3f}" for f, v in sg) + ".", ""]
    # leaf, follow
    lt = pd.DataFrame(res["leaf_effect"])
    L += ["### The leaves: measured against the app, each deciduous tower (decid 0.6+)", "",
          "Median floor/top before 20 Sep (leaf-on) and after 15 Oct (bare), and bare over leaf-on:", ""]
    L += md_table(lt, [("unit", "tower", "s"), ("decid", "decid", "2"), ("meas_on", "measured on", "3"),
                       ("meas_bare", "measured bare", "3"), ("meas_ratio", "measured bare/on", "2"),
                       ("app_on", "app on", "3"), ("app_bare", "app bare", "3"), ("app_ratio", "app bare/on", "2")])
    fh = pd.DataFrame(res["follow_by_height"])
    L += ["", "### Direction: the floor following the top, by stand height (tower means; the app always follows)", ""]
    L += md_table(fh, [("h", "stand h", "s"), ("air", "air", "s"), ("towers", "towers", "0"), ("follow", "follows", "%"),
                       ("lo", "lowest tower", "%"), ("hi", "highest", "%")])
    L.append("")
    # 5 rules
    ru = res["rules"]
    L += ["## 4. A rule in the app's own terms", "",
          f"Scored leave-one-site-out on the {len(ru['towers'])} towers with a point cloud (so every line is on the same "
          "towers). A rule = log(floor/top at 2 m) = b0 + sum b x, fitted on the tower x stability x leaf cells' median "
          "(each site weight 1); closure = the app's crown closure input (0-1, the LiDAR CHM's leaf-on cover within "
          "100 m), leaves down = leaves.ts's 0-1 season x the deciduous share, s = the app's 0-1 stable, unst = 1 "
          "when the air above is unstable (z/L < -0.1). calm gap = mean over towers of |rule's calm share - measured|.", "",
          "| | within 2x (mean of towers) | median abs log error | calm gap | worst towers |", "|---|---|---|---|---|"]
    for k, v in ru["scores"].items():
        L.append(f"| {k} | {v['within2']:.0%} | {v['mae']:.3f} | {v['calm_gap']:.0%} | {v['worst']} |")
    L += ["", "Coefficients, all towers (fold-to-fold sd in brackets):", ""]
    for k, v in ru["coefs"].items():
        L.append(f"- {k}: " + ", ".join(f"{t} {b:+.3f} ({sd:.3f})" for t, b, sd in zip(v["terms"], v["all_sites"], v["fold_sd"])))
    L.append("")
    # 4 proxies
    L += ["## 5. What the app has for each feature", "",
          "Each point-cloud feature (100 m) predicted leave-one-tower-out from what an HD area has (CHM tree median "
          "height, closure 100 m, CHM gap 250 m, CHM spread, deciduous share; ridge on standardised inputs):", ""]
    L += md_table(px, [("feature", "feature", "s"), ("n", "towers", "0"), ("loo_r2", "LOO R2", "2"),
                       ("best_single", "best single input", "s"), ("rho_best", "its rho", "2")])
    L.append("")
    return "\n".join(L) + "\n"


def report_only() -> None:
    """Rebuild why_floor.md from the saved outputs (the rows are reloaded for the leaf table): no model fits."""
    d, _ = load_rows()
    res = json.loads((WHY / "row_model.json").read_text())
    alpha = res["trunk_profile"].get("alpha_median", 0.0)
    d["meas_adj"] = np.where(d.z_floor > HEAD[1], d.meas * (2.0 / d.z_floor) ** alpha, d.meas)
    units = pd.read_csv(WHY / "response_unit.csv")
    cells = pd.read_csv(WHY / "response_cells.csv")
    sf = pd.read_csv(WHY / "site_features.csv")
    st = {k: pd.read_csv(WHY / f"site_stats_{k}.csv") for k in ("all", "heightadj", "head")}
    px = pd.read_csv(WHY / "proxies.csv")
    have = res["units_with_aop"]
    m = sf.set_index("unit")
    all_units = [u for u in have if u != "HARV-EMS"]
    head_units = [u for u in have if bool(m.loc[u, "head"])]
    md = report(d, units, cells, sf, st["all"], st["heightadj"], st["head"], res, px, head_units, all_units)
    (WHY / "why_floor.md").write_text(md, encoding="utf-8")
    print(f"wrote {WHY / 'why_floor.md'}")


def card(path: Path) -> dict:
    """The towers' floor card from the saved row_model.json (no rows, no fits; run the script plain to refresh it)."""
    src = WHY / "row_model.json"
    res = json.loads(src.read_text())
    sc = res["rules"]["scores"]

    def one(k: str) -> dict:
        v = sc[k]
        out = dict(within2=round(v["within2"], 3), medianAbsLog=round(v["mae"], 3), calmGap=round(v["calm_gap"], 3))
        if "calm_called" in v:
            out.update(calmCalled=round(v["calm_called"], 3), calmMeasured=round(v["calm_meas"], 3))
        return out
    rules_ = {k.removeprefix("rule: "): v["within2"] for k, v in sc.items() if k.startswith("rule: ")}
    best = max(rules_, key=rules_.get)
    c = dict(
        towers=len(res["rules"]["towers"]),
        heldOut="leave-one-site-out (a rule's coefficients refitted without the tower scored)",
        written=time.strftime("%Y-%m-%dT%H:%M", time.localtime(src.stat().st_mtime)),
        appNow=one("app new"), appOld=one("app old"), constant=one("constant (other towers' median)"),
        candidate=dict(rule=CANDIDATE, **one(f"rule: {CANDIDATE}"), coefs=res["rules"]["coefs"].get(CANDIDATE)),
        bestRule=dict(rule=best, within2=round(rules_[best], 3)),
        beatsAppNow=sc[f"rule: {CANDIDATE}"]["within2"] > sc["app new"]["within2"],
        beatsConstant=sc[f"rule: {CANDIDATE}"]["within2"] > sc["constant (other towers' median)"]["within2"],
        reference="top = the tower's wind just above the canopy (1.0-1.7 h), not a forecast's 10 m",
        refChecked=REF_CHECKED,
    )
    text = json.dumps(c, indent=1)
    path.write_text(text, encoding="utf-8")
    print(text)
    return c


if __name__ == "__main__":
    js = sys.argv[sys.argv.index("--json") + 1] if "--json" in sys.argv else None
    if js:
        card(Path(js))
    elif "--report" in sys.argv:
        report_only()
    else:
        main()
