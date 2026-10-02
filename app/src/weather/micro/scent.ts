import maplibregl, { type GeoJSONSource, type ImageSource, type Map as MlMap } from 'maplibre-gl'
import type { Feature, FeatureCollection } from 'geojson'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { devlog } from '../../devlog'
import { getMap, onEachMap, withMap } from '../../map/mapController'
import { useMeasureStore } from '../../measure/measureStore'
import { useRoutes } from '../../routes/routeStore'
import { useAppStore } from '../../state/appStore'
import { compass } from '../openMeteo'
import { onProfile } from '../boundaryLayer'
import { onWeatherGrid } from '../windGrid'
import { groundGust, groundSampler, groundStability, loadMicro, microGrid, onMicro, type GroundSampler } from './model'
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
 *   - on a gusty hour the sit runs in bursts of about 15 s at the hour's
 *     gust factor, stirring harder, with slower lulls between them, so
 *     scent goes out in pushes rather than at one steady rate;
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
 *
 * Several people sitting: each runs their own plume, and the map shows
 * what they give off together. Scent is a passive tracer, so exposures
 * add: each person's grid, scaled to their own sit on the ground, is laid
 * into one frame and summed. A cone on its own looks just as it would
 * alone; where cones overlap, two traces can add up to noticeable.
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
/** mean length of a gust burst, s */
const BURST_S = 15
/** a hunter on the ground gives off scent at about chest height; a deer's nose is near 1 m */
export const GROUND_H = 1.5
const NOSE_H = 1
/**
 * Concentration bands, as a share of the plume core 20–40 m out, as
 * modelled: strong, noticeable, a faint trace. The card's slider slides
 * them (riskBands): conservative counts scent sooner and the cone grows,
 * aggressive only what is strong, and the cone shrinks.
 */
const BANDS = { strong: 0.2, notice: 0.04, trace: 0.01 }
let STRONG = BANDS.strong
let NOTICE = BANDS.notice
let TRACE = BANDS.trace
/** the direction spread the plume meanders with, as a multiple of the ground model's */
let SPREAD = 1

/**
 * The slider, 0 (conservative) … 1 (aggressive), 0.5 as modelled. One
 * step either way is a third or three times on the bands (the nose works
 * on ratios), and the meander is 30% wider at the conservative end, 30%
 * tighter at the aggressive one: the cone drawn for a hunter who takes
 * no chances, or one who plays the wind as the model has it.
 */
export function riskBands(risk: number): { strong: number; notice: number; trace: number; spread: number } {
  const r = Math.min(1, Math.max(0, risk))
  const f = Math.pow(3, 2 * r - 1)
  return { strong: BANDS.strong * f, notice: BANDS.notice * f, trace: BANDS.trace * f, spread: 1 + 0.3 * (1 - 2 * r) }
}

function applyRisk(risk: number): void {
  const b = riskBands(risk)
  STRONG = b.strong
  NOTICE = b.notice
  TRACE = b.trace
  SPREAD = b.spread
}

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

/** Longest path the table covers, m; past the grid's edge by any route. */
const TABLE_M = 6000

/**
 * The nose-height weight by distance travelled, in 1 m steps. σz and the
 * reflected Gaussian are the costly part of a particle's step, and within
 * one plume they depend on nothing but the path.
 */
function noseTable(h: number, stable: number, conv: number): Float32Array {
  const t = new Float32Array(TABLE_M + 1)
  for (let m = 0; m <= TABLE_M; m++) t[m] = noseShare(sigmaZ(m, stable, conv), h) / NOSE0
  return t
}

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
 * The ground wind for plumes, worked out once per cell of the micro grid.
 * The model gives one value per cell (the regional wind and the wind
 * checks hardly change across it), and a plume's 130 000 samples fall in
 * a few thousand cells, so each is evaluated at its centre and kept. One
 * sampler serves everyone at the same minute, which is what lets a person
 * be dragged about with their cone following.
 */
export function cellSampler(ms: number): GroundSampler | null {
  const sample = groundSampler(ms)
  const g = microGrid()
  if (!sample || !g) return sample
  const memo = new Map<number, Float32Array | null>()
  return (lon, lat, out) => {
    const i = g.index(lon, lat)
    if (i < 0) return sample(lon, lat, out)
    let v = memo.get(i)
    if (v === undefined) {
      const [clon, clat] = g.center(i)
      v = sample(clon, clat, out) ? Float32Array.of(out[0], out[1], out[2]) : null
      memo.set(i, v)
    }
    if (!v) return false
    out[0] = v[0]
    out[1] = v[1]
    out[2] = v[2]
    return true
  }
}

/**
 * Run the plume; the nose-height grid (N×N, row 0 north) and its summary.
 * The grid is scaled to the core 20–40 m out of the same sit ON THE GROUND,
 * so a stand's scent reads against what the ground would have given: it
 * starts over the deer's heads and touches down farther out, thinner.
 */
