"""Scorer dump: every number and label the Spots scorer gives, taken before and after a scoring change and compared (scorecompare.py).

    py -3.14 scripts/headless/scoredump.py pin    --url http://localhost:5199/      (optional) snapshot the UNEDITED scorer modules first
    py -3.14 scripts/headless/scoredump.py before --url http://localhost:5199/      the dump of the old code
        ... edit app/src/spots/*.ts ...
    py -3.14 scripts/headless/scoredump.py after  --url http://localhost:5199/      the same, against the edited code
    py -3.14 scripts/headless/scorecompare.py                                       before*.json against after*.json

    --areas pickle-lake,blanchard-river,highland-lake   (the default; Pickle Lake alone took 65 s on a quiet machine and ~5 min on a busy
                                                        one, all three areas about three to four times that)
    --pin | --no-pin   serve src/spots/*.ts from the snapshot in <out>/pinned/ (default: yes for 'before' when a snapshot exists, else no)
    the label is any name: 'before' freezes the conditions (below) into frozen*.json, every other label reuses them, so 'before' comes first.
    'control' with --pin re-dumps the OLD code a second time (a zero-change control of the harness itself):
        scorecompare.py --after-prefix control   must find nothing.

What it does, per area, in a fresh headless Chromium (scenarios.py's context, Open-Meteo replayed from the capture and never live: a live
forecast would differ between the two dumps):
  * the app boots, readiness is waited for (readiness.py: map + strip hour cells + the first '[spots] ... scored in'), then loadRestOfMicro() and
    the going grid are awaited (the ground-wind path of siteFactor needs them), then all 16 momentum directions are waited for in the console,
    then the ground-wind state is probed until it is stable.
  * SETUP_JS (below) installs window.__dump in the page; one evaluate per (target, condition) scores the sample of the core (every 2nd row and
    column) with habitatScore and siteFactor (full precision, sha256 of the float64 bytes), then the detail cells (siteParts, habitatScore with
    parts, describeCell, siteFactor with parts / reasons, pointCase) and the day's verdict; a last one the pure helpers and place rules.
  * Conditions A = a fixed literal (8:00 on the day the capture was taken: a dump must not move with the clock), B = the app's own
    useSpotsStore conditions (frozen in frozen*.json at the 'before' run and reused verbatim after: the app's own hour moves with the clock, and
    the store's conditions are put back to it, because model.ts reads the water temperature from them), C-H = extras: C, E, F are hours
    outside the recorded forecast (no ground wind: the thermals and forecast-wind fallbacks of siteCore), D is a windy snowy Nov dusk, G and H
    are the calmest and the windiest hour of the forecast by the ground model. Weights: Default, AccLog0 = {...DEFAULT_WEIGHTS, access: 0, log: 0}.
    The app's modules import each other with HMR stamps (/src/x.ts?t=...), so the dump follows the scorer's own import chain, never a plain
    /src path (a second instance with its own state).
  * 'pin' fetches src/spots/*.ts as the dev server serves them (vite-transformed) into <out>/pinned/, from an UNEDITED tree (it refuses a
    tree with local changes under app/src/spots unless --force). With --pin the page is served those texts, so an edit saved while the dump
    runs, or one made before the 'before' dump is taken, cannot leak into it. A manifest of every file under app/src (and the area's .hab
    files) is taken at the start and end of every run and saved (<label>.manifest.json); scorecompare.py lists what changed between two dumps.
Do not capture Open-Meteo again (omcache.py) between a 'before' and its 'after'.

Output (default scripts/headless/out/scoredump/; --out or --name changes it): <label>.json (+ .<area> for the others), .text.json.gz (the
interned words), .hashes.txt (the sha256 table), .manifest.json, .console.txt, frozen*.json, pinned/.   Dev-only globals used: window.__map.
"""
import argparse
import base64
import glob
import gzip
import hashlib
import json
import os
import re
import struct
import subprocess
import sys
import time
import urllib.request
from array import array
from datetime import timedelta

from playwright.sync_api import Error as PWError, sync_playwright

import omcache
import readiness as R
import scenarios as B

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))  # the repo
APPSRC = os.path.join(ROOT, 'app', 'src')
DATA = os.path.join(ROOT, 'app', 'public', 'data')
DEFAULT_AREAS = 'pickle-lake,blanchard-river,highland-lake'

LABEL = None   # before | after | control | ...: set by main()
OUTDIR = None  # where the dump's files go: set by main()

INIT_JS = r"""
(() => {
  try { performance.setResourceTimingBufferSize(100000) } catch (e) { /* none */ }
  // The app's modules import each other with HMR stamps (/src/x.ts?t=...). A plain import('/src/x.ts') would be a SECOND instance with its
  // own state.  The dump takes scoring.ts as the app asked for it (the first URL in the resource timeline) and follows ITS import chain:
  // __urlIn reads the specifier a module's served text uses for the next one, so huntRules, placeRules, the ground model and the store the
  // model reads are the very instances the scorer calls, whatever stamps other importers in the page carry (pinned old stamps beside
  // live new ones, or an edit saved while the page loads).
  window.__impUrls = (path) => {
    const out = []
    for (const e of performance.getEntriesByType('resource')) {
      try { const u = new URL(e.name); if (u.pathname === path && !out.includes(e.name)) out.push(e.name) } catch (e) { /* skip */ }
    }
    return out
  }
  window.__imp = (path) => { const c = window.__impUrls(path); return import(c.length ? c[0] : location.origin + path) }
  window.__urlIn = async (importerUrl, path) => {
    const text = await (await fetch(importerUrl)).text()
    const i = text.indexOf('"' + path)
    if (i < 0) return location.origin + path
    const j = text.indexOf('"', i + 1)
    return location.origin + text.slice(i + 1, j)
  }
  // the scorer's own chain: scoring -> huntRules -> (habitatGrid, placeRules, profile, weights, model) ; model -> (relief, store) ; relief -> goingGrid
  window.__chain = async () => {
    const o = {}
    o.sc = window.__impUrls('/src/spots/scoring.ts')[0] || location.origin + '/src/spots/scoring.ts'
    o.hr = await window.__urlIn(o.sc, '/src/spots/huntRules.ts')
    o.cfg = await window.__urlIn(o.sc, '/src/config.ts')
    for (const [k, p] of [['hg', '/src/spots/habitatGrid.ts'], ['pl', '/src/spots/placeRules.ts'], ['pr', '/src/spots/profile.ts'], ['wt', '/src/spots/weights.ts'], ['mm', '/src/weather/micro/model.ts']]) o[k] = await window.__urlIn(o.hr, p)
    o.ar = await window.__urlIn(o.pr, '/src/areas/index.ts')
    o.relief = await window.__urlIn(o.mm, '/src/weather/micro/relief.ts')
    o.ss = await window.__urlIn(o.mm, '/src/state/spotsStore.ts')
    o.gg = await window.__urlIn(o.relief, '/src/routes/goingGrid.ts')
    return o
  }
})()
"""

PREP_JS = r"""
async () => {
  const u = await window.__chain()
  const hg = await import(u.hg)
  const mm = await import(u.mm)
  const relief = await import(u.relief)
  const gg = await import(u.gg)
  const cfg = await import(u.cfg)
  const app = await window.__imp('/src/state/spotsStore.ts')
  const notes = { reliefExports: Object.keys(relief), reliefHasLoadGoing: typeof relief.loadGoing === 'function' }
  // the scorer's own chain loads what it needs, whoever else did (relief.ts exports no loadGoing, only ensureRelief, which loadRestOfMicro
  // calls; the going grid is routes/goingGrid.ts's)
  await hg.loadHabitat()
  await mm.loadMicro()
  await mm.microBaseReady()
  if (typeof relief.loadGoing === 'function') await relief.loadGoing()
  notes.goingLoaded = !!(await gg.loadGoing())
  await mm.loadRestOfMicro()
  notes.restOfMicro = 'awaited'
  const st = app.useSpotsStore.getState()
  notes.status = st.status
  notes.condLive = st.conditions ? JSON.parse(JSON.stringify(st.conditions)) : null
  notes.microGrid = !!mm.microGrid()
  notes.elevAtHome = relief.elevAt(cfg.HOME.center[0], cfg.HOME.center[1])
  notes.chain = Object.fromEntries(Object.entries(u).map(([k, v]) => [k, v.replace(location.origin, '')]))
  return notes
}
"""

SERVED_JS = r"""
async (chain) => {
  const out = {}
  const hex = (buf) => Array.from(new Uint8Array(buf), (x) => x.toString(16).padStart(2, '0')).join('')
  for (const k of ['hr', 'pl', 'sc', 'mm']) {
    const text = await (await fetch(location.origin + chain[k])).text()
    const bytes = new TextEncoder().encode(text)
    out[k] = { url: chain[k], bytes: bytes.length, sha256: hex(await crypto.subtle.digest('SHA-256', bytes)) }
  }
  return out
}
"""

