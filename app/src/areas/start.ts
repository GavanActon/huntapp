import { readLink, type LonLat } from '../share/link.ts'

/**
 * Which area the app opens on, and what the address and a link ask for
 * once it is there: one decision, made before anything reads config.ts.
 * areas/index.ts reads the phone's storage and the address, hands them in,
 * and does what comes back (the saves, the address, the arrival). Pure, so
 * node checks it (scripts/check-links.mts); the extension on the import is
 * for node too.
 *
 * The area, first match wins: the one whose region holds the link's spot;
 * the link's own area; the one saved on the phone; an iPhone install's seed
 * (?start=, only while nothing is saved); Pickle Lake. Nothing asks: a link
 * is the user's own choice, so its area is saved as it opens, as a switch's
 * would be (not on a reload or a back of it).
 */

export interface Box {
  west: number
  south: number
  east: number
  north: number
}

export interface StartIn {
  href: string
  /** localStorage 'huntapp-area' */
  saved: string | null
  /** every area the app knows, in the build's order */
  areas: readonly { id: string; region: Box }[]
  defaultId: string
  /** sessionStorage: the last link this tab showed (linkMark) */
  done: string | null
  /** sessionStorage could be read. Without it no mark is kept, and a reload
   *  or a back stands in for one */
  sessionOk: boolean
  /** the page load's navigation type, when there is one */
  navType?: string
}

export interface StartOut {
  areaId: string
  /** save areaId as the phone's area */
  save: boolean
  /** the address to put in place (history.replaceState), or null to leave it as it is */
  href: string | null
  /** the spot to open on and show, once; inArea false for a point in no area */
  arrival: (LonLat & { name?: string; z: number; inArea: boolean }) | null
  /** the arrival's link, to remember as shown in this tab (sessionStorage)
   *  once it has been (areas/arrive.ts) */
  mark: string | null
}

/** How close a link's spot opens when it does not say. */
export const SPOT_ZOOM = 15

const inBox = (r: Box, p: LonLat) => p.lon >= r.west && p.lon <= r.east && p.lat >= r.south && p.lat <= r.north

/** A link as this tab remembers it: its point and its name. */
export function linkMark(at: LonLat, pin?: string): string {
  return `${at.lat.toFixed(5)},${at.lon.toFixed(5)}|${pin ?? ''}`
}

export function decideStart(i: StartIn): StartOut {
  const link = readLink(i.href)
  const known = (id: string | null | undefined) => (id != null && i.areas.some((a) => a.id === id) ? id : null)
  // the point decides the area; the link's area word only when the point is in none (or there is no point)
  const pointArea = link.at ? (i.areas.find((a) => inBox(a.region, link.at!))?.id ?? null) : null
  const linkArea = pointArea ?? known(link.area)
  // a reload, a back or a restored tab is the same page again, not a link
  // opened: a tab left on one would save its area back over a later switch
  // (on Android the installed app shares the storage, and opens there next)
  const fresh = i.navType !== 'reload' && i.navType !== 'back_forward'
  let areaId: string
  let save = false
  if (linkArea) {
    // the address still decides this tab's area: the download's and the
    // update's reloads stay put
    areaId = linkArea
    save = fresh
  } else if (known(i.saved)) {
    areaId = i.saved!
  } else if (known(link.start)) {
    // a fresh home-screen install: its icon's area, the once
    areaId = link.start!
    save = true
  } else {
    areaId = known(i.defaultId) ?? i.areas[0]?.id ?? i.defaultId
  }
  // once per tab and link: a reload, a back or a restored tab of a link this
  // tab has shown keeps the address, not the arrival (the map opens on where
  // it was last moved to). The mark is written once the spot is up
  // (areas/arrive.ts), so a load that never got that far (an old build the
  // update reloads, a first load stalled on weak signal) shows it on the
  // reload. With no storage for a mark, a reload or a back counts as shown
  let arrival: StartOut['arrival'] = null
  let mark: string | null = null
  if (link.at) {
    const sig = linkMark(link.at, link.pin)
    const again = sig === i.done || (!i.sessionOk && !fresh)
    if (!again) {
      arrival = { ...link.at, name: link.pin, z: link.z ?? SPOT_ZOOM, inArea: pointArea != null }
      mark = sig
    }
  }
  // the address names the area the app is in (any but Pickle Lake's, or
  // Pickle Lake's when the link named it), so a reload stays there and the
  // browser's Share carries it; the seed goes; the spot in the fragment
  // stays, for Share, Copy and Open in Safari
  let href: string | null = null
  try {
    const u = new URL(i.href)
    const q = u.searchParams
    const before = u.toString().replace(/%2C/g, ',')
    q.delete('start')
    if (areaId !== i.defaultId || q.get('area') === i.defaultId) q.set('area', areaId)
    else q.delete('area')
    u.search = q.toString()
    // a spot written in the query by hand stays where it came, comma and all
    const after = u.toString().replace(/%2C/g, ',')
    href = after !== before ? after : null
  } catch {
    href = null
  }
  return { areaId, save, href, arrival, mark }
}
