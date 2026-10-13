"""The floor model: from the air above the trees, what happens at head height on
the forest floor. Learned on the flux towers in raw/towers/rows/*.csv.gz (rows.py
and the NEON writer), tested leaving whole sites out.

    py -3.14 pipeline/towers/floor.py

Targets, over half-hours with the top at TOP_MIN m/s or more:
- coupled: the floor's direction within 45 deg of the top's, over rows with the
  floor at 0.3 m/s or more (2D sonics have no direction below that);
- calm: the floor under 0.3 m/s;
- log ratio: log(floor / top speed), the floor held at 0.05 m/s or more.

Learned variants:
- "tower": every feature, z/L from the tower's own u* and H where present;
- "phone": what the app can know (no u*, no H): stability from the zeroed
  temperature pair above the stand (neon_look.stability), stable + very stable pooled;
- "hd" / "sd": the phone's air and ground with the stand from 1 m LiDAR / from ETH + Hansen
  (raw/towers/sites/*.json), each grade with its own canopy height.

Baselines on the same held-out sites:
- (i) always coupled (p 0.99, calm 0.01), fit.json's floor/top ratio by
  stability, pooled over the other fit.json sites;
- (ii) SMEAR II's split as INVERSE v2 applies it (pipeline/inverse/classes.py
  SMEAR, its class from z/L for "tower" and from the bulk Ri for "phone", the
  5 m/s override);
- (iii) a lookup table: the same classes, rates pooled over the training sites
  (each site weighted equally).

Writes raw/towers/floor.json, raw/towers/floor.md, the all-site models in
raw/towers/floor-models/ and a terrain cache raw/towers/terrain.json.
"""
from __future__ import annotations

import glob
import io
import json
import math
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd

HERE = Path(__file__).resolve().parent
TOWERS = HERE.parents[0] / "raw" / "towers"
ROWS = TOWERS / "rows"
TERRAIN = TOWERS / "terrain.json"
MODELS = TOWERS / "floor-models"
NEON_RAW = HERE.parents[0] / "raw" / "regimes" / "neon"
SITES = TOWERS / "sites"
sys.path.insert(0, str(HERE))
from fit import SITE  # noqa: E402  (deciduous shares of the AmeriFlux sites)
import neon_look as NL  # noqa: E402  (stability from the temperature pair, as the NEON first look reads it)

TOP_MIN = 1.0       # m/s at the top: a wind above to follow
CALM = 0.3          # m/s at the floor: under this a 2D sonic's direction means nothing
FOLLOW = 45.0       # deg: the floor follows the top
FLOOR_MIN = 0.05    # m/s: the floor in the log ratio is held at this or more
OVERRIDE = 5.0      # m/s at the top: INVERSE v2's "top > 5 m/s" row
CENSOR_REL = 0.75   # a top sector whose floor directions are this much rarer than the site's best is censored
PER_SITE_CAP = 10000  # rows per site per fit (random), to keep the PC free; sites are weighted equally anyway
SLOPED_DEG = 3.0    # tower slope (150 m) that counts as sloped
MIN_CANOPY = 2.0    # m: a stand at least this tall (US-Prr's open spruce is 2.5)
MAX_FLOOR = 12.0    # m: trunk-space floors stay in (NEON WREF 11.1 m); z_floor/h is a feature and a head-height subset is scored
SEED = 7
G, KAPPA, CP = 9.81, 0.4, 1005.0
CLASSES = ["unstable", "neutral", "stable", "very stable"]

# SMEAR II as INVERSE v2 uses it (pipeline/inverse/classes.py SMEAR, copied, not imported):
# P(decoupled), P(floor within 45 of top) over all rows, P(calm floor < 0.25 m/s), floor/top speed.
SMEAR = {
    "unstable": dict(dec=0.11, follow=0.74, calm=0.10, ratio=0.22),
    "neutral": dict(dec=0.07, follow=0.84, calm=0.06, ratio=0.19),
    "stable": dict(dec=0.27, follow=0.54, calm=0.24, ratio=0.14),
    "very stable": dict(dec=0.74, follow=0.18, calm=0.60, ratio=0.10),
    "top > 5 m/s": dict(dec=0.01, follow=0.99, calm=0.00, ratio=0.17),
    # stable and very stable read together, for a class from gradients: SMEAR's two rows weighted by their
    # half-hours with the top at 1.5+ m/s (1,838 and 205)
    "stable (pooled)": dict(dec=0.32, follow=0.50, calm=0.28, ratio=0.135),
}

# One physical site under several files: the AmeriFlux mirror of a NEON tower and NEON's own,
# and Harvard's EMS tower 140 m from NEON HARV. Grouped for the leave-one-site-out split and
# de-duplicated on time (the first file in sorted order wins: AMF- before NEON-).
ALIAS = {
    "AMF-US-xBN": "BONA", "NEON-BONA": "BONA",
    "AMF-US-xDJ": "DEJU", "NEON-DEJU": "DEJU",
    "AMF-US-xHA": "HARV", "NEON-HARV": "HARV", "HF-EMS": "HARV",
    "AMF-US-xRM": "RMNP", "NEON-RMNP": "RMNP",
    "AMF-US-xST": "STEI", "NEON-STEI": "STEI",
    "AMF-US-xTR": "TREE", "NEON-TREE": "TREE",
    "AMF-US-xUN": "UNDE", "NEON-UNDE": "UNDE",
    "AMF-US-MMS": "US-MMS", "AMF-US-Prr": "US-Prr", "AMF-US-Uaf": "US-Uaf",
}
# deciduous share of the stand by group (fit.py SITE for the AmeriFlux ones; NEON site pages for the rest)
DECID = {
    "US-MMS": SITE["US-MMS"][2], "US-Prr": SITE["US-Prr"][2], "US-Uaf": SITE["US-Uaf"][2],
    "BONA": SITE["US-xBN"][2], "DEJU": SITE["US-xDJ"][2], "HARV": SITE["US-xHA"][2], "RMNP": SITE["US-xRM"][2],
    "STEI": SITE["US-xST"][2], "TREE": SITE["US-xTR"][2], "UNDE": SITE["US-xUN"][2],
    "SMEAR-II": 0.05, "BART": 0.8, "YELL": 0.0, "WREF": 0.0, "ABBY": 0.1, "TEAK": 0.0, "SOAP": 0.1, "GRSM": 0.8,
    "MLBS": 0.9, "SCBI": 0.9, "SERC": 0.9, "ORNL": 0.9, "BLAN": 0.9, "LENO": 0.9, "UKFS": 0.9, "TALL": 0.4,
    "DELA": 0.6, "CLBJ": 0.9, "NIWO": 0.0, "JERC": 0.2, "OSBS": 0.1, "SJER": 0.5, "PUUM": 0.0, "GUAN": 0.9, "HEAL": 0.5,
}
DIR_SUSPECT = {"HF-EMS"}           # floor direction unverified (maybe 180 deg out): calm and ratio only
FLAT = {"SMEAR-II": 179.0}         # no 3DEP; flat by the SMEAR II README (elevation, m)
USGS = "https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer/exportImage"

FEATURES = {
    "tower": ["ws_top", "zeta", "zeta_grad", "cls_tower", "sun", "h_since_sunset", "h_since_sunrise", "month",
              "canopy_h", "decid", "ztop_rel", "zfloor_rel", "slope", "wind_vs_downslope"],
    "phone": ["ws_top", "zeta_grad", "cls_grad", "sun", "h_since_sunset", "h_since_sunrise", "month",
              "canopy_h", "decid", "ztop_rel", "zfloor_rel", "slope", "wind_vs_downslope"],
}
# Strongly regularised: ~25 sites, and every stand feature is constant within a site (an ablation on the
# 2026-10-12 snapshot: 15 leaves / 200 per leaf / 300 trees scored worse held-out on all three targets).
LGB = dict(n_estimators=200, learning_rate=0.05, num_leaves=7, min_child_samples=2000, subsample=0.7,
           subsample_freq=1, colsample_bytree=0.8, reg_lambda=1.0, n_jobs=2, verbose=-1, random_state=SEED)


# ---------------------------------------------------------------- sun

def sun_elev(t_utc: pd.DatetimeIndex, lat, lon) -> np.ndarray:
    """Sun's elevation (deg), NOAA low-accuracy formulas (as first_look.py)."""
    doy = t_utc.dayofyear.values
    hr = t_utc.hour.values + t_utc.minute.values / 60 + t_utc.second.values / 3600
    g = 2 * np.pi / 365 * (doy - 1 + (hr - 12) / 24)
    decl = (0.006918 - 0.399912 * np.cos(g) + 0.070257 * np.sin(g) - 0.006758 * np.cos(2 * g)
            + 0.000907 * np.sin(2 * g) - 0.002697 * np.cos(3 * g) + 0.00148 * np.sin(3 * g))
    eqt = 229.18 * (0.000075 + 0.001868 * np.cos(g) - 0.032077 * np.sin(g) - 0.014615 * np.cos(2 * g)
                    - 0.040849 * np.sin(2 * g))
    ha = np.radians((hr * 60 + eqt + 4 * np.asarray(lon)) / 4 - 180)
    la = np.radians(np.asarray(lat))
    return np.degrees(np.arcsin(np.sin(la) * np.sin(decl) + np.cos(la) * np.cos(decl) * np.cos(ha)))


