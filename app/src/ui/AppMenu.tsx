import { useEffect, useRef, useState, type JSX } from 'react'
import { ACTIVE_AREA } from '../areas'
import { openHuntLog } from '../log/logView'
import { pasteAndGo } from '../map/goto'
import { useMapUpdates } from '../offline/updates'
import { shareArea } from '../share/share'
import { useAppStore, type Sheet } from '../state/appStore'
import { IconBook, IconClock, IconGear, IconGrid, IconLayers, IconPin, IconShare, IconTarget } from './icons'
import { useTapOff } from './tapOff'

/**
 * The ⋯ menu behind the strip: Hunt log, Pins, Go to coordinates (with
 * Paste at its end), Share the area, Map buttons, Views, HuntOS (the field
 * guide) and Settings, with the new-maps count beside Settings when the
 * server has some. It hangs under the right end of whatever is position:
 * relative around it (the folded line, or the open strip's header); a tap
 * anywhere else closes it.
 *
 * Paste and Share do their work inside the tap (iOS refuses either
 * otherwise), and the menu stays up until it is done: iOS's Paste bubble
 * sits beside it, and with no share sheet the Share row says whether the
 * message reached the clipboard.
 */
export default function AppMenu({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null)
  const openSheet = useAppStore((s) => s.openSheet)
  const newMaps = useMapUpdates((s) => s.pending.length)
  // what the Share row says once the message went to the clipboard, or did not
  const [said, setSaid] = useState<string | null>(null)
  // a paste or a share under way: a second tap waits for it
  const busy = useRef(false)
  // one per opening: what settles after the menu has closed (a tap off it) leaves the next opening alone
  const opening = useRef(0)
  const timer = useRef<number | undefined>(undefined)
  useTapOff(ref, open, onClose)
  // the word, its timer and a wait go with the menu, however it closed
  useEffect(() => {
    if (open) return
    opening.current++
    busy.current = false
    window.clearTimeout(timer.current)
    setSaid(null)
  }, [open])
  useEffect(() => () => window.clearTimeout(timer.current), [])
  if (!open) return null
  const go = (s: Sheet) => {
    onClose()
    openSheet(s)
  }
  const paste = () => {
    if (busy.current) return
    busy.current = true
    const mine = opening.current
    void pasteAndGo().finally(() => {
      if (mine === opening.current) onClose()
    })
  }
  const share = () => {
    if (busy.current) return
    busy.current = true
    const mine = opening.current
    void shareArea(ACTIVE_AREA).then((r) => {
      if (mine !== opening.current) return
      if (r !== 'copied' && r !== 'failed') return onClose()
      // no share sheet here: the message went to the clipboard, or did not, and the row says which
      setSaid(r === 'copied' ? 'Copied' : 'Could not copy')
      timer.current = window.setTimeout(onClose, r === 'copied' ? 1200 : 2400)
    })
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
      {/* two taps in one row: the sheet, or straight to what the clipboard holds */}
      <div className="wx-menu-row wx-menu-split" role="none">
        <button className="wx-menu-main" role="menuitem" onClick={() => go({ kind: 'coords' })}>
          <IconTarget />
          Go to coordinates
        </button>
        {typeof navigator.clipboard?.readText === 'function' ? (
          <button className="wx-menu-pill" role="menuitem" onClick={paste}>
            Paste
          </button>
        ) : (
          <span className="dim">›</span>
        )}
      </div>
      <button className="wx-menu-row" role="menuitem" onClick={share}>
        <IconShare />
        {said ?? `Share ${ACTIVE_AREA.name}`}
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
