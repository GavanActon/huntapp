import type { ExpressionSpecification, Map as MlMap } from 'maplibre-gl'
import { useAppStore } from '../state/appStore'
import { getMap, onEachMap } from './mapController'

/**
 * The map's own numbers in the phone's units (Gavan, 2026-10-17: "a full
 * unit pass on meters / ft"): the contours' heights and the surveyed
 * lakes' depths read in feet when the phone is imperial. The lines stay
 * where they were baked, a metric spacing, so a 5 m contour reads its
 * height in feet, not a round number. Set here on each map rather than in
 * the style's build, and again when the units change.
 */

const FT = 3.28084

/** Label layer → the feature's metres. */
const LAYERS: [string, string][] = [
  ['contour-label', 'elev'],
  ['contour-wide-label', 'elev'],
  ['bathy-label', 'DEPTH'],
]

function field(prop: string, imperial: boolean): ExpressionSpecification {
  return imperial ? ['to-string', ['round', ['*', ['to-number', ['get', prop]], FT]]] : ['to-string', ['get', prop]]
}

function apply(m: MlMap) {
  const imperial = useAppStore.getState().units === 'imperial'
  for (const [id, prop] of LAYERS) if (m.getLayer(id)) m.setLayoutProperty(id, 'text-field', field(prop, imperial))
}

onEachMap(apply)
useAppStore.subscribe((s, p) => {
  if (s.units === p.units) return
  const m = getMap()
  if (m) apply(m)
})
