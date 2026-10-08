/**
 * Tiles read ahead while the map is quiet, so a pan or a notch of zoom
 * finds them ready. With the whole area on the phone a zoom in still took
 * 1.1 to 1.6 s to settle (2026-10-07, CPU slowed 4x): sixty to eighty slice
 * reads from the stored archives, each a trip into the file system, all
 * started only once the view had moved; and the live base map's tiles came
 * off the network every time. So, half a second after the map goes idle:
 *
 *  - for every stored archive with a layer showing, the tiles one ring out
 *    from the view at the zoom MapLibre draws it at (half a viewport each
 *    way), and the tiles under the middle of the view one zoom further in,
 *    read into a small memory cache the tile protocol answers from
 *    (pmtilesRegistry.ts warmTile);
 *  - for the live base map, the same ring, fetched so the worker's cache
 *    holds them (vite.config.ts live-tiles); none with data saving on.
 *
 * Archives read from the server are left alone: a ring of range requests
 * over a cell tower is not a favour. The run is budgeted, read four at a
 * time, and dropped the moment the map moves. Nothing starts until a few
 * seconds after the map's first settled frame, so the first view's grids
 * and heat have the phone to themselves.
 */
import type { Map as MlMap } from 'maplibre-gl'
import { devlog } from '../devlog'
import { LIVE_RASTER } from '../sources'
import { onEachMap, onFirstIdle } from './mapController'
import { sourceModes, warmHas, warmHits, warmTile } from './pmtilesRegistry'

const SETTLE_MS = 500
const FIRST_DELAY_MS = 4000
/** tiles read per quiet spell: the middle's zoom-in tiles and a viewport's ring for every source showing come to a couple of hundred */
const BUDGET = 256
const CONCURRENCY = 4
/** the ring: this much of the viewport's width and height each way (a thumb's pan is about a screen) */
const RING = 1.0
/** the live base map's ring, narrower: those tiles are data over a cell tower */
const RING_LIVE = 0.5
/** the middle of the view that a zoom in lands on, each way from the centre */
const CHILD_FRAC = 0.5

interface Job {
  kind: 'archive' | 'live'
  url: string
}

type Range = { z: number; x0: number; x1: number; y0: number; y1: number }

const RAD = Math.PI / 180
function tileX(lon: number, z: number): number {
  return Math.floor(((lon + 180) / 360) * 2 ** z)
}
function tileY(lat: number, z: number): number {
  const l = lat * RAD
  return Math.floor(((1 - Math.log(Math.tan(l) + 1 / Math.cos(l)) / Math.PI) / 2) * 2 ** z)
}

/** The tiles at z under a box, clamped to the world. */
function rangeOf(z: number, west: number, south: number, east: number, north: number): Range {
  const n = 2 ** z
  const clamp = (v: number) => Math.min(n - 1, Math.max(0, v))
  return { z, x0: clamp(tileX(west, z)), x1: clamp(tileX(east, z)), y0: clamp(tileY(north, z)), y1: clamp(tileY(south, z)) }
}

function* tilesIn(r: Range, except?: Range): Generator<[number, number, number]> {
  for (let y = r.y0; y <= r.y1; y++)
    for (let x = r.x0; x <= r.x1; x++) {
      if (except && except.z === r.z && x >= except.x0 && x <= except.x1 && y >= except.y0 && y <= except.y1) continue
      yield [r.z, x, y]
    }
}

interface SourceInfo {
  id: string
  kind: 'archive' | 'live'
  /** the archive's key in the protocol (pmtiles://<key>/…), or the live tile template */
  key: string
  tileSize: number
  round: boolean
  minzoom: number
  maxzoom: number
}

/** The sources with a layer showing at this zoom: stored archives, and the live base map. */
function sourcesShowing(map: MlMap): SourceInfo[] {
  const style = map.getStyle()
  if (!style?.sources) return []
  const zoom = map.getZoom()
  const out: SourceInfo[] = []
  for (const [id, src] of Object.entries(style.sources)) {
    if (src.type !== 'raster' && src.type !== 'raster-dem' && src.type !== 'vector') continue
    const showing = style.layers.some((l) => 'source' in l && l.source === id && l.layout?.visibility !== 'none' && (l.minzoom ?? 0) <= zoom && zoom < (l.maxzoom ?? 24))
    if (!showing) continue
    const url = 'url' in src ? src.url : undefined
    const tileSize = ('tileSize' in src && src.tileSize) || 512
    const round = src.type !== 'vector'
    const minzoom = ('minzoom' in src && src.minzoom) || 0
    const maxzoom = ('maxzoom' in src && src.maxzoom) || 22
    if (url?.startsWith('pmtiles://')) {
      const key = url.slice('pmtiles://'.length)
      if (sourceModes.get(key) !== 'local') continue
      out.push({ id, kind: 'archive', key, tileSize, round, minzoom, maxzoom })
    } else if (id === 'base' && 'tiles' in src && src.tiles?.[0] && src.tiles[0] === LIVE_RASTER.base?.tiles[0]) {
      if (!navigator.onLine) continue
      const conn = (navigator as unknown as { connection?: { saveData?: boolean } }).connection
      if (conn?.saveData) continue
      out.push({ id, kind: 'live', key: src.tiles[0], tileSize, round, minzoom, maxzoom })
    }
  }
  return out
}

