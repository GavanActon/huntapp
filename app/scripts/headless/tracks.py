"""Tracks storage checks: migration, a walk, reopen / rename / delete.

    py -3.14 scripts/headless/tracks.py --url http://localhost:5199/ --name tracks [A] [B] [C]      (default all three; C needs A's storage)

What it checks (c54733f): every track under its own localStorage key ('huntapp-track:<id>') with the ids in 'huntapp-tracks:index'; the one
old value 'huntapp-tracks' split once on load; a walk's points written 20 s after the first unsaved one (a track started / stopped / renamed /
removed: 2 s); hide, pagehide and an area switch flush; the trail redrawn 3 s after a point is kept.

A  migration     'huntapp-tracks' (two Track objects, 5 points each, a day ago; the second left OPEN: endedAt null) set before the app loads
                 -> index + a key per track + no legacy key; initTrackRecording closes the open one and writes it; the Hunt log lists both
B  walk          fresh context: locate, then the fix moved 0.00007 deg (7.8 m) every 2 s, accuracy 8, 25 steps (50 s). The trail source, the
                 store, the write log (Storage.setItem wrapper) and the stored track are sampled every 500 ms in the page. Then (extras) stop,
                 resume, a synthetic 'hidden' flush, and page.goto('about:blank') (pagehide) with unsaved points; the stored track is read
                 back with context.storage_state()
C                fresh context seeded with A's storage afterwards (index + per-track keys, no legacy key): both outings listed; rename one,
                 delete the other (Outing card -> more -> Rename / Delete); the keys and the index follow

Same context as scenarios.py (the fix has accuracy 8; Open-Meteo replayed) and the same options, except --clock: the walk is timed by the
page's Date, so a held clock is refused. Dev-only globals used: window.__map, window.__gps, and the app's trackStore module (by the URL the
page loaded it from).
Output (in the run folder): <name>.png, TR-A-migration / TR-B-walk / TR-C-reopen-delete .json and .console.txt, A.storage.json.
"""
import json
import os
import re
import sys
import time
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright

import scenarios as B
import targeted as TG

ACC = 8
STEP_DEG = 0.00007  # 7.78 m of latitude

# ---------------------------------------------------------------- page scripts

LSW_JS = r"""
(() => {
  // every write to / removal of a huntapp-track* key, as it happens (wall clock)
  window.__lsw = []
  const si = Storage.prototype.setItem, ri = Storage.prototype.removeItem
  const rec = (op, k, n) => { try { if (/^huntapp-track/.test(k)) window.__lsw.push({ ms: Date.now(), op, k, n }) } catch (e) { /* never break the page */ } }
  Storage.prototype.setItem = function (k, v) { if (this === window.localStorage) rec('set', String(k), String(v).length); return si.call(this, k, v) }
  Storage.prototype.removeItem = function (k) { if (this === window.localStorage) rec('remove', String(k), 0); return ri.call(this, k) }
})()
"""

LEGACY_JS = r"""
(() => {
  const now = Date.now(), H = 3600e3, MIN = 60e3
  const R = 6371008.8, rad = Math.PI / 180
  const hav = (a, b) => { const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad; const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)) }
  const make = (id, name, agoH, lat, lon, dLat, dLon, open) => {
    const t0 = now - agoH * H
    const points = Array.from({ length: 5 }, (_, i) => ({ lon: +(lon + i * dLon).toFixed(6), lat: +(lat + i * dLat).toFixed(6), ts: Math.round(t0 + i * 4 * MIN) }))
    let d = 0
    for (let i = 1; i < points.length; i++) d += hav(points[i - 1], points[i])
    return { id, name, startedAt: points[0].ts, endedAt: open ? null : points[points.length - 1].ts, points, distanceM: d }
  }
  // 445 m north and 440 m east of the camp (the log drops a stretch of track points within 150 m of a camp), 4.7 h apart, 100+ m apart
  const tracks = [
    make('t-mig-a', 'Migration A', 27, 48.9349, -85.5944, 0.0003, 0.0001, false),
    make('t-mig-b', 'Migration B', 22, 48.9299, -85.5874, 0.0001, 0.0002, true),
  ]
  window.__seed = JSON.stringify(tracks)
  try {
    if (localStorage.getItem('huntapp-tracks:index') === null && localStorage.getItem('huntapp-tracks') === null) localStorage.setItem('huntapp-tracks', window.__seed)
  } catch (e) { /* storage blocked */ }
})()
"""

