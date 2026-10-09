import { useLayoutEffect, useRef, useState } from 'react'
import { API } from '../analytics'
import { AREA_LIST } from '../areas'
import { switchArea } from '../areas/switch'
import { devlog } from '../devlog'
import { withMap } from '../map/mapController'
import { usePlacesStore } from '../state/placesStore'
import { fitBox } from './boxLayer'
import { atCap, bounds, boxId, centre, HD_MAX_KM2, HD_MAX_SIDE_KM, hdFits, packMb, sizeKm, tilesUnder } from './box'
import { tileAt } from './lattice'
import { useExplore, type CoverageProps } from './store'
import './explore.css'

/**
 * The box card (docs/EXPLORE.md): the box's size, what the ground under it
 * can have, summed over the lattice tiles it covers (read off the coverage
 * index), what is baked there, and the actions: ask for it (SD, free; HD
 * where every tile under it has 1 m LiDAR and it is small enough), pin its
 * middle, or open an area that already covers part of it.
 */

const uniq = (xs: string[]) => [...new Set(xs)]

/** "2019" or "2017–2022" */
function years(ys: number[]): string {
  const lo = Math.min(...ys)
  const hi = Math.max(...ys)
  return lo === hi ? `${lo}` : `${lo}–${hi}`
}

function standsWord(p: CoverageProps): string {
  const s = p.stands ?? 'SCANFI'
  return s === 'SCANFI' ? 'stands from the national 30 m model (SCANFI)' : `${s} inventory stands`
}

function words(ps: CoverageProps[], n: number) {
  const lidar = ps.filter((p) => (p.lidar ?? 0) > 0)
  const hdN = ps.filter((p) => (p.grade ?? 1) >= 2).length
  const flown = lidar.length ? years(lidar.map((p) => p.lidar!)) : ''
  const terrain = !lidar.length ? '30 m terrain (MRDEM)' : lidar.length === n ? `1 m LiDAR, flown ${flown}` : `1 m LiDAR under ${lidar.length} of its ${n} cells (flown ${flown}), 30 m terrain elsewhere`
  const stands = uniq(ps.map(standsWord)).join('; ') || standsWord({})
  const water = uniq(ps.map((p) => p.water ?? '').filter((w) => w && !w.startsWith('national')))
  const grade = hdN === n ? 'HD possible' : hdN ? `HD possible on ${hdN} of its ${n} cells` : 'SD only'
  return {
    hd: hdN === n,
    grade,
    terrain,
    stands,
    water: water.length ? `water and roads from ${water.join(' and ')}` : 'water and roads not wired here yet',
    provs: uniq(ps.map((p) => p.prov ?? '').filter(Boolean)).join(', '),
  }
}

