import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { compass } from '../openMeteo'

/**
 * Wind checks: what the hunter actually felt, with the model's own call
 * saved beside it. A puff of powder or a milkweed seed is the best
 * anemometer there is at head height in a bog, and each check does two
 * jobs: it corrects the ground model near it for the next hour or two
 * (model.ts blends it in by time and distance), and it scores the model,
 * so over a season the app can say how often it gets a stand right.
 *
 * In breezy air the powder goes now one way, now another, so a check can
 * hold an arc instead of one direction: dirFrom is its middle and swingDeg
 * how wide it swung. The arrow on the map still points down the middle.
 *
 * A new check replaces the ones before it within SUPERSEDE_M: the air
 * there is what was felt last, and one arrow shows where you stand, not a
 * pile of them pointing every way. The old ones stay in the log, scored,
 * but stop counting (and drawing) from the moment the new one was made.
 *
 * Kept on the phone (localStorage); a camp weather station can later add
 * checks with source 'station'.
 *
 * A party's checks combine: each phone shares its checks as a file (the
 * Weather tab), the others take it in, and every check counts the same in
 * the blend, so where two people disagree the one with more checks nearby
 * carries it, and the model says so. Each check carries who made it (`by`,
 * the initials in Settings) so the tally can be read per person.
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
  /** blowing FROM, degrees; null for calm. A swinging check holds the middle of its arc. */
  dirFrom: number | null
  /** the powder went now one way, now another: the arc it swung through, 45–180° about dirFrom */
  swingDeg?: number
  strength: Strength
  note?: string
  /** who made it: the initials in Settings; a partner's checks keep theirs */
  by?: string
  source: 'hand' | 'station'
  /** what the ground model said at that place and minute, before the check */
  model?: ModelCall
  /** replaced by a newer check near it at this moment: it counts until then */
  until?: number
}

/** A newer check this close replaces an older one. */
export const SUPERSEDE_M = 100

interface ChecksState {
  checks: WindCheck[]
  add: (c: Omit<WindCheck, 'id'>) => WindCheck
  /** a partner's checks, by id: the ones already here are left alone */
  merge: (cs: WindCheck[]) => number
  remove: (id: string) => void
  clear: () => void
}

export const useWindChecks = create<ChecksState>()(
  persist(
    (set, get) => ({
      checks: [],
      add: (c) => {
        const check = { ...c, id: `wc${c.ts.toString(36)}${Math.random().toString(36).slice(2, 6)}` }
        // the earlier checks here stop counting now
        const replaced = (o: WindCheck) => o.until == null && o.ts <= c.ts && o.source === c.source && metresBetween(o.lon, o.lat, c.lon, c.lat) <= SUPERSEDE_M
        set((s) => ({ checks: [...s.checks.map((o) => (replaced(o) ? { ...o, until: c.ts } : o)), check].slice(-500) }))
        return check
      },
      merge: (cs) => {
        const have = new Set(get().checks.map((c) => c.id))
        const fresh = cs.filter((c) => c && typeof c.id === 'string' && !have.has(c.id) && Number.isFinite(c.ts) && Number.isFinite(c.lon) && Number.isFinite(c.lat))
        if (fresh.length) set((s) => ({ checks: [...s.checks, ...fresh].sort((a, b) => a.ts - b.ts).slice(-500) }))
        return fresh.length
      },
      remove: (id) => set((s) => ({ checks: s.checks.filter((c) => c.id !== id) })),
      clear: () => set({ checks: [] }),
    }),
    { name: 'huntapp-windchecks' },
  ),
)

/** The way the powder went, in compass points: "NW", or the two ends of the
 *  arc, "NW–N", for a check that swung. `toward` is the way it blows to. */
export function towardWords(toward: number, swingDeg?: number): string {
  if (!swingDeg) return compass(toward)
  return `${compass(toward - swingDeg / 2)}–${compass(toward + swingDeg / 2)}`
}

