import { DEFAULT_WEIGHTS, weigh, type Part, type Weights } from './weights'
/**
 * Hunting rules: the numbers in docs/HUNT-FISH-SCIENCE.md as code.
 *
 * Three pieces, kept apart so each can be read against the doc:
 *  - habitatScore: how good a cell is for the animal on its own, from the
 *    static grid (cover, stand age, disturbance, edges, water, landform)
 *  - activityVerdict: how the day's weather and hour move the odds, the
 *    same for every cell (the verdict card)
 *  - siteFactor: the per-cell wind and scent geometry for sitting or
 *    calling there right now, plus how reachable it is
 * Cell score = habitat × site; the verdict multiplies the headline.
 */
import { COVER, LANDFORM, type Habitat } from './habitatGrid'
import type { Conditions } from './conditions'
import { compass8, WARM_HIGH_C } from './conditions'
import { groundForScoring, REGIME_LABEL } from '../weather/micro/model'
import type { Factor, HuntTarget, Verdict } from './types'

// ---- lookups shared by the scorer, read once per pass ----
export interface HuntBands {
  cover: Uint8Array
  age: Uint8Array
  disturb: Uint8Array
  conifer: Uint8Array
  hardwood: Uint8Array
  lead: Uint8Array
  crown: Uint8Array
  landform: Uint8Array
  aspect: Uint8Array
  slope: Uint8Array
  tpi: Uint8Array
  distCover: Uint8Array
  distBrowse: Uint8Array
  bearBrowse: Uint8Array
  distLake: Uint8Array
  distWetland: Uint8Array
  distWater: Uint8Array
  distRoad: Uint8Array
  landFrac: Uint8Array
  /** eye-level bush thickness ×250, and m to thick hiding cover ×10;
   *  null with a habitat file baked before they existed */
  thick: Uint8Array | null
  distThick: Uint8Array | null
  /** per cell, the share of light that gets through 30 m of it (the view
   *  model's one number, precomputed: the heat map asks for it a million times) */
  through30: Float32Array | null
}

export function huntBands(h: Habitat): HuntBands {
  const u8 = (n: string) => h.raw(n) as Uint8Array
  return {
    cover: u8('cover'),
    age: u8('age'),
    disturb: u8('disturbAge'),
    conifer: u8('conifer'),
    hardwood: u8('hardwood'),
    lead: u8('lead'),
    crown: u8('crown'),
    landform: u8('landform'),
    aspect: u8('aspect'),
    slope: u8('slope'),
    tpi: u8('tpi'),
    distCover: u8('distCover'),
    distBrowse: u8('distBrowse'),
    bearBrowse: u8('bearBrowse'),
    distLake: u8('distLake'),
    distWetland: u8('distWetland'),
    distWater: u8('distWater'),
    distRoad: u8('distRoad'),
    landFrac: u8('landFrac'),
    thick: h.has('thick') ? u8('thick') : null,
    distThick: h.has('distThick') ? u8('distThick') : null,
    through30: h.has('thick') ? transmission(u8('thick'), u8('cover')) : null,
  }
}

/** Water, bog, rock and road are seen across; everything else by its bush. */
const SEE_ACROSS = new Set<number>([COVER.water, COVER.openWet, COVER.barren, COVER.road])

function transmission(thick: Uint8Array, cover: Uint8Array): Float32Array {
  const out = new Float32Array(thick.length)
  for (let j = 0; j < thick.length; j++) out[j] = Math.exp(-30 / (SEE_ACROSS.has(cover[j]) ? 400 : sightM(thick[j] / 250)))
  return out
}

/** Cell steps along a bearing, 30 m apart out to 240 m, per whole degree:
 *  the same for every cell, so worked out once. */
const stepCache = new Map<number, Int32Array>()
function stepsFor(h: Habitat, bearing: number): Int32Array {
  const key = ((Math.round(bearing) % 360) + 360) % 360
  let st = stepCache.get(key)
  if (!st) {
    st = new Int32Array(16)
    const rad = (key * Math.PI) / 180
    for (let k = 0; k < 8; k++) {
      const m = 30 * (k + 1)
      st[2 * k] = Math.round((-Math.cos(rad) * m) / h.cellM[1])
      st[2 * k + 1] = Math.round((Math.sin(rad) * m) / h.cellM[0])
    }
    stepCache.set(key, st)
  }
  return st
}

