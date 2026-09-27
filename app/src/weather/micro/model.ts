import { microFile } from '../../config'
import { devlog } from '../../devlog'
import { loadBandFile, type Band, type Habitat } from '../../spots/habitatGrid'
import { homePlace } from '../../state/placesStore'
import { useSpotsStore } from '../../state/spotsStore'
import { estimateWaterTemp } from '../../spots/conditions'
import { startOfDayMs } from '../../time'
import { layeringAt, onProfile, type Layering } from '../boundaryLayer'
import { cachedPointForecast, compass, hourAt } from '../openMeteo'
import { sunPosition } from '../sun'
import { onWeatherGrid, windSampler } from '../windGrid'
import { checkWeight, metresBetween, STRENGTH_KMH, useWindChecks } from './windChecks'

/**
 * The ground wind: the air a hunter feels at head height, at a point and a
 * minute, built up in the layers of docs/MICRO-WIND.md:
 *
 *   regional   HRDPS 10 m wind at the point (windGrid's lattice)
 *   terrain    mass-consistent downscaling, neutral and stable lids
 *              blended by how decoupled the air is (boundaryLayer)
 *   thermals   cold-air drainage and pooling after the sun goes and the
 *              sky clears; upslope flow on sun-heated slopes; lake and
 *              land breezes from the land–lake temperature contrast
 *   canopy     the head-height fraction under the trees, and the shelter
 *              and eddies downwind of a tree line
 *   checks     the hunter's own wind checks nearby, blended in
 *
 * and a direction spread (sigma) from the ground speed, the stability, the
 * canopy, edge eddies and the ensemble's disagreement: a scent cone, not
 * a line. Every number is a model's, and the reasons say which part
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
  regionalKmh: number
  regionalDir: number
  /** local wind at 10 m over the surface (terrain and roughness only) */
  local10Kmh: number
  parts: Part[]
  headline: string
  reasons: string[]
  layering: Layering
  inGrid: boolean
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
const BAND_NAMES = ['nUe', 'nVe', 'nUn', 'nVn', 'sUe', 'sVe', 'sUn', 'sVn', 'katDir', 'katSpd', 'pool', 'drainAcc', 'thSlope', 'thAspect', 'onshore', 'shoreDist', 'breezeMax', 'rel', 'canopy', 'treeH']

