import { DEFAULT_WEIGHTS, weigh, type Weights } from './weights'
/**
 * Fishing rules: docs/HUNT-FISH-SCIENCE.md turned into code.
 *
 *  - lakePeriod: where in the year the lake is, from the estimated surface
 *    temperature and the date (spawn, post-spawn, summer, turnover, ice…)
 *  - depthWindow: the depth band a species uses in that period, shifted by
 *    the light (dawn, dusk, overcast, chop bring walleye up)
 *  - cellScore: how a water cell fits: estimated depth, the break under
 *    it, points and bays, inlets, and which shore the wind is working
 *  - fishVerdict: the day's odds and the boat call, the same for a lake
 */
import { COVER, type Habitat, type LakeFacts } from './habitatGrid'
import type { Conditions } from './conditions'
import { compass8 } from './conditions'
import type { Factor, FishTarget, Verdict } from './types'

export type Period = 'ice' | 'spawn' | 'postspawn' | 'earlysummer' | 'summer' | 'latesummer' | 'turnover' | 'latefall'

export const PERIOD_NAMES: Record<Period, string> = {
  ice: 'ice',
  spawn: 'ice-out and spawn',
  postspawn: 'post-spawn',
  earlysummer: 'early summer',
  summer: 'summer, stratified',
  latesummer: 'late summer',
  turnover: 'fall turnover',
  latefall: 'late fall',
}

export interface FishBands {
  cover: Uint8Array
  lakeId: Uint16Array
  depth: Uint8Array
  distShore: Uint8Array
  landFrac: Uint8Array
  distInlet: Uint8Array
  fetch: Record<string, Uint8Array>
}

