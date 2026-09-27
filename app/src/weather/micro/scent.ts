import type { GeoJSONSource, ImageSource, Map as MlMap } from 'maplibre-gl'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { devlog } from '../../devlog'
import { getMap, onEachMap, withMap } from '../../map/mapController'
import { useAppStore } from '../../state/appStore'
import { compass } from '../openMeteo'
import { onProfile } from '../boundaryLayer'
import { onWeatherGrid } from '../windGrid'
import { groundSampler, groundStability, loadMicro, onMicro } from './model'
import { useWindChecks } from './windChecks'

/**
 * The scent cone: where the hunter's scent goes from a spot during a sit.
 * A Lagrangian particle plume (the method behind every dispersion model
 * from AERMOD's cousins to wildfire smoke) run on the ground-wind field,
 * so it follows drainage into a bog, turns along a valley, and stalls in
 * a pool, rather than drawing a straight line down the forecast wind:
 *
 *   - particles released steadily for 10 minutes, followed for 15;
 *   - each moves with the local ground wind where it is, plus turbulent
 *     gusts (a Langevin walk, Lagrangian time scale 20 s) whose size grows
 *     with the wind and the direction spread;
 *   - the whole plume meanders: the mean direction wanders with the local
 *     sigma on a ~2.5 min time scale, in six independent realisations, so
 *     the picture is the chance scent reaches a place, not one guess;
 *   - each particle is also a puff that mixes upward as it travels
 *     (Briggs rural σz for the hour's stability, reflected at the ground,
 *     the particle–puff hybrid HYSPLIT uses), and counts only for what is
 *     left at a deer's nose. Scent thins fast by day and hugs the ground
 *     on a still night.
 *
 * The map shades nose-height scent against the plume core 20–40 m out:
 * strong, noticeable, and a faint trace wash below that.
 *
 * Seeded by place and minute: tapping the same spot twice draws the same
 * cone.
 */

export interface Plume {
  lon: number
  lat: number
  ms: number
  /** share of nose-height scent by sector, N, NE … NW (beyond 25 m) */
  sectors: number[]
  /** farthest distance scent is still noticeable (≥ NOTICE of the 30 m core), m */
  reach: number
  /** nearest distance scent is noticeable at nose height, m (0 on the ground; farther out from a stand) */
  landing: number
  /** the noticeable plume runs off the 700 m grid */
  beyond: boolean
  /** strongest sector, bearing scent goes TOWARD */
  mainToward: number
  mainShare: number
  /** the source sits in near calm: it spreads every way */
  calm: boolean
  /** the air is decoupled-stable: scent hugs the ground */
  stable: boolean
  /** release height, m: 1.5 on the ground, higher in a tree stand */
  height: number
}

/** Each particle's path, metres east/north of the source, for the particle view. */
export interface PlumeTracks {
  /** steps per track (the sit's whole 15 minutes) */
  steps: number
  x: Float32Array
  y: Float32Array
  /** first and last step each particle is alive */
  k0: Int16Array
  k1: Int16Array
}

const EXTENT_M = 700
const CELL_M = 10
const N = (2 * EXTENT_M) / CELL_M
const RELEASE_S = 600
const TOTAL_S = 900
const DT = 5
const REALISATIONS = 6
const PER_REAL = 120
/** a hunter on the ground gives off scent at about chest height; a deer's nose is near 1 m */
export const GROUND_H = 1.5
const NOSE_H = 1
/** concentration bands, as a share of the plume core 20–40 m out */
const STRONG = 0.2
const NOTICE = 0.04
const TRACE = 0.01

/**
 * Vertical spread σz (m) after x metres of travel: the Briggs (1973)
 * rural curves, neutral D, blended toward stable F on a decoupled night
 * or toward unstable B under sun-driven convection, plus ~1 m for the
 * body's own wake. D at 100 m ≈ 6 m; F ≈ 1.6 m.
 */
function sigmaZ(x: number, stable: number, conv: number): number {
  if (x <= 0) return 1
  const zD = (0.06 * x) / Math.sqrt(1 + 0.0015 * x)
  const zF = (0.016 * x) / (1 + 0.0003 * x)
  const zB = 0.12 * x
  const lerpLog = (a: number, b: number, t: number) => Math.exp(Math.log(a) + (Math.log(b) - Math.log(a)) * t)
  const z = stable >= conv ? lerpLog(zD, zF, stable) : lerpLog(zD, zB, conv)
  return Math.sqrt(1 + z * z)
}

