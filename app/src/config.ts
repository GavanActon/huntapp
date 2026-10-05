// Central place for region + data-file configuration, all of it the active
// area's (areas/index.ts). A new hunting area = a new app/src/areas/<id>.json
// plus a pipeline run (docs/AREAS.md).
import { ACTIVE_AREA, AREA_LIST, DEFAULT_AREA, type AreaDef } from './areas'

const AREA = ACTIVE_AREA

/**
 * Where the map opens with nothing better (no fix, no saved view): the
 * area's home. At Pickle Lake, the camp on the peninsula, near the map link
 * Gavan shared: Pickle / McGill / Ketchup Lakes, north-west of White River,
 * south of Manitouwadge (Thunder Bay District, Ontario).
 */
export const HOME = {
  center: [AREA.home.center[0], AREA.home.center[1]] as [number, number],
  zoom: AREA.home.zoom,
}

/** The region the map may show at all: about 12 km around the camp. At
 *  Pickle Lake it takes in McGill, Ketchup and Line Lakes and Pickle Creek
 *  (Gavan, 2026-09-25: only the immediate area around Pickle Lake matters).
 *  Baked to REGION_MAXZOOM; the CORE inside it to full detail. */
export const REGION = {
  id: AREA.id,
  name: AREA.name,
  west: AREA.region.west,
  south: AREA.region.south,
  east: AREA.region.east,
  north: AREA.region.north,
}
export const REGION_BBOX = REGION

/** True when a point is in the region (with a small margin). A GPS fix
 *  outside it is the phone at home, not the hunter in the bush: nothing
 *  that means "here" in the app should follow it there. */
export function inRegion(lon: number, lat: number, marginDeg = 0.03): boolean {
  return lon >= REGION.west - marginDeg && lon <= REGION.east + marginDeg && lat >= REGION.south - marginDeg && lat <= REGION.north + marginDeg
}

/** How far from the subject (camp, pin or fix) the Spots search looks:
 *  the immediate area, not the whole grid. */
export const SPOTS_RADIUS_M = 3000

/** The core: the few km around the camp where every layer is baked to full
 *  detail (z16), about 4 km at Pickle Lake. Offline is the product here
 *  (Gavan, 2026-09-25: internet at camp only morning and night). */
export const CORE = {
  west: AREA.core.west,
  south: AREA.core.south,
  east: AREA.core.east,
  north: AREA.core.north,
  maxzoom: AREA.core.maxzoom,
}
/** The core's reach from its middle, in whole km: 4 at Pickle Lake, 5 at
 *  Lac Bailey. How far a route's ends may be, in words. */
export const CORE_KM = Math.round(
  Math.min((CORE.east - CORE.west) * 111.32 * Math.cos((((CORE.north + CORE.south) / 2) * Math.PI) / 180), (CORE.north - CORE.south) * 111.32) / 2,
)

/** The wider region is baked to this zoom only. */
export const REGION_MAXZOOM = AREA.regionMaxzoom

/** Where the baked data lives (same-origin by default); fileUrl (areas)
 *  adds the area's folder. */
export { DATA_BASE } from './areas'

export interface DataFileDef {
  key: string
  file: string
  kind: 'vector' | 'raster'
  label: string
}

/** Every PMTiles layer the app can draw: the style's key, the file's stem
 *  (<stem>-<area>.pmtiles) and what it is. An area bakes some of them, its
 *  files.pmtiles. */
const PMTILES: (Omit<DataFileDef, 'file'> & { stem: string })[] = [
  { key: 'basemap', stem: 'basemap', kind: 'vector', label: 'Base map' },
  { key: 'topo', stem: 'topo', kind: 'raster', label: 'Topographic map' },
  { key: 'satellite', stem: 'satellite', kind: 'raster', label: 'Imagery' },
  { key: 'hillshade', stem: 'hillshade', kind: 'raster', label: 'Hillshade (30 m)' },
  { key: 'hillshadeLidar', stem: 'hillshade-lidar', kind: 'raster', label: 'LiDAR hillshade (1 m)' },
  { key: 'dem', stem: 'dem', kind: 'raster', label: 'Elevation (1 m LiDAR, 30 m around)' },
  { key: 'contours', stem: 'contours', kind: 'vector', label: 'LiDAR contours (1 m)' },
  { key: 'contoursWide', stem: 'contours-wide', kind: 'vector', label: 'Contours (10 m, whole region)' },
  { key: 'forest', stem: 'forest', kind: 'vector', label: 'Forest cover' },
  { key: 'understory', stem: 'understory', kind: 'raster', label: 'Bush thickness (LiDAR)' },
  { key: 'lanes', stem: 'lanes', kind: 'raster', label: 'Shooting lanes (LiDAR)' },
  { key: 'bathy', stem: 'bathy', kind: 'vector', label: 'Lake depths' },
  { key: 'historical', stem: 'historical', kind: 'raster', label: 'Historical topo' },
  { key: 'bathySheets', stem: 'bathysheets', kind: 'raster', label: 'Lake survey sheets (1978–79)' },
  { key: 'places', stem: 'places', kind: 'vector', label: 'Camps, WMUs, roads' },
]

