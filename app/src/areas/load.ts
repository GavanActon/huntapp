import { devlog } from '../devlog'
import { boxId, type Box } from '../explore/box'
import { addLoadedArea } from './index'
import { dropLocation, keepLocation } from './runtime'
import { switchArea } from './switch'

/**
 * Load this spot (Gavan, 2026-10-20: "an intentional load which brings in
 * the hrdps wind etc."): the box becomes a location kept on the phone
 * (areas/runtime.ts) and the app goes there, as to any area: a reload into
 * ?area=b-…, where the forecast over the box and the SD tiles' wind come
 * in. `replaces` (a location moved or grown): the old one goes once the new
 * one is kept. False when the switch did not go (a download running, a "no" asked).
 */
export function loadLocation(box: Box, name: string, jurisdiction: string, replaces?: string): boolean {
  const l = { id: boxId(box), name: name.trim().slice(0, 60) || 'Spot', jurisdiction, at: Date.now() }
  const a = addLoadedArea(l)
  if (!a) return false
  keepLocation(l)
  if (replaces && replaces !== l.id) dropLocation(replaces)
  devlog('area', `load ${l.id} · ${l.name} · ${jurisdiction}`)
  return switchArea(a.id, { center: a.home.center, zoom: a.home.zoom })
}
