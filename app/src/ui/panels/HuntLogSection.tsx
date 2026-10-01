import { getMap } from '../../map/mapController'
import { SOUND_NAMES, SPECIES_NAMES, tallies, useHuntLog, WHAT_NAMES, type LogEntry } from '../../log/huntLog'
import { startOfDayMs } from '../../time'
import { compass } from '../../weather/openMeteo'
import { IconLocate, IconShare, IconTrash } from '../icons'

/**
 * The hunt log in Places: the model's report card first (where the
 * sightings fell on its map, 50 = no better than chance), then today's
 * entries, newest first, and the earlier days each folded up under their
 * date, and a CSV to take home.
 */

function when(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function dayLabel(dayMs: number): string {
  return new Date(dayMs).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

/** The entries by day, newest day first, newest entry first within it. */
function byDay(entries: LogEntry[]): { day: number; entries: LogEntry[] }[] {
  const days = new Map<number, LogEntry[]>()
  for (const e of [...entries].sort((a, b) => b.ts - a.ts)) {
    const d = startOfDayMs(e.ts)
    const list = days.get(d)
    if (list) list.push(e)
    else days.set(d, [e])
  }
  return [...days].sort((a, b) => b[0] - a[0]).map(([day, entries]) => ({ day, entries }))
}

function csv(entries: LogEntry[]): string {
  const cols = ['time', 'lat', 'lon', 'species', 'what', 'count', 'kind', 'sound', 'bearing_from_you', 'distance_m', 'note', 'temp_c', 'wind_kmh', 'wind_from', 'day_high_c', 'warm_days_before', 'model_score', 'model_percentile', 'day_activity']
  const q = (v: unknown) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))
  const rows = entries.map((e) =>
    [
      new Date(e.ts).toISOString(),
      e.lat.toFixed(6),
      e.lon.toFixed(6),
      e.species,
      e.what,
      e.count,
      e.kind,
      e.sound,
      e.from?.bearing.toFixed(0),
      e.from?.distM.toFixed(0),
      e.note,
      e.wx?.tempC.toFixed(1),
      e.wx?.windKmh.toFixed(0),
      e.wx?.windDir.toFixed(0),
      e.wx?.dayHigh?.toFixed(1),
      e.wx?.warmRun,
      e.model?.score.toFixed(3),
      e.model?.percentile.toFixed(3),
      e.model?.activity.toFixed(3),
    ]
      .map(q)
      .join(','),
  )
  return [cols.join(','), ...rows].join('\n') + '\n'
}

async function exportCsv(entries: LogEntry[]) {
  const name = `hunt-log-${new Date().toISOString().slice(0, 10)}.csv`
  const file = new File([csv(entries)], name, { type: 'text/csv' })
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean }
  if (nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: name })
      return
    } catch {
      /* cancelled: fall through to a download */
    }
  }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(file)
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

export default function HuntLogSection() {
  const entries = useHuntLog((s) => s.entries)
  const remove = useHuntLog((s) => s.remove)
  if (!entries.length) return null
  const tally = tallies(entries)
  return (
    <>
      <div className="panel-section">Hunt log</div>
      {tally.map((t) => (
        <div key={t.species} className="row-desc" style={{ padding: '2px 4px 6px' }}>
          <b>{SPECIES_NAMES[t.species]}</b>:{' '}
          {t.n
            ? `${t.n} sighting${t.n > 1 ? 's' : ''} sat at the ${Math.round(t.meanPct)}th percentile of the map on average (50 is chance), ${Math.round(t.topQuarter * 100)}% in its top quarter`
            : 'no sightings with a map call yet'}
          {t.blanks ? ` · ${t.blanks} blank sit${t.blanks > 1 ? 's' : ''}` : ''}
          {t.n > 0 && t.n < 10 ? ' · too few to judge yet' : ''}
        </div>
      ))}
      {byDay(entries).map(({ day, entries: es }) => {
        const today = day === startOfDayMs(Date.now())
        const rows = es.map((e) => (
        <div key={e.id} className="track-row">
          <div className="row-text">
            <span className="row-title">
              {e.what === 'nothing' ? `Blank sit · ${SPECIES_NAMES[e.species].toLowerCase()}` : `${SPECIES_NAMES[e.species]}${e.count && e.count > 1 ? ` ×${e.count}` : ''}${e.kind ? ` (${e.kind})` : ''} · ${e.sound ? SOUND_NAMES[e.sound].toLowerCase() : WHAT_NAMES[e.what].toLowerCase()}`}
            </span>
            <span className="row-desc">
              {when(e.ts)}
              {e.wx ? ` · ${Math.round(e.wx.tempC)}°C, ${Math.round(e.wx.windKmh)} km/h from ${compass(e.wx.windDir)}` : ''}
              {e.model ? ` · map ${Math.round(e.model.score * 100)}, beat ${Math.round(e.model.percentile * 100)}%` : ''}
              {e.note ? ` · ${e.note}` : ''}
            </span>
          </div>
          <button className="icon-btn" aria-label="Go" onClick={() => getMap()?.easeTo({ center: [e.lon, e.lat], zoom: Math.max(getMap()!.getZoom(), 14) })}>
            <IconLocate size={16} />
          </button>
          <button
            className="icon-btn danger"
            aria-label="Delete"
            onClick={() => {
              if (confirm('Delete this entry?')) remove(e.id)
            }}
          >
            <IconTrash size={16} />
          </button>
        </div>
        ))
        if (today) return <div key={day}>{rows}</div>
        return (
          <details key={day} className="log-day">
            <summary className="row-desc">
              {dayLabel(day)} · {es.length} {es.length === 1 ? 'entry' : 'entries'}
            </summary>
            {rows}
          </details>
        )
      })}
      <button className="linklike" style={{ margin: '6px 4px' }} onClick={() => void exportCsv(entries)}>
        <IconShare size={14} /> Export the log (CSV)
      </button>
    </>
  )
}
