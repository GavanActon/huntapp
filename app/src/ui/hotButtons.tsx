import { useRef, type JSX } from 'react'
import { inRegion } from '../config'
import { toggleCone, useHunting } from '../hunting/hunting'
import { getMap } from '../map/mapController'
import { DROPPED_NAME } from '../map/placePopup'
import { useMeasureStore } from '../measure/measureStore'
import { closeRoutes, openRoutes, useRoutes } from '../routes/routeStore'
import { useAppStore, type HotId, type LayerVisibility } from '../state/appStore'
import { usePlacesStore } from '../state/placesStore'
import { useSpotsStore } from '../state/spotsStore'
import { useGpsStore } from '../tracking/gpsStore'
import { useScent } from '../weather/micro/scent'
import { useHeardForm } from './HeardCard'
import { useCheckForm } from './WindCheckCard'
import { IconBattery, IconBush, IconCrew, IconDepth, IconEar, IconHeat, IconLanes, IconPin, IconPowder, IconRadar, IconRoute, IconRuler, IconScent, IconWind } from './icons'
import { logWindHere } from './logWindHere'

/**
 * The hot buttons: what the left column can hold (Map buttons picks up to
 * four per mode). Each knows its icon, its two names (the editor's and the
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
}

const off = () => false

/** A pin where you are (in the region), else at the middle of the map. Never selected: the strip and heat stay put. */
function dropPin() {
  const fix = useGpsStore.getState().fix
  let lon: number
  let lat: number
  if (fix && inRegion(fix.lon, fix.lat)) {
    lon = fix.lon
    lat = fix.lat
  } else {
    const c = getMap()?.getCenter()
    if (!c) return
    lon = c.lng
    lat = c.lat
  }
  usePlacesStore.getState().add({ name: DROPPED_NAME, lon, lat, kind: 'stand' })
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
  heat: {
    id: 'heat',
    name: 'Heat map',
    short: 'Heat',
    Icon: IconHeat,
    useActive: () => useSpotsStore((s) => s.heat),
    onTap: () => {
      const st = useSpotsStore.getState()
      st.setHeat(!st.heat)
    },
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
    name: 'Heard',
    short: 'Heard',
    Icon: IconEar,
    useActive: () => useHeardForm((s) => s.placing || s.open),
    // tap, then tap the map where it was, then say what it was
    onTap: () => useHeardForm.getState().arm(),
  },
  person: {
    id: 'person',
    name: 'Person',
    short: 'Person',
    Icon: IconCrew,
    useActive: () => useScent((s) => s.adding),
    onTap: () => {
      const st = useScent.getState()
      st.setAdding(!st.adding)
    },
  },
  windcheck: {
    id: 'windcheck',
    name: 'Wind check',
    short: 'Check',
    Icon: IconPowder,
    useActive: () => useCheckForm((s) => s.at != null),
    onTap: () => {
      const f = useCheckForm.getState()
      if (f.at != null) f.close()
      else logWindHere()
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
  lowPower: {
    id: 'lowPower',
    name: 'Low power',
    short: 'Power',
    Icon: IconBattery,
    useActive: () => useAppStore((s) => s.lowPower),
    onTap: () => {
      const st = useAppStore.getState()
      st.setLowPower(!st.lowPower)
    },
  },
}

/** Every hot button, in the order the editor's Add chips list them. */
export const HOT_ORDER: HotId[] = ['windcheck', 'scent', 'heard', 'windflow', 'routes', 'measure', 'heat', 'person', 'pin', 'understory', 'lanes', 'bathy', 'radar', 'lowPower']

const HOLD_MS = 450

/** A long press on a button: its own settings. The wind flow's knobs, your
 *  scent in full, the layers for the heat map; the rest open Map buttons. */
function holdAction(id: HotId): () => void {
  const st = useAppStore.getState()
  switch (id) {
    case 'windflow':
      return () => st.openSheet({ kind: 'settings' })
    case 'scent':
      return () => st.setTopCard({ kind: 'scent' })
    case 'heat':
    case 'understory':
    case 'lanes':
    case 'bathy':
    case 'radar':
      return () => st.openSheet({ kind: 'layers' })
    default:
      return () => st.openSheet({ kind: 'buttons' })
  }
}

/** A hot button in the column: the round .fab with its short word hung under
 *  it. A tap does its thing; a press and hold opens its settings. */
export function HotButton({ id }: { id: HotId }): JSX.Element {
  const d = HOT_DEFS[id]
  const on = d.useActive()
  const timer = useRef(0)
  const held = useRef(false)
  const down = () => {
    held.current = false
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      held.current = true
      if (navigator.vibrate) navigator.vibrate(12)
      holdAction(id)()
    }, HOLD_MS)
  }
  const up = () => window.clearTimeout(timer.current)
  return (
    <button
      className={`fab hotbtn${on ? ' active' : ''}`}
      onPointerDown={down}
      onPointerUp={up}
      onPointerLeave={up}
      onPointerCancel={up}
      onContextMenu={(e) => e.preventDefault()}
      onClick={() => {
        if (held.current) return (held.current = false)
        d.onTap()
      }}
      aria-pressed={on}
      aria-label={d.name}
    >
      <d.Icon />
      <span className="hotbtn-label">{d.short}</span>
    </button>
  )
}