/** The places archive's themes, in the order its label names them, and the
 *  word for each (the zones' is the area's). */
const PLACES_WORDS: [string, (a: AreaDef) => string][] = [
  ['camps', () => 'camps'],
  ['wmu', (a) => (a.zone.label === a.zone.label.toUpperCase() ? `${a.zone.label}s` : `${a.zone.label.toLowerCase()}s`)],
  ['crown', () => 'private land'],
  ['parks', () => 'parks'],
  ['fire', () => 'burns'],
  ['roads', () => 'roads'],
]

/** A PMTiles layer's label in an area. Two are Pickle Lake's own: the
 *  survey sheets' years are its three lakes', and the places archive
 *  holds only the themes an area has (Parks, burns, roads at Lac Bailey,
 *  which has no camps or private land from LIO). */
function labelIn(d: (typeof PMTILES)[number], a: AreaDef): string {
  if (a.id === DEFAULT_AREA) return d.label
  if (d.key === 'bathySheets') return 'Lake survey sheets'
  if (d.key === 'places') {
    const words = PLACES_WORDS.filter(([t]) => a.files.geo.includes(t)).map(([, w]) => w(a))
    return words.length ? words.join(', ').replace(/^\w/, (c) => c.toUpperCase()) : 'Land layers'
  }
  return d.label
}

/** An area's PMTiles files, each with its style key and label (DATA_FILES
 *  is the active area's; the Offline sheet labels every area's). */
export function dataFiles(a: AreaDef): DataFileDef[] {
  return PMTILES.filter((d) => a.files.pmtiles.includes(d.key)).map((d) => ({ key: d.key, file: `${d.stem}-${a.id}.pmtiles`, kind: d.kind, label: labelIn(d, a) }))
}

/** The GeoJSON themes and band grids in words, for the Offline sheet's What's
 *  in it: a few share a PMTiles layer's key (forest, bathy) but are other
 *  files, and the layer names match the Layers sheet's (crown is private land). */
const OTHER_LABELS: Record<string, string> = {
  'geo:camps': 'Crown land camps',
  'geo:crown': 'Private land',
  'geo:parks': 'Parks',
  'geo:bathy': 'Lake bathymetry',
  'geo:fire': 'Burns',
  'geo:roads': 'Bush roads',
  'geo:forest': 'Forest stands (GeoJSON)',
  'geo:depth': 'Lake depth bands',
  'baseGeo:waterbody': 'Lake outlines',
  'grids:habitat': 'Habitat grid',
  'grids:micro': 'Ground wind grid',
  'grids:going': 'Walking grid',
}

/** A layer's name in an area, by its kind in the coverage report: a PMTiles
 *  layer's label, else the theme's or grid's (WMU, Zone: the area's word for
 *  its zones), else the key itself, capitalised. */
