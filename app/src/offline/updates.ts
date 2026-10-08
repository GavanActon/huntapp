import { create } from 'zustand'
import { ACTIVE_AREA, AREA_LIST, DATA_BASE, DEFAULT_AREA, areaById, areaKey, fileUrl, readAreaItem, writeAreaItem } from '../areas'
import { BUNDLES, dataFiles, type BundleDef } from '../config'
import { devlog } from '../devlog'
import { manifestGet, manifestSet } from './fileStore'

/**
 * New maps on the server. The build writes a manifest per area (each baked
 * file's size and a hash of its bytes, vite.config.ts): Pickle Lake's is
 * data/manifest.json as it always was, another area's sits in its folder.
 * With a connection the app compares the manifest with the files saved on
 * the phone, and a file that was rebaked, or is new to the bundle, is
 * offered in the Offline section and flagged on the map, so the phone is
 * not left on an old bake without knowing. Only an area the phone already
 * keeps offline is asked about, and the area the app is in: one reading
 * the maps from the server has the new ones already, and an area never
 * saved is never checked.
 *
 * Files saved before the manifest existed have no hash: the same size is
 * taken as the same file (a rebake nearly always changes it), and the
 * manifest's hash is noted for next time.
 */

export interface DataManifest {
  files: Record<string, { size: number; hash: string }>
}

export interface PendingFile {
  name: string
  label: string
  why: 'new' | 'updated'
  size: number
  hash: string
  /** the area whose bundle it is in */
  area: string
}

/** An area as the server lists it (data/areas/index.json): its manifest,
 *  and the files of its pack the server has, with their bytes. */
export interface AreaListing {
  id: string
  name: string
  base: string
  manifest: string
  hash: string
  bytes: number
  files: string[]
}

interface UpdatesState {
  /** the files that differ from the server's, across every area the phone keeps */
  pending: PendingFile[]
  checkedAt: number
  /** every file the server has baked, by area, from the last manifest seen; an area has none before one */
  onServer: Record<string, string[]>
  /** the server's list of areas, from the last look; null before any */
  listing: Record<string, AreaListing> | null
}

/** Pickle Lake's list stays under the key it had before there were areas. */
const SERVER_KEY = 'huntapp-server-files'
const serverKey = (areaId: string) => (areaId === DEFAULT_AREA ? SERVER_KEY : areaKey(SERVER_KEY, areaId))
const LISTING_KEY = 'huntapp-area-listing'

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as unknown) : null
  } catch {
    return null
  }
}

function writeJson(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v))
  } catch {
    /* private mode */
  }
}

function loadOnServer(): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const a of AREA_LIST) {
    const v = readJson(serverKey(a.id))
    if (Array.isArray(v)) out[a.id] = v as string[]
  }
  return out
}

function loadListing(): Record<string, AreaListing> | null {
  const v = readJson(LISTING_KEY)
  return v && typeof v === 'object' ? (v as Record<string, AreaListing>) : null
}

export const useMapUpdates = create<UpdatesState>(() => ({ pending: [], checkedAt: 0, onServer: loadOnServer(), listing: loadListing() }))

/** An area's offline bundle (config.ts BUNDLES). */
export function bundleOf(areaId: string): BundleDef | null {
  return BUNDLES.find((b) => b.id === areaId) ?? null
}

/** The bundle's files the server has actually baked. A file listed in the
 *  bundle but never built (the base map, 2026-10-02) is not one the phone
 *  can be missing: counting it kept the Maps row at Download with every
 *  real file saved. The area's manifest says, else the server's list of
 *  areas; before either has been seen, every file counts. */
export function bundleOnServer(files: string[], areaId: string = ACTIVE_AREA.id): string[] {
  const s = useMapUpdates.getState()
  const on = s.onServer[areaId] ?? s.listing?.[areaId]?.files
  if (!on) return files
  const set = new Set(on)
  return files.filter((f) => set.has(f))
}

/** The phone keeps some of the area's maps offline: saved by a Download. A
 *  grid kept from a view (auto, spots/habitatGrid.ts) does not count: a
 *  phone that never asked to save the area is not told the rest is new. */
export function keepsArea(b: BundleDef): boolean {
  return b.files.some((f) => {
    const i = manifestGet(f)
    return i != null && !i.auto
  })
}

