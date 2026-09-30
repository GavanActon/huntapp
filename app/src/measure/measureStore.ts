import { create } from 'zustand'

/** The measuring tool's points, in the order they were dropped. Deliberately
 *  not persisted — a measurement is a question you ask and answer on the spot. */
interface MeasureState {
  active: boolean
  points: [number, number][]
  /** what the first point is: you (location on), a spot (Dig in), or nothing yet */
  from: 'you' | 'spot' | null
  /** Open the tool; with a point, that is the first one dropped. */
  start: (p?: [number, number], from?: 'you' | 'spot') => void
  /** Leave the tool; the measurement goes with it. */
  stop: () => void
  addPoint: (p: [number, number]) => void
  movePoint: (idx: number, p: [number, number]) => void
  removePoint: (idx: number) => void
  undo: () => void
  clear: () => void
}

export const useMeasureStore = create<MeasureState>((set) => ({
  active: false,
  points: [],
  from: null,
  start: (p, from) => set(p ? { active: true, points: [p], from: from ?? 'spot' } : { active: true, from: null }),
  stop: () => set({ active: false, points: [], from: null }),
  addPoint: (p) => set((s) => ({ points: [...s.points, p] })),
  // the first point moved or taken away is no longer you
  movePoint: (idx, p) => set((s) => ({ points: s.points.map((q, i) => (i === idx ? p : q)), from: idx === 0 ? null : s.from })),
  removePoint: (idx) => set((s) => ({ points: s.points.filter((_, i) => i !== idx), from: idx === 0 ? null : s.from })),
  undo: () => set((s) => ({ points: s.points.slice(0, -1), from: s.points.length <= 1 ? null : s.from })),
  clear: () => set({ points: [], from: null }),
}))
