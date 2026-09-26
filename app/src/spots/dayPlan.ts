import type { PointForecast } from '../weather/openMeteo'
import { sunTimes } from '../weather/sun'
import { startOfDayMs } from '../time'
import { deriveConditions, type Conditions } from './conditions'
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

type RecentDaily = Parameters<typeof deriveConditions>[2]

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
    const c = deriveConditions(f, ms, recent)
    if (!c) continue
    const v = isFish(target) ? fishVerdict(target, c, lake, w) : activityVerdict(target, c, w)
    sum += v.activity
    n++
    if (!best || v.activity > best.v.activity) best = { v, c, ms }
  }
  if (!best || n === 0) return null
  return { slot, atMs: best.ms, startMs, endMs, activity: sum / n, peak: best.v.activity, headline: best.v.headline, verdict: best.v, conditions: best.c }
}

/** Seven days of morning and evening windows, from the cached forecast. */
export function dayPlans(f: PointForecast, target: Target, recent: RecentDaily, lake: LakeFacts | null = null, w: Weights = DEFAULT_WEIGHTS, now = Date.now()): DayPlan[] {
  const out: DayPlan[] = []
  const first = startOfDayMs(now)
  for (let d = 0; d < 7; d++) {
    const dayStartMs = first + d * 86_400_000
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
