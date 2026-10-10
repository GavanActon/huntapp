import { zxyToTileId } from 'pmtiles'
import { deleteStoredFile, getStoredFile, listStored, putStoredFile } from './fileStore'

/**
 * A PMTiles archive written on the phone from tiles that come in any order:
 * one stored file however many tiles, read by the map like every baked
 * archive (pmtilesRegistry.ts). Thousands of tiles kept one by one in the
 * worker's cache made a cold start wait 10 to 16 s on an iPhone (Safari
 * opens the whole cache store before the worker can serve the app's own
 * files; 2026-10-10), so the sharp imagery is packed instead
 * (sharpImagery.ts).
 *
 * The tiles are gathered into pieces as they come, each a stored file of
 * its own (the tiles back to back, then their index as JSON, then the
 * index's length), so a save cut short keeps what it had and the next one
 * goes on from there. Done, the pieces' bytes are laid end to end behind a
 * header and an index (spec v3: uncompressed directories, leaves when the
 * root would not fit the first 16 KB) and stored as one file: the Blob is
 * the pieces' own slices, so nothing is copied into memory on the way.
 */

/** tiles in a piece: about 5 MB of 14 KB imagery tiles */
const PIECE_TILES = 400
const HEADER_BYTES = 127
/** the reader takes the header and the root directory from the first 16 KB */
const FIRST_READ = 16_384

export interface PackDone {
  tiles: number
  bytes: number
}

export interface PackFinish {
  /** spec v3 tile type: 2 png, 3 jpeg, 4 webp */
  tileType: number
  /** west, south, east, north */
  bounds: [number, number, number, number]
  /** into the archive's JSON metadata */
  metadata: Record<string, unknown>
}

interface Entry {
  tileId: number
  offset: number
  length: number
  runLength: number
}

interface PieceIndex {
  ids: number[]
  lens: number[]
}

