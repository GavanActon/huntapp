import { devlog } from '../devlog'
import { homePlace } from '../state/placesStore'
import { fetchTimeout, turnHour } from './openMeteo'

/**
 * The air's layering over camp, hour by hour: what decides whether the
 * forecast wind reaches the ground at all. HRDPS carries the temperature
 * and wind at 2 m and 80 m, and the sun's radiation, so the phone can tell
 * a well-mixed afternoon from a clear, calm evening when the air near the
 * ground goes cold and heavy, decouples from the wind above and drains
 * into the bogs (Gavan, 2026-09-25: "the down draft was the cause").
 *
 * Plus the GEPS ensemble's spread in wind direction and speed: how much
 * twenty runs of the global model agree, which is how far to trust the
 * regional wind the ground model starts from.
 *
 * One point (camp) is enough: layering varies over tens of km, not the
 * 12 km box. Cached in localStorage like every other forecast.
 */

export interface Profile {
  fetchedAt: number
  lon: number
  lat: number
  time: string[]
  /** leading hours carrying HRDPS's own numbers */
  hrdpsHours: number
  t2: number[]
  t80: number[]
  w10: number[]
  d10: number[]
  w80: number[]
  /** shortwave radiation W/m² (preceding hour mean) */
  sw: number[]
  cloud: number[]
  ens: { time: string[]; dirSd: number[]; spdSd: number[]; spdMean: number[] } | null
}

export interface Layering {
  /** potential temperature 80 m minus 2 m, K: + means an inversion */
  dTheta: number
  /** bulk Richardson number over 2–80 m */
  ri: number
  /** 0 mixed … 1 fully decoupled: how far the ground air has come loose from the wind above */
  stable: number
  /** inversion strength 0…1.5 (2.5 K over 80 m ≈ 1) */
  inversion: number
  /** 0…1: sun-driven convection (daytime, unstable) */
  convective: number
  t2: number
  w10: number
  /** 10 m direction, blowing FROM (NaN when unknown) */
  d10: number
  w80: number
  sw: number
  cloud: number
  /** GEPS direction spread, degrees (null without the ensemble) */
  ensDirSd: number | null
  /** where the numbers came from */
  source: 'hrdps' | 'blend' | 'estimate'
}

const KEY = 'huntapp-profile:v1'
const MAX_AGE_MS = 3 * 3600_000
const VARS = ['temperature_2m', 'temperature_80m', 'wind_speed_10m', 'wind_direction_10m', 'wind_speed_80m', 'shortwave_radiation', 'cloud_cover']

let profile: Profile | null = null
let inflight: Promise<Profile | null> | null = null
const listeners = new Set<() => void>()

try {
  const raw = localStorage.getItem(KEY)
  if (raw) profile = JSON.parse(raw) as Profile
} catch {
  /* private mode */
}

async function om(base: string, params: Record<string, string>): Promise<Record<string, unknown>> {
  const r = await fetchTimeout(`${base}?${new URLSearchParams(params)}`, 15_000)
  if (!r.ok) throw new Error(`${base.split('/')[2]} ${r.status}`)
  return (await r.json()) as Record<string, unknown>
}

function circSd(degs: number[]): number {
  let s = 0
  let c = 0
  for (const d of degs) {
    s += Math.sin((d * Math.PI) / 180)
    c += Math.cos((d * Math.PI) / 180)
  }
  const R = Math.min(1, Math.hypot(s, c) / degs.length)
  return R <= 1e-6 ? 180 : Math.min(180, (Math.sqrt(-2 * Math.log(R)) * 180) / Math.PI)
}

