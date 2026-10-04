/**
 * The fields of an area file (src/areas/<id>.json) the app reads, checked
 * as they are read: the app leaves out a file that fails (areas/index.ts),
 * since as the saved area it would stop the app on every start with no way
 * back to another, and the build stops on one (vite.config.ts), so a bad
 * bake or hand edit never reaches a phone. No imports: the build loads it.
 */

type Fields = Record<string, unknown>

const obj = (v: unknown): Fields | undefined => (v != null && typeof v === 'object' && !Array.isArray(v) ? (v as Fields) : undefined)
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v)
const isStr = (v: unknown) => typeof v === 'string'
const isBox = (v: unknown) => {
  const b = obj(v)
  return b != null && isNum(b.west) && isNum(b.south) && isNum(b.east) && isNum(b.north)
}

/** The first field the app reads that an area file lacks or holds as the
 *  wrong kind, by its path ('core.maxzoom'); null when all are there. */
export function badAreaField(v: unknown): string | null {
  const a = obj(v)
  if (!a) return 'the whole file'
  const home = obj(a.home)
  const core = obj(a.core)
  const zone = obj(a.zone)
  const attribution = obj(a.attribution)
  const files = obj(a.files)
  const contours = obj(a.contours)
  const center = arr(home?.center)
  const relief = arr(a.relief)
  const presets = arr(a.presets)
  const fields: [string, boolean][] = [
    ['id', isStr(a.id)],
    ['name', isStr(a.name)],
    ['base', isStr(a.base)],
    ['timezone', isStr(a.timezone)],
    ['jurisdiction', isStr(a.jurisdiction)],
    ['home.center', isNum(center[0]) && isNum(center[1])],
    ['home.zoom', isNum(home?.zoom)],
    ['region', isBox(a.region)],
    ['core', isBox(a.core)],
    ['core.maxzoom', isNum(core?.maxzoom)],
    ['regionMaxzoom', isNum(a.regionMaxzoom)],
    ['declination', isNum(a.declination)],
    ['zone', isStr(zone?.label) && isStr(zone?.name)],
    ['relief', isNum(relief[0]) && isNum(relief[1])],
    ['live.lio', typeof obj(a.live)?.lio === 'boolean'],
    ['attribution', isStr(attribution?.vectors) && isStr(attribution?.lakes) && isStr(attribution?.bush)],
    [
      'presets',
      presets.length > 0 &&
        presets.every((p) => {
          const q = obj(p)
          return q != null && isStr(q.name) && isNum(q.lon) && isNum(q.lat)
        }),
    ],
    ['bundle.description', isStr(obj(a.bundle)?.description)],
    ['surveyedLakes', Array.isArray(a.surveyedLakes)],
    ['files', files != null && [files.pmtiles, files.geo, files.baseGeo, files.grids].every(Array.isArray)],
    // optional; when there, the zoom is a number (map/mapStyle.ts contourFilters)
    ['contours.fineFrom', a.contours == null || (contours != null && (contours.fineFrom == null || isNum(contours.fineFrom)))],
  ]
  return fields.find(([, ok]) => !ok)?.[0] ?? null
}
