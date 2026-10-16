import type { GeoJSONSource, Map as MlMap } from 'maplibre-gl'
import type { FeatureCollection, Position } from 'geojson'
import { getMap, onEachMap } from '../../map/mapController'
import { useAppStore } from '../../state/appStore'
import type { Index } from './windTiles'

/**
 * Where the SD wind is (Gavan, 2026-10-16: "draw an outline of the areas
 * we have sd wind for ... that way we can see the areas that are
 * complete"): the edge of the national tiles on R2 (windTiles.ts' index),
 * in the wind's cyan, with a faint wash inside while zoomed out. Drawn
 * beside the baked areas' boxes, and redrawn as the index grows.
 */

const SRC = 'sd-outline'
const LAYERS = ['sd-outline-fill', 'sd-outline-casing', 'sd-outline-line']
const WIND = '#4fc7ff'

let shapes: FeatureCollection = { type: 'FeatureCollection', features: [] }

/** Runs of whole numbers, as [first, one past the last]. */
function runs(xs: number[]): [number, number][] {
  xs.sort((a, b) => a - b)
  const out: [number, number][] = []
  let s = xs[0]
  let e = s
  for (let k = 1; k < xs.length; k++) {
    if (xs[k] === e + 1) e = xs[k]
    else {
      out.push([s, e + 1])
      s = e = xs[k]
    }
  }
  out.push([s, e + 1])
  return out
}

/** The tiles' edge (each side of a tile with no tile beside it, joined
 *  along the lattice's lines) and their wash (each row's runs). */
function outline(idx: Index): FeatureCollection {
  const L = idx.lattice
  const lon = (i: number) => L.lon0 + i * L.cols * L.dLon
  const lat = (j: number) => L.lat0 - j * L.rows * L.dLat
  const have = new Set<string>()
  const byRow = new Map<number, number[]>()
  for (const id of Object.keys(idx.tiles)) {
    const m = /^t-(\d+)-(\d+)$/.exec(id)
    if (!m) continue
    const i = +m[1]
    const j = +m[2]
    have.add(`${i},${j}`)
    let row = byRow.get(j)
    if (!row) byRow.set(j, (row = []))
    row.push(i)
  }
  const on = (i: number, j: number) => have.has(`${i},${j}`)
  const push = (m: Map<number, number[]>, k: number, v: number) => {
    let a = m.get(k)
    if (!a) m.set(k, (a = []))
    a.push(v)
  }
  // across: the line along a row's top, the tiles under or over it with an edge there; down: a column's west side
  const across = new Map<number, number[]>()
  const down = new Map<number, number[]>()
  const wash: Position[][][] = []
  for (const [j, row] of byRow) {
    for (const i of row) {
      if (!on(i, j - 1)) push(across, j, i)
      if (!on(i, j + 1)) push(across, j + 1, i)
      if (!on(i - 1, j)) push(down, i, j)
      if (!on(i + 1, j)) push(down, i + 1, j)
    }
    for (const [a, b] of runs(row)) wash.push([[[lon(a), lat(j)], [lon(b), lat(j)], [lon(b), lat(j + 1)], [lon(a), lat(j + 1)], [lon(a), lat(j)]]])
  }
  const lines: Position[][] = []
  for (const [j, is] of across) for (const [a, b] of runs(is)) lines.push([[lon(a), lat(j)], [lon(b), lat(j)]])
  for (const [i, js] of down) for (const [a, b] of runs(js)) lines.push([[lon(i), lat(a)], [lon(i), lat(b)]])
  return {
    type: 'FeatureCollection',
    features: [
      { type: 'Feature', properties: { kind: 'wash' }, geometry: { type: 'MultiPolygon', coordinates: wash } },
      { type: 'Feature', properties: { kind: 'edge' }, geometry: { type: 'MultiLineString', coordinates: lines } },
    ],
  }
}

const vis = () => (useAppStore.getState().online ? 'visible' : 'none')

function ensure(m: MlMap) {
  if (m.getSource(SRC)) return
  m.addSource(SRC, { type: 'geojson', data: shapes })
  // in the baked boxes' place in the stack: under the contours, labels and streaks
  const before = m.getLayer('area-boxes-line') ? 'area-boxes-line' : undefined
  const layout = { visibility: vis() } as const
  m.addLayer(
    {
      id: 'sd-outline-fill',
      type: 'fill',
      source: SRC,
      filter: ['==', ['get', 'kind'], 'wash'],
      layout,
      // no antialiasing: the rows' rectangles meet without a seam
      paint: { 'fill-color': WIND, 'fill-antialias': false, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 4, 0.14, 8, 0.08, 10, 0] },
    },
    before,
  )
  // square caps close the corners where an across and a down run meet
  const lineLayout = { ...layout, 'line-cap': 'square' } as const
  m.addLayer(
    {
      id: 'sd-outline-casing',
      type: 'line',
      source: SRC,
      filter: ['==', ['get', 'kind'], 'edge'],
      layout: lineLayout,
      paint: { 'line-color': 'rgba(10,20,12,0.6)', 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 3, 9, 3.6, 13, 4.2] },
    },
    before,
  )
  m.addLayer(
    {
      id: 'sd-outline-line',
      type: 'line',
      source: SRC,
      filter: ['==', ['get', 'kind'], 'edge'],
      layout: lineLayout,
      paint: { 'line-color': WIND, 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 1, 9, 1.6, 13, 2.2] },
    },
    before,
  )
}

/** The index's tiles drawn (windTiles.ts, on each index read that adds some). */
export function drawSdOutline(idx: Index): void {
  shapes = outline(idx)
  ;(getMap()?.getSource(SRC) as GeoJSONSource | undefined)?.setData(shapes)
}

let wired = false
/** From initWindTiles, once: only where the tiles are used. */
export function initSdOutline(): void {
  if (wired) return
  wired = true
  onEachMap(ensure)
  // the tiles come from R2: offline, no line claims a wind the phone can't fetch
  useAppStore.subscribe((s, prev) => {
    if (s.online === prev.online) return
    const m = getMap()
    if (m) for (const id of LAYERS) if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', vis())
  })
}
