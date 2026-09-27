import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { compass } from '../weather/openMeteo'
import { groundWind, loadMicro, REGIME_LABEL, type Regime } from '../weather/micro/model'
import { plumeSummary, useScent } from '../weather/micro/scent'
import { STRENGTH_LABEL, useWindChecks, verdict, type Strength, type WindCheck } from '../weather/micro/windChecks'
import { IconClose } from './icons'
import './ground.css'

/**
 * The ground-wind card, docked above the tabs like the ruler's: either the
 * scent cone's one-line summary, or a wind check being logged. A check is
 * two taps: which way the powder goes, and how hard; the model's own call
 * for that spot and minute is saved beside it before it can learn from it.
 */

interface CheckForm {
  at: { lon: number; lat: number; label: string } | null
  open: (lon: number, lat: number, label: string) => void
  close: () => void
}
export const useCheckForm = create<CheckForm>((set) => ({
  at: null,
  open: (lon, lat, label) => set({ at: { lon, lat, label } }),
  close: () => set({ at: null }),
}))

const ROSE = [0, 45, 90, 135, 180, 225, 270, 315]
const STRENGTHS: Strength[] = ['calm', 'drift', 'light', 'breezy', 'windy']

function Arrow({ toward, size = 18 }: { toward: number; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" style={{ transform: `rotate(${toward}deg)` }} aria-hidden>
      <path d="M7 1.5 L10 10 L7 8 L4 10 Z" fill="currentColor" />
    </svg>
  )
}

/** The phone's compass heading (where the top of the phone points), when
 *  it has one and is allowed. 'none' after a few seconds without a reading. */
function useHeading(active: boolean): number | null | 'none' {
  const [h, setH] = useState<number | null | 'none'>(null)
  useEffect(() => {
    if (!active) return
    setH(null)
    let got = false
    const on = (e: DeviceOrientationEvent & { webkitCompassHeading?: number }) => {
      // the screen may be turned: the top of the phone is then not "up" on screen
      const turn = (screen.orientation?.angle ?? 0) as number
      let v: number | null = null
      if (typeof e.webkitCompassHeading === 'number') v = e.webkitCompassHeading
      else if (e.absolute && e.alpha != null) v = 360 - e.alpha
      if (v == null || Number.isNaN(v)) return
      got = true
      setH((((v + turn) % 360) + 360) % 360)
    }
    window.addEventListener('deviceorientationabsolute', on as EventListener)
    window.addEventListener('deviceorientation', on as EventListener)
    const t = window.setTimeout(() => {
      if (!got) setH('none')
    }, 3000)
    return () => {
      window.clearTimeout(t)
      window.removeEventListener('deviceorientationabsolute', on as EventListener)
      window.removeEventListener('deviceorientation', on as EventListener)
    }
  }, [active])
  return h
}

function CheckCard() {
  const at = useCheckForm((s) => s.at)!
  const close = useCheckForm((s) => s.close)
  const add = useWindChecks((s) => s.add)
  const [toward, setToward] = useState<number | null>(null)
  const [strength, setStrength] = useState<Strength | null>(null)
  const [useCompass, setUseCompass] = useState(false)
  const [compassNote, setCompassNote] = useState<string | null>(null)
  const [saved, setSaved] = useState<WindCheck | null>(null)
  const heading = useHeading(useCompass)

  const askCompass = async () => {
    setCompassNote(null)
    if (!('DeviceOrientationEvent' in window)) return setCompassNote('No compass in this browser: tap the arrow instead')
    const DOE = window.DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> }
    try {
      if (DOE?.requestPermission && (await DOE.requestPermission()) !== 'granted') return setCompassNote('Compass blocked: allow Motion & Orientation for this site, or tap the arrow')
    } catch (e) {
      return setCompassNote(`Compass not available (${(e as Error).message || 'refused'}): tap the arrow instead`)
    }
    setUseCompass(true)
  }

  /** Take the live heading and stop tracking, so it holds still. */
  const lockHeading = (h: number) => {
    setToward(Math.round(h))
    setUseCompass(false)
    if (strength === 'calm') setStrength(null)
  }

  const save = async () => {
    if (!strength) return
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
    const calm = strength === 'calm'
    const c = add({
      ts: now,
      lon: at.lon,
      lat: at.lat,
      dirFrom: calm || toward == null ? null : (toward + 180) % 360,
      strength,
      source: 'hand',
      model: g ? { dirFrom: g.dirFrom, kmh: g.kmh, regime: g.regime, sigmaDeg: g.sigmaDeg } : undefined,
    })
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
      <div className="gc-rose">
        {ROSE.map((b) => (
          <button key={b} className={`gc-dir${toward === b ? ' gc-on' : ''}`} style={{ ['--a' as string]: `${b}deg` }} onClick={() => setToward(b)} aria-label={`toward ${compass(b)}`} disabled={strength === 'calm'}>
            <Arrow toward={b} size={16} />
            <span>{compass(b)}</span>
          </button>
        ))}
        <div className="gc-rose-mid">
          {!useCompass ? (
            <button className="linklike" onClick={() => void askCompass()}>
              aim phone
            </button>
          ) : heading === 'none' ? (
            <span className="gc-note">no compass</span>
          ) : heading == null ? (
            <span className="gc-note">…</span>
          ) : (
            <button className="gc-lock" onClick={() => lockHeading(heading)}>
              <Arrow toward={0} size={20} />
              <span>set {Math.round(heading)}°</span>
            </button>
          )}
        </div>
      </div>
      {useCompass && heading !== 'none' && <div className="gc-note">Point the top of the phone where the powder goes, then tap set.</div>}
      {useCompass && heading === 'none' && <div className="gc-note">No compass reading from this phone: tap the arrow instead.</div>}
      {compassNote && <div className="gc-note">{compassNote}</div>}
      {toward != null && toward % 45 !== 0 && <div className="gc-note">toward {toward}° ({compass(toward)}), from the compass</div>}
      <div className="gc-q">How hard?</div>
      <div className="gc-strength">
        {STRENGTHS.map((s) => (
          <button key={s} className={`chip-pick${strength === s ? ' chip-on' : ''}`} onClick={() => setStrength(s)} title={STRENGTH_LABEL[s]}>
            {s}
          </button>
        ))}
      </div>
      {strength && <div className="gc-note">{STRENGTH_LABEL[strength]}</div>}
      <button className="btn-primary" disabled={!strength || (strength !== 'calm' && toward == null)} onClick={() => void save()}>
        Save check
      </button>
    </div>
  )
}

function ScentCard() {
  const plume = useScent((s) => s.plume)
  const clear = useScent((s) => s.clear)
  return (
    <div className="tripbuilder glass ground-card">
      <div className="tb-head">
        <span className="tb-title">Scent cone · 10 min sit</span>
        <button className="icon-btn" onClick={clear} aria-label="Hide scent cone">
          <IconClose size={16} />
        </button>
      </div>
      <div className="gc-line">{plume ? plumeSummary(plume) : 'Working out the ground wind…'}</div>
      <div className="gc-note">Scent at a deer's nose: deep orange is strong, the pale wash only a trace. Follows the ground model, not the forecast arrow.</div>
    </div>
  )
}

export default function GroundCard() {
  const checking = useCheckForm((s) => s.at != null)
  const scent = useScent((s) => s.source != null)
  if (checking) return <CheckCard />
  if (scent) return <ScentCard />
  return null
}
