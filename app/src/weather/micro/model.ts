import { microFile } from '../../config'
import { devlog } from '../../devlog'
import { openBandFile, PREVIEW, type Band, type BandFile, type Habitat } from '../../spots/habitatGrid'
import { useAppStore } from '../../state/appStore'
import { homePlace } from '../../state/placesStore'
import { useSpotsStore } from '../../state/spotsStore'
import { estimateWaterTemp } from '../../spots/conditions'
import { startOfDayMs } from '../../time'
import { layeringAt, onProfile, type Layering } from '../boundaryLayer'
import { cachedPointForecast, compass, hourAt } from '../openMeteo'
import { sunPosition } from '../sun'
import { onWeatherGrid, windGridCovers, windGridInfo, windSampler } from '../windGrid'
import { checkWeight, metresBetween, STRENGTH_KMH, useWindChecks } from './windChecks'
import { biasFor, biasMatters, biasWords, learnBiases, type Bias, type Lesson } from './bias'
import { leavesDown, leavesNote } from './leaves'

/**
 * The ground wind: the air a hunter feels at head height, at a point and a
 * minute, built up in the layers of docs/MICRO-WIND.md:
 *
 *   regional   HRDPS 10 m wind at the point (windGrid's lattice)
 *   terrain    by day WindNinja's momentum solve, baked for 16 directions
 *              (build_windcfd.py), or the mass-consistent neutral lid on a
 *              grid without it; blended toward the stable lid by how
 *              decoupled the air is (boundaryLayer)
 *   thermals   cold-air drainage and pooling after the sun goes and the
 *              sky clears; upslope flow on sun-heated slopes; lake and
 *              land breezes from the land–lake temperature contrast
 *   canopy     the head-height fraction under the trees, the hardwoods in
 *              leaf or bare by the season (leaves.ts), the shelter and
 *              eddies downwind of a tree line, and the channelling along a
 *              slot between two of them
 *   checks     the hunter's own wind checks nearby, blended in
 *
 * and a direction spread (sigma) from the ground speed, the stability, the
 * canopy, edge eddies, how gusty the hour is and the ensemble's
 * disagreement: a scent cone, not a line. Every number is a model's, and the reasons say which part
 * decided it.
 */

export type Regime = 'wind' | 'drainage' | 'pooled' | 'upslope' | 'lakeBreeze' | 'landBreeze' | 'calm'

export const REGIME_LABEL: Record<Regime, string> = {
  wind: 'Forecast wind reaches the ground',
  drainage: 'Cold air draining',
  pooled: 'Cold air settled',
  upslope: 'Warm air rising upslope',
  lakeBreeze: 'Lake breeze',
  landBreeze: 'Land breeze',
  calm: 'Near dead calm',
}

/** What each regime does to scent, in a few words. */
export const REGIME_TIP: Record<Regime, string> = {
  wind: 'scent goes with the wind',
  drainage: 'scent sinks downhill',
  pooled: 'scent sits in the low ground',
  upslope: 'scent rises up the slope',
  lakeBreeze: 'scent carried inland',
  landBreeze: 'scent drifts out over the water',
  calm: 'scent hangs and spreads',
}

/** The colour class of a regime's window (ground.css); plain wind has none. */
export const REGIME_CLASS: Partial<Record<Regime, string>> = { drainage: 'gd-drain', pooled: 'gd-pool', upslope: 'gd-up', lakeBreeze: 'gd-breeze', landBreeze: 'gd-breeze' }

export interface Part {
  key: 'terrain' | 'drainage' | 'upslope' | 'breeze' | 'check'
  kmh: number
  /** bearing the air moves TOWARD */
  toward: number
}

export interface GroundWind {
  kmh: number
  /** blowing FROM */
  dirFrom: number
  /** 1-sigma spread of the direction, degrees */
  sigmaDeg: number
  regime: Regime
  /** true when the ground air has come loose from the wind above */
  decoupled: boolean
  swirl: boolean
  /** the wind comes down in bursts: a strong gust factor with wind to gust */
  gusty: boolean
  /** what a gust reaches at head height, km/h */
  gustKmh: number
  regionalKmh: number
  regionalDir: number
  /** local wind at 10 m over the surface (terrain and roughness only) */
  local10Kmh: number
  parts: Part[]
  headline: string
  reasons: string[]
  layering: Layering
  inGrid: boolean
  /** the cell is a slot in the trees: the slot rule decided the direction */
  inSlot: boolean
  inWoods: boolean
  /** the season's lesson applied to this call (bias.ts), if it was worth applying */
  bias: { deg: number; ratio: number } | null
}

// ---------------------------------------------------------------- the grid

let grid: Habitat | null = null
// bands by numeric id (K_*), not by name: this runs for every cell of the heat map
let bands: Band[] = []
let scales: number[] = []
let inflight: Promise<Habitat | null> | null = null
const listeners = new Set<() => void>()

const K_NUE = 0
const K_NVE = 1
const K_NUN = 2
const K_NVN = 3
const K_SUE = 4
const K_SVE = 5
const K_SUN = 6
const K_SVN = 7
const K_KATDIR = 8
const K_KATSPD = 9
const K_POOL = 10
// 11 drainAcc: baked, read only by microCell()
const K_THSLOPE = 12
const K_THASPECT = 13
const K_ONSHORE = 14
const K_SHOREDIST = 15
const K_BREEZEMAX = 16
const K_REL = 17
const K_CANOPY = 18
const K_TREEH = 19
// the canopy with the hardwoods bare (leaves.ts). A grid baked before it
// has none, and then the canopy stays in leaf all year, as it always did
const K_CANOPY_BARE = 20
const BAND_NAMES = ['nUe', 'nVe', 'nUn', 'nVn', 'sUe', 'sVe', 'sUn', 'sVn', 'katDir', 'katSpd', 'pool', 'drainAcc', 'thSlope', 'thAspect', 'onshore', 'shoreDist', 'breezeMax', 'rel', 'canopy', 'treeH', 'canopyBare']
let hasBare = false
// The momentum solve (pipeline/build_windcfd.py): WindNinja's 10 m flow for
// a unit wind from each of 16 directions, the roughness on, in the neutral
// lid's place. The 2D lid cannot make the lee wakes and the turning round
// the hills (checked against it 2026-10-04: turn r 0.55 at best). A grid
// baked before it has none, and reads the neutral lid as it always did
const MOM_STEP = 22.5
const MOM_N = 16
const momName = (k: number) => (k * MOM_STEP).toFixed(1).padStart(5, '0')
// A direction's bands sit at its index once loaded: the file is read in
// stages (habitatGrid.ts), the hour's two directions first, the rest once
// the map is up, and a sample that finds one missing asks for it (askDir)
// and blends the lids meanwhile
let momU: (Band | null)[] = []
let momV: (Band | null)[] = []
let momScale = 0
/** the file has the solve's bands at all */
let hasMom = false
// The solve's turbulence (2026-10-05 on): per direction, the spread of the
// wind's direction at 10 m, WindNinja's velocity fluctuation against its
// local wind. Most of an area sits near momRef, which is what the 12° the
// spread starts from stands for; past it is the air tumbling in the lee of
// a summit or a ridge, where the flow breaks away and circles back. Before,
// only trees made turbulence here, so a bare mountain's lee eddies drew
// smooth and narrow (Gavan, 2026-10-05, Highland Lake). A grid without the
// bands keeps the old spread
let momT: (Band | null)[] = []
let momTScale = 0
let momRef = 0
let hasTurb = false
/** degrees of tumble past which the place gets a word in the reasons, and past which it draws swirling */
const TUMBLE_NOTE = 12
const TUMBLE_SWIRL = 25

/** the momentum solve's bands: mU, mV, mT by direction */
const MOM_RE = /^m[UVT]\d{3}\.\d$/
let file: BandFile | null = null
/** the full-resolution base bands are the model's (not the preview's) */
let fullIn = false
/** settles when they are */
let fullReady: Promise<void> = Promise.resolve()

/** Bind the model's band table to a grid: the preview's (its names
 *  prefixed) for the first seconds, then the full one. */
function adopt(g: Habitat, prefix: string): void {
  const next: Band[] = []
  const nextScales: number[] = []
  BAND_NAMES.forEach((n, k) => {
    if (!g.has(prefix + n)) {
      if (k === K_CANOPY_BARE) return
      throw new Error(`micro grid: no band ${prefix + n}`)
    }
    next[k] = g.raw(prefix + n)
    nextScales[k] = g.scale(prefix + n)
  })
  bands = next
  scales = nextScales
  hasBare = g.has(prefix + 'canopyBare')
  grid = g
  slotAxis = null
}

