import { Marker, type Map as MlMap } from 'maplibre-gl'
import { RELIEF } from '../config'
import { devlog } from '../devlog'
import { useAppStore } from '../state/appStore'
import { homePlace } from '../state/placesStore'
import { useGpsStore } from '../tracking/gpsStore'
import { campForecast } from '../weather/refresh'
import { onEachMap } from './mapController'
import { TERRAIN_SOURCE } from './mapStyle'

/**
 * The 3D button (Gavan, 2026-10-21, step 1 of the 3D plan: "ok go"): the
 * map tilts to PITCH_3D and the ground stands up on the area's own heights
 * (the baked DEM, a source of its own beside the shade's, so the two do not
 * share tiles mid-draw), everything on the map draped over it. Off, the
 * ground lies flat and the map comes back to looking straight down.
 *
 * How high the ground stands: the hunter's pick under the button's hold
 * (×1 ×2 ×3), else the area's: ×2 where the whole area rises less than
 * 300 m (Pickle Lake's 141 m reads flat at true height), ×1 where it rises
 * more (Lac Bailey's 370 m, the mountains). The wind streaks follow the tilt
 * in windFlow.ts; the scent's puffs are placed through the map already.
 */

/** The tilt: 50°, not the mockup's 60, the far ground's tiles a steady share less to draw on a phone
 *  (measured 2026-10-21, a 3D pan at a phone's speed: 14-25 frames a second at 50 against 10-13 at 60) */
export const PITCH_3D = 50
/** True height past this rise from the area's lowest to its highest ground. */
const TRUE_HEIGHT_FROM_M = 300

export const defaultTerrainScale = (): number => (RELIEF[1] - RELIEF[0] < TRUE_HEIGHT_FROM_M ? 2 : 1)
export const terrainScale = (): number => useAppStore.getState().terrainScale ?? defaultTerrainScale()

/** Low sky, a haze at the horizon: the far tiles fade instead of piling up. */
const SKY = {
  'sky-color': '#24323a',
  'horizon-color': '#56666b',
  'fog-color': '#3e4c50',
  'sky-horizon-blend': 0.6,
  'horizon-fog-blend': 0.55,
  'fog-ground-blend': 0.55,
  'atmosphere-blend': 0.4,
}

function apply(map: MlMap, on: boolean, tilt: boolean) {
  if (!map.isStyleLoaded()) return
  const has = !!map.getSource(TERRAIN_SOURCE)
  if (on) {
    if (has) map.setTerrain({ source: TERRAIN_SOURCE, exaggeration: terrainScale() })
    else devlog('3d', 'no heights here: tilted, ground flat')
    try {
      map.setSky(SKY)
    } catch {
      // an older style spec: no sky, the tilt still works
    }
    // From my sit looks along the ground: room to tilt past the button's 60
    map.setMaxPitch(85)
    if (tilt && map.getPitch() < 5) map.easeTo({ pitch: PITCH_3D, duration: 700 })
  } else {
    if (map.getTerrain()) map.setTerrain(null)
    // flat again: looking straight down, north up as before (From my sit turned it), unless the map follows the phone's heading
    if (tilt && (map.getPitch() > 0 || map.getBearing() !== 0)) map.easeTo({ pitch: 0, ...(useGpsStore.getState().headingUp ? {} : { bearing: 0 }), duration: 500 })
    map.setMaxPitch(60)
  }
}

/**
 * The camera stood on the ground it looks at. MapLibre places the camera by
 * the view's middle and that middle's height, and between some zooms (15.6
 * to 15.9 and 16.5 at Pickle Lake, its DEM's tiles to z16) its own lookup of
 * that height comes back 0: with the ground stood up ×2 (680 m there) the
 * camera, ~600 m up, was under it and the map went black. The height is read
 * again zoom by zoom from the view's own (MapLibre's own climb gave 0 there
 * too), after every move and as the DEM's tiles land, and put back when off.
 */
function keepOnGround(map: MlMap) {
  // never mid-move: setting the height stops the camera, and it cut 3D's own tilt short (47° of 50)
  if (!map.getTerrain() || map.isMoving()) return
  const terrain = (map as unknown as { terrain?: { getElevationForLngLatZoom: (ll: unknown, z: number) => number } }).terrain
  if (!terrain) return
  // MapLibre's own climb (getElevationForLngLat) came back 0 there too: asked zoom by zoom from the
  // view's own, at most the DEM's deepest, down to the first with the ground in it
  const top = Math.min(Math.floor(map.getZoom()), (map.getSource(TERRAIN_SOURCE) as { maxzoom?: number } | undefined)?.maxzoom ?? 16)
  const c = map.getCenter()
  let e = 0
  for (let z = top; z >= Math.max(0, top - 4) && !(e > 0); z--) e = terrain.getElevationForLngLatZoom(c, z)
  // only when MapLibre has lost it (0, or far under): set at every metre's difference it moved the
  // camera as each DEM tile landed, and the wind's streaks read each move as a pan
  if (Number.isFinite(e) && e > 0 && map.getCenterElevation() < e * 0.5) map.setCenterElevation(e)
}

