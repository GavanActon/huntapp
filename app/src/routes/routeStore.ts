import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { ACTIVE_AREA, DEFAULT_AREA, otherAreaAt, readAreaItem, writeAreaItem } from '../areas'
import { CORE } from '../config'
import { devlog } from '../devlog'
import { getMap } from '../map/mapController'
import { useMeasureStore } from '../measure/measureStore'
import { habitat } from '../spots/habitatGrid'
import { isFish } from '../spots/types'
import { useAppStore } from '../state/appStore'
import { homePlace } from '../state/placesStore'
import { useSpotsStore } from '../state/spotsStore'
import { useGpsStore } from '../tracking/gpsStore'
import { groundSampler } from '../weather/micro/model'
import { cellAt, cellCentre, loadGoing, type Going } from './goingGrid'
import { HUNT, HUNT_STYLE } from './walkModel'
import type { HuntField, RouteResult, WindField } from './router'
import type { FromWorker } from './routeWorker'
import { askWorker } from './workerClient'

/**
 * Route mode: pick where you are going and the app finds the three best
 * ways there on foot, from you (or camp, with no good fix). "Easiest" is
 * the quickest walk: grade, bush, rough and wet ground, creeks and roads
 * (routes/walkModel.ts). "Hunt" still walks well but bends toward good
 * ground for the animal picked on the strip and keeps your scent off it and
 * off the spot you are heading for, so you come in with the wind in your
 * face.
 *
 * While the card is up the map's tap is the route's: it moves where you
 * are going, a tap on a route picks it, and both ends drag. Closing the
 * card keeps the picked route on the map (and through a reload), so it can
 * be planned at camp and walked later, out hunting; Clear takes it away.
 */

export type RouteMode = 'easy' | 'hunt'
export const ROUTE_LETTERS = ['A', 'B', 'C']
export const ROUTE_COLOURS = ['#3fc8ff', '#c792ff', '#ffe066']

export interface RouteEnd {
  lon: number
  lat: number
  /** you: the fix; camp: the first place; place: a saved place; map: a tap or a drag */
  kind: 'you' | 'camp' | 'place' | 'map'
  name: string
}

export interface DrawnRoute extends Omit<RouteResult, 'cells'> {
  coords: [number, number][]
}

export interface KeptRoute {
  coords: [number, number][]
  k: number
  mode: RouteMode
  timeS: number
  distM: number
  climbM: number
  from: string
  to: string
}

export type RouteStatus = 'idle' | 'working' | 'ready' | 'no-grid' | 'outside' | 'water' | 'no-way'

interface RouteState {
  open: boolean
  from: RouteEnd | null
  to: RouteEnd | null
  mode: RouteMode
  stayDry: boolean
  status: RouteStatus
  routes: DrawnRoute[]
  pick: number
  /** fewer routes than three, because there is only the one real way */
  oneWay: boolean
  /** the picked route, left on the map after the card closes */
  kept: KeptRoute | null
  setPick: (k: number) => void
  setMode: (m: RouteMode) => void
  setStayDry: (v: boolean) => void
  setTo: (e: RouteEnd) => void
  setFrom: (e: RouteEnd) => void
  swap: () => void
  /** which end the next map tap sets (to, unless From · Tap the map was chosen) */
  picking: 'from' | 'to'
  setPicking: (p: 'from' | 'to') => void
}

/**
 * The ends and the kept route are places, so each area keeps its own: Pickle
 * Lake's in 'huntapp-routes' with the rest, as before there were areas;
 * another area's under ENDS_KEY with its id on it. How a route is worked
 * out (mode, stay dry) is one setting, kept in 'huntapp-routes' wherever it
 * was set. Away from Pickle Lake every write to 'huntapp-routes' carries
 * Pickle Lake's ends through as they were read, so a route planned at its
 * camp is there again on the way back.
 */
type Ends = Pick<RouteState, 'from' | 'to' | 'kept'>
const ENDS_KEY = 'huntapp-routes-ends'
const AWAY = ACTIVE_AREA.id !== DEFAULT_AREA
let pickleEnds: Ends = { from: null, to: null, kept: null }

/** Ends saved in another area (the app holds one at a time) are let go, so
 *  this area's card does not open on ground it has no grid for. */
