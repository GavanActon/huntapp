/**
 * The bull's way round to your scent: a least-cost path for a moose over
 * the going grid, from where he was last heard to the nearest ground where
 * your scent is noticeable at his nose. A resistance surface searched with
 * Dijkstra, the usual way movement ecology puts an animal's likely route
 * across a landscape; here the resistance is a moose's, not a walker's.
 * Pure, so it runs in the route worker beside the route finder.
 *
 * What a cell costs him to cross (docs/HUNT-FISH-SCIENCE.md, "Out
 * hunting"):
 *   slope      the walking curve softened (its square root): four long legs
 *              take a grade better than you do, but he still takes the easy
 *              line; a rock face stays a rock face
 *   bush       hardly slows him: 1 − 0.2 × NRD
 *   wet        bog, fen and marsh are his ground, a little slower; open
 *              water he swims, at a quarter of the going
 * and what it costs a wary bull working in to a call:
 *   open       in sight of you (inside 250 m, fading out), open ground (bog,
 *              road, water, thin bush) costs up to three times as much: he
 *              keeps to cover
 *   close      bulls hang up at 45-75 m in heavy timber: inside 80 m each
 *              metre costs more, up to five times, and inside 25 m none
 *              is crossed at all
 *
 * Which way round: one search each way, each with a wall from you out
 * along the line between them (the bisector of the way round the other
 * side), so each path is the best that goes round that side. The caller
 * picks: the way he has been moving round, else the cheaper.
 */
import { GROUND } from '../routes/walkModel'
import { Heap, MOVES, sf, type GoingGridData } from '../routes/router'

export const SWING = {
  /** scent a moose notices when the request gives none: the scent model's NOTICE as modelled, a share of the plume core 20-40 m out */
  notice: 0.04,
  /** scent nearer you than this is not a swing: he would be on top of you */
  minM: 40,
  /** how far out open ground counts as in your sight, m */
  seeM: 250,
  /** open ground in full sight costs 1 + this times as much */
  open: 2,
  /** he holds off inside this, m, costing up to 1 + keep times as much at the core's edge */
  keepM: 80,
  keep: 4,
  /** nothing inside this is crossed, m: it also closes the wall off at you */
  coreM: 25,
  /** a moose swims at about this share of his going on land */
  swim: 0.25,
}

export interface SwingWay {
  /** 1 round clockwise, −1 anticlockwise */
  turn: 1 | -1
  /** true bearing of the wall from you that keeps this search on its side */
  wall: number
}

export interface SwingRequest {
  /** his last spot and yours: going-grid cells */
  from: number
  you: number
  /** the part of the grid searched: going rows r0.. and cols c0.., rows × cols */
  r0: number
  c0: number
  rows: number
  cols: number
  /** scent at a moose's nose over that window, row-major, as a share of the plume core */
  scent: Float32Array
  /** the share he notices, as the scent card's slider has it; SWING.notice when left out */
  notice?: number
  ways: SwingWay[]
}

export interface SwingPath {
  turn: 1 | -1
  /** going-grid cells, his spot to where he winds you */
  cells: Int32Array
  /** the weighted cost, for choosing between the ways */
  cost: number
  distM: number
}

export interface SwingAnswer {
  /** he is in your scent already */
  onIt: boolean
  paths: SwingPath[]
}

/** What each cell of the window costs him per metre on the flat, Infinity at your core. */
function costs(g: GoingGridData, q: SwingRequest): Float32Array {
  const { dx, dy } = g
  const yr = Math.floor(q.you / g.cols)
  const yc = q.you % g.cols
  const out = new Float32Array(q.rows * q.cols)
  for (let lr = 0; lr < q.rows; lr++) {
    const r = q.r0 + lr
    for (let lc = 0; lc < q.cols; lc++) {
      const c = q.c0 + lc
      const i = r * g.cols + c
      const j = lr * q.cols + lc
      const d = Math.hypot((r - yr) * dy, (c - yc) * dx)
      if (d < SWING.coreM) {
        out[j] = Infinity
        continue
      }
      const gr = g.ground[i]
      const b = g.bush[i]
      const nrd = b === b ? b : 0.45
      const wet =
        gr === GROUND.water ? SWING.swim : gr === GROUND.marsh ? 0.8 : gr === GROUND.openPeat ? 0.85 : gr === GROUND.swamp ? 0.9 : gr === GROUND.stream ? 0.85 : 1
      const bare = gr === GROUND.water || gr === GROUND.road || gr === GROUND.openPeat || gr === GROUND.marsh
      const open = bare ? 1 : Math.min(1, Math.max(0, (0.35 - nrd) / 0.35))
      const seen = Math.max(0, 1 - d / SWING.seeM)
      const close = d < SWING.keepM ? (1 - d / SWING.keepM) ** 2 : 0
      out[j] = ((1 + SWING.open * open * seen) * (1 + SWING.keep * close)) / ((1 - 0.2 * nrd) * wet)
    }
  }
  return out
}