/**
 * A marker on 3D ground asks MapLibre whether a hill hides it every 100 ms,
 * by reading a pixel of the depth buffer back from the GPU (Marker
 * _updateOpacity, depthAtPoint), a stall each: the scent's one person marker
 * was a second of read-backs in a two-second 3D pan at a phone's speed
 * (profiled 2026-10-21). Ours stand on the ground in view; on terrain they
 * are drawn whole, no read. Flat, MapLibre's own runs as before.
 */
function markersSkipDepth() {
  const proto = Marker.prototype as unknown as { _updateOpacity?: (this: MarkerInternals, force?: boolean) => void; __gwPatched?: boolean }
  const orig = proto._updateOpacity
  if (typeof orig !== 'function' || proto.__gwPatched) return
  proto.__gwPatched = true
  proto._updateOpacity = function (this: MarkerInternals, force?: boolean) {
    if (!this._map?.terrain) return orig.call(this, force)
    if (this._element.style.opacity !== '') this._element.style.opacity = ''
    this._element.classList.remove('maplibregl-marker-covered')
  }
}
interface MarkerInternals {
  _map?: { terrain?: unknown }
  _element: HTMLElement
}

let wired = false

export function initTerrain3d(): void {
  if (wired) return
  wired = true
  markersSkipDepth()
  onEachMap((map) => {
    // a phone that closed in 3D opens in it, tilted as it was left
    apply(map, useAppStore.getState().view3d, true)
    // a style put back (a reload of the area's layers) loses the terrain: put it back too
    map.on('style.load', () => apply(map, useAppStore.getState().view3d, false))
    map.on('moveend', () => keepOnGround(map))
    map.on('sourcedata', (e: { sourceId?: string; isSourceLoaded?: boolean }) => {
      if (e.sourceId === TERRAIN_SOURCE && e.isSourceLoaded) keepOnGround(map)
    })
  })
  useAppStore.subscribe((s, prev) => {
    if (s.view3d === prev.view3d && s.terrainScale === prev.terrainScale) return
    onEachMapNow((map) => apply(map, s.view3d, s.view3d !== prev.view3d))
  })
}

/** The live map, if there is one, now (not later maps). */
let current: MlMap | null = null
onEachMap((m) => {
  current = m
})
function onEachMapNow(fn: (m: MlMap) => void) {
  if (current) fn(current)
}

/** From my sit's view: its middle this far downwind, this low a tilt, this close (a few hundred metres across). */
const SIT_AHEAD_M = 250
const SIT_PITCH = 75
const SIT_ZOOM = 15.5

/** Metres to degrees, near enough over a few hundred metres. */
const metresToLngLat = (lon: number, lat: number, eastM: number, northM: number): [number, number] => [lon + eastM / (111_320 * Math.cos((lat * Math.PI) / 180)), lat + northM / 110_574]

/**
 * From my sit: the camera stood just above where you are (the fix, else the
 * camp), looking the way the wind blows at the planning time, so the ground
 * your scent travels over is ahead of you. 3D comes on with it.
 */
export function fromMySit(): void {
  const map = current
  if (!map) return
  const fix = useGpsStore.getState().fix
  const home = homePlace()
  const at: [number, number] = fix ? [fix.lon, fix.lat] : [home.lon, home.lat]
  // the wind's way at the planning hour (the camp's forecast), else north
  const f = campForecast()
  const when = useAppStore.getState().planTimeMs ?? Date.now()
  let toward = 0
  if (f) {
    let best = 0
    let bestD = Infinity
    f.hourly.time.forEach((t, i) => {
      const d = Math.abs(Date.parse(t) - when)
      if (d < bestD) {
        bestD = d
        best = i
      }
    })
    toward = ((f.hourly.windDir[best] ?? 180) + 180) % 360
  }
  const rad = (toward * Math.PI) / 180
  // the view's middle a few hundred metres downwind, the map turned to face it and tilted low: the camera
  // stands just behind the sit, the sit at the foot of the screen and the ground the scent crosses ahead.
  // Placed by its middle, not by a camera height: a height read before the ground's tiles are in would put
  // the camera under the hill
  const ahead = metresToLngLat(at[0], at[1], Math.sin(rad) * SIT_AHEAD_M, Math.cos(rad) * SIT_AHEAD_M)
  if (!useAppStore.getState().view3d) useAppStore.getState().setView3d(true)
  map.easeTo({ center: ahead, bearing: toward, pitch: SIT_PITCH, zoom: SIT_ZOOM, duration: 1200 })
  devlog('3d', `from my sit · looking toward ${Math.round(toward)}°`)
}
