import { otherAreaAt } from '../../areas'
import { STRENGTH_KMH, type WindCheck } from './windChecks'

/**
 * What the season's wind checks have taught the ground model, by lesson.
 *
 * A check used to be a patch: it pulled the wind near it for an hour or
 * two and then was gone, and the model believed exactly what it had
 * before. Here each check is also a lesson. Its residual (what was felt
 * minus what the model said, taken from the raw call before any earlier
 * correction) is charged to the layer that decided the call: the model's
 * regime (wind, drainage, pooled, upslope, a breeze, calm), or the slot
 * rule when the cell was a slot in the trees, the biggest single turn the
 * model makes and the least tested. Per lesson the residuals give a turn
 * in degrees and a speed ratio, which the model then applies to every
 * cell in that regime, so one check in a slot turns every slot nearby.
 *
 * Priors and forgetting keep one puff from swinging it: the mean is taken
 * with PRIOR_N pseudo-checks of zero bias, each check's weight fades over
 * FORGET_DAYS, a swinging check counts half, and the turn is capped at
 * MAX_DEG and the ratio within RATIO_RANGE. It takes about five agreeing
 * checks before a lesson moves far.
 */

export type Lesson = 'slot' | 'wind' | 'drainage' | 'pooled' | 'upslope' | 'lakeBreeze' | 'landBreeze' | 'calm'

export const LESSON_WORDS: Record<Lesson, string> = {
  slot: 'slots in the trees',
  wind: 'plain wind',
  drainage: 'draining cold air',
  pooled: 'settled cold air',
  upslope: 'upslope air',
  lakeBreeze: 'lake breezes',
  landBreeze: 'land breezes',
  calm: 'near calm',
}

export interface Bias {
  /** degrees to turn the model's direction (+ clockwise) */
  deg: number
  /** multiply the model's speed by this */
  ratio: number
  /** the checks behind it, weighted (a season's worth is tens) */
  n: number
}

export const PRIOR_N = 4
const FORGET_DAYS = 14
const MAX_DEG = 45
const RATIO_RANGE: [number, number] = [0.5, 2]
const NONE: Bias = { deg: 0, ratio: 1, n: 0 }

/** Which lesson a check teaches: the slot rule where the model saw a slot, else the regime. */
export function lessonOf(c: WindCheck): Lesson | null {
  const m = c.model
  if (!m) return null
  if (m.slot) return 'slot'
  return m.regime as Lesson
}

/** A check's direction residual against the model's raw call, degrees (+ the felt wind is clockwise of the call); null without both directions. */
export function residualDeg(c: WindCheck): number | null {
  const m = c.model
  if (!m || c.dirFrom == null || c.strength === 'calm' || m.kmh < 1) return null
  const raw = m.dirFrom - (m.bias?.deg ?? 0)
  const d = ((c.dirFrom - raw) % 360 + 540) % 360 - 180
  return d
}

/** A check's speed ratio against the model's raw call; null where either is calm. */
export function residualRatio(c: WindCheck): number | null {
  const m = c.model
  if (!m || m.kmh < 1) return null
  const felt = STRENGTH_KMH[c.strength]
  if (felt < 1) return null
  return felt / (m.kmh / (m.bias?.ratio ?? 1))
}

/** The lessons learned from these checks, as of `ms`. */
export function learnBiases(checks: WindCheck[], ms: number): Map<Lesson, Bias> {
  const acc = new Map<Lesson, { s: number; c: number; wd: number; lr: number; wr: number }>()
  for (const c of checks) {
    // another area's checks teach its ground, not this one's: its slots and slopes are not these
    if (otherAreaAt(c.lon, c.lat)) continue
    const lesson = lessonOf(c)
    if (!lesson || c.ts > ms) continue
    const age = (ms - c.ts) / 86_400_000
    if (age > FORGET_DAYS * 4) continue
    const w = Math.exp(-age / FORGET_DAYS) * (c.swingDeg ? 0.5 : 1)
    const a = acc.get(lesson) ?? { s: 0, c: 0, wd: 0, lr: 0, wr: 0 }
    const d = residualDeg(c)
    if (d != null) {
      a.s += w * Math.sin((d * Math.PI) / 180)
      a.c += w * Math.cos((d * Math.PI) / 180)
      a.wd += w
    }
    const r = residualRatio(c)
    if (r != null) {
      a.lr += w * Math.log(r)
      a.wr += w
    }
    acc.set(lesson, a)
  }
  const out = new Map<Lesson, Bias>()
  for (const [lesson, a] of acc) {
    // the prior is PRIOR_N unit vectors along zero
    const deg = (Math.atan2(a.s, a.c + PRIOR_N) * 180) / Math.PI
    const ratio = Math.exp(a.lr / (a.wr + PRIOR_N))
    out.set(lesson, {
      deg: Math.max(-MAX_DEG, Math.min(MAX_DEG, deg)),
      ratio: Math.max(RATIO_RANGE[0], Math.min(RATIO_RANGE[1], ratio)),
      n: Math.max(a.wd, a.wr),
    })
  }
  return out
}

export function biasFor(biases: Map<Lesson, Bias> | null, lesson: Lesson): Bias {
  return biases?.get(lesson) ?? NONE
}

/** Worth saying and applying: a turn of 5° or a speed off by a seventh. */
export function biasMatters(b: Bias): boolean {
  return Math.abs(b.deg) >= 5 || Math.abs(Math.log(b.ratio)) >= Math.log(1.15)
}

/** A line for the reasons: "Turned 12° and slowed 20% by 7 checks in slots in the trees this season". */
export function biasWords(b: Bias, lesson: Lesson): string {
  const bits: string[] = []
  if (Math.abs(b.deg) >= 5) bits.push(`turned ${Math.round(Math.abs(b.deg))}° ${b.deg > 0 ? 'clockwise' : 'anticlockwise'}`)
  if (b.ratio >= 1.15) bits.push(`sped up ${Math.round((b.ratio - 1) * 100)}%`)
  else if (b.ratio <= 1 / 1.15) bits.push(`slowed ${Math.round((1 - b.ratio) * 100)}%`)
  const s = bits.join(' and ')
  return `${s[0].toUpperCase()}${s.slice(1)} by ${Math.round(b.n)} wind check${Math.round(b.n) === 1 ? '' : 's'} in ${LESSON_WORDS[lesson]} this season`
}

/** Scored checks by lesson, for the scoreboard: hits, close, misses, and the lesson learned. */
export interface LessonScore {
  lesson: Lesson
  agree: number
  close: number
  miss: number
  bias: Bias
}

export function lessonScores(checks: WindCheck[], verdictOf: (c: WindCheck) => 'agree' | 'close' | 'miss' | null, ms = Date.now()): LessonScore[] {
  const biases = learnBiases(checks, ms)
  const rows = new Map<Lesson, LessonScore>()
  for (const c of checks) {
    if (otherAreaAt(c.lon, c.lat)) continue
    const lesson = lessonOf(c)
    const v = verdictOf(c)
    if (!lesson || !v) continue
    const r = rows.get(lesson) ?? { lesson, agree: 0, close: 0, miss: 0, bias: biasFor(biases, lesson) }
    r[v]++
    rows.set(lesson, r)
  }
  return [...rows.values()].sort((a, b) => b.agree + b.close + b.miss - (a.agree + a.close + a.miss))
}
