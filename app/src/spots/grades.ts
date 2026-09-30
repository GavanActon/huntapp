import { isFish, type Target, type Verdict } from './types'

/**
 * The words and bars the UI reads off a score, in one place: a verdict's
 * grade (the first word of its headline), the strip's activity bar, and
 * a cell's grade for the popup and Dig in.
 */

export type ActivityGrade = 'prime' | 'good' | 'fair' | 'slow' | 'poor' | 'closed'

/** Activity at which the bar is full: the rules' "Prime" thresholds. */
export const PRIME_AT = { hunt: 0.85, fish: 1.1 } as const

const GRADES: ActivityGrade[] = ['prime', 'good', 'fair', 'slow', 'poor', 'closed']

/** The verdict's grade: the first word of its headline, lowercased. */
export function activityGrade(v: Verdict): ActivityGrade {
  const w = v.headline.split(' ')[0]?.toLowerCase() as ActivityGrade | undefined
  return w && GRADES.includes(w) ? w : 'poor'
}

/** A window's or hour's activity as a bar fill, 0..1, full at "prime". */
export function activityBar(t: Target, activity: number): number {
  const full = PRIME_AT[isFish(t) ? 'fish' : 'hunt']
  if (!Number.isFinite(activity) || activity <= 0) return 0
  return Math.min(1, activity / full)
}

export type SpotGrade = 'top' | 'good' | 'fair' | 'poor'

/** A cell's grade from its 0..1 score (the heat map's thresholds). */
export function spotGrade(score: number): SpotGrade {
  return score >= 0.75 ? 'top' : score >= 0.55 ? 'good' : score >= 0.35 ? 'fair' : 'poor'
}

/** "good stand", "top spot". */
export function spotGradeWords(t: Target, score: number): string {
  return `${spotGrade(score)} ${isFish(t) ? 'spot' : 'stand'}`
}
