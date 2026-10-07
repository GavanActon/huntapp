/**
 * What an area switch leaves for the run it loads into (areas/switch.ts):
 * kept in sessionStorage, which a reload keeps and a new launch does not,
 * and taken once, so a second reload does not do it again. A link the page
 * opened on asks the same of the run it starts (areas/index.ts): no reload
 * in between, so that is held here in memory and comes first. Nothing here
 * imports the app, so the GPS service can read it at startup.
 */

/** Once the app has opened in the new area: show a spot (a link's, a Go to's),
 *  pick a place (and open Pins on it), open an outing, or put up a log
 *  entry's or a wind check's popup; or only look: the view the switch opens
 *  on is the point. A follow-up of any kind keeps follow off, so the first
 *  fix does not take the map off it. A link's spot carries the link
 *  (areas/start.ts linkMark), noted as shown once it is up. */
export type SwitchThen =
  | { kind: 'look' }
  | { kind: 'spot'; lon: number; lat: number; name?: string; link?: string }
  | { kind: 'select'; id: string; pins?: boolean }
  | { kind: 'outing'; id: string }
  | { kind: 'entry'; id: string }
  | { kind: 'check'; id: string }

const THEN_KEY = 'huntapp-switch-then'
const HOLD_KEY = 'huntapp-switch-hold-follow'
/** The last link this tab showed (areas/start.ts linkMark). */
const LINK_KEY = 'huntapp-link-done'

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

/** A link's spot, asked for by the page as it starts. */
let nowThen: SwitchThen | null = null
let nowHold = false

/** Left by the switch just before it loads the new area. */
export function leaveHandoff(then: SwitchThen | undefined, holdFollow: boolean): void {
  if (then) set(THEN_KEY, JSON.stringify(then))
  if (holdFollow) set(HOLD_KEY, '1')
}

/** Left by the page itself, as it starts on a link (areas/index.ts). */
export function arriveNow(then: SwitchThen, holdFollow: boolean): void {
  nowThen = then
  nowHold = holdFollow
}

/** True once after a switch, or a link, that should not bring follow back
 *  on with location (gpsService.resumeLocation). */
export function takeHoldFollow(): boolean {
  const left = take(HOLD_KEY) === '1'
  const hold = nowHold
  nowHold = false
  return hold || left
}

/** What the switch, or the link, that opened this run asked for next, once.
 *  A switch's left from before a link was opened in the same tab goes: the
 *  link is what was asked for last. */
export function takeSwitchThen(): SwitchThen | null {
  const t = readThen(take(THEN_KEY))
  nowThen = null
  runKind = t?.kind ?? null
  return t
}

function readThen(raw: string | null): SwitchThen | null {
  if (nowThen) return nowThen
  if (!raw) return null
  try {
    const t = JSON.parse(raw) as SwitchThen
    return t && typeof t.kind === 'string' ? t : null
  } catch {
    return null
  }
}

/** What this run was opened for, once looked at: kept after it is taken,
 *  for the map's opening, which is made after the app has taken it. */
let runKind: SwitchThen['kind'] | null | undefined

/** What takeSwitchThen hands over (or handed over), without taking it: the map's
 *  opening (MapView) goes straight to the view a switch's or a link's
 *  follow-up is about, without the zoom in from further out. */
export function peekSwitchThen(): SwitchThen['kind'] | null {
  if (runKind !== undefined) return runKind
  let raw: string | null = null
  try {
    raw = sessionStorage.getItem(THEN_KEY)
  } catch {
    /* private mode: nothing was left */
  }
  return readThen(raw)?.kind ?? null
}

/** The link this tab last showed, so a reload or a restored tab does not
 *  open on it again; undefined when the tab's storage cannot be read, and
 *  no mark can be kept. */
export function linkDone(): string | null | undefined {
  try {
    return sessionStorage.getItem(LINK_KEY)
  } catch {
    return undefined
  }
}

export function noteLinkDone(mark: string): void {
  set(LINK_KEY, mark)
}

/** The app loads another area itself (areas/switch.ts): the link is done
 *  with. Its history entry goes with the switch's location.replace and the
 *  new address carries no link, so the next load of it in this tab is a
 *  fresh tap, and shows the spot again. */
export function forgetLinkDone(): void {
  try {
    sessionStorage.removeItem(LINK_KEY)
  } catch {
    /* private mode */
  }
}
