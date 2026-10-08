import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { SOUND_DESC, SOUND_NAMES, SPECIES_NAMES, SPECIES_SOUNDS, useHuntLog, type GameSound, type LogSpecies } from '../log/huntLog'
import { snapshot } from '../log/snapshot'
import { offsetBy } from '../hunting/moveLayer'
import { requestCompass, startCompass, stopCompass, useCompass } from '../tracking/compass'
import { locateAndFollow } from '../tracking/gpsService'
import { useGpsStore } from '../tracking/gpsStore'
import { useSpotsStore } from '../state/spotsStore'
import { compass } from '../weather/openMeteo'
import { clockShort } from '../time'
import Rose, { Arrow } from './Rose'
import { useTapOff } from './tapOff'
import './ground.css'

/**
 * Game: an animal heard or seen out there (Gavan, 2026-10-08: "Heard" said
 * the sound alone, and out glassing it is a sighting). Which animal is the
 * drop in the title, the heat map's own unless changed, and each animal
 * has its own sounds, then Saw it. Placed from where you stand: what it
 * was, the way it came from (the rose turns with the phone, so the arrow
 * to tap points at the sound), about how far, and when, since the phone
 * comes out of a pocket a while after the grunt (now unless told). Four
 * taps, then it is on the map with the others in order and where he is
 * likely to go (moveLayer), and the live card reads him. It saves at once;
 * the weather and the model's call for the spot are added behind it.
 * Opening it turns location on, since the sound is placed from your fix.
 * Only a moose goes on the moose layer (his way and his swing round your
 * scent); the others are dots in the log.
 *
 * Edit, from a saved dot's popup, opens it on that entry: the animal and
 * what it was, put right where it lies (the dot moves by press and hold).
 */

interface HeardForm {
  open: boolean
  /** the Game button pressed: the next map tap is where it was */
  placing: boolean
  /** a spot tapped on the map: the sound goes there, no rose, no distance */
  at: { lon: number; lat: number } | null
  /** a saved entry being put right: its id */
  edit: string | null
  /** the button: wait for a tap on the map (again: stop waiting) */
  arm: () => void
  show: (at?: { lon: number; lat: number }) => void
  /** a saved entry's Edit */
  editEntry: (id: string) => void
  close: () => void
}
export const useHeardForm = create<HeardForm>((set, get) => ({
  open: false,
  placing: false,
  at: null,
  edit: null,
  arm: () => set({ placing: !get().placing, open: false, at: null, edit: null }),
  show: (at) => {
    if (at) return set({ open: true, at, placing: false, edit: null })
    // from the tap: iOS only grants the compass and location from one
    void requestCompass()
    if (!useGpsStore.getState().locating) locateAndFollow()
    set({ open: true, at: null, placing: false, edit: null })
  },
  editEntry: (id) => {
    const e = useHuntLog.getState().entries.find((x) => x.id === id)
    if (e) set({ open: true, at: { lon: e.lon, lat: e.lat }, placing: false, edit: id })
  },
  close: () => set({ open: false, at: null, placing: false, edit: null }),
}))

const ANIMALS: LogSpecies[] = ['moose', 'deer', 'bear', 'grouse', 'wolf', 'other']

/** The heat map's animal, the card's first pick; a fish's map (or none) is a moose. */
function heatAnimal(): LogSpecies {
  const t = useSpotsStore.getState().target
  return ANIMALS.includes(t as LogSpecies) ? (t as LogSpecies) : 'moose'
}
const DISTANCES = [25, 50, 100, 200, 400]
/** minutes ago */
const WHEN = [0, 2, 5, 10, 20]

