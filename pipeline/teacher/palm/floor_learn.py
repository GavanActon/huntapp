r"""A PALM-taught floor: what the head-height wind does under the wind above, learned from the PALM runs
already banked, with inputs an SD tile has (huntapp-jay, 2026-10-17; Gavan: "Yes").

The app's floor rules (model.ts: the towers' share, edges, the slot, the lee, drainage) turn the terrain
layer's 10 m wind into the wind at a hunter's nose. The scent card's misses and palm_compare's worst
classes (water and forest in a lee, stable and convective air) are all floor direction. This script asks
how much of that a small tabular model can learn from the 4 m PALM fields, with features that exist in
every national tile (canopy height, cover, water, the DEM's slope and shelter, the forcing), and
scores it held out by box (leave one box out), against "follow the wind above" and, where the loop's
palm_compare table has a point, the app's own call.

  py -3.14 pipeline/teacher/palm/floor_learn.py build        # windows table -> pipeline/raw/teacher/palm/floor/windows.npz
  py -3.14 pipeline/teacher/palm/floor_learn.py train        # leave-one-box-out LightGBM, the scoreboard
  py -3.14 pipeline/teacher/palm/floor_learn.py train --app pipeline/raw/teacher/palm/loop/wind-2026-10-16.csv

Targets at each 20 m window (5 x 5 cells of 4 m, core and valid): the head-height turn from the wind 10 m
over the canopy (PALM's u, v: WindNinja's output height, the terrain layer's own level), the head/top
speed share, the still share (head under 0.5 km/h) and the reversed share.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import sys
from pathlib import Path

import numpy as np
from scipy import ndimage as ndi

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
FIELDS = ROOT / "pipeline" / "raw" / "teacher" / "palm" / "fields"
OUT = ROOT / "pipeline" / "raw" / "teacher" / "palm" / "floor"
WIN = 5                      # cells per window side (20 m at 4 m)
STILL_MS = 0.5 / 3.6         # the still threshold, 0.5 km/h
FEATURES = ["canopy_h", "cover", "lai", "water", "canopy_sd", "forest", "slope", "downwind_slope", "cross_slope",
            "sx300", "sx100", "relief100", "edge_dist", "fetch_open", "fetch_forest", "top_share", "top_turn",
            "fall_rel_sin", "fall_rel_cos", "stable", "convective", "forcing_kph", "ambient_kph",
            "lad_0_2", "lad_2_6", "lad_6_14", "lad_14_up", "lad_sum", "t_cool"]


def runs_unique() -> list[str]:
    """One 4 m run per case and wind: the plain run where there is one, else the first rerun."""
    keep: dict[str, str] = {}
    for f in sorted(FIELDS.glob("*.npz")):
        n = f.stem
        if n.endswith(("_particles", "_appcone")) or "_scent_" in n or n.startswith("searchmont"):
            continue
        parts = n.split("_")
        if len(parts) < 3 or parts[2] != "4m":
            continue
        try:
            if "meta" not in np.load(f, allow_pickle=True).files:
                continue
        except (OSError, ValueError):
            continue
        key = "_".join(parts[:3])
        if key not in keep or n == key:
            keep[key] = n
    return sorted(keep.values())


def case_grid(run: str) -> tuple[str, dict, dict]:
    case, tag = run.split("_")[0], run.split("_")[2]
    info = json.loads((HERE / case / f"case-{tag}.json").read_text(encoding="utf-8"))
    grid = dict(np.load(HERE / case / f"grid-{tag}.npz"))
    return case, info, grid


def lad_profile(case: str, run: str, tag: str) -> dict[str, np.ndarray] | None:
    """The canopy's leaf-area density by layer from the run's PALM static driver (lad on zlad: 0, 2, 6, 10, 14 ... m),
    summed into head height (0-2), the trunk space and understory (2-6), the mid canopy (6-14) and the crowns above
    (14+); row 0 north. HD's own input (the 1 m CHM and the FRI/CHM crowns), not an SD tile's."""
    from netCDF4 import Dataset
    run_key = "_".join(run.split("_")[:3])
    for cand in (run_key, run):
        f = HERE / case / "JOBS" / cand / "INPUT" / f"{cand}_static"
        if f.exists():
            break
    else:
        return None
    with Dataset(f) as nc:
        nc.set_auto_mask(False)
        z = np.asarray(nc["zlad"][:], np.float64)
        lad = np.asarray(nc["lad"][:], np.float64)   # (z, y, x), PALM's south row first
    lad[lad < 0] = 0.0
    lad = lad[:, ::-1, :]
    dz = np.diff(np.append(z, z[-1] + 4.0))
    def band(lo, hi):
        sel = (z >= lo) & (z < hi)
        return np.einsum("k,kij->ij", dz[sel], lad[sel]) if sel.any() else np.zeros(lad.shape[1:])
    return {"lad_0_2": band(0, 2), "lad_2_6": band(2, 6), "lad_6_14": band(6, 14), "lad_14_up": band(14, 99), "lad_sum": band(0, 99)}


def shelter_angle(dem: np.ndarray, dx: float, from_grid_deg: float, dmax: float) -> np.ndarray:
    """The steepest rise within dmax upwind, degrees (Winstral's Sx; as app/scripts/palm_compare.py), row 0 north."""
    b = math.radians(from_grid_deg)
    out = np.full(dem.shape, -90.0)
    for k in range(1, int(dmax / dx) + 1):
        dc, dr = math.sin(b) * k, -math.cos(b) * k
        zz = ndi.shift(dem, (-dr, -dc), order=1, mode="nearest")
        out = np.maximum(out, np.degrees(np.arctan2(zz - dem, k * dx)))
    return out


def fetch_along(mask: np.ndarray, dx: float, from_grid_deg: float, dmax: float) -> np.ndarray:
    """Distance upwind to the first cell where mask is true, m (dmax where none), row 0 north."""
    b = math.radians(from_grid_deg)
    out = np.full(mask.shape, dmax, np.float32)
    found = np.zeros(mask.shape, bool)
    for k in range(1, int(dmax / dx) + 1):
        dc, dr = math.sin(b) * k, -math.cos(b) * k
        m = ndi.shift(mask.astype(np.float32), (-dr, -dc), order=0, mode="nearest") > 0.5
        hit = m & ~found
        out[hit] = k * dx
        found |= m
    return out


def pool(a: np.ndarray, how: str = "mean") -> np.ndarray:
    """Windows of WIN x WIN cells (the last partial row and column dropped)."""
    r, c = (a.shape[0] // WIN) * WIN, (a.shape[1] // WIN) * WIN
    b = a[:r, :c].reshape(r // WIN, WIN, c // WIN, WIN)
    if how == "mean":
        return b.mean(axis=(1, 3))
    if how == "std":
        return b.std(axis=(1, 3))
    raise ValueError(how)


def wrap(deg: np.ndarray) -> np.ndarray:
    return (deg + 180.0) % 360.0 - 180.0


def circ_mean(deg: np.ndarray, ok: np.ndarray, n_ok: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """The windows' circular mean of an angle and its coherence (1 = the cells agree)."""
    s = pool(np.where(ok, np.sin(np.radians(deg)), 0.0))
    c = pool(np.where(ok, np.cos(np.radians(deg)), 0.0))
    return np.degrees(np.arctan2(s, c)), np.hypot(s, c) / np.maximum(n_ok, 1e-6)


def build() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    rows, meta_rows = [], []
    items = [(run, FIELDS / f"{run}.npz") for run in runs_unique()]
    # the dusk series: each window a row set with the clock (t_cool, minutes since the cooling began)
    items += [(f.stem, f) for f in sorted((FIELDS / "series").glob("*_4m_*min.npz"))]
    lad_cache: dict[str, dict | None] = {}
    for run, path in items:
        base_run = "_".join(run.split("_")[:3])
        case, info, grid = case_grid(base_run)
        d = np.load(path, allow_pickle=True)
        m = json.loads(str(d["meta"]))
        series = run.endswith("min") and run != base_run
        t_cool = (float(m.get("averaged_until_s", 0)) / 60.0 - 20.0) if series else 0.0   # the series cool from 20 min in
        if case not in lad_cache:
            lad_cache[case] = lad_profile(case, base_run, "4m")
        lad = lad_cache[case]
        dx = float(m["cell"])
        if grid["dem"].shape != d["dem"].shape:
            print(f"  {run}: grid {grid['dem'].shape} against fields {d['dem'].shape}, skipped")
            continue
        gam = float(m.get("gridConvergenceDeg", 0.0))
        from_true = float(m["forecast"]["fromTrue"])
        from_grid = from_true - gam
        amb_ms = float(m["ambient"]["speedMs"])
        # the wind's unit vector in grid axes, blowing toward (u east, v north)
        tw = math.radians(from_grid + 180.0)
        wx, wy = math.sin(tw), math.cos(tw)
        dem = grid["dem_model"].astype(np.float64)
        # slope and its parts along and across the wind (row 0 north, so d/dy flips sign)
        gy, gx = np.gradient(dem, dx)
        gy = -gy
        slope = np.degrees(np.arctan(np.hypot(gx, gy)))
        downwind = -(gx * wx + gy * wy)          # positive where the wind blows downslope
        cross = np.abs(-gx * wy + gy * wx)
        # the fall line (downhill, where cold air drains) relative to the wind's own direction: a signed angle,
        # so a stable floor can learn "turn toward the fall line" (-180..180, as sin and cos)
        fall_dir = np.degrees(np.arctan2(-gx, -gy))             # toward, grid axes, clockwise from north
        fall_rel = np.radians(wrap(fall_dir - (from_grid + 180.0)))
        fall_w = np.clip(np.hypot(gx, gy) / 0.05, 0.0, 1.0)      # flat ground has no fall line: fade the signal under 5%
        canopy_h = grid["canopy_h"].astype(np.float64)
        cover = grid["cover"].astype(np.float64)
        lai = grid["lai"].astype(np.float64)
        water = grid["water"].astype(np.float64)
        forest = (cover > 0.5) & (canopy_h >= 3.0)
        d_in = ndi.distance_transform_edt(forest) * dx
        d_out = ndi.distance_transform_edt(~forest) * dx
        edge_dist = np.where(forest, -d_in, d_out)   # negative inside the forest
        sx300 = shelter_angle(dem, dx, from_grid, 300.0)
        sx100 = shelter_angle(dem, dx, from_grid, 100.0)
        k200 = int(200 / dx) + 1
        relief100 = ndi.maximum_filter(dem, size=k200) - ndi.minimum_filter(dem, size=k200)
        fetch_open = fetch_along(~forest, dx, from_grid, 300.0)
        fetch_forest = fetch_along(forest, dx, from_grid, 300.0)
        u, v = d["u"][0].astype(np.float64), d["v"][0].astype(np.float64)
        uh, vh = d["uHead"][0].astype(np.float64), d["vHead"][0].astype(np.float64)
        top_sp, head_sp = np.hypot(u, v), np.hypot(uh, vh)
        top_dir = np.degrees(np.arctan2(u, v))        # toward, grid axes, clockwise from north
        head_dir = np.degrees(np.arctan2(uh, vh))
        top_turn = wrap(top_dir - (from_grid + 180.0))
        turn = wrap(head_dir - top_dir)
        ok = d["valid"] & d["core"] & np.isfinite(turn) & (top_sp > 0.05)
        n_ok = pool(ok.astype(np.float64))
        w_turn, w_coh = circ_mean(turn, ok, n_ok)
        w_top_turn, _ = circ_mean(top_turn, ok, n_ok)
        share = pool(np.where(ok, head_sp / np.maximum(top_sp, 0.05), 0.0)) / np.maximum(n_ok, 1e-6)
        still = pool(np.where(ok, (head_sp < STILL_MS).astype(np.float64), 0.0)) / np.maximum(n_ok, 1e-6)
        rev = pool(np.where(ok, d["reversedHead"][0].astype(np.float64), 0.0)) / np.maximum(n_ok, 1e-6)
        top_share = pool(np.where(ok, top_sp / amb_ms, 0.0)) / np.maximum(n_ok, 1e-6)
        keep = n_ok >= 0.8
        feats = dict(
            canopy_h=pool(canopy_h), cover=pool(cover), lai=pool(lai), water=pool(water), canopy_sd=pool(canopy_h, "std"),
            forest=pool(forest.astype(np.float64)), slope=pool(slope), downwind_slope=pool(downwind), cross_slope=pool(cross),
            sx300=pool(sx300), sx100=pool(sx100), relief100=pool(relief100), edge_dist=pool(edge_dist),
            fetch_open=pool(fetch_open), fetch_forest=pool(fetch_forest), top_share=top_share, top_turn=w_top_turn,
            fall_rel_sin=pool(np.sin(fall_rel) * fall_w), fall_rel_cos=pool(np.cos(fall_rel) * fall_w),
            stable=np.full(keep.shape, float(m["stability"] == "stable")),
            convective=np.full(keep.shape, float(m["stability"] == "convective")),
            forcing_kph=np.full(keep.shape, float(m["forecast"]["kph"])),
            ambient_kph=np.full(keep.shape, amb_ms * 3.6),
            t_cool=np.full(keep.shape, t_cool),
        )
        for k in ("lad_0_2", "lad_2_6", "lad_6_14", "lad_14_up", "lad_sum"):
            feats[k] = pool(lad[k]) if lad else np.full(keep.shape, np.nan)
        X = np.stack([feats[k][keep] for k in FEATURES], axis=1).astype(np.float32)
        Y = np.stack([w_turn[keep], w_coh[keep], share[keep], still[keep], rev[keep]], axis=1).astype(np.float32)
        rr, cc = np.nonzero(keep)
        x0, y0, x1, y1 = m["bounds"]
        xm = x0 + (cc * WIN + WIN / 2) * dx
        ym = y1 - (rr * WIN + WIN / 2) * dx
        rows.append((X, Y, np.stack([xm, ym], axis=1).astype(np.float64), np.full(len(rr), run, dtype=object)))
        meta_rows.append(dict(run=run, case=case, epsg=info["epsg"], stability=m["stability"], windows=int(keep.sum()),
                              turn_median=float(np.median(np.abs(w_turn[keep]))), still=float(still[keep].mean()),
                              share=float(np.median(share[keep]))))
        print(f"  {run:36s} {m['stability']:10s} {int(keep.sum()):5d} windows  |turn| median {np.median(np.abs(w_turn[keep])):5.1f}  "
              f"share {np.median(share[keep]):.2f}  still {still[keep].mean():.2f}")
    X = np.concatenate([r[0] for r in rows])
    Y = np.concatenate([r[1] for r in rows])
    XY = np.concatenate([r[2] for r in rows])
    R = np.concatenate([r[3] for r in rows])
    np.savez_compressed(OUT / "windows.npz", X=X, Y=Y, XY=XY, run=R.astype(str), features=np.array(FEATURES),
                        targets=np.array(["turn", "coherence", "share", "still", "reversed"]))
    (OUT / "windows.json").write_text(json.dumps(meta_rows, indent=1), encoding="utf-8")
    print(f"{len(X)} windows from {len(rows)} runs -> {OUT / 'windows.npz'}")


def situation(x: np.ndarray, stab: str) -> str:
    i = {k: j for j, k in enumerate(FEATURES)}
    where = ("water" if x[i["water"]] > 0.5 else "tree line" if abs(x[i["edge_dist"]]) <= 12
             else "forest" if x[i["forest"]] > 0.5 else "open")
    sx = x[i["sx300"]]
    lee = " in a lee >10" if sx >= 10 else " in a lee 5-10" if sx >= 5 else ""
    return f"{stab}, {where}{lee}"


def train(app_csv: str | None, moving: bool = True) -> None:
    import lightgbm as lgb
    z = np.load(OUT / "windows.npz", allow_pickle=True)
    X, Y, XY, R = z["X"], z["Y"], z["XY"], z["run"]
    # a direction the floor does not have: windows mostly still (head under 0.5 km/h) are left out, and the drag
    # variant (s186d15) is the same wind as s186
    keep = ~np.array([("d15_" in r) for r in R])
    if moving:
        keep &= Y[:, 3] <= 0.5
    print(f"{int(keep.sum())} of {len(X)} windows scored" + (" (still windows left out: the floor has no direction there)" if moving else ""))
    X, Y, XY, R = X[keep], Y[keep], XY[keep], R[keep]
    box = np.array([r.split("_")[0] for r in R])
    i_st, i_cv = FEATURES.index("stable"), FEATURES.index("convective")
    stab = np.where(X[:, i_st] > 0.5, "stable", np.where(X[:, i_cv] > 0.5, "convective", "neutral"))
    turn = Y[:, 0]
    params = dict(objective="regression", learning_rate=0.05, num_leaves=31, min_data_in_leaf=40, feature_fraction=0.8,
                  bagging_fraction=0.8, bagging_freq=1, lambda_l2=1.0, verbose=-1, seed=1)
    pred_turn = np.full(len(X), np.nan)
    pred_share = np.full(len(X), np.nan)
    pred_still = np.full(len(X), np.nan)
    gain = np.zeros(len(FEATURES))
    for b in sorted(set(box)):
        tr, te = box != b, box == b
        ms = lgb.train(params, lgb.Dataset(X[tr], np.sin(np.radians(turn[tr]))), 400)
        mc = lgb.train(params, lgb.Dataset(X[tr], np.cos(np.radians(turn[tr]))), 400)
        pred_turn[te] = np.degrees(np.arctan2(ms.predict(X[te]), mc.predict(X[te])))
        mh = lgb.train(params, lgb.Dataset(X[tr], np.log(np.maximum(Y[tr, 2], 0.02))), 400)
        pred_share[te] = np.exp(mh.predict(X[te]))
        mt = lgb.train(params, lgb.Dataset(X[tr], Y[tr, 3]), 400)
        pred_still[te] = np.clip(mt.predict(X[te]), 0, 1)
        gain += ms.feature_importance("gain") + mc.feature_importance("gain")
    err_model = np.abs(wrap(pred_turn - turn))
    err_zero = np.abs(turn)                          # follow the wind above
    share_ok_model = np.abs(np.log(pred_share / np.maximum(Y[:, 2], 0.02))) <= math.log(2)
    med_share = {b: float(np.median(Y[box != b, 2])) for b in set(box)}
    share_ok_const = np.array([abs(math.log(med_share[b] / max(float(y), 0.02))) <= math.log(2) for b, y in zip(box, Y[:, 2])])
    sit = np.array([situation(x, s) for x, s in zip(X, stab)])

    def line(name, sel):
        n = int(sel.sum())
        if n == 0:
            return f"  {name:42s} {n:6d}"
        return (f"  {name:42s} {n:6d}  within 45: top {np.mean(err_zero[sel] <= 45):4.0%}  learned {np.mean(err_model[sel] <= 45):4.0%}"
                f"   |turn| MAE {np.mean(err_zero[sel]):5.1f} -> {np.mean(err_model[sel]):5.1f}"
                f"   share within 2x: const {np.mean(share_ok_const[sel]):4.0%}  learned {np.mean(share_ok_model[sel]):4.0%}")

    print("Leave-one-box-out, 20 m windows, head-height turn from the wind 10 m over the canopy (PALM truth).")
    print("'top' = follow the wind above (turn 0); 'const' = the other boxes' median head/top share.")
    print(line("all", np.ones(len(X), bool)))
    for b in sorted(set(box)):
        print(line(f"held out: {b}", box == b))
    print("by stability:")
    for s in ("neutral", "stable", "convective"):
        print(line(s, stab == s))
    print("by situation (as the loop ranks them):")
    for s in sorted(set(sit), key=lambda s: float(np.mean(err_zero[sit == s] <= 45))):
        if (sit == s).sum() >= 30:
            print(line(s, sit == s))
    order = np.argsort(-gain)
    print("features by gain (turn): " + ", ".join(f"{FEATURES[i]} {gain[i] / gain.sum():.0%}" for i in order[:10]))
    np.savez_compressed(OUT / "lobo.npz", pred_turn=pred_turn, pred_share=pred_share, pred_still=pred_still)

    if app_csv:
        # the app's own call at the loop's lattice points (lon, lat), matched to the nearest window within 15 m
        from pyproj import Transformer
        from scipy.spatial import cKDTree
        epsg = {m["run"]: m["epsg"] for m in json.loads((OUT / "windows.json").read_text(encoding="utf-8"))}
        byrun: dict[str, list[dict]] = {}
        with open(app_csv, encoding="utf-8") as f:
            for r in csv.DictReader(f):
                if r.get("variant", "now") == "now":
                    byrun.setdefault(r["run"], []).append(r)
        app_err, mod_err, zero_err, sits = [], [], [], []
        for run in sorted(set(R)):
            cand = byrun.get(run) or byrun.get(run + "_scent") or byrun.get(run.replace("_scent", ""))
            if not cand:
                continue
            sel = np.nonzero(R == run)[0]
            tree = cKDTree(XY[sel])
            tf = Transformer.from_crs("EPSG:4326", f"EPSG:{epsg[run]}", always_xy=True)
            xs, ys = tf.transform([float(r["lon"]) for r in cand], [float(r["lat"]) for r in cand])
            dist, idx = tree.query(np.stack([xs, ys], axis=1))
            for r, dd, j in zip(cand, dist, idx):
                if dd > 15:
                    continue
                k = sel[j]
                app_err.append(float(r["dirApart"]))
                mod_err.append(err_model[k])
                zero_err.append(err_zero[k])
                sits.append(sit[k])
        app_err, mod_err, zero_err, sits = (np.array(v) for v in (app_err, mod_err, zero_err, sits))
        print(f"against the app's call ({Path(app_csv).name}, {len(app_err)} matched points; the app's dirApart is PALM head "
              f"against the app at the forecast-equivalent forcing, so it carries the terrain layer's error too):")
        print(f"  within 45: app {np.mean(app_err <= 45):4.0%}  top {np.mean(zero_err <= 45):4.0%}  learned {np.mean(mod_err <= 45):4.0%}")
        for s in sorted(set(sits), key=lambda s: float(np.mean(app_err[sits == s] <= 45))):
            msk = sits == s
            if msk.sum() >= 30:
                print(f"  {s:42s} {int(msk.sum()):6d}  app {np.mean(app_err[msk] <= 45):4.0%}  top {np.mean(zero_err[msk] <= 45):4.0%}  "
                      f"learned {np.mean(mod_err[msk] <= 45):4.0%}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("what", choices=["build", "train"])
    ap.add_argument("--app", default="", help="the loop's palm_compare csv, for the app's own call at its points")
    ap.add_argument("--all", action="store_true", help="score the still windows too (default: only where the floor moves)")
    a = ap.parse_args()
    if a.what == "build":
        build()
    else:
        train(a.app or None, moving=not a.all)
    return 0


if __name__ == "__main__":
    sys.exit(main())
