import type { Feature, FeatureCollection } from 'geojson'
import type { GeoJSONSource, Map as MlMap } from 'maplibre-gl'
import { create } from 'zustand'
import { devlog } from '../devlog'
import { onEachMap } from '../map/mapController'
import { SOUND_NAMES, useHuntLog, type LogEntry } from '../log/huntLog'
import { cellAt, cellCentre, loadGoing, type Going } from '../routes/goingGrid'
import { askWorker } from '../routes/workerClient'
import { useGpsStore } from '../tracking/gpsStore'
import { compass } from '../weather/openMeteo'
import { groundWind } from '../weather/micro/model'
import { SCENT_NOTICE, scentAt, useScent } from '../weather/micro/scent'
import { useHunting } from './hunting'
import { SWING, type SwingRequest } from './swing'

/**
 * The moose you hear while hunting, on the map: each sound where it came
 * from (the dot is the hunt log's own), joined in the order they came with
 * arrows, a faint line back to where you stood when you heard it, and
 * where he is likely to go next.
 *
 * A bull coming to a call very often swings round to get downwind of the
 * caller and scent-check before he shows himself. It is what happened on
 * 2026-09-27: he pulled the hunter off the calling spot, then ran to get
 * downwind. So from his last spot the map draws his likeliest way round to
 * your scent: a least-cost path for a wary bull over the LiDAR going grid
 * (swing.ts, in the route worker), keeping to cover and off open ground in
 * your sight, holding off at hang-up range, and ending where your scent as
 * drawn (the live cone, or downwind on the ground wind without it) is
 * noticeable at his nose. The way round is the way he has been moving round
 * if that says, the cheaper way if not. With two sounds in the last half
 * hour it also draws the way he is heading. Off the grid, a plain arc round
 * you at his distance stands in. A model of what bulls often do, not a
 * forecast: he may just come straight in, or leave.
 */

const SRC = 'moose-moves'
/** a sound this recent still says where he is */
const RECENT_MS = 30 * 60_000
/** after a hunt, its sounds stay on the map this long */
const AFTER_MS = 3 * 3600_000

const KY = 110_574
const kx = (lat: number) => 111_320 * Math.cos((lat * Math.PI) / 180)
type LL = { lon: number; lat: number }

export function bearingTo(a: LL, b: LL): number {
  return ((Math.atan2((b.lon - a.lon) * kx(a.lat), (b.lat - a.lat) * KY) * 180) / Math.PI + 360) % 360
}
export function metresTo(a: LL, b: LL): number {
  return Math.hypot((b.lon - a.lon) * kx(a.lat), (b.lat - a.lat) * KY)
}
/** The point m metres from p on a true bearing. */
export function offsetBy(p: LL, bearing: number, m: number): [number, number] {
  const r = (bearing * Math.PI) / 180
  return [p.lon + (Math.sin(r) * m) / kx(p.lat), p.lat + (Math.cos(r) * m) / KY]
}
/** Signed turn from bearing a to bearing b, −180..180, clockwise positive. */
const turnTo = (a: number, b: number) => ((b - a + 540) % 360) - 180

/**
 * The moose heard or seen this hunt, oldest first: from half an hour before
 * it started (a grunt that got you going, or one logged as a few minutes
 * ago), or after one, the last three hours.
 */
export function heardThisHunt(): LogEntry[] {
  const h = useHunting.getState()
  const since = h.on && h.startedAt ? h.startedAt - RECENT_MS : Date.now() - AFTER_MS
  return useHuntLog
    .getState()
    .entries.filter((e) => e.species === 'moose' && (e.what === 'heard' || e.what === 'seen' || e.what === 'called') && e.ts >= since)
    .sort((a, b) => a.ts - b.ts)
}

/** Which way your scent goes now: the live cone's main sector, or downwind on the ground wind. */
function scentGoes(at: LL): number | null {
  const sc = useScent.getState()
  const k = sc.people.findIndex((p) => p.live)
  const pl = k >= 0 ? sc.plumes[k] : null
  if (pl) return pl.calm && pl.mainShare < 0.35 ? null : pl.mainToward
  const g = groundWind(at.lon, at.lat, Date.now())
  return g && g.kmh >= 0.5 ? (g.dirFrom + 180) % 360 : null
}

