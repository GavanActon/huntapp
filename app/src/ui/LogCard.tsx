import { useState } from 'react'
import { create } from 'zustand'
import { SPOTS_RADIUS_M } from '../config'
import { homePlace } from '../state/placesStore'
import { useSpotsStore } from '../state/spotsStore'
import { deriveConditions, recentDailyMeans } from '../spots/conditions'
import { habitat, loadHabitat } from '../spots/habitatGrid'
import { scoreTarget } from '../spots/scoring'
import type { HuntTarget } from '../spots/types'
import { cachedPointForecast } from '../weather/openMeteo'
import { SPECIES_NAMES, useHuntLog, WHAT_DESC, WHAT_NAMES, type LogEntry, type LogModel, type LogSpecies, type LogWeather, type LogWhat, type MooseKind } from '../log/huntLog'
import { IconClose } from './icons'
import './ground.css'

/**
 * Logging what happened at a spot, docked above the tabs like the wind
 * check: which animal, what (seen, heard, sign, called in, or a blank sit),
 * and optionally how many and a note. The weather and the model's own call
 * for that spot are saved beside it, before the entry can sway the map.
 */

interface LogForm {
  at: { lon: number; lat: number } | null
  open: (lon: number, lat: number) => void
  close: () => void
}
export const useLogForm = create<LogForm>((set) => ({
  at: null,
  open: (lon, lat) => set({ at: { lon, lat } }),
  close: () => set({ at: null }),
}))

const SPECIES: LogSpecies[] = ['moose', 'deer', 'bear', 'grouse', 'wolf', 'other']
const WHATS: LogWhat[] = ['seen', 'heard', 'sign', 'called', 'nothing']
const KINDS: MooseKind[] = ['bull', 'cow', 'calf']
const HUNT: LogSpecies[] = ['moose', 'deer', 'bear', 'grouse']

/** The weather and the model's call at a spot, now. Best effort: offline
 *  without a cached forecast, the entry is saved without them. */
async function snapshot(species: LogSpecies, lon: number, lat: number): Promise<{ wx?: LogWeather; model?: LogModel }> {
  const now = Date.now()
  const home = homePlace()
  const f = cachedPointForecast(home.lon, home.lat)
  if (!f) return {}
  const recent = await recentDailyMeans(home.lon, home.lat).catch(() => null)
  const c = deriveConditions(f, now, recent)
  if (!c) return {}
  const wx: LogWeather = { tempC: c.tempC, windKmh: c.windKmh, windDir: c.windDir, cloudPct: c.cloudPct, precipMmH: c.precipMmH, dayHigh: c.dayHigh, warmRun: c.warmRun }
  if (!HUNT.includes(species)) return { wx }
  await loadHabitat()
  const h = habitat()
  if (!h) return { wx }
  // the model's map as it stood, without the log's own pull
  const w = { ...useSpotsStore.getState().weights, log: 0 }
  const res = scoreTarget(species as HuntTarget, c, { lon, lat, name: 'here' }, w)
  const i = h.index(lon, lat)
  if (!res || i < 0) return { wx }
  const s = res.scores[i]
  const [r0, c0] = h.rc(i)
  const rr = Math.ceil(SPOTS_RADIUS_M / h.cellM[1])
  const rc = Math.ceil(SPOTS_RADIUS_M / h.cellM[0])
  let below = 0
  let n = 0
  for (let r = Math.max(0, r0 - rr); r <= Math.min(h.rows - 1, r0 + rr); r++)
    for (let cc = Math.max(0, c0 - rc); cc <= Math.min(h.cols - 1, c0 + rc); cc++) {
      const v = res.scores[r * h.cols + cc]
      if (v <= 0) continue
      n++
      if (v < s) below++
    }
  return { wx, model: { score: s, percentile: n ? below / n : 0, activity: res.verdict.activity, headline: res.verdict.headline } }
}

