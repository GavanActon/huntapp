import { D_LAT, D_LON, LAT0, LON0, TILE_COLS, TILE_ROWS, tileOf, type Tile } from './lattice'

/**
 * The box a hunter draws in Explore (docs/EXPLORE.md; Gavan, 2026-10-09:
 * "select a section of a grid instead of blocks"): any size between the
 * limits, its edges on the habitat cells of the SD lattice (0.0004° ×
 * 0.00027°, about 30 m), so an SD pack is a straight cut of the tiles
 * under it and two hunters drawing round the same lake ask for the same
 * box. Held as cell indices, counted as the lattice counts its tiles:
 * x east from 180° W, y south from 90° N; x1 and y1 are past the last cell.
 */
export interface Box {
  x0: number
  y0: number
  x1: number
  y1: number
}

export type Corner = 'nw' | 'ne' | 'sw' | 'se'

/** A side at the least, km: a smaller box is mostly the margin baked round it. */
export const MIN_KM = 2
/** SD: a side at the most, km. The tiles under it are shared; the cap is the download. */
export const SD_MAX_KM = 20
/** HD: the most ground and the longest side for one ask. Every HD area
 *  shipped fits (Blanchard River's core is 12 × 10 km, 123 km²). */
export const HD_MAX_KM2 = 125
export const HD_MAX_SIDE_KM = 15
/** A new box: 10 km a side, Lac Bailey's core. */
export const START_KM = 10

const KM_PER_DEG = 111.2

const cellX = (lon: number) => (lon - LON0) / D_LON
const cellY = (lat: number) => (LAT0 - lat) / D_LAT
const lonOf = (x: number) => LON0 + x * D_LON
const latOf = (y: number) => LAT0 - y * D_LAT
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** A cell's size east and north, km, at a latitude. */
function cellKm(lat: number): [number, number] {
  return [D_LON * KM_PER_DEG * Math.cos((lat * Math.PI) / 180), D_LAT * KM_PER_DEG]
}

/** The least and most cells a side may span, east and north, at the box's latitude. */
function sideCells(b: Box): { minX: number; maxX: number; minY: number; maxY: number } {
  const [cw, ch] = cellKm(latOf((b.y0 + b.y1) / 2))
  return { minX: Math.ceil(MIN_KM / cw), maxX: Math.floor(SD_MAX_KM / cw), minY: Math.ceil(MIN_KM / ch), maxY: Math.floor(SD_MAX_KM / ch) }
}

export function bounds(b: Box): { west: number; south: number; east: number; north: number } {
  return { west: lonOf(b.x0), east: lonOf(b.x1), north: latOf(b.y0), south: latOf(b.y1) }
}

export function corners(b: Box): Record<Corner, [number, number]> {
  const { west, south, east, north } = bounds(b)
  return { nw: [west, north], ne: [east, north], sw: [west, south], se: [east, south] }
}

export function centre(b: Box): [number, number] {
  return [lonOf((b.x0 + b.x1) / 2), latOf((b.y0 + b.y1) / 2)]
}

export function sizeKm(b: Box): { w: number; h: number; km2: number } {
  const [cw, ch] = cellKm(latOf((b.y0 + b.y1) / 2))
  const w = (b.x1 - b.x0) * cw
  const h = (b.y1 - b.y0) * ch
  return { w, h, km2: w * h }
}

export function holds(b: Box, lon: number, lat: number): boolean {
  const x = cellX(lon)
  const y = cellY(lat)
  return x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1
}

/** A box of w × h km round a point, on the cells. */
export function boxAround(lon: number, lat: number, wKm = START_KM, hKm = START_KM): Box {
  const [cw, ch] = cellKm(lat)
  const nx = Math.round(wKm / cw)
  const ny = Math.round(hKm / ch)
  const x0 = Math.round(cellX(lon) - nx / 2)
  const y0 = Math.round(cellY(lat) - ny / 2)
  return { x0, y0, x1: x0 + nx, y1: y0 + ny }
}

/** The same box with its middle on a point. */
export function moveTo(b: Box, lon: number, lat: number): Box {
  const nx = b.x1 - b.x0
  const ny = b.y1 - b.y0
  const x0 = Math.round(cellX(lon) - nx / 2)
  const y0 = Math.round(cellY(lat) - ny / 2)
  return { x0, y0, x1: x0 + nx, y1: y0 + ny }
}

/** One corner pulled to a point, the opposite one held, each side kept
 *  between MIN_KM and SD_MAX_KM: past either the corner stops. */
export function dragCorner(b: Box, c: Corner, lon: number, lat: number): Box {
  const { minX, maxX, minY, maxY } = sideCells(b)
  const x = Math.round(cellX(lon))
  const y = Math.round(cellY(lat))
  let { x0, y0, x1, y1 } = b
  if (c === 'nw' || c === 'sw') x0 = x1 - clamp(x1 - x, minX, maxX)
  else x1 = x0 + clamp(x - x0, minX, maxX)
  if (c === 'nw' || c === 'ne') y0 = y1 - clamp(y1 - y, minY, maxY)
  else y1 = y0 + clamp(y - y0, minY, maxY)
  return { x0, y0, x1, y1 }
}

/** A side is as long as one ask allows. */
export function atCap(b: Box): boolean {
  const { maxX, maxY } = sideCells(b)
  return b.x1 - b.x0 >= maxX || b.y1 - b.y0 >= maxY
}

/** Small enough to ask for HD. */
export function hdFits(b: Box): boolean {
  const s = sizeKm(b)
  return s.km2 <= HD_MAX_KM2 + 0.5 && Math.max(s.w, s.h) <= HD_MAX_SIDE_KM + 0.05
}

/** The box as the request carries it (and the bake agent reads it back). */
export function boxId(b: Box): string {
  return `b-${b.x0}-${b.y0}-${b.x1}-${b.y1}`
}

export function parseBoxId(id: string): Box | null {
  const m = /^b-(\d+)-(\d+)-(\d+)-(\d+)$/.exec(id)
  if (!m) return null
  const [x0, y0, x1, y1] = m.slice(1).map(Number)
  return x1 > x0 && y1 > y0 ? { x0, y0, x1, y1 } : null
}

/** The SD tiles under the box, west to east, north to south. */
export function tilesUnder(b: Box): Tile[] {
  const out: Tile[] = []
  for (let j = Math.floor(b.y0 / TILE_ROWS); j <= Math.floor((b.y1 - 1) / TILE_ROWS); j++)
    for (let i = Math.floor(b.x0 / TILE_COLS); i <= Math.floor((b.x1 - 1) / TILE_COLS); i++) out.push(tileOf(i, j))
  return out
}

/**
 * About how big the pack is, MB. SD by the box's ground at Highland Lake's
 * rate (30 m relief, no LiDAR: 45 MB over its 294 km²); HD by the box and
 * the ~5 km of margin baked round it, at the LiDAR areas' rate (Sault,
 * Blanchard River and Lac Bailey run 0.2–0.6 MB a km² of region). A guide
 * until the cropped packs exist.
 */
export function packMb(b: Box, kind: 'sd' | 'hd'): number {
  const s = sizeKm(b)
  const mb = kind === 'sd' ? s.km2 * 0.15 : (s.w + 10) * (s.h + 10) * 0.4
  return mb < 10 ? Math.max(1, Math.round(mb)) : Math.round(mb / 5) * 5
}