function ownEnds(e: Partial<Ends>): Ends {
  const start = e.kept?.coords[0]
  return {
    from: e.from && !otherAreaAt(e.from.lon, e.from.lat) ? e.from : null,
    to: e.to && !otherAreaAt(e.to.lon, e.to.lat) ? e.to : null,
    kept: e.kept && !(start && otherAreaAt(start[0], start[1])) ? e.kept : null,
  }
}

function readAwayEnds(): Partial<Ends> {
  try {
    const raw = readAreaItem(ENDS_KEY)
    return raw ? (JSON.parse(raw) as Partial<Ends>) : {}
  } catch {
    return {}
  }
}

export const useRoutes = create<RouteState>()(
  persist(
    (set, get) => ({
      open: false,
      from: null,
      to: null,
      mode: 'easy',
      stayDry: false,
      status: 'idle',
      routes: [],
      pick: 0,
      oneWay: false,
      kept: null,
      setPick: (pick) => set({ pick }),
      setMode: (mode) => set({ mode }),
      setStayDry: (stayDry) => set({ stayDry }),
      setTo: (to) => set({ to, picking: 'to' }),
      setFrom: (from) => set({ from, picking: 'to' }),
      picking: 'to',
      setPicking: (picking) => set({ picking }),
      swap: () => {
        const { from, to } = get()
        if (from && to) set({ from: to, to: from })
      },
    }),
    {
      name: 'huntapp-routes',
      partialize: (s) =>
        AWAY
          ? { from: pickleEnds.from, to: pickleEnds.to, mode: s.mode, stayDry: s.stayDry, kept: pickleEnds.kept }
          : { from: s.from, to: s.to, mode: s.mode, stayDry: s.stayDry, kept: s.kept },
      merge: (persisted, current) => {
        const p = { ...(persisted as Partial<RouteState> | undefined) }
        if (!AWAY) return { ...current, ...p, ...ownEnds(p) }
        // Pickle Lake's ends are kept aside, as read; this area's come from its own key
        pickleEnds = { from: p.from ?? null, to: p.to ?? null, kept: p.kept ?? null }
        return { ...current, ...p, ...ownEnds(readAwayEnds()) }
      },
    },
  ),
)

// away from Pickle Lake, this area's ends are saved under its key as they change
if (AWAY)
  useRoutes.subscribe((s, p) => {
    if (s.from !== p.from || s.to !== p.to || s.kept !== p.kept) writeAreaItem(ENDS_KEY, JSON.stringify({ from: s.from, to: s.to, kept: s.kept }))
  })

export function inGrid(lon: number, lat: number): boolean {
  return lon >= CORE.west && lon <= CORE.east && lat >= CORE.south && lat <= CORE.north
}

/** You, as a route end: the fix, while location is on and it falls in the grid. */
export function youEnd(): RouteEnd | null {
  const g = useGpsStore.getState()
  const fix = g.fix
  if (!g.locating || !fix || (fix.sigma ?? fix.accuracy) > 150 || !inGrid(fix.lon, fix.lat)) return null
  return { lon: fix.lon, lat: fix.lat, kind: 'you', name: 'You' }
}

/** Camp, as a route end. */
export function campEnd(): RouteEnd {
  const camp = homePlace()
  return { lon: camp.lon, lat: camp.lat, kind: 'camp', name: camp.name }
}

/** Where a route starts with nothing better: you, with location on; else camp. */
export function defaultFrom(): RouteEnd {
  return youEnd() ?? campEnd()
}

/** Open the card; with a point, that is where you are going. */
export function openRoutes(to?: { lon: number; lat: number; name?: string; kind?: RouteEnd['kind'] }) {
  useMeasureStore.getState().stop()
  useAppStore.getState().closeSheet()
  const s = useRoutes.getState()
  // from you whenever location is on; a from you picked by hand (a tap, a place) stays
  const from = youEnd() ?? (s.from && s.from.kind !== 'you' ? s.from : campEnd())
  useRoutes.setState({
    open: true,
    from,
    picking: 'to',
    ...(to ? { to: { lon: to.lon, lat: to.lat, kind: to.kind ?? 'map', name: to.name ?? '' } } : {}),
    pick: to ? 0 : s.pick,
  })
}

