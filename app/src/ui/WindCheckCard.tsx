import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { cachedPointForecast, compass, hourAt } from '../weather/openMeteo'
import { windSampler } from '../weather/windGrid'
import { groundWind, loadMicro, sitScoreFor } from '../weather/micro/model'
import { holdsForMs, nextPuff, puffsToSettle } from '../weather/micro/ambientFit'
import { VERDICT_WORD, againstEarlier, angleDiff, checkFelt, checkPull, checkReachM, checkSpentAt, forecastVerdict, metresBetween, SEEN_CUE, SEEN_STRENGTH, steadiness, STEADY_WORDS, towardWords, useWindChecks, verdict, type Seen, type Steady, type Strength, type WindCheck, STRENGTH_CUE } from '../weather/micro/windChecks'
import { clockShort } from '../time'
import { useAppStore } from '../state/appStore'
import { requestCompass, startCompass, stopCompass, useCompass } from '../tracking/compass'
import { useGpsStore } from '../tracking/gpsStore'
import { useMapBearing } from '../map/mapBearing'
import { devlog } from '../devlog'
import Rose, { Arrow } from './Rose'
import { useTapOff } from './tapOff'
import './ground.css'
import { km as kmWords } from '../lengths'

/**
 * Sharpening the wind: a check of what the air really does, in the bottom
 * bar. Which way the powder goes and how hard, then Save. The model's own
 * call for that spot and minute is saved beside it before the check can
 * sway it. "Sharpen" rather than "check" on the buttons (Gavan: the name
 * should say you are making it better): the ground wind, the cones and
 * the swing get truer where you are.
 *
 * Which way, one direction (Gavan, 2026-10-08, "no swinging, just a
 * single direction"): "ahead", the way the phone points, which is the
 * default (tapping how hard with no way given takes it, no more taps: the
 * way you look at a spot seen from afar, else the compass's heading, else
 * your track while you walk), or an arrow on the rose. The last given
 * wins; the lit arrow again keeps it. The middle shows the way given as
 * a word, and a tap on it clears, so "ahead" can be backed out of (Gavan:
 * "clicking ahead locks it in, I can't back out"). With nothing to read
 * ahead from, Save says so. A tap on the map closes the card (for an hour
 * that day it was the way the powder went; Gavan: "I should be able to
 * tap the map to exit"). The arc of a wind that swings comes from a
 * series of puffs (windChecks.ts fold), not from a second tap. While the
 * card is up the strip and the live card are off the screen (App.tsx):
 * the map and the rose, nothing else.
 *
 * The rose is the map's compass: it turns only as the map is turned
 * (north up, or heading up with the map), so its arrows read against the
 * map the hunter is looking at and hold still under a finger. Until
 * 2026-10-08 it turned with the live compass heading, and as the phone
 * wandered the arrows slid out from under taps, which then went missing
 * (Gavan: "I click a bunch of times, doesn't set it"). Save always
 * answers: saved (what the map said, what it reads now, the sit's score,
 * when to check next), or what is still missing.
 *
 * Saved, the card says what moved (2026-10-08): the map's call before the
 * check against what it reads there now, with the sit's checks fitted as
 * the air above the trees (ambientFit.ts); a leave-one-out score for the
 * sit, the forecast against the map before the checks against the map
 * now, each check judged by the fit made from the others, so the number
 * is honest and climbs as the checks teach; and the puff that would teach
 * the most next.
 *
 * Saved, the card is two lines (Gavan, 2026-10-18: "wind check info too
 * much", then "KIS. The map: outcome. Then when their next check should
 * be, in minutes from now"): "The map: confirmed" and "Next check in 25 min",
 * the outcome said as what the check did (confirmed, fine-tuned, or
 * correcting). The second line is the research's, not a guess (Gavan, the
 * same evening: "our research and experiments said something regarding
 * this"; "spaced out by enough minutes to ensure it's not just a local
 * gust"). One puff is a ~63° instrument, so a big miss asks for more
 * puffs: "Next puff in 5 min · 2 more to settle it", 5 min apart (twice
 * the head-height meander's 1-2 min, so each puff samples a fresh gust),
 * until this spot has puffsToSettle for the forecast's wind, at least 3
 * (the mean of three averages the meander) and at most 8 (where the
 * station tests level off); a wind said to come and go, the map otherwise
 * right, asks for three. Otherwise, or once
 * settled, "Next check in 100 min": when the check's pull has faded to half
 * (holdsForMs; twice that for a wind that has held),
 * counting down while the card is up; the rest (what it said and what you
 * felt, how it sits with the checks before it here, the sit's score) folds
 * under More. Redo ("pressed back,
 * oops!") takes the check back out and opens the form on the same
 * answers to put right: the time, the model's call and the forecast of
 * the first try are kept, and so is the check's id, so a copy already
 * shared is put right too. The last save is taken back exactly (a puff
 * that folded into a check leaves the check as it was); an older check
 * can be done again from its popup while it is a single puff.
 *
 * Opened on a spot away from you (the map popup's Wind), it is a puff
 * there unless you say "treetops seen from afar": then it is the treetops
 * (or the water) over there, out glassing. The rose then faces the way
 * you look, from your fix to the spot, so the arrow to tap is the way
 * they lean as you see them, "ahead" is that way, how hard is read in
 * Beaufort's signs, and it is saved as `seen`, the wind above the trees
 * (windChecks.ts), with a reach of kilometres and no say in the cone.
 */

