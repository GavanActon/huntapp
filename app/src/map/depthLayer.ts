import type { FeatureCollection } from 'geojson'
import type { GeoJSONSource, Map as MlMap } from 'maplibre-gl'
import { onEachMap } from './mapController'
import { habitat, onHabitat } from '../spots/habitatGrid'
import { useAppStore } from '../state/appStore'

/**
 * Lake depths where the province has none. Pickle, Ketchup and McGill were
 * surveyed by transect in 1978–79 and only the paper sheets survive, so
 * the LIO contour layer is empty here. The habitat bake estimates depth
 * per water cell from the shoreline shape, calibrated to each lake's
 * surveyed mean and maximum (habitatGrid `depthEst`, `lakes[].depthModel`).
 * This draws that estimate as banded fills with a depth label, and says
 * "estimated" wherever it shows. It answers to the Lake depths switch.
 */

const SRC = 'depth-est'
const BANDS: [number, string][] = [
  [1.5, 'rgba(180, 225, 245, 0.55)'],
  [3, 'rgba(120, 195, 235, 0.55)'],
  [6, 'rgba(70, 150, 215, 0.6)'],
  [10, 'rgba(40, 105, 185, 0.65)'],
  [15, 'rgba(25, 70, 150, 0.7)'],
  [99, 'rgba(15, 40, 110, 0.75)'],
]

/** Lakes with a georeferenced MNR survey sheet (bathySheets): the estimate
 *  is only a faint wash under the real contours there, and never labelled,
 *  so two sets of numbers never disagree on one lake. */
const SURVEYED = ['pickle lake', 'ketchup lake', 'mcgill lake']
function surveyedIds(h: NonNullable<ReturnType<typeof habitat>>): Set<number> {
  return new Set(h.lakes.filter((l) => SURVEYED.includes((l.name ?? '').toLowerCase())).map((l) => l.id))
}
const washed = (rgba: string) => rgba.replace(/[\d.]+\)$/, (a) => `${(parseFloat(a) * 0.45).toFixed(2)})`)

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

function addLayers(m: MlMap) {
  if (layersOn === m || !m.getStyle() || !habitat()) return
  const on = useAppStore.getState().layers.bathy
  const vis = { visibility: on ? 'visible' : 'none' } as const
  // beneath the basemap's labels and the vector overlays, above the rasters
  // under the survey sheets' ink where it exists, else under the overlays
  const before = m.getLayer('bathy-sheets') ? 'bathy-sheets' : m.getStyle().layers.find((l) => l.id === 'bathy-line' || l.id === 'wmu-line' || l.type === 'symbol')?.id
  m.addSource(SRC, { type: 'geojson', data: buildFc() })
  m.addSource(`${SRC}-labels`, { type: 'geojson', data: labelsFc() })
  m.addLayer({ id: 'depth-est-fill', type: 'fill', source: SRC, layout: vis, paint: { 'fill-color': ['get', 'color'], 'fill-antialias': false }, metadata: { group: 'bathy' } }, before)
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
    ;(m.getSource(SRC) as GeoJSONSource | undefined)?.setData(buildFc())
    ;(m.getSource(`${SRC}-labels`) as GeoJSONSource | undefined)?.setData(labelsFc())
  })
}

/** True when the estimate is what the Lake depths switch draws here. */
export function depthIsEstimated(): boolean {
  return !!habitat()?.has('depthEst')
}
