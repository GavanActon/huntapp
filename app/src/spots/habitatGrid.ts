/**
 * The habitat grid the pipeline bakes (build_habitat.py): a 30 m lattice
 * over the region with a couple of dozen bands: elevation, slope, aspect,
 * landform, cover class, stand age, distances to water, cover, browse and
 * roads, lake id, estimated depth, fetch by wind direction. One gzipped
 * file, kept on the phone with the map bundle, so the Spots tab works at
 * camp with no signal.
 *
 * Format: gzip( u32 header-length · JSON header · bands… ). The header
 * lists every band with dtype, byte offset and scale; nothing here is
 * hard-coded to the bake's band order.
 */
import { fileUrl } from '../areas'
import { REGION, habitatFile } from '../config'
import { devlog } from '../devlog'
import { getStoredFile } from '../offline/fileStore'
import { trackResponse } from '../offline/loadProgress'
import type { FromUnzip, ToUnzip } from './unzipWorker'

export interface LakeFacts {
  id: number
  name: string | null
  areaHa: number
  fetchMaxM: number
  maxDepth: number | null
  meanDepth: number | null
  secchi: number | null
  species: string[]
  depthModel: { k: number; shoreMaxM: number } | null
  /** set when depths come from the lake's MNR survey sheet (pipeline/survey_depth.py) */
  depthSurvey?: { sheet: string; max: number | null }
}

interface BandDef {
  name: string
  dtype: 'int8' | 'uint8' | 'uint16' | 'int16' | 'float32'
  scale: number
  offset: number
  meaning: string
}

interface Header {
  region: string
  generated: string
  cols: number
  rows: number
  west: number
  north: number
  dLon: number
  dLat: number
  cellM: [number, number]
  coverNames: string[]
  landformNames: string[]
  lakes: LakeFacts[]
  bands: BandDef[]
}

export type Band = Int8Array | Uint8Array | Uint16Array | Int16Array | Float32Array

export const COVER = {
  nodata: 0,
  water: 1,
  openWet: 2,
  treedWet: 3,
  coniferDense: 4,
  coniferOpen: 5,
  mixed: 6,
  hardwood: 7,
  shrub: 8,
  regen: 9,
  barren: 10,
  road: 11,
} as const

export const LANDFORM = { flat: 0, ridge: 1, valley: 2, saddle: 3, bench: 4, peak: 5, slope: 6 } as const

export class Habitat {
  readonly cols: number
  readonly rows: number
  readonly west: number
  readonly north: number
  readonly dLon: number
  readonly dLat: number
  /** metres per cell, x and y */
  readonly cellM: [number, number]
  readonly coverNames: string[]
  readonly landformNames: string[]
  readonly lakes: LakeFacts[]
  readonly generated: string
  private bands = new Map<string, { data: Band; scale: number }>()

  constructor(h: Header, buf: ArrayBuffer, base: number) {
    this.cols = h.cols
    this.rows = h.rows
    this.west = h.west
    this.north = h.north
    this.dLon = h.dLon
    this.dLat = h.dLat
    this.cellM = h.cellM
    this.coverNames = h.coverNames
    this.landformNames = h.landformNames
    this.lakes = h.lakes
    this.generated = h.generated
    const n = h.cols * h.rows
    for (const b of h.bands) {
      const off = base + b.offset
      let data: Band
      if (b.dtype === 'uint8') data = new Uint8Array(buf, off, n)
      else if (b.dtype === 'int8') data = new Int8Array(buf, off, n)
      else if (b.dtype === 'uint16') data = new Uint16Array(buf.slice(off, off + n * 2))
      else if (b.dtype === 'int16') data = new Int16Array(buf.slice(off, off + n * 2))
      else data = new Float32Array(buf.slice(off, off + n * 4))
      this.bands.set(b.name, { data, scale: b.scale })
    }
  }

  get size(): number {
    return this.cols * this.rows
  }

  /** Raw band values (unscaled). Throws for a band the bake did not write. */
  raw(name: string): Band {
    const b = this.bands.get(name)
    if (!b) throw new Error(`habitat: no band ${name}`)
    return b.data
  }
  has(name: string): boolean {
    return this.bands.has(name)
  }
  scale(name: string): number {
    return this.bands.get(name)?.scale ?? 1
  }
  /** Scaled value of a band at a cell. */
  value(name: string, i: number): number {
    const b = this.bands.get(name)
    if (!b) return NaN
    return b.data[i] * b.scale
  }

