/**
 * The SD lattice (pipeline/tiles.py, docs/TILES.md): 375 × 370 habitat
 * cells of 0.0004° × 0.00027°, anchored at 180° W and 90° N, so a tile is
 * 0.15° × 0.0999°, about 11 km, with the id t-<i>-<j>, i counting east
 * from 180° W and j south from 90° N. The grid Explore draws and the unit
 * of every request (docs/EXPLORE.md).
 */
export const D_LON = 0.0004
export const D_LAT = 0.00027
export const TILE_COLS = 375
export const TILE_ROWS = 370
export const LON0 = -180
export const LAT0 = 90
export const TILE_W = TILE_COLS * D_LON
export const TILE_H = TILE_ROWS * D_LAT

export interface Tile {
  id: string
  i: number
  j: number
  west: number
  south: number
  east: number
  north: number
}

export function tileOf(i: number, j: number): Tile {
  const west = LON0 + i * TILE_W
  const north = LAT0 - j * TILE_H
  return { id: `t-${i}-${j}`, i, j, west, east: west + TILE_W, north, south: north - TILE_H }
}

/** The tile holding a point. */
export function tileAt(lon: number, lat: number): Tile {
  return tileOf(Math.floor((lon - LON0) / TILE_W), Math.floor((LAT0 - lat) / TILE_H))
}

export function parseTileId(id: string): Tile | null {
  const m = /^t-(\d+)-(\d+)$/.exec(id)
  return m ? tileOf(Number(m[1]), Number(m[2])) : null
}

export function tileCentre(t: Tile): [number, number] {
  return [(t.west + t.east) / 2, (t.south + t.north) / 2]
}
