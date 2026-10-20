import type { AreaBox, AreaDef } from '../areas'
import { REGION, TIMEZONE } from '../config'
import { trackTime } from '../analytics'
import { devlog } from '../devlog'
import { trackTask } from '../offline/loadProgress'
import { fetchTimeout, lastStampAt, localStamp, stampsMs } from './openMeteo'

/**
 * The wind field over the region: a small lattice of Open-Meteo points
 * (HRDPS 2.5 km by name, so the particles show ECCC's own wind), hourly
 * for three days, cached in localStorage so the field still moves at camp
 * with no signal. The lattice is 5×5 over a 12 km box: more than HRDPS
 * itself resolves, which is the point; a single point would draw one
 * uniform wind and the lakes' lee would be invisible.
 *
 * Past the area's box, a second lattice over the view (explore/index.ts
 * viewMoved), in memory only: up to 9×9 points over whatever is on screen,
 * fetched again when the view leaves it or zooms well in past it. Before it
 * (2026-10-15) the one lattice was 22 km round the view's centre, clamped
 * beyond: zoomed out, a whole province drew one small box's edge wind, and
 * every pan that moved the centre out of the box turned the lot at once
 * (Gavan: "once I get outside that range it seems flip and not to match").
 * The area's own lattice always serves its box, so a cone at camp never
 * moves because the map was zoomed out.
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

/** the area's own lattice, kept on the phone for camp */
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

// ---- the lattice over the view, past the area's box

/** the view's lattice in use, and the last few fetched (panning back costs nothing) */
let viewGrid: WindGrid | null = null
const viewKept: WindGrid[] = []
const VIEW_KEEP = 6
/** the view as it last settled, outside the area's box; null over the box */
let viewWanted: AreaBox | null = null
let viewSeq = 0
let viewTimer: number | null = null
/** a pan settling and moving on in under this fetches nothing for the first */
const VIEW_WAIT_MS = 350
/** the lattice reaches this far past the view each way, as a share of it, so a short pan stays inside */
const VIEW_PAD = 0.35
/** its smallest half-height, degrees of latitude: 11 km, as the one round the view's centre was */
const VIEW_MIN_HALF = 0.1

const latSpan = (b: AreaBox) => b.north - b.south
const holds = (b: AreaBox, v: AreaBox) => v.west >= b.west && v.east <= b.east && v.south >= b.south && v.north <= b.north
const gridBox = (g: WindGrid): AreaBox => ({ west: g.lon0, south: g.lat0, east: g.lon0 + g.dLon * (g.cols - 1), north: g.lat0 + g.dLat * (g.rows - 1) })
/** A lattice serves a view it holds, fresh, and not so much bigger that its points are coarse there. */
const serves = (g: WindGrid, v: AreaBox) => Date.now() - g.fetchedAt < MAX_AGE_MS && holds(gridBox(g), v) && latSpan(gridBox(g)) <= Math.max(2 * VIEW_MIN_HALF, 4 * latSpan(v)) * (1 + 2 * VIEW_PAD)

/** The box a view's lattice covers: the view and a margin, never smaller than 22 km tall. */
function boxFor(v: AreaBox): AreaBox {
  const cy = (v.south + v.north) / 2
  const cx = (v.west + v.east) / 2
  const half = Math.max(VIEW_MIN_HALF, (latSpan(v) / 2) * (1 + 2 * VIEW_PAD))
  const halfLon = Math.max(VIEW_MIN_HALF * 1.5 / Math.max(0.2, Math.cos((cy * Math.PI) / 180)), ((v.east - v.west) / 2) * (1 + 2 * VIEW_PAD))
  return { west: cx - halfLon, east: cx + halfLon, south: Math.max(-85, cy - half), north: Math.min(85, cy + half) }
}

/** Points each way for a box: 5 near, 7 for a district, 9 for a province. */
const pointsFor = (b: AreaBox) => (latSpan(b) >= 3 ? 9 : latSpan(b) >= 0.6 ? 7 : 5)