/** His way round to your scent, routed over the going grid (swing.ts). */
export interface Swing {
  key: string
  /** the sound it starts from */
  lastId: string
  /** he is in your scent already */
  onIt: boolean
  /** his spot to where he winds you, smoothed; null when no way was found */
  coords: [number, number][] | null
  turn: 1 | -1
  /** from you to where he winds you */
  endBearing: number
  distM: number
}

/** The last routed swing: the cards read it when it lands. */
export const useSwing = create<{ swing: Swing | null }>(() => ({ swing: null }))

export interface MoveRead {
  last: LogEntry
  you: LL
  /** from you to him */
  distM: number
  bearing: number
  minutesAgo: number
  /** the way he has been moving, from the last two sounds within half an hour */
  heading: number | null
  /** the way he has been working round you, when his heading says: 1 clockwise, −1 anticlockwise */
  circling: 1 | -1 | null
  /** the side your scent goes */
  downwind: number | null
  /** he is already on it, within 30° */
  onIt: boolean
  /** the way round to it: 1 clockwise, −1 anticlockwise */
  turn: 1 | -1
  /** his routed way round, once worked out for this sound */
  swing: Swing | null
}

/** Where he was last, which way he is going, and where he is likely to swing to; null with nothing recent. */
export function readMoves(): MoveRead | null {
  const es = heardThisHunt()
  const last = es[es.length - 1]
  if (!last || Date.now() - last.ts > RECENT_MS) return null
  const fix = useGpsStore.getState().fix
  const you: LL | null = fix ? { lon: fix.lon, lat: fix.lat } : (last.from ?? null)
  if (!you) return null
  const bearing = bearingTo(you, last)
  const prev = es.length > 1 ? es[es.length - 2] : null
  const heading = prev && last.ts - prev.ts <= RECENT_MS && metresTo(prev, last) >= 30 ? bearingTo(prev, last) : null
  const downwind = scentGoes(you)
  const d = downwind == null ? 0 : turnTo(bearing, downwind)
  // already working round you one way: he keeps on round that way
  let circling: 1 | -1 | null = null
  if (heading != null) {
    const t = turnTo(bearing + 90, heading)
    if (Math.abs(t) < 60) circling = 1
    else if (Math.abs(t) > 120) circling = -1
  }
  const sw = useSwing.getState().swing
  return {
    last,
    you,
    distM: metresTo(you, last),
    bearing,
    minutesAgo: Math.max(0, Math.round((Date.now() - last.ts) / 60_000)),
    heading,
    circling,
    downwind,
    onIt: downwind != null && Math.abs(d) <= 30,
    turn: circling ?? (d >= 0 ? 1 : -1),
    swing: sw && sw.lastId === last.id ? sw : null,
  }
}

/** One line for the card: the last sound, where, how long ago, which way he is going. */
export function movesText(r: MoveRead): string {
  const what = r.last.sound ? SOUND_NAMES[r.last.sound] : r.last.what === 'seen' ? 'Seen' : 'Heard'
  const ago = r.minutesAgo < 1 ? 'just now' : `${r.minutesAgo} min ago`
  const parts = [`${what} ${Math.round(r.distM / 10) * 10} m ${compass(r.bearing)}, ${ago}`]
  if (r.heading != null) parts.push(`moving ${compass(r.heading)}`)
  const sw = r.swing?.coords || r.swing?.onIt ? r.swing : null
  if (sw?.onIt || (!sw && r.downwind != null && r.onIt)) parts.push('he is on your downwind side: he may have your scent')
  else if (sw) parts.push(`likely to swing round to your ${compass(sw.endBearing)} to wind you`)
  else if (r.downwind != null) parts.push(`likely to swing round to your ${compass(r.downwind)} to wind you`)
  return parts.join(' · ')
}

// ---- his way round, routed ----

/** how far round the two of you the search looks, m */
const PAD_M = 400
const PAD_MAX_M = 600
/** without a cone: the ground wind's downwind side, this wide either way and this far out */
const SECTOR_HALF = 30
const SECTOR_M = 450

let grid: Going | null = null
/** the going grid is not baked or cached: the arc stands in */
let noGrid = false
let loading = false
/** the ask in flight, so the same one is not sent twice */
let asked = ''
/** bumped with every new drawing of the scent */
let scentGen = 0
let redrawSoon: () => void = () => {}

