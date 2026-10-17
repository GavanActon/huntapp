import type { JSX } from 'react'
import { useAreaLook } from '../areas/lookSwitch'
import './areas.css'

/**
 * The one word of going from one area to the next by itself
 * (areas/lookSwitch.ts): a download running holds the switch back, so it
 * says it goes when that is done. Arriving needs none: the strip's loading
 * line says what streams and offers the save (WeatherStrip, Gavan,
 * 2026-10-17: "It was great earlier. Left to right under the weather").
 */
export default function AreaLook(): JSX.Element | null {
  const waiting = useAreaLook((s) => s.waiting)
  return waiting ? <span className="chip chip-ok">To {waiting.name} when the download is done</span> : null
}