/** How far you see through bush of thickness t (0..1), metres: about 80 m
 *  in open woods, 5 m in a thicket (docs/HUNT-FISH-SCIENCE.md). */
export function sightM(t: number): number {
  return 5 + 75 * Math.pow(1 - t, 1.5)
}

/** Distance to hiding cover, m: the nearer of dense conifer and any thick
 *  bush; `thick` says which one it was. */
function hidingCover(b: HuntBands, i: number): { m: number; thick: boolean } {
  const conifer = b.distCover[i] * 10
  if (!b.distThick) return { m: conifer, thick: false }
  const t = b.distThick[i] * 10
  return t < conifer ? { m: t, thick: true } : { m: conifer, thick: false }
}

/** Expected view along a bearing from cell i, m: the light that gets
 *  through each 30 m of bush, summed, out to 240 m. Water and open bog
 *  are seen across. */
export function viewM(b: HuntBands, h: Habitat, i: number, bearing: number): number {
  const tr = b.through30!
  const st = stepsFor(h, bearing)
  const r0 = (i / h.cols) | 0
  const c0 = i - r0 * h.cols
  let tau = Math.sqrt(tr[i]) // half your own cell
  let range = 0
  for (let k = 0; k < 8; k++) {
    const rr = r0 + st[2 * k]
    const cc = c0 + st[2 * k + 1]
    if (rr < 0 || cc < 0 || rr >= h.rows || cc >= h.cols) break
    range += tau * 30
    tau *= tr[rr * h.cols + cc]
    if (tau < 0.03) break
  }
  return range
}

const OPEN_COVER = new Set<number>([COVER.water, COVER.openWet, COVER.regen, COVER.shrub, COVER.barren, COVER.road])

/** Moose use of a burn or cut by years since (MNRF 5–20 yr prime; peak 10–25). */
export function disturbanceCurve(age: number): number {
  if (age >= 255) return 0
  if (age <= 4) return 0.2
  if (age <= 9) return 0.7
  if (age <= 20) return 1.0
  if (age <= 30) return 0.6
  if (age <= 60) return 0.3
  return 0.2
}

/** Hamilton et al. 1980: 95 % of browsing within 80 m of cover. */
function edgeFromCover(distM: number): number {
  if (distM <= 80) return 1
  if (distM <= 200) return 0.6
  if (distM <= 400) return 0.3
  return 0.1
}
function edgeFromBrowse(distM: number): number {
  if (distM <= 100) return 1
  if (distM <= 250) return 0.6
  if (distM <= 500) return 0.3
  return 0.15
}

/** Static habitat value 0..1 of a land cell for a target. `warm` shifts
 *  moose and bear toward shade (afternoon above 14 °C). */
