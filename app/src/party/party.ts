import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { API, track } from '../analytics'
import { ACTIVE_AREA } from '../areas'
import { useHuntLog, type LogEntry } from '../log/huntLog'
import { useAppStore } from '../state/appStore'
import { useGpsStore } from '../tracking/gpsStore'
import { useScent, type Sitter } from '../weather/micro/scent'
import { useWindChecks, type WindCheck } from '../weather/micro/windChecks'
import { newMemberId, newParty, readInvite, type PartyInvite } from './partyCode'
import { open, seal } from './seal'

/**
 * Hunting as a party (docs/PARTY.md): the phones in a party share where
 * each one is, their wind checks and what they heard or saw, and each
 * phone draws everyone's. A member is a dot with initials on the map and a
 * sitter in the scent card (their cone on your map, from where they are);
 * their checks sharpen your ground wind as your own do; their sounds and
 * sightings land in your hunt log and on the heat map.
 *
 * Joined by an invite (partyCode.ts: a QR code or a link at camp, or the
 * code pasted). What goes is sealed on the phone with the party's key
 * (seal.ts) and posted to the party's mailbox on the Groundwind Worker
 * (site/party.js), which never sees the key; each phone reads the mailbox
 * from where it left off. With no signal, what is to go waits in an outbox
 * and goes when there is one.
 *
 * Positions go on their own while in a party, as a phone gets fixes (the
 * locate button on) and is looked at: a web app has no position in a
 * pocket. A position replaces the last one on the Worker, so a phone that
 * joins late sees where everyone is now. "Share my position" off takes
 * your dot off the others' maps.
 */

export interface MemberPos {
  lon: number
  lat: number
  /** when the fix was made, ms */
  ts: number
  /** how high they sit, m (the scent card's choice on their phone) */
  h: number
  acc?: number
  /** walking when the fix was made */
  mv?: boolean
}

export interface Member {
  mid: string
  /** their initials */
  who: string
  pos?: MemberPos
  /** when anything of theirs last arrived, ms */
  seen: number
}

type Payload =
  | { t: 'hello'; who: string }
  | ({ t: 'pos'; off?: false } & MemberPos)
  | { t: 'pos'; off: true }
  | { t: 'check'; c: WindCheck }
  | { t: 'log'; e: LogEntry }
  | { t: 'del'; k: 'check' | 'log'; id: string }
  | { t: 'bye' }

type Slot = 'pos' | 'hello'

interface Out {
  q: number
  s?: Slot
  x: Payload
}

export interface Party extends PartyInvite {
  joinedAt: number
  /** made on this phone */
  mine?: boolean
}

interface PartyState {
  party: Party | null
  /** this phone's id in the party */
  me: string
  /** this phone's counter: every item gets the next */
  seq: number
  /** the mailbox read up to here */
  after: number
  members: Record<string, Member>
  /** "Share my position" off */
  paused: boolean
  outbox: Out[]
  /** your checks' and log entries' ids → a fingerprint of what went */
  sent: Record<string, string>
  lastPos: { lon: number; lat: number; ts: number } | null
  helloAt: number
  /** an invite opened from a link, waiting for Join on the Party sheet */
  invite: PartyInvite | null
  /** the last good read of the mailbox, ms */
  syncedAt: number
}

const EMPTY = { party: null, me: '', seq: 0, after: 0, members: {}, paused: false, outbox: [], sent: {}, lastPos: null, helloAt: 0, syncedAt: 0 }

export const usePartyStore = create<PartyState>()(
  persist(() => ({ ...EMPTY, invite: null }) as PartyState, { name: 'huntapp-party', version: 1 }),
)

const set = (p: Partial<PartyState>) => usePartyStore.setState(p)
const get = () => usePartyStore.getState()

// ---------------------------------------------------------------- joining and leaving

/** Your initials, as the party will see them; blank until set in Settings or on the Party sheet. */
function initials(): string {
  return useAppStore.getState().who.trim()
}

