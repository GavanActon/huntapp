import type { FeatureCollection } from 'geojson'
import type { GeoJSONSource, Map as MlMap } from 'maplibre-gl'
import { geoUrls, onEachMap } from './mapController'
import { habitat, onHabitat } from '../spots/habitatGrid'
import { useAppStore } from '../state/appStore'

/**
 * Lake depths where the province has none. Pickle, Ketchup and McGill were
 * surveyed in 1978–79 and only the paper sheets survive, so the LIO
 * contour layer is empty here. pipeline/survey_depth.py reads those sheets
 * (counting contours from the shore) into depth surfaces; every other lake
 * has the shape estimate from its shoreline. pipeline/build_depth_bands.py
 * contours both into smooth band polygons clipped to the real shore
 * (depth-<region>.geojson), which is what this draws. Without that file it
 * falls back to the habitat grid's 30 m cells. It answers to the Lake
 * depths switch.
 */

const SRC = 'depth-est'
/** Band edges at the survey sheets' own 2 m contours, so the fills sit
 *  between the drawn lines. pipeline/build_depth_bands.py EDGES must match. */
const BANDS: [number, string][] = [
  [2, 'rgba(180, 225, 245, 0.55)'],
  [4, 'rgba(125, 198, 236, 0.56)'],
  [6, 'rgba(80, 162, 222, 0.6)'],
  [8, 'rgba(52, 126, 200, 0.63)'],
  [10, 'rgba(36, 96, 178, 0.66)'],
  [14, 'rgba(24, 66, 148, 0.7)'],
  [99, 'rgba(14, 38, 108, 0.75)'],
]

/** Lakes with a georeferenced MNR survey sheet (bathySheets): their bands
 *  now come from the sheet itself, drawn a little lighter so its ink and
 *  numbers read on top, and not labelled again. */
const SURVEYED = ['pickle lake', 'ketchup lake', 'mcgill lake']
function surveyedIds(h: NonNullable<ReturnType<typeof habitat>>): Set<number> {
  return new Set(h.lakes.filter((l) => SURVEYED.includes((l.name ?? '').toLowerCase())).map((l) => l.id))
}
const washed = (rgba: string) => rgba.replace(/[\d.]+\)$/, (a) => `${(parseFloat(a) * 0.7).toFixed(2)})`)

function bandOf(d: number): number {
  for (let i = 0; i < BANDS.length; i++) if (d <= BANDS[i][0]) return i
  return BANDS.length - 1
}

/** One polygon per run of same-band water cells along a row: far fewer
 *  features than one per cell, and the map draws them as one surface. */
function buildFc(): FeatureCollection {
  const h = habitat()
  const features: FeatureCollection['features'] = []
  if (!h || !h.has('depthEst') || !h.has('lakeId')) return { type: 'FeatureCollection', features }
  const depth = h.raw('depthEst')
  const lakeId = h.raw('lakeId')
  const scale = h.scale('depthEst')
  const { cols, rows, west, north, dLon, dLat } = h
  const surveyed = surveyedIds(h)
  for (let r = 0; r < rows; r++) {
    let c = 0
    while (c < cols) {
      const i = r * cols + c
      const q = depth[i]
      if (!lakeId[i] || q === 255) {
        c++
        continue
      }
      const b = bandOf(q * scale)
      let c2 = c + 1
      while (c2 < cols) {
        const j = r * cols + c2
        if (lakeId[j] !== lakeId[i] || depth[j] === 255 || bandOf(depth[j] * scale) !== b) break
        c2++
      }
      const x0 = west + c * dLon
      const x1 = west + c2 * dLon
      const y0 = north - r * dLat
      const y1 = north - (r + 1) * dLat
      features.push({
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] },
        properties: { band: b, color: surveyed.has(lakeId[i]) ? washed(BANDS[b][1]) : BANDS[b][1], depth: Math.round(q * scale * 2) / 2 },
      })
      c = c2
    }
  }
  return { type: 'FeatureCollection', features }
}

/** Sparse depth labels: one per lake band run every few cells, on the
 *  deeper bands only, so the lake reads like a chart, not a spreadsheet. */
