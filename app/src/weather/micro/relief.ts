/**
 * The ground's height under the scent plume, from the going grid's `elev`
 * band (build_going.py): the HRDEM 1 m LiDAR DTM area-averaged to 10 m,
 * MRDEM 30 m where the LiDAR stops, over the core only. The micro grid's
 * 30 m MRDEM smooths away a lakeshore bank or a ravine's lip; this keeps
 * them, so a particle in still air can hold its altitude off a drop
 * (docs/MICRO-WIND-LIDAR.md, phase 1). Its `ground` class says where the
 * ground is open water, which on a fall night mixes the air down.
 *
 * Loaded only once someone has a cone: the first cone is drawn without
 * it, and redrawn when it lands. The spec's onRelief started the load
 * itself; here ensureRelief does, because the scent layer subscribes at
 * startup and a phone that never draws a cone need not read the grid
 * (1.6 MB at Pickle Lake, 3.3 MB at Lac Bailey).
 */
import { going, loadGoing, onGoing } from '../../routes/goingGrid'
import { GROUND } from '../../routes/walkModel'

let asked = false

/** Ground elevation under a point, m; NaN outside the going grid or before it is loaded. */
export function elevAt(lon: number, lat: number): number {
  const g = going()
  if (!g) return NaN
  const i = g.grid.index(lon, lat)
  return i < 0 ? NaN : g.data.elev[i]
}

/**
 * The going grid's ground for a plume's particle walk (reliefNear): where
 * the plume's source sits in the grid, and the bands. Plain numbers and
 * arrays, not closures: the walk asks once a particle step, and through a
 * call a step a relief plume took about 0.8 ms (5%) longer.
 */
export interface Relief {
  /** the source's column and row in the grid, fractional */
  c0: number
  r0: number
  /** columns per metre east, rows per metre north */
  sx: number
  sy: number
  cols: number
  rows: number
  /** ground elevation by cell, m */
  elev: Float32Array
  /** ground class by cell (build_going.py): WATER is open water */
  ground: Uint8Array
}

/** The going grid's ground class for open water. */
export const WATER = GROUND.water

/**
 * The going grid around lon, lat for a plume's walk (kx, ky metres per
 * degree there); null before the grid is loaded, so the walk skips the
 * relief outright.
 */
export function reliefNear(lon: number, lat: number, kx: number, ky: number): Relief | null {
  const g = going()
  if (!g) return null
  const { cols, rows, west, north, dLon, dLat } = g.grid
  return { c0: (lon - west) / dLon, r0: (north - lat) / dLat, sx: 1 / (kx * dLon), sy: 1 / (ky * dLat), cols, rows, elev: g.data.elev, ground: g.data.ground }
}

/**
 * The cell x, y metres east and north of the source, -1 off the grid:
 * from the metres directly, the cell elevAt would find through lon/lat.
 * The walk has it written out in its loop (scent.ts simulatePlume).
 */
export function reliefCell(d: Relief, x: number, y: number): number {
  const c = Math.floor(d.c0 + x * d.sx)
  const r = Math.floor(d.r0 - y * d.sy)
  return c < 0 || r < 0 || c >= d.cols || r >= d.rows ? -1 : r * d.cols + c
}

/** Start loading the going grid if nobody has; onRelief hears when it lands. */
export function ensureRelief(): void {
  if (asked || going()) return
  asked = true
  // offline with no stored copy the load comes back empty: the next cone asks again
  void loadGoing().then((g) => {
    if (!g) asked = false
  })
}

/** Call back when the going grid lands, whoever loaded it, so a cone drawn without it is drawn again. */
export function onRelief(cb: () => void): () => void {
  return onGoing(cb)
}
