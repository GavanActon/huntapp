import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/** A bottom sheet. The stack holds one at a time in the common case; a
 *  sheet pushed on top of another (Scoring over Dig in, Map buttons over
 *  Settings) gets a `‹ Back` that pops it. */
export type Sheet =
  | { kind: 'digin'; lon: number; lat: number }
  | { kind: 'scoring'; lon: number; lat: number }
  | { kind: 'pins' }
  | { kind: 'huntlog' }
  | { kind: 'settings' }
  | { kind: 'buttons' }
  | { kind: 'offline' }
  | { kind: 'layers' }
export type SheetKind = Sheet['kind']

/** Each sheet's half-open height, % of the screen. */
export const SHEET_HALF_PCT: Record<SheetKind, number> = {
  digin: 58,
  scoring: 72,
  pins: 46,
  huntlog: 44,
  settings: 72,
  buttons: 66,
  offline: 60,
  layers: 80,
}

/** The sheet showing now: the top of the stack, or null when closed. */
export const topSheet = (s: AppState): Sheet | null => s.sheets[s.sheets.length - 1] ?? null

/** A card in the live card's slot at the top of the screen: Your scent, or
 *  an outing from the Hunt log. The columns stay under it. */
export type TopCard = { kind: 'scent' } | { kind: 'outing'; id: string }

/** The buttons either column can hold, picked in Map buttons. My location
 *  is not one of them: it is always at the foot of the near column. */
export type HotId = 'windcheck' | 'scent' | 'heard' | 'windflow' | 'routes' | 'measure' | 'heat' | 'person' | 'pin' | 'understory' | 'lanes' | 'bathy' | 'radar' | 'lowPower'
export const HOT_MAX = 4
/** The two columns: `near` is the thumb's side (right, or left for a left hand), `far` the other. */
export type HotSide = 'near' | 'far'
export type HotSets = Record<HotSide, HotId[]>
export const DEFAULT_HOT: Record<'hunt' | 'fish', HotSets> = {
  hunt: { near: ['windcheck', 'scent', 'heard', 'windflow'], far: ['routes', 'measure', 'heat'] },
  fish: { near: ['pin', 'bathy', 'windflow'], far: ['routes', 'measure', 'heat'] },
}
const HOT_IDS: readonly HotId[] = ['windcheck', 'scent', 'heard', 'windflow', 'routes', 'measure', 'heat', 'person', 'pin', 'understory', 'lanes', 'bathy', 'radar', 'lowPower']

/** Known ids only, each once, at most HOT_MAX. */
function cleanHot(ids: readonly unknown[]): HotId[] {
  const out: HotId[] = []
  for (const id of ids) {
    if (!HOT_IDS.includes(id as HotId) || out.includes(id as HotId)) continue
    out.push(id as HotId)
    if (out.length >= HOT_MAX) break
  }
  return out
}

/** Every map layer the Layers sheet can switch. Keys match the style's
 *  layer ids (see map/mapStyle.ts). */
export interface LayerVisibility {
  topo: boolean
  hillshade: boolean
  /** Elevation colours from the DEM (green low ground to pale ridges), lakes as water. */
  relief: boolean
  /** 1 m LiDAR contour lines near camp; the interval is a setting. */
  contours: boolean
  forest: boolean
  /** Bush thickness near camp: the 0.5–3 m layer from the 2021 LiDAR point cloud. */
  understory: boolean
  /** The same drawn for a bow: open ground clear, thick bush shaded dark (the Bow view). */
  lanes: boolean
  bathy: boolean
  historical: boolean
  satellite: boolean
  camps: boolean
  wmu: boolean
  crown: boolean
  parks: boolean
  fire: boolean
  roads: boolean
  weather: boolean
  /** Wind made visible: particles advected by the HRDPS field at the planning time. */
  windFlow: boolean
}

export interface LayerOpacity {
  topo: number
  hillshade: number
  relief: number
  forest: number
  understory: number
  lanes: number
  historical: number
  satellite: number
}

