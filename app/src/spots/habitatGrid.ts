/**
 * The band files the pipeline bakes: the habitat grid (build_habitat.py), the
 * microclimate grid (build_microclimate.py) and the going grid
 * (build_going.py), each a lattice of a few dozen bands, kept on the phone
 * with the map bundle so the Spots tab, the ground wind and the routes work
 * at camp with no signal.
 *
 * Two layouts are read (pipeline/habfile.py writes the second):
 *  - v1: gzip( u32 header-length · JSON header · bands… ), one stream, so
 *    the whole file had to come down before a byte of it could be read.
 *  - v2: "HAB2" · u32 header-length · JSON header · band blobs…, each band
 *    its own zlib stream at a byte offset the header gives, so the bands a
 *    view needs are read on their own: by HTTP range from the server (the
 *    page asks for the first ones before the app has loaded, index.html), or
 *    by a slice of the phone's copy. The ground model reads its base bands
 *    first, then the two momentum directions the hour's wind sits between,
 *    the rest once the map is up (weather/micro/model.ts).
 *
 * A grid that came down from the server is kept on the phone once all of
 * it is here (fileStore, marked auto), so the next open reads it in
 * milliseconds instead of fetching it again: the server's cache life is ten
 * minutes, and every open after that was a cold one (2026-10-07).
 *
 * Range reads bypass the browser's cache (no-store): Chrome answers a range
 * of a file it holds gzip-encoded with a slice of the encoded bytes, which
 * fails to decode. The header lists every band with dtype, byte offset and
 * scale; nothing here is hard-coded to the bake's band order.
 */
import { fileUrl } from '../areas'
import { REGION, habitatFile } from '../config'
import { devlog } from '../devlog'
import { downloadToStore, getStoredFile, manifestGet, manifestSet, putStoredFile } from '../offline/fileStore'
import { trackResponse } from '../offline/loadProgress'
import { bootManifest, manifestHashFor } from '../offline/updates'
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

export interface BandDef {
  name: string
  dtype: 'int8' | 'uint8' | 'uint16' | 'int16' | 'float32'
  scale: number
  /** byte offset in the unpacked payload (v1: where the band's bytes are) */
  offset: number
  meaning: string
  /** v2: the band's zlib stream, from the data start (after the header), and its length */
  cOff?: number
  cLen?: number
}

export interface BandHeader {
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
  /** v2: how each band is packed */
  codec?: string
  /** v2: where the bands written last (the momentum solve's) start, from the data start */
  first?: number
  /** v2, a micro grid: where its preview bands (p:<name>, written first) end, from the data start */
  previewEnd?: number
  /** the preview's coarser lattice (every `step`th cell of the grid's) */
  preview?: { cols: number; rows: number; west: number; north: number; dLon: number; dLat: number; cellM: [number, number]; step: number }
  [extra: string]: unknown
}

/** The preview bands' names start with this (pipeline/habfile.py with_preview). */
export const PREVIEW = 'p:'

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

  constructor(h: BandHeader) {
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
  }

  /** Every band of a v1 payload, as views on its buffer. */
  static fromPayload(h: BandHeader, buf: ArrayBuffer, base: number): Habitat {
    const g = new Habitat(h)
    for (const b of h.bands) g.attach(b, buf, base + b.offset)
    return g
  }

  /** A band's values, as they land: a view on the buffer where it is aligned, a copy where not. */
  attach(def: BandDef, buf: ArrayBuffer, at = 0): void {
    const n = this.cols * this.rows
    let data: Band
    if (def.dtype === 'uint8') data = new Uint8Array(buf, at, n)
    else if (def.dtype === 'int8') data = new Int8Array(buf, at, n)
    else if (def.dtype === 'uint16') data = at % 2 ? new Uint16Array(buf.slice(at, at + n * 2)) : new Uint16Array(buf, at, n)
    else if (def.dtype === 'int16') data = at % 2 ? new Int16Array(buf.slice(at, at + n * 2)) : new Int16Array(buf, at, n)
    else data = at % 4 ? new Float32Array(buf.slice(at, at + n * 4)) : new Float32Array(buf, at, n)
    this.bands.set(def.name, { data, scale: def.scale })
  }

  get size(): number {
    return this.cols * this.rows
  }

  /** Raw band values (unscaled). Throws for a band the bake did not write (or one not loaded yet). */
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

