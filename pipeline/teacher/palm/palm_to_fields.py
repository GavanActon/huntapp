"""PALM's output as the wind fields the rest of the pipeline reads, and the
score of a run against WindNinja and against what Gavan felt.

    py -3.14 pipeline/teacher/palm/palm_to_fields.py convert searchmont searchmont_stable
    py -3.14 pipeline/teacher/palm/palm_to_fields.py convert searchmont searchmont_stable --output <dir>
    py -3.14 pipeline/teacher/palm/palm_to_fields.py score searchmont
    py -3.14 pipeline/teacher/palm/palm_to_fields.py score searchmont --windninja C:/tmp/wn-trial/searchmont10/dusk-mom

CONVERT reads a run's averaged 3D output (<run>_av_3d.*.nc: u, v, w, e,
theta on the cell centres, interpolate_to_grid_center) and, when there, its
terrain-following masked output (<run>_masked_M001.*.nc: u, v, w every 30 s
on the first four levels over the ground; the records PALM sized for but
never wrote, time 0 and all zeros, are dropped), and writes
pipeline/raw/teacher/palm/fields/<run>.npz in the surrogate's convention
(pipeline/surrogate/fields.py):

  dem          (R, C) m, the case's DEM, row 0 the north edge, col 0 the west
  u, v         (1, R, C) east, north in the GRID's axes (UTM), over the
               ambient speed, at WindNinja's height: 10 m over the canopy
               top (10 m over the ground in the open)
  u10, v10     the same 10 m over the ground
  uHead, vHead the same at head height: the first level over the ground
               (dz/2: 5 m at 10 m, 2.5 m at 5 m), taken down to 2 m by the
               log law on the cell's z0 in the open; under trees as it is
               (the air under the crowns is close to uniform with height)
  turb         (1, R, C) the fluctuation over the ambient at 10 m over the
               canopy, sqrt(resolved + 2/3 e) as WindNinja's turbulence is
               read; turbHead the same at head height
  gustHead, lullHead  (1, R, C) the 90th and 10th percentile speed at head
               height over the ambient, from the masked samples; reversedHead
               the share of samples turned more than 90 deg from the ambient
               (a puff is a sample of a distribution: WIND-LEARNING.md)
  gustFromHead (1, R, C) where the gusty moments come FROM, degrees true: the
               circular mean direction of the samples in the top quartile of
               speed at the cell; gustSpreadHead their circular standard
               deviation, degrees (on a calm floor the few gusts are what is
               felt)
  directions   (1,) the ambient FROM, degrees true
  ambientKph   () the ambient speed used, km/h (also in meta): a field's
               ratio x ambientKph is the modelled speed in km/h
  core, valid  (R, C) bool
  meta         json: epsg, bounds, cell, the ambient (how it was taken, its
               speed and direction, true and grid), gridConvergenceDeg, the
               levels, the run, its stability, the averaging window, files

THE AMBIENT. WindNinja's ratios are to its domain-average input wind (22 or
16.2 km/h at 10 m over the vegetation). The like-for-like here (--ambient
domain, the default) is the vector mean of the canopy+10 m level over the
whole domain. --ambient ring takes the tapered outer ring (the flattest
ground, the approach flow in a cyclic box); --ambient aloft:600 the
horizontal mean at 600 m over the lowest ground, above every hill. The meta
carries all three, whichever is used.

SCORE reads the converted runs of a case and prints, per run, in km/h
(a field's ratio x ambientKph):
- the check points, read at two levels: at the floor (head height) the mean
  wind (the cell, and the median direction of the 3 x 3 around it) AND the
  gusts (gustHead at the cell, from the 3 x 3's circular mean of
  gustFromHead, and their spread), the share of the time reversed, and
  whether the mean turned past 90 deg from the ambient; at the treetops the
  wind at 10 m over the canopy. Each against what was felt or seen; a check
  whose felt direction was the gusts' (felt_is="gusts") is scored on them,
  with the mean wind's miss printed beside it;
- the gate of TEACHER.md Track A for the Searchmont case (below);
- with --windninja, the run against a WindNinja run over the core, in
  eval.py's terms (turn error MAE / median / within 22.5 deg, turn r, speed
  ratio r and bias), WindNinja's ascii u, v grids (km/h) on the same 10 m
  lattice: the momentum dusk run is C:/tmp/wn-trial/searchmont10/dusk-mom.

THE GATE for Searchmont (what "the teacher is right" means, in numbers).
It reads two levels, because that is what was there: a valley floor under
an inversion, near calm with a few gusts, and treetops moving steadily.
  stable SSE (from 152 at 16.2 km/h, dusk):
    floor (46.77744, -84.04824) at head height: calm, the mean wind under
      CALM_KPH (2 km/h: "generally 1.6 km/h, a few gusts, very very calm");
      its GUSTS (the top quartile of the 30 s samples) from within 45 deg of
      308 (felt 308, puffs 303 and 313: the 308 was the gusts); the mean
      turned more than 90 deg from the ambient, in the cell and in the
      3 x 3 median;
    the reversal is a place, not a cell: reversed (turn > 90) over at least
      0.5 ha of the valley floor round the point (50 cells at 10 m);
    treetops 500 m SE (46.77371, -84.04476) at 10 m over the canopy: from
      within 45 deg of 180, not reversed.
  midday (from 186 at 10.4 km/h, convective):
    floor (46.77327, -84.04020) at head height: within 45 deg of 249 (along
      the valley), not reversed;
    the top (5 checks, 180-299, mean 215): the median miss no worse than
      WindNinja momentum's at the same points (trial.py: 175-186 against
      the felt, a median miss of 30 deg).
  neutral SSE: no pass mark. It says whether a reversal is stability's
    (neutral does not reverse: the hypothesis) or the hill's alone.
  and before any of it: the run is gradeable only if its averaging began
    after 1.5 h of spin-up AND, at every check seen at the treetops
    (seen=True), the modelled wind at 10 m over the canopy is at least
    SEEN_MIN_KPH (3 km/h: tops seen moving steadily). A short test, or one
    whose canopy top is dead, prints the checks as diagnostics and NOT
    GRADEABLE, and says why. The ambient's ratio to the forecast's speed is
    printed as a note, not a refusal: HRDPS's 10 m wind is a 2.5 km cell's,
    over mostly higher ground, and a valley floor under an inversion is
    rightly far under it (TEACHER.md, the first full run).
"""

