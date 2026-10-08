import { angleDiff, judgeCall, STRENGTH_RANGE, type Strength, type WindCheck } from './windChecks'

/**
 * The air above the trees, fitted to the checks of a sit.
 *
 * Ten checks in an hour within a few hundred metres are strong evidence of
 * one thing: the wind the forecast feeds the ground model is not the wind
 * that is here. Until 2026-10-08 each check was a patch, pulling the model
 * toward itself within a few hundred metres for half an hour or so, and
 * averaged with the model's own call, so a model saying south and a hunter
 * feeling northeast came out east, a direction the air never took.
 *
 * Here the checks are read the other way round (Gavan, 2026-10-08: "what's
 * the wind doing here, this is the most likely reason"). The forecast wind
 * is the unknown: a turn and a speed ratio on it, the same for the whole
 * neighbourhood. Each candidate is pushed through the ground model at every
 * check's own cell and minute (the probe), so a check in a slot is compared
 * with what the slot would do under that air, a check on the bog with the
 * bog's, and the candidate the checks like best wins, with the forecast as
 * the prior. Every cell near the checks then moves together, consistently,
 * ground never checked included. What is left over at each check is the
 * place's own, which model.ts blends in locally by likeness.
 *
 * The fit is an offset on the forecast, not a direction, so when the
 * forecast veers the field veers with it and the correction carries. It
 * holds for hours after the last check (HOLD_MS), fading, since the
 * forecast's error at a place changes on the forecast's time scale, not a
 * puff's.
 *
 * What a check says about speed is a range, not a number (STRENGTH_RANGE):
 * the powder shows the first second of travel and no more, so "windy" means
 * 13 km/h or anything above it. The speed term is the probability the
 * model's speed falls in the range, never a residual to a midpoint, so a
 * check at the top of the scale can pull the ratio up but never pins it.
 * Under a canopy the speed says as much about the trees' share as about
 * the air above, so it counts half there; direction counts in full.
 *
 * A leave-one-out score says whether it helps: each check scored by the
 * fit made from the others, beside the raw model and the forecast. That is
 * the number the card shows climbing, and it cannot be gamed by fitting a
 * check to itself.
 */

/** What the ground model says at a check's cell and minute under a candidate air. */
export interface Probe {
  kmh: number
  dirFrom: number
  regime: string
  /** the cell is in a stand: the speed there is the canopy's share as much as the air's */
  woods: boolean
}
export type ProbeFn = (c: WindCheck, turn: number, lnRatio: number) => Probe | null
/** The ground model at a check as the map would read it: the other checks blended in and the fit applied by distance and age. */
export type MapProbeFn = (c: WindCheck, others: WindCheck[], fit: AmbientFit | null) => Probe | null

export interface AmbientFit {
  /** degrees to turn the forecast direction, + clockwise */
  turn: number
  /** ln of the ratio on the forecast speed */
  lnRatio: number
  /** the checks' weighted centre */
  lon: number
  lat: number
  /** the checks behind it, weighted by age against the newest */
  n: number
  count: number
  ids: string[]
  firstTs: number
  lastTs: number
  /** the newest check said the wind had held */
  held: boolean
  /** how sharply the checks pin the turn: the posterior's share within ±20° of the best, 0–1 */
  sure: number
  /** how much the checks prefer the fit to the forecast as it stands, nats per check */
  gain: number
  /** all the checks sat under the trees, or all in the open: the speed is only half pinned */
  allWoods: boolean
  allOpen: boolean
}

export interface SitScore {
  n: number
  /** the forecast, where a check carried one */
  forecast: { n: number; agree: number; close: number }
  /** the model before the checks, no fit */
  raw: { agree: number; close: number }
  /** the model with the fit from the other checks */
  fit: { agree: number; close: number }
}

/** A fit's time scale: a check's say fades with this e-folding against the newest check. */
export const FIT_TAU_MS = 2 * 3600_000
/** Checks further apart than this in time are different sits. */
export const SESSION_GAP_MS = 2 * 3600_000
/** Checks further than this from a sit's centre are a different place: the air above may differ. */
export const SESSION_SPAN_M = 3000
/** The fit holds after the last check with this e-folding (twice for a wind that had held). */
export const HOLD_MS = 3 * 3600_000
/** It counts from this long before the first check. */
export const LEAD_MS = 30 * 60_000
/** One air: the forecast's own grid is 2.5 km. The fit's weight falls as a Gaussian with this scale from the checks' centre. */
export const FIT_SCALE_M = 2500
/** A sit's fit uses at most this many checks, the newest. */
export const FIT_MAX_CHECKS = 16