export function habitatScore(t: HuntTarget, b: HuntBands, i: number, warm: boolean, lateFall: boolean, w: Weights = DEFAULT_WEIGHTS, parts?: Part[]): number {
  const add = (key: Part['key'], label: string, v: number) => {
    parts?.push({ key, label, value: v, kind: 'bonus' })
    return v * w[key]
  }
  const times = (key: Part['key'], label: string, m: number) => {
    parts?.push({ key, label, value: m, kind: 'mult' })
    return weigh(m, w[key])
  }
  const cover = b.cover[i]
  if (cover === COVER.water || cover === COVER.nodata) return 0
  const dist = b.disturb[i]
  const dCover = b.distCover[i] * 10
  const dBrowse = b.distBrowse[i] * 10
  const dLake = b.distLake[i] * 10
  const dWet = b.distWetland[i] * 10
  const lf = b.landform[i]
  const landFrac = b.landFrac[i] / 255
  let s: number

  if (t === 'moose' || t === 'deer') {
    // browse value by cover, overridden by the disturbance curve on burns and cuts
    let browse: number
    switch (cover) {
      case COVER.hardwood:
        browse = 0.8
        break
      case COVER.mixed:
        browse = b.hardwood[i] >= 40 ? 0.85 : 0.65
        break
      case COVER.shrub:
        browse = 0.9
        break
      case COVER.regen:
        browse = 0.3
        break
      case COVER.coniferOpen:
        browse = 0.4
        break
      case COVER.coniferDense:
        browse = 0.3
        break
      case COVER.treedWet:
        browse = 0.5
        break
      case COVER.openWet:
        browse = 0.45
        break
      case COVER.road:
        browse = 0.25
        break
      default:
        browse = 0.1
    }
    if (dist < 255) browse = Math.max(browse * 0.5, disturbanceCurve(dist))
    const isCover = cover === COVER.coniferDense || cover === COVER.treedWet
    // interspersion: browse near cover, cover near browse. The stand's own
    // value is one part, the edge bonus another, so each has its knob.
    // hiding cover is any thick bush, not only tall dense conifer: a moose
    // beds in a young thicket or an alder run as readily
    const hide = hidingCover(b, i)
    const base = isCover ? browse * 0.3 : browse * 0.45
    const edge = isCover ? 0.35 * edgeFromBrowse(dBrowse) : browse * 0.55 * edgeFromCover(hide.m)
    s = add('browse', isCover ? 'conifer cover' : 'browse value', base) + add('edge', isCover ? 'browse within reach' : hide.thick ? 'near thick cover' : 'near the conifer edge', edge)
    // water: cows and calves on shores and beaver meadows; bulls come to them in the rut
    if (dLake <= 200 || dWet <= 100) s += add('shore', 'shore or beaver meadow', 0.15)
    if (dLake <= 60 && dist >= 5 && dist <= 30) s += add('shore', 'a cut running to the shore', 0.1)
    // funnels
    if (lf === LANDFORM.saddle) s += add('funnel', 'a saddle', 0.15)
    if (landFrac < 0.5) s += add('funnel', 'a neck between waters', 0.2)
    else if (landFrac < 0.65) s += add('funnel', 'a point or shoreline strip', 0.08)
    if (lf === LANDFORM.bench && dWet <= 300) s += add('funnel', 'a bench above a wetland', 0.05)
    if (warm) {
      // heat: beds in shade by day (Renecker & Hudson 14 °C)
      if (isCover) s *= times('heat', 'shade on a warm day', 1.5)
      else if (OPEN_COVER.has(cover) || cover === COVER.hardwood) s *= times('heat', 'open ground on a warm day', 0.5)
    }
    if (t === 'deer') {
      s *= 0.5
      const asp = b.aspect[i]
      if (asp !== 255) {
        const deg = asp * (360 / 250)
        if (deg >= 135 && deg <= 225 && b.slope[i] >= 3) s += add('funnel', 'a south slope', 0.3)
      }
      if (hidingCover(b, i).m <= 500) s += add('edge', 'cover within 500 m', 0.15)
    }
  } else if (t === 'grouse') {
    const age = b.age[i]
    const conif = b.conifer[i]
    switch (cover) {
      case COVER.hardwood:
      case COVER.mixed: {
        const aspenish = b.lead[i] === 7 || b.lead[i] === 8 || b.hardwood[i] >= 40
        s = aspenish ? (age >= 6 && age <= 25 ? 1.0 : age <= 40 ? 0.6 : 0.35) : 0.4
        break
      }
      case COVER.shrub:
        s = 0.8 // alder runs
        break
      case COVER.regen:
        s = dist >= 5 ? 0.7 : 0.3
        break
      case COVER.coniferDense:
      case COVER.coniferOpen:
        // spruce grouse: dense young jack pine and black spruce
        s = conif >= 70 && age >= 10 && age <= 40 ? 0.7 : (b.lead[i] === 2 ? 0.45 : 0.3)
        break
      case COVER.treedWet:
        s = 0.35 // black spruce–tamarack swamp edges
        break
      case COVER.openWet:
        s = 0.15
        break
      case COVER.road:
        s = 0.5
        break
      default:
        s = 0.1
    }
    s = add('browse', 'the stand for grouse', s)
    if (b.distWater[i] * 10 <= 50 && (cover === COVER.shrub || cover === COVER.mixed || cover === COVER.hardwood)) s += add('shore', 'water within 50 m', 0.2)
    if (b.distRoad[i] * 20 <= 40) s += add('access', 'roadside grit and clover', 0.25)
    if (dCover <= 60 && (cover === COVER.hardwood || cover === COVER.mixed)) s += add('edge', 'hardwood–conifer edge', 0.1)
  } else {
    // bear: berries in young disturbance and dry jack pine, then denning cover
    if (dist >= 3 && dist <= 20) s = 1.0
    else if (cover === COVER.regen) s = 0.8
    else if (cover === COVER.shrub) s = 0.6
    else if (b.lead[i] === 2 && b.age[i] <= 40) s = 0.6
    else if (cover === COVER.hardwood) s = 0.55
    else if (cover === COVER.mixed) s = 0.5
    else if (cover === COVER.treedWet) s = 0.35
    else if (cover === COVER.openWet) s = 0.3
    else if (cover === COVER.coniferDense) s = 0.2
    else if (cover === COVER.coniferOpen) s = 0.3
    else s = 0.1
    s = add('browse', 'berries and cover for bear', s)
    if (hidingCover(b, i).m <= 300) s += add('edge', 'cover within 300 m', 0.2)
    if (dLake <= 150 && s >= 0.5) s += add('shore', 'a shore within 150 m', 0.15)
    if (lf === LANDFORM.ridge && b.lead[i] === 2) s += add('funnel', 'a jack pine ridge', 0.1)
    if (lateFall) {
      // berries gone: uplands and thick conifer toward denning
      if (cover === COVER.coniferDense) s *= times('heat', 'late fall: thick conifer', 1.6)
      else if (dist <= 20 || cover === COVER.regen || cover === COVER.shrub) s *= times('heat', 'late fall: berries done', 0.5)
    }
  }
  // a soft ceiling instead of a hard cap: two good cells still rank, the better one first
  return 1 - Math.exp(-1.6 * s)
}

