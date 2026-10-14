import { useEffect, useMemo, useState, type JSX } from 'react'
import { ACTIVE_AREA, AREA_LIST, type AreaDef } from '../../areas'
import { switchArea } from '../../areas/switch'
import { getMap } from '../../map/mapController'
import { DROPPED_NAME, isDroppedPin, openPinSheet } from '../../map/placePopup'
import { loadHabitat, onHabitat } from '../../spots/habitatGrid'
import { fromHome } from '../../spots/scoring'
import { windsLabel, windVerdict } from '../../spots/standWinds'
import { placeColour } from '../../state/pinColours'
import { homePlace, latestNote, placeArea, usePlacesStore, type SavedPlace } from '../../state/placesStore'
import { ensureProfile, onProfile } from '../../weather/boundaryLayer'
import { loadMicro, onMicro } from '../../weather/micro/model'
import { useWindChecks } from '../../weather/micro/windChecks'
import { ensureWeatherGrid, onWeatherGrid } from '../../weather/windGrid'
import { IconEdit, IconLocate, IconPin } from '../icons'
import '../ground.css'
import './log.css'

/**
 * Pins: the camp, the lakes, the stands and landings, and the pins dropped
 * on the map. Tapping a row picks it (the map eases there, the strip
 * retargets); tapping the picked row again, or Clear, lets it go. A place
 * in another area says which, and going to it switches the app there
 * (areas/switch.ts), picked once it opens. Another area's own places come
 * last, folded under its name: this area's and your pins stay on top, and a
 * scroll on the phone does not land on a row that reloads into another area.
 *
 * A stand can carry its good winds (spots/standWinds.ts): the row then
 * says how the ground wind at the next sit reads against them. A row's
 * pencil opens the pin's own sheet over the list (PinSheet.tsx): its name,
 * colour, kind, notes and good winds, ‹ Back to here.
 */
export default function PinsSheet(): JSX.Element {
  const places = usePlacesStore((s) => s.places)
  const selectedId = usePlacesStore((s) => s.selectedId)
  const select = usePlacesStore((s) => s.select)
  const remove = usePlacesStore((s) => s.remove)
  const add = usePlacesStore((s) => s.add)
  // the other areas' folds opened, by area id
  const [unfolded, setUnfolded] = useState<string[]>([])
  const checks = useWindChecks((s) => s.checks)
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

  /** The area a place is in when it is not this one; a place in none stays as it was (the map eases as near as it can). */
  const elsewhere = (p: SavedPlace): AreaDef | null => {
    const a = placeArea(p)
    return a && a.id !== ACTIVE_AREA.id ? a : null
  }
  const view = (p: SavedPlace) => ({ center: [p.lon, p.lat] as [number, number], zoom: Math.max(getMap()?.getZoom() ?? 13, 13) })
  const tap = (p: SavedPlace) => {
    if (p.id === selectedId) return select(null)
    const away = elsewhere(p)
    if (away) return void switchArea(away.id, view(p), { kind: 'select', id: p.id })
    select(p.id)
    getMap()?.easeTo(view(p))
  }
  const goTo = (p: SavedPlace) => {
    const away = elsewhere(p)
    // a look, nothing picked, as here; follow stays off there, or a fix in that area takes the map off the place
    if (away) return void switchArea(away.id, view(p), { kind: 'look' })
    getMap()?.easeTo(view(p))
  }
  const addHere = () => {
    const c = getMap()?.getCenter()
    if (!c) return
    // unnamed like any new pin: its sheet's name field starts empty
    const p = add({ name: DROPPED_NAME, lon: c.lng, lat: c.lat, kind: 'stand' })
    select(p.id)
    openPinSheet(p.id, { push: true })
  }
  // folded under its area's name, a place needs no more than its kind
  const where = (p: SavedPlace, folded: boolean) => (p.id === home.id || folded ? p.kind : `${p.kind} · ${elsewhere(p)?.name ?? fromHome(p.lon, p.lat, home)}`)
  // another area's presets go in its fold; your own pins there stay with the rest of yours
  const inFold = (p: SavedPlace) => p.savedAt === 0 && elsewhere(p) != null
  const folds = AREA_LIST.filter((a) => a.id !== ACTIVE_AREA.id && !a.virtual)
    .map((a) => ({ area: a, theirs: places.filter((p) => inFold(p) && placeArea(p)?.id === a.id) }))
    .filter((f) => f.theirs.length > 0)
  const toggleFold = (id: string) => setUnfolded((u) => (u.includes(id) ? u.filter((x) => x !== id) : [...u, id]))

  const row = (p: SavedPlace, folded: boolean) => {
    const on = p.id === selectedId
    return (
      <div key={p.id} className={`place-row${on ? ' place-current' : ''}`}>
        <button className="row-text place-go" aria-pressed={on} onClick={() => tap(p)}>
          <span className="row-title">
            <i className="pin-dot" style={{ background: placeColour(p) }} />
            {p.name}
          </span>
          <span className="row-desc">
            {where(p, folded)}
            {p.winds?.length ? ` · winds ${windsLabel(p.winds)}` : ''}
            {p.note ? ` · ${p.note}` : ''}
          </span>
          {latestNote(p) && <span className="row-desc pin-note">{latestNote(p)!.text}</span>}
          {verdicts.get(p.id) && <span className={`row-desc pw-verdict pw-${verdicts.get(p.id)!.grade}`}>{verdicts.get(p.id)!.text}</span>}
        </button>
        <button className="icon-btn" aria-label="Edit" onClick={() => openPinSheet(p.id, { push: true })}>
          <IconEdit size={16} />
        </button>
        <button className="icon-btn" aria-label="Go" onClick={() => goTo(p)}>
          <IconLocate size={16} />
        </button>
      </div>
    )
  }

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
      <div className="place-list">{places.filter((p) => !inFold(p)).map((p) => row(p, false))}</div>
      {folds.map(({ area, theirs }) => {
        const open = unfolded.includes(area.id)
        return (
          <div key={area.id} className="pin-fold">
            <button className="pin-fold-head" aria-expanded={open} onClick={() => toggleFold(area.id)}>
              <b>{area.name}</b>
              <span className="pin-fold-n">
                {theirs.length} place{theirs.length === 1 ? '' : 's'}
              </span>
              <span className="dim">{open ? '⌃' : '›'}</span>
            </button>
            {open && <div className="place-list">{theirs.map((p) => row(p, true))}</div>}
          </div>
        )
      })}
    </div>
  )
}