/**
 * The view as it settled (explore/index.ts viewMoved): null while it is
 * inside the area's box, which its own lattice serves. Elsewhere a kept
 * lattice that serves it is taken at once, else one is fetched once the
 * view has stayed put a moment, the strip's line sliding while it comes.
 */
export function setWindView(view: AreaBox | null): void {
  viewWanted = view
  if (viewTimer != null) {
    window.clearTimeout(viewTimer)
    viewTimer = null
  }
  if (!view) return
  if (viewGrid && serves(viewGrid, view)) return
  const kept = viewKept.find((g) => serves(g, view))
  if (kept) {
    viewGrid = kept
    for (const cb of gridListeners) cb()
    return
  }
  viewTimer = window.setTimeout(() => {
    viewTimer = null
    void fetchView(view)
  }, VIEW_WAIT_MS)
}

async function fetchView(view: AreaBox): Promise<void> {
  const seq = ++viewSeq
  const box = boxFor(view)
  const n = pointsFor(box)
  try {
    // seamless: HRDPS's own numbers wherever it reaches, the coarser GEM past its edge
    // (one point past it and an HRDPS-only request is refused whole: a view of the Lakes reaching 36° N)
    const g = await trackTask('wind-view', fetchGrid(box, TIMEZONE, n, 0, 'gem_seamless'))
    viewKept.unshift(g)
    if (viewKept.length > VIEW_KEEP) viewKept.pop()
    // a later view has asked since: kept, but the newer one's lattice is coming
    if (seq !== viewSeq) return
    viewGrid = g
    devlog('wind', `view lattice · ${n}×${n} · ${Math.round(latSpan(box) * 111)} km tall`)
    for (const cb of gridListeners) cb()
  } catch (e) {
    devlog('wind', `view lattice failed · ${(e as Error).message}`)
  }
}

function lattice(box: AreaBox, n: number): { lats: number[]; lons: number[] } {
  const lats: number[] = []
  const lons: number[] = []
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) {
      lats.push(box.south + ((box.north - box.south) * r) / (n - 1))
      lons.push(box.west + ((box.east - box.west) * c) / (n - 1))
    }
  return { lats, lons }
}

/** The field over a box, in a time zone: the active area's unless another
 *  is named; n points each way, and the day before for the area's own
 *  (wind checks are scored against the hour they were made). */
