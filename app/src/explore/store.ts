import { create } from 'zustand'
import type { Box } from './box'

/** What the coverage index says a tile can have (pipeline/coverage.py). */
export interface CoverageProps {
  prov?: string
  /** the newest 1 m LiDAR project's year, 0 for none */
  lidar?: number
  lidarN?: number
  project?: string
  /** FRI 2012, écoforestière, VRI, SCANFI */
  stands?: string
  water?: string
  /** 1 SD only, 2 HD possible, 3 HD with inventory stands */
  grade?: number
  /** hd or sd where an area of the app already covers the tile */
  baked?: string
}

/** The box drawn (explore/box.ts) and the tap that made it. */
export interface Selected {
  box: Box
  lon: number
  lat: number
}

export interface Requested {
  kind: 'sd' | 'hd'
  at: number
}

interface ExploreState {
  selected: Selected | null
  /** what the coverage index says of the tiles under the box, by tile id, as far as read */
  cover: Record<string, CoverageProps>
  /** asked for from this phone (kept): boxes by box id (b-…), and tiles
   *  (t-…) from before there were boxes */
  requested: Record<string, Requested>
  /** the address last used (kept) */
  email: string
  select: (s: Selected | null) => void
  /** the box resized or moved; the tap stays */
  setBox: (box: Box) => void
  setCover: (cover: Record<string, CoverageProps>) => void
  markRequested: (id: string, r: Requested) => void
  /** the ask taken back: the mark goes, whatever the queue says */
  unrequest: (id: string) => void
  setEmail: (email: string) => void
}

const KEY = 'huntapp-explore'

function readKept(): { requested: Record<string, Requested>; email: string } {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const j = JSON.parse(raw) as { requested?: Record<string, Requested>; email?: string }
      return { requested: j.requested ?? {}, email: j.email ?? '' }
    }
  } catch {
    /* private mode */
  }
  return { requested: {}, email: '' }
}

function keep(s: ExploreState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ requested: s.requested, email: s.email }))
  } catch {
    /* private mode or full */
  }
}

export const useExplore = create<ExploreState>()((set, get) => ({
  selected: null,
  cover: {},
  ...readKept(),
  select: (selected) => set({ selected }),
  setBox: (box) => {
    const cur = get().selected
    if (cur) set({ selected: { ...cur, box } })
  },
  setCover: (cover) => set({ cover }),
  markRequested: (id, r) => {
    set({ requested: { ...get().requested, [id]: r } })
    keep(get())
  },
  unrequest: (id) => {
    const { [id]: _gone, ...rest } = get().requested
    set({ requested: rest })
    keep(get())
  },
  setEmail: (email) => {
    set({ email })
    keep(get())
  },
}))
