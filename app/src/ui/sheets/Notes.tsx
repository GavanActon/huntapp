import { useLayoutEffect, useRef, useState, type JSX } from 'react'
import type { PinNote } from '../../config'
import { stampLabel } from '../../time'

/**
 * Dated notes, the Pin sheet's and a log entry's alike (Gavan, 2026-10-19:
 * "Heard should ride pinned infra, ability to have notes"): a box for the
 * next note and the notes before it, each stamped when it was written. The
 * owner hands in its store's three verbs; everything saves as it is typed.
 */
export interface NoteStore {
  /** writes a note, returns its stamp */
  add: (text: string) => number
  edit: (at: number, text: string) => void
  remove: (at: number) => void
}

/** A textarea as tall as what is in it. */
export function useGrow(ref: React.RefObject<HTMLTextAreaElement | null>, text: string) {
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
export function NoteBox({ store, onDraft }: { store: NoteStore; onDraft: (at: number | null) => void }): JSX.Element {
  const [text, setText] = useState('')
  const draft = useRef<number | null>(null)
  const ref = useRef<HTMLTextAreaElement>(null)
  useGrow(ref, text)
  const change = (v: string) => {
    setText(v)
    const t = v.trim()
    if (draft.current == null) {
      if (!t) return
      draft.current = store.add(t)
      onDraft(draft.current)
    } else if (t) store.edit(draft.current, t)
    else {
      store.remove(draft.current)
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
export function NoteRow({ store, n }: { store: NoteStore; n: PinNote }): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState(n.text)
  const ref = useRef<HTMLTextAreaElement>(null)
  useGrow(ref, editing ? text : '')
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
          if (e.target.value.trim()) store.edit(n.at, e.target.value.trim())
        }}
        onBlur={(e) => {
          // a tap on Delete lands after the blur: let it do the deleting
          if ((e.relatedTarget as HTMLElement | null)?.dataset.del) return
          if (!text.trim()) store.remove(n.at)
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
            if (confirm('Delete this note?')) store.remove(n.at)
          }}
        >
          Delete
        </button>
      </span>
    </div>
  )
}

/** The notes, newest first, less the one being typed. */
export function NoteList({ store, notes, draftAt }: { store: NoteStore; notes: PinNote[] | undefined; draftAt: number | null }): JSX.Element | null {
  const list = (notes ?? []).filter((n) => n.at !== draftAt).reverse()
  if (!list.length) return null
  return (
    <div className="ps-notes">
      {list.map((n) => (
        <NoteRow key={n.at} store={store} n={n} />
      ))}
    </div>
  )
}