async function fetchGrid(box: AreaBox = REGION, timezone: string = TIMEZONE, n = COLS, pastDays = 1, model = 'gem_hrdps_continental'): Promise<WindGrid> {
  const { lats, lons } = lattice(box, n)
  const q = new URLSearchParams({
    latitude: lats.map((v) => v.toFixed(4)).join(','),
    longitude: lons.map((v) => v.toFixed(4)).join(','),
    hourly: 'wind_speed_10m,wind_direction_10m',
    wind_speed_unit: 'kmh',
    timezone,
    forecast_days: '3',
    past_days: String(pastDays),
    models: model,
  })
  const resp = await fetchTimeout(`https://api.open-meteo.com/v1/forecast?${q}`, 15_000)
  if (!resp.ok) throw new Error(`open-meteo grid ${resp.status}`)
  const j = (await resp.json()) as { hourly: { time: string[]; wind_speed_10m: (number | null)[]; wind_direction_10m: (number | null)[] } }[]
  const cells = Array.isArray(j) ? j : [j]
  if (cells.length !== n * n) throw new Error(`open-meteo grid: ${cells.length} cells`)
  const g: WindGrid = {
    fetchedAt: Date.now(),
    cols: n,
    rows: n,
    lon0: box.west,
    lat0: box.south,
    dLon: (box.east - box.west) / (n - 1),
    dLat: (box.north - box.south) / (n - 1),
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
  inflight = fetchGrid(REGION)
    .then((g) => {
      grid = g
      // kept for camp with no signal
      try {
        localStorage.setItem(KEY, JSON.stringify(g))
      } catch {
        /* ignore */
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
    // the view's lattice ages too, while the view is still out there
    if (viewWanted && viewGrid && Date.now() - viewGrid.fetchedAt >= MAX_AGE_MS) void fetchView(viewWanted)
    armTick()
  }, next - now)
}
armTick()

export type WindSample = (lon: number, lat: number, out: Float32Array) => boolean

/** The field's hour at or before the moment (its first before the first): the stamps parsed once (openMeteo stampsMs). */
function hourIndexAt(time: string[], ms: number): number {
  return Math.max(0, lastStampAt(stampsMs(time), ms))
}

/** The share of the area's box, in from its edge, over which its lattice
 *  hands over to the view's: no seam where the two meet. */
const HANDOVER = 0.12

/**
 * The wind at a moment: the area's lattice over its box, the view's past it
 * (where it reaches), the two blended over a band just inside the box's edge.
 * Anywhere neither has, the area's lattice held at its edge, as it ever was.
 * out[0] = km/h, out[1] = direction FROM.
 */
export function windSampler(ms: number): WindSample | null {
  const area = grid && grid.time.length ? latticeSampler(grid, ms) : null
  const vg = viewGrid
  const view = vg && vg.time.length ? latticeSampler(vg, ms) : null
  if (!view || !vg) {
    if (!area || !grid) return area
    // past the area's box, nothing: the map browses there, pictures and no wind
    // (explore/index.ts viewMoved); held at its edge, the streaks drew the box's
    // wind over a province
    const ab = gridBox(grid)
    return (lon, lat, out) => lon >= ab.west && lon <= ab.east && lat >= ab.south && lat <= ab.north && area(lon, lat, out)
  }
  const vb = gridBox(vg)
  const inView = (lon: number, lat: number) => lon >= vb.west && lon <= vb.east && lat >= vb.south && lat <= vb.north
  if (!area || !grid) return (lon, lat, out) => inView(lon, lat) && view(lon, lat, out)
  const ab = gridBox(grid)
  const mx = (ab.east - ab.west) * HANDOVER
  const my = (ab.north - ab.south) * HANDOVER
  const o2 = new Float32Array(2)
  return (lon, lat, out) => {
    // how deep inside the area's box, 0 at its edge, 1 past the band
    const d = Math.min((lon - ab.west) / mx, (ab.east - lon) / mx, (lat - ab.south) / my, (ab.north - lat) / my)
    if (d >= 1 || !inView(lon, lat)) return area(lon, lat, out)
    if (d <= 0) return view(lon, lat, out)
    if (!area(lon, lat, out)) return view(lon, lat, out)
    if (!view(lon, lat, o2)) return true
    // speeds linear, directions by unit vectors
    const a = (out[1] * Math.PI) / 180
    const b = (o2[1] * Math.PI) / 180
    const u = d * Math.sin(a) + (1 - d) * Math.sin(b)
    const v = d * Math.cos(a) + (1 - d) * Math.cos(b)
    out[0] = d * out[0] + (1 - d) * o2[0]
    out[1] = ((Math.atan2(u, v) * 180) / Math.PI + 360) % 360
    return true
  }
}

/** One lattice's bilinear wind at a moment, blended between the hours
 *  either side of it (each corner's speed linear, its direction by unit
 *  vectors, so it turns the short way); held at its edge beyond it. */
function latticeSampler(g: WindGrid, ms: number): WindSample {
  const st = stampsMs(g.time)
  const i = hourIndexAt(g.time, ms)
  const j = Math.min(g.time.length - 1, i + 1)
  const t0 = st[i]
  const tf = j > i ? Math.min(1, Math.max(0, (ms - t0) / (st[j] - t0))) : 0
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
  return { fetchedAt: grid.fetchedAt, hours: grid.time.length, endMs: stampsMs(grid.time)[grid.time.length - 1] + 3600_000 }
}

/** The field has this moment's hour. Past its last hour windSampler holds
 *  that hour, which a map's streaks can live with but the ground model must
 *  not: days without signal would freeze its wind (micro/model.ts asks this
 *  first and falls back to the camp's forecast). */
export function windGridCovers(ms: number): boolean {
  const g = grid
  if (!g || !g.time.length) return false
  const st = stampsMs(g.time)
  return ms >= st[0] && ms <= st[st.length - 1] + 3600_000
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
