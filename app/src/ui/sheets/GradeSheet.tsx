import { useEffect, useRef, type JSX } from 'react'
import { ACTIVE_AREA } from '../../areas'
import { areaGrade, CORE, GRADE, SD_PREVIEW } from '../../config'
import { boxAround, parseBoxId } from '../../explore/box'
import { setExplore } from '../../explore'
import { useExplore } from '../../explore/store'
import { useAppStore } from '../../state/appStore'
import { switchGrade } from '../../state/grade'
import { GRADE_SWITCH, hdItems, offInSd, showHdLayer, type HdItem } from '../grade'

/**
 * What HD gives at this spot (the grade tile, an outlined HD tab). Brief
 * first: the grade and one line; then HD's things here, each with what it
 * does for the hunt, where it came from, and a Show that puts it on the
 * map. Shown as SD, the same list says what is off. An SD area lists what
 * HD would add and asks for it (the Explore box over the area).
 */
export default function GradeSheet({ focus }: { focus?: string }): JSX.Element {
  const closeSheet = useAppStore((s) => s.closeSheet)
  const native = areaGrade()
  const items = hdItems()
  const name = ACTIVE_AREA.name
  // opened from an outlined tab: that thing's row in view
  const focused = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const t = window.setTimeout(() => focused.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 260)
    return () => window.clearTimeout(t)
  }, [])

  const head =
    GRADE === 'hd'
      ? { title: `${name} is HD`, line: 'Measured from LiDAR and solved for this ground. Everything with the HD tab comes from it.' }
      : SD_PREVIEW
        ? { title: `${name} shown as SD`, line: 'The map as an SD bake would have it. HD has the things below on top.' }
        : { title: `${name} is SD`, line: 'Built from national data, the wind on the trained model. HD measures this ground.' }

  /** An SD area asks for HD over the box it was asked for (the request's
   *  box id rides in the preset's note), else over the core. */
  function askHd() {
    const note = ACTIVE_AREA.presets.map((p) => p.note ?? '').join(' ')
    const id = /b-\d+-\d+-\d+-\d+/.exec(note)?.[0]
    const lon = (CORE.west + CORE.east) / 2
    const lat = (CORE.south + CORE.north) / 2
    const box = (id && parseBoxId(id)) || boxAround(lon, lat)
    closeSheet()
    setExplore(true)
    useExplore.getState().select({ box, lon, lat })
  }

  function row(it: HdItem): JSX.Element {
    const off = offInSd(it)
    const canShow = GRADE === 'hd' && it.layer != null
    const isFocus = !!focus && (focus === it.hot || focus === it.id || focus === it.layer)
    return (
      <div key={it.id} ref={isFocus ? focused : undefined} className={`grade-row${isFocus ? ' grade-focus' : ''}${off ? ' grade-off' : ''}`}>
        <span className={`grade-tab ${GRADE === 'hd' ? 'grade-tab-hd' : 'grade-tab-want'}`} aria-hidden="true">
          HD
        </span>
        <div className="grade-row-text">
          <b>{it.title}</b>
          <span>{it.line}</span>
          {SD_PREVIEW && it.sdNote && <span className="grade-sd-note">{it.sdNote}</span>}
          {it.source && <small className="dim">{it.source}</small>}
        </div>
        {canShow && (
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
        <span className={`grade-badge grade-${GRADE}`} aria-hidden="true">
          {GRADE === 'hd' ? 'HD' : 'SD'}
        </span>
        <h2>{head.title}</h2>
        <button className="sheet-done" onClick={closeSheet}>
          Done
        </button>
      </div>
      <p className="grade-lede">{head.line}</p>

      {GRADE_SWITCH && native === 'hd' && (
        <div className="st-row grade-switch">
          <span>
            Show the map as
            <small className="dim">Testing. Reloads the app with the other grade.</small>
          </span>
          <div className="seg" role="radiogroup" aria-label="Show the map as">
            {(['sd', 'hd'] as const).map((g) => (
              <button key={g} className={GRADE === g ? 'seg-on' : ''} role="radio" aria-checked={GRADE === g} onClick={() => GRADE !== g && switchGrade(g)}>
                {g.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="grade-sec">{native === 'hd' ? `HD at ${name}` : 'What HD adds'}</div>
      <div className="grade-list">{items.length ? items.map(row) : <p className="dim">Nothing HD was baked here.</p>}</div>

      {native === 'sd' && (
        <button type="button" className="btn-primary grade-ask" onClick={askHd}>
          Get HD for {name}
        </button>
      )}
      {SD_PREVIEW && (
        <button type="button" className="btn-primary grade-ask" onClick={() => switchGrade('hd')}>
          Back to HD
        </button>
      )}
    </div>
  )
}