export default function HeardCard() {
  const close = useHeardForm((s) => s.close)
  const at = useHeardForm((s) => s.at)
  const editId = useHeardForm((s) => s.edit)
  const editing = useHuntLog((s) => (editId ? s.entries.find((x) => x.id === editId) : undefined))
  const add = useHuntLog((s) => s.add)
  const fix = useGpsStore((s) => s.fix)
  const heading = useCompass((s) => s.heading)
  const status = useCompass((s) => s.status)
  const [species, setSpecies] = useState<LogSpecies>(() => editing?.species ?? heatAnimal())
  // an entry saved without a sound (the log's own card) reads as what it was
  const [sound, setSound] = useState<GameSound | null>(() => (editing ? (editing.sound ?? (editing.what === 'seen' ? 'seen' : 'heard')) : null))
  const sounds = SPECIES_SOUNDS[species]
  const [toward, setToward] = useState<number | null>(null)
  const [dist, setDist] = useState<number | null>(null)
  const [ago, setAgo] = useState(0)
  const [missing, setMissing] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  useTapOff(ref, true, close)

  useEffect(() => {
    startCompass()
    return () => stopCompass()
  }, [])

  const live = status === 'on' && heading != null
  const turn = live ? heading : 0

  const pickAnimal = (a: LogSpecies) => {
    setSpecies(a)
    // a sound the new animal does not make goes; Saw it stays
    if (sound && !SPECIES_SOUNDS[a].includes(sound)) setSound(null)
    setMissing(null)
  }

  const save = () => {
    if (!sound) return setMissing('Tap what you heard or saw')
    const kind = species === 'moose' && sound === 'bull' ? ('bull' as const) : species === 'moose' && sound === 'cow' ? ('cow' as const) : undefined
    if (editing) {
      // put right where it lies: the animal and what it was, the time and the spot kept
      const changed = editing.species !== species
      useHuntLog.getState().update(editing.id, { species, what: sound === 'seen' ? 'seen' : 'heard', sound, kind: kind ?? (species === 'moose' && !changed ? editing.kind : undefined) })
      // another animal is another map to score it on
      if (changed)
        void snapshot(species, editing.lon, editing.lat)
          .then((snap) => useHuntLog.getState().update(editing.id, snap))
          .catch(() => {})
      return close()
    }
    let lon: number
    let lat: number
    let from: { lon: number; lat: number; bearing: number; distM: number } | undefined
    if (at) {
      lon = at.lon
      lat = at.lat
    } else {
      if (!fix) return
      if (toward == null) return setMissing('Tap the way it came from')
      if (dist == null) return setMissing('Tap about how far')
      ;[lon, lat] = offsetBy(fix, toward, dist)
      from = { lon: fix.lon, lat: fix.lat, bearing: toward, distM: dist }
    }
    const e = add({
      ts: Date.now() - ago * 60_000,
      lon,
      lat,
      species,
      what: sound === 'seen' ? 'seen' : 'heard',
      count: 1,
      ...(kind ? { kind } : {}),
      sound,
      ...(from ? { from } : {}),
    })
    // the weather and the model's call follow behind: no waiting on them with a moose about
    void snapshot(species, lon, lat)
      .then((snap) => useHuntLog.getState().update(e.id, snap))
      .catch(() => {})
    // on the map and on the live card; another sound is the button again
    close()
  }

  return (
    <div className="tripbuilder glass ground-card" ref={ref}>
      <div className="tb-head">
        {/* the animal: the heat map's unless changed here */}
        <select className="gc-animal" value={species} onChange={(e) => pickAnimal(e.target.value as LogSpecies)} aria-label="Animal">
          {ANIMALS.map((a) => (
            <option key={a} value={a}>
              {SPECIES_NAMES[a]}
            </option>
          ))}
        </select>
        {editing && <span className="tb-title gc-animal-note">· {clockShort(editing.ts)}</span>}
      </div>
      <div className="gc-strength">
        {sounds.map((s) => (
          <button
            key={s}
            className={`chip-pick${sound === s ? ' chip-on' : ''}`}
            onClick={() => {
              setSound(s)
              setMissing(null)
            }}
            title={SOUND_DESC[s]}
            aria-pressed={sound === s}
          >
            {SOUND_NAMES[s]}
          </button>
        ))}
      </div>
      {!at && (
        <>
      <div className="gc-q">Which way?</div>
      <Rose
        turn={turn}
        value={toward}
        onPick={(b) => {
          setToward(b)
          setMissing(null)
        }}
        label={(b) => `from the ${compass(b)}`}
      >
        {toward != null ? (
          <span className="gc-mid-pick">
            <Arrow toward={toward - turn} size={30} />
            <b>{compass(toward)}</b>
          </span>
        ) : live ? (
          <button className="gc-lock" onClick={() => setToward(Math.round(heading))}>
            <Arrow toward={0} size={20} />
            <span>ahead</span>
          </button>
        ) : null}
      </Rose>
      <div className="gc-q">About how far?</div>
      <div className="gc-strength">
        {DISTANCES.map((d) => (
          <button
            key={d}
            className={`chip-pick${dist === d ? ' chip-on' : ''}`}
            onClick={() => {
              setDist(d)
              setMissing(null)
            }}
            aria-pressed={dist === d}
          >
            {d === 400 ? '400+ m' : `${d} m`}
          </button>
        ))}
      </div>
        </>
      )}
      {!editing && (
        <>
          <div className="gc-q">When?</div>
          <div className="gc-strength">
            {WHEN.map((m) => (
              <button key={m} className={`chip-pick${ago === m ? ' chip-on' : ''}`} onClick={() => setAgo(m)} aria-pressed={ago === m}>
                {m ? `${m} min ago` : 'Now'}
              </button>
            ))}
          </div>
        </>
      )}
      {missing && <div className="gc-missing">{missing}</div>}
      <button className="btn-primary" disabled={!at && !fix} onClick={save}>
        {at || fix ? 'Save' : 'Waiting for a fix…'}
      </button>
    </div>
  )
}
