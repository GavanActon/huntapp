"""The app's own cone for a sit on a past hour, in PALM's measure: the
how-often grid (share of the sit's minutes a nose gets noticeable scent,
10 m cells, 700 m each way round the sitter) and the reach by sector in
the three bands, so it sits beside palm_to_scent.py's bands for the same
place and hour (docs/SCENT-TEACHER.md, the harness).

    python scripts/cone_export.py --area pickle-lake --when 2026-09-30T18:00 \
        --sit "1:48.95419,-85.55213" --sit "2:48.95390,-85.55183" --sit "3:48.95393,-85.55057" \
        --out ../pipeline/raw/teacher/palm/fields/pickle-bogstrip_b232_appcone

Writes <out>.npz (grids, one per sit) and <out>.json (the summary). Needs the
quiet dev server (vite.quiet.config.ts) on --url, default http://localhost:5195/.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from replay import READY_JS, REST_JS, TZ, fulfil, wait_ready  # noqa: E402

from playwright.sync_api import sync_playwright  # noqa: E402

BANDS = [0.5, 0.15, 0.03]
CONE_JS = """
async ({ sits, ms, height, floor }) => {
  const s = await import('/src/weather/micro/scent.ts')
  const m = await import('/src/weather/micro/model.ts')
  if (floor) m.setFloorTune(floor)
  await m.microReadyFor(ms, 20000)
  const sample = s.cellSampler(ms)
  const out = []
  for (const p of sits) {
    const r = s.simulatePlume(p.lon, p.lat, ms, height, sample)
    out.push(r ? { name: p.name, grid: Array.from(r.grid), plume: r.plume, relief: r.relief } : { name: p.name, grid: null })
  }
  return out
}
"""


def reach_by_sector(grid: np.ndarray, cell: float) -> dict:
    n = grid.shape[0]; c = (n - 1) / 2
    yy, xx = np.mgrid[0:n, 0:n]
    ex, ny = (xx - c) * cell, (c - yy) * cell
    dist = np.hypot(ex, ny); brg = (np.degrees(np.arctan2(ex, ny)) + 360) % 360
    out = {}
    for s0 in range(0, 360, 45):
        m = (brg >= s0) & (brg < s0 + 45) & (dist > cell)
        out[f"{s0:03d}"] = {f"{b:g}": (float(dist[m & (grid >= b)].max()) if (m & (grid >= b)).any() else 0.0) for b in BANDS}
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--area", required=True)
    ap.add_argument("--when", required=True)
    ap.add_argument("--sit", action="append", required=True, help="name:lat,lon (repeat)")
    ap.add_argument("--height", type=float, default=1.5)
    ap.add_argument("--url", default="http://localhost:5195/")
    ap.add_argument("--out", required=True, help="path without extension")
    ap.add_argument("--floor", help='a head-height speed tune for the trial, JSON for model.ts setFloorTune ({"trees": 1.5})')
    args = ap.parse_args()
    when = datetime.fromisoformat(args.when).replace(tzinfo=TZ); day = when.date(); ms = int(when.timestamp() * 1000)
    sits = []
    for a in args.sit:
        name, _, ll = a.partition(":")
        lat, lon = (float(v) for v in ll.split(","))
        sits.append(dict(name=name, lat=lat, lon=lon))
    url = args.url + ("&" if "?" in args.url else "?") + f"area={args.area}"
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
        ctx = browser.new_context(ignore_https_errors=True, viewport={"width": 430, "height": 900})
        page = ctx.new_page()
        page.route("**/api.open-meteo.com/**", lambda route, request: fulfil(route, request, day))
        page.route("**/ensemble-api.open-meteo.com/**", lambda route, request: route.abort())
        page.clock.install(time=when - timedelta(minutes=5))
        page.goto(url, wait_until="load")
        try:
            page.clock.resume()
        except Exception:
            pass
        home = page.evaluate("async () => { const a = await import('/src/areas/index.ts'); return a.ACTIVE_AREA.presets[0] }")
        ready = wait_ready(page, ms, home)
        print("ready:", ready, flush=True)
        page.evaluate(REST_JS)
        t0 = time.time()
        res = page.evaluate(CONE_JS, {"sits": sits, "ms": ms, "height": args.height, "floor": json.loads(args.floor) if args.floor else None})
        print(f"cones in {time.time() - t0:.1f} s", flush=True)
        browser.close()
    grids, summary = {}, {}
    for r in res:
        if r["grid"] is None:
            print(f"  {r['name']}: no cone (no ground wind there)"); continue
        g = np.array(r["grid"], np.float32); n = int(round(math.sqrt(g.size))); g = g.reshape(n, n)
        cell = 1400.0 / n
        grids[r["name"]] = g
        rs = reach_by_sector(g, cell)
        pl = r["plume"]
        summary[r["name"]] = dict(sit=next(s for s in sits if s["name"] == r["name"]), cell=cell, n=n, reach_by_sector=rs,
                                  area_ha={f"{b:g}": round(float((g >= b).sum()) * cell * cell / 1e4, 2) for b in BANDS},
                                  plume=dict(mainToward=pl["mainToward"], mainShare=round(pl["mainShare"], 3), reach=pl["reach"], calm=pl["calm"],
                                             stable=pl["stable"], sectors=[round(v, 3) for v in pl["sectors"]]))
        S = max(rs["135"]["0.15"], rs["180"]["0.15"]); far = max(v["0.15"] for v in rs.values())
        print(f"  {r['name']}: toward {pl['mainToward']:03d} ({pl['mainShare']:.0%}), calm {pl['calm']}, some-minutes reach {far:.0f} m, south {S:.0f} m, "
              f"ha most/some/now {summary[r['name']]['area_ha']}")
    out = Path(args.out)
    np.savez_compressed(out.with_suffix(".npz"), **{f"grid_{k}": v for k, v in grids.items()}, cell=np.array([1400.0 / next(iter(grids.values())).shape[0]]) if grids else np.array([10.0]))
    out.with_suffix(".json").write_text(json.dumps(dict(area=args.area, when=args.when, height=args.height, bands=BANDS, sits=summary), indent=1), encoding="utf-8")
    print("->", out.with_suffix(".npz"), out.with_suffix(".json"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
