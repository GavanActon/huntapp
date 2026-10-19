import { useMemo, useState, type JSX } from 'react'
import { useAppStore } from '../../state/appStore'
import { useSpotsStore } from '../../state/spotsStore'
import { useViews } from '../../state/viewsStore'
import { GROUNDS, TOPS, groundOf, groundView, needsSignal, setGround, setTop, topHere, topOn, viewHere, viewPic } from '../viewKit'
import './settings.css'
import '../views.css'

/**
 * Make your own view: a name, the map underneath (one of the six maps, a
 * picture each), and what goes on top, each a switch. Every pick shows on
 * the map above at once, starting from the map as it is; Save view keeps
 * it, adds it to My views and goes back to the Views sheet. The strengths
 * and the rest of the layers are one step deeper (the layers sheet), for
 * the few who want them (Gavan, 2026-10-19: "you want more, you dig").
 */
export default function MakeViewSheet(): JSX.Element {
  const layers = useAppStore((s) => s.layers)
  const online = useAppStore((s) => s.online)
  const stacked = useAppStore((s) => s.sheets.length > 1)
  const popSheet = useAppStore((s) => s.popSheet)
  const openSheet = useAppStore((s) => s.openSheet)
  const pushSheet = useAppStore((s) => s.pushSheet)
  const heat = useSpotsStore((s) => s.heat)
  const saved = useViews((s) => s.saved)
  const saveCurrent = useViews((s) => s.saveCurrent)
  const togglePin = useViews((s) => s.togglePin)

  const [name, setName] = useState(() => {
    const taken = new Set(saved.map((v) => v.name))
    let n = 'My view'
    for (let i = 2; taken.has(n); i++) n = `My view ${i}`
    return n
  })
  const ground = groundOf(layers)
  const grounds = useMemo(() => GROUNDS.filter((g) => {
    const v = groundView(g)
    return v && viewHere(v)
  }), [])
  const tops = useMemo(() => TOPS.filter(topHere), [])

  const back = () => (stacked ? popSheet() : openSheet({ kind: 'views' }))

  function save() {
    const v = saveCurrent(name.trim() || 'My view')
    if (!useViews.getState().pinned[v.mode].includes(v.id)) togglePin(v.id)
    back()
  }

  return (
    <div className="settings">
      <div className="sheet-head">
        <button className="sheet-back" onClick={back}>
          ‹ Views
        </button>
        <span className="sheet-title" />
        <button className="btn-primary" onClick={save}>
          Save view
        </button>
      </div>

      <label className="vm-name">
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} enterKeyHint="done" />
      </label>

      <div className="st-sec">Underneath</div>
      <div className="vm-grounds">
        {grounds.map((g) => {
          const v = groundView(g)!
          const dark = needsSignal(v) && !online
          return (
            <button key={g.id} className="viewcard" aria-pressed={ground === g.id} disabled={dark} onClick={() => setGround(g)}>
              <img src={viewPic(v)} alt="" draggable={false} />
              <span>{dark ? `${g.name} · no signal` : g.name}</span>
            </button>
          )
        })}
      </div>

      <div className="st-sec">On top</div>
      {tops.map((t) => (
        <label key={t.key} className="st-row">
          <span>{t.name}</span>
          <input type="checkbox" className="switch" checked={topOn(t, layers, heat)} onChange={(e) => setTop(t, e.target.checked)} />
        </label>
      ))}

      <button className="st-row vm-more" onClick={() => pushSheet({ kind: 'layers' })}>
        <span>Every layer, and how strong</span>
        <span className="dim">›</span>
      </button>
    </div>
  )
}
