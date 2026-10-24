import { bounds, centre, parseBoxId } from '../explore/box'
import { LAT0, LON0, TILE_H, TILE_W } from '../explore/lattice'
import { manifestGet } from '../offline/fileStore'
import { badAreaField } from './check'
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
 *
 * Once the queue has baked a pack for it (docs/REQUESTS.md, The model), the
 * location keeps the pack's id and area file, and opens on the pack: the
 * pack's files under the location's own id and name, so its pins, notes,
 * checks and views stay with it. Nothing is built into the app for it.
 */

export interface Location {
  /** the box's id, b-x0-y0-x1-y1, which is the area's */
  id: string
  name: string
  /** the province: which live imagery stands in (ON, QC, …) */
  jurisdiction: string
  /** loaded at, ms */
  at: number
  /** the pack baked for it, once the queue said which (explore/requests.ts), or a link named */
  pack?: string
  /** that pack's area file as the Worker served it (/areas/<pack>/area.json), kept, so the
   *  location opens on it with no signal and nothing fetched at start */
  def?: Record<string, unknown>
}

export const LOCATIONS_KEY = 'huntapp-locations'

export function readLocations(): Location[] {
  try {
    const raw = localStorage.getItem(LOCATIONS_KEY)
    const list = raw ? (JSON.parse(raw) as Location[]) : []
    if (!Array.isArray(list)) return []
    return list
      .filter((l) => l && typeof l.id === 'string' && parseBoxId(l.id) != null)
      .map((l) => {
        // a pack id that is not one, or an area file that is not an object, is left off: the box stands
        const pack = typeof l.pack === 'string' && PACK_ID.test(l.pack) ? l.pack : undefined
        const def = pack && l.def && typeof l.def === 'object' && !Array.isArray(l.def) ? l.def : undefined
        const { pack: _p, def: _d, ...rest } = l
        return { ...rest, ...(pack ? { pack } : {}), ...(def ? { def } : {}) }
      })
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

/** The pack baked for a kept location, and its area file once fetched (explore/requests.ts): kept
 *  with it, read at the next start. False when the phone no longer keeps the location. */
export function setLocationPack(id: string, pack: string, def?: Record<string, unknown>): boolean {
  if (!PACK_ID.test(pack)) return false
  const list = readLocations()
  const l = list.find((o) => o.id === id)
  if (!l) return false
  const keepDef = def ?? (l.pack === pack ? l.def : undefined)
  writeLocations(list.map((o) => (o.id === id ? { ...o, pack, ...(keepDef ? { def: keepDef } : { def: undefined }) } : o)))
  return true
}

/** The live services that stand in for a province's baked layers
 *  (map/sources.ts): Ontario's LIO, Québec's imagery; elsewhere Esri's
 *  photo, streamed as for Blanchard River and Clearwater (none left the
 *  photo views on the Topo look: "i click hunt, i only see our topo view",
 *  2026-10-21). Streamed only: a spot's Save keeps no Esri tiles (offline
 *  sharpImagery.ts sharpOf), their offline terms being the open licence
 *  question (docs/OLD-ROADS.md). */
function liveFor(j: string): AreaDef['live'] {
  if (j === 'ON') return { lio: true, satellite: 'lio' }
  if (j === 'QC') return { lio: false, satellite: 'qc' }
  return { lio: false, satellite: null, sharp: 'esri' }
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

/** A pack's id as the queue makes them (sd-…, hd-…) or an older area's: lower case, dashes. */
const PACK_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** The location as an area: on its pack when it has one the app can read and should open on now
 *  (packFirst), else its box with nothing baked. Null for an id that is not a box. */
export function locationArea(l: Location, online: boolean = typeof navigator === 'undefined' || navigator.onLine): AreaDef | null {
  const box = boxArea(l)
  if (!box || !l.def || !l.pack) return box
  const pack = packArea(l, l.def)
  return pack && packFirst(pack, box, online) ? pack : box
}

/** The pack's area file under the location's id and name: the pack's region, grids and files
 *  (named for the pack: stem), the location's camp at the box's middle. Null when the file is not
 *  one the app can read (a bake that left a field out). */
export function packArea(l: Location, def: Record<string, unknown>): AreaDef | null {
  const d = def as unknown as AreaDef
  if (typeof d.id !== 'string' || !PACK_ID.test(d.id)) return null
  const box = parseBoxId(l.id)
  if (!box) return null
  const [cx, cy] = centre(box)
  const zone = (d.zone ?? {}) as Partial<AreaDef['zone']>
  const presets = Array.isArray(d.presets) ? d.presets : []
  const a: AreaDef = {
    ...d,
    id: l.id,
    name: l.name,
    stem: d.stem ?? d.id,
    loaded: 'pack',
    // a US state's unit is filled by the bake's coverage step; one not filled reads as no name
    zone: { label: zone.label ?? '', name: zone.name ?? '' },
    // the camp is the location's: its name and box (the grade sheet's HD ask reads the note, ui/grade.tsx askedBox)
    presets: [{ name: l.name, lon: cx, lat: cy, kind: 'camp', note: l.id }, ...presets.slice(1)],
    bundle: { description: (d.bundle?.description ?? '').split(d.name).join(l.name) || `${l.name}: the pack baked for it` },
  }
  return badAreaField(a) == null ? a : null
}

/** Open on the pack, or stay on the box for now: with signal the pack (whatever is not on the
 *  phone streams); with none, the pack only when its wind grid is on the phone or nothing of the
 *  box's is, so a phone that saved the box for the bush never opens on a pack it cannot draw
 *  (the new pack takes over once it is whole on the phone: docs/REQUESTS.md). */
export function packFirst(pack: AreaDef, box: AreaDef, online: boolean): boolean {
  if (online) return true
  const stem = pack.stem ?? pack.id
  if (pack.files.grids.some((g) => g.startsWith('micro') && manifestGet(`${g}-${stem}.hab`) != null)) return true
  return !locationFiles(box).some((f) => f.endsWith('.hab') && manifestGet(f) != null)
}

/** The box made an area: its region a little past the box (1.5 km), its core
 *  the box, its camp the middle under the location's name. Null for an id
 *  that is not a box. */
export function boxArea(l: Location): AreaDef | null {
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
 *  link (?area=b-…&name=…&j=…&p=…). Made and kept, so the phone has it from
 *  then on, as if loaded here. `p` is the pack baked for it: its area file is
 *  fetched once the app runs (explore/requests.ts fetchPacks), and a kept
 *  location with no pack yet takes the link's. Run before readLocations. */
export function addressLocation(href: string, known: (id: string) => boolean): Location | null {
  let u: URL
  try {
    u = new URL(href)
  } catch {
    return null
  }
  const id = u.searchParams.get('area')
  const box = id ? parseBoxId(id) : null
  if (!id || !box) return null
  const p = u.searchParams.get('p')
  const pack = p && PACK_ID.test(p) ? p : undefined
  const mine = readLocations().find((o) => o.id === id)
  if (mine) {
    if (pack && !mine.pack) setLocationPack(id, pack)
    return null
  }
  if (known(id)) return null
  const [cx, cy] = centre(box)
  const l: Location = {
    id,
    name: u.searchParams.get('name')?.slice(0, 60) || 'Spot',
    jurisdiction: u.searchParams.get('j')?.slice(0, 3).toUpperCase() || provinceAt(cx, cy),
    at: Date.now(),
    ...(pack ? { pack } : {}),
  }
  keepLocation(l)
  return l
}
