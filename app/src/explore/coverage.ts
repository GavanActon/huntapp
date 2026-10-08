import type { LayerSpecification, Map as MlMap, SourceSpecification } from 'maplibre-gl'
import type { Requested } from './store'

/**
 * The coverage index on the map (pipeline/coverage.py → coverage-ca.pmtiles
 * under data/explore/): 1° blocks zoomed out, the 11 km tiles from z6,
 * coloured by what each can have, and the tile picked or asked for by
 * feature state.
 */
export const COVERAGE_KEY = 'coverage'
export const COVERAGE_FILE = 'coverage-ca.pmtiles'
export const COVERAGE_SOURCE = 'coverage'
export const COVERAGE_TILES_LAYER = 'coverage-tiles'
const BLOCKS_MAX = 6.5

// the palette: sage for ground that can have HD, grey for SD only, gold
// and blue for what is baked, copper for what is asked for
const GREY = 'rgba(154,163,154,0.22)'
const SAGE = 'rgba(143,174,107,0.30)'
const SAGE_DEEP = 'rgba(120,160,80,0.42)'
const GOLD = 'rgba(217,179,74,0.55)'
const BLUE = 'rgba(95,168,211,0.5)'
const COPPER = 'rgba(214,122,60,0.6)'
const LINE = 'rgba(238,245,234,0.28)'
const PICK = '#eef5ea'

export function coverageSource(): SourceSpecification {
  return { type: 'vector', url: `pmtiles://${COVERAGE_KEY}`, promoteId: { tiles: 'id' } }
}

export function coverageLayers(): LayerSpecification[] {
  return [
    {
      id: 'coverage-blocks',
      type: 'fill',
      source: COVERAGE_SOURCE,
      'source-layer': 'blocks',
      maxzoom: BLOCKS_MAX,
      paint: {
        // the share of the block's tiles with 1 m LiDAR, grey to sage
        'fill-color': ['interpolate', ['linear'], ['coalesce', ['get', 'lidar'], 0], 0, GREY, 1, SAGE_DEEP],
        'fill-outline-color': 'rgba(0,0,0,0)',
      },
    },
    {
      id: COVERAGE_TILES_LAYER,
      type: 'fill',
      source: COVERAGE_SOURCE,
      'source-layer': 'tiles',
      minzoom: BLOCKS_MAX,
      paint: {
        'fill-color': [
          'case',
          ['boolean', ['feature-state', 'requested'], false],
          COPPER,
          ['==', ['get', 'baked'], 'hd'],
          GOLD,
          ['==', ['get', 'baked'], 'sd'],
          BLUE,
          ['>=', ['coalesce', ['get', 'grade'], 1], 3],
          SAGE_DEEP,
          ['>=', ['coalesce', ['get', 'grade'], 1], 2],
          SAGE,
          GREY,
        ],
        'fill-outline-color': 'rgba(0,0,0,0)',
      },
    },
    {
      id: 'coverage-lines',
      type: 'line',
      source: COVERAGE_SOURCE,
      'source-layer': 'tiles',
      minzoom: 8.5,
      paint: {
        'line-color': ['case', ['boolean', ['feature-state', 'picked'], false], PICK, LINE],
        'line-width': ['case', ['boolean', ['feature-state', 'picked'], false], 2.5, 0.6],
      },
    },
  ]
}

/** The picked and the asked-for tiles, as feature state on the tiles layer. */
export function syncCoverageState(m: MlMap, pickedId: string | null, requested: Record<string, Requested>, was: { picked: string | null; requested: string[] }): { picked: string | null; requested: string[] } {
  if (!m.getSource(COVERAGE_SOURCE)) return was
  const set = (id: string, state: Record<string, boolean>) => m.setFeatureState({ source: COVERAGE_SOURCE, sourceLayer: 'tiles', id }, state)
  if (was.picked && was.picked !== pickedId) set(was.picked, { picked: false })
  if (pickedId) set(pickedId, { picked: true })
  const ids = Object.keys(requested)
  for (const id of was.requested) if (!(id in requested)) set(id, { requested: false })
  for (const id of ids) set(id, { requested: true })
  return { picked: pickedId, requested: ids }
}
