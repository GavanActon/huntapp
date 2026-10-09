import maplibregl, { type GeoJSONSource, type ImageSource, type Map as MlMap } from 'maplibre-gl'
import type { Feature, FeatureCollection } from 'geojson'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { devlog } from '../../devlog'
import { getMap, onEachMap, withMap } from '../../map/mapController'
import { closeOnTapOff } from '../../map/tapPopup'
import { useMeasureStore } from '../../measure/measureStore'
import { useRoutes } from '../../routes/routeStore'
import { useAppStore } from '../../state/appStore'
import { compass } from '../openMeteo'
import { onProfile } from '../boundaryLayer'
import { onWeatherGrid } from '../windGrid'
import { groundGust, groundSampler, groundStability, loadMicro, microGrid, onMicro, SAMPLE_N, type GroundSampler } from './model'
import { ensureRelief, onRelief, reliefCell, reliefNear, WATER } from './relief'
import { habitat } from '../../spots/habitatGrid'
import { leavesDown } from './leaves'
import { tuneValues, useScentTune, type TuneValues } from './scentTune'
import { metresBetween, useWindChecks } from './windChecks'
import '../../ui/minipop.css'

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
 *     on a still night;
 *   - on a still night where the air is not draining, a particle keeps its
 *     altitude off a drop (the ground from the going grid's 10 m LiDAR
 *     DTM), so scent passes over a hollow above the deer's noses and comes
 *     back down where the ground rises to meet it, or over open water
 *     warmer than the air, which mixes it down from below;
 *   - the sit's own checks (2026-10-09, Gavan: "each check should sharpen
 *     the scent cone, that's the intent"): the puffs made near the sit in
 *     the last hours are the measurement of what the cone has to guess
 *     at its source. Each realisation draws its drift from the puffs
 *     themselves (seven of ten toward NE, two toward E: so goes the
 *     plume), wanders only as much as they did, and stalls as often as
 *     they hung; the model's spread and gust chain fill in only the share
 *     the checks do not carry (sitAir);
 *   - the column (2026-10-08, steps 1–5 of the realism pass): each puff
 *     has a centre height and a vertical spread, and moves at the wind of
 *     the layers it spans: the head-height wind below 2 m, thinned by the
 *     bush at nose height; the canopy's own profile from 2 m to the stand
 *     top, or the cold layer's depth where air drains or pools; the 10 m
 *     wind above. So scent released under a canopy mixes up to the top
 *     within tens of metres and goes on at the faster wind there, a stand
 *     at 6 m sends it farther from the start, a ground sit at dusk rides
 *     the drainage while a stand above the cold layer does not, and at a
 *     tree line the puff keeps its pace instead of stacking up. Canopy,
 *     bush and sun on open ground set how fast it mixes; needles, leaves
 *     and bush take some of it out of the air; a steep lee bank separates
 *     the flow by day as a drop does by night, and a sit under such a bank
 *     drifts back toward it before going over; in cold calm air the
 *     body's own warmth lifts the scent a few metres first.
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
  /** the air is decoupled-stable: scent hugs the ground, or off a drop holds its height (lifted) */
  stable: boolean
  /** release height, m: 1.5 on the ground, higher in a tree stand */
  height: number
  /**
   * Share of the scent held more than 2 m above its release height: in
   * still air off a drop, scent that kept its altitude over low ground (0
   * by day, in drainage or a land breeze, and on the flat; over water
   * warmer than the air it is mixed down). Each step counts for what it
   * would have laid down at noses at its release height.
   */
  lifted: number
  /**
   * Scent that held its height over low ground comes back down to the
   * noses where the ground rises again (the far side of a bog or a ravine),
   * noticeable there on its own, 50 m out or more and inside the 700 m grid.
   * Scent warm water mixed down does not count: it came down over the water.
   */
  touchdown: boolean
  /** the sit's checks that drove this cone: how many, their puffs, the share that hung, and how much of the cone is theirs (0 = the model's) */
  checks: { n: number; puffs: number; lulls: number; share: number } | null
  /**
   * Share of the scent that went up over the canopy: in the column model
   * the part of each puff above the stand's top where it is under trees
   * (mixed up there, it goes on at the wind above); in the flat model,
   * where the head-height wind drops along the path (a tree line, a
   * sheltered pocket), the share of the air that did not get in. Each
   * step counts for what it would have laid down at its release height.
   */
  over: number
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
// RELEASE_S: a knob now, its modelled value in scentTune.ts
const TOTAL_S = 900
const DT = 5
/**
 * Twenty-four realisations of thirty particles, in antithetic pairs
 * (2026-10-09): six of 120 left the cone's shape to six draws of the
 * meander, and five metres' move, a new seed, could turn a cone toward E
 * into a blob every way (Lac Bailey, Gavan: "totally different outcomes
 * for the scent cone"). The same 720 particles, four times the draws of
 * the meander, and each odd realisation mirrors the one before it, so the
 * wander averages to nothing by construction.
 */
const REALISATIONS = 24
const PER_REAL = 30
/** mean length of a gust burst, s */
// BURST_S: a knob now, its modelled value in scentTune.ts
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

/**
 * The slider as the hunter sees it (2026-10-03): Cone size, Smaller … Bigger,
 * which is `risk` turned round (conservative and aggressive read either
 * way). A word for where it sits.
 */
