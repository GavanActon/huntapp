/** Moon phase from a synodic-month count since a known new moon: a minute's
 *  error over decades, plenty for "is it a bright night". */
const SYNODIC_DAYS = 29.530588853
const KNOWN_NEW_MOON_MS = Date.UTC(2000, 0, 6, 18, 14) // 2000-01-06 18:14 UTC

export function moonPhase(ms: number): { phase: number; illumination: number; name: string } {
  const days = (ms - KNOWN_NEW_MOON_MS) / 86_400_000
  const phase = ((days % SYNODIC_DAYS) + SYNODIC_DAYS) % SYNODIC_DAYS / SYNODIC_DAYS
  const illumination = (1 - Math.cos(phase * 2 * Math.PI)) / 2
  const names = ['new', 'waxing crescent', 'first quarter', 'waxing gibbous', 'full', 'waning gibbous', 'last quarter', 'waning crescent']
  const name = names[Math.round(phase * 8) % 8]
  return { phase, illumination, name }
}