  index(lon: number, lat: number): number {
    const c = Math.floor((lon - this.west) / this.dLon)
    const r = Math.floor((this.north - lat) / this.dLat)
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows) return -1
    return r * this.cols + c
  }
  rc(i: number): [number, number] {
    return [Math.floor(i / this.cols), i % this.cols]
  }
  center(i: number): [number, number] {
    const [r, c] = this.rc(i)
    return [this.west + (c + 0.5) * this.dLon, this.north - (r + 0.5) * this.dLat]
  }
  /** Cell index a distance (m) away on a compass bearing, or -1 off-grid. */
  offset(i: number, bearingDeg: number, metres: number): number {
    const [r, c] = this.rc(i)
    const rad = (bearingDeg * Math.PI) / 180
    const dc = Math.round((Math.sin(rad) * metres) / this.cellM[0])
    const dr = Math.round((-Math.cos(rad) * metres) / this.cellM[1])
    const rr = r + dr
    const cc = c + dc
    if (rr < 0 || cc < 0 || rr >= this.rows || cc >= this.cols) return -1
    return rr * this.cols + cc
  }
  lake(id: number): LakeFacts | undefined {
    return this.lakes.find((l) => l.id === id)
  }
}

let loaded: Habitat | null = null
let inflight: Promise<Habitat | null> | null = null
const listeners = new Set<(h: Habitat) => void>()

function gunzipHere(blob: Blob): Promise<ArrayBuffer> {
  const ds = new DecompressionStream('gzip')
  return new Response(blob.stream().pipeThrough(ds)).arrayBuffer()
}

// The unzipping goes to a worker (unzipWorker.ts). A worker that cannot
// start (an old browser, its file missing from an offline cache) hands
// what it holds back to be unzipped here, and none is tried again.
let unzipper: Worker | null = null
let unzipDead = false
let unzipId = 0
const unzipping = new Map<number, { blob: Blob; ok: (b: ArrayBuffer) => void; fail: (e: Error) => void }>()

function startUnzipper(): Worker | null {
  if (unzipper || unzipDead) return unzipper
  try {
    const w = new Worker(new URL('./unzipWorker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e: MessageEvent<FromUnzip>) => {
      const job = unzipping.get(e.data.id)
      unzipping.delete(e.data.id)
      if (!job) return
      // an error there (no unzipping in a worker on this browser) is tried here
      if ('buf' in e.data) job.ok(e.data.buf)
      else gunzipHere(job.blob).then(job.ok, job.fail)
    }
    w.onerror = (e) => {
      e.preventDefault()
      devlog('spots', `unzip worker failed · ${e.message || 'no message'} · unzipping on the main thread`)
      unzipDead = true
      unzipper = null
      w.terminate()
      for (const [id, job] of unzipping) {
        unzipping.delete(id)
        gunzipHere(job.blob).then(job.ok, job.fail)
      }
    }
    unzipper = w
  } catch {
    unzipDead = true
  }
  return unzipper
}

function gunzip(blob: Blob): Promise<ArrayBuffer> {
  if (typeof DecompressionStream === 'undefined') return Promise.reject(new Error('no DecompressionStream'))
  const w = startUnzipper()
  if (!w) return gunzipHere(blob)
  const id = ++unzipId
  return new Promise((ok, fail) => {
    unzipping.set(id, { blob, ok, fail })
    w.postMessage({ id, blob } satisfies ToUnzip)
  })
}

/** Read a baked band file (this format: the habitat grid, the
 *  microclimate grid), the phone's stored copy first. Null when it is not
 *  baked and not cached. */
export async function loadBandFile(file: string, tag: string): Promise<{ grid: Habitat; header: Record<string, unknown> } | null> {
  let blob = await getStoredFile(file)
  let mode = 'local'
  if (!blob) {
    if (!navigator.onLine) return null
    const r = await fetch(fileUrl(file))
    if (!r.ok || /html/i.test(r.headers.get('content-type') ?? '')) return null
    blob = await trackResponse(file, r) // counted for the hairline under the weather strip
    mode = 'network'
  }
  const buf = await gunzip(blob)
  const view = new DataView(buf)
  const hlen = view.getUint32(0, true)
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, hlen))) as Header
  if (header.region !== REGION.id) throw new Error(`${file} is for ${header.region}`)
  const h = new Habitat(header, buf, 4 + hlen)
  devlog(tag, `${file} ${mode} · ${h.cols}×${h.rows} · ${header.bands.length} bands · baked ${header.generated}`)
  return { grid: h, header: header as unknown as Record<string, unknown> }
}

async function fetchHabitat(): Promise<Habitat | null> {
  const r = await loadBandFile(habitatFile(), 'spots')
  return r?.grid ?? null
}

/** The grid, loading it once. Null when it is not baked and not cached. */
export function loadHabitat(): Promise<Habitat | null> {
  if (loaded) return Promise.resolve(loaded)
  if (inflight) return inflight
  inflight = fetchHabitat()
    .then((h) => {
      if (h) {
        loaded = h
        for (const cb of listeners) cb(h)
      }
      return h
    })
    .catch((e) => {
      devlog('spots', `habitat load failed · ${(e as Error).message}`)
      return null
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

export function habitat(): Habitat | null {
  return loaded
}

export function onHabitat(cb: (h: Habitat) => void): () => void {
  listeners.add(cb)
  if (loaded) cb(loaded)
  return () => listeners.delete(cb)
}
