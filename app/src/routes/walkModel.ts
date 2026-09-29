/**
 * How fast a person walks over a piece of ground: the model under the
 * route finder, and the one place its constants live. Pure: the worker
 * runs it over every step of the grid, and the route card uses it to say
 * where a route's time goes. The science and its limits are in
 * docs/ROUTES.md.
 *
 * Speed is the pace set in the app (flat, firm, open ground: a road or a
 * trail) times a factor for each thing that slows you:
 *
 *   slope      the grade of the step, uphill and down, from the Lorentz
 *              curve fitted to GPS-tracked hiking (Campbell et al. 2019;
 *              these terms from the Type 1 crew fit, Sullivan et al. 2020,
 *              moderate tertile), divided by its value on the flat: fastest
 *              a touch downhill (-2.8°), 0.65 at +15°, 0.40 at +30°
 *   bush       LiDAR density of returns 0.5-3 m (NRD): Campbell et al.
 *              (2017) timed people walking through measured vegetation and
 *              found rate = 1.662 - 1.076 × NRD(0.15-2.75 m) - …, so each
 *              step of density costs 1.076 / 1.662 = 65 % of the open rate
 *   rough      ground roughness from the 1 m DTM, same study: 9.011 m/s per
 *              metre of roughness over 1.662, counted above the land's
 *              median so ordinary ground texture costs nothing
 *   ground     wet ground: open fen and bog at 1 / 1.8 (Soule & Goldman's
 *              "swampy bog" terrain coefficient), marsh slower, swamp less
 *              so (its bush is already in the bush term); a creek costs
 *              time to cross; water is not walked
 *
 * Every factor is at most 1, so the pace is the fastest anyone moves and
 * the A* heuristic (straight line at pace) never overestimates.
 */

export const GROUND = { upland: 0, water: 1, marsh: 2, openPeat: 3, swamp: 4, road: 5, stream: 6 } as const
export type GroundClass = (typeof GROUND)[keyof typeof GROUND]
export const GROUND_LABEL = ['upland', 'water', 'marsh', 'open fen or bog', 'swamp', 'road', 'creek'] as const

// Lorentz slope-rate curve, v = c / (πb (1 + ((θ - a) / b)²)) + d + eθ, θ in degrees, v in m/s
// Sullivan, Campbell, Dennison, Brewer & Butler 2020 (Fire 3:52), Table 2, moderate tertile
const LZ = { a: -2.8292, b: 20.9482, c: 77.6346, d: 0.2228, e: -0.0004 }
const lorentz = (deg: number) => LZ.c / (Math.PI * LZ.b * (1 + ((deg - LZ.a) / LZ.b) ** 2)) + LZ.d + LZ.e * deg
const V_FLAT = lorentz(0)
/** Beyond this the 10 m slope is a rock face or a cut bank: a scramble, not a walk. */
const SCRAMBLE_DEG = 38

/** The curve's peak over its flat value (it is fastest at -2.8°): the most any step gains. */
export const SLOPE_PEAK = lorentz(LZ.a) / V_FLAT

/** Slope factor for a step at this grade (rise / run), relative to the flat. */
export function slopeFactor(grade: number): number {
  const deg = (Math.atan(grade) * 180) / Math.PI
  const f = lorentz(deg) / V_FLAT
  return Math.abs(deg) > SCRAMBLE_DEG ? f * 0.25 : f
}

/** Campbell et al. 2017, Eq. 4: density and roughness terms over the intercept. */
const BUSH_PER_NRD = 1.076 / 1.662
const ROUGH_PER_M = 9.011 / 1.662
/** The land's median roughness in the bake (bake-going-summary.json): ordinary ground. */
export const ROUGH_BASE_M = 0.03

export function bushFactor(nrd: number): number {
  return Math.max(0.3, 1 - BUSH_PER_NRD * nrd)
}
export function roughFactor(m: number): number {
  return Math.min(1, Math.max(0.6, 1 - ROUGH_PER_M * (m - ROUGH_BASE_M)))
}

export interface WalkOptions {
  /** walking pace on the flat, open, firm, km/h */
  paceKmh: number
  /** wet ground and creeks count double: a dry-feet route */
  stayDry: boolean
}

/** Wet-ground factor by class; creeks are walked at half speed besides the crossing time. */
export function groundFactor(g: number, stayDry: boolean): number {
  let f: number
  switch (g) {
    case GROUND.marsh:
      f = 0.45
      break
    case GROUND.openPeat:
      f = 1 / 1.8
      break
    case GROUND.swamp:
      f = 0.8
      break
    case GROUND.stream:
      f = 0.5
      break
    case GROUND.water:
      return 0
    default:
      return 1
  }
  return stayDry ? f * f : f
}

/** Seconds to get across a creek: finding a place, a jump or a wade. */
export function crossingS(stayDry: boolean): number {
  return stayDry ? 240 : 90
}

export const isWet = (g: number) => g === GROUND.marsh || g === GROUND.openPeat || g === GROUND.swamp || g === GROUND.stream

/** Hunting along the way (docs/ROUTES.md, "Hunt routes"): how much good
 *  ground beside you takes off a step's cost; walking into it and your
 *  scent drifting onto it are per animal (HUNT_STYLE). */
export const HUNT = {
  /** a step with top ground in sight costs this much less */
  near: 0.35,
  /** how far downwind scent is checked, m, and where it starts to fade */
  scentReachM: 200,
  scentFullM: 100,
  /** the spot you are walking to counts as top ground this far round it, m */
  goalM: 60,
  /** …but not in the last stretch: you do have to get there */
  arriveM: 50,
  /** Good ground is relative to the day: the Spots scores under the grid,
   *  nothing below this share of them and the best above this one… */
  lowPct: 0.7,
  topPct: 0.97,
  /** …but never below a fair score: a poor day does not make poor ground good */
  floor: 0.35,
}

/** How each animal is hunted on the walk in. Big game: skirt the good
 *  ground rather than walk into it (you would bump what is bedded there)
 *  and keep your scent off it, a step whose scent reaches top ground
 *  costing 1 + scent times as much. Grouse: walk the cover to flush them,
 *  and they do not wind you. */
export const HUNT_STYLE: Record<'moose' | 'deer' | 'bear' | 'grouse', { intrude: number; scent: number }> = {
  moose: { intrude: 0.5, scent: 1.6 },
  deer: { intrude: 0.5, scent: 1.6 },
  bear: { intrude: 0.5, scent: 1.6 },
  grouse: { intrude: -0.15, scent: 0 },
}
