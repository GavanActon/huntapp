import { useRef, useState, type JSX } from 'react'
import { inRegion } from '../../config'
import { SPECIES_NAMES, tallies, useHuntLog } from '../../log/huntLog'
import { exportAllGpx, exportCsv } from '../../log/logExport'
import { outings, outingSummary, outingTitle } from '../../log/outings'
import { getMap } from '../../map/mapController'
import { useAppStore } from '../../state/appStore'
import { useGpsStore } from '../../tracking/gpsStore'
import { useTrackStore } from '../../tracking/trackStore'
import { useWindChecks, verdict } from '../../weather/micro/windChecks'
import { useLogForm } from '../LogCard'
import { useTapOff } from '../tapOff'
import './log.css'

/**
 * The Hunt log, which fills itself: one row per outing (log/outings.ts),
 * newest first. A row opens the outing at the top of the screen, over the
 * map. The ⋯ holds an entry by hand, the exports, and how the map is doing
 * against what was logged.
 */
export default function HuntLogSheet(): JSX.Element {
  // what the outings are cut from: re-listed when any of it moves
  useTrackStore((s) => s.tracks)
  const entries = useHuntLog((s) => s.entries)
  const checks = useWindChecks((s) => s.checks)
  useGpsStore((s) => s.locating)
  const closeSheet = useAppStore((s) => s.closeSheet)
  const setTopCard = useAppStore((s) => s.setTopCard)
  const [menu, setMenu] = useState(false)
  const [report, setReport] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  useTapOff(menuRef, menu, () => setMenu(false))

  const list = outings()

  const addEntry = () => {
    const fix = useGpsStore.getState().fix
    const c = getMap()?.getCenter()
    const at = fix && inRegion(fix.lon, fix.lat) ? { lon: fix.lon, lat: fix.lat } : c ? { lon: c.lng, lat: c.lat } : null
    if (!at) return
    closeSheet()
    useLogForm.getState().open(at.lon, at.lat)
  }

  const scored = checks.filter((c) => c.source === 'hand' && verdict(c) != null)
  const hits = scored.filter((c) => verdict(c) === 'agree').length
  const tally = tallies(entries)

  return (
    <div className="log">
      <div className="log-dots" ref={menuRef}>
        <button className="sheet-dots" aria-label="More" aria-expanded={menu} onClick={() => setMenu((v) => !v)}>
          ⋯
        </button>
        {menu && (
          <div className="menu-pop" role="menu">
            <button className="menu-row" role="menuitem" onClick={() => (setMenu(false), addEntry())}>
              Add an entry
            </button>
            <button className="menu-row" role="menuitem" disabled={!entries.length} onClick={() => (setMenu(false), void exportCsv(entries))}>
              Export CSV
            </button>
            <button className="menu-row" role="menuitem" onClick={() => (setMenu(false), void exportAllGpx())}>
              Export GPX
            </button>
            <button className="menu-row" role="menuitem" onClick={() => (setMenu(false), setReport((v) => !v))}>
              How the map is doing
            </button>
          </div>
        )}
      </div>

      {list.length === 0 && <div className="empty">Nothing yet</div>}
      {list.map((o) => {
        const title = outingTitle(o)
        const cut = title.indexOf(' · ')
        const head = cut < 0 ? title : title.slice(0, cut)
        const rest = cut < 0 ? '' : title.slice(cut + 3)
        return (
          <button
            key={o.id}
            className="log-row"
            onClick={() => {
              closeSheet()
              setTopCard({ kind: 'outing', id: o.id })
            }}
          >
            <span className="log-title">
              <b>{head}</b>
              {rest && <span className="dim"> · {rest}</span>}
            </span>
            <span className={`log-sum${o.blank ? ' dim' : ''}`}>{outingSummary(o)}</span>
            <span className="dim">›</span>
          </button>
        )
      })}

      {report && (
        <div className="log-report">
          {!tally.length && !scored.length && <div>Nothing to score yet</div>}
          {tally.map((t) => (
            <div key={t.species}>
              <b>{SPECIES_NAMES[t.species]}</b>:{' '}
              {t.n
                ? `${t.n} sighting${t.n > 1 ? 's' : ''} sat at the ${Math.round(t.meanPct)}th percentile of the map on average (50 is chance), ${Math.round(t.topQuarter * 100)}% in its top quarter`
                : 'no sightings with a map call yet'}
              {t.blanks ? ` · ${t.blanks} blank sit${t.blanks > 1 ? 's' : ''}` : ''}
              {t.n > 0 && t.n < 10 ? ' · too few to judge yet' : ''}
            </div>
          ))}
          {scored.length > 0 && (
            <div>
              <b>Wind checks</b> · model {hits}/{scored.length} agreed
            </div>
          )}
        </div>
      )}
    </div>
  )
}
