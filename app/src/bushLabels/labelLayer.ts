import type { ExpressionSpecification, GeoJSONSource, Map as MlMap } from 'maplibre-gl'
import { ACTIVE_AREA } from '../areas'
import { onEachMap } from '../map/mapController'
import { BUSH_CLASSES, labelsHere, useBushLabels } from './labelStore'

/**
 * The bush labels on the map while the tool is up: each a 20 m patch in its
 * class's colour, the patch the label stands for (two of the satellite's
 * 10 m pixels across). The tool takes the map's tap; MapView's own tap
 * handlers stand aside while it is up.
 */

const SRC = 'bushlabels'
const LAYER = 'bushlabels-patch'
/** a label's radius on the ground, m */
const R_M = 20

/** 20 m on the ground in screen px at every zoom, at the area's latitude (MapLibre's 512 px world) */
function radius(): ExpressionSpecification {
  const mPerPx0 = (40075016.686 * Math.cos((ACTIVE_AREA.home.center[1] * Math.PI) / 180)) / 512
  const r0 = R_M / mPerPx0
  return ['interpolate', ['exponential', 2], ['zoom'], 0, r0, 22, r0 * 2 ** 22]
}

const colour: ExpressionSpecification = ['match', ['get', 'cls'], ...BUSH_CLASSES.flatMap((c) => [c.id, c.colour]), '#ffffff'] as unknown as ExpressionSpecification

function data(): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: labelsHere().map((l, i) => ({ type: 'Feature', id: i, properties: { cls: l.cls }, geometry: { type: 'Point', coordinates: [l.lon, l.lat] } })),
  }
}

function addLayers(map: MlMap) {
  if (map.getSource(SRC)) return
  map.addSource(SRC, { type: 'geojson', data: data() })
  map.addLayer({
    id: LAYER,
    type: 'circle',
    source: SRC,
    layout: { visibility: useBushLabels.getState().active ? 'visible' : 'none' },
    paint: { 'circle-radius': radius(), 'circle-color': colour, 'circle-opacity': 0.4, 'circle-stroke-color': colour, 'circle-stroke-width': 2, 'circle-pitch-alignment': 'map' },
  })
}

function render(map: MlMap) {
  const src = map.getSource(SRC) as GeoJSONSource | undefined
  if (!src) return
  src.setData(data())
  map.setLayoutProperty(LAYER, 'visibility', useBushLabels.getState().active ? 'visible' : 'none')
}

let inited = false

/** Call once at startup. A link with ?label=bush opens the tool. */
export function initBushLabels() {
  if (inited) return
  inited = true
  try {
    if (new URLSearchParams(window.location.search).get('label') === 'bush') useBushLabels.getState().setActive(true)
  } catch {
    /* no search to read */
  }
  onEachMap((map) => {
    const ready = () => {
      addLayers(map)
      render(map)
    }
    if (map.isStyleLoaded()) ready()
    else map.once('load', ready)
    map.on('click', (e) => {
      if (!useBushLabels.getState().active) return
      useBushLabels.getState().add(e.lngLat.lng, e.lngLat.lat)
    })
    const off = useBushLabels.subscribe((s, p) => {
      if (s.labels !== p.labels || s.active !== p.active) render(map)
    })
    map.once('remove', off)
  })
}