def since_rise_set(t_mid: pd.Series, lat: float, lon: float) -> tuple[np.ndarray, np.ndarray]:
    """Hours since the last sunrise and the last sunset (upper limb, -0.833 deg), from a 5-min sun track."""
    days = pd.DatetimeIndex(t_mid.dt.floor("D").unique())
    grid = (days.tz_convert(None).repeat(2 * 288 + 1) - pd.Timedelta(days=1)
            + pd.to_timedelta(np.tile(np.arange(2 * 288 + 1) * 5, len(days)), unit="min"))
    grid = pd.DatetimeIndex(np.unique(grid.values)).tz_localize("UTC")
    e = sun_elev(grid, lat, lon) + 0.833
    tg = grid.asi8 / 3.6e12  # hours
    up = (e[:-1] < 0) & (e[1:] >= 0)
    dn = (e[:-1] >= 0) & (e[1:] < 0)
    cont = np.diff(tg) < 0.1  # only across consecutive grid points
    frac = e[:-1] / (e[:-1] - e[1:] + 1e-12)
    tx = tg[:-1] + frac * (tg[1:] - tg[:-1])
    rises, sets = tx[up & cont], tx[dn & cont]
    t = pd.DatetimeIndex(t_mid).asi8 / 3.6e12

    def since(ev):
        i = np.searchsorted(ev, t, side="right") - 1
        out = np.where(i >= 0, t - ev[np.clip(i, 0, None)], np.nan)
        return np.where(out > 30, np.nan, out)
    return since(rises), since(sets)


# ---------------------------------------------------------------- terrain