/** A two-cell-thick wall from you to the window's edge on a true bearing. */
function wall(q: SwingRequest, yr: number, yc: number, bearing: number, cost: Float32Array) {
  const rad = (bearing * Math.PI) / 180
  const sc = Math.sin(rad)
  const sr = -Math.cos(rad)
  const block = (r: number, c: number) => {
    if (r >= 0 && c >= 0 && r < q.rows && c < q.cols) cost[r * q.cols + c] = Infinity
  }
  for (let t = 0; ; t += 0.4) {
    const r = Math.floor(yr + 0.5 + sr * t)
    const c = Math.floor(yc + 0.5 + sc * t)
    if (r < -1 || c < -1 || r > q.rows || c > q.cols) break
    block(r, c)
    block(r + 1, c)
    block(r, c + 1)
  }
}

/** Dijkstra from his cell to the first cell where he has your scent; local cells, or null. */
function search(g: GoingGridData, q: SwingRequest, cost: Float32Array, start: number, goal: Uint8Array): { path: Int32Array; cost: number } | null {
  const { rows, cols } = q
  const n = rows * cols
  const best = new Float64Array(n).fill(Infinity)
  const came = new Int32Array(n).fill(-1)
  const closed = new Uint8Array(n)
  const heap = new Heap()
  const len = MOVES.map(([dr, dc]) => Math.hypot(dr * g.dy, dc * g.dx))
  const z = (j: number) => g.elev[(q.r0 + Math.floor(j / cols)) * g.cols + q.c0 + (j % cols)]
  best[start] = 0
  heap.push(0, start)
  let end = -1
  for (;;) {
    const a = heap.pop()
    if (a < 0) break
    if (closed[a]) continue
    if (goal[a]) {
      end = a
      break
    }
    closed[a] = 1
    const ar = Math.floor(a / cols)
    const ac = a % cols
    const ca = cost[a]
    const za = z(a)
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
      if (m < 4) mean = (ca + cb) / 2
      else if (m < 8) {
        // no slipping through a wall's corner
        if (cost[ar * cols + bc] === Infinity || cost[br * cols + ac] === Infinity) continue
        mean = (ca + cb) / 2
      } else {
        const sr = Math.sign(dr)
        const sc = Math.sign(dc)
        const m1 = Math.abs(dr) === 1 ? ar * cols + ac + sc : (ar + sr) * cols + ac
        const m2 = Math.abs(dr) === 1 ? br * cols + ac + sc : (ar + sr) * cols + bc
        const c1 = cost[m1]
        const c2 = cost[m2]
        if (c1 === Infinity || c2 === Infinity) continue
        mean = (ca + c1 + c2 + cb) / 4
      }
      const L = len[m]
      const nb = best[a] + (L * mean) / Math.sqrt(sf((z(b) - za) / L))
      if (nb < best[b]) {
        best[b] = nb
        came[b] = a
        heap.push(nb, b)
      }
    }
  }
  if (end < 0) return null
  const out: number[] = []
  for (let j = end; j >= 0; j = came[j]) {
    out.push(j)
    if (j === start) break
  }
  if (out[out.length - 1] !== start) return null
  return { path: Int32Array.from(out.reverse()), cost: best[end] }
}

export function findSwing(g: GoingGridData, q: SwingRequest): SwingAnswer {
  const toLocal = (i: number) => {
    const r = Math.floor(i / g.cols) - q.r0
    const c = (i % g.cols) - q.c0
    return r < 0 || c < 0 || r >= q.rows || c >= q.cols ? -1 : r * q.cols + c
  }
  const start = toLocal(q.from)
  const you = toLocal(q.you)
  if (start < 0 || you < 0) return { onIt: false, paths: [] }
  const notice = q.notice ?? SWING.notice
  if (q.scent[start] >= notice) return { onIt: true, paths: [] }
  const yr = Math.floor(you / q.cols)
  const yc = you % q.cols
  const goal = new Uint8Array(q.rows * q.cols)
  for (let j = 0; j < goal.length; j++) {
    if (q.scent[j] < notice) continue
    const d = Math.hypot((Math.floor(j / q.cols) - yr) * g.dy, ((j % q.cols) - yc) * g.dx)
    if (d >= SWING.minM) goal[j] = 1
  }
  const base = costs(g, q)
  const paths: SwingPath[] = []
  for (const way of q.ways) {
    const cost = base.slice()
    wall(q, yr, yc, way.wall, cost)
    if (cost[start] === Infinity) continue
    const found = search(g, q, cost, start, goal)
    if (!found) continue
    const cells = found.path.map((j) => (q.r0 + Math.floor(j / q.cols)) * g.cols + q.c0 + (j % q.cols))
    let distM = 0
    for (let k = 1; k < cells.length; k++) {
      const dr = Math.floor(cells[k] / g.cols) - Math.floor(cells[k - 1] / g.cols)
      const dc = (cells[k] % g.cols) - (cells[k - 1] % g.cols)
      distM += Math.hypot(dr * g.dy, dc * g.dx)
    }
    paths.push({ turn: way.turn, cells, cost: found.cost, distM })
  }
  return { onIt: false, paths }
}
