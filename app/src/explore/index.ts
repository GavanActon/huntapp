import type { Map as MlMap, MapMouseEvent } from 'maplibre-gl'
import { ACTIVE_AREA, EXPLORE_FROM_KEY, EXPLORE_ID, exploreFromId, loadView, type AreaBox } from '../areas'
import { switchArea } from '../areas/switch'
import { devlog } from '../devlog'
import { setWindBox } from '../weather/windGrid'
import { COVERAGE_TILES_LAYER } from './coverage'
import { tileAt } from './lattice'
import { useAppStore } from '../state/appStore'
import { BUILT_IN, useViews } from '../state/viewsStore'
import { useExplore, type CoverageProps } from './store'

/**
 * Explore (docs/EXPLORE.md): the map anywhere in Canada. It is an area of
 * its own, `explore` (areas/explore.json), whose region is the country and
 * which bakes nothing, so the style falls back to the live base layers
 * everywhere, and whose grid is the SD lattice coloured by what each tile
 * can have (the coverage index). Entering and leaving it is a switch like
 * any other, which keeps every cache clean (areas/switch.ts).
 */
export const EXPLORE = ACTIVE_AREA.id === EXPLORE_ID

/** Into Explore, on the view the map has now. */
export function enterExplore(): boolean {
  if (EXPLORE) return false
  try {
    localStorage.setItem(EXPLORE_FROM_KEY, ACTIVE_AREA.id)
  } catch {
    /* the default area then */
  }
  const v = loadView()
  return switchArea(EXPLORE_ID, v ? { center: v.center, zoom: Math.max(7, Math.min(v.zoom, 11)) } : undefined)
}

/** On arrival: Explore's own layers (the live base, the shade, Toporama's
 *  contours), the wind streaks off, the heat off, so the pill reads
 *  Explore and the map is the country, not the last area's view of it. */
export function applyExploreView(): void {
  const v = BUILT_IN.find((x) => x.explore)
  if (!v) return
  useViews.getState().apply(v)
  const a = useAppStore.getState()
  if (a.layers.windFlow) useAppStore.setState({ layers: { ...a.layers, windFlow: false } })
}

/** The area Explore was entered from, else the default. */
export function exploreFrom(): string {
  return exploreFromId()
}

export function leaveExplore(): boolean {
  if (!EXPLORE) return false
  return switchArea(exploreFrom())
}

/** The wind lattice follows the view in Explore: about 11 km each way
 *  around the centre, fetched again once the centre leaves the box. */
export function exploreMoved(m: MlMap): void {
  const c = m.getCenter()
  const dLat = 0.1
  const dLon = 0.15 / Math.max(0.2, Math.cos((c.lat * Math.PI) / 180))
  const box: AreaBox = { west: c.lng - dLon, east: c.lng + dLon, south: c.lat - dLat, north: c.lat + dLat }
  setWindBox(box)
}

/** A tap in Explore picks the tile under it; the card does the rest. */
export function exploreTap(m: MlMap, e: MapMouseEvent): void {
  const { lng, lat } = e.lngLat
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
    return
  }
  devlog('explore', `tile ${tile.id} · ${lat.toFixed(4)},${lng.toFixed(4)} · ${props ? `grade ${props.grade}, lidar ${props.lidar}, ${props.stands}` : 'no coverage read'}`)
  useExplore.getState().select({ tile, lon: lng, lat, props })
}
