import type { Map as MlMap, MapMouseEvent } from 'maplibre-gl'
import { areaAt } from '../areas'
import { REGION } from '../config'
import { devlog } from '../devlog'
import { useAppStore } from '../state/appStore'
import { setWindView } from '../weather/windGrid'
import { boxAround, boxId, holds, moveTo, sizeKm } from './box'
import { COVERAGE_TILES_LAYER } from './coverage'
import { useExplore } from './store'

/**
 * Explore (docs/EXPLORE.md) is a mode of the one map, not an area of its
 * own (Gavan, 2026-10-08: "Explorer is built into the view somehow").
 * With signal the map is never fenced: beyond the baked box the live
 * layers stream (the Toporama sheet, the shade, a province's imagery),
 * the box is outlined, and a wind lattice covers the view, so the streaks
 * are the forecast's outside the box and the ground wind's inside it. Explore on adds the coverage grid, the Where-to box and a quieter
 * chrome; a tap outside every baked box puts down a box to ask for, in any
 * mode (explore/box.ts).
 */

/** the coverage grid's layers, shown while Explore is on */
export const EXPLORE_LAYERS = ['coverage-blocks', COVERAGE_TILES_LAYER, 'coverage-lines']

export function isExplore(): boolean {
  return useAppStore.getState().exploreMode
}

export function setExplore(on: boolean): void {
  useAppStore.getState().setExploreMode(on)
  if (!on) useExplore.getState().select(null)
  devlog('explore', on ? 'on' : 'off')
}

/** The wind lattice follows the view: the area's own lattice while the
 *  whole view is inside its box (kept on the phone for camp), else one over
 *  everything on screen as well, in memory only (weather/windGrid.ts
 *  setWindView). Corner to corner, so a map turned heading up is covered. */
export function viewMoved(m: MlMap): void {
  const el = m.getContainer()
  const corners = [
    [0, 0],
    [el.clientWidth, 0],
    [el.clientWidth, el.clientHeight],
    [0, el.clientHeight],
  ].map(([x, y]) => m.unproject([x, y]))
  const view = {
    west: Math.min(...corners.map((c) => c.lng)),
    east: Math.max(...corners.map((c) => c.lng)),
    south: Math.min(...corners.map((c) => c.lat)),
    north: Math.max(...corners.map((c) => c.lat)),
  }
  const inside = view.west >= REGION.west && view.east <= REGION.east && view.south >= REGION.south && view.north <= REGION.north
  setWindView(inside ? null : view)
}

/** A tap outside every baked box puts the box down round it (10 km a
 *  side), or, with one down, moves it there at its size; a tap inside it
 *  leaves it be. False for a tap inside a baked box, which keeps its own
 *  popup. */
export function exploreTap(m: MlMap, e: MapMouseEvent): boolean {
  const { lng, lat } = e.lngLat
  if (areaAt(lng, lat)) return false
  const cur = useExplore.getState().selected
  if (cur && holds(cur.box, lng, lat)) return true
  const box = cur ? moveTo(cur.box, lng, lat) : boxAround(lng, lat)
  const s = sizeKm(box)
  const grid = m.getLayer(COVERAGE_TILES_LAYER) ? '' : ' · no grid'
  devlog('explore', `box ${cur ? 'moved' : 'put down'} · ${boxId(box)} · ${s.w.toFixed(1)}×${s.h.toFixed(1)} km · ${lat.toFixed(4)},${lng.toFixed(4)}${grid}`)
  // the card, once up, shows the box under it (BoxCard)
  useExplore.getState().select({ box, lon: lng, lat })
  return true
}