async function fetchProfile(): Promise<Profile> {
  const home = homePlace()
  const common = { latitude: home.lat.toFixed(4), longitude: home.lon.toFixed(4), wind_speed_unit: 'kmh', timezone: 'America/Toronto', past_days: '1' }
  // the seven-day frame from the blend, HRDPS's own hours dropped in
  const j = await om('https://api.open-meteo.com/v1/forecast', { ...common, hourly: VARS.join(','), forecast_days: '7', models: 'best_match' })
  const h = j.hourly as Record<string, (number | null)[] | string[]>
  const num = (k: string) => (h[k] as (number | null)[]).map((v) => (v == null ? NaN : v))
  const p: Profile = {
    fetchedAt: Date.now(),
    lon: home.lon,
    lat: home.lat,
    time: h.time as string[],
    hrdpsHours: 0,
    t2: num('temperature_2m'),
    t80: num('temperature_80m'),
    w10: num('wind_speed_10m'),
    d10: num('wind_direction_10m'),
    w80: num('wind_speed_80m'),
    sw: num('shortwave_radiation'),
    cloud: num('cloud_cover'),
    ens: null,
  }
  try {
    const hj = await om('https://api.open-meteo.com/v1/forecast', { ...common, hourly: VARS.join(','), forecast_days: '2', models: 'gem_hrdps_continental' })
    const hh = hj.hourly as Record<string, (number | null)[] | string[]>
    const idx = new Map(p.time.map((t, i) => [t, i]))
    const map: [keyof Profile, string][] = [
      ['t2', 'temperature_2m'],
      ['t80', 'temperature_80m'],
      ['w10', 'wind_speed_10m'],
      ['d10', 'wind_direction_10m'],
      ['w80', 'wind_speed_80m'],
      ['sw', 'shortwave_radiation'],
      ['cloud', 'cloud_cover'],
    ]
    ;(hh.time as string[]).forEach((t, k) => {
      const i = idx.get(t)
      if (i == null || (hh.temperature_80m as (number | null)[])[k] == null) return
      for (const [dst, src] of map) {
        const v = (hh[src] as (number | null)[])[k]
        if (v != null) (p[dst] as number[])[i] = v
      }
      p.hrdpsHours = Math.max(p.hrdpsHours, i + 1)
    })
  } catch (e) {
    devlog('wind', `profile: HRDPS miss · ${(e as Error).message}`)
  }
  try {
    const ej = await om('https://ensemble-api.open-meteo.com/v1/ensemble', {
      latitude: common.latitude,
      longitude: common.longitude,
      wind_speed_unit: 'kmh',
      timezone: 'America/Toronto',
      hourly: 'wind_speed_10m,wind_direction_10m',
      forecast_days: '3',
      models: 'gem_global_ensemble',
    })
    const eh = ej.hourly as Record<string, (number | null)[] | string[]>
    const dirKeys = Object.keys(eh).filter((k) => k.startsWith('wind_direction_10m'))
    const spdKeys = Object.keys(eh).filter((k) => k.startsWith('wind_speed_10m'))
    const time = eh.time as string[]
    const dirSd: number[] = []
    const spdSd: number[] = []
    const spdMean: number[] = []
    time.forEach((_, i) => {
      const ds = dirKeys.map((k) => (eh[k] as (number | null)[])[i]).filter((v): v is number => v != null)
      const ss = spdKeys.map((k) => (eh[k] as (number | null)[])[i]).filter((v): v is number => v != null)
      const m = ss.reduce((a, b) => a + b, 0) / Math.max(1, ss.length)
      spdMean.push(m)
      spdSd.push(Math.sqrt(ss.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, ss.length)))
      // a calm member's direction is noise: weight the spread by speed
      dirSd.push(ds.length >= 5 ? circSd(ds.filter((_, k) => (ss[k] ?? 0) >= 3)) : NaN)
    })
    p.ens = { time, dirSd, spdSd, spdMean }
  } catch (e) {
    devlog('wind', `profile: ensemble miss · ${(e as Error).message}`)
  }
  return p
}

