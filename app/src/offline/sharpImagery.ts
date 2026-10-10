import { AREA_LIST, areaById, type AreaDef } from '../areas'
import { devlog } from '../devlog'
import { rangeOf, tilesIn } from '../map/prefetch'
import { SHARP, type LiveRaster } from '../sources'

/**
 * The sharp imagery fetched across an area when its maps are saved (Gavan,
 * 2026-10-09: "if you click download, can you also fire off a pan around
 * the area at each zoom level. That way it's cached on the device. Not our
 * servers."). Every tile of the area's box to zoom 16, and of its core on to
 * the imagery's last zoom, is fetched by the phone from the imagery's own
 * server, and the app's worker keeps them (vite.config.ts imagery-tiles):
 * the same tiles a pan at each zoom would ask for, without drawing them.
 * Over Blanchard River that is about 10,300 tiles, 130 MB.
 *
 * Esri answers a tile in about 150 ms however fast the line, and speaks only
 * HTTP/1.1, so a browser holds six connections to it: six tiles at a time
 * whatever the count asked for (5.3 min for Blanchard River, measured cold
 * 2026-10-09). Its second name serves the same bytes to any page, so every
 * other tile is asked of it, six more at a time, and kept under the name
 * the map asks for (2.9 min).
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
/** the worker's cache (vite.config.ts) */
const CACHE = 'imagery-tiles'
/** the share of tiles that may not come (the odd timeout) and the save still count */
const MAY_MISS = 0.02

const savedKey = (areaId: string) => `huntapp-sharp-saved:${areaId}`

/** The area's sharp imagery, if it has any. */
export function sharpOf(areaId: string): LiveRaster | null {
  const s = areaById(areaId)?.live.sharp
  return s ? SHARP[s] : null
}

function tileUrls(area: AreaDef, src: LiveRaster): string[] {
  const top = src.maxzoom ?? BOX_TO
  const urls: string[] = []
  for (let z = FROM; z <= top; z++) {
    const b = z <= BOX_TO ? area.region : area.core
    for (const [tz, x, y] of tilesIn(rangeOf(z, b.west, b.south, b.east, b.north)))
      urls.push(src.tiles[0].replace('{z}', String(tz)).replace('{x}', String(x)).replace('{y}', String(y)))
  }
  return urls
}

/** The worker keeps what is fetched; without one (the dev server, a first
 *  open before it took over) the tiles would have nowhere to stay. */
export function canKeepSharp(): boolean {
  return !!navigator.serviceWorker?.controller
}

/** The area's sharp imagery was fetched across it (or it has none). */
export function sharpSaved(areaId: string): boolean {
  const src = sharpOf(areaId)
  if (!src) return true
  try {
    const j = JSON.parse(localStorage.getItem(savedKey(areaId)) ?? 'null') as { url?: string } | null
    return j?.url === src.tiles[0]
  } catch {
    return false
  }
}

/** What fetching it would bring, bytes, before it is fetched: 0 when saved or none. */
export function sharpBytes(areaId: string): number {
  const area = areaById(areaId)
  const src = sharpOf(areaId)
  if (!area || !src || sharpSaved(areaId)) return 0
  return tileUrls(area, src).length * TILE_BYTES
}

/** Fetch the area's sharp imagery tile by tile, `progress` as it goes.
 *  Tiles the phone has already come back from the worker at once. Null when
 *  there is none, or nowhere to keep it. */
