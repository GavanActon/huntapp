import { create } from 'zustand'
import { demTileAt, STREAM_PICTURES, terrainDepth } from '../map/streamPictures'
import { going, loadGoing, onGoing } from '../routes/goingGrid'
import { slopeFactor } from '../routes/walkModel'
import { habitat, loadHabitat, onHabitat, type Habitat } from '../spots/habitatGrid'
import { useAppStore } from '../state/appStore'
import { microCell } from '../weather/micro/model'
import { haversineM } from './measureMath'
import { useMeasureStore } from './measureStore'

/**
 * The ground under a measurement (Gavan, 2026-10-17): its heights along
 * the legs, for walking it (the distance over the ups and downs, the climb,
 * the time at the slope's pace) and for the elevation trace, with the
 * trees over the ground and each leg's sight line when asked for.
 *
 * Heights, sharpest first: the going grid's 10 m (the HD box's LiDAR,
 * build_going.py), the habitat grid's 30 m MRDEM over the area's box, and
 * past it the streamed heights (Mapterhorn) where pictures stream. The
 * trees are the wind grid's tree height (30 m, the SD tiles past the box).
 *
 * The sight line runs from eye height at a leg's start to a moose's back at
 * its end, the earth's bulge counted. At eye height you look under the
 * canopy, so tree tops say only that the line runs through the trees; how
 * far you see in there is the bush's (Lanes). Ground over the line blocks it.
 */

/** Metres between heights along a leg: the going grid's cell. */
const STEP_M = 10
/** No more heights than this along the whole measurement: a long one samples coarser. */
const MAX_SAMPLES = 2000
/** Eye height standing, and the height looked at: a moose's back. */
export const EYE_M = 1.7
export const TARGET_M = 1.5
/** The bulge of the earth over a line of sight, refraction taken off. */
const R_EARTH = 6371000
const K_REFRACT = 0.13
/** Trees shorter than this are brush, not a canopy to look through. */
const TREE_MIN_M = 3
/** The steepest grade is read over this run, so one cell's step is not a cliff. */
const GRADE_RUN_M = 30

export type HeightSource = 'lidar' | 'mrdem' | 'streamed'

export interface Sample {
  /** metres along the measurement from its first point */
  d: number
  lon: number
  lat: number
  /** ground height, m (NaN where nothing has one) */
  z: number
  /** tree height over the ground, m (0 where none or not known) */
  tree: number
  leg: number
}

export interface LegProfile {
  startD: number
  endD: number
  flatM: number
  /** walked over the ground, ups and downs counted */
  groundM: number
  climbM: number
  descentM: number
  timeS: number
  /** the sight line: a rise over it, through the trees, clear; null where the ends have no height */
  sight: 'rise' | 'trees' | 'clear' | null
  /** where a rise first blocks it, m along the measurement */
  blockD?: number
  /** metres of the line inside the trees */
  treesM: number
  /** the line's ends: eye height at the start, the back at the end */
  eyeZ: number
  targetZ: number
}

export interface Profile {
  samples: Sample[]
  legs: LegProfile[]
  flatM: number
  groundM: number
  climbM: number
  descentM: number
  timeS: number
  /** the steepest grade along it, rise over run, signed in the direction walked */
  steepest: number
  /** share of the line with no height */
  missing: number
  sources: HeightSource[]
}

export const useMeasureProfile = create<{ profile: Profile | null }>(() => ({ profile: null }))

/** A band's value between its cells. NaN outside or where a corner has none. */
function bilinear(h: Habitat, get: (i: number) => number, lon: number, lat: number): number {
  const x = (lon - h.west) / h.dLon - 0.5
  const y = (h.north - lat) / h.dLat - 0.5
  const c0 = Math.floor(x)
  const r0 = Math.floor(y)
  if (c0 < 0 || r0 < 0 || c0 + 1 >= h.cols || r0 + 1 >= h.rows) {
    const i = h.index(lon, lat)
    return i < 0 ? NaN : get(i)
  }
  const fx = x - c0
  const fy = y - r0
  const i = r0 * h.cols + c0
  const a = get(i)
  const b = get(i + 1)
  const c = get(i + h.cols)
  const d = get(i + h.cols + 1)
  if (![a, b, c, d].every(Number.isFinite)) return get(h.index(lon, lat))
  return a * (1 - fx) * (1 - fy) + b * fx * (1 - fy) + c * (1 - fx) * fy + d * fx * fy
}

