/**
 * Which grade the map is shown at on this phone: HD, everything the area's
 * HD bake made, or SD, the area as an SD bake would have it (no LiDAR shade,
 * no fine contours, no shooting lanes, no measured bush, the SD wind). Only
 * an HD area can be shown as SD; an SD area is SD either way (config.ts
 * GRADE). Kept on the phone and read once at start: switching reloads the
 * app, so a run reads one set of files. The page's head script (index.html)
 * reads the same key for its early fetch of the wind grid. No imports, so
 * config.ts can read it.
 */
export type Grade = 'hd' | 'sd'

export const GRADE_KEY = 'huntapp-grade'

/** Set for the run after a switch, so the new grade can say what came on or went. */
const FLIPPED_KEY = 'huntapp-grade-flipped'

/** The grade chosen on this phone, HD until it is set (or when storage is shut). */
export function gradeChoice(): Grade {
  try {
    return localStorage.getItem(GRADE_KEY) === 'sd' ? 'sd' : 'hd'
  } catch {
    return 'hd'
  }
}

/** Choose a grade and reload into it. */
export function switchGrade(g: Grade): void {
  try {
    localStorage.setItem(GRADE_KEY, g)
    sessionStorage.setItem(FLIPPED_KEY, g)
  } catch {
    /* private mode: nothing to switch to */
    return
  }
  window.location.reload()
}

/** The grade the app was just switched to, once: the first read clears it. */
export function takeFlipped(): Grade | null {
  try {
    const g = sessionStorage.getItem(FLIPPED_KEY)
    sessionStorage.removeItem(FLIPPED_KEY)
    return g === 'sd' || g === 'hd' ? g : null
  } catch {
    return null
  }
}