export function simulatePlume(
  lon: number,
  lat: number,
  ms: number,
  height = GROUND_H,
  sample: GroundSampler | null = cellSampler(ms),
  gust = groundGust(ms),
): { plume: Plume; grid: Float32Array; tracks: PlumeTracks } | null {
  if (!sample) return null
  const { stable, convective } = groundStability(ms)
  const noseAt = noseTable(height, stable, convective)
  const noseGround = height === GROUND_H ? noseAt : noseTable(GROUND_H, stable, convective)
  const kx = 111_320 * Math.cos((lat * Math.PI) / 180)
  const ky = 110_574
  const out = new Float32Array(3)
  if (!sample(lon, lat, out)) return null
  const srcSigma = out[2] * SPREAD
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
  // gusts: the sit is spent in bursts and lulls, a share GFRAC of it in a
  // burst of about BURST_S, where the wind runs at the hour's gust factor
  // and stirs harder. The lulls are slower by as much, so the sit's mean
  // speed is about what it was.
  const gusty = gust > 1.1
  const GFRAC = Math.min(0.35, Math.max(0, (gust - 1) / 3))
  const lullMul = Math.max(0.3, (1 - GFRAC * gust) / (1 - GFRAC))
  const pEnd = DT / BURST_S
  const pStart = (DT * GFRAC) / (BURST_S * (1 - GFRAC))
  for (let r = 0; r < REALISATIONS; r++) {
    // the meander angle through the sit (radians), an OU process
    const steps = Math.ceil(TOTAL_S / DT) + 1
    const phi = new Float32Array(steps)
    const sm = ((srcSigma * 0.8) * Math.PI) / 180
    phi[0] = gauss(rnd) * sm
    for (let k = 1; k < steps; k++) phi[k] = phi[k - 1] * (1 - DT / TM) + sm * Math.sqrt((2 * DT) / TM) * gauss(rnd)
    // whether the air is gusting at each step: a two-state chain everyone in
    // this realisation shares, since a gust comes through the whole plume
    const burst = new Uint8Array(steps)
    if (gusty) {
      let on = rnd() < GFRAC
      for (let k = 0; k < steps; k++) {
        on = on ? rnd() >= pEnd : rnd() < pStart
        burst[k] = on ? 1 : 0
      }
    }
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
        const gm = burst[k] ? gust : gusty ? lullMul : 1
        // rotate the mean wind by the meander (east/north frame, clockwise positive)
        const u = (out[0] * c + out[1] * s) * gm
        const v = (-out[0] * s + out[1] * c) * gm
        const spd = Math.sqrt(u * u + v * v)
        const sigT = (0.1 + 0.35 * spd + 0.25 * spd * Math.sin(Math.min(80, out[2] * SPREAD) * (Math.PI / 180))) * (burst[k] ? 1.5 : 1)
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
        const pm = Math.min(TABLE_M, Math.round(path))
        const w = noseAt[pm]
        raw[cy * N + cx] += w
        if (rawGround !== raw) rawGround[cy * N + cx] += noseGround[pm]
        if (x * x + y * y > 625) {
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

/** Light blur so single particle tracks read as a cloud (w×h, one person's N×N by default). */
function blur(raw: Float32Array, w = N, h = N): Float32Array {
  const grid = new Float32Array(w * h)
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      let s = 0
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += raw[(y + dy) * w + x + dx] * (dx || dy ? 1 : 2)
      grid[y * w + x] = s / 10
    }
  return grid
}

/** One closed (or, at worst, open) line in metres east/north of the source, as x, y pairs. */
interface Outline {
  xy: Float32Array
  closed: boolean
}

/**
 * Where scent stops being noticeable: marching squares on the grid at
 * NOTICE, blurred once more so the edge reads as the plume's shape rather
 * than the jitter of single particles. Specks too small to matter are dropped.
 * A grid other than one person's gives its size and its west and north
 * edges, m, so the line comes out in the same metres.
 */
function noticeOutline(grid: Float32Array, cols = N, rows = N, west = -EXTENT_M, north = EXTENT_M): Outline[] {
  const g = blur(grid, cols, rows)
  const at = (i: number, j: number) => g[j * cols + i]
  const xm = (i: number) => west + (i + 0.5) * CELL_M
  const ym = (j: number) => north - (j + 0.5) * CELL_M
  const pts = new Map<number, [number, number]>()
  const nb = new Map<number, number[]>()
  // the crossing on the edge east (h) or south (v) of cell i, j
  const h = (i: number, j: number) => {
    const key = (j * cols + i) * 2
    if (!pts.has(key)) pts.set(key, [xm(i) + ((NOTICE - at(i, j)) / (at(i + 1, j) - at(i, j))) * CELL_M, ym(j)])
    return key
  }
  const v = (i: number, j: number) => {
    const key = (j * cols + i) * 2 + 1
    if (!pts.has(key)) pts.set(key, [xm(i), ym(j) - ((NOTICE - at(i, j)) / (at(i, j + 1) - at(i, j))) * CELL_M])
    return key
  }
  const link = (p: number, q: number) => {
    for (const [a, b] of [
      [p, q],
      [q, p],
    ]) {
      const l = nb.get(a)
      if (l) l.push(b)
      else nb.set(a, [b])
    }
  }
  for (let j = 0; j < rows - 1; j++)
    for (let i = 0; i < cols - 1; i++) {
      const c = (at(i, j) >= NOTICE ? 8 : 0) | (at(i + 1, j) >= NOTICE ? 4 : 0) | (at(i + 1, j + 1) >= NOTICE ? 2 : 0) | (at(i, j + 1) >= NOTICE ? 1 : 0)
      if (c === 0 || c === 15) continue
      const T = () => h(i, j)
      const B = () => h(i, j + 1)
      const L = () => v(i, j)
      const R = () => v(i + 1, j)
      // a saddle is split by the cell's mean
      const mid = () => (at(i, j) + at(i + 1, j) + at(i + 1, j + 1) + at(i, j + 1)) / 4 >= NOTICE
      if (c === 1 || c === 14) link(L(), B())
      else if (c === 2 || c === 13) link(B(), R())
      else if (c === 3 || c === 12) link(L(), R())
      else if (c === 4 || c === 11) link(T(), R())
      else if (c === 6 || c === 9) link(T(), B())
      else if (c === 7 || c === 8) link(L(), T())
      else if ((c === 5 && mid()) || (c === 10 && !mid())) {
        link(T(), L())
        link(B(), R())
      } else {
        link(T(), R())
        link(L(), B())
      }
    }
  const seen = new Set<number>()
  const walk = (from: number, first: number | undefined) => {
    const out: number[] = []
    let prev = from
    let cur = first
    while (cur !== undefined && !seen.has(cur)) {
      seen.add(cur)
      out.push(cur)
      const n = nb.get(cur)!
      const next: number | undefined = n[0] === prev ? n[1] : n[0]
      prev = cur
      cur = next
    }
    return out
  }
  const lines: Outline[] = []
  for (const s of nb.keys()) {
    if (seen.has(s)) continue
    seen.add(s)
    const n = nb.get(s)!
    const fwd = walk(s, n[0])
    const keys = [...walk(s, n[1]).reverse(), s, ...fwd]
    if (keys.length < 10) continue
    let xy: Float32Array = new Float32Array(keys.length * 2)
    keys.forEach((k, m) => {
      const p = pts.get(k)!
      xy[2 * m] = p[0]
      xy[2 * m + 1] = p[1]
    })
    const closed = nb.get(keys[keys.length - 1])!.includes(keys[0])
    // two rounds of corner cutting take the grid's stair steps off the edge
    for (let pass = 0; pass < 2; pass++) xy = chaikin(xy, closed)
    lines.push({ xy, closed })
  }
  return lines
}

/** Chaikin corner cutting: each segment's ends move a quarter of the way in. */
function chaikin(xy: Float32Array, closed: boolean): Float32Array {
  const n = xy.length / 2
  const segs = closed ? n : n - 1
  const out = new Float32Array((closed ? 0 : 4) + segs * 4)
  let o = 0
  if (!closed) {
    out[o++] = xy[0]
    out[o++] = xy[1]
  }
  for (let s = 0; s < segs; s++) {
    const a = s * 2
    const b = ((s + 1) % n) * 2
    out[o++] = 0.75 * xy[a] + 0.25 * xy[b]
    out[o++] = 0.75 * xy[a + 1] + 0.25 * xy[b + 1]
    out[o++] = 0.25 * xy[a] + 0.75 * xy[b]
    out[o++] = 0.25 * xy[a + 1] + 0.75 * xy[b + 1]
  }
  if (!closed) {
    out[o++] = xy[xy.length - 2]
    out[o++] = xy[xy.length - 1]
  }
  return out
}

function renderPng(grid: Float32Array, w: number, h: number): string {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  const img = ctx.createImageData(w, h)
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

/// ---------------------------------------------------------------- everyone together

type PlumeRun = NonNullable<ReturnType<typeof simulatePlume>>

/**
 * Everyone's grids laid into one: 10 m cells, row 0 north, in metres east
 * and north of the first person. Each person's grid goes in at the nearest
 * cell, within 5 m of where they sit, and is added to the rest.
 */
interface Frame {
  lon: number
  lat: number
  kx: number
  ky: number
  /** the frame's west and north edges, m from the first person */
  west: number
  north: number
  w: number
  h: number
  grid: Float32Array
  /** each person's offset from the first, m east and north */
  off: [number, number][]
  /** where each person's grid sits in the frame, cells from its west and north edges */
  place: [number, number][]
}

function combine(people: { lon: number; lat: number }[], runs: (PlumeRun | null)[]): Frame {
  const { lon, lat } = people[0]
  const kx = 111_320 * Math.cos((lat * Math.PI) / 180)
  const ky = 110_574
  const off = people.map((p): [number, number] => [(p.lon - lon) * kx, (p.lat - lat) * ky])
  const ci = off.map((o) => Math.round(o[0] / CELL_M))
  const cj = off.map((o) => Math.round(o[1] / CELL_M))
  const c0 = Math.min(...ci)
  const r0 = Math.max(...cj)
  const w = N + Math.max(...ci) - c0
  const h = N + r0 - Math.min(...cj)
  const place = off.map((_, p): [number, number] => [ci[p] - c0, r0 - cj[p]])
  const grid = new Float32Array(w * h)
  runs.forEach((r, p) => {
    if (!r) return
    const [dx, dy] = place[p]
    for (let y = 0; y < N; y++) {
      const row = (y + dy) * w + dx
      for (let x = 0; x < N; x++) grid[row + x] += r.grid[y * N + x]
    }
  })
  return { lon, lat, kx, ky, west: c0 * CELL_M - EXTENT_M, north: r0 * CELL_M + EXTENT_M, w, h, grid, off, place }
}

function frameCorners(f: Frame): [[number, number], [number, number], [number, number], [number, number]] {
  const w = f.lon + f.west / f.kx
  const e = f.lon + (f.west + f.w * CELL_M) / f.kx
  const n = f.lat + f.north / f.ky
  const s = f.lat + (f.north - f.h * CELL_M) / f.ky
  return [
    [w, n],
    [e, n],
    [e, s],
    [w, s],
  ]
}

/** What two or more people give off together. */
export interface Group {
  /** ground where scent is noticeable at a deer's nose, everyone together, ha */
  areaHa: number
  /** of that, ground no one would scent alone: where cones overlap and add up */
  addsHa: number
  /** [from, onto] by index: from's scent is noticeable where onto sits */
  reaches: [number, number][]
}

function groupOf(f: Frame, runs: (PlumeRun | null)[]): Group {
  const HA = (CELL_M * CELL_M) / 10_000
  const alone = new Uint8Array(f.w * f.h)
  runs.forEach((r, p) => {
    if (!r) return
    const [dx, dy] = f.place[p]
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (r.grid[y * N + x] >= NOTICE) alone[(y + dy) * f.w + dx + x] = 1
  })
  let area = 0
  let adds = 0
  for (let i = 0; i < f.grid.length; i++)
    if (f.grid[i] >= NOTICE) {
      area++
      if (!alone[i]) adds++
    }
  const reaches: [number, number][] = []
  runs.forEach((r, a) => {
    if (!r) return
    f.off.forEach((o, b) => {
      if (a === b) return
      const x = Math.floor((o[0] - f.off[a][0] + EXTENT_M) / CELL_M)
      const y = Math.floor((EXTENT_M - (o[1] - f.off[a][1])) / CELL_M)
      if (x >= 0 && y >= 0 && x < N && y < N && r.grid[y * N + x] >= NOTICE) reaches.push([a, b])
    })
  })
  return { areaHa: area * HA, addsHa: adds * HA, reaches }
}

// ---------------------------------------------------------------- state and map layer

/** The shaded cloud, particles streaming along their paths, or each person's own edge (two or more). */
export type ScentView = 'cloud' | 'particles' | 'people'
/** Where the hunter sits: on the ground, or a tree stand at 4 or 6 m. */
export const SCENT_HEIGHTS = [GROUND_H, 4, 6] as const
/** Each person's colour when their own edges are drawn, by number. */
const PERSON_COLOURS = ['#5fd4ff', '#b7f06a', '#ff7ad9', '#ffe066', '#b69cff', '#7dffc8']
export const personColour = (k: number) => PERSON_COLOURS[k % PERSON_COLOURS.length]
/** The view as drawn: one person has no edges of their own to tell apart. */
export const drawnView = (v: ScentView, people: number): ScentView => (v === 'people' && people < 2 ? 'cloud' : v)

/** Someone sitting: where, and how high. */
export interface Sitter {
  lon: number
  lat: number
  height: number
  /** you, out hunting: the cone follows your position (see hunting/hunting.ts) */
  live?: boolean
}

/** Close enough to where you stand that a person put there is you, not a second cone on top. */
const SAME_SPOT_M = 15

/** Metres between two places, near enough over a sit's distances. */
function metresApart(a: { lon: number; lat: number }, b: { lon: number; lat: number }): number {
  return Math.hypot((a.lon - b.lon) * 111_320 * Math.cos((a.lat * Math.PI) / 180), (a.lat - b.lat) * 110_574)
}

interface ScentState {
  /** everyone sitting, numbered 1, 2, 3 … in this order */
  people: Sitter[]
  /** each one's plume, in the same order; null until it is worked out, or with no wind to run it on */
  plumes: (Plume | null)[]
  /** two or more: what they give off together */
  group: Group | null
  /** the person the card's choices are for */
  pick: number
  /** the next tap on the map places another person */
  adding: boolean
  /** the next tap on the map is where this person goes */
  moving: number | null
  /** the cones are off the map; everyone stays where they sit */
  hidden: boolean
  /** the card is up; minimised, the people and their cones stay and the map's button carries a mark */
  card: boolean
  /** the distances between the people, drawn on the map */
  distances: boolean
  view: ScentView
  /** where a new person sits: the last choice */
  height: number
  /** the cone's slider, 0 conservative … 1 aggressive (riskBands) */
  risk: number
  /** start over: one person, here */
  show: (lon: number, lat: number) => void
  add: (lon: number, lat: number) => void
  move: (k: number, lon: number, lat: number) => void
  remove: (k: number) => void
  /** you, first in the list, at your position */
  putLive: (lon: number, lat: number) => void
  removeLive: () => void
  setPick: (k: number) => void
  setAdding: (v: boolean) => void
  setMoving: (k: number | null) => void
  setHidden: (v: boolean) => void
  setCard: (v: boolean) => void
  setDistances: (v: boolean) => void
  clear: () => void
  setView: (v: ScentView) => void
  /** the picked person's height, and the next one's */
  setHeight: (h: number) => void
  setRisk: (r: number) => void
}

export const useScent = create<ScentState>()(
  persist(
    (set, get) => ({
      people: [],
      plumes: [],
      group: null,
      pick: 0,
      adding: false,
      moving: null,
      hidden: false,
      card: true,
      distances: true,
      view: 'cloud',
      height: GROUND_H,
      risk: 0.5,
      show: (lon, lat) => set({ people: [{ lon, lat, height: get().height }], plumes: [], group: null, pick: 0, adding: false, moving: null, hidden: false, card: true }),
      add: (lon, lat) => {
        const { people, height } = get()
        // out hunting your own cone is already here: a person on the spot is you, picked, not a second cone
        const mine = people.findIndex((p) => p.live && metresApart(p, { lon, lat }) <= SAME_SPOT_M)
        if (mine >= 0) return set({ pick: mine, adding: false, moving: null })
        const next = [...people, { lon, lat, height }]
        set({ people: next, pick: next.length - 1, adding: false, moving: null, card: true })
      },
      move: (k, lon, lat) => set({ people: get().people.map((p, i) => (i === k ? { ...p, lon, lat } : p)), moving: null }),
      // your cone coming on is a request to see it, so hidden cones come back with it
      putLive: (lon, lat) => set({ people: [{ lon, lat, height: get().height, live: true }, ...get().people.filter((p) => !p.live)], pick: 0 }),
      removeLive: () => {
        const rest = get().people.filter((p) => !p.live)
        if (!rest.length) return get().clear()
        if (rest.length < get().people.length) set({ people: rest, pick: 0, moving: null })
      },
      remove: (k) => {
        const { people, pick } = get()
        const rest = people.filter((_, i) => i !== k)
        if (!rest.length) return get().clear()
        set({ people: rest, pick: pick > k ? pick - 1 : Math.min(pick, rest.length - 1), moving: null })
      },
      setPick: (pick) => set({ pick }),
      setAdding: (adding) => set({ adding, moving: adding ? null : get().moving }),
      setMoving: (moving) => set({ moving, adding: moving == null ? get().adding : false }),
      setHidden: (hidden) => set({ hidden }),
      setCard: (card) => set({ card }),
      setDistances: (distances) => set({ distances }),
      clear: () => set({ people: [], plumes: [], group: null, pick: 0, adding: false, moving: null, hidden: false, card: true }),
      setView: (view) => set({ view }),
      setHeight: (height) => set({ height, people: get().people.map((p, i) => (i === get().pick ? { ...p, height } : p)) }),
      setRisk: (risk) => set({ risk: Math.min(1, Math.max(0, risk)) }),
    }),
    // the choices stick; the people and their cones are for this sit only
    {
      name: 'huntapp-scent',
      // v1: the distances between sitters are on unless turned off from here
      version: 1,
      migrate: (p, from) => {
        const s = (p ?? {}) as Record<string, unknown>
        if (from < 1) delete s.distances
        return s as never
      },
      partialize: (s) => ({ view: s.view, height: s.height, distances: s.distances, risk: s.risk }),
    },
  ),
)
applyRisk(useScent.getState().risk)
useScent.subscribe((s, p) => {
  if (s.risk !== p.risk) applyRisk(s.risk)
})

const SRC = 'scent-img'
const EDGES = 'scent-edges'
const EDGE_LAYERS = ['scent-edge-label', 'scent-edge', 'scent-edge-casing']

function removeLayers(map: MlMap) {
  removeEdges(map)
  removeCloud(map)
}

function removeCloud(map: MlMap) {
  if (map.getLayer('scent-layer')) map.removeLayer('scent-layer')
  if (map.getSource(SRC)) map.removeSource(SRC)
}

function removeEdges(map: MlMap) {
  for (const id of EDGE_LAYERS) if (map.getLayer(id)) map.removeLayer(id)
  if (map.getSource(EDGES)) map.removeSource(EDGES)
}

const DIST = 'scent-dist'
const DIST_LAYERS = ['scent-dist-label', 'scent-dist-line']

/** The distances between the people, as an option: a thin line between each pair
 *  (up to four people; a chain past that) with the metres at its middle. Drawn
 *  whether or not the cones are, since it is about the setup, not the air. */
function syncDistances(map: MlMap, people: Sitter[]) {
  const { distances } = useScent.getState()
  if (!distances || people.length < 2) {
    for (const id of DIST_LAYERS) if (map.getLayer(id)) map.removeLayer(id)
    if (map.getSource(DIST)) map.removeSource(DIST)
    return
  }
  const pairs: [number, number][] = []
  if (people.length <= 4) for (let i = 0; i < people.length; i++) for (let j = i + 1; j < people.length; j++) pairs.push([i, j])
  else for (let i = 1; i < people.length; i++) pairs.push([i - 1, i])
  const imperial = useAppStore.getState().units === 'imperial'
  const features: Feature[] = []
  for (const [i, j] of pairs) {
    const a = people[i]
    const b = people[j]
    const m = metresApart(a, b)
    const t = imperial ? `${Math.round(m * 1.09361)} yd` : `${Math.round(m)} m`
    features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[a.lon, a.lat], [b.lon, b.lat]] }, properties: {} })
    features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [(a.lon + b.lon) / 2, (a.lat + b.lat) / 2] }, properties: { t } })
  }
  const data: FeatureCollection = { type: 'FeatureCollection', features }
  const src = map.getSource(DIST) as GeoJSONSource | undefined
  if (src) return src.setData(data)
  map.addSource(DIST, { type: 'geojson', data })
  map.addLayer({ id: 'scent-dist-line', type: 'line', source: DIST, filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': 'rgba(255,255,255,0.75)', 'line-width': 1.2, 'line-dasharray': [2, 2] } })
  map.addLayer({
    id: 'scent-dist-label',
    type: 'symbol',
    source: DIST,
    filter: ['==', ['geometry-type'], 'Point'],
    layout: { 'text-field': ['get', 't'], 'text-font': ['Noto Sans Medium'], 'text-size': 11.5, 'text-allow-overlap': true, 'text-ignore-placement': true },
    paint: { 'text-color': '#ffffff', 'text-halo-color': 'rgba(20,10,4,0.9)', 'text-halo-width': 1.5 },
  })
}

/** Everyone's scent together, shaded; a little fainter under each person's own edge. */
function drawCloud(map: MlMap, f: Frame, dim: boolean) {
  const url = renderPng(f.grid, f.w, f.h)
  const coordinates = frameCorners(f)
  const img = map.getSource(SRC) as ImageSource | undefined
  if (img) img.updateImage({ url, coordinates })
  else {
    map.addSource(SRC, { type: 'image', url, coordinates })
    map.addLayer(
      { id: 'scent-layer', type: 'raster', source: SRC, paint: { 'raster-opacity': 0.9, 'raster-resampling': 'linear', 'raster-fade-duration': 0 } },
      map.getLayer('scent-edge-casing') ? 'scent-edge-casing' : undefined,
    )
  }
  map.setPaintProperty('scent-layer', 'raster-opacity', dim ? 0.6 : 0.9)
}

/** How far scent is noticeable, to 10 m: '180 m', or '> 700 m' off the grid. */
export function reachLabel(p: Plume): string {
  return p.beyond ? `> ${EXTENT_M} m` : `${Math.round(p.reach / 10) * 10} m`
}

/** Each person's noticeable edge in their own colour, their number and reach at its far tip. */
function drawEdges(map: MlMap, people: Sitter[], runs: (PlumeRun | null)[]) {
  const features: Feature[] = []
  runs.forEach((r, k) => {
    if (!r || r.plume.reach < 40) return
    const { lon, lat } = people[k]
    const kx = 111_320 * Math.cos((lat * Math.PI) / 180)
    const ky = 110_574
    const c = personColour(k)
    let tip: [number, number] | null = null
    let far = 0
    for (const o of noticeOutline(r.grid)) {
      const coordinates: [number, number][] = []
      for (let n = 0; n < o.xy.length; n += 2) {
        const x = o.xy[n]
        const y = o.xy[n + 1]
        coordinates.push([lon + x / kx, lat + y / ky])
        const d = Math.hypot(x, y)
        if (d > far) {
          far = d
          tip = [x, y]
        }
      }
      if (o.closed) coordinates.push(coordinates[0])
      features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates }, properties: { c } })
    }
    if (tip) {
      // the label sits off the tip, on the side away from the person
      const a = `${tip[1] >= 0 ? 'bottom' : 'top'}-${tip[0] >= 0 ? 'left' : 'right'}`
      features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon + tip[0] / kx, lat + tip[1] / ky] }, properties: { c, a, t: `${k + 1} · ${reachLabel(r.plume)}` } })
    }
  })
  const fc: FeatureCollection = { type: 'FeatureCollection', features }
  const src = map.getSource(EDGES) as GeoJSONSource | undefined
  if (src) return src.setData(fc)
  map.addSource(EDGES, { type: 'geojson', data: fc })
  map.addLayer({
    id: 'scent-edge-casing',
    type: 'line',
    source: EDGES,
    filter: ['==', ['geometry-type'], 'LineString'],
    layout: { 'line-join': 'round' },
    paint: { 'line-color': 'rgba(20,10,4,0.5)', 'line-width': 4 },
  })
  map.addLayer({
    id: 'scent-edge',
    type: 'line',
    source: EDGES,
    filter: ['==', ['geometry-type'], 'LineString'],
    layout: { 'line-join': 'round' },
    paint: { 'line-color': ['get', 'c'], 'line-width': 2, 'line-dasharray': [2.5, 1.5] },
  })
  map.addLayer({
    id: 'scent-edge-label',
    type: 'symbol',
    source: EDGES,
    filter: ['==', ['geometry-type'], 'Point'],
    layout: { 'text-field': ['get', 't'], 'text-font': ['Noto Sans Medium'], 'text-size': 12, 'text-anchor': ['get', 'a'], 'text-allow-overlap': true, 'text-ignore-placement': true },
    paint: { 'text-color': ['get', 'c'], 'text-halo-color': 'rgba(20,10,4,0.9)', 'text-halo-width': 1.5 },
  })
}