/** The 30 m heights of the area's box, or null before the habitat grid has them. */
function mrdem(): ((lon: number, lat: number) => number) | null {
  const h = habitat()
  if (!h || !h.has('elev')) return null
  const raw = h.raw('elev')
  const s = h.scale('elev')
  return (lon, lat) =>
    bilinear(
      h,
      (i) => {
        const v = raw[i] * s
        return v > -500 ? v : NaN
      },
      lon,
      lat,
    )
}

const tileX = (lon: number, n: number) => ((lon + 180) / 360) * n
const tileY = (lat: number, n: number) => {
  const r = (lat * Math.PI) / 180
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n
}

/** The streamed heights for the samples nothing else has (pictures streamed only). */
async function streamedHeights(samples: Sample[], src: (HeightSource | null)[]): Promise<void> {
  const want = samples.map((s, i) => (Number.isFinite(s.z) ? -1 : i)).filter((i) => i >= 0)
  if (!want.length || !STREAM_PICTURES) return
  const z = Math.min(terrainDepth(), 14)
  const n = 2 ** z
  const tiles = new Map<string, Promise<{ width: number; height: number; data: Float32Array } | null>>()
  for (const i of want) {
    const key = `${Math.floor(tileX(samples[i].lon, n))}/${Math.floor(tileY(samples[i].lat, n))}`
    if (!tiles.has(key)) {
      const [x, y] = key.split('/').map(Number)
      tiles.set(
        key,
        demTileAt(z, x, y).then(
          (t) => t as { width: number; height: number; data: Float32Array },
          () => null,
        ),
      )
    }
  }
  for (const i of want) {
    const s = samples[i]
    const fx = tileX(s.lon, n)
    const fy = tileY(s.lat, n)
    const t = await tiles.get(`${Math.floor(fx)}/${Math.floor(fy)}`)
    if (!t) continue
    const px = Math.min(t.width - 1, Math.max(0, Math.floor((fx - Math.floor(fx)) * t.width)))
    const py = Math.min(t.height - 1, Math.max(0, Math.floor((fy - Math.floor(fy)) * t.height)))
    const v = t.data[py * t.width + px]
    if (Number.isFinite(v) && v > -500) {
      s.z = v
      src[i] = 'streamed'
    }
  }
}

