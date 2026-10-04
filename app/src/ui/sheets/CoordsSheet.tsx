import { useMemo, useState, type JSX } from 'react'
import { ACTIVE_AREA, areaAt } from '../../areas'
import { switchArea } from '../../areas/switch'
import { isLink, parseCoords } from '../../map/coords'
import { getMap } from '../../map/mapController'
import { fmtCoord } from '../../map/MapView'
import { DROPPED_NAME, showPlacePopup } from '../../map/placePopup'
import { useAppStore } from '../../state/appStore'
import { usePlacesStore } from '../../state/placesStore'
import '../areas.css'

/**
 * Go to coordinates: one box that takes a position however it comes
 * (map/coords.ts: Garmin's N 49.409550° W 69.553490°, plain decimals,
 * degrees and minutes, a map link), the point it read and the area it is
 * in. In this area Go eases there and Drop a pin pins it; in another, Go
 * switches the app there and drops a pin on the spot once it opens; in
 * none, "No detail here yet", with the coordinates to copy.
 */
export default function CoordsSheet(): JSX.Element {
  const [text, setText] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const closeSheet = useAppStore((s) => s.closeSheet)
  const pt = useMemo(() => parseCoords(text), [text])
  const area = pt ? areaAt(pt.lon, pt.lat) : null
  const here = area != null && area.id === ACTIVE_AREA.id

  /** The map to the point in this area, follow off so the next fix does not take it back. */
  const ease = (lon: number, lat: number) => {
    const m = getMap()
    if (!m) return null
    closeSheet()
    useAppStore.getState().setFollow(false)
    m.easeTo({ center: [lon, lat], zoom: Math.max(m.getZoom(), 14) })
    return m
  }
  const go = () => {
    if (!pt || !area) return
    if (here) return void ease(pt.lon, pt.lat)
    switchArea(area.id, { center: [pt.lon, pt.lat], zoom: Math.max(getMap()?.getZoom() ?? 14, 14) }, { kind: 'pin', lon: pt.lon, lat: pt.lat })
  }
  const pin = () => {
    if (!pt) return
    const p = usePlacesStore.getState().add({ name: DROPPED_NAME, lon: pt.lon, lat: pt.lat, kind: 'stand' })
    // in no area the map cannot show it: it waits in Pins
    if (!area) return setNote('Pinned. It is in Pins.')
    const m = ease(pt.lon, pt.lat)
    if (m) showPlacePopup(m, p)
  }
  const copy = () => {
    if (!pt) return
    void navigator.clipboard?.writeText(fmtCoord(pt.lon, pt.lat))
    setNote('Copied')
  }

  return (
    <div className="coords">
      <input
        className="coords-box"
        type="text"
        value={text}
        placeholder="N 49.409550° W 69.553490°"
        aria-label="Coordinates"
        autoCapitalize="characters"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="go"
        onChange={(e) => {
          setText(e.target.value)
          setNote(null)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') go()
        }}
      />
      {!text.trim() && <div className="coords-help">As Garmin writes it, 49.40955, -69.55349, degrees and minutes, or a Google or Apple Maps link.</div>}
      {text.trim() !== '' && !pt && (
        <div className="coords-help">{isLink(text) ? 'No position in that link. Open it in Maps and copy the coordinates.' : 'Not a position this can read.'}</div>
      )}
      {pt && (
        <div className="coords-found">
          <span className="numeral">{fmtCoord(pt.lon, pt.lat)}</span>
          <small>{here ? area.name : area ? `${area.name} · the app opens there, with a pin on the spot` : 'No detail here yet'}</small>
        </div>
      )}
      {pt && (
        <div className="coords-acts">
          {area ? (
            <button className="btn-primary" onClick={go}>
              {here ? 'Go' : `Go to ${area.name}`}
            </button>
          ) : (
            <button className="btn-secondary" onClick={copy}>
              Copy
            </button>
          )}
          {(here || !area) && (
            <button className="btn-secondary" onClick={pin}>
              Drop a pin
            </button>
          )}
        </div>
      )}
      {note && <div className="coords-help">{note}</div>}
    </div>
  )
}
