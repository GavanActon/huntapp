import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type SheetTab = 'places' | 'spots' | 'layers' | 'weather' | 'settings'

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

export const DEFAULT_LAYERS: LayerVisibility = {
  topo: true,
  hillshade: false,
  relief: false,
  contours: true,
  forest: false,
  understory: false,
  lanes: false,
  bathy: true,
  historical: false,
  satellite: true,
  camps: false,
  wmu: false,
  crown: false,
  parks: false,
  fire: false,
  roads: false,
  weather: false,
  windFlow: true,
}

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
}
export const FLOW_TUNING_DEFAULTS: FlowTuning = { windDensity: 2500, windSpeed: 1, windTrail: 0.97, windHue: 195, windSat: 100 }

/** Contour interval choices for the LiDAR lines, metres. */
export const CONTOUR_INTERVALS = [1, 2, 5, 10] as const
export type ContourInterval = (typeof CONTOUR_INTERVALS)[number]

interface AppState {
  sheetTab: SheetTab | null
  setSheetTab: (t: SheetTab | null) => void
  sheetTall: boolean
  setSheetTall: (v: boolean) => void

  layers: LayerVisibility
  setLayer: (k: keyof LayerVisibility, v: boolean) => void
  opacity: LayerOpacity
  setOpacity: (k: keyof LayerOpacity, v: number) => void
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
  textSize: 'auto' | 'standard' | 'large' | 'larger'
  setTextSize: (v: 'auto' | 'standard' | 'large' | 'larger') => void
  wxStrip: boolean
  setWxStrip: (v: boolean) => void
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
      sheetTab: null,
      setSheetTab: (sheetTab) => set({ sheetTab }),
      sheetTall: false,
      setSheetTall: (sheetTall) => set({ sheetTall }),

      layers: DEFAULT_LAYERS,
      setLayer: (k, v) => set((s) => ({ layers: { ...s.layers, [k]: v } })),
      opacity: DEFAULT_OPACITY,
      setOpacity: (k, v) => set((s) => ({ opacity: { ...s.opacity, [k]: v } })),
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
      wxStrip: true,
      setWxStrip: (wxStrip) => set({ wxStrip }),
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
      version: 1,
      migrate: (persisted, from) => {
        const p = (persisted ?? {}) as Partial<AppState>
        if (from < 1) {
          delete p.windFlowOpacity
          if (p.flowTuning) {
            const { windDensity: _d, windTrail: _t, ...rest } = p.flowTuning
            p.flowTuning = rest as FlowTuning
          }
        }
        return p as AppState
      },
      partialize: (s) => ({
        layers: s.layers,
        opacity: s.opacity,
        historicalYear: s.historicalYear,
        contourInterval: s.contourInterval,
        units: s.units,
        paceKmh: s.paceKmh,
        windFlowOpacity: s.windFlowOpacity,
        flowTuning: s.flowTuning,
        windLevel: s.windLevel,
        lowPower: s.lowPower,
        textSize: s.textSize,
        wxStrip: s.wxStrip,
        onboarded: s.onboarded,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AppState>
        return {
          ...current,
          ...p,
          layers: { ...DEFAULT_LAYERS, ...(p.layers ?? {}) },
          opacity: { ...DEFAULT_OPACITY, ...(p.opacity ?? {}) },
          flowTuning: { ...FLOW_TUNING_DEFAULTS, ...(p.flowTuning ?? {}) },
        }
      },
    },
  ),
)
