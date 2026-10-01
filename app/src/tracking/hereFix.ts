import { inRegion } from '../config'
import { useGpsStore, type Fix } from './gpsStore'

/**
 * Where "here" is, when the phone really knows: a fix tight enough to
 * start a measurement or a route from, and in the hunting region rather
 * than back home in town. Null otherwise — and then nothing starts from
 * you, it starts where you tap.
 */

/** Metres of spread beyond which a fix is a guess, not a place to stand. */
const GOOD_M = 50

function here(fix: Fix | null): { lon: number; lat: number } | null {
  if (!fix || (fix.sigma ?? fix.accuracy) > GOOD_M) return null
  if (!inRegion(fix.lon, fix.lat)) return null
  return { lon: fix.lon, lat: fix.lat }
}

export function usableFix(): { lon: number; lat: number } | null {
  return here(useGpsStore.getState().fix)
}

/** The same, for a card that has to dim the moment the fix goes. */
export function useUsableFix(): { lon: number; lat: number } | null {
  return here(useGpsStore((s) => s.fix))
}