interface CheckAt {
  lon: number
  lat: number
  label: string
  /** seen from afar (the treetops there), not felt where you stand */
  seen?: boolean
  /** where it is seen from: the fix, when there was one */
  from?: { lon: number; lat: number } | null
}

type CheckInput = Omit<WindCheck, 'id'>

interface CheckForm {
  at: CheckAt | null
  /** a check being done again: its answers fill the form; saving keeps its time, its calls and (a whole check) its id */
  redo: { input: CheckInput; id?: string } | null
  /** the last save, to take back exactly: the check it made or folded into, what that was before (null: new), and what was said */
  last: { id: string; prev: WindCheck | null; input: CheckInput } | null
  open: (lon: number, lat: number, label: string, seen?: { from: { lon: number; lat: number } | null }) => void
  close: () => void
  /** Save's record of what it did */
  saved: (id: string, prev: WindCheck | null, input: CheckInput) => void
  /** whether a check can be done again: yours, and the last save or a single puff */
  canRedo: (c: WindCheck) => boolean
  /** take a check back out and open the form on its answers */
  redoCheck: (id: string) => void
}
export const useCheckForm = create<CheckForm>((set, get) => ({
  at: null,
  redo: null,
  last: null,
  open: (lon, lat, label, seen) => {
    // from the tap that opened the form: iOS only grants the compass from one
    void requestCompass()
    set({ at: { lon, lat, label, ...(seen ? { seen: true, from: seen.from } : {}) }, redo: null })
  },
  close: () => set({ at: null, redo: null }),
  saved: (id, prev, input) => set({ last: { id, prev, input }, redo: null }),
  canRedo: (c) => !c.taken && c.source === 'hand' && (get().last?.id === c.id || (c.puffs ?? 1) <= 1),
  redoCheck: (id) => {
    const store = useWindChecks.getState()
    const c = store.checks.find((o) => o.id === id)
    if (!c || !get().canRedo(c)) return
    const last = get().last?.id === id ? get().last : null
    let redo: CheckForm['redo']
    if (last?.prev) {
      // the puff that folded in: the check as it was before it
      store.put(last.prev)
      redo = { input: last.input }
    } else {
      store.remove(id)
      const { id: _id, ...input } = c
      redo = { input: last?.input ?? input, id }
    }
    devlog('wind', `redo ${id}${last?.prev ? ' (a puff)' : ''}`)
    void requestCompass()
    const input = redo.input
    set({
      at: { lon: input.lon, lat: input.lat, label: 'again', ...(input.seen || input.seenFrom ? { seen: true, from: input.seenFrom ?? null } : {}) },
      redo,
      last: null,
    })
  },
}))

