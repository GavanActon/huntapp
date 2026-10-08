import maplibregl from 'maplibre-gl'
import type { Feature, FeatureCollection } from 'geojson'
import type { GeoJSONSource, Map as MlMap } from 'maplibre-gl'
import { onEachMap } from '../../map/mapController'
import { closeOnTapOff } from '../../map/tapPopup'
import { markShown, useAppStore } from '../../state/appStore'
import { timeLabel } from '../../time'
import { compass } from '../openMeteo'
import { aloftVerdict, checkFelt, checkPull, checkReachM, checkSpentAt, forecastVerdict, steadiness, useWindChecks, verdict, type WindCheck } from './windChecks'

/**
 * The wind checks still in effect, on the map. Each is an arrow where it
 * was made (the way the powder went; a ring for calm) and a dashed ring as
 * far as it still makes up a tenth of the ground wind. The ring shrinks
 * as the check ages and goes when it is spent, so what is on the map is
 * what is correcting the wind. Tap the arrow for how much it pulls there,
 * when it runs out, and to take it away. A check seen from afar (the
 * treetops over there) has a ring round its arrow, and its reach, the wind
 * above the trees for kilometres, is a dashed edge over the faintest wash.
 *
 * "In effect" is at the planning time, not the clock: plan an hour back
 * and the checks from then are the ones drawn. An outing from the hunt
 * log replays its checks instead: every arrow made in its hours, spent or
 * not, with no ring.
 */

const SRC = 'windchecks'
const ARROW = 'windcheck-arrow'
const CALM = 'windcheck-calm'
const SEEN = 'windcheck-seen'
const KY = 110_574

function ms(): number {
  return useAppStore.getState().planTimeMs ?? Date.now()
}

function ring(c: WindCheck, r: number): [number, number][] {
  const kx = 111_320 * Math.cos((c.lat * Math.PI) / 180)
  const pts: [number, number][] = []
  for (let k = 0; k <= 64; k++) {
    const a = (k / 64) * 2 * Math.PI
    pts.push([c.lon + (Math.sin(a) * r) / kx, c.lat + (Math.cos(a) * r) / KY])
  }
  return pts
}

/** The checks with any reach at the planning time. */
export function checksInEffect(at = ms()): WindCheck[] {
  return useWindChecks.getState().checks.filter((c) => checkReachM(c, at) > 0)
}

/** An outing being replayed from the hunt log: its checks instead of the live ones. */
let replay: { from: number; to: number } | null = null
let refreshSoon: () => void = () => {}

/**
 * Replay an outing's wind checks: an arrow for every check made in the
 * range, whether or not it still reaches. `null` puts the checks in effect
 * back.
 */
export function showOutingChecks(range: { from: number; to: number } | null): void {
  replay = range
  refreshSoon()
}

function features(at: number): FeatureCollection {
  const out: Feature[] = []
  // the strip's marks can take the checks off the map; they still sharpen the wind
  if (!markShown(useAppStore.getState(), 'wind')) return { type: 'FeatureCollection', features: out }
  if (replay) {
    const { from, to } = replay
    for (const c of useWindChecks.getState().checks) {
      if (c.ts < from || c.ts > to) continue
      out.push({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [c.lon, c.lat] },
        properties: { id: c.id, pull: 1, calm: c.dirFrom == null, seen: !!c.seen, toward: c.dirFrom == null ? 0 : (c.dirFrom + 180) % 360 },
      })
    }
    return { type: 'FeatureCollection', features: out }
  }
  for (const c of checksInEffect(at)) {
    const pull = checkPull(c, c.lon, c.lat, at)
    out.push({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring(c, checkReachM(c, at))] }, properties: { id: c.id, pull, seen: !!c.seen } })
    out.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [c.lon, c.lat] },
      properties: { id: c.id, pull, calm: c.dirFrom == null, seen: !!c.seen, toward: c.dirFrom == null ? 0 : (c.dirFrom + 180) % 360 },
    })
  }
  return { type: 'FeatureCollection', features: out }
}

/** An arrow pointing north (the symbol turns it), pale with a dark edge, and a calm ring. A shaft
 *  and a head, a wind vane's arrow: a bare arrowhead read as a second position arrow beside you. */