const LABELS = new Map(AREA_LIST.flatMap(dataFiles).map((d) => [d.file, d.label]))
const labelOf = (name: string) => LABELS.get(name) ?? name.replace(/-[a-z-]+\.(geojson|hab)$/, '').replace(/[_-]/g, ' ')

async function fetchJson<T>(url: string, opts: { timeoutMs?: number; cache?: RequestCache } = {}): Promise<T | null> {
  try {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 10_000)
    const r = await fetch(url, { cache: opts.cache ?? 'no-store', signal: ctl.signal })
    clearTimeout(t)
    if (!r.ok) return null
    return (await r.json()) as T
  } catch {
    return null
  }
}

/** The manifests seen this run, by area: the new-maps list is worked out
 *  again from them when files are saved or removed without a reload. */
const manifests = new Map<string, DataManifest>()

function noteManifest(areaId: string, j: DataManifest): void {
  manifests.set(areaId, j)
  const files = Object.keys(j.files)
  useMapUpdates.setState((s) => ({ onServer: { ...s.onServer, [areaId]: files } }))
  writeJson(serverKey(areaId), files)
}

/** The area's manifest from the server, or null without one (no signal,
 *  not built), and what it says the server has noted for the area. Pickle
 *  Lake's address is data/manifest.json, as ever. */
export async function serverManifest(areaId: string): Promise<DataManifest | null> {
  const j = await fetchJson<DataManifest>(fileUrl('manifest.json', areaId))
  if (!j || typeof j.files !== 'object' || j.files == null) return null
  noteManifest(areaId, j)
  return j
}

let boot: Promise<DataManifest | null> | null = null

/** The area's manifest at start, asked once and early: which files the
 *  server has, so the map's style needs no probing of each archive and
 *  theme (25 requests before the first tile, 2026-10-07), and the hash a
 *  grid kept from the view is stored under. The browser's cache may answer
 *  (a stale list costs a missed file at worst); a slow answer is not waited
 *  on past a few seconds, and the probes stand in. */
export function bootManifest(): Promise<DataManifest | null> {
  if (boot) return boot
  boot = (async () => {
    if (!navigator.onLine) return null
    const j = await fetchJson<DataManifest>(fileUrl('manifest.json'), { timeoutMs: 4000, cache: 'default' })
    if (!j || typeof j.files !== 'object' || j.files == null) return null
    noteManifest(ACTIVE_AREA.id, j)
    return j
  })()
  return boot
}

/** A file's hash in the active area's manifest, when one has been seen this run. */
export function manifestHashFor(name: string): string | undefined {
  return manifests.get(ACTIVE_AREA.id)?.files[name]?.hash
}

/** The bytes these files add up to on the server, from the area's manifest
 *  seen this run; 0 before one has been (the menu's Save maps row). */
export function bytesOf(files: string[], areaId: string = ACTIVE_AREA.id): number {
  const m = manifests.get(areaId)
  if (!m) return 0
  return files.reduce((sum, f) => sum + (m.files[f]?.size ?? 0), 0)
}

/** The bundle files that differ from the server's, for a phone that keeps any of them. */
export function pendingFrom(m: DataManifest, b: BundleDef): PendingFile[] {
  const out: PendingFile[] = []
  if (!keepsArea(b)) return out
  for (const name of b.files) {
    const e = m.files[name]
    if (!e) continue // not baked yet
    const have = manifestGet(name)
    if (!have) out.push({ name, label: labelOf(name), why: 'new', size: e.size, hash: e.hash, area: b.id })
    else if (have.hash ? have.hash !== e.hash : have.size !== e.size) out.push({ name, label: labelOf(name), why: 'updated', size: e.size, hash: e.hash, area: b.id })
    else if (!have.hash) manifestSet({ ...have, hash: e.hash })
  }
  return out
}

/** The new-maps list from the manifests in hand, for the areas kept now. */
function pendingNow(): PendingFile[] {
  return BUNDLES.flatMap((b) => {
    const m = manifests.get(b.id)
    return m ? pendingFrom(m, b) : []
  })
}

/** Files were saved or removed with no reload (another area's): the list follows. */
export function refreshPending(): void {
  useMapUpdates.setState({ pending: pendingNow() })
}