/** A new party, made on this phone; you are its first member. */
export function startParty(name?: string): void {
  const p = newParty(name || `${initials()}'s party`)
  begin({ ...p, area: ACTIVE_AREA.id, joinedAt: Date.now(), mine: true })
  track('party', { what: 'start' })
}

/** Join the party an invite is for (leaving any other first). */
export function joinParty(inv: PartyInvite): void {
  if (get().party?.id === inv.id) {
    set({ invite: null })
    return
  }
  if (get().party) leaveParty()
  begin({ ...inv, joinedAt: Date.now() })
  track('party', { what: 'join' })
}

function begin(party: Party) {
  set({ ...EMPTY, party, me: newMemberId(), invite: null })
  hello()
  // what you checked and logged in the last day goes too: the party starts the sit knowing it
  queueOwn(Date.now() - 86_400_000)
  sendPos(true)
  start()
  void poll()
}

/** Out of the party: a goodbye to the others, then nothing more. Their checks and sightings stay in your log. */
export function leaveParty(): void {
  const s = get()
  if (!s.party) return
  const { party, me, seq } = s
  // the goodbye goes now if it can; a phone with no signal just goes quiet
  void post(party, me, [{ q: seq + 1, x: { t: 'bye' } }]).catch(() => {})
  set({ ...EMPTY, invite: s.invite?.id === party.id ? null : s.invite })
  useScent.getState().setParty([])
  track('party', { what: 'leave' })
}

export function setPaused(v: boolean): void {
  if (v === get().paused) return
  set({ paused: v })
  if (v) {
    // off the others' maps now, not just not updated
    enqueue({ t: 'pos', off: true }, 'pos')
    set({ lastPos: null })
  } else sendPos(true)
}

/** An invite from a link that opened the app: kept for the Party sheet's Join, and the link tidied. */
function takeLinkInvite(): boolean {
  const inv = readInvite(window.location.href)
  if (!inv) return false
  // the code is not left in the address bar, a bookmark or a reload
  const h = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  h.delete('party')
  h.delete('pn')
  const rest = h.toString()
  history.replaceState(history.state, '', window.location.pathname + window.location.search + (rest ? `#${rest}` : ''))
  if (get().party?.id === inv.id) return false
  set({ invite: inv })
  return true
}

// ---------------------------------------------------------------- what goes

function enqueue(x: Payload, s?: Slot) {
  const q = get().seq + 1
  let outbox = get().outbox
  // a slot holds the newest: a position waiting to go is replaced, not queued behind
  if (s) outbox = outbox.filter((o) => o.s !== s)
  // a check or entry waiting to go goes as it is now
  const ref = x.t === 'check' ? x.c.id : x.t === 'log' ? x.e.id : null
  if (ref) outbox = outbox.filter((o) => !((o.x.t === 'check' && o.x.c.id === ref) || (o.x.t === 'log' && o.x.e.id === ref)))
  set({ seq: q, outbox: [...outbox, { q, ...(s ? { s } : {}), x }] })
  flushSoon(800)
}

function hello() {
  enqueue({ t: 'hello', who: initials() || '?' }, 'hello')
  set({ helloAt: Date.now() })
}

