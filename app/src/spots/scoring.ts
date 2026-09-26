/**
 * Runs the rules over the whole grid for a target at the planning time:
 * a score per cell (the heat map), the best few separate spots with their
 * reasons, and the day's verdict. Pure: no map, no store.
 */
import { SPOTS_RADIUS_M } from '../config'
import { habitat, type Habitat } from './habitatGrid'
import type { Conditions } from './conditions'
import { activityVerdict, describeCell, habitatScore, huntBands, siteFactor, type HuntBands } from './huntRules'
import { cellScore, describeFishCell, fishBands, fishContext, fishVerdict, seasonOpen, type FishBands } from './fishRules'
import { isFish, type Spot, type Target, type Verdict } from './types'
import { DEFAULT_WEIGHTS, weigh, type Part, type PointCase, type Weights } from './weights'

export interface ScoreResult {
  target: Target
  timeMs: number
  scores: Float32Array
  spots: Spot[]
  verdict: Verdict
  /** the lake the verdict is about (fishing) */
  lakeId?: number
}

let huntCache: { h: Habitat; b: HuntBands } | null = null
let fishCache: { h: Habitat; b: FishBands } | null = null

function bearingBetween(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const dx = (lon2 - lon1) * Math.cos((lat1 * Math.PI) / 180)
  const dy = lat2 - lat1
  return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360
}
function distM(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const dx = (lon2 - lon1) * 111_320 * Math.cos((lat1 * Math.PI) / 180)
  const dy = (lat2 - lat1) * 110_574
  return Math.hypot(dx, dy)
}
const PTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
export function fromHome(lon: number, lat: number, home: { lon: number; lat: number; name: string }): string {
  const d = distM(home.lon, home.lat, lon, lat)
  const b = PTS[Math.round(bearingBetween(home.lon, home.lat, lon, lat) / 45) % 8]
  return `${d < 950 ? `${Math.round(d / 50) * 50} m` : `${(d / 1000).toFixed(1)} km`} ${b} of ${home.name}`
}

/** Local maxima at least `sepM` apart, best first, within SPOTS_RADIUS_M
 *  of `near`: the immediate area around camp, the pin or the hunter, not
 *  the far corners of the grid. */
function pickPeaks(h: Habitat, scores: Float32Array, n: number, sepM: number, minScore: number, near: { lon: number; lat: number }): number[] {
  const rad = Math.max(1, Math.round(sepM / 2 / h.cellM[0]))
  const cand: number[] = []
  const { cols, rows } = h
  const ni = h.index(near.lon, near.lat)
  // a subject off the grid (a pin outside the bake) searches around the grid's middle
  const [nr, nc] = ni >= 0 ? h.rc(ni) : [rows >> 1, cols >> 1]
  const rx = SPOTS_RADIUS_M / h.cellM[0]
  const ry = SPOTS_RADIUS_M / h.cellM[1]
  const r0 = Math.max(rad, Math.floor(nr - ry))
  const r1 = Math.min(rows - rad, Math.ceil(nr + ry) + 1)
  const c0 = Math.max(rad, Math.floor(nc - rx))
  const c1 = Math.min(cols - rad, Math.ceil(nc + rx) + 1)
  for (let r = r0; r < r1; r += 2) {
    for (let c = c0; c < c1; c += 2) {
      const i = r * cols + c
      const s = scores[i]
      if (s < minScore) continue
      if (((r - nr) / ry) ** 2 + ((c - nc) / rx) ** 2 > 1) continue
      let best = true
      for (let dr = -rad; dr <= rad && best; dr += 2)
        for (let dc = -rad; dc <= rad; dc += 2) {
          if (scores[(r + dr) * cols + c + dc] > s) {
            best = false
            break
          }
        }
      if (best) cand.push(i)
    }
  }
  cand.sort((a, b) => scores[b] - scores[a])
  const out: number[] = []
  const sepCells2 = (sepM / h.cellM[0]) ** 2
  for (const i of cand) {
    const [r, c] = h.rc(i)
    let ok = true
    for (const j of out) {
      const [rj, cj] = h.rc(j)
      if ((r - rj) ** 2 + (c - cj) ** 2 < sepCells2) {
        ok = false
        break
      }
    }
    if (ok) out.push(i)
    if (out.length >= n) break
  }
  return out
}

