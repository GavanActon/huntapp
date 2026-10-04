import { useRef, useState, type JSX } from 'react'
import { otherAreaAt } from '../../areas'
import { switchArea } from '../../areas/switch'
import { inRegion } from '../../config'
import { checkWords, entryDetail } from '../../log/eventText'
import { SPECIES_NAMES, tallies, useHuntLog, type LogEntry } from '../../log/huntLog'
import { exportAllGpx, exportCsv } from '../../log/logExport'
import { entryTitle, showLogPopup } from '../../log/logLayer'
import { LOG_FILTER_NAMES, LOG_FILTERS, logView, type LogFilter } from '../../log/logView'
import { outingElsewhere, outings, outingSummary, outingTitle, type Outing } from '../../log/outings'
import { getMap } from '../../map/mapController'
import { useAppStore } from '../../state/appStore'
import { dateShort, dayShort, hourMinShort, startOfDayMs } from '../../time'
import { useGpsStore } from '../../tracking/gpsStore'
import { useTrackStore } from '../../tracking/trackStore'
import { showCheckPopup } from '../../weather/micro/checkLayer'
import { aloftVerdict, useWindChecks, verdict, type WindCheck } from '../../weather/micro/windChecks'
import { biasMatters, biasWords, LESSON_WORDS, lessonScores } from '../../weather/micro/bias'
import { IconTrack } from '../icons'
import { useLogForm } from '../LogCard'
import { useTapOff } from '../tapOff'
import './log.css'

/**
 * The Hunt log, which fills itself: every event (a sound, a sighting, sign,
 * a blank sit, a wind check, an outing) under its day, newest first. Today
 * is open and the days before are folded; a tap on a day opens or folds it.
 * The chips on top show one kind of event, and the buttons that open the
 * log pick one (log/logView.ts): the Heard button's drawer opens it on what
 * was heard. A tap on an event takes the map to it with its popup up; an
 * outing opens over the map. The ⋯ holds an entry by hand, the exports and
 * how the map is doing against what was logged.
 */

type Kind = Exclude<LogFilter, 'all'>

type LogEvent = { key: string; ts: number; kind: Kind } & ({ type: 'entry'; e: LogEntry } | { type: 'check'; c: WindCheck } | { type: 'outing'; o: Outing })

function entryKind(e: LogEntry): Kind {
  if (e.what === 'heard' || e.what === 'called') return 'heard'
  if (e.what === 'nothing') return 'blank'
  return e.what
}

/** The map's dot colours (log/logLayer.ts), so a row and its dot read as one. */
const DOT: Record<LogEntry['what'], string> = { seen: '#ff6b4a', called: '#ff3d7f', heard: '#ffb347', sign: '#d8b36a', nothing: 'transparent' }

/** A day's few words: '3 heard · 1 seen · 2 checks'. */
const COUNT_WORDS: Record<Kind, [string, string]> = {
  heard: ['heard', 'heard'],
  seen: ['seen', 'seen'],
  sign: ['sign', 'sign'],
  blank: ['blank sit', 'blank sits'],
  wind: ['check', 'checks'],
  outings: ['outing', 'outings'],
}

function countsLine(evs: LogEvent[]): string {
  const n = new Map<Kind, number>()
  for (const v of evs) n.set(v.kind, (n.get(v.kind) ?? 0) + 1)
  return (Object.keys(COUNT_WORDS) as Kind[])
    .filter((k) => n.get(k))
    .map((k) => `${n.get(k)} ${COUNT_WORDS[k][n.get(k) === 1 ? 0 : 1]}`)
    .join(' · ')
}

function dayName(dayMs: number, todayMs: number): string {
  if (dayMs === todayMs) return 'Today'
  if (dayMs === startOfDayMs(todayMs - 12 * 3600_000)) return 'Yesterday'
  return `${dayShort(dayMs)} ${dateShort(dayMs)}`
}

/** 'Evening · 2 h 50' from 'Sun 27 · evening · 2 h 50': the day is the group's. */
function outingWords(o: Outing): string {
  const rest = outingTitle(o).split(' · ').slice(1).join(' · ')
  return rest.charAt(0).toUpperCase() + rest.slice(1)
}

