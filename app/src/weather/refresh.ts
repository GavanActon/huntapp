import { useSyncExternalStore } from 'react'
import { ACTIVE_AREA, type AreaDef } from '../areas'
import { devlog } from '../devlog'
import { useAppStore } from '../state/appStore'
import { areaPlaces, placeArea, usePlacesStore } from '../state/placesStore'
import { cachedPointForecast, fetchPointForecast, forecastPoint, nextHrdpsRunMs, type PointForecast } from './openMeteo'
import { ensureWeatherGrid, fetchAreaWindGrid } from './windGrid'
import { ensureProfile, fetchAreaProfile } from './boundaryLayer'
import { recentDailyMeans } from '../spots/conditions'

/**
 * When to fetch weather, decided once, here. Camp has signal in the
 * morning and at night, and a phone's radio is not free, so:
 *
 *  - The moment signal comes back (the `online` event, the app coming to
 *    the front) every saved place's forecast is refreshed if it is worth
 *    it, so the day's outlook is on the phone before the signal goes.
 *  - "Worth it" is model-aware: HRDPS runs at 00/06/12/18Z and lands about
 *    3 h 40 later. A forecast fetched after the newest run landed is as
 *    good as it gets; refetching it every half hour would only cost data.
 *    Past the next run's landing it is stale and gets one fetch. The
 *    seven-day blend rides along on the same call.
 *  - Nothing is ever thrown away: a failed fetch leaves the last copy and
 *    the age shows on the strip and the Weather tab.
 */

const MIN_GAP_MS = 60_000 // never hammer: one sweep per minute at most
const listeners = new Set<() => void>()
let lastSweep = 0
let sweeping: Promise<void> | null = null

/** What Settings shows about the weather on the phone: whether a sweep is
 *  running, when one last brought something in, and the last miss. The
 *  forecast's own age lives on the forecast (fetchedAt); this is the
 *  fetching, not the data. */
export interface WeatherStatus {
  busy: boolean
  /** the last sweep that fetched at least one forecast */
  lastOkAt: number | null
  /** the last sweep that tried and got nothing */
  lastFailAt: number | null
  lastError: string | null
}

let status: WeatherStatus = { busy: false, lastOkAt: null, lastFailAt: null, lastError: null }
const statusListeners = new Set<() => void>()

function setStatus(patch: Partial<WeatherStatus>) {
  status = { ...status, ...patch }
  for (const cb of statusListeners) cb()
}

export function weatherStatus(): WeatherStatus {
  return status
}

export function onWeatherStatus(cb: () => void): () => void {
  statusListeners.add(cb)
  return () => statusListeners.delete(cb)
}

/** The status, re-rendering as sweeps start and end. */
export function useWeatherStatus(): WeatherStatus {
  return useSyncExternalStore(onWeatherStatus, weatherStatus, weatherStatus)
}

/** The camp's forecast on the phone: its age is the age of the weather. */
export function campForecast(): PointForecast | null {
  const home = usePlacesStore.getState().places[0]
  return home ? cachedPointForecast(home.lon, home.lat) : null
}

/** When the next HRDPS run lands, counted from the camp's forecast: the
 *  moment the app will fetch again on its own, given signal. Null with no
 *  forecast yet (it fetches the moment there is signal). */
export function nextWeatherUpdateMs(): number | null {
  const f = campForecast()
  return f ? nextHrdpsRunMs(f.fetchedAt) : null
}

/** The HRDPS run a forecast carries, as ECCC names it: "12Z". */
export function hrdpsRunLabel(fetchedAt: number): string {
  const LAND_MS = (3 * 60 + 40) * 60_000
  const runMs = 6 * 3600_000
  const lastLanded = Math.floor((fetchedAt - LAND_MS) / runMs) * runMs
  return `${String(Math.round(lastLanded / 3600_000) % 24).padStart(2, '0')}Z`
}

/** A forecast is worth refetching once the next HRDPS run has landed since
 *  it was fetched, or if it is over six hours old for any reason. */
export function forecastStale(f: PointForecast | null, now = Date.now()): boolean {
  if (!f) return true
  if (now - f.fetchedAt > 6 * 3600_000) return true
  return now >= nextHrdpsRunMs(f.fetchedAt)
}

/** Every point the app shows weather for: the saved places of the area it
 *  is in (the camp first). Another area's wait until it is switched to,
 *  rather than spend the camp's few minutes of signal; saving its maps
 *  brings its home's (fetchAreaWeather). */
function subjects(): { lon: number; lat: number; name: string }[] {
  return areaPlaces().map((p) => ({ lon: p.lon, lat: p.lat, name: p.name }))
}

