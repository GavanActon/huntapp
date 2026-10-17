"""Targeted checks of the heat switch, the armed buttons and the ruler: the app's own state read in the page, plus shots.

    py -3.14 scripts/headless/targeted.py --url http://localhost:5199/ --name after [L1] [L2] [L3]      (default L1 and L2)

L1  (a) heat toggle on / off / on (the scoring-pass count must not rise on the toggles; the overlay and the pins follow the button)
    (d) Dig in with the heat on: popup score row, sheet score + reasons, Scoring sheet parts
    (d2) hunt-log pull: a sighting saved through the Game card, then logBoostAt == logBoostGrid at every cell around it (in the page,
         on the page's own module instances), and Dig in beside it
    (a2) race probes: the hour tapped (a pass starts), the heat toggled while the pass is in flight; the state must end as toggled
L2  (b) Game armed, then the ruler: the armed line goes, two points, Done, one more tap opens no Heard form
    (c) ruler over a kept route: layer order and the pixels at the crossing (the ruler is drawn over the route)
    (c2) Game armed, then the route card: the armed line goes;  Sharpen the wind card and its rose (closed by a tap on the map);
         the grade tile opens its sheet
L3  the heat tapped 1.5 / 4 / 7 s after the load event (a hunter who opens the app and taps it at once), then left alone: the state must
    be right once the first passes are done, whether or not the tap fell inside a pass (one page load per delay)

Same context as scenarios.py (430x860, touch, geolocation at the camp, Open-Meteo replayed), the same options (--live, --clock, ...), and
each load waits for the app to be ready (readiness.py) before its first step.
Output (in the run folder): <name>.png, L1.json / L2.json / L3-<delay>.json (every number the checks read), the matching .console.txt.
Dev-only globals used: window.__map (and the page's own module instances, found by the URLs the app loaded them from).
"""
import json
import os
import re
import sys
import time

from playwright.sync_api import sync_playwright

import readiness as R
import scenarios as B

HEAT = B.HEAT
HEARD = 'button[data-hot="heard"]'
MEASURE = 'button[data-hot="measure"]'
ROUTES = 'button[data-hot="routes"]'

INIT_JS = r"""
(() => {
  try { performance.setResourceTimingBufferSize(100000) } catch (e) { /* none */ }
  window.__trace = []
  const orig = console.debug.bind(console)
  console.debug = (...a) => {
    try {
      const s = typeof a[0] === 'string' ? a[0] : ''
      if (/scored in/.test(s)) window.__trace.push({ t: performance.now(), k: 'scored', s: s.slice(0, 140) })
    } catch (e) { /* never break the page */ }
    return orig(...a)
  }
  addEventListener('click', (e) => {
    try {
      const b = e.target && e.target.closest ? e.target.closest('button') : null
      if (!b) return
      const al = b.getAttribute('aria-label') || ''
      if (al.startsWith('Heat map')) window.__trace.push({ t: performance.now(), k: 'heat-click', pressedBefore: b.getAttribute('aria-pressed') })
      else if (b.classList.contains('wxcell')) window.__trace.push({ t: performance.now(), k: 'cell-click' })
    } catch (e) { /* never break the page */ }
  }, true)
})()
"""

HEATQ_JS = r"""
() => {
  const m = window.__map
  if (!m) return null
  const vis = (id) => (m.getLayer(id) ? (m.getLayoutProperty(id, 'visibility') || 'visible') : null)
  return {
    pressed: document.querySelector('button[aria-label^="Heat map"]')?.getAttribute('aria-pressed'),
    heat: vis('spots-heat'), pin: vis('spots-pin'), glow: vis('spots-pin-glow'), score: vis('spots-pin-score'),
    pins: m.getLayer('spots-pin') ? m.queryRenderedFeatures({ layers: ['spots-pin'] }).length : null,
  }
}
"""

PAINTED_JS = r"""
() => {
  const m = window.__map
  try {
    const c = m.getSource('spots-heat').canvas
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
    let n = 0
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++
    return { paintedPx: n, w: c.width, h: c.height }
  } catch (e) { return { paintedPx: null, err: String(e).slice(0, 80) } }
}
"""

TRACE_JS = "() => window.__trace || []"

