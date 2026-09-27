import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * Wind checks: what the hunter actually felt, with the model's own call
 * saved beside it. A puff of powder or a milkweed seed is the best
 * anemometer there is at head height in a bog, and each check does two
 * jobs: it corrects the ground model near it for the next hour or two
 * (model.ts blends it in by time and distance), and it scores the model,
 * so over a season the app can say how often it gets a stand right.
 *
 * Kept on the phone (localStorage); a camp weather station can later add
 * checks with source 'station'.
 */

export type Strength = 'calm' | 'drift' | 'light' | 'breezy' | 'windy'

/** What each word means at head height, km/h. */
export const STRENGTH_KMH: Record<Strength, number> = { calm: 0.3, drift: 1.5, light: 5, breezy: 12, windy: 22 }
export const STRENGTH_LABEL: Record<Strength, string> = {
  calm: 'Dead calm',
  drift: 'Drift: powder hangs, then creeps',
  light: 'Light: feel it on the face',
  breezy: 'Breezy: leaves moving',
  windy: 'Windy: branches moving',
}

export interface ModelCall {
  dirFrom: number
  kmh: number
  regime: string
  sigmaDeg: number
}

export interface WindCheck {
  id: string
  ts: number
  lon: number
  lat: number
  /** blowing FROM, degrees; null for calm */
  dirFrom: number | null
  strength: Strength
  note?: string
  source: 'hand' | 'station'
  /** what the ground model said at that place and minute, before the check */
  model?: ModelCall
}

interface ChecksState {
  checks: WindCheck[]
  add: (c: Omit<WindCheck, 'id'>) => WindCheck
  remove: (id: string) => void
  clear: () => void
}

export const useWindChecks = create<ChecksState>()(
  persist(
    (set) => ({
      checks: [],
      add: (c) => {
        const check = { ...c, id: `wc${c.ts.toString(36)}${Math.random().toString(36).slice(2, 6)}` }
        set((s) => ({ checks: [...s.checks, check].slice(-500) }))
        return check
      },
      remove: (id) => set((s) => ({ checks: s.checks.filter((c) => c.id !== id) })),
      clear: () => set({ checks: [] }),
    }),
    { name: 'huntapp-windchecks' },
  ),
)

export function angleDiff(a: number, b: number): number {
  return Math.abs((((a - b) % 360) + 540) % 360 - 180)
}

export function metresBetween(aLon: number, aLat: number, bLon: number, bLat: number): number {
  const kx = 111_320 * Math.cos((((aLat + bLat) / 2) * Math.PI) / 180)
  return Math.hypot((aLon - bLon) * kx, (aLat - bLat) * 110_574)
}

/** How far a check reaches: 40 min and 300 m e-folding, nothing past 2 h
 *  or 800 m. Returns the weight (0 = out of reach). */
export function checkWeight(c: WindCheck, lon: number, lat: number, ms: number): number {
  const dt = Math.abs(ms - c.ts)
  if (dt > 2 * 3600_000) return 0
  const d = metresBetween(lon, lat, c.lon, c.lat)
  if (d > 800) return 0
  return Math.exp(-dt / (40 * 60_000)) * Math.exp(-d / 300)
}

/** Did the model get it? Direction within 45° (or both calm-ish) is a hit,
 *  within 90° close, else a miss. */
export function verdict(c: WindCheck): 'agree' | 'close' | 'miss' | null {
  const m = c.model
  if (!m) return null
  const obsCalm = c.dirFrom == null || c.strength === 'calm'
  const modelCalm = m.kmh < 1
  if (obsCalm || modelCalm) return obsCalm === modelCalm ? 'agree' : m.kmh < 2.5 && c.strength !== 'breezy' && c.strength !== 'windy' ? 'close' : 'miss'
  const d = angleDiff(c.dirFrom!, m.dirFrom)
  return d <= 45 ? 'agree' : d <= 90 ? 'close' : 'miss'
}
