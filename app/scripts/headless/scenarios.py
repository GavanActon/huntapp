"""Groundwind regression shots: 15 scenarios, each on a fresh first open in headless Chromium.

    py -3.14 scripts/headless/scenarios.py --url http://localhost:5199/ --name baseline                   every scenario
    py -3.14 scripts/headless/scenarios.py --url http://localhost:5199/ --name after cold-open settings   just those
    py -3.14 scripts/headless/scenarios.py --list
    py -3.14 scripts/headless/compare.py out/baseline out/after                                           then: what changed

Options (the others in this folder take the same ones; each has an environment twin):
  --url U      the dev server YOU started (env BASE): npx vite --port 5199 --strictPort, from app/. No default: whatever already
               answers on a port is somebody else's, and a hot reload from their edit lands in your run.
  --name N     the run's folder, scripts/headless/out/N/ (env NAME; default 'run'). --out DIR (env OUT) names any folder instead.
  --live       let the app's Open-Meteo requests reach the real API (env OM_LIVE=1). Default: replay the capture (omcache.py), which
               spends no quota and gives every load the same forecast. Read omcache.py before using --live: the daily limit.
  --clock T    hold the page's Date (env CLOCK): 'HH:MM' on the capture's day, an ISO time, or 'auto' (when the capture was taken).
               The app's words move with the hour; see clock.py. Not for scent-located (a held clock ages the GPS fix).
  --gl G       swiftshader (default, as scripts/shot.py) | d3d11 (env GL).   --dpr N  device pixel ratio (env DPR, default 2)

Output, in the run folder: <shot>.png, <scenario>.console.txt and results.json (one entry per scenario; running some scenarios again
updates their entries and leaves the others).

Modelled on scripts/shot.py: chromium headless, a 430x860 mobile touch context, geolocation at the camp (48.9309,-85.5934) granted, a
fresh context per scenario (so every run is a first open). Readiness waits (readiness.py) replace shot.py's fixed 8 s: the map, the strip's
hour cells and the first scoring pass are waited for, then the scenario's usual boot wait (8 s, 10 s for cold-open), then its steps. Waits
use page.wait_for_timeout (keeps the Playwright loop pumping, so the console listener never holds a worker paused). Each scenario records
the console problems, the number of page loads (a hot reload from another session's edit shows as loads > 1) and a fingerprint of app/src
before and after (srcChangedDuringRun).

A RUN WITH NO FORECAST IS INVALID: the strip says "Fetching the outlook..." (no hour cells, no wind streaks, no heat, Dig in has no score
row) and the console shows 30-100+ [http 429] lines. results.json records http429 per scenario and facts.cellsOk (the strip has hours);
http429 > 20 or cellsOk false = invalid (compare.py says so). With the replay this cannot happen, short of a capture too old for the
clock (omcache.py, 'ageing'). With --live: space runs out, never alongside another headless session.

SELECTORS found on 2026-10-17 (HEAD 0271e10 + 8 uncommitted files); they drift with the UI, fix them here:
  strip ............ .wxstrip (.wx-head row: chip, icons, ⋯; .wxstrip-cells the hour cells .wxcell; .wxfold-handle folds)
  quarry chip ...... button.wx-chip  (text 'Moose ▾')            heat toggle .... button[aria-label^="Heat map"] (aria-pressed)
  outdoor .......... button[aria-label^="Outdoor"]                 map buttons hide button[aria-label$="the map buttons"]
  marks ............ button[aria-label*="your marks"] (pressed by default)          open strip button.wx-open
  ⋯ menu ........... button.wxfold-dots (aria-label "More") -> .wx-menu (role=menu) rows .wx-menu-row:
                     Hunt log, Pins, Party, Locations, Weather by satellite, How we hunt here, Feedback (an <a>), Settings
  hot buttons ...... button[data-hot=ID] (aria-label = the name, aria-pressed = on):
                     far/left: routes 'Routes', measure 'Measure', lanes 'Shooting lanes', contours 'LiDAR contours'
                     near/right: heard 'Game', scent 'Scent cone', windcheck 'Sharpen the wind', windflow 'Wind flow' (on)
                     ids also in HOT_ORDER: path 'Draw a path', pin 'Pin', understory 'Bush thickness', turbulence 'Turbulence', bathy 'Lake depths', radar 'Radar'
  My location ...... .toolcol > button.fab (last child), aria-label 'Show my position' -> 'Follow my position' ... (no auto-start: locating is off until tapped)
  view pill ........ button.viewpill (aria-label View, text 'Sat') -> .viewpill-menu rows .viewpill-name; '.viewpill-more' = More ›,
                     then 'Edit this view' (Layers sheet) and 'Arrange views'; grade tile button.grade-tag (text 'HD', aria 'HD here: what it gives')
  sheets ........... .sheet (title .sheet-titlerow h2, scroller .sheet-body, handle button.sheet-handle aria Expand/Collapse); a tap off closes it
  settings ......... .settings (.st-sec headings); 'Maps on this phone' = the first .st-row button -> Offline sheet
  map popup ........ .maplibregl-popup.depth-popup: .depth-popup-wx weather, .pp-digin (score row; ONLY while the heat map is on), .pp-scent, .pp-heard, .pp-wind, .pp-save (Pin)
  the Camp pin sits at the centre of the first view (215,430): a tap there opens the Dig in SHEET directly, not a popup
  cards ............ .bottombar (.measure-card, .route-card, ...), .topcard (scent: 'Your scent'), .topbar chips
  map .............. window.__map (dev only): loaded(), layers 'spots-heat' (raster), 'spots-pin'; streak canvas = canvas with style z-index 2, not .maplibregl-canvas
                     also dev only: window.__gps (the position store)
"""
import argparse
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright

