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
import { nextColour, usePaths, type PlannedPath } from './pathStore'
import '../ui/minipop.css'

/**
 * Your planned walks on the map: dotted lines, each in its own colour,
 * over a darker dot so they read on the photo and the shade alike. With
 * the Path button down, one finger (or the mouse) draws freehand and two
 * move the map; each stroke is a path of its own, done when the finger
 * lifts. A kept path answers a tap with its length, its time on foot, its
 * name and colour, and Delete. Hidden with the strip's marks (Paths).
 *
 * The stroke under the finger is ink on a canvas over the map, drawn the
 * next frame. Through the map's GeoJSON every move waited on a worker to
 * re-cut the whole source, and the first ink came 0.4–0.75 s after the
 * finger landed on a phone (Gavan, 2026-10-14: "first touch always
 * lags"). A kept stroke stays as ink until the map has drawn it as a path.
 */

const SRC = 'paths'
// dots: zero-length dashes with round caps, the casing's spaced to land under the line's
const W = 4
const CASE_W = 7
const GAP = 2.4
// a finger's stroke: a sample every few pixels, thinned when it lifts to what the eye can tell from the line
const SAMPLE_PX = 3
const SIMPLIFY_PX = 1.2
// a press that goes nowhere draws nothing
const TAP_PX = 8
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
  // a kept path's tap, wide enough for a thumb
  map.addLayer({
    id: 'paths-hit',
    type: 'line',
    source: SRC,
    filter: line,
    paint: { 'line-color': '#000', 'line-width': 22, 'line-opacity': 0 },
  })
  layersOn = map
}

function buildFc(): FeatureCollection {
  const { paths, drawing } = usePaths.getState()
  const features: Feature[] = []
  // drawing, every path shows, the marks off or not: you see what you are adding to
  if (drawing || markShown(useAppStore.getState(), 'paths')) {
    for (const p of paths) {
      if (p.points.length < 2) continue
      features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: p.points }, properties: { kind: 'path', id: p.id, color: p.color } })
    }
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

/** A kept path, tapped: its name (a field, as a pin's is), its colour, how far and how long on foot, and Delete. */
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
    `<div class="pp-acts"><button class="mp-danger pa-delete">Delete</button></div>`
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
}

/** Put the Path button down: the ruler and the route card go, they want the same taps. */
export function startPath() {
  useMeasureStore.getState().stop()
  if (useRoutes.getState().open) closeRoutes()
  useAppStore.getState().closeSheet()
  open?.remove()
  usePaths.getState().start()
}

// ---------- freehand ----------

interface Sample {
  x: number
  y: number
  ll: [number, number]
}

/** The stroke under a finger or the mouse, in screen pixels and on the ground, in the colour it will keep. */
let stroke: { samples: Sample[]; t0: number; touch: boolean; color: string } | null = null
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

// ---------- ink: the stroke under the finger, and kept ones until the map shows them ----------

let ink: HTMLCanvasElement | null = null
/** kept strokes still drawn as ink, by the id of the path each became, until the map draws that path */
let inked: { pts: [number, number][]; color: string; id: string }[] = []

/** The ink canvas, just over the map's (under its markers and popups), the map's size at the screen's pixels. */
function inkOn(map: MlMap): CanvasRenderingContext2D | null {
  const box = map.getCanvasContainer()
  if (!ink || ink.parentElement !== box) {
    ink?.remove()
    ink = document.createElement('canvas')
    ink.className = 'paths-ink'
    ink.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none'
    map.getCanvas().after(ink)
  }
  const dpr = window.devicePixelRatio || 1
  // the GL canvas's size: its container is a box with no height of its own
  const w = map.getCanvas().clientWidth
  const h = map.getCanvas().clientHeight
  if (ink.width !== Math.round(w * dpr) || ink.height !== Math.round(h * dpr)) {
    ink.width = Math.round(w * dpr)
    ink.height = Math.round(h * dpr)
    ink.style.width = `${w}px`
    ink.style.height = `${h}px`
  }
  const ctx = ink.getContext('2d')
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx?.clearRect(0, 0, w, h)
  return ctx
}

/** The same dots as the map's line: a dark dot under a coloured one, GAP × W apart. Points come from the ground, so a map that moves keeps them in place. */
function inkLine(map: MlMap, ctx: CanvasRenderingContext2D, pts: [number, number][], color: string) {
  if (pts.length < 2) return
  ctx.beginPath()
  pts.forEach((ll, i) => {
    const p = map.project(ll)
    if (i) ctx.lineTo(p.x, p.y)
    else ctx.moveTo(p.x, p.y)
  })
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.setLineDash([0, GAP * W])
  ctx.lineWidth = CASE_W
  ctx.strokeStyle = 'rgba(8, 20, 34, 0.85)'
  ctx.stroke()
  ctx.lineWidth = W
  ctx.strokeStyle = color
  ctx.stroke()
}

function drawInk(map: MlMap) {
  if (!stroke && !inked.length) {
    // nothing to show: the canvas gives its memory back
    if (ink && ink.width) ink.width = ink.height = 0
    return
  }
  const ctx = inkOn(map)
  if (!ctx) return
  for (const k of inked) inkLine(map, ctx, k.pts, k.color)
  if (!stroke) return
  const pts = stroke.samples.map((s) => s.ll)
  inkLine(map, ctx, pts, stroke.color)
  // where it started, and the finger's end of it
  ctx.setLineDash([])
  for (const ll of pts.length > 1 ? [pts[0], pts[pts.length - 1]] : pts) {
    const p = map.project(ll)
    ctx.beginPath()
    ctx.arc(p.x, p.y, 6, 0, 2 * Math.PI)
    ctx.fillStyle = '#12263c'
    ctx.fill()
    ctx.lineWidth = 2.5
    ctx.strokeStyle = stroke.color
    ctx.stroke()
  }
}

