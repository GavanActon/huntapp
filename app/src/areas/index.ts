import { badAreaField } from './check'
import { arriveNow, linkDone } from './handoff'
import { decideStart } from './start'

/**
 * The areas the app knows in full detail, and which one it is in. Each
 * area is one JSON file beside this one (docs/AREAS.md): the description
 * the pipeline bakes from and the app reads. Pickle Lake's carries what
 * config.ts used to hold as literals, value for value.
 *
 * One area is active at a time, settled here once, synchronously, before
 * anything reads config.ts (areas/start.ts decides): a link's area (the one
 * its spot is in, else the one it names), else the id saved on the phone,
 * else an iPhone install's seed, else Pickle Lake. The address names the
 * area the app is in (?area=<id>, Pickle Lake's bare), so a reload stays
 * there. Switching saves the new id and the view to open on, then loads the
 * new area's address, so every module, cache and map source starts clean
 * there; nothing here changes while the app runs.
 */

export type PlaceKind = 'camp' | 'lake' | 'landing' | 'stand' | 'trail'

export interface AreaBox {
  west: number
  south: number
  east: number
  north: number
}

/** A fixed pin of the area; the first is home (the camp). */
export interface AreaPreset {
  name: string
  lon: number
  lat: number
  kind: PlaceKind
  note?: string
}

/** One layer in the bake's coverage report: the file baked for it and
 *  where that came from, or, with no file, why the area has none. */
export interface CoverageLayer {
  file?: string
  bytes?: number
  source?: string
  licence?: string
  /** when the data was made or flown, in the source's words */
  vintage?: string
  note?: string
  missing?: string
}

/** An area's own days for the hardwoods' leaves, 'MM-DD', all four, in the
 *  year's order (weather/micro/leaves.ts, which has the boreal defaults). */
export interface AreaLeaves {
  /** the leaves start to come out */
  springStart: string
  /** in full leaf from this day */
  springFull: string
  /** the leaves start to fall: in full leaf until this day */
  fallStart: string
  /** bare from this day */
  fallBare: string
}

/** The bake's coverage report (pipeline/bake_area.py), written into the
 *  area file: every layer the app knows, by kind, as baked or missing. */
export interface AreaCoverage {
  /** the day the report was written */
  checked: string
  pmtiles: Record<string, CoverageLayer>
  geo: Record<string, CoverageLayer>
  baseGeo: Record<string, CoverageLayer>
  grids: Record<string, CoverageLayer>
}

export interface AreaDef {
  id: string
  name: string
  /** the province: which adapters bake it, and which live services stand in */
  jurisdiction: string
  /** lon, lat */
  centre: [number, number]
  /** where the map opens with no saved view */
  home: { center: [number, number]; zoom: number }
  /** the box the map may show at all, baked to regionMaxzoom */
  region: AreaBox
  /** full detail to maxzoom, and the habitat, wind and going grids */
  core: AreaBox & { maxzoom: number }
  regionMaxzoom: number
  /** magnetic declination at the centre, degrees, west negative (WMM2025) */
  declination: number
  /** the time zone forecasts are asked for in */
  timezone: string
  /** the hunting zone's word and name: WMU 21B, Zone 18 */
  zone: { label: string; name: string }
  /** the core's low and high ground, m, which the relief colours span */
  relief: [number, number]
  /** steep ground: the LiDAR contours closer than 5 m wait for this zoom,
   *  as further out they run together (map/mapStyle.ts contourFilters).
   *  Left out, every line shows at every zoom, as at Pickle Lake */
  contours?: { fineFrom?: number }
  /** when the hardwoods' leaves come out and fall, for the ground wind.
   *  Left out, the boreal defaults at about 49° N, as both areas have it */
  leaves?: AreaLeaves
  /** the area's folder under the data base: '' for Pickle Lake (flat, as before areas), 'areas/<id>/' for the rest */
  base: string
  /** lakes drawn from their survey sheets, lower case (map/depthLayer.ts) */
  surveyedLakes: string[]
  /** which live services may stand in for a layer that is not baked */
  live: { lio: boolean; satellite: 'lio' | 'qc' | null }
  attribution: { vectors: string; lakes: string; bush: string }
  presets: AreaPreset[]
  bundle: { description: string }
  /** what is baked for it: PMTiles keys, GeoJSON themes, base GeoJSON and band grids */
  files: { pmtiles: string[]; geo: string[]; baseGeo: string[]; grids: string[] }
  /** the pipeline's recipe (sources, adapters); the app does not read it */
  bake?: Record<string, unknown>
  /** what the last bake made, layer by layer (the Offline sheet's What's in it) */
  coverage?: AreaCoverage
  /** Explore (explore/index.ts): a stand-in area the map is unfenced in, nothing baked, listed nowhere */
  virtual?: boolean
}