def fetch_3dep(lat: float, lon: float, half: float = 3000.0, cell: float = 30.0):
    """USGS 3DEP exportImage (as pipeline/surrogate/seed.py fetch_3dep), a 6 km square at 30 m in UTM."""
    import rasterio  # noqa: F401
    from pyproj import Transformer
    from rasterio.io import MemoryFile
    epsg = 32600 + int((lon + 180) // 6) + 1
    x, y = Transformer.from_crs("EPSG:4326", f"EPSG:{epsg}", always_xy=True).transform(lon, lat)
    n = int(2 * half / cell)
    q = {"bbox": f"{x - half},{y - half},{x + half},{y + half}", "bboxSR": epsg, "imageSR": epsg, "size": f"{n},{n}",
         "format": "tiff", "pixelType": "F32", "noDataInterpretation": "esriNoDataMatchAny",
         "interpolation": "RSP_BilinearInterpolation", "f": "image"}
    for attempt in range(5):
        try:
            with urllib.request.urlopen(USGS + "?" + urllib.parse.urlencode(q), timeout=120) as r:
                data = r.read()
            break
        except Exception as e:  # the service drops the odd request
            if attempt == 4:
                raise
            print(f"  3DEP retry {attempt + 1}: {e}")
            time.sleep(5 * (attempt + 1))
    with MemoryFile(io.BytesIO(data)) as mf, mf.open() as src:
        return src.read(1).astype(float), epsg, x, y, cell


def terrain_of(stem: str, lat: float, lon: float, cache: dict) -> dict:
    """Tower slope and downslope bearing (true, toward which the ground falls) at ~150 m
    (Gaussian sigma 75 m on the 30 m DEM) and at ~1 km (sigma 500 m), relief and TPI within 1 km."""
    if stem in cache:
        return cache[stem]
    if stem in FLAT:
        out = dict(elev=FLAT[stem], slope=0.0, downslope=None, slope_1km=0.0, downslope_1km=None, relief_1km=None,
                   tpi_1km=None, src="flat by the site README")
        cache[stem] = out
        return out
    from pyproj import Geod, Transformer
    from scipy.ndimage import gaussian_filter
    dem, epsg, x, y, cell = fetch_3dep(lat, lon)
    if not np.isfinite(dem).all() or (dem < -1000).any():
        raise RuntimeError(f"{stem}: 3DEP has holes at {lat},{lon}")
    c = dem.shape[0] // 2
    to_ll = Transformer.from_crs(f"EPSG:{epsg}", "EPSG:4326", always_xy=True)
    geod = Geod(ellps="WGS84")
    out = dict(elev=float(dem[c, c]), src="USGS 3DEP 30 m")
    for tag, sig in (("", 75.0), ("_1km", 500.0)):
        s = gaussian_filter(dem, sig / cell, mode="nearest")
        gy, gx = np.gradient(s, cell)  # rows run south (y down)
        dzdx, dzdy = gx[c, c], -gy[c, c]
        out["slope" + tag] = float(np.degrees(np.arctan(np.hypot(dzdx, dzdy))))
        lo1, la1 = to_ll.transform(x, y)
        lo2, la2 = to_ll.transform(x - dzdx * 1e4, y - dzdy * 1e4)  # down the gradient
        out["downslope" + tag] = float(geod.inv(lo1, la1, lo2, la2)[0] % 360)
    r = int(1000 / cell)
    yy, xx = np.mgrid[-c:dem.shape[0] - c, -c:dem.shape[1] - c]
    disk = dem[(yy ** 2 + xx ** 2) <= r * r]
    out["relief_1km"] = float(disk.max() - disk.min())
    out["tpi_1km"] = float(dem[c, c] - disk.mean())
    cache[stem] = out
    return out


# ---------------------------------------------------------------- rows -> features

def wrap180(a):
    return (np.asarray(a, dtype=float) + 180) % 360 - 180


def ri_class(ri, dth):
    c = np.select([ri < -0.1, (ri < 0.067) | (dth < 0.2), ri < 0.167], [0, 1, 2], 3).astype(float)
    return np.where(np.isfinite(ri), c, np.nan)


def zeta_class(z):
    c = np.digitize(z, [-0.1, 0.1, 1.0]).astype(float)
    return np.where(np.isfinite(z), c, np.nan)


def apply_wd_qf(d: pd.DataFrame, stem: str) -> int:
    """NEON rows carry every direction; neon.py keeps windDirFinalQF (mostly the tower-wake sector) aside
    in raw/regimes/neon/<SITE>/wd_qf.csv.gz. Read strictly, as AmeriFlux BASE does for its NEON mirrors:
    a flagged direction is dropped (the speed stays). censor() then handles the sectors this empties."""
    if not stem.startswith("NEON-"):
        return 0
    f = NEON_RAW / stem[5:] / "wd_qf.csv.gz"
    if not f.exists():
        return 0
    q = pd.read_csv(f)
    q["t"] = pd.to_datetime(q.t_utc, utc=True, format="ISO8601")
    q = q.drop_duplicates("t").set_index("t")
    n = 0
    for col, qc in (("wd_floor", "wd_floor_qf"), ("wd_top", "wd_top_qf")):
        if qc in q:
            bad = (q[qc].reindex(d.t).values == 1) & d[col].notna().values
            d.loc[bad, col] = np.nan
            n += int(bad.sum())
    return n


def load() -> tuple[pd.DataFrame, dict]:
    files = sorted(glob.glob(str(ROWS / "*.csv.gz")))
    cache = json.loads(TERRAIN.read_text()) if TERRAIN.exists() else {}
    parts, info = [], {}
    stems = {Path(f).name[:-len(".csv.gz")]: f for f in files}
    group_of = {st: ALIAS.get(st, st[5:] if st.startswith("NEON-") else st) for st in stems}
    neon_groups = {group_of[st] for st in stems if st.startswith("NEON-")}
    flux = {}  # group -> AmeriFlux u* and H by half-hour, for NEON's copy of the same tower
    for stem, f in stems.items():
        if stem.startswith("AMF-") and group_of[stem] in neon_groups:
            # one copy of a tower: NEON's own (per-period sensor heights, the triple-aspirated top
            # temperature); AmeriFlux's mirror lends it u* and H, which NEON's 2D product lacks
            try:
                a = pd.read_csv(f, usecols=["t_utc", "ustar", "h_flux", "canopy_h"])
            except Exception as e:
                print(f"skip {stem}: unreadable ({e})")
                continue
            a["t30"] = pd.to_datetime(a.t_utc, utc=True, format="ISO8601").dt.floor("30min")
            flux[group_of[stem]] = a.drop_duplicates("t30").set_index("t30")[["ustar", "h_flux"]]
            info[stem] = dict(group=group_of[stem], skipped=True, canopy_h=float(a.canopy_h.iloc[0]))
            print(f"skip {stem}: NEON's copy of the tower is used (u* and H taken from this one)")
    for stem, f in stems.items():
        if stem in info:
            continue
        try:
            d = pd.read_csv(f)
        except Exception as e:  # another writer may be part-way through a file
            print(f"skip {stem}: unreadable ({e})")
            continue
        if d.empty:
            continue
        d["stem"] = stem
        d["group"] = group_of[stem]
        d["t"] = pd.to_datetime(d.t_utc, utc=True, format="ISO8601")
        n_qf = apply_wd_qf(d, stem)
        if n_qf:
            print(f"{stem}: NEON's direction flags (tower wake) applied to {n_qf} floor or top directions")
        if d.group.iloc[0] in flux:
            fx = flux[d.group.iloc[0]].reindex(d.t.dt.floor("30min"))
            d["ustar"] = d.ustar.fillna(pd.Series(fx.ustar.values, index=d.index))
            d["h_flux"] = d.h_flux.fillna(pd.Series(fx.h_flux.values, index=d.index))
        # stability from the temperature pair above the stand, as neon_look.py reads it: each site-year's
        # pair zeroed on its well-mixed half-hours, Monin-Obukhov solved for zeta at 0.73 h, x RSL 1.5
        r = d[["ta_hi", "ta_lo", "z_ta_hi", "z_ta_lo", "ws_top", "z_top"]].set_index(pd.DatetimeIndex(d.t))
        zg, offs = NL.stability(r, float(d.canopy_h.iloc[0]))
        d["zeta_grad"] = np.clip(zg.values, -10, 10)
        step = d.t.sort_values().diff().dt.total_seconds().median() / 60
        d["t_mid"] = d.t + pd.Timedelta(minutes=step / 2)
        lat, lon = float(d.lat.iloc[0]), float(d.lon.iloc[0])
        ter = terrain_of(stem, lat, lon, cache)
        TERRAIN.write_text(json.dumps(cache, indent=1))
        d["sun"] = sun_elev(pd.DatetimeIndex(d.t_mid), d.lat.values, d.lon.values)
        d["h_since_sunrise"], d["h_since_sunset"] = since_rise_set(d.t_mid, lat, lon)
        d["slope"] = ter["slope"]
        d["downslope"] = np.nan if ter["downslope"] is None else ter["downslope"]
        d["elev"] = ter["elev"]
        info[stem] = dict(group=d.group.iloc[0], rows=len(d), step_min=step, lat=lat, lon=lon,
                          canopy_h=float(d.canopy_h.iloc[0]), z_top=float(d.z_top.median()),
                          z_floor=sorted(float(z) for z in d.z_floor.dropna().unique()),
                          z_ta=[float(d.z_ta_lo.median()), float(d.z_ta_hi.median())],
                          years=[int(d.t.dt.year.min()), int(d.t.dt.year.max())], terrain=ter,
                          ta_offsets=offs, flux_from_amf=d.group.iloc[0] in flux)
        parts.append(d)
    d = pd.concat(parts, ignore_index=True)
    n0 = len(d)
    d["t30"] = d.t.dt.floor("30min")
    d = d.drop_duplicates(["group", "t30"], keep="first").reset_index(drop=True)
    if len(d) < n0:
        print(f"dropped {n0 - len(d)} rows duplicated across files of one site")
    unknown = sorted(set(d.group) - set(DECID))
    if unknown:
        print("no deciduous share for", unknown, "(NaN)")
    d["decid"] = d.group.map(DECID).astype(float)
    return d, info


def features(d: pd.DataFrame) -> pd.DataFrame:
    th_hi = d.ta_hi + 0.0098 * d.z_ta_hi
    th_lo = d.ta_lo + 0.0098 * d.z_ta_lo
    dz = d.z_ta_hi - d.z_ta_lo
    d["dth"] = th_hi - th_lo
    tk = d.ta_hi.fillna(d.ta_lo) + 273.15
    d["lapse"] = d.dth / dz * 10  # K per 10 m
    d["ri_b"] = (G / tk * d.dth * dz / np.maximum(d.ws_top, 0.5) ** 2).clip(-5, 5)
    rho = 101325 * np.exp(-d.elev.fillna(0) / 8434) / (287.05 * tk)
    ust = np.maximum(d.ustar, 0.01)
    # z/L at 0.75 x the canopy height above the displacement height: SMEAR II's 27 m EC over a 19 m stand
    # (z - d ~ 14 m) carried to every stand
    d["zeta"] = (-0.75 * d.canopy_h * KAPPA * G * d.h_flux / (rho * CP) / (tk * ust ** 3)).clip(-10, 10)
    d["cls_ri"] = ri_class(d.ri_b.values, d.dth.values)
    d["cls_zeta"] = zeta_class(d.zeta.values)
    # from gradients very stable is caught about 1 time in 4 (neon_look.py's check against eddy covariance):
    # stable and very stable are read together, class 2 = "stable (pooled)"
    d["cls_grad"] = np.minimum(zeta_class(d.zeta_grad.values), 2)
    d["cls_tower"] = d.cls_zeta.fillna(d.cls_grad)
    d["pooled"] = d.cls_zeta.isna()  # the class came from gradients (stable = stable or very stable)
    d["month"] = d.t_mid.dt.month
    d["ztop_rel"] = d.z_top / d.canopy_h
    d["zfloor_rel"] = d.z_floor / d.canopy_h
    # the top wind's heading (where it blows TO) against the bearing the ground falls toward:
    # 0 = blowing downhill (with the drainage), 180 = blowing uphill
    d["wind_vs_downslope"] = np.abs(wrap180(d.wd_top + 180 - d.downslope))
    d.loc[d.slope <= 0, "wind_vs_downslope"] = np.nan
    d["night"] = d.sun < -6
    # targets
    d["elig"] = d.ws_top >= TOP_MIN
    d["calm"] = (d.ws_floor < CALM).astype(float)
    d["logratio"] = np.log(np.maximum(d.ws_floor, FLOOR_MIN) / d.ws_top)
    d["turn"] = wrap180(d.wd_floor - d.wd_top)
    d["coupled"] = (np.abs(d.turn) <= FOLLOW).astype(float)
    return d


def censor(d: pd.DataFrame) -> tuple[pd.Series, dict]:
    """Rows fit for the coupled target. NEON's 2D sonics drop the direction when the floor's wind comes
    through the tower, so in the top sectors that would put a following floor there, the floor directions
    left over are mostly the ones that did NOT follow. Per site, over the years that have floor directions,
    a 30-deg top sector whose floor directions are present less than CENSOR_REL x the site's best (90th
    percentile of sectors) is left out."""
    base = d.elig & (d.ws_floor >= CALM) & d.wd_top.notna() & ~d.stem.isin(DIR_SUSPECT)
    ok = base & d.wd_floor.notna()
    keep = pd.Series(False, index=d.index)
    out = {}
    for stem, g in d[base].groupby("stem"):
        yr = g.t.dt.year
        pres_y = g.wd_floor.notna().groupby(yr).mean()
        g = g[yr.isin(pres_y[pres_y >= 0.2].index)]
        if g.empty:
            out[stem] = dict(kept=0, dropped_sectors=[])
            continue
        sec = ((g.wd_top + 15) // 30 % 12 * 30).astype(int)
        pres = g.wd_floor.notna().groupby(sec).mean()
        best = float(np.quantile(pres.values, 0.9))
        bad = sorted(int(s) for s in pres[pres < CENSOR_REL * best].index)
        k = g.index[~sec.isin(bad)]
        keep.loc[k] = True
        out[stem] = dict(presence_best=round(best, 2), dropped_sectors=bad,
                         kept=int((ok & keep).loc[g.index].sum()), with_direction=int(ok.loc[g.index].sum()))
    return ok & keep, out


# ---------------------------------------------------------------- baselines

def stab_name(c) -> str:
    return CLASSES[int(c)] if np.isfinite(c) else "neutral"


def smear_row(cls: np.ndarray, ws_top: np.ndarray, pooled: np.ndarray | None = None) -> np.ndarray:
    names = np.array([stab_name(c) for c in cls], dtype=object)
    if pooled is not None:
        names = np.where(pooled & (np.nan_to_num(cls, nan=1) >= 2), "stable (pooled)", names)
    return np.where(ws_top >= OVERRIDE, "top > 5 m/s", names)


def pooled_of(d: pd.DataFrame, cls_col: str) -> np.ndarray:
    return np.ones(len(d), bool) if cls_col == "cls_grad" else d.pooled.values


def base_smear(d: pd.DataFrame, cls_col: str) -> pd.DataFrame:
    row = smear_row(d[cls_col].values, d.ws_top.values, pooled_of(d, cls_col))
    calm = np.array([SMEAR[r]["calm"] for r in row])
    follow = np.array([SMEAR[r]["follow"] for r in row])
    ratio = np.array([SMEAR[r]["ratio"] for r in row])
    return pd.DataFrame(dict(p_coupled=follow / np.maximum(1 - calm, 1e-6), p_calm=calm, logratio=np.log(ratio)),
                        index=d.index)


def fit_ratio_table() -> list[dict]:
    p = TOWERS / "fit.json"
    return json.loads(p.read_text()) if p.exists() else []


def base_always(d: pd.DataFrame, held_group: str, cls_col: str, fitj: list[dict]) -> pd.DataFrame:
    """(i): the floor always follows the top, never calm; fit.json's floor/top ratio by its stability classes,
    the median over the fit.json sites other than the held-out one."""
    other = [r for r in fitj if ALIAS.get("AMF-" + r["site"], r["site"]) != held_group]
    allm = float(np.median([r["median"] for r in other]))
    by = {}
    for k in ("unstable", "neutral", "stable"):
        v = [r["by_stab"][k][0] for r in other if k in r["by_stab"]]
        by[k] = float(np.median(v)) if v else allm
    names = [stab_name(c) for c in d[cls_col].values]
    ratio = np.array([by["stable" if n in ("stable", "very stable") else n] for n in names])
    return pd.DataFrame(dict(p_coupled=0.99, p_calm=0.01, logratio=np.log(ratio)), index=d.index)


def lookup_table(tr: pd.DataFrame, cls_col: str, cmask: pd.Series) -> dict:
    """(iii): per class (with the 5 m/s row), rates averaged over the training sites, each site equal."""
    rows = smear_row(tr[cls_col].values, tr.ws_top.values, pooled_of(tr, cls_col))
    tr = tr.assign(row=rows)
    tab = {}
    for key in list(SMEAR):
        g = tr[tr.row == key]
        pc, pk, lr = [], [], []
        for _, s in g.groupby("group"):
            if len(s) >= 30:
                pk.append(s.calm.mean())
                lr.append(s.logratio.median())
            sc = s[cmask.reindex(s.index, fill_value=False)]
            if len(sc) >= 30:
                pc.append(sc.coupled.mean())
        tab[key] = dict(p_coupled=float(np.mean(pc)) if pc else np.nan, p_calm=float(np.mean(pk)) if pk else np.nan,
                        logratio=float(np.mean(lr)) if lr else np.nan)
    for k in ("p_coupled", "p_calm", "logratio"):  # a class no training site had: the mean of the others
        fill = np.nanmean([v[k] for v in tab.values()])
        for v in tab.values():
            if not np.isfinite(v[k]):
                v[k] = float(fill)
    return tab


def base_lookup(d: pd.DataFrame, cls_col: str, tab: dict) -> pd.DataFrame:
    row = smear_row(d[cls_col].values, d.ws_top.values, pooled_of(d, cls_col))
    return pd.DataFrame({k: [tab[r][k] for r in row] for k in ("p_coupled", "p_calm", "logratio")}, index=d.index)


# ---------------------------------------------------------------- the app's own canopy rule

# What the app does under trees today, emulated at each tower: the bar the learned floor must beat.
# - build_microclimate.in_stand(): the head-height (2 m) fraction of the local 10 m wind, which its
#   2026-10-07 fit read as the first level over the canopy (= the tower top here);
# - leaves down: the closure's hardwood share thinned to BARE, conifer kept, and the fraction blended
#   from the in-leaf to the bare one by leaves.ts LEAF_DAYS (falling 09-20 to bare 10-15, the default);
#   clipped to 0.04-0.95 both ways, as the bake does;
# - model.ts: gm = cf x (1 - 0.3 s) in a stand (1 - 0.45 s on open ground, treeH 0 when h < 3 m).
#   The other stability factor, dec = (1 - 0.3 s)(1 - 0.7 s lowness) on the local 10 m wind, corrects
#   the NWP's over-mixed stable 10 m wind and the pooling of low ground: the tower top is measured, not
#   forecast, so it is left out.
# - s, the app's 0-1 'stable' (boundaryLayer.ts layeringAt), from the stability class above the stand
#   (SMEAR's z/L classes from the tower's u* and H, else the bulk-Ri class): unstable and neutral 0,
#   stable (0.1 < z/L < 1) 0.5, very stable (z/L > 1) 1.0; no class 0. Rebuilding layeringAt's own
#   formula from the tower's lapse was tried and dropped: a 0.1 K lapse over the ~9 m between a NEON
#   tower's upper sensors, carried to layeringAt's 78 m, already saturates s, so rows the tower's z/L
#   calls neutral got s 0.29 on average and unstable ones 0.21.
# - direction: the app's floor follows the terrain-turned 10 m wind under stands; it adds drainage
#   (x0.7 in trees) on cooling nights, upslope (x0.5 in trees) on sunny slopes, and calls it calm under
#   0.8 km/h. Drainage needs the bake's katSpd, so here the app's floor simply follows the top (baseline i).
BARE = 0.35                      # build_microclimate.BARE
LEAF_FALL = ("09-20", "10-15")   # leaves.ts LEAF_DAYS fallStart, fallBare
APP_A = "a = 0.7 + 1.7 * np.clip(crown / 100, 0.2, 1) + 0.5 * np.clip(conifer / 100, 0, 1) + 0.3 * np.clip(hardwood_leaf / 100, 0, 1)"
# Crown closure (%) the app would read at the tower, ASSUMED where no site file gives one (LiDAR closure,
# HD grade, replaces it): open black spruce and the southern pine savannas 40-50, closed stands 80.
CLOSURE = {"US-Prr": 40, "US-Uaf": 40, "BONA": 50, "DEJU": 50, "JERC": 40, "OSBS": 40, "SMEAR-II": 70}
CLOSURE_DEFAULT = 80


def bake_curve_check() -> str:
    """The copied in_stand must match the bake's current one."""
    src = (HERE.parents[0] / "build_microclimate.py").read_text(encoding="utf-8")
    return "matches" if APP_A in src else "DIFFERS from build_microclimate.in_stand: update APP_A and in_stand_app"


def in_stand_app(h, crown, conifer, hardwood_leaf):
    """build_microclimate.in_stand as of 2026-10-12 (copied; bake_curve_check() compares)."""
    zc0 = np.maximum(0.1 * h, 0.3)
    d = 0.67 * h
    f_top = np.log(np.maximum(h - d, 0.5) / zc0) / np.log(10 / zc0)
    a = 0.7 + 1.7 * np.clip(crown / 100, 0.2, 1) + 0.5 * np.clip(conifer / 100, 0, 1) + 0.3 * np.clip(hardwood_leaf / 100, 0, 1)
    return f_top * np.exp(-a * (1 - 2 / np.maximum(h, 2.1)))


def leaf_off(d: pd.DataFrame) -> np.ndarray:
    """leaves.ts season() for Sep-Nov: 0 in leaf before fallStart, ramping to 1 at fallBare (local date)."""
    loc = d.t_mid + pd.to_timedelta(d.lon / 15, unit="h")
    doy = loc.dt.dayofyear.values
    yr = loc.dt.year.values
    f0 = pd.to_datetime([f"{y}-{LEAF_FALL[0]}" for y in yr]).dayofyear.values
    f1 = pd.to_datetime([f"{y}-{LEAF_FALL[1]}" for y in yr]).dayofyear.values
    return np.where(doy >= f0, np.clip((doy - f0) / (f1 - f0), 0, 1), 0.0)


APP_S = {0: 0.0, 1: 0.0, 2: 0.5, 3: 1.0}  # stability class above the stand -> the app's s


def app_stable(d: pd.DataFrame) -> np.ndarray:
    return d.cls_tower.map(APP_S).fillna(0.0).values


def app_rule(d: pd.DataFrame, closure: dict, height: dict) -> pd.DataFrame:
    """The app's floor/top ratio per row, the leaf-off share and s it used, and its calm call."""
    h = d.group.map(height).fillna(d.canopy_h).values.astype(float)
    crown = d.group.map(closure).fillna(CLOSURE_DEFAULT).values.astype(float)
    hw = d.decid.fillna(0.5).values * 100
    con = 100 - hw
    leaf = np.clip(in_stand_app(h, crown, con, hw), 0.04, 0.95)
    bare = np.clip(in_stand_app(h, crown * (1 - hw / 100 * (1 - BARE)), con, 0 * hw), 0.04, 0.95)
    off = leaf_off(d)
    s = app_stable(d)
    stand = h >= 3
    z0 = np.maximum(0.1 * h, 0.01)
    f_open = np.clip(np.log(2 / z0) / np.log(10 / z0), 0.04, 0.95)  # h < 3 m: the bake reads it as open ground
    cf = np.where(stand, leaf + (bare - leaf) * off, f_open)
    ratio = cf * np.where(stand, 1 - 0.3 * s, 1 - 0.45 * s)
    return pd.DataFrame(dict(ratio=ratio, s=s, off=off, cf=cf, calm=(ratio * d.ws_top.values < CALM).astype(float)),
                        index=d.index)


def scoreboard(d: pd.DataFrame, app: pd.DataFrame, others: dict[str, pd.Series]) -> dict:
    """Station-scoreboard style: measured floor/top against the app's, by site, by stability above and
    pooled. Bias = median of measured/app; within 2x over all rows (the floor held at FLOOR_MIN) and over
    rows with the floor moving (CALM+). others: held-out predicted log ratios to put beside the app's."""
    meas = np.exp(d.logratio)
    moving = d.ws_floor >= CALM

    def block(m: pd.Series) -> dict:
        if m.sum() < 30:
            return None
        x, a, mv = meas[m], app.ratio[m], moving[m]
        q = x / a
        r = dict(n=int(m.sum()), measured=float(x.median()), app=float(a.median()), bias=float(q.median()),
                 within2=float(((q >= 0.5) & (q <= 2)).mean()), within2_moving=float(((q[mv] >= 0.5) & (q[mv] <= 2)).mean()),
                 calm_measured=float(d.calm[m].mean()), calm_app=float(app.calm[m].mean()), s_mean=float(app.s[m].mean()))
        for k, lr in others.items():
            qo = x / np.exp(lr[m])
            r[f"within2_{k}"] = float(((qo >= 0.5) & (qo <= 2)).mean())
        return r
    out = {"pooled": block(pd.Series(True, index=d.index)), "by_site": {}, "by_stability": {}}
    for g in sorted(d.group.unique()):
        out["by_site"][g] = block(d.group == g)
    for c, name in enumerate(CLASSES):
        out["by_stability"][name] = block(d.cls_tower == c)
    out["by_stability"]["no class (no T pair, no flux)"] = block(d.cls_tower.isna())
    return out


# ---------------------------------------------------------------- site files: HD and SD canopy features

# raw/towers/sites/<file stem>.json, written by the NEON agent: "hd" from NEON's AOP 1 m CHM, "sd" from
# ETH Global Canopy Height 10 m and Hansen GFC treecover (after loss) 30 m, the same stats each way.
# Each grade gives the same few numbers, so HD and SD compare like for like, and each grade carries its
# own canopy height for the sensor heights relative to the stand: the SD net never sees a LiDAR number.
GRADE_FEATS = ["h", "h_med", "closure100", "closure250", "edge_m", "fetch_up", "in_opening", "ztop_rel", "zfloor_rel"]


def rose16(fetch: dict) -> list[float] | None:
    """{"0": m, "22.5": m, ...} -> 16 values from N clockwise."""
    try:
        v = sorted((float(k) % 360, float(x)) for k, x in fetch.items())
    except (TypeError, ValueError):
        return None
    return [x for _, x in v] if len(v) == 16 and abs(v[1][0] - 22.5) < 1e-6 else None


def grade_of(sec: dict, closure_sec: dict | None = None) -> dict:
    """One grade's numbers: height p90 and tree median within 100 m, closure within 100 and 250 m, edge
    distance, in an opening, the 16-direction fetch through trees."""
    r100 = (sec.get("by_radius") or {}).get("100", {})
    c = closure_sec if closure_sec is not None else sec
    c100 = (c.get("by_radius") or {}).get("100", {})
    c250 = (c.get("by_radius") or {}).get("250", {})
    num = lambda x: float(x) if isinstance(x, (int, float)) and not isinstance(x, bool) else np.nan
    return dict(h=num(r100.get("p90")), h_med=num(r100.get("tree_median")), closure100=num(c100.get("closure")),
                closure250=num(c250.get("closure")), edge_m=num(sec.get("edge_m")),
                in_opening=float(bool(sec.get("tower_in_opening"))) if "tower_in_opening" in sec else np.nan,
                rose=rose16(sec.get("fetch_m") or {}))


def site_files(stems_by_group: dict[str, list[str]]) -> dict:
    """{group: {"hd": grade, "sd": grade, "file": name}} for the groups with a site file (the file of a stem
    in use preferred, else any file of the group: AMF and NEON copies of a tower carry the same stats)."""
    out = {}
    if not SITES.exists():
        return out
    files = {f.stem: f for f in SITES.glob("*.json")}
    for g, stems in stems_by_group.items():
        cands = [st for st in stems if st in files] + [st for st in files if ALIAS.get(st, st[5:] if st.startswith("NEON-") else st) == g]
        if not cands:
            continue
        f = files[cands[0]]
        try:
            j = json.loads(f.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"site file {f.name} unreadable: {e}")
            continue
        hd, sd = j.get("hd") or {}, j.get("sd") or {}
        out[g] = dict(file=f.name, hd=grade_of(hd) if hd else None,
                      sd=grade_of(sd.get("eth_height") or {}, sd.get("hansen_after_loss") or sd.get("hansen_treecover2000"))
                      if sd else None)
    return out


def rose_at(rose: list[float], wd: np.ndarray) -> np.ndarray:
    """Linear interpolation of a 16-direction rose at bearings wd (deg)."""
    r = np.asarray(rose + rose[:1])
    w_ = np.asarray(wd, dtype=float)
    x = np.where(np.isfinite(w_), w_ % 360, 0) / 22.5
    i = np.floor(x).astype(int) % 16
    w = x - np.floor(x)
    v = r[i] * (1 - w) + r[i + 1] * w
    return np.where(np.isfinite(w_), v, np.nan)


def add_site_features(d: pd.DataFrame, sf: dict) -> dict:
    """hd_* and sd_* columns. The fetch is read at the row's top wind (the fetch upwind). A site with no
    file: HD all NaN; SD takes its known canopy height (the rows') as sd_h, the rest NaN; flagged."""
    flags = {}
    for grade in ("hd", "sd"):
        for k in GRADE_FEATS:
            d[f"{grade}_{k}"] = np.nan
    for g, idx in d.groupby("group").indices.items():
        rec = sf.get(g)
        for grade in ("hd", "sd"):
            gr = rec.get(grade) if rec else None
            if gr is None:
                if grade == "sd":
                    d.iloc[idx, d.columns.get_loc("sd_h")] = d.canopy_h.values[idx]
                    flags[g] = "no site file: HD NaN; SD height = the rows' canopy_h (BIF / fit.py SITE), other SD NaN"
                continue
            for k in ("h", "h_med", "closure100", "closure250", "edge_m", "in_opening"):
                d.iloc[idx, d.columns.get_loc(f"{grade}_{k}")] = gr[k]
            if gr["rose"]:
                d.iloc[idx, d.columns.get_loc(f"{grade}_fetch_up")] = rose_at(gr["rose"], d.wd_top.values[idx])
    for grade in ("hd", "sd"):
        d[f"{grade}_ztop_rel"] = d.z_top / d[f"{grade}_h"].where(d[f"{grade}_h"] > 0)
        d[f"{grade}_zfloor_rel"] = d.z_floor / d[f"{grade}_h"].where(d[f"{grade}_h"] > 0)
    return flags


# ---------------------------------------------------------------- learning

def site_weights(g: pd.Series) -> np.ndarray:
    n = g.map(g.value_counts())
    return (len(g) / g.nunique() / n).values


def cap(df: pd.DataFrame, rng) -> pd.DataFrame:
    parts = []
    for ix in df.groupby("group").indices.values():
        parts.append(rng.choice(ix, PER_SITE_CAP, replace=False) if len(ix) > PER_SITE_CAP else ix)
    return df.iloc[np.sort(np.concatenate(parts))]


def fit_models(tr: pd.DataFrame, cmask: pd.Series, feats: list[str], rng) -> dict:
    m = {}
    a = cap(tr, rng)
    m["calm"] = lgb.LGBMClassifier(**LGB).fit(a[feats], a.calm, sample_weight=site_weights(a.group))
    m["logratio"] = lgb.LGBMRegressor(objective="l1", **LGB).fit(a[feats], a.logratio, sample_weight=site_weights(a.group))
    c = cap(tr[cmask.reindex(tr.index, fill_value=False)], rng)
    m["coupled"] = lgb.LGBMClassifier(**LGB).fit(c[feats], c.coupled, sample_weight=site_weights(c.group))
    return m


def predict(m: dict, d: pd.DataFrame, feats: list[str]) -> pd.DataFrame:
    return pd.DataFrame(dict(p_coupled=m["coupled"].predict_proba(d[feats])[:, 1],
                             p_calm=m["calm"].predict_proba(d[feats])[:, 1],
                             logratio=m["logratio"].predict(d[feats])), index=d.index)


# ---------------------------------------------------------------- scoring

def logloss(y, p):
    p = np.clip(p, 0.01, 0.99)
    return float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)))