from __future__ import annotations

import argparse
import glob
import json
import math
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
OUT = ROOT / "pipeline" / "raw" / "teacher" / "palm" / "fields"
FILL = -9000.0  # PALM writes -9999 (or -999999) inside the ground

CHECKS = {
    "searchmont": {
        "stable": [
            # the 308 was the gusts; the mean floor wind was near calm (Gavan, 2026-10-12)
            dict(label="floor 17:33", lat=46.77744, lon=-84.04824, felt=308, level="Head", felt_is="gusts",
                 gate=dict(within=45, reversed=True, calm=True, patch_cells_m2=5000)),
            dict(label="treetops 18:24 (seen)", lat=46.77371, lon=-84.04476, felt=180, level="", seen=True,
                 gate=dict(within=45, reversed=False)),
        ],
        "neutral": [
            dict(label="floor 17:33", lat=46.77744, lon=-84.04824, felt=308, level="Head", felt_is="gusts", gate=None),
            dict(label="treetops 18:24 (seen)", lat=46.77371, lon=-84.04476, felt=180, level="", seen=True, gate=None),
        ],
        "convective": [
            dict(label="floor 10:58", lat=46.77327, lon=-84.04020, felt=249, level="Head", gate=dict(within=45, reversed=False)),
            dict(label="slope 268 m", lat=46.76752, lon=-84.04458, felt=236, level="Head", gate=None),
            dict(label="slope 290 m", lat=46.76672, lon=-84.04382, felt=180, level="Head", gate=None),
            dict(label="top 332 m", lat=46.76684, lon=-84.04131, felt=180, level="Head", gate=None, top=True),
            dict(label="top 363 m", lat=46.76689, lon=-84.03931, felt=237, level="Head", gate=None, top=True),
            dict(label="top 379 m", lat=46.76721, lon=-84.03861, felt=199, level="Head", gate=None, top=True),
            dict(label="top 384 m", lat=46.76709, lon=-84.03834, felt=299, level="Head", gate=None, top=True),
            dict(label="top 419 m", lat=46.76627, lon=-84.03590, felt=185, level="Head", gate=None, top=True),
        ],
    },
}
# WindNinja momentum at the midday top checks (WIND-LEARNING.md, First trial: 175-186 deg)
WINDNINJA_TOP_MEDIAN_MISS = 30.0
# a run is graded only when spun up (its averaging starts this late) and its treetops seen
# moving steadily are at least SEEN_MIN_KPH at 10 m over the canopy; else the checks are
# diagnostics. AMBIENT_FACTOR is a printed note now (the ambient over the forecast's
# speed), not a refusal: a floor under an inversion is rightly far under a 2.5 km cell's
# 10 m wind
MIN_SPINUP_S = 5400.0
SEEN_MIN_KPH = 3.0
AMBIENT_FACTOR = 1.5
# a floor whose mean wind is under this is calm ("generally 1.6 km/h, a few gusts")
CALM_KPH = 2.0


# ---------------------------------------------------------------- small things

def bearing_toward(u, v):
    return np.degrees(np.arctan2(u, v))


def from_deg(u, v):
    """Compass bearing the air comes FROM."""
    return (bearing_toward(u, v) + 180.0) % 360.0


def wrap180(a):
    return (np.asarray(a) + 180.0) % 360.0 - 180.0


def circ_mean(deg, axis=None, where=None) -> tuple:
    """The circular mean of directions (degrees) and their circular standard
    deviation (degrees, sqrt(-2 ln R)), unweighted; NaN (and ~where) skipped."""
    rad = np.radians(np.asarray(deg, np.float64))
    ok = np.isfinite(rad) if where is None else (where & np.isfinite(rad))
    n = ok.sum(axis=axis)
    s = np.where(ok, np.sin(rad), 0.0).sum(axis=axis)
    c = np.where(ok, np.cos(rad), 0.0).sum(axis=axis)
    with np.errstate(invalid="ignore", divide="ignore"):
        mean = np.degrees(np.arctan2(s, c)) % 360.0
        spread = np.degrees(np.sqrt(-2.0 * np.log(np.clip(np.hypot(s, c) / n, 1e-12, 1.0))))
    return np.where(n > 0, mean, np.nan), np.where(n > 0, spread, np.nan)


