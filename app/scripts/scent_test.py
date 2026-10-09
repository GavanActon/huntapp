"""The scent cone at a few spots on a past hour, for before/after checks of
scent.ts: opens the app headless on the archived forecast (as replay.py
does), runs simulatePlume at each spot and prints the summary and the
plume's profile down its main sector, the strongest nose-height cell in
each 50 m band as a share of the core.

    python scripts/scent_test.py <local time, e.g. "2026-09-29 18:00"> [--url http://localhost:5195/] [--spots camp,bog,strip,-85.59;48.933]
"""

from __future__ import annotations

import argparse
import sys
import time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from playwright.sync_api import sync_playwright

sys.path.insert(0, __file__.rsplit("\\", 1)[0] if "\\" in __file__ else __file__.rsplit("/", 1)[0])
from replay import READY_JS, fulfil, wait_ready  # noqa: E402

TZ = ZoneInfo("America/Toronto")
SPOTS = {
    "camp": (-85.59872, 48.9262),
    "bog": (-85.6006, 48.9250),
    "strip": (-85.55121, 48.95406),
    "hardwood": (-85.5806, 48.9208),
}

PLUME_JS = """
async ({ lon, lat, ms, edge }) => {
  const m = await import('/src/weather/micro/model.ts')
  const s = await import('/src/weather/micro/scent.ts')
  await m.microReadyFor(ms, 20000)
  // edge=false: the flat plume with the edge rule off; edge=true: the column model (the app's)
  s.setScentColumn(edge)
  s.setScentEdgeRule(!edge)
  const r = s.simulatePlume(lon, lat, ms)
  s.setScentColumn(true)
  s.setScentEdgeRule(true)
  if (!r) return null
  const { plume, grid } = r
  const N = Math.round(Math.sqrt(grid.length))
  const mid = (N - 1) / 2
  const cell = 10
  // the strongest cell by 50 m band inside ±30° of the main sector
  const bands = new Array(14).fill(0)
  const main = plume.mainToward
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const dx = (x - mid) * cell, dy = (mid - y) * cell
    const d = Math.hypot(dx, dy)
    if (d < 20) continue
    const brg = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360
    const off = Math.abs(((brg - main + 540) % 360) - 180)
    if (off > 30) continue
    const k = Math.min(13, Math.floor(d / 50))
    bands[k] = Math.max(bands[k], grid[y * N + x])
  }
  const g = m.groundWind(lon, lat, ms)
  const c = m.microCell(lon, lat, ms) || {}
  return { plume, bands, cell: { treeH: c.treeH, canopy: c.canopy }, ground: g && { kmh: g.kmh, dirFrom: g.dirFrom, regime: g.regime, headline: g.headline } }
}
"""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("when")
    ap.add_argument("--url", default="http://localhost:5195/")
    ap.add_argument("--spots", default="camp,bog,strip,hardwood")
    ap.add_argument("--edge", default="both", choices=["on", "off", "both"], help="on: the column model (the app's); off: the flat plume with the edge rule off; both for a before/after")
    args = ap.parse_args()
    when = datetime.strptime(args.when, "%Y-%m-%d %H:%M").replace(tzinfo=TZ)
    ms = int(when.timestamp() * 1000)
    day = when.date()
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
        ctx = browser.new_context(ignore_https_errors=True, viewport={"width": 430, "height": 900})
        page = ctx.new_page()
        page.route("**/api.open-meteo.com/**", lambda route, request: fulfil(route, request, day))
        page.route("**/ensemble-api.open-meteo.com/**", lambda route, request: route.abort())
        page.clock.install(time=when - timedelta(minutes=30))
        page.goto(args.url, wait_until="load")
        try:
            page.clock.resume()
        except Exception:  # noqa: BLE001
            pass
        home = page.evaluate("async () => { const a = await import('/src/areas/index.ts'); return a.ACTIVE_AREA.presets[0] }")
        ready = wait_ready(page, ms, home)
        if not (ready and ready["micro"] and ready["grid"] and ready["profile"] and ready["point"]):
            print("not ready", ready)
            return 1
        for name in args.spots.split(","):
            # a named spot, or "lon,lat" as the areas write them
            lon, lat = SPOTS[name] if name in SPOTS else tuple(float(v) for v in name.split(";"))
            for edge in ([False, True] if args.edge == "both" else [args.edge == "on"]):
                t0 = time.time()
                r = page.evaluate(PLUME_JS, {"lon": lon, "lat": lat, "ms": ms, "edge": edge})
                if not r:
                    print(f"{name}: no plume")
                    continue
                pl, g = r["plume"], r["ground"]
                tag = f"{name}{'' if args.edge != 'both' else ' column' if edge else ' flat'}"
                print(f"{tag:16} trees {r['cell']['treeH']} canopy {r['cell']['canopy']:.2f} · {g['kmh']:.1f} km/h from {g['dirFrom']:.0f} ({g['regime']}) · reach {pl['reach']:.0f} m, landing {pl['landing']:.0f}, toward {pl['mainToward']} ({100 * pl['mainShare']:.0f}%), lifted {100 * pl['lifted']:.0f}%, over {100 * pl.get('over', 0):.0f}% · {time.time() - t0:.1f} s")
                print("          " + " ".join(f"{50 * k:>4}" for k in range(14)))
                print("          " + " ".join(f"{100 * v:4.0f}" for v in r["bands"]) + "   (% of the core, strongest cell per 50 m band)")
        page.unroute_all(behavior="ignoreErrors")
        ctx.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