/** The zoom MapLibre draws a source at for the map's zoom: raster rounds,
 *  vector floors, both a level up for 256 px tiles, inside the source's range. */
function drawZoom(s: SourceInfo, zoom: number): number {
  const z = zoom + Math.log2(512 / s.tileSize)
  return Math.min(s.maxzoom, Math.max(s.minzoom, s.round ? Math.round(z) : Math.floor(z)))
}

function jobsFor(map: MlMap): Job[] {
  const zoom = map.getZoom()
  const b = map.getBounds()
  const w = b.getWest()
  const e = b.getEast()
  const so = b.getSouth()
  const n = b.getNorth()
  const dx = (e - w) * RING
  const dy = (n - so) * RING
  const dxl = (e - w) * RING_LIVE
  const dyl = (n - so) * RING_LIVE
  const c = map.getCenter()
  const cx = ((e - w) * CHILD_FRAC) / 2
  const cy = ((n - so) * CHILD_FRAC) / 2
  const sources = sourcesShowing(map)
  const ring: (Job & { d: number })[] = []
  const children: Job[] = []
  const urlOf = (s: SourceInfo, z: number, x: number, y: number) =>
    s.kind === 'archive' ? `pmtiles://${s.key}/${z}/${x}/${y}` : s.key.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y))
  for (const s of sources) {
    const z = drawZoom(s, zoom)
    const view = rangeOf(z, w, so, e, n)
    const far = s.kind === 'live' ? rangeOf(z, w - dxl, so - dyl, e + dxl, n + dyl) : rangeOf(z, w - dx, so - dy, e + dx, n + dy)
    for (const [tz, x, y] of tilesIn(far, view)) {
      const url = urlOf(s, tz, x, y)
      if (s.kind === 'archive' && warmHas(url)) continue
      // how far out of the view, in tiles: the nearest ring first
      const d = Math.max(view.x0 - x, x - view.x1, view.y0 - y, y - view.y1, 0)
      ring.push({ kind: s.kind, url, d })
    }
    // one zoom in, under the middle of the view: stored archives only (the base map's would be data for a maybe)
    if (s.kind !== 'archive') continue
    const z1 = drawZoom(s, zoom + 1)
    if (z1 <= z) continue
    for (const [tz, x, y] of tilesIn(rangeOf(z1, c.lng - cx, c.lat - cy, c.lng + cx, c.lat + cy))) {
      const url = urlOf(s, tz, x, y)
      if (!warmHas(url)) children.push({ kind: s.kind, url })
    }
  }
  // the zoom-in tiles first (a notch in was the slow move), then the ring from the inside out
  ring.sort((a, b) => a.d - b.d)
  return [...children, ...ring.map(({ kind, url }) => ({ kind, url }))].slice(0, BUDGET)
}

let ctl: AbortController | null = null
let timer: number | null = null

function cancel() {
  if (timer != null) {
    window.clearTimeout(timer)
    timer = null
  }
  ctl?.abort()
  ctl = null
}

async function run(map: MlMap) {
  if (document.visibilityState !== 'visible') return
  const jobs = jobsFor(map)
  if (!jobs.length) return
  const mine = new AbortController()
  ctl = mine
  const t0 = performance.now()
  let done = 0
  let next = 0
  const worker = async () => {
    while (next < jobs.length && !mine.signal.aborted) {
      const j = jobs[next++]
      try {
        if (j.kind === 'archive') await warmTile(j.url, mine)
        else {
          const r = await fetch(j.url, { signal: mine.signal, priority: 'low' })
          if (r.ok) await r.arrayBuffer()
        }
        done++
      } catch {
        /* a tile the archive lacks, a read past its deadline, or the move that stopped us */
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  if (ctl === mine) ctl = null
  if (!mine.signal.aborted) devlog('data', `read ahead · ${done} of ${jobs.length} tiles · ${(performance.now() - t0).toFixed(0)} ms · ${warmHits()} hits so far`)
}

let wired = false
export function initTilePrefetch(): void {
  if (wired) return
  wired = true
  // a switch for measuring without it (localStorage huntapp-prefetch = off)
  try {
    if (localStorage.getItem('huntapp-prefetch') === 'off') return
  } catch {
    /* ignore */
  }
  onEachMap((map) => {
    let armed = false
    const schedule = () => {
      if (!armed || timer != null) return
      timer = window.setTimeout(() => {
        timer = null
        void run(map)
      }, SETTLE_MS)
    }
    onFirstIdle(map, () => {
      window.setTimeout(() => {
        armed = true
        schedule()
      }, FIRST_DELAY_MS)
    })
    map.on('idle', schedule)
    map.on('movestart', cancel)
    map.on('zoomstart', cancel)
    map.once('remove', () => {
      cancel()
      map.off('idle', schedule)
    })
  })
}
