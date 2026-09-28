import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { compass } from '../weather/openMeteo'
import { groundWind, loadMicro, REGIME_LABEL, type Regime } from '../weather/micro/model'
import { STRENGTH_LABEL, useWindChecks, verdict, type Strength, type WindCheck } from '../weather/micro/windChecks'
import { requestCompass, startCompass, stopCompass, useCompass } from '../tracking/compass'
import { IconClose } from './icons'
import Rose, { Arrow } from './Rose'
import './ground.css'

/**
 * A wind check, docked above the tabs: which way the powder goes and how
 * hard, then Save. The model's own call for that spot and minute is saved
 * beside it before the check can sway it.
 *
 * The rose turns with the phone when it has a compass, so the arrow to tap
 * is the one pointing where the powder really goes, not a compass point to
 * work out in the bush; without one, north is up. Whatever is picked lights
 * up (a compass heading lights its nearest arrow), and Save always answers:
 * saved, or what is still missing.
 */

interface CheckForm {
  at: { lon: number; lat: number; label: string } | null
  open: (lon: number, lat: number, label: string) => void
  close: () => void
}
export const useCheckForm = create<CheckForm>((set) => ({
  at: null,
  open: (lon, lat, label) => {
    // from the tap that opened the form: iOS only grants the compass from one
    void requestCompass()
    set({ at: { lon, lat, label } })
  },
  close: () => set({ at: null }),
}))

const STRENGTHS: Strength[] = ['calm', 'drift', 'light', 'breezy', 'windy']

export default function WindCheckCard() {
  const at = useCheckForm((s) => s.at)!
  const close = useCheckForm((s) => s.close)
  const add = useWindChecks((s) => s.add)
  const heading = useCompass((s) => s.heading)
  const status = useCompass((s) => s.status)
  const [toward, setToward] = useState<number | null>(null)
  const [strength, setStrength] = useState<Strength | null>(null)
  const [missing, setMissing] = useState<string | null>(null)
  const [saved, setSaved] = useState<WindCheck | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    startCompass()
    return () => stopCompass()
  }, [])

  // the rose turns so its top is where the phone points
  const live = status === 'on' && heading != null
  const turn = live ? heading : 0
  const calm = strength === 'calm'

  const pick = (deg: number) => {
    setToward(Math.round(((deg % 360) + 360) % 360))
    if (calm) setStrength(null)
    setMissing(null)
  }

  const save = async () => {
    if (!strength && toward == null) return setMissing('Tap the arrow the powder follows, then how hard it is blowing (or calm)')
    if (!strength) return setMissing('Tap how hard it is blowing')
    if (!calm && toward == null) return setMissing('Tap the arrow the powder follows')
    setSaving(true)
    const now = Date.now()
    // the model's call first, before this check can sway it; a check is
    // still worth saving without one (offline before the model loaded)
    let g: ReturnType<typeof groundWind> = null
    try {
      await loadMicro()
      g = groundWind(at.lon, at.lat, now)
    } catch {
      g = null
    }
    const c = add({
      ts: now,
      lon: at.lon,
      lat: at.lat,
      dirFrom: calm || toward == null ? null : (toward + 180) % 360,
      strength,
      source: 'hand',
      model: g ? { dirFrom: g.dirFrom, kmh: g.kmh, regime: g.regime, sigmaDeg: g.sigmaDeg } : undefined,
    })
    setSaving(false)
    setSaved(c)
  }

  if (saved) {
    const v = verdict(saved)
    const m = saved.model
    return (
      <div className="tripbuilder glass ground-card">
        <div className="tb-head">
          <span className="tb-title">Wind check saved</span>
          <button className="icon-btn" onClick={close} aria-label="Close">
            <IconClose size={16} />
          </button>
        </div>
        <div className="gc-line">
          You: {saved.dirFrom == null ? 'calm' : <>toward {compass((saved.dirFrom + 180) % 360)}, {saved.strength}</>}
        </div>
        {m && (
          <div className="gc-line">
            Model: {m.kmh < 1 ? 'near calm' : <>toward {compass((m.dirFrom + 180) % 360)}, {m.kmh.toFixed(1)} km/h</>} · {(REGIME_LABEL[m.regime as Regime] ?? m.regime).toLowerCase()}
            {v && <b className={`gc-verdict gc-${v}`}>{v === 'agree' ? 'agreed' : v === 'close' ? 'close' : 'missed'}</b>}
          </div>
        )}
        <div className="gc-note">Blended into the ground wind within ~300 m for the next hour or two.</div>
      </div>
    )
  }

  return (
    <div className="tripbuilder glass ground-card">
      <div className="tb-head">
        <span className="tb-title">Wind check · {at.label}</span>
        <button className="icon-btn" onClick={close} aria-label="Close">
          <IconClose size={16} />
        </button>
      </div>
      <div className="gc-q">Which way does the powder go?</div>
      <Rose turn={turn} value={calm ? null : toward} onPick={pick} label={(b) => `toward ${compass(b)}`}>
        {calm ? (
          <span className="gc-mid-word">calm</span>
        ) : toward != null ? (
          <span className="gc-mid-pick">
            <Arrow toward={toward - turn} size={30} />
            <b>{compass(toward)}</b>
          </span>
        ) : live ? (
          <button className="gc-lock" onClick={() => pick(heading)}>
            <Arrow toward={0} size={20} />
            <span>ahead</span>
          </button>
        ) : (
          <span className="gc-mid-word">tap an arrow</span>
        )}
      </Rose>
      <div className="gc-note">
        {live
          ? 'The rose turns with the phone: tap the arrow pointing where the powder drifts, or "ahead" if it goes the way the phone points.'
          : status === 'denied'
            ? 'North is up (the compass is blocked: allow Motion & Orientation for this site to have the rose turn with the phone).'
            : status === 'none'
              ? 'North is up: this phone gives no compass reading.'
              : 'North is up.'}
      </div>
      <div className="gc-q">How hard?</div>
      <div className="gc-strength">
        {STRENGTHS.map((s) => (
          <button
            key={s}
            className={`chip-pick${strength === s ? ' chip-on' : ''}`}
            onClick={() => {
              setStrength(s)
              setMissing(null)
            }}
            aria-pressed={strength === s}
          >
            {s}
          </button>
        ))}
      </div>
      {strength && <div className="gc-note">{STRENGTH_LABEL[strength]}</div>}
      {missing && <div className="gc-missing">{missing}</div>}
      <button className="btn-primary" disabled={saving} onClick={() => void save()}>
        {saving ? 'Saving…' : 'Save check'}
      </button>
    </div>
  )
}
