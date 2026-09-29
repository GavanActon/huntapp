/**
 * The route finder off the main thread: the going grid comes once, then
 * each request is a start, a goal and the options, and the answer goes
 * back with its paths transferred, not copied. The moose's swing round to
 * your scent (hunting/swing.ts) runs here too, on the same grid.
 */
import { findSwing, type SwingAnswer, type SwingRequest } from '../hunting/swing'
import { findRoutes, type GoingGridData, type RouteRequest, type RoutesAnswer } from './router'

export type ToWorker = { type: 'grid'; grid: GoingGridData } | { type: 'route'; id: number; req: RouteRequest } | { type: 'swing'; id: number; req: SwingRequest }
export type FromWorker =
  | { type: 'routes'; id: number; answer: RoutesAnswer; ms: number }
  | { type: 'swing'; id: number; answer: SwingAnswer; ms: number }
  | { type: 'error'; id: number; message: string }

const ctx = self as unknown as { onmessage: ((e: MessageEvent<ToWorker>) => void) | null; postMessage: (m: FromWorker, transfer?: Transferable[]) => void }
let grid: GoingGridData | null = null

ctx.onmessage = (e) => {
  const m = e.data
  if (m.type === 'grid') {
    grid = m.grid
    return
  }
  if (!grid) return ctx.postMessage({ type: 'error', id: m.id, message: 'no grid' })
  try {
    const t0 = performance.now()
    if (m.type === 'swing') {
      const answer = findSwing(grid, m.req)
      return ctx.postMessage({ type: 'swing', id: m.id, answer, ms: performance.now() - t0 }, answer.paths.map((p) => p.cells.buffer))
    }
    const answer = findRoutes(grid, m.req)
    ctx.postMessage({ type: 'routes', id: m.id, answer, ms: performance.now() - t0 }, answer.routes.map((r) => r.cells.buffer))
  } catch (err) {
    ctx.postMessage({ type: 'error', id: m.id, message: (err as Error).message })
  }
}
