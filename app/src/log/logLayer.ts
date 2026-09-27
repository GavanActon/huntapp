import type { GeoJSONSource, Map as MlMap } from 'maplibre-gl'
import type { FeatureCollection } from 'geojson'
import { onEachMap } from '../map/mapController'
import { SPECIES_NAMES, useHuntLog, type LogEntry } from './huntLog'

/**
 * The hunt log on the map: a dot per entry, coloured by what happened
 * (seen and called in bright, heard and sign softer, blank sits hollow),
 * with the species' first letter, fading over three weeks as its pull on
 * the Spots map fades.
 */

const SRC = 'huntlog'
const DAY = 86_400_000

function features(entries: LogEntry[]): FeatureCollection {
  const now = Date.now()
  return {
    type: 'FeatureCollection',
    features: entries.map((e) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [e.lon, e.lat] },
      properties: {
        what: e.what,
        letter: SPECIES_NAMES[e.species][0],
        // 1 fresh … 0.35 three weeks old and after
        fresh: Math.max(0.35, 1 - (now - e.ts) / (21 * DAY)),
      },
    })),
  }
}

function ensure(map: MlMap) {
  const data = features(useHuntLog.getState().entries)
  const src = map.getSource(SRC) as GeoJSONSource | undefined
  if (src) return src.setData(data)
  map.addSource(SRC, { type: 'geojson', data })
  map.addLayer({
    id: 'huntlog-dot',
    type: 'circle',
    source: SRC,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 4, 15, 8],
      'circle-color': ['match', ['get', 'what'], 'seen', '#ff6b4a', 'called', '#ff3d7f', 'heard', '#ffb347', 'sign', '#d8b36a', 'rgba(0,0,0,0)'],
      'circle-stroke-color': ['match', ['get', 'what'], 'nothing', '#c9d1d9', '#1a0f06'],
      'circle-stroke-width': ['match', ['get', 'what'], 'nothing', 2, 1.5],
      'circle-opacity': ['get', 'fresh'],
      'circle-stroke-opacity': ['get', 'fresh'],
    },
  })
  map.addLayer({
    id: 'huntlog-letter',
    type: 'symbol',
    source: SRC,
    minzoom: 13,
    layout: { 'text-field': ['get', 'letter'], 'text-font': ['Noto Sans Medium'], 'text-size': 10, 'text-allow-overlap': true },
    paint: { 'text-color': '#1a0f06', 'text-opacity': ['get', 'fresh'] },
  })
}

let wired = false
export function initLogLayer() {
  if (wired) return
  wired = true
  let current: MlMap | null = null
  onEachMap((map) => {
    current = map
    const add = () => {
      try {
        ensure(map)
      } catch {
        // the style is still loading
      }
    }
    if (map.isStyleLoaded()) add()
    map.on('styledata', () => {
      if (!map.getSource(SRC)) add()
    })
  })
  useHuntLog.subscribe((s, p) => {
    if (s.entries !== p.entries && current) {
      try {
        ensure(current)
      } catch {
        /* not ready yet: styledata adds it */
      }
    }
  })
}
