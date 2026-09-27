import { GROUND_H, plumeSummary, SCENT_HEIGHTS, useScent, type ScentView } from '../weather/micro/scent'
import WindCheckCard, { useCheckForm } from './WindCheckCard'
import { IconClose } from './icons'
import './ground.css'

// the wind check lives in its own card; the form store is still found here
export { useCheckForm }

/**
 * The ground-wind card, docked above the tabs like the ruler's: either the
 * scent cone's one-line summary, or a wind check being logged
 * (WindCheckCard).
 */

const VIEWS: { v: ScentView; name: string }[] = [
  { v: 'cloud', name: 'Cloud' },
  { v: 'particles', name: 'Particles' },
]

function ScentCard() {
  const plume = useScent((s) => s.plume)
  const clear = useScent((s) => s.clear)
  const view = useScent((s) => s.view)
  const setView = useScent((s) => s.setView)
  const height = useScent((s) => s.height)
  const setHeight = useScent((s) => s.setHeight)
  return (
    <div className="tripbuilder glass ground-card">
      <div className="tb-head">
        <span className="tb-title">Scent cone · 10 min sit</span>
        <button className="icon-btn" onClick={clear} aria-label="Hide scent cone">
          <IconClose size={16} />
        </button>
      </div>
      <div className="gc-line">{plume ? plumeSummary(plume) : 'Working out the ground wind…'}</div>
      <div className="gc-opts">
        <div className="seg" role="radiogroup" aria-label="Where you sit">
          {SCENT_HEIGHTS.map((h) => (
            <button key={h} className={height === h ? 'seg-on' : ''} role="radio" aria-checked={height === h} onClick={() => setHeight(h)}>
              {h === GROUND_H ? 'Ground' : `Stand ${h} m`}
            </button>
          ))}
        </div>
        <div className="seg" role="radiogroup" aria-label="How it is drawn">
          {VIEWS.map((o) => (
            <button key={o.v} className={view === o.v ? 'seg-on' : ''} role="radio" aria-checked={view === o.v} onClick={() => setView(o.v)}>
              {o.name}
            </button>
          ))}
        </div>
      </div>
      <div className="gc-note">
        {view === 'cloud'
          ? "Scent at a deer's nose: deep orange is strong, the pale wash only a trace."
          : "Each puff is scent drifting off you, widening as it goes and warmest where it is strong at a deer's nose; the dashed line is where it stops being noticeable."}{' '}
        Follows the ground model, not the forecast arrow.
      </div>
    </div>
  )
}

export default function GroundCard() {
  const checking = useCheckForm((s) => s.at != null)
  const scent = useScent((s) => s.source != null)
  if (checking) return <WindCheckCard />
  if (scent) return <ScentCard />
  return null
}