export function fishBands(h: Habitat): FishBands {
  const fetch: Record<string, Uint8Array> = {}
  for (const d of ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']) fetch[d] = h.raw(`fetch${d}`) as Uint8Array
  return {
    cover: h.raw('cover') as Uint8Array,
    lakeId: h.raw('lakeId') as Uint16Array,
    depth: h.raw('depthEst') as Uint8Array,
    distShore: h.raw('distShore') as Uint8Array,
    landFrac: h.raw('landFrac') as Uint8Array,
    distInlet: h.raw('distInlet') as Uint8Array,
    fetch,
  }
}

export function lakePeriod(c: Conditions): Period {
  const d = c.dayOfYear
  const t = c.waterTempC
  if (d >= 320 || d < 125) return 'ice' // mid Nov – early May
  if (d < 140 || (t < 10 && d < 160)) return 'spawn'
  if (d < 200) {
    if (t < 16) return 'postspawn'
    if (t < 19) return 'earlysummer'
    return 'summer'
  }
  if (d < 235) return t >= 18 ? 'summer' : 'latesummer'
  if (d < 265) return t >= 14 ? 'latesummer' : 'turnover'
  if (d < 300) return t >= 13 ? 'latesummer' : t >= 9.5 ? 'turnover' : 'latefall'
  return 'latefall'
}

/** Hanna 1990: thermocline depth from the longest fetch; stained lakes shallower. */
export function thermoclineM(lake: LakeFacts): number {
  const f = Math.max(300, lake.fetchMaxM)
  let z = Math.pow(10, 0.336 * Math.log10(f) - 0.245)
  if (lake.secchi != null && lake.secchi < 2.5) z -= 1.5
  return Math.max(3, z)
}

/** Is the light low enough to bring walleye up: dawn, dusk, night, heavy cloud with chop. */
export function lowLight(c: Conditions): { low: boolean; why: string } {
  if (c.sinceSunriseH < 1 && c.sinceSunriseH > -1.5) return { low: true, why: 'dawn' }
  if (c.toSunsetH < 1.5 && c.toSunsetH > -1.0) return { low: true, why: 'dusk' }
  if (!c.isDay) return { low: true, why: 'dark' }
  if (c.cloudPct >= 70 && c.windKmh >= 10) return { low: true, why: 'overcast with chop' }
  return { low: false, why: c.cloudPct >= 70 ? 'overcast' : c.windKmh >= 12 ? 'bright with chop' : 'bright and calm' }
}

/** Depth band (m) a species works in this period and light. */
export function depthWindow(t: FishTarget, p: Period, low: boolean, lake: LakeFacts, postFront: boolean): [number, number] {
  const zt = thermoclineM(lake)
  let w: [number, number]
  if (t === 'walleye') {
    switch (p) {
      case 'spawn':
        w = [1, 3]
        break
      case 'postspawn':
        w = low ? [1.5, 4] : [3, 6]
        break
      case 'earlysummer':
        w = low ? [1, 3] : [3, 7]
        break
      case 'summer':
        w = low ? [1, 4] : [Math.max(4, zt - 3), zt + 1]
        break
      case 'latesummer':
        w = low ? [2, 5] : [5, 9]
        break
      case 'turnover':
        w = low ? [2, 6] : [6, 12]
        break
      case 'latefall':
        w = low ? [2, 5] : [8, 15]
        break
      default:
        w = low ? [3, 6] : [8, 15]
    }
  } else if (t === 'pike') {
    switch (p) {
      case 'spawn':
        w = [0.3, 1.5]
        break
      case 'postspawn':
        w = [1, 3]
        break
      case 'earlysummer':
        w = [1, 4]
        break
      case 'summer':
        w = [3, Math.max(6, zt)]
        break
      case 'latesummer':
      case 'turnover':
        w = [3, 6]
        break
      case 'latefall':
        w = [3, 6]
        break
      default:
        w = [1, 4]
    }
  } else {
    // lake trout
    switch (p) {
      case 'spawn':
      case 'postspawn':
        w = [1, 6]
        break
      case 'earlysummer':
        w = [Math.max(8, zt), zt + 10]
        break
      case 'summer':
        w = [zt + 2, zt + 14]
        break
      case 'latesummer':
        w = [zt - 1, zt + 8]
        break
      default:
        w = [2, 8]
    }
  }
  if (postFront) w = [w[0] + 1, w[1] + 2]
  return w
}

const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']

/** Fetch (m) at a water cell for the wind's FROM direction. */
export function fetchAt(b: FishBands, h: Habitat, i: number, windDir: number): number {
  const k = Math.round((((windDir % 360) + 360) % 360) / 45) % 8
  const d = DIRS[k]
  const cells = b.fetch[d][i]
  const diag = k % 2 === 1
  const cell = diag ? Math.hypot(h.cellM[0], h.cellM[1]) : k === 2 || k === 6 ? h.cellM[0] : h.cellM[1]
  return cells * cell
}

/** Local depth gradient (m per 100 m) from the estimated depth around a cell. */
function breakAt(b: FishBands, h: Habitat, i: number): number {
  const d = b.depth
  if (d[i] === 255) return 0
  const [r, c] = h.rc(i)
  const get = (rr: number, cc: number) => {
    if (rr < 0 || cc < 0 || rr >= h.rows || cc >= h.cols) return d[i]
    const v = d[rr * h.cols + cc]
    return v === 255 ? 0 : v
  }
  const dx = (get(r, c + 1) - get(r, c - 1)) * 0.25
  const dy = (get(r + 1, c) - get(r - 1, c)) * 0.25
  return (Math.hypot(dx / (2 * h.cellM[0]), dy / (2 * h.cellM[1])) * 100)
}

export interface FishContext {
  period: Period
  low: boolean
  postFront: boolean
  windward: boolean // wind strong enough and persistent enough to set fish on the windward shore
  coldInactive: boolean
}

export function fishContext(c: Conditions): FishContext {
  const period = lakePeriod(c)
  const postFront = c.tempDrop24h >= 6 && c.cloudPct < 30 && c.pressureTrend6h > 1
  return {
    period,
    low: lowLight(c).low,
    postFront,
    windward: c.windKmh >= 10 && c.windKmh <= 30 && c.windPersistH >= 2,
    coldInactive: c.waterTempC < 9 || period === 'ice',
  }
}

/** 0..1 for a water cell in a lake that holds the species. */
export function cellScore(t: FishTarget, b: FishBands, h: Habitat, i: number, lake: LakeFacts, c: Conditions, ctx: FishContext, reasons?: string[]): number {
  const dq = b.depth[i]
  const dist = b.distShore[i] * 10
  const landFrac = b.landFrac[i] / 255
  const inlet = b.distInlet[i] * 10
  const [lo, hi] = depthWindow(t, ctx.period, ctx.low, lake, ctx.postFront)

  // depth fit: 1 inside the band, falling off outside; unknown depth → shore distance stands in
  let fit: number
  let depth: number | null = null
  if (dq !== 255) {
    depth = dq * 0.25
    if (depth >= lo && depth <= hi) fit = 1
    else {
      const off = depth < lo ? lo - depth : depth - hi
      fit = Math.max(0, 1 - off / Math.max(2, (hi - lo) * 0.8))
    }
  } else {
    // no survey: shallow bands = near shore
    const wantNear = hi <= 4
    fit = wantNear ? (dist <= 120 ? 1 : dist <= 250 ? 0.6 : 0.3) : dist <= 60 ? 0.3 : dist <= 300 ? 0.8 : 1
  }
  if (fit <= 0) return 0

  // structure: breaks, points, bays, inlets. A plain stretch of shoreline
  // at the right depth stays under the heat map's floor; structure lifts it.
  let structure = 0.12
  const brk = breakAt(b, h, i)
  if (brk >= 4) {
    structure += 0.35
    reasons?.push(`a break (${brk.toFixed(0)} m per 100 m)`)
  } else if (brk >= 2) structure += 0.2
  const nearShore = dist <= 150
  if (nearShore && landFrac < 0.4) {
    structure += 0.3
    reasons?.push('off a point')
  } else if (nearShore && landFrac > 0.62) {
    // bay or narrows
    if (t === 'pike' || ctx.period === 'postspawn' || ctx.period === 'spawn') {
      structure += 0.3
      reasons?.push(t === 'pike' ? 'a weedy bay' : 'a warming bay')
    } else if (landFrac > 0.75) {
      structure += 0.15
      reasons?.push('a narrows')
    }
  }
  if (inlet <= 150 && (ctx.period === 'spawn' || ctx.period === 'postspawn' || ctx.period === 'latefall' || t === 'pike')) {
    structure += 0.3
    reasons?.push(`${inlet <= 40 ? 'at' : `${inlet} m from`} an inlet or outlet`)
  } else if (inlet <= 150) structure += 0.1
  if (!nearShore && dist >= 250 && depth != null && depth <= hi && depth >= lo && brk >= 2) {
    structure += 0.25 // a hump or saddle in open water
    reasons?.push('mid-lake structure')
  }
  structure = Math.min(1, structure)

  // wind: the working shore
  let wind = 1
  const f = fetchAt(b, h, i, c.windDir)
  if (t !== 'pike' && ctx.windward && nearShore) {
    if (f >= 400) {
      wind = ctx.coldInactive ? 0.9 : 1.3
      reasons?.push(`windward shore, ${(f / 1000).toFixed(1)} km of fetch, wind ${compass8(c.windDir)}${c.windPersistH >= 6 ? ` for ${c.windPersistH} h` : ''}`)
    } else if (f < 100) {
      wind = ctx.coldInactive ? 1.1 : 0.75
      if (ctx.coldInactive) reasons?.push('lee shore: cold, quiet water')
    }
  } else if (t === 'pike' && ctx.windward && nearShore && f >= 400 && landFrac > 0.55) {
    wind = 1.15
    reasons?.push('wind pushing into the bay')
  }
  if (c.windKmh > 24 && f >= 1500) {
    wind *= 0.5 // you cannot hold a boat there
    reasons?.push('too rough to hold a boat here')
  }

  return Math.min(1, fit * (0.35 + 0.65 * structure) * wind)
}

/** Whether the season is open for a target on a date (FMZ 7, verify yearly). */
export function seasonOpen(t: FishTarget, c: Conditions): { open: boolean; note: string } {
  const d = new Date(c.timeMs)
  const y = d.getFullYear()
  const m = d.getMonth()
  const day = d.getDate()
  if (t === 'walleye') {
    // closed Apr 15 to the third Saturday in May
    const may1 = new Date(y, 4, 1)
    const thirdSat = 1 + ((6 - may1.getDay() + 7) % 7) + 14
    const closed = (m === 3 && day >= 15) || (m === 4 && day < thirdSat)
    return { open: !closed, note: closed ? `walleye closed until May ${thirdSat} (FMZ 7)` : 'walleye open · S-4, C-2, one over 46 cm' }
  }
  if (t === 'laketrout') {
    const open = m <= 8
    return { open, note: open ? 'lake trout open to Sept 30 · S-2, C-1' : 'lake trout closed Oct 1 – Dec 31 (FMZ 7)' }
  }
  return { open: true, note: 'pike open all year · S-6, C-2' }
}

export function fishVerdict(t: FishTarget, c: Conditions, lake: LakeFacts | null, w: Weights = DEFAULT_WEIGHTS): Verdict {
  const factors: Factor[] = []
  const notes: string[] = []
  const warnings: string[] = []
  const ctx = fishContext(c)
  const season = seasonOpen(t, c)
  if (!season.open) warnings.push(season.note)
  else notes.push(season.note)
  if (lake && lake.species.length && !lake.species.includes(t)) warnings.push(`${lake.name ?? 'This lake'}: no ${t === 'laketrout' ? 'lake trout' : t} in the MNR survey`)

  const light = lowLight(c)
  if (t === 'walleye') {
    const lm = light.why === 'dusk' ? 1.3 : light.why === 'dawn' ? 1.15 : light.why === 'dark' ? 1.0 : light.low ? 1.05 : light.why === 'overcast' ? 0.9 : light.why === 'bright with chop' ? 0.85 : 0.6
    factors.push({ label: `${light.why}${light.low ? ': walleye up and feeding' : light.why === 'bright and calm' ? ': walleye deep and dour' : ''}`, mult: lm, key: 'light' })
  } else if (t === 'pike') {
    factors.push({ label: light.low ? `${light.why}: pike active` : `${light.why}: pike on the weed edge`, mult: light.low ? 1.1 : 0.95, key: 'light' })
  } else {
    factors.push({ label: light.why, mult: light.low ? 1.15 : light.why === 'overcast' ? 1.05 : 0.85, key: 'light' })
  }

  // water temperature against the species' comfort
  const wt = c.waterTempC
  let tm = 1
  let tl = `water about ${wt}°`
  if (t === 'walleye') tm = wt >= 13 && wt <= 21 ? 1 : wt > 21 ? 0.8 : wt >= 8 ? 0.85 : 0.7
  if (t === 'pike') tm = wt >= 10 && wt <= 18 ? 1 : wt > 21 ? 0.7 : 0.85
  if (t === 'laketrout') tm = wt <= 12 ? 1.1 : wt <= 15 ? 0.9 : 0.6
  if (t === 'laketrout' && wt <= 12) tl += ': trout on the shallow rock'
  else if (t === 'pike' && wt > 21) tl += ': big pike deep or suspended'
  factors.push({ label: tl, mult: tm, note: c.waterTempNote, key: 'water' })

  // wind
  const ws = c.windKmh
  if (ws > 30 || c.gustKmh > 40) {
    warnings.push(`Stay in: ${Math.round(ws)} km/h gusting ${Math.round(c.gustKmh)}`)
    factors.push({ label: 'too rough for a small boat', mult: 0.3, key: 'wind' })
  } else if (ws > 24) {
    warnings.push(`Rough: ${Math.round(ws)} km/h · lee shores only`)
    factors.push({ label: 'strong wind: lee shores, short runs', mult: 0.7, key: 'wind' })
  } else if (t === 'walleye' && ctx.windward) factors.push({ label: `walleye chop from the ${compass8(c.windDir)}${c.windPersistH >= 6 ? `, holding ${c.windPersistH} h` : ''}`, mult: 1.2, note: `${Math.round(ws)} km/h`, key: 'wind' })
  else if (t === 'walleye' && ws < 6 && !light.low) factors.push({ label: 'flat calm: fish the deep edge', mult: 0.85, key: 'wind' })
  else factors.push({ label: `wind ${Math.round(ws)} km/h ${compass8(c.windDir)}`, mult: 1, key: 'wind' })

  if (ctx.postFront) factors.push({ label: 'post-frontal: clear, colder, rising glass: fish deeper and tighter for a day or two', mult: 0.75, key: 'front' })
  else if (c.pressureTrend6h <= -2) factors.push({ label: 'falling glass ahead of weather: feed on', mult: 1.1, key: 'front' })
  if (c.precipMmH > 3) factors.push({ label: 'heavy rain', mult: 0.8, key: 'rain' })

  if (t === 'walleye' && c.moonIllum >= 0.85) factors.push({ label: 'near full moon: a little more night feeding', mult: 1.05, key: 'light' })

  if (ctx.period === 'turnover') notes.push('Turnover: a tough couple of days when the lake mixes, then fish spread through the column. Work sharp breaks next to the deepest water.')
  const [lo, hi] = lake ? depthWindow(t, ctx.period, ctx.low, lake, ctx.postFront) : [0, 0]
  if (lake) {
    notes.push(`${PERIOD_NAMES[ctx.period]} · try ${lo.toFixed(0)}–${hi.toFixed(0)} m${lake.maxDepth ? ` (${lake.name ?? 'lake'} max ${lake.maxDepth.toFixed(1)} m${lake.meanDepth ? `, mean ${lake.meanDepth.toFixed(1)} m` : ''})` : ''}`)
    if (ctx.period === 'summer' || ctx.period === 'latesummer') notes.push(`Thermocline about ${thermoclineM(lake).toFixed(0)} m from the ${(lake.fetchMaxM / 1000).toFixed(1)} km fetch${lake.secchi != null && lake.secchi < 2.5 ? ' (stained water, shallower)' : ''}.`)
    if (lake.secchi != null) notes.push(lake.secchi < 2.5 ? `Secchi ${lake.secchi} m: stained, walleye feed in daylight here.` : `Secchi ${lake.secchi} m: clearer, low light matters more.`)
    if (!lake.depthModel) notes.push('No depth survey for this lake: depths are guessed from the shoreline.')
    else notes.push('Depths are a shape estimate from the shoreline, calibrated to the MNR survey mean and maximum. Sound them.')
  }
  if (!c.hrdps) notes.push('This hour is beyond the HRDPS horizon: blended forecast.')

  const activity = season.open || w.season <= 0 ? factors.reduce((a, f) => a * (f.key ? weigh(f.mult, w[f.key]) : f.mult), 1) : 0
  const head = !season.open ? 'Closed' : activity >= 1.1 ? 'Prime' : activity >= 0.85 ? 'Good' : activity >= 0.6 ? 'Fair' : activity >= 0.4 ? 'Slow' : 'Poor'
  return { activity, headline: `${head}${season.open ? ` for ${t === 'laketrout' ? 'lake trout' : t}` : ''}`, factors, warnings, notes }
}

export function describeFishCell(t: FishTarget, b: FishBands, h: Habitat, i: number, lake: LakeFacts, c: Conditions): string[] {
  const out: string[] = []
  const dq = b.depth[i]
  if (dq !== 255) out.push(`est. ${(dq * 0.25).toFixed(1)} m`)
  else out.push(`${b.distShore[i] * 10} m from shore, depth unknown`)
  const ctx = fishContext(c)
  cellScore(t, b, h, i, lake, c, ctx, out)
  const [lo, hi] = depthWindow(t, ctx.period, ctx.low, lake, ctx.postFront)
  out.push(`${PERIOD_NAMES[ctx.period]}: ${lo.toFixed(0)}–${hi.toFixed(0)} m band`)
  return out
}

export { COVER }
