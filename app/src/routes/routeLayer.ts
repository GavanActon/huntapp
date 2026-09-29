import maplibregl, { type GeoJSONSource, type Map as MlMap } from 'maplibre-gl'
import type { Feature, FeatureCollection } from 'geojson'
import { getMap, onEachMap, withMap } from '../map/mapController'
import { closeOnTapOff } from '../map/tapPopup'
import { formatDistance } from '../measure/measureMath'
import { useAppStore } from '../state/appStore'
import { usePlacesStore } from '../state/placesStore'
import { clearRoutes, openRoutes, ROUTE_COLOURS, ROUTE_LETTERS, useRoutes, type RouteEnd } from './routeStore'
import { endName, height, routeTime } from './routeText'
import '../ui/routes.css'
import '../ui/minipop.css'

/**
 * The routes on the map: the three lines, the picked one on top and
 * thicker, each labelled with its letter and time; the two ends as markers
 * that drag. While the card is up the map's tap is the route's: on a line
 * it picks that route, on a place it goes there, anywhere else it moves
 * where you are going. With the card closed, the kept route stays drawn
 * alone, to be walked; a tap on it says what it is, with Clear and Edit.
 */

const SRC = 'routes'
let layersOn: MlMap | null = null
let fromM: maplibregl.Marker | null = null
let toM: maplibregl.Marker | null = null
let markersOn: MlMap | null = null
let keptPop: maplibregl.Popup | null = null

function addLayers(map: MlMap) {
  if (layersOn === map || !map.getStyle()) return
  map.addSource(SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  const lines = ['==', ['geometry-type'], 'LineString'] as const
  map.addLayer({
    id: 'routes-casing',
    type: 'line',
    source: SRC,
    filter: lines as never,
    layout: { 'line-cap': 'round', 'line-join': 'round', 'line-sort-key': ['get', 'z'] },
    paint: { 'line-color': 'rgba(6, 14, 24, 0.9)', 'line-width': ['case', ['get', 'picked'], 8, 5], 'line-opacity': ['case', ['get', 'picked'], 0.9, 0.55] },
  })
  map.addLayer({
    id: 'routes-line',
    type: 'line',
    source: SRC,
    filter: lines as never,
    layout: { 'line-cap': 'round', 'line-join': 'round', 'line-sort-key': ['get', 'z'] },
    paint: { 'line-color': ['get', 'color'], 'line-width': ['case', ['get', 'picked'], 4.5, 2.5], 'line-opacity': ['case', ['get', 'picked'], 1, 0.8] },
  })
  // a finger-wide line nobody sees, for picking a route with a tap
  map.addLayer({ id: 'routes-hit', type: 'line', source: SRC, filter: lines as never, paint: { 'line-color': '#000', 'line-width': 24, 'line-opacity': 0 } })
  map.addLayer({
    id: 'routes-label',
    type: 'symbol',
    source: SRC,
    filter: lines as never,
    layout: {
      'symbol-placement': 'line-center',
      'text-field': ['get', 'label'],
      'text-font': ['Noto Sans Medium'],
      'text-size': 12.5,
      'text-offset': [0, -1],
      'text-allow-overlap': true,
      'symbol-sort-key': ['get', 'z'],
    },
    paint: { 'text-color': ['get', 'color'], 'text-halo-color': 'rgba(6, 14, 24, 0.95)', 'text-halo-width': 1.8 },
  })
  // the kept route's ends, with the card closed
  map.addLayer({
    id: 'routes-ends',
    type: 'circle',
    source: SRC,
    filter: ['==', ['geometry-type'], 'Point'],
    paint: { 'circle-radius': 5, 'circle-color': ['get', 'color'], 'circle-stroke-color': 'rgba(6, 14, 24, 0.95)', 'circle-stroke-width': 2 },
  })
  layersOn = map
}

function buildFc(): FeatureCollection {
  const s = useRoutes.getState()
  const features: Feature[] = []
  if (s.open) {
    s.routes.forEach((r, k) => {
      const picked = k === s.pick
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: r.coords },
        properties: { k, color: ROUTE_COLOURS[k], picked, z: picked ? 10 : 3 - k, label: `${ROUTE_LETTERS[k]} · ${routeTime(r.timeS)}` },
      })
    })
  } else if (s.kept) {
    const k = s.kept
    const color = ROUTE_COLOURS[k.k] ?? ROUTE_COLOURS[0]
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: k.coords },
      properties: { k: k.k, color, picked: true, z: 10, label: routeTime(k.timeS) },
    })
    for (const c of [k.coords[0], k.coords[k.coords.length - 1]]) features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: c }, properties: { color } })
  }
  return { type: 'FeatureCollection', features }
}

function endEl(cls: string, label: string): HTMLElement {
  const el = document.createElement('div')
  el.className = `route-end ${cls}`
  el.setAttribute('aria-label', label)
  // a tap on an end is not a tap on the map
  el.addEventListener('click', (e) => e.stopPropagation())
  return el
}

