import type { Map as MlMap } from 'maplibre-gl'
import { DATA_BASE } from '../../areas'
import { REGION } from '../../config'
import { devlog } from '../../devlog'
import { STREAM_PICTURES } from '../../map/streamPictures'
import { Habitat, PREVIEW, type Band, type BandDef, type BandHeader } from '../../spots/habitatGrid'
import { groundSampler, loadMicro, useAreaGrid, useMosaic } from './model'

/**
 * SD wind for anyone (docs/SD-FAST.md; Gavan, 2026-10-13: "SD wind then
 * becomes something anyone can have right away"). The national lattice's
 * tiles (pipeline/wind_tiles.py), each the fast pass's micro grid cut to its
 * 11 km, sit on R2 under sd/<version>/. Past the area's box the 2 × 2 tiles
 * round the view are stitched into one grid on the same lattice and put in
 * the area grid's place (model.ts useMosaic), so the streaks, the cones and
 * the cards read the terrain's wind there as they read the area's; back
 * over the box, the area's own grid returns (HD wins where it exists).
 *
 * Built anew only when the view's centre comes within half a tile of the
 * block's edge. A tile missing from the index is filled with the plain
 * wind (no terrain), so the block's edge meets it without a hole.
 * Behind the pictures-streamed trial for now (streamPictures.ts).
 */
const BASE = `${DATA_BASE}sd/v1/`

interface Lattice {
  lon0: number
  lat0: number
  dLon: number
  dLat: number
  cols: number
  rows: number
}
interface Index {
  version: string
  lattice: Lattice
  tiles: Record<string, number>
}
interface Tile {
  header: BandHeader
  data: Map<string, Band>
}

let indexP: Promise<Index | null> | null = null
const loadIndex = () =>
  (indexP ??= fetch(`${BASE}index.json`)
    .then((r) => (r.ok ? (r.json() as Promise<Index>) : null))
    .catch(() => null))

// the tiles' files as they came, a few dozen: unpacked again when a block needs them
const packed = new Map<string, Promise<ArrayBuffer | null>>()
const KEEP = 24
function fetchTile(id: string): Promise<ArrayBuffer | null> {
  let p = packed.get(id)
  if (!p) {
    p = fetch(`${BASE}${id}.hab`)
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .catch(() => null)
    packed.set(id, p)
    if (packed.size > KEEP) packed.delete(packed.keys().next().value!)
  }
  return p
}

function typed(dtype: BandDef['dtype'], buf: ArrayBuffer): Band {
  if (dtype === 'uint8') return new Uint8Array(buf)
  if (dtype === 'int8') return new Int8Array(buf)
  if (dtype === 'uint16') return new Uint16Array(buf)
  if (dtype === 'int16') return new Int16Array(buf)
  return new Float32Array(buf)
}

