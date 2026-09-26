import { useEffect, useState } from 'react'
import { useAppStore } from '../../state/appStore'
import { usePlacesStore } from '../../state/placesStore'
import { dayHours, nextHrdpsRunMs, pointForecast, skyLabel, compass, type PointForecast } from '../../weather/openMeteo'
import { onWeatherRefreshed, refreshWeather } from '../../weather/refresh'
import { moonPhase } from '../../weather/moon'
import { startOfDayMs } from '../../time'
import { SkyGlyph, stripSubject, WindArrow } from '../WeatherStrip'
import { IconRefresh } from '../icons'

function ageLabel(fetchedAt: number): string {
  const min = Math.round((Date.now() - fetchedAt) / 60000)
  if (min < 2) return 'just now'
  if (min < 60) return `${min} min ago`
  return `${Math.round(min / 6) / 10} h ago`
}
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
function clock(iso: string): string {
  const d = new Date(iso)
  const h = d.getHours()
  return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')}${h < 12 ? 'a' : 'p'}`
}

/** The seven days, the picked day hour by hour, sunrise/sunset and the moon.
 *  Reads the same cached forecast the strip fetched. */
export default function WeatherPanel() {
  const planTimeMs = useAppStore((s) => s.planTimeMs)
  const setPlanTime = useAppStore((s) => s.setPlanTime)
  const units = useAppStore((s) => s.units)
  const selectedId = usePlacesStore((s) => s.selectedId)
  const [forecast, setForecast] = useState<PointForecast | null>(null)
  const [stale, setStale] = useState(false)
  const [name, setName] = useState('')
  const [err, setErr] = useState<string | null>(null)

  const load = async () => {
    const subj = stripSubject()
    setName(subj.name)
    const r = await pointForecast(subj.lon, subj.lat)
    if (!r) return setErr('No forecast yet. It arrives with the first fetch.')
    setForecast(r.forecast)
    setStale(r.stale)
  }
  useEffect(() => {
    void load()
    return onWeatherRefreshed(() => void load())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  const temp = (c: number) => (units === 'imperial' ? `${Math.round(c * 1.8 + 32)}°F` : `${Math.round(c)}°C`)
  const wind = (k: number) => (units === 'imperial' ? `${Math.round(k * 0.621371)} mph` : `${Math.round(k)} km/h`)
  const selDayMs = startOfDayMs(planTimeMs ?? Date.now())
  const dayIdx = forecast ? forecast.daily.date.findIndex((d) => new Date(`${d}T00:00`).getTime() === selDayMs) : -1
  const moon = moonPhase(selDayMs + 12 * 3600_000)

  return (
    <div className="panel">
      <div className="panel-section panel-section-first fc-header">
        <span>
          7-day outlook
          {name && <em className="age-badge">at {name}</em>}
          {forecast && (
            <em className={stale ? 'age-badge stale' : 'age-badge'}>
              {stale ? `offline · ${ageLabel(forecast.fetchedAt)}` : ageLabel(forecast.fetchedAt)}
            </em>
          )}
          {forecast && forecast.hrdpsHours > 0 && <em className="age-badge">HRDPS {forecast.hrdpsHours} h</em>}
        </span>
        <span className="fc-actions">
          <button className="icon-btn" onClick={() => void refreshWeather('button', true).then(load)} aria-label="Refresh forecast">
            <IconRefresh size={18} />
          </button>
        </span>
      </div>

      {!forecast && <div className="empty">{err ?? 'Loading forecast…'}</div>}

      {forecast && (
        <>
          <div className="sevenday">
            {forecast.daily.date.map((d, i) => {
              const start = new Date(`${d}T00:00`).getTime()
              const on = start === selDayMs
              return (
                <button key={d} className={`sd-row${on ? ' sd-on' : ''}`} onClick={() => setPlanTime(i === 0 ? null : start + 8 * 3600_000)}>
                  <span className="sd-day">{i === 0 ? 'Today' : DAYS[new Date(start).getDay()]}</span>
                  <span className="sd-sky">
                    <SkyGlyph code={forecast.daily.weatherCode[i]} size={15} /> {skyLabel(forecast.daily.weatherCode[i])}
                  </span>
                  <span className="sd-wave">
                    {temp(forecast.daily.tMaxC[i])} / {temp(forecast.daily.tMinC[i])}
                  </span>
                  <span className="sd-wind">
                    {wind(forecast.daily.windMaxKmh[i])}
                    {forecast.daily.precipProbMaxPct[i] != null && ` · ${forecast.daily.precipProbMaxPct[i]}%`}
                  </span>
                </button>
              )
            })}
          </div>

          {dayIdx >= 0 && (
            <div className="row">
              <div className="row-text">
                <span className="row-title">
                  Sunrise {clock(forecast.daily.sunrise[dayIdx])} · Sunset {clock(forecast.daily.sunset[dayIdx])}
                </span>
                <span className="row-desc">
                  Moon {moon.name} · {Math.round(moon.illumination * 100)}% lit
                </span>
              </div>
            </div>
          )}

          <div className="panel-section">Hour by hour</div>
          <div className="hd-table">
            {dayHours(forecast, selDayMs).map((h) => (
              <div key={h.time.getTime()} className="hd-row">
                <span className="hd-time" title={h.hrdps ? 'ECCC HRDPS 2.5 km' : 'Open-Meteo blend'}>
                  {h.time.getHours()}:00{h.hrdps ? '' : '·'}
                </span>
                <span className="hd-wind">
                  <WindArrow deg={h.windDir} /> {wind(h.windKmh)} {compass(h.windDir)}
                  {h.gustKmh > h.windKmh * 1.4 && <em className="hd-gust"> g {wind(h.gustKmh)}</em>}
                </span>
                <span className="hd-wave">{temp(h.tempC)}</span>
                <span className="hd-right">
                  <SkyGlyph code={h.weatherCode} />
                  {h.precipProbPct != null && h.precipProbPct > 0 && ` ${h.precipProbPct}%`}
                  {h.snowCm > 0 && ` ${h.snowCm.toFixed(1)} cm`}
                  {h.snowCm === 0 && h.precipMm > 0 && ` ${h.precipMm.toFixed(1)} mm`}
                </span>
              </div>
            ))}
          </div>
          <div className="panel-note row-desc">Short term: ECCC HRDPS 2.5 km, by name. Beyond its horizon (hours marked ·): Open-Meteo's blend</div>
          <div className="panel-note row-desc">
            {Date.now() < nextHrdpsRunMs(forecast.fetchedAt)
              ? `Current run. Next HRDPS run lands about ${clock(new Date(nextHrdpsRunMs(forecast.fetchedAt)).toISOString())} and is fetched when there is signal`
              : 'A newer run is out. It is fetched the moment there is signal'}
          </div>
        </>
      )}
    </div>
  )
}
