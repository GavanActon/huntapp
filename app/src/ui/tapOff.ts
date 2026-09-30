import { useEffect, useRef, type RefObject } from 'react'
import { getMap } from '../map/mapController'

/** further than this between finger down and up is a pan, not a tap */
const DRAG_PX = 6

/**
 * A tap outside the element closes it: nothing here has a × (the same rule
 * as map/tapPopup.ts#closeOnTapOff, which stays for maplibre popups). On
 * the map canvas the tap is spent closing (stopPropagation before maplibre
 * sees it, so no popup opens and nothing under it is picked); off the map a
 * button still does its own job. A pointerdown→click move over DRAG_PX is a
 * pan, not a tap, so dragging the map to look around keeps it open. Escape
 * closes.
 *
 * Listeners go on `window` in the capture phase, so one added from inside
 * the opening tap (a React effect, or right after `addTo`) does not fire for
 * that tap: the window's capture pass is already over by then.
 *
 * Returns the disposer.
 */
export function onTapOff(get: () => HTMLElement | null, close: () => void): () => void {
  let down: { x: number; y: number } | null = null
  const onDown = (e: PointerEvent) => {
    down = { x: e.clientX, y: e.clientY }
  }
  const onClick = (e: MouseEvent) => {
    const t = e.target as Node | null
    if (t && get()?.contains(t)) return
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > DRAG_PX) return
    if (t && getMap()?.getCanvasContainer().contains(t)) e.stopPropagation()
    close()
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close()
  }
  window.addEventListener('pointerdown', onDown, true)
  window.addEventListener('click', onClick, true)
  window.addEventListener('keydown', onKey)
  return () => {
    window.removeEventListener('pointerdown', onDown, true)
    window.removeEventListener('click', onClick, true)
    window.removeEventListener('keydown', onKey)
  }
}

/** onTapOff as a hook: on while `active`, closing through the latest `close`. */
export function useTapOff(ref: RefObject<HTMLElement | null>, active: boolean, close: () => void): void {
  // the newest close, read at the tap: the listeners stay put across renders
  const closeRef = useRef(close)
  closeRef.current = close
  useEffect(() => {
    if (!active) return
    return onTapOff(() => ref.current, () => closeRef.current())
  }, [ref, active])
}