READY2_JS = r"""
async () => {
  const u = await window.__chain()
  const mm = await import(u.mm)
  const relief = await import(u.relief)
  const cfg = await import(u.cfg)
  const app = await window.__imp('/src/state/spotsStore.ts')
  const st = app.useSpotsStore.getState()
  return { microGrid: !!mm.microGrid(), reliefSeesGoing: Number.isFinite(relief.elevAt(cfg.HOME.center[0], cfg.HOME.center[1])), status: st.status, hasConditions: !!st.conditions }
}
"""


PIN_STORE_JS = r"""
async (cond) => {
  // model.ts's makeCtx takes the water temperature from useSpotsStore.conditions when that is the same DAY as the hour asked for (else a
  // seasonal estimate), so the ground wind of an hour depends on which day the latest pass was for. The store the MODEL reads (found
  // through the scorer's chain) is put to the conditions the BEFORE dump saw, and kept there, so a dump taken after midnight sees the
  // same ground wind.
  const u = await window.__chain()
  const ss = await import(u.ss)
  const store = ss.useSpotsStore
  window.__dumpPinnedCond = cond
  store.setState({ conditions: cond })
  if (!window.__dumpPinUnsub) window.__dumpPinUnsub = store.subscribe((st) => { if (st.conditions !== window.__dumpPinnedCond) store.setState({ conditions: window.__dumpPinnedCond }) })
  return true
}
"""

