import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { revealMark } from '../../state/appStore'
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
 * A second puff where you stand, minutes after the first, is the same
 * check watched longer, not a new one: it folds in (SERIES_M, SERIES_MS).
 * The folded check keeps every puff's direction, and from those comes the
 * arc and how steady the air is: puffs that go the same way say steady,
 * puffs every way say swirly, with no question asked. A check with one
 * puff can still say it swings, with a second arrow on the rose.
 *
 * Otherwise a new check is one more, and they add up (Gavan, 2026-10-08:
 * "multiple data points are additive"): every check near enough and
 * recent enough counts at its own weight, so two checks at a spot carry
 * more than one, the newest the most, and where they disagree the spread
 * opens (model.ts). An older one's arrow fades as its pull does. Until
 * that day a new check within 100 m retired the ones before it (`until`);
 * those stamps are kept for the log and no longer count.
 *
 * Two optional answers ride on a check. "Treetops moving, calm here" is
 * the ground air come loose from the wind above (decoupled), the one
 * thing the layering model most needs checking. "Same as a while ago" is
 * a wind that has held, so the check is trusted for longer.
 *
 * Kept on the phone (localStorage); a camp weather station can later add
 * checks with source 'station'. Shared, if the hunter says yes when
 * asked after the first check, so the model learns from everyone's
 * (checkShare.ts): without initials or notes, never to another hunter.
 *
 * A check can also be seen rather than felt: out glassing, the treetops
 * across a bog or the water of a lake far off show which way the wind
 * goes and how hard (Beaufort's own signs). That is the wind above the
 * trees, about the forecast's 10 m wind, not the head-height air the
 * powder shows, so it is kept apart (`seen`): it never blends in as the
 * floor's air, it turns and scales the forecast wind the ground model
 * starts from, over kilometres (seenWeight), and the model brings that
 * down through the land and the trees as ever. Its verdict is the
 * forecast's, never the model's, and it teaches the season's lessons
 * nothing (bias.ts learns from the model's call, which it does not keep).
 *
 * A party's checks combine: each phone shares its checks as a file (the
 * Weather tab), the others take it in, and every check counts the same in
 * the blend, so where two people disagree the one with more checks nearby
 * carries it, and the model says so. Each check carries who made it (`by`,
 * the initials in Settings) so the tally can be read per person.
 */

export type Strength = 'calm' | 'drift' | 'light' | 'breezy' | 'windy'

/** What each word means at head height, km/h: the middle of its range, for a single number. */
export const STRENGTH_KMH: Record<Strength, number> = { calm: 0.3, drift: 1.5, light: 5, breezy: 12, windy: 22 }
/**
 * What each word covers, km/h, a range not a number. The powder shows the
 * first second of travel and no more: it thins faster the harder it blows,
 * so how far it goes before it fades says little, and how far it gets in a
 * one-count says nearly everything. An arm's reach is about 0.75 m, a step
 * about the same, 10 ft is 3 m; 1 m/s is 3.6 km/h. So arm's reach in a
 * one-count is about 3 km/h, a stride 5–6, 10 ft 11, and past 10 ft in
 * a second the powder is simply gone: the top of the scale is open-ended
 * (windy is 13 and anything above). The fit of the air to the checks
 * (ambientFit.ts) scores the model's speed against the range, never the
 * middle, so a check at the top can pull but cannot pin.
 */
export const STRENGTH_RANGE: Record<Strength, [number, number]> = { calm: [0, 1], drift: [1, 2.5], light: [2.5, 6], breezy: [6, 13], windy: [13, Infinity] }
/** Each step in three, short and plain (Gavan, 2026-10-08): how far the
 *  powder gets in a second, what it looks like, what you feel (the face,
 *  the leaves, the branches: Beaufort 0–4 at head height in the bush). */
export const STRENGTH_CUE: Record<Strength, string> = {
  calm: 'Stays put · falls straight down · nothing on the face',
  drift: 'Within arm’s reach in 1 s · creeps along in a cloud · barely on the face',
  light: 'Arm’s reach in 1 s · thins out in a few feet · on the face, leaves rustle',
  breezy: '5–6 ft in 1 s · streams off, gone quick · pushes on the face, twigs move',
  windy: '10 ft or more in 1 s · snatched away · hat wants to go, branches sway',
}
export const STRENGTH_LABEL: Record<Strength, string> = {
  calm: 'Dead calm',
  drift: 'Drift: within arm’s reach in a second',
  light: 'Light: arm’s reach in a second',
  breezy: 'Breezy: 5–6 ft in a second',
  windy: 'Windy: 10 ft or more in a second',
}

/** What the treetops (or the water) far off showed: Beaufort's land and lake signs, read at a distance. */
export type Seen = 'still' | 'leaves' | 'branches' | 'sway' | 'bend'

/** Each sign as the 10 m wind it means, km/h (the middle of its Beaufort band; 'bend' is 6 and up). */
export const SEEN_KMH: Record<Seen, number> = { still: 3, leaves: 12, branches: 24, sway: 33, bend: 45 }
/** What to look for, in the trees and on the water. */
export const SEEN_CUE: Record<Seen, string> = {
  still: 'treetops still · water flat',
  leaves: 'leaves and twigs moving · ripples',
  branches: 'small branches moving · the first whitecaps',
  sway: 'small trees swaying · whitecaps all over',
  bend: 'big branches, whole trees moving',
}
export const SEEN_WORD: Record<Seen, string> = { still: 'still', leaves: 'leaves moving', branches: 'branches moving', sway: 'trees swaying', bend: 'trees bending' }
/** The felt word a seen check also carries, for a reader that knows no `seen` (an older phone in the party, the Worker's check). */
export const SEEN_STRENGTH: Record<Seen, Strength> = { still: 'calm', leaves: 'light', branches: 'breezy', sway: 'windy', bend: 'windy' }

export interface ModelCall {
  dirFrom: number
  kmh: number
  regime: string
  sigmaDeg: number
  /** the model had the ground air come loose from the wind above */
  decoupled?: boolean
  /** the cell was a slot in the trees: its own lesson, apart from the regime's */
  slot?: boolean
  /** the cell was in a stand: with plain wind, the canopy lesson */
  woods?: boolean
  /** the season's correction the call already carried (bias.ts), so the lesson is taken from the raw call */
  bias?: { deg: number; ratio: number }
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
  /** puffs folded into this check (1 or absent: a single puff) */
  puffs?: number
  /** each puff's direction, blowing FROM; null for a puff that hung (a lull) */
  dirs?: (number | null)[]
  /** optional: treetops moving while the air here is calm (true), or moving the same (false) */
  aloft?: boolean
  /** optional: the wind here has been the same for a while */
  held?: boolean
  /** seen from afar, not felt: what the treetops (or the water) there showed.
   *  The wind above the trees; `strength` then holds SEEN_STRENGTH's word. */
  seen?: Seen
  /** where it was seen from, when the phone had a fix */
  seenFrom?: { lon: number; lat: number }
  note?: string
  /** who made it: the initials in Settings; a partner's checks keep theirs */
  by?: string
  /** taken in from a partner (a file's merge, or the party's takeIn): theirs, so never shared from this phone (checkShare.ts) */
  taken?: boolean
  /** a party member's: their id in the party (party/party.ts) */
  member?: string
  source: 'hand' | 'station'
  /** what the ground model said at that place and minute, before the check */
  model?: ModelCall
  /** what the forecast said there and then: the 10 m wind the map draws,
   *  before the ground model brings it down. Scored like the model's call,
   *  so the log shows how far off a forecast is where you sit. */
  forecast?: { dirFrom: number; kmh: number }
  /** retired by a newer check near it, before checks added up (2026-10-08):
   *  kept for the log's replaced_at, no longer read */
  until?: number
}

/** A puff this close and this soon after the last one folds into it. */
export const SERIES_M = 40
export const SERIES_MS = 6 * 60_000

/** The arc a set of puff directions spans about their mean, degrees (0 for one). */
function puffSpread(dirs: number[]): { mean: number; arc: number } {
  if (!dirs.length) return { mean: 0, arc: 0 }
  let e = 0
  let n = 0
  for (const d of dirs) {
    e += Math.sin((d * Math.PI) / 180)
    n += Math.cos((d * Math.PI) / 180)
  }
  const mean = ((Math.atan2(e, n) * 180) / Math.PI + 360) % 360
  let worst = 0
  for (const d of dirs) worst = Math.max(worst, angleDiff(d, mean))
  return { mean, arc: worst * 2 }
}

/** A puff folded into the check it continues: the arc and the strength from every puff so far. */
function fold(prev: WindCheck, puff: Omit<WindCheck, 'id'>): WindCheck {
  const dirs = [...(prev.dirs ?? [prev.dirFrom]), puff.strength === 'calm' ? null : puff.dirFrom]
  const moving = dirs.filter((d): d is number => d != null)
  const { mean, arc } = puffSpread(moving)
  // the swing is the arc the puffs spanned, or what either puff said it swung
  const said = Math.max(prev.swingDeg ?? 0, puff.swingDeg ?? 0)
  const swing = Math.max(said, arc >= 20 ? Math.max(45, Math.round(arc)) : 0)
  // the wind is what moved the powder; a lull is a lull
  const strongest = [prev.strength, puff.strength].sort((a, b) => STRENGTH_KMH[b] - STRENGTH_KMH[a])[0]
  return {
    ...prev,
    dirFrom: moving.length ? Math.round(mean) : null,
    swingDeg: moving.length && swing ? Math.min(180, swing) : undefined,
    strength: moving.length ? strongest : 'calm',
    puffs: (prev.puffs ?? 1) + 1,
    dirs,
    ...(puff.aloft != null ? { aloft: puff.aloft } : {}),
    ...(puff.held != null ? { held: puff.held } : {}),
    ...(puff.note ? { note: prev.note ? `${prev.note} · ${puff.note}` : puff.note } : {}),
  }
}

export type Steadiness = 'steady' | 'wavering' | 'swirly'

/** How steady the air was through a check's puffs: null for a single puff that did not say. */
export function steadiness(c: WindCheck): Steadiness | null {
  const n = c.puffs ?? 1
  if (n < 2) return c.swingDeg ? (c.swingDeg >= 90 ? 'swirly' : 'wavering') : null
  const lulls = (c.dirs ?? []).filter((d) => d == null).length
  if (c.dirFrom == null) return 'steady'
  const arc = c.swingDeg ?? 0
  if (arc >= 90 || lulls * 2 >= n) return 'swirly'
  if (arc >= 45 || lulls) return 'wavering'
  return 'steady'
}

interface ChecksState {
  checks: WindCheck[]
  add: (c: Omit<WindCheck, 'id'>) => WindCheck
  /** a partner's checks, by id: the ones already here are left alone */
  merge: (cs: WindCheck[]) => number
  /** a party member's checks as they stand now (party/party.ts): new ones in, changed ones replaced, never one of yours */
  takeIn: (cs: WindCheck[]) => void
  remove: (id: string) => void
  /** a check saved as seen from afar that was a puff where it was made: felt from now on (the strength word stays) */
  setFelt: (id: string) => void
  clear: () => void
}

/** At most 500 kept: a party's checks go first, so a busy party never pushes out your own. */
const MAX_CHECKS = 500
function capped(cs: WindCheck[]): WindCheck[] {
  let over = cs.length - MAX_CHECKS
  if (over <= 0) return cs
  const out = cs.filter((c) => !(c.taken && over-- > 0))
  return out.slice(-MAX_CHECKS)
}

export const useWindChecks = create<ChecksState>()(
  persist(
    (set, get) => ({
      checks: [],
      add: (c) => {
        // another puff of the check just made here: the same check, watched longer
        // (a look at the treetops far off is one look: it never folds)
        const prev = c.source === 'hand' && !c.seen ? get().checks.find((o) => !o.taken && o.source === 'hand' && !o.seen && (o.by ?? '') === (c.by ?? '') && c.ts - o.ts >= 0 && c.ts - o.ts <= SERIES_MS && metresBetween(o.lon, o.lat, c.lon, c.lat) <= SERIES_M) : undefined
        if (prev) {
          const folded = fold(prev, c)
          set((s) => ({ checks: s.checks.map((o) => (o.id === prev.id ? folded : o)) }))
          revealMark('wind')
          return folded
        }
        // one more: the checks before it here keep counting beside it
        const check = { ...c, id: `wc${c.ts.toString(36)}${Math.random().toString(36).slice(2, 6)}` }
        set((s) => ({ checks: capped([...s.checks, check]) }))
        revealMark('wind')
        return check
      },
      merge: (cs) => {
        const have = new Set(get().checks.map((c) => c.id))
        const fresh = cs.filter((c) => c && typeof c.id === 'string' && !have.has(c.id) && Number.isFinite(c.ts) && Number.isFinite(c.lon) && Number.isFinite(c.lat))
        if (fresh.length) set((s) => ({ checks: capped([...s.checks, ...fresh.map((c) => ({ ...c, taken: true }))].sort((a, b) => a.ts - b.ts)) }))
        return fresh.length
      },
      takeIn: (cs) => {
        const ok = cs.filter((c) => c && typeof c.id === 'string' && Number.isFinite(c.ts) && Number.isFinite(c.lon) && Number.isFinite(c.lat))
        if (!ok.length) return
        const byId = new Map(get().checks.map((c) => [c.id, c]))
        for (const c of ok) {
          const had = byId.get(c.id)
          if (had && !had.taken) continue
          byId.set(c.id, { ...c, taken: true })
        }
        set({ checks: capped([...byId.values()].sort((a, b) => a.ts - b.ts)) })
      },
      remove: (id) => set((s) => ({ checks: s.checks.filter((c) => c.id !== id) })),
      setFelt: (id) =>
        set((s) => ({
          checks: s.checks.map((c) => {
            if (c.id !== id || !c.seen) return c
            const { seen: _seen, seenFrom: _from, ...rest } = c
            return rest
          }),
        })),
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

/** What a check found, in words: 'toward NE, light' | 'calm'; seen, in the
 *  treetops' words: 'treetops toward NE, branches moving' | 'treetops still'. */
export function checkFelt(c: WindCheck): string {
  const toward = c.dirFrom == null ? null : towardWords((c.dirFrom + 180) % 360, c.swingDeg)
  if (c.seen) return toward == null || c.seen === 'still' ? `treetops ${SEEN_WORD[c.seen]}` : `treetops toward ${toward}, ${SEEN_WORD[c.seen]}`
  return toward == null ? 'calm' : `toward ${toward}, ${c.strength}`
}

export function angleDiff(a: number, b: number): number {
  return Math.abs((((a - b) % 360) + 540) % 360 - 180)
}

export function metresBetween(aLon: number, aLat: number, bLon: number, bLat: number): number {
  const kx = 111_320 * Math.cos((((aLat + bLat) / 2) * Math.PI) / 180)
  return Math.hypot((aLon - bLon) * kx, (aLat - bLat) * 110_574)
}

/**
 * A felt check's reach, as the place's own correction. Since 2026-10-08 the
 * air above the trees is fitted to the sit's checks first (ambientFit.ts,
 * applied in model.ts), and the field everywhere moves with that; what is
 * left at each check is this place's, so its reach is shorter (150 m
 * e-folding) and stronger (W0 = 9: nine parts check to one part model
 * where and when it was made, 90%) and it holds longer (an hour's
 * e-folding, nothing past three), since a place effect lasts as long as
 * the regime does. model.ts also scales it by likeness: a check under the
 * trees corrects the trees first, a check in a slot the slots.
 */
const TAU_MS = 60 * 60_000
/** 100 m e-folding and nothing past 400 m (2026-10-09, Gavan: "the wind checks need to be more localized, right now it's a huge circle"): a puff speaks for the air round it, the sit's fit carries the rest */
const LEN_M = 100
const MAX_MS = 3 * 3600_000
const MAX_M = 400
/** a felt check's weight where and when it was made: nine, so it leads the ground wind there 90% */
const W0 = 9

/** A check's time scale: a wind that has held for a while is trusted twice as long. */
function tauOf(c: WindCheck): number {
  return c.held ? 2 * TAU_MS : TAU_MS
}
function maxOf(c: WindCheck): number {
  return c.held ? 1.5 * MAX_MS : MAX_MS
}

/** A seen check's reach: the wind above the trees is one air over kilometres
 *  (the forecast's own grid is 2.5 km), so 2.5 km e-folding and nothing past
 *  8 km, on the same clock as a felt check. Where and when it was made it
 *  weighs SEEN_W0: two thirds of the turn, the forecast the other third. */
const SEEN_LEN_M = 2500
const SEEN_MAX_M = 8000
const SEEN_W0 = 2

/** How far a felt check reaches as the place's own correction: W0 where
 *  and when it was made, an hour and 100 m e-folding, nothing past 3 h or
 *  400 m (2 h and 4.5 h for a wind that had held). Returns the weight
 *  (0 = out of reach). A seen check never blends in as head-height air: 0
 *  here, its weight is seenWeight's. */
export function checkWeight(c: WindCheck, lon: number, lat: number, ms: number): number {
  if (c.seen) return 0
  return W0 * reachWeight(c, lon, lat, ms, LEN_M, MAX_M)
}

/** A seen check's weight on the forecast wind at a spot and moment (0 = out of reach, or a felt check). */
export function seenWeight(c: WindCheck, lon: number, lat: number, ms: number): number {
  if (!c.seen) return 0
  return SEEN_W0 * reachWeight(c, lon, lat, ms, SEEN_LEN_M, SEEN_MAX_M)
}

function reachWeight(c: WindCheck, lon: number, lat: number, ms: number, len: number, max: number): number {
  const dt = Math.abs(ms - c.ts)
  if (dt > maxOf(c)) return 0
  const d = metresBetween(lon, lat, c.lon, c.lat)
  if (d > max) return 0
  return Math.exp(-dt / tauOf(c)) * Math.exp(-d / len)
}

/** A check's share of the ground wind at a spot and moment: model.ts
 *  averages the model's wind with each check at its weight w, so a check
 *  alone makes up w / (1 + w) of the answer (90%, where and when it was
 *  made). A seen check's share is of the wind above the trees there, the
 *  same way (two thirds where it was seen). */
export function checkPull(c: WindCheck, lon: number, lat: number, ms: number): number {
  const w = c.seen ? seenWeight(c, lon, lat, ms) : checkWeight(c, lon, lat, ms)
  return w / (1 + w)
}

/** Below this share of the wind a check is not worth drawing: it is "in effect" above it. */
export const PULL_SHOWN = 0.1
const W_SHOWN = PULL_SHOWN / (1 - PULL_SHOWN)

/** How far from the check it still makes up `share` of the wind at a moment, metres (0 = not even where it was made). */
export function checkRadiusM(c: WindCheck, ms: number, share: number): number {
  const dt = Math.abs(ms - c.ts)
  if (dt > maxOf(c)) return 0
  const [len, max, w0] = c.seen ? [SEEN_LEN_M, SEEN_MAX_M, SEEN_W0] : [LEN_M, MAX_M, W0]
  return Math.max(0, Math.min(max, len * (Math.log((w0 * (1 - share)) / share) - dt / tauOf(c))))
}

/** How far from the check it still makes up PULL_SHOWN of the wind at a moment, metres (0 = spent). */
export function checkReachM(c: WindCheck, ms: number): number {
  return checkRadiusM(c, ms, PULL_SHOWN)
}

/** When a check stops making up PULL_SHOWN of the wind even where it was made. */
export function checkSpentAt(c: WindCheck): number {
  const w0 = c.seen ? SEEN_W0 : W0
  return c.ts + Math.min(maxOf(c), tauOf(c) * Math.log(w0 / W_SHOWN))
}

/** Did the model call the layering? Only for a check that said what the
 *  treetops were doing: a hit when both say decoupled or both say not. */
export function aloftVerdict(c: WindCheck): 'agree' | 'miss' | null {
  if (c.aloft == null || c.model?.decoupled == null) return null
  return c.aloft === c.model.decoupled ? 'agree' : 'miss'
}

/** Did the model get it? Direction within 45° (or both calm-ish) is a hit,
 *  within 90° close, else a miss. A swinging check is judged on its arc:
 *  inside it (and half a sector past each end) is a hit, 45° more close. */
export function verdict(c: WindCheck): 'agree' | 'close' | 'miss' | null {
  return judge(c, c.model)
}

/** The same test for the forecast as it stood at the check. */
export function forecastVerdict(c: WindCheck): 'agree' | 'close' | 'miss' | null {
  return judge(c, c.forecast)
}

/** The same test for any call: the fit's leave-one-out score (ambientFit.ts) judges the probe's calls with it. */
export function judgeCall(c: WindCheck, m: { dirFrom: number; kmh: number } | undefined): 'agree' | 'close' | 'miss' | null {
  return judge(c, m)
}

function judge(c: WindCheck, m: { dirFrom: number; kmh: number } | undefined): 'agree' | 'close' | 'miss' | null {
  if (!m) return null
  const obsCalm = c.dirFrom == null || c.strength === 'calm'
  // treetops look still up to Beaufort 1 (5 km/h at 10 m); powder moves at 1
  const callCalm = m.kmh < (c.seen ? 6 : 1)
  if (obsCalm || callCalm) return obsCalm === callCalm ? 'agree' : m.kmh < 2.5 && c.strength !== 'breezy' && c.strength !== 'windy' ? 'close' : 'miss'
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
