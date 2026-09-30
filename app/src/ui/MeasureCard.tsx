import { useEffect, useState } from 'react'
import { formatBearing, formatDistance, legsOf, totalM } from '../measure/measureMath'
import { useMeasureStore } from '../measure/measureStore'
import { useAppStore } from '../state/appStore'
import { durationLabel } from '../time'
import { IconMinus, IconPlus, IconUndo } from './icons'

/**
 * The measuring tool's readout, in the bottom bar: the total, and the last
 * leg's range and bearing. How long that is on foot sits one tap deeper
 * (pace ›), with the pace nudges. The legs label themselves on the map;
 * this is the sum. Done leaves the tool; so does Escape.
 */
export default function MeasureCard() {
  const points = useMeasureStore((s) => s.points)
  const from = useMeasureStore((s) => s.from)
  const undo = useMeasureStore((s) => s.undo)
  const clear = useMeasureStore((s) => s.clear)
  const stop = useMeasureStore((s) => s.stop)
  const units = useAppStore((s) => s.units)
  const paceKmh = useAppStore((s) => s.paceKmh)
  const setPaceKmh = useAppStore((s) => s.setPaceKmh)
  const [showPace, setShowPace] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') stop()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [stop])

  const legs = legsOf(points)
  const last = legs[legs.length - 1]
  const total = totalM(points)
  const pace = units === 'imperial' ? `${(paceKmh * 0.621371).toFixed(1)} mph` : `${paceKmh.toFixed(1)} km/h`

  return (
    <div className="tripbuilder glass measure-card">
      <div className="tb-head">
        <span className="tb-title">Measure</span>
        <button className="linklike" onClick={() => clear()} disabled={points.length === 0}>
          Clear
        </button>
        <button className="icon-btn" onClick={() => undo()} disabled={points.length === 0} aria-label="Undo last point">
          <IconUndo size={16} />
        </button>
        <button className="sheet-done" onClick={() => stop()}>
          Done
        </button>
      </div>
      <div className="tb-facts">
        {points.length === 0 ? (
          <span className="dim">Tap the map</span>
        ) : points.length === 1 ? (
          <span className="dim">{from === 'you' ? 'From you' : from === 'spot' ? 'From the spot' : 'From here'} · tap the map, or a person</span>
        ) : (
          <span className="numeral">
            {from === 'you' && <span className="dim">from you · </span>}
            <b className="measure-total">{formatDistance(total, units)}</b>
            {legs.length > 1 ? ` total · ${legs.length} legs` : ' total'}
          </span>
        )}
        {last && (
          <span className="numeral">
            {legs.length > 1 ? 'last leg ' : ''}
            <b>{formatDistance(last.m, units)}</b> · <b>{formatBearing(last.deg)}</b>
          </span>
        )}
        {total > 0 && !showPace && (
          <button className="linklike" onClick={() => setShowPace(true)} aria-expanded={false}>
            pace ›
          </button>
        )}
        {total > 0 && showPace && (
          <span className="numeral speed-step">
            about <b>{durationLabel(Math.max(1, Math.round((total / 1000 / paceKmh) * 60)))}</b> on foot at
            <button className="nudge" onClick={() => setPaceKmh(Math.max(1, Math.round((paceKmh - 0.5) * 2) / 2))} aria-label="Slower">
              <IconMinus size={11} />
            </button>
            <b>{pace}</b>
            <button className="nudge" onClick={() => setPaceKmh(Math.min(8, Math.round((paceKmh + 0.5) * 2) / 2))} aria-label="Faster">
              <IconPlus size={11} />
            </button>
          </span>
        )}
      </div>
    </div>
  )
}
