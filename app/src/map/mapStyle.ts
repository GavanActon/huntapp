import { DARK, layers as basemapLayers } from '@protomaps/basemaps'
import type { FeatureCollection } from 'geojson'
import type { ExpressionSpecification, FilterSpecification, GeoJSONSource, LayerSpecification, Map as MlMap, StyleSpecification } from 'maplibre-gl'
import { ACTIVE_AREA, AREA_LIST } from '../areas'
import { ATTRIBUTION, CONTOUR_FINE_FROM, CORE, DATA_FILES, FINE_RELIEF, LIVE, REGION, REGION_MAXZOOM, RELIEF, ZONE } from '../config'
import { LIVE_RASTER, LIVE_VECTOR } from '../sources'
import type { ContourInterval, LayerOpacity, LayerVisibility } from '../state/appStore'
import { COVERAGE_KEY, COVERAGE_SOURCE, coverageLayers, coverageSource } from '../explore/coverage'

/** Bush-tuned flavour of the Protomaps dark basemap: dark green land, navy
 *  water, so the topo, hillshade and forest layers carry the contrast. */
const BUSH = {
  ...DARK,
  background: '#0f1a12',
  earth: '#1a2a1c',
  water: '#0b2033',
  wood_a: '#16301b',
  wood_b: '#16301b',
  park_a: '#17311c',
  park_b: '#17311c',
  sand: '#2a3527',
  beach: '#2a3527',
  glacier: '#223040',
}

export interface StyleOpts {
  base: string
  layers: LayerVisibility
  opacity: LayerOpacity
  /** metres between the LiDAR contour lines drawn */
  contourInterval: ContourInterval
  /** with signal the map is not fenced: the live layers beyond the baked box, the boxes drawn (explore/index.ts) */
  online?: boolean
  /** Explore on at build: the coverage grid shown */
  explore?: boolean
  /** which pmtiles keys are reachable (from registerAllDataFiles) */
  available: Set<string>
  /** baked GeoJSON per theme: a URL (local blob or server file) when found */
  geo: Map<string, string>
}

/** Every style layer carries `metadata.group`, the LayerVisibility key that
 *  switches it, so the sheet's toggles never have to know layer ids. */
function tag<T extends LayerSpecification>(l: T, group: keyof LayerVisibility, opacityKey?: keyof LayerOpacity): T {
  return { ...l, metadata: { group, opacityKey } }
}

const vis = (on: boolean) => ({ visibility: on ? 'visible' : 'none' }) as const

/** The marsh symbol the bogs are drawn with (relief-bog-tufts): a tuft of
 *  reeds on its ground line, two to a tile and staggered, in the blue the
 *  old topo sheets drew them in. Made when the map first asks for it
 *  (MapView's styleimagemissing). */
export const BOG_TUFT = 'bog-tuft'
export function bogTuftImage(): ImageData {
  const S = 2
  const W = 28
  const H = 24
  const c = document.createElement('canvas')
  c.width = W * S
  c.height = H * S
  const g = c.getContext('2d', { willReadFrequently: true })!
  g.scale(S, S)
  g.strokeStyle = 'rgba(28, 86, 128, 0.95)'
  g.lineWidth = 1.1
  g.lineCap = 'round'
  const tuft = (x: number, y: number) => {
    g.beginPath()
    g.moveTo(x - 4, y)
    g.lineTo(x + 4, y)
    g.moveTo(x, y)
    g.lineTo(x, y - 4)
    g.moveTo(x - 2, y)
    g.lineTo(x - 3.2, y - 3)
    g.moveTo(x + 2, y)
    g.lineTo(x + 3.2, y - 3)
    g.stroke()
  }
  tuft(7, 9)
  tuft(21, 21)
  return g.getImageData(0, 0, W * S, H * S)
}

const EMPTY_FC: FeatureCollection = { type: 'FeatureCollection', features: [] }

/** GeoJSON sources whose layers are all switched off when the style is
 *  built start empty, with the real file noted here: MapLibre fetches and
 *  indexes a GeoJSON source the moment it is added, hidden or not, and the
 *  forest stands alone are 5 MB. They are filled in the moment their switch
 *  goes on (flushDeferredGeo). They were filled at the first settled frame
 *  too, unasked: MapLibre takes the tiles it cuts from them on the main
 *  thread, and on a phone that was a quarter-second hitch in the wind
 *  streaks a few seconds after every launch, for layers nobody had on. */
export const deferredGeo = new Map<string, { url: string; group: keyof LayerVisibility }>()

/** Give the deferred sources whose group is now on their data. */
export function flushDeferredGeo(map: MlMap, layers: LayerVisibility) {
  for (const [id, { url, group }] of deferredGeo) {
    if (!layers[group]) continue
    const src = map.getSource(id) as GeoJSONSource | undefined
    if (src) src.setData(url)
    deferredGeo.delete(id)
  }
}

/** The baked 1 m LiDAR shade lightens flat ground: a white veil, which is
 *  the grey of the Terrain view over the dark base. Over the imagery that
 *  veil washes the photo pale and the hillsides with it, so there its light
 *  side is toned down to a grey (`raster-brightness-max`); the shaded side
 *  and the fine lines of the skid trails are unchanged. */
export const lidarShadeBrightness = (layers: LayerVisibility) => (layers.satellite ? 0.5 : 1)

/** Over the imagery at a light strength (the Bow view's 0.35) the LiDAR
 *  shade is next to nothing: hidden on its own it changed 0.2% of the
 *  pixels over land at z15 and 1.6% at z16.5, a faint lightening of the
 *  slopes and no trails (those come from the DEM-drawn shade under it), for
 *  reads of the area's biggest archive on every zoom in. So over the imagery
 *  it waits until the Hillshade slider is past half, where it shows (30% of
 *  the pixels at full strength) (2026-10-08). */
const LIDAR_OVER_IMAGERY_FROM = 0.5
export const lidarShadeShown = (layers: LayerVisibility, opacity: LayerOpacity) =>
  layers.hillshade && !(layers.satellite && opacity.hillshade <= LIDAR_OVER_IMAGERY_FROM)

