import { useMemo, useState, type JSX, type KeyboardEvent } from 'react'
import { ACTIVE_AREA, AREA_LIST, areaAt, areaById, type AreaDef } from '../../areas'
import { switchArea } from '../../areas/switch'
import { isLink, parsePlace, placeWords, type Place } from '../../map/coords'
import { addRecent, goToSpot, recentPlaces } from '../../map/goto'
import { withMap } from '../../map/mapController'
import { DROPPED_NAME } from '../../map/placePopup'
import { coordWords, mapsLink } from '../../share/link'
import { useAppStore } from '../../state/appStore'
import { usePlacesStore } from '../../state/placesStore'
import { agoLabel } from '../../time'
import '../areas.css'

/**
 * Go to coordinates: the point on the map in two or three taps, with no
 * keyboard. Paste reads the clipboard (a message, a link, Garmin's N/W:
 * map/coords.ts) and a whole place goes straight there; a paste into the
 * box by the phone does the same, so it works with clipboard access
 * refused. Typed, Go waits until the position is good to about 200 m, so a
 * half-typed number never sends the map off, and the read-out says it back
 * the way it was written. Under the box, each area's home and the last
 * places gone to, a tap each.
 *
 * Going there is map/goto.ts's: in this area the map eases to the spot and
 * shows it; in another the app switches there first (asking, as any switch
 * does); in none, "No detail here yet", with Copy, Maps and Pin. `text` is
 * what it opens holding: a paste that could not go straight there, or a
 * point a link sent, in no area.
 */

/** What is in the box, kept when the sheet closes: a tap on the map to put
 *  the keyboard away closes it, and must not throw the typing out. */
let draft = ''
/** The box was typed into, not filled by a paste or by what the sheet
 *  opened holding: only typing may still be coming. */
let draftTyped = false

/** Text more typing could still make a position (digits, their marks, the
 *  hemisphere letters): no "Not a position" while it is coming. */