export function loadMicro(): Promise<Habitat | null> {
  if (grid) return Promise.resolve(grid)
  if (inflight) return inflight
  inflight = loadBandFile(microFile(), 'wind')
    .then((r) => {
      if (!r) return null
      const g = r.grid
      BAND_NAMES.forEach((n, k) => {
        if (!g.has(n)) throw new Error(`micro grid: no band ${n}`)
        bands[k] = g.raw(n)
        scales[k] = g.scale(n)
      })
      grid = g
      for (const cb of listeners) cb()
      return g
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
  checks: ReturnType<typeof useWindChecks.getState>['checks']
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
    regional: windSampler(ms),
    fallback: h ? { kmh: h.windKmh, dir: h.windDir } : Number.isFinite(lay.w10) && Number.isFinite(lay.d10) ? { kmh: lay.w10, dir: lay.d10 } : null,
    waterC,
    checks: useWindChecks.getState().checks,
  }
}

function b(k: number, i: number): number {
  return bands[k][i] * scales[k]
}
function bearing(k: number, i: number): number | null {
  const v = bands[k][i]
  return v === 255 ? null : v * BEARING_Q
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
  parts: Part[]
  reasons: string[] | null
  local10: number
  U: number
  dirFrom: number
  inGrid: boolean
}

const EDGE_STEPS = [15, 30, 45, 60, 90, 120, 160, 200]
const _reg = new Float32Array(2)

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
    return { e: Ue * f, n: Un * f, sigma: 15 + 60 * Math.exp(-sp / 3.6 / 0.6), regime: sp < 0.8 ? 'calm' : 'wind', swirl: false, parts: [{ key: 'terrain', kmh: sp, toward: (dirFrom + 180) % 360 }], reasons, local10: U, U, dirFrom, inGrid: false }
  }

  // ---- terrain and roughness: the two lids, blended by stability ----
  const s = lay.stable
  let e10 = (1 - s) * (b(K_NUE, i) * Ue + b(K_NUN, i) * Un) + s * (b(K_SUE, i) * Ue + b(K_SUN, i) * Un)
  let n10 = (1 - s) * (b(K_NVE, i) * Ue + b(K_NVN, i) * Un) + s * (b(K_SVE, i) * Ue + b(K_SVN, i) * Un)
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
  const cf = b(K_CANOPY, i)
  let shelter = 1
  let swirl = false
  let edgeNote: string | null = null
  if (edges && th === 0 && mech10 > 0.5) {
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
    let walls = 0
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
  const gm = cf * shelter * (th === 0 ? 1 - 0.45 * s : 1)
  const mechE = e10 * gm
  const mechN = n10 * gm
  const mechG = mech10 * gm

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

  // ---- the hunter's own checks nearby ----
  let wsum = 0
  let oE = 0
  let oN = 0
  let nearest: { min: number; m: number; ago: boolean } | null = null
  for (const c of ctx.checks) {
    const w = checkWeight(c, lon, lat, ctx.ms)
    if (w < 0.03) continue
    const k = STRENGTH_KMH[c.strength]
    const [ce, cn] = c.dirFrom == null ? [0, 0] : vec(k, c.dirFrom + 180)
    oE += w * ce
    oN += w * cn
    wsum += w
    const mins = Math.round(Math.abs(ctx.ms - c.ts) / 60_000)
    if (!nearest || mins < nearest.min) nearest = { min: mins, m: Math.round(metresBetween(lon, lat, c.lon, c.lat)), ago: c.ts <= ctx.ms }
  }
  if (wsum > 0) {
    E = (E + oE) / (1 + wsum)
    N = (N + oN) / (1 + wsum)
  }

  const sp = Math.hypot(E, N)
  const Ug = sp / 3.6

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
  if (sp < 0.8) regime = settled ? 'pooled' : 'calm'
  else if (settled && (regime === 'drainage' || mechG < 1.5)) regime = 'pooled'

  // ---- spread ----
  let sigma = 12 + 70 * Math.exp(-Ug / 0.6) + 20 * s * Math.exp(-Ug / 1.0) + 15 * lay.convective + (inTrees ? 8 : 0) + (swirl ? 40 : 0)
  const thermal = kat + ana + brz
  const fracMech = mechG / (mechG + thermal + 1e-6)
  if (lay.ensDirSd != null) sigma = Math.hypot(sigma, fracMech * lay.ensDirSd * 0.7)
  if (wsum > 0.3) sigma *= 0.75
  sigma = clamp(sigma, 8, 110)

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
    const ratio = local10 / Math.max(0.1, U)
    const turn = Math.abs((((towardOf(e10, n10) - (dirFrom + 180)) % 360) + 540) % 360 - 180)
    if (ratio > 1.15) reasons.push(`Terrain and open ground speed the wind up about ${Math.round((ratio - 1) * 100)}% here`)
    else if (ratio < 0.85) reasons.push(`Terrain and trees shelter this spot: the 10 m wind is about ${Math.round((1 - ratio) * 100)}% lighter`)
    if (turn >= 12 && U > 3) reasons.push(`The land turns the wind ${Math.round(turn)}° here`)
    if (s > 0.4 && lowness > 0.3) reasons.push('Low ground: the cold layer sits here under the wind')
    if (kat > 0.3) reasons.push(`Cold air drains toward the ${compass(katTo)} at about ${kat.toFixed(1)} km/h${pool > 0.3 || lowness > 0.25 ? ', settling here: scent sits and creeps toward the outlet' : ': scent goes with it, downhill'}`)
    if (ana > 0.3) reasons.push(`The sun heats this slope: air rises upslope toward the ${compass(anaTo)} at about ${ana.toFixed(1)} km/h`)
    if (brz > 0.3) reasons.push(brzKind === 'lake' ? `Land warmer than the lake by ${Math.round(lay.t2 - ctx.waterC)}°: an onshore lake breeze toward the ${compass(brzTo)}` : `Land colder than the lake: air drifts off the shore toward the ${compass(brzTo)}`)
    if (inTrees) reasons.push(`In ${Math.round(th)} m trees: head-height wind about ${Math.round(cf * 100)}% of the wind over them`)
    if (edgeNote) reasons.push(edgeNote[0].toUpperCase() + edgeNote.slice(1))
    if (lay.ensDirSd != null && lay.ensDirSd > 35 && fracMech > 0.4) reasons.push(`Forecast models disagree on the direction (±${Math.round(lay.ensDirSd)}°)`)
    if (nearest) reasons.push(`Blended with your wind check ${nearest.m < 20 ? 'here' : `${nearest.m} m away`}, ${nearest.min} min ${nearest.ago ? 'before' : 'after'} this time`)
    if (lay.source === 'estimate') reasons.push('No layering forecast cached: stability estimated from the sky and the wind')
  }

  return { e: E, n: N, sigma, regime, swirl, parts, reasons, local10, U, dirFrom, inGrid: true }
}

