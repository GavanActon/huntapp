import { useEffect, type JSX } from 'react'
import { downloadFiles, mapsStatus, useDownloads } from '../../offline/downloads'
import { checkMapUpdates, useMapUpdates } from '../../offline/updates'
import { CONTOUR_INTERVALS, useAppStore } from '../../state/appStore'
import GuideSection from '../panels/GuideSection'
import './settings.css'

const TEXT_SIZES = [
  ['auto', 'Auto'],
  ['standard', 'A'],
  ['large', 'A+'],
  ['larger', 'A++'],
] as const

const STOPS = ['auto', 'standard', 'large', 'larger'] as const
const STREAK_W: Record<(typeof STOPS)[number], number> = { auto: 0, standard: 1.5, large: 2.6, larger: 3.7 }

/**
 * Settings, one level deep: the maps on the phone, the buttons, the hand,
 * units and text, then the wind flow's knobs and the contour interval, and
 * HuntOS, the field guide, folded at the foot. The
 * download runs in offline/downloads.ts, so closing the sheet does not stop
 * it. The host draws the title row.
 */
export default function SettingsSheet(): JSX.Element {
  const units = useAppStore((s) => s.units)
  const setUnits = useAppStore((s) => s.setUnits)
  const textSize = useAppStore((s) => s.textSize)
  const setTextSize = useAppStore((s) => s.setTextSize)
  const lowPower = useAppStore((s) => s.lowPower)
  const setLowPower = useAppStore((s) => s.setLowPower)
  const leftHanded = useAppStore((s) => s.leftHanded)
  const setLeftHanded = useAppStore((s) => s.setLeftHanded)
  const buttonLabels = useAppStore((s) => s.buttonLabels)
  const setButtonLabels = useAppStore((s) => s.setButtonLabels)
  const contourInterval = useAppStore((s) => s.contourInterval)
  const setContourInterval = useAppStore((s) => s.setContourInterval)
  const windFlowOpacity = useAppStore((s) => s.windFlowOpacity)
  const setWindFlowOpacity = useAppStore((s) => s.setWindFlowOpacity)
  const tune = useAppStore((s) => s.flowTuning)
  const setFlowTuning = useAppStore((s) => s.setFlowTuning)
  const windLevel = useAppStore((s) => s.windLevel)
  const setWindLevel = useAppStore((s) => s.setWindLevel)
  const who = useAppStore((s) => s.who)
  const setWho = useAppStore((s) => s.setWho)
  const pushSheet = useAppStore((s) => s.pushSheet)
  // what the Maps row reads: re-rendered when any of it moves
  useAppStore((s) => s.online)
  useMapUpdates((s) => s.pending)
  const dl = useDownloads()

  // opening Settings is a good moment to ask the server again
  useEffect(() => {
    void checkMapUpdates()
  }, [])

  const maps = mapsStatus()

  return (
    <div className="settings">
      <div className="st-row">
        <button onClick={() => pushSheet({ kind: 'offline' })}>Maps on this phone</button>
        {maps.action === 'download' ? (
          <button className="st-more" disabled={maps.disabled} onClick={() => void downloadFiles(maps.files, maps.replace)}>
            {maps.text}
          </button>
        ) : (
          <span className={dl.active ? 'st-more' : 'dim'}>{maps.text}</span>
        )}
      </div>
      {dl.active && (
        <div className="st-dl">
          <div className="dl-bar">
            <div className="dl-bar-fill" style={{ width: dl.total > 0 ? `${(dl.loaded / dl.total) * 100}%` : '30%' }} />
          </div>
        </div>
      )}
      <button className="st-row" onClick={() => pushSheet({ kind: 'buttons' })}>
        <span>Map buttons</span>
        <span className="dim">›</span>
      </button>
      <div className="st-row">
        <span>Thumb</span>
        <div className="seg" role="radiogroup" aria-label="Which hand">
          {([false, true] as const).map((left) => (
            <button key={String(left)} className={leftHanded === left ? 'seg-on' : ''} role="radio" aria-checked={leftHanded === left} onClick={() => setLeftHanded(left)}>
              {left ? 'Left' : 'Right'}
            </button>
          ))}
        </div>
      </div>
      <label className="st-row">
        <span>Button names</span>
        <input type="checkbox" className="switch" checked={buttonLabels} onChange={(e) => setButtonLabels(e.target.checked)} />
      </label>
      <div className="st-row">
        <span>Units</span>
        <div className="seg" role="radiogroup" aria-label="Units">
          {(['metric', 'imperial'] as const).map((u) => (
            <button key={u} className={units === u ? 'seg-on' : ''} role="radio" aria-checked={units === u} onClick={() => setUnits(u)}>
              {u === 'metric' ? '°C km/h' : '°F mph'}
            </button>
          ))}
        </div>
      </div>
      <div className="st-row">
        <span>Text size</span>
        <div className="seg" role="radiogroup" aria-label="Text size">
          {TEXT_SIZES.map(([t, label]) => (
            <button key={t} className={textSize === t ? 'seg-on' : ''} role="radio" aria-checked={textSize === t} onClick={() => setTextSize(t)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <label className="st-row">
        <span>
          Your initials <span className="dim">· on the wind checks you share</span>
        </span>
        <input type="text" className="st-text" value={who} maxLength={12} placeholder="GA" onChange={(e) => setWho(e.target.value)} aria-label="Your initials" />
      </label>
      <label className="st-row">
        <span>Low power</span>
        <input type="checkbox" className="switch" checked={lowPower} onChange={(e) => setLowPower(e.target.checked)} />
      </label>
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
        <span>
          Streaks <span className="dim">· eddies where the air swirls, or the straight drift</span>
        </span>
        <div className="seg" role="radiogroup" aria-label="Streaks">
          {([true, false] as const).map((on) => (
            <button key={String(on)} className={tune.windSwirl === on ? 'seg-on' : ''} role="radio" aria-checked={tune.windSwirl === on} onClick={() => setFlowTuning({ windSwirl: on })}>
              {on ? 'Eddies' : 'Straight'}
            </button>
          ))}
        </div>
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

      <div className="st-sec">HuntOS</div>
      <GuideSection />
    </div>
  )
}
