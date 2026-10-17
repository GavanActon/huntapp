import { useAppStore } from './state/appStore'

/**
 * Lengths in the units this phone reads (Settings: metric or imperial), the
 * one place they are worded (Gavan, 2026-10-17: "a full unit pass on meters
 * / ft"). Everything is metres inside; words only at the edge. Imperial
 * reads distances in yards and miles, the way a range is called, and
 * heights, elevations and depths in feet. measureMath's formatDistance is
 * the ruler's exact version of `dist`.
 */

export type Units = 'metric' | 'imperial'

const FT = 3.28084
const YD = 1.09361
const MI = 1609.344

/** The phone's units now, for words made outside a component (reasons, map labels). */
export const unitsNow = (): Units => useAppStore.getState().units

const roundTo = (v: number, step: number) => Math.round(v / step) * step

/** A distance in words, rounded to `step` metres (or yards): "120 m", "1.4 km"; "130 yd", "0.9 mi". */
export function dist(m: number, opts: { step?: number; u?: Units } = {}): string {
  const u = opts.u ?? unitsNow()
  const step = opts.step ?? 10
  if (u === 'imperial') {
    const yd = m * YD
    if (yd < 1000) return `${roundTo(yd, step)} yd`
    const mi = m / MI
    return `${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mi`
  }
  if (m < 1000) return `${roundTo(m, step)} m`
  const km = m / 1000
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`
}

/** Kilometres in words at one decimal: "2.5 km"; "1.6 mi". */
export function km(k: number, u: Units = unitsNow()): string {
  return u === 'imperial' ? `${((k * 1000) / MI).toFixed(1)} mi` : `${k.toFixed(1)} km`
}

/** An area in square kilometres: "123 km²"; "47 mi²". */
export function km2(k: number, u: Units = unitsNow()): string {
  return u === 'imperial' ? `${Math.round((k * 1e6) / (MI * MI))} mi²` : `${Math.round(k)} km²`
}

/** A height, an elevation, a rise or a drop: "19 m"; "62 ft". `step` rounds in the unit shown
 *  (10: the nearest 10 m, or 10 ft); `digits` keeps a metric fraction (a stand's 1.5 m). */
export function height(m: number, opts: { u?: Units; step?: number; digits?: number } = {}): string {
  const u = opts.u ?? unitsNow()
  const step = opts.step ?? 1
  if (u === 'imperial') return `${roundTo(m * FT, step)} ft`
  return `${opts.digits ? m.toFixed(opts.digits).replace(/\.0+$/, '') : roundTo(m, step)} m`
}

/** A water depth: "3.5 m"; "11 ft". */
export function depth(m: number, u: Units = unitsNow(), digits = 1): string {
  return u === 'imperial' ? `${Math.round(m * FT)} ft` : `${m.toFixed(digits).replace(/\.0+$/, '')} m`
}

/** A height in the phone's units, as a number: metres or feet. For map labels and charts. */
export const heightIn = (m: number, u: Units = unitsNow()) => (u === 'imperial' ? m * FT : m)

/** The unit a height reads in. */
export const heightUnit = (u: Units = unitsNow()) => (u === 'imperial' ? 'ft' : 'm')

/** A temperature with its scale, for a line of text (the log): "-3°C"; "27°F". */
export function temp(c: number, u: Units = unitsNow()): string {
  return u === 'imperial' ? `${Math.round(c * 1.8 + 32)}°F` : `${Math.round(c)}°C`
}

/** A wind or walking speed with its unit: "19 km/h"; "12 mph". */
export function speed(kmh: number, u: Units = unitsNow()): string {
  return u === 'imperial' ? `${Math.round(kmh * 0.621371)} mph` : `${Math.round(kmh)} km/h`
}

/** A depth range, "2–6 m"; "7–20 ft". */
export function depthRange(lo: number, hi: number, u: Units = unitsNow()): string {
  return `${Math.round(heightIn(lo, u))}–${Math.round(heightIn(hi, u))} ${heightUnit(u)}`
}

/** Kilometres as a number in the phone's units (km or mi), and that unit: a box's sides. */
export const kmIn = (k: number, u: Units = unitsNow()) => (u === 'imperial' ? (k * 1000) / MI : k)
export const kmUnit = (u: Units = unitsNow()) => (u === 'imperial' ? 'mi' : 'km')

/** A distance range, "40–50 m"; "45–55 yd". */
export function distRange(lo: number, hi: number, opts: { step?: number; u?: Units } = {}): string {
  const u = opts.u ?? unitsNow()
  const step = opts.step ?? 5
  const k = u === 'imperial' ? YD : 1
  return `${roundTo(lo * k, step)}–${roundTo(hi * k, step)} ${u === 'imperial' ? 'yd' : 'm'}`
}