# the store module the app itself loaded (its URL carries ?t= after an HMR edit, so a plain import() would be another instance),
# the trail source's setData wrapped, a 500 ms sampler, and listeners AFTER the app's own on hide / pagehide that log what storage holds then
SETUP_JS = r"""
async (url) => {
  let mod = null, via = null
  try { mod = await import(url); via = url } catch (e) { via = 'url failed: ' + String(e).slice(0, 80) }
  if (!mod) { try { mod = await import('/src/tracking/trackStore.ts'); via = 'plain' } catch (e) { return { ok: false, via, err: String(e).slice(0, 120) } } }
  window.__ts = mod
  const m = window.__map
  const curSrc = () => { try { return m && m.getSource('tracks') } catch (e) { return null } }
  const cnt = (d) => {
    try {
      let n = 0
      for (const f of (d && d.features) || []) {
        if (f.properties && f.properties.gap) continue
        const g = f.geometry
        for (const l of g.type === 'MultiLineString' ? g.coordinates : [g.coordinates]) n += l.length
      }
      return n
    } catch (e) { return -1 }
  }
  const trailData = () => { try { const s = curSrc(); return s ? (s.serialize ? s.serialize().data : s._data) : null } catch (e) { return null } }
  window.__trail = () => { const d = trailData(); return { n: cnt(d), features: d && d.features ? d.features.length : null, live: d && d.features ? d.features.map((f) => !!(f.properties && f.properties.live)) : null } }
  window.__sets = []
  const wrap = () => {
    const s = curSrc()
    if (s && !s.__wrapped) {
      const orig = s.setData.bind(s)
      s.setData = (d) => { window.__sets.push({ ms: Date.now(), n: cnt(d) }); return orig(d) }
      s.__wrapped = true
    }
    return !!(s && s.__wrapped)
  }
  const src = curSrc()
  wrap()
  const mem = () => {
    const s = mod.useTrackStore.getState()
    const rec = s.tracks.find((x) => x.id === s.recordingId)
    const last = rec && rec.points[rec.points.length - 1]
    return {
      rec: s.recordingId, n: rec ? rec.points.length : null, tracks: s.tracks.length,
      firstTs: rec && rec.points[0] ? rec.points[0].ts : null, lastTs: last ? last.ts : null, lastLat: last ? last.lat : null, lastLon: last ? last.lon : null,
      all: Object.fromEntries(s.tracks.map((t) => [t.id, { n: t.points.length, lastTs: t.points.length ? t.points[t.points.length - 1].ts : null, endedAt: t.endedAt, name: t.name }])),
    }
  }
  const stored = () => {
    let idx = null, ids = [], tr = {}
    try { idx = localStorage.getItem('huntapp-tracks:index'); ids = JSON.parse(idx || '[]') } catch (e) { /* bad index */ }
    for (const id of ids) {
      try {
        const raw = localStorage.getItem('huntapp-track:' + id)
        if (!raw) { tr[id] = null; continue }
        const t = JSON.parse(raw)
        const last = t.points[t.points.length - 1]
        tr[id] = { n: t.points.length, lastTs: last ? last.ts : null, lastLat: last ? last.lat : null, lastLon: last ? last.lon : null, endedAt: t.endedAt, name: t.name }
      } catch (e) { tr[id] = 'bad json' }
    }
    return { idx, tr, legacy: localStorage.getItem('huntapp-tracks') !== null, keys: Object.keys(localStorage).filter((k) => /^huntapp-track/.test(k)).sort() }
  }
  window.__snap = () => ({ ms: Date.now(), mem: mem(), stored: stored(), trail: window.__trail() })
  window.__tl = []
  window.__tlTimer = setInterval(() => {
    wrap()
    const mm = mem(), st = stored()
    window.__tl.push({ ms: Date.now(), rec: mm.rec, n: mm.n, firstTs: mm.firstTs, lastTs: mm.lastTs, trail: window.__trail().n, idx: st.idx, st: Object.fromEntries(Object.entries(st.tr).map(([k, v]) => [k, v && v.n])), legacy: st.legacy })
  }, 500)
  const logEv = (e) => {
    try {
      const a = JSON.parse(localStorage.getItem('__ev') || '[]')
      const sn = window.__snap()
      a.push({ ev: e.type, ms: Date.now(), vis: document.visibilityState, storedAfterAppHandler: sn.stored.tr, mem: sn.mem.all })
      localStorage.setItem('__ev', JSON.stringify(a))
    } catch (x) { /* storage blocked */ }
  }
  window.addEventListener('pagehide', logEv)
  document.addEventListener('visibilitychange', logEv)
  return { ok: true, via, tracksInStore: mem().tracks, haveSource: !!src, wrapped: wrap(), snap: window.__snap() }
}
"""

HUNTLOG_JS = r"""
() => {
  const t = (e) => (e ? e.innerText.replace(/\s+/g, ' ').trim() : null)
  return {
    days: [...document.querySelectorAll('.log-day')].map((d) => ({
      head: t(d.querySelector('.log-day-head')), open: d.querySelector('.log-day-head')?.getAttribute('aria-expanded'),
      rows: [...d.querySelectorAll('.log-ev')].map((r) => ({ kind: (r.querySelector('.log-ev-mark')?.className || '').replace('log-ev-mark ', ''), text: t(r) })),
    })),
    outingRows: document.querySelectorAll('.log-ev .log-k-outings').length,
    chips: [...document.querySelectorAll('.log-filters .chip-pick')].map(t),
    empty: t(document.querySelector('.log .empty')),
  }
}
"""

