import type { Map as MlMap, MapMouseEvent } from 'maplibre-gl'
import { areaAt } from '../areas'
import { REGION } from '../config'
import { devlog } from '../devlog'
import { useAppStore } from '../state/appStore'
import { setWindBox } from '../weather/windGrid'
import { COVERAGE_TILES_LAYER } from './coverage'
import { tileAt } from './lattice'
import { useExplore, type CoverageProps } from './store'

/**
 * Explore (docs/EXPLORE.md) is a mode of the one map, not an area of its
 * own (Gavan, 2026-10-08: "Explorer is built into the view somehow").
 * With signal the map is never fenced: beyond the baked box the live
 * layers stream (the Toporama sheet, the shade, a province's imagery),
 * the box is outlined, and the wind lattice follows the view, so the
 * streaks are the forecast's outside the box and the ground wind's inside
 * it. Explore on adds the coverage grid, the Where-to box and a quieter
 * chrome; a tap outside every box opens the cell card in any mode.
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

/** The wind lattice follows the view: the area's own box while the view
 *  is over it (kept on the phone for camp), else about 11 km each way
 *  around the centre, in memory only, fetched again once the centre
 *  leaves the box it has. */
export function viewMoved(m: MlMap): void {
  const c = m.getCenter()
  if (c.lng >= REGION.west && c.lng <= REGION.east && c.lat >= REGION.south && c.lat <= REGION.north) {
    setWindBox(null)
    return
  }
  const dLat = 0.1
  const dLon = 0.15 / Math.max(0.2, Math.cos((c.lat * Math.PI) / 180))
  setWindBox({ west: c.lng - dLon, east: c.lng + dLon, south: c.lat - dLat, north: c.lat + dLat })
}

/** A tap outside every baked box picks the cell under it for the card;
 *  false for a tap inside one, which keeps its own popup. */
export function exploreTap(m: MlMap, e: MapMouseEvent): boolean {
  const { lng, lat } = e.lngLat
  if (areaAt(lng, lat)) return false
  const tile = tileAt(lng, lat)
  let props: CoverageProps | null = null
  if (m.getLayer(COVERAGE_TILES_LAYER)) {
    const hit = m.queryRenderedFeatures(e.point, { layers: [COVERAGE_TILES_LAYER] })
    const p = hit[0]?.properties as CoverageProps | undefined
    if (p) props = p
  }
  const cur = useExplore.getState().selected
  if (cur && cur.tile.id === tile.id) {
    useExplore.getState().select(null)
    return true
  }
  devlog('explore', `tile ${tile.id} · ${lat.toFixed(4)},${lng.toFixed(4)} · ${props ? `grade ${props.grade}, lidar ${props.lidar}, ${props.stands}` : 'no coverage read'}`)
  useExplore.getState().select({ tile, lon: lng, lat, props })
  return true
}
