import { CONTOUR_INTERVALS, useAppStore } from '../../state/appStore'
import { phoneTextStop } from '../textScale'
import OfflinePanel from './OfflinePanel'

export default function SettingsPanel() {
  const units = useAppStore((s) => s.units)
  const setUnits = useAppStore((s) => s.setUnits)
  const textSize = useAppStore((s) => s.textSize)
  const setTextSize = useAppStore((s) => s.setTextSize)
  const wxStrip = useAppStore((s) => s.wxStrip)
  const setWxStrip = useAppStore((s) => s.setWxStrip)
  const phoneStop = phoneTextStop()
  const windFlowOpacity = useAppStore((s) => s.windFlowOpacity)
  const setWindFlowOpacity = useAppStore((s) => s.setWindFlowOpacity)
  const tune = useAppStore((s) => s.flowTuning)
  const setFlowTuning = useAppStore((s) => s.setFlowTuning)
  const lowPower = useAppStore((s) => s.lowPower)
  const setLowPower = useAppStore((s) => s.setLowPower)
  const contourInterval = useAppStore((s) => s.contourInterval)
  const setContourInterval = useAppStore((s) => s.setContourInterval)
  const contoursOn = useAppStore((s) => s.layers.contours)

  return (
    <div className="panel">
      <div className="panel-section panel-section-first">Display</div>
      <div className="row">
        <div className="row-text">
          <span className="row-title">Units</span>
          <span className="row-desc">Temperature, wind and distance</span>
        </div>
        <div className="seg" role="radiogroup" aria-label="Units">
          {(['metric', 'imperial'] as const).map((u) => (
            <button key={u} className={units === u ? 'seg-on' : ''} role="radio" aria-checked={units === u} onClick={() => setUnits(u)}>
              {u === 'metric' ? '°C km/h' : '°F mph'}
            </button>
          ))}
        </div>
      </div>
      <div className="row">
        <div className="row-text">
          <span className="row-title">Text size</span>
          <span className="row-desc">{textSize === 'auto' ? `Follows the phone · ${phoneStop} now` : 'The strip and the sheet'}</span>
        </div>
        <div className="seg text-seg" role="radiogroup" aria-label="Text size">
          {(['auto', 'standard', 'large', 'larger'] as const).map((t) => (
            <button key={t} className={textSize === t ? 'seg-on' : ''} role="radio" aria-checked={textSize === t} onClick={() => setTextSize(t)}>
              {t === 'auto' ? 'Auto' : <span className={`text-a text-a-${t}`}>A</span>}
            </button>
          ))}
        </div>
      </div>
      <label className="row">
        <div className="row-text">
          <span className="row-title">Outlook strip</span>
          <span className="row-desc">Days and hours over the map</span>
        </div>
        <input type="checkbox" className="switch" checked={wxStrip} onChange={(e) => setWxStrip(e.target.checked)} />
      </label>

      <div className="panel-section">Terrain</div>
      <div className="row">
        <div className="row-text">
          <span className="row-title">Contour interval</span>
          <span className="row-desc">{contoursOn ? contourInterval <= 2 ? 'LiDAR lines near camp · every line labelled' : 'LiDAR lines near camp · every fifth is labelled' : 'LiDAR contours are off in Layers'}</span>
        </div>
        <div className="seg" role="radiogroup" aria-label="Contour interval">
          {CONTOUR_INTERVALS.map((m) => (
            <button key={m} className={contourInterval === m ? 'seg-on' : ''} role="radio" aria-checked={contourInterval === m} onClick={() => setContourInterval(m)}>
              {m} m
            </button>
          ))}
        </div>
      </div>

      <div className="panel-section">Wind flow</div>
      <div className="row layer-opacity">
        <div className="row-text">
          <span className="row-desc">Strength · {Math.round(windFlowOpacity * 100)}%</span>
        </div>
        <input type="range" min={10} max={100} step={5} value={Math.round(windFlowOpacity * 100)} onChange={(e) => setWindFlowOpacity(Number(e.target.value) / 100)} />
      </div>
      <div className="row layer-opacity">
        <div className="row-text">
          <span className="row-desc">Particles · {tune.windDensity}</span>
        </div>
        <input type="range" min={200} max={2500} step={100} value={tune.windDensity} onChange={(e) => setFlowTuning({ windDensity: Number(e.target.value) })} />
      </div>
      <div className="row layer-opacity">
        <div className="row-text">
          <span className="row-desc">Trail · {tune.windTrail.toFixed(2)}</span>
        </div>
        <input type="range" min={86} max={97} step={1} value={Math.round(tune.windTrail * 100)} onChange={(e) => setFlowTuning({ windTrail: Number(e.target.value) / 100 })} />
      </div>
      <label className="row">
        <div className="row-text">
          <span className="row-title">Low power</span>
          <span className="row-desc">Stills the wind for a long day on one battery</span>
        </div>
        <input type="checkbox" className="switch" checked={lowPower} onChange={(e) => setLowPower(e.target.checked)} />
      </label>

      <div className="panel-section">Maps offline</div>
      <OfflinePanel />
    </div>
  )
}