def pearson(a, b) -> float:
    a, b = np.asarray(a, np.float64).ravel(), np.asarray(b, np.float64).ravel()
    ok = np.isfinite(a) & np.isfinite(b)
    if ok.sum() < 3 or a[ok].std() == 0 or b[ok].std() == 0:
        return float("nan")
    return float(np.corrcoef(a[ok], b[ok])[0, 1])


def load_case(case: str, tag: str = "") -> tuple[dict, dict]:
    sfx = f"-{tag}" if tag else ""
    info = json.loads((HERE / case / f"case{sfx}.json").read_text(encoding="utf-8"))
    grid = dict(np.load(HERE / case / f"grid{sfx}.npz"))
    return info, grid


def find_one(folder: Path, pattern: str) -> Path | None:
    hits = sorted(glob.glob(str(folder / pattern)))
    return Path(hits[-1]) if hits else None


# ---------------------------------------------------------------- convert

def read_3d(path: Path, names: list[str]) -> tuple[dict, np.ndarray, float]:
    """The last averaged output: {name: (Z, R, C) row 0 SOUTH as PALM writes,
    NaN in the ground}, zu, and the time it ends."""
    from netCDF4 import Dataset
    out = {}
    with Dataset(path) as nc:
        nc.set_auto_mask(False)
        t = float(nc["time"][-1])
        zu = np.asarray(nc["zu_3d"][:], np.float64)
        for n in names:
            key = n if n in nc.variables else f"{n}_av" if f"{n}_av" in nc.variables else None
            if key is None:
                continue
            a = np.asarray(nc[key][-1], np.float64)
            a[(a < FILL) | ~np.isfinite(a)] = np.nan
            if a.shape[0] != zu.size:  # w on zw_3d: onto zu by the mean of the faces above and below
                a = 0.5 * (a[:-1] + a[1:]) if a.shape[0] == zu.size + 1 else a[: zu.size]
            out[n] = a
    return out, zu, t


def read_mask(path: Path) -> tuple[dict, np.ndarray, int]:
    """The masked samples: {name: (T, K, R, C) row 0 south}, the K levels over
    the ground (k = 1..4 grid levels), their times, and how many records were
    dropped as never written."""
    from netCDF4 import Dataset
    out = {}
    with Dataset(path) as nc:
        nc.set_auto_mask(False)
        times = np.asarray(nc["time"][:], np.float64)
        # PALM sizes the time axis for every planned sample; a run that stops writing
        # short leaves the rest as time 0 and all zeros (searchmont_stable: 18 of 60),
        # which would read as calm samples: keep the records while time increases
        nt = 1 if times.size and np.isfinite(times[0]) else 0
        while nt < times.size and np.isfinite(times[nt]) and times[nt] > times[nt - 1]:
            nt += 1
        dropped = int(times.size - nt)
        times = times[:nt]
        for n in ("u", "v", "w"):
            if n in nc.variables:
                a = np.asarray(nc[n][:nt], np.float64)
                a[(a < FILL) | ~np.isfinite(a)] = np.nan
                out[n] = a
    return out, times, dropped


def level_index(field: np.ndarray) -> np.ndarray:
    """Per column, the first level in the air (lowest non-NaN)."""
    ok = np.isfinite(field)
    k0 = np.argmax(ok, axis=0)
    k0[~ok.any(axis=0)] = -1
    return k0


def at_height(a: np.ndarray, zu: np.ndarray, k0: np.ndarray, dz0: float, z_agl: np.ndarray) -> np.ndarray:
    """a (Z, R, C) at z_agl (R, C) over the local ground, linear between the
    levels; below the first level in the air, the first level. The ground
    under column k0 is at zu[k0] - dz0/2."""
    Z, R, C = a.shape
    ground = zu[np.clip(k0, 0, Z - 1)] - dz0 / 2
    zt = ground + z_agl
    kk = np.clip(np.searchsorted(zu, zt) - 1, 0, Z - 2)
    kk = np.maximum(kk, k0)
    kk = np.minimum(kk, Z - 2)
    r, c = np.indices((R, C))
    z_lo, z_hi = zu[kk], zu[kk + 1]
    w = np.clip((zt - z_lo) / (z_hi - z_lo), 0.0, 1.0)
    lo, hi = a[kk, r, c], a[kk + 1, r, c]
    out = np.where(np.isfinite(hi), lo + w * (hi - lo), lo)
    out[k0 < 0] = np.nan
    return out