LOG_EQ_JS = r"""
async () => {
  // the page's OWN module instances, by the URLs the app loaded them from (Vite stamps a hot-updated file with ?t=, and a bare import of
  // '/src/..' would be a second copy with its own empty store and no grid)
  const urls = performance.getEntriesByType('resource').map((e) => e.name)
  const find = (re) => urls.filter((n) => re.test(n)).pop()
  const uHL = find(/\/src\/log\/huntLog\.ts/), uHG = find(/\/src\/spots\/habitatGrid\.ts/)
  if (!uHL || !uHG) return { error: 'module urls not found', uHL, uHG }
  const hl = await import(uHL)
  const hg = await import(uHG)
  const h = hg.habitat()
  const es = hl.useHuntLog.getState().entries
  if (!h || !es.length) return { entries: es.length, habitat: !!h }
  const e = es[es.length - 1]
  const i0 = h.index(e.lon, e.lat)
  if (i0 < 0) return { entries: es.length, habitat: true, i0 }
  const [r0, c0] = h.rc(i0)
  const now = Date.now()
  const grid = hl.logBoostGrid(h, e.species, now)
  let maxd = 0, n = 0, changed = 0, atCentre = null
  for (let dr = -45; dr <= 45; dr++) for (let dc = -45; dc <= 45; dc++) {
    const r = r0 + dr, c = c0 + dc
    if (r < 0 || c < 0 || r >= h.rows || c >= h.cols) continue
    const i = r * h.cols + c
    const a = grid ? grid[i] : 1
    const b = hl.logBoostAt(h, e.species, now, i)
    const d = Math.abs(a - b); if (d > maxd) maxd = d
    n++; if (b !== 1) changed++
    if (dr === 0 && dc === 0) atCentre = [a, b]
  }
  return { entries: es.length, species: e.species, what: e.what, cells: n, cellsPulled: changed, maxAbsDiff: maxd, atCentre, gridNull: grid == null }
}
"""

DIGIN_JS = r"""
() => {
  const q = (s) => { const e = document.querySelector(s); return e ? e.innerText.replace(/\s+/g, ' ').trim() : null }
  return {
    title: q('.sheet .sheet-title') || q('.sheet-titlerow h2') || q('.sheet h2'),
    score: q('.digin-score'), grade: q('.digin-grade'),
    reasons: [...document.querySelectorAll('.digin-reason')].map((e) => e.innerText.replace(/\s+/g, ' ').trim()),
    warns: [...document.querySelectorAll('.digin-warn')].map((e) => e.innerText.trim()),
    more: q('.digin-more'),
    rows: [...document.querySelectorAll('.digin-row')].map((e) => e.innerText.replace(/\s+/g, ' ').trim().slice(0, 100)),
    empty: q('.digin-empty'),
    sheet: (q('.sheet') || '').slice(0, 420),
  }
}
"""

SCORING_JS = r"""
() => ({
  secs: [...document.querySelectorAll('.scoring-sec')].map((e) => e.innerText.replace(/\s+/g, ' ').trim()),
  lines: [...document.querySelectorAll('.sc-line')].map((e) => e.innerText.replace(/\s+/g, ' ').trim()),
  sum: (document.querySelector('.sc-sum')?.innerText || '').replace(/\s+/g, ' ').trim() || null,
  empty: document.querySelector('.digin-empty')?.innerText ?? null,
})
"""

POPUP_JS = r"""
() => {
  const p = document.querySelector('.maplibregl-popup')
  const t = (s) => { const e = p && p.querySelector(s); return e ? e.innerText.replace(/\s+/g, ' ').trim() : null }
  return { n: document.querySelectorAll('.maplibregl-popup').length, text: p ? p.innerText.replace(/\s+/g, ' ').trim().slice(0, 300) : null, wx: t('.depth-popup-wx'), digin: t('.pp-digin') }
}
"""

ARMED_JS = r"""
() => ({
  partyN: [...document.querySelectorAll('.lc-party-n')].map((e) => e.innerText.replace(/\s+/g, ' ').trim()),
  livecard: [...document.querySelectorAll('.livecard')].map((e) => e.innerText.replace(/\s+/g, ' ').trim().slice(0, 120)),
  heardPressed: document.querySelector('button[data-hot="heard"]')?.getAttribute('aria-pressed') ?? null,
  measurePressed: document.querySelector('button[data-hot="measure"]')?.getAttribute('aria-pressed') ?? null,
  routesPressed: document.querySelector('button[data-hot="routes"]')?.getAttribute('aria-pressed') ?? null,
  measureCard: document.querySelectorAll('.measure-card').length,
  measureText: (document.querySelector('.measure-card')?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 160) || null,
  heardForm: document.querySelectorAll('.ground-card').length,
  routeCard: document.querySelectorAll('.route-card, .rt-rows').length,
  popups: document.querySelectorAll('.maplibregl-popup').length,
  bottombar: (document.querySelector('.bottombar')?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 200) || null,
})
"""

