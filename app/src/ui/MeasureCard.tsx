import { useEffect } from 'react'
import { formatBearing, formatDistance, legsOf, totalM } from '../measure/measureMath'
import { measurePoints, useMeasureStore } from '../measure/measureStore'
import { useAppStore } from '../state/appStore'
import { durationLabel } from '../time'
import { useUsableFix } from '../tracking/hereFix'
import { IconClose, IconLocate, IconMinus, IconPlus, IconUndo } from './icons'

/**
 * The measuring tool's readout, docked above the tabs: total range, the
 * last leg's range and bearing, and how long that is on foot at the pace
 * set here. The legs label themselves on the map; this is the sum.
 *
 * The chip in the head says where the first leg starts — where you stand,
 * or the first point you tap. With a fix it opens on you, because the
 * usual question out there is how far that is from here.
 */
export default function MeasureCard() {
  const points = useMeasureStore((s) => s.points)
  const from = useMeasureStore((s) => s.from)
  const setFrom = useMeasureStore((s) => s.setFrom)
  const here = useUsableFix()
  const undo = useMeasureStore((s) => s.undo)
  const clear = useMeasureStore((s) => s.clear)
  const stop = useMeasureStore((s) => s.stop)
  const units = useAppStore((s) => s.units)
  const paceKmh = useAppStore((s) => s.paceKmh)
  const setPaceKmh = useAppStore((s) => s.setPaceKmh)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') stop()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [stop])

  const pts = measurePoints()
  const legs = legsOf(pts)
  const last = legs[legs.length - 1]
  const total = totalM(pts)
  const pace = units === 'imperial' ? `${(paceKmh * 0.621371).toFixed(1)} mph` : `${paceKmh.toFixed(1)} km/h`

  return (
    <div className="tripbuilder glass measure-card">
      <div className="tb-head">
        <span className="tb-title">Measure</span>
        <button
          className={`chip-pick${from === 'you' ? ' chip-on' : ''}${from === 'you' && !here ? ' chip-dim' : ''}`}
          onClick={() => setFrom(from === 'you' ? 'map' : 'you')}
          disabled={from === 'map' && !here}
          aria-label={from === 'you' ? 'Measuring from where you are' : 'Measuring from the first point tapped'}
        >
          {from === 'you' ? (
            <>
              <IconLocate size={11} /> You
            </>
          ) : (
            'Map'
          )}
        </button>
        <button className="linklike" onClick={() => clear()} disabled={points.length === 0}>
          Clear
        </button>
        <button className="icon-btn" onClick={() => undo()} disabled={points.length === 0} aria-label="Undo last point">
          <IconUndo size={16} />
        </button>
        <button className="icon-btn" onClick={() => stop()} aria-label="Close measuring tool">
          <IconClose size={16} />
        </button>
      </div>
      {legs.length === 0 ? (
        <div className="tb-hint">{points.length > 0 ? 'Tap again' : from === 'you' ? 'Tap where to' : 'Tap two points'}</div>
      ) : (
        <div className="tb-facts">
          <span className="numeral">
            <b className="measure-total">{formatDistance(total, units)}</b>
            {legs.length > 1 ? ` total · ${legs.length} legs` : ' total'}
          </span>
          <span className="numeral">
            {legs.length > 1 ? 'last leg ' : ''}
            <b>{formatDistance(last.m, units)}</b> · <b>{formatBearing(last.deg)}</b>
          </span>
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
        </div>
      )}
    </div>
  )
}