/** The imagery on at full strength: nothing under it shows. */
const imageryWhole = (layers: LayerVisibility, opacity: LayerOpacity) => layers.satellite && opacity.satellite >= 0.99

/** The DEM-drawn shade's paint. Over the imagery at full strength it
 *  carries the hills alone inside the box (the live MRDEM shade is under
 *  the baked imagery there, syncUnderlays), so it is drawn harder: a lower
 *  sun and stronger lit and dark sides, Gavan's "even more contrasty" over
 *  the turned-up shade he was shown (2026-10-08, E of the candidates), and
 *  the Hillshade slider sets its strength, the Bow view's 0.35 being that
 *  look. Elsewhere it is as it was, the slider not on it. */
const IMAGERY_SHADE_AT = 0.35
export function reliefShadePaint(layers: LayerVisibility, opacity: LayerOpacity): Record<string, unknown> {
  if (!imageryWhole(layers, opacity))
    return {
      'hillshade-illumination-altitude': [30, 30, 30, 30],
      'hillshade-highlight-color': ['rgba(255,250,235,0.35)', 'rgba(255,250,235,0.45)', 'rgba(255,250,235,0.35)', 'rgba(255,250,235,0.2)'],
      'hillshade-shadow-color': ['rgba(16,20,12,0.6)', 'rgba(16,20,12,0.8)', 'rgba(16,20,12,0.6)', 'rgba(16,20,12,0.35)'],
      'hillshade-exaggeration': 0.85,
    }
  const k = opacity.hillshade / IMAGERY_SHADE_AT
  const a = (v: number) => Math.min(1, v * k).toFixed(3)
  return {
    'hillshade-illumination-altitude': [20, 20, 20, 20],
    'hillshade-highlight-color': [0.7, 0.85, 0.7, 0.4].map((v) => `rgba(255,250,235,${a(v)})`),
    'hillshade-shadow-color': [1, 1, 1, 0.75].map((v) => `rgba(16,20,12,${a(v)})`),
    'hillshade-exaggeration': 1,
  }
}

/** Whether the live MRDEM shade was put under the baked imagery (buildMapStyle). */
let liveShadeUnderImagery = false

/** The live services under the baked layers, fetched only where they can
 *  show. Inside the box the Toporama sheet is under the opaque base map in
 *  every view, and with the imagery on at full strength the base map and
 *  the live imagery are under the baked imagery too (the live imagery is
 *  the same pictures). Hidden one at a time in the Bow view none of the
 *  three changed a pixel, and they were about 90 tile requests to three slow
 *  government servers at every opening (2026-10-08). The live MRDEM shade
 *  goes the same way: it sits under the baked imagery, so in the box the
 *  DEM-drawn shade carries the hills (Gavan, 2026-10-08: off, it is the one
 *  streamed). Past the box's edge they are the map, and they come back on
 *  the moment the view reaches it; under the baked imagery nothing changes
 *  inside the box when they do. A hidden layer is neither fetched nor read
 *  ahead (prefetch.ts). Run on every move and after every switch
 *  (applyLayerState puts them back with their switches). */
export function syncUnderlays(map: MlMap, layers: LayerVisibility, opacity: LayerOpacity) {
  if (!map.getLayer('base')) return
  ;({ layers, opacity } = standIn(layers, opacity))
  const b = map.getBounds()
  const inside = b.getWest() >= REGION.west && b.getEast() <= REGION.east && b.getSouth() >= REGION.south && b.getNorth() <= REGION.north
  const imagery = imageryWhole(layers, opacity) && !!map.getLayer('satellite')
  // the base map is only drawn in and around the box, and the live imagery covers the province round it
  const liveImagery = !!map.getLayer('satellite-live')
  const show: Record<string, boolean> = {
    toposheet: !inside,
    base: !(imagery && (inside || liveImagery)),
    'satellite-live': layers.satellite && !(imagery && inside),
    ...(liveShadeUnderImagery ? { 'hillshade-live': layers.hillshade && !(imagery && inside) } : {}),
  }
  for (const [id, on] of Object.entries(show)) {
    const want = on ? 'visible' : 'none'
    if (map.getLayer(id) && (map.getLayoutProperty(id, 'visibility') ?? 'visible') !== want) map.setLayoutProperty(id, 'visibility', want)
  }
}

/** What the contour lines sit on: the view's base, read off its layers,
 *  topmost raster first. The wind streaks read the drawn map instead
 *  (windFlow.ts), since a lake and the land beside it want different inks. */
export type BaseTone = 'imagery' | 'topo' | 'relief' | 'shade'
export function baseTone(layers: LayerVisibility): BaseTone {
  if (layers.topo) return 'topo'
  if (layers.relief) return 'relief'
  if (layers.hillshade && !layers.satellite) return 'shade'
  return 'imagery'
}

/** The ground under everything. The bush dark, except under the shade
 *  alone (Terrain: no imagery, topo sheet or elevation colour), where it is
 *  a mid grey: the DEM-drawn hillshade is highlights and shadows over
 *  whatever is beneath, and over the near-black it went black past the
 *  baked grey 1 m LiDAR shade (z13.5) and out to the region's edge (Gavan,
 *  2026-10-02: zoomed out, the Terrain view was black). */
const SHADE_GROUND = '#8a8f88'
export function groundColour(layers: LayerVisibility): string {
  return baseTone(layers) === 'shade' ? SHADE_GROUND : BUSH.background
}

export interface ContourInk {
  line: string
  index: string
  text: string
  halo: string
}
/** The contour ink by base: tan over the dark imagery; burnt orange on the
 *  grey LiDAR shade and the topo sheet, where tan washes out; umber on the
 *  elevation colours, whose own high ground is tan, with the label and its
 *  halo swapped to dark on cream. */
export const CONTOUR_INK: Record<BaseTone, ContourInk> = {
  imagery: { line: 'rgba(214,170,110,0.55)', index: 'rgba(228,186,124,0.85)', text: 'rgba(240,206,150,0.95)', halo: 'rgba(10,20,12,0.9)' },
  shade: { line: 'rgba(188,98,28,0.72)', index: 'rgba(200,102,24,0.95)', text: 'rgba(255,236,200,1)', halo: 'rgba(70,32,8,0.9)' },
  topo: { line: 'rgba(188,98,28,0.72)', index: 'rgba(200,102,24,0.95)', text: 'rgba(255,236,200,1)', halo: 'rgba(70,32,8,0.9)' },
  relief: { line: 'rgba(72,42,18,0.6)', index: 'rgba(60,32,12,0.9)', text: 'rgba(46,26,10,1)', halo: 'rgba(244,236,214,0.9)' },
}