/** The ground along the points, and what walking it and looking along it come to. */
async function build(points: [number, number][], paceKmh: number): Promise<Profile> {
  // the samples: every STEP_M along each leg, the leg's ends included
  const flat: number[] = []
  for (let i = 1; i < points.length; i++) flat.push(haversineM(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]))
  const total = flat.reduce((a, b) => a + b, 0)
  const step = Math.max(STEP_M, total / MAX_SAMPLES)
  const samples: Sample[] = []
  // each leg's first and last sample: a leg starts on the one the leg before ended on
  const ranges: [number, number][] = []
  let at = 0
  for (let l = 0; l < flat.length; l++) {
    const [a, b] = [points[l], points[l + 1]]
    const k = Math.max(1, Math.ceil(flat[l] / step))
    const from = l === 0 ? 0 : samples.length - 1
    for (let j = l === 0 ? 0 : 1; j <= k; j++) {
      const t = j / k
      samples.push({ d: at + flat[l] * t, lon: a[0] + (b[0] - a[0]) * t, lat: a[1] + (b[1] - a[1]) * t, z: NaN, tree: 0, leg: l })
    }
    ranges.push([from, samples.length - 1])
    at += flat[l]
  }

  // heights, sharpest first
  const g = going()
  const coarse = mrdem()
  const src: (HeightSource | null)[] = samples.map(() => null)
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]
    if (g) {
      const v = bilinear(g.grid, (k) => g.data.elev[k], s.lon, s.lat)
      if (Number.isFinite(v)) {
        s.z = v
        src[i] = 'lidar'
        continue
      }
    }
    if (coarse) {
      const v = coarse(s.lon, s.lat)
      if (Number.isFinite(v)) {
        s.z = v
        src[i] = 'mrdem'
      }
    }
  }
  await streamedHeights(samples, src)
  for (const s of samples) s.tree = Math.max(0, microCell(s.lon, s.lat)?.treeH ?? 0)

  // walking it: the distance over the ground, the climb, the time at the slope's pace
  const mps = paceKmh / 3.6
  const legs: LegProfile[] = flat.map((f) => ({ startD: 0, endD: 0, flatM: f, groundM: 0, climbM: 0, descentM: 0, timeS: 0, sight: null, treesM: 0, eyeZ: NaN, targetZ: NaN }))
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1]
    const b = samples[i]
    const leg = legs[b.leg]
    const run = b.d - a.d
    const dz = b.z - a.z
    if (Number.isFinite(dz)) {
      leg.groundM += Math.hypot(run, dz)
      if (dz > 0) leg.climbM += dz
      else leg.descentM -= dz
      leg.timeS += run / (mps * slopeFactor(run > 0 ? dz / run : 0))
    } else {
      leg.groundM += run
      leg.timeS += run / mps
    }
  }

  // the steepest grade, over a run long enough to be ground and not one cell's step
  let steepest = 0
  for (let i = 0, j = 0; i < samples.length; i++) {
    while (j < samples.length && samples[j].d - samples[i].d < GRADE_RUN_M) j++
    if (j >= samples.length) break
    const gr = (samples[j].z - samples[i].z) / (samples[j].d - samples[i].d)
    if (Number.isFinite(gr) && Math.abs(gr) > Math.abs(steepest)) steepest = gr
  }

  // each leg's sight line: eye height to a moose's back, the earth's bulge between
  for (let l = 0; l < legs.length; l++) {
    const leg = legs[l]
    const own = samples.slice(ranges[l][0], ranges[l][1] + 1)
    const first = own[0]
    const last = own[own.length - 1]
    leg.startD = first.d
    leg.endD = last.d
    if (!Number.isFinite(first.z) || !Number.isFinite(last.z)) continue
    const L = leg.endD - leg.startD
    leg.eyeZ = first.z + EYE_M
    leg.targetZ = last.z + TARGET_M
    let rise: number | undefined
    let trees = 0
    for (let k = 1; k < own.length - 1; k++) {
      const s = own[k]
      if (!Number.isFinite(s.z)) continue
      const x = s.d - leg.startD
      const line = leg.eyeZ + ((leg.targetZ - leg.eyeZ) * x) / L
      const bulge = (x * (L - x) * (1 - K_REFRACT)) / (2 * R_EARTH)
      if (s.z + bulge > line + 0.2 && rise == null) rise = s.d
      if (s.tree >= TREE_MIN_M && s.z + bulge + s.tree > line) trees += own[k + 1].d - s.d
    }
    leg.treesM = trees
    leg.sight = rise != null ? 'rise' : trees > 0 ? 'trees' : 'clear'
    if (rise != null) leg.blockD = rise
  }

  const sum = (f: (l: LegProfile) => number) => legs.reduce((a, l) => a + f(l), 0)
  const missing = samples.filter((s) => !Number.isFinite(s.z)).length / samples.length
  const sources = (['lidar', 'mrdem', 'streamed'] as HeightSource[]).filter((k) => src.includes(k))
  return { samples, legs, flatM: total, groundM: sum((l) => l.groundM), climbM: sum((l) => l.climbM), descentM: sum((l) => l.descentM), timeS: sum((l) => l.timeS), steepest, missing, sources }
}

let run = 0

/** Work the profile out again for the measurement as it stands, when it is wanted. */
async function refresh(): Promise<void> {
  const st = useMeasureStore.getState()
  const want = st.active && st.points.length >= 2 && (st.line === 'walking' || st.trace)
  const me = ++run
  if (!want) {
    if (useMeasureProfile.getState().profile) useMeasureProfile.setState({ profile: null })
    return
  }
  // the grids the heights come from, loaded once (a phone that never measures never reads them for this)
  void loadGoing()
  void loadHabitat()
  const profile = await build(st.points, useAppStore.getState().paceKmh)
  if (me === run) useMeasureProfile.setState({ profile })
}

let wired = false

/** Once, at startup (measureLayer's init): the profile follows the points, the options, the pace and the grids landing. */
export function initMeasureProfile(): void {
  if (wired) return
  wired = true
  useMeasureStore.subscribe((s, p) => {
    if (s.points !== p.points || s.active !== p.active || s.line !== p.line || s.trace !== p.trace || s.sight !== p.sight) void refresh()
  })
  useAppStore.subscribe((s, p) => {
    if (s.paceKmh !== p.paceKmh) void refresh()
  })
  onGoing(() => void refresh())
  onHabitat(() => void refresh())
}
