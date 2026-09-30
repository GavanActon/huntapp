import type { FeatureCollection } from 'geojson'
import type { FilterSpecification, GeoJSONSource, Map as MlMap } from 'maplibre-gl'
import { onEachMap } from '../map/mapController'
import { outingSince } from '../log/outingTime'
import { useTrackStore, type Track, type TrackPoint } from './trackStore'

/** The trail on the map: the live recording from the start of this outing
 *  in the track colour, or, while an outing from the Hunt log is open, its
 *  stretch of every track in a quieter one. Where a track went quiet (the
 *  phone in a pocket, its screen off), a faint dotted line joins one
 *  stretch to the next: you got from there to here, the way unrecorded. */

const SRC = 'tracks'
let layersOn: MlMap | null = null
/** the outing being looked at, or null for the live track */
let replay: { from: number; to: number } | null = null

function lines(points: TrackPoint[], live: boolean, features: FeatureCollection['features']) {
  if (points.length < 2) return
  const segs: [number, number][][] = []
  const gaps: [number, number][][] = []
  let prev: [number, number] | null = null
  for (const p of points) {
    if (p.gap && prev) gaps.push([prev, [p.lon, p.lat]])
    if (p.gap || !segs.length) segs.push([])
    prev = [p.lon, p.lat]
    segs[segs.length - 1].push(prev)
  }
  const walked = segs.filter((g) => g.length >= 2)
  if (walked.length) features.push({ type: 'Feature', geometry: { type: 'MultiLineString', coordinates: walked }, properties: { live } })
  if (gaps.length) features.push({ type: 'Feature', geometry: { type: 'MultiLineString', coordinates: gaps }, properties: { live, gap: true } })
}

function fc(): FeatureCollection {
  const s = useTrackStore.getState()
  const features: FeatureCollection['features'] = []
  if (replay) {
    const { from, to } = replay
    for (const t of s.tracks) lines(t.points.filter((p) => p.ts >= from && p.ts <= to), false, features)
    return { type: 'FeatureCollection', features }
  }
  const t: Track | undefined = s.tracks.find((x) => x.id === s.recordingId)
  if (t) {
    // this outing only: a track picked up after hours in a pocket starts again from here
    const since = outingSince(t.points.map((p) => p.ts))
    lines(since == null ? t.points : t.points.filter((p) => p.ts >= since), true, features)
  }
  return { type: 'FeatureCollection', features }
}

function addLayers(m: MlMap) {
  if (layersOn === m || !m.getStyle()) return
  m.addSource(SRC, { type: 'geojson', data: fc() })
  const walked: FilterSpecification = ['!', ['has', 'gap']]
  m.addLayer({ id: 'tracks-casing', type: 'line', source: SRC, filter: walked, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': 'rgba(8, 20, 34, 0.8)', 'line-width': 5 } })
  m.addLayer({
    id: 'tracks-gap',
    type: 'line',
    source: SRC,
    filter: ['has', 'gap'],
    layout: { 'line-cap': 'round' },
    paint: { 'line-color': 'rgba(89, 224, 184, 0.6)', 'line-width': 1.5, 'line-dasharray': [0.5, 2.5] },
  })
  m.addLayer({
    id: 'tracks-line',
    type: 'line',
    source: SRC,
    filter: walked,
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

/** An outing from the Hunt log on the map: the points of every track inside the slice; null puts the live track back. */
export function showOutingTrack(slice: { from: number; to: number } | null): void {
  replay = slice
  render()
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
    if (s.tracks !== prev.tracks || s.recordingId !== prev.recordingId) render()
  })
}
