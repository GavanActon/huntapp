import type { Map as MlMap } from 'maplibre-gl'
import { create } from 'zustand'
import { devlog } from '../devlog'
import { onEachMap } from '../map/mapController'
import { useDownloads } from '../offline/downloads'
import { useAppStore } from '../state/appStore'
import { ACTIVE_AREA, otherAreaAt, type AreaDef } from './index'
import { switchArea } from './switch'

/**
 * The map goes from one area to the next by itself (Gavan, 2026-10-17:
 * "it should all be fluid. I move from one area to the next. It knows.
 * Just switches. No open pickle. Just switch."). Past the open area's box
 * the map runs on the national SD tiles (weather/micro/windTiles.ts), so
 * another area's own grids, its HD among them, come only with a switch:
 * Pickle Lake looked at from Blanchard River drew SD and had no lanes.
 *
 * When the view settles inside another area's box, close enough in to mean
 * that place, the app goes there on the same view: panned there by hand, or
 * carried there following the fix. Nothing is asked. The people placed for
 * the scent go over with it, the walk being recorded picks up again with
 * the first fix there (tracking/trackStore.ts), and a sheet or popup about
 * the old ground simply closes. A download running is the one thing a
 * reload would cut off, so the switch waits for it to finish and goes then,
 * with a word that it will (ui/AreaLook.tsx). Arriving, the strip's loading
 * line says what streams and offers the save, as for any first open.
 */

/** Closer in than this, a view in another box means that place, not a pass over it. */
const MIN_ZOOM = 11
/** How long the view stays put before it counts as settled there. */
const SETTLE_MS = 1200

/** The area the view is in, waiting on a download before the switch goes. */
export const useAreaLook = create<{ waiting: AreaDef | null }>(() => ({ waiting: null }))

/** Go to the area on this view, carrying what is placed: following, follow
 *  carries on there; a look keeps follow off, so the fix does not take the
 *  map back. False when it did not go. */
function go(m: MlMap, target: AreaDef): boolean {
  const c = m.getCenter()
  const following = useAppStore.getState().follow
  return switchArea(target.id, { center: [c.lng, c.lat], zoom: m.getZoom() }, following ? undefined : { kind: 'look' }, true)
}

function inBox(r: AreaDef['region'], lon: number, lat: number): boolean {
  return lon >= r.west && lon <= r.east && lat >= r.south && lat <= r.north
}

onEachMap((m) => {
  let timer = 0

  const settled = () => {
    timer = 0
    const c = m.getCenter()
    // in the open area's own box (boxes can overlap) the view is where it should be
    const target = m.getZoom() >= MIN_ZOOM && !inBox(ACTIVE_AREA.region, c.lng, c.lat) ? otherAreaAt(c.lng, c.lat) : null
    const waiting = useAreaLook.getState().waiting
    if (!target) {
      if (waiting) useAreaLook.setState({ waiting: null })
      return
    }
    if (useDownloads.getState().active) {
      if (waiting?.id !== target.id) {
        useAreaLook.setState({ waiting: target })
        devlog('area', `in ${target.name}'s box · going there when the download is done`)
      }
      return
    }
    if (waiting) useAreaLook.setState({ waiting: null })
    devlog('area', `in ${target.name}'s box · going there${useAppStore.getState().follow ? ' (following)' : ''}`)
    go(m, target)
  }

  m.on('movestart', () => {
    if (timer) window.clearTimeout(timer)
    timer = 0
  })
  m.on('moveend', () => {
    if (timer) window.clearTimeout(timer)
    timer = window.setTimeout(settled, SETTLE_MS)
  })
  // the download it waited on is done: go, if the view is still there
  useDownloads.subscribe((s, prev) => {
    if (prev.active && !s.active && useAreaLook.getState().waiting) settled()
  })
})
