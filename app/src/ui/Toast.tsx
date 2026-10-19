import { useEffect, type JSX } from 'react'
import { create } from 'zustand'

/**
 * A toast: a line under the weather strip saying what a tap just did
 * ("Heat map off"), gone by itself. For the strip's icon buttons, whose
 * pictures alone don't say it (Gavan, 2026-10-19: "when you perform a
 * button at the top, give me a toast that says what I did before
 * dismissing it"). One at a time: a new one replaces the last.
 */

/** Long enough to read a few words at a glance, short enough to be gone before the next tap. */
const SHOW_MS = 2000

interface ToastState {
  text: string | null
  /** bumped per toast, so the same words twice still start afresh */
  n: number
}

const useToast = create<ToastState>(() => ({ text: null, n: 0 }))

export function toast(text: string): void {
  useToast.setState((s) => ({ text, n: s.n + 1 }))
}

export default function Toast(): JSX.Element | null {
  const text = useToast((s) => s.text)
  const n = useToast((s) => s.n)
  useEffect(() => {
    if (!text) return
    const t = setTimeout(() => useToast.setState({ text: null }), SHOW_MS)
    return () => clearTimeout(t)
  }, [text, n])
  if (!text) return null
  return (
    <div key={n} className="toast" role="status" aria-live="polite" style={{ animationDuration: `${SHOW_MS}ms` }}>
      {text}
    </div>
  )
}