def score(d: pd.DataFrame, pred: pd.DataFrame, cmask: pd.Series) -> dict:
    out = {}
    c = cmask.reindex(d.index, fill_value=False).values
    if c.sum():
        y, p = d.coupled.values[c], pred.p_coupled.values[c]
        out.update(n_coupled=int(c.sum()), rate_coupled=float(y.mean()), ll_coupled=logloss(y, p),
                   brier_coupled=float(np.mean((p - y) ** 2)), hit_coupled=float(np.mean((p >= 0.5) == (y == 1))))
    if len(d):
        y, p = d.calm.values, pred.p_calm.values
        out.update(n=int(len(d)), rate_calm=float(y.mean()), ll_calm=logloss(y, p), brier_calm=float(np.mean((p - y) ** 2)),
                   mae_logratio=float(np.median(np.abs(pred.logratio.values - d.logratio.values))))
    return out


METHODS = ["model", "smear", "lookup", "always", "app"]
METRICS = ["ll_coupled", "brier_coupled", "hit_coupled", "ll_calm", "brier_calm", "mae_logratio"]


def low_priority() -> None:
    """Below-normal CPU priority on Windows: the PC is shared."""
    if sys.platform == "win32":
        import ctypes
        k = ctypes.windll.kernel32
        k.SetPriorityClass(k.GetCurrentProcess(), 0x00004000)


