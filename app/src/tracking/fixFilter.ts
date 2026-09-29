import type { Fix } from './gpsStore'

/**
 * The phone's fixes, made fit to draw. Under a canopy a browser's GPS
 * wanders 10–30 m standing still and now and then jumps 50 m and back
 * (multipath off the trunks, a Wi-Fi guess slipped in between satellite
 * fixes), and a track drawn from raw fixes is a scribble around every
 * stand. Three things, in order:
 *
 *  - stale: a fix older than the last one, or one the phone kept from
 *    before the pocket, says nothing about now;
 *  - jumps: a fix far outside what the filter and the fix's own accuracy
 *    allow is held, not drawn. Two more that agree with it and it was a
 *    real move after all (the filter resets there); otherwise it is noise;
 *  - smoothing: a Kalman filter on position (Q metres per second of
 *    wander between fixes), each fix weighted by its accuracy, so a 5 m
 *    fix pulls hard and a 40 m one barely. After a long silence the
 *    wander allowed is large, so the first fix out of a pocket is taken
 *    nearly as it is.
 *
 * The dot, the cone and the track ride the filtered fix; the accuracy
 * ring stays the phone's own figure, since the filter's belief is too
 * sure of itself when the errors run together (a multipath bias drifts
 * over minutes, not per fix). The filter's own spread is `sigma`.
 */

/** metres per second the truth may wander between fixes: walking through bush, with margin */
const Q = 2
/** a fix outside this many sigmas (and farther than JUMP_MIN_M) is held as a possible jump */
const JUMP_SIGMAS = 3.5
const JUMP_MIN_M = 25
/** held fixes this close together (plus their accuracies) are a real move */
const AGREE_M = 20
/** fixes that agree, counting the new one, before a jump is believed */
const HOLD_N = 3
/** a fix this old when it arrives is the phone's memory, not a fix */
const STALE_MS = 20_000

export type DropReason = 'stale' | 'jump'

const KY = 110_574
const kx = (lat: number) => 111_320 * Math.cos((lat * Math.PI) / 180)

export class FixFilter {
  private lon = 0
  private lat = 0
  /** variance of the estimate, m² */
  private v = -1
  private ts = 0
  private held: Fix[] = []

  reset() {
    this.v = -1
    this.ts = 0
    this.held = []
  }

  /** The filtered fix, or null with why the raw one was left out. */
  push(raw: Fix, now = Date.now()): { fix: Fix; why?: undefined } | { fix: null; why: DropReason } {
    if (raw.ts <= this.ts || now - raw.ts > STALE_MS) return { fix: null, why: 'stale' }
    const r2 = raw.accuracy * raw.accuracy
    if (this.v < 0) return { fix: this.take(raw) }

    const dt = (raw.ts - this.ts) / 1000
    const vPred = this.v + Q * Q * dt
    const d = this.metres(raw)
    if (d > Math.max(JUMP_MIN_M, JUMP_SIGMAS * Math.sqrt(vPred + r2))) {
      this.held = [...this.held, raw].slice(-HOLD_N)
      if (this.held.length === HOLD_N && this.agree(this.held)) return { fix: this.take(raw) }
      return { fix: null, why: 'jump' }
    }
    this.held = []

    const k = vPred / (vPred + r2)
    this.lon += k * (raw.lon - this.lon)
    this.lat += k * (raw.lat - this.lat)
    this.v = (1 - k) * vPred
    this.ts = raw.ts
    return { fix: this.out(raw) }
  }

  /** Start over at this fix: the first one, or a jump that turned out real. */
  private take(raw: Fix): Fix {
    this.lon = raw.lon
    this.lat = raw.lat
    this.v = raw.accuracy * raw.accuracy
    this.ts = raw.ts
    this.held = []
    return this.out(raw)
  }

  private out(raw: Fix): Fix {
    return { ...raw, lon: this.lon, lat: this.lat, sigma: Math.sqrt(this.v) }
  }

  private metres(f: Fix): number {
    return Math.hypot((f.lon - this.lon) * kx(this.lat), (f.lat - this.lat) * KY)
  }

  private agree(fs: Fix[]): boolean {
    const lon = fs.reduce((a, f) => a + f.lon, 0) / fs.length
    const lat = fs.reduce((a, f) => a + f.lat, 0) / fs.length
    return fs.every((f) => Math.hypot((f.lon - lon) * kx(lat), (f.lat - lat) * KY) <= AGREE_M + f.accuracy)
  }
}
