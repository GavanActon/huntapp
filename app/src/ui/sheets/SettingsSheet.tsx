import { useEffect, type JSX } from 'react'
import { downloadFiles, mapsStatus, useDownloads } from '../../offline/downloads'
import { checkMapUpdates, useMapUpdates } from '../../offline/updates'
import { useAppStore } from '../../state/appStore'
import './settings.css'

const TEXT_SIZES = [
  ['auto', 'Auto'],
  ['standard', 'A'],
  ['large', 'A+'],
  ['larger', 'A++'],
] as const

/**
 * Settings: six rows and Done (the host draws the title row). The Maps row
 * says what the phone holds and downloads from here; the download runs in
 * offline/downloads.ts, so closing the sheet does not stop it.
 */
export default function SettingsSheet(): JSX.Element {
  const units = useAppStore((s) => s.units)
  const setUnits = useAppStore((s) => s.setUnits)
  const textSize = useAppStore((s) => s.textSize)
  const setTextSize = useAppStore((s) => s.setTextSize)
  const lowPower = useAppStore((s) => s.lowPower)
  const setLowPower = useAppStore((s) => s.setLowPower)
  const pushSheet = useAppStore((s) => s.pushSheet)
  // what the Maps row reads: re-rendered when any of it moves
  useAppStore((s) => s.online)
  useMapUpdates((s) => s.pending)
  const dl = useDownloads()

  // opening Settings is a good moment to ask the server again
  useEffect(() => {
    void checkMapUpdates()
  }, [])

  const maps = mapsStatus()

  return (
    <div className="settings">
      <div className="st-row">
        <button onClick={() => pushSheet({ kind: 'offline' })}>Maps on this phone</button>
        {maps.action === 'download' ? (
          <button className="st-more" disabled={maps.disabled} onClick={() => void downloadFiles(maps.files, maps.replace)}>
            {maps.text}
          </button>
        ) : (
          <span className={dl.active ? 'st-more' : 'dim'}>{maps.text}</span>
        )}
      </div>
      {dl.active && (
        <div className="st-dl">
          <div className="dl-bar">
            <div className="dl-bar-fill" style={{ width: dl.total > 0 ? `${(dl.loaded / dl.total) * 100}%` : '30%' }} />
          </div>
        </div>
      )}
      <button className="st-row" onClick={() => pushSheet({ kind: 'buttons' })}>
        <span>Map buttons</span>
        <span className="dim">›</span>
      </button>
      <div className="st-row">
        <span>Units</span>
        <div className="seg" role="radiogroup" aria-label="Units">
          {(['metric', 'imperial'] as const).map((u) => (
            <button key={u} className={units === u ? 'seg-on' : ''} role="radio" aria-checked={units === u} onClick={() => setUnits(u)}>
              {u === 'metric' ? '°C km/h' : '°F mph'}
            </button>
          ))}
        </div>
      </div>
      <div className="st-row">
        <span>Text size</span>
        <div className="seg" role="radiogroup" aria-label="Text size">
          {TEXT_SIZES.map(([t, label]) => (
            <button key={t} className={textSize === t ? 'seg-on' : ''} role="radio" aria-checked={textSize === t} onClick={() => setTextSize(t)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <label className="st-row">
        <span>Low power</span>
        <input type="checkbox" className="switch" checked={lowPower} onChange={(e) => setLowPower(e.target.checked)} />
      </label>
      <button className="st-row" onClick={() => pushSheet({ kind: 'settingsMore' })}>
        <span className="dim">
          More <small>· contours, the wind flow's look</small>
        </span>
        <span className="dim">›</span>
      </button>
    </div>
  )
}
