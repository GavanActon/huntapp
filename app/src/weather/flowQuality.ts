import type { Map as MlMap } from 'maplibre-gl'
import { devlog } from '../devlog'

/**
 * One dial for what the motion layers cost.
 *
 * The wind and the sea are the app's face, and Settings says how much of
 * them there is. A phone that can draw all of that at full rate gets exactly
 * that. One that cannot — the helm view pitched over a satellite chart with
 * the run animating, on a hot afternoon — used to get it anyway, at fifteen
 * frames a second with the chart itself stuttering underneath. The dial
 * turns the layers down a step at a time when frames run long, and back up
 * once they have been comfortable for a while, so the steady state on any
 * phone is the most it can carry smoothly. The look at level 0 is the look
 * Settings asked for; nothing here changes it.
 *
 * Level of detail on a pitched chart is the dial's other half. At the helm
 * the boat sits low on the screen and the top is far water — each pixel up
 * there covers many times the lake a pixel by the boat does. The eye reads
 * distance there, not detail, so the far field carries fewer crests and
 * fewer streaks than the near water, at every level.
 */

export interface QualityProfile {
  /** share of the wind particle count Settings asks for */
  particles: number
  /** share of the near-field sea crests drawn */
  near: number
  /** share of the FAR-field sea crests drawn (pitched chart) */
  far: number
  /** device pixels per css px for the wind's trail canvas */
  trailDpr: number
  /** the wind draws every other frame when the chart is still */
  wind30: boolean
}

export const PROFILES: readonly QualityProfile[] = [
  { particles: 1, near: 1, far: 1, trailDpr: 2, wind30: false },
  { particles: 0.75, near: 1, far: 0.6, trailDpr: 2, wind30: false },
  { particles: 0.55, near: 0.85, far: 0.4, trailDpr: 1.5, wind30: true },
  { particles: 0.4, near: 0.7, far: 0.25, trailDpr: 1, wind30: true },
]

// Frames on a 60 Hz phone are 16.7 ms. Sustained past SLOW the phone is
// dropping to forty a second or worse; a good while with no slow frames and
// a fast one now, it has room again. The holds keep the dial from hunting.
//
// Stepping back up used to need an UNBROKEN fast run: one long frame (a
// tile decoding, a sheet opening), a glance that paused the loop, even a
// frame in the middle band started the wait over. In real use something
// like that comes every few seconds, so the dial only ever moved one way
// and the streaks thinned out until the app was restarted. Now only slow
// frames restart the wait, and a step up that turns out to be wrong makes
// the next one wait longer, so a phone that can carry one level less does
// not flip between the two.
const SLOW_MS = 24
const FAST_MS = 18
const SLOW_HOLD_MS = 1500
const FAST_HOLD_MS = 6000
const FAST_HOLD_MAX_MS = 60_000
/** A step up that has stood this long was right: the hold goes back down. */
const STOOD_MS = 20_000

let level = 0
let ema = 16.7
let lastAt = 0
let slowSince = 0
/** the last frame that read slow (or the last step either way) */
let slowAt = 0
/** whether the last step was up, and how long after the last slow frame the next one waits */
let lastUp = false
let upHold = FAST_HOLD_MS
const listeners = new Set<(level: number) => void>()

export function qualityLevel(): number {
  return level
}

export function qualityProfile(): QualityProfile {
  return PROFILES[level]
}

/** Run `cb` whenever the dial moves. Returns the unsubscribe. */
export function onQuality(cb: (level: number) => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function setLevel(l: number, now: number) {
  if (l === level) return
  // stepped up and slow again soon after: the next step up waits longer
  if (l > level && lastUp && now - slowAt < STOOD_MS) upHold = Math.min(FAST_HOLD_MAX_MS, upHold * 2)
  lastUp = l < level
  devlog('flow', `quality ${l > level ? '↓' : '↑'} ${l} · frames ${ema.toFixed(1)} ms · next up after ${upHold / 1000} s`)
  level = l
  slowSince = 0
  slowAt = now
  lastAt = now
  for (const cb of listeners) cb(level)
}

/**
 * An engine reporting how long since its last frame. Every engine reports;
 * the intervals are the same frames, so that is just more samples.
 */
export function reportFrame(dtMs: number, now: number) {
  // a pause — the tab hidden, a gesture that stalled — is not a slow frame
  if (dtMs > 250 || now - lastAt > 250) {
    ema = dtMs > 250 ? ema : dtMs
    lastAt = now
    slowSince = 0
    return
  }
  lastAt = now
  ema += (dtMs - ema) * 0.08
  if (ema > SLOW_MS) {
    slowAt = now
    if (!slowSince) slowSince = now
    else if (now - slowSince > SLOW_HOLD_MS && level < PROFILES.length - 1) setLevel(level + 1, now)
    return
  }
  slowSince = 0
  if (level > 0 && ema < FAST_MS && now - slowAt > upHold) setLevel(level - 1, now)
  else if (lastUp && upHold !== FAST_HOLD_MS && now - slowAt > STOOD_MS) upHold = FAST_HOLD_MS
}

/** Smoothed frame interval, for the report. */
export function frameMs(): number {
  return ema
}

/**
 * How much of the full detail each row of the screen gets, 0..1: all of it
 * from the boat down, less toward the top of a pitched chart. On a flat
 * chart every row is 1. `cy` is the screen row the camera centre — the boat,
 * while following — sits on.
 */
export function lodOf(map: MlMap, h: number): (y: number) => number {
  const pitch = map.getPitch()
  if (pitch < 5) return () => 1
  const cy = Math.min(h, Math.max(1, map.project(map.getCenter()).y))
  // at 50° the top row keeps 30 %; a gentler tilt keeps more
  const drop = 0.7 * Math.min(1, pitch / 50)
  return (y) => (y >= cy ? 1 : 1 - drop * ((cy - y) / cy))
}

/** The average of `lod` over the screen — what share of a flat chart's count
 *  keeps the near field at the same density. */
export function meanLod(lod: (y: number) => number, h: number): number {
  let s = 0
  const n = 16
  for (let i = 0; i < n; i++) s += lod(((i + 0.5) / n) * h)
  return s / n
}
