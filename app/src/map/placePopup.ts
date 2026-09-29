import maplibregl, { type Map as MlMap } from 'maplibre-gl'
import { useAppStore } from '../state/appStore'
import { usePlacesStore, type SavedPlace } from '../state/placesStore'
import { agoLabel } from '../time'
import { closeOnTapOff } from './tapPopup'
import '../ui/minipop.css'

/**
 * A pin of your own, tapped: its name, when it was dropped and its note,
 * with Delete, and Open for the Places sheet on it (what a tap on a place
 * did before). The camp and the lakes are presets and keep the plain tap.
 *
 * A pin never named and with no note goes at once; one you have named or
 * written on asks first.
 */

/** Dropped from the tap popup and never named: what "Clear pins" in Places takes away. */
export const DROPPED_NAME = 'Pin'
export const isDroppedPin = (p: SavedPlace) => p.savedAt > 0 && p.name === DROPPED_NAME && !p.note

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)

let open: maplibregl.Popup | null = null

export function showPlacePopup(map: MlMap, p: SavedPlace) {
  open?.remove()
  const el = document.createElement('div')
  el.innerHTML =
    `<div class="mp-head"><b>${esc(p.name)}</b><span>${esc(p.kind)}</span></div>` +
    `<div class="mp-sub">dropped ${esc(agoLabel(Date.now() - p.savedAt))}</div>` +
    (p.note ? `<div class="mp-note">${esc(p.note)}</div>` : '') +
    `<div class="pp-acts"><button class="mp-danger pl-delete">Delete</button><button class="mp-plain pl-open">Open</button></div>`
  const pop = new maplibregl.Popup({ className: 'depth-popup', closeButton: false, closeOnClick: false, offset: 10, maxWidth: '240px' })
    .setLngLat([p.lon, p.lat])
    .setDOMContent(el)
    .addTo(map)
  closeOnTapOff(map, pop)
  pop.on('close', () => {
    if (open === pop) open = null
  })
  open = pop
  el.querySelector('.pl-delete')?.addEventListener('click', () => {
    if (!isDroppedPin(p) && !confirm(`Delete ${p.name}?`)) return
    pop.remove()
    usePlacesStore.getState().remove(p.id)
  })
  el.querySelector('.pl-open')?.addEventListener('click', () => {
    pop.remove()
    usePlacesStore.getState().select(p.id)
    useAppStore.getState().setSheetTab('places')
  })
}
