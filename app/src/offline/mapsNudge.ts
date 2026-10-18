/**
 * The quiet word that the area's maps are not on the phone: a row in the
 * ⋯ menu while there is signal and something to save, and a dot on the ⋯
 * button until the menu has been opened once with the row in it (then not
 * for a week). Gavan, 2026-10-07: a call-out when stuff isn't downloaded,
 * said as what is so, never as "you're doing it wrong". No signal has its
 * own chip (App); a download running has the Settings row.
 *
 * Since the grids keep themselves after a first open (spots/habitatGrid.ts),
 * the row can say what already works without signal: the wind and the
 * spots do, the map itself does not yet.
 */
import { ACTIVE_AREA } from '../areas'
import { useAreaLook } from '../areas/lookSwitch'
import { habitatFile, microFile } from '../config'
import { useAppStore } from '../state/appStore'
import { useDownloads, mapsStatus } from './downloads'
import { manifestGet } from './fileStore'
import { bytesOf, useMapUpdates } from './updates'

const SEEN_KEY = (id: string) => `huntapp-maps-nudge-seen:${id}`
const SEEN_FOR_MS = 7 * 86_400_000

function seenLately(id: string): boolean {
  try {
    const ts = Number(localStorage.getItem(SEEN_KEY(id)) ?? 0)
    return ts > 0 && Date.now() - ts < SEEN_FOR_MS
  } catch {
    return false
  }
}

/** The menu was opened with the row in it: the dot rests for a week. */
export function markNudgeSeen(id: string = ACTIVE_AREA.id): void {
  try {
    localStorage.setItem(SEEN_KEY(id), String(Date.now()))
  } catch {
    /* private mode: the dot stays */
  }
}

export interface MapsNudge {
  /** the row shows: signal, and files of this area's bundle the phone lacks */
  show: boolean
  /** the dot on the ⋯ button shows */
  dot: boolean
  /** what a download would bring, 0 before the server's list has been seen */
  bytes: number
  /** the wind and habitat grids are already on the phone (kept from a view or saved) */
  gridsKept: boolean
  /** this area's download is running: the row says so instead */
  downloading: boolean
  /** the files to download */
  files: string[]
}

/** Read inside a component: re-renders with the stores it reads. */
export function useMapsNudge(): MapsNudge {
  const online = useAppStore((s) => s.online)
  // the run's start and end and what it saved, not its every chunk: the strip and the menu read this
  const active = useDownloads((s) => s.active)
  const areaId = useDownloads((s) => s.areaId)
  useDownloads((s) => s.storedAt)
  // the server's list landing (bootManifest) and the pending list both change the answer
  useMapUpdates((s) => s.onServer)
  useMapUpdates((s) => s.pending)
  const maps = mapsStatus()
  const downloading = active && areaId === ACTIVE_AREA.id
  // the row is about this area's maps: not while the view is over another area, or over none (the strip's line speaks for those)
  const looking = useAreaLook((s) => s.looking)
  // new maps on the server have the badge beside Settings already (replace)
  const show = online && !downloading && maps.action === 'download' && !maps.replace && maps.files.length > 0 && looking?.id === ACTIVE_AREA.id
  const gridsKept = manifestGet(microFile()) != null && manifestGet(habitatFile()) != null
  return { show, dot: show && !seenLately(ACTIVE_AREA.id), bytes: bytesOf(maps.files), gridsKept, downloading, files: maps.files }
}
