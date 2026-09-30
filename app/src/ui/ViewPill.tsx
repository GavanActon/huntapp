import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../state/appStore'
import { currentView, useViews, viewsFor, type MapView } from '../state/viewsStore'
import { IconCheck, IconChevronDown, IconLayers, IconTrash } from './icons'
import { useTapOff } from './tapOff'
import './views.css'

/**
 * The view pill, bottom left: the name of the view the map is showing
 * ("Scout"), and a menu of the mode's views. The first four built-ins sit
 * at the top; `More ›` unfolds the rest and the saved ones; `Edit this
 * view ›` opens the layers sheet. No modes here: the quarry chip on the
 * strip sets hunting or fishing. The menu's open state lives in the app
 * store (viewMenuOpen) so the hot column can step out from under it.
 */

/** built-ins shown before `More ›` */
const FIRST = 4

export default function ViewPill() {
  // the four reads currentView() depends on, so the name follows every change
  const layers = useAppStore((s) => s.layers)
  const mode = useViews((s) => s.mode)
  const saved = useViews((s) => s.saved)
  const lastViewId = useViews((s) => s.lastViewId)
  const apply = useViews((s) => s.apply)
  const remove = useViews((s) => s.remove)
  const open = useAppStore((s) => s.viewMenuOpen)
  const setOpen = useAppStore((s) => s.setViewMenuOpen)
  const openSheet = useAppStore((s) => s.openSheet)
  const [more, setMore] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  const on = useMemo(() => currentView(), [layers, mode, saved, lastViewId])
  const views = useMemo(() => viewsFor(mode, saved), [mode, saved])
  const first = views.filter((v) => v.builtIn).slice(0, FIRST)
  const rest = views.filter((v) => !first.includes(v))

  // the pill leaves the screen with the menu up (a sheet opens): the hot
  // column must come back
  useEffect(() => () => setOpen(false), [setOpen])

  function close() {
    setOpen(false)
    setMore(false)
  }

  useTapOff(box, open, close)

  const row = (v: MapView) => (
    <div key={v.id} className={`viewpill-row${on?.id === v.id ? ' on' : ''}`}>
      <button
        className="viewpill-name"
        role="menuitem"
        onClick={() => {
          apply(v)
          close()
        }}
      >
        <span>{v.name}</span>
        {on?.id === v.id && <IconCheck size={18} />}
      </button>
      {!v.builtIn && (
        <button
          className="icon-btn danger viewpill-trash"
          aria-label={`Delete ${v.name}`}
          onClick={() => {
            if (confirm(`Delete the view ${v.name}?`)) remove(v.id)
          }}
        >
          <IconTrash size={14} />
        </button>
      )}
    </div>
  )

  return (
    <div className="viewpill-wrap" ref={box}>
      {open && (
        <div className="viewpill-menu glass" role="menu" aria-label="Views">
          {first.map(row)}
          {rest.length > 0 &&
            (more ? (
              rest.map(row)
            ) : (
              <button className="viewpill-name viewpill-more" role="menuitem" onClick={() => setMore(true)}>
                <span>More</span>
                <span className="dim">›</span>
              </button>
            ))}
          <div className="viewpill-divider" />
          <button
            className="viewpill-name"
            role="menuitem"
            onClick={() => {
              close()
              openSheet({ kind: 'layers' })
            }}
          >
            <span>Edit this view</span>
            <span className="dim">›</span>
          </button>
        </div>
      )}
      <button className="viewpill glass" onClick={() => (open ? close() : setOpen(true))} aria-expanded={open} aria-label="View">
        <IconLayers size={15} />
        <span>{on?.name ?? 'Custom'}</span>
        <span className="dim viewpill-caret">
          <IconChevronDown size={14} />
        </span>
      </button>
    </div>
  )
}
