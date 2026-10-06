/**
 * Usage stats: which parts of the app get used, by how many phones, how
 * often and for how long, so the work goes where the hunters are. Every
 * tap on a button (by its label, never what is typed), the sheets and
 * cards opened and for how long, the layers and settings changed, the
 * features run (stats/watch.ts), time in front, map load times, errors.
 *
 * Never a position, a pin's name, a note, a track or anything typed: a
 * label that holds one of your own names has it blanked (scrub), and
 * numbers go too. The phone is a random id (devlog.ts installId), a
 * session is a run of use with no gap of 30 min. On unless switched off
 * in Settings; off keeps nothing and sends nothing.
 *
 * Kept on the phone and sent in batches to the Groundwind Worker
 * (site/worker.js /api/events, D1), so a week in the bush with no signal
 * arrives whole when there is one. A batch sent twice is stored once (the
 * install's counter is the key). docs/ANALYTICS.md has every event and the
 * queries.
 */

import { ACTIVE_AREA } from './areas'
import { installId } from './devlog'
import { topSheet, useAppStore } from './state/appStore'

export type Props = Record<string, string | number | boolean | null | undefined>

interface Ev {
  /** session */
  s: string
  /** the install's counter */
  q: number
  /** when, the phone's clock, ms */
  t: number
  n: string
  p?: Props
  a: string
  b: string
  o: 0 | 1
}

interface Meta {
  seq: number
  session: string
  /** the last event's time: the session ends 30 min after it */
  last: number
  sessions: number
  launches: number
  first: number
  build: string
  area: string
}

const OFF_KEY = 'huntapp-stats-off'
const QUEUE_KEY = 'huntapp-stats-queue'
const META_KEY = 'huntapp-stats-meta'
/** The Groundwind Worker: the stats here, the shared wind checks (weather/micro/checkShare.ts). */
export const API = (import.meta.env.VITE_EVENTS_API as string | undefined) ?? 'https://groundwind.app'
/** A dev server keeps its taps to the console, unless pointed at an API on
 *  purpose; a browser driven by a script (the site's loops) sends nothing. */
export const SEND = (import.meta.env.PROD || !!import.meta.env.VITE_EVENTS_API) && !navigator.webdriver
const SESSION_GAP = 30 * 60_000
const MAX_QUEUE = 1500
const BATCH = 100
const FLUSH_MS = 30_000
const MAX_ERRORS = 5

let on = false
let queue: Ev[] = []
let meta: Meta
let sending = false
let failures = 0
let retryAt = 0
let saveTimer: number | null = null
let flushTimer: number | null = null
let started = false
// time in front, and what was done in it: sent with each hide
let shownAt = 0
const counts = { taps: 0, pans: 0, zooms: 0, clicks: 0 }
const errorsSeen = new Set<string>()

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
    /* storage full or gone: the queue lives in memory till the page goes */
  }
}