/** The profile, fetching when there is none or it is old. */
export function ensureProfile(force = false): Promise<Profile | null> {
  if (!force && profile && Date.now() - profile.fetchedAt < MAX_AGE_MS) return Promise.resolve(profile)
  if (!navigator.onLine) return Promise.resolve(profile)
  if (inflight) return inflight
  inflight = fetchProfile()
    .then((p) => {
      profile = p
      try {
        localStorage.setItem(KEY, JSON.stringify(p))
      } catch {
        /* storage full */
      }
      devlog('wind', `profile · ${p.time.length} h · HRDPS ${p.hrdpsHours} h · ensemble ${p.ens ? 'yes' : 'no'}`)
      for (const cb of listeners) cb()
      return p
    })
    .catch((e) => {
      devlog('wind', `profile fetch failed · ${(e as Error).message}`)
      return profile
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

export function currentProfile(): Profile | null {
  return profile
}

export function onProfile(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function lerpAt(time: string[], arr: number[], ms: number): number {
  // hourly values; linear between hours so a 15-minute timeline is smooth
  let i = -1
  for (let k = 0; k < time.length; k++) {
    if (Date.parse(time[k]) <= ms) i = k
    else break
  }
  if (i < 0) return arr[0]
  if (i >= time.length - 1) return arr[time.length - 1]
  const t0 = Date.parse(time[i])
  const t1 = Date.parse(time[i + 1])
  const f = (ms - t0) / (t1 - t0)
  const a = arr[i]
  const b = arr[i + 1]
  if (!Number.isFinite(a)) return b
  if (!Number.isFinite(b)) return a
  return a + (b - a) * f
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/**
 * The layering at a moment. With a profile: the bulk Richardson number
 * over 2–80 m (Stull 1988 §5.6): above ~0.25 turbulence dies and the
 * ground air decouples. Without one: a Pasquill-style guess from cloud,
 * sun and wind, labelled as an estimate.
 */
export function layeringAt(ms: number, fallback: { cloud: number; w10: number; t2: number; sunElev: number }): Layering {
  const p = profile
  const inRange = p && p.time.length && ms >= Date.parse(p.time[0]) && ms <= Date.parse(p.time[p.time.length - 1]) + 3600_000
  if (p && inRange) {
    const t2 = lerpAt(p.time, p.t2, ms)
    const t80 = lerpAt(p.time, p.t80, ms)
    const w10 = lerpAt(p.time, p.w10, ms)
    const w80 = lerpAt(p.time, p.w80, ms)
    const sw = lerpAt(p.time, p.sw, ms)
    const cloud = lerpAt(p.time, p.cloud, ms)
    if ([t2, t80, w10, w80].every(Number.isFinite)) {
      const dTheta = t80 - t2 + 0.0098 * 78
      const dU = Math.max(0.6, (w80 - w10) / 3.6)
      const ri = ((9.81 / (273.15 + t2)) * dTheta * 78) / (dU * dU)
      // in near calm Ri is all noise: it takes a real inversion to count
      const stable = dTheta > 0 ? clamp((ri - 0.1) / 0.9, 0, 1) * clamp(dTheta / 0.8, 0, 1) : 0
      const convective = dTheta < -0.2 ? clamp((-dTheta - 0.2) / 1.5, 0, 1) * clamp(sw / 400, 0, 1) : 0
      let hourIdx = -1
      for (let k = 0; k < p.time.length; k++) if (Date.parse(p.time[k]) <= ms) hourIdx = k
      const h0 = Math.max(0, hourIdx)
      const h1 = Math.min(p.time.length - 1, h0 + 1)
      const t0 = Date.parse(p.time[h0])
      const d10 = h1 > h0 ? turnHour(p.d10[h0], p.d10[h1], clamp((ms - t0) / (Date.parse(p.time[h1]) - t0), 0, 1)) : p.d10[h0]
      let ensDirSd: number | null = null
      if (p.ens) {
        const v = lerpAt(p.ens.time, p.ens.dirSd, ms)
        ensDirSd = Number.isFinite(v) ? v : null
      }
      return {
        dTheta,
        ri,
        stable,
        inversion: clamp(dTheta / 2.5, 0, 1.5),
        convective,
        t2,
        w10,
        d10,
        w80,
        sw: Number.isFinite(sw) ? sw : 0,
        cloud: Number.isFinite(cloud) ? cloud : 50,
        ensDirSd,
        source: hourIdx >= 0 && hourIdx < p.hrdpsHours ? 'hrdps' : 'blend',
      }
    }
  }
  // no profile: night, clear and light wind means an inversion (Pasquill E–F)
  const { cloud, w10, t2, sunElev } = fallback
  const clear = 1 - cloud / 100
  const night = sunElev < 3
  const calmish = Math.exp(-Math.max(0, w10 - 5) / 8)
  const stable = night ? clamp(clear * calmish * 1.1, 0, 1) : 0
  const convective = !night && sunElev > 15 ? clamp(clear * Math.sin((sunElev * Math.PI) / 180) * calmish, 0, 1) : 0
  return {
    dTheta: stable * 2.5 - convective,
    ri: stable,
    stable,
    inversion: stable,
    convective,
    t2,
    w10,
    d10: NaN,
    w80: w10 * 1.8,
    sw: night ? 0 : 900 * Math.sin((Math.max(0, sunElev) * Math.PI) / 180) * (1 - 0.7 * (cloud / 100)),
    cloud,
    ensDirSd: null,
    source: 'estimate',
  }
}
