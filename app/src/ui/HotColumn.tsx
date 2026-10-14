import { useEffect, useLayoutEffect, useRef, useState, type JSX, type RefObject } from 'react'
import { useAppStore, type HotId, type HotSide } from '../state/appStore'
import { useViews } from '../state/viewsStore'
import HotSlot from './HotSlot'

/** One column of your buttons: the mode's set for that side from Map
 *  buttons, any number, top to bottom. One too tall for the room between
 *  the strip and the foot wraps: the rest stand in a second column toward
 *  the middle of the map, their foot level with the first's. A press and
 *  hold on one opens its drawer; one drawer at a time. */
export default function HotColumn({ side }: { side: HotSide }): JSX.Element | null {
  const mode = useViews((s) => s.mode)
  const ids = useAppStore((s) => s.hotButtons[mode][side])
  const labels = useAppStore((s) => s.buttonLabels)
  const hidden = useAppStore((s) => s.hotHidden)
  const [open, setOpen] = useState<HotId | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const rows = useRowsThatFit(ref, ids.length, labels, hidden)
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

/** How many buttons stand one above another before the column wraps: the
 *  room from the column's foot up to the strip and the card under it (less
 *  the compass over the near column), in slots as tall as the first one. */
function useRowsThatFit(ref: RefObject<HTMLDivElement | null>, n: number, labels: boolean, hidden: boolean): number {
  const [rows, setRows] = useState(Math.max(1, n))
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const fit = () => {
      const slot = el.querySelector<HTMLElement>('.hotslot')
      if (!slot) return
      const top = document.querySelector('.toparea')?.getBoundingClientRect().bottom ?? 0
      const room = el.getBoundingClientRect().bottom - top - 12 - el.offsetTop
      const h = slot.offsetHeight + parseFloat(getComputedStyle(slot).marginBottom || '0') + GAP
      const fits = Math.max(1, Math.floor((room + GAP) / h))
      setRows((r) => (r === fits ? r : fits))
    }
    fit()
    // the strip folding, a card in the bar, the compass coming over the near column
    const ro = new ResizeObserver(fit)
    for (const t of [document.querySelector('.toparea'), document.querySelector('.bottombar'), el.parentElement]) if (t) ro.observe(t)
    window.addEventListener('resize', fit)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', fit)
    }
  }, [ref, n, labels, hidden])
  return rows
}
