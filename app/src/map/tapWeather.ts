import { useAppStore } from '../state/appStore'
import { compass, hourAt, pointForecast, type HourRow } from '../weather/openMeteo'
import { ensureWeatherGrid, windSampler } from '../weather/windGrid'
import { skyGlyphSvg } from '../weather/skyGlyph'
import { dayTimeLabel } from '../time'
import { useMapBearing } from './mapBearing'

/**
 * The conditions line at the top of a tapped point's popup, one glance:
 * `↘ NW 9 · 8° ☀`, the arrow pointing where the wind goes on the map as
 * it is turned, and the rain chance only when it is worth a word. Two
 * passes, so the popup is never blank: the wind grid already in memory
 * answers at once (the same HRDPS field the particles fly on), then the
 * point forecast fills in the rest. Cache-first, so at camp with no
 * signal it still shows what it has.
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

/** The wind grid's answer while the forecast loads. */
function windOnlyHtml(kmh: number, dir: number): string {
  const f = fmt()
  return `${item(`${arrow(dir)} ${esc(compass(dir))} ${f.wind(kmh)}`)}${DOT}${item('…')}`
}

function hourHtml(h: HourRow): string {
  const f = fmt()
  const parts = [item(`${arrow(h.windDir)} ${esc(compass(h.windDir))} ${f.wind(h.windKmh)}`), DOT, item(`${f.temp(h.tempC)} ${skyGlyphSvg(h.weatherCode, 13)}`)]
  if (h.precipProbPct != null && h.precipProbPct >= 30) parts.push(item(`${h.precipProbPct}% rain`))
  return parts.join('')
}

/**
 * Fill `el` (a `.depth-popup-wx` div) with the conditions at lon/lat and
 * keep it current while the popup lives. Returns a disposer.
 */
export function attachTapWeather(el: HTMLElement, lon: number, lat: number): () => void {
  let alive = true
  let hour: HourRow | null = null
  let forecast: Awaited<ReturnType<typeof pointForecast>> = null

  const render = () => {
    if (!alive) return
    const ms = planMs()
    if (forecast) hour = hourAt(forecast.forecast, ms)
    let body: string
    if (hour) body = hourHtml(hour)
    else {
      const sample = windSampler(ms)
      const out = new Float32Array(2)
      if (sample && sample(lon, lat, out)) body = windOnlyHtml(out[0], out[1])
      else body = item(forecast ? 'No forecast for this hour' : navigator.onLine ? 'Fetching conditions…' : 'No conditions cached')
    }
    // "Now" goes without saying; a planned time is worth the words
    const when = useAppStore.getState().planTimeMs == null ? '' : item(esc(dayTimeLabel(ms)), 'dim')
    el.innerHTML = when + body
  }

  render()
  void ensureWeatherGrid().then(render)
  void pointForecast(lon, lat).then((r) => {
    if (!alive) return
    forecast = r
    if (!r) el.innerHTML = item(navigator.onLine ? 'Forecast unavailable' : 'No forecast cached here')
    else render()
  })
  // the planning time or units may change while the popup is open, and
  // the map may be turned under it
  const offs = [
    useAppStore.subscribe((s, p) => {
      if (s.planTimeMs !== p.planTimeMs || s.units !== p.units) render()
    }),
    useMapBearing.subscribe(render),
  ]
  return () => {
    alive = false
    for (const off of offs) off()
  }
}
