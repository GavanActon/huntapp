/**
 * The big files on their way in from the network, the wind and habitat
 * grids of 5–12 MB on a cold open or a switch to a new area, as bytes so far
 * against the total: the hairline under the weather strip reads it. A file
 * out of the phone's own store never shows, it lands in milliseconds, and
 * so the line waits 300 ms before it appears and stays 400 ms after the last
 * byte so it is seen to fill. The map's tiles are open-ended and are not
 * counted: a line that stalls at 80 % is worse than none.
 */
import { useSyncExternalStore } from 'react'

interface Item {
  loaded: number
  total: number
}

export interface LoadProgress {
  /** the line is drawn */
  visible: boolean
  /** every file is in: the line is full, fading */
  done: boolean
  /** 0–100 over every file in flight; the total is the headers' content-length, and a file without one is counted by its bytes only */
  pct: number
  /** no file in flight gave a length: the line slides instead of filling */
  known: boolean
}

const SHOW_AFTER_MS = 300
const LINGER_MS = 400

const items = new Map<string, Item>()
const listeners = new Set<() => void>()
let snap: LoadProgress = { visible: false, done: false, pct: 0, known: true }
let showTimer: number | null = null
let hideTimer: number | null = null
let shown = false
let frame = 0

function emit() {
  for (const l of listeners) l()
}

function recompute() {
  let loaded = 0
  let total = 0
  let known = false
  for (const it of items.values()) {
    loaded += it.loaded
    total += it.total
    if (it.total > 0) known = true
  }
  const inFlight = items.size > 0
  const pct = inFlight ? (known && total > 0 ? Math.min(100, (100 * loaded) / total) : 0) : 100
  const next: LoadProgress = { visible: shown, done: shown && !inFlight, pct: shown ? pct : 0, known: inFlight ? known : true }
  if (next.visible !== snap.visible || next.done !== snap.done || next.known !== snap.known || Math.abs(next.pct - snap.pct) >= 0.5) {
    snap = next
    emit()
  }
}

function started() {
  if (hideTimer != null) {
    window.clearTimeout(hideTimer)
    hideTimer = null
  }
  if (!shown && showTimer == null) {
    showTimer = window.setTimeout(() => {
      showTimer = null
      if (items.size > 0) {
        shown = true
        recompute()
      }
    }, SHOW_AFTER_MS)
  }
}

function finished() {
  if (items.size > 0) return
  if (showTimer != null) {
    window.clearTimeout(showTimer)
    showTimer = null
  }
  if (!shown) return
  recompute() // full, fading
  hideTimer = window.setTimeout(() => {
    hideTimer = null
    shown = false
    recompute()
  }, LINGER_MS)
}

function scheduleRecompute() {
  if (frame) return
  frame = window.requestAnimationFrame(() => {
    frame = 0
    recompute()
  })
}

/** Read a fetched file's body, counting it on the way, and give its bytes. */
export async function trackResponse(name: string, resp: Response): Promise<Blob> {
  const total = Number(resp.headers.get('content-length')) || 0
  if (!resp.body) return resp.blob()
  const it: Item = { loaded: 0, total }
  items.set(name, it)
  started()
  try {
    const reader = resp.body.getReader()
    const chunks: BlobPart[] = []
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      it.loaded += value.byteLength
      scheduleRecompute()
    }
    return new Blob(chunks, { type: resp.headers.get('content-type') ?? 'application/octet-stream' })
  } finally {
    items.delete(name)
    finished()
  }
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}
const get = () => snap

export function useLoadProgress(): LoadProgress {
  return useSyncExternalStore(subscribe, get, get)
}
