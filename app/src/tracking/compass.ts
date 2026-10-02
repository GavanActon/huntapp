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
 *
 * Smoothed by a time constant, not by a gain per event: iOS fires fifty of
 * these a second and other phones a handful, and 0.6 s of lag should feel
 * the same on both. Published on a degree and a half, below which it is the
 * hand, not the hunter turning.
 *
 * Steady: hold the phone up in front of you and iOS's heading comes off the
 * top edge, which is then pointing at the sky — the reading whirls, and so
 * did everything drawn from it. So the raw readings of the last second and
 * a half are kept, the turn in them is fitted and taken out (swinging round
 * on your feet is not the compass whirling) and what wanders about that
 * turn is measured: past 30°, or when iOS calls its own accuracy worse than
 * 60° (it often says 30–50° outdoors with the phone fine), the heading is
 * left where it was and `steady` goes false until the readings have sat
 * inside 15° for a second. A held rose beats a spinning one; after a hard
 * turn it takes a couple of seconds to believe itself again. With no heading
 * yet the first reading is published anyway, unsteady or not: a rose turned
 * roughly the right way beats one stuck at north while the phone settles.
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
  /** the readings are worth believing; while false the heading is held where it was */
  steady: boolean
}

export const useCompass = create<CompassState>(() => ({ heading: null, status: 'off', steady: true }))

type OrientationEvt = DeviceOrientationEvent & { webkitCompassHeading?: number; webkitCompassAccuracy?: number }

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

/** How the reading is smoothed and when it is believed. */
const TAU_S = 0.6
const STEP_DEG = 1.5
const WINDOW_MS = 1500
const WHIRL_DEG = 30
/** iOS's own accuracy figure, degrees, past which the reading is not worth having */
const ACC_BAD_DEG = 60
const SETTLED_DEG = 15
const SETTLED_MS = 1000

let users = 0
let sx = 0
let sy = 0
let timer = 0
let got = false
let last = 0
/** the last WINDOW_MS of raw readings, unwrapped (359 then 1 reads as 361) */
let raw: { t: number; u: number }[] = []
let lastDeg = 0
let lastU = 0
/** when the spread last came back inside SETTLED_DEG */
let calmSince = 0

function onEvent(e: OrientationEvt) {
  let mag: number | null = null
  let acc: number | null = null
  if (typeof e.webkitCompassHeading === 'number' && !Number.isNaN(e.webkitCompassHeading)) {
    // iOS: already tilt-compensated; the screen may be turned
    mag = e.webkitCompassHeading + ((screen.orientation?.angle as number | undefined) ?? 0)
    if (typeof e.webkitCompassAccuracy === 'number') acc = e.webkitCompassAccuracy
  } else if (e.absolute && e.alpha != null && e.beta != null && e.gamma != null) {
    mag = fromEuler(e.alpha, e.beta, e.gamma)
  }
  if (mag == null) return
  const deg = mag + DECLINATION
  const h = deg * rad
  const t = Number.isFinite(e.timeStamp) && e.timeStamp > 0 ? e.timeStamp : performance.now()
  // smooth on the unit circle, so 359° and 1° average to north, not south
  const k = got ? 1 - Math.exp(-Math.max(0, t - last) / 1000 / TAU_S) : 1
  last = t
  sx += (Math.sin(h) - sx) * k
  sy += (Math.cos(h) - sy) * k
  got = true

  const u = raw.length ? lastU + ((((deg - lastDeg + 540) % 360) + 360) % 360) - 180 : deg
  lastDeg = deg
  lastU = u
  raw.push({ t, u })
  while (raw.length > 1 && t - raw[0].t > WINDOW_MS) raw.shift()
  // how much the readings wander over the window, with the turn taken out:
  // a hunter swinging round on his feet is not a compass whirling, so the
  // window's steady turn is fitted and what is left over is measured
  // against it, in degrees
  let spread = 0
  if (raw.length >= 5) {
    const n = raw.length
    const t0 = raw[0].t
    let st = 0
    let su = 0
    let stt = 0
    let stu = 0
    for (const r of raw) {
      const dt = r.t - t0
      st += dt
      su += r.u
      stt += dt * dt
      stu += dt * r.u
    }
    const den = n * stt - st * st
    const slope = den > 1e-6 ? (n * stu - st * su) / den : 0
    const base = (su - slope * st) / n
    let v = 0
    for (const r of raw) {
      const off = r.u - (base + slope * (r.t - t0))
      v += off * off
    }
    spread = Math.sqrt(v / n)
  }
  const bad = acc != null && (acc < 0 || acc > ACC_BAD_DEG)
  const st = useCompass.getState()
  let steady = st.steady
  if (spread > WHIRL_DEG || bad) {
    steady = false
    calmSince = 0
  } else if (!steady) {
    if (spread < SETTLED_DEG) {
      if (!calmSince) calmSince = t
      if (t - calmSince >= SETTLED_MS) steady = true
    } else calmSince = 0
  }

  const patch: Partial<CompassState> = {}
  if (st.status !== 'on') patch.status = 'on'
  if (st.steady !== steady) patch.steady = steady
  if (steady || st.heading == null) {
    const heading = (Math.atan2(sx, sy) / rad + 360) % 360
    if (st.heading == null || Math.abs(((heading - st.heading + 540) % 360) - 180) > STEP_DEG) patch.heading = heading
  }
  if (Object.keys(patch).length) useCompass.setState(patch)
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
  raw = []
  calmSince = 0
  useCompass.setState({ status: useCompass.getState().status === 'denied' ? 'denied' : 'waiting', steady: true })
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
  raw = []
  useCompass.setState({ heading: null, status: useCompass.getState().status === 'denied' ? 'denied' : 'off', steady: true })
}
