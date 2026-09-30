import { useState, type JSX } from 'react'
import { HOT_MAX, useAppStore, type HotId, type HotSide } from '../../state/appStore'
import { useViews } from '../../state/viewsStore'
import { HOT_DEFS, HOT_ORDER } from '../hotButtons'
import { IconLocate } from '../icons'
import './settings.css'

/**
 * Map buttons: both columns, per mode, up to four each. Near is the
 * thumb's column (right, or left for a left hand) with My location fixed at
 * its foot; far is the other. The heading row is its own: the title, the
 * Hunting | Fishing switch and Done (back to Settings, which pushed it).
 */
export default function ButtonsSheet(): JSX.Element {
  const [mode, setMode] = useState<'hunt' | 'fish'>(() => useViews.getState().mode)
  const sets = useAppStore((s) => s.hotButtons[mode])
  const leftHanded = useAppStore((s) => s.leftHanded)
  const setHotButtons = useAppStore((s) => s.setHotButtons)
  const stacked = useAppStore((s) => s.sheets.length > 1)
  const popSheet = useAppStore((s) => s.popSheet)
  const closeSheet = useAppStore((s) => s.closeSheet)
  const used = [...sets.near, ...sets.far]
  const free = HOT_ORDER.filter((id) => !used.includes(id))
  const [adding, setAdding] = useState<HotSide>('near')

  const column = (side: HotSide, title: string) => {
    const ids = sets[side]
    return (
      <>
        <div className="st-sec">
          {title} · up to {HOT_MAX}
        </div>
        <div>
          {ids.map((id) => (
            <Slot key={id} id={id} onRemove={() => setHotButtons(mode, side, ids.filter((x) => x !== id))} />
          ))}
          {Array.from({ length: Math.max(0, HOT_MAX - ids.length) }, (_, i) => (
            <button key={`empty-${i}`} className={`hotedit-empty${adding === side ? ' on' : ''}`} onClick={() => setAdding(side)}>
              empty
            </button>
          ))}
          {side === 'near' && (
            <div className="hotedit-locked">
              <span className="fab">
                <IconLocate />
              </span>
              <span>My location</span>
            </div>
          )}
        </div>
      </>
    )
  }

  return (
    <div className="settings">
      <div className="sheet-head">
        <span className="sheet-title">Map buttons</span>
        <div className="seg" role="radiogroup" aria-label="Which set">
          {(['hunt', 'fish'] as const).map((m) => (
            <button key={m} className={mode === m ? 'seg-on' : ''} role="radio" aria-checked={mode === m} onClick={() => setMode(m)}>
              {m === 'hunt' ? 'Hunting' : 'Fishing'}
            </button>
          ))}
        </div>
        <button className="sheet-done" onClick={stacked ? popSheet : closeSheet}>
          Done
        </button>
      </div>

      {column('near', leftHanded ? 'Left · under your thumb' : 'Right · under your thumb')}
      {column('far', leftHanded ? 'Right' : 'Left')}

      <div className="st-sec">
        Add to the {adding === 'near' ? (leftHanded ? 'left' : 'right') : leftHanded ? 'right' : 'left'}
      </div>
      <div className="hotedit-add">
        {free.map((id) => (
          <button key={id} disabled={sets[adding].length >= HOT_MAX} onClick={() => setHotButtons(mode, adding, [...sets[adding], id])}>
            {HOT_DEFS[id].name}
          </button>
        ))}
      </div>
    </div>
  )
}

/** One slot: the button's icon, its name, − to take it out. */
function Slot({ id, onRemove }: { id: HotId; onRemove: () => void }): JSX.Element {
  const d = HOT_DEFS[id]
  const on = d.useActive()
  return (
    <div className="hotedit-slot">
      <span className={`fab${on ? ' active' : ''}`}>
        <d.Icon />
      </span>
      <span>{d.name}</span>
      <button onClick={onRemove} aria-label={`Remove ${d.name}`}>
        −
      </button>
    </div>
  )
}
