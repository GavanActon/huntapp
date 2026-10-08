import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { cachedPointForecast, compass, hourAt } from '../weather/openMeteo'
import { windSampler } from '../weather/windGrid'
import { groundWind, loadMicro, sitScoreFor } from '../weather/micro/model'
import { nextPuff } from '../weather/micro/ambientFit'
import { angleDiff, checkFelt, checkPull, checkReachM, checkSpentAt, forecastVerdict, SEEN_CUE, SEEN_STRENGTH, steadiness, towardWords, useWindChecks, verdict, type Seen, type Strength, type WindCheck, STRENGTH_CUE } from '../weather/micro/windChecks'
import { clockShort } from '../time'
import { useAppStore } from '../state/appStore'
import { requestCompass, startCompass, stopCompass, useCompass } from '../tracking/compass'
import { useGpsStore } from '../tracking/gpsStore'
import { useMapBearing } from '../map/mapBearing'
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
 * Which way, one direction (Gavan, 2026-10-08, "no swinging, just a
 * single direction"): "ahead", the way the phone points, which is the
 * default (tapping how hard with no way given takes it, no more taps: the
 * way you look at a spot seen from afar, else the compass's heading, else
 * your track while you walk), or an arrow on the rose. The last given
 * wins. The middle shows the way given and a tap on it takes it back, as
 * does a tap on the lit arrow, so "ahead" can be backed out of (Gavan:
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
 * Opened on a spot away from you (the map popup's Wind), it is a check
 * seen, not felt: the treetops (or the water) over there, out glassing.
 * The rose then faces the way you look, from your fix to the spot, so the
 * arrow to tap is the way they lean as you see them, "ahead" is that way,
 * how hard is read in Beaufort's signs, and it is saved as `seen`, the
 * wind above the trees (windChecks.ts). With no fix the card cannot tell
 * where you are, so it asks: seen from afar, or felt there.
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
  open: (lon: number, lat: number, label: string, seen?: { from: { lon: number; lat: number } | null }) => void
  arm: () => void
  close: () => void
}
export const useCheckForm = create<CheckForm>((set) => ({
  at: null,
  arming: false,
  open: (lon, lat, label, seen) => {
    // from the tap that opened the form: iOS only grants the compass from one
    void requestCompass()
    set({ at: { lon, lat, label, ...(seen ? { seen: true, from: seen.from } : {}) }, arming: false })
  },
  arm: () => {
    void requestCompass()
    set({ at: null, arming: true })
  },
  close: () => set({ at: null, arming: false }),
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
  const close = useCheckForm((s) => s.close)
  const add = useWindChecks((s) => s.add)
  // the rose is the map's compass: it turns only as the map is turned, so
  // the arrows hold still under a finger (turned by the live heading they
  // slid as the phone wandered, and taps on them went missing: Gavan,
  // 2026-10-08)
  const bearing = useMapBearing((s) => s.bearing)
  /** the way the powder goes, a true bearing; null until given */
  const [dir, setDirState] = useState<number | null>(null)
  /** how it was given, and what "ahead" was read from */
  const [via, setVia] = useState<{ how: 'arrow' | 'ahead'; read?: string } | null>(null)
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
  /** the map's call there now, with this check in */
  const [after, setAfter] = useState<ReturnType<typeof groundWind>>(null)
  /** the sit scored check by check (a second's work, asked off the tap) */
  const [sit, setSit] = useState<ReturnType<typeof sitScoreFor>>(null)
  const [saving, setSaving] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  // a tap off the card, the map included, closes it
  useTapOff(ref, true, close)

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
      setDirState(null)
      setVia(null)
      return
    }
    setDirState(Math.round(((deg % 360) + 360) % 360))
    setVia({ how, read })
    if (calm) {
      setStrength(null)
      setSeenAs(null)
    }
    setMissing(null)
  }
  /** An arrow: that way. The lit arrow again: no way given. */
  const tapArrow = (b: number) => setDir(dir != null && sector(dir) === b ? null : b)

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
      dirFrom: calm || d == null ? null : (d + 180) % 360,
      strength,
      ...(aloft ? { aloft: true } : {}),
      ...(heldOn ? { held: true } : {}),
      ...(useAppStore.getState().who ? { by: useAppStore.getState().who } : {}),
      source: 'hand',
      model: g ? { dirFrom: g.dirFrom, kmh: g.kmh, regime: g.regime, sigmaDeg: g.sigmaDeg, decoupled: g.decoupled, slot: g.inSlot, woods: g.inWoods, ...(g.bias ? { bias: g.bias } : {}) } : undefined,
      forecast: forecastAt(at.lon, at.lat, now),
    })
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
    const c = add({
      ts: now,
      lon: at.lon,
      lat: at.lat,
      dirFrom: calm || d == null ? null : (d + 180) % 360,
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
    const puff = nextPuff(sit?.fit ?? null, sit?.count ?? 1)
    // when to puff again: sooner after a miss; a wind that had held, later
    const againMs = saved.ts + (v === 'miss' ? 25 : saved.held ? 60 : 40) * 60_000
    // the map's call moved: 10° or a quarter in speed
    const moved = after && m ? angleDiff(after.dirFrom, m.dirFrom) >= 10 || Math.abs(Math.log(Math.max(after.kmh, 0.3) / Math.max(m.kmh, 0.3))) >= Math.log(1.25) : false
    const sc = sit && sit.score.n >= 2 ? sit.score : null
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
          Leads the wind here <b>{pull}%</b> · fades by ~{clockShort(checkSpentAt(saved))} · <b>check again by ~{clockShort(againMs)}</b>, or the moment it shifts
        </div>
        {puff && <div className="gc-note">{puff}</div>}
        <ShareChecksAsk />
      </div>
    )
  }

  return (
    <div className="tripbuilder glass ground-card" ref={ref}>
      <div className="tb-head">
        <span className="tb-title">Sharpen the wind{seen ? ` · ${at.label}` : ''}</span>
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
      <Rose turn={bearing} value={calm ? null : dir} onPick={tapArrow} label={(b) => `toward ${compass(b)}`}>
        {calm ? (
          <span className="gc-mid-word">calm</span>
        ) : dir != null ? (
          // the way given: tap it to take it back
          <button className="gc-lock gc-lock-on" onClick={tapMiddle} aria-label="take the way back">
            <Arrow toward={dir - bearing} size={24} />
            <span>
              {compass(dir)}
              {via?.how === 'ahead' ? ' · ahead' : ''}
            </span>
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
        <div className="gc-strength gc-cues">
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
                if (s !== 'calm') aheadByDefault()
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
