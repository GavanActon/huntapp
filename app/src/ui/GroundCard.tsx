import { useEffect, useState } from 'react'
import { useHunting } from '../hunting/hunting'
import { movesText, readMoves } from '../hunting/moveLayer'
import { useHuntLog } from '../log/huntLog'
import { useAppStore } from '../state/appStore'
import { drawnView, GROUND_H, groupSummary, personColour, plumeSummary, SCENT_HEIGHTS, useScent, type ScentView } from '../weather/micro/scent'
import { checkSpentAt, strongestCheck, useWindChecks } from '../weather/micro/windChecks'
import { timeLabel } from '../time'
import WindCheckCard, { useCheckForm } from './WindCheckCard'
import { IconClose } from './icons'
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
 * and where they sit, and each one drags about on the map.
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

function note(v: ScentView, many: boolean): string {
  if (v === 'people') return "Each person's noticeable edge in their own colour, over everyone's scent together."
  if (v === 'particles')
    return many
      ? "Everyone's scent drifting off them, warmest where it adds up at a deer's nose; the dashed line is where it stops being noticeable."
      : "Each puff is scent drifting off you, widening as it goes and warmest where it is strong at a deer's nose; the dashed line is where it stops being noticeable."
  return many
    ? "Everyone's scent together at a deer's nose: where cones overlap it adds up. Drag a number to move them."
    : "Scent at a deer's nose: deep orange is strong, the pale wash only a trace."
}

function ScentCard() {
  const people = useScent((s) => s.people)
  const plumes = useScent((s) => s.plumes)
  const group = useScent((s) => s.group)
  const pick = useScent((s) => s.pick)
  const adding = useScent((s) => s.adding)
  const view = useScent((s) => s.view)
  // the ground they scent is given in the user's units
  useAppStore((s) => s.units)
  const hunting = useHunting((s) => s.on)
  const [more, setMore] = useState(false)
  useLookTick()
  const moves = hunting ? readMoves() : null
  const { clear, setView, setHeight, setPick, setAdding, remove } = useScent.getState()
  const n = people.length
  const many = n > 1
  const k = Math.min(pick, n - 1)
  const plume = plumes[k] ?? null
  const height = people[k]?.height ?? GROUND_H
  const shown = drawnView(view, n)
  const g = many && group ? groupSummary(group, people) : null
  const live = people.some((p) => p.live)
  const who = (i: number) => (people[i]?.live ? 'You' : `${i + 1}`)
  const title = live && !many ? 'Your scent · now' : many ? `Scent · ${n} people · 10 min sit` : 'Scent cone · 10 min sit'
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
  if (hunting && live && !more && !adding)
    return (
      <div className="tripbuilder glass ground-card gc-compact">
        <div className="tb-head">
          <span className="tb-title">{title}</span>
          {checkedTag}
          <button className="linklike gc-more" onClick={() => setMore(true)}>
            more
          </button>
          {/* your cone only, as the map's button does: anyone placed beside you stays */}
          <button className="icon-btn" onClick={() => useHunting.getState().setCone(false)} aria-label="Hide your scent cone">
            <IconClose size={16} />
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
        <button className="icon-btn" onClick={clear} aria-label={many ? "Hide everyone's scent" : 'Hide scent cone'}>
          <IconClose size={16} />
        </button>
      </div>
      {adding ? (
        <div className="gc-line">
          Tap the map where {n + 1} sits ·{' '}
          <button className="linklike" onClick={() => setAdding(false)}>
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
            <button className="linklike gc-remove" onClick={() => remove(k)}>
              Remove {k + 1}
            </button>
          )}
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
      <div className="gc-note">
        {note(shown, many)} Follows the ground model, not the forecast arrow.
        {checked &&
          ` Your wind check at ${timeLabel(checked.check.ts)} makes up ${Math.round(checked.pull * 100)}% of the wind ${many ? `where ${who(k) === 'You' ? 'you sit' : `${k + 1} sits`}` : 'here'}, fading out by ${timeLabel(checkSpentAt(checked.check))} (its ring on the map).`}
      </div>
    </div>
  )
}

/** Out hunting with the cone hidden: the moose line alone, while a sound is fresh. */
function MovesCard() {
  useLookTick()
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
  const scent = useScent((s) => s.people.length > 0)
  const hunting = useHunting((s) => s.on)
  if (checking) return <WindCheckCard />
  if (scent) return <ScentCard />
  if (hunting) return <MovesCard />
  return null
}