/** The forecast wind at a place and minute as the map draws it: the HRDPS
 *  lattice, else the cached point forecast; none with neither on the phone. */
function forecastAt(lon: number, lat: number, ms: number): { dirFrom: number; kmh: number } | undefined {
  const out = new Float32Array(2)
  if (windSampler(ms)?.(lon, lat, out)) return { dirFrom: Math.round(out[1]), kmh: Math.round(out[0] * 10) / 10 }
  const f = cachedPointForecast(lon, lat)
  const h = f ? hourAt(f, ms) : null
  return h && Number.isFinite(h.windKmh) && Number.isFinite(h.windDir) ? { dirFrom: Math.round(h.windDir), kmh: Math.round(h.windKmh * 10) / 10 } : undefined
}

/** A call (the map's or the forecast's) in the card's words. */
function callWords(m: { dirFrom: number; kmh: number }): string {
  return m.kmh < 1 ? 'calm' : `toward ${compass((m.dirFrom + 180) % 360)} at ${Math.round(m.kmh)}`
}

/** The saved card's one word, what the check did: "The map: confirmed" (VERDICT_WORD). */
const OUTCOME = VERDICT_WORD
/** Puffs this far apart each sample a fresh gust: twice the head-height meander's time (PALM's stands
 *  wander 40-60° on a 1-2 min scale; the scent's meander is 150 s), so one puff barely knows the last. */
const PUFF_GAP_MS = 5 * 60_000
/** A spot settles at puffsToSettle's count for the forecast's wind, held to at least 3 (the mean of three
 *  takes a 63° puff to ~36°, CHECK-INSTRUMENT.md) and at most 8 (the station tests: 96% within 45°, a
 *  far-off call put right in 83% of sits). */
const SETTLE_MIN = 3
const SETTLE_MAX = 8
/** Puffs at this spot that still count together: yours, felt, within 150 m and two hours (half a check's
 *  pull is left at two hours, WIND-LEARNING.md), this check's own folded puffs among them. */
function puffsHere(c: WindCheck, checks: WindCheck[]): number {
  return checks
    .filter((o) => !o.seen && !o.taken && (o.by ?? '') === (c.by ?? '') && o.ts <= c.ts && c.ts - o.ts <= 2 * 3600_000 && metresBetween(o.lon, o.lat, c.lon, c.lat) <= 150)
    .reduce((n, o) => n + (o.puffs ?? 1), 0)
}
/** The second line's sum: how many more puffs settle this spot (0: settled, or nothing asks for more).
 *  A big miss settles the map's error: puffsToSettle for the forecast's wind, 3 to 8. A wind said to come
 *  and go, the map otherwise right, only has its gusts to average: the instrument's three. */
function puffsLeft(v: 'agree' | 'close' | 'miss' | null, c: WindCheck, checks: WindCheck[]): number {
  const unsteady = c.steady === 'brief' || c.steady === 'once'
  if (v !== 'miss' && !unsteady) return 0
  const target = v === 'miss' ? Math.min(SETTLE_MAX, Math.max(SETTLE_MIN, puffsToSettle(c.forecast?.kmh ?? null))) : SETTLE_MIN
  return Math.max(0, target - puffsHere(c, checks))
}
/** Minutes from now to a moment, at least one. */
const minsTo = (ms: number) => Math.max(1, Math.round((ms - Date.now()) / 60_000))

/** Bearing from the check's spot to a point on the map, degrees true. */
function bearingTo(from: { lon: number; lat: number }, lon: number, lat: number): number {
  const dx = (lon - from.lon) * 111_320 * Math.cos((from.lat * Math.PI) / 180)
  const dy = (lat - from.lat) * 110_574
  return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360
}

const STRENGTHS: Strength[] = ['calm', 'drift', 'light', 'breezy', 'windy']
const STEADIES: Steady[] = ['always', 'brief', 'once']

/** How steady, as a check carries it: 'always' is also the older `held`. */
function steadyFields(k: Steady | null): Pick<WindCheck, 'steady' | 'held'> {
  return k ? { steady: k, ...(k === 'always' ? { held: true } : {}) } : {}
}

