import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * The scent model's knobs, for tuning in the field (Gavan, 2026-10-09:
 * "a dev parameter page for the scent so I can tune"). Each is a constant
 * of scent.ts or of the ground model's direction spread (model.ts) with
 * its modelled value, a range and a word on what it does. The values are
 * kept on the phone and read once per plume, so a change redraws the cone
 * at once and costs nothing per step. Settings → Scent tuning.
 */

export interface Knob {
  key: keyof TuneValues
  label: string
  /** what it does, in a few words */
  hint: string
  value: number
  min: number
  max: number
  step: number
  unit?: string
}

export interface TuneValues {
  // release
  releaseMin: number
  followMin: number
  burstS: number
  // spread (model.ts)
  calmSpread: number
  swirlSpread: number
  treesSpread: number
  checkTighten: number
  meander: number
  meanderS: number
  gustSize: number
  // mixing
  vertMix: number
  canopyMix: number
  trunkMix: number
  bushMix: number
  sunMix: number
  stableDepth: number
  tumbleMix: number
  // vegetation
  deposition: number
  bushTrap: number
  openShare: number
  // terrain and edges
  edgeLift: number
  edgeDrop: number
  sepSlope: number
  cavityBack: number
  bodyRise: number
  keepDrop: number
}

export const GROUPS: { name: string; knobs: Knob[] }[] = [
  {
    name: 'Release',
    knobs: [
      { key: 'releaseMin', label: 'Giving off scent', hint: 'how long the sit has been releasing; a stalk is a minute or two', value: 10, min: 1, max: 15, step: 1, unit: ' min' },
      { key: 'followMin', label: 'Followed for', hint: 'how long each puff is tracked', value: 15, min: 5, max: 30, step: 1, unit: ' min' },
      { key: 'burstS', label: 'Gust burst', hint: 'how long a gust lasts in a gusty hour', value: 15, min: 5, max: 60, step: 5, unit: ' s' },
    ],
  },
  {
    name: 'Spread',
    knobs: [
      { key: 'calmSpread', label: 'Near-calm spread', hint: 'how far the direction opens as the wind dies below 2 km/h; 0 keeps the drift', value: 70, min: 0, max: 90, step: 5, unit: '°' },
      { key: 'swirlSpread', label: 'Swirl spread', hint: 'behind a tree line, in a small opening, a slot across the wind', value: 40, min: 0, max: 60, step: 5, unit: '°' },
      { key: 'treesSpread', label: 'Under trees', hint: 'extra spread inside a stand', value: 8, min: 0, max: 30, step: 2, unit: '°' },
      { key: 'checkTighten', label: 'A fresh puff tightens it to', hint: 'the spread as a share of itself when nearby checks agree; lower trusts the puff more', value: 0.75, min: 0.2, max: 1, step: 0.05, unit: '×' },
      { key: 'meander', label: 'Meander', hint: 'how much of the spread the whole plume wanders through over the sit', value: 0.8, min: 0, max: 1.5, step: 0.1, unit: '×' },
      { key: 'meanderS', label: 'Meander time', hint: 'how slowly the plume wanders', value: 150, min: 30, max: 600, step: 30, unit: ' s' },
      { key: 'gustSize', label: 'Gust size', hint: 'the turbulent kicks on each puff', value: 1, min: 0.3, max: 2, step: 0.1, unit: '×' },
    ],
  },
  {
    name: 'Mixing upward',
    knobs: [
      { key: 'vertMix', label: 'Vertical mixing', hint: 'how fast a puff thins upward; more is a shorter cone at nose height', value: 1, min: 0.3, max: 3, step: 0.1, unit: '×' },
      { key: 'canopyMix', label: 'Canopy mixing', hint: 'extra mixing per unit of closure up at the canopy top, where its sweeps are', value: 1.4, min: 0, max: 3, step: 0.1 },
      { key: 'trunkMix', label: 'Trunk space', hint: "the share of the canopy's mixing that reaches the floor by day; none on a still night", value: 0.25, min: 0, max: 1, step: 0.05, unit: '×' },
      { key: 'bushMix', label: 'Bush mixing', hint: 'extra mixing per unit of bush thickness', value: 0.3, min: 0, max: 1, step: 0.05 },
      { key: 'sunMix', label: 'Sun on open ground', hint: 'extra mixing by day over open ground (and less under trees)', value: 0.5, min: 0, max: 1, step: 0.05 },
      { key: 'stableDepth', label: 'Stable layer depth', hint: 'the settled air on a still night, 5–30 m as modelled; the scent stays in it', value: 1, min: 0.3, max: 2, step: 0.1, unit: '×' },
      { key: 'tumbleMix', label: 'Tumble mixes it up', hint: 'in a lee eddy or a swirl behind trees the scent thins upward faster too; 0 spreads it sideways only', value: 1, min: 0, max: 2, step: 0.1, unit: '×' },
    ],
  },
  {
    name: 'Vegetation',
    knobs: [
      { key: 'deposition', label: 'Deposition', hint: 'what needles, leaves and bush take out of the air; 0 is none', value: 1, min: 0, max: 5, step: 0.25, unit: '×' },
      { key: 'bushTrap', label: 'Bush holds the nose wind', hint: 'how much a wall of bush slows the air at nose height, 0 none to 1 stopped', value: 0.6, min: 0, max: 1, step: 0.05 },
      { key: 'openShare', label: 'Open ground, 2–10 m', hint: 'the share of the 10 m wind at the top of the layer over open ground', value: 0.85, min: 0.3, max: 1, step: 0.05, unit: '×' },
    ],
  },
  {
    name: 'Terrain and edges',
    knobs: [
      { key: 'edgeLift', label: 'Lift at a tree line', hint: 'how far up the canopy the puff rides at a windward edge, as a share of the stand height', value: 0.67, min: 0, max: 1, step: 0.05, unit: '×h' },
      { key: 'edgeDrop', label: 'Edge when the wind falls to', hint: 'the head wind as a share of what the puff had, below which it is an edge', value: 0.6, min: 0.2, max: 0.9, step: 0.05, unit: '×' },
      { key: 'sepSlope', label: 'Separation slope', hint: 'a lee face steeper than this is passed over by day; 0.3 is 17°', value: 0.3, min: 0.1, max: 0.6, step: 0.05 },
      { key: 'cavityBack', label: 'Back-flow under a bank', hint: 'the low air under a bank upwind runs back toward it at this share of the wind', value: 0.25, min: 0, max: 0.6, step: 0.05, unit: '×' },
      { key: 'bodyRise', label: 'Body lift in cold calm', hint: 'how high your own warmth lifts the scent in cold calm air', value: 2, min: 0, max: 5, step: 0.5, unit: ' m' },
      { key: 'keepDrop', label: 'Keep the drop in still air', hint: 'on a stable night how much of a drop in the ground the puff keeps as height', value: 1, min: 0, max: 1, step: 0.1, unit: '×' },
    ],
  },
]