/** A fresh phone shows the Scout view (viewsStore BUILT_IN[0]): imagery,
 *  contours, forest cover, burns and bush roads, with the wind flowing. */
export const DEFAULT_LAYERS: LayerVisibility = {
  topo: false,
  hillshade: false,
  relief: false,
  contours: true,
  forest: true,
  understory: false,
  lanes: false,
  bathy: false,
  historical: false,
  satellite: true,
  camps: false,
  wmu: false,
  crown: false,
  parks: false,
  fire: true,
  roads: true,
  weather: false,
  windFlow: true,
}

/** What the layers were before v3, for the migration: a phone still holding
 *  these untouched takes the Scout view instead. */
const LAYERS_V2: Partial<LayerVisibility> = { topo: true, contours: true, bathy: true, satellite: true }

export const DEFAULT_OPACITY: LayerOpacity = {
  topo: 1,
  hillshade: 0.6,
  relief: 0.9,
  forest: 0.55,
  understory: 0.7,
  lanes: 0.9,
  historical: 0.8,
  satellite: 0.8,
}

/** The wind layer's knobs (the boat app's, minus the sea). Persisted. */
export interface FlowTuning {
  windDensity: number // particle count, 200–2500
  windSpeed: number // multiplier on advection speed, 0.3–3
  windTrail: number // per-frame fade 0.86–0.97, higher = longer streaks
  windHue: number // stroke hue, degrees
  windSat: number // stroke saturation %
  windSize: SizeStop // streak width: auto follows the text size
}
export const FLOW_TUNING_DEFAULTS: FlowTuning = { windDensity: 2500, windSpeed: 1, windTrail: 0.97, windHue: 195, windSat: 100, windSize: 'auto' }

/** A size setting's stops, the text's and the wind streaks': auto follows the phone (text) or the text (wind). */
export type SizeStop = 'auto' | 'standard' | 'large' | 'larger'

/** Contour interval choices for the LiDAR lines, metres. */
export const CONTOUR_INTERVALS = [1, 2, 5, 10] as const
export type ContourInterval = (typeof CONTOUR_INTERVALS)[number]

export interface AppState {
  /** the bottom sheets, bottom first; [] = closed (not persisted) */
  sheets: Sheet[]
  /** replace the stack with one sheet */
  openSheet: (s: Sheet) => void
  /** open a sheet over the current one (it gets a ‹ Back) */
  pushSheet: (s: Sheet) => void
  /** drop the top sheet */
  popSheet: () => void
  closeSheet: () => void
  /** the card in the live card's slot, if any (not persisted) */
  topCard: TopCard | null
  setTopCard: (c: TopCard | null) => void

  /** the weather strip open (day and hour rows) or folded to one line; persisted */
  stripOpen: boolean
  setStripOpen: (v: boolean) => void
  /** the live card folded to a chip; session only */
  liveFolded: boolean
  setLiveFolded: (v: boolean) => void
  /** the view pill's menu up (the hot column hides under it); session only */
  viewMenuOpen: boolean
  setViewMenuOpen: (v: boolean) => void
  /** both columns' buttons per mode, up to HOT_MAX each; persisted */
  hotButtons: Record<'hunt' | 'fish', HotSets>
  setHotButtons: (mode: 'hunt' | 'fish', side: HotSide, ids: HotId[]) => void
  /** the near column and the view pill swap sides for a left hand; persisted */
  leftHanded: boolean
  setLeftHanded: (v: boolean) => void

  layers: LayerVisibility
  setLayer: (k: keyof LayerVisibility, v: boolean) => void
  opacity: LayerOpacity
  setOpacity: (k: keyof LayerOpacity, v: number) => void
  /** colour saturation per raster layer, -1..1 (0 as shot); persisted */
  saturation: Partial<Record<keyof LayerOpacity, number>>
  setSaturation: (k: keyof LayerOpacity, v: number) => void
  /** layers starred to the top of Edit this view; persisted */
  starred: (keyof LayerVisibility)[]
  toggleStar: (k: keyof LayerVisibility) => void
  /** Which historical map year to show, when more than one is available. */
  historicalYear: number | null
  setHistoricalYear: (y: number | null) => void
  /** Metres between LiDAR contour lines (the bake holds every metre). */
  contourInterval: ContourInterval
  setContourInterval: (m: ContourInterval) => void

