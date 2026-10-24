"""Score the app's ground wind against a PALM series run window by window: the morning (or evening)
as a clock, not one snapshot (huntapp-c5, 2026-10-24, for the dawn release in micro/model.ts).

    python scripts/series_compare.py --url http://localhost:5203/ --runs pickle-bogs_dawn175tl_4m,pickle-slot_am270t_4m
    python scripts/series_compare.py --runs pickle-slot_am270t_4m --variants '{"off": {"thermal": {"dawn": 0}}, "on": {"thermal": {"dawn": 1}}}'

The scent card scores the dawn runs as single windows at a held dusk clock (scorecard.py), so a rule
that acts on the morning's clock cannot move it. Here each of a series run's windows
(fields/series/<run>_<NNN>min.npz, palm_to_fields.py --slice) is scored on its own, with the app held
at that moment of the morning and the air forced to what the run did by then:
- the run's wind at 80 m (its forcing) and a forecast-equivalent 10 m of RATIO10 of it (the stable
  forcing table's ratio, forcing_table.py; 8 at 80 m reads ~3.5);
- the ground warmed by heating_rate x the window's middle (build_case.py: 1 K/h from the night's
  profile), so `warmed` (boundaryLayer.ts) is the run's own clock;
- the 80 m − 2 m inversion eroded from the night's (4 K per 100 m over the lowest 80 m: 3.2 K) by the
  same warming, and the app's own stability from it (boundaryLayer.layeringAt's formulas);
- no shortwave: PALM's surface heats evenly, so it cannot judge an upslope flow (as with the lake
  breeze, palm_compare's caveat), and the app's upslope is kept out of the comparison.
The app's moment is the run's start (sunrise on the held day, 2026-09-30) plus the window's middle, so
the sun's height and side are a real morning's.

Scored as palm_compare.py does (its lattice, its classes, its measures), per window and over all;
"forcing" is the floor following the forecast wind everywhere, the bar a rule has to clear.
"""

from __future__ import annotations

import argparse
import json
import math
import time
from pathlib import Path

import numpy as np
from playwright.sync_api import sync_playwright
from pyproj import Transformer

import palm_compare as pc

SERIES = pc.FIELDS / "series"
RATIO10 = 0.44  # forecast-equivalent 10 m over the run's 80 m wind under a stable layer (8 -> ~3.5)
THETA80 = 3.2  # the night's inversion over 80 m (theta_gradients [(0, 4.0), (80, 0.5)]: 4 K per 100 m)
HEAT = 1.0  # K/h, build_case.py heating_rate for the dawn series
DAY = "2026-09-30"

SUN_JS = """
async ({ ms, lat, lon }) => {
  const s = await import('/src/weather/sun.ts')
  return s.sunTimes(ms, lat, lon)
}
"""


def clamp(v, lo, hi):
    return min(hi, max(lo, v))


def layering(kph80: float, kmh10: float, warmed: float, dir_from: float) -> dict:
    """The app's Layering for the window, by boundaryLayer.layeringAt's own formulas."""
    t2 = 5.0 + warmed
    d_theta = max(0.0, THETA80 - warmed)
    d_u = max(0.6, (kph80 - kmh10) / 3.6)
    ri = (9.81 / (273.15 + t2)) * d_theta * 78 / (d_u * d_u)
    stable = clamp((ri - 0.1) / 0.9, 0, 1) * clamp(d_theta / 0.8, 0, 1) if d_theta > 0 else 0.0
    return dict(dTheta=d_theta, ri=ri, stable=stable, inversion=clamp(d_theta / 2.5, 0, 1.5), convective=0, t2=t2,
                w10=kmh10, d10=dir_from, w80=kph80, sw=0, cloud=0, warmed=warmed)