const PRIOR_TURN = 40
const PRIOR_LN_RATIO = 0.45
/** How well a puff's direction is known, by how hard it blew: a creeping
 *  drift wanders (the 60 checks of 2026 at noon went every way at drift),
 *  a breezy one points. Degrees, one sigma. */
const DIR_SIGMA: Record<Strength, number> = { calm: 90, drift: 50, light: 35, breezy: 28, windy: 25 }
const SPEED_SIGMA = Math.log(2)
const COARSE_STEP = 15
const LN_RATIOS = [-0.9, -0.6, -0.3, 0, 0.3, 0.6, 0.9, 1.1]
const LN_RATIO_RANGE: [number, number] = [-1.0, 1.2]

/** The fit is worth applying and saying: two checks or more (one check
 *  patches its own ground through the local blend; it does not move the
 *  air over the whole neighbourhood, which on the 2026 replay cost a hit),
 *  a turn of 8° or a speed off by a fifth, and the checks prefer it to the
 *  forecast by at least e to one per check. */
export function fitMatters(f: AmbientFit | null): f is AmbientFit {
  return !!f && f.count >= 2 && (Math.abs(f.turn) >= 8 || Math.abs(f.lnRatio) >= Math.log(1.2)) && f.gain >= 1
}

/** A check's say in a sit's fit against the sit's newest check: by age, half again for a swing. */
export function fitWeight(c: WindCheck, refTs: number): number {
  const tau = c.held ? 2 * FIT_TAU_MS : FIT_TAU_MS
  return Math.exp(-Math.abs(refTs - c.ts) / tau) * (c.swingDeg ? 0.7 : 1)
}

/** The fit's weight at a spot and moment: full among the checks, a Gaussian off them, fading after the last. */
export function fitWeightAt(f: AmbientFit, lon: number, lat: number, ms: number): number {
  if (ms < f.firstTs - LEAD_MS) return 0
  const hold = f.held ? 2 * HOLD_MS : HOLD_MS
  const fade = Math.exp(-Math.max(0, ms - f.lastTs) / hold)
  const kx = 111_320 * Math.cos((lat * Math.PI) / 180)
  const d = Math.hypot((lon - f.lon) * kx, (lat - f.lat) * 110_574)
  return fade * Math.exp(-((d / FIT_SCALE_M) * (d / FIT_SCALE_M)))
}

/** The sits: felt checks in order, split where more than SESSION_GAP_MS passes or a check is SESSION_SPAN_M from the sit's centre. */
export function sessionsOf(checks: WindCheck[]): WindCheck[][] {
  const felt = checks.filter((c) => !c.seen).sort((a, b) => a.ts - b.ts)
  const out: WindCheck[][] = []
  let cur: WindCheck[] = []
  let cx = 0
  let cy = 0
  for (const c of felt) {
    const last = cur[cur.length - 1]
    if (last) {
      const kx = 111_320 * Math.cos((c.lat * Math.PI) / 180)
      const d = Math.hypot((c.lon - cx / cur.length) * kx, (c.lat - cy / cur.length) * 110_574)
      if (c.ts - last.ts > SESSION_GAP_MS || d > SESSION_SPAN_M) {
        out.push(cur)
        cur = []
        cx = cy = 0
      }
    }
    cur.push(c)
    cx += c.lon
    cy += c.lat
  }
  if (cur.length) out.push(cur)
  return out
}

/** The sit a moment belongs to: the latest one begun by then whose hold has not run out. */
export function sessionAt(sessions: WindCheck[][], ms: number): WindCheck[] | null {
  let best: WindCheck[] | null = null
  for (const s of sessions) {
    const first = s[0].ts
    const last = s[s.length - 1]
    const hold = last.held ? 2 * HOLD_MS : HOLD_MS
    if (ms >= first - LEAD_MS && ms <= last.ts + 2 * hold) best = s
  }
  return best
}

/** The standard normal's cumulative, Abramowitz & Stegun 7.1.26 (good to 1.5e-7). */
function Phi(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z))
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))))
  const erf = 1 - poly * Math.exp(-z * z)
  return 0.5 * (1 + (z < 0 ? -erf : erf))
}

