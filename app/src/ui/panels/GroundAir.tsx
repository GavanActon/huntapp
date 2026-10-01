import { useEffect, useState } from 'react'
import { useAppStore } from '../../state/appStore'
import { useGpsStore } from '../../tracking/gpsStore'
import { inRegion } from '../../config'
import { startOfDayMs, timeLabel } from '../../time'
import { ensureProfile, onProfile } from '../../weather/boundaryLayer'
import { groundDay, loadMicro, onMicro, REGIME_LABEL, type Regime, type Window } from '../../weather/micro/model'
import { towardWords, useWindChecks, verdict, type WindCheck } from '../../weather/micro/windChecks'
import { compass } from '../../weather/openMeteo'
import { onWeatherGrid } from '../../weather/windGrid'
import { useCheckForm } from '../GroundCard'
import { stripSubject } from '../WeatherStrip'
import '../ground.css'

/**
 * The Weather tab's ground air: the picked day at the strip's place in a
 * few windows of one regime each (cold air draining until mid-morning,
 * the wind reaching down through the afternoon, draining again from
 * dusk), then the wind checks and how often the model called them.
 */

const CLASS: Partial<Record<Regime, string>> = { drainage: 'gd-drain', pooled: 'gd-pool', upslope: 'gd-up', lakeBreeze: 'gd-breeze', landBreeze: 'gd-breeze' }

const TIP: Record<Regime, string> = {
  wind: 'scent goes with the forecast wind',
  drainage: 'scent sinks and runs downhill',
  pooled: 'scent sits in the low ground',
  upslope: 'scent rises up the slope',
  lakeBreeze: 'scent carried inland off the lake',
  landBreeze: 'scent drifts out over the water',
  calm: 'scent hangs and spreads every way',
}

/** This phone's checks as a file for the party, through the share sheet (a download without one). */
async function shareChecks() {
  const s = useAppStore.getState()
  const name = `wind-checks-${s.who || 'me'}-${new Date().toISOString().slice(0, 10)}.json`
  const file = new File([JSON.stringify({ huntapp: 'wind-checks', checks: useWindChecks.getState().checks })], name, { type: 'application/json' })
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean }
  if (nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: name })
      return
    } catch {
      /* cancelled: fall through to a download */
    }
  }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(file)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

/** A partner's checks file taken in; how many were new. */
async function takeChecks(file: File): Promise<number> {
  const j = JSON.parse(await file.text()) as { checks?: WindCheck[] }
  return useWindChecks.getState().merge(Array.isArray(j.checks) ? j.checks : [])
}

/** Open the wind-check form at the phone's fix, or the strip's place, and drop the sheet. */
export function logWindHere() {
  const fix = useGpsStore.getState().fix
  if (fix && inRegion(fix.lon, fix.lat)) useCheckForm.getState().open(fix.lon, fix.lat, 'here')
  else {
    const s = stripSubject()
    useCheckForm.getState().open(s.lon, s.lat, s.name)
  }
  useAppStore.getState().setSheetTab(null)
}

