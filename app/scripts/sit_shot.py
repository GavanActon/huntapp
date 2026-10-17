"""The app's own picture of a sit on a past evening: the clock set to that
hour, the forecast the phone had (the archive), the party's positions as
sitters, the group scent drawn, the map on them. Made for the validation
stories (docs/SCENT-TEACHER.md, site/winded-at-the-strip.html).

    python scripts/sit_shot.py --area pickle-lake --when 2026-09-30T18:00 \
        --sit 48.95419,-85.55213 --sit 48.95390,-85.55183 --sit 48.95393,-85.55057 \
        --zoom 16.6 --out ../site/media/winded-strip-app.png [--view people|cloud] [--height 1.5]

Needs the quiet dev server (vite.quiet.config.ts) on --url (default
http://localhost:5195/). The forecast routing and the readiness wait are
replay.py's.
"""

from __future__ import annotations

import argparse
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from replay import HD_PIN_JS, READY_JS, REST_JS, TZ, fulfil, wait_ready  # noqa: E402

from playwright.sync_api import sync_playwright  # noqa: E402

SIT_JS = """
async ({ sits, view, height, streaks }) => {
  const s = await import('/src/weather/micro/scent.ts')
  if (!streaks) { const a = await import('/src/state/appStore.ts'); const st = a.useAppStore.getState(); a.useAppStore.setState({ layers: { ...st.layers, windFlow: false } }) }
  const people = sits.map((p) => ({ lon: p.lon, lat: p.lat, height }))
  s.useScent.setState({ people, plumes: [], group: null, pick: 0, adding: false, moving: null, hidden: false, card: false, view })
  return s.useScent.getState().people.length
}
"""
DONE_JS = """
async () => { const s = await import('/src/weather/micro/scent.ts'); const st = s.useScent.getState()
  return { plumes: st.plumes.filter(Boolean).length, group: !!st.group, people: st.people.length } }
"""


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--area", required=True)
    ap.add_argument("--when", required=True, help="local time, e.g. 2026-09-30T18:00")
    ap.add_argument("--sit", action="append", required=True, help="lat,lon (repeat)")
    ap.add_argument("--zoom", type=float, default=16.5)
    ap.add_argument("--view", default="people", choices=["people", "cloud", "particles"])
    ap.add_argument("--height", type=float, default=1.5)
    ap.add_argument("--url", default="http://localhost:5195/")
    ap.add_argument("--out", default="sit.png")
    ap.add_argument("--settle", type=int, default=25, help="seconds to let the plumes draw")
    ap.add_argument("--no-streaks", action="store_true", help="the wind streaks off, the cones alone")
    args = ap.parse_args()
    when = datetime.fromisoformat(args.when).replace(tzinfo=TZ)
    day = when.date()
    sits = [dict(lat=float(a.split(",")[0]), lon=float(a.split(",")[1])) for a in args.sit]
    clat = sum(s["lat"] for s in sits) / len(sits); clon = sum(s["lon"] for s in sits) / len(sits)
    url = args.url + ("&" if "?" in args.url else "?") + f"area={args.area}"
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
        ctx = browser.new_context(ignore_https_errors=True, viewport={"width": 430, "height": 900}, device_scale_factor=2, is_mobile=True, has_touch=True)
        ctx.add_init_script(HD_PIN_JS)
        page = ctx.new_page()
        logs = []
        page.on("pageerror", lambda e: logs.append(f"[pageerror] {e}"))
        page.route("**/api.open-meteo.com/**", lambda route, request: fulfil(route, request, day))
        page.route("**/ensemble-api.open-meteo.com/**", lambda route, request: route.abort())
        page.clock.install(time=when - timedelta(minutes=5))
        page.goto(url, wait_until="load")
        try:
            page.clock.resume()
        except Exception:
            pass
        home = page.evaluate("async () => { const a = await import('/src/areas/index.ts'); return a.ACTIVE_AREA.presets[0] }")
        ready = wait_ready(page, int(when.timestamp() * 1000), home)
        print("ready:", ready, flush=True)
        page.evaluate(REST_JS)
        page.evaluate("([lon, lat, z]) => window.__map && window.__map.jumpTo({ center: [lon, lat], zoom: z })", [clon, clat, args.zoom])
        n = page.evaluate(SIT_JS, {"sits": sits, "view": args.view, "height": args.height, "streaks": not args.no_streaks})
        print("sitters:", n, flush=True)
        for _ in range(args.settle):
            time.sleep(1)
            st = page.evaluate(DONE_JS)
            if st["plumes"] >= n and (n < 2 or st["group"]):
                break
        print("scent:", st, flush=True)
        time.sleep(3)
        page.screenshot(path=args.out)
        print("\n".join(logs[-5:]))
        print("SCREENSHOT_OK", args.out)
        browser.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
