import { angleDiff, judgeCall, puffBoost, STRENGTH_RANGE, type Seen, type Strength, type WindCheck } from './windChecks'

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
 * The treetops seen moving join the fit too (2026-10-11). They are the air
 * above the trees itself, so their probe is the 10 m wind the ground model
 * starts from, not the head-height air, and they pin the turn directly.
 * Where they agree with the forecast and a check at the ground does not,
 * the turn stays near nothing and the miss stays the place's own: the
 * Searchmont valley floor ran from 308° at dusk under a 152° forecast while
 * the treetops 500 m off showed 180°, a rotor in the valley, not a wrong
 * forecast to turn the whole neighbourhood by.
 *
 * Where the model has cold air draining at a check, how strong that drainage
 * is joins the fit too (2026-10-16): the drainage's speed is the least sure
 * number in an evening's call, and whether it or the wind wins decides the
 * cone's way (Gavan's Lac Bailey spot: the model drained it NE, PALM and the
 * forecast's NW wind took it SE). A turn on the forecast cannot say that, so
 * a weight on the drainage is tried at the best turn and ratio, with a wide
 * prior about the model's own; a dusk check that feels the wind and not the
 * slope turns the drainage down round the sit, one that feels the slope
 * turns it up.
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
  /** the cold air's drainage in the call, km/h (none where it is not draining) */
  drain?: number
}
export type ProbeFn = (c: WindCheck, turn: number, lnRatio: number, lnDrain?: number) => Probe | null
/** The ground model at a check as the map would read it: the other checks blended in and the fit applied by distance and age. */
export type MapProbeFn = (c: WindCheck, others: WindCheck[], fit: AmbientFit | null) => Probe | null

