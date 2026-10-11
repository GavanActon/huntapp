import { devlog, devlogOn } from '../devlog'
import type { Fix } from './gpsStore'
import type { FixFilter } from './fixFilter'

/**
 * The GPS in the dev log: what the phone sent and what the dot did with it,
 * for a dot that jumps about (indoors the phone mixes Wi-Fi guesses that
 * own to 30-65 m with satellite fixes that claim 5 m and are tens of metres
 * out). Not a line a fix, which would run the log over in twenty minutes:
 * the events worth seeing as they happen, and a line a minute that adds the
 * rest up. Distances only, metres from the dot; the log's other lines
 * already say where. Nothing at all while the log is off.
 *
 *   moved 23 m · ±8 m fix 31 m out         the dot stepped (10 m or more)
 *   held ±8 m 64 m out                     a fix too far to believe yet
 *   jump taken 58 m · ±10 m                three such fixes agreed: the dot went
 *   first fix ±65 m · 2.1 s after start    a watch's first
 *   minute · 58 fixes ±5-65 (12) · spread 23 m · dot 4 moves 61 m · held 3 · stale 0
 */

const KY = 110_574
const kx = (lat: number) => 111_320 * Math.cos((lat * Math.PI) / 180)
const metres = (a: { lon: number; lat: number }, b: { lon: number; lat: number }) =>
  Math.hypot((a.lon - b.lon) * kx(a.lat), (a.lat - b.lat) * KY)

/** a step of the dot this long is a line of its own */
const STEP_M = 10
const MINUTE_MS = 60_000

let dot: { lon: number; lat: number } | null = null
let startedAt = 0
let firstSeen = false
// the minute's tally
let since = 0
let n = 0
let accs: number[] = []
let raws: { lon: number; lat: number }[] = []
let moves = 0
let movedM = 0
let held = 0
let stale = 0

const r = (m: number) => Math.round(m)

/** A watch started (or restarted out of the pocket). */
export function gpsLogStart(why: string): void {
  dot = null
  startedAt = Date.now()
  firstSeen = false
  if (devlogOn()) devlog('gps', `watch on · ${why}`)
}

/** Every fix the phone sends, with what the filter made of it. */
export function gpsLogFix(raw: Fix, fix: Fix | null, filter: FixFilter): void {
  if (!devlogOn()) return
  const now = Date.now()
  if (!since) since = now
  n++
  accs.push(raw.accuracy)
  raws.push({ lon: raw.lon, lat: raw.lat })
  const out = dot ? metres(raw, dot) : 0
  if (!firstSeen && fix) {
    firstSeen = true
    devlog('gps', `first fix ±${r(raw.accuracy)} m · ${((now - startedAt) / 1000).toFixed(1)} s after start`)
  }
  if (filter.last === 'held') {
    held++
    devlog('gps', `held ±${r(raw.accuracy)} m ${r(out)} m out`)
  } else if (filter.last === 'stale') stale++
  else if (filter.last === 'jumpTaken') devlog('gps', `jump taken ${r(out)} m · ±${r(raw.accuracy)} m`)
  if (fix) {
    if (dot) {
      const step = metres(fix, dot)
      if (step > 0.5) {
        moves++
        movedM += step
        if (step >= STEP_M && filter.last !== 'jumpTaken') devlog('gps', `moved ${r(step)} m · ±${r(raw.accuracy)} m fix ${r(out)} m out`)
      }
    }
    dot = { lon: fix.lon, lat: fix.lat }
  }
  if (now - since >= MINUTE_MS) summary(now)
}

function summary(now: number) {
  const sorted = accs.slice().sort((a, b) => a - b)
  const med = sorted[sorted.length >> 1] ?? 0
  // how far the raw fixes scatter about their own mean: still, this is the noise the dot has to ride out
  const lon = raws.reduce((a, p) => a + p.lon, 0) / (raws.length || 1)
  const lat = raws.reduce((a, p) => a + p.lat, 0) / (raws.length || 1)
  const spread = raws.length ? Math.sqrt(raws.reduce((a, p) => a + metres(p, { lon, lat }) ** 2, 0) / raws.length) : 0
  devlog(
    'gps',
    `${r((now - since) / 1000)} s · ${n} fixes ±${r(sorted[0] ?? 0)}-${r(sorted[sorted.length - 1] ?? 0)} (${r(med)}) · spread ${r(spread)} m · dot ${moves} moves ${r(movedM)} m · held ${held} · stale ${stale}`,
  )
  since = now
  n = 0
  accs = []
  raws = []
  moves = 0
  movedM = 0
  held = 0
  stale = 0
}

/** Location off: the part-minute tallied, so the log ends on what it saw. */
export function gpsLogStop(): void {
  if (devlogOn() && n) summary(Date.now())
  since = 0
  if (devlogOn()) devlog('gps', 'watch off')
}
