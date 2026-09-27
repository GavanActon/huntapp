/**
 * The knobs on the scorer. Every component of a score has a key; the user
 * turns each one down, off or up in the Spots tab ("I don't care about
 * roads"). A weight of 1 is the rules as written; 0 removes the component;
 * 2 doubles its pull. Multiplicative factors are weighed as
 * 1 + (mult − 1)·w, additive habitat bonuses as bonus·w, so the numbers at
 * every default are exactly the rules'.
 */

export type WeightKey =
  // the day: the verdict's factors
  | 'light'
  | 'temp'
  | 'wind'
  | 'rain'
  | 'front'
  | 'recent'
  | 'rut'
  | 'water'
  | 'season'
  // the site: per-cell geometry
  | 'scent'
  | 'visibility'
  | 'access'
  // the habitat
  | 'browse'
  | 'edge'
  | 'shore'
  | 'funnel'
  | 'heat'

export type WeightGroup = 'day' | 'site' | 'habitat'

export interface WeightDef {
  key: WeightKey
  label: string
  desc: string
  group: WeightGroup
  /** which targets it applies to; absent = all */
  hunt?: boolean
  fish?: boolean
}

export const WEIGHT_DEFS: WeightDef[] = [
  { key: 'light', label: 'Time of day', desc: 'First and last light over midday and dark', group: 'day' },
  { key: 'temp', label: 'Temperature', desc: 'Cool moves moose; heat beds them', group: 'day', hunt: true },
  { key: 'water', label: 'Water temperature', desc: 'The species’ comfort band', group: 'day', fish: true },
  { key: 'wind', label: 'Wind', desc: 'Calling range, movement, boat safety', group: 'day' },
  { key: 'rain', label: 'Rain', desc: 'Drizzle to downpour', group: 'day' },
  { key: 'front', label: 'Fronts and pressure', desc: 'A cold front through, a falling glass', group: 'day' },
  { key: 'recent', label: 'Recent days', desc: 'A warm spell beds moose; the first cool day after one moves them', group: 'day', hunt: true },
  { key: 'rut', label: 'Rut', desc: 'The moose calendar', group: 'day', hunt: true },
  { key: 'season', label: 'Season', desc: 'Closed water scores zero', group: 'day', fish: true },
  { key: 'scent', label: 'Scent', desc: 'Wind and thermals against the feeding side', group: 'site', hunt: true },
  { key: 'visibility', label: 'Downwind view', desc: 'Open ground where a circling animal shows', group: 'site', hunt: true },
  { key: 'access', label: 'Roads and landings', desc: 'How reachable the spot is; turn off to ignore roads', group: 'site', hunt: true },
  { key: 'browse', label: 'Browse and cover', desc: 'The stand itself: species, age, cuts and burns', group: 'habitat', hunt: true },
  { key: 'edge', label: 'Edges', desc: 'Browse near cover, cover near browse', group: 'habitat', hunt: true },
  { key: 'shore', label: 'Shores and wetlands', desc: 'Lakes, beaver meadows, cuts running to water', group: 'habitat', hunt: true },
  { key: 'funnel', label: 'Funnels', desc: 'Saddles, necks of land, benches', group: 'habitat', hunt: true },
  { key: 'heat', label: 'Shade in heat', desc: 'Warm days push moose into conifer', group: 'habitat', hunt: true },
]

export type Weights = Record<WeightKey, number>

export const DEFAULT_WEIGHTS: Weights = Object.fromEntries(WEIGHT_DEFS.map((d) => [d.key, 1])) as Weights

export const GROUP_NAMES: Record<WeightGroup, string> = { day: 'The day', site: 'The site', habitat: 'The habitat' }

/** A multiplicative factor, weighed: 1 is the rule, 0 neutral, 2 twice the pull. */
export function weigh(mult: number, w: number): number {
  return 1 + (mult - 1) * w
}

export function weightLabel(w: number): string {
  if (w <= 0) return 'off'
  if (w < 0.75) return 'half'
  if (w <= 1.25) return 'normal'
  if (w < 1.75) return 'more'
  return 'double'
}

/** One line of a point's case: a component, its raw value, its weight. */
export interface Part {
  key: WeightKey
  label: string
  /** the component's value: a multiplier (site, day) or a habitat bonus */
  value: number
  kind: 'mult' | 'bonus'
  note?: string
}

/** The whole case for one point, for the breakdown view. */
export interface PointCase {
  score: number
  reasons: string[]
  /** the habitat's parts: base value and bonuses, in score units */
  habitat: Part[]
  /** the site's multipliers */
  site: Part[]
  /** the day's factors, weighed */
  day: Part[]
  /** the plain products, for the arithmetic line */
  habitatScore: number
  siteMult: number
  dayMult: number
}
