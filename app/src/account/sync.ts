import { API } from '../analytics'
import { forgetArea } from '../areas'
import { dropLocation, keepLocation, readLocations, REMOVED_KEY, setLocationPack, type Location } from '../areas/runtime'
import { devlog } from '../devlog'
import { fetchPacks } from '../explore/requests'
import { toast } from '../ui/Toast'
import { authHeaders, sessionLost, signedIn } from './session'

/**
 * A signed-in phone's locations follow the account (docs/REQUESTS.md, Accounts; site/account.js
 * /api/me/locations): the phone's list goes up, the account's comes back, merged. A location the
 * account has and the phone does not comes onto the phone (with its pack, whose area file
 * explore/requests.ts fetchPacks then fetches); the later name wins (`edited`); a pack the account
 * has reaches the phone; one removed on any phone goes from this one too, unless this phone loaded
 * it again since. Asked at the start, after signing in, and after a rename or a removal here.
 */

function readRemoved(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(REMOVED_KEY) ?? '[]') as unknown
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

function clearRemoved(sent: string[]): void {
  try {
    localStorage.setItem(REMOVED_KEY, JSON.stringify(readRemoved().filter((id) => !sent.includes(id))))
  } catch {
    /* sent again next time: harmless */
  }
}

interface Theirs {
  id: string
  name: string
  jurisdiction: string | null
  pack: string | null
  at: number
  edited: number
}

let inflight: Promise<{ added: number; removed: number } | null> | null = null

/** The phone's list and the account's merged. Null with no signal, no session, or a refusal;
 *  else how many came onto the phone and went off it (the area list is the start's: the added ones
 *  are in Locations from the next start, the removed ones gone at once). */
export function syncLocations(): Promise<{ added: number; removed: number } | null> {
  if (!signedIn() || !navigator.onLine) return Promise.resolve(null)
  if (inflight) return inflight
  inflight = (async () => {
    const mine = readLocations().map(({ def: _def, ...l }) => l)
    const removed = readRemoved()
    let res: Response
    try {
      res = await fetch(`${API}/api/me/locations`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ locations: mine, removed }),
      })
    } catch {
      return null
    }
    if (res.status === 401) {
      sessionLost()
      return null
    }
    if (!res.ok) return null
    const j = (await res.json().catch(() => null)) as { locations?: Theirs[]; removed?: string[] } | null
    if (!j || !Array.isArray(j.locations)) return null
    clearRemoved(removed)
    const here = new Map<string, Location>(readLocations().map((l) => [l.id, l]))
    let added = 0
    for (const t of j.locations) {
      const l = here.get(t.id)
      if (!l) {
        if (removed.includes(t.id)) continue
        keepLocation({ id: t.id, name: t.name, jurisdiction: t.jurisdiction ?? 'ON', at: t.at, edited: t.edited, ...(t.pack ? { pack: t.pack } : {}) })
        added++
        continue
      }
      if (t.edited > (l.edited ?? 0) && t.name !== l.name) keepLocation({ ...l, name: t.name, edited: t.edited })
      if (t.pack && !l.pack) setLocationPack(l.id, t.pack)
    }
    let gone = 0
    for (const id of j.removed ?? []) {
      if (!here.has(id)) continue
      dropLocation(id, false)
      forgetArea(id)
      gone++
    }
    if (added || gone) devlog('account', `locations · ${added} came, ${gone} went`)
    return { added, removed: gone }
  })().finally(() => {
    inflight = null
  })
  return inflight
}

let started = false
/** From the app's start (App.tsx), signed in: the lists merged, any pack that came fetched, and
 *  the locations from other phones offered (the area list is the start's: a reload shows them). */
export function startAccountSync(): void {
  if (started || !signedIn()) return
  started = true
  void syncLocations().then((r) => {
    if (!r) return
    void fetchPacks()
    if (r.added) toast(`${r.added} ${r.added === 1 ? 'location' : 'locations'} from your other phones`, 10_000, { label: 'Show', run: () => window.location.reload() })
  })
}
