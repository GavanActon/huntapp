import { inRegion, microFile, microHdFile, sdWindOn } from '../../config'
import { devlog } from '../../devlog'
import { habitat, openBandFile, PREVIEW, type Band, type BandFile, type Habitat } from '../../spots/habitatGrid'
import { useAppStore } from '../../state/appStore'
import { homePlace } from '../../state/placesStore'
import { useSpotsStore } from '../../state/spotsStore'
import { estimateWaterTemp } from '../../spots/conditions'
import { clockShort, startOfDayMs } from '../../time'
import { otherAreaAt } from '../../areas'
import { layeringAt, onProfile, type Layering } from '../boundaryLayer'
import { cachedPointForecast, compass, hourAt } from '../openMeteo'
import { sunPosition } from '../sun'
import { onWeatherGrid, windGridCovers, windGridInfo, windSampler } from '../windGrid'
import { angleDiff, CHECK_W0_SPEED, checkW0, checkWeight, maxReachMs, metresBetween, placeReach, puffBoost, SEEN_KMH, seenWeight, STRENGTH_KMH, useWindChecks, type Strength, type WindCheck } from './windChecks'
import { biasFor, biasMatters, biasWords, learnBiases, type Bias, type Lesson } from './bias'
import { fitAmbient, fitHoldsUntil, fitMatters, fitWeightAt, fitWeightsAt, fitWords, sessionAt, sessionsOf, sitScore as scoreSit, type AmbientFit, type MapProbeFn, type ProbeFn, type SitScore } from './ambientFit'
import { tuneValues, useScentTune, type TuneValues } from './scentTune'
import { leavesDown, leavesNote } from './leaves'
import { elevAt, ensureRelief, goingCellAt, onRelief, waterAt } from './relief'
import { dist as distWords, height as heightWords } from '../../lengths'

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
 *   checks     the sit's checks fitted as a turn and a ratio on the
 *              forecast wind (ambientFit.ts), applied before the land and
 *              the trees so the whole neighbourhood moves together; what
 *              is left at each check blended in locally by likeness;
 *              treetops seen moving far off turn the forecast wind itself (seen)
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
  /** the scent's spreads apart from the shown one (Spread) */
  spread: Spread
  regime: Regime
  /** true when the ground air has come loose from the wind above */
  decoupled: boolean
  swirl: boolean
  /** the wind comes down in bursts: a strong gust factor with wind to gust */
  gusty: boolean
  /** what a gust reaches at head height, km/h */
  gustKmh: number
  /** the 10 m wind it starts from: the forecast's, sharpened by any treetops seen */
  regionalKmh: number
  regionalDir: number
  /** the forecast's own 10 m speed, before the treetops seen */
  forecastKmh: number
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
  /** the sit's checks, fitted as the air above the trees (ambientFit.ts), as applied here */
  ambient: AmbientApplied | null
}

