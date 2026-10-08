import maplibregl from 'maplibre-gl'
import { FetchSource, PMTiles, Protocol } from 'pmtiles'
import type { RangeResponse, Source } from 'pmtiles'
import { devlog } from '../devlog'
import { fileUrl } from '../areas'
import { DATA_FILES } from '../config'
import { getStoredFile } from '../offline/fileStore'
import { noteAbsent, offlineReady } from '../offline/updates'

/**
 * All chart data is PMTiles referenced in the style as `pmtiles://<key>`.
 * Each key resolves to either a locally stored Blob (OPFS/Cache — offline)
 * or a network FetchSource, whichever is available.
 */

class BlobSource implements Source {
  private blob: Blob
  private key: string
  constructor(blob: Blob, key: string) {
    this.blob = blob
    this.key = key
  }
  getKey() {
    return this.key
  }
  async getBytes(offset: number, length: number): Promise<RangeResponse> {
    // a slice of a stored archive can fail to read under memory pressure —
    // Safari rejects the arrayBuffer — or simply never answer, and a read
    // that never answers is a tile that stays "loading" forever: a hole
    // with no error, and one of the few requests MapLibre runs at once
    // gone for good. So every read has a deadline, and a miss is retried
    // twice before the tile counts as failed (the map asks again later).
    let last: unknown = null
    for (let attempt = 0; attempt < 3; attempt++) {
      const started = Date.now()
      inFlight.add(started)
      try {
        const data = await withDeadline(this.blob.slice(offset, offset + length).arrayBuffer(), READ_DEADLINE_MS)
        const took = Date.now() - started
        if (took > SLOW_READ_MS) devlog('data', `${this.key} slow read · ${took} ms`)
        return { data }
      } catch (e) {
        last = e
        devlog('data', `${this.key} read ${attempt + 1} failed at ${offset} · ${(e as Error)?.message ?? e}`)
        await new Promise((r) => setTimeout(r, 150 * (attempt + 1)))
      } finally {
        inFlight.delete(started)
      }
    }
    throw last instanceof Error ? last : new Error('archive read failed')
  }
}

/** A read of a stored archive that takes longer than this is given up on. */
const READ_DEADLINE_MS = 10_000
const SLOW_READ_MS = 2000
/** Start times of reads under way, for the log's word on reads that hang. */
const inFlight = new Set<number>()

function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`read timed out after ${ms / 1000} s`)), ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      },
    )
  })
}

// every half minute while the app is in front: reads that have been going
// too long are worth a line before their deadline decides
setInterval(() => {
  if (document.visibilityState !== 'visible' || !inFlight.size) return
  const now = Date.now()
  const oldest = Math.min(...inFlight)
  if (now - oldest > SLOW_READ_MS) devlog('data', `${inFlight.size} reads in flight · oldest ${((now - oldest) / 1000).toFixed(1)} s`)
}, 30_000)

class KeyedFetchSource implements Source {
  private inner: FetchSource
  private key: string
  constructor(url: string, key: string) {
    this.inner = new FetchSource(url)
    this.key = key
  }
  getKey() {
    return this.key
  }
  getBytes(offset: number, length: number, signal?: AbortSignal, etag?: string) {
    return this.inner.getBytes(offset, length, signal, etag)
  }
}

const protocol = new Protocol()
/**
 * A picture tile the archive does not hold is answered as not found. The
 * areas are baked deep only in their core: zoomed in outside it, the topo,
 * imagery and DEM have no tile, and pmtiles answered "no data", which left
 * MapLibre's tile loading for good. It drew nothing (grey, the relief and
 * shade gone over a whole tile at Lac Bailey's edge: Gavan, 2026-10-07)
 * unless it happened to hold the coarser tile from zooming in there. A 404
 * makes it fetch the parent and stretch it, the detail the edge has anyway.
 * A missing vector tile still comes back empty: no features, drawn as such.
 */
maplibregl.addProtocol('pmtiles', async (params, abortController) => {
  const hit = warmTake(params.url)
  if (hit) return hit
  const r = await protocol.tilev4(params, abortController)
  if (r.data == null) throw Object.assign(new Error(`no tile ${params.url}`), { status: 404 })
  return r
})

// ---- tiles read ahead (prefetch.ts): a small memory cache in front of the protocol ----

