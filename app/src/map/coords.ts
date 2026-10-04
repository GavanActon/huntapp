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
 *   (mlat=, #map=) and geo: links
 *
 * Pure: no map and no app state, so it can be tried from node.
 */

export interface LonLat {
  lon: number
  lat: number
}

/** A hemisphere letter or a number, with where it sits in the text. */
type Tok = ({ h: string } | { n: number; neg: boolean }) & { at: number; end: number }

const isNum = (t: Tok): t is { n: number; neg: boolean; at: number; end: number } => 'n' in t

function point(lat: number, lon: number): LonLat | null {
  return Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lon, lat } : null
}

/** Degrees, degrees and minutes, or degrees, minutes and seconds, as one
 *  unsigned number; null for anything that is not (minutes past 60, a
 *  fraction of a degree with minutes after it). */
function magnitude(nums: { n: number }[]): number | null {
  if (nums.length < 1 || nums.length > 3) return null
  const [d, m = 0, s = 0] = nums.map((t) => Math.abs(t.n))
  if (m >= 60 || s >= 60) return null
  if (nums.length > 1 && !Number.isInteger(d)) return null
  if (nums.length > 2 && !Number.isInteger(m)) return null
  return d + m / 60 + s / 3600
}

/** The longest run of up to three numbers that reads as an angle, from the
 *  front of the list (the last letter's, numbers running on after it) or
 *  from its back (the first letter's, numbers before it), so words and
 *  numbers round the position are left out. Numbers between the two
 *  letters must all be the angle. */
function angle(nums: { n: number }[], open: 'front' | 'back' | null): number | null {
  if (!open) return magnitude(nums)
  for (let k = Math.min(3, nums.length); k >= 1; k--) {
    const v = magnitude(open === 'front' ? nums.slice(0, k) : nums.slice(nums.length - k))
    if (v != null) return v
  }
  return null
}

/** The position in a piece of text with no link in it. */
export function fromText(raw: string): LonLat | null {
  let s = raw
    .toUpperCase()
    .replace(/[º˚]/g, '°')
    .replace(/[′’‘´`]/g, "'")
    .replace(/[″“”]/g, '"')
  // a decimal comma (49,40955 -69,55349), only when no point is written
  if (!s.includes('.')) s = s.replace(/(\d),(\d)/g, '$1.$2')
  // a hemisphere letter on its own (not the O and N of LON), or a number
  const toks: Tok[] = []
  for (const m of s.matchAll(/(?<![A-Z])([NSEWO])(?![A-Z])|([-+]?\d+(?:\.\d+)?)/g)) {
    const at = m.index ?? 0
    const end = at + m[0].length
    toks.push(m[1] ? { h: m[1], at, end } : { n: parseFloat(m[2]), neg: m[2].startsWith('-'), at, end })
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
    const groups: { h: string; nums: { n: number }[] }[] = []
    let run: { n: number }[] = []
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
    return point(la.h === 'S' ? -lat : lat, lo.h === 'E' ? lon : -lon)
  }
  if (letters.length > 0) return null
  // no letters: lat then lon, split down the middle, a minus for south and west
  const nums = toks.filter(isNum)
  if (nums.length < 2 || nums.length > 6 || nums.length % 2) return null
  const half = nums.length / 2
  const a = magnitude(nums.slice(0, half))
  const b = magnitude(nums.slice(half))
  if (a == null || b == null) return null
  let lat = nums[0].neg ? -a : a
  let lon = nums[half].neg ? -b : b
  // a first number that cannot be a latitude: written lon, lat (GeoJSON's order)
  if (Math.abs(lat) > 90 && Math.abs(lon) <= 90) [lat, lon] = [lon, lat]
  return point(lat, lon)
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
  // OpenStreetMap's marker
  const mlat = q.get('mlat')
  const mlon = q.get('mlon')
  if (mlat && mlon) return point(Number(mlat), Number(mlon))
  // a Google place: the pin is !3d<lat>!4d<lon>; the @ is only where the map was looking
  const pin = new RegExp(`!3d${NUM}!4d${NUM}`).exec(text)
  if (pin) return point(Number(pin[1]), Number(pin[2]))
  // Apple's ll (the pin) and coordinate, Google's q, query and destination
  for (const k of ['ll', 'coordinate', 'q', 'query', 'destination', 'daddr', 'sll', 'center']) {
    const v = q.get(k)
    const got = v ? fromText(v.replace(/^loc:\s*/i, '')) : null
    if (got) return got
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
    if (got) return got
  }
  const at = new RegExp(`@${NUM},${NUM}`).exec(url.pathname)
  if (at) return point(Number(at[1]), Number(at[2]))
  const osm = new RegExp(`map=\\d+(?:\\.\\d+)?/${NUM}/${NUM}`).exec(url.hash)
  if (osm) return point(Number(osm[1]), Number(osm[2]))
  return null
}

/** The position in what was typed or pasted, or null. */
export function parseCoords(input: string): LonLat | null {
  const text = input.trim()
  if (!text) return null
  if (/^(https?:\/\/|www\.|maps\.|geo:)/i.test(text)) return fromLink(text)
  return fromText(text)
}

/** It looks like a link: a miss is a link with no position in it, not a typo. */
export function isLink(input: string): boolean {
  return /^(https?:\/\/|www\.|maps\.|geo:)/i.test(input.trim())
}