/** Nose-height share of a vertically Gaussian plume released at h m, reflected at the ground. */
function noseShare(sz: number, h: number): number {
  const a = NOSE_H - h
  const b = NOSE_H + h
  const k = 2 * sz * sz
  return (Math.exp((-a * a) / k) + Math.exp((-b * b) / k)) / sz
}
const NOSE0 = noseShare(1, GROUND_H)

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function gauss(rnd: () => number): number {
  const u = Math.max(1e-9, rnd())
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd())
}

/**
 * Run the plume; the nose-height grid (N×N, row 0 north) and its summary.
 * The grid is scaled to the core 20–40 m out of the same sit ON THE GROUND,
 * so a stand's scent reads against what the ground would have given: it
 * starts over the deer's heads and touches down farther out, thinner.
 */
export function simulatePlume(lon: number, lat: number, ms: number, height = GROUND_H): { plume: Plume; grid: Float32Array; tracks: PlumeTracks } | null {
  const sample = groundSampler(ms)
  if (!sample) return null
  const { stable, convective } = groundStability(ms)
  const kx = 111_320 * Math.cos((lat * Math.PI) / 180)
  const ky = 110_574
  const out = new Float32Array(3)
  if (!sample(lon, lat, out)) return null
  const srcSigma = out[2]
  const srcSpeed = Math.hypot(out[0], out[1])
  const rnd = mulberry32(Math.round(lon * 1e4) * 73856093 ^ Math.round(lat * 1e4) * 19349663 ^ Math.round(ms / 60_000))
  const raw = new Float32Array(N * N)
  // the same sit on the ground, for the scale
  const rawGround = height === GROUND_H ? raw : new Float32Array(N * N)
  const sectors = new Float64Array(8)
  const STEPS = Math.ceil(TOTAL_S / DT) + 1
  const NP = REALISATIONS * PER_REAL
  const tracks: PlumeTracks = { steps: STEPS, x: new Float32Array(NP * STEPS), y: new Float32Array(NP * STEPS), k0: new Int16Array(NP), k1: new Int16Array(NP) }
  const TL = 20
  const TM = 150
  for (let r = 0; r < REALISATIONS; r++) {
    // the meander angle through the sit (radians), an OU process
    const steps = Math.ceil(TOTAL_S / DT) + 1
    const phi = new Float32Array(steps)
    const sm = ((srcSigma * 0.8) * Math.PI) / 180
    phi[0] = gauss(rnd) * sm
    for (let k = 1; k < steps; k++) phi[k] = phi[k - 1] * (1 - DT / TM) + sm * Math.sqrt((2 * DT) / TM) * gauss(rnd)
    for (let p = 0; p < PER_REAL; p++) {
      const t0 = rnd() * RELEASE_S
      const id = r * PER_REAL + p
      const base = id * STEPS
      tracks.k0[id] = Math.round(t0 / DT)
      tracks.k1[id] = tracks.k0[id]
      let x = 0
      let y = 0
      let up = 0
      let vp = 0
      // distance travelled, which sets how far the puff has mixed upward
      let path = 0
      for (let t = t0; t < TOTAL_S; t += DT) {
        const k = Math.round(t / DT)
        if (!sample(lon + x / kx, lat + y / ky, out)) break
        const c = Math.cos(phi[k])
        const s = Math.sin(phi[k])
        // rotate the mean wind by the meander (east/north frame, clockwise positive)
        const u = out[0] * c + out[1] * s
        const v = -out[0] * s + out[1] * c
        const spd = Math.hypot(u, v)
        const sigT = 0.1 + 0.35 * spd + 0.25 * spd * Math.sin(Math.min(80, out[2]) * (Math.PI / 180))
        up = up * (1 - DT / TL) + sigT * Math.sqrt((2 * DT) / TL) * gauss(rnd)
        vp = vp * (1 - DT / TL) + sigT * Math.sqrt((2 * DT) / TL) * gauss(rnd)
        x += (u + up) * DT
        y += (v + vp) * DT
        // even in a calm the air stirs a little, so mixing never quite stops
        path += Math.max(0.2, spd) * DT
        const cx = Math.floor((x + EXTENT_M) / CELL_M)
        const cy = Math.floor((EXTENT_M - y) / CELL_M)
        if (cx < 0 || cy < 0 || cx >= N || cy >= N) break
        if (k < STEPS) {
          tracks.x[base + k] = x
          tracks.y[base + k] = y
          tracks.k1[id] = k
        }
        const sz = sigmaZ(path, stable, convective)
        const w = noseShare(sz, height) / NOSE0
        raw[cy * N + cx] += w
        if (rawGround !== raw) rawGround[cy * N + cx] += noseShare(sz, GROUND_H) / NOSE0
        if (Math.hypot(x, y) > 25) {
          const brg = ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360
          sectors[Math.round(brg / 45) % 8] += w
        }
      }
    }
  }
  const grid = blur(raw)
  const ground = rawGround === raw ? grid : blur(rawGround)
  // scale to the ground sit's plume core 20–40 m out, not the spike on the source itself
  const mid = (N - 1) / 2
  let ring = 0
  let max = 0
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const v = ground[y * N + x]
      if (v > max) max = v
      const d = Math.hypot(x - mid, y - mid) * CELL_M
      if (d >= 20 && d <= 40 && v > ring) ring = v
    }
  const ref = ring > 0 ? ring : max
  let reach = 0
  let landing = Infinity
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const i = y * N + x
      grid[i] = ref > 0 ? grid[i] / ref : 0
      if (grid[i] >= NOTICE) {
        const d = Math.hypot(x - mid, y - mid) * CELL_M
        reach = Math.max(reach, d)
        landing = Math.min(landing, d)
      }
    }
  const tot = sectors.reduce((a, b) => a + b, 0) || 1
  const share = Array.from(sectors, (v) => v / tot)
  let main = 0
  for (let k = 1; k < 8; k++) if (share[k] > share[main]) main = k
  return {
    plume: {
      lon,
      lat,
      ms,
      sectors: share,
      reach,
      landing: Number.isFinite(landing) ? landing : 0,
      beyond: reach >= EXTENT_M - 3 * CELL_M,
      mainToward: main * 45,
      mainShare: share[main],
      calm: srcSpeed < 0.25,
      stable: stable > 0.5,
      height,
    },
    grid,
    tracks,
  }
}

