import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { isFish, type Target } from '../spots/types'
import { FISH_HERE, defaultTarget, targetStanding } from '../spots/profile'
import type { ScoreResult } from '../spots/scoring'
import type { Conditions } from '../spots/conditions'
import type { DayPlan, HourActivity } from '../spots/dayPlan'
import { DEFAULT_WEIGHTS, type WeightKey, type Weights } from '../spots/weights'

export type HeatScale = 'day' | 'fixed'

/** A fresh phone's knobs: the model's rule (DEFAULT_WEIGHTS, which Reset
 *  puts back) with roads and landings off, as Gavan has it (2026-10-03). */
const START_WEIGHTS: Weights = { ...DEFAULT_WEIGHTS, access: 0 }

interface SpotsState {
  /** what we are after */
  target: Target
  setTarget: (t: Target) => void
  /** draw the heat map on the map */
  heat: boolean
  setHeat: (v: boolean) => void
  /** what the heat's colours are measured against: the day's own best
   *  ('day': the top of the range lights up, so a poor day still says where
   *  to go) or the fixed scale the scores use ('fixed') */
  heatScale: HeatScale
  setHeatScale: (v: HeatScale) => void
  /** how boldly the heat is painted, 0.5 … 1.5 */
  heatStrength: number
  setHeatStrength: (v: number) => void
  /** the knobs on the scorer (spots/weights.ts); persisted */
  weights: Weights
  setWeight: (k: WeightKey, v: number) => void
  resetWeights: () => void
  /** the point Dig in is open on; never the scoring subject, so the heat, pins and strip subject stay put (not persisted) */
  digIn: { lon: number; lat: number } | null
  setDigIn: (p: { lon: number; lat: number } | null) => void
  /** the latest scoring pass (not persisted) */
  result: ScoreResult | null
  conditions: Conditions | null
  /** the week's morning and evening windows (not persisted) */
  plans: DayPlan[]
  /** the quarry's activity every hour of the forecast, for the strip's bars (not persisted) */
  hours: HourActivity[]
  setHours: (h: HourActivity[]) => void
  status: 'idle' | 'no-grid' | 'no-forecast' | 'ready'
  setResult: (r: ScoreResult | null, c: Conditions | null, status: SpotsState['status'], plans?: DayPlan[]) => void
}

export const useSpotsStore = create<SpotsState>()(
  persist(
    (set) => ({
      // what this place has (spots/profile.ts defaultTarget): moose where there are moose, deer in Luther
      target: defaultTarget(),
      setTarget: (target) => set({ target }),
      // a fresh phone's are Gavan's (2026-10-03): the heat off (the Bow view has none),
      // and roads and landings not counted
      heat: false,
      setHeat: (heat) => set({ heat }),
      heatScale: 'day',
      setHeatScale: (heatScale) => set({ heatScale }),
      heatStrength: 1,
      setHeatStrength: (v) => set({ heatStrength: Math.max(0.5, Math.min(1.5, v)) }),
      weights: START_WEIGHTS,
      setWeight: (k, v) => set((s) => ({ weights: { ...s.weights, [k]: Math.max(0, Math.min(2, v)) } })),
      resetWeights: () => set({ weights: DEFAULT_WEIGHTS }),
      digIn: null,
      setDigIn: (digIn) => set({ digIn }),
      result: null,
      conditions: null,
      plans: [],
      hours: [],
      setHours: (hours) => set({ hours }),
      status: 'idle',
      setResult: (result, conditions, status, plans) => set({ result, conditions, status, ...(plans ? { plans } : {}) }),
    }),
    {
      name: 'huntapp-spots',
      partialize: (s) => ({ target: s.target, heat: s.heat, heatScale: s.heatScale, heatStrength: s.heatStrength, weights: s.weights }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<SpotsState>
        // a quarry saved elsewhere that is not here (deer in the Yukon mountains, moose in Luther, a fish
        // outside Ontario) comes back as what this place has (Gavan, 2026-10-24: "default to heatmap is
        // moose even if the location doesn't support it")
        const target = p.target && (isFish(p.target) ? !FISH_HERE : !targetStanding(p.target).show) ? defaultTarget() : p.target
        return { ...current, ...p, target: target ?? current.target, weights: { ...START_WEIGHTS, ...(p.weights ?? {}) } }
      },
    },
  ),
)

/** True when any knob is off its default. */
export function weightsTuned(w: Weights): boolean {
  return (Object.keys(DEFAULT_WEIGHTS) as WeightKey[]).some((k) => w[k] !== 1)
}