import omcache
import readiness as R

for _s in (sys.stdout, sys.stderr):  # the notes carry ⋯ › · ; a pipe on Windows defaults to cp1252
    if hasattr(_s, 'reconfigure'):
        _s.reconfigure(encoding='utf-8', errors='replace')

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.abspath(os.path.join(HERE, '..', '..'))  # app/
LAT0, LON0 = 48.9309, -85.5934  # the camp

GL_ARGS = {
    'swiftshader': ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
    'd3d11': ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
}


class _Cfg:
    url = None
    out = None
    name = 'run'
    clock = None
    gl = 'swiftshader'
    dpr = 2
    replay = True


CFG = _Cfg()


def configure(argv, default_name='run', need_capture=True, need_out=True):
    """Read the options every script here shares (see the top of this file) out of argv and the environment into CFG; return the rest of
    argv (scenario names, 'L1', ...). Exits with a message when no server answers at the URL or, for a replay, nothing was captured.
    The run folder is made unless need_out is off (omcache.py capture writes elsewhere)."""
    p = argparse.ArgumentParser(add_help=False, allow_abbrev=False)
    for o in ('--url', '--out', '--name', '--clock', '--gl'):
        p.add_argument(o)
    p.add_argument('--dpr', type=int)
    p.add_argument('--live', action='store_true')
    a, rest = p.parse_known_args(argv)
    url = (a.url or os.environ.get('BASE') or '').strip()
    if not url:
        sys.exit('no dev server: give --url http://localhost:<port>/ (or set BASE). Start your own from app/ (npx vite --port 5199 --strictPort),\n'
                 'never somebody else\'s: their edits and hot reloads would land in your run.')
    if not urlsplit(url).path:
        url += '/'
    CFG.url = url
    CFG.name = a.name or os.environ.get('NAME') or default_name
    CFG.out = os.path.abspath(a.out or os.environ.get('OUT') or os.path.join(HERE, 'out', CFG.name))
    CFG.gl = a.gl or os.environ.get('GL') or 'swiftshader'
    if CFG.gl not in GL_ARGS:
        sys.exit(f'--gl {CFG.gl}: one of {", ".join(GL_ARGS)}')
    CFG.dpr = a.dpr or int(os.environ.get('DPR') or 2)
    CFG.replay = not (a.live or os.environ.get('OM_LIVE') == '1')
    CFG.clock = a.clock or os.environ.get('CLOCK') or None
    if CFG.clock:
        R.clock_time(CFG.clock)  # a bad spec stops here, not after the first load
    if CFG.replay and need_capture and omcache.count() == 0:
        sys.exit(f'no Open-Meteo capture in {omcache.CACHE}: make one (omcache.py capture --url ...) on a day the daily limit is intact,\n'
                 'or pass --live to use the real API (read the top of omcache.py first).')
    try:
        urllib.request.urlopen(CFG.url, timeout=10).close()
    except urllib.error.HTTPError:
        pass  # it answered
    except Exception as e:  # noqa: BLE001
        sys.exit(f'nothing answers at {CFG.url} ({type(e).__name__}): start the dev server (npx vite --port <port> --strictPort, from app/) and pass its URL.')
    if need_out:
        os.makedirs(CFG.out, exist_ok=True)
    return rest


