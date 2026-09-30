import type { JSX } from 'react'
import { HOT_MAX, useAppStore, type HotSide } from '../state/appStore'
import { useViews } from '../state/viewsStore'
import { HotButton } from './hotButtons'

/** One column of your buttons: the mode's set for that side from Map buttons, up to four. */
export default function HotColumn({ side }: { side: HotSide }): JSX.Element | null {
  const mode = useViews((s) => s.mode)
  const ids = useAppStore((s) => s.hotButtons[mode][side])
  if (!ids.length) return null
  return (
    <div className="hotcol">
      {ids.slice(0, HOT_MAX).map((id) => (
        <HotButton key={id} id={id} />
      ))}
    </div>
  )
}
