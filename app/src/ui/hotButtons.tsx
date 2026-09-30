import type { JSX } from 'react'
import { inRegion } from '../config'
import { toggleCone, useHunting } from '../hunting/hunting'
import { getMap } from '../map/mapController'
import { DROPPED_NAME } from '../map/placePopup'
import { useAppStore, type HotId, type LayerVisibility } from '../state/appStore'
import { usePlacesStore } from '../state/placesStore'
import { useSpotsStore } from '../state/spotsStore'
import { useGpsStore } from '../tracking/gpsStore'
import { useScent } from '../weather/micro/scent'
import { useHeardForm } from './HeardCard'
import { useCheckForm } from './WindCheckCard'
import { IconBattery, IconBush, IconCrew, IconDepth, IconEar, IconHeat, IconLanes, IconPin, IconPowder, IconRadar, IconScent } from './icons'
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
    useActive: () => useHunting((s) => s.cone),
    onTap: () => toggleCone(),
  },
  heard: {
    id: 'heard',
    name: 'Heard',
    short: 'Heard',
    Icon: IconEar,
    useActive: off,
    onTap: () => useHeardForm.getState().show(),
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
export const HOT_ORDER: HotId[] = ['heat', 'scent', 'heard', 'person', 'windcheck', 'pin', 'understory', 'lanes', 'bathy', 'radar', 'lowPower']

/** A hot button in the column: the round .fab with its short word hung under it. */
export function HotButton({ id }: { id: HotId }): JSX.Element {
  const d = HOT_DEFS[id]
  const on = d.useActive()
  return (
    <button className={`fab hotbtn${on ? ' active' : ''}`} onClick={d.onTap} aria-pressed={on} aria-label={d.name}>
      <d.Icon />
      <span className="hotbtn-label">{d.short}</span>
    </button>
  )
}
