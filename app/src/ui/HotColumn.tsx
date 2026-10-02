import { useEffect, useState, type JSX } from 'react'
import { HOT_MAX, useAppStore, type HotId, type HotSide } from '../state/appStore'
import { useViews } from '../state/viewsStore'
import HotSlot from './HotSlot'

/** One column of your buttons: the mode's set for that side from Map
 *  buttons, up to four. A press and hold on one opens its drawer; one
 *  drawer at a time. */
export default function HotColumn({ side }: { side: HotSide }): JSX.Element | null {
  const mode = useViews((s) => s.mode)
  const ids = useAppStore((s) => s.hotButtons[mode][side])
  const labels = useAppStore((s) => s.buttonLabels)
  const hidden = useAppStore((s) => s.hotHidden)
  const [open, setOpen] = useState<HotId | null>(null)
  useEffect(() => {
    if (open && !ids.includes(open)) setOpen(null)
  }, [ids, open])
  if (!ids.length || hidden) return null
  return (
    <div className="hotcol">
      {ids.slice(0, HOT_MAX).map((id) => (
        <HotSlot key={id} id={id} labels={labels} open={open === id} onOpen={() => setOpen(id)} onClose={() => setOpen((o) => (o === id ? null : o))} />
      ))}
    </div>
  )
}
