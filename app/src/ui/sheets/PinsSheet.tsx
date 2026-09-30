import { useState, type JSX } from 'react'
import type { PlaceDef } from '../../config'
import { getMap } from '../../map/mapController'
import { isDroppedPin } from '../../map/placePopup'
import { fromHome } from '../../spots/scoring'
import { homePlace, usePlacesStore, type SavedPlace } from '../../state/placesStore'
import { IconLocate, IconPin, IconTrash } from '../icons'
import './log.css'

const KINDS: PlaceDef['kind'][] = ['camp', 'lake', 'landing', 'stand', 'trail']

/**
 * Pins: the camp, the lakes, the stands and landings, and the pins dropped
 * on the map. Tapping a row picks it (the map eases there, the strip
 * retargets); tapping the picked row again, or Clear, lets it go.
 */
export default function PinsSheet(): JSX.Element {
  const places = usePlacesStore((s) => s.places)
  const selectedId = usePlacesStore((s) => s.selectedId)
  const select = usePlacesStore((s) => s.select)
  const update = usePlacesStore((s) => s.update)
  const remove = usePlacesStore((s) => s.remove)
  const add = usePlacesStore((s) => s.add)
  const [editing, setEditing] = useState<string | null>(null)
  // pins dropped from the map and never named or written on: cleared together
  const dropped = places.filter(isDroppedPin)
  const home = homePlace()

  const tap = (p: SavedPlace) => {
    if (p.id === selectedId) return select(null)
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
  const where = (p: SavedPlace) => (p.id === home.id ? p.kind : `${p.kind} · ${fromHome(p.lon, p.lat, home)}`)

  return (
    <div className="pins">
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
                  <input className="pe-name" value={p.name} onChange={(e) => update(p.id, { name: e.target.value })} />
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
              <button className="row-text place-go" aria-pressed={on} onClick={() => tap(p)}>
                <span className="row-title">{p.name}</span>
                <span className="row-desc">
                  {where(p)}
                  {p.note ? ` · ${p.note}` : ''}
                </span>
              </button>
              <button className="icon-btn" aria-label="Edit" onClick={() => setEditing(p.id)}>
                <IconPin size={16} />
              </button>
              <button className="icon-btn" aria-label="Go" onClick={() => getMap()?.easeTo({ center: [p.lon, p.lat], zoom: Math.max(getMap()!.getZoom(), 13) })}>
                <IconLocate size={16} />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