export function coneSizeWord(risk: number): string {
  return risk < 0.45 ? 'bigger' : risk > 0.55 ? 'smaller' : 'as modelled'
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
function noseTable(h: number, stable: number, conv: number, mix = 1): Float32Array {
  const t = new Float32Array(TABLE_M + 1)
  for (let m = 0; m <= TABLE_M; m++) t[m] = noseShare(sigmaZ(m, stable, conv) * mix, h) / NOSE0
  return t
}

/**
 * The nose-height weight of a puff of spread s held h m above the ground:
 * the reflected Gaussian, or nothing once the noses are 5 σz under it,
 * where it would add under 1e-5 and its two exponentials are the dearest
 * part of a held-up step.
 */
function heldUp(s: number, h: number): number {
  const a = h - NOSE_H
  return a * a > 25 * s * s ? 0 : noseShare(s, h) / NOSE0
}

/**
 * How much of a drop in the ground a particle keeps as height above it
 * (docs/MICRO-WIND-LIDAR.md, phase 1): none in mixed air, where the plume
 * mixes down to the surface, all of it on a decoupled night, ramping over
 * stable 0.3–0.8, where the ground model's own stable effects come in.
 * Cold air that drains, pools or runs off the shore as a land breeze hugs
 * the ground, so there it is none whatever the night (the step checks the
 * sampler's flag, out[4]).
 */
function keepOfDrop(stable: number): number {
  return Math.min(1, Math.max(0, (stable - 0.3) / 0.5))
}
/** a particle never rises more than this above the ground, m */
const MAX_AGL = 60
/**
 * An edge: the mean head-height wind falls to this share of the fastest
 * the particle has had since it last lost scent. The air that does not
 * get in at head height goes over, and the scent with it. Moved in 2D,
 * the particle would only slow, and a 20× slowdown at a tree line stacked
 * the scent 20× deeper there (the cone "went far", 2026-10-04). A stand's
 * own patchiness (10–30% from cell to cell) never counts, and a slowdown
 * spread over several cells (a sheltered pocket, a windward edge) does
 * once it adds up.
 */
// EDGE_DROP: a knob now, its modelled value in scentTune.ts
/** only air that was really moving loses its scent over an edge, m/s: a stand's floor wind never does */
const EDGE_MIN = 1.0
/**
 * In slow air the scent keeps mixing upward at a rate the air above sets,
 * not the floor's: the mixing path grows at least this share of the
 * fastest mean wind the particle has met.
 */
const MIX_FROM_ABOVE = 0.5
/** The edge rule can be held off for a before/after on the same air
 *  (scripts/scent_test.py); the app never turns it off. */
let edgeRule = true
export function setScentEdgeRule(on: boolean): void {
  edgeRule = on
}
/** noticeable 10 m cells of scent come back down past a hollow before the card says so: a patch, not a speck */
const TOUCH_CELLS = 4
/**
 * and that far out at least, m: past the core, so it is the far side of a
 * hollow, not the sit's own scent meandering back over the lip in a calm
 * (a Lac Bailey bank at 1 km/h said it came down with the cone 40 m long)
 */
const TOUCH_FROM_M = 50

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
  const tmp = new Float32Array(SAMPLE_N)
  return (lon, lat, out) => {
    const i = g.index(lon, lat)
    if (i < 0) return sample(lon, lat, out)
    let v = memo.get(i)
    if (v === undefined) {
      const [clon, clat] = g.center(i)
      v = sample(clon, clat, tmp) ? tmp.slice() : null
      memo.set(i, v)
    }
    if (!v) return false
    const n = Math.min(out.length, v.length)
    for (let k = 0; k < n; k++) out[k] = v[k]
    return true
  }
}

// ---------------------------------------------------------------- the column

/**
 * What the ground does to a puff over it, per micro cell: the layers of
 * air it may span and what each moves at, how fast it mixes upward, and
 * what the vegetation takes out of it. The habitat grid shares the micro
 * lattice, so a cell's closure, make-up and bush are read by the same
 * index; without it (not loaded, off the grid) a stand is taken as 60%
 * closed and half conifer, and the bush as moderate.
 */
interface Column {
  /** the top of the slow layer, m above ground: the canopy top in a stand, the cold layer's depth where air drains or pools, 10 m in the open, deeper on a stable night */
  zb: number
  /** the layers' wind, m/s east and north: below 2 m (the head wind; the bush at nose height thins it per step), above zb; between them the step reads the profile at the puff's own height (midWind) */
  v0e: number
  v0n: number
  v2e: number
  v2n: number
  /** the way the head wind runs, unit, and its speed and the 10 m wind's, m/s */
  dirE: number
  dirN: number
  hs: number
  as: number
  /** stand: the canopy's decay coefficient (the bake's curve) and height; hug: the cold layer moves as one; open: a log-like ramp from the head wind at 2 m to 0.85 of the 10 m wind at zb */
  kind: 'stand' | 'hug' | 'open'
  a: number
  th: number
  /** open ground: the share of the 10 m wind at the top of the layer (a knob) */
  openShare: number
  /** how much faster a puff mixes upward than over open ground: canopy sweeps, bush, sun on open ground */
  mixF: number
  /** deposition velocity onto the vegetation, m/s */
  vd: number
  stand: boolean
  /** eye-level bush thickness from the habitat grid, 0–1 (the going grid's 10 m measure overrides it per step) */
  trap: number
}

interface HabBands {
  crown: ArrayLike<number>
  conifer: ArrayLike<number>
  hardwood: ArrayLike<number>
  thick: ArrayLike<number>
  thickS: number
}

function habBands(): HabBands | null {
  const h = habitat()
  if (!h || !h.has('crown') || !h.has('thick')) return null
  return { crown: h.raw('crown'), conifer: h.raw('conifer'), hardwood: h.raw('hardwood'), thick: h.raw('thick'), thickS: h.scale('thick') }
}

/** The bush's hold on the air at nose height: nothing to 0.2, down to 0.4 of the head wind at a wall. */
function trapFactor(trap: number, hold = 0.6): number {
  return 1 - hold * Math.min(1, Math.max(0, (trap - 0.2) / 0.8))
}

/** Past this slope (17°) the flow separates from a lee face in neutral air too (Wood 1995), and the hollow under it is passed over. */
// SEP_SLOPE: a knob now, its modelled value in scentTune.ts
/** How far upwind of a sit a bank is looked for, m, and the rise it must have to make a cavity. */
const CAVITY_SCAN_M = 150
/** the rise it must have, m, and how far downwind of it the cavity reaches, in rises (Lac Bailey, 2026-10-09: any 3 m hummock within 150 m made the near field run backward, and cones five metres apart differed wholesale) */
const CAVITY_MIN_M = 5
const CAVITY_REACH = 4
/** In the cavity under a bank the ground-level flow runs back toward it at this share of the wind. */
// CAVITY_BACK: a knob now, its modelled value in scentTune.ts
/** Deposition onto vegetation, as a share of the literature's dry deposition velocities for odorant VOCs (0.2–1 cm/s): a knob, not a number. */
const DEPOSITION = 1
/**
 * At a windward edge the air that does not get in at head height rides up
 * over the canopy, and the puff's centre with it: toward the stand's
 * displacement height (EDGE_LIFT of the stand height) by the share of
 * the flow that was lost, when the head wind drops to EDGE_DROP of the
 * puff's reference. Back in faster air the lift decays by EDGE_SETTLE a
 * step. The flat model's edge rule threw that share away; here it goes
 * over and comes back down as the canopy's turbulence mixes it, which is
 * the edge flow of Dupont & Brunet (2008).
 */
// EDGE_LIFT: a knob now, its modelled value in scentTune.ts
const EDGE_SETTLE = 0.6
/** In cold calm air the body's warmth lifts the scent this far, m, before it spreads (a human thermal plume rises at about 0.2 m/s). */
// BODY_RISE_M: a knob now, its modelled value in scentTune.ts

/** The standard normal's cumulative, Abramowitz & Stegun 7.1.26. */
function Phi(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z))
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))))
  const erf = 1 - poly * Math.exp(-z * z)
  return 0.5 * (1 + (z < 0 ? -erf : erf))
}

/** The share of a puff centred zc m up with spread s that lies below z, reflected at the ground. */
function reflCdf(z: number, zc: number, s: number): number {
  return Phi((z - zc) / s) + Phi((z + zc) / s) - 1
}

/**
 * The column for a sample (the fuller sample of SAMPLE_N values): the
 * canopy's profile is the bake's own curve read back from the head-height
 * fraction and the stand height (the log law to the top, the exponential
 * decay inside), so the mid-canopy wind is what the bake implies; the
 * drainage layer's depth grows with the ground draining through the cell
 * (Manins & Sawford: a few per cent of the drop; 2–15 m here).
 */
