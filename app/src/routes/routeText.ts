/** The words for a route: its time, what sets it apart from the others,
 *  and where its time goes. Shared by the map's labels and the card. */
import { formatDistance, type Units } from '../measure/measureMath'
import type { DrawnRoute, RouteEnd, RouteMode } from './routeStore'

const PTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
const SIDE = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west']
const compass = (deg: number) => Math.round((((deg % 360) + 360) % 360) / 45) % 8

export function routeTime(s: number): string {
  const min = Math.max(1, Math.round(s / 60))
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h} h ${m} min` : `${h} h`
}

export function height(m: number, units: Units): string {
  return units === 'imperial' ? `${Math.round(m * 3.28084)} ft` : `${Math.round(m)} m`
}

/** "2.2 km · ↑21 m" */
export function routeLine(r: DrawnRoute, units: Units): string {
  return `${formatDistance(r.distM, units)} · ↑${height(r.climbM, units)}`
}

/** Where a route ends, in words: the place's name, or how far and which way from the start ("1.8 km NW"). */
export function endName(from: RouteEnd | null, to: RouteEnd, units: Units): string {
  if (to.name) return to.name
  if (!from) return 'there'
  const kx = Math.cos((from.lat * Math.PI) / 180)
  const e = (to.lon - from.lon) * 111_320 * kx
  const n = (to.lat - from.lat) * 110_574
  return `${formatDistance(Math.hypot(e, n), units)} ${PTS[compass((Math.atan2(e, n) * 180) / Math.PI)]}`
}

/** Which side of route A this one keeps to, "east of A", when it is well off it. */
function sideOf(r: DrawnRoute, a: DrawnRoute): string | null {
  const s = a.coords[0]
  const g = a.coords[a.coords.length - 1]
  const kx = Math.cos((s[1] * Math.PI) / 180)
  const ux = (g[0] - s[0]) * kx
  const uy = g[1] - s[1]
  const L = Math.hypot(ux, uy)
  if (!L) return null
  // mean offset to the right of the line from start to end, metres
  const right = (c: [number, number][]) => (c.reduce((t, p) => t + (uy * (p[0] - s[0]) * kx - ux * (p[1] - s[1])) / L, 0) / c.length) * 110_574
  const d = right(r.coords) - right(a.coords)
  if (Math.abs(d) < 40) return null
  const travel = (Math.atan2(ux, uy) * 180) / Math.PI
  return `${SIDE[compass(travel + (d > 0 ? 90 : -90))]} of A`
}

/** What sets route k apart: "quickest" for the first, else how much longer and why you might take it anyway. */
export function routeTag(routes: DrawnRoute[], k: number, mode: RouteMode): string {
  const r = routes[k]
  const a = routes[0]
  if (k === 0 || !a) return mode === 'hunt' ? 'best hunt' : 'quickest'
  const dt = Math.round((r.timeS - a.timeS) / 60)
  const time = dt > 0 ? `+${dt} min` : dt < 0 ? `${dt} min` : 'same time'
  const least = (f: (x: DrawnRoute) => number) => routes.every((o) => f(r) <= f(o))
  const most = (f: (x: DrawnRoute) => number) => routes.every((o) => f(r) >= f(o))
  let why = 'another way'
  if (mode === 'hunt' && r.nearM != null && a.nearM != null && most((x) => x.nearM ?? 0) && r.nearM - a.nearM >= 150) why = 'more good ground'
  else if (mode === 'hunt' && r.scentM != null && a.scentM != null && least((x) => x.scentM ?? 0) && a.scentM - r.scentM >= 100) why = 'less scent on the game'
  else if (least((x) => x.climbM) && a.climbM - r.climbM >= 8) why = 'least climbing'
  else if (least((x) => x.wetM) && a.wetM - r.wetM >= 150) why = 'driest'
  else if (least((x) => x.thickM) && a.thickM - r.thickM >= 100) why = 'least thick bush'
  else if (most((x) => x.roadM) && r.roadM - a.roadM >= 200) why = 'more road'
  else if (r.crossings < a.crossings) why = r.crossings ? 'fewer creeks' : 'no creek'
  else if (least((x) => x.distM) && a.distM - r.distM >= 50) why = 'shortest'
  else why = sideOf(r, a) ?? why
  return `${time} · ${why}`
}

/** What the picked route is like underfoot, the things worth knowing first. */
export function routeFacts(r: DrawnRoute, units: Units): string[] {
  const out: string[] = []
  if (r.roadM >= 50) out.push(`${formatDistance(r.roadM, units)} of road`)
  if (r.wetM >= 50) out.push(`${formatDistance(r.wetM, units)} wet`)
  if (r.thickM >= 50) out.push(`${formatDistance(r.thickM, units)} thick bush`)
  if (r.crossings) out.push(r.crossings === 1 ? '1 creek' : `${r.crossings} creeks`)
  if (!out.length) out.push('dry, open going')
  return out
}

export function approachText(a: DrawnRoute['approach']): { text: string; warn: boolean } | null {
  if (a === 'into') return { text: 'Wind in your face coming in', warn: false }
  if (a === 'cross') return { text: 'Crosswind coming in', warn: false }
  if (a === 'behind') return { text: 'Wind at your back coming in: your scent gets there first', warn: true }
  return null
}

/** Where the time goes, biggest first: [label, minutes], over walking the same line on the flat at your pace. */
export function timeParts(r: DrawnRoute, paceKmh: number): { flatMin: number; parts: [string, number][] } {
  const e = r.extra
  const parts: [string, number][] = [
    ['bush', e.bush / 60],
    ['wet ground', e.wet / 60],
    [e.slope >= 0 ? 'climbing' : 'downhill', e.slope / 60],
    ['creeks', e.crossing / 60],
    ['rough ground', e.rough / 60],
  ]
  return { flatMin: r.distM / 1000 / paceKmh * 60, parts: parts.filter(([, m]) => Math.abs(m) >= 0.5).sort((x, y) => Math.abs(y[1]) - Math.abs(x[1])) }
}

export function lidarText(share: number): string {
  if (share >= 0.95) return 'Bush measured by the 2021 LiDAR along all of it.'
  if (share <= 0.05) return "Bush here is the forest map's estimate, not LiDAR: rougher."
  return `Bush measured by LiDAR along ${Math.round(share * 100)}% of it; the rest is the forest map's estimate.`
}
