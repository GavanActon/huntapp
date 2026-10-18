import { useEffect, useRef, useState, type JSX, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { useAppStore, type HotId, type HotSets, type HotSide } from '../../state/appStore'
import { useViews } from '../../state/viewsStore'
import { FISH_HERE } from '../../spots/profile'
import { haptic } from '../haptics'
import { HOT_DEFS, HOT_ORDER } from '../hotButtons'
import { IconLocate } from '../icons'
import './settings.css'

/**
 * Map buttons: the two columns side by side as they stand on the map, top
 * to bottom, and the rest in a tray under them. Hold a button and drag it:
 * into a column at any height, across to the other, or back to the tray to
 * take it off the map (Gavan, 2026-10-14: "two column, someone can drag
 * features in and out. No fixed number"). A column too tall for the screen
 * wraps inward on the map (HotColumn). Anywhere below the columns is the
 * tray: a button dragged down past their foot, onto the heading, the hint,
 * the empty sheet or off its bottom, comes off the map (Gavan, 2026-10-18:
 * "drag to bottom anywhere instead of small area"). Near is the thumb's column, My
 * location fixed at its foot. The heading row is its own: the title, the
 * Hunting | Fishing switch and Done (back to Settings, which pushed it).
 */

type Zone = 'left' | 'right' | 'tray'
type Col = 'left' | 'right'

/** a finger holds a button this long to lift it; one that moves sooner was scrolling the sheet */
const HOLD_MS = 220
const SLOP_PX = 8
/** a mouse lifts it on the first few pixels of travel */
const MOUSE_PX = 4
/** near the sheet's top or foot, a dragged button scrolls it */
const EDGE_PX = 48

interface Drag {
  id: HotId
  from: Zone
  x: number
  y: number
  /** the zone under the finger, and where in a column the button would land */
  over: Zone | null
  at: number
}

interface Press {
  id: HotId
  from: Zone
  x0: number
  y0: number
  x: number
  y: number
  mouse: boolean
  timer: number
}

export default function ButtonsSheet(): JSX.Element {
  const [mode, setMode] = useState<'hunt' | 'fish'>(() => useViews.getState().mode)
  const sets = useAppStore((s) => s.hotButtons[mode])
  const leftHanded = useAppStore((s) => s.leftHanded)
  const setHotSets = useAppStore((s) => s.setHotSets)
  const stacked = useAppStore((s) => s.sheets.length > 1)
  const popSheet = useAppStore((s) => s.popSheet)
  const closeSheet = useAppStore((s) => s.closeSheet)
  const [drag, setDrag] = useState<Drag | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const cols = useRef<HTMLDivElement>(null)
  const press = useRef<Press | null>(null)
  const dragRef = useRef<Drag | null>(null)

  // the thumb's column is the right one, or the left for a left hand
  const sideOf = (c: Col): HotSide => ((c === 'right') !== leftHanded ? 'near' : 'far')
  const lists: Record<Col, HotId[]> = { left: sets[sideOf('left')], right: sets[sideOf('right')] }
  const tray = HOT_ORDER.filter((id) => !sets.near.includes(id) && !sets.far.includes(id))

  const drop = (d: Drag) => {
    if (!d.over || (d.over === 'tray' && d.from === 'tray')) return
    const next: Record<Col, HotId[]> = { left: lists.left.filter((x) => x !== d.id), right: lists.right.filter((x) => x !== d.id) }
    if (d.over !== 'tray') next[d.over].splice(d.at, 0, d.id)
    if (next.left.join() === lists.left.join() && next.right.join() === lists.right.join()) return
    setHotSets(mode, { [sideOf('left')]: next.left, [sideOf('right')]: next.right } as HotSets)
    haptic()
  }
  const dropRef = useRef(drop)
  dropRef.current = drop

  const show = (d: Drag | null) => {
    dragRef.current = d
    setDrag(d)
  }

  /** The zone under the finger, and in a column, the place among the other buttons: above the first whose middle is below the finger. */
  const locate = (x: number, y: number, d: Drag): Drag => {
    const zone = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-zone]')
    // below the columns' foot, whatever is under the finger, is the tray
    const foot = cols.current?.getBoundingClientRect().bottom
    const over = (zone?.dataset.zone as Zone | undefined) ?? (foot != null && y > foot ? 'tray' : null)
    let at = 0
    if (zone && (over === 'left' || over === 'right')) {
      const tiles = [...zone.querySelectorAll<HTMLElement>('[data-tile]')].filter((t) => t.dataset.tile !== d.id)
      at = tiles.findIndex((t) => {
        const r = t.getBoundingClientRect()
        return y < r.top + r.height / 2
      })
      if (at < 0) at = tiles.length
    }
    return { ...d, x, y, over, at }
  }

  const lift = () => {
    const p = press.current
    if (!p) return
    window.clearTimeout(p.timer)
    haptic()
    show(locate(p.x, p.y, { id: p.id, from: p.from, x: p.x, y: p.y, over: p.from, at: 0 }))
  }

  const down = (e: ReactPointerEvent, id: HotId, from: Zone) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const mouse = e.pointerType === 'mouse'
    const p: Press = { id, from, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, mouse, timer: 0 }
    press.current = p
    if (!mouse) p.timer = window.setTimeout(lift, HOLD_MS)
  }

  useEffect(() => {
    const release = () => {
      if (press.current) window.clearTimeout(press.current.timer)
      press.current = null
    }
    const move = (e: PointerEvent) => {
      const p = press.current
      if (!p) return
      p.x = e.clientX
      p.y = e.clientY
      const d = dragRef.current
      if (!d) {
        const far = Math.hypot(e.clientX - p.x0, e.clientY - p.y0)
        if (p.mouse && far > MOUSE_PX) lift()
        else if (!p.mouse && far > SLOP_PX) release() // a scroll of the sheet
        return
      }
      show(locate(e.clientX, e.clientY, d))
      // near the sheet's edge, the sheet scrolls under the button
      const body = root.current?.closest('.sheet-body')
      if (body) {
        const r = body.getBoundingClientRect()
        if (e.clientY < r.top + EDGE_PX) body.scrollBy(0, -12)
        else if (e.clientY > r.bottom - EDGE_PX) body.scrollBy(0, 12)
      }
    }
    const up = () => {
      const d = dragRef.current
      release()
      if (!d) return
      show(null)
      dropRef.current(d)
    }
    const cancel = () => {
      release()
      if (dragRef.current) show(null)
    }
    // lifted, the finger moves the button, not the sheet
    const hold = (e: TouchEvent) => {
      if (dragRef.current) e.preventDefault()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('touchmove', hold, { passive: false })
    return () => {
      release()
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('touchmove', hold)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const column = (c: Col) => {
    const ids = lists[c]
    const here = drag?.over === c
    const out: JSX.Element[] = []
    let k = 0
    for (const id of ids) {
      if (drag?.id !== id) {
        if (here && drag.at === k) out.push(<div key="ph" className="hotedit-ph" />)
        k++
      }
      out.push(<Tile key={id} id={id} lifted={drag?.id === id} onDown={(e) => down(e, id, c)} />)
    }
    if (here && drag.at >= k) out.push(<div key="ph" className="hotedit-ph" />)
    return (
      <div className={`hotedit-col${here ? ' over' : ''}`} data-zone={c}>
        <div className="hotedit-colhead">{c === 'left' ? 'Left' : 'Right'}</div>
        {out}
        {sideOf(c) === 'near' && (
          <div className="hotedit-locked">
            <span className="hotedit-ic">
              <IconLocate size={18} />
            </span>
            <span>My location</span>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="settings hotedit" ref={root}>
      <div className="sheet-head">
        <span className="sheet-title">Map buttons</span>
        {/* the fishing set where fishing is on offer (spots/profile.ts FISH_HERE) */}
        {FISH_HERE && (
          <div className="seg" role="radiogroup" aria-label="Which set">
            {(['hunt', 'fish'] as const).map((m) => (
              <button key={m} className={mode === m ? 'seg-on' : ''} role="radio" aria-checked={mode === m} onClick={() => setMode(m)}>
                {m === 'hunt' ? 'Hunting' : 'Fishing'}
              </button>
            ))}
          </div>
        )}
        <button className="sheet-done" onClick={stacked ? popSheet : closeSheet}>
          Done
        </button>
      </div>

      <div className="hotedit-cols" ref={cols}>
        {column('left')}
        {column('right')}
      </div>

      <div className="st-sec">More buttons</div>
      <div className={`hotedit-tray${drag?.over === 'tray' ? ' over' : ''}`} data-zone="tray">
        {tray.map((id) => (
          <Tile key={id} id={id} lifted={drag?.id === id} onDown={(e) => down(e, id, 'tray')} />
        ))}
      </div>
      <div className="hotedit-hint">Hold a button, then drag it · drop it anywhere down here to take it off the map</div>

      {drag &&
        createPortal(
          <div className="hotedit-ghost" style={{ left: drag.x, top: drag.y }}>
            <Tile id={drag.id} />
          </div>,
          document.body,
        )}
    </div>
  )
}

/** A button in the editor: its icon in a small circle and its whole name. */
function Tile({ id, lifted, onDown }: { id: HotId; lifted?: boolean; onDown?: (e: ReactPointerEvent) => void }): JSX.Element {
  const d = HOT_DEFS[id]
  return (
    <div className={`hotedit-tile${lifted ? ' lifted' : ''}`} data-tile={id} onPointerDown={onDown} onContextMenu={(e) => e.preventDefault()}>
      <span className="hotedit-ic">
        <d.Icon size={18} />
      </span>
      <span>{d.name}</span>
    </div>
  )
}