function syncMarkers(map: MlMap | null) {
  if (markersOn !== map) {
    fromM?.remove()
    toM?.remove()
    fromM = toM = null
    markersOn = map
  }
  if (!map) return
  const s = useRoutes.getState()
  const place = (m: maplibregl.Marker | null, end: RouteEnd | null, make: () => maplibregl.Marker): maplibregl.Marker | null => {
    if (!s.open || !end) {
      m?.remove()
      return null
    }
    if (m) return m.setLngLat([end.lon, end.lat])
    // a marker must know where it is before it goes on the map
    return make().setLngLat([end.lon, end.lat]).addTo(map)
  }
  fromM = place(fromM, s.from, () => {
    const m = new maplibregl.Marker({ element: endEl('route-from', 'Start: drag to move'), draggable: true })
    m.on('dragend', () => {
      const ll = m.getLngLat()
      useRoutes.getState().setFrom({ lon: ll.lng, lat: ll.lat, kind: 'map', name: 'Start' })
    })
    return m
  })
  toM = place(toM, s.to, () => {
    const m = new maplibregl.Marker({ element: endEl('route-to', 'Where you are going: drag to move'), draggable: true })
    m.on('dragend', () => {
      const ll = m.getLngLat()
      useRoutes.getState().setTo({ lon: ll.lng, lat: ll.lat, kind: 'map', name: '' })
    })
    return m
  })
  const from = fromM?.getElement()
  if (from) from.classList.toggle('route-you', s.from?.kind === 'you')
}

function render(map: MlMap) {
  if (layersOn !== map) return
  ;(map.getSource(SRC) as GeoJSONSource | undefined)?.setData(buildFc())
  syncMarkers(map)
}

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)

/** The kept route, tapped: what it is, and Clear or Edit. Closes on the next tap off it. */
function showKept(map: MlMap, at: [number, number]) {
  const k = useRoutes.getState().kept
  if (!k) return
  keptPop?.remove()
  const units = useAppStore.getState().units
  const a = k.coords[0]
  const b = k.coords[k.coords.length - 1]
  const to = endName({ lon: a[0], lat: a[1], kind: 'map', name: k.from }, { lon: b[0], lat: b[1], kind: 'map', name: k.to }, units)
  const el = document.createElement('div')
  el.innerHTML =
    `<div class="mp-head"><i style="background:${ROUTE_COLOURS[k.k] ?? ROUTE_COLOURS[0]}"></i><b>${esc(routeTime(k.timeS))}</b>` +
    `<span>${esc(formatDistance(k.distM, units))} · ↑${esc(height(k.climbM, units))}</span></div>` +
    `<div class="mp-sub">${k.mode === 'hunt' ? 'Hunt route' : 'Route'} from ${esc(k.from || 'the start')} to ${esc(to)}</div>` +
    `<div class="pp-acts"><button class="mp-danger rt-pop-clear">Clear</button><button class="mp-plain rt-pop-edit">Edit</button></div>`
  const pop = new maplibregl.Popup({ className: 'depth-popup', closeButton: false, closeOnClick: false, offset: 8, maxWidth: '240px' }).setLngLat(at).setDOMContent(el).addTo(map)
  closeOnTapOff(map, pop)
  pop.on('close', () => {
    if (keptPop === pop) keptPop = null
  })
  keptPop = pop
  el.querySelector('.rt-pop-clear')?.addEventListener('click', () => {
    pop.remove()
    clearRoutes()
  })
  el.querySelector('.rt-pop-edit')?.addEventListener('click', () => {
    pop.remove()
    openRoutes()
  })
}

let inited = false
export function initRouteLayer() {
  if (inited) return
  inited = true
  onEachMap((map) => {
    addLayers(map)
    render(map)
    map.on('click', (e) => {
      const s = useRoutes.getState()
      const box: [[number, number], [number, number]] = [
        [e.point.x - 6, e.point.y - 6],
        [e.point.x + 6, e.point.y + 6],
      ]
      // the card closed: only the kept route answers a tap (the map's popup stands aside for it, MapView)
      if (!s.open) {
        if (s.kept && map.queryRenderedFeatures(e.point, { layers: ['routes-hit'] }).length) showKept(map, [e.lngLat.lng, e.lngLat.lat])
        return
      }
      const hit = map.queryRenderedFeatures(box, { layers: ['routes-hit'] })
      if (hit.length) {
        // the picked one wins a tap where lines run together
        const ks = hit.map((f) => f.properties?.k as number)
        return s.setPick(ks.includes(s.pick) ? s.pick : ks[0])
      }
      const place = map.getLayer('places-pt') ? map.queryRenderedFeatures(e.point, { layers: ['places-pt'] })[0] : undefined
      const id = place?.properties?.id as string | undefined
      const p = id ? usePlacesStore.getState().places.find((q) => q.id === id) : undefined
      if (p) return s.setTo({ lon: p.lon, lat: p.lat, kind: 'place', name: p.name })
      s.setTo({ lon: e.lngLat.lng, lat: e.lngLat.lat, kind: 'map', name: '' })
    })
    map.on('mouseenter', 'routes-hit', () => {
      if (useRoutes.getState().open) map.getCanvas().style.cursor = 'pointer'
    })
    map.on('mouseleave', 'routes-hit', () => (map.getCanvas().style.cursor = ''))
  })
  useRoutes.subscribe((s, p) => {
    // a kept route cleared or reopened from the card takes its popup with it
    if (keptPop && (s.open || s.kept !== p.kept)) keptPop.remove()
    if (s.routes === p.routes && s.pick === p.pick && s.open === p.open && s.kept === p.kept && s.from === p.from && s.to === p.to) return
    const live = getMap()
    if (live && layersOn === live) render(live)
    else withMap(render)
  })
}