// each person is a marker to drag about; a tap on one picks them for the card
let markers: maplibregl.Marker[] = []
let markersOn: MlMap | null = null
let dragging = -1

function syncMarkers(map: MlMap | null) {
  const { people, pick, view } = useScent.getState()
  if (markersOn !== map) {
    for (const m of markers) m.remove()
    markers = []
    markersOn = map
  }
  if (!map) return
  while (markers.length > people.length) markers.pop()!.remove()
  while (markers.length < people.length) {
    // marker k is always person k: people come and go from the end of the list, the rest move up
    const k = markers.length
    const el = document.createElement('div')
    el.className = 'scent-person'
    // the map's own tap popup stays shut; with the tape or the routes out,
    // the person is the point you meant
    el.addEventListener('click', (e) => {
      e.stopPropagation()
      const p = useScent.getState().people[k]
      if (p && useMeasureStore.getState().active) return useMeasureStore.getState().addPoint([p.lon, p.lat])
      if (p && useRoutes.getState().open) return useRoutes.getState().setTo({ lon: p.lon, lat: p.lat, kind: 'map', name: `${k + 1}` })
      useScent.getState().setPick(k)
    })
    const m = new maplibregl.Marker({ element: el, draggable: true })
    const moved = () => {
      const ll = m.getLngLat()
      useScent.getState().move(k, ll.lng, ll.lat)
    }
    m.on('dragstart', () => {
      dragging = k
      useScent.getState().setPick(k)
    })
    m.on('drag', moved)
    m.on('dragend', () => {
      dragging = -1
      moved()
    })
    m.setLngLat([people[k].lon, people[k].lat]).addTo(map)
    markers.push(m)
  }
  const many = people.length > 1
  const own = drawnView(view, people.length) === 'people'
  people.forEach((p, k) => {
    const m = markers[k]
    if (k !== dragging) m.setLngLat([p.lon, p.lat])
    // you: the position dot is where your scent comes from, and it moves with you, not a finger
    m.setDraggable(!p.live)
    const el = m.getElement()
    el.style.display = p.live ? 'none' : ''
    el.textContent = many ? String(k + 1) : ''
    el.classList.toggle('sp-many', many)
    el.classList.toggle('sp-pick', many && k === pick)
    el.style.setProperty('--sp', own ? personColour(k) : '#ff9d4d')
  })
}