const COMING = /^[\s\d.,;:°'"+\-NSEWO]*$/i

/** A message's lines side by side: the box is one line, and a browser drops
 *  the breaks outright ("…map" and "https://…" run together, and an edit
 *  then reads the link as no link). It reads the same either way. */
const oneLine = (t: string) => t.replace(/\s*[\r\n]+\s*/g, ' ')

export default function CoordsSheet({ text: given }: { text?: string }): JSX.Element {
  const [text, setText] = useState(() => {
    if (given != null) {
      draft = oneLine(given)
      draftTyped = false
    }
    return draft
  })
  const [typed, setTyped] = useState(draftTyped)
  const [note, setNote] = useState<string | null>(null)
  const [pinned, setPinned] = useState(false)
  // what was gone to before, read as the sheet opens
  const [recent] = useState(recentPlaces)
  const got = useMemo(() => parsePlace(text), [text])
  // a point to act on: only a whole one arms Go and the keyboard's go key
  const pt = got && got.lon != null && got.complete ? got : null
  const rough = got != null && got.lon != null && !got.complete
  const area = pt ? areaAt(pt.lon, pt.lat) : null
  const here = area != null && area.id === ACTIVE_AREA.id
  // the app's link to an area, with no spot in it
  const linked = got && got.lon == null ? areaById(got.area) : null
  const canPaste = typeof navigator.clipboard?.readText === 'function'

  const edit = (raw: string, byHand: boolean) => {
    const t = oneLine(raw)
    draft = t
    draftTyped = byHand
    setText(t)
    setTyped(byHand)
    setNote(null)
    setPinned(false)
  }

  /** The spot shown where it is (map/goto.ts): eased to here, switched to in another area. */
  const go = (p: Place) => {
    // gone to here: the box starts empty next time (the spot is in Recent)
    if (areaAt(p.lon, p.lat)?.id === ACTIVE_AREA.id) draft = ''
    goToSpot({ lon: p.lon, lat: p.lat, name: p.name })
  }

  /** A paste: a whole place goes straight there; anything else waits in the box. */
  const take = (t: string) => {
    edit(t, false)
    const p = parsePlace(t)
    if (!p || p.lon == null || !p.complete) return
    if (areaAt(p.lon, p.lat)) return go(p)
    // in no area there is nowhere to go: the read-out says so, and it goes into Recent
    addRecent({ lon: p.lon, lat: p.lat, name: p.name })
  }

  const paste = () => {
    // read inside the tap: iOS puts its own Paste bubble by the finger, Chrome asks the once
    let read: Promise<string>
    try {
      read = navigator.clipboard.readText()
    } catch {
      read = Promise.reject(new Error('no clipboard'))
    }
    void read.then(take, () => setNote('Could not read the clipboard'))
  }

  /** An area's home (its camp, the Shared spot): eased to in this area, switched to in another. */
  const goHome = (a: AreaDef) => {
    if (a.id !== ACTIVE_AREA.id) return void switchArea(a.id, a.home)
    useAppStore.getState().closeSheet()
    useAppStore.getState().setFollow(false)
    withMap((m) => m.easeTo({ center: a.home.center, zoom: a.home.zoom }))
  }

  /** An area's link: as the link itself opens, on the reader's last view there, else its home. */
  const goLinked = (a: AreaDef) => (a.id === ACTIVE_AREA.id ? goHome(a) : void switchArea(a.id))

  // a point in no area: the coordinates to copy, Maps to see it, or a pin to keep it (it waits in Pins)
  const copy = (p: Place) => {
    addRecent(p)
    const done = (ok: boolean) => setNote(ok ? 'Copied' : 'Could not copy')
    if (typeof navigator.clipboard?.writeText !== 'function') return done(false)
    void navigator.clipboard.writeText(coordWords(p)).then(
      () => done(true),
      () => done(false),
    )
  }
  const pin = (p: Place) => {
    addRecent(p)
    usePlacesStore.getState().add({ name: p.name ?? DROPPED_NAME, lon: p.lon, lat: p.lat, kind: 'stand' })
    setPinned(true)
    setNote('Pinned. It is in Pins.')
  }

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return
    if (pt && area) return go(pt)
    if (linked) return goLinked(linked)
    // a point in no area: nowhere to go, so the keyboard goes away. Half a
    // position: the key waits for the rest
    if (pt) {
      addRecent(pt)
      e.currentTarget.blur()
    }
  }

  let help: string | null = null
  if (text.trim() && !pt && !linked) {
    // typed, more may be coming; pasted or brought, this is all there is, and it says why nothing happens
    if (rough) help = COMING.test(text) && typed ? null : `Too rough a position to go to${got.form === 'dec' || got.form === 'nw' ? ' (3 decimals or better)' : ''}.`
    // an app link to an area this copy of the app does not have
    else if (got) help = 'No position in that link.'
    else if (isLink(text)) help = 'No position in that link. Open it in Maps and copy the coordinates.'
    else if (!COMING.test(text)) help = 'Not a position this can read.'
  }

  return (
    <div className="coords">
      {canPaste && (
        <button className="btn-secondary coords-paste" onClick={paste}>
          Paste
        </button>
      )}
      <input
        className="coords-box"
        type="text"
        value={text}
        placeholder="49.40955, -69.55349"
        aria-label="Coordinates"
        autoCapitalize="characters"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="go"
        onChange={(e) => edit(e.target.value, true)}
        onPaste={(e) => {
          // a whole place pasted in by the phone goes straight there, as Paste does; anything else lands in the box
          const t = e.clipboardData.getData('text')
          const p = parsePlace(t)
          if (!p || p.lon == null || !p.complete) return
          e.preventDefault()
          take(t)
        }}
        onKeyDown={onKey}
      />
      {help && <div className="coords-help">{help}</div>}
      {pt && (
        <div className="coords-found">
          <span className="numeral">{placeWords(pt, pt.form)}</span>
          <small>{[pt.name, here ? area.name : area ? `${area.name} · the app opens there, on the spot` : 'No detail here yet'].filter(Boolean).join(' · ')}</small>
        </div>
      )}
      {pt && area && (
        <div className="coords-acts">
          <button className="btn-primary" onClick={() => go(pt)}>
            {here ? 'Go' : `Go to ${area.name}`}
          </button>
        </div>
      )}
      {pt && !area && (
        <div className="coords-acts">
          <button className="btn-secondary" onClick={() => copy(pt)}>
            Copy
          </button>
          <a className="btn-secondary" href={mapsLink(pt)} target="_blank" rel="noopener noreferrer" onClick={() => addRecent(pt)}>
            Maps
          </a>
          <button className="btn-secondary" disabled={pinned} onClick={() => pin(pt)}>
            Pin
          </button>
        </div>
      )}
      {linked && (
        <>
          <div className="coords-found">
            <span>{linked.name}</span>
            <small>{linked.id === ACTIVE_AREA.id ? 'This area' : 'The app opens there'}</small>
          </div>
          <div className="coords-acts">
            <button className="btn-primary" onClick={() => goLinked(linked)}>
              {linked.id === ACTIVE_AREA.id ? 'Go' : `Go to ${linked.name}`}
            </button>
          </div>
        </>
      )}
      {note && <div className="coords-help">{note}</div>}
      {/* every area's home, this one first (Gavan, 2026-10-04) */}
      <div className="coords-list">
        {AREA_LIST.map((a) => (
          <button key={a.id} className="coords-row" onClick={() => goHome(a)}>
            <span>{a.name}</span>
            <span className="dim">{a.presets[0]?.name}</span>
          </button>
        ))}
      </div>
      {recent.length > 0 && (
        <div className="coords-list">
          <div className="coords-label">Recent</div>
          {recent.map((r) => (
            <button key={`${r.at}:${r.lon}`} className="coords-row" onClick={() => goToSpot({ lon: r.lon, lat: r.lat, name: r.name })}>
              <span>{r.name ?? coordWords(r)}</span>
              <span className="dim">{[r.area && r.area !== ACTIVE_AREA.id ? areaById(r.area)?.name : null, agoLabel(Date.now() - r.at)].filter(Boolean).join(' · ')}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
