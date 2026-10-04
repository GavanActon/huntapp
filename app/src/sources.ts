/**
 * Live (online) map services, one entry per layer, used whenever the baked
 * PMTiles for that layer is not on the phone or the server. Every URL here
 * is something MapLibre can fetch directly (an XYZ tile cache, a WMS GetMap
 * with `{bbox-epsg-3857}`, or an ArcGIS query returning GeoJSON), all
 * CORS-open, no keys. All were fetched successfully on 2026-09-25 from the
 * region; see docs/DATA-SOURCES.md for what each one is and its licence.
 *
 * The national services serve any area. LIO's are Ontario's and have
 * nothing past its border, so they stand in only for an Ontario area
 * (LIVE.lio); the imagery is the province's own (LIVE.satellite).
 */
import { LIVE, REGION } from './config'

export interface LiveRaster {
  tiles: string[]
  tileSize: 256 | 512
  attribution: string
  minzoom?: number
  maxzoom?: number
  scheme?: 'xyz' | 'tms'
}

export interface LiveVector {
  /** A GeoJSON URL. */
  url: string
  attribution: string
}

function wms(base: string, layers: string, opts: { format?: string; styles?: string; extra?: Record<string, string> } = {}) {
  const q = new URLSearchParams({
    SERVICE: 'WMS',
    VERSION: '1.3.0',
    REQUEST: 'GetMap',
    LAYERS: layers,
    STYLES: opts.styles ?? '',
    FORMAT: opts.format ?? 'image/png',
    TRANSPARENT: 'true',
    WIDTH: '256',
    HEIGHT: '256',
    CRS: 'EPSG:3857',
    ...(opts.extra ?? {}),
  })
  return `${base}?${q.toString()}&BBOX={bbox-epsg-3857}`
}

const LIO = 'https://ws.lioservices.lrc.gov.on.ca/arcgis2/rest/services'
const LIO_OPEN = `${LIO}/LIO_OPEN_DATA`

/** An ArcGIS REST layer query for the whole region as GeoJSON (WGS84).
 *  Layers with more features than the server's page size need the
 *  pipeline; the ones wired here are all well under it for this region. */
function lioQuery(service: string, layer: number, where = '1=1', outFields = '*'): string {
  const q = new URLSearchParams({
    where,
    geometry: `${REGION.west},${REGION.south},${REGION.east},${REGION.north}`,
    geometryType: 'esriGeometryEnvelope',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields,
    outSR: '4326',
    f: 'geojson',
  })
  return `${LIO_OPEN}/${service}/MapServer/${layer}/query?${q.toString()}`
}

/** The imagery when none is baked, by province. */
const SATELLITE: Record<'lio' | 'qc', LiveRaster> = {
  // Ontario Imagery Web Map Service: the province's orthophoto mosaic,
  // cached in Web Mercator; newer and sharper than Esri here.
  lio: {
    tiles: [`${LIO}/LIO_Imagery/Ontario_Imagery_Web_Map_Service/MapServer/tile/{z}/{y}/{x}`],
    tileSize: 256,
    attribution: 'Imagery © Ontario Ministry of Natural Resources',
    maxzoom: 18,
  },
  // Quebec's continuous imagery (Imagerie_GQ), its newest flights mosaicked,
  // as WMTS tiles in Web Mercator; CORS-open (checked 2026-10-03).
  qc: {
    tiles: ['https://servicesmatriciels.mern.gouv.qc.ca/erdas-iws/ogc/wmts/Imagerie_Continue/Imagerie_GQ/default/GoogleMapsCompatibleExt2:epsg:3857/{z}/{y}/{x}.jpg'],
    tileSize: 256,
    attribution: '© Gouvernement du Québec',
    maxzoom: 18,
  },
}

