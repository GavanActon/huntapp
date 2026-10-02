/**
 * The Spots layer on the map: a heat image over the region for the chosen
 * target at the planning time, and the best few spots as numbered pins
 * (tap one: Dig in). Recomputes when the target, the hour, the forecast
 * or the selected place changes, and after a weather refresh; the scorer
 * runs in well under a frame for the whole grid. The week's windows and
 * the hour bars under the strip are scored here too, grid or no grid.
 */
import { dayPlans, hourScores } from './dayPlan'
import type { GeoJSONSource, ImageSource, Map as MlMap } from 'maplibre-gl'
import type { FeatureCollection } from 'geojson'
import { inRegion, REGION, SPOTS_RADIUS_M } from '../config'
import { devlog } from '../devlog'
import { initDigInMarker } from '../map/diginMarker'
import { getMap, onEachMap, onFirstIdle, withMap } from '../map/mapController'
import { useMeasureStore } from '../measure/measureStore'
import { useRoutes } from '../routes/routeStore'
import { useAppStore } from '../state/appStore'
import { homePlace, selectedPlace, usePlacesStore } from '../state/placesStore'
import { useSpotsStore } from '../state/spotsStore'
import { useGpsStore } from '../tracking/gpsStore'
import { useHuntLog } from '../log/huntLog'
import { cachedPointForecast, pointForecast, type PointForecast } from '../weather/openMeteo'
import { onWeatherRefreshed } from '../weather/refresh'
import { deriveConditions, recentDailyMeans } from './conditions'
import { habitat, loadHabitat, onHabitat, COVER } from './habitatGrid'
import { scoreTarget } from './scoring'
import { loadMicro, onMicro } from '../weather/micro/model'
import { useScent } from '../weather/micro/scent'
import { ensureProfile, onProfile } from '../weather/boundaryLayer'
import { useWindChecks } from '../weather/micro/windChecks'
import { isFish } from './types'

const HEAT_SRC = 'spots-heat'
const PINS_SRC = 'spots-pins'
let canvas: HTMLCanvasElement | null = null
/** Heat pixels per grid cell: the canvas is drawn at this multiple and the
 *  cells feathered into each other, so the 30 m lattice does not read as
 *  a staircase. */
const UP = 3
let timer: number | null = null

