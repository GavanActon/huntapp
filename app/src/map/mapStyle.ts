import { DARK, layers as basemapLayers } from '@protomaps/basemaps'
import type { ExpressionSpecification, FilterSpecification, LayerSpecification, StyleSpecification } from 'maplibre-gl'
import { LIVE_RASTER, LIVE_VECTOR } from '../sources'
import type { ContourInterval, LayerOpacity, LayerVisibility } from '../state/appStore'

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

/** [lines to keep, index lines] for a contour interval. A line's `step` is
 *  the coarsest of 10/5/2/1 that divides its elevation, so `step >= interval`
 *  keeps every interval-th metre; index lines are every fifth of those. */
/** [every line kept, the index lines, the lines labelled]. At the fine
 *  intervals (1–2 m) every line carries its number, since that is what the
 *  close reading of a bench or a saddle is for; coarser, the index lines only. */
export function contourFilters(interval: ContourInterval): [FilterSpecification, FilterSpecification, FilterSpecification] {
  const keep: FilterSpecification = ['>=', ['get', 'step'], interval]
  const index: FilterSpecification = ['==', ['%', ['get', 'elev'], interval * 5], 0]
  return [keep, index, interval <= 2 ? keep : index]
}
/** Elevation colours for the relief, m: low ground and lake shores green,
 *  through the core's benches (340–420 m) in olive and tan, to the high
 *  ridges in pale brown. Stretched over the core's 325–466 m, with the
 *  wider region's extremes clamped at either end. */
const RELIEF_RAMP = [
  'interpolate',
  ['linear'],
  ['elevation'],
  250, '#2f5236',
  325, '#3f6b42',
  340, '#5a824a',
  355, '#7b9651',
  370, '#a0a65a',
  385, '#bfae63',
  400, '#cc9f5e',
  415, '#bf8658',
  430, '#a9735a',
  450, '#b49a86',
  470, '#d9ccbd',
  600, '#f1ebe2',
] as unknown as ExpressionSpecification

const FONT = ['Noto Sans Regular']
const FONT_MED = ['Noto Sans Medium']
const HALO = { 'text-halo-color': 'rgba(10,20,12,0.92)', 'text-halo-width': 1.2 }