ROUTE_GEOM_JS = r"""
() => {
  const m = window.__map
  const fs = m.queryRenderedFeatures({ layers: ['routes-line'] })
  if (!fs.length) return null
  let best = null
  for (const f of fs) {
    const g = f.geometry
    const lines = g.type === 'MultiLineString' ? g.coordinates : [g.coordinates]
    for (const ln of lines) if (!best || ln.length > best.length) best = ln
  }
  const pts = best.map((c) => { const p = m.project(c); return [p.x, p.y] })
  const ids = m.getStyle().layers.map((l) => l.id)
  const ix = (id) => ids.indexOf(id)
  return {
    pts, features: fs.length, props: fs[0].properties,
    order: Object.fromEntries(['routes-casing', 'routes-line', 'routes-hit', 'routes-label', 'routes-ends', 'measure-line-casing', 'measure-line', 'measure-leg-labels', 'measure-scrub', 'measure-points'].map((id) => [id, ix(id)])),
    total: ids.length,
  }
}
"""


def out_path(fname):
    return os.path.join(B.CFG.out, fname)


class T:
    """One load: a Session (browser, context, page, console, replay) with notes, the page's trace and the checks' results (self.out)."""

    def __init__(self, name, pw, init_scripts=(), **session_kw):
        self.name = name
        self.gate = {'label': name, 'otherHeadless': R.other_headless(), 'replay': B.CFG.replay}
        print(f'  [runner] {name}: gate {self.gate}', flush=True)
        self.sess = B.Session(pw, init_scripts=(INIT_JS, *init_scripts), **session_kw)
        self.ctx, self.page, self.console, self.omstats = self.sess.ctx, self.sess.page, self.sess.console, self.sess.omstats
        self.t0 = self.console.t0
        self.notes, self.out = [], {'name': name, 'gate': self.gate}

    # ---- plumbing
    def note(self, m):
        line = f'{time.monotonic() - self.t0:7.1f}s {m}'
        self.notes.append(line)
        print(f'  [{self.name}] {line}', flush=True)

    def wait(self, ms):
        self.page.wait_for_timeout(int(ms))

    def ev(self, js, arg=None):
        return self.page.evaluate(js, arg) if arg is not None else self.page.evaluate(js)

    def count(self, pat):
        return self.console.count(pat)

    def click(self, sel, what, timeout=8000, settle=1000, **kw):
        try:
            self.page.locator(sel).first.click(timeout=timeout, **kw)
            self.note(f'click ok: {what}')
            self.wait(settle)
            return True
        except Exception as e:  # noqa: BLE001
            self.note(f'CLICK FAILED: {what} [{sel}] :: {str(e).splitlines()[0][:110]}')
            return False

    def tap(self, x, y, what, settle=1200):
        self.page.mouse.click(x, y)
        self.note(f'tap {x:.0f},{y:.0f} ({what})')
        self.wait(settle)

    def shot(self, fname, **kw):
        self.page.screenshot(path=out_path(fname), **kw)
        self.note(f'shot {fname}')

    def exists(self, sel):
        return self.page.locator(sel).count() > 0

    def pressed(self, sel):
        try:
            return self.page.locator(sel).first.get_attribute('aria-pressed')
        except Exception:  # noqa: BLE001
            return None

    def wait_for(self, js, cap_s, what, poll=300):
        got = R.wait_js(self.page, js, cap_s, poll=poll)
        if got is None:
            self.note(f'{what}: NOT after {cap_s} s')
            return False
        self.note(f'{what}: ok after {got:.1f} s')
        return True

    def quiet(self, secs=8, cap=60, pat=R.QUIET_PAT):
        t = time.monotonic()
        if R.wait_quiet(self.page, self.console, secs, cap, pat):
            self.note(f'quiet {secs} s reached after {time.monotonic() - t:.1f} s')
            return True
        self.note(f'quiet {secs} s NOT reached in {cap} s')
        return False

    def start(self):
        self.page.goto(B.CFG.url, wait_until='load', timeout=90000)
        ready = R.wait_ready(self.page, self.console)
        self.out['ready'] = {'mapAndStrip': ready['mapAndStripS'] is not None, 'firstPass': ready['firstPassS'] is not None, 'seconds': ready}
        self.note(f'ready (map loaded + strip hours, first pass): {self.out["ready"]}')

    def sheet_ready(self, what, timeout=60):
        return self.wait_for(R.SHEET_READY_JS, timeout, f'sheet ready ({what})')

    def close_sheets(self):
        for _ in range(5):
            if not self.exists('.sheet'):
                return True
            if self.exists('.sheet .sheet-done'):
                self.click('.sheet .sheet-done', 'sheet Done', settle=700)
            elif self.exists('.sheet .sheet-back'):
                self.click('.sheet .sheet-back', 'sheet Back', settle=700)
            else:
                self.tap(215, 120, 'tap off the sheet', settle=700)
        return not self.exists('.sheet')

    def trace(self):
        return self.ev(TRACE_JS)

    def finish(self):
        try:
            self.out['facts_end'] = self.ev(B.FACTS_JS)
        except Exception:  # noqa: BLE001
            pass
        try:
            self.out['trace_end'] = self.trace() if not self.page.is_closed() else None
        except Exception:  # noqa: BLE001
            self.out['trace_end'] = None
        self.sess.close()
        self.console.save(out_path(f'{self.name}.console.txt'))
        self.out['notes'] = self.notes
        self.out['pageLoads'] = self.console.loads
        self.out['http429'] = self.count(r'\[http 429\]')
        self.out['omcache'] = self.omstats
        self.out['clock'] = self.sess.clock.isoformat() if self.sess.clock else None
        self.out['pageerrors'] = [l for l in self.console.lines() if l.startswith('[pageerror]')]
        with open(out_path(f'{self.name}.json'), 'w', encoding='utf-8') as f:
            json.dump(self.out, f, indent=1, ensure_ascii=False)