def launch_args():
    return GL_ARGS[CFG.gl]


class Session:
    """A fresh browser, context and page as the house scripts make them (shot.py's context: 430x860 mobile touch, geolocation at the camp),
    with the Open-Meteo replay (unless CFG.replay is off), the held clock (CFG.clock) and a Console watching the page."""

    def __init__(self, pw, *, replay=None, accuracy=None, storage_state=None, init_scripts=(), dpr=None, clock=None):
        self.replay = CFG.replay if replay is None else replay
        self.browser = pw.chromium.launch(headless=True, args=launch_args())
        try:
            geo = {'latitude': LAT0, 'longitude': LON0}
            if accuracy is not None:
                geo['accuracy'] = accuracy
            kw = dict(viewport={'width': 430, 'height': 860}, device_scale_factor=dpr or CFG.dpr, is_mobile=True, has_touch=True,
                      geolocation=geo, permissions=['geolocation'])
            if storage_state:
                kw['storage_state'] = storage_state
            self.ctx = self.browser.new_context(**kw)
            for js in init_scripts:
                self.ctx.add_init_script(js)
            spec = clock if clock is not None else CFG.clock
            self.clock = R.hold_clock(self.ctx, spec) if spec else None
            self.omstats = {}
            if self.replay:
                omcache.install(self.ctx, self.omstats)
            self.page = self.ctx.new_page()
            self.console = R.Console(self.page)
        except BaseException:
            self.browser.close()  # a bad clock spec, a missing storage file: do not leave the browser behind
            raise

    def close(self):
        self.browser.close()


HEAT = 'button[aria-label^="Heat map"]'
DOTS = 'button.wxfold-dots'
PILL = 'button.viewpill'
LOCATE = '.toolcol > button.fab:last-child'


def hot(i):
    return f'button[data-hot="{i}"]'


FACTS_JS = r"""
() => {
  const txt = (sel, n = 300) => { const e = document.querySelector(sel); return e ? e.innerText.replace(/\s+/g, ' ').trim().slice(0, n) : null }
  const m = window.__map
  const streak = [...document.querySelectorAll('canvas')].filter((c) => !c.classList.contains('maplibregl-canvas') && c.style.zIndex === '2').length
  const lay = (id) => (m && m.getLayer(id) ? m.getLayoutProperty(id, 'visibility') || 'visible' : null)
  return {
    mapLoaded: m ? m.loaded() : null, zoom: m ? +m.getZoom().toFixed(2) : null,
    streakCanvases: streak, cells: document.querySelectorAll('.wxcell').length, cellsOk: document.querySelectorAll('.wxcell').length > 20,
    toparea: (() => { const t = document.querySelector('.toparea'); if (!t) return null; return [...t.children].filter((c) => !c.classList.contains('wxstrip')).map((c) => c.innerText.replace(/\s+/g, ' ').trim()).filter(Boolean).join(' | ').slice(0, 300) || null })(),
    strip: txt('.wxstrip', 110), pill: txt('.viewpill', 40), grade: txt('.grade-tag', 20),
    popups: document.querySelectorAll('.maplibregl-popup').length, popup: txt('.maplibregl-popup', 360),
    sheet: txt('.sheet .sheet-titlerow h2', 80) || txt('.sheet h2', 80), sheetText: txt('.sheet', 420),
    bottombar: txt('.bottombar', 420), topcard: txt('.topcard', 420), topbar: txt('.topbar', 200),
    menu: txt('.wx-menu', 300), viewMenu: txt('.viewpill-menu', 420),
    heat: document.querySelector('button[aria-label^="Heat map"]')?.getAttribute('aria-pressed'),
    heatLayer: lay('spots-heat'), spotPins: m && m.getLayer('spots-pin') ? m.queryRenderedFeatures({ layers: ['spots-pin'] }).length : null,
    hot: Object.fromEntries([...document.querySelectorAll('[data-hot]')].map((b) => [b.dataset.hot, b.getAttribute('aria-pressed')])),
    locate: document.querySelector('.toolcol > button.fab:last-child')?.getAttribute('aria-label'),
  }
}
"""

