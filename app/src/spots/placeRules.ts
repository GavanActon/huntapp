/**
 * The rules that depend on the place, kept beside huntRules.ts, which calls
 * them: what the treeline, the north's calendars and the area's species
 * change about a cell's score. Each reads spots/profile.ts for the place;
 * an area with no profile gets none of them (no treeline, boreal
 * calendars), so its map is boreal Ontario's as before.
 *
 * The numbers are docs/research/reports/Mountain hunt habitat rules.md's
 * fixes, by number, and docs/HUNT-FISH-SCIENCE.md, "In the mountains".
 * Most are reasoned starting points, not yet field-checked.
 */
import type { Conditions } from './conditions'
import { COVER } from './habitatGrid'
import type { HuntBands } from './huntRules'
import { heatOnsetC, PROFILE, scoredMembers } from './profile'
import type { Quarry } from './regs'
import type { HuntTarget } from './types'
import type { Part } from './weights'

/** What a scoring pass knows of the day that the rules read cell by cell:
 *  worked out once per pass (huntRules.huntCtx), not per cell. */
export interface HuntCtx {
  dayOfYear: number
  /** the species the target is scored as today (spots/profile.ts) */
  members: Quarry[]
  /** afternoon heat past the coat's threshold: moose and bear to shade */
  warm: boolean
  /** the Ontario bear's late fall: berries done (from 15 Oct) */
  lateFall: boolean
  /** snow on the ground at the forecast point, cm (0 where unknown) */
  snowCm: number
}

export function huntCtx(t: HuntTarget, c: Conditions): HuntCtx {
  return {
    dayOfYear: c.dayOfYear,
    members: scoredMembers(t, c.timeMs).members,
    warm: c.tempC > heatOnsetC(c.dayOfYear) && c.sinceSunriseH > 2 && c.toSunsetH > 1.5,
    lateFall: c.dayOfYear >= 288,
    snowCm: c.snowDepthCm ?? 0,
  }
}

/** A habitat score's running tally: bonuses add, factors multiply, each
 *  weighed by its knob and written into the parts when asked for. */
export interface Tally {
  add(key: Part['key'], label: string, v: number): number
  times(key: Part['key'], label: string, m: number): number
}

/** Height over the treeline, m; NaN where the area has no treeline. */
export function dzOf(b: HuntBands, i: number): number {
  return b.dz ? b.dz[i] : NaN
}

/** The subalpine belt and above (within 300 m below the treeline, or over
 *  it): open country, where lakes are few, creeks and tall shrub matter,
 *  and the Ontario edge and funnel rules do not hold (fixes 6, 7, 18). */
export function openCountry(b: HuntBands, i: number): boolean {
  return dzOf(b, i) > -300
}

/** Moose use of a burn by years since, in the north: the willow and birch
 *  regrow slower, so the peak runs 11-30 yr (Alaska density, Maier et al.
 *  2005; Beaver River 5-35 yr selected 7.2× over conifer; fix 5). */
export function northRegrowth(age: number): number {
  if (age >= 255) return 0
  if (age <= 4) return 0.15
  if (age <= 10) return 0.45
  if (age <= 30) return 1.0
  if (age <= 40) return 0.8
  if (age <= 60) return 0.5
  return 0.2
}

/** Shrub as moose browse (fix 1). Tall willow is the food; dwarf birch and
 *  heath under a metre are not, and above the treeline the shrub is that
 *  unless the stand map measured it tall (a willow draw). Where the map
 *  measures shrub height (VRI, écoforestier), a low shrub (1 m) is half
 *  browse. Elsewhere the treeline is the only clue. */
export function shrubBrowse(b: HuntBands, i: number): number {
  const ht = b.height ? b.height[i] : 0
  const tall = PROFILE.shrubHeight && ht >= 2
  let v = PROFILE.shrubHeight && ht === 1 ? 0.55 : 0.9
  const dz = dzOf(b, i)
  if (dz > 50 && !tall) v *= Math.max(0.11, 1 - (0.89 * (dz - 50)) / 100)
  return v
}

/** Edge to cover in open country: tall shrub, terrain and spacing hide a
 *  moose at the treeline, so a weak term (fix 6), not Hamilton's 80 m. */
export function openEdge(distM: number): number {
  return distM <= 300 ? 1 : 0.7
}

/** Steep ground: moose avoid it (Beaver River exp(-0.054 × slope), eased:
 *  the 30 m DEM smooths the steepest pitches). Everywhere, not only in the
 *  mountains: on the Shield it rarely bites. */
export function slopeFactor(deg: number): number {
  if (deg < 12) return 1
  if (deg < 20) return 1 - (0.25 * (deg - 12)) / 8
  if (deg < 30) return 0.75 - (0.3 * (deg - 20)) / 10
  if (deg < 40) return 0.45 - (0.2 * (deg - 30)) / 10
  return 0.25
}

