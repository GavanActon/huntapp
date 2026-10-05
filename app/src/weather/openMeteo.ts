import { ACTIVE_AREA, areaAt } from '../areas'

/**
 * The forecast at a point: wind, gusts, temperature, sky, rain chance,
 * precipitation and snow, hour by hour for seven days, plus each day's
 * sunrise and sunset.
 *
 * Two fetches, the boat app's stance: the SHORT TERM is ECCC's own HRDPS
 * 2.5 km model, asked for by name (`gem_hrdps_continental`, the run
 * Open-Meteo re-serves within the hour of ECCC publishing it), and it
 * overwrites the first ~48 h of a `best_match` seven-day outlook. Beyond
 * the HRDPS horizon the blend stands. Rain CHANCE is always the blend's:
 * a deterministic model has none.
 *
 * Camp has signal in the morning and at night, so every good fetch is
 * cached in localStorage and read back first; the age is shown, and the
 * app never blanks a forecast it has for one it cannot get.
 */

export interface PointForecast {
  lon: number
  lat: number
  fetchedAt: number
  /** How many leading hours carry HRDPS values (0 when that call failed). */
  hrdpsHours: number
  /** Hours brought in by satellite text (weather/satForecast.ts): when they
   *  were taken in, the HRDPS run they are from, and their first and last
   *  index. fetchedAt stays the last real fetch, so signal still refetches. */
  sat?: { at: number; runMs: number; i0: number; i1: number }
  hourly: {
    time: string[]
    windKmh: number[]
    gustKmh: number[]
    windDir: number[]
    tempC: number[]
    feelsC: number[]
    weatherCode: number[]
    precipProbPct: (number | null)[]
    precipMm: number[]
    snowCm: number[]
    cloudPct: number[]
    pressureHpa: number[]
  }
  daily: {
    date: string[]
    sunrise: string[]
    sunset: string[]
    tMaxC: number[]
    tMinC: number[]
    weatherCode: number[]
    precipMm: number[]
    windMaxKmh: number[]
    precipProbMaxPct: (number | null)[]
  }
}

export interface HourRow {
  time: Date
  windKmh: number
  gustKmh: number
  windDir: number
  tempC: number
  feelsC: number
  weatherCode: number
  precipProbPct: number | null
  precipMm: number
  snowCm: number
  cloudPct: number
  pressureHpa: number
  /** True where the hour's numbers are HRDPS's own. */
  hrdps: boolean
  /** True where the hour came by satellite text. */
  sat: boolean
}

const CACHE_PREFIX = 'huntapp-wx:'
/** HRDPS lands on Open-Meteo about 3 h 40 after its run time. */
export const HRDPS_LAND_MS = (3 * 60 + 40) * 60_000
const FETCH_TIMEOUT_MS = 12_000
const HOURLY = [
  'temperature_2m',
  'apparent_temperature',
  'precipitation_probability',
  'precipitation',
  'snowfall',
  'weather_code',
  'cloud_cover',
  'surface_pressure',
  'wind_speed_10m',
  'wind_direction_10m',
  'wind_gusts_10m',
]
const HRDPS_HOURLY = HOURLY.filter((h) => h !== 'precipitation_probability')

function cacheKey(lon: number, lat: number) {
  return `${CACHE_PREFIX}${lon.toFixed(2)},${lat.toFixed(2)}`
}

export function fetchTimeout(url: string, ms = FETCH_TIMEOUT_MS): Promise<Response> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), ms)
  return fetch(url, { signal: ctl.signal }).finally(() => clearTimeout(t))
}

/** Where a forecast is asked for: the point pulled into the box of the area
 *  it lies in, else of the active one (a point in no area is answered at
 *  the active box's edge, as before areas), and that area's time zone. A
 *  pin in another area so gets its own weather, not this box's corner's. */
export function forecastPoint(lon: number, lat: number): { lon: number; lat: number; timezone: string } {
  const a = areaAt(lon, lat) ?? ACTIVE_AREA
  return {
    lon: Math.min(Math.max(lon, a.region.west), a.region.east),
    lat: Math.min(Math.max(lat, a.region.south), a.region.north),
    timezone: a.timezone,
  }
}

