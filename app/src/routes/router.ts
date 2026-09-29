/**
 * The route finder: the quickest ways across the going grid from one cell
 * to another, and what each one is like. Pure (typed arrays in, typed
 * arrays out), so it runs in the route worker off the main thread.
 *
 * A* over the 10 m cells with sixteen moves (the eight neighbours and the
 * eight knight's moves), so a path can hold a bearing of 27° or 63°
 * instead of zigzagging. A step costs its length times the mean
 * seconds-per-metre of the cells it crosses, over the slope factor of its
 * grade: uphill and down are costed separately, as Campbell et al.
 * (2017) found the best route out and the best route back differ. Water
 * is not crossed, and a diagonal does not squeeze past a lake's corner.
 *
 * Three routes: the quickest, then the quickest that keeps off the first
 * one's corridor, and so on (the corridor's cells cost more each time,
 * except near the two ends, which every route must share). An alternative
 * counts only if most of it is its own ground and it is not much slower;
 * otherwise the corridor is pushed harder and the search runs again.
 *
 * Hunting (a `hunt` field on the request): good ground within sight of a
 * step takes off its cost, and scent drifting from the step onto good
 * ground, or onto the spot you are walking to, adds to it. The times and
 * distances reported are always the walk's own, not the weighted cost.
 */
import { bushFactor, crossingS, groundFactor, GROUND, HUNT, isWet, roughFactor, SLOPE_PEAK, slopeFactor, type WalkOptions } from './walkModel'

export interface GoingGridData {
  cols: number
  rows: number
  /** metres per cell, east-west and north-south */
  dx: number
  dy: number
  elev: Float32Array
  /** NRD 0..1, NaN on water */
  bush: Float32Array
  bushSrc: Uint8Array
  rough: Float32Array
  ground: Uint8Array
  /** this lattice inside the habitat grid: going (r, c) is habitat (r0 + r / k, c0 + c / k) */
  hab: { c0: number; r0: number; k: number }
}

/** The wind over the grid on a coarse lattice (every `step` cells), blowing toward (e, n), m/s. */
export interface WindField {
  cols: number
  rows: number
  step: number
  e: Float32Array
  n: Float32Array
  sig: Float32Array
}

export interface HuntField {
  /** how good the ground is for the game, 0..1, over the habitat cells under this grid (hcols × hrows) */
  game: Float32Array
  hcols: number
  hrows: number
  /** walking into good ground: + costs more (skirt it), - costs less (walk it, for grouse) */
  intrude: number
  /** a step whose scent reaches top ground costs 1 + scent times as much; 0 for game that does not wind you */
  scent: number
}

export interface RouteRequest {
  start: number
  goal: number
  opts: WalkOptions
  wind?: WindField
  hunt?: HuntField
}

export interface RouteParts {
  slope: number
  bush: number
  rough: number
  wet: number
  crossing: number
}

export interface RouteResult {
  /** cell indices, start to goal */
  cells: Int32Array
  timeS: number
  distM: number
  climbM: number
  descentM: number
  /** seconds each thing adds over walking the same line on the flat at pace (slope can be negative: downhill gives time back) */
  extra: RouteParts
  roadM: number
  wetM: number
  thickM: number
  crossings: number
  /** share of the land walked where the bush is LiDAR, not the forest-map estimate */
  lidarShare: number
  /** the last stretch in: which way the wind carries your scent relative to where you are going */
  approach: 'into' | 'cross' | 'behind' | null
  /** hunting: metres with good ground in sight, and metres whose scent reaches good ground */
  nearM?: number
  scentM?: number
}

export interface RoutesAnswer {
  start: number
  goal: number
  routes: RouteResult[]
  /** why fewer than asked for, when it matters */
  note?: string
}

// [dr, dc]: the eight neighbours, then the knight's moves
const MOVES: [number, number][] = [
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
  [1, 2],
  [2, 1],
  [-1, 2],
  [-2, 1],
  [1, -2],
  [2, -1],
  [-1, -2],
  [-2, -1],
]

