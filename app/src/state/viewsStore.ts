import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEFAULT_LAYERS, DEFAULT_OPACITY, fineDetail, useAppStore, type LayerOpacity, type LayerVisibility, type MapDetail, type WindStyle } from './appStore'
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
 * `pinned` is the user's pick of views for the top of the pill menu, in the
 * order they want them (the Views sheet: a star pins, a drag orders); the
 * rest wait under `More ›`. A fresh phone pins the first few built-ins.
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
  /** the wind's look the view brings, with the wind on: the Wind view's
   *  Contrast. A view without one hands back the look there was before. */
  wind?: WindStyle
  /** how much the map draws while the view is on (appStore MapDetail); 'full' if unset */
  detail?: MapDetail
}

const L = (on: (keyof LayerVisibility)[]): LayerVisibility =>
  Object.fromEntries(Object.keys(DEFAULT_LAYERS).map((k) => [k, on.includes(k as keyof LayerVisibility)])) as unknown as LayerVisibility

export const BUILT_IN: MapView[] = [
  // the wind: the Topo view's ground under the streaks in the Contrast look, white over a wash coloured by
  // speed (Gavan, 2026-10-07: "a default view, call it Wind, the Windy version plus topo");
  // the light Topo's ground, as Topo is (2026-10-08: "wind on light topo")
  { id: 'hunt-wind', name: 'Wind', mode: 'hunt', builtIn: true, heat: false, detail: 'light', opacity: { ...DEFAULT_OPACITY, hillshade: 0.7 }, layers: L(['relief', 'hillshade', 'contours', 'roads', 'windFlow']), wind: 'contrast' },
  { id: 'hunt-scout', name: 'Scout', mode: 'hunt', builtIn: true, heat: true, opacity: DEFAULT_OPACITY, layers: L(['satellite', 'contours', 'forest', 'fire', 'roads']) },
  { id: 'hunt-bush', name: 'Bush', mode: 'hunt', builtIn: true, heat: false, opacity: DEFAULT_OPACITY, layers: L(['satellite', 'understory', 'contours', 'roads']) },
  // out hunting with a bow: the imagery at full strength, open lanes left clear and
  // thick bush shaded dark (the lanes layer, not the colour scale, which washes it out),
  // and the shade at 0.35: in the box that is the DEM-drawn one, drawn hard over the imagery
  // (reliefShadePaint), which carries the hills and the old skid trails; the 1 m LiDAR one
  // showed next to nothing at this strength over the imagery, so it stays off (lidarShadeShown).
  // A hunting view: all its detail once the area's maps are saved, light until then (the
  // lanes only from the phone's copy too: apply)
  { id: 'hunt-bow', name: 'Bow', mode: 'hunt', builtIn: true, heat: false, detail: 'auto', opacity: { ...DEFAULT_OPACITY, hillshade: 0.35, satellite: 1 }, layers: L(['satellite', 'hillshade', 'lanes', 'contours', 'roads']) },
  // light, for streaming (Gavan, 2026-10-08: a low-weight view, Bow its hunting version):
  // the photo whole with the contours and roads, about half of Bow's bytes on a zoom in
  { id: 'hunt-photo', name: 'Photo', mode: 'hunt', builtIn: true, heat: false, detail: 'light', opacity: { ...DEFAULT_OPACITY, satellite: 1 }, layers: L(['satellite', 'contours', 'roads']) },
  { id: 'hunt-terrain', name: 'Terrain', mode: 'hunt', builtIn: true, heat: false, opacity: { ...DEFAULT_OPACITY, hillshade: 0.9 }, layers: L(['hillshade', 'contours', 'roads']) },
  { id: 'hunt-sit', name: 'Sit', mode: 'hunt', builtIn: true, heat: false, opacity: DEFAULT_OPACITY, layers: L(['satellite', 'contours', 'roads']) },
  // light, saved maps or not: the elevation colours with their own shade, without the 1 m
  // LiDAR veil, a fifth of the bytes it had on a zoom in (Gavan, 2026-10-08: "topo light
  // looks great, make that topo")
  { id: 'hunt-relief', name: 'Topo', mode: 'hunt', builtIn: true, heat: false, detail: 'light', opacity: { ...DEFAULT_OPACITY, hillshade: 0.7 }, layers: L(['relief', 'hillshade', 'contours', 'roads']) },
  { id: 'hunt-land', name: 'Land', mode: 'hunt', builtIn: true, heat: false, opacity: DEFAULT_OPACITY, layers: L(['satellite', 'crown', 'wmu', 'camps', 'parks', 'roads']) },
  { id: 'fish-lake', name: 'Lake', mode: 'fish', builtIn: true, heat: true, opacity: DEFAULT_OPACITY, layers: L(['satellite', 'bathy']) },
  { id: 'fish-chart', name: 'Chart', mode: 'fish', builtIn: true, heat: true, opacity: DEFAULT_OPACITY, layers: L(['bathy', 'topo']) },
]

