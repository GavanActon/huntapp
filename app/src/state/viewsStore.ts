import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEFAULT_LAYERS, DEFAULT_OPACITY, useAppStore, type LayerOpacity, type LayerVisibility } from './appStore'
import { useSpotsStore } from './spotsStore'
import { isFish, type Target } from '../spots/types'

/**
 * Modes and views: the map at a glance. A mode is what the day is for
 * (hunting or fishing) and carries its own Spots target; a view is a named
 * set of layers and their strengths, one tap away on the main screen. Each
 * mode comes with a few views built in, and any map can be saved as a view
 * of its own. The views hold no state of their own beyond `lastViewId`, the
 * one last applied: which one is "on" is whichever matches the layers now,
 * so a switch flipped in Layers shows as "custom" without anything going
 * stale.
 *
 * The wind flow, the bush and lanes shades, the lake depths, the radar and
 * the heat map are not part of a view's match (VIEW_LOOSE_KEYS): they have
 * their own buttons on the map and stay as those buttons left them
 * whichever view goes on.
 */

export type Mode = 'hunt' | 'fish'

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
  { id: 'hunt-bush', name: 'Bush', mode: 'hunt', builtIn: true, heat: false, opacity: DEFAULT_OPACITY, layers: L(['satellite', 'understory', 'contours', 'roads']) },
  // out hunting with a bow: the imagery at full strength, open lanes left clear and
  // thick bush shaded dark (the lanes layer, not the colour scale, which washes it out),
  // and the grey 1 m LiDAR shade, light, for the old skid trails through the thick stuff
  { id: 'hunt-bow', name: 'Bow', mode: 'hunt', builtIn: true, heat: false, opacity: { ...DEFAULT_OPACITY, hillshade: 0.35, satellite: 1 }, layers: L(['satellite', 'hillshade', 'lanes', 'contours', 'roads']) },
  { id: 'hunt-terrain', name: 'Terrain', mode: 'hunt', builtIn: true, heat: false, opacity: { ...DEFAULT_OPACITY, hillshade: 0.9 }, layers: L(['hillshade', 'contours', 'roads']) },
  { id: 'hunt-sit', name: 'Sit', mode: 'hunt', builtIn: true, heat: false, opacity: DEFAULT_OPACITY, layers: L(['satellite', 'contours', 'roads']) },
  { id: 'hunt-relief', name: 'Relief', mode: 'hunt', builtIn: true, heat: false, opacity: { ...DEFAULT_OPACITY, hillshade: 0.7 }, layers: L(['relief', 'hillshade', 'contours', 'roads']) },
  { id: 'hunt-land', name: 'Land', mode: 'hunt', builtIn: true, heat: false, opacity: DEFAULT_OPACITY, layers: L(['satellite', 'crown', 'wmu', 'camps', 'parks', 'roads']) },
  { id: 'fish-lake', name: 'Lake', mode: 'fish', builtIn: true, heat: true, opacity: DEFAULT_OPACITY, layers: L(['satellite', 'bathy']) },
  { id: 'fish-chart', name: 'Chart', mode: 'fish', builtIn: true, heat: true, opacity: DEFAULT_OPACITY, layers: L(['bathy', 'topo']) },
]

/** Layers a view's match ignores: each has its own button on the map. */
export const VIEW_LOOSE_KEYS: (keyof LayerVisibility)[] = ['windFlow', 'understory', 'lanes', 'bathy', 'weather']

interface ViewsState {
  mode: Mode
  /** the user's own views (the built-ins are not stored) */
  saved: MapView[]
  /** the last target used in each mode, so switching back picks it up */
  lastTarget: Record<Mode, Target>
  /** the view last applied or saved; the pill's name and the editor's base */
  lastViewId: string | null
  setMode: (m: Mode) => void
  apply: (v: MapView) => void
  saveCurrent: (name: string) => MapView
  /** rewrite a saved view's layers, strengths and heat from the map as it is now */
  update: (id: string) => void
  remove: (id: string) => void
}

