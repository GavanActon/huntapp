/**
 * The dev log: what the app was doing, minute by minute, for the bugs
 * that leave no trace in the field — a sheet that opened full, a map gone
 * blank, a screen that stopped answering. Off unless switched on in
 * Settings; then everything worth knowing is written here with a time:
 * boots, resumes, freezes of the main thread, sheets opening and snapping,
 * errors and warnings, what the modules say. Kept on the phone (a few
 * hundred KB at most), uploaded by hand to the Sandies API, where it gets
 * a code to read out or a link to open.
 *
 * Positions are in it. That is the point of a log from the bush, and why
 * it is off by default and uploaded only by hand.
 */

import { ACTIVE_AREA } from './areas'

const ON_KEY = 'huntapp-devlog'
const LINES_KEY = 'huntapp-devlog-lines'
const LAST_KEY = 'huntapp-devlog-last'
const INSTALL_KEY = 'huntapp-install'
const MAX_LINES = 1500
const MAX_CHARS = 320
const FLUSH_MS = 5000
const FREEZE_MS = 3000

/** The Sandies Worker takes a dev log from any install: same owner, no second API to run. */
const API = (import.meta.env.VITE_API as string | undefined) ?? 'https://api.sandies.app'

let on = false
let lines: string[] = []
let dirty = false
let flushTimer: number | null = null
let installed = false
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
    /* storage full or gone */
  }
}

/** This phone's id for the uploads: 16 hex, made once, never sent anywhere else. */
export function installId(): string {
  let id = read(INSTALL_KEY)
  if (id && /^[a-f0-9]{16}$/.test(id)) return id
  const a = new Uint8Array(8)
  crypto.getRandomValues(a)
  id = [...a].map((b) => b.toString(16).padStart(2, '0')).join('')
  write(INSTALL_KEY, id)
  return id
}

export function devlogOn(): boolean {
  return on
}

export function devlogCount(): number {
  return lines.length
}

export function devlogLines(): string[] {
  return lines.slice()
}

export function onDevlog(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

function emit() {
  for (const l of listeners) l()
}

function stamp(ms = Date.now()): string {
  const d = new Date(ms)
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
}

function short(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string') return v
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

/** One line: `HH:MM:SS.mmm tag · message · {data}`. Cheap when off. */
export function devlog(tag: string, message: string, data?: unknown): void {
  if (import.meta.env.DEV) console.debug(`[${tag}] ${message}`, data ?? '')
  if (!on) return
  const extra = data === undefined ? '' : ` · ${short(data)}`
  lines.push(`${stamp()} ${tag} · ${message}${extra}`.slice(0, MAX_CHARS))
  if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES)
  dirty = true
  if (flushTimer == null) flushTimer = window.setTimeout(flush, FLUSH_MS)
  emit()
}

function flush() {
  flushTimer = null
  if (!dirty) return
  dirty = false
  write(LINES_KEY, JSON.stringify(lines))
}

function dateLine(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Switch the log on or off. On writes a boot line; off wipes it. */
export function setDevlog(v: boolean): void {
  if (v === on) return
  on = v
  write(ON_KEY, v ? '1' : null)
  if (v) {
    lines = []
    boot('switched on')
    installHooks()
  } else {
    lines = []
    dirty = false
    write(LINES_KEY, null)
  }
  flush()
  emit()
}

function boot(why: string) {
  const nav = navigator as Navigator & { standalone?: boolean; deviceMemory?: number }
  devlog('boot', why, {
    date: dateLine(),
    build: __BUILD__.sha,
    // a switch reloads: each run's boot line says which area it ran in
    area: ACTIVE_AREA.id,
    ua: navigator.userAgent.replace(/^Mozilla\/5\.0 \(/, '').slice(0, 70),
    dpr: devicePixelRatio,
    vp: `${innerWidth}x${innerHeight}`,
    installed: nav.standalone === true || matchMedia('(display-mode: standalone)').matches,
    mem: nav.deviceMemory ?? null,
    online: navigator.onLine,
  })
}

/** Call once at startup, before the app renders: picks up the switch and
 *  the lines from the last session, and starts listening. */
export function initDevlog(): void {
  on = read(ON_KEY) === '1'
  if (!on) return
  try {
    const saved = JSON.parse(read(LINES_KEY) ?? '[]') as unknown
    if (Array.isArray(saved)) lines = saved.filter((l) => typeof l === 'string').slice(-MAX_LINES)
  } catch {
    lines = []
  }
  boot('launch')
  installHooks()
}

function installHooks() {
  if (installed) return
  installed = true
  document.addEventListener('visibilitychange', () => devlog('page', document.visibilityState))
  window.addEventListener('pagehide', () => {
    devlog('page', 'pagehide')
    flush()
  })
  window.addEventListener('pageshow', (e) => devlog('page', `pageshow${(e as PageTransitionEvent).persisted ? ' (from cache)' : ''}`))
  window.addEventListener('online', () => devlog('net', 'online'))
  window.addEventListener('offline', () => devlog('net', 'offline'))
  // the viewport: the keyboard, a rotation, Safari's bars coming and going,
  // which is what a sheet sizes itself against
  const vv = window.visualViewport
  if (vv) {
    let lastVp = ''
    vv.addEventListener('resize', () => {
      const now = `${Math.round(vv.width)}x${Math.round(vv.height)} of ${innerWidth}x${innerHeight}`
      if (now === lastVp) return
      lastVp = now
      devlog('vp', now)
    })
  }
  // the main thread went away: a timer that should fire every second
  // fires late by seconds. Hidden, that is the ordinary suspend; in front
  // it is the screen that stopped answering.
  let last = Date.now()
  let hiddenSince = document.visibilityState === 'hidden' ? Date.now() : 0
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') hiddenSince = Date.now()
  })
  setInterval(() => {
    const now = Date.now()
    const gap = now - last
    last = now
    if (gap > FREEZE_MS) {
      const away = hiddenSince > 0 && hiddenSince >= now - gap - 1000
      devlog(away || document.visibilityState !== 'visible' ? 'suspend' : 'freeze', `${(gap / 1000).toFixed(1)} s`)
    }
    if (document.visibilityState === 'visible') hiddenSince = 0
  }, 1000)
  const perf = performance as Performance & { memory?: { usedJSHeapSize: number; jsHeapSizeLimit: number } }
  if (perf.memory) {
    setInterval(() => {
      if (document.visibilityState !== 'visible') return
      const m = perf.memory!
      devlog('mem', `${Math.round(m.usedJSHeapSize / 1e6)} MB of ${Math.round(m.jsHeapSizeLimit / 1e6)}`)
    }, 60_000)
  }
}

/** The whole log as text, newest last, the snapshot (what the app is) in front of it. */
export function devlogText(snapshot?: string): string {
  const head = [`Huntapp dev log · ${dateLine()} · build ${__BUILD__.sha} · install ${installId()}`, `${lines.length} lines · ${navigator.userAgent.slice(0, 120)}`, '']
  const snap = snapshot ? ['---- snapshot ----', snapshot, '', '---- log ----'] : []
  return head.concat(snap, lines).join('\n') + '\n'
}

export interface Uploaded {
  code: string
  url: string
  at: number
}

/** The last upload, so the Settings row can point at it. */
export function lastUpload(): Uploaded | null {
  try {
    const u = JSON.parse(read(LAST_KEY) ?? 'null') as Uploaded | null
    return u && typeof u.code === 'string' ? u : null
  } catch {
    return null
  }
}

async function snapshot(): Promise<string | undefined> {
  // the diagnostics module imports this one; a late import keeps the log cheap
  return import('./diagnostics')
    .then((m) => m.buildSnapshot())
    .catch(() => undefined)
}

/** Text to the API; the answer is a code to read out and a link. */
async function post(text: string): Promise<{ code: string; url: string }> {
  const resp = await fetch(`${API}/devlog`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: installId(), build: `huntapp ${__BUILD__.sha}`, text }),
    signal: AbortSignal.timeout(20_000),
  })
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
  return (await resp.json()) as { code: string; url: string }
}

