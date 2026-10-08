/**
 * The Spots layer on the map: a heat image over the region for the chosen
 * target at the planning time, and the best few spots as numbered pins
 * (tap one: Dig in). Recomputes when the target, the hour, the forecast
 * or the selected place changes, and after a weather refresh; the scorer
 * runs in well under a frame for the whole grid. The week's windows and
 * the hour bars under the strip are scored here too, grid or no grid.
 */
import { dayPlans, hourScores } from './dayPlan'
import type { CanvasSource, GeoJSONSource, Map as MlMap } from 'maplibre-gl'
import type { FeatureCollection } from 'geojson'
import { inRegion, REGION, SPOTS_RADIUS_M } from '../config'
import { trackTime } from '../analytics'
import { devlog } from '../devlog'
import { initDigInMarker } from '../map/diginMarker'
import { getMap, onEachMap, onFirstIdle, withMap } from '../map/mapController'
import { useMeasureStore } from '../measure/measureStore'
import { useRoutes } from '../routes/routeStore'
import { useAppStore } from '../state/appStore'
import { areaPlaces, homePlace, selectedPlace, usePlacesStore } from '../state/placesStore'
import { useSpotsStore } from '../state/spotsStore'
import { useGpsStore } from '../tracking/gpsStore'
import { useHuntLog } from '../log/huntLog'
import { cachedPointForecast, pointForecast, type PointForecast } from '../weather/openMeteo'
import { onWeatherRefreshed, onWeatherStatus, weatherStatus } from '../weather/refresh'
import { cachedRecentDaily, deriveConditions, recentDailyMeans } from './conditions'
import { habitat, loadHabitat, onHabitat, COVER, type Habitat } from './habitatGrid'
import { huntPass, huntResult, huntRows, scoreTarget, warmHuntBands, type HuntPass, type ScoreResult } from './scoring'
import { loadMicro, loadRestOfMicro, microBaseReady, microReadyFor, onMicro } from '../weather/micro/model'
import { useScent } from '../weather/micro/scent'
import { currentProfile, ensureProfile, onProfile } from '../weather/boundaryLayer'
import { useWindChecks } from '../weather/micro/windChecks'
import { isFish, type HuntTarget } from './types'

const HEAT_SRC = 'spots-heat'
const PINS_SRC = 'spots-pins'
let canvas: HTMLCanvasElement | null = null
/** The window the heat canvas is placed over (paint), as its rows and columns. */
let placedAt: string | null = null
/** Heat pixels per grid cell: the canvas is drawn at this multiple and the
 *  cells feathered into each other, so the 30 m lattice does not read as
 *  a staircase. */
const UP = 3
let timer: number | null = null

/** The closest saved place that has a forecast on the phone, in the area
 *  the app is in: another area's weather never stands in for this one's. */
function nearestCachedPlace(lon: number, lat: number): { p: { lon: number; lat: number; name: string }; f: PointForecast } | null {
  let best: { p: { lon: number; lat: number; name: string }; f: PointForecast; d: number } | null = null
  for (const p of areaPlaces()) {
    const f = cachedPointForecast(p.lon, p.lat)
    if (!f) continue
    const d = Math.hypot((p.lon - lon) * Math.cos((lat * Math.PI) / 180), p.lat - lat)
    if (!best || d < best.d) best = { p, f, d }
  }
  return best
}

function subject(): { lon: number; lat: number; name: string } {
  const sel = selectedPlace()
  if (sel) return sel
  const fix = useGpsStore.getState().fix
  // a fix far from the region is the phone at home: the search stays at camp
  if (fix && inRegion(fix.lon, fix.lat)) return { lon: fix.lon, lat: fix.lat, name: 'here' }
  return homePlace()
}