export const DEFAULTS: TuneValues = Object.fromEntries(GROUPS.flatMap((g) => g.knobs.map((k) => [k.key, k.value]))) as unknown as TuneValues

interface TuneState {
  values: Partial<TuneValues>
  set: (key: keyof TuneValues, v: number) => void
  clear: (key: keyof TuneValues) => void
  reset: () => void
}

export const useScentTune = create<TuneState>()(
  persist(
    (set) => ({
      values: {},
      set: (key, v) => set((s) => ({ values: { ...s.values, [key]: v } })),
      clear: (key) =>
        set((s) => {
          const values = { ...s.values }
          delete values[key]
          return { values }
        }),
      reset: () => set({ values: {} }),
    }),
    {
      name: 'huntapp-scent-tune',
      // v1 (2026-10-09): canopy mixing is the canopy top's now, the floor's its own knob, so an old setting is dropped
      version: 1,
      migrate: (p, from) => {
        const s = (p ?? { values: {} }) as { values: Partial<TuneValues> }
        if (from < 1 && s.values) delete s.values.canopyMix
        return s as never
      },
    },
  ),
)

/** The knobs as they stand: the modelled values with the phone's changes over them. */
export function tuneValues(): TuneValues {
  return { ...DEFAULTS, ...useScentTune.getState().values }
}

/** How many knobs are off their modelled value. */
export function tunedCount(): number {
  const v = useScentTune.getState().values
  return Object.keys(v).filter((k) => v[k as keyof TuneValues] !== DEFAULTS[k as keyof TuneValues]).length
}
