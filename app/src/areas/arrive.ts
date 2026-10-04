import { useHuntLog } from '../log/huntLog'
import { showLogPopup } from '../log/logLayer'
import { withMap } from '../map/mapController'
import { DROPPED_NAME, showPlacePopup } from '../map/placePopup'
import { useAppStore } from '../state/appStore'
import { usePlacesStore } from '../state/placesStore'
import { showCheckPopup } from '../weather/micro/checkLayer'
import { takeSwitchThen } from './handoff'

/**
 * Once, at startup: what the switch that brought the app to this area
 * asked for next (areas/switch.ts). A place is picked at once, so the
 * strip is about it from the first frame; the rest wait for the map: the
 * pin goes down with its popup up to be named, the outing opens over the
 * map and fits itself, a log entry or a check puts its popup up. Nothing
 * at all on an ordinary start.
 */
export function initAreaArrival(): void {
  const then = takeSwitchThen()
  // a look has done its part already: the map opened on the point, follow held off
  if (!then || then.kind === 'look') return
  if (then.kind === 'select') {
    if (!usePlacesStore.getState().places.some((p) => p.id === then.id)) return
    usePlacesStore.getState().select(then.id)
    if (then.pins) useAppStore.getState().openSheet({ kind: 'pins' })
    return
  }
  withMap((m) => {
    if (then.kind === 'pin') {
      const p = usePlacesStore.getState().add({ name: DROPPED_NAME, lon: then.lon, lat: then.lat, kind: 'stand' })
      showPlacePopup(m, p)
    } else if (then.kind === 'outing') {
      useAppStore.getState().setTopCard({ kind: 'outing', id: then.id })
    } else if (then.kind === 'entry') {
      const e = useHuntLog.getState().entries.find((x) => x.id === then.id)
      if (e) showLogPopup(m, e)
    } else {
      showCheckPopup(m, then.id)
    }
  })
}
