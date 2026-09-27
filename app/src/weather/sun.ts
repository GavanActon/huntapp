/**
 * Sunrise and sunset, computed locally.
 *
 * These are the bar's standing facts — they must never depend on a fetch,
 * because the whole point of showing them is that the bar stays useful when
 * everything else is failing (offline, rate-limited, first run). The NOAA
 * approximation below is good to a minute or two at this latitude, which is
 * more than the question "how much light is left" needs.
 */

const RAD = Math.PI / 180

export function sunTimes(
  dateMs: number,
  lat: number,
  lon: number,
): { sunriseMs: number | null; sunsetMs: number | null } {
  // days since J2000, corrected for the observer's longitude
  const jDate = dateMs / 86_400_000 + 2440587.5
  const n = Math.round(jDate - 2451545.0 + 0.0008)
  const jStar = n - lon / 360

  const M = (357.5291 + 0.98560028 * jStar) % 360
  const C = 1.9148 * Math.sin(M * RAD) + 0.02 * Math.sin(2 * M * RAD) + 0.0003 * Math.sin(3 * M * RAD)
  const lambda = (M + C + 180 + 102.9372) % 360
  const jTransit = 2451545.0 + jStar + 0.0053 * Math.sin(M * RAD) - 0.0069 * Math.sin(2 * lambda * RAD)
  const decl = Math.asin(Math.sin(lambda * RAD) * Math.sin(23.4397 * RAD))

  const cosH =
    (Math.sin(-0.833 * RAD) - Math.sin(lat * RAD) * Math.sin(decl)) /
    (Math.cos(lat * RAD) * Math.cos(decl))
  // polar day or night — not a concern on Superior, but honesty is cheap
  if (cosH < -1 || cosH > 1) return { sunriseMs: null, sunsetMs: null }

  const H = Math.acos(cosH) / RAD
  const toMs = (j: number) => (j - 2440587.5) * 86_400_000
  return { sunriseMs: toMs(jTransit - H / 360), sunsetMs: toMs(jTransit + H / 360) }
}

/** Where the sun is: elevation above the horizon and azimuth (0 = N,
 *  clockwise), degrees. NOAA's low-precision formulae; a degree is plenty
 *  for deciding which slopes the sun is heating. */
export function sunPosition(ms: number, lat: number, lon: number): { elevDeg: number; azDeg: number } {
  const d = ms / 86_400_000 + 2440587.5 - 2451545.0
  const g = (357.529 + 0.98560028 * d) * RAD
  const q = 280.459 + 0.98564736 * d
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD
  const e = (23.439 - 0.00000036 * d) * RAD
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L))
  const decl = Math.asin(Math.sin(e) * Math.sin(L))
  const gmst = (18.697374558 + 24.06570982441908 * d) % 24
  const ha = ((gmst * 15 + lon) * RAD - ra)
  const la = lat * RAD
  const elev = Math.asin(Math.sin(la) * Math.sin(decl) + Math.cos(la) * Math.cos(decl) * Math.cos(ha))
  const az = Math.atan2(-Math.sin(ha), Math.tan(decl) * Math.cos(la) - Math.sin(la) * Math.cos(ha))
  return { elevDeg: elev / RAD, azDeg: ((az / RAD) % 360 + 360) % 360 }
}
