import { useMemo, useState, type JSX } from 'react'
import { useSpotsStore, weightsTuned } from '../../state/spotsStore'
import { pointCase, weighed } from '../../spots/scoring'
import { isFish, TARGET_NAMES } from '../../spots/types'
import { GROUP_NAMES, WEIGHT_DEFS, weightLabel, type Part, type WeightGroup } from '../../spots/weights'
import './digin.css'

/**
 * Scoring, one sheet under Dig in: the arithmetic behind the spot's score
 * (the habitat's parts, the site's multipliers, the day's factors, each
 * with its raw value and what its knob made of it), the day's notes, and
 * the knobs themselves, grouped and folded. A knob at 1 is the rule as
 * written; 0 removes it; 2 doubles its pull. The heat map, the pins and
 * the week follow every move.
 */

const GROUPS: WeightGroup[] = ['day', 'site', 'habitat']

/** "+12%" / "-8%" / "·" for a multiplier. */
function pct(m: number): string {
  const p = Math.round((m - 1) * 100)
  if (p === 0) return '·'
  return p > 0 ? `+${p}%` : `${p}%`
}

export default function ScoringSheet({ lon, lat }: { lon: number; lat: number }): JSX.Element {
  const target = useSpotsStore((s) => s.target)
  const conditions = useSpotsStore((s) => s.conditions)
  const result = useSpotsStore((s) => s.result)
  const weights = useSpotsStore((s) => s.weights)
  const setWeight = useSpotsStore((s) => s.setWeight)
  const resetWeights = useSpotsStore((s) => s.resetWeights)
  const [group, setGroup] = useState<WeightGroup | null>(null)

  const fish = isFish(target)
  const tuned = weightsTuned(weights)
  const pc = useMemo(() => (conditions ? pointCase(target, lon, lat, conditions, weights) : null), [target, lon, lat, conditions, weights])
  const defsOf = (g: WeightGroup) => WEIGHT_DEFS.filter((d) => d.group === g && (fish ? d.fish !== false && d.hunt !== true : d.hunt !== false && d.fish !== true))

  /** One part of the case: what it did, and what its knob made of it. */
  const partLine = (p: Part, k: number) => {
    const w = weights[p.key]
    const v = weighed(p, weights)
    const raw = p.kind === 'mult' ? pct(p.value) : `+${Math.round(p.value * 100)}`
    const shown = p.kind === 'mult' ? pct(v) : `+${Math.round(v * 100)}`
    const dir = p.kind === 'mult' ? (v > 1.02 ? 'up' : v < 0.98 ? 'down' : '') : v > 0 ? 'up' : ''
    return (
      <div key={k} className="sc-line">
        <span className={`sc-val ${dir}`}>{shown}</span>
        <span className="sc-label">
          {p.label}
          {p.note && <em> · {p.note}</em>}
          {w !== 1 && <em> · rule says {raw}</em>}
        </span>
        <span className={`sc-w${w <= 0 ? ' off' : ''}`}>{weightLabel(w)}</span>
      </div>
    )
  }

  const verdict = result?.verdict ?? null

  return (
    <div className="scoring">
      {pc ? (
        <>
          {pc.habitat.length > 0 && (
            <>
              <div className="scoring-sec">
                Habitat <b>{Math.round(pc.habitatScore * 100)}</b>
              </div>
              {pc.habitat.map(partLine)}
            </>
          )}
          {pc.site.length > 0 && (
            <>
              <div className="scoring-sec">
                Site <b>{pct(pc.siteMult)}</b>
              </div>
              {pc.site.map(partLine)}
            </>
          )}
          <div className="scoring-sec">
            The day <b>{pct(pc.dayMult)}</b>
          </div>
          {pc.day.map(partLine)}
          <div className="sc-sum">
            {fish ? (
              <>
                Spot <b>{Math.round(pc.score * 100)}</b> on the lake · the day <b>{pct(pc.dayMult)}</b> for the whole lake
              </>
            ) : (
              <>
                Habitat <b>{Math.round(pc.habitatScore * 100)}</b> × site <b>{pc.siteMult.toFixed(2)}</b> = <b>{Math.round(pc.score * 100)}</b> · the day <b>{pct(pc.dayMult)}</b> ranks the hours, not the places
              </>
            )}
          </div>
        </>
      ) : (
        <div className="digin-empty">{conditions ? 'Off the habitat grid' : 'No forecast cached'}</div>
      )}

      {/* ---- the day's verdict: every factor, and its notes ---- */}
      {verdict && (
        <>
          <div className="scoring-sec">
            {TARGET_NAMES[target]} <b>{verdict.headline}</b>
          </div>
          {verdict.factors.map((f, k) => (
            <div key={k} className="sc-line">
              <span className={`sc-val ${f.mult > 1.02 ? 'up' : f.mult < 0.98 ? 'down' : ''}`}>{pct(f.mult)}</span>
              <span className="sc-label">
                {f.label}
                {f.note && <em> · {f.note}</em>}
              </span>
              {f.key && <span className={`sc-w${weights[f.key] <= 0 ? ' off' : ''}`}>{weightLabel(weights[f.key])}</span>}
            </div>
          ))}
          {verdict.notes.map((n) => (
            <div key={n} className="sc-note">
              {n}
            </div>
          ))}
        </>
      )}

      {/* ---- the knobs, by group ---- */}
      <div className="scoring-sec">
        Knobs <em>{tuned ? 'adjusted' : 'as written'}</em>
      </div>
      {GROUPS.map((g) => {
        const defs = defsOf(g)
        if (!defs.length) return null
        const on = group === g
        const moved = defs.filter((d) => weights[d.key] !== 1).length
        return (
          <div key={g}>
            <button className="sc-fold" onClick={() => setGroup(on ? null : g)} aria-expanded={on}>
              <span>
                {GROUP_NAMES[g]} <span className="dim">{on ? '⌄' : '›'}</span>
              </span>
              <em>{moved ? `${moved} adjusted` : ''}</em>
            </button>
            {on &&
              defs.map((d) => (
                <div key={d.key} className="sc-knob">
                  <div className="sc-knob-text">
                    <span className="sc-knob-title">{d.label}</span>
                    <span className="sc-knob-desc">{d.desc}</span>
                  </div>
                  <input type="range" min={0} max={2} step={0.25} value={weights[d.key]} onChange={(e) => setWeight(d.key, Number(e.target.value))} aria-label={d.label} />
                  <span className={`sc-knob-val${weights[d.key] <= 0 ? ' off' : ''}`}>{weightLabel(weights[d.key])}</span>
                </div>
              ))}
          </div>
        )
      })}
      {tuned && (
        <button className="sc-reset" onClick={resetWeights}>
          Reset
        </button>
      )}
    </div>
  )
}