/** The mark at the head of a row: the entry's dot as on the map, the check's arrow the way the wind went, a track for an outing. */
function Mark({ ev }: { ev: LogEvent }) {
  if (ev.type === 'outing') return <IconTrack size={16} />
  if (ev.type === 'check') {
    const c = ev.c
    if (c.dirFrom == null) return <span className="log-mark log-calm" />
    return (
      <svg className="log-arrow" width="16" height="16" viewBox="0 0 16 16" style={{ transform: `rotate(${(c.dirFrom + 180) % 360}deg)` }}>
        <path d="M8 2 L12 8 H9 V14 H7 V8 H4 Z" fill="currentColor" />
      </svg>
    )
  }
  const w = ev.e.what
  return <span className={`log-mark${w === 'nothing' ? ' log-hollow' : ''}`} style={{ background: DOT[w] }} />
}

export default function HuntLogSheet(): JSX.Element {
  // what the events are made of: re-listed when any of it moves
  useTrackStore((s) => s.tracks)
  const entries = useHuntLog((s) => s.entries)
  const checks = useWindChecks((s) => s.checks)
  useGpsStore((s) => s.locating)
  const closeSheet = useAppStore((s) => s.closeSheet)
  const setTopCard = useAppStore((s) => s.setTopCard)
  const [menu, setMenu] = useState(false)
  const [report, setReport] = useState(false)
  const [filter, setFilterState] = useState<LogFilter>(logView.filter)
  const todayMs = startOfDayMs(Date.now())
  const [open, setOpenState] = useState<number[]>(logView.open ?? [todayMs])
  const menuRef = useRef<HTMLDivElement>(null)
  useTapOff(menuRef, menu, () => setMenu(false))

  // kept outside the sheet, so an outing opened from here comes back to the same view
  const setFilter = (f: LogFilter) => {
    logView.filter = f
    setFilterState(f)
  }
  const toggleDay = (d: number) => {
    const next = open.includes(d) ? open.filter((x) => x !== d) : [...open, d]
    logView.open = next
    setOpenState(next)
  }

  const all: LogEvent[] = [
    ...entries.map((e): LogEvent => ({ key: e.id, ts: e.ts, kind: entryKind(e), type: 'entry', e })),
    ...checks.filter((c) => c.source === 'hand').map((c): LogEvent => ({ key: c.id, ts: c.ts, kind: 'wind', type: 'check', c })),
    ...outings().map((o): LogEvent => ({ key: o.id, ts: o.startMs, kind: 'outings', type: 'outing', o })),
  ].sort((a, b) => b.ts - a.ts)
  const counts = new Map<LogFilter, number>([['all', all.length]])
  for (const v of all) counts.set(v.kind, (counts.get(v.kind) ?? 0) + 1)
  const shown = filter === 'all' ? all : all.filter((v) => v.kind === filter)

  // the days, newest first; today always, open or not, even with nothing in it yet
  const days = new Map<number, LogEvent[]>([[todayMs, []]])
  for (const v of shown) {
    const d = startOfDayMs(v.ts)
    days.set(d, [...(days.get(d) ?? []), v])
  }
  const dayList = [...days.entries()].sort((a, b) => b[0] - a[0])

  const addEntry = () => {
    const fix = useGpsStore.getState().fix
    const c = getMap()?.getCenter()
    const at = fix && inRegion(fix.lon, fix.lat) ? { lon: fix.lon, lat: fix.lat } : c ? { lon: c.lng, lat: c.lat } : null
    if (!at) return
    closeSheet()
    useLogForm.getState().open(at.lon, at.lat)
  }

  /** The map to an event, its popup up (Delete is there); an outing opens
   *  over the map. One in another area switches the app there first, and
   *  the popup or the outing comes up once it has opened. */
  const go = (ev: LogEvent) => {
    if (ev.type === 'outing') {
      const away = outingElsewhere(ev.o)
      if (away) return void switchArea(away.area.id, { center: away.center, zoom: 14 }, { kind: 'outing', id: ev.o.id })
      closeSheet()
      return setTopCard({ kind: 'outing', id: ev.o.id })
    }
    const { lon, lat } = ev.type === 'entry' ? ev.e : ev.c
    const other = otherAreaAt(lon, lat)
    if (other) return void switchArea(other.id, { center: [lon, lat], zoom: Math.max(getMap()?.getZoom() ?? 15, 15) }, ev.type === 'entry' ? { kind: 'entry', id: ev.e.id } : { kind: 'check', id: ev.c.id })
    closeSheet()
    const m = getMap()
    if (!m) return
    useAppStore.getState().setFollow(false)
    m.easeTo({ center: [lon, lat], zoom: Math.max(m.getZoom(), 15), duration: 500 })
    if (ev.type === 'entry') showLogPopup(m, ev.e)
    else showCheckPopup(m, ev.c.id)
  }

  const scored = checks.filter((c) => c.source === 'hand' && verdict(c) != null)
  const hits = scored.filter((c) => verdict(c) === 'agree').length
  const aloftN = checks.filter((c) => aloftVerdict(c) != null).length
  const aloftHits = checks.filter((c) => aloftVerdict(c) === 'agree').length
  const tally = tallies(entries)

  const row = (ev: LogEvent) => {
    let title: string
    let desc = ''
    let badge: ReturnType<typeof verdict> = null
    if (ev.type === 'entry') {
      title = entryTitle(ev.e)
      desc = entryDetail(ev.e, false)
    } else if (ev.type === 'check') {
      title = `Wind · ${checkWords(ev.c)}`
      badge = verdict(ev.c)
      desc = [ev.c.by, ev.c.note].filter(Boolean).join(' · ')
    } else {
      title = outingWords(ev.o)
      desc = outingSummary(ev.o)
    }
    return (
      <button key={ev.key} className="log-ev" onClick={() => go(ev)}>
        <span className="log-ev-time numeral">{hourMinShort(ev.ts)}</span>
        <span className={`log-ev-mark log-k-${ev.kind}`}>
          <Mark ev={ev} />
        </span>
        <span className="log-ev-text">
          <span className="log-ev-title">
            {title}
            {badge && <b className={`gc-verdict gc-${badge}`}>{badge === 'agree' ? 'agreed' : badge === 'close' ? 'close' : 'missed'}</b>}
          </span>
          {desc && <span className={`log-ev-desc${ev.type === 'outing' && !ev.o.blank ? ' log-amber' : ''}`}>{desc}</span>}
        </span>
        <span className="dim">›</span>
      </button>
    )
  }

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

      <div className="log-filters" role="radiogroup" aria-label="Show">
        {LOG_FILTERS.map((f) => (
          <button key={f} className={`chip-pick${filter === f ? ' chip-on' : ''}`} role="radio" aria-checked={filter === f} onClick={() => setFilter(f)}>
            {LOG_FILTER_NAMES[f]}
            {f !== 'all' && <span className="log-n numeral">{counts.get(f) ?? 0}</span>}
          </button>
        ))}
      </div>

      {dayList.map(([d, evs]) => {
        const isOpen = open.includes(d)
        return (
          <div key={d} className="log-day">
            <button className="log-day-head" aria-expanded={isOpen} onClick={() => toggleDay(d)}>
              <b>{dayName(d, todayMs)}</b>
              <span className="log-day-sum">{evs.length ? countsLine(evs) : 'nothing'}</span>
              <span className="dim">{isOpen ? '⌃' : '›'}</span>
            </button>
            {isOpen &&
              (evs.length ? (
                evs.map(row)
              ) : (
                <div className="log-none">{filter === 'all' ? 'Nothing logged yet today' : `No ${LOG_FILTER_NAMES[filter].toLowerCase()} today`}</div>
              ))}
          </div>
        )
      })}
      {all.length === 0 && <div className="empty">Your sounds, sightings, wind checks and outings land here as you hunt</div>}

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
              {lessonScores(scored, verdict).map((r) => {
                const n = r.agree + r.close + r.miss
                const w = LESSON_WORDS[r.lesson]
                return (
                  <div key={r.lesson} className="log-lesson">
                    {w[0].toUpperCase() + w.slice(1)}: {r.agree} of {n} agreed{r.close ? `, ${r.close} close` : ''}
                    {biasMatters(r.bias) ? ` · ${biasWords(r.bias, r.lesson).replace(/ this season$/, '')}` : n < 5 ? ' · too few to learn from yet' : ''}
                  </div>
                )
              })}
              {aloftN > 0 && (
                <div className="log-lesson">
                  Treetops against the ground: the layering called right {aloftHits} of {aloftN}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
