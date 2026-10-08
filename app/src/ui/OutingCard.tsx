import { useEffect, useRef, useState, type JSX } from 'react'
import { otherAreaAt } from '../areas'
import { switchArea } from '../areas/switch'
import { showOutingSounds } from '../hunting/moveLayer'
import { SOUND_NAMES, SPECIES_NAMES, useHuntLog, WHAT_NAMES, type LogEntry } from '../log/huntLog'
import { exportOutingGpx } from '../log/logExport'
import { deleteOuting, outingBounds, outingById, outingChecks, outingElsewhere, outingEntries, outingTitle, renameOuting, type Outing } from '../log/outings'
import { getMap } from '../map/mapController'
import { fmtCoord } from '../map/MapView'
import { useAppStore } from '../state/appStore'
import { clockShort } from '../time'
import { useGpsStore } from '../tracking/gpsStore'
import { showOutingTrack } from '../tracking/trackLayer'
import { useTrackStore } from '../tracking/trackStore'
import { showOutingChecks } from '../weather/micro/checkLayer'
import { useWindChecks, verdict, type WindCheck } from '../weather/micro/windChecks'
import { checkWords, entryDetail } from '../log/eventText'
import { IconLocate, IconTrash } from './icons'
import { useTapOff } from './tapOff'
import './ground.css'
import './sheets/log.css'

/** the strip's top and a top card's height: what the fit keeps the outing under */
const TOP_PAD = 62 + 300 + 16