SCROLL_BOTTOM_JS = r"""
() => {
  const st = document.querySelector('.settings')
  let el = st
  while (el && el !== document.body) {
    if (el.scrollHeight > el.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(el).overflowY)) break
    el = el.parentElement
  }
  if (!el || el === document.body) return { scrolled: false, why: 'no scrollable ancestor', settingsH: st ? st.scrollHeight : null }
  const before = el.scrollTop
  el.scrollTop = el.scrollHeight
  return { scrolled: true, cls: String(el.className), before, after: Math.round(el.scrollTop), scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, sections: [...st.querySelectorAll('.st-sec')].map((e) => e.innerText) }
}
"""


def fingerprint():
    """app/src + index.html + vite.config.ts: a hash of (path, mtime, size), the newest file and when."""
    h = hashlib.sha1()
    n = 0
    newest = (0.0, '')
    paths = [os.path.join(APP, 'index.html'), os.path.join(APP, 'vite.config.ts')]
    for root, _, files in os.walk(os.path.join(APP, 'src')):
        paths += [os.path.join(root, f) for f in sorted(files)]
    for p in paths:
        try:
            st = os.stat(p)
        except OSError:
            continue
        h.update(f'{p}|{st.st_mtime_ns}|{st.st_size}'.encode())
        n += 1
        if st.st_mtime > newest[0]:
            newest = (st.st_mtime, p)
    return {'files': n, 'sha': h.hexdigest()[:10], 'newest': os.path.relpath(newest[1], APP), 'at': time.strftime('%H:%M:%S', time.localtime(newest[0]))}