/** Moose calling effectiveness by date (Ontario rut, peak 25 Sept–5 Oct). */
export function rutFactor(month: number, doy: number): { f: number; phase: string } {
  // day of year for the season markers (non-leap; a day off never matters here)
  if (doy < 258) return { f: 0.2, phase: month >= 8 ? 'pre-rut' : 'off-season' }
  if (doy <= 265) return { f: 0.5, phase: 'early rut: bulls locating, cow calls' }
  if (doy <= 281) return { f: 1.0, phase: 'peak rut' }
  if (doy <= 288) return { f: 0.7, phase: 'late peak' }
  if (doy <= 298) return { f: 0.4, phase: 'post-peak: cow calls beat grunts' }
  return { f: 0.2, phase: 'rut over' }
}

function hourWeight(t: HuntTarget, c: Conditions, peakRutCold: boolean): { w: number; label: string } {
  const s = c.sinceSunriseH
  const e = c.toSunsetH
  if (s >= -0.5 && s <= 3) return { w: 1, label: 'first light: prime' }
  if (e >= -0.5 && e <= 3) return { w: 1, label: 'last light: prime' }
  if (s < -0.5 || e < -0.5) return { w: t === 'bear' ? 0.4 : 0.35, label: 'dark' }
  if (s <= 5) return { w: 0.6, label: 'mid-morning' }
  if (t === 'bear' && c.tempC < 12) return { w: 0.6, label: 'midday, cool: bears still feeding' }
  return { w: peakRutCold ? 0.5 : 0.3, label: peakRutCold ? 'midday, but cold in the peak rut' : 'midday lull' }
}