function ensureSources(m: MlMap) {
  if (m.getSource(HEAT_SRC)) return
  const h = habitat()
  if (!h) return
  // a blank pixel over the region until the first paint sizes the canvas to its window and places it
  canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  placedAt = null
  const east = h.west + h.cols * h.dLon
  const south = h.north - h.rows * h.dLat
  m.addSource(HEAT_SRC, {
    type: 'canvas',
    canvas,
    animate: false,
    coordinates: [
      [h.west, h.north],
      [east, h.north],
      [east, south],
      [h.west, south],
    ],
  })
  // The heat goes under the LiDAR shade (transparent where flat) so the
  // relief shows through the hot patches, and under the contours and every
  // line and label; the pins ride on top, under the places.
  const heatBefore = (['hillshade-lidar', 'topo', 'historical', 'pins-halo'] as const).find((id) => m.getLayer(id))
  const before = m.getLayer('pins-halo') ? 'pins-halo' : undefined
  m.addLayer({ id: 'spots-heat', type: 'raster', source: HEAT_SRC, paint: { 'raster-opacity': 0.8, 'raster-resampling': 'linear', 'raster-fade-duration': 0 } }, heatBefore)
  m.addSource(PINS_SRC, { type: 'geojson', data: empty() })
  if (!m.hasImage('spot-pin')) m.addImage('spot-pin', pinImage(), { pixelRatio: 2 })
  m.addLayer(
    {
      id: 'spots-pin-glow',
      type: 'circle',
      source: PINS_SRC,
      paint: { 'circle-radius': ['case', ['==', ['get', 'n'], 1], 16, 12], 'circle-color': 'rgba(255,196,0,0.18)', 'circle-blur': 0.6 },
    },
    before,
  )
  m.addLayer(
    {
      id: 'spots-pin',
      type: 'symbol',
      source: PINS_SRC,
      layout: {
        'icon-image': 'spot-pin',
        'icon-size': ['case', ['==', ['get', 'n'], 1], 1.15, 0.95],
        'icon-anchor': 'bottom',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'symbol-sort-key': ['get', 'n'],
        // the rank sits in the head of the pin
        'text-field': ['to-string', ['get', 'n']],
        'text-font': ['Noto Sans Medium'],
        'text-size': ['case', ['==', ['get', 'n'], 1], 12.5, 11],
        'text-anchor': 'center',
        'text-offset': ['case', ['==', ['get', 'n'], 1], ['literal', [0, -1.55]], ['literal', [0, -1.5]]],
        'text-allow-overlap': true,
        'text-ignore-placement': true,
      },
      paint: { 'text-color': '#1a1200' },
    },
    before,
  )
  m.addLayer(
    {
      id: 'spots-pin-score',
      type: 'symbol',
      source: PINS_SRC,
      minzoom: 12,
      layout: {
        'text-field': ['to-string', ['get', 'score']],
        'text-font': ['Noto Sans Medium'],
        'text-size': 10.5,
        'text-anchor': 'left',
        'text-offset': [1.2, -1.5],
        'text-optional': true,
      },
      paint: { 'text-color': '#ffd166', 'text-halo-color': 'rgba(10,20,12,0.95)', 'text-halo-width': 1.3 },
    },
    before,
  )
  // a numbered pin: Dig in on it (MapView keeps its popup off the pin)
  m.on('click', 'spots-pin', (e) => {
    // the ruler, a person being placed and the route card each own the tap
    if (useMeasureStore.getState().active || useScent.getState().adding || useRoutes.getState().open) return
    const n = e.features?.[0]?.properties?.n as number | undefined
    if (n == null) return
    const sp = useSpotsStore.getState().result?.spots[n - 1]
    if (!sp) return
    useAppStore.getState().openSheet({ kind: 'digin', lon: sp.lon, lat: sp.lat })
  })
  m.on('mouseenter', 'spots-pin', () => (m.getCanvas().style.cursor = 'pointer'))
  m.on('mouseleave', 'spots-pin', () => (m.getCanvas().style.cursor = ''))
}

/** A teardrop marker, 22×30 css px, drawn at 2×: amber head, dark rim,
 *  a soft shadow under the point. */