/** Light blur so single particle tracks read as a cloud. */
function blur(raw: Float32Array): Float32Array {
  const grid = new Float32Array(N * N)
  for (let y = 1; y < N - 1; y++)
    for (let x = 1; x < N - 1; x++) {
      let s = 0
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += raw[(y + dy) * N + x + dx] * (dx || dy ? 1 : 2)
      grid[y * N + x] = s / 10
    }
  return grid
}

function renderPng(grid: Float32Array): string {
  const c = document.createElement('canvas')
  c.width = N
  c.height = N
  const ctx = c.getContext('2d')!
  const img = ctx.createImageData(N, N)
  const lt = Math.log(TRACE)
  const ln = Math.log(NOTICE)
  const ls = Math.log(STRONG)
  for (let i = 0; i < grid.length; i++) {
    const g = grid[i]
    if (g < TRACE) continue
    const lg = Math.log(g)
    // log steps from a trace to the core, since the nose works on ratios
    const v = Math.min(1, (lg - lt) / -lt)
    // pale amber at a trace, deep orange-red where scent is strong
    img.data[i * 4] = 255
    img.data[i * 4 + 1] = Math.round(200 - 150 * v)
    img.data[i * 4 + 2] = Math.round(90 - 70 * v)
    // a trace is a faint wash; noticeable and up reads clearly
    const a = g >= STRONG ? 0.85 : g >= NOTICE ? 0.4 + (0.45 * (lg - ln)) / (ls - ln) : 0.1 + (0.2 * (lg - lt)) / (ln - lt)
    img.data[i * 4 + 3] = Math.round(255 * a)
  }
  ctx.putImageData(img, 0, 0)
  return c.toDataURL('image/png')
}

// ---------------------------------------------------------------- state and map layer

