import { useState } from 'react'
import { API } from '../analytics'
import { AREA_LIST, areaAt } from '../areas'
import { switchArea } from '../areas/switch'
import { devlog } from '../devlog'
import { usePlacesStore } from '../state/placesStore'
import { tileCentre } from './lattice'
import { useExplore, type CoverageProps } from './store'
import './explore.css'

/**
 * The tile card (docs/EXPLORE.md): what the ground under the tap can have,
 * at what resolution, read off the coverage index; what is baked there;
 * and the actions: ask for the tile (SD, free; HD where there is 1 m
 * LiDAR), pin the spot, or open the area that already covers it.
 */

function words(p: CoverageProps | null): { terrain: string; stands: string; water: string; weather: string; grade: string } {
  const lidar = p?.lidar ?? 0
  const terrain = lidar ? `1 m LiDAR, flown ${lidar}${(p?.lidarN ?? 0) > 1 ? ` (${p!.lidarN} surveys)` : ''}` : '30 m terrain (MRDEM)'
  const s = p?.stands ?? 'SCANFI'
  const stands = s === 'SCANFI' ? 'stands from the national 30 m model (SCANFI)' : s.startsWith('FRI') ? `${s} inventory stands` : s === 'VRI' ? 'VRI inventory stands' : `${s} inventory stands`
  const water = p?.water && !p.water.startsWith('national') ? `water and roads from ${p.water}` : 'water and roads not wired here yet'
  const grade = (p?.grade ?? 1) >= 2 ? 'HD possible' : 'SD only'
  return { terrain, stands, water, weather: 'weather at 2.5 km (HRDPS)', grade }
}

export default function TileCard() {
  const sel = useExplore((s) => s.selected)
  const requested = useExplore((s) => s.requested)
  const email = useExplore((s) => s.email)
  const setEmail = useExplore((s) => s.setEmail)
  const markRequested = useExplore((s) => s.markRequested)
  const select = useExplore((s) => s.select)
  const addPlace = usePlacesStore((s) => s.add)
  const [busy, setBusy] = useState<'sd' | 'hd' | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [pinned, setPinned] = useState(false)
  if (!sel) return null
  const cur = sel
  const { tile, props } = cur
  const w = words(props)
  const [clon, clat] = tileCentre(tile)
  const area = AREA_LIST.filter((a) => !a.virtual).find((a) => a.id === (areaAt(sel.lon, sel.lat)?.id ?? '')) ?? null
  const req = requested[tile.id]
  const hd = (props?.grade ?? 1) >= 2
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)

  async function ask(kind: 'sd' | 'hd') {
    if (!emailOk) {
      setErr('An email address: the pack is sent there when it is ready.')
      return
    }
    setBusy(kind)
    setErr(null)
    try {
      const r = await fetch(`${API}/api/request`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, where: `${tile.id} · ${cur.lat.toFixed(5)}, ${cur.lon.toFixed(5)}`, lat: cur.lat, lon: cur.lon, tile: tile.id, kind, source: 'app' }),
      })
      if (!r.ok) throw new Error(`${r.status}`)
      markRequested(tile.id, { kind, at: Date.now() })
      devlog('explore', `asked for ${tile.id} · ${kind}`)
    } catch (e) {
      setErr(navigator.onLine ? `Could not send the request (${(e as Error).message}). Try again with signal.` : 'No signal: the request needs one. Try again later.')
    } finally {
      setBusy(null)
    }
  }

  function pin() {
    addPlace({ name: `Spot ${tile.id.slice(2)}`, lon: cur.lon, lat: cur.lat, kind: 'stand', note: `Explore, ${new Date().toLocaleDateString()}` })
    setPinned(true)
  }

  return (
    <div className="tilecard glass" role="dialog" aria-label="This cell">
      <div className="tilecard-head">
        <div>
          <strong>Cell {tile.id.slice(2)}</strong> <span className="dim">· 11 km · {clat.toFixed(3)}, {clon.toFixed(3)}</span>
        </div>
        <button className="icon-btn" aria-label="Close" onClick={() => select(null)}>
          ×
        </button>
      </div>
      <div className="tilecard-lines">
        <div>
          <span className={`tilecard-grade ${hd ? 'hd' : 'sd'}`}>{w.grade}</span> {props?.prov ? <span className="dim">· {props.prov}</span> : null}
        </div>
        <div className="dim">{w.terrain}</div>
        <div className="dim">{w.stands}</div>
        <div className="dim">{w.water}</div>
        <div className="dim">{w.weather}</div>
        {area && (
          <div>
            Baked: <strong>{area.name}</strong> covers this spot.{' '}
            <button className="link" onClick={() => switchArea(area.id, { center: [sel.lon, sel.lat], zoom: 13 })}>
              Open it ›
            </button>
          </div>
        )}
        {req && (
          <div className="tilecard-req">
            Requested · {req.kind.toUpperCase()} · {new Date(req.at).toLocaleDateString()} · the email comes when it is ready
          </div>
        )}
      </div>
      {!area && !req && (
        <div className="tilecard-ask">
          <input type="email" inputMode="email" placeholder="Your email, for the pack" value={email} onChange={(e) => setEmail(e.target.value)} />
          <div className="tilecard-btns">
            <button className="btn" disabled={busy != null} onClick={() => ask('sd')}>
              {busy === 'sd' ? 'Sending…' : 'Get this cell (SD, free)'}
            </button>
            {hd && (
              <button className="btn" disabled={busy != null} onClick={() => ask('hd')}>
                {busy === 'hd' ? 'Sending…' : 'Get HD here'}
              </button>
            )}
          </div>
          {err && <div className="tilecard-err">{err}</div>}
        </div>
      )}
      <div className="tilecard-btns">
        <button className="btn quiet" disabled={pinned} onClick={pin}>
          {pinned ? 'Pinned' : 'Pin this spot'}
        </button>
      </div>
    </div>
  )
}
