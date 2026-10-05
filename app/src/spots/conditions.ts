/**
 * The day's conditions at the planning time, in the terms the rules use:
 * wind, temperature, sky, rain, the pressure trend, whether a cold front
 * has just passed, where the sun is, the date in the season, and an
 * estimated lake surface temperature from the past week's air temperature.
 * Everything comes from the forecast the strip already caches, plus one
 * small cached call for the recent daily means.
 */
import { fetchTimeout, forecastPoint, hourAt, type PointForecast } from '../weather/openMeteo'
import { moonPhase } from '../weather/moon'
import { sunTimes } from '../weather/sun'
import { startOfDayMs } from '../time'

export interface Conditions {
  timeMs: number
  lon: number
  lat: number
  windKmh: number
  gustKmh: number
  /** blowing FROM, degrees */
  windDir: number
  /** hours before now the wind has held within 45° at ≥8 km/h */
  windPersistH: number
  /** largest swing of direction (degrees) over the next 4 hours */
  windShiftDeg: number
  tempC: number
  cloudPct: number
  precipMmH: number
  weatherCode: number
  /** surface pressure change over the last 6 h, hPa (+ rising) */
  pressureTrend6h: number
  /** how much colder it is than 24 h ago, °C (+ = colder now) */
  tempDrop24h: number
  sunriseMs: number | null
  sunsetMs: number | null
  /** hours since sunrise (negative before), hours until sunset (negative after) */
  sinceSunriseH: number
  toSunsetH: number
  isDay: boolean
  /** 0 new … 1 full */
  moonIllum: number
  dayOfYear: number
  month: number
  /** estimated lake surface temperature, °C, and how it was derived */
  waterTempC: number
  waterTempNote: string
  /** true when the forecast has HRDPS numbers for this hour */
  hrdps: boolean
  /** days in a row before the plan day with a high of WARM_HIGH_C or more */
  warmRun: number
  /** the plan day's high and the day before's, °C (null when unknown) */
  dayHigh: number | null
  prevHigh: number | null
}

/** A day warm enough that the afternoon sits well above the moose's 14 °C
 *  heat-stress onset for hours (docs/HUNT-FISH-SCIENCE.md, recent days). */
export const WARM_HIGH_C = 18

const RECENT_KEY = 'huntapp-recent:'
interface RecentDaily {
  fetchedAt: number
  date: string[]
  tMean: number[]
  /** daily highs, lows and rain (absent in caches from before they were fetched) */
  tMax?: number[]
  tMin?: number[]
  precipMm?: number[]
}

function recentKey(lon: number, lat: number) {
  return `${RECENT_KEY}${lon.toFixed(2)},${lat.toFixed(2)}`
}

/** The ten-day means the phone holds for a point, however old, without
 *  waiting: what a scoring pass reads while the sweep fetches fresh ones. */
export function cachedRecentDaily(lon: number, lat: number): RecentDaily | null {
  const at = forecastPoint(lon, lat)
  try {
    const raw = localStorage.getItem(recentKey(at.lon, at.lat))
    const cached = raw ? (JSON.parse(raw) as RecentDaily) : null
    return cached && cached.tMax ? cached : null
  } catch {
    return null
  }
}