/** Pickle Lake: the area the app opens on with nothing saved, and the
 *  owner of everything saved before there were areas (the bare storage
 *  keys, the preset ids preset-0 …). */
export const DEFAULT_AREA = 'pickle-lake'
/** The area Explore runs as (areas/explore.json): the whole country, nothing baked. */
export const EXPLORE_ID = 'explore'
/** the area Explore was entered from, kept while in it (explore/index.ts) */
export const EXPLORE_FROM_KEY = 'huntapp-explore-from'
/** The area Explore was entered from, else the default: Explore's home and its way back. */
export function exploreFromId(): string {
  try {
    const id = localStorage.getItem(EXPLORE_FROM_KEY)
    if (id && id !== EXPLORE_ID && Object.hasOwn(AREAS, id)) return id
  } catch {
    /* the default */
  }
  return DEFAULT_AREA
}

/** The phone's choice of area. */
const AREA_KEY = 'huntapp-area'

/** Where the baked data lives (same-origin by default). */
export const DATA_BASE: string = import.meta.env.VITE_DATA_BASE ?? `${import.meta.env.BASE_URL}data/`

/** Every area file whose fields the app reads are all there and of the
 *  right kind (areas/check.ts). One that is not (a bad bake) is left out:
 *  as the saved area it would stop the app on every start, with no way back
 *  to another. The build refuses one anyway (vite.config.ts). */
const defs = (Object.values(import.meta.glob('./*.json', { eager: true, import: 'default' })) as AreaDef[]).filter((a) => {
  const bad = badAreaField(a)
  if (bad == null) return true
  console.warn(`area file ${String(a?.id)} left out: ${bad} is missing or not what the app reads`)
  return false
})
  // the real areas first: a link's spot is looked for in them before Explore's country-wide box
  .sort((a, b) => Number(!!a.virtual) - Number(!!b.virtual))

/** Every area the app knows, by id. */
export const AREAS: Readonly<Record<string, AreaDef>> = Object.fromEntries(defs.map((a) => [a.id, a]))

export function areaById(id: string | null | undefined): AreaDef | null {
  return id != null && Object.hasOwn(AREAS, id) ? AREAS[id] : null
}

/** The map's last camera in an area, saved on every move: the view the app
 *  opens on there. A switch saves the target's before it loads it, and a
 *  link's spot is saved as its area's before the map reads it. */
export interface SavedView {
  center: [number, number]
  zoom: number
  bearing: number
  /** VIEW_V when saved by this build or later; missing on a view saved
   *  while an out-of-area fix could still drag the map into a corner */
  v?: number
}

// above ACTIVE_AREA: resolveActive saves a link's view while this module is still loading
const VIEW_KEY = 'huntapp.lastView'
/** Views saved since following stopped chasing a fix outside the area (config.ts followCenter). */
const VIEW_V = 2

