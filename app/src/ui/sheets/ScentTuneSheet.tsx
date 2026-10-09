import { type JSX } from 'react'
import { DEFAULTS, GROUPS, tunedCount, useScentTune, type Knob } from '../../weather/micro/scentTune'
import { useScent } from '../../weather/micro/scent'
import '../live.css'
import './settings.css'

/**
 * Scent tuning: every knob of the scent model on a slider, with its
 * modelled value marked, for tuning in the field against what the moose
 * do (Gavan, 2026-10-09). A change redraws the cone at once; the values
 * stay on this phone. Reset puts one, or all, back to the model's.
 */

function fmt(v: number, k: Knob): string {
  const d = k.step < 1 ? (k.step < 0.1 ? 2 : 1) : 0
  return `${v.toFixed(d)}${k.unit ?? ''}`
}

function Row({ k }: { k: Knob }): JSX.Element {
  const v = useScentTune((s) => s.values[k.key])
  const set = useScentTune((s) => s.set)
  const clear = useScentTune((s) => s.clear)
  const value = v ?? DEFAULTS[k.key]
  const changed = v != null && v !== DEFAULTS[k.key]
  return (
    <div className="st-tune">
      <div className="st-tune-head">
        <span>
          {k.label}
          <small>{k.hint}</small>
        </span>
        <span className={changed ? 'st-tune-val st-tune-on' : 'st-tune-val'}>
          {fmt(value, k)}
          {changed && (
            <button className="linklike" onClick={() => clear(k.key)} aria-label={`back to ${fmt(DEFAULTS[k.key], k)}`}>
              was {fmt(DEFAULTS[k.key], k)}
            </button>
          )}
        </span>
      </div>
      <input className="sc-slider" type="range" min={k.min} max={k.max} step={k.step} value={value} onChange={(e) => set(k.key, Number(e.target.value))} aria-label={k.label} aria-valuetext={fmt(value, k)} />
    </div>
  )
}

export default function ScentTuneSheet(): JSX.Element {
  const n = useScentTune((s) => Object.keys(s.values).length) && tunedCount()
  const reset = useScentTune((s) => s.reset)
  const people = useScent((s) => s.people.length)
  return (
    <div className="st-body">
      <div className="st-note">
        Dev. Each slider is a constant of the scent model at its modelled value. A change redraws the cone at once and stays on this phone.
        {people ? '' : ' Place yourself on the map first to see the cone move.'}
      </div>
      <div className="st-row">
        <span>
          {n ? `${n} knob${n === 1 ? '' : 's'} off the model` : 'All as modelled'}
        </span>
        {n > 0 && (
          <button className="linklike" onClick={reset}>
            reset all
          </button>
        )}
      </div>
      {GROUPS.map((g) => (
        <div key={g.name}>
          <div className="st-sec">{g.name}</div>
          {g.knobs.map((k) => (
            <Row key={k.key} k={k} />
          ))}
        </div>
      ))}
    </div>
  )
}
