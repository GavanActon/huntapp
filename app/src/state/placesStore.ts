import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { ACTIVE_AREA, AREA_LIST, DEFAULT_AREA, areaAt, areaById, type AreaDef } from '../areas'
import type { PinNote, PlaceDef } from '../config'
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
  /** a note written now (or at `at`, the moment a draft began); its stamp is its key */
  addNote: (id: string, text: string, at?: number) => number
  editNote: (id: string, at: number, text: string) => void
  removeNote: (id: string, at: number) => void
}

/** A pin's single note of before (2026-10-14) as its first dated one, stamped when the pin was dropped. */
function datedNotes<T extends PlaceDef & { savedAt: number }>(p: T): T {
  if (!p.note || p.notes?.length) return p
  const { note, ...rest } = p
  return { ...rest, notes: [{ at: p.savedAt || Date.now(), text: note }] } as T
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
        const sp: SavedPlace = datedNotes({ ...p, id: `p-${Date.now().toString(36)}`, savedAt: Date.now() })
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
      addNote: (id, text, at = Date.now()) => {
        const n: PinNote = { at, text }
        set({ places: get().places.map((p) => (p.id === id ? { ...p, notes: [...(p.notes ?? []), n] } : p)) })
        return at
      },
      editNote: (id, at, text) =>
        set({ places: get().places.map((p) => (p.id === id ? { ...p, notes: p.notes?.map((n) => (n.at === at ? { ...n, text } : n)) } : p)) }),
      removeNote: (id, at) =>
        set({
          places: get().places.map((p) => {
            if (p.id !== id) return p
            const notes = p.notes?.filter((n) => n.at !== at)
            return { ...p, notes: notes?.length ? notes : undefined }
          }),
        }),
    }),
    {
      name: 'huntapp-places',
      partialize: (s) => ({ places: s.places }),
      /** Presets (savedAt 0) follow the area files: a moved camp moves for
       *  an app that already stored the old copy. User edits to them are
       *  lost but for the notes written on them, which the area file never
       *  has; the user's own places (savedAt > 0) are kept as saved, a single
       *  note of before turned into the first dated one. */
      merge: (persisted, current) => {
        const saved = (persisted as Partial<PlacesState> | undefined)?.places ?? []
        const written = new Map(saved.filter((p) => p.savedAt === 0 && p.notes?.length).map((p) => [p.id, p.notes]))
        const presets = seed().map((p) => (written.has(p.id) ? { ...p, notes: written.get(p.id) } : p))
        const own = saved.filter((p) => p.savedAt > 0).map(datedNotes)
        return { ...current, places: [...presets, ...own] }
      },
    },
  ),
)

/** Its latest note, or null. */
export const latestNote = (p: PlaceDef): PinNote | null => p.notes?.[p.notes.length - 1] ?? null

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
