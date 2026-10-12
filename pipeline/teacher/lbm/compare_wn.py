"""An LBM run (lbm.py) beside WindNinja's momentum solve, the surrogate's
teacher, on the same grid; and, for Big Southern Butte, both at the
campaign's sensors.

Field comparison, per direction, over the cells the lattice holds with real
terrain, inside the kit's core and --roi metres of the centre:
  speed      |V| / ambient, both fields (WindNinja's ambient is its 22 km/h at
             10 m; the LBM's the 10 m speed over flat ground upwind): Pearson
             r, the median ratio, the spread (sd) of each, the share of cells
             sped up past 1.3 and sheltered under 0.5.
  turn       the bearing the air moves toward less the ambient's, in the
             grid's axes (fields.Area.amb: the ambient from d - convergence),
             wrapped to +-180: Pearson r, the median |LBM - WindNinja|.
  classes    the same on the butte (DEM 1700 m and up) and the plain.
The figure: speed and turn maps, WindNinja | LBM | LBM - WindNinja.

Sensors (--campaign bsb): the measured speed ratios of idaho.py's points
file (runs/idaho/bsb-ringdir-points.csv: each sensor's mean speed over the
reference's, R2 put on the ring's north, binned by the reference's
direction) in the bin of this run's direction, against each model's speed
at the sensor over its own median speed on flat ground (slope under 2
degrees), idaho.py's "flat" variant (R2 sits outside the LBM's lattice). Both
models at 10 m (the sensors are at 3 m; under one log law the ratio is the
same).

    py -3.14 pipeline/teacher/lbm/compare_wn.py --run seed-bsb-id-rans-30m-225
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
PIPE = HERE.parent.parent
sys.path.insert(0, str(HERE))
OUT_ROOT = PIPE / "raw" / "teacher" / "lbm"
SURR = PIPE / "raw" / "surrogate"


def bearing(u, v):
    return np.degrees(np.arctan2(u, v))


def wrap180(a):
    return (a + 180.0) % 360.0 - 180.0


def ambient(d):
    r = np.radians(d)
    return -np.sin(r), -np.cos(r)


def pearson(a, b):
    a = np.asarray(a, np.float64)
    b = np.asarray(b, np.float64)
    if a.size < 3:
        return float("nan")
    a = a - a.mean()
    b = b - b.mean()
    den = math.sqrt(float((a * a).sum() * (b * b).sum()))
    return float((a * b).sum() / den) if den > 0 else float("nan")


def slope_deg(dem, cell):
    gy, gx = np.gradient(dem, cell)
    return np.degrees(np.arctan(np.hypot(gx, gy)))


def stats(sw, sl, tw, tl, mask) -> dict:
    a, b = sw[mask], sl[mask]
    ta, tb = tw[mask], tl[mask]
    return {"cells": int(mask.sum()),
            "speed_r": round(pearson(a, b), 3),
            "speed_median_wn": round(float(np.median(a)), 3), "speed_median_lbm": round(float(np.median(b)), 3),
            "speed_sd_wn": round(float(a.std()), 3), "speed_sd_lbm": round(float(b.std()), 3),
            "speed_mae": round(float(np.abs(a - b).mean()), 3),
            "share_over_1.3_wn": round(float((a > 1.3).mean()), 3), "share_over_1.3_lbm": round(float((b > 1.3).mean()), 3),
            "share_under_0.5_wn": round(float((a < 0.5).mean()), 3), "share_under_0.5_lbm": round(float((b < 0.5).mean()), 3),
            "turn_r": round(pearson(ta, tb), 3),
            "turn_median_abs_diff": round(float(np.median(np.abs(wrap180(tb - ta)))), 2),
            "turn_sd_wn": round(float(ta.std()), 2), "turn_sd_lbm": round(float(tb.std()), 2)}


def sensors_bsb(meta: dict, d: float, u_l, v_l, u_w, v_w, dem, valid_l, valid_w, cell) -> dict | None:
    """The BSB sensors in the direction's bin: measured ratio vs each model's
    flat-ground ratio."""
    try:
        import pandas as pd
        from pyproj import Transformer
        sys.path.insert(0, str(PIPE / "surrogate"))
        from idaho import CAMPAIGNS, sensors  # read-only use
    except Exception as e:  # noqa: BLE001
        print(f"sensors skipped: {e}")
        return None
    pts_path = SURR / "runs" / "idaho" / "bsb-ringdir-points.csv"
    if not pts_path.exists():
        print(f"sensors skipped: no {pts_path}")
        return None
    from scipy.ndimage import map_coordinates
    pts = pd.read_csv(pts_path)
    b = int(round(d / 22.5)) % 16
    pts = pts[pts["bin"] == b]
    sens = sensors(CAMPAIGNS["bsb"]).set_index("id")
    pts = pts[pts["id"].isin(sens.index)].copy()
    bnd = meta["bounds"]
    tr = Transformer.from_crs(4326, int(meta["epsg"]), always_xy=True)
    x, y = tr.transform(sens.loc[pts["id"], "lon"].to_numpy(), sens.loc[pts["id"], "lat"].to_numpy())
    rows = (bnd[3] - np.asarray(y)) / cell - 0.5
    cols = (np.asarray(x) - bnd[0]) / cell - 0.5
    flat = slope_deg(dem, cell) < 2.0

    def at(f):
        return map_coordinates(f, [rows, cols], order=1, mode="nearest")

    sl = np.hypot(u_l, v_l)
    sw = np.hypot(u_w, v_w)
    ok = at(np.where(valid_l, 1.0, 0.0)) > 0.99
    pts["lbm_ratio"] = at(sl) / float(np.median(sl[flat & valid_l]))
    pts["wn_ratio_here"] = at(sw) / float(np.median(sw[flat & valid_w]))
    pts["row"], pts["col"] = rows, cols
    pts = pts[ok & np.isfinite(pts["lbm_ratio"].to_numpy())]
    m = pts["ratio"].to_numpy()
    out = {"bin": b, "bin_dir": b * 22.5, "sensors": int(len(pts))}
    for key, col in (("lbm", "lbm_ratio"), ("wn", "wn_ratio_here"), ("wn_idaho", "wn_flat_ratio")):
        p = pts[col].to_numpy()
        out[key] = {"r": round(pearson(m, p), 3), "mae": round(float(np.abs(m - p).mean()), 3),
                    "bias": round(float((p - m).mean()), 3)}
    out["uniform_mae"] = round(float(np.abs(m - 1.0).mean()), 3)
    for cls in sorted(pts["class"].unique()):
        q = pts[pts["class"] == cls]
        if len(q) >= 3:
            out[f"class {cls}"] = {"n": int(len(q)), "measured_mean": round(float(q["ratio"].mean()), 3),
                                   "lbm_mean": round(float(q["lbm_ratio"].mean()), 3),
                                   "wn_mean": round(float(q["wn_ratio_here"].mean()), 3)}
    out["_points"] = pts[["id", "class", "ratio", "lbm_ratio", "wn_ratio_here", "wn_flat_ratio"]].round(3).to_dict("records")
    return out


def figure(path: Path, d: float, dem, sw, sl, tw, tl, mask, st: dict, sens: dict | None, crop) -> None:
    import plotstyle as ps
    import matplotlib.pyplot as plt
    ps.apply()
    r0, r1, c0, c1 = crop
    sub = (slice(r0, r1), slice(c0, c1))
    m = mask[sub]
    show = lambda f: np.where(m, f[sub], np.nan)  # noqa: E731
    ncol = 4 if sens else 3
    fig, ax = plt.subplots(2, ncol, figsize=(4.0 * ncol, 7.6), constrained_layout=True)
    extent = [0, (c1 - c0) * 0.03, 0, (r1 - r0) * 0.03]
    rows = [("speed / ambient", sw, sl, ps.SEQ, (0, 1.8), (-0.6, 0.6)),
            ("turn from ambient, deg", tw, tl, ps.DIV, (-60, 60), (-60, 60))]
    for i, (lab, fw, fl, cmap, lim, dlim) in enumerate(rows):
        diff = fl - fw if i == 0 else wrap180(tl - tw)
        for j, (f, title, cm, lm) in enumerate([(fw, "WindNinja", cmap, lim), (fl, "LBM", cmap, lim),
                                                (diff, "LBM - WindNinja", ps.DIV, dlim)]):
            a = ax[i, j]
            im = a.imshow(show(f), cmap=cm, vmin=lm[0], vmax=lm[1], extent=extent, interpolation="nearest")
            a.contour(np.linspace(extent[0], extent[1], c1 - c0), np.linspace(extent[3], extent[2], r1 - r0),
                      dem[sub], levels=np.arange(1600, 2400, 100), colors=ps.INK2, linewidths=0.4, alpha=0.6)
            a.set_title(f"{title}: {lab}" if j < 2 else f"{title}", loc="left")
            a.set_xlabel("km")
            a.set_ylabel("km")
            fig.colorbar(im, ax=a, shrink=0.8)
    # the stats and the wind's arrow
    ex, ey = ambient(d)
    for a in ax[:, 0]:
        a.annotate("", xy=(0.12 + 0.07 * ex, 0.88 + 0.07 * ey), xytext=(0.12, 0.88), xycoords="axes fraction",
                   arrowprops=dict(arrowstyle="-|>", color=ps.INK, lw=1.5))
        a.text(0.12, 0.95, f"wind from {d:g}", transform=a.transAxes, ha="center", fontsize=8)
    ax[0, 2].text(0.02, 0.02, f"speed r {st['speed_r']:.2f}\nsd WN {st['speed_sd_wn']:.2f}, LBM {st['speed_sd_lbm']:.2f}",
                  transform=ax[0, 2].transAxes, fontsize=8, va="bottom")
    ax[1, 2].text(0.02, 0.02, f"turn r {st['turn_r']:.2f}\nmedian |diff| {st['turn_median_abs_diff']:.1f} deg",
                  transform=ax[1, 2].transAxes, fontsize=8, va="bottom")
    if sens:
        import pandas as pd
        pts = pd.DataFrame(sens["_points"])
        a = ax[0, 3]
        lim = (0.2, 1.9)
        a.plot(lim, lim, color=ps.GRID, lw=1)
        a.scatter(pts["ratio"], pts["wn_ratio_here"], s=22, color=ps.SERIES[1], edgecolor=ps.SURFACE, lw=0.8,
                  label=f"WindNinja  r {sens['wn']['r']:.2f}, MAE {sens['wn']['mae']:.2f}")
        a.scatter(pts["ratio"], pts["lbm_ratio"], s=22, color=ps.SERIES[0], edgecolor=ps.SURFACE, lw=0.8,
                  label=f"LBM  r {sens['lbm']['r']:.2f}, MAE {sens['lbm']['mae']:.2f}")
        a.set_xlim(lim)
        a.set_ylim(lim)
        a.set_xlabel("measured speed ratio (sensor / R2)")
        a.set_ylabel("modelled (speed / flat-ground median)")
        a.set_title(f"BSB sensors, bin {sens['bin_dir']:g} ({sens['sensors']})", loc="left")
        a.legend(loc="upper left", fontsize=8)
        ax[1, 3].axis("off")
        lines = [f"uniform wind MAE {sens['uniform_mae']:.2f}"]
        for k, v in sens.items():
            if k.startswith("class "):
                lines.append(f"{k[6:]} (n {v['n']}): measured {v['measured_mean']:.2f}, "
                             f"LBM {v['lbm_mean']:.2f}, WN {v['wn_mean']:.2f}")
        ax[1, 3].text(0.0, 0.95, "\n".join(lines), va="top", fontsize=8, transform=ax[1, 3].transAxes)
    fig.savefig(path, dpi=120)
    plt.close(fig)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--run", required=True, help="folder under pipeline/raw/teacher/lbm (or a path)")
    ap.add_argument("--area", default="seed-bsb-id")
    ap.add_argument("--roi", type=float, default=None, help="radius for the stats, m (default the run's)")
    ap.add_argument("--campaign", default=None, help="bsb: score at the campaign's sensors too (default for seed-bsb-id)")
    args = ap.parse_args()
    run = Path(args.run) if Path(args.run).exists() else OUT_ROOT / args.run
    z = np.load(run / f"{args.area}.npz", allow_pickle=False)
    meta = json.loads(str(z["meta"]))
    w = np.load(SURR / f"{args.area}.npz", allow_pickle=False)
    wmeta = json.loads(str(w["meta"]))
    conv = float(wmeta.get("gridConvergenceDeg", 0.0))
    cell = float(wmeta.get("cell", 30.0))
    dem = w["dem"].astype(np.float64)
    R, C = dem.shape
    wdirs = w["directions"].astype(float)
    campaign = args.campaign or ("bsb" if args.area == "seed-bsb-id" else None)
    roi = args.roi or float(meta["args"]["roi"])
    cr = meta["runs"][0]["geometry"]["centre_rc"]
    rr, cc = np.mgrid[0:R, 0:C]
    disc = np.hypot(rr - cr[0], cc - cr[1]) * cell <= roi
    results = {}
    for k, d in enumerate(z["directions"].astype(float)):
        i = int(np.argmin(np.abs(wrap180(wdirs - d))))
        uw, vw = w["u"][i].astype(np.float64), w["v"][i].astype(np.float64)
        ul, vl = z["u"][k].astype(np.float64), z["v"][k].astype(np.float64)
        ex, ey = ambient(d - conv)
        b_amb = float(bearing(ex, ey))
        sw, sl = np.hypot(uw, vw), np.hypot(ul, vl)
        tw, tl = wrap180(bearing(uw, vw) - b_amb), wrap180(bearing(ul, vl) - b_amb)
        mask = z["valid"] & w["core"] & w["valid"] & disc & np.isfinite(sl) & np.isfinite(sw)
        st = {"all": stats(sw, sl, tw, tl, mask), "butte (DEM 1700 m+)": stats(sw, sl, tw, tl, mask & (dem >= 1700)),
              "plain (< 1700 m)": stats(sw, sl, tw, tl, mask & (dem < 1700))}
        sens = None
        if campaign == "bsb":
            sens = sensors_bsb(wmeta, d, ul, vl, uw, vw, dem, z["valid"] & np.isfinite(sl), w["valid"], cell)
        res = {"direction": d, "windninja_direction": float(wdirs[i]), "fields": st}
        if sens:
            res["sensors"] = {k2: v for k2, v in sens.items() if k2 != "_points"}
            res["sensor_points"] = sens["_points"]
        results[f"{d:g}"] = res
        rows_any = np.where(mask.any(1))[0]
        cols_any = np.where(mask.any(0))[0]
        crop = (rows_any[0], rows_any[-1] + 1, cols_any[0], cols_any[-1] + 1)
        fig_path = run / f"compare-{d:05.1f}.png"
        figure(fig_path, d, dem, sw, sl, tw, tl, mask, st["all"], sens, crop)
        print(f"direction {d:g} (WindNinja {wdirs[i]:g}):")
        for name, s in st.items():
            print(f"  {name:22s} cells {s['cells']:6d}  speed r {s['speed_r']:.3f}  turn r {s['turn_r']:.3f}  "
                  f"median |dturn| {s['turn_median_abs_diff']:.1f}  speed sd WN {s['speed_sd_wn']:.3f} LBM {s['speed_sd_lbm']:.3f}  "
                  f">1.3 WN {s['share_over_1.3_wn']:.3f} LBM {s['share_over_1.3_lbm']:.3f}  "
                  f"<0.5 WN {s['share_under_0.5_wn']:.3f} LBM {s['share_under_0.5_lbm']:.3f}")
        if sens:
            print(f"  sensors bin {sens['bin_dir']:g}: n {sens['sensors']}  LBM r {sens['lbm']['r']} MAE {sens['lbm']['mae']} "
                  f"bias {sens['lbm']['bias']}  |  WN r {sens['wn']['r']} MAE {sens['wn']['mae']} bias {sens['wn']['bias']}  "
                  f"|  uniform MAE {sens['uniform_mae']}")
            for k2, v in sens.items():
                if k2.startswith("class "):
                    print(f"    {k2}: {v}")
        print(f"  figure {fig_path}")
    (run / "compare.json").write_text(json.dumps(results, indent=1))
    print(f"wrote {run / 'compare.json'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