def convert_domain(args, info: dict, dom: dict, f3: Path, fm: Path | None, amb_root: tuple | None) -> tuple:
    """One domain's output (the root, or the nested child N02) as a field
    npz. dom: R, C, dx, bounds, centre, core_m, ring_m, dz0, grid, suffix.
    The child takes the root's ambient (amb_root): a 3 km box's own mean
    is not the approach flow."""
    run = args.run
    rinfo = info["runs"][run]
    R, C, dx, grid, dz0 = dom["R"], dom["C"], dom["dx"], dom["grid"], dom["dz0"]
    f, zu, t_end = read_3d(f3, ["u", "v", "w", "e", "theta"])
    for n in ("u", "v"):
        if f[n].shape[1:] != (R, C):
            raise SystemExit(f"{f3.name}: {n} is {f[n].shape[1:]}, the case is {(R, C)}: built with another dx?")
    # PALM writes row 0 south; the convention is row 0 north
    f = {n: a[:, ::-1, :] for n, a in f.items()}
    k0 = level_index(f["u"])
    canopy_h = grid["canopy_h"]
    z0 = grid["z0"]
    tall = canopy_h > 2.0

    lv = {}
    lv[""] = {n: at_height(f[n], zu, k0, dz0, canopy_h + 10.0) for n in ("u", "v", "e") if n in f}
    lv["10"] = {n: at_height(f[n], zu, k0, dz0, np.full((R, C), 10.0)) for n in ("u", "v", "e") if n in f}
    first = np.full((R, C), dz0 / 2)
    head = {n: at_height(f[n], zu, k0, dz0, first) for n in ("u", "v", "e") if n in f}
    # open ground: the log law from the first level down to 2 m on the cell's z0
    zf = dz0 / 2
    to2 = np.where(tall | (zf <= 2.0), 1.0, np.log(2.0 / z0) / np.log(zf / z0))
    head["u"], head["v"] = head["u"] * to2, head["v"] * to2
    lv["Head"] = head

    # ---- the ambient, three ways (the root), or the root's (a child)
    U, V = lv[""]["u"], lv[""]["v"]
    ring = np.zeros((R, C), bool)
    tw = int(dom["ring_m"] / dx)
    if tw > 0:
        ring[:] = True
        ring[tw:-tw, tw:-tw] = False
    gamma = info["gridConvergenceDeg"]
    if amb_root is None:
        k_aloft = int(np.argmin(np.abs(zu - 600.0)))
        amb = {
            "domain": (np.nanmean(U), np.nanmean(V)),
            "ring": (np.nanmean(U[ring]), np.nanmean(V[ring])),
            "aloft:600": (np.nanmean(f["u"][k_aloft]), np.nanmean(f["v"][k_aloft])),
        }
        choice = args.ambient if args.ambient in amb else "domain"
        if args.ambient.startswith("aloft:") and args.ambient not in amb:
            k = int(np.argmin(np.abs(zu - float(args.ambient.split(":")[1]))))
            amb[args.ambient] = (np.nanmean(f["u"][k]), np.nanmean(f["v"][k]))
            choice = args.ambient
    else:
        amb, choice = amb_root
    au, av = amb[choice]
    a_speed = math.hypot(au, av)
    a_from_grid = float(from_deg(au, av))
    a_from_true = (a_from_grid + gamma) % 360.0

    arrays = dict(dem=grid["dem"].astype(np.float32), directions=np.array([a_from_true], np.float32),
                  ambientKph=np.array(a_speed * 3.6, np.float64))
    for key, d in lv.items():
        arrays[f"u{key}"] = (d["u"] / a_speed)[None].astype(np.float32)
        arrays[f"v{key}"] = (d["v"] / a_speed)[None].astype(np.float32)
        sgs = (2.0 / 3.0) * np.maximum(d.get("e", np.zeros((R, C))), 0.0)
        arrays[f"turb{key}"] = (np.sqrt(sgs) / a_speed)[None].astype(np.float32)

    # ---- gusts and lulls at head height from the masked samples
    mask_note = "none"
    if fm is not None:
        m, times, dropped = read_mask(fm)
        mu, mv = m["u"][:, 0, ::-1, :], m["v"][:, 0, ::-1, :]  # k = 1: the first level over the ground
        if mu.shape[1:] == (R, C):
            mu, mv = mu * to2, mv * to2
            sp = np.hypot(mu, mv)
            arrays["gustHead"] = (np.nanpercentile(sp, 90, axis=0) / a_speed)[None].astype(np.float32)
            arrays["lullHead"] = (np.nanpercentile(sp, 10, axis=0) / a_speed)[None].astype(np.float32)
            turn = wrap180(bearing_toward(mu, mv) - bearing_toward(au, av))
            arrays["reversedHead"] = np.nanmean(np.abs(turn) > 90.0, axis=0)[None].astype(np.float32)
            # the gusty moments: where the top quartile of speed comes FROM (true), and how spread
            top = sp >= np.nanpercentile(sp, 75, axis=0)[None]
            g_from, g_spread = circ_mean((from_deg(mu, mv) + gamma) % 360.0, axis=0, where=top)
            arrays["gustFromHead"] = g_from[None].astype(np.float32)
            arrays["gustSpreadHead"] = g_spread[None].astype(np.float32)
            res = 0.5 * (np.nanvar(mu, axis=0) + np.nanvar(mv, axis=0))
            arrays["turbHead"] = (np.sqrt(res + (arrays["turbHead"][0] * a_speed) ** 2) / a_speed)[None].astype(np.float32)
            # the canopy-top level's resolved part: the masked level nearest canopy + 10 m
            kk = np.clip(np.round((canopy_h + 10.0) / dz0 + 0.5).astype(int) - 1, 0, m["u"].shape[1] - 1)
            r, c = np.indices((R, C))
            uu, vv = m["u"][:, :, ::-1, :][:, kk, r, c], m["v"][:, :, ::-1, :][:, kk, r, c]
            res_top = 0.5 * (np.nanvar(uu, axis=0) + np.nanvar(vv, axis=0))
            arrays["turb"] = (np.sqrt(res_top + (arrays["turb"][0] * a_speed) ** 2) / a_speed)[None].astype(np.float32)
            mask_note = f"{fm.name}: {len(times)} samples, {times[0]:.0f}-{times[-1]:.0f} s"
            if dropped:
                mask_note += f" ({dropped} unwritten records dropped)"
        else:
            mask_note = f"{fm.name}: shape {mu.shape[1:]} is not the case's; skipped"

    # ---- where the field is sound: the core, off the taper (root) or the nest's edge (child)
    cx, cy = dom["centre"]
    x0, y0, x1, y1 = dom["bounds"]
    xs = x0 + (np.arange(C) + 0.5) * dx
    ys = y1 - (np.arange(R) + 0.5) * dx
    X, Y = np.meshgrid(xs, ys)
    half = dom["core_m"] / 2
    arrays["core"] = (np.abs(X - cx) < half) & (np.abs(Y - cy) < half)
    edge = np.zeros((R, C), bool)
    if dom["suffix"]:
        e = 8  # the child's boundary cells take the root's flow
        edge[:] = True
        edge[e:-e, e:-e] = False
    arrays["valid"] = np.isfinite(arrays["u"][0]) & np.isfinite(arrays["uHead"][0]) & ~ring & ~edge

    meta = dict(
        source="PALM", case=args.case, run=run, domain=dom["suffix"] or "root", stability=rinfo["stability"],
        epsg=info["epsg"], bounds=dom["bounds"], cell=dx, rows=R, cols=C, gridConvergenceDeg=gamma,
        forecast=dict(fromTrue=rinfo["direction"], kph=rinfo["speed_kph"]),
        ambient=dict(used=choice + (" (the root's)" if amb_root else ""), speedMs=a_speed, speedKph=a_speed * 3.6,
                     fromGrid=a_from_grid, fromTrue=a_from_true,
                     all={k: dict(speedMs=math.hypot(*v), fromTrue=(float(from_deg(*v)) + gamma) % 360.0) for k, v in amb.items()}),
        levels={"u,v": "10 m over the canopy top (10 m over the ground in the open): WindNinja's output height",
                "u10,v10": "10 m over the ground",
                "uHead,vHead": f"first level over the ground ({dz0 / 2:g} m), to 2 m by the log law in the open"},
        # the averaging build_case.py set: the run's, or half a short test
        averaged_until_s=t_end, average_s=min(rinfo["average_s"], t_end / 2), files=dict(av3d=f3.name, mask=mask_note),
    )
    arrays["meta"] = np.array(json.dumps(meta))
    OUT.mkdir(parents=True, exist_ok=True)
    out = OUT / f"{run}{('_' + dom['suffix']) if dom['suffix'] else ''}.npz"
    np.savez_compressed(out, **arrays)
    al = meta["ambient"]["all"]
    print(f"{out.stem}: ambient ({meta['ambient']['used']}) from {a_from_true:.0f} true at {a_speed * 3.6:.1f} km/h "
          f"[{', '.join(f'{k} {v['fromTrue']:.0f}/{v['speedMs'] * 3.6:.1f}' for k, v in al.items())} km/h]; "
          f"valid {arrays['valid'].mean():.0%}; masked: {mask_note}")
    print(f"  -> {out}")
    return amb, choice


