import { useEffect, useRef, type JSX } from 'react'
import { useAppStore } from '../state/appStore'
import { clockShort } from '../time'
import { groundWind } from '../weather/micro/model'
import { clearPlaced, coneSizeWord, drawnView, GROUND_H, groupSummary, personColour, reachLabel, reliefReason, SCENT_HEIGHTS, sitterName, sittersLine, useScent, type ScentView } from '../weather/micro/scent'
import { checkSpentAt, strongestCheck, useWindChecks } from '../weather/micro/windChecks'
import { compass } from '../weather/openMeteo'
import { useLookTick } from './useLookTick'
import { useTapOff } from './tapOff'
import './live.css'

/**
 * "Your scent": the live card's Scent › opened, a top card in its slot with
 * the map (and both columns) still there. What the cone rests on, in
 * three lines: the wind at head height against the forecast, the wind
 * check pulling it while one does, and how wide and how far it goes; on a
 * still night off a drop, a fourth for why the cone skips the low ground
 * (a reason, so here and not on the live card's brief line). Then
 * the knobs: where you sit (the ground, or a stand), the cone's size from
 * smaller (only what is strong counts) to bigger (scent counts sooner, the
 * wind wanders more), how it is drawn, and with a party placed, whose line it
 * is, Remove and Clear (+ Person is the live card's, and the map popup's
 * Scent). ‹ Back returns the live card; so does a tap off the card, on the
 * map (the app-wide rule, tapOff).
 */

const VIEWS: { v: ScentView; name: string; many?: boolean }[] = [
  { v: 'cloud', name: 'Cloud' },
  { v: 'particles', name: 'Particles' },
  { v: 'people', name: 'By person', many: true },
]

