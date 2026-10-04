import { create } from 'zustand'
import { ACTIVE_AREA, areaById, fileUrl } from '../areas'
import { useAppStore } from '../state/appStore'
import { useScent } from '../weather/micro/scent'
import { fetchAreaWeather } from '../weather/refresh'
import { deleteStoredFile, downloadToStore, listStored, requestPersistence } from './fileStore'
import { bundleOf, bundleOnServer, refreshPending, serverManifest, useMapUpdates } from './updates'

/**
 * Downloading an area's baked maps to the phone, as a store rather than a
 * panel's state, so a download started from Settings carries on with the
 * sheet closed and the Maps row can say how far it has got. Files the
 * pipeline has not produced yet are skipped with a note, not an error, so
 * a partial build is still downloadable. One run at a time, whichever
 * area it is for.
 */

interface DownloadState {
  /** a download is running */
  active: boolean
  /** the area the run is for, or the last one was: its block shows the progress and the notes */
  areaId: string
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
  areaId: ACTIVE_AREA.id,
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

/** Saved or removed maps come into use on a reload, and only the area the
 *  app is in has any in use: another area's change needs none, just the
 *  new-maps list brought up to date. */
function afterChange(areaId: string, note: string) {
  if (areaId === ACTIVE_AREA.id) reloadUnlessLive(note)
  else refreshPending()
}

/** Download the area's files not on the phone, or with `replace` these files whether or not they are. */
export async function downloadFiles(files: string[], replace = false, areaId: string = ACTIVE_AREA.id): Promise<void> {
  const set = useDownloads.setState
  if (useDownloads.getState().active) return
  set({ error: null, skipped: [], areaId })
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
  const manifest = await serverManifest(areaId)
  const missing: string[] = []
  try {
    for (let i = 0; i < todo.length; i++) {
      const file = todo[i]
      // the area's manifest says what the server has baked; without one, the file itself is asked
      if (manifest && !manifest.files[file]) {
        missing.push(file)
        continue
      }
      const url = fileUrl(file, areaId)
      const head = await fetch(url, { method: 'HEAD' }).catch(() => null)
      // the dev server answers a file it does not have with the app's page
      if (!head || !head.ok || /text\/html/i.test(head.headers.get('content-type') ?? '')) {
        missing.push(file)
        continue
      }
      set({ file, fileIdx: i + 1, loaded: 0, total: 0 })
      await downloadToStore(
        url,
        file,
        (loaded, total) => set({ active: true, file, loaded, total, fileIdx: i + 1, fileCount: todo.length }),
        undefined,
        manifest?.files[file]?.hash,
      )
      set({ storedAt: Date.now() })
    }
    set({ active: false, skipped: missing })
    if (missing.length < todo.length) {
      afterChange(areaId, 'Saved. Reload to use the new maps.')
      // another area's maps saved while there is signal: its weather too, so
      // a first arrival with none has a forecast to work the ground wind from
      // (the area the app is in has the sweep's already)
      const area = areaById(areaId)
      if (area) void fetchAreaWeather(area)
    }
  } catch (e) {
    const why = e instanceof Error && e.message ? ` (${e.message})` : ''
    set({ active: false, error: `Download failed. Check the connection and try again${why}.`, storedAt: Date.now() })
  }
}

/** Take these files of the area off the phone; the area the app is in goes back to the live services on the reload. */
export async function removeFiles(files: string[], areaId: string = ACTIVE_AREA.id): Promise<void> {
  for (const f of files) await deleteStoredFile(f)
  useDownloads.setState({ storedAt: Date.now(), error: null, skipped: [], areaId })
  afterChange(areaId, 'Removed. Reload to finish.')
}

/**
 * What an area's Maps row says, and what its button does (the area the
 * app is in unless another is named). Reads listStored(), the bundle, the
 * server's pending files and the download in progress, so a component
 * showing it should subscribe to useDownloads, useMapUpdates (pending)
 * and useAppStore (online).
 */
export function mapsStatus(areaId: string = ACTIVE_AREA.id): { text: string; action: 'download' | 'none'; files: string[]; replace: boolean; disabled: boolean } {
  const dl = useDownloads.getState()
  if (dl.active && dl.areaId === areaId) return { text: `Downloading ${dl.fileIdx}/${dl.fileCount}`, action: 'none', files: [], replace: false, disabled: true }
  const bundle = bundleOf(areaId)
  if (!bundle) return { text: '', action: 'none', files: [], replace: false, disabled: true }
  // only files the server has: one it never built cannot be missing
  const wanted = bundleOnServer(bundle.files, areaId)
  const stored = new Set(listStored().map((s) => s.name))
  const have = wanted.filter((f) => stored.has(f))
  const pending = useMapUpdates.getState().pending.filter((p) => p.area === areaId)
  const online = useAppStore.getState().online
  // another area's download running: this one waits its turn
  const offer = (text: string, files: string[], replace: boolean) =>
    online ? { text, action: 'download' as const, files, replace, disabled: dl.active } : { text: 'Connect to download', action: 'download' as const, files, replace, disabled: true }
  if (have.length > 0 && pending.length > 0) return offer(`${pending.length} new · Download`, pending.map((p) => p.name), true)
  if (have.length === 0) return offer('Download', wanted, false)
  if (have.length < wanted.length) return offer(`${wanted.length - have.length} not saved · Download`, wanted, false)
  return { text: 'All saved', action: 'none', files: [], replace: false, disabled: false }
}
