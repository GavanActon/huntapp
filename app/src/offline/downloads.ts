import { create } from 'zustand'
import { BUNDLES, DATA_BASE } from '../config'
import { useAppStore } from '../state/appStore'
import { useScent } from '../weather/micro/scent'
import { deleteStoredFile, downloadToStore, listStored, requestPersistence } from './fileStore'
import { bundleOnServer, serverHashes, useMapUpdates } from './updates'

/**
 * Downloading the region's baked maps to the phone, as a store rather than
 * a panel's state, so a download started from Settings carries on with the
 * sheet closed and the Maps row can say how far it has got. Files the
 * pipeline has not produced yet are skipped with a note, not an error, so
 * a partial build is still downloadable.
 */

interface DownloadState {
  /** a download is running */
  active: boolean
  /** the file being fetched now, and where it stands in the run */
  file: string
  fileIdx: number
  fileCount: number
  loaded: number
  total: number
  /** the last run's failure, or the reload note when a live setup is up */
  error: string | null
  /** files the server has not built yet, from the last run */
  skipped: string[]
  /** when the saved files last changed (a download or a removal), so what reads listStored() re-reads it */
  storedAt: number
}

export const useDownloads = create<DownloadState>()(() => ({
  active: false,
  file: '',
  fileIdx: 0,
  fileCount: 0,
  loaded: 0,
  total: 0,
  error: null,
  skipped: [],
  storedAt: 0,
}))

export function fmtBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`
  if (n >= 1e6) return `${(n / 1e6).toFixed(0)} MB`
  return `${(n / 1e3).toFixed(0)} KB`
}

/** The new maps come into use on a reload; a live setup (people placed) is never saved, so it waits. */
function reloadUnlessLive(note: string) {
  if (useScent.getState().people.length > 0) useDownloads.setState({ error: note })
  else window.location.reload()
}

/** Download the files not on the phone, or with `replace` these files whether or not they are. */
export async function downloadFiles(files: string[], replace = false): Promise<void> {
  const set = useDownloads.setState
  if (useDownloads.getState().active) return
  set({ error: null, skipped: [] })
  // OPFS and Cache Storage only exist on https (or localhost): over plain
  // http on the LAN the download has nowhere to write
  if (!window.isSecureContext) {
    set({ error: 'Downloads need a secure page. Open the app over https (the dev server started with dev:phone) or from the published site.' })
    return
  }
  await requestPersistence()
  const storedNames = new Set(listStored().map((s) => s.name))
  const todo = replace ? files : files.filter((f) => !storedNames.has(f))
  if (!todo.length) return
  set({ active: true, file: todo[0], fileIdx: 1, fileCount: todo.length, loaded: 0, total: 0 })
  const hashes = await serverHashes()
  const missing: string[] = []
  try {
    for (let i = 0; i < todo.length; i++) {
      const file = todo[i]
      const head = await fetch(DATA_BASE + file, { method: 'HEAD' }).catch(() => null)
      if (!head || !head.ok) {
        missing.push(file)
        continue
      }
      set({ file, fileIdx: i + 1, loaded: 0, total: 0 })
      await downloadToStore(
        DATA_BASE + file,
        file,
        (loaded, total) => set({ active: true, file, loaded, total, fileIdx: i + 1, fileCount: todo.length }),
        undefined,
        hashes.get(file),
      )
      set({ storedAt: Date.now() })
    }
    set({ active: false, skipped: missing })
    if (missing.length < todo.length) reloadUnlessLive('Saved. Reload to use the new maps.')
  } catch (e) {
    const why = e instanceof Error && e.message ? ` (${e.message})` : ''
    set({ active: false, error: `Download failed. Check the connection and try again${why}.`, storedAt: Date.now() })
  }
}

/** Take these files off the phone; the map goes back to the live services on the reload. */
export async function removeFiles(files: string[]): Promise<void> {
  for (const f of files) await deleteStoredFile(f)
  useDownloads.setState({ storedAt: Date.now(), error: null, skipped: [] })
  reloadUnlessLive('Removed. Reload to finish.')
}

/**
 * What the Maps row says, and what its button does. Reads listStored(),
 * the bundle, the server's pending files and the download in progress, so
 * a component showing it should subscribe to useDownloads, useMapUpdates
 * (pending) and useAppStore (online).
 */
export function mapsStatus(): { text: string; action: 'download' | 'none'; files: string[]; replace: boolean; disabled: boolean } {
  const dl = useDownloads.getState()
  if (dl.active) return { text: `Downloading ${dl.fileIdx}/${dl.fileCount}`, action: 'none', files: [], replace: false, disabled: true }
  // only files the server has: one it never built cannot be missing
  const wanted = bundleOnServer(BUNDLES[0].files)
  const stored = new Set(listStored().map((s) => s.name))
  const have = wanted.filter((f) => stored.has(f))
  const pending = useMapUpdates.getState().pending
  const online = useAppStore.getState().online
  const offer = (text: string, files: string[], replace: boolean) =>
    online ? { text, action: 'download' as const, files, replace, disabled: false } : { text: 'Connect to download', action: 'download' as const, files, replace, disabled: true }
  if (have.length > 0 && pending.length > 0) return offer(`${pending.length} new · Download`, pending.map((p) => p.name), true)
  if (have.length === 0) return offer('Download', wanted, false)
  if (have.length < wanted.length) return offer(`${wanted.length - have.length} not saved · Download`, wanted, false)
  return { text: 'All saved', action: 'none', files: [], replace: false, disabled: false }
}