export default function ScentCard(): JSX.Element | null {
  useLookTick()
  const people = useScent((s) => s.people)
  const plumes = useScent((s) => s.plumes)
  const group = useScent((s) => s.group)
  const pick = useScent((s) => s.pick)
  const view = useScent((s) => s.view)
  const risk = useScent((s) => s.risk)
  const strength = useScent((s) => s.strength)
  const checks = useWindChecks((s) => s.checks)
  const planTimeMs = useAppStore((s) => s.planTimeMs)
  const units = useAppStore((s) => s.units)
  const setTopCard = useAppStore((s) => s.setTopCard)
  const n = people.length
  const ref = useRef<HTMLDivElement>(null)
  useTapOff(ref, true, () => setTopCard(null))
  // everyone cleared while it was open: back to the live card
  useEffect(() => {
    if (!n) setTopCard(null)
  }, [n, setTopCard])
  if (!n) return null

  const { setView, setHeight, setPick, setRisk, setStrength, remove } = useScent.getState()
  const many = n > 1
  const k = Math.min(Math.max(0, pick), n - 1)
  const at = people[k]
  const plume = plumes[k] ?? null
  const planMs = planTimeMs ?? Date.now()
  const g = groundWind(at.lon, at.lat, planMs)
  const check = strongestCheck(checks, at.lon, at.lat, planMs)
  const height = at.height
  const shown = drawnView(view, n)
  const party = many && group ? { head: sittersLine(group, n), drift: groupSummary(group, people).drift } : null
  const placed = people.some((p) => !p.live)
  const who = (i: number) => (people[i]?.live ? 'You' : sitterName(people[i], i))
  const kmh = (v: number) => (units === 'imperial' ? Math.round(v * 0.621371) : Math.round(v))
  const slowed = g && g.kmh < g.regionalKmh * 0.8 ? ', slowed by the bush' : ''
  const offDrop = plume && reliefReason(plume)

  return (
    <div className="topcard" ref={ref}>
      <div className="topcard-head">
        <button className="topcard-back" onClick={() => setTopCard(null)}>
          ‹ Back
        </button>
        <span className="topcard-title">Your scent</span>
      </div>
      <div className="topcard-body">
        {g && (
          <div className="scent-line">
            <span className="dim">Wind at head height</span> {g.kmh < 0.5 ? 'calm' : `${compass(g.dirFrom)} ${kmh(g.kmh)}`}{' '}
            <span className="dim">
              · forecast {kmh(g.forecastKmh)}
              {slowed}
            </span>
          </div>
        )}
        {check && (
          <div className="scent-line">
            <span className="dim">Wind sharpened {clockShort(check.check.ts)}</span> pulls it {Math.round(check.pull * 100)}% toward what you {check.check.seen ? 'saw' : 'felt'}{' '}
            <span className="dim">· fades by ~{clockShort(checkSpentAt(check.check))}</span>
          </div>
        )}
        {(g || plume) && (
          <div className="scent-line">
            {g && (
              <>
                <span className="dim">Spread</span> ±{Math.round(g.sigmaDeg)}°
              </>
            )}
            {g && plume && <span className="dim"> · </span>}
            {plume && (plume.height > GROUND_H && plume.landing >= 30 ? `noticeable from ${Math.round(plume.landing / 10) * 10} m out to ${reachLabel(plume)}` : `noticeable to ${reachLabel(plume)}`)}
          </div>
        )}
        {offDrop && <div className="scent-line dim">{offDrop}</div>}
        {plume?.checks && (
          <div className="scent-line dim">
            Your {plume.checks.n} check{plume.checks.n === 1 ? '' : 's'} here drive {Math.round(plume.checks.share * 100)}% of this cone: {plume.checks.puffs} puff{plume.checks.puffs === 1 ? '' : 's'}
            {plume.checks.lulls >= 0.05 ? `, ${Math.round(plume.checks.lulls * 100)}% of them hung` : ''} · the drift, its wander and its lulls are theirs
          </div>
        )}
        {plume && plume.over >= 0.15 && (
          <div className="scent-line dim">About {Math.round(plume.over * 100)}% of it rose up over the canopy, out of reach of noses on the ground</div>
        )}
        {many && (
          <div className="sc-people">
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
            {!at.live && !at.party && (
              <button className="linklike sc-remove" onClick={() => remove(k)}>
                Remove {k + 1}
              </button>
            )}
          </div>
        )}
        {party && (
          <>
            <div className="scent-line">{party.head}</div>
            {party.drift && <div className="scent-line lc-amber">{party.drift}</div>}
          </>
        )}
        {at.party ? (
          // a party member's height is theirs, set on their phone
          <div className="scent-line">
            <span className="dim">{at.who} is</span> {at.height === GROUND_H ? 'on the ground' : `in a stand, ${at.height} m`}
          </div>
        ) : (
        <div className="sc-sec">
          <span className="sc-sec-name">{at.live || !many ? "You're at" : `${k + 1} is at`}</span>
          <div className="seg" role="radiogroup" aria-label={at.live || !many ? 'Where you sit' : `Where ${k + 1} sits`}>
            {SCENT_HEIGHTS.map((h) => (
              <button key={h} className={height === h ? 'seg-on' : ''} role="radio" aria-checked={height === h} onClick={() => setHeight(h)}>
                {h === GROUND_H ? 'Ground' : `Stand ${h} m`}
              </button>
            ))}
          </div>
        </div>
        )}
        <div className="sc-sec">
          <span className="sc-sec-name">
            Cone size <span className="dim">· {coneSizeWord(risk)}</span>
          </span>
          <input
            className="sc-slider sc-cone"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={1 - risk}
            onChange={(e) => setRisk(1 - Number(e.target.value))}
            aria-label="Cone size, smaller to bigger"
            aria-valuetext={coneSizeWord(risk)}
          />
          <div className="sc-slider-ends">
            <span>Smaller</span>
            <span>Bigger</span>
          </div>
        </div>
        <div className="sc-sec">
          <span className="sc-sec-name">Draw it as</span>
          <div className="seg" role="radiogroup" aria-label="How it is drawn">
            {VIEWS.filter((o) => many || !o.many).map((o) => (
              <button key={o.v} className={shown === o.v ? 'seg-on' : ''} role="radio" aria-checked={shown === o.v} onClick={() => setView(o.v)}>
                {o.name}
              </button>
            ))}
          </div>
        </div>
        <div className="sc-sec">
          <span className="sc-sec-name">
            Strength <span className="numeral">· {Math.round(strength * 100)}%</span>
          </span>
          <input className="sc-slider" type="range" min={10} max={100} step={5} value={Math.round(strength * 100)} onChange={(e) => setStrength(Number(e.target.value) / 100)} aria-label="Strength" />
        </div>
        {placed && (
          <div className="sc-btns">
            <button className="lc-btn" onClick={clearPlaced}>
              Clear
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
