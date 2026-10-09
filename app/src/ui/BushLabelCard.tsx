import { useState } from 'react'
import { BUSH_CLASSES, labelsHere, labelsText, useBushLabels } from '../bushLabels/labelStore'
import { uploadNote } from '../devlog'
import { IconUndo } from './icons'
import './bushLabels.css'

/**
 * The bush-label tool's card, in the bottom bar: pick what the ground is,
 * tap the map where the photo plainly shows it, Send for a code. A label is
 * a 20 m patch; 20 to 40 of each kind across the area is enough to learn
 * from. Done leaves the tool and keeps the labels for next time.
 */
export default function BushLabelCard() {
  const cls = useBushLabels((s) => s.cls)
  const labels = useBushLabels((s) => s.labels)
  const setCls = useBushLabels((s) => s.setCls)
  const undo = useBushLabels((s) => s.undo)
  const setActive = useBushLabels((s) => s.setActive)
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState<{ code: string; n: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const here = labelsHere(labels)
  const count = (id: string) => here.filter((l) => l.cls === id).length
  const pick = BUSH_CLASSES.find((c) => c.id === cls) ?? BUSH_CLASSES[0]

  const send = async () => {
    setBusy(true)
    setError(null)
    try {
      setSent({ code: await uploadNote(labelsText(here)), n: here.length })
    } catch {
      setError('Not sent. It needs signal: try again when you have some.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="tripbuilder glass bushlabel-card">
      <div className="tb-head">
        <span className="tb-title">Label the bush</span>
        <button className="icon-btn" onClick={() => undo()} disabled={here.length === 0} aria-label="Undo the last label">
          <IconUndo size={16} />
        </button>
        <button className="sheet-done" onClick={() => setActive(false)}>
          Done
        </button>
      </div>
      <div className="bl-kinds" role="radiogroup" aria-label="What the ground is">
        {BUSH_CLASSES.map((c) => (
          <button key={c.id} className={`chip-pick${cls === c.id ? ' chip-on' : ''}`} role="radio" aria-checked={cls === c.id} onClick={() => setCls(c.id)}>
            <i className="bl-swatch" style={{ background: c.colour }} aria-hidden="true" />
            {c.name}
            <span className="numeral bl-n">{count(c.id)}</span>
          </button>
        ))}
      </div>
      <div className="tb-facts">
        <span className="dim">
          {pick.name}: {pick.hint}. Tap where the photo clearly shows it.
        </span>
        <span className="bl-send">
          <button className="chip-pick" onClick={() => void send()} disabled={here.length === 0 || busy}>
            {busy ? 'Sending…' : `Send ${here.length}`}
          </button>
          {sent && !busy && (
            <span>
              Sent {sent.n} · code <b className="numeral">{sent.code}</b>
            </span>
          )}
        </span>
        {error && <span className="error">{error}</span>}
      </div>
    </div>
  )
}
