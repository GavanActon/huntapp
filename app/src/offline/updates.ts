import { create } from 'zustand'
import { BUNDLES, DATA_BASE, DATA_FILES } from '../config'
import { devlog } from '../devlog'
import { manifestGet, manifestSet } from './fileStore'

/**
 * New maps on the server. The build writes data/manifest.json (each baked
 * file's size and a hash of its bytes, vite.config.ts); with a connection
 * the app compares it with the files saved on the phone, and a file that
 * was rebaked, or is new to the bundle, is offered in the Offline section
 * and flagged on the map, so the phone is not left on an old bake without
 * knowing. Only a phone that already keeps a bundle offline is asked: one
 * reading the maps from the server has the new ones already.
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
}

interface UpdatesState {
  pending: PendingFile[]
  checkedAt: number
  /** every file the server has baked, from the last manifest seen; null before any */
  onServer: string[] | null
}

const SERVER_KEY = 'huntapp-server-files'
function loadOnServer(): string[] | null {
  try {
    const raw = localStorage.getItem(SERVER_KEY)
    const v = raw ? (JSON.parse(raw) as unknown) : null
    return Array.isArray(v) ? (v as string[]) : null
  } catch {
    return null
  }
}

export const useMapUpdates = create<UpdatesState>(() => ({ pending: [], checkedAt: 0, onServer: loadOnServer() }))

/** The bundle's files the server has actually baked. A file listed in the
 *  bundle but never built (the base map, 2026-10-02) is not one the phone
 *  can be missing: counting it kept the Maps row at Download with every
 *  real file saved. Before any manifest has been seen, every file counts. */
export function bundleOnServer(files: string[]): string[] {
  const on = useMapUpdates.getState().onServer
  if (!on) return files
  const set = new Set(on)
  return files.filter((f) => set.has(f))
}

const LABELS = new Map(DATA_FILES.map((d) => [d.file, d.label]))
const labelOf = (name: string) => LABELS.get(name) ?? name.replace(/-[a-z-]+\.(geojson|hab)$/, '').replace(/[_-]/g, ' ')

async function fetchManifest(): Promise<DataManifest | null> {
  try {
    const ctl = new AbortController()
    const t = setTimeout(() => ctl.abort(), 10_000)
    const r = await fetch(`${DATA_BASE}manifest.json`, { cache: 'no-store', signal: ctl.signal })
    clearTimeout(t)
    if (!r.ok) return null
    const j = (await r.json()) as DataManifest
    return j && typeof j.files === 'object' ? j : null
  } catch {
    return null
  }
}

/** The bundle files that differ from the server's, for a phone that keeps any of them. */
export function pendingFrom(m: DataManifest): PendingFile[] {
  const out: PendingFile[] = []
  for (const b of BUNDLES) {
    if (!b.files.some((f) => manifestGet(f))) continue
    for (const name of b.files) {
      const e = m.files[name]
      if (!e) continue // not baked yet
      const have = manifestGet(name)
      if (!have) out.push({ name, label: labelOf(name), why: 'new', size: e.size, hash: e.hash })
      else if (have.hash ? have.hash !== e.hash : have.size !== e.size) out.push({ name, label: labelOf(name), why: 'updated', size: e.size, hash: e.hash })
      else if (!have.hash) manifestSet({ ...have, hash: e.hash })
    }
  }
  return out
}

let inflight: Promise<void> | null = null
/** Ask the server now (with a connection); the answer lands in useMapUpdates. */
export function checkMapUpdates(): Promise<void> {
  if (inflight) return inflight
  if (!navigator.onLine || !window.isSecureContext) return Promise.resolve()
  inflight = fetchManifest()
    .then((m) => {
      if (!m) return
      const pending = pendingFrom(m)
      const onServer = Object.keys(m.files)
      useMapUpdates.setState({ pending, checkedAt: Date.now(), onServer })
      try {
        localStorage.setItem(SERVER_KEY, JSON.stringify(onServer))
      } catch {
        /* private mode */
      }
      if (pending.length) devlog('data', `new maps · ${pending.map((p) => `${p.name}:${p.why}`).join(' ')}`)
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

/** The manifest's hash for a file, for noting beside a download. */
export async function serverHashes(): Promise<Map<string, string>> {
  const m = await fetchManifest()
  return new Map(Object.entries(m?.files ?? {}).map(([k, v]) => [k, v.hash]))
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
