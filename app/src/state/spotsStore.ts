import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Target } from '../spots/types'
import type { ScoreResult } from '../spots/scoring'
import type { Conditions } from '../spots/conditions'

/** How much of the reasoning to show: the verdict alone, the short case,
 *  or every factor, reason and note. */
export type SpotsDetail = 'brief' | 'normal' | 'full'
export const DETAIL_NAMES: Record<SpotsDetail, string> = { brief: 'Brief', normal: 'Normal', full: 'Full' }

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
  /** the latest scoring pass (not persisted) */
  result: ScoreResult | null
  conditions: Conditions | null
  status: 'idle' | 'no-grid' | 'no-forecast' | 'ready'
  setResult: (r: ScoreResult | null, c: Conditions | null, status: SpotsState['status']) => void
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
      result: null,
      conditions: null,
      status: 'idle',
      setResult: (result, conditions, status) => set({ result, conditions, status }),
    }),
    { name: 'huntapp-spots', partialize: (s) => ({ target: s.target, heat: s.heat, scent: s.scent, detail: s.detail }) },
  ),
)
