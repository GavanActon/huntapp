import maplibregl, { type Map as MlMap } from 'maplibre-gl'
import { ACTIVE_AREA } from '../areas'
import { switchArea } from '../areas/switch'
import { SHEET_HALF_PCT, useAppStore } from '../state/appStore'
import { placeColour } from '../state/pinColours'
import { placeArea, usePlacesStore, type SavedPlace } from '../state/placesStore'
import { getMap } from './mapController'
import { closeOnTapOff } from './tapPopup'
import '../ui/minipop.css'

/**
 * A pin of your own, tapped: its name and colour, and Open for its sheet,
 * nothing else (Gavan, 2026-10-15). The notes, Share and Delete are all in
 * the sheet, Delete at its foot. The camp and the lakes are presets and open
 * Dig in instead (MapView).
 *
 * A pin just added skips this and opens its sheet (openPinSheet): the name,
 * the colour and the notes all at once (Gavan, 2026-10-14).
 */

/** Dropped from the tap popup and never named: what "Clear pins" in Places takes away. */
export const DROPPED_NAME = 'Pin'
export const isDroppedPin = (p: SavedPlace) => p.savedAt > 0 && p.name === DROPPED_NAME && !p.note && !p.notes?.length

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)

let open: maplibregl.Popup | null = null

export function showPlacePopup(map: MlMap, p: SavedPlace) {
  open?.remove()
  const el = document.createElement('div')
  // the pin as it is now, not as it was when the popup went up
  const live = () => usePlacesStore.getState().places.find((q) => q.id === p.id) ?? p
  el.innerHTML =
    `<div class="mp-head"><i style="background:${placeColour(p)}"></i><b>${esc(p.name)}</b></div>` +
    `<div class="pp-acts"><button class="mp-plain pl-open">Open</button></div>`
  const pop = new maplibregl.Popup({ className: 'depth-popup', closeButton: false, closeOnClick: false, offset: 10, maxWidth: '240px' })
    .setLngLat([p.lon, p.lat])
    .setDOMContent(el)
    .addTo(map)
  closeOnTapOff(map, pop)
  pop.on('close', () => {
    if (open === pop) open = null
  })
  open = pop

  el.querySelector('.pl-open')?.addEventListener('click', () => {
    pop.remove()
    // a pin in another area: the app switches there, picks it and opens its sheet
    const away = placeArea(live())
    if (away && away.id !== ACTIVE_AREA.id) return void switchArea(away.id, { center: [p.lon, p.lat], zoom: Math.max(map.getZoom(), 13) }, { kind: 'select', id: p.id, pins: true })
    // one of the two places a pin gets selected (the other is a Pins row)
    usePlacesStore.getState().select(p.id)
    openPinSheet(p.id)
  })
  clearStrip(map, pop)
}

/** A popup reaching up under the strip (a pin high on the screen, as one left above its sheet is): the map comes down until it clears it. */
function clearStrip(map: MlMap, pop: maplibregl.Popup) {
  const strip = document.querySelector('.wxstrip')?.getBoundingClientRect().bottom
  const top = pop.getElement()?.getBoundingClientRect().top
  if (strip == null || top == null) return
  const over = strip + 8 - top
  if (over > 0) map.panBy([0, -over], { duration: 250 })
}

/**
 * A pin's sheet (ui/sheets/PinSheet.tsx), the map eased so the pin sits in
 * what the sheet leaves of it, under the strip. push: over the sheet that is
 * up, with ‹ Back to it (Pins, Dig in, Go to coordinates). While the map
 * follows you it stays put: the next fix would take it back.
 */
export function openPinSheet(id: string, { push = false }: { push?: boolean } = {}) {
  const p = usePlacesStore.getState().places.find((q) => q.id === id)
  if (!p) return
  open?.remove()
  const app = useAppStore.getState()
  if (push) app.pushSheet({ kind: 'pin', id })
  else app.openSheet({ kind: 'pin', id })
  const m = getMap()
  const away = placeArea(p)
  if (!m || app.follow || (away && away.id !== ACTIVE_AREA.id)) return
  keepInView(m, p.lon, p.lat, SHEET_HALF_PCT.pin)
}

/** Ease the point into the band between the strip and a sheet at pct (BottomSheet's half detent), if it is not there already. */
function keepInView(m: MlMap, lon: number, lat: number, pct: number) {
  const box = m.getContainer().getBoundingClientRect()
  const h = window.innerHeight
  const top = (document.querySelector('.wxstrip')?.getBoundingClientRect().bottom ?? box.top) + 16
  const bottom = Math.max(top + 40, h - Math.min((pct / 100) * h, pct * 8) - 28)
  const at = m.project([lon, lat])
  const x = box.left + at.x
  const y = box.top + at.y
  if (y >= top && y <= bottom && x >= box.left + 24 && x <= box.right - 24) return
  m.easeTo({ center: [lon, lat], offset: [0, (top + bottom) / 2 - (box.top + box.height / 2)], duration: 450 })
}