/** The closest saved place that has a forecast on the phone. */
function nearestCachedPlace(lon: number, lat: number): { p: { lon: number; lat: number; name: string }; f: PointForecast } | null {
  let best: { p: { lon: number; lat: number; name: string }; f: PointForecast; d: number } | null = null
  for (const p of usePlacesStore.getState().places) {
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
  canvas = document.createElement('canvas')
  canvas.width = h.cols * UP
  canvas.height = h.rows * UP
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
  const g = c.getContext('2d')!
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
const BAND_ALPHA = [0, 0.32, 0.55, 0.82]
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

function paint(scores: Float32Array | null, water: boolean, near: { lon: number; lat: number }) {
  const h = habitat()
  if (!canvas || !h) return
  const ctx = canvas.getContext('2d')!
  const { cols, rows } = h
  const W = cols * UP
  const H = rows * UP
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
  ctx.clearRect(0, 0, W, H)
  const img = ctx.createImageData(W, H)
  const d = img.data
  if (scores) {
    // per cell: heat coverage (0..1, the radius fade), tone along the ramp, wash coverage
    const cov = new Float32Array(cols * rows)
    const tone = new Float32Array(cols * rows)
    const wash = new Float32Array(cols * rows)
    const cover = h.raw('cover') as Uint8Array
    for (let r = wr0; r < wr1; r++)
      for (let c = wc0; c < wc1; c++) {
        const i = r * cols + c
        const isWater = cover[i] === COVER.water
        if (isWater !== water) continue
        // 1 inside the radius, gone by a third past it
        const dist = Math.sqrt(((r - nr) / ry) ** 2 + ((c - nc) / rx) ** 2)
        const fade = dist <= 1 ? 1 : Math.max(0, 1 - (dist - 1) * 3)
        if (fade <= 0) continue
        const s = scores[i]
        if (s < 0.45) {
          wash[i] = fade
          continue
        }
        // only the top of the range lights up: a heat map that covers the bush says nothing
        cov[i] = fade
        tone[i] = Math.min(1, (s - 0.45) / 0.45)
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
    const level = new Uint8Array(W * H)
    const cova = new Float32Array(W * H)
    for (let y = py0; y < py0 + ph; y++) {
      const fy = (y + 0.5) / UP - 0.5
      const r0 = Math.max(0, Math.min(rows - 1, Math.floor(fy)))
      const r1 = Math.min(rows - 1, r0 + 1)
      const wy = Math.max(0, Math.min(1, fy - r0))
      for (let x = px0; x < px0 + pw; x++) {
        const fx = (x + 0.5) / UP - 0.5
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
        const p = y * W + x
        if (a > 0.002) {
          // tone weighted by coverage so an off neighbour feathers the edge without pulling the colour to amber
          const t = (tone[i00] * cov[i00] * w00 + tone[i01] * cov[i01] * w01 + tone[i10] * cov[i10] * w10 + tone[i11] * cov[i11] * w11) / a
          level[p] = t < 0.33 ? 1 : t < 0.66 ? 2 : 3
          cova[p] = a
        }
        // heat over wash
        const ha = level[p] ? BAND_ALPHA[level[p]] * a : 0
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
    for (let y = Math.max(1, py0); y < Math.min(H - 1, py0 + ph); y++) {
      for (let x = Math.max(1, px0); x < Math.min(W - 1, px0 + pw); x++) {
        const p = y * W + x
        const l = level[p]
        if (!l) continue
        if (level[p - 1] < l || level[p - W] < l || level[p + 1] < l || level[p + W] < l) {
          const o = p * 4
          d[o] *= EDGE_DARKEN
          d[o + 1] *= EDGE_DARKEN
          d[o + 2] *= EDGE_DARKEN
          d[o + 3] = Math.round(255 * Math.max(d[o + 3] / 255, 0.7 * cova[p]))
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0, px0, py0, pw, ph)
  const m = getMap()
  const src = m?.getSource(HEAT_SRC) as (ImageSource & { play?: () => void; pause?: () => void }) | undefined
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
  const s = useSpotsStore.getState()
  const subj = subject()
  const app = useAppStore.getState()
  const timeMs = app.planTimeMs ?? Date.now()
  let f = cachedPointForecast(subj.lon, subj.lat)
  if (!f && navigator.onLine) {
    const r = await pointForecast(subj.lon, subj.lat).catch(() => null)
    f = r?.forecast ?? null
  }
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
  const recent = await recentDailyMeans(recentAt.lon, recentAt.lat)
  const c = f ? deriveConditions(f, timeMs, recent) : null
  if (!f || !c) {
    s.setHours([])
    return s.setResult(null, null, 'no-forecast')
  }
  // the week's windows and the hour bars need only the forecast: with no
  // habitat grid the strip still says when, if not where
  const h = await loadHabitat()
  if (!h) {
    const plans = dayPlans(f, s.target, recent, null, s.weights)
    s.setHours(hourScores(f, s.target, recent, null, s.weights, Date.now()))
    return s.setResult(null, c, 'no-grid', plans)
  }
  // the site rules read the ground wind and the wind profile: with either
  // still on its way the whole pass would only be done again when it
  // lands (both are cached after the first call, and answer at once
  // offline or with no file)
  await loadMicro()
  await ensureProfile()
  // the loads above tell their listeners, and every listener asks for a
  // pass: this one has already read what they brought, so the asks since
  // the last pass read its inputs are what counts, not the asks since it
  // was scheduled
  if (inputsGen === scoredGen) return
  scoredGen = inputsGen
  const m = getMap()
  if (m) ensureSources(m)
  const t0 = performance.now()
  const res = scoreTarget(s.target, c, subj, s.weights)
  // the week and the hours from the same forecast, scored with the lake the verdict is about
  const lake = res?.lakeId ? h.lake(res.lakeId) ?? null : null
  const plans = dayPlans(f, s.target, recent, lake, s.weights)
  s.setHours(hourScores(f, s.target, recent, lake, s.weights, Date.now()))
  devlog('spots', `${s.target} scored in ${(performance.now() - t0).toFixed(0)} ms · ${res?.spots.length ?? 0} spots · ${res?.verdict.headline ?? ''}`)
  s.setResult(res, c, 'ready', plans)
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

function schedule() {
  inputsGen++
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
    onHabitat(() => schedule())
    // the site rules read the ground wind: rescore when it arrives
    void loadMicro()
    onMicro(() => schedule())
    onProfile(() => schedule())
    useWindChecks.subscribe(() => schedule())
    // a fresh forecast: the map rescores itself
    onWeatherRefreshed(() => schedule())
    useSpotsStore.subscribe((s, prev) => {
      if (s.target !== prev.target || s.heat !== prev.heat || s.weights !== prev.weights) schedule()
    })
    useAppStore.subscribe((s, prev) => {
      if (s.planTimeMs !== prev.planTimeMs || s.online !== prev.online) schedule()
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
        if (useAppStore.getState().planTimeMs == null) schedule()
        tick()
      }, 3600_000 - (now % 3600_000) + 3000)
    }
    tick()
  })
}

export const SPOTS_REGION = REGION
