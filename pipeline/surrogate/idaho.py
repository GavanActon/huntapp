"""Judge the teacher against the wind itself: WindNinja's momentum solve (the
seed kits seed-bsb-id and seed-salmon-id, dataset.py) beside today's SD
(the mass-consistent neutral layer) and the uniform ambient, at the sensors
of WindNinja's own field campaigns, Big Southern Butte (2010) and Salmon
River Canyon (2011), Idaho.

The measurements: Zenodo record 8226638 (Wagenbrenner, CC-BY 4.0), the
SQLite databases bsb.sqlite and src.sqlite in pipeline/raw/idaho (README
there): 30 s means of speed (mph), peak gust and direction from Onset
cup-and-vane sensors at 3 m, positions per plot. Butler et al. 2015
(ACP 15, 3785) name the sensor each campaign treats as representative of
the gradient wind: R2 on the plain ~8 km WSW of the butte, NM1 three
quarters of the way up the canyon's north wall. Those are the references.

The measured counterpart of a field (step 3):
  1. Every 30 s row with quality OK, a speed in 0-100 mph (-888.88 is
     missing, 105 a stuck value) and, for the direction, 0-360 and a vane
     not flagged BADVANE. 10 min blocks (the clock's, :00-:09 ...): scalar
     mean speed, and the speed-weighted vector mean direction.
  2. Reference blocks that count: 15+ of the 20 samples, mean speed at or
     over --min-ref (default the campaign's synoptic threshold from Butler
     et al., 6 m/s at BSB, 5 at SRC: above it the diurnal slope and valley
     winds are overrun and the air is mixed, the nearest the data come to
     the neutral air the runs assume; no stability measurement is in the
     record), and steady: the 30 s directions' resultant over the scalar
     mean speed at least --steady (0.9). Optionally --hours (local time).
  3. Each reference block falls in one of 16 bins of 22.5 degrees by its
     direction (bin k centred on k * 22.5, the runs' own 16 directions).
     For every other sensor with 15+ samples in the same block: the speed
     ratio sensor / reference, and, where the sensor's mean is 0.5 m/s or
     more (the vane needs air) and its direction samples 15+, the turn,
     sensor direction - reference direction wrapped to +-180, positive
     clockwise (veering).
  4. A sensor-bin counts with --min-n (10) blocks from --min-days (2)
     different days: its mean ratio, and the circular mean of its turns.

The models at the sensors (step 4), bin centre as the ambient direction:
  WindNinja       bilinear in the kit's u, v (cell centres, grid axes) at
                  the sensor's UTM position and at the reference's; ratio
                  |V sensor| / |V reference|, turn = bearing at the sensor -
                  bearing at the reference. The grid-to-true convergence is
                  the same at both, so it cancels from the turn.
  mass neutral    the same from baseline_field(..., "neutral", d, conv).
  uniform         ratio 1, turn 0.
  and, as checks: WindNinja with u, v averaged over 3 x 3 cells (90 m), for
  how much a sensor's exact place on a 30 m grid matters; and both fields
  against their own flat ground (the median speed over valid cells under 2
  degrees of slope, and the ambient's direction) in place of the reference:
  R2 sits 10 cells from the BSB kit's west edge, inside the 20-cell band
  the dataset calls not valid. Neither changes the answer.

The vanes. At BSB every open-plain vane reads a turn from R2 that is the
same in every wind direction, by day and by night, in strong wind and in
the light nocturnal drainage: R1 +13, R3 +25, R4 +60, R5 +35, R33 +85, the
summit's TSW7 +95 (2010-06/09, median over R2's steady blocks). Air 6-8 km
out on a flat plain is not turned by tens of degrees whatever the wind, so
these are vanes set off north (R2's among them), by up to a right angle.
Three things follow:
  --ref-offset auto  turns the reference's direction onto the consensus of
                     the five open-plain vanes 6 km and more from the summit
                     (R1, R2, R3, R4, R5; Campaign.ring), +29 to +32 degrees.
                     It moves the bins, and so which WindNinja run each block
                     is scored against; the speed ratios agree best with
                     WindNinja near this shift (a scan from -60 to +60: r
                     0.23 at 0, 0.39 at +30, 0.49 at +50), which a vane
                     consensus found without the model corroborates.
  anom r / anom MAE  the turn about each sensor's own mean over its bins,
                     measured and modelled alike: a fixed vane error drops
                     out, and so does any turn the same in every wind; what
                     is left is how the turn changes with direction.
  the raw turn       columns are kept, but at BSB they measure the vanes.
Speeds have no such problem.

net r / net MAE: each sensor's ratio over the mean ratio of all sensors in
the bin, measured and modelled alike, so a reference the model shelters
more than the real one does (NM1 on the canyon wall) does not scale a whole
bin. The per-bin table scores each bin on its own: one ambient, one
reference, the cleanest test of the pattern.

Classes, so exposed ground and the lee are scored apart:
  BSB  upper (DEM 2000 m and up: the summit plateau and ridges, exposed
       from every side), windward flank and lee flank (between the plain
       and 2000 m, by whether the sensor sits on the side of the summit the
       wind comes from), plain (under 1650 m and 2.5 km or more from the
       summit). Exposed = upper + windward flank.
  SRC  by height: ridge (1400 m and up), mid-slope (800-1400), canyon
       floor (under 800; the river is at ~550).

    py -3.14 pipeline/surrogate/idaho.py bsb                                  # R2 as it reads
    py -3.14 pipeline/surrogate/idaho.py bsb --ref-offset auto --tag ringdir  # R2 on the ring's north
    py -3.14 pipeline/surrogate/idaho.py src
    py -3.14 pipeline/surrogate/idaho.py bsb --ref-offset auto --min-ref 3 --tag ringdir-3ms
    py -3.14 pipeline/surrogate/idaho.py src --min-ref 3 --tag 3ms
    py -3.14 pipeline/surrogate/idaho.py src --min-ref 3 --hours 11-19 --tag 3ms-day

The contrast damping scan: WindNinja's field taken toward the sector's
ambient, amb + k (field - amb) in u and v (grid axes, fields.damp_contrast),
k = 0.3 ... 1.1, each scored as above (ratio r, MAE, bias, the slope of
measured - 1 on modelled - 1, the exposed / lee or ridge / floor classes,
the turn about each sensor's own mean); then the k with the least ratio MAE
and the k that brings the slope to 1. --pred scores a net's prediction
(predict.py) in WindNinja's place, for the scoreboard or the scan:

    py -3.14 pipeline/surrogate/idaho.py bsb --ref-offset auto --tag ringdir --damp-scan
    py -3.14 pipeline/surrogate/idaho.py src --damp-scan
    py -3.14 pipeline/surrogate/idaho.py bsb --ref-offset auto --tag ringdir --damp-scan --damp-mode speed --ks 0.5,0.6,0.7,0.8,1.0

--damp-mode speed damps the speed only, the modelled ratio to the reference
taken to 1 + k (ratio - 1) with the turns as they are (build_windsd --damp);
ratio r is then the same at every k, by construction.
    py -3.14 pipeline/surrogate/idaho.py bsb --ref-offset auto --tag ringdir-seed2-all --damp-scan --pred pred-seed2-all-seed-bsb-id.npz

The first run of a campaign reads its database once into
pipeline/raw/idaho/blocks10-<campaign>.csv.gz (the 10 min blocks of every
sensor, about a minute for BSB's 11.6 M rows); later runs read that.

Output, pipeline/raw/surrogate/runs/idaho/:
  <campaign>[-tag]-scoreboard.json   the filters, the sensors, the bins, the
                                     scores by model and class
  <campaign>[-tag]-scoreboard.md     the same as tables
  <campaign>[-tag]-points.csv        one row per sensor and bin: measured
                                     and modelled ratio and turn
  <campaign>[-tag]-scatter.png       measured against modelled, WindNinja
                                     and mass neutral: ratio, turn, and the
                                     turn about each sensor's own mean
  <campaign>[-tag]-damp[-speed].json, .md   the damping scan (--damp-scan)
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sqlite3
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.ndimage import map_coordinates, uniform_filter

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from fields import (DATA, baseline_field, bearing, damp_contrast, direction_index, load_area,  # noqa: E402
                    load_baseline, pearson, slope_deg, wrap180)

RAW = HERE.parent / "raw" / "idaho"
OUT = DATA / "runs" / "idaho"
MPH = 0.44704
NBINS = 16
BIN = 360.0 / NBINS


@dataclass(frozen=True)
class Campaign:
    key: str
    name: str
    area: str
    db: str
    ref: str
    strong_ms: float
    period: str
    ring: tuple[str, ...] = ()


CAMPAIGNS = {
    # the ring: the open-plain sensors 6 km and more from the summit (R2 one of them)
    "bsb": Campaign("bsb", "Big Southern Butte", "seed-bsb-id", "bsb.sqlite", "R2", 6.0,
                    "2010-06-13 to 2010-09-10", ("R1", "R3", "R4", "R5")),
    "src": Campaign("src", "Salmon River Canyon", "seed-salmon-id", "src.sqlite", "NM1", 5.0,
                    "2011-07-13 to 2011-09-14"),
}


# ---- the measurements ---------------------------------------------------------


def sensors(c: Campaign) -> pd.DataFrame:
    """The campaign's own sensors: id, lat, lon, and the id their rows carry.
    BSB's table also lists INL mesonet stations (no datalogger, no rows in
    the database); they are left out. Four BSB sensors were moved in
    mid-July 2010 and are listed only at the second place (R23_2, R27_2,
    TSW6_2, TWSW6_2, as in Butler et al.'s supplement) while their rows
    carry the old id; their rows before the month-long gap are dropped."""
    con = sqlite3.connect(RAW / c.db)
    rows = []
    if c.key == "bsb":
        for pid, logger, lon, lat in con.execute(
                "SELECT Plot_id, Datalogger_id, Longitude, Latitude FROM PLOT_LOCATION"):
            if logger:
                rows.append((pid, lat, lon))
    else:
        for pid, geom in con.execute("SELECT plot_id, geometry FROM plot_location"):
            if pid and geom:
                lat, lon = map(float, re.findall(r"-?\d+\.\d+", geom))  # POINT(lat,lon)
                rows.append((pid, lat, lon))
    con.close()
    df = pd.DataFrame(rows, columns=["id", "lat", "lon"])
    df["obs_id"] = df["id"].str.replace(r"_2$", "", regex=True)
    df["moved"] = df["id"] != df["obs_id"]
    return df.sort_values("id").reset_index(drop=True)


BLOCK_SQL = """
SELECT plot_id AS obs_id, substr(date_time, 1, 15) AS blk,
       count(*) AS n,
       avg(wind_speed) AS s,
       sum(CASE WHEN dok THEN 1 ELSE 0 END) AS nd,
       sum(CASE WHEN dok THEN wind_speed * sin(radians(wind_dir)) ELSE 0 END) AS sx,
       sum(CASE WHEN dok THEN wind_speed * cos(radians(wind_dir)) ELSE 0 END) AS sy,
       sum(CASE WHEN dok THEN wind_speed ELSE 0 END) AS sw
FROM (SELECT plot_id, date_time, wind_speed, wind_dir,
             (wind_dir >= 0 AND wind_dir <= 360 AND coalesce(sensor_qual, '') <> 'BADVANE') AS dok
      FROM mean_flow_obs
      WHERE quality = 'OK' AND wind_speed >= 0 AND wind_speed < 100)
GROUP BY plot_id, blk
"""


def blocks(c: Campaign, rebuild: bool = False) -> pd.DataFrame:
    """Every sensor's 10 min blocks, cached. Speeds in m/s; dir the vector
    mean direction (FROM, degrees true), steady its resultant over the
    scalar mean (1 a dead-steady wind), both NaN without direction samples."""
    cache = RAW / f"blocks10-{c.key}.csv.gz"
    if cache.exists() and not rebuild:
        df = pd.read_csv(cache)
    else:
        print(f"  reading {c.db} into 10 min blocks (once)...", flush=True)
        con = sqlite3.connect(RAW / c.db)
        df = pd.read_sql(BLOCK_SQL, con)
        con.close()
        tmp = cache.with_suffix(".tmp")
        df.to_csv(tmp, index=False, compression="gzip")
        tmp.replace(cache)
    df["t"] = pd.to_datetime(df["blk"] + "0:00")
    df["s"] = df["s"] * MPH
    with np.errstate(invalid="ignore", divide="ignore"):
        df["dir"] = np.where(df["sw"] > 0, np.degrees(np.arctan2(df["sx"], df["sy"])) % 360.0, np.nan)
        df["steady"] = np.where(df["sw"] > 0, np.hypot(df["sx"], df["sy"]) / df["sw"], np.nan)
    return df[["obs_id", "t", "n", "nd", "s", "dir", "steady"]]


def after_move(df: pd.DataFrame, obs_id: str) -> pd.Timestamp | None:
    """The first block after the longest gap (over a day) in a moved sensor's rows."""
    t = df.loc[df["obs_id"] == obs_id, "t"].sort_values()
    if len(t) < 2:
        return None
    g = t.diff()
    i = g.idxmax()
    return t.loc[i] if g.loc[i] > pd.Timedelta("1D") else None


def ring_offset(c: Campaign, sens: pd.DataFrame, blk: pd.DataFrame, args) -> tuple[float, dict]:
    """The turn that puts the reference's vane on the ring's consensus: the
    circular mean, over the ring's vanes and the reference's own (0), of each
    vane's median turn from the reference in the reference's blocks. A vane
    set some degrees off north shows as a turn that is the same in every wind
    and every hour; on open plain 6-8 km from the butte nothing else turns
    the wind by tens of degrees, so the mean of five vanes is a better north
    than any one of them."""
    import types
    a = types.SimpleNamespace(**{**vars(args), "ref_offset": 0.0})
    pts, _, _ = measured(c, sens, blk, a)
    per = {}
    for sid in c.ring:
        g = pts[(pts["id"] == sid) & pts["turn"].notna()]
        if len(g):
            per[sid] = float(np.median(g["turn"]))
    m, _ = circ_mean(np.array([0.0] + list(per.values())))
    return m, per


def bin_of(direction: np.ndarray) -> np.ndarray:
    return (((np.asarray(direction) + BIN / 2) % 360.0) // BIN).astype(int)


def circ_mean(deg: np.ndarray) -> tuple[float, float]:
    """Circular mean (wrapped to +-180) and resultant length of angles in degrees."""
    r = np.radians(deg)
    x, y = np.cos(r).mean(), np.sin(r).mean()
    return float(np.degrees(np.arctan2(y, x))), float(math.hypot(x, y))


def measured(c: Campaign, sens: pd.DataFrame, blk: pd.DataFrame, args) -> tuple[pd.DataFrame, pd.DataFrame, dict]:
    """Per sensor and bin: blocks, days, the mean speed ratio and the
    circular-mean turn. Also the reference blocks per bin."""
    # moved sensors: only the rows at the place we know
    moved = {}
    for _, row in sens[sens["moved"]].iterrows():
        t0 = after_move(blk, row["obs_id"])
        moved[row["id"]] = None if t0 is None else str(t0)
        if t0 is not None:
            blk = blk[~((blk["obs_id"] == row["obs_id"]) & (blk["t"] < t0))]
    ref = blk[(blk["obs_id"] == c.ref) & (blk["n"] >= 15) & (blk["nd"] >= 15)].copy()
    ref = ref[(ref["s"] >= args.min_ref) & (ref["steady"] >= args.steady)]
    ref["dir"] = (ref["dir"] + float(getattr(args, "ref_offset", 0.0) or 0.0)) % 360.0
    if args.hours:
        h0, h1 = (int(x) for x in args.hours.split("-"))
        ref = ref[(ref["t"].dt.hour >= h0) & (ref["t"].dt.hour < h1)]
    ref["bin"] = bin_of(ref["dir"].to_numpy())
    ref = ref.rename(columns={"s": "s_ref", "dir": "dir_ref"})[["t", "s_ref", "dir_ref", "bin"]]

    others = blk[(blk["obs_id"] != c.ref) & (blk["n"] >= 15)]
    j = others.merge(ref, on="t", how="inner")
    j["ratio"] = j["s"] / j["s_ref"]
    turn_ok = (j["nd"] >= 15) & (j["s"] >= 0.5) & j["dir"].notna()
    j["turn"] = np.where(turn_ok, wrap180(j["dir"] - j["dir_ref"]), np.nan)
    j["day"] = j["t"].dt.date

    id_of = dict(zip(sens["obs_id"], sens["id"]))
    rows = []
    for (obs_id, b), g in j.groupby(["obs_id", "bin"]):
        n, days = len(g), g["day"].nunique()
        if n < args.min_n or days < args.min_days:
            continue
        tt = g["turn"].dropna()
        ok_turn = len(tt) >= args.min_n and g.loc[tt.index, "day"].nunique() >= args.min_days
        tm, tr = circ_mean(tt.to_numpy()) if ok_turn else (math.nan, math.nan)
        rows.append({
            "id": id_of.get(obs_id, obs_id), "bin": int(b), "dir": b * BIN, "n": n, "days": days,
            "ratio": float(g["ratio"].mean()), "ratio_median": float(g["ratio"].median()),
            "ratio_sd": float(g["ratio"].std()), "n_turn": int(len(tt)) if ok_turn else 0,
            "turn": tm, "turn_R": tr,
            "s_ref_mean": float(g["s_ref"].mean()), "s_mean": float(g["s"].mean()),
        })
    pts = pd.DataFrame(rows)
    refbins = ref.groupby("bin").agg(blocks=("t", "size"), days=("t", lambda t: t.dt.date.nunique()),
                                     s_ref=("s_ref", "mean"))
    info = {"moved_sensors_rows_from": moved,
            "reference_blocks": int(len(ref)),
            "reference_blocks_all_10min": int(((blk["obs_id"] == c.ref) & (blk["n"] >= 15)).sum())}
    return pts, refbins, info


# ---- the models at the sensors ------------------------------------------------


def positions(area, sens: pd.DataFrame) -> pd.DataFrame:
    """UTM x, y in the kit's epsg; fractional row, col on the cell centres;
    the DEM height there; whether the cell is valid and in the core."""
    from pyproj import Transformer
    b = area.meta["bounds"]
    tr = Transformer.from_crs(4326, int(area.meta["epsg"]), always_xy=True)
    x, y = tr.transform(sens["lon"].to_numpy(), sens["lat"].to_numpy())
    cell = float(area.meta.get("cell", 30.0))
    df = sens.copy()
    df["x"], df["y"] = x, y
    df["row"] = (b[3] - df["y"]) / cell - 0.5
    df["col"] = (df["x"] - b[0]) / cell - 0.5
    R, C = area.shape
    inside = (df["row"] >= 0) & (df["row"] <= R - 1) & (df["col"] >= 0) & (df["col"] <= C - 1)
    df = df[inside].copy()
    df["dem_m"] = sample(area.dem, df)
    ri, ci = df["row"].round().astype(int), df["col"].round().astype(int)
    df["valid"] = area.valid[ri, ci]
    df["core"] = area.core[ri, ci]
    df["edge_cells"] = np.minimum.reduce([df["row"], df["col"], R - 1 - df["row"], C - 1 - df["col"]])
    return df


def sample(grid: np.ndarray, pos: pd.DataFrame) -> np.ndarray:
    return map_coordinates(np.asarray(grid, np.float64), [pos["row"].to_numpy(), pos["col"].to_numpy()],
                           order=1, mode="nearest")


def classify(c: Campaign, pos: pd.DataFrame, area) -> dict:
    """The fixed part of a sensor's class (BSB's windward / lee needs the
    direction, done per point). Returns {id: (class, dx, dy)} with (dx, dy)
    the offset from the summit in metres."""
    out = {}
    if c.key == "bsb":
        # the summit: the DEM's highest cell within 2 km of the domain centre
        R, C = area.shape
        rr, cc = np.mgrid[0:R, 0:C]
        near = np.hypot(rr - R // 2, cc - C // 2) * 30.0 < 2000
        i = np.argmax(np.where(near, area.dem, -1e9))
        sr, sc = np.unravel_index(i, area.shape)
        for _, p in pos.iterrows():
            dx, dy = (p["col"] - sc) * 30.0, (sr - p["row"]) * 30.0
            dist = math.hypot(dx, dy)
            if p["dem_m"] >= 2000:
                k = "upper"
            elif p["dem_m"] < 1650 and dist >= 2500:
                k = "plain"
            else:
                k = "flank"
            out[p["id"]] = (k, dx, dy)
        out["_summit"] = (float(area.dem[sr, sc]), int(sr), int(sc))
    else:
        for _, p in pos.iterrows():
            z = p["dem_m"]
            out[p["id"]] = ("ridge" if z >= 1400 else "mid-slope" if z >= 800 else "canyon floor", 0.0, 0.0)
    return out


def point_class(c: Campaign, cls: dict, sid: str, direction: float) -> str:
    k, dx, dy = cls[sid]
    if c.key != "bsb" or k != "flank":
        return k
    # windward when the offset from the summit points toward where the wind comes from
    w = dx * math.sin(math.radians(direction)) + dy * math.cos(math.radians(direction))
    return "windward flank" if w > 0 else "lee flank"


def model_points(c: Campaign, area, base, pos: pd.DataFrame, pts: pd.DataFrame, damp: float = 1.0,
                 models: tuple[str, ...] = ("wn", "wn90", "mass")) -> pd.DataFrame:
    """Add each model's ratio and turn to the measured points. damp takes
    WindNinja's field (and its 90 m mean) toward the sector's ambient first,
    amb + damp * (field - amb) in u and v (grid axes, Area.amb), so the
    ratio to the reference and the turn are both those of the damped field."""
    ref = pos[pos["id"] == c.ref]
    if ref.empty:
        raise SystemExit(f"the reference {c.ref} is not on the {area.name} grid")
    slope = slope_deg(area.dem)
    flat = area.valid & (slope < 2.0)
    fields: dict[str, dict[int, tuple[np.ndarray, np.ndarray]]] = {"wn": {}, "wn90": {}, "mass": {}}
    for b in sorted(pts["bin"].unique()):
        d = float(b * BIN)
        i = direction_index(area, d)
        u, v = damp_contrast(area.u[i], area.v[i], *area.amb(d), damp)
        if "wn" in models:
            fields["wn"][b] = (u, v)
        if "wn90" in models:
            fields["wn90"][b] = (uniform_filter(u, 3, mode="nearest"), uniform_filter(v, 3, mode="nearest"))
        if base is not None and "mass" in models:
            fields["mass"][b] = baseline_field(base, "neutral", d, area.conv)
    pos_i = pos.set_index("id")
    out = pts[pts["id"].isin(pos_i.index)].copy()
    for name, fs in fields.items():
        if not fs:
            continue
        cols = {f"{name}_ratio": [], f"{name}_turn": [], f"{name}_flat_ratio": [], f"{name}_flat_turn": []}
        cache = {}
        for _, p in out.iterrows():
            b = int(p["bin"])
            if b not in cache:
                u, v = fs[b]
                ur, vr = sample(u, ref)[0], sample(v, ref)[0]
                sp = np.hypot(u, v)
                ex, ey = area.amb(b * BIN)
                cache[b] = (u, v, float(np.hypot(ur, vr)), float(bearing(ur, vr)),
                            float(np.median(sp[flat])), float(bearing(ex, ey)))
            u, v, s_ref, b_ref, s_flat, b_amb = cache[b]
            one = pos_i.loc[[p["id"]]]
            us, vs = sample(u, one)[0], sample(v, one)[0]
            s, bs = float(np.hypot(us, vs)), float(bearing(us, vs))
            cols[f"{name}_ratio"].append(s / s_ref)
            cols[f"{name}_turn"].append(float(wrap180(bs - b_ref)))
            cols[f"{name}_flat_ratio"].append(s / s_flat)
            cols[f"{name}_flat_turn"].append(float(wrap180(bs - b_amb)))
        for k, v in cols.items():
            out[k] = v
    out["uni_ratio"] = 1.0
    out["uni_turn"] = 0.0
    return anomalies(out)


def anomalies(pts: pd.DataFrame, min_bins: int = 3) -> pd.DataFrame:
    """Each sensor's turns about its own mean over the bins it has, measured
    and modelled alike (turn_anom, <model>_turn_anom). A vane set some
    degrees off north, and any steady turn the same in every wind, drop out;
    what is left is how the turn changes with the wind's direction, which is
    the terrain's doing. Sensors with fewer than min_bins turns get NaN."""
    pts = pts.copy()
    keys = [c[:-5] for c in pts.columns if c.endswith("_turn") and c != "turn"]
    pts["turn_anom"] = np.nan
    for k in keys:
        pts[f"{k}_turn_anom"] = np.nan
    pts["offset"] = np.nan
    # speed against the network: each sensor's ratio over the bin's mean ratio,
    # measured and modelled alike, so a reference the model shelters (or
    # exposes) more than the real one does not scale a whole bin
    ratio_keys = [c[:-6] for c in pts.columns if c.endswith("_ratio") and c not in ("ratio", "ratio_net")]
    for b, g in pts.groupby("bin"):
        pts.loc[g.index, "ratio_net"] = g["ratio"] / g["ratio"].mean()
        for k in ratio_keys:
            pts.loc[g.index, f"{k}_ratio_net"] = g[f"{k}_ratio"] / g[f"{k}_ratio"].mean()
    for sid, g in pts[pts["turn"].notna()].groupby("id"):
        if len(g) < min_bins:
            continue
        m, _ = circ_mean(g["turn"].to_numpy())
        pts.loc[g.index, "turn_anom"] = wrap180(g["turn"] - m)
        for k in keys:
            mk, _ = circ_mean(g[f"{k}_turn"].to_numpy())
            pts.loc[g.index, f"{k}_turn_anom"] = wrap180(g[f"{k}_turn"] - mk)
            if k == "wn":
                pts.loc[g.index, "offset"] = float(wrap180(m - mk))
    return pts


# ---- the scores ---------------------------------------------------------------


MODELS = [("WindNinja momentum", "wn"), ("mass neutral (SD)", "mass"), ("uniform ambient", "uni"),
          ("WindNinja, 90 m mean", "wn90"),
          ("WindNinja, flat-ground ref", "wn_flat"), ("mass neutral, flat-ground ref", "mass_flat")]


def scores(pts: pd.DataFrame, key: str) -> dict:
    if f"{key}_ratio" not in pts:
        return {"n": 0}
    m = pts[f"{key}_ratio"].to_numpy(float)
    y = pts["ratio"].to_numpy(float)
    d = {"n": int(len(pts))}
    if len(pts):
        d |= {"ratio_r": pearson(m, y) if np.ptp(m) > 0 else math.nan,
              "ratio_mae": float(np.mean(np.abs(m - y))),
              "ratio_bias": float(np.mean(m - y)),
              "ratio_mae_debiased": float(np.mean(np.abs(m / np.median(m / y) - y)))}
    t = pts["turn"].notna()
    mt = pts.loc[t, f"{key}_turn"].to_numpy(float)
    yt = pts.loc[t, "turn"].to_numpy(float)
    d["n_turn"] = int(t.sum())
    if t.sum():
        e = wrap180(mt - yt)
        big = np.abs(yt) >= 45
        d |= {"turn_r": pearson(mt, yt) if np.ptp(mt) > 0 else math.nan,
              "turn_mae": float(np.mean(np.abs(e))),
              "turn_bias": float(np.mean(e)),
              "turn_median_abs": float(np.median(np.abs(e))),
              "within_22_5": float(np.mean(np.abs(e) <= 22.5) * 100),
              "measured_big_turns": int(big.sum()),
              "big_turns_caught": int((big & (np.abs(mt) >= 45) & (np.sign(mt) == np.sign(yt))).sum())}
    if f"{key}_ratio_net" in pts and len(pts):
        mn, yn = pts[f"{key}_ratio_net"].to_numpy(float), pts["ratio_net"].to_numpy(float)
        d |= {"net_r": pearson(mn, yn) if np.ptp(mn) > 0 else math.nan,
              "net_mae": float(np.mean(np.abs(mn - yn)))}
    a = pts["turn_anom"].notna() & pts.get(f"{key}_turn_anom", pd.Series(np.nan, index=pts.index)).notna()
    d["n_anom"] = int(a.sum())
    if a.sum():
        ma = pts.loc[a, f"{key}_turn_anom"].to_numpy(float)
        ya = pts.loc[a, "turn_anom"].to_numpy(float)
        d |= {"anom_r": pearson(ma, ya) if np.ptp(ma) > 0 else math.nan,
              "anom_mae": float(np.mean(np.abs(wrap180(ma - ya))))}
    return d


def board_for(pts: pd.DataFrame) -> dict:
    out = {}
    classes = ["all"] + sorted(pts["class"].unique())
    if "windward flank" in classes:
        classes.insert(1, "exposed (upper + windward flank)")
    for cl in classes:
        if cl == "all":
            sub = pts
        elif cl.startswith("exposed"):
            sub = pts[pts["class"].isin(["upper", "windward flank"])]
        else:
            sub = pts[pts["class"] == cl]
        out[cl] = {name: scores(sub, key) for name, key in MODELS}
    return out


def by_bin(pts: pd.DataFrame, min_points: int = 10) -> list[dict]:
    """Within one bin every sensor shares the ambient and the reference, so
    the cross-sensor r there is the cleanest test of the pattern; the pooled
    r also mixes how the reference itself sits in each wind."""
    out = []
    for b, g in pts.groupby("bin"):
        if len(g) < min_points:
            continue
        row = {"bin": int(b), "dir": float(b * BIN), "n": int(len(g)),
               "uniform_ratio_mae": float(np.mean(np.abs(1.0 - g["ratio"])))}
        t = g["turn"].notna()
        for key in ("wn", "mass"):
            if f"{key}_ratio" not in g:
                continue
            row[f"{key}_ratio_r"] = pearson(g[f"{key}_ratio"], g["ratio"])
            row[f"{key}_ratio_mae"] = float(np.mean(np.abs(g[f"{key}_ratio"] - g["ratio"])))
            row[f"{key}_turn_r"] = pearson(g.loc[t, f"{key}_turn"], g.loc[t, "turn"]) if t.sum() >= 3 else math.nan
        out.append(row)
    return out


def fmt(x, nd=2) -> str:
    return "-" if x is None or (isinstance(x, float) and not math.isfinite(x)) else f"{x:.{nd}f}"


def tables(c: Campaign, board: dict) -> str:
    lines = [f"# {c.name}: WindNinja (the teacher) against the measured wind", "",
             *([f"The WindNinja rows are {board['field']}'s field (--pred).", ""]
               if board.get("field", "WindNinja momentum") != "WindNinja momentum" else []),
             f"Reference {c.ref}; reference blocks: 10 min, mean >= {board['filters']['min_ref_ms']} m/s, "
             f"steadiness >= {board['filters']['steady']}"
             + (f", hours {board['filters']['hours']} local" if board['filters']['hours'] else "")
             + (f"; reference direction turned {board['filters']['ref_offset']:+.1f} deg "
                f"({board['filters']['ref_offset_why']})" if board['filters']['ref_offset'] else "")
             + f"; a sensor-bin needs {board['filters']['min_n']} blocks from {board['filters']['min_days']} days. "
             f"{board['counts']['sensors_scored']} sensors, {board['counts']['bins_with_data']} bins with data, "
             f"{board['counts']['points']} sensor-bins ({board['counts']['points_turn']} with a turn).", ""]
    head = ("| model | n | ratio r | ratio MAE | ratio bias | ratio MAE debiased | n turn | turn r | "
            "turn MAE | turn bias | <=22.5 % | big turns caught | n anom | anom r | anom MAE | net r | net MAE |")
    for cl, rows in board["scores"].items():
        lines += [f"## {cl}", "", head, "|" + "---|" * 17]
        for name, m in rows.items():
            if not m.get("n"):
                continue
            lines.append(
                f"| {name} | {m['n']} | {fmt(m.get('ratio_r'))} | {fmt(m.get('ratio_mae'), 3)} | "
                f"{fmt(m.get('ratio_bias'), 3)} | {fmt(m.get('ratio_mae_debiased'), 3)} | {m.get('n_turn', 0)} | "
                f"{fmt(m.get('turn_r'))} | {fmt(m.get('turn_mae'), 1)} | {fmt(m.get('turn_bias'), 1)} | "
                f"{fmt(m.get('within_22_5'), 0)} | "
                f"{m.get('big_turns_caught', '-')}/{m.get('measured_big_turns', '-')} | {m.get('n_anom', 0)} | "
                f"{fmt(m.get('anom_r'))} | {fmt(m.get('anom_mae'), 1)} | {fmt(m.get('net_r'))} | "
                f"{fmt(m.get('net_mae'), 3)} |")
        lines.append("")
    bb = board.get("by_bin") or []
    if bb:
        lines += ["## Within each bin (one ambient, one reference)", "",
                  "| bin (from) | n | WindNinja ratio r | mass ratio r | WindNinja ratio MAE | mass ratio MAE | "
                  "uniform ratio MAE | WindNinja turn r | mass turn r |", "|---|---|---|---|---|---|---|---|---|"]
        for r in bb:
            lines.append(f"| {r['dir']:.1f} | {r['n']} | {fmt(r.get('wn_ratio_r'))} | {fmt(r.get('mass_ratio_r'))} | "
                         f"{fmt(r.get('wn_ratio_mae'), 3)} | {fmt(r.get('mass_ratio_mae'), 3)} | "
                         f"{fmt(r['uniform_ratio_mae'], 3)} | {fmt(r.get('wn_turn_r'))} | {fmt(r.get('mass_turn_r'))} |")
        w = np.array([r["n"] for r in bb], float)
        for key, name in (("wn", "WindNinja"), ("mass", "mass neutral")):
            v = np.array([r.get(f"{key}_ratio_r", math.nan) for r in bb], float)
            ok = np.isfinite(v)
            if ok.any():
                lines.append(f"| {name}: n-weighted mean ratio r | | {fmt(float(np.average(v[ok], weights=w[ok])))} |"
                             " | | | | | |")
        lines.append("")
    lines += ["## Bins with data", "", "| bin (from) | reference blocks | days | mean ref speed m/s | sensors |",
              "|---|---|---|---|---|"]
    for b in board["bins"]:
        lines.append(f"| {b['dir']:.1f} | {b['blocks']} | {b['days']} | {b['s_ref']:.1f} | {b['sensors']} |")
    lines.append("")
    return "\n".join(lines)


# ---- the figure ---------------------------------------------------------------


CLASS_STYLE = {  # validated categorical slots 1-3 (dataviz palette), a neutral grey for the plain
    "upper": ("#1baf7a", "^"), "windward flank": ("#2a78d6", "o"), "lee flank": ("#eb6834", "s"),
    "plain": ("#8a8984", "D"),
    "ridge": ("#1baf7a", "^"), "mid-slope": ("#2a78d6", "o"), "canyon floor": ("#eb6834", "s"),
}


def figure(c: Campaign, pts: pd.DataFrame, board: dict, path: Path) -> None:
    """Three rows (speed ratio, turn, turn about the sensor's own mean),
    two columns (WindNinja, mass neutral); one point per sensor and bin."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    ink, muted, grid = "#0b0b0b", "#52514e", "#e4e3df"
    fig, axs = plt.subplots(3, 2, figsize=(10.5, 15), dpi=120)
    fig.patch.set_facecolor("#fcfcfb")
    cols = [("WindNinja momentum", "wn"), ("mass neutral (SD)", "mass")]
    rmax = max(2.0, float(np.nanmax(pts[["ratio", "wn_ratio", "mass_ratio"]].to_numpy())) * 1.05)
    rows = [("ratio", (0, rmax), "speed ratio to the reference", ""),
            ("turn", (-180, 180), "turn from the reference", " (deg)"),
            ("turn_anom", (-180, 180), "turn about the sensor's own mean", " (deg)")]
    for j, (name, key) in enumerate(cols):
        m = board["scores"]["all"][name]
        for i, (what, lim, label, unit) in enumerate(rows):
            ax = axs[i, j]
            ax.set_facecolor("#fcfcfb")
            ax.plot(lim, lim, color=muted, lw=1, ls="--", zorder=1)
            mid = 1 if what == "ratio" else 0
            ax.axhline(mid, color=grid, lw=1, zorder=0)
            ax.axvline(mid, color=grid, lw=1, zorder=0)
            for cl in sorted(pts["class"].unique()):
                s = pts[pts["class"] == cl]
                col, mk = CLASS_STYLE.get(cl, ("#4a3aa7", "o"))
                ax.scatter(s[what], s[f"{key}_{what}"], s=24, c=col, marker=mk, edgecolors="#fcfcfb",
                           linewidths=0.8, label=f"{cl} ({len(s)})", zorder=3, alpha=0.9)
            ax.set_xlim(lim)
            ax.set_ylim(lim)
            ax.set_aspect("equal")
            if what != "ratio":
                ax.set_xticks([-180, -90, 0, 90, 180])
                ax.set_yticks([-180, -90, 0, 90, 180])
            ax.set_xlabel(f"measured {label}{unit}", color=muted, fontsize=9)
            ax.set_ylabel(f"{name}{unit}", color=muted, fontsize=9)
            stat = {"ratio": f"r {fmt(m.get('ratio_r'))}, MAE {fmt(m.get('ratio_mae'))}",
                    "turn": f"r {fmt(m.get('turn_r'))}, MAE {fmt(m.get('turn_mae'), 0)} deg",
                    "turn_anom": f"r {fmt(m.get('anom_r'))}, MAE {fmt(m.get('anom_mae'), 0)} deg"}[what]
            title = {"ratio": "speed ratio", "turn": "turn", "turn_anom": "turn, own mean removed"}[what]
            ax.set_title(f"{name}: {title}\n{stat}", fontsize=10, color=ink, loc="left")
            ax.tick_params(colors=muted, labelsize=8)
            for sp in ax.spines.values():
                sp.set_color(grid)
            if i == 0 and j == 0:
                ax.legend(fontsize=8, frameon=False, loc="upper left")
    fig.suptitle(f"{c.name}: measured vs modelled, one point per sensor and direction bin\n"
                 f"reference {c.ref}, {board['counts']['bins_with_data']} bins, "
                 f"reference blocks >= {board['filters']['min_ref_ms']:g} m/s"
                 + (f", reference direction turned {board['filters']['ref_offset']:+.0f} deg"
                    if board['filters']['ref_offset'] else ""), fontsize=11, color=ink, x=0.02,
                 ha="left")
    fig.tight_layout(rect=(0, 0, 1, 0.97))
    tmp = path.with_suffix(".tmp.png")
    fig.savefig(tmp, facecolor=fig.get_facecolor())
    plt.close(fig)
    tmp.replace(path)


# ---- the contrast damping scan ------------------------------------------------


DAMP_KS = (0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1)
# per campaign: the class whose ratio r and the class whose ratio bias the
# scan reports (the butte's exposed ground and lee; the canyon's ridge and floor)
SCAN_CLASSES = {"bsb": (("exposed", ("upper", "windward flank")), ("lee flank", ("lee flank",))),
                "src": (("ridge", ("ridge",)), ("canyon floor", ("canyon floor",)))}


def use_prediction(area, path: str) -> dict:
    """Put a predict.py output (pred-<run>-<area>.npz: u, v on the area's own
    grid and axes) in place of WindNinja's u, v. Returns its meta."""
    f = Path(path)
    if not f.exists() and (DATA / f.name).exists():
        f = DATA / f.name
    z = np.load(f, allow_pickle=False)
    if z["u"].shape != area.u.shape or not np.allclose(z["directions"], area.directions):
        raise SystemExit(f"{f} is not on the {area.name} grid: u {z['u'].shape} against {area.u.shape}")
    area.u = z["u"].astype(np.float32)
    area.v = z["v"].astype(np.float32)
    meta = json.loads(str(z["meta"])) if "meta" in z.files else {}
    return meta | {"file": str(f)}


def damp_row(c: Campaign, area, pos: pd.DataFrame, pts: pd.DataFrame, cls: dict, k: float,
             mode: str = "vector", undamped: pd.DataFrame | None = None) -> dict:
    """The field damped by k, scored as the board scores WindNinja. mode
    vector: u and v toward the ambient (amb + k (field - amb)), so the turns
    shrink too; mode speed: the modelled speed ratio only, 1 + k (ratio - 1),
    after the ratio to the reference (which stands for the ambient there),
    the turns left as they are (undamped: the k = 1 points, made once). slope: the
    measured ratio's departure from 1 regressed on the modelled one's through
    the origin (under 1 = the modelled contrast is too big for what it gets
    right: overdone, or partly wrong, which a regression slope cannot tell
    apart). spread: the measured ratios' standard deviation over the
    modelled ones', the size of the contrast alone (1 = the same size)."""
    if mode == "speed":
        p = (undamped if undamped is not None else model_points(c, area, None, pos, pts, models=("wn",))).copy()
        for col in ("wn_ratio", "wn_flat_ratio"):
            p[col] = np.maximum(0.0, 1.0 + k * (p[col] - 1.0))
        p = anomalies(p)
    else:
        p = model_points(c, area, None, pos, pts, damp=k, models=("wn",))
    p["class"] = [point_class(c, cls, r["id"], r["dir"]) for _, r in p.iterrows()]
    s = scores(p, "wn")
    x = p["wn_ratio"].to_numpy(float) - 1.0
    y = p["ratio"].to_numpy(float) - 1.0
    (rn, rk), (bn, bk) = SCAN_CLASSES[c.key]
    sr = scores(p[p["class"].isin(rk)], "wn")
    sb = scores(p[p["class"].isin(bk)], "wn")
    return {"k": float(k), "n": s["n"], "ratio_r": s.get("ratio_r"), "ratio_mae": s.get("ratio_mae"),
            "ratio_bias": s.get("ratio_bias"), "slope": float((x * y).sum() / (x * x).sum()),
            "slope_ols": float(np.polyfit(x, y, 1)[0]), "spread": float(y.std() / x.std()),
            "class_r": sr.get("ratio_r"), "class_r_n": sr.get("n"),
            "class_bias": sb.get("ratio_bias"), "class_bias_n": sb.get("n"),
            "anom_mae": s.get("anom_mae"), "turn_mae": s.get("turn_mae"),
            "net_r": s.get("net_r"), "net_mae": s.get("net_mae")}


def damp_scan(c: Campaign, area, pos: pd.DataFrame, pts: pd.DataFrame, cls: dict, label: str,
              ks=DAMP_KS, mode: str = "vector") -> dict:
    """WindNinja's field (or a net's, --pred) taken toward the ambient by k,
    amb + k (field - amb), scored for each k; then the k that minimises the
    ratio MAE and the k that brings the slope to 1, each refined between the
    grid's points."""
    from scipy.optimize import brentq, minimize_scalar

    und = model_points(c, area, None, pos, pts, models=("wn",)) if mode == "speed" else None
    memo: dict[float, dict] = {}

    def at(k: float) -> dict:
        k = round(float(k), 4)
        if k not in memo:
            memo[k] = damp_row(c, area, pos, pts, cls, k, mode, und)
        return memo[k]

    rows = [at(k) for k in ks]

    g = int(np.argmin([r["ratio_mae"] for r in rows]))
    lo, hi = max(0.0, ks[g] - 0.1), ks[g] + 0.1
    m = minimize_scalar(lambda k: at(k)["ratio_mae"], bounds=(lo, hi), method="bounded",
                        options={"xatol": 0.005})
    k_mae = float(m.x)
    def to_one(key: str) -> float:
        """The k where rows' key crosses 1, refined between the grid's points."""
        f = np.array([r[key] for r in rows]) - 1.0
        bracket = None
        for i in range(len(ks) - 1):
            if f[i] * f[i + 1] <= 0:
                bracket = (ks[i], ks[i + 1])
                break
        if bracket is None:  # outside the grid: look wider
            a, b = 0.02, 3.0
            if (at(a)[key] - 1) * (at(b)[key] - 1) < 0:
                bracket = (a, b)
        if bracket is None:
            return math.nan
        return float(brentq(lambda k: at(k)[key] - 1.0, *bracket, xtol=0.002))

    k_slope, k_spread = to_one("slope"), to_one("spread")
    on = pts[pts["id"].isin(pos["id"])]["ratio"].to_numpy(float)
    return {"campaign": c.name, "field": label, "mode": mode, "ks": list(ks), "rows": rows,
            "uniform_ratio_mae": float(np.mean(np.abs(1.0 - on))), "uniform_ratio_bias": float(np.mean(1.0 - on)),
            "classes": [SCAN_CLASSES[c.key][0][0], SCAN_CLASSES[c.key][1][0]],
            "k_min_mae": k_mae, "at_k_min_mae": at(k_mae),
            "k_slope_1": k_slope, "at_k_slope_1": at(k_slope) if math.isfinite(k_slope) else None,
            "k_spread_1": k_spread, "at_k_spread_1": at(k_spread) if math.isfinite(k_spread) else None}


def damp_table(c: Campaign, scan: dict, args) -> str:
    rn, bn = scan["classes"]
    what = ("its speed contrast damped, ratio 1 + k (ratio - 1), turns as they are" if scan.get("mode") == "speed"
            else "its contrast damped, amb + k (field - amb)")
    lines = [f"# {c.name}: {scan['field']} with {what}", "",
             f"Reference {c.ref}, reference blocks >= {args.min_ref:g} m/s, steadiness >= {args.steady}"
             + (f", hours {args.hours}" if args.hours else "")
             + (f", reference direction turned {args.ref_offset:+.1f} deg" if args.ref_offset else "")
             + (f", sectors {', '.join(f'{d:g}' for d in args.sectors)}" if args.sectors else "")
             + f"; {scan['rows'][0]['n']} sensor-bins. slope: measured - 1 on modelled - 1 through the origin;"
             " slope OLS: the same with an intercept; spread: sd of the measured ratios over sd of the modelled;"
             " turn MAE own mean: about each sensor's own mean.", "",
             f"| k | ratio r | ratio MAE | ratio bias | slope | slope OLS | spread | {rn} r | {bn} bias | "
             "turn MAE own mean | turn MAE | net r |", "|---|---|---|---|---|---|---|---|---|---|---|---|"]

    def row(r: dict, k: str) -> str:
        return (f"| {k} | {fmt(r['ratio_r'])} | {fmt(r['ratio_mae'], 3)} | {fmt(r['ratio_bias'], 3)} | "
                f"{fmt(r['slope'])} | {fmt(r['slope_ols'])} | {fmt(r['spread'])} | {fmt(r['class_r'])} | "
                f"{fmt(r['class_bias'], 3)} | "
                f"{fmt(r['anom_mae'], 1)} | {fmt(r['turn_mae'], 1)} | {fmt(r['net_r'])} |")

    for r in scan["rows"]:
        lines.append(row(r, f"{r['k']:.1f}"))
    lines.append(row(scan["at_k_min_mae"], f"**{scan['k_min_mae']:.2f}** (least ratio MAE)"))
    for key, what in (("slope", "slope 1"), ("spread", "spread 1")):
        if scan[f"at_k_{key}_1"]:
            lines.append(row(scan[f"at_k_{key}_1"], f"**{scan[f'k_{key}_1']:.2f}** ({what})"))
        else:
            lines.append(f"| {what} | not reached for k in 0.02-3 |" + " |" * 10)
    lines += ["", f"uniform ambient (k = 0): ratio MAE {fmt(scan['uniform_ratio_mae'], 3)}, "
              f"ratio bias {fmt(scan['uniform_ratio_bias'], 3)}", ""]
    return "\n".join(lines)


# ---- main -------------------------------------------------------------------


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("campaign", choices=sorted(CAMPAIGNS))
    ap.add_argument("--min-ref", type=float, default=None,
                    help="reference 10 min mean speed, m/s (default: the campaign's synoptic threshold)")
    ap.add_argument("--steady", type=float, default=0.9, help="reference steadiness, resultant / scalar mean")
    ap.add_argument("--hours", default=None, help="local hours h0-h1 of the reference block, e.g. 10-18")
    ap.add_argument("--ref-offset", default="0",
                    help="degrees added to the reference's direction, or 'auto': the ring's consensus (BSB)")
    ap.add_argument("--min-n", type=int, default=10)
    ap.add_argument("--min-days", type=int, default=2)
    ap.add_argument("--tag", default="")
    ap.add_argument("--rebuild", action="store_true", help="reread the database into blocks")
    ap.add_argument("--damp-scan", action="store_true",
                    help="score WindNinja's field with its deviation from the ambient scaled by k = 0.3 ... 1.1 "
                         "(writes <campaign>[-tag]-damp.json, .md; not the scoreboard)")
    ap.add_argument("--damp-mode", choices=["vector", "speed"], default="vector",
                    help="the scan's damping: u, v toward the ambient (vector), or the speed ratio only (speed)")
    ap.add_argument("--ks", default=None, help="the scan's k, comma-separated (default 0.3,0.4,...,1.1)")
    ap.add_argument("--sectors", default=None,
                    help="score only these reference sectors (FROM, degrees, comma-separated, e.g. 202.5,225,247.5,270)")
    ap.add_argument("--pred", default=None,
                    help="a predict.py output (pred-<run>-<area>.npz) to score in WindNinja's place")
    args = ap.parse_args()
    c = CAMPAIGNS[args.campaign]
    if args.sectors:
        args.sectors = [float(x) for x in args.sectors.split(",")]
    if args.min_ref is None:
        args.min_ref = c.strong_ms

    sens = sensors(c)
    blk = blocks(c, args.rebuild)
    why, ring = "", {}
    if args.ref_offset == "auto":
        if not c.ring:
            raise SystemExit(f"{c.key} has no ring of open-ground vanes for 'auto'")
        args.ref_offset, ring = ring_offset(c, sens, blk, args)
        why = ("circular mean of the median turns of the ring " + ", ".join(f"{k} {v:+.0f}" for k, v in ring.items())
               + f" and {c.ref} 0")
        print(f"  reference direction turned {args.ref_offset:+.1f} deg: {why}")
    else:
        args.ref_offset = float(args.ref_offset)
        why = "given" if args.ref_offset else ""
    pts, refbins, info = measured(c, sens, blk, args)
    if args.sectors:
        pts = pts[pts["bin"].isin([int(b) for b in bin_of(np.array(args.sectors))])]
    if pts.empty:
        raise SystemExit("no sensor-bin has enough blocks")

    area = load_area(c.area, features=False)
    label = "WindNinja momentum"
    if args.pred:
        pm = use_prediction(area, args.pred)
        label = f"the net {pm.get('run')}" + (" (in-sample: trained on this area)" if pm.get("in_sample") else "")
        print(f"  WindNinja's field replaced by {pm['file']}: {label}")
    pos = positions(area, sens)
    cls = classify(c, pos, area)
    stem = c.key + (f"-{args.tag}" if args.tag else "")
    if args.damp_scan:
        ks = tuple(float(x) for x in args.ks.split(",")) if args.ks else DAMP_KS
        scan = damp_scan(c, area, pos, pts, cls, label, ks, args.damp_mode)
        scan["filters"] = {"min_ref_ms": args.min_ref, "steady": args.steady, "hours": args.hours,
                           "sectors": args.sectors,
                           "ref_offset": args.ref_offset, "min_n": args.min_n, "min_days": args.min_days,
                           "pred": args.pred}
        md = damp_table(c, scan, args)
        OUT.mkdir(parents=True, exist_ok=True)
        out = f"{stem}-damp" + ("-speed" if args.damp_mode == "speed" else "")
        (OUT / f"{out}.json").write_text(json.dumps(scan, indent=1))
        (OUT / f"{out}.md").write_text(md, encoding="utf-8")
        print(md)
        print(f"wrote {OUT / out}.json, .md")
        return
    base = load_baseline(c.area)
    pts = model_points(c, area, base, pos, pts)
    pts["class"] = [point_class(c, cls, r["id"], r["dir"]) for _, r in pts.iterrows()]

    bins = []
    for b, r in refbins.iterrows():
        k = pts["bin"] == b
        if k.any():
            bins.append({"bin": int(b), "dir": float(b * BIN), "blocks": int(r["blocks"]), "days": int(r["days"]),
                         "s_ref": float(r["s_ref"]), "sensors": int(k.sum())})
    ref = pos[pos["id"] == c.ref].iloc[0]
    board = {
        "campaign": c.name, "area": c.area, "period": c.period, "reference": c.ref, "field": label,
        "source": "Zenodo 10.5281/zenodo.8226638 (CC-BY 4.0), pipeline/raw/idaho/" + c.db,
        "filters": {"min_ref_ms": args.min_ref, "steady": args.steady, "hours": args.hours,
                    "ref_offset": args.ref_offset, "ref_offset_why": why, "ring_median_turns": ring,
                    "min_n": args.min_n, "min_days": args.min_days, "block": "10 min, 15+ of 20 samples",
                    "turn_needs": "sensor block mean >= 0.5 m/s and 15+ direction samples"},
        "convergence_deg": area.conv,
        "reference_position": {"x": float(ref["x"]), "y": float(ref["y"]), "dem_m": float(ref["dem_m"]),
                               "valid": bool(ref["valid"]), "core": bool(ref["core"]),
                               "cells_from_edge": float(ref["edge_cells"])},
        "counts": {"sensors_listed": int(len(sens)), "sensors_on_grid": int(len(pos)),
                   "sensors_scored": int(pts["id"].nunique()), "bins_with_data": len(bins),
                   "points": int(len(pts)), "points_turn": int(pts["turn"].notna().sum())} | info,
        "bins": bins,
        "sensors": [{"id": r["id"], "lat": float(r["lat"]), "lon": float(r["lon"]), "x": round(float(r["x"]), 1),
                     "y": round(float(r["y"]), 1), "dem_m": round(float(r["dem_m"]), 1), "valid": bool(r["valid"]),
                     "core": bool(r["core"]), "class": cls[r["id"]][0],
                     "bins": int((pts["id"] == r["id"]).sum())} for _, r in pos.iterrows()],
        "scores": board_for(pts),
        "by_bin": by_bin(pts),
    }
    offs = pts.dropna(subset=["offset"]).groupby("id").agg(offset=("offset", "first"))
    offs["class"] = [cls[i][0] for i in offs.index]
    board["offsets"] = {}
    for k, g in [("all", offs)] + list(offs.groupby("class")):
        o = g["offset"].to_numpy()
        board["offsets"][k] = {"n": int(len(o)), "median": float(np.median(o)),
                               "p25": float(np.percentile(o, 25)), "p75": float(np.percentile(o, 75))}
    board["offsets_by_sensor"] = {i: round(float(v), 1) for i, v in offs["offset"].items()}
    if "_summit" in cls:
        board["summit"] = {"dem_m": cls["_summit"][0], "row": cls["_summit"][1], "col": cls["_summit"][2]}

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"{stem}-scoreboard.json").write_text(json.dumps(board, indent=1))
    md = tables(c, board)
    (OUT / f"{stem}-scoreboard.md").write_text(md, encoding="utf-8")
    pts.round(4).to_csv(OUT / f"{stem}-points.csv", index=False)
    figure(c, pts, board, OUT / f"{stem}-scatter.png")
    print(md)
    print(f"wrote {OUT / stem}-scoreboard.json, .md, -points.csv, -scatter.png")


if __name__ == "__main__":
    main()