/** The day's odds for a target and the reasons. Same for every cell. */
export function activityVerdict(t: HuntTarget, c: Conditions, w: Weights = DEFAULT_WEIGHTS): Verdict {
  const factors: Factor[] = []
  const notes: string[] = []
  const warnings: string[] = []
  const rut = rutFactor(c.month, c.dayOfYear)
  const peakRutCold = t === 'moose' && rut.f >= 1 && c.tempC < 10

  const hw = hourWeight(t, c, peakRutCold)
  factors.push({ label: hw.label, mult: hw.w, key: 'light' })

  // temperature (moose thermal thresholds; bear and grouse less sensitive)
  let tm: number
  let tl: string
  if (t === 'moose' || t === 'deer') {
    tm = c.tempC <= 10 ? 1 : c.tempC <= 14 ? 0.8 : c.tempC <= 20 ? 0.5 : 0.3
    tl = c.tempC <= 0 ? 'frost: moose on their feet' : c.tempC <= 10 ? 'cool: full activity' : c.tempC <= 14 ? 'mild' : c.tempC <= 20 ? (c.isDay ? 'warm: bedded in shade by day' : 'warm night: they move late') : c.isDay ? 'hot: little daytime movement' : 'hot night'
    if (c.tempC <= 0) tm = 1.1
  } else {
    tm = c.tempC <= 20 ? 1 : 0.8
    tl = c.tempC <= 20 ? 'temperature fine' : 'warm afternoon'
  }
  factors.push({ label: tl, mult: tm, note: `${Math.round(c.tempC)}°C`, key: 'temp' })

  // wind: calling range and movement
  const wk = c.windKmh
  let wm: number
  let wl: string
  if (t === 'moose') {
    wm = wk <= 10 ? 1 : wk <= 20 ? 0.7 : wk <= 30 ? 0.4 : 0.2
    wl = wk <= 10 ? 'calm: calls carry' : wk <= 20 ? 'breezy: calling range shrinks' : wk <= 30 ? 'windy: stalk, do not call' : 'gale: ambush lee slopes only'
  } else if (t === 'grouse') {
    wm = wk <= 15 ? 1 : wk <= 25 ? 0.7 : 0.4
    wl = wk <= 15 ? 'light wind: birds out' : wk <= 25 ? 'breezy: birds tighter to cover' : 'windy: birds sit tight'
  } else {
    wm = wk <= 20 ? 1 : wk <= 30 ? 0.8 : 0.6
    wl = wk <= 20 ? 'wind fine' : 'windy: less movement'
  }
  factors.push({ label: wl, mult: wm, note: `${Math.round(wk)} km/h ${compass8(c.windDir)}`, key: 'wind' })
  if (c.windShiftDeg > 30 && wk > 5) factors.push({ label: `wind swings ${Math.round(c.windShiftDeg)}° in the next hours: stands get fouled`, mult: 0.85, key: 'wind' })

  // rain and snow
  const p = c.precipMmH
  if (p > 3) factors.push({ label: 'heavy rain: no calling, no visibility', mult: t === 'moose' ? 0.4 : 0.5, note: `${p.toFixed(1)} mm/h`, key: 'rain' })
  else if (p > 1) factors.push({ label: t === 'grouse' ? 'rain: birds under cover' : 'steady rain: still-hunt, calling poor', mult: t === 'grouse' ? 0.5 : 0.7, note: `${p.toFixed(1)} mm/h`, key: 'rain' })
  else if (p > 0) factors.push({ label: 'drizzle: quiet walking, moose keep moving', mult: t === 'grouse' ? 0.8 : 1.0, key: 'rain' })

  // cloud on a cool day extends the morning
  if (c.cloudPct >= 80 && c.tempC < 14 && c.sinceSunriseH > 3 && c.toSunsetH > 3) factors.push({ label: 'overcast and cool: midday stays active', mult: 1.1, key: 'light' })
  // the last few days: a warm spell beds moose and deer by day; the first
  // cool day after one is the break that moves them (and stands in for the
  // 24 h front factor, which would count the same drop twice)
  let broke = false
  if ((t === 'moose' || t === 'deer') && c.warmRun >= 2 && c.dayHigh != null) {
    if (c.dayHigh >= WARM_HIGH_C) factors.push({ label: `warm spell, day ${c.warmRun + 1}: bedded through the heat, moving at night`, mult: 0.85, note: `highs ${Math.round(c.dayHigh)}°C`, key: 'recent' })
    else if (c.prevHigh != null && (c.prevHigh - c.dayHigh >= 5 || c.dayHigh < 14)) {
      broke = true
      factors.push({ label: `first cool day after ${c.warmRun} warm ones: expect movement`, mult: 1.15, note: `high ${Math.round(c.dayHigh)}° after ${Math.round(c.prevHigh)}°`, key: 'recent' })
    }
  }
  // a front that just passed: the temperature drop is what matters
  if (!broke && c.tempDrop24h >= 5 && c.windKmh < 25) factors.push({ label: `cold front through: ${Math.round(c.tempDrop24h)}° colder than yesterday`, mult: 1.15, key: 'front' })
  else if (!broke && c.tempDrop24h <= -6) factors.push({ label: 'warm-up: slower than yesterday', mult: 0.9, key: 'front' })

  if (t === 'moose') {
    factors.push({ label: rut.phase, mult: 0.6 + 0.4 * rut.f, key: 'rut' })
    if (rut.f >= 0.7) notes.push('Cow calls 30–60 s every 15–20 min; put the call 40–50 m upwind of the shooter; a bull circles downwind.')
    if (c.windKmh <= 8 && c.cloudPct < 40) notes.push(c.toSunsetH <= 1.5 || c.sinceSunriseH < 0.7 ? 'Thermals: air sinks downslope now; scent pools in hollows and drains to the lakes. Sit above the animal.' : 'Thermals: air rises upslope now; sit level with or below where the animal is.')
  }
  if (t === 'grouse' && c.tempDrop24h >= 5 && c.tempC <= 2) notes.push('After a hard frost birds move to edges and roadside gravel.')
  if (t === 'bear' && c.month >= 10 && c.dayOfYear >= 288) notes.push('Berries are done: bears drift to thick conifer uplands before denning.')
  notes.push(`Moon ${Math.round(c.moonIllum * 100)} % lit: no measured effect on movement.`)
  if (!c.hrdps) notes.push('This hour is beyond the HRDPS horizon: blended forecast.')

  const activity = factors.reduce((a, f) => a * (f.key ? weigh(f.mult, w[f.key]) : f.mult), 1)
  const head =
    activity >= 0.85 ? 'Prime' : activity >= 0.6 ? 'Good' : activity >= 0.4 ? 'Fair' : activity >= 0.25 ? 'Slow' : 'Poor'
  const what = t === 'moose' ? (c.windKmh <= 15 && rut.f >= 0.5 ? 'for calling' : 'for a sit') : t === 'grouse' ? 'for walking roads and edges' : t === 'bear' ? 'on the berry cuts' : 'for a sit'
  return { activity, headline: `${head} ${what}`, factors, warnings, notes }
}