function pinImage(): ImageData {
  const S = 2
  const w = 22 * S
  const h = 30 * S
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  // drawn on the CPU: read back from a GPU canvas, a marker this small
  // waited on everything the map had queued (some 50 ms on a phone's launch)
  const g = c.getContext('2d', { willReadFrequently: true })!
  g.scale(S, S)
  const cx = 11
  const cy = 10
  const r = 8.5
  const tip = 29
  const teardrop = () => {
    // head circle joined to the tip by two tangents
    const a = Math.asin(r / (tip - cy))
    g.beginPath()
    g.arc(cx, cy, r, Math.PI / 2 + a, Math.PI / 2 - a + Math.PI * 2)
    g.lineTo(cx, tip)
    g.closePath()
  }
  g.save()
  g.shadowColor = 'rgba(0,0,0,0.45)'
  g.shadowBlur = 3
  g.shadowOffsetY = 1
  g.fillStyle = '#1a1200'
  teardrop()
  g.fill()
  g.restore()
  teardrop()
  g.fillStyle = '#ffc400'
  g.fill()
  g.lineWidth = 1.5
  g.strokeStyle = '#1a1200'
  g.stroke()
  // a lighter inner disc for the rank to sit on
  g.beginPath()
  g.arc(cx, cy, r - 2.2, 0, Math.PI * 2)
  g.fillStyle = '#ffe08a'
  g.fill()
  return g.getImageData(0, 0, w, h)
}

function empty(): FeatureCollection {
  return { type: 'FeatureCollection', features: [] }
}

/** Three heat bands (good · better · best) in amber, orange and red, with
 *  a thin dark edge at each step so the map reads like contours: the eye
 *  finds a peak by its rings. Inside the search radius everything that is
 *  not hot gets a faint dark wash, so the hot patches stand out without
 *  being painted more opaque. Nothing shows past the radius around
 *  `near`, so the map says the same thing as the list.
 *  Per-cell coverage, tone and wash are worked out on the 30 m grid, then
 *  the canvas is filled at UP× with bilinear blends between cell centres
 *  and the bands cut from the blended field: smooth iso-lines, not
 *  stair-steps, and the water line only ever feathers by one cell. */
const BAND_ALPHA = [0, 0.4, 0.62, 0.86]
/** The fixed scale: scores under this are wash; the ramp runs from here over the span. */
const FIXED_LO = 0.45
const FIXED_SPAN = 0.45
/** The day's scale: wash below the median of the cells in the radius, the
 *  ramp from there to the 97th percentile. Only used when the day has a
 *  range worth showing. */
const DAY_LO_Q = 0.5
const DAY_HI_Q = 0.97
const DAY_MIN_SPAN = 0.06
const BAND_RGB: [number, number, number][] = [
  [0, 0, 0],
  [255, 214, 90],
  [255, 140, 40],
  [235, 45, 25],
]
const WASH_RGB = [8, 16, 10]
const WASH_ALPHA = 0.32
const EDGE_DARKEN = 0.5

/** In-place 3×3 tent smooth (1-2-1) of `f`, only ever mixing cells of the
 *  wanted class (water or not), with the weights renormalised so a cell
 *  next to the other class keeps its value. */
function smooth(f: Float32Array, cover: Uint8Array, water: boolean, cols: number, rows: number, r0: number, r1: number, c0: number, c1: number) {
  const src = Float32Array.from(f)
  const K = [1, 2, 1]
  for (let r = r0; r < r1; r++) {
    for (let c = c0; c < c1; c++) {
      const i = r * cols + c
      if ((cover[i] === COVER.water) !== water) continue
      let acc = 0
      let wsum = 0
      for (let dr = -1; dr <= 1; dr++) {
        const rr = r + dr
        if (rr < 0 || rr >= rows) continue
        for (let dc = -1; dc <= 1; dc++) {
          const cc = c + dc
          if (cc < 0 || cc >= cols) continue
          const j = rr * cols + cc
          if ((cover[j] === COVER.water) !== water) continue
          const w = K[dr + 1] * K[dc + 1]
          acc += src[j] * w
          wsum += w
        }
      }
      f[i] = wsum ? acc / wsum : src[i]
    }
  }
}

/** What paint last drew, so a change to the colouring repaints without a scoring pass. */
let lastPaint: { scores: Float32Array | null; water: boolean; near: { lon: number; lat: number } } | null = null

function repaint() {
  if (lastPaint) paint(lastPaint.scores, lastPaint.water, lastPaint.near)
}

/** The wash line and the ramp over it for this paint: the fixed scale, or
 *  the day's own among the cells that will show. */
