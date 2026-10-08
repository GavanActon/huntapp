import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Habitat } from '../spots/habitatGrid'
import type { HuntTarget } from '../spots/types'
import { revealMark } from '../state/appStore'

/**
 * The hunt log: what the hunter actually saw, heard or found, and the
 * sits where nothing came, with the weather and the model's own map saved
 * beside each at the moment it was logged. It does two jobs, like the wind
 * checks:
 *
 *   - it pulls the Spots heat toward fresh sign: an animal seen is an
 *     animal that lives there this week (a rutting bull's range is a few
 *     km², and a cow group stays put for days), so cells near a sighting
 *     are nudged up for a couple of weeks, and a blank sit nudges its
 *     immediate surroundings down a little for a few days;
 *   - it scores the model: where each sighting fell on the model's map, as
 *     a percentile of the cells around it. Over a season that says whether
 *     the heat map beats chance (50) at finding moose here.
 *
 * Kept on the phone (localStorage), like the wind checks.
 */

export type LogSpecies = HuntTarget | 'wolf' | 'other'
export type LogWhat = 'seen' | 'heard' | 'sign' | 'called' | 'nothing'
export type MooseKind = 'bull' | 'cow' | 'calf'

export const SPECIES_NAMES: Record<LogSpecies, string> = { moose: 'Moose', deer: 'Deer', bear: 'Bear', grouse: 'Grouse', wolf: 'Wolf', other: 'Other' }
export const WHAT_NAMES: Record<LogWhat, string> = { seen: 'Seen', heard: 'Heard', sign: 'Sign', called: 'Called in', nothing: 'Nothing' }
export const WHAT_DESC: Record<LogWhat, string> = {
  seen: 'Saw the animal',
  heard: 'Heard it: a grunt, a cow call, a crash in the bush',
  sign: 'Fresh tracks, rubs, beds, droppings or browse',
  called: 'Came to the call',
  nothing: 'Sat or called here and nothing came',
}

/** What was heard (or seen) of a moose out hunting, from where you stood (HeardCard). */
export type MooseSound = 'cow' | 'bull' | 'thrash' | 'walk' | 'splash' | 'seen'
/** The same for any game: a moose's sounds, then the others' (the Game card). */
export type GameSound = MooseSound | 'grunt' | 'snort' | 'rattle' | 'drum' | 'flush' | 'howl' | 'heard'
export const SOUND_NAMES: Record<GameSound, string> = {
  cow: 'Cow call',
  bull: 'Bull grunt',
  thrash: 'Thrashing',
  walk: 'Walking',
  splash: 'Splash',
  seen: 'Saw it',
  grunt: 'Buck grunt',
  snort: 'Snort',
  rattle: 'Rattling',
  drum: 'Drumming',
  flush: 'Flush',
  howl: 'Howling',
  heard: 'Heard it',
}
export const SOUND_DESC: Record<GameSound, string> = {
  cow: 'A cow calling',
  bull: 'A bull grunting',
  thrash: 'Antlers on brush, a tree being raked',
  walk: 'Snaps and footfalls, something big coming through',
  splash: 'In the water',
  seen: 'Saw it, out glassing or close',
  grunt: 'A buck grunting',
  snort: 'A deer blowing at you',
  rattle: 'Antlers clashing',
  drum: 'A ruffed grouse drumming',
  flush: 'Birds going up',
  howl: 'Wolves howling',
  heard: 'Heard it',
}
/** What each animal is heard (or seen) doing, in the Game card's order. */
export const SPECIES_SOUNDS: Record<LogSpecies, GameSound[]> = {
  moose: ['cow', 'bull', 'thrash', 'walk', 'splash', 'seen'],
  deer: ['grunt', 'snort', 'rattle', 'walk', 'seen'],
  bear: ['walk', 'heard', 'seen'],
  grouse: ['drum', 'flush', 'seen'],
  wolf: ['howl', 'seen'],
  other: ['heard', 'seen'],
}

/** The weather when it was logged. */
export interface LogWeather {
  tempC: number
  windKmh: number
  /** blowing FROM */
  windDir: number
  cloudPct: number
  precipMmH: number
  dayHigh: number | null
  warmRun: number
}

/** Where the spot sat on the model's map for that species, at that moment. */
export interface LogModel {
  score: number
  /** share of scored cells within 3 km below this one, 0..1 */
  percentile: number
  /** the day's verdict */
  activity: number
  headline: string
}

export interface LogEntry {
  id: string
  ts: number
  lon: number
  lat: number
  species: LogSpecies
  what: LogWhat
  count?: number
  kind?: MooseKind
  /** out hunting: which sound it was (or 'seen') */
  sound?: GameSound
  /** placed from where you stood: your spot, the bearing to it (true) and the rough distance, m */
  from?: { lon: number; lat: number; bearing: number; distM: number }
  note?: string
  wx?: LogWeather
  model?: LogModel
  /** a party member's (party/party.ts): their initials, and their id in the party */
  by?: string
  member?: string
  /** taken in from the party: theirs, kept as they send it */
  taken?: boolean
}

interface LogState {
  entries: LogEntry[]
  add: (e: Omit<LogEntry, 'id'>) => LogEntry
  update: (id: string, patch: Partial<LogEntry>) => void
  remove: (id: string) => void
  /** a party member's entries as they stand now: new ones in, changed ones replaced, never one of yours */
  takeIn: (es: LogEntry[]) => void
}

