import { withMap } from '../map/mapController'
import { useAppStore } from '../state/appStore'
import { nearestInBounds } from '../config'
import { useGpsStore, type Fix } from './gpsStore'
import { useTrackStore } from './trackStore'
import { requestCompass, startCompass, stopCompass, useCompass } from './compass'

/** A plain geolocation watch: one fix in the store, and the map follows
 *  when asked. It runs only while the locate button is on or a track is
 *  recording, never on its own: location is the hunter's to switch on. */
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
  // a stale dot is worse than none: with location off the app works from camp or a pin
  useGpsStore.getState().setFix(null)
  useGpsStore.getState().setStatus('off')
}

/** Locate and follow: start the watch, centre on the next fix. */
export function locateAndFollow() {
  if (!useGpsStore.getState().locating) {
    // the beam on the dot: which way the phone faces (iOS asks, from this tap)
    void requestCompass()
    startCompass()
  }
  useGpsStore.getState().setLocating(true)
  useAppStore.getState().setFollow(true)
  startGps()
  const fix = useGpsStore.getState().fix
  if (fix) {
    const { center } = nearestInBounds(fix.lon, fix.lat)
    withMap((m) => m.easeTo({ center, zoom: Math.max(m.getZoom(), 13) }))
  }
}

/** The locate button: off → following, north up → following, heading up
 *  (skipped without a compass) → off; panned away → follow again. The
 *  watch keeps running after off only for a recording. */
export function toggleLocate() {
  const g = useGpsStore.getState()
  if (!g.locating || !useAppStore.getState().follow) return locateAndFollow()
  if (!g.headingUp && useCompass.getState().status === 'on') return g.setHeadingUp(true)
  g.setHeadingUp(false)
  useAppStore.getState().setFollow(false)
  g.setLocating(false)
  stopCompass()
  withMap((m) => m.easeTo({ bearing: 0, duration: 400 }))
  if (!useTrackStore.getState().recordingId) stopGps()
}

/** A track stopped: the watch goes too, unless the locate button is on. */
export function afterRecording() {
  if (!useGpsStore.getState().locating) stopGps()
}
