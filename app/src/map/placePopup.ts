import maplibregl, { type Map as MlMap } from 'maplibre-gl'
import { ACTIVE_AREA } from '../areas'
import { switchArea } from '../areas/switch'
import { shareSpot } from '../share/share'
import { SHEET_HALF_PCT, useAppStore } from '../state/appStore'
import { windVerdict } from '../spots/standWinds'
import { placeColour } from '../state/pinColours'
import { latestNote, placeArea, usePlacesStore, type SavedPlace } from '../state/placesStore'
import { agoLabel } from '../time'
import { getMap } from './mapController'
import { closeOnTapOff } from './tapPopup'
import '../ui/minipop.css'

/**
 * A pin of your own, tapped: its name and colour, how a stand's good winds
 * read for the next sit, its latest note and how old it is, and a field to
 * write the next one, with Delete, Share (the pin, its name and a link to
 * it: share/share.ts) and Open for its sheet. The camp and the lakes are
 * presets and open Dig in instead (MapView).
 *
 * A pin just added skips this and opens its sheet (openPinSheet): the name,
 * the colour and the notes all at once (Gavan, 2026-10-14).
 *
 * A pin never named and with no note goes at once; one you have named or
 * written on asks first.
 */

/** Dropped from the tap popup and never named: what "Clear pins" in Places takes away. */
export const DROPPED_NAME = 'Pin'
export const isDroppedPin = (p: SavedPlace) => p.savedAt > 0 && p.name === DROPPED_NAME && !p.note && !p.notes?.length

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)

let open: maplibregl.Popup | null = null

export function showPlacePopup(map: MlMap, p: SavedPlace) {
  open?.remove()
  const el = document.createElement('div')
  // the pin as it is now: a note written while the popup is up shows in it
  const live = () => usePlacesStore.getState().places.find((q) => q.id === p.id) ?? p
  // a stand with its good winds set: how the next sit's ground wind reads against them
  const v = windVerdict(p)
  el.innerHTML =
    `<div class="mp-head"><i style="background:${placeColour(p)}"></i><b>${esc(p.name)}</b></div>` +
    (v ? `<div class="mp-sub pw-verdict pw-${v.grade}">${esc(v.text)}</div>` : '') +
    '<div class="mp-notes"></div>' +
    '<input class="mp-addnote" placeholder="Add a note" aria-label="Add a note" maxlength="500" autocomplete="off" enterkeyhint="done" />' +
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

  const notesEl = el.querySelector('.mp-notes') as HTMLElement
  /** The latest note, its age, and the older ones as a way into the sheet. */
  const paint = () => {
    const q = live()
    const n = latestNote(q)
    const older = (q.notes?.length ?? 0) - 1
    notesEl.innerHTML = n
      ? `<div class="mp-note">${esc(n.text)}</div><div class="mp-sub">${esc(agoLabel(Date.now() - n.at))}${older > 0 ? ` · <button class="linklike pl-earlier">${older} earlier ›</button>` : ''}</div>`
      : q.note
        ? `<div class="mp-note">${esc(q.note)}</div>`
        : ''
    notesEl.querySelector('.pl-earlier')?.addEventListener('click', openIt)
  }

  // the note saves as it is typed, stamped at its first letter, so a tap off mid-sentence loses nothing
  const add = el.querySelector('.mp-addnote') as HTMLInputElement
  let draftAt: number | null = null
  add.addEventListener('input', () => {
    const st = usePlacesStore.getState()
    const text = add.value.trim()
    if (draftAt == null) {
      if (text) draftAt = st.addNote(p.id, text)
    } else if (text) st.editNote(p.id, draftAt, text)
    else {
      st.removeNote(p.id, draftAt)
      draftAt = null
    }
  })
  const finish = () => {
    if (draftAt == null) return
    draftAt = null
    add.value = ''
    paint()
    // a longer latest note grows the popup upward
    clearStrip(map, pop)
  }
  add.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') add.blur()
  })
  add.addEventListener('blur', finish)

  el.querySelector('.pl-delete')?.addEventListener('click', () => {
    const q = live()
    if (!isDroppedPin(q) && !confirm(`Delete ${q.name}?`)) return
    pop.remove()
    usePlacesStore.getState().remove(p.id)
  })
  const share = el.querySelector('.pl-share') as HTMLButtonElement
  share.addEventListener('click', () => {
    // inside the tap, nothing awaited first: iOS refuses a share that is not.
    // One still Pin goes unnamed
    void shareSpot(live()).then((r) => {
      if (r !== 'copied' && r !== 'failed') return
      // no share sheet here: the message went to the clipboard, or did not, and the button says which
      share.textContent = r === 'copied' ? 'Copied' : 'Could not copy'
      window.setTimeout(() => (share.textContent = 'Share'), r === 'copied' ? 1200 : 2400)
    })
  })
  function openIt() {
    pop.remove()
    // a pin in another area: the app switches there, picks it and opens its sheet
    const away = placeArea(live())
    if (away && away.id !== ACTIVE_AREA.id) return void switchArea(away.id, { center: [p.lon, p.lat], zoom: Math.max(map.getZoom(), 13) }, { kind: 'select', id: p.id, pins: true })
    // one of the two places a pin gets selected (the other is a Pins row)
    usePlacesStore.getState().select(p.id)
    openPinSheet(p.id)
  }
  el.querySelector('.pl-open')?.addEventListener('click', openIt)
  paint()
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
