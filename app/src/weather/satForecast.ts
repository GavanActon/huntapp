import { ACTIVE_AREA } from '../areas'
import { devlog } from '../devlog'
import { areaPlaces, homePlace } from '../state/placesStore'
import { patchProfile, type ProfileRow } from './boundaryLayer'
import {
  cachedPointForecast,
  compass,
  forecastBasisMs,
  forecastPoint,
  hourAt,
  HRDPS_LAND_MS,
  localStamp,
  savePointForecast,
  type PointForecast,
} from './openMeteo'
import { announceWeather } from './refresh'
import { decodeSatReply, satPointHash, satRequest, type SatHours } from './satCodec'
import { sunPosition, sunTimes } from './sun'
import { patchWindGrid, windSampler } from './windGrid'

/**
 * Weather by satellite, the phone's side (docs/SAT-FORECAST.md). No signal,
 * and a newer forecast is out: the app writes a request for the camp, the
 * hunter sends it to the Groundwind number from an iPhone on satellite or
 * an inReach, and pastes the answer back. The answer's hours go where a
 * fetch would have put them:
 *
 *   - the camp's forecast (and every saved place's in the area, each at
 *     its own spot in the turned wind field), marked as satellite hours
 *   - the wind field, turned and scaled to the camp's wind (windGrid.ts)
 *   - the air's layering and the ensemble's spread (boundaryLayer.ts)
 *
 * so the ground model, the scent cone and the heat take them in as HRDPS
 * hours. Each copy keeps its fetchedAt, so signal still brings a full fetch.
 *
 * The request is remembered (asked, and when): an answer takes minutes, the
 * phone goes in a pocket, and the sheet opens again on the paste.
 */

const ASK_KEY = 'huntapp-sat:v1'
const HOUR_MS = 3_600_000
/** HRDPS runs 48 h; more would be the blend's guesses. */
export const SAT_HOURS = 48

export interface SatAsk {
  text: string
  lat: number
  lon: number
  areaId: string
  /** when it was sent (Copy or Text tapped); null while only shown */
  askedAt: number | null
}

/** The camp's request: the point its forecast is fetched for. */
function campAsk(): SatAsk {
  const home = homePlace()
  const at = forecastPoint(home.lon, home.lat)
  const lat = Number(at.lat.toFixed(3))
  const lon = Number(at.lon.toFixed(3))
  return { text: satRequest(lat, lon, SAT_HOURS), lat, lon, areaId: ACTIVE_AREA.id, askedAt: null }
}

function readAsk(): SatAsk | null {
  try {
    const raw = localStorage.getItem(ASK_KEY)
    return raw ? (JSON.parse(raw) as SatAsk) : null
  } catch {
    return null
  }
}

function writeAsk(a: SatAsk | null) {
  try {
    if (a) localStorage.setItem(ASK_KEY, JSON.stringify(a))
    else localStorage.removeItem(ASK_KEY)
  } catch {
    /* private mode */
  }
}

/** The request to show: the one sent from here if it is still waiting, else a fresh one. */
export function satAsk(): SatAsk {
  const fresh = campAsk()
  const kept = readAsk()
  return kept && kept.text === fresh.text && kept.areaId === fresh.areaId ? kept : fresh
}

/** Sent (or about to be): the sheet opens on the paste from now on. */
export function markAsked(a: SatAsk): SatAsk {
  const sent = { ...a, askedAt: Date.now() }
  writeAsk(sent)
  return sent
}

/** A request is out, from this area, in the last day. */
export function satWaiting(): SatAsk | null {
  const a = readAsk()
  return a && a.askedAt && a.areaId === ACTIVE_AREA.id && Date.now() - a.askedAt < 24 * HOUR_MS ? a : null
}

// ---------------------------------------------------------------- taking a reply in

export type SatResult =
  | { ok: true; hours: number; runMs: number; change: { atMs: number; now: { dir: number; kmh: number }; was: { dir: number; kmh: number } | null } | null }
  | { ok: false; why: string }

/** The run as ECCC names it: "12Z". */
export function runLabel(runMs: number): string {
  return `${String(new Date(runMs).getUTCHours()).padStart(2, '0')}Z`
}

const WHY = {
  none: 'No forecast in that text. Copy the whole reply and paste it here.',
  cut: 'Part of the reply is missing or changed. Copy the whole message again.',
  version: 'That reply is from a newer Groundwind. Update the app with signal.',
}

/** Felt temperature: wind chill when it is cold and moving (ECCC), else the air. */
function feels(t: number, kmh: number): number {
  if (t > 10 || kmh < 4.8) return t
  const v = kmh ** 0.16
  return 13.12 + 0.6215 * t - 11.37 * v + 0.3965 * t * v
}

