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
  /** the HD area this box grows (ui/grade.tsx hdOffer): its id, name, and its own ground, km² */
  extend?: { areaId: string; name: string; baseKm2: number }
  /** a loaded location this box moves or grows (Locations' Move or resize): loading it takes that one's place */
  replaces?: { id: string; name: string }
  /** opened to ask for HD (the grade sheet's Get HD): the card's details and the ask; else it is the load card,
   *  the box and Load and nothing else (explore/BoxCard.tsx) */
  purpose?: 'hd'
}

export interface Requested {
  kind: 'sd' | 'hd'
  at: number
  /** the request's number in the queue (the Worker's answer), for its status (explore/requests.ts) */
  rid?: number
  /** where the bake is, as the queue last said: queued, claimed, baking, review, done, failed,
   *  cancelled; 'waiting' for a build kept on the phone, not sent yet (one at a time, or no signal) */
  stage?: string | null
  /** the bake's step while baking (habitat, wind …) */
  step?: string | null
  /** the area it became, once done */
  areaId?: string | null
  error?: string | null
  /** when the queue was last asked, ms */
  checked?: number
  /** a build's location: its name and province, sent with it */
  name?: string
  j?: string
  /** the address to tell when it is ready, if one was given (optional for SD: docs/REQUESTS.md) */
  email?: string
  /** in line: the builds ahead of it a running machine can take, as the queue last said */
  ahead?: number | null
  /** about how many minutes to go, null when no machine has called in lately (never a clock made up) */
  minutes?: number | null
  /** how far the bake is, 0 to 1, by its steps' measured times */
  progress?: number | null
  /** why a build is held on the phone (the queue turned it away for now), for the devlog */
  held?: string | null
}

interface ExploreState {
  selected: Selected | null
  /** what the coverage index says of the tiles under the box, by tile id, as far as read */
  cover: Record<string, CoverageProps>
  /** asked for from this phone (kept): HD by box id (b-…), and tiles
   *  (t-…) from before there were boxes */
  requested: Record<string, Requested>
  /** each loaded location's SD build (kept), by its box id: started by the Load itself
   *  (docs/REQUESTS.md), one sent at a time (explore/requests.ts) */
  builds: Record<string, Requested>
  /** the address last used (kept) */
  email: string
  select: (s: Selected | null) => void
  /** the box resized or moved; the tap stays */
  setBox: (box: Box) => void
  setCover: (cover: Record<string, CoverageProps>) => void
  markRequested: (id: string, r: Requested) => void
  /** what the queue said of an ask (explore/requests.ts) */
  setStatus: (id: string, s: Partial<Requested>) => void
  /** the ask taken back: the mark goes, whatever the queue says */
  unrequest: (id: string) => void
  setBuild: (id: string, r: Requested) => void
  /** what the queue said of a build */
  patchBuild: (id: string, s: Partial<Requested>) => void
  dropBuild: (id: string) => void
  setEmail: (email: string) => void
}

const KEY = 'huntapp-explore'

function readKept(): { requested: Record<string, Requested>; builds: Record<string, Requested>; email: string } {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const j = JSON.parse(raw) as { requested?: Record<string, Requested>; builds?: Record<string, Requested>; email?: string }
      const requested: Record<string, Requested> = {}
      const builds: Record<string, Requested> = { ...j.builds }
      // an SD ask for a box from before builds (the no-tiles card's "Ask for the ground wind") is that box's build
      for (const [id, r] of Object.entries(j.requested ?? {})) {
        if (r?.kind === 'sd' && id.startsWith('b-') && !builds[id]) builds[id] = r
        else requested[id] = r
      }
      return { requested, builds, email: j.email ?? '' }
    }
  } catch {
    /* private mode */
  }
  return { requested: {}, builds: {}, email: '' }
}

function keep(s: ExploreState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ requested: s.requested, builds: s.builds, email: s.email }))
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
  setStatus: (id, s) => {
    const cur = get().requested[id]
    if (!cur) return
    set({ requested: { ...get().requested, [id]: { ...cur, ...s } } })
    keep(get())
  },
  unrequest: (id) => {
    const { [id]: _gone, ...rest } = get().requested
    set({ requested: rest })
    keep(get())
  },
  setBuild: (id, r) => {
    set({ builds: { ...get().builds, [id]: r } })
    keep(get())
  },
  patchBuild: (id, s) => {
    const cur = get().builds[id]
    if (!cur) return
    set({ builds: { ...get().builds, [id]: { ...cur, ...s } } })
    keep(get())
  },
  dropBuild: (id) => {
    const { [id]: _gone, ...rest } = get().builds
    set({ builds: rest })
    keep(get())
  },
  setEmail: (email) => {
    set({ email })
    keep(get())
  },
}))
