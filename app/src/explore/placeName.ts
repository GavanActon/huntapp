/**
 * A name for a spot the hunter loads, picked from what is there (Gavan,
 * 2026-10-20: "ideally you're smart about the location and calling it by
 * something appropriate to start"): NRCan's geographical names round the
 * box's middle (the service Where to searches, explore/WhereTo.tsx), the
 * nearest lake first, else the nearest place, river or hill, never a
 * township's lot number. Null with no signal, nothing named near, or no
 * answer in time: the spot is named by the caller then, and can be renamed
 * in Locations.
 */

const NAMES = 'https://geogratis.gc.ca/services/geoname/en/geonames.json'
/** how far round the middle a name may be, km */
const RADIUS_KM = 8
/** how long the service is given: asked when the box goes down (explore/BoxCard.tsx), so a Load
 *  rarely waits on it; a busy page (the tiles coming in) took past 2.5 s on hunt-dev */
const WAIT_MS = 6000
/** the kinds of feature a spot is named after, best first (CGNDB concise codes) */
const KINDS = ['LAKE', 'BAY', 'RIV', 'UNP', 'VILG', 'TOWN', 'CITY', 'HILL', 'MTN', 'ISL', 'MRSH']

interface Item {
  name?: string
  latitude?: number
  longitude?: number
  concise?: { code?: string } | string
}

const kindOf = (it: Item) => (typeof it.concise === 'string' ? it.concise : it.concise?.code) ?? ''

export async function placeName(lon: number, lat: number): Promise<string | null> {
  if (!navigator.onLine) return null
  const ctl = new AbortController()
  const timer = window.setTimeout(() => ctl.abort(), WAIT_MS)
  try {
    const q = new URLSearchParams({ lat: lat.toFixed(5), lon: lon.toFixed(5), radius: String(RADIUS_KM), num: '40' })
    const r = await fetch(`${NAMES}?${q}`, { signal: ctl.signal })
    if (!r.ok) return null
    const j = (await r.json()) as { items?: Item[] } | Item[]
    const items = (Array.isArray(j) ? j : (j.items ?? [])).filter((it) => it.name && it.latitude != null && it.longitude != null && KINDS.includes(kindOf(it)))
    const far = (it: Item) => Math.hypot((it.longitude! - lon) * Math.cos((lat * Math.PI) / 180), it.latitude! - lat)
    // the best kind there is, the nearest of it
    for (const k of KINDS) {
      const of = items.filter((it) => kindOf(it) === k).sort((a, b) => far(a) - far(b))
      if (of.length) return of[0].name!.slice(0, 60)
    }
    return null
  } catch {
    return null
  } finally {
    window.clearTimeout(timer)
  }
}
