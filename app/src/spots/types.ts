import type { WeightKey } from './weights'

export type HuntTarget = 'moose' | 'grouse' | 'bear' | 'deer'
export type FishTarget = 'walleye' | 'pike' | 'laketrout'
export type Target = HuntTarget | FishTarget

export const HUNT_TARGETS: HuntTarget[] = ['moose', 'grouse', 'bear', 'deer']
export const FISH_TARGETS: FishTarget[] = ['walleye', 'pike', 'laketrout']
export const TARGET_NAMES: Record<Target, string> = {
  moose: 'Moose',
  grouse: 'Grouse',
  bear: 'Bear',
  deer: 'Deer',
  walleye: 'Walleye',
  pike: 'Pike',
  laketrout: 'Lake trout',
}
export function isFish(t: Target): t is FishTarget {
  return (FISH_TARGETS as string[]).includes(t)
}

/** One line of a verdict: what it is, how much it moves the odds, why. */
export interface Factor {
  label: string
  /** multiplier on activity, 1 = neutral */
  mult: number
  note?: string
  /** which knob weighs it (spots/weights.ts) */
  key?: WeightKey
}

export interface Verdict {
  /** the product of the factors, 0..~1.3 */
  activity: number
  /** the headline: "Good morning for calling" */
  headline: string
  factors: Factor[]
  /** hard stops: season closed, boat can't go out */
  warnings: string[]
  /** informational lines: water temperature, thermocline, rut */
  notes: string[]
}

export interface Spot {
  cell: number
  lon: number
  lat: number
  score: number
  title: string
  reasons: string[]
  /** for fishing: the lake */
  lakeId?: number
}