export interface AmbientFit {
  /** degrees to turn the forecast direction, + clockwise */
  turn: number
  /** ln of the ratio on the forecast speed */
  lnRatio: number
  /** ln of the weight on the cold air's drainage round the sit (0: the model's own) */
  lnDrain: number
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
  /** the forecast's 10 m speed the checks logged (their median), km/h; null when none did */
  forecastKmh: number | null
  /** the prior on the turn it was fitted under, degrees: how far off the forecast runs in that wind */
  priorTurn: number
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

/**
 * A fit's time scale: a check's say fades with this e-folding against the
 * newest check. Each check is read against the forecast of its own minute,
 * so an older one still says how far off the forecast runs: on virtual
 * hunters with four checks over three hours, counting them all the same
 * did best and 2 h worst (pipeline/stations/tune.py part 3: a far-off call
 * put right in 36% of sits, against 28%); 4 h keeps a little caution.
 */
export const FIT_TAU_MS = 4 * 3600_000
/** Checks further apart than this in time are different sits. */
export const SESSION_GAP_MS = 2 * 3600_000
/** Checks further than this from a sit's centre are a different place: the air above may differ. */
export const SESSION_SPAN_M = 3000
/**
 * How much of a fit still holds after its last check, measured at 1,131
 * stations over 29 days (pipeline/stations/tune.py, 2026-10-13): an offset
 * on the forecast measured now carries, as the best weight, 0.64 of its
 * turn an hour on, 0.49 two, 0.41 three, 0.30 six and about a quarter
 * through the next day (the place's own turn: a valley's line, a station's
 * siting); of its speed ratio 0.77, 0.67, 0.60, 0.47 and about two-fifths
 * (the place's own shelter, 37% of the speed's error). Each fades as
 * KEEP + (1 - KEEP) exp(-age / TAU), all of it gone LAST_MS after the last
 * check; a wind that had held keeps its quick part twice as long. Until
 * 2026-10-13 both faded together with a 3 h e-folding, which held the quick
 * part too long and dropped the lasting part by the evening.
 * Those are every hour's. A hunter checks in legal light (the sun at −5° or
 * higher, tune.py part 4), and there the turn carries 0.60, 0.45, 0.36 and
 * 0.27 and the speed ratio 0.72, 0.57, 0.47 and 0.35: the speed fades
 * faster in the hunt than through the night, fastest at dawn and dusk
 * (0.70, 0.48, 0.31, 0.26), so its quick part is 2.2 h to a lasting 0.3
 * (was 2.8 h to 0.4), and the turn's 1.5 h (was 1.6).
 */
const TURN_KEEP = 0.25
const TURN_TAU_MS = 1.5 * 3600_000
const LN_KEEP = 0.3
const LN_TAU_MS = 2.2 * 3600_000
export const LAST_MS = 24 * 3600_000
/** It counts from this long before the first check. */
export const LEAD_MS = 30 * 60_000
/** One air: the forecast's own grid is 2.5 km. The fit's weight falls as a Gaussian with this scale from the checks' centre. */
export const FIT_SCALE_M = 2500
/** A sit's fit uses at most this many checks, the newest. */
export const FIT_MAX_CHECKS = 16

/**
 * How wrong the forecast's 10 m wind runs, one sigma, by its own speed: the
 * prior on the turn (degrees) and on the speed ratio (ln). Measured at the
 * stations (tune.py): the turn 37° under 8 km/h, 20° at 8–20 and 13° over
 * 20; the ratio 0.70, 0.47 and 0.32 (stable nights 29° and 0.73, mountains
 * 32° and 0.81). Until 2026-10-13 one 40° and 0.45 for every wind: too loose
 * a turn in a breeze, so a few puffs could swing the whole neighbourhood,
 * and too tight a ratio in light air.
 */
const PRIOR_AT: [number, number, number][] = [
  [6, 37, 0.7],
  [14, 20, 0.47],
  [24, 13, 0.32],
]
/** With no forecast logged on the checks: the old single prior. */
const PRIOR_TURN = 40
const PRIOR_LN_RATIO = 0.45

/** The priors for a sit whose checks logged the forecast's 10 m speed (km/h): through PRIOR_AT, flat past its ends. */
function priorFor(kmh: number | null): [number, number] {
  if (kmh == null || !Number.isFinite(kmh)) return [PRIOR_TURN, PRIOR_LN_RATIO]
  if (kmh <= PRIOR_AT[0][0]) return [PRIOR_AT[0][1], PRIOR_AT[0][2]]
  for (let i = 1; i < PRIOR_AT.length; i++) {
    const [v1, t1, l1] = PRIOR_AT[i]
    if (kmh <= v1) {
      const [v0, t0, l0] = PRIOR_AT[i - 1]
      const f = (kmh - v0) / (v1 - v0)
      return [t0 + (t1 - t0) * f, l0 + (l1 - l0) * f]
    }
  }
  const last = PRIOR_AT[PRIOR_AT.length - 1]
  return [last[1], last[2]]
}

/**
 * How well a felt check's direction tells the air above, one sigma, in the
 * fit: the checks of one sit at one spot differ by a median 45° (27 pairs
 * within 20 minutes and 200 m in the 2026 replay: about ±47° a check, light
 * ones wider), wider than the 25–35° DIR_SIGMA gives a light or breezy
 * puff. Stations handed puffs that noisy are only helped by a fit that
 * knows it (tune.py: two puffs read at 25–35° took 88% within 45° to 81%,
 * read at their own noise to 91%). The local blend keeps DIR_SIGMA.
 */
const FIT_DIR_SIGMA: Record<Strength, number> = { calm: 90, drift: 55, light: 50, breezy: 45, windy: 40 }
/** How well the treetops' way is read from afar, degrees, one sigma. */
const SEEN_DIR_SIGMA = 30
/** What each sign means at 10 m, km/h: Beaufort's bands (SEEN_KMH holds their middles). */
const SEEN_RANGE: Record<Seen, [number, number]> = { still: [0, 6], leaves: [6, 20], branches: [20, 29], sway: [29, 39], bend: [39, Infinity] }
/** A look at the treetops sees the air the fit is after, not the ground's answer to it: it counts this much more than a puff. */
const SEEN_FIT_W = 1.5
const SPEED_SIGMA = Math.log(2)
/** The drainage weights tried (x0.1 to x2), the prior's sigma on them (ln), and the drainage at a check, km/h, under which it is not tried. */
const DRAIN_LNS = [-2.3, -1.4, -0.7, 0, 0.4, 0.7]
const DRAIN_PRIOR = 1.0
const DRAIN_MIN_KMH = 0.3
// off until replay.py --loo scores it on the checks (2026-10-16: the archive's daily allowance ran out first)
let fitDrainOn = false
/** Scripts score the fit with and without the drainage's weight (replay.py --loo --fit-drain). */
export function setFitDrain(on: boolean): void {
  fitDrainOn = on
}
const COARSE_STEP = 15
const LN_RATIOS = [-0.9, -0.6, -0.3, 0, 0.3, 0.6, 0.9, 1.1]
const LN_RATIO_RANGE: [number, number] = [-1.0, 1.2]

/** The fit is worth applying and saying: two checks or more (one check
 *  patches its own ground through the local blend; it does not move the
 *  air over the whole neighbourhood, which on the 2026 replay cost a hit),
 *  and a turn of 8° or a speed off by a fifth. Until 2026-10-13 the checks
 *  also had to prefer it to the forecast by e to one per check: puffs as
 *  noisy as real ones cleared that in 4–7% of sits, so the fit almost never
 *  moved the air (tune.py part 3: four puffs at ±60°, 90% within 45° with
 *  that bar, 94% without, and a far-off forecast put right in 18% of sits
 *  against 58%). The prior already weighs the forecast against them. */
export function fitMatters(f: AmbientFit | null): f is AmbientFit {
  return !!f && f.count >= 2 && (Math.abs(f.turn) >= 8 || Math.abs(f.lnRatio) >= Math.log(1.2) || Math.abs(f.lnDrain) >= Math.log(1.5))
}

/** A check's say in a sit's fit against the sit's newest check: by age, half again for a swing. */
export function fitWeight(c: WindCheck, refTs: number): number {
  const tau = c.held ? 2 * FIT_TAU_MS : FIT_TAU_MS
  return Math.exp(-Math.abs(refTs - c.ts) / tau) * (c.swingDeg ? 0.7 : 1) * puffBoost(c)
}

/** The fit's weights at a spot and moment, the turn's and the speed ratio's: full among the checks, a Gaussian off them, each fading after the last as the stations say. */
export function fitWeightsAt(f: AmbientFit, lon: number, lat: number, ms: number): { turn: number; ln: number } {
  const age = Math.max(0, ms - f.lastTs)
  if (ms < f.firstTs - LEAD_MS || age > LAST_MS) return { turn: 0, ln: 0 }
  const k = f.held ? 2 : 1
  const kx = 111_320 * Math.cos((lat * Math.PI) / 180)
  const d = Math.hypot((lon - f.lon) * kx, (lat - f.lat) * 110_574)
  const space = Math.exp(-((d / FIT_SCALE_M) * (d / FIT_SCALE_M)))
  return {
    turn: space * (TURN_KEEP + (1 - TURN_KEEP) * Math.exp(-age / (k * TURN_TAU_MS))),
    ln: space * (LN_KEEP + (1 - LN_KEEP) * Math.exp(-age / (k * LN_TAU_MS))),
  }
}

/** The turn's weight: what the card says of how much of the fit reaches a spot. */
export function fitWeightAt(f: AmbientFit, lon: number, lat: number, ms: number): number {
  return fitWeightsAt(f, lon, lat, ms).turn
}

/** The sits: checks in order, felt and seen, split where more than SESSION_GAP_MS passes or a check is SESSION_SPAN_M from the sit's centre. */
export function sessionsOf(checks: WindCheck[]): WindCheck[][] {
  const felt = [...checks].sort((a, b) => a.ts - b.ts)
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
    if (ms >= first - LEAD_MS && ms <= last.ts + LAST_MS) best = s
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
  const sig = p.kmh < 1.5 ? 90 : FIT_DIR_SIGMA[c.strength] + (c.swingDeg ?? 0) / 2
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

/** A look at the treetops against the 10 m wind under a candidate: its
 *  direction to SEEN_DIR_SIGMA, its Beaufort band like a puff's range. */
function lnLikeSeen(c: WindCheck, p: Probe): number {
  let s = 0
  if (c.dirFrom != null && c.seen !== 'still') {
    const z = angleDiff(c.dirFrom, p.dirFrom) / SEEN_DIR_SIGMA
    s += Math.log(0.9 * Math.exp(-0.5 * z * z) + 0.1)
  }
  const [lo, hi] = SEEN_RANGE[c.seen!]
  const m = Math.log(Math.max(p.kmh, 0.2))
  const upper = hi === Infinity ? 1 : Phi((Math.log(hi) - m) / SPEED_SIGMA)
  const lower = lo <= 0 ? 0 : Phi((Math.log(lo) - m) / SPEED_SIGMA)
  return s + Math.log(Math.max(upper - lower, 0.02))
}

/**
 * The forecast is now and then far off: 4–8% of station-hours past three
 * times its usual turn (tune.py), a front early, a wind that went round.
 * So the prior is PRIOR_TAIL of it spread evenly over every turn and ratio
 * besides the Gaussian, and checks that agree can overrule the forecast
 * then: with eight puffs at ±60° a far-off call is put right in 83% of
 * sits against 70% (tune.py part 3), at no cost where it is close.
 */
const PRIOR_TAIL = 0.06

function lnPrior(turn: number, lnRatio: number, prior: [number, number]): number {
  const g = Math.exp(-0.5 * (turn / prior[0]) ** 2 - 0.5 * (lnRatio / prior[1]) ** 2)
  // the tail's density against the Gaussian's peak: PRIOR_TAIL of the mass over 360° and the ratio's 2.2
  const tail = ((PRIOR_TAIL / (1 - PRIOR_TAIL)) * 2 * Math.PI * prior[0] * prior[1]) / (360 * (LN_RATIO_RANGE[1] - LN_RATIO_RANGE[0]))
  return Math.log((1 - PRIOR_TAIL) * g + tail)
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
  // the prior by the forecast's speed the checks logged (their median)
  const fk = use.map((c) => c.forecast?.kmh).filter((v): v is number => v != null && Number.isFinite(v)).sort((x, y) => x - y)
  const forecastKmh = fk.length ? fk[Math.floor(fk.length / 2)] : null
  const prior = priorFor(forecastKmh)
  const w = use.map((c) => fitWeight(c, refTs) * (c.seen ? SEEN_FIT_W : 1))
  // each check's probe is a function of the candidate alone: the woods flag
  // (half weight on speed) is read at the forecast as it stands
  const woods = use.map((c) => !c.seen && (probe(c, 0, 0)?.woods ?? false))
  let anyProbe = false
  const score = (turn: number, lnRatio: number, lnDrain = 0): number => {
    let s = lnPrior(turn, lnRatio, prior) - 0.5 * (lnDrain / DRAIN_PRIOR) ** 2
    for (let k = 0; k < use.length; k++) {
      const p = probe(use[k], turn, lnRatio, lnDrain)
      if (!p) continue
      anyProbe = true
      // a seen check's probe is the 10 m wind above the trees (model.ts probeFor)
      s += w[k] * (use[k].seen ? lnLikeSeen(use[k], p) : lnLikeDir(use[k], p) + (woods[k] ? 0.5 : 1) * lnLikeSpeed(use[k], p))
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
  // the drainage's weight, where a check sits in draining air: tried at the
  // best turn and ratio, then those refined again under the weight chosen
  let bd = 0
  if (fitDrainOn && use.some((c) => !c.seen && (probe(c, bt, bl)?.drain ?? 0) >= DRAIN_MIN_KMH)) {
    for (const d of DRAIN_LNS) {
      if (d === 0) continue
      const s = score(bt, bl, d)
      if (s > best) {
        best = s
        bd = d
      }
    }
    if (bd !== 0) {
      const t1 = bt
      const l1 = bl
      for (let dt = -10; dt <= 10; dt += 5)
        for (let dl = -0.2; dl <= 0.2001; dl += 0.1) {
          const t = wrap(t1 + dt)
          const l = Math.max(LN_RATIO_RANGE[0], Math.min(LN_RATIO_RANGE[1], l1 + dl))
          const s = score(t, l, bd)
          if (s > best) {
            best = s
            bt = t
            bl = l
          }
        }
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
    lnDrain: Math.round(bd * 1000) / 1000,
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
    forecastKmh,
    priorTurn: prior[0],
    allWoods: use.every((c, k) => c.seen || woods[k]),
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
    // a look at the treetops helps the others' fit; the score is the felt checks'
    if (c.seen) continue
    const raw = probe(c, 0, 0)
    if (!raw) continue
    out.n++
    const others = sorted.filter((o) => o !== c)
    const f = others.length ? fitAmbient(others, probe) : null
    const fw = fitMatters(f) ? fitWeightsAt(f, c.lon, c.lat, c.ts) : { turn: 0, ln: 0 }
    const withFit = others.length && asMap ? asMap(c, others, fitMatters(f) ? f : null) : fw.turn > 0 || fw.ln > 0 ? probe(c, f!.turn * fw.turn, f!.lnRatio * fw.ln, f!.lnDrain * fw.turn) : raw
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
  const d = Math.exp(f.lnDrain ?? 0)
  const drain = d <= 1 / 1.5 ? `the cold air drains ${d <= 0.3 ? 'hardly at all' : 'weaker'} here than the map had: the wind above wins` : d >= 1.5 ? 'the cold air drains stronger here than the map had: the slope wins over the wind' : ''
  if (!bits.length) return drain || 'the air above the trees is about what the forecast says'
  return `the air above the trees runs ${bits.join(' at ')}${drain ? `; ${drain}` : ''}`
}

/** When the turn's quick part has faded to half the fit: the words for "held till". */
export function fitHoldsUntil(f: AmbientFit): number {
  return f.lastTs + (f.held ? 2 : 1) * TURN_TAU_MS * Math.log((1 - TURN_KEEP) / (0.5 - TURN_KEEP))
}

/**
 * How many checks settle the air in a wind: enough that the fit goes half
 * way from the forecast to what they say, (a puff's spread / the forecast's
 * usual turn)², a puff read at PUFF_READ. Light air, where the forecast is
 * often off, takes 2; a moderate wind (20°) about 7; a breeze (13°), where
 * it is seldom far off, about 15 (tune.py: two puffs in light air carried
 * about half the correction, four about 70%).
 */
const PUFF_READ = 50
export function puffsToSettle(forecastKmh: number | null): number {
  return Math.max(2, Math.ceil((PUFF_READ / priorFor(forecastKmh)[0]) ** 2))
}

/**
 * The puff that would teach the most next, from what this sit's checks
 * cannot yet tell apart, then how many more this wind takes to settle.
 * Null when the fit is sharp and the sit is covered.
 */
export function nextPuff(f: AmbientFit | null, count: number, forecastKmh: number | null = null): string | null {
  const kmh = forecastKmh ?? f?.forecastKmh ?? null
  const need = puffsToSettle(kmh)
  if (!f) {
    if (count >= 2) return null
    return need <= 3
      ? 'In air this light the forecast is often off: one more puff, 50 m or more from this one, and the map fits the air here.'
      : 'A second puff, 50 m or more from this one, lets the map fit the air here rather than patch it.'
  }
  if (f.allWoods) return 'One puff in the open (a bog, a shore, a cutline) would split the air above from the trees’ share: every check so far was under the canopy.'
  if (f.allOpen && count >= 2) return 'One puff under the trees would say how much of this gets in to where you sit: every check so far was in the open.'
  if (f.sure < 0.5 && count >= 2) return 'The checks disagree on the direction: one more puff where you will sit would settle which air you are in.'
  if (need > 8) return `In a wind like this the forecast is seldom more than about ${Math.round(f.priorTurn)}° off: your puffs mostly confirm it.`
  if (count < need) {
    const more = need - count
    return `${more} more puff${more === 1 ? '' : 's'}, spaced out, and the air here is settled: in this wind about ${need} is what it takes to trust your checks over the forecast.`
  }
  return null
}
