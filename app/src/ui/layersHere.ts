/**
 * The layers at this spot, by what data there is for each (Gavan,
 * 2026-10-23: "we really need to be based on what layers are available").
 * Every row is read off the ground's own data: the area's files and bake
 * for what is here now; the coverage index under its box (explore/
 * coverageRead.ts: 1 m LiDAR flown or not and when, which inventory's
 * stands, whose water and roads, the province) and the SD wind tiles' index
 * for what the data here allows. So a row says one of four things: it is
 * here; HD gives it, from data that exists here; the ground-wind ask or a
 * bake gives it; or the data does not exist here, and nothing will bring
 * it (no LiDAR flown, no inventory published). Clearwater, Pickle Lake and
 * a loaded spot each read as what they are.
 */
import { ACTIVE_AREA, type AreaDef } from '../areas'
import { bushMeasured, FINE_RELIEF, windSolved } from '../config'
import { boxOfBounds, parseBoxId, tilesUnder } from '../explore/box'
import { coverageUnder } from '../explore/coverageRead'
import type { CoverageProps } from '../explore/store'
import { sdIndex } from '../weather/micro/windTiles'

export type RowState = 'have' | 'hd' | 'ask' | 'none'

export interface LayerRow {
  id: string
  /** the layer, as the hunter knows it */
  layer: string
  /** what is here now, and from what */
  now: string
  /** what the data here allows: HD's version, the ask's, or why nothing will bring it */
  next: string
  state: RowState
}

/** What the data under the box says. Fields are null where the index could not be read. */
export interface GroundData {
  prov: string | null
  /** 1 m LiDAR under every tile, some, none; null unread */
  lidar: 'all' | 'some' | 'none' | null
  flown: string
  /** the inventory's name (FRI 2012, écoforestière, VRI), '' for SCANFI only, null unread */
  stands: string | null
  /** the province's water and roads source, '' for national only, null unread */
  water: string | null
  /** SD wind tiles baked under the box, of how many; null unread */
  sdHave: number | null
  sdTiles: number
}

/** The provinces whose lots and private land the bake draws (pipeline/build_property.py). */
const LOTS_PROVS = new Set(['ON', 'BC', 'YT', 'AB'])
/** Lake depth: Ontario's LIO bathymetry is the one wired. */
const BATHY_PROVS = new Set(['ON'])

const uniq = (xs: string[]) => [...new Set(xs)]
const years = (ys: number[]) => {
  const lo = Math.min(...ys)
  const hi = Math.max(...ys)
  return lo === hi ? `${lo}` : `${lo}–${hi}`
}

function groundOf(ps: CoverageProps[] | null, sdHave: number | null, sdTiles: number): GroundData {
  if (!ps || !ps.length) return { prov: null, lidar: null, flown: '', stands: null, water: null, sdHave, sdTiles }
  const lidar = ps.filter((p) => (p.lidar ?? 0) > 0)
  const stands = uniq(ps.map((p) => p.stands ?? 'SCANFI').filter((s) => s !== 'SCANFI'))
  const water = uniq(ps.map((p) => p.water ?? '').filter((w) => w && !w.startsWith('national')))
  return {
    prov: uniq(ps.map((p) => p.prov ?? '').filter(Boolean)).join(', ') || null,
    lidar: lidar.length === ps.length ? 'all' : lidar.length ? 'some' : 'none',
    flown: lidar.length ? years(lidar.map((p) => p.lidar!)) : '',
    stands: stands.join(' and '),
    water: water.join(' and '),
    sdHave,
    sdTiles,
  }
}

/** The ground's data under an area: the coverage index and the SD tiles' index, read together. */
export async function groundData(a: AreaDef = ACTIVE_AREA): Promise<GroundData> {
  const box = parseBoxId(a.id) ?? boxOfBounds(a.core.west, a.core.south, a.core.east, a.core.north)
  const tiles = tilesUnder(box)
  const [cov, idx] = await Promise.all([coverageUnder(box), a.loaded === 'box' ? sdIndex() : Promise.resolve(null)])
  const sdHave = idx ? tiles.filter((t) => t.id in idx.tiles).length : null
  return groundOf(cov, sdHave, tiles.length)
}