/** The planning time, or now to the minute: the plume's seed is the minute, and a drag keeps its cache. */
function planMinute(): number {
  return useAppStore.getState().planTimeMs ?? Math.floor(Date.now() / 60_000) * 60_000
}

// bumped whenever the air changes, so every cone is run again
let gen = 0
// each person's run, kept while only the people change, with one sampler for the minute
let cache: { gen: number; ms: number; sample: GroundSampler | null; runs: Map<string, PlumeRun | null> } | null = null

function runsFor(people: Sitter[], ms: number): (PlumeRun | null)[] {
  if (!cache || cache.gen !== gen || cache.ms !== ms) cache = { gen, ms, sample: cellSampler(ms), runs: new Map() }
  const c = cache
  const keep = new Map<string, PlumeRun | null>()
  const out = people.map((p) => {
    const key = `${p.lon},${p.lat},${p.height}`
    const r = c.runs.has(key) ? c.runs.get(key)! : simulatePlume(p.lon, p.lat, ms, p.height, c.sample)
    keep.set(key, r)
    return r
  })
  // only the people as they are now: a drag would leave a trail of runs behind
  c.runs = keep
  return out
}

/** Everyone's scent as last drawn, for what else needs to know where it goes (the moose's swing). */
let drawn: Frame | null = null