const pieceName = (name: string, n: number) => `${name}.part${n}`
const pieceNumber = (name: string, file: string): number | null => {
  const m = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.part(\\d+)$`).exec(file)
  return m ? Number(m[1]) : null
}

export class TilePack {
  readonly name: string
  private pieces: { n: number; index: PieceIndex; dataBytes: number }[] = []
  private ids = new Set<number>()
  private pending: { id: number; data: Uint8Array }[] = []
  private chain: Promise<void> = Promise.resolve()
  private next = 0
  private bytes = 0

  private constructor(name: string) {
    this.name = name
  }

  /** The pack `name` under way, with the pieces a save cut short left (none: a new one). */
  static async open(name: string): Promise<TilePack> {
    const pack = new TilePack(name)
    const found = listStored()
      .map((s) => pieceNumber(name, s.name))
      .filter((n): n is number => n != null)
      .sort((a, b) => a - b)
    for (const n of found) {
      const blob = await getStoredFile(pieceName(name, n))
      const index = blob ? await readIndex(blob).catch(() => null) : null
      if (!blob || !index) {
        // a torn piece: its tiles are fetched again
        await deleteStoredFile(pieceName(name, n))
        continue
      }
      const dataBytes = index.lens.reduce((a, b) => a + b, 0)
      pack.pieces.push({ n, index, dataBytes })
      for (const id of index.ids) pack.ids.add(id)
      pack.bytes += dataBytes
      pack.next = n + 1
    }
    return pack
  }

  /** tiles kept so far, and their bytes */
  get done(): PackDone {
    return { tiles: this.ids.size + this.pending.length, bytes: this.bytes }
  }

  has(z: number, x: number, y: number): boolean {
    return this.ids.has(zxyToTileId(z, x, y))
  }

  /** Keep one tile; every PIECE_TILES a piece is written (the callers wait on it, so the
   *  fetching never runs far ahead of the writing). */
  async add(z: number, x: number, y: number, data: ArrayBuffer): Promise<void> {
    const id = zxyToTileId(z, x, y)
    if (this.ids.has(id) || this.pending.some((p) => p.id === id)) return
    this.pending.push({ id, data: new Uint8Array(data) })
    this.bytes += data.byteLength
    if (this.pending.length >= PIECE_TILES) await this.flush()
  }

  /** Write what is gathered as a piece. */
  flush(): Promise<void> {
    if (this.pending.length) {
      const batch = this.pending
      this.pending = []
      this.chain = this.chain.then(() => this.writePiece(batch))
    }
    return this.chain
  }

  private async writePiece(batch: { id: number; data: Uint8Array }[]): Promise<void> {
    const n = this.next++
    const index: PieceIndex = { ids: batch.map((b) => b.id), lens: batch.map((b) => b.data.byteLength) }
    const json = new TextEncoder().encode(JSON.stringify(index))
    const tail = new Uint8Array(4)
    new DataView(tail.buffer).setUint32(0, json.byteLength, true)
    const ok = await putStoredFile(pieceName(this.name, n), new Blob([...batch.map((b) => b.data as Uint8Array<ArrayBuffer>), json, tail]))
    if (!ok) throw new Error('no room to keep the tiles')
    const dataBytes = index.lens.reduce((a, b) => a + b, 0)
    this.pieces.push({ n, index, dataBytes })
    for (const id of index.ids) this.ids.add(id)
  }

  /** Lay the pieces end to end as one archive, stored as the pack's name, and
   *  take the pieces away. The archive's size. */
  async finish(opts: PackFinish): Promise<number> {
    await this.flush()
    const pieces = [...this.pieces].sort((a, b) => a.n - b.n)
    const blobs: Blob[] = []
    const entries: Entry[] = []
    let offset = 0
    for (const p of pieces) {
      const blob = await getStoredFile(pieceName(this.name, p.n))
      if (!blob) throw new Error('a piece of the pack went missing')
      blobs.push(blob.slice(0, p.dataBytes))
      p.index.ids.forEach((tileId, i) => {
        entries.push({ tileId, offset, length: p.index.lens[i], runLength: 1 })
        offset += p.index.lens[i]
      })
    }
    if (!entries.length) throw new Error('no tiles to pack')
    entries.sort((a, b) => a.tileId - b.tileId)
    const { root, leaves } = directories(entries)
    const meta = new TextEncoder().encode(JSON.stringify(opts.metadata))
    const zooms = entries.map((e) => zoomOf(e.tileId))
    const minZoom = Math.min(...zooms)
    const maxZoom = Math.max(...zooms)
    const rootOffset = HEADER_BYTES
    const dataOffset = rootOffset + root.byteLength
    const leafOffset = dataOffset + offset
    const leafBytes = leaves.reduce((a, l) => a + l.byteLength, 0)
    const metaOffset = leafOffset + leafBytes
    const [w, s, e, n] = opts.bounds
    const header = headerBytes({
      rootOffset,
      rootLength: root.byteLength,
      metaOffset,
      metaLength: meta.byteLength,
      leafOffset,
      leafLength: leafBytes,
      dataOffset,
      dataLength: offset,
      tiles: entries.length,
      tileType: opts.tileType,
      minZoom,
      maxZoom,
      bounds: [w, s, e, n],
      center: [(w + e) / 2, (s + n) / 2, Math.min(maxZoom, Math.max(minZoom, 12))],
    })
    const archive = new Blob([header as Uint8Array<ArrayBuffer>, root as Uint8Array<ArrayBuffer>, ...blobs, ...(leaves as Uint8Array<ArrayBuffer>[]), meta])
    if (!(await putStoredFile(this.name, archive))) throw new Error('no room to keep the pack')
    await this.discard()
    return archive.size
  }

  /** Take the pieces away (a finished pack, or one given up on). */
  async discard(): Promise<void> {
    await this.chain.catch(() => {})
    for (const s of listStored()) if (pieceNumber(this.name, s.name) != null) await deleteStoredFile(s.name)
    this.pieces = []
    this.ids.clear()
    this.pending = []
    this.bytes = 0
  }
}

/** Every stored piece of packs under way whose names start so (Remove takes them with the pack). */
export async function discardPieces(name: string): Promise<void> {
  for (const s of listStored()) if (pieceNumber(name, s.name) != null) await deleteStoredFile(s.name)
}

async function readIndex(blob: Blob): Promise<PieceIndex | null> {
  if (blob.size < 4) return null
  const len = new DataView(await blob.slice(blob.size - 4).arrayBuffer()).getUint32(0, true)
  if (len <= 0 || len > blob.size - 4) return null
  const index = JSON.parse(await blob.slice(blob.size - 4 - len, blob.size - 4).text()) as PieceIndex
  if (!Array.isArray(index.ids) || !Array.isArray(index.lens) || index.ids.length !== index.lens.length) return null
  // the bytes must all be there ahead of the index
  return index.lens.reduce((a, b) => a + b, 0) + len + 4 === blob.size ? index : null
}

function zoomOf(tileId: number): number {
  // tile ids count up through the zooms: zoom z starts at (4^z - 1) / 3
  let z = 0
  while ((4 ** (z + 1) - 1) / 3 <= tileId) z++
  return z
}

// ---- spec v3: directories and the header ----

function varint(out: number[], v: number): void {
  // tile ids pass 2^32 from zoom 17: no bitwise arithmetic
  while (v >= 0x80) {
    out.push((v % 0x80) | 0x80)
    v = Math.floor(v / 0x80)
  }
  out.push(v)
}

function serialize(entries: Entry[]): Uint8Array {
  const out: number[] = []
  varint(out, entries.length)
  let last = 0
  for (const e of entries) {
    varint(out, e.tileId - last)
    last = e.tileId
  }
  for (const e of entries) varint(out, e.runLength)
  for (const e of entries) varint(out, e.length)
  entries.forEach((e, i) => {
    const prev = entries[i - 1]
    varint(out, i > 0 && e.offset === prev.offset + prev.length ? 0 : e.offset + 1)
  })
  return Uint8Array.from(out)
}

/** The root directory, and the leaves when every entry will not fit beside the header in the first read. */
function directories(entries: Entry[]): { root: Uint8Array; leaves: Uint8Array[] } {
  const whole = serialize(entries)
  if (HEADER_BYTES + whole.byteLength <= FIRST_READ) return { root: whole, leaves: [] }
  for (let size = 4096; ; size *= 2) {
    const leaves: Uint8Array[] = []
    const pointers: Entry[] = []
    let at = 0
    for (let i = 0; i < entries.length; i += size) {
      const leaf = serialize(entries.slice(i, i + size))
      pointers.push({ tileId: entries[i].tileId, offset: at, length: leaf.byteLength, runLength: 0 })
      leaves.push(leaf)
      at += leaf.byteLength
    }
    const root = serialize(pointers)
    if (HEADER_BYTES + root.byteLength <= FIRST_READ) return { root, leaves }
  }
}

function headerBytes(h: {
  rootOffset: number
  rootLength: number
  metaOffset: number
  metaLength: number
  leafOffset: number
  leafLength: number
  dataOffset: number
  dataLength: number
  tiles: number
  tileType: number
  minZoom: number
  maxZoom: number
  bounds: [number, number, number, number]
  center: [number, number, number]
}): Uint8Array {
  const b = new Uint8Array(HEADER_BYTES)
  const v = new DataView(b.buffer)
  b.set(new TextEncoder().encode('PMTiles'), 0)
  v.setUint8(7, 3)
  const u64 = (at: number, n: number) => {
    v.setUint32(at, n % 2 ** 32, true)
    v.setUint32(at + 4, Math.floor(n / 2 ** 32), true)
  }
  u64(8, h.rootOffset)
  u64(16, h.rootLength)
  u64(24, h.metaOffset)
  u64(32, h.metaLength)
  u64(40, h.leafOffset)
  u64(48, h.leafLength)
  u64(56, h.dataOffset)
  u64(64, h.dataLength)
  u64(72, h.tiles) // addressed tiles
  u64(80, h.tiles) // tile entries
  u64(88, h.tiles) // tile contents
  v.setUint8(96, 0) // not clustered: the tiles lie in the order they came
  v.setUint8(97, 1) // directories uncompressed
  v.setUint8(98, 1) // tiles as they came (jpeg, png: compressed already)
  v.setUint8(99, h.tileType)
  v.setUint8(100, h.minZoom)
  v.setUint8(101, h.maxZoom)
  const e7 = (d: number) => Math.round(d * 1e7)
  v.setInt32(102, e7(h.bounds[0]), true)
  v.setInt32(106, e7(h.bounds[1]), true)
  v.setInt32(110, e7(h.bounds[2]), true)
  v.setInt32(114, e7(h.bounds[3]), true)
  v.setUint8(118, h.center[2])
  v.setInt32(119, e7(h.center[0]), true)
  v.setInt32(123, e7(h.center[1]), true)
  return b
}