export function layerLabel(kind: string, key: string, a: AreaDef): string {
  const d = kind === 'pmtiles' ? PMTILES.find((x) => x.key === key) : undefined
  if (d) return labelIn(d, a)
  if (key === 'wmu') return a.zone.label
  return OTHER_LABELS[`${kind}:${key}`] ?? key.replace(/[_-]/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
}

/** Baked PMTiles the pipeline produces. Missing files fall back to the live
 *  services in sources.ts so the app works before any pipeline run. */
export const DATA_FILES: DataFileDef[] = dataFiles(AREA)

/** Vector themes the pipeline writes as GeoJSON (build_vectors.py). When a
 *  file is on the phone or the server it replaces the live LIO query. */
const ALL_GEO_THEMES = ['wmu', 'camps', 'crown', 'parks', 'bathy', 'fire', 'roads', 'forest', 'depth'] as const
export type GeoTheme = (typeof ALL_GEO_THEMES)[number]
const geoThemes = (a: AreaDef): GeoTheme[] => ALL_GEO_THEMES.filter((t) => a.files.geo.includes(t))
export const GEO_THEMES: readonly GeoTheme[] = geoThemes(AREA)
export const geoFile = (t: GeoTheme) => `${t}-${REGION.id}.geojson`

/** The habitat grid the Spots tab scores (build_habitat.py): one gzipped
 *  file of 30 m bands, kept with the bundle so the scoring works offline. */
export const habitatFile = () => `habitat-${REGION.id}.hab`

/** The microclimate grid (build_microclimate.py) on the same lattice: what
 *  terrain, lakes and trees do to the wind, for the ground-wind model. */
export const microFile = () => `micro-${REGION.id}.hab`

/** The going grid (build_going.py): 10 m bands over the core of what the
 *  ground is like to walk on (grade, bush, roughness, wet, roads, creeks),
 *  for the route finder. */
export const goingFile = () => `going-${REGION.id}.hab`

/** The band grids, in the bundle's order. */
const GRIDS = ['habitat', 'micro', 'going'] as const

/** Baked GeoJSON with no live fallback, drawn under the data layers: the
 *  lake outlines that sit over the elevation colours so water reads as water. */
const ALL_BASE_GEO = ['waterbody'] as const
export type BaseGeo = (typeof ALL_BASE_GEO)[number]
const baseGeo = (a: AreaDef): BaseGeo[] => ALL_BASE_GEO.filter((t) => a.files.baseGeo.includes(t))
export const BASE_GEO: readonly BaseGeo[] = baseGeo(AREA)
export const baseGeoFile = (t: BaseGeo) => `${t}-${REGION.id}.geojson`

export interface BundleDef {
  id: string
  name: string
  description: string
  files: string[]
}

/** An area's offline bundle: every file of it the app reads, by name. */
function bundleOf(a: AreaDef): BundleDef {
  return {
    id: a.id,
    name: a.name,
    description: a.bundle.description,
    files: [
      ...dataFiles(a).map((d) => d.file),
      ...geoThemes(a).map((t) => `${t}-${a.id}.geojson`),
      ...baseGeo(a).map((t) => `${t}-${a.id}.geojson`),
      ...GRIDS.filter((g) => a.files.grids.includes(g)).map((g) => `${g}-${a.id}.hab`),
    ],
  }
}

/** One bundle per area, the active area's first. */
export const BUNDLES: BundleDef[] = AREA_LIST.map(bundleOf)

export const MAX_BOUNDS: [[number, number], [number, number]] = [
  [REGION.west, REGION.south],
  [REGION.east, REGION.north],
]

export function nearestInBounds(lon: number, lat: number): { center: [number, number]; clamped: boolean } {
  const [[w, s], [e, n]] = MAX_BOUNDS
  const center: [number, number] = [Math.min(Math.max(lon, w), e), Math.min(Math.max(lat, s), n)]
  return { center, clamped: center[0] !== lon || center[1] !== lat }
}

export interface PlaceDef {
  name: string
  lon: number
  lat: number
  kind: 'camp' | 'lake' | 'landing' | 'stand' | 'trail'
  note?: string
  /** its dot on the map, picked in its popup or the Pins editor; the kind's colour until then (state/pinColours.ts) */
  color?: string
  /** the winds this stand hunts well on: compass sectors the wind blows
   *  FROM, 0 = N, 1 = NE … 7 = NW (spots/standWinds.ts) */
  winds?: number[]
}

/** The area's preset places. The first is the camp: at Pickle Lake on the
 *  peninsula on the west shore (Gavan, 2026-09-25), not the map-link pin
 *  ~600 m north-east of it; its lake pins are OSM lake centres
 *  (2026-09-25), not guesses. Presets are refreshed from the area files on
 *  load (see placesStore). */
export const PLACES: PlaceDef[] = AREA.presets.map((p) => ({ ...p }))

/** The area's home (its first preset) as a chip names it: Camp at Pickle
 *  Lake, Shared spot at Lac Bailey. The area file's name, not the pin's:
 *  presets go back to the file on every load anyway. */
export const HOME_NAME = AREA.presets[0].name

/** The home in a sentence: 'camp' as one says it, a common name with 'the'
 *  (the shared spot), a proper name as it is. */
export const HOME_WORDS = AREA.presets[0].kind === 'camp' ? 'camp' : /^[A-Z][a-z]*( [a-z]+)*$/.test(HOME_NAME) ? `the ${HOME_NAME.toLowerCase()}` : HOME_NAME

/** Magnetic declination at the area, degrees, west negative (WMM2025): about
 *  −6 at Pickle Lake, −16.1 at Lac Bailey. A degree off is nothing against a
 *  45° wind sector; ten is a sector's worth. */
export const DECLINATION = AREA.declination

/** The time zone forecasts are asked for in: Open-Meteo answers in local
 *  time, which is read as the phone's. */
export const TIMEZONE = AREA.timezone

/** The hunting zone: its word and its name (WMU 21B, Zone 18). */
export const ZONE = AREA.zone

/** The core's low and high ground, m: the relief colours span it. */
export const RELIEF = AREA.relief

/** On steep ground, the zoom the LiDAR contours closer than 5 m wait for
 *  (the area file's contours.fineFrom); null, as at Pickle Lake, for every
 *  line at every zoom. */
export const CONTOUR_FINE_FROM: number | null = AREA.contours?.fineFrom ?? null

/** The province ('ON', 'QC'). */
export const JURISDICTION = AREA.jurisdiction

/** Which live services may stand in for a layer that is not baked: LIO's
 *  queries only in Ontario, and the province's own imagery (sources.ts). */
export const LIVE = AREA.live

/** Credits for the area's baked layers: the vector themes, the lakes, and
 *  the point-cloud bush layers. */
export const ATTRIBUTION = AREA.attribution

/** Lakes with a georeferenced survey sheet (map/depthLayer.ts), lower case. */
export const SURVEYED_LAKES = AREA.surveyedLakes

/** The Groundwind number that answers a satellite weather request
 *  (weather/satForecast.ts, site/satbot.js), E.164: Twilio, bought
 *  2026-10-05. An inReach texts it and an iPhone on satellite texts it the
 *  same. Empty, the sheet shows the request and the paste but no Text button. */
export const SAT_NUMBER = '+18679884457'