function dist(m: number, units: 'metric' | 'imperial'): string {
  if (units === 'imperial') {
    const mi = m / 1609.344
    return mi < 0.5 ? `${Math.round(m / 0.9144 / 10) * 10} yd` : `${mi.toFixed(1)} mi`
  }
  return m < 950 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`
}

function barHeight(): number {
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--barh'))
  return Number.isFinite(v) ? v : 0
}

/** The map round everything in the outing: its track, its sounds, its checks. */
function fitOuting(o: Outing) {
  const m = getMap()
  if (!m) return
  // in another area: the app switches there and opens this card again
  const away = outingElsewhere(o)
  if (away) return void switchArea(away.area.id, { center: away.center, zoom: 14 }, { kind: 'outing', id: o.id })
  const box = outingBounds(o)
  if (!box) return
  const [w, s, e, n] = box
  // the map goes where the outing was, not back to the next fix (as a drag does)
  useAppStore.getState().setFollow(false)
  const pad = { top: TOP_PAD, bottom: barHeight() + 90, left: 24, right: 80 }
  // a short screen: the padding must leave the map some room, or the fit refuses
  const room = m.getContainer().clientHeight - 60
  if (pad.top + pad.bottom > room) {
    const k = Math.max(0, room) / (pad.top + pad.bottom)
    pad.top = Math.round(pad.top * k)
    pad.bottom = Math.round(pad.bottom * k)
  }
  m.fitBounds(
    [
      [w, s],
      [e, n],
    ],
    { padding: pad, maxZoom: 16, duration: 600 },
  )
}

/** An entry's line: 'Moose ×2 (bull) · bull grunt' | 'Blank sit · moose'. */
function entryTitle(e: LogEntry): string {
  if (e.what === 'nothing') return `Blank sit · ${SPECIES_NAMES[e.species].toLowerCase()}`
  return `${SPECIES_NAMES[e.species]}${e.count && e.count > 1 ? ` ×${e.count}` : ''}${e.kind ? ` (${e.kind})` : ''} · ${e.sound ? SOUND_NAMES[e.sound].toLowerCase() : WHAT_NAMES[e.what].toLowerCase()}`
}

function checkTitle(c: WindCheck): string {
  return `${clockShort(c.ts)} · ${checkWords(c)}`
}

/** '4 heard · bull seen · 2 wind checks', from what the outing holds. */
function countsLine(o: Outing, entries: LogEntry[], checks: WindCheck[]): string {
  const parts: string[] = []
  if (o.heard) parts.push(`${o.heard} heard`)
  const seen = entries.filter((e) => e.what === 'seen').length
  const sign = entries.filter((e) => e.what === 'sign').length
  const blank = entries.filter((e) => e.what === 'nothing').length
  if (seen) parts.push(seen === 1 && o.seen ? o.seen : `${seen} seen`)
  if (sign) parts.push(`${sign} sign`)
  if (blank) parts.push(`blank sit`)
  if (checks.length) parts.push(`${checks.length} wind check${checks.length === 1 ? '' : 's'}`)
  return parts.join(' · ')
}

const BADGE = { agree: 'agreed', close: 'close', miss: 'missed' } as const

/** A sound or a wind check in the outing: its line, Go, Delete. */
function Row({ lon, lat, title, desc, badge, onDelete }: { lon: number; lat: number; title: string; desc?: string; badge?: keyof typeof BADGE | null; onDelete: () => void }) {
  return (
    <div className="oc-row">
      <div className="oc-text">
        <span className="oc-title">
          {title}
          {badge && <b className={`gc-verdict gc-${badge}`}>{BADGE[badge]}</b>}
        </span>
        {desc && <span className="oc-desc">{desc}</span>}
        <button
          className="oc-coord numeral"
          onClick={(ev) => {
            void navigator.clipboard?.writeText(fmtCoord(lon, lat))
            const b = ev.currentTarget
            b.textContent = 'Copied'
            window.setTimeout(() => (b.textContent = fmtCoord(lon, lat)), 900)
          }}
        >
          {fmtCoord(lon, lat)}
        </button>
      </div>
      <button
        className="icon-btn"
        aria-label="Go"
        onClick={() => {
          const zoom = Math.max(getMap()?.getZoom() ?? 14, 14)
          const other = otherAreaAt(lon, lat)
          // a look: follow stays off there, or a fix in that area takes the map off the point
          if (other) return void switchArea(other.id, { center: [lon, lat], zoom }, { kind: 'look' })
          getMap()?.easeTo({ center: [lon, lat], zoom })
        }}
      >
        <IconLocate size={15} />
      </button>
      <button className="icon-btn danger" aria-label="Delete" onClick={onDelete}>
        <IconTrash size={15} />
      </button>
    </div>
  )
}

/**
 * An outing from the Hunt log, a top card: its track, sounds and wind
 * checks on the map under it, the map fitted round them. ‹ goes back to
 * the log; ⋯ renames, exports or deletes it; the one row opens what was
 * heard and checked, in place.
 */
export default function OutingCard({ id }: { id: string }): JSX.Element | null {
  useTrackStore((s) => s.tracks)
  useHuntLog((s) => s.entries)
  useWindChecks((s) => s.checks)
  useGpsStore((s) => s.locating)
  const units = useAppStore((s) => s.units)
  const setTopCard = useAppStore((s) => s.setTopCard)
  const openSheet = useAppStore((s) => s.openSheet)
  const removeEntry = useHuntLog((s) => s.remove)
  const removeCheck = useWindChecks((s) => s.remove)
  const [menu, setMenu] = useState(false)
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  useTapOff(menuRef, menu, () => setMenu(false))
  // a tap off the card is for the map: the card goes, the hunt log stays
  // closed (‹ Back is the way back to the log)
  const cardRef = useRef<HTMLDivElement>(null)
  useTapOff(cardRef, true, () => setTopCard(null))

  const o = outingById(id)
  const from = o?.startMs
  const to = o?.endMs

  // back to the log as it was left (log/logView.ts): the same filter, the same days open
  const back = () => {
    setTopCard(null)
    openSheet({ kind: 'huntlog' })
  }

  // the outing on the map for as long as the card is up; the live layers come back after
  useEffect(() => {
    if (from == null || to == null) return
    const range = { from, to }
    showOutingTrack(range)
    showOutingSounds(range)
    showOutingChecks(range)
    return () => {
      showOutingTrack(null)
      showOutingSounds(null)
      showOutingChecks(null)
    }
  }, [from, to])

  // fitted once, when the card opens
  useEffect(() => {
    const cur = outingById(id)
    if (cur) fitOuting(cur)
  }, [id])

  // deleted from under the card (or an id that no longer exists): back to the log
  const gone = o == null
  useEffect(() => {
    if (!gone) return
    setTopCard(null)
    openSheet({ kind: 'huntlog' })
  }, [gone, setTopCard, openSheet])

  if (!o) return null
  const entries = outingEntries(o)
  const checks = outingChecks(o)
  // 'Sun 27 · evening' in the head's weight, '· 2 h 50 · 1.6 km' stepped back
  const segs = outingTitle(o).split(' · ')
  const head = segs.slice(0, -1).join(' · ') || segs[0]
  const rest = [...(segs.length > 1 ? [segs[segs.length - 1]] : []), ...(o.distanceM >= 20 ? [dist(o.distanceM, units)] : [])]
  const counts = countsLine(o, entries, checks)

  const del = () => {
    const what = [entries.length ? `${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}` : '', checks.length ? `${checks.length} wind check${checks.length === 1 ? '' : 's'}` : '']
      .filter(Boolean)
      .join(' and ')
    if (!confirm(`Delete ${outingTitle(o)}${what ? `, with its ${what}` : ''}?`)) return
    deleteOuting(o)
    back()
  }

  const rename = () => {
    const name = prompt('Name this outing', o.name ?? '')
    if (name == null) return
    renameOuting(o, name.trim())
  }

  // the rows in time order: sounds and checks as they came
  const rows: ({ kind: 'entry'; ts: number; e: LogEntry } | { kind: 'check'; ts: number; c: WindCheck })[] = [
    ...entries.map((e) => ({ kind: 'entry' as const, ts: e.ts, e })),
    ...checks.map((c) => ({ kind: 'check' as const, ts: c.ts, c })),
  ].sort((a, b) => a.ts - b.ts)

  return (
    <div className="topcard" role="region" aria-label="Outing" ref={cardRef}>
      <div className="topcard-head">
        <button className="topcard-back" aria-label="Back to the hunt log" onClick={back}>
          ‹
        </button>
        <span className="topcard-title">
          {head}
          {rest.length > 0 && <span className="oc-rest"> · {rest.join(' · ')}</span>}
        </span>
        <div className="sheet-actions" ref={menuRef}>
          <button className="sheet-dots" aria-label="More" aria-expanded={menu} onClick={() => setMenu((v) => !v)}>
            ⋯
          </button>
          {menu && (
            <div className="menu-pop" role="menu">
              <button className="menu-row" role="menuitem" disabled={!o.trackIds.length} onClick={() => (setMenu(false), rename())}>
                Rename
              </button>
              <button className="menu-row" role="menuitem" onClick={() => (setMenu(false), void exportOutingGpx(o))}>
                Export GPX
              </button>
              <button className="menu-row danger" role="menuitem" onClick={() => (setMenu(false), del())}>
                Delete
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="topcard-body">
        {rows.length === 0 ? (
          <div className="oc-empty">Nothing heard or checked</div>
        ) : (
          <button className="topcard-row" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            <span className="oc-amber">{counts}</span>
            <span className="dim">{open ? '⌃' : '›'}</span>
          </button>
        )}
        {open &&
          rows.map((r) =>
            r.kind === 'entry' ? (
              <Row key={r.e.id} lon={r.e.lon} lat={r.e.lat} title={entryTitle(r.e)} desc={entryDetail(r.e)} onDelete={() => confirm('Delete this entry?') && removeEntry(r.e.id)} />
            ) : (
              <Row key={r.c.id} lon={r.c.lon} lat={r.c.lat} title={checkTitle(r.c)} badge={verdict(r.c)} desc={r.c.note} onDelete={() => confirm('Delete this wind check?') && removeCheck(r.c.id)} />
            ),
          )}
      </div>
    </div>
  )
}
