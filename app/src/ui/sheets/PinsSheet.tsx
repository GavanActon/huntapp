import { useEffect, useMemo, useState, type CSSProperties, type JSX } from 'react'
import type { PlaceDef } from '../../config'
import { useHuntLog, type LogEntry } from '../../log/huntLog'
import { getMap } from '../../map/mapController'
import { isDroppedPin } from '../../map/placePopup'
import { compass8 } from '../../spots/conditions'
import { loadHabitat, onHabitat } from '../../spots/habitatGrid'
import { fromHome } from '../../spots/scoring'
import { huntedLine, huntedWinds, sectorOf, suggestWinds, windsLabel, windVerdict } from '../../spots/standWinds'
import { PIN_COLOURS, placeColour } from '../../state/pinColours'
import { homePlace, usePlacesStore, type SavedPlace } from '../../state/placesStore'
import { ensureProfile, onProfile } from '../../weather/boundaryLayer'
import { loadMicro, onMicro } from '../../weather/micro/model'
import { useWindChecks } from '../../weather/micro/windChecks'
import { ensureWeatherGrid, onWeatherGrid } from '../../weather/windGrid'
import { IconLocate, IconPin, IconTrash } from '../icons'
import Rose from '../Rose'
import '../ground.css'
import './log.css'

const KINDS: PlaceDef['kind'][] = ['camp', 'lake', 'landing', 'stand', 'trail']

/**
 * Pins: the camp, the lakes, the stands and landings, and the pins dropped
 * on the map. Tapping a row picks it (the map eases there, the strip
 * retargets); tapping the picked row again, or Clear, lets it go.
 *
 * A stand can carry its good winds (spots/standWinds.ts): the row then
 * says how the ground wind at the next sit reads against them, and the
 * editor has the rose to set them, a suggestion from the bake, and the
 * winds the log says it has been sat on.
 */
export default function PinsSheet(): JSX.Element {
  const places = usePlacesStore((s) => s.places)
  const selectedId = usePlacesStore((s) => s.selectedId)
  const select = usePlacesStore((s) => s.select)
  const update = usePlacesStore((s) => s.update)
  const remove = usePlacesStore((s) => s.remove)
  const add = usePlacesStore((s) => s.add)
  const [editing, setEditing] = useState<string | null>(null)
  const checks = useWindChecks((s) => s.checks)
  const entries = useHuntLog((s) => s.entries)
  // the ground model, the layering profile, the wind grid and the habitat bake land on their own time
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const bump = () => setTick((t) => t + 1)
    void Promise.all([loadMicro(), ensureProfile(), ensureWeatherGrid(), loadHabitat()]).then(bump)
    const offs = [onMicro(bump), onProfile(bump), onWeatherGrid(bump), onHabitat(bump)]
    return () => offs.forEach((o) => o())
  }, [])
  // one verdict per stand with winds, for the moment the sheet is looked at
  const verdicts = useMemo(() => {
    const now = Date.now()
    return new Map(places.filter((p) => p.winds?.length).map((p) => [p.id, windVerdict(p, now)]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [places, tick, checks])
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
                  <div className="pin-swatches">
                    {PIN_COLOURS.map((c) => (
                      <button key={c} className={`pin-swatch${placeColour(p) === c ? ' on' : ''}`} style={{ '--sw': c } as CSSProperties} aria-label={`Colour ${c}`} aria-pressed={placeColour(p) === c} onClick={() => update(p.id, { color: c })} />
                    ))}
                  </div>
                  <textarea className="pe-note" placeholder="Note" value={p.note ?? ''} onChange={(e) => update(p.id, { note: e.target.value })} />
                  <WindsEditor p={p} tick={tick} entries={entries} onChange={(winds) => update(p.id, { winds })} />
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
                <span className="row-title">
                  <i className="pin-dot" style={{ background: placeColour(p) }} />
                  {p.name}
                </span>
                <span className="row-desc">
                  {where(p)}
                  {p.winds?.length ? ` · winds ${windsLabel(p.winds)}` : ''}
                  {p.note ? ` · ${p.note}` : ''}
                </span>
                {verdicts.get(p.id) && <span className={`row-desc pw-verdict pw-${verdicts.get(p.id)!.grade}`}>{verdicts.get(p.id)!.text}</span>}
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

/**
 * The stand's good winds: tap the arrows the wind blows FROM that still
 * hunt here. Suggest fills it from the bake's feeding side; the log's own
 * tally of winds sat on sits under it.
 */
function WindsEditor({ p, tick, entries, onChange }: { p: SavedPlace; tick: number; entries: LogEntry[]; onChange: (winds: number[] | undefined) => void }): JSX.Element {
  const winds = p.winds ?? []
  // tick: the bake may land after the editor opens; entries: a new log entry retallies
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const suggested = useMemo(() => suggestWinds(p.lon, p.lat), [p.lon, p.lat, tick])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const hunted = useMemo(() => huntedLine(huntedWinds(p)), [p, entries])
  const toggle = (deg: number) => {
    const k = sectorOf(deg)
    const next = winds.includes(k) ? winds.filter((w) => w !== k) : [...winds, k].sort((a, b) => a - b)
    onChange(next.length ? next : undefined)
  }
  return (
    <div className="pe-winds">
      <div className="pe-winds-head">
        <span>Good winds</span>
        {suggested && (
          <button className="linklike" onClick={() => onChange(suggested)}>
            Suggest
          </button>
        )}
        {winds.length > 0 && (
          <button className="linklike" onClick={() => onChange(undefined)}>
            Clear
          </button>
        )}
      </div>
      <Rose turn={0} value={null} lit={winds.map((k) => k * 45)} inward onPick={toggle} label={(b) => `wind from the ${compass8(b)}`}>
        <span className="pe-winds-mid">{winds.length ? windsLabel(winds) : 'tap where the wind blows from'}</span>
      </Rose>
      {hunted && <div className="pe-winds-hunted">{hunted}</div>}
    </div>
  )
}
