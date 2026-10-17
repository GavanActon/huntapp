/**
 * HD on this phone, area by area (docs/SD-HD-PLAN.md): an area baked in HD
 * is drawn at HD inside its box, or, taken off on this phone (the dev
 * builds' Remove, for seeing an HD area as SD side by side), as an SD bake
 * would have it. Read once at start: putting it back or taking it off
 * reloads the app, so a run reads one set of files. The page's head script
 * (index.html) reads the same key for its early fetch of the wind grid. No
 * app imports, so config.ts can read it.
 *
 * Every area baked in HD is yours, on every build (Gavan, 2026-10-16: "For
 * now let's just avoid the accounts. You own the areas we HD'd already"):
 * with signal its HD files stream in as the map asks for them, and the
 * area's save for the bush takes them too. (The install that downloaded them
 * first, with its rings and progress, went with that: 2026-10-17.)
 */

export const HD_KEY = 'huntapp-hd'

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

/** Marks a phone whose choices were read under every HD area being everyone's. */
const SCHEME_KEY = 'huntapp-hd-scheme'

// Once per phone: a false saved before that (an Install never done, or a
// Remove while the install was being tried) goes, so the area opens HD
// like everyone's (Gavan, 2026-10-17: "I'm on pickle. Own it. Didn't change
// the sd to hd"). A Remove after this is kept.
try {
  if (localStorage.getItem(SCHEME_KEY) !== '2') {
    const kept = Object.fromEntries(Object.entries(readAll()).filter(([, v]) => v === true))
    localStorage.setItem(HD_KEY, JSON.stringify(kept))
    localStorage.setItem(SCHEME_KEY, '2')
  }
} catch {
  /* private mode: nothing was kept to clear */
}

/** HD is on for the area on this phone (meaningful for an area baked in HD). */
export function hdInstalled(areaId: string): boolean {
  const v = readAll()[areaId]
  return typeof v === 'boolean' ? v : HD_DEFAULT
}

/** Note the area's HD as on or taken off on this phone; the caller reloads. */
export function setHdInstalled(areaId: string, on: boolean): void {
  try {
    localStorage.setItem(HD_KEY, JSON.stringify({ ...readAll(), [areaId]: on }))
  } catch {
    /* private mode: the default on the next open */
  }
}
