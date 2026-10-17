import { create } from 'zustand'

/** The line the measurement reads: the map's straight line, or walking it,
 *  the ground's ups and downs counted (Gavan, 2026-10-17). */
export type MeasureLine = 'straight' | 'walking'

interface MeasureOpts {
  line: MeasureLine
  /** the elevation trace under the card */
  trace: boolean
  /** on the trace: the trees over the ground, and each leg's sight line */
  sight: boolean
}

// the options are how this person likes to measure, kept on the phone; the points are not
const OPTS_KEY = 'huntapp-measure-opts'

function readOpts(): MeasureOpts {
  const d: MeasureOpts = { line: 'straight', trace: false, sight: true }
  try {
    const j = JSON.parse(localStorage.getItem(OPTS_KEY) ?? '{}') as Partial<MeasureOpts>
    return { line: j.line === 'walking' ? 'walking' : d.line, trace: typeof j.trace === 'boolean' ? j.trace : d.trace, sight: typeof j.sight === 'boolean' ? j.sight : d.sight }
  } catch {
    return d
  }
}

function keepOpts(o: MeasureOpts) {
  try {
    localStorage.setItem(OPTS_KEY, JSON.stringify(o))
  } catch {
    /* private mode: for this run only */
  }
}

/** The measuring tool's points, in the order they were dropped. Deliberately
 *  not persisted — a measurement is a question you ask and answer on the spot. */
interface MeasureState extends MeasureOpts {
  active: boolean
  points: [number, number][]
  /** what the first point is: you (location on), a spot (Dig in), or nothing yet */
  from: 'you' | 'spot' | null
  /** the place on the line a finger is on along the trace, shown on the map */
  scrub: [number, number] | null
  /** Open the tool; with a point, that is the first one dropped. */
  start: (p?: [number, number], from?: 'you' | 'spot') => void
  /** Leave the tool; the measurement goes with it. */
  stop: () => void
  addPoint: (p: [number, number]) => void
  movePoint: (idx: number, p: [number, number]) => void
  removePoint: (idx: number) => void
  undo: () => void
  clear: () => void
  setLine: (line: MeasureLine) => void
  setTrace: (on: boolean) => void
  setSight: (on: boolean) => void
  setScrub: (p: [number, number] | null) => void
}

export const useMeasureStore = create<MeasureState>((set, get) => {
  const opts = (o: Partial<MeasureOpts>) => {
    const next = { line: get().line, trace: get().trace, sight: get().sight, ...o }
    keepOpts(next)
    set(o)
  }
  return {
    ...readOpts(),
    active: false,
    points: [],
    from: null,
    scrub: null,
    start: (p, from) => set(p ? { active: true, points: [p], from: from ?? 'spot' } : { active: true, from: null }),
    stop: () => set({ active: false, points: [], from: null, scrub: null }),
    addPoint: (p) => set((s) => ({ points: [...s.points, p] })),
    // the first point moved or taken away is no longer you
    movePoint: (idx, p) => set((s) => ({ points: s.points.map((q, i) => (i === idx ? p : q)), from: idx === 0 ? null : s.from })),
    removePoint: (idx) => set((s) => ({ points: s.points.filter((_, i) => i !== idx), from: idx === 0 ? null : s.from })),
    undo: () => set((s) => ({ points: s.points.slice(0, -1), from: s.points.length <= 1 ? null : s.from })),
    clear: () => set({ points: [], from: null, scrub: null }),
    setLine: (line) => opts({ line }),
    setTrace: (trace) => opts({ trace }),
    setSight: (sight) => opts({ sight }),
    setScrub: (scrub) => set({ scrub }),
  }
})