/** [lines to keep, index lines] for a contour interval. A line's `step` is
 *  the coarsest of 10/5/2/1 that divides its elevation, so `step >= interval`
 *  keeps every interval-th metre; index lines are every fifth of those. */
/** [every line kept, the index lines, the lines labelled]. At the fine
 *  intervals (1–2 m) every line carries its number, since that is what the
 *  close reading of a bench or a saddle is for; coarser, the index lines only. */
export function contourFilters(interval: ContourInterval): [FilterSpecification, FilterSpecification, FilterSpecification] {
  const fine = filtersAt(interval)
  // steep ground (the area file's contours.fineFrom): lines closer than 5 m
  // run together into solid bands further out, so short of that zoom the
  // lines are the 5 m ones, as if 5 m were picked. Unset, as at Pickle Lake,
  // the filters are the interval's alone
  if (CONTOUR_FINE_FROM == null || interval >= 5) return fine
  const coarse = filtersAt(5)
  const atZoom = (k: number) => ['case', ['>=', ['zoom'], CONTOUR_FINE_FROM], fine[k], coarse[k]] as FilterSpecification
  return [atZoom(0), atZoom(1), atZoom(2)]
}

function filtersAt(interval: ContourInterval): [FilterSpecification, FilterSpecification, FilterSpecification] {
  const keep: FilterSpecification = ['>=', ['get', 'step'], interval]
  const index: FilterSpecification = ['==', ['%', ['get', 'elev'], interval * 5], 0]
  return [keep, index, interval <= 2 ? keep : index]
}

/** Elevation colours for the relief, m: low ground and lake shores green,
 *  through the core's benches (340–420 m) in olive and tan, to the high
 *  ridges in pale brown. Stretched over Pickle Lake's core, 325–466 m, with
 *  the wider region's extremes clamped at either end. Another area's stops
 *  are stretched from that span onto its own (RELIEF), so the same colours
 *  run from its low ground to its high; at Pickle Lake they are as set. */
const RELIEF_TUNED: [number, number] = [325, 466]
const RELIEF_STOPS: [number, string][] = [
  [250, '#2f5236'],
  [325, '#3f6b42'],
  [340, '#5a824a'],
  [355, '#7b9651'],
  [370, '#a0a65a'],
  [385, '#bfae63'],
  [400, '#cc9f5e'],
  [415, '#bf8658'],
  [430, '#a9735a'],
  [450, '#b49a86'],
  [470, '#d9ccbd'],
  [600, '#f1ebe2'],
]
const RELIEF_RAMP = (() => {
  const [t0, t1] = RELIEF_TUNED
  // a span the wrong way round would put the stops out of order: the tuned one then
  const [lo, hi] = RELIEF[1] > RELIEF[0] ? RELIEF : RELIEF_TUNED
  const at = (m: number) => lo + ((m - t0) * (hi - lo)) / (t1 - t0)
  return ['interpolate', ['linear'], ['elevation'], ...RELIEF_STOPS.flatMap(([m, c]) => [at(m), c])] as unknown as ExpressionSpecification
})()

/** The core's archives (the 1 m LiDAR shade and contours) begin a zoom past
 *  the region's bake and run to the core's own maxzoom; their layers take
 *  over half a zoom early. 14–16 and 13.5 at Pickle Lake. */
const CORE_MINZOOM = REGION_MAXZOOM + 1
const CORE_HANDOFF = REGION_MAXZOOM + 0.5
/** The bush layers, the core's too, go further out: below the core's zooms
 *  their bake averages the 10 m cells into each pixel, from z10
 *  (build_vegstructure.py FAR_MINZOOM), so they still show zoomed out
 *  (Gavan, 2026-10-04: lanes and bush went when zoomed out). A 256 px
 *  raster source takes a zoom's tiles from 1.5 zooms below it (it rounds
 *  the map's zoom + 1), so the layers start there: z10's tiles from 8.5, as
 *  z14's did from 12.5. An archive baked before has no such tiles and draws
 *  nothing out there, as before. */
const BUSH_MINZOOM = 10
const BUSH_LAYER_MINZOOM = BUSH_MINZOOM - 1.5
/** The lanes are on for a fresh phone, and at the opening's zoom (13 and
 *  the coarse pass through 11) a metre-wide lane is under a pixel: their
 *  tiles were 330 KB of a cold open's first seconds for nothing to see
 *  (2026-10-07). They come in a notch further in than the opening. */
const LANES_LAYER_MINZOOM = 13.5

const FONT = ['Noto Sans Regular']
const FONT_MED = ['Noto Sans Medium']
const HALO = { 'text-halo-color': 'rgba(10,20,12,0.92)', 'text-halo-width': 1.2 }

/** An area with no imagery at all, baked or live (Blanchard River, BC:
 *  the province's orthos stop east of 134° W and the Yukon's mosaic at
 *  the border). */
export const NO_IMAGERY = !LIVE.satellite && !DATA_FILES.some((d) => d.key === 'satellite')

/** A view that asks for imagery where there is none (Bow, Sit, Land) gets
 *  the Topo look instead: the relief colours and a full hillshade, so the
 *  core is not the dimmed base map alone, grey and needing signal (Gavan,
 *  2026-10-08, Blanchard River: "Grey I see. Sat image no"). The view and
 *  the sheet keep their own switches; this is only what is drawn. */
export function standIn(layers: LayerVisibility, opacity: LayerOpacity): { layers: LayerVisibility; opacity: LayerOpacity } {
  if (!NO_IMAGERY || !layers.satellite) return { layers, opacity }
  return {
    layers: { ...layers, satellite: false, relief: true, hillshade: true },
    opacity: { ...opacity, hillshade: Math.max(opacity.hillshade, 0.7) },
  }
}

