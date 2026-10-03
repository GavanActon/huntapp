import { useEffect, useRef, useState, type JSX, type ReactNode } from 'react'
import { useHunting } from '../hunting/hunting'
import { heardThisHunt, movesChip, movesLine, readMoves, soundRow, useSwing } from '../hunting/moveLayer'
import { openHuntLog } from '../log/logView'
import { useAppStore } from '../state/appStore'
import { useSpotsStore } from '../state/spotsStore'
import { spotGradeWords } from '../spots/grades'
import { explainPoint } from '../spots/scoring'
import { TARGET_NAMES } from '../spots/types'
import { clockShort, dayShort, hourShort, isToday, startOfDayMs } from '../time'
import { useGpsStore } from '../tracking/gpsStore'
import { drainWindow } from '../weather/micro/model'
import { clearPlaced, groupSummary, sittersLine, useScent, type Plume } from '../weather/micro/scent'
import { checkSpentAt, strongestCheck, useWindChecks, verdict } from '../weather/micro/windChecks'
import { useHeardForm } from './HeardCard'
import { logWindHere } from './logWindHere'
import { IconChevronDown, IconChevronUp } from './icons'
import { useTapOff } from './tapOff'
import { useLookTick } from './useLookTick'
import { compass } from '../weather/openMeteo'
import './live.css'

/**
 * The live card, under the strip, only while something is live: your scent
 * cone is on, a moose was heard in the last three quarters of an hour, or
 * people are placed. Two lines for a phone just out of a pocket (your
 * scent, and the bull), a ⌃ to fold it to a chip for a long sit, and a tap
 * to open it downward into its rows: scent, the wind check pulling it, the
 * ground air, the last sound and the way to the rest. With a planning time
 * set, the scent line carries the time and the second line is the spot's
 * score then. A party placed on the map (never saved) gets its own lines
 * and its + Person and Clear.
 */

/** The evening run of cold air at a point, said from where the clock is in it; null with none in reach. */
function drainLine(lon: number, lat: number, now: number): string | null {
  const day0 = startOfDayMs(now)
  const d = new Date(day0)
  // before noon the run still going is last evening's
  const days = now < day0 + 12 * 3600_000 ? [new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1).getTime(), day0] : [day0]
  for (const ds of days) {
    const w = drainWindow(lon, lat, ds)
    if (!w) continue
    if (now >= w.startMs && now < w.endMs) return `Ground air · draining till ${clockShort(w.endMs)}`
    if (now < w.startMs) return `Ground air · drains from ${clockShort(w.startMs)}`
  }
  return null
}

/** A row's lead words (bold) and the rest: 'Wind sharpened 6:05 · …' → ['Wind sharpened', ' 6:05 · …']. */
function lead(s: string): [string, string] {
  const m = /^(.+?)(?= \d{1,2}:\d{2}| · )/.exec(s)
  return m ? [m[1], s.slice(m[1].length)] : [s, '']
}

function Row({ text, amber, onTap }: { text: string; amber?: boolean; onTap?: () => void }) {
  const [head, rest] = lead(text)
  const body = (
    <span>
      <b className={amber ? 'lc-who' : undefined}>{head}</b>
      {rest}
    </span>
  )
  if (!onTap) return <div className="lc-row lc-plain">{body}</div>
  return (
    <button className="lc-row" onClick={onTap}>
      {body}
      <span className="dim">›</span>
    </button>
  )
}

/** The cone in a few words: `Scent → SE · 180 m`, or `Scent spreads · 70 m` in near calm. */
function briefScent(p: Plume): string {
  const reach = p.beyond ? '700+ m' : `${Math.round(p.reach / 10) * 10} m`
  if (p.calm && p.mainShare < 0.35) return `Scent spreads · ${reach}`
  return `Scent → ${compass(p.mainToward)} · ${reach}`
}

