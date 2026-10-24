import { API } from '../analytics'
import { authHeaders, signedIn } from '../account/session'
import { ACTIVE_AREA } from '../areas'
import { packArea, readLocations, setLocationPack } from '../areas/runtime'
import { devlog, installId } from '../devlog'
import { useAppStore } from '../state/appStore'
import { toast } from '../ui/Toast'
import { bounds, centre, parseBoxId, sizeKm } from './box'
import { useExplore, type Requested } from './store'

/**
 * How this phone's asks are getting on (Gavan, 2026-10-20: "the request a
 * location -> executing it"): the queue's word on each (the Worker's GET
 * /api/request?id=, the stage the bake agent last reported: queued,
 * claimed, baking with its step, done with the pack it became, failed),
 * asked when the app opens and every few minutes while it is looked at
 * with signal, until the ask is done with. The Locations sheet shows it.
 *
 * And each loaded location's SD build (docs/REQUESTS.md: Load starts it,
 * one at a time per phone): kept on the phone as 'waiting' until the
 * hunter is signed in (the build is the account's, so it is theirs on
 * every phone: Gavan, 2026-10-24), no other build of this phone's is in
 * the queue and there is signal, then sent; its place in line, the minutes to
 * go and how far the bake is come back with each look. Done, the pack's
 * area file is fetched and kept with the location (areas/runtime.ts), which
 * opens on it from then on: no app build, no release.
 */

const EVERY_MS = 3 * 60_000
/** stages past which the queue has nothing more to say */
const SETTLED = new Set(['done', 'failed', 'cancelled'])
/** stages that hold the phone's next build back: one in the queue or on a machine (review waits for a person, not a machine) */
const BUSY = new Set(['queued', 'claimed', 'baking'])

const open = (r: Requested) => r.rid != null && !SETTLED.has(r.stage ?? '')

interface Status {
  stage?: string | null
  step?: string | null
  area_id?: string | null
  error?: string | null
  ahead?: number | null
  minutes?: number | null
  progress?: number | null
}

/** What the queue's answer says, as the store keeps it; a field the Worker does not send yet stays out. */
function statusOf(j: Status): Partial<Requested> {
  const out: Partial<Requested> = { stage: j.stage ?? 'queued', step: j.step ?? null, areaId: j.area_id ?? null, error: j.error ?? null, checked: Date.now() }
  if ('ahead' in j) out.ahead = typeof j.ahead === 'number' ? j.ahead : null
  if ('minutes' in j) out.minutes = typeof j.minutes === 'number' ? j.minutes : null
  if ('progress' in j) out.progress = typeof j.progress === 'number' ? j.progress : null
  return out
}

async function fetchStatus(rid: number): Promise<Status | null> {
  try {
    const res = await fetch(`${API}/api/request?id=${rid}`, { cache: 'no-store' })
    return res.ok ? ((await res.json()) as Status) : null
  } catch {
    /* no signal or the queue down: asked again next time */
    return null
  }
}

async function ask(id: string, r: Requested): Promise<void> {
  const j = await fetchStatus(r.rid!)
  if (!j) return
  const s = statusOf(j)
  if (s.stage !== r.stage || (s.step ?? null) !== (r.step ?? null)) devlog('explore', `ask ${r.rid} · ${s.stage}${s.step ? ` · ${s.step}` : ''}`)
  useExplore.getState().setStatus(id, s)
}

async function askBuild(id: string, r: Requested): Promise<void> {
  const j = await fetchStatus(r.rid!)
  if (!j) return
  const s = statusOf(j)
  if (s.stage !== r.stage || (s.step ?? null) !== (r.step ?? null)) devlog('explore', `build ${r.rid} · ${s.stage}${s.step ? ` · ${s.step}` : ''}`)
  useExplore.getState().patchBuild(id, s)
  if (s.stage === 'done' && s.areaId) await packDone(id, s.areaId)
}

/** Ask the queue about every open ask and build now; send the next build waiting. */
export function checkAsks(): void {
  if (!useAppStore.getState().online) return
  const st = useExplore.getState()
  for (const [id, r] of Object.entries(st.requested)) if (open(r)) void ask(id, r)
  const builds = Object.entries(st.builds)
  void Promise.all(builds.filter(([, r]) => open(r)).map(([id, r]) => askBuild(id, r))).then(() => sendNext())
  // a build done whose pack's file never came (no signal at the time, a link's pack)
  void fetchPacks()
}