/** How likely the felt direction is under the probe's call: a Gaussian
 *  about it as wide as the puff's strength warrants (plus half the arc of
 *  a swing; 90° when the model calls near calm, which has no direction to
 *  speak of), on a floor of a tenth so one wild check cannot carry the
 *  fit alone. Nothing for a calm check. */
function lnLikeDir(c: WindCheck, p: Probe): number {
  if (c.dirFrom == null || c.strength === 'calm') return 0
  const sig = p.kmh < 1.5 ? 90 : DIR_SIGMA[c.strength] + (c.swingDeg ?? 0) / 2
  const z = angleDiff(c.dirFrom, p.dirFrom) / sig
  return Math.log(0.9 * Math.exp(-0.5 * z * z) + 0.1)
}

/** How likely the model's speed is to fall in the felt range, with a
 *  factor-of-two log-normal error on the model; a floor of 2%. */
function lnLikeSpeed(c: WindCheck, p: Probe): number {
  const [lo, hi] = STRENGTH_RANGE[c.strength]
  const m = Math.log(Math.max(p.kmh, 0.2))
  const upper = hi === Infinity ? 1 : Phi((Math.log(hi) - m) / SPEED_SIGMA)
  const lower = lo <= 0 ? 0 : Phi((Math.log(lo) - m) / SPEED_SIGMA)
  return Math.log(Math.max(upper - lower, 0.02))
}

function lnPrior(turn: number, lnRatio: number): number {
  return -0.5 * (turn / PRIOR_TURN) ** 2 - 0.5 * (lnRatio / PRIOR_LN_RATIO) ** 2
}

const wrap = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180

/**
 * The air the checks like best. `probe` is the ground model at a check's
 * cell and minute under a candidate turn and ratio on the forecast; null
 * where it cannot say (no wind to start from), and that check is skipped.
 * Null with no check that could be probed.
 */
export function fitAmbient(checks: WindCheck[], probe: ProbeFn): AmbientFit | null {
  const sorted = [...checks].sort((a, b) => a.ts - b.ts)
  const use = sorted.slice(-FIT_MAX_CHECKS)
  if (!use.length) return null
  const refTs = use[use.length - 1].ts
  const w = use.map((c) => fitWeight(c, refTs))
  // each check's probe is a function of the candidate alone: the woods flag
  // (half weight on speed) is read at the forecast as it stands
  const woods = use.map((c) => probe(c, 0, 0)?.woods ?? false)
  let anyProbe = false
  const score = (turn: number, lnRatio: number): number => {
    let s = lnPrior(turn, lnRatio)
    for (let k = 0; k < use.length; k++) {
      const p = probe(use[k], turn, lnRatio)
      if (!p) continue
      anyProbe = true
      s += w[k] * (lnLikeDir(use[k], p) + (woods[k] ? 0.5 : 1) * lnLikeSpeed(use[k], p))
    }
    return s
  }
  // the coarse grid, kept for how sure the turn is
  const turns: number[] = []
  for (let t = -180; t < 180; t += COARSE_STEP) turns.push(t)
  const grid = turns.map((t) => LN_RATIOS.map((l) => score(t, l)))
  if (!anyProbe) return null
  let bt = 0
  let bl = 0
  let best = -Infinity
  turns.forEach((t, i) =>
    LN_RATIOS.forEach((l, j) => {
      if (grid[i][j] > best) {
        best = grid[i][j]
        bt = t
        bl = l
      }
    }),
  )
  // refine round the best: 5° and 0.1 steps
  const t0 = bt
  const l0 = bl
  for (let dt = -10; dt <= 10; dt += 5)
    for (let dl = -0.2; dl <= 0.2001; dl += 0.1) {
      const t = wrap(t0 + dt)
      const l = Math.max(LN_RATIO_RANGE[0], Math.min(LN_RATIO_RANGE[1], l0 + dl))
      const s = score(t, l)
      if (s > best) {
        best = s
        bt = t
        bl = l
      }
    }
  // how sure: the posterior over the turn (the ratio summed out), its share within ±20° of the best
  const rowMax = Math.max(...grid.flat())
  let total = 0
  let near = 0
  turns.forEach((t, i) => {
    let m = 0
    for (const v of grid[i]) m += Math.exp(v - rowMax)
    total += m
    if (angleDiff(t, bt) <= 20) near += m
  })
  const base = score(0, 0)
  const n = w.reduce((a, b) => a + b, 0)
  let lon = 0
  let lat = 0
  use.forEach((c, k) => {
    lon += w[k] * c.lon
    lat += w[k] * c.lat
  })
  return {
    turn: Math.round(bt * 10) / 10,
    lnRatio: Math.round(bl * 1000) / 1000,
    lon: lon / n,
    lat: lat / n,
    n,
    count: use.length,
    ids: use.map((c) => c.id),
    firstTs: use[0].ts,
    lastTs: refTs,
    held: !!use[use.length - 1].held,
    sure: total > 0 ? near / total : 0,
    gain: (best - base) / Math.max(1, n),
    allWoods: woods.every(Boolean),
    allOpen: woods.every((x) => !x),
  }
}