/** The views pinned at the top of the pill menu on a fresh phone (Gavan's, 2026-10-03: Scout too;
 *  2026-10-07: "base load should be Bow with range on", so Bow first and the phone opens on it;
 *  2026-10-08: Photo after Bow, its hunting version). */
export const DEFAULT_PINNED: Record<Mode, string[]> = {
  hunt: ['hunt-bow', 'hunt-photo', 'hunt-wind', 'hunt-relief', 'hunt-bush', 'hunt-terrain', 'hunt-scout'],
  fish: ['fish-lake', 'fish-chart'],
}

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
  /** per mode, the views at the top of the pill menu, in order; the rest sit under More */
  pinned: Record<Mode, string[]>
  /** the wind's look from before a view brought its own (the Wind view's
   *  Contrast), handed back when a view without one goes on; null when the
   *  look on is the hunter's own */
  lookBefore: WindStyle | null
  /** the look picked by hand is the hunter's own: nothing to hand back */
  keepLook: () => void
  setMode: (m: Mode) => void
  apply: (v: MapView) => void
  saveCurrent: (name: string) => MapView
  /** rewrite a saved view's layers, strengths and heat from the map as it is now */
  update: (id: string) => void
  remove: (id: string) => void
  /** pin a view to the top of the menu (at the end of the pinned), or take it back under More */
  togglePin: (id: string) => void
  /** the pinned views of a mode in a new order (the Views sheet's drag) */
  setPinned: (mode: Mode, ids: string[]) => void
}

/** A phone that has kept no views yet: read before the store is made, which may write its key. */
const freshPhone = (() => {
  try {
    return localStorage.getItem('huntapp-views') == null
  } catch {
    return false
  }
})()

