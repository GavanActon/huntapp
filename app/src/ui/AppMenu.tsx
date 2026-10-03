import { useRef, type JSX } from 'react'
import { openHuntLog } from '../log/logView'
import { useMapUpdates } from '../offline/updates'
import { useAppStore, type Sheet } from '../state/appStore'
import { IconBook, IconClock, IconGear, IconGrid, IconLayers, IconPin } from './icons'
import { useTapOff } from './tapOff'

/**
 * The ⋯ menu behind the strip: Hunt log, Pins, Map buttons, Views, HuntOS
 * (the field guide) and Settings, with the new-maps count beside Settings
 * when the server has some. It hangs under
 * the right end of whatever is position: relative around it (the folded
 * line, or the open strip's header); a tap anywhere else closes it.
 */
export default function AppMenu({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null)
  const openSheet = useAppStore((s) => s.openSheet)
  const newMaps = useMapUpdates((s) => s.pending.length)
  useTapOff(ref, open, onClose)
  if (!open) return null
  const go = (s: Sheet) => {
    onClose()
    openSheet(s)
  }
  return (
    <div className="wx-menu" ref={ref} role="menu" aria-label="More">
      <button
        className="wx-menu-row"
        role="menuitem"
        onClick={() => {
          onClose()
          openHuntLog()
        }}
      >
        <IconClock />
        Hunt log
        <span className="dim">›</span>
      </button>
      <button className="wx-menu-row" role="menuitem" onClick={() => go({ kind: 'pins' })}>
        <IconPin />
        Pins
        <span className="dim">›</span>
      </button>
      <button className="wx-menu-row" role="menuitem" onClick={() => go({ kind: 'buttons' })}>
        <IconGrid />
        Map buttons
        <span className="dim">›</span>
      </button>
      <button className="wx-menu-row" role="menuitem" onClick={() => go({ kind: 'views' })}>
        <IconLayers />
        Views
        <span className="dim">›</span>
      </button>
      <button className="wx-menu-row" role="menuitem" onClick={() => go({ kind: 'guide' })}>
        <IconBook />
        HuntOS
        <span className="dim">›</span>
      </button>
      <button className="wx-menu-row" role="menuitem" onClick={() => go({ kind: 'settings' })}>
        <IconGear />
        Settings
        {newMaps > 0 ? <span className="wx-menu-badge">{newMaps === 1 ? '1 new map' : `${newMaps} new maps`}</span> : <span className="dim">›</span>}
      </button>
    </div>
  )
}
