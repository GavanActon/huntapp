import { useEffect, useRef, useState, type ReactNode } from 'react'
import { devlog } from '../devlog'
import { useTapOff } from './tapOff'

/** The detents promise the map most of the screen, so the sheet sizes
 *  itself against at most this much viewport — full-screen Safari and the
 *  installed app have taller viewports, and a pure dvh height crept up the
 *  map with them. */
const VH_CAP_PX = 800

/** The full detent, and what the keyboard grows the sheet to. */
const FULL_PCT = 88

/** A detent as CSS: pct of the viewport, but of no more than VH_CAP_PX of it. */
function heightCss(pct: number) {
  return `calc(min(${pct}dvh, ${(pct * VH_CAP_PX) / 100}px) + var(--sab))`
}

/** An input that brings the keyboard up. A range slider or a checkbox does
 *  not, and a sheet that jumped to full height under a knob would throw
 *  the thumb off it. */
const NO_KEYBOARD = new Set(['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'color'])
function isField(t: EventTarget | null): t is HTMLElement {
  if (!(t instanceof HTMLElement)) return false
  if (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return true
  return t instanceof HTMLInputElement && !NO_KEYBOARD.has(t.type)
}

/**
 * iOS-style draggable bottom sheet with half / full snap points. Content
 * scrolls internally when at full height. No close button: a tap off it
 * (the map included) closes it, as does a drag well below its rest.
 */
export default function BottomSheet({
  title,
  children,
  halfPct = 52,
  snapKey,
  onClose,
  onBack,
  action,
}: {
  /** '' for a panel that carries its own heading row (Dig in, the layers) */
  title: string
  children: ReactNode
  /** The half snap: a list rests lower so the map keeps most of the screen. */
  halfPct?: number
  /** What the sheet holds; a change resets the height to its snap. */
  snapKey: string
  onClose: () => void
  /** A sheet pushed over another: ‹ Back at the left of the title. */
  onBack?: () => void
  /** Done, ⋯ or such at the right of the title. */
  action?: ReactNode
}) {
  const [heightPct, setHeightPct] = useState(halfPct)
  const drag = useRef<{ startY: number; startPct: number } | null>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  // the live height during a drag. React state would re-render the whole
  // panel on every pointermove — with a list inside that recomputes
  // conditions for every spot per frame, which is what made the drag chunky
  const livePct = useRef(halfPct)
  // what the last reset was for — StrictMode runs the effect twice on
  // mount, so "first run" can't be what guards the opening height
  const lastSnap = useRef<[string, number]>([snapKey, halfPct])
  // a text field in edit stretches the sheet to full — the keyboard eats the
  // bottom half of the screen, and a half-height sheet vanishes behind it.
  // This is the detent to fall back to when the field lets go.
  const beforeKeyboard = useRef<number | null>(null)

  useTapOff(sheetRef, true, onClose)

  // the dev log: what opened at what height, for the sheet that opens full
  useEffect(() => {
    devlog('sheet', `open ${snapKey} at ${halfPct}%`)
  }, [snapKey, halfPct])

  /** Write the height straight to the node: a drag has to track the finger,
   *  and a render per frame cannot. */
  function applyHeight(pct: number) {
    livePct.current = pct
    const el = sheetRef.current
    if (el) el.style.height = heightCss(pct)
  }

  useEffect(() => {
    // the opening height stands; a NEW panel or snap resets to the snap
    const [k, h] = lastSnap.current
    if (k === snapKey && h === halfPct) return
    lastSnap.current = [snapKey, halfPct]
    beforeKeyboard.current = null
    setHeightPct(halfPct)
    applyHeight(halfPct)
  }, [snapKey, halfPct])

  function onPointerDown(e: React.PointerEvent) {
    drag.current = { startY: e.clientY, startPct: livePct.current }
    // the resting height animates to its snap; under the finger it must not,
    // or every frame restarts a 180ms transition and the sheet chases you
    sheetRef.current?.classList.add('sheet-dragging')
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current) return
    // pct is of the capped viewport, so the drag must divide by the same
    // number or the sheet lags the finger on tall screens
    const vh = Math.min(window.innerHeight, VH_CAP_PX)
    const dyPct = ((drag.current.startY - e.clientY) / vh) * 100
    applyHeight(Math.min(FULL_PCT, Math.max(15, drag.current.startPct + dyPct)))
  }
  function onPointerUp() {
    if (!drag.current) return
    const start = drag.current.startPct
    drag.current = null
    sheetRef.current?.classList.remove('sheet-dragging')
    const h = livePct.current
    // judged from where the drag began: a short pull either way goes back
    // to that detent (a scroll that starts on the title row must not open
    // the sheet full), a long pull up opens it full, well below the rest
    // dismisses
    const close = h < halfPct - 14
    const snap = close ? halfPct : h > start + 12 ? FULL_PCT : h < start - 12 ? halfPct : start >= 68 ? FULL_PCT : halfPct
    devlog('sheet', `drag ${snapKey} ${Math.round(start)} → ${Math.round(h)} → ${close ? 'close' : `${snap}%`}`)
    if (close) onClose()
    applyHeight(snap)
    setHeightPct(snap)
  }

  function onFocusIn(e: React.FocusEvent) {
    if (!isField(e.target)) return
    devlog('sheet', `focus ${snapKey} ${e.target.tagName.toLowerCase()}${e.target instanceof HTMLInputElement ? `[${e.target.type}]` : ''} → full`)
    if (beforeKeyboard.current == null) beforeKeyboard.current = livePct.current
    applyHeight(FULL_PCT)
    setHeightPct(FULL_PCT)
  }
  function onFocusOut(e: React.FocusEvent) {
    if (!isField(e.target)) return
    // straight to another field in the same sheet: the keyboard stays up
    if (isField(e.relatedTarget) && sheetRef.current?.contains(e.relatedTarget)) return
    const back = beforeKeyboard.current
    beforeKeyboard.current = null
    if (back == null) return
    applyHeight(back)
    setHeightPct(back)
  }

  const titleRow = title !== '' || onBack != null || action != null

  return (
    <div ref={sheetRef} className="sheet glass" style={{ height: heightCss(heightPct) }}>
      <div
        className="sheet-grab"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {/* a real button, not just a grab strip: a swipe is invisible to a
            keyboard, to VoiceOver, and to anyone who hasn't guessed it */}
        <button
          className="sheet-handle"
          onClick={() => {
            const next = livePct.current >= 68 ? halfPct : FULL_PCT
            devlog('sheet', `handle ${snapKey} → ${next}%`)
            applyHeight(next)
            setHeightPct(next)
          }}
          aria-expanded={heightPct >= 68}
          aria-label={heightPct >= 68 ? 'Collapse' : 'Expand'}
        />
        {titleRow && (
          <div className="sheet-titlerow">
            {onBack && (
              <button className="sheet-back" onClick={onBack}>
                ‹ Back
              </button>
            )}
            <h2>{title}</h2>
            <div className="sheet-actions">{action}</div>
          </div>
        )}
      </div>
      <div className="sheet-body" onFocus={onFocusIn} onBlur={onFocusOut}>
        {children}
      </div>
    </div>
  )
}
