import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { cachedPointForecast, compass, hourAt } from '../weather/openMeteo'
import { windSampler } from '../weather/windGrid'
import { groundWind, loadMicro } from '../weather/micro/model'
import { checkFelt, checkPull, checkReachM, checkSpentAt, forecastVerdict, SEEN_CUE, SEEN_STRENGTH, steadiness, towardWords, useWindChecks, verdict, type Seen, type Strength, type WindCheck, STRENGTH_CUE } from '../weather/micro/windChecks'
import { LESSON_WORDS, lessonOf, lessonScores, PRIOR_N, biasMatters, biasWords } from '../weather/micro/bias'
import { clockShort } from '../time'
import { useAppStore } from '../state/appStore'
import { requestCompass, startCompass, stopCompass, useCompass } from '../tracking/compass'
import Rose, { Arrow, sector } from './Rose'
import ShareChecksAsk from './ShareChecksAsk'
import { useTapOff } from './tapOff'
import './ground.css'

/**
 * Sharpening the wind: a check of what the air really does, in the bottom
 * bar. Which way the powder goes and how hard, then Save. The model's own
 * call for that spot and minute is saved beside it before the check can
 * sway it. "Sharpen" rather than "check" on the buttons (Gavan: the name
 * should say you are making it better): the ground wind, the cones and
 * the swing get truer where you are.
 *
 * The rose turns with the phone when it has a compass, so the arrow to tap
 * is the one pointing where the powder really goes, not a compass point to
 * work out in the bush; without one, north is up. Whatever is picked lights
 * up (a compass heading lights its nearest arrow), and Save always answers:
 * saved (one line: the model's verdict, the pull and when it fades), or
 * what is still missing. Tapping off it closes it, as does Done.
 *
 * Once an arrow is picked the rose stops turning, so the arrow stays under
 * the finger that picked it and the phone can go back in a pocket. Tap a
 * second arrow and the check holds both: the powder swinging between them,
 * saved as the middle and the width of the arc.
 *
 * "ahead" in the middle arms the next tap on the map as what is in front
 * of you: the rose turns to face it (map/MapView.tsx hands the tap over,
 * and the tap off the card that would close it is off while it waits).
 *
 * Opened on a spot away from you (the map popup's Wind), it is a check
 * seen, not felt: the treetops (or the water) over there, out glassing.
 * The rose then faces the way you look, from your fix to the spot, so the
 * arrow to tap is the way they lean as you see them; how hard is read in
 * Beaufort's signs; and it is saved as `seen`, the wind above the trees
 * (windChecks.ts). With no fix the card cannot tell where you are, so it
 * asks: seen from afar, or felt there.
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

interface CheckForm {
  at: CheckAt | null
  /** the Sharpen button with no fix to stand on: the next tap on the map is where the check is made */
  arming: boolean
  /** "ahead" tapped: the next tap on the map is what is in front of you */
  aim: boolean
  /** the last tap on the map while the form is up, numbered so each one counts */
  tap: { lon: number; lat: number; n: number } | null
  open: (lon: number, lat: number, label: string, seen?: { from: { lon: number; lat: number } | null }) => void
  arm: () => void
  setAim: (v: boolean) => void
  /** the map's tap, while the form owns it */
  mapTap: (lon: number, lat: number) => void
  close: () => void
}
export const useCheckForm = create<CheckForm>((set, get) => ({
  at: null,
  arming: false,
  aim: false,
  tap: null,
  open: (lon, lat, label, seen) => {
    // from the tap that opened the form: iOS only grants the compass from one
    void requestCompass()
    set({ at: { lon, lat, label, ...(seen ? { seen: true, from: seen.from } : {}) }, arming: false, aim: false, tap: null })
  },
  arm: () => {
    void requestCompass()
    set({ at: null, arming: true, aim: false, tap: null })
  },
  setAim: (aim) => set({ aim }),
  mapTap: (lon, lat) => set({ tap: { lon, lat, n: (get().tap?.n ?? 0) + 1 } }),
  close: () => set({ at: null, arming: false, aim: false, tap: null }),
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

const VERDICT_WORDS = { agree: 'agreed', close: 'was close', miss: 'missed' } as const

/** Bearing from the check's spot to a point on the map, degrees true. */
function bearingTo(from: { lon: number; lat: number }, lon: number, lat: number): number {
  const dx = (lon - from.lon) * 111_320 * Math.cos((from.lat * Math.PI) / 180)
  const dy = (lat - from.lat) * 110_574
  return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360
}

const STRENGTHS: Strength[] = ['calm', 'drift', 'light', 'breezy', 'windy']
const SEENS: Seen[] = ['still', 'leaves', 'branches', 'sway', 'bend']

export default function WindCheckCard() {
  const at = useCheckForm((s) => s.at)!
  const aim = useCheckForm((s) => s.aim)
  const tap = useCheckForm((s) => s.tap)
  const close = useCheckForm((s) => s.close)
  const add = useWindChecks((s) => s.add)
  const heading = useCompass((s) => s.heading)
  const status = useCompass((s) => s.status)
  const [toward, setToward] = useState<number | null>(null)
  const [swing, setSwing] = useState<number | null>(null)
  const [strength, setStrength] = useState<Strength | null>(null)
  /** seen from afar: what the treetops did */
  const [seenAs, setSeenAs] = useState<Seen | null>(null)
  /** seen, not felt: opened on a spot away from you; with no fix, the hunter says */
  const [seen, setSeen] = useState(!!at.seen)
  /** optional: treetops moving while it is calm here (the air decoupled) */
  const [aloft, setAloft] = useState(false)
  /** optional: the wind here has been the same for a while */
  const [heldOn, setHeldOn] = useState(false)
  const [missing, setMissing] = useState<string | null>(null)
  const [saved, setSaved] = useState<WindCheck | null>(null)
  const [saving, setSaving] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  // a tap off the card closes it, except while "ahead" waits for one on the map
  useTapOff(ref, !aim, close)
  /** where the rose stood when the first arrow was picked */
  const held = useRef<number | null>(null)
  /** the way you face, from a tap on the map ahead of you: the rose turns to it, compass or no compass */
  const [facing, setFacing] = useState<number | null>(null)

  useEffect(() => {
    startCompass()
    return () => stopCompass()
  }, [])

  // the rose turns so its top is where the phone points, or where a tap on
  // the map ahead of you said you face, and holds still from the first pick
  // on: the picked arrow stays where the finger left it
  const live = status === 'on' && heading != null
  // seen from your fix: the rose faces the spot, the way you are looking
  const sight = seen && at.from ? bearingTo(at.from, at.lon, at.lat) : null
  const spin = sight ?? facing ?? (live ? heading : 0)
  const calm = seen ? seenAs === 'still' : strength === 'calm'
  const picked = toward != null && !calm
  const turn = picked && held.current != null ? held.current : spin
  // a swing: the middle of the arc, and how wide it is
  const spread = picked && swing != null ? ((swing - toward + 540) % 360) - 180 : 0
  const mid = toward == null ? 0 : (((toward + spread / 2) % 360) + 360) % 360
  const swingDeg = spread ? Math.min(180, Math.max(45, Math.round(Math.abs(spread)))) : undefined

  const pick = (deg: number) => {
    const d = Math.round(((deg % 360) + 360) % 360)
    if (!picked) {
      held.current = spin
      setToward(d)
      setSwing(null)
    } else if (sector(d) === sector(toward)) {
      // the arrow already picked: any swing on it goes
      setSwing(null)
    } else if (swing == null) {
      // a second arrow: the powder swings between the two
      setSwing(d)
    } else {
      // a third (or the swing end again): that one alone now
      setToward(d)
      setSwing(null)
    }
    if (calm) {
      setStrength(null)
      setSeenAs(null)
    }
    setMissing(null)
  }

  // a tap on the map: with "ahead" armed it is what is in front of you, and
  // the rose turns to it; otherwise it is where the powder went, as good as
  // an arrow and no compass needed
  const tapN = tap?.n ?? 0
  useEffect(() => {
    if (!tap || saved) return
    const brg = bearingTo(at, tap.lon, tap.lat)
    if (aim) {
      setFacing(brg)
      useCheckForm.getState().setAim(false)
    } else pick(brg)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tapN])

  const save = async () => {
    if (seen) return saveSeen()
    if (!strength && toward == null) return setMissing('Tap the arrow the powder follows, then how hard it is blowing (or calm)')
    if (!strength) return setMissing('Tap how hard it is blowing')
    if (!calm && toward == null) return setMissing('Tap the arrow the powder follows')
    setSaving(true)
    const now = Date.now()
    // the model's call first, before this check can sway it; a check is
    // still worth saving without one (offline before the model loaded)
    let g: ReturnType<typeof groundWind> = null
    try {
      await loadMicro()
      g = groundWind(at.lon, at.lat, now)
    } catch {
      g = null
    }
    const c = add({
      ts: now,
      lon: at.lon,
      lat: at.lat,
      dirFrom: calm || toward == null ? null : (mid + 180) % 360,
      swingDeg: calm ? undefined : swingDeg,
      strength,
      ...(aloft ? { aloft: true } : {}),
      ...(heldOn ? { held: true } : {}),
      ...(useAppStore.getState().who ? { by: useAppStore.getState().who } : {}),
      source: 'hand',
      model: g ? { dirFrom: g.dirFrom, kmh: g.kmh, regime: g.regime, sigmaDeg: g.sigmaDeg, decoupled: g.decoupled, slot: g.inSlot, woods: g.inWoods, ...(g.bias ? { bias: g.bias } : {}) } : undefined,
      forecast: forecastAt(at.lon, at.lat, now),
    })
    setSaving(false)
    setSaved(c)
  }

  // a look at the treetops: the wind above the trees, so no model call to
  // keep (that is head height); the forecast's is the one it scores
  const saveSeen = () => {
    if (!seenAs && toward == null) return setMissing('Tap the arrow the treetops lean, then how hard they are moving')
    if (!seenAs) return setMissing('Tap how hard they are moving')
    if (!calm && toward == null) return setMissing('Tap the arrow the treetops lean')
    const now = Date.now()
    const c = add({
      ts: now,
      lon: at.lon,
      lat: at.lat,
      dirFrom: calm || toward == null ? null : (mid + 180) % 360,
      swingDeg: calm ? undefined : swingDeg,
      strength: SEEN_STRENGTH[seenAs],
      seen: seenAs,
      ...(at.from ? { seenFrom: { lon: at.from.lon, lat: at.from.lat } } : {}),
      ...(heldOn ? { held: true } : {}),
      ...(useAppStore.getState().who ? { by: useAppStore.getState().who } : {}),
      source: 'hand',
      forecast: forecastAt(at.lon, at.lat, now),
    })
    setSaved(c)
  }

  // ---- saved: what the map said against what you felt, what the check
  // does now, what it teaches, and when to check again
  if (saved?.seen) {
    const fv = forecastVerdict(saved)
    const pull = Math.round(checkPull(saved, saved.lon, saved.lat, Date.now()) * 100)
    const km = checkReachM(saved, Date.now()) / 1000
    return (
      <div className="tripbuilder glass ground-card" ref={ref}>
        <div className="tb-head">
          <span className="tb-title">Wind sharpened</span>
          <button className="sheet-done" style={{ marginLeft: 'auto' }} onClick={close}>
            Done
          </button>
        </div>
        <div className="gc-line">
          {fv && saved.forecast ? (
            <>
              The forecast <b className={`gc-verdict gc-${fv}`}>{VERDICT_WORDS[fv]}</b> · it said {callWords(saved.forecast)}, you saw {checkFelt(saved)}
            </>
          ) : (
            <>You saw {checkFelt(saved)}</>
          )}
        </div>
        <div className="gc-line">
          Leads the wind above the trees here <b>{pull}%</b> now, out to ~{km.toFixed(1)} km · fades by ~{clockShort(checkSpentAt(saved))}
        </div>
        <div className="gc-note">Look again in about 40 min, or the moment it shifts.</div>
        <ShareChecksAsk />
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
    const fv = forecastVerdict(saved)
    const lesson = lessonOf(saved)
    const score = lesson ? lessonScores(useWindChecks.getState().checks, verdict).find((r) => r.lesson === lesson) : undefined
    const n = score ? score.agree + score.close + score.miss : 0
    const next =
      v === 'miss'
        ? 'Check again in 20 or 30 min: if it has held, say "same as a while ago" and it is trusted twice as long.'
        : 'Check again in about 40 min, or the moment it shifts: a puff within 6 min folds into this one as a swing.'
    return (
      <div className="tripbuilder glass ground-card" ref={ref}>
        <div className="tb-head">
          <span className="tb-title">Wind sharpened</span>
          <button className="sheet-done" style={{ marginLeft: 'auto' }} onClick={close}>
            Done
          </button>
        </div>
        {puffs > 1 && (
          <div className="gc-line">
            Puff {puffs} of this check: {saved.dirFrom == null ? 'calm' : `toward ${towardWords((saved.dirFrom + 180) % 360, saved.swingDeg)}`}
            {steady ? `, ${steady}` : ''}
          </div>
        )}
        <div className="gc-line">
          {v ? (
            <>
              The map <b className={`gc-verdict gc-${v}`}>{VERDICT_WORDS[v]}</b> · it said {said}, you felt {felt}
            </>
          ) : (
            <>Saved without the map's call (it had not loaded) · you felt {felt}</>
          )}
        </div>
        {fv && saved.forecast && (
          <div className="gc-line">
            The forecast <b className={`gc-verdict gc-${fv}`}>{VERDICT_WORDS[fv]}</b> · it said {callWords(saved.forecast)}
          </div>
        )}
        <div className="gc-line">
          Leads the ground wind here <b>{pull}%</b> now · fades by ~{clockShort(checkSpentAt(saved))}
        </div>
        {lesson && score && (
          <div className="gc-note">
            {LESSON_WORDS[lesson][0].toUpperCase() + LESSON_WORDS[lesson].slice(1)}: agreed {score.agree}, close {score.close}, missed {score.miss} this season
            {biasMatters(score.bias) ? ` · the map is ${biasWords(score.bias, lesson).replace(/^./, (c) => c.toLowerCase()).replace(/ by \d+ wind checks? in .*$/, '')} for it` : n < PRIOR_N ? ` · about ${PRIOR_N} checks before this kind of air turns the map much` : ''}
          </div>
        )}
        <div className="gc-note">{next}</div>
        <ShareChecksAsk />
      </div>
    )
  }

  return (
    <div className="tripbuilder glass ground-card" ref={ref}>
      <div className="tb-head">
        <span className="tb-title">Sharpen the wind · {at.label}</span>
      </div>
      {at.seen && !at.from && (
        <div className="gc-strength">
          <button className={`chip-pick${seen ? ' chip-on' : ''}`} onClick={() => setSeen(true)} aria-pressed={seen}>
            seen from afar
          </button>
          <button className={`chip-pick${!seen ? ' chip-on' : ''}`} onClick={() => setSeen(false)} aria-pressed={!seen}>
            felt there
          </button>
        </div>
      )}
      <div className="gc-q">{seen ? 'Which way do the treetops lean?' : 'Which way does the powder go?'}</div>
      <Rose turn={turn} value={calm ? null : toward} swing={calm ? null : swing} onPick={pick} label={(b) => `toward ${compass(b)}`}>
        {calm ? (
          <span className="gc-mid-word">calm</span>
        ) : toward != null ? (
          <span className="gc-mid-pick">
            <Arrow toward={mid - turn} size={30} />
            <b>{towardWords(mid, swingDeg)}</b>
          </span>
        ) : seen ? null : (
          // "ahead": the next tap on the map is what is in front of you, and the
          // rose turns to face it. The phone's compass cannot be trusted for this
          // (held up to point, it wanders), the map can. Seen from your fix the
          // rose already faces the spot.
          <button className={`gc-lock${aim ? ' gc-lock-on' : ''}`} onClick={() => useCheckForm.getState().setAim(!aim)} aria-pressed={aim}>
            <Arrow toward={0} size={20} />
            <span>{aim ? 'cancel' : 'ahead'}</span>
          </button>
        )}
      </Rose>
      {picked && swing != null && (
        <div className="gc-line">
          toward {compass(toward)}, swinging to {compass(swing)}
        </div>
      )}
      {/* how the rose works is under Layers, "About what is drawn"; "ahead" armed is the one thing said here */}
      {!picked && aim && <div className="gc-note">Tap the map in front of you</div>}
      <div className="gc-q">How hard?</div>
      {/* each step with what to look for: the face, the powder, the leaves, the branches; seen, the treetops and the water */}
      {seen ? (
        <div className="gc-strength gc-cues">
          {SEENS.map((s) => (
            <button
              key={s}
              className={`chip-pick${seenAs === s ? ' chip-on' : ''}`}
              onClick={() => {
                setSeenAs(s)
                setMissing(null)
              }}
              aria-pressed={seenAs === s}
            >
              <b>{s}</b>
              <span>{SEEN_CUE[s]}</span>
            </button>
          ))}
        </div>
      ) : (
      <div className="gc-strength gc-cues">
        {STRENGTHS.map((s) => (
          <button
            key={s}
            className={`chip-pick${strength === s ? ' chip-on' : ''}`}
            onClick={() => {
              setStrength(s)
              setMissing(null)
            }}
            aria-pressed={strength === s}
          >
            <b>{s}</b>
            <span>{STRENGTH_CUE[s]}</span>
          </button>
        ))}
      </div>
      )}
      {/* optional, and worth more than they look: the treetops question is the layering model's one real test */}
      <div className="gc-q">If you noticed</div>
      <div className="gc-strength">
        {!seen && (
          <button className={`chip-pick${aloft ? ' chip-on' : ''}`} onClick={() => setAloft((v) => !v)} aria-pressed={aloft}>
            treetops moving, calm here
          </button>
        )}
        <button className={`chip-pick${heldOn ? ' chip-on' : ''}`} onClick={() => setHeldOn((v) => !v)} aria-pressed={heldOn}>
          same as a while ago
        </button>
      </div>
      {missing && <div className="gc-missing">{missing}</div>}
      <button className="btn-primary" disabled={saving} onClick={() => void save()}>
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  )
}