/**
 * The grid, in stages (habitatGrid.ts reads the file by range): a coarse
 * preview of the base bands first, when the file carries one, which the
 * streaks and the cones draw on within a second or two of a cold open;
 * the full base bands next, in place of it; then the two momentum
 * directions the hour's wind sits between (ensureMomentumFor), which
 * sharpen the field as they land; the other fourteen once the map is up
 * (loadRestOfMicro). Resolves at the first stage there is. Null when the
 * file is not baked and not cached.
 */
export function loadMicro(): Promise<Habitat | null> {
  if (grid) return Promise.resolve(grid)
  if (inflight) return inflight
  inflight = openBandFile(microFile(), 'wind', { priority: 'high' })
    .then(async (f) => {
      if (!f) return null
      const names = f.names
      const baseNames = names.filter((n) => !MOM_RE.test(n) && !n.startsWith(PREVIEW))
      const previewNames = f.previewNames
      const dirs = Array.from({ length: MOM_N }, (_, k) => momName(k))
      hasMom = dirs.every((d) => names.includes(`mU${d}`) && names.includes(`mV${d}`))
      if (hasMom) {
        momU = Array.from({ length: MOM_N }, (): Band | null => null)
        momV = Array.from({ length: MOM_N }, (): Band | null => null)
        momScale = f.header.bands.find((b) => b.name === `mU${dirs[0]}`)!.scale
      } else {
        momU = momV = []
        devlog('wind', 'micro grid has no momentum solve: the day wind is the neutral lid')
      }
      const mom = (f.header.model as { momentum?: { spreadRef?: number } } | undefined)?.momentum
      hasTurb = hasMom && mom?.spreadRef != null && dirs.every((d) => names.includes(`mT${d}`))
      if (hasTurb) {
        momT = Array.from({ length: MOM_N }, (): Band | null => null)
        momTScale = f.header.bands.find((b) => b.name === `mT${dirs[0]}`)!.scale
        momRef = mom!.spreadRef!
      } else {
        momT = []
        if (hasMom) devlog('wind', 'micro grid has no turbulence from the momentum solve: only trees make the air swirl')
      }
      file = f
      const full = async () => {
        await f.load(baseNames, 'high')
        adopt(f.grid, '')
        fullIn = true
        if (!hasBare) devlog('wind', 'micro grid has no canopyBare: the canopy stays in leaf whatever the date')
        if (previewNames.length) devlog('wind', 'micro grid at full resolution')
        for (const cb of listeners) cb()
        if (hasMom) {
          void ensureMomentumFor(planMs())
          restTimer = window.setTimeout(() => void loadRestOfMicro(), REST_AFTER_MS)
        } else void f.keep()
      }
      if (previewNames.length && f.preview) {
        // the coarse copy first: the wind is up on it while the full bands come
        await f.load(previewNames, 'high')
        adopt(f.preview, PREVIEW)
        for (const cb of listeners) cb()
        fullReady = full()
        fullReady.catch((e) => devlog('wind', `micro grid base bands failed · ${(e as Error).message}`))
      } else {
        fullReady = full()
        await fullReady
      }
      return grid
    })
    .catch((e) => {
      devlog('wind', `micro grid load failed · ${(e as Error).message}`)
      bands = []
      return null
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

export function microGrid(): Habitat | null {
  return grid
}

const planMs = () => useAppStore.getState().planTimeMs ?? Date.now()

/** The two baked directions either side of a wind from dirFrom. */
function sectorsOf(dirFrom: number): [number, number] {
  const x = (((dirFrom % 360) + 360) % 360) / MOM_STEP
  const k0 = Math.floor(x) % MOM_N
  return [k0, (k0 + 1) % MOM_N]
}

/** The directions the hour's wind over the area sits between: the field
 *  at the grid's corners and middle (it turns a little across the region),
 *  else the camp's forecast hour. Null with no wind to go on yet. */
function sectorsFor(ms: number): number[] | null {
  const g = grid
  if (!g) return null
  const out = new Set<number>()
  const add = (d: number) => {
    for (const k of sectorsOf(d)) out.add(k)
  }
  const s = windGridCovers(ms) ? windSampler(ms) : null
  if (s) {
    const e = g.west + g.cols * g.dLon
    const so = g.north - g.rows * g.dLat
    const pts: [number, number][] = [
      [g.west, g.north],
      [e, g.north],
      [g.west, so],
      [e, so],
      [(g.west + e) / 2, (g.north + so) / 2],
    ]
    for (const [lon, lat] of pts) if (s(lon, lat, _reg)) add(_reg[1])
  }
  if (!out.size) {
    const home = homePlace()
    const f = cachedPointForecast(home.lon, home.lat)
    const h = f ? hourAt(f, ms) : null
    if (h && Number.isFinite(h.windDir)) add(h.windDir)
  }
  return out.size ? [...out] : null
}

const dirLoads = new Map<number, Promise<void>>()
/** directions something on screen asked for: their landing is told to everyone who reads the ground wind */
const wantedDirs = new Set<number>()

/** The solve's bands for these directions, those not in or on their way,
 *  fetched and attached. Everyone who reads the ground wind hears when a
 *  direction the view asked for lands; the rest coming in behind the view
 *  (loadRestOfMicro, low) changes nothing on screen, so it says nothing,
 *  which spares a second scoring pass. */
function loadDirs(ks: number[], priority: RequestPriority): Promise<void> {
  const f = file
  if (!f || !hasMom) return Promise.resolve()
  if (priority !== 'low') for (const k of ks) if (!momU[k]) wantedDirs.add(k)
  const want = ks.filter((k) => !momU[k] && !dirLoads.has(k))
  if (want.length) {
    const names = want.flatMap((k) => [`mU${momName(k)}`, `mV${momName(k)}`, ...(hasTurb ? [`mT${momName(k)}`] : [])])
    const run = f
      .load(names, priority)
      .then(() => {
        const g = f.grid
        for (const k of want) {
          const d = momName(k)
          momU[k] = g.raw(`mU${d}`)
          momV[k] = g.raw(`mV${d}`)
          if (hasTurb) momT[k] = g.raw(`mT${d}`)
        }
        const asked = want.filter((k) => wantedDirs.has(k))
        for (const k of asked) wantedDirs.delete(k)
        devlog('wind', `momentum ${want.map((k) => momName(k)).join(' ')}° in${asked.length ? '' : ' · behind the view'}`)
        if (asked.length) for (const cb of listeners) cb()
      })
      .catch((e) => devlog('wind', `momentum ${want.map((k) => momName(k)).join(' ')}° failed · ${(e as Error).message}`))
      .finally(() => {
        for (const k of want) if (dirLoads.get(k) === run) dirLoads.delete(k)
      })
    for (const k of want) dirLoads.set(k, run)
  }
  return Promise.all(ks.map((k) => dirLoads.get(k))).then(() => undefined)
}

// a sample that finds a direction missing asks for it, once per frame
const askedDirs = new Set<number>()
let askTimer: number | null = null
function askDir(k: number) {
  if (momU[k] || dirLoads.has(k) || askedDirs.has(k)) return
  askedDirs.add(k)
  if (askTimer != null) return
  askTimer = window.setTimeout(() => {
    askTimer = null
    const ks = [...askedDirs]
    askedDirs.clear()
    void loadDirs(ks, 'high')
  }, 0)
}

/** The directions the hour's wind needs, fetched first: as soon as there
 *  is wind data to pick them by, asking again for a while until there is.
 *  A pick that misses is put right by the sampler's own asks. */
export function ensureMomentumFor(ms: number): Promise<void> {
  if (!hasMom || !file) return Promise.resolve()
  const ks = sectorsFor(ms)
  if (ks) return loadDirs(ks, 'high')
  return new Promise((resolve) => {
    let tries = 0
    const again = () => {
      const now = sectorsFor(ms)
      if (now) return void loadDirs(now, 'high').then(resolve)
      if (++tries > 20) return resolve()
      window.setTimeout(again, 500)
    }
    window.setTimeout(again, 500)
  })
}

/** The base bands at full resolution in (or the file found missing): what
 *  the habitat grid waits for before taking its share of the line. */
export async function microBaseReady(): Promise<void> {
  await loadMicro()
  await fullReady.catch(() => {})
}

/** For the spots pass: the base bands and the hour's directions, or as
 *  much as comes within the cap (a stalled range must not hold the heat;
 *  a direction landing later rescores). */
export async function microReadyFor(ms: number, capMs = 6000): Promise<void> {
  const g = await loadMicro()
  if (!g) return
  // the full base bands, not the preview (the heat is scored once, on the real grid)
  await Promise.race([fullReady.catch(() => {}), new Promise<void>((r) => setTimeout(r, capMs))])
  if (!hasMom) return
  await Promise.race([ensureMomentumFor(ms), new Promise<void>((r) => setTimeout(r, capMs))])
}

let restTimer: number | null = null
let restDone = false
/** How long after the base bands the rest is fetched anyway, with no first heat to wait for (the heat off). */
const REST_AFTER_MS = 12_000

/** The other directions, after the first view (the heat's first pass, else
 *  a while after the base bands), behind everything else on the line, so
 *  a swing in the wind or a Dig in at another hour has them; then the whole
 *  file is kept on the phone. */
export function loadRestOfMicro(): Promise<void> {
  const f = file
  if (!f || restDone) return Promise.resolve()
  restDone = true
  if (restTimer != null) {
    clearTimeout(restTimer)
    restTimer = null
  }
  if (!hasMom) return f.keep()
  return loadDirs(
    Array.from({ length: MOM_N }, (_, k) => k),
    'low',
  ).then(() => f.keep())
}

/** Called when the micro grid lands, and when the leaves knob moves under
 *  a loaded one: either way the ground wind is not what it was. */
export function onMicro(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

// ---------------------------------------------------------------- context per minute

const RAD = Math.PI / 180
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const BEARING_Q = 360 / 250

interface Ctx {
  ms: number
  lay: Layering
  sunElev: number
  sunAz: number
  regional: ((lon: number, lat: number, out: Float32Array) => boolean) | null
  fallback: { kmh: number; dir: number } | null
  waterC: number
  /** gust over mean at 10 m this hour, 1–3; 1 when the forecast says nothing */
  gf: number
  checks: ReturnType<typeof useWindChecks.getState>['checks']
  /** what the season's checks have taught, by lesson (bias.ts) */
  biases: Map<Lesson, Bias>
  /** how far the hardwoods' leaves are down, 0 in leaf to 1 bare (leaves.ts) */
  leaves: number
}

function makeCtx(ms: number): Ctx {
  const home = homePlace()
  const sun = sunPosition(ms, home.lat, home.lon)
  const f = cachedPointForecast(home.lon, home.lat)
  const h = f ? hourAt(f, ms) : null
  const lay = layeringAt(ms, { cloud: h?.cloudPct ?? 50, w10: h?.windKmh ?? 8, t2: h?.tempC ?? 8, sunElev: sun.elevDeg })
  const d = new Date(ms)
  const doy = Math.floor((startOfDayMs(ms) - new Date(d.getFullYear(), 0, 1).getTime()) / 86_400_000) + 1
  const cond = useSpotsStore.getState().conditions
  const waterC = cond && startOfDayMs(cond.timeMs) === startOfDayMs(ms) ? cond.waterTempC : estimateWaterTemp(doy, null, d).t
  return {
    ms,
    lay,
    sunElev: sun.elevDeg,
    sunAz: sun.azDeg,
    // past the field's last hour, the camp's forecast (fallback), not that hour held
    regional: windGridCovers(ms) ? windSampler(ms) : null,
    fallback: h ? { kmh: h.windKmh, dir: h.windDir } : Number.isFinite(lay.w10) && Number.isFinite(lay.d10) ? { kmh: lay.w10, dir: lay.d10 } : null,
    waterC,
    gf: h && Number.isFinite(h.gustKmh) ? clamp(h.gustKmh / Math.max(1, h.windKmh), 1, 3) : 1,
    checks: useWindChecks.getState().checks,
    biases: learnBiases(useWindChecks.getState().checks, ms),
    leaves: leavesDown(ms),
  }
}

/** How much harder a gust blows than the mean at 10 m this minute, 1–3. */
export function groundGust(ms: number): number {
  return makeCtx(ms).gf
}

function b(k: number, i: number): number {
  return bands[k][i] * scales[k]
}
function bearing(k: number, i: number): number | null {
  const v = bands[k][i]
  return v === 255 ? null : v * BEARING_Q
}

// momentumAt's answer, east and north km/h: no array made per cell
let momE = 0
let momN = 0
/** The momentum solve's 10 m wind at a cell for a regional U km/h from
 *  dirFrom: the two baked directions either side, each field turned with
 *  the wind to its own direction, weighted by how near it is (165° from the
 *  135° and 180° runs came within 2.5° of its own run, median). */
function momentumAt(i: number, U: number, dirFrom: number): boolean {
  const x = (((dirFrom % 360) + 360) % 360) / MOM_STEP
  const k0 = Math.floor(x) % MOM_N
  const k1 = (k0 + 1) % MOM_N
  const t = x - Math.floor(x)
  // a direction still on its way (the file comes in stages): asked for, and the lids stand in
  if (!momU[k0] || !momU[k1]) {
    askDir(k0)
    askDir(k1)
    return false
  }
  momE = 0
  momN = 0
  momTurned(k0, i, U * (1 - t), t * MOM_STEP)
  momTurned(k1, i, U * t, (t - 1) * MOM_STEP)
  return true
}
/** The solve's direction spread at a cell, degrees: the two nearest baked
 *  directions, weighted by how near. Null while either is on its way. */
function turbAt(i: number, dirFrom: number): number | null {
  const x = (((dirFrom % 360) + 360) % 360) / MOM_STEP
  const k0 = Math.floor(x) % MOM_N
  const k1 = (k0 + 1) % MOM_N
  const t = x - Math.floor(x)
  const a = momT[k0]
  const b = momT[k1]
  if (!a || !b) return null
  return (a[i] * (1 - t) + b[i] * t) * momTScale
}

/** Direction k's field at a cell, times w, turned clockwise by deg. */
function momTurned(k: number, i: number, w: number, deg: number): void {
  if (w === 0) return
  const u = momU[k]![i] * momScale
  const v = momV[k]![i] * momScale
  const c = Math.cos(deg * RAD)
  const sn = Math.sin(deg * RAD)
  momE += w * (u * c + v * sn)
  momN += w * (-u * sn + v * c)
}

/** The head-height fraction of a cell: the baked canopy, in leaf, moved
 *  toward the bare-branch one as far as the leaves are down. With them on,
 *  or a grid without the bare band, it is the canopy exactly. */
function canopyAt(i: number, leaves: number): number {
  const c = b(K_CANOPY, i)
  return leaves > 0 && hasBare ? c + (b(K_CANOPY_BARE, i) - c) * leaves : c
}

/** The bare canopy lets through a fifth more wind or better (and a point
 *  at least, past the band's rounding): the leaves are worth a word there. */
function leavesMatter(i: number): boolean {
  if (!hasBare) return false
  const c = b(K_CANOPY, i)
  const bare = b(K_CANOPY_BARE, i)
  return bare >= 1.2 * c && bare - c >= 0.01
}

function vec(kmh: number, toward: number): [number, number] {
  return [kmh * Math.sin(toward * RAD), kmh * Math.cos(toward * RAD)]
}
function towardOf(e: number, n: number): number {
  return ((Math.atan2(e, n) / RAD) % 360 + 360) % 360
}

interface Eval {
  e: number
  n: number
  sigma: number
  regime: Regime
  swirl: boolean
  gusty: boolean
  parts: Part[]
  reasons: string[] | null
  local10: number
  U: number
  dirFrom: number
  inGrid: boolean
  slot: boolean
  /** the cell is in a stand: the head-height wind came down through a canopy */
  woods: boolean
  bias: Bias | null
  /** the gusts here against the hour's gust factor: 1.3 in the gusty zone inside a windward edge */
  gustMul?: number
}

const EDGE_STEPS = [15, 30, 45, 60, 90, 120, 160, 200]
const _reg = new Float32Array(2)
/** The shoreline rules (SHORE-WIND.md 1 and 2) can be held off for a
 *  before/after on the same air (scripts/replay.py); the app never does. */
let shoreRules = true
export function setShoreRules(on: boolean): void {
  shoreRules = on
}

// ---------------------------------------------------------------- slots in the trees

/**
 * A slot: a long narrow opening with walls of trees down both sides, like
 * the bog corridors and old cutlines here. A wind across it is blocked and
 * the along-slot part runs the length of it, so the air at head height
 * follows the slot whatever the forecast says (forced channelling, as in a
 * valley: Whiteman & Doran 1993, and gap and street-canyon flow).
 *
 * The shape of a cell's opening never changes, so each one is worked out
 * the first time it is asked for and kept for as long as the grid is.
 */
const SLOT_DIRS = 24
const SLOT_STEP = 15
const SLOT_CAP = 300

// −1 not worked out yet, −2 not a slot, else the long axis in degrees, 0…179
let slotAxis: Int16Array | null = null
let slotWall = new Float32Array(0)
let slotOpen = new Int8Array(0)
/** fetch in SLOT_DIRS bearings, in SLOT_STEP steps */
let slotFetch = new Uint8Array(0)

interface Slot {
  /** the long axis, 0…179: the air runs along it either way */
  axis: number
  /** across the slot, m */
  width: number
  /** the walls down the sides, m */
  wall: number
  /** +1 when the open end is the axis bearing, −1 when it is the other */
  openSign: number
}

/** Metres to the first stand over 6 m along a bearing; water and open
 *  ground count as open, and so does the edge of the grid. */
function fetchTo(g: Habitat, i: number, brg: number): number {
  for (let x = SLOT_STEP; x <= SLOT_CAP; x += SLOT_STEP) {
    const j = g.offset(i, brg, x)
    if (j < 0) return SLOT_CAP
    if (b(K_TREEH, j) >= 6) return x
  }
  return SLOT_CAP
}

/** The tree-line ramp: full shelter within 3 tree heights, recovered by 10. */
function shelterOf(fetch: number, wall: number): number {
  const rel = fetch / Math.max(wall, 1)
  if (rel < 3) return 0.25
  if (rel < 10) return 0.25 + (0.75 * (rel - 3)) / 7
  return 1
}

function slotFetchAt(i: number, brg: number): number {
  const k = ((Math.round(brg / SLOT_STEP) % SLOT_DIRS) + SLOT_DIRS) % SLOT_DIRS
  return slotFetch[i * SLOT_DIRS + k] * SLOT_STEP
}

function slotAt(g: Habitat, i: number): Slot | null {
  if (!slotAxis) {
    slotAxis = new Int16Array(g.size).fill(-1)
    slotWall = new Float32Array(g.size)
    slotOpen = new Int8Array(g.size)
    slotFetch = new Uint8Array(g.size * SLOT_DIRS)
  }
  const done = slotAxis[i]
  if (done === -2) return null
  const base = i * SLOT_DIRS
  const half = SLOT_DIRS / 2
  if (done < 0) {
    for (let k = 0; k < SLOT_DIRS; k++) slotFetch[base + k] = fetchTo(g, i, k * SLOT_STEP) / SLOT_STEP
    let k0 = 0
    let long = -1
    for (let k = 0; k < half; k++) {
      const l = slotFetch[base + k] + slotFetch[base + k + half]
      if (l > long) {
        long = l
        k0 = k
      }
    }
    const kp = (k0 + half / 2) % half
    const across = slotFetch[base + kp] + slotFetch[base + kp + half]
    let wall = 0
    for (const k of [kp, kp + half]) {
      const j = g.offset(i, k * SLOT_STEP, slotFetch[base + k] * SLOT_STEP)
      const hj = j >= 0 ? b(K_TREEH, j) : 0
      if (hj >= 6) wall = Math.max(wall, hj)
    }
    if (!wall) wall = 13
    // long enough against its width, and narrow enough for the walls to hold the cross flow
    if (long < 2.5 * across || across * SLOT_STEP >= 6 * wall + 30) {
      slotAxis[i] = -2
      return null
    }
    slotAxis[i] = k0 * SLOT_STEP
    slotWall[i] = wall
    slotOpen[i] = slotFetch[base + k0] >= slotFetch[base + k0 + half] ? 1 : -1
  }
  const axis = slotAxis[i]
  const kp = (axis / SLOT_STEP + half / 2) % half
  return { axis, width: (slotFetch[base + kp] + slotFetch[base + kp + half]) * SLOT_STEP, wall: slotWall[i], openSign: slotOpen[i] }
}

/** "NW–SE": the axis named from the end nearer north. */
function slotLine(axis: number): string {
  const a = axis <= 90 ? axis : axis + 180
  return `${compass(a)}–${compass(a + 180)}`
}

function evaluate(ctx: Ctx, lon: number, lat: number, withReasons: boolean, edges = true): Eval | null {
  // regional 10 m wind
  let U: number
  let dirFrom: number
  if (ctx.regional && ctx.regional(lon, lat, _reg)) {
    U = _reg[0]
    dirFrom = _reg[1]
  } else if (ctx.fallback) {
    U = ctx.fallback.kmh
    dirFrom = ctx.fallback.dir
  } else return null
  const lay = ctx.lay
  const reasons: string[] | null = withReasons ? [] : null
  const [Ue, Un] = vec(U, dirFrom + 180)

  const g = grid
  const i = g ? g.index(lon, lat) : -1
  if (!g || i < 0) {
    // off the grid: an open-ground profile, nothing local
    const f = 0.7 * (1 - 0.6 * lay.stable)
    const sp = U * f
    return { e: Ue * f, n: Un * f, sigma: 15 + 60 * Math.exp(-sp / 3.6 / 0.6), regime: sp < 0.8 ? 'calm' : 'wind', swirl: false, gusty: ctx.gf >= 1.8 && U >= 8, parts: [{ key: 'terrain', kmh: sp, toward: (dirFrom + 180) % 360 }], reasons, local10: U, U, dirFrom, inGrid: false, slot: false, woods: false, bias: null }
  }

  // ---- terrain and roughness: the two lids, blended by stability ----
  const s = lay.stable
  let e10: number
  let n10: number
  if (hasMom && fullIn && momentumAt(i, U, dirFrom)) {
    // by day the momentum solve; it is neutral air only, so a still night still goes to the stable lid
    e10 = (1 - s) * momE + s * (b(K_SUE, i) * Ue + b(K_SUN, i) * Un)
    n10 = (1 - s) * momN + s * (b(K_SVE, i) * Ue + b(K_SVN, i) * Un)
  } else {
    // no solve, or its directions for this wind not in yet: the two lids
    e10 = (1 - s) * (b(K_NUE, i) * Ue + b(K_NUN, i) * Un) + s * (b(K_SUE, i) * Ue + b(K_SUN, i) * Un)
    n10 = (1 - s) * (b(K_NVE, i) * Ue + b(K_NVN, i) * Un) + s * (b(K_SVE, i) * Ue + b(K_SVN, i) * Un)
  }
  // the air tumbling in the lee of the high ground, degrees of spread past
  // the area's ordinary: neutral air, like the solve, and a wind with some
  // push to it (in a near calm the slopes' own flows run the place)
  const spread = hasTurb && fullIn ? turbAt(i, dirFrom) : null
  const tumble = spread != null ? Math.max(0, spread - momRef) * (1 - s) * clamp((U - 3) / 6, 0, 1) : 0
  const local10 = Math.hypot(e10, n10)
  // low ground under an inversion: the cold layer stays put under the wind
  const pool = b(K_POOL, i)
  const lowness = Math.max(clamp(pool / 1.5, 0, 1), clamp(-b(K_REL, i) / 6, 0, 1))
  // NWP models mix stable nights too much, so their 10 m wind runs high
  // then (Sandu et al. 2013); and low ground under an inversion keeps its
  // cold layer while the wind slides over
  const dec = (1 - 0.3 * s) * (1 - 0.7 * s * lowness)
  e10 *= dec
  n10 *= dec
  const mech10 = Math.hypot(e10, n10)

  // ---- canopy and edges ----
  const th = b(K_TREEH, i)
  // the leaves: the point clouds measured the hardwoods in leaf
  let cf = canopyAt(i, ctx.leaves)
  let shelter = 1
  let swirl = false
  let slotSwirl = false
  let edgeNote: string | null = null
  let walls = 0
  let gustMul = 1
  // inside the windward edge of a stand (SHORE-WIND.md rule 2): the first
  // tree heights in carry the wind off the open ground upwind, from half
  // the open share at the edge down to the stand's own by 5 h, and the
  // air gusts hardest 3–8 h in, where the flow coming over the canopy
  // reaches down (Dupont & Brunet 2008; Cassiani, Katul & Albertson 2008)
  if (shoreRules && edges && th >= 6 && mech10 > 0.5) {
    const from = towardOf(e10, n10) + 180
    for (const x of EDGE_STEPS) {
      const j = g.offset(i, from, x)
      if (j < 0) break
      if (b(K_TREEH, j) < 6) {
        // open ground, not a one-cell gap: the cell beyond it is open too
        const j2 = g.offset(i, from, x + 30)
        if (j2 >= 0 && b(K_TREEH, j2) >= 6) break
        const rel = x / th
        if (rel < 5) {
          const cfEdge = 0.5 * canopyAt(j, ctx.leaves)
          if (cfEdge > cf) {
            cf = cfEdge + (cf - cfEdge) * (rel / 5)
            edgeNote = `${x} m inside the stand's edge: the wind off the open ground upwind gets in here`
          }
        }
        if (rel >= 3 && rel < 8) gustMul = 1.3
        break
      }
    }
  }
  // a tree line ahead on open ground (SHORE-WIND.md rule 1): the wind
  // slows over the last ten tree heights before a wall, the part of it
  // square onto the wall is held off and lifts over, and the rest runs
  // along the wall (Raupach et al. 2001; the Sault WindNinja run with the
  // trees as raised ground: 0.9 at 10 h, 0.76 at 5 h, 0.64 at 3.5 h)
  let ahead = 1
  let aheadN = 1
  let wallE = 0
  let wallN = 0
  const open = edges && th === 0 && mech10 > 0.5
  if (open) {
    const toward = towardOf(e10, n10)
    for (const x of EDGE_STEPS) {
      const j = g.offset(i, toward, x)
      if (j < 0) break
      const hj = b(K_TREEH, j)
      if (hj >= 6) {
        const rel = x / hj
        if (rel < 10) {
          ahead = 0.55 + 0.45 * clamp((rel - 1) / 9, 0, 1)
          aheadN = rel < 2 ? 0.4 : rel < 5 ? 0.4 + (0.6 * (rel - 2)) / 3 : 1
          // the wall's line: where it is nearest within 60° either side of downwind
          let best = x
          let brg = toward
          for (const d of [-60, -45, -30, -15, 15, 30, 45, 60]) {
            const f = fetchTo(g, i, toward + d)
            if (f < best) {
              best = f
              brg = toward + d
            }
          }
          wallE = Math.sin(brg * RAD)
          wallN = Math.cos(brg * RAD)
          if (rel < 1) swirl = true
          edgeNote = `a ${Math.round(hj)} m tree line ${x} m ahead: the wind slows${aheadN < 1 ? ' and runs along it' : ' as it lifts over'}${rel < 1 ? ', eddying against it' : ''}`
        }
        break
      }
    }
  }
  if (open) {
    const from = towardOf(e10, n10) + 180
    for (const x of EDGE_STEPS) {
      const j = g.offset(i, from, x)
      if (j < 0) break
      const hj = b(K_TREEH, j)
      if (hj >= 6) {
        const rel = x / hj
        if (rel < 3) {
          shelter = 0.25
          swirl = true
        } else if (rel < 10) {
          shelter = 0.25 + (0.75 * (rel - 3)) / 7
          swirl = rel < 5
        }
        if (rel < 10) edgeNote = `${x} m downwind of a ${Math.round(hj)} m tree line: sheltered${swirl ? ', and the air eddies and swaps direction' : ''}`
        break
      }
    }
    // a small opening, trees close on three sides or more: it swirls
    for (const brg of [0, 90, 180, 270]) {
      for (const x of [15, 30, 45]) {
        const j = g.offset(i, brg, x)
        if (j >= 0 && b(K_TREEH, j) >= 6) {
          walls++
          break
        }
      }
    }
    if (walls >= 3) {
      swirl = true
      shelter = Math.min(shelter, 0.5)
      edgeNote ??= 'a small opening in the trees: the wind swirls in it'
    }
  }
  // a stable surface layer thins the wind toward the ground well below
  // the neutral log law (Monin–Obukhov: u2/u10 ≈ 0.4–0.5 on a clear calm night)
  // under a canopy too: the AmeriFlux towers (pipeline/towers/fit.py,
  // 2026-10-07) put the floor at about 0.6 of its mixed-air share when the
  // air above is settled (Treehaven mixedwood 0.13 stable / 0.28 unstable)
  const gm = cf * (th === 0 ? 1 - 0.45 * s : 1 - 0.3 * s)
  let mechE = e10 * gm * shelter
  let mechN = n10 * gm * shelter
  // a slot in the trees: the along-slot part of the wind runs the length of
  // it, the cross part is held off by the wall it comes from, and some of
  // what is blocked leaves by the open end. This takes the place of the
  // plain shelter behind one tree line.
  const slot = open ? slotAt(g, i) : null
  if (slot) {
    const axE = Math.sin(slot.axis * RAD)
    const axN = Math.cos(slot.axis * RAD)
    const along = e10 * axE + n10 * axN
    const crossE = e10 - along * axE
    const crossN = n10 - along * axN
    const cross = Math.hypot(crossE, crossN)
    const fCross = slotFetchAt(i, cross > 1e-6 ? towardOf(crossE, crossN) + 180 : 0)
    // inside three tree heights of the wall it comes from, the cross flow is
    // a weak return eddy the other way
    let shCross = fCross < 3 * slot.wall ? -0.1 : shelterOf(fCross, slot.wall)
    if (walls >= 3) shCross = Math.min(shCross, 0.5)
    // the along flow gathers down the slot, so it keeps more than it would
    // behind a plain edge, and never nothing
    const shAlong = Math.max(0.6, shelterOf(slotFetchAt(i, along < 0 ? slot.axis : slot.axis + 180), slot.wall))
    const alongH = along * shAlong + slot.openSign * 0.3 * cross
    mechE = gm * (alongH * axE + crossE * shCross)
    mechN = gm * (alongH * axN + crossN * shCross)
    slotSwirl = slot.width < 5 * slot.wall && Math.abs(along) < cross
    swirl = slotSwirl
    // funnelling when the along-slot flow is what is left; a wind square across
    // the slot leaves only the return eddy and the pump, an unsteady drift
    if (reasons) {
      const funnels = Math.abs(alongH) >= 2 * cross * Math.abs(shCross)
      edgeNote = `a ${Math.round(slot.width / 10) * 10} m slot in the trees running ${slotLine(slot.axis)}: ${funnels ? 'the wind funnels along it toward the' : 'the wind across it swirls, drifting toward the'} ${compass(towardOf(mechE, mechN))}`
    }
  }
  // only on a clean approach: a cell already sheltered by a wall upwind, or
  // in a small opening, is a clearing between walls, not a windward edge
  if (shoreRules && !slot && ahead < 1 && shelter === 1 && walls < 3) {
    // split by the wall's line: the part square onto it is held off
    const nrm = mechE * wallE + mechN * wallN
    const tE = mechE - nrm * wallE
    const tN = mechN - nrm * wallN
    mechE = ahead * (tE + nrm * wallE * aheadN)
    mechN = ahead * (tN + nrm * wallN * aheadN)
  }
  const mechG = Math.hypot(mechE, mechN)
  // enough wind, and enough of a gust factor, that the air comes down in bursts
  const gusty = ctx.gf >= 1.8 && mech10 >= 8

  // mechanical mixing wipes out the thermal flows
  const mixNight = Math.exp(-Math.max(0, mech10 - 5) / 8)
  const mixDay = Math.exp(-Math.max(0, mech10 - 8) / 10)
  const inTrees = th > 0

  // ---- cold-air drainage ----
  let kat = 0
  let katTo = 0
  const cool = Math.pow(1 - lay.cloud / 100, 1.5) * (ctx.sunElev < 0 ? 1 : ctx.sunElev < 10 ? (10 - ctx.sunElev) / 10 : 0)
  const sKat = clamp(Math.max(lay.inversion * s, 0.6 * cool), 0, 1.5) * mixNight
  const kd = bearing(K_KATDIR, i)
  if (sKat > 0.02 && kd != null) {
    kat = b(K_KATSPD, i) * 3.6 * sKat * (inTrees ? 0.7 : 1)
    katTo = kd
  }

  // ---- upslope on sun-heated slopes ----
  let ana = 0
  let anaTo = 0
  const facing = bearing(K_THASPECT, i)
  if (ctx.sunElev > 3 && lay.sw > 80 && facing != null) {
    const sl = b(K_THSLOPE, i) * RAD
    const el = ctx.sunElev * RAD
    const cosInc = Math.sin(el) * Math.cos(sl) + Math.cos(el) * Math.sin(sl) * Math.cos((ctx.sunAz - facing) * RAD)
    const heat = (lay.sw * Math.max(0, cosInc)) / Math.max(0.15, Math.sin(el))
    const sAna = clamp(heat / 600, 0, 1.5) * (1 - s) * mixDay
    ana = 1.4 * Math.sqrt(Math.sin(sl)) * 3.6 * sAna * (inTrees ? 0.5 : 1)
    anaTo = (facing + 180) % 360
  }

  // ---- lake and land breezes ----
  let brz = 0
  let brzTo = 0
  let brzKind: 'lake' | 'land' | null = null
  const on = bearing(K_ONSHORE, i)
  if (on != null) {
    const d = b(K_SHOREDIST, i)
    const dT = lay.t2 - ctx.waterC
    if (ctx.sunElev > 10 && dT > 1) {
      const S = clamp((dT - 1) / 6, 0, 1) * clamp(lay.sw / 500, 0, 1) * Math.exp(-d / 500) * Math.exp(-Math.max(0, mech10 - 10) / 10)
      brz = b(K_BREEZEMAX, i) * 3.6 * S * (inTrees ? 0.6 : 1)
      brzTo = on
      brzKind = 'lake'
    } else if (dT < -1) {
      const S = clamp((-dT - 1) / 6, 0, 1) * (1 - lay.cloud / 100) * Math.exp(-d / 300) * mixNight
      brz = 0.4 * b(K_BREEZEMAX, i) * 3.6 * S * (inTrees ? 0.6 : 1)
      brzTo = (on + 180) % 360
      brzKind = 'land'
    }
  }

  const [kE, kN] = vec(kat, katTo)
  const [aE, aN] = vec(ana, anaTo)
  const [bE, bN] = vec(brz, brzTo)
  let E = mechE + kE + aE + bE
  let N = mechN + kN + aN + bN

  // ---- which part decides it ----
  let regime: Regime = 'wind'
  const mags: [Regime, number][] = [
    ['wind', mechG],
    [pool > 0.3 ? 'pooled' : 'drainage', kat],
    ['upslope', ana],
    [brzKind === 'land' ? 'landBreeze' : 'lakeBreeze', brz],
  ]
  let best = -1
  for (const [r, m] of mags)
    if (m > best) {
      best = m
      regime = r
    }
  // low, flat ground on a settling night keeps its own cold air: a frost
  // pocket, whether or not it is a closed hollow (open bogs above all)
  const settled = (pool > 0.3 || (lowness > 0.25 && b(K_THSLOPE, i) < 1.5)) && Math.max(s, cool) > 0.4
  const spOwn = Math.hypot(E, N)
  if (spOwn < 0.8) regime = settled ? 'pooled' : 'calm'
  else if (settled && (regime === 'drainage' || mechG < 1.5)) regime = 'pooled'

  // ---- the season's lesson ----
  // What the wind checks have taught about calls like this one (bias.ts):
  // a turn and a speed ratio for the regime, or for the slot rule where
  // the cell is a slot. Applied to the model's own vector before the
  // checks nearby blend in, so a check made now still corrects locally on
  // top of it.
  // plain wind under a canopy is its own lesson: how much of the wind
  // above the trees the floor gets (the canopy decay, build_microclimate)
  // is the least certain number in the chain, and the checks of 2026
  // called it 3–4× low in breezy air
  const lesson: Lesson = slot ? 'slot' : th > 0 && regime === 'wind' ? 'woods' : regime
  const lessonBias = biasFor(ctx.biases, lesson)
  const applied = biasMatters(lessonBias) && spOwn >= 0.8
  if (applied) {
    const [bE2, bN2] = vec(spOwn * lessonBias.ratio, towardOf(E, N) + lessonBias.deg)
    E = bE2
    N = bN2
  }

  // ---- the hunters' checks nearby ----
  // Each check nearby is averaged into the model's vector at its weight
  // (windChecks.ts: by time and distance), every check counting the same,
  // so with several people's checks the side with more of them carries it.
  // Where the checks disagree with each other (the wind swinging between
  // two checks, or two people feeling different things) the average alone
  // would read as a steady wind down the middle, or cancel to a calm: the
  // circular spread of the checks' own directions (the resultant length R
  // of their unit vectors, the usual measure for wind directions) is held
  // as a floor on sigma instead, scaled by how much of the answer the
  // checks make up. Checks that agree tighten the spread; checks that
  // disagree open it.
  let wsum = 0
  let oE = 0
  let oN = 0
  let uE = 0
  let uN = 0
  let wdir = 0
  let nChecks = 0
  const who = new Set<string>()
  let nearest: { min: number; m: number; ago: boolean } | null = null
  // a check logged as swinging holds the spread open at its own arc
  let swingFloor = 0
  for (const c of ctx.checks) {
    const w = checkWeight(c, lon, lat, ctx.ms)
    if (w < 0.03) continue
    const k = STRENGTH_KMH[c.strength]
    const [ce, cn] = c.dirFrom == null ? [0, 0] : vec(k, c.dirFrom + 180)
    oE += w * ce
    oN += w * cn
    wsum += w
    nChecks++
    who.add(c.by || 'you')
    if (c.dirFrom != null && c.strength !== 'calm') {
      const [ue, un] = vec(1, c.dirFrom + 180)
      uE += w * ue
      uN += w * un
      wdir += w
    }
    if (c.swingDeg) swingFloor = Math.max(swingFloor, (w * c.swingDeg) / 2)
    const mins = Math.round(Math.abs(ctx.ms - c.ts) / 60_000)
    if (!nearest || mins < nearest.min) nearest = { min: mins, m: Math.round(metresBetween(lon, lat, c.lon, c.lat)), ago: c.ts <= ctx.ms }
  }
  if (wsum > 0) {
    E = (E + oE) / (1 + wsum)
    N = (N + oN) / (1 + wsum)
  }
  // the checks' own spread about their mean direction: R = 1 all one way, 0 every way
  const R = wdir > 0 ? Math.hypot(uE, uN) / wdir : 1
  const checkSpread = R < 0.999 ? (Math.sqrt(-2 * Math.log(Math.max(R, 1e-3))) * 180) / Math.PI : 0
  const checkFloor = (checkSpread * wsum) / (1 + wsum)

  const sp = Math.hypot(E, N)
  const Ug = sp / 3.6

  // ---- spread ----
  let sigma = 12 + tumble + 70 * Math.exp(-Ug / 0.6) + 20 * s * Math.exp(-Ug / 1.0) + 15 * lay.convective + (inTrees ? 8 : 0) + (swirl ? 40 : 0) + (slotSwirl ? 25 : 0)
  const thermal = kat + ana + brz
  const fracMech = mechG / (mechG + thermal + 1e-6)
  // gusty air swings more: a gust factor of 2.5 means the along-wind
  // fluctuation is about 0.6 of the mean (Wieringa 1973)
  sigma += 12 * clamp(ctx.gf - 1.5, 0, 1) * fracMech
  if (lay.ensDirSd != null) sigma = Math.hypot(sigma, fracMech * lay.ensDirSd * 0.7)
  // nearby checks that agree tighten the spread; a swing, or checks that disagree, hold it open
  if (wsum > 0.3 && !swingFloor && checkSpread < 25) sigma *= 0.75
  sigma = clamp(Math.max(sigma, swingFloor, checkFloor), 8, 110)

  const parts: Part[] = []
  if (withReasons && mechG > 0.05) parts.push({ key: 'terrain', kmh: mechG, toward: towardOf(mechE, mechN) })
  if (withReasons && kat > 0.05) parts.push({ key: 'drainage', kmh: kat, toward: katTo })
  if (withReasons && ana > 0.05) parts.push({ key: 'upslope', kmh: ana, toward: anaTo })
  if (withReasons && brz > 0.05) parts.push({ key: 'breeze', kmh: brz, toward: brzTo })

  if (reasons) {
    const dT = lay.dTheta - 0.0098 * 78 // plain temperature difference 80 m − 2 m
    if (s > 0.5 && dT > 0.5) reasons.push(`Air at the ground is ${dT.toFixed(1)}° colder than at 80 m: it has come loose from the ${Math.round(lay.w80)} km/h wind above`)
    else if (s > 0.3) reasons.push('The air is settling: the forecast wind reaches the ground only in gusts')
    if (lay.convective > 0.4) reasons.push('Sun-driven mixing: the wind comes down in gusts and swings')
    if (gusty) reasons.push(`Gusts to ${Math.round(U * ctx.gf)} km/h at 10 m: the wind comes down in bursts and swings`)
    const ratio = local10 / Math.max(0.1, U)
    const turn = Math.abs((((towardOf(e10, n10) - (dirFrom + 180)) % 360) + 540) % 360 - 180)
    if (ratio > 1.15) reasons.push(`Terrain and open ground speed the wind up about ${Math.round((ratio - 1) * 100)}% here`)
    else if (ratio < 0.85) reasons.push(`Terrain and trees shelter this spot: the 10 m wind is about ${Math.round((1 - ratio) * 100)}% lighter`)
    if (turn >= 12 && U > 3) reasons.push(`The land turns the wind ${Math.round(turn)}° here`)
    if (tumble >= TUMBLE_NOTE) reasons.push(`The air tumbles in the lee of the high ground: the wind swings about ±${Math.round(12 + tumble)}° here${turn >= 120 ? ', and on the whole runs back the way it came' : ''}`)
    if (s > 0.4 && lowness > 0.3) reasons.push('Low ground: the cold layer sits here under the wind')
    if (kat > 0.3) reasons.push(`Cold air drains toward the ${compass(katTo)} at about ${kat.toFixed(1)} km/h${pool > 0.3 || lowness > 0.25 ? ', settling here: scent sits and creeps toward the outlet' : ': scent goes with it, downhill'}`)
    if (ana > 0.3) reasons.push(`The sun heats this slope: air rises upslope toward the ${compass(anaTo)} at about ${ana.toFixed(1)} km/h`)
    if (brz > 0.3) reasons.push(brzKind === 'lake' ? `Land warmer than the lake by ${Math.round(lay.t2 - ctx.waterC)}°: an onshore lake breeze toward the ${compass(brzTo)}` : `Land colder than the lake: air drifts off the shore toward the ${compass(brzTo)}`)
    if (inTrees) {
      // the leaves get a word where the bare canopy lets through noticeably more, once they are mostly down
      const note = ctx.leaves > 0.5 && leavesMatter(i) ? leavesNote(ctx.ms) : null
      reasons.push(`In ${Math.round(th)} m trees: head-height wind about ${Math.round(cf * 100)}% of the wind over them${note ? `, ${note}` : ''}`)
    }
    if (edgeNote) reasons.push(edgeNote[0].toUpperCase() + edgeNote.slice(1))
    if (applied) reasons.push(biasWords(lessonBias, lesson))
    if (lay.ensDirSd != null && lay.ensDirSd > 35 && fracMech > 0.4) reasons.push(`Forecast models disagree on the direction (±${Math.round(lay.ensDirSd)}°)`)
    if (nearest && nChecks === 1) reasons.push(`Blended with ${who.has('you') ? 'your' : `${[...who][0]}'s`} wind check ${nearest.m < 20 ? 'here' : `${nearest.m} m away`}, ${nearest.min} min ${nearest.ago ? 'before' : 'after'} this time`)
    else if (nearest) {
      const people = who.size > 1 ? ` from ${who.size} people (${[...who].join(', ')})` : ''
      reasons.push(
        checkSpread >= 25
          ? `Blended with ${nChecks} wind checks nearby${people}, which disagree by about ±${Math.round(checkSpread)}°: the spread is held open that wide, and the side with more checks carries the direction`
          : `Blended with ${nChecks} wind checks nearby${people}, agreeing within about ±${Math.round(Math.max(checkSpread, 5))}°; the nearest ${nearest.m < 20 ? 'here' : `${nearest.m} m away`}, ${nearest.min} min ${nearest.ago ? 'before' : 'after'} this time`,
      )
    }
    if (lay.source === 'estimate') reasons.push('No layering forecast cached: stability estimated from the sky and the wind')
  }

  return { e: E, n: N, sigma, regime, swirl: swirl || tumble >= TUMBLE_SWIRL, gusty, parts, reasons, local10, U, dirFrom, inGrid: true, slot: !!slot, woods: th > 0, bias: applied ? lessonBias : null, gustMul }
}

function headlineOf(ev: Eval, kmh: number, dirFrom: number, gustKmh: number): string {
  const to = compass((dirFrom + 180) % 360)
  switch (ev.regime) {
    case 'calm':
      return 'Near dead calm: scent hangs and spreads every way'
    case 'pooled':
      return `Cold air settled in this low ground: scent sits, creeping toward the ${to}`
    case 'drainage':
      return `Cold air draining toward the ${to}, ${kmh.toFixed(1)} km/h`
    case 'upslope':
      return `Warm air rising upslope toward the ${to}`
    case 'lakeBreeze':
      return `Lake breeze onshore toward the ${to}`
    case 'landBreeze':
      return `Land breeze off the shore toward the ${to}`
    default:
      return `Wind from the ${compass(dirFrom)}, ${Math.round(kmh)} km/h at head height${ev.gusty ? `, gusts to ${Math.round(gustKmh)}` : ''}`
  }
}

/** The ground wind at a point and minute, with its reasons. */
export function groundWind(lon: number, lat: number, ms: number): GroundWind | null {
  const ctx = makeCtx(ms)
  const ev = evaluate(ctx, lon, lat, true)
  if (!ev) return null
  const kmh = Math.hypot(ev.e, ev.n)
  const dirFrom = (towardOf(ev.e, ev.n) + 180) % 360
  // a gust gets through the shelter that thins the mean, so it is the mean × the factor
  const gustKmh = kmh * ctx.gf * (ev.gustMul ?? 1)
  return {
    kmh,
    dirFrom,
    sigmaDeg: ev.sigma,
    regime: ev.regime,
    decoupled: ctx.lay.stable > 0.5,
    swirl: ev.swirl,
    gusty: ev.gusty,
    gustKmh,
    regionalKmh: ev.U,
    regionalDir: ev.dirFrom,
    local10Kmh: ev.local10,
    parts: ev.parts,
    headline: headlineOf(ev, kmh, dirFrom, gustKmh),
    reasons: ev.reasons ?? [],
    layering: ctx.lay,
    inGrid: ev.inGrid,
    inSlot: ev.slot,
    inWoods: ev.woods,
    bias: ev.bias ? { deg: ev.bias.deg, ratio: ev.bias.ratio } : null,
  }
}

export interface CellGround {
  kmh: number
  dirFrom: number
  sigmaDeg: number
  regime: Regime
}

// bumped whenever an input changes, so the scorer's memo knows to refresh;
// the day memo (groundDay) is dropped on the same events
let version = 0
const dayMemo = new Map<string, Window[]>()
const bump = () => {
  version++
  dayMemo.clear()
}
listeners.add(bump)
onProfile(bump)
onWeatherGrid(bump)
useWindChecks.subscribe(bump)
// the leaves knob moves the head-height wind under every hardwood: to all
// that reads the ground wind (the cones, the heat map, the flow, the cards)
// it is as good as a new grid
useAppStore.subscribe((s, prev) => {
  if (s.leaves !== prev.leaves && grid) for (const cb of listeners) cb()
})

let memo: { ms: number; version: number; ctx: Ctx; kmh: Float32Array; dir: Float32Array; sig: Float32Array; reg: Uint8Array } | null = null
const REGIMES: Regime[] = ['wind', 'drainage', 'pooled', 'upslope', 'lakeBreeze', 'landBreeze', 'calm']

/** The ground wind for the Spots scorer: one context per minute, reused
 *  across the whole grid. `full` adds the tree-line search (eddies and
 *  shelter), which the heat map skips for speed. Null until the
 *  microclimate grid is loaded: the scorer then falls back to the forecast. */
export function groundForScoring(ms: number, lon: number, lat: number, full = false): CellGround | null {
  const g = grid
  if (!g) return null
  if (!memo || memo.ms !== ms || memo.version !== version) {
    // the heat map's cells, kept for the minute: a change of target or of
    // the weights rescores without recomputing the air
    const n = g.size
    memo = memo && memo.kmh.length === n ? { ...memo, ms, version, ctx: makeCtx(ms) } : { ms, version, ctx: makeCtx(ms), kmh: new Float32Array(n), dir: new Float32Array(n), sig: new Float32Array(n), reg: new Uint8Array(n) }
    memo.kmh.fill(-1)
  }
  const i = g.index(lon, lat)
  if (i < 0) return null
  if (!full && memo.kmh[i] >= 0) return { kmh: memo.kmh[i], dirFrom: memo.dir[i], sigmaDeg: memo.sig[i], regime: REGIMES[memo.reg[i]] }
  const ev = evaluate(memo.ctx, lon, lat, false, full)
  if (!ev || !ev.inGrid) return null
  const out = { kmh: Math.hypot(ev.e, ev.n), dirFrom: (towardOf(ev.e, ev.n) + 180) % 360, sigmaDeg: ev.sigma, regime: ev.regime }
  if (!full) {
    memo.kmh[i] = out.kmh
    memo.dir[i] = out.dirFrom
    memo.sig[i] = out.sigmaDeg
    memo.reg[i] = REGIMES.indexOf(out.regime)
  }
  return out
}

/** A fast sampler for particles and plumes: out = [east m/s, north m/s,
 *  sigma degrees] and, when the array has room, out[3]: 1 where the air
 *  swirls (an eddy behind a tree line, a small opening, a slot across the
 *  wind, the tumbling lee of a hill), 0.5 where it has settled or gone calm, else 0; out[4]: 1 where
 *  cold air drains, pools or flows off the shore (it hugs the ground: a
 *  land breeze is the land's cold air running out over the water), else 0.
 *  Null when there is no wind at all to start from. */
export type GroundSampler = (lon: number, lat: number, out: Float32Array) => boolean
export function groundSampler(ms: number): GroundSampler | null {
  const ctx = makeCtx(ms)
  if (!ctx.regional && !ctx.fallback) return null
  return (lon, lat, out) => {
    const ev = evaluate(ctx, lon, lat, false)
    if (!ev) return false
    out[0] = ev.e / 3.6
    out[1] = ev.n / 3.6
    out[2] = ev.sigma
    out[3] = ev.swirl ? 1 : ev.regime === 'calm' || ev.regime === 'pooled' ? 0.5 : 0
    out[4] = ev.regime === 'drainage' || ev.regime === 'pooled' || ev.regime === 'landBreeze' ? 1 : 0
    return true
  }
}

/** The air's layering at a time: 0…1 decoupled-stable, 0…1 sun-driven
 *  convective, and whether the lakes are warmer than the air over the land
 *  (by more than 1°, the land breeze's test in evaluate). Then the water
 *  heats the air over it from below and mixes it down to the surface,
 *  however still the night is over the land. */
export function groundStability(ms: number): { stable: number; convective: number; warmWater: boolean } {
  const ctx = makeCtx(ms)
  const l = ctx.lay
  return { stable: l.stable, convective: l.convective, warmWater: l.t2 - ctx.waterC < -1 }
}

export interface Window {
  startMs: number
  endMs: number
  regime: Regime
  dirFrom: number
  kmh: number
  decoupled: boolean
}

const DAY_MEMO_MAX = 64

/** The day at a point in windows of one regime (15-minute steps, anything
 *  under 45 minutes folded into its neighbour): day windows before hours.
 *  Memoised per point and day until an input changes (the grids, the
 *  layering profile, a wind check, or a fresh forecast at camp). */
export function groundDay(lon: number, lat: number, dayStartMs: number): Window[] {
  const home = homePlace()
  const f = cachedPointForecast(home.lon, home.lat)
  const key = `${lon.toFixed(4)},${lat.toFixed(4)},${dayStartMs},${f?.fetchedAt ?? 0},${f?.sat?.at ?? 0}`
  const hit = dayMemo.get(key)
  if (hit) return hit
  const out = groundDayPass(lon, lat, dayStartMs)
  if (dayMemo.size >= DAY_MEMO_MAX) dayMemo.delete(dayMemo.keys().next().value as string)
  dayMemo.set(key, out)
  return out
}

function groundDayPass(lon: number, lat: number, dayStartMs: number): Window[] {
  const steps: { ms: number; regime: Regime; e: number; n: number; dec: boolean }[] = []
  for (let k = 0; k < 96; k++) {
    const ms = dayStartMs + k * 15 * 60_000
    const ctx = makeCtx(ms)
    const ev = evaluate(ctx, lon, lat, false)
    if (!ev) continue
    steps.push({ ms, regime: ev.regime, e: ev.e, n: ev.n, dec: ctx.lay.stable > 0.5 })
  }
  // fold short runs into the previous run
  const runs: { i0: number; i1: number; regime: Regime }[] = []
  steps.forEach((st, k) => {
    const last = runs[runs.length - 1]
    if (last && last.regime === st.regime) last.i1 = k
    else runs.push({ i0: k, i1: k, regime: st.regime })
  })
  const merged: typeof runs = []
  for (const r of runs) {
    const last = merged[merged.length - 1]
    if (last && (r.i1 - r.i0 + 1 < 3 || last.regime === r.regime)) last.i1 = r.i1
    else merged.push({ ...r })
  }
  return merged.map((r) => {
    let e = 0
    let n = 0
    let dec = 0
    for (let k = r.i0; k <= r.i1; k++) {
      e += steps[k].e
      n += steps[k].n
      dec += steps[k].dec ? 1 : 0
    }
    const cnt = r.i1 - r.i0 + 1
    let spd = 0
    for (let k = r.i0; k <= r.i1; k++) spd += Math.hypot(steps[k].e, steps[k].n)
    return {
      startMs: steps[r.i0].ms,
      endMs: steps[r.i1].ms + 15 * 60_000,
      regime: r.regime,
      dirFrom: (towardOf(e, n) + 180) % 360,
      kmh: spd / cnt,
      decoupled: dec / cnt > 0.5,
    }
  })
}

// ---------------------------------------------------------------- around a moment

/** Local midnight after the day starting at `dayStartMs` (DST-safe). */
function nextDayStartMs(dayStartMs: number): number {
  const d = new Date(dayStartMs)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime()
}

/** The last moment the wind is forecast for: the end of the wind grid's
 *  last hour (satellite hours extend it), else the camp forecast's last
 *  hour, which makeCtx falls back to; null with neither. */
function windHorizonMs(): number | null {
  const info = windGridInfo()
  if (info) return info.endMs
  const home = homePlace()
  const times = cachedPointForecast(home.lon, home.lat)?.hourly.time
  return times && times.length ? Date.parse(times[times.length - 1]) + 3600_000 : null
}

const ownAir = (w: Window) => w.regime !== 'wind'
const drains = (w: Window) => w.regime === 'drainage' || w.regime === 'pooled'

/**
 * The ground's own air around a moment, for the hour detail: `now` is the
 * window the moment sits in when the ground air is anything but the plain
 * forecast wind, `next` the first such window after it (into the next day
 * while the wind is forecast). A run ending at midnight carries on into
 * the next morning's window of the same regime, so "till" reads 6:30, not
 * 12:00. Both null when the forecast wind reaches the ground for the rest
 * of the horizon, or past it.
 */
export function groundAirAround(lon: number, lat: number, ms: number): { now: Window | null; next: Window | null } {
  const horizon = windHorizonMs()
  if (horizon != null && ms >= horizon) return { now: null, next: null }
  const day0 = startOfDayMs(ms)
  let now: Window | null = null
  let next: Window | null = null
  for (const w of groundDay(lon, lat, day0)) {
    if (!ownAir(w)) continue
    if (ms >= w.startMs && ms < w.endMs) now = w
    else if (w.startMs > ms) {
      next = w
      break
    }
  }
  const day1 = nextDayStartMs(day0)
  if (((now && now.endMs >= day1) || !next) && (horizon == null || day1 < horizon)) {
    const tomorrow = groundDay(lon, lat, day1)
    const first = tomorrow[0]
    if (now && now.endMs >= day1 && first && first.regime === now.regime) now = { ...now, endMs: first.endMs }
    if (!next) {
      const after = now ? now.endMs : ms
      next = tomorrow.find((w) => ownAir(w) && w.startMs >= after) ?? null
    }
  }
  return { now, next }
}

/**
 * The evening run of cold air at a point: the drainage or pooled window
 * starting after 12:00 of the day, joined with what follows it of the
 * same kind and carried into the next morning while the wind is forecast.
 * Null past the horizon, or when the evening stays windy.
 */
export function drainWindow(lon: number, lat: number, dayStartMs: number): { startMs: number; endMs: number } | null {
  const d = new Date(dayStartMs)
  const noon = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12).getTime()
  const horizon = windHorizonMs()
  if (horizon == null || noon >= horizon) return null
  const wins = groundDay(lon, lat, dayStartMs)
  const k = wins.findIndex((w) => drains(w) && w.startMs >= noon)
  if (k < 0) return null
  const startMs = wins[k].startMs
  let endMs = wins[k].endMs
  for (let i = k + 1; i < wins.length && drains(wins[i]) && wins[i].startMs === endMs; i++) endMs = wins[i].endMs
  const day1 = nextDayStartMs(dayStartMs)
  if (endMs >= day1 && day1 < horizon) {
    for (const w of groundDay(lon, lat, day1)) {
      if (!drains(w) || w.startMs !== endMs) break
      endMs = w.endMs
    }
  }
  return { startMs, endMs }
}

/** The baked values under a point, for the dev console; with a time, the
 *  leaves then and the head-height fraction the model reads for them. */
export function microCell(lon: number, lat: number, ms?: number): Record<string, number> | null {
  const g = grid
  const i = g ? g.index(lon, lat) : -1
  if (!g || i < 0) return null
  const out: Record<string, number> = {}
  BAND_NAMES.forEach((n, k) => {
    if (bands[k]) out[n] = Math.round(b(k, i) * 100) / 100
  })
  if (ms != null) {
    out.leaves = Math.round(leavesDown(ms) * 100) / 100
    out.canopyNow = Math.round(canopyAt(i, leavesDown(ms)) * 1000) / 1000
  }
  return out
}