/** Send the log to the API; the answer is a code to read out and a link. */
export async function uploadDevlog(): Promise<Uploaded> {
  flush()
  const r = await post(devlogText(await snapshot()))
  const u: Uploaded = { code: r.code, url: r.url, at: Date.now() }
  write(LAST_KEY, JSON.stringify(u))
  devlog('log', `uploaded · ${u.code}`)
  emit()
  return u
}

/**
 * The settings, whole, as the phone keeps them: a phone set up just so
 * hands them over to become the app's defaults (Gavan, 2026-10-03). Only
 * settings: the hunt log, tracks, pins, wind checks and the route's ends
 * stay on the phone, and there is no position in it.
 */
const SETTINGS_KEYS = ['huntapp', 'huntapp-views', 'huntapp-spots', 'huntapp-scent', 'huntapp-hunting', 'huntapp-routes'] as const

function settingsJson(): string {
  const out: Record<string, unknown> = {}
  for (const k of SETTINGS_KEYS) {
    try {
      const raw = localStorage.getItem(k)
      if (!raw) continue
      const v = JSON.parse(raw) as { state?: Record<string, unknown>; version?: number }
      // the route keeps its ends (places); only how it is worked out is a setting
      if (k === 'huntapp-routes' && v.state) v.state = { mode: v.state.mode, stayDry: v.state.stayDry }
      out[k] = v
    } catch {
      /* unreadable: left out */
    }
  }
  return JSON.stringify(out, null, 1)
}

/** Send the settings alone (no log, no position); the answer is a code. */
export async function uploadSettings(): Promise<string> {
  const r = await post(`Huntapp settings · ${dateLine()} · build ${__BUILD__.sha}\n\n${settingsJson()}\n`)
  devlog('log', `settings sent · ${r.code}`)
  return r.code
}

/** Hand the log to the share sheet as a file, or copy it where there is none. */
export async function shareDevlog(): Promise<'shared' | 'copied' | 'failed'> {
  const text = devlogText(await snapshot())
  const file = new File([text], `huntapp-log-${dateLine()}.txt`, { type: 'text/plain' })
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Huntapp dev log' })
      return 'shared'
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return 'failed'
    }
  }
  try {
    await navigator.clipboard.writeText(text)
    return 'copied'
  } catch {
    return 'failed'
  }
}

export function clearDevlog(): void {
  lines = []
  write(LINES_KEY, null)
  write(LAST_KEY, null)
  if (on) boot('cleared')
  flush()
  emit()
}
