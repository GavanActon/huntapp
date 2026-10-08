/**
 * What gets used, read off the stores (analytics.ts sends it): a sheet or
 * a card opened and how long it stayed, a layer or a setting changed, a
 * mode switched, a tool or a form opened and closed, a check, an entry, a
 * pin, a track, a route, a download. Reading the stores keeps the feature
 * code free of tracking calls, and catches a thing however it was done (a
 * hot button, a menu row, a link).
 *
 * Sliders and drags settle first: one event for where they came to rest.
 */

import { countMap, countTap, setUserNames, track, trackTime, type Props } from '../analytics'
import { useHunting } from '../hunting/hunting'
import { useHuntLog } from '../log/huntLog'
import { onEachMap, onFirstIdle } from '../map/mapController'
import { DROPPED_NAME } from '../map/placePopup'
import { useMeasureStore } from '../measure/measureStore'
import { useAppUpdate } from '../offline/appUpdate'
import { useDownloads } from '../offline/downloads'
import { useRoutes } from '../routes/routeStore'
import { topSheet, useAppStore, type AppState, type HotSide } from '../state/appStore'
import { usePlacesStore } from '../state/placesStore'
import { useSpotsStore } from '../state/spotsStore'
import { BUILT_IN, useViews } from '../state/viewsStore'
import { useGpsStore } from '../tracking/gpsStore'
import { useTrackStore } from '../tracking/trackStore'
import { useHeardForm } from '../ui/HeardCard'
import { useLogForm } from '../ui/LogCard'
import { useCheckForm } from '../ui/WindCheckCard'
import { useScent } from '../weather/micro/scent'
import { useWindChecks } from '../weather/micro/windChecks'

const timers = new Map<string, number>()

/** Once it has stopped changing: the slider let go, the typing done. */
function settle(key: string, fn: () => void, ms = 1500) {
  window.clearTimeout(timers.get(key))
  timers.set(
    key,
    window.setTimeout(() => {
      timers.delete(key)
      fn()
    }, ms),
  )
}

const secs = (since: number) => (since ? (Date.now() - since) / 1000 : null)

/** Something with an open and a close: an event for each, the close with how long. */
function span(name: string) {
  let at = 0
  let was: string | null = null
  return (now: string | null, props?: Props) => {
    if (now === was) return
    if (was) track(`${name}_close`, { [name]: was, s: secs(at), ...props })
    if (now) {
      at = Date.now()
      track(name, { [name]: now })
    }
    was = now
  }
}

/** The plain settings: an event with the value each comes to rest on. */
const SETTINGS = ['units', 'paceKmh', 'windFlowOpacity', 'windLevel', 'leaves', 'textSize', 'outdoor', 'leftHanded', 'buttonLabels', 'hotHidden', 'stripButtons', 'marksHidden', 'pastHunts', 'contourInterval', 'historicalYear', 'follow'] as const satisfies readonly (keyof AppState)[]

function setting(key: string, read: () => unknown) {
  settle(`set:${key}`, () => {
    const v = read()
    track('setting', { key, value: typeof v === 'object' && v !== null ? JSON.stringify(v) : (v as Props[string]) })
  })
}

/** The keys of two flat records that differ. */
function changed<T extends object>(a: T, b: T): (keyof T)[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)] as (keyof T)[])
  return [...keys].filter((k) => a[k] !== b[k])
}

function watchApp() {
  const sheet = span('sheet')
  const card = span('card')
  useAppStore.subscribe((s, p) => {
    const top = topSheet(s)?.kind ?? null
    if (top !== (topSheet(p)?.kind ?? null)) sheet(top)
    const tc = s.topCard ? s.topCard.kind : null
    if (tc !== (p.topCard ? p.topCard.kind : null)) card(tc)
    if (s.stripOpen !== p.stripOpen) track('strip', { open: s.stripOpen })
    if (s.liveFolded !== p.liveFolded) track('live_card', { folded: s.liveFolded })

    for (const k of SETTINGS) if (s[k] !== p[k]) setting(k, () => useAppStore.getState()[k])
    if (s.who !== p.who) setting('who', () => !!useAppStore.getState().who)
    // one or two layers: a switch; more at once is a view applied (its own event)
    if (s.layers !== p.layers) {
      const ks = changed(s.layers, p.layers)
      if (ks.length <= 2) for (const k of ks) track('layer', { layer: k, on: s.layers[k] })
    }
    if (s.opacity !== p.opacity) for (const k of changed(s.opacity, p.opacity)) setting(`opacity.${k}`, () => useAppStore.getState().opacity[k])
    if (s.saturation !== p.saturation) for (const k of changed(s.saturation, p.saturation)) setting(`saturation.${k}`, () => useAppStore.getState().saturation[k])
    if (s.flowTuning !== p.flowTuning) for (const k of changed(s.flowTuning, p.flowTuning)) setting(`flow.${k}`, () => useAppStore.getState().flowTuning[k])
    if (s.marks !== p.marks) for (const k of changed(s.marks, p.marks)) setting(`marks.${k}`, () => useAppStore.getState().marks[k])
    if (s.starred !== p.starred) setting('starred', () => useAppStore.getState().starred.join(','))
    if (s.hotButtons !== p.hotButtons) {
      for (const mode of ['hunt', 'fish'] as const) {
        if (s.hotButtons[mode] === p.hotButtons[mode]) continue
        settle(`hot:${mode}`, () => {
          const h = useAppStore.getState().hotButtons[mode]
          const side = (k: HotSide) => h[k].join(',')
          track('hot_layout', { mode, near: side('near'), far: side('far') })
        })
      }
    }
    if (s.planTimeMs !== p.planTimeMs) {
      settle('plan', () => {
        const ms = useAppStore.getState().planTimeMs
        track('plan_time', { ahead_h: ms == null ? 0 : (ms - Date.now()) / 3_600_000 })
      }, 2500)
    }
  })
}

