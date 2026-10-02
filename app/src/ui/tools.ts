import { useScent } from '../weather/micro/scent'
import { useHeardForm } from './HeardCard'

/**
 * A button that waits for a map tap (Person, Scent with no fix, Heard)
 * owns the next tap. A sheet opening over the map takes the map away, so
 * whatever was waiting stops waiting: its bar would otherwise sit armed
 * over the sheet and fire on the first tap after it closes.
 */
export function releaseArmed(): void {
  const sc = useScent.getState()
  if (sc.adding) sc.setAdding(false)
  const hf = useHeardForm.getState()
  if (hf.placing) hf.arm()
}
