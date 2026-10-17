import type { Map as MlMap } from 'maplibre-gl'
import { create } from 'zustand'
import { devlog } from '../devlog'
import { onEachMap } from '../map/mapController'
import { useDownloads } from '../offline/downloads'
import { offlineReady } from '../offline/updates'
import { useAppStore } from '../state/appStore'
import { ACTIVE_AREA, otherAreaAt, type AreaDef } from './index'
import { switchArea } from './switch'

/**
 * Looking at another area's ground opens that area (Gavan, 2026-10-17:
 * "Switch by itself yes. If it's not downloaded. Say it's streaming.
 * Suggest downloading it."). Past the open area's box the map runs on the
 * national SD tiles (weather/micro/windTiles.ts), so another area's own
 * grids, its HD among them, come only with a switch: Pickle Lake looked at
 * from Blanchard River drew SD and had no lanes.
 *
 * When the view settles inside another area's box after a move by hand,
 * close enough in to mean that place, the app goes there on the same view
 * (a look: follow stays off, so the fix does not take the map back). The
 * people placed for the scent go over with it, and the walk being recorded
 * picks up again with the first fix there (tracking/trackStore.ts), so
 * neither holds it back (Gavan, 2026-10-17, given the chip every time with
 * location on: "Why do I need to change locations"). Not when it would
 * lose something or leave a blank map: then a chip offers it
 * (ui/AreaLook.tsx), and its tap is the switch, which asks.
 * Never on a fix or a move the app made itself: a fix in another box only
 * offers (ui/AreaOffer.tsx), the phone being glanced at and pocketed.
 */

/** Closer in than this, a view in another box means that place, not a pass over it. */
const MIN_ZOOM = 11
/** How long the view stays put before it counts as settled there. */
const SETTLE_MS = 1200
/** A touch on the map this recent makes the move one made by hand (a drag's glide ends well inside it). */
const HAND_MS = 10_000
/** Left for the run the switch loads: it came by a look (the streaming chip, ui/AreaLook.tsx). */
const CAME_KEY = 'huntapp-look-came'

interface AreaLookState {
  /** the area whose box the view is in, offered because going by itself would lose something */
  offer: AreaDef | null
  /** an offer waved off: not made again until the view leaves that box */
  waved: string | null
}

export const useAreaLook = create<AreaLookState>(() => ({ offer: null, waved: null }))

/** Why not by itself, or null when nothing is lost by going. */
function holdBack(target: AreaDef): string | null {
  if (useDownloads.getState().active) return 'a download running'
  const app = useAppStore.getState()
  if (app.sheets.length || app.topCard) return 'a sheet or card open'
  if (document.querySelector('.maplibregl-popup')) return 'a popup up'
  if (!app.online && !offlineReady(target.id)) return 'no signal, and its maps are not saved'
  return null
}

/** Go to the area on this view. False when the switch did not go (it asks, from the chip). */
export function goLook(m: MlMap, target: AreaDef): boolean {
  const c = m.getCenter()
  try {
    sessionStorage.setItem(CAME_KEY, target.id)
  } catch {
    /* private mode: no streaming chip there */
  }
  const went = switchArea(target.id, { center: [c.lng, c.lat], zoom: m.getZoom() }, { kind: 'look' }, true)
  if (!went) {
    try {
      sessionStorage.removeItem(CAME_KEY)
    } catch {
      /* nothing was left */
    }
  }
  return went
}

let came: boolean | null = null

/** This run came to its area by a look: taken from storage once, the same answer after (a second render asks again). */
export function takeLookCame(): boolean {
  if (came != null) return came
  try {
    const id = sessionStorage.getItem(CAME_KEY)
    sessionStorage.removeItem(CAME_KEY)
    came = id === ACTIVE_AREA.id
  } catch {
    came = false
  }
  return came
}

function inBox(r: AreaDef['region'], lon: number, lat: number): boolean {
  return lon >= r.west && lon <= r.east && lat >= r.south && lat <= r.north
}

onEachMap((m) => {
  let lastHand = 0
  let timer = 0
  const hand = () => {
    lastHand = Date.now()
  }
  const box = m.getCanvasContainer()
  for (const ev of ['pointerdown', 'touchstart', 'wheel'] as const) box.addEventListener(ev, hand, { passive: true })

  const settled = () => {
    timer = 0
    const c = m.getCenter()
    // in the open area's own box (boxes can overlap) the view is where it should be
    const target = m.getZoom() >= MIN_ZOOM && !inBox(ACTIVE_AREA.region, c.lng, c.lat) ? otherAreaAt(c.lng, c.lat) : null
    const st = useAreaLook.getState()
    if (st.offer && st.offer.id !== target?.id) useAreaLook.setState({ offer: null })
    if (!target) {
      if (st.waved) useAreaLook.setState({ waved: null })
      return
    }
    if (Date.now() - lastHand > HAND_MS) return
    const why = holdBack(target)
    if (why) {
      if (st.waved !== target.id && st.offer?.id !== target.id) {
        useAreaLook.setState({ offer: target })
        devlog('area', `in ${target.name}'s box · offered, not gone to: ${why}`)
      }
      return
    }
    devlog('area', `in ${target.name}'s box · going there`)
    goLook(m, target)
  }

  m.on('movestart', () => {
    if (timer) window.clearTimeout(timer)
    timer = 0
  })
  m.on('moveend', () => {
    if (timer) window.clearTimeout(timer)
    timer = window.setTimeout(settled, SETTLE_MS)
  })
})
