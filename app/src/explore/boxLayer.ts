import maplibregl, { type GeoJSONSource, type Map as MlMap } from 'maplibre-gl'
import type { Feature, FeatureCollection, Polygon } from 'geojson'
import { devlog } from '../devlog'
import { getMap, onEachMap } from '../map/mapController'
import { useAppStore } from '../state/appStore'
import { boxId, bounds, centre, corners, dragCorner, moveTo, parseBoxId, sizeKm, tilesUnder, type Box, type Corner } from './box'
import { COVERAGE_SOURCE } from './coverage'
import { useExplore, type CoverageProps } from './store'

/**
 * The box on the map (explore/box.ts): its outline, a handle on each
 * corner to size it and one in the middle to move it, dragged with one
 * finger while the map pans under any other; and the boxes asked for from
 * this phone, in copper, while Explore is on. What the coverage index says
 * of the tiles under the box is read off the grid's loaded tiles as it
 * changes (the card sums it).
 */

const SRC = 'explore-box'
const COPPER = '#d67a3c'
const MOVE_SVG =
  '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/></svg>'

function ring(b: Box, kind: 'pick' | 'asked'): Feature<Polygon> {
  const { west, south, east, north } = bounds(b)
  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [[[west, north], [east, north], [east, south], [west, south], [west, north]]] },
    properties: { kind },
  }
}

function data(): FeatureCollection {
  const st = useExplore.getState()
  const features: Feature[] = []
  for (const id of Object.keys(st.requested)) {
    const b = parseBoxId(id)
    if (b) features.push(ring(b, 'asked'))
  }
  if (st.selected) features.push(ring(st.selected.box, 'pick'))
  return { type: 'FeatureCollection', features }
}

const askedVis = () => (useAppStore.getState().exploreMode ? 'visible' : 'none')

function ensure(m: MlMap) {
  if (m.getSource(SRC)) return
  m.addSource(SRC, { type: 'geojson', data: data() })
  m.addLayer({ id: 'explore-asked-fill', type: 'fill', source: SRC, filter: ['==', ['get', 'kind'], 'asked'], layout: { visibility: askedVis() }, paint: { 'fill-color': COPPER, 'fill-opacity': 0.12 } })
  m.addLayer({ id: 'explore-asked-line', type: 'line', source: SRC, filter: ['==', ['get', 'kind'], 'asked'], layout: { visibility: askedVis() }, paint: { 'line-color': COPPER, 'line-width': 2, 'line-dasharray': [2, 1.5] } })
  m.addLayer({ id: 'explore-box-fill', type: 'fill', source: SRC, filter: ['==', ['get', 'kind'], 'pick'], paint: { 'fill-color': '#eef5ea', 'fill-opacity': 0.08 } })
  // a dark casing so the white edge reads over snow, sand and cloud
  m.addLayer({ id: 'explore-box-casing', type: 'line', source: SRC, filter: ['==', ['get', 'kind'], 'pick'], paint: { 'line-color': 'rgba(10,20,12,0.85)', 'line-width': 4.5 } })
  m.addLayer({ id: 'explore-box-line', type: 'line', source: SRC, filter: ['==', ['get', 'kind'], 'pick'], paint: { 'line-color': '#eef5ea', 'line-width': 2 } })
}

const LAYERS = ['explore-asked-fill', 'explore-asked-line', 'explore-box-fill', 'explore-box-casing', 'explore-box-line']

type HandleKey = Corner | 'mid'
let handles: Partial<Record<HandleKey, maplibregl.Marker>> = {}
let handlesOn: MlMap | null = null

const same = (a: Box, b: Box) => a.x0 === b.x0 && a.y0 === b.y0 && a.x1 === b.x1 && a.y1 === b.y1

function where(b: Box, k: HandleKey): [number, number] {
  return k === 'mid' ? centre(b) : corners(b)[k]
}

