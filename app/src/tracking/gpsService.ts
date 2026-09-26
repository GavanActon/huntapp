import { withMap } from '../map/mapController'
import { useAppStore } from '../state/appStore'
import { nearestInBounds } from '../config'
import { useGpsStore, type Fix } from './gpsStore'

/** A plain geolocation watch: one fix in the store, and the map follows
 *  when asked. The boat app's fix gate, wake lock and track recording are
 *  deliberately not here yet. */
let watchId: number | null = null

export function startGps() {
  if (watchId != null) return
  const gps = useGpsStore.getState()
  if (!('geolocation' in navigator)) return gps.setStatus('error', 'no geolocation')
  if (!window.isSecureContext) return gps.setStatus('insecure')
  gps.setStatus('acquiring')
  watchId = navigator.geolocation.watchPosition(
    (p) => {
      const fix: Fix = {
        lon: p.coords.longitude,
        lat: p.coords.latitude,
        accuracy: p.coords.accuracy,
        sogKn: p.coords.speed == null ? null : p.coords.speed * 1.94384,
        cog: p.coords.heading,
        ts: p.timestamp,
      }
      useGpsStore.getState().setFix(fix)
      useGpsStore.getState().setStatus('on')
      if (useAppStore.getState().follow) {
        const { center } = nearestInBounds(fix.lon, fix.lat)
        withMap((m) => m.easeTo({ center, duration: 500 }))
      }
    },
    (err) => {
      const s = useGpsStore.getState()
      if (err.code === err.PERMISSION_DENIED) s.setStatus('denied', err.message)
      else s.setStatus('error', err.message)
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 },
  )
}

export function stopGps() {
  if (watchId != null) navigator.geolocation.clearWatch(watchId)
  watchId = null
  useGpsStore.getState().setStatus('off')
}

/** Locate and follow: start the watch, centre on the next fix. */
export function locateAndFollow() {
  useAppStore.getState().setFollow(true)
  startGps()
  const fix = useGpsStore.getState().fix
  if (fix) {
    const { center } = nearestInBounds(fix.lon, fix.lat)
    withMap((m) => m.easeTo({ center, zoom: Math.max(m.getZoom(), 13) }))
  }
}