export type ScentView = 'cloud' | 'particles'
/** Where the hunter sits: on the ground, or a tree stand at 4 or 6 m. */
export const SCENT_HEIGHTS = [GROUND_H, 4, 6] as const

interface ScentState {
  source: { lon: number; lat: number } | null
  plume: Plume | null
  /** the shaded cloud, or particles streaming along their paths */
  view: ScentView
  height: number
  show: (lon: number, lat: number) => void
  clear: () => void
  setView: (v: ScentView) => void
  setHeight: (h: number) => void
}

export const useScent = create<ScentState>()(
  persist(
    (set) => ({
      source: null,
      plume: null,
      view: 'cloud',
      height: GROUND_H,
      show: (lon, lat) => set({ source: { lon, lat } }),
      clear: () => set({ source: null, plume: null }),
      setView: (view) => set({ view }),
      setHeight: (height) => set({ height }),
    }),
    // the choices stick; the cone itself is for this sit only
    { name: 'huntapp-scent', partialize: (s) => ({ view: s.view, height: s.height }) },
  ),
)

const SRC = 'scent-img'
const PT = 'scent-src'

function corners(lon: number, lat: number): [[number, number], [number, number], [number, number], [number, number]] {
  const kx = 111_320 * Math.cos((lat * Math.PI) / 180)
  const ky = 110_574
  const w = lon - EXTENT_M / kx
  const e = lon + EXTENT_M / kx
  const n = lat + EXTENT_M / ky
  const s = lat - EXTENT_M / ky
  return [
    [w, n],
    [e, n],
    [e, s],
    [w, s],
  ]
}

function removeLayers(map: MlMap) {
  for (const id of ['scent-layer', 'scent-src-pt']) if (map.getLayer(id)) map.removeLayer(id)
  for (const id of [SRC, PT]) if (map.getSource(id)) map.removeSource(id)
}

function removeCloud(map: MlMap) {
  if (map.getLayer('scent-layer')) map.removeLayer('scent-layer')
  if (map.getSource(SRC)) map.removeSource(SRC)
}

type PlumeRun = NonNullable<ReturnType<typeof simulatePlume>>

function draw(map: MlMap) {
  const { source, view, height } = useScent.getState()
  if (!source) {
    removeLayers(map)
    particles.stop()
    return
  }
  const ms = useAppStore.getState().planTimeMs ?? Date.now()
  const r = simulatePlume(source.lon, source.lat, ms, height)
  if (!r) {
    removeLayers(map)
    particles.stop()
    useScent.setState({ plume: null })
    return
  }
  if (view === 'cloud') {
    particles.stop()
    const url = renderPng(r.grid)
    const coords = corners(source.lon, source.lat)
    const img = map.getSource(SRC) as ImageSource | undefined
    if (img) img.updateImage({ url, coordinates: coords })
    else {
      map.addSource(SRC, { type: 'image', url, coordinates: coords })
      map.addLayer({ id: 'scent-layer', type: 'raster', source: SRC, paint: { 'raster-opacity': 0.9, 'raster-resampling': 'linear', 'raster-fade-duration': 0 } })
    }
  } else {
    removeCloud(map)
    particles.start(map, source.lon, source.lat, r)
  }
  const pt = { type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: [source.lon, source.lat] }, properties: {} }
  const ps = map.getSource(PT) as GeoJSONSource | undefined
  if (ps) ps.setData(pt)
  else {
    map.addSource(PT, { type: 'geojson', data: pt })
    map.addLayer({ id: 'scent-src-pt', type: 'circle', source: PT, paint: { 'circle-radius': 5, 'circle-color': '#ff9d4d', 'circle-stroke-color': '#1a0f06', 'circle-stroke-width': 2 } })
  }
  useScent.setState({ plume: r.plume })
}

/**
 * The particle view: every particle of the plume replayed along its own
 * path, the 15-minute sit compressed into 12 seconds on a loop, each dot as
 * bright as the scent where it is at nose height, and gone below a trace.
 * A dashed ring marks how far it stays noticeable. The emphasis is on path
 * and range; the cloud is the better read of how much.
 */
