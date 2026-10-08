import type { JSX } from 'react'
import { useMapBearing } from '../map/mapBearing'
import { withMap } from '../map/mapController'
import { useAppStore } from '../state/appStore'
import { toggleLocate } from '../tracking/gpsService'
import { useGpsStore } from '../tracking/gpsStore'
import HotColumn from './HotColumn'
import { IconCompass, IconLocate } from './icons'
import './ground.css'
import { EXPLORE } from '../explore'

/**
 * The near column, under the thumb: the compass on top only while the map
 * is turned (a tap puts north back up), your high-use buttons, a gap, and
 * My location, which is always there and always at the foot. The buttons
 * line up with the far column's across the screen (ui.css, the foot).
 */
export default function ToolColumn(): JSX.Element {
  const bearing = useMapBearing((s) => s.bearing)
  const follow = useAppStore((s) => s.follow)
  const locating = useGpsStore((s) => s.locating)
  const headingUp = useGpsStore((s) => s.headingUp)
  const acquiring = useGpsStore((s) => s.status === 'acquiring')
  const rotated = Math.abs(bearing) > 0.5

  const locateClass = `fab${locating && follow ? ' active' : ''}${headingUp ? ' fab-heading' : ''}${acquiring ? ' fab-acquiring' : ''}`
  const locateLabel = !locating ? 'Show my position' : !follow ? 'Follow my position' : headingUp ? 'Turn location off' : 'Turn the map the way I face'

  return (
    <div className="toolcol">
      {rotated && (
        <button
          className="fab"
          onClick={() => {
            useGpsStore.getState().setHeadingUp(false)
            withMap((m) => m.easeTo({ bearing: 0, pitch: 0 }))
          }}
          aria-label="North up"
        >
          <IconCompass rotation={-Math.round(bearing)} />
        </button>
      )}
      {!EXPLORE && <HotColumn side="near" />}
      <button className={locateClass} style={locating && !follow ? { opacity: 0.8, outline: '1.5px solid var(--c-accent)' } : undefined} onClick={toggleLocate} aria-label={locateLabel}>
        <IconLocate />
      </button>
    </div>
  )
}