function heatRange(scores: Float32Array, cells: number[]): { lo: number; span: number } {
  if (useSpotsStore.getState().heatScale !== 'day' || cells.length < 50) return { lo: FIXED_LO, span: FIXED_SPAN }
  const vals = Float32Array.from(cells, (i) => scores[i]).sort()
  const q = (p: number) => vals[Math.min(vals.length - 1, Math.floor(p * (vals.length - 1)))]
  const lo = q(DAY_LO_Q)
  const span = q(DAY_HI_Q) - lo
  return span >= DAY_MIN_SPAN ? { lo, span } : { lo: FIXED_LO, span: FIXED_SPAN }
}

/** The heat canvas's window as its corners, west-north first and clockwise. */
function windowCorners(h: Habitat, wr0: number, wr1: number, wc0: number, wc1: number): [[number, number], [number, number], [number, number], [number, number]] {
  const west = h.west + wc0 * h.dLon
  const east = h.west + wc1 * h.dLon
  const north = h.north - wr0 * h.dLat
  const south = h.north - wr1 * h.dLat
  return [
    [west, north],
    [east, north],
    [east, south],
    [west, south],
  ]
}

function paint(scores: Float32Array | null, water: boolean, near: { lon: number; lat: number }) {
  lastPaint = { scores, water, near }
  const h = habitat()
  if (!canvas || !h) return
  const { cols, rows } = h
  // the painted window: nothing shows past a third beyond the radius, so
  // only those cells (and their pixels) are worked, not the whole region
  const ni = h.index(near.lon, near.lat)
  const [nr, nc] = ni >= 0 ? h.rc(ni) : [rows >> 1, cols >> 1]
  const rx = SPOTS_RADIUS_M / h.cellM[0]
  const ry = SPOTS_RADIUS_M / h.cellM[1]
  const PAD = 2 // room for the smooth
  const wr0 = Math.max(0, Math.floor(nr - 1.34 * ry) - PAD)
  const wr1 = Math.min(rows, Math.ceil(nr + 1.34 * ry) + PAD + 1)
  const wc0 = Math.max(0, Math.floor(nc - 1.34 * rx) - PAD)
  const wc1 = Math.min(cols, Math.ceil(nc + 1.34 * rx) + PAD + 1)
  const px0 = wc0 * UP
  const py0 = wr0 * UP
  const pw = (wc1 - wc0) * UP
  const ph = (wr1 - wr0) * UP
  // The canvas is the window, placed over it on the map, not the whole
  // region: the region at UP× was 12 MB of pixels to fill and send to the
  // GPU on every paint (two a scoring pass) and some 40 MB of buffers,
  // nearly all of them blank. The window is under a quarter of that.
  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width = pw
    canvas.height = ph
  }
  const ctx = canvas.getContext('2d')!
  ctx.clearRect(0, 0, pw, ph)
  const m = getMap()
  const src = m?.getSource(HEAT_SRC) as (CanvasSource & { play?: () => void; pause?: () => void }) | undefined
  const at = `${wr0},${wr1},${wc0},${wc1}`
  if (src && placedAt !== at) {
    src.setCoordinates(windowCorners(h, wr0, wr1, wc0, wc1))
    placedAt = at
  }
  const img = ctx.createImageData(pw, ph)
  const d = img.data
  if (scores) {
    // per cell: heat coverage (0..1, the radius fade), tone along the ramp, wash coverage
    const cov = new Float32Array(cols * rows)
    const tone = new Float32Array(cols * rows)
    const wash = new Float32Array(cols * rows)
    const cover = h.raw('cover') as Uint8Array
    const fades = new Float32Array(cols * rows)
    const cells: number[] = []
    for (let r = wr0; r < wr1; r++)
      for (let c = wc0; c < wc1; c++) {
        const i = r * cols + c
        const isWater = cover[i] === COVER.water
        if (isWater !== water) continue
        // 1 inside the radius, gone by a third past it
        const dist = Math.sqrt(((r - nr) / ry) ** 2 + ((c - nc) / rx) ** 2)
        const fade = dist <= 1 ? 1 : Math.max(0, 1 - (dist - 1) * 3)
        if (fade <= 0) continue
        fades[i] = fade
        if (dist <= 1) cells.push(i)
      }
    // only the top of the range lights up: a heat map that covers the bush
    // says nothing. The range is the day's own or the fixed scale (heatRange).
    const { lo, span } = heatRange(scores, cells)
    for (let r = wr0; r < wr1; r++)
      for (let c = wc0; c < wc1; c++) {
        const i = r * cols + c
        const fade = fades[i]
        if (fade <= 0) continue
        const s = scores[i]
        if (s < lo) {
          wash[i] = fade
          continue
        }
        cov[i] = fade
        tone[i] = Math.min(1, (s - lo) / span)
      }
    // a light 3×3 smooth of coverage and wash among same-class cells, so
    // the 30 m lattice does not read as stair-steps at low zoom; water and
    // land never blend, and tone is left alone so the bands stay honest
    // tone rides on coverage so an off cell never pulls a neighbour's colour down
    for (let i = 0; i < tone.length; i++) tone[i] *= cov[i]
    for (let k = 0; k < 2; k++) {
      smooth(tone, cover, water, cols, rows, wr0, wr1, wc0, wc1)
      smooth(cov, cover, water, cols, rows, wr0, wr1, wc0, wc1)
      smooth(wash, cover, water, cols, rows, wr0, wr1, wc0, wc1)
    }
    for (let i = 0; i < tone.length; i++) tone[i] = cov[i] > 1e-4 ? tone[i] / cov[i] : 0
    // canvas pixels from here on: (x, y) in the window, px0/py0 its offset in the region's
    const level = new Uint8Array(pw * ph)
    const cova = new Float32Array(pw * ph)
    const bold = useSpotsStore.getState().heatStrength
    for (let y = 0; y < ph; y++) {
      const fy = (py0 + y + 0.5) / UP - 0.5
      const r0 = Math.max(0, Math.min(rows - 1, Math.floor(fy)))
      const r1 = Math.min(rows - 1, r0 + 1)
      const wy = Math.max(0, Math.min(1, fy - r0))
      for (let x = 0; x < pw; x++) {
        const fx = (px0 + x + 0.5) / UP - 0.5
        const c0 = Math.max(0, Math.min(cols - 1, Math.floor(fx)))
        const c1 = Math.min(cols - 1, c0 + 1)
        const wx = Math.max(0, Math.min(1, fx - c0))
        const i00 = r0 * cols + c0
        const i01 = r0 * cols + c1
        const i10 = r1 * cols + c0
        const i11 = r1 * cols + c1
        const w00 = (1 - wx) * (1 - wy)
        const w01 = wx * (1 - wy)
        const w10 = (1 - wx) * wy
        const w11 = wx * wy
        const a = cov[i00] * w00 + cov[i01] * w01 + cov[i10] * w10 + cov[i11] * w11
        const w = wash[i00] * w00 + wash[i01] * w01 + wash[i10] * w10 + wash[i11] * w11
        const p = y * pw + x
        if (a > 0.002) {
          // tone weighted by coverage so an off neighbour feathers the edge without pulling the colour to amber
          const t = (tone[i00] * cov[i00] * w00 + tone[i01] * cov[i01] * w01 + tone[i10] * cov[i10] * w10 + tone[i11] * cov[i11] * w11) / a
          level[p] = t < 0.33 ? 1 : t < 0.66 ? 2 : 3
          cova[p] = a
        }
        // heat over wash
        const ha = level[p] ? Math.min(0.95, BAND_ALPHA[level[p]] * bold) * a : 0
        const wa = w * WASH_ALPHA * (1 - ha)
        const oa = ha + wa
        if (oa <= 0.002) continue
        const rgb = BAND_RGB[level[p]]
        const o = p * 4
        d[o] = (rgb[0] * ha + WASH_RGB[0] * wa) / oa
        d[o + 1] = (rgb[1] * ha + WASH_RGB[1] * wa) / oa
        d[o + 2] = (rgb[2] * ha + WASH_RGB[2] * wa) / oa
        d[o + 3] = Math.round(255 * oa)
      }
    }
    // a dark line where a band steps up to the next (the higher side), one canvas pixel wide
    // (the window's own border is past the radius's fade: never a band there)
    for (let y = 1; y < ph - 1; y++) {
      for (let x = 1; x < pw - 1; x++) {
        const p = y * pw + x
        const l = level[p]
        if (!l) continue
        if (level[p - 1] < l || level[p - pw] < l || level[p + 1] < l || level[p + pw] < l) {
          const o = p * 4
          d[o] *= EDGE_DARKEN
          d[o + 1] *= EDGE_DARKEN
          d[o + 2] *= EDGE_DARKEN
          d[o + 3] = Math.round(255 * Math.max(d[o + 3] / 255, 0.7 * cova[p]))
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0)
  // a canvas source with animate:false needs a nudge to re-read
  src?.play?.()
  requestAnimationFrame(() => src?.pause?.())
}

function pins(m: MlMap) {
  const r = useSpotsStore.getState().result
  const src = m.getSource(PINS_SRC) as GeoJSONSource | undefined
  if (!src) return
  src.setData({
    type: 'FeatureCollection',
    features: (r?.spots ?? []).map((s, k) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [s.lon, s.lat] }, properties: { n: k + 1, title: s.title, score: Math.round(s.score * 100) } })),
  })
}

