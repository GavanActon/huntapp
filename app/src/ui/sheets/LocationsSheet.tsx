import { useEffect, useRef, useState, type JSX } from 'react'
import { ACTIVE_AREA, AREA_LIST, areaAt, type AreaDef } from '../../areas'
import { switchArea } from '../../areas/switch'
import { setExplore } from '../../explore'
import { boxAround } from '../../explore/box'
import { useExplore } from '../../explore/store'
import { getMap } from '../../map/mapController'
import { useDownloads } from '../../offline/downloads'
import { bundleOf, keepsArea } from '../../offline/updates'
import { shareArea } from '../../share/share'
import { useAppStore } from '../../state/appStore'
import { IconLocate, IconShare } from '../icons'
import './log.css'

/**
 * Locations: every area the app has maps for (app/src/areas), the one it
 * is in first. A tap goes there: this area eases back to its home view;
 * another goes by the usual switch, which saves the area and the view and
 * reloads (areas/switch.ts, with its own asks: a download running, people
 * placed, no signal and no maps). Gavan, 2026-10-04: "so it's easy to get to".
 * Each row's Share sends that area's link (share/share.ts), from the tap
 * itself as iOS asks; with no share sheet it says whether the clipboard
 * took it.
 */
export default function LocationsSheet(): JSX.Element {
  // the 'maps saved' note follows downloads and removals
  useDownloads((s) => s.storedAt)
  const closeSheet = useAppStore((s) => s.closeSheet)
  // what a row's Share says when the message went to the clipboard, or did not
  const [said, setSaid] = useState<{ id: string; text: string } | null>(null)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const share = (a: AreaDef) => {
    void shareArea(a).then((r) => {
      if (r !== 'copied' && r !== 'failed') return
      window.clearTimeout(timer.current)
      setSaid({ id: a.id, text: r === 'copied' ? 'Copied' : 'Could not copy' })
      timer.current = window.setTimeout(() => setSaid(null), r === 'copied' ? 1200 : 2400)
    })
  }

  const go = (a: AreaDef) => {
    if (a.id === ACTIVE_AREA.id) {
      closeSheet()
      getMap()?.easeTo({ center: a.home.center, zoom: a.home.zoom, bearing: 0 })
      return
    }
    switchArea(a.id, { center: a.home.center, zoom: a.home.zoom })
  }

  // a new location is asked for the way Explore asks: the box, then SD or HD
  // (explore/index.ts). Over no area the box goes round the view at once;
  // over one, Explore comes on and the box goes down where the next tap
  // lands outside the areas (Gavan, 2026-10-17: "there should also be an
  // add which lets you add locations through the same method")
  const add = () => {
    closeSheet()
    setExplore(true)
    const m = getMap()
    if (!m) return
    const c = m.getCenter()
    if (!areaAt(c.lng, c.lat)) useExplore.getState().select({ box: boxAround(c.lng, c.lat), lon: c.lng, lat: c.lat })
  }

  return (
    <div className="pins">
      <div className="place-list">
        {AREA_LIST.filter((a) => !a.virtual).map((a) => {
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
                  {said?.id === a.id ? ` · ${said.text}` : ''}
                </span>
              </button>
              <button className="icon-btn" aria-label={`Share ${a.name}`} onClick={() => share(a)}>
                <IconShare size={16} />
              </button>
              <button className="icon-btn" aria-label={`Go to ${a.name}`} onClick={() => go(a)}>
                <IconLocate size={16} />
              </button>
            </div>
          )
        })}
        <div className="place-row">
          <button className="row-text place-go" onClick={add}>
            <span className="row-title">Add a location</span>
            <span className="row-desc">a box where you want maps, then SD or HD</span>
          </button>
        </div>
      </div>
    </div>
  )
}
