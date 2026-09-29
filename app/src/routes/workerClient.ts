/**
 * The route worker, shared by the route card and the moose's swing: the
 * going grid goes over once, and each ask gets its own answer back.
 */
import type { Going } from './goingGrid'
import type { FromWorker, ToWorker } from './routeWorker'

let worker: Worker | null = null
let gridSent: Going | null = null
let nextId = 0
const waiting = new Map<number, (m: FromWorker) => void>()

/** Post what `make` builds (it gets the ask's id), and resolve with the worker's answer to it. */
export function askWorker(g: Going, make: (id: number) => ToWorker, transfer: Transferable[] = []): Promise<FromWorker> {
  if (!worker) {
    worker = new Worker(new URL('./routeWorker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<FromWorker>) => {
      const done = waiting.get(e.data.id)
      waiting.delete(e.data.id)
      done?.(e.data)
    }
  }
  if (gridSent !== g) {
    worker.postMessage({ type: 'grid', grid: g.data } satisfies ToWorker)
    gridSent = g
  }
  const id = ++nextId
  const w = worker
  return new Promise((resolve) => {
    waiting.set(id, resolve)
    w.postMessage(make(id), transfer)
  })
}