/** Per-cell wind and scent geometry and reachability, 0..1: the product of
 *  the weighed parts. */
export function siteFactor(t: HuntTarget, b: HuntBands, h: Habitat, i: number, c: Conditions, reasons?: string[], w: Weights = DEFAULT_WEIGHTS, parts?: Part[]): number {
  // the heat map's pass, every cell: the three numbers, no words and no
  // objects (building the labels was most of siteParts' own time). The
  // same products in the same order, so the same score to the bit
  if (!reasons && !parts) {
    siteCore(t, b, h, i, c, undefined, null)
    return weigh(SITE[0], w.scent) * weigh(SITE[1], w.visibility) * weigh(SITE[2], w.access)
  }
  const sp = siteParts(t, b, h, i, c, reasons)
  parts?.push(...sp)
  return sp.reduce((m, p) => m * weigh(p.value, w[p.key]), 1)
}

/** The site's three parts: scent (wind and thermals against the feeding
 *  side), the downwind view, and access. Each 0..1, unweighed. */
export function siteParts(t: HuntTarget, b: HuntBands, h: Habitat, i: number, c: Conditions, reasons?: string[]): Part[] {
  const labels: string[] = []
  siteCore(t, b, h, i, c, reasons, labels)
  return [
    { key: 'scent', label: labels[0], value: SITE[0], kind: 'mult' },
    { key: 'visibility', label: labels[1], value: SITE[1], kind: 'mult' },
    { key: 'access', label: labels[2], value: SITE[2], kind: 'mult' },
  ]
}

/** siteCore's answer: scent, view, access, each 0..1, unweighed */
const SITE = new Float64Array(3)
/** the five gusts' weights the scent part averages over the direction spread */
const SPREAD_W = [-2, -1, 0, 1, 2].map((k) => Math.exp(-((k * 0.75) ** 2) / 2))

function geo(from: number, approach: number): number {
  const a = Math.abs(((from - approach) % 360 + 540) % 360 - 180)
  return a <= 30 ? 0.9 : a <= 120 ? 1.0 : a <= 150 ? 0.5 : 0.12
}

/** The site's three parts into SITE; their words into labels, and the
 *  reasons, only when asked for (a tapped cell, the breakdown). */