export default function GroundAir() {
  const planTimeMs = useAppStore((s) => s.planTimeMs)
  const units = useAppStore((s) => s.units)
  const checks = useWindChecks((s) => s.checks)
  const remove = useWindChecks((s) => s.remove)
  const [took, setTook] = useState<string | null>(null)
  // whose checks are on this phone: yours and the party's
  const people = Object.entries(
    checks.reduce<Record<string, number>>((m, c) => {
      const k = c.by || 'you'
      m[k] = (m[k] ?? 0) + 1
      return m
    }, {}),
  ).map(([who, n]) => ({ who, n }))
  const [windows, setWindows] = useState<Window[] | null>(null)
  const [name, setName] = useState('')
  const [tick, setTick] = useState(0)

  useEffect(() => {
    void Promise.all([loadMicro(), ensureProfile()]).then(() => setTick((t) => t + 1))
    const bump = () => setTick((t) => t + 1)
    const offs = [onMicro(bump), onProfile(bump), onWeatherGrid(bump)]
    return () => offs.forEach((o) => o())
  }, [])

  const dayMs = startOfDayMs(planTimeMs ?? Date.now())
  useEffect(() => {
    const s = stripSubject()
    setName(s.name)
    setWindows(groundDay(s.lon, s.lat, dayMs))
  }, [dayMs, tick, checks])

  const spd = (k: number) => (units === 'imperial' ? `${(k * 0.621371).toFixed(1)} mph` : `${k < 3 ? k.toFixed(1) : Math.round(k)} km/h`)
  const now = Date.now()
  const today = checks.filter((c) => startOfDayMs(c.ts) === startOfDayMs(now))
  const scored = checks.filter((c) => verdict(c) != null)
  const hits = scored.filter((c) => verdict(c) === 'agree').length

  return (
    <>
      <div className="panel-section">
        Ground air{name && <em className="age-badge">at {name}</em>}
      </div>
      {!windows?.length ? (
        <div className="empty">Needs the forecast and the microclimate grid.</div>
      ) : (
        <div className="ground-day">
          {windows.map((w, k) => {
            const on = now >= w.startMs && now < w.endMs
            const first = k === 0
            const last = k === windows.length - 1
            const when = first && !last ? `until ${timeLabel(w.endMs)}` : last && !first ? `from ${timeLabel(w.startMs)}` : first && last ? 'all day' : `${timeLabel(w.startMs)}–${timeLabel(w.endMs)}`
            return (
              <div key={w.startMs} className={`gd-row ${CLASS[w.regime] ?? ''}${on ? ' gd-now' : ''}`}>
                <span className="gd-time">{when}</span>
                <span className="gd-what">
                  <b>{REGIME_LABEL[w.regime]}</b>
                  {w.decoupled && w.regime === 'wind' ? ' (in gusts)' : ''} · <span className="row-desc">{TIP[w.regime]}</span>
                </span>
                <span className="gd-wind">{w.regime === 'calm' ? 'calm' : `${compass(w.dirFrom)} → ${compass((w.dirFrom + 180) % 360)} ${spd(w.kmh)}`}</span>
              </div>
            )
          })}
        </div>
      )}
      <div className="panel-note row-desc">
        Head height at this spot: terrain, trees, cold-air drainage, lake breezes and the air's layering (HRDPS 2 m vs 80 m). Tap the map anywhere for that spot's ground air and its scent cone.
      </div>

      <div className="panel-section">
        Wind checks
        {scored.length > 0 && (
          <em className="age-badge">
            model {hits}/{scored.length} agreed
          </em>
        )}
      </div>
      <div className="row-desc" style={{ padding: '0 4px 6px' }}>
        {checks.length ? `${checks.length} on this phone` : 'None yet'}
        {people.length > 1 ? ` · ${people.map((p) => `${p.who} ${p.n}`).join(', ')}` : ''}
        {' · '}
        <button className="linklike" onClick={() => void shareChecks()}>
          share
        </button>
        {' · '}
        <label className="linklike" style={{ cursor: 'pointer' }}>
          add a partner's
          <input
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (!f) return
              takeChecks(f)
                .then((n) => setTook(n ? `${n} new check${n > 1 ? 's' : ''} added: they count the same as yours in the blend` : 'Nothing new in that file'))
                .catch(() => setTook('That is not a wind-checks file'))
            }}
          />
        </label>
        {took ? ` · ${took}` : ''}
      </div>
      {today.length === 0 ? (
        <div className="panel-note row-desc">Puff powder or drop milkweed, tap which way it goes. Each check corrects the ground model near it and scores it.</div>
      ) : (
        <div className="checks-list">
          {today
            .slice()
            .reverse()
            .map((c) => {
              const v = verdict(c)
              return (
                <div key={c.id} className="ck-row">
                  <span>
                    {timeLabel(c.ts)}
                    {c.by ? ` ${c.by}` : ''} · {c.dirFrom == null ? 'calm' : `toward ${towardWords((c.dirFrom + 180) % 360, c.swingDeg)}`}, {c.strength}
                    {c.model && <span className="row-desc"> · model {c.model.kmh < 1 ? 'calm' : `toward ${compass((c.model.dirFrom + 180) % 360)}`}</span>}
                  </span>
                  {v && <b className={`gc-verdict gc-${v}`}>{v === 'agree' ? 'agreed' : v}</b>}
                  <button className="linklike dim" onClick={() => remove(c.id)} aria-label="Delete check">
                    ×
                  </button>
                </div>
              )
            })}
        </div>
      )}
    </>
  )
}