// slope factor by grade, -2..2 in 0.001 steps
const LUT_MIN = -2
const LUT_STEP = 0.001
const LUT = (() => {
  const n = Math.round((2 - LUT_MIN) / LUT_STEP) + 1
  const a = new Float32Array(n)
  for (let i = 0; i < n; i++) a[i] = slopeFactor(LUT_MIN + i * LUT_STEP)
  return a
})()
function sf(grade: number): number {
  const i = Math.round((grade - LUT_MIN) / LUT_STEP)
  return LUT[i < 0 ? 0 : i >= LUT.length ? LUT.length - 1 : i]
}

/** Seconds per metre on each cell with no slope, Infinity on water. */
function baseCost(g: GoingGridData, o: WalkOptions): Float32Array {
  const pace = o.paceKmh / 3.6
  const n = g.cols * g.rows
  const c = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const gr = g.ground[i]
    if (gr === GROUND.water) {
      c[i] = Infinity
      continue
    }
    const b = g.bush[i]
    c[i] = 1 / (pace * bushFactor(b === b ? b : 0.5) * roughFactor(g.rough[i]) * groundFactor(gr, o.stayDry))
  }
  return c
}

interface HuntGrids {
  /** how good the ground underfoot is, 0..1 */
  here: Float32Array
  /** good ground in sight, 0..1 */
  near: Float32Array
  /** scent reaching good ground, 0..1 */
  scent: Float32Array
}

function windAt(w: WindField, r: number, c: number, out: Float32Array) {
  const fr = Math.min(w.rows - 1, Math.max(0, r / w.step))
  const fc = Math.min(w.cols - 1, Math.max(0, c / w.step))
  const r0 = Math.min(w.rows - 2, Math.floor(fr))
  const c0 = Math.min(w.cols - 2, Math.floor(fc))
  const tr = Math.min(1, fr - r0)
  const tc = Math.min(1, fc - c0)
  const k = (rr: number, cc: number) => rr * w.cols + cc
  const mix = (a: Float32Array) =>
    a[k(r0, c0)] * (1 - tr) * (1 - tc) + a[k(r0, c0 + 1)] * (1 - tr) * tc + a[k(r0 + 1, c0)] * tr * (1 - tc) + a[k(r0 + 1, c0 + 1)] * tr * tc
  if (w.rows < 2 || w.cols < 2) {
    out[0] = w.e[0]
    out[1] = w.n[0]
    out[2] = w.sig[0]
    return
  }
  out[0] = mix(w.e)
  out[1] = mix(w.n)
  out[2] = mix(w.sig)
}

function huntGrids(g: GoingGridData, h: HuntField, wind: WindField | undefined, goal: number): HuntGrids {
  const { cols, rows, dx, dy } = g
  const k = g.hab.k
  const gv = h.game
  // in sight: the habitat cell and its neighbours (±30-45 m), two out where the bush is open
  const near1 = new Float32Array(gv.length)
  const near2 = new Float32Array(gv.length)
  for (let r = 0; r < h.hrows; r++)
    for (let c = 0; c < h.hcols; c++) {
      let m1 = 0
      let m2 = 0
      for (let dr = -2; dr <= 2; dr++)
        for (let dc = -2; dc <= 2; dc++) {
          const rr = r + dr
          const cc = c + dc
          if (rr < 0 || cc < 0 || rr >= h.hrows || cc >= h.hcols) continue
          const v = gv[rr * h.hcols + cc]
          if (v > m2) m2 = v
          if (Math.abs(dr) <= 1 && Math.abs(dc) <= 1 && v > m1) m1 = v
        }
      near1[r * h.hcols + c] = m1
      near2[r * h.hcols + c] = m2
    }
  const n = cols * rows
  const here = new Float32Array(n)
  const near = new Float32Array(n)
  const scent = new Float32Array(n)
  const gr = Math.floor(goal / cols)
  const gc = goal % cols
  const wv = new Float32Array(3)
  const DIST = [25, 50, 75, 100, 150, 200].filter((d) => d <= HUNT.scentReachM)
  const hv = (r: number, c: number) => {
    const hr = Math.floor(r / k)
    const hc = Math.floor(c / k)
    if (hr < 0 || hc < 0 || hr >= h.hrows || hc >= h.hcols) return 0
    return gv[hr * h.hcols + hc]
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      if (g.ground[i] === GROUND.water) continue
      const hi = Math.floor(r / k) * h.hcols + Math.floor(c / k)
      const b = g.bush[i]
      here[i] = gv[hi]
      near[i] = b === b && b < 0.3 ? near2[hi] : near1[hi]
      if (!wind || !h.scent) continue
      windAt(wind, r, c, wv)
      const sp = Math.hypot(wv[0], wv[1])
      if (sp < 0.05) continue
      const ue = wv[0] / sp
      const un = wv[1] / sp
      const half = (Math.min(wv[2], 60) * Math.PI) / 360
      const far = Math.hypot((r - gr) * dy, (c - gc) * dx) > HUNT.arriveM
      let s = 0
      for (let ray = -1; ray <= 1; ray++) {
        const a = ray * half
        const ca = Math.cos(a)
        const sa = Math.sin(a)
        // rotate the downwind unit vector by a (east, north)
        const e = ue * ca + un * sa
        const no = -ue * sa + un * ca
        for (const d of DIST) {
          const w = d <= HUNT.scentFullM ? 1 : 1 - (0.5 * (d - HUNT.scentFullM)) / (HUNT.scentReachM - HUNT.scentFullM)
          const pc = c + (e * d) / dx
          const pr = r - (no * d) / dy
          let v = hv(pr, pc)
          if (far && Math.hypot((pr - gr) * dy, (pc - gc) * dx) <= HUNT.goalM) v = 1
          if (v * w > s) s = v * w
        }
      }
      scent[i] = s
    }
  }
  return { here, near, scent }
}