def main() -> None:
    low_priority()
    t0 = time.time()
    d, info = load()
    d = features(d)
    d = d[d.elig].copy()
    short = sorted(d.group[d.canopy_h < MIN_CANOPY].unique())
    if short:
        print(f"left out, canopy under {MIN_CANOPY} m (not a forest floor): {short}")
        d = d[d.canopy_h >= MIN_CANOPY].copy()
    high = sorted(d.group[d.z_floor > MAX_FLOOR].unique())
    if high:
        print(f"left out, floor sensor over {MAX_FLOOR} m: {high}")
        d = d[d.z_floor <= MAX_FLOOR].copy()
    res_excluded = dict(short_canopy=short, high_floor=high)
    if "--quick" in sys.argv:  # a smoke test of the whole path on six sites (writes the same outputs)
        global PER_SITE_CAP
        PER_SITE_CAP = 1500
        d = d[d.group.isin(["BART", "SMEAR-II", "US-Prr", "TREE", "GRSM", "OSBS"])].copy()
    cmask, cens = censor(d)
    fitj = fit_ratio_table()
    groups = sorted(d.group.unique())
    print(f"{len(d)} rows with the top at {TOP_MIN}+ m/s over {len(groups)} sites; coupled target {int(cmask.sum())} rows")
    MODELS.mkdir(parents=True, exist_ok=True)
    # HD / SD canopy features from the site files, when there are enough of them
    sf = site_files({g: sorted(d.stem[d.group == g].unique()) for g in groups})
    sf_flags = add_site_features(d, sf)
    variants = dict(FEATURES)
    air = [f for f in FEATURES["phone"] if f not in ("canopy_h", "ztop_rel", "zfloor_rel")]
    if sum(1 for r in sf.values() if r["hd"]) >= 3:
        variants["hd"] = air + [f"hd_{k}" for k in GRADE_FEATS]
        variants["sd"] = air + [f"sd_{k}" for k in GRADE_FEATS]
        print(f"site files for {len(sf)} of {len(groups)} sites: HD and SD variants on")
    else:
        print(f"site files for {len(sf)} sites: the HD/SD comparison waits on raw/towers/sites/*.json")
    # the app's own rule: the LiDAR stand (tree median height and closure within 100 m) where a site file has
    # one, else the rows' height and an assumed closure
    closure, height, lidar = dict(CLOSURE), {}, set()
    for g, rec in sf.items():
        hd = rec.get("hd")
        if hd and np.isfinite(hd["closure100"]) and np.isfinite(hd["h_med"]):
            closure[g], height[g] = hd["closure100"] * 100, hd["h_med"]
            lidar.add(g)
    app = app_rule(d, closure, height)
    res = {"settings": dict(TOP_MIN=TOP_MIN, CALM=CALM, FOLLOW=FOLLOW, FLOOR_MIN=FLOOR_MIN, OVERRIDE=OVERRIDE,
                            CENSOR_REL=CENSOR_REL, PER_SITE_CAP=PER_SITE_CAP, SLOPED_DEG=SLOPED_DEG, lgb=LGB,
                            features=variants),
           "files": info, "censoring": cens,
           "site_files": {g: dict(file=r["file"], hd={k: v for k, v in (r["hd"] or {}).items() if k != "rose"},
                                  sd={k: v for k, v in (r["sd"] or {}).items() if k != "rose"}) for g, r in sf.items()},
           "site_file_flags": sf_flags, "excluded": res_excluded, "variants": {},
           "app_inputs": {g: dict(h=float(height.get(g, d.canopy_h[d.group == g].iloc[0])),
                                  closure=float(closure.get(g, CLOSURE_DEFAULT)),
                                  closure_src="site file (LiDAR)" if g in lidar else "assumed",
                                  decid=float(d.decid[d.group == g].iloc[0]))
                          for g in groups},
           "bake_curve": bake_curve_check()}
    app_pred = pd.DataFrame(dict(p_coupled=0.99, p_calm=np.clip(app.calm, 0.01, 0.99), logratio=np.log(app.ratio)),
                            index=d.index)
    rng = np.random.default_rng(SEED)
    preds_all = {}
    for var, feats in variants.items():
        cls_col = "cls_tower" if var == "tower" else "cls_grad"
        per = {}
        allp = {k: [] for k in METHODS}
        for g in groups:
            te, tr = d[d.group == g], d[d.group != g]
            m = fit_models(tr, cmask, feats, rng)
            tab = lookup_table(tr, cls_col, cmask)
            p = {"model": predict(m, te, feats), "smear": base_smear(te, cls_col),
                 "lookup": base_lookup(te, cls_col, tab), "always": base_always(te, g, cls_col, fitj),
                 "app": app_pred.loc[te.index]}
            per[g] = {k: score(te, v, cmask) for k, v in p.items()}
            for k in METHODS:
                allp[k].append(p[k])
            print(f"  [{var}] held out {g:9s} n={len(te):6d} coupled n={per[g]['model'].get('n_coupled', 0):6d}  "
                  + "  ".join(f"{k} ll_c={per[g][k].get('ll_coupled', np.nan):.3f} ll_calm={per[g][k]['ll_calm']:.3f}"
                              f" mae={per[g][k]['mae_logratio']:.3f}" for k in ("model", "smear")) + f"  {time.time() - t0:.0f}s")
        allp = {k: pd.concat(v).loc[d.index] for k, v in allp.items()}
        preds_all[var] = allp
        pooled = {k: score(d, allp[k], cmask) for k in METHODS}
        site_mean = {k: {mt: float(np.nanmean([per[g][k].get(mt, np.nan) for g in groups])) for mt in METRICS}
                     for k in METHODS}
        # breakdowns, pooled over held-out predictions
        cls = d[cls_col]
        parts = {
            "night, neutral above": d.night & (cls == 1),
            "night, stable above (stable + very stable)": d.night & (cls >= 2),
            "night, very stable above (eddy covariance only)": d.night & (d.cls_zeta == 3),
            "day": d.sun > 6,
            "flat tower (< %g deg)" % SLOPED_DEG: d.slope < SLOPED_DEG,
            "sloped tower (>= %g deg)" % SLOPED_DEG: d.slope >= SLOPED_DEG,
            "canopy 8 m+ (where v2 applies SMEAR)": d.canopy_h >= 8,
            "head height: floor 1.4-3.1 m, top >= 1.2 h": d.z_floor.between(1.4, 3.1) & (d.z_top >= 1.2 * d.canopy_h),
            "trunk space: the other towers": ~(d.z_floor.between(1.4, 3.1) & (d.z_top >= 1.2 * d.canopy_h)),
        }
        brk = {}
        for name, msk in parts.items():
            sub = d[msk]
            brk[name] = {k: score(sub, allp[k].loc[sub.index], cmask) for k in METHODS}
            brk[name]["sites"] = sorted(sub.group.unique())
        # final models on every site, gain importances
        m = fit_models(d, cmask, feats, rng)
        imp = {}
        for tname, mod in m.items():
            gain = mod.booster_.feature_importance("gain")
            imp[tname] = {f: round(float(v) / gain.sum() * 100, 1) for f, v in sorted(zip(feats, gain), key=lambda x: -x[1])}
            mod.booster_.save_model(str(MODELS / f"{var}_{tname}.txt"))
        res["variants"][var] = dict(per_site=per, pooled=pooled, site_mean=site_mean, breakdown=brk, importance=imp,
                                    lookup_all=lookup_table(d, cls_col, cmask))
    # the app's rule against the measured floor, the bar the learned floor must beat
    others = {"model": preds_all["phone"]["model"].logratio, "smear": preds_all["phone"]["smear"].logratio}
    for v in ("hd", "sd"):
        if v in preds_all:
            others[f"model_{v}"] = preds_all[v]["model"].logratio
    res["app_rule"] = scoreboard(d, app, others)
    res["app_s_by_class"] = {CLASSES[int(c)]: dict(n=int(len(x)), s_mean=float(x.mean()), s_gt_0=float((x > 0).mean()))
                             for c, x in app.s.groupby(d.cls_zeta) if len(x)}
    # what the data say, pooled with sites equal: observed coupled / calm / ratio by site and class
    res["observed"] = observed(d, cmask)
    res["slope_stability"] = slope_stability(d, cmask, preds_all["phone"], app_pred)
    res["class_agreement"] = class_agreement(d)
    (TOWERS / "floor.json").write_text(json.dumps(res, indent=1, default=float))
    md = report(res, d, cmask, groups)
    (TOWERS / "floor.md").write_text(md, encoding="utf-8")
    print(md)
    print(f"done in {time.time() - t0:.0f}s")


