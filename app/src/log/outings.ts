import { AREA_LIST, otherAreaAt, type AreaDef } from '../areas'
import { useGpsStore } from '../tracking/gpsStore'
import { defaultTrackName, isDefaultName, removeRange, sliceDistanceM, useTrackStore } from '../tracking/trackStore'
import { metresBetween, useWindChecks, type WindCheck } from '../weather/micro/windChecks'
import { sunTimes } from '../weather/sun'
import { dayDate, hourMinShort, isToday } from '../time'
import { SPECIES_NAMES, useHuntLog, type LogEntry } from './huntLog'
import { OUTING_GAP_MS } from './outingTime'

/**
 * The Hunt log fills itself: an outing is whatever happened in one stretch
 * of time — the track points recorded while location was on, the sounds
 * heard and the wind checks made — with no silence over OUTING_GAP_MS in
 * it. Nothing is started or stopped by hand. A stretch at camp with no
 * movement and nothing logged is not an outing, and a sit where the phone
 * stayed dark for hours is one outing when it picks up where it left off.
 */

export interface Outing {
  id: string
  startMs: number
  endMs: number
  /** the newest one, still being added to: location is on and its last stamp is recent */
  ongoing: boolean
  slot: 'morning' | 'evening' | 'day'
  durationMin: number
  distanceM: number
  /** sounds heard (and calls that came in) */
  heard: number
  /** 'cow seen', 'moose seen', 'deer sign' … or null */
  seen: string | null
  /** nothing positive logged: no sound, sighting or sign */
  blank: boolean
  /** the first track's name, when the hunter gave it one */
  name: string | null
  trackIds: string[]
  /** only track points: nothing heard, seen or checked */
  trackOnly: boolean
}

/** how near camp a stretch with nothing in it is dropped, m */
const AT_CAMP_M = 150
/** a silence over the gap does not split a sit when the fixes either side are this close, m … */
const SIT_MOVE_M = 100
/** … and the silence is under this (a night between two sits at one stand is two outings) */
const SIT_GAP_MAX_MS = 6 * 3600_000
/** an outing shorter than this reads as its start time, not a duration */
const SHORT_MIN = 5

interface Stamp {
  ts: number
  lon: number
  lat: number
  kind: 'point' | 'entry' | 'check'
  trackId?: string
}

/** Every area's camp, from the area files. Not the home of the area the app
 *  is in: that is a stand at Lac Bailey, and the log's outings (and their
 *  ids, which a switch opens one by) must come out the same in any area.
 *  An area whose home is a stand has no camp and so no at-camp rule. */
const CAMPS = AREA_LIST.filter((a) => !a.virtual).flatMap((a) => a.presets.filter((p) => p.kind === 'camp'))

function atCamp(s: { lon: number; lat: number }): boolean {
  return CAMPS.some((c) => metresBetween(s.lon, s.lat, c.lon, c.lat) <= AT_CAMP_M)
}

function slotOf(startMs: number, lat: number, lon: number): Outing['slot'] {
  const { sunriseMs, sunsetMs } = sunTimes(startMs, lat, lon)
  if (sunriseMs != null && startMs < sunriseMs + 3 * 3600_000) return 'morning'
  if (sunsetMs != null && startMs > sunsetMs - 3 * 3600_000) return 'evening'
  return 'day'
}

function isHeard(e: LogEntry): boolean {
  return e.what === 'heard' || e.what === 'called'
}

/** 'cow seen', 'moose ×2 seen', 'deer sign': the first sighting or sign, briefly. */
function seenWords(entries: LogEntry[]): string | null {
  const e = entries.find((x) => x.what === 'seen') ?? entries.find((x) => x.what === 'sign')
  if (!e) return null
  const who = e.kind ?? SPECIES_NAMES[e.species].toLowerCase()
  const n = e.count && e.count > 1 ? ` ×${e.count}` : ''
  return `${who}${n} ${e.what}`
}

