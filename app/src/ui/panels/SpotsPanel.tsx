import { useEffect, useState } from 'react'
import { getMap } from '../../map/mapController'
import { useAppStore } from '../../state/appStore'
import { selectedPlace, usePlacesStore } from '../../state/placesStore'
import { DETAIL_NAMES, useSpotsStore, type SpotsDetail } from '../../state/spotsStore'
import { explainPoint } from '../../spots/scoring'
import { refreshSpots } from '../../spots/spotsLayer'
import { FISH_TARGETS, HUNT_TARGETS, TARGET_NAMES, isFish, type Target } from '../../spots/types'
import { compass8 } from '../../spots/conditions'
import { dayTimeLabel } from '../../time'
import { IconRefresh } from '../icons'

function pct(m: number): string {
  const p = Math.round((m - 1) * 100)
  if (p === 0) return '·'
  return p > 0 ? `+${p}%` : `${p}%`
}

/** Where to be for the chosen target at the planning time: the day's
 *  verdict with its reasons, the best few spots, and a check of the
 *  selected pin. Everything is computed on the phone from the baked
 *  habitat grid and the cached forecast, so it works at camp. */
export default function SpotsPanel() {
  const target = useSpotsStore((s) => s.target)
  const setTarget = useSpotsStore((s) => s.setTarget)
  const heat = useSpotsStore((s) => s.heat)
  const setHeat = useSpotsStore((s) => s.setHeat)
  const scent = useSpotsStore((s) => s.scent)
  const setScent = useSpotsStore((s) => s.setScent)
  const detail = useSpotsStore((s) => s.detail)
  const setDetail = useSpotsStore((s) => s.setDetail)
  const brief = detail === 'brief'
  const full = detail === 'full'
  // how many reasons a spot or a pin shows before the mode says stop
  const reasonCap = brief ? 1 : full ? 99 : 3
  const result = useSpotsStore((s) => s.result)
  const cond = useSpotsStore((s) => s.conditions)
  const status = useSpotsStore((s) => s.status)
  const planTimeMs = useAppStore((s) => s.planTimeMs)
  const units = useAppStore((s) => s.units)
  const selectedId = usePlacesStore((s) => s.selectedId)
  const [open, setOpen] = useState<number | null>(0)

  useEffect(() => {
    const on = (e: Event) => setOpen(((e as CustomEvent<number>).detail ?? 1) - 1)
    window.addEventListener('spots:pick', on)
    return () => window.removeEventListener('spots:pick', on)
  }, [])

  const temp = (c: number) => (units === 'imperial' ? `${Math.round(c * 1.8 + 32)}°F` : `${Math.round(c)}°C`)
  const wind = (k: number) => (units === 'imperial' ? `${Math.round(k * 0.621371)} mph` : `${Math.round(k)} km/h`)
  const sel = selectedPlace()
  const check = sel && cond ? explainPoint(target, sel.lon, sel.lat, cond) : null
  const fish = isFish(target)

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
          <div className={`verdict glass-inset v-${result.verdict.activity >= 0.85 ? 'go' : result.verdict.activity >= 0.5 ? 'ok' : 'no'}`}>
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

          {sel && check && (
            <>
              <div className="panel-section">Your pin · {sel.name}</div>
              <div className="spot-row">
                <div className="spot-head">
                  <span className="spot-score">{Math.round(check.score * 100)}</span>
                  <span className="row-title">{fish ? 'as a fishing spot' : 'as a stand'} right now</span>
                </div>
                <ul className="spot-reasons">
                  {check.reasons.slice(0, reasonCap).map((r, k) => (
                    <li key={k}>{r}</li>
                  ))}
                </ul>
              </div>
            </>
          )}

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
                  </li>
                </ul>
              )}
            </div>
          ))}
          {full && (
          <div className="panel-note row-desc">
            Scores blend the habitat (Ontario FRI stands, burns, LiDAR-derived landform, water) with the hour's wind, light and temperature; see docs/HUNT-FISH-SCIENCE.md for the rules and their sources. Depths are estimates. Not a substitute for the regulations.
          </div>
          )}
        </>
      )}
      {!result && status === 'ready' && <div className="empty">Nothing to score.</div>}
      {selectedId == null && !fish && status === 'ready' && <div className="panel-note row-desc">Select or drop a pin to check it as a stand and see your scent cone.</div>}
    </div>
  )
}
