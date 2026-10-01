import { useEffect, useState } from 'react'
import { useHunting } from '../hunting/hunting'
import { movesText, readMoves, useSwing } from '../hunting/moveLayer'
import { useHuntLog } from '../log/huntLog'
import { useAppStore } from '../state/appStore'
import { drawnView, GROUND_H, groupSummary, personColour, plumeSummary, SCENT_HEIGHTS, useScent, type ScentView } from '../weather/micro/scent'
import { checkSpentAt, strongestCheck, useWindChecks } from '../weather/micro/windChecks'
import { timeLabel } from '../time'
import { useUsableFix } from '../tracking/hereFix'
import WindCheckCard, { CheckArmCard, useCheckForm } from './WindCheckCard'
import { IconClose, IconMinus, IconScent } from './icons'
import './ground.css'

// the wind check lives in its own card; the form store is still found here
export { useCheckForm }

/**
 * The ground-wind card, docked above the tabs like the ruler's: either the
 * scent cone, or a wind check being logged (WindCheckCard).
 *
 * The scent card holds one person or several. One reads as it always has:
 * where the scent goes and how far. With two or more, the head is what
 * they scent together and whose scent drifts over whom; one of them is
 * picked (a tap on their number, here or on the map) for their own line
 * and where they sit, and each one drags about on the map, or Move puts
 * the next tap where they go. The icon beside the × takes the cones off
 * the map and leaves everyone sitting.
 *
 * Out hunting the card is the glance for a phone just out of a pocket: your
 * scent in a line, and the moose you last heard (where, how long ago, which
 * way he is going, where he is likely to swing to), so the map keeps the
 * screen; "more" opens the rest. With the cone hidden, the moose line
 * stands alone.
 */

/** Re-render every half minute and on each look, for "min ago" and a sound going stale. */
function useLookTick() {
  const [, tick] = useState(0)
  useEffect(() => {
    const bump = () => tick((x) => x + 1)
    const t = window.setInterval(bump, 30_000)
    const onLook = () => document.visibilityState === 'visible' && bump()
    document.addEventListener('visibilitychange', onLook)
    return () => {
      window.clearInterval(t)
      document.removeEventListener('visibilitychange', onLook)
    }
  }, [])
  useHuntLog((s) => s.entries)
}

const VIEWS: { v: ScentView; name: string; many?: boolean }[] = [
  { v: 'cloud', name: 'Cloud' },
  { v: 'particles', name: 'Particles' },
  { v: 'people', name: 'By person', many: true },
]