/** The moose's treeline band (fix 2, with fix 15's snow): through the rut
 *  full from 250 m below the treeline to 50 m above it, after mid-October
 *  from 200 below to 100 above; a taper to 0.6 by 500 m below (willow
 *  along a creek exempt) and to 0.4 at 150 m over the band's top, 0.2
 *  beyond. With 40 cm of snow and more, the high ground empties and the
 *  valleys are fine. */
export function mooseBand(b: HuntBands, i: number, ctx: HuntCtx): { f: number; label: string } {
  const dz = dzOf(b, i)
  if (!(dz === dz)) return { f: 1, label: '' }
  const post = ctx.dayOfYear > 288
  const lo = post ? -200 : -250
  const hi = post ? 100 : 50
  const snow = ctx.snowCm
  const cover = b.cover[i]
  const riparian = (cover === COVER.shrub || cover === COVER.hardwood || cover === COVER.mixed) && b.distStream != null && b.distStream[i] * 10 <= 100
  let f = 1
  let label = 'in the treeline willow band'
  if (dz > hi) {
    f = dz <= hi + 150 ? 1 - (0.6 * (dz - hi)) / 150 : dz <= hi + 250 ? 0.4 - (0.2 * (dz - hi - 150)) / 100 : 0.2
    label = 'above the treeline band'
  } else if (dz < lo && !riparian && snow < 40) {
    f = dz >= -500 ? 1 - (0.4 * (lo - dz)) / (lo + 500) : 0.6
    label = 'below the treeline band'
  }
  if (snow >= 40 && dz > -200) {
    f *= snow >= 70 ? 0.2 : snow >= 60 ? 0.4 : 0.7
    label = `${Math.round(snow)} cm of snow: moose leaving the high ground`
  }
  return { f, label }
}

/** Forest grouse thin out toward the treeline (fix 12). */
export function forestGrouseBand(b: HuntBands, i: number): number {
  const dz = dzOf(b, i)
  if (!(dz > -100)) return 1
  return dz >= 100 ? 0.3 : 1 - (0.7 * (dz + 100)) / 200
}

/** Berries after a burn, for both bears (fix 10): soapberry fruits from
 *  about 5 yr and stays good to 25 yr and more in an open stand; blueberry
 *  and crowberry peak long after. A closed canopy shades them out. */
export function berryBurn(age: number, crown: number): number {
  if (age >= 255) return 0
  if (age <= 3) return 0.3
  if (age <= 7) return 0.5 + (0.4 * (age - 4)) / 3
  if (age <= 30) return 1
  if (age <= 60) return crown < 40 ? 0.75 : 0.4
  return 0
}

function hideM(b: HuntBands, i: number): number {
  const conifer = b.distCover[i] * 10
  return b.distThick ? Math.min(conifer, b.distThick[i] * 10) : conifer
}

/** Black bear in the north and the mountains (fix 10): berries on the
 *  subalpine heath and in burns until frost (about 15 Sept), then open
 *  forest and burn edges, and from about 1 Oct the dens, low in black
 *  spruce, willow and alder (interior Alaska). Where grizzlies are, black
 *  bears give way to them on the high berry ground. */
