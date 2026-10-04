import { readLink } from '../share/link.ts'

/**
 * A position typed or pasted in, in whatever shape it comes:
 *
 * - Garmin's decimal degrees, as an inReach message writes them:
 *   N 49.409550° W 69.553490°
 * - plain decimals, lat then lon: 49.40955, -69.55349 or 49.40955 -69.55349
 * - degrees and minutes: N49 24.573 W69 33.209
 * - degrees, minutes and seconds: 49°24'34.4"N 69°33'12.6"W (O for ouest too)
 * - a map link with the point in it: Google (q=, query=, the place's
 *   !3d…!4d…, @lat,lon), Apple (ll=, q=, coordinate=), OpenStreetMap
 *   (mlat=, #map=) and geo: links, and the app's own (at=, in the fragment:
 *   share/link.ts)
 * - a whole message with one of those in it: what a share sends (the name,
 *   the coordinates, a Maps link and the app's link), an inReach message,
 *   "Stand 2: 49.40955, -69.55349 ±5 m". Its links are read first, the
 *   app's own winning (it brings the area and the pin's name), then taken
 *   out, so a short link's digits never make a position
 *
 * Pure: no map and no app state, so it can be tried from node
 * (scripts/check-links.mts); the extension on the import is for node too.
 */

export interface LonLat {
  lon: number
  lat: number
}

/** How a position was written, so the read-out says it back the same way:
 *  signed decimals, decimals with N and W, degrees and minutes, or degrees,
 *  minutes and seconds. */
export type PlaceForm = 'dec' | 'nw' | 'dm' | 'dms'

/** A position read from text, with what came with it. */
export interface Place extends LonLat {
  /** the pin's name, from the app's own link */
  name?: string
  /** the area's id, from the app's own link */
  area?: string
  /** both axes to about 200 m or better: a number still being typed is not */
  complete: boolean
  form: PlaceForm
}

/** What a paste or a typed line holds: a place, the app's link to an area
 *  with no spot in it, or nothing. */
export type Parsed = Place | { area: string; lon?: undefined } | null

/** A number as written: its value and sign, how many decimals it had (how
 *  close it says it is), and where it sits in the text. */
type Num = { n: number; neg: boolean; dec: number; at: number; end: number }

/** A hemisphere letter or a number, with where it sits in the text. */
type Tok = { h: string; at: number; end: number } | Num

const isNum = (t: Tok): t is Num => 'n' in t

function point(lat: number, lon: number): LonLat | null {
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lon, lat } : null
}

/** An angle, unsigned: its value, how far off its last figure lets it be
 *  (0.001° for three decimals, 0.1′ for minutes to a tenth), and how many
 *  numbers it was written in (degrees; and minutes; and seconds). */
interface Angle {
  v: number
  err: number
  parts: number
}

/** Degrees, degrees and minutes, or degrees, minutes and seconds, as one
 *  unsigned number; null for anything that is not (minutes past 60, a
 *  fraction of a degree with minutes after it). */
function magnitude(nums: Num[]): Angle | null {
  if (nums.length < 1 || nums.length > 3) return null
  const [d, m = 0, s = 0] = nums.map((t) => Math.abs(t.n))
  if (m >= 60 || s >= 60) return null
  if (nums.length > 1 && !Number.isInteger(d)) return null
  if (nums.length > 2 && !Number.isInteger(m)) return null
  const unit = [1, 1 / 60, 1 / 3600][nums.length - 1]
  return { v: d + m / 60 + s / 3600, err: unit * 10 ** -nums[nums.length - 1].dec, parts: nums.length }
}

/** The longest run of up to three numbers that reads as an angle, from the
 *  front of the list (the last letter's, numbers running on after it) or
 *  from its back (the first letter's, numbers before it), so words and
 *  numbers round the position are left out. Numbers between the two
 *  letters must all be the angle. */
