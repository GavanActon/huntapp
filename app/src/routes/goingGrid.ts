/**
 * The going grid (build_going.py): 10 m cells over the core of what the
 * ground is like to walk on. Read once, the phone's stored copy first, and
 * handed to the route worker as plain arrays.
 */
import { goingFile } from '../config'
import { devlog } from '../devlog'
import { loadBandFile, type Habitat } from '../spots/habitatGrid'
import type { GoingGridData } from './router'

export interface Going {
  grid: Habitat
  data: GoingGridData
}

let loaded: Going | null = null
let inflight: Promise<Going | null> | null = null

function build(grid: Habitat, header: Record<string, unknown>): Going {
  const n = grid.size
  const elevRaw = grid.raw('elev')
  const bushRaw = grid.raw('bush')
  const roughRaw = grid.raw('rough')
  const es = grid.scale('elev')
  const bs = grid.scale('bush')
  const rs = grid.scale('rough')
  const elev = new Float32Array(n)
  const bush = new Float32Array(n)
  const rough = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    elev[i] = elevRaw[i] * es
    bush[i] = bushRaw[i] === 255 ? NaN : bushRaw[i] * bs
    rough[i] = roughRaw[i] * rs
  }
  const hab = (header.habitat as GoingGridData['hab'] | undefined) ?? { c0: 0, r0: 0, k: 3 }
  return {
    grid,
    data: {
      cols: grid.cols,
      rows: grid.rows,
      dx: grid.cellM[0],
      dy: grid.cellM[1],
      elev,
      bush,
      rough,
      // copies, not views on the file's buffer: posting a view would send the whole file
      bushSrc: Uint8Array.from(grid.raw('bushSrc')),
      ground: Uint8Array.from(grid.raw('ground')),
      hab,
    },
  }
}

/** The grid, loading it once. Null when it is not baked and not cached. */
export function loadGoing(): Promise<Going | null> {
  if (loaded) return Promise.resolve(loaded)
  if (inflight) return inflight
  inflight = loadBandFile(goingFile(), 'routes')
    .then((r) => (r ? (loaded = build(r.grid, r.header)) : null))
    .catch((e) => {
      devlog('routes', `going grid failed · ${(e as Error).message}`)
      return null
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

export function going(): Going | null {
  return loaded
}

/** The cell under a point, or -1 outside the grid. */
export function cellAt(g: Going, lon: number, lat: number): number {
  return g.grid.index(lon, lat)
}

export function cellCentre(g: Going, i: number): [number, number] {
  return g.grid.center(i)
}
