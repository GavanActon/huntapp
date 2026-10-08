import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '../state/appStore'
import { currentView, splitViews, useViews, type MapView } from '../state/viewsStore'
import { IconCheck, IconChevronDown, IconLayers, IconTrash } from './icons'
import { useTapOff } from './tapOff'
import { setExplore } from '../explore'
import './views.css'

/**
 * The view pill, bottom left: the name of the view the map is showing
 * ("Scout"), and a menu of the mode's views. The pinned views sit at the
 * top in the user's order; `More ›` unfolds the rest, then `Edit this
 * view ›` (the layers sheet) and `Arrange views ›` (the Views sheet, which
 * stars and drags the pinned). No modes here: the quarry chip on the strip sets hunting or
 * fishing. The menu's open state lives in the app store (viewMenuOpen) so
 * the hot column can step out from under it.
 */

export default function ViewPill() {
  // the four reads currentView() depends on, so the name follows every change
  const layers = useAppStore((s) => s.layers)
  const mode = useViews((s) => s.mode)
  const saved = useViews((s) => s.saved)
  const lastViewId = useViews((s) => s.lastViewId)
  const apply = useViews((s) => s.apply)
  const remove = useViews((s) => s.remove)
  const pinned = useViews((s) => s.pinned)
  const open = useAppStore((s) => s.viewMenuOpen)
  const setOpen = useAppStore((s) => s.setViewMenuOpen)
  const openSheet = useAppStore((s) => s.openSheet)
  const online = useAppStore((s) => s.online)
  const explore = useAppStore((s) => s.exploreMode)
  const [more, setMore] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  const on = useMemo(() => currentView(), [layers, mode, saved, lastViewId])
  const { top: first, rest } = useMemo(() => splitViews(mode, saved, pinned), [mode, saved, pinned])

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
          {/* Explore: a mode over any view (explore/index.ts), with signal */}
          {online && (
            <button
              className={`viewpill-name${explore ? ' on' : ''}`}
              role="menuitemcheckbox"
              aria-checked={explore}
              onClick={() => {
                close()
                setExplore(!explore)
              }}
            >
              <span>Explore · the country, the grid, a search</span>
              {explore && <IconCheck size={18} />}
            </button>
          )}
          {first.map(row)}
          {more ? (
            <>
              {rest.map(row)}
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
              <button
                className="viewpill-name"
                role="menuitem"
                onClick={() => {
                  close()
                  openSheet({ kind: 'views' })
                }}
              >
                <span>Arrange views</span>
                <span className="dim">›</span>
              </button>
            </>
          ) : (
            <button className="viewpill-name viewpill-more" role="menuitem" onClick={() => setMore(true)}>
              <span>More</span>
              <span className="dim">›</span>
            </button>
          )}
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