async function recompute() {
  // What a pass needs, first. It waits only for what the phone has never
  // had: a forecast, the ten-day means, the habitat grid, the ground wind,
  // the air's profile. Means and a profile it does hold it takes however
  // old, and the weather sweep's fresh ones ask again as they land: a stale
  // profile once held the heat map for a whole fetch timeout on weak signal.
  const subj0 = subject()
  if (!cachedPointForecast(subj0.lon, subj0.lat) && navigator.onLine) await pointForecast(subj0.lon, subj0.lat).catch(() => null)
  if (!cachedRecentDaily(subj0.lon, subj0.lat)) await recentDailyMeans(subj0.lon, subj0.lat)
  // the wind grid's base bands first, the habitat grid after them (warmStart
  // keeps that order on the line); the site rules read the ground wind and
  // the wind profile, and with either still on its way the whole pass would
  // only be done again when it lands
  await microBaseReady()
  const h = await loadHabitat()
  if (h) {
    // and the two momentum directions the hour's wind sits between (the grid
    // comes in stages), for the same reason
    await microReadyFor(useAppStore.getState().planTimeMs ?? Date.now())
    if (currentProfile()) void ensureProfile()
    else await ensureProfile()
  }
  // Then every input at once, after the waiting: a change made meanwhile
  // (the quarry, the time, the place) is in this pass, not lost behind it
  const s = useSpotsStore.getState()
  const subj = subject()
  const app = useAppStore.getState()
  const timeMs = app.planTimeMs ?? Date.now()
  let f = cachedPointForecast(subj.lon, subj.lat)
  // no signal and a subject with no cache of its own (the phone, moving):
  // the nearest saved place's forecast stands in; HRDPS cells are 2.5 km
  let recentAt = subj
  if (!f) {
    const near = nearestCachedPlace(subj.lon, subj.lat)
    if (near) {
      f = near.f
      recentAt = near.p
    }
  }
  const recent = cachedRecentDaily(recentAt.lon, recentAt.lat)
  const c = f ? deriveConditions(f, timeMs, recent) : null
  if (!f || !c) {
    s.setHours([])
    return s.setResult(null, null, 'no-forecast')
  }
  // the week's windows and the hour bars need only the forecast: with no
  // habitat grid the strip still says when, if not where
  if (!h) {
    const plans = dayPlans(f, s.target, recent, null, s.weights)
    s.setHours(hourScores(f, s.target, recent, null, s.weights, Date.now()))
    return s.setResult(null, c, 'no-grid', plans)
  }
  // the loads above tell their listeners, and every listener asks for a
  // pass: this one has already read what they brought, so the asks since
  // the last pass read its inputs are what counts, not the asks since it
  // was scheduled
  if (inputsGen === scoredGen) return
  scoredGen = inputsGen
  const gen = ++passGen
  const m = getMap()
  // the first pass sets up the heat's layers and the bands' tables (the
  // bush's light, a pass over every cell), each its own turn: in one, with
  // the first strip, they were a quarter second just after the wind started
  if (m && !m.getSource(HEAT_SRC)) {
    ensureSources(m)
    await nextTurn()
    if (gen !== passGen) return
  }
  if (!isFish(s.target) && warmHuntBands()) {
    await nextTurn()
    if (gen !== passGen) return
  }
  const t0 = performance.now()
  let work = 0
  let res: ScoreResult | null
  if (isFish(s.target)) {
    res = scoreTarget(s.target, c, subj, s.weights)
    work = performance.now() - t0
  } else {
    // A hunt pass is a second on a phone just after launch: run it in
    // slices of rows and give the map its frames between, and with the
    // heat on paint a rough copy (every other cell, a quarter of the work)
    // first, so the heat shows at once and sharpens when the pass is done.
    // A newer pass ends this one at its next strip.
    const p = huntPass(s.target as HuntTarget, c, subj, s.weights)
    if (!p) res = null
    else {
      const [r0, r1] = p.win
      const spent = { ms: 0 }
      if (s.heat) {
        // the rough copy goes in slices too: a quarter of the work was still
        // a quarter second in one block on a phone, just as the streaks start
        const rough: HuntPass = { ...p, scores: new Float32Array(p.scores.length) }
        if (!(await slicedRows(rough, r0, r1, 2, gen, spent))) return
        const t = performance.now()
        paint(rough.scores, false, subj)
        spent.ms += performance.now() - t
        await nextTurn()
        if (gen !== passGen) return
      }
      if (!(await slicedRows(p, r0, r1, 1, gen, spent))) return
      work += spent.ms
      const t = performance.now()
      res = huntResult(p)
      work += performance.now() - t
    }
  }
  // the week and the hours from the same forecast, scored with the lake the verdict is about
  const lake = res?.lakeId ? h.lake(res.lakeId) ?? null : null
  const plans = dayPlans(f, s.target, recent, lake, s.weights)
  s.setHours(hourScores(f, s.target, recent, lake, s.weights, Date.now()))
  devlog('spots', `${s.target} scored in ${work.toFixed(0)} ms of work, ${(performance.now() - t0).toFixed(0)} ms in all · ${res?.spots.length ?? 0} spots · ${res?.verdict.headline ?? ''}`)
  s.setResult(res, c, 'ready', plans)
  trackTime('heat_scored')
  // the first view is up: the rest of the wind grid can come, behind everything else
  void loadRestOfMicro()
  const mm = getMap()
  if (!mm || !mm.getSource(HEAT_SRC)) return
  // the numbered pins follow the heat map
  const visible = s.heat ? 'visible' : 'none'
  for (const id of ['spots-heat', 'spots-pin', 'spots-pin-glow', 'spots-pin-score']) mm.setLayoutProperty(id, 'visibility', visible)
  paint(s.heat ? res?.scores ?? null : null, isFish(s.target), subj)
  pins(mm)
}