function resolveActive(): AreaDef {
  let href = ''
  let saved: string | null = null
  let navType: string | undefined
  try {
    href = window.location.href
    saved = localStorage.getItem(AREA_KEY)
  } catch {
    /* private mode: the address alone */
  }
  try {
    navType = (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.type
  } catch {
    /* no timing: the tab's mark alone says a link was shown before */
  }
  const done = linkDone()
  const start = decideStart({ href, saved, areas: defs, defaultId: DEFAULT_AREA, done: done ?? null, sessionOk: done !== undefined, navType })
  // an id no longer known (an area dropped from the build) falls to Pickle
  // Lake, and with Pickle Lake's own file left out, to any area there is:
  // a start on the wrong area beats one that stops before the map
  const a = areaById(start.areaId) ?? areaById(DEFAULT_AREA) ?? defs[0]
  if (!a) throw new Error('no usable area file in src/areas')
  if (start.save) {
    try {
      localStorage.setItem(AREA_KEY, a.id)
    } catch {
      /* private mode: the address carries it */
    }
  }
  if (start.href) {
    try {
      window.history.replaceState(window.history.state, '', start.href)
    } catch {
      /* the address stays as it came */
    }
  }
  // the address took the app to another area than the phone opens on by
  // itself (a link, a tab left on one): location stays on, but follow is
  // held for this run, as a switch holds it, so the first fix does not drag
  // the map to the box's edge (and the view saved there with it)
  const own = areaById(saved) ?? areaById(DEFAULT_AREA) ?? defs[0]
  const moved = a.id !== own.id
  const s = start.arrival
  if (s) {
    // a spot in the area: the map opens on it, north up, and the first fix
    // does not take it away. One in no area waits in Go to coordinates. The
    // link is noted as shown once it is (areas/arrive.ts)
    if (s.inArea) saveView({ center: [s.lon, s.lat], zoom: s.z, bearing: 0 }, a.id)
    arriveNow({ kind: 'spot', lon: s.lon, lat: s.lat, name: s.name, link: start.mark ?? undefined }, s.inArea || moved)
  } else if (moved) arriveNow({ kind: 'look' }, true)
  return a
}

/** The area the app is in, for the whole of this run. */
export const ACTIVE_AREA: AreaDef = resolveActive()

/** Every area, the active one first. */
export const AREA_LIST: readonly AreaDef[] = [ACTIVE_AREA, ...defs.filter((a) => a.id !== ACTIVE_AREA.id)]

/** The area whose region holds the point (with an optional margin), the
 *  active one first; null when it is in none. */
export function areaAt(lon: number, lat: number, marginDeg = 0): AreaDef | null {
  for (const a of AREA_LIST) {
    // Explore's box is the country: it holds a point only while the app is in it
    if (a.virtual && a.id !== ACTIVE_AREA.id) continue
    const r = a.region
    if (lon >= r.west - marginDeg && lon <= r.east + marginDeg && lat >= r.south - marginDeg && lat <= r.north + marginDeg) return a
  }
  return null
}

/** The area holding the point when it is not the active one: going there
 *  means switching. */
export function otherAreaAt(lon: number, lat: number, marginDeg = 0): AreaDef | null {
  const a = areaAt(lon, lat, marginDeg)
  return a && a.id !== ACTIVE_AREA.id ? a : null
}

/** A baked file's address on the server: the data base, the area's folder,
 *  the file. Pickle Lake's folder is the data base itself, so its URLs are
 *  the ones they always were. */
export function fileUrl(name: string, areaId: string = ACTIVE_AREA.id): string {
  return `${DATA_BASE}${areaById(areaId)?.base ?? ''}${name}`
}

/** Save the area to open on next time. No load here: the caller saves the
 *  view to open on (saveView) and loads areaHref. False for an unknown id,
 *  or with nowhere to save it (the address carries it then). */
export function setActiveArea(id: string): boolean {
  if (!areaById(id)) return false
  try {
    localStorage.setItem(AREA_KEY, id)
    return true
  } catch {
    return false
  }
}

/** The app's address in an area: ?area=<id>, Pickle Lake's bare. A switch
 *  loads it, so the address always names the area the app is in: a reload
 *  (a download's, an update's) stays there, and the browser's Share, Copy
 *  and Add to Home Screen carry it. */
export function areaHref(id: string): string {
  const u = new URL(window.location.href)
  u.hash = ''
  u.search = id === DEFAULT_AREA ? '' : new URLSearchParams({ area: id }).toString()
  return u.toString()
}

/** A saved key that only means something in one area: the bare key with
 *  the area's id on it. */
export function areaKey(base: string, areaId: string = ACTIVE_AREA.id): string {
  return `${base}:${areaId}`
}

/** An area's saved value. Pickle Lake's was saved under the bare key before
 *  there were areas, and is read from there until its own is written, so a
 *  phone opens exactly as it did. */
export function readAreaItem(base: string, areaId: string = ACTIVE_AREA.id): string | null {
  try {
    const own = localStorage.getItem(areaKey(base, areaId))
    if (own != null || areaId !== DEFAULT_AREA) return own
    return localStorage.getItem(base)
  } catch {
    return null
  }
}

export function writeAreaItem(base: string, value: string, areaId: string = ACTIVE_AREA.id): void {
  try {
    localStorage.setItem(areaKey(base, areaId), value)
  } catch {
    /* private mode or full */
  }
}

export function loadView(areaId: string = ACTIVE_AREA.id): SavedView | null {
  try {
    const raw = readAreaItem(VIEW_KEY, areaId)
    return raw ? (JSON.parse(raw) as SavedView) : null
  } catch {
    return null
  }
}

export function saveView(view: SavedView, areaId: string = ACTIVE_AREA.id): void {
  writeAreaItem(VIEW_KEY, JSON.stringify({ ...view, v: VIEW_V }), areaId)
}
