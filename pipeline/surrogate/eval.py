"""Score the surrogate against WindNinja on one area, beside the baselines it
has to beat, in one table.

All 16 directions are predicted over the whole domain (one pass each) and
compared cell by cell with WindNinja's 10 m wind, over the core (the part
hunters use, where the inflow has settled) and again over every valid
cell. A turn is a difference of compass bearings, wrapped to +-180,
positive clockwise (the air veering). The ambient is WindNinja's in the
grid's axes, turned by the meridian convergence (fields.py), for every row.

  turn error     bearing(prediction) - bearing(WindNinja): MAE, RMSE,
                 median, and the share within 5, 10 and 22.5 degrees
  turn r         Pearson r between the predicted and the true turn away
                 from the ambient, all cells and directions pooled: the
                 statistic the mass-consistent layer scored r <= 0.55 on
                 when it was checked against WindNinja (build_windcfd.py)
  speed          |wind| / ambient: MAE, r and bias (prediction - truth);
                 speed_mae_debiased in the json rescales the prediction by
                 the median ratio first, since the app puts the roughness
                 onto the mass-consistent field afterwards
  turbulence     MAE and r where WindNinja wrote it
and all of it again by slope (< 3, 3-10, > 10 degrees) and by WindNinja's
speed (< 0.7 the slack and the lee, 0.7-1.1, > 1.1 the exposed).

The rows:
  surrogate          the run's averaged weights; with --tta also the mean
                     of the eight D4 turns of the scene, turned back
  uniform ambient    the forecast wind everywhere: the floor
  mass neutral       today's SD terrain wind (build_microclimate.py,
                     neutral lid), from baseline-<area>.npz
  mass stable        its stable-air lid
  interp 45 (odd 8)  the yardstick: each odd direction (22.5, 67.5, ...)
                     from its two neighbours 45 degrees apart, unit
                     directions averaged and renormalised, speeds
                     averaged. The error the app already takes by blending
                     the two nearest baked directions; it is scored on the
                     8 odd directions only, so the surrogate and the
                     neutral solve get an odd-8 row too, like for like.

    py -3.14 pipeline/surrogate/eval.py --run foldA --area blanchard-river --tta
    py -3.14 pipeline/surrogate/eval.py --run foldA --area pickle-lake       (in-sample)

Output: pipeline/raw/surrogate/runs/<run>/eval-<area>/scoreboard.json and
        maps-045.png, maps-270.png (WindNinja / surrogate / mass neutral:
        the turn from the ambient and the speed, the core boxed).
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from fields import (DATA, Area, baseline_field, bearing, load_area, load_baseline, pearson,  # noqa: E402
                    predict_domain, slope_deg, wrap180)

SLOPE_CLASSES = [("slope<3", 0.0, 3.0), ("slope3-10", 3.0, 10.0), ("slope>10", 10.0, 90.0)]
SPEED_BANDS = [("speed<0.7", 0.0, 0.7), ("speed0.7-1.1", 0.7, 1.1), ("speed>1.1", 1.1, 1e9)]
MAP_DIRS = (45.0, 270.0)


# ---- scoring ----------------------------------------------------------------


def metrics(err, tp, tt, sp, st, bp, bt) -> dict:
    """err: turn error; tp, tt: predicted and true turn from the ambient;
    sp, st: speeds; bp, bt: turbulence (NaN where missing)."""
    n = int(err.size)
    if n == 0:
        return {"n": 0}
    a = np.abs(err.astype(np.float64))
    d = {
        "n": n,
        "turn_mae": float(a.mean()),
        "turn_rmse": float(math.sqrt((a * a).mean())),
        "turn_median": float(np.median(a)),
        "within_5": float((a <= 5).mean() * 100),
        "within_10": float((a <= 10).mean() * 100),
        "within_22_5": float((a <= 22.5).mean() * 100),
        "turn_r": pearson(tp, tt),
        "speed_mae": float(np.abs(sp.astype(np.float64) - st).mean()),
        "speed_r": pearson(sp, st),
        "speed_bias": float((sp.astype(np.float64) - st).mean()),
    }
    med_p, med_t = float(np.median(sp)), float(np.median(st))
    d["speed_mae_debiased"] = float(np.abs(sp * (med_t / med_p) - st).mean()) if med_p > 0 else math.nan
    ok = np.isfinite(bp) & np.isfinite(bt)
    if ok.sum() > 2:
        d["turb_mae"] = float(np.abs(bp[ok].astype(np.float64) - bt[ok]).mean())
        d["turb_r"] = pearson(bp[ok], bt[ok])
    else:
        d["turb_mae"] = d["turb_r"] = math.nan
    return d


def score(area: Area, slope: np.ndarray, idx: list[int], pu: np.ndarray, pv: np.ndarray,
          pt: np.ndarray | None, mask: np.ndarray) -> dict:
    """Pool the cells of mask over the directions idx (pu[j] is the
    prediction for area.directions[idx[j]]) and score them, overall and
    by slope class and speed band."""
    cols = {k: [] for k in ("err", "tp", "tt", "sp", "st", "bp", "bt", "slope")}
    for j, i in enumerate(idx):
        tu, tv = area.u[i], area.v[i]
        ok = mask & np.isfinite(tu) & np.isfinite(tv) & np.isfinite(pu[j]) & np.isfinite(pv[j])
        ex, ey = area.amb(float(area.directions[i]))
        b_a = float(bearing(ex, ey))
        b_t = bearing(tu[ok], tv[ok])
        b_p = bearing(pu[j][ok], pv[j][ok])
        cols["err"].append(wrap180(b_p - b_t).astype(np.float32))
        cols["tp"].append(wrap180(b_p - b_a).astype(np.float32))
        cols["tt"].append(wrap180(b_t - b_a).astype(np.float32))
        cols["sp"].append(np.hypot(pu[j][ok], pv[j][ok]).astype(np.float32))
        cols["st"].append(np.hypot(tu[ok], tv[ok]).astype(np.float32))
        cols["bp"].append(pt[j][ok] if pt is not None else np.full(int(ok.sum()), np.nan, np.float32))
        cols["bt"].append(area.turb[i][ok])
        cols["slope"].append(slope[ok])
    c = {k: np.concatenate(v) for k, v in cols.items()}
    args = lambda s: (c["err"][s], c["tp"][s], c["tt"][s], c["sp"][s], c["st"][s], c["bp"][s], c["bt"][s])  # noqa: E731
    out = {"all": metrics(*args(slice(None)))}
    for name, lo, hi in SLOPE_CLASSES:
        s = (c["slope"] >= lo) & (c["slope"] < hi)
        out[name] = metrics(*args(s)) | {"share": float(s.mean() * 100)}
    for name, lo, hi in SPEED_BANDS:
        s = (c["st"] >= lo) & (c["st"] < hi)
        out[name] = metrics(*args(s)) | {"share": float(s.mean() * 100)}
    return out


def interpolate_odd(area: Area) -> tuple[list[int], np.ndarray, np.ndarray, np.ndarray]:
    """Each odd direction from its two neighbours: the mean of their unit
    directions, renormalised, at the mean of their speeds; turbulence the
    mean of theirs."""
    n = len(area.directions)
    idx = list(range(1, n, 2))
    pu, pv, pt = [], [], []
    for i in idx:
        a, b = (i - 1) % n, (i + 1) % n
        sa, sb = np.hypot(area.u[a], area.v[a]), np.hypot(area.u[b], area.v[b])
        with np.errstate(invalid="ignore", divide="ignore"):
            dx = area.u[a] / sa + area.u[b] / sb
            dy = area.v[a] / sa + area.v[b] / sb
            dn = np.hypot(dx, dy)
            sp = 0.5 * (sa + sb)
            pu.append(dx / dn * sp)
            pv.append(dy / dn * sp)
        pt.append(0.5 * (area.turb[a] + area.turb[b]))
    return idx, np.stack(pu), np.stack(pv), np.stack(pt)


# ---- the table ----------------------------------------------------------------


def fmt(x, nd=2) -> str:
    return "-" if x is None or (isinstance(x, float) and not math.isfinite(x)) else f"{x:.{nd}f}"


def main_table(board: dict, region: str) -> str:
    head = ("| model | dirs | turn MAE | RMSE | median | <=5 % | <=10 % | <=22.5 % | turn r | "
            "speed MAE | speed r | bias | turb MAE | turb r |")
    rows = [head, "|" + "---|" * 14]
    for name, entry in board["models"].items():
        m = entry[region]["all"]
        rows.append(
            f"| {name} | {entry['dirs']} | {fmt(m['turn_mae'], 1)} | {fmt(m['turn_rmse'], 1)} | "
            f"{fmt(m['turn_median'], 1)} | {fmt(m['within_5'], 0)} | {fmt(m['within_10'], 0)} | "
            f"{fmt(m['within_22_5'], 0)} | {fmt(m['turn_r'])} | {fmt(m['speed_mae'], 3)} | {fmt(m['speed_r'])} | "
            f"{fmt(m['speed_bias'], 3)} | {fmt(m['turb_mae'], 3)} | {fmt(m['turb_r'])} |")
    return "\n".join(rows)


def class_table(board: dict, region: str, what: str) -> str:
    classes = [c[0] for c in SLOPE_CLASSES + SPEED_BANDS]
    first = next(iter(board["models"].values()))[region]
    head = "| model | " + " | ".join(f"{c} ({fmt(first[c].get('share'), 0)}%)" for c in classes) + " |"
    rows = [head, "|" + "---|" * (len(classes) + 1)]
    for name, entry in board["models"].items():
        cells = []
        for c in classes:
            m = entry[region][c]
            if what == "turn":
                cells.append(f"{fmt(m.get('turn_mae'), 1)} / {fmt(m.get('turn_r'))}")
            else:
                cells.append(f"{fmt(m.get('speed_mae'), 3)} / {fmt(m.get('speed_r'))}")
        rows.append(f"| {name} | " + " | ".join(cells) + " |")
    return "\n".join(rows)


# ---- maps -------------------------------------------------------------------


def maps(area: Area, rows: list[tuple[str, np.ndarray, np.ndarray]], direction: float, path: Path) -> None:
    """Rows of (label, u, v) for one direction: the turn from the ambient
    (diverging, +-30 degrees, grey at zero) and the speed (one hue, 0.4 to
    1.4). Cells outside valid are left blank; the core is boxed."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.colors import LinearSegmentedColormap

    # two poles and a neutral grey midpoint, not a rainbow
    turn_cmap = LinearSegmentedColormap.from_list("turn", ["#2b6cb0", "#9fb8d6", "#e6e6e6", "#e0a37a", "#b5461f"])
    speed_cmap = LinearSegmentedColormap.from_list("speed", ["#f2f4ef", "#a9c6a0", "#4f8a55", "#1e4d2b"])
    turn_cmap.set_bad("#ffffff")
    speed_cmap.set_bad("#ffffff")
    ex, ey = area.amb(direction)
    b_a = float(bearing(ex, ey))
    R, C = area.shape
    fig, axes = plt.subplots(len(rows), 2, figsize=(10, 3.9 * len(rows) * R / C + 0.8), squeeze=False,
                             constrained_layout=True)
    for r, (label, u, v) in enumerate(rows):
        turn = wrap180(bearing(u, v) - b_a)
        speed = np.hypot(u, v)
        turn = np.where(area.valid, turn, np.nan)
        speed = np.where(area.valid, speed, np.nan)
        im0 = axes[r, 0].imshow(turn, cmap=turn_cmap, vmin=-30, vmax=30, interpolation="nearest")
        im1 = axes[r, 1].imshow(speed, cmap=speed_cmap, vmin=0.4, vmax=1.4, interpolation="nearest")
        for c in (0, 1):
            ax = axes[r, c]
            ax.contour(area.core.astype(float), levels=[0.5], colors="#222222", linewidths=0.8)
            ax.set_xticks([])
            ax.set_yticks([])
            for s in ax.spines.values():
                s.set_visible(False)
        axes[r, 0].set_ylabel(label, fontsize=11)
    axes[0, 0].set_title("Turn from the ambient (deg, + clockwise)", fontsize=10, color="#333333")
    axes[0, 1].set_title("Speed / ambient", fontsize=10, color="#333333")
    fig.colorbar(im0, ax=axes[:, 0], orientation="horizontal", fraction=0.04, pad=0.02, ticks=[-30, -15, 0, 15, 30])
    fig.colorbar(im1, ax=axes[:, 1], orientation="horizontal", fraction=0.04, pad=0.02, ticks=[0.4, 0.7, 1.0, 1.4])
    fig.suptitle(f"{area.name}: wind from {direction:g} deg (north up, core boxed)", fontsize=12)
    fig.savefig(path, dpi=110)
    plt.close(fig)


