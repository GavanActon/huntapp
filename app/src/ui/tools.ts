import { useMeasureStore } from '../measure/measureStore'
import { closeRoutes, useRoutes } from '../routes/routeStore'
import { useScent } from '../weather/micro/scent'
import { useCheckForm } from './WindCheckCard'
import { useHeardForm } from './HeardCard'
import { useLogForm } from './LogCard'

/**
 * The tools that take the map's tap: the ruler, the route card, a wind
 * check being set up or logged, a moose being placed, a log entry, a person
 * being sat down or moved. One at a time: starting one puts the others
 * away, so two cards never fight over a tap and the map's own popup knows
 * when to stay shut.
 */
export type Tool = 'measure' | 'route' | 'check' | 'heard' | 'scent' | 'log'

/** Put every tool away but the one named. */
export function releaseTools(except?: Tool) {
  if (except !== 'measure' && useMeasureStore.getState().active) useMeasureStore.getState().stop()
  if (except !== 'route' && useRoutes.getState().open) closeRoutes()
  if (except !== 'check') useCheckForm.getState().close()
  if (except !== 'heard') useHeardForm.getState().close()
  if (except !== 'log') useLogForm.getState().close()
  if (except !== 'scent') {
    const sc = useScent.getState()
    if (sc.adding) sc.setAdding(false)
    if (sc.moving != null) sc.setMoving(null)
  }
}

/** A tool owns the next tap on the map (the map's popup and the layers' own taps stand aside). */
export function toolOwnsTap(): boolean {
  if (useMeasureStore.getState().active || useRoutes.getState().open) return true
  const ck = useCheckForm.getState()
  if (ck.at || ck.arming) return true
  if (useHeardForm.getState().open) return true
  const sc = useScent.getState()
  return sc.adding || sc.moving != null
}
