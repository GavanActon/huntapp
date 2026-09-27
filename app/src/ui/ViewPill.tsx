import { useEffect, useRef, useState } from 'react'
import { useAppStore } from '../state/appStore'
import { useSpotsStore } from '../state/spotsStore'
import { activeView, MODE_NAMES, useViews, viewsFor, type Mode } from '../state/viewsStore'
import { IconLayers, IconTrash } from './icons'
import './views.css'

/**
 * The mode and view switcher on the main screen: one pill, bottom left,
 * saying what the map is set up for ("Hunt · Scout"). Tap it for the modes
 * and the views; one more tap puts a view on. Saving the map as it is now
 * is at the bottom of the list.
 */
export default function ViewPill() {
  const mode = useViews((s) => s.mode)
  const saved = useViews((s) => s.saved)
  const setMode = useViews((s) => s.setMode)
  const apply = useViews((s) => s.apply)
  const saveCurrent = useViews((s) => s.saveCurrent)
  const remove = useViews((s) => s.remove)
  const layers = useAppStore((s) => s.layers)
  const heat = useSpotsStore((s) => s.heat)
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  const views = viewsFor(mode, saved)
  const on = activeView(views, layers, heat)

  // a tap anywhere else closes it
  useEffect(() => {
    if (!open) return
    const off = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', off)
    return () => window.removeEventListener('pointerdown', off)
  }, [open])

  return (
    <div className="viewpill-wrap" ref={box}>
      {open && (
        <div className="viewpill-menu glass" role="menu">
          <div className="seg" role="radiogroup" aria-label="Mode">
            {(Object.keys(MODE_NAMES) as Mode[]).map((m) => (
              <button key={m} className={mode === m ? 'seg-on' : ''} role="radio" aria-checked={mode === m} onClick={() => setMode(m)}>
                {MODE_NAMES[m]}
              </button>
            ))}
          </div>
          <div className="viewpill-list">
            {views.map((v) => (
              <div key={v.id} className={`viewpill-row${on?.id === v.id ? ' on' : ''}`}>
                <button
                  className="viewpill-name"
                  role="menuitem"
                  onClick={() => {
                    apply(v)
                    setOpen(false)
                  }}
                >
                  {v.name}
                </button>
                {!v.builtIn && (
                  <button
                    className="icon-btn danger"
                    aria-label={`Delete ${v.name}`}
                    onClick={() => {
                      if (confirm(`Delete the view ${v.name}?`)) remove(v.id)
                    }}
                  >
                    <IconTrash size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
          <button
            className="linklike viewpill-save"
            onClick={() => {
              const name = prompt('Name this view', on ? `${on.name} 2` : 'My view')?.trim()
              if (name) saveCurrent(name)
            }}
          >
            + Save this map as a view
          </button>
        </div>
      )}
      <button className="viewpill glass" onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Mode and view">
        <IconLayers size={15} />
        <span>
          {MODE_NAMES[mode]} · {on ? on.name : 'custom'}
        </span>
      </button>
    </div>
  )
}
