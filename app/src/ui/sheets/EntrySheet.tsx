import { useState, type JSX } from 'react'
import { useHuntLog, type LogEntry } from '../../log/huntLog'
import { entryEditable, entryTitle } from '../../log/logLayer'
import { openPinSheet } from '../../map/placePopup'
import { coordWords } from '../../share/link'
import { shareSpot } from '../../share/share'
import { useAppStore } from '../../state/appStore'
import { usePlacesStore } from '../../state/placesStore'
import { agoLabel, hourMinShort } from '../../time'
import { compass } from '../../weather/openMeteo'
import { useHeardForm } from '../HeardCard'
import { dist } from '../../lengths'
import { NoteBox, NoteList, type NoteStore } from './Notes'
import './log.css'

/**
 * One game entry, all of it, as a pin is (Gavan, 2026-10-19: "Heard should
 * ride pinned infra. Ability to have notes; share; etc."): what it was and
 * when, where you heard it from, dated notes, where it is; Edit (what it
 * was, which animal: the Game card), Share, Keep as a pin (a pin there with
 * the notes, for a spot to come back to), and Delete, asking first. Opened
 * from the entry's popup (Open), as a pin's is.
 */
export default function EntrySheet({ id }: { id: string }): JSX.Element {
  const e = useHuntLog((s) => s.entries.find((x) => x.id === id))
  const stacked = useAppStore((s) => s.sheets.length > 1)
  const [draftAt, setDraftAt] = useState<number | null>(null)
  const [shared, setShared] = useState<string | null>(null)
  if (!e) return <div className="empty">This entry is gone.</div>

  const close = () => {
    const app = useAppStore.getState()
    if (stacked) app.popSheet()
    else app.closeSheet()
  }
  const store: NoteStore = {
    add: (text) => useHuntLog.getState().addNote(e.id, text),
    edit: (at, text) => useHuntLog.getState().editNote(e.id, at, text),
    remove: (at) => useHuntLog.getState().removeNote(e.id, at),
  }
  const title = entryTitle(e)
  const theirs = !!e.taken
  const share = () => {
    // inside the tap, nothing awaited first: iOS refuses a share that is not
    void shareSpot({ lon: e.lon, lat: e.lat, name: title }).then((r) => {
      if (r !== 'copied' && r !== 'failed') return
      setShared(r === 'copied' ? 'Copied' : 'Could not copy')
      window.setTimeout(() => setShared(null), r === 'copied' ? 1200 : 2400)
    })
  }
  const keep = () => {
    const places = usePlacesStore.getState()
    const sp = places.add({ name: title, lon: e.lon, lat: e.lat, kind: 'stand' })
    for (const n of e.notes ?? []) places.addNote(sp.id, n.text, n.at)
    close()
    openPinSheet(sp.id)
  }
  const edit = () => {
    close()
    useHeardForm.getState().editEntry(e.id)
  }
  const del = () => {
    if (!confirm(`Delete ${title}?`)) return
    close()
    useHuntLog.getState().remove(e.id)
  }

  return (
    <div className="pin-sheet">
      <div className="sheet-head ps-head">
        <span className="ps-name ps-title">{title}</span>
        <button className="sheet-done" onClick={close}>
          Done
        </button>
      </div>
      <div className="ps-about">{whenWords(e)}</div>
      {e.note && <div className="ps-about">{e.note}</div>}

      {!theirs && <NoteBox store={store} onDraft={setDraftAt} />}
      <NoteList store={store} notes={e.notes} draftAt={draftAt} />

      <div className="ps-meta">{coordWords(e)}</div>
      <div className="ps-acts">
        {entryEditable(e) && (
          <button className="btn-secondary" onClick={edit}>
            Edit
          </button>
        )}
        <button className="btn-secondary" onClick={share}>
          {shared ?? 'Share'}
        </button>
        <button className="btn-secondary" onClick={keep}>
          Keep as a pin
        </button>
        {!theirs && (
          <button className="btn-secondary ps-delete" onClick={del}>
            Delete
          </button>
        )}
      </div>
    </div>
  )
}

/** "6:12 · 2 h ago · 300 m NNE of where you stood · by GA" */
function whenWords(e: LogEntry): string {
  const parts = [hourMinShort(e.ts), agoLabel(Date.now() - e.ts)]
  if (e.from) parts.push(`${dist(e.from.distM)} ${compass(e.from.bearing)} of where you stood`)
  if (e.by) parts.push(`by ${e.by}`)
  return parts.join(' · ')
}
