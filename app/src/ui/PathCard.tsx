import { useEffect } from 'react'
import { pathFacts } from '../paths/pathLayer'
import { usePaths } from '../paths/pathStore'
import { useAppStore } from '../state/appStore'
import { IconUndo } from './icons'

/**
 * The Path button down, in the bottom bar: the last path drawn, how far it
 * runs and about how long on foot (Measure's pace). Back takes it off, then
 * the one before, as far as the first drawn since the button went down.
 * Done puts the button up; so does Escape.
 */
export default function PathCard() {
  const n = usePaths((s) => s.drawn.length)
  const last = usePaths((s) => s.paths.find((p) => p.id === s.drawn[s.drawn.length - 1]))
  const undo = usePaths((s) => s.undo)
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

  const f = last ? pathFacts(last.points) : null

  return (
    <div className="tripbuilder glass measure-card path-card">
      <div className="tb-head">
        <span className="tb-title">Path</span>
        <button className="icon-btn path-back" onClick={() => undo()} disabled={n === 0} aria-label="Take off the last path">
          <IconUndo size={16} />
        </button>
        <button className="sheet-done" onClick={() => done()}>
          Done
        </button>
      </div>
      <div className="tb-facts">
        {!last || !f ? (
          <span className="dim">Draw with a finger · two fingers move the map</span>
        ) : (
          <span className="numeral">
            {n > 1 && <span className="dim">Path {n} · </span>}
            <i className="path-swatch" style={{ background: last.color }} />
            <b className="measure-total">{f.dist}</b> · about <b>{f.walk}</b> on foot
          </span>
        )}
      </div>
    </div>
  )
}
