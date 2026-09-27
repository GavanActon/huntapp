import { useAppStore } from '../state/appStore'
import { compass, hourAt, pointForecast, skyLabel, type HourRow } from '../weather/openMeteo'
import { ensureWeatherGrid, windSampler } from '../weather/windGrid'
import { dayTimeLabel } from '../time'

/**
 * The conditions line under a tapped point: wind, gusts, temperature, sky
 * and rain chance at the app's planning time. Two passes, so the popup is
 * never blank: the wind grid already in memory answers at once (the same
 * HRDPS field the particles fly on), then the point forecast fills in the
 * rest. Cache-first, so at camp with no signal it still shows what it has.
 */

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c)
}

function item(value: string, unit: string, title?: string): string {
  return `<span class="wx-item"${title ? ` title="${esc(title)}"` : ''}>${esc(value)}${unit ? `<span>${esc(unit)}</span>` : ''}</span>`
}

/** An arrow pointing where the wind GOES (deg is blowing FROM). */
function arrow(deg: number): string {
  return `<svg width="12" height="12" viewBox="0 0 14 14" style="transform:rotate(${Math.round(deg + 180) % 360}deg)"><path d="M7 1.5 L10 10 L7 8 L4 10 Z" fill="currentColor"/></svg>`
}

function fmt() {
  const imperial = useAppStore.getState().units === 'imperial'
  return {
    temp: (c: number) => `${Math.round(imperial ? c * 1.8 + 32 : c)}°`,
    wind: (k: number) => String(Math.round(imperial ? k * 0.621371 : k)),
    windUnit: imperial ? 'mph' : 'km/h',
  }
}

function planMs(): number {
  return useAppStore.getState().planTimeMs ?? Date.now()
}

function windOnlyHtml(kmh: number, dir: number): string {
  const f = fmt()
  return `${arrow(dir)} ${item(f.wind(kmh), f.windUnit)}${item(compass(dir), '')}<span class="wx-item"><span>…</span></span>`
}

function hourHtml(h: HourRow, stale: boolean): string {
  const f = fmt()
  const parts = [`${arrow(h.windDir)} ${item(f.wind(h.windKmh), f.windUnit, h.hrdps ? 'ECCC HRDPS 2.5 km' : 'Open-Meteo blend')}${item(compass(h.windDir), '')}`]
  if (h.gustKmh > h.windKmh * 1.4) parts.push(item(`g ${f.wind(h.gustKmh)}`, ''))
  parts.push(item(f.temp(h.tempC), ''))
  parts.push(item(skyLabel(h.weatherCode), ''))
  if (h.precipProbPct != null && h.precipProbPct >= 10) parts.push(item(`${h.precipProbPct}%`, 'rain'))
  if (stale) parts.push(item('', 'cached'))
  return parts.join('')
}

/**
 * Fill `el` (a `.depth-popup-wx` div) with the conditions at lon/lat and
 * keep it current while the popup lives. Returns a disposer.
 */
export function attachTapWeather(el: HTMLElement, lon: number, lat: number): () => void {
  let alive = true
  let hour: { h: HourRow; stale: boolean } | null = null
  let forecast: Awaited<ReturnType<typeof pointForecast>> = null

  const whenLabel = () => (useAppStore.getState().planTimeMs == null ? 'Now' : dayTimeLabel(planMs()))

  const render = () => {
    if (!alive) return
    const ms = planMs()
    if (forecast) {
      const h = hourAt(forecast.forecast, ms)
      hour = h ? { h, stale: forecast.stale } : null
    }
    let body: string
    if (hour) body = hourHtml(hour.h, hour.stale)
    else {
      const sample = windSampler(ms)
      const out = new Float32Array(2)
      if (sample && sample(lon, lat, out)) body = windOnlyHtml(out[0], out[1])
      else body = `<span class="wx-item"><span>${forecast ? 'No forecast for this hour' : navigator.onLine ? 'Fetching conditions…' : 'No conditions cached'}</span></span>`
    }
    // "Now" goes without saying; a planned time is worth the words
    const when = useAppStore.getState().planTimeMs == null ? '' : `<span class="wx-item"><span>${esc(whenLabel())}</span></span>`
    el.innerHTML = when + body
  }

  render()
  void ensureWeatherGrid().then(render)
  void pointForecast(lon, lat).then((r) => {
    if (!alive) return
    forecast = r
    if (!r) el.innerHTML = `<span class="wx-item"><span>${navigator.onLine ? 'Forecast unavailable' : 'No forecast cached here'}</span></span>`
    else render()
  })
  // the planning time or units may change while the popup is open
  const unsub = useAppStore.subscribe((s, p) => {
    if (s.planTimeMs !== p.planTimeMs || s.units !== p.units) render()
  })
  return () => {
    alive = false
    unsub()
  }
}
