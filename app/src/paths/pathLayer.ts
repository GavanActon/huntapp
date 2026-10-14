import type { Feature, FeatureCollection } from 'geojson'
import maplibregl, { type GeoJSONSource, type Map as MlMap } from 'maplibre-gl'
import { getMap, onEachMap, withMap } from '../map/mapController'
import { closeOnTapOff } from '../map/tapPopup'
import { formatDistance, totalM } from '../measure/measureMath'
import { useMeasureStore } from '../measure/measureStore'
import { closeRoutes, useRoutes } from '../routes/routeStore'
import { markShown, useAppStore } from '../state/appStore'
import { PIN_COLOURS } from '../state/pinColours'
import { agoLabel, durationLabel } from '../time'
import { usePaths, type PlannedPath } from './pathStore'
import '../ui/minipop.css'

/**
 * Your planned walks on the map: dotted lines, each in its own colour,
 * over a darker dot so they read on the photo and the shade alike. While
 * one is drawn, one finger (or the mouse) draws freehand and two move the
 * map; a tap adds a straight leg. Each stroke carries on from the end of
 * the path. A kept path answers a tap with its length, its time on foot,
 * Edit and Delete. Hidden with the strip's marks (Paths).
 */

const SRC = 'paths'
// dots: zero-length dashes with round caps, the casing's spaced to land under the line's
const W = 4
const CASE_W = 7
const GAP = 2.4
// a finger's stroke: a sample every few pixels, thinned when it lifts to what the eye can tell from the line
const SAMPLE_PX = 3
const SIMPLIFY_PX = 1.2
// a press that goes nowhere, quickly, is a tap
const TAP_PX = 8
const TAP_MS = 450
// a second finger this soon, or this close, is a pinch starting: the first finger drew nothing
const PINCH_MS = 300
const PINCH_PX = 30

let layersOn: MlMap | null = null

function emptyFc(): FeatureCollection {
  return { type: 'FeatureCollection', features: [] }
}

function addLayers(map: MlMap) {
  if (layersOn === map || !map.getStyle()) return
  map.addSource(SRC, { type: 'geojson', data: emptyFc() })
  const line = ['==', ['get', 'kind'], 'path'] as never
  map.addLayer({
    id: 'paths-casing',
    type: 'line',
    source: SRC,
    filter: line,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': 'rgba(8, 20, 34, 0.85)', 'line-width': CASE_W, 'line-dasharray': [0, (GAP * W) / CASE_W] },
  })
  map.addLayer({
    id: 'paths-line',
    type: 'line',
    source: SRC,
    filter: line,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ['get', 'color'], 'line-width': W, 'line-dasharray': [0, GAP] },
  })
  // a kept path's tap, wide enough for a thumb; the one being drawn takes taps as points instead
  map.addLayer({
    id: 'paths-hit',
    type: 'line',
    source: SRC,
    filter: ['all', ['==', ['get', 'kind'], 'path'], ['!', ['has', 'draft']]] as never,
    paint: { 'line-color': '#000', 'line-width': 22, 'line-opacity': 0 },
  })
  // the draft's two ends: where it starts, and where the next stroke carries on from
  map.addLayer({
    id: 'paths-ends',
    type: 'circle',
    source: SRC,
    filter: ['==', ['get', 'kind'], 'end'],
    paint: {
      'circle-radius': 6,
      'circle-color': '#12263c',
      'circle-stroke-color': ['get', 'color'],
      'circle-stroke-width': 2.5,
    },
  })
  layersOn = map
}

function buildFc(): FeatureCollection {
  const { paths, draft } = usePaths.getState()
  const features: Feature[] = []
  if (markShown(useAppStore.getState(), 'paths')) {
    for (const p of paths) {
      // the one open to edit is drawn as the draft
      if (p.id === draft?.id || p.points.length < 2) continue
      features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: p.points }, properties: { kind: 'path', id: p.id, color: p.color } })
    }
  }
  if (draft) {
    // the stroke under the finger draws as it goes
    const pts = stroke ? [...draft.points, ...stroke.samples.map((s) => s.ll)] : draft.points
    if (pts.length >= 2) features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: pts }, properties: { kind: 'path', draft: true, color: draft.color } })
    for (const p of pts.length > 1 ? [pts[0], pts[pts.length - 1]] : pts) features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: p }, properties: { kind: 'end', color: draft.color } })
  }
  return { type: 'FeatureCollection', features }
}