function build(cluster: Stamp[], newest: boolean, now: number): Outing {
  const startMs = cluster[0].ts
  const endMs = cluster[cluster.length - 1].ts
  const tracks = useTrackStore.getState().tracks
  const trackIds: string[] = []
  for (const s of cluster) if (s.trackId && !trackIds.includes(s.trackId)) trackIds.push(s.trackId)
  let distanceM = 0
  for (const id of trackIds) {
    const t = tracks.find((x) => x.id === id)
    if (t) distanceM += sliceDistanceM(t.points, startMs, endMs)
  }
  const entries = useHuntLog.getState().entries.filter((e) => e.ts >= startMs && e.ts <= endMs)
  const checks = cluster.some((s) => s.kind === 'check')
  const heard = entries.filter(isHeard).length
  const seen = seenWords(entries)
  const first = trackIds.length ? tracks.find((t) => t.id === trackIds[0]) : undefined
  const ongoing = newest && now - endMs <= OUTING_GAP_MS && useGpsStore.getState().locating
  return {
    id: `o${startMs.toString(36)}`,
    startMs,
    endMs,
    ongoing,
    slot: slotOf(startMs, cluster[0].lat, cluster[0].lon),
    durationMin: Math.round((endMs - startMs) / 60_000),
    distanceM,
    heard,
    seen,
    blank: heard === 0 && seen == null,
    name: first && !isDefaultName(first) ? first.name : null,
    trackIds,
    trackOnly: entries.length === 0 && !checks,
  }
}

function compute(now: number): Outing[] {
  const stamps: Stamp[] = []
  for (const t of useTrackStore.getState().tracks) for (const p of t.points) stamps.push({ ts: p.ts, lon: p.lon, lat: p.lat, kind: 'point', trackId: t.id })
  for (const e of useHuntLog.getState().entries) stamps.push({ ts: e.ts, lon: e.from?.lon ?? e.lon, lat: e.from?.lat ?? e.lat, kind: 'entry' })
  for (const c of useWindChecks.getState().checks) if (c.source === 'hand') stamps.push({ ts: c.ts, lon: c.lon, lat: c.lat, kind: 'check' })
  stamps.sort((a, b) => a.ts - b.ts)

  const clusters: Stamp[][] = []
  let cur: Stamp[] = []
  for (const s of stamps) {
    const prev = cur[cur.length - 1]
    if (prev && s.ts - prev.ts > OUTING_GAP_MS) {
      // a long sit with the phone dark: the same stand either side of the silence
      const sit = s.ts - prev.ts <= SIT_GAP_MAX_MS && metresBetween(prev.lon, prev.lat, s.lon, s.lat) <= SIT_MOVE_M && !atCamp(prev) && !atCamp(s)
      if (!sit) {
        clusters.push(cur)
        cur = []
      }
    }
    cur.push(s)
  }
  if (cur.length) clusters.push(cur)

  // a stretch at camp with nothing in it is not an outing
  const kept = clusters.filter((c) => !(c.every((s) => s.kind === 'point') && c.every(atCamp)))
  const out = kept.map((c, i) => build(c, i === kept.length - 1, now))
  out.reverse()
  return out
}

// one pass per change of the three stores (and per minute, for `ongoing`)
let memo: { tr: unknown; es: unknown; cs: unknown; key: string; out: Outing[] } | null = null

/** Every outing, newest first. */
export function outings(): Outing[] {
  const now = Date.now()
  const tr = useTrackStore.getState().tracks
  const es = useHuntLog.getState().entries
  const cs = useWindChecks.getState().checks
  const key = `${useGpsStore.getState().locating}:${Math.floor(now / 60_000)}`
  if (memo && memo.key === key && memo.tr === tr && memo.es === es && memo.cs === cs) return memo.out
  memo = { tr, es, cs, key, out: compute(now) }
  return memo.out
}

export function outingById(id: string): Outing | null {
  return outings().find((o) => o.id === id) ?? null
}

