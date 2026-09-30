import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useGpsStore } from '../tracking/gpsStore'
import { useScent } from '../weather/micro/scent'

/**
 * Your scent cone, live: the cone drawn from where you stand and moved
 * with you as the fixes come. One button on the map turns it on and off
 * while location is on; with location off the same button waits for a tap
 * on the map and sits the cone there. Location off leaves a live cone
 * where it was.
 *
 * There is no hunting mode. The phone comes out of a pocket, gets a look,
 * and goes back: each look starts a fresh fix (gpsService) and the cone
 * catches up with the clock (scent.ts). The choice sticks across a reload.
 */

interface HuntingState {
  /** the cone on your position, following you */
  cone: boolean
  setCone: (v: boolean) => void
}

export const useHunting = create<HuntingState>()(
  persist(
    (set) => ({
      cone: false,
      setCone: (cone) => set({ cone }),
    }),
    {
      name: 'huntapp-hunting',
      version: 1,
      partialize: (s) => ({ cone: s.cone }),
      // the old hunting mode's keys (on, startedAt, trackId, before) are dropped
      migrate: (p, from) => (from < 1 ? { cone: false } : (p as { cone: boolean })),
    },
  ),
)

/** The Scent button. With location on: the cone on you (off again on the
 *  next tap). With location off: the next map tap is where the cone sits, a
 *  person placed; tapping again before that cancels. */
export function toggleCone(): void {
  const sc = useScent.getState()
  if (sc.adding) return sc.setAdding(false)
  if (useHunting.getState().cone) return useHunting.getState().setCone(false)
  if (useGpsStore.getState().locating) return useHunting.getState().setCone(true)
  sc.setAdding(true)
}

/** The Scent button's lit state: the cone on you, or a tap being waited for. */
export function coneLit(): boolean {
  return useHunting.getState().cone || useScent.getState().adding
}

function metres(a: { lon: number; lat: number }, b: { lon: number; lat: number }): number {
  return Math.hypot((a.lon - b.lon) * 111_320 * Math.cos((a.lat * Math.PI) / 180), (a.lat - b.lat) * 110_574)
}

/** The cone on you: put there with the first good fix, moved once you have walked 10 m. */
function syncCone() {
  const sc = useScent.getState()
  const k = sc.people.findIndex((p) => p.live)
  if (!useHunting.getState().cone) {
    if (k >= 0) sc.removeLive()
    return
  }
  const fix = useGpsStore.getState().fix
  // a coarse fix would put the cone somewhere you are not
  if (!fix || (fix.sigma ?? fix.accuracy) > 40) return
  if (k < 0) sc.putLive(fix.lon, fix.lat)
  else if (metres(sc.people[k], fix) >= 10) sc.move(k, fix.lon, fix.lat)
}

let wired = false
/** Call once at startup: the cone follows the fixes and its button. */
export function initLive(): void {
  if (wired) return
  wired = true
  useGpsStore.subscribe((s, p) => {
    if (s.fix !== p.fix) syncCone()
  })
  useHunting.subscribe((s, p) => {
    if (s.cone !== p.cone) syncCone()
  })
  // the live person taken off the map some other way (a full clear): the button follows.
  // clearPlaced() never removes the live one, so it never trips this.
  useScent.subscribe((s, p) => {
    if (useHunting.getState().cone && p.people.some((x) => x.live) && !s.people.some((x) => x.live)) useHunting.setState({ cone: false })
  })
}