/** Until when a scoring pass is held back: the map's first settled frame
 *  (or a moment after a map is made). The grids, the forecast and the
 *  wind profile all land in the first seconds and each asked for a pass,
 *  so the phone scored and painted three to five times, every one of
 *  them a main-thread block of half a second or more while the tiles were
 *  trying to draw. Held, they fold into one pass after the chart is up. */
let holdUntil = 0
/** Counts every ask for a pass; a pass notes the count as it reads its
 *  inputs, and a later ask that finds the count unchanged is a no-op. */
let inputsGen = 0
let scoredGen = -1
/** Counts passes begun: a pass that finds a newer one begun stops at its next strip. */
let passGen = 0
/** A hunt pass gives the browser a turn once a slice of rows has run this
 *  long, checked after every row (two for the rough copy). It was 24 ms
 *  checked every 8 rows, and an 8-row strip alone ran some 60 ms on a phone
 *  just after launch: the streaks, which start then, hitched at every one.
 *  A slice this short leaves the frame the wind and the map need. */
const SLICE_MS = 8
/** Back to the browser for a frame (or a tap) between strips. */
const nextTurn = () => new Promise<void>((r) => window.setTimeout(r, 0))

/** Rows r0..r1 of a pass, `step` at a time, with a turn whenever a slice's
 *  time is spent; the time worked is added to `spent`. False when a newer
 *  pass has begun (this one stops). */