/**
 * How deep the slow air is on a stable night, m: the decoupled layer over
 * the ground, 5 m as the air begins to settle (stable 0.3) to 30 m fully
 * decoupled. A cold pool on a flat bog is this deep, not the few metres
 * its drainage accumulation would say (the first column at the bog south
 * of camp put the layer's top at 2.6 m under a 4 km/h 10 m wind, and the
 * cone ran 221 m where the flat one sat at 135: Gavan, "feels like a lot").
 */
function stableDepth(stable: number): number {
  return stable > 0.3 ? 5 + 25 * Math.min(1, (stable - 0.3) / 0.7) : 0
}

function columnOf(out: Float32Array, hab: HabBands | null, conv: number, leafOn: number, stable: number, T: TuneValues): Column {
  const he = out[0]
  const hn = out[1]
  const ae = out[5]
  const an = out[6]
  const th = out[7]
  const cf = out[8]
  const acc = out[9]
  const i = out[10]
  const hug = out[4] >= 0.5
  const hs = Math.hypot(he, hn)
  const as = Math.hypot(ae, an)
  const stand = th >= 3
  let closure = stand ? 0.6 : 0
  let conifer = 0.5
  let trap = 0.3
  if (hab && i >= 0) {
    const cr = hab.crown[i]
    if (stand && cr > 0) closure = Math.min(1, cr / 100)
    const cn = hab.conifer[i]
    const hw = hab.hardwood[i]
    if (cn + hw > 0) conifer = cn / (cn + hw)
    const t = hab.thick[i]
    if (t !== 255) trap = t * hab.thickS
  }
  const deep = stableDepth(stable) * T.stableDepth
  // the way the head wind runs (it carries the shore and tree-wall rules the
  // solve does not); near calm at head height, the solve's way
  const dirE = hs >= 0.3 ? he / hs : as > 0 ? ae / as : 0
  const dirN = hs >= 0.3 ? hn / hs : as > 0 ? an / as : 0
  let zb: number
  let kind: Column['kind']
  let a = 2
  if (stand && !hug) {
    zb = Math.max(th, deep)
    kind = 'stand'
    const zc0 = Math.max(0.1 * th, 0.3)
    const fTop = Math.log(Math.max(0.33 * th, 0.5) / zc0) / Math.log(10 / zc0)
    a = fTop > 0 && cf > 0 ? Math.min(4, Math.max(0.5, -Math.log(Math.min(1, cf / fTop)) / Math.max(0.1, 1 - 2 / th))) : 2
  } else if (hug) {
    // the cold layer moves as one: the drainage current's depth on a slope,
    // the settled layer's on a still night, the trunk space in a stand,
    // whichever is deepest
    zb = Math.max(deep, stand ? th : 0, Math.min(15, Math.max(2, 2 + 0.015 * Math.sqrt(acc * 900))))
    kind = 'hug'
  } else {
    zb = Math.max(10, deep)
    kind = 'open'
  }
  // sun on open ground lifts the mixing; under a canopy the floor stays cool and keeps scent low
  const convCover = conv > 0 ? (stand ? 1 - T.sunMix * conv * closure : 1 + T.sunMix * conv) : 1
  const mixF = (1 + T.canopyMix * closure) * (1 + T.bushMix * trap) * convCover
  const vd = DEPOSITION * T.deposition * (0.002 + closure * (0.006 * conifer + (1 - conifer) * (0.001 + 0.003 * leafOn)) + 0.003 * trap)
  return { zb, v0e: he, v0n: hn, v2e: ae, v2n: an, dirE, dirN, hs, as, kind, a, th, openShare: T.openShare, mixF, vd, stand, trap }
}

/**
 * The wind of the layer between 2 m and the slow layer's top at a puff's
 * own mean height, m/s along the head wind's way: in a stand the canopy's
 * curve up from head height, never past the 10 m wind; in the cold layer
 * the head wind, the layer moving as one; over open ground a log-like
 * ramp from the head wind at 2 m to 0.85 of the 10 m wind at the top (a
 * stable night's shear: a puff at 3 m sees little more than the floor).
 */
function midWind(col: Column, z: number): number {
  if (col.kind === 'hug') return col.hs
  const zz = Math.min(col.zb, Math.max(2, z))
  if (col.kind === 'stand') return col.hs * Math.min(Math.exp((col.a * (zz - 2)) / col.th), (col.as + 0.01) / (col.hs + 0.01))
  const f = Math.log(zz / 2) / Math.log(col.zb / 2)
  return col.hs + (col.openShare * col.as - col.hs) * f
}

/** The column model can be held off for a before/after on the same air (scripts/scent_test.py: the flat plume with the edge rule); the app never does. */
let columnModel = true
export function setScentColumn(on: boolean): void {
  columnModel = on
}

// ---------------------------------------------------------------- the sit's own checks

/** A check's say in the cone fades with this e-folding, twice for one that said the wind had held, and none past SIT_MAX_MS. */
const SIT_TAU_MS = 2 * 3600_000
const SIT_MAX_MS = 4 * 3600_000
/** and with distance from the sit: e-folding and the cut-off, m */
const SIT_LEN_M = 300
const SIT_MAX_M = 600
/** in a lull the air stalls to this share of its speed */
const LULL_MUL = 0.15
/** a lull's typical length, s, for the chain that stalls the plume as often as the puffs hung */
const LULL_S = 60

interface SitAir {
  n: number
  puffs: number
  /** the share of the puffs that hung */
  lullShare: number
  /** how much of the cone the checks carry, 0–1: one fresh check at the sit is half, ten nine tenths */
  share: number
  /** the wander round a puff's way, radians: 15° and half of any swing seen */
  sm: number
  /** a puff's way drawn by weight, as the turn from the field's way at the sit, radians clockwise */
  pick: (rnd: () => number) => number
}