class S:
    """One scenario's page, notes and screenshots."""

    def __init__(self, name, sess):
        self.name, self.sess = name, sess
        self.page, self.ctx, self.console = sess.page, sess.ctx, sess.console
        self.notes, self.shots, self.facts_at = [], [], {}

    def note(self, m):
        self.notes.append(m)
        print(f'  [{self.name}] {m}', flush=True)

    def wait(self, ms):
        self.page.wait_for_timeout(ms)

    def click(self, sel, what, timeout=5000, settle=1500):
        try:
            self.page.locator(sel).first.click(timeout=timeout)
            self.note(f'click ok: {what}  [{sel}]')
            self.wait(settle)
            return True
        except Exception as e:  # noqa: BLE001
            self.note(f'CLICK FAILED: {what}  [{sel}] :: {str(e).splitlines()[0][:110]}')
            return False

    def tap(self, x, y, what='map', settle=1500):
        self.page.mouse.click(x, y)
        self.note(f'tap {x},{y} ({what})')
        self.wait(settle)

    def wait_sheet(self, what, timeout=60000, after=1500):
        """Wait for a sheet's lazy chunk (the dev server transforms it on first use, slow under load), then settle."""
        got = R.wait_js(self.page, R.SHEET_READY_JS, timeout / 1000)
        if got is None:
            self.note(f'SHEET NOT READY ({what}) after {timeout / 1000:.0f} s')
            return False
        self.note(f'sheet ready ({what}) after {got:.1f} s')
        self.wait(after)
        return True

    def wait_log(self, pattern, n=1, timeout=150000):
        """Wait until the console has shown /pattern/ n times (e.g. the grids 'kept on the phone'), pumping the page."""
        t = time.monotonic()
        while time.monotonic() - t < timeout / 1000:
            if self.console.count(pattern) >= n:
                self.note(f'console showed /{pattern}/ x{n} after {time.monotonic() - t:.1f} s')
                return True
            self.wait(500)
        self.note(f'LOG NOT SEEN /{pattern}/ x{n} after {timeout / 1000:.0f} s')
        return False

    def wait_heat(self):
        """At least 20 s, and until the heat layer is visible with pins on it (150 s at most)."""
        got = R.wait_heat(self.page)
        self.note(f'(runner) heat visible with pins after {got} s' if got is not None else '(runner) heat NOT visible with pins after 150 s')

    def exists(self, sel):
        return self.page.locator(sel).count() > 0

    def pressed(self, sel):
        try:
            return self.page.locator(sel).first.get_attribute('aria-pressed')
        except Exception:  # noqa: BLE001
            return None

    def facts(self, tag):
        f = self.page.evaluate(FACTS_JS)
        self.facts_at[tag] = f
        return f

    def shot(self, fname):
        self.page.screenshot(path=os.path.join(CFG.out, fname))
        self.shots.append(fname)
        self.facts(fname)
        self.note(f'shot {fname}')


# ---------------------------------------------------------------- scenarios

def sc_cold_open(s):
    s.shot('cold-open.png')


def sc_menu(s):
    s.click(DOTS, 'strip ⋯ (More)')
    s.shot('menu.png')


def open_settings(s):
    s.click(DOTS, 'strip ⋯ (More)')
    ok = s.click('.wx-menu-row:has-text("Settings")', 'menu -> Settings', settle=500)
    return ok and s.wait_sheet('Settings')


def sc_settings(s):
    open_settings(s)
    s.shot('settings.png')
    info = s.page.evaluate(SCROLL_BOTTOM_JS)
    s.note(f'scroll the sheet body to the bottom: {json.dumps(info, ensure_ascii=False)}')
    s.wait(1200)
    s.shot('settings-bottom.png')


def sc_layers(s):
    s.click(PILL, 'view pill')
    s.click('.viewpill-more', 'pill menu -> More ›')
    s.click('.viewpill-name:has-text("Edit this view")', 'More -> Edit this view ›', settle=500)
    s.wait_sheet('Layers')
    s.shot('layers.png')


def sc_tap(s):
    # literal request: the middle of the map. The Camp pin is there, so this is the preset's Dig in sheet, not a popup
    s.tap(215, 430, 'middle of the map = the Camp pin', settle=500)
    s.wait_sheet('Dig in for the Camp', after=2500)
    s.shot('tap.png')


def wait_popup_wx(s, timeout=30000):
    if R.wait_js(s.page, R.POPUP_WX_JS, timeout / 1000) is not None:
        s.note('popup weather line filled')
        s.wait(1500)
    else:
        s.note(f'popup weather line EMPTY after {timeout / 1000:.0f} s')


def sc_tap_popup(s):
    # a tap off every pin: the info popup (weather + actions)
    s.tap(130, 330, 'forest off the pin', settle=500)
    wait_popup_wx(s)
    s.shot('tap-popup.png')


def heat_on(s):
    if s.pressed(HEAT) == 'true':
        s.note('heat already on')
        return True
    ok = s.click(HEAT, 'heat toggle', settle=500)
    s.note(f'heat aria-pressed after click: {s.pressed(HEAT)}')
    return ok


