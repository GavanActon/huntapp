import { useEffect, useLayoutEffect, useMemo, useRef, useState, type JSX, type RefObject } from 'react'
import { useAppStore, type HotId, type HotSide } from '../state/appStore'
import { useViews } from '../state/viewsStore'
import HotSlot from './HotSlot'
import { shownHot } from './hotButtons'

/** One column of your buttons: the mode's set for that side from Map
 *  buttons, any number, top to bottom. One too tall for the room between
 *  the strip and the foot wraps: the rest stand in a second column toward
 *  the middle of the map, their foot level with the first's. A press and
 *  hold on one opens its drawer; one drawer at a time. */
export default function HotColumn({ side }: { side: HotSide }): JSX.Element | null {
  const mode = useViews((s) => s.mode)
  const placed = useAppStore((s) => s.hotButtons[mode][side])
  const ids = useMemo(() => shownHot(placed), [placed])
  const labels = useAppStore((s) => s.buttonLabels)
  const hidden = useAppStore((s) => s.hotHidden)
  const [open, setOpen] = useState<HotId | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  // two columns at most: past that a short room took them across the map one by one (Gavan, 2026-10-17, the Measure card up:
  // "Action buttons end up in weird place"); a column too tall for two grows up instead, and folding the strip gives it the room
  const rows = Math.max(useRowsThatFit(ref, ids.length, labels, hidden), Math.ceil(ids.length / MAX_COLS))
  useEffect(() => {
    if (open && !ids.includes(open)) setOpen(null)
  }, [ids, open])
  if (!ids.length || hidden) return null
  const cols: HotId[][] = []
  for (let i = 0; i < ids.length; i += rows) cols.push(ids.slice(i, i + rows))
  return (
    <div className="hotcol" ref={ref}>
      {cols.map((col, i) => (
        <div className="hotcol-col" key={i}>
          {col.map((id) => (
            <HotSlot key={id} id={id} labels={labels} open={open === id} onOpen={() => setOpen(id)} onClose={() => setOpen((o) => (o === id ? null : o))} />
          ))}
        </div>
      ))}
    </div>
  )
}

const GAP = 10 // .hotcol-col's gap
/** Columns a side at most. */
const MAX_COLS = 2

/** How far the column's stack has still to slide down (up, if less than 0)
 *  to where it comes to rest: it rides the bar's card (bottom: --barh, a
 *  0.18 s slide), and a fit mid-slide must count the room it ends with. */
function stillToSlide(stack: HTMLElement | null): number {
  if (!stack || typeof stack.getAnimations !== 'function') return 0
  for (const a of stack.getAnimations()) {
    if (!(a instanceof CSSTransition) || a.transitionProperty !== 'bottom') continue
    const frames = (a.effect as KeyframeEffect | null)?.getKeyframes()
    const end = parseFloat(String(frames?.[frames.length - 1]?.bottom))
    if (Number.isFinite(end)) return parseFloat(getComputedStyle(stack).bottom) - end
  }
  return 0
}

/** How many buttons stand one above another before the column wraps: the
 *  room from the column's foot, where it comes to rest, up to the strip and
 *  the card under it (less the compass over the near column), in slots as
 *  tall as the first one. Measured mid-slide it once kept the slide's start:
 *  a card closing left the columns wrapped short, on a PC flat along the
 *  foot (Gavan, 2026-10-14), since nothing resizes when the slide ends. */
function useRowsThatFit(ref: RefObject<HTMLDivElement | null>, n: number, labels: boolean, hidden: boolean): number {
  const [rows, setRows] = useState(Math.max(1, n))
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const stack = el.closest<HTMLElement>('.toolcol, .leftstack')
    const fit = () => {
      const slot = el.querySelector<HTMLElement>('.hotslot')
      if (!slot) return
      const top = document.querySelector('.toparea')?.getBoundingClientRect().bottom ?? 0
      const foot = el.getBoundingClientRect().bottom + stillToSlide(stack)
      const room = foot - top - 12 - el.offsetTop
      const h = slot.offsetHeight + parseFloat(getComputedStyle(slot).marginBottom || '0') + GAP
      const fits = Math.max(1, Math.floor((room + GAP) / h))
      setRows((r) => (r === fits ? r : fits))
    }
    fit()
    // the strip folding, a card in the bar, the compass coming over the near column
    const ro = new ResizeObserver(fit)
    for (const t of [document.querySelector('.toparea'), document.querySelector('.bottombar'), el.parentElement]) if (t) ro.observe(t)
    window.addEventListener('resize', fit)
    // and once more where the slide stops, should one start unseen
    const slid = (e: TransitionEvent) => {
      if (e.target === stack && e.propertyName === 'bottom') fit()
    }
    stack?.addEventListener('transitionend', slid)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', fit)
      stack?.removeEventListener('transitionend', slid)
    }
  }, [ref, n, labels, hidden])
  return rows
}
