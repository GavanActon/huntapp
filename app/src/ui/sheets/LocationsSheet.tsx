import { type JSX } from 'react'
import { ACTIVE_AREA, AREA_LIST, type AreaDef } from '../../areas'
import { switchArea } from '../../areas/switch'
import { getMap } from '../../map/mapController'
import { useDownloads } from '../../offline/downloads'
import { bundleOf, keepsArea } from '../../offline/updates'
import { useAppStore } from '../../state/appStore'
import { IconLocate } from '../icons'
import './log.css'

/**
 * Locations: every area the app has maps for (app/src/areas), the one it
 * is in first. A tap goes there: this area eases back to its home view;
 * another goes by the usual switch, which saves the area and the view and
 * reloads (areas/switch.ts, with its own asks: a download running, people
 * placed, no signal and no maps). Gavan, 2026-10-04: "so it's easy to get to".
 */
export default function LocationsSheet(): JSX.Element {
  // the 'maps saved' note follows downloads and removals
  useDownloads((s) => s.storedAt)
  const closeSheet = useAppStore((s) => s.closeSheet)

  const go = (a: AreaDef) => {
    if (a.id === ACTIVE_AREA.id) {
      closeSheet()
      getMap()?.easeTo({ center: a.home.center, zoom: a.home.zoom, bearing: 0 })
      return
    }
    switchArea(a.id, { center: a.home.center, zoom: a.home.zoom })
  }

  return (
    <div className="pins">
      <div className="place-list">
        {AREA_LIST.map((a) => {
          const here = a.id === ACTIVE_AREA.id
          const b = bundleOf(a.id)
          const saved = b != null && keepsArea(b)
          return (
            <div key={a.id} className={`place-row${here ? ' place-current' : ''}`}>
              <button className="row-text place-go" onClick={() => go(a)}>
                <span className="row-title">{a.name}</span>
                <span className="row-desc">
                  {a.presets[0]?.name ?? ''}
                  {here ? ' · here' : ''}
                  {saved ? ' · maps saved' : ''}
                </span>
              </button>
              <button className="icon-btn" aria-label={`Go to ${a.name}`} onClick={() => go(a)}>
                <IconLocate size={16} />
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
