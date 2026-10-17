import { useEffect, useRef, type JSX } from 'react'
import { ACTIVE_AREA } from '../../areas'
import { switchArea } from '../../areas/switch'
import { areaGrade, GRADE, SD_OFFLINE, SD_PREVIEW } from '../../config'
import { useAppStore } from '../../state/appStore'
import { useHdOrders } from '../../state/hdOrders'
import { areaGrades, askHdForArea, GRADE_SWITCH, hdItems, offInSd, removeHd, showHdAgain, showHdLayer, useAreaOrder, type HdItem } from '../grade'

/**
 * HD at this spot (the pill's grade word, a tap on an HD-only button). Brief
 * first: the grade and one line. Then, by where the area stands on this
 * phone: what HD gives here with a Show for each (every HD area is yours
 * for now, state/grade.ts), the word that HD comes with signal when it
 * opened SD for want of it (config.ts SD_OFFLINE), the dev builds' way back
 * where their Remove put an HD area to SD, or what HD would add and Get HD
 * (an SD area). An order made from this phone shows as ordered, with Forget.
 * Every area at the foot, each with its grade.
 */
export default function GradeSheet({ focus }: { focus?: string }): JSX.Element {
  const closeSheet = useAppStore((s) => s.closeSheet)
  const order = useAreaOrder()
  const removeOrder = useHdOrders((s) => s.remove)
  const native = areaGrade()
  const items = hdItems()
  const name = ACTIVE_AREA.name
  // opened from an HD-only button: that thing's row in view
  const focused = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const t = window.setTimeout(() => focused.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 260)
    return () => window.clearTimeout(t)
  }, [])

  const head =
    GRADE === 'hd'
      ? { title: `${name} · HD`, line: 'Measured from LiDAR and solved for this ground. Gold on the map is HD.' }
      : SD_OFFLINE
        ? { title: `${name} · SD for now`, line: "No signal, and this area's HD isn't on the phone yet. With signal it streams in by itself; save the area for the bush from the maps on this phone." }
        : SD_PREVIEW
          ? { title: `${name} · shown as SD`, line: "HD was taken off on this phone (the dev builds' compare). Shown again, it streams in with signal, as for everyone." }
          : { title: `${name} is SD`, line: 'Built from national data, the wind on the trained model. HD measures this ground.' }

  const gold = GRADE === 'hd'

  function row(it: HdItem): JSX.Element {
    const isFocus = !!focus && (focus === it.hot || focus === it.id || focus === it.layer)
    return (
      <div key={it.id} ref={isFocus ? focused : undefined} className={`grade-row${isFocus ? ' grade-focus' : ''}`}>
        <span className={`grade-tab ${gold ? 'grade-tab-hd' : 'grade-tab-want'}`} aria-hidden="true">
          HD
        </span>
        <div className="grade-row-text">
          <b>{it.title}</b>
          <span>{it.line}</span>
          {SD_PREVIEW && it.sdNote && offInSd(it) && <span className="dim">{it.sdNote}</span>}
          {it.source && <small className="dim">{it.source}</small>}
        </div>
        {gold && it.layer && (
          <button type="button" className="grade-show" onClick={() => showHdLayer(it)}>
            Show
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="grade-sheet">
      <div className="sheet-head">
        <span className={`grade-badge grade-${gold ? 'hd' : 'sd'}`} aria-hidden="true">
          {gold ? 'HD' : 'SD'}
        </span>
        <h2>{head.title}</h2>
        <button className="sheet-done" onClick={closeSheet}>
          Done
        </button>
      </div>
      <p className="grade-lede">{head.line}</p>

      {/* the dev builds' way back from Remove */}
      {GRADE_SWITCH && SD_PREVIEW && !SD_OFFLINE && (
        <button type="button" className="btn-primary grade-ask" onClick={showHdAgain}>
          Show HD again (dev)
        </button>
      )}

      {/* an order made from this phone */}
      {order && (
        <div className="grade-order">
          <div className="grade-sec">{order.kind === 'extend' ? `Extending ${order.name}'s HD` : `HD for ${order.name}`}</div>
          <div className="dim grade-note">{order.sim ? 'Simulated on the dev build: no request was sent and nothing new is baked.' : 'Ordered. The email comes when it is built; the phone cannot follow it.'}</div>
          <button type="button" className="layers-link" onClick={() => removeOrder(order.boxId)}>
            {order.sim ? 'Cancel' : 'Forget it here'}
          </button>
        </div>
      )}

      <div className="grade-sec">{gold ? 'HD here' : SD_OFFLINE ? 'What comes with signal' : SD_PREVIEW ? 'What is taken off' : 'What HD adds'}</div>
      <div className="grade-list">{items.length ? items.map(row) : <p className="dim">Nothing HD was baked here.</p>}</div>

      {native === 'sd' && !order && (
        <button type="button" className="btn-primary grade-ask" onClick={askHdForArea}>
          Get HD for {name}
        </button>
      )}
      {gold && <p className="dim grade-note">Past the gold edge the map is SD. Tap the ground there for Extend or Get HD.</p>}

      <div className="grade-sec">Your areas</div>
      <div className="grade-areas">
        {areaGrades().map(({ a, grade }) => (
          <div key={a.id} className="grade-area">
            <span className={`grade-badge grade-${grade === 'hd' ? 'hd' : 'sd'}`}>{grade === 'hd' ? 'HD' : 'SD'}</span>
            <span className="grade-area-name">
              {a.name}
              <small className="dim">{grade === 'hd' ? 'HD' : grade === 'hd-off' ? 'HD, shown as SD' : 'SD'}</small>
            </span>
            {a.id === ACTIVE_AREA.id ? (
              <span className="dim grade-here">Here</span>
            ) : (
              <button type="button" className="grade-show" onClick={() => switchArea(a.id)}>
                Open
              </button>
            )}
          </div>
        ))}
      </div>

      {GRADE_SWITCH && gold && native === 'hd' && (
        <button type="button" className="layers-link dim grade-remove" onClick={() => void removeHd()}>
          Remove HD from this phone (dev)
        </button>
      )}
    </div>
  )
}