const wrapRad = (r: number) => ((((r + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI

/**
 * The checks made near the sit in the last hours, as the air the cone
 * should run on: every puff of every felt check (a series keeps each
 * puff; a check without one is a single puff its way, a calm one a lull),
 * weighted by age and distance. Null with none in reach.
 */
function sitAir(lon: number, lat: number, ms: number, fieldToward: number): SitAir | null {
  const tows: number[] = []
  const ws: number[] = []
  let lullW = 0
  let total = 0
  let n = 0
  let puffs = 0
  let swingSum = 0
  let swingW = 0
  for (const c of useWindChecks.getState().checks) {
    if (c.seen) continue
    const dt = Math.abs(ms - c.ts)
    if (dt > SIT_MAX_MS) continue
    const d = metresBetween(lon, lat, c.lon, c.lat)
    if (d > SIT_MAX_M) continue
    const w = Math.exp(-dt / (c.held ? 2 * SIT_TAU_MS : SIT_TAU_MS)) * Math.exp(-d / SIT_LEN_M)
    if (w < 0.02) continue
    n++
    const dirs = c.dirs ?? [c.strength === 'calm' ? null : c.dirFrom]
    for (const dir of dirs) {
      puffs++
      total += w
      if (dir == null) lullW += w
      else {
        tows.push((dir + 180) % 360)
        ws.push(w)
      }
    }
    if (c.swingDeg) {
      swingSum += w * c.swingDeg
      swingW += w
    }
  }
  if (!n || total <= 0) return null
  const movingW = ws.reduce((a, b) => a + b, 0)
  const sm = ((15 + (swingW > 0 ? swingSum / swingW / 2 : 0)) * Math.PI) / 180
  const pick = (rnd: () => number): number => {
    if (!movingW) return 0
    let u = rnd() * movingW
    for (let i = 0; i < ws.length; i++) {
      u -= ws[i]
      if (u <= 0) return wrapRad(((tows[i] - fieldToward) * Math.PI) / 180)
    }
    return wrapRad(((tows[tows.length - 1] - fieldToward) * Math.PI) / 180)
  }
  return { n, puffs, lullShare: lullW / total, share: total / (1 + total), sm, pick }
}

/**
 * Run the plume; the nose-height grid (N×N, row 0 north) and its summary.
 * The grid is scaled to the core 20–40 m out of the same sit ON THE GROUND,
 * so a stand's scent reads against what the ground would have given: it
 * starts over the deer's heads and touches down farther out, thinner.
 * `relief` says whether the particles walked the going grid's ground (still
 * air over the core), the part of the cost phase 1 of MICRO-WIND-LIDAR.md adds.
 */
export function simulatePlume(
  lon: number,
  lat: number,
  ms: number,
  height = GROUND_H,
  sample: GroundSampler | null = cellSampler(ms),
  gust = groundGust(ms),
): { plume: Plume; grid: Float32Array; tracks: PlumeTracks; relief: boolean } | null {
  if (!sample) return null
  // the knobs (scentTune.ts), read once per plume
  const T = tuneValues()
  const RELEASE = T.releaseMin * 60
  const TOTAL = T.followMin * 60
  const { stable, convective, warmWater, t2 } = groundStability(ms)
  const noseAt = noseTable(height, stable, convective, T.vertMix)
  const noseGround = height === GROUND_H ? noseAt : noseTable(GROUND_H, stable, convective, T.vertMix)
  const kx = 111_320 * Math.cos((lat * Math.PI) / 180)
  const ky = 110_574
  const column = columnModel
  // the ground under the particles: the going grid's 10 m LiDAR DTM (the
  // core only), for a drop kept in still air, a steep lee face by day, a
  // bank upwind of the sit, and the bush at nose height
  const keep = keepOfDrop(stable) * T.keepDrop
  const dtm = column || keep > 0 ? reliefNear(lon, lat, kx, ky) : null
  // σz by distance travelled in 1 m steps, for every step the column model
  // takes (its layer shares) and for the steps held up off a drop
  const sz = new Float64Array(TABLE_M + 1)
  const iSrc = dtm ? reliefCell(dtm, 0, 0) : -1
  const gSrc = dtm && iSrc >= 0 ? dtm.elev[iSrc] : NaN
  const hab = column ? habBands() : null
  const leafOn = column ? 1 - leavesDown(ms) : 1
  const cols = new Map<number, Column>()
  let lifted = 0
  let over = 0
  let wTotal = 0
  let walked = false
  let landed = false
  const out = new Float32Array(SAMPLE_N)
  if (!sample(lon, lat, out)) return null
  const srcSigma = out[2] * SPREAD
  const srcSpeed = Math.hypot(out[0], out[1])
  // the sit's own checks: the drift, its wander and its lulls from the puffs
  const sit = sitAir(lon, lat, ms, ((Math.atan2(out[0], out[1]) * 180) / Math.PI + 360) % 360)
  // in cold calm air the body's own warmth lifts the scent a few metres
  // before it spreads: a ground sit on a frosty dawn starts above the noses
  const rise = column && height === GROUND_H ? T.bodyRise * Math.min(1, Math.max(0, (0.6 - srcSpeed) / 0.6)) * Math.min(1, Math.max(0, (15 - t2) / 15)) : 0
  const zc0 = height + rise
  // a bank upwind of the sit: within CAVITY_SCAN_M along the 10 m wind,
  // ground rising CAVITY_MIN_M or more past SEP_SLOPE makes a cavity the
  // sit lies in, where the low air runs back toward the bank
  let cavityH = 0
  if (column && dtm && iSrc >= 0 && out[7] < 3) {
    // in the open only: under a canopy the trunk space has no terrain cavity of its own
    const as = Math.hypot(out[5], out[6])
    if (as >= 0.5) {
      const ux = -out[5] / as
      const uy = -out[6] / as
      let gPrev = gSrc
      let steep = false
      for (let d = 10; d <= CAVITY_SCAN_M; d += 10) {
        const j = reliefCell(dtm, ux * d, uy * d)
        if (j < 0) break
        const g = dtm.elev[j]
        if ((g - gPrev) / 10 >= T.sepSlope) steep = true
        // a bank: steep, risen CAVITY_MIN_M or more, and the sit within CAVITY_REACH rises of it
        const rise = g - gSrc
        if (steep && rise >= CAVITY_MIN_M && d <= CAVITY_REACH * rise && rise > cavityH) cavityH = rise
        gPrev = g
      }
    }
  }
  // seeded by the micro cell and the minute (the place to 11 m until
  // 2026-10-09, so a few metres' move re-rolled the cone): the same cone
  // anywhere in the cell, and with the pairs below a near one in the next
  const cellKey = out[10] >= 0 ? Math.round(out[10]) * 2654435761 : (Math.round(lon * 1e4) * 73856093) ^ (Math.round(lat * 1e4) * 19349663)
  const rnd = mulberry32(cellKey ^ Math.round(ms / 60_000))
  const raw = new Float32Array(N * N)
  // The same sit on the ground, for the scale, always at its release
  // height over flat ground: what a ground sit lays down with nothing in
  // the way. Held at that, a cone can only thin for the relief, never
  // strengthen. A ground sit is its own reference until it first differs
  // (it gets its own copy then).
  let rawGround = height === GROUND_H && rise === 0 ? raw : new Float32Array(N * N)
  const rawDown = dtm ? new Float32Array(N * N) : null
  const sectors = new Float64Array(8)
  const STEPS = Math.ceil(TOTAL / DT) + 1
  const NP = REALISATIONS * PER_REAL
  const tracks: PlumeTracks = { steps: STEPS, x: new Float32Array(NP * STEPS), y: new Float32Array(NP * STEPS), k0: new Int16Array(NP), k1: new Int16Array(NP) }
  const TL = 20
  const TM = T.meanderS
  const gusty = gust > 1.1
  const GFRAC = Math.min(0.35, Math.max(0, (gust - 1) / 3))
  const lullMul = Math.max(0.3, (1 - GFRAC * gust) / (1 - GFRAC))
  const pEnd = DT / T.burstS
  const pStart = (DT * GFRAC) / (T.burstS * (1 - GFRAC))
  // the meander's draws, shared by each pair of realisations
  const noise = new Float32Array(STEPS)
  const colOf = (): Column => {
    const key = out[10]
    let c = cols.get(key)
    if (!c) {
      c = columnOf(out, hab, convective, leafOn, stable, T)
      cols.set(key, c)
    }
    return c
  }
  for (let r = 0; r < REALISATIONS; r++) {
    const steps = STEPS
    const phi = new Float32Array(steps)
    // the meander: round the model's way with the model's wander, or, by
    // the checks' share, round a puff's way with the puffs' own wander;
    // the odd realisation of each pair takes the even one's wander mirrored
    const byPuff = !!sit && rnd() < sit.share
    const r0 = byPuff ? sit!.pick(rnd) : 0
    const smModel = ((srcSigma * T.meander) * Math.PI) / 180
    const sm = sit ? smModel * (1 - sit.share) + sit.sm * sit.share : smModel
    if (r % 2 === 0) for (let k = 0; k < steps; k++) noise[k] = gauss(rnd)
    const sign = r % 2 === 0 ? 1 : -1
    phi[0] = r0 + sign * noise[0] * sm
    for (let k = 1; k < steps; k++) phi[k] = r0 + (phi[k - 1] - r0) * (1 - DT / TM) + sm * Math.sqrt((2 * DT) / TM) * sign * noise[k]
    const burst = new Uint8Array(steps)
    if (gusty) {
      let on = rnd() < GFRAC
      for (let k = 0; k < steps; k++) {
        on = on ? rnd() >= pEnd : rnd() < pStart
        burst[k] = on ? 1 : 0
      }
    }
    // the lulls: the air stalls as often as the puffs hung, in lulls about LULL_S long
    const lull = new Uint8Array(steps)
    if (sit && sit.lullShare > 0.05 && byPuff) {
      const pLullEnd = DT / LULL_S
      const pLullStart = (pLullEnd * sit.lullShare) / (1 - sit.lullShare)
      let on = rnd() < sit.lullShare
      for (let k = 0; k < steps; k++) {
        on = on ? rnd() >= pLullEnd : rnd() < pLullStart
        lull[k] = on ? 1 : 0
      }
    }
    for (let p = 0; p < PER_REAL; p++) {
      const t0 = rnd() * RELEASE
      const id = r * PER_REAL + p
      const base = id * STEPS
      tracks.k0[id] = Math.round(t0 / DT)
      tracks.k1[id] = tracks.k0[id]
      let x = 0
      let y = 0
      let up = 0
      let vp = 0
      let path = 0
      // the puff's centre: its release height (the body's lift in) plus
      // what the relief holds it up by
      let zRel = 0
      // the lift over a canopy at a windward edge
      let liftZ = 0
      let g0 = gSrc
      let aloft = false
      // the share of its scent still in the air at the noses' level: lost
      // over an edge (the flat model) or onto the vegetation (the column)
      let kept = 1
      let spdRef = srcSpeed
      let spdMax = srcSpeed
      for (let t = t0; t < TOTAL; t += DT) {
        const k = Math.round(t / DT)
        if (!sample(lon + x / kx, lat + y / ky, out)) break
        const mean = Math.hypot(out[0], out[1])
        const pm = Math.min(TABLE_M, Math.round(path))
        let sig = sz[pm]
        if (sig === 0) sig = sz[pm] = sigmaZ(pm, stable, convective) * T.vertMix
        let ue: number
        let un: number
        let mixF = 1
        let col: Column | null = null
        if (column) {
          col = colOf()
          // a windward edge: the head wind drops hard, and the share of the air
          // that did not get in lifts the puff toward the canopy's displacement
          // height; faster air again lets it settle
          if (spdRef >= EDGE_MIN && mean < spdRef * T.edgeDrop) {
            if (col.stand) {
              const target = T.edgeLift * col.th
              const zNow = zc0 + zRel + liftZ
              if (target > zNow) liftZ += (target - zNow) * (1 - mean / spdRef)
            }
            spdRef = mean
          } else if (mean > spdRef) {
            if (mean > 1.5 * spdRef) liftZ *= EDGE_SETTLE
            spdRef = mean
          }
        }
        const zc = zc0 + zRel + liftZ
        if (column && col) {
          // the puff's share in each layer, from its centre and spread
          const F2 = reflCdf(2, zc, sig)
          const Fb = reflCdf(col.zb, zc, sig)
          const P0 = Math.max(0, F2)
          const P1 = Math.max(0, Fb - F2)
          const P2 = Math.max(0, 1 - Fb)
          // the bush at nose height: the going grid's 10 m measure under the particle, else the habitat's
          let trap = col.trap
          if (dtm) {
            const gc = Math.floor(dtm.c0 + x * dtm.sx)
            const gr = Math.floor(dtm.r0 - y * dtm.sy)
            if (gc >= 0 && gr >= 0 && gc < dtm.cols && gr < dtm.rows) {
              const bz = dtm.bush[gr * dtm.cols + gc]
              if (Number.isFinite(bz)) trap = bz
            }
          }
          const tf = trapFactor(trap, T.bushTrap)
          // the mid layer's wind at the puff's mean height (the reflected Gaussian's: its centre, or 0.8 σz once that is more)
          const vm = midWind(col, Math.max(zc, 0.8 * sig))
          // under a bank the low air runs back toward it until the puff is up over it
          const back = cavityH > 0 && zc < cavityH && x * x + y * y < 9 * cavityH * cavityH ? -T.cavityBack : 1
          ue = back * (P0 * col.v0e * tf + P1 * vm * col.dirE) + P2 * col.v2e
          un = back * (P0 * col.v0n * tf + P1 * vm * col.dirN) + P2 * col.v2n
          mixF = col.mixF
          if (col.stand) over += noseAt[pm] * P2
        } else {
          if (edgeRule && spdRef >= EDGE_MIN && mean < spdRef * T.edgeDrop) {
            kept *= mean / spdRef
            spdRef = mean
          } else if (mean > spdRef) spdRef = mean
          ue = out[0]
          un = out[1]
        }
        if (mean > spdMax) spdMax = mean
        const c = Math.cos(phi[k])
        const sn = Math.sin(phi[k])
        const gm = (burst[k] ? gust : gusty ? lullMul : 1) * (lull[k] ? LULL_MUL : 1)
        const u = (ue * c + un * sn) * gm
        const v = (-ue * sn + un * c) * gm
        const spd = Math.sqrt(u * u + v * v)
        // the gusts' size with the wind and the spread; a canopy's sweeps and the bush stir harder
        const sigT = (0.1 + 0.35 * spd + 0.25 * spd * Math.sin(Math.min(80, out[2] * SPREAD) * (Math.PI / 180))) * (burst[k] ? 1.5 : 1) * (1 + 0.5 * (mixF - 1)) * T.gustSize
        up = up * (1 - DT / TL) + sigT * Math.sqrt((2 * DT) / TL) * gauss(rnd)
        vp = vp * (1 - DT / TL) + sigT * Math.sqrt((2 * DT) / TL) * gauss(rnd)
        const dx = (u + up) * DT
        const dy = (v + vp) * DT
        x += dx
        y += dy
        // the puff mixes upward with the distance travelled: faster under a
        // canopy, in bush and in sun over open ground (the column), and in the
        // flat model in the slow air past an edge at the rate the air above sets
        path += Math.max(0.2, spd, !column && kept < 1 ? MIX_FROM_ABOVE * spdMax : 0) * DT * mixF
        const cx = Math.floor((x + EXTENT_M) / CELL_M)
        const cy = Math.floor((EXTENT_M - y) / CELL_M)
        if (cx < 0 || cy < 0 || cx >= N || cy >= N) break
        if (col) {
          // what the vegetation takes out of the air: the deposition velocity
          // over the puff's depth
          kept *= Math.exp((-col.vd * DT) / Math.max(2, 2.5 * sig))
        }
        if (dtm) {
          const gc = Math.floor(dtm.c0 + x * dtm.sx)
          const gr = Math.floor(dtm.r0 - y * dtm.sy)
          const i = gc < 0 || gr < 0 || gc >= dtm.cols || gr >= dtm.rows ? -1 : gr * dtm.cols + gc
          if (i < 0) {
            g0 = NaN
          } else {
            const g1 = dtm.elev[i]
            if (warmWater && dtm.ground[i] === WATER) {
              // open water warmer than the air mixes the scent down to the surface
              zRel = 0
              aloft = false
            } else {
              const dz = g0 - g1
              if (dz > 0) {
                // falling ground: in still air the puff keeps its level; by day too
                // past a steep lee face in the open, where the flow separates; cold
                // air that drains, pools or runs off the shore follows the ground
                // down. The slope is the drop over the ground grid's own cell, never
                // over the particle's step (a metre or two, which made every 1 m
                // step down between cells a lee face: Lac Bailey, 2026-10-09, cones
                // five metres apart "totally different"); under a canopy the trunk
                // space follows its floor, so no separation there
                const ds = Math.max(Math.hypot(dx, dy), 10)
                const k2 = column && col && !col.stand && dz / ds >= T.sepSlope ? 1 : keep
                if (out[4] <= 0.5 && k2 > 0) zRel = Math.min(MAX_AGL - zc0, zRel + dz * k2)
              } else if (dz < 0) {
                // rising ground takes back what was gained, never below the release height
                zRel = Math.max(0, zRel + dz)
              }
            }
            g0 = g1
            walked = true
          }
        }
        if (k < STEPS) {
          tracks.x[base + k] = x
          tracks.y[base + k] = y
          tracks.k1[id] = k
        }
        // the nose-height weight: the table at the release height, or the
        // reflected Gaussian at the height the puff has now
        const zNow = zc0 + zRel + liftZ
        const w = zNow === height ? noseAt[pm] : heldUp(sig, zNow)
        if (rawGround === raw && zNow !== height) rawGround = raw.slice()
        raw[cy * N + cx] += w * kept
        if (rawGround !== raw) rawGround[cy * N + cx] += noseGround[pm] * kept
        wTotal += noseAt[pm]
        if (!column) over += noseAt[pm] * (1 - kept)
        if (zRel > 2) {
          lifted += noseAt[pm]
          aloft = true
        } else if (aloft && rawDown) {
          rawDown[cy * N + cx] += w * kept
          landed = true
        }
        if (x * x + y * y > 625) {
          const brg = ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360
          sectors[Math.round(brg / 45) % 8] += w * kept
        }
      }
    }
  }
  const grid = blur(raw)
  const ground = rawGround === raw ? grid : blur(rawGround)
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
  let down = 0
  if (rawDown && landed && ref > 0) {
    const d = blur(rawDown)
    for (let y = 0; y < N && down < TOUCH_CELLS; y++)
      for (let x = 0; x < N; x++) if (d[y * N + x] / ref >= NOTICE && Math.hypot(x - mid, y - mid) * CELL_M >= TOUCH_FROM_M) down++
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
      lifted: wTotal > 0 ? lifted / wTotal : 0,
      over: wTotal > 0 ? over / wTotal : 0,
      touchdown: down >= TOUCH_CELLS,
      checks: sit ? { n: sit.n, puffs: sit.puffs, lulls: sit.lullShare, share: sit.share } : null,
    },
    grid,
    tracks,
    relief: walked,
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
  /** a party member, where their phone last said (party/party.ts): their id in the party and their initials */
  party?: string
  who?: string
}

/** What the card and the map call a sitter: "you", a party member's initials, or their number from 1. */
export function sitterName(p: Sitter | undefined, k: number): string {
  return p?.live ? 'you' : (p?.who ?? `${k + 1}`)
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
  /** how strongly the cone is drawn, 0.1 … 1: the cloud's opacity, the puffs' alpha */
  strength: number
  /** start over: one person, here */
  show: (lon: number, lat: number) => void
  add: (lon: number, lat: number) => void
  move: (k: number, lon: number, lat: number) => void
  remove: (k: number) => void
  /** you, first in the list, at your position */
  putLive: (lon: number, lat: number) => void
  /** the party members sitting now, after everyone else (party/party.ts); the same list again changes nothing */
  setParty: (ps: Sitter[]) => void
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
  setStrength: (v: number) => void
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
      // a notch toward smaller, inside "as modelled": Gavan's (2026-10-03)
      risk: 0.55,
      strength: 1,
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
      setParty: (ps) => {
        const { people, pick } = get()
        const next = [...people.filter((p) => !p.party), ...ps]
        const same = next.length === people.length && next.every((p, i) => p.lon === people[i].lon && p.lat === people[i].lat && p.height === people[i].height && p.party === people[i].party && p.who === people[i].who && !!p.live === !!people[i].live)
        if (same) return
        // the one picked stays picked, wherever the list moved them
        const was = people[pick]
        const k = was ? next.findIndex((p) => (was.party ? p.party === was.party : p === was)) : -1
        set({ people: next, pick: k >= 0 ? k : Math.max(0, Math.min(pick, next.length - 1)) })
      },
      removeLive: () => {
        const rest = get().people.filter((p) => !p.live)
        // the party alone is not a sit of yours: your cone going takes theirs with it
        if (!rest.some((p) => !p.party)) return get().clear()
        if (rest.length < get().people.length) set({ people: rest, pick: 0, moving: null })
      },
      remove: (k) => {
        const { people, pick } = get()
        const rest = people.filter((_, i) => i !== k)
        if (!rest.length || (!people[k]?.party && !rest.some((p) => !p.party))) return get().clear()
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
      setStrength: (strength) => set({ strength: Math.min(1, Math.max(0.1, strength)) }),
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
      partialize: (s) => ({ view: s.view, height: s.height, distances: s.distances, risk: s.risk, strength: s.strength }),
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

/** The cloud's opacity: the card's Strength, a little fainter under each person's own edge. */
function cloudOpacity(dim: boolean): number {
  return (dim ? 0.6 : 0.9) * useScent.getState().strength
}

/** The Strength slider moved: the cloud already drawn takes it at once (the puffs read it each frame). */
function applyStrength(map: MlMap | null) {
  if (!map?.getLayer('scent-layer')) return
  const { view, people } = useScent.getState()
  map.setPaintProperty('scent-layer', 'raster-opacity', cloudOpacity(drawnView(view, people.length) === 'people'))
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
  map.setPaintProperty('scent-layer', 'raster-opacity', cloudOpacity(dim))
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
      features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon + tip[0] / kx, lat + tip[1] / ky] }, properties: { c, a, t: `${sitterName(people[k], k)} · ${reachLabel(r.plume)}` } })
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

// each person is a marker to drag about; a tap on one picks them for the card,
// a press held still asks where they sit, and a drag never does
let markers: maplibregl.Marker[] = []
let markersOn: MlMap | null = null
let dragging = -1
// as long as the hot buttons' hold
const HOLD_MS = 450
// the dot on the ground, and up a stand: pale, so a glance tells them apart
const GROUND_DOT = '#ff9d4d'
const STAND_DOT = '#fff2df'

const heightName = (h: number) => (h === GROUND_H ? 'Ground' : `Stand ${h} m`)

/** The held person's popup: where they sit, the ground or a stand, a tap to change it; and Remove. */
let personPop: { pop: maplibregl.Popup; k: number; sync: () => void } | null = null

function showPersonPopup(map: MlMap, k: number) {
  personPop?.pop.remove()
  const { people } = useScent.getState()
  const p = people[k]
  if (!p) return
  const el = document.createElement('div')
  const head = document.createElement('div')
  head.className = 'mp-head'
  const name = document.createElement('b')
  name.textContent = people.length > 1 ? `${k + 1} is at` : "You're at"
  head.append(name)
  const seg = document.createElement('div')
  seg.className = 'seg sp-heights'
  seg.setAttribute('role', 'radiogroup')
  seg.setAttribute('aria-label', people.length > 1 ? `Where ${k + 1} sits` : 'Where you sit')
  const buttons = SCENT_HEIGHTS.map((h) => {
    const b = document.createElement('button')
    b.textContent = heightName(h)
    b.setAttribute('role', 'radio')
    b.addEventListener('click', () => {
      const s = useScent.getState()
      s.setPick(k)
      s.setHeight(h)
      sync()
    })
    seg.append(b)
    return b
  })
  // Remove on a row of its own past a rule, well clear of the heights: a
  // thumb that slips off a stand never takes the person off the map
  const acts = document.createElement('div')
  acts.className = 'pp-acts sp-remove'
  const rm = document.createElement('button')
  rm.className = 'mp-danger'
  rm.textContent = people.length > 1 ? `Remove ${k + 1}` : 'Remove'
  rm.addEventListener('click', () => {
    // shut first: the people after k move up, and the popup would follow the next one
    pop.remove()
    useScent.getState().remove(k)
  })
  acts.append(rm)
  el.append(head, seg, acts)
  const pop = new maplibregl.Popup({ className: 'depth-popup', closeButton: false, closeOnClick: false, offset: 16, maxWidth: '300px' })
    .setLngLat([p.lon, p.lat])
    .setDOMContent(el)
    .addTo(map)
  closeOnTapOff(map, pop, { held: true })
  // the chips as the person is now: a tap here, or the card's own
  const sync = () => {
    const q = useScent.getState().people[k]
    if (!q) return pop.remove()
    pop.setLngLat([q.lon, q.lat])
    buttons.forEach((b, i) => {
      const on = SCENT_HEIGHTS[i] === q.height
      b.classList.toggle('seg-on', on)
      b.setAttribute('aria-checked', String(on))
    })
  }
  sync()
  pop.on('close', () => {
    if (personPop?.pop === pop) personPop = null
  })
  personPop = { pop, k, sync }
}

function syncMarkers(map: MlMap | null) {
  const { people, pick, view } = useScent.getState()
  if (markersOn !== map) {
    for (const m of markers) m.remove()
    markers = []
    markersOn = map
    personPop?.pop.remove()
  }
  if (!map) return
  while (markers.length > people.length) markers.pop()!.remove()
  while (markers.length < people.length) {
    // marker k is always person k: people come and go from the end of the list, the rest move up
    const k = markers.length
    const el = document.createElement('div')
    el.className = 'scent-person'
    // held still: where they sit. A finger that moves first is a drag (the
    // map's clickTolerance) and the hold is off
    let hold = 0
    let held = false
    const letGo = () => window.clearTimeout(hold)
    const holdOpen = () => {
      // a party member's height is theirs to set, on their phone
      if (!useScent.getState().people[k] || useScent.getState().people[k].party || map.isMoving()) return
      held = true
      if (navigator.vibrate) navigator.vibrate(12)
      useScent.getState().setPick(k)
      showPersonPopup(map, k)
    }
    el.addEventListener('pointerdown', (e) => {
      held = false
      letGo()
      if (e.button === 0) hold = window.setTimeout(holdOpen, HOLD_MS)
    })
    el.addEventListener('pointerup', letGo)
    el.addEventListener('pointercancel', letGo)
    // Android's long press and a right click: the same popup, not the browser's menu
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      letGo()
      if (!held) holdOpen()
    })
    // the map's own tap popup stays shut; with the tape or the routes out,
    // the person is the point you meant
    el.addEventListener('click', (e) => {
      e.stopPropagation()
      // letting go of a hold is not a tap
      if (held) return (held = false)
      const p = useScent.getState().people[k]
      if (p && useMeasureStore.getState().active) return useMeasureStore.getState().addPoint([p.lon, p.lat])
      if (p && useRoutes.getState().open) return useRoutes.getState().setTo({ lon: p.lon, lat: p.lat, kind: 'map', name: sitterName(p, k) })
      useScent.getState().setPick(k)
    })
    const m = new maplibregl.Marker({ element: el, draggable: true })
    const moved = () => {
      const ll = m.getLngLat()
      useScent.getState().move(k, ll.lng, ll.lat)
    }
    m.on('dragstart', () => {
      dragging = k
      letGo()
      personPop?.pop.remove()
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
    // a party member sits where their phone says: theirs to move, not a finger's here
    m.setDraggable(!p.live && !p.party)
    const el = m.getElement()
    // you: the position dot; a party member: their own dot, with its age (party/partyLayer.ts)
    el.style.display = p.live || p.party ? 'none' : ''
    el.textContent = many ? sitterName(p, k) : ''
    el.classList.toggle('sp-many', many)
    el.classList.toggle('sp-pick', many && k === pick)
    // up a tree: the dot pale (in their own colours, its ring) and the stand's height under it
    const stand = p.height !== GROUND_H
    el.style.setProperty('--sp', own ? personColour(k) : stand ? STAND_DOT : GROUND_DOT)
    el.style.setProperty('--sp-edge', own && stand ? STAND_DOT : '')
    el.dataset.h = stand ? `${p.height} m` : ''
  })
  personPop?.sync()
}

/** The planning time, or now to the minute: the plume's seed is the minute, and a drag keeps its cache. */
function planMinute(): number {
  return useAppStore.getState().planTimeMs ?? Math.floor(Date.now() / 60_000) * 60_000
}

// bumped whenever the air changes, so every cone is run again
let gen = 0
// each person's run, kept while only the people change, with one sampler for the minute
let cache: { gen: number; ms: number; sample: GroundSampler | null; runs: Map<string, PlumeRun | null> } | null = null

// The plume's time on the phone, in the dev log once an app run each way:
// walking the going grid's relief (still air over the core) and not. That
// pair is the before and after of the +20% budget in MICRO-WIND-LIDAR.md;
// a line per plume would fill the log on a drag.
const timed = new Set<boolean>()

function timedPlume(p: Sitter, ms: number, sample: GroundSampler | null): PlumeRun | null {
  const t0 = performance.now()
  const r = simulatePlume(p.lon, p.lat, ms, p.height, sample)
  if (r && !timed.has(r.relief)) {
    timed.add(r.relief)
    devlog('scent', `plume ${(performance.now() - t0).toFixed(1)} ms · ${r.relief ? `relief walked · ${Math.round(r.plume.lifted * 100)}% held up off a drop` : 'no relief walked'}`)
  }
  return r
}

function runsFor(people: Sitter[], ms: number): (PlumeRun | null)[] {
  ensureRelief()
  if (!cache || cache.gen !== gen || cache.ms !== ms) cache = { gen, ms, sample: cellSampler(ms), runs: new Map() }
  const c = cache
  const keep = new Map<string, PlumeRun | null>()
  const out = people.map((p) => {
    const key = `${p.lon},${p.lat},${p.height}`
    const r = c.runs.has(key) ? c.runs.get(key)! : timedPlume(p, ms, c.sample)
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
    /** the sit's length as run, s (the knobs can change it) */
    sitS: number
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

  const still = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || document.visibilityState !== 'visible'

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
    const { f: fr, sitS, srcs, outline, edge, tip, label } = state
    const project = (x: number, y: number) => m.project([fr.lon + x / fr.kx, fr.lat + y / fr.ky])
    const src = project(0, 0)
    const top = project(0, 100)
    const pxPerM = Math.hypot(top.x - src.x, top.y - src.y) / 100
    // sim time now, looping; standing still draws the end of the sit
    const T = still() ? sitS - DT : (((now - t0) % LOOP_MS) / LOOP_MS) * sitS
    const kf = T / DT
    const k = Math.floor(kf)
    const f = kf - k
    // the last minute fades, so the loop starts over without a blink
    const fade = Math.min(1, (sitS - T) / 60)
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
    ctx.globalAlpha = useScent.getState().strength
    ctx.drawImage(soft, 0, 0, w, h)
    ctx.globalAlpha = 1
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
      const sitS = ((runs.find(Boolean)?.tracks.steps ?? Math.ceil(TOTAL_S / DT) + 1) - 1) * DT
      state = { f: fr, sitS, srcs, outline, edge, tip, label: one ? reachLabel(one.plume) : null }
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
    /** the tab came back */
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

/** Share of the scent held up off a drop before the card says so. */
const LIFTED = 0.15

/**
 * The card's reason when scent leaves the ground off a drop, or null. True
 * whether or not it comes back down inside the grid: off a high bank over
 * flat low ground it may not, so the second half is said only when the
 * plume shows it landing where the ground rises again. Keyed on the share
 * held up alone, not on `stable` too as the spec had it: a drop is kept
 * from stable 0.3, and below 0.5, where the card does not call the air
 * still, a Pickle bank's cone already went from 330 m to 90 m (at 0.49).
 */
export function reliefReason(p: Plume): string | null {
  if (p.lifted <= LIFTED) return null
  return `Off the drop the scent holds its height over the low ground${p.touchdown ? ' and comes down where the ground rises' : ''}`
}

/** One line for the card: where most of it goes and how far. */
export function plumeSummary(p: Plume): string {
  const still = p.stable ? (p.lifted > LIFTED ? ' · still air, it holds its height off the drop' : ' · still air, it hugs the ground') : ''
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

/** The people placed by hand, carried over a reload the app makes itself
 *  (new maps saved, offline/downloads.ts): kept in sessionStorage and taken
 *  once. You come back with your first fix, the party with its feed. */
const CARRY_KEY = 'huntapp-scent-carry'

export function carryPlaced(): void {
  const { people, hidden, card } = useScent.getState()
  const placed = people.filter((p) => !p.live && !p.party)
  if (!placed.length) return
  try {
    sessionStorage.setItem(CARRY_KEY, JSON.stringify({ people: placed, hidden, card }))
  } catch {
    /* private mode: they go with the reload */
  }
}

function takeCarried(): { people: Sitter[]; hidden: boolean; card: boolean } | null {
  try {
    const raw = sessionStorage.getItem(CARRY_KEY)
    sessionStorage.removeItem(CARRY_KEY)
    const c = raw ? JSON.parse(raw) : null
    return Array.isArray(c?.people) && c.people.length ? c : null
  } catch {
    return null
  }
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
  const name = (k: number) => sitterName(people[k], k)
  const onto = new Map<number, string[]>()
  for (const [a, b] of g.reaches) onto.set(a, [...(onto.get(a) ?? []), name(b)])
  // the first names the scent; the rest are short: "1's scent drifts over you · yours over 2"
  const whose = (a: number, first: boolean) => (people[a]?.live ? (first ? 'Your scent' : 'yours') : `${sitterName(people[a], a)}'s${first ? ' scent' : ''}`)
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
      else if (s.strength !== p.strength) applyStrength(getMap())
      else if (s.people.length && (s.view !== p.view || s.hidden !== p.hidden || s.distances !== p.distances)) schedule()
      else if (s.people.length && s.pick !== p.pick) syncMarkers(getMap())
    })
    useAppStore.subscribe((s, p) => {
      if (s.planTimeMs !== p.planTimeMs && useScent.getState().people.length) schedule()
      if (s.units !== p.units && useScent.getState().distances && useScent.getState().people.length > 1) schedule()
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
    useScentTune.subscribe(airChanged)
    onMicro(airChanged)
    onProfile(airChanged)
    onWeatherGrid(airChanged)
    onRelief(airChanged)
    // back from a reload for new maps: the people placed before it, after
    // you and before the party, as a tap would have put them
    const carried = takeCarried()
    if (carried) {
      const now = useScent.getState().people
      useScent.setState({ people: [...now.filter((p) => p.live), ...carried.people, ...now.filter((p) => !p.live)], pick: 0, hidden: carried.hidden, card: carried.card })
    }
  })
}