/** Close the card, keeping the picked route on the map. */
export function closeRoutes() {
  const s = useRoutes.getState()
  const r = s.routes[s.pick]
  useRoutes.setState({
    open: false,
    routes: [],
    status: 'idle',
    kept: r ? { coords: r.coords, k: s.pick, mode: s.mode, timeS: r.timeS, distM: r.distM, climbM: r.climbM, from: s.from?.name ?? '', to: s.to?.name ?? '' } : s.kept,
  })
}

/** Take the routes off the map altogether. */
export function clearRoutes() {
  useRoutes.setState({ to: null, routes: [], kept: null, status: 'idle', pick: 0 })
}

// ---- the worker ----

/** the latest run: an answer to an earlier one is dropped */
let latest = 0
let timer: number | null = null

/** The ground wind over the grid every ~250 m, for scent and the way in. */
function windField(g: Going, ms: number): WindField | undefined {
  const sample = groundSampler(ms)
  if (!sample) return undefined
  const step = 25
  const cols = Math.ceil(g.data.cols / step) + 1
  const rows = Math.ceil(g.data.rows / step) + 1
  const e = new Float32Array(cols * rows)
  const n = new Float32Array(cols * rows)
  const sig = new Float32Array(cols * rows)
  const out = new Float32Array(3)
  const { grid } = g
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const lon = grid.west + Math.min(c * step, g.data.cols - 1) * grid.dLon
      const lat = grid.north - Math.min(r * step, g.data.rows - 1) * grid.dLat
      if (!sample(lon, lat, out)) continue
      const k = r * cols + c
      e[k] = out[0]
      n[k] = out[1]
      sig[k] = out[2]
    }
  return { cols, rows, step, e, n, sig }
}

/** Why a hunt route cannot be had right now, or null when it can. */
export function huntBlocked(): string | null {
  const sp = useSpotsStore.getState()
  if (isFish(sp.target)) return 'Hunt routes follow a game animal: pick one on the strip.'
  if (sp.status !== 'ready' || !sp.result) return 'Hunt routes wait on the scores, which wait on a forecast.'
  return null
}

/** How good the ground under the going grid is for the game today, 0..1:
 *  the Spots scores, cut out of the habitat grid and ranked against each
 *  other (walkModel HUNT), since a route is about the best ground near it. */
function huntField(g: Going): HuntField | undefined {
  const res = useSpotsStore.getState().result
  const h = habitat()
  if (!res || !h || huntBlocked()) return undefined
  const { c0, r0, k } = g.data.hab
  const hcols = Math.ceil(g.data.cols / k)
  const hrows = Math.ceil(g.data.rows / k)
  const raw = new Float32Array(hcols * hrows)
  for (let r = 0; r < hrows; r++)
    for (let c = 0; c < hcols; c++) {
      const hr = r0 + r
      const hc = c0 + c
      if (hr < h.rows && hc < h.cols) raw[r * hcols + c] = res.scores[hr * h.cols + hc]
    }
  const ranked = raw.filter((v) => v > 0).sort()
  if (!ranked.length) return undefined
  const at = (q: number) => ranked[Math.min(ranked.length - 1, Math.floor(q * ranked.length))]
  const lo = Math.max(HUNT.floor, at(HUNT.lowPct))
  const hi = Math.max(lo + 0.05, at(HUNT.topPct))
  const game = raw.map((v) => Math.min(1, Math.max(0, (v - lo) / (hi - lo))))
  const t = useSpotsStore.getState().target
  const style = HUNT_STYLE[t as keyof typeof HUNT_STYLE] ?? HUNT_STYLE.moose
  return { game, hcols, hrows, ...style }
}

async function run() {
  const s = useRoutes.getState()
  if (!s.open || !s.from || !s.to) return
  if (!inGrid(s.from.lon, s.from.lat) || !inGrid(s.to.lon, s.to.lat)) return useRoutes.setState({ status: 'outside', routes: [] })
  const g = await loadGoing()
  if (!g) return useRoutes.setState({ status: 'no-grid', routes: [] })
  const start = cellAt(g, s.from.lon, s.from.lat)
  const goal = cellAt(g, s.to.lon, s.to.lat)
  if (start < 0 || goal < 0) return useRoutes.setState({ status: 'outside', routes: [] })
  const app = useAppStore.getState()
  const ms = app.planTimeMs ?? Date.now()
  const mine = ++latest
  useRoutes.setState({ status: 'working' })
  const hunt = s.mode === 'hunt' ? huntField(g) : undefined
  const req = { start, goal, opts: { paceKmh: app.paceKmh, stayDry: s.stayDry }, wind: windField(g, ms), hunt }
  const m = await askWorker(g, (id) => ({ type: 'route', id, req }))
  if (mine === latest) onAnswer(g, m)
}

