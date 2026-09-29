import { create } from 'zustand'
import { useGpsStore, type Fix } from './gpsStore'

/**
 * Track mode: the phone's trail, recorded from the fixes while it is on.
 * The fixes come filtered (fixFilter.ts); a point is kept when the phone
 * has moved more than MIN_STEP_M and more than the fix's own wander since
 * the last one (a stand does not fill the log), a silence longer than
 * GAP_MS starts a new segment, and every track is kept in localStorage so
 * a day's walk survives a reload and exports as GPX from the Places tab.
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

function haversineM(aLon: number, aLat: number, bLon: number, bLat: number): number {
  const R = 6371008.8
  const toRad = Math.PI / 180
  const dLat = (bLat - aLat) * toRad
  const dLon = (bLon - aLon) * toRad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * toRad) * Math.cos(bLat * toRad) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

function load(): Track[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Track[]) : []
  } catch {
    return []
  }
}

let saveTimer: number | null = null
function save(tracks: Track[]) {
  if (saveTimer != null) return
  saveTimer = window.setTimeout(() => {
    saveTimer = null
    try {
      localStorage.setItem(KEY, JSON.stringify(tracks))
    } catch {
      /* full: the track lives in memory until something is deleted */
    }
  }, 2000)
}

interface TrackState {
  tracks: Track[]
  /** the id of the track being recorded, or null */
  recordingId: string | null
  /** tracks drawn on the map besides the live one */
  shown: string[]
  start: () => void
  /** Pick an unfinished track back up (the app was reloaded mid-walk); false if there is none to resume. */
  resume: (id: string) => boolean
  stop: () => void
  push: (fix: Fix) => void
  rename: (id: string, name: string) => void
  remove: (id: string) => void
  toggleShown: (id: string) => void
}

function dayName(ms: number): string {
  const d = new Date(ms)
  return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()]} ${d.getDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]} ${d.getHours() % 12 || 12}${d.getHours() < 12 ? 'a' : 'p'}`
}

export const useTrackStore = create<TrackState>((set, get) => ({
  tracks: load(),
  recordingId: null,
  shown: [],
  start: () => {
    if (get().recordingId) return
    const t: Track = { id: `t-${Date.now().toString(36)}`, name: dayName(Date.now()), startedAt: Date.now(), endedAt: null, points: [], distanceM: 0 }
    const tracks = [...get().tracks, t]
    set({ tracks, recordingId: t.id })
    save(tracks)
    const fix = useGpsStore.getState().fix
    if (fix) get().push(fix)
  },
  resume: (id) => {
    if (get().recordingId) return get().recordingId === id
    const t = get().tracks.find((x) => x.id === id)
    if (!t || t.endedAt != null) return false
    // the silence while the app was gone makes the next fix a new segment
    set({ recordingId: id })
    return true
  },
  stop: () => {
    const id = get().recordingId
    if (!id) return
    const tracks = get().tracks.map((t) => (t.id === id ? { ...t, endedAt: Date.now() } : t))
    // an empty track is nothing to keep
    const kept = tracks.filter((t) => t.id !== id || t.points.length >= 2)
    set({ tracks: kept, recordingId: null })
    save(kept)
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
    save(tracks)
  },
  rename: (id, name) => {
    const tracks = get().tracks.map((t) => (t.id === id ? { ...t, name } : t))
    set({ tracks })
    save(tracks)
  },
  remove: (id) => {
    const tracks = get().tracks.filter((t) => t.id !== id)
    set({ tracks, shown: get().shown.filter((s) => s !== id), recordingId: get().recordingId === id ? null : get().recordingId })
    save(tracks)
  },
  toggleShown: (id) => set((s) => ({ shown: s.shown.includes(id) ? s.shown.filter((x) => x !== id) : [...s.shown, id] })),
}))

/** The recording follows the GPS store: one subscription, wired once. */
let wired = false
export function initTrackRecording() {
  if (wired) return
  wired = true
  useGpsStore.subscribe((s, prev) => {
    if (s.fix && s.fix !== prev.fix) useTrackStore.getState().push(s.fix)
  })
}

export function trackToGpx(track: Track): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const segs: TrackPoint[][] = []
  for (const p of track.points) {
    if (p.gap || !segs.length) segs.push([])
    segs[segs.length - 1].push(p)
  }
  const body = segs
    .map((seg) => `    <trkseg>\n${seg.map((p) => `      <trkpt lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}"><time>${new Date(p.ts).toISOString()}</time></trkpt>`).join('\n')}\n    </trkseg>`)
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Pic River" xmlns="http://www.topografix.com/GPX/1/1">\n  <trk>\n    <name>${esc(track.name)}</name>\n${body}\n  </trk>\n</gpx>\n`
}

/** Share (the phone's share sheet) or download a track as GPX. */
export async function exportTrackGpx(track: Track): Promise<void> {
  const gpx = trackToGpx(track)
  const fileName = `${track.name.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-') || 'track'}.gpx`
  const file = new File([gpx], fileName, { type: 'application/gpx+xml' })
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: track.name })
      return
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return
    }
  }
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}

export function trackDurationMin(t: Track): number {
  return Math.round(((t.endedAt ?? Date.now()) - t.startedAt) / 60_000)
}