function headlineOf(ev: Eval, kmh: number, dirFrom: number): string {
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
      return `Wind from the ${compass(dirFrom)}, ${Math.round(kmh)} km/h at head height`
  }
}

/** The ground wind at a point and minute, with its reasons. */
export function groundWind(lon: number, lat: number, ms: number): GroundWind | null {
  const ctx = makeCtx(ms)
  const ev = evaluate(ctx, lon, lat, true)
  if (!ev) return null
  const kmh = Math.hypot(ev.e, ev.n)
  const dirFrom = (towardOf(ev.e, ev.n) + 180) % 360
  return {
    kmh,
    dirFrom,
    sigmaDeg: ev.sigma,
    regime: ev.regime,
    decoupled: ctx.lay.stable > 0.5,
    swirl: ev.swirl,
    regionalKmh: ev.U,
    regionalDir: ev.dirFrom,
    local10Kmh: ev.local10,
    parts: ev.parts,
    headline: headlineOf(ev, kmh, dirFrom),
    reasons: ev.reasons ?? [],
    layering: ctx.lay,
    inGrid: ev.inGrid,
  }
}

export interface CellGround {
  kmh: number
  dirFrom: number
  sigmaDeg: number
  regime: Regime
}

// bumped whenever an input changes, so the scorer's memo knows to refresh
let version = 0
const bump = () => {
  version++
}
listeners.add(bump)
onProfile(bump)
onWeatherGrid(bump)
useWindChecks.subscribe(bump)

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
 *  sigma degrees]. Null when there is no wind at all to start from. */
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
    return true
  }
}

/** The air's layering at a time: 0…1 decoupled-stable, 0…1 sun-driven convective. */
export function groundStability(ms: number): { stable: number; convective: number } {
  const l = makeCtx(ms).lay
  return { stable: l.stable, convective: l.convective }
}

export interface Window {
  startMs: number
  endMs: number
  regime: Regime
  dirFrom: number
  kmh: number
  decoupled: boolean
}

/** The day at a point in windows of one regime (15-minute steps, anything
 *  under 45 minutes folded into its neighbour): day windows before hours. */
export function groundDay(lon: number, lat: number, dayStartMs: number): Window[] {
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

/** The baked values under a point, for the dev console. */
export function microCell(lon: number, lat: number): Record<string, number> | null {
  const g = grid
  const i = g ? g.index(lon, lat) : -1
  if (!g || i < 0) return null
  const out: Record<string, number> = {}
  BAND_NAMES.forEach((n, k) => (out[n] = Math.round(b(k, i) * 100) / 100))
  return out
}