let listingInflight: Promise<void> | null = null
/** The server's list of areas (with a connection), for what an area not
 *  saved would bring: asked when the Offline sheet opens, and by the
 *  check below only for a phone that keeps an area of its own folder. */
export function checkAreaListing(): Promise<void> {
  if (listingInflight) return listingInflight
  if (!navigator.onLine || !window.isSecureContext) return Promise.resolve()
  listingInflight = (async () => {
    const index = await fetchJson<{ areas?: AreaListing[] }>(`${DATA_BASE}areas/index.json`)
    if (!index || !Array.isArray(index.areas)) return
    const listing = Object.fromEntries(index.areas.filter((a) => areaById(a.id) && Array.isArray(a.files)).map((a) => [a.id, a]))
    useMapUpdates.setState({ listing })
    writeJson(LISTING_KEY, listing)
  })().finally(() => {
    listingInflight = null
  })
  return listingInflight
}

let inflight: Promise<void> | null = null
/** Ask the server now (with a connection); the answer lands in useMapUpdates. */
export function checkMapUpdates(): Promise<void> {
  if (inflight) return inflight
  if (!navigator.onLine || !window.isSecureContext) return Promise.resolve()
  inflight = (async () => {
    // a phone that keeps Pickle Lake's maps alone asks for its manifest and
    // nothing more, as before there were areas: the list of areas is for
    // one that keeps another's (Pickle's files are flat, the rest in folders)
    if (BUNDLES.some((b) => areaById(b.id)?.base && keepsArea(b))) await checkAreaListing()
    let heard = false
    for (const b of BUNDLES) {
      // the area the app is in, as Pickle Lake was asked before there were
      // areas (the Maps row needs what the server has); another only once
      // the phone keeps some of its maps
      if (b.id !== ACTIVE_AREA.id && !keepsArea(b)) continue
      if (await serverManifest(b.id)) heard = true
    }
    if (!heard) return
    const pending = pendingNow()
    useMapUpdates.setState({ pending, checkedAt: Date.now() })
    if (pending.length) devlog('data', `new maps · ${pending.map((p) => `${p.name}:${p.why}`).join(' ')}`)
  })().finally(() => {
    inflight = null
  })
  return inflight
}

/** Per area (areas.readAreaItem): the bundle files the server did not have
 *  when last asked online. Offline every unsaved file looks missing, so it
 *  is noted while there is signal. */
const ABSENT_KEY = 'huntapp-absent-files'

export function noteAbsent(files: string[], areaId: string = ACTIVE_AREA.id): void {
  writeAreaItem(ABSENT_KEY, JSON.stringify(files), areaId)
}

function absentFiles(areaId: string): Set<string> {
  let v: unknown = null
  try {
    v = JSON.parse(readAreaItem(ABSENT_KEY, areaId) ?? '[]')
  } catch {
    /* ignore */
  }
  if (!Array.isArray(v)) return new Set()
  // before areas the list held the layers' style keys ('basemap'), not file names
  const area = areaById(areaId)
  const byKey = new Map(area ? dataFiles(area).map((d) => [d.key, d.file]) : [])
  return new Set((v as string[]).map((n) => byKey.get(n) ?? n))
}

/** The area's maps work with no signal: every file of its bundle (the
 *  PMTiles, the GeoJSON and the grids) is on the phone, or is one the
 *  server does not have. */
export function offlineReady(areaId: string = ACTIVE_AREA.id): boolean {
  const b = bundleOf(areaId)
  if (!b) return false
  const absent = absentFiles(areaId)
  const baked = new Set(bundleOnServer(b.files, areaId))
  return b.files.every((f) => manifestGet(f) != null || absent.has(f) || !baked.has(f))
}

const RECHECK_MS = 60 * 60_000
let wired = false
/** Call once: a check soon after start, on getting a connection back, and hourly while in use. */
export function initMapUpdates() {
  if (wired) return
  wired = true
  setTimeout(() => void checkMapUpdates(), 5000)
  window.addEventListener('online', () => void checkMapUpdates())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - useMapUpdates.getState().checkedAt > RECHECK_MS) void checkMapUpdates()
  })
}
