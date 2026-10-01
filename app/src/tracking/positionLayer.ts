import maplibregl from 'maplibre-gl'
import type { Map as MlMap } from 'maplibre-gl'
import { onEachMap } from '../map/mapController'
import { useAppStore } from '../state/appStore'
import { nearestInBounds } from '../config'
import { useMeasureStore } from '../measure/measureStore'
import { useRoutes } from '../routes/routeStore'
import { useScent } from '../weather/micro/scent'
import { useGpsStore, type Fix } from './gpsStore'
import { useCompass } from './compass'
import { useCheckForm } from '../ui/WindCheckCard'
import { useHeardForm } from '../ui/HeardCard'

/**
 * You on the map: a dot with an accuracy ring, a beam the way the phone
 * faces (its compass), and a course arrow when moving. Rides every fix;
 * with follow on, the camera eases to each fix (clamped to the region, so
 * a fix on the highway in shows the nearest edge of the chart rather than
 * a blank); heading up, the map turns with the compass. Tapping the dot
 * sharpens the wind where you stand.
 */

let marker: maplibregl.Marker | null = null
let ring: maplibregl.Marker | null = null
let onMap: MlMap | null = null
/** the map the layer belongs to, whether or not a fix has placed the dot yet */
let current: MlMap | null = null

function dotElement(): HTMLDivElement {
  const el = document.createElement('div')
  el.className = 'me'
  el.innerHTML = `
    <svg viewBox="0 0 96 96" width="96" height="96">
      <defs>
        <filter id="meglow" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="0" stdDeviation="3" flood-color="#3fc8ff" flood-opacity="0.7"/>
        </filter>
        <radialGradient id="mebeam" cx="48" cy="48" r="46" gradientUnits="userSpaceOnUse">
          <stop offset="0.15" stop-color="#3fc8ff" stop-opacity="0.75"/>
          <stop offset="1" stop-color="#3fc8ff" stop-opacity="0"/>
        </radialGradient>
      </defs>
      <path class="me-beam" d="M48 48 L31.5 5 A46 46 0 0 1 64.5 5 Z" fill="url(#mebeam)" opacity="0"/>
      <path class="me-arrow" d="M48 31 L55 46 L48 43 L41 46 Z" fill="#3fc8ff" stroke="#0f1a12" stroke-width="1.2" filter="url(#meglow)" opacity="0"/>
      <circle cx="48" cy="48" r="7" fill="#3fc8ff" stroke="#ffffff" stroke-width="2.5" filter="url(#meglow)"/>
      <circle class="me-hit" cx="48" cy="48" r="20" fill="transparent"/>
    </svg>`
  // the dot itself is the quickest way to say what the wind is doing here,
  // unless a tool has the tap: the ruler and the route card take it through
  // as a map tap, and a person being placed or moved goes right on the fix
  el.addEventListener('click', (e) => {
    const f = useGpsStore.getState().fix
    if (!f) return
    if (useMeasureStore.getState().active || useRoutes.getState().open) return
    // a check already being logged: the dot does not start another under it
    if (useCheckForm.getState().at) return e.stopPropagation()
    // a moose being placed: a tap on you is nothing, he is not where you stand
    if (useHeardForm.getState().open) return e.stopPropagation()
    // the Sharpen button waiting for a spot: you are the spot
    if (useCheckForm.getState().arming) {
      e.stopPropagation()
      return useCheckForm.getState().open(f.lon, f.lat, 'where you stand')
    }
    const scent = useScent.getState()
    if (scent.moving != null) {
      e.stopPropagation()
      return scent.move(scent.moving, f.lon, f.lat)
    }
    if (scent.adding) {
      e.stopPropagation()
      return scent.add(f.lon, f.lat)
    }
    e.stopPropagation()
    useCheckForm.getState().open(f.lon, f.lat, 'where you stand')
  })
  return el
}

function ringElement(): HTMLDivElement {
  const el = document.createElement('div')
  el.className = 'me-ring'
  return el
}

/** Metres per css pixel at a latitude and zoom (web mercator). */
function metresPerPx(lat: number, zoom: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom
}

function place(map: MlMap, fix: Fix) {
  if (!marker) {
    marker = new maplibregl.Marker({ element: dotElement(), rotationAlignment: 'map' })
    ring = new maplibregl.Marker({ element: ringElement(), rotationAlignment: 'map' })
  }
  // position first: a Marker added without one throws inside addTo
  marker!.setLngLat([fix.lon, fix.lat])
  ring!.setLngLat([fix.lon, fix.lat])
  if (onMap !== map) {
    ring!.addTo(map)
    marker!.addTo(map)
    onMap = map
  }
  // the arrow only when there is a course to show (moving, heading known)
  const arrow = marker!.getElement().querySelector('.me-arrow') as SVGElement | null
  const moving = fix.cog != null && fix.sogKn != null && fix.sogKn > 0.5
  if (arrow) {
    arrow.setAttribute('opacity', moving ? '1' : '0')
    arrow.setAttribute('transform', `rotate(${moving ? fix.cog! : 0} 48 48)`)
  }
  beam()
  sizeRing(map, fix)
}


/** The beam the way the phone faces (the marker turns with the map, so this is a true bearing). */
function beam() {
  const el = marker?.getElement().querySelector('.me-beam') as SVGElement | null
  if (!el) return
  const h = useCompass.getState().heading
  el.setAttribute('opacity', h == null ? '0' : '1')
  if (h != null) el.setAttribute('transform', `rotate(${h.toFixed(1)} 48 48)`)
}

function sizeRing(map: MlMap, fix: Fix) {
  if (!ring) return
  const px = Math.min(400, (fix.accuracy / metresPerPx(fix.lat, map.getZoom())) * 2)
  const el = ring.getElement()
  el.style.width = `${px}px`
  el.style.height = `${px}px`
  el.style.display = px < 12 ? 'none' : 'block'
}

let wired = false

export function initPositionLayer() {
  if (wired) return
  wired = true
  onEachMap((map) => {
    onMap = null
    current = map
    const fix = useGpsStore.getState().fix
    if (fix) place(map, fix)
    map.on('zoom', () => {
      const f = useGpsStore.getState().fix
      if (f && onMap === map) sizeRing(map, f)
    })
    map.once('remove', () => {
      marker?.remove()
      ring?.remove()
      marker = null
      ring = null
      onMap = null
      if (current === map) current = null
    })
  })
  // the compass: the beam follows it, and heading up the map turns with it
  let lastTurn = 0
  useCompass.subscribe((c) => {
    beam()
    const map = current
    if (!map || c.heading == null || !useGpsStore.getState().headingUp) return
    const now = performance.now()
    const d = Math.abs(((c.heading - map.getBearing() + 540) % 360) - 180)
    // a degree of wobble is not worth turning the whole map for
    if (d < 1.5 || now - lastTurn < 120) return
    lastTurn = now
    map.rotateTo(c.heading, { duration: 150, easing: (t) => t })
  })
  useGpsStore.subscribe((s, prev) => {
    if (s.headingUp !== prev.headingUp && !s.headingUp) current?.easeTo({ bearing: 0, duration: 400 })
    if (s.fix === prev.fix) return
    if (!s.fix) {
      // location switched off: the dot goes with it
      marker?.remove()
      ring?.remove()
      marker = null
      ring = null
      onMap = null
      return
    }
    const map = current
    if (!map) return
    place(map, s.fix)
    if (useAppStore.getState().follow) {
      const { center } = nearestInBounds(s.fix.lon, s.fix.lat)
      map.easeTo({ center, duration: 600 })
    }
  })
}
