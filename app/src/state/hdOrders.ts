import { create } from 'zustand'

/**
 * HD asked for from this phone (explore/BoxCard.tsx), so the grade sheet
 * can say so: the box, which area it extends or lies over, and when. The
 * queue's own status is not readable from the phone (the site Worker has no
 * status lookup), so an order stays ordered until its email comes; the
 * sheet can put one away (Forget it here). A dev build's order is marked
 * `sim`: nothing was sent.
 */

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
