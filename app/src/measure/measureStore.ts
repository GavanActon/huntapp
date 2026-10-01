import { create } from 'zustand'
import { usableFix } from '../tracking/hereFix'

/** The measuring tool's points, in the order they were dropped. Deliberately
 *  not persisted — a measurement is a question you ask and answer on the spot. */
interface MeasureState {
  active: boolean
  /** where the first leg starts: where you stand, or the first point tapped */
  from: 'you' | 'map'
  points: [number, number][]
  start: () => void
  /** Leave the tool; the measurement goes with it. */
  stop: () => void
  setFrom: (v: 'you' | 'map') => void
  addPoint: (p: [number, number]) => void
  movePoint: (idx: number, p: [number, number]) => void
  removePoint: (idx: number) => void
  undo: () => void
  clear: () => void
}

export const useMeasureStore = create<MeasureState>((set) => ({
  active: false,
  from: 'map',
  points: [],
  // with a fix worth trusting the usual question is "how far is that from
  // here"; planning at camp with the phone indoors, it is point to point
  start: () => set({ active: true, from: usableFix() ? 'you' : 'map' }),
  stop: () => set({ active: false, points: [] }),
  setFrom: (from) => set({ from }),
  addPoint: (p) => set((s) => ({ points: [...s.points, p] })),
  movePoint: (idx, p) => set((s) => ({ points: s.points.map((q, i) => (i === idx ? p : q)) })),
  removePoint: (idx) => set((s) => ({ points: s.points.filter((_, i) => i !== idx) })),
  undo: () => set((s) => ({ points: s.points.slice(0, -1) })),
  clear: () => set({ points: [] }),
}))

/** True when the line leads with the live fix rather than a tapped point,
 *  so the first leg runs from where you stand and moves with you. */
export function fixLeads(): boolean {
  return useMeasureStore.getState().from === 'you' && usableFix() != null
}

/** The line as it is drawn and summed: where you stand first, when the tool
 *  starts from you and the fix is good, then the points tapped. */
export function measurePoints(): [number, number][] {
  const { from, points } = useMeasureStore.getState()
  const f = from === 'you' ? usableFix() : null
  return f ? [[f.lon, f.lat], ...points] : points
}