def convert(args) -> None:
    info, grid = load_case(args.case, args.tag)
    run = args.run
    folder = Path(args.output) if args.output else HERE / args.case / "JOBS" / run / "OUTPUT"
    f3 = find_one(folder, f"{run}_av_3d.*.nc") or find_one(folder, f"{run}_av_3d.nc")
    if f3 is None:
        raise SystemExit(f"no {run}_av_3d*.nc in {folder}: has the run finished, and copied its OUTPUT back?")
    # PALM names masks M001 (three digits); a nested child's files carry N02
    fm = next((Path(q) for q in sorted(glob.glob(str(folder / f"{run}_masked_M0*.nc"))) if "N02" not in q), None)
    root = dict(R=info["ny"], C=info["nx"], dx=info["dx"], bounds=info["bounds"], centre=info["centre"],
                core_m=info["core_m"], ring_m=info["taper_m"], dz0=float(info["vertical"]["dz"][0]), grid=grid, suffix="")
    amb = convert_domain(args, info, root, f3, fm, None)
    nest = info.get("nest")
    f3c = find_one(folder, f"{run}_av_3d_N02*.nc")
    if nest and f3c is not None:
        sfx = f"-{args.tag}" if args.tag else ""
        child = dict(R=nest["ny"], C=nest["nx"], dx=nest["dx"], bounds=nest["bounds"], centre=nest["centre"],
                     core_m=nest["bounds"][2] - nest["bounds"][0], ring_m=0.0, dz0=float(nest["vertical"]["dz"][0]),
                     grid=dict(np.load(HERE / args.case / f"grid{sfx}-N02.npz")), suffix="N02")
        convert_domain(args, info, child, f3c, find_one(folder, f"{run}_masked*N02*.nc"), amb)
    elif nest:
        print(f"  (no {run}_av_3d_N02 output: the nested child was not converted)")


