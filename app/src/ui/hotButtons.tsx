import { useEffect, useRef, useState, type JSX } from 'react'
import { inRegion } from '../config'
import { toggleCone, useHunting } from '../hunting/hunting'
import { getMap } from '../map/mapController'
import { DROPPED_NAME, openPinSheet } from '../map/placePopup'
import { useMeasureStore } from '../measure/measureStore'
import { startPath } from '../paths/pathLayer'
import { usePaths } from '../paths/pathStore'
import { closeRoutes, openRoutes, useRoutes } from '../routes/routeStore'
import { HIDDEN_HOT, useAppStore, type HotId, type LayerVisibility } from '../state/appStore'
import { usePlacesStore } from '../state/placesStore'
import { useGpsStore } from '../tracking/gpsStore'
import { useScent } from '../weather/micro/scent'
import { HotDot, hotAbsent, hotMark, openGrade } from './grade'
import { useHeardForm } from './HeardCard'
import { useCheckForm } from './WindCheckCard'
import { OFFER_WORDS, useCheckOffer } from './checkOffer'
import { toast } from './Toast'
import { Icon3D, IconBush, IconContour, IconDepth, IconDots, IconEar, IconLanes, IconPath, IconPin, IconPowder, IconRadar, IconRoute, IconRuler, IconScent, IconWind } from './icons'
import { logWindHere } from './logWindHere'

/**
 * The hot buttons: what either column can hold (Map buttons places them,
 * any number per side per mode). Each knows its icon, its two names (the editor's and the
 * short one under the button), whether it reads as on, and what a tap
 * does. The on state is always read from the store it acts on, so a
 * button agrees with the map whichever way the thing was switched.
 */

/** One hot button: what it is called (the editor), its short label (under
 *  the button), its icon, whether it reads as on, and what a tap does. */
export interface HotDef {
  id: HotId
  name: string
  short: string
  Icon: (p: { size?: number }) => JSX.Element
  useActive: () => boolean
  onTap: () => void
  /** an offer the button makes now (the wind check's "Check now"): its label in place of `short`, its key */
  useOffer?: () => { id: string; due: number; label: string } | null
}

const off = () => false

/** A pin at the middle of the map (your exact position while the map
 *  follows you) and its sheet open on it: the name, colour and a note right
 *  there. Never selected: the strip and heat stay put. */
function dropPin() {
  const map = getMap()
  if (!map) return
  const { fix, locating } = useGpsStore.getState()
  const following = locating && useAppStore.getState().follow
  let lon: number
  let lat: number
  if (fix && following && inRegion(fix.lon, fix.lat)) {
    lon = fix.lon
    lat = fix.lat
  } else {
    const c = map.getCenter()
    lon = c.lng
    lat = c.lat
  }
  const sp = usePlacesStore.getState().add({ name: DROPPED_NAME, lon, lat, kind: 'stand' })
  openPinSheet(sp.id, { fresh: true })
}

/** A map layer as a hot button: on when the layer is. */
function layerDef(id: HotId, k: keyof LayerVisibility, name: string, short: string, Icon: HotDef['Icon']): HotDef {
  return {
    id,
    name,
    short,
    Icon,
    useActive: () => useAppStore((s) => s.layers[k]),
    onTap: () => {
      const st = useAppStore.getState()
      st.setLayer(k, !st.layers[k])
    },
  }
}

export const HOT_DEFS: Record<HotId, HotDef> = {
  windflow: layerDef('windflow', 'windFlow', 'Wind flow', 'Wind', IconWind),
  routes: {
    id: 'routes',
    name: 'Routes',
    short: 'Route',
    Icon: IconRoute,
    useActive: () => useRoutes((s) => s.open),
    onTap: () => (useRoutes.getState().open ? closeRoutes() : openRoutes()),
  },
  measure: {
    id: 'measure',
    name: 'Measure',
    short: 'Measure',
    Icon: IconRuler,
    useActive: () => useMeasureStore((s) => s.active),
    onTap: () => {
      const m = useMeasureStore.getState()
      if (m.active) return m.stop()
      useAppStore.getState().closeSheet()
      // with location on, the first point is you: the tape starts where you stand
      const fix = useGpsStore.getState().fix
      const you = useGpsStore.getState().locating && fix && inRegion(fix.lon, fix.lat) && (fix.sigma ?? fix.accuracy) <= 50
      m.start(you ? [fix.lon, fix.lat] : undefined, you ? 'you' : undefined)
    },
  },
  // where you plan to walk, drawn freehand as dotted lines, a stroke a path (paths/); a second tap puts it up
  path: {
    id: 'path',
    name: 'Draw a path',
    short: 'Path',
    Icon: IconPath,
    useActive: () => usePaths((s) => s.drawing),
    onTap: () => (usePaths.getState().drawing ? usePaths.getState().done() : startPath()),
  },
  scent: {
    id: 'scent',
    name: 'Scent cone',
    short: 'Scent',
    Icon: IconScent,
    useActive: () => {
      const cone = useHunting((s) => s.cone)
      const placing = useScent((s) => s.adding)
      return cone || placing
    },
    onTap: () => toggleCone(),
  },
  heard: {
    id: 'heard',
    name: 'Game',
    short: 'Game',
    Icon: IconEar,
    useActive: () => useHeardForm((s) => s.placing || s.open),
    // tap, then tap the map where it was, then say what it was
    onTap: () => useHeardForm.getState().arm(),
  },
  contours: layerDef('contours', 'contours', 'LiDAR contours', 'Contours', IconContour),
  windcheck: {
    id: 'windcheck',
    name: 'Sharpen the wind',
    short: 'Sharpen',
    Icon: IconPowder,
    useActive: () => useCheckForm((s) => s.at != null),
    onTap: () => {
      const f = useCheckForm.getState()
      if (f.at != null) f.close()
      else logWindHere()
    },
    // a spot still settling: "Check now" once the next puff is due (ui/checkOffer.ts)
    useOffer: () => {
      const o = useCheckOffer()
      return o ? { id: o.id, due: o.due, label: 'Check now' } : null
    },
  },
  pin: {
    id: 'pin',
    name: 'Pin',
    short: 'Pin',
    Icon: IconPin,
    useActive: off,
    onTap: dropPin,
  },
  understory: layerDef('understory', 'understory', 'Bush thickness', 'Bush', IconBush),
  lanes: layerDef('lanes', 'lanes', 'Shooting lanes', 'Lanes', IconLanes),
  bathy: layerDef('bathy', 'bathy', 'Lake depths', 'Depths', IconDepth),
  radar: layerDef('radar', 'weather', 'Radar', 'Radar', IconRadar),
  // 3D: the map tilted and the ground stood up (map/terrain3d.ts); a hold for how high, and From my sit
  '3d': {
    id: '3d',
    name: '3D',
    short: '3D',
    Icon: Icon3D,
    useActive: () => useAppStore((s) => s.view3d),
    onTap: () => {
      const a = useAppStore.getState()
      a.setView3d(!a.view3d)
    },
  },
  // the tray's buttons, from the map: a tap opens them in its drawer (HotSlot, HotDrawer's MoreRows)
  more: {
    id: 'more',
    name: 'More buttons',
    short: 'More',
    Icon: IconDots,
    useActive: off,
    onTap: () => {},
  },
}

