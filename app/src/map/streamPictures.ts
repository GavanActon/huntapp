import maplibregl, { type SourceSpecification } from 'maplibre-gl'

/** The contour library's default export: the DEM source that cuts lines and shade from terrain tiles. */
type MlContour = typeof import('maplibre-contour').default
import { LIVE_RASTER, SHARP_IMAGERY, type LiveRaster } from '../sources'
import type { ContourInterval } from '../state/appStore'

/**
 * Trial (docs/SD-FAST.md): the map's pictures streamed instead of baked, to
 * see how an SD area would look with nothing but its grids baked. Off unless
 * asked for: `?pictures=stream` turns it on and keeps it on this phone
 * across reloads and area switches, `?pictures=baked` turns it off.
 *
 * On, the picture archives are left out of the style (MapView drops their
 * keys from the available set), so topo, imagery and the hillshade fall back
 * to their live services as they do in any area without them, and the
 * elevation colours, the DEM-drawn shade and the contours are drawn from
 * Mapterhorn's terrain tiles: 30 m (Copernicus) everywhere to z12, the
 * national LiDAR where it has it (HRDEM: z15 at Pickle, Lac Bailey,
 * Whitefish and Searchmont; z13 at Blanchard River, probed 2026-10-13).
 */
const KEY = 'huntapp-pictures'

function picked(): boolean {
  try {
    const u = new URL(location.href)
    const q = u.searchParams.get('pictures')
    if (q === 'stream') localStorage.setItem(KEY, 'stream')
    else if (q === 'baked') localStorage.removeItem(KEY)
    const on = localStorage.getItem(KEY) === 'stream'
    // said in the address too: an area switch loads a fresh address, and with
    // the word gone from it the setting looked lost when it was not (2026-10-13)
    if (on && q !== 'stream') {
      u.searchParams.set('pictures', 'stream')
      history.replaceState(history.state, '', u)
    }
    return on
  } catch {
    return false
  }
}

export const STREAM_PICTURES = picked()

/** The imagery where no province publishes any (BC, the Yukon): Esri's,
 *  the photo the area's sharp layer already streams over its box, here
 *  past the box too, as Ontario's and Québec's services are. Without it the
 *  topo sheet showed round the photo (Gavan, 2026-10-13, Blanchard River).
 *  Esri's terms would want an ArcGIS key before this ships. */
export function streamedImagery(): LiveRaster | undefined {
  if (!STREAM_PICTURES || LIVE_RASTER.satellite || !SHARP_IMAGERY?.remote) return undefined
  return { ...SHARP_IMAGERY, tiles: [SHARP_IMAGERY.remote] }
}

/** The archives a streamed SD area would not have: the base map, every
 *  relief and contour bake, the topo sheet, the imagery and the old sheets. */
export const STREAMED_KEYS = ['basemap', 'dem', 'hillshade', 'hillshadeLidar', 'topo', 'satellite', 'historical', 'contours', 'contoursWide']

const TILES = 'https://tiles.mapterhorn.com/{z}/{x}/{y}.webp'
const LINES_MAXZOOM = 15
const ATTRIBUTION = '<a href="https://mapterhorn.com/attribution">© Mapterhorn</a> · Copernicus DEM © DLR, Airbus · HRDEM © Natural Resources Canada'

/** Mapterhorn's deepest zoom where the area is: 15 over the national LiDAR,
 *  13 or 14 over some, 12 (Copernicus) everywhere. A tile past it is
 *  missing, not stretched, and the contours cut from a missing tile came
 *  out nearly empty (Blanchard River at z15, 2026-10-13), so the map and
 *  the contours are told where to stop and stretch the deepest themselves.
 *  Asked once, before the map is made (MapView), by three HEADs. */
let depth = 12
export async function probeTerrainDepth(lon: number, lat: number): Promise<number> {
  const url = (z: number) => {
    const n = 2 ** z
    const r = (lat * Math.PI) / 180
    const x = Math.floor(((lon + 180) / 360) * n)
    const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n)
    return TILES.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y))
  }
  const found = await Promise.all(
    [15, 14, 13].map(async (z) => {
      try {
        return (await fetch(url(z), { method: 'HEAD' })).ok ? z : 0
      } catch {
        return 0
      }
    }),
  )
  depth = Math.max(12, ...found)
  return depth
}

/** maplibre-contour (29 KB and a worker of its own), loaded only when the pictures
 *  stream: MapView awaits this before the style is built, and every use of the
 *  library below sits behind STREAM_PICTURES. Off the start bundle otherwise. */
let lib: MlContour | null = null
export async function loadStreamLib(): Promise<void> {
  if (!lib) lib = (await import('maplibre-contour')).default
}

// one source of tiles for the shade and the contours both, fetched once
// and decoded in a worker
let dem: InstanceType<MlContour['DemSource']> | null = null
function demSource() {
  if (!dem) {
    if (!lib) throw new Error('the contour library is not loaded: loadStreamLib first')
    dem = new lib.DemSource({ url: TILES, encoding: 'terrarium', maxzoom: depth, worker: true, cacheSize: 120 })
    dem.setupMaplibre(maplibregl)
  }
  return dem
}

/** How deep the heights go here (probeTerrainDepth), and one tile of them
 *  decoded, from the same cache the map draws from (map/viewLook.ts). */
export const terrainDepth = () => depth
export const demTileAt = (z: number, x: number, y: number) => demSource().getDemTile(z, x, y)

/** The view's own look (map/viewLook.ts): how much of the shade's lit side
 *  goes over the photo. 1 is the strength tuned on Ontario's bush; less over
 *  open alpine, where it whitened whole slopes (Gavan, 2026-10-13: "hunt on
 *  streamed seems washed out there ... looks like the mountains"). */
let lit = 1
export const viewLit = () => lit
export function setViewLit(v: number) {
  lit = v
}

export function streamedDem(): SourceSpecification {
  return { type: 'raster-dem', tiles: [demSource().sharedDemProtocolUrl], encoding: 'terrarium', tileSize: 512, maxzoom: depth, attribution: ATTRIBUTION }
}

/** Contours cut on the phone from the same tiles, as the region's baked
 *  ones are thinned: 50 m lines to z9, 20 m to z11, 10 m from z12, then the
 *  Settings interval from z14 as the LiDAR lines are. `level` 1 is an index
 *  line (every 50 m, then every fifth), `elev` its height. */
export function streamedContours(interval: ContourInterval): SourceSpecification {
  return { type: 'vector', tiles: [streamedContourTiles(interval)], minzoom: 8, maxzoom: LINES_MAXZOOM, attribution: ATTRIBUTION }
}

/** The streamed lines' tile address for an interval: a new one when Settings
 *  changes it, which MapView gives the source (setTiles), so the lines are
 *  cut again at the new spacing (Gavan, 2026-10-17: the interval "stuck at
 *  whitefish", since the source kept the one it was built with). */
export function streamedContourTiles(interval: ContourInterval): string {
  return demSource().contourProtocolUrl({
    thresholds: { 8: [50, 50], 10: [20, 100], 12: [10, 50], 14: [interval, interval * 5] },
    elevationKey: 'elev',
    levelKey: 'level',
    contourLayer: 'contours',
    overzoom: 1,
  })
}

/** Lines cut straight from the LiDAR's heights wander with every hummock,
 *  and at the baked lines' 30° a label found no stretch straight enough to
 *  sit on: none showed past z14. Laxer for the streamed lines. */
export const STREAMED_LABEL_MAX_ANGLE = 75