export default function LiveCard(): JSX.Element | null {
  useLookTick()
  useSwing((s) => s.swing)
  const cone = useHunting((s) => s.cone)
  const people = useScent((s) => s.people)
  const plumes = useScent((s) => s.plumes)
  const group = useScent((s) => s.group)
  const adding = useScent((s) => s.adding)
  const heardWaiting = useHeardForm((s) => s.placing)
  const checks = useWindChecks((s) => s.checks)
  const planTimeMs = useAppStore((s) => s.planTimeMs)
  const folded = useAppStore((s) => s.liveFolded)
  const setLiveFolded = useAppStore((s) => s.setLiveFolded)
  const setTopCard = useAppStore((s) => s.setTopCard)
  const fix = useGpsStore((s) => s.fix)
  const target = useSpotsStore((s) => s.target)
  const conditions = useSpotsStore((s) => s.conditions)
  const weights = useSpotsStore((s) => s.weights)
  // the ground a party scents is given in the user's units
  useAppStore((s) => s.units)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useTapOff(ref, open, () => setOpen(false))

  const moves = readMoves()
  const k = people.findIndex((p) => p.live)
  const live = k >= 0 ? people[k] : null
  const livePlume = k >= 0 ? (plumes[k] ?? null) : null
  const placed = people.filter((p) => !p.live)
  const visible = cone || live != null || moves != null || placed.length > 0 || adding || heardWaiting
  useEffect(() => {
    if (!visible) setOpen(false)
  }, [visible])
  if (!visible) return null

  const now = Date.now()
  const planMs = planTimeMs ?? now
  const { setAdding } = useScent.getState()
  const check = live ? strongestCheck(checks, live.lon, live.lat, planMs) : null
  // the moment to ask for a check: the last one has faded to a quarter, it
  // missed and 20 min have passed, or a sit has none at all
  let nudge: string | null = null
  if (live && planTimeMs == null) {
    if (!check) nudge = 'No wind check this sit · sharpen the wind'
    else if (verdict(check.check) === 'miss' && now - check.check.ts > 20 * 60_000) nudge = `The map missed here at ${clockShort(check.check.ts)} · check again`
    else if (check.pull < 0.25) nudge = 'Wind check fading · sharpen again'
  }
  const party = people.length > 1 && group ? { head: sittersLine(group, people.length), drift: groupSummary(group, people).drift } : null
  const toScent = () => {
    setOpen(false)
    setTopCard({ kind: 'scent' })
  }

  // ---- Heard pressed: the next map tap is where it was (said, or the
  // button just looks lit and the map does nothing anyone expects)
  if (heardWaiting)
    return (
      <div className="livecard lc-party" ref={ref}>
        <span className="lc-party-n">Tap the map where you heard it</span>
        <button className="lc-act lc-act-on" onClick={() => useHeardForm.getState().arm()}>
          cancel
        </button>
      </div>
    )

  // ---- placing someone: the next map tap puts them there
  if (adding)
    return (
      <div className="livecard lc-party" ref={ref}>
        <span className="lc-party-n">Tap where {people.length + 1} sits</span>
        <button className="lc-act lc-act-on" onClick={() => setAdding(false)}>
          cancel
        </button>
        {placed.length > 0 && (
          <button className="lc-act" onClick={clearPlaced}>
            Clear
          </button>
        )}
      </div>
    )

  // ---- a party placed (with or without your own cone): one bar like the
  // folded strip, how many sit, + Person and Clear; the count opens Your
  // scent, where the area, whose scent drifts over whom and the rest live
  if (placed.length) {
    const n = people.length
    return (
      <div className="livecard lc-party" ref={ref}>
        <button className="lc-party-n" onClick={toScent}>
          {n} {n === 1 ? 'sitter' : 'sitters'}
        </button>
        <button className="lc-act" onClick={() => setAdding(true)}>
          + Person
        </button>
        <button className="lc-act" onClick={clearPlaced}>
          Clear
        </button>
      </div>
    )
  }

  // ---- line 1: your scent. The cone on the map says where it goes and
  // how far; the line is the way into its knobs, with the hour when the
  // cone is for another one, and whether a wind check pulls it
  let scentText: string | null = null
  let when: string | null = null
  if (livePlume) {
    scentText = briefScent(livePlume)
    if (planTimeMs != null) when = `${isToday(planTimeMs) ? '' : `${dayShort(planTimeMs)} `}${hourShort(planTimeMs)}`
  } else if (live) scentText = 'Scent · working out…'
  else if (cone) {
    const spread = fix ? (fix.sigma ?? fix.accuracy) : null
    scentText = spread != null && spread > 40 ? `Scent · fix ±${Math.round(spread)} m` : 'Scent · waiting for a fix'
  }

  // ---- line 2: the bull, or the spot's score at the planning time
  let second: ReactNode = null
  let amber = false
  if (planTimeMs != null && live && conditions) {
    const ex = explainPoint(target, live.lon, live.lat, conditions, weights)
    if (ex) second = `${TARGET_NAMES[target]} · ${spotGradeWords(target, ex.score)} here · ${Math.round(ex.score * 100)}`
  }
  if (second == null && moves) {
    second = movesLine(moves)
    amber = true
  }
  const third = !moves && party ? party.drift : null
  if (second == null && party) second = party.head

  // ---- folded to a chip
  if (folded && !open) {
    const parts = [scentText, moves ? movesChip(moves) : null].filter((p): p is string => p != null)
    if (parts.length)
      return (
        <button className="livecard-chip" onClick={() => setLiveFolded(false)}>
          {parts.map((p, i) => (
            <span key={i}>
              {i > 0 && <span className="dim">· </span>}
              {p}
            </span>
          ))}
          <IconChevronDown size={16} />
        </button>
      )
  }

  // ---- opened downward: the rows
  if (open) {
    const es = heardThisHunt()
    const last = es[es.length - 1]
    const at = live ?? (fix ? { lon: fix.lon, lat: fix.lat } : (moves?.you ?? null))
    const drain = at ? drainLine(at.lon, at.lat, now) : null
    return (
      <div className="livecard livecard-open" ref={ref}>
        <div className="lc-head">
          <span>
            {planTimeMs == null ? 'Now' : isToday(planTimeMs) ? 'Today' : dayShort(planTimeMs)} <span className="dim">· {planTimeMs == null ? clockShort(now) : hourShort(planTimeMs)}</span>
          </span>
        </div>
        {livePlume && scentText && <Row text={scentText} onTap={toScent} />}
        {!livePlume && scentText && <Row text={scentText} />}
        {check && <Row text={`Wind sharpened ${clockShort(check.check.ts)} · pulling ${Math.round(check.pull * 100)}% · till ~${clockShort(checkSpentAt(check.check))}`} />}
        {nudge && <Row text={nudge} onTap={logWindHere} />}
        {drain && <Row text={drain} />}
        {party && <Row text={party.head} onTap={toScent} />}
        {party?.drift && <span className="lc-line lc-amber">{party.drift}</span>}
        {last && <Row text={soundRow(last, es[es.length - 2])} amber />}
        {es.length > 1 && (
          <button
            className="lc-row"
            onClick={() => {
              setOpen(false)
              // the earlier sounds: the log on what was heard
              openHuntLog('heard')
            }}
          >
            <span className="dim">{es.length - 1} earlier</span>
            <span className="dim">›</span>
          </button>
        )}
      </div>
    )
  }

  // ---- the default: two lines and ⌃
  return (
    <div className="livecard" ref={ref} onClick={() => setOpen(true)}>
      <div className="lc-main">
        <div className="lc-lines">
          {scentText && (
            <span className="lc-line">
              {when && <span className="lc-when">{when}</span>}
              {scentText}
              {check && <span className="lc-tag">checked</span>}
            </span>
          )}
          {second != null && <span className={`lc-line${amber ? ' lc-amber' : ''}`}>{second}</span>}
          {third && <span className="lc-line lc-amber">{third}</span>}
        </div>
        <button
          className="lc-fold"
          aria-label="Fold"
          onClick={(e) => {
            e.stopPropagation()
            setLiveFolded(true)
          }}
        >
          <IconChevronUp size={18} />
        </button>
      </div>
    </div>
  )
}
