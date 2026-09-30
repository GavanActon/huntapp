import type { GeoJSONSource, Map as MlMap } from 'maplibre-gl'
import type { FeatureCollection } from 'geojson'
import { useSpotsStore } from '../state/spotsStore'
import { getMap, onEachMap } from './mapController'

/**
 * The white ring on the point Dig in is open on (`useSpotsStore.digIn`):
 * the sheet says "650 m NE of Camp", the ring says where. Its own source,
 * so the heat, the numbered pins and the strip's subject never move for
 * it. Nothing to tap: the sheet is the thing.
 */

const SRC = 'digin'

function data(p: { lon: number; lat: number } | null): FeatureCollection {
  return { type: 'FeatureCollection', features: p ? [{ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lon, p.lat] }, properties: {} }] : [] }
}

function ensure(m: MlMap) {
  if (m.getSource(SRC)) return
  m.addSource(SRC, { type: 'geojson', data: data(useSpotsStore.getState().digIn) })
  // a faint dark halo so the ring reads over a pale map, then the ring
  m.addLayer({
    id: 'digin-halo',
    type: 'circle',
    source: SRC,
    paint: { 'circle-radius': 11, 'circle-opacity': 0, 'circle-stroke-color': 'rgba(0,0,0,0.35)', 'circle-stroke-width': 2 },
  })
  m.addLayer({
    id: 'digin-ring',
    type: 'circle',
    source: SRC,
    paint: { 'circle-radius': 9, 'circle-opacity': 0, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 },
  })
}

function render(m: MlMap) {
  const src = m.getSource(SRC) as GeoJSONSource | undefined
  const p = useSpotsStore.getState().digIn
  src?.setData(data(p))
  // layers added after this one (the track, the scent cloud) would sit
  // over the ring: on each show it goes back on top
  if (p && m.getLayer('digin-ring')) {
    m.moveLayer('digin-halo')
    m.moveLayer('digin-ring')
  }
}

let wired = false
/** Called once from initSpotsLayer(). */
export function initDigInMarker(): void {
  if (wired) return
  wired = true
  onEachMap((m) => {
    ensure(m)
    render(m)
  })
  useSpotsStore.subscribe((s, prev) => {
    if (s.digIn === prev.digIn) return
    const m = getMap()
    if (m && m.getSource(SRC)) render(m)
  })
}
