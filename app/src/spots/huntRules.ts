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
import { compass8 } from './conditions'
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
  }
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
    const base = isCover ? browse * 0.3 : browse * 0.45
    const edge = isCover ? 0.35 * edgeFromBrowse(dBrowse) : browse * 0.55 * edgeFromCover(dCover)
    s = add('browse', isCover ? 'conifer cover' : 'browse value', base) + add('edge', isCover ? 'browse within reach' : 'near the conifer edge', edge)
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
      if (dCover <= 500) s += add('edge', 'cover within 500 m', 0.15)
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
    if (dCover <= 300) s += add('edge', 'cover within 300 m', 0.2)
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
  // a front that just passed: the temperature drop is what matters
  if (c.tempDrop24h >= 5 && c.windKmh < 25) factors.push({ label: `cold front through: ${Math.round(c.tempDrop24h)}° colder than yesterday`, mult: 1.15, key: 'front' })
  else if (c.tempDrop24h <= -6) factors.push({ label: 'warm-up: slower than yesterday', mult: 0.9, key: 'front' })

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
  const sp = siteParts(t, b, h, i, c, reasons)
  parts?.push(...sp)
  return sp.reduce((m, p) => m * weigh(p.value, w[p.key]), 1)
}

/** The site's three parts: scent (wind and thermals against the feeding
 *  side), the downwind view, and access. Each 0..1, unweighed. */
export function siteParts(t: HuntTarget, b: HuntBands, h: Habitat, i: number, c: Conditions, reasons?: string[]): Part[] {
  let g: number
  const bear = b.bearBrowse[i]
  const calm = c.windKmh < 5
  const evening = c.toSunsetH <= 1.5 || c.sinceSunriseH < 0.7
  if (!calm && bear !== 255) {
    // expected approach from the browse; wind FROM windDir
    const approach = bear * (360 / 250)
    const a = Math.abs(((c.windDir - approach) % 360 + 540) % 360 - 180)
    if (a <= 30) {
      g = 0.9
      reasons?.push(`straight downwind of the feeding side (${compass8(approach)})`)
    } else if (a <= 120) {
      g = 1.0
      reasons?.push(`crosswind to the feeding side (${compass8(approach)}), wind ${compass8(c.windDir)}`)
    } else if (a <= 150) g = 0.5
    else {
      g = 0.12
      reasons?.push(`your scent blows into the feeding side`)
    }
  } else if (calm) {
    // thermals rule: evening drains downslope, morning rises
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

  // the downwind arc: can you see what circles there?
  let open = 0
  let n = 0
  const down = (c.windDir + 180) % 360
  for (const m of [60, 120, 200, 300]) {
    const j = h.offset(i, down, m)
    if (j < 0) continue
    n++
    if (OPEN_COVER.has(b.cover[j]) || b.cover[j] === COVER.regen) open++
  }
  const openFrac = n ? open / n : 0.5
  const vis = 0.7 + 0.3 * openFrac
  if (openFrac >= 0.75) reasons?.push('open ground downwind: a circling animal shows itself')
  if (c.windShiftDeg > 30 && !calm) g *= 0.85

  // reachable: near a road or a shore, but not on the road
  const dRoad = b.distRoad[i] * 20
  const dLake = b.distLake[i] * 10
  let access = dRoad <= 150 ? 0.85 : dRoad <= 2500 ? 1 : dRoad <= 4000 ? 0.8 : 0.5
  if (dLake <= 120) access = Math.max(access, 0.95) // by boat
  if (t === 'grouse') access = dRoad <= 60 ? 1 : dRoad <= 800 ? 0.9 : 0.6
  const accessLabel = dLake <= 120 && dRoad > 150 ? 'reachable by boat' : dRoad <= 150 ? 'right by a road' : dRoad <= 2500 ? `${dRoad < 1000 ? `${dRoad} m` : `${(dRoad / 1000).toFixed(1)} km`} from a road` : 'a long walk in'
  return [
    { key: 'scent', label: calm ? 'thermals' : 'wind against the feeding side', value: g, kind: 'mult' },
    { key: 'visibility', label: openFrac >= 0.75 ? 'open downwind' : openFrac >= 0.4 ? 'partly open downwind' : 'thick downwind', value: vis, kind: 'mult' },
    { key: 'access', label: accessLabel, value: access, kind: 'mult' },
  ]
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
  const dCover = b.distCover[i] * 10
  const dBrowse = b.distBrowse[i] * 10
  if (cover === COVER.coniferDense || cover === COVER.treedWet) {
    if (dBrowse <= 250) out.push(`cover ${dBrowse} m from browse`)
  } else if (dCover <= 200) out.push(`${dCover <= 30 ? 'right on' : `${dCover} m from`} the conifer edge`)
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
