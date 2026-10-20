import { bounds, centre, parseBoxId } from '../explore/box'
import { LAT0, LON0, TILE_H, TILE_W } from '../explore/lattice'
import { declinationAt } from './declination'
import type { AreaDef } from './index'

/**
 * Locations the hunter loaded (Gavan, 2026-10-20: "high level streaming,
 * then tied to an intentional load which brings in the hrdps wind etc."):
 * a box on the map (explore/box.ts, its id `b-x0-y0-x1-y1` says where it
 * is), named, made an area here on the phone, nothing baked for it. Its
 * wind is the national SD tiles' (weather/micro/windTiles.ts), its forecast
 * HRDPS's over the box (weather/windGrid.ts), as any area's. What it lacks
 * against a baked one: the habitat grid (no heat map), the walking grid
 * (no routes), the LiDAR. HD over it is a request (explore/BoxCard.tsx).
 *
 * Kept on the phone under LOCATIONS_KEY and read before the active area is
 * settled (areas/index.ts), so one opens as any area does: by its address,
 * ?area=b-…, a reload away. A link to one names it too (&name=, &j=), so a
 * phone that never loaded it makes it from the link and keeps it. No
 * imports beyond the box's pure helpers: this runs before the app does.
 */

export interface Location {
  /** the box's id, b-x0-y0-x1-y1, which is the area's */
  id: string
  name: string
  /** the province: which live imagery stands in (ON, QC, …) */
  jurisdiction: string
  /** loaded at, ms */
  at: number
}

export const LOCATIONS_KEY = 'huntapp-locations'

export function readLocations(): Location[] {
  try {
    const raw = localStorage.getItem(LOCATIONS_KEY)
    const list = raw ? (JSON.parse(raw) as Location[]) : []
    return Array.isArray(list) ? list.filter((l) => l && typeof l.id === 'string' && parseBoxId(l.id) != null) : []
  } catch {
    return []
  }
}

function writeLocations(list: Location[]): void {
  try {
    localStorage.setItem(LOCATIONS_KEY, JSON.stringify(list))
  } catch {
    /* private mode: the address carries the one open */
  }
}

/** Keep a location (a new one, or the same box renamed). */
export function keepLocation(l: Location): void {
  writeLocations([...readLocations().filter((o) => o.id !== l.id), l])
}

export function dropLocation(id: string): void {
  writeLocations(readLocations().filter((o) => o.id !== id))
}

/** The live services that stand in for a province's baked layers
 *  (map/sources.ts): Ontario's LIO, Québec's imagery; elsewhere the far
 *  band's photo alone (Esri's, kept offline, waits on its licence: docs/OLD-ROADS.md). */
function liveFor(j: string): AreaDef['live'] {
  if (j === 'ON') return { lio: true, satellite: 'lio' }
  if (j === 'QC') return { lio: false, satellite: 'qc' }
  return { lio: false, satellite: null }
}

/** A guess at the province from a point, for a link that names none:
 *  the straight borders, and Ontario against Québec on the Ottawa river's
 *  rough line. The box's card says it exactly (explore/coverage.ts). */
export function provinceAt(lon: number, lat: number): string {
  if (lat > 60) return lon < -141 ? 'AK' : lon < -124 ? 'YT' : lon < -102 ? 'NT' : 'NU'
  if (lon < -120) return 'BC'
  if (lon < -110) return 'AB'
  if (lon < -102) return 'SK'
  if (lon < -95.15) return 'MB'
  if (lon < -79.5 || (lat < 46 && lon < -74.4)) return 'ON'
  if (lon < -64 || lat > 48.1) return 'QC'
  return lat > 46.6 && lon < -64.5 ? 'NB' : 'NS'
}

/** The box made an area: its region a little past the box (1.5 km), its core
 *  the box, its camp the middle under the location's name. Null for an id
 *  that is not a box. */
export function locationArea(l: Location): AreaDef | null {
  const box = parseBoxId(l.id)
  if (!box) return null
  const b = bounds(box)
  const [cx, cy] = centre(box)
  const mLat = 1.5 / 111
  const mLon = mLat / Math.max(0.2, Math.cos((cy * Math.PI) / 180))
  let timezone = 'America/Toronto'
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || timezone
  } catch {
    /* the default */
  }
  return {
    id: l.id,
    name: l.name,
    jurisdiction: l.jurisdiction,
    centre: [cx, cy],
    home: { center: [cx, cy], zoom: 13 },
    region: { west: b.west - mLon, south: b.south - mLat, east: b.east + mLon, north: b.north + mLat },
    core: { ...b, maxzoom: 16 },
    regionMaxzoom: 13,
    declination: declinationAt(cx, cy),
    // the forecast's hours in the phone's own zone, as the app reads them anyway
    timezone,
    zone: { label: '', name: '' },
    // no baked relief: the streamed heights colour the view (map/viewLook.ts); this spans ordinary ground
    relief: [150, 600],
    base: `areas/${l.id}/`,
    surveyedLakes: [],
    live: liveFor(l.jurisdiction),
    attribution: { vectors: '', lakes: '', bush: '' },
    // the note is the box: the grade sheet's HD ask reads it (ui/grade.tsx askedBox)
    presets: [{ name: l.name, lon: cx, lat: cy, kind: 'camp', note: l.id }],
    bundle: { description: `${l.name}: SD wind over the box and its forecast` },
    files: { pmtiles: [], geo: [], baseGeo: [], grids: [] },
    bake: { wind: 'sd' },
    loaded: 'box',
  }
}

/** The files a loaded location saves for no signal: the national SD tiles any view in it
 *  stitches (weather/micro/windTiles.ts takes the 2×2 block nearest the view's centre, so every
 *  block a centre in the region can pick) and their index. Named sd-v1-… (areas/index.ts SD_FILE);
 *  tiles not baked yet are skipped by the download, as a file the server lacks is. */
export function locationFiles(a: AreaDef): string[] {
  const r = a.region
  const i0 = Math.round((r.west - LON0) / TILE_W) - 1
  const i1 = Math.round((r.east - LON0) / TILE_W)
  const j0 = Math.round((LAT0 - r.north) / TILE_H) - 1
  const j1 = Math.round((LAT0 - r.south) / TILE_H)
  const out: string[] = []
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) out.push(`sd-v1-t-${i}-${j}.hab`)
  return [...out, 'sd-v1-index.json']
}

/** A location the address names that this phone has not kept: a shared
 *  link (?area=b-…&name=…&j=…). Made and kept, so the phone has it from
 *  then on, as if loaded here. */
export function addressLocation(href: string, known: (id: string) => boolean): Location | null {
  let u: URL
  try {
    u = new URL(href)
  } catch {
    return null
  }
  const id = u.searchParams.get('area')
  const box = id ? parseBoxId(id) : null
  if (!id || !box || known(id)) return null
  const [cx, cy] = centre(box)
  const l: Location = { id, name: u.searchParams.get('name')?.slice(0, 60) || 'Spot', jurisdiction: u.searchParams.get('j')?.slice(0, 3).toUpperCase() || provinceAt(cx, cy), at: Date.now() }
  keepLocation(l)
  return l
}
