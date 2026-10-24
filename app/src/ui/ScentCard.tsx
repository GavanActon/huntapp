import { useEffect, useRef, useState, type JSX } from 'react'
import { useAppStore } from '../state/appStore'
import { clearPlaced, coneSizeWord, drawnView, GROUND_H, groupSummary, personColour, SCENT_HEIGHTS, sitterName, useScent, type ScentView } from '../weather/micro/scent'
import { useLookTick } from './useLookTick'
import { useTapOff } from './tapOff'
import './live.css'
import { height as heightWords } from '../lengths'
import { fmtCoord } from '../map/MapView'

/**
 * "Your scent": the live card's Scent › opened, a top card in its slot with
 * the map (and both columns) still there. Knobs only, in Gavan's order
 * (2026-10-24: "KIS here"): whose sit with a party placed, where you sit
 * (the ground, or a stand), how it is drawn, the cone's size from smaller
 * (only what is strong counts) to bigger (scent counts sooner, the wind
 * wanders more), its strength, and the spot's coordinates; a party's drift
 * warning above them when there is one. The wind, spread, reach and reasons
 * that used to head the card live on the live card's brief line and the
 * cone itself. ‹ Back returns the live card; so does a tap off the card, on
 * the map (the app-wide rule, tapOff).
 */

// By person alone too, and Particles last (Gavan, 2026-10-19: "per person scent is really quite clear,
// should be an option when solo; particle is the last one, least useful but a bit informative in how it's built")
const VIEWS: { v: ScentView; name: string }[] = [
  { v: 'cloud', name: 'Cloud' },
  { v: 'people', name: 'By person' },
  { v: 'particles', name: 'Particles' },
]

export default function ScentCard(): JSX.Element | null {
  useLookTick()
  const people = useScent((s) => s.people)
  const group = useScent((s) => s.group)
  const pick = useScent((s) => s.pick)
  const view = useScent((s) => s.view)
  const risk = useScent((s) => s.risk)
  const strength = useScent((s) => s.strength)
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
  const height = at.height
  const shown = drawnView(view, n)
  const party = many && group ? { drift: groupSummary(group, people).drift } : null
  const placed = people.some((p) => !p.live)
  const who = (i: number) => (people[i]?.live ? 'You' : sitterName(people[i], i))

  return (
    <div className="topcard" ref={ref}>
      <div className="topcard-head">
        <button className="topcard-back" onClick={() => setTopCard(null)}>
          ‹ Back
        </button>
        <span className="topcard-title">Your scent</span>
      </div>
      <div className="topcard-body">
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
        {party?.drift && <div className="scent-line lc-amber">{party.drift}</div>}
        {at.party ? (
          // a party member's height is theirs, set on their phone
          <div className="scent-line">
            <span className="dim">{at.who} is</span> {at.height === GROUND_H ? 'on the ground' : `in a stand, ${heightWords(at.height, { digits: 1 })}`}
          </div>
        ) : (
        <div className="sc-sec">
          <span className="sc-sec-name">{at.live || !many ? "You're at" : `${k + 1} is at`}</span>
          <div className="seg" role="radiogroup" aria-label={at.live || !many ? 'Where you sit' : `Where ${k + 1} sits`}>
            {SCENT_HEIGHTS.map((h) => (
              <button key={h} className={height === h ? 'seg-on' : ''} role="radio" aria-checked={height === h} onClick={() => setHeight(h)}>
                {h === GROUND_H ? 'Ground' : `Stand ${heightWords(h, { digits: 1 })}`}
              </button>
            ))}
          </div>
        </div>
        )}
        <div className="sc-sec">
          <span className="sc-sec-name">Draw it as</span>
          <div className="seg" role="radiogroup" aria-label="How it is drawn">
            {VIEWS.map((o) => (
              <button key={o.v} className={shown === o.v ? 'seg-on' : ''} role="radio" aria-checked={shown === o.v} onClick={() => setView(o.v)}>
                {o.name}
              </button>
            ))}
          </div>
        </div>
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
          <span className="sc-sec-name">
            Strength <span className="numeral">· {Math.round(strength * 100)}%</span>
          </span>
          <input className="sc-slider" type="range" min={10} max={100} step={5} value={Math.round(strength * 100)} onChange={(e) => setStrength(Number(e.target.value) / 100)} aria-label="Strength" />
        </div>
        {/* where this one sits, to the metre; a tap copies it (Gavan, 2026-10-19: "Advanced on scent give me location") */}
        <div className="sc-sec">
          <span className="sc-sec-name">Location</span>
          <CopyCoord lon={at.lon} lat={at.lat} />
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

/** A spot's coordinates as a button: a tap copies them, and says so for a moment. */
function CopyCoord({ lon, lat }: { lon: number; lat: number }): JSX.Element {
  const [copied, setCopied] = useState(false)
  const text = fmtCoord(lon, lat)
  return (
    <button
      className="oc-coord numeral sc-coord"
      onClick={() => {
        void navigator.clipboard?.writeText(text)
        setCopied(true)
        window.setTimeout(() => setCopied(false), 900)
      }}
    >
      {copied ? 'Copied' : text}
    </button>
  )
}