def sc_digin(s):
    heat_on(s)
    s.note('waiting for the heat (20 s at least)')
    s.wait_heat()
    got = False
    for attempt in (1, 2, 3):
        s.tap(130, 330, f'forest off the pin (attempt {attempt})', settle=500)
        wait_popup_wx(s, 15000)
        if s.exists('.pp-digin'):
            got = True
            break
        s.note('no .pp-digin yet (needs heat + conditions); waiting 12 s')
        s.wait(12000)
    if got:
        s.shot('digin-popup.png')
        s.click('.pp-digin', 'popup score row (Dig in ›)', settle=500)
        s.wait_sheet('Dig in from the popup', after=2500)
    else:
        s.note('NO .pp-digin after 3 taps: the popup has no score row')
    s.shot('digin.png')


def sc_heat(s):
    heat_on(s)
    s.note('waiting for the heat (20 s at least)')
    s.wait_heat()
    s.shot('heat.png')


def sc_scent(s):
    s.click(hot('scent'), 'Scent cone hot button', settle=6000)
    s.shot('scent.png')


def sc_scent_located(s):
    # a fresh position right before the tap: the context's own is stamped when the browser starts, and the app drops a fix older than
    # 20 s as stale, so after a slow boot the tap found none ('Scent · waiting for a fix')
    s.ctx.set_geolocation({'latitude': LAT0, 'longitude': LON0, 'accuracy': 0})
    s.wait(400)
    s.click(LOCATE, 'My location', settle=5000)
    s.click(hot('scent'), 'Scent cone hot button', settle=6000)
    s.shot('scent-located.png')


def sc_measure(s):
    s.click(hot('measure'), 'Measure hot button', settle=1500)
    s.tap(140, 330, 'first point')
    s.tap(310, 560, 'second point', settle=2000)
    s.shot('measure.png')


def sc_routes(s):
    s.click(hot('routes'), 'Routes hot button', settle=3000)
    s.shot('routes.png')


def wait_routes(s, timeout=40000):
    """Routes compute in a worker: wait for the rows (.rt-rows) or a note (.rt-note / .tb-hint), then settle."""
    got = R.wait_js(s.page, R.ROUTES_READY_JS, timeout / 1000)
    if got is not None:
        s.note(f'routes answered after {got:.1f} s')
        s.wait(2500)
    else:
        s.note(f'routes: no rows or note after {timeout / 1000:.0f} s')


def sc_routes_to(s):
    s.click(hot('routes'), 'Routes hot button', settle=2500)
    s.tap(110, 560, 'the far end (forest, off the water)', settle=500)
    wait_routes(s)
    s.shot('routes-to.png')


def sc_pill(s):
    s.click(PILL, 'view pill', settle=1200)
    s.shot('pill.png')
    if not s.click('.viewpill-name:has-text("Topo")', 'Topo', timeout=2500, settle=500):
        s.click('.viewpill-more', 'More ›', settle=800)
        s.click('.viewpill-name:has-text("Topo")', 'Topo (under More)', timeout=2500, settle=500)
    s.wait(9000)
    s.shot('pill-topo.png')


def sc_offline(s):
    # the sheet's words and its "N not saved" depend on how many grids are already kept on the phone: let all three land first
    s.wait_log(r'kept on the phone', 3)
    if open_settings(s):
        s.click('.settings button:has-text("Maps on this phone")', 'Settings -> Maps on this phone', settle=500)
        s.wait_sheet('Maps on this phone', after=2500)
    s.shot('offline.png')


SCENARIOS = [  # name, function, boot wait (s)
    ('cold-open', sc_cold_open, 10), ('menu', sc_menu, 8), ('settings', sc_settings, 8), ('layers', sc_layers, 8),
    ('tap', sc_tap, 8), ('tap-popup', sc_tap_popup, 8), ('digin', sc_digin, 8), ('heat', sc_heat, 8),
    ('scent', sc_scent, 8), ('scent-located', sc_scent_located, 8), ('measure', sc_measure, 8),
    ('routes', sc_routes, 8), ('routes-to', sc_routes_to, 8), ('pill', sc_pill, 8), ('offline', sc_offline, 8),
]

