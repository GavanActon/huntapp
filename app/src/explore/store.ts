import { create } from 'zustand'
import type { Tile } from './lattice'

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

export interface Selected {
  tile: Tile
  /** the tap, inside the tile */
  lon: number
  lat: number
  props: CoverageProps | null
}

export interface Requested {
  kind: 'sd' | 'hd'
  at: number
}

interface ExploreState {
  selected: Selected | null
  /** tiles asked for from this phone, by id (kept) */
  requested: Record<string, Requested>
  /** the address last used (kept) */
  email: string
  select: (s: Selected | null) => void
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
  ...readKept(),
  select: (selected) => set({ selected }),
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