def observed(d: pd.DataFrame, cmask: pd.Series) -> dict:
    out = {}
    for g, s in d.groupby("group"):
        r = {}
        for name, msk in (("day", s.sun > 6), ("night neutral", s.night & (s.cls_tower == 1)),
                          ("night stable", s.night & (s.cls_tower >= 2))):
            x = s[msk]
            xc = x[cmask.reindex(x.index, fill_value=False)]
            r[name] = dict(n=int(len(x)), coupled=float(xc.coupled.mean()) if len(xc) >= 30 else None, n_dir=int(len(xc)),
                           calm=float(x.calm.mean()) if len(x) >= 30 else None,
                           ratio=float(np.exp(x.logratio.median())) if len(x) >= 30 else None)
        out[g] = r
    return out


def valleys() -> dict:
    """NEON first look's valley flag (TPI500 <= -5 m and <= -1 SD within 1 km)."""
    f = NEON_RAW / "first_look.json"
    if not f.exists():
        return {}
    j = json.loads(f.read_text(encoding="utf-8"))
    return {x["site"]: bool(x.get("valley")) for x in j.get("sites", []) if "site" in x}


TERRAIN_CLASSES = ["flat (< 2 deg)", "gentle (2-5 deg)", "sloped (5+ deg)", "valley bottom"]