/** Scent at a nose at a point as last drawn, everyone together, as a share of the plume core
 *  (noticeable from scentNotice()); null off the drawn ground or with no cone. */
export function scentAt(lon: number, lat: number): number | null {
  const f = drawn
  if (!f) return null
  const x = Math.floor(((lon - f.lon) * f.kx - f.west) / CELL_M)
  const y = Math.floor((f.north - (lat - f.lat) * f.ky) / CELL_M)
  if (x < 0 || y < 0 || x >= f.w || y >= f.h) return null
  return f.grid[y * f.w + x]
}
/** The noticeable band's floor as the slider has it now. */
export const scentNotice = (): number => NOTICE

function draw(map: MlMap) {
  const { people, view, hidden } = useScent.getState()
  syncMarkers(people.length ? map : null)
  syncDistances(map, people)
  if (!people.length) {
    drawn = null
    removeLayers(map)
    particles.stop()
    return
  }
  const runs = runsFor(people, planMinute())
  const plumes = runs.map((r) => r?.plume ?? null)
  if (!runs.some(Boolean)) {
    drawn = null
    removeLayers(map)
    particles.stop()
    useScent.setState({ plumes, group: null })
    return
  }
  const f = combine(people, runs)
  drawn = f
  // the cones hidden: nothing on the map but the people, though the card's
  // lines and the moose's swing still know where scent goes
  if (hidden) {
    removeLayers(map)
    particles.stop()
    useScent.setState({ plumes, group: people.length > 1 ? groupOf(f, runs) : null })
    return
  }
  const v = drawnView(view, people.length)
  if (v === 'particles') {
    removeLayers(map)
    particles.start(map, f, runs)
  } else {
    particles.stop()
    drawCloud(map, f, v === 'people')
    if (v === 'people') drawEdges(map, people, runs)
    else removeEdges(map)
  }
  useScent.setState({ plumes, group: people.length > 1 ? groupOf(f, runs) : null })
}

