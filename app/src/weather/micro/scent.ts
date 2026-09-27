import type { GeoJSONSource, ImageSource, Map as MlMap } from 'maplibre-gl'
import { create } from 'zustand'
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
  /** the noticeable plume runs off the 700 m grid */
  beyond: boolean
  /** strongest sector, bearing scent goes TOWARD */
  mainToward: number
  mainShare: number
  /** the source sits in near calm: it spreads every way */
  calm: boolean
  /** the air is decoupled-stable: scent hugs the ground */
  stable: boolean
}

const EXTENT_M = 700
const CELL_M = 10
const N = (2 * EXTENT_M) / CELL_M
const RELEASE_S = 600
const TOTAL_S = 900
const DT = 5
const REALISATIONS = 6
const PER_REAL = 120
/** the hunter's scent leaves at about chest height; a deer's nose is near 1 m */
const SRC_H = 1.5
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

/** Nose-height share of a vertically Gaussian plume, reflected at the ground. */
function noseShare(sz: number): number {
  const a = NOSE_H - SRC_H
  const b = NOSE_H + SRC_H
  const k = 2 * sz * sz
  return (Math.exp((-a * a) / k) + Math.exp((-b * b) / k)) / sz
}
const NOSE0 = noseShare(1)

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

/** Run the plume; the nose-height grid (N×N, row 0 north, 1 = the 30 m core) and its summary. */
export function simulatePlume(lon: number, lat: number, ms: number): { plume: Plume; grid: Float32Array } | null {
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
  const sectors = new Float64Array(8)
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
        const w = noseShare(sigmaZ(path, stable, convective)) / NOSE0
        raw[cy * N + cx] += w
        if (Math.hypot(x, y) > 25) {
          const brg = ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360
          sectors[Math.round(brg / 45) % 8] += w
        }
      }
    }
  }
  // light blur so single particle tracks read as a cloud
  const grid = new Float32Array(N * N)
  for (let y = 1; y < N - 1; y++)
    for (let x = 1; x < N - 1; x++) {
      let s = 0
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += raw[(y + dy) * N + x + dx] * (dx || dy ? 1 : 2)
      grid[y * N + x] = s / 10
    }
  // scale to the plume core 20–40 m out, not the spike on the source itself
  const mid = (N - 1) / 2
  let ring = 0
  let max = 0
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const v = grid[y * N + x]
      if (v > max) max = v
      const d = Math.hypot(x - mid, y - mid) * CELL_M
      if (d >= 20 && d <= 40 && v > ring) ring = v
    }
  const ref = ring > 0 ? ring : max
  let reach = 0
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const i = y * N + x
      grid[i] = ref > 0 ? grid[i] / ref : 0
      if (grid[i] >= NOTICE) reach = Math.max(reach, Math.hypot(x - mid, y - mid) * CELL_M)
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
      beyond: reach >= EXTENT_M - 3 * CELL_M,
      mainToward: main * 45,
      mainShare: share[main],
      calm: srcSpeed < 0.25,
      stable: stable > 0.5,
    },
    grid,
  }
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

interface ScentState {
  source: { lon: number; lat: number } | null
  plume: Plume | null
  show: (lon: number, lat: number) => void
  clear: () => void
}

export const useScent = create<ScentState>((set) => ({
  source: null,
  plume: null,
  show: (lon, lat) => set({ source: { lon, lat } }),
  clear: () => set({ source: null, plume: null }),
}))

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

function draw(map: MlMap) {
  const { source } = useScent.getState()
  if (!source) {
    removeLayers(map)
    return
  }
  const ms = useAppStore.getState().planTimeMs ?? Date.now()
  const r = simulatePlume(source.lon, source.lat, ms)
  if (!r) {
    removeLayers(map)
    useScent.setState({ plume: null })
    return
  }
  const url = renderPng(r.grid)
  const coords = corners(source.lon, source.lat)
  const img = map.getSource(SRC) as ImageSource | undefined
  if (img) img.updateImage({ url, coordinates: coords })
  else {
    map.addSource(SRC, { type: 'image', url, coordinates: coords })
    map.addLayer({ id: 'scent-layer', type: 'raster', source: SRC, paint: { 'raster-opacity': 0.9, 'raster-resampling': 'linear', 'raster-fade-duration': 0 } })
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

function reachText(p: Plume): string {
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
      if (useScent.getState().source && !map.getSource(SRC)) draw(map)
    })
  })
  withMap(() => {
    useScent.subscribe((s, p) => {
      if (s.source !== p.source) {
        if (s.source) void loadMicro().then(redraw)
        else redraw()
      }
    })
    useAppStore.subscribe((s, p) => {
      if (s.planTimeMs !== p.planTimeMs && useScent.getState().source) redraw()
    })
    useWindChecks.subscribe(() => {
      if (useScent.getState().source) redraw()
    })
    onMicro(redraw)
    onProfile(redraw)
    onWeatherGrid(redraw)
  })
}