/** Daily mean, high, low and rain for the past ten days (cached six hours). */
export async function recentDailyMeans(lon: number, lat: number): Promise<RecentDaily | null> {
  // pulled into its area's box, as the forecast is (openMeteo.forecastPoint)
  const at = forecastPoint(lon, lat)
  ;({ lon, lat } = at)
  let cached: RecentDaily | null = null
  try {
    const raw = localStorage.getItem(recentKey(lon, lat))
    cached = raw ? (JSON.parse(raw) as RecentDaily) : null
  } catch {
    /* ignore */
  }
  if (cached && cached.tMax && Date.now() - cached.fetchedAt < 6 * 3600_000) return cached
  try {
    const q = new URLSearchParams({
      latitude: lat.toFixed(4),
      longitude: lon.toFixed(4),
      daily: 'temperature_2m_mean,temperature_2m_max,temperature_2m_min,precipitation_sum',
      past_days: '10',
      forecast_days: '1',
      timezone: at.timezone,
    })
    const r = await fetchTimeout(`https://api.open-meteo.com/v1/forecast?${q}`)
    if (!r.ok) throw new Error(String(r.status))
    type Col = (number | null)[]
    const j = (await r.json()) as { daily: { time: string[]; temperature_2m_mean: Col; temperature_2m_max: Col; temperature_2m_min: Col; precipitation_sum: Col } }
    const num = (a: Col | undefined) => (a ?? []).map((v) => v ?? NaN)
    const out: RecentDaily = {
      fetchedAt: Date.now(),
      date: j.daily.time,
      tMean: num(j.daily.temperature_2m_mean),
      tMax: num(j.daily.temperature_2m_max),
      tMin: num(j.daily.temperature_2m_min),
      precipMm: num(j.daily.precipitation_sum),
    }
    try {
      localStorage.setItem(recentKey(lon, lat), JSON.stringify(out))
    } catch {
      /* ignore */
    }
    return out
  } catch {
    return cached
  }
}

/** Seasonal envelope a small Shield lake's surface stays inside (°C) by
 *  day of year: ice-out early May, peak early August, ice-up mid November. */
function seasonalEnvelope(doy: number): [number, number] {
  // piecewise: (doy, lo, hi)
  const pts: [number, number, number][] = [
    [1, 0, 1],
    [120, 0, 3], // Apr 30: ice going
    [130, 4, 8], // ice-out
    [150, 9, 14],
    [175, 15, 20],
    [215, 19, 24], // early Aug peak
    [245, 16, 21],
    [260, 13, 17], // mid Sept
    [280, 9, 13], // turnover
    [300, 5, 9],
    [320, 1, 5],
    [335, 0, 2],
    [366, 0, 1],
  ]
  for (let i = 1; i < pts.length; i++) {
    if (doy <= pts[i][0]) {
      const [d0, lo0, hi0] = pts[i - 1]
      const [d1, lo1, hi1] = pts[i]
      const t = (doy - d0) / (d1 - d0)
      return [lo0 + (lo1 - lo0) * t, hi0 + (hi1 - hi0) * t]
    }
  }
  return [0, 1]
}

/** Lake surface temperature from the 7-day mean air temperature, clamped
 *  to the seasonal envelope (docs/HUNT-FISH-SCIENCE.md, water temperature). */
export function estimateWaterTemp(doy: number, recent: RecentDaily | null, planDate: Date): { t: number; note: string } {
  const [lo, hi] = seasonalEnvelope(doy)
  if (recent && recent.tMean.length) {
    // the seven days ending the day before the planning day
    const target = planDate.toISOString().slice(0, 10)
    const idx = recent.date.indexOf(target)
    const end = idx > 0 ? idx : recent.date.length - 1
    const vals = recent.tMean.slice(Math.max(0, end - 7), end).filter((v) => Number.isFinite(v))
    if (vals.length >= 3) {
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length
      const raw = 2 + 0.85 * mean
      const t = Math.min(hi, Math.max(lo, raw))
      return { t: Math.round(t * 2) / 2, note: `from a ${vals.length}-day air mean of ${mean.toFixed(1)}°` }
    }
  }
  return { t: Math.round(((lo + hi) / 2) * 2) / 2, note: 'seasonal typical (no recent temperatures cached)' }
}

function angDiff(a: number, b: number): number {
  const d = Math.abs(((a - b) % 360 + 540) % 360 - 180)
  return d
}

