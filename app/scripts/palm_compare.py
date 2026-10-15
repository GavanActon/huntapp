"""Score the app's ground wind against PALM's head-height wind at a PALM box.

    python scripts/palm_compare.py --url http://localhost:5231/ --runs pickle-slot_s186_4m,pickle-slot_w270_4m
    python scripts/palm_compare.py --url http://localhost:5231/ --runs all --out palm_compare.csv
    python scripts/palm_compare.py --runs all --variants '{"off": {"off": 1}, "now": {}, "late": {"rise0": 5, "rise1": 15}}'

For each run: its converted field (pipeline/raw/teacher/palm/fields/<run>.npz) and its case
(pipeline/teacher/palm/<case>/case-<tag>.json and grid-<tag>.npz). The app is opened headless in
the run's area. The air is forced to the run's forecast wind (model.ts setForcedAir), with a
layering for the run's stability:
- neutral: mixed and overcast, no thermals;
- stable: an inversion just after sunset;
- convective: sunny, mixed.
groundWind is then asked on a lattice over the box's middle every --step metres, once for each
--variants setting of the lee rule (model.ts setLeeTune), and scored against PALM's head height
(uHead, vHead: the first level over the ground, to 2 m in the open) at the same points:
- the direction within 45 deg of PALM's;
- "reversed": the head-height wind turned more than 90 deg from the forecast, as recall of
  PALM's reversed points and the share of the app's reversals PALM agrees with;
- the speed pattern: the correlation of each one's speed over its own wind above.
Overall, and by place: open water, open land, under the trees, tree lines (within 12 m of an
edge), the app's slots, and the terrain lee by the upwind shelter angle (the steepest rise within
300 m upwind, PALM's ground; TEACHER.md: PALM reverses 4% under 3 deg, 67% over 10).

Needs the quiet dev server (vite.quiet.config.ts), as scripts/replay.py; it does not watch files,
so restart it after editing the model.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import time
from pathlib import Path

import numpy as np
from playwright.sync_api import sync_playwright
from pyproj import Transformer
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parents[2]
FIELDS = ROOT / "pipeline" / "raw" / "teacher" / "palm" / "fields"
CASES = ROOT / "pipeline" / "teacher" / "palm"
# the case's area in the app (?area=, Pickle Lake's bare)
AREA = {"pickle-slot": "", "pickle-bogstrip": "", "pickle-bogs": "", "lacbailey-bank": "lac-bailey", "searchmont": "searchmont"}
# a dev build runs an HD area on its SD files until it is installed (state/grade.ts, 2026-10-15):
# the scripts score the HD bake, so every area is marked installed before the page loads
HD_PIN_JS = "localStorage.setItem('huntapp-hd', JSON.stringify(Object.fromEntries(['blanchard-river', 'highland-lake', 'lac-bailey', 'pickle-lake', 'sault-test', 'searchmont', 'whitefish-lake'].map((a) => [a, true]))))"
# the moment the app is held at (local): the leaves and the sun's path; the air itself is forced
MOMENT = "2026-09-30T13:00:00"
# the layering by the run's stability (boundaryLayer.Layering), and the sun's height
AIR = {
    "neutral": ({"stable": 0, "inversion": 0, "convective": 0, "dTheta": 0, "ri": 0, "cloud": 100, "sw": 0, "t2": 15}, 20),
    "stable": ({"stable": 0.8, "inversion": 0.8, "convective": 0, "dTheta": 2, "ri": 0.3, "cloud": 0, "sw": 0, "t2": 10}, -3),
    "convective": ({"stable": 0, "inversion": 0, "convective": 0.6, "dTheta": -1, "ri": -0.2, "cloud": 0, "sw": 500, "t2": 16}, 35),
}

READY_JS = """
async ({ ms }) => {
  const m = await import('/src/weather/micro/model.ts')
  const g = await import('/src/routes/goingGrid.ts')
  await m.microReadyFor(ms, 30000)
  await Promise.race([m.loadRestOfMicro(), new Promise((r) => setTimeout(r, 60000))])
  await Promise.race([g.loadGoing(), new Promise((r) => setTimeout(r, 30000))])
  return { micro: !!m.microGrid(), going: !!g.going() }
}
"""

CELL_JS = """
async ({ pts, ms }) => {
  const m = await import('/src/weather/micro/model.ts')
  return pts.map(([lon, lat]) => {
    const c = m.microCell(lon, lat, ms)
    return c ? [c.canopyNow ?? c.canopy ?? null, c.treeH ?? null] : null
  })
}
"""

ASK_JS = """
async ({ pts, ms, air, variants }) => {
  const m = await import('/src/weather/micro/model.ts')
  m.setForcedAir(air)
  const all = {}
  for (const [name, tune] of variants) {
    // a variant is {lee: {...}, slot: {...}}, or a bare lee setting
    const t = tune && (tune.lee || tune.slot || tune.floor) ? tune : { lee: tune }
    m.setLeeTune(t.lee ?? null)
    m.setSlotTune(t.slot ?? null)
    m.setFloorTune(t.floor ?? null)
    const out = []
    for (const [lon, lat] of pts) {
      const g = m.groundWind(lon, lat, ms)
      out.push(g ? [g.kmh, g.dirFrom, g.regime, g.inSlot ? 1 : 0, g.swirl ? 1 : 0, g.local10Kmh, g.sigmaDeg] : null)
    }
    all[name] = out
  }
  m.setLeeTune(null)
  m.setSlotTune(null)
  m.setFloorTune(null)
  m.setForcedAir(null)
  return all
}
"""


def wrap(d):
    return (np.asarray(d) + 180.0) % 360.0 - 180.0


def evaluate(page, js: str, arg: dict, tries: int = 4):
    """page.evaluate, again after the app reloads itself under it (an area switch reloads)."""
    for k in range(tries):
        try:
            return page.evaluate(js, arg)
        except Exception as e:  # playwright's Error: "Execution context was destroyed"
            if "context was destroyed" not in str(e) or k == tries - 1:
                raise
            page.wait_for_load_state("load", timeout=240000)
            time.sleep(5)


def runs_all() -> list[str]:
    out = []
    for f in sorted(FIELDS.glob("*.npz")):
        n = f.stem
        if n.endswith("_particles") or "_scent_" in n or n.startswith("searchmont") or n.endswith(("_t20", "_n40", "_N02")):
            continue
        out.append(n)
    return out


def case_of(run: str) -> tuple[str, str, dict, dict, dict]:
    """The case, its tag, its info, grid and the run's own entry, for a run or a renamed rerun (<run>_scent)."""
    case = run.split("_")[0]
    for info_path in sorted((CASES / case).glob("case*.json")):
        info = json.loads(info_path.read_text(encoding="utf-8"))
        tag = info_path.stem[len("case"):].lstrip("-")
        for k in sorted(info.get("runs", {}), key=len, reverse=True):
            if run.startswith(k) and run[len(k):] in ("", "_scent") or run.startswith(k + "_"):
                grid = CASES / case / (f"grid-{tag}.npz" if tag else "grid.npz")
                return case, tag, info, dict(np.load(grid)), info["runs"][k]
    raise SystemExit(f"no case for {run}")


