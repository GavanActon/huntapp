import { useMemo, useState, type JSX } from 'react'
import { useAppStore } from '../../state/appStore'
import { currentView, useViews, viewsFor, type MapView, type Mode } from '../../state/viewsStore'
import { FISH_HERE } from '../../spots/profile'
import { IconTrash } from '../icons'
import { needsSignal, viewHere, viewPic, viewWhat } from '../viewKit'
import './settings.css'
import '../views.css'

/**
 * Views: every view the area can show, each with its picture, what it
 * shows and what it is for. A tap on one puts it on the map (the sheet
 * stays, the map above it changes), `+ Add` puts it in My views, the pill
 * menu, and `✓ In menu` takes it back out. The phone's own views follow,
 * and at the foot Make your own (Gavan, 2026-10-19: "you want more, you
 * dig"). The heading row is its own: the title, the Hunting | Fishing
 * switch and Done (back to Settings, which pushed it, or closed).
 */
export default function ViewsSheet(): JSX.Element {
  const [mode, setShown] = useState<Mode>(() => useViews.getState().mode)
  const saved = useViews((s) => s.saved)
  const pinned = useViews((s) => s.pinned)
  const togglePin = useViews((s) => s.togglePin)
  const remove = useViews((s) => s.remove)
  const apply = useViews((s) => s.apply)
  const setMode = useViews((s) => s.setMode)
  const appMode = useViews((s) => s.mode)
  const lastViewId = useViews((s) => s.lastViewId)
  const layers = useAppStore((s) => s.layers)
  const online = useAppStore((s) => s.online)
  const stacked = useAppStore((s) => s.sheets.length > 1)
  const popSheet = useAppStore((s) => s.popSheet)
  const closeSheet = useAppStore((s) => s.closeSheet)
  const pushSheet = useAppStore((s) => s.pushSheet)

  const on = useMemo(() => currentView(), [layers, appMode, saved, lastViewId])
  const all = viewsFor(mode, saved).filter(viewHere)
  const builtIn = all.filter((v) => v.builtIn)
  const own = all.filter((v) => !v.builtIn)

  function show(v: MapView) {
    // a fishing view picked while hunting (or the reverse) is a change of mode first
    if (v.mode !== useViews.getState().mode) setMode(v.mode)
    apply(v)
  }

  const row = (v: MapView) => {
    const mine = pinned[v.mode].includes(v.id)
    const dark = needsSignal(v) && !online
    return (
      <div key={v.id} className={`vx-row${on?.id === v.id ? ' on' : ''}${dark ? ' off' : ''}`}>
        <button className="vx-show" onClick={() => show(v)} aria-label={`Show ${v.name}`}>
          <img src={viewPic(v)} alt="" loading="lazy" draggable={false} />
          <span className="vx-text">
            <span className="vx-name">
              {v.name}
              {on?.id === v.id && <small>on the map</small>}
            </span>
            <span className="vx-what">{viewWhat(v)}</span>
            {(v.use || dark) && <span className="vx-use">{dark ? 'Needs signal' : v.use}</span>}
          </span>
        </button>
        <div className="vx-side">
          <button className={`vx-pin${mine ? ' mine' : ''}`} aria-pressed={mine} onClick={() => togglePin(v.id)}>
            {mine ? '✓ In menu' : '+ Add'}
          </button>
          {!v.builtIn && (
            <button
              className="icon-btn danger vx-trash"
              aria-label={`Delete ${v.name}`}
              onClick={() => {
                if (confirm(`Delete the view ${v.name}?`)) remove(v.id)
              }}
            >
              <IconTrash size={14} />
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="settings">
      <div className="sheet-head">
        <span className="sheet-title">Views</span>
        {/* the fishing views where fishing is on offer (spots/profile.ts FISH_HERE) */}
        {FISH_HERE && (
          <div className="seg" role="radiogroup" aria-label="Which set">
            {(['hunt', 'fish'] as const).map((m) => (
              <button key={m} className={mode === m ? 'seg-on' : ''} role="radio" aria-checked={mode === m} onClick={() => setShown(m)}>
                {m === 'hunt' ? 'Hunting' : 'Fishing'}
              </button>
            ))}
          </div>
        )}
        <button className="sheet-done" onClick={stacked ? popSheet : closeSheet}>
          Done
        </button>
      </div>
      <div className="st-line">Tap one to see it. Add the ones you want to your menu.</div>

      <div className="vx-list">{builtIn.map(row)}</div>

      {own.length > 0 && (
        <>
          <div className="st-sec">Your own</div>
          <div className="vx-list">{own.map(row)}</div>
        </>
      )}

      <button className="vx-make" onClick={() => pushSheet({ kind: 'makeView' })}>
        <span>
          <b>Make your own view</b>
          <small>Pick what goes underneath and on top, save it</small>
        </span>
        <span className="dim">›</span>
      </button>
    </div>
  )
}
