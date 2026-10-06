import { ACTIVE_AREA } from '../../areas'
import { API, SEND, track } from '../../analytics'
import { installId } from '../../devlog'
import { useWindChecks, type WindCheck } from './windChecks'

/**
 * Sharing the wind checks: each check a hunter makes, sent to the Groundwind
 * Worker (site/checks.js /api/checks, D1 checks) so the ground model can
 * learn where it is wrong and under which conditions, from everyone's checks
 * and not only the ones on this phone (docs/ANALYTICS.md "Wind checks").
 *
 * Asked once, on the card after a phone's first check (Share or Not now),
 * and switched in Settings → Sharing. Until it is answered nothing goes.
 * A check goes whole, its place and time, what was felt and what the map
 * and the forecast said, under the phone's random id: never who made it
 * (`by`) or a note, and never a partner's check taken in from their file.
 *
 * A check can change after it is made (another puff folds in, a newer one
 * replaces it), so what was sent is remembered by a fingerprint per check,
 * and a check whose fingerprint has moved is sent again; the Worker updates
 * its row. Switched on, every check still on the phone goes, the season's
 * checks included. Like the stats, a week with no signal waits and goes
 * when there is one; nothing is sent from a dev server or a scripted browser.
 */

export type ShareState = 'ask' | 'on' | 'off'

const KEY = 'huntapp-checkshare'
const SENT_KEY = 'huntapp-checkshare-sent'
const BATCH = 100
/** after a check changes: long enough for the next puff to fold in */
const SOON_MS = 15_000
const TICK_MS = 60_000

let state: ShareState = 'ask'
/** check id → the fingerprint of what was last sent */
let sent: Record<string, string> = {}
let sending = false
let failures = 0
let retryAt = 0
let timer: number | null = null
let started = false
const listeners = new Set<() => void>()

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, v: string | null) {
  try {
    if (v == null) localStorage.removeItem(key)
    else localStorage.setItem(key, v)
  } catch {
    /* storage full or gone: sent again next time, and the Worker keeps one row */
  }
}

function emit() {
  for (const l of listeners) l()
}

export function shareState(): ShareState {
  return state
}

export function onShareChange(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** The answer to the card's question, or the Settings switch. */
export function setShare(v: 'on' | 'off', via: 'ask' | 'settings'): void {
  if (v === state) return
  state = v
  write(KEY, v)
  track('check_share', { on: v === 'on', via })
  emit()
  if (v === 'on') {
    start()
    flushSoon(500)
  }
}

/** This phone's own checks: a partner's, taken in from their file, stay out. */
function mine(c: WindCheck): boolean {
  return !c.taken
}

/** What goes: the check, less who made it and anything typed. */
function outgoing(c: WindCheck): Omit<WindCheck, 'by' | 'note' | 'taken'> {
  const { by: _by, note: _note, taken: _taken, ...rest } = c
  return rest
}

/** A short fingerprint of what would go (FNV-1a): changed, it goes again. */
function fingerprint(c: WindCheck): string {
  const s = JSON.stringify(outgoing(c))
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

function pending(): WindCheck[] {
  return useWindChecks.getState().checks.filter((c) => mine(c) && sent[c.id] !== fingerprint(c))
}

/** Checks on this phone that have gone, as they are now, and those still to go. */
export function shareCounts(): { sent: number; waiting: number } {
  const own = useWindChecks.getState().checks.filter(mine)
  const waiting = own.filter((c) => sent[c.id] !== fingerprint(c)).length
  return { sent: own.length - waiting, waiting }
}

function flushSoon(ms = SOON_MS) {
  if (timer != null) window.clearTimeout(timer)
  timer = window.setTimeout(() => {
    timer = null
    void flush()
  }, ms)
}

/** The waiting checks, a batch at a time, till none wait or the network
 *  says no (then a wait that doubles, up to 5 min). */
async function flush(): Promise<void> {
  if (!SEND || state !== 'on' || sending || !navigator.onLine || Date.now() < retryAt) return
  const waiting = pending()
  if (!waiting.length) return
  const batch = waiting.slice(0, BATCH)
  const prints = batch.map(fingerprint)
  const body = JSON.stringify({ i: installId(), now: Date.now(), a: ACTIVE_AREA.id, b: __BUILD__.sha, c: batch.map(outgoing) })
  sending = true
  try {
    // text/plain: a simple request, no preflight; keepalive for the batch sent as the phone goes in the pocket
    const r = await fetch(`${API}/api/checks`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body,
      keepalive: body.length < 60_000,
      signal: AbortSignal.timeout(20_000),
    })
    // a 400 is a batch the Worker will never take: let it go, so it cannot hold up the rest
    if (!r.ok && r.status !== 400) throw new Error(`HTTP ${r.status}`)
    batch.forEach((c, i) => (sent[c.id] = prints[i]))
    // remember only the checks the phone still keeps
    const have = new Set(useWindChecks.getState().checks.map((c) => c.id))
    for (const id of Object.keys(sent)) if (!have.has(id)) delete sent[id]
    write(SENT_KEY, JSON.stringify(sent))
    failures = 0
    retryAt = 0
  } catch {
    failures += 1
    retryAt = Date.now() + Math.min(300_000, 15_000 * 2 ** (failures - 1))
  } finally {
    sending = false
  }
  emit()
  if (!retryAt && waiting.length > batch.length) void flush()
}

function start() {
  if (started) return
  started = true
  useWindChecks.subscribe((s, prev) => {
    if (s.checks !== prev.checks) flushSoon()
  })
  window.addEventListener('online', () => void flush())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flush()
  })
  window.setInterval(() => {
    if (document.visibilityState === 'visible') void flush()
  }, TICK_MS)
  flushSoon(8000)
}

/** Call once at startup: the answer, what has gone, and if on, the sending. */
export function initCheckShare(): void {
  const v = read(KEY)
  state = v === 'on' || v === 'off' ? v : 'ask'
  try {
    const s = JSON.parse(read(SENT_KEY) ?? '{}') as unknown
    sent = s && typeof s === 'object' && !Array.isArray(s) ? (s as Record<string, string>) : {}
  } catch {
    sent = {}
  }
  if (state === 'on') start()
}