OUTING_CARD_JS = r"""
() => { const c = document.querySelector('.topcard[aria-label="Outing"]'); return c ? c.innerText.replace(/\s+/g, ' ').trim().slice(0, 200) : null }
"""

out_path = TG.out_path


def ls_of(state):
    """The app origin's localStorage out of a context.storage_state() as {key: value}."""
    u = urlsplit(B.CFG.url)
    origin = f'{u.scheme}://{u.netloc}'
    for o in state.get('origins', []):
        if o['origin'].startswith(origin):
            return {i['name']: i['value'] for i in o['localStorage']}
    return {}


# ---------------------------------------------------------------- the load

class TK(TG.T):
    """TG.T (plumbing, notes, readiness) with a fix of accuracy 8, an optional storage state, init scripts, and dialog handling."""

    def __init__(self, name, pw, init_js=(), storage_state=None):
        super().__init__(name, pw, init_scripts=(LSW_JS, *init_js), accuracy=ACC, storage_state=storage_state)
        self.reqs, self.dialogs, self.prompt_reply = [], [], ''
        self.page.on('request', lambda r: self.reqs.append(r.url) if '/src/tracking/trackStore' in r.url else None)
        self.page.on('dialog', self._dialog)

    def _dialog(self, d):
        self.dialogs.append({'type': d.type, 'message': d.message[:200], 'default': d.default_value})
        self.note(f'dialog {d.type}: {d.message[:90]!r}')
        if d.type == 'prompt':
            d.accept(self.prompt_reply)
        elif d.type == 'confirm' and not d.message.startswith('Delete'):
            d.dismiss()  # anything else (a 'Go anyway?') is not part of these checks
        else:
            d.accept()

    def setup_handles(self):
        url = next((u for u in self.reqs if re.search(r'/src/tracking/trackStore\.ts(\?|$)', u)), '/src/tracking/trackStore.ts')
        r = self.ev(SETUP_JS, url)
        self.out['setup'] = {k: v for k, v in r.items() if k != 'snap'}
        self.note(f'handles: {json.dumps({k: v for k, v in r.items() if k != "snap"})[:300]} (module request: {url[-70:]})')
        return r

    def snap(self):
        return self.ev('() => window.__snap()')

    def ls_now(self):
        """The app origin's whole localStorage as the browser holds it (works with the page gone)."""
        return ls_of(self.ctx.storage_state())

    def open_huntlog(self):
        self.click(B.DOTS, 'strip ⋯ (More)', settle=600)
        ok = self.click('.wx-menu-row:has-text("Hunt log")', 'menu -> Hunt log', settle=500)
        ok = ok and self.sheet_ready('Hunt log')
        self.wait(1500)
        return ok

    def expand_days(self):
        for _ in range(8):
            heads = self.page.locator('.log-day-head[aria-expanded="false"]')
            if heads.count() == 0:
                break
            heads.first.click(timeout=5000)
            self.wait(400)
        self.wait(500)

    def expand_sheet(self):
        """The sheet's handle (Expand) so every row is on the screen for the shot; harmless when there is none."""
        try:
            h = self.page.locator('.sheet .sheet-handle[aria-label="Expand"]')
            if h.count():
                h.first.click(timeout=3000)
                self.wait(900)
                self.note('sheet expanded')
        except Exception as e:  # noqa: BLE001
            self.note(f'expand handle: {str(e).splitlines()[0][:80]}')


def keys_summary(ls):
    """Compact view of the huntapp-track* keys of a localStorage dict."""
    out = {}
    for k, v in sorted(ls.items()):
        if k.startswith('huntapp-track'):
            try:
                j = json.loads(v)
            except Exception:  # noqa: BLE001
                j = None
            if k == 'huntapp-tracks:index':
                out[k] = j
            elif k == 'huntapp-tracks':
                out[k] = f'LEGACY VALUE present ({len(v)} chars)'
            else:
                out[k] = {'points': len(j['points']), 'endedAt': j.get('endedAt'), 'name': j.get('name'), 'bytes': len(v)} if isinstance(j, dict) else 'unparsable'
    return out


def t_rel(ms, t0):
    return None if ms is None or t0 is None else round((ms - t0) / 1000, 1)


# ---------------------------------------------------------------- A: migration