/** The log entries in the outing, oldest first. */
export function outingEntries(o: Outing): LogEntry[] {
  return useHuntLog
    .getState()
    .entries.filter((e) => e.ts >= o.startMs && e.ts <= o.endMs)
    .sort((a, b) => a.ts - b.ts)
}

/** The wind checks made by hand in the outing, oldest first. */
export function outingChecks(o: Outing): WindCheck[] {
  return useWindChecks
    .getState()
    .checks.filter((c) => c.source === 'hand' && c.ts >= o.startMs && c.ts <= o.endMs)
    .sort((a, b) => a.ts - b.ts)
}

/** The box round everything in the outing, its track, its sounds (and where
 *  they were heard from) and its checks: [west, south, east, north], or
 *  null when nothing in it has a place. */
export function outingBounds(o: Outing): [number, number, number, number] | null {
  let w = Infinity
  let s = Infinity
  let e = -Infinity
  let n = -Infinity
  const take = (lon: number, lat: number) => {
    w = Math.min(w, lon)
    e = Math.max(e, lon)
    s = Math.min(s, lat)
    n = Math.max(n, lat)
  }
  for (const id of o.trackIds) {
    const t = useTrackStore.getState().tracks.find((x) => x.id === id)
    if (!t) continue
    for (const p of t.points) if (p.ts >= o.startMs && p.ts <= o.endMs) take(p.lon, p.lat)
  }
  for (const x of outingEntries(o)) {
    take(x.lon, x.lat)
    if (x.from) take(x.from.lon, x.from.lat)
  }
  for (const c of outingChecks(o)) take(c.lon, c.lat)
  return Number.isFinite(w) ? [w, s, e, n] : null
}

/** The area an outing lies in when it is not the one the app is in: going
 *  to it means switching (areas/switch.ts). */
export function outingElsewhere(o: Outing): { area: AreaDef; center: [number, number] } | null {
  const b = outingBounds(o)
  if (!b) return null
  const center: [number, number] = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]
  const area = otherAreaAt(center[0], center[1])
  return area ? { area, center } : null
}

/** The outing goes: its stretch of every track, its entries and its checks. */
export function deleteOuting(o: Outing): void {
  removeRange(o.startMs, o.endMs)
  const log = useHuntLog.getState()
  for (const e of outingEntries(o)) log.remove(e.id)
  const wc = useWindChecks.getState()
  for (const c of outingChecks(o)) wc.remove(c.id)
}

/** The name goes on the outing's first track (an empty one puts the track's own name back); an outing with no track keeps none. */
export function renameOuting(o: Outing, name: string): void {
  if (!o.trackIds.length) return
  const tr = useTrackStore.getState()
  const first = tr.tracks.find((t) => t.id === o.trackIds[0])
  if (!first) return
  const clean = name.trim()
  tr.rename(first.id, clean || defaultTrackName(first.startedAt))
}

function durationText(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`
}

/** 'Sun 27 · evening · 2 h 50' | 'Today · since 4:40p' | 'Fri 25 · 2:10p, from the truck'. */
export function outingTitle(o: Outing): string {
  const day = isToday(o.startMs) ? 'Today' : dayDate(o.startMs)
  if (o.ongoing) return `${day} · since ${hourMinShort(o.startMs)}${o.name ? `, ${o.name}` : ''}`
  if (o.name) return `${day} · ${hourMinShort(o.startMs)}, ${o.name}`
  const len = o.durationMin < SHORT_MIN ? hourMinShort(o.startMs) : durationText(o.durationMin)
  return `${day} · ${o.slot} · ${len}`
}

/** '4 heard' | 'cow seen' | '2 wind checks' | 'blank'. */
export function outingSummary(o: Outing): string {
  const parts: string[] = []
  if (o.heard) parts.push(`${o.heard} heard`)
  if (o.seen) parts.push(o.seen)
  if (parts.length) return parts.join(' · ')
  const checks = outingChecks(o).length
  if (checks) return `${checks} wind check${checks === 1 ? '' : 's'}`
  return 'blank'
}
