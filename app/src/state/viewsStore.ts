import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEFAULT_LAYERS, DEFAULT_OPACITY, useAppStore, type LayerOpacity, type LayerVisibility } from './appStore'
import { useSpotsStore } from './spotsStore'
import { isFish, type Target } from '../spots/types'

/**
 * Modes and views: the map at a glance. A mode is what the day is for
 * (hunting or fishing) and carries its own Spots target; a view is a named
 * set of layers, their strengths and the heat map, one tap away on the main
 * screen. Each mode comes with a few views built in, and any map can be
 * saved as a view of its own. The views hold no state of their own: which
 * one is "on" is simply whichever matches the layers now, so a switch
 * flipped in Layers shows as "custom" without anything going stale.
 */

export type Mode = 'hunt' | 'fish'
export const MODE_NAMES: Record<Mode, string> = { hunt: 'Hunt', fish: 'Fish' }

export interface MapView {
  id: string
  name: string
  mode: Mode
  layers: LayerVisibility
  opacity: LayerOpacity
  heat: boolean
  builtIn?: boolean
}

const L = (on: (keyof LayerVisibility)[]): LayerVisibility =>
  Object.fromEntries(Object.keys(DEFAULT_LAYERS).map((k) => [k, on.includes(k as keyof LayerVisibility)])) as unknown as LayerVisibility

export const BUILT_IN: MapView[] = [
  { id: 'hunt-scout', name: 'Scout', mode: 'hunt', builtIn: true, heat: true, opacity: DEFAULT_OPACITY, layers: L(['satellite', 'contours', 'forest', 'fire', 'roads']) },
  { id: 'hunt-sit', name: 'Sit', mode: 'hunt', builtIn: true, heat: false, opacity: DEFAULT_OPACITY, layers: L(['satellite', 'contours', 'windFlow', 'roads']) },
  { id: 'hunt-terrain', name: 'Terrain', mode: 'hunt', builtIn: true, heat: false, opacity: { ...DEFAULT_OPACITY, hillshade: 0.9 }, layers: L(['hillshade', 'contours', 'roads']) },
  { id: 'hunt-land', name: 'Land', mode: 'hunt', builtIn: true, heat: false, opacity: DEFAULT_OPACITY, layers: L(['satellite', 'crown', 'wmu', 'camps', 'parks', 'roads']) },
  { id: 'fish-lake', name: 'Lake', mode: 'fish', builtIn: true, heat: true, opacity: DEFAULT_OPACITY, layers: L(['satellite', 'bathy', 'windFlow']) },
  { id: 'fish-chart', name: 'Chart', mode: 'fish', builtIn: true, heat: true, opacity: DEFAULT_OPACITY, layers: L(['bathy', 'topo']) },
]

interface ViewsState {
  mode: Mode
  /** the user's own views (the built-ins are not stored) */
  saved: MapView[]
  /** the last target used in each mode, so switching back picks it up */
  lastTarget: Record<Mode, Target>
  setMode: (m: Mode) => void
  apply: (v: MapView) => void
  saveCurrent: (name: string) => MapView
  remove: (id: string) => void
}

export const useViews = create<ViewsState>()(
  persist(
    (set, get) => ({
      mode: 'hunt',
      saved: [],
      lastTarget: { hunt: 'moose', fish: 'walleye' },
      setMode: (mode) => {
        const s = get()
        if (mode === s.mode) return
        const sp = useSpotsStore.getState()
        const lastTarget = { ...s.lastTarget, [s.mode]: sp.target }
        set({ mode, lastTarget })
        if (isFish(sp.target) !== (mode === 'fish')) sp.setTarget(lastTarget[mode])
        // the mode's first view, so the map follows the day's purpose
        const first = viewsFor(mode)[0]
        if (first) get().apply(first)
      },
      apply: (v) => {
        useAppStore.setState({ layers: { ...DEFAULT_LAYERS, ...v.layers }, opacity: { ...DEFAULT_OPACITY, ...v.opacity } })
        useSpotsStore.getState().setHeat(v.heat)
      },
      saveCurrent: (name) => {
        const a = useAppStore.getState()
        const v: MapView = { id: `v${Date.now().toString(36)}`, name, mode: get().mode, layers: { ...a.layers }, opacity: { ...a.opacity }, heat: useSpotsStore.getState().heat }
        set((s) => ({ saved: [...s.saved, v] }))
        return v
      },
      remove: (id) => set((s) => ({ saved: s.saved.filter((v) => v.id !== id) })),
    }),
    { name: 'huntapp-views', partialize: (s) => ({ mode: s.mode, saved: s.saved, lastTarget: s.lastTarget }) },
  ),
)

/** The views on offer in a mode: built in first, then the user's. */
export function viewsFor(mode: Mode, saved = useViews.getState().saved): MapView[] {
  return [...BUILT_IN.filter((v) => v.mode === mode), ...saved.filter((v) => v.mode === mode)]
}

/** The view the map is showing now, if any: layers and heat match exactly. */
export function activeView(views: MapView[], layers: LayerVisibility, heat: boolean): MapView | null {
  return views.find((v) => v.heat === heat && (Object.keys(DEFAULT_LAYERS) as (keyof LayerVisibility)[]).every((k) => !!v.layers[k] === !!layers[k])) ?? null
}

// a fish picked in Spots while hunting (or the reverse) is a change of mode:
// follow it, but leave the map as it is
useSpotsStore.subscribe((s, p) => {
  if (s.target === p.target) return
  const want: Mode = isFish(s.target) ? 'fish' : 'hunt'
  if (useViews.getState().mode !== want) useViews.setState({ mode: want })
})