class Heap {
  keys = new Float64Array(1 << 16)
  vals = new Int32Array(1 << 16)
  size = 0
  push(k: number, v: number) {
    if (this.size === this.keys.length) {
      const nk = new Float64Array(this.size * 2)
      nk.set(this.keys)
      const nv = new Int32Array(this.size * 2)
      nv.set(this.vals)
      this.keys = nk
      this.vals = nv
    }
    let i = this.size++
    const { keys, vals } = this
    while (i > 0) {
      const p = (i - 1) >> 1
      if (keys[p] <= k) break
      keys[i] = keys[p]
      vals[i] = vals[p]
      i = p
    }
    keys[i] = k
    vals[i] = v
  }
  /** pops the smallest; the value, or -1 when empty */
  pop(): number {
    if (!this.size) return -1
    const { keys, vals } = this
    const top = vals[0]
    const k = keys[--this.size]
    const v = vals[this.size]
    let i = 0
    const n = this.size
    for (;;) {
      let m = 2 * i + 1
      if (m >= n) break
      if (m + 1 < n && keys[m + 1] < keys[m]) m++
      if (keys[m] >= k) break
      keys[i] = keys[m]
      vals[i] = vals[m]
      i = m
    }
    keys[i] = k
    vals[i] = v
    return top
  }
}

interface Search {
  cost: Float32Array
  /** extra seconds for stepping onto a creek from dry ground */
  cross: number
  /** the least seconds per metre anywhere, for the heuristic */
  minSpm: number
}

