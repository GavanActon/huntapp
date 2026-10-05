import { useEffect, useRef, type JSX } from 'react'
import { openHuntLog } from '../log/logView'
import { pasteAndGo } from '../map/goto'
import { useMapUpdates } from '../offline/updates'
import { useAppStore, type Sheet } from '../state/appStore'
import { satWaiting } from '../weather/satForecast'
import { IconBook, IconClock, IconGear, IconGrid, IconLayers, IconPin, IconPlaces, IconSatellite, IconTarget } from './icons'
import { useTapOff } from './tapOff'

/**
 * The ⋯ menu behind the strip: Hunt log, Pins, Locations (the areas, each
 * with its Share), Go to coordinates (with Paste at its end), Map buttons,
 * Views, HuntOS (the field guide) and Settings, with the new-maps count
 * beside Settings when the server has some. Weather by satellite joins
 * them with no signal, or while a request sent by text waits for its
 * answer; with signal there is nothing for it to do. The menu hangs under
 * the right end of whatever is position: relative around it (the folded
 * line, or the open strip's header); a tap anywhere else closes it.
 *
 * Paste reads the clipboard inside the tap (iOS refuses it otherwise), and
 * the menu stays up until it is done: iOS's Paste bubble sits beside it.
 */
export default function AppMenu({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element | null {
  const ref = useRef<HTMLDivElement>(null)
  const openSheet = useAppStore((s) => s.openSheet)
  const newMaps = useMapUpdates((s) => s.pending.length)
  const online = useAppStore((s) => s.online)
  // a paste under way: a second tap waits for it
  const busy = useRef(false)
  // one per opening: what settles after the menu has closed (a tap off it) leaves the next opening alone
  const opening = useRef(0)
  useTapOff(ref, open, onClose)
  // a wait goes with the menu, however it closed
  useEffect(() => {
    if (open) return
    opening.current++
    busy.current = false
  }, [open])
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
      <button className="wx-menu-row" role="menuitem" onClick={() => go({ kind: 'locations' })}>
        <IconPlaces />
        Locations
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
      {(!online || satWaiting()) && (
        <button className="wx-menu-row" role="menuitem" onClick={() => go({ kind: 'sat' })}>
          <IconSatellite />
          Weather by satellite
          <span className="dim">›</span>
        </button>
      )}
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
