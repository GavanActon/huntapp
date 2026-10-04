import maplibregl, { type Map as MlMap } from 'maplibre-gl'
import { ACTIVE_AREA, areaAt } from '../areas'
import { switchArea } from '../areas/switch'
import { SPOT_ZOOM } from '../areas/start'
import { devlog } from '../devlog'
import { haversineM } from '../measure/measureMath'
import { SHARE_BASE } from '../share/share'
import { coordWords, spotLink, type LonLat } from '../share/link'
import { useAppStore } from '../state/appStore'
import { usePlacesStore, type SavedPlace } from '../state/placesStore'
import { parsePlace } from './coords'
import { showInfoPopup, type InfoHead } from './infoPopup'
import { getMap, withMap } from './mapController'
import { showPlacePopup } from './placePopup'
import '../ui/areas.css'

/**
 * Going to a spot however it came: a link (areas/arrive.ts), a paste or a
 * typed position (Go to coordinates), a Recent row. A spot is only shown:
 * a ring where it is, its name under it (unless a place there has its own),
 * and the tap popup there, titled with the name (or the coordinates when it
 * has none). It becomes a pin
 * only when Pin is tapped, as any tapped point does (Gavan, 2026-10-04).
 */

export interface Spot extends LonLat {
  name?: string
  /** how close to look; SPOT_ZOOM or closer when not said */
  z?: number
}

/** A place this near a spot, under the same name, is the spot; under any
 *  name, its own label is where the ring's would be. */
const SAME_M = 25

/** A place of yours, or a preset, at the spot under its name: shown instead of the spot, never doubled. */
function samePlace(s: Spot): SavedPlace | null {
  if (!s.name) return null
  const name = s.name.trim().toLowerCase()
  return usePlacesStore.getState().places.find((p) => p.name.trim().toLowerCase() === name && haversineM(p.lon, p.lat, s.lon, s.lat) <= SAME_M) ?? null
}

/** A place of yours, or a preset, at the spot under any name: its own name
 *  is drawn just under its dot, where the ring's would go, and the two
 *  would print over each other. */
function placeAt(s: Spot): boolean {
  return usePlacesStore.getState().places.some((p) => haversineM(p.lon, p.lat, s.lon, s.lat) <= SAME_M)
}

/** The ring on the spot shown last, and the spot's popup; one of each at a time. */
let mark: maplibregl.Marker | null = null
let popup: maplibregl.Popup | null = null

function clearMark(): void {
  mark?.remove()
  mark = null
}

/** The spot's popup, titled with its name (or its coordinates). Its Pin
 *  takes away its own ring (`own`), never a later spot's. */
function spotPopup(map: MlMap, s: Spot, own: maplibregl.Marker | null): void {
  popup?.remove()
  const head: InfoHead = {
    title: s.name ?? coordWords(s),
    name: s.name,
    onPin: () => {
      if (mark === own) clearMark()
    },
  }
  const p = showInfoPopup(map, { lng: s.lon, lat: s.lat }, head)
  p.on('close', () => {
    if (popup === p) popup = null
  })
  popup = p
}

/** The ring and its name: a tap on it puts the spot's popup back up. */
function markAt(map: MlMap, s: Spot): maplibregl.Marker {
  const el = document.createElement('div')
  el.className = 'spot-mark'
  el.setAttribute('aria-label', s.name ?? coordWords(s))
  el.innerHTML = '<i></i>'
  // on a place the place's own name is there already (the popup's title says the spot's)
  if (s.name && !placeAt(s)) {
    const b = document.createElement('b')
    b.textContent = s.name
    el.appendChild(b)
  }
  // a marker must know where it is before it goes on the map
  const ring = new maplibregl.Marker({ element: el }).setLngLat([s.lon, s.lat])
  el.addEventListener('click', (e) => {
    // a tap on the ring is not a tap on the map (its popup is wanted, not another)
    e.stopPropagation()
    spotPopup(map, s, ring)
  })
  return ring.addTo(map)
}

/**
 * Show a spot on the map where it is, without keeping it: the ring, and its
 * popup up. A pin of yours already there under the same name is shown
 * instead, with its own popup; a preset there under it keeps its own dot
 * and gets the spot's popup. The spot before goes, popup and all: a link
 * that changes only the fragment would leave two titled popups up.
 */
export function markSpot(map: MlMap, s: Spot): void {
  popup?.remove()
  clearMark()
  const same = samePlace(s)
  if (same && same.savedAt > 0) return showPlacePopup(map, same)
  if (!same) mark = markAt(map, s)
  spotPopup(map, s, mark)
}

