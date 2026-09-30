import { create } from 'zustand'
import { OUTING_GAP_MS } from '../log/outingTime'
import { useGpsStore, type Fix } from './gpsStore'

/**
 * The phone's trail, recorded from the fixes whenever location is on: the
 * locate button starts and stops it, nothing else. A fix comes filtered
 * (fixFilter.ts); a point is kept when the phone has moved more than
 * MIN_STEP_M and more than the fix's own wander since the last one (a stand
 * does not fill the log), and a silence longer than GAP_MS starts a new
 * segment. Location switched back on within OUTING_GAP_MS picks the last
 * track up again; longer than that starts a new one. Every track is kept in
 * localStorage so a day's walk survives a reload. The Hunt log cuts the
 * tracks into outings by time (log/outings.ts) and exports them as GPX.
 */

export interface TrackPoint {
  lon: number
  lat: number
  ts: number
  /** first point after a silence: a new segment in GPX */
  gap?: boolean
}

export interface Track {
  id: string
  name: string
  startedAt: number
  endedAt: number | null
  points: TrackPoint[]
  /** metres */
  distanceM: number
}

const KEY = 'huntapp-tracks'
const MIN_STEP_M = 6
/** the filtered fix's spread above which nothing is recorded, metres */
const MAX_SIGMA_M = 25
/** under this the phone is standing (0.25 m/s), knots */
const STILL_KN = 0.5
const GAP_MS = 120_000
const MAX_POINTS = 20_000

export function haversineM(aLon: number, aLat: number, bLon: number, bLat: number): number {
  const R = 6371008.8
  const toRad = Math.PI / 180
  const dLat = (bLat - aLat) * toRad
  const dLon = (bLon - aLon) * toRad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * toRad) * Math.cos(bLat * toRad) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** The walked distance along points between t0 and t1 inclusive: the steps with both ends inside, gap joins not counted. */
export function sliceDistanceM(points: TrackPoint[], t0: number, t1: number): number {
  let d = 0
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    if (b.gap || a.ts < t0 || b.ts > t1) continue
    d += haversineM(a.lon, a.lat, b.lon, b.lat)
  }
  return d
}

function distanceOf(points: TrackPoint[]): number {
  return points.length ? sliceDistanceM(points, points[0].ts, points[points.length - 1].ts) : 0
}

function load(): Track[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Track[]) : []
  } catch {
    return []
  }
}

/** Written a couple of seconds after the last change, whatever the store holds by then. */
let saveTimer: number | null = null
function save() {
  if (saveTimer != null) return
  saveTimer = window.setTimeout(() => {
    saveTimer = null
    try {
      localStorage.setItem(KEY, JSON.stringify(useTrackStore.getState().tracks))
    } catch {
      /* full: the track lives in memory until something is deleted */
    }
  }, 2000)
}

interface TrackState {
  tracks: Track[]
  /** the id of the track being recorded, or null */
  recordingId: string | null
  start: () => void
  /** Pick a track back up (location on again within the gap, or a reload mid-walk); false if there is none. */
  resume: (id: string) => boolean
  stop: () => void
  push: (fix: Fix) => void
  rename: (id: string, name: string) => void
  remove: (id: string) => void
}