# Installs window.__dump (probe / unit / pure / views) in the running app and returns the run's metadata. Everything in it only READS the
# app's modules; the same text is used for the 'before' and the 'after' dump.
SETUP_JS = r"""async (args) => {
  // Installs window.__dump (probe / unit / pure / views) in the running app and returns the run's metadata.
  // Everything here only READS the app's modules; the same file is used for the BEFORE and the AFTER dump.
  const { whenISO, hoursFromISO, condB, frozenCells, frozenHours } = args
  // The scorer's own instances: scoring.ts as the app asked for it, then each module through the specifier its importer's text uses
  // (window.__chain, the init script), so a stamp other importers carry cannot give this dump a second instance with its own state.
  const u = await window.__chain()
  const hg = await import(u.hg)
  const hr = await import(u.hr)
  const pr = await import(u.pr)
  const pl = await import(u.pl)
  const wt = await import(u.wt)
  const cfg = await import(u.cfg)
  const sc = await import(u.sc)
  const mm = await import(u.mm)
  const ar = await import(u.ar)
  const moduleUrls = Object.fromEntries(Object.entries(u).map(([k, v]) => [k, v.replace(location.origin, '')]))
  const moduleVariants = {}
  for (const p of ['/src/spots/habitatGrid.ts', '/src/spots/huntRules.ts', '/src/spots/profile.ts', '/src/spots/placeRules.ts', '/src/spots/weights.ts', '/src/config.ts', '/src/spots/scoring.ts', '/src/weather/micro/model.ts', '/src/areas/index.ts']) moduleVariants[p] = window.__impUrls(p).length

  const h = await hg.loadHabitat()
  if (!h) return { error: 'no habitat grid' }
  const b = hr.huntBands(h)
  const cols = h.cols
  const r0 = Math.max(0, Math.floor((h.north - cfg.CORE.north) / h.dLat))
  const r1 = Math.min(h.rows, Math.ceil((h.north - cfg.CORE.south) / h.dLat))
  const c0 = Math.max(0, Math.floor((cfg.CORE.west - h.west) / h.dLon))
  const c1 = Math.min(h.cols, Math.ceil((cfg.CORE.east - h.west) / h.dLon))
  const cellsAt = (step) => {
    const out = []
    for (let r = r0; r < r1; r += step) for (let cc = c0; cc < c1; cc += step) out.push(r * cols + cc)
    return out
  }
  const cells2 = cellsAt(2) // the requested sample: every 2nd row and 2nd column of the core
  const cells6 = cellsAt(6) // a sparser one for the extra conditions (a subset of cells2)

  const WEIGHTS = { Default: wt.DEFAULT_WEIGHTS, AccLog0: { ...wt.DEFAULT_WEIGHTS, access: 0, log: 0 } }
  const REGS = Object.keys(mm.REGIME_LABEL)
  const lon0 = cfg.HOME.center[0]
  const lat0 = cfg.HOME.center[1]

  // groundForScoring keeps ONE per-minute memo whose cells are float32: a cell's first read in a minute is the exact value, every later
  // read the float32 rounding of it. Flipping the memo to another minute makes the next pass 'cold' (every cell read for the first time).
  const resetMs = (ms) => {
    mm.groundForScoring(ms + 1, lon0, lat0, false)
  }
  const resetMemo = (c) => resetMs(c.timeMs)

  // The ground model keeps each cell's rise upwind (the lee rule) per wind sector from the FIRST call, and the app's own streaks and scent
  // particles ask at random points inside a cell, so a cell's cached rise depends on who asked first (a different cell or two in the words
  // of two page loads). Re-adopting the same grid empties that cache (and the slot cache); a unit does it first and then reads the model
  // in one synchronous stretch, so nothing can fill the cache in between and the first asker is always the cell's own centre.
  const resetLee = () => {
    if (mm.onTiles()) return 'mosaic'
    const g = mm.microGrid()
    if (!g) return 'no grid'
    mm.useMosaic(g, { scale: 1, tScale: 1, spreadRef: 1 })
    mm.useAreaGrid()
    return 'ok'
  }

  // ---- conditions: A is heat_bands.py's literal, B the app's own (frozen by the caller), C-H extra
  const mk = (when, over) => {
    const d = new Date(when)
    const doy = Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 1)) / 86400000) + 1
    return { lon: cfg.HOME.center[0], lat: cfg.HOME.center[1], timeMs: d.getTime(), dayOfYear: doy, month: d.getMonth() + 1, windKmh: 8, gustKmh: 15, windDir: 225, windPersistH: 6, windShiftDeg: 10, tempC: 2, snowDepthCm: 0, cloudPct: 50, precipMmH: 0, weatherCode: 2, pressureTrend6h: 0, tempDrop24h: 0, sunriseMs: null, sunsetMs: null, sinceSunriseH: 1, toSunsetH: 8, isDay: true, moonIllum: 0.5, waterTempC: 6, waterTempNote: '', hrdps: true, warmRun: 0, dayHigh: 6, prevHigh: 6, ...over }
  }
  const conds = { A: mk(whenISO) }
  if (condB) conds.B = condB
  // extras (not asked for): hours outside the recorded forecast (no ground wind: the thermals and forecast-wind fallbacks of siteCore) ...
  conds.C = mk('2026-09-22T13:00:00', { windKmh: 3, gustKmh: 6, windDir: 180, tempC: 18, cloudPct: 20, sinceSunriseH: 6, toSunsetH: 5.5, waterTempC: 14, warmRun: 3, dayHigh: 19, prevHigh: 20 })
  conds.D = mk('2026-11-05T17:00:00', { windKmh: 24, gustKmh: 42, windDir: 300, windPersistH: 2, windShiftDeg: 45, tempC: -3, snowDepthCm: 45, cloudPct: 90, precipMmH: 2, weatherCode: 71, pressureTrend6h: -4, tempDrop24h: 7, sinceSunriseH: 9.5, toSunsetH: 0.8, moonIllum: 0.1, waterTempC: 3, hrdps: false, dayHigh: -1, prevHigh: 6 })
  conds.E = mk('2026-10-05T18:15:00', { windKmh: 2, gustKmh: 4, windDir: 90, windShiftDeg: 35, tempC: 5, cloudPct: 10, sinceSunriseH: 10.5, toSunsetH: 0.7, moonIllum: 0.9, snowDepthCm: null, warmRun: 2, dayHigh: 12, prevHigh: 19 })
  conds.F = mk('2026-10-03T10:30:00', { windKmh: 12, gustKmh: 22, windDir: 45, windShiftDeg: 40, tempC: 8, cloudPct: 70, sinceSunriseH: 3.5, toSunsetH: 8, dayHigh: 11, prevHigh: 13 })
  // ... and the calmest and the windiest hour the ground model has in the recorded forecast (found once, frozen for the AFTER dump)
  const hours = frozenHours || (() => {
    const start = new Date(hoursFromISO).getTime()
    const rows = []
    const step = Math.max(1, Math.floor(cells2.length / 40))
    for (let k = 0; k < 96; k++) {
      const ms = start + k * 3600000
      resetMs(ms)
      const v = []
      for (let j = 0; j < cells2.length; j += step) {
        const [lon, lat] = h.center(cells2[j])
        const gw = mm.groundForScoring(ms, lon, lat, false)
        if (gw) v.push(gw.kmh)
      }
      if (v.length) {
        v.sort((x, y) => x - y)
        rows.push({ ms, med: v[v.length >> 1] })
      }
    }
    if (!rows.length) return null
    let lo = rows[0]
    let hi = rows[0]
    for (const r of rows) {
      if (r.med < lo.med) lo = r
      if (r.med > hi.med) hi = r
    }
    return { G: lo.ms, H: hi.ms, medG: lo.med, medH: hi.med, nHours: rows.length }
  })()
  if (hours) {
    conds.G = mk(hours.G, { windKmh: 2, gustKmh: 4, windDir: 200, tempC: 0, cloudPct: 10 })
    conds.H = mk(hours.H, { windKmh: 28, gustKmh: 45, windDir: 250, windShiftDeg: 40, tempC: 6, cloudPct: 85, precipMmH: 0.4, sinceSunriseH: 5, toSunsetH: 5 })
  }
  const cellsFor = {}
  for (const k of Object.keys(conds)) cellsFor[k] = k === 'A' || k === 'B' ? cells2 : cells6

  // ---- helpers
  const num = (v) => (Object.is(v, -0) ? '-0' : String(v))
  const partStr = (p) => `${p.key}|${p.label}|${num(p.value)}|${p.kind}|${p.note ?? ''}`
  const hex = (buf) => Array.from(new Uint8Array(buf), (x) => x.toString(16).padStart(2, '0')).join('')
  const shaBytes = async (u8) => hex(await crypto.subtle.digest('SHA-256', u8))
  const shaF64 = async (f) => {
    let g = f
    for (let k = 0; k < f.length; k++) {
      if (f[k] !== f[k]) {
        g = new Float64Array(f)
        for (let j = k; j < g.length; j++) if (g[j] !== g[j]) g[j] = -1e300
        break
      }
    }
    return shaBytes(new Uint8Array(g.buffer, g.byteOffset, g.byteLength))
  }
  const shaStr = (s) => shaBytes(new TextEncoder().encode(s))
  const stat = (f) => {
    let sum = 0
    let max = -Infinity
    let min = Infinity
    let nan = 0
    for (let k = 0; k < f.length; k++) {
      const v = f[k]
      if (v !== v) {
        nan++
        continue
      }
      sum += v
      if (v > max) max = v
      if (v < min) min = v
    }
    return { n: f.length, sum, max, min, nan }
  }
  const b64 = (f) => {
    const u8 = new Uint8Array(f.buffer, f.byteOffset, f.byteLength)
    let s = ''
    for (let k = 0; k < u8.length; k += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(k, k + 0x8000))
    return btoa(s)
  }
  const gzb64 = async (str) => {
    const stream = new Blob([str]).stream().pipeThrough(new CompressionStream('gzip'))
    const u8 = new Uint8Array(await new Response(stream).arrayBuffer())
    let s = ''
    for (let k = 0; k < u8.length; k += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(k, k + 0x8000))
    return btoa(s)
  }
  const intern = (list) => {
    const tab = []
    const at = new Map()
    const idx = new Array(list.length)
    for (let k = 0; k < list.length; k++) {
      let j = at.get(list[k])
      if (j === undefined) {
        j = tab.length
        tab.push(list[k])
        at.set(list[k], j)
      }
      idx[k] = j
    }
    return { tab, idx }
  }
  const home = { lon: cfg.HOME.center[0], lat: cfg.HOME.center[1], name: 'Camp' }
  const E2E = new Set(['A', 'B', 'F', 'G', 'H'])
  const f32sha = (f) => shaBytes(new Uint8Array(f.buffer, f.byteOffset, f.byteLength))
  const rowHash = (f) => {
    const u = new Uint32Array(f.buffer, f.byteOffset, f.length)
    const out = new Array(h.rows)
    for (let r = 0; r < h.rows; r++) {
      let x = 2166136261
      for (let k = r * cols; k < (r + 1) * cols; k++) x = Math.imul(x ^ u[k], 16777619) >>> 0
      out[r] = x
    }
    return out
  }
  const f32stat = (f) => {
    let nz = 0
    let sum = 0
    let max = -Infinity
    let nan = 0
    for (let k = 0; k < f.length; k++) {
      const v = f[k]
      if (v !== v) {
        nan++
        continue
      }
      if (v !== 0) nz++
      sum += v
      if (v > max) max = v
    }
    return { n: f.length, nz, sum, max, nan }
  }
  const tally = (list) => {
    const m = new Map()
    for (const s of list) m.set(s, (m.get(s) || 0) + 1)
    return Object.fromEntries([...m.entries()].sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0)))
  }
  const safe = (fn) => {
    try {
      return fn()
    } catch (e) {
      return { error: String((e && e.message) || e).slice(0, 200) }
    }
  }

  // ---- one pass over a set of cells: the requested hs and sf, in forward or reverse order
  const pass = (t, bb, ctx, c, w, dir, cells) => {
    const n = cells.length
    const hs = new Float64Array(n)
    const sf = new Float64Array(n)
    if (dir > 0) {
      for (let k = 0; k < n; k++) {
        const i = cells[k]
        hs[k] = hr.habitatScore(t, bb, i, ctx, w)
        sf[k] = hr.siteFactor(t, bb, h, i, c, undefined, w)
      }
    } else {
      for (let k = n - 1; k >= 0; k--) {
        const i = cells[k]
        hs[k] = hr.habitatScore(t, bb, i, ctx, w)
        sf[k] = hr.siteFactor(t, bb, h, i, c, undefined, w)
      }
    }
    return { hs, sf }
  }

  // ---- cheap fingerprint of the ground-wind state (what loads can change): a cold read of ~150 cells for every condition
  const probe = () => {
    const f = new Float64Array(1)
    const u = new Uint32Array(f.buffer)
    let hsh = 2166136261
    const mix = (x) => {
      f[0] = x
      hsh = Math.imul(hsh ^ u[0], 16777619) >>> 0
      hsh = Math.imul(hsh ^ u[1], 16777619) >>> 0
    }
    let n = 0
    let nul = 0
    const per = {}
    for (const name of Object.keys(conds)) {
      const c = conds[name]
      resetMemo(c)
      const step = Math.max(1, Math.floor(cells2.length / 150))
      let nn = 0
      let nl = 0
      for (let k = 0; k < cells2.length; k += step) {
        const [lon, lat] = h.center(cells2[k])
        const gw = mm.groundForScoring(c.timeMs, lon, lat, false)
        if (gw) {
          nn++
          mix(gw.kmh)
          mix(gw.dirFrom)
          mix(gw.sigmaDeg)
          mix(REGS.indexOf(gw.regime))
        } else nl++
      }
      per[name] = [nn, nl]
      n += nn
      nul += nl
    }
    return { n, nul, hsh, per }
  }

  // ---- the detail cells: 40 spread over the sample + a greedy cover of the grid's own feature values (rare labels get a cell)
  const bin = (v, edges) => {
    let k = 0
    while (k < edges.length && v > edges[k]) k++
    return k
  }
  const feats = (i, gws) => {
    const f = []
    f.push('cover' + b.cover[i], 'lf' + b.landform[i], 'lead' + b.lead[i])
    const sl = b.slope[i]
    f.push('sl' + (sl >= 40 ? 40 : sl >= 30 ? 30 : sl >= 20 ? 20 : sl >= 12 ? 12 : sl >= 3 ? 3 : 0))
    const asp = b.aspect[i]
    f.push(asp === 255 ? 'aspFlat' : 'asp' + Math.floor(((asp * (360 / 250) + 180) % 360) / 45))
    f.push('dCover' + bin(b.distCover[i] * 10, [60, 80, 200, 300, 400, 500]))
    f.push('dBrowse' + bin(b.distBrowse[i] * 10, [100, 250, 500]))
    f.push('dLake' + bin(b.distLake[i] * 10, [40, 60, 120, 150, 200]))
    f.push('dWet' + bin(b.distWetland[i] * 10, [100, 300]))
    f.push('dWater' + bin(b.distWater[i] * 10, [50]))
    f.push('dRoad' + bin(b.distRoad[i] * 20, [40, 60, 150, 800, 2500, 4000, 5000]))
    const lf = b.landFrac[i] / 255
    f.push('neck' + (lf < 0.5 ? 0 : lf < 0.65 ? 1 : 2))
    const d = b.disturb[i]
    f.push('dist' + (d === 255 ? 'none' : bin(d, [4, 9, 20, 30, 60])) + (d >= 3 && d <= 20 ? 'bear' : '') + (d >= 5 && d <= 30 ? 'cut' : ''))
    f.push('age' + bin(b.age[i], [0, 5, 10, 25, 40, 60]))
    f.push('hw' + (b.hardwood[i] >= 40 ? 1 : 0), 'co' + (b.conifer[i] >= 70 ? 1 : 0))
    f.push('bear' + (b.bearBrowse[i] === 255 ? 'none' : 'some'))
    f.push('tpi' + bin(b.tpi[i] - 128, [-3, 0, 3]))
    if (b.thick) f.push('thick' + bin(b.thick[i] / 250, [0.35, 0.75]))
    if (b.dz) f.push('dz' + bin(b.dz[i], [-500, -300, -250, -200, -100, 50, 100, 150, 250, 400]))
    if (b.distStream) f.push('str' + bin(b.distStream[i] * 10, [100, 150]))
    if (b.packOut) f.push('pack' + bin((b.packOut[i] * 50) / 1000, [1, 1.6, 3, 3.2, 5, 6]) + (b.packOut[i] >= 255 ? 'far' : ''))
    if (b.distHighway) f.push('hwy' + bin(b.distHighway[i] * 20, [250, 1000]))
    if (b.height) f.push('ht' + bin(b.height[i], [0, 1, 2, 3]))
    f.push('crown' + bin(b.crown[i], [40]))
    for (const [name, gw] of gws) f.push(`gw${name}:${gw ? gw.regime + (gw.kmh < 0.8 ? '-calm' : '') + (gw.sigmaDeg >= 55 ? '-swirl' : '') : 'none'}`)
    return f
  }
  const pickCells = () => {
    const S = cells2.length
    const stride = Math.max(1, Math.floor(S / 40))
    const uniform = []
    for (let k = 0; k < 40; k++) uniform.push(cells2[Math.min(S - 1, k * stride + (stride >> 1))])
    const sets = new Array(S)
    const gwAt = {}
    for (const name of Object.keys(conds)) {
      const c = conds[name]
      resetMemo(c)
      const arr = new Array(S)
      for (let k = 0; k < S; k++) {
        const [lon, lat] = h.center(cells2[k])
        arr[k] = mm.groundForScoring(c.timeMs, lon, lat, false)
      }
      gwAt[name] = arr
    }
    const uncovered = new Set()
    for (let k = 0; k < S; k++) {
      const s = new Set(feats(cells2[k], Object.keys(conds).map((nm) => [nm, gwAt[nm][k]])))
      sets[k] = s
      for (const x of s) uncovered.add(x)
    }
    const diverse = []
    const taken = new Set()
    while (uncovered.size && diverse.length < 100) {
      let best = -1
      let bestN = 0
      for (let k = 0; k < S; k++) {
        if (taken.has(k)) continue
        let m = 0
        for (const x of sets[k]) if (uncovered.has(x)) m++
        if (m > bestN) {
          bestN = m
          best = k
        }
      }
      if (best < 0) break
      taken.add(best)
      diverse.push(cells2[best])
      for (const x of sets[best]) uncovered.delete(x)
    }
    return { uniform, diverse, uncoveredLeft: uncovered.size }
  }
  const picked = frozenCells && frozenCells.uniform ? { ...frozenCells, uncoveredLeft: null } : pickCells()
  const detailFor = (cName) => (cName === 'A' || cName === 'B' ? [...picked.uniform, ...picked.diverse.filter((i) => !picked.uniform.includes(i))] : picked.uniform)

  // ---- one (target, condition) unit
  const unit = async (t, cName) => {
    const T0 = performance.now()
    const leeReset = resetLee()
    const c = conds[cName]
    const cells = cellsFor[cName]
    const n = cells.length
    const ctx = pl.huntCtx(t, c)
    const out = { t, c: cName, n, leeReset, ctx: JSON.parse(JSON.stringify(ctx)) }
    // sync work first; the (async) hashing after, so the app's state is read in one stretch
    out.grid = {}
    const store = {}
    for (const wName of Object.keys(WEIGHTS)) {
      const w = WEIGHTS[wName]
      resetMemo(c)
      const cold = pass(t, b, ctx, c, w, 1, cells)
      const warm = pass(t, b, ctx, c, w, 1, cells) // the memo now holds every cell: float32 reads
      let hpMis = 0
      let sfpMis = 0
      const hpStr = []
      const spStr = []
      for (let k = 0; k < n; k++) {
        const i = cells[k]
        const hp = []
        const hv = hr.habitatScore(t, b, i, ctx, w, hp)
        if (!Object.is(hv, cold.hs[k])) hpMis++
        const sp = []
        const sv = hr.siteFactor(t, b, h, i, c, undefined, w, sp)
        if (!Object.is(sv, warm.sf[k])) sfpMis++
        if (wName === 'Default') {
          hpStr.push(hp.map(partStr).join(';'))
          spStr.push(sp.map(partStr).join(';'))
        }
      }
      resetMemo(c)
      const b2 = hr.huntBands(h)
      const ctx2 = pl.huntCtx(t, c)
      const rev = pass(t, b2, ctx2, c, w, -1, cells) // fresh bands and context, reverse order, cold memo
      let revBad = 0
      for (let k = 0; k < n; k++) if (!Object.is(rev.hs[k], cold.hs[k]) || !Object.is(rev.sf[k], cold.sf[k])) revBad++
      store[wName] = { cold, warm, rev, hpMis, sfpMis, hpStr, spStr, revBad }
    }
    // the site's parts for every cell, cold (labels, values)
    resetMemo(c)
    const part = { scent: new Float64Array(n), vis: new Float64Array(n), acc: new Float64Array(n), press: new Float64Array(n) }
    const labKey = []
    const labAll = []
    for (let k = 0; k < n; k++) {
      const sp = hr.siteParts(t, b, h, cells[k], c)
      part.scent[k] = sp[0].value
      part.vis[k] = sp[1].value
      part.acc[k] = sp[2].value
      part.press[k] = sp.length > 3 ? sp[3].value : 1
      labKey.push(sp.map((p) => p.key + ':' + p.label).join('|'))
      for (const p of sp) labAll.push(p.key + ':' + p.label)
    }
    // every cell's words (full ground evaluation: independent of the memo)
    const dsc = []
    let dlines = 0
    for (let k = 0; k < n; k++) {
      const d = hr.describeCell(t, b, h, cells[k], c)
      dlines += d.length
      dsc.push(d.join('\n'))
    }
    // the detail cells
    const detail = []
    for (const i of detailFor(cName)) {
      const rec = { i }
      resetMemo(c)
      rec.spFast = safe(() => hr.siteParts(t, b, h, i, c)) // cold read
      rec.hs = {}
      for (const wName of Object.keys(WEIGHTS)) {
        const parts = []
        const v = safe(() => hr.habitatScore(t, b, i, ctx, WEIGHTS[wName], parts))
        rec.hs[wName] = { v, parts }
      }
      rec.sfParts = {}
      for (const wName of Object.keys(WEIGHTS)) {
        const parts = []
        const v = safe(() => hr.siteFactor(t, b, h, i, c, undefined, WEIGHTS[wName], parts))
        rec.sfParts[wName] = { v, parts }
      }
      rec.describe = safe(() => hr.describeCell(t, b, h, i, c))
      const rs = []
      rec.spFull = safe(() => hr.siteParts(t, b, h, i, c, rs))
      rec.spFullReasons = rs
      rec.sfFull = {}
      for (const wName of Object.keys(WEIGHTS)) {
        const r2 = []
        const v = safe(() => hr.siteFactor(t, b, h, i, c, r2, WEIGHTS[wName]))
        rec.sfFull[wName] = { v, reasons: r2 }
      }
      detail.push(rec)
    }
    out.cells = detail
    // pointCase on every 4th of the uniform 40 (10 cells)
    out.points = {}
    for (const wName of Object.keys(WEIGHTS)) {
      const arr = []
      for (let k = 0; k < picked.uniform.length; k += 4) {
        const i = picked.uniform[k]
        const [lon, lat] = h.center(i)
        resetMemo(c)
        arr.push({ i, lon, lat, pc: safe(() => sc.pointCase(t, lon, lat, c, WEIGHTS[wName])) })
      }
      out.points[wName] = arr
    }
    // the verdict
    out.verdict = {}
    for (const wName of Object.keys(WEIGHTS)) out.verdict[wName] = safe(() => JSON.parse(JSON.stringify(hr.activityVerdict(t, c, WEIGHTS[wName]))))
    // the app's own path end to end, as spotsLayer runs it: huntPass, huntRows (the rough 2x2 copy, then the full pass on the same
    // scores) and, apart, scoreHunt (a fresh pass); each starts on a cold memo
    const e2eSync = {}
    if (E2E.has(cName)) {
      for (const wName of Object.keys(WEIGHTS)) {
        const w = WEIGHTS[wName]
        const rec = {}
        resetMemo(c)
        const p = sc.huntPass(t, c, home, w)
        rec.win = [...p.win]
        sc.huntRows(p, p.win[0], p.win[1], 2)
        rec.rough = new Float32Array(p.scores)
        sc.huntRows(p, p.win[0], p.win[1], 1)
        rec.fullAfterRough = new Float32Array(p.scores)
        resetMemo(c)
        const res = sc.scoreHunt(t, c, home, w)
        rec.full = res.scores
        rec.spots = JSON.parse(JSON.stringify(res.spots))
        rec.verdict = JSON.parse(JSON.stringify(res.verdict))
        e2eSync[wName] = rec
      }
    }
    // ---- async part: hashes and packing (the texts are gzipped, the score arrays sent as base64 float64: dump.py unpacks both)
    const texts = {}
    for (const wName of Object.keys(WEIGHTS)) {
      const s = store[wName]
      out.grid[wName] = {
        hsB64: b64(s.cold.hs),
        sfB64: b64(s.cold.sf),
        hsStat: stat(s.cold.hs),
        sfStat: stat(s.cold.sf),
        hsSha: await shaF64(s.cold.hs),
        sfSha: await shaF64(s.cold.sf),
        sfWarmB64: b64(s.warm.sf),
        sfWarmStat: stat(s.warm.sf),
        sfWarmSha: await shaF64(s.warm.sf),
        revHsSha: await shaF64(s.rev.hs),
        revSfSha: await shaF64(s.rev.sf),
        revBadCells: s.revBad,
        hsPartsReturnMismatch: s.hpMis,
        sfPartsVsWarmMismatch: s.sfpMis,
        ...(wName === 'Default' ? { hsPartsSha: await shaStr(s.hpStr.join('\n')), sfPartsSha: await shaStr(s.spStr.join('\n')) } : {}),
      }
      if (wName === 'Default') {
        texts['Default.hsPartsText'] = intern(s.hpStr)
        texts['Default.sfPartsText'] = intern(s.spStr)
      }
    }
    out.site = {
      sha: { scent: await shaF64(part.scent), vis: await shaF64(part.vis), acc: await shaF64(part.acc), press: await shaF64(part.press) },
      b64: { scent: b64(part.scent), vis: b64(part.vis), acc: b64(part.acc), press: b64(part.press) },
      labelTally: tally(labAll),
    }
    texts.labelsByCell = intern(labKey)
    texts.describe = intern(dsc)
    out.describe = { sha: await shaStr(dsc.join('\u0001')), lines: dlines }
    if (E2E.has(cName)) {
      out.e2e = {}
      for (const wName of Object.keys(WEIGHTS)) {
        const r = e2eSync[wName]
        const one = async (f) => ({ sha: await f32sha(f), ...f32stat(f), rowHash: rowHash(f) })
        const rec = { win: r.win, rough: await one(r.rough), fullAfterRough: await one(r.fullAfterRough), full: await one(r.full), spots: r.spots, verdict: r.verdict }
        if ((cName === 'A' || cName === 'B') && wName === 'AccLog0') {
          // the window's scores, to say which cells moved if a hash does
          const [wr0, wr1, wc0, wc1] = r.win
          const sub = new Float32Array((wr1 - wr0) * (wc1 - wc0))
          for (let rr = wr0, k = 0; rr < wr1; rr++) for (let cc = wc0; cc < wc1; cc++) sub[k++] = r.full[rr * cols + cc]
          rec.windowF32 = b64(sub)
        }
        out.e2e[wName] = rec
      }
    }
    out.textsZ = await gzb64(JSON.stringify(texts))
    out.ms = Math.round(performance.now() - T0)
    return out
  }

  // ---- the place rules and the pure helpers, straight (once per area)
  const pure = async () => {
    const T0 = performance.now()
    const o = {}
    const rng = (a, z, f) => {
      const r = []
      for (let k = a; k <= z; k++) r.push(f(k))
      return r
    }
    const monthOf = (doy) => Math.min(12, Math.floor((doy - 1) / 30.5) + 1)
    o.rutFactor = rng(1, 366, (d) => hr.rutFactor(monthOf(d), d))
    o.disturbanceCurve = rng(0, 255, (a) => hr.disturbanceCurve(a))
    o.sightM = rng(0, 100, (k) => hr.sightM(k / 100))
    o.slopeFactor = rng(0, 90, (d) => pl.slopeFactor(d))
    o.northRegrowth = rng(0, 255, (a) => pl.northRegrowth(a))
    o.berryBurn = rng(0, 255, (a) => [pl.berryBurn(a, 20), pl.berryBurn(a, 60)])
    o.openEdge = [0, 50, 299, 300, 301, 1000].map((m) => pl.openEdge(m))
    o.northRut = rng(1, 366, (d) => pl.northRut(d))
    o.heatOnsetC = rng(1, 366, (d) => pr.heatOnsetC(d))
    o.targetStanding = {}
    o.scoredMembers = {}
    for (const t of ['moose', 'bear', 'grouse', 'deer']) {
      o.targetStanding[t] = pr.targetStanding(t)
      o.scoredMembers[t] = Object.fromEntries(Object.keys(conds).map((cn) => [cn, pr.scoredMembers(t, conds[cn].timeMs)]))
    }
    o.regsLines = {}
    for (const t of ['moose', 'bear', 'grouse', 'deer']) o.regsLines[t] = Object.fromEntries(Object.keys(conds).map((cn) => [cn, safe(() => pr.regsLines(t, conds[cn].timeMs))]))
    // per-cell helpers over the sample
    const n2 = cells2.length
    const f64 = (fn) => {
      const a = new Float64Array(n2)
      for (let k = 0; k < n2; k++) a[k] = fn(cells2[k])
      return a
    }
    o.cell = {}
    o.cell.dz = await shaF64(f64((i) => pl.dzOf(b, i)))
    o.cell.openCountry = await shaF64(f64((i) => (pl.openCountry(b, i) ? 1 : 0)))
    o.cell.shrubBrowse = await shaF64(f64((i) => pl.shrubBrowse(b, i)))
    o.cell.forestGrouseBand = await shaF64(f64((i) => pl.forestGrouseBand(b, i)))
    o.cell.slopeFactor = await shaF64(f64((i) => pl.slopeFactor(b.slope[i])))
    o.cell.dzNaN = f64((i) => pl.dzOf(b, i)).reduce((m, v) => m + (v !== v ? 1 : 0), 0)
    o.cell.perTarget = {}
    for (const t of ['moose', 'bear', 'grouse', 'deer']) {
      const po = []
      const pa = new Float64Array(n2)
      const rp = []
      const rf = new Float64Array(n2)
      for (let k = 0; k < n2; k++) {
        const i = cells2[k]
        const a = pl.packOutAccess(t, b, i)
        pa[k] = a ? a.access : -1
        po.push(a ? a.label : '')
        const r = pl.roadPressure(t, b, i)
        rf[k] = r.f
        rp.push(r.label)
      }
      o.cell.perTarget[t] = { packOutAccess: await shaF64(pa), packOutLabels: await shaStr(po.join('\n')), packOutLabelTally: tally(po), roadPressure: await shaF64(rf), roadLabels: await shaStr(rp.join('\n')), roadLabelTally: tally(rp) }
    }
    // synthetic days through the calendar-bound place rules, over the sparser sample
    const mkT = (parts) => ({
      add(key, label, v) {
        parts.push(key + '|' + label + '|' + num(v) + '|bonus')
        return v
      },
      times(key, label, m) {
        parts.push(key + '|' + label + '|' + num(m) + '|mult')
        return m
      },
    })
    o.synthetic = {}
    for (const doy of [240, 255, 262, 270, 285, 300]) {
      for (const snow of [0, 45, 65, 75]) {
        const sctx = { dayOfYear: doy, members: [], warm: false, lateFall: doy >= 288, snowCm: snow }
        const rec = {}
        const gz = []
        const pt = []
        const nb1 = []
        const nb0 = []
        const mb = []
        for (let k = 0; k < cells6.length; k++) {
          const i = cells6[k]
          const m = pl.mooseBand(b, i, sctx)
          mb.push(num(m.f) + '|' + m.label)
          let parts = []
          gz.push(num(pl.grizzly(b, i, sctx, mkT(parts))) + '#' + parts.join(';'))
          parts = []
          pt.push(num(pl.ptarmigan(b, i, sctx, mkT(parts))) + '#' + parts.join(';'))
          parts = []
          nb1.push(num(pl.northBlackBear(b, i, sctx, mkT(parts), true)) + '#' + parts.join(';'))
          parts = []
          nb0.push(num(pl.northBlackBear(b, i, sctx, mkT(parts), false)) + '#' + parts.join(';'))
        }
        rec.mooseBand = await shaStr(mb.join('\n'))
        rec.grizzly = await shaStr(gz.join('\n'))
        rec.ptarmigan = await shaStr(pt.join('\n'))
        rec.northBlackBearGriz = await shaStr(nb1.join('\n'))
        rec.northBlackBearNoGriz = await shaStr(nb0.join('\n'))
        rec.mooseBandLabels = tally(mb.map((s) => s.split('|')[1]))
        o.synthetic[`doy${doy}-snow${snow}`] = rec
      }
    }
    // the sight lines, straight (viewAt by 15 degree sector, viewM by 45)
    o.views = {}
    if (b.through30) {
      for (const i of picked.uniform) {
        o.views[i] = { at: rng(0, 23, (s) => hr.viewAt(b, h, i, s * 15)), m: rng(0, 7, (s) => hr.viewM(b, h, i, s * 45)) }
      }
    }
    o.ms = Math.round(performance.now() - T0)
    return o
  }

  window.__dump = { probe, unit, pure, conds, picked, cells2, cells6, resetMemo, resetLee }

  // ---- metadata
  const area = ar.ACTIVE_AREA
  const bandsPresent = {}
  for (const k of ['thick', 'distThick', 'through30', 'elev', 'height', 'dz', 'packOut', 'distHighway', 'distStream']) bandsPresent[k] = b[k] != null
  const targets = {}
  for (const t of ['moose', 'bear', 'grouse', 'deer']) {
    const st = pr.targetStanding(t)
    targets[t] = { show: st.show, word: st.word, membersA: st.show ? pl.huntCtx(t, conds.A).members : null }
  }
  return {
    area: { id: area.id, name: area.name, jurisdiction: area.jurisdiction, zone: area.zone },
    habitat: { cols: h.cols, rows: h.rows, cellM: h.cellM, west: h.west, north: h.north, dLon: h.dLon, dLat: h.dLat, generated: h.generated },
    core: { r0, r1, c0, c1, cfgCore: cfg.CORE },
    nSample2: cells2.length,
    nSample6: cells6.length,
    uniform: picked.uniform,
    diverse: picked.diverse,
    uncoveredLeft: picked.uncoveredLeft,
    bandsPresent,
    profile: { treeline: pr.PROFILE.treeline, north: pr.PROFILE.north, shrubHeight: pr.PROFILE.shrubHeight, leadSpecies: pr.PROFILE.leadSpecies },
    targets,
    conditions: JSON.parse(JSON.stringify(conds)),
    weights: JSON.parse(JSON.stringify(WEIGHTS)),
    regimes: REGS,
    harness: 'v3: unit resets the lee/slot caches first',
    microGrid: !!mm.microGrid(),
    hours,
    moduleUrls,
    moduleVariants,
    groundNow: (() => {
      const g = mm.groundForScoring(conds.A.timeMs, lon0, lat0, false)
      return g
    })(),
  }
}"""