function makeHandle(m: MlMap, k: HandleKey, b: Box): maplibregl.Marker {
  const el = document.createElement('div')
  el.className = k === 'mid' ? 'box-handle box-handle-mid' : `box-handle box-handle-${k}`
  el.setAttribute('aria-label', k === 'mid' ? 'Move the box' : 'Size the box')
  if (k === 'mid') el.innerHTML = MOVE_SVG
  // the map never sees a press on a handle: it would pan, or take it for a
  // tap and move the box to it
  for (const t of ['mousedown', 'touchstart', 'click', 'dblclick'] as const) el.addEventListener(t, (e) => e.stopPropagation(), { passive: true })
  const mk = new maplibregl.Marker({ element: el }).setLngLat(where(b, k))
  // the handle keeps the pointer from press to lift, wherever it goes (over
  // the card too: MapLibre's own marker drag lost the lift there and stuck)
  el.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return
    e.preventDefault()
    e.stopPropagation()
    el.setPointerCapture(e.pointerId)
    const r = m.getContainer().getBoundingClientRect()
    const at = m.project(mk.getLngLat())
    // where on the handle it was taken, kept, so it does not jump to the finger
    const dx = e.clientX - r.left - at.x
    const dy = e.clientY - r.top - at.y
    const move = (ev: PointerEvent) => {
      const sel = useExplore.getState().selected
      if (!sel) return
      const { lng, lat } = m.unproject([ev.clientX - r.left - dx, ev.clientY - r.top - dy])
      const nb = k === 'mid' ? moveTo(sel.box, lng, lat) : dragCorner(sel.box, k, lng, lat)
      if (!same(nb, sel.box)) useExplore.getState().setBox(nb)
    }
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
      const sel = useExplore.getState().selected
      if (!sel) return
      const s = sizeKm(sel.box)
      devlog('explore', `box ${k === 'mid' ? 'moved' : 'sized'} · ${boxId(sel.box)} · ${s.w.toFixed(1)}×${s.h.toFixed(1)} km`)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  })
  return mk.addTo(m)
}

function clearHandles() {
  for (const mk of Object.values(handles)) mk?.remove()
  handles = {}
  handlesOn = null
}

function render(m: MlMap) {
  ;(m.getSource(SRC) as GeoJSONSource | undefined)?.setData(data())
  const sel = useExplore.getState().selected
  if (!sel) return clearHandles()
  // over what was added since (the scent cloud, a track)
  for (const id of LAYERS) if (m.getLayer(id)) m.moveLayer(id)
  if (handlesOn !== m) clearHandles()
  handlesOn = m
  // the middle first, so on a box small on the screen the corners lie over it and still size it
  for (const k of ['mid', 'nw', 'ne', 'sw', 'se'] as const) {
    const mk = handles[k]
    if (mk) mk.setLngLat(where(sel.box, k))
    else handles[k] = makeHandle(m, k, sel.box)
  }
}

/** What the coverage index says of each tile under the box, off the grid's
 *  loaded tiles; a tile not loaded yet is read on a later idle. */
function readCover(m: MlMap) {
  const sel = useExplore.getState().selected
  if (!sel || !m.getSource(COVERAGE_SOURCE)) return
  const ids = tilesUnder(sel.box).map((t) => t.id)
  const have = useExplore.getState().cover
  if (ids.every((id) => id in have) && Object.keys(have).length === ids.length) return
  const want = new Set(ids)
  const got: Record<string, CoverageProps> = {}
  for (const id of ids) if (have[id]) got[id] = have[id]
  for (const f of m.querySourceFeatures(COVERAGE_SOURCE, { sourceLayer: 'tiles' })) {
    const id = String(f.id ?? f.properties?.id)
    if (want.has(id) && !got[id]) got[id] = f.properties as CoverageProps
  }
  const keys = Object.keys(got)
  if (keys.length !== Object.keys(have).length || keys.some((id) => !(id in have))) useExplore.getState().setCover(got)
}

/**
 * The box where it can be worked: zoomed and moved to show it whole below
 * the card (`below`, px down the page), with room round it to pull a
 * corner out, when it is off the screen or too small to take a handle;
 * left alone otherwise.
 */
export function fitBox(m: MlMap, b: Box, below: number): void {
  const { west, south, east, north } = bounds(b)
  const c = m.getContainer()
  const W = c.clientWidth
  const H = c.clientHeight
  const side = Math.round(Math.min(W * 0.22, 160))
  const pad = { top: Math.round(Math.min(H * 0.6, below - c.getBoundingClientRect().top + 40)), bottom: 100, left: side, right: side }
  const a = m.project([west, north])
  const z = m.project([east, south])
  const shown = a.x >= pad.left && z.x <= W - pad.right && a.y >= pad.top && z.y <= H - pad.bottom
  if (shown && z.x - a.x >= 120) return
  m.fitBounds(
    [
      [west, south],
      [east, north],
    ],
    { padding: pad, maxZoom: 13, duration: 600 },
  )
}

let wired = false
/** Called once from MapView. */
export function initBoxLayer(): void {
  if (wired) return
  wired = true
  onEachMap((m) => {
    ensure(m)
    render(m)
    m.on('idle', () => readCover(m))
  })
  useExplore.subscribe((s, prev) => {
    const m = getMap()
    if (!m || !m.getSource(SRC)) return
    if (s.selected !== prev.selected || s.requested !== prev.requested) render(m)
    if (s.selected?.box !== prev.selected?.box) {
      // a new box starts its reading over; one only moved keeps the tiles still under it
      if (!s.selected) useExplore.getState().setCover({})
      else readCover(m)
    }
  })
  useAppStore.subscribe((s, prev) => {
    if (s.exploreMode === prev.exploreMode) return
    const m = getMap()
    if (m) for (const id of ['explore-asked-fill', 'explore-asked-line']) if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', askedVis())
  })
}
