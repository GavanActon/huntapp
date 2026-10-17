"""Hold the page's clock and read the three things the app says that move with the hour: is a difference the clock or the code?

    py -3.14 scripts/headless/clock.py --url http://localhost:5199/ [HH:MM | ISO time]       default 04:02
    py -3.14 scripts/headless/scenarios.py --url ... --clock 04:02 [scenario ...]            the same hold for any scenario run

Why: the app's own words move with the hour while the code stands still. On one capture, 'scent goes E till 4:15a, then NE' read at 04:02
and 'scent goes NE till 12a' at 07:55; Settings said 'HRDPS 00Z / next run lands ~5:40' and later 'HRDPS 06Z / ~11:40'; Dig in 800 m NW of the
camp scored 18, then 23. A compare of two runs made hours apart lists those as differences. Hold the page's Date at the same hour in both
runs (context.clock.set_fixed_time: Date.now() and new Date() stay put, the timers keep running), with the same replayed Open-Meteo capture,
and the old words come back, or they do not and it was the code. The shots' pixels move with the clock too (strip hours, the heat by hour,
the plume's speed): hold it there as well.

The time: HH:MM is that time on the day the capture was taken (omcache.py), 'auto' is the moment it was taken, an ISO time
('2026-10-17T04:02:00-04:00', no offset = this machine's zone) is taken as given. What is read, in one load:
  1. the Camp's Dig in sheet (a tap on the middle of the map): its words, the wind line among them
  2. Settings: the weather line (the forecast run and when the next lands)
  3. Dig in 800 m NW of the camp with the heat on: the score, its reasons, the Scoring parts
Not for anything that depends on a GPS fix's age (locate, tracks): the app drops a fix older than 20 s by the page's clock.

Same context and options as scenarios.py. Output (in the run folder): CLK-<time>.json (every word read), CLK-<time>.console.txt, shots.
"""
import re
import sys

from playwright.sync_api import sync_playwright

import readiness as R
import scenarios as B
import targeted as TG

SHEET_JS = "() => { const e = document.querySelector('.sheet'); return e ? e.innerText.replace(/\\s+/g, ' ').trim().slice(0, 420) : null }"
SETTINGS_JS = "() => { const e = document.querySelector('.sheet'); const t = e ? e.innerText.replace(/\\s+/g, ' ').trim() : ''; const m = t.match(/Weather.{0,90}/); return m ? m[0] : t.slice(0, 160) }"


def read_at(pw, spec):
    tag = 'clock' + re.sub(r'[^0-9A-Za-z]+', '', spec)[:20]
    t = TG.T(f'CLK-{tag[5:]}', pw, clock=spec)
    try:
        t.note(f'page clock held at {t.sess.clock.isoformat()}')
        t.start()
        r = t.out.setdefault('clock', {})
        r['fixed'] = t.sess.clock.isoformat()
        r['page_now'] = t.ev('() => new Date().toString()')
        # 1. the Camp: a tap on the middle of the map opens the Dig in sheet for the Camp (as scenarios.py's `tap`)
        t.tap(215, 430, 'middle of the map = the Camp pin', settle=500)
        t.sheet_ready('Dig in for the Camp')
        t.wait(2500)
        r['camp_sheet'] = t.ev(SHEET_JS)
        t.shot(f'{tag}-tap.png')
        t.note(f'(camp) {r["camp_sheet"]}')
        t.close_sheets()
        # 2. Settings: the forecast run label
        t.click(B.DOTS, 'strip ⋯ (More)', settle=600)
        t.click('.wx-menu-row:has-text("Settings")', 'menu -> Settings', settle=500)
        t.sheet_ready('Settings')
        t.wait(800)
        r['settings_weather'] = t.ev(SETTINGS_JS)
        t.note(f'(settings) {r["settings_weather"]}')
        t.close_sheets()
        # 3. Dig in 800 m NW of the camp with the heat on (as scenarios.py's `digin`)
        if t.ev(TG.HEATQ_JS)['pressed'] != 'true':
            t.click(B.HEAT, 'heat ON', settle=500)
        t.wait_for(R.HEAT_READY_JS, 120, 'heat visible with pins')
        t.wait(15000)
        TG.d_digin(t, suffix=tag)
        r['digin'] = t.out.get(f'd_digin_{tag}')
        sh = (r['digin'] or {}).get('sheet') or {}
        t.note(f'(digin) score {sh.get("score")} | {sh.get("sheet")}')
    finally:
        t.finish()


def main():
    rest = B.configure(sys.argv[1:], default_name='clock')
    spec = B.CFG.clock or (rest[0] if rest else '04:02')
    print(f'{B.CFG.url}  ->  {B.CFG.out}   Open-Meteo: {"replayed" if B.CFG.replay else "LIVE (spends quota)"}   clock held at {spec}', flush=True)
    with sync_playwright() as pw:
        read_at(pw, spec)
    return 0


if __name__ == '__main__':
    sys.exit(main())
