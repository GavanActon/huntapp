/**
 * The coverage index read straight from its archive, with no map layer in
 * between (the grid draws only while Explore is on, and a hidden layer
 * loads nothing): one z10 tile of coverage-ca.pmtiles per web-mercator
 * tile the box touches, decoded here, the lattice tiles under the box
 * picked out by id. Kept for the run, so a sheet opened twice reads once.
 * Null on no signal or no archive: the caller says what it can without it.
 */
import { VectorTile } from '@mapbox/vector-tile'
import Pbf from 'pbf'
import { FetchSource, PMTiles } from 'pmtiles'
import { DATA_BASE } from '../areas'
import { bounds, tilesUnder, type Box } from './box'
import { COVERAGE_FILE } from './coverage'
import { useExplore, type CoverageProps } from './store'

/** the tiles layer's zooms (pipeline/coverage.py TILES_Z): read at the top one, where every lattice tile is whole */
const Z = 10

let archive: PMTiles | null = null
const read = new Map<string, Promise<Record<string, CoverageProps> | null>>()

function xyOf(lon: number, lat: number): [number, number] {
  const n = 2 ** Z
  const x = Math.floor(((lon + 180) / 360) * n)
  const r = (lat * Math.PI) / 180
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n)
  return [Math.min(n - 1, Math.max(0, x)), Math.min(n - 1, Math.max(0, y))]
}

/** One mercator tile's lattice tiles, by id. */
function readTile(x: number, y: number): Promise<Record<string, CoverageProps> | null> {
  const key = `${x}/${y}`
  let p = read.get(key)
  if (!p) {
    p = (async () => {
      try {
        archive ??= new PMTiles(new FetchSource(`${DATA_BASE}explore/${COVERAGE_FILE}`))
        const t = await archive.getZxy(Z, x, y)
        if (!t) return {}
        const vt = new VectorTile(new Pbf(new Uint8Array(t.data)))
        const layer = vt.layers.tiles
        const out: Record<string, CoverageProps> = {}
        if (!layer) return out
        for (let i = 0; i < layer.length; i++) {
          const f = layer.feature(i)
          const props = f.properties as CoverageProps & { id?: string }
          const id = props.id ?? (f.id != null ? String(f.id) : null)
          if (id) out[id] = props
        }
        return out
      } catch {
        return null
      }
    })()
    read.set(key, p)
    // a failed read is asked again next time
    void p.then((r) => {
      if (r == null) read.delete(key)
    })
  }
  return p
}

/** What the index says of each lattice tile under the box, in the box's
 *  order; what Explore has read already is kept, the rest fetched. Null
 *  when nothing could be read at all. */
export async function coverageUnder(box: Box): Promise<CoverageProps[] | null> {
  const tiles = tilesUnder(box)
  const kept = useExplore.getState().cover
  const have: Record<string, CoverageProps> = {}
  for (const t of tiles) if (kept[t.id]) have[t.id] = kept[t.id]
  if (tiles.every((t) => t.id in have)) return tiles.map((t) => have[t.id])
  const b = bounds(box)
  const [x0, y0] = xyOf(b.west, b.north)
  const [x1, y1] = xyOf(b.east, b.south)
  const reads: Promise<Record<string, CoverageProps> | null>[] = []
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) reads.push(readTile(x, y))
  const got = await Promise.all(reads)
  if (got.every((g) => g == null)) return null
  for (const g of got) if (g) for (const t of tiles) if (!have[t.id] && g[t.id]) have[t.id] = g[t.id]
  return tiles.map((t) => have[t.id]).filter((p): p is CoverageProps => p != null)
}