def safe(t, name, fn):
    try:
        fn(t)
    except Exception as e:  # noqa: BLE001
        msg = f'{type(e).__name__}: {str(e).splitlines()[0][:200]}'
        t.note(f'CHECK {name} ERROR {msg}')
        t.out.setdefault('errors', []).append(f'{name}: {msg}')
        try:
            t.page.screenshot(path=out_path(f'{name}-ERROR.png'))
        except Exception:  # noqa: BLE001
            pass


def passes(trace):
    """The scoring passes in a page trace: end time, 'ms in all', start time (end - in all)."""
    out = []
    for e in trace:
        if e['k'] == 'scored':
            m = re.search(r'(\d+) ms in all', e['s'])
            y = int(m.group(1)) if m else 0
            out.append({'end': round(e['t']), 'inAll': y, 'start': round(e['t'] - y)})
    return out


# ---------------------------------------------------------------- L1

def a_heat_toggle(t):
    r = t.out.setdefault('a_heat', {})
    t.quiet(8, 60)
    r['passes_before'] = t.count(r'scored in')
    r['state_before'] = t.ev(HEATQ_JS)
    t_on1 = time.monotonic()
    t.click(HEAT, 'heat ON (1)', settle=300)
    ok = t.wait_for(R.HEAT_READY_JS, 120, 'heat visible with pins (1)')
    r['on1_visible_after_s'] = round(time.monotonic() - t_on1, 1) if ok else None
    t.wait(max(0, 20000 - (time.monotonic() - t_on1) * 1000))
    r['state_on1'] = t.ev(HEATQ_JS)
    r['painted_on1'] = t.ev(PAINTED_JS)
    r['passes_on1'] = t.count(r'scored in')
    t.shot('heat-on-1.png')
    # off
    t.click(HEAT, 'heat OFF', settle=3000)
    r['state_off'] = t.ev(HEATQ_JS)
    r['painted_off'] = t.ev(PAINTED_JS)
    r['passes_off'] = t.count(r'scored in')
    t.shot('heat-off.png')
    # on again
    n_before2 = t.count(r'scored in')
    r['passes_before_on2'] = n_before2
    t_on2 = time.monotonic()
    t.page.locator(HEAT).first.click(timeout=8000)
    seen = None
    while time.monotonic() - t_on2 < 10:
        s = t.ev(HEATQ_JS)
        if s and s['heat'] == 'visible' and (s['pins'] or 0) > 0:
            seen = round(time.monotonic() - t_on2, 2)
            break
        t.wait(100)
    r['on2_visible_after_s'] = seen
    t.wait(max(0, 3000 - (time.monotonic() - t_on2) * 1000))
    r['state_on2'] = t.ev(HEATQ_JS)
    r['painted_on2'] = t.ev(PAINTED_JS)
    r['passes_after_on2'] = t.count(r'scored in')
    t.shot('heat-on-2.png')
    tr = t.trace()
    r['trace_passes'] = passes(tr)
    r['trace_heat_clicks'] = [{'t': round(e['t']), 'pressedBefore': e['pressedBefore']} for e in tr if e['k'] == 'heat-click']
    t.note(f'(a) {json.dumps(r)[:900]}')