def a_migration(pw):
    t = TK('TR-A-migration', pw, init_js=(LEGACY_JS,))
    try:
        t.start()
        r = t.out.setdefault('a', {})
        t.setup_handles()
        seed = json.loads(t.ev('() => window.__seed'))
        r['seed'] = [{'id': s['id'], 'name': s['name'], 'points': len(s['points']), 'endedAt': s['endedAt'], 'distanceM': round(s['distanceM'])} for s in seed]
        t.wait(3000)  # past initTrackRecording's 2 s save (it closes the open track)
        ls = t.ls_now()
        r['keys_after_load'] = keys_summary(ls)
        r['legacy_key_present'] = 'huntapp-tracks' in ls
        idx = json.loads(ls.get('huntapp-tracks:index') or 'null')
        r['index'] = idx
        r['index_is_both_ids'] = idx == [s['id'] for s in seed]
        eq = {}
        for s in seed:
            raw = ls.get(f'huntapp-track:{s["id"]}')
            got = json.loads(raw) if raw else None
            if got is None:
                eq[s['id']] = 'MISSING'
            else:
                same = got == s
                diff = sorted(k for k in set(s) | set(got) if s.get(k) != got.get(k))
                eq[s['id']] = 'identical to the legacy track' if same else f'differs in {diff} (endedAt: {s["endedAt"]} -> {got.get("endedAt")}, last point ts {s["points"][-1]["ts"]})'
        r['stored_vs_legacy'] = eq
        lsw = t.ev('() => window.__lsw')
        w0 = lsw[0]['ms'] if lsw else None
        r['write_log'] = [{'t_s': t_rel(w['ms'], w0), 'op': w['op'], 'key': w['k'], 'chars': w['n']} for w in lsw]
        t.note(f'(A) keys {json.dumps(r["keys_after_load"])[:420]}')
        t.note(f'(A) index {idx}  both ids: {r["index_is_both_ids"]}  legacy key present: {r["legacy_key_present"]}')
        t.note(f'(A) stored vs legacy {json.dumps(eq)[:420]}')
        t.note(f'(A) write log {json.dumps(r["write_log"])[:600]}')
        # the Hunt log
        if t.open_huntlog():
            r['huntlog_folded'] = t.ev(HUNTLOG_JS)
            t.shot('huntlog-migrated-folded.png')
            t.expand_days()
            t.expand_sheet()
            r['huntlog'] = t.ev(HUNTLOG_JS)
            t.shot('huntlog-migrated.png')
            t.note(f'(A) hunt log outing rows: {r["huntlog"]["outingRows"]}  days: {json.dumps([(d["head"], d["open"], [x["text"] for x in d["rows"]]) for d in r["huntlog"]["days"]])[:500]}')
        else:
            t.note('(A) Hunt log did not open')
        # keep this storage for C
        t.ctx.storage_state(path=out_path('A.storage.json'))
        r['snap_end'] = t.snap()
        r['verdict'] = {
            'index_both': r['index_is_both_ids'], 'per_track_keys': all(isinstance(v, dict) for k, v in r['keys_after_load'].items() if k.startswith('huntapp-track:')) and sum(1 for k in r['keys_after_load'] if k.startswith('huntapp-track:')) == 2,
            'no_legacy': not r['legacy_key_present'], 'two_outings_listed': r.get('huntlog', {}).get('outingRows') == 2,
        }
        t.note(f'(A) verdict {r["verdict"]}')
    finally:
        t.finish()


# ---------------------------------------------------------------- B: walk

def set_fix(t, lat, acc=ACC):
    t.ctx.set_geolocation({'latitude': lat, 'longitude': B.LON0, 'accuracy': acc})


def step_to(t, base, k, dt=2.0):
    """Wait until base + k*dt (wall clock) and move the fix to step k (latitude LAT0 + k * STEP_DEG)."""
    t.wait(max(0, (base + dt * k - time.time()) * 1000))
    set_fix(t, B.LAT0 + STEP_DEG * k)


def points_now(t):
    n = t.ev('() => window.__snap().mem.n')
    return n if n is not None else -1


def walk_on(t, k_from, n_max, until=None, dt=2.0):
    """Carry on from step k_from, one step every dt s, until `until()` is true (checked 0.4 s after each step) or n_max steps; returns the step reached."""
    base = time.time()
    k = k_from
    for i in range(1, n_max + 1):
        k = k_from + i
        t.wait(max(0, (base + dt * i - time.time()) * 1000))
        set_fix(t, B.LAT0 + STEP_DEG * k)
        if until is not None:
            t.wait(400)
            if until():
                break
    return k


