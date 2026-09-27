import maplibregl from 'maplibre-gl'
import type { Map as MlMap } from 'maplibre-gl'
import { onEachMap } from '../map/mapController'
import { useAppStore } from '../state/appStore'
import { nearestInBounds } from '../config'
import { useGpsStore, type Fix } from './gpsStore'

/**
 * You on the map: a dot with an accuracy ring, and a heading arrow when
 * the phone is moving. Rides every fix; with follow on, the camera eases
 * to each fix (clamped to the region, so a fix on the highway in shows the
 * nearest edge of the chart rather than a blank).
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
    <svg viewBox="0 0 40 40" width="40" height="40">
      <defs>
        <filter id="meglow" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="0" stdDeviation="3" flood-color="#3fc8ff" flood-opacity="0.7"/>
        </filter>
      </defs>
      <path class="me-arrow" d="M20 3 L27 18 L20 15 L13 18 Z" fill="#3fc8ff" stroke="#0f1a12" stroke-width="1.2" filter="url(#meglow)" opacity="0"/>
      <circle cx="20" cy="20" r="7" fill="#3fc8ff" stroke="#ffffff" stroke-width="2.5" filter="url(#meglow)"/>
    </svg>`
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
  if (arrow) arrow.setAttribute('opacity', moving ? '1' : '0')
  marker!.setRotation(moving ? fix.cog! : 0)
  sizeRing(map, fix)
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
  useGpsStore.subscribe((s, prev) => {
    if (s.fix === prev.fix || !s.fix) return
    const map = current
    if (!map) return
    place(map, s.fix)
    if (useAppStore.getState().follow) {
      const { center } = nearestInBounds(s.fix.lon, s.fix.lat)
      map.easeTo({ center, duration: 600 })
    }
  })
}