  units: 'metric' | 'imperial'
  setUnits: (u: 'metric' | 'imperial') => void
  /** Walking pace for the ruler's time estimate, km/h. */
  paceKmh: number
  setPaceKmh: (v: number) => void
  windFlowOpacity: number
  setWindFlowOpacity: (v: number) => void
  flowTuning: FlowTuning
  setFlowTuning: (t: Partial<FlowTuning>) => void
  /** Which wind the flow layer draws: the ground model at head height, or HRDPS at 10 m. */
  windLevel: 'ground' | 'forecast'
  setWindLevel: (v: 'ground' | 'forecast') => void
  /** Stills the wind for a long day on one battery. */
  lowPower: boolean
  setLowPower: (v: boolean) => void
  textSize: SizeStop
  setTextSize: (v: SizeStop) => void
  /** The app-wide planning time (ms) picked on the strip; null = now. */
  planTimeMs: number | null
  setPlanTime: (ms: number | null) => void

  follow: boolean
  setFollow: (v: boolean) => void
  online: boolean
  setOnline: (v: boolean) => void
  offlineReady: boolean
  setOfflineReady: (v: boolean) => void
  missingData: string[]
  setMissingData: (names: string[]) => void
  onboarded: boolean
  setOnboarded: (v: boolean) => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      sheets: [],
      openSheet: (s) => set({ sheets: [s] }),
      pushSheet: (s) => set((st) => ({ sheets: [...st.sheets, s] })),
      popSheet: () => set((st) => ({ sheets: st.sheets.slice(0, -1) })),
      closeSheet: () => set({ sheets: [] }),
      topCard: null,
      setTopCard: (topCard) => set({ topCard }),

      stripOpen: false,
      setStripOpen: (stripOpen) => set({ stripOpen }),
      liveFolded: false,
      setLiveFolded: (liveFolded) => set({ liveFolded }),
      viewMenuOpen: false,
      setViewMenuOpen: (viewMenuOpen) => set({ viewMenuOpen }),
      hotButtons: DEFAULT_HOT,
      setHotButtons: (mode, side, ids) => set((st) => ({ hotButtons: { ...st.hotButtons, [mode]: { ...st.hotButtons[mode], [side]: cleanHot(ids) } } })),
      leftHanded: false,
      setLeftHanded: (leftHanded) => set({ leftHanded }),

      layers: DEFAULT_LAYERS,
      setLayer: (k, v) => set((s) => ({ layers: { ...s.layers, [k]: v } })),
      opacity: DEFAULT_OPACITY,
      setOpacity: (k, v) => set((s) => ({ opacity: { ...s.opacity, [k]: v } })),
      saturation: {},
      setSaturation: (k, v) => set((s) => ({ saturation: { ...s.saturation, [k]: v } })),
      starred: [],
      toggleStar: (k) => set((s) => ({ starred: s.starred.includes(k) ? s.starred.filter((x) => x !== k) : [...s.starred, k] })),
      historicalYear: null,
      setHistoricalYear: (historicalYear) => set({ historicalYear }),
      contourInterval: 5,
      setContourInterval: (contourInterval) => set({ contourInterval }),

      units: 'metric',
      setUnits: (units) => set({ units }),
      paceKmh: 4,
      setPaceKmh: (paceKmh) => set({ paceKmh }),
      windFlowOpacity: 1,
      setWindFlowOpacity: (windFlowOpacity) => set({ windFlowOpacity }),
      flowTuning: FLOW_TUNING_DEFAULTS,
      setFlowTuning: (t) => set((s) => ({ flowTuning: { ...s.flowTuning, ...t } })),
      windLevel: 'ground',
      setWindLevel: (windLevel) => set({ windLevel }),
      lowPower: false,
      setLowPower: (lowPower) => set({ lowPower }),
      textSize: 'auto',
      setTextSize: (textSize) => set({ textSize }),
      planTimeMs: null,
      setPlanTime: (planTimeMs) => set({ planTimeMs }),

