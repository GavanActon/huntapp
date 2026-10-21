import type { JSX } from 'react'
import { useAppStore } from '../state/appStore'
import { SHEETS } from '../weather/windFlow'

/**
 * The 3D wind's key: which streaks are which height (weather/windFlow.ts
 * SHEETS), a dot of each ink. Only while the sheets above head height are
 * drawn: 3D on, the streaks on, one sheet or more switched on in the 3D
 * button's hold. Over the map, no taps.
 */
export default function WindKey(): JSX.Element | null {
  const on3d = useAppStore((s) => s.view3d)
  const flow = useAppStore((s) => s.layers.windFlow)
  const sheets = useAppStore((s) => s.windSheets)
  if (!on3d || !flow || (!sheets.tops && !sheets.aloft)) return null
  return (
    <div className="windkey glass" aria-label="Wind by height">
      <span>
        <i style={{ background: 'var(--c-text)' }} />
        Head height
      </span>
      {sheets.tops && (
        <span>
          <i style={{ background: `rgb(${SHEETS.tops.rgb})` }} />
          {SHEETS.tops.name}
        </span>
      )}
      {sheets.aloft && (
        <span>
          <i style={{ background: `rgb(${SHEETS.aloft.rgb})` }} />
          {SHEETS.aloft.name}
        </span>
      )}
    </div>
  )
}
