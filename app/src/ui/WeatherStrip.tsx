import { useEffect, useMemo, useRef, useState } from 'react'
import { inRegion } from '../config'
import { useMapBearing } from '../map/mapBearing'
import { useAppStore } from '../state/appStore'
import { selectedPlace, homePlace, usePlacesStore } from '../state/placesStore'
import { useGpsStore } from '../tracking/gpsStore'
import { hourRow, isRain, isSnow, isThunder, pointForecast, type HourRow, type PointForecast } from '../weather/openMeteo'
import { startOfDayMs } from '../time'
import { onWeatherRefreshed } from '../weather/refresh'

/**
 * Two-level outlook strip pinned to the top of the map, straight from the
 * boat app's layout: a day row (seven days, sky, high/low) over an hour row
 * that runs unbroken from now to the end of the forecast (wind arrow and
 * speed, temperature, rain chance), so a swipe carries on through the night
 * into the next day. Tapping a day jumps the hour row to that morning;
 * tapping a day or an hour sets the app-wide planning time. The strip is
 * about the selected place, or the camp, or the phone's position.
 */

const REFRESH_MS = 30 * 60_000
const DAY_FROM_H = 6

function hourLabel(d: Date): string {
  const h = d.getHours()
  return `${h % 12 || 12}${h < 12 ? 'a' : 'p'}`
}
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** A tiny sky glyph from the WMO code: sun, cloud, rain, snow, bolt. */
export function SkyGlyph({ code, size = 13 }: { code: number; size?: number }) {
  const s = { width: size, height: size }
  if (isThunder(code))
    return (
      <svg {...s} viewBox="0 0 16 16" aria-label="thunder">
        <path d="M9 1 3 9h4l-1 6 6-8H8z" fill="currentColor" />
      </svg>
    )
  if (isSnow(code))
    return (
      <svg {...s} viewBox="0 0 16 16" aria-label="snow">
        <path d="M8 1v14M2 4.5l12 7M2 11.5l12-7" stroke="currentColor" strokeWidth="1.6" fill="none" />
      </svg>
    )
  if (isRain(code))
    return (
      <svg {...s} viewBox="0 0 16 16" aria-label="rain">
        <path d="M4 8a3.5 3.5 0 0 1 0-7 4 4 0 0 1 7.6 1A3 3 0 0 1 12 8z" fill="currentColor" />
        <path d="M5 10v3M8 11v3M11 10v3" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    )
  if (code >= 3 || code === 45 || code === 48)
    return (
      <svg {...s} viewBox="0 0 16 16" aria-label="cloud">
        <path d="M4 12a3.5 3.5 0 0 1 0-7 4 4 0 0 1 7.6 1A3 3 0 0 1 12 12z" fill="currentColor" />
      </svg>
    )
  if (code >= 1)
    return (
      <svg {...s} viewBox="0 0 16 16" aria-label="some cloud">
        <circle cx="6" cy="6" r="3.5" fill="currentColor" opacity="0.7" />
        <path d="M6 13a2.5 2.5 0 0 1 0-5 3 3 0 0 1 5.7.8A2.2 2.2 0 0 1 12 13z" fill="currentColor" />
      </svg>
    )
  return (
    <svg {...s} viewBox="0 0 16 16" aria-label="clear">
      <circle cx="8" cy="8" r="3.5" fill="currentColor" />
      <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3 3l1.4 1.4M11.6 11.6 13 13M3 13l1.4-1.4M11.6 4.4 13 3" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  )
}

export function WindArrow({ deg, size = 12 }: { deg: number; size?: number }) {
  // blowing FROM deg: the arrow points where the wind goes, on the map as it is turned
  const up = useMapBearing((s) => s.bearing)
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" style={{ transform: `rotate(${(Math.round(deg + 180 - up) + 720) % 360}deg)` }}>
      <path d="M7 1.5 L10 10 L7 8 L4 10 Z" fill="currentColor" />
    </svg>
  )
}

export function stripSubject(): { lon: number; lat: number; name: string } {
  const sel = selectedPlace()
  if (sel) return { lon: sel.lon, lat: sel.lat, name: sel.name }
  const fix = useGpsStore.getState().fix
  if (fix && inRegion(fix.lon, fix.lat)) return { lon: fix.lon, lat: fix.lat, name: 'Here' }
  const home = homePlace()
  return { lon: home.lon, lat: home.lat, name: home.name }
}

