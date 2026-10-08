import maplibregl, { type Map as MlMap } from 'maplibre-gl'
import { inRegion } from '../config'
import { spotGrade, spotGradeWords } from '../spots/grades'
import { explainPoint } from '../spots/scoring'
import { TARGET_NAMES } from '../spots/types'
import { useAppStore } from '../state/appStore'
import { usePlacesStore } from '../state/placesStore'
import { useSpotsStore } from '../state/spotsStore'
import { useViews } from '../state/viewsStore'
import { useGpsStore, type Fix } from '../tracking/gpsStore'
import { useHeardForm } from '../ui/HeardCard'
import { useCheckForm } from '../ui/WindCheckCard'
import { compass } from '../weather/openMeteo'
import { metresBetween } from '../weather/micro/windChecks'
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

/** A tap this close to your fix is where you stand: Wind there is a check felt, not seen. */
const NEAR_M = 60

/** Out there now: location on and a fix inside the area, good to a few tens of metres. */
function outFix(): Fix | null {
  const g = useGpsStore.getState()
  const f = g.fix
  return g.locating && f && inRegion(f.lon, f.lat) && (f.sigma ?? f.accuracy) <= 60 ? f : null
}

/** '420 m NE' | '1.2 km NE': a spot from you. */
function fromYou(f: Fix, lon: number, lat: number): string {
  const d = metresBetween(f.lon, f.lat, lon, lat)
  const brg = (Math.atan2((lon - f.lon) * Math.cos((f.lat * Math.PI) / 180), lat - f.lat) * 180) / Math.PI
  return `${d >= 1000 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d / 10) * 10} m`} ${compass((brg + 360) % 360)}`
}

/**
 * The info popup at a point, as a tap on the map puts it up (MapView): the
 * weather there, the score while the heat is on, then the actions. With a
 * head, a title row over it says which spot it is.
 *
 * The actions are the ones that fit (Gavan, 2026-10-08: "more intelligent"):
 *   - Scent, hunting only;
 *   - Game (heard or seen), hunting and out there: location on, a fix in the area;
 *   - Wind: a check at the spot, seen from afar when it is away from you
 *     (the treetops over there, out glassing), felt when it is where you stand;
 *   - Pin.
 * Dig in rides on the score row, so it is there only while the heat is.
 */
export function showInfoPopup(m: MlMap, lngLat: { lng: number; lat: number }, head?: InfoHead): maplibregl.Popup {
  const { lng, lat } = lngLat
  const el = document.createElement('div')
  const sp = useSpotsStore.getState()
  // the score only while the heat map is on: with it off the tap is about the weather; Dig in has the whole case either way
  const why = sp.heat && sp.conditions ? explainPoint(sp.target, lng, lat, sp.conditions, sp.weights) : null
  const esc = (t: string) => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] ?? c)
  // the score row is Dig in's way in: the reasons behind the number are one tap deeper
  const gameHtml = why
    ? `<button class="pp-game pp-digin" type="button"><b class="pp-score pp-${spotGrade(why.score)}">${Math.round(why.score * 100)}</b><span>${esc(TARGET_NAMES[sp.target])} · ${esc(spotGradeWords(sp.target, why.score))}</span><i>Dig in ›</i></button>`
    : ''
  const titleHtml = head ? `<div class="pp-title">${esc(head.title)}</div>` : ''
  const sitting = useScent.getState().people.length > 0
  const hunting = useViews.getState().mode === 'hunt'
  const out = outFix()
  const acts = [
    hunting ? `<button class="pp-scent">${sitting ? '+ Person' : 'Scent'}</button>` : '',
    hunting && out ? '<button class="pp-heard">Game</button>' : '',
    '<button class="pp-wind">Wind</button>',
    '<button class="pp-save">Pin</button>',
  ].join('')
  el.innerHTML = `${titleHtml}<div class="depth-popup-wx"></div>${gameHtml}<div class="pp-acts">${acts}</div>`
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
  // game heard or seen, placed here rather than from where you stand
  el.querySelector('.pp-heard')?.addEventListener('click', () => {
    popup.remove()
    useHeardForm.getState().show({ lon: lng, lat })
  })
  // the wind at this spot: where you stand, felt; away from you, seen (the
  // treetops there); with no fix the card asks which
  el.querySelector('.pp-wind')?.addEventListener('click', () => {
    popup.remove()
    const f = outFix()
    if (f && metresBetween(f.lon, f.lat, lng, lat) <= NEAR_M) useCheckForm.getState().open(f.lon, f.lat, 'where you stand')
    else useCheckForm.getState().open(lng, lat, f ? fromYou(f, lng, lat) : 'there', { from: f ? { lon: f.lon, lat: f.lat } : null })
  })
  return popup
}
