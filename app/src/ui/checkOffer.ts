import { useEffect, useMemo, useState } from 'react'
import { useWindChecks, verdict, type WindCheck } from '../weather/micro/windChecks'
import { PUFF_GAP_MS, SETTLE_WINDOW_MS, puffsLeft } from './WindCheckCard'

/**
 * The wind check button's offer: after a check that is still settling (the
 * map was off, "correcting", or the wind came and went, and the card said
 * "Next puff in 5 min · 2 more to settle it"), the button reads "Check now"
 * once the next puff is due, with one soft glow, and a toast if the app
 * happens to be open then (Gavan, 2026-10-20, by OpusJay: "check now, do a
 * little animation on check button, I don't want it to be pushy, make it
 * feel optional and benefit driven"). Until then the time only lived on the
 * saved card, gone with it.
 *
 * Worked out from the checks on the phone each time it is looked at, never
 * from a timer that had to fire: the phone is in a pocket when it falls due,
 * so it simply reads "Check now" when it comes back out, however late. Only
 * while the spot still wants puffs (puffsLeft): never after a check that
 * confirmed the map. It goes by itself when the puffs no longer count
 * together (SETTLE_WINDOW_MS after the last, two hours), or with the next
 * check, which settles the spot or makes its own offer.
 */

export interface CheckOffer {
  /** the check it follows */
  id: string
  /** the next puff is due */
  due: number
  /** the offer is gone */
  ends: number
}

/** A check from this phone, felt here: not a partner's, not treetops seen from afar, not a station. */
const mine = (c: WindCheck) => !c.taken && !c.member && !c.seen && c.source === 'hand'
const lastOf = (c: WindCheck) => c.lastTs ?? c.ts

/** The offer the latest check makes, due or not; null when it settled the spot. */
export function checkOffer(checks: WindCheck[]): CheckOffer | null {
  let last: WindCheck | null = null
  for (const c of checks) if (mine(c) && (!last || lastOf(c) > lastOf(last))) last = c
  if (!last || puffsLeft(verdict(last), last, checks) === 0) return null
  const t = lastOf(last)
  return { id: `${last.id}:${t}`, due: t + PUFF_GAP_MS, ends: t + SETTLE_WINDOW_MS }
}

/** The offer while it stands (due and not yet gone), looked at again when it falls due, when it
 *  ends, and whenever the phone comes back out. */
export function useCheckOffer(): CheckOffer | null {
  const checks = useWindChecks((s) => s.checks)
  const [now, setNow] = useState(() => Date.now())
  const offer = useMemo(() => checkOffer(checks), [checks])
  useEffect(() => {
    const next = offer ? (now < offer.due ? offer.due : now < offer.ends ? offer.ends : null) : null
    const t = next != null ? window.setTimeout(() => setNow(Date.now()), next - now + 250) : 0
    const back = () => {
      if (document.visibilityState === 'visible') setNow(Date.now())
    }
    document.addEventListener('visibilitychange', back)
    return () => {
      window.clearTimeout(t)
      document.removeEventListener('visibilitychange', back)
    }
  }, [offer, now])
  // a check just saved changes `checks`: look again at the time too
  useEffect(() => setNow(Date.now()), [checks])
  return offer && now >= offer.due && now < offer.ends ? offer : null
}

/** What the offer gives, in its words: the toast's, and the button's to a screen reader. */
export const OFFER_WORDS = 'One more puff sharpens your wind here'
