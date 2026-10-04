import { devlog } from '../devlog'
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
  if (then.kind === 'select') {
    if (!usePlacesStore.getState().places.some((p) => p.id === then.id)) return
    usePlacesStore.getState().select(then.id)
    if (then.pins) useAppStore.getState().openSheet({ kind: 'pins' })
    return
  }
  if (then.kind === 'spot') return arriveAt({ lon: then.lon, lat: then.lat, name: then.name }, then.link)
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
function arriveAt(s: Spot, link?: string): void {
  devlog('area', `arrived · ${coordWords(s)}${s.name ? ` · ${s.name}` : ''}`)
  addRecent(s)
  const shown = () => {
    if (link) noteLinkDone(link)
  }
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

function onHashChange(): void {
  const link = readLink(window.location.href)
  if (!link.at) return
  // as a fresh load of it would: a reload of this tab does not do it again
  noteLinkDone(linkMark(link.at, link.pin))
  devlog('area', `link in place · ${coordWords(link.at)}${link.pin ? ` · ${link.pin}` : ''}`)
  goToSpot({ lon: link.at.lon, lat: link.at.lat, name: link.pin, z: link.z })
}
