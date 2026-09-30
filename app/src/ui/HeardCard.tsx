import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { SOUND_DESC, SOUND_NAMES, useHuntLog, type MooseSound } from '../log/huntLog'
import { snapshot } from '../log/snapshot'
import { offsetBy } from '../hunting/moveLayer'
import { requestCompass, startCompass, stopCompass, useCompass } from '../tracking/compass'
import { locateAndFollow } from '../tracking/gpsService'
import { useGpsStore } from '../tracking/gpsStore'
import { compass } from '../weather/openMeteo'
import Rose, { Arrow } from './Rose'
import { useTapOff } from './tapOff'
import './ground.css'

/**
 * A moose heard (or seen) out there, placed from where you stand: what it
 * was, the way it came from (the rose turns with the phone, so the arrow
 * to tap points at the sound), about how far, and when, since the phone
 * comes out of a pocket a while after the grunt (now unless told). Four
 * taps, then it is on the map with the others in order and where he is
 * likely to go (moveLayer), and the live card reads him. It saves at once;
 * the weather and the model's call for the spot are added behind it.
 * Opening it turns location on, since the sound is placed from your fix.
 */

interface HeardForm {
  open: boolean
  /** a spot tapped on the map: the sound goes there, no rose, no distance */
  at: { lon: number; lat: number } | null
  show: (at?: { lon: number; lat: number }) => void
  close: () => void
}
export const useHeardForm = create<HeardForm>((set) => ({
  open: false,
  at: null,
  show: (at) => {
    if (at) return set({ open: true, at })
    // from the tap: iOS only grants the compass and location from one
    void requestCompass()
    if (!useGpsStore.getState().locating) locateAndFollow()
    set({ open: true, at: null })
  },
  close: () => set({ open: false, at: null }),
}))

const SOUNDS: MooseSound[] = ['cow', 'bull', 'thrash', 'walk', 'splash', 'seen']
const DISTANCES = [25, 50, 100, 200, 400]
/** minutes ago */
const WHEN = [0, 2, 5, 10, 20]

export default function HeardCard() {
  const close = useHeardForm((s) => s.close)
  const at = useHeardForm((s) => s.at)
  const add = useHuntLog((s) => s.add)
  const fix = useGpsStore((s) => s.fix)
  const heading = useCompass((s) => s.heading)
  const status = useCompass((s) => s.status)
  const [sound, setSound] = useState<MooseSound | null>(null)
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

  const save = () => {
    if (!sound) return setMissing('Tap what you heard')
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
      species: 'moose',
      what: sound === 'seen' ? 'seen' : 'heard',
      count: 1,
      ...(sound === 'bull' ? { kind: 'bull' as const } : sound === 'cow' ? { kind: 'cow' as const } : {}),
      sound,
      ...(from ? { from } : {}),
    })
    // the weather and the model's call follow behind: no waiting on them with a moose about
    void snapshot('moose', lon, lat)
      .then((snap) => useHuntLog.getState().update(e.id, snap))
      .catch(() => {})
    // on the map and on the live card; another sound is the button again
    close()
  }

  return (
    <div className="tripbuilder glass ground-card" ref={ref}>
      <div className="tb-head">
        <span className="tb-title">Heard a moose</span>
      </div>
      <div className="gc-strength">
        {SOUNDS.map((s) => (
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
      <div className="gc-q">When?</div>
      <div className="gc-strength">
        {WHEN.map((m) => (
          <button key={m} className={`chip-pick${ago === m ? ' chip-on' : ''}`} onClick={() => setAgo(m)} aria-pressed={ago === m}>
            {m ? `${m} min ago` : 'Now'}
          </button>
        ))}
      </div>
      {missing && <div className="gc-missing">{missing}</div>}
      <button className="btn-primary" disabled={!at && !fix} onClick={save}>
        {at || fix ? 'Save' : 'Waiting for a fix…'}
      </button>
    </div>
  )
}