def windows(run: str) -> list[tuple[int, Path]]:
    out = []
    for f in sorted(SERIES.glob(f"{run}_*min.npz")):
        out.append((int(f.stem.rsplit("_", 1)[1][:-3]), f))
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--url", default="http://localhost:5203/")
    ap.add_argument("--runs", required=True, help="comma list of series runs (fields/series/<run>_<NNN>min.npz)")
    ap.add_argument("--step", type=float, default=20.0, help="lattice step, m")
    ap.add_argument("--variants", default='{"off": {"thermal": {"dawn": 0}}, "on": {"thermal": {"dawn": 1}}}')
    ap.add_argument("--out", default="", help="JSON of every window's scores")
    args = ap.parse_args()
    variants = list(json.loads(args.variants).items())
    runs = args.runs.split(",")
    day0 = int(time.mktime(time.strptime(DAY + "T12:00:00", "%Y-%m-%dT%H:%M:%S")) * 1000)
    report: dict = {}
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
        by_area: dict[str, list[str]] = {}
        for run in runs:
            by_area.setdefault(pc.AREA.get(run.split("_")[0], ""), []).append(run)
        for area, area_runs in by_area.items():
            ctx = browser.new_context(ignore_https_errors=True, viewport={"width": 430, "height": 900})
            ctx.add_init_script(pc.HD_PIN_JS)
            page = ctx.new_page()
            page.route("**/ensemble-api.open-meteo.com/**", lambda route, request: route.abort())
            page.goto(args.url + (f"?area={area}" if area else ""), wait_until="load", timeout=240000)
            print(f"== area {area or 'pickle-lake'}: {pc.evaluate(page, pc.READY_JS, {'ms': day0})}", flush=True)
            for run in area_runs:
                wins = windows(run)
                if not wins:
                    print(f"  {run}: no series windows under {SERIES}")
                    continue
                case, tag, info, grid, rinfo = pc.case_of(run)
                X, Y = pc.lattice(info, args.step)
                lon, lat = Transformer.from_crs(info["epsg"], 4326, always_xy=True).transform(X, Y)
                pts = [[float(a), float(b)] for a, b in zip(lon, lat)]
                clon, clat = float(np.mean(lon)), float(np.mean(lat))
                sunrise = pc.evaluate(page, SUN_JS, {"ms": day0, "lat": clat, "lon": clon})["sunriseMs"]
                print(f"\n{run}: {len(wins)} windows, {len(pts)} points, sunrise {time.strftime('%H:%M', time.localtime(sunrise / 1000))}", flush=True)
                dx, gam = info["dx"], info["gridConvergenceDeg"]
                x0, y0, x1, y1 = info["bounds"]
                ch, water = grid["canopy_h"], grid["water"]
                forest = ch > 6
                head = f"  {'min':>4} {'warmed':>6} {'stable':>6}  " + "  ".join(f"{n:>22}" for n in ["forcing"] + [v for v, _ in variants])
                print(head + "\n  " + " " * 21 + "  ".join(f"{'all judged trees rev':>22}" for _ in range(len(variants) + 1)))
                rows_run = []
                for t, f in wins:
                    d = np.load(f, allow_pickle=True)
                    meta = json.loads(str(d["meta"]))
                    kph80, dir_from = float(meta["forecast"]["kph"]), float(meta["forecast"]["fromTrue"])
                    mid = t - 5
                    warmed = HEAT * mid / 60
                    lay = layering(kph80, kph80 * RATIO10, warmed, dir_from)
                    air = {"kmh": kph80 * RATIO10, "dir": dir_from, "lay": lay}
                    ms = int(sunrise + mid * 60_000)
                    res = pc.evaluate(page, pc.ASK_JS, {"pts": pts, "ms": ms, "air": air, "variants": variants})
                    uH, vH = d["uHead"][0], d["vHead"][0]
                    f_to = (dir_from + 180) % 360
                    scores = {}
                    palm = []
                    # a cell any variant calls a lake or land breeze is not PALM's to judge: its water heats like
                    # the land (no land-surface model; palm_compare's caveat), so "judged" leaves those out
                    breeze = [any(res[v][k] and res[v][k][2] in ("lakeBreeze", "landBreeze") for v, _ in variants) for k in range(len(X))]
                    for k in range(len(X)):
                        r_, c_ = int((y1 - Y[k]) / dx), int((X[k] - x0) / dx)
                        sl = np.s_[max(r_ - 1, 0):r_ + 2, max(c_ - 1, 0):c_ + 2]
                        palm.append((r_, c_, float(np.nanmean(uH[sl])), float(np.nanmean(vH[sl]))))
                    for vname in ["forcing"] + [v for v, _ in variants]:
                        dd, cls, prv, arv, sp_a, sp_p, brz = [], [], [], [], [], [], []
                        for k, (r_, c_, uu, vv) in enumerate(palm):
                            if not (np.isfinite(uu) and np.isfinite(vv)):
                                continue
                            p_to = (math.degrees(math.atan2(uu, vv)) + gam) % 360
                            if vname == "forcing":
                                a_to = f_to
                            else:
                                g = res[vname][k]
                                if g is None:
                                    continue
                                a_to = (g[1] + 180) % 360
                                sp_a.append(g[0])
                            sp_p.append(math.hypot(uu, vv) * 3.6)
                            dd.append(abs(float(pc.wrap(a_to - p_to))))
                            brz.append(breeze[k])
                            cls.append("open" if ch[r_, c_] < 2 and not water[r_, c_] else "trees" if forest[r_, c_] else "other")
                            prv.append(abs(float(pc.wrap(p_to - f_to))) > 90)
                            arv.append(abs(float(pc.wrap(a_to - f_to))) > 90)
                        dd, cls, brz = np.array(dd), np.array(cls), np.array(brz, bool)
                        prv, arv = np.array(prv, bool), np.array(arv, bool)
                        w = lambda m: float(np.mean(dd[m] <= 45)) if m.any() else float("nan")  # noqa: E731
                        scores[vname] = dict(all=w(np.ones(len(dd), bool)), judged=w(~brz), open=w(cls == "open"), trees=w(cls == "trees"),
                                             recall=float((arv & prv).sum() / max(1, prv.sum())), appRev=float(arv.mean()) if len(arv) else 0.0,
                                             palmRev=float(prv.mean()) if len(prv) else 0.0, n=int(len(dd)),
                                             appKmh=float(np.median(sp_a)) if sp_a else float("nan"), palmKmh=float(np.median(sp_p)) if sp_p else float("nan"))
                    rows_run.append(dict(min=t, warmed=warmed, stable=lay["stable"], scores=scores))
                    line = f"  {t:4d} {warmed:6.2f} {lay['stable']:6.2f}  " + "  ".join(
                        f"{s['all']:5.0%} {s['judged']:5.0%} {s['trees']:5.0%} {s['recall']:4.0%}" for s in scores.values()) + "   km/h PALM {:.2f} ".format(
                        scores["forcing"]["palmKmh"]) + " ".join(f"{v} {scores[v]['appKmh']:.2f}" for v in scores if v != "forcing")
                    print(line, flush=True)
                mean = {v: {k: float(np.nanmean([r["scores"][v][k] for r in rows_run])) for k in ("all", "judged", "open", "trees", "recall")} for v in rows_run[0]["scores"]}
                print("  mean            " + "  ".join(f"{s['all']:5.0%} {s['judged']:5.0%} {s['trees']:5.0%} {s['recall']:4.0%}" for s in mean.values()))
                report[run] = dict(windows=rows_run, mean=mean, ratio10=RATIO10, theta80=THETA80, heat=HEAT)
            ctx.close()
        browser.close()
    if args.out:
        Path(args.out).write_text(json.dumps(report, indent=1), encoding="utf-8")
        print(f"-> {args.out}")


if __name__ == "__main__":
    main()