export const useHuntLog = create<LogState>()(
  persist(
    (set, get) => ({
      entries: [],
      add: (e) => {
        const entry = { ...e, id: `lg${e.ts.toString(36)}${Math.random().toString(36).slice(2, 6)}` }
        set((s) => ({ entries: [...s.entries, entry].slice(-2000) }))
        // logged with the game dots off, it would not show: they come on
        revealMark('game')
        return entry
      },
      update: (id, patch) => set((s) => ({ entries: s.entries.map((e) => (e.id === id ? { ...e, ...patch } : e)) })),
      remove: (id) => set((s) => ({ entries: s.entries.filter((e) => e.id !== id) })),
      takeIn: (es) => {
        const ok = es.filter((e) => e && typeof e.id === 'string' && Number.isFinite(e.ts) && Number.isFinite(e.lon) && Number.isFinite(e.lat))
        if (!ok.length) return
        const byId = new Map(get().entries.map((e) => [e.id, e]))
        for (const e of ok) {
          const had = byId.get(e.id)
          if (had && !had.taken) continue
          byId.set(e.id, { ...e, taken: true })
        }
        set({ entries: [...byId.values()].sort((a, b) => a.ts - b.ts).slice(-2000) })
      },
    }),
    { name: 'huntapp-log' },
  ),
)

// ---------------------------------------------------------------- the pull on the heat map

const DAY = 86_400_000
/** A sighting's pull: +25 % at the spot, e-folding 250 m and 7 days, gone past 800 m or 21 days. */
const SEEN = { gain: 0.25, rM: 250, maxM: 800, tD: 7, maxD: 21 }
/** A blank sit's push: −10 % at the spot, e-folding 150 m and 2 days, gone past 400 m or 5 days. */
const BLANK = { gain: -0.1, rM: 150, maxM: 400, tD: 2, maxD: 5 }

/** The log entries that bear on a target at a time: its own species, logged before then. */
function relevant(target: HuntTarget, atMs: number): LogEntry[] {
  return useHuntLog.getState().entries.filter((e) => e.species === target && e.ts <= atMs + 3600_000 && atMs - e.ts <= SEEN.maxD * DAY)
}

/**
 * The log's multiplier per cell for a target at a time (1 = no pull), or
 * null when nothing in the log bears on it. Pulls from several entries add.
 */
export function logBoostGrid(h: Habitat, target: HuntTarget, atMs: number): Float32Array | null {
  const es = relevant(target, atMs)
  if (!es.length) return null
  const out = new Float32Array(h.size).fill(1)
  const [cw, ch] = h.cellM
  for (const e of es) {
    const p = e.what === 'nothing' ? BLANK : SEEN
    const ageD = Math.max(0, (atMs - e.ts) / DAY)
    if (ageD > p.maxD) continue
    const i0 = h.index(e.lon, e.lat)
    if (i0 < 0) continue
    const [r0, c0] = h.rc(i0)
    const rr = Math.ceil(p.maxM / ch)
    const rc = Math.ceil(p.maxM / cw)
    const tf = Math.exp(-ageD / p.tD)
    for (let r = Math.max(0, r0 - rr); r <= Math.min(h.rows - 1, r0 + rr); r++)
      for (let c = Math.max(0, c0 - rc); c <= Math.min(h.cols - 1, c0 + rc); c++) {
        const d = Math.hypot((r - r0) * ch, (c - c0) * cw)
        if (d > p.maxM) continue
        out[r * h.cols + c] += p.gain * tf * Math.exp(-d / p.rM)
      }
  }
  for (let i = 0; i < out.length; i++) out[i] = Math.max(0.5, Math.min(1.6, out[i]))
  return out
}

/** The one line for a point's reasons: the nearest entry pulling on it. */
export function logNote(target: HuntTarget, lon: number, lat: number, atMs: number): string | null {
  const kx = 111_320 * Math.cos((lat * Math.PI) / 180)
  let best: { e: LogEntry; d: number } | null = null
  for (const e of relevant(target, atMs)) {
    const d = Math.hypot((e.lon - lon) * kx, (e.lat - lat) * 110_574)
    const p = e.what === 'nothing' ? BLANK : SEEN
    if (d <= p.maxM && (!best || d < best.d)) best = { e, d }
  }
  if (!best) return null
  const days = Math.round((atMs - best.e.ts) / DAY)
  const when = days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`
  const dist = best.d < 40 ? 'here' : `${Math.round(best.d / 10) * 10} m away`
  return best.e.what === 'nothing' ? `your blank sit ${dist}, ${when}` : `your ${SPECIES_NAMES[best.e.species].toLowerCase()} ${WHAT_NAMES[best.e.what].toLowerCase()} ${dist}, ${when}`
}

// ---------------------------------------------------------------- the model's report card

export interface Tally {
  species: LogSpecies
  /** sightings with a model call */
  n: number
  /** mean percentile of those sightings on the model's map, 0..100 */
  meanPct: number
  /** share of them in the model's top quarter */
  topQuarter: number
  blanks: number
}

/** How the model has done against the log, per species (positive entries only). */
export function tallies(entries: LogEntry[]): Tally[] {
  const by = new Map<LogSpecies, LogEntry[]>()
  for (const e of entries) by.set(e.species, [...(by.get(e.species) ?? []), e])
  const out: Tally[] = []
  for (const [species, es] of by) {
    const pos = es.filter((e) => e.what !== 'nothing' && e.model)
    const blanks = es.filter((e) => e.what === 'nothing').length
    if (!pos.length && !blanks) continue
    const meanPct = pos.length ? (100 * pos.reduce((a, e) => a + e.model!.percentile, 0)) / pos.length : NaN
    const topQuarter = pos.length ? pos.filter((e) => e.model!.percentile >= 0.75).length / pos.length : NaN
    out.push({ species, n: pos.length, meanPct, topQuarter, blanks })
  }
  return out.sort((a, b) => b.n - a.n)
}