function hex(bytes: number): string {
  const a = new Uint8Array(bytes)
  crypto.getRandomValues(a)
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function loadMeta(): Meta {
  try {
    const m = JSON.parse(read(META_KEY) ?? 'null') as Meta | null
    if (m && typeof m.seq === 'number' && typeof m.session === 'string') return m
  } catch {
    /* a fresh start */
  }
  return { seq: 0, session: '', last: 0, sessions: 0, launches: 0, first: 0, build: '', area: '' }
}

function saveSoon() {
  if (saveTimer != null) return
  saveTimer = window.setTimeout(save, 2000)
}

function save() {
  if (saveTimer != null) window.clearTimeout(saveTimer)
  saveTimer = null
  write(META_KEY, JSON.stringify(meta))
  write(QUEUE_KEY, queue.length ? JSON.stringify(queue) : null)
}

/** On unless switched off in Settings. */
export function statsOn(): boolean {
  return on
}

/** This phone's id, for the Settings row: to tell your own taps from everyone's. */
export function statsId(): string {
  return installId()
}

export function setStatsOn(v: boolean): void {
  if (v === on) return
  on = v
  write(OFF_KEY, v ? null : '1')
  if (!v) {
    // off keeps nothing: what was waiting to go goes nowhere
    queue = []
    save()
    return
  }
  start()
  track('stats_on')
}

/** Tidy a prop: short strings, whole-ish numbers. */
function clean(p: Props): Props {
  const out: Props = {}
  for (const [k, v] of Object.entries(p)) {
    if (v === undefined) continue
    if (typeof v === 'string') out[k] = v.slice(0, 60)
    else if (typeof v === 'number') out[k] = Number.isFinite(v) ? Math.round(v * 100) / 100 : null
    else out[k] = v
  }
  return out
}

/**
 * One thing done. Cheap, and safe anywhere: before start() it waits in the
 * queue like the rest; with the stats off it is nothing. A gap of 30 min
 * since the last event makes this the first of a new session.
 */
export function track(name: string, props?: Props): void {
  if (!on) return
  if (!SEND) {
    if (import.meta.env.DEV) console.debug(`[stats] ${name}`, props ?? '')
    return
  }
  const now = Date.now()
  if (!meta.session || now - meta.last > SESSION_GAP) {
    meta.session = hex(6)
    meta.sessions += 1
    const gap = meta.last ? now - meta.last : null
    meta.last = now
    push('session_start', { n: meta.sessions, gap_h: gap == null ? null : gap / 3_600_000 }, now)
  }
  meta.last = now
  push(name, props, now)
  if (queue.length >= 30) flushSoon(1000)
}

function push(name: string, props: Props | undefined, now: number) {
  meta.seq += 1
  const ev: Ev = { s: meta.session, q: meta.seq, t: now, n: name, a: ACTIVE_AREA.id, b: __BUILD__.sha, o: navigator.onLine ? 1 : 0 }
  if (props) ev.p = clean(props)
  queue.push(ev)
  if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE)
  saveSoon()
}

function flushSoon(ms = FLUSH_MS) {
  if (flushTimer != null) return
  flushTimer = window.setTimeout(() => {
    flushTimer = null
    void flush()
  }, ms)
}

/** The oldest waiting events, a batch at a time, till the queue is empty
 *  or the network says no (then a wait that doubles, up to 5 min). */
async function flush(): Promise<void> {
  if (!SEND || !on || sending || !queue.length || !navigator.onLine || Date.now() < retryAt) return
  const batch = queue.slice(0, BATCH)
  const body = JSON.stringify({ i: installId(), now: Date.now(), e: batch })
  sending = true
  try {
    // text/plain: a simple request, no preflight on a weak signal; keepalive
    // so the batch sent as the phone goes in the pocket still arrives
    const r = await fetch(`${API}/api/events`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body,
      keepalive: body.length < 60_000,
      signal: AbortSignal.timeout(15_000),
    })
    // a 400 is a batch the server will never take: dropped, so it cannot hold up the rest
    if (!r.ok && r.status !== 400) throw new Error(`HTTP ${r.status}`)
    const sent = new Set(batch.map((e) => e.q))
    queue = queue.filter((e) => !sent.has(e.q))
    failures = 0
    retryAt = 0
    save()
  } catch {
    failures += 1
    retryAt = Date.now() + Math.min(300_000, 15_000 * 2 ** (failures - 1))
  } finally {
    sending = false
  }
  if (queue.length && !retryAt) void flush()
}

// ---------------------------------------------------------------- the phone

function platform(): { platform: string; os: string | null; browser: string } {
  const ua = navigator.userAgent
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
  const android = /Android/.test(ua)
  const os = ios ? (/OS (\d+)[._]/.exec(ua)?.[1] ?? null) : android ? (/Android (\d+)/.exec(ua)?.[1] ?? null) : null
  const browser = /SamsungBrowser/.test(ua) ? 'samsung' : /EdgA?\//.test(ua) ? 'edge' : /FxiOS|Firefox/.test(ua) ? 'firefox' : /CriOS|Chrome/.test(ua) ? 'chrome' : /Safari/.test(ua) ? 'safari' : 'other'
  return { platform: ios ? 'ios' : android ? 'android' : /Windows/.test(ua) ? 'windows' : /Mac/.test(ua) ? 'mac' : 'other', os, browser }
}

function standalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean }
  return nav.standalone === true || matchMedia('(display-mode: standalone)').matches
}

/** Where a first open came from: the referrer's host, the utm tags, and
 *  whether it was a shared link (an area's or a spot's: which, never the spot). */
function source(): Props {
  const u = new URL(location.href)
  const ref = document.referrer ? new URL(document.referrer).hostname : null
  return {
    ref: ref && ref !== location.hostname ? ref : null,
    utm_source: u.searchParams.get('utm_source'),
    utm_medium: u.searchParams.get('utm_medium'),
    utm_campaign: u.searchParams.get('utm_campaign'),
    via: /(^|[#&])at=/.test(u.hash) ? 'spot' : u.searchParams.has('area') ? 'area' : null,
  }
}

// ---------------------------------------------------------------- the taps

/** Names you gave things, kept out of a label: pins, views, tracks, your initials. */
let userNames: () => string[] = () => []
export function setUserNames(fn: () => string[]): void {
  userNames = fn
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** A label without anything of yours in it: your names blanked, numbers
 *  to #, one line, short. */
export function scrub(s: string): string {
  let out = s.replace(/\s+/g, ' ').trim()
  const mine = userNames()
    .map((n) => n.trim())
    .filter((n) => n.length >= 2)
    .sort((a, b) => b.length - a.length)
  for (const n of mine) out = out.replace(new RegExp(escapeRe(n), 'gi'), '[name]')
  return out
    .replace(/\d+([.,:]\d+)*/g, '#')
    // the chevrons and marks beside a label are not part of it
    .replace(/[›‹»«→←↑↓▸▾▴✓✕×…]/g, '')
    .trim()
    .slice(0, 40)
}

const TAPPABLE = 'button, a[href], [role="button"], [role="menuitem"], [role="radio"], [role="tab"], [role="switch"], input, select, summary'

/** Where on the screen: the sheet (which), a popup, the menu, the strip, a column, a card. */
function whereOf(el: Element): string {
  const s = useAppStore.getState()
  if (el.closest('.sheet')) return `sheet:${topSheet(s)?.kind ?? '?'}`
  if (el.closest('.maplibregl-popup')) return 'popup'
  if (el.closest('.wx-menu')) return 'menu'
  if (el.closest('.wxstrip')) return 'strip'
  if (el.closest('.topbar')) return 'topbar'
  if (el.closest('.hotcol')) return 'hot'
  if (el.closest('.toolcol')) return 'tools'
  if (el.closest('.viewpill, .leftfoot')) return 'views'
  if (el.closest('.bottombar')) return 'bar'
  if (el.closest('.toparea')) return s.topCard ? `card:${s.topCard.kind}` : 'live'
  if (el.closest('.maplibregl-ctrl')) return 'map-ctrl'
  return 'other'
}

function labelOf(el: Element): string {
  const own = el.getAttribute('data-track') ?? el.getAttribute('aria-label') ?? el.getAttribute('title')
  if (own) return scrub(own)
  if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) {
    // a switch or a box: its row's words, never what is in it
    const label = el.closest('label') ?? (el.id ? document.querySelector(`label[for="${el.id}"]`) : null)
    const words = label ? [...label.childNodes].filter((n) => n !== el).map((n) => n.textContent ?? '').join(' ') : (el.getAttribute('placeholder') ?? el.name)
    return scrub(words)
  }
  return scrub(el.textContent ?? '')
}

function onClick(e: MouseEvent) {
  const t = e.target instanceof Element ? e.target.closest(TAPPABLE) : null
  if (!t || t.closest('[data-track-off]')) return
  // the label's own click is followed by its input's: that one counts
  if (t instanceof HTMLInputElement && (t.type === 'text' || t.type === 'search' || t.type === 'number')) return
  counts.clicks += 1
  const kind = t instanceof HTMLInputElement ? t.type : t.tagName === 'SELECT' ? 'select' : t.tagName === 'A' ? 'link' : (t.getAttribute('role') ?? 'button')
  const cls = (typeof t.className === 'string' ? t.className : '').split(/\s+/).find((c) => c && !/^(on|active|seg-on|chip-on|held|dim)$/.test(c)) ?? null
  track('click', { el: labelOf(t) || cls || t.tagName.toLowerCase(), where: whereOf(t), kind, cls })
}

// ---------------------------------------------------------------- errors

function errorEvent(kind: string, msg: unknown, at?: string) {
  const text = String(msg instanceof Error ? msg.message : (msg ?? ''))
    .replace(/-?\d+\.\d+/g, '#.#')
    .slice(0, 160)
  if (errorsSeen.has(text) || errorsSeen.size >= MAX_ERRORS) return
  errorsSeen.add(text)
  track('error', { kind, msg: text, at: at ?? null })
}

// ---------------------------------------------------------------- the map and the clock

/** The map's gestures, counted for the hide event; a tap is an event of its own. */
export function countMap(what: 'pan' | 'zoom'): void {
  if (what === 'pan') counts.pans += 1
  else counts.zooms += 1
}

export function countTap(): void {
  counts.taps += 1
}

/** A time since the page was opened, once a page: the map up, the first wind drawn. */
const timed = new Set<string>()
export function trackTime(what: string): void {
  if (timed.has(what)) return
  timed.add(what)
  track('perf', { what, ms: Math.round(performance.now()) })
}

function onShow() {
  if (shownAt) return
  shownAt = Date.now()
  track('show')
}

function onHide() {
  if (!shownAt) return
  track('hide', { fg_s: (Date.now() - shownAt) / 1000, ...counts })
  shownAt = 0
  counts.taps = counts.pans = counts.zooms = counts.clicks = 0
  save()
  void flush()
}

/**
 * Call once, before the app renders: the switch, the waiting events, the
 * launch and what the phone is, then the taps, the errors and the time in
 * front. Stores are watched from stats/watch.ts once the app is up.
 */
export function initAnalytics(): void {
  on = read(OFF_KEY) !== '1'
  meta = loadMeta()
  try {
    const saved = JSON.parse(read(QUEUE_KEY) ?? '[]') as unknown
    if (Array.isArray(saved)) queue = saved.filter((e): e is Ev => !!e && typeof (e as Ev).q === 'number').slice(-MAX_QUEUE)
  } catch {
    queue = []
  }
  if (on) start()
}

function start() {
  if (started) return
  started = true
  const now = Date.now()
  // what the last run left unsent: a week in the bush shows here
  const waiting = queue.length
  const firstOpen = !meta.first
  if (firstOpen) meta.first = now
  meta.launches += 1
  // known: the app was on this phone before the stats were (its settings are there), so not a new user
  if (firstOpen) track('first_open', { ...source(), known: read('huntapp') != null || read('huntapp-install') != null })
  else if (meta.build && meta.build !== __BUILD__.sha) track('app_updated', { from: meta.build })
  if (meta.area && meta.area !== ACTIVE_AREA.id) track('area_switch', { from: meta.area })
  meta.build = __BUILD__.sha
  meta.area = ACTIVE_AREA.id
  const nav = navigator as Navigator & { deviceMemory?: number }
  track('launch', {
    ...platform(),
    standalone: standalone(),
    vp: `${innerWidth}x${innerHeight}`,
    dpr: devicePixelRatio,
    lang: navigator.language,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    mem: nav.deviceMemory ?? null,
    launches: meta.launches,
    age_d: (now - meta.first) / 86_400_000,
    queued: waiting,
  })
  if (document.visibilityState === 'visible') onShow()

  document.addEventListener('click', onClick, { capture: true, passive: true })
  document.addEventListener('visibilitychange', () => (document.visibilityState === 'visible' ? onShow() : onHide()))
  window.addEventListener('pagehide', onHide)
  window.addEventListener('online', () => void flush())
  window.addEventListener('error', (e) => errorEvent('uncaught', e.message, e.filename ? `${e.filename.split('/').pop()}:${e.lineno}` : undefined))
  window.addEventListener('unhandledrejection', (e) => errorEvent('rejection', e.reason))
  window.setInterval(() => {
    if (document.visibilityState === 'visible') void flush()
  }, FLUSH_MS)
  flushSoon(5000)
}