/**
 * Each check of a sit scored as the map would read it from the others
 * (leave one out): the fit made from the others, and the others blended in
 * (`asMap`; without it, the fit alone), beside the raw model and the
 * forecast the check carried. A sit of one check has no others to go on,
 * so its score is the raw one.
 */
export function sitScore(checks: WindCheck[], probe: ProbeFn, asMap?: MapProbeFn): SitScore {
  const out: SitScore = { n: 0, forecast: { n: 0, agree: 0, close: 0 }, raw: { agree: 0, close: 0 }, fit: { agree: 0, close: 0 } }
  const sorted = [...checks].sort((a, b) => a.ts - b.ts).slice(-FIT_MAX_CHECKS)
  for (const c of sorted) {
    const raw = probe(c, 0, 0)
    if (!raw) continue
    out.n++
    const others = sorted.filter((o) => o !== c)
    const f = others.length ? fitAmbient(others, probe) : null
    const fw = fitMatters(f) ? fitWeightAt(f, c.lon, c.lat, c.ts) : 0
    const withFit = others.length && asMap ? asMap(c, others, fitMatters(f) ? f : null) : fw > 0 ? probe(c, f!.turn * fw, f!.lnRatio * fw) : raw
    const vr = judgeCall(c, raw)
    const vf = judgeCall(c, withFit ?? raw)
    if (vr === 'agree') out.raw.agree++
    else if (vr === 'close') out.raw.close++
    if (vf === 'agree') out.fit.agree++
    else if (vf === 'close') out.fit.close++
    if (c.forecast) {
      out.forecast.n++
      const v = judgeCall(c, c.forecast)
      if (v === 'agree') out.forecast.agree++
      else if (v === 'close') out.forecast.close++
    }
  }
  return out
}

/** The fit in a sentence: "the air above the trees runs 50° left of the forecast at about half its speed". */
export function fitWords(f: AmbientFit): string {
  const bits: string[] = []
  if (Math.abs(f.turn) >= 8) bits.push(`${Math.round(Math.abs(f.turn))}° ${f.turn > 0 ? 'right' : 'left'} of the forecast`)
  const r = Math.exp(f.lnRatio)
  if (r >= 1.2) bits.push(`${r >= 1.75 ? `about ${r >= 2.5 ? '3' : '2'}×` : `${Math.round((r - 1) * 100)}% over`} its speed`)
  else if (r <= 1 / 1.2) bits.push(`about ${r <= 0.4 ? 'a third' : r <= 0.6 ? 'half' : `${Math.round(r * 100)}%`} of its speed`)
  if (!bits.length) return 'the air above the trees is about what the forecast says'
  return `the air above the trees runs ${bits.join(' at ')}`
}

/** When the fit has faded to a third of itself: the words for "held till". */
export function fitHoldsUntil(f: AmbientFit): number {
  return f.lastTs + (f.held ? 2 : 1) * HOLD_MS
}

/**
 * The puff that would teach the most next, from what this sit's checks
 * cannot yet tell apart. Null when the fit is sharp and the sit is covered.
 */
export function nextPuff(f: AmbientFit | null, count: number): string | null {
  if (!f) return count < 2 ? 'A second puff, 50 m or more from this one, lets the map fit the air here rather than patch it.' : null
  if (f.allWoods) return 'One puff in the open (a bog, a shore, a cutline) would split the air above from the trees’ share: every check so far was under the canopy.'
  if (f.allOpen && count >= 2) return 'One puff under the trees would say how much of this gets in to where you sit: every check so far was in the open.'
  if (f.sure < 0.5 && count >= 2) return 'The checks disagree on the direction: one more puff where you will sit would settle which air you are in.'
  return null
}
