import { gpxDoc, trackToGpx, trkXml, useTrackStore, type Track, type TrackPoint } from '../tracking/trackStore'
import { compass } from '../weather/openMeteo'
import { steadiness, towardWords, useWindChecks, verdict, type WindCheck } from '../weather/micro/windChecks'
import { clockShort } from '../time'
import { SOUND_NAMES, SPECIES_NAMES, useHuntLog, WHAT_NAMES, type LogEntry } from './huntLog'
import { outingChecks, outingEntries, outingTitle, type Outing } from './outings'

/**
 * The log leaves the phone as files: the entries as a CSV with the weather
 * and the model's call beside each, an outing (or everything) as GPX with
 * the track and a waypoint per sound and wind check. The phone's share
 * sheet when it has one, a download otherwise.
 */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

async function shareFile(file: File, title: string): Promise<void> {
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean }
  if (nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title })
      return
    } catch {
      /* cancelled: fall through to a download */
    }
  }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(file)
  a.download = file.name
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}

const slug = (s: string) => s.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').toLowerCase()

// ---------------------------------------------------------------- CSV

export function csv(entries: LogEntry[]): string {
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

export async function exportCsv(entries: LogEntry[]): Promise<void> {
  const name = `hunt-log-${new Date().toISOString().slice(0, 10)}.csv`
  await shareFile(new File([csv(entries)], name, { type: 'text/csv' }), name)
}

// ---------------------------------------------------------------- GPX

function wpt(lon: number, lat: number, ts: number, name: string, desc: string, type: string): string {
  return `  <wpt lat="${lat.toFixed(7)}" lon="${lon.toFixed(7)}">\n    <time>${new Date(ts).toISOString()}</time>\n    <name>${esc(name)}</name>${desc ? `\n    <desc>${esc(desc)}</desc>` : ''}\n    <type>${type}</type>\n  </wpt>`
}

function entryWpt(e: LogEntry): string {
  const what = e.sound ? SOUND_NAMES[e.sound] : WHAT_NAMES[e.what]
  const name = `${SPECIES_NAMES[e.species]}${e.count && e.count > 1 ? ` ×${e.count}` : ''}${e.kind ? ` (${e.kind})` : ''} · ${what.toLowerCase()} ${clockShort(e.ts)}`
  const desc = [
    e.from ? `${Math.round(e.from.distM)} m ${compass(e.from.bearing)} of where you stood` : '',
    e.wx ? `${Math.round(e.wx.tempC)}°C, ${Math.round(e.wx.windKmh)} km/h from ${compass(e.wx.windDir)}` : '',
    e.model ? `map ${Math.round(e.model.score * 100)}, beat ${Math.round(e.model.percentile * 100)}%` : '',
    e.note ?? '',
  ]
    .filter(Boolean)
    .join(' · ')
  return wpt(e.lon, e.lat, e.ts, name, desc, e.what === 'nothing' ? 'blank' : e.what)
}

function checkWpt(c: WindCheck): string {
  const steady = steadiness(c)
  const felt = `${c.dirFrom == null ? 'calm' : `toward ${towardWords((c.dirFrom + 180) % 360, c.swingDeg)}, ${c.strength}`}${steady ? `, ${steady}` : ''}`
  const v = verdict(c)
  const desc = [
    (c.puffs ?? 1) > 1 ? `${c.puffs} puffs` : '',
    c.aloft ? 'treetops moving' : '',
    c.held ? 'had held a while' : '',
    c.model ? `model: from ${compass(c.model.dirFrom)} ${Math.round(c.model.kmh)} km/h, ${c.model.regime}${c.model.slot ? ' (slot)' : ''}${c.model.decoupled ? ', decoupled' : ''}` : '',
    v ? (v === 'agree' ? 'agreed' : v === 'close' ? 'close' : 'missed') : '',
    c.note ?? '',
  ]
    .filter(Boolean)
    .join(' · ')
  return wpt(c.lon, c.lat, c.ts, `Wind check ${clockShort(c.ts)} · ${felt}`, desc, 'windcheck')
}

function splice(gpx: string, blocks: string[]): string {
  if (!blocks.length) return gpx
  return gpx.replace('</gpx>', `${blocks.join('\n')}\n</gpx>`)
}

/** The outing's stretch of every track as one track, points in time order, a new segment where tracks meet. */
function outingTrack(o: Outing): Track {
  const points: TrackPoint[] = []
  for (const id of o.trackIds) {
    const t = useTrackStore.getState().tracks.find((x) => x.id === id)
    if (!t) continue
    const slice = t.points.filter((p) => p.ts >= o.startMs && p.ts <= o.endMs)
    if (!slice.length) continue
    points.push(...(points.length ? [{ ...slice[0], gap: true }, ...slice.slice(1)] : slice))
  }
  points.sort((a, b) => a.ts - b.ts)
  return { id: o.id, name: outingTitle(o), startedAt: o.startMs, endedAt: o.endMs, points, distanceM: o.distanceM }
}

export async function exportOutingGpx(o: Outing): Promise<void> {
  const title = outingTitle(o)
  const track = outingTrack(o)
  const wpts = [...outingEntries(o).map(entryWpt), ...outingChecks(o).map(checkWpt)]
  // sounds with no walk behind them: waypoints alone, not an empty track
  const gpx = track.points.length >= 2 ? splice(trackToGpx(track), wpts) : gpxDoc(wpts.join('\n'))
  const name = `${slug(title) || 'outing'}.gpx`
  await shareFile(new File([gpx], name, { type: 'application/gpx+xml' }), title)
}

/** Every track, entry and hand check in one file. */
export async function exportAllGpx(): Promise<void> {
  const tracks = useTrackStore.getState().tracks.filter((t) => t.points.length >= 2)
  const entries = useHuntLog.getState().entries
  const checks = useWindChecks.getState().checks.filter((c) => c.source === 'hand')
  const body = [...entries.map(entryWpt), ...checks.map(checkWpt), ...tracks.map(trkXml)].join('\n')
  const name = `hunt-log-${new Date().toISOString().slice(0, 10)}.gpx`
  await shareFile(new File([gpxDoc(body)], name, { type: 'application/gpx+xml' }), name)
}