def b_walk(pw):
    t = TK('TR-B-walk', pw)
    try:
        t.start()
        r = t.out.setdefault('b', {})
        t.setup_handles()
        ls0 = t.ls_now()
        r['keys_before_locate'] = keys_summary(ls0)
        r['legacy_before'] = 'huntapp-tracks' in ls0
        # a fresh position for the app to start from: the context's own was set when the browser started, and the app drops a fix older than 20 s as stale
        set_fix(t, B.LAT0)
        t.wait(400)
        t.click(B.LOCATE, 'My location (start the walk)', settle=1000)
        ok = t.wait_for("() => { const s = window.__ts.useTrackStore.getState(); const r = s.tracks.find((x) => x.id === s.recordingId); return !!r && r.points.length >= 1 }", 40, 'first point kept (store)')
        r['first_point_kept'] = ok
        gps = t.ev('() => { const g = window.__gps.getState(); return { locating: g.locating, status: g.status, fix: g.fix && { lat: g.fix.lat, acc: g.fix.accuracy, sigma: g.fix.sigma } } }')
        r['gps_at_start'] = gps
        t.note(f'gps at start: {json.dumps(gps)}')
        # ---- the walk: 25 steps, one every 2 s
        base = time.time()
        steps = []
        for k in range(1, 26):
            step_to(t, base, k)
            steps.append(round(time.time() - base, 2))
        r['steps_s'] = steps
        t_last = time.time()
        t.note(f'walk done: {len(steps)} moves, the last at +{steps[-1]} s')
        # ---- trail within a few seconds of the last move
        trail_seen = None
        while time.time() - t_last < 8:
            sn = t.snap()
            if sn['mem']['n'] is not None and sn['trail']['n'] == sn['mem']['n']:
                trail_seen = round(time.time() - t_last, 1)
                break
            t.wait(250)
        sn = t.snap()
        r['end_of_walk'] = {'mem_points': sn['mem']['n'], 'trail_points': sn['trail']['n'], 'trail_features': sn['trail']['features'], 'trail_live': sn['trail']['live'],
                            'trail_matches_store_after_s': trail_seen, 'stored': sn['stored']['tr'], 'index': sn['stored']['idx'], 'legacy': sn['stored']['legacy']}
        t.note(f'end of walk: store {sn["mem"]["n"]} points, trail source {sn["trail"]["n"]} points ({sn["trail"]["features"]} feature(s), live={sn["trail"]["live"]}), matches after {trail_seen} s; stored {sn["stored"]["tr"]}')
        # the trail on the screen: fit the camera round it (the follow mode only moves on a new fix), then the shot
        t.ev(f"() => {{ const m = window.__map; m.jumpTo({{ center: [{B.LON0}, {B.LAT0 + STEP_DEG * 12}], zoom: 16.4 }}) }}")
        t.wait(2500)
        t.shot('walk-trail.png')
        # ---- the timeline, from the in-page sampler and the write log
        tl = t.ev('() => window.__tl')
        sets = t.ev('() => window.__sets')
        lsw = t.ev('() => window.__lsw')
        first = next((s['firstTs'] for s in tl if s['firstTs']), None)
        r['first_kept_ts'] = first
        writes = [{'t_s': t_rel(w['ms'], first), 'op': w['op'], 'key': w['k'], 'chars': w['n']} for w in lsw]
        r['writes'] = writes
        r['track_key_writes_in_walk'] = sum(1 for w in lsw if w['k'].startswith('huntapp-track:') and w['op'] == 'set')
        r['index_writes_in_walk'] = sum(1 for w in lsw if w['k'] == 'huntapp-tracks:index' and w['op'] == 'set')
        r['legacy_writes'] = sum(1 for w in lsw if w['k'] == 'huntapp-tracks')
        # stored count over time
        stc = []
        prev = None
        for s in tl:
            v = [x for x in s['st'].values() if x is not None]
            cur = v[0] if v else None
            if cur != prev:
                stc.append({'t_s': t_rel(s['ms'], first), 'stored_points': cur, 'store_points': s['n'], 'trail_points': s['trail']})
                prev = cur
        r['stored_count_changes'] = stc
        # trail lag: for each store count v, how long until the trail source held v points
        lag = []
        seen_mem = {}
        for s in tl:
            if s['n'] is not None:
                seen_mem.setdefault(s['n'], s['ms'])
        seen_trail = {}
        for s in tl:
            seen_trail.setdefault(s['trail'], s['ms'])
        for v, ms in sorted(seen_mem.items()):
            if v < 2:
                continue  # one point draws no line
            tt = min((m2 for n2, m2 in seen_trail.items() if n2 >= v), default=None)
            lag.append(None if tt is None else round((tt - ms) / 1000, 1))
        r['trail_lag_s'] = {'per_point': lag, 'max': max([x for x in lag if x is not None], default=None), 'never_drawn': sum(1 for x in lag if x is None)}
        r['setData_calls'] = [{'t_s': t_rel(s['ms'], first), 'points': s['n']} for s in sets]
        r['legacy_key_in_any_sample'] = any(s['legacy'] for s in tl)
        # stored track at +25 s from the first kept point (nearest sample), and when it first held 3+ points
        near = min(tl, key=lambda s: abs((s['ms'] - first) / 1000 - 25)) if first else None
        if near:
            r['at_plus_25s'] = {'t_s': t_rel(near['ms'], first), 'index': near['idx'], 'stored': near['st'], 'store_points': near['n'], 'trail_points': near['trail']}
        r['stored_ge3_first_seen_s'] = next((t_rel(s['ms'], first) for s in tl if any((x or 0) >= 3 for x in s['st'].values())), None)
        t.note(f'(B) track-key writes in the walk: {r["track_key_writes_in_walk"]} (index writes {r["index_writes_in_walk"]}, legacy writes {r["legacy_writes"]}) for {sn["mem"]["n"]} points kept; times {[(w["t_s"], w["key"][-8:]) for w in writes]}')
        t.note(f'(B) stored count changes {json.dumps(stc)[:500]}')
        t.note(f'(B) at +25 s {json.dumps(r.get("at_plus_25s"))}; stored >= 3 points first seen at +{r["stored_ge3_first_seen_s"]} s; trail lag max {r["trail_lag_s"]["max"]} s; setData calls {len(sets)}')
        stored_ns = [v['n'] for v in r['end_of_walk']['stored'].values() if isinstance(v, dict)]
        r['walk_verdict'] = {
            'trail_has_multilinestring_with_several_points': sn['trail']['n'] >= 3 and sn['trail']['features'] in (1, 2),
            'trail_matches_store_within_a_few_s': trail_seen is not None and trail_seen <= 5,
            'index_has_one_id': bool(sn['stored']['idx']) and len(json.loads(sn['stored']['idx'])) == 1,
            'stored_track_has_several_points': any(n >= 3 for n in stored_ns),
            'legacy_absent_throughout': not r['legacy_key_in_any_sample'] and not r['legacy_before'] and r['legacy_writes'] == 0,
        }
        t.note(f'(B) verdict {r["walk_verdict"]}')

        # ---- extras: stop, resume, synthetic hide, pagehide (the fix stays where step 25 left it)
        r['k_now'] = 25
        safe_extra(t, 'stop_resume', lambda: b_stop_resume(t, r))
        safe_extra(t, 'pagehide', lambda: b_pagehide(t, r))
    finally:
        t.finish()


