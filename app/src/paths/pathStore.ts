import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { revealMark } from '../state/appStore'

/**
 * Where you plan to walk: dotted lines drawn freehand on the map with a
 * finger (Gavan, 2026-10-14: "dotted lines to show where I plan on
 * walking", and "it's the freehand I actually want"). A tap adds a straight
 * leg. Kept on the phone until deleted, unlike the ruler's tape. One is
 * drawn at a time, a new one or a kept one opened to edit.
 */

export interface PlannedPath {
  id: string
  points: [number, number][]
  color: string
  name?: string
  savedAt: number
}

/** The path being drawn: a new one (id null) or a kept one opened to edit. */
export interface PathDraft {
  id: string | null
  points: [number, number][]
  color: string
  /** where each stroke (or tap) starts in `points`, for Undo; a kept path opened to edit is one stroke */
  strokes: number[]
}

/** The order a new path takes its colour in, the first not on the map already: cream reads on the photo and the shade alike. */
const PATH_COLOURS = ['#f4f1e8', '#ff8a80', '#e0a0ff', '#9be36a', '#3fc8ff', '#ffb454', '#59e0b8', '#c9a227'] as const

interface PathState {
  paths: PlannedPath[]
  /** not persisted: a draft left open when the app closed is not a plan */
  draft: PathDraft | null
  /** Draw a new path, or open a kept one to edit. */
  start: (id?: string) => void
  /** A stroke drawn, or a tap's one point: it carries on from the end of the path. */
  addStroke: (pts: [number, number][]) => void
  addPoint: (p: [number, number]) => void
  /** Take back the last stroke. */
  undo: () => void
  clear: () => void
  /** Keep the draft (two points or more); a kept path cut below two goes. */
  done: () => void
  remove: (id: string) => void
  update: (id: string, patch: Partial<Pick<PlannedPath, 'color' | 'name'>>) => void
  removeAll: () => void
}

export const usePaths = create<PathState>()(
  persist(
    (set, get) => ({
      paths: [],
      draft: null,
      start: (id) => {
        const kept = id ? get().paths.find((p) => p.id === id) : undefined
        if (kept) return set({ draft: { id: kept.id, points: kept.points, color: kept.color, strokes: [0] } })
        const used = new Set(get().paths.map((p) => p.color))
        set({ draft: { id: null, points: [], color: PATH_COLOURS.find((c) => !used.has(c)) ?? PATH_COLOURS[0], strokes: [] } })
      },
      addStroke: (pts) => {
        const d = get().draft
        if (!d || !pts.length) return
        set({ draft: { ...d, points: [...d.points, ...pts], strokes: [...d.strokes, d.points.length] } })
      },
      addPoint: (p) => get().addStroke([p]),
      undo: () => {
        const d = get().draft
        if (!d || !d.strokes.length) return
        const from = d.strokes[d.strokes.length - 1]
        set({ draft: { ...d, points: d.points.slice(0, from), strokes: d.strokes.slice(0, -1) } })
      },
      clear: () => set((s) => (s.draft ? { draft: { ...s.draft, points: [], strokes: [] } } : {})),
      done: () => {
        const { draft, paths } = get()
        if (!draft) return
        if (draft.points.length < 2) return set({ draft: null, paths: draft.id ? paths.filter((p) => p.id !== draft.id) : paths })
        if (draft.id) return set({ draft: null, paths: paths.map((p) => (p.id === draft.id ? { ...p, points: draft.points, color: draft.color } : p)) })
        set({ draft: null, paths: [...paths, { id: `w-${Date.now().toString(36)}`, points: draft.points, color: draft.color, savedAt: Date.now() }] })
        revealMark('paths')
      },
      remove: (id) => set((s) => ({ paths: s.paths.filter((p) => p.id !== id) })),
      update: (id, patch) => set((s) => ({ paths: s.paths.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),
      removeAll: () => set({ paths: [] }),
    }),
    {
      name: 'huntapp-paths',
      partialize: (s) => ({ paths: s.paths }),
    },
  ),
)

/** A path being drawn: the map's tap is the next point. */
export const drawingPath = (): boolean => usePaths.getState().draft != null