function render(map: MlMap) {
  if (layersOn !== map) return
  ;(map.getSource(SRC) as GeoJSONSource | undefined)?.setData(buildFc())
}

/** Metres and the time on foot at your pace (Measure's), the card's and the popup's words. */
export function pathFacts(points: [number, number][]): { m: number; dist: string; walk: string } {
  const { units, paceKmh } = useAppStore.getState()
  const m = totalM(points)
  return { m, dist: formatDistance(m, units), walk: durationLabel(Math.max(1, Math.round((m / 1000 / paceKmh) * 60))) }
}

const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)

let open: maplibregl.Popup | null = null

/** A kept path, tapped: its name (a field, as a pin's is), its colour, how far and how long on foot, Delete and Edit. */
function showPathPopup(map: MlMap, p: PlannedPath, at: [number, number]) {
  open?.remove()
  const el = document.createElement('div')
  const f = pathFacts(p.points)
  const swatches = PIN_COLOURS.map((c) => `<button class="pin-swatch${p.color === c ? ' on' : ''}" data-c="${c}" style="--sw:${c}" aria-label="Colour ${c}" aria-pressed="${p.color === c}"></button>`).join('')
  el.innerHTML =
    `<div class="mp-head"><input class="mp-name" value="${esc(p.name ?? '')}" placeholder="Name this path" aria-label="Name" maxlength="40" autocomplete="off" enterkeyhint="done" /><span>path</span></div>` +
    `<div class="mp-sub numeral"><b>${esc(f.dist)}</b> · about ${esc(f.walk)} on foot</div>` +
    `<div class="pin-swatches">${swatches}</div>` +
    `<div class="mp-sub">drawn ${esc(agoLabel(Date.now() - p.savedAt))}</div>` +
    `<div class="pp-acts"><button class="mp-danger pa-delete">Delete</button><button class="mp-plain pa-edit">Edit</button></div>`
  const pop = new maplibregl.Popup({ className: 'depth-popup', closeButton: false, closeOnClick: false, offset: 10, maxWidth: '240px' }).setLngLat(at).setDOMContent(el).addTo(map)
  closeOnTapOff(map, pop)
  pop.on('close', () => {
    if (open === pop) open = null
  })
  open = pop
  const name = el.querySelector('.mp-name') as HTMLInputElement
  name.addEventListener('input', () => usePaths.getState().update(p.id, { name: name.value.trim() || undefined }))
  name.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') name.blur()
  })
  el.querySelectorAll<HTMLButtonElement>('.pin-swatch').forEach((b) =>
    b.addEventListener('click', () => {
      usePaths.getState().update(p.id, { color: b.dataset.c })
      el.querySelectorAll('.pin-swatch').forEach((o) => {
        o.classList.toggle('on', o === b)
        o.setAttribute('aria-pressed', String(o === b))
      })
    }),
  )
  el.querySelector('.pa-delete')?.addEventListener('click', () => {
    const q = usePaths.getState().paths.find((x) => x.id === p.id)
    if (q?.name && !confirm(`Delete ${q.name}?`)) return
    pop.remove()
    usePaths.getState().remove(p.id)
  })
  el.querySelector('.pa-edit')?.addEventListener('click', () => {
    pop.remove()
    startPath(p.id)
  })
}

/** Draw a new path, or edit a kept one: the ruler and the route card go, they want the same taps. */
export function startPath(id?: string) {
  useMeasureStore.getState().stop()
  if (useRoutes.getState().open) closeRoutes()
  useAppStore.getState().closeSheet()
  open?.remove()
  usePaths.getState().start(id)
}