def safe_extra(t, name, fn):
    try:
        fn()
    except Exception as e:  # noqa: BLE001
        msg = f'{type(e).__name__}: {str(e).splitlines()[0][:200]}'
        t.note(f'EXTRA {name} ERROR {msg}')
        t.out.setdefault('errors', []).append(f'{name}: {msg}')


def b_stop_resume(t, r):
    x = r.setdefault('stop_resume', {})
    g = lambda: t.ev('() => { const s = window.__gps.getState(); return { locating: s.locating, status: s.status } }')  # noqa: E731
    x['before'] = g()
    rec_id = t.snap()['mem']['rec']
    x['recording_id'] = rec_id
    taps = 0
    st = x['before']
    while st['locating'] and taps < 3:
        t.click(B.LOCATE, f'My location (tap {taps + 1}, to turn it off)', settle=1200)
        taps += 1
        st = g()
    x['taps_to_stop'] = taps
    x['after_stop_gps'] = st
    t.wait(2800)  # stop() saves in 2 s
    sn = t.snap()
    x['after_stop'] = {'recording': sn['mem']['rec'], 'trail_points': sn['trail']['n'], 'stored': sn['stored']['tr'], 'store': sn['mem']['all']}
    t.note(f'(B stop) taps {taps}, gps {st}; recording now {sn["mem"]["rec"]}; trail {sn["trail"]["n"]} points; stored {sn["stored"]["tr"]}; store {sn["mem"]["all"]}')
    # location on again: the last track is picked up again (its last point is minutes old)
    t.click(B.LOCATE, 'My location (on again)', settle=1500)
    t.wait_for("() => !!window.__ts.useTrackStore.getState().recordingId", 20, 'recording again')
    t.wait(2800)
    sn = t.snap()
    x['after_resume'] = {'recording': sn['mem']['rec'], 'same_track_resumed': sn['mem']['rec'] == rec_id, 'stored': sn['stored']['tr'], 'tracks_in_index': sn['stored']['idx']}
    t.note(f'(B resume) recording {sn["mem"]["rec"]} (the same track: {sn["mem"]["rec"] == rec_id}); stored {sn["stored"]["tr"]}; index {sn["stored"]["idx"]}')