const builtIn = new Set(BUILT_IN.map((v) => v.id))

function watchModes() {
  useViews.subscribe((s, p) => {
    if (s.mode !== p.mode) track('mode', { mode: s.mode })
    if (s.lastViewId !== p.lastViewId && s.lastViewId) track('view', { view: builtIn.has(s.lastViewId) ? s.lastViewId : 'custom', mode: s.mode })
    if (s.saved.length > p.saved.length) track('view_save', { n: s.saved.length })
    if (s.saved.length < p.saved.length) track('view_delete', { n: s.saved.length })
  })
  useSpotsStore.subscribe((s, p) => {
    if (s.target !== p.target) track('quarry', { target: s.target })
    if (s.heat !== p.heat) track('heat', { on: s.heat, target: s.target })
    if (s.heatScale !== p.heatScale) setting('spots.heatScale', () => useSpotsStore.getState().heatScale)
    if (s.heatStrength !== p.heatStrength) setting('spots.heatStrength', () => useSpotsStore.getState().heatStrength)
    if (s.detail !== p.detail) setting('spots.detail', () => useSpotsStore.getState().detail)
    if (s.weights !== p.weights) for (const k of changed(s.weights, p.weights)) setting(`spots.weight.${String(k)}`, () => useSpotsStore.getState().weights[k])
  })
  useHunting.subscribe((s, p) => {
    if (s.cone !== p.cone) track('cone', { on: s.cone })
  })
  useScent.subscribe((s, p) => {
    if (s.people.length !== p.people.length) {
      settle('scent.n', () => {
        const people = useScent.getState().people
        track('scent_people', { n: people.length, live: people.some((x) => x.live) })
      }, 800)
    }
    for (const k of ['hidden', 'card', 'distances', 'view', 'height', 'risk', 'strength'] as const) {
      if (s[k] !== p[k]) setting(`scent.${k}`, () => useScent.getState()[k] as Props[string])
    }
  })
}

function watchTools() {
  const tool = span('tool')
  const form = span('form')
  let measured = 0
  const toolNow = () => (useMeasureStore.getState().active ? 'measure' : useRoutes.getState().open ? 'routes' : null)
  useMeasureStore.subscribe((s, p) => {
    if (s.active !== p.active) tool(toolNow(), p.active ? { pts: measured } : undefined)
    measured = s.points.length
  })
  useRoutes.subscribe((s, p) => {
    if (s.open !== p.open) tool(toolNow())
    if (p.status === 'working' && s.status !== 'working') track('route', { status: s.status, mode: s.mode, dry: s.stayDry, n: s.routes.length, one_way: s.oneWay })
    if (s.kept && s.kept !== p.kept) track('route_keep', { mode: s.mode })
  })
  // the bar's forms, and the buttons that wait for a tap on the map first
  const formNow = () => (useLogForm.getState().at ? 'log' : useHeardForm.getState().open ? 'heard' : useCheckForm.getState().at ? 'check' : null)
  useLogForm.subscribe(() => form(formNow()))
  useHeardForm.subscribe((s, p) => {
    if (s.placing && !p.placing) track('arm', { what: 'heard' })
    form(formNow())
  })
  useCheckForm.subscribe((s, p) => {
    if (s.arming && !p.arming) track('arm', { what: 'check' })
    form(formNow())
  })
  useScent.subscribe((s, p) => {
    if (s.adding && !p.adding) track('arm', { what: 'scent' })
  })
}

