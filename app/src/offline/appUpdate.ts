import { create } from 'zustand'
import { registerSW } from 'virtual:pwa-register'
import { devlog } from '../devlog'
import { BUILD } from '../diagnostics'

/**
 * A phone on an old build. The app is installed as a PWA and the service
 * worker serves the bundle it has; a new deploy only reaches the phone
 * when the worker next checks, which an app that stays open on the home
 * screen may not do for days (Gavan, 2026-10-02: the PC had the new build,
 * the phone did not). So the app asks the server itself.
 *
 *  - The build writes version.json beside the bundle (vite.config.ts): the
 *    short sha and the time. It is never precached, and is fetched past
 *    every cache. The sha is compared with the one stamped into this
 *    bundle; a different one means a newer build is there, and the worker
 *    is told to update at once instead of in its own time.
 *  - When the new worker takes control, this page is still the old code
 *    until it reloads. A reload is done at once when the page is young
 *    (FRESH_MS: a reload or a cold open that found a newer build, nothing
 *    in hand yet; without this one reload after a deploy landed on the
 *    old build, the new worker in control but the old page still up:
 *    Gavan, 2026-10-08, "did the reload") and the moment the app is
 *    brought to the front; open and in use, a chip offers it instead, and
 *    Settings says which build is here and which is there.
 *  - Checks: on start, when the app comes to the front, when signal
 *    returns, and every half hour; never more than once a minute.
 */

interface AppUpdateState {
  /** the build on the server when it differs from this one */
  latest: string | null
  /** a new worker is in control: a reload runs the new build */
  ready: boolean
  checking: boolean
  checkedAt: number
}

export const useAppUpdate = create<AppUpdateState>(() => ({ latest: null, ready: false, checking: false, checkedAt: 0 }))

let reg: ServiceWorkerRegistration | undefined
let lastCheck = 0
const loadedAt = Date.now()
/** a page this young has nothing in hand: a new build in control is run at once */
const FRESH_MS = 20_000
const MIN_GAP_MS = 60_000
const PERIOD_MS = 30 * 60_000

/** Ask the server which build it has. `force` ignores the minute's gap (the Settings button). */
export async function checkAppUpdate(force = false): Promise<void> {
  if (!navigator.onLine) return
  const now = Date.now()
  if (!force && now - lastCheck < MIN_GAP_MS) return
  lastCheck = now
  useAppUpdate.setState({ checking: true })
  try {
    const r = await fetch(`${import.meta.env.BASE_URL}version.json?t=${now}`, { cache: 'no-store' })
    if (!r.ok) throw new Error(`version.json ${r.status}`)
    const v = (await r.json()) as { sha: string; at: string }
    const newer = v.sha !== BUILD.sha
    useAppUpdate.setState({ latest: newer ? v.sha : null, checkedAt: Date.now() })
    devlog('app', `build ${BUILD.sha} here · ${v.sha} on the server${newer ? ' · newer' : ''}`)
    // the worker fetches the new bundle now; when it takes over, `ready`
    if (newer && reg) await reg.update()
  } catch (e) {
    devlog('app', `version check failed · ${(e as Error).message}`)
  } finally {
    useAppUpdate.setState({ checking: false })
  }
}

/** Run the new build: a plain reload, the new worker serving the new files. */
export function reloadApp(): void {
  window.location.reload()
}

let wired = false

/** `after`: the worker is registered once this settles (App: the wind up on
 *  a cold open), since its install fetches the bundle's files again for its
 *  cache, some 0.8 MB that otherwise ran beside the grids on the line. */
export function initAppUpdate(after?: Promise<unknown>): void {
  if (wired) return
  wired = true
  const register = () =>
    registerSW({
      immediate: true,
      // the plugin would reload the page the moment the new worker is in;
      // in use, the chip offers it instead (and coming to the front reloads)
      onNeedReload: () => {
        useAppUpdate.setState({ ready: true })
        if (Date.now() - loadedAt < FRESH_MS) reloadApp()
      },
      onRegisteredSW(_url, r) {
        reg = r
        if (r && useAppUpdate.getState().latest) void r.update()
      },
    })
  if (after) void after.then(register, register)
  else register()
  if ('serviceWorker' in navigator) {
    // the first worker taking control is the install, not an update
    let had = navigator.serviceWorker.controller != null
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!had) {
        had = true
        return
      }
      devlog('app', 'new build ready')
      useAppUpdate.setState({ ready: true })
      if (Date.now() - loadedAt < FRESH_MS) reloadApp()
    })
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return
    // brought to the front onto a new build: nothing is in hand, reload now
    if (useAppUpdate.getState().ready) return reloadApp()
    void checkAppUpdate()
  })
  window.addEventListener('online', () => void checkAppUpdate())
  window.setInterval(() => void checkAppUpdate(), PERIOD_MS)
  void checkAppUpdate(true)
}
