import type { JSX } from 'react'
import { useAppStore, type AppState } from '../state/appStore'
import { IconMinus, IconPlus } from './icons'

/**
 * The walking pace, km/h, the one knob the ruler's time, the routes and the
 * drawer all nudge: a half at a time between 1 and 8, worded to a decimal
 * (unlike a wind, which reads whole). It was written three times over.
 */
export const slower = (kmh: number): number => Math.max(1, Math.round((kmh - 0.5) * 2) / 2)
export const faster = (kmh: number): number => Math.min(8, Math.round((kmh + 0.5) * 2) / 2)

/** "1.0 km/h"; "0.6 mph". */
export const paceText = (kmh: number, units: AppState['units']): string => (units === 'imperial' ? `${(kmh * 0.621371).toFixed(1)} mph` : `${kmh.toFixed(1)} km/h`)

/** The pace between its − and + (the ruler's and the route card's row). */
export function PaceNudge(): JSX.Element {
  const paceKmh = useAppStore((s) => s.paceKmh)
  const setPaceKmh = useAppStore((s) => s.setPaceKmh)
  const units = useAppStore((s) => s.units)
  return (
    <>
      <button className="nudge" onClick={() => setPaceKmh(slower(paceKmh))} aria-label="Slower">
        <IconMinus size={11} />
      </button>
      <b>{paceText(paceKmh, units)}</b>
      <button className="nudge" onClick={() => setPaceKmh(faster(paceKmh))} aria-label="Faster">
        <IconPlus size={11} />
      </button>
    </>
  )
}
