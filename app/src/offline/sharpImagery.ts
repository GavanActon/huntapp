import { AREA_LIST, areaById, type AreaDef } from '../areas'
import { devlog } from '../devlog'
import { forgetSharpPack, sharpPackFile } from '../map/pmtilesRegistry'
import { rangeOf, tilesIn } from '../map/prefetch'
import { SHARP, type LiveRaster } from '../sources'
import { deleteStoredFile, manifestGet } from './fileStore'
import { discardPieces, TilePack } from './tilePack'

/**
 * The sharp imagery fetched across an area when its maps are saved (Gavan,
 * 2026-10-09: "if you click download, can you also fire off a pan around
 * the area at each zoom level. That way it's cached on the device. Not our
 * servers."). Every tile of the area's box to zoom 16, and of its core on to
 * the imagery's last zoom, is fetched by the phone from the imagery's own
 * server: the same tiles a pan at each zoom would ask for, without drawing
 * them. Over Blanchard River that is about 10,300 tiles, 130 MB.
 *
 * They are kept as one archive, the area's pack (tilePack.ts), which the map
 * reads through sharp:// (map/pmtilesRegistry.ts) like any baked layer. Kept
 * one by one in the worker's cache, as they were from 2026-10-09, 18,000 of
 * them made a cold start on an iPhone wait 10 to 16 s before the app's first
 * line (0.5 s the day before): Safari opens the whole cache store before the
 * worker can serve the app's own files. A phone still holding tiles kept that
 * way packs them on its next save without the network, and they go.
 *
 * Esri answers a tile in about 150 ms however fast the line, and speaks only
 * HTTP/1.1, so a browser holds six connections to it: six tiles at a time
 * whatever the count asked for (5.3 min for Blanchard River, measured cold
 * 2026-10-09). Its second name serves the same bytes to any page, so every
 * other tile is asked of it, six more at a time (2.9 min).
 */

/** the zooms fetched: the area's box from FROM to BOX_TO, its core on to the imagery's last */
const FROM = 8
const BOX_TO = 16
/** six connections to each of Esri's two names */
const CONCURRENCY = 12
/** Esri's own two names for the one imagery service */
const HOST = 'https://server.arcgisonline.com/'
const ALT_HOST = 'https://services.arcgisonline.com/'
/** a tile's bytes, for the size before it is fetched (Esri over Blanchard River: 12-16 KB) */
const TILE_BYTES = 14_000
/** the share of tiles that may not come (the odd timeout) and the save still count */
const MAY_MISS = 0.02
/** Esri's imagery is JPEG (PMTiles spec v3 tile type) */
const JPEG = 3
/** the worker's cache the tiles were kept in, one by one, before packs */
const LEGACY = 'imagery-tiles'
/** on a tile asked for a pack, so the worker leaves it alone (vite.config.ts): the pack keeps it */
const PACK_MARK = 'gwpack=1'

/** What was saved: the imagery's address, its tiles, and `pack` (absent: kept one by one in the worker's cache) */
const savedKey = (areaId: string) => `huntapp-sharp-saved:${areaId}`
interface Saved {
  url?: string
  tiles?: number
  pack?: boolean
}
function savedOf(areaId: string): Saved | null {
  try {
    return JSON.parse(localStorage.getItem(savedKey(areaId)) ?? 'null') as Saved | null
  } catch {
    return null
  }
}

/** The area's sharp imagery, if it has any. */
export function sharpOf(areaId: string): LiveRaster | null {
  const s = areaById(areaId)?.live.sharp
  return s ? SHARP[s] : null
}

const remoteOf = (src: LiveRaster) => src.remote ?? src.tiles[0]
const urlOf = (src: LiveRaster, z: number, x: number, y: number) =>
  remoteOf(src).replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y))

function tilesFor(area: AreaDef, src: LiveRaster): [number, number, number][] {
  const top = src.maxzoom ?? BOX_TO
  const out: [number, number, number][] = []
  for (let z = FROM; z <= top; z++) {
    const b = z <= BOX_TO ? area.region : area.core
    for (const t of tilesIn(rangeOf(z, b.west, b.south, b.east, b.north))) out.push(t)
  }
  return out
}

/** Somewhere to keep a pack: the phone's file storage, else the cache store (one file either way). */
export function canKeepSharp(): boolean {
  return !!navigator.storage?.getDirectory || typeof caches !== 'undefined'
}

/** The area's sharp imagery is on the phone as a pack (or it has none). */
export function sharpSaved(areaId: string): boolean {
  const src = sharpOf(areaId)
  if (!src) return true
  const s = savedOf(areaId)
  return !!s?.pack && s.url === remoteOf(src) && !!manifestGet(sharpPackFile(areaId))
}

/** What fetching it would bring, bytes, before it is fetched: 0 when saved or none. */
export function sharpBytes(areaId: string): number {
  const area = areaById(areaId)
  const src = sharpOf(areaId)
  if (!area || !src || sharpSaved(areaId)) return 0
  return tilesFor(area, src).length * TILE_BYTES
}

/** What the area's saved sharp imagery takes on the phone, bytes: 0 when not saved. */
export function sharpKeptBytes(areaId: string): number {
  return sharpSaved(areaId) ? (manifestGet(sharpPackFile(areaId))?.size ?? 0) : 0
}

/** Fetch the area's sharp imagery tile by tile into its pack, `progress` as it
 *  goes. Tiles a save cut short kept, and tiles kept one by one before packs,
 *  are not fetched again. Null when there is none, or nowhere to keep it. */