function images(map: MlMap) {
  const px = 2
  const draw = (paint: (g: CanvasRenderingContext2D) => void) => {
    const cv = document.createElement('canvas')
    cv.width = cv.height = 28 * px
    // on the CPU: read back from a GPU canvas it waits on the map's queued frames
    const g = cv.getContext('2d', { willReadFrequently: true })!
    g.scale(px, px)
    g.lineJoin = 'round'
    paint(g)
    return g.getImageData(0, 0, cv.width, cv.height)
  }
  const arrow = (ringed: boolean) =>
    draw((g) => {
      const head = () => {
        g.beginPath()
        g.moveTo(14, 2)
        g.lineTo(20, 12)
        g.lineTo(8, 12)
        g.closePath()
      }
      const shaft = () => {
        g.beginPath()
        g.moveTo(14, 10)
        g.lineTo(14, 26)
      }
      g.lineCap = 'round'
      g.strokeStyle = 'rgba(8, 20, 34, 0.9)'
      g.lineWidth = 5.5
      shaft()
      g.stroke()
      g.lineWidth = 3
      head()
      g.stroke()
      g.strokeStyle = '#bfe6ff'
      g.lineWidth = 2.5
      shaft()
      g.stroke()
      g.fillStyle = '#bfe6ff'
      head()
      g.fill()
      // seen from afar: a ring round it, the treetops over there, not the air where you stood
      if (ringed) {
        g.beginPath()
        g.arc(14, 14, 12.5, 0, 2 * Math.PI)
        g.lineWidth = 3.2
        g.strokeStyle = 'rgba(8, 20, 34, 0.9)'
        g.stroke()
        g.lineWidth = 1.4
        g.strokeStyle = '#bfe6ff'
        g.stroke()
      }
    })
  if (!map.hasImage(ARROW)) map.addImage(ARROW, arrow(false), { pixelRatio: px })
  if (!map.hasImage(SEEN)) map.addImage(SEEN, arrow(true), { pixelRatio: px })
  if (!map.hasImage(CALM))
    map.addImage(
      CALM,
      draw((g) => {
        g.beginPath()
        g.arc(14, 14, 7, 0, 2 * Math.PI)
        g.lineWidth = 5
        g.strokeStyle = 'rgba(8, 20, 34, 0.9)'
        g.stroke()
        g.lineWidth = 2.5
        g.strokeStyle = '#bfe6ff'
        g.stroke()
      }),
      { pixelRatio: px },
    )
}

/** checks drawn at the last refresh, so the last one to lapse is taken off too */
let drawn = 0

function ensure(map: MlMap) {
  const data = features(ms())
  drawn = data.features.length
  const src = map.getSource(SRC) as GeoJSONSource | undefined
  if (src) return src.setData(data)
  images(map)
  map.addSource(SRC, { type: 'geojson', data })
  const reach = ['==', ['geometry-type'], 'Polygon'] as ['==', ['geometry-type'], string]
  const pt = ['==', ['geometry-type'], 'Point'] as ['==', ['geometry-type'], string]
  map.addLayer({ id: 'windchecks-reach', type: 'fill', source: SRC, filter: reach, paint: { 'fill-color': '#bfe6ff', 'fill-opacity': ['*', ['case', ['get', 'seen'], 0.04, 0.16], ['get', 'pull']] } })
  map.addLayer({
    id: 'windchecks-edge',
    type: 'line',
    source: SRC,
    filter: reach,
    paint: { 'line-color': '#bfe6ff', 'line-opacity': ['interpolate', ['linear'], ['get', 'pull'], 0.1, 0.35, 0.5, 0.8], 'line-width': 1.2, 'line-dasharray': [3, 3] },
  })
  map.addLayer({
    id: 'windchecks-pt',
    type: 'symbol',
    source: SRC,
    filter: pt,
    layout: {
      'icon-image': ['case', ['get', 'calm'], CALM, ['get', 'seen'], SEEN, ARROW],
      'icon-rotate': ['get', 'toward'],
      'icon-rotation-alignment': 'map',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
      'icon-size': ['interpolate', ['linear'], ['zoom'], 12, 0.7, 16, 1.1],
    },
    paint: { 'icon-opacity': ['interpolate', ['linear'], ['get', 'pull'], 0.1, 0.55, 0.5, 1] },
  })
  // a finger-sized target over the arrow
  map.addLayer({ id: 'windchecks-hit', type: 'circle', source: SRC, filter: pt, paint: { 'circle-radius': 20, 'circle-opacity': 0.01, 'circle-color': '#000' } })
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)
}