function ScentCard() {
  const people = useScent((s) => s.people)
  const plumes = useScent((s) => s.plumes)
  const group = useScent((s) => s.group)
  const pick = useScent((s) => s.pick)
  const adding = useScent((s) => s.adding)
  const moving = useScent((s) => s.moving)
  const hidden = useScent((s) => s.hidden)
  const distances = useScent((s) => s.distances)
  const view = useScent((s) => s.view)
  // the ground they scent is given in the user's units
  useAppStore((s) => s.units)
  const hunting = useHunting((s) => s.on)
  const [more, setMore] = useState(false)
  useLookTick()
  useSwing((s) => s.swing)
  const moves = hunting ? readMoves() : null
  // a fix worth trusting: then setting someone up where you stand is one tap
  const hereNow = useUsableFix()
  const { clear, setView, setHeight, setPick, setAdding, setMoving, setHidden, setCard, setDistances, add, move, remove } = useScent.getState()
  const n = people.length
  const many = n > 1
  const k = Math.min(pick, n - 1)
  const plume = plumes[k] ?? null
  const height = people[k]?.height ?? GROUND_H
  const shown = drawnView(view, n)
  const g = many && group ? groupSummary(group, people) : null
  const live = people.some((p) => p.live)
  const who = (i: number) => (people[i]?.live ? 'You' : `${i + 1}`)
  const title = n === 0 ? 'Scent cone' : live && !many ? 'Your scent · now' : many ? `Scent · ${n} people · 10 min sit` : 'Scent cone · 10 min sit'
  // a wind check correcting the air where this cone starts: said, so a stale one is not trusted blind
  const checks = useWindChecks((s) => s.checks)
  const planMs = useAppStore((s) => s.planTimeMs)
  const at = people[k]
  const checked = at ? strongestCheck(checks, at.lon, at.lat, planMs ?? Date.now()) : null
  const checkedTag = checked && <em className="gc-tag">checked {Math.round(checked.pull * 100)}%</em>
  const lines =
    many ? (
      <>
        <div className="gc-line">{g ? g.head : 'Working out the ground wind…'}</div>
        {g && <div className={g.drift ? 'gc-line gc-drift' : 'gc-note'}>{g.drift ?? "No one's scent drifts over another"}</div>}
      </>
    ) : (
      <div className="gc-line">{plume ? plumeSummary(plume) : 'Working out the ground wind…'}</div>
    )
  if (hunting && live && !more && !adding && moving == null)
    return (
      <div className="tripbuilder glass ground-card gc-compact">
        <div className="tb-head">
          <span className="tb-title">{title}</span>
          {checkedTag}
          <button className="linklike gc-more" onClick={() => setMore(true)}>
            more
          </button>
          {/* the card goes, the people and the cones stay: the Scent button carries a mark, a long press brings it back */}
          <button className="icon-btn" onClick={() => useScent.getState().setCard(false)} aria-label="Minimise">
            <IconMinus size={16} />
          </button>
        </div>
        {lines}
        {moves && <div className="gc-line gc-moves">{movesText(moves)}</div>}
      </div>
    )
  const addBtn = (
    <button className={`chip chip-pick${adding ? ' chip-on' : ''}`} onClick={() => setAdding(!adding)} aria-pressed={adding}>
      + Person
    </button>
  )
  // the next tap sits someone down or moves them; "here" is the same thing in
  // one tap, for when the dot is under the card or off the screen
  const placing = adding || moving != null
  const placeHere = () => {
    if (!hereNow) return
    if (moving != null) move(moving, hereNow.lon, hereNow.lat)
    else add(hereNow.lon, hereNow.lat)
  }
  return (
    <div className="tripbuilder glass ground-card">
      <div className="tb-head">
        <span className="tb-title">{title}</span>
        {checkedTag}
        {hunting && live && (
          <button className="linklike gc-more" onClick={() => setMore(false)}>
            less
          </button>
        )}
        {n > 0 && (
          <button
            className={`icon-btn${hidden ? ' icon-btn-on' : ''}`}
            onClick={() => setHidden(!hidden)}
            aria-pressed={hidden}
            aria-label={hidden ? 'Show the cones' : 'Hide the cones'}
          >
            <IconScent size={16} />
          </button>
        )}
        {n > 0 && (
          <button className="icon-btn" onClick={() => setCard(false)} aria-label="Minimise">
            <IconMinus size={16} />
          </button>
        )}
        <button className="icon-btn" onClick={clear} aria-label={many ? "Hide everyone's scent" : 'Hide scent cone'}>
          <IconClose size={16} />
        </button>
      </div>
      {placing ? (
        <div className="gc-line">
          Tap the map where {moving != null ? `${moving + 1} goes` : `${n + 1} sits`} ·{' '}
          {hereNow && (
            <>
              <button className="linklike" onClick={placeHere}>
                here
              </button>{' '}
              ·{' '}
            </>
          )}
          <button className="linklike" onClick={() => (moving != null ? setMoving(null) : setAdding(false))}>
            cancel
          </button>
        </div>
      ) : (
        lines
      )}
      {many && (
        <div className="gc-people">
          <div className="seg" role="radiogroup" aria-label="Whose sit">
            {people.map((_, i) => (
              <button
                key={i}
                className={i === k ? 'seg-on' : ''}
                role="radio"
                aria-checked={i === k}
                onClick={() => setPick(i)}
                style={shown === 'people' ? { color: personColour(i) } : undefined}
              >
                {who(i)}
              </button>
            ))}
          </div>
          {addBtn}
          {!people[k]?.live && (
            <button
              className={`chip chip-pick${moving === k ? ' chip-on' : ''}`}
              onClick={() => setMoving(moving === k ? null : k)}
              aria-pressed={moving === k}
            >
              Move
            </button>
          )}
          {!people[k]?.live && (
            <button className="linklike gc-remove" onClick={() => remove(k)}>
              Remove {k + 1}
            </button>
          )}
          <button className={`chip chip-pick${distances ? ' chip-on' : ''}`} onClick={() => setDistances(!distances)} aria-pressed={distances}>
            Distances
          </button>
        </div>
      )}
      {many && <div className="gc-note gc-one">{plume ? `${who(k)}: ${plumeSummary(plume)}` : `${who(k)}: working out…`}</div>}
      <div className="gc-opts">
        <div className="seg" role="radiogroup" aria-label={many && !people[k]?.live ? `Where ${k + 1} sits` : 'Where you sit'}>
          {SCENT_HEIGHTS.map((h) => (
            <button key={h} className={height === h ? 'seg-on' : ''} role="radio" aria-checked={height === h} onClick={() => setHeight(h)}>
              {h === GROUND_H ? 'Ground' : `Stand ${h} m`}
            </button>
          ))}
        </div>
        <div className="seg" role="radiogroup" aria-label="How it is drawn">
          {VIEWS.filter((o) => many || !o.many).map((o) => (
            <button key={o.v} className={shown === o.v ? 'seg-on' : ''} role="radio" aria-checked={shown === o.v} onClick={() => setView(o.v)}>
              {o.name}
            </button>
          ))}
        </div>
        {!many && addBtn}
      </div>
      {/* what the colours and the views mean is under Layers, "About what is drawn" */}
      {checked && (
        <div className="gc-note">
          Your check at {timeLabel(checked.check.ts)} makes up {Math.round(checked.pull * 100)}% of the wind {many ? `where ${who(k) === 'You' ? 'you sit' : `${k + 1} sits`}` : 'here'}, fading out by {timeLabel(checkSpentAt(checked.check))}.
        </div>
      )}
    </div>
  )
}

/** Out hunting with the cone hidden: the moose line alone, while a sound is fresh. */
function MovesCard() {
  useLookTick()
  useSwing((s) => s.swing)
  const r = readMoves()
  if (!r) return null
  return (
    <div className="tripbuilder glass ground-card gc-compact">
      <div className="tb-head">
        <span className="tb-title">Moose</span>
      </div>
      <div className="gc-line gc-moves">{movesText(r)}</div>
    </div>
  )
}

export default function GroundCard() {
  const checking = useCheckForm((s) => s.at != null)
  const arming = useCheckForm((s) => s.arming)
  const scent = useScent((s) => s.people.length > 0 || s.adding)
  const card = useScent((s) => s.card)
  const hunting = useHunting((s) => s.on)
  if (checking) return <WindCheckCard />
  if (arming) return <CheckArmCard />
  // minimised, the people and the cones stay; the Scent button carries a mark and a long press brings it back
  if (scent && card) return <ScentCard />
  if (hunting) return <MovesCard />
  return null
}