function astar(g: GoingGridData, s: Search, start: number, goal: number): Int32Array | null {
  const { cols, rows, dx, dy, elev, ground } = g
  const n = cols * rows
  const best = new Float64Array(n).fill(Infinity)
  const came = new Int32Array(n).fill(-1)
  const closed = new Uint8Array(n)
  const heap = new Heap()
  const gr = Math.floor(goal / cols)
  const gc = goal % cols
  const h = (r: number, c: number) => Math.hypot((r - gr) * dy, (c - gc) * dx) * s.minSpm
  const len = MOVES.map(([dr, dc]) => Math.hypot(dr * dy, dc * dx))
  const { cost } = s
  best[start] = 0
  heap.push(h(Math.floor(start / cols), start % cols), start)
  for (;;) {
    const a = heap.pop()
    if (a < 0) return null
    if (closed[a]) continue
    if (a === goal) break
    closed[a] = 1
    const ar = Math.floor(a / cols)
    const ac = a % cols
    const ga = best[a]
    const ca = cost[a]
    const wetA = ground[a] === GROUND.stream
    for (let m = 0; m < 16; m++) {
      const [dr, dc] = MOVES[m]
      const br = ar + dr
      const bc = ac + dc
      if (br < 0 || bc < 0 || br >= rows || bc >= cols) continue
      const b = br * cols + bc
      if (closed[b]) continue
      const cb = cost[b]
      if (cb === Infinity) continue
      let mean: number
      let creek = !wetA && ground[b] === GROUND.stream
      if (m < 4) mean = (ca + cb) / 2
      else if (m < 8) {
        // no squeezing past a lake's corner
        if (cost[ar * cols + bc] === Infinity || cost[br * cols + ac] === Infinity) continue
        mean = (ca + cb) / 2
      } else {
        // a knight's move crosses two more cells
        const sr = Math.sign(dr)
        const sc = Math.sign(dc)
        const m1 = Math.abs(dr) === 1 ? ar * cols + ac + sc : (ar + sr) * cols + ac
        const m2 = Math.abs(dr) === 1 ? br * cols + ac + sc : (ar + sr) * cols + bc
        const c1 = cost[m1]
        const c2 = cost[m2]
        if (c1 === Infinity || c2 === Infinity) continue
        mean = (ca + c1 + c2 + cb) / 4
        if (!wetA && (ground[m1] === GROUND.stream || ground[m2] === GROUND.stream)) creek = true
      }
      const L = len[m]
      const t = (L * mean) / sf((elev[b] - elev[a]) / L) + (creek ? s.cross : 0)
      const nb = ga + t
      if (nb < best[b]) {
        best[b] = nb
        came[b] = a
        heap.push(nb + h(br, bc), b)
      }
    }
  }
  const out: number[] = []
  for (let i = goal; i >= 0; i = came[i]) {
    out.push(i)
    if (i === start) break
  }
  if (out[out.length - 1] !== start) return null
  return Int32Array.from(out.reverse())
}

/** The nearest cell that can be walked, within ~100 m; -1 when none. */
export function landCell(g: GoingGridData, i: number): number {
  if (i < 0) return -1
  if (g.ground[i] !== GROUND.water) return i
  const r0 = Math.floor(i / g.cols)
  const c0 = i % g.cols
  for (let rad = 1; rad <= 10; rad++) {
    let best = -1
    let bd = Infinity
    for (let dr = -rad; dr <= rad; dr++)
      for (let dc = -rad; dc <= rad; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== rad) continue
        const r = r0 + dr
        const c = c0 + dc
        if (r < 0 || c < 0 || r >= g.rows || c >= g.cols) continue
        const j = r * g.cols + c
        if (g.ground[j] === GROUND.water) continue
        const d = Math.hypot(dr * g.dy, dc * g.dx)
        if (d < bd) {
          bd = d
          best = j
        }
      }
    if (best >= 0) return best
  }
  return -1
}

