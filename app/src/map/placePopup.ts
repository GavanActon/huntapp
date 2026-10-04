import maplibregl, { type Map as MlMap } from 'maplibre-gl'
import { ACTIVE_AREA } from '../areas'
import { switchArea } from '../areas/switch'
import { shareSpot } from '../share/share'
import { useAppStore } from '../state/appStore'
import { windVerdict, windsLabel } from '../spots/standWinds'
import { PIN_COLOURS, placeColour } from '../state/pinColours'
import { placeArea, usePlacesStore, type SavedPlace } from '../state/placesStore'
import { agoLabel } from '../time'
import { closeOnTapOff } from './tapPopup'
import '../ui/minipop.css'

/**
 * A pin of your own, tapped (or just dropped): its name, which is a field
 * and edits in place, its colour as a row of swatches, when it was dropped
 * and its note, with Delete, Share (the pin, its name and a link to it:
 * share/share.ts) and Open for the Pins sheet on it. The camp and the
 * lakes are presets and open Dig in instead (MapView).
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
  // the pin as it is now: the field and the swatches edit it while the popup is up
  const live = () => usePlacesStore.getState().places.find((q) => q.id === p.id) ?? p
  // a stand with its good winds set: how the next sit's ground wind reads against them
  const v = windVerdict(p)
  const swatches = PIN_COLOURS.map((c) => `<button class="pin-swatch${placeColour(p) === c ? ' on' : ''}" data-c="${c}" style="--sw:${c}" aria-label="Colour ${c}" aria-pressed="${placeColour(p) === c}"></button>`).join('')
  el.innerHTML =
    `<div class="mp-head"><input class="mp-name" value="${isDroppedPin(p) ? '' : esc(p.name)}" placeholder="Name this pin" aria-label="Name" maxlength="40" autocomplete="off" enterkeyhint="done" /><span>${esc(p.kind)}</span></div>` +
    `<div class="pin-swatches">${swatches}</div>` +
    `<div class="mp-sub">dropped ${esc(agoLabel(Date.now() - p.savedAt))}${p.winds?.length ? ` · winds ${esc(windsLabel(p.winds))}` : ''}</div>` +
    (v ? `<div class="mp-sub pw-verdict pw-${v.grade}">${esc(v.text)}</div>` : '') +
    (p.note ? `<div class="mp-note">${esc(p.note)}</div>` : '') +
    `<div class="pp-acts"><button class="mp-danger pl-delete">Delete</button><button class="mp-plain pl-share">Share</button><button class="mp-plain pl-open">Open</button></div>`
  const pop = new maplibregl.Popup({ className: 'depth-popup', closeButton: false, closeOnClick: false, offset: 10, maxWidth: '240px' })
    .setLngLat([p.lon, p.lat])
    .setDOMContent(el)
    .addTo(map)
  closeOnTapOff(map, pop)
  pop.on('close', () => {
    if (open === pop) open = null
  })
  open = pop
  const name = el.querySelector('.mp-name') as HTMLInputElement
  // a fresh pin is still called Pin: the field starts empty, so typing names it; left empty it stays Pin
  name.addEventListener('input', () => usePlacesStore.getState().update(p.id, { name: name.value.trim() || DROPPED_NAME }))
  name.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') name.blur()
  })
  el.querySelectorAll<HTMLButtonElement>('.pin-swatch').forEach((b) =>
    b.addEventListener('click', () => {
      usePlacesStore.getState().update(p.id, { color: b.dataset.c })
      el.querySelectorAll('.pin-swatch').forEach((o) => {
        o.classList.toggle('on', o === b)
        o.setAttribute('aria-pressed', String(o === b))
      })
    }),
  )
  el.querySelector('.pl-delete')?.addEventListener('click', () => {
    const q = live()
    if (!isDroppedPin(q) && !confirm(`Delete ${q.name}?`)) return
    pop.remove()
    usePlacesStore.getState().remove(p.id)
  })
  const share = el.querySelector('.pl-share') as HTMLButtonElement
  share.addEventListener('click', () => {
    // inside the tap, nothing awaited first: iOS refuses a share that is not.
    // The name as it is now, typed a moment ago; one still Pin goes unnamed
    void shareSpot(live()).then((r) => {
      if (r !== 'copied' && r !== 'failed') return
      // no share sheet here: the message went to the clipboard, or did not, and the button says which
      share.textContent = r === 'copied' ? 'Copied' : 'Could not copy'
      window.setTimeout(() => (share.textContent = 'Share'), r === 'copied' ? 1200 : 2400)
    })
  })
  el.querySelector('.pl-open')?.addEventListener('click', () => {
    pop.remove()
    // a pin in another area: the app switches there, picks it and opens Pins on it
    const away = placeArea(live())
    if (away && away.id !== ACTIVE_AREA.id) return void switchArea(away.id, { center: [p.lon, p.lat], zoom: Math.max(map.getZoom(), 13) }, { kind: 'select', id: p.id, pins: true })
    // one of the two places a pin gets selected (the other is a Pins row)
    usePlacesStore.getState().select(p.id)
    useAppStore.getState().openSheet({ kind: 'pins' })
  })
}