export function scoreHunt(target: Exclude<Target, 'walleye' | 'pike' | 'laketrout'>, c: Conditions, home: { lon: number; lat: number; name: string }, w: Weights = DEFAULT_WEIGHTS): ScoreResult | null {
  const h = habitat()
  if (!h) return null
  if (!huntCache || huntCache.h !== h) huntCache = { h, b: huntBands(h) }
  const b = huntCache.b
  const verdict = activityVerdict(target, c, w)
  const warm = c.tempC > 14 && c.sinceSunriseH > 2 && c.toSunsetH > 1.5
  const lateFall = c.dayOfYear >= 288
  const scores = new Float32Array(h.size)
  for (let i = 0; i < h.size; i++) {
    const hs = habitatScore(target, b, i, warm, lateFall, w)
    if (hs < 0.2) continue
    scores[i] = hs * siteFactor(target, b, h, i, c, undefined, w)
  }
  const peaks = pickPeaks(h, scores, 6, 600, 0.35, home)
  const spots: Spot[] = peaks.map((i) => {
    const [lon, lat] = h.center(i)
    return { cell: i, lon, lat, score: scores[i], title: fromHome(lon, lat, home), reasons: describeCell(target, b, h, i, c) }
  })
  return { target, timeMs: c.timeMs, scores, spots, verdict }
}

/** Fishing: the lake nearest the subject point (camp, pin or fix) is the one the verdict speaks to;
 *  the heat map covers every lake that holds the species. */
export function scoreFish(target: 'walleye' | 'pike' | 'laketrout', c: Conditions, home: { lon: number; lat: number; name: string }, w: Weights = DEFAULT_WEIGHTS): ScoreResult | null {
  const h = habitat()
  if (!h) return null
  if (!fishCache || fishCache.h !== h) fishCache = { h, b: fishBands(h) }
  const b = fishCache.b
  // the lake of interest: the nearest lake with the species within 3 km of the subject, else the largest
  let lakeId = 0
  let bestD = Infinity
  const hi = h.index(home.lon, home.lat)
  if (hi >= 0) {
    // scan a window around the subject for water cells
    const [r0, c0] = h.rc(hi)
    const rad = Math.round(3000 / h.cellM[0])
    for (let r = Math.max(0, r0 - rad); r < Math.min(h.rows, r0 + rad); r += 3)
      for (let cc = Math.max(0, c0 - rad); cc < Math.min(h.cols, c0 + rad); cc += 3) {
        const i = r * h.cols + cc
        const id = b.lakeId[i]
        if (!id) continue
        const lk = h.lake(id)
        if (!lk || (lk.species.length && !lk.species.includes(target))) continue
        const d = (r - r0) ** 2 + (cc - c0) ** 2
        if (d < bestD) {
          bestD = d
          lakeId = id
        }
      }
  }
  if (!lakeId) {
    const with_ = h.lakes.filter((l) => l.species.includes(target)).sort((a, b2) => b2.areaHa - a.areaHa)
    lakeId = with_[0]?.id ?? 0
  }
  const lake = h.lake(lakeId) ?? null
  const verdict = fishVerdict(target, c, lake, w)
  const scores = new Float32Array(h.size)
  const open = seasonOpen(target, c).open
  if (open) {
    const ctx = fishContext(c)
    const lakeOk = new Map<number, boolean>()
    for (let i = 0; i < h.size; i++) {
      const id = b.lakeId[i]
      if (!id) continue
      let ok = lakeOk.get(id)
      if (ok === undefined) {
        const lk = h.lake(id)
        // a lake with no survey only counts when the species is plausible: walleye and pike anywhere, trout only where recorded
        ok = !!lk && (lk.species.includes(target) || (lk.species.length === 0 && target !== 'laketrout' && lk.areaHa >= 15))
        lakeOk.set(id, ok)
      }
      if (!ok) continue
      const lk = h.lake(id)!
      scores[i] = cellScore(target, b, h, i, lk, c, ctx)
    }
  }
  const peaks = pickPeaks(h, scores, 6, 400, 0.4, home)
  const spots: Spot[] = peaks.map((i) => {
    const [lon, lat] = h.center(i)
    const id = b.lakeId[i]
    const lk = h.lake(id)!
    return { cell: i, lon, lat, score: scores[i], title: `${lk.name ?? 'Unnamed lake'} · ${fromHome(lon, lat, home)}`, reasons: describeFishCell(target, b, h, i, lk, c), lakeId: id }
  })
  return { target, timeMs: c.timeMs, scores, spots, verdict, lakeId }
}