function describe(g: GoingGridData, path: Int32Array, o: WalkOptions, wind: WindField | undefined, hunt: HuntGrids | null): RouteResult {
  const { cols, dx, dy, elev, ground, bush, rough, bushSrc } = g
  const pace = o.paceKmh / 3.6
  const extra: RouteParts = { slope: 0, bush: 0, rough: 0, wet: 0, crossing: 0 }
  let timeS = 0
  let distM = 0
  let roadM = 0
  let wetM = 0
  let thickM = 0
  let crossings = 0
  let landM = 0
  let lidarM = 0
  let nearM = 0
  let scentM = 0
  for (let k = 1; k < path.length; k++) {
    const a = path[k - 1]
    const b = path[k]
    const dr = Math.floor(b / cols) - Math.floor(a / cols)
    const dc = (b % cols) - (a % cols)
    const L = Math.hypot(dr * dy, dc * dx)
    // the cells this step crosses: its ends, and a knight's move's middle two
    const cells = [a, b]
    if (Math.abs(dr) + Math.abs(dc) === 3) {
      const ar = Math.floor(a / cols)
      const ac = a % cols
      const br = ar + dr
      const bc = ac + dc
      const sr = Math.sign(dr)
      const sc = Math.sign(dc)
      if (Math.abs(dr) === 1) cells.push(ar * cols + ac + sc, br * cols + ac + sc)
      else cells.push((ar + sr) * cols + ac, (ar + sr) * cols + bc)
    }
    let spm = 0
    let lb = 0
    let lr = 0
    let lw = 0
    for (const i of cells) {
      const bu = bush[i]
      const bf = bushFactor(bu === bu ? bu : 0.5)
      const rf = roughFactor(rough[i])
      const wf = groundFactor(ground[i], o.stayDry)
      spm += 1 / (pace * bf * rf * wf)
      lb += Math.log(bf)
      lr += Math.log(rf)
      lw += Math.log(wf)
    }
    spm /= cells.length
    lb /= cells.length
    lr /= cells.length
    lw /= cells.length
    const s = sf((elev[b] - elev[a]) / L)
    const walk = (L * spm) / s
    const t0 = L / pace
    const creek = ground[a] !== GROUND.stream && cells.slice(1).some((i) => ground[i] === GROUND.stream)
    const cross = creek ? crossingS(o.stayDry) : 0
    timeS += walk + cross
    extra.crossing += cross
    if (creek) crossings++
    // the time over t0, split by each factor's share of the log
    const ls = Math.log(s)
    const tot = -(ls + lb + lr + lw)
    if (Math.abs(tot) > 1e-6) {
      const over = walk - t0
      extra.slope += (over * -ls) / tot
      extra.bush += (over * -lb) / tot
      extra.rough += (over * -lr) / tot
      extra.wet += (over * -lw) / tot
    }
    distM += L
    if (ground[b] === GROUND.road) roadM += L
    if (isWet(ground[b]) && ground[b] !== GROUND.stream) wetM += L
    const bb = bush[b]
    if (bb === bb && bb >= 0.6 && ground[b] !== GROUND.road) thickM += L
    if (bushSrc[b]) {
      landM += L
      if (bushSrc[b] === 1) lidarM += L
    }
    if (hunt) {
      if (hunt.near[b] >= 0.5) nearM += L
      if (hunt.scent[b] >= 0.5) scentM += L
    }
  }
  // climb over the path's elevation smoothed along it, so 10 m cell noise does not add up
  let climbM = 0
  let descentM = 0
  const z = Array.from(path, (i) => elev[i])
  const zs = z.map((_, k) => (z[Math.max(0, k - 1)] + z[k] + z[Math.min(z.length - 1, k + 1)]) / 3)
  for (let k = 1; k < zs.length; k++) {
    const d = zs[k] - zs[k - 1]
    if (d > 0) climbM += d
    else descentM -= d
  }
  return {
    cells: path,
    timeS,
    distM,
    climbM,
    descentM,
    extra,
    roadM,
    wetM,
    thickM,
    crossings,
    lidarShare: landM > 0 ? lidarM / landM : 0,
    approach: approachOf(g, path, wind),
    ...(hunt ? { nearM, scentM } : {}),
  }
}

/** The last 150 m in (not the final 20): does the wind carry your scent ahead of you, aside, or behind? */
function approachOf(g: GoingGridData, path: Int32Array, wind: WindField | undefined): RouteResult['approach'] {
  if (!wind || path.length < 3) return null
  const { cols, dx, dy } = g
  const wv = new Float32Array(3)
  let from = 0
  let acc = 0
  let back = 0
  const end = path[path.length - 1]
  const er = Math.floor(end / cols)
  const ec = end % cols
  for (let k = path.length - 1; k > 0; k--) {
    const d = Math.hypot((Math.floor(path[k] / cols) - er) * dy, ((path[k] % cols) - ec) * dx)
    if (d > 150) break
    from = k
  }
  for (let k = Math.max(1, from); k < path.length; k++) {
    const a = path[k - 1]
    const b = path[k]
    const ar = Math.floor(a / cols)
    const ac = a % cols
    const te = ((b % cols) - ac) * dx
    const tn = -(Math.floor(b / cols) - ar) * dy
    const tl = Math.hypot(te, tn)
    if (Math.hypot((ar - er) * dy, (ac - ec) * dx) < 20 || tl === 0) continue
    windAt(wind, ar, ac, wv)
    const sp = Math.hypot(wv[0], wv[1])
    if (sp < 0.05) continue
    // + when the wind blows the way you walk: your scent goes on ahead
    acc += ((te * wv[0] + tn * wv[1]) / (tl * sp)) * tl
    back += tl
  }
  if (back < 30) return null
  const c = acc / back
  return c > 0.5 ? 'behind' : c < -0.5 ? 'into' : 'cross'
}