/** A WMO code for an hour from its cloud and rain, as near as they say. */
function skyCode(cloud: number, mm: number, t: number): number {
  if (mm >= 0.1) {
    const snow = t <= 0.5
    return mm < 1 ? (snow ? 71 : 61) : mm < 3 ? (snow ? 73 : 63) : snow ? 75 : 65
  }
  return cloud < 15 ? 0 : cloud < 40 ? 1 : cloud < 75 ? 2 : 3
}

/** The satellite hours into one cached forecast, at the wind given for its
 *  spot; one begun from them when there is none. Days they touch get their
 *  highs, lows, wind and rain again from the hours. */
function patchForecast(f0: PointForecast | null, lon: number, lat: number, h: SatHours, wind: (i: number) => { kmh: number; dir: number }): PointForecast {
  const f: PointForecast = f0 ?? {
    lon,
    lat,
    fetchedAt: 0,
    hrdpsHours: 0,
    hourly: { time: [], windKmh: [], gustKmh: [], windDir: [], tempC: [], feelsC: [], weatherCode: [], precipProbPct: [], precipMm: [], snowCm: [], cloudPct: [], pressureHpa: [] },
    daily: { date: [], sunrise: [], sunset: [], tMaxC: [], tMinC: [], weatherCode: [], precipMm: [], windMaxKmh: [], precipProbMaxPct: [] },
  }
  const hr = f.hourly
  const keys = Object.keys(hr) as (keyof PointForecast['hourly'])[]
  const idx = new Map(hr.time.map((t, i) => [t, i]))
  let i0 = Infinity
  let i1 = -1
  for (let k = 0; k < h.windKmh.length; k++) {
    const ms = h.startMs + k * HOUR_MS
    const stamp = localStamp(ms)
    let i = idx.get(stamp)
    if (i == null) {
      const last = hr.time.length ? Date.parse(hr.time[hr.time.length - 1]) : null
      if (last != null && ms <= last) continue
      // past the end: the hours between are long gone and hold the last
      const push = (s: string) => {
        for (const key of keys) {
          const arr = hr[key] as unknown[]
          arr.push(key === 'time' ? s : arr.length ? arr[arr.length - 1] : key === 'precipProbPct' ? null : NaN)
        }
      }
      if (last != null) for (let m = last + HOUR_MS; m < ms; m += HOUR_MS) push(localStamp(m))
      push(stamp)
      i = hr.time.length - 1
    }
    const w = wind(k)
    const t = h.tempC[k]
    const mm = h.precipMm[k]
    hr.windKmh[i] = w.kmh
    hr.windDir[i] = w.dir
    hr.gustKmh[i] = Math.max(w.kmh, (h.gustKmh[k] / Math.max(1, h.windKmh[k])) * w.kmh)
    hr.tempC[i] = t
    hr.feelsC[i] = feels(t, w.kmh)
    hr.weatherCode[i] = skyCode(h.cloudPct[k], mm, t)
    // HRDPS has no rain chance
    hr.precipProbPct[i] = null
    hr.precipMm[i] = mm
    hr.snowCm[i] = t <= 0.5 ? mm * 0.7 : 0
    hr.cloudPct[i] = h.cloudPct[k]
    // pressure: the text has none, so the hour keeps what it had
    i0 = Math.min(i0, i)
    i1 = Math.max(i1, i)
  }
  if (i1 < 0) return f
  f.sat = { at: Date.now(), runMs: h.runMs, i0, i1 }

  // the days the hours fall in: their numbers again from the hours
  const d = f.daily
  const days = new Set(hr.time.slice(i0, i1 + 1).map((t) => t.slice(0, 10)))
  for (const day of days) {
    let j = d.date.indexOf(day)
    if (j < 0) {
      if (d.date.length && day < d.date[d.date.length - 1]) continue
      const noon = Date.parse(`${day}T12:00`)
      const sun = sunTimes(noon, lat, lon)
      d.date.push(day)
      d.sunrise.push(sun.sunriseMs != null ? localStamp(sun.sunriseMs) : `${day}T07:00`)
      d.sunset.push(sun.sunsetMs != null ? localStamp(sun.sunsetMs) : `${day}T19:00`)
      d.precipProbMaxPct.push(null)
      for (const arr of [d.tMaxC, d.tMinC, d.weatherCode, d.precipMm, d.windMaxKmh]) arr.push(NaN)
      j = d.date.length - 1
    }
    const hs = hr.time.map((t, i) => (t.startsWith(day) ? i : -1)).filter((i) => i >= 0)
    const vals = (a: number[]) => hs.map((i) => a[i]).filter(Number.isFinite)
    const temps = vals(hr.tempC)
    if (temps.length) {
      d.tMaxC[j] = Math.max(...temps)
      d.tMinC[j] = Math.min(...temps)
    }
    d.windMaxKmh[j] = Math.max(0, ...vals(hr.windKmh))
    d.precipMm[j] = vals(hr.precipMm).reduce((s, x) => s + x, 0)
    d.weatherCode[j] = Math.max(0, ...vals(hr.weatherCode))
  }
  return f
}

