/** Range-and-bearing maths for the measuring tool, and the one place its
 *  numbers get formatted: the map labels and the card read the same. */

export type Units = 'metric' | 'imperial'

/** Haversine distance in metres. */
export function haversineM(aLon: number, aLat: number, bLon: number, bLat: number): number {
  const R = 6371008.8
  const toRad = Math.PI / 180
  const dLat = (bLat - aLat) * toRad
  const dLon = (bLon - aLon) * toRad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * toRad) * Math.cos(bLat * toRad) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** Initial great-circle bearing a→b, degrees true (0–360). */
export function bearingDeg(a: [number, number], b: [number, number]): number {
  const toRad = Math.PI / 180
  const lat1 = a[1] * toRad
  const lat2 = b[1] * toRad
  const dLon = (b[0] - a[0]) * toRad
  const y = Math.sin(dLon) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon)
  return (Math.atan2(y, x) / toRad + 360) % 360
}

export interface Leg {
  m: number
  deg: number
}

export function legsOf(points: [number, number][]): Leg[] {
  const legs: Leg[] = []
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    legs.push({ m: haversineM(a[0], a[1], b[0], b[1]), deg: bearingDeg(a, b) })
  }
  return legs
}

export function totalM(points: [number, number][]): number {
  return legsOf(points).reduce((s, l) => s + l.m, 0)
}

/** A range in the units the user reads: metres up close, km beyond;
 *  yards and miles for imperial. */
export function formatDistance(m: number, units: Units): string {
  if (units === 'imperial') {
    const yd = m * 1.09361
    if (yd < 1000) return `${Math.round(yd)} yd`
    const mi = m / 1609.344
    return `${mi < 10 ? mi.toFixed(2) : mi.toFixed(1)} mi`
  }
  if (m < 1000) return `${Math.round(m)} m`
  const km = m / 1000
  return `${km < 10 ? km.toFixed(2) : km.toFixed(1)} km`
}

/** "042°T": true, three digits, the way a course is written. */
export function formatBearing(deg: number): string {
  return `${String(Math.round(deg) % 360).padStart(3, '0')}°T`
}
