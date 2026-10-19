import { useEffect, useMemo, useRef } from 'react'
import { useAppStore } from '../state/appStore'
import { currentView, splitViews, useViews } from '../state/viewsStore'
import { IconCheck, IconChevronDown, IconLayers } from './icons'
import { useTapOff } from './tapOff'
import { setExplore } from '../explore'
import { GradeTile } from './grade'
import { viewHere, viewPic } from './viewKit'
import './views.css'

/**
 * The view pill, bottom left: the name of the view the map is showing
 * ("Scout"), and a menu of the user's views. Past a rule in the same pill,
 * the map's grade, HD or SD, which opens the grade sheet. The menu is My
 * views, a picture each, then `All views ›`: the Views sheet, every view
 * with what it shows and what it is for, to see and to add, and Make your
 * own at its foot (Gavan, 2026-10-19: "don't want to bloat the menu - we
 * want users learning what the views are + having the ability to grab the
 * ones they want"). No modes here: the quarry chip on the strip sets
 * hunting or fishing. The menu's open state lives in the app store
 * (viewMenuOpen) so the hot column can step out from under it.
 */

export default function ViewPill() {
  // the four reads currentView() depends on, so the name follows every change
  const layers = useAppStore((s) => s.layers)
  const mode = useViews((s) => s.mode)
  const saved = useViews((s) => s.saved)
  const lastViewId = useViews((s) => s.lastViewId)
  const apply = useViews((s) => s.apply)
  const pinned = useViews((s) => s.pinned)
  const open = useAppStore((s) => s.viewMenuOpen)
  const setOpen = useAppStore((s) => s.setViewMenuOpen)
  const openSheet = useAppStore((s) => s.openSheet)
  const online = useAppStore((s) => s.online)
  const explore = useAppStore((s) => s.exploreMode)
  const box = useRef<HTMLDivElement>(null)

  const on = useMemo(() => currentView(), [layers, mode, saved, lastViewId])
  const mine = useMemo(() => splitViews(mode, saved, pinned).top.filter(viewHere), [mode, saved, pinned])

  // the pill leaves the screen with the menu up (a sheet opens): the hot
  // column must come back
  useEffect(() => () => setOpen(false), [setOpen])

  const close = () => setOpen(false)

  useTapOff(box, open, close)

  return (
    <div className="viewpill-wrap" ref={box}>
      {open && (
        <div className="viewpill-menu glass" role="menu" aria-label="Views">
          <div className="viewpill-sec">My views</div>
          {mine.length > 0 ? (
            <div className="viewpill-cards">
              {mine.map((v) => (
                <button
                  key={v.id}
                  className={`viewcard${on?.id === v.id ? ' on' : ''}`}
                  role="menuitemradio"
                  aria-checked={on?.id === v.id}
                  onClick={() => {
                    apply(v)
                    close()
                  }}
                >
                  <img src={viewPic(v)} alt="" draggable={false} />
                  <span>{v.name}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="viewpill-none">None yet: add the ones you want from All views.</div>
          )}
          <button
            className="viewpill-name viewpill-all"
            role="menuitem"
            onClick={() => {
              close()
              openSheet({ kind: 'views' })
            }}
          >
            <span>All views</span>
            <span className="dim">›</span>
          </button>
          {/* Explore: a mode over any view (explore/index.ts), with signal */}
          {online && (
            <button
              className={`viewpill-name viewpill-explore${explore ? ' on' : ''}`}
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
        </div>
      )}
      {/* one pill: the view, a rule, and the map's grade (ui/grade.tsx GradeTile), each its own tap */}
      <div className="viewpill-bar glass">
        <button className="viewpill" onClick={() => (open ? close() : setOpen(true))} aria-expanded={open} aria-label="View">
          <IconLayers size={15} />
          <span>{on?.name ?? 'Custom'}</span>
          <span className="dim viewpill-caret">
            <IconChevronDown size={14} />
          </span>
        </button>
        <GradeTile />
      </div>
    </div>
  )
}