export function northBlackBear(b: HuntBands, i: number, ctx: HuntCtx, x: Tally, grizzlies: boolean): number {
  const cover = b.cover[i]
  const dz = dzOf(b, i)
  const doy = ctx.dayOfYear
  const burn = b.disturb[i] < 255 ? berryBurn(b.disturb[i], b.crown[i]) : 0
  let s: number
  let label: string
  if (doy < 258) {
    label = 'berries'
    switch (cover) {
      case COVER.shrub:
        s = dz >= -250 && dz <= 150 ? 0.85 : 0.6
        label = dz >= -250 && dz <= 150 ? 'subalpine berry heath' : 'berry shrub'
        break
      case COVER.barren:
        // rock, gravel bars and alpine tundra: little for a black bear
        s = dz > 150 ? 0.05 : 0.15
        break
      case COVER.regen:
        s = 0.7
        break
      case COVER.hardwood:
      case COVER.mixed:
        s = 0.55
        break
      case COVER.coniferOpen:
        s = 0.5
        break
      case COVER.openWet:
        s = 0.4
        break
      case COVER.treedWet:
        s = 0.35
        break
      default:
        s = 0.3
    }
    if (burn * 0.95 > s) {
      s = burn * 0.95
      label = 'a burn in berries'
    }
  } else if (doy < 274) {
    label = 'after the frost: open forest'
    switch (cover) {
      case COVER.coniferOpen:
      case COVER.mixed:
      case COVER.hardwood:
        s = 0.65
        break
      case COVER.shrub:
        s = dz >= 0 ? 0.3 : 0.6
        break
      case COVER.treedWet:
        s = 0.5
        break
      case COVER.coniferDense:
        s = 0.45
        break
      case COVER.openWet:
        s = 0.35
        break
      case COVER.barren:
        s = 0.1
        break
      default:
        s = 0.3
    }
    if (burn * 0.8 > s) {
      s = burn * 0.8
      label = 'a burn edge'
    }
  } else {
    label = 'toward the dens: low spruce, willow and alder'
    const low = !(dz > -200)
    switch (cover) {
      case COVER.treedWet:
        s = 0.8
        break
      case COVER.coniferDense:
        s = low ? 0.65 : 0.4
        break
      case COVER.shrub:
        s = !(dz > -300) ? 0.55 : 0.2
        break
      case COVER.coniferOpen:
        s = 0.45
        break
      case COVER.mixed:
      case COVER.hardwood:
        s = 0.4
        break
      case COVER.barren:
        s = 0.05
        break
      default:
        s = 0.2
    }
  }
  s = x.add('browse', label, s)
  if (hideM(b, i) <= 300) s += x.add('edge', 'cover within 300 m', 0.2)
  if (b.distLake[i] * 10 <= 150 && s >= 0.5) s += x.add('shore', 'a shore within 150 m', 0.15)
  if (grizzlies && doy < 274 && dz > -100) s *= x.times('terrain', 'grizzly ground: black bears give way', 0.7)
  return s
}

/** Grizzly (fix 8): at and above the treeline on soapberry, blueberry,
 *  crowberry and the alpine meadows until mid-September; open forest with
 *  soapberry and young burns; from about 20 Sept bear root (Hedysarum) on
 *  the river bars too; from about 10 Oct the den slopes, steep, near or
 *  just over the treeline. Bare rock and ice high up hold nothing. */
export function grizzly(b: HuntBands, i: number, ctx: HuntCtx, x: Tally): number {
  const cover = b.cover[i]
  const dz = dzOf(b, i)
  const doy = ctx.dayOfYear
  const slope = b.slope[i]
  if (doy >= 283) {
    const near = !(dz < -150) && !(dz > 250)
    const steep = slope >= 25 ? 1 : slope >= 18 ? 0.7 : 0.3
    let s = near ? steep : 0.3
    if (cover === COVER.barren && dz > 250) s = 0.1
    return x.add('browse', near && steep >= 0.7 ? 'steep den slopes near the treeline' : 'on the way to the dens', s)
  }
  const late = doy >= 263
  const river = late && b.distStream != null && b.distStream[i] * 10 <= 150 && dz < -200
  const burn = b.disturb[i] < 255 ? berryBurn(b.disturb[i], b.crown[i]) : 0
  const band = !(dz < -250) && !(dz > 250)
  let s: number
  let label: string
  switch (cover) {
    case COVER.shrub:
      s = band ? 0.9 : 0.6
      label = band ? 'subalpine berry heath' : 'willow and birch'
      break
    case COVER.barren:
      s = dz > 250 ? 0.1 : 0.75
      label = dz > 250 ? 'rock and ice' : 'alpine meadow and heath'
      break
    case COVER.coniferOpen:
      s = b.crown[i] < 40 ? 0.85 : 0.6
      label = 'open forest: soapberry'
      break
    case COVER.regen:
      s = 0.8
      label = 'young regrowth'
      break
    case COVER.mixed:
    case COVER.hardwood:
      s = 0.6
      label = 'mixed forest'
      break
    case COVER.openWet:
      s = 0.5
      label = 'wet meadow'
      break
    case COVER.treedWet:
      s = 0.3
      label = 'treed bog'
      break
    case COVER.coniferDense:
      s = 0.25
      label = 'closed conifer'
      break
    default:
      s = 0.2
      label = 'little to eat'
  }
  if (burn * 0.95 > s) {
    s = burn * 0.95
    label = 'a burn in berries'
  }
  if (river && s < 0.85) {
    s = 0.85
    label = 'river bars: bear root'
  }
  s = x.add('browse', label, s)
  if (!band && !river) s *= x.times('terrain', 'off the treeline band', 0.6)
  return s
}

/** Ptarmigan (fix 11): willow ptarmigan in the willow and birch at the
 *  treeline; in the white moult (24 Sept-23 Oct at Chilkat Pass, Gruys
 *  1993) they climb onto the boulder fields and snow patches; rock
 *  ptarmigan on the rocky tundra above, white-tailed on the high rock.
 *  Once the snow buries the low shrub, only tall shrub holds them. None
 *  far below the trees. 0 where the area has no treeline. */