async function slicedRows(p: HuntPass, r0: number, r1: number, step: number, gen: number, spent: { ms: number }): Promise<boolean> {
  let sliceStart = performance.now()
  for (let r = r0; r < r1; r += step) {
    const t = performance.now()
    huntRows(p, r, Math.min(r1, r + step), step)
    const now = performance.now()
    spent.ms += now - t
    if (r + step < r1 && now - sliceStart >= SLICE_MS) {
      await nextTurn()
      if (gen !== passGen) return false
      sliceStart = performance.now()
    }
  }
  return true
}
/** Data asks that came in while a weather sweep ran, folded into one pass at its end. */
let heldForSweep = false

/** A pass, soon. `data`: the ask is data landing (a grid, a forecast, the
 *  air's profile), not the hunter changing something. */
function schedule(data = false) {
  inputsGen++
  // A weather sweep lands the forecasts, the wind field and the profile one
  // after another, each an ask: just after launch on a phone that was five
  // passes of a second each in twelve seconds (devlog, 2026-10-05). Once
  // the map has a pass to show, data asks during a sweep wait for its end
  // and fold into one; the hunter's own (the quarry, the time, a pin) don't
  if (data && scoredGen >= 0 && weatherStatus().busy) {
    heldForSweep = true
    return
  }
  if (timer != null) clearTimeout(timer)
  timer = window.setTimeout(
    () => {
      timer = null
      void recompute()
    },
    Math.max(120, holdUntil - performance.now()),
  )
}

