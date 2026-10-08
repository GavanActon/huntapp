/**
 * Runs the rules over the whole grid for a target at the planning time:
 * a score per cell (the heat map), the best few separate spots with their
 * reasons, and the day's verdict. Pure: no map, no store.
 */
import { CORE, SPOTS_RADIUS_M } from '../config'
import { habitat, type Habitat } from './habitatGrid'
import type { Conditions } from './conditions'
import { activityVerdict, describeCell, habitatScore, huntBands, siteFactor, viewM, type HuntBands } from './huntRules'
import { cellScore, describeFishCell, fishBands, fishContext, fishVerdict, seasonOpen, type FishBands } from './fishRules'
import { isFish, type Spot, type Target, type Verdict } from './types'
import { DEFAULT_WEIGHTS, weigh, type Part, type PointCase, type Weights } from './weights'
import { logBoostGrid, logNote } from '../log/huntLog'
import type { DayPlan, WindowScore } from './dayPlan'

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

type HuntTarget = Exclude<Target, 'walleye' | 'pike' | 'laketrout'>

/**
 * The cells a hunt pass scores, rows r0..r1 and columns c0..c1 (ends
 * exclusive), as [r0, r1, c0, c1]. Three things read the scores:
 * - the heat map, out to a third past the radius round the subject plus
 *   the smooth's margin (spotsLayer paint);
 * - the hunt log's snapshot, which ranks within the radius round its own
 *   point;
 * - the hunt routes, over the core the going grid covers.
 * So the window is the subject's round, plus the core, with a few cells to
 * spare. The rest of the region stays 0: a quarter to a third of the cells.
 */
export function scoreWindow(h: Habitat, home: { lon: number; lat: number }): [number, number, number, number] {
  const ni = h.index(home.lon, home.lat)
  const [nr, nc] = ni >= 0 ? h.rc(ni) : [h.rows >> 1, h.cols >> 1]
  const rx = SPOTS_RADIUS_M / h.cellM[0]
  const ry = SPOTS_RADIUS_M / h.cellM[1]
  const M = 4 // paint's smooth pads 2; two more to spare
  const kr0 = Math.floor((h.north - CORE.north) / h.dLat) - 2
  const kr1 = Math.ceil((h.north - CORE.south) / h.dLat) + 2
  const kc0 = Math.floor((CORE.west - h.west) / h.dLon) - 2
  const kc1 = Math.ceil((CORE.east - h.west) / h.dLon) + 2
  return [
    Math.max(0, Math.min(Math.floor(nr - 1.34 * ry) - M, kr0)),
    Math.min(h.rows, Math.max(Math.ceil(nr + 1.34 * ry) + M + 1, kr1)),
    Math.max(0, Math.min(Math.floor(nc - 1.34 * rx) - M, kc0)),
    Math.min(h.cols, Math.max(Math.ceil(nc + 1.34 * rx) + M + 1, kc1)),
  ]
}

/** A hunt pass under way: scoreHunt in three steps (huntPass, huntRows,
 *  huntResult), so the map can run it a few rows at a time and paint a
 *  rough copy first (spotsLayer). */
export interface HuntPass {
  target: HuntTarget
  c: Conditions
  home: { lon: number; lat: number; name: string }
  w: Weights
  h: Habitat
  b: HuntBands
  warm: boolean
  lateFall: boolean
  log: Float32Array | null
  scores: Float32Array
  /** scoreWindow's rows and columns */
  win: [number, number, number, number]
}

/** Build the hunt bands' tables for the loaded grid if they are not built
 *  yet, so the first pass can give the browser a turn between them and its
 *  rows. True when there was work to do. */
export function warmHuntBands(): boolean {
  const h = habitat()
  if (!h || huntCache?.h === h) return false
  huntCache = { h, b: huntBands(h) }
  return true
}

export function huntPass(target: HuntTarget, c: Conditions, home: { lon: number; lat: number; name: string }, w: Weights = DEFAULT_WEIGHTS): HuntPass | null {
  const h = habitat()
  if (!h) return null
  if (!huntCache || huntCache.h !== h) huntCache = { h, b: huntBands(h) }
  return {
    target,
    c,
    home,
    w,
    h,
    b: huntCache.b,
    warm: c.tempC > 14 && c.sinceSunriseH > 2 && c.toSunsetH > 1.5,
    lateFall: c.dayOfYear >= 288,
    // the hunter's own log: fresh sign pulls, blank sits push
    log: w.log > 0 ? logBoostGrid(h, target, c.timeMs) : null,
    scores: new Float32Array(h.size),
    win: scoreWindow(h, home),
  }
}