/** What a check says and how much it still counts, for its popup (the model's verdict is in the outing's rows). */
function popupHtml(c: WindCheck, at: number): string {
  const steady = steadiness(c)
  const puffs = c.puffs ?? 1
  const felt = `${checkFelt(c)}${steady ? `, ${steady}` : ''}${puffs > 1 ? ` (${puffs} puffs)` : ''}${c.aloft ? ' · treetops moving' : ''}${c.held ? ' · had held a while' : ''}`
  const v = verdict(c)
  // seen from afar: the forecast is what it scores, and the share is of the wind above the trees
  const fv = c.seen ? forecastVerdict(c) : null
  const forecast =
    c.seen && c.forecast
      ? `<li>The forecast had ${c.forecast.kmh < 6 ? 'near calm' : `toward ${compass((c.forecast.dirFrom + 180) % 360)}`}${fv ? ` · <b class="gc-verdict gc-${fv}">${fv === 'agree' ? 'agreed' : fv === 'close' ? 'close' : 'missed'}</b>` : ''}</li>`
      : ''
  const av = aloftVerdict(c)
  const model = c.model
    ? `<li>The model had ${c.model.kmh < 1 ? 'near calm' : `toward ${compass((c.model.dirFrom + 180) % 360)}`}${v ? ` · <b class="gc-verdict gc-${v}">${v === 'agree' ? 'agreed' : v === 'close' ? 'close' : 'missed'}</b>` : ''}${av ? `; the air ${c.model.decoupled ? 'come loose from the wind above' : 'mixed with the wind above'} · <b class="gc-verdict gc-${av}">${av === 'agree' ? 'agreed' : 'missed'}</b>` : ''}</li>`
    : ''
  const pull = Math.round(checkPull(c, c.lon, c.lat, at) * 100)
  const reachM = checkReachM(c, at)
  const reach = reachM >= 1000 ? `${(reachM / 1000).toFixed(1)} km` : `${Math.round(reachM / 10) * 10} m`
  const spent = checkSpentAt(c)
  const when = useAppStore.getState().planTimeMs == null ? 'now' : 'at the planned time'
  return (
    `<div class="pg-head"><span>Wind sharpened · ${esc(timeLabel(c.ts))}${c.by ? ` · ${esc(c.by)}` : ''}</span></div>` +
    `<ul class="pp-reasons"><li>You ${c.seen ? 'saw' : 'felt'}: ${esc(felt)}</li>${model}${forecast}` +
    `<li>In effect ${when}: ${pull}% of the ${c.seen ? 'wind above the trees' : 'ground wind'} here, less farther out, to about ${reach} (the ring)</li>` +
    `<li>${spent > at ? `Fades out by ${esc(timeLabel(spent))}` : 'About spent'}</li></ul>` +
    `<div class="pg-acts"><button class="linklike ck-remove" type="button">remove this check</button></div>`
  )
}

let popup: maplibregl.Popup | null = null

/** A check's popup: what it felt, how much it still pulls, remove. The arrow's tap, and a Hunt log row's. */
export function showCheckPopup(map: MlMap, id: string): void {
  const c = useWindChecks.getState().checks.find((x) => x.id === id)
  if (!c) return
  popup?.remove()
  const el = document.createElement('div')
  el.className = 'depth-popup-ground ck-pop'
  el.innerHTML = popupHtml(c, ms())
  const p = new maplibregl.Popup({ className: 'depth-popup', closeButton: false, closeOnClick: false, offset: 12, maxWidth: '260px' }).setLngLat([c.lon, c.lat]).setDOMContent(el).addTo(map)
  closeOnTapOff(map, p)
  el.querySelector('.ck-remove')?.addEventListener('click', () => {
    useWindChecks.getState().remove(c.id)
    p.remove()
  })
  p.on('close', () => {
    if (popup === p) popup = null
  })
  popup = p
}

let wired = false
export function initCheckLayer() {
  if (wired) return
  wired = true
  let current: MlMap | null = null
  const refresh = () => {
    if (!current) return
    try {
      ensure(current)
    } catch {
      /* the style is still loading: styledata adds it */
    }
  }
  refreshSoon = refresh
  onEachMap((map) => {
    current = map
    if (map.isStyleLoaded()) refresh()
    map.on('styledata', () => {
      if (!map.getSource(SRC)) refresh()
    })
    map.on('click', 'windchecks-hit', (e) => {
      const id = e.features?.[0]?.properties?.id as string | undefined
      if (id) showCheckPopup(map, id)
    })
    map.on('mouseenter', 'windchecks-hit', () => (map.getCanvas().style.cursor = 'pointer'))
    map.on('mouseleave', 'windchecks-hit', () => (map.getCanvas().style.cursor = ''))
  })
  useWindChecks.subscribe((s, p) => {
    if (s.checks !== p.checks) refresh()
  })
  useAppStore.subscribe((s, p) => {
    if (s.planTimeMs !== p.planTimeMs || markShown(s, 'wind') !== markShown(p, 'wind')) refresh()
  })
  // at "now" the rings shrink with the clock, a minute at a time
  window.setInterval(() => {
    if (document.visibilityState === 'visible' && !replay && useAppStore.getState().planTimeMs == null && (drawn || checksInEffect().length)) refresh()
  }, 60_000)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refresh()
  })
}