const particles = (() => {
  const LOOP_MS = 12_000
  let canvas: HTMLCanvasElement | null = null
  let raf = 0
  let map: MlMap | null = null
  let state: { lon: number; lat: number; kx: number; ky: number; r: PlumeRun; level: Float32Array } | null = null
  let t0 = 0

  const still = () =>
    useAppStore.getState().lowPower || !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || document.visibilityState !== 'visible'

  function ensureCanvas(m: MlMap) {
    if (canvas && canvas.parentElement === m.getContainer()) return
    canvas?.remove()
    canvas = document.createElement('canvas')
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:2;'
    m.getContainer().appendChild(canvas)
  }

  function frame(now: number) {
    raf = 0
    if (!map || !state || !canvas) return
    const c = canvas
    const d = window.devicePixelRatio || 1
    const w = c.clientWidth
    const h = c.clientHeight
    if (c.width !== Math.round(w * d) || c.height !== Math.round(h * d)) {
      c.width = Math.round(w * d)
      c.height = Math.round(h * d)
    }
    const ctx = c.getContext('2d')!
    ctx.setTransform(d, 0, 0, d, 0, 0)
    ctx.clearRect(0, 0, w, h)
    const m = map
    const { lon, lat, kx, ky, r, level } = state
    const tr = r.tracks
    const project = (x: number, y: number) => m.project([lon + x / kx, lat + y / ky])
    // the range ring: how far scent stays noticeable
    const src = project(0, 0)
    if (r.plume.reach >= 40) {
      const edge = project(0, r.plume.reach)
      const rad = Math.hypot(edge.x - src.x, edge.y - src.y)
      ctx.setLineDash([5, 5])
      ctx.strokeStyle = 'rgba(255,170,90,0.7)'
      ctx.lineWidth = 1.2
      ctx.beginPath()
      ctx.arc(src.x, src.y, rad, 0, 2 * Math.PI)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.font = '600 11px system-ui, sans-serif'
      ctx.fillStyle = 'rgba(255,200,140,0.95)'
      ctx.strokeStyle = 'rgba(20,10,4,0.85)'
      ctx.lineWidth = 3
      const label = r.plume.beyond ? `> ${EXTENT_M} m` : `${Math.round(r.plume.reach / 10) * 10} m`
      ctx.strokeText(label, src.x + 4, src.y - rad - 4)
      ctx.fillText(label, src.x + 4, src.y - rad - 4)
    }
    // sim time now, looping; standing still draws the end of the sit
    const T = still() ? TOTAL_S - DT : (((now - t0) % LOOP_MS) / LOOP_MS) * TOTAL_S
    const kf = T / DT
    const k = Math.floor(kf)
    const f = kf - k
    for (let p = 0; p < tr.k0.length; p++) {
      const a = tr.k0[p]
      const b = tr.k1[p]
      if (k < a || k > b) continue
      const i = p * tr.steps + k
      const g = level[i]
      if (g < TRACE) continue
      const j = k < b ? i + 1 : i
      const x = tr.x[i] + (tr.x[j] - tr.x[i]) * f
      const y = tr.y[i] + (tr.y[j] - tr.y[i]) * f
      const v = Math.min(1, Math.log(g / TRACE) / -Math.log(TRACE))
      const q = project(x, y)
      const rgb = `255,${Math.round(200 - 150 * v)},${Math.round(90 - 70 * v)}`
      // a short tail back along the path, so the dots read as flow
      const ib = p * tr.steps + Math.max(a, k - 2)
      const qb = project(tr.x[ib], tr.y[ib])
      ctx.strokeStyle = `rgba(${rgb},${(0.15 + 0.5 * v).toFixed(2)})`
      ctx.lineWidth = 1 + 1.5 * v
      ctx.beginPath()
      ctx.moveTo(qb.x, qb.y)
      ctx.lineTo(q.x, q.y)
      ctx.stroke()
      ctx.fillStyle = `rgba(${rgb},${(0.35 + 0.6 * v).toFixed(2)})`
      ctx.beginPath()
      ctx.arc(q.x, q.y, 1.2 + 1.8 * v, 0, 2 * Math.PI)
      ctx.fill()
    }
    if (!still()) raf = requestAnimationFrame(frame)
  }

  // standing still, the one frame is redrawn as the map moves
  const redrawStill = () => {
    if (still() && !raf && state) raf = requestAnimationFrame(frame)
  }

  return {
    start(m: MlMap, lon: number, lat: number, r: PlumeRun) {
      if (map !== m) {
        map?.off('move', redrawStill)
        map = m
        m.on('move', redrawStill)
      }
      ensureCanvas(m)
      const kx = 111_320 * Math.cos((lat * Math.PI) / 180)
      const ky = 110_574
      // each particle step's nose-height level, looked up once from the grid
      const tr = r.tracks
      const level = new Float32Array(tr.x.length)
      for (let p = 0; p < tr.k0.length; p++)
        for (let k = tr.k0[p]; k <= tr.k1[p]; k++) {
          const i = p * tr.steps + k
          const cx = Math.floor((tr.x[i] + EXTENT_M) / CELL_M)
          const cy = Math.floor((EXTENT_M - tr.y[i]) / CELL_M)
          level[i] = cx >= 0 && cy >= 0 && cx < N && cy < N ? r.grid[cy * N + cx] : 0
        }
      state = { lon, lat, kx, ky, r, level }
      t0 = performance.now()
      if (!raf) raf = requestAnimationFrame(frame)
    },
    stop() {
      if (raf) cancelAnimationFrame(raf)
      raf = 0
      state = null
      map?.off('move', redrawStill)
      map = null
      canvas?.remove()
      canvas = null
    },
    /** the tab came back, or low power changed */
    wake() {
      if (state && !raf) raf = requestAnimationFrame(frame)
    },
  }
})()

