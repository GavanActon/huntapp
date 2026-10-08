import type { AreaBox, AreaDef } from '../areas'
import { REGION, TIMEZONE } from '../config'
import { trackTime } from '../analytics'
import { devlog } from '../devlog'
import { fetchTimeout, localStamp } from './openMeteo'

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
/** Each area's field under its own key: this run's is the active area's. */
const keyOf = (areaId: string) => `huntapp-wind:${areaId}:v2`
const KEY = keyOf(REGION.id)
const MAX_AGE_MS = 60 * 60_000

let grid: WindGrid | null = null
/** The box the field is fetched over when the view is away from the area
 *  (explore/index.ts viewMoved): memory only, never the phone's copy, which
 *  stays the area's own for camp with no signal. Null: the area's region. */
let viewBox: AreaBox | null = null
export function setWindBox(box: AreaBox | null): void {
  if (!box) {
    if (!viewBox) return
    viewBox = null
    grid = null
    try {
      const raw = localStorage.getItem(KEY)
      if (raw) grid = JSON.parse(raw) as WindGrid
    } catch {
      /* fetched again below */
    }
    void ensureWeatherGrid()
    for (const cb of gridListeners) cb()
    return
  }
  // a new fetch only once the centre has left the box there is
  if (viewBox) {
    const cx = (box.west + box.east) / 2
    const cy = (box.south + box.north) / 2
    if (cx > viewBox.west && cx < viewBox.east && cy > viewBox.south && cy < viewBox.north) return
  }
  viewBox = box
  grid = null
  void ensureWeatherGrid()
}
let inflight: Promise<WindGrid | null> | null = null
const gridListeners = new Set<() => void>()
const tickListeners = new Set<() => void>()

try {
  const raw = localStorage.getItem(KEY)
  if (raw) grid = JSON.parse(raw) as WindGrid
} catch {
  /* private mode */
}

function lattice(box: AreaBox): { lats: number[]; lons: number[] } {
  const lats: number[] = []
  const lons: number[] = []
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      lats.push(box.south + ((box.north - box.south) * r) / (ROWS - 1))
      lons.push(box.west + ((box.east - box.west) * c) / (COLS - 1))
    }
  return { lats, lons }
}

/** The field over an area's box, in its time zone: the active area's
 *  unless another is named. */