// ---------- freehand ----------

interface Sample {
  x: number
  y: number
  ll: [number, number]
}

/** The stroke under a finger or the mouse, in screen pixels and on the ground. */
let stroke: { samples: Sample[]; t0: number; touch: boolean } | null = null
// two fingers down: the map's pinch or pan, until every finger is up
let mapGesture = false
let lastTouchMs = 0
let frame = 0

function sampleAt(map: MlMap, clientX: number, clientY: number): Sample {
  const r = map.getCanvasContainer().getBoundingClientRect()
  const x = clientX - r.left
  const y = clientY - r.top
  const ll = map.unproject([x, y])
  return { x, y, ll: [ll.lng, ll.lat] }
}

function drawSoon(map: MlMap) {
  if (frame) return
  frame = requestAnimationFrame(() => {
    frame = 0
    render(map)
  })
}

function extend(map: MlMap, clientX: number, clientY: number) {
  if (!stroke) return
  const s = sampleAt(map, clientX, clientY)
  const last = stroke.samples[stroke.samples.length - 1]
  if (Math.hypot(s.x - last.x, s.y - last.y) < SAMPLE_PX) return
  stroke.samples.push(s)
  drawSoon(map)
}

/** Douglas–Peucker on the screen: the bends a finger meant, not its tremble. */
function simplify(pts: Sample[], tol: number): Sample[] {
  if (pts.length < 3) return pts
  const keep = new Uint8Array(pts.length)
  keep[0] = keep[pts.length - 1] = 1
  const stack: [number, number][] = [[0, pts.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    const A = pts[a]
    const dx = pts[b].x - A.x
    const dy = pts[b].y - A.y
    const len = Math.hypot(dx, dy)
    let worst = 0
    let at = -1
    for (let i = a + 1; i < b; i++) {
      const d = len < 1e-6 ? Math.hypot(pts[i].x - A.x, pts[i].y - A.y) : Math.abs(dy * (pts[i].x - A.x) - dx * (pts[i].y - A.y)) / len
      if (d > worst) {
        worst = d
        at = i
      }
    }
    if (worst > tol) {
      keep[at] = 1
      stack.push([a, at], [at, b])
    }
  }
  return pts.filter((_, i) => keep[i])
}

/** The finger lifted, or a second one landed (`pinch`): a tap is a straight leg, a stroke is kept thinned. */
function endStroke(map: MlMap, pinch = false) {
  const st = stroke
  stroke = null
  if (!st) return
  const first = st.samples[0]
  const far = Math.max(...st.samples.map((s) => Math.hypot(s.x - first.x, s.y - first.y)))
  const ms = Date.now() - st.t0
  const tap = far < TAP_PX
  const keep = tap ? !pinch && ms < TAP_MS : !(pinch && (ms < PINCH_MS || far < PINCH_PX))
  if (!keep) return render(map)
  usePaths.getState().addStroke(tap ? [first.ll] : simplify(st.samples, SIMPLIFY_PX).map((s) => s.ll))
}

/** The draw gestures, caught on the map's own box before MapLibre's handlers
 *  (on the canvas container inside it) can pan with them. Only a press on
 *  the bare map counts: the markers and popups keep their own. */
function wireFreehand(map: MlMap) {
  const box = map.getContainer()
  const canvas = map.getCanvas()
  const drawing = (e: Event) => usePaths.getState().draft != null && e.target === canvas

  box.addEventListener(
    'touchstart',
    (e) => {
      lastTouchMs = Date.now()
      if (!drawing(e)) return
      if (e.touches.length === 1 && !mapGesture) {
        e.stopPropagation()
        e.preventDefault() // no click, no mouse echo, no page scroll
        const t = e.touches[0]
        stroke = { samples: [sampleAt(map, t.clientX, t.clientY)], t0: Date.now(), touch: true }
        return drawSoon(map)
      }
      // a second finger: the stroke ends and the map takes the pinch from here
      if (stroke) endStroke(map, true)
      mapGesture = true
    },
    { capture: true, passive: false },
  )
  box.addEventListener(
    'touchmove',
    (e) => {
      if (!stroke?.touch) return
      e.stopPropagation()
      e.preventDefault()
      const t = e.touches[0]
      if (t) extend(map, t.clientX, t.clientY)
    },
    { capture: true, passive: false },
  )
  const touchEnd = (e: TouchEvent) => {
    lastTouchMs = Date.now()
    if (stroke?.touch) {
      e.stopPropagation()
      e.preventDefault()
      endStroke(map, e.type === 'touchcancel')
    }
    if (e.touches.length === 0) mapGesture = false
  }
  box.addEventListener('touchend', touchEnd, { capture: true, passive: false })
  box.addEventListener('touchcancel', touchEnd, { capture: true, passive: false })

  box.addEventListener(
    'mousedown',
    (e) => {
      if (!drawing(e) || e.button !== 0 || Date.now() - lastTouchMs < 700) return
      e.stopPropagation()
      stroke = { samples: [sampleAt(map, e.clientX, e.clientY)], t0: Date.now(), touch: false }
      const move = (ev: MouseEvent) => extend(map, ev.clientX, ev.clientY)
      const up = () => {
        window.removeEventListener('mousemove', move, true)
        window.removeEventListener('mouseup', up, true)
        endStroke(map)
      }
      window.addEventListener('mousemove', move, true)
      window.addEventListener('mouseup', up, true)
    },
    { capture: true },
  )
  // the map's own click and double click stand aside: the stroke and the tap were handled above
  const swallow = (e: Event) => {
    if (!drawing(e)) return
    e.stopPropagation()
    e.preventDefault()
  }
  box.addEventListener('click', swallow, { capture: true })
  box.addEventListener('dblclick', swallow, { capture: true })
  box.addEventListener('contextmenu', swallow, { capture: true })
}

let inited = false

/** Call once at startup, before the ruler's layer, so a measurement draws over a path. */
export function initPathLayer() {
  if (inited) return
  inited = true

  onEachMap((map) => {
    addLayers(map)
    render(map)
    wireFreehand(map)

    map.on('click', (e) => {
      const st = usePaths.getState()
      // the bare map's taps never get here while drawing (wireFreehand); your dot's does: a leg to where you stand
      if (st.draft) return st.addPoint([e.lngLat.lng, e.lngLat.lat])
      // a kept path: only while no tool has the tap, and a kept route under it wins (routeLayer)
      if (useMeasureStore.getState().active || useRoutes.getState().open) return
      const hit = map.queryRenderedFeatures(e.point, { layers: ['paths-hit', 'routes-hit'].filter((id) => map.getLayer(id)) })
      if (!hit.length || hit.some((f) => f.layer.id === 'routes-hit')) return
      const p = st.paths.find((x) => x.id === hit[0].properties?.id)
      if (p) showPathPopup(map, p, [e.lngLat.lng, e.lngLat.lat])
    })

    map.on('mouseenter', 'paths-hit', () => {
      if (!usePaths.getState().draft) map.getCanvas().style.cursor = 'pointer'
    })
    map.on('mouseleave', 'paths-hit', () => (map.getCanvas().style.cursor = ''))
  })

  const redraw = () => {
    const live = getMap()
    if (live && layersOn === live) render(live)
    else withMap(render)
  }
  usePaths.subscribe((s, p) => {
    if (s.paths !== p.paths || s.draft !== p.draft) redraw()
  })
  useAppStore.subscribe((s, p) => {
    if (markShown(s, 'paths') !== markShown(p, 'paths')) redraw()
  })
  // the ruler or the route card taken up mid-draw: what is drawn is kept
  useMeasureStore.subscribe((s, p) => {
    if (s.active && !p.active && usePaths.getState().draft) usePaths.getState().done()
  })
  useRoutes.subscribe((s, p) => {
    if (s.open && !p.open && usePaths.getState().draft) usePaths.getState().done()
  })
}