export function scoreTarget(target: Target, c: Conditions, home: { lon: number; lat: number; name: string }, w: Weights = DEFAULT_WEIGHTS): ScoreResult | null {
  return isFish(target) ? scoreFish(target, c, home, w) : scoreHunt(target, c, home, w)
}

/** One place, in words: for the stand check on a saved pin. */
export function explainPoint(target: Target, lon: number, lat: number, c: Conditions, w: Weights = DEFAULT_WEIGHTS): { score: number; reasons: string[] } | null {
  const pc = pointCase(target, lon, lat, c, w)
  return pc ? { score: pc.score, reasons: pc.reasons } : null
}

/** The whole case for one point: the habitat's parts, the site's parts,
 *  the day's factors, each with its raw value, so the breakdown view can
 *  show what moved the score and what the weights did to it. */
export function pointCase(target: Target, lon: number, lat: number, c: Conditions, w: Weights = DEFAULT_WEIGHTS): PointCase | null {
  const h = habitat()
  if (!h) return null
  const i = h.index(lon, lat)
  if (i < 0) return null
  if (isFish(target)) {
    if (!fishCache || fishCache.h !== h) fishCache = { h, b: fishBands(h) }
    const b = fishCache.b
    const id = b.lakeId[i]
    const lk = id ? h.lake(id) : undefined
    const v = fishVerdict(target, c, lk ?? null, w)
    const day: Part[] = v.factors.map((f) => ({ key: f.key ?? 'light', label: f.label, value: f.mult, kind: 'mult', note: f.note }))
    if (!lk) return { score: 0, reasons: ['not on a lake'], habitat: [], site: [], day, habitatScore: 0, siteMult: 1, dayMult: v.activity }
    const score = cellScore(target, b, h, i, lk, c, fishContext(c))
    return { score, reasons: describeFishCell(target, b, h, i, lk, c), habitat: [], site: [], day, habitatScore: score, siteMult: 1, dayMult: v.activity }
  }
  if (!huntCache || huntCache.h !== h) huntCache = { h, b: huntBands(h) }
  const b = huntCache.b
  const warm = c.tempC > 14 && c.sinceSunriseH > 2 && c.toSunsetH > 1.5
  const habitatParts: Part[] = []
  const siteParts: Part[] = []
  const hs = habitatScore(target, b, i, warm, c.dayOfYear >= 288, w, habitatParts)
  const sm = siteFactor(target, b, h, i, c, undefined, w, siteParts)
  const v = activityVerdict(target, c, w)
  const day: Part[] = v.factors.map((f) => ({ key: f.key ?? 'light', label: f.label, value: f.mult, kind: 'mult', note: f.note }))
  return {
    score: hs * sm,
    reasons: describeCell(target, b, h, i, c),
    habitat: habitatParts,
    site: siteParts,
    day,
    habitatScore: hs,
    siteMult: sm,
    dayMult: v.activity,
  }
}

/** A weighed multiplier, for the breakdown's arithmetic. */
export function weighed(p: Part, w: Weights): number {
  return p.kind === 'mult' ? weigh(p.value, w[p.key]) : p.value * w[p.key]
}