export interface AmbientApplied {
  /** the turn on the forecast direction here, degrees + clockwise, after the weight */
  turn: number
  /** the ratio on the forecast speed here, after the weight */
  ratio: number
  /** how much of the fit reaches this spot and moment, 0–1 */
  weight: number
  count: number
  sure: number
  holdsUntil: number
  words: string
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
/** drainage accumulation, cells (read by microCell and the scent column's drainage depth) */
const K_DRAINACC = 11
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
  leeRise.clear()
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
  const sd = sdWindOn()
  inflight = openBandFile(microFile(), 'wind', { priority: 'high' })
    .then((f) => {
      if (f || !sd) return f
      // SD set but its file neither on the server nor the phone: HD rather than no terrain wind
      devlog('wind', 'SD terrain wind not found: HD instead')
      return openBandFile(microHdFile(), 'wind', { priority: 'high' })
    })
    .then(async (f) => {
      if (!f) return null
      const mom = (f.header.model as { momentum?: { solver?: string; source?: string; spreadRef?: number } } | undefined)?.momentum
      const solver = mom?.solver
      // an SD area's one grid (micro-<area>.hab) carries the surrogate's bands too
      devlog('wind', `terrain wind: ${f.file === microHdFile() && mom?.source !== 'sd' ? 'HD momentum solve' : 'SD surrogate'}${solver ? ` · ${solver}` : ''}`)
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

/** The habitat grid shares the micro grid's cells: the same lattice in the same place. Not under
 *  the national tiles (useMosaic: the sampler's index is the mosaic's) nor the micro grid's coarse
 *  copy while its full bands come; there a stand's bands are not the cell's (2026-10-16: at Whitefish
 *  on the tiles the index ran past the habitat's end and every scent puff went NaN). */
export function habitatAligned(h: Habitat | null): h is Habitat {
  const g = grid
  return !!h && !!g && !areaGrid && h.cols === g.cols && h.rows === g.rows && Math.abs(h.west - g.west) < 0.25 * Math.abs(g.dLon) && Math.abs(h.north - g.north) < 0.25 * Math.abs(g.dLat)
}

/** Where a stand's make-up (crown, conifer, hardwood, and the bush's `thick` where it has it) is read
 *  at the sampler's cells: the micro grid itself when it carries the bands (a national tile with the
 *  habitat-lite's SCANFI bands under the same names), else the area's habitat where it is aligned. */
export function standBands(): Habitat | null {
  const g = grid
  if (g && g.has('crown') && g.has('conifer') && g.has('hardwood')) return g
  const h = habitat()
  return h && h.has('crown') && h.has('conifer') && h.has('hardwood') && habitatAligned(h) ? h : null
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
        // tiles stood in meanwhile (useMosaic): the area's own directions go to its kept state
        const into = file === f ? { u: momU, v: momV, t: momT, turb: hasTurb } : areaGrid?.file === f ? { u: areaGrid.momU, v: areaGrid.momV, t: areaGrid.momT, turb: areaGrid.hasTurb } : null
        if (!into) return
        for (const k of want) {
          const d = momName(k)
          into.u[k] = g.raw(`mU${d}`)
          into.v[k] = g.raw(`mV${d}`)
          if (into.turb) into.t[k] = g.raw(`mT${d}`)
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
  // the 10 m ground the lee of the land reads (riseUpwind), once the map is up
  ensureRelief()
  if (!hasMom) return f.keep()
  return loadDirs(
    Array.from({ length: MOM_N }, (_, k) => k),
    'low',
  ).then(() => f.keep())
}

// ---- SD wind tiles (windTiles.ts): past the area's box, a mosaic of the
// national tiles under the view takes the grid's place, every band in at
// once; back over the box, the area's own grid returns as it was left
type GridState = {
  grid: Habitat | null
  bands: Band[]
  scales: number[]
  hasBare: boolean
  file: BandFile | null
  fullIn: boolean
  momU: (Band | null)[]
  momV: (Band | null)[]
  momScale: number
  hasMom: boolean
  momT: (Band | null)[]
  momTScale: number
  momRef: number
  hasTurb: boolean
}
let areaGrid: GridState | null = null
/** the area's own grid while a mosaic of tiles stands in for it */
export const onTiles = () => areaGrid != null

export function useMosaic(g: Habitat, mom: { scale: number; tScale: number; spreadRef: number }): void {
  areaGrid ??= { grid, bands, scales, hasBare, file, fullIn, momU, momV, momScale, hasMom, momT, momTScale, momRef, hasTurb }
  adopt(g, '')
  file = null
  fullIn = true
  const dirs = Array.from({ length: MOM_N }, (_, k) => momName(k))
  hasMom = dirs.every((d) => g.has(`mU${d}`) && g.has(`mV${d}`))
  momU = hasMom ? dirs.map((d) => g.raw(`mU${d}`)) : []
  momV = hasMom ? dirs.map((d) => g.raw(`mV${d}`)) : []
  momScale = mom.scale
  hasTurb = hasMom && dirs.every((d) => g.has(`mT${d}`))
  momT = hasTurb ? dirs.map((d) => g.raw(`mT${d}`)) : []
  momTScale = mom.tScale
  momRef = mom.spreadRef
  for (const cb of listeners) cb()
}

export function useAreaGrid(): void {
  const a = areaGrid
  if (!a) return
  areaGrid = null
  ;({ grid, bands, scales, hasBare, file, fullIn, momU, momV, momScale, hasMom, momT, momTScale, momRef, hasTurb } = a)
  slotAxis = null
  leeRise.clear()
  for (const cb of listeners) cb()
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
  /** the treetops seen moving that still count at this minute, as what each does to the forecast wind */
  seen: SeenShift[]
  /** what the season's checks have taught, by lesson (bias.ts) */
  biases: Map<Lesson, Bias>
  /** the place's memory: checks of other days, to come back when the air is in the same situation */
  memory: Remembered[]
  /** how far the hardwoods' leaves are down, 0 in leaf to 1 bare (leaves.ts) */
  leaves: number
  /** the sit's fit of the air above the trees, to apply by distance and age; `full` for a probe, applied as is */
  ambient: Applied | null
  /** a probe while a momentum direction is still on its way: the lids for every candidate alike */
  lidsOnly?: boolean
  /** the spread's knobs (scentTune.ts): near-calm, swirl, trees, and how far a fresh puff tightens it */
  tune: TuneValues
}

interface Applied {
  turn: number
  lnRatio: number
  /** ln of the weight on the cold air's drainage (ambientFit.ts) */
  lnDrain: number
  fit: AmbientFit | null
  full: boolean
}

/**
 * A look at the treetops far off, as what it does to the forecast wind: a
 * turn in degrees and a speed ratio (as a log), taken against the forecast
 * where and when it was seen, so the forecast's own change over the hour
 * and across the area carries on under it. A look at a near calm forecast
 * (under 3 km/h, its direction is noise) or one with no forecast saved
 * holds its wind as it was seen instead: `abs`.
 */
interface SeenShift {
  c: WindCheck
  turn: number
  lnRatio: number
  abs: { kmh: number; dirFrom: number | null } | null
}

const SEEN_RATIO_LO = 0.2
const SEEN_RATIO_HI = 3

function seenShifts(ms: number, checks: WindCheck[]): SeenShift[] {
  const out: SeenShift[] = []
  for (const c of checks) {
    if (!c.seen || seenWeight(c, c.lon, c.lat, ms) <= 0) continue
    const kmh = SEEN_KMH[c.seen]
    const dir = c.strength === 'calm' ? null : c.dirFrom
    const f = c.forecast
    if (!f || f.kmh < 3) {
      out.push({ c, turn: 0, lnRatio: 0, abs: { kmh, dirFrom: dir } })
      continue
    }
    const turn = dir == null ? 0 : ((((dir - f.dirFrom) % 360) + 540) % 360) - 180
    out.push({ c, turn, lnRatio: Math.log(clamp(kmh / f.kmh, SEEN_RATIO_LO, SEEN_RATIO_HI)), abs: null })
  }
  return out
}

/**
 * The place's memory (docs/WIND-LEARNING.md, layer 4): a felt check comes
 * back on another day when the air is in the same situation, not for a
 * ring of time and distance. Gavan's check on the Searchmont valley floor,
 * from 308° at dusk under a 152° forecast, says "when the forecast is SSE
 * at dusk, the floor here runs back from the NW"; the next morning the
 * same floor ran along the valley under a southerly at midday, so the time
 * of day is part of the situation as much as the wind is.
 *
 * A check is remembered as its turn off the forecast it had (so a
 * remembered check carries over when the forecast itself has moved a
 * little), the forecast's speed, and the sun's part of the day where it
 * was made. It comes back, once out of the live blend's reach, wherever
 * the forecast now runs within 45° of the remembered one (in full within
 * 15°), at a speed within a factor 2.5, in the same part of the day:
 * night, the low sun of morning, the low sun of evening, or day. It weighs
 * at most a third of a fresh check's say (MEMORY_SHARE), as far as the
 * fresh check would have reached, scaled by likeness in model.ts, and
 * fades over the season (MEMORY_DAYS). A check with no forecast saved (one
 * made before 2026-10-06) has nothing to be remembered against.
 */
interface Remembered {
  c: WindCheck
  /** the felt wind's turn off the forecast it had, degrees, + clockwise */
  turn: number
  fDir: number
  fKmh: number
  part: DayPart
}

type DayPart = 'night' | 'low-am' | 'low-pm' | 'day'

/** The sun's part of the day: below civil twilight, the low sun either side of noon, or up. */
function dayPart(ms: number, lat: number, lon: number): DayPart {
  const sun = sunPosition(ms, lat, lon)
  if (sun.elevDeg < -6) return 'night'
  if (sun.elevDeg < 8) return sun.azDeg < 180 ? 'low-am' : 'low-pm'
  return 'day'
}

const DAY_PART_WORD: Record<DayPart, string> = { night: 'at night', 'low-am': 'in the morning', 'low-pm': 'in the evening', day: 'by day' }
/** a remembered check's say against a fresh one's */
const MEMORY_SHARE = 1 / 3
/** it fades with this e-folding, days */
const MEMORY_DAYS = 45
/** and is forgotten after this many */
const MEMORY_MAX_DAYS = 120

const memoryMemo = new WeakMap<WindCheck[], Remembered[]>()

/** The checks to remember at a moment: felt ones with a direction and a forecast saved, out of the live blend's reach by then. */
function memoryOf(checks: WindCheck[], ms: number): Remembered[] {
  let all = memoryMemo.get(checks)
  if (!all) {
    all = []
    for (const c of checks) {
      if (c.seen || c.dirFrom == null || c.strength === 'calm' || !c.forecast || c.forecast.kmh < 3) continue
      const turn = ((((c.dirFrom - c.forecast.dirFrom) % 360) + 540) % 360) - 180
      all.push({ c, turn, fDir: c.forecast.dirFrom, fKmh: c.forecast.kmh, part: dayPart(c.ts, c.lat, c.lon) })
    }
    memoryMemo.set(checks, all)
  }
  return all.filter((r) => ms - r.c.ts > maxReachMs(r.c) && ms - r.c.ts < MEMORY_MAX_DAYS * 86_400_000)
}

const rawSigmaMemo = new WeakMap<WindCheck, number>()

/** The model's own spread at a check's spot and minute with no checks in:
 *  how sure it was before anyone said anything, for the check's say
 *  (windChecks.ts checkW0). Worked out once a check, with the grids in;
 *  until then the call saved with the check stands in. */
function rawSigma(c: WindCheck): number | undefined {
  const hit = rawSigmaMemo.get(c)
  if (hit !== undefined) return hit
  if (!grid) return undefined
  const ev = evaluate({ ...makeCtx(c.ts, false), checks: [], memory: [] }, c.lon, c.lat, false)
  if (!ev) return undefined
  rawSigmaMemo.set(c, ev.sigma)
  return ev.sigma
}

/** The air held to one wind and layering, for scoring the rules against a
 *  model run on the same wind (scripts/palm_compare.py: PALM's boxes): the
 *  forecast, the treetops seen, the checks and the fit all out of it. The
 *  app never sets it. */
export interface ForcedAir {
  kmh: number
  /** blowing FROM */
  dir: number
  lay?: Partial<Layering>
  sunElev?: number
}
let forcedAir: ForcedAir | null = null
export function setForcedAir(f: ForcedAir | null): void {
  forcedAir = f
  bump()
}

function makeCtx(ms: number, withAmbient = true): Ctx {
  const c = makeCtxLive(ms, withAmbient)
  if (!forcedAir) return c
  const f = forcedAir
  return {
    ...c,
    lay: { ...c.lay, w10: f.kmh, d10: f.dir, ...f.lay },
    sunElev: f.sunElev ?? c.sunElev,
    regional: null,
    fallback: { kmh: f.kmh, dir: f.dir },
    gf: 1,
    checks: [],
    seen: [],
    biases: learnBiases([], ms),
    memory: [],
    ambient: null,
  }
}

function makeCtxLive(ms: number, withAmbient = true): Ctx {
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
    seen: seenShifts(ms, useWindChecks.getState().checks),
    biases: learnBiases(useWindChecks.getState().checks, ms),
    memory: memoryOf(useWindChecks.getState().checks, ms),
    leaves: leavesDown(ms),
    ambient: withAmbient ? ambientFor(ms) : null,
    tune: tuneValues(),
  }
}

// ---------------------------------------------------------------- the sit's checks as the air above the trees

/** The fits can be held off for a before/after on the same checks (scripts/replay.py); the app never does. */
let fitsOn = true
export function setAmbientFit(on: boolean): void {
  fitsOn = on
  bump()
}

const fitCache = new Map<string, AmbientFit | null>()
const scoreCache = new Map<string, SitScore>()
let sessMemo: { checks: WindCheck[]; sessions: WindCheck[][] } | null = null

/** The sits of this area's felt checks (ambientFit.ts), memoised on the store's array. */
function sessions(): WindCheck[][] {
  const checks = useWindChecks.getState().checks
  if (sessMemo && sessMemo.checks === checks) return sessMemo.sessions
  // felt and seen: a look at the treetops pins the air above for the sit's fit (ambientFit.ts)
  const here = checks.filter((c) => !otherAreaAt(c.lon, c.lat))
  sessMemo = { checks, sessions: sessionsOf(here) }
  return sessMemo.sessions
}

function sessionKey(s: WindCheck[]): string {
  return s.map((c) => `${c.id}:${c.ts}:${c.dirFrom}:${c.strength}:${c.swingDeg ?? ''}:${c.puffs ?? 1}:${c.held ? 1 : 0}`).join('|')
}

function momAllIn(): boolean {
  return !hasMom || momU.every(Boolean)
}

/** The ground model at a check's cell and minute under a candidate air, no
 *  checks blended in: the raw rules under that forecast. One context per
 *  check minute, reused across the candidates. */
function probeFor(): ProbeFn {
  const ctxs = new Map<number, Ctx>()
  const lidsOnly = !momAllIn()
  return (c, turn, lnRatio, lnDrain = 0) => {
    let base = ctxs.get(c.ts)
    if (!base) {
      base = makeCtx(c.ts, false)
      ctxs.set(c.ts, base)
    }
    const ctx: Ctx = { ...base, checks: [], memory: [], ambient: { turn, lnRatio, lnDrain, fit: null, full: true }, lidsOnly }
    const ev = evaluate(ctx, c.lon, c.lat, false)
    if (!ev) return null
    // a look at the treetops is the 10 m wind above the trees, before the land brings it down
    if (c.seen) return { kmh: ev.U, dirFrom: ev.dirFrom, regime: 'aloft', woods: false }
    return { kmh: Math.hypot(ev.e, ev.n), dirFrom: (towardOf(ev.e, ev.n) + 180) % 360, regime: ev.regime, woods: ev.woods, drain: ev.kat }
  }
}

/** The ground model at a check as the map reads it from the others: they
 *  blend in by likeness and the fit applies by distance and age, as on the
 *  map; only the check itself is left out. */
function mapProbe(): MapProbeFn {
  return (c, others, fit) => {
    const base = makeCtx(c.ts, false)
    const ctx: Ctx = { ...base, checks: others, biases: learnBiases(others, c.ts), memory: memoryOf(others, c.ts), ambient: fit ? { turn: fit.turn, lnRatio: fit.lnRatio, lnDrain: fit.lnDrain ?? 0, fit, full: false } : null }
    const ev = evaluate(ctx, c.lon, c.lat, false)
    return ev ? { kmh: Math.hypot(ev.e, ev.n), dirFrom: (towardOf(ev.e, ev.n) + 180) % 360, regime: ev.regime, woods: ev.woods } : null
  }
}

function sessionFit(s: WindCheck[]): AmbientFit | null {
  const key = sessionKey(s)
  const hit = fitCache.get(key)
  if (hit !== undefined) return hit
  const fit = fitAmbient(s, probeFor())
  fitCache.set(key, fit)
  // the probes want every direction of the solve: the rest in behind the view, for the next fit
  if (hasMom && file && !momAllIn()) void loadRestOfMicro()
  return fit
}

function ambientFor(ms: number): Applied | null {
  if (!fitsOn) return null
  const s = sessionAt(sessions(), ms)
  if (!s) return null
  const fit = sessionFit(s)
  if (!fitMatters(fit)) return null
  return { turn: fit.turn, lnRatio: fit.lnRatio, lnDrain: fit.lnDrain ?? 0, fit, full: false }
}

/** The sit's fit of the air above the trees that applies at a moment, and
 *  its weight at a spot then (at the fit's own centre without one); null
 *  where no sit's checks reach, or the checks did not move it. */
export function ambientFitFor(ms: number, lon?: number, lat?: number): { fit: AmbientFit; weight: number } | null {
  const a = ambientFor(ms)
  if (!a?.fit) return null
  const f = a.fit
  return { fit: f, weight: fitWeightAt(f, lon ?? f.lon, lat ?? f.lat, ms) }
}

/**
 * The sit at a moment, scored check by check with the fit made from the
 * others (ambientFit.ts sitScore), beside the raw model and the forecast.
 * Tens of fits for a sit of ten: a second or so, so the card asks off the
 * tap. Null with no sit then.
 */
export function sitScoreFor(ms: number): { fit: AmbientFit | null; score: SitScore; count: number } | null {
  const s = sessionAt(sessions(), ms)
  if (!s) return null
  const key = sessionKey(s)
  let score = scoreCache.get(key)
  if (!score) {
    score = scoreSit(s, probeFor(), mapProbe())
    scoreCache.set(key, score)
  }
  return { fit: sessionFit(s), score, count: s.length }
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
  /** the 10 m wind the cell starts from: the forecast's, sharpened by any treetops seen */
  U: number
  dirFrom: number
  /** the forecast's own 10 m speed, before the treetops seen */
  forecastU: number
  inGrid: boolean
  slot: boolean
  /** the cell is in a stand: the head-height wind came down through a canopy */
  woods: boolean
  bias: Bias | null
  /** the gusts here against the hour's gust factor: 1.3 in the gusty zone inside a windward edge */
  gustMul?: number
  /** how much of the sit's fit of the air above reached this cell, 0–1: its turn's share */
  fitW: number
  /** the same for its speed ratio, which lasts longer (ambientFit.ts LN_KEEP) */
  fitWL: number
  /** the local 10 m wind, east and north km/h: what the air above the trees (or the drainage layer) does, for the scent column */
  e10: number
  n10: number
  /** the micro cell, −1 off the grid (the habitat grid shares the lattice) */
  cell: number
  /** stand height, m, and the head-height fraction now */
  th: number
  cf: number
  /** the cold air's drainage in the call, km/h */
  kat: number
  /** degrees of the spread that are the air tumbling (a lee's, a swirl's) with a wind behind it in unsettled air: the part that mixes scent upward too, for the scent column */
  tumbleMix: number
  /** the scent's spreads, degrees (SPREAD_DEFAULT) */
  spread: Spread
  /** how far past the swap the lee's eddy runs back, 0 (none) to 1: the air below the canopy top runs with it (the scent column) */
  eddy: number
}

/** The scent's spreads, degrees: the place's own swing with the forecast right, the model's error for this kind of spot, and the forecast's; checks nearby pull the last two in. */
export interface Spread {
  place: number
  model: number
  forecast: number
}

/** How much a felt check's vector can say, by how hard it blew: at drift
 *  the powder's direction wanders (the noon checks of 2026 went every way
 *  at drift, and blended in full they dragged each other round), and a
 *  calm is as often a lull between gusts as a calm. Breezy and windy
 *  point. Scales a check's weight in the local blend. */
const CHECK_CONF: Record<Strength, number> = { calm: 0.6, drift: 0.5, light: 0.8, breezy: 1, windy: 1 }

const EDGE_STEPS = [15, 30, 45, 60, 90, 120, 160, 200]
const _reg = new Float32Array(2)
/** The shoreline rules (SHORE-WIND.md 1 and 2) can be held off for a
 *  before/after on the same air (scripts/replay.py); the app never does. */
let shoreRules = true
export function setShoreRules(on: boolean): void {
  shoreRules = on
}

// ---------------------------------------------------------------- the lee of the land

/**
 * The eddy behind a rise. The terrain wind (the momentum solve, at 10 m over
 * the trees) slows in the lee of a hill or a bank but never turns back; the
 * air at head height under it does. PALM at 2–4 m (TEACHER.md, "Funnelling,
 * and the spots for rules": the Pickle narrows from eight directions, Lac
 * Bailey's bank) reverses the mean head-height wind by how steeply the ground
 * rises upwind within 300 m (Winstral's Sx): 4% of cells under 3°, 15% at
 * 3–6°, 37% at 6–10°, 67% over 10°, a layer about a tree height deep under
 * air still going with the forecast. In settled air the eddy lifts off and
 * the slope drains instead (the drainage below takes it); in a near calm the
 * slopes' own flows run the place.
 *
 * Sx needs the ground finer than the micro grid holds it: the going grid's
 * 10 m LiDAR elevation (relief.ts), so the rule is on where that is loaded.
 * Each cell's rise is worked out per wind sector the first time it is asked
 * for and kept for as long as the grid is.
 */
const LEE_SECTORS = 16
const LEE_STEP_M = 20
const LEE_REACH_M = 300
/**
 * The rule's numbers: the rise where the eddy starts (rise0) and where it is
 * full (rise1), degrees; its share of the mean past which the head-height air
 * runs back (back); its share over open ground and water, where nothing holds
 * the wind above off the ground (open), and over open water on its own (water:
 * PALM's head height over water in a lee follows the wind above it, a median
 * 9-23° off, where under the trees of the same lees it runs back; Hunter-Jay's
 * floor_learn.py, 2026-10-17); and whether the air that runs back
 * climbs the slope (uphill) or runs straight against the wind. Held here so
 * scripts/palm_compare.py can score settings side by side (setLeeTune); the
 * app never changes them.
 */
// scored over 18 PALM runs (scripts/palm_compare.py, 2026-10-15): from 68% of
// head-height directions within 45° of PALM with the rule off to 72%, 38% to
// 60% where the ground rises over 10° upwind, PALM's reversals found 12% → 43%
// u0, u1: the forecast wind (km/h) over which the eddy comes in; backU: the
// return flow's speed as a share of that wind where the eddy is whole (0: a
// share of the floor's own sheltered wind, as before 2026-10-15)
// water 0.2 since 2026-10-17 (scent card, test set v4: tune 0.53 -> 0.59, misses held, the checks unchanged)
const LEE_DEFAULT = { rise0: 5, rise1: 15, back: 0.5, open: 0.6, water: 0.2, uphill: 1, conv: 1, u0: 2, u1: 5, backU: 0.1, off: 0 }
let leeTune = { ...LEE_DEFAULT }
export function setLeeTune(t: Partial<typeof LEE_DEFAULT> | null): void {
  leeTune = { ...LEE_DEFAULT, ...t }
  bump()
}
/** the lee's rise by the going grid's 10 m cell and the wind's sector (riseUpwind) */
const leeRise = new Map<number, number>()

/**
 * The head-height share of the local 10 m wind, scaled by the ground's cover:
 * under trees (trees) and on open ground or water (open), over the baked
 * canopy fraction. Under trees the baked exponential profile runs slow: PALM
 * at 4 m (14 runs, Pickle Lake, Lac Bailey, Searchmont) puts the floor at
 * 1/0.68 of it, the flux towers' floor/top (NEON 0.28, SMEAR II 0.19,
 * INVERSE.md) higher still, and the 60 Pickle checks felt ×2.4 what it gave.
 * ×1.5 brings the app to 0.95 of PALM under trees; open ground and water
 * were right (0.98, and Searchmont's open checks already ran ×1.2), so they
 * stay. MICRO-WIND.md §4. setFloorTune lets scripts score a scale side by
 * side (palm_compare.py, replay.py --floor); the app never changes it.
 */
// rule 1 since 2026-10-16: the towers' share at 0.8 of its floor/top level (c0 0.168), the level a
// forecast's 10 m carries (ref_wind.py: the over-canopy top runs 0.71-0.82 of U10); trees x1.5 is the
// old rule's, kept where the habitat has no stand
// waterShelter: the least of the wind a tree line upwind leaves over open water (0: the land's
// shelter, 0.25 within 3 tree heights, as before; PALM's floor over a lee's water runs 0.35-0.56 of
// the 10 m wind where the app's sheltered call was 0.12-0.21)
const FLOOR_DEFAULT = { trees: 1.5, open: 1, rule: 1, c0: 0.168, closure: 1.34, leaf: 0.31, waterShelter: 0.5 }
/** a stand never lets more through than open ground's log law gives 2 m over 10 m (§4) */
const FLOOR_OPEN_SHARE = 0.7

/**
 * A stand's head-height share of the local 10 m wind by the flux towers'
 * rule (floorTune.rule 1, the app's since 2026-10-16): c0 · e^(closure·(1 −
 * C)) · (1 + leaf · D · off), C the crown closure, D the hardwood share, off
 * the leaves down.
 * 26 forest towers (NEON, AmeriFlux; pipeline/towers/why_floor.py) measure the
 * floor at 0.15–0.40 of the top whatever the stand, the leaves down lifting
 * it ×1.18, not the bake's ×2.4–3.8; held out it lands within 2× on 89% of
 * half-hours, the baked share ×1.5 on 59%. The habitat grid shares the micro
 * grid's cells; null where it has no stand (the baked share stands).
 */
let habRef: Habitat | null = null
let habCrown: ArrayLike<number> | null = null
let habCon: ArrayLike<number> | null = null
let habHw: ArrayLike<number> | null = null
let habCrownS = 1
function towerShare(g: Habitat, i: number, leaves: number): number | null {
  // the micro grid's coarse copy while the full bands come, or tiles without the bands, have no stand to read
  const h = g === grid ? standBands() : null
  if (h !== habRef) {
    habRef = h
    habCrown = h ? h.raw('crown') : null
    habCon = h ? h.raw('conifer') : null
    habHw = h ? h.raw('hardwood') : null
    habCrownS = h ? h.scale('crown') : 1
  }
  if (!habCrown || !habCon || !habHw || i >= habCrown.length) return null
  const cr = habCrown[i]
  const C = cr > 0 && cr !== 255 ? Math.min(1, (cr * habCrownS) / 100) : 0.6
  const cn = habCon[i]
  const hw = habHw[i]
  const D = cn + hw > 0 && cn !== 255 && hw !== 255 ? hw / (cn + hw) : 0.3
  return Math.min(FLOOR_OPEN_SHARE, floorTune.c0 * Math.exp(floorTune.closure * (1 - C)) * (1 + floorTune.leaf * D * leaves))
}

/**
 * The cold-air drainage's give to the wind (MICRO-WIND §5): whole in a near
 * calm, fading once the wind passes mix0 km/h, by e every mixScale km/h; the
 * wind is the local 10 m one after a settled night's decoupling (ref 0) or
 * the wind over the place, the forecast's as fitted (ref 1). Under trees it
 * runs at trees of its open speed. By the place: a slope's thin cold layer
 * is stirred off by the wind above sooner than low ground's pool, so on
 * ground steeper than sl1 degrees the fade starts at mixS0 km/h with an
 * e-fold of mixSScale, blended in from sl0 degrees, and low ground (a
 * hollow, a pocket under its surroundings) keeps the plain fade.
 * setThermalTune lets scripts score settings side by side (scorecard.py,
 * palm_compare.py, replay.py --thermal); the app never changes it.
 */
// since 2026-10-16: the fade keyed to the wind over the place, from 5 km/h by e every 1 km/h, on
// slopes and flats alike (PALM's floor drains to ~5.4 km/h of forecast 10 m and follows the wind by
// 6.1-6.5, pipeline/teacher/palm/drain_read.py); before, 5 km/h of the decoupled local wind by e every 8
// waterAna: the sun's upslope flow over open water (1 as before; water does not heat as the shore
// does, and PALM's floor over a lee's water under a sunny N wind follows the wind above, am000)
// inv0, inv1: the forecast's inversion (dTheta, 80 m less 2 m, K) under which the drainage is nothing
// and over which it is whole (inv1 0: no gate, as before). PALM's dusk series at Whitefish, under the
// wind fade from the start, drained only once about 1 K had built (Hunter-Jay, 2026-10-17)
// ref 3: the fade keyed to the forecast's 80 m wind, over the settled layer (km/h; the 10 m's where
// the profile has no 80 m): PALM's dusk floors drained under 8-11 km/h at 80 m (the bank, Whitefish,
// the slot, the strip at a forecast 10 m of 5.4) and followed the wind at 17-20 (Gavan's Lac Bailey
// spot at 6.5, the bogs' dawn), where the 10 m forecasts of the two sit a km/h apart. Keyed to the
// floor's own sheltered wind instead (tried 2026-10-18) the slope under trees drained again
// ref 3 at 12 km/h, by e every 2, since 2026-10-18 (scent card v4: misses held, SD one fewer; palm_compare
// Gavan's Lac Bailey spot 53 -> 60%, its dusk series 25 -> 47; the checks in band)
const THERMAL_DEFAULT = { mix0: 12, mixScale: 2, trees: 0.7, ref: 3, mixS0: 12, mixSScale: 2, sl0: 3, sl1: 8, waterAna: 0, inv0: 0, inv1: 0 }
let thermalTune = { ...THERMAL_DEFAULT }
export function setThermalTune(t: Partial<typeof THERMAL_DEFAULT> | null): void {
  thermalTune = { ...THERMAL_DEFAULT, ...t }
  bump()
}

/**
 * The scent's spreads (2026-10-15, MICRO-WIND §7), apart from the shown one:
 * - place: the air's own swing here with the forecast right. In unsettled air
 *   with a wind above the trees it tops out near cap (PALM's head-height
 *   spread; NEON's neutral floor follows the top 94% of the time), coming in
 *   as the local 10 m wind goes u0 to u1 km/h. A still night keeps its wander.
 *   The whole plume swings by swing of it (PALM: the wind over 100 m swings
 *   0.45 of a point's spread, 0.39-0.58 in every box).
 * - model: how far the model's own way may be off for this kind of spot
 *   (modelErr, PALM against the app with the air forced to PALM's).
 * - forecast: the forecast's own error at head height, from the checks; a
 *   check nearby pulls the model's and the forecast's in (checkPull).
 * setSpreadTune lets scripts score them; the app never changes it.
 */
const SPREAD_DEFAULT = { cap: 65, u0: 2, u1: 6, swing: 0.45, forecast: 60, checkPull: 2, off: 0 }
let spreadTune = { ...SPREAD_DEFAULT }
export function setSpreadTune(t: Partial<typeof SPREAD_DEFAULT> | null): void {
  spreadTune = { ...SPREAD_DEFAULT, ...t }
  bump()
}

/**
 * The model's direction error at head height for the kind of spot, degrees
 * (the 68th percentile of PALM against the app at 4 m, 14 boxes, the air
 * forced to PALM's): small on flat ground in a wind, large in a lee, in calm
 * or pooled air and where the sun's flows decide it.
 */
function modelErr(rise: number, regime: Regime, s: number, conv: number): number {
  if (regime === 'pooled') return 90
  if (regime === 'calm') return 70
  if (regime === 'lakeBreeze' || regime === 'landBreeze') return 75
  if (regime === 'upslope') return 45
  if (regime === 'drainage') return 30
  if (!Number.isFinite(rise)) return 45
  const e = rise < 3 ? 22 + 15 * conv : rise < 6 ? 40 : rise < 10 ? 70 : 55
  return s > 0.5 ? Math.max(e, 55) : e
}
let floorTune = { ...FLOOR_DEFAULT }
export function setFloorTune(t: Partial<typeof FLOOR_DEFAULT> | null): void {
  floorTune = { ...FLOOR_DEFAULT, ...t }
  bump()
}

/** The steepest rise within LEE_REACH_M upwind of a point, degrees; NaN without the going grid.
 *  Scanned from the centre of the going grid's 10 m cell under the point and kept by that cell and
 *  the sector: until 2026-10-17 kept by the 30 m micro cell but scanned from the point that first
 *  asked, so the same sit read two rises across page loads (Whitefish W2 on SD, 6.2° or 4.7°;
 *  Hunter-Jay). The micro cell's centre instead lost the 10 m ground's detail: PALM's deep lees
 *  went 55 → 49% within 45°. */
function riseUpwind(_i: number, lon: number, lat: number, fromDeg: number): number {
  const sector = (((Math.round(fromDeg / (360 / LEE_SECTORS)) % LEE_SECTORS) + LEE_SECTORS) % LEE_SECTORS)
  const gc = goingCellAt(lon, lat)
  if (!gc) return NaN
  const key = gc.i * LEE_SECTORS + sector
  const hit = leeRise.get(key)
  if (hit !== undefined) return hit
  const ox = gc.lon
  const oy = gc.lat
  const z0 = elevAt(ox, oy)
  if (!Number.isFinite(z0)) return NaN
  const brg = sector * (360 / LEE_SECTORS) * RAD
  const kx = 111320 * Math.cos(oy * RAD)
  const ky = 110540
  let best = -90
  for (let x = LEE_STEP_M; x <= LEE_REACH_M; x += LEE_STEP_M) {
    const z = elevAt(ox + (Math.sin(brg) * x) / kx, oy + (Math.cos(brg) * x) / ky)
    if (!Number.isFinite(z)) break
    best = Math.max(best, Math.atan2(z - z0, x) / RAD)
  }
  leeRise.set(key, best)
  return best
}

/** How much of the mean head-height wind the eddy behind a rise takes, 0–1. */
function leeShare(rise: number): number {
  if (!Number.isFinite(rise) || leeTune.off) return 0
  const t = clamp((rise - leeTune.rise0) / (leeTune.rise1 - leeTune.rise0), 0, 1)
  return t * t * (3 - 2 * t)
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
/**
 * The rule's numbers: the cross flow within 3 wall heights of the wall it
 * comes from (cross, a return eddy when negative), the share of the blocked
 * cross flow that leaves by the open end (pump), the least of the along flow
 * kept (along), how wide a slot can be for its walls (widthMul·wall +
 * widthAdd, m), and the steepest ground it applies on (maxSlope, degrees: on
 * a hillside the slope steers the air, not the walls). Held here so scripts/palm_compare.py can score settings side
 * by side (setSlotTune); the app never changes them.
 */
// scored against PALM at 2-4 m (scripts/palm_compare.py, 2026-10-15): the pump and the
// return eddy turned the air in a slot back or out its open end where PALM has it run
// with the wind's along-slot part (the bog strip, 30 Sep: 54% -> 67% of its cells within
// 45 deg of PALM; Gavan's checks there 0/4 -> 2/4), and on a hillside strip (Searchmont's
// ski runs) the slope steers the air, so the rule is for flat ground only
const SLOT_DEFAULT = { cross: 0, pump: 0, along: 0.6, widthMul: 6, widthAdd: 30, maxSlope: 3, off: 0 }
let slotTune = { ...SLOT_DEFAULT }
export function setSlotTune(t: Partial<typeof SLOT_DEFAULT> | null): void {
  slotTune = { ...SLOT_DEFAULT, ...t }
  slotAxis = null
  bump()
}

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
    if (long < 2.5 * across || across * SLOT_STEP >= slotTune.widthMul * wall + slotTune.widthAdd) {
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
  } else if (ctx.fallback && inRegion(lon, lat)) {
    // the camp's forecast stands in over the area alone: past its box the map browses, no wind
    // (explore/index.ts viewMoved); it drew camp's wind over a province (2026-10-20)
    U = ctx.fallback.kmh
    dirFrom = ctx.fallback.dir
  } else return null
  // ---- the treetops seen moving ----
  // A look at the wind above the trees (windChecks.ts, seen) turns and
  // scales the forecast wind here by its weight, before the land and the
  // trees bring it down: so a stand's shelter, a slot and a lee all swing
  // with it, not just the air round the spot it was seen.
  let seenW = 0
  let seenNear: { m: number; min: number; ago: boolean } | null = null
  const forecastU = U
  const forecastDir = dirFrom
  if (ctx.seen.length) {
    let t = 0
    let l = 0
    for (const sh of ctx.seen) {
      const w = seenWeight(sh.c, lon, lat, ctx.ms)
      if (w < 0.02) continue
      let turn = sh.turn
      let lnRatio = sh.lnRatio
      if (sh.abs) {
        turn = sh.abs.dirFrom == null ? 0 : ((((sh.abs.dirFrom - forecastDir) % 360) + 540) % 360) - 180
        lnRatio = Math.log(clamp(sh.abs.kmh / Math.max(forecastU, 2), SEEN_RATIO_LO, SEEN_RATIO_HI))
      }
      seenW += w
      t += w * turn
      l += w * lnRatio
      if (withReasons) {
        const min = Math.round(Math.abs(ctx.ms - sh.c.ts) / 60_000)
        if (!seenNear || min < seenNear.min) seenNear = { m: Math.round(metresBetween(lon, lat, sh.c.lon, sh.c.lat)), min, ago: sh.c.ts <= ctx.ms }
      }
    }
    if (seenW > 0) {
      dirFrom = (((dirFrom + t / (1 + seenW)) % 360) + 360) % 360
      U *= Math.exp(l / (1 + seenW))
    }
  }
  // ---- the sit's checks, as the air above the trees ----
  // The turn and the ratio the sit's checks fitted to the forecast
  // (ambientFit.ts), applied here before the land and the trees bring the
  // wind down, so every cell near the checks moves with them, ground never
  // checked included; full among the checks, a Gaussian off them, fading
  // for hours after the last. A probe (fitting) applies a candidate as is.
  // The drainage's weight is the place's, so it goes as the turn does.
  let fitW = 0
  let fitWL = 0
  let lnDrainHere = 0
  if (ctx.ambient) {
    const a = ctx.ambient
    const ws = a.full ? { turn: 1, ln: 1 } : a.fit ? fitWeightsAt(a.fit, lon, lat, ctx.ms) : { turn: 0, ln: 0 }
    fitW = ws.turn > 0.02 ? ws.turn : 0
    fitWL = ws.ln > 0.02 ? ws.ln : 0
    lnDrainHere = (a.lnDrain ?? 0) * fitW
    if (fitW) dirFrom = (((dirFrom + a.turn * fitW) % 360) + 360) % 360
    if (fitWL) U *= Math.exp(a.lnRatio * fitWL)
  }
  const lay = ctx.lay
  const reasons: string[] | null = withReasons ? [] : null
  const [Ue, Un] = vec(U, dirFrom + 180)

  const g = grid
  const i = g ? g.index(lon, lat) : -1
  if (!g || i < 0) {
    // off the grid: an open-ground profile, nothing local
    const f = 0.7 * (1 - 0.6 * lay.stable)
    const sp = U * f
    const sigma0 = 15 + 60 * Math.exp(-sp / 3.6 / 0.6)
    return { e: Ue * f, n: Un * f, sigma: sigma0, regime: sp < 0.8 ? 'calm' : 'wind', swirl: false, gusty: ctx.gf >= 1.8 && U >= 8, parts: [{ key: 'terrain', kmh: sp, toward: (dirFrom + 180) % 360 }], reasons, local10: U, U, dirFrom, forecastU, inGrid: false, slot: false, woods: false, bias: null, fitW, fitWL, e10: Ue, n10: Un, cell: -1, th: 0, cf: f, kat: 0, tumbleMix: 0, eddy: 0, spread: { place: sigma0, model: 45, forecast: forcedAir ? 0 : spreadTune.forecast } }
  }

  // ---- terrain and roughness: the two lids, blended by stability ----
  const s = lay.stable
  let e10: number
  let n10: number
  if (hasMom && fullIn && !ctx.lidsOnly && momentumAt(i, U, dirFrom)) {
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
  // the towers' rule, where it is on and the habitat knows the stand (towerShare)
  const tower = floorTune.rule > 0 && th >= 2 ? towerShare(g, i, ctx.leaves) : null
  let cf = tower ?? canopyAt(i, ctx.leaves)
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
            // the notes are worded only for the reasons: the plume, the streaks and the routes
            // sample thousands of cells with none wanted
            if (reasons) edgeNote = `${distWords(x, { step: 1 })} inside the stand's edge: the wind off the open ground upwind gets in here`
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
          if (reasons) edgeNote = `a ${heightWords(hj)} tree line ${distWords(x, { step: 1 })} ahead: the wind slows${aheadN < 1 ? ' and runs along it' : ' as it lifts over'}${rel < 1 ? ', eddying against it' : ''}`
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
        if (reasons && rel < 10) edgeNote = `${distWords(x, { step: 1 })} downwind of a ${heightWords(hj)} tree line: sheltered${swirl ? ', and the air eddies and swaps direction' : ''}`
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
    // over open water the wind above comes down past a tree line upwind sooner than on land
    if (shelter < floorTune.waterShelter && waterAt(lon, lat)) shelter = floorTune.waterShelter
  }
  // a stable surface layer thins the wind toward the ground well below
  // the neutral log law (Monin–Obukhov: u2/u10 ≈ 0.4–0.5 on a clear calm night)
  // under a canopy too: the AmeriFlux towers (pipeline/towers/fit.py,
  // 2026-10-07) put the floor at about 0.6 of its mixed-air share when the
  // air above is settled (Treehaven mixedwood 0.13 stable / 0.28 unstable)
  const gm = (th === 0 ? cf * floorTune.open : Math.min(FLOOR_OPEN_SHARE, tower != null ? cf : cf * floorTune.trees)) * (th === 0 ? 1 - 0.45 * s : 1 - 0.3 * s)
  let mechE = e10 * gm * shelter
  let mechN = n10 * gm * shelter
  // a slot in the trees, on flat ground: the along-slot part of the wind runs
  // the length of it and the cross part is held off by the wall it comes
  // from. This takes the place of the plain shelter behind one tree line.
  // (The rule once sent a share of the blocked cross flow out the open end
  // and turned it back near the wall; PALM at 2-4 m has neither: SLOT_DEFAULT.)
  // the lee of the land first (riseUpwind): in the eddy behind a rise a gap
  // in the trees is a pocket, not a funnel (PALM's narrows: a west wind over
  // the hill 41° off the gap's line leaves it reversed half the time at a
  // quarter of the wind, where a north wind 37° off across open water runs
  // down it at 1.4 times)
  const rise = shoreRules && edges ? riseUpwind(i, lon, lat, dirFrom) : NaN
  // a sunny day's upslope flow (below) already climbs a lit lee slope, so the
  // eddy gives way as the sun stirs the air
  const lee = leeShare(rise) * (1 - s) * (1 - leeTune.conv * lay.convective) * clamp((U - leeTune.u0) / (leeTune.u1 - leeTune.u0), 0, 1) * (th > 0 ? 1 : Number.isFinite(rise) && waterAt(lon, lat) ? leeTune.water : leeTune.open)
  const slot = open && lee < leeTune.back && !slotTune.off && b(K_THSLOPE, i) < slotTune.maxSlope ? slotAt(g, i) : null
  if (slot) {
    const axE = Math.sin(slot.axis * RAD)
    const axN = Math.cos(slot.axis * RAD)
    const along = e10 * axE + n10 * axN
    const crossE = e10 - along * axE
    const crossN = n10 - along * axN
    const cross = Math.hypot(crossE, crossN)
    const fCross = slotFetchAt(i, cross > 1e-6 ? towardOf(crossE, crossN) + 180 : 0)
    // inside three tree heights of the wall it comes from the cross flow is
    // held off (slotTune.cross: 0; it was a weak return eddy, -0.1)
    let shCross = fCross < 3 * slot.wall ? slotTune.cross : shelterOf(fCross, slot.wall)
    if (walls >= 3) shCross = Math.min(shCross, 0.5)
    // the along flow gathers down the slot, so it keeps more than it would
    // behind a plain edge, and never nothing
    const shAlong = Math.max(slotTune.along, shelterOf(slotFetchAt(i, along < 0 ? slot.axis : slot.axis + 180), slot.wall))
    const alongH = along * shAlong + slot.openSign * slotTune.pump * cross
    mechE = gm * (alongH * axE + crossE * shCross)
    mechN = gm * (alongH * axN + crossN * shCross)
    slotSwirl = slot.width < 5 * slot.wall && Math.abs(along) < cross
    swirl = slotSwirl
    // funnelling when the along-slot flow is what is left; a wind square across
    // the slot leaves only the return eddy and the pump, an unsteady drift
    if (reasons) {
      const funnels = Math.abs(alongH) >= 2 * cross * Math.abs(shCross)
      edgeNote = `a ${distWords(slot.width)} slot in the trees running ${slotLine(slot.axis)}: ${funnels ? 'the wind funnels along it toward the' : 'the wind across it swirls, drifting toward the'} ${compass(towardOf(mechE, mechN))}`
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
  // the eddy behind the rise: the mean head-height air slows to nothing at
  // LEE_BACK of it and past that runs back toward the rise, at up to half
  // what it had, the direction swapping as the eddy breathes
  let eddy = 0
  if (lee > 0.02) {
    const k = 1 - lee / leeTune.back
    if (k < 0) eddy = Math.min(1, -k / 0.5)
    if (k >= 0 || !leeTune.uphill) {
      const f = k >= 0 ? k : 0.5 * k
      mechE *= f
      mechN *= f
    } else {
      // the return flow climbs the lee slope toward the crest
      // (the micro grid's aspect is the way the slope faces: uphill is 180° from it)
      const facing = bearing(K_THASPECT, i)
      // the eddy is the wind over the rise turning back: in PALM's deep lees
      // (a rise over 10 deg) the floor ran back at 0.09-0.125 of the wind,
      // under trees as in the open, where the floor's own sheltered share
      // gave 0.016-0.035 of it
      const sp = leeTune.backU > 0 ? leeTune.backU * U * Math.min(1, -k / 0.5) : Math.hypot(mechE, mechN) * 0.5 * -k
      const to = facing != null && b(K_THSLOPE, i) >= 2 ? (facing + 180) % 360 : (towardOf(mechE, mechN) + 180) % 360
      ;[mechE, mechN] = vec(sp, to)
    }
    if (lee > 0.25) swirl = true
    if (reasons && (lee >= leeTune.back || !slot) && lee > 0.25) {
      edgeNote = `in the lee of a ${Math.round(rise)}° rise upwind: the air here ${lee >= leeTune.back ? 'eddies back toward it' : 'stalls and swaps direction'}`
    }
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
  const kWind = thermalTune.ref === 3 ? (Number.isFinite(lay.w80) ? lay.w80 : U) : thermalTune.ref ? U : mech10
  const onSlope = clamp((b(K_THSLOPE, i) - thermalTune.sl0) / Math.max(0.1, thermalTune.sl1 - thermalTune.sl0), 0, 1) * (1 - lowness)
  const mixKat =
    (1 - onSlope) * Math.exp(-Math.max(0, kWind - thermalTune.mix0) / thermalTune.mixScale) +
    onSlope * Math.exp(-Math.max(0, kWind - thermalTune.mixS0) / thermalTune.mixSScale)
  const invGate = thermalTune.inv1 > thermalTune.inv0 ? clamp((lay.dTheta - thermalTune.inv0) / (thermalTune.inv1 - thermalTune.inv0), 0, 1) : 1
  const sKat = clamp(Math.max(lay.inversion * s, 0.6 * cool), 0, 1.5) * mixKat * invGate
  const kd = bearing(K_KATDIR, i)
  if (sKat > 0.02 && kd != null) {
    kat = b(K_KATSPD, i) * 3.6 * sKat * (inTrees ? thermalTune.trees : 1) * Math.exp(lnDrainHere)
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
    if (ana > 0 && thermalTune.waterAna < 1 && waterAt(lon, lat)) ana *= thermalTune.waterAna
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
  // What the sit's fit above did not account for at a check is the place's
  // own. Each check nearby is averaged into the model's vector at its
  // weight (windChecks.ts: nine to one where and when it was made, by time
  // and distance), scaled by likeness: a check made under the trees
  // corrects cells under the trees in full and open ground at a third, a
  // check in a slot the slots; one with no call saved sits between. Every
  // check counts the same otherwise, so with several people's checks the
  // side with more of them carries it.
  // Where the checks disagree with each other (the wind swinging between
  // two checks, or two people feeling different things) the average alone
  // would read as a steady wind down the middle, or cancel to a calm: the
  // circular spread of the checks' own directions (the resultant length R
  // of their unit vectors, the usual measure for wind directions) is held
  // as a floor on sigma instead, scaled by how much of the answer the
  // checks make up. Checks that agree tighten the spread; checks that
  // disagree open it.
  // How hard and which way blend apart (2026-10-11): a puff's strength is
  // a range read well, so speed keeps the full say (nine parts to one where
  // and when it was made); its direction is one sample of the gusts, so
  // which way it says counts by how sure the model was of the spot without
  // any checks (windChecks.ts checkW0): little on the Searchmont ridge,
  // where the model had the air within ±25° and the puffs swung 180–299°,
  // nine parts on the valley floor below, where it was lost. On the replay
  // of the twelve Searchmont checks the ridge went from 71% within 45° with
  // the old blend to 86%.
  let sW = 0
  let sK = 0
  let uE = 0
  let uN = 0
  let wdir = 0
  let nChecks = 0
  const who = new Set<string>()
  let nearest: { min: number; m: number; ago: boolean } | null = null
  // a check logged as swinging holds the spread open at its own arc
  let swingFloor = 0
  const likeOf = (c: WindCheck): number => {
    const m = c.model
    if (!m || m.woods == null) return 0.6
    return !!m.woods === th > 0 && !!m.slot === !!slot ? 1 : 0.3
  }
  for (const c of ctx.checks) {
    // by time and distance, likeness, and how much a puff that hard can say: a drift wanders, a breezy puff points
    const reach = checkWeight(c, lon, lat, ctx.ms, 1)
    if (reach < 0.003) continue
    const base = reach * likeOf(c) * CHECK_CONF[c.strength]
    const ws = base * CHECK_W0_SPEED
    if (ws < 0.03) continue
    sW += ws
    sK += ws * STRENGTH_KMH[c.strength]
    nChecks++
    who.add(c.by || 'you')
    if (c.dirFrom != null && c.strength !== 'calm') {
      const wd = base * checkW0(c, rawSigma(c))
      const [ue, un] = vec(1, c.dirFrom + 180)
      uE += wd * ue
      uN += wd * un
      wdir += wd
      if (c.swingDeg) swingFloor = Math.max(swingFloor, (wd * c.swingDeg) / 2)
    }
    const mins = Math.round(Math.abs(ctx.ms - c.ts) / 60_000)
    if (!nearest || mins < nearest.min) nearest = { min: mins, m: Math.round(metresBetween(lon, lat, c.lon, c.lat)), ago: c.ts <= ctx.ms }
  }
  // the place's memory: checks of other days, where the air is in the same
  // situation now (the forecast's way and strength, and the part of the day),
  // turned with the forecast as it now runs here
  let memW = 0
  let memBest: { r: Remembered; w: number } | null = null
  if (ctx.memory.length) {
    const part: DayPart = ctx.sunElev < -6 ? 'night' : ctx.sunElev < 8 ? (ctx.sunAz < 180 ? 'low-am' : 'low-pm') : 'day'
    for (const r of ctx.memory) {
      if (r.part !== part) continue
      // nothing reaches past 400 m: a cheap box first, the map asks every cell
      if (Math.abs(lat - r.c.lat) > 0.004 || Math.abs(lon - r.c.lon) > 0.006) continue
      const reach = placeReach(r.c, lon, lat)
      if (reach < 0.02) continue
      const dm = clamp(1 - (angleDiff(forecastDir, r.fDir) - 15) / 30, 0, 1)
      const sm = clamp(1 - (Math.abs(Math.log(Math.max(forecastU, 0.5) / r.fKmh)) - Math.log(1.5)) / (Math.log(2.5) - Math.log(1.5)), 0, 1)
      const fade = Math.exp(-(ctx.ms - r.c.ts) / (MEMORY_DAYS * 86_400_000))
      const base = puffBoost(r.c) * MEMORY_SHARE * reach * likeOf(r.c) * CHECK_CONF[r.c.strength] * dm * sm * fade
      const wd = base * checkW0(r.c, rawSigma(r.c))
      if (wd < 0.03) continue
      const ws = base * CHECK_W0_SPEED
      sW += ws
      sK += ws * STRENGTH_KMH[r.c.strength]
      const [ue, un] = vec(1, forecastDir + r.turn + 180)
      uE += wd * ue
      uN += wd * un
      wdir += wd
      memW += wd
      if (!memBest || wd > memBest.w) memBest = { r, w: wd }
    }
  }
  if (sW > 0 || wdir > 0) {
    const sp0 = Math.hypot(E, N)
    const spd = (sp0 + sK) / (1 + sW)
    // the model's way at one part, the checks' at theirs; a model near calm has no way to speak of
    const m0 = sp0 > 0.05 ? 1 : 0
    const vE = (m0 * E) / Math.max(sp0, 1e-6) + uE
    const vN = (m0 * N) / Math.max(sp0, 1e-6) + uN
    const vl = Math.hypot(vE, vN)
    if (vl > 1e-6) {
      E = (spd * vE) / vl
      N = (spd * vN) / vl
    } else if (sp0 > 1e-6) {
      E = (E * spd) / sp0
      N = (N * spd) / sp0
    }
  }
  // the checks' say on the direction, for the spread and the words below
  const wsum = wdir
  // the checks' own spread about their mean direction: R = 1 all one way, 0 every way
  const R = wdir > 0 ? Math.hypot(uE, uN) / wdir : 1
  const checkSpread = R < 0.999 ? (Math.sqrt(-2 * Math.log(Math.max(R, 1e-3))) * 180) / Math.PI : 0
  const checkFloor = (checkSpread * wsum) / (1 + wsum)

  const sp = Math.hypot(E, N)
  const Ug = sp / 3.6

  // ---- spread ----
  const swirlDeg = (swirl ? ctx.tune.swirlSpread : 0) + (slotSwirl ? 25 : 0)
  let sigma = 12 + tumble + ctx.tune.calmSpread * Math.exp(-Ug / 0.6) + 20 * s * Math.exp(-Ug / 1.0) + 15 * lay.convective + (inTrees ? ctx.tune.treesSpread : 0) + swirlDeg
  // the part of it that stirs the air up and down as well: the lee's tumble
  // (already neutral air with a wind behind it) and a swirl's, once the local
  // wind has some push and the air is not settled (a still night's swirl is
  // the direction wandering, not eddies; stable air damps the up and down).
  // The near-calm wander, the trees' own (the canopy's mixing has it) and
  // the hour's gusts and sun (the stability's) are left out
  const tumbleMix = tumble + swirlDeg * (1 - s) * clamp((mech10 - 3) / 6, 0, 1)
  const thermal = kat + ana + brz
  const fracMech = mechG / (mechG + thermal + 1e-6)
  // gusty air swings more: a gust factor of 2.5 means the along-wind
  // fluctuation is about 0.6 of the mean (Wieringa 1973)
  sigma += 12 * clamp(ctx.gf - 1.5, 0, 1) * fracMech
  // the scent's three spreads (SPREAD_DEFAULT): the place's own before the
  // forecast's doubt and the checks; the model's for this kind of spot; the
  // forecast's (none with the air forced to a known truth), both pulled in by
  // checks nearby unless they disagree
  const capK = spreadTune.off ? 0 : (1 - s) * clamp((local10 - spreadTune.u0) / (spreadTune.u1 - spreadTune.u0), 0, 1)
  const sigPlace = clamp(Math.max(Math.min(sigma, 110 - (110 - spreadTune.cap) * capK), swingFloor), 8, 110)
  const sigModel = modelErr(rise, regime, s, lay.convective)
  const sigFcst = forcedAir ? 0 : Math.hypot(spreadTune.forecast, lay.ensDirSd != null ? 0.7 * lay.ensDirSd : 0) * (0.3 + 0.7 * fracMech)
  const pull = 1 + spreadTune.checkPull * wsum
  const spreadOf = { place: sigPlace, model: Math.max(sigModel / pull, checkFloor), forecast: sigFcst / pull }
  if (lay.ensDirSd != null) sigma = Math.hypot(sigma, fracMech * lay.ensDirSd * 0.7)
  // nearby checks that agree tighten the spread; a swing, or checks that disagree, hold it open
  if (wsum > 0.3 && !swingFloor && checkSpread < 25) sigma *= ctx.tune.checkTighten
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
      reasons.push(`In ${heightWords(th)} trees: head-height wind about ${Math.round(cf * 100)}% of the wind over them${note ? `, ${note}` : ''}`)
    }
    if (edgeNote) reasons.push(edgeNote[0].toUpperCase() + edgeNote.slice(1))
    if (applied) reasons.push(biasWords(lessonBias, lesson))
    if (lay.ensDirSd != null && lay.ensDirSd > 35 && fracMech > 0.4) reasons.push(`Forecast models disagree on the direction (±${Math.round(lay.ensDirSd)}°)`)
    if (nearest && nChecks === 1) reasons.push(`Blended with ${who.has('you') ? 'your' : `${[...who][0]}'s`} wind check ${nearest.m < 20 ? 'here' : `${distWords(nearest.m)} away`}, ${nearest.min} min ${nearest.ago ? 'before' : 'after'} this time`)
    else if (nearest) {
      const people = who.size > 1 ? ` from ${who.size} people (${[...who].join(', ')})` : ''
      reasons.push(
        checkSpread >= 25
          ? `Blended with ${nChecks} wind checks nearby${people}, which disagree by about ±${Math.round(checkSpread)}°: the spread is held open that wide, and the side with more checks carries the direction`
          : `Blended with ${nChecks} wind checks nearby${people}, agreeing within about ±${Math.round(Math.max(checkSpread, 5))}°; the nearest ${nearest.m < 20 ? 'here' : `${distWords(nearest.m)} away`}, ${nearest.min} min ${nearest.ago ? 'before' : 'after'} this time`,
      )
    }
    if (memBest && memW / (1 + wsum) >= 0.15) {
      const c = memBest.r.c
      const day = new Date(c.ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      const where = metresBetween(lon, lat, c.lon, c.lat) < 20 ? 'here' : `${distWords(metresBetween(lon, lat, c.lon, c.lat))} away`
      reasons.push(
        `Remembered from ${day} ${DAY_PART_WORD[memBest.r.part]}, with the forecast from the ${compass(memBest.r.fDir)} as now: the air ${where} ran from the ${compass(c.dirFrom!)}; it counts for ${Math.round((100 * memW) / (1 + wsum))}% of the wind here`,
      )
    }
    if (seenNear && seenW >= 0.1) {
      const k = Math.round((U / Math.max(0.1, forecastU) - 1) * 100)
      const where = seenNear.m < 100 ? 'here' : `${distWords(seenNear.m)} away`
      const turned = angleDiff(dirFrom, forecastDir) >= 10 ? `from the ${compass(dirFrom)} (the forecast had ${compass(forecastDir)})` : 'from where the forecast had it'
      reasons.push(`Treetops seen ${where}, ${seenNear.min} min ${seenNear.ago ? 'before' : 'after'} this time: the wind above is ${turned}${Math.abs(k) >= 10 ? `, ${Math.abs(k)}% ${k > 0 ? 'stronger' : 'lighter'}` : ''}`)
    }
    if (ctx.ambient?.fit && fitW >= 0.1) {
      const f = ctx.ambient.fit
      const own = ctx.checks.some((c) => !c.taken && f.ids.includes(c.id))
      reasons.push(`Sharpened by ${own ? 'your' : 'the party\u2019s'} ${f.count} check${f.count === 1 ? '' : 's'} this sit: ${fitWords(f)}${fitW < 0.9 ? ` (${Math.round(fitW * 100)}% of it reaches here)` : ''} · holds till ~${clockShort(fitHoldsUntil(f))} unless the forecast shifts`)
    }
    if (lay.source === 'estimate') reasons.push('No layering forecast cached: stability estimated from the sky and the wind')
  }

  return { e: E, n: N, sigma, regime, swirl: swirl || tumble >= TUMBLE_SWIRL, gusty, parts, reasons, local10, U, dirFrom, forecastU, inGrid: true, slot: !!slot, woods: th > 0, bias: applied ? lessonBias : null, gustMul, fitW, fitWL, e10, n10, cell: i, th, cf, kat, tumbleMix, spread: spreadOf, eddy }
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
    spread: ev.spread,
    regime: ev.regime,
    decoupled: ctx.lay.stable > 0.5,
    swirl: ev.swirl,
    gusty: ev.gusty,
    gustKmh,
    regionalKmh: ev.U,
    regionalDir: ev.dirFrom,
    forecastKmh: ev.forecastU,
    local10Kmh: ev.local10,
    parts: ev.parts,
    headline: headlineOf(ev, kmh, dirFrom, gustKmh),
    reasons: ev.reasons ?? [],
    layering: ctx.lay,
    inGrid: ev.inGrid,
    inSlot: ev.slot,
    inWoods: ev.woods,
    bias: ev.bias ? { deg: ev.bias.deg, ratio: ev.bias.ratio } : null,
    ambient:
      (ev.fitW > 0 || ev.fitWL > 0) && ctx.ambient?.fit
        ? { turn: ctx.ambient.turn * ev.fitW, ratio: Math.exp(ctx.ambient.lnRatio * ev.fitWL), weight: ev.fitW, count: ctx.ambient.fit.count, sure: ctx.ambient.fit.sure, holdsUntil: fitHoldsUntil(ctx.ambient.fit), words: fitWords(ctx.ambient.fit) }
        : null,
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
  fitCache.clear()
  scoreCache.clear()
}
listeners.add(bump)
onProfile(bump)
onWeatherGrid(bump)
// the 10 m ground landing turns the lee of the land on: the field is not what it was
onRelief(() => {
  leeRise.clear()
  for (const cb of listeners) cb()
})
useWindChecks.subscribe(bump)
useScentTune.subscribe(bump)
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
 *  With room for SAMPLE_N (the scent column, 2026-10-08): out[5], out[6]
 *  the local 10 m wind east and north m/s (the air above the trees, or
 *  above the cold layer); out[7] the stand height m; out[8] the
 *  head-height fraction now; out[9] the drainage accumulation, cells;
 *  out[10] the micro cell (−1 off the grid); out[11] the degrees of the
 *  spread that are the air tumbling, which mix upward too (Eval.tumbleMix,
 *  2026-10-09); out[12] the whole plume's swing with the forecast right,
 *  and out[13] the doubt it may swing by as well (the model's and the
 *  forecast's), degrees (Spread, 2026-10-15); out[14] the lee's eddy past
 *  the swap, 0-1 (Eval.eddy); out[15] the 10 m wind the cell starts from,
 *  m/s (Eval.U: the forecast's, before the terrain). Null when there is no
 *  wind at all to start from. */
export type GroundSampler = (lon: number, lat: number, out: Float32Array) => boolean
export const SAMPLE_N = 16
export function groundSampler(ms: number, offGrid = true): GroundSampler | null {
  const ctx = makeCtx(ms)
  if (!ctx.regional && !ctx.fallback) return null
  return (lon, lat, out) => {
    const ev = evaluate(ctx, lon, lat, false)
    // off the grid evaluate still answers, an open-ground guess: a cone running past the edge keeps
    // going on it, but the map's streaks draw the forecast's own grey there (windFlow.ts coarse), not
    // a guess dressed as the ground model's (offGrid false)
    if (!ev || (!offGrid && !ev.inGrid)) return false
    out[0] = ev.e / 3.6
    out[1] = ev.n / 3.6
    out[2] = ev.sigma
    out[3] = ev.swirl ? 1 : ev.regime === 'calm' || ev.regime === 'pooled' ? 0.5 : 0
    out[4] = ev.regime === 'drainage' || ev.regime === 'pooled' || ev.regime === 'landBreeze' ? 1 : 0
    if (out.length >= SAMPLE_N) {
      out[5] = ev.e10 / 3.6
      out[6] = ev.n10 / 3.6
      out[7] = ev.th
      out[8] = ev.cf
      out[9] = ev.cell >= 0 ? b(K_DRAINACC, ev.cell) : 0
      out[10] = ev.cell
      out[11] = ev.tumbleMix
      out[12] = ev.spread.place * spreadTune.swing
      out[13] = Math.hypot(ev.spread.model, ev.spread.forecast)
      out[14] = ev.eddy
      out[15] = ev.U / 3.6
    }
    return true
  }
}

/** The air's layering at a time: 0…1 decoupled-stable, 0…1 sun-driven
 *  convective, and whether the lakes are warmer than the air over the land
 *  (by more than 1°, the land breeze's test in evaluate). Then the water
 *  heats the air over it from below and mixes it down to the surface,
 *  however still the night is over the land. */
export function groundStability(ms: number): { stable: number; convective: number; warmWater: boolean; t2: number } {
  const ctx = makeCtx(ms)
  const l = ctx.lay
  return { stable: l.stable, convective: l.convective, warmWater: l.t2 - ctx.waterC < -1, t2: l.t2 }
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

// dev builds only: what the micro grid's solve stands on at sampling time, for the scorecard's SD
// column to log (Hunter-Jay, 2026-10-17: W2 read in two states across cards); with a point and a wind,
// whether its two momentum directions and their turbulence are in and where the stand is read;
// with a moment too, the call there taken apart (the lee's cached rise read before it). The first
// part reads only; the call is evaluate's own, which may ask for a direction as any call does
if (import.meta.env.DEV || import.meta.env.VITE_DEV_SITE) {
  ;(window as unknown as { __micro?: unknown }).__micro = (lon?: number, lat?: number, dirFrom?: number, ms?: number) => {
    const out: Record<string, unknown> = {
      file: !!file,
      areaGrid: !!areaGrid,
      fullIn,
      hasMom,
      hasTurb,
      momRef,
      momScale,
      momTScale,
      momIn: momU.map(Boolean),
      momTIn: momT.map(Boolean),
      cols: grid?.cols ?? null,
      rows: grid?.rows ?? null,
    }
    if (grid && lon != null && lat != null && dirFrom != null) {
      const i = grid.index(lon, lat)
      const x = (((dirFrom % 360) + 360) % 360) / MOM_STEP
      const k0 = Math.floor(x) % MOM_N
      const k1 = (k0 + 1) % MOM_N
      const sb = standBands()
      const sector = (((Math.round(dirFrom / (360 / LEE_SECTORS)) % LEE_SECTORS) + LEE_SECTORS) % LEE_SECTORS)
      const gc = goingCellAt(lon, lat)
      const cached = gc ? leeRise.get(gc.i * LEE_SECTORS + sector) ?? null : null
      out.at = { i, k0, k1, mom: !!momU[k0] && !!momU[k1], turb: i >= 0 ? turbAt(i, dirFrom) : null, stand: sb === grid ? 'grid' : sb ? 'habitat' : null, leeRiseCached: cached != null && Number.isFinite(cached) ? cached : null }
      if (ms != null) {
        const ev = evaluate(makeCtx(ms), lon, lat, true)
        if (ev)
          out.call = {
            kmh: Math.hypot(ev.e, ev.n), from: (towardOf(ev.e, ev.n) + 180) % 360, sigma: ev.sigma, regime: ev.regime, swirl: ev.swirl,
            U: ev.U, dirFrom: ev.dirFrom, local10: ev.local10, th: ev.th, cf: ev.cf, kat: ev.kat, tumbleMix: ev.tumbleMix, eddy: ev.eddy,
            gustMul: ev.gustMul, slot: ev.slot, spread: ev.spread, parts: ev.parts, reasons: ev.reasons,
          }
      }
    }
    return out
  }
}