async function openMeteo(params: Record<string, string>): Promise<Record<string, unknown>> {
  const url = `https://api.open-meteo.com/v1/forecast?${new URLSearchParams(params)}`
  const resp = await fetchTimeout(url)
  if (!resp.ok) throw new Error(`open-meteo ${resp.status}`)
  const j = (await resp.json()) as Record<string, unknown>
  if (!(j.hourly as Record<string, unknown> | undefined)?.time) throw new Error('open-meteo: no hourly block')
  return j
}

export async function fetchPointForecast(lon: number, lat: number): Promise<PointForecast> {
  const at = forecastPoint(lon, lat)
  ;({ lon, lat } = at)
  const common = {
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    wind_speed_unit: 'kmh',
    timezone: at.timezone,
  }
  // the seven-day outlook first: it is the frame the HRDPS hours drop into
  const j = await openMeteo({
    ...common,
    hourly: HOURLY.join(','),
    daily: [
      'weather_code',
      'temperature_2m_max',
      'temperature_2m_min',
      'sunrise',
      'sunset',
      'precipitation_sum',
      'precipitation_probability_max',
      'wind_speed_10m_max',
    ].join(','),
    forecast_days: '7',
    models: 'best_match',
  })
  const h = j.hourly as Record<string, (number | null)[] | string[]>
  const d = j.daily as Record<string, (number | null)[] | string[]>
  const f: PointForecast = {
    lon,
    lat,
    fetchedAt: Date.now(),
    hrdpsHours: 0,
    hourly: {
      time: h.time as string[],
      windKmh: h.wind_speed_10m as number[],
      gustKmh: h.wind_gusts_10m as number[],
      windDir: h.wind_direction_10m as number[],
      tempC: h.temperature_2m as number[],
      feelsC: h.apparent_temperature as number[],
      weatherCode: h.weather_code as number[],
      precipProbPct: (h.precipitation_probability as (number | null)[]) ?? (h.time as string[]).map(() => null),
      precipMm: h.precipitation as number[],
      snowCm: h.snowfall as number[],
      cloudPct: h.cloud_cover as number[],
      pressureHpa: h.surface_pressure as number[],
    },
    daily: {
      date: d.time as string[],
      sunrise: d.sunrise as string[],
      sunset: d.sunset as string[],
      tMaxC: d.temperature_2m_max as number[],
      tMinC: d.temperature_2m_min as number[],
      weatherCode: d.weather_code as number[],
      precipMm: d.precipitation_sum as number[],
      windMaxKmh: d.wind_speed_10m_max as number[],
      precipProbMaxPct: (d.precipitation_probability_max as (number | null)[]) ?? (d.time as string[]).map(() => null),
    },
  }

  // then HRDPS by name, overwriting the hours it covers; a miss costs nothing
  try {
    const hj = await openMeteo({ ...common, hourly: HRDPS_HOURLY.join(','), forecast_days: '3', models: 'gem_hrdps_continental' })
    const hh = hj.hourly as Record<string, (number | null)[] | string[]>
    const idx = new Map((f.hourly.time as string[]).map((t, i) => [t, i]))
    const fields: [keyof PointForecast['hourly'], string][] = [
      ['windKmh', 'wind_speed_10m'],
      ['gustKmh', 'wind_gusts_10m'],
      ['windDir', 'wind_direction_10m'],
      ['tempC', 'temperature_2m'],
      ['feelsC', 'apparent_temperature'],
      ['weatherCode', 'weather_code'],
      ['precipMm', 'precipitation'],
      ['snowCm', 'snowfall'],
      ['cloudPct', 'cloud_cover'],
      ['pressureHpa', 'surface_pressure'],
    ]
    let covered = 0
    ;(hh.time as string[]).forEach((t, k) => {
      const i = idx.get(t)
      if (i == null) return
      // an hour the model has no wind for is past its horizon: stop there
      if ((hh.wind_speed_10m as (number | null)[])[k] == null) return
      for (const [dst, src] of fields) {
        const v = (hh[src] as (number | null)[] | undefined)?.[k]
        if (v != null) (f.hourly[dst] as number[])[i] = v
      }
      covered = Math.max(covered, i + 1)
    })
    f.hrdpsHours = covered
  } catch {
    /* the blend already carries HRDPS's numbers by way of Open-Meteo's mix */
  }

  try {
    localStorage.setItem(cacheKey(lon, lat), JSON.stringify(f))
  } catch {
    /* storage full or private */
  }
  return f
}