export const LIVE_RASTER: Partial<Record<'base' | 'satellite' | 'topo' | 'hillshade' | 'historical' | 'forest' | 'radar', LiveRaster>> = {
  // Base map when no basemap PMTiles is on hand: NRCan's Canada Base Map
  // (transportation), a cached Web Mercator tile service.
  base: {
    tiles: ['https://maps-cartes.services.geo.ca/server2_serveur2/rest/services/BaseMaps/CBMT_CBCT_GEOM_3857/MapServer/tile/{z}/{y}/{x}'],
    tileSize: 256,
    attribution: 'Canada Base Map © Natural Resources Canada',
    maxzoom: 17,
  },
  // the province's imagery; an area with none is left with what is baked
  ...(LIVE.satellite ? { satellite: SATELLITE[LIVE.satellite] } : null),
  // NRCan Toporama, hypsography only: contour lines and spot elevations on
  // a transparent ground, so they sit over the hillshade and imagery without
  // the CanTopo land colouring washing everything out.
  topo: {
    tiles: [wms('https://maps.geogratis.gc.ca/wms/toporama_en', 'hypsography')],
    tileSize: 256,
    attribution: 'Toporama © Natural Resources Canada',
    maxzoom: 17,
  },
  // NRCan MRDEM 30 m hillshade, live. The baked layer replaces it with the
  // 1 m single-photon LiDAR hillshade (HRDEM ON-SPL White Lake 2021).
  hillshade: {
    tiles: [wms('https://datacube.services.geo.ca/ows/mrdem', 'dtm-hillshade')],
    tileSize: 256,
    attribution: 'MRDEM © Natural Resources Canada',
    maxzoom: 16,
  },
  // ECCC GeoMet radar, rain rate at 1 km; no TIME = the latest sweep.
  radar: {
    tiles: [wms('https://geo.weather.gc.ca/geomet', 'RADAR_1KM_RRAI')],
    tileSize: 256,
    attribution: 'Radar © Environment and Climate Change Canada',
    maxzoom: 12,
  },
}

/** The LIO queries, for an Ontario area. */
const lioVectors = (): Partial<Record<'wmu' | 'camps' | 'crown' | 'bathy' | 'parks' | 'fire', LiveVector>> => ({
  // Wildlife Management Units (the region is 21A / 21B and neighbours)
  wmu: { url: lioQuery('LIO_Open05', 5, '1=1', 'OFFICIAL_NAME'), attribution: '© Ontario MNRF' },
  // Crown land dispositions that are camps: land use permits for outpost
  // camps, private recreation camps, campgrounds. 40 in the region.
  camps: {
    url: lioQuery(
      'LIO_Open08',
      33,
      "PURPOSE_OF_DISPOSITION LIKE '%Camp%' OR PURPOSE_OF_DISPOSITION LIKE '%Cottage%' OR PURPOSE_OF_DISPOSITION LIKE '%Lodge%'",
      'CLASS_SUBTYPE,PURPOSE_OF_DISPOSITION,SITE_NAME,LOCATION_DESCR,AREA_IN_HA',
    ),
    attribution: '© Ontario MNRF',
  },
  // Patented (private) land; everything else in the bush is Crown.
  crown: { url: lioQuery('LIO_Open08', 35, '1=1', 'TITLE_HOLDER_TYPE,CROWN_RESERVATION_TYPE'), attribution: '© Ontario MNRF' },
  parks: { url: lioQuery('LIO_Open03', 4, '1=1', 'PROTECTED_AREA_NAME_ENG,PROVINCIAL_PARK_CLASS_ENG'), attribution: '© Ontario Parks' },
  // Lake depth contours digitised from MNR lake surveys (529 lines here,
  // mostly White Lake 1972). Bush roads (9,400 segments) exceed the page
  // size and come only from the pipeline.
  bathy: { url: lioQuery('LIO_Open01', 30, '1=1', 'DEPTH,SURVEY_DATE'), attribution: 'Bathymetry © Ontario MNRF' },
  // Fire perimeters, for the burns that make moose country.
  fire: { url: lioQuery('LIO_Open09', 28, '1=1', 'FIRE_YEAR,FIRE_TYPE_CODE,FIRE_FINAL_SIZE'), attribution: '© Ontario MNRF' },
})

/** Vector themes live when not baked: LIO's, in Ontario; nothing elsewhere
 *  (Quebec's servers refuse a browser, so its themes are baked). */
export const LIVE_VECTOR: Partial<Record<'wmu' | 'camps' | 'crown' | 'bathy' | 'parks' | 'fire', LiveVector>> = LIVE.lio ? lioVectors() : {}