function swingKey(r: MoveRead): string {
  // your position to 20 m: GPS wander is not a reason to route him again
  const k = kx(r.you.lat)
  return `${r.last.id}|${Math.round((r.you.lon * k) / 20)},${Math.round((r.you.lat * KY) / 20)}|${scentGen}|${Math.round((r.downwind ?? 0) / 15)}`
}

/** Chaikin's corner cutting, twice: a moose's line, not a staircase of 10 m cells. The ends stay put. */
function smooth(pts: [number, number][]): [number, number][] {
  let p = pts
  for (let it = 0; it < 2 && p.length > 2; it++) {
    const out: [number, number][] = [p[0]]
    for (let i = 0; i < p.length - 1; i++) {
      const [ax, ay] = p[i]
      const [bx, by] = p[i + 1]
      if (i > 0) out.push([0.75 * ax + 0.25 * bx, 0.75 * ay + 0.25 * by])
      if (i < p.length - 2) out.push([0.25 * ax + 0.75 * bx, 0.25 * ay + 0.75 * by])
    }
    out.push(p[p.length - 1])
    p = out
  }
  return p
}

/** His spot and yours on the going grid, or null off it. */
function cellsFor(g: Going, r: MoveRead): [number, number] | null {
  const from = cellAt(g, r.last.lon, r.last.lat)
  const you = cellAt(g, r.you.lon, r.you.lat)
  return from < 0 || you < 0 ? null : [from, you]
}

/** The search's window round his spot and yours, and your scent over it. */
function swingRequest(g: Going, r: MoveRead, from: number, you: number): SwingRequest {
  const { cols: gc, rows: gr, dx, dy } = g.data
  const pad = Math.min(PAD_MAX_M, Math.max(PAD_M, 0.6 * r.distM))
  const fr = Math.floor(from / gc)
  const yr = Math.floor(you / gc)
  const r0 = Math.max(0, Math.min(fr, yr) - Math.ceil(pad / dy))
  const r1 = Math.min(gr - 1, Math.max(fr, yr) + Math.ceil(pad / dy))
  const c0 = Math.max(0, Math.min(from % gc, you % gc) - Math.ceil(pad / dx))
  const c1 = Math.min(gc - 1, Math.max(from % gc, you % gc) + Math.ceil(pad / dx))
  const rows = r1 - r0 + 1
  const cols = c1 - c0 + 1
  const scent = new Float32Array(rows * cols)
  // the cone as drawn when it is yours; its noticeable edge is where he has you
  let found = 0
  if (useScent.getState().people.some((p) => p.live)) {
    for (let lr = 0; lr < rows; lr++)
      for (let lc = 0; lc < cols; lc++) {
        const [lon, lat] = cellCentre(g, (r0 + lr) * gc + c0 + lc)
        const v = scentAt(lon, lat)
        if (v == null) continue
        scent[lr * cols + lc] = v
        if (v >= SCENT_NOTICE && metresTo(r.you, { lon, lat }) >= SWING.minM) found++
      }
  }
  // no cone (hidden, or too thin to notice past 40 m): downwind on the ground wind
  if (!found && r.downwind != null) {
    scent.fill(0)
    for (let lr = 0; lr < rows; lr++)
      for (let lc = 0; lc < cols; lc++) {
        const [lon, lat] = cellCentre(g, (r0 + lr) * gc + c0 + lc)
        const p = { lon, lat }
        const d = metresTo(r.you, p)
        if (d >= SWING.minM && d <= SECTOR_M && Math.abs(turnTo(r.downwind, bearingTo(r.you, p))) <= SECTOR_HALF) scent[lr * cols + lc] = 1
      }
  }
  // each way round, walled off from the other along the line through you that halves them
  const half = (((r.downwind ?? r.bearing) - r.bearing + 360) % 360) / 2
  return {
    from,
    you,
    r0,
    c0,
    rows,
    cols,
    scent,
    ways: [
      { turn: 1, wall: (r.bearing + half + 180) % 360 },
      { turn: -1, wall: (r.bearing + half) % 360 },
    ],
  }
}