# ---------------------------------------------------------------- score

def load_field(run: str) -> dict:
    z = np.load(OUT / f"{run}.npz", allow_pickle=False)
    d = {k: z[k] for k in z.files if k != "meta"}
    d["meta"] = json.loads(str(z["meta"]))
    return d


def cell_of(meta: dict, lat: float, lon: float) -> tuple[int, int]:
    from pyproj import Transformer
    x, y = Transformer.from_crs(4326, meta["epsg"], always_xy=True).transform(lon, lat)
    x0, y0, x1, y1 = meta["bounds"]
    return int((y1 - y) // meta["cell"]), int((x - x0) // meta["cell"])


def call_at(fd: dict, level: str, r: int, c: int) -> dict:
    """The call at a cell, FROM true, and the 3 x 3's median direction."""
    m = fd["meta"]
    u, v = fd[f"u{level}"][0], fd[f"v{level}"][0]
    g = m["gridConvergenceDeg"]
    amb_toward = (m["ambient"]["fromGrid"] + 180.0) % 360.0
    fr = (float(from_deg(u[r, c], v[r, c])) + g) % 360.0
    uu, vv = u[r - 1:r + 2, c - 1:c + 2], v[r - 1:r + 2, c - 1:c + 2]
    dirs = (from_deg(uu, vv) + g) % 360.0
    ref = fr
    med = (ref + float(np.median(wrap180(dirs - ref)))) % 360.0
    turn = float(wrap180(bearing_toward(u[r, c], v[r, c]) - amb_toward))
    turn9 = float(np.median(np.abs(wrap180(bearing_toward(uu, vv) - amb_toward))))
    return dict(fromTrue=fr, from3x3=med, speed=float(math.hypot(u[r, c], v[r, c])), turn=turn, turn3x3=turn9)


def gusts_at(fd: dict, r: int, c: int, amb_kph: float) -> dict:
    """The floor's gusts at a cell, in km/h: gustHead and lullHead at the cell,
    where the gusts come from (the 3 x 3's circular mean of gustFromHead, and
    the cell's), their spread at the cell, and the share of the time reversed."""
    out = {}
    if "gustHead" in fd:
        out["gustKph"] = float(fd["gustHead"][0, r, c]) * amb_kph
        out["lullKph"] = float(fd["lullHead"][0, r, c]) * amb_kph
        out["reversedShare"] = float(fd["reversedHead"][0, r, c])
    if "gustFromHead" in fd:
        g9, _ = circ_mean(fd["gustFromHead"][0, r - 1:r + 2, c - 1:c + 2])
        out["gustFrom"] = float(g9)
        out["gustFromCell"] = float(fd["gustFromHead"][0, r, c])
        out["gustSpread"] = float(fd["gustSpreadHead"][0, r, c])
    return out


def is_seen(ck: dict) -> bool:
    """A check seen at the treetops (its tops seen moving), not felt at the floor."""
    return bool(ck.get("seen")) or (ck["level"] == "" and "seen" in ck["label"])


def reversed_patch(fd: dict, level: str, r: int, c: int) -> int:
    """Cells in the connected patch turned more than 90 deg from the ambient that holds (r, c)."""
    from scipy.ndimage import label
    m = fd["meta"]
    amb_toward = (m["ambient"]["fromGrid"] + 180.0) % 360.0
    rev = np.abs(wrap180(bearing_toward(fd[f"u{level}"][0], fd[f"v{level}"][0]) - amb_toward)) > 90.0
    lab, _ = label(rev)
    return int((lab == lab[r, c]).sum()) if rev[r, c] else 0


def vs_windninja(fd: dict, wn_dir: Path) -> dict:
    """The run (10 m over the canopy) against WindNinja's 10 m output over the
    core, in eval.py's terms, both as turns from their own ambient."""
    import rasterio
    from rasterio.warp import Resampling, reproject
    from rasterio.transform import from_origin
    m = fd["meta"]
    uf = sorted(glob.glob(str(wn_dir / "*_u.asc")))
    vf = sorted(glob.glob(str(wn_dir / "*_v.asc")))
    if not (uf and vf):
        raise SystemExit(f"no *_u.asc / *_v.asc in {wn_dir}")
    R, C = m["rows"], m["cols"]
    dst_tr = from_origin(m["bounds"][0], m["bounds"][3], m["cell"], m["cell"])
    wn = {}
    for key, fpath in (("u", uf[0]), ("v", vf[0])):
        with rasterio.open(fpath) as src:
            a = np.full((R, C), np.nan, np.float32)
            reproject(src.read(1).astype(np.float32), a, src_transform=src.transform, src_crs=src.crs or f"EPSG:{m['epsg']}",
                      dst_transform=dst_tr, dst_crs=f"EPSG:{m['epsg']}", resampling=Resampling.bilinear,
                      src_nodata=src.nodata, dst_nodata=np.nan)
            wn[key] = a
    # WindNinja's ambient: its input, turned onto the grid (fields.py: from d true = from d - gamma)
    cfg = (wn_dir / "run.cfg").read_text() if (wn_dir / "run.cfg").exists() else ""
    import re
    d_in = float(re.search(r"input_direction\s*=\s*([\d.]+)", cfg).group(1)) if cfg else m["forecast"]["fromTrue"]
    s_in = float(re.search(r"input_speed\s*=\s*([\d.]+)", cfg).group(1)) if cfg else m["forecast"]["kph"]
    wn_toward = (d_in - m["gridConvergenceDeg"] + 180.0) % 360.0
    pa_toward = (m["ambient"]["fromGrid"] + 180.0) % 360.0
    sel = fd["core"] & fd["valid"] & np.isfinite(wn["u"]) & np.isfinite(wn["v"])
    tp = wrap180(bearing_toward(fd["u"][0], fd["v"][0]) - pa_toward)[sel]
    tt = wrap180(bearing_toward(wn["u"], wn["v"]) - wn_toward)[sel]
    sp = np.hypot(fd["u"][0], fd["v"][0])[sel]
    st = (np.hypot(wn["u"], wn["v"]) / s_in)[sel]
    err = np.abs(wrap180(tp - tt))
    return dict(cells=int(sel.sum()), turn_mae=float(err.mean()), turn_median=float(np.median(err)),
                within22=float((err <= 22.5).mean()), turn_r=pearson(tp, tt), speed_r=pearson(sp, st),
                speed_bias=float(np.mean(sp - st)), windninja=str(wn_dir), wn_input=(d_in, s_in))


def score(args) -> None:
    info, _ = load_case(args.case, args.tag)
    checks = CHECKS.get(args.case, {})
    report = {}
    # each run's root field, and its nested child's (finer, over the core) when converted
    fields = []
    for r in info["runs"]:
        if not (OUT / f"{r}.npz").exists():
            print(f"{r}: not converted (palm_to_fields.py convert {args.case} {r})")
            continue
        fields.append(r)
        if (OUT / f"{r}_N02.npz").exists():
            fields.append(f"{r}_N02")
    for run in fields:
        fd = load_field(run)
        m = fd["meta"]
        st = m["stability"]
        amb_kph = float(fd["ambientKph"]) if "ambientKph" in fd else float(m["ambient"]["speedKph"])
        ratio = amb_kph / max(m["forecast"]["kph"], 1e-6)
        print(f"\n{run} ({st}): ambient from {m['ambient']['fromTrue']:.0f} true at {amb_kph:.1f} km/h "
              f"({m['ambient']['used']}); forecast {m['forecast']['fromTrue']:g} at {m['forecast']['kph']:g}")
        rows, gate_ok, top_miss, seen_low = [], [], [], []
        for ck in checks.get(st, []):
            r, c = cell_of(m, ck["lat"], ck["lon"])
            call = call_at(fd, ck["level"], r, c)
            miss = abs(float(wrap180(call["fromTrue"] - ck["felt"])))
            miss9 = abs(float(wrap180(call["from3x3"] - ck["felt"])))
            kph = call["speed"] * amb_kph
            floor = ck["level"] == "Head"
            seen = is_seen(ck)
            felt_is = ck.get("felt_is", "mean")
            row = dict(check=ck["label"], felt=ck["felt"], level="head" if floor else "canopy+10", **call,
                       speedKph=kph, miss=miss, miss3x3=miss9)
            gate = ck.get("gate")
            verdict = {}
            if floor:
                gu = gusts_at(fd, r, c, amb_kph)
                row.update(feltIs=felt_is, **gu)
                line = (f"  {ck['label']:22} felt {ck['felt']:3} ({felt_is})   mean {kph:.1f} km/h from {call['fromTrue']:3.0f} "
                        f"(3x3 {call['from3x3']:3.0f}), miss {miss:3.0f} ({miss9:3.0f}), turn {call['turn']:+4.0f}")
                gmiss = None
                if "gustFrom" in gu:
                    gmiss = abs(float(wrap180(gu["gustFrom"] - ck["felt"])))
                    row["gustMiss"] = gmiss
                    line += (f" | gusts {gu['gustKph']:.1f} km/h from {gu['gustFrom']:3.0f} (spread {gu['gustSpread']:.0f}), "
                             f"miss {gmiss:3.0f}")
                elif "gustKph" in gu:
                    line += f" | gusts {gu['gustKph']:.1f} km/h (no gustFromHead: reconvert)"
                if "reversedShare" in gu:
                    line += f" | reversed {gu['reversedShare']:.0%}"
                # the felt direction is scored on what was felt: the gusts', or the mean's
                scored_miss = gmiss if felt_is == "gusts" else miss
                if gate:
                    if gate.get("calm"):
                        verdict["calm"] = kph < CALM_KPH
                    if felt_is == "gusts":
                        verdict["direction"] = gmiss is not None and gmiss <= gate["within"]
                    else:
                        verdict["direction"] = miss <= gate["within"] and miss9 <= gate["within"]
            else:
                line = (f"  {ck['label']:22} felt {ck['felt']:3}   canopy+10 {kph:.1f} km/h from {call['fromTrue']:3.0f} "
                        f"(3x3 {call['from3x3']:3.0f}), miss {miss:3.0f} ({miss9:3.0f}), turn {call['turn']:+4.0f}")
                scored_miss = miss
                if gate:
                    verdict["direction"] = miss <= gate["within"] and miss9 <= gate["within"]
            if gate:
                rev = abs(call["turn"]) > 90 and call["turn3x3"] > 90
                verdict["reversed" if gate["reversed"] else "not reversed"] = rev if gate["reversed"] else not rev
                if gate.get("patch_cells_m2"):
                    n = reversed_patch(fd, ck["level"], r, c)
                    row["reversedPatchHa"] = n * m["cell"] ** 2 / 1e4
                    verdict[f"patch {row['reversedPatchHa']:.2f} ha"] = n >= gate["patch_cells_m2"] / m["cell"] ** 2
                ok = all(verdict.values())
                gate_ok.append(ok)
                line += " | " + ", ".join(f"{k} {'PASS' if v else 'FAIL'}" for k, v in verdict.items())
                row["verdict"] = {k.split(" ")[0] if k.startswith("patch") else k: v for k, v in verdict.items()}
                row["pass"] = ok
            if seen:
                moving = kph >= SEEN_MIN_KPH
                row.update(seen=True, seenMoving=moving, seenMinKph=SEEN_MIN_KPH)
                line += f" | seen-moving: {'PASS' if moving else 'FAIL'} (needs {SEEN_MIN_KPH:g} km/h)"
                if not moving:
                    seen_low.append(f"{ck['label']} is {kph:.1f} km/h at 10 m over the canopy, under the {SEEN_MIN_KPH:g} km/h "
                                    f"of tops seen moving steadily")
            if ck.get("top"):
                top_miss.append(scored_miss)
            print(line)
            rows.append(row)
        if top_miss:
            med = float(np.median(top_miss))
            ok = med <= WINDNINJA_TOP_MEDIAN_MISS
            gate_ok.append(ok)
            print(f"  the top, 5 checks: median miss {med:.0f} deg against WindNinja's {WINDNINJA_TOP_MEDIAN_MISS:.0f}  {'PASS' if ok else 'fail'}")
        res = dict(checks=rows, ambientKph=amb_kph, ambientOverForecast=ratio)
        # a note, not a refusal: the forecast is a 2.5 km cell's 10 m wind over mostly higher ground
        print(f"  note: the ambient {amb_kph:.1f} km/h is {ratio:.2f}x the forecast's {m['forecast']['kph']:g}"
              f"{'' if 1 / AMBIENT_FACTOR <= ratio <= AMBIENT_FACTOR else f' (outside {AMBIENT_FACTOR:g}x)'}; "
              f"not a refusal (a 2.5 km cell's 10 m wind, mostly higher ground)")
        if gate_ok:
            # gradeable only when spun up (a 6 min test once "passed") and with its seen
            # treetops moving: a dead canopy top makes the floor's reading meaningless
            began = m.get("averaged_until_s", 0) - m.get("average_s", 0)
            spun = began >= MIN_SPINUP_S
            why = ([] if spun else [f"averaging began at {began:.0f} s, under {MIN_SPINUP_S:.0f} s of spin-up"]) + seen_low
            res["gradeable"] = dict(spunUp=spun, seenMoving=not seen_low, why=why)
            if not why:
                res["gate"] = all(gate_ok)
                print(f"  gate: {'PASS' if res['gate'] else 'FAIL'}")
            else:
                res["gate"] = None
                print(f"  gate: NOT GRADEABLE ({'; '.join(why)}); the checks above are diagnostics only")
        if args.windninja:
            w = vs_windninja(fd, Path(args.windninja))
            res["vsWindNinja"] = w
            print(f"  against WindNinja ({Path(w['windninja']).name}, {w['cells']} core cells): turn MAE {w['turn_mae']:.1f}, "
                  f"median {w['turn_median']:.1f}, within 22.5 {w['within22']:.0%}, turn r {w['turn_r']:.2f}, "
                  f"speed r {w['speed_r']:.2f}, bias {w['speed_bias']:+.2f}")
        report[run] = res
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"score-{args.case}.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
    print(f"\n-> {OUT / f'score-{args.case}.json'}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("convert")
    a.add_argument("case"); a.add_argument("run")
    a.add_argument("--output", help="the run's OUTPUT folder (default the case's JOBS/<run>/OUTPUT)")
    a.add_argument("--ambient", default="domain", help="domain | ring | aloft:<m over the lowest ground>")
    a.add_argument("--tag", default="")
    b = sub.add_parser("score")
    b.add_argument("case")
    b.add_argument("--windninja", help="a WindNinja run folder (*_u.asc, *_v.asc, run.cfg) on the same ground")
    b.add_argument("--tag", default="")
    args = ap.parse_args()
    convert(args) if args.cmd == "convert" else score(args)


if __name__ == "__main__":
    main()
