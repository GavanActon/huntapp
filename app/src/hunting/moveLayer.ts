import type { Feature, FeatureCollection } from 'geojson'
import type { GeoJSONSource, Map as MlMap } from 'maplibre-gl'
import { onEachMap } from '../map/mapController'
import { SOUND_NAMES, useHuntLog, type LogEntry } from '../log/huntLog'
import { useGpsStore } from '../tracking/gpsStore'
import { compass } from '../weather/openMeteo'
import { groundWind } from '../weather/micro/model'
import { useScent } from '../weather/micro/scent'
import { useHunting } from './hunting'

/**
 * The moose you hear while hunting, on the map: each sound where it came
 * from (the dot is the hunt log's own), joined in the order they came with
 * arrows, a faint line back to where you stood when you heard it, and
 * where he is likely to go next.
 *
 * A bull coming to a call very often swings round to get downwind of the
 * caller and scent-check before he shows himself. It is what happened on
 * 2026-09-27: he pulled the hunter off the calling spot, then ran to get
 * downwind. So from his last spot the map draws the way round you, at his
 * distance, to the side your scent goes (the live cone's main sector, or
 * the ground wind without it), the way he has been moving round if that
 * says, the shorter way if not. With two sounds in the last half hour, it
 * also draws the way he is heading. A rule of thumb from the field, not a
 * model: he may just come straight in, or leave.
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

export interface MoveRead {
  last: LogEntry
  you: LL
  /** from you to him */
  distM: number
  bearing: number
  minutesAgo: number
  /** the way he has been moving, from the last two sounds within half an hour */
  heading: number | null
  /** the side your scent goes */
  downwind: number | null
  /** he is already on it, within 30° */
  onIt: boolean
  /** the way round to it: 1 clockwise, −1 anticlockwise */
  turn: 1 | -1
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
  let turn: 1 | -1 = d >= 0 ? 1 : -1
  // already working round you one way: he keeps on round that way
  if (heading != null) {
    const t = turnTo(bearing + 90, heading)
    if (Math.abs(t) < 60) turn = 1
    else if (Math.abs(t) > 120) turn = -1
  }
  return {
    last,
    you,
    distM: metresTo(you, last),
    bearing,
    minutesAgo: Math.max(0, Math.round((Date.now() - last.ts) / 60_000)),
    heading,
    downwind,
    onIt: downwind != null && Math.abs(d) <= 30,
    turn,
  }
}

/** One line for the card: the last sound, where, how long ago, which way he is going. */
export function movesText(r: MoveRead): string {
  const what = r.last.sound ? SOUND_NAMES[r.last.sound] : r.last.what === 'seen' ? 'Seen' : 'Heard'
  const ago = r.minutesAgo < 1 ? 'just now' : `${r.minutesAgo} min ago`
  const parts = [`${what} ${Math.round(r.distM / 10) * 10} m ${compass(r.bearing)}, ${ago}`]
  if (r.heading != null) parts.push(`moving ${compass(r.heading)}`)
  if (r.downwind != null)
    parts.push(r.onIt ? 'he is on your downwind side: he may have your scent' : `likely to swing round to your ${compass(r.downwind)} to wind you`)
  return parts.join(' · ')
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
    if (r.downwind != null && !r.onIt) {
      // round you at his distance, from where he is to the side your scent goes
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
      out.push({ type: 'Feature', geometry: { type: 'Point', coordinates: end }, properties: { kind: 'swing-label', t: 'where he winds you' } })
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
    if (s.plumes !== p.plumes) redraw()
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
