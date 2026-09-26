import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Target } from '../spots/types'
import type { ScoreResult } from '../spots/scoring'
import type { Conditions } from '../spots/conditions'
import type { DayPlan } from '../spots/dayPlan'
import { DEFAULT_WEIGHTS, type WeightKey, type Weights } from '../spots/weights'

/** How much of the reasoning to show: the verdict alone, the short case,
 *  or every factor, reason and note. */
export type SpotsDetail = 'brief' | 'normal' | 'full'
export const DETAIL_NAMES: Record<SpotsDetail, string> = { brief: 'Brief', normal: 'Normal', full: 'Full' }

export interface Probe {
  lon: number
  lat: number
  name: string
}

interface SpotsState {
  /** what we are after */
  target: Target
  setTarget: (t: Target) => void
  /** draw the heat map on the map */
  heat: boolean
  setHeat: (v: boolean) => void
  /** draw the scent cone from the selected place */
  scent: boolean
  setScent: (v: boolean) => void
  /** how much of the reasoning to show */
  detail: SpotsDetail
  setDetail: (d: SpotsDetail) => void
  /** the knobs on the scorer (spots/weights.ts); persisted */
  weights: Weights
  setWeight: (k: WeightKey, v: number) => void
  resetWeights: () => void
  /** a tapped point under examination, when no saved place is selected */
  probe: Probe | null
  setProbe: (p: Probe | null) => void
  /** the latest scoring pass (not persisted) */
  result: ScoreResult | null
  conditions: Conditions | null
  /** the week's morning and evening windows (not persisted) */
  plans: DayPlan[]
  status: 'idle' | 'no-grid' | 'no-forecast' | 'ready'
  setResult: (r: ScoreResult | null, c: Conditions | null, status: SpotsState['status'], plans?: DayPlan[]) => void
}

export const useSpotsStore = create<SpotsState>()(
  persist(
    (set) => ({
      target: 'moose',
      setTarget: (target) => set({ target }),
      heat: true,
      setHeat: (heat) => set({ heat }),
      scent: true,
      setScent: (scent) => set({ scent }),
      detail: 'normal',
      setDetail: (detail) => set({ detail }),
      weights: DEFAULT_WEIGHTS,
      setWeight: (k, v) => set((s) => ({ weights: { ...s.weights, [k]: Math.max(0, Math.min(2, v)) } })),
      resetWeights: () => set({ weights: DEFAULT_WEIGHTS }),
      probe: null,
      setProbe: (probe) => set({ probe }),
      result: null,
      conditions: null,
      plans: [],
      status: 'idle',
      setResult: (result, conditions, status, plans) => set({ result, conditions, status, ...(plans ? { plans } : {}) }),
    }),
    {
      name: 'huntapp-spots',
      partialize: (s) => ({ target: s.target, heat: s.heat, scent: s.scent, detail: s.detail, weights: s.weights }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<SpotsState>
        return { ...current, ...p, weights: { ...DEFAULT_WEIGHTS, ...(p.weights ?? {}) } }
      },
    },
  ),
)

/** True when any knob is off its default. */
export function weightsTuned(w: Weights): boolean {
  return (Object.keys(DEFAULT_WEIGHTS) as WeightKey[]).some((k) => w[k] !== 1)
}
