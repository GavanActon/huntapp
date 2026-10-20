import { type JSX } from 'react'
import { create } from 'zustand'

/**
 * A toast: a line under the weather strip saying what just happened
 * ("Heat map off", "Weather updated"), gone by itself. For the strip's
 * icon buttons, whose pictures alone don't say it (Gavan, 2026-10-19:
 * "when you perform a button at the top, give me a toast that says what I
 * did before dismissing it"), and for a new forecast on the phone ("toast
 * under the weather strip that the weather has been updated"). One at a
 * time: a new one replaces the last. Its clock runs here, not in the
 * component, so one raised while the strip is away (Sharpen the wind)
 * does not wait to show stale when it comes back.
 */

/** Long enough to read a few words at a glance, short enough to be gone before the next tap. */
const SHOW_MS = 2000

interface ToastState {
  text: string | null
  /** bumped per toast, so the same words twice still start afresh */
  n: number
  ms: number
}

const useToast = create<ToastState>(() => ({ text: null, n: 0, ms: SHOW_MS }))
let timer = 0

/** `ms`: longer for a line with something to do in it (a spot loaded: where to rename it). */
export function toast(text: string, ms = SHOW_MS): void {
  useToast.setState((s) => ({ text, n: s.n + 1, ms }))
  window.clearTimeout(timer)
  timer = window.setTimeout(() => useToast.setState({ text: null }), ms)
}

export default function Toast(): JSX.Element | null {
  const text = useToast((s) => s.text)
  const n = useToast((s) => s.n)
  const ms = useToast((s) => s.ms)
  if (!text) return null
  return (
    <div key={n} className="toast" role="status" aria-live="polite" style={{ animationDuration: `${ms}ms` }}>
      {text}
    </div>
  )
}
