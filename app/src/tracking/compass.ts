import { create } from 'zustand'

/**
 * The phone's compass: which way it is pointing, true north, smoothed.
 * One reading for everything that needs it (the beam on the position dot,
 * a heading-up map, the wind check's rose), started while something is
 * using it and stopped when nothing is.
 *
 * Where it points: the top edge of the phone while it is held flat-ish,
 * the back (the camera's way) once it is held up; tilt-compensated either
 * way. iOS gives its own tilt-compensated heading (webkitCompassHeading);
 * elsewhere it comes from the absolute orientation's alpha, beta, gamma.
 * Both are magnetic, so the local declination is added.
 *
 * iOS asks permission, and only from a tap: request() must be called from
 * a click handler before start() gets anything there.
 */

/** Magnetic declination at the camp, degrees (west negative). WMM2025
 *  gives about −6° here in 2026 (drifting ~0.1°/yr); a degree off is
 *  nothing against a 45° wind sector. */
const DECLINATION = -6

export type CompassStatus = 'off' | 'waiting' | 'on' | 'denied' | 'none'

interface CompassState {
  /** true heading of the phone, degrees clockwise from north; null until read */
  heading: number | null
  status: CompassStatus
}

export const useCompass = create<CompassState>(() => ({ heading: null, status: 'off' }))

type OrientationEvt = DeviceOrientationEvent & { webkitCompassHeading?: number }

const rad = Math.PI / 180

/** Magnetic heading from alpha/beta/gamma: the top edge when flat, the back when held up. */
function fromEuler(alpha: number, beta: number, gamma: number): number | null {
  const a = alpha * rad
  const b = beta * rad
  const g = gamma * rad
  // the top edge (device y) in the world, horizontal part
  const tx = -Math.sin(a) * Math.cos(b)
  const ty = Math.cos(a) * Math.cos(b)
  // the back of the phone (device −z) in the world, horizontal part
  const bx = -Math.cos(a) * Math.sin(g) - Math.sin(a) * Math.sin(b) * Math.cos(g)
  const by = -Math.sin(a) * Math.sin(g) + Math.cos(a) * Math.sin(b) * Math.cos(g)
  const [x, y] = Math.hypot(tx, ty) >= Math.hypot(bx, by) ? [tx, ty] : [bx, by]
  if (Math.hypot(x, y) < 1e-3) return null
  return (Math.atan2(x, y) / rad + 360) % 360
}

let users = 0
let sx = 0
let sy = 0
let timer = 0
let got = false

function onEvent(e: OrientationEvt) {
  let mag: number | null = null
  if (typeof e.webkitCompassHeading === 'number' && !Number.isNaN(e.webkitCompassHeading)) {
    // iOS: already tilt-compensated; the screen may be turned
    mag = e.webkitCompassHeading + ((screen.orientation?.angle as number | undefined) ?? 0)
  } else if (e.absolute && e.alpha != null && e.beta != null && e.gamma != null) {
    mag = fromEuler(e.alpha, e.beta, e.gamma)
  }
  if (mag == null) return
  const h = mag + DECLINATION
  // smooth on the unit circle, so 359° and 1° average to north, not south
  const k = got ? 0.25 : 1
  sx += (Math.sin(h * rad) - sx) * k
  sy += (Math.cos(h * rad) - sy) * k
  got = true
  const heading = (Math.atan2(sx, sy) / rad + 360) % 360
  const prev = useCompass.getState().heading
  // a fifth of a degree is below anything drawn: spare the re-renders
  if (prev == null || Math.abs(((heading - prev + 540) % 360) - 180) > 0.2 || useCompass.getState().status !== 'on') useCompass.setState({ heading, status: 'on' })
}

/** Ask for the compass (iOS needs this from a tap). Resolves false when refused. */
export async function requestCompass(): Promise<boolean> {
  if (!('DeviceOrientationEvent' in window)) {
    useCompass.setState({ status: 'none' })
    return false
  }
  const DOE = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> }
  if (!DOE.requestPermission) return true
  try {
    const ok = (await DOE.requestPermission()) === 'granted'
    if (!ok) useCompass.setState({ status: 'denied' })
    return ok
  } catch {
    useCompass.setState({ status: 'denied' })
    return false
  }
}

/** Start listening (counted: every start needs its stop). */
export function startCompass() {
  users++
  if (users > 1) return
  got = false
  useCompass.setState({ status: useCompass.getState().status === 'denied' ? 'denied' : 'waiting' })
  window.addEventListener('deviceorientationabsolute', onEvent as EventListener)
  window.addEventListener('deviceorientation', onEvent as EventListener)
  // nothing after a few seconds: this phone or browser has no compass for us
  timer = window.setTimeout(() => {
    if (!got && useCompass.getState().status === 'waiting') useCompass.setState({ status: 'none' })
  }, 3000)
}

export function stopCompass() {
  if (users === 0) return
  users--
  if (users > 0) return
  window.clearTimeout(timer)
  window.removeEventListener('deviceorientationabsolute', onEvent as EventListener)
  window.removeEventListener('deviceorientation', onEvent as EventListener)
  useCompass.setState({ heading: null, status: useCompass.getState().status === 'denied' ? 'denied' : 'off' })
}
