import maplibregl, { type Map as MlMap } from 'maplibre-gl'
import { spotGrade, spotGradeWords } from '../spots/grades'
import { explainPoint } from '../spots/scoring'
import { TARGET_NAMES } from '../spots/types'
import { useAppStore } from '../state/appStore'
import { usePlacesStore } from '../state/placesStore'
import { useSpotsStore } from '../state/spotsStore'
import { useHeardForm } from '../ui/HeardCard'
import { useScent } from '../weather/micro/scent'
import { DROPPED_NAME, showPlacePopup } from './placePopup'
import { closeOnTapOff } from './tapPopup'
import { attachTapWeather } from './tapWeather'

/** A spot the popup is about (a link's, a Go to's): its title row, and the
 *  name Pin keeps it under. */
export interface InfoHead {
  /** the spot's name, or its coordinates when it has none */
  title: string
  /** what Pin names the pin; Pin as ever without one */
  name?: string
  /** after Pin has kept it (map/goto.ts takes its mark away) */
  onPin?: () => void
}

/**
 * The info popup at a point, as a tap on the map puts it up (MapView): the
 * weather there, the score while the heat is on, then Scent, Heard, Pin and
 * Dig in. Everything else is the sheet's. With a head, a title row over it
 * says which spot it is; without one the popup is as it always was.
 */
export function showInfoPopup(m: MlMap, lngLat: { lng: number; lat: number }, head?: InfoHead): maplibregl.Popup {
  const { lng, lat } = lngLat
  const el = document.createElement('div')
  const sp = useSpotsStore.getState()
  // the score only while the heat map is on: with it off the tap is about the weather; Dig in has the whole case either way
  const why = sp.heat && sp.conditions ? explainPoint(sp.target, lng, lat, sp.conditions, sp.weights) : null
  const esc = (t: string) => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] ?? c)
  const gameHtml = why
    ? `<div class="pp-game"><b class="pp-score pp-${spotGrade(why.score)}">${Math.round(why.score * 100)}</b><span>${esc(TARGET_NAMES[sp.target])} · ${esc(spotGradeWords(sp.target, why.score))}</span></div>`
    : ''
  const titleHtml = head ? `<div class="pp-title">${esc(head.title)}</div>` : ''
  const sitting = useScent.getState().people.length > 0
  el.innerHTML = `${titleHtml}<div class="depth-popup-wx"></div>${gameHtml}<div class="pp-acts"><button class="pp-scent">${sitting ? '+ Person' : 'Scent'}</button><button class="pp-heard">Heard</button><button class="pp-save">Pin</button><button class="pp-digin">Dig in ›</button></div>`
  const popup = new maplibregl.Popup({ className: 'depth-popup', closeButton: false, closeOnClick: false, offset: 8, maxWidth: '260px' })
    .setLngLat([lng, lat])
    .setDOMContent(el)
    .addTo(m)
  // no ×: tap again, anywhere off it, and it goes
  closeOnTapOff(m, popup)
  // wind, temperature and sky at the planning time
  const stopWx = attachTapWeather(el.querySelector('.depth-popup-wx') as HTMLElement, lng, lat)
  popup.on('close', stopWx)
  // with people already sitting, Scent adds the next one here
  el.querySelector('.pp-scent')?.addEventListener('click', () => {
    const sc = useScent.getState()
    if (sc.people.length) sc.add(lng, lat)
    else sc.show(lng, lat)
    popup.remove()
  })
  // a pin: its own popup takes over, the name and colour right there
  el.querySelector('.pp-save')?.addEventListener('click', () => {
    const sp = usePlacesStore.getState().add({ name: head?.name ?? DROPPED_NAME, lon: lng, lat, kind: 'stand' })
    popup.remove()
    head?.onPin?.()
    showPlacePopup(m, sp)
  })
  el.querySelector('.pp-digin')?.addEventListener('click', () => {
    popup.remove()
    useAppStore.getState().openSheet({ kind: 'digin', lon: lng, lat })
  })
  // a moose heard, placed here rather than from where you stand
  el.querySelector('.pp-heard')?.addEventListener('click', () => {
    popup.remove()
    useHeardForm.getState().show({ lon: lng, lat })
  })
  return popup
}
