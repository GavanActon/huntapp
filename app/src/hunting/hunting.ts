import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { withMap } from '../map/mapController'
import { useAppStore, type LayerOpacity, type LayerVisibility } from '../state/appStore'
import { useSpotsStore } from '../state/spotsStore'
import { BUILT_IN, useViews } from '../state/viewsStore'
import { useGpsStore } from '../tracking/gpsStore'
import { afterRecording, locateAndFollow, startGps, stopLocating } from '../tracking/gpsService'
import { startCompass } from '../tracking/compass'
import { useTrackStore } from '../tracking/trackStore'
import { useScent } from '../weather/micro/scent'

/**
 * Hunting mode: out in the bush, not planning at camp. One tap puts the
 * map on you and keeps it there, records the track, puts on the Bow view
 * (open lanes and the old skid trails), and draws your scent cone from
 * where you stand, following you. The cone has its own button on the map
 * to hide it and bring it back; the moose you hear go on the map from the
 * button beside it (HeardCard), with the way he is moving and where he is
 * likely to swing round to wind you (moveLayer).
 *
 * It is made for the phone coming out of a pocket, a look, and back in:
 * the screen sleeps as usual, and a web app gets no fixes then, so each
 * look starts a fresh fix (gpsService), the cone and the moose catch up
 * with the clock, and the track joins its stretches up across the gaps
 * (trackLayer). A reload mid-hunt (a phone drops a web app it has not
 * looked at for a while) picks the same track and the cone back up.
 * Stopping puts the map back as it was.
 */

interface Before {
  layers: LayerVisibility
  opacity: LayerOpacity
  heat: boolean
}

interface HuntingState {
  on: boolean
  startedAt: number | null
  /** the cone on your position: on when hunting starts, with a button to hide it */
  cone: boolean
  /** the track this hunt records */
  trackId: string | null
  /** the map as it was, put back when hunting stops */
  before: Before | null
  setCone: (v: boolean) => void
}

export const useHunting = create<HuntingState>()(
  persist(
    (set) => ({
      on: false,
      startedAt: null,
      cone: true,
      trackId: null,
      before: null,
      setCone: (cone) => set({ cone }),
    }),
    { name: 'huntapp-hunting', partialize: (s) => ({ on: s.on, startedAt: s.startedAt, cone: s.cone, trackId: s.trackId, before: s.before }) },
  ),
)

const BOW = BUILT_IN.find((v) => v.id === 'hunt-bow')!

/** Go hunting. From a tap: iOS asks for the compass only from one. */
export function startHunting() {
  if (useHunting.getState().on) return
  const a = useAppStore.getState()
  const before: Before = { layers: { ...a.layers }, opacity: { ...a.opacity }, heat: useSpotsStore.getState().heat }
  // the air now, not whatever hour was being planned
  a.setPlanTime(null)
  useViews.getState().setMode('hunt')
  useViews.getState().apply(BOW)
  locateAndFollow()
  // close enough for the lanes and the cone (the bush layer starts at z14), on you if the phone
  // knows where; a jump, since following the first fix would cut an animation short
  const fix = useGpsStore.getState().fix
  withMap((m) => m.jumpTo({ zoom: Math.max(m.getZoom(), 15.5), ...(fix ? { center: [fix.lon, fix.lat] as [number, number] } : {}) }))
  const tr = useTrackStore.getState()
  if (!tr.recordingId) tr.start()
  useHunting.setState({ on: true, startedAt: Date.now(), cone: true, trackId: useTrackStore.getState().recordingId, before })
}

export function stopHunting() {
  const h = useHunting.getState()
  if (!h.on) return
  useHunting.setState({ on: false, startedAt: null, trackId: null, before: null })
  useTrackStore.getState().stop()
  stopLocating()
  afterRecording()
  useScent.getState().removeLive()
  if (h.before) {
    // the wind stays as its own button left it
    useAppStore.setState((a) => ({ layers: { ...h.before!.layers, windFlow: a.layers.windFlow }, opacity: h.before!.opacity }))
    useSpotsStore.getState().setHeat(h.before.heat)
  }
}

function metres(a: { lon: number; lat: number }, b: { lon: number; lat: number }): number {
  return Math.hypot((a.lon - b.lon) * 111_320 * Math.cos((a.lat * Math.PI) / 180), (a.lat - b.lat) * 110_574)
}

/** The cone on you: put there with the first good fix, moved once you have walked 10 m. */
function syncCone() {
  const h = useHunting.getState()
  const sc = useScent.getState()
  const k = sc.people.findIndex((p) => p.live)
  if (!h.on || !h.cone) {
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
/** Call once at startup: the cone follows the fixes, and a hunt cut short by a reload carries on. */
export function initHunting() {
  if (wired) return
  wired = true
  useGpsStore.subscribe((s, p) => {
    if (s.fix !== p.fix) syncCone()
  })
  useHunting.subscribe((s, p) => {
    if (s.on !== p.on || s.cone !== p.cone) syncCone()
  })
  // the card's close button hides the cone, same as the map's button
  useScent.subscribe((s, p) => {
    const h = useHunting.getState()
    if (h.on && h.cone && p.people.some((x) => x.live) && !s.people.some((x) => x.live)) useHunting.setState({ cone: false })
  })
  const h = useHunting.getState()
  if (!h.on) return
  const tr = useTrackStore.getState()
  if (!h.trackId || !tr.resume(h.trackId)) {
    tr.start()
    useHunting.setState({ trackId: useTrackStore.getState().recordingId })
  }
  // as locateAndFollow, but no permission prompts: iOS allows those only from a tap
  useGpsStore.getState().setLocating(true)
  useAppStore.getState().setFollow(true)
  startCompass()
  startGps()
}