/** A short fingerprint of what would go: changed, it goes again. */
function print(v: unknown): string {
  const s = JSON.stringify(v)
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

/** Your own checks and log entries since `since` that have not gone as they are now; and the ones you took away. */
function queueOwn(since = get().party?.joinedAt ?? Date.now()) {
  const s = get()
  if (!s.party) return
  const sent = { ...s.sent }
  const checks = useWindChecks.getState().checks.filter((c) => !c.taken && c.ts >= since - 6 * 3600_000)
  const entries = useHuntLog.getState().entries.filter((e) => !e.taken && e.ts >= since - 6 * 3600_000)
  for (const c of checks) {
    const p = print(c)
    if (sent[c.id] === p) continue
    sent[c.id] = p
    enqueue({ t: 'check', c })
  }
  for (const e of entries) {
    const p = print(e)
    if (sent[e.id] === p) continue
    sent[e.id] = p
    enqueue({ t: 'log', e })
  }
  // gone from your phone: gone from theirs
  const have = new Set([...useWindChecks.getState().checks.map((c) => c.id), ...useHuntLog.getState().entries.map((e) => e.id)])
  for (const id of Object.keys(sent)) {
    if (have.has(id)) continue
    delete sent[id]
    enqueue({ t: 'del', k: id.startsWith('wc') ? 'check' : 'log', id })
  }
  set({ sent })
}

const MOVE_M = 25
const POS_EVERY_MS = 3 * 60_000
const POS_MIN_MS = 20_000

function metres(a: { lon: number; lat: number }, b: { lon: number; lat: number }): number {
  return Math.hypot((a.lon - b.lon) * 111_320 * Math.cos((a.lat * Math.PI) / 180), (a.lat - b.lat) * 110_574)
}

/** Your height on the scent card: the live sitter's, else the next one's. */
function myHeight(): number {
  const sc = useScent.getState()
  return sc.people.find((p) => p.live)?.height ?? sc.height
}

/** Where you are, when it has moved 25 m or 3 min have gone (or `force`), unless paused. */
function sendPos(force = false) {
  const s = get()
  const fix = useGpsStore.getState().fix
  if (!s.party || s.paused || !fix || Date.now() - fix.ts > 5 * 60_000) return
  const last = s.lastPos
  const due = !last || metres(last, fix) >= MOVE_M || fix.ts - last.ts >= POS_EVERY_MS
  if (!due && !force) return
  if (last && fix.ts - last.ts < POS_MIN_MS && !force) return
  const mv = fix.sogKn != null && fix.sogKn * 1.852 >= 1.5
  enqueue({ t: 'pos', lon: round6(fix.lon), lat: round6(fix.lat), ts: fix.ts, h: myHeight(), acc: Math.round(fix.accuracy), ...(mv ? { mv } : {}) }, 'pos')
  set({ lastPos: { lon: fix.lon, lat: fix.lat, ts: fix.ts } })
}

const round6 = (v: number) => Math.round(v * 1e6) / 1e6

// ---------------------------------------------------------------- the mailbox

let sending = false
let failures = 0
let retryAt = 0
let flushTimer: number | null = null

async function post(party: Party, me: string, items: Out[]): Promise<void> {
  const i = await Promise.all(items.map(async (o) => ({ q: o.q, ...(o.s ? { s: o.s } : {}), b: await seal(party.key, party.id, me, o.q, o.x) })))
  const body = JSON.stringify({ p: party.id, m: me, i })
  const r = await fetch(`${API}/api/party`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body, keepalive: body.length < 60_000, signal: AbortSignal.timeout(20_000) })
  // a 400 is a batch the Worker will never take: let it go, so it cannot hold up the rest
  if (!r.ok && r.status !== 400) throw new Error(`HTTP ${r.status}`)
}

function flushSoon(ms = 800) {
  if (flushTimer != null) return
  flushTimer = window.setTimeout(() => {
    flushTimer = null
    void flush()
  }, ms)
}

async function flush(): Promise<void> {
  const s = get()
  if (!s.party || sending || !s.outbox.length || !navigator.onLine || Date.now() < retryAt) return
  const batch = s.outbox.slice(0, 20)
  sending = true
  try {
    await post(s.party, s.me, batch)
    // only if still the same party: a leave or a switch while it was in the air leaves the new outbox alone
    if (get().party?.id === s.party.id) {
      const gone = new Set(batch.map((o) => o.q))
      set({ outbox: get().outbox.filter((o) => !gone.has(o.q)) })
    }
    failures = 0
    retryAt = 0
  } catch (e) {
    failures += 1
    retryAt = Date.now() + Math.min(300_000, 10_000 * 2 ** (failures - 1))
    if (import.meta.env.DEV) console.warn('[party] send failed', e)
  } finally {
    sending = false
  }
  if (!retryAt && get().outbox.length) void flush()
}