async function unpack(buf: ArrayBuffer): Promise<Tile> {
  const u8 = new Uint8Array(buf)
  if (String.fromCharCode(...u8.subarray(0, 4)) !== 'HAB2') throw new Error('not a band file')
  const hlen = new DataView(buf).getUint32(4, true)
  const header = JSON.parse(new TextDecoder().decode(u8.subarray(8, 8 + hlen))) as BandHeader
  const start = 8 + hlen
  const defs = header.bands.filter((b) => !b.name.startsWith(PREVIEW))
  const outs = await Promise.all(
    defs.map((d) => new Response(new Blob([u8.subarray(start + d.cOff!, start + d.cOff! + d.cLen!)]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer()),
  )
  const data = new Map<string, Band>()
  defs.forEach((d, k) => data.set(d.name, typed(d.dtype, outs[k])))
  return { header, data }
}

/** A band's stored value for ground with no terrain of its own: the plain wind, open, flat, far from water. */
function plain(d: BandDef): number {
  const s = d.scale || 1
  const m = /^m([UV])(\d{3}\.\d)$/.exec(d.name)
  if (m) {
    // the momentum bands are the wind in units of the ambient, true axes: a wind FROM dir blows toward dir + 180
    const toward = ((parseFloat(m[2]) + 180) * Math.PI) / 180
    return Math.round((m[1] === 'U' ? Math.sin(toward) : Math.cos(toward)) / s)
  }
  if (d.name === 'nUe' || d.name === 'sUe' || d.name === 'nVn' || d.name === 'sVn') return Math.round(1 / s)
  if (d.name === 'canopy' || d.name === 'canopyBare') return Math.round(0.6 / s)
  if (d.name === 'shoreDist') return d.dtype === 'uint8' ? 255 : 0
  return 0
}

const ctor = { uint8: Uint8Array, int8: Int8Array, uint16: Uint16Array, int16: Int16Array, float32: Float32Array }

/** The block's tiles stitched into one grid on the lattice, cell for cell. */
function stitch(L: Lattice, i0: number, j0: number, tiles: (Tile | null)[][]): { grid: Habitat; mom: { scale: number; tScale: number; spreadRef: number } } | null {
  const have = tiles.flat().filter((t): t is Tile => !!t)
  if (!have.length) return null
  const h0 = have[0].header
  const n = tiles.length
  const C = L.cols
  const R = L.rows
  const cols = n * C
  const rows = n * R
  const defs = h0.bands.filter((b) => !b.name.startsWith(PREVIEW)).map((b) => ({ ...b, offset: 0 }))
  const header: BandHeader = {
    region: `sd-tiles ${i0}/${j0}`,
    generated: h0.generated,
    cols,
    rows,
    west: L.lon0 + i0 * C * L.dLon,
    north: L.lat0 - j0 * R * L.dLat,
    dLon: L.dLon,
    dLat: L.dLat,
    cellM: h0.cellM,
    coverNames: h0.coverNames,
    landformNames: h0.landformNames,
    lakes: [],
    bands: defs,
  }
  const grid = new Habitat(header)
  for (const d of defs) {
    const out = new ctor[d.dtype](cols * rows)
    out.fill(plain(d))
    tiles.forEach((row, tj) =>
      row.forEach((t, ti) => {
        const src = t?.data.get(d.name)
        if (!src) return
        for (let r = 0; r < R; r++) out.set(src.subarray(r * C, (r + 1) * C), (tj * R + r) * cols + ti * C)
      }),
    )
    grid.attach(d, out.buffer, 0)
  }
  const momOf = (t: Tile) => (t.header.model as { momentum?: { spreadRef?: number } } | undefined)?.momentum
  const refs = have.map((t) => momOf(t)?.spreadRef).filter((v): v is number => v != null).sort((a, b) => a - b)
  const scaleOf = (prefix: string) => defs.find((b) => b.name.startsWith(prefix))?.scale ?? 0
  return { grid, mom: { scale: scaleOf('mU'), tScale: scaleOf('mT'), spreadRef: refs.length ? refs[refs.length >> 1] : 0 } }
}

let block: { i0: number; j0: number } | null = null
let busy = false
let again = false

async function moved(map: MlMap): Promise<void> {
  if (busy) {
    again = true
    return
  }
  const c = map.getCenter()
  const inArea = c.lng > REGION.west && c.lng < REGION.east && c.lat > REGION.south && c.lat < REGION.north
  if (inArea || map.getZoom() < 9) {
    if (block) {
      useAreaGrid()
      block = null
      devlog('wind', 'SD tiles off: the area\'s own grid')
    }
    return
  }
  const idx = await loadIndex()
  if (!idx) return
  const L = idx.lattice
  // the view's centre in tiles, fractional
  const fx = (c.lng - L.lon0) / (L.cols * L.dLon)
  const fy = (L.lat0 - c.lat) / (L.rows * L.dLat)
  if (block && fx >= block.i0 + 0.5 && fx <= block.i0 + 1.5 && fy >= block.j0 + 0.5 && fy <= block.j0 + 1.5) return
  const i0 = Math.round(fx) - 1
  const j0 = Math.round(fy) - 1
  const ids = [0, 1].map((dj) => [0, 1].map((di) => `t-${i0 + di}-${j0 + dj}`))
  if (!ids.flat().some((id) => id in idx.tiles)) {
    if (block) {
      useAreaGrid()
      block = null
    }
    return
  }
  busy = true
  try {
    // the area's grid settled first, so nothing of its loading lands in the block's place
    await loadMicro()
    const t = performance.now()
    const tiles = await Promise.all(
      ids.map((row) =>
        Promise.all(
          row.map(async (id) => {
            if (!(id in idx.tiles)) return null
            const buf = await fetchTile(id)
            return buf ? unpack(buf) : null
          }),
        ),
      ),
    )
    const s = stitch(L, i0, j0, tiles)
    if (!s) return
    useMosaic(s.grid, s.mom)
    block = { i0, j0 }
    devlog('wind', `SD tiles ${ids.flat().filter((id) => id in idx.tiles).join(' ')} in the area grid's place · ${Math.round(performance.now() - t)} ms`)
    if (import.meta.env.DEV || import.meta.env.VITE_DEV_SITE) (window as unknown as { __windTiles?: unknown }).__windTiles = { block, ms: Math.round(performance.now() - t) }
  } catch (e) {
    devlog('wind', `SD tiles failed · ${(e as Error).message}`)
  } finally {
    busy = false
    if (again) {
      again = false
      void moved(map)
    }
  }
}

/** From the map's first load (MapView): on every settle, the tiles under the view past the box. */
export function initWindTiles(map: MlMap): void {
  // the dev site: the ground wind at a point (m/s east, north), for checks from outside
  if (import.meta.env.DEV || import.meta.env.VITE_DEV_SITE)
    (window as unknown as { __groundAt?: unknown }).__groundAt = (lon: number, lat: number) => {
      const s = groundSampler(Date.now())
      const out = new Float32Array(12)
      return s && s(lon, lat, out) ? [out[0], out[1], out[2]] : null
    }
  if (!STREAM_PICTURES) return
  map.on('moveend', () => void moved(map))
  void moved(map)
}