def shelter_angle(dem: np.ndarray, dx: float, from_grid_deg: float, dmax: float = 300.0) -> np.ndarray:
    """The steepest rise within dmax upwind, degrees (Winstral's Sx), on the case's grid (row 0 north)."""
    b = math.radians(from_grid_deg)
    out = np.full(dem.shape, -90.0)
    for k in range(1, int(dmax / dx) + 1):
        dc, dr = math.sin(b) * k, -math.cos(b) * k
        zz = ndi.shift(dem, (-dr, -dc), order=1, mode="nearest")
        out = np.maximum(out, np.degrees(np.arctan2(zz - dem, k * dx)))
    return out


def lattice(info: dict, step: float) -> tuple[np.ndarray, np.ndarray]:
    x0, y0, x1, y1 = info["bounds"]
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    h = info["core_m"] / 2
    X, Y = np.meshgrid(np.arange(cx - h + step / 2, cx + h, step), np.arange(cy - h + step / 2, cy + h, step))
    return X.ravel(), Y.ravel()


def score(rows: list[dict], name: str) -> str:
    if not rows:
        return f"  {name:34s}     0"
    dd = np.array([r["dirApart"] for r in rows])
    pr = np.array([r["palmRev"] for r in rows], bool)
    ar = np.array([r["appRev"] for r in rows], bool)
    rec = (ar & pr).sum() / max(1, pr.sum())
    prec = (ar & pr).sum() / max(1, ar.sum())
    ps = np.array([r["palmRatio"] for r in rows])
    as_ = np.array([r["appRatio"] for r in rows])
    r = np.corrcoef(ps, as_)[0, 1] if len(rows) > 2 and ps.std() > 0 and as_.std() > 0 else float("nan")
    return (f"  {name:34s} {len(rows):5d}  within 45: {np.mean(dd <= 45):4.0%}  median apart {np.median(dd):4.0f}  "
            f"PALM reversed {pr.mean():4.0%}, app {ar.mean():4.0%}, recall {rec:4.0%} precision {prec:4.0%}  speed r {r:5.2f}")