export default function LogCard() {
  const at = useLogForm((s) => s.at)!
  const close = useLogForm((s) => s.close)
  const add = useHuntLog((s) => s.add)
  const [species, setSpecies] = useState<LogSpecies>(() => {
    const t = useSpotsStore.getState().target
    return HUNT.includes(t as LogSpecies) ? (t as LogSpecies) : 'moose'
  })
  const [what, setWhat] = useState<LogWhat | null>(null)
  const [count, setCount] = useState(1)
  const [kind, setKind] = useState<MooseKind | null>(null)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<LogEntry | null>(null)

  const save = async () => {
    if (!what) return
    setSaving(true)
    const snap = await snapshot(species, at.lon, at.lat).catch(() => ({}))
    const e = add({
      ts: Date.now(),
      lon: at.lon,
      lat: at.lat,
      species,
      what,
      ...(what !== 'nothing' && what !== 'sign' ? { count } : {}),
      ...(species === 'moose' && kind && what !== 'nothing' ? { kind } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
      ...snap,
    })
    setSaving(false)
    setSaved(e)
  }

  if (saved) {
    const m = saved.model
    return (
      <div className="tripbuilder glass ground-card">
        <div className="tb-head">
          <span className="tb-title">Logged</span>
          <button className="icon-btn" onClick={close} aria-label="Close">
            <IconClose size={16} />
          </button>
        </div>
        <div className="gc-line">
          {saved.what === 'nothing' ? `Blank sit for ${SPECIES_NAMES[saved.species].toLowerCase()}` : `${SPECIES_NAMES[saved.species]}${saved.kind ? ` (${saved.kind})` : ''} · ${WHAT_NAMES[saved.what].toLowerCase()}`}
          {saved.wx && ` · ${Math.round(saved.wx.tempC)}°C, ${Math.round(saved.wx.windKmh)} km/h`}
        </div>
        {m && (
          <div className="gc-line">
            The map had this spot at {Math.round(m.score * 100)}: better than {Math.round(m.percentile * 100)}% of the ground around it.
          </div>
        )}
        <div className="gc-note">{saved.what === 'nothing' ? 'Nudges the map down here for a few days.' : 'Pulls the Spots map toward here for the next two weeks. The log and the tally are in Places.'}</div>
      </div>
    )
  }

  return (
    <div className="tripbuilder glass ground-card">
      <div className="tb-head">
        <span className="tb-title">Log it here</span>
        <button className="icon-btn" onClick={close} aria-label="Close">
          <IconClose size={16} />
        </button>
      </div>
      <div className="gc-strength">
        {SPECIES.map((s) => (
          <button key={s} className={`chip-pick${species === s ? ' chip-on' : ''}`} onClick={() => setSpecies(s)}>
            {SPECIES_NAMES[s]}
          </button>
        ))}
      </div>
      <div className="gc-q">What happened?</div>
      <div className="gc-strength">
        {WHATS.map((w) => (
          <button key={w} className={`chip-pick${what === w ? ' chip-on' : ''}`} onClick={() => setWhat(w)} title={WHAT_DESC[w]}>
            {WHAT_NAMES[w]}
          </button>
        ))}
      </div>
      {what && <div className="gc-note">{WHAT_DESC[what]}</div>}
      {what && what !== 'nothing' && what !== 'sign' && (
        <div className="gc-strength" style={{ alignItems: 'center' }}>
          <span className="gc-note">How many</span>
          <button className="chip-pick" onClick={() => setCount(Math.max(1, count - 1))} aria-label="One fewer">
            −
          </button>
          <b>{count}</b>
          <button className="chip-pick" onClick={() => setCount(count + 1)} aria-label="One more">
            +
          </button>
          {species === 'moose' &&
            KINDS.map((k) => (
              <button key={k} className={`chip-pick${kind === k ? ' chip-on' : ''}`} onClick={() => setKind(kind === k ? null : k)}>
                {k}
              </button>
            ))}
        </div>
      )}
      <input className="trip-name-input" style={{ width: '100%', margin: '6px 0' }} placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
      <button className="btn-primary" disabled={!what || saving} onClick={() => void save()}>
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  )
}
