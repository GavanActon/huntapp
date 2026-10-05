import type { PointForecast } from '../weather/openMeteo'
import { sunTimes } from '../weather/sun'
import { floorHourMs } from '../time'
import { deriveConditions, type Conditions } from './conditions'
import { activityGrade, type ActivityGrade } from './grades'
import { activityVerdict } from './huntRules'
import { fishVerdict } from './fishRules'
import type { LakeFacts } from './habitatGrid'
import { isFish, type Target, type Verdict } from './types'
import { DEFAULT_WEIGHTS, type Weights } from './weights'

/**
 * The week at a glance: for each day, the morning and the evening hunt
 * (or the dawn and dusk bite) scored as windows, so the app can say "go
 * Saturday evening" before anyone picks an hour. A window is the mean of
 * the day's verdict over its hours; the hour strip still picks any single
 * hour underneath this.
 *
 * Morning: half an hour before sunrise to three hours after. Evening:
 * three hours before sunset to half an hour after. Legal light in Ontario
 * is half an hour either side of the sun, so the windows are the legal
 * ones, and the app never suggests a time outside them.
 */

export type Slot = 'morning' | 'evening'

export interface WindowScore {
  slot: Slot
  /** the hour to plan at: the window's best hour */
  atMs: number
  startMs: number
  endMs: number
  /** mean activity over the window, 0..~1.3 */
  activity: number
  /** the best hour's activity */
  peak: number
  headline: string
  /** the best hour's verdict, for the reasons */
  verdict: Verdict
  conditions: Conditions
}

export interface DayPlan {
  dayStartMs: number
  morning: WindowScore | null
  evening: WindowScore | null
  best: Slot | null
}

export type RecentDaily = Parameters<typeof deriveConditions>[2]

function verdictAt(f: PointForecast, target: Target, ms: number, recent: RecentDaily, lake: LakeFacts | null, w: Weights): { v: Verdict; c: Conditions } | null {
  const c = deriveConditions(f, ms, recent)
  if (!c) return null
  const v = isFish(target) ? fishVerdict(target, c, lake, w) : activityVerdict(target, c, w)
  return { v, c }
}

function windowFor(f: PointForecast, target: Target, slot: Slot, dayStartMs: number, recent: RecentDaily, lake: LakeFacts | null, w: Weights): WindowScore | null {
  const sun = sunTimes(dayStartMs + 12 * 3600_000, f.lat, f.lon)
  if (sun.sunriseMs == null || sun.sunsetMs == null) return null
  const startMs = slot === 'morning' ? sun.sunriseMs - 0.5 * 3600_000 : sun.sunsetMs - 3 * 3600_000
  const endMs = slot === 'morning' ? sun.sunriseMs + 3 * 3600_000 : sun.sunsetMs + 0.5 * 3600_000
  let sum = 0
  let n = 0
  let best: { v: Verdict; c: Conditions; ms: number } | null = null
  // hourly samples on the hour inside the window
  for (let ms = Math.ceil(startMs / 3600_000) * 3600_000; ms <= endMs; ms += 3600_000) {
    const r = verdictAt(f, target, ms, recent, lake, w)
    if (!r) continue
    sum += r.v.activity
    n++
    if (!best || r.v.activity > best.v.activity) best = { v: r.v, c: r.c, ms }
  }
  if (!best || n === 0) return null
  return { slot, atMs: best.ms, startMs, endMs, activity: sum / n, peak: best.v.activity, headline: best.v.headline, verdict: best.v, conditions: best.c }
}

/** Seven days of morning and evening windows, from the cached forecast. */
export function dayPlans(f: PointForecast, target: Target, recent: RecentDaily, lake: LakeFacts | null = null, w: Weights = DEFAULT_WEIGHTS, now = Date.now()): DayPlan[] {
  const out: DayPlan[] = []
  const t = new Date(now)
  for (let d = 0; d < 7; d++) {
    // local midnight of each day by the calendar, so a clock change does not
    // shift every later day an hour off the forecast's dates
    const dayStartMs = new Date(t.getFullYear(), t.getMonth(), t.getDate() + d).getTime()
    let morning = windowFor(f, target, 'morning', dayStartMs, recent, lake, w)
    let evening = windowFor(f, target, 'evening', dayStartMs, recent, lake, w)
    // a window already over today is not an option
    if (morning && morning.endMs < now) morning = null
    if (evening && evening.endMs < now) evening = null
    const best = morning && evening ? (evening.activity > morning.activity * 1.05 ? 'evening' : 'morning') : morning ? 'morning' : evening ? 'evening' : null
    out.push({ dayStartMs, morning, evening, best })
  }
  return out
}

/** The one window to suggest this week: the highest mean activity. */
export function bestWindow(plans: DayPlan[]): { plan: DayPlan; win: WindowScore } | null {
  let best: { plan: DayPlan; win: WindowScore } | null = null
  for (const plan of plans) {
    for (const win of [plan.morning, plan.evening]) {
      if (win && (!best || win.activity > best.win.activity)) best = { plan, win }
    }
  }
  return best
}

export interface HourActivity {
  ms: number
  activity: number
  grade: ActivityGrade
  warnings: string[]
}

/** The forecast's last hour on the hour. */
function lastHourMs(f: PointForecast): number {
  const times = f.hourly.time
  return times.length ? floorHourMs(Date.parse(times[times.length - 1])) : 0
}

let hoursMemo: { key: unknown[]; out: HourActivity[] } | null = null

/**
 * Every hour on the hour from `floorHourMs(fromMs)` to `toMs` (default:
 * the forecast's last hour), scored for the target: the bar under each
 * hour of the strip. Memoised on its inputs (the weights by reference),
 * so the same call returns the same array.
 */
export function hourScores(f: PointForecast, target: Target, recent: RecentDaily, lake: LakeFacts | null, w: Weights, fromMs: number, toMs?: number): HourActivity[] {
  const from = floorHourMs(fromMs)
  const to = toMs ?? lastHourMs(f)
  const key: unknown[] = [f.fetchedAt, f.sat?.at ?? 0, f.lon, f.lat, target, w, lake?.id ?? null, recent?.fetchedAt ?? 0, from, to]
  if (hoursMemo && hoursMemo.key.every((k, i) => k === key[i])) return hoursMemo.out
  const out: HourActivity[] = []
  for (let ms = from; ms <= to; ms += 3600_000) {
    const r = verdictAt(f, target, ms, recent, lake, w)
    if (!r) continue
    out.push({ ms, activity: r.v.activity, grade: activityGrade(r.v), warnings: r.v.warnings })
  }
  hoursMemo = { key, out }
  return out
}