/** Scores rows r0..r1 of the pass's window. With step 2, only every other
 *  cell across and down is scored, and each fills its 2×2 block: the rough
 *  copy the heat map paints first, for a quarter of the work. */
export function huntRows(p: HuntPass, r0: number, r1: number, step = 1): void {
  const { target, b, h, c, w, warm, lateFall, log, scores } = p
  const [, , c0, c1] = p.win
  const cols = h.cols
  for (let r = r0; r < r1; r += step)
    for (let cc = c0; cc < c1; cc += step) {
      const i = r * cols + cc
      const hs = habitatScore(target, b, i, warm, lateFall, w)
      if (hs < 0.2) continue
      const s = hs * siteFactor(target, b, h, i, c, undefined, w) * (log ? weigh(log[i], w.log) : 1)
      scores[i] = s
      if (step > 1) {
        for (let dr = 0; dr < step && r + dr < r1; dr++)
          for (let dc = 0; dc < step && cc + dc < c1; dc++) scores[i + dr * cols + dc] = s
      }
    }
}

/** The pass's spots and the day's verdict, once every row is scored. */
export function huntResult(p: HuntPass): ScoreResult {
  const { target, b, h, c, w, home, scores } = p
  const peaks = pickPeaks(h, scores, 6, 600, 0.35, home)
  const spots: Spot[] = peaks.map((i) => {
    const [lon, lat] = h.center(i)
    return { cell: i, lon, lat, score: scores[i], title: fromHome(lon, lat, home), reasons: describeCell(target, b, h, i, c) }
  })
  return { target, timeMs: c.timeMs, scores, spots, verdict: activityVerdict(target, c, w) }
}

export function scoreHunt(target: HuntTarget, c: Conditions, home: { lon: number; lat: number; name: string }, w: Weights = DEFAULT_WEIGHTS): ScoreResult | null {
  const p = huntPass(target, c, home, w)
  if (!p) return null
  huntRows(p, p.win[0], p.win[1])
  return huntResult(p)
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
  let sm = siteFactor(target, b, h, i, c, undefined, w, siteParts)
  const reasons = describeCell(target, b, h, i, c)
  const log = w.log > 0 ? logBoostGrid(h, target, c.timeMs) : null
  if (log && log[i] !== 1) {
    const note = logNote(target, lon, lat, c.timeMs)
    siteParts.push({ key: 'log', label: note ? `near ${note}` : 'your log', value: log[i], kind: 'mult' })
    sm *= weigh(log[i], w.log)
    if (note) reasons.unshift(`${log[i] > 1 ? 'Near' : 'Close to'} ${note}`)
  }
  const v = activityVerdict(target, c, w)
  const day: Part[] = v.factors.map((f) => ({ key: f.key ?? 'light', label: f.label, value: f.mult, kind: 'mult', note: f.note }))
  return {
    score: hs * sm,
    reasons,
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

/** How far you see from a point on bearings 0, 45, …, 315, in metres
 *  (Dig in's "Sight lines" row says it in words); null without the bush-thickness band
 *  (`through30 == null`) or off the grid. */
export function sightLines(lon: number, lat: number): { bearing: number; m: number }[] | null {
  const h = habitat()
  if (!h) return null
  const i = h.index(lon, lat)
  if (i < 0) return null
  if (!huntCache || huntCache.h !== h) huntCache = { h, b: huntBands(h) }
  const b = huntCache.b
  if (!b.through30) return null
  const out: { bearing: number; m: number }[] = []
  for (let bearing = 0; bearing < 360; bearing += 45) out.push({ bearing, m: viewM(b, h, i, bearing) })
  return out
}

/** This point's best window of the week: the one whose activity × the
 *  point's score under that window's conditions is highest. The log knob
 *  is turned off for the pass (no logBoostGrid allocation per window; the
 *  log leans the map, not the hour). Null with no windows or off the grid. */
export function bestWindowHere(t: Target, lon: number, lat: number, plans: DayPlan[], w: Weights = DEFAULT_WEIGHTS): WindowScore | null {
  const w0: Weights = { ...w, log: 0 }
  let best: WindowScore | null = null
  let bestV = -Infinity
  for (const plan of plans) {
    for (const win of [plan.morning, plan.evening]) {
      if (!win) continue
      const pc = pointCase(t, lon, lat, win.conditions, w0)
      if (!pc) continue
      const v = win.activity * pc.score
      if (v > bestV) {
        bestV = v
        best = win
      }
    }
  }
  return best
}