def d_digin(t, suffix='after', x=130, y=330):
    r = t.out.setdefault(f'd_digin_{suffix}', {})
    got = False
    for attempt in (1, 2, 3):
        t.tap(x, y, f'ground off the pin (attempt {attempt})', settle=500)
        t.wait_for(R.POPUP_WX_JS, 20, 'popup weather line')
        t.wait(1000)
        if t.exists('.pp-digin'):
            got = True
            break
        t.note('no .pp-digin yet; waiting 12 s')
        t.wait(12000)
    r['popup'] = t.ev(POPUP_JS)
    if not got:
        t.note('NO .pp-digin after 3 taps')
        t.shot(f'digin-{suffix}-NOPOPUPROW.png')
        return
    try:
        t.page.locator('.maplibregl-popup').first.screenshot(path=out_path(f'digin-popup-{suffix}.png'))
        t.note(f'shot digin-popup-{suffix}.png')
    except Exception as e:  # noqa: BLE001
        t.note(f'popup element shot failed: {str(e).splitlines()[0][:80]}')
    t.click('.pp-digin', 'popup score row (Dig in)', settle=500)
    t.sheet_ready('Dig in')
    t.wait(2500)
    r['sheet'] = t.ev(DIGIN_JS)
    t.shot(f'digin-{suffix}.png')
    if t.exists('.digin-more'):
        t.click('.digin-more', 'Scoring >', settle=500)
        t.sheet_ready('Scoring')
        t.wait(1500)
        r['scoring'] = t.ev(SCORING_JS)
        t.shot(f'scoring-{suffix}.png')
    t.close_sheets()
    t.note(f'(d {suffix}) score={r.get("sheet", {}).get("score")} reasons={r.get("sheet", {}).get("reasons")} scoring.secs={r.get("scoring", {}).get("secs")}')


def d2_log(t):
    r = t.out.setdefault('d2_log', {})
    # a sighting at P1 through the Game card, as a hunter would
    t.close_sheets()
    t.click(HEARD, 'Game (arm)', settle=800)
    t.tap(130, 330, 'P1: where it was', settle=1200)
    if not t.exists('.ground-card'):
        t.note('no Heard form after the tap')
        r['form'] = False
        return
    r['form'] = True
    t.click('.ground-card button.chip-pick:has-text("Saw it")', 'chip Saw it', settle=500)
    t.shot('log-form.png')
    t.click('.ground-card button.btn-primary', 'Save', settle=1500)
    r['saved_form_gone'] = not t.exists('.ground-card')
    r['equivalence'] = t.ev(LOG_EQ_JS)
    t.note(f'(d2) equivalence {json.dumps(r["equivalence"])}')
    # Dig in 16 px (about 200 m) east of the sighting: the log's pull is in its reasons and its parts
    d_digin(t, suffix='logged', x=150, y=330)


