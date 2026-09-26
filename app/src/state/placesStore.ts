import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { PLACES, type PlaceDef } from '../config'

export interface SavedPlace extends PlaceDef {
  id: string
  savedAt: number
}

interface PlacesState {
  places: SavedPlace[]
  /** The place the map and strip are about; null = nothing picked. */
  selectedId: string | null
  select: (id: string | null) => void
  add: (p: PlaceDef) => SavedPlace
  update: (id: string, patch: Partial<PlaceDef>) => void
  remove: (id: string) => void
}

function seed(): SavedPlace[] {
  return PLACES.map((p, i) => ({ ...p, id: `preset-${i}`, savedAt: 0 }))
}

export const usePlacesStore = create<PlacesState>()(
  persist(
    (set, get) => ({
      places: seed(),
      selectedId: null,
      select: (selectedId) => set({ selectedId }),
      add: (p) => {
        const sp: SavedPlace = { ...p, id: `p-${Date.now().toString(36)}`, savedAt: Date.now() }
        set({ places: [...get().places, sp] })
        return sp
      },
      update: (id, patch) =>
        set({ places: get().places.map((p) => (p.id === id ? { ...p, ...patch } : p)) }),
      remove: (id) =>
        set({
          places: get().places.filter((p) => p.id !== id),
          selectedId: get().selectedId === id ? null : get().selectedId,
        }),
    }),
    {
      name: 'huntapp-places',
      partialize: (s) => ({ places: s.places }),
      /** Presets (savedAt 0) follow config: a moved camp moves for an app
       *  that already stored the old copy. User edits to them are lost, but
       *  the user's own places (savedAt > 0) are kept as saved. */
      merge: (persisted, current) => {
        const saved = (persisted as Partial<PlacesState> | undefined)?.places ?? []
        const presets = seed()
        const own = saved.filter((p) => p.savedAt > 0)
        return { ...current, places: [...presets, ...own] }
      },
    },
  ),
)

export function selectedPlace(): SavedPlace | null {
  const s = usePlacesStore.getState()
  return s.places.find((p) => p.id === s.selectedId) ?? null
}

/** The camp: the first preset, or the first saved place. */
export function homePlace(): SavedPlace {
  return usePlacesStore.getState().places[0]
}
