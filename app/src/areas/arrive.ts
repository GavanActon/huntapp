import { devlog } from '../devlog'
import { setExplore } from '../explore'
import { boxAround } from '../explore/box'
import { useExplore } from '../explore/store'
import { useHuntLog } from '../log/huntLog'
import { showLogPopup } from '../log/logLayer'
import { addRecent, goToSpot, markSpot, spotSheet, type Spot } from '../map/goto'
import { withMap } from '../map/mapController'
import { coordWords, readLink } from '../share/link'
import { useAppStore } from '../state/appStore'
import { usePlacesStore } from '../state/placesStore'
import { showCheckPopup } from '../weather/micro/checkLayer'
import { noteLinkDone, takeSwitchThen } from './handoff'
import { ACTIVE_AREA, areaAt } from './index'
import { linkMark } from './start'

/** The fragment's listener is on (the app's effects run twice in development). */
let listening = false

/**
 * Once, at startup: what the switch, or the link, that brought the app to
 * this area asked for next (areas/switch.ts, areas/index.ts). A place is
 * picked at once, so the strip is about it from the first frame; the rest
 * wait for the map: a spot is shown with its popup up, the outing opens
 * over the map and fits itself, a log entry or a check puts its popup up.
 * Nothing at all on an ordinary start.
 *
 * A link to a spot opened while the page is already up (an Android install
 * that had it open) changes only the fragment: the same, in place.
 */
export function initAreaArrival(): void {
  if (!listening) {
    listening = true
    window.addEventListener('hashchange', onHashChange)
  }
  const then = takeSwitchThen()
  // a look has done its part already: the map opened where it was meant to, follow held off
  if (!then || then.kind === 'look') return
  // the save was of this area, looked at from another: its maps sheet
  if (then.kind === 'offline') {
    useAppStore.getState().openSheet({ kind: 'offline' })
    return
  }
  if (then.kind === 'select') {
    if (!usePlacesStore.getState().places.some((p) => p.id === then.id)) return
    usePlacesStore.getState().select(then.id)
    if (then.pins) useAppStore.getState().openSheet({ kind: 'pin', id: then.id })
    return
  }
  if (then.kind === 'spot') return arriveAt({ lon: then.lon, lat: then.lat, name: then.name }, then.link, then.ask)
  withMap((m) => {
    if (then.kind === 'outing') {
      useAppStore.getState().setTopCard({ kind: 'outing', id: then.id })
    } else if (then.kind === 'entry') {
      const e = useHuntLog.getState().entries.find((x) => x.id === then.id)
      if (e) showLogPopup(m, e)
    } else {
      showCheckPopup(m, then.id)
    }
  })
}

/** A spot the app opened on: shown where it is (the map opened there), or,
 *  in no area, held in Go to coordinates. Into Recent either way. A link's
 *  is noted as shown in this tab once it is up, not before: a reload of a
 *  load that never got that far shows it then. */
function arriveAt(s: Spot, link?: string, ask?: 'sd' | 'hd'): void {
  devlog('area', `arrived · ${coordWords(s)}${s.name ? ` · ${s.name}` : ''}`)
  const shown = () => {
    if (link) noteLinkDone(link)
  }
  if (ask && askHere(s, ask)) return shown()
  addRecent(s)
  if (areaAt(s.lon, s.lat)?.id === ACTIVE_AREA.id) {
    withMap((m) => {
      markSpot(m, s)
      shown()
    })
  } else {
    spotSheet(s)
    shown()
  }
}

/** How close a spot to load or ask HD on opens: the 10 km box fills a phone's width (explore/box.ts START_KM). */
const ASK_ZOOM = 11.5

/** A link's spot with an ask (share/link.ts ask: the site's "Where do you
 *  hunt?"): the box goes round it with its load card up, or its HD ask, as
 *  Locations' Add a location does. Not over ground baked already, where the
 *  spot is shown as any link's is; HD over a loaded location is the ask.
 *  False when the spot is shown the ordinary way instead. */
function askHere(s: Spot, ask: 'sd' | 'hd'): boolean {
  const area = areaAt(s.lon, s.lat)
  if (area && !area.virtual && (ask === 'sd' || !area.loaded)) return false
  devlog('explore', `link asks ${ask} · ${coordWords(s)}`)
  setExplore(true)
  useAppStore.getState().closeSheet()
  useAppStore.getState().setFollow(false)
  withMap((m) => {
    m.easeTo({ center: [s.lon, s.lat], zoom: ASK_ZOOM, bearing: 0, duration: 0 })
    useExplore.getState().select({ box: boxAround(s.lon, s.lat), lon: s.lon, lat: s.lat, purpose: ask === 'hd' ? 'hd' : undefined })
  })
  return true
}

function onHashChange(): void {
  const link = readLink(window.location.href)
  if (!link.at) return
  // as a fresh load of it would: a reload of this tab does not do it again
  noteLinkDone(linkMark(link.at, link.pin))
  devlog('area', `link in place · ${coordWords(link.at)}${link.pin ? ` · ${link.pin}` : ''}`)
  if (link.ask && askHere({ lon: link.at.lon, lat: link.at.lat, name: link.pin }, link.ask)) return
  goToSpot({ lon: link.at.lon, lat: link.at.lat, name: link.pin, z: link.z })
}