def log(msg):
    print(f'[{time.strftime("%H:%M:%S")}] {msg}', flush=True)


def day_args():
    """(condition A's hour, where the G/H search of the forecast's hours starts) from the day the capture was taken: 8:00 that day, and
    midnight of the day before it (the forecast's past_days=1). Without a readable capture date: the day it was first built on."""
    t = omcache.captured_at()
    if t is None:
        return '2026-10-17T08:00:00', '2026-10-16T00:00:00'
    d = t.date()
    return f'{d.isoformat()}T08:00:00', f'{(d - timedelta(days=1)).isoformat()}T00:00:00'


# ------------------------------------------------------------------ manifests
def sha_file(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def manifest(area):
    m = {'src': {}, 'data': {}}
    for root, dirs, files in os.walk(APPSRC):
        dirs[:] = [d for d in dirs if d != 'node_modules']
        for fn in files:
            p = os.path.join(root, fn)
            m['src'][os.path.relpath(p, APPSRC).replace('\\', '/')] = sha_file(p)
    base = '' if area == 'pickle-lake' else f'areas/{area}/'
    for nm in ('habitat', 'micro', 'micro-sd', 'going'):
        p = os.path.join(DATA, base.replace('/', os.sep), f'{nm}-{area}.hab')
        if os.path.exists(p):
            m['data'][f'{nm}-{area}.hab'] = {'size': os.path.getsize(p), 'sha256': sha_file(p)}
    return m


def manifest_diff(a, z):
    out = {'src': [], 'data': []}
    for k in sorted(set(a['src']) | set(z['src'])):
        if a['src'].get(k) != z['src'].get(k):
            out['src'].append(k)
    for k in sorted(set(a['data']) | set(z['data'])):
        if a['data'].get(k) != z['data'].get(k):
            out['data'].append(k)
    return out


def git(*args):
    try:
        return subprocess.run(['git', '-C', ROOT, *args], capture_output=True, text=True, timeout=60).stdout.strip()
    except Exception as e:  # noqa: BLE001
        return f'(git failed: {e})'


# ------------------------------------------------------------------ pinned modules
def pin_dir():
    return os.path.join(OUTDIR, 'pinned')


def pin(force):
    """Fetch src/spots/*.ts as the dev server serves them (vite-transformed) into <out>/pinned/: the UNEDITED scorer, for a later --pin."""
    dirty = git('status', '--porcelain', '--', 'app/src/spots')
    if dirty and not force:
        sys.exit('app/src/spots has local changes, so this is not the unedited scorer:\n' + dirty + '\n(--force pins it anyway)')
    d = pin_dir()
    os.makedirs(d, exist_ok=True)
    for old in glob.glob(os.path.join(d, '*.ts.js')):
        os.remove(old)
    spots = os.path.join(APPSRC, 'spots')
    files = {}
    for fn in sorted(os.listdir(spots)):
        name, ext = os.path.splitext(fn)
        if ext != '.ts' or name.endswith('.d') or name == 'unzipWorker':  # a worker is loaded with ?worker_file: never served from here
            continue
        with urllib.request.urlopen(f'{B.CFG.url}src/spots/{fn}', timeout=60) as r:
            body = r.read()
        with open(os.path.join(d, f'{name}.ts.js'), 'wb') as f:
            f.write(body)
        files[name] = {'bytes': len(body), 'sha256': hashlib.sha256(body).hexdigest(), 'rawSha256': sha_file(os.path.join(spots, fn))}
    with open(os.path.join(d, 'pin.json'), 'w', encoding='utf-8') as f:
        json.dump({'head': git('rev-parse', 'HEAD'), 'time': time.strftime('%F %T'), 'localChanges': dirty, 'files': files}, f, indent=1)
    log(f'pinned {len(files)} modules from git {git("rev-parse", "--short", "HEAD")}{" (WITH local changes: --force)" if dirty else ""} into {d}')
    return 0


def load_pins():
    pins = {}
    for p in sorted(glob.glob(os.path.join(pin_dir(), '*.ts.js'))):
        name = os.path.basename(p)[: -len('.ts.js')]
        with open(p, 'rb') as f:
            pins[name] = f.read()
    return pins


# ------------------------------------------------------------------ hashes: the page's against ours
def sha_f64(vals):
    vals = [(-1e300 if (isinstance(v, float) and v != v) else float(v)) for v in vals]
    return hashlib.sha256(struct.pack(f'<{len(vals)}d', *vals)).hexdigest()


def decode_b64(s):
    a = array('d')
    a.frombytes(base64.b64decode(s))
    return list(a)


def pstat(a):
    s, mx, mn, nan = 0.0, float('-inf'), float('inf'), 0
    for v in a:
        if v != v:
            nan += 1
            continue
        s += v
        if v > mx:
            mx = v
        if v < mn:
            mn = v
    return {'n': len(a), 'sum': s, 'max': mx, 'min': mn, 'nan': nan}


class NavLost(Exception):
    pass


def attempt(pw, area, frozen, pins, frozen_path):
    url = B.CFG.url + ('' if area == 'pickle-lake' else f'?area={area}')
    when, hours_from = day_args()
    t_start = time.monotonic()
    man0 = manifest(area)
    sess = B.Session(pw, init_scripts=(INIT_JS,), replay=True)
    page, console = sess.page, sess.console
    served = {}
    if pins:
        rx = re.compile(r'/src/spots/([A-Za-z0-9_]+)\.ts(\?t=\d+)?$')

        def pin_handler(route, request):
            m = rx.search(request.url)
            name = m.group(1) if m else None
            if name in pins:
                served[name] = served.get(name, 0) + 1
                return route.fulfill(status=200, headers={'content-type': 'text/javascript', 'cache-control': 'no-cache', 'access-control-allow-origin': '*'}, body=pins[name])
            return route.continue_()

        sess.ctx.route(rx, pin_handler)
    hosts = {}

    def on_req(r):
        m = re.match(r'https?://([^/]+)/', r.url)
        if m and not m.group(1).startswith('localhost'):
            hosts[m.group(1)] = hosts.get(m.group(1), 0) + 1

    page.on('request', on_req)
    run = {'area': area, 'url': url, 'pinned': sorted(pins) if pins else None, 'steps': []}

    def step(msg):
        run['steps'].append(f'{time.monotonic() - t_start:7.1f}s {msg}')
        log(f'[{area}] {msg}')

    def evaluate(js, arg=None):
        try:
            return page.evaluate(js, arg) if arg is not None else page.evaluate(js)
        except PWError as e:
            s = str(e)
            if 'context was destroyed' in s or 'Target closed' in s or 'Execution context' in s or 'navigat' in s.lower():
                raise NavLost(s.splitlines()[0][:160]) from e
            raise

    def check_loads():
        if console.loads > 1:
            raise NavLost(f'page loaded {console.loads} times')

    result = None
    try:
        page.goto(url, wait_until='load', timeout=120000)
        step('page loaded')
        ready = R.wait_ready(page, console, map_cap_s=240, pass_cap_s=180)
        run['mapAndStripS'] = ready['mapAndStripS']
        step(f'map + strip hours: {run["mapAndStripS"]} s')
        run['firstPassS'] = ready['firstPassS']
        step(f'first scoring pass: {run["firstPassS"]} s')
        check_loads()
        prep = evaluate(PREP_JS)
        run['prep'] = {k: v for k, v in prep.items() if k != 'condLive'}
        step(f'prep: {run["prep"]}')
        # evidence only: the sha256 of the module texts the page was served for the scorer's chain (the pinned copies at BEFORE, the live
        # edited files at AFTER); nothing in the dump reads it
        run['served'] = evaluate(SERVED_JS, prep['chain'])
        step('served module texts: ' + ', '.join(f'{k} {v["sha256"][:10]} ({v["bytes"]} B)' for k, v in run['served'].items()))
        t = time.monotonic()
        r2 = evaluate(READY2_JS)
        while time.monotonic() - t < 120 and not (r2['microGrid'] and r2['reliefSeesGoing'] and r2['hasConditions']):
            page.wait_for_timeout(1000)
            r2 = evaluate(READY2_JS)
        run['ready2'] = r2
        step(f'model grid / relief / store ready: {r2}')
        if not r2['microGrid']:
            raise RuntimeError('the model.ts instance has no micro grid: the ground-wind path would not run')
        # all momentum directions in (the console says which), or the grid has none
        t = time.monotonic()
        dirs = set()
        last_new = time.monotonic()
        while time.monotonic() - t < 150:
            for l in console.lines():
                mm = re.search(r'\[wind\] momentum ([\d. ]+)° in', l)
                if mm:
                    for d in mm.group(1).split():
                        if d not in dirs:
                            dirs.add(d)
                            last_new = time.monotonic()
            if len(dirs) >= 16 or console.count('no momentum solve'):
                break
            if not dirs and time.monotonic() - t > 40 and time.monotonic() - last_new > 40:
                break
            page.wait_for_timeout(500)
        run['momentumDirs'] = sorted(dirs)
        run['noMomentumSolve'] = bool(console.count('no momentum solve'))
        step(f'momentum directions seen: {len(dirs)} (no-solve line: {run["noMomentumSolve"]})')
        check_loads()
        # the app's own conditions, read once the passes are done
        cond_live = evaluate("async () => { const ss = await window.__imp('/src/state/spotsStore.ts'); const c = ss.useSpotsStore.getState().conditions; return c ? JSON.parse(JSON.stringify(c)) : null }")
        run['condLive'] = cond_live
        if frozen is None:
            cond_b = cond_live
            step(f'BEFORE: condition B = the store\'s ({"present, timeMs " + str(cond_b["timeMs"]) if cond_b else "null: B skipped"})')
        else:
            cond_b = frozen.get('condB')
            same = (cond_live == cond_b)
            run['condLiveEqualsFrozenB'] = same
            step(f'{LABEL}: condition B = the frozen literal (the store\'s now {"is the same" if same else "differs (the clock moved): ignored"})')
        meta = evaluate(SETUP_JS, {'whenISO': when, 'hoursFromISO': hours_from, 'condB': cond_b, 'frozenCells': (frozen or {}).get('cells'), 'frozenHours': (frozen or {}).get('hours')})
        if 'error' in meta:
            raise RuntimeError(meta['error'])
        step(f'setup: {meta["habitat"]["cols"]}x{meta["habitat"]["rows"]} cells, sample {meta["nSample2"]} (+{meta["nSample6"]} sparse), area {meta["area"]["id"]}, bands {meta["bandsPresent"]}')
        if frozen is not None:
            evaluate(PIN_STORE_JS, cond_b)
            step(f'{LABEL}: the store conditions pinned to the frozen B (the ground model reads its water temperature from there)')
        if frozen is None:
            with open(frozen_path, 'w', encoding='utf-8') as f:
                json.dump({'condB': cond_b, 'cells': {'uniform': meta['uniform'], 'diverse': meta['diverse']}, 'hours': meta.get('hours'), 'whenISO': when, 'frozenAt': time.strftime('%F %T')}, f)
        # stable ground-wind state
        t = time.monotonic()
        prev, same_n, probe0 = None, 0, None
        while time.monotonic() - t < 150:
            p = evaluate('() => window.__dump.probe()')
            if p == prev:
                same_n += 1
            else:
                same_n = 0
            prev = p
            if same_n >= 3:
                break
            page.wait_for_timeout(2000)
        probe0 = prev
        run['probe'] = probe0
        run['probeStableAfterS'] = round(time.monotonic() - t, 1) if same_n >= 3 else None
        step(f'ground-wind probe stable: {run["probeStableAfterS"]} s  {json.dumps(probe0)}')
        check_loads()
        conds = list(meta['conditions'].keys())
        shown = [t for t in ('moose', 'bear', 'grouse', 'deer') if meta['targets'][t]['show']]
        units = {t: {} for t in shown}
        texts = {}
        warnings = []
        for cn in conds:
            for t in shown:
                u = evaluate('([t, c]) => window.__dump.unit(t, c)', [t, cn])
                units[t][cn] = u
                if 'textsZ' in u:
                    # the page gzips the interned texts and sends the scores as base64 float64 (same data, a smaller CDP message)
                    texts.setdefault(t, {})[cn] = json.loads(gzip.decompress(base64.b64decode(u.pop('textsZ'))))
                    for wn, g in u['grid'].items():
                        for fld in ('hs', 'sf'):
                            if fld + 'B64' in g:
                                g[fld] = decode_b64(g.pop(fld + 'B64'))
                        # count / sum / max / min from the arrays here, in index order (the page's own once disagreed with its array, one time in the
                        # whole BEFORE set): a recurrence is a warning, and these are what is stored
                        for fld, key in (('hs', 'hsStat'), ('sf', 'sfStat'), ('sfWarm', 'sfWarmStat')):
                            arr = decode_b64(g['sfWarmB64']) if fld == 'sfWarm' else g[fld]
                            new = pstat(arr)
                            if any(g[key][k] != new[k] for k in ('n', 'sum', 'max', 'min', 'nan')):
                                warnings.append(f'{t}/{cn}/{wn}: page {key} {g[key]} is not the one of its array: {new}')
                            g[key] = new
                else:
                    tx = texts.setdefault(t, {}).setdefault(cn, {})
                    tx['describe'] = {'tab': u['describe'].pop('tab'), 'idx': u['describe'].pop('idx')}
                    tx['labelsByCell'] = u['site'].pop('labelsByCell')
                    for wn, g in u['grid'].items():
                        for fld in ('hsPartsText', 'sfPartsText'):
                            if fld in g:
                                tx[f'{wn}.{fld}'] = g.pop(fld)
                # the page's hashes against ours (transport check)
                for wn, g in u['grid'].items():
                    for fld in ('hs', 'sf'):
                        if sha_f64(g[fld]) != g[fld + 'Sha']:
                            warnings.append(f'{t}/{cn}/{wn}: {fld} sha differs between page and python (transport)')
                    if sha_f64(decode_b64(g['sfWarmB64'])) != g['sfWarmSha']:
                        warnings.append(f'{t}/{cn}/{wn}: sfWarm sha differs between page and python')
                for fld, bb in u['site']['b64'].items():
                    if sha_f64(decode_b64(bb)) != u['site']['sha'][fld]:
                        warnings.append(f'{t}/{cn}/{fld}: site array sha differs between page and python')
                if u.get('leeReset') != 'ok':
                    warnings.append(f'{t}/{cn}: lee/slot cache reset said {u.get("leeReset")!r}')
                step(f'unit {t}/{cn}: n={u["n"]} {u["ms"]} ms')
            check_loads()
        pure = evaluate('() => window.__dump.pure()')
        step(f'pure helpers and place rules: {pure["ms"]} ms')
        p_end = evaluate('() => window.__dump.probe()')
        run['probeEnd'] = p_end
        run['probeUnchanged'] = (p_end == probe0)
        step(f'ground-wind probe after the dump: {"unchanged" if p_end == probe0 else "CHANGED " + json.dumps(p_end)}')
        if p_end != probe0:
            raise NavLost('ground-wind state moved during the dump')
        check_loads()
        run['pageLoads'] = console.loads
        result = {'meta': meta, 'conditionB': cond_b, 'targets': units, 'pure': pure, 'harnessWarnings': warnings}
        result['_texts'] = texts
    finally:
        try:
            sess.close()
        except Exception:  # noqa: BLE001
            pass
        man1 = manifest(area)
        run['manifestChangedDuringRun'] = manifest_diff(man0, man1)
        run['seconds'] = round(time.monotonic() - t_start, 1)
        run['omcache'] = sess.omstats
        run['externalHosts'] = hosts
        run['pinServed'] = served
        run['pageLoads'] = console.loads
        lines = console.lines()
        run['pageerrors'] = [l for l in lines if '[pageerror]' in l]
        run['consoleErrors'] = [l for l in lines if '[error]' in l][:20]
        run['http4xx'] = [l for l in lines if '[http ' in l][:40]
        run['requestfailed'] = len([l for l in lines if '[requestfailed]' in l])
        sfx = '' if area == 'pickle-lake' else f'.{area}'
        console.save(os.path.join(OUTDIR, f'{LABEL}{sfx}.console.txt'))
        run['_man0'], run['_man1'] = man0, man1
    return result, run


def main():
    rest = B.configure(sys.argv[1:], default_name='scoredump')
    if not B.CFG.replay:
        sys.exit('scoredump.py always replays the Open-Meteo capture (a live forecast would differ between the two dumps): drop --live')
    if B.CFG.clock:
        sys.exit('scoredump.py fixes its own hours (and freezes the app\'s own conditions): do not hold the clock')
    p = argparse.ArgumentParser(add_help=False, allow_abbrev=False)
    p.add_argument('--areas', default=DEFAULT_AREAS)
    p.add_argument('--pin', action='store_true')
    p.add_argument('--no-pin', action='store_true')
    p.add_argument('--force', action='store_true')
    a, pos = p.parse_known_args(rest)
    if len(pos) != 1 or not re.fullmatch(r'[a-z0-9-]+', pos[0]):
        print(__doc__)
        return 2
    global LABEL, OUTDIR
    LABEL, OUTDIR = pos[0], B.CFG.out
    if LABEL == 'pin':
        return pin(a.force)
    areas = [x for x in a.areas.split(',') if x]
    pins = {}
    if not a.no_pin and (a.pin or LABEL == 'before'):
        pins = load_pins()
        if a.pin and not pins:
            sys.exit(f'no snapshot in {pin_dir()}: take one from the unedited tree first (scoredump.py pin)')
    t0 = time.monotonic()
    git_info = {'head': git('rev-parse', 'HEAD'), 'statusSrc': git('status', '--porcelain', '--', 'app/src'), 'time': time.strftime('%F %T')}
    log(f'{LABEL} -> {OUTDIR}  pinned={bool(pins)} areas={areas} git {git_info["head"][:8]} src status: {git_info["statusSrc"] or "clean"}')
    if pins:
        pj = os.path.join(pin_dir(), 'pin.json')
        if os.path.exists(pj):
            with open(pj, encoding='utf-8') as f:
                git_info['pin'] = json.load(f)
        log(f'pinned modules ({len(pins)}): {", ".join(sorted(pins))}')
        log(f'  snapshot taken {git_info.get("pin", {}).get("time", "(no pin.json)")} at git {str(git_info.get("pin", {}).get("head", "?"))[:8]}'
            f'{" WITH local changes" if git_info.get("pin", {}).get("localChanges") else ""}: pin again for each change, from the unedited tree')
    elif LABEL == 'before':
        log('no pinned snapshot: serving the live modules (pin first, from the unedited tree, if others may edit src/spots meanwhile)')
    summaries = {}
    with sync_playwright() as pw:
        for area in areas:
            sfx = '' if area == 'pickle-lake' else f'.{area}'
            frozen_path = os.path.join(OUTDIR, f'frozen{sfx}.json')
            frozen = None
            if LABEL != 'before':
                if not os.path.exists(frozen_path):
                    log(f'[{area}] no {os.path.basename(frozen_path)}: the "before" dump of this area was not taken; skipped')
                    continue
                with open(frozen_path, encoding='utf-8') as f:
                    frozen = json.load(f)
            res, run = None, None
            for k in range(1, 4):
                try:
                    res, run = attempt(pw, area, frozen, pins, frozen_path)
                    run['attempt'] = k
                    break
                except NavLost as e:
                    log(f'[{area}] attempt {k} lost the page: {e}; again')
                except Exception as e:  # noqa: BLE001
                    log(f'[{area}] attempt {k} failed: {type(e).__name__}: {str(e)[:300]}')
                    if k == 3:
                        summaries[area] = {'error': f'{type(e).__name__}: {str(e)[:300]}'}
            if res is None:
                summaries.setdefault(area, {'error': 'no result'})
                continue
            man0, man1 = run.pop('_man0'), run.pop('_man1')
            with open(os.path.join(OUTDIR, f'{LABEL}{sfx}.manifest.json'), 'w', encoding='utf-8') as f:
                json.dump({'start': man0, 'end': man1, 'git': git_info}, f)
            texts = res.pop('_texts', None)
            if texts is not None:
                with gzip.open(os.path.join(OUTDIR, f'{LABEL}{sfx}.text.json.gz'), 'wt', encoding='utf-8', compresslevel=6) as f:
                    json.dump(texts, f, separators=(',', ':'))
            res['run'] = run
            res['git'] = git_info
            res['out'] = LABEL
            res['pin'] = bool(pins)
            path = os.path.join(OUTDIR, f'{LABEL}{sfx}.json')
            with open(path, 'w', encoding='utf-8') as f:
                json.dump(res, f, allow_nan=True, separators=(',', ':'))
            write_hashes(res, os.path.join(OUTDIR, f'{LABEL}{sfx}.hashes.txt'))
            summaries[area] = summarize(res)
            log(f'[{area}] wrote {LABEL}{sfx}.json ({os.path.getsize(path) / 1e6:.1f} MB)')
    log(f'done in {time.monotonic() - t0:.0f} s')
    print(json.dumps(summaries, indent=1))
    return 1 if any('error' in s for s in summaries.values()) else 0


def write_hashes(res, path):
    lines = [f'{res["out"]} dump, area {res["meta"]["area"]["id"]}, sample {res["meta"]["nSample2"]} cells (conditions A, B), {res["meta"]["nSample6"]} cells (C, D, E)', f'git {res["git"]["head"]}', '']
    lines.append(f'{"target":7} {"cond":4} {"weights":8} {"n":>6}  {"hs sha256":64}  {"sf sha256":64}  {"sum hs":>20} {"sum sf":>20} {"max hs":>10} {"max sf":>10}  rev  hpMis sfpMis')
    for t, cs in res['targets'].items():
        for cn, u in cs.items():
            for wn, g in u['grid'].items():
                lines.append(f'{t:7} {cn:4} {wn:8} {u["n"]:6}  {g["hsSha"]}  {g["sfSha"]}  {g["hsStat"]["sum"]:20.12f} {g["sfStat"]["sum"]:20.12f} {g["hsStat"]["max"]:10.6f} {g["sfStat"]["max"]:10.6f}  {g["revBadCells"]:3d}  {g["hsPartsReturnMismatch"]:5d} {g["sfPartsVsWarmMismatch"]:6d}')
    with open(path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')


def summarize(res):
    s = {'cells': res['meta']['nSample2'], 'conds': list(res['meta']['conditions']), 'warnings': res['harnessWarnings'], 'ground': {}}
    for t, cs in res['targets'].items():
        for cn, u in cs.items():
            tally = u['site']['labelTally']
            ground = sum(v for k, v in tally.items() if k.startswith('scent:') and ('ground air' in k or 'still air at ground' in k))
            fallback = sum(v for k, v in tally.items() if k.startswith('scent:') and ('wind against' in k or k == 'scent:thermals'))
            s['ground'][f'{t}/{cn}'] = {'groundAirCells': ground, 'fallbackCells': fallback}
    return s


if __name__ == '__main__':
    sys.exit(main())
