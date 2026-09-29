import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { SOUND_DESC, SOUND_NAMES, useHuntLog, type LogEntry, type MooseSound } from '../log/huntLog'
import { movesText, offsetBy, readMoves, useSwing } from '../hunting/moveLayer'
import { requestCompass, startCompass, stopCompass, useCompass } from '../tracking/compass'
import { useGpsStore } from '../tracking/gpsStore'
import { compass } from '../weather/openMeteo'
import { snapshot } from './LogCard'
import Rose, { Arrow } from './Rose'
import { IconClose } from './icons'
import './ground.css'

/**
 * A moose heard (or seen) out hunting, placed from where you stand: what
 * it was, the way it came from (the rose turns with the phone, so the
 * arrow to tap points at the sound), about how far, and when, since the
 * phone comes out of a pocket a while after the grunt (now unless told).
 * Four taps, then it is on the map with the others in order and where he
 * is likely to go (moveLayer). It saves at once; the weather and the
 * model's call for the spot are added behind it.
 */

interface HeardForm {
  open: boolean
  show: () => void
  close: () => void
}
export const useHeardForm = create<HeardForm>((set) => ({
  open: false,
  show: () => {
    // from the tap: iOS only grants the compass from one
    void requestCompass()
    set({ open: true })
  },
  close: () => set({ open: false }),
}))

const SOUNDS: MooseSound[] = ['cow', 'bull', 'thrash', 'walk', 'splash', 'seen']
const DISTANCES = [25, 50, 100, 200, 400]
/** minutes ago */
const WHEN = [0, 2, 5, 10, 20]

export default function HeardCard() {
  const close = useHeardForm((s) => s.close)
  const add = useHuntLog((s) => s.add)
  const fix = useGpsStore((s) => s.fix)
  const heading = useCompass((s) => s.heading)
  const status = useCompass((s) => s.status)
  const [sound, setSound] = useState<MooseSound | null>(null)
  const [toward, setToward] = useState<number | null>(null)
  const [dist, setDist] = useState<number | null>(null)
  const [ago, setAgo] = useState(0)
  const [missing, setMissing] = useState<string | null>(null)
  const [saved, setSaved] = useState<LogEntry | null>(null)

  useEffect(() => {
    startCompass()
    return () => stopCompass()
  }, [])

  const live = status === 'on' && heading != null
  const turn = live ? heading : 0

  const save = () => {
    if (!fix) return setMissing('No GPS fix yet. Or close this, tap the map where it was, then Log')
    if (!sound) return setMissing('Tap what you heard')
    if (toward == null) return setMissing('Tap the way it came from')
    if (dist == null) return setMissing('Tap about how far')
    const [lon, lat] = offsetBy(fix, toward, dist)
    const e = add({
      ts: Date.now() - ago * 60_000,
      lon,
      lat,
      species: 'moose',
      what: sound === 'seen' ? 'seen' : 'heard',
      count: 1,
      ...(sound === 'bull' ? { kind: 'bull' as const } : sound === 'cow' ? { kind: 'cow' as const } : {}),
      sound,
      from: { lon: fix.lon, lat: fix.lat, bearing: toward, distM: dist },
    })
    // the weather and the model's call follow behind: no waiting on them with a moose about
    void snapshot('moose', lon, lat)
      .then((snap) => useHuntLog.getState().update(e.id, snap))
      .catch(() => {})
    setSaved(e)
  }

  const again = () => {
    setSaved(null)
    setSound(null)
    setToward(null)
    setDist(null)
    setAgo(0)
    setMissing(null)
  }

  // his routed way round lands a moment after the save: the lines below follow it
  useSwing((s) => s.swing)

  if (saved) {
    const r = readMoves()
    return (
      <div className="tripbuilder glass ground-card">
        <div className="tb-head">
          <span className="tb-title">On the map</span>
          <button className="icon-btn" onClick={close} aria-label="Close">
            <IconClose size={16} />
          </button>
        </div>
        <div className="gc-line">{r ? movesText(r) : `${SOUND_NAMES[saved.sound!]} ${saved.from!.distM} m ${compass(saved.from!.bearing)}`}</div>
        <div className="gc-note">
          {r && r.downwind != null && !(r.swing ? r.swing.onIt : r.onIt)
            ? 'The red dashed line is his likeliest way round to your scent: through cover, off open ground near you, holding off where bulls hang up. A bull on a call often circles to wind the caller before he shows. Watch where it meets your scent.'
            : 'Each sound joins the one before it on the map, in order, so the way he is moving shows.'}
        </div>
        <button className="btn-primary" onClick={again}>
          Heard more
        </button>
      </div>
    )
  }

  return (
    <div className="tripbuilder glass ground-card">
      <div className="tb-head">
        <span className="tb-title">Heard a moose</span>
        <button className="icon-btn" onClick={close} aria-label="Close">
          <IconClose size={16} />
        </button>
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
        ) : (
          <span className="gc-mid-word">tap an arrow</span>
        )}
      </Rose>
      <div className="gc-note">{live ? 'Point the phone at the sound and tap "ahead", or tap the arrow toward it.' : 'North is up: tap the arrow toward the sound.'}</div>
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
      <div className="gc-q">When?</div>
      <div className="gc-strength">
        {WHEN.map((m) => (
          <button key={m} className={`chip-pick${ago === m ? ' chip-on' : ''}`} onClick={() => setAgo(m)} aria-pressed={ago === m}>
            {m ? `${m} min ago` : 'Now'}
          </button>
        ))}
      </div>
      {missing && <div className="gc-missing">{missing}</div>}
      <button className="btn-primary" onClick={save}>
        Save
      </button>
    </div>
  )
}
