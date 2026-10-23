/**
 * What this spot has, layer by layer, and what HD would make of each
 * (Gavan, 2026-10-23: "more concerned about what layers we have, and what
 * they can upgrade to"). One table for every grade, read off the area's
 * own files and bake (what is here, for certain) and, for the HD column,
 * off the coverage index where its tiles under the area have been read
 * (1 m LiDAR flown or not, which inventory's stands, whose water and
 * roads): the grade says what the data gives (docs/SD-HD-PLAN.md "The
 * shape"; Clearwater showed HD without LiDAR is its own grade). Without
 * the index read, the HD column says what HD adds where the data is there,
 * and the sheet says to open the box to read it.
 */
import { ACTIVE_AREA, type AreaDef } from '../areas'
import { areaGrade, bushMeasured, FINE_RELIEF, windSolved } from '../config'
import { boxOfBounds, parseBoxId, tilesUnder } from '../explore/box'
import { COVERAGE_SOURCE } from '../explore/coverage'
import { useExplore, type CoverageProps } from '../explore/store'
import { getMap } from '../map/mapController'

export interface LayerRow {
  id: string
  /** the layer, as the hunter knows it */
  layer: string
  /** what is here now */
  now: string
  /** what HD gives here; empty for an HD area's row that is what it is */
  hd: string
  /** now is nothing here, and HD (or the SD ask) would bring it */
  want?: boolean
  /** HD changes nothing for this layer */
  same?: boolean
}

/** What the coverage index says under the area: read off the grid's loaded
 *  tiles, else what Explore read for them last (a Load or an HD ask here). */
export function coverageUnder(a: AreaDef = ACTIVE_AREA): CoverageProps[] {
  const box = parseBoxId(a.id) ?? boxOfBounds(a.core.west, a.core.south, a.core.east, a.core.north)
  const ids = tilesUnder(box).map((t) => t.id)
  const want = new Set(ids)
  const got: Record<string, CoverageProps> = {}
  const kept = useExplore.getState().cover
  for (const id of ids) if (kept[id]) got[id] = kept[id]
  const m = getMap()
  if (m && m.getSource(COVERAGE_SOURCE)) {
    try {
      for (const f of m.querySourceFeatures(COVERAGE_SOURCE, { sourceLayer: 'tiles' })) {
        const id = String(f.id ?? f.properties?.id)
        if (want.has(id) && !got[id]) got[id] = f.properties as CoverageProps
      }
    } catch {
      /* the grid is not up: what Explore kept */
    }
  }
  return ids.map((id) => got[id]).filter((p): p is CoverageProps => p != null)
}

const uniq = (xs: string[]) => [...new Set(xs)]
const years = (ys: number[]) => {
  const lo = Math.min(...ys)
  const hi = Math.max(...ys)
  return lo === hi ? `${lo}` : `${lo}–${hi}`
}

/** The words the coverage index gives the HD column: LiDAR, stands, water. Null where nothing was read. */
function ground(ps: CoverageProps[]) {
  if (!ps.length) return null
  const lidar = ps.filter((p) => (p.lidar ?? 0) > 0)
  const flown = lidar.length ? years(lidar.map((p) => p.lidar!)) : ''
  const stands = uniq(ps.map((p) => p.stands ?? 'SCANFI').filter((s) => s !== 'SCANFI'))
  const water = uniq(ps.map((p) => p.water ?? '').filter((w) => w && !w.startsWith('national')))
  return {
    /** every tile, some, or none */
    lidar: lidar.length === ps.length ? 'all' : lidar.length ? 'some' : 'none',
    flown,
    stands: stands.join(' and '),
    water: water.join(' and '),
  }
}

