import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { ACTIVE_AREA } from '../areas'

/**
 * Bush labels: the ground tapped on the sharp photo where it plainly is open,
 * low shrub, tall bush or a dense stand, to teach the bush model an area its
 * LiDAR plots never showed it. At Blanchard River the model called everything
 * open to light while the photo shows open meadow beside tall bush and dark
 * spruce belts (Gavan, 2026-10-09: "clearly open space vs tall bush. Can I
 * help at all?"). Hidden: the tool opens from a link with ?label=bush, and
 * the labels go up by hand (Send) for a code, as the dev log does.
 */

export type BushClass = 'open' | 'low' | 'tall' | 'dense'

export interface BushLabel {
  lon: number
  lat: number
  cls: BushClass
  area: string
  at: number
}

/** The classes, as the card lists them and the map colours them. */
export const BUSH_CLASSES: { id: BushClass; name: string; hint: string; colour: string }[] = [
  { id: 'open', name: 'Open', hint: 'meadow, gravel, grass', colour: '#f4e26b' },
  { id: 'low', name: 'Low shrub', hint: 'below the knee', colour: '#7ccf62' },
  { id: 'tall', name: 'Tall bush', hint: 'chest to head high', colour: '#ff8a3d' },
  { id: 'dense', name: 'Dense trees', hint: 'the dark stands', colour: '#d6304a' },
]

interface LabelState {
  /** the tool is up: the map's tap drops a label */
  active: boolean
  /** the class a tap drops */
  cls: BushClass
  labels: BushLabel[]
  setActive: (v: boolean) => void
  setCls: (c: BushClass) => void
  add: (lon: number, lat: number) => void
  undo: () => void
}

export const useBushLabels = create<LabelState>()(
  persist(
    (set, get) => ({
      active: false,
      cls: 'open',
      labels: [],
      setActive: (active) => set({ active }),
      setCls: (cls) => set({ cls }),
      add: (lon, lat) => set((s) => ({ labels: [...s.labels, { lon, lat, cls: get().cls, area: ACTIVE_AREA.id, at: Date.now() }] })),
      // the last label in this area
      undo: () =>
        set((s) => {
          const i = s.labels.map((l) => l.area).lastIndexOf(ACTIVE_AREA.id)
          return i < 0 ? s : { labels: s.labels.filter((_, k) => k !== i) }
        }),
    }),
    { name: 'huntapp-bushlabels', partialize: (s) => ({ cls: s.cls, labels: s.labels }) },
  ),
)

/** This area's labels. */
export function labelsHere(labels: BushLabel[] = useBushLabels.getState().labels): BushLabel[] {
  return labels.filter((l) => l.area === ACTIVE_AREA.id)
}

/** What Send uploads: a line to say what it is, then the labels as [class, lon, lat]. */
export function labelsText(labels: BushLabel[]): string {
  const head = `Huntapp bush labels · ${ACTIVE_AREA.id} · ${labels.length} labels · ${new Date().toISOString()}`
  return `${head}\n${JSON.stringify(labels.map((l) => [l.cls, +l.lon.toFixed(6), +l.lat.toFixed(6)]))}\n`
}
