import { areaById, type AreaDef } from '../areas'
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
 * Over Blanchard River that is about 10,300 tiles, 140 MB.
 */

/** the zooms fetched: the area's box from FROM to BOX_TO, its core on to the imagery's last */
const FROM = 8
const BOX_TO = 16
const CONCURRENCY = 8
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
  const t0 = performance.now()
  let next = 0
  let done = 0
  let ok = 0
  let bytes = 0
  const worker = async () => {
    while (next < urls.length) {
      const url = urls[next++]
      try {
        const r = await fetch(url, { priority: 'low' })
        if (r.ok) {
          bytes += (await r.arrayBuffer()).byteLength
          ok++
        }
      } catch {
        /* the signal gone part way, a timeout: a tile missed, fetched on the next save */
      }
      done++
      if (done % 25 === 0 || done === urls.length) progress(done, urls.length, bytes)
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
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

/** Take the area's sharp imagery off the phone, with its maps. */
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
  const cache = await caches.open(CACHE)
  for (const url of tileUrls(area, src)) await cache.delete(url)
}