      follow: false,
      setFollow: (follow) => set({ follow }),
      online: navigator.onLine,
      setOnline: (online) => set({ online }),
      offlineReady: false,
      setOfflineReady: (offlineReady) => set({ offlineReady }),
      missingData: [],
      setMissingData: (missingData) => set({ missingData }),
      onboarded: false,
      setOnboarded: (onboarded) => set({ onboarded }),
    }),
    {
      name: 'huntapp',
      // v1: the wind's strength, particles and trail default to full; a
      // phone still holding the old defaults takes the new ones once
      // v2: the strip is always on (its fold is stripOpen); the old on/off switch goes
      // v3: the default layers are the Scout view's; the old defaults, never touched, become them
      // v4: two button columns (near and far), Wind flow, Routes and Measure among them; the one-column sets go
      // v5: the wind flow sits just above My location; the v4 defaults are replaced
      version: 5,
      migrate: (persisted, from) => {
        const p = (persisted ?? {}) as Partial<AppState>
        if (from < 1) {
          delete p.windFlowOpacity
          if (p.flowTuning) {
            const { windDensity: _d, windTrail: _t, ...rest } = p.flowTuning
            p.flowTuning = rest as FlowTuning
          }
        }
        if (from < 2) delete (p as { wxStrip?: boolean }).wxStrip
        if (from < 3 && p.layers) {
          const old = p.layers
          const untouched = (Object.keys(DEFAULT_LAYERS) as (keyof LayerVisibility)[]).every((k) => k === 'windFlow' || !!old[k] === !!LAYERS_V2[k])
          if (untouched) delete p.layers
        }
        if (from < 5) delete (p as { hotButtons?: unknown }).hotButtons
        return p as AppState
      },
      partialize: (s) => ({
        layers: s.layers,
        opacity: s.opacity,
        saturation: s.saturation,
        starred: s.starred,
        historicalYear: s.historicalYear,
        contourInterval: s.contourInterval,
        units: s.units,
        paceKmh: s.paceKmh,
        windFlowOpacity: s.windFlowOpacity,
        flowTuning: s.flowTuning,
        windLevel: s.windLevel,
        lowPower: s.lowPower,
        textSize: s.textSize,
        stripOpen: s.stripOpen,
        hotButtons: s.hotButtons,
        leftHanded: s.leftHanded,
        onboarded: s.onboarded,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AppState>
        const hot = (p.hotButtons ?? {}) as Partial<Record<'hunt' | 'fish', Partial<Record<HotSide, unknown>>>>
        const pick = (v: unknown, d: HotId[]): HotId[] => (Array.isArray(v) ? cleanHot(v) : d)
        const sets = (m: 'hunt' | 'fish'): HotSets => ({ near: pick(hot[m]?.near, DEFAULT_HOT[m].near), far: pick(hot[m]?.far, DEFAULT_HOT[m].far) })
        return {
          ...current,
          ...p,
          layers: { ...DEFAULT_LAYERS, ...(p.layers ?? {}) },
          opacity: { ...DEFAULT_OPACITY, ...(p.opacity ?? {}) },
          saturation: { ...(p.saturation ?? {}) },
          starred: Array.isArray(p.starred) ? p.starred.filter((k): k is keyof LayerVisibility => typeof k === 'string' && k in DEFAULT_LAYERS) : [],
          flowTuning: { ...FLOW_TUNING_DEFAULTS, ...(p.flowTuning ?? {}) },
          hotButtons: { hunt: sets('hunt'), fish: sets('fish') },
        }
      },
    },
  ),
)