/** Every hot button, in the order the editor's Add chips list them. */
export const HOT_ORDER: HotId[] = ['windcheck', 'scent', 'heard', 'windflow', 'routes', 'measure', 'path', 'contours', 'pin', 'understory', 'lanes', 'bathy', 'radar', '3d', 'more']

export { HIDDEN_HOT }

/** The ids that show, in their order (HIDDEN_HOT, state/appStore.ts, left out). */
export const shownHot = (ids: readonly HotId[]): HotId[] => ids.filter((id) => !HIDDEN_HOT.has(id))

/** The buttons in neither column nor set aside as not wanted: Map buttons' More tier, and what More opens. */
export function trayOf(sets: { near: HotId[]; far: HotId[]; off?: HotId[] }): HotId[] {
  return shownHot(HOT_ORDER).filter((id) => !sets.near.includes(id) && !sets.far.includes(id) && !(sets.off ?? []).includes(id))
}

const HOLD_MS = 450

/** A hot button in the column: the round .fab with its short word hung under
 *  it. A tap does its thing (`onTap`, the def's by default); a press and hold
 *  is `onHold`, the column's drawer (ui/HotDrawer.tsx). */
export function HotButton({ id, onHold, onTap }: { id: HotId; onHold: () => void; onTap?: () => void }): JSX.Element {
  const d = HOT_DEFS[id]
  const on = d.useActive()
  const labels = useAppStore((s) => s.buttonLabels)
  // HD would add it here (want): a tap says what HD gives. The ring (HotDot) is gold while the view is HD
  const hd = hotMark(id)
  // its layer was never baked here (no point cloud, so no lanes): greyed, and a tap does nothing, in
  // an SD area too; it no longer opens the grade sheet's Get HD (Gavan, 2026-10-18, at Clearwater:
  // "When I tap range just don't bring me to get HD screen")
  const absent = hotAbsent(id)
  // an offer (the wind check's "Check now"): its label, and one soft glow when it comes, never again for
  // it; a toast with what it gives only when the app was open as it fell due, not as the phone comes back
  // out. Not while the button is on (its form open)
  const offered = d.useOffer?.() ?? null
  const offer = on || absent ? null : offered
  const [glow, setGlow] = useState(false)
  const shown = useRef<string | null>(null)
  useEffect(() => {
    if (!offer || shown.current === offer.id || document.visibilityState !== 'visible') return
    shown.current = offer.id
    setGlow(true)
    if (Date.now() - offer.due < 15_000) toast(OFFER_WORDS)
  }, [offer])
  const timer = useRef(0)
  const held = useRef(false)
  const down = () => {
    held.current = false
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      held.current = true
      if (navigator.vibrate) navigator.vibrate(12)
      onHold()
    }, HOLD_MS)
  }
  const up = () => window.clearTimeout(timer.current)
  return (
    <button
      className={`fab hotbtn${on ? ' active' : ''}${labels ? '' : ' no-label'}${hd === 'want' ? ' grade-want' : ''}${absent ? ' grade-off' : ''}${offer ? ' offer' : ''}${glow ? ' offer-glow' : ''}`}
      onAnimationEnd={(e) => {
        if (e.animationName === 'offer-glow') setGlow(false)
      }}
      data-hot={id}
      onPointerDown={down}
      onPointerUp={up}
      onPointerLeave={up}
      onPointerCancel={up}
      onContextMenu={(e) => e.preventDefault()}
      onClick={() => {
        if (held.current) return (held.current = false)
        if (absent) return
        if (hd === 'want') return openGrade(id)
        ;(onTap ?? d.onTap)()
      }}
      aria-pressed={on}
      aria-disabled={absent || undefined}
      aria-label={absent ? `${d.name}: not here` : offer ? `${d.name} · ${offer.label}: ${OFFER_WORDS.toLowerCase()}` : d.name}
    >
      <d.Icon />
      <HotDot id={id} />
      {labels && <span className="hotbtn-label">{offer ? offer.label : d.short}</span>}
    </button>
  )
}