function dayName(ms: number): string {
  const d = new Date(ms)
  return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]} ${d.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]} ${d.getHours() % 12 || 12}${d.getHours() < 12 ? 'a' : 'p'}`
}

/** The name a track gets when it starts: 'Sun 27 Sep 6a'. */
export function defaultTrackName(startedAt: number): string {
  return dayName(startedAt)
}

/** The track still carries the name it was given when it started (nobody renamed it). */
export function isDefaultName(t: Track): boolean {
  return t.name === dayName(t.startedAt)
}

function lastTs(t: Track): number {
  return t.points[t.points.length - 1]?.ts ?? t.startedAt
}

export const useTrackStore = create<TrackState>((set, get) => ({
  tracks: load(),
  recordingId: null,
  start: () => {
    if (get().recordingId) return
    const t: Track = { id: `t-${Date.now().toString(36)}`, name: dayName(Date.now()), startedAt: Date.now(), endedAt: null, points: [], distanceM: 0 }
    const tracks = [...get().tracks, t]
    set({ tracks, recordingId: t.id })
    save()
    const fix = useGpsStore.getState().fix
    if (fix) get().push(fix)
  },
  resume: (id) => {
    if (get().recordingId) return get().recordingId === id
    const t = get().tracks.find((x) => x.id === id)
    if (!t) return false
    // the silence while location was off makes the next fix a new segment
    if (t.endedAt == null) {
      set({ recordingId: id })
      return true
    }
    const tracks = get().tracks.map((x) => (x.id === id ? { ...x, endedAt: null } : x))
    set({ tracks, recordingId: id })
    save()
    return true
  },
  stop: () => {
    const id = get().recordingId
    if (!id) return
    // it ended when the walking did, not when the button was tapped
    const tracks = get().tracks.map((t) => (t.id === id ? { ...t, endedAt: lastTs(t) } : t))
    // an empty track is nothing to keep
    const kept = tracks.filter((t) => t.id !== id || t.points.length >= 2)
    set({ tracks: kept, recordingId: null })
    save()
  },
  push: (fix) => {
    const id = get().recordingId
    if (!id) return
    // a coarse fix draws a trail nobody walked: the filter's spread (the
    // first fix out of a pocket is often 30-60 m) must have settled first
    const sigma = fix.sigma ?? fix.accuracy
    if (sigma > MAX_SIGMA_M) return
    const tracks = get().tracks.map((t) => {
      if (t.id !== id) return t
      const last = t.points[t.points.length - 1]
      if (last) {
        const d = haversineM(last.lon, last.lat, fix.lon, fix.lat)
        const gap = fix.ts - last.ts > GAP_MS
        // a step must be more than the wander; standing still (the phone
        // says under a pace a second) it must be well more
        const still = fix.sogKn != null && fix.sogKn < STILL_KN
        if (!gap && d < Math.max(MIN_STEP_M, sigma * (still ? 3 : 1.5))) return t
        const pts = t.points.length >= MAX_POINTS ? t.points.slice(1) : t.points
        return { ...t, points: [...pts, { lon: fix.lon, lat: fix.lat, ts: fix.ts, ...(gap ? { gap: true } : {}) }], distanceM: t.distanceM + (gap ? 0 : d) }
      }
      return { ...t, points: [{ lon: fix.lon, lat: fix.lat, ts: fix.ts }] }
    })
    set({ tracks })
    save()
  },
  rename: (id, name) => {
    const tracks = get().tracks.map((t) => (t.id === id ? { ...t, name } : t))
    set({ tracks })
    save()
  },
  remove: (id) => {
    const tracks = get().tracks.filter((t) => t.id !== id)
    set({ tracks, recordingId: get().recordingId === id ? null : get().recordingId })
    save()
  },
}))

/**
 * Cut the points between t0 and t1 (inclusive) out of every track: an
 * outing deleted from the Hunt log. The point after a cut starts a new
 * segment; a track left under 2 points goes altogether.
 */
export function removeRange(t0: number, t1: number): void {
  const s = useTrackStore.getState()
  let changed = false
  const tracks: Track[] = []
  for (const t of s.tracks) {
    if (!t.points.some((p) => p.ts >= t0 && p.ts <= t1)) {
      tracks.push(t)
      continue
    }
    changed = true
    const kept: TrackPoint[] = []
    let cut = false
    for (const p of t.points) {
      if (p.ts >= t0 && p.ts <= t1) {
        cut = true
        continue
      }
      kept.push(cut && kept.length ? { ...p, gap: true } : p)
      cut = false
    }
    if (kept.length < 2) continue
    tracks.push({ ...t, points: kept, distanceM: distanceOf(kept) })
  }
  if (!changed) return
  const recordingId = s.recordingId != null && tracks.some((t) => t.id === s.recordingId) ? s.recordingId : null
  useTrackStore.setState({ tracks, recordingId })
  save()
}

/**
 * The recording follows location, wired once at startup: a good fix with
 * nothing recording picks the last track up (its last point within
 * OUTING_GAP_MS) or starts a new one; location off stops it. A track left
 * open by a reload is closed when its last point is older than the gap,
 * and resumed by the first fix otherwise.
 */
let wired = false
export function initTrackRecording() {
  if (wired) return
  wired = true
  const now = Date.now()
  const s = useTrackStore.getState()
  let changed = false
  const closed: Track[] = []
  for (const t of s.tracks) {
    if (t.endedAt != null || now - lastTs(t) <= OUTING_GAP_MS) {
      closed.push(t)
      continue
    }
    changed = true
    if (t.points.length >= 2) closed.push({ ...t, endedAt: lastTs(t) })
  }
  if (changed) {
    useTrackStore.setState({ tracks: closed })
    save()
  }
  useGpsStore.subscribe((g, prev) => {
    if (g.locating !== prev.locating && !g.locating) useTrackStore.getState().stop()
    if (!g.fix || g.fix === prev.fix) return
    const tr = useTrackStore.getState()
    if (!tr.recordingId) {
      if (!g.locating) return
      const sigma = g.fix.sigma ?? g.fix.accuracy
      if (sigma > MAX_SIGMA_M) return
      const newest = tr.tracks[tr.tracks.length - 1]
      if (newest && g.fix.ts - lastTs(newest) <= OUTING_GAP_MS) tr.resume(newest.id)
      else tr.start()
    }
    useTrackStore.getState().push(g.fix)
  })
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** One track as a GPX <trk>: a <trkseg> per stretch, split where the track went quiet. */
export function trkXml(track: Track): string {
  const segs: TrackPoint[][] = []
  for (const p of track.points) {
    if (p.gap || !segs.length) segs.push([])
    segs[segs.length - 1].push(p)
  }
  const body = segs
    .map((seg) => `    <trkseg>\n${seg.map((p) => `      <trkpt lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}"><time>${new Date(p.ts).toISOString()}</time></trkpt>`).join('\n')}\n    </trkseg>`)
    .join('\n')
  return `  <trk>\n    <name>${esc(track.name)}</name>\n${body}\n  </trk>`
}

/** A GPX document round its <wpt> and <trk> blocks. */
export function gpxDoc(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Pic River" xmlns="http://www.topografix.com/GPX/1/1">\n${body}\n</gpx>\n`
}

export function trackToGpx(track: Track): string {
  return gpxDoc(trkXml(track))
}