function isoDay(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Daily highs by date: the forecast from today on, the recent record before. */
function dailyHighs(f: PointForecast, recent: RecentDaily | null): Map<string, number> {
  const m = new Map<string, number>()
  if (recent?.tMax) recent.date.forEach((d, i) => Number.isFinite(recent.tMax![i]) && m.set(d, recent.tMax![i]))
  const today = isoDay(Date.now())
  f.daily.date.forEach((d, i) => {
    const v = f.daily.tMaxC[i]
    if (d >= today && Number.isFinite(v)) m.set(d, v)
  })
  return m
}

/** The run of warm days before the plan day, and its high against the day before. */
function recentDays(f: PointForecast, recent: RecentDaily | null, dayStart: number): { warmRun: number; dayHigh: number | null; prevHigh: number | null } {
  const highs = dailyHighs(f, recent)
  const at = (k: number) => highs.get(isoDay(dayStart + k * 86_400_000 + 12 * 3600_000)) ?? null
  let warmRun = 0
  for (let k = -1; k >= -10; k--) {
    const h = at(k)
    if (h == null || h < WARM_HIGH_C) break
    warmRun++
  }
  return { warmRun, dayHigh: at(0), prevHigh: at(-1) }
}

export function deriveConditions(f: PointForecast, timeMs: number, recent: RecentDaily | null): Conditions | null {
  const now = hourAt(f, timeMs)
  if (!now) return null
  const h6 = hourAt(f, timeMs - 6 * 3600_000)
  const h24 = hourAt(f, timeMs - 24 * 3600_000)
  // wind persistence: hours back while the direction holds
  let persist = 0
  for (let k = 1; k <= 24; k++) {
    const hk = hourAt(f, timeMs - k * 3600_000)
    if (!hk || hk.time.getTime() > timeMs - k * 3600_000 + 3600_000 * 0.5 + 1) {
      /* fine */
    }
    if (!hk || hk.windKmh < 8 || angDiff(hk.windDir, now.windDir) > 45) break
    if (hk.time.getTime() === now.time.getTime()) break
    persist++
  }
  let shift = 0
  for (let k = 1; k <= 4; k++) {
    const hk = hourAt(f, timeMs + k * 3600_000)
    if (hk) shift = Math.max(shift, angDiff(hk.windDir, now.windDir))
  }
  const dayStart = startOfDayMs(timeMs)
  const sun = sunTimes(dayStart + 12 * 3600_000, f.lat, f.lon)
  const since = sun.sunriseMs != null ? (timeMs - sun.sunriseMs) / 3600_000 : 6
  const to = sun.sunsetMs != null ? (sun.sunsetMs - timeMs) / 3600_000 : 6
  const d = new Date(timeMs)
  const jan1 = new Date(d.getFullYear(), 0, 1).getTime()
  const doy = Math.floor((dayStart - jan1) / 86_400_000) + 1
  const wt = estimateWaterTemp(doy, recent, d)
  return {
    timeMs,
    lon: f.lon,
    lat: f.lat,
    windKmh: now.windKmh,
    gustKmh: now.gustKmh,
    windDir: now.windDir,
    windPersistH: persist,
    windShiftDeg: shift,
    tempC: now.tempC,
    cloudPct: now.cloudPct,
    precipMmH: now.precipMm,
    weatherCode: now.weatherCode,
    pressureTrend6h: h6 && h6.time.getTime() < now.time.getTime() ? now.pressureHpa - h6.pressureHpa : 0,
    tempDrop24h: h24 && h24.time.getTime() < now.time.getTime() ? h24.tempC - now.tempC : 0,
    sunriseMs: sun.sunriseMs,
    sunsetMs: sun.sunsetMs,
    sinceSunriseH: since,
    toSunsetH: to,
    isDay: since > 0 && to > 0,
    moonIllum: moonPhase(timeMs).illumination,
    dayOfYear: doy,
    month: d.getMonth() + 1,
    waterTempC: wt.t,
    waterTempNote: wt.note,
    hrdps: now.hrdps,
    ...recentDays(f, recent, dayStart),
  }
}

/** Compass point from degrees (blowing FROM). */
export function compass8(deg: number): string {
  const pts = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  return pts[Math.round((((deg % 360) + 360) % 360) / 45) % 8]
}
