import { takeHoldFollow } from '../areas/handoff'
import { withMap } from '../map/mapController'
import { useAppStore } from '../state/appStore'
import { followCenter } from '../config'
import { useGpsStore, type Fix } from './gpsStore'
import { requestCompass, startCompass, stopCompass, useCompass } from './compass'
import { FixFilter } from './fixFilter'

/** A geolocation watch: one fix in the store, filtered (fixFilter.ts) so
 *  the dot and the track do not wander with the canopy's multipath, and
 *  the map follows when asked. It runs while the locate button is on and
 *  never on its own: location is the hunter's to switch on. The track
 *  records whenever it runs (trackStore.ts), and the button's state is
 *  remembered so a reload comes back locating with no prompt. */
let watchId: number | null = null
const filter = new FixFilter()

/** Where the locate button's state is kept between loads: '1' on, '0' off. */
const LOCATING_KEY = 'huntapp.locating'

function remember(on: boolean) {
  try {
    localStorage.setItem(LOCATING_KEY, on ? '1' : '0')
  } catch {
    /* storage full or blocked: the button just starts off next time */
  }
}

export function startGps() {
  if (watchId != null) return
  const gps = useGpsStore.getState()
  if (!('geolocation' in navigator)) return gps.setStatus('error', 'no geolocation')
  if (!window.isSecureContext) return gps.setStatus('insecure')
  gps.setStatus('acquiring')
  watchId = navigator.geolocation.watchPosition(
    (p) => {
      const raw: Fix = {
        lon: p.coords.longitude,
        lat: p.coords.latitude,
        accuracy: p.coords.accuracy,
        sogKn: p.coords.speed == null || p.coords.speed < 0 ? null : p.coords.speed * 1.94384,
        cog: p.coords.heading == null || Number.isNaN(p.coords.heading) ? null : p.coords.heading,
        ts: p.timestamp,
      }
      const gps = useGpsStore.getState()
      const { fix, why } = filter.push(raw)
      if (!fix) {
        gps.setDropped({ ...gps.dropped, [why]: gps.dropped[why] + 1 })
        return
      }
      gps.setFix(fix)
      gps.setStatus('on')
      // a fix outside the area is the phone at home: the map stays where it is
      const center = useAppStore.getState().follow ? followCenter(fix.lon, fix.lat) : null
      if (center) withMap((m) => m.easeTo({ center, duration: 500 }))
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
  filter.reset()
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
  remember(true)
  startGps()
  const fix = useGpsStore.getState().fix
  const center = fix ? followCenter(fix.lon, fix.lat) : null
  if (center) withMap((m) => m.easeTo({ center, zoom: Math.max(m.getZoom(), 13) }))
}

/** The locate button: off → following, north up → following, heading up
 *  (skipped without a compass) → off; panned away → follow again. */
export function toggleLocate() {
  const g = useGpsStore.getState()
  if (!g.locating || !useAppStore.getState().follow) return locateAndFollow()
  if (!g.headingUp && useCompass.getState().status === 'on') return g.setHeadingUp(true)
  stopLocating()
}

/** Location off: no follow, north up, and the watch stops (the track with it). */
export function stopLocating() {
  const g = useGpsStore.getState()
  if (!g.locating) return
  g.setHeadingUp(false)
  useAppStore.getState().setFollow(false)
  g.setLocating(false)
  remember(false)
  stopCompass()
  withMap((m) => m.easeTo({ bearing: 0, duration: 400 }))
  stopGps()
}

/**
 * At startup: location comes back on if it was on when the app was last
 * closed (a phone drops a web app it has not looked at for a while). As
 * locateAndFollow, but with no permission prompts: iOS allows those only
 * from a tap, so the compass is started without being asked for.
 */
export function resumeLocation(): void {
  let on = false
  try {
    on = localStorage.getItem(LOCATING_KEY) === '1'
  } catch {
    return
  }
  if (!on || useGpsStore.getState().locating) return
  useGpsStore.getState().setLocating(true)
  // just switched area to a place, or with the fix outside the new box: the
  // map stays on the view the switch opened on, not taken off it by the
  // first fix or dragged to the box's edge by every one (areas/switch.ts)
  useAppStore.getState().setFollow(!takeHoldFollow())
  startCompass()
  startGps()
}

/**
 * Back from the pocket. A phone stops a web app's GPS while the screen is
 * off; after a while away the watch is started afresh, so the next fix is
 * new rather than whatever the phone kept, and the locate button's pulse
 * says the dot is where you were until it comes.
 */
let hiddenAt = 0
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') hiddenAt = Date.now()
  else if (watchId != null && Date.now() - hiddenAt > 30_000) {
    navigator.geolocation.clearWatch(watchId)
    watchId = null
    startGps()
  }
})
