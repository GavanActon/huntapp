import { useEffect, useRef, type JSX } from 'react'
import { ACTIVE_AREA } from '../../areas'
import { switchArea } from '../../areas/switch'
import { areaGrade, GRADE, SD_OFFLINE, SD_PREVIEW } from '../../config'
import { fmtBytes } from '../../offline/downloads'
import { useAppStore } from '../../state/appStore'
import { orderStage, STAGES, useHdOrders } from '../../state/hdOrders'
import { areaGrades, askHdForArea, GRADE_SWITCH, hdItems, installBytes, installHd, offInSd, removeHd, showHdLayer, useAreaOrder, useHdLive, useOrderTick, type HdItem } from '../grade'

/**
 * HD at this spot (the grade circle, a tap on an HD-only button). Brief
 * first: the grade and one line. Then, by where the area stands on this
 * phone: what HD gives here with a Show for each (every HD area is yours
 * for now, state/grade.ts), Install where the dev builds' Remove put it
 * back to SD (the files download here, a row's tab going gold as each
 * lands, then the app restarts on HD), the word that HD comes with signal
 * when it opened SD for want of it (config.ts SD_OFFLINE), or what HD
 * would add and Get HD (an SD area). An order for the area shows its stages. Every area at the foot,
 * each with its grade.
 */
export default function GradeSheet({ focus }: { focus?: string }): JSX.Element {
  const closeSheet = useAppStore((s) => s.closeSheet)
  const live = useHdLive()
  const order = useAreaOrder()
  const now = useOrderTick(order)
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

  const mb = fmtBytes(installBytes())
  const head =
    GRADE === 'hd'
      ? { title: `${name} · HD`, line: 'Measured from LiDAR and solved for this ground. Gold on the map is HD.' }
      : SD_OFFLINE
        ? { title: `${name} · SD for now`, line: "No signal, and this area's HD isn't on the phone yet. With signal it streams in by itself; save the area for the bush from the maps on this phone." }
        : SD_PREVIEW
        ? { title: `HD for ${name}`, line: `Built for this spot and ready to install. About ${mb}, kept on the phone for the bush.` }
        : { title: `${name} is SD`, line: 'Built from national data, the wind on the trained model. HD measures this ground.' }

  const st = order ? orderStage(order, now) : null
  const stageIdx = st ? STAGES.findIndex((s) => s.id === st.stage) : -1
  const gold = GRADE === 'hd' || live.finishing

  function row(it: HdItem): JSX.Element {
    const landed = live.done.includes(it.id) || live.finishing
    const coming = live.now === it.id && !landed
    const isFocus = !!focus && (focus === it.hot || focus === it.id || focus === it.layer)
    return (
      <div key={it.id} ref={isFocus ? focused : undefined} className={`grade-row${isFocus ? ' grade-focus' : ''}${coming ? ' grade-coming' : ''}`}>
        <span className={`grade-tab ${GRADE === 'hd' || landed ? 'grade-tab-hd' : 'grade-tab-want'}`} aria-hidden="true">
          HD
        </span>
        <div className="grade-row-text">
          <b>{it.title}</b>
          <span>{it.line}</span>
          {SD_PREVIEW && !live.installing && it.sdNote && offInSd(it) && <span className="dim">{it.sdNote}</span>}
          {coming && <span className="grade-sd-note">Installing…</span>}
          {it.source && <small className="dim">{it.source}</small>}
        </div>
        {GRADE === 'hd' && it.layer && (
          <button type="button" className="grade-show" onClick={() => showHdLayer(it)}>
            Show
          </button>
        )}
      </div>
    )
  }

  const pct = live.total ? Math.round((100 * Math.min(live.loaded, live.total)) / live.total) : 0

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

      {/* not installed: the one thing to do here */}
      {SD_PREVIEW && !SD_OFFLINE && (
        <div className="grade-install">
          {!live.installing && (
            <button type="button" className="btn-primary grade-ask" onClick={() => void installHd()}>
              Install HD · {mb}
            </button>
          )}
          {live.installing && (
            <>
              <div className="grade-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                <i style={{ width: `${live.finishing ? 100 : Math.max(3, pct)}%` }} />
              </div>
              <div className="grade-bar-words">
                {live.finishing
                  ? 'Installed · restarting on HD'
                  : `Installing · ${Math.min(live.done.length + 1, items.length)} of ${items.length} · ${fmtBytes(live.loaded)} of ${fmtBytes(live.total)}`}
              </div>
            </>
          )}
          {live.error && <div className="boxcard-err">{live.error}</div>}
          {GRADE_SWITCH && !live.installing && <div className="dim grade-note">Free while HD is in testing. Payment comes later.</div>}
        </div>
      )}

      {/* an order for this area, being built */}
      {order && st && (
        <div className="grade-order">
          <div className="grade-sec">{order.kind === 'extend' ? `Extending ${order.name}'s HD` : `HD for ${order.name}`}</div>
          <ol className="grade-stages">
            {STAGES.map((s, i) => (
              <li key={s.id} className={i < stageIdx || st.stage === 'ready' ? 'done' : i === stageIdx ? 'now' : ''}>
                {s.words}
              </li>
            ))}
          </ol>
          {order.sim && <div className="dim grade-note">Simulated on the dev build: no request was sent and nothing new is baked.</div>}
          {!order.sim && st.stage !== 'ready' && <div className="dim grade-note">The email comes when it is built.</div>}
          {(st.stage === 'ready' || order.sim) && (
            <button type="button" className="layers-link" onClick={() => removeOrder(order.boxId)}>
              {st.stage === 'ready' ? 'Done with it' : 'Cancel'}
            </button>
          )}
        </div>
      )}

      <div className="grade-sec">{GRADE === 'hd' ? 'HD here' : SD_OFFLINE ? 'What comes with signal' : SD_PREVIEW ? 'What installs' : 'What HD adds'}</div>
      <div className="grade-list">{items.length ? items.map(row) : <p className="dim">Nothing HD was baked here.</p>}</div>

      {native === 'sd' && !order && (
        <button type="button" className="btn-primary grade-ask" onClick={askHdForArea}>
          Get HD for {name}
        </button>
      )}
      {GRADE === 'hd' && <p className="dim grade-note">Past the gold edge the map is SD. Tap the ground there for Extend or Get HD.</p>}

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

      {GRADE_SWITCH && GRADE === 'hd' && native === 'hd' && (
        <button type="button" className="layers-link dim grade-remove" onClick={() => void removeHd()}>
          Remove HD from this phone (dev)
        </button>
      )}
    </div>
  )
}
