import type { JSX } from 'react'
import { HOT_MAX, useAppStore } from '../state/appStore'
import { useViews } from '../state/viewsStore'
import { HotButton } from './hotButtons'

/** Your hot buttons, bottom-left over the view pill: the mode's set from Map buttons, up to four. */
export default function HotColumn(): JSX.Element | null {
  const mode = useViews((s) => s.mode)
  const ids = useAppStore((s) => s.hotButtons[mode])
  if (!ids.length) return null
  return (
    <div className="hotcol">
      {ids.slice(0, HOT_MAX).map((id) => (
        <HotButton key={id} id={id} />
      ))}
    </div>
  )
}
