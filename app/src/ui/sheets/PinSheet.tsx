import { useLayoutEffect, useRef, useState, type CSSProperties, type JSX } from 'react'
import { ACTIVE_AREA } from '../../areas'
import type { PinNote, PlaceDef } from '../../config'
import { DROPPED_NAME } from '../../map/placePopup'
import { coordWords } from '../../share/link'
import { shareSpot } from '../../share/share'
import { fromHome } from '../../spots/scoring'
import { useAppStore } from '../../state/appStore'
import { PIN_COLOURS, placeColour } from '../../state/pinColours'
import { homePlace, placeArea, usePlacesStore } from '../../state/placesStore'
import { agoLabel, stampLabel } from '../../time'
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
 *
 * Everything saves as it is typed. A note is written the moment its first
 * letter is, so closing the sheet mid-sentence keeps what was there.
 */
export default function PinSheet({ id }: { id: string }): JSX.Element {
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
  const notes = (p.notes ?? []).filter((n) => n.at !== draftAt).reverse()

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
        <button className="sheet-done" onClick={close}>
          Done
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

      <NoteBox id={p.id} onDraft={setDraftAt} />
      {notes.length > 0 && (
        <div className="ps-notes">
          {notes.map((n) => (
            <NoteRow key={n.at} id={p.id} n={n} />
          ))}
        </div>
      )}

      <div className="ps-meta">
        {p.savedAt > 0 ? `dropped ${agoLabel(Date.now() - p.savedAt)}` : p.kind}
        {where ? ` · ${where}` : ''}
        <br />
        {coordWords(p)}
      </div>
      <div className="ps-acts">
        <button className="btn-secondary" onClick={share}>
          {shared ?? 'Share'}
        </button>
        <button className="btn-secondary ps-delete" onClick={del}>
          Delete pin
        </button>
      </div>
    </div>
  )
}

/** A textarea as tall as what is in it. */
function useGrow(ref: React.RefObject<HTMLTextAreaElement | null>, text: string) {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [ref, text])
}

/**
 * The next note. Its first letter writes it, stamped then; each one after
 * edits it; emptied, it goes. Let go of (Done, a tap elsewhere) it joins
 * the list and the box is empty for the next.
 */
function NoteBox({ id, onDraft }: { id: string; onDraft: (at: number | null) => void }): JSX.Element {
  const [text, setText] = useState('')
  const draft = useRef<number | null>(null)
  const ref = useRef<HTMLTextAreaElement>(null)
  useGrow(ref, text)
  const change = (v: string) => {
    setText(v)
    const st = usePlacesStore.getState()
    const t = v.trim()
    if (draft.current == null) {
      if (!t) return
      draft.current = st.addNote(id, t)
      onDraft(draft.current)
    } else if (t) st.editNote(id, draft.current, t)
    else {
      st.removeNote(id, draft.current)
      draft.current = null
      onDraft(null)
    }
  }
  const finish = () => {
    if (draft.current == null) return
    draft.current = null
    setText('')
    onDraft(null)
  }
  return <textarea ref={ref} className="ps-addnote" rows={1} placeholder="Add a note" aria-label="Add a note" maxLength={2000} value={text} onChange={(e) => change(e.target.value)} onBlur={finish} />
}

/** A note written before: its words and when. A tap edits it in place; emptied, or Delete, and it goes. */
function NoteRow({ id, n }: { id: string; n: PinNote }): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(n.text)
  const ref = useRef<HTMLTextAreaElement>(null)
  useGrow(ref, editing ? text : '')
  const st = usePlacesStore.getState
  if (!editing) {
    return (
      <button
        className="ps-note"
        onClick={() => {
          setText(n.text)
          setEditing(true)
        }}
      >
        <span className="ps-note-text">{n.text}</span>
        <span className="ps-note-when">{stampLabel(n.at)}</span>
      </button>
    )
  }
  return (
    <div className="ps-note ps-note-edit">
      <textarea
        ref={ref}
        rows={1}
        autoFocus
        aria-label="Note"
        maxLength={2000}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          if (e.target.value.trim()) st().editNote(id, n.at, e.target.value.trim())
        }}
        onBlur={(e) => {
          // a tap on Delete lands after the blur: let it do the deleting
          if ((e.relatedTarget as HTMLElement | null)?.dataset.del) return
          if (!text.trim()) st().removeNote(id, n.at)
          setEditing(false)
        }}
      />
      <span className="ps-note-when">
        {stampLabel(n.at)} ·{' '}
        <button
          className="linklike danger"
          data-del="1"
          // the textarea keeps the focus, so its blur does not take this button away under the tap
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            if (confirm('Delete this note?')) st().removeNote(id, n.at)
          }}
        >
          Delete
        </button>
      </span>
    </div>
  )
}
