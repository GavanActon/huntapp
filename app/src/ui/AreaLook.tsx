import { useState, type JSX } from 'react'
import { takeOffer, useAreaLook } from '../areas/lookSwitch'
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
 * The one chip about another area (areas/lookSwitch.ts): a download running
 * holds the switch the view asked for, so it says it goes when that is done;
 * or the fix is in another area's box while the map is looked at elsewhere,
 * and the chip offers the switch. Arriving needs none: the strip's loading
 * line says what streams and offers the save (WeatherStrip, Gavan,
 * 2026-10-17: "It was great earlier. Left to right under the weather").
 */
export default function AreaLook(): JSX.Element | null {
  const waiting = useAreaLook((s) => s.waiting)
  const offer = useAreaLook((s) => s.offer)
  // put away this run: the chip goes at once, and stays gone where storage is blocked
  const [gone, setGone] = useState<string[]>([])
  if (waiting) return <span className="chip chip-ok">To {waiting.name} when the download is done</span>
  if (!offer || gone.includes(offer.id) || isOff(offer.id)) return null
  const notNow = () => {
    putOff(offer.id)
    setGone((g) => [...g, offer.id])
  }
  return (
    <span className="chip chip-ok chip-offer">
      <button onClick={() => takeOffer(offer)}>You're at {offer.name} · Switch</button>
      <button className="chip-x" aria-label="Not now" onClick={notNow}>
        ×
      </button>
    </span>
  )
}