export const useViews = create<ViewsState>()(
  persist(
    (set, get) => ({
      mode: 'hunt',
      saved: [],
      // a fresh phone starts in the Bow view (appStore DEFAULT_LAYERS), lake trout for the fishing side: Gavan's
      lastTarget: { hunt: 'moose', fish: 'laketrout' },
      lastViewId: 'hunt-bow',
      pinned: { hunt: [...DEFAULT_PINNED.hunt], fish: [...DEFAULT_PINNED.fish] },
      lookBefore: null,
      keepLook: () => set({ lookBefore: null }),
      setMode: (mode) => {
        const s = get()
        if (mode === s.mode) return
        const sp = useSpotsStore.getState()
        const lastTarget = { ...s.lastTarget, [s.mode]: sp.target }
        set({ mode, lastTarget })
        if (isFish(sp.target) !== (mode === 'fish')) sp.setTarget(lastTarget[mode])
        // the mode's first pinned view, so the map follows the day's purpose
        const { top, rest } = splitViews(mode)
        const first = top[0] ?? rest[0]
        if (first) get().apply(first)
      },
      apply: (v) => {
        const a = useAppStore.getState()
        // the wind keeps its own button, unless the view is about the wind
        const windFlow = v.wind ? true : a.layers.windFlow
        // a hunting view's shooting lanes come from the phone's copy: streaming, they wait,
        // and their button says so (a tap still brings them)
        const detail = v.detail ?? 'full'
        const lanes = !!v.layers.lanes && fineDetail({ detail, offlineReady: a.offlineReady })
        useAppStore.setState({ layers: { ...DEFAULT_LAYERS, ...v.layers, windFlow, lanes }, opacity: { ...DEFAULT_OPACITY, ...v.opacity }, detail })
        useSpotsStore.getState().setHeat(v.heat)
        const before = get().lookBefore
        if (v.wind) {
          set({ lookBefore: before ?? a.flowTuning.windStyle })
          a.setFlowTuning({ windStyle: v.wind })
        } else if (before) {
          a.setFlowTuning({ windStyle: before })
          set({ lookBefore: null })
        }
        set({ lastViewId: v.id })
      },
      saveCurrent: (name) => {
        const a = useAppStore.getState()
        const v: MapView = { id: `v${Date.now().toString(36)}`, name, mode: get().mode, layers: { ...a.layers }, opacity: { ...a.opacity }, heat: useSpotsStore.getState().heat, detail: a.detail }
        set((s) => ({ saved: [...s.saved, v], lastViewId: v.id }))
        return v
      },
      update: (id) => {
        const a = useAppStore.getState()
        const heat = useSpotsStore.getState().heat
        set((s) => ({ saved: s.saved.map((v) => (v.id === id ? { ...v, layers: { ...a.layers }, opacity: { ...a.opacity }, heat, detail: a.detail } : v)) }))
      },
      remove: (id) =>
        set((s) => ({
          saved: s.saved.filter((v) => v.id !== id),
          lastViewId: s.lastViewId === id ? null : s.lastViewId,
          pinned: { hunt: s.pinned.hunt.filter((x) => x !== id), fish: s.pinned.fish.filter((x) => x !== id) },
        })),
      togglePin: (id) => {
        const s = get()
        const v = [...BUILT_IN, ...s.saved].find((x) => x.id === id)
        if (!v) return
        const ids = s.pinned[v.mode]
        const next = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]
        set({ pinned: { ...s.pinned, [v.mode]: next } })
      },
      setPinned: (mode, ids) => set((s) => ({ pinned: { ...s.pinned, [mode]: ids } })),
    }),
    {
      name: 'huntapp-views',
      // 1: the pinned views (the top of the pill menu) are the user's to pick and order
      // 2: the hunting default is Topo, Bow, Bush, Terrain; a v1 list never touched follows it
      // 3: the Wind view, pinned first
      // 4: Bow first again, the Wind view second (a v3 list never touched follows it)
      // 5: the light Photo view after Bow (else at the end)
      // 6: Topo Lite became Topo (it was out for an hour): off the pins, a phone on it on Topo
      version: 6,
      migrate: (persisted, from) => {
        const p = (persisted ?? {}) as Partial<ViewsState>
        if (!p.pinned) p.pinned = { hunt: [...DEFAULT_PINNED.hunt], fish: [...DEFAULT_PINNED.fish] }
        else if (from < 2 && p.pinned.hunt.join() === 'hunt-scout,hunt-bush,hunt-bow,hunt-terrain') p.pinned = { ...p.pinned, hunt: [...DEFAULT_PINNED.hunt] }
        if (from < 3 && !p.pinned.hunt.includes('hunt-wind')) p.pinned = { ...p.pinned, hunt: ['hunt-wind', ...p.pinned.hunt] }
        if (from < 4 && p.pinned.hunt.join() === 'hunt-wind,hunt-relief,hunt-bow,hunt-bush,hunt-terrain,hunt-scout') p.pinned = { ...p.pinned, hunt: [...DEFAULT_PINNED.hunt] }
        if (from < 5 && !p.pinned.hunt.includes('hunt-photo')) {
          const hunt = [...p.pinned.hunt]
          const at = hunt.indexOf('hunt-bow')
          if (at >= 0) hunt.splice(at + 1, 0, 'hunt-photo')
          else hunt.push('hunt-photo')
          p.pinned = { ...p.pinned, hunt }
        }
        if (from < 6) {
          p.pinned = { ...p.pinned, hunt: p.pinned.hunt.filter((id) => id !== 'hunt-topo-lite') }
          if (p.lastViewId === 'hunt-topo-lite') p.lastViewId = 'hunt-relief'
        }
        return p as ViewsState
      },
      partialize: (s) => ({ mode: s.mode, saved: s.saved, lastTarget: s.lastTarget, lastViewId: s.lastViewId, pinned: s.pinned, lookBefore: s.lookBefore }),
    },
  ),
)

// a fresh phone opens on the Bow view (Gavan, 2026-10-07: "base load should be
// Bow with range on"), the shooting lanes waiting for the saved maps; the wind keeps flowing
if (freshPhone) {
  const bow = BUILT_IN.find((v) => v.id === 'hunt-bow')
  if (bow) useViews.getState().apply(bow)
}

// the detail follows the view last picked while the map still shows it: a phone
// from before views had one (all 'full') takes its view's, and a view whose detail
// changed (Topo, light since 2026-10-08) brings the new one
{
  const base = baseView()
  if (base && activeView([base], useAppStore.getState().layers)) useAppStore.setState({ detail: base.detail ?? 'full' })
}

/** The views on offer in a mode: built in first, then the user's. */
export function viewsFor(mode: Mode, saved = useViews.getState().saved): MapView[] {
  return [...BUILT_IN.filter((v) => v.mode === mode), ...saved.filter((v) => v.mode === mode)]
}

/** A mode's views split for the pill menu: `top`, the pinned ones in the
 *  user's order (ids that no longer exist are dropped), and `rest`, the
 *  others, built in first, for under `More ›`. */
export function splitViews(mode: Mode, saved = useViews.getState().saved, pinned = useViews.getState().pinned): { top: MapView[]; rest: MapView[] } {
  const all = viewsFor(mode, saved)
  const top = pinned[mode].map((id) => all.find((v) => v.id === id)).filter((v): v is MapView => !!v)
  return { top, rest: all.filter((v) => !top.includes(v)) }
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
