import { useBushLabels } from '../bushLabels/labelStore'
import { useMeasureStore } from '../measure/measureStore'
import { usePaths } from '../paths/pathStore'
import { useRoutes } from '../routes/routeStore'
import { useScent } from '../weather/micro/scent'
import { useHeardForm } from './HeardCard'

/**
 * Who has the map's taps, read in one place. Each tool keeps its own store
 * (the ruler's points, the paths, the routes, the labels); this is the one
 * reading of them, in one order, where there were seven lists of flags in
 * seven files, each in its own order.
 *
 * A tool is modal: it has a card in the bar and the map's taps are its own
 * (its layer handles them). An armed button is one-shot: the next tap on the
 * map is where a person sits (Scent with no fix) or where the moose was
 * (Game). A sheet opening over the map, or a tool taking it, takes the map
 * away, so whatever was armed stops waiting (releaseArmed): its bar would
 * otherwise sit armed underneath and fire on the first tap after.
 */

export type Tool = 'labels' | 'measure' | 'path' | 'routes'

/** The tool with the map now, in the bar's order; null for none. */
export function toolNow(): Tool | null {
  if (useBushLabels.getState().active) return 'labels'
  if (useMeasureStore.getState().active) return 'measure'
  if (usePaths.getState().drawing) return 'path'
  if (useRoutes.getState().open) return 'routes'
  return null
}

/** The same, for a component: re-renders as the tools' stores change. */
export function useTool(): Tool | null {
  const labels = useBushLabels((s) => s.active)
  const measure = useMeasureStore((s) => s.active)
  const path = usePaths((s) => s.drawing)
  const routes = useRoutes((s) => s.open)
  return labels ? 'labels' : measure ? 'measure' : path ? 'path' : routes ? 'routes' : null
}

export type Armed = 'scent' | 'heard'

/** The button waiting for the next map tap; null for none. */
export function armedNow(): Armed | null {
  if (useScent.getState().adding) return 'scent'
  if (useHeardForm.getState().placing) return 'heard'
  return null
}

/** Whatever was waiting for a tap stops waiting. The wind check card takes the
 *  map's taps while it is up, but it is not armed: it stays, and a sheet over
 *  the map simply gets no taps to it. */
export function releaseArmed(): void {
  const sc = useScent.getState()
  if (sc.adding) sc.setAdding(false)
  const hf = useHeardForm.getState()
  if (hf.placing) hf.arm()
}
