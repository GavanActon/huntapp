import { devlog } from '../devlog'
import { useDownloads } from '../offline/downloads'
import { offlineReady } from '../offline/updates'
import { useGpsStore } from '../tracking/gpsStore'
import { flushTrackSave } from '../tracking/trackStore'
import { useScent } from '../weather/micro/scent'
import { cachedPointForecast } from '../weather/openMeteo'
import { forgetLinkDone, leaveHandoff, type SwitchThen } from './handoff'
import { ACTIVE_AREA, areaById, areaHref, saveView, setActiveArea, type AreaDef } from './index'

export type { SwitchThen } from './handoff'

/**
 * Going to another area (docs/AREAS.md): the new area and the view to open
 * on are saved and the page loads the new area's address, so every module,
 * cache and map source starts clean there. A place, a pin, a log entry, an
 * outing or a typed coordinate in another area's box comes here, from a
 * tap. A GPS fix in one only offers it (ui/AreaOffer.tsx): the phone is
 * glanced at and pocketed, and a reload nobody asked for would lose the
 * screen it was left on. Nothing switches, or asks to, while the app
 * starts: a link opens on its area there and then (areas/start.ts).
 *
 * What is meant to happen on arrival (show the spot, pick the place, open
 * the outing) is left with areas/handoff.ts and done once by
 * areas/arrive.ts.
 */

function inArea(a: AreaDef, lon: number, lat: number): boolean {
  const r = a.region
  return lon >= r.west && lon <= r.east && lat >= r.south && lat <= r.north
}

/** What an area lacks with no signal, in words, or null when it has it
 *  all: its maps, and a forecast for its home that still runs to now (the
 *  ground wind and the scent cone are worked out from it). */
function offlineGaps(area: AreaDef): string | null {
  const maps = offlineReady(area.id)
  const home = area.presets[0]
  // Explore bakes nothing and has no home of its own: nothing to be short of
  if (!home) return null
  const f = cachedPointForecast(home.lon, home.lat)
  const last = f?.hourly.time[f.hourly.time.length - 1]
  const wx = last != null && Date.parse(last) > Date.now()
  if (maps && wx) return null
  if (wx) return `${area.name}'s maps are not on this phone: its map stays blank until there is signal`
  if (maps) return `no forecast for ${area.name} is on this phone: no ground wind or scent cone there until there is signal`
  return `neither ${area.name}'s maps nor a forecast for it are on this phone: its map stays blank, with no ground wind or scent cone, until there is signal`
}

/** The new area is loading: a second tap does nothing. */
let switching = false

/**
 * Switch the app to another area, opening on `view` (north up) and doing
 * `then` once it is there. Only ever from a tap, and it asks first: when a
 * download is running (the switch stops it), when people are placed for
 * the scent (a setup placed by hand is never saved; the live cone comes
 * back with the first fix), and when there is no signal and the area's
 * maps or its forecast are not on the phone. False when it does not go.
 */
export function switchArea(id: string, view?: { center: [number, number]; zoom: number }, then?: SwitchThen): boolean {
  const area = areaById(id)
  if (switching || !area || area.id === ACTIVE_AREA.id) return false
  // the reload drops the run: a file still coming is not marked saved (offline/fileStore), the ones done stay
  if (useDownloads.getState().active && !confirm(`Maps are downloading. Going to ${area.name} stops the download: the files it has finished stay on the phone, the rest can be downloaded later. Go anyway?`)) return false
  if (useScent.getState().people.some((p) => !p.live) && !confirm(`Going to ${area.name} reloads the app, and the people placed for the scent go with it. Go anyway?`)) return false
  const gaps = navigator.onLine ? null : offlineGaps(area)
  if (gaps && !confirm(`No signal, and ${gaps}. Go anyway?`)) return false
  switching = true
  flushTrackSave()
  if (view) saveView({ center: view.center, zoom: view.zoom, bearing: 0 }, area.id)
  // location on: follow comes back with it only when the switch is to where
  // you are. Going to look at something (a pin, a log entry, a coordinate)
  // every fix would drag the map off it, to the edge of the new box when
  // the fix is not in it
  const { locating, fix } = useGpsStore.getState()
  leaveHandoff(then, locating && (then != null || !(fix && inArea(area, fix.lon, fix.lat))))
  const where = view ? ` · ${view.center[1].toFixed(5)},${view.center[0].toFixed(5)} z${view.zoom.toFixed(1)}` : ''
  devlog('area', `switch ${ACTIVE_AREA.id} → ${area.id}${where}${then ? ` · then ${then.kind}` : ''}`)
  // the address names the area (areas/index.ts areaHref): the reloads that
  // follow (a download's, an update's) stay there
  setActiveArea(area.id)
  // the link this tab showed is done with: opened again later, it is a fresh tap
  forgetLinkDone()
  window.location.replace(areaHref(area.id))
  return true
}
