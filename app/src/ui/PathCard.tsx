import { useEffect } from 'react'
import { pathFacts } from '../paths/pathLayer'
import { usePaths } from '../paths/pathStore'
import { useAppStore } from '../state/appStore'
import { IconUndo } from './icons'

const NONE: [number, number][] = []

/**
 * Drawing a path, in the bottom bar: how far it runs and about how long on
 * foot (Measure's pace). Undo takes back the last stroke. Done keeps it;
 * so does Escape. Clear empties it, and a path left with under two points
 * goes when Done is pressed.
 */
export default function PathCard() {
  const points = usePaths((s) => s.draft?.points ?? NONE)
  const editing = usePaths((s) => s.draft?.id != null)
  const undo = usePaths((s) => s.undo)
  const clear = usePaths((s) => s.clear)
  const done = usePaths((s) => s.done)
  // the words follow the units and the pace
  useAppStore((s) => s.units)
  useAppStore((s) => s.paceKmh)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') done()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [done])

  const f = pathFacts(points)

  return (
    <div className="tripbuilder glass measure-card path-card">
      <div className="tb-head">
        <span className="tb-title">{editing ? 'Edit path' : 'Path'}</span>
        <button className="linklike" onClick={() => clear()} disabled={points.length === 0}>
          Clear
        </button>
        <button className="icon-btn" onClick={() => undo()} disabled={points.length === 0} aria-label="Undo last stroke">
          <IconUndo size={16} />
        </button>
        <button className="sheet-done" onClick={() => done()}>
          Done
        </button>
      </div>
      <div className="tb-facts">
        {points.length < 2 ? (
          <span className="dim">Draw with a finger · two fingers move the map</span>
        ) : (
          <span className="numeral">
            <b className="measure-total">{f.dist}</b> · about <b>{f.walk}</b> on foot
          </span>
        )}
      </div>
    </div>
  )
}