# ---- main -------------------------------------------------------------------


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--run", required=True, help="the run name under raw/surrogate/runs")
    ap.add_argument("--area", required=True)
    ap.add_argument("--ckpt", type=Path, default=None, help="default: runs/<run>/ckpt.pt")
    ap.add_argument("--weights", default="ema", choices=["ema", "model"])
    ap.add_argument("--tta", action="store_true", help="also score the eight-turn average")
    ap.add_argument("--device", default=None)
    ap.add_argument("--batch", type=int, default=4)
    ap.add_argument("--data", type=Path, default=DATA)
    ap.add_argument("--no-maps", action="store_true")
    args = ap.parse_args()

    import torch
    from train import load_checkpoint

    device = args.device or ("cuda" if torch.cuda.is_available() else "cpu")
    run = args.data / "runs" / args.run
    ckpt = args.ckpt or run / "ckpt.pt"
    out = run / f"eval-{args.area}"
    out.mkdir(parents=True, exist_ok=True)

    t0 = time.time()
    area = load_area(args.area, args.data)
    model, config = load_checkpoint(ckpt, device, args.weights)
    in_sample = args.area in config.get("train_areas", [])
    slope = slope_deg(area.dem)
    dirs = [float(d) for d in area.directions]
    masks = {"core": area.core & area.valid, "valid": area.valid}

    preds: dict[str, tuple] = {}
    t = time.time()
    preds["surrogate"] = predict_domain(model, area, dirs, device=device, batch=args.batch)
    t_pass = (time.time() - t) / len(dirs)
    if args.tta:
        preds["surrogate D4-avg"] = predict_domain(model, area, dirs, device=device, batch=args.batch, tta=True)
    all16 = list(range(len(dirs)))

    board: dict = {
        "area": args.area, "run": args.run, "checkpoint": str(ckpt), "weights": args.weights,
        "in_sample": in_sample, "steps": config.get("steps"), "train_areas": config.get("train_areas"),
        "seconds_per_direction": t_pass, "convergence_deg": area.conv, "models": {},
    }

    def add(name: str, idx: list[int], pu, pv, pt):
        board["models"][name] = {"dirs": len(idx)} | {
            region: score(area, slope, idx, pu, pv, pt, m) for region, m in masks.items()}

    for name, (pu, pv, pt) in preds.items():
        add(name, all16, pu, pv, pt)
    ones = np.ones(area.shape)  # float64: the uniform row is exactly the ambient, its turn exactly 0
    amb = [area.amb(d) for d in dirs]
    add("uniform ambient", all16, np.stack([ex * ones for ex, _ in amb]), np.stack([ey * ones for _, ey in amb]), None)
    base = load_baseline(args.area, args.data)
    if base is not None:
        for lid in ("neutral", "stable"):
            f = [baseline_field(base, lid, d, area.conv) for d in dirs]
            add(f"mass {lid}", all16, np.stack([a for a, _ in f]), np.stack([b for _, b in f]), None)
    else:
        print(f"  no baseline-{args.area}.npz: the mass-consistent rows are left out")
    odd, iu, iv, it = interpolate_odd(area)
    add("interp 45 (odd 8)", odd, iu, iv, it)
    pu, pv, pt = preds["surrogate"]
    add("surrogate (odd 8)", odd, pu[odd], pv[odd], pt[odd])
    if base is not None:
        f = [baseline_field(base, "neutral", dirs[i], area.conv) for i in odd]
        add("mass neutral (odd 8)", odd, np.stack([a for a, _ in f]), np.stack([b for _, b in f]), None)

    rep = args.data / "report-dataset.json"
    if rep.exists():
        try:
            board["dataset_report"] = json.loads(rep.read_text())
        except ValueError:
            pass

    (out / "scoreboard.json").write_text(json.dumps(board, indent=1))
    tag = "in-sample" if in_sample else "held out"
    print(f"\n## {args.area} ({tag}), run {args.run}, step {config.get('steps')}, "
          f"{t_pass:.2f} s a direction for the whole domain {area.shape}\n")
    for region in ("core", "valid"):
        print(f"### {region}{' & valid' if region == 'core' else ''}\n")
        print(main_table(board, region))
        print()
    print("### core by class: turn MAE (deg) / turn r\n")
    print(class_table(board, "core", "turn"))
    print("\n### core by class: speed MAE / speed r\n")
    print(class_table(board, "core", "speed"))
    print()

    if not args.no_maps:
        for d in MAP_DIRS:
            if not np.any(np.abs(wrap180(area.directions - d)) < 1e-3):
                continue
            i = int(np.argmin(np.abs(wrap180(area.directions - d))))
            rows = [("WindNinja", area.u[i], area.v[i]), ("surrogate", pu[i], pv[i])]
            if base is not None:
                bu, bv = baseline_field(base, "neutral", d, area.conv)
                rows.append(("mass neutral", bu, bv))
            p = out / f"maps-{int(d):03d}.png"
            maps(area, rows, d, p)
            print(f"map: {p}")
    print(f"scoreboard: {out / 'scoreboard.json'} ({time.time() - t0:.0f} s)")


if __name__ == "__main__":
    main()