function labelsFc(): FeatureCollection {
  const h = habitat()
  const features: FeatureCollection['features'] = []
  if (!h || !h.has('depthEst')) return { type: 'FeatureCollection', features }
  const depth = h.raw('depthEst')
  const lakeId = h.raw('lakeId')
  const scale = h.scale('depthEst')
  const { cols, rows, west, north, dLon, dLat } = h
  const STEP = 6
  const surveyed = surveyedIds(h)
  for (let r = 3; r < rows; r += STEP) {
    for (let c = 3; c < cols; c += STEP) {
      const i = r * cols + c
      if (!lakeId[i] || depth[i] === 255 || surveyed.has(lakeId[i])) continue
      const d = depth[i] * scale
      if (d < 2) continue
      features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [west + (c + 0.5) * dLon, north - (r + 0.5) * dLat] }, properties: { label: d < 10 ? d.toFixed(1) : String(Math.round(d)) } })
    }
  }
  return { type: 'FeatureCollection', features }
}

let layersOn: MlMap | null = null
let currentMap: MlMap | null = null

/** The band polygons' colour: the same ramp, washed on surveyed lakes. */
function bandColor(): unknown {
  const pick = (survey: boolean) => ['match', ['get', 'band'], ...BANDS.flatMap(([, c], i) => [i, survey ? washed(c) : c]), BANDS[BANDS.length - 1][1]]
  return ['case', ['==', ['get', 'survey'], true], pick(true), pick(false)]
}

function addLayers(m: MlMap) {
  const bandsUrl = geoUrls.get('depth')
  if (layersOn === m || !m.getStyle() || (!bandsUrl && !habitat())) return
  const on = useAppStore.getState().layers.bathy
  const vis = { visibility: on ? 'visible' : 'none' } as const
  // beneath the basemap's labels and the vector overlays, above the rasters
  // under the survey sheets' ink where it exists, else under the overlays
  const before = m.getLayer('bathy-sheets') ? 'bathy-sheets' : m.getStyle().layers.find((l) => l.id === 'bathy-line' || l.id === 'wmu-line' || l.type === 'symbol')?.id
  if (bandsUrl) {
    // smooth bands, clipped to the shore: antialiased edges
    m.addSource(SRC, { type: 'geojson', data: bandsUrl, attribution: 'Depths: MNR lake surveys 1978–79 · estimates elsewhere' })
    m.addLayer({ id: 'depth-est-fill', type: 'fill', source: SRC, layout: vis, paint: { 'fill-color': bandColor() as never, 'fill-antialias': true }, metadata: { group: 'bathy' } }, before)
  } else {
    m.addSource(SRC, { type: 'geojson', data: buildFc() })
    m.addLayer({ id: 'depth-est-fill', type: 'fill', source: SRC, layout: vis, paint: { 'fill-color': ['get', 'color'], 'fill-antialias': false }, metadata: { group: 'bathy' } }, before)
  }
  m.addSource(`${SRC}-labels`, { type: 'geojson', data: labelsFc() })
  m.addLayer(
    {
      id: 'depth-est-label',
      type: 'symbol',
      source: `${SRC}-labels`,
      minzoom: 13,
      layout: { ...vis, 'text-field': ['get', 'label'], 'text-font': ['Noto Sans Italic'], 'text-size': 10.5, 'text-allow-overlap': false },
      paint: { 'text-color': 'rgba(215, 235, 250, 0.9)', 'text-halo-color': 'rgba(8, 24, 40, 0.8)', 'text-halo-width': 1 },
      metadata: { group: 'bathy' },
    },
    before,
  )
  layersOn = m
}

let wired = false
export function initDepthLayer() {
  if (wired) return
  wired = true
  onEachMap((m) => {
    layersOn = null
    currentMap = m
    addLayers(m)
    m.once('remove', () => {
      if (layersOn === m) layersOn = null
    })
  })
  onHabitat(() => {
    // the grid usually lands after the map: add the layers then
    if (!layersOn && currentMap) addLayers(currentMap)
    const m = layersOn
    if (!m) return
    if (!geoUrls.get('depth')) (m.getSource(SRC) as GeoJSONSource | undefined)?.setData(buildFc())
    ;(m.getSource(`${SRC}-labels`) as GeoJSONSource | undefined)?.setData(labelsFc())
  })
}

/** True when the estimate is what the Lake depths switch draws here. */
export function depthIsEstimated(): boolean {
  return !!habitat()?.has('depthEst')
}