// ---------------------------------------------------------------- unpacking

type Format = 'gzip' | 'deflate'

function inflateHere(format: Format, parts: Blob[]): Promise<ArrayBuffer[]> {
  return Promise.all(parts.map((p) => new Response(p.stream().pipeThrough(new DecompressionStream(format))).arrayBuffer()))
}

// The unpacking goes to a worker (unzipWorker.ts). A worker that cannot
// start (an old browser, its file missing from an offline cache) hands
// what it holds back to be unpacked here, and none is tried again.
let unzipper: Worker | null = null
let unzipDead = false
let unzipId = 0
const unzipping = new Map<number, { format: Format; parts: Blob[]; ok: (b: ArrayBuffer[]) => void; fail: (e: Error) => void }>()

function startUnzipper(): Worker | null {
  if (unzipper || unzipDead) return unzipper
  try {
    const w = new Worker(new URL('./unzipWorker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e: MessageEvent<FromUnzip>) => {
      const job = unzipping.get(e.data.id)
      unzipping.delete(e.data.id)
      if (!job) return
      // an error there (no unpacking in a worker on this browser) is tried here
      if ('bufs' in e.data) job.ok(e.data.bufs)
      else inflateHere(job.format, job.parts).then(job.ok, job.fail)
    }
    w.onerror = (e) => {
      e.preventDefault()
      devlog('spots', `unzip worker failed · ${e.message || 'no message'} · unpacking on the main thread`)
      unzipDead = true
      unzipper = null
      w.terminate()
      for (const [id, job] of unzipping) {
        unzipping.delete(id)
        inflateHere(job.format, job.parts).then(job.ok, job.fail)
      }
    }
    unzipper = w
  } catch {
    unzipDead = true
  }
  return unzipper
}

function inflate(format: Format, parts: Blob[]): Promise<ArrayBuffer[]> {
  if (typeof DecompressionStream === 'undefined') return Promise.reject(new Error('no DecompressionStream'))
  const w = startUnzipper()
  if (!w) return inflateHere(format, parts)
  const id = ++unzipId
  return new Promise((ok, fail) => {
    unzipping.set(id, { format, parts, ok, fail })
    w.postMessage({ id, format, parts } satisfies ToUnzip)
  })
}

// ---------------------------------------------------------------- where the bytes come from

/** How much of a file is read first: the magic, the header (the micro grid's is ~15 KB) and some of the first band. */
const HEAD_BYTES = 64 * 1024
/** Two bands' spans this close are read as one range: a request saved beats the bytes between. */
const GAP_BYTES = 32 * 1024

type Bytes = Uint8Array<ArrayBuffer>

interface ByteSource {
  mode: 'local' | 'network'
  read(at: number, len: number, priority: RequestPriority): Promise<Bytes>
}

class LocalSource implements ByteSource {
  readonly mode = 'local' as const
  private blob: Blob
  constructor(blob: Blob) {
    this.blob = blob
  }
  async read(at: number, len: number): Promise<Bytes> {
    return new Uint8Array(await this.blob.slice(at, at + len).arrayBuffer())
  }
}

class NetworkSource implements ByteSource {
  readonly mode = 'network' as const
  /** the whole file, when a server answered a range with all of it */
  whole: Bytes | null = null
  private url: string
  private file: string
  constructor(url: string, file: string) {
    this.url = url
    this.file = file
  }
  async read(at: number, len: number, priority: RequestPriority): Promise<Bytes> {
    if (this.whole) return this.whole.subarray(at, at + len)
    let r: Response
    try {
      r = await fetch(this.url, { headers: { Range: `bytes=${at}-${at + len - 1}` }, cache: 'no-store', priority })
    } catch (e) {
      // a range the browser could not take (an edge answering out of a
      // gzip-encoded copy): the whole file instead, as it always was
      devlog('data', `${this.file} range ${at}+${len} failed · ${(e as Error).message} · fetching it whole`)
      return (await this.fetchWhole(priority)).subarray(at, at + len)
    }
    if (r.status === 206) return new Uint8Array(await (await trackResponse(`${this.file}@${at}`, r)).arrayBuffer())
    if (r.status === 200 && !/html/i.test(r.headers.get('content-type') ?? '')) {
      // a server with no ranges (or a file this small): the whole file, kept for the reads to come
      this.whole = new Uint8Array(await (await trackResponse(this.file, r)).arrayBuffer())
      return this.whole.subarray(at, at + len)
    }
    throw new Error(`${this.file}: ${r.status}`)
  }
  private async fetchWhole(priority: RequestPriority): Promise<Bytes> {
    const r = await fetch(this.url, { priority })
    if (!r.ok || /html/i.test(r.headers.get('content-type') ?? '')) throw new Error(`${this.file}: ${r.status}`)
    this.whole = new Uint8Array(await (await trackResponse(this.file, r)).arrayBuffer())
    return this.whole
  }
}

/** The page's own early fetch of a grid's first range (index.html), by file name. */
declare global {
  interface Window {
    __gwPre?: Record<string, { p: Promise<Response>; first: number }>
  }
}

async function preloaded(file: string): Promise<Bytes | null> {
  const pre = window.__gwPre?.[file]
  if (!pre) return null
  delete window.__gwPre![file]
  try {
    const r = await pre.p
    if ((r.status !== 206 && r.status !== 200) || /html/i.test(r.headers.get('content-type') ?? '')) return null
    return new Uint8Array(await (await trackResponse(file, r)).arrayBuffer())
  } catch {
    return null
  }
}

// ---------------------------------------------------------------- a file, read as it is needed

export interface OpenOpts {
  /** the fetches' priority against the tiles and the rest (Chrome, Safari 17.2+) */
  priority?: RequestPriority
}

/**
 * An open band file: its header and grid at once, its bands as they are
 * asked for (`load`), every byte that came down remembered so the whole
 * can be kept on the phone (`keep`). A v1 file comes whole and loaded.
 */
export class BandFile {
  readonly file: string
  readonly tag: string
  readonly header: BandHeader
  readonly grid: Habitat
  /** the coarse copy of the base bands a micro grid carries first, on its own lattice */
  readonly preview: Habitat | null
  private src: ByteSource
  /** where the band blobs start: after the magic, the length and the header */
  private dataStart: number
  /** a v1 file, whole: nothing to range */
  private whole: Blob | null
  private pieces: { at: number; bytes: Bytes }[] = []
  private loading = new Map<string, Promise<void>>()
  private kept = false

  constructor(file: string, tag: string, header: BandHeader, src: ByteSource, dataStart: number, head: Bytes, whole: Blob | null = null) {
    this.file = file
    this.tag = tag
    this.header = header
    this.src = src
    this.dataStart = dataStart
    this.whole = whole
    this.grid = new Habitat(header)
    this.preview = header.preview ? new Habitat({ ...header, ...header.preview, bands: [] }) : null
    this.pieces.push({ at: 0, bytes: head })
  }

  get mode(): 'local' | 'network' {
    return this.src.mode
  }
  get names(): string[] {
    return this.header.bands.map((b) => b.name)
  }
  /** the preview's bands, when the file has them */
  get previewNames(): string[] {
    return this.preview ? this.names.filter((n) => n.startsWith(PREVIEW)) : []
  }
  /** the grid a band belongs to */
  private gridOf(name: string): Habitat {
    return name.startsWith(PREVIEW) && this.preview ? this.preview : this.grid
  }
  private isIn(name: string): boolean {
    return this.gridOf(name).has(name)
  }

  /** The bytes of a span, when one piece holds all of it. */
  private held(at: number, len: number): Bytes | null {
    for (const p of this.pieces) if (p.at <= at && p.at + p.bytes.byteLength >= at + len) return p.bytes.subarray(at - p.at, at - p.at + len)
    return null
  }

  /** Bands by name, those not in yet: their spans read (coalesced, in one
   *  go), each unpacked and attached. Resolves when every named band is in. */
  load(names: string[], priority: RequestPriority = 'auto'): Promise<void> {
    if (this.whole) return Promise.resolve()
    const defs = this.header.bands.filter((b) => names.includes(b.name) && !this.isIn(b.name) && !this.loading.has(b.name))
    if (defs.length) {
      const run = this.fetchAndAttach(defs, priority)
      for (const d of defs) this.loading.set(d.name, run)
      void run.catch(() => {}).then(() => {
        for (const d of defs) if (this.loading.get(d.name) === run) this.loading.delete(d.name)
      })
    }
    return Promise.all(names.map((n) => this.loading.get(n))).then(() => undefined)
  }

  private async fetchAndAttach(defs: BandDef[], priority: RequestPriority): Promise<void> {
    const spans = defs.map((d) => ({ at: this.dataStart + d.cOff!, end: this.dataStart + d.cOff! + d.cLen! })).sort((a, b) => a.at - b.at)
    const merged: { at: number; end: number }[] = []
    for (const s of spans) {
      const last = merged[merged.length - 1]
      if (last && s.at - last.end <= GAP_BYTES) last.end = Math.max(last.end, s.end)
      else merged.push({ ...s })
    }
    await Promise.all(
      merged.map(async (m) => {
        if (this.held(m.at, m.end - m.at)) return
        const bytes = await this.src.read(m.at, m.end - m.at, priority)
        this.pieces.push({ at: m.at, bytes })
      }),
    )
    const parts = defs.map((d) => {
      const b = this.held(this.dataStart + d.cOff!, d.cLen!)
      if (!b) throw new Error(`${this.file}: no bytes for ${d.name}`)
      return new Blob([b])
    })
    const bufs = await inflate('deflate', parts)
    defs.forEach((d, k) => this.gridOf(d.name).attach(d, bufs[k]))
    // the phone's own copy: once every band is in, the packed bytes read from it can go
    if (this.src.mode === 'local' && this.allIn()) this.pieces = []
  }

  private allIn(): boolean {
    return this.header.bands.every((b) => this.isIn(b.name))
  }

  loadAll(priority: RequestPriority = 'auto'): Promise<void> {
    return this.load(this.names, priority)
  }

  /** Every byte of the file is in hand. */
  complete(): boolean {
    if (this.whole) return true
    return this.header.bands.every((b) => this.held(this.dataStart + b.cOff!, b.cLen!) != null)
  }

  /** A file that came from the server, kept on the phone once all of it is
   *  here, under the hash the server lists it by: the next open reads it from
   *  storage. Nothing to do for the phone's own copy. */
  async keep(): Promise<void> {
    if (this.kept || this.src.mode !== 'network' || !this.complete()) return
    this.kept = true
    let blob = this.whole
    if (!blob) {
      const size = this.dataStart + this.header.bands.reduce((m, b) => Math.max(m, b.cOff! + b.cLen!), 0)
      const out = new Uint8Array(size)
      out.set(this.held(0, this.dataStart)!, 0)
      for (const b of this.header.bands) out.set(this.held(this.dataStart + b.cOff!, b.cLen!)!, this.dataStart + b.cOff!)
      blob = new Blob([out])
    }
    await keepFile(this.file, blob, this.tag)
    // the packed bytes have done their work once every band is unpacked
    if (this.allIn()) {
      this.pieces = []
      this.whole = null
    }
  }
}

async function keepFile(name: string, blob: Blob, tag: string): Promise<void> {
  if (!window.isSecureContext) return
  const hash = manifestHashFor(name)
  const ok = await putStoredFile(name, blob, { hash, auto: true })
  if (ok) devlog(tag, `${name} kept on the phone · ${(blob.size / 1e6).toFixed(1)} MB${hash ? '' : ' · no hash yet'}`)
}

/** A while after the first view: the kept copy is checked against the server's list. */
const REFRESH_AFTER_MS = 20_000

/** A copy kept from an earlier open that is behind the server's bake is used
 *  now and fetched again behind the view, so the next open has the new one;
 *  the Offline sheet never nags about a file nobody asked to keep. */
async function refreshAuto(file: string, tag: string): Promise<void> {
  const m = await bootManifest()
  const e = m?.files[file]
  const info = manifestGet(file)
  if (!e || !info?.auto) return
  const behind = info.hash ? info.hash !== e.hash : info.size !== e.size
  if (!behind) {
    if (!info.hash) manifestSet({ ...info, hash: e.hash })
    return
  }
  await new Promise((r) => setTimeout(r, REFRESH_AFTER_MS))
  if (!navigator.onLine) return
  try {
    await downloadToStore(fileUrl(file), file, undefined, undefined, e.hash)
    const now = manifestGet(file)
    if (now) manifestSet({ ...now, auto: true })
    devlog(tag, `${file} rebaked on the server · fetched again, in use on the next open`)
  } catch (err) {
    devlog(tag, `${file} refresh failed · ${(err as Error).message}`)
  }
}

/** Open a band file: the phone's copy first, else the server's by range
 *  (the page's early fetch of its first bytes when there is one). Null when
 *  it is not baked and not cached. */
export async function openBandFile(file: string, tag: string, opts: OpenOpts = {}): Promise<BandFile | null> {
  const priority = opts.priority ?? 'auto'
  const stored = await getStoredFile(file)
  let src: ByteSource
  let head: Bytes
  if (stored) {
    src = new LocalSource(stored)
    head = await src.read(0, Math.min(HEAD_BYTES, stored.size), priority)
    if (manifestGet(file)?.auto) void refreshAuto(file, tag)
  } else {
    if (!navigator.onLine) return null
    const net = new NetworkSource(fileUrl(file), file)
    src = net
    const pre = await preloaded(file)
    if (pre) head = pre
    else {
      try {
        head = await net.read(0, HEAD_BYTES, priority)
      } catch {
        return null // not baked
      }
    }
  }
  const ascii = (a: Uint8Array, n: number) => String.fromCharCode(...a.subarray(0, n))
  if (ascii(head, 4) !== 'HAB2') {
    if (head[0] !== 0x1f || head[1] !== 0x8b) throw new Error(`${file}: not a band file`)
    // v1: one gzip stream, so the whole file, then every band
    let blob: Blob
    if (stored) blob = stored
    else if ((src as NetworkSource).whole) blob = new Blob([(src as NetworkSource).whole!])
    else {
      const r = await fetch(fileUrl(file), { priority })
      if (!r.ok) throw new Error(`${file}: ${r.status}`)
      blob = await trackResponse(file, r)
    }
    const [buf] = await inflate('gzip', [blob])
    const view = new DataView(buf)
    const hlen = view.getUint32(0, true)
    const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, hlen))) as BandHeader
    if (header.region !== REGION.id) throw new Error(`${file} is for ${header.region}`)
    const bf = new BandFile(file, tag, header, src, 4 + hlen, new Uint8Array(0), blob)
    for (const b of header.bands) bf.grid.attach(b, buf, 4 + hlen + b.offset)
    devlog(tag, `${file} ${src.mode} · ${header.cols}×${header.rows} · ${header.bands.length} bands · baked ${header.generated} · v1`)
    return bf
  }
  const hlen = new DataView(head.buffer, head.byteOffset, head.byteLength).getUint32(4, true)
  // a header longer than the first read (not seen yet: the biggest is ~15 KB)
  if (8 + hlen > head.byteLength) head = await src.read(0, 8 + hlen, priority)
  const header = JSON.parse(new TextDecoder().decode(head.subarray(8, 8 + hlen))) as BandHeader
  if (header.region !== REGION.id) throw new Error(`${file} is for ${header.region}`)
  const bf = new BandFile(file, tag, header, src, 8 + hlen, head)
  devlog(tag, `${file} ${src.mode} · ${header.cols}×${header.rows} · ${header.bands.length} bands · baked ${header.generated}`)
  return bf
}

/** Read a whole band file (the habitat grid, the going grid), the phone's
 *  stored copy first, and keep one that came from the server. Null when it
 *  is not baked and not cached. */
export async function loadBandFile(file: string, tag: string, opts: OpenOpts = {}): Promise<{ grid: Habitat; header: Record<string, unknown> } | null> {
  const f = await openBandFile(file, tag, opts)
  if (!f) return null
  await f.loadAll(opts.priority)
  void f.keep()
  return { grid: f.grid, header: f.header as unknown as Record<string, unknown> }
}

let loaded: Habitat | null = null
let inflight: Promise<Habitat | null> | null = null
const listeners = new Set<(h: Habitat) => void>()

async function fetchHabitat(): Promise<Habitat | null> {
  // behind the wind grid on the line: the heat waits for the wind anyway
  const r = await loadBandFile(habitatFile(), 'spots', { priority: 'low' })
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
