import { clockShort } from '../time'
import { steadiness, towardWords, type WindCheck } from '../weather/micro/windChecks'
import { compass } from '../weather/openMeteo'
import type { LogEntry } from './huntLog'

/** The words under a log entry, for an outing's rows and the Hunt log's:
 *  'how far and which way · the weather · what the map made of it · the note',
 *  the time first unless the row shows it already. */
export function entryDetail(e: LogEntry, withTime = true): string {
  return [
    withTime ? clockShort(e.ts) : '',
    e.from ? `${Math.round(e.from.distM / 10) * 10} m ${compass(e.from.bearing)}` : '',
    e.wx ? `${Math.round(e.wx.tempC)}°C, ${Math.round(e.wx.windKmh)} km/h from ${compass(e.wx.windDir)}` : '',
    e.model ? `map ${Math.round(e.model.score * 100)}, beat ${Math.round(e.model.percentile * 100)}%` : '',
    e.note ?? '',
  ]
    .filter(Boolean)
    .join(' · ')
}

/** What a wind check felt: 'toward NE, light, steady · 3 puffs' | 'calm'. */
export function checkWords(c: WindCheck): string {
  const steady = steadiness(c)
  return `${c.dirFrom == null ? 'calm' : `toward ${towardWords((c.dirFrom + 180) % 360, c.swingDeg)}, ${c.strength}`}${steady ? `, ${steady}` : ''}${(c.puffs ?? 1) > 1 ? ` · ${c.puffs} puffs` : ''}`
}