function siteCore(t: HuntTarget, b: HuntBands, h: Habitat, i: number, c: Conditions, reasons: string[] | undefined, labels: string[] | null): void {
  let g: number
  const bear = b.bearBrowse[i]
  const evening = c.toSunsetH <= 1.5 || c.sinceSunriseH < 0.7
  // the air at head height in this cell (docs/MICRO-WIND.md): drainage,
  // shelter, breezes and the forecast's layering, not one regional arrow.
  // The heat map skips the tree-line search; a tapped cell gets it all.
  // The cell's centre written out, as h.center works it: no array a cell
  const row = (i / h.cols) | 0
  const lon = h.west + (i - row * h.cols + 0.5) * h.dLon
  const lat = h.north - (row + 0.5) * h.dLat
  const gw = groundForScoring(c.timeMs, lon, lat, reasons != null)
  const windDir = gw ? gw.dirFrom : c.windDir
  const calm = gw ? gw.kmh < 0.8 : c.windKmh < 5
  if (gw && reasons && c.windKmh > 3 && !calm) {
    const off = Math.abs(((gw.dirFrom - c.windDir) % 360 + 540) % 360 - 180)
    if (off > 45) reasons.push(`at ground the air runs from the ${compass8(gw.dirFrom)}, not the forecast's ${compass8(c.windDir)} (${REGIME_LABEL[gw.regime].toLowerCase()})`)
  }
  if (!calm && bear !== 255) {
    // expected approach from the browse; wind FROM windDir
    const approach = bear * (360 / 250)
    const a = Math.abs(((windDir - approach) % 360 + 540) % 360 - 180)
    if (gw) {
      // averaged over the direction spread: a swirly spot is a gamble
      const sd = Math.min(90, gw.sigmaDeg)
      let sw = 0
      g = 0
      for (let k = -2; k <= 2; k++) {
        const wk = SPREAD_W[k + 2]
        g += wk * geo(windDir + k * 0.75 * sd, approach)
        sw += wk
      }
      g /= sw
    } else g = geo(windDir, approach)
    const air = gw ? 'ground air' : 'wind'
    if (a <= 30) reasons?.push(`straight downwind of the feeding side (${compass8(approach)})`)
    else if (a <= 120) reasons?.push(`crosswind to the feeding side (${compass8(approach)}), ${air} ${compass8(windDir)}`)
    else if (a > 150) reasons?.push(`your scent ${gw ? 'drifts' : 'blows'} into the feeding side`)
    if (gw && gw.sigmaDeg >= 55) reasons?.push(`the air here swings ±${Math.round(gw.sigmaDeg)}°: scent goes where it likes`)
  } else if (calm && gw) {
    g = gw.regime === 'pooled' ? 0.35 : 0.6
    reasons?.push(gw.regime === 'pooled' ? 'cold air settled here: scent pools round you' : 'near dead calm at ground: scent spreads every way')
  } else if (calm) {
    // no ground model: the thermals rule of thumb, evening drains downslope, morning rises
    const tpi = b.tpi[i] - 128
    if (evening) {
      g = tpi >= 2 ? 1.0 : tpi <= -3 ? 0.35 : 0.7
      if (tpi <= -3) reasons?.push('a hollow at dusk: scent pools here')
      else if (tpi >= 2) reasons?.push('sits above the ground below: evening thermals carry scent down past it')
    } else {
      g = tpi <= -1 ? 0.95 : tpi >= 4 ? 0.6 : 0.8
      if (tpi <= -1) reasons?.push('low ground in the morning: rising air carries scent up and away')
    }
  } else g = 0.75

  // the view: can you see what circles downwind (a grouse flushes any
  // way, so for grouse it is the view all round)? From the bush
  // thickness where the bake has it, else from open cover classes
  const down = (windDir + 180) % 360
  let vis: number
  let visLabel = ''
  if (b.through30) {
    // the bearings written out, each as (br + 360) % 360 as before: no array a cell
    const range =
      t === 'grouse'
        ? (viewM(b, h, i, 0) + viewM(b, h, i, 90) + viewM(b, h, i, 180) + viewM(b, h, i, 270)) / 4
        : (viewM(b, h, i, (down - 30 + 360) % 360) + viewM(b, h, i, (down + 360) % 360) + viewM(b, h, i, (down + 30 + 360) % 360)) / 3
    // a sitter needs the view; a grouse hunter walks the thick and flushes
    // birds out of it, so for grouse thick bush costs a shot, not the spot
    vis = t === 'grouse' ? 0.82 + 0.18 * Math.min(1, range / 60) : 0.6 + 0.4 * Math.min(1, range / 100)
    const where = t === 'grouse' ? 'round you' : 'downwind'
    if (labels) visLabel = range >= 80 ? `open ${where}` : range >= 35 ? `partly open ${where}` : `thick ${where}`
    if (range >= 80 && t !== 'grouse') reasons?.push('open ground downwind: a circling animal shows itself')
    else if (range < 35) reasons?.push(`thick ${where}: about ${Math.max(5, Math.round(range / 5) * 5)} m of view`)
    else reasons?.push(`about ${Math.round(range / 5) * 5} m of view ${where}`)
  } else {
    let open = 0
    let n = 0
    for (const m of [60, 120, 200, 300]) {
      const j = h.offset(i, down, m)
      if (j < 0) continue
      n++
      if (OPEN_COVER.has(b.cover[j]) || b.cover[j] === COVER.regen) open++
    }
    const openFrac = n ? open / n : 0.5
    vis = 0.7 + 0.3 * openFrac
    if (labels) visLabel = openFrac >= 0.75 ? 'open downwind' : openFrac >= 0.4 ? 'partly open downwind' : 'thick downwind'
    if (openFrac >= 0.75) reasons?.push('open ground downwind: a circling animal shows itself')
  }
  if (c.windShiftDeg > 30 && !calm) g *= 0.85

  // reachable: near a road or a shore, but not on the road
  const dRoad = b.distRoad[i] * 20
  const dLake = b.distLake[i] * 10
  let access = dRoad <= 150 ? 0.85 : dRoad <= 2500 ? 1 : dRoad <= 4000 ? 0.8 : 0.5
  if (dLake <= 120) access = Math.max(access, 0.95) // by boat
  if (t === 'grouse') access = dRoad <= 60 ? 1 : dRoad <= 800 ? 0.9 : 0.6
  SITE[0] = g
  SITE[1] = vis
  SITE[2] = access
  if (!labels) return
  labels[0] = calm ? (gw ? 'still air at ground' : 'thermals') : gw ? 'ground air against the feeding side' : 'wind against the feeding side'
  labels[1] = visLabel
  labels[2] = dLake <= 120 && dRoad > 150 ? 'reachable by boat' : dRoad <= 150 ? 'right by a road' : dRoad <= 2500 ? `${dRoad < 1000 ? `${dRoad} m` : `${(dRoad / 1000).toFixed(1)} km`} from a road` : 'a long walk in'
}