def race_probe(t, want_on, name, delays=(350, 200, 550)):
    """Heat is now (not want_on). Pick an hour (a pass is scheduled), toggle the heat at +delay, let it settle, read."""
    results = []
    for attempt, delay in enumerate(delays):
        pre = t.ev(HEATQ_JS)
        if (pre['pressed'] == 'true') == want_on:
            t.click(HEAT, 'precondition: flip heat', settle=2500)
        t.quiet(3, 40, pat=r'scored in')
        # pick an hour that is not the active one (a new plan time), so a pass is scheduled
        cell = t.page.locator('.wxcell:not(.wx-active)').nth(2 + attempt * 2)
        tr_before = t.trace()
        tr0 = len(tr_before)
        n_sc0 = sum(1 for e in tr_before if e['k'] == 'scored')
        t.note(f'{name} attempt {attempt + 1}: cell click, then heat toggle at +{delay} ms')
        cell.click(timeout=8000, no_wait_after=True)
        t.wait(delay)
        t.page.locator(HEAT).first.click(timeout=8000, no_wait_after=True)
        t.wait_for(f"() => (window.__trace || []).filter(e => e.k === 'scored').length > {n_sc0}", 30, 'a pass ended')
        t.quiet(3, 40, pat=r'scored in')
        t.wait(1500)
        tr = t.trace()[tr0:]
        ps = passes(tr)
        clicks = [round(e['t']) for e in tr if e['k'] == 'heat-click']
        state = t.ev(HEATQ_JS)
        inflight = [p for p in ps for c in clicks if p['start'] < c < p['end']]
        ok = (state['pressed'] == 'true') == want_on and (state['heat'] == 'visible') == want_on and (state['pin'] == 'visible') == want_on
        res = {'attempt': attempt + 1, 'delay': delay, 'wanted': 'on' if want_on else 'off', 'clicks': clicks, 'passes': ps, 'toggledInFlight': bool(inflight), 'state': state, 'correct': ok}
        results.append(res)
        t.note(f'{name} attempt {attempt + 1}: inflight={bool(inflight)} state={state} correct={ok}')
        t.shot(f'{name}-{attempt + 1}.png')
        if inflight:
            break
    t.out.setdefault('a2_race', {})[name] = results


def l1(pw):
    t = T('L1', pw)
    try:
        t.start()
        safe(t, 'a_heat_toggle', a_heat_toggle)
        safe(t, 'd_digin', d_digin)
        safe(t, 'd2_log', d2_log)
        safe(t, 'race_on', lambda t: race_probe(t, True, 'heat-race-on'))
        # heat is on after race_on: now the other direction
        safe(t, 'race_off', lambda t: race_probe(t, False, 'heat-race-off'))
    finally:
        t.finish()


# ---------------------------------------------------------------- L2

def b_armed(t):
    r = t.out.setdefault('b_armed', {})
    t.quiet(8, 60)
    t.click(HEARD, 'Game (arm)', settle=1500)
    r['1_after_game'] = t.ev(ARMED_JS)
    t.shot('armed-1.png')
    t.click(MEASURE, 'Measure', settle=1800)
    r['2_after_measure'] = t.ev(ARMED_JS)
    t.shot('armed-2-measure.png')
    t.tap(140, 330, 'measure point 1')
    t.tap(310, 560, 'measure point 2', settle=1800)
    r['3_two_points'] = t.ev(ARMED_JS)
    t.shot('armed-3-two-points.png')
    t.click('.measure-card .sheet-done', 'measure Done', settle=1500)
    r['4_after_done'] = t.ev(ARMED_JS)
    t.tap(130, 330, 'the map once more', settle=3000)
    r['5_after_tap'] = t.ev(ARMED_JS)
    r['5_popup'] = t.ev(POPUP_JS)
    t.shot('armed-after-done.png')
    t.note(f'(b) {json.dumps({k: (v.get("partyN"), v.get("heardPressed"), v.get("measureCard"), v.get("heardForm"), v.get("popups")) for k, v in r.items() if isinstance(v, dict) and "partyN" in v})}')


def wait_routes(t, timeout=60):
    return t.wait_for(R.ROUTES_READY_JS, timeout, 'routes answered')