async function fetchGrid(box: AreaBox = REGION, timezone: string = TIMEZONE): Promise<WindGrid> {
  const { lats, lons } = lattice(box)
  const q = new URLSearchParams({
    latitude: lats.map((v) => v.toFixed(4)).join(','),
    longitude: lons.map((v) => v.toFixed(4)).join(','),
    hourly: 'wind_speed_10m,wind_direction_10m',
    wind_speed_unit: 'kmh',
    timezone,
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
    lon0: box.west,
    lat0: box.south,
    dLon: (box.east - box.west) / (COLS - 1),
    dLat: (box.north - box.south) / (ROWS - 1),
    time: cells[0].hourly.time,
    windKmh: cells.map((c) => c.hourly.wind_speed_10m.map((v) => v ?? NaN)),
    windDir: cells.map((c) => c.hourly.wind_direction_10m.map((v) => v ?? 0)),
  }
  return g
}

/** Another area's field, saved under its key for when the app is switched
 *  there (weather/refresh.ts fetchAreaWeather). This run's field is not
 *  touched: it is the active area's. */
export async function fetchAreaWindGrid(area: AreaDef): Promise<boolean> {
  try {
    const g = await fetchGrid(area.region, area.timezone)
    localStorage.setItem(keyOf(area.id), JSON.stringify(g))
    devlog('wind', `grid · ${area.name} · ${g.time.length} h`)
    return true
  } catch (e) {
    devlog('wind', `grid · ${area.name} · fetch failed · ${(e as Error).message}`)
    return false
  }
}

/** The grid, fetching when there is none or it is old. Resolves to what
 *  there is (possibly a stale copy, possibly null). */
export function ensureWeatherGrid(): Promise<WindGrid | null> {
  if (grid && Date.now() - grid.fetchedAt < MAX_AGE_MS) return Promise.resolve(grid)
  if (inflight) return inflight
  const box = viewBox
  inflight = fetchGrid(box ?? REGION)
    .then((g) => {
      grid = g
      // the area's own field is kept for camp; a view's elsewhere is not
      if (!box) {
        try {
          localStorage.setItem(KEY, JSON.stringify(g))
        } catch {
          /* ignore */
        }
      }
      devlog('wind', `grid · ${g.time.length} h`)
      trackTime('wind_grid')
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

/** When the field was fetched, its hours, and the end of its last hour. */
export function windGridInfo(): { fetchedAt: number; hours: number; endMs: number } | null {
  if (!grid || !grid.time.length) return null
  return { fetchedAt: grid.fetchedAt, hours: grid.time.length, endMs: Date.parse(grid.time[grid.time.length - 1]) + 3600_000 }
}

/** The field has this moment's hour. Past its last hour windSampler holds
 *  that hour, which a map's streaks can live with but the ground model must
 *  not: days without signal would freeze its wind (micro/model.ts asks this
 *  first and falls back to the camp's forecast). */
export function windGridCovers(ms: number): boolean {
  const g = grid
  if (!g || !g.time.length) return false
  return ms >= Date.parse(g.time[0]) && ms <= Date.parse(g.time[g.time.length - 1]) + 3600_000
}

/** One hour of the field at a point, bilinear (the sampler's corners). */
function cellWind(g: WindGrid, k: number, lon: number, lat: number): { kmh: number; dir: number } {
  const fx = Math.min(g.cols - 1, Math.max(0, (lon - g.lon0) / g.dLon))
  const fy = Math.min(g.rows - 1, Math.max(0, (lat - g.lat0) / g.dLat))
  const x0 = Math.min(g.cols - 2, Math.floor(fx))
  const y0 = Math.min(g.rows - 2, Math.floor(fy))
  let kmh = 0
  let u = 0
  let v = 0
  for (let c = 0; c < 4; c++) {
    const cell = (y0 + (c >> 1)) * g.cols + x0 + (c & 1)
    const w = (c & 1 ? fx - x0 : 1 - (fx - x0)) * (c >> 1 ? fy - y0 : 1 - (fy - y0))
    kmh += g.windKmh[cell][k] * w
    u += Math.sin((g.windDir[cell][k] * Math.PI) / 180) * w
    v += Math.cos((g.windDir[cell][k] * Math.PI) / 180) * w
  }
  return { kmh, dir: ((Math.atan2(u, v) * 180) / Math.PI + 360) % 360 }
}

/**
 * Satellite hours (weather/satForecast.ts) into the field: a text carries
 * the camp's wind alone, so each hour of the field is turned and scaled to
 * it, every cell keeping its own turn and strength against the camp (the
 * lakes' lee stays). An hour the field has gives its own pattern; an hour
 * past its end borrows the pattern of its hour whose camp wind blew most
 * nearly the same way, and with none that had a wind worth reading, the
 * camp's wind everywhere. Hours between the field's end and the text's are
 * long past and hold the last. fetchedAt is kept: signal refetches it.
 */
export function patchWindGrid(rows: { ms: number; kmh: number; dir: number }[], camp: { lon: number; lat: number }): void {
  if (!rows.length) return
  const g: WindGrid = grid ?? {
    // none on the phone yet: the box at the camp's wind
    fetchedAt: 0,
    cols: COLS,
    rows: ROWS,
    lon0: REGION.west,
    lat0: REGION.south,
    dLon: (REGION.east - REGION.west) / (COLS - 1),
    dLat: (REGION.north - REGION.south) / (ROWS - 1),
    time: [],
    windKmh: Array.from({ length: COLS * ROWS }, () => []),
    windDir: Array.from({ length: COLS * ROWS }, () => []),
  }
  const cells = g.cols * g.rows
  const own = g.time.length
  const idx = new Map(g.time.map((t, i) => [t, i]))
  const turnOf = (a: number, b: number) => ((b - a + 540) % 360) - 180
  const similar = (dir: number): number => {
    let best = -1
    let bestTurn = 181
    for (let k = 0; k < own; k++) {
      const c = cellWind(g, k, camp.lon, camp.lat)
      const t = Math.abs(turnOf(c.dir, dir))
      if (c.kmh >= 3 && t < bestTurn) {
        best = k
        bestTurn = t
      }
    }
    return best
  }
  for (const r of rows) {
    const stamp = localStamp(r.ms)
    let i = idx.get(stamp)
    if (i == null) {
      const last = g.time.length ? Date.parse(g.time[g.time.length - 1]) : null
      if (last != null && r.ms <= last) continue
      if (last != null)
        for (let ms = last + 3600_000; ms < r.ms; ms += 3600_000) {
          g.time.push(localStamp(ms))
          for (let c = 0; c < cells; c++) {
            g.windKmh[c].push(g.windKmh[c][g.windKmh[c].length - 1])
            g.windDir[c].push(g.windDir[c][g.windDir[c].length - 1])
          }
        }
      g.time.push(stamp)
      for (let c = 0; c < cells; c++) {
        g.windKmh[c].push(r.kmh)
        g.windDir[c].push(r.dir)
      }
      i = g.time.length - 1
    }
    const pat = i < own ? i : similar(r.dir)
    const campPat = pat >= 0 ? cellWind(g, pat, camp.lon, camp.lat) : null
    for (let c = 0; c < cells; c++) {
      let turn = 0
      let ratio = 1
      if (campPat && campPat.kmh >= 2 && Number.isFinite(g.windKmh[c][pat])) {
        turn = turnOf(campPat.dir, g.windDir[c][pat])
        ratio = Math.min(2, Math.max(0.5, g.windKmh[c][pat] / campPat.kmh))
      }
      g.windKmh[c][i] = r.kmh * ratio
      g.windDir[c][i] = (r.dir + turn + 360) % 360
    }
  }
  grid = g
  try {
    localStorage.setItem(KEY, JSON.stringify(g))
  } catch {
    /* ignore */
  }
  devlog('wind', `grid · satellite hours · ${rows.length} h · now ${g.time.length} h`)
  for (const cb of gridListeners) cb()
}