PROBLEM = ('[error]', '[warning]', '[pageerror]', '[requestfailed]', '[http ')


def norm(l):
    return re.sub(r'0x[0-9a-f]+|\d+', '#', l)[:220]


def run(pw, name, fn, boot):
    t0 = time.monotonic()
    gate = {'label': name, 'otherHeadless': R.other_headless(), 'replay': CFG.replay}
    print(f'  [runner] {name}: gate {gate}', flush=True)
    fp0 = fingerprint()
    sess = Session(pw)
    s = S(name, sess)
    err = None
    ready = {}
    try:
        sess.page.goto(CFG.url, wait_until='load', timeout=90000)
        ready = R.wait_ready(sess.page, sess.console)
        s.note(f'(runner) ready: {ready}')
        sess.page.wait_for_timeout(boot * 1000)
        fn(s)
    except Exception as e:  # noqa: BLE001
        err = f'{type(e).__name__}: {str(e).splitlines()[0][:200]}'
        s.note(f'SCENARIO ERROR {err}')
        try:
            sess.page.screenshot(path=os.path.join(CFG.out, f'{name}-ERROR.png'))
        except Exception:  # noqa: BLE001
            pass
    sess.close()
    fp1 = fingerprint()
    sess.console.save(os.path.join(CFG.out, f'{name}.console.txt'))
    lines = sess.console.lines()
    probs = {}
    for body in lines:
        if body.startswith(PROBLEM):
            probs.setdefault(norm(body), [body[:300], 0])[1] += 1
    perf = {m.group(1): int(m.group(2)) for l in lines for m in [re.search(r'\[stats\] perf \{what: (\w+), ms: (\d+)', l)] if m}
    vite = [l for l in lines if '[vite]' in l and ('hot updated' in l or 'reload' in l or 'optimized' in l or 'Re-optimizing' in l)]
    return {
        'scenario': name, 'seconds': round(time.monotonic() - t0, 1), 'error': err, 'pageLoads': sess.console.loads,
        'shots': s.shots, 'notes': s.notes, 'facts': s.facts_at, 'perf': perf, 'viteReloadLines': vite,
        'http429': sess.console.count(r'\[http 429\]'),  # Open-Meteo throttling: a count over ~20 means the run has no forecast
        'problems': [{'count': c, 'line': t} for t, c in probs.values()],
        'srcChangedDuringRun': fp0 != fp1, 'fingerprint': [fp0, fp1], 'gate': gate, 'ready': ready, 'omcache': sess.omstats,
        'clock': sess.clock.isoformat() if sess.clock else None,
    }


def main():
    names = [x[0] for x in SCENARIOS]
    if '--list' in sys.argv:
        print('\n'.join(names))
        return 0
    rest = configure(sys.argv[1:])
    bad = [w for w in rest if w not in names]
    if bad:
        sys.exit(f'unknown scenario {bad}; the scenarios are: {", ".join(names)}')
    todo = [x for x in SCENARIOS if not rest or x[0] in rest]
    results_path = os.path.join(CFG.out, 'results.json')
    results = {}
    if os.path.exists(results_path):
        try:
            with open(results_path, encoding='utf-8') as f:
                results = json.load(f)
        except Exception:  # noqa: BLE001
            results = {}
    print(f'{CFG.url}  ->  {CFG.out}   Open-Meteo: {"replayed from " + omcache.CACHE if CFG.replay else "LIVE (spends quota)"}   clock: {CFG.clock or "real"}', flush=True)
    with sync_playwright() as pw:
        for name, fn, boot in todo:
            print(f'== {name}  ({time.strftime("%H:%M:%S")})', flush=True)
            rec = run(pw, name, fn, boot)
            results[name] = rec
            with open(results_path, 'w', encoding='utf-8') as f:
                json.dump(results, f, indent=1, ensure_ascii=False)
            print(f'   done in {rec["seconds"]} s, pageLoads={rec["pageLoads"]}, problems={len(rec["problems"])}, srcChanged={rec["srcChangedDuringRun"]}', flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