export function buildMapStyle(o: StyleOpts): StyleSpecification {
  const sources: StyleSpecification['sources'] = {}
  const has = (k: string) => o.available.has(k)

  // ---- base ----
  let base: LayerSpecification[]
  if (has('basemap')) {
    sources.basemap = { type: 'vector', url: 'pmtiles://basemap', attribution: '© OpenStreetMap' }
    base = basemapLayers('basemap', BUSH, { lang: 'en' })
  } else {
    const b = LIVE_RASTER.base!
    sources.base = { type: 'raster', tiles: b.tiles, tileSize: b.tileSize, attribution: b.attribution, maxzoom: b.maxzoom }
    base = [
      { id: 'background', type: 'background', paint: { 'background-color': BUSH.background } },
      {
        id: 'base',
        type: 'raster',
        source: 'base',
        // quiet: the base is furniture, the data layers own the contrast
        paint: { 'raster-saturation': -0.7, 'raster-brightness-max': 0.45, 'raster-contrast': 0.1 },
      },
    ]
  }
  const firstSymbol = base.findIndex((l) => l.type === 'symbol')
  const underLabels = firstSymbol === -1 ? base.length : firstSymbol

  // ---- raster stack (bottom to top): satellite, hillshade, topo, historical ----
  const rasters: LayerSpecification[] = []
  const addRaster = (key: 'satellite' | 'hillshade' | 'topo' | 'historical', extraPaint: Record<string, unknown> = {}) => {
    if (has(key)) {
      sources[key] = { type: 'raster', url: `pmtiles://${key}`, tileSize: 256 }
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
  // coloured, lakes as water. Hillshade: the shade, drawn from the heights
  // for the wide view, then the crisp baked grey 1 m LiDAR shade near camp
  // from z13.5, the one that shows old skid trails and ditches; the
  // DEM-drawn shade has 1.6 m pixels and a smoothing light, and loses them.
  const dem = has('dem')
  if (dem) {
    sources.dem = { type: 'raster-dem', url: 'pmtiles://dem', encoding: 'mapbox', tileSize: 256, attribution: 'MRDEM, HRDEM LiDAR © Natural Resources Canada' }
    const lakes = o.geo.get('waterbody')
    if (lakes) sources.lakes = { type: 'geojson', data: lakes, attribution: '© Ontario MNRF' }
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
            'hillshade-illumination-altitude': [30, 30, 30, 30],
            'hillshade-highlight-color': ['rgba(255,250,235,0.35)', 'rgba(255,250,235,0.45)', 'rgba(255,250,235,0.35)', 'rgba(255,250,235,0.2)'],
            'hillshade-shadow-color': ['rgba(16,20,12,0.6)', 'rgba(16,20,12,0.8)', 'rgba(16,20,12,0.6)', 'rgba(16,20,12,0.35)'],
            // fading out where the grey LiDAR shade takes over, so the core is not shaded twice
            'hillshade-exaggeration': has('hillshadeLidar') ? ['interpolate', ['linear'], ['zoom'], 13.3, 0.85, 14, 0.25] : 0.85,
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
  } else addRaster('hillshade')
  // the 1 m LiDAR shade rides above the 30 m one where it is baked (the
  // core, z14+); both answer to the one Hillshade switch and slider
  if (has('hillshadeLidar')) {
    sources.hillshadeLidar = { type: 'raster', url: 'pmtiles://hillshadeLidar', tileSize: 256, minzoom: 14 }
    rasters.push(
      tag(
        {
          id: 'hillshade-lidar',
          type: 'raster',
          source: 'hillshadeLidar',
          minzoom: 13.5,
          layout: vis(o.layers.hillshade),
          paint: { 'raster-opacity': o.opacity.hillshade, 'raster-resampling': 'linear' },
        },
        'hillshade',
        'hillshade',
      ),
    )
  }
  // bush thickness from the point cloud, near camp (z14–16 baked, overzoomed above)
  if (has('understory')) {
    sources.understory = { type: 'raster', url: 'pmtiles://understory', tileSize: 256, minzoom: 14, maxzoom: 16, attribution: 'FRI LiDAR © Ontario MNR' }
    rasters.push(
      tag(
        {
          id: 'understory',
          type: 'raster',
          source: 'understory',
          minzoom: 12.5,
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
    sources.lanes = { type: 'raster', url: 'pmtiles://lanes', tileSize: 256, minzoom: 14, maxzoom: 16, attribution: 'FRI LiDAR © Ontario MNR' }
    rasters.push(
      tag(
        {
          id: 'lanes',
          type: 'raster',
          source: 'lanes',
          minzoom: 12.5,
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

  // ---- LiDAR contours (core only, z14+) ----
  // The bake holds every whole metre; the interval is a filter, so the
  // Settings knob switches instantly and offline. Every fifth line is an
  // index line: heavier, labelled.
  if (has('contours')) {
    sources.contours = { type: 'vector', url: 'pmtiles://contours', minzoom: 14, maxzoom: 16 }
    const [keep, index, labelled] = contourFilters(o.contourInterval)
    const line = { source: 'contours', 'source-layer': 'contours', minzoom: 13.5 } as const
    rasters.push(
      tag(
        {
          id: 'contour-line',
          type: 'line',
          ...line,
          filter: keep,
          layout: vis(o.layers.contours),
          paint: {
            'line-color': 'rgba(214,170,110,0.55)',
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
            'line-color': 'rgba(228,186,124,0.85)',
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
          paint: { 'text-color': 'rgba(240,206,150,0.95)', 'text-halo-color': 'rgba(10,20,12,0.9)', 'text-halo-width': 1.2 },
        },
        'contours',
      ),
    )
  }

  // ---- vector overlays ----
  // Each overlay reads from the baked 'places' archive (one source-layer
  // per theme) when it exists, else from the live LIO GeoJSON query.
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
      sources[`geo-${t}`] = { type: 'geojson', data: baked, attribution: live?.attribution ?? '© Ontario MNRF' }
      return { source: `geo-${t}` }
    }
    if (!live) return null
    sources[`live-${t}`] = { type: 'geojson', data: live.url, attribution: live.attribution }
    return { source: `live-${t}` }
  }

  // Forest cover: FRI stand polygons by cover group, age as label.
  const forest = themeSource('forest')
  if (forest) {
    vectors.push(
      tag(
        {
          id: 'forest-fill',
          type: 'fill',
          ...forest,
          layout: vis(o.layers.forest),
          paint: {
            'fill-color': [
              'match',
              ['get', 'group'],
              'conifer', '#1f6b3a',
              'mixed', '#5f8f2e',
              'hardwood', '#c9a227',
              'cut', '#8a5a2b',
              'burn', '#7a2e2e',
              'wetland', '#2e6b6b',
              '#3a5a3a',
            ],
            'fill-opacity': o.opacity.forest,
          },
        },
        'forest',
        'forest',
      ),
      tag(
        {
          id: 'forest-label',
          type: 'symbol',
          ...forest,
          minzoom: 13,
          layout: {
            ...vis(o.layers.forest),
            'text-field': ['concat', ['coalesce', ['get', 'species'], ''], ' ', ['coalesce', ['to-string', ['get', 'year']], '']],
            'text-font': FONT,
            'text-size': 10,
          },
          paint: { 'text-color': 'rgba(230,240,225,0.8)', ...HALO },
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
          layout: { ...vis(o.layers.wmu), 'text-field': ['concat', 'WMU ', ['get', 'OFFICIAL_NAME']], 'text-font': FONT_MED, 'text-size': 12 },
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
        { id: 'radar', type: 'raster', source: 'radar', layout: vis(o.layers.weather), paint: { 'raster-opacity': 0.7 } },
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