function overlap(path: Int32Array, mask: Uint8Array): number {
  let on = 0
  for (const i of path) if (mask[i]) on++
  return on / Math.max(1, path.length)
}

/** Mark a path's corridor, `rad` cells either side. */
function corridor(g: GoingGridData, path: Int32Array, rad: number, visit: (i: number, r: number, c: number) => void) {
  const { cols, rows } = g
  const seen = new Set<number>()
  for (const i of path) {
    const r0 = Math.floor(i / cols)
    const c0 = i % cols
    for (let dr = -rad; dr <= rad; dr++)
      for (let dc = -rad; dc <= rad; dc++) {
        if (dr * dr + dc * dc > rad * rad) continue
        const r = r0 + dr
        const c = c0 + dc
        if (r < 0 || c < 0 || r >= rows || c >= cols) continue
        const j = r * cols + c
        if (seen.has(j)) continue
        seen.add(j)
        visit(j, r, c)
      }
  }
}

/** A route's own ground: within ~40 m of it, another route is sharing it. */
const TAKEN_CELLS = 4
/** The corridor the next search is pushed off, ~70 m either side: far enough to be another way, not the same line a few steps over. */
const AVOID_CELLS = 7

export function findRoutes(g: GoingGridData, req: RouteRequest, want = 3): RoutesAnswer {
  const start = landCell(g, req.start)
  const goal = landCell(g, req.goal)
  if (start < 0 || goal < 0) return { start, goal, routes: [], note: 'water' }
  if (start === goal) return { start, goal, routes: [], note: 'same' }
  const base = baseCost(g, req.opts)
  const hunt = req.hunt ? huntGrids(g, req.hunt, req.wind, goal) : null
  const n = base.length
  const weighted = new Float32Array(n)
  const hs = req.hunt
  let least = 1
  for (let i = 0; i < n; i++) {
    if (!hunt || !hs) {
      weighted[i] = base[i]
      continue
    }
    const m = (1 - HUNT.near * hunt.near[i]) * (1 + hs.scent * hunt.scent[i]) * (1 + hs.intrude * hunt.here[i])
    weighted[i] = base[i] * m
    if (m < least) least = m
  }
  // the heuristic must not overestimate: the cheapest a step can get
  const minSpm = (1 / ((req.opts.paceKmh / 3.6) * SLOPE_PEAK)) * Math.min(1, least)
  const pen = new Float32Array(n).fill(1)
  const cost = new Float32Array(n)
  const taken = new Uint8Array(n)
  const routes: RouteResult[] = []
  const { cols, dx, dy } = g
  const sr = Math.floor(start / cols)
  const sc = start % cols
  const gr = Math.floor(goal / cols)
  const gc = goal % cols
  let note: string | undefined
  for (let attempt = 0; routes.length < want && attempt < 7; attempt++) {
    for (let i = 0; i < n; i++) cost[i] = weighted[i] * pen[i]
    const path = astar(g, { cost, cross: crossingS(req.opts.stayDry), minSpm }, start, goal)
    if (!path) {
      if (!routes.length) note = 'no way'
      break
    }
    const r = describe(g, path, req.opts, req.wind, hunt)
    const first = routes[0]
    // an alternative is its own ground for the most part, and not a long way round
    const ok = !first || (overlap(path, taken) < 0.5 && r.timeS <= first.timeS * 1.6 + 180)
    if (ok) {
      routes.push(r)
      corridor(g, path, TAKEN_CELLS, (j) => (taken[j] = 1))
    }
    // push the next search off this corridor, but not off the two ends every route shares
    corridor(g, path, AVOID_CELLS, (j, rr, cc) => {
      const ds = Math.hypot((rr - sr) * dy, (cc - sc) * dx)
      const de = Math.hypot((rr - gr) * dy, (cc - gc) * dx)
      if (ds > 120 && de > 120) pen[j] *= 1.7
    })
    if (!ok && r.timeS > (first?.timeS ?? 0) * 1.6 + 180) {
      note = 'one way'
      break
    }
  }
  // search order is the order: the best first (the quickest, or out hunting the best hunt)
  return { start, goal, routes, note: routes.length < want && !note ? 'one way' : note }
}
