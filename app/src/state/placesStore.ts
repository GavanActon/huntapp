import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { ACTIVE_AREA, AREA_LIST, DEFAULT_AREA, areaAt, areaById, type AreaDef } from '../areas'
import type { PlaceDef } from '../config'
import { revealMark } from './appStore'

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

/** A preset's id. Pickle Lake's keep the ones they had before there were
 *  areas (preset-0 …); another area's carry its id (lac-bailey:preset-0). */
function presetId(areaId: string, i: number): string {
  return areaId === DEFAULT_AREA ? `preset-${i}` : `${areaId}:preset-${i}`
}

/** Every area's presets, the active area's first: its camp is places[0],
 *  the camp everything without a fix or a pick counts from (homePlace). */
function seed(): SavedPlace[] {
  return AREA_LIST.filter((a) => !a.virtual).flatMap((a) => a.presets.map((p, i) => ({ ...p, id: presetId(a.id, i), savedAt: 0 })))
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
        revealMark('pins')
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
      /** Presets (savedAt 0) follow the area files: a moved camp moves for
       *  an app that already stored the old copy. User edits to them are
       *  lost, but the user's own places (savedAt > 0) are kept as saved. */
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

/** The area a place belongs to: a preset its own (by its id, so a preset
 *  outside its area's box, like White Lake, still counts as its area's), a
 *  pin the area its point lies in; null for a pin in none. */
export function placeArea(p: Pick<SavedPlace, 'id' | 'lon' | 'lat' | 'savedAt'>): AreaDef | null {
  if (p.savedAt === 0) {
    const m = /^(?:(.+):)?preset-\d+$/.exec(p.id)
    if (m) return areaById(m[1] ?? DEFAULT_AREA)
  }
  return areaAt(p.lon, p.lat)
}

/** The places of the area the app is in, and pins in no area: what the
 *  weather is kept fresh for and stood in from. Another area's are looked
 *  after once it is switched to. */
export function areaPlaces(): SavedPlace[] {
  return usePlacesStore.getState().places.filter((p) => {
    const a = placeArea(p)
    return !a || a.id === ACTIVE_AREA.id
  })
}
