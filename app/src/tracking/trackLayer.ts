import type { FeatureCollection } from 'geojson'
import type { GeoJSONSource, Map as MlMap } from 'maplibre-gl'
import { onEachMap } from '../map/mapController'
import { useTrackStore, type Track } from './trackStore'

/** The trails on the map: the live recording in the track colour, the
 *  tracks switched on in Places in a quieter one. */

const SRC = 'tracks'
let layersOn: MlMap | null = null

function fc(): FeatureCollection {
  const s = useTrackStore.getState()
  const want = (t: Track) => t.id === s.recordingId || s.shown.includes(t.id)
  const features: FeatureCollection['features'] = []
  for (const t of s.tracks) {
    if (!want(t) || t.points.length < 2) continue
    const segs: [number, number][][] = []
    for (const p of t.points) {
      if (p.gap || !segs.length) segs.push([])
      segs[segs.length - 1].push([p.lon, p.lat])
    }
    features.push({ type: 'Feature', geometry: { type: 'MultiLineString', coordinates: segs.filter((g) => g.length >= 2) }, properties: { live: t.id === s.recordingId } })
  }
  return { type: 'FeatureCollection', features }
}

function addLayers(m: MlMap) {
  if (layersOn === m || !m.getStyle()) return
  m.addSource(SRC, { type: 'geojson', data: fc() })
  m.addLayer({ id: 'tracks-casing', type: 'line', source: SRC, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': 'rgba(8, 20, 34, 0.8)', 'line-width': 5 } })
  m.addLayer({
    id: 'tracks-line',
    type: 'line',
    source: SRC,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ['case', ['get', 'live'], '#59e0b8', 'rgba(89, 224, 184, 0.55)'], 'line-width': ['case', ['get', 'live'], 3, 2] },
  })
  layersOn = m
}

function render() {
  const m = layersOn
  if (!m) return
  ;(m.getSource(SRC) as GeoJSONSource | undefined)?.setData(fc())
}

let wired = false
export function initTrackLayer() {
  if (wired) return
  wired = true
  onEachMap((m) => {
    layersOn = null
    addLayers(m)
    m.once('remove', () => {
      if (layersOn === m) layersOn = null
    })
  })
  useTrackStore.subscribe((s, prev) => {
    if (s.tracks !== prev.tracks || s.shown !== prev.shown || s.recordingId !== prev.recordingId) render()
  })
}