function onAnswer(g: Going, m: FromWorker) {
  if (m.type === 'swing') return
  if (m.type === 'error') {
    devlog('routes', `worker · ${m.message}`)
    return useRoutes.setState({ status: 'no-way', routes: [] })
  }
  const a = m.answer
  devlog('routes', `${a.routes.length} routes in ${m.ms.toFixed(0)} ms${a.note ? ` · ${a.note}` : ''}`)
  if (a.note === 'water') return useRoutes.setState({ status: 'water', routes: [] })
  if (!a.routes.length) return useRoutes.setState({ status: 'no-way', routes: [] })
  const routes: DrawnRoute[] = a.routes.map(({ cells, ...rest }) => {
    const coords = Array.from(cells, (i) => cellCentre(g, i))
    // the ends where they were put, not the centres of their cells
    const s = useRoutes.getState()
    if (s.from) coords[0] = [s.from.lon, s.from.lat]
    if (s.to) coords[coords.length - 1] = [s.to.lon, s.to.lat]
    return { ...rest, coords }
  })
  const pick = Math.min(useRoutes.getState().pick, routes.length - 1)
  useRoutes.setState({ status: 'ready', routes, pick, oneWay: a.note === 'one way' })
  fitRoutes(routes)
}

/** The whole route in view above the card: the map fits the three ways,
 *  padded for the strip and the bottom bar, and stops following you. */
function fitRoutes(routes: DrawnRoute[]) {
  const m = getMap()
  if (!m || !routes.length) return
  let w = Infinity
  let s = Infinity
  let e = -Infinity
  let n = -Infinity
  for (const r of routes)
    for (const [lon, lat] of r.coords) {
      w = Math.min(w, lon)
      e = Math.max(e, lon)
      s = Math.min(s, lat)
      n = Math.max(n, lat)
    }
  if (!Number.isFinite(w)) return
  useAppStore.getState().setFollow(false)
  const bar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--barh'))
  const pad = { top: 130, bottom: (Number.isFinite(bar) ? bar : 0) + 40, left: 30, right: 30 }
  const room = m.getContainer().clientHeight - 60
  if (pad.top + pad.bottom > room) {
    const k = Math.max(0, room) / (pad.top + pad.bottom)
    pad.top = Math.round(pad.top * k)
    pad.bottom = Math.round(pad.bottom * k)
  }
  m.fitBounds(
    [
      [w, s],
      [e, n],
    ],
    { padding: pad, maxZoom: 16, duration: 500 },
  )
}

function schedule() {
  if (timer != null) window.clearTimeout(timer)
  timer = window.setTimeout(() => {
    timer = null
    void run()
  }, 120)
}

let wired = false
/** Call once at startup: a route is worked out again whenever what it rests on changes. */
export function initRoutes() {
  if (wired) return
  wired = true
  useRoutes.subscribe((s, p) => {
    if (s.open && (s.open !== p.open || s.from !== p.from || s.to !== p.to || s.mode !== p.mode || s.stayDry !== p.stayDry)) schedule()
    if (s.mode !== p.mode) useRoutes.setState({ pick: 0 })
  })
  useAppStore.subscribe((s, p) => {
    if (useRoutes.getState().open && (s.paceKmh !== p.paceKmh || s.planTimeMs !== p.planTimeMs)) schedule()
  })
  // a new scoring pass (the hour, the target, the knobs) moves a hunt route
  useSpotsStore.subscribe((s, p) => {
    const r = useRoutes.getState()
    if (r.open && r.mode === 'hunt' && (s.result !== p.result || s.target !== p.target)) schedule()
  })
  // the ruler and the route card share the tap: one at a time
  useMeasureStore.subscribe((s, p) => {
    if (s.active && !p.active && useRoutes.getState().open) closeRoutes()
  })
}
