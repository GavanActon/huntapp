import { REGION } from '../config'
import { useAppStore, type LayerOpacity, type LayerVisibility } from '../state/appStore'
import { useSpotsStore } from '../state/spotsStore'
import { BUILT_IN, type MapView } from '../state/viewsStore'
import { layerHere } from './layerDefs'

/**
 * The parts the view pill, the Views sheet and Make your own share: a
 * view's picture and words, whether the area has what it draws, and a view
 * taken apart into what is underneath (one map: Sat, Topo, Shade, the Canada
 * map, the old map or the lake sheets) and what is on top (the switches).
 * Gavan, 2026-10-19: "map vs views? they are really both the same thing",
 * so a map is one view among the rest, and Make your own picks one of them
 * for the ground.
 */

/** A view's picture: a built-in's own (rendered at Pickle Lake, public/views), a user's view its ground's. */
export function viewPic(v: MapView): string {
  const pic = v.pic ?? GROUNDS.find((g) => g.id === groundOf(v.layers))?.pic ?? 'sat'
  return `${import.meta.env.BASE_URL}views/${pic}.webp`
}

/** The old sheets that came out blank: Highland Lake's 105M07 scan is flat grey. */
const OLD_MAP_BLANK = new Set(['highland-lake'])

/** The area has what the view draws. The views made for a job show
 *  whatever the area has (the grade tile says what HD adds); the maps one
 *  at a time are left out where there is no map to show. */
export function viewHere(v: MapView): boolean {
  if (v.id === 'hunt-old') return layerHere('historical') && !OLD_MAP_BLANK.has(REGION.id)
  if (v.id === 'hunt-depths') return layerHere('bathy')
  if (v.id === 'hunt-canada') return layerHere('toposheet')
  return true
}

/** Drawn from a live service: nothing to show with no signal. */
export const needsSignal = (v: MapView): boolean => v.layers.toposheet

export interface Ground {
  id: string
  name: string
  /** the built-in view that is this map alone: its layers, strengths and detail */
  viewId: string
  pic: string
}

/** The maps that go underneath, each a built-in view of its own. */
export const GROUNDS: Ground[] = [
  { id: 'sat', name: 'Sat', viewId: 'hunt-photo', pic: 'sat' },
  { id: 'topo', name: 'Topo', viewId: 'hunt-relief', pic: 'topo' },
  { id: 'shade', name: 'Shade', viewId: 'hunt-terrain', pic: 'shade' },
  { id: 'canada', name: 'Canada map', viewId: 'hunt-canada', pic: 'canada' },
  { id: 'old', name: 'Old map', viewId: 'hunt-old', pic: 'old' },
  { id: 'depths', name: 'Depths', viewId: 'hunt-depths', pic: 'depths' },
]

/** The layers that make the ground; the rest are on top or keep their own buttons. */
const GROUND_KEYS: (keyof LayerVisibility)[] = ['satellite', 'relief', 'hillshade', 'toposheet', 'historical', 'bathy', 'topo']
const GROUND_OPACITY: (keyof LayerOpacity)[] = ['satellite', 'relief', 'hillshade', 'historical', 'topo']

/** Which map is underneath, read off the layers, the paper maps first (they cover the rest). */
export function groundOf(l: LayerVisibility): string | null {
  if (l.toposheet) return 'canada'
  if (l.relief) return 'topo'
  if (l.historical && !l.satellite) return 'old'
  if (l.satellite) return 'sat'
  if (l.hillshade) return 'shade'
  if (l.bathy) return 'depths'
  return null
}

export const groundView = (g: Ground): MapView | undefined => BUILT_IN.find((v) => v.id === g.viewId)

/** Put a map underneath, what is on top left as it is. */
export function setGround(g: Ground): void {
  const v = groundView(g)
  if (!v) return
  const a = useAppStore.getState()
  const layers = { ...a.layers }
  for (const k of GROUND_KEYS) layers[k] = !!v.layers[k]
  const opacity = { ...a.opacity }
  for (const k of GROUND_OPACITY) opacity[k] = v.opacity[k]
  useAppStore.setState({ layers, opacity, detail: v.detail ?? 'full' })
}

export interface Top {
  key: keyof LayerVisibility | 'heat'
  name: string
}

/** What goes on top, in Make your own (the views mockup's list; the wind's streaks keep their own button). */
export const TOPS: Top[] = [
  { key: 'contours', name: 'Contours' },
  { key: 'lanes', name: 'Shooting lanes' },
  { key: 'understory', name: 'Bush thickness' },
  { key: 'windColours', name: 'Wind colours' },
  { key: 'forest', name: 'Forest' },
  { key: 'fire', name: 'Burns' },
  { key: 'roads', name: 'Roads' },
  { key: 'heat', name: 'Heat map' },
]

export const topHere = (t: Top): boolean => t.key === 'heat' || layerHere(t.key)

export function topOn(t: Top, layers: LayerVisibility, heat: boolean): boolean {
  return t.key === 'heat' ? heat : layers[t.key]
}

export function setTop(t: Top, on: boolean): void {
  if (t.key === 'heat') useSpotsStore.getState().setHeat(on)
  else useAppStore.getState().setLayer(t.key, on)
}

/** A user's view in words, for its row: "Sat with contours and roads". */
export function viewWhat(v: MapView): string {
  if (v.what) return v.what
  const ground = GROUNDS.find((g) => g.id === groundOf(v.layers))?.name ?? 'The base map'
  const tops = TOPS.filter((t) => topOn(t, v.layers, v.heat)).map((t) => t.name.toLowerCase())
  if (tops.length === 0) return ground
  const last = tops.pop()
  return `${ground} with ${tops.length ? `${tops.join(', ')} and ` : ''}${last}`
}