export function angleDiff(a: number, b: number): number {
  return Math.abs((((a - b) % 360) + 540) % 360 - 180)
}

export function metresBetween(aLon: number, aLat: number, bLon: number, bLat: number): number {
  const kx = 111_320 * Math.cos((((aLat + bLat) / 2) * Math.PI) / 180)
  return Math.hypot((aLon - bLon) * kx, (aLat - bLat) * 110_574)
}

const TAU_MS = 40 * 60_000
const LEN_M = 300
const MAX_MS = 2 * 3600_000
const MAX_M = 800

/** How far a check reaches: 40 min and 300 m e-folding, nothing past 2 h
 *  or 800 m. Returns the weight (0 = out of reach). */
export function checkWeight(c: WindCheck, lon: number, lat: number, ms: number): number {
  if (c.until != null && ms >= c.until) return 0
  const dt = Math.abs(ms - c.ts)
  if (dt > MAX_MS) return 0
  const d = metresBetween(lon, lat, c.lon, c.lat)
  if (d > MAX_M) return 0
  return Math.exp(-dt / TAU_MS) * Math.exp(-d / LEN_M)
}

/** A check's share of the ground wind at a spot and moment: model.ts
 *  averages the model's wind with each check at its weight w, so a check
 *  alone makes up w / (1 + w) of the answer (half, where and when it was made). */
export function checkPull(c: WindCheck, lon: number, lat: number, ms: number): number {
  const w = checkWeight(c, lon, lat, ms)
  return w / (1 + w)
}

/** Below this share of the wind a check is not worth drawing: it is "in effect" above it. */
export const PULL_SHOWN = 0.1
const W_SHOWN = PULL_SHOWN / (1 - PULL_SHOWN)

/** How far from the check it still makes up PULL_SHOWN of the wind at a moment, metres (0 = spent). */
export function checkReachM(c: WindCheck, ms: number): number {
  if (c.until != null && ms >= c.until) return 0
  const dt = Math.abs(ms - c.ts)
  if (dt > MAX_MS) return 0
  return Math.max(0, Math.min(MAX_M, LEN_M * (Math.log(1 / W_SHOWN) - dt / TAU_MS)))
}

/** When a check stops making up PULL_SHOWN of the wind even where it was made. */
export function checkSpentAt(c: WindCheck): number {
  return Math.min(c.until ?? Infinity, c.ts + Math.min(MAX_MS, TAU_MS * Math.log(1 / W_SHOWN)))
}

/** Did the model get it? Direction within 45° (or both calm-ish) is a hit,
 *  within 90° close, else a miss. A swinging check is judged on its arc:
 *  inside it (and half a sector past each end) is a hit, 45° more close. */
export function verdict(c: WindCheck): 'agree' | 'close' | 'miss' | null {
  const m = c.model
  if (!m) return null
  const obsCalm = c.dirFrom == null || c.strength === 'calm'
  const modelCalm = m.kmh < 1
  if (obsCalm || modelCalm) return obsCalm === modelCalm ? 'agree' : m.kmh < 2.5 && c.strength !== 'breezy' && c.strength !== 'windy' ? 'close' : 'miss'
  const d = angleDiff(c.dirFrom!, m.dirFrom)
  if (c.swingDeg) {
    const out = Math.max(0, d - c.swingDeg / 2)
    return out <= 22.5 ? 'agree' : out <= 67.5 ? 'close' : 'miss'
  }
  return d <= 45 ? 'agree' : d <= 90 ? 'close' : 'miss'
}

/** The check that makes up most of the ground wind at a spot and moment, if any counts for PULL_SHOWN. */
export function strongestCheck(checks: WindCheck[], lon: number, lat: number, ms: number): { check: WindCheck; pull: number } | null {
  let best: { check: WindCheck; pull: number } | null = null
  for (const c of checks) {
    const pull = checkPull(c, lon, lat, ms)
    if (pull >= PULL_SHOWN && (!best || pull > best.pull)) best = { check: c, pull }
  }
  return best
}