def b_pagehide(t, r):
    x = r.setdefault('pagehide', {})
    n0 = points_now(t)
    # ---- keep walking until a new point is kept (an unsaved one), then the synthetic 'hidden' (the phone pocketed)
    k = walk_on(t, r['k_now'], 10, until=lambda: points_now(t) > n0)
    r['k_now'] = k
    got = points_now(t) > n0
    sn = t.snap()
    x['unsaved_before_hide'] = {'got_new_point': got, 'store_points': sn['mem']['n'], 'stored': sn['stored']['tr']}
    t.note(f'(B hide) new point kept: {got}; store {sn["mem"]["n"]} points, stored {sn["stored"]["tr"]}')
    flush = t.ev("""() => {
      const before = window.__snap()
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
      document.dispatchEvent(new Event('visibilitychange'))
      const after = window.__snap()
      delete document.visibilityState   // back to the prototype's getter
      document.dispatchEvent(new Event('visibilitychange'))
      return { storedBefore: before.stored.tr, storedAfter: after.stored.tr, memPoints: after.mem.n, memLastTs: after.mem.lastTs }
    }""")
    x['synthetic_hidden'] = flush
    rec = flush['memPoints']
    sb = [v['n'] for v in flush['storedBefore'].values() if isinstance(v, dict)]
    sa = [v['n'] for v in flush['storedAfter'].values() if isinstance(v, dict)]
    x['synthetic_hidden_flushed'] = bool(sa) and sa[0] == rec and (not sb or sb[0] < rec)
    t.note(f'(B hide) synthetic visibilitychange->hidden: stored {sb} -> {sa} for {rec} points in the store: flushed={x["synthetic_hidden_flushed"]}')
    # ---- more movement so something is unsaved again, then the page goes
    n1 = points_now(t)
    k = walk_on(t, k, 10, until=lambda: points_now(t) > n1)
    r['k_now'] = k
    got = points_now(t) > n1
    t.wait(600)
    pre = t.snap()
    x['before_leaving'] = {'got_new_point': got, 'store_points': pre['mem']['n'], 'store_last': [pre['mem']['lastTs'], pre['mem']['lastLat']], 'stored': pre['stored']['tr'], 'pending_points': None}
    sp = [v['n'] for v in pre['stored']['tr'].values() if isinstance(v, dict)]
    x['before_leaving']['pending_points'] = None if not sp else pre['mem']['n'] - sp[0]
    t.note(f'(B pagehide) before leaving: store {pre["mem"]["n"]} points (last ts {pre["mem"]["lastTs"]}), stored {sp}, unsaved {x["before_leaving"]["pending_points"]}')
    t.page.goto('about:blank', wait_until='load', timeout=30000)
    t.wait(800)
    ls = t.ls_now()
    x['after_leaving_keys'] = keys_summary(ls)
    idx = json.loads(ls.get('huntapp-tracks:index') or 'null') or []
    stored = json.loads(ls.get(f'huntapp-track:{idx[0]}') or 'null') if idx else None
    if stored:
        last = stored['points'][-1]
        x['after_leaving'] = {'index': idx, 'stored_points': len(stored['points']), 'stored_last_ts': last['ts'], 'stored_last_lat': last['lat'], 'endedAt': stored.get('endedAt')}
        x['held_last_point'] = last['ts'] == pre['mem']['lastTs'] and len(stored['points']) == pre['mem']['n']
    else:
        x['after_leaving'] = None
        x['held_last_point'] = False
    x['hide_events'] = json.loads(ls.get('__ev') or '[]')
    t.note(f'(B pagehide) after leaving: {json.dumps(x["after_leaving"])}; held the last point: {x["held_last_point"]}; legacy key present: {"huntapp-tracks" in ls}')
    t.note(f'(B pagehide) hide events seen by the page (after the app handlers): {json.dumps(x["hide_events"])[:700]}')
    x['legacy_present_after'] = 'huntapp-tracks' in ls


# ---------------------------------------------------------------- C: reopen on the migrated storage, rename, delete

