/**
 * HD on this phone, area by area (docs/SD-HD-PLAN.md): an area baked in HD
 * is either installed here (its HD files on the phone or in use, the map
 * drawn at HD inside its box) or not yet, when the map is the area as an SD
 * bake would have it and the grade sheet offers Install. Read once at start:
 * installing or removing reloads the app, so a run reads one set of files.
 * The page's head script (index.html) reads the same key for its early fetch
 * of the wind grid. No app imports, so config.ts can read it.
 *
 * Every area baked in HD is yours, on every build (Gavan, 2026-10-16: "For
 * now let's just avoid the accounts. You own the areas we HD'd already"):
 * with signal its HD files stream in as the map asks for them, and the
 * area's save for the bush takes them too. An explicit false is the dev
 * builds' Remove, kept for seeing an HD area as SD side by side.
 */

export const HD_KEY = 'huntapp-hd'

/** Set for the run after an install or a removal, so the map can say what came on or went. */
const FLIPPED_KEY = 'huntapp-hd-flipped'

/** What an HD area is with nothing saved: on (no accounts yet, so every HD area is everyone's). */
export const HD_DEFAULT = true

function readAll(): Record<string, boolean> {
  try {
    const j = JSON.parse(localStorage.getItem(HD_KEY) ?? '{}') as unknown
    return j && typeof j === 'object' ? (j as Record<string, boolean>) : {}
  } catch {
    return {}
  }
}

/** HD is on for the area on this phone (meaningful for an area baked in HD). */
export function hdInstalled(areaId: string): boolean {
  const v = readAll()[areaId]
  return typeof v === 'boolean' ? v : HD_DEFAULT
}

/** Note the area's HD as installed or not; the caller reloads. */
export function setHdInstalled(areaId: string, on: boolean): void {
  try {
    localStorage.setItem(HD_KEY, JSON.stringify({ ...readAll(), [areaId]: on }))
  } catch {
    /* private mode: the default on the next open */
  }
}

export type HdFlip = 'installed' | 'removed'

export function markFlip(f: HdFlip): void {
  try {
    sessionStorage.setItem(FLIPPED_KEY, f)
  } catch {
    /* no chip, no harm */
  }
}

/** What the app was just told to do with HD, once: the first read clears it. */
export function takeFlipped(): HdFlip | null {
  try {
    const f = sessionStorage.getItem(FLIPPED_KEY)
    sessionStorage.removeItem(FLIPPED_KEY)
    return f === 'installed' || f === 'removed' ? f : null
  } catch {
    return null
  }
}