export async function saveSharp(areaId: string, progress: (done: number, total: number, bytes: number) => void): Promise<{ ok: number; total: number } | null> {
  const area = areaById(areaId)
  const src = sharpOf(areaId)
  if (!area || !src) return null
  if (!canKeepSharp()) {
    devlog('data', 'sharp imagery · nowhere on the phone to keep it, not fetched')
    return null
  }
  const tiles = tilesFor(area, src)
  const pack = await TilePack.open(sharpPackFile(areaId))
  const resumed = pack.done.tiles
  const legacy = typeof caches !== 'undefined' && (await caches.has(LEGACY)) ? await caches.open(LEGACY) : null
  const t0 = performance.now()
  let next = 0
  let done = 0
  let ok = 0
  let stop: unknown = null
  /** One tile into the pack: kept already, from the worker's old cache, or asked of
   *  Esri (every other one of its second name), marked so the worker does not keep it too */
  const one = async (z: number, x: number, y: number, alt: boolean): Promise<boolean> => {
    if (pack.has(z, x, y)) return true
    const url = urlOf(src, z, x, y)
    const kept = legacy ? await legacy.match(url) : undefined
    let body: ArrayBuffer
    if (kept?.ok) body = await kept.arrayBuffer()
    else {
      const ask = alt && url.startsWith(HOST) ? ALT_HOST + url.slice(HOST.length) : `${url}${url.includes('?') ? '&' : '?'}${PACK_MARK}`
      const r = await fetch(ask, { priority: 'low' })
      if (!r.ok) return false
      body = await r.arrayBuffer()
    }
    await pack.add(z, x, y, body)
    return true
  }
  const worker = async (k: number) => {
    while (next < tiles.length && !stop) {
      const [z, x, y] = tiles[next++]
      try {
        if (await one(z, x, y, k % 2 === 1)) ok++
      } catch (e) {
        // no room to keep them stops the save; a tile the signal dropped is fetched on the next
        if ((e as Error)?.message?.startsWith('no room')) stop = e
      }
      done++
      if (done % 25 === 0 || done === tiles.length) progress(done, tiles.length, pack.done.bytes)
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, (_, k) => worker(k)))
  if (stop) throw stop
  await pack.flush()
  let size = 0
  if (ok >= tiles.length * (1 - MAY_MISS)) {
    size = await pack.finish({
      tileType: JPEG,
      bounds: [area.region.west, area.region.south, area.region.east, area.region.north],
      metadata: { name: `${area.name} sharp imagery`, attribution: src.attribution, source: remoteOf(src), tiles: ok, saved: new Date().toISOString() },
    })
    try {
      localStorage.setItem(savedKey(areaId), JSON.stringify({ url: remoteOf(src), tiles: ok, pack: true, at: new Date().toISOString() }))
    } catch {
      /* storage refused: the pack is there, and the next save finds its tiles in it */
    }
    forgetSharpPack()
    await dropLegacy(area, src)
  }
  devlog(
    'data',
    `sharp imagery · ${area.id} · ${ok} of ${tiles.length} tiles${resumed ? ` (${resumed} kept from before)` : ''} · ${(pack.done.bytes / 1e6).toFixed(0)} MB · ${((performance.now() - t0) / 1000).toFixed(0)} s${size ? ` · packed, ${(size / 1e6).toFixed(0)} MB` : ' · not all came: the next save goes on'}`,
  )
  return { ok, total: tiles.length }
}

/** Take the area's sharp imagery off the phone, alone or with its maps: its
 *  pack, a save's pieces, and any of its tiles kept one by one before packs. */
export async function removeSharp(areaId: string): Promise<void> {
  const area = areaById(areaId)
  const src = sharpOf(areaId)
  if (!area || !src) return
  try {
    localStorage.removeItem(savedKey(areaId))
  } catch {
    /* ignore */
  }
  const file = sharpPackFile(areaId)
  await deleteStoredFile(file)
  await discardPieces(file)
  forgetSharpPack()
  await dropLegacy(area, src)
}

/**
 * The area's tiles kept one by one in the worker's cache, from before packs.
 * With no other area's kept that way the cache goes whole, at once (the
 * worker's few viewed tiles with it); else the area's tiles go twelve at a
 * time, less any another's needs (one by one, Blanchard River's 10,300 took
 * minutes).
 */
async function dropLegacy(area: AreaDef, src: LiveRaster): Promise<void> {
  if (typeof caches === 'undefined' || !(await caches.has(LEGACY))) return
  const t0 = performance.now()
  const others = AREA_LIST.filter((a) => {
    if (a.id === area.id || !sharpOf(a.id)) return false
    const s = savedOf(a.id)
    return !!s && !s.pack
  })
  if (!others.length) {
    await caches.delete(LEGACY)
    devlog('data', `sharp imagery · ${area.id} · the old tile cache gone whole · ${Math.round(performance.now() - t0)} ms`)
    return
  }
  const keep = new Set(others.flatMap((a) => tilesFor(a, sharpOf(a.id)!).map(([z, x, y]) => urlOf(sharpOf(a.id)!, z, x, y))))
  const urls = tilesFor(area, src)
    .map(([z, x, y]) => urlOf(src, z, x, y))
    .filter((u) => !keep.has(u))
  const cache = await caches.open(LEGACY)
  let next = 0
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < urls.length) await cache.delete(urls[next++])
    }),
  )
  devlog('data', `sharp imagery · ${area.id} · ${urls.length} old tiles taken out of the worker's cache · ${((performance.now() - t0) / 1000).toFixed(1)} s`)
}
