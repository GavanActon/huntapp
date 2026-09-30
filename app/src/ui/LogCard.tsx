import { useRef, useState } from 'react'
import { create } from 'zustand'
import { useSpotsStore } from '../state/spotsStore'
import { snapshot } from '../log/snapshot'
import { SPECIES_NAMES, useHuntLog, WHAT_DESC, WHAT_NAMES, type LogEntry, type LogSpecies, type LogWhat, type MooseKind } from '../log/huntLog'
import { useTapOff } from './tapOff'
import './ground.css'

/**
 * Logging what happened at a spot, in the bottom bar like the wind check:
 * which animal, what (seen, heard, sign, called in, or a blank sit), and
 * optionally how many and a note. The weather and the model's own call
 * for that spot are saved beside it (log/snapshot), before the entry can
 * sway the map. Opened from Dig in's ⋯ and the Hunt log's ⋯; tapping off
 * it closes it, and Done once it is saved.
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

// the snapshot lives in log/snapshot.ts now; kept here for any old import
export { snapshot }

const SPECIES: LogSpecies[] = ['moose', 'deer', 'bear', 'grouse', 'wolf', 'other']
const WHATS: LogWhat[] = ['seen', 'heard', 'sign', 'called', 'nothing']
const KINDS: MooseKind[] = ['bull', 'cow', 'calf']
const HUNT: LogSpecies[] = ['moose', 'deer', 'bear', 'grouse']

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
  const ref = useRef<HTMLDivElement>(null)
  useTapOff(ref, true, close)

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
      <div className="tripbuilder glass ground-card" ref={ref}>
        <div className="tb-head">
          <span className="tb-title">Logged</span>
          <button className="sheet-done" onClick={close}>
            Done
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
      </div>
    )
  }

  return (
    <div className="tripbuilder glass ground-card" ref={ref}>
      <div className="tb-head">
        <span className="tb-title">Log it here</span>
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