/**
 * A pasted reply taken in, or why not: no code in it, cut short, for
 * another place, or no newer than what the phone has. `change` is the wind
 * at the coming dusk, now and as the phone had it.
 */
export function applySatText(text: string): SatResult {
  const got = decodeSatReply(text)
  if (!got.ok) return { ok: false, why: WHY[got.why] }
  const h = got.hours
  const ask = campAsk()
  if (h.pointHash !== satPointHash(ask.lat, ask.lon)) return { ok: false, why: `That forecast is for another place. Ask again from ${ACTIVE_AREA.name}.` }
  const home = homePlace()
  // the camp's forecast point exactly (the request's is rounded to 100 m)
  const at = forecastPoint(home.lon, home.lat)
  const camp0 = cachedPointForecast(at.lon, at.lat)
  if (camp0 && h.runMs + HRDPS_LAND_MS <= forecastBasisMs(camp0)) {
    return { ok: false, why: `The phone already has that forecast (HRDPS ${runLabel(h.runMs)}) or a newer one.` }
  }
  const n = h.windKmh.length
  const endMs = h.startMs + n * HOUR_MS

  // the coming dusk, as the phone had it, before anything changes
  let dusk = sunTimes(Date.now(), home.lat, home.lon).sunsetMs
  if (dusk != null && dusk < Date.now()) dusk = sunTimes(Date.now() + 24 * HOUR_MS, home.lat, home.lon).sunsetMs
  const was = camp0 && dusk != null ? hourAt(camp0, dusk) : null

  // the field first: each place's wind is read from it at its own spot
  patchWindGrid(
    h.windKmh.map((kmh, k) => ({ ms: h.startMs + k * HOUR_MS, kmh, dir: h.windDir[k] })),
    { lon: at.lon, lat: at.lat },
  )
  const out = new Float32Array(2)
  const windAt = (lon: number, lat: number) => (k: number) => {
    const s = windSampler(h.startMs + k * HOUR_MS)
    return s && s(lon, lat, out) ? { kmh: out[0], dir: out[1] } : { kmh: h.windKmh[k], dir: h.windDir[k] }
  }

  // the camp, at its own wind exactly
  const camp = patchForecast(camp0, at.lon, at.lat, h, (k) => ({ kmh: h.windKmh[k], dir: h.windDir[k] }))
  savePointForecast(camp)
  const done = new Set([`${camp.lon.toFixed(2)},${camp.lat.toFixed(2)}`])
  // the area's other places, at theirs in the turned field
  for (const p of areaPlaces()) {
    const pt = forecastPoint(p.lon, p.lat)
    const cell = `${pt.lon.toFixed(2)},${pt.lat.toFixed(2)}`
    if (done.has(cell)) continue
    done.add(cell)
    const f0 = cachedPointForecast(pt.lon, pt.lat)
    if (!f0) continue
    savePointForecast(patchForecast(f0, pt.lon, pt.lat, h, windAt(pt.lon, pt.lat)))
  }

  // the air: sunshine from the sun's height and the cloud, as an estimate does
  const rows: ProfileRow[] = h.windKmh.map((w10, k) => {
    const ms = h.startMs + k * HOUR_MS
    const elev = sunPosition(ms - HOUR_MS / 2, home.lat, home.lon).elevDeg
    return {
      ms,
      t2: h.tempC[k],
      t80: h.t80C[k],
      w10,
      d10: h.windDir[k],
      w80: h.w80Kmh[k],
      sw: elev > 0 ? 900 * Math.sin((elev * Math.PI) / 180) * (1 - 0.7 * (h.cloudPct[k] / 100)) : 0,
      cloud: h.cloudPct[k],
      ensDirSd: h.ensDirSd[k],
    }
  })
  patchProfile(rows)

  writeAsk(null)
  announceWeather()
  devlog('wx', `satellite · HRDPS ${runLabel(h.runMs)} · ${n} h from ${localStamp(h.startMs)}`)

  let change: Extract<SatResult, { ok: true }>['change'] = null
  if (dusk != null && dusk >= h.startMs && dusk < endMs) {
    const k = Math.min(n - 1, Math.round((dusk - h.startMs) / HOUR_MS))
    change = {
      atMs: dusk,
      now: { dir: h.windDir[k], kmh: h.windKmh[k] },
      was: was ? { dir: was.windDir, kmh: was.windKmh } : null,
    }
  }
  return { ok: true, hours: n, runMs: h.runMs, change }
}

/** "NW 15" from a direction and a speed, in the units given. */
export function windWords(w: { dir: number; kmh: number }, units: 'metric' | 'imperial'): string {
  const s = Math.round(units === 'imperial' ? w.kmh * 0.621371 : w.kmh)
  return s < 2 ? 'calm' : `${compass(w.dir)} ${s}`
}