def c_reopen_delete(pw):
    ss = out_path('A.storage.json')
    if not os.path.exists(ss):
        print('  C needs A.storage.json (run A first)')
        return
    t = TK('TR-C-reopen-delete', pw, storage_state=ss)
    try:
        t.start()
        r = t.out.setdefault('c', {})
        t.setup_handles()
        t.wait(3000)
        ls = t.ls_now()
        r['keys_on_open'] = keys_summary(ls)
        idx0 = json.loads(ls.get('huntapp-tracks:index') or 'null')
        r['index_on_open'] = idx0
        r['store_on_open'] = t.snap()['mem']['all']
        t.note(f'(C) on open: index {idx0}; keys {json.dumps(r["keys_on_open"])[:360]}; store {json.dumps(r["store_on_open"])[:260]}')
        lsw = t.ev('() => window.__lsw')
        r['writes_during_open'] = [{'key': w['k'], 'op': w['op']} for w in lsw]
        if not t.open_huntlog():
            t.note('(C) Hunt log did not open')
            return
        t.expand_days()
        t.expand_sheet()
        hl = t.ev(HUNTLOG_JS)
        r['huntlog_on_open'] = hl
        t.shot('huntlog-reopened.png')
        t.note(f'(C) Hunt log lists {hl["outingRows"]} outing(s): {json.dumps([x["text"] for d in hl["days"] for x in d["rows"]])[:300]}')
        rows = t.page.locator('.log-ev:has(.log-k-outings)')
        n = rows.count()
        if n < 2:
            t.note(f'(C) expected two outing rows, found {n}')
            return
        # rename the first row (the newer outing, Migration B)
        row_texts = [rows.nth(i).inner_text().replace('\n', ' ') for i in range(n)]
        r['rows_before'] = row_texts
        newer_idx = json.loads(ls['huntapp-tracks:index'])[-1]
        t.prompt_reply = 'Renamed by test'
        rows.nth(0).click(timeout=5000)
        t.wait(1500)
        r['outing_card'] = t.ev(OUTING_CARD_JS)
        t.note(f'(C) Outing card: {r["outing_card"]}')
        t.click('.topcard[aria-label="Outing"] .sheet-dots', 'Outing card ⋯', settle=500)
        t.click('.topcard[aria-label="Outing"] .menu-row:has-text("Rename")', 'Rename', settle=600)
        t.wait(2800)  # rename saves in 2 s
        ls1 = t.ls_now()
        sb = json.loads(ls1.get(f'huntapp-track:{newer_idx}') or 'null')
        r['after_rename'] = {'track': newer_idx, 'stored_name': sb and sb.get('name'), 'index': json.loads(ls1.get('huntapp-tracks:index') or 'null'), 'store_name': t.snap()['mem']['all'].get(newer_idx, {}).get('name')}
        t.note(f'(C) after rename: {json.dumps(r["after_rename"])}')
        # back to the log, then delete the other outing (the older, Migration A)
        t.click('.topcard[aria-label="Outing"] .topcard-back', 'Outing card ‹ (back to the log)', settle=1200)
        t.sheet_ready('Hunt log (again)')
        t.expand_days()
        rows = t.page.locator('.log-ev:has(.log-k-outings)')
        r['rows_after_rename'] = [rows.nth(i).inner_text().replace('\n', ' ') for i in range(rows.count())]
        t.note(f'(C) rows after rename: {r["rows_after_rename"]}')
        victim_idx = json.loads(ls['huntapp-tracks:index'])[0]
        rows.nth(rows.count() - 1).click(timeout=5000)
        t.wait(1500)
        r['outing_card_victim'] = t.ev(OUTING_CARD_JS)
        t.note(f'(C) Outing card to delete: {r["outing_card_victim"]}')
        t.click('.topcard[aria-label="Outing"] .sheet-dots', 'Outing card ⋯', settle=500)
        t.click('.topcard[aria-label="Outing"] .menu-row:has-text("Delete")', 'Delete (confirm accepted)', settle=800)
        t.wait(600)
        mid = t.ls_now()
        r['right_after_delete_keys'] = keys_summary(mid)  # before the 2 s save
        t.wait(2800)
        ls2 = t.ls_now()
        r['after_delete_keys'] = keys_summary(ls2)
        idx2 = json.loads(ls2.get('huntapp-tracks:index') or 'null')
        r['after_delete'] = {'deleted_track': victim_idx, 'index': idx2, 'key_gone': f'huntapp-track:{victim_idx}' not in ls2, 'other_key_present': f'huntapp-track:{newer_idx}' in ls2,
                             'index_shortened': idx2 == [newer_idx], 'legacy_present': 'huntapp-tracks' in ls2, 'store': t.snap()['mem']['all']}
        t.sheet_ready('Hunt log (after delete)')
        t.wait(800)
        t.expand_days()
        t.expand_sheet()
        hl2 = t.ev(HUNTLOG_JS)
        r['huntlog_after_delete'] = hl2
        t.shot('huntlog-after-delete.png')
        t.note(f'(C) right after the delete (before the 2 s save): {json.dumps(r["right_after_delete_keys"])[:300]}')
        t.note(f'(C) after delete: {json.dumps(r["after_delete"])[:520]}')
        t.note(f'(C) Hunt log now lists {hl2["outingRows"]} outing(s)')
        r['dialogs'] = t.dialogs
        lsw = t.ev('() => window.__lsw')
        r['writes_total'] = [{'key': w['k'], 'op': w['op']} for w in lsw]
        r['verdict'] = {'two_listed_from_per_track_keys': hl['outingRows'] == 2, 'rename_stored': r['after_rename']['stored_name'] == 'Renamed by test',
                        'delete_key_gone': r['after_delete']['key_gone'], 'index_shortened': r['after_delete']['index_shortened'], 'one_outing_left': hl2['outingRows'] == 1}
        t.note(f'(C) verdict {r["verdict"]}')
    finally:
        t.finish()


def main():
    rest = B.configure(sys.argv[1:], default_name='tracks')
    if B.CFG.clock:
        sys.exit('tracks.py times its walk by the page\'s Date (the app stamps every point with it): do not hold the clock here.')
    want = [w.upper() for w in rest] or ['A', 'B', 'C']
    bad = [w for w in want if w not in ('A', 'B', 'C')]
    if bad:
        sys.exit(f'unknown load {bad}: A, B or C')
    print(f'{B.CFG.url}  ->  {B.CFG.out}   Open-Meteo: {"replayed" if B.CFG.replay else "LIVE (spends quota)"}', flush=True)
    with sync_playwright() as pw:
        if 'A' in want:
            a_migration(pw)
        if 'B' in want:
            b_walk(pw)
        if 'C' in want:
            c_reopen_delete(pw)
    return 0


if __name__ == '__main__':
    sys.exit(main())