function watchRecords() {
  const own = (by?: string) => (by ?? '') === useAppStore.getState().who
  useWindChecks.subscribe((s, p) => {
    if (s.checks === p.checks) return
    const before = new Map(p.checks.map((c) => [c.id, c]))
    const fresh = s.checks.filter((c) => !before.has(c.id))
    const mine = fresh.filter((c) => c.source === 'hand' && own(c.by) && Date.now() - c.ts < 10 * 60_000)
    for (const c of mine) track('wind_check', { strength: c.strength, calm: c.dirFrom == null, swing: !!c.swingDeg, aloft: c.aloft ?? null, held: c.held ?? null, note: !!c.note, seen: c.seen ?? null })
    if (fresh.length > mine.length) track('checks_merged', { n: fresh.length - mine.length })
    // another puff folded into a check just made
    for (const c of s.checks) {
      const o = before.get(c.id)
      if (o && (c.puffs ?? 1) > (o.puffs ?? 1)) track('wind_puff', { puffs: c.puffs ?? 1 })
    }
  })
  useHuntLog.subscribe((s, p) => {
    if (s.entries.length <= p.entries.length) return
    const had = new Set(p.entries.map((e) => e.id))
    for (const e of s.entries) if (!had.has(e.id)) track('log_entry', { species: e.species, what: e.what, kind: e.kind ?? null, sound: e.sound ?? null, count: e.count ?? null, from_you: !!e.from, note: !!e.note })
  })
  usePlacesStore.subscribe((s, p) => {
    if (s.places === p.places) return
    const had = new Set(p.places.map((x) => x.id))
    const has = new Set(s.places.map((x) => x.id))
    for (const x of s.places) if (!had.has(x.id) && x.savedAt > 0) track('pin_add', { kind: x.kind })
    for (const x of p.places) if (!has.has(x.id) && x.savedAt > 0) track('pin_remove', { kind: x.kind })
  })
  useTrackStore.subscribe((s, p) => {
    if (s.recordingId === p.recordingId) return
    if (p.recordingId) {
      const t = p.tracks.find((x) => x.id === p.recordingId)
      const last = t?.points[t.points.length - 1]?.ts ?? Date.now()
      track('track_stop', { min: t ? (last - t.startedAt) / 60_000 : null, pts: t?.points.length ?? null })
    }
    if (s.recordingId) track('track_start')
  })
}

function watchPhone() {
  let waitFix = 0
  useGpsStore.subscribe((s, p) => {
    if (s.locating !== p.locating) {
      track('location', { on: s.locating })
      waitFix = s.locating && !s.fix ? Date.now() : 0
    }
    if (s.headingUp !== p.headingUp) track('heading_up', { on: s.headingUp })
    if (s.status !== p.status && (s.status === 'denied' || s.status === 'error' || s.status === 'insecure')) track('gps', { status: s.status })
    // time to the first fix after location goes on: what a cold GPS costs in the bush
    if (waitFix && s.fix && !p.fix) {
      track('gps_fix', { ms: Date.now() - waitFix, acc: Math.round(s.fix.sigma ?? s.fix.accuracy) })
      waitFix = 0
    }
  })
  useDownloads.subscribe((s, p) => {
    if (s.active && !p.active) track('download_start', { area: s.areaId, files: s.fileCount, mb: s.total / 1e6 })
    if (!s.active && p.active) track('download', { area: p.areaId, files: p.fileCount, done: s.fileIdx, mb: s.total / 1e6, ok: !s.error, skipped: s.skipped.length })
  })
  useAppUpdate.subscribe((s, p) => {
    if (s.ready && !p.ready) track('update_ready', { latest: s.latest })
  })
}

function watchMap() {
  onEachMap((m) => {
    trackTime('map_ready')
    onFirstIdle(m, () => trackTime('map_idle'))
    m.on('click', () => {
      countTap()
      track('map_tap', { z: Math.round(m.getZoom() * 2) / 2 })
    })
    m.on('dragend', () => countMap('pan'))
    m.on('zoomend', (e) => {
      if ((e as { originalEvent?: unknown }).originalEvent) countMap('zoom')
    })
  })
}

/** The names you gave things: blanked out of a tapped button's label. */
function userNames(): string[] {
  const out = [useAppStore.getState().who]
  for (const p of usePlacesStore.getState().places) if (p.savedAt > 0 && p.name !== DROPPED_NAME) out.push(p.name)
  for (const v of useViews.getState().saved) out.push(v.name)
  for (const t of useTrackStore.getState().tracks) out.push(t.name)
  for (const e of useHuntLog.getState().entries) if (e.note) out.push(e.note)
  for (const c of useWindChecks.getState().checks) if (c.note) out.push(c.note)
  return out
}

let wired = false
/** Call once, with the app up. */
export function initStatsWatch(): void {
  if (wired) return
  wired = true
  setUserNames(userNames)
  watchApp()
  watchModes()
  watchTools()
  watchRecords()
  watchPhone()
  watchMap()
}
