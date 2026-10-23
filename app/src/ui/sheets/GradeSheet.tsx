import { useEffect, useRef, useState, type JSX } from 'react'
import { ACTIVE_AREA } from '../../areas'
import { layerRows, layersHere, type GroundData, type LayerRow } from '../layersHere'
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
  // the layers table (ui/layersHere.ts): what is here now from the area's files at once, then the rows
  // again once the ground's data is read (the coverage index under the box, the SD tiles' index)
  const unread: GroundData = { prov: null, lidar: null, flown: '', stands: null, water: null, sdHave: null, sdTiles: 0 }
  const [table, setTable] = useState<{ rows: LayerRow[]; ground: GroundData }>(() => ({ rows: layerRows(ACTIVE_AREA, unread), ground: unread }))
  useEffect(() => {
    let live = true
    void layersHere(ACTIVE_AREA).then((t) => {
      if (live) setTable(t)
    })
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const rows = table.rows
  const ground = table.ground
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
      <div key={it.id} ref={isFocus ? focused : undefined} className={`grade-row${isFocus ? ' grade-focus' : ''}${it.absent ? ' grade-absent' : ''}`}>
        <span className={`grade-tab ${gold ? 'grade-tab-hd' : 'grade-tab-want'}`} aria-hidden="true">
          HD
        </span>
        <div className="grade-row-text">
          <b>{it.title}</b>
          <span>{it.line}</span>
          {SD_PREVIEW && it.sdNote && offInSd(it) && <span className="dim">{it.sdNote}</span>}
          {it.source && <small className="dim">{it.source}</small>}
        </div>
        {gold && it.layer && !it.absent && (
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

      {/* layer by layer: what is here, and what the data here allows (ui/layersHere.ts) */}
      <div className="grade-sec">Layers here</div>
      <div className="lh" role="table" aria-label="Layers here">
        <div className="lh-head" role="row">
          <span role="columnheader" />
          <span role="columnheader">Now</span>
          <span role="columnheader">The data here allows</span>
        </div>
        {rows.map((r) => (
          <div key={r.id} className={`lh-row lh-${r.state}`} role="row">
            <span className="lh-layer" role="cell">
              {r.layer}
            </span>
            <span className="lh-now" role="cell">
              {r.now}
            </span>
            <span className="lh-next" role="cell">
              {r.state === 'have' ? 'here' : r.next}
            </span>
          </div>
        ))}
      </div>
      <p className="dim grade-note">
        {ground.lidar == null
          ? 'Reading what has been flown and published here…'
          : `${ground.prov ?? name}: ${ground.lidar === 'none' ? 'no 1 m LiDAR flown' : `1 m LiDAR${ground.flown ? ` flown ${ground.flown}` : ''}${ground.lidar === 'some' ? ' under part of the box' : ''}`}; ${ground.stands ? `${ground.stands} stands` : 'no inventory stands, SCANFI'}; ${ground.water ? `water and roads from ${ground.water}` : 'national water and roads'}.`}
      </p>

      {gold || SD_PREVIEW || SD_OFFLINE ? (
        <>
          <div className="grade-sec">{gold ? 'HD here' : SD_OFFLINE ? 'What comes with signal' : 'What is taken off'}</div>
          <div className="grade-list">{items.length ? items.map(row) : <p className="dim">Nothing HD was baked here.</p>}</div>
        </>
      ) : null}

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
