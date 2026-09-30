import { create } from 'zustand'

export interface Fix {
  lon: number
  lat: number
  accuracy: number // metres, the phone's own figure
  /** the filter's spread, metres (fixFilter.ts); unset on a raw fix */
  sigma?: number
  sogKn: number | null // speed over ground, knots
  cog: number | null // course over ground, degrees true
  ts: number
}

// 'insecure' is its own answer, not a denial: browsers refuse geolocation
// outright on a plain-http origin that isn't localhost, and no amount of
// granting permission changes that
export type GpsStatus = 'off' | 'acquiring' | 'on' | 'denied' | 'error' | 'insecure'

/** Whether the screen is being kept on. 'refused' is what Low Power Mode
 *  does; 'unsupported' is an iOS before 16.4. */
export type WakeState = 'off' | 'on' | 'refused' | 'unsupported'

interface GpsState {
  status: GpsStatus
  fix: Fix | null
  /** Why the last attempt failed, in the browser's own words. "No GPS fix"
   *  is not a diagnosis; "location services are off" is. */
  lastError: string | null
  /** Fixes the gate refused this session — for the diagnostics report. */
  dropped: { coarse: number; stale: number; jump: number }
  setDropped: (d: { coarse: number; stale: number; jump: number }) => void
  wake: WakeState
  setWake: (w: WakeState) => void
  /** The locate button is on: the watch runs (and the track records) until it is tapped off. */
  locating: boolean
  setLocating: (v: boolean) => void
  /** The map turns with the phone's compass, so up is the way you face. */
  headingUp: boolean
  setHeadingUp: (v: boolean) => void
  setStatus: (s: GpsStatus, lastError?: string | null) => void
  setFix: (f: Fix | null) => void
}

export const useGpsStore = create<GpsState>((set) => ({
  status: 'off',
  fix: null,
  lastError: null,
  dropped: { coarse: 0, stale: 0, jump: 0 },
  setDropped: (dropped) => set({ dropped: { ...dropped } }),
  wake: 'off',
  setWake: (wake) => set({ wake }),
  locating: false,
  setLocating: (locating) => set({ locating }),
  headingUp: false,
  setHeadingUp: (headingUp) => set({ headingUp }),
  setStatus: (status, lastError) => set(lastError === undefined ? { status } : { status, lastError }),
  setFix: (fix) => set({ fix }),
}))

// dev-only handle, as with window.__map — the harness spoofs positions and
// needs to see whether the watch actually delivered them
if (import.meta.env.DEV) {
  ;(window as unknown as { __gps?: unknown }).__gps = useGpsStore
}
