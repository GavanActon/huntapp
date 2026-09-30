import type { JSX } from 'react'
import { useMapBearing } from '../map/mapBearing'
import { withMap } from '../map/mapController'
import { useMeasureStore } from '../measure/measureStore'
import { closeRoutes, openRoutes, useRoutes } from '../routes/routeStore'
import { useAppStore } from '../state/appStore'
import { toggleLocate } from '../tracking/gpsService'
import { useGpsStore } from '../tracking/gpsStore'
import { IconCompass, IconLocate, IconRoute, IconRuler, IconWind } from './icons'
import './ground.css'

/**
 * The right column, the same on every screen: Routes, Measure, Wind flow,
 * a gap, My location. The compass sits on top only while the map is
 * turned, and a tap puts north back up.
 */
export default function ToolColumn(): JSX.Element {
  const bearing = useMapBearing((s) => s.bearing)
  const routing = useRoutes((s) => s.open)
  const measuring = useMeasureStore((s) => s.active)
  const windOn = useAppStore((s) => s.layers.windFlow)
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
      <button className={`fab${routing ? ' active' : ''}`} onClick={() => (routing ? closeRoutes() : openRoutes())} aria-pressed={routing} aria-label="Routes">
        <IconRoute />
      </button>
      <button
        className={`fab${measuring ? ' active' : ''}`}
        onClick={() => {
          const m = useMeasureStore.getState()
          if (m.active) return m.stop()
          useAppStore.getState().closeSheet()
          m.start()
        }}
        aria-pressed={measuring}
        aria-label="Measure"
      >
        <IconRuler />
      </button>
      <button className={`fab${windOn ? ' active' : ''}`} onClick={() => useAppStore.getState().setLayer('windFlow', !windOn)} aria-pressed={windOn} aria-label="Wind flow">
        <IconWind />
      </button>
      <div className="toolgap" />
      <button className={locateClass} style={locating && !follow ? { opacity: 0.8, outline: '1.5px solid var(--c-accent)' } : undefined} onClick={toggleLocate} aria-label={locateLabel}>
        <IconLocate />
      </button>
    </div>
  )
}
