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
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
/** 'MM-DD', a day every year has (not 29 February) */
const isDay = (v: unknown) => {
  const m = typeof v === 'string' ? /^(\d\d)-(\d\d)$/.exec(v) : null
  return m != null && +m[1] >= 1 && +m[1] <= 12 && +m[2] >= 1 && +m[2] <= MONTH_DAYS[+m[1] - 1]
}
/** The leaves' four days, each a day and each after the one before: out,
 *  full, falling, bare (weather/micro/leaves.ts ramps between them). */
const isLeaves = (v: Fields) => {
  const days = [v.springStart, v.springFull, v.fallStart, v.fallBare]
  // zero-padded, so the strings sort as the days do
  return days.every(isDay) && days.every((d, k) => k === 0 || (days[k - 1] as string) < (d as string))
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
  const leaves = obj(a.leaves)
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
    // optional; when there, the fine relief's name and credit (ArcticDEM areas)
    ['fineRelief', a.fineRelief == null || (obj(a.fineRelief) != null && isStr(obj(a.fineRelief)?.name) && isStr(obj(a.fineRelief)?.attribution))],
    // optional; when there, the area's own four days for the leaves
    ['leaves', a.leaves == null || (leaves != null && isLeaves(leaves))],
  ]
  return fields.find(([, ok]) => !ok)?.[0] ?? null
}
