import { useAppStore } from '../state/appStore'
import { floorHourMs } from '../time'

/**
 * The planning time falls back to now on its own. A time picked on the
 * strip is an hour of the forecast; once that hour is over there is
 * nothing to plan for, so the next look at the phone (visibilitychange)
 * and each top of the hour clear it. The phone is pocketed between
 * looks, so nothing here assumes the screen stayed on.
 */

let wired = false

function sweep() {
  const s = useAppStore.getState()
  if (s.planTimeMs != null && s.planTimeMs < floorHourMs()) s.setPlanTime(null)
}

/** ms until just after the next top of the hour */
function untilNextHour(): number {
  const now = Date.now()
  return floorHourMs(now) + 3600_000 - now + 1000
}

export function initPlanTime(): void {
  if (wired) return
  wired = true
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') sweep()
  })
  const tick = () => {
    sweep()
    window.setTimeout(tick, untilNextHour())
  }
  window.setTimeout(tick, untilNextHour())
  sweep()
}