// The cache read back, parsed once per stored string: the ground model asks
// for the camp's forecast for every minute it evaluates, and a 7-day blend
// is a big JSON to parse each time. A different string in storage (a fresh
// fetch, another tab) re-parses; a missing one drops the entry.
const parsedCache = new Map<string, { raw: string; parsed: PointForecast }>()

/** A forecast written back to the cache under its own point (the
 *  satellite hours, weather/satForecast.ts). */
export function savePointForecast(f: PointForecast): void {
  try {
    localStorage.setItem(cacheKey(f.lon, f.lat), JSON.stringify(f))
  } catch {
    /* storage full or private */
  }
}

/** An hour's stamp as Open-Meteo writes it in the area's time zone, which
 *  is the phone's (Date.parse reads it back as local): "2026-10-05T14:00". */
export function localStamp(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

export function cachedPointForecast(lon: number, lat: number): PointForecast | null {
  ;({ lon, lat } = forecastPoint(lon, lat))
  const key = cacheKey(lon, lat)
  try {
    const raw = localStorage.getItem(key)
    if (!raw) {
      parsedCache.delete(key)
      return null
    }
    const hit = parsedCache.get(key)
    if (hit && hit.raw === raw) return hit.parsed
    const parsed = JSON.parse(raw) as PointForecast
    parsedCache.set(key, { raw, parsed })
    return parsed
  } catch {
    return null
  }
}

/** HRDPS runs at 00/06/12/18Z and lands on Open-Meteo about 3 h 40 later.
 *  The moment the first run AFTER `fetchedAt` lands: a forecast fetched
 *  before then is the best available until then. */
export function nextHrdpsRunMs(fetchedAt: number): number {
  const runMs = 6 * 3600_000
  // the run whose landing is the first strictly after fetchedAt
  const lastLanded = Math.floor((fetchedAt - HRDPS_LAND_MS) / runMs) * runMs
  return lastLanded + runMs + HRDPS_LAND_MS
}

/** The moment a forecast is as new as: its fetch, or the landing of the run
 *  its satellite hours came from if that is later. nextHrdpsRunMs of it is
 *  when a newer run is out. */
export function forecastBasisMs(f: PointForecast): number {
  return f.sat ? Math.max(f.fetchedAt, f.sat.runMs + HRDPS_LAND_MS) : f.fetchedAt
}

/** Cache-first: the stored copy at once (stale once the next model run has
 *  landed, see weather/refresh.ts), a fresh fetch when online. */
export async function pointForecast(lon: number, lat: number): Promise<{ forecast: PointForecast; stale: boolean } | null> {
  const cached = cachedPointForecast(lon, lat)
  const now = Date.now()
  const fresh = cached && now < nextHrdpsRunMs(cached.fetchedAt) && now - cached.fetchedAt < 6 * 3600_000
  if (fresh) return { forecast: cached, stale: false }
  try {
    return { forecast: await fetchPointForecast(lon, lat), stale: false }
  } catch {
    // no signal: a copy whose satellite hours carry the newest run is not stale
    return cached ? { forecast: cached, stale: now >= nextHrdpsRunMs(forecastBasisMs(cached)) } : null
  }
}

export function hourRow(f: PointForecast, i: number): HourRow {
  const h = f.hourly
  const sat = !!f.sat && i >= f.sat.i0 && i <= f.sat.i1
  return {
    time: new Date(h.time[i]),
    windKmh: h.windKmh[i],
    gustKmh: h.gustKmh[i],
    windDir: h.windDir[i],
    tempC: h.tempC[i],
    feelsC: h.feelsC[i],
    weatherCode: h.weatherCode[i],
    precipProbPct: h.precipProbPct[i] ?? null,
    precipMm: h.precipMm[i],
    snowCm: h.snowCm[i],
    cloudPct: h.cloudPct[i],
    pressureHpa: h.pressureHpa[i],
    hrdps: i < (f.hrdpsHours ?? 0) || sat,
    sat,
  }
}

/** All hours of the local day that starts at dayStartMs. */
export function dayHours(f: PointForecast, dayStartMs: number): HourRow[] {
  const end = dayStartMs + 24 * 3600_000
  const out: HourRow[] = []
  f.hourly.time.forEach((t, i) => {
    const ms = Date.parse(t)
    if (ms >= dayStartMs && ms < end) out.push(hourRow(f, i))
  })
  return out
}

/** Linear between two hourly values; either one alone if the other is missing. */
export function lerpHour(a: number, b: number, t: number): number {
  if (!Number.isFinite(a)) return b
  if (!Number.isFinite(b)) return a
  return a + (b - a) * t
}

/** A wind direction between two hours, turning the short way round. */
export function turnHour(a: number, b: number, t: number): number {
  if (!Number.isFinite(a)) return b
  if (!Number.isFinite(b)) return a
  const d = ((b - a + 540) % 360) - 180
  return (a + d * t + 360) % 360
}

/**
 * The weather at a moment. Open-Meteo's wind, gusts, temperature, cloud
 * and pressure are snapshots on the hour, so a moment between two hours
 * is blended between them (the wind turning the short way): 6:30 is
 * halfway from 6:00 to 7:00, not 6:00 held for the hour. Rain, snow, the
 * rain chance and the sky word are the hour before each stamp, so they
 * come from the stamp that closes the hour the moment falls in (7:00's,
 * for 6:30). Before the first stamp or past the last there is nothing to
 * blend with.
 */
export function hourAt(f: PointForecast, ms: number): HourRow | null {
  const times = f.hourly.time
  let idx = -1
  for (let i = 0; i < times.length; i++) {
    if (Date.parse(times[i]) <= ms) idx = i
    else break
  }
  if (idx < 0) return null
  const a = hourRow(f, idx)
  const t0 = a.time.getTime()
  if (ms === t0 || idx + 1 >= times.length) return a
  const b = hourRow(f, idx + 1)
  const t = (ms - t0) / (b.time.getTime() - t0)
  if (!(t > 0 && t < 1)) return a
  return {
    ...b,
    time: new Date(ms),
    windKmh: lerpHour(a.windKmh, b.windKmh, t),
    gustKmh: lerpHour(a.gustKmh, b.gustKmh, t),
    windDir: turnHour(a.windDir, b.windDir, t),
    tempC: lerpHour(a.tempC, b.tempC, t),
    feelsC: lerpHour(a.feelsC, b.feelsC, t),
    cloudPct: lerpHour(a.cloudPct, b.cloudPct, t),
    pressureHpa: lerpHour(a.pressureHpa, b.pressureHpa, t),
    hrdps: a.hrdps && b.hrdps,
    sat: a.sat && b.sat,
  }
}

/** WMO weather code to a short word. */
export function skyLabel(code: number): string {
  if (code === 0) return 'Clear'
  if (code <= 2) return 'Some cloud'
  if (code === 3) return 'Overcast'
  if (code <= 48) return 'Fog'
  if (code <= 57) return 'Drizzle'
  if (code <= 67) return 'Rain'
  if (code <= 77) return 'Snow'
  if (code <= 82) return 'Showers'
  if (code <= 86) return 'Snow showers'
  return 'Thunder'
}

export function isThunder(code: number): boolean {
  return code >= 95
}
export function isSnow(code: number): boolean {
  return (code >= 71 && code <= 77) || code === 85 || code === 86
}
export function isRain(code: number): boolean {
  return (code >= 51 && code <= 67) || (code >= 80 && code <= 82)
}

/** Compass point from degrees (blowing FROM). */
export function compass(deg: number): string {
  const pts = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  return pts[Math.round((((deg % 360) + 360) % 360) / 45) % 8]
}
