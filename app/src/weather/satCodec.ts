/**
 * Weather by satellite: the newest HRDPS hours for a camp, packed into one
 * text message (160 characters), and read back. The phone asks with a line
 * it writes (satRequest), sent from an inReach or an iPhone on satellite to
 * the Groundwind number; the server (site/satbot.js) answers with a short
 * line a person can read and a code the app takes in (weather/satForecast.ts).
 * Both sides use this file, so it imports nothing.
 *
 * The code, `GW1.` and letters and digits only (nothing a satellite
 * gateway or a text message could mangle), is bits:
 *
 *   header   the first hour (UTC), the run's age, the hours, the camp's hash
 *   wind     the 10 m wind as the east/north vector at its turning points:
 *            a day's wind is smooth, so about a dozen knots carry it, the
 *            phone drawing straight lines between them (1.5 km/h; checked on
 *            twelve days of camp HRDPS: 2.6° and 0.4 km/h off on average,
 *            far inside the forecast's own error)
 *   blocks   every six hours, three bits each: the gust factor, the 80 m
 *            over 10 m wind (the shear the layering needs), the ensemble's
 *            direction spread
 *   air      2 m temperature, the 80 m-over-2 m potential temperature
 *            difference, cloud and rain, each as turning points
 *   check    12 bits: a reply cut short or garbled reads as such, not as a
 *            wrong forecast
 *
 * Steps and deltas are Rice-coded, the parameter picked per stream. Sending
 * only the change from the phone's older copy was tried and is no smaller
 * (the change is choppier than the forecast), so a reply stands alone.
 */

export const SAT_TAG = 'GW1'
const ALPHA = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const HOUR_MS = 3_600_000
const EPOCH_H = Date.UTC(2026, 0, 1) / HOUR_MS
/** The most hours a reply can hold (7 bits). HRDPS itself runs 48. */
export const SAT_MAX_HOURS = 127

export interface SatHours {
  /** the first hour, UTC ms, on the hour */
  startMs: number
  /** the HRDPS run the hours are from, UTC ms */
  runMs: number
  /** which camp they are for (satPointHash) */
  pointHash: number
  windKmh: number[]
  /** blowing FROM, degrees */
  windDir: number[]
  gustKmh: number[]
  tempC: number[]
  t80C: number[]
  w80Kmh: number[]
  cloudPct: number[]
  precipMm: number[]
  /** the GEPS ensemble's direction spread, degrees; null where unknown */
  ensDirSd: (number | null)[]
}

// ---------------------------------------------------------------- the request

/** What the phone sends: the camp (3 decimals, about 100 m) and the hours. */
export function satRequest(lat: number, lon: number, hours: number): string {
  return `${SAT_TAG} ${lat.toFixed(3)} ${lon.toFixed(3)} ${Math.round(hours)}`
}

