/**
 * What an area switch leaves for the run it reloads into (areas/switch.ts):
 * kept in sessionStorage, which a reload keeps and a new launch does not,
 * and taken once, so a second reload does not do it again. Nothing here
 * imports the app, so the GPS service can read it at startup.
 */

/** Once the app has opened in the new area: drop a pin, pick a place (and
 *  open Pins on it), open an outing, or put up a log entry's or a wind
 *  check's popup; or only look, a Go to a point: the view the switch opens
 *  on is the point, and a follow-up of any kind keeps follow off, so the
 *  first fix does not take the map off it. */
export type SwitchThen =
  | { kind: 'look' }
  | { kind: 'pin'; lon: number; lat: number }
  | { kind: 'select'; id: string; pins?: boolean }
  | { kind: 'outing'; id: string }
  | { kind: 'entry'; id: string }
  | { kind: 'check'; id: string }

const THEN_KEY = 'huntapp-switch-then'
const HOLD_KEY = 'huntapp-switch-hold-follow'

function set(key: string, value: string) {
  try {
    sessionStorage.setItem(key, value)
  } catch {
    /* private mode: the switch still happens, without its follow-up */
  }
}

function take(key: string): string | null {
  try {
    const v = sessionStorage.getItem(key)
    sessionStorage.removeItem(key)
    return v
  } catch {
    return null
  }
}

/** Left by the switch just before it reloads. */
export function leaveHandoff(then: SwitchThen | undefined, holdFollow: boolean): void {
  if (then) set(THEN_KEY, JSON.stringify(then))
  if (holdFollow) set(HOLD_KEY, '1')
}

/** True once after a switch that should not bring follow back on with
 *  location (gpsService.resumeLocation). */
export function takeHoldFollow(): boolean {
  return take(HOLD_KEY) === '1'
}

/** What the switch that opened this run asked for next, once. */
export function takeSwitchThen(): SwitchThen | null {
  const raw = take(THEN_KEY)
  if (!raw) return null
  try {
    const t = JSON.parse(raw) as SwitchThen
    return t && typeof t.kind === 'string' ? t : null
  } catch {
    return null
  }
}
