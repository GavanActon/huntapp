import { useState, type JSX } from 'react'
import { HOT_MAX, useAppStore, type HotId } from '../../state/appStore'
import { useViews } from '../../state/viewsStore'
import { HOT_DEFS, HOT_ORDER } from '../hotButtons'
import { IconLocate, IconRoute, IconRuler, IconWind } from '../icons'
import './settings.css'

const RIGHT = [
  { name: 'Routes', Icon: IconRoute },
  { name: 'Measure', Icon: IconRuler },
  { name: 'Wind flow', Icon: IconWind },
  { name: 'My location', Icon: IconLocate },
]

/**
 * Map buttons: which hot buttons the left column holds, per mode, up to
 * four. The right column is listed so the whole bottom is in one place,
 * but it does not change. The heading row is its own: the title, the
 * Hunting | Fishing switch and Done (back to Settings, which pushed it).
 */
export default function ButtonsSheet(): JSX.Element {
  const [mode, setMode] = useState<'hunt' | 'fish'>(() => useViews.getState().mode)
  const ids = useAppStore((s) => s.hotButtons[mode])
  const setHotButtons = useAppStore((s) => s.setHotButtons)
  const stacked = useAppStore((s) => s.sheets.length > 1)
  const popSheet = useAppStore((s) => s.popSheet)
  const closeSheet = useAppStore((s) => s.closeSheet)
  const free = HOT_ORDER.filter((id) => !ids.includes(id))
  const full = ids.length >= HOT_MAX

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

      <div className="st-sec">Left · yours · up to {HOT_MAX}</div>
      <div>
        {ids.map((id) => (
          <Slot key={id} id={id} onRemove={() => setHotButtons(mode, ids.filter((x) => x !== id))} />
        ))}
        {Array.from({ length: Math.max(0, HOT_MAX - ids.length) }, (_, i) => (
          <div key={`empty-${i}`} className="hotedit-empty">
            empty
          </div>
        ))}
      </div>

      <div className="st-sec">Add</div>
      <div className="hotedit-add">
        {free.map((id) => (
          <button key={id} disabled={full} onClick={() => setHotButtons(mode, [...ids, id])}>
            {HOT_DEFS[id].name}
          </button>
        ))}
      </div>

      <div className="st-sec">Right · always there</div>
      <div>
        {RIGHT.map(({ name, Icon }) => (
          <div key={name} className="hotedit-locked">
            <span className="fab">
              <Icon />
            </span>
            <span>{name}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** One of the left column's slots: the button's icon, its name, − to take it out. */
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
