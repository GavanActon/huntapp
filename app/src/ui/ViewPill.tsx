import { useEffect, useRef, useState } from 'react'
import { startHunting, stopHunting, useHunting } from '../hunting/hunting'
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
 *
 * Hunting mode starts and stops here too (hunting/hunting.ts): while it is
 * on, the pill says so, with how long, and the menu's first button stops it.
 */

function elapsed(ms: number): string {
  const m = Math.max(0, Math.floor(ms / 60_000))
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`
}
export default function ViewPill() {
  const mode = useViews((s) => s.mode)
  const saved = useViews((s) => s.saved)
  const setMode = useViews((s) => s.setMode)
  const apply = useViews((s) => s.apply)
  const saveCurrent = useViews((s) => s.saveCurrent)
  const remove = useViews((s) => s.remove)
  const layers = useAppStore((s) => s.layers)
  const heat = useSpotsStore((s) => s.heat)
  const hunting = useHunting((s) => s.on)
  const startedAt = useHunting((s) => s.startedAt)
  const [open, setOpen] = useState(false)
  const [, tick] = useState(0)
  const box = useRef<HTMLDivElement>(null)

  // the time out hunting, kept current
  useEffect(() => {
    if (!hunting) return
    const t = window.setInterval(() => tick((x) => x + 1), 30_000)
    return () => window.clearInterval(t)
  }, [hunting])

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
          {hunting ? (
            <div className="vp-hunt">
              <button
                className="btn-primary vp-stop"
                onClick={() => {
                  stopHunting()
                  setOpen(false)
                }}
              >
                Stop hunting
              </button>
              <div className="vp-note">The track records while the screen is on and joins up across the times it was off.</div>
            </div>
          ) : (
            <>
              {mode === 'hunt' && (
                <div className="vp-hunt">
                  <button
                    className="btn-primary"
                    onClick={() => {
                      startHunting()
                      setOpen(false)
                    }}
                  >
                    Go hunting
                  </button>
                  <div className="vp-note">Follows you, records the track, and your scent cone goes with you. Lock the phone between looks.</div>
                </div>
              )}
              <div className="seg" role="radiogroup" aria-label="Mode">
                {(Object.keys(MODE_NAMES) as Mode[]).map((m) => (
                  <button key={m} className={mode === m ? 'seg-on' : ''} role="radio" aria-checked={mode === m} onClick={() => setMode(m)}>
                    {MODE_NAMES[m]}
                  </button>
                ))}
              </div>
            </>
          )}
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
      <button className={`viewpill glass${hunting ? ' vp-on' : ''}`} onClick={() => setOpen(!open)} aria-expanded={open} aria-label="Mode and view">
        {hunting ? <span className="vp-dot" /> : <IconLayers size={15} />}
        <span>
          {hunting ? `Hunting ${elapsed(Date.now() - (startedAt ?? Date.now()))}` : MODE_NAMES[mode]} · {on ? on.name : 'custom'}
        </span>
      </button>
    </div>
  )
}
