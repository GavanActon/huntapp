import { track } from '../analytics'
import { areaAt, type AreaDef } from '../areas'
import { DROPPED_NAME } from '../map/placePopup'
import { areaLink, areaMessage, spotLink, spotMessage, type LonLat } from './link'

/**
 * Sending a spot or an area to someone (docs/AREAS.md, Links and sharing):
 * the phone's share sheet when it has one, else the clipboard. A share is
 * text and a link: the name, the coordinates anyone can read and a Maps
 * link in the text (what survives a satellite message), the app's own link
 * as the url.
 */

/** Where the app's links point: the deployed site, never this page's own
 *  address (a share from the dev server would send a LAN address).
 *  VITE_SHARE_BASE for a build that wants its own. */
export const SHARE_BASE: string = import.meta.env.VITE_SHARE_BASE ?? 'https://hunt.groundwind.app/'

export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'failed'

/** The whole message to the clipboard: the text ends on a line break, so the link has a line of its own. */
function copy(m: { text: string; url: string }): Promise<ShareResult> {
  if (!navigator.clipboard?.writeText) return Promise.resolve('failed')
  return navigator.clipboard.writeText(m.text + m.url).then(
    () => 'copied',
    () => 'failed',
  )
}

/**
 * Share, or copy where the phone cannot. Call it inside the tap, with
 * nothing awaited before it: iOS refuses a share that is not. A cancel is
 * 'cancelled' and does nothing more; any other refusal copies instead.
 * 'copied' only once the clipboard has taken it.
 */
export function shareOrCopy(m: { title: string; text: string; url: string }): Promise<ShareResult> {
  if (typeof navigator.share !== 'function' || navigator.canShare?.(m) === false) return copy(m)
  return navigator.share(m).then(
    (): ShareResult => 'shared',
    (e: unknown) => ((e as { name?: string } | null)?.name === 'AbortError' ? 'cancelled' : copy(m)),
  )
}

/** Share a spot: a pin, a preset, a tapped point. A name still Pin, or none, goes unnamed. */
export function shareSpot(s: LonLat & { name?: string | null }): Promise<ShareResult> {
  const name = s.name && s.name !== DROPPED_NAME ? s.name : null
  const area = areaAt(s.lon, s.lat)
  const msg = spotMessage({ lon: s.lon, lat: s.lat, name, areaName: area?.name })
  return shareOrCopy({ ...msg, url: spotLink(SHARE_BASE, { lon: s.lon, lat: s.lat, area: area?.id, name }) }).then((r) => {
    track('share', { what: 'spot', result: r, named: !!name })
    return r
  })
}

/** Share an area: the link opens on the reader's own last view there, else its home. */
export function shareArea(a: AreaDef): Promise<ShareResult> {
  return shareOrCopy({ ...areaMessage(a.name), url: areaLink(SHARE_BASE, a.id) }).then((r) => {
    track('share', { what: 'area', result: r, area: a.id })
    return r
  })
}