def classes(rows: list[dict]) -> dict:
    out = {"all": rows,
           "open water": [r for r in rows if r["water"] and not r["edge"]],
           "open land": [r for r in rows if r["open"] and not r["edge"]],
           "under the trees": [r for r in rows if r["forest"] and not r["edge"]],
           "tree lines (12 m)": [r for r in rows if r["edge"]],
           "the app's slots": [r for r in rows if r["appSlot"]]}
    for lo, hi in ((-90, 3), (3, 6), (6, 10), (10, 90)):
        out[f"terrain lee, upwind rise {lo if lo > -90 else '<'}..{hi if hi < 90 else ''} deg"] = [r for r in rows if lo <= r["sx"] < hi]
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--url", default="http://localhost:5231/")
    ap.add_argument("--runs", required=True, help="comma list of converted runs, or 'all'")
    ap.add_argument("--step", type=float, default=20.0, help="lattice step, m")
    ap.add_argument("--out", default="", help="CSV of every point")
    ap.add_argument("--variants", default='{"now": {}}',
                    help='JSON {name: setting}: scored side by side on one page load; a setting is {"lee": {...}, "slot": {...}} (model.ts setLeeTune, setSlotTune) or a bare lee setting, e.g. {"off": {"off": 1}, "now": {}}')
    ap.add_argument("--per-run", action="store_true", help="print every run's table, not only the totals")
    args = ap.parse_args()
    variants = list(json.loads(args.variants).items())
    runs = runs_all() if args.runs == "all" else args.runs.split(",")
    by_area: dict[str, list[str]] = {}
    for run in runs:
        by_area.setdefault(AREA.get(run.split("_")[0], ""), []).append(run)
    ms = int(time.mktime(time.strptime(MOMENT, "%Y-%m-%dT%H:%M:%S")) * 1000)
    allrows: list[dict] = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
        for area, area_runs in by_area.items():
            t0 = time.time()
            ctx = browser.new_context(ignore_https_errors=True, viewport={"width": 430, "height": 900})
            ctx.add_init_script(HD_PIN_JS)
            page = ctx.new_page()
            page.route("**/ensemble-api.open-meteo.com/**", lambda route, request: route.abort())
            page.goto(args.url + (f"?area={area}" if area else ""), wait_until="load", timeout=240000)
            ready = evaluate(page, READY_JS, {"ms": ms})
            print(f"== area {area or 'pickle-lake'}: {ready} in {time.time() - t0:.0f} s", flush=True)
            for run in area_runs:
                d = np.load(FIELDS / f"{run}.npz", allow_pickle=True)
                meta = json.loads(str(d["meta"]))
                case, tag, info, grid, rinfo = case_of(run)
                stab = rinfo["stability"]
                fc = meta["forecast"]
                lay, sun = AIR[stab]
                air = {"kmh": fc["kph"], "dir": fc["fromTrue"], "lay": lay, "sunElev": sun}
                X, Y = lattice(info, args.step)
                lon, lat = Transformer.from_crs(info["epsg"], 4326, always_xy=True).transform(X, Y)
                pts = [[float(a), float(b)] for a, b in zip(lon, lat)]
                allres = evaluate(page, ASK_JS, {"pts": pts, "ms": ms, "air": air, "variants": variants})
                cells = evaluate(page, CELL_JS, {"pts": pts, "ms": ms})
                dx, gam = info["dx"], info["gridConvergenceDeg"]
                x0, y0, x1, y1 = info["bounds"]
                uH, vH, rv = d["uHead"][0], d["vHead"][0], d["reversedHead"][0]
                uT, vT = d["u"][0], d["v"][0]
                ch, water = grid["canopy_h"], grid["water"]
                forest = ch > 6
                n_it = max(1, int(12 / dx))
                edge = ndi.binary_dilation(forest, iterations=n_it) & ~ndi.binary_erosion(forest, iterations=n_it)
                sx = shelter_angle(grid["dem"].astype(float), dx, fc["fromTrue"] - gam)
                f_to = (fc["fromTrue"] + 180) % 360
                # PALM at the points, once
                palm = []
                for k in range(len(X)):
                    r_, c_ = int((y1 - Y[k]) / dx), int((X[k] - x0) / dx)
                    sl = np.s_[max(r_ - 1, 0):r_ + 2, max(c_ - 1, 0):c_ + 2]
                    uu, vv = float(np.nanmean(uH[sl])), float(np.nanmean(vH[sl]))
                    top = float(np.hypot(np.nanmean(uT[sl]), np.nanmean(vT[sl])))
                    palm.append((r_, c_, uu, vv, float(np.nanmean(rv[sl])), top))
                for vname, res in allres.items():
                    rows = []
                    for k, g in enumerate(res):
                        r_, c_, uu, vv, rvs, top = palm[k]
                        cell = cells[k] or [None, None]
                        if g is None or not (np.isfinite(uu) and np.isfinite(vv)):
                            continue
                        p_to = (math.degrees(math.atan2(uu, vv)) + gam) % 360
                        a_kmh, a_from, regime, a_slot, a_swirl, a_l10, a_sigma = g
                        a_to = (a_from + 180) % 360
                        rows.append(dict(run=run, variant=vname, case=case, stability=stab, lon=lon[k], lat=lat[k],
                                         palmTo=round(p_to), appTo=round(a_to), dirApart=abs(float(wrap(a_to - p_to))),
                                         palmRev=abs(float(wrap(p_to - f_to))) > 90, appRev=abs(float(wrap(a_to - f_to))) > 90,
                                         palmRevShare=rvs, palmRatio=math.hypot(uu, vv), appRatio=a_kmh / max(fc["kph"], 0.1),
                                         appKmh=a_kmh, regime=regime, appSlot=bool(a_slot), swirl=bool(a_swirl),
                                         water=bool(water[r_, c_]), open=bool(ch[r_, c_] < 2 and not water[r_, c_]),
                                         forest=bool(forest[r_, c_]), edge=bool(edge[r_, c_]), sx=float(sx[r_, c_]),
                                         palmTop=top, palmCanopyH=float(ch[r_, c_]), appLocal10=a_l10,
                                         appCanopy=cell[0], appTreeH=cell[1], appSigma=a_sigma))
                    if args.per_run:
                        print(f"\n{run} [{vname}] ({stab}, forecast from {fc['fromTrue']:.0f} at {fc['kph']} km/h):", flush=True)
                        for name, rr in classes(rows).items():
                            print(score(rr, name))
                    else:
                        a = classes(rows)["all"]
                        print(f"  {run:32s} [{vname:6s}] {score(a, '')[38:]}", flush=True)
                    allrows += rows
            ctx.close()
        browser.close()
    for vname, _ in variants:
        print(f"\n== every run together [{vname}]")
        for name, rr in classes([r for r in allrows if r["variant"] == vname]).items():
            print(score(rr, name))
    if args.out and allrows:
        with open(args.out, "w", newline="", encoding="utf-8") as f:
            w = csv.DictWriter(f, fieldnames=list(allrows[0]))
            w.writeheader()
            w.writerows(allrows)
        print(f"-> {args.out}")


if __name__ == "__main__":
    main()