/** The check against the ones before it here, in a line: the same, a shift, or a swing. */
function earlierWords(e: { n: number; same: number; since: number }, said?: Steady): string {
  const checks = e.n === 1 ? 'your check' : `your ${e.n} checks`
  const since = clockShort(e.since)
  if (e.same === e.n) return `Holding: the same as ${checks} here since ${since}`
  if (e.same === 0) return said === 'once' ? `A one-off, as you said: a few more puffs settle it` : `A new wind since ${checks} here at ${since}: the map follows it now`
  return `Swinging: ${e.same} of ${e.n} checks here since ${since} go this way, and the map allows for it`
}
const SEENS: Seen[] = ['still', 'leaves', 'branches', 'sway', 'bend']

export default function WindCheckCard() {
  const at = useCheckForm((s) => s.at)!
  const close = useCheckForm((s) => s.close)
  const add = useWindChecks((s) => s.add)
  // the rose is the map's compass: it turns only as the map is turned, so
  // the arrows hold still under a finger (turned by the live heading they
  // slid as the phone wandered, and taps on them went missing: Gavan,
  // 2026-10-08)
  const bearing = useMapBearing((s) => s.bearing)
  /** a check being done again: the form opens on its answers */
  const redo = useCheckForm((s) => s.redo)
  const first = useRef(redo?.input ?? null).current
  /** the way the powder goes, a true bearing; null until given */
  const [dir, setDirState] = useState<number | null>(first && first.dirFrom != null ? (first.dirFrom + 180) % 360 : null)
  /** how it was given, and what "ahead" was read from */
  const [via, setVia] = useState<{ how: 'arrow' | 'ahead'; read?: string } | null>(first && first.dirFrom != null ? { how: 'arrow' } : null)
  const [strength, setStrength] = useState<Strength | null>(first && !first.seen ? first.strength : null)
  /** seen from afar: what the treetops did */
  const [seenAs, setSeenAs] = useState<Seen | null>(first?.seen ?? null)
  /** seen, not felt: only when the hunter says so. Opened on a spot away
   *  from you it used to be seen by default, and with a fix without even
   *  asking (any tap more than 60 m from the fix), so a day's puffs went
   *  in as looks at the treetops, with a reach of kilometres and no say in
   *  the cone (Gavan, 2026-10-09: "still looks like 1.75 km from the wind
   *  check to the edge of the ring") */
  const [seen, setSeen] = useState(!!first?.seen)
  /** optional: treetops moving while it is calm here (the air decoupled) */
  const [aloft, setAloft] = useState(!!first?.aloft)
  /** optional: how steady the wind here has been (always / sometimes / one-off) */
  const [steady, setSteady] = useState<Steady | null>(first?.steady ?? (first?.held ? 'always' : null))
  /** the saved card's More */
  const [more, setMore] = useState(false)
  /** when Save was tapped: the next puff is spaced from it */
  const [savedAt, setSavedAt] = useState(0)
  /** the saved card's minutes count down: a redraw every half minute while it is up */
  const [, tick] = useState(0)
  const [missing, setMissing] = useState<string | null>(null)
  const [saved, setSaved] = useState<WindCheck | null>(null)
  /** the map's call there now, with this check in */
  const [after, setAfter] = useState<ReturnType<typeof groundWind>>(null)
  /** the sit scored check by check (a second's work, asked off the tap) */
  const [sit, setSit] = useState<ReturnType<typeof sitScoreFor>>(null)
  const [saving, setSaving] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  // a tap off the card, the map included, closes it
  useTapOff(ref, true, close)
  useEffect(() => {
    if (!saved) return
    const t = window.setInterval(() => tick((n) => n + 1), 30_000)
    return () => window.clearInterval(t)
  }, [saved])

  // the compass runs while the card is up; it is read only when "ahead" is asked
  useEffect(() => {
    startCompass()
    return () => stopCompass()
  }, [])

  // seen from your fix: "ahead" is the way you look, from the fix to the spot
  const sight = seen && at.from ? bearingTo(at.from, at.lon, at.lat) : null
  const calm = seen ? seenAs === 'still' : strength === 'calm'

  /** The way, one direction: the last given wins; null takes it back. */
  const setDir = (deg: number | null, how: 'arrow' | 'ahead' = 'arrow', read?: string) => {
    if (deg == null) {
      devlog('wind', 'rose: way cleared')
      setDirState(null)
      setVia(null)
      return
    }
    devlog('wind', `rose: ${compass(deg)} by ${how}${read ? ` (${read})` : ''}`)
    setDirState(Math.round(((deg % 360) + 360) % 360))
    setVia({ how, read })
    if (calm) {
      setStrength(null)
      setSeenAs(null)
    }
    setMissing(null)
  }
  /** An arrow: that way; the lit one again keeps it (a second tap used to
   *  clear it, which read as the tap not taking: Gavan, 2026-10-08). */
  const tapArrow = (b: number) => setDir(b)

  /** "ahead": the way the phone points. Seen from afar that is the way you
   *  look; else the compass's heading (held at the last reading it
   *  believed while the phone whirls: compass.ts); else the track's course
   *  while you walk. Null with none of those. */
  const aheadDeg = (): { deg: number; read: string } | null => {
    if (sight != null) return { deg: sight, read: 'the way you look' }
    const cs = useCompass.getState()
    if (cs.status === 'on' && cs.heading != null) return { deg: cs.heading, read: 'compass' }
    const fix = useGpsStore.getState().fix
    if (fix && fix.cog != null && (fix.sogKn ?? 0) >= 0.6 && Date.now() - fix.ts < 90_000) return { deg: fix.cog, read: 'your track' }
    return null
  }
  const NO_AHEAD = 'No compass and not walking: tap the arrow the powder follows'
  /** The middle: "ahead" takes the way the phone points; with a way given
   *  (ahead or an arrow) it shows it, and a tap takes it back. */
  const tapMiddle = () => {
    if (dir != null) return setDir(null)
    const a = aheadDeg()
    if (a) setDir(a.deg, 'ahead', a.read)
    else setMissing(NO_AHEAD)
  }
  /** Ahead is the default (Gavan, 2026-10-08: "someone clicks breezy, assume
   *  it's in the direction they're pointed"): tapping how hard with no way
   *  given takes the way the phone points, quietly; with nothing to read it
   *  from, Save says so. */
  const aheadByDefault = () => {
    if (dir != null) return
    const a = aheadDeg()
    if (a) setDir(a.deg, 'ahead', a.read)
  }

  const save = async () => {
    if (seen) return saveSeen()
    if (!strength) return setMissing('Tap how hard it is blowing')
    let d = dir
    if (!calm && d == null) {
      const a = aheadDeg()
      if (!a) return setMissing(NO_AHEAD)
      d = a.deg
      setDir(a.deg, 'ahead', a.read)
    }
    setSaving(true)
    const now = Date.now()
    // a redo keeps the first try's time and calls: only the answers change
    const r = useCheckForm.getState().redo
    // the model's call first, before this check can sway it; a check is
    // still worth saving without one (offline before the model loaded)
    let g: ReturnType<typeof groundWind> = null
    try {
      await loadMicro()
      g = groundWind(at.lon, at.lat, now)
    } catch {
      g = null
    }
    const c = record(
      {
        ts: r?.input.ts ?? now,
        lon: at.lon,
        lat: at.lat,
        dirFrom: calm || d == null ? null : (d + 180) % 360,
        strength,
        ...(aloft ? { aloft: true } : {}),
        ...steadyFields(steady),
        ...(useAppStore.getState().who ? { by: useAppStore.getState().who } : {}),
        source: 'hand',
        model: r ? r.input.model : g ? { dirFrom: g.dirFrom, kmh: g.kmh, regime: g.regime, sigmaDeg: g.sigmaDeg, decoupled: g.decoupled, slot: g.inSlot, woods: g.inWoods, ...(g.bias ? { bias: g.bias } : {}) } : undefined,
        forecast: r ? r.input.forecast : forecastAt(at.lon, at.lat, now),
      },
      r?.id,
    )
    // what the map reads there now, this check in; then the sit's score, off the tap
    let a: ReturnType<typeof groundWind> = null
    try {
      a = g ? groundWind(at.lon, at.lat, now) : null
    } catch {
      a = null
    }
    setAfter(a)
    setSit(null)
    window.setTimeout(() => {
      try {
        setSit(sitScoreFor(now))
      } catch {
        setSit(null)
      }
    }, 60)
    setSaving(false)
    setSavedAt(Date.now())
    setSaved(c)
  }

  // a look at the treetops: the wind above the trees, so no model call to
  // keep (that is head height); the forecast's is the one it scores
  const saveSeen = () => {
    if (!seenAs) return setMissing('Tap how hard they are moving')
    let d = dir
    if (!calm && d == null) {
      const a = aheadDeg()
      if (!a) return setMissing(NO_AHEAD)
      d = a.deg
      setDir(a.deg, 'ahead', a.read)
    }
    const now = Date.now()
    const r = useCheckForm.getState().redo
    const c = record(
      {
        ts: r?.input.ts ?? now,
        lon: at.lon,
        lat: at.lat,
        dirFrom: calm || d == null ? null : (d + 180) % 360,
        strength: SEEN_STRENGTH[seenAs],
        seen: seenAs,
        ...(at.from ? { seenFrom: { lon: at.from.lon, lat: at.from.lat } } : {}),
        ...steadyFields(steady),
        ...(useAppStore.getState().who ? { by: useAppStore.getState().who } : {}),
        source: 'hand',
        forecast: r ? r.input.forecast : forecastAt(at.lon, at.lat, now),
      },
      r?.id,
    )
    setSavedAt(Date.now())
    setSaved(c)
  }

  /** Add the check, and keep what it did so Redo can take it back exactly. */
  function record(input: CheckInput, id?: string): WindCheck {
    const before = useWindChecks.getState().checks
    const c = add({ ...input, ...(id ? { id } : {}) })
    useCheckForm.getState().saved(c.id, before.find((o) => o.id === c.id) ?? null, input)
    return c
  }

  /** Redo: the check back out, the form again on the same answers. */
  const redoSaved = () => {
    if (!saved) return
    useCheckForm.getState().redoCheck(saved.id)
    setSaved(null)
    setAfter(null)
    setSit(null)
    setMore(false)
  }

  const savedHead = (
    <div className="tb-head">
      <span className="tb-title">Wind sharpened</span>
      <button className="sheet-done gc-redo" style={{ marginLeft: 'auto' }} onClick={redoSaved}>
        Redo
      </button>
      <button className="sheet-done" onClick={close}>
        Done
      </button>
    </div>
  )
  const moreButton = (
    <button className="linklike gc-more" onClick={() => setMore((m) => !m)} aria-expanded={more}>
      {more ? 'Less' : 'More'}
    </button>
  )

  // ---- saved: what the map said against what you felt, what the check
  // does now, what it teaches, and when to check again
  if (saved?.seen) {
    const fv = forecastVerdict(saved)
    const pull = Math.round(checkPull(saved, saved.lon, saved.lat, Date.now()) * 100)
    const km = checkReachM(saved, Date.now()) / 1000
    return (
      <div className="tripbuilder glass ground-card" ref={ref}>
        {savedHead}
        <div className="gc-line gc-outcome">
          The forecast: {fv && saved.forecast ? <b className={`gc-verdict gc-${fv}`}>{OUTCOME[fv]}</b> : <b>no call</b>}
        </div>
        <div className="gc-line gc-outcome">
          Next look in <b>{minsTo(savedAt + holdsForMs(!!saved.held))} min</b>
        </div>
        {moreButton}
        {more && (
          <>
            <div className="gc-line">{saved.forecast ? `It said ${callWords(saved.forecast)}, you saw ${checkFelt(saved)}` : `You saw ${checkFelt(saved)}`}</div>
            <div className="gc-line">
              Leads the wind above the trees here <b>{pull}%</b> now, out to ~{kmWords(km)} · fades by ~{clockShort(checkSpentAt(saved))}
            </div>
          </>
        )}
      </div>
    )
  }

  if (saved) {
    const v = verdict(saved)
    const pull = Math.round(checkPull(saved, saved.lon, saved.lat, Date.now()) * 100)
    const puffs = saved.puffs ?? 1
    const steady = steadiness(saved)
    const m = saved.model
    const felt = saved.dirFrom == null || saved.strength === 'calm' ? 'calm' : `toward ${towardWords((saved.dirFrom + 180) % 360, saved.swingDeg)}, ${saved.strength}`
    const said = m ? callWords(m) : null
    const puff = nextPuff(sit?.fit ?? null, sit?.count ?? 1, saved.forecast?.kmh ?? null)
    // when to puff again: sooner after a miss; a wind that had held, later
    const left = puffsLeft(v, saved, useWindChecks.getState().checks)
    // settled: when this spot's checks have faded to half, from the fit when it reaches here
    const againMs = after?.ambient?.holdsUntil ?? savedAt + holdsForMs(!!saved.held)
    // the map's call moved: 10° or a quarter in speed
    const moved = after && m ? angleDiff(after.dirFrom, m.dirFrom) >= 10 || Math.abs(Math.log(Math.max(after.kmh, 0.3) / Math.max(m.kmh, 0.3))) >= Math.log(1.25) : false
    const sc = sit && sit.score.n >= 2 ? sit.score : null
    const earlier = againstEarlier(saved, useWindChecks.getState().checks)
    return (
      <div className="tripbuilder glass ground-card" ref={ref}>
        {savedHead}
        <div className="gc-line gc-outcome">
          The map: {v ? <b className={`gc-verdict gc-${v}`}>{OUTCOME[v]}</b> : <b>no call</b>}
        </div>
        <div className="gc-line gc-outcome">
          {left > 0 ? (
            <>
              Next puff in <b>{minsTo(savedAt + PUFF_GAP_MS)} min</b> · {left} more to settle it
            </>
          ) : (
            <>
              Next check in <b>{minsTo(againMs)} min</b>
            </>
          )}
        </div>
        {moreButton}
        {more && (
          <>
        <div className="gc-line">{said ? `It said ${said}, you felt ${felt}` : `The map had not loaded · you felt ${felt}`}</div>
        {earlier && <div className="gc-line">{earlierWords(earlier, saved.steady)}</div>}
        {puffs > 1 && (
          <div className="gc-line">
            Puff {puffs} of this check: {saved.dirFrom == null ? 'calm' : `toward ${towardWords((saved.dirFrom + 180) % 360, saved.swingDeg)}`}
            {steady ? `, ${steady}` : ''}
          </div>
        )}
        {after && m && (
          <div className="gc-line">
            {moved ? (
              <>
                Now reads <b>{callWords(after)}</b> here
              </>
            ) : (
              <>Still reads {callWords(after)} here</>
            )}
          </div>
        )}
        {after?.ambient && after.ambient.count >= 2 && (
          <div className="gc-line">
            This sit&rsquo;s {after.ambient.count} checks: {after.ambient.words} · holds till ~{clockShort(after.ambient.holdsUntil)} unless the forecast shifts
          </div>
        )}
        {sc && (
          <div className="gc-line gc-sit">
            Right at this sit&rsquo;s {sc.n} checks, each judged by the others: map before your checks <b>{sc.raw.agree}/{sc.n}</b> · map now <b className={sc.fit.agree > sc.raw.agree ? 'gc-verdict gc-agree' : ''}>{sc.fit.agree}/{sc.n}</b>
          </div>
        )}
        <div className="gc-line">
          Leads the wind here <b>{pull}%</b> · fades by ~{clockShort(checkSpentAt(saved))}
        </div>
        {puff && <div className="gc-note">{puff}</div>}
          </>
        )}
      </div>
    )
  }

  return (
    <div className="tripbuilder glass ground-card" ref={ref}>
      <div className="tb-head">
        <span className="tb-title">{redo ? 'Sharpen again' : `Sharpen the wind${seen ? ` · ${at.label}` : ''}`}</span>
      </div>
      {at.seen && (
        // a spot away from you: a puff there, or the treetops seen from here
        <div className="gc-strength">
          <button className={`chip-pick${!seen ? ' chip-on' : ''}`} onClick={() => setSeen(false)} aria-pressed={!seen}>
            felt there
          </button>
          <button className={`chip-pick${seen ? ' chip-on' : ''}`} onClick={() => setSeen(true)} aria-pressed={seen}>
            treetops seen from afar
          </button>
        </div>
      )}
      <div className="gc-q">{seen ? 'Which way do the treetops lean?' : 'Which way does the powder go?'}</div>
      <Rose turn={bearing} value={calm ? null : dir} onPick={tapArrow} label={(b) => `toward ${compass(b)}`}>
        {calm ? (
          <span className="gc-mid-word">calm</span>
        ) : dir != null ? (
          // the way given, in a word (an arrow here read as the arrow having moved); a tap takes it back
          <button className="gc-lock gc-lock-on" onClick={tapMiddle} aria-label="take the way back">
            <b>{compass(dir)}</b>
            <span>{via?.how === 'ahead' ? 'ahead · clear' : 'clear'}</span>
          </button>
        ) : (
          // "ahead": it goes the way the phone points, and that is the direction saved
          <button className="gc-lock" onClick={tapMiddle}>
            <Arrow toward={0} size={20} />
            <span>ahead</span>
          </button>
        )}
      </Rose>
      <div className="gc-q">How hard?</div>
      {/* each step in three: how far in a second, what the powder looks like, what you feel; seen, the treetops and the water */}
      {seen ? (
        <div className="gc-strength gc-row5">
          {SEENS.map((s) => (
            <button
              key={s}
              className={`chip-pick${seenAs === s ? ' chip-on' : ''}`}
              onClick={() => {
                setSeenAs(s)
                setMissing(null)
                if (s !== 'still') aheadByDefault()
              }}
              aria-pressed={seenAs === s}
            >
              {s}
            </button>
          ))}
        </div>
      ) : (
        <div className="gc-strength gc-row5">
          {STRENGTHS.map((s) => (
            <button
              key={s}
              className={`chip-pick${strength === s ? ' chip-on' : ''}`}
              onClick={() => {
                setStrength(s)
                setMissing(null)
                if (s !== 'calm') aheadByDefault()
              }}
              aria-pressed={strength === s}
            >
              {s}
            </button>
          ))}
        </div>
      )}
      {/* what the picked one looks like, for that one only (Gavan, 2026-10-19: "Sharpen wind takes the whole screen") */}
      <div className="gc-cue">{seen ? (seenAs ? SEEN_CUE[seenAs] : 'Tap one to see what it looks like') : strength ? STRENGTH_CUE[strength] : 'Tap one to see what it looks like'}</div>
      {/* optional: how long the check speaks for (windChecks.ts steadyK); the lit one again takes it back */}
      <div className="gc-q">How steady?</div>
      <div className="gc-strength gc-steady">
        {STEADIES.map((k) => (
          <button key={k} className={`chip-pick${steady === k ? ' chip-on' : ''}`} onClick={() => setSteady((v) => (v === k ? null : k))} aria-pressed={steady === k}>
            <b>{STEADY_WORDS[k]}</b>
          </button>
        ))}
      </div>
      {/* optional, and worth more than it looks: the treetops question is the layering model's one real test */}
      {!seen && (
        <div className="gc-strength">
          <button className={`chip-pick${aloft ? ' chip-on' : ''}`} onClick={() => setAloft((v) => !v)} aria-pressed={aloft}>
            treetops moving, calm here
          </button>
        </div>
      )}
      {missing && <div className="gc-missing">{missing}</div>}
      <button className="btn-primary" disabled={saving} onClick={() => void save()}>
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  )
}
