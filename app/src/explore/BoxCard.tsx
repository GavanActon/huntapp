import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { API } from '../analytics'
import { AREA_LIST } from '../areas'
import { switchArea } from '../areas/switch'
import { loadLocation } from '../areas/load'
import { provinceAt } from '../areas/runtime'
import { sdIndex } from '../weather/micro/windTiles'
import { devlog, installId } from '../devlog'
import { withMap } from '../map/mapController'
import { usePlacesStore } from '../state/placesStore'
import { useHdOrders } from '../state/hdOrders'
import { addedKm2, GRADE_SWITCH } from '../ui/grade'
import { fitBox } from './boxLayer'
import { atCap, bounds, boxId, centre, HD_MAX_KM2, HD_MAX_SIDE_KM, hdFits, packMb, sizeKm, tilesUnder } from './box'
import { tileAt } from './lattice'
import { useExplore, type CoverageProps } from './store'
import { useAppStore } from '../state/appStore'
import './explore.css'
import { dist, km2, kmIn, kmUnit } from '../lengths'

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
  // the coverage grid is read off its map layer, drawn only while Explore is on
  const exploring = useAppStore((s) => s.exploreMode)
  const addPlace = usePlacesStore((s) => s.add)
  const [busy, setBusy] = useState<'sd' | 'hd' | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [pinned, setPinned] = useState<string | null>(null)
  const [name, setName] = useState('')
  // how many of the box's tiles have their SD ground wind baked (R2's index); null till read
  const [sdHave, setSdHave] = useState<number | null>(null)
  const el = useRef<HTMLDivElement>(null)
  // a box put down or moved by a tap is shown whole under the card, now its height is known; a drag leaves the view be
  useLayoutEffect(() => {
    const s = useExplore.getState().selected
    const bottom = el.current?.getBoundingClientRect().bottom
    if (s && bottom != null) withMap((m) => fitBox(m, s.box, bottom))
    // the tap is the key: a drag changes the box, not the tap
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel?.lon, sel?.lat])
  const selId = sel ? boxId(sel.box) : null
  useEffect(() => {
    if (!sel) return
    let live = true
    setSdHave(null)
    void sdIndex().then((idx) => {
      if (live && idx) setSdHave(tilesUnder(sel.box).filter((t) => t.id in idx.tiles).length)
    })
    return () => {
      live = false
    }
    // the box, not the object: a drag makes a new one each move
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selId])
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
  // the areas the box reaches into, each opened on the middle of the ground they share (the location it moves, if any, left out)
  const baked = AREA_LIST.filter((a) => !a.virtual && a.id !== sel.replaces?.id && a.region.west < b.east && a.region.east > b.west && a.region.south < b.north && a.region.north > b.south)
  // a baked area under the box holds the load back (its own wind is better); loaded spots beside it do not
  const bakedHere = baked.some((a) => !a.loaded)
  const req = requested[id]
  // an extension grows an HD area: HD unless the grid, once read, says the new ground has no LiDAR
  const hdOk = (w.hd || (!!sel.extend && read.length === 0)) && hdFits(box)
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  // Load this spot (areas/load.ts): the box a location now, the forecast and the SD tiles' wind over it,
  // no request and no wait (Gavan, 2026-10-20). Over ground already loaded or baked, Open it instead
  const load = () => {
    const j = w.provs.split(',')[0]?.trim() || provinceAt(clon, clat)
    if (!loadLocation(box, name || sel!.replaces?.name || `Spot ${tileAt(clon, clat).id.slice(2)}`, j, sel!.replaces?.id)) setErr('Not loaded: the app stayed where it is.')
  }

  async function ask(kind: 'sd' | 'hd') {
    // the HD order the grade circle follows: an extension of an area, or HD over one
    const order = () => {
      const over = sel!.extend?.areaId ?? baked[0]?.id
      if (kind === 'hd') useHdOrders.getState().add({ boxId: id, areaId: over, name: sel!.extend?.name ?? baked[0]?.name ?? 'this box', kind: sel!.extend ? 'extend' : 'new', at: Date.now(), sim: GRADE_SWITCH })
    }
    // a dev build simulates HD: nothing is sent; the order shows in the grade sheet (state/hdOrders.ts)
    if (kind === 'hd' && GRADE_SWITCH) {
      markRequested(id, { kind, at: Date.now() })
      order()
      devlog('explore', `simulated HD order ${id}${sel!.extend ? ` · extends ${sel!.extend.areaId}` : ''}`)
      return
    }
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
          where: `${sel!.extend ? `extend ${sel!.extend.areaId} · ` : ''}${id} · ${b.south.toFixed(5)}, ${b.west.toFixed(5)} to ${b.north.toFixed(5)}, ${b.east.toFixed(5)} · ${size.w.toFixed(1)} × ${size.h.toFixed(1)} km`,
          lat: clat,
          lon: clon,
          tile: id,
          kind,
          source: 'app',
          // the phone, so the queue can say how its asks are getting on (explore/requests.ts)
          install: installId(),
        }),
      })
      if (!r.ok) throw new Error(`${r.status}`)
      const back = (await r.json().catch(() => null)) as { id?: number } | null
      markRequested(id, { kind, at: Date.now(), rid: typeof back?.id === 'number' ? back.id : undefined, stage: 'queued' })
      order()
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
            {kmIn(size.w).toFixed(1)} × {kmIn(size.h).toFixed(1)} {kmUnit()}
          </strong>{' '}
          <span className="dim">
            · {km2(size.km2)}{cap ? ' · the most for one ask' : ''}
          </span>
        </div>
        <button className="icon-btn" aria-label="Close" onClick={() => select(null)}>
          ×
        </button>
      </div>
      {sel.extend && (
        <div className="boxcard-extend">
          Extend <strong>{sel.extend.name}</strong>'s HD · adds about {km2(addedKm2(sel) ?? 0)}
        </div>
      )}
      <div className="dim boxcard-hint">Drag a corner to size it, the middle to move it.</div>
      <div className="boxcard-lines">
        {(read.length > 0 || exploring) && (
          <div>
            <span className={`boxcard-grade ${w.hd ? 'hd' : 'sd'}`}>{read.length ? w.grade : 'Reading the grid…'}</span> {w.provs ? <span className="dim">· {w.provs}</span> : null}
          </div>
        )}
        {read.length > 0 && (
          <>
            <div className="dim">{w.terrain}</div>
            <div className="dim">{w.stands}</div>
            <div className="dim">{w.water}</div>
            <div className="dim">weather at 2.5 km (HRDPS)</div>
          </>
        )}
        {sdHave != null && (
          <div className="dim">{sdHave === tiles.length ? 'ground wind: the SD tiles are in' : sdHave ? `ground wind: SD tiles under ${sdHave} of its ${tiles.length} cells, the forecast's wind elsewhere` : "ground wind: no SD tiles here yet, the forecast's wind"}</div>
        )}
        {baked.map((a) => (
          <div key={a.id}>
            {a.loaded ? 'Loaded' : 'Baked'}: <strong>{a.name}</strong> covers part of it.{' '}
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
            Requested · {req.kind.toUpperCase()} · {new Date(req.at).toLocaleDateString()} ·{' '}
            {GRADE_SWITCH && req.kind === 'hd' ? 'simulated on the dev build, nothing sent' : 'the email comes when it is ready'}{' '}
            <button className="link" onClick={cancel}>
              Cancel
            </button>
          </div>
        )}
      </div>
      {!sel.extend && !bakedHere && (
        <div className="boxcard-ask">
          <input type="text" placeholder="Name it (optional)" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          <div className="boxcard-btns">
            <button className="btn btn-primary" onClick={load}>
              {sel.replaces ? `Load ${sel.replaces.name} here` : 'Load this spot · the forecast and SD wind'}
            </button>
          </div>
        </div>
      )}
      {/* HD is the ask now (SD loads above): the email only with an HD button or its size note */}
      {!req && (hdOk || w.hd) && (
        <div className="boxcard-ask">
          {/* a dev build's HD order is simulated: no email to send it to */}
          {!(GRADE_SWITCH && sel.extend) && <input type="email" inputMode="email" placeholder="Your email, for the pack" value={email} onChange={(e) => setEmail(e.target.value)} />}
          <div className="boxcard-btns">
            {/* SD needs no ask now: Load above makes it a location at once (the SD request path stays for the Worker) */}
            {hdOk && (
              <button className="btn" disabled={busy != null} onClick={() => ask('hd')}>
                {busy === 'hd' ? 'Sending…' : `${sel.extend ? 'Extend HD' : 'Get HD'} · about ${packMb(box, 'hd')} MB`}
              </button>
            )}
          </div>
          {w.hd && !hdOk && (
            <div className="dim boxcard-note">
              HD up to {km2(HD_MAX_KM2)} and {dist(HD_MAX_SIDE_KM * 1000)} a side: a smaller box for HD
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
