import type { JSX } from 'react'
import { CONTOUR_INTERVALS, useAppStore } from '../../state/appStore'
import './settings.css'

const STOPS = ['auto', 'standard', 'large', 'larger'] as const
const STREAK_W: Record<(typeof STOPS)[number], number> = { auto: 0, standard: 1.5, large: 2.6, larger: 3.7 }

/**
 * Settings › More: the contour interval and the wind flow's look. The
 * knobs nobody turns twice in a season, one level under Settings.
 */
export default function SettingsMoreSheet(): JSX.Element {
  const contourInterval = useAppStore((s) => s.contourInterval)
  const setContourInterval = useAppStore((s) => s.setContourInterval)
  const windFlowOpacity = useAppStore((s) => s.windFlowOpacity)
  const setWindFlowOpacity = useAppStore((s) => s.setWindFlowOpacity)
  const tune = useAppStore((s) => s.flowTuning)
  const setFlowTuning = useAppStore((s) => s.setFlowTuning)
  const windLevel = useAppStore((s) => s.windLevel)
  const setWindLevel = useAppStore((s) => s.setWindLevel)

  return (
    <div className="settings">
      <div className="st-row">
        <span>Contour interval</span>
        <div className="seg" role="radiogroup" aria-label="Contour interval">
          {CONTOUR_INTERVALS.map((m) => (
            <button key={m} className={contourInterval === m ? 'seg-on' : ''} role="radio" aria-checked={contourInterval === m} onClick={() => setContourInterval(m)}>
              {m} m
            </button>
          ))}
        </div>
      </div>

      <div className="st-sec">Wind flow</div>
      <div className="st-row st-slider">
        <span>
          Strength <span className="numeral">· {Math.round(windFlowOpacity * 100)}%</span>
        </span>
        <input type="range" min={10} max={100} step={5} value={Math.round(windFlowOpacity * 100)} onChange={(e) => setWindFlowOpacity(Number(e.target.value) / 100)} aria-label="Strength" />
      </div>
      <div className="st-row">
        <span>Streak size</span>
        <div className="seg" role="radiogroup" aria-label="Streak size">
          {STOPS.map((t) => (
            <button key={t} className={tune.windSize === t ? 'seg-on' : ''} role="radio" aria-checked={tune.windSize === t} onClick={() => setFlowTuning({ windSize: t })} aria-label={t}>
              {t === 'auto' ? (
                'Auto'
              ) : (
                <svg className="streak-a" width="18" height="14" viewBox="0 0 18 14">
                  <line x1="3" y1="11" x2="15" y2="3" stroke="currentColor" strokeLinecap="round" strokeWidth={STREAK_W[t]} />
                </svg>
              )}
            </button>
          ))}
        </div>
      </div>
      <div className="st-row st-slider">
        <span>
          Particles <span className="numeral">· {tune.windDensity}</span>
        </span>
        <input type="range" min={200} max={2500} step={100} value={tune.windDensity} onChange={(e) => setFlowTuning({ windDensity: Number(e.target.value) })} aria-label="Particles" />
      </div>
      <div className="st-row st-slider">
        <span>
          Trail <span className="numeral">· {tune.windTrail.toFixed(2)}</span>
        </span>
        <input type="range" min={86} max={97} step={1} value={Math.round(tune.windTrail * 100)} onChange={(e) => setFlowTuning({ windTrail: Number(e.target.value) / 100 })} aria-label="Trail" />
      </div>
      <div className="st-row">
        <span>Wind flow at</span>
        <div className="seg" role="radiogroup" aria-label="Wind flow at">
          {(['ground', 'forecast'] as const).map((v) => (
            <button key={v} className={windLevel === v ? 'seg-on' : ''} role="radio" aria-checked={windLevel === v} onClick={() => setWindLevel(v)}>
              {v === 'ground' ? 'Ground' : 'Forecast'}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