export default function BoxCard() {
  const sel = useExplore((s) => s.selected)
  const cover = useExplore((s) => s.cover)
  const requested = useExplore((s) => s.requested)
  const email = useExplore((s) => s.email)
  const setEmail = useExplore((s) => s.setEmail)
  const markRequested = useExplore((s) => s.markRequested)
  const unrequest = useExplore((s) => s.unrequest)
  const select = useExplore((s) => s.select)
  const addPlace = usePlacesStore((s) => s.add)
  const [busy, setBusy] = useState<'sd' | 'hd' | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [pinned, setPinned] = useState<string | null>(null)
  const el = useRef<HTMLDivElement>(null)
  // a box put down or moved by a tap is shown whole under the card, now its height is known; a drag leaves the view be
  useLayoutEffect(() => {
    const s = useExplore.getState().selected
    const bottom = el.current?.getBoundingClientRect().bottom
    if (s && bottom != null) withMap((m) => fitBox(m, s.box, bottom))
    // the tap is the key: a drag changes the box, not the tap
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel?.lon, sel?.lat])
  if (!sel) return null
  const { box } = sel
  const id = boxId(box)
  const size = sizeKm(box)
  const cap = atCap(box)
  const tiles = tilesUnder(box)
  const read = tiles.map((t) => cover[t.id]).filter((p): p is CoverageProps => p != null)
  const w = words(read, tiles.length)
  const b = bounds(box)
  const [clon, clat] = centre(box)
  // the baked areas the box reaches into, each opened on the middle of the ground they share
  const baked = AREA_LIST.filter((a) => !a.virtual && a.region.west < b.east && a.region.east > b.west && a.region.south < b.north && a.region.north > b.south)
  const req = requested[id]
  const hdOk = w.hd && hdFits(box)
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
        // the box rides in `tile` (b-<x0>-<y0>-<x1>-<y1>, habitat-cell indices: explore/box.ts) and in words in `where`
        body: JSON.stringify({
          email,
          where: `${id} · ${b.south.toFixed(5)}, ${b.west.toFixed(5)} to ${b.north.toFixed(5)}, ${b.east.toFixed(5)} · ${size.w.toFixed(1)} × ${size.h.toFixed(1)} km`,
          lat: clat,
          lon: clon,
          tile: id,
          kind,
          source: 'app',
        }),
      })
      if (!r.ok) throw new Error(`${r.status}`)
      markRequested(id, { kind, at: Date.now() })
      devlog('explore', `asked for ${id} · ${kind} · ${size.w.toFixed(1)}×${size.h.toFixed(1)} km`)
    } catch (e) {
      setErr(navigator.onLine ? `Could not send the request (${(e as Error).message}). Try again with signal.` : 'No signal: the request needs one. Try again later.')
    } finally {
      setBusy(null)
    }
  }

  async function cancel() {
    // the mark goes now; the queue hears when there is signal (the Worker
    // sets the ask to cancelled; one still being baked just is not sent)
    unrequest(id)
    try {
      await fetch(`${API}/api/request`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ cancel: true, email, tile: id, source: 'app' }),
      })
      devlog('explore', `cancelled ${id}`)
    } catch {
      devlog('explore', `cancel of ${id} not sent`)
    }
  }

  function pin() {
    addPlace({ name: `Spot ${tileAt(clon, clat).id.slice(2)}`, lon: clon, lat: clat, kind: 'stand', note: `Explore, ${new Date().toLocaleDateString()}` })
    setPinned(id)
  }

  return (
    <div className="boxcard glass" role="dialog" aria-label="This box" ref={el}>
      <div className="boxcard-head">
        <div>
          <strong className={cap ? 'boxcard-cap' : undefined}>
            {size.w.toFixed(1)} × {size.h.toFixed(1)} km
          </strong>{' '}
          <span className="dim">
            · {Math.round(size.km2)} km²{cap ? ' · the most for one ask' : ''}
          </span>
        </div>
        <button className="icon-btn" aria-label="Close" onClick={() => select(null)}>
          ×
        </button>
      </div>
      <div className="dim boxcard-hint">Drag a corner to size it, the middle to move it.</div>
      <div className="boxcard-lines">
        <div>
          <span className={`boxcard-grade ${w.hd ? 'hd' : 'sd'}`}>{read.length ? w.grade : 'Reading the grid…'}</span> {w.provs ? <span className="dim">· {w.provs}</span> : null}
        </div>
        {read.length > 0 && (
          <>
            <div className="dim">{w.terrain}</div>
            <div className="dim">{w.stands}</div>
            <div className="dim">{w.water}</div>
            <div className="dim">weather at 2.5 km (HRDPS)</div>
          </>
        )}
        {baked.map((a) => (
          <div key={a.id}>
            Baked: <strong>{a.name}</strong> covers part of it.{' '}
            <button
              className="link"
              onClick={() => {
                const lon = (Math.max(a.region.west, b.west) + Math.min(a.region.east, b.east)) / 2
                const lat = (Math.max(a.region.south, b.south) + Math.min(a.region.north, b.north)) / 2
                switchArea(a.id, { center: [lon, lat], zoom: 13 })
              }}
            >
              Open it ›
            </button>
          </div>
        ))}
        {req && (
          <div className="boxcard-req">
            Requested · {req.kind.toUpperCase()} · {new Date(req.at).toLocaleDateString()} · the email comes when it is ready{' '}
            <button className="link" onClick={cancel}>
              Cancel
            </button>
          </div>
        )}
      </div>
      {!req && (
        <div className="boxcard-ask">
          <input type="email" inputMode="email" placeholder="Your email, for the pack" value={email} onChange={(e) => setEmail(e.target.value)} />
          <div className="boxcard-btns">
            <button className="btn" disabled={busy != null} onClick={() => ask('sd')}>
              {busy === 'sd' ? 'Sending…' : `Get SD · free · about ${packMb(box, 'sd')} MB`}
            </button>
            {hdOk && (
              <button className="btn" disabled={busy != null} onClick={() => ask('hd')}>
                {busy === 'hd' ? 'Sending…' : `Get HD · about ${packMb(box, 'hd')} MB`}
              </button>
            )}
          </div>
          {w.hd && !hdOk && (
            <div className="dim boxcard-note">
              HD up to {HD_MAX_KM2} km² and {HD_MAX_SIDE_KM} km a side: a smaller box for HD
            </div>
          )}
          {err && <div className="boxcard-err">{err}</div>}
        </div>
      )}
      <div className="boxcard-btns">
        <button className="btn quiet" disabled={pinned === id} onClick={pin}>
          {pinned === id ? 'Pinned' : 'Pin the middle'}
        </button>
      </div>
    </div>
  )
}