/** The rows for an area, given its ground's data. */
export function layerRows(a: AreaDef, g: GroundData): LayerRow[] {
  const has = (k: string) => a.files.pmtiles.includes(k)
  const geo = (k: string) => a.files.geo.includes(k)
  const grid = (k: string) => a.files.grids.includes(k)
  const point = (k: string) => /LiDAR|point cloud/i.test(a.coverage?.pmtiles[k]?.source ?? '')
  const spot = a.loaded === 'box'
  const prov = g.prov ?? a.jurisdiction ?? ''
  // the LiDAR layers: here, HD's where the index says it was flown, nothing where it says none, HD's "where flown" unread
  const lidar = g.lidar
  const flown = g.flown ? `, flown ${g.flown}` : ''
  const part = lidar === 'some' ? ' under part of the box' : ''
  const noLidar = 'no 1 m LiDAR has been flown here'
  const r = (id: string, layer: string, now: string, next: string, state: RowState): LayerRow => ({ id, layer, now, next, state })
  const rows: LayerRow[] = []

  rows.push(r('forecast', 'Forecast', 'HRDPS at 2.5 km, hour by hour', '', 'have'))

  if (windSolved(a)) rows.push(r('wind', 'Ground wind', 'WindNinja solved over this ground, at head height', '', 'have'))
  else if (spot && g.sdHave === 0) rows.push(r('wind', 'Ground wind', 'the forecast wind alone: no SD tiles baked here yet', 'ask for it: the trained model on the 30 m terrain and forest, baked for this box', 'ask'))
  else
    rows.push(
      r(
        'wind',
        'Ground wind',
        spot && g.sdHave != null && g.sdHave < g.sdTiles ? `the trained model under ${g.sdHave} of ${g.sdTiles} cells (SD tiles); the forecast's wind elsewhere` : 'the trained model on the 30 m terrain and forest (MRDEM, SCANFI)',
        'HD: WindNinja solves the full flow over this ground, the lee behind rises and the bend round hills',
        'hd',
      ),
    )
  rows.push(r('scent', 'Scent cone', 'drawn on the ground wind from where you sit', '', 'have'))

  if (has('hillshadeLidar')) rows.push(r('shade', 'Terrain shade', `${FINE_RELIEF.name} shade: old roads and trails under the trees`, '', 'have'))
  else if (lidar === 'none') rows.push(r('shade', 'Terrain shade', '30 m national relief (MRDEM)', `${noLidar}: the 30 m relief is the finest there is`, 'none'))
  else rows.push(r('shade', 'Terrain shade', '30 m national relief (MRDEM)', `HD: 1 m LiDAR shade${flown}${part || (lidar ? '' : ', where it has been flown')}; old roads and trails show through the canopy`, 'hd'))

  if (has('contours')) rows.push(r('contours', 'Contours', 'every metre, from LiDAR', '', 'have'))
  else {
    const now = has('contoursWide') ? '10 m, from the 30 m terrain' : spot ? 'none in a loaded spot' : '10 m, from the 30 m terrain'
    if (lidar === 'none') rows.push(r('contours', 'Contours', now, spot ? `a bake brings 10 m contours; ${noLidar}` : `${noLidar}: 10 m is the finest`, spot ? 'ask' : 'none'))
    else rows.push(r('contours', 'Contours', now, `HD: every metre from the LiDAR${part}, the draws cold air drains and the benches`, 'hd'))
  }

  if (has('forest')) rows.push(r('stands', 'Trees and stands', "the inventory's stands: age, species, cuts", '', 'have'))
  else if (g.stands) rows.push(r('stands', 'Trees and stands', 'the national 30 m model (SCANFI)', `HD: ${g.stands} inventory stands, with age, species and cuts`, 'hd'))
  else if (g.stands === '') rows.push(r('stands', 'Trees and stands', 'the national 30 m model (SCANFI)', `${prov || 'the province'} publishes no inventory here: SCANFI is what there is`, 'none'))
  else rows.push(r('stands', 'Trees and stands', 'the national 30 m model (SCANFI)', "HD: the province's inventory stands, where it publishes one", 'hd'))

  if (bushMeasured(a)) rows.push(r('bush', 'Bush', point('understory') ? 'measured at eye level from the point cloud' : 'mapped by a model trained on this ground', '', 'have'))
  else {
    const now = has('understory') ? 'the national bush model, an estimate at 30 m' : 'none in a loaded spot'
    if (lidar === 'none') rows.push(r('bush', 'Bush', now, has('understory') ? `${noLidar}: the model is what there is` : 'a bake brings the national model; no point cloud here to measure from', has('understory') ? 'none' : 'ask'))
    else rows.push(r('bush', 'Bush', now, `HD: bush thickness measured at eye level from the LiDAR point cloud${part}`, 'hd'))
  }

  if (has('lanes') && point('lanes')) rows.push(r('lanes', 'Shooting lanes', 'measured from the point cloud', '', 'have'))
  else {
    const now = has('lanes') ? 'stand scale, from the bush model' : 'none'
    if (lidar === 'none') rows.push(r('lanes', 'Shooting lanes', now, has('lanes') ? `${noLidar}: stand scale is what there is` : 'a bake brings stand scale from the bush model; no point cloud here for single lanes', has('lanes') ? 'none' : 'ask'))
    else rows.push(r('lanes', 'Shooting lanes', now, `HD: where you can see and shoot, measured from the point cloud${part}`, 'hd'))
  }

  if (grid('habitat')) rows.push(r('heat', 'Heat map and spots', has('forest') ? "scored on this ground's stands, water and relief" : 'scored on the national stands and relief', '', 'have'))
  else rows.push(r('heat', 'Heat map and spots', 'none in a loaded spot', 'a bake scores the ground: the stands, the water, the relief', 'ask'))

  if (geo('roads') || has('lakes')) rows.push(r('water', 'Water and roads', "the province's, baked in for no signal", '', 'have'))
  else if (g.water) rows.push(r('water', 'Water and roads', "the streamed map's", `a bake brings ${g.water}, in for no signal`, 'ask'))
  else if (g.water === '') rows.push(r('water', 'Water and roads', "the streamed map's", `${prov || 'this province'} is not wired for water and roads yet: the national map's`, 'none'))
  else rows.push(r('water', 'Water and roads', "the streamed map's", "a bake brings the province's, in for no signal", 'ask'))

  if (geo('lots') || geo('land')) rows.push(r('lots', 'Property lines', 'private land and lots marked', '', 'have'))
  else if (LOTS_PROVS.has(prov)) rows.push(r('lots', 'Property lines', 'none', `a bake brings ${prov}'s lots and private land`, 'ask'))
  else rows.push(r('lots', 'Property lines', 'none', `${prov || 'this province'} publishes no lot lines the app can draw; reserves and parks only`, 'none'))

  if (has('bathy') || geo('depth')) rows.push(r('depth', 'Lake depth', 'LIO soundings, baked in', '', 'have'))
  else if (BATHY_PROVS.has(prov)) rows.push(r('depth', 'Lake depth', 'none', 'a bake brings LIO soundings where Ontario has them', 'ask'))

  rows.push(r('imagery', 'Imagery', 'Esri, streamed with signal', '', 'have'))

  if (spot) rows.push(r('offline', 'No signal', 'Save keeps the forecast and the SD wind tiles', 'a bake keeps every layer on the phone as a pack', 'ask'))
  else rows.push(r('offline', 'No signal', 'the area pack: every layer on the phone', '', 'have'))
  return rows
}

/** The rows for an area, its ground's data read first. */
export async function layersHere(a: AreaDef = ACTIVE_AREA): Promise<{ rows: LayerRow[]; ground: GroundData }> {
  const ground = await groundData(a)
  return { rows: layerRows(a, ground), ground }
}