def c_routes_ruler(t):
    r = t.out.setdefault('c_routes', {})
    t.click(ROUTES, 'Routes', settle=2500)
    t.tap(110, 560, 'route destination (far end)', settle=500)
    wait_routes(t)
    t.wait(2500)
    r['card'] = t.ev(ARMED_JS)
    t.shot('routes-to-2.png')
    t.click(MEASURE, 'Measure (route card closes, route stays)', settle=2200)
    r['after_measure_open'] = t.ev(ARMED_JS)
    g = t.ev(ROUTE_GEOM_JS)
    r['geom_features'] = None if not g else g['features']
    r['layer_order'] = None if not g else g['order']
    r['layers_total'] = None if not g else g['total']
    if not g:
        t.note('no routes-line feature rendered: cannot place the ruler across the route')
        t.shot('measure-over-route-NOROUTE.png')
        return
    pts = g['pts']
    # the polyline inside the safe box, its middle by length
    safe_pts = [p for p in pts if 80 <= p[0] <= 350 and 160 <= p[1] <= 520]
    use = safe_pts if len(safe_pts) >= 2 else pts
    seg = [(use[i], use[i + 1]) for i in range(len(use) - 1)]
    lens = [((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2) ** 0.5 for a, b in seg]
    half = sum(lens) / 2
    acc = 0
    mid = None
    tang = None
    for (a, b), l in zip(seg, lens):
        if acc + l >= half and l > 0:
            f = (half - acc) / l
            mid = (a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f)
            tang = ((b[0] - a[0]) / l, (b[1] - a[1]) / l)
            break
        acc += l
    if mid is None:
        t.note('route has no length in the safe box')
        return
    nrm = (-tang[1], tang[0])
    pa = pb = None
    for d in (75, 60, 45, 35):
        a = (mid[0] + nrm[0] * d, mid[1] + nrm[1] * d)
        b = (mid[0] - nrm[0] * d, mid[1] - nrm[1] * d)
        if all(70 <= p[0] <= 360 and 150 <= p[1] <= 540 for p in (a, b)):
            pa, pb = a, b
            break
    r['mid'] = mid
    r['tangent'] = tang
    r['pa'] = pa
    r['pb'] = pb
    if not pa:
        t.note('no perpendicular pair fits the safe box')
        return
    t.tap(pa[0], pa[1], 'ruler point A (one side of the route)')
    t.tap(pb[0], pb[1], 'ruler point B (the other side)', settle=2500)
    r['after_points'] = t.ev(ARMED_JS)
    path = out_path('measure-over-route.png')
    t.shot('measure-over-route.png')
    g2 = t.ev(ROUTE_GEOM_JS)
    r['layer_order_after'] = g2['order'] if g2 else None
    try:
        from PIL import Image
        im = Image.open(path).convert('RGB')
        k = B.CFG.dpr
        cx, cy = int(round(mid[0] * k)), int(round(mid[1] * k))
        crop = im.crop((cx - 40, cy - 40, cx + 40, cy + 40)).resize((640, 640), Image.NEAREST)
        crop.save(out_path('measure-over-route-zoom.png'))
        px = [im.getpixel((cx + dx, cy + dy)) for dx in (-1, 0, 1) for dy in (-1, 0, 1)]
        r['crossing_pixels'] = [list(p) for p in px]
        r['crossing_centre'] = list(im.getpixel((cx, cy)))
    except Exception as e:  # noqa: BLE001
        r['pixel_error'] = str(e)[:120]
    o = r.get('layer_order_after') or r.get('layer_order') or {}
    r['measure_above_route'] = bool(o and o.get('measure-line', -1) > o.get('routes-line', 99999))
    t.note(f'(c) layer order {o}  measure_above_route={r["measure_above_route"]}  centre pixel {r.get("crossing_centre")}')
    t.click('.measure-card .sheet-done', 'measure Done', settle=1200)


def c2_route_card_releases(t):
    r = t.out.setdefault('c2_route_card', {})
    t.click(HEARD, 'Game (arm)', settle=1200)
    r['armed'] = t.ev(ARMED_JS)
    t.click(ROUTES, 'Routes (opens the card)', settle=2500)
    r['after_routes'] = t.ev(ARMED_JS)
    t.shot('armed-then-routes.png')
    t.click(ROUTES, 'Routes (close)', settle=1200)
    r['after_close'] = t.ev(ARMED_JS)
    t.note(f'(c2) armed line then {r["armed"]["partyN"]}; after Routes {r["after_routes"]["partyN"]}, heard pressed {r["after_routes"]["heardPressed"]}')


def windcheck_smoke(t):
    """Sharpen the wind: the check card with its rose (Rose.tsx and the check form lost props in a dead-code cut once)."""
    r = t.out.setdefault('windcheck', {})
    WC = 'button[data-hot="windcheck"]'
    t.click(WC, 'Sharpen the wind', settle=2000)
    r['card'] = t.ev("() => ({cards: document.querySelectorAll('.ground-card').length, rose: document.querySelectorAll('.gc-rose').length, arrows: document.querySelectorAll('.gc-rose button').length, text: (document.querySelector('.ground-card')?.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 260)})")
    t.shot('windcheck-card.png')
    if t.exists('.gc-rose button'):
        t.page.locator('.gc-rose button').nth(2).click(timeout=5000)
        t.wait(700)
        r['lit'] = t.ev("() => [...document.querySelectorAll('.gc-rose button')].filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.getAttribute('aria-label'))")
        t.shot('windcheck-picked.png')
    # the card closes with a tap off it, the map included: its own hot button is under the card, out of reach (a click on it timed out
    # for 8 s, left the card up, and hid the grade tile from the check that follows)
    t.tap(215, 120, 'tap off the card (the map)', settle=1200)
    r['closed'] = not t.exists('.ground-card')
    t.note(f'(windcheck) {json.dumps(r)[:400]}')


def grade_sheet(t):
    r = t.out.setdefault('grade', {})
    if not t.exists('button.grade-tag'):
        r['present'] = False
        return
    r['present'] = True
    r['tag'] = t.ev("() => document.querySelector('button.grade-tag').innerText.trim()")
    t.click('button.grade-tag', 'grade tile', settle=500)
    t.sheet_ready('grade')
    t.wait(1500)
    r['sheet'] = t.ev("() => (document.querySelector('.sheet')?.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 600)")
    t.shot('grade-sheet.png')
    t.close_sheets()


def l2(pw):
    t = T('L2', pw)
    try:
        t.start()
        safe(t, 'b_armed', b_armed)
        safe(t, 'c_routes_ruler', c_routes_ruler)
        safe(t, 'c2_route_card_releases', c2_route_card_releases)
        safe(t, 'windcheck_smoke', windcheck_smoke)
        safe(t, 'grade_sheet', grade_sheet)
    finally:
        t.finish()


# ---------------------------------------------------------------- L3: the heat tapped early, while the first passes run

def l3(pw, delays=(1.5, 4.0, 7.0)):
    """A fresh load per delay: the heat button tapped `delay` s after the load event (a hunter who opens the app and taps it at once),
    then left alone until the passes are done. The page trace says whether the tap fell inside a scoring pass."""
    for d in delays:
        t = T(f'L3-{d}', pw)
        try:
            t.page.goto(B.CFG.url, wait_until='load', timeout=90000)
            t0 = time.monotonic()
            t.wait(max(0, d * 1000 - (time.monotonic() - t0) * 1000))
            ok = t.click(HEAT, f'heat tap at +{d} s', settle=0, timeout=15000)
            t.out['click_ok'] = ok
            t.wait(45000)  # every boot pass is done by then
            st = t.ev(HEATQ_JS)
            tr = t.trace()
            ps = passes(tr)
            clicks = [round(e['t']) for e in tr if e['k'] == 'heat-click']
            infl = [p for p in ps for c in clicks if p['start'] < c < p['end']]
            t.out['early'] = {'delay': d, 'state': st, 'clicks': clicks, 'passes': ps, 'tapInsidePass': bool(infl),
                              'correct': bool(st and st['pressed'] == 'true' and st['heat'] == 'visible' and (st['pins'] or 0) > 0)}
            t.note(f'(L3 {d}) {json.dumps(t.out["early"])}')
            t.shot(f'heat-early-{d}.png')
        except Exception as e:  # noqa: BLE001
            t.note(f'L3 {d} ERROR {type(e).__name__}: {str(e)[:150]}')
        finally:
            t.finish()


def main():
    rest = B.configure(sys.argv[1:], default_name='targeted')
    want = [w.upper() for w in rest] or ['L1', 'L2']
    bad = [w for w in want if w not in ('L1', 'L2', 'L3')]
    if bad:
        sys.exit(f'unknown load {bad}: L1, L2 or L3')
    print(f'{B.CFG.url}  ->  {B.CFG.out}   Open-Meteo: {"replayed" if B.CFG.replay else "LIVE (spends quota)"}   clock: {B.CFG.clock or "real"}', flush=True)
    with sync_playwright() as pw:
        if 'L1' in want:
            l1(pw)
        if 'L2' in want:
            l2(pw)
        if 'L3' in want:
            l3(pw)
    return 0


if __name__ == '__main__':
    sys.exit(main())
