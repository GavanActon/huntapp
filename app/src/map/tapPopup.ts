import type { Map as MlMap, Popup } from 'maplibre-gl'

/** further than this between finger down and up is a pan, not a tap */
const DRAG_PX = 6

/**
 * A tapped popup has no close button: the next tap anywhere off it closes
 * it. On the map that tap only closes it — it does not open another popup
 * or pick what is under it, so tap, look, tap again. Off the map (the
 * sheet, a button) the tap closes it and still does its own job. Panning
 * is not a tap, so dragging to see around the popup keeps it open.
 *
 * Call it right after addTo(map), inside the tap that opened it: the
 * listener goes on after that tap has passed, so it does not close at once.
 */
export function closeOnTapOff(map: MlMap, popup: Popup) {
  let down: { x: number; y: number } | null = null
  const onDown = (e: PointerEvent) => {
    down = { x: e.clientX, y: e.clientY }
  }
  const onClick = (e: MouseEvent) => {
    const t = e.target as Node | null
    if (t && popup.getElement()?.contains(t)) return
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > DRAG_PX) return
    // on the map the tap is spent closing it, before maplibre sees it
    if (t && map.getCanvasContainer().contains(t)) e.stopPropagation()
    popup.remove()
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') popup.remove()
  }
  window.addEventListener('pointerdown', onDown, true)
  window.addEventListener('click', onClick, true)
  window.addEventListener('keydown', onKey)
  popup.once('close', () => {
    window.removeEventListener('pointerdown', onDown, true)
    window.removeEventListener('click', onClick, true)
    window.removeEventListener('keydown', onKey)
  })
}
