import { create } from 'zustand'
import { ACTIVE_AREA, areaById, fileUrl } from '../areas'
import { useAppStore } from '../state/appStore'
import { flushTrackSave } from '../tracking/trackStore'
import { carryPlaced } from '../weather/micro/scent'
import { fetchAreaWeather } from '../weather/refresh'
import { deleteStoredFile, downloadToStore, listStored, requestPersistence } from './fileStore'
import { canKeepSharp, removeSharp, saveSharp, sharpBytes, sharpOf, sharpSaved } from './sharpImagery'
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
  /** the last run's failure */
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

/** Saved or removed maps come into use on a reload, and only the area the
 *  app is in has any in use, so for it the reload is made at once: it used
 *  to wait with people placed by hand and ask for one ("just make it
 *  happen", Gavan, 2026-10-08). They are carried over it (scent.ts
 *  carryPlaced), the live cone and the party come back by themselves, and
 *  the walk being recorded is written first. The new-maps list follows
 *  what is saved now either way, for the other areas' rows. */
function afterChange(areaId: string) {
  refreshPending()
  if (areaId !== ACTIVE_AREA.id) return
  carryPlaced()
  flushTrackSave()
  window.location.reload()
}

/** The download's last step's name, an area's sharp imagery fetched across it (sharpImagery.ts). */
export const SHARP_STEP = 'Sharp imagery'

/** Download the area's files not on the phone, or with `replace` these files whether or not they are;
 *  then, with `sharp`, its sharp imagery across it, if it has some not fetched yet. The imagery
 *  alone (no files) makes no reload: the worker serves each tile as it lands. */
export async function downloadFiles(files: string[], replace = false, areaId: string = ACTIVE_AREA.id, withSharp = false): Promise<void> {
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
  const sharp = withSharp && !!sharpOf(areaId) && !sharpSaved(areaId) && canKeepSharp()
  if (!todo.length && !sharp) return
  const steps = todo.length + (sharp ? 1 : 0)
  set({ active: true, file: todo[0] ?? SHARP_STEP, fileIdx: 1, fileCount: steps, loaded: 0, total: 0 })
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
        (loaded, total) => set({ active: true, file, loaded, total, fileIdx: i + 1, fileCount: steps }),
        undefined,
        manifest?.files[file]?.hash,
      )
      set({ storedAt: Date.now() })
    }
    // the sharp imagery, the tiles a pan round the area at each zoom would bring, into the worker's
    // cache (the bar in bytes, the whole guessed from the tiles so far); before the reload below
    if (sharp) {
      set({ file: SHARP_STEP, fileIdx: steps, loaded: 0, total: sharpBytes(areaId) })
      const got = await saveSharp(areaId, (done, n, bytes) => set({ loaded: bytes, total: Math.round((bytes / Math.max(1, done)) * n) }))
      if (got && !sharpSaved(areaId)) set({ error: `${got.total - got.ok} of ${got.total} sharp imagery tiles did not come. Download again for the rest.` })
      set({ storedAt: Date.now() })
    }
    set({ active: false, skipped: missing })
    if (missing.length < todo.length) {
      afterChange(areaId)
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
  await removeSharp(areaId)
  useDownloads.setState({ storedAt: Date.now(), error: null, skipped: [], areaId })
  afterChange(areaId)
}

/** Take the area's sharp imagery off the phone and keep its maps: with signal
 *  the map streams it again, with none it shows the area's own satellite. */
export async function removeSharpOnly(areaId: string): Promise<void> {
  await removeSharp(areaId)
  useDownloads.setState({ storedAt: Date.now(), error: null, areaId })
}

export interface MapsStatus {
  text: string
  action: 'download' | 'none'
  files: string[]
  replace: boolean
  /** the sharp imagery comes too (downloadFiles' `withSharp`) */
  sharp: boolean
  disabled: boolean
}

/**
 * What an area's Maps row says, and what its button does (the area the
 * app is in unless another is named). Reads listStored(), the bundle, the
 * server's pending files and the download in progress, so a component
 * showing it should subscribe to useDownloads, useMapUpdates (pending)
 * and useAppStore (online).
 *
 * The sharp imagery comes with a save (Gavan, 2026-10-09: Download also
 * fires off a pan round the area) but not with new maps from the server,
 * which are the changed files alone, in seconds, not the changed files and
 * minutes of imagery (Gavan, 2026-10-09: "fetching is really slow"); then
 * it is its own step.
 */
export function mapsStatus(areaId: string = ACTIVE_AREA.id): MapsStatus {
  const dl = useDownloads.getState()
  const none = { action: 'none' as const, files: [], replace: false, sharp: false }
  if (dl.active && dl.areaId === areaId) return { ...none, text: `Downloading ${dl.fileIdx}/${dl.fileCount}`, disabled: true }
  const bundle = bundleOf(areaId)
  if (!bundle) return { ...none, text: '', disabled: true }
  // only files the server has: one it never built cannot be missing
  const wanted = bundleOnServer(bundle.files, areaId)
  const stored = new Set(listStored().map((s) => s.name))
  const have = wanted.filter((f) => stored.has(f))
  const pending = useMapUpdates.getState().pending.filter((p) => p.area === areaId)
  const online = useAppStore.getState().online
  // another area's download running: this one waits its turn
  const offer = (text: string, files: string[], replace: boolean, sharp = false) =>
    online ? { text, action: 'download' as const, files, replace, sharp, disabled: dl.active } : { text: 'Connect to download', action: 'download' as const, files, replace, sharp, disabled: true }
  if (have.length > 0 && pending.length > 0) return offer(`${pending.length} new · Download`, pending.map((p) => p.name), true)
  if (have.length === 0) return offer('Download', wanted, false, true)
  // a phone that opened the area keeps its grids already (staged grids): its first save is this one
  if (have.length < wanted.length) return offer(`${wanted.length - have.length} not saved · Download`, wanted, false, true)
  // the files all here, the sharp imagery not fetched across the area yet (a phone that saved
  // before it had any, an update, or a sweep cut off): its own step
  if (!sharpSaved(areaId) && canKeepSharp()) return offer(`${SHARP_STEP} · Download`, [], false, true)
  return { ...none, text: 'All saved', disabled: false }
}

/** The Maps row's button: its files (and the imagery, when the row says so), or the imagery alone. */
export function runMaps(m: MapsStatus, areaId: string = ACTIVE_AREA.id): Promise<void> {
  return downloadFiles(m.files, m.replace, areaId, m.sharp)
}
