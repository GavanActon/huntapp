import { SPOTS_RADIUS_M } from '../config'
import { homePlace } from '../state/placesStore'
import { useSpotsStore } from '../state/spotsStore'
import { deriveConditions, recentDailyMeans } from '../spots/conditions'
import { habitat, loadHabitat } from '../spots/habitatGrid'
import { scoreTarget } from '../spots/scoring'
import type { HuntTarget } from '../spots/types'
import { cachedPointForecast } from '../weather/openMeteo'
import type { LogModel, LogSpecies, LogWeather } from './huntLog'

/**
 * What is saved beside a log entry: the weather at camp and the model's
 * own call for the spot at the moment it was logged (LogCard, HeardCard),
 * before the entry can sway the map.
 */

const HUNT: LogSpecies[] = ['moose', 'deer', 'bear', 'grouse']

/** The weather and the model's call at a spot, now. Best effort: offline
 *  without a cached forecast, the entry is saved without them. */
export async function snapshot(species: LogSpecies, lon: number, lat: number): Promise<{ wx?: LogWeather; model?: LogModel }> {
  const now = Date.now()
  const home = homePlace()
  const f = cachedPointForecast(home.lon, home.lat)
  if (!f) return {}
  const recent = await recentDailyMeans(home.lon, home.lat).catch(() => null)
  const c = deriveConditions(f, now, recent)
  if (!c) return {}
  const wx: LogWeather = { tempC: c.tempC, windKmh: c.windKmh, windDir: c.windDir, cloudPct: c.cloudPct, precipMmH: c.precipMmH, dayHigh: c.dayHigh, warmRun: c.warmRun }
  if (!HUNT.includes(species)) return { wx }
  await loadHabitat()
  const h = habitat()
  if (!h) return { wx }
  // the model's map as it stood, without the log's own pull
  const w = { ...useSpotsStore.getState().weights, log: 0 }
  const res = scoreTarget(species as HuntTarget, c, { lon, lat, name: 'here' }, w)
  const i = h.index(lon, lat)
  if (!res || i < 0) return { wx }
  const s = res.scores[i]
  const [r0, c0] = h.rc(i)
  const rr = Math.ceil(SPOTS_RADIUS_M / h.cellM[1])
  const rc = Math.ceil(SPOTS_RADIUS_M / h.cellM[0])
  let below = 0
  let n = 0
  for (let r = Math.max(0, r0 - rr); r <= Math.min(h.rows - 1, r0 + rr); r++)
    for (let cc = Math.max(0, c0 - rc); cc <= Math.min(h.cols - 1, c0 + rc); cc++) {
      const v = res.scores[r * h.cols + cc]
      if (v <= 0) continue
      n++
      if (v < s) below++
    }
  return { wx, model: { score: s, percentile: n ? below / n : 0, activity: res.verdict.activity, headline: res.verdict.headline } }
}
