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

interface GpsState {
  status: GpsStatus
  fix: Fix | null
  /** Why the last attempt failed, in the browser's own words. "No GPS fix"
   *  is not a diagnosis; "location services are off" is. */
  lastError: string | null
  /** The locate button is on: the watch runs (and the track records) until it is tapped off. */
  locating: boolean
  setLocating: (v: boolean) => void
  /** The map turns with the phone's compass, so up is the way you face. */
  headingUp: boolean
  setHeadingUp: (v: boolean) => void
  /** Heading up and following: where the dot sits on the screen, css px
   *  from the map's middle ([0, 0] the middle). Left there by a drag or a
   *  pinch; the locate button puts it back (positionLayer.ts). */
  youAt: [number, number]
  setYouAt: (p: [number, number]) => void
  setStatus: (s: GpsStatus, lastError?: string | null) => void
  setFix: (f: Fix | null) => void
}

export const useGpsStore = create<GpsState>((set) => ({
  status: 'off',
  fix: null,
  lastError: null,
  locating: false,
  setLocating: (locating) => set({ locating }),
  headingUp: false,
  setHeadingUp: (headingUp) => set({ headingUp }),
  youAt: [0, 0],
  setYouAt: (youAt) => set({ youAt }),
  setStatus: (status, lastError) => set(lastError === undefined ? { status } : { status, lastError }),
  setFix: (fix) => set({ fix }),
}))

// dev-only handle, as with window.__map — the harness spoofs positions and
// needs to see whether the watch actually delivered them
if (import.meta.env.DEV) {
  ;(window as unknown as { __gps?: unknown }).__gps = useGpsStore
}
