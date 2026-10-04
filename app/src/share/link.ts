/**
 * The app's own links (docs/AREAS.md, Links and sharing):
 *
 *   an area:             <base>?area=lac-bailey
 *   a spot:              <base>?area=lac-bailey#at=49.40955,-69.55349&pin=Mat%27s+stand
 *   a point in no area:  <base>#at=49.60000,-70.20000
 *
 * The area rides in the query, where index.html's head script reads it
 * before any of the app loads (an iPhone's manifest is picked there). The
 * spot rides in the fragment, which no server and no link preview ever
 * sees. Reading is lenient: at, pin and z from the fragment or the query,
 * the area from either, and a bad id or a point off the globe is left out.
 *
 * Pure, with no imports: node checks it (scripts/check-links.mts).
 */

export interface LonLat {
  lon: number
  lat: number
}

/** What an address of the app asks for. */
export interface LinkParts {
  area?: string
  at?: LonLat
  /** read, never written: how close the reader looks is theirs */
  z?: number
  /** the spot's name, as the pin field would hold it */
  pin?: string
  /** an iPhone install's seed (its manifest's start_url): its area, only while nothing is saved */
  start?: string
}

/** An area's id, as the area files have them. */
const ID = /^[a-z0-9-]{1,40}$/

/** The pin field's maxlength (map/placePopup.ts). */
const NAME_MAX = 40

function readAt(v: string | null): LonLat | undefined {
  if (!v) return undefined
  const m = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(v)
  if (!m) return undefined
  const lat = Number(m[1])
  const lon = Number(m[2])
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lon, lat } : undefined
}

/** A name as a pin holds it: no control characters, single spaces, at most
 *  the field's 40, and never half an emoji at the cut. */
function cleanName(v: string | null | undefined): string | undefined {
  const s = (v ?? '')
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX)
    .replace(/[\ud800-\udbff]$/, '')
    .trim()
  return s || undefined
}

/** What an address of the app asks for: the area from the query, the spot
 *  from the fragment (or the query, for a link made by hand). */
export function readLink(href: string): LinkParts {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return {}
  }
  const q = url.searchParams
  const h = new URLSearchParams(url.hash.replace(/^#/, ''))
  const pick = (k: string) => h.get(k) ?? q.get(k)
  const out: LinkParts = {}
  const area = q.get('area') ?? h.get('area')
  if (area && ID.test(area)) out.area = area
  const start = q.get('start')
  if (start && ID.test(start)) out.start = start
  const at = readAt(pick('at'))
  if (at) {
    out.at = at
    const z = Number(pick('z'))
    if (Number.isFinite(z) && z >= 7 && z <= 18) out.z = z
    const pin = cleanName(pick('pin'))
    if (pin) out.pin = pin
  }
  return out
}

const f5 = (n: number) => n.toFixed(5)

/** An area's link: it opens on the reader's own last view there, else the area's home. */
export function areaLink(base: string, areaId: string): string {
  const u = new URL(base)
  u.search = new URLSearchParams({ area: areaId }).toString()
  u.hash = ''
  return u.toString()
}

/** A spot's link: the area in the query, the point and its name in the fragment. */
export function spotLink(base: string, s: LonLat & { area?: string | null; name?: string | null; z?: number }): string {
  const u = new URL(base)
  u.search = s.area ? new URLSearchParams({ area: s.area }).toString() : ''
  const h = new URLSearchParams()
  h.set('at', `${f5(s.lat)},${f5(s.lon)}`)
  if (s.z != null) h.set('z', String(Math.round(s.z)))
  const name = cleanName(s.name)
  if (name) h.set('pin', name)
  // URLSearchParams writes a comma as %2C: put it back, it reads better and
  // every link finder in a message keeps it as part of the link
  u.hash = h.toString().replace(/%2C/g, ',')
  return u.toString()
}

/** "49.40955, -69.55349": lat, lon to five places, as Copy coordinates writes them. */
export function coordWords(p: LonLat): string {
  return `${f5(p.lat)}, ${f5(p.lon)}`
}

/** A Google Maps link to the point: the Maps app on either phone when it is there, the web page when not. */
export function mapsLink(p: LonLat): string {
  return `https://maps.google.com/?q=${f5(p.lat)},${f5(p.lon)}`
}

/** What a shared spot says: its name and area, the coordinates anyone (and
 *  any maps app's search box) can read, and a Maps link. The app's own link
 *  goes as the share's url: last, on its own line. */
export function spotMessage(p: LonLat & { name?: string | null; areaName?: string | null }): { title: string; text: string } {
  // a place named for its area (the lake Lac Bailey) says it once
  const head = [p.name, p.areaName].filter((w, i, all) => w && all.indexOf(w) === i).join(' · ') || 'Spot'
  return {
    title: p.name || p.areaName || 'Spot',
    text: `${head}\n${coordWords(p)}\n${mapsLink(p)}\n`,
  }
}

/** What a shared area says; its link goes as the share's url. */
export function areaMessage(areaName: string): { title: string; text: string } {
  return { title: areaName, text: `${areaName} on the hunt map\n` }
}
