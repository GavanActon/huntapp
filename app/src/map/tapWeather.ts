import { useAppStore } from '../state/appStore'
import { compass, hourAt, type HourRow } from '../weather/openMeteo'
import { ensureWeatherGrid, onWeatherGrid, windSampler } from '../weather/windGrid'
import { groundStability, groundWind, microGrid, onMicro } from '../weather/micro/model'
import { elevAt } from '../weather/micro/relief'
import { nearestCachedForecast, onWeatherRefreshed } from '../weather/refresh'
import { habitat, onHabitat } from '../spots/habitatGrid'
import { skyGlyphSvg } from '../weather/skyGlyph'
import { dayTimeLabel } from '../time'
import { useMapBearing } from './mapBearing'

/**
 * The conditions line at the top of a tapped point's popup, one glance:
 * `↘ NW 9 · 8° ☀`, the arrow pointing where the wind goes on the map as
 * it is turned, and the rain chance only when it is worth a word.
 *
 * All of it from what the phone holds, nothing asked for (Gavan,
 * 2026-10-13: "why are we using a forecast request when we have a wind
 * model"): a request per tap was turned away in a cold open's burst and
 * left the popup without a word, and in the bush there is no signal to
 * ask with. The wind is the streaks' own: the ground model's at head
 * height, or the wind grid's at 10 m with the streaks set to the forecast
 * (or before the micro grid is in). The temperature, sky and rain are the
 * forecast of the nearest saved place, the one the ground model itself
 * runs on at camp, the temperature taken to the point's height.
 */

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)
}

function item(html: string, cls = ''): string {
  return `<span class="wx-item${cls ? ` ${cls}` : ''}">${html}</span>`
}

/** An arrow pointing where the wind GOES (deg is blowing FROM), against
 *  the map as it is turned. */
function arrow(deg: number): string {
  const rot = (deg + 180 - useMapBearing.getState().bearing + 720) % 360
  return `<svg width="12" height="12" viewBox="0 0 14 14" style="transform:rotate(${Math.round(rot)}deg)" aria-hidden="true"><path d="M7 1.5 L10 10 L7 8 L4 10 Z" fill="currentColor"/></svg>`
}

function fmt() {
  const imperial = useAppStore.getState().units === 'imperial'
  return {
    temp: (c: number) => `${Math.round(imperial ? c * 1.8 + 32 : c)}°`,
    wind: (k: number) => String(Math.round(imperial ? k * 0.621371 : k)),
  }
}

function planMs(): number {
  return useAppStore.getState().planTimeMs ?? Date.now()
}

const DOT = item('·', 'dim')

/** The air cools this much a metre up, °C: the standard atmosphere's, as
 *  Open-Meteo takes a forecast to a point's own height. */
const LAPSE_C_PER_M = 0.0065

/** Ground height at a point, m: the habitat grid's (the whole region), else
 *  the going grid's (the core, once a cone has loaded it); NaN before either. */
function groundM(lon: number, lat: number): number {
  const h = habitat()
  if (h?.has('elev')) {
    const i = h.index(lon, lat)
    const v = i >= 0 ? h.value('elev', i) : NaN
    if (v > 0) return v
  }
  return elevAt(lon, lat)
}

interface Wind {
  kmh: number
  /** blowing FROM */
  dir: number
}

/** The wind here as the streaks draw it, or null before any field is in. */
function windHere(lon: number, lat: number, ms: number): Wind | null {
  if (useAppStore.getState().windLevel === 'ground' && microGrid()) {
    const g = groundWind(lon, lat, ms)
    if (g) return { kmh: g.kmh, dir: g.dirFrom }
  }
  const sample = windSampler(ms)
  const out = new Float32Array(2)
  if (sample && sample(lon, lat, out)) return { kmh: out[0], dir: out[1] }
  return null
}

/** The nearest saved place's forecast hour, its temperature taken to this
 *  point's height. Where the night air lies still the ground's cold drains
 *  and pools low, so the correction fades out as the model's air goes
 *  stable rather than make a hollow warmer than the hill above it. */
function hourHere(lon: number, lat: number, ms: number): HourRow | null {
  const near = nearestCachedForecast(lon, lat)
  const h = near ? hourAt(near.f, ms) : null
  if (!near || !h) return null
  const dz = groundM(lon, lat) - groundM(near.f.lon, near.f.lat)
  if (!Number.isFinite(dz)) return h
  const lapse = LAPSE_C_PER_M * (1 - groundStability(ms).stable)
  return { ...h, tempC: h.tempC - lapse * dz }
}

function windHtml(w: Wind): string {
  const f = fmt()
  const kmh = f.wind(w.kmh)
  return item(kmh === '0' ? 'Calm' : `${arrow(w.dir)} ${esc(compass(w.dir))} ${kmh}`)
}

function skyHtml(h: HourRow): string {
  const f = fmt()
  const parts = [item(`${f.temp(h.tempC)} ${skyGlyphSvg(h.weatherCode, 13)}`)]
  if (h.precipProbPct != null && h.precipProbPct >= 30) parts.push(item(`${h.precipProbPct}% rain`))
  return parts.join('')
}

/**
 * Fill `el` (a `.depth-popup-wx` div) with the conditions at lon/lat and
 * keep it current while the popup lives: a field landing (the wind grid,
 * the micro grid, the habitat grid's heights) or a fresh forecast redraws
 * it. Returns a disposer.
 */
export function attachTapWeather(el: HTMLElement, lon: number, lat: number): () => void {
  let alive = true
  // worked out once per planning time and per field landing; turning the
  // map only turns the arrow
  let at = NaN
  let wind: Wind | null = null
  let hour: HourRow | null = null

  const render = () => {
    if (!alive) return
    const ms = planMs()
    if (ms !== at) {
      at = ms
      wind = windHere(lon, lat, ms)
      hour = hourHere(lon, lat, ms)
    }
    // before either field is in, the forecast's own 10 m wind
    const w = wind ?? (hour ? { kmh: hour.windKmh, dir: hour.windDir } : null)
    let body: string
    if (w && hour) body = `${windHtml(w)}${DOT}${skyHtml(hour)}`
    else if (w) body = windHtml(w)
    else body = item(navigator.onLine ? 'Fetching conditions…' : 'No conditions cached')
    // "Now" goes without saying; a planned time is worth the words
    const when = useAppStore.getState().planTimeMs == null ? '' : item(esc(dayTimeLabel(ms)), 'dim')
    el.innerHTML = when + body
  }
  const fresh = () => {
    at = NaN
    render()
  }

  render()
  // the area's wind grid, shared, not a request of this popup's own
  void ensureWeatherGrid().then(fresh)
  const offs = [
    onWeatherGrid(fresh),
    onMicro(fresh),
    onWeatherRefreshed(fresh),
    onHabitat(fresh),
    // the planning time, units or streaks' level may change while the
    // popup is open, and the map may be turned under it
    useAppStore.subscribe((s, p) => {
      if (s.planTimeMs !== p.planTimeMs || s.windLevel !== p.windLevel) fresh()
      else if (s.units !== p.units) render()
    }),
    useMapBearing.subscribe(render),
  ]
  return () => {
    alive = false
    for (const off of offs) off()
  }
}
