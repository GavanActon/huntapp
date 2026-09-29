import { useState } from 'react'
import { getMap } from '../../map/mapController'
import { useAppStore } from '../../state/appStore'
import { usePlacesStore, type SavedPlace } from '../../state/placesStore'
import type { PlaceDef } from '../../config'
import { IconLocate, IconPin, IconShare, IconTrash } from '../icons'
import { exportTrackGpx, trackDurationMin, useTrackStore } from '../../tracking/trackStore'
import HuntLogSection from './HuntLogSection'
import { isDroppedPin } from '../../map/placePopup'

const KINDS: PlaceDef['kind'][] = ['camp', 'lake', 'landing', 'stand', 'trail']

/** Saved places: the camp, the lakes, stands and landings. Tapping a row
 *  looks (the map eases there, the strip retargets); the sheet stays up. */
export default function PlacesPanel() {
  const places = usePlacesStore((s) => s.places)
  const selectedId = usePlacesStore((s) => s.selectedId)
  const select = usePlacesStore((s) => s.select)
  const update = usePlacesStore((s) => s.update)
  const remove = usePlacesStore((s) => s.remove)
  const add = usePlacesStore((s) => s.add)
  const [editing, setEditing] = useState<string | null>(null)
  // pins dropped from the map and never named or written on: cleared together
  const dropped = places.filter(isDroppedPin)
  const tracks = useTrackStore((s) => s.tracks)
  const recordingId = useTrackStore((s) => s.recordingId)
  const shown = useTrackStore((s) => s.shown)
  const toggleShown = useTrackStore((s) => s.toggleShown)
  const removeTrack = useTrackStore((s) => s.remove)
  const renameTrack = useTrackStore((s) => s.rename)
  const units = useAppStore((s) => s.units)
  const dist = (m: number) => (units === 'imperial' ? `${(m / 1609.344).toFixed(2)} mi` : m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`)

  const look = (p: SavedPlace) => {
    select(p.id)
    getMap()?.easeTo({ center: [p.lon, p.lat], zoom: Math.max(getMap()!.getZoom(), 13) })
  }
  const addHere = () => {
    const c = getMap()?.getCenter()
    if (!c) return
    const p = add({ name: 'New place', lon: c.lng, lat: c.lat, kind: 'stand' })
    select(p.id)
    setEditing(p.id)
  }

  return (
    <div className="panel places-panel">
      <div className="places-tools">
        <button className="btn-secondary" onClick={addHere}>
          <IconPin size={16} /> Add at map centre
        </button>
        {selectedId && (
          <button className="btn-secondary" onClick={() => select(null)}>
            Clear
          </button>
        )}
        {dropped.length > 0 && (
          <button
            className="linklike danger"
            onClick={() => {
              const n = dropped.length
              if (!confirm(`Delete the ${n === 1 ? 'pin' : `${n} pins`} you dropped and never named? Named places stay.`)) return
              for (const p of dropped) remove(p.id)
            }}
          >
            Delete {dropped.length === 1 ? '1 pin' : `${dropped.length} pins`}
          </button>
        )}
      </div>
      <div className="place-list">
        {places.map((p) => {
          const on = p.id === selectedId
          if (editing === p.id) {
            return (
              <div key={p.id} className="place-row place-row-edit">
                <div className="pe-fields">
                  <input
                    className="pe-name"
                    value={p.name}
                    onFocus={() => useAppStore.getState().setSheetTall(true)}
                    onBlur={() => useAppStore.getState().setSheetTall(false)}
                    onChange={(e) => update(p.id, { name: e.target.value })}
                  />
                  <select value={p.kind} onChange={(e) => update(p.id, { kind: e.target.value as PlaceDef['kind'] })}>
                    {KINDS.map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                  <textarea className="pe-note" placeholder="Note" value={p.note ?? ''} onChange={(e) => update(p.id, { note: e.target.value })} />
                </div>
                <div className="saved-actions">
                  <button className="btn-secondary" onClick={() => setEditing(null)}>
                    Done
                  </button>
                  <button
                    className="icon-btn danger"
                    aria-label="Delete"
                    onClick={() => {
                      if (confirm(`Delete ${p.name}?`)) remove(p.id)
                      setEditing(null)
                    }}
                  >
                    <IconTrash size={16} />
                  </button>
                </div>
              </div>
            )
          }
          return (
            <div key={p.id} className={`place-row${on ? ' place-current' : ''}`}>
              <button className="row-text place-go" onClick={() => look(p)}>
                <span className="row-title">{p.name}</span>
                <span className="row-desc">
                  {p.kind} · {p.lat.toFixed(4)}, {p.lon.toFixed(4)}
                  {p.note ? ` · ${p.note}` : ''}
                </span>
              </button>
              <button className="icon-btn" aria-label="Edit" onClick={() => setEditing(p.id)}>
                <IconPin size={16} />
              </button>
              <button className="icon-btn" aria-label="Go" onClick={() => look(p)}>
                <IconLocate size={16} />
              </button>
            </div>
          )
        })}
      </div>
      {tracks.length > 0 && (
        <>
          <div className="panel-section">Tracks</div>
          {[...tracks].reverse().map((t) => (
            <div key={t.id} className="track-row">
              <input type="checkbox" className="switch" checked={t.id === recordingId || shown.includes(t.id)} disabled={t.id === recordingId} onChange={() => toggleShown(t.id)} aria-label="Show on the map" />
              <div className="row-text">
                <input className="pe-name" value={t.name} onChange={(e) => renameTrack(t.id, e.target.value)} onFocus={() => useAppStore.getState().setSheetTall(true)} onBlur={() => useAppStore.getState().setSheetTall(false)} />
                <span className="row-desc">
                  {t.id === recordingId ? 'recording · ' : ''}
                  {dist(t.distanceM)} · {trackDurationMin(t)} min · {t.points.length} points
                </span>
              </div>
              <button className="icon-btn" aria-label="Export GPX" onClick={() => void exportTrackGpx(t)}>
                <IconShare size={16} />
              </button>
              <button
                className="icon-btn danger"
                aria-label="Delete"
                onClick={() => {
                  if (confirm(`Delete ${t.name}?`)) removeTrack(t.id)
                }}
              >
                <IconTrash size={16} />
              </button>
            </div>
          ))}
        </>
      )}
      <HuntLogSection />
    </div>
  )
}