/** Go to coordinates holding a point the map cannot show (in no area): its own link, so the name goes with it. */
export function spotSheet(s: Spot, text?: string): void {
  useAppStore.getState().openSheet({ kind: 'coords', text: text ?? spotLink(SHARE_BASE, s) })
}

/**
 * Go to a spot. In this area the sheet closes, follow goes off, the map
 * eases there (SPOT_ZOOM or closer) and shows it. In another area the app
 * switches there, asking first as any switch does, and shows it on arrival
 * (areas/arrive.ts). In none, Go to coordinates holds it with `text` (the
 * spot's own link when not given). Each goes into Recent.
 */
export function goToSpot(s: Spot, text?: string): void {
  const area = areaAt(s.lon, s.lat)
  if (!area) {
    addRecent(s)
    return spotSheet(s, text)
  }
  if (area.id !== ACTIVE_AREA.id) {
    // Recent and the ring come with the arrival
    const zoom = s.z ?? Math.max(getMap()?.getZoom() ?? SPOT_ZOOM, SPOT_ZOOM)
    switchArea(area.id, { center: [s.lon, s.lat], zoom }, { kind: 'spot', lon: s.lon, lat: s.lat, name: s.name })
    return
  }
  addRecent(s)
  useAppStore.getState().closeSheet()
  useAppStore.getState().setFollow(false)
  withMap((m) => {
    m.easeTo({ center: [s.lon, s.lat], zoom: s.z ?? Math.max(m.getZoom(), SPOT_ZOOM) })
    markSpot(m, s)
  })
}

/**
 * ⋯ › Paste: the clipboard, read inside the tap (iOS puts its own Paste
 * bubble by the finger, Chrome asks the once). A whole place goes straight
 * there, as Go would. Anything else opens Go to coordinates holding it: an
 * area's link (Go to Lac Bailey is there), words with no position, a
 * number still short of one, an empty clipboard, no access to it. Settles
 * once the read has, so the menu stays up until then.
 */
export function pasteAndGo(): Promise<void> {
  let read: Promise<string>
  try {
    read = navigator.clipboard.readText()
  } catch {
    // no clipboard here (an old browser, a page off https)
    read = Promise.reject(new Error('no clipboard'))
  }
  return read.then(
    (text) => {
      const p = parsePlace(text)
      devlog('goto', `paste · ${p == null ? 'no position' : p.lon == null ? `area ${p.area}` : `${coordWords(p)}${p.complete ? '' : ' (short)'}${p.name ? ` · ${p.name}` : ''}`}`)
      if (p && p.lon != null && p.complete) return goToSpot({ lon: p.lon, lat: p.lat, name: p.name }, text)
      // an empty clipboard leaves the box as it was (what was being typed)
      useAppStore.getState().openSheet(text.trim() ? { kind: 'coords', text } : { kind: 'coords' })
    },
    () => {
      devlog('goto', 'paste · no clipboard access')
      useAppStore.getState().openSheet({ kind: 'coords' })
    },
  )
}

/** A place gone to, for Go to coordinates' Recent: newest first. */
export interface RecentPlace extends LonLat {
  name?: string
  /** the area it is in, when it is in one */
  area?: string
  /** when it was gone to, ms */
  at: number
}

const RECENT_KEY = 'huntapp-goto-recent'
const RECENT_MAX = 5

/** The last places gone to, newest first: from links, pastes and typing, kept on the phone. */
export function recentPlaces(): RecentPlace[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown
    if (!Array.isArray(raw)) return []
    return raw.filter((r): r is RecentPlace => r != null && Number.isFinite(r.lon) && Number.isFinite(r.lat) && Number.isFinite(r.at))
  } catch {
    return []
  }
}

/** Put a spot at the top of Recent. One within SAME_M of an older entry
 *  takes its place, keeping the older name when it brings none. */
export function addRecent(s: Spot): void {
  const old = recentPlaces()
  const near = old.find((r) => haversineM(r.lon, r.lat, s.lon, s.lat) <= SAME_M)
  const entry: RecentPlace = { lon: s.lon, lat: s.lat, at: Date.now() }
  const name = s.name ?? near?.name
  if (name) entry.name = name
  const area = areaAt(s.lon, s.lat)?.id
  if (area) entry.area = area
  const list = [entry, ...old.filter((r) => r !== near)].slice(0, RECENT_MAX)
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list))
  } catch {
    /* private mode or full: no Recent */
  }
}
