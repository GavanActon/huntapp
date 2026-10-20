import { useEffect, useRef, useState, type JSX } from 'react'
import { ACTIVE_AREA, AREA_LIST, areaAt, type AreaDef } from '../../areas'
import { switchArea } from '../../areas/switch'
import { dropLocation, keepLocation, readLocations } from '../../areas/runtime'
import { setExplore } from '../../explore'
import { boxAround } from '../../explore/box'
import { useExplore } from '../../explore/store'
import { parseBoxId, centre } from '../../explore/box'
import { checkAsks, stageWords } from '../../explore/requests'
import { areaById, forgetArea } from '../../areas'
import { getMap } from '../../map/mapController'
import { removeFiles, useDownloads } from '../../offline/downloads'
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
  // this phone's asks for HD, and how the queue says each is getting on (explore/requests.ts)
  const requested = useExplore((s) => s.requested)
  const asks = Object.entries(requested).filter(([, r]) => r.kind === 'hd' && r.stage !== 'cancelled').sort((a, b) => b[1].at - a[1].at)
  useEffect(() => checkAsks(), [])
  // what a row's Share says when the message went to the clipboard, or did not
  const [said, setSaid] = useState<{ id: string; text: string } | null>(null)
  // loaded locations removed this run: gone from the phone, gone from the list (the area list is the start's)
  const [dropped, setDropped] = useState<string[]>([])
  // loaded spots renamed this run (the area list is the start's)
  const [names, setNames] = useState<Record<string, string>>({})
  /** A loaded spot named again: kept so; the one the app is in reloads under it (its camp pin is named at start) */
  const rename = (a: AreaDef) => {
    const now = names[a.id] ?? a.name
    const v = window.prompt('Name this spot', now)?.trim().slice(0, 60)
    const l = readLocations().find((x) => x.id === a.id)
    if (!v || v === now || !l) return
    keepLocation({ ...l, name: v })
    if (a.id === ACTIVE_AREA.id) {
      const u = new URL(window.location.href)
      u.searchParams.set('name', v)
      window.location.replace(u.toString())
    } else setNames((n) => ({ ...n, [a.id]: v }))
  }
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
        {AREA_LIST.filter((a) => !a.virtual && !dropped.includes(a.id)).map((a) => {
          const here = a.id === ACTIVE_AREA.id
          const b = bundleOf(a.id)
          const saved = b != null && keepsArea(b)
          return (
            <div key={a.id} className={`place-row${here ? ' place-current' : ''}`}>
              <button className="row-text place-go" onClick={() => go(a)}>
                <span className="row-title">{names[a.id] ?? a.name}</span>
                <span className="row-desc">
                  {a.loaded ? 'Loaded · forecast and SD wind' : (a.presets[0]?.name ?? '')}
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
              {a.loaded && (
                <button className="icon-btn" aria-label={`Rename ${a.name}`} onClick={() => rename(a)}>
                  ✎
                </button>
              )}
              {a.loaded && (
                <button
                  className="icon-btn"
                  aria-label={`Move or resize ${a.name}`}
                  onClick={() => {
                    // the box with its handles on the map, the card's Load taking this one's place (explore/BoxCard.tsx)
                    const box = parseBoxId(a.id)
                    if (!box) return
                    closeSheet()
                    const [lon, lat] = centre(box)
                    useExplore.getState().select({ box, lon, lat, replaces: { id: a.id, name: a.name } })
                  }}
                >
                  ⤢
                </button>
              )}
              {a.loaded && !here && (
                <button
                  className="icon-btn"
                  aria-label={`Remove ${a.name}`}
                  onClick={() => {
                    if (!confirm(`Remove ${a.name} from your locations?`)) return
                    // its saved maps go with it, but for the tiles a neighbouring spot still uses (removeFiles)
                    const files = bundleOf(a.id)?.files ?? []
                    dropLocation(a.id)
                    if (files.length) void removeFiles(files, a.id)
                    forgetArea(a.id)
                    setDropped((d) => [...d, a.id])
                  }}
                >
                  ×
                </button>
              )}
            </div>
          )
        })}
        {asks.map(([id, r]) => {
          const box = parseBoxId(id)
          const ready = r.stage === 'done' && r.areaId ? areaById(r.areaId) : null
          const at = box ? centre(box) : null
          return (
            <div key={id} className="place-row">
              <button
                className="row-text place-go"
                onClick={() => {
                  if (ready) return go(ready)
                  closeSheet()
                  if (at) getMap()?.easeTo({ center: at, zoom: 12 })
                }}
              >
                <span className="row-title">HD · {ready?.name ?? (r.areaId || `asked ${new Date(r.at).toLocaleDateString()}`)}</span>
                <span className="row-desc">
                  {stageWords(r)}
                  {r.stage === 'done' && !ready ? ' · it opens here once the app updates' : ''}
                </span>
              </button>
            </div>
          )
        })}
        <div className="place-row">
          <button className="row-text place-go" onClick={add}>
            <span className="row-title">Add a location</span>
            <span className="row-desc">a box round the spot: load it for the forecast and wind, or ask for HD</span>
          </button>
        </div>
      </div>
    </div>
  )
}