export default function WeatherStrip() {
  const enabled = useAppStore((s) => s.wxStrip)
  const planTimeMs = useAppStore((s) => s.planTimeMs)
  const setPlanTime = useAppStore((s) => s.setPlanTime)
  const units = useAppStore((s) => s.units)
  const online = useAppStore((s) => s.online)
  const selectedId = usePlacesStore((s) => s.selectedId)
  const hasFix = useGpsStore((s) => s.fix != null)

  const [forecast, setForecast] = useState<PointForecast | null>(null)
  const [stale, setStale] = useState(false)
  const [name, setName] = useState('')

  useEffect(() => {
    if (!enabled) return
    let alive = true
    const load = async () => {
      const subj = stripSubject()
      setName(subj.name)
      const r = await pointForecast(subj.lon, subj.lat)
      if (!alive || !r) return
      setForecast(r.forecast)
      setStale(r.stale)
    }
    void load()
    const t = setInterval(() => void load(), REFRESH_MS)
    const off = onWeatherRefreshed(() => void load())
    return () => {
      alive = false
      clearInterval(t)
      off()
    }
  }, [enabled, selectedId, hasFix, online])

  const now = Date.now()
  const selDayMs = startOfDayMs(planTimeMs ?? now)

  const days = useMemo(() => {
    if (!forecast) return []
    return forecast.daily.date.map((d, i) => {
      const start = new Date(`${d}T00:00`).getTime()
      return {
        start,
        label: i === 0 ? 'Today' : DAYS[new Date(start).getDay()],
        code: forecast.daily.weatherCode[i],
        hi: forecast.daily.tMaxC[i],
        lo: forecast.daily.tMinC[i],
        pop: forecast.daily.precipProbMaxPct[i],
      }
    })
  }, [forecast])

  // every hour from this one on, across the days — overnight included
  const floorNow = now - (now % 3600_000)
  const hours: HourRow[] = useMemo(() => {
    if (!forecast) return []
    const out: HourRow[] = []
    forecast.hourly.time.forEach((t, i) => {
      if (Date.parse(t) >= floorNow) out.push(hourRow(forecast, i))
    })
    return out
  }, [forecast, floorNow])

  // sun down to sun up, per day, to shade the night hours
  const nights = useMemo(() => {
    if (!forecast) return [] as [number, number][]
    const { sunrise, sunset } = forecast.daily
    return sunset.slice(0, -1).map((ss, i) => [Date.parse(ss), Date.parse(sunrise[i + 1])] as [number, number])
  }, [forecast])
  const firstRise = forecast ? Date.parse(forecast.daily.sunrise[0]) : 0
  const isNight = (ms: number) => ms < firstRise || nights.some(([a, b]) => ms >= a && ms < b)

  // bring the planned hour into view when it lands off-screen (a day tap)
  const cellsRef = useRef<HTMLDivElement>(null)
  const planHourMs = planTimeMs == null ? null : planTimeMs - (planTimeMs % 3600_000)
  useEffect(() => {
    const row = cellsRef.current
    if (!row) return
    const cell = row.querySelector<HTMLElement>(`[data-ms="${planHourMs ?? floorNow}"]`)
    if (!cell) return
    const left = cell.offsetLeft - row.offsetLeft
    if (left < row.scrollLeft || left + cell.offsetWidth > row.scrollLeft + row.clientWidth)
      row.scrollTo({ left, behavior: 'smooth' })
  }, [planHourMs, hours.length, floorNow])

  if (!enabled) return null

  const temp = (c: number) => (units === 'imperial' ? Math.round(c * 1.8 + 32) : Math.round(c))
  const wind = (k: number) => (units === 'imperial' ? Math.round(k * 0.621371) : Math.round(k))
  const activeHourMs = planTimeMs == null ? floorNow : planTimeMs - (planTimeMs % 3600_000)

  return (
    <div className="wxstrip glass">
      {stale && <span className="wxstrip-stale" title="Cached forecast" />}
      {name && (
        <span className="wxstrip-focus">
          {name}
          {planTimeMs != null && (
            <button className="wxstrip-nudge" onClick={() => setPlanTime(null)} aria-label="Back to now">
              now
            </button>
          )}
        </span>
      )}
      {!forecast ? (
        <div className="wxstrip-empty">{online ? 'Fetching the outlook…' : 'No outlook cached'}</div>
      ) : (
        <>
          <div className="wxstrip-days">
            {days.map((d) => (
              <button
                key={d.start}
                className={`wxday${d.start === selDayMs ? ' wxday-on' : ''}`}
                onClick={() => setPlanTime(d.start === startOfDayMs(now) ? null : d.start + DAY_FROM_H * 3600_000)}
              >
                <span className="wxday-name">
                  {d.label}
                  {d.pop != null && d.pop >= 30 && <em className="wxday-pop">{d.pop}%</em>}
                </span>
                <span className="wxday-wx">
                  <SkyGlyph code={d.code} />
                  <b>{temp(d.hi)}°</b>
                  <span>{temp(d.lo)}°</span>
                </span>
              </button>
            ))}
          </div>
          <div className="wxstrip-cells" ref={cellsRef}>
            {hours.map((h) => {
              const ms = h.time.getTime()
              const midnight = h.time.getHours() === 0
              return (
                <button
                  key={ms}
                  data-ms={ms}
                  className={`wxcell${ms === activeHourMs ? ' wx-active' : ''}${isNight(ms) ? ' wxcell-night' : ''}${midnight ? ' wxcell-midnight' : ''}`}
                  onClick={() => setPlanTime(ms)}
                >
                  <span className="wxcell-h">{midnight ? DAYS[h.time.getDay()] : hourLabel(h.time)}</span>
                  <span className="wxday-wx">
                    <WindArrow deg={h.windDir} />
                    <b>{wind(h.windKmh)}</b>
                  </span>
                  <span className="wxcell-wave">
                    {temp(h.tempC)}°
                    {h.precipProbPct != null && h.precipProbPct >= 20 && <em>{h.precipProbPct}%</em>}
                  </span>
                  {isThunder(h.weatherCode) && <span className="wxcell-bolt wx-bolt">⚡</span>}
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