export function onWeatherRefreshed(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** New forecasts on the phone by another road (satellite hours pasted in,
 *  weather/satForecast.ts): everything that redraws after a sweep redraws. */
export function announceWeather(): void {
  for (const cb of listeners) cb()
}

/** Refresh what is stale, one place at a time. `force` ignores freshness
 *  (the Weather tab's refresh button). Resolves when the sweep is done. */
export function refreshWeather(reason: string, force = false): Promise<void> {
  if (!navigator.onLine) return Promise.resolve()
  if (sweeping) return sweeping
  const now = Date.now()
  if (!force && now - lastSweep < MIN_GAP_MS) return Promise.resolve()
  lastSweep = now
  setStatus({ busy: true })
  sweeping = (async () => {
    let fetched = 0
    let tried = 0
    let error: string | null = null
    for (const s of subjects()) {
      const cached = cachedPointForecast(s.lon, s.lat)
      if (!force && !forecastStale(cached, now)) continue
      tried++
      try {
        await fetchPointForecast(s.lon, s.lat)
        // the Spots scorer's ten-day means, on the same signal window
        await recentDailyMeans(s.lon, s.lat)
        fetched++
      } catch (e) {
        error = (e as Error).message
        devlog('wx', `${s.name} · fetch failed · ${error}`)
        if (!navigator.onLine) break
      }
    }
    // the wind field on the same signal window
    await ensureWeatherGrid()
    // the air's layering and the ensemble spread: the ground wind's inputs
    await ensureProfile(force)
    devlog('wx', `sweep (${reason}) · ${fetched} fetched`)
    if (fetched) setStatus({ lastOkAt: Date.now(), lastError: null })
    else if (tried) setStatus({ lastFailAt: Date.now(), lastError: error ?? 'no signal' })
    if (fetched) for (const cb of listeners) cb()
  })().finally(() => {
    sweeping = null
    setStatus({ busy: false })
  })
  return sweeping
}

/**
 * Another area's weather, into its own keys: the forecast and ten-day
 * means for its home and its stands (not its lakes: signal is rare), its
 * wind field and its air's layering. Fetched when its maps are saved with
 * signal (offline/downloads.ts), so a first arrival with none still has the
 * forecast the ground wind and the scent cone are worked out from. Once the
 * app is switched there, the sweep above keeps it fresh.
 */
export async function fetchAreaWeather(area: AreaDef): Promise<void> {
  if (!navigator.onLine || area.id === ACTIVE_AREA.id) return
  const stands = usePlacesStore.getState().places.filter((p) => p.kind === 'stand' && placeArea(p)?.id === area.id)
  // one fetch per forecast: a point's is kept to 0.01° (openMeteo), and the home is often a stand too
  const seen = new Set<string>()
  let fetched = 0
  for (const p of [area.presets[0], ...stands]) {
    const at = forecastPoint(p.lon, p.lat)
    const cell = `${at.lon.toFixed(2)},${at.lat.toFixed(2)}`
    if (seen.has(cell)) continue
    seen.add(cell)
    try {
      await fetchPointForecast(p.lon, p.lat)
      await recentDailyMeans(p.lon, p.lat)
      fetched++
    } catch (e) {
      devlog('wx', `${area.name} · ${p.name} · fetch failed · ${(e as Error).message}`)
      if (!navigator.onLine) return
    }
  }
  const grid = await fetchAreaWindGrid(area)
  const air = await fetchAreaProfile(area)
  devlog('wx', `${area.name} · for the trip · ${fetched} forecast${fetched === 1 ? '' : 's'}${grid ? ' · wind field' : ''}${air ? ' · layering' : ''}`)
}

let wired = false

/** Wire the triggers once: signal back, app to the front, the hour. */
export function initWeatherRefresh() {
  if (wired) return
  wired = true
  window.addEventListener('online', () => void refreshWeather('online'))
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void refreshWeather('visible')
  })
  // the top of every hour: a run may have landed
  const tick = () => {
    void refreshWeather('hour')
    const now = Date.now()
    window.setTimeout(tick, now - (now % 3600_000) + 3600_000 + 15_000 - now)
  }
  const now = Date.now()
  window.setTimeout(tick, now - (now % 3600_000) + 3600_000 + 15_000 - now)
  // a new place: its outlook, while there is signal
  usePlacesStore.subscribe((s, prev) => {
    if (s.places.length > prev.places.length) void refreshWeather('new place')
  })
  useAppStore.subscribe((s, prev) => {
    if (s.online && !prev.online) void refreshWeather('online')
  })
  void refreshWeather('start')
}
