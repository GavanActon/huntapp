import { habitat } from './habitatGrid'
import { compass8 } from './conditions'
import { useHuntLog } from '../log/huntLog'
import type { SavedPlace } from '../state/placesStore'
import { groundWind, type Regime } from '../weather/micro/model'
import { angleDiff, metresBetween } from '../weather/micro/windChecks'
import { sunTimes } from '../weather/sun'

/**
 * A stand's good winds: the compass sectors the wind can blow FROM and the
 * stand still hunts, as the hunter declares them on the pin (Pins › edit).
 * Eight sectors, 0 = N … 7 = NW, kept on the place as `winds`.
 *
 * Three things are built on that:
 *   - a suggestion, from the habitat bake's feeding side at the pin: the
 *     winds that carry scent away from where the animal is expected;
 *   - the verdict for the next sit: the GROUND wind at the stand at dawn or
 *     dusk (model.ts, with any powder checks blended in) against the arc,
 *     so the Pins list says good / edge / wrong / calm at a glance;
 *   - the tally from the hunt log: the winds this stand has already been
 *     sat on, and whether anything came.
 *
 * The forecast says nothing about a stand; the hunter's arc and the ground
 * model together do.
 */

export const sectorOf = (deg: number): number => Math.round((((deg % 360) + 360) % 360) / 45) % 8
export const sectorDeg = (k: number): number => k * 45

/** "NW–N" for a run of neighbours, "W, N" otherwise; "any wind" for all eight. */
export function windsLabel(winds: number[]): string {
  const set = new Set(winds)
  if (set.size === 0) return ''
  if (set.size === 8) return 'any wind'
  // runs round the circle, starting after a gap so a run over N reads W–NE
  let start = 0
  while (start < 8 && set.has((start + 7) % 8)) start++
  const runs: number[][] = []
  for (let n = 0; n < 8; n++) {
    const k = (start + n) % 8
    if (!set.has(k)) continue
    const last = runs[runs.length - 1]
    if (last && last[last.length - 1] === (k + 7) % 8) last.push(k)
    else runs.push([k])
  }
  return runs.map((r) => (r.length === 1 ? compass8(sectorDeg(r[0])) : `${compass8(sectorDeg(r[0]))}–${compass8(sectorDeg(r[r.length - 1]))}`)).join(', ')
}

/** The winds the bake would pick at a point: those within 90° of blowing
 *  from the feeding side, so scent goes away from it. Null off the grid or
 *  where the bake has no feeding side. */
export function suggestWinds(lon: number, lat: number): number[] | null {
  const h = habitat()
  if (!h) return null
  const i = h.index(lon, lat)
  if (i < 0) return null
  const bear = (h.raw('bearBrowse') as Uint8Array)[i]
  if (bear === 255) return null
  const approach = bear * (360 / 250)
  const out: number[] = []
  for (let k = 0; k < 8; k++) if (angleDiff(sectorDeg(k), approach) <= 90) out.push(k)
  return out
}

export type Slot = 'dawn' | 'dusk'

export interface Sit {
  slot: Slot
  atMs: number
  tomorrow: boolean
}

/** The next sit at a point: this morning's while it lasts (sunrise −½ h to
 *  +3 h, read at first light or now), else this evening's (sunset −3 h to
 *  +½ h, read an hour before sunset or now), else tomorrow's dawn. */
export function nextSit(now: number, lat: number, lon: number): Sit | null {
  for (let d = 0; d < 2; d++) {
    const t = new Date(now)
    const noon = new Date(t.getFullYear(), t.getMonth(), t.getDate() + d, 12).getTime()
    const sun = sunTimes(noon, lat, lon)
    if (sun.sunriseMs == null || sun.sunsetMs == null) return null
    const H = 3600_000
    if (now < sun.sunriseMs + 3 * H) return { slot: 'dawn', atMs: Math.max(now, sun.sunriseMs + 0.5 * H), tomorrow: d === 1 }
    if (d === 0 && now < sun.sunsetMs + 0.5 * H) return { slot: 'dusk', atMs: Math.max(now, sun.sunsetMs - H), tomorrow: false }
  }
  return null
}

export type WindGrade = 'good' | 'edge' | 'wrong' | 'calm'