/** Route his way round when what it rests on has changed; the map redraws when it lands. */
function planSwing(r: MoveRead) {
  if (r.downwind == null || r.distM < SWING.minM || noGrid) return
  const key = swingKey(r)
  if (useSwing.getState().swing?.key === key || asked === key) return
  if (!grid) {
    if (loading) return
    loading = true
    void loadGoing().then((g) => {
      loading = false
      grid = g
      noGrid = !g
      redrawSoon()
    })
    return
  }
  const g = grid
  const cells = cellsFor(g, r)
  // off the grid: the arc
  if (!cells) return
  const req = swingRequest(g, r, cells[0], cells[1])
  asked = key
  const { you, last, circling } = r
  void askWorker(g, (id) => ({ type: 'swing', id, req }), [req.scent.buffer]).then((m) => {
    if (asked === key) asked = ''
    if (m.type !== 'swing') return devlog('moose', `swing · ${m.type === 'error' ? m.message : m.type}`)
    const { onIt, paths } = m.answer
    const pick = (circling != null && paths.find((p) => p.turn === circling)) || [...paths].sort((a, b) => a.cost - b.cost)[0]
    devlog('moose', `swing in ${m.ms.toFixed(0)} ms · ${onIt ? 'on your scent' : pick ? `${Math.round(pick.distM)} m ${pick.turn > 0 ? 'clockwise' : 'anticlockwise'}` : 'no way round'}`)
    let coords: [number, number][] | null = null
    let endBearing = 0
    if (pick) {
      const pts = Array.from(pick.cells, (i) => cellCentre(g, i))
      pts[0] = [last.lon, last.lat]
      coords = smooth(pts)
      const end = coords[coords.length - 1]
      endBearing = bearingTo(you, { lon: end[0], lat: end[1] })
    }
    useSwing.setState({ swing: { key, lastId: last.id, onIt, coords, turn: pick?.turn ?? 1, endBearing, distM: pick?.distM ?? 0 } })
    redrawSoon()
  })
}

const hhmm = (ms: number) => {
  const d = new Date(ms)
  return `${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')}`
}
const SHORT: Record<string, string> = { cow: 'cow', bull: 'grunt', thrash: 'thrash', walk: 'walking', splash: 'splash', seen: 'seen' }

function features(): FeatureCollection {
  const es = heardThisHunt()
  const out: Feature[] = []
  const line = (kind: string, coordinates: [number, number][]) => out.push({ type: 'Feature', geometry: { type: 'LineString', coordinates }, properties: { kind } })
  const arrow = (kind: string, at: [number, number], rot: number) => out.push({ type: 'Feature', geometry: { type: 'Point', coordinates: at }, properties: { kind, rot } })
  const label = (at: [number, number]) => out.push({ type: 'Feature', geometry: { type: 'Point', coordinates: at }, properties: { kind: 'swing-label', t: 'where he winds you' } })
  for (const e of es) {
    if (e.from) line('ray', [[e.from.lon, e.from.lat], [e.lon, e.lat]])
    out.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [e.lon, e.lat] }, properties: { kind: 'label', t: `${hhmm(e.ts)} ${e.sound ? SHORT[e.sound] : e.what}` } })
  }
  if (es.length >= 2) {
    line('route', es.map((e) => [e.lon, e.lat]))
    for (let i = 1; i < es.length; i++) arrow('route', [es[i].lon, es[i].lat], bearingTo(es[i - 1], es[i]))
  }
  const r = readMoves()
  if (r) {
    if (r.heading != null) {
      const to = offsetBy(r.last, r.heading, 120)
      line('heading', [[r.last.lon, r.last.lat], to])
      arrow('heading', to, r.heading)
    }
    planSwing(r)
    const sw = r.swing
    if (sw?.coords && !sw.onIt && sw.coords.length > 1) {
      // his way round, routed
      const c = sw.coords
      line('swing', c)
      const end = c[c.length - 1]
      const back = c[Math.max(0, c.length - 4)]
      arrow('swing', end, bearingTo({ lon: back[0], lat: back[1] }, { lon: end[0], lat: end[1] }))
      label(end)
    } else if (!sw && (noGrid || (grid && !cellsFor(grid, r))) && r.downwind != null && !r.onIt) {
      // off the grid: round you at his distance, from where he is to the side your scent goes
      const rad = Math.min(300, Math.max(60, r.distM))
      let sweep = turnTo(r.bearing, r.downwind)
      if (r.turn > 0 && sweep < 0) sweep += 360
      if (r.turn < 0 && sweep > 0) sweep -= 360
      const pts: [number, number][] = []
      const n = Math.max(2, Math.ceil(Math.abs(sweep) / 4))
      for (let i = 0; i <= n; i++) pts.push(offsetBy(r.you, r.bearing + (sweep * i) / n, rad))
      // from his spot onto the circle, then round
      line('swing', [[r.last.lon, r.last.lat], ...pts])
      const end = pts[pts.length - 1]
      arrow('swing', end, (r.downwind + 90 * r.turn + 360) % 360)
      label(end)
    }
  }
  return { type: 'FeatureCollection', features: out }
}

