import type { GeoJSONSource, ImageSource, Map as MlMap } from 'maplibre-gl'
import { create } from 'zustand'
import { devlog } from '../../devlog'
import { getMap, onEachMap, withMap } from '../../map/mapController'
import { useAppStore } from '../../state/appStore'
import { compass } from '../openMeteo'
import { onProfile } from '../boundaryLayer'
import { onWeatherGrid } from '../windGrid'
import { groundSampler, loadMicro, onMicro } from './model'
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
 *     the picture is the chance scent reaches a place, not one guess.
 *
 * Seeded by place and minute: tapping the same spot twice draws the same
 * cone.
 */

export interface Plume {
  lon: number
  lat: number
  ms: number
  /** share of scent by sector, N, NE … NW (beyond 25 m) */
  sectors: number[]
  /** distance holding 90% of the scent exposure, m */
  reach90: number
  /** strongest sector, bearing scent goes TOWARD */
  mainToward: number
  mainShare: number
  /** the source sits in near calm: it spreads every way */
  calm: boolean
}

const EXTENT_M = 700
const CELL_M = 10
const N = (2 * EXTENT_M) / CELL_M
const RELEASE_S = 600
const TOTAL_S = 900
const DT = 5
const REALISATIONS = 6
const PER_REAL = 90

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

/** Run the plume; the exposure grid (N×N, row 0 north) and its summary. */
export function simulatePlume(lon: number, lat: number, ms: number): { plume: Plume; grid: Float32Array } | null {
  const sample = groundSampler(ms)
  if (!sample) return null
  const kx = 111_320 * Math.cos((lat * Math.PI) / 180)
  const ky = 110_574
  const out = new Float32Array(3)
  if (!sample(lon, lat, out)) return null
  const srcSigma = out[2]
  const srcSpeed = Math.hypot(out[0], out[1])
  const rnd = mulberry32(Math.round(lon * 1e4) * 73856093 ^ Math.round(lat * 1e4) * 19349663 ^ Math.round(ms / 60_000))
  const grid = new Float32Array(N * N)
  const sectors = new Float64Array(8)
  const dists: number[] = []
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
        const cx = Math.floor((x + EXTENT_M) / CELL_M)
        const cy = Math.floor((EXTENT_M - y) / CELL_M)
        if (cx < 0 || cy < 0 || cx >= N || cy >= N) break
        grid[cy * N + cx] += 1
        const d = Math.hypot(x, y)
        dists.push(d)
        if (d > 25) {
          const brg = ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360
          sectors[Math.round(brg / 45) % 8] += 1
        }
      }
    }
  }
  const tot = sectors.reduce((a, b) => a + b, 0) || 1
  const share = Array.from(sectors, (v) => v / tot)
  let main = 0
  for (let k = 1; k < 8; k++) if (share[k] > share[main]) main = k
  dists.sort((a, b) => a - b)
  const reach90 = dists.length ? dists[Math.floor(dists.length * 0.9)] : 0
  return {
    plume: { lon, lat, ms, sectors: share, reach90, mainToward: main * 45, mainShare: share[main], calm: srcSpeed < 0.25 },
    grid,
  }
}

function renderPng(grid: Float32Array): string {
  const c = document.createElement('canvas')
  c.width = N
  c.height = N
  const ctx = c.getContext('2d')!
  const img = ctx.createImageData(N, N)
  // light blur so single particle tracks read as a cloud
  const blur = new Float32Array(N * N)
  for (let y = 1; y < N - 1; y++)
    for (let x = 1; x < N - 1; x++) {
      let s = 0
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += grid[(y + dy) * N + x + dx] * (dx || dy ? 1 : 2)
      blur[y * N + x] = s / 10
    }
  let max = 0
  for (let i = 0; i < blur.length; i++) if (blur[i] > max) max = blur[i]
  const k = 40
  for (let i = 0; i < blur.length; i++) {
    const v = max > 0 ? Math.log1p((k * blur[i]) / max) / Math.log1p(k) : 0
    if (v < 0.06) continue
    // pale amber at the fringe, deep orange-red where scent is thick
    img.data[i * 4] = 255
    img.data[i * 4 + 1] = Math.round(200 - 150 * v)
    img.data[i * 4 + 2] = Math.round(90 - 70 * v)
    img.data[i * 4 + 3] = Math.round(255 * Math.min(0.85, 0.18 + 0.75 * v))
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

/** One line for the card: where most of it goes and how far. */
export function plumeSummary(p: Plume): string {
  if (p.calm && p.mainShare < 0.35) return `Scent spreads every way, about ${Math.round(p.reach90 / 10) * 10} m in 10 minutes`
  const second = p.sectors
    .map((v, k) => [v, k] as [number, number])
    .sort((a, b) => b[0] - a[0])[1]
  const tail = second && second[0] >= 0.2 ? `, ${Math.round(second[0] * 100)}% ${compass(second[1] * 45)}` : ''
  return `${Math.round(p.mainShare * 100)}% of your scent goes ${compass(p.mainToward)}${tail} · reaches about ${Math.round(p.reach90 / 10) * 10} m`
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
