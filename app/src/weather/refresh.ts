import { devlog } from '../devlog'
import { useAppStore } from '../state/appStore'
import { usePlacesStore } from '../state/placesStore'
import { cachedPointForecast, fetchPointForecast, nextHrdpsRunMs, type PointForecast } from './openMeteo'
import { ensureWeatherGrid } from './windGrid'
import { ensureProfile } from './boundaryLayer'
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

/** A forecast is worth refetching once the next HRDPS run has landed since
 *  it was fetched, or if it is over six hours old for any reason. */
export function forecastStale(f: PointForecast | null, now = Date.now()): boolean {
  if (!f) return true
  if (now - f.fetchedAt > 6 * 3600_000) return true
  return now >= nextHrdpsRunMs(f.fetchedAt)
}

/** Every point the app shows weather for: saved places (the camp first). */
function subjects(): { lon: number; lat: number; name: string }[] {
  return usePlacesStore.getState().places.map((p) => ({ lon: p.lon, lat: p.lat, name: p.name }))
}

export function onWeatherRefreshed(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** Refresh what is stale, one place at a time. `force` ignores freshness
 *  (the Weather tab's refresh button). Resolves when the sweep is done. */
export function refreshWeather(reason: string, force = false): Promise<void> {
  if (!navigator.onLine) return Promise.resolve()
  if (sweeping) return sweeping
  const now = Date.now()
  if (!force && now - lastSweep < MIN_GAP_MS) return Promise.resolve()
  lastSweep = now
  sweeping = (async () => {
    let fetched = 0
    for (const s of subjects()) {
      const cached = cachedPointForecast(s.lon, s.lat)
      if (!force && !forecastStale(cached, now)) continue
      try {
        await fetchPointForecast(s.lon, s.lat)
        // the Spots scorer's ten-day means, on the same signal window
        await recentDailyMeans(s.lon, s.lat)
        fetched++
      } catch (e) {
        devlog('wx', `${s.name} · fetch failed · ${(e as Error).message}`)
        if (!navigator.onLine) break
      }
    }
    // the wind field on the same signal window
    await ensureWeatherGrid()
    // the air's layering and the ensemble spread: the ground wind's inputs
    await ensureProfile(force)
    devlog('wx', `sweep (${reason}) · ${fetched} fetched`)
    if (fetched) for (const cb of listeners) cb()
  })().finally(() => {
    sweeping = null
  })
  return sweeping
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