let polling = false

/** Read the mailbox from where this phone left off, and take in what the others sent. */
export async function poll(): Promise<void> {
  const s = get()
  if (!s.party || polling || !navigator.onLine) return
  polling = true
  try {
    for (let page = 0; page < 20; page++) {
      const { party, me } = get()
      if (!party || party.id !== s.party.id) break
      const r = await fetch(`${API}/api/party?p=${encodeURIComponent(party.id)}&after=${get().after}`, { signal: AbortSignal.timeout(20_000), cache: 'no-store' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = (await r.json()) as { i: { id: number; m: string; q: number; s: string | null; b: string }[]; last: number; more?: boolean }
      for (const it of j.i) {
        if (it.m === me) continue
        const x = (await open(party.key, party.id, it.m, it.q, it.b)) as Payload | null
        if (x && typeof x === 'object' && typeof x.t === 'string') take(it.m, x)
      }
      if (get().party?.id !== party.id) break
      set({ after: Math.max(get().after, j.last), syncedAt: Date.now() })
      if (!j.more) break
    }
  } catch (e) {
    // no signal, or the Worker away: the next look tries again
    if (import.meta.env.DEV) console.warn('[party] read failed', e)
  } finally {
    polling = false
  }
}

/** One item from a member, applied. */
function take(mid: string, x: Payload) {
  const members = { ...get().members }
  if (x.t === 'bye') {
    delete members[mid]
    set({ members })
    return
  }
  const m: Member = { ...(members[mid] ?? { mid, who: '?' }), seen: Date.now() }
  members[mid] = m
  switch (x.t) {
    case 'hello': {
      const who = String(x.who ?? '').trim().slice(0, 12) || '?'
      if (who !== m.who) {
        m.who = who
        relabel(mid, who)
      }
      break
    }
    case 'pos':
      if (x.off) delete m.pos
      else if (Number.isFinite(x.lon) && Number.isFinite(x.lat) && Number.isFinite(x.ts) && (!m.pos || x.ts >= m.pos.ts)) {
        m.pos = { lon: x.lon, lat: x.lat, ts: x.ts, h: Number.isFinite(x.h) ? x.h : 1.5, ...(x.acc != null ? { acc: x.acc } : {}), ...(x.mv ? { mv: true } : {}) }
      }
      break
    case 'check':
      if (x.c && typeof x.c === 'object') useWindChecks.getState().takeIn([{ ...x.c, by: m.who, member: mid }])
      break
    case 'log':
      if (x.e && typeof x.e === 'object') useHuntLog.getState().takeIn([{ ...x.e, by: m.who, member: mid }])
      break
    case 'del':
      if (x.k === 'check') {
        const c = useWindChecks.getState().checks.find((o) => o.id === x.id)
        if (c?.taken && c.member === mid) useWindChecks.getState().remove(x.id)
      } else {
        const e = useHuntLog.getState().entries.find((o) => o.id === x.id)
        if (e?.taken && e.member === mid) useHuntLog.getState().remove(x.id)
      }
      break
  }
  set({ members })
}

/** Initials that arrived after their checks: the checks and entries take them. */
function relabel(mid: string, who: string) {
  const wc = useWindChecks.getState()
  if (wc.checks.some((c) => c.member === mid && c.by !== who)) wc.takeIn(wc.checks.filter((c) => c.member === mid).map((c) => ({ ...c, by: who })))
  const hl = useHuntLog.getState()
  if (hl.entries.some((e) => e.member === mid && e.by !== who)) hl.takeIn(hl.entries.filter((e) => e.member === mid).map((e) => ({ ...e, by: who })))
}

// ---------------------------------------------------------------- their scent

/** A member's position this old still sits in the scent card; older, the dot only. */
export const SCENT_FRESH_MS = 2 * 3600_000

/** The members sitting now, as the scent card's sitters. */
function partySitters(): Sitter[] {
  const now = Date.now()
  return Object.values(get().members)
    .filter((m) => m.pos && now - m.pos.ts <= SCENT_FRESH_MS)
    .sort((a, b) => a.who.localeCompare(b.who))
    .map((m) => ({ lon: m.pos!.lon, lat: m.pos!.lat, height: m.pos!.h, party: m.mid, who: m.who }))
}

/** With the scent card in use (anyone sitting), the party sits in it too. */
function syncScent() {
  const sc = useScent.getState()
  if (!sc.people.length) return
  sc.setParty(get().party ? partySitters() : [])
}

/** "Scent" on a member's popup: their cone, and the rest of the party's with it. */
export function showMemberScent(mid: string): void {
  const sc = useScent.getState()
  const list = partySitters()
  if (!list.some((p) => p.party === mid)) return
  sc.setParty(list)
  const k = useScent.getState().people.findIndex((p) => p.party === mid)
  if (k >= 0) sc.setPick(k)
  useAppStore.getState().setTopCard({ kind: 'scent' })
}

// ---------------------------------------------------------------- running

const POLL_MS = 20_000
const HELLO_MS = 12 * 3600_000
let started = false
let ownTimer: number | null = null

function start() {
  if (started) return
  started = true
  useGpsStore.subscribe((s, p) => {
    if (s.fix !== p.fix && document.visibilityState === 'visible') sendPos()
  })
  const own = () => {
    if (ownTimer != null) window.clearTimeout(ownTimer)
    // a puff folding into a check: wait for it to settle
    ownTimer = window.setTimeout(() => {
      ownTimer = null
      queueOwn()
    }, 2000)
  }
  useWindChecks.subscribe((s, p) => {
    if (s.checks !== p.checks) own()
  })
  useHuntLog.subscribe((s, p) => {
    if (s.entries !== p.entries) own()
  })
  usePartyStore.subscribe((s, p) => {
    if (s.members !== p.members || s.party !== p.party) syncScent()
  })
  // new initials: the party sees them now, not in twelve hours
  useAppStore.subscribe((s, p) => {
    if (s.who !== p.who && get().party && s.who.trim()) hello()
  })
  useScent.subscribe((s, p) => {
    // the card starting up (someone placed, your cone on): the party joins it
    if (s.people.length && !p.people.length) syncScent()
    // your height chosen: it goes with your next position
    if (get().party && myHeightOf(s.people, s.height) !== myHeightOf(p.people, p.height)) sendPos(true)
  })
  const look = () => {
    if (!get().party) return
    if (Date.now() - get().helloAt > HELLO_MS) hello()
    sendPos()
    void poll()
    void flush()
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') look()
    // put away: what is waiting goes now, while the page can still send it
    else void flush()
  })
  window.addEventListener('online', look)
  window.setInterval(() => {
    if (document.visibilityState === 'visible') {
      look()
      // the ages on the map and the scent's two hours move on
      syncScent()
    }
  }, POLL_MS)
}

function myHeightOf(people: Sitter[], h: number): number {
  return people.find((p) => p.live)?.height ?? h
}

/** Call once at startup: the party this phone is in, and an invite a link brought. */
export function initParty(): void {
  const fromLink = takeLinkInvite()
  if (get().party) {
    start()
    void poll()
    flushSoon(3000)
  }
  if (fromLink) useAppStore.getState().openSheet({ kind: 'party' })
}

/** Members by initials, for the sheet: with how long ago they were placed and how far from you. */
export function membersList(): Member[] {
  return Object.values(get().members).sort((a, b) => a.who.localeCompare(b.who))
}

export function outboxCount(): number {
  return get().outbox.length
}