def slope_stability(d: pd.DataFrame, cmask: pd.Series, preds: dict, app_pred: pd.DataFrame) -> list[dict]:
    """The regime classifier's question: terrain (the tower's 150 m slope from 3DEP; NEON's valley flag)
    x the air above (day; night neutral; night stable incl. very stable). Observed rates are site means;
    'drains' = among moving floors at night, the share coming from uphill (within 45 deg of the upslope
    bearing; chance 25%). Held-out scores pooled over the rows, phone variant."""
    v = valleys()
    val = d.group.map(lambda g: v.get(g, False)).astype(bool)
    terr = np.select([val, d.slope >= 5, d.slope >= 2], ["valley bottom", "sloped (5+ deg)", "gentle (2-5 deg)"],
                     "flat (< 2 deg)")
    air = np.select([d.sun > 6, d.night & (d.cls_tower == 1), d.night & (d.cls_tower >= 2)],
                    ["day", "night, neutral above", "night, stable above"], "other")
    up_from = (d.downslope + 180) % 360
    drains = pd.Series(np.abs(wrap180(d.wd_floor - up_from)) <= 45, index=d.index, dtype=float).where(
        d.wd_floor.notna() & (d.ws_floor >= CALM) & d.downslope.notna())
    out = []
    for t in TERRAIN_CLASSES:
        for a in ("day", "night, neutral above", "night, stable above"):
            m = (terr == t) & (air == a)
            x = d[m]
            if len(x) < 30:
                continue
            per = []
            for g, s in x.groupby("group"):
                sc = s[cmask.reindex(s.index, fill_value=False)]
                dr = drains[s.index].dropna()
                per.append(dict(coupled=sc.coupled.mean() if len(sc) >= 30 else np.nan, calm=s.calm.mean(),
                                ratio=float(np.exp(s.logratio.median())), drains=dr.mean() if len(dr) >= 30 else np.nan))
            per = pd.DataFrame(per)
            r = dict(terrain=t, air=a, sites=sorted(x.group.unique()), rows=int(len(x)),
                     coupled=float(per.coupled.mean()), calm=float(per.calm.mean()), ratio=float(per.ratio.median()),
                     drains=float(per.drains.mean()))
            for k, pr in (("model", preds["model"]), ("smear", preds["smear"]), ("app", app_pred)):
                sc = score(x, pr.loc[x.index], cmask)
                r[f"ll_coupled_{k}"] = sc.get("ll_coupled", np.nan)
                r[f"ll_calm_{k}"] = sc.get("ll_calm", np.nan)
                r[f"mae_{k}"] = sc.get("mae_logratio", np.nan)
            out.append(r)
    return out


def class_agreement(d: pd.DataFrame) -> dict:
    """How often the gradient class (what the phone's kind of input gives) matches the eddy-covariance
    z/L class (the tower's own), stable and very stable pooled; and the raw bulk-Ri class for contrast."""
    x = d[d.cls_zeta.notna() & d.cls_grad.notna()]
    ec = np.minimum(x.cls_zeta, 2)
    nm = {0: "unstable", 1: "neutral", 2: "stable (pooled)"}
    tab = pd.crosstab(ec.map(nm), x.cls_grad.map(nm))
    y = d[d.cls_zeta.notna() & d.cls_ri.notna()]
    return dict(n=int(len(x)), agree=float((ec == x.cls_grad).mean()), table=tab.to_dict(),
                agree_raw_ri=float((np.minimum(y.cls_zeta, 2) == np.minimum(y.cls_ri, 2)).mean()),
                stable_hit=float(((x.cls_grad == 2) & (ec == 2)).sum() / max((ec == 2).sum(), 1)),
                false_stable=float(((x.cls_grad == 2) & (ec < 2)).sum() / max((ec < 2).sum(), 1)))


# ---------------------------------------------------------------- report

def fmt(v, p=3):
    return "" if v is None or (isinstance(v, float) and not np.isfinite(v)) else f"{v:.{p}f}"


def slope_section(res: dict) -> list[str]:
    L = ["## Slope x stability: what the regime classifier asks", "",
         "Terrain from the tower's 150 m slope (USGS 3DEP 30 m) and NEON's valley flag; the air above from z/L "
         "(eddy covariance where the tower has it, else the zeroed temperature pair, stable and very stable "
         "together). Observed: site means of the floor following the top (within 45 deg, moving floors), calm "
         "(under 0.3 m/s), the median floor/top, and at night the floor coming from uphill ('drains', chance 25%). "
         "Then held-out log-loss for coupled and calm, phone model / SMEAR v2 / the app's rule.", "",
         "| terrain | air above | sites | rows | follows | calm | floor/top | drains | ll coupled model / SMEAR / app | ll calm model / SMEAR / app | mae ratio model / SMEAR / app |",
         "|---|---|---|---|---|---|---|---|---|---|---|"]
    for r in res["slope_stability"]:
        f3 = lambda k: " / ".join(fmt(r[f"{k}_{m}"], 2) or "-" for m in ("model", "smear", "app"))
        L.append(f"| {r['terrain']} | {r['air']} | {len(r['sites'])} | {r['rows']} | {fmt(r['coupled'], 2)} | "
                 f"{fmt(r['calm'], 2)} | {fmt(r['ratio'], 2)} | {fmt(r['drains'], 2) if r['air'] != 'day' else '-'} | "
                 f"{f3('ll_coupled')} | {f3('ll_calm')} | {f3('mae')} |")
    L.append("")
    sites = {}
    for r in res["slope_stability"]:
        sites.setdefault(r["terrain"], set()).update(r["sites"])
    L.append("Towers by terrain: " + "; ".join(f"{t}: {', '.join(sorted(v))}" for t, v in sites.items()) + ".")
    L.append("")
    return L


def app_section(res: dict) -> list[str]:
    """The first table: the app's own canopy rule at every tower."""
    sb = res["app_rule"]
    extra = [k[len("within2_"):] for k in (sb["pooled"] or {}) if k.startswith("within2_") and k != "within2_moving"]
    L = ["## The bar: the app's own canopy rule at every tower", "",
         f"build_microclimate.in_stand (the curve in the bake now: {res['bake_curve']}), blended to its leaves-down "
         "form by leaves.ts's default fall (09-20 to 10-15), x (1 - 0.3 s) in a stand (model.ts), against the "
         "measured floor/top. s is the app's 0-1 'stable' from the class above the stand (unstable and neutral 0, "
         "stable 0.5, very stable 1; z/L from eddy covariance where the tower has u* and H, else from the zeroed "
         "temperature pair, where stable means stable or very stable); the app's floor follows the top. "
         "bias = median of measured/app (above 1: the app calls the floor too slow); within 2x over all rows "
         "(floor held at 0.05 m/s) and over rows with the floor moving (0.3+ m/s); calm = floor under 0.3 m/s, "
         "the app's call being its floor speed under 0.3. Beside it, the share within 2x of the held-out "
         "predictions: " + ", ".join(f"`{k}`" for k in extra) + " (phone variant unless named).", "",
         "| | rows | measured floor/top | app's | bias | app within 2x | app within 2x, moving | "
         + " | ".join(f"{k} within 2x" for k in extra) + " | calm measured / app | mean s |",
         "|---|---|---|---|---|---|---|" + "---|" * len(extra) + "---|---|"]

    def row(label, r):
        if not r:
            return f"| {label} | <30 rows |"
        return (f"| {label} | {r['n']} | {r['measured']:.3f} | {r['app']:.3f} | {r['bias']:.2f}x | {r['within2']:.0%} | "
                f"{r['within2_moving']:.0%} | " + " | ".join(f"{r['within2_' + k]:.0%}" for k in extra)
                + f" | {r['calm_measured']:.0%} / {r['calm_app']:.0%} | {r['s_mean']:.2f} |")
    L.append(row("**all, pooled**", sb["pooled"]))
    for k, r in sb["by_stability"].items():
        L.append(row(f"above the stand: {k}", r))
    for g, r in sb["by_site"].items():
        a = res["app_inputs"][g]
        L.append(row(f"{g} (h {a['h']:.1f}, closure {a['closure']:.0f}% {a['closure_src']}, decid {a['decid']:.2f})", r))
    L += ["", "The app's s against the tower's own z/L class: "
          + "; ".join(f"{k} mean s {v['s_mean']:.2f} (s > 0 in {v['s_gt_0']:.0%}, {v['n']} rows)"
                      for k, v in res["app_s_by_class"].items()) + ".", ""]
    return L


