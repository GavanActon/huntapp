import { useState, type JSX } from 'react'
import { areaById, otherAreaAt } from '../areas'
import { switchArea } from '../areas/switch'
import { useGpsStore } from '../tracking/gpsStore'
import './areas.css'

/** An area's offer once waved off (×), kept on the phone: it stays off for
 *  that area. Taking it (Switch) does not put it off: back in the other
 *  area while standing in this one, it is still the one tap there. The app
 *  never asks which area to open (Gavan, 2026-10-03), and this chip is the
 *  most it may nag. */
const offKey = (id: string) => `huntapp-area-offer-dismissed:${id}`

function isOff(id: string): boolean {
  try {
    return localStorage.getItem(offKey(id)) === '1'
  } catch {
    return false
  }
}

function putOff(id: string) {
  try {
    localStorage.setItem(offKey(id), '1')
  } catch {
    /* private mode: gone for this run only */
  }
}

/**
 * The fix is in another area's box: a chip offers to switch to it. Only
 * offers: the phone is glanced at and pocketed, and a reload on a fix
 * alone would drop the people placed and the card left open mid-sit.
 * Nothing at all with no fix, or with the fix in the area the app is in.
 */
export default function AreaOffer(): JSX.Element | null {
  // the area's id, not the fix: the chip redraws when the answer changes, not on every fix
  const id = useGpsStore((s) => (s.fix ? (otherAreaAt(s.fix.lon, s.fix.lat)?.id ?? null) : null))
  // put away this run: the chip goes at once, and stays gone where storage is blocked
  const [gone, setGone] = useState<string[]>([])
  const area = areaById(id)
  if (!area || gone.includes(area.id) || isOff(area.id)) return null
  // to where you are, with nothing to do on arrival: follow comes back with location
  const go = () => {
    const f = useGpsStore.getState().fix
    if (f) switchArea(area.id, { center: [f.lon, f.lat], zoom: 14 })
  }
  const notNow = () => {
    putOff(area.id)
    setGone((g) => [...g, area.id])
  }
  return (
    <span className="chip chip-ok chip-offer">
      <button onClick={go}>You're at {area.name} · Switch</button>
      <button className="chip-x" aria-label="Not now" onClick={notNow}>
        ×
      </button>
    </span>
  )
}