interface Warm {
  data: ArrayBuffer
  cacheControl?: string
  expires?: string
}
const warm = new Map<string, Warm>()
let warmBytes = 0
/** how much read-ahead is kept: raster tiles run 20–60 KB, so a few hundred */
const WARM_CAP = 24 << 20

export function warmHas(url: string): boolean {
  return warm.has(url)
}

let hits = 0
/** tiles the map took from the warm cache this run (the devlog's measure of the read-ahead) */
export function warmHits(): number {
  return hits
}

/** A warm tile for the map, moved to the back of the line (the least recently asked for goes first). */
function warmTake(url: string): Warm | null {
  const w = warm.get(url)
  if (!w) return null
  hits++
  warm.delete(url)
  warm.set(url, w)
  return w
}

/** Read a tile into the warm cache (nothing for one the archive lacks). */
export async function warmTile(url: string, abortController: AbortController): Promise<void> {
  if (warm.has(url)) return
  const r = await protocol.tilev4({ url, type: 'arrayBuffer' }, abortController)
  const data = r.data as ArrayBuffer | null | undefined
  if (!data) return
  warm.set(url, { data, cacheControl: r.cacheControl, expires: r.expires })
  warmBytes += data.byteLength
  for (const [k, v] of warm) {
    if (warmBytes <= WARM_CAP) break
    warm.delete(k)
    warmBytes -= v.data.byteLength
  }
}

export type DataSourceMode = 'local' | 'network' | 'missing'

/** key -> where the archive is being read from */
export const sourceModes = new Map<string, DataSourceMode>()

function absoluteDataUrl(file: string): string {
  return new URL(fileUrl(file), window.location.href).toString()
}

/** (Re)register one data file, preferring local storage. `known`: whether
 *  the server's file list has it (offline/updates.ts bootManifest). A
 *  stored copy is probed (its header read, a torn file found out); a file
 *  the list has is trusted, its header read with its first tile, which
 *  spares the 16 KB probe each of fifteen archives cost before the map
 *  could be made; one the list lacks is missing; with no list, the probe. */
export async function registerDataFile(key: string, file: string, known: boolean | null = null): Promise<DataSourceMode> {
  const blob = await getStoredFile(file)
  if (!blob && known === false) {
    sourceModes.set(key, 'missing')
    return 'missing'
  }
  const source: Source = blob
    ? new BlobSource(blob, key)
    : new KeyedFetchSource(absoluteDataUrl(file), key)
  const p = new PMTiles(source)
  let mode: DataSourceMode = blob ? 'local' : 'network'
  if (blob || !known) {
    try {
      await p.getHeader()
    } catch {
      mode = 'missing'
    }
  }
  if (mode !== 'missing') protocol.add(p)
  sourceModes.set(key, mode)
  return mode
}

/** Register every configured data file. Returns the set of available source
 *  keys. `known`: the files the server lists, when the list has been seen. */
export async function registerAllDataFiles(known: Set<string> | null = null): Promise<Set<string>> {
  const available = new Set<string>()
  await Promise.all(
    DATA_FILES.map(async (d) => {
      const mode = await registerDataFile(d.key, d.file, known ? known.has(d.file) : null)
      if (mode !== 'missing') available.add(d.key)
    }),
  )
  return available
}

export function allDataLocal(): boolean {
  return DATA_FILES.every((d) => sourceModes.get(d.key) === 'local')
}

/** Every map the area's offline bundle can hold is on the phone: its
 *  archives, its GeoJSON and its grids (offline/updates.ts offlineReady).
 *  Files the server itself does not have (never baked) cannot be saved, so
 *  they do not count: an archive that does not answer is noted while
 *  online, since offline every unsaved file looks missing. */
export function offlineComplete(): boolean {
  if (navigator.onLine) noteAbsent(DATA_FILES.filter((d) => sourceModes.get(d.key) === 'missing').map((d) => d.file))
  return offlineReady()
}

/** Look up the depth (metres, positive down) at a lon/lat from the contour tiles' bathy grid.
 *  Placeholder for now — implemented via querying the depth raster is not possible client-side,
 *  so depth readout uses the contour vector features near the point instead (see MapView).
 */
export function getProtocol(): Protocol {
  return protocol
}
