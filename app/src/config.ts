// Central place for region + data-file configuration.
// A new hunting area = a new REGION entry here plus a pipeline run.

/**
 * Where the map opens with nothing better (no fix, no saved view): the camp
 * on the peninsula on Pickle Lake, near the map link Gavan shared: Pickle / McGill / Ketchup Lakes, north-west
 * of White River, south of Manitouwadge (Thunder Bay District, Ontario).
 */
export const HOME = {
  center: [-85.59872, 48.9262] as [number, number],
  zoom: 13,
}

/** The region the map may show at all: about 12 km around the camp on
 *  Pickle Lake, taking in McGill, Ketchup and Line Lakes and Pickle Creek.
 *  Gavan, 2026-09-25: only the immediate area around Pickle Lake matters.
 *  Baked to REGION_MAXZOOM; the CORE inside it to full detail. */
export const REGION = {
  id: 'pickle-lake',
  name: 'Pickle Lake',
  west: -85.72,
  south: 48.86,
  east: -85.46,
  north: 49.0,
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

/** The core: about 4 km around the camp on Pickle Lake, where every layer
 *  is baked to full detail (z16). Offline is the product here (Gavan,
 *  2026-09-25: internet at camp only morning and night). */
export const CORE = {
  west: -85.65,
  south: 48.895,
  east: -85.535,
  north: 48.967,
  maxzoom: 16,
}
/** The wider region is baked to this zoom only. */
export const REGION_MAXZOOM = 13

/** Where the baked data lives (same-origin by default). */
export const DATA_BASE: string = import.meta.env.VITE_DATA_BASE ?? `${import.meta.env.BASE_URL}data/`

export interface DataFileDef {
  key: string
  file: string
  kind: 'vector' | 'raster'
  label: string
}

/** Baked PMTiles the pipeline produces. Missing files fall back to the live
 *  services in sources.ts so the app works before any pipeline run. */
export const DATA_FILES: DataFileDef[] = [
  { key: 'basemap', file: `basemap-${REGION.id}.pmtiles`, kind: 'vector', label: 'Base map' },
  { key: 'topo', file: `topo-${REGION.id}.pmtiles`, kind: 'raster', label: 'Topographic map' },
  { key: 'satellite', file: `satellite-${REGION.id}.pmtiles`, kind: 'raster', label: 'Imagery' },
  { key: 'hillshade', file: `hillshade-${REGION.id}.pmtiles`, kind: 'raster', label: 'Hillshade (30 m)' },
  { key: 'hillshadeLidar', file: `hillshade-lidar-${REGION.id}.pmtiles`, kind: 'raster', label: 'LiDAR hillshade (1 m)' },
  { key: 'dem', file: `dem-${REGION.id}.pmtiles`, kind: 'raster', label: 'Elevation (1 m LiDAR, 30 m around)' },
  { key: 'contours', file: `contours-${REGION.id}.pmtiles`, kind: 'vector', label: 'LiDAR contours (1 m)' },
  { key: 'contoursWide', file: `contours-wide-${REGION.id}.pmtiles`, kind: 'vector', label: 'Contours (10 m, whole region)' },
  { key: 'forest', file: `forest-${REGION.id}.pmtiles`, kind: 'vector', label: 'Forest cover' },
  { key: 'understory', file: `understory-${REGION.id}.pmtiles`, kind: 'raster', label: 'Bush thickness (LiDAR)' },
  { key: 'lanes', file: `lanes-${REGION.id}.pmtiles`, kind: 'raster', label: 'Shooting lanes (LiDAR)' },
  { key: 'bathy', file: `bathy-${REGION.id}.pmtiles`, kind: 'vector', label: 'Lake depths' },
  { key: 'historical', file: `historical-${REGION.id}.pmtiles`, kind: 'raster', label: 'Historical topo' },
  { key: 'bathySheets', file: `bathysheets-${REGION.id}.pmtiles`, kind: 'raster', label: 'Lake survey sheets (1978–79)' },
  { key: 'places', file: `places-${REGION.id}.pmtiles`, kind: 'vector', label: 'Camps, WMUs, roads' },
]

/** Vector themes the pipeline writes as GeoJSON (build_vectors.py). When a
 *  file is on the phone or the server it replaces the live LIO query. */
export const GEO_THEMES = ['wmu', 'camps', 'crown', 'parks', 'bathy', 'fire', 'roads', 'forest', 'depth'] as const
export type GeoTheme = (typeof GEO_THEMES)[number]
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

/** Baked GeoJSON with no live fallback, drawn under the data layers: the
 *  lake outlines that sit over the elevation colours so water reads as water. */
export const BASE_GEO = ['waterbody'] as const
export type BaseGeo = (typeof BASE_GEO)[number]
export const baseGeoFile = (t: BaseGeo) => `${t}-${REGION.id}.geojson`

export interface BundleDef {
  id: string
  name: string
  description: string
  files: string[]
}

export const BUNDLES: BundleDef[] = [
  {
    id: REGION.id,
    name: REGION.name,
    description:
      'Topo, imagery, hillshade, forest stands, lake depths, historical topo, camps, WMU lines and the ' +
      'habitat grid the Spots tab scores and the going grid routes are found on, for Pickle, McGill, Ketchup and Line Lakes; full detail within 2 km of the camp.',
    files: [...DATA_FILES.map((d) => d.file), ...GEO_THEMES.map(geoFile), ...BASE_GEO.map(baseGeoFile), habitatFile(), microFile(), goingFile()],
  },
]

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

/** Preset places. The first is the camp: on the peninsula on the west shore
 *  of Pickle Lake (Gavan, 2026-09-25), not the map-link pin ~600 m north-east
 *  of it. Presets are refreshed from here on load (see placesStore). */
export const PLACES: PlaceDef[] = [
  { name: 'Camp', lon: -85.59872, lat: 48.9262, kind: 'camp', note: 'On the peninsula' },
  // Lake pins are OSM lake centres (2026-09-25), not guesses.
  { name: 'Pickle Lake', lon: -85.5777, lat: 48.9412, kind: 'lake' },
  { name: 'McGill Lake', lon: -85.5027, lat: 48.919, kind: 'lake' },
  { name: 'Upper McGill Lake', lon: -85.4854, lat: 48.9393, kind: 'lake' },
  { name: 'Ketchup Lake', lon: -85.5922, lat: 48.8944, kind: 'lake' },
  { name: 'Line Lake', lon: -85.5074, lat: 48.9733, kind: 'lake' },
  { name: 'White Lake', lon: -85.6348, lat: 48.7507, kind: 'lake', note: 'Tern Islands mid-lake' },
]
