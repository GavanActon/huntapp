import { REGION } from '../config'
import { devlog } from '../devlog'
import { fetchTimeout } from './openMeteo'

/**
 * The wind field over the region: a small lattice of Open-Meteo points
 * (HRDPS 2.5 km by name, so the particles show ECCC's own wind), hourly
 * for three days, cached in localStorage so the field still moves at camp
 * with no signal. The lattice is 5×5 over a 12 km box: more than HRDPS
 * itself resolves, which is the point; a single point would draw one
 * uniform wind and the lakes' lee would be invisible.
 */

export interface WindGrid {
  fetchedAt: number
  cols: number
  rows: number
  lon0: number
  lat0: number
  dLon: number
  dLat: number
  time: string[]
  /** [row*cols+col][hour] */
  windKmh: number[][]
  windDir: number[][]
}

const COLS = 5
const ROWS = 5
const KEY = `huntapp-wind:${REGION.id}:v2`
const MAX_AGE_MS = 60 * 60_000

let grid: WindGrid | null = null
let inflight: Promise<WindGrid | null> | null = null
const gridListeners = new Set<() => void>()
const tickListeners = new Set<() => void>()

try {
  const raw = localStorage.getItem(KEY)
  if (raw) grid = JSON.parse(raw) as WindGrid
} catch {
  /* private mode */
}

function lattice(): { lats: number[]; lons: number[] } {
  const lats: number[] = []
  const lons: number[] = []
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      lats.push(REGION.south + ((REGION.north - REGION.south) * r) / (ROWS - 1))
      lons.push(REGION.west + ((REGION.east - REGION.west) * c) / (COLS - 1))
    }
  return { lats, lons }
}

async function fetchGrid(): Promise<WindGrid> {
  const { lats, lons } = lattice()
  const q = new URLSearchParams({
    latitude: lats.map((v) => v.toFixed(4)).join(','),
    longitude: lons.map((v) => v.toFixed(4)).join(','),
    hourly: 'wind_speed_10m,wind_direction_10m',
    wind_speed_unit: 'kmh',
    timezone: 'America/Toronto',
    forecast_days: '3',
    // yesterday too: wind checks are scored against the hour they were made
    past_days: '1',
    models: 'gem_hrdps_continental',
  })
  const resp = await fetchTimeout(`https://api.open-meteo.com/v1/forecast?${q}`, 15_000)
  if (!resp.ok) throw new Error(`open-meteo grid ${resp.status}`)
  const j = (await resp.json()) as { hourly: { time: string[]; wind_speed_10m: (number | null)[]; wind_direction_10m: (number | null)[] } }[]
  const cells = Array.isArray(j) ? j : [j]
  if (cells.length !== COLS * ROWS) throw new Error(`open-meteo grid: ${cells.length} cells`)
  const g: WindGrid = {
    fetchedAt: Date.now(),
    cols: COLS,
    rows: ROWS,
    lon0: REGION.west,
    lat0: REGION.south,
    dLon: (REGION.east - REGION.west) / (COLS - 1),
    dLat: (REGION.north - REGION.south) / (ROWS - 1),
    time: cells[0].hourly.time,
    windKmh: cells.map((c) => c.hourly.wind_speed_10m.map((v) => v ?? NaN)),
    windDir: cells.map((c) => c.hourly.wind_direction_10m.map((v) => v ?? 0)),
  }
  return g
}

/** The grid, fetching when there is none or it is old. Resolves to what
 *  there is (possibly a stale copy, possibly null). */
export function ensureWeatherGrid(): Promise<WindGrid | null> {
  if (grid && Date.now() - grid.fetchedAt < MAX_AGE_MS) return Promise.resolve(grid)
  if (inflight) return inflight
  inflight = fetchGrid()
    .then((g) => {
      grid = g
      try {
        localStorage.setItem(KEY, JSON.stringify(g))
      } catch {
        /* ignore */
      }
      devlog('wind', `grid · ${g.time.length} h`)
      for (const cb of gridListeners) cb()
      return g
    })
    .catch((e) => {
      devlog('wind', `grid fetch failed · ${(e as Error).message}`)
      return grid
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

export function onWeatherGrid(cb: () => void): () => void {
  gridListeners.add(cb)
  return () => gridListeners.delete(cb)
}

/** Fires every ten minutes, on the clock: the field is blended between
 *  hours, so "now" drifts from one hour's wind to the next. */
export function onWeatherTick(cb: () => void): () => void {
  tickListeners.add(cb)
  return () => tickListeners.delete(cb)
}
const TICK_MS = 10 * 60_000
let tickTimer: number | null = null
function armTick() {
  if (tickTimer != null) return
  const now = Date.now()
  const next = now - (now % TICK_MS) + TICK_MS + 5000
  tickTimer = window.setTimeout(() => {
    tickTimer = null
    for (const cb of tickListeners) cb()
    void ensureWeatherGrid()
    armTick()
  }, next - now)
}
armTick()

export type WindSample = (lon: number, lat: number, out: Float32Array) => boolean

function hourIndexAt(time: string[], ms: number): number {
  let idx = 0
  for (let i = 0; i < time.length; i++) {
    if (Date.parse(time[i]) <= ms) idx = i
    else break
  }
  return idx
}

/** Bilinear wind at a moment, blended between the hours either side of
 *  it (each corner's speed linear, its direction by unit vectors, so it
 *  turns the short way): out[0] = km/h, out[1] = direction FROM. */
export function windSampler(ms: number): WindSample | null {
  const g = grid
  if (!g || g.time.length === 0) return null
  const i = hourIndexAt(g.time, ms)
  const j = Math.min(g.time.length - 1, i + 1)
  const t0 = Date.parse(g.time[i])
  const tf = j > i ? Math.min(1, Math.max(0, (ms - t0) / (Date.parse(g.time[j]) - t0))) : 0
  return (lon, lat, out) => {
    const fx = (lon - g.lon0) / g.dLon
    const fy = (lat - g.lat0) / g.dLat
    const x0 = Math.min(g.cols - 2, Math.max(0, Math.floor(fx)))
    const y0 = Math.min(g.rows - 2, Math.max(0, Math.floor(fy)))
    const tx = Math.min(1, Math.max(0, fx - x0))
    const ty = Math.min(1, Math.max(0, fy - y0))
    let wind = 0
    let u = 0
    let v = 0
    for (let k = 0; k < 4; k++) {
      const cell = (y0 + (k >> 1)) * g.cols + x0 + (k & 1)
      const w = (k & 1 ? tx : 1 - tx) * (k >> 1 ? ty : 1 - ty)
      if (!w) continue
      let spd = g.windKmh[cell][i]
      if (!Number.isFinite(spd)) return false
      let rad = (g.windDir[cell][i] * Math.PI) / 180
      let du = Math.sin(rad)
      let dv = Math.cos(rad)
      const next = g.windKmh[cell][j]
      if (tf > 0 && Number.isFinite(next)) {
        spd += (next - spd) * tf
        rad = (g.windDir[cell][j] * Math.PI) / 180
        du += (Math.sin(rad) - du) * tf
        dv += (Math.cos(rad) - dv) * tf
      }
      wind += spd * w
      u += du * w
      v += dv * w
    }
    out[0] = wind
    out[1] = ((Math.atan2(u, v) * 180) / Math.PI + 360) % 360
    return true
  }
}

export function windGridInfo(): { fetchedAt: number; hours: number } | null {
  return grid ? { fetchedAt: grid.fetchedAt, hours: grid.time.length } : null
}
