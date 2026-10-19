import { useLayoutEffect, useRef, useState, type CSSProperties, type JSX } from 'react'
import { NoteBox, NoteList, type NoteStore } from './Notes'
import { ACTIVE_AREA } from '../../areas'
import type { PlaceDef } from '../../config'
import { DROPPED_NAME } from '../../map/placePopup'
import { coordWords } from '../../share/link'
import { shareSpot } from '../../share/share'
import { fromHome } from '../../spots/scoring'
import { useAppStore } from '../../state/appStore'
import { PIN_COLOURS, placeColour } from '../../state/pinColours'
import { homePlace, placeArea, usePlacesStore } from '../../state/placesStore'
import { agoLabel } from '../../time'
import './log.css'

const KINDS: PlaceDef['kind'][] = ['stand', 'trail', 'landing', 'camp', 'lake']

/**
 * One pin, all of it: its name, colour and kind, a box for the next note and
 * the notes before it, newest first, each stamped when it was written; where
 * it is; Share, and Delete last of all, always asking first (Gavan,
 * 2026-10-15). No good winds (Gavan, 2026-10-14: "cut the good winds from
 * it"); a stand that has them still says how the next sit reads in its Pins
 * row.
 * Adding a pin opens it (Gavan, 2026-10-14: "adding a pin brings up a screen
 * with all the details"), as do the popup's Open and a Pins row's Edit.
 * Just dropped (fresh), it has a clear Save in its head that closes it, and
 * no Share or Delete; those come when it is opened again (Gavan, 2026-10-15).
 *
 * Everything saves as it is typed. A note is written the moment its first
 * letter is, so closing the sheet mid-sentence keeps what was there.
 */
export default function PinSheet({ id, fresh = false }: { id: string; fresh?: boolean }): JSX.Element {
  const p = usePlacesStore((s) => s.places.find((q) => q.id === id))
  const update = usePlacesStore((s) => s.update)
  const stacked = useAppStore((s) => s.sheets.length > 1)
  // the note being typed: written already, kept out of the list until it is done
  const [draftAt, setDraftAt] = useState<number | null>(null)
  const [shared, setShared] = useState<string | null>(null)
  // the field's own words: the store holds Pin for an empty one, and a name typed as "Pin" must not blank it
  const [name, setName] = useState(p && p.name !== DROPPED_NAME ? p.name : '')
  // pushed over a list scrolled down (Pins), the sheet's body keeps that scroll: start at the name
  const root = useRef<HTMLDivElement>(null)
  // a block, not an arrow's value: newer Chrome's scrollTo returns a Promise, which React would take for a clean-up
  useLayoutEffect(() => {
    root.current?.closest('.sheet-body')?.scrollTo(0, 0)
  }, [])
  if (!p) return <div className="empty">This pin is gone.</div>

  const close = () => {
    const app = useAppStore.getState()
    if (stacked) app.popSheet()
    else app.closeSheet()
  }
  const del = () => {
    if (!confirm(p.name === DROPPED_NAME ? 'Delete this pin?' : `Delete ${p.name}?`)) return
    close()
    usePlacesStore.getState().remove(p.id)
  }
  const share = () => {
    // inside the tap, nothing awaited first: iOS refuses a share that is not
    void shareSpot(p).then((r) => {
      if (r !== 'copied' && r !== 'failed') return
      setShared(r === 'copied' ? 'Copied' : 'Could not copy')
      window.setTimeout(() => setShared(null), r === 'copied' ? 1200 : 2400)
    })
  }
  const home = homePlace()
  const away = placeArea(p)
  const where = p.id === home.id ? null : away && away.id !== ACTIVE_AREA.id ? away.name : fromHome(p.lon, p.lat, home)
  const store: NoteStore = {
    add: (text) => usePlacesStore.getState().addNote(p.id, text),
    edit: (at, text) => usePlacesStore.getState().editNote(p.id, at, text),
    remove: (at) => usePlacesStore.getState().removeNote(p.id, at),
  }

  return (
    <div className="pin-sheet" ref={root}>
      <div className="sheet-head ps-head">
        <i className="ps-dot" style={{ background: placeColour(p) }} />
        <input
          className="ps-name"
          value={name}
          placeholder="Name this pin"
          aria-label="Name"
          maxLength={40}
          autoComplete="off"
          enterKeyHint="done"
          // a fresh pin is still called Pin: the field starts empty, so typing names it; left empty it stays Pin
          onChange={(e) => {
            setName(e.target.value)
            update(p.id, { name: e.target.value.trim() || DROPPED_NAME })
          }}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
        {/* it is saved already, as typed: Save is the plain way out */}
        <button className={fresh ? 'sheet-done ps-save' : 'sheet-done'} onClick={close}>
          {fresh ? 'Save' : 'Done'}
        </button>
      </div>
      {p.note && <div className="ps-about">{p.note}</div>}
      <div className="pin-swatches">
        {PIN_COLOURS.map((c) => (
          <button key={c} className={`pin-swatch${placeColour(p) === c ? ' on' : ''}`} style={{ '--sw': c } as CSSProperties} aria-label={`Colour ${c}`} aria-pressed={placeColour(p) === c} onClick={() => update(p.id, { color: c })} />
        ))}
      </div>
      <div className="ps-kinds" role="group" aria-label="Kind">
        {KINDS.map((k) => (
          <button key={k} className={p.kind === k ? 'on' : undefined} aria-pressed={p.kind === k} onClick={() => update(p.id, { kind: k })}>
            {k}
          </button>
        ))}
      </div>

      <NoteBox store={store} onDraft={setDraftAt} />
      <NoteList store={store} notes={p.notes} draftAt={draftAt} />

      <div className="ps-meta">
        {p.savedAt > 0 ? `dropped ${agoLabel(Date.now() - p.savedAt)}` : p.kind}
        {where ? ` · ${where}` : ''}
        <br />
        {coordWords(p)}
      </div>
      {!fresh && (
        <div className="ps-acts">
          <button className="btn-secondary" onClick={share}>
            {shared ?? 'Share'}
          </button>
          <button className="btn-secondary ps-delete" onClick={del}>
            Delete pin
          </button>
        </div>
      )}
    </div>
  )
}