export function ptarmigan(b: HuntBands, i: number, ctx: HuntCtx, x: Tally): number {
  const dz = dzOf(b, i)
  if (!(dz >= -250)) return 0
  const cover = b.cover[i]
  const doy = ctx.dayOfYear
  const moult = doy >= 267 && doy <= 296
  let s = 0
  let label = ''
  if (cover === COVER.shrub) {
    const band = dz >= -150 && dz <= 250
    s = band ? (moult && dz < 0 ? 0.6 : 0.9) : 0.4
    label = 'willow and birch at the treeline: willow ptarmigan'
    const ht = b.height ? b.height[i] : 0
    if (ctx.snowCm >= 40 && !(PROFILE.shrubHeight && ht >= 2)) {
      s *= 0.35
      label = 'low shrub under the snow'
    }
  } else if (cover === COVER.barren) {
    // willow ptarmigan are the main bird; the rock and white-tailed ones
    // above them are fewer, and the moult's climb is a few hundred metres
    if (moult && dz <= 300) {
      s = 0.7
      label = 'boulder fields over the treeline: white birds go up'
    } else if (dz <= 400) {
      s = dz >= 100 ? 0.5 : 0.35
      label = 'rocky tundra: rock ptarmigan'
    } else {
      s = b.slope[i] >= 25 ? 0.35 : 0.25
      label = 'high rock: white-tailed ptarmigan'
    }
  } else if (cover === COVER.openWet) {
    s = 0.4
    label = 'a wet willow flat'
  } else if (cover === COVER.coniferOpen && dz >= -150) {
    s = 0.35
    label = 'open trees at the treeline'
  } else return 0
  return x.add('browse', label, s)
}

/** Getting the meat out (fix 3): the carry back to a road, a boat lake or
 *  camp, on the flat with every 100 m of climb counted as a km. A moose
 *  1.6 km out is a day's work; past 5 km a trip of several. Grouse weigh
 *  nothing. Null with a grid baked before the band. */
export function packOutAccess(t: HuntTarget, b: HuntBands, i: number): { access: number; label: string } | null {
  if (!b.packOut) return null
  const v = b.packOut[i]
  const km = (v * 50) / 1000
  const access =
    t === 'grouse' ? (km <= 3 ? 1 : km <= 6 ? 0.85 : 0.6) : km <= 1.6 ? 1 : km <= 3.2 ? 1 - (0.4 * (km - 1.6)) / 1.6 : km <= 5 ? 0.6 - (0.3 * (km - 3.2)) / 1.8 : 0.3
  const label = v >= 255 ? 'a carry out of over 12 km' : km < 1 ? `a ${Math.max(50, Math.round(km * 20) * 50)} m carry out` : `a ${km.toFixed(1)} km carry out, the climb counted`
  return { access, label }
}

/** Traffic (fix 16): moose and bear shy from a busy highway out to about
 *  a kilometre (Québec 100-250 m from roads, Yakutat about 1 km from busy
 *  routes), less from a bush road. 1 for grouse, and where the grid has no
 *  highway band (the old access rule counts the road there). */
export function roadPressure(t: HuntTarget, b: HuntBands, i: number): { f: number; label: string } {
  if (t === 'grouse' || !b.distHighway) return { f: 1, label: 'quiet' }
  const dh = b.distHighway[i] * 20
  let f = dh <= 250 ? 0.6 : dh < 1000 ? 0.6 + (0.4 * (dh - 250)) / 750 : 1
  let label = f < 1 ? `${dh < 1000 ? `${Math.round(dh / 50) * 50} m` : '1 km'} from the highway` : 'quiet'
  if (b.distRoad[i] * 20 <= 150 && f > 0.85) {
    f = 0.85
    label = 'on a road or trail'
  }
  return { f, label }
}

/** The moose rut in the north (fix 14): the same peak (Denali matings 24
 *  Sept-8 Oct), an earlier climb, and calling done by about 11 Oct, when
 *  bulls go to rest in the high willow basins. */
export function northRut(doy: number): { f: number; phase: string } {
  if (doy < 244) return { f: 0.2, phase: 'pre-rut' }
  if (doy < 258) return { f: 0.4 + (0.3 * (doy - 244)) / 14, phase: 'early rut: bulls locating, cow calls' }
  if (doy < 266) return { f: 0.7 + (0.3 * (doy - 258)) / 8, phase: 'rut building' }
  if (doy <= 281) return { f: 1.0, phase: 'peak rut' }
  if (doy <= 284) return { f: 0.6, phase: 'late peak' }
  if (doy <= 334) return { f: 0.3, phase: 'post-rut: bulls rest in the high willow basins; glass and still-hunt' }
  return { f: 0.2, phase: 'rut over' }
}