let wired = false
export function initSpotsLayer() {
  if (wired) return
  wired = true
  // the white ring on the point Dig in is open on
  initDigInMarker()
  onEachMap((m) => {
    m.once('remove', () => {
      canvas = null
    })
    if (habitat()) ensureSources(m)
    holdUntil = performance.now() + 2500
    onFirstIdle(m, () => {
      holdUntil = 0
      // a pass waiting on the hold runs now, not at the hold's end
      if (timer != null) schedule()
    })
    schedule()
  })
  withMap(() => {
    onHabitat(() => schedule(true))
    // the site rules read the ground wind: rescore when it arrives
    void loadMicro()
    onMicro(() => schedule(true))
    onProfile(() => schedule(true))
    useWindChecks.subscribe(() => schedule())
    // a fresh forecast: the map rescores itself
    onWeatherRefreshed(() => schedule(true))
    // the sweep is done: the asks it held, as one pass
    onWeatherStatus(() => {
      if (heldForSweep && !weatherStatus().busy) {
        heldForSweep = false
        schedule()
      }
    })
    useSpotsStore.subscribe((s, prev) => {
      if (s.target !== prev.target || s.heat !== prev.heat || s.weights !== prev.weights) schedule()
      // the colouring alone changed: the same scores, painted again
      else if (s.heatScale !== prev.heatScale || s.heatStrength !== prev.heatStrength) repaint()
    })
    useAppStore.subscribe((s, prev) => {
      if (s.planTimeMs !== prev.planTimeMs) schedule()
      else if (s.online !== prev.online) schedule(true)
    })
    usePlacesStore.subscribe((s, prev) => {
      if (s.selectedId !== prev.selectedId) schedule()
      else if (s.places !== prev.places && s.selectedId) {
        const a = s.places.find((p) => p.id === s.selectedId)
        const b = prev.places.find((p) => p.id === s.selectedId)
        if (a && b && (a.lon !== b.lon || a.lat !== b.lat)) schedule()
      }
    })
    useGpsStore.subscribe((s, prev) => {
      const near = (f: { lon: number; lat: number } | null) => !!f && inRegion(f.lon, f.lat)
      if (near(s.fix) !== near(prev.fix) && !selectedPlace()) schedule()
    })
    // a sighting or a blank sit logged: the map leans toward it
    useHuntLog.subscribe((s, prev) => {
      if (s.entries !== prev.entries) schedule()
    })
    // the hour turns over
    const tick = () => {
      const now = Date.now()
      window.setTimeout(() => {
        if (useAppStore.getState().planTimeMs == null) schedule(true)
        tick()
      }, 3600_000 - (now % 3600_000) + 3000)
    }
    tick()
  })
}

export const SPOTS_REGION = REGION
