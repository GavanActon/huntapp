import { useRef, useState, type JSX } from 'react'
import { useAppStore } from '../../state/appStore'
import { splitViews, useViews, type MapView, type Mode } from '../../state/viewsStore'
import { IconStar, IconTrash } from '../icons'
import './settings.css'

/**
 * Views: which of a mode's views sit at the top of the pill menu, and in
 * what order. A star pins a view (it joins the end of the top list) or
 * sends it back under More; the handle at the left of a pinned row drags
 * it up or down the list. Saved views have a trash. The heading row is its
 * own: the title, the Hunting | Fishing switch and Done (back to Settings,
 * which pushed it, or closed).
 */
export default function ViewsSheet(): JSX.Element {
  const [mode, setMode] = useState<Mode>(() => useViews.getState().mode)
  const saved = useViews((s) => s.saved)
  const pinned = useViews((s) => s.pinned)
  const togglePin = useViews((s) => s.togglePin)
  const setPinned = useViews((s) => s.setPinned)
  const remove = useViews((s) => s.remove)
  const stacked = useAppStore((s) => s.sheets.length > 1)
  const popSheet = useAppStore((s) => s.popSheet)
  const closeSheet = useAppStore((s) => s.closeSheet)
  const { top, rest } = splitViews(mode, saved, pinned)

  /** the id under the finger while a row is being dragged */
  const [dragging, setDragging] = useState<string | null>(null)
  const rows = useRef(new Map<string, HTMLDivElement>())

  function startDrag(e: React.PointerEvent, id: string) {
    e.preventDefault()
    e.stopPropagation()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    setDragging(id)
  }
  /** the row the finger is over becomes the dragged row's place */
  function moveDrag(e: React.PointerEvent, id: string) {
    if (dragging !== id) return
    const ids = top.map((v) => v.id)
    const from = ids.indexOf(id)
    let to = from
    for (const [other, el] of rows.current) {
      if (other === id) continue
      const r = el.getBoundingClientRect()
      if (e.clientY < r.top || e.clientY > r.bottom) continue
      to = ids.indexOf(other)
      break
    }
    if (to === from || to < 0) return
    const next = ids.filter((x) => x !== id)
    next.splice(to, 0, id)
    setPinned(mode, next)
  }
  function endDrag() {
    setDragging(null)
  }

  const trash = (v: MapView) =>
    v.builtIn ? null : (
      <button
        className="icon-btn danger viewedit-trash"
        aria-label={`Delete ${v.name}`}
        onClick={() => {
          if (confirm(`Delete the view ${v.name}?`)) remove(v.id)
        }}
      >
        <IconTrash size={14} />
      </button>
    )

  return (
    <div className="settings">
      <div className="sheet-head">
        <span className="sheet-title">Views</span>
        <div className="seg" role="radiogroup" aria-label="Which set">
          {(['hunt', 'fish'] as const).map((m) => (
            <button key={m} className={mode === m ? 'seg-on' : ''} role="radio" aria-checked={mode === m} onClick={() => setMode(m)}>
              {m === 'hunt' ? 'Hunting' : 'Fishing'}
            </button>
          ))}
        </div>
        <button className="sheet-done" onClick={stacked ? popSheet : closeSheet}>
          Done
        </button>
      </div>

      <div className="st-sec">At the top · drag to order</div>
      <div className={`viewedit-list${dragging ? ' dragging' : ''}`}>
        {top.length === 0 && <div className="st-line">Nothing pinned: the menu starts at More.</div>}
        {top.map((v) => (
          <div
            key={v.id}
            className={`viewedit-row${dragging === v.id ? ' lifted' : ''}`}
            ref={(el) => {
              if (el) rows.current.set(v.id, el)
              else rows.current.delete(v.id)
            }}
          >
            <span
              className="viewedit-grip"
              aria-label={`Move ${v.name}`}
              role="button"
              onPointerDown={(e) => startDrag(e, v.id)}
              onPointerMove={(e) => moveDrag(e, v.id)}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            >
              <i />
              <i />
              <i />
            </span>
            <span className="viewedit-name">{v.name}</span>
            {trash(v)}
            <button className="viewedit-star on" onClick={() => togglePin(v.id)} aria-pressed aria-label={`Unpin ${v.name}`}>
              <IconStar size={16} />
            </button>
          </div>
        ))}
      </div>

      <div className="st-sec">Under More</div>
      <div className="viewedit-list">
        {rest.length === 0 && <div className="st-line">Every view is at the top.</div>}
        {rest.map((v) => (
          <div key={v.id} className="viewedit-row">
            <span className="viewedit-grip blank" />
            <span className="viewedit-name">{v.name}</span>
            {trash(v)}
            <button className="viewedit-star" onClick={() => togglePin(v.id)} aria-pressed={false} aria-label={`Pin ${v.name}`}>
              <IconStar size={16} />
            </button>
          </div>
        ))}
      </div>
      <div className="st-line">Save a new view from Edit this view, under the view pill.</div>
    </div>
  )
}