function angle(nums: Num[], open: 'front' | 'back' | null): Angle | null {
  if (!open) return magnitude(nums)
  for (let k = Math.min(3, nums.length); k >= 1; k--) {
    const v = magnitude(open === 'front' ? nums.slice(0, k) : nums.slice(nums.length - k))
    if (v != null) return v
  }
  return null
}

/** About 200 m: until both axes are this good the position is still being
 *  typed, and Go waits ("49.40955, -69.5" is already inside Lac Bailey). */
const COMPLETE_DEG = 0.002

function place(lat: Angle, lon: Angle, latNeg: boolean, lonNeg: boolean, letters: boolean): Place | null {
  const p = point(latNeg ? -lat.v : lat.v, lonNeg ? -lon.v : lon.v)
  if (!p) return null
  const parts = Math.max(lat.parts, lon.parts)
  const form: PlaceForm = parts === 3 ? 'dms' : parts === 2 ? 'dm' : letters ? 'nw' : 'dec'
  return { ...p, complete: Math.max(lat.err, lon.err) <= COMPLETE_DEG, form }
}

/** The position in a piece of text with no link in it. */
export function fromText(raw: string): Place | null {
  let s = raw
    .toUpperCase()
    .replace(/[º˚]/g, '°')
    .replace(/[′’‘´`]/g, "'")
    .replace(/[″“”]/g, '"')
  // a decimal comma (49,40955 -69,55349), only when no point is written
  if (!s.includes('.')) s = s.replace(/(\d),(\d)/g, '$1.$2')
  // a hemisphere letter on its own (not the O and N of LON, nor the S of
  // MAT'S), or a number
  const toks: Tok[] = []
  for (const m of s.matchAll(/(?<![A-Z])(?<![A-Z]')([NSEWO])(?![A-Z])|([-+]?\d+(?:\.(\d+))?)/g)) {
    const at = m.index ?? 0
    const end = at + m[0].length
    toks.push(m[1] ? { h: m[1], at, end } : { n: parseFloat(m[2]), neg: m[2].startsWith('-'), dec: m[3]?.length ?? 0, at, end })
  }
  const letters = toks.filter((t) => !isNum(t))
  if (letters.length === 2) {
    // N 49 24.573 W 69 33.209 (each letter before its numbers), or
    // 49 24 34.4 N 69 33 12.6 W (after them). Text ending on a letter is the
    // second kind, text starting on one the first; with words and numbers
    // round the position (a time before it, an accuracy after) the first
    // letter goes with the number it sits closer to, the next on a tie
    let before: boolean
    if (!isNum(toks[toks.length - 1])) before = false
    else if (!isNum(toks[0])) before = true
    else {
      const i = toks.indexOf(letters[0])
      const prev = toks[i - 1]
      const next = toks[i + 1]
      before = !(prev && isNum(prev) && next && letters[0].at - prev.end < next.at - letters[0].end)
    }
    const groups: { h: string; nums: Num[] }[] = []
    let run: Num[] = []
    for (const t of toks) {
      if (isNum(t)) {
        if (before && groups.length) groups[groups.length - 1].nums.push(t)
        else run.push(t)
      } else {
        groups.push({ h: t.h, nums: before ? [] : run })
        run = []
      }
    }
    const la = groups.find((g) => g.h === 'N' || g.h === 'S')
    const lo = groups.find((g) => g.h === 'E' || g.h === 'W' || g.h === 'O')
    if (!la || !lo) return null
    // the run open to the rest of the text: after the last letter, or before the first
    const open = (g: (typeof groups)[number]) => (before ? (g === groups[1] ? 'front' : null) : g === groups[0] ? 'back' : null)
    const lat = angle(la.nums, open(la))
    const lon = angle(lo.nums, open(lo))
    if (lat == null || lon == null) return null
    return place(lat, lon, la.h === 'S', lo.h !== 'E', true)
  }
  // one letter, or three: not a position this can read ("49.4 N, 69.5"
  // could be either side of Greenwich)
  if (letters.length > 0) return null
  const nums = toks.filter(isNum)
  // nothing but the numbers and their marks: lat then lon, split down the
  // middle, a minus for south and west
  if (/^[\s\d.,;:°'"+-]*$/.test(s) && nums.length >= 2 && nums.length <= 6 && nums.length % 2 === 0) {
    const half = nums.length / 2
    const a = magnitude(nums.slice(0, half))
    const b = magnitude(nums.slice(half))
    if (a && b) {
      // a first number that cannot be a latitude: written lon, lat (GeoJSON's order)
      const swapped = Math.abs(nums[0].n) > 90 && Math.abs(nums[half].n) <= 90
      const p = swapped ? place(b, a, nums[half].neg, nums[0].neg, false) : place(a, b, nums[0].neg, nums[half].neg, false)
      if (p) return p
    }
  }
  // words round them ("Stand 2: …", "Zone 18: …", "… ±5 m"), or numbers
  // that do not split ("12:30 49.40955, -69.55349"): two decimals side by
  // side, with only a comma, a space or a Lon label between
  const between = /^[\s,;/]*(?:LON(?:G(?:ITUDE)?)?|LNG)?[\s:=,;/]*$/
  for (let i = 0; i + 1 < nums.length; i++) {
    const a = nums[i]
    const b = nums[i + 1]
    if (!a.dec || !b.dec || !between.test(s.slice(a.end, b.at))) continue
    const p = place({ v: Math.abs(a.n), err: 10 ** -a.dec, parts: 1 }, { v: Math.abs(b.n), err: 10 ** -b.dec, parts: 1 }, a.neg, b.neg, false)
    if (p) return p
  }
  return null
}

const NUM = '(-?\\d+(?:\\.\\d+)?)'

/** The position in a map link, or null for text that is not one (or a
 *  link with no position in it, like a short maps.app.goo.gl one). */
export function fromLink(text: string): LonLat | null {
  const geo = new RegExp(`^geo:\\s*${NUM}\\s*,\\s*${NUM}`, 'i').exec(text)
  if (geo) return point(Number(geo[1]), Number(geo[2]))
  if (!/^(https?:\/\/|www\.|maps\.)/i.test(text)) return null
  let url: URL
  try {
    url = new URL(/^https?:/i.test(text) ? text : `https://${text}`)
  } catch {
    return null
  }
  const q = url.searchParams
  // the app's own links carry the point after the #, where no server sees it
  const h = new URLSearchParams(url.hash.replace(/^#/, ''))
  // OpenStreetMap's marker
  const mlat = q.get('mlat')
  const mlon = q.get('mlon')
  if (mlat && mlon) return point(Number(mlat), Number(mlon))
  // a Google place: the pin is !3d<lat>!4d<lon>; the @ is only where the map was looking
  const pin = new RegExp(`!3d${NUM}!4d${NUM}`).exec(text)
  if (pin) return point(Number(pin[1]), Number(pin[2]))
  // the app's at, Apple's ll (the pin) and coordinate, Google's q, query and destination
  for (const k of ['at', 'll', 'coordinate', 'q', 'query', 'destination', 'daddr', 'sll', 'center']) {
    const v = h.get(k) ?? q.get(k)
    const got = v ? fromText(v.replace(/^loc:\s*/i, '')) : null
    if (got) return { lon: got.lon, lat: got.lat }
  }
  // a path piece that is itself the position: /maps/place/49°24'34.4"N+69°33'12.6"W/, /maps/search/49.4,+-69.5
  for (const seg of url.pathname.split('/')) {
    if (!seg || seg.startsWith('@') || seg.includes('!')) continue
    let piece = seg
    try {
      piece = decodeURIComponent(seg.replace(/\+/g, ' '))
    } catch {
      /* left as it is */
    }
    const got = /\d/.test(piece) ? fromText(piece) : null
    if (got) return { lon: got.lon, lat: got.lat }
  }
  const at = new RegExp(`@${NUM},${NUM}`).exec(url.pathname)
  if (at) return point(Number(at[1]), Number(at[2]))
  const osm = new RegExp(`map=\\d+(?:\\.\\d+)?/${NUM}/${NUM}`).exec(url.hash)
  if (osm) return point(Number(osm[1]), Number(osm[2]))
  return null
}

/** The links in a message: http(s), www., maps. and geo:. */
const LINKS = /(?:\bhttps?:\/\/|\bwww\.|\bmaps\.|\bgeo:)[^\s<>"]+/gi

/** A link as it sits in a sentence: the full stop or bracket after it is not part of it. */
const trimLink = (l: string) => l.replace(/[).,;:!?'"\]]+$/, '')

/** The app's own words in a link: its area and the pin's name (any host,
 *  so a dev server's link reads as the deployed one does). */
function appWords(link: string): { area?: string; name?: string } {
  const r = readLink(/^[a-z]+:/i.test(link) ? link : `https://${link}`)
  const w: { area?: string; name?: string } = {}
  if (r.area) w.area = r.area
  if (r.pin) w.name = r.pin
  return w
}

/** The place in what was typed or pasted: a link's first (the app's own
 *  brings its area and the pin's name), else the words round the links. */
export function parsePlace(input: string): Parsed {
  const text = input.trim()
  if (!text) return null
  const links = (text.match(LINKS) ?? []).map(trimLink)
  let first: Place | null = null
  let areaOnly: string | undefined
  for (const l of links) {
    const p = fromLink(l)
    const w = appWords(l)
    // the app's own link wins, wherever it sits among the others
    if (p && (w.area || w.name)) return { ...p, ...w, complete: true, form: 'dec' }
    if (p && !first) first = { ...p, complete: true, form: 'dec' }
    areaOnly ??= w.area
  }
  if (first) return first
  // the words round the links, with the links (and their digits) taken out
  let rest = text
  for (const l of links) rest = rest.replace(l, ' ')
  return fromText(rest) ?? (areaOnly ? { area: areaOnly } : null)
}

/** The point alone in what was typed or pasted, or null. */
export function parseCoords(input: string): LonLat | null {
  const p = parsePlace(input)
  return p && p.lon != null ? { lon: p.lon, lat: p.lat } : null
}

/** It has a link in it: a miss is a link with no position in it, not a typo. */
export function isLink(input: string): boolean {
  return input.search(LINKS) >= 0
}

/** A point said back the way it was written: "49.40955, -69.55349",
 *  "N 49.40955° W 69.55349°", "N 49° 24.573' W 69° 33.209'" or
 *  "N 49° 24' 34.4" W 69° 33' 12.6"". */
export function placeWords(p: LonLat, form: PlaceForm = 'dec'): string {
  if (form === 'dec') return `${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}`
  const axis = (v: number, pos: string, neg: string) => {
    const h = v < 0 ? neg : pos
    const a = Math.abs(v)
    if (form === 'nw') return `${h} ${a.toFixed(5)}°`
    let d = Math.floor(a)
    if (form === 'dm') {
      // minutes to three places, as Garmin writes them; 59.9996 rounds into the next degree
      let m = Number(((a - d) * 60).toFixed(3))
      if (m >= 60) [d, m] = [d + 1, 0]
      return `${h} ${d}° ${m.toFixed(3)}'`
    }
    let m = Math.floor((a - d) * 60)
    let s = Number(((a - d - m / 60) * 3600).toFixed(1))
    if (s >= 60) [m, s] = [m + 1, 0]
    if (m >= 60) [d, m] = [d + 1, 0]
    return `${h} ${d}° ${m}' ${s.toFixed(1)}"`
  }
  return `${axis(p.lat, 'N', 'S')} ${axis(p.lon, 'E', 'W')}`
}