def report(res: dict, d: pd.DataFrame, cmask: pd.Series, groups: list[str]) -> str:
    L = ["# Floor model: held-out sites", "",
         f"Written by `pipeline/towers/floor.py`. Rows: half-hours (hours at US-MMS and HF-EMS), Sep-Nov, top at "
         f"{TOP_MIN}+ m/s. Coupled = floor within {FOLLOW:.0f} deg of the top, over rows with the floor at {CALM}+ m/s "
         f"and a floor direction that is not censored; calm = floor under {CALM} m/s; ratio = floor/top speed "
         f"(floor held at {FLOOR_MIN}+). Leave-one-site-out: every number below is for a site the model never saw. "
         "ll = log-loss (p clipped to 0.01-0.99), brier = Brier score, hit = share of right calls at p >= 0.5, "
         "mae = median absolute error of log(floor/top) (0.30 is a factor of 1.35). The headline is the fit on every "
         "forest tower (floors 1.5-11 m, z_floor/h and z_top/h as features), scored on every held-out tower; the "
         "head-height subset (floor 1.4-3.1 m, top at 1.2 h or more) is scored from the same fit in the breakdowns.", ""]
    L += app_section(res)
    L += slope_section(res)
    L += ["## Sites", "",
         "| site | files | rows (top 1+ m/s) | coupled rows | canopy m (rows) | HD h p90 / closure | SD h p90 / closure | floor m | top m | T pair m | slope 150 m / 1 km deg | relief 1 km m | decid |",
         "|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
    for g in groups:
        s = d[d.group == g]
        stems = sorted(s.stem.unique())
        fi = [res["files"][st] for st in stems]
        ter = fi[0]["terrain"]
        sfr = res["site_files"].get(g, {})
        gr = lambda k: (f"{sfr[k]['h']:.1f} / {sfr[k]['closure100']:.2f}" if sfr.get(k) and np.isfinite(sfr[k].get("h", np.nan)) else "-")
        L.append(f"| {g} | {', '.join(stems)} | {len(s)} | {int(cmask[s.index].sum())} | {s.canopy_h.iloc[0]:g} | {gr('hd')} | {gr('sd')} | "
                 f"{'/'.join(sorted({f'{z:g}' for f_ in fi for z in f_['z_floor']}))} | {s.z_top.median():g} | "
                 f"{fi[0]['z_ta'][0]:g}/{fi[0]['z_ta'][1]:g} | {ter['slope']:.1f} / {ter['slope_1km']:.1f} | "
                 f"{fmt(ter.get('relief_1km'), 0)} | {fmt(s.decid.iloc[0], 2)} |")
    ex = res.get("excluded", {})
    L += ["", f"Left out: canopy under {MIN_CANOPY} m (not a forest floor): {', '.join(ex.get('short_canopy', [])) or 'none'}; "
          f"floor sensor over {MAX_FLOOR} m: {', '.join(ex.get('high_floor', [])) or 'none'}. Where an AmeriFlux mirror and "
          "NEON's own file of a tower are both here, NEON's is used (per-period sensor heights, the triple-aspirated top "
          "temperature) with u* and H filled in from the AmeriFlux copy by half-hour, and one site in the "
          "leave-one-site-out split; NEON's direction flags (tower wake) are applied. Harvard's EMS tower (HF-EMS, 140 m "
          "from NEON HARV) is part of the HARV site; its 2 m sonic's direction is unverified, so it gives calm and ratio "
          "only. No site file (HD NaN, SD height from the rows): "
          + (", ".join(sorted(res.get("site_file_flags", {}))) or "none") + "."]
    L += ["", "Variants: `tower` = every feature incl. z/L from the tower's u* and H; `phone` = what the app can know "
          "without canopy data beyond a stand height (stability from the temperature pair above the stand, zeroed per "
          "site-year on its windiest half-hours and x1.5 as neon_look.py reads it, stable and very stable together; "
          "top wind, sun, month, stand height and "
          "deciduous share, sensor heights relative to the stand, slope and the top wind against the downslope); "
          "`hd` = phone's air and ground with the stand from NEON's 1 m LiDAR (height, closure, edge, upwind fetch "
          "through trees, in an opening); `sd` = the same stand numbers from ETH 10 m canopy height and Hansen 30 m "
          "treecover after loss."]
    for var, v in res["variants"].items():
        L += ["", f"## Variant `{var}`: model against the baselines", "",
              "(ii) SMEAR = INVERSE v2's table; (iii) lookup = the same classes re-pooled on the training sites; "
              "(i) always = always coupled, never calm, fit.json's ratio by stability; app = the app's canopy rule "
              "(the first table): always coupled, calm when its floor speed is under 0.3 m/s.", "",
              "| site | method | coupled n | coupled rate | ll coupled | brier coupled | hit coupled | calm rate | ll calm | brier calm | mae log ratio |",
              "|---|---|---|---|---|---|---|---|---|---|---|"]
        for g in groups:
            for k in METHODS:
                r = v["per_site"][g][k]
                L.append(f"| {g if k == 'model' else ''} | {k} | {r.get('n_coupled', 0)} | {fmt(r.get('rate_coupled'), 2)} | "
                         f"{fmt(r.get('ll_coupled'))} | {fmt(r.get('brier_coupled'))} | {fmt(r.get('hit_coupled'), 2)} | "
                         f"{fmt(r.get('rate_calm'), 2)} | {fmt(r.get('ll_calm'))} | {fmt(r.get('brier_calm'))} | {fmt(r.get('mae_logratio'))} |")
        for lab, src in (("all, mean of sites", v["site_mean"]), ("all, pooled rows", v["pooled"])):
            for k in METHODS:
                r = src[k]
                L.append(f"| **{lab if k == 'model' else ''}** | {k} | {r.get('n_coupled', '')} | {fmt(r.get('rate_coupled'), 2)} | "
                         f"{fmt(r.get('ll_coupled'))} | {fmt(r.get('brier_coupled'))} | {fmt(r.get('hit_coupled'), 2)} | "
                         f"{fmt(r.get('rate_calm'), 2)} | {fmt(r.get('ll_calm'))} | {fmt(r.get('brier_calm'))} | {fmt(r.get('mae_logratio'))} |")
        L += ["", f"### `{var}`: by the air and by the ground (pooled held-out rows)", "",
              "| subset | sites | method | coupled n | coupled rate | ll coupled | hit coupled | calm rate | ll calm | mae log ratio |",
              "|---|---|---|---|---|---|---|---|---|---|"]
        for name, b in v["breakdown"].items():
            for k in METHODS:
                r = b[k]
                L.append(f"| {name if k == 'model' else ''} | {len(b['sites']) if k == 'model' else ''} | {k} | {r.get('n_coupled', 0)} | "
                         f"{fmt(r.get('rate_coupled'), 2)} | {fmt(r.get('ll_coupled'))} | {fmt(r.get('hit_coupled'), 2)} | "
                         f"{fmt(r.get('rate_calm'), 2)} | {fmt(r.get('ll_calm'))} | {fmt(r.get('mae_logratio'))} |")
        L += ["", f"### `{var}`: gain importance (all-site model, %)", ""]
        for t, imp in v["importance"].items():
            L.append(f"- **{t}**: " + ", ".join(f"{f} {x:g}" for f, x in list(imp.items())[:8]))
        L += ["", f"### `{var}`: lookup table on all sites (classes as the variant reads them)", "",
              "| row | P(coupled) | P(calm) | floor/top |", "|---|---|---|---|"]
        for k, r in v["lookup_all"].items():
            L.append(f"| {k} | {r['p_coupled']:.2f} | {r['p_calm']:.2f} | {math.exp(r['logratio']):.3f} |")
    L += ["", "## Observed, by site (class from z/L where the tower has u* and H, else the bulk Ri)", "",
          "| site | day: coupled / calm / ratio | night neutral | night stable (+ very stable) |", "|---|---|---|---|"]
    for g, r in res["observed"].items():
        cell = lambda x: f"{fmt(x['coupled'], 2) or '-'} / {fmt(x['calm'], 2) or '-'} / {fmt(x['ratio'], 2) or '-'} ({x['n']})"
        L.append(f"| {g} | {cell(r['day'])} | {cell(r['night neutral'])} | {cell(r['night stable'])} |")
    ca = res["class_agreement"]
    L += ["", f"Gradient class (the temperature pair, zeroed, x1.5) against the eddy-covariance z/L class, stable and "
          f"very stable pooled, on {ca['n']} rows with both: agree {ca['agree']:.0%}, stable caught {ca['stable_hit']:.0%}, "
          f"false stable {ca['false_stable']:.0%} (the raw bulk Ri without zeroing: agree {ca['agree_raw_ri']:.0%}).", "",
          "## Censored floor directions", "",
          "| file | top sectors dropped (30 deg bins, from) | rows kept / with a direction |", "|---|---|---|"]
    for st, c in res["censoring"].items():
        L.append(f"| {st} | {', '.join(map(str, c['dropped_sectors'])) or '-'} | {c['kept']} / {c.get('with_direction', 0)} |")
    return "\n".join(L) + "\n"


if __name__ == "__main__":
    main()