/** Words for a cell: what it is and why it scores. */
export function describeCell(t: HuntTarget, b: HuntBands, h: Habitat, i: number, c: Conditions): string[] {
  const out: string[] = []
  const cover = b.cover[i]
  const dist = b.disturb[i]
  const age = b.age[i]
  let what = h.coverNames[cover] ?? 'land'
  if (dist < 255) what = `${dist}-year-old ${dist === b.age[i] && b.lead[i] === 0 ? 'cut or burn' : 'burn or cut'}`
  else if (age > 0 && cover >= COVER.coniferDense && cover <= COVER.hardwood) what += `, about ${age} yr`
  if (b.conifer[i] > 0 || b.hardwood[i] > 0) {
    const lead = ['', 'black spruce', 'jack pine', 'white spruce', 'balsam fir', 'cedar', 'tamarack', 'aspen', 'birch'][b.lead[i]]
    if (lead) what += `, ${lead}-led`
  }
  out.push(what)
  if (b.thick && cover !== COVER.water && cover !== COVER.road) {
    const tt = b.thick[i] / 250
    const see = Math.round(sightM(tt) / 5) * 5
    if (tt >= 0.75) out.push(`thick bush: about ${see} m of sight, slow and loud to walk`)
    else if (tt <= 0.35 && cover !== COVER.openWet) out.push(`open underfoot: about ${see} m of sight`)
  }
  const hide = hidingCover(b, i)
  const dBrowse = b.distBrowse[i] * 10
  if (cover === COVER.coniferDense || cover === COVER.treedWet) {
    if (dBrowse <= 250) out.push(`cover ${dBrowse} m from browse`)
  } else if (hide.m <= 200 && !(b.thick && b.thick[i] / 250 >= 0.7)) out.push(`${hide.m <= 30 ? 'right on' : `${hide.m} m from`} ${hide.thick ? 'thick cover' : 'the conifer edge'}`)
  const dLake = b.distLake[i] * 10
  const dWet = b.distWetland[i] * 10
  if (dLake <= 200) out.push(`${dLake <= 40 ? 'on' : `${dLake} m from`} a lake shore`)
  else if (dWet <= 100) out.push('beside a wetland')
  const lf = b.landform[i]
  if (lf === LANDFORM.saddle) out.push('a saddle: a travel funnel')
  else if (lf === LANDFORM.ridge) out.push('ridge line')
  else if (lf === LANDFORM.bench) out.push('a bench: bedding ground')
  else if (lf === LANDFORM.valley) out.push('a drainage: scent runs down it at dusk')
  if (b.landFrac[i] / 255 < 0.5) out.push('a neck of land between waters')
  const dRoad = b.distRoad[i] * 20
  if (dRoad <= 60) out.push('on a bush road')
  else if (dRoad < 5000) out.push(`${dRoad < 1000 ? `${dRoad} m` : `${(dRoad / 1000).toFixed(1)} km`} from a road`)
  siteFactor(t, b, h, i, c, out)
  return out
}