let started = false
/** From the app's start (App.tsx): now, then every few minutes while looked at. */
export function startAskChecks(): void {
  if (started) return
  started = true
  // a location opened with no build of its own (loaded before builds came with the Load, or made from
  // a link): its build now, kept and sent one at a time. One with a pack named (a link's) has its
  // build already; the Worker joins one still under way for the same box (worker.js takeRequest)
  const a = ACTIVE_AREA
  if (a.loaded === 'box' && !useExplore.getState().builds[a.id] && !readLocations().find((l) => l.id === a.id)?.pack) {
    queueBuild(a.id, a.name, a.jurisdiction, undefined, false)
  }
  checkAsks()
  window.setInterval(() => {
    if (document.visibilityState === 'visible') checkAsks()
  }, EVERY_MS)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkAsks()
  })
  window.addEventListener('online', () => checkAsks())
}

// ---- builds ------------------------------------------------------------------------------------

/** A location just loaded: its build kept on the phone, sent if nothing of this phone's is in the
 *  queue: now, or (`now` false: a Load, which reloads at once and would cut a send off half way,
 *  sending it twice) by the next start's look (areas/load.ts). The email goes with it only when the
 *  hunter gave one. */
export function queueBuild(id: string, name: string, j: string, email?: string, now = true): void {
  const st = useExplore.getState()
  const was = st.builds[id]
  // the same box loaded again (a link, a rename): its build stands
  if (was && was.stage !== 'cancelled' && was.stage !== 'failed') return
  st.setBuild(id, { kind: 'sd', at: Date.now(), stage: 'waiting', name, j, ...(email ? { email } : {}) })
  devlog('explore', `build kept · ${id} · ${name}`)
  if (now) void sendNext()
}

let sending = false
/** The oldest build waiting goes to the queue, when there is signal and none of this phone's is in it. */
async function sendNext(): Promise<void> {
  // a build is the account's (Gavan, 2026-10-24: the build waits for sign-in): kept on the phone till then
  if (sending || !navigator.onLine || !signedIn()) return
  const builds = Object.entries(useExplore.getState().builds)
  if (builds.some(([, r]) => r.rid != null && BUSY.has(r.stage ?? ''))) return
  const next = builds.filter(([, r]) => r.stage === 'waiting').sort((a, b) => a[1].at - b[1].at)[0]
  if (!next) return
  sending = true
  try {
    await send(next[0], next[1])
  } finally {
    sending = false
  }
}

async function send(id: string, r: Requested): Promise<void> {
  const box = parseBoxId(id)
  if (!box) {
    useExplore.getState().dropBuild(id)
    return
  }
  const b = bounds(box)
  const [lon, lat] = centre(box)
  const size = sizeKm(box)
  let res: Response
  try {
    res = await fetch(`${API}/api/request`, {
      method: 'POST',
      // signed in, the account asks (site/account.js): the build is its location's on every phone
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        ...(r.email ? { email: r.email } : {}),
        where: `${r.name ?? 'Spot'} · ${id} · ${size.w.toFixed(1)} × ${size.h.toFixed(1)} km`,
        name: r.name,
        lat,
        lon,
        tile: id,
        box: b,
        kind: 'sd',
        source: 'app',
        install: installId(),
      }),
    })
  } catch {
    // no signal after all: sent at the next look
    return
  }
  const back = (await res.json().catch(() => null)) as ({ id?: number; error?: string; token?: string } & Status) | null
  if (res.ok && typeof back?.id === 'number') {
    useExplore.getState().patchBuild(id, { rid: back.id, held: null, ...statusOf(back), ...(typeof back.token === 'string' ? { token: back.token } : {}) })
    devlog('explore', `build sent · ${id} · #${back.id}${back.stage === 'done' ? ` · served by ${back.area_id}` : ''}`)
    if (back.stage === 'done' && back.area_id) await packDone(id, back.area_id)
    return
  }
  // turned away for now (busy; a Worker from before builds that still wants an email): it waits and goes again later
  const why = back?.error ?? String(res.status)
  if (res.status === 429 || why === 'email' || res.status >= 500) {
    if (r.held !== why) devlog('explore', `build held · ${id} · ${why}`)
    useExplore.getState().patchBuild(id, { held: why })
    return
  }
  // refused outright (a box the queue will not take): said in its row, never sent again
  useExplore.getState().patchBuild(id, { stage: 'failed', error: why, held: null })
  devlog('explore', `build refused · ${id} · ${why}`)
}

/** A location's build taken back (removed, or moved to another box): a build not sent just goes;
 *  one in the queue is cancelled there too, if the machines have not started it. */
export function dropBuild(id: string): void {
  const r = useExplore.getState().builds[id]
  useExplore.getState().dropBuild(id)
  if (!r?.rid || SETTLED.has(r.stage ?? '')) return
  void fetch(`${API}/api/request`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ cancel: true, tile: id, install: installId(), ...(r.email ? { email: r.email } : {}), source: 'app' }),
  }).then(
    () => devlog('explore', `build cancelled · ${id}`),
    () => devlog('explore', `build cancel not sent · ${id}`),
  )
  // the next one of this phone's may go now
  window.setTimeout(() => void sendNext(), 0)
}

