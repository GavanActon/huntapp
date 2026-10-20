import { API } from '../analytics'
import { devlog } from '../devlog'
import { useAppStore } from '../state/appStore'
import { useExplore, type Requested } from './store'

/**
 * How this phone's asks are getting on (Gavan, 2026-10-20: "the request a
 * location -> executing it"): the queue's word on each (the Worker's GET
 * /api/request?id=, the stage the bake agent last reported: queued,
 * claimed, baking with its step, done with the area it became, failed),
 * asked when the app opens and every few minutes while it is looked at
 * with signal, until the ask is done with. The Locations sheet shows it.
 */

const EVERY_MS = 3 * 60_000
/** stages past which the queue has nothing more to say */
const SETTLED = new Set(['done', 'failed', 'cancelled'])

const open = (r: Requested) => r.rid != null && !SETTLED.has(r.stage ?? '')

async function ask(id: string, r: Requested): Promise<void> {
  try {
    const res = await fetch(`${API}/api/request?id=${r.rid}`, { cache: 'no-store' })
    if (!res.ok) return
    const j = (await res.json()) as { stage?: string | null; step?: string | null; area_id?: string | null; error?: string | null }
    const stage = j.stage ?? 'queued'
    if (stage !== r.stage || (j.step ?? null) !== (r.step ?? null)) devlog('explore', `ask ${r.rid} · ${stage}${j.step ? ` · ${j.step}` : ''}`)
    useExplore.getState().setStatus(id, { stage, step: j.step ?? null, areaId: j.area_id ?? null, error: j.error ?? null, checked: Date.now() })
  } catch {
    /* no signal or the queue down: asked again next time */
  }
}

/** Ask the queue about every open ask now. */
export function checkAsks(): void {
  if (!useAppStore.getState().online) return
  for (const [id, r] of Object.entries(useExplore.getState().requested)) if (open(r)) void ask(id, r)
}

let started = false
/** From the app's start (App.tsx): now, then every few minutes while looked at. */
export function startAskChecks(): void {
  if (started) return
  started = true
  checkAsks()
  window.setInterval(() => {
    if (document.visibilityState === 'visible') checkAsks()
  }, EVERY_MS)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkAsks()
  })
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