export async function saveSharp(areaId: string, progress: (done: number, total: number, bytes: number) => void): Promise<{ ok: number; total: number } | null> {
  const area = areaById(areaId)
  const src = sharpOf(areaId)
  if (!area || !src) return null
  if (!canKeepSharp()) {
    devlog('data', 'sharp imagery · no service worker to keep it, not fetched')
    return null
  }
  const urls = tileUrls(area, src)
  const cache = 'caches' in window ? await caches.open(CACHE) : null
  const t0 = performance.now()
  let next = 0
  let done = 0
  let ok = 0
  let bytes = 0
  /** One tile: through the worker, which keeps it (its first name); or asked of
   *  the second name, which the worker does not watch, and kept here under the first */
  const one = async (url: string, alt: boolean): Promise<number> => {
    if (!alt || !cache || !url.startsWith(HOST)) {
      const r = await fetch(url, { priority: 'low' })
      return r.ok ? (await r.arrayBuffer()).byteLength : -1
    }
    const kept = await cache.match(url)
    if (kept) return Number(kept.headers.get('content-length')) || TILE_BYTES
    const r = await fetch(ALT_HOST + url.slice(HOST.length), { priority: 'low' })
    if (!r.ok) return -1
    const body = await r.arrayBuffer()
    await cache.put(url, new Response(body, { status: r.status, statusText: r.statusText, headers: r.headers }))
    return body.byteLength
  }
  const worker = async (k: number) => {
    while (next < urls.length) {
      const url = urls[next++]
      try {
        const n = await one(url, k % 2 === 1)
        if (n >= 0) {
          bytes += n
          ok++
        }
      } catch {
        /* the signal gone part way, a timeout: a tile missed, fetched on the next save */
      }
      done++
      if (done % 25 === 0 || done === urls.length) progress(done, urls.length, bytes)
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, (_, k) => worker(k)))
  if (ok >= urls.length * (1 - MAY_MISS)) {
    try {
      localStorage.setItem(savedKey(areaId), JSON.stringify({ url: src.tiles[0], tiles: urls.length, at: new Date().toISOString() }))
    } catch {
      /* storage refused: the next save fetches them again, from the worker's cache */
    }
  }
  devlog('data', `sharp imagery · ${area.id} · ${ok} of ${urls.length} tiles · ${(bytes / 1e6).toFixed(0)} MB · ${((performance.now() - t0) / 1000).toFixed(0)} s`)
  return { ok, total: urls.length }
}

/** About what the area's saved sharp imagery takes on the phone, bytes: 0 when not saved. */
export function sharpKeptBytes(areaId: string): number {
  if (!sharpOf(areaId) || !sharpSaved(areaId)) return 0
  try {
    const j = JSON.parse(localStorage.getItem(savedKey(areaId)) ?? 'null') as { tiles?: number } | null
    return (j?.tiles ?? 0) * TILE_BYTES
  } catch {
    return 0
  }
}

/** Take the area's sharp imagery off the phone, alone or with its maps.
 *  The worker's cache holds the sharp imagery alone: with no other area's
 *  saved it goes whole, at once. Otherwise the area's tiles go twelve at a
 *  time, less any another saved area's needs too (one by one, Blanchard
 *  River's 10,300 would take minutes). */
export async function removeSharp(areaId: string): Promise<void> {
  const area = areaById(areaId)
  const src = sharpOf(areaId)
  if (!area || !src) return
  try {
    localStorage.removeItem(savedKey(areaId))
  } catch {
    /* ignore */
  }
  if (!('caches' in window)) return
  const t0 = performance.now()
  const others = AREA_LIST.filter((a) => a.id !== areaId && sharpOf(a.id) && sharpSaved(a.id))
  if (!others.length) {
    await caches.delete(CACHE)
    devlog('data', `sharp imagery · ${area.id} removed · the whole cache · ${Math.round(performance.now() - t0)} ms`)
    return
  }
  const keep = new Set(others.flatMap((a) => tileUrls(a, sharpOf(a.id)!)))
  const urls = tileUrls(area, src).filter((u) => !keep.has(u))
  const cache = await caches.open(CACHE)
  let next = 0
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < urls.length) await cache.delete(urls[next++])
    }),
  )
  devlog('data', `sharp imagery · ${area.id} removed · ${urls.length} tiles · ${((performance.now() - t0) / 1000).toFixed(1)} s`)
}