/**
 * The particle view: every particle of the plume replayed along its own
 * path, the 15-minute sit compressed into 12 seconds on a loop, each one a
 * soft puff that widens as it travels, as warm as the scent where it is at
 * nose height and fading out at a trace. A dashed line traces where it
 * stops being noticeable, labelled at its far tip. The emphasis is on path
 * and range; the cloud is the better read of how much. With several
 * people, everyone's particles play together, warm where their scent adds
 * up, inside one edge for them all.
 */
const particles = (() => {
  const LOOP_MS = 12_000
  const SHADES = 8
  let canvas: HTMLCanvasElement | null = null
  let raf = 0
  let map: MlMap | null = null
  interface Source {
    /** where this person sits, m east and north of the first */
    ox: number
    oy: number
    tr: PlumeTracks
    /** each step's nose-height level, everyone's scent together */
    level: Float32Array
    /** distance travelled at each step, m, which sets how wide the puff has spread */
    travel: Float32Array
  }
  let state: {
    f: Frame
    srcs: Source[]
    outline: Outline[]
    /** someone's scent is noticeable far enough out to draw its edge */
    edge: boolean
    /** one person: the outline's farthest point from them, and the reach to write there */
    tip: [number, number] | null
    label: string | null
  } | null = null
  let t0 = 0
  let sprites: HTMLCanvasElement[] | null = null
  let soft: HTMLCanvasElement | null = null

  /** A soft Gaussian puff per shade, pale amber at a trace to deep orange-red where strong. */
  function puffs(): HTMLCanvasElement[] {
    if (sprites) return sprites
    sprites = []
    for (let s = 0; s < SHADES; s++) {
      const v = s / (SHADES - 1)
      const c = document.createElement('canvas')
      c.width = c.height = 64
      const g = c.getContext('2d')!
      const rg = g.createRadialGradient(32, 32, 0, 32, 32, 32)
      const rgb = `255,${Math.round(200 - 150 * v)},${Math.round(90 - 70 * v)}`
      for (const [r, a] of [
        [0, 1],
        [0.25, 0.78],
        [0.5, 0.37],
        [0.75, 0.1],
        [1, 0],
      ])
        rg.addColorStop(r, `rgba(${rgb},${a})`)
      g.fillStyle = rg
      g.fillRect(0, 0, 64, 64)
      sprites.push(c)
    }
    return sprites
  }

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
    const { f: fr, srcs, outline, edge, tip, label } = state
    const project = (x: number, y: number) => m.project([fr.lon + x / fr.kx, fr.lat + y / fr.ky])
    const src = project(0, 0)
    const top = project(0, 100)
    const pxPerM = Math.hypot(top.x - src.x, top.y - src.y) / 100
    // sim time now, looping; standing still draws the end of the sit
    const T = still() ? TOTAL_S - DT : (((now - t0) % LOOP_MS) / LOOP_MS) * TOTAL_S
    const kf = T / DT
    const k = Math.floor(kf)
    const f = kf - k
    // the last minute fades, so the loop starts over without a blink
    const fade = Math.min(1, (TOTAL_S - T) / 60)
    const shade = puffs()
    // puffs are soft, so they go on a half-size buffer and are scaled up:
    // the same look for a small share of the fill a phone would do at full size
    const sw = Math.ceil(w / 2)
    const sh = Math.ceil(h / 2)
    if (!soft) soft = document.createElement('canvas')
    if (soft.width !== sw || soft.height !== sh) {
      soft.width = sw
      soft.height = sh
    }
    const sx = soft.getContext('2d')!
    sx.clearRect(0, 0, sw, sh)
    for (const { ox, oy, tr, level, travel } of srcs)
      for (let p = 0; p < tr.k0.length; p++) {
        const a = tr.k0[p]
        const b = tr.k1[p]
        if (k < a || k > b) continue
        const i = p * tr.steps + k
        const g = level[i]
        if (g < TRACE) continue
        const j = k < b ? i + 1 : i
        const x = ox + tr.x[i] + (tr.x[j] - tr.x[i]) * f
        const y = oy + tr.y[i] + (tr.y[j] - tr.y[i]) * f
        const v = Math.min(1, Math.log(g / TRACE) / -Math.log(TRACE))
        const q = project(x, y)
        // the puff's spread, m: a couple of metres at the body, widening with travel
        const sigma = 3 + 0.08 * (travel[i] + (travel[j] - travel[i]) * f)
        const half = Math.min(80, Math.max(2, sigma * pxPerM))
        // wide faint puffs overlap a lot, so a trace is kept thin or it would pile up to look strong
        sx.globalAlpha = (0.04 + 0.26 * v ** 1.2) * fade
        sx.drawImage(shade[Math.round(v * (SHADES - 1))], q.x / 2 - half, q.y / 2 - half, 2 * half, 2 * half)
      }
    sx.globalAlpha = 1
    ctx.drawImage(soft, 0, 0, w, h)
    // where it stops being noticeable: the cone's own edge, not a ring
    if (edge) {
      const trace = (o: Outline) => {
        ctx.beginPath()
        for (let n = 0; n < o.xy.length; n += 2) {
          const q = project(o.xy[n], o.xy[n + 1])
          if (n) ctx.lineTo(q.x, q.y)
          else ctx.moveTo(q.x, q.y)
        }
        if (o.closed) ctx.closePath()
      }
      ctx.lineJoin = 'round'
      ctx.setLineDash([6, 5])
      for (const o of outline) {
        trace(o)
        ctx.strokeStyle = 'rgba(20,10,4,0.45)'
        ctx.lineWidth = 3
        ctx.stroke()
        ctx.strokeStyle = 'rgba(255,170,90,0.9)'
        ctx.lineWidth = 1.5
        ctx.stroke()
      }
      ctx.setLineDash([])
      if (tip && label) {
        const q = project(tip[0], tip[1])
        const dx = q.x - src.x
        const dy = q.y - src.y
        const d = Math.hypot(dx, dy) || 1
        const lx = q.x + (dx / d) * 8
        const ly = q.y + (dy / d) * 8
        ctx.font = '600 11px system-ui, sans-serif'
        ctx.textAlign = dx < 0 ? 'right' : 'left'
        ctx.textBaseline = dy < 0 ? 'bottom' : 'top'
        ctx.fillStyle = 'rgba(255,200,140,0.95)'
        ctx.strokeStyle = 'rgba(20,10,4,0.85)'
        ctx.lineWidth = 3
        ctx.strokeText(label, lx, ly)
        ctx.fillText(label, lx, ly)
      }
    }
    if (!still()) raf = requestAnimationFrame(frame)
  }

  // standing still, the one frame is redrawn as the map moves
  const redrawStill = () => {
    if (still() && !raf && state) raf = requestAnimationFrame(frame)
  }

  return {
    start(m: MlMap, fr: Frame, runs: (PlumeRun | null)[]) {
      if (map !== m) {
        map?.off('move', redrawStill)
        map = m
        m.on('move', redrawStill)
      }
      ensureCanvas(m)
      const srcs: Source[] = []
      runs.forEach((r, who) => {
        if (!r) return
        const [ox, oy] = fr.off[who]
        // each particle step's nose-height level, looked up once from everyone's grid
        const tr = r.tracks
        const level = new Float32Array(tr.x.length)
        const travel = new Float32Array(tr.x.length)
        for (let p = 0; p < tr.k0.length; p++) {
          let s = 0
          for (let k = tr.k0[p]; k <= tr.k1[p]; k++) {
            const i = p * tr.steps + k
            const cx = Math.floor((ox + tr.x[i] - fr.west) / CELL_M)
            const cy = Math.floor((fr.north - oy - tr.y[i]) / CELL_M)
            level[i] = cx >= 0 && cy >= 0 && cx < fr.w && cy < fr.h ? fr.grid[cy * fr.w + cx] : 0
            // even in a calm the air stirs, so a puff never quite stops spreading
            s += k === tr.k0[p] ? Math.hypot(tr.x[i], tr.y[i]) : Math.max(1, Math.hypot(tr.x[i] - tr.x[i - 1], tr.y[i] - tr.y[i - 1]))
            travel[i] = s
          }
        }
        srcs.push({ ox, oy, tr, level, travel })
      })
      const outline = noticeOutline(fr.grid, fr.w, fr.h, fr.west, fr.north)
      // one person: their reach, written at the far tip; with more it would say whose
      let tip: [number, number] | null = null
      const one = runs.length === 1 ? runs[0] : null
      if (one) {
        let far = 0
        for (const o of outline)
          for (let n = 0; n < o.xy.length; n += 2) {
            const d = Math.hypot(o.xy[n], o.xy[n + 1])
            if (d > far) {
              far = d
              tip = [o.xy[n], o.xy[n + 1]]
            }
          }
      }
      const edge = runs.some((r) => r && r.plume.reach >= 40)
      // a person being dragged keeps the loop's clock, so the sit plays on
      if (!state) t0 = performance.now()
      state = { f: fr, srcs, outline, edge, tip, label: one ? reachLabel(one.plume) : null }
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
      soft = null
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

/** 'Everyone placed is off the map; you stay.' Takes the placed people off and leaves the live one. */
export function clearPlaced(): void {
  const s = useScent.getState()
  const live = s.people.filter((p) => p.live)
  if (!live.length) return s.clear()
  if (live.length === s.people.length) {
    if (s.adding) s.setAdding(false)
    return
  }
  useScent.setState({ people: live, pick: 0, adding: false })
}

/** The party's line: '2 sitters · scent over 5.2 ha'. */
export function sittersLine(g: Group, n: number): string {
  return `${n} sitters · scent over ${areaText(g.areaHa)}`
}

/** Ground in the user's units: '5.2 ha', '13 acres'. */
export function areaText(ha: number): string {
  const acres = useAppStore.getState().units === 'imperial'
  const v = acres ? ha * 2.471 : ha
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${acres ? 'acres' : 'ha'}`
}

const listText = (ns: string[]) => (ns.length < 2 ? ns[0] : `${ns.slice(0, -1).join(', ')} and ${ns[ns.length - 1]}`)

/**
 * The card's lines for two or more: the ground they scent together (and
 * how much of it only because cones overlap), and whose scent drifts over
 * whom, numbered from 1 (or "you", the live one out hunting); null when no
 * one's does.
 */
export function groupSummary(g: Group, people: Sitter[] = []): { head: string; drift: string | null } {
  const adds = g.addsHa >= 0.1 ? ` · overlap adds ${areaText(g.addsHa)}` : ''
  const name = (k: number) => (people[k]?.live ? 'you' : `${k + 1}`)
  const onto = new Map<number, string[]>()
  for (const [a, b] of g.reaches) onto.set(a, [...(onto.get(a) ?? []), name(b)])
  // the first names the scent; the rest are short: "1's scent drifts over you · yours over 2"
  const whose = (a: number, first: boolean) => (people[a]?.live ? (first ? 'Your scent' : 'yours') : `${a + 1}'s${first ? ' scent' : ''}`)
  const drift = [...onto].map(([a, bs], i) => `${whose(a, !i)} drifts over ${listText(bs)}`)
  return { head: `Noticeable over ${areaText(g.areaHa)} together${adds}`, drift: drift.length ? drift.join(' · ') : null }
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
  // a new style drops the cloud and the edges (the particles and the people are not in the style)
  const lost = (map: MlMap) => {
    const { people, view, hidden } = useScent.getState()
    return people.length > 0 && ((!hidden && drawnView(view, people.length) !== 'particles' && !map.getSource(SRC)) || (useScent.getState().distances && people.length > 1 && !map.getSource(DIST)))
  }
  onEachMap((map) => {
    map.on('styledata', () => {
      if (lost(map)) draw(map)
    })
  })
  withMap(() => {
    // one redraw a frame at most: a drag moves someone on every pointer move
    let queued = 0
    const schedule = () => {
      if (queued) return
      queued = requestAnimationFrame(() => {
        queued = 0
        redraw()
      })
    }
    const airChanged = () => {
      gen++
      if (useScent.getState().people.length) schedule()
    }
    useScent.subscribe((s, p) => {
      if (s.people !== p.people) {
        // the first person waits for the ground model, so their cone is not drawn twice
        if (s.people.length && !p.people.length) void loadMicro().then(schedule)
        else schedule()
      } else if (s.risk !== p.risk) airChanged()
      else if (s.people.length && (s.view !== p.view || s.hidden !== p.hidden || s.distances !== p.distances)) schedule()
      else if (s.people.length && s.pick !== p.pick) syncMarkers(getMap())
    })
    useAppStore.subscribe((s, p) => {
      if (s.planTimeMs !== p.planTimeMs && useScent.getState().people.length) schedule()
      if (s.units !== p.units && useScent.getState().distances && useScent.getState().people.length > 1) schedule()
      if (s.lowPower !== p.lowPower) particles.wake()
    })
    document.addEventListener('visibilitychange', () => {
      particles.wake()
      // out of a pocket: the cone catches up with the clock at once, not at the next minute
      if (document.visibilityState === 'visible' && useScent.getState().people.length && useAppStore.getState().planTimeMs == null) schedule()
    })
    // at "now" the cone keeps up with the clock, a minute at a time
    window.setInterval(() => {
      if (document.visibilityState === 'visible' && useScent.getState().people.length && useAppStore.getState().planTimeMs == null) schedule()
    }, 60_000)
    useWindChecks.subscribe(airChanged)
    onMicro(airChanged)
    onProfile(airChanged)
    onWeatherGrid(airChanged)
  })
}