/** SD's bake, or what the loaded spot streams, against HD's: the rows. */
export function layersHere(a: AreaDef = ACTIVE_AREA, sdHave: number | null = null, sdTiles = 0, hdMb: number | null = null): LayerRow[] {
  const has = (k: string) => a.files.pmtiles.includes(k)
  const geo = (k: string) => a.files.geo.includes(k)
  const grid = (k: string) => a.files.grids.includes(k)
  const point = (k: string) => /LiDAR|point cloud/i.test(a.coverage?.pmtiles[k]?.source ?? '')
  const hd = areaGrade(a) === 'hd'
  const spot = a.loaded === 'box'
  const g = ground(coverageUnder(a))
  const rows: LayerRow[] = []

  rows.push({ id: 'forecast', layer: 'Forecast', now: 'HRDPS at 2.5 km, hour by hour', hd: '', same: true })

  // the ground wind: the trained model on the national ground (SD), or WindNinja's solve (HD)
  const solved = windSolved(a)
  rows.push({
    id: 'wind',
    layer: 'Ground wind',
    now: solved
      ? 'WindNinja solved over this ground, at head height'
      : spot
        ? sdHave == null
          ? 'the trained model on the national 30 m terrain and forest'
          : sdHave === 0
            ? 'none yet: the forecast wind alone'
            : sdHave < sdTiles
              ? `the trained model under ${sdHave} of ${sdTiles} cells; the forecast's wind elsewhere`
              : 'the trained model on the national 30 m terrain and forest'
        : 'the trained model on 30 m terrain and this ground’s stands',
    hd: solved ? '' : 'the full solve over this ground: the lee behind rises, the bend round hills',
    want: spot && sdHave === 0,
    same: solved,
  })
  rows.push({ id: 'scent', layer: 'Scent cone', now: 'drawn on the ground wind from where you sit', hd: '', same: true })

  // relief, contours, stands, bush, lanes: LiDAR's layers, where it was flown
  const noLidar = g && g.lidar === 'none'
  rows.push({
    id: 'shade',
    layer: 'Terrain shade',
    now: has('hillshadeLidar') ? `${FINE_RELIEF.name} shade: old roads and trails under the trees` : '30 m national relief',
    hd: has('hillshadeLidar') ? '' : noLidar ? 'no 1 m LiDAR flown here: the 30 m relief stays' : `1 m LiDAR shade${g?.flown ? `, flown ${g.flown}` : ', where it has been flown'}: old roads and trails show through the canopy`,
    same: has('hillshadeLidar'),
  })
  rows.push({
    id: 'contours',
    layer: 'Contours',
    now: has('contours') ? 'every metre, from LiDAR' : has('contoursWide') ? '10 m, from the 30 m terrain' : spot ? 'none in a loaded spot' : '10 m, from the 30 m terrain',
    hd: has('contours') ? '' : noLidar ? '10 m: no LiDAR to draw finer' : 'every metre, from the LiDAR: the draws cold air drains and the benches',
    same: has('contours'),
    want: spot,
  })
  rows.push({
    id: 'stands',
    layer: 'Trees and stands',
    now: has('forest') ? 'the inventory’s stands' : 'the national 30 m model (SCANFI)',
    hd: has('forest') ? '' : g?.stands ? `${g.stands} inventory stands: age, species and cuts` : g ? 'SCANFI here too: no inventory published' : 'the province’s inventory stands where it publishes one',
    same: has('forest'),
  })
  rows.push({
    id: 'bush',
    layer: 'Bush',
    now: bushMeasured(a) ? (point('understory') ? 'measured at eye level from the point cloud' : 'mapped by a model trained on this ground') : has('understory') ? 'the national bush model, an estimate at 30 m' : 'none in a loaded spot',
    hd: bushMeasured(a) ? '' : noLidar ? 'the national model stays: no point cloud here' : 'measured at eye level from the LiDAR point cloud',
    same: bushMeasured(a),
    want: !has('understory'),
  })
  rows.push({
    id: 'lanes',
    layer: 'Shooting lanes',
    now: has('lanes') ? (point('lanes') ? 'measured from the point cloud' : 'stand scale, from the bush model') : 'none',
    hd: has('lanes') && point('lanes') ? '' : noLidar ? 'stand scale from the bush model: no point cloud here' : 'where you can see and shoot, measured from the point cloud',
    same: has('lanes') && point('lanes'),
    want: !has('lanes'),
  })
  rows.push({
    id: 'heat',
    layer: 'Heat map and spots',
    now: grid('habitat') ? (has('forest') ? 'scored on this ground’s stands, water and relief' : 'scored on the national stands and relief') : 'none in a loaded spot',
    hd: grid('habitat') && hd ? '' : 'scored on the inventory stands and the 1 m water and relief',
    same: grid('habitat') && hd,
    want: !grid('habitat'),
  })
  rows.push({
    id: 'water',
    layer: 'Water and roads',
    now: geo('roads') || has('lakes') ? 'the province’s, baked in' : 'the streamed map’s',
    hd: geo('roads') || has('lakes') ? '' : g?.water ? `${g.water}, baked in for no signal` : 'the province’s where wired, baked in for no signal',
    same: geo('roads') || has('lakes'),
  })
  rows.push({
    id: 'lots',
    layer: 'Property lines',
    now: geo('lots') || geo('land') ? 'private land and lots marked' : 'none',
    hd: geo('lots') || geo('land') ? '' : 'private land and lots, where the province publishes them',
    same: geo('lots') || geo('land'),
    want: !(geo('lots') || geo('land')),
  })
  rows.push({ id: 'imagery', layer: 'Imagery', now: 'Esri, streamed with signal', hd: '', same: true })
  rows.push({
    id: 'offline',
    layer: 'No signal',
    now: spot ? 'Save keeps the forecast and the SD wind tiles' : hd ? 'the area pack: every layer on the phone' : 'the area pack on the phone',
    hd: hd ? '' : `the HD pack on the phone${hdMb ? `, about ${hdMb} MB` : ''}`,
    same: hd,
  })
  return rows
}