function reachText(p: Plume): string {
  if (p.height > GROUND_H) {
    if (p.reach < 40) return 'stays over the deer: barely noticeable at nose height'
    const far = p.beyond ? `past ${EXTENT_M} m` : `about ${Math.round(p.reach / 10) * 10} m`
    return p.landing >= 30 ? `reaches noses from about ${Math.round(p.landing / 10) * 10} m out to ${far}` : `noticeable to ${far}`
  }
  if (p.beyond) return `noticeable past ${EXTENT_M} m`
  if (p.reach < 40) return 'thins out within about 40 m'
  return `noticeable to about ${Math.round(p.reach / 10) * 10} m`
}

/** One line for the card: where most of it goes and how far. */
export function plumeSummary(p: Plume): string {
  const still = p.stable ? ' · still air, it hugs the ground' : ''
  if (p.calm && p.mainShare < 0.35) return `Scent spreads every way, ${reachText(p)}${still}`
  const second = p.sectors
    .map((v, k) => [v, k] as [number, number])
    .sort((a, b) => b[0] - a[0])[1]
  const tail = second && second[0] >= 0.2 ? `, ${Math.round(second[0] * 100)}% ${compass(second[1] * 45)}` : ''
  return `${Math.round(p.mainShare * 100)}% of your scent goes ${compass(p.mainToward)}${tail} · ${reachText(p)}${still}`
}

let wired = false
/** Call once at startup: the plume layer follows its store and the clock. */
export function initScentLayer() {
  if (wired) return
  wired = true
  let tries = 0
  const redraw = () => {
    const m = getMap()
    if (!m) return
    try {
      draw(m)
      tries = 0
    } catch (e) {
      // the style is still loading: try again shortly
      if (tries++ < 20) setTimeout(redraw, 400)
      else devlog('wind', `scent cone failed · ${(e as Error).message}`)
    }
  }
  onEachMap((map) => {
    map.on('styledata', () => {
      if (useScent.getState().source && !map.getSource(PT)) draw(map)
    })
  })
  withMap(() => {
    useScent.subscribe((s, p) => {
      if (s.source !== p.source) {
        if (s.source) void loadMicro().then(redraw)
        else redraw()
      } else if (s.source && (s.view !== p.view || s.height !== p.height)) redraw()
    })
    useAppStore.subscribe((s, p) => {
      if (s.planTimeMs !== p.planTimeMs && useScent.getState().source) redraw()
      if (s.lowPower !== p.lowPower) particles.wake()
    })
    document.addEventListener('visibilitychange', () => particles.wake())
    useWindChecks.subscribe(() => {
      if (useScent.getState().source) redraw()
    })
    onMicro(redraw)
    onProfile(redraw)
    onWeatherGrid(redraw)
  })
}
