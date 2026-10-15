import { create } from 'zustand'

/**
 * HD asked for from this phone (explore/BoxCard.tsx), so the grade tile can
 * show it being built: the stages the bake goes through, then ready. The
 * queue's own status is not readable from the phone yet (the site Worker
 * has no status lookup, and it cannot be deployed under the live freeze),
 * so a real order stays at Ordered until its email comes. On the dev builds
 * an order is simulated: no request is sent, and the stages pass in about a
 * minute and a half, so the whole run can be tried.
 */

export type OrderStage = 'ordered' | 'lidar' | 'wind' | 'packing' | 'ready'

export const STAGES: { id: OrderStage; words: string }[] = [
  { id: 'ordered', words: 'Ordered' },
  { id: 'lidar', words: 'Reading the LiDAR' },
  { id: 'wind', words: 'Solving the wind' },
  { id: 'packing', words: 'Packing the maps' },
  { id: 'ready', words: 'Ready' },
]

export interface HdOrder {
  /** the box asked for (explore/box.ts boxId) */
  boxId: string
  /** the area it extends, or the area it was asked from; none for a new spot */
  areaId?: string
  /** the area's name, or where it is in words */
  name: string
  kind: 'extend' | 'new'
  at: number
  /** a dev build's: nothing was sent */
  sim: boolean
}

const KEY = 'huntapp-hd-orders'
/** a simulated order's stages, ms from the order */
const SIM_AT: Record<OrderStage, number> = { ordered: 0, lidar: 12_000, wind: 35_000, packing: 70_000, ready: 90_000 }

function readKept(): Record<string, HdOrder> {
  try {
    return (JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, HdOrder>) ?? {}
  } catch {
    return {}
  }
}

interface OrdersState {
  orders: Record<string, HdOrder>
  add: (o: HdOrder) => void
  remove: (boxId: string) => void
}

export const useHdOrders = create<OrdersState>()((set, get) => ({
  orders: readKept(),
  add: (o) => {
    set({ orders: { ...get().orders, [o.boxId]: o } })
    keep(get().orders)
  },
  remove: (boxId) => {
    const { [boxId]: _gone, ...rest } = get().orders
    set({ orders: rest })
    keep(rest)
  },
}))

function keep(o: Record<string, HdOrder>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(o))
  } catch {
    /* private mode */
  }
}

/** Where an order stands now, and how far along it is (0–1). */
export function orderStage(o: HdOrder, now = Date.now()): { stage: OrderStage; frac: number } {
  if (!o.sim) return { stage: 'ordered', frac: 0.08 }
  const t = now - o.at
  let stage: OrderStage = 'ordered'
  for (const s of STAGES) if (t >= SIM_AT[s.id]) stage = s.id
  return { stage, frac: Math.min(1, Math.max(0.04, t / SIM_AT.ready)) }
}
