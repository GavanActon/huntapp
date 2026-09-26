import { useEffect, useState } from 'react'
import { getMap } from '../../map/mapController'
import { useAppStore } from '../../state/appStore'
import { selectedPlace, usePlacesStore } from '../../state/placesStore'
import { DETAIL_NAMES, useSpotsStore, weightsTuned, type SpotsDetail } from '../../state/spotsStore'
import { pointCase, weighed } from '../../spots/scoring'
import { refreshSpots } from '../../spots/spotsLayer'
import { FISH_TARGETS, HUNT_TARGETS, TARGET_NAMES, isFish, type Target } from '../../spots/types'
import { compass8 } from '../../spots/conditions'
import { bestWindow, type WindowScore } from '../../spots/dayPlan'
import { GROUP_NAMES, WEIGHT_DEFS, weightLabel, type Part, type WeightGroup } from '../../spots/weights'
import { dayTimeLabel, isToday, timeLabel } from '../../time'
import { IconRefresh } from '../icons'

function pct(m: number): string {
  const p = Math.round((m - 1) * 100)
  if (p === 0) return '·'
  return p > 0 ? `+${p}%` : `${p}%`
}
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const grade = (a: number) => (a >= 0.85 ? 'go' : a >= 0.5 ? 'ok' : 'no')

/**
 * Where and when to be for the chosen target. Progressive: the week's
 * windows and the day's verdict lead; the case for a point (the pin or a
 * tapped probe) unfolds from a score to its reasons to the arithmetic;
 * the knobs on the scorer sit folded at the bottom. Everything is computed
 * on the phone from the baked habitat grid and the cached forecast.
 */