export function buildMapStyle(o: StyleOpts): StyleSpecification {
  o = { ...o, ...standIn(o.layers, o.opacity) }
  const sources: StyleSpecification['sources'] = {}
  const has = (k: string) => o.available.has(k)
  deferredGeo.clear()
  // a GeoJSON source's data: the file when a layer of its group is on, else empty for now
  const geoData = (id: string, url: string, group: keyof LayerVisibility) => {
    if (o.layers[group]) return url
    deferredGeo.set(id, { url, group })
    return EMPTY_FC
  }

  // ---- base ----
  let base: LayerSpecification[]
  if (has('basemap')) {
    sources.basemap = { type: 'vector', url: 'pmtiles://basemap', attribution: '© OpenStreetMap' }
    base = basemapLayers('basemap', BUSH, { lang: 'en' })
  } else {
    const b = LIVE_RASTER.base!
    // the quiet base inside the baked box only when there is signal (bounds):
    // beyond it the country shows as itself, the Toporama sheet from z7 and
    // the geometry map with its names below that
    const box: [number, number, number, number] = [REGION.west, REGION.south, REGION.east, REGION.north]
    sources.base = { type: 'raster', tiles: b.tiles, tileSize: b.tileSize, attribution: b.attribution, maxzoom: b.maxzoom, ...(o.online ? { bounds: box } : {}) }
    base = [{ id: 'background', type: 'background', paint: { 'background-color': BUSH.background } }]
    if (o.online) {
      sources.country = { type: 'raster', tiles: b.tiles, tileSize: b.tileSize, attribution: b.attribution, maxzoom: 7 }
      base.push({ id: 'country', type: 'raster', source: 'country', maxzoom: 7, paint: { 'raster-saturation': -0.3, 'raster-brightness-max': 0.8, 'raster-resampling': 'linear' } })
      if (LIVE_RASTER.labels) {
        const lb = LIVE_RASTER.labels
        sources.labels = { type: 'raster', tiles: lb.tiles, tileSize: lb.tileSize, attribution: lb.attribution, maxzoom: lb.maxzoom }
        base.push({ id: 'country-labels', type: 'raster', source: 'labels', maxzoom: 7, paint: { 'raster-opacity': 0.95, 'raster-resampling': 'linear' } })
      }
      if (LIVE_RASTER.toposheet) {
        const ts = LIVE_RASTER.toposheet
        sources.toposheet = { type: 'raster', tiles: ts.tiles, tileSize: ts.tileSize, attribution: ts.attribution, minzoom: ts.minzoom, maxzoom: ts.maxzoom }
        base.push({ id: 'toposheet', type: 'raster', source: 'toposheet', minzoom: ts.minzoom, paint: { 'raster-opacity': 0.92, 'raster-resampling': 'linear' } })
      }
    }
    base.push({
      id: 'base',
      type: 'raster',
      source: 'base',
      // quiet: the base is furniture, the data layers own the contrast
      paint: { 'raster-saturation': -0.7, 'raster-brightness-max': 0.45, 'raster-contrast': 0.1 },
    })
  }
  base = base.map((l) => (l.type === 'background' ? { ...l, paint: { ...l.paint, 'background-color': groundColour(o.layers) } } : l))
  const firstSymbol = base.findIndex((l) => l.type === 'symbol')
  const underLabels = firstSymbol === -1 ? base.length : firstSymbol

  // ---- raster stack (bottom to top): satellite, hillshade, topo, historical ----
  const rasters: LayerSpecification[] = []
  const addRaster = (key: 'satellite' | 'hillshade' | 'topo' | 'historical', extraPaint: Record<string, unknown> = {}) => {
    if (has(key)) {
      sources[key] = { type: 'raster', url: `pmtiles://${key}`, tileSize: 256 }
      // with signal the live service under the baked archive: the archive
      // stops at the box, the service shows through beyond it, same switch
      const live = o.online ? LIVE_RASTER[key] : undefined
      if (live) {
        sources[`${key}-live`] = {
          type: 'raster',
          tiles: live.tiles,
          tileSize: live.tileSize,
          attribution: live.attribution,
          ...(live.minzoom != null ? { minzoom: live.minzoom } : {}),
          ...(live.maxzoom != null ? { maxzoom: live.maxzoom } : {}),
          ...(live.scheme ? { scheme: live.scheme } : {}),
        }
        rasters.push(
          tag(
            { id: `${key}-live`, type: 'raster', source: `${key}-live`, layout: vis(o.layers[key]), paint: { 'raster-opacity': o.opacity[key], 'raster-resampling': 'linear', ...extraPaint } },
            key,
            key,
          ),
        )
      }
    } else {
      const live = LIVE_RASTER[key]
      if (!live) return
      sources[key] = {
        type: 'raster',
        tiles: live.tiles,
        tileSize: live.tileSize,
        attribution: live.attribution,
        ...(live.minzoom != null ? { minzoom: live.minzoom } : {}),
        ...(live.maxzoom != null ? { maxzoom: live.maxzoom } : {}),
        ...(live.scheme ? { scheme: live.scheme } : {}),
      }
    }
    rasters.push(
      tag(
        {
          id: key,
          type: 'raster',
          source: key,
          layout: vis(o.layers[key]),
          paint: { 'raster-opacity': o.opacity[key], 'raster-resampling': 'linear', ...extraPaint },
        },
        key,
        key,
      ),
    )
  }
  addRaster('satellite', { 'raster-saturation': -0.3 })
  // Two switches over the elevation tiles. Elevation colours: the heights
  // coloured, lakes as water. Hillshade: the shade drawn from the heights,
  // which carries the hillsides at every zoom, and over it from z13.5 the
  // crisp baked grey 1 m LiDAR shade near camp, the one that shows old skid
  // trails and ditches; the DEM-drawn shade has 1.6 m pixels and a smoothing
  // light, and loses them. The DEM shade used to fade out under the LiDAR
  // one, but that one is mostly a light veil on these gentle slopes (it only
  // turns dark past ~15°), so the hillsides went with it on zooming in
  // (Gavan, 2026-09-29, Bow view), and outside the core there was nothing
  // to take over at all.
  const dem = has('dem')
  if (dem) {
    sources.dem = { type: 'raster-dem', url: 'pmtiles://dem', encoding: 'mapbox', tileSize: 256, attribution: `MRDEM © Natural Resources Canada, ${FINE_RELIEF.attribution}` }
    const lakes = o.geo.get('waterbody')
    if (lakes) sources.lakes = { type: 'geojson', data: geoData('lakes', lakes, 'relief'), attribution: ATTRIBUTION.lakes }
    // with signal the live MRDEM shade under the DEM's: the DEM stops at the
    // box, the service shows through beyond it, the same switch and strength.
    // Under the baked imagery too, where there is one: over the imagery it is
    // the DEM-drawn shade alone inside the box (syncUnderlays)
    liveShadeUnderImagery = false
    if (o.online && LIVE_RASTER.hillshade) {
      const hs = LIVE_RASTER.hillshade
      sources['hillshade-live'] = { type: 'raster', tiles: hs.tiles, tileSize: hs.tileSize, attribution: hs.attribution, ...(hs.maxzoom != null ? { maxzoom: hs.maxzoom } : {}) }
      const shade = tag(
        { id: 'hillshade-live', type: 'raster', source: 'hillshade-live', layout: vis(o.layers.hillshade), paint: { 'raster-opacity': o.opacity.hillshade, 'raster-resampling': 'linear' } },
        'hillshade',
        'hillshade',
      ) as LayerSpecification
      const baked = has('satellite') ? rasters.findIndex((l) => l.id === 'satellite') : -1
      if (baked >= 0) rasters.splice(baked, 0, shade)
      else rasters.push(shade)
      liveShadeUnderImagery = baked >= 0
    }
    rasters.push(
      tag(
        {
          id: 'relief-colour',
          type: 'color-relief',
          source: 'dem',
          layout: vis(o.layers.relief),
          paint: { 'color-relief-color': RELIEF_RAMP, 'color-relief-opacity': o.opacity.relief },
        } as LayerSpecification,
        'relief',
        'relief',
      ),
      tag(
        {
          id: 'relief-shade',
          type: 'hillshade',
          source: 'dem',
          layout: vis(o.layers.hillshade),
          paint: {
            'hillshade-method': 'multidirectional',
            'hillshade-illumination-direction': [270, 315, 0, 45],
            ...reliefShadePaint(o.layers, o.opacity),
          },
        } as LayerSpecification,
        'hillshade',
      ),
    )
    if (lakes)
      rasters.push(
        tag(
          {
            id: 'relief-lakes',
            type: 'fill',
            source: 'lakes',
            layout: vis(o.layers.relief),
            paint: { 'fill-color': '#3f6f8f', 'fill-outline-color': '#5d8fae', 'fill-opacity': 0.95 },
          },
          'relief',
        ),
      )
    // The bogs, in the Topo view: the stands' open and treed muskeg (the
    // FRI's OMS and TMS), a blue tint under the old topo sheets' marsh tufts,
    // the open bog the stronger. The relief's colours said nothing of them,
    // and the Windy look's wash showed them, the air running faster over the
    // open ground (Gavan, 2026-10-07). Under the LiDAR shade, the contours
    // and the roads; with the relief's switch. National stands (the Sault,
    // the Yukon) carry no wetland class, so none show there.
    if (has('forest')) {
      sources.forest = { type: 'vector', url: 'pmtiles://forest' }
      const wet: FilterSpecification = ['==', ['get', 'group'], 'wetland']
      const open = ['==', ['get', 'poly'], 'OMS'] as unknown as ExpressionSpecification
      rasters.push(
        tag(
          {
            id: 'relief-bog',
            type: 'fill',
            source: 'forest',
            'source-layer': 'forest',
            filter: wet,
            layout: vis(o.layers.relief),
            paint: { 'fill-color': '#4f86a8', 'fill-opacity': ['case', open, 0.32, 0.16] },
          },
          'relief',
        ),
        tag(
          {
            id: 'relief-bog-tufts',
            type: 'fill',
            source: 'forest',
            'source-layer': 'forest',
            minzoom: 12,
            filter: wet,
            layout: vis(o.layers.relief),
            paint: { 'fill-pattern': BOG_TUFT, 'fill-opacity': ['case', open, 0.9, 0.5] },
          },
          'relief',
        ),
      )
    }
  } else addRaster('hillshade')
  // the 1 m LiDAR shade rides above the DEM-drawn one where it is baked (the
  // core, z14+); both answer to the one Hillshade switch and slider
  if (has('hillshadeLidar')) {
    sources.hillshadeLidar = { type: 'raster', url: 'pmtiles://hillshadeLidar', tileSize: 256, minzoom: CORE_MINZOOM, attribution: FINE_RELIEF.attribution }
    rasters.push(
      tag(
        {
          id: 'hillshade-lidar',
          type: 'raster',
          source: 'hillshadeLidar',
          minzoom: CORE_HANDOFF,
          layout: vis(lidarShadeShown(o.layers, o.opacity)),
          paint: { 'raster-opacity': o.opacity.hillshade, 'raster-resampling': 'linear', 'raster-brightness-max': lidarShadeBrightness(o.layers) },
        },
        'hillshade',
        'hillshade',
      ),
    )
  }
  // bush thickness from the point cloud, near camp (z10–16 baked, overzoomed above)
  if (has('understory')) {
    sources.understory = { type: 'raster', url: 'pmtiles://understory', tileSize: 256, minzoom: BUSH_MINZOOM, maxzoom: CORE.maxzoom, attribution: ATTRIBUTION.bush }
    rasters.push(
      tag(
        {
          id: 'understory',
          type: 'raster',
          source: 'understory',
          minzoom: BUSH_LAYER_MINZOOM,
          layout: vis(o.layers.understory),
          paint: { 'raster-opacity': o.opacity.understory, 'raster-resampling': 'nearest' },
        },
        'understory',
        'understory',
      ),
    )
  }
  // the same bush drawn for a bow: open ground left clear, thicker bush darker
  if (has('lanes')) {
    sources.lanes = { type: 'raster', url: 'pmtiles://lanes', tileSize: 256, minzoom: BUSH_MINZOOM, maxzoom: CORE.maxzoom, attribution: ATTRIBUTION.bush }
    rasters.push(
      tag(
        {
          id: 'lanes',
          type: 'raster',
          source: 'lanes',
          minzoom: LANES_LAYER_MINZOOM,
          layout: vis(o.layers.lanes),
          paint: { 'raster-opacity': o.opacity.lanes, 'raster-resampling': 'linear' },
        },
        'lanes',
        'lanes',
      ),
    )
  }
  addRaster('topo')
  addRaster('historical', { 'raster-saturation': -0.2 })
  // the coverage grid (explore/coverage.ts), shown while Explore is on
  if (has(COVERAGE_KEY)) {
    sources[COVERAGE_SOURCE] = coverageSource()
    rasters.push(...coverageLayers().map((l) => ({ ...l, layout: { ...(l.layout ?? {}), ...vis(!!o.explore) } }) as LayerSpecification))
  }
  // every baked box drawn, the area's own strongest, named zoomed out
  if (o.online) {
    const boxes = AREA_LIST.filter((a) => !a.virtual)
    sources['area-boxes'] = {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: boxes.map((a) => ({
          type: 'Feature',
          properties: { id: a.id, name: a.name, active: a.id === ACTIVE_AREA.id },
          geometry: { type: 'Polygon', coordinates: [[[a.region.west, a.region.south], [a.region.east, a.region.south], [a.region.east, a.region.north], [a.region.west, a.region.north], [a.region.west, a.region.south]]] },
        })),
      },
    }
    rasters.push(
      { id: 'area-boxes-line', type: 'line', source: 'area-boxes', paint: { 'line-color': '#1f3b1f', 'line-width': ['case', ['get', 'active'], 2, 1.2], 'line-opacity': 0.75 } },
      {
        id: 'area-boxes-label',
        type: 'symbol',
        source: 'area-boxes',
        maxzoom: 10,
        layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Medium'], 'text-size': 12, 'text-anchor': 'bottom', 'symbol-placement': 'point' },
        paint: { 'text-color': '#1f3b1f', 'text-halo-color': 'rgba(238,245,234,0.9)', 'text-halo-width': 1.4 },
      },
    )
  }
  // the MNR lake survey sheets (Pickle 1978, Ketchup 1978, McGill 1979),
  // fitted to the shoreline and baked as ink on transparency: the true
  // surveyed contours and soundings. They answer to the Lake depths switch.
  if (has('bathySheets')) {
    sources.bathySheets = { type: 'raster', url: 'pmtiles://bathySheets', tileSize: 256, minzoom: 12, maxzoom: 17 }
    rasters.push(
      tag(
        { id: 'bathy-sheets', type: 'raster', source: 'bathySheets', minzoom: 12, layout: vis(o.layers.bathy), paint: { 'raster-opacity': 0.95, 'raster-resampling': 'linear' } },
        'bathy',
      ),
    )
  }

  const ink = CONTOUR_INK[baseTone(o.layers)]
  // ---- region contours (10 m from the 30 m MRDEM, z8+) ----
  // The coarse picture of the ground, so zooming out or looking past the
  // core keeps the hills outlined (Gavan, 2026-10-01: the elevation went
  // with the zoom). The bake thins by zoom (50 m lines to z9, 20 m to z11,
  // 10 m from z12); step >= 50 is the index line, labelled from z12. Where
  // the 1 m LiDAR lines take over (the core, z13.5+) the parts tagged
  // `core` drop out so the two bakes never double up.
  if (has('contoursWide')) {
    sources.contoursWide = { type: 'vector', url: 'pmtiles://contoursWide', minzoom: 8, maxzoom: 14 }
    const outsideLidar = (f: FilterSpecification): FilterSpecification =>
      has('contours') ? (['step', ['zoom'], f, CORE_HANDOFF, ['all', f, ['==', ['get', 'core'], 0]]] as unknown as FilterSpecification) : f
    const index: FilterSpecification = ['>=', ['get', 'step'], 50]
    const thin: FilterSpecification = ['<', ['get', 'step'], 50]
    const wide = { source: 'contoursWide', 'source-layer': 'contours' } as const
    rasters.push(
      tag(
        {
          id: 'contour-wide-line',
          type: 'line',
          ...wide,
          filter: outsideLidar(thin),
          layout: vis(o.layers.contours),
          paint: {
            'line-color': ink.line,
            'line-opacity': 0.8,
            'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.4, 14, 0.7],
          },
        },
        'contours',
      ),
      tag(
        {
          id: 'contour-wide-index',
          type: 'line',
          ...wide,
          filter: outsideLidar(index),
          layout: vis(o.layers.contours),
          paint: {
            'line-color': ink.index,
            'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.6, 12, 1, 14, 1.4],
          },
        },
        'contours',
      ),
      tag(
        {
          id: 'contour-wide-label',
          type: 'symbol',
          ...wide,
          minzoom: 12,
          filter: outsideLidar(index),
          layout: {
            ...vis(o.layers.contours),
            'symbol-placement': 'line',
            'text-field': ['to-string', ['get', 'elev']],
            'text-font': FONT,
            'text-size': 10,
            'symbol-spacing': 300,
            'text-max-angle': 30,
          },
          paint: { 'text-color': ink.text, 'text-halo-color': ink.halo, 'text-halo-width': 1.2 },
        },
        'contours',
      ),
    )
  }

  // ---- LiDAR contours (core only, z14+) ----
  // The bake holds every whole metre; the interval is a filter, so the
  // Settings knob switches instantly and offline. Every fifth line is an
  // index line: heavier, labelled.
  if (has('contours')) {
    sources.contours = { type: 'vector', url: 'pmtiles://contours', minzoom: CORE_MINZOOM, maxzoom: CORE.maxzoom }
    const [keep, index, labelled] = contourFilters(o.contourInterval)
    const line = { source: 'contours', 'source-layer': 'contours', minzoom: CORE_HANDOFF } as const
    rasters.push(
      tag(
        {
          id: 'contour-line',
          type: 'line',
          ...line,
          filter: keep,
          layout: vis(o.layers.contours),
          paint: {
            'line-color': ink.line,
            'line-width': ['interpolate', ['linear'], ['zoom'], 14, 0.5, 16, 0.8],
          },
        },
        'contours',
      ),
      tag(
        {
          id: 'contour-index',
          type: 'line',
          ...line,
          filter: index,
          layout: vis(o.layers.contours),
          paint: {
            'line-color': ink.index,
            'line-width': ['interpolate', ['linear'], ['zoom'], 14, 1, 16, 1.6],
          },
        },
        'contours',
      ),
      tag(
        {
          id: 'contour-label',
          type: 'symbol',
          ...line,
          filter: labelled,
          layout: {
            ...vis(o.layers.contours),
            'symbol-placement': 'line',
            'text-field': ['to-string', ['get', 'elev']],
            'text-font': FONT,
            'text-size': 10,
            'symbol-spacing': 260,
            'text-max-angle': 30,
          },
          paint: { 'text-color': ink.text, 'text-halo-color': ink.halo, 'text-halo-width': 1.2 },
        },
        'contours',
      ),
    )
  }

  // ---- vector overlays ----
  // Each overlay reads from the baked 'places' archive (one source-layer
  // per theme) when it exists, else from the live LIO GeoJSON query (an
  // Ontario area's only: elsewhere a theme not baked is left out).
  const vectors: LayerSpecification[] = []
  type Theme = 'forest' | 'bathy' | 'wmu' | 'camps' | 'crown' | 'parks' | 'fire' | 'roads'
  const themeSource = (t: Theme): { source: string; 'source-layer'?: string } | null => {
    if (t === 'forest' && has('forest')) {
      sources.forest = { type: 'vector', url: 'pmtiles://forest' }
      return { source: 'forest', 'source-layer': 'forest' }
    }
    if (t === 'bathy' && has('bathy')) {
      sources.bathy = { type: 'vector', url: 'pmtiles://bathy' }
      return { source: 'bathy', 'source-layer': 'bathy' }
    }
    if (has('places') && t !== 'forest' && t !== 'bathy') {
      if (!sources.places) sources.places = { type: 'vector', url: 'pmtiles://places' }
      return { source: 'places', 'source-layer': t }
    }
    const live = t in LIVE_VECTOR ? LIVE_VECTOR[t as keyof typeof LIVE_VECTOR] : undefined
    const baked = o.geo.get(t)
    if (baked) {
      sources[`geo-${t}`] = { type: 'geojson', data: geoData(`geo-${t}`, baked, t), attribution: live?.attribution ?? ATTRIBUTION.vectors }
      return { source: `geo-${t}` }
    }
    if (!live) return null
    sources[`live-${t}`] = { type: 'geojson', data: geoData(`live-${t}`, live.url, t), attribution: live.attribution }
    return { source: `live-${t}` }
  }

  // Forest cover: FRI stand polygons by cover group. The groups' colours
  // sit apart from each other and from the imagery's own greens (the old
  // conifer and mixed were two dark greens that went into the trees
  // zoomed out, and lakes took the fallback green: Gavan, 2026-10-04):
  // conifer dark teal, mixed green, hardwood pale lime. None is warm, as
  // the heat under them is amber, orange and red (a gold hardwood read
  // as a hot patch), so a burn is mauve; water is left clear. Zoomed out
  // the wood type is named per patch (the bake's forest_label points,
  // each in from the zoom its name fits at), in a tint of its fill; close
  // in, each stand's name over its species-and-year code. The bake's
  // `cover` draws an old cut or burn as the trees grown back on it.
  const forest = themeSource('forest')
  if (forest) {
    const groupTint = (tints: Record<string, string>, other: string) =>
      ['match', ['coalesce', ['get', 'cover'], ['get', 'group']], ...Object.entries(tints).flat(), other] as unknown as ExpressionSpecification
    vectors.push(
      tag(
        {
          id: 'forest-fill',
          type: 'fill',
          ...forest,
          layout: vis(o.layers.forest),
          paint: {
            'fill-color': groupTint(
              { conifer: '#176b5b', mixed: '#7cb342', hardwood: '#c6ec5c', cut: '#dcd2bc', burn: '#a77fc0', wetland: '#6f93b8', brush: '#8f8a6a', water: 'rgba(0,0,0,0)' },
              '#5a6a5a',
            ),
            'fill-opacity': o.opacity.forest,
          },
        },
        'forest',
        'forest',
      ),
    )
    const textTint = groupTint(
      { conifer: '#bfe8dc', mixed: '#d6f0b4', hardwood: '#f2fbc8', cut: '#efe9dc', burn: '#e4d0f2', wetland: '#c4d8ef', brush: '#e2dcc4' },
      'rgba(230,240,225,0.9)',
    )
    if (forest['source-layer'])
      vectors.push(
        tag(
          {
            id: 'forest-type',
            type: 'symbol',
            source: forest.source,
            'source-layer': 'forest_label',
            maxzoom: 15,
            layout: {
              ...vis(o.layers.forest),
              'text-field': ['get', 'name'],
              'text-font': FONT_MED,
              'text-size': 12,
              'symbol-sort-key': ['-', ['to-number', ['get', 'r'], 0]],
              'text-padding': 4,
            },
            paint: { 'text-color': textTint, ...HALO },
          },
          'forest',
        ),
      )
    vectors.push(
      tag(
        {
          id: 'forest-label',
          type: 'symbol',
          ...forest,
          minzoom: 15,
          layout: {
            ...vis(o.layers.forest),
            'text-field': [
              'format',
              ['coalesce', ['get', 'name'], ''], { 'text-font': ['literal', FONT_MED], 'font-scale': 1.1 },
              ['case', ['has', 'name'], '\n', ''], {},
              ['concat', ['coalesce', ['get', 'species'], ''], ' ', ['coalesce', ['to-string', ['get', 'year']], '']], {},
            ],
            'text-font': FONT,
            'text-size': 10,
          },
          paint: { 'text-color': textTint, ...HALO },
        },
        'forest',
      ),
    )
  }

  // Fire perimeters: the old burns, labelled by year.
  const fire = themeSource('fire')
  if (fire) {
    vectors.push(
      tag(
        {
          id: 'fire-fill',
          type: 'fill',
          ...fire,
          layout: vis(o.layers.fire),
          paint: { 'fill-color': 'rgba(255,120,60,0.18)', 'fill-outline-color': 'rgba(255,120,60,0.6)' },
        },
        'fire',
      ),
      tag(
        {
          id: 'fire-label',
          type: 'symbol',
          ...fire,
          minzoom: 10,
          layout: { ...vis(o.layers.fire), 'text-field': ['concat', 'burn ', ['to-string', ['get', 'FIRE_YEAR']]], 'text-font': FONT, 'text-size': 10.5 },
          paint: { 'text-color': 'rgba(255,170,120,0.95)', ...HALO },
        },
        'fire',
      ),
    )
  }

  // Patented (private) land. Everything without a patent is Crown.
  const crown = themeSource('crown')
  if (crown) {
    vectors.push(
      tag(
        {
          id: 'crown-fill',
          type: 'fill',
          ...crown,
          layout: vis(o.layers.crown),
          paint: { 'fill-color': 'rgba(255,110,110,0.14)', 'fill-outline-color': 'rgba(255,110,110,0.5)' },
        },
        'crown',
      ),
    )
  }
  const parks = themeSource('parks')
  if (parks) {
    vectors.push(
      tag(
        {
          id: 'parks-line',
          type: 'line',
          ...parks,
          layout: vis(o.layers.parks),
          paint: { 'line-color': 'rgba(120,220,120,0.7)', 'line-width': 1.5, 'line-dasharray': [2, 2] },
        },
        'parks',
      ),
      tag(
        {
          id: 'parks-label',
          type: 'symbol',
          ...parks,
          minzoom: 9,
          layout: { ...vis(o.layers.parks), 'text-field': ['get', 'PROTECTED_AREA_NAME_ENG'], 'text-font': FONT, 'text-size': 11 },
          paint: { 'text-color': 'rgba(150,230,150,0.95)', ...HALO },
        },
        'parks',
      ),
    )
  }

  // Lake depths: contour lines with labels.
  const bathy = themeSource('bathy')
  if (bathy) {
    vectors.push(
      tag(
        {
          id: 'bathy-line',
          type: 'line',
          ...bathy,
          layout: vis(o.layers.bathy),
          paint: {
            'line-color': ['case', ['<=', ['coalesce', ['get', 'DEPTH'], 0], 3], 'rgba(255,138,128,0.6)', 'rgba(148,209,245,0.5)'],
            'line-width': 0.9,
          },
        },
        'bathy',
      ),
      tag(
        {
          id: 'bathy-label',
          type: 'symbol',
          ...bathy,
          minzoom: 12,
          layout: {
            ...vis(o.layers.bathy),
            'symbol-placement': 'line',
            'text-field': ['to-string', ['get', 'DEPTH']],
            'text-font': FONT,
            'text-size': 10,
            'symbol-spacing': 300,
          },
          paint: { 'text-color': 'rgba(190,226,250,0.9)', 'text-halo-color': 'rgba(8,24,40,0.9)', 'text-halo-width': 1.2 },
        },
        'bathy',
      ),
    )
  }

  const wmu = themeSource('wmu')
  if (wmu) {
    vectors.push(
      tag(
        {
          id: 'wmu-line',
          type: 'line',
          ...wmu,
          layout: vis(o.layers.wmu),
          paint: { 'line-color': 'rgba(255,180,84,0.75)', 'line-width': 1.6, 'line-dasharray': [4, 2] },
        },
        'wmu',
      ),
      tag(
        {
          id: 'wmu-label',
          type: 'symbol',
          ...wmu,
          // the zone's word is the area's: WMU 21B in Ontario, Zone 18 in Quebec
          layout: { ...vis(o.layers.wmu), 'text-field': ['concat', `${ZONE.label} `, ['get', 'OFFICIAL_NAME']], 'text-font': FONT_MED, 'text-size': 12 },
          paint: { 'text-color': 'rgba(255,180,84,0.95)', ...HALO },
        },
        'wmu',
      ),
    )
  }

  const roads = themeSource('roads')
  if (roads) {
    vectors.push(
      tag(
        {
          id: 'roads-line',
          type: 'line',
          ...roads,
          layout: vis(o.layers.roads),
          paint: { 'line-color': 'rgba(230,220,180,0.55)', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.6, 14, 2] },
        },
        'roads',
      ),
    )
  }

  // Camps: LUP polygons are small; draw the fill and a name at the centre.
  const camps = themeSource('camps')
  if (camps) {
    vectors.push(
      tag(
        {
          id: 'camps-fill',
          type: 'fill',
          ...camps,
          layout: vis(o.layers.camps),
          paint: { 'fill-color': 'rgba(255,180,84,0.35)', 'fill-outline-color': '#ffb454' },
        },
        'camps',
      ),
      tag(
        {
          id: 'camps-label',
          type: 'symbol',
          ...camps,
          minzoom: 10,
          layout: {
            ...vis(o.layers.camps),
            'text-field': ['coalesce', ['get', 'SITE_NAME'], ['get', 'name'], ['get', 'PURPOSE_OF_DISPOSITION']],
            'text-font': FONT,
            'text-size': 10.5,
            'text-offset': [0, 0.8],
            'text-anchor': 'top',
          },
          paint: { 'text-color': 'rgba(255,220,170,0.95)', ...HALO },
        },
        'camps',
      ),
    )
  }

  // Weather radar on top of everything but labels and places.
  const radar = LIVE_RASTER.radar
  if (radar) {
    sources.radar = { type: 'raster', tiles: radar.tiles, tileSize: radar.tileSize, attribution: radar.attribution, maxzoom: radar.maxzoom }
    vectors.push(
      tag(
        { id: 'radar', type: 'raster', source: 'radar', layout: vis(o.layers.weather), paint: { 'raster-opacity': 0.7, 'raster-resampling': 'linear', 'raster-fade-duration': 0 } },
        'weather',
      ),
    )
  }

  return {
    version: 8,
    glyphs: `${o.base}fonts/{fontstack}/{range}.pbf`,
    sprite: `${new URL(o.base + 'sprites/v4/dark', window.location.href)}`,
    sources,
    layers: [...base.slice(0, underLabels), ...rasters, ...vectors, ...base.slice(underLabels)],
  }
}