export const useViews = create<ViewsState>()(
  persist(
    (set, get) => ({
      mode: 'hunt',
      saved: [],
      lastTarget: { hunt: 'moose', fish: 'walleye' },
      lastViewId: 'hunt-scout',
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
        const windFlow = useAppStore.getState().layers.windFlow
        useAppStore.setState({ layers: { ...DEFAULT_LAYERS, ...v.layers, windFlow }, opacity: { ...DEFAULT_OPACITY, ...v.opacity } })
        useSpotsStore.getState().setHeat(v.heat)
        set({ lastViewId: v.id })
      },
      saveCurrent: (name) => {
        const a = useAppStore.getState()
        const v: MapView = { id: `v${Date.now().toString(36)}`, name, mode: get().mode, layers: { ...a.layers }, opacity: { ...a.opacity }, heat: useSpotsStore.getState().heat }
        set((s) => ({ saved: [...s.saved, v], lastViewId: v.id }))
        return v
      },
      update: (id) => {
        const a = useAppStore.getState()
        const heat = useSpotsStore.getState().heat
        set((s) => ({ saved: s.saved.map((v) => (v.id === id ? { ...v, layers: { ...a.layers }, opacity: { ...a.opacity }, heat } : v)) }))
      },
      remove: (id) => set((s) => ({ saved: s.saved.filter((v) => v.id !== id), lastViewId: s.lastViewId === id ? null : s.lastViewId })),
    }),
    { name: 'huntapp-views', partialize: (s) => ({ mode: s.mode, saved: s.saved, lastTarget: s.lastTarget, lastViewId: s.lastViewId }) },
  ),
)

/** The views on offer in a mode: built in first, then the user's. */
export function viewsFor(mode: Mode, saved = useViews.getState().saved): MapView[] {
  return [...BUILT_IN.filter((v) => v.mode === mode), ...saved.filter((v) => v.mode === mode)]
}

/** The view the map is showing now, if any: the layers match, leaving out
 *  the ones with their own buttons (VIEW_LOOSE_KEYS) and the heat map. */
export function activeView(views: MapView[], layers: LayerVisibility, _heat?: boolean): MapView | null {
  const keys = (Object.keys(DEFAULT_LAYERS) as (keyof LayerVisibility)[]).filter((k) => !VIEW_LOOSE_KEYS.includes(k))
  return views.find((v) => keys.every((k) => !!v.layers[k] === !!layers[k])) ?? null
}

/** The view the map was last set to: `lastViewId` among the mode's views,
 *  else the mode's first. The editor's title and its Reset. */
export function baseView(): MapView | null {
  const { mode, saved, lastViewId } = useViews.getState()
  const views = viewsFor(mode, saved)
  return views.find((v) => v.id === lastViewId) ?? views[0] ?? null
}

/** The view the map is showing now: the base view while the layers still
 *  match it, else whichever of the mode's views they match, else null
 *  (custom). The pill's name. */
export function currentView(): MapView | null {
  const { mode, saved } = useViews.getState()
  const layers = useAppStore.getState().layers
  const base = baseView()
  if (base && activeView([base], layers)) return base
  return activeView(viewsFor(mode, saved), layers)
}

/** The quarry chip: a fish while hunting (or the reverse) switches the mode
 *  first, which applies that mode's first view, then sets the target. */
export function pickTarget(t: Target): void {
  const want: Mode = isFish(t) ? 'fish' : 'hunt'
  if (want !== useViews.getState().mode) useViews.getState().setMode(want)
  useSpotsStore.getState().setTarget(t)
}

// a fish picked in Spots while hunting (or the reverse) is a change of mode:
// follow it, but leave the map as it is
useSpotsStore.subscribe((s, p) => {
  if (s.target === p.target) return
  const want: Mode = isFish(s.target) ? 'fish' : 'hunt'
  if (useViews.getState().mode !== want) useViews.setState({ mode: want })
})
