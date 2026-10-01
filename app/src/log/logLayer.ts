import type { GeoJSONSource, Map as MlMap, MapMouseEvent, MapTouchEvent } from 'maplibre-gl'
import type { FeatureCollection } from 'geojson'
import { onEachMap } from '../map/mapController'
import { toolOwnsTap } from '../ui/tools'
import { SPECIES_NAMES, useHuntLog, type LogEntry } from './huntLog'

/**
 * The hunt log on the map: a dot per entry, coloured by what happened
 * (seen and called in bright, heard and sign softer, blank sits hollow),
 * with the species' first letter, fading over three weeks as its pull on
 * the Spots map fades.
 *
 * A dot drags: a finger down on one and a slide moves the entry (a moose
 * placed a touch off; the map does not pan under it), and where it was
 * heard from, if it was, keeps its bearing and distance to the new spot.
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
        id: e.id,
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

function bearingAndDistance(a: { lon: number; lat: number }, b: { lon: number; lat: number }): { bearing: number; distM: number } {
  const kx = 111_320 * Math.cos((a.lat * Math.PI) / 180)
  const dx = (b.lon - a.lon) * kx
  const dy = (b.lat - a.lat) * 110_574
  return { bearing: Math.round(((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360), distM: Math.round(Math.hypot(dx, dy)) }
}

/** A finger (or the mouse) down on a dot moves the entry until it lifts. */
function wireDrag(map: MlMap) {
  let id: string | null = null
  const move = (e: MapMouseEvent | MapTouchEvent) => {
    if (!id) return
    e.preventDefault()
    const { lng, lat } = e.lngLat
    useHuntLog.getState().update(id, { lon: lng, lat })
  }
  const end = () => {
    if (!id) return
    const e = useHuntLog.getState().entries.find((x) => x.id === id)
    if (e?.from) useHuntLog.getState().update(id, { from: { ...e.from, ...bearingAndDistance(e.from, e) } })
    id = null
    map.dragPan.enable()
    map.off('mousemove', move)
    map.off('touchmove', move)
  }
  const start = (e: MapMouseEvent | MapTouchEvent) => {
    if (toolOwnsTap()) return
    const f = (e as MapMouseEvent & { features?: { properties?: { id?: string } }[] }).features?.[0]
    const hit = f?.properties?.id
    if (!hit) return
    // one finger: two is a pinch
    if ('points' in e && e.points.length !== 1) return
    e.preventDefault()
    id = hit
    map.dragPan.disable()
    map.on('mousemove', move)
    map.on('touchmove', move)
    map.once('mouseup', end)
    map.once('touchend', end)
    map.once('touchcancel', end)
  }
  map.on('mousedown', 'huntlog-dot', start)
  map.on('touchstart', 'huntlog-dot', start)
  map.on('mouseenter', 'huntlog-dot', () => (map.getCanvas().style.cursor = 'grab'))
  map.on('mouseleave', 'huntlog-dot', () => (map.getCanvas().style.cursor = ''))
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
    wireDrag(map)
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