function drawSoon(map: MlMap) {
  if (frame) return
  frame = requestAnimationFrame(() => {
    frame = 0
    drawInk(map)
  })
}

/** A frame the map drew: a kept stroke it now shows as a path (or that is gone, taken back) comes off the ink, in that same frame. */
function inkHandover(map: MlMap) {
  if (!inked.length || !map.getLayer('paths-line')) return
  const have = new Set(usePaths.getState().paths.map((p) => p.id))
  const left = inked.filter((k) => have.has(k.id) && !map.queryRenderedFeatures({ layers: ['paths-line'], filter: ['==', ['get', 'id'], k.id] }).length)
  if (left.length === inked.length) return
  inked = left
  drawInk(map)
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

/** The finger lifted, or a second one landed (`pinch`): the stroke, thinned, is a path. A tap draws nothing. */
function endStroke(map: MlMap, pinch = false) {
  const st = stroke
  stroke = null
  if (!st) return
  const first = st.samples[0]
  const far = Math.max(...st.samples.map((s) => Math.hypot(s.x - first.x, s.y - first.y)))
  const ms = Date.now() - st.t0
  if (far < TAP_PX || (pinch && (ms < PINCH_MS || far < PINCH_PX))) return drawInk(map)
  const pts = simplify(st.samples, SIMPLIFY_PX).map((s) => s.ll)
  const before = usePaths.getState().drawn.length
  usePaths.getState().addPath(pts)
  const { drawn } = usePaths.getState()
  if (drawn.length === before) return drawInk(map)
  // the ink holds until the map has drawn the path (inkHandover): no frame without it
  const k = { pts, color: st.color, id: drawn[drawn.length - 1] }
  inked.push(k)
  drawInk(map)
  // whatever happens to that send, the ink does not stay
  window.setTimeout(() => {
    if (!inked.includes(k)) return
    inked = inked.filter((o) => o !== k)
    drawInk(map)
  }, 1500)
}

function beginStroke(map: MlMap, clientX: number, clientY: number, touch: boolean) {
  stroke = { samples: [sampleAt(map, clientX, clientY)], t0: Date.now(), touch, color: nextColour(usePaths.getState().paths) }
  // the first dot under the finger now, not a frame later
  drawInk(map)
}

/** The draw gestures, caught on the map's own box before MapLibre's handlers
 *  (on the canvas container inside it) can pan with them. Only a press on
 *  the bare map counts: the markers and popups keep their own. */
function wireFreehand(map: MlMap) {
  const box = map.getContainer()
  const canvas = map.getCanvas()
  const drawing = (e: Event) => usePaths.getState().drawing && e.target === canvas

  box.addEventListener(
    'touchstart',
    (e) => {
      lastTouchMs = Date.now()
      if (!drawing(e)) return
      if (e.touches.length === 1 && !mapGesture) {
        e.stopPropagation()
        e.preventDefault() // no click, no mouse echo, no page scroll
        const t = e.touches[0]
        return beginStroke(map, t.clientX, t.clientY, true)
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
      beginStroke(map, e.clientX, e.clientY, false)
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
  // the map's own click and double click stand aside: drawing, a tap on the map is nothing
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
    map.on('render', () => inkHandover(map))
    // ink sits on the ground: a map that moves takes it along
    map.on('move', () => {
      if (stroke || inked.length) drawInk(map)
    })

    map.on('click', (e) => {
      const st = usePaths.getState()
      // drawing, the bare map's taps never get here (wireFreehand), and your dot's is nothing
      if (st.drawing) return
      // a kept path: only while no tool has the tap, and a kept route under it wins (routeLayer)
      if (useMeasureStore.getState().active || useRoutes.getState().open) return
      const hit = map.queryRenderedFeatures(e.point, { layers: ['paths-hit', 'routes-hit'].filter((id) => map.getLayer(id)) })
      if (!hit.length || hit.some((f) => f.layer.id === 'routes-hit')) return
      const p = st.paths.find((x) => x.id === hit[0].properties?.id)
      if (p) showPathPopup(map, p, [e.lngLat.lng, e.lngLat.lat])
    })

    map.on('mouseenter', 'paths-hit', () => {
      if (!usePaths.getState().drawing) map.getCanvas().style.cursor = 'pointer'
    })
    map.on('mouseleave', 'paths-hit', () => (map.getCanvas().style.cursor = ''))
  })

  const redraw = () => {
    const live = getMap()
    if (live && layersOn === live) render(live)
    else withMap(render)
  }
  usePaths.subscribe((s, p) => {
    if (s.paths !== p.paths || s.drawing !== p.drawing) redraw()
  })
  useAppStore.subscribe((s, p) => {
    if (markShown(s, 'paths') !== markShown(p, 'paths')) redraw()
  })
  // the ruler or the route card taken up mid-draw: the Path button comes up, what is drawn stays
  useMeasureStore.subscribe((s, p) => {
    if (s.active && !p.active && usePaths.getState().drawing) usePaths.getState().done()
  })
  useRoutes.subscribe((s, p) => {
    if (s.open && !p.open && usePaths.getState().drawing) usePaths.getState().done()
  })
}