/** A request read from a text, junk and all (a message's signature, a link). */
export function readSatRequest(text: string): { lat: number; lon: number; hours: number } | null {
  const m = /\bGW1?\s+(-?\d{1,2}(?:\.\d+)?)[\s,]+(-?\d{1,3}(?:\.\d+)?)(?:\s+(\d{1,3}))?/i.exec(text)
  if (!m) return null
  const lat = Number(m[1])
  const lon = Number(m[2])
  if (!(Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) return null
  const hours = m[3] ? Math.min(SAT_MAX_HOURS, Math.max(1, Number(m[3]))) : 48
  return { lat, lon, hours }
}

/** The camp a reply is for, as 8 bits of its request's coordinates: a reply
 *  pasted into the wrong area is caught. */
export function satPointHash(lat: number, lon: number): number {
  return fnv(`${Math.round(lat * 1000)},${Math.round(lon * 1000)}`) & 0xff
}

// ---------------------------------------------------------------- bits

function fnv(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

class BitWriter {
  s = ''
  put(v: number, n: number) {
    if (v < 0 || v >= 2 ** n || !Number.isInteger(v)) throw new Error(`satCodec: ${v} in ${n} bits`)
    this.s += v.toString(2).padStart(n, '0')
  }
  rice(v: number, k: number) {
    const z = zig(v)
    this.s += '1'.repeat(z >>> k) + '0'
    if (k) this.s += (z & ((1 << k) - 1)).toString(2).padStart(k, '0')
  }
}

class BitReader {
  i = 0
  s: string
  constructor(s: string) {
    this.s = s
  }
  get(n: number): number {
    if (this.i + n > this.s.length) throw new Error('cut')
    const v = parseInt(this.s.slice(this.i, this.i + n), 2)
    this.i += n
    return v
  }
  rice(k: number): number {
    let q = 0
    for (;;) {
      if (this.i >= this.s.length) throw new Error('cut')
      if (this.s[this.i++] === '0') break
      if (++q > 4096) throw new Error('cut')
    }
    const z = (q << k) | (k ? this.get(k) : 0)
    return unzig(z)
  }
}

const zig = (n: number) => (n >= 0 ? 2 * n : -2 * n - 1)
const unzig = (z: number) => (z & 1 ? -(z + 1) / 2 : z / 2)
function riceCost(vals: number[], k: number): number {
  let c = 0
  for (const v of vals) c += (zig(v) >>> k) + 1 + k
  return c
}
function bestK(vals: number[]): number {
  let best = 0
  for (let k = 1; k < 8; k++) if (riceCost(vals, k) < riceCost(vals, best)) best = k
  return best
}

function toB62(bits: string): string {
  let v = BigInt('0b1' + bits)
  let s = ''
  while (v > 0n) {
    s = ALPHA[Number(v % 62n)] + s
    v /= 62n
  }
  return s
}

function fromB62(s: string): string | null {
  let v = 0n
  for (const c of s) {
    const d = ALPHA.indexOf(c)
    if (d < 0) return null
    v = v * 62n + BigInt(d)
  }
  const b = v.toString(2)
  return b[0] === '1' ? b.slice(1) : null
}

// ---------------------------------------------------------------- turning points

/** Knot indices so straight lines between knots stay within tol of every hour. */
function rdp(series: number[][], tol: number): number[] {
  const n = series.length
  const keep = new Set([0, n - 1])
  const rec = (a: number, b: number) => {
    let worst = -1
    let wi = -1
    for (let i = a + 1; i < b; i++) {
      const f = (i - a) / (b - a)
      let e = 0
      for (let d = 0; d < series[0].length; d++) {
        const v = series[a][d] + (series[b][d] - series[a][d]) * f
        e += (series[i][d] - v) ** 2
      }
      if (e > worst) {
        worst = e
        wi = i
      }
    }
    if (wi >= 0 && Math.sqrt(worst) > tol) {
      keep.add(wi)
      rec(a, wi)
      rec(wi, b)
    }
  }
  if (n > 1) rec(0, n - 1)
  return [...keep].sort((x, y) => x - y)
}

/** A series (hours × dims) written as its turning points, values in steps of q. */
function putKnots(w: BitWriter, series: number[][], q: number, tol: number) {
  const ks = rdp(series, tol)
  const dims = series[0].length
  const qv = ks.map((k) => series[k].map((x) => Math.round(x / q)))
  const dts = ks.slice(1).map((k, j) => k - ks[j] - 1)
  const cols: number[][] = []
  for (let d = 0; d < dims; d++) cols.push(qv.map((v, j) => (j ? v[d] - qv[j - 1][d] : v[d])))
  const kt = bestK(dts)
  const kd = cols.map(bestK)
  w.put(kt, 3)
  for (const k of kd) w.put(k, 3)
  for (let d = 0; d < dims; d++) w.rice(cols[d][0], kd[d])
  for (let j = 1; j < ks.length; j++) {
    w.rice(dts[j - 1], kt)
    for (let d = 0; d < dims; d++) w.rice(cols[d][j], kd[d])
  }
}

/** The series back, hour by hour, from its turning points. */
function getKnots(r: BitReader, n: number, dims: number, q: number): number[][] {
  const kt = r.get(3)
  const kd: number[] = []
  for (let d = 0; d < dims; d++) kd.push(r.get(3))
  let cur: number[] = []
  for (let d = 0; d < dims; d++) cur.push(r.rice(kd[d]))
  const knots: { i: number; v: number[] }[] = [{ i: 0, v: cur }]
  let at = 0
  while (at < n - 1) {
    at += r.rice(kt) + 1
    if (at > n - 1 || at < 1) throw new Error('cut')
    cur = cur.map((x, d) => x + r.rice(kd[d]))
    knots.push({ i: at, v: cur })
  }
  const out: number[][] = []
  for (let j = 0; j + 1 < knots.length; j++) {
    const a = knots[j]
    const b = knots[j + 1]
    for (let i = a.i; i < b.i; i++) {
      const f = (i - a.i) / (b.i - a.i)
      out.push(a.v.map((x, d) => (x + (b.v[d] - x) * f) * q))
    }
  }
  out.push(knots[knots.length - 1].v.map((x) => x * q))
  return out
}

// ---------------------------------------------------------------- six-hour blocks

const GUST_LV = [1.0, 1.2, 1.4, 1.6, 1.8, 2.1, 2.5, 3.0]
const SHEAR_LV = [1.0, 1.3, 1.6, 2.0, 2.5, 3.2, 4.0, 5.0]
/** the last step is "unknown" */
const ENS_LV = [5, 10, 15, 20, 30, 45, 70]

function nearest(levels: number[], v: number): number {
  let best = 0
  for (let i = 1; i < levels.length; i++) if (Math.abs(levels[i] - v) < Math.abs(levels[best] - v)) best = i
  return best
}

function blockMeans(vals: (number | null)[], n: number): (number | null)[] {
  const out: (number | null)[] = []
  for (let b = 0; b * 6 < n; b++) {
    const xs = vals.slice(b * 6, Math.min(n, b * 6 + 6)).filter((v): v is number => v != null && Number.isFinite(v))
    out.push(xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null)
  }
  return out
}

/** Block values back to hours, linear between the blocks' middles. */
function unblock(blocks: number[], n: number): number[] {
  const mid = (b: number) => b * 6 + 2.5
  const out: number[] = []
  for (let i = 0; i < n; i++) {
    let b = Math.floor((i - 2.5) / 6)
    if (b < 0) b = 0
    if (b >= blocks.length - 1) {
      out.push(blocks[blocks.length - 1])
      continue
    }
    const f = Math.min(1, Math.max(0, (i - mid(b)) / 6))
    out.push(blocks[b] + (blocks[b + 1] - blocks[b]) * f)
  }
  return out
}

// ---------------------------------------------------------------- encode / decode

const RAD = Math.PI / 180
const DTHETA_K = 0.0098 * 78

/** The code for these hours: `GW1.` and the packed bits. */
export function encodeSatHours(h: SatHours): string {
  const n = h.windKmh.length
  if (n < 1 || n > SAT_MAX_HOURS) throw new Error(`satCodec: ${n} hours`)
  const w = new BitWriter()
  w.put(Math.round(h.startMs / HOUR_MS) - EPOCH_H, 20)
  w.put(Math.min(63, Math.max(0, Math.round((h.startMs - h.runMs) / HOUR_MS))), 6)
  w.put(n, 7)
  w.put(h.pointHash & 0xff, 8)
  // the wind: the vector it moves toward, east and north
  const wind = h.windKmh.map((s, i) => [-s * Math.sin(h.windDir[i] * RAD), -s * Math.cos(h.windDir[i] * RAD)])
  putKnots(w, wind, 1, 1.5)
  const gf = blockMeans(
    h.gustKmh.map((g, i) => Math.min(3, Math.max(1, g / Math.max(1, h.windKmh[i])))),
    n,
  )
  const sh = blockMeans(
    h.w80Kmh.map((v, i) => v / Math.max(3, h.windKmh[i])),
    n,
  )
  const ens = blockMeans(h.ensDirSd, n)
  for (let b = 0; b < gf.length; b++) {
    w.put(nearest(GUST_LV, gf[b] ?? 1), 3)
    w.put(nearest(SHEAR_LV, sh[b] ?? 1.8), 3)
    w.put(ens[b] == null ? 7 : nearest(ENS_LV, ens[b]!), 3)
  }
  putKnots(w, h.tempC.map((t) => [t]), 1, 1.0)
  putKnots(w, h.tempC.map((t, i) => [h.t80C[i] - t + DTHETA_K]), 0.5, 0.6)
  putKnots(w, h.cloudPct.map((c) => [c]), 12.5, 15)
  putKnots(w, h.precipMm.map((p) => [p]), 0.25, 0.2)
  w.put(fnv(w.s) & 0xfff, 12)
  return `${SAT_TAG}.${toB62(w.s)}`
}

export type SatDecode = { ok: true; hours: SatHours } | { ok: false; why: 'none' | 'cut' | 'version' }

/** A reply read from a text, whatever else came with it (the readable
 *  line, a messenger's signature). */
export function decodeSatReply(text: string): SatDecode {
  const m = /GW(\d+)\.([0-9A-Za-z]{6,})/.exec(text)
  if (!m) return { ok: false, why: 'none' }
  if (m[1] !== SAT_TAG.slice(2)) return { ok: false, why: 'version' }
  const bits = fromB62(m[2])
  if (!bits || bits.length < 12) return { ok: false, why: 'cut' }
  const body = bits.slice(0, -12)
  if ((fnv(body) & 0xfff) !== parseInt(bits.slice(-12), 2)) return { ok: false, why: 'cut' }
  try {
    const r = new BitReader(body)
    const startMs = (r.get(20) + EPOCH_H) * HOUR_MS
    const runMs = startMs - r.get(6) * HOUR_MS
    const n = r.get(7)
    const pointHash = r.get(8)
    if (n < 1) return { ok: false, why: 'cut' }
    const wind = getKnots(r, n, 2, 1)
    const gf: number[] = []
    const sh: number[] = []
    const ens: (number | null)[] = []
    for (let b = 0; b * 6 < n; b++) {
      gf.push(GUST_LV[r.get(3)])
      sh.push(SHEAR_LV[r.get(3)])
      const e = r.get(3)
      ens.push(e === 7 ? null : ENS_LV[e])
    }
    const t2 = getKnots(r, n, 1, 1).map((v) => v[0])
    const dth = getKnots(r, n, 1, 0.5).map((v) => v[0])
    const cloud = getKnots(r, n, 1, 12.5).map((v) => v[0])
    const precip = getKnots(r, n, 1, 0.25).map((v) => v[0])
    const windKmh = wind.map(([u, v]) => Math.hypot(u, v))
    const windDir = wind.map(([u, v]) => ((Math.atan2(-u, -v) / RAD) % 360 + 360) % 360)
    const gfH = unblock(gf, n)
    const shH = unblock(sh, n)
    // the spread known only in some blocks: hours in an unknown one stay unknown
    const ensKnown = ens.every((e) => e != null)
    const ensH = ensKnown ? unblock(ens as number[], n) : Array.from({ length: n }, (_, i) => ens[Math.floor(i / 6)])
    return {
      ok: true,
      hours: {
        startMs,
        runMs,
        pointHash,
        windKmh,
        windDir,
        gustKmh: windKmh.map((s, i) => Math.max(s, s * gfH[i])),
        tempC: t2,
        t80C: t2.map((t, i) => t + dth[i] - DTHETA_K),
        w80Kmh: windKmh.map((s, i) => Math.max(3, s) * shH[i]),
        cloudPct: cloud.map((c) => Math.min(100, Math.max(0, c))),
        precipMm: precip.map((p) => Math.max(0, p)),
        ensDirSd: ensH,
      },
    }
  } catch {
    return { ok: false, why: 'cut' }
  }
}

// ---------------------------------------------------------------- the reply

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
const compass8 = (deg: number) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8]
const turn = (a: number, b: number) => Math.abs(((b - a + 540) % 360) - 180)

/** A clock hour as a text reads it: 6a, 12p, 3p. */
function clock(ms: number, offsetSec: number): string {
  const h = new Date(ms + offsetSec * 1000).getUTCHours()
  return `${h % 12 || 12}${h < 12 ? 'a' : 'p'}`
}

function windWords(h: SatHours, i: number): string {
  const s = Math.round(h.windKmh[i])
  if (s < 3) return 'calm'
  const g = Math.round(h.gustKmh[i])
  return `${compass8(h.windDir[i])} ${s}${g >= s + 8 ? `g${g}` : ''}`
}

/**
 * The line a person reads on the inReach's screen, plain letters only (one
 * character outside the texting alphabet halves what a text holds): the
 * wind now, its first big change in the next day, and the first rain.
 * `short` is the wind now alone.
 */
export function satSummary(h: SatHours, offsetSec: number, short = false): string {
  const n = h.windKmh.length
  const parts = [windWords(h, 0)]
  if (short) return parts[0]
  for (let i = 1; i < Math.min(n, 24); i++) {
    const a = h.windKmh[0]
    const b = h.windKmh[i]
    const veer = Math.max(a, b) >= 5 && turn(h.windDir[0], h.windDir[i]) >= 45
    if (veer || Math.abs(b - a) >= 10) {
      parts.push(`${windWords(h, i)} by ${clock(h.startMs + i * HOUR_MS, offsetSec)}`)
      break
    }
  }
  const wet = (i: number) => h.precipMm[i] >= 0.2
  for (let i = 0; i < Math.min(n, 24); i++) {
    if (!wet(i)) continue
    let j = i
    while (j + 1 < n && wet(j + 1)) j++
    const what = h.tempC[i] <= 0.5 ? 'snow' : 'rain'
    parts.push(`${what} ${clock(h.startMs + i * HOUR_MS, offsetSec)}-${clock(h.startMs + (j + 1) * HOUR_MS, offsetSec)}`)
    break
  }
  return parts.join(', ')
}

/** The first n hours of a forecast. */
export function satSlice(h: SatHours, n: number): SatHours {
  return {
    ...h,
    windKmh: h.windKmh.slice(0, n),
    windDir: h.windDir.slice(0, n),
    gustKmh: h.gustKmh.slice(0, n),
    tempC: h.tempC.slice(0, n),
    t80C: h.t80C.slice(0, n),
    w80Kmh: h.w80Kmh.slice(0, n),
    cloudPct: h.cloudPct.slice(0, n),
    precipMm: h.precipMm.slice(0, n),
    ensDirSd: h.ensDirSd.slice(0, n),
  }
}

/** The whole reply: the readable line and the code, as many hours as fit
 *  in one text (down in six-hour steps), the line shortened before the
 *  hours go below a day. */
export function satReply(h: SatHours, offsetSec: number, maxLen = 160): string {
  const n = h.windKmh.length
  const fit = (k: number, line: string | null) => {
    const code = encodeSatHours(satSlice(h, k))
    const text = line ? `${line} ${code}` : code
    return text.length <= maxLen ? text : null
  }
  // with the line: all of it, then six hours fewer at a time, down to a day
  const ks: number[] = []
  for (let k = n; k > 24; k -= 6) ks.push(k)
  ks.push(Math.min(n, 24))
  for (const k of ks) {
    const got = fit(k, satSummary(h, offsetSec)) ?? fit(k, satSummary(h, offsetSec, true))
    if (got) return got
  }
  // the code alone
  for (let k = Math.min(n, 24); k >= 1; k = k > 6 ? k - 6 : k - 1) {
    const got = fit(k, null)
    if (got) return got
  }
  return ''
}