export default function SpotsPanel() {
  const target = useSpotsStore((s) => s.target)
  const setTarget = useSpotsStore((s) => s.setTarget)
  const heat = useSpotsStore((s) => s.heat)
  const setHeat = useSpotsStore((s) => s.setHeat)
  const scent = useSpotsStore((s) => s.scent)
  const setScent = useSpotsStore((s) => s.setScent)
  const detail = useSpotsStore((s) => s.detail)
  const setDetail = useSpotsStore((s) => s.setDetail)
  const weights = useSpotsStore((s) => s.weights)
  const setWeight = useSpotsStore((s) => s.setWeight)
  const resetWeights = useSpotsStore((s) => s.resetWeights)
  const probe = useSpotsStore((s) => s.probe)
  const setProbe = useSpotsStore((s) => s.setProbe)
  const plans = useSpotsStore((s) => s.plans)
  const brief = detail === 'brief'
  const full = detail === 'full'
  const reasonCap = brief ? 1 : full ? 99 : 3
  const result = useSpotsStore((s) => s.result)
  const cond = useSpotsStore((s) => s.conditions)
  const status = useSpotsStore((s) => s.status)
  const planTimeMs = useAppStore((s) => s.planTimeMs)
  const setPlanTime = useAppStore((s) => s.setPlanTime)
  const units = useAppStore((s) => s.units)
  const selectedId = usePlacesStore((s) => s.selectedId)
  const [open, setOpen] = useState<number | null>(0)
  // the case's depth, walked one step at a time: score → reasons → arithmetic
  const [caseDepth, setCaseDepth] = useState<0 | 1 | 2>(brief ? 0 : 1)
  const [knobs, setKnobs] = useState(false)
  const [knobGroup, setKnobGroup] = useState<WeightGroup | null>('site')

  useEffect(() => {
    const on = (e: Event) => setOpen(((e as CustomEvent<number>).detail ?? 1) - 1)
    window.addEventListener('spots:pick', on)
    return () => window.removeEventListener('spots:pick', on)
  }, [])
  // a probe from the map opens at the reasons, ready to dig in
  useEffect(() => {
    if (probe) setCaseDepth(1)
  }, [probe])

  const temp = (c: number) => (units === 'imperial' ? `${Math.round(c * 1.8 + 32)}°F` : `${Math.round(c)}°C`)
  const wind = (k: number) => (units === 'imperial' ? `${Math.round(k * 0.621371)} mph` : `${Math.round(k)} km/h`)
  const sel = selectedPlace()
  const subj = sel ?? probe
  const pc = subj && cond ? pointCase(target, subj.lon, subj.lat, cond, weights) : null
  const fish = isFish(target)
  const tuned = weightsTuned(weights)

  const go = (lon: number, lat: number) => {
    const m = getMap()
    m?.easeTo({ center: [lon, lat], zoom: Math.max(m.getZoom(), 14) })
  }

  const chips = (list: Target[]) =>
    list.map((t) => (
      <button key={t} className={`chip chip-pick${t === target ? ' chip-on' : ''}`} onClick={() => setTarget(t)}>
        {TARGET_NAMES[t]}
      </button>
    ))

  const best = bestWindow(plans)
  const activeWin = (w: WindowScore | null) => !!w && planTimeMs != null && planTimeMs >= w.startMs && planTimeMs <= w.endMs

  const winCell = (w: WindowScore | null, isBest: boolean) =>
    w ? (
      <button
        className={`win win-${grade(w.activity)}${isBest ? ' win-best' : ''}${activeWin(w) ? ' win-on' : ''}`}
        onClick={() => setPlanTime(w.atMs)}
        title={`${w.headline} · best at ${timeLabel(w.atMs)}`}
      >
        <b>{Math.round(w.activity * 100)}</b>
        <span>
          {w.slot === 'morning' ? 'AM' : 'PM'} · {timeLabel(w.atMs)}
        </span>
      </button>
    ) : (
      <span className="win win-gone">
        <b>·</b>
        <span>past</span>
      </span>
    )

  const partLine = (p: Part, k: number) => {
    const w = weights[p.key]
    const v = weighed(p, weights)
    const raw = p.kind === 'mult' ? pct(p.value) : `+${Math.round(p.value * 100)}`
    const shown = p.kind === 'mult' ? pct(v) : `+${Math.round(v * 100)}`
    const dir = p.kind === 'mult' ? (v > 1.02 ? 'up' : v < 0.98 ? 'down' : '') : v > 0 ? 'up' : ''
    return (
      <div key={k} className="case-line">
        <span className={`case-val ${dir}`}>{shown}</span>
        <span className="case-label">
          {p.label}
          {p.note && <em> · {p.note}</em>}
          {w !== 1 && <em> · rule says {raw}</em>}
        </span>
        <span className={`case-w${w <= 0 ? ' off' : ''}`}>{weightLabel(w)}</span>
      </div>
    )
  }

  return (
    <div className="panel spots-panel">
      <div className="spots-targets">
        <div className="spots-chiprow">{chips(HUNT_TARGETS)}</div>
        <div className="spots-chiprow">{chips(FISH_TARGETS)}</div>
      </div>

      {status === 'no-grid' && <div className="empty">No habitat grid for this region yet. Run pipeline/build_habitat.py and download the bundle.</div>}
      {status === 'no-forecast' && <div className="empty">No forecast cached yet. The verdict needs one fetch with signal.</div>}
      {status === 'idle' && <div className="empty">Working it out…</div>}

      {result && cond && (
        <>
          {/* ---- the week: morning and evening windows, one suggested ---- */}
          {plans.length > 0 && (
            <>
              <div className="panel-section panel-section-first">This week · {fish ? 'dawn and dusk bites' : 'morning and evening hunts'}</div>
              {best && (
                <div className="week-pick">
                  Best bet: <b>{isToday(best.plan.dayStartMs) ? 'today' : DAYS[new Date(best.plan.dayStartMs).getDay()]} {best.win.slot}</b> · {best.win.headline} · around {timeLabel(best.win.atMs)}
                </div>
              )}
              <div className="week">
                {plans.slice(0, brief ? 3 : 7).map((p) => (
                  <div key={p.dayStartMs} className="week-row">
                    <span className="week-day">{isToday(p.dayStartMs) ? 'Today' : DAYS[new Date(p.dayStartMs).getDay()]}</span>
                    {winCell(p.morning, p.best === 'morning')}
                    {winCell(p.evening, p.best === 'evening')}
                  </div>
                ))}
              </div>
              <div className="panel-note row-desc">Tap a window to plan it; the strip above picks any single hour.</div>
            </>
          )}

          {/* ---- the day's verdict at the planning time ---- */}
          <div className={`verdict glass-inset v-${grade(result.verdict.activity)}`}>
            <div className="verdict-head">
              <div>
                <div className="verdict-title">{result.verdict.headline}</div>
                <div className="row-desc">
                  {dayTimeLabel(cond.timeMs)} · {wind(cond.windKmh)} {compass8(cond.windDir)} · {temp(cond.tempC)} · cloud {Math.round(cond.cloudPct)}%
                  {planTimeMs == null ? '' : ' · planning time'}
                </div>
              </div>
              <button className="icon-btn" onClick={() => refreshSpots()} aria-label="Recompute">
                <IconRefresh size={18} />
              </button>
            </div>
            {result.verdict.warnings.map((w) => (
              <div key={w} className="verdict-warn">
                {w}
              </div>
            ))}
            {!brief && (
              <div className="verdict-factors">
                {(full ? result.verdict.factors : result.verdict.factors.filter((f) => Math.abs(f.mult - 1) >= 0.05).slice(0, 4)).map((f, k) => (
                  <div key={k} className="vf-row">
                    <span className={`vf-mult ${f.mult > 1.02 ? 'up' : f.mult < 0.98 ? 'down' : ''}`}>{pct(f.mult)}</span>
                    <span className="vf-label">
                      {f.label}
                      {f.note && <em> · {f.note}</em>}
                      {f.key && weights[f.key] !== 1 && <em className="case-w"> · {weightLabel(weights[f.key])}</em>}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {full && result.verdict.notes.length > 0 && (
              <div className="verdict-notes">
                {result.verdict.notes.map((n) => (
                  <div key={n} className="row-desc">
                    {n}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="spots-switches">
            <span className="spots-mode" role="radiogroup" aria-label="How much detail">
              {(Object.keys(DETAIL_NAMES) as SpotsDetail[]).map((d) => (
                <button key={d} role="radio" aria-checked={detail === d} className={`spots-mode-btn${detail === d ? ' on' : ''}`} onClick={() => setDetail(d)}>
                  {DETAIL_NAMES[d]}
                </button>
              ))}
            </span>
            <label className="chip chip-pick">
              <input type="checkbox" checked={heat} onChange={(e) => setHeat(e.target.checked)} /> heat map
            </label>
            {heat && (
              <span className="spots-legend" aria-label="Heat map bands: good, better, best">
                <i className="b1" />
                <i className="b2" />
                <i className="b3" />
                <span>good → best for {TARGET_NAMES[target].toLowerCase()}</span>
              </span>
            )}
            {!fish && (
              <label className="chip chip-pick">
                <input type="checkbox" checked={scent} onChange={(e) => setScent(e.target.checked)} /> scent cone at the pin
              </label>
            )}
          </div>

          {/* ---- the case for a point: score → reasons → arithmetic ---- */}
          {subj && pc && (
            <>
              <div className="panel-section">
                {sel ? `Your pin · ${sel.name}` : 'Tapped point'}
                {!sel && probe && (
                  <button className="linklike" style={{ marginLeft: 8 }} onClick={() => setProbe(null)}>
                    clear
                  </button>
                )}
              </div>
              <div className="spot-row">
                <button className="spot-head" onClick={() => setCaseDepth(caseDepth === 0 ? 1 : caseDepth === 1 ? 2 : 0)}>
                  <span className="spot-score">{Math.round(pc.score * 100)}</span>
                  <span className="row-text">
                    <span className="row-title">{fish ? 'as a fishing spot' : 'as a stand'} at {timeLabel(cond.timeMs)}</span>
                    <span className="row-desc">{caseDepth === 0 ? 'tap for why' : caseDepth === 1 ? 'tap for the arithmetic' : 'tap to fold'}</span>
                  </span>
                </button>
                {caseDepth >= 1 && (
                  <ul className="spot-reasons">
                    {pc.reasons.slice(0, caseDepth === 2 ? 99 : reasonCap).map((r, k) => (
                      <li key={k}>{r}</li>
                    ))}
                  </ul>
                )}
                {caseDepth === 2 && (
                  <div className="case">
                    {pc.habitat.length > 0 && (
                      <>
                        <div className="panel-section">Habitat · {Math.round(pc.habitatScore * 100)}</div>
                        {pc.habitat.map(partLine)}
                      </>
                    )}
                    {pc.site.length > 0 && (
                      <>
                        <div className="panel-section">Site · {pct(pc.siteMult)}</div>
                        {pc.site.map(partLine)}
                      </>
                    )}
                    <div className="panel-section">The day · {pct(pc.dayMult)}</div>
                    {pc.day.map(partLine)}
                    <div className="case-sum">
                      {fish ? (
                        <>
                          Spot <b>{Math.round(pc.score * 100)}</b> on the lake; the day multiplies the whole lake by <b>{pct(pc.dayMult)}</b>.
                        </>
                      ) : (
                        <>
                          Habitat <b>{Math.round(pc.habitatScore * 100)}</b> × site <b>{pc.siteMult.toFixed(2)}</b> = <b>{Math.round(pc.score * 100)}</b>. The day&apos;s <b>{pct(pc.dayMult)}</b> moves every
                          spot alike, so it ranks the hours, not the places.
                        </>
                      )}
                    </div>
                    <button className="linklike" onClick={() => setKnobs(true)}>
                      adjust the scoring ▸
                    </button>
                  </div>
                )}
              </div>
            </>
          )}

          {/* ---- the best few ---- */}
          <div className="panel-section">Best spots {fish ? 'on the water' : 'in the bush'}</div>
          {result.spots.length === 0 && <div className="empty">Nothing scores above the bar right now{fish && result.verdict.warnings.length ? ': season or weather' : ''}.</div>}
          {result.spots.map((s, k) => (
            <div key={s.cell} className={`spot-row${open === k ? ' spot-open' : ''}`}>
              <button
                className="spot-head"
                onClick={() => {
                  setOpen(open === k ? null : k)
                  go(s.lon, s.lat)
                }}
              >
                <span className="spot-num">{k + 1}</span>
                <span className="row-text">
                  <span className="row-title">{s.title}</span>
                  {!brief && <span className="row-desc">{s.reasons[0]}</span>}
                </span>
                <span className="spot-score">{Math.round(s.score * 100)}</span>
              </button>
              {open === k && (
                <ul className="spot-reasons">
                  {s.reasons.slice(brief ? 0 : 1, reasonCap).map((r, j) => (
                    <li key={j}>{r}</li>
                  ))}
                  <li className="spot-coords">
                    {s.lat.toFixed(5)}, {s.lon.toFixed(5)}
                    <button
                      className="linklike"
                      style={{ marginLeft: 8 }}
                      onClick={() => {
                        usePlacesStore.getState().select(null)
                        setProbe({ lon: s.lon, lat: s.lat, name: s.title })
                        setCaseDepth(2)
                      }}
                    >
                      the arithmetic ▸
                    </button>
                  </li>
                </ul>
              )}
            </div>
          ))}

          {/* ---- the knobs, folded ---- */}
          <button className="fold" onClick={() => setKnobs(!knobs)} aria-expanded={knobs}>
            <span>Scoring {knobs ? '▾' : '▸'}</span>
            <em>{tuned ? 'adjusted' : 'as written'}</em>
          </button>
          {knobs && (
            <div className="knobs">
              <div className="panel-note row-desc">
                Each part of a score has a knob. Normal is the rule as written; off removes it (turn off Roads and landings to ignore roads); double leans on it. The heat map, the spots and the week follow.
              </div>
              {(['day', 'site', 'habitat'] as WeightGroup[]).map((g) => {
                const defs = WEIGHT_DEFS.filter((d) => d.group === g && (fish ? d.fish !== false && d.hunt !== true : d.hunt !== false && d.fish !== true))
                if (!defs.length) return null
                const on = knobGroup === g
                return (
                  <div key={g}>
                    <button className="fold" onClick={() => setKnobGroup(on ? null : g)} aria-expanded={on}>
                      <span>
                        {GROUP_NAMES[g]} {on ? '▾' : '▸'}
                      </span>
                      <em>{defs.filter((d) => weights[d.key] !== 1).length ? `${defs.filter((d) => weights[d.key] !== 1).length} adjusted` : ''}</em>
                    </button>
                    {on &&
                      defs.map((d) => (
                        <div key={d.key} className="knob">
                          <div className="knob-text">
                            <span className="knob-title">{d.label}</span>
                            <span className="knob-desc">{d.desc}</span>
                          </div>
                          <input type="range" min={0} max={2} step={0.25} value={weights[d.key]} onChange={(e) => setWeight(d.key, Number(e.target.value))} aria-label={d.label} />
                          <span className={`knob-val${weights[d.key] <= 0 ? ' off' : ''}`}>{weightLabel(weights[d.key])}</span>
                        </div>
                      ))}
                  </div>
                )
              })}
              {tuned && (
                <button className="btn-secondary" onClick={resetWeights}>
                  Back to the rules as written
                </button>
              )}
            </div>
          )}
          {full && (
            <div className="panel-note row-desc">
              Scores blend the habitat (Ontario FRI stands, burns, LiDAR-derived landform, water) with the hour&apos;s wind, light and temperature; see docs/HUNT-FISH-SCIENCE.md for the rules and their sources. Depths are estimates. Not a substitute for the regulations.
            </div>
          )}
        </>
      )}
      {!result && status === 'ready' && <div className="empty">Nothing to score.</div>}
      {selectedId == null && !probe && !fish && status === 'ready' && <div className="panel-note row-desc">Tap the map or select a pin to check a spot as a stand and see your scent cone.</div>}
    </div>
  )
}
