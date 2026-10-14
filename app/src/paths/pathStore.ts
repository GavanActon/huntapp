import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { revealMark } from '../state/appStore'

/**
 * Where you plan to walk: dotted lines drawn freehand on the map with a
 * finger (Gavan, 2026-10-14: "dotted lines to show where I plan on
 * walking", and "it's the freehand I actually want"). One stroke is one
 * path: lift the finger and that path is done, draw again and that is the
 * next one; back takes off the last one drawn ("be smart about a second
 * path"). Kept on the phone until deleted, unlike the ruler's tape.
 */

export interface PlannedPath {
  id: string
  points: [number, number][]
  color: string
  name?: string
  savedAt: number
}

/** The order a new path takes its colour in, the first not on the map already: cream reads on the photo and the shade alike. */
const PATH_COLOURS = ['#f4f1e8', '#ff8a80', '#e0a0ff', '#9be36a', '#3fc8ff', '#ffb454', '#59e0b8', '#c9a227'] as const

/** The colour the next path drawn takes. */
export function nextColour(paths: PlannedPath[]): string {
  const used = new Set(paths.map((p) => p.color))
  return PATH_COLOURS.find((c) => !used.has(c)) ?? PATH_COLOURS[paths.length % PATH_COLOURS.length]
}

interface PathState {
  paths: PlannedPath[]
  /** the Path button down: a stroke on the map is a path. Not persisted */
  drawing: boolean
  /** the paths drawn since it went down, oldest first: what back takes off. Not persisted */
  drawn: string[]
  start: () => void
  /** A finished stroke: a path of its own, in the next colour. */
  addPath: (points: [number, number][]) => void
  /** Take off the last path drawn since the button went down. */
  undo: () => void
  done: () => void
  remove: (id: string) => void
  update: (id: string, patch: Partial<Pick<PlannedPath, 'color' | 'name'>>) => void
  removeAll: () => void
}

export const usePaths = create<PathState>()(
  persist(
    (set, get) => ({
      paths: [],
      drawing: false,
      drawn: [],
      start: () => set({ drawing: true, drawn: [] }),
      addPath: (points) => {
        if (points.length < 2) return
        const { paths, drawn } = get()
        const p: PlannedPath = { id: `w-${Date.now().toString(36)}`, points, color: nextColour(paths), savedAt: Date.now() }
        set({ paths: [...paths, p], drawn: [...drawn, p.id] })
        revealMark('paths')
      },
      undo: () => {
        const { paths, drawn } = get()
        const last = drawn[drawn.length - 1]
        if (last) set({ paths: paths.filter((p) => p.id !== last), drawn: drawn.slice(0, -1) })
      },
      done: () => set({ drawing: false, drawn: [] }),
      remove: (id) => set((s) => ({ paths: s.paths.filter((p) => p.id !== id), drawn: s.drawn.filter((d) => d !== id) })),
      update: (id, patch) => set((s) => ({ paths: s.paths.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),
      removeAll: () => set({ paths: [], drawn: [] }),
    }),
    {
      name: 'huntapp-paths',
      partialize: (s) => ({ paths: s.paths }),
    },
  ),
)

/** The Path button down: the map's one-finger strokes draw. */
export const drawingPath = (): boolean => usePaths.getState().drawing