// ---- packs -------------------------------------------------------------------------------------

/** The pack's area file, as the Worker keeps it (site/bake.js areaFile). */
async function fetchDef(pack: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${API}/areas/${encodeURIComponent(pack)}/area.json`, { cache: 'no-store' })
    if (!res.ok) return null
    const j = (await res.json()) as unknown
    return j && typeof j === 'object' && !Array.isArray(j) ? (j as Record<string, unknown>) : null
  } catch {
    return null
  }
}

const fetching = new Set<string>()
/** A build done: the pack's id and its area file kept with the location. The one the app is in
 *  says so, with Open: the reload opens it on the pack (never by itself: the hunter may be mid-sit). */
async function packDone(id: string, pack: string): Promise<void> {
  const l = readLocations().find((o) => o.id === id)
  if (!l || (l.pack === pack && l.def) || fetching.has(id)) return
  setLocationPack(id, pack)
  fetching.add(id)
  try {
    const def = await fetchDef(pack)
    if (!def || !packArea(l, def)) {
      devlog('explore', `pack ${pack} for ${id}: ${def ? 'its area file is not one the app reads' : 'no area file yet'}`)
      return
    }
    setLocationPack(id, pack, def)
    devlog('explore', `pack kept · ${id} · ${pack}`)
    if (id === ACTIVE_AREA.id && ACTIVE_AREA.loaded === 'box') {
      toast(`${l.name} is built`, 12_000, { label: 'Open', run: () => window.location.reload() })
    }
  } finally {
    fetching.delete(id)
  }
}

/** Every kept location with a pack whose area file is not on the phone (a build done with no
 *  signal at the time, a link's pack, areas/runtime.ts addressLocation): fetched now. */
export async function fetchPacks(): Promise<void> {
  if (!navigator.onLine) return
  for (const l of readLocations()) if (l.pack && !l.def) await packDone(l.id, l.pack)
}

// ---- words -------------------------------------------------------------------------------------

const ORDINAL = ['next', '2nd', '3rd']
/** "about 5 min", "about 2 h" */
function aboutMinutes(m: number): string {
  if (m < 2) return 'a minute or two'
  if (m < 60) return `about ${m < 10 ? Math.round(m) : Math.round(m / 5) * 5} min`
  return `about ${Math.round(m / 30) / 2} h`
}

/** A build in words, for its location's row: "2nd in line · about 20 min", "building · 40% · about
 *  5 min", "built". Minutes only when a machine has called in lately; with none the words say so. */
export function buildWords(r: Requested, others: Requested[] = []): string {
  const time = r.minutes != null ? ` · ${aboutMinutes(r.minutes)}` : ''
  switch (r.stage) {
    case 'waiting': {
      if (!signedIn()) return 'sign in to build its heat map, routes and pack'
      if (!navigator.onLine) return 'build waits for signal'
      const ahead = others.find((o) => o.rid != null && BUSY.has(o.stage ?? ''))
      return ahead ? `build goes after ${ahead.name ?? 'your other spot'}` : 'build about to go'
    }
    case 'queued': {
      const place = r.ahead == null ? 'in line' : `${ORDINAL[r.ahead] ?? `${r.ahead + 1}th`} in line`
      // the Worker said no machine is in (minutes null, ahead known): honest, not a clock
      const away = r.minutes === null && r.ahead != null ? ' · our machines are off for now' : ''
      return `${place}${time}${away}`
    }
    case 'claimed':
      return `starting${time}`
    case 'baking':
      return `building${r.progress != null ? ` · ${Math.round(r.progress * 100)}%` : r.step ? ` · ${r.step}` : ''}${time}`
    case 'review':
      return 'built, being checked before it goes out'
    case 'done':
      return 'built'
    case 'failed':
      return 'we hit a snag on this one; we are on it'
    case 'cancelled':
      return 'cancelled'
    default:
      return 'in line'
  }
}

/** An ask's stage in words: "in the queue", "baking · habitat", "ready", … */
export function stageWords(r: Requested): string {
  switch (r.stage) {
    case 'claimed':
      return 'starting'
    case 'baking':
      return r.step ? `baking · ${r.step}` : 'baking'
    case 'done':
      return 'ready'
    case 'failed':
      return 'did not bake: we are on it'
    case 'cancelled':
      return 'cancelled'
    default:
      return r.rid == null ? 'sent' : 'in the queue'
  }
}