const kindIs = (...k: string[]) => ['in', ['get', 'kind'], ['literal', k]] as ['in', ['get', string], ['literal', string[]]]

function ensure(map: MlMap) {
  const data = features()
  const src = map.getSource(SRC) as GeoJSONSource | undefined
  if (src) return src.setData(data)
  map.addSource(SRC, { type: 'geojson', data })
  map.addLayer({ id: 'moose-ray', type: 'line', source: SRC, filter: kindIs('ray'), paint: { 'line-color': 'rgba(255,255,255,0.55)', 'line-width': 1.2, 'line-dasharray': [1, 2] } })
  map.addLayer({ id: 'moose-route-casing', type: 'line', source: SRC, filter: kindIs('route', 'heading', 'swing'), layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': 'rgba(20,10,4,0.6)', 'line-width': 5 } })
  map.addLayer({ id: 'moose-route', type: 'line', source: SRC, filter: kindIs('route'), layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#ffb347', 'line-width': 2.5 } })
  map.addLayer({ id: 'moose-heading', type: 'line', source: SRC, filter: kindIs('heading'), layout: { 'line-cap': 'round' }, paint: { 'line-color': '#ffb347', 'line-width': 2, 'line-dasharray': [2, 1.5] } })
  map.addLayer({ id: 'moose-swing', type: 'line', source: SRC, filter: kindIs('swing'), layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#ff6b6b', 'line-width': 2.5, 'line-dasharray': [2, 1.5] } })
  map.addLayer({
    id: 'moose-arrow',
    type: 'symbol',
    source: SRC,
    filter: ['all', ['==', ['geometry-type'], 'Point'], kindIs('route', 'heading', 'swing')],
    layout: {
      // '>' points east: turned by the bearing less 90°
      'text-field': '>',
      'text-font': ['Noto Sans Medium'],
      'text-size': 20,
      'text-rotate': ['-', ['get', 'rot'], 90],
      'text-rotation-alignment': 'map',
      'text-keep-upright': false,
      'text-allow-overlap': true,
      'text-ignore-placement': true,
    },
    paint: { 'text-color': ['match', ['get', 'kind'], 'swing', '#ff6b6b', '#ffb347'], 'text-halo-color': 'rgba(20,10,4,0.8)', 'text-halo-width': 1.5 },
  })
  map.addLayer({
    id: 'moose-label',
    type: 'symbol',
    source: SRC,
    filter: kindIs('label', 'swing-label'),
    layout: { 'text-field': ['get', 't'], 'text-font': ['Noto Sans Medium'], 'text-size': 11.5, 'text-offset': [0, 1.2], 'text-anchor': 'top', 'text-allow-overlap': true },
    paint: { 'text-color': ['match', ['get', 'kind'], 'swing-label', '#ff9d9d', '#ffe0b0'], 'text-halo-color': 'rgba(20,10,4,0.9)', 'text-halo-width': 1.5 },
  })
}

let wired = false
export function initMoveLayer() {
  if (wired) return
  wired = true
  let current: MlMap | null = null
  const redraw = () => {
    if (!current) return
    try {
      ensure(current)
    } catch {
      /* the style is still loading: styledata adds it */
    }
  }
  redrawSoon = redraw
  onEachMap((map) => {
    current = map
    if (map.isStyleLoaded()) redraw()
    map.on('styledata', () => {
      if (!map.getSource(SRC)) redraw()
    })
  })
  useHuntLog.subscribe((s, p) => {
    if (s.entries !== p.entries) redraw()
  })
  useHunting.subscribe((s, p) => {
    if (s.on !== p.on || s.startedAt !== p.startedAt) redraw()
  })
  useScent.subscribe((s, p) => {
    if (s.plumes === p.plumes) return
    // his way round ends in the scent as drawn: a new drawing routes him again
    scentGen++
    redraw()
  })
  useGpsStore.subscribe((s, p) => {
    if (s.fix !== p.fix && readMoves()) redraw()
  })
  // "min ago" and the half hour a sound stays fresh, and at once on a look
  window.setInterval(redraw, 60_000)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') redraw()
  })
}
