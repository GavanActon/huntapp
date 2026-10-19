import { DATA_FILES, FINE_RELIEF_WORD, GEO_THEMES, GRADE, SD_HIDDEN, ZONE } from '../config'
import { sourceModes } from '../map/pmtilesRegistry'
import { geoModes } from '../map/MapView'
import { LIVE_RASTER, LIVE_VECTOR } from '../sources'
import type { LayerOpacity, LayerVisibility } from '../state/appStore'

/**
 * The map's layers as the editors name them, in four groups, and where each
 * one's data is: the layers sheet (sheets/LayersSheet.tsx) and the views'
 * explorer and maker (sheets/ViewsSheet.tsx, sheets/MakeViewSheet.tsx),
 * which leave out what an area has none of.
 */

export interface LayerDef {
  key: keyof LayerVisibility
  name: string
  opacity?: keyof LayerOpacity
  /** the pmtiles key this layer is baked into, for the status word */
  data?: string
  live?: keyof typeof LIVE_RASTER | keyof typeof LIVE_VECTOR
  /** drawn from the forecast on the phone, nothing baked or streamed (the wind's colours) */
  forecast?: boolean
}

export const GROUPS: { title: string; defs: LayerDef[] }[] = [
  {
    title: 'Terrain',
    defs: [
      { key: 'topo', name: 'Topographic', opacity: 'topo', data: 'topo', live: 'topo' },
      { key: 'hillshade', name: 'Hillshade', opacity: 'hillshade', data: 'hillshade', live: 'hillshade' },
      { key: 'relief', name: 'Elevation colours', opacity: 'relief', data: 'dem' },
      // the fine contours where HD baked them and the map shows them; else the 30 m ones, which the same switch draws
      ...(GRADE === 'hd' && DATA_FILES.some((f) => f.key === 'contours')
        ? [{ key: 'contours' as const, name: `${FINE_RELIEF_WORD} contours`, data: 'contours' }]
        : [{ key: 'contours' as const, name: 'Contours', data: 'contoursWide' }]),
      { key: 'satellite', name: 'Imagery', opacity: 'satellite', data: 'satellite', live: 'satellite' },
    ],
  },
  {
    title: 'Bush & water',
    defs: [
      { key: 'forest', name: 'Forest cover', opacity: 'forest', data: 'forest' },
      { key: 'understory', name: 'Bush thickness', opacity: 'understory', data: 'understory' },
      { key: 'lanes', name: 'Shooting lanes', opacity: 'lanes', data: 'lanes' },
      { key: 'fire', name: 'Burns', data: 'places', live: 'fire' },
      { key: 'bathy', name: 'Lake depths', data: 'bathySheets', live: 'bathy' },
    ],
  },
  {
    title: 'Land',
    defs: [
      { key: 'camps', name: 'Camps', data: 'places', live: 'camps' },
      // the zone's word is the area's: WMU boundaries in Ontario, Zone boundaries in Quebec
      { key: 'wmu', name: `${ZONE.label} boundaries`, data: 'places', live: 'wmu' },
      // whose land: the property step's classes and lots where baked (map/landClasses.ts), else the old private land
      { key: 'crown', name: GEO_THEMES.includes('land') ? 'Property lines' : 'Private land', data: 'places', live: 'crown' },
      { key: 'parks', name: 'Parks', data: 'places', live: 'parks' },
      { key: 'roads', name: 'Bush roads', data: 'places' },
    ],
  },
  {
    title: 'Wind, radar & other maps',
    defs: [
      { key: 'windColours', name: 'Wind colours', forecast: true },
      { key: 'weather', name: 'Radar', live: 'radar' },
      { key: 'historical', name: 'Old map', opacity: 'historical', data: 'historical', live: 'historical' },
      { key: 'toposheet', name: 'Canada map', live: 'toposheet' },
    ],
  },
]

export const DEFS: Record<string, LayerDef> = Object.fromEntries(GROUPS.flatMap((g) => g.defs).map((d) => [d.key, d]))

export function status(d: LayerDef): string {
  if (d.forecast) return 'forecast'
  // the places archive holds only the themes the area has (files.geo; Lac
  // Bailey has no camps or private land, LIO's): its being there says
  // nothing of the rest
  const absent = d.data === 'places' && !(GEO_THEMES as readonly string[]).includes(d.key)
  const pm = d.data && !absent ? sourceModes.get(d.data) : undefined
  const mode = pm && pm !== 'missing' ? pm : geoModes.get(d.key)
  // an HD area shown as SD: HD's own layers are left out of the map
  if (d.data && SD_HIDDEN.includes(d.data)) return 'with HD'
  if (mode === 'local') return 'on this phone'
  if (mode === 'network') return 'baked · online'
  if (d.live && (d.live in LIVE_RASTER || d.live in LIVE_VECTOR)) return 'live'
  return 'not built yet'
}

/** The layer has something to draw here: baked, streamed or live, and not held back for HD. */
export function layerHere(key: keyof LayerVisibility): boolean {
  const d = DEFS[key]
  if (!d) return true
  const s = status(d)
  return s !== 'not built yet' && s !== 'with HD'
}