export interface WindVerdict {
  sit: Sit
  grade: WindGrade
  /** blowing FROM at ground */
  dirFrom: number
  kmh: number
  regime: Regime
  /** "NW at dawn: good wind" */
  text: string
}

const sitWord = (s: Sit) => `${s.tomorrow ? 'tomorrow ' : ''}${s.slot}`

/** How the ground wind at the next sit reads against the stand's arc; null
 *  without an arc, a sun, or the model. */
export function windVerdict(p: SavedPlace, now = Date.now()): WindVerdict | null {
  const winds = p.winds
  if (!winds?.length) return null
  const sit = nextSit(now, p.lat, p.lon)
  if (!sit) return null
  const g = groundWind(p.lon, p.lat, sit.atMs)
  if (!g) return null
  const when = sitWord(sit)
  const base = { sit, dirFrom: g.dirFrom, kmh: g.kmh, regime: g.regime }
  if (g.kmh < 0.8 || g.regime === 'calm' || g.regime === 'pooled') {
    const pooled = g.regime === 'pooled'
    return { ...base, grade: 'calm', text: `${pooled ? 'cold air settled' : 'calm'} at ${when}: scent ${pooled ? 'pools round you' : 'hangs'}` }
  }
  const from = compass8(g.dirFrom)
  const k = sectorOf(g.dirFrom)
  const has = (s: number) => winds.includes(((s % 8) + 8) % 8)
  const sd = Math.min(90, g.sigmaDeg)
  if (has(k)) {
    // inside the arc, but near its edge with a swinging wind
    const edge = (!has(k - 1) && angleDiff(g.dirFrom, sectorDeg(k - 1)) <= sd) || (!has(k + 1) && angleDiff(g.dirFrom, sectorDeg(k + 1)) <= sd)
    return edge ? { ...base, grade: 'edge', text: `${from} at ${when}: on the edge, swings ±${Math.round(g.sigmaDeg)}°` } : { ...base, grade: 'good', text: `${from} at ${when}: good wind` }
  }
  const near = (has(k - 1) && angleDiff(g.dirFrom, sectorDeg(k - 1)) <= sd) || (has(k + 1) && angleDiff(g.dirFrom, sectorDeg(k + 1)) <= sd)
  return near ? { ...base, grade: 'edge', text: `${from} at ${when}: just off your winds, swings ±${Math.round(g.sigmaDeg)}°` } : { ...base, grade: 'wrong', text: `${from} at ${when}: wrong wind` }
}

export interface HuntedWind {
  sector: number
  /** days with something logged here on this wind */
  sits: number
  /** of those, days when something was seen, heard, called in or found */
  came: number
}

/** how near a pin a log entry counts as a sit there, m */
const AT_STAND_M = 150

/** The winds this stand has been sat on, from the log's weather at the
 *  time, most sat first. */
export function huntedWinds(p: SavedPlace): HuntedWind[] {
  const days = new Map<number, Map<string, boolean>>()
  for (const e of useHuntLog.getState().entries) {
    if (!e.wx || metresBetween(e.lon, e.lat, p.lon, p.lat) > AT_STAND_M) continue
    const k = sectorOf(e.wx.windDir)
    const d = new Date(e.ts)
    const day = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}-${d.getHours() < 12 ? 'am' : 'pm'}`
    const m = days.get(k) ?? new Map<string, boolean>()
    m.set(day, (m.get(day) ?? false) || e.what !== 'nothing')
    days.set(k, m)
  }
  return [...days]
    .map(([sector, m]) => ({ sector, sits: m.size, came: [...m.values()].filter(Boolean).length }))
    .sort((a, b) => b.sits - a.sits)
}

/** "Sat on NW ×2 (something came once), S ×1 (nothing)". */
export function huntedLine(hw: HuntedWind[]): string {
  if (!hw.length) return ''
  const part = (h: HuntedWind) => {
    const came = h.came === 0 ? 'nothing' : h.came === h.sits ? (h.sits === 1 ? 'something came' : 'something came each time') : `something came ${h.came === 1 ? 'once' : `${h.came} of ${h.sits}`}`
    return `${compass8(sectorDeg(h.sector))} ×${h.sits} (${came})`
  }
  return `Sat on ${hw.map(part).join(', ')}`
}
