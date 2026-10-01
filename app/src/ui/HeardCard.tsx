import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { SOUND_DESC, SOUND_NAMES, useHuntLog, type LogEntry, type MooseSound } from '../log/huntLog'
import { bearingTo, metresTo, movesText, offsetBy, readMoves, useSwing } from '../hunting/moveLayer'
import { requestCompass, startCompass, stopCompass, useCompass } from '../tracking/compass'
import { useGpsStore } from '../tracking/gpsStore'
import { compass } from '../weather/openMeteo'
import { snapshot } from './LogCard'
import Rose, { Arrow } from './Rose'
import { IconClose } from './icons'
import './ground.css'

/**
 * A moose heard (or seen) out hunting: what it was, where, and when, since
 * the phone comes out of a pocket a while after the grunt (now unless
 * told). Where is a tap on the map (the card says so: the map is the
 * reference in the bush, not the phone's compass), and the sound is placed
 * there with the bearing and distance from your fix. The rose and the
 * distance chips stay behind "by direction" for when the map is no help.
 * Three taps, then it is on the map with the others in order and where he
 * is likely to go (moveLayer). It saves at once; the weather and the
 * model's call for the spot are added behind it.
 */

interface HeardForm {
  open: boolean
  /** the last tap on the map while the card is up: where the sound was */
  tap: { lon: number; lat: number; n: number } | null
  show: () => void
  /** the map's tap, while the card owns it */
  mapTap: (lon: number, lat: number) => void
  close: () => void
}
export const useHeardForm = create<HeardForm>((set, get) => ({
  open: false,
  tap: null,
  show: () => {
    // from the tap: iOS only grants the compass from one
    void requestCompass()
    set({ open: true, tap: null })
  },
  mapTap: (lon, lat) => set({ tap: { lon, lat, n: (get().tap?.n ?? 0) + 1 } }),
  close: () => set({ open: false, tap: null }),
}))

const SOUNDS: MooseSound[] = ['cow', 'bull', 'thrash', 'walk', 'splash', 'seen']
const DISTANCES = [25, 50, 100, 200, 400]
/** minutes ago */
const WHEN = [0, 2, 5, 10, 20]

export default function HeardCard() {
  const close = useHeardForm((s) => s.close)
  const tap = useHeardForm((s) => s.tap)
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
  /** the rose and the distance chips, for when the map is no help */
  const [byDir, setByDir] = useState(false)

  useEffect(() => {
    startCompass()
    return () => stopCompass()
  }, [])

  const live = status === 'on' && heading != null
  const turn = live ? heading : 0
  // a tap on the map is the sound's spot; from your fix it is also a bearing and a distance
  const tapped = tap && fix ? { bearing: Math.round(bearingTo(fix, tap)), distM: Math.round(metresTo(fix, tap)) } : null
  useEffect(() => {
    if (tap) setMissing(null)
  }, [tap])

  const save = () => {
    if (!sound) return setMissing('Tap what you heard')
    let lon: number
    let lat: number
    let from: LogEntry['from']
    if (tap && !byDir) {
      lon = tap.lon
      lat = tap.lat
      from = fix && tapped ? { lon: fix.lon, lat: fix.lat, bearing: tapped.bearing, distM: tapped.distM } : undefined
    } else {
      if (!fix) return setMissing('No GPS fix yet: tap the map where it was')
      if (toward == null) return setMissing(byDir ? 'Tap the way it came from' : 'Tap the map where it was')
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
    setSaved(e)
  }

  const again = () => {
    setSaved(null)
    setSound(null)
    setToward(null)
    setDist(null)
    setAgo(0)
    setMissing(null)
    useHeardForm.setState({ tap: null })
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
        <div className="gc-line">{r ? movesText(r) : saved.from ? `${SOUND_NAMES[saved.sound!]} ${saved.from.distM} m ${compass(saved.from.bearing)}` : SOUND_NAMES[saved.sound!]}</div>
        {/* what the lines mean is under Layers, "About what is drawn" */}
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
      {!byDir && (
        <div className="gc-line">
          {tap ? (
            <>
              {tapped ? `${tapped.distM} m ${compass(tapped.bearing)}` : 'On the map'} ·{' '}
              <button className="linklike" onClick={() => useHeardForm.setState({ tap: null })}>
                again
              </button>
            </>
          ) : (
            'Tap the map where it was'
          )}{' '}
          ·{' '}
          <button className="linklike" onClick={() => setByDir(true)}>
            by direction
          </button>
        </div>
      )}
      {byDir && (
        <>
          <div className="gc-q">
            Which way?{' '}
            <button className="linklike" onClick={() => setByDir(false)}>
              tap the map instead
            </button>
          </div>
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
      <button className="btn-primary" onClick={save}>
        Save
      </button>
    </div>
  )
}
