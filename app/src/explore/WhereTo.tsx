import { useEffect, useRef, useState } from 'react'
import { parseCoords, placeWords } from '../map/coords'
import { goToSpot } from '../map/goto'
import { useGpsStore } from '../tracking/gpsStore'
import { useExplore } from './store'

/**
 * Where to, in Explore (Gavan, 2026-10-07: "hard to see where you're
 * looking on just a green screen"): a box that takes a lake or a town by
 * name, through NRCan's Canadian Geographical Names service, or
 * coordinates in any form the app reads (map/coords.ts: decimal, degrees
 * and minutes, a pasted link), and eases the map there with a ring on
 * the spot. It sits in the bottom bar while no cell is picked.
 */

const NAMES = 'https://geogratis.gc.ca/services/geoname/en/geonames.json'
const PROV: Record<string, string> = { '10': 'NL', '11': 'PE', '12': 'NS', '13': 'NB', '24': 'QC', '35': 'ON', '46': 'MB', '47': 'SK', '48': 'AB', '59': 'BC', '60': 'YT', '61': 'NT', '62': 'NU' }
const KIND: Record<string, string> = {
  LAKE: 'lake', RIV: 'river', CRK: 'creek', BAY: 'bay', ISL: 'island', PEN: 'point', CAPE: 'point', FALL: 'falls', RAP: 'rapids',
  MTN: 'mountain', HILL: 'hill', VALL: 'valley', PLN: 'plain', MARSH: 'marsh', SWMP: 'swamp', BOG: 'bog', FOR: 'forest', PARK: 'park',
  CITY: 'city', TOWN: 'town', VILG: 'village', HAM: 'hamlet', UNP: 'place', IR: 'reserve', LOC: 'locality', CAMP: 'camp', RES: 'reserve',
}

interface Hit {
  name: string
  kind: string
  prov: string
  where: string
  lon: number
  lat: number
}

interface NamesItem {
  name?: string
  latitude?: number
  longitude?: number
  location?: string
  concise?: { code?: string }
  province?: { code?: string }
}

async function lookup(q: string, signal: AbortSignal): Promise<Hit[]> {
  const r = await fetch(`${NAMES}?${new URLSearchParams({ q, num: '8' })}`, { signal })
  if (!r.ok) throw new Error(`${r.status}`)
  const j = (await r.json()) as { items?: NamesItem[] }
  return (j.items ?? [])
    .filter((i) => i.name && Number.isFinite(i.latitude) && Number.isFinite(i.longitude))
    .map((i) => ({
      name: i.name!,
      kind: KIND[i.concise?.code ?? ''] ?? (i.concise?.code ?? '').toLowerCase(),
      prov: PROV[i.province?.code ?? ''] ?? '',
      where: i.location ?? '',
      lon: i.longitude!,
      lat: i.latitude!,
    }))
}

export default function WhereTo() {
  const selected = useExplore((s) => s.selected)
  const fix = useGpsStore((s) => s.fix)
  const [text, setText] = useState('')
  const [hits, setHits] = useState<Hit[]>([])
  const [state, setState] = useState<'idle' | 'looking' | 'none' | 'offline'>('idle')
  const ctl = useRef<AbortController | null>(null)
  const q = text.trim()
  const point = parseCoords(q)

  useEffect(() => {
    ctl.current?.abort()
    if (point || q.length < 2) {
      setHits([])
      setState('idle')
      return
    }
    if (!navigator.onLine) {
      setHits([])
      setState('offline')
      return
    }
    const c = new AbortController()
    ctl.current = c
    setState('looking')
    const t = setTimeout(() => {
      lookup(q, c.signal)
        .then((h) => {
          if (c.signal.aborted) return
          setHits(h)
          setState(h.length ? 'idle' : 'none')
        })
        .catch(() => {
          if (!c.signal.aborted) setState('none')
        })
    }, 350)
    return () => {
      clearTimeout(t)
      c.abort()
    }
    // the point is derived from q
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  if (selected) return null

  const go = (lon: number, lat: number, name?: string) => {
    goToSpot({ lon, lat, name, z: 11 })
    setText('')
    setHits([])
  }

  async function paste() {
    try {
      const t = await navigator.clipboard.readText()
      if (t) setText(t)
    } catch {
      /* no clipboard access: typing it is */
    }
  }

  return (
    <div className="whereto glass" role="search" aria-label="Where to">
      <div className="whereto-row">
        <input
          type="search"
          inputMode="search"
          placeholder="A lake, a town, or coordinates"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              if (point) go(point.lon, point.lat)
              else if (hits[0]) go(hits[0].lon, hits[0].lat, hits[0].name)
            }
          }}
        />
        <button className="btn quiet" onClick={paste} aria-label="Paste">
          Paste
        </button>
        {fix && (
          <button className="btn quiet" onClick={() => go(fix.lon, fix.lat)} aria-label="Where I am">
            Me
          </button>
        )}
      </div>
      {(point || hits.length > 0 || state !== 'idle') && (
        <div className="whereto-hits">
          {point && (
            <button className="whereto-hit" onClick={() => go(point.lon, point.lat)}>
              <span>Go to {placeWords(point)}</span>
              <span className="dim">coordinates</span>
            </button>
          )}
          {hits.map((h, k) => (
            <button key={k} className="whereto-hit" onClick={() => go(h.lon, h.lat, h.name)}>
              <span>{h.name}</span>
              <span className="dim">
                {h.kind}
                {h.where ? ` · ${h.where}` : ''}
                {h.prov ? ` · ${h.prov}` : ''}
              </span>
            </button>
          ))}
          {!point && state === 'looking' && <div className="dim whereto-note">Looking…</div>}
          {!point && state === 'none' && <div className="dim whereto-note">No name like that in the Canadian names register</div>}
          {!point && state === 'offline' && <div className="dim whereto-note">No signal: names need one; coordinates work</div>}
        </div>
      )}
    </div>
  )
}
