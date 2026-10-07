import { memo, useDeferredValue, useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react'
import { inRegion } from '../config'
import { useMapBearing } from '../map/mapBearing'
import { MARK_KINDS, MARK_NAMES, useAppStore } from '../state/appStore'
import { areaPlaces, selectedPlace, homePlace, usePlacesStore } from '../state/placesStore'
import { useSpotsStore } from '../state/spotsStore'
import { pickTarget } from '../state/viewsStore'
import { useGpsStore } from '../tracking/gpsStore'
import { cachedPointForecast, fetchPointForecast, forecastBasisMs, hourAt, hourRow, isThunder, nextHrdpsRunMs, pointForecast, type HourRow, type PointForecast } from '../weather/openMeteo'
import { forecastStale, onWeatherRefreshed, refreshWeather } from '../weather/refresh'
import { skyGlyphSvg } from '../weather/skyGlyph'
import { moonPhase } from '../weather/moon'
import { sunTimes } from '../weather/sun'
import { ensureProfile, onProfile } from '../weather/boundaryLayer'
import { onWeatherGrid } from '../weather/windGrid'
import { drainWindow, groundAirAround, loadMicro, onMicro, REGIME_TIP } from '../weather/micro/model'
import { useWindChecks } from '../weather/micro/windChecks'
import { activityBar } from '../spots/grades'
import { FISH_TARGETS, HUNT_TARGETS, TARGET_NAMES, type Target } from '../spots/types'
import { agoLabel, clockShort, dayLabel, dayShort, floorHourMs, hourAmPm, hourMinShort, hourShort, isToday, startOfDayMs } from '../time'
import { IconCheck, IconChevronDown, IconChevronUp, IconDots, IconGrid, IconGridOff, IconHeat, IconPin, IconSun } from './icons'
import AppMenu from './AppMenu'
import { useMapUpdates } from '../offline/updates'
import { useLookTick } from './useLookTick'
import { useTapOff } from './tapOff'
import { useLoadProgress } from '../offline/loadProgress'
import './strip.css'

/**
 * The outlook strip at the top of the map. Its head is what you are after
 * (the quarry chip), Now while the planning time is not now, and ⋯.
 * Folded (the default, the active screen) that head sits over the hour
 * row, which runs unbroken through the night to the end of the forecast,
 * each cell carrying a thin green bar for the quarry's activity then.
 * Open (planning), a day row comes in above the hours and a thin blue
 * line marks the hours the ground's cold air drains. Tapping a day
 * or an hour sets the app-wide planning time; tapping the picked hour
 * again opens its detail inside the strip (gusts, feel, the quarry's
 * grade, the ground air, the sun, legal light, moon, the forecast's source
 * and age, and when the next HD run lands). A press and hold on any hour
 * picks it and opens its detail at once. The strip is about the selected place,
 * or the phone's position, or the camp.
 */

const REFRESH_MS = 30 * 60_000
const DAY_FROM_H = 6
const H = 3600_000
const LEGAL_MS = 30 * 60_000

interface Subject {
  lon: number
  lat: number
  name: string
}

interface DrainRun {
  startMs: number
  endMs: number
}

/** A tiny sky glyph from the WMO code: sun, cloud, rain, snow, bolt. */
export function SkyGlyph({ code, size = 13 }: { code: number; size?: number }) {
  return <span className="wx-sky" dangerouslySetInnerHTML={{ __html: skyGlyphSvg(code, size) }} />
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

/** The nearest saved place with a forecast in the cache, in the area the
 *  app is in (spotsLayer's rule). */
function nearestCachedPlace(lon: number, lat: number): { p: Subject; f: PointForecast } | null {
  let best: { p: Subject; f: PointForecast; d: number } | null = null
  for (const p of areaPlaces()) {
    const f = cachedPointForecast(p.lon, p.lat)
    if (!f) continue
    const d = Math.hypot((p.lon - lon) * Math.cos((lat * Math.PI) / 180), p.lat - lat)
    if (!best || d < best.d) best = { p: { lon: p.lon, lat: p.lat, name: p.name }, f, d }
  }
  return best
}

/** The strip's subject and its forecast. `force` refetches a `Here`
 *  subject (the refresh sweep only covers saved places). With no signal
 *  and no cache at the phone's own spot, the nearest saved place with one
 *  stands in, by name. */
async function loadSubject(force: boolean): Promise<{ subject: Subject; forecast: PointForecast | null; stale: boolean }> {
  const subj = stripSubject()
  if (force && subj.name === 'Here' && navigator.onLine) {
    try {
      return { subject: subj, forecast: await fetchPointForecast(subj.lon, subj.lat), stale: false }
    } catch {
      /* the cache below */
    }
  }
  const r = await pointForecast(subj.lon, subj.lat)
  if (r) return { subject: subj, forecast: r.forecast, stale: r.stale }
  if (subj.name === 'Here') {
    const near = nearestCachedPlace(subj.lon, subj.lat)
    if (near) return { subject: near.p, forecast: near.f, stale: forecastStale(near.f) }
  }
  return { subject: subj, forecast: null, stale: false }
}

function dayBefore(dayStartMs: number): number {
  const d = new Date(dayStartMs)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1).getTime()
}
function dayAfter(dayStartMs: number): number {
  const d = new Date(dayStartMs)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime()
}

/** Re-render just after each top of the hour, so `now` and the row's first cell move on after a pocket. */
function useHourTick(): void {
  const [, bump] = useState(0)
  useEffect(() => {
    let t = 0
    const arm = () => {
      const now = Date.now()
      t = window.setTimeout(() => {
        bump((x) => x + 1)
        arm()
      }, floorHourMs(now) + H - now + 500)
    }
    arm()
    return () => window.clearTimeout(t)
  }, [])
}

const bar = (v: number): CSSProperties => ({ '--bar': v.toFixed(2) }) as CSSProperties

type Units = ReturnType<typeof useAppStore.getState>['units']
const tempIn = (units: Units, c: number) => (units === 'imperial' ? Math.round(c * 1.8 + 32) : Math.round(c))
const windIn = (units: Units, k: number) => (units === 'imperial' ? Math.round(k * 0.621371) : Math.round(k))

/** The evening drain over an hour's cell, as shares of the hour, or null. */
function drainAt(drains: DrainRun[], ms: number, floorNow: number): { l: number; r: number; label: boolean } | null {
  for (const w of drains) {
    if (w.endMs <= ms || w.startMs >= ms + H) continue
    const l = Math.max(0, (w.startMs - ms) / H)
    const r = Math.min(1, (w.endMs - ms) / H)
    return { l, r, label: w.startMs >= ms || ms === floorNow }
  }
  return null
}

/** What an hour cell does when pressed and tapped: one object for the row,
 *  its functions swapped every render, so a cell's own props stay the same. */
interface CellActions {
  down: (ms: number) => void
  up: () => void
  tap: (ms: number) => void
}

/**
 * One hour of the row. The row is some 190 of them, and it rendered whole
 * every time anything in the strip moved: on a launch the forecast, the
 * hour scores, the plans and the ground model each landed and redrew every
 * cell, a tenth of a second or more a time on a phone, just as the wind
 * streaks started. Memoised on its own hour, a cell draws again only when
 * that hour changes.
 */
const HourCell = memo(function HourCell({
  h,
  units,
  active,
  night,
  warn,
  activity,
  drainL,
  drainR,
  drainLabel,
  actions,
}: {
  h: HourRow
  units: Units
  active: boolean
  night: boolean
  warn: boolean
  /** the quarry's activity bar, 0..1; null before the hours are scored */
  activity: number | null
  drainL: number | null
  drainR: number | null
  drainLabel: boolean
  actions: RefObject<CellActions>
}) {
  const ms = h.time.getTime()
  const midnight = h.time.getHours() === 0
  return (
    <button
      data-ms={ms}
      className={`wxcell${active ? ' wx-active' : ''}${night ? ' wxcell-night' : ''}${midnight ? ' wxcell-midnight' : ''}`}
      onPointerDown={() => actions.current.down(ms)}
      onPointerUp={() => actions.current.up()}
      onPointerLeave={() => actions.current.up()}
      onPointerCancel={() => actions.current.up()}
      onContextMenu={(e) => e.preventDefault()}
      onClick={() => actions.current.tap(ms)}
    >
      <span className="wxcell-h">{midnight ? dayShort(ms) : hourShort(ms)}</span>
      <span className="wxday-wx">
        <WindArrow deg={h.windDir} />
        <b>{windIn(units, h.windKmh)}</b>
      </span>
      <span className="wxcell-wave">
        {tempIn(units, h.tempC)}°{h.precipProbPct != null && h.precipProbPct >= 30 && <em>{h.precipProbPct}%</em>}
      </span>
      {isThunder(h.weatherCode) && <span className="wxcell-bolt wx-bolt">⚡</span>}
      {warn && <span className="wxcell-warn">!</span>}
      {activity != null && <span className="wxbar" style={bar(activity)} />}
      {drainL != null && drainR != null && (
        <span className="wxdrain" style={{ left: drainL === 0 ? -2 : `${drainL * 100}%`, right: drainR === 1 ? -2 : `${(1 - drainR) * 100}%` }}>
          {drainLabel && <span className="wxdrain-label">drains</span>}
        </span>
      )}
    </button>
  )
})

/** A strip button's press and hold: `onHold` after 450 ms, and the click
 *  that follows the lift is swallowed. Spread `bind` on the button and
 *  pass its tap to `tap`. */
function useHold(onHold: () => void) {
  const timer = useRef(0)
  const held = useRef(false)
  const up = () => window.clearTimeout(timer.current)
  const bind = {
    onPointerDown: () => {
      held.current = false
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => {
        held.current = true
        if (navigator.vibrate) navigator.vibrate(12)
        onHold()
      }, 450)
    },
    onPointerUp: up,
    onPointerLeave: up,
    onPointerCancel: up,
    onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault(),
  }
  const tap = (fn: () => void) => () => {
    if (held.current) return void (held.current = false)
    fn()
  }
  return { bind, tap }
}

export default function WeatherStrip() {
  // the wind and habitat grids coming in from the network: the hairline at the strip's foot
  const load = useLoadProgress()
  const stripOpen = useAppStore((s) => s.stripOpen)
  const setStripOpen = useAppStore((s) => s.setStripOpen)
  const planTimeMs = useAppStore((s) => s.planTimeMs)
  const setPlanTime = useAppStore((s) => s.setPlanTime)
  const units = useAppStore((s) => s.units)
  const online = useAppStore((s) => s.online)
  const outdoor = useAppStore((s) => s.outdoor)
  const hotHidden = useAppStore((s) => s.hotHidden)
  const setHotHidden = useAppStore((s) => s.setHotHidden)
  // your marks on the map: a tap hides or brings back the lot, a hold picks which
  const marks = useAppStore((s) => s.marks)
  const setMark = useAppStore((s) => s.setMark)
  const marksHidden = useAppStore((s) => s.marksHidden)
  const setMarksHidden = useAppStore((s) => s.setMarksHidden)
  const marksOn = !marksHidden && MARK_KINDS.some((k) => marks[k])
  const [marksMenu, setMarksMenu] = useState(false)
  const marksRef = useRef<HTMLSpanElement>(null)
  useTapOff(marksRef, marksMenu, () => setMarksMenu(false))
  const marksHold = useHold(() => setMarksMenu(true))
  const tapMarks = () => {
    if (marksOn) return setMarksHidden(true)
    // none picked: the tap brings them all
    if (!MARK_KINDS.some((k) => marks[k])) MARK_KINDS.forEach((k) => setMark(k, true))
    setMarksHidden(false)
  }
  const setOutdoor = useAppStore((s) => s.setOutdoor)
  const selectedId = usePlacesStore((s) => s.selectedId)
  const hasFix = useGpsStore((s) => s.fix != null)
  const target = useSpotsStore((s) => s.target)
  const heat = useSpotsStore((s) => s.heat)
  const setHeat = useSpotsStore((s) => s.setHeat)
  const heatScale = useSpotsStore((s) => s.heatScale)
  const setHeatScale = useSpotsStore((s) => s.setHeatScale)
  const heatStrength = useSpotsStore((s) => s.heatStrength)
  const setHeatStrength = useSpotsStore((s) => s.setHeatStrength)
  const stripButtons = useAppStore((s) => s.stripButtons)
  // a press and hold on the heat button: how it is coloured
  const [heatMenu, setHeatMenu] = useState(false)
  const heatRef = useRef<HTMLSpanElement>(null)
  useTapOff(heatRef, heatMenu, () => setHeatMenu(false))
  const heatHold = useHold(() => setHeatMenu(true))
  const ico = { normal: 16, large: 20, xlarge: 26 }[stripButtons]
  const plans = useSpotsStore((s) => s.plans)
  const hourScores = useSpotsStore((s) => s.hours)
  const checks = useWindChecks((s) => s.checks)
  const newMaps = useMapUpdates((s) => s.pending.length)
  useLookTick()
  useHourTick()

  const [forecast, setForecast] = useState<PointForecast | null>(null)
  const [stale, setStale] = useState(false)
  const [subject, setSubject] = useState<Subject | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [quarryOpen, setQuarryOpen] = useState(false)
  const [detailMs, setDetailMs] = useState<number | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [groundTick, setGroundTick] = useState(0)
  const [drains, setDrains] = useState<DrainRun[]>([])
  /** the day whose hours are in the middle of the row as it scrolls */
  const [viewDayMs, setViewDayMs] = useState<number | null>(null)

  // the subject's forecast: cache first, refetched on the half hour and after a sweep
  useEffect(() => {
    let alive = true
    const run = () =>
      void loadSubject(false).then((r) => {
        if (!alive) return
        setSubject(r.subject)
        setForecast(r.forecast)
        setStale(r.stale)
      })
    run()
    const t = window.setInterval(run, REFRESH_MS)
    const off = onWeatherRefreshed(run)
    return () => {
      alive = false
      window.clearInterval(t)
      off()
    }
  }, [selectedId, hasFix, online])

  // the ground model's inputs, once the strip is open: the drains line and the hour's ground air
  useEffect(() => {
    if (!stripOpen) return
    const bump = () => setGroundTick((t) => t + 1)
    void Promise.all([loadMicro(), ensureProfile()]).then(bump)
    const offs = [onMicro(bump), onProfile(bump), onWeatherGrid(bump)]
    return () => offs.forEach((o) => o())
  }, [stripOpen])

  const now = Date.now()
  const floorNow = floorHourMs(now)
  const todayMs = startOfDayMs(now)
  const todayIdx = forecast ? forecast.daily.date.findIndex((d) => new Date(`${d}T00:00`).getTime() === todayMs) : -1
  // a cache that no longer reaches today is no outlook
  const f = todayIdx >= 0 ? forecast : null

  const days = useMemo(() => {
    if (!f) return []
    return f.daily.date.slice(todayIdx).map((d, k) => {
      const i = todayIdx + k
      return {
        start: new Date(`${d}T00:00`).getTime(),
        code: f.daily.weatherCode[i],
        hi: f.daily.tMaxC[i],
        lo: f.daily.tMinC[i],
        pop: f.daily.precipProbMaxPct[i],
      }
    })
  }, [f, todayIdx])

  // every hour from this one on, across the days — overnight included
  const hours: HourRow[] = useMemo(() => {
    if (!f) return []
    const out: HourRow[] = []
    f.hourly.time.forEach((t, i) => {
      if (Date.parse(t) >= floorNow) out.push(hourRow(f, i))
    })
    return out
  }, [f, floorNow])

  // sun down to sun up, per day, to shade the night hours
  const nights = useMemo(() => {
    if (!f) return [] as [number, number][]
    const { sunrise, sunset } = f.daily
    return sunset.slice(0, -1).map((ss, i) => [Date.parse(ss), Date.parse(sunrise[i + 1])] as [number, number])
  }, [f])
  const firstRise = f ? Date.parse(f.daily.sunrise[0]) : 0
  const isNight = (ms: number) => ms < firstRise || nights.some(([a, b]) => ms >= a && ms < b)

  const plansByDay = useMemo(() => new Map(plans.map((p) => [p.dayStartMs, p])), [plans])
  const scoreByMs = useMemo(() => new Map(hourScores.map((h) => [h.ms, h])), [hourScores])
  // What changes every cell at once (a forecast, the hours scored, the
  // drains) reaches the row a moment later, in a render React can break
  // up between frames, so the map and the wind keep drawing meanwhile.
  // A tap on an hour is not deferred.
  const cellHours = useDeferredValue(hours)
  const cellScores = useDeferredValue(scoreByMs)

  const activeHourMs = planTimeMs == null ? floorNow : floorHourMs(planTimeMs)
  const selDayMs = startOfDayMs(planTimeMs ?? now)

  // a press and hold on an hour: pick it and open its detail at once
  const heldHour = useRef<number | null>(null)
  const pressedHour = useRef(0)
  const hourHold = useHold(() => {
    const ms = pressedHour.current
    if (ms === activeHourMs) return setDetailMs(ms)
    // a new pick: the effect below opens it once the hour has moved
    heldHour.current = ms
    setPlanTime(ms === floorNow ? null : ms)
  })
  const cellActions = useRef<CellActions>(null!)
  cellActions.current = {
    down: (ms) => {
      pressedHour.current = ms
      hourHold.bind.onPointerDown()
    },
    up: hourHold.bind.onPointerUp,
    tap: (ms) => hourHold.tap(() => tapHour(ms))(),
  }

  // the detail follows the picked hour; a fold or a new pick closes it, unless the pick was a hold
  useEffect(() => {
    const held = heldHour.current === activeHourMs
    heldHour.current = null
    setDetailMs(held ? activeHourMs : null)
  }, [activeHourMs, stripOpen])

  // bring the picked hour into view when it lands off-screen (a day tap, the strip opening)
  const cellsRef = useRef<HTMLDivElement>(null)
  // as the hours scroll, the day they belong to lights in the day row
  useEffect(() => {
    const row = cellsRef.current
    if (!row || !stripOpen) return
    let raf = 0
    const read = () => {
      raf = 0
      const mid = row.scrollLeft + row.clientWidth / 2
      let best: HTMLElement | null = null
      for (const el of Array.from(row.children) as HTMLElement[]) {
        if (el.offsetLeft - row.offsetLeft <= mid) best = el
        else break
      }
      const ms = best ? Number(best.dataset.ms) : NaN
      setViewDayMs(Number.isFinite(ms) ? startOfDayMs(ms) : null)
    }
    const onScroll = () => {
      if (!raf) raf = window.requestAnimationFrame(read)
    }
    row.addEventListener('scroll', onScroll, { passive: true })
    read()
    return () => {
      row.removeEventListener('scroll', onScroll)
      if (raf) window.cancelAnimationFrame(raf)
    }
  }, [stripOpen, cellHours.length])
  useEffect(() => {
    const row = cellsRef.current
    if (!row) return
    const cell = row.querySelector<HTMLElement>(`[data-ms="${activeHourMs}"]`)
    if (!cell) return
    const left = cell.offsetLeft - row.offsetLeft
    if (left < row.scrollLeft || left + cell.offsetWidth > row.scrollLeft + row.clientWidth) row.scrollTo({ left, behavior: 'smooth' })
  }, [activeHourMs, cellHours.length, stripOpen])

  // the evening drains under the hour row, one run per day in the row (and
  // the day before it, whose run carries into this morning); computed a
  // tick after the strip opens so the open itself is instant
  const firstDayMs = hours.length ? startOfDayMs(hours[0].time.getTime()) : 0
  const lastDayMs = hours.length ? startOfDayMs(hours[hours.length - 1].time.getTime()) : 0
  const subjLon = subject?.lon ?? null
  const subjLat = subject?.lat ?? null
  useEffect(() => {
    if (!stripOpen || subjLon == null || subjLat == null || !firstDayMs) {
      setDrains((d) => (d.length ? [] : d))
      return
    }
    let alive = true
    const t = window.setTimeout(() => {
      if (!alive) return
      const out: DrainRun[] = []
      for (let d = dayBefore(firstDayMs); d <= lastDayMs; d = dayAfter(d)) {
        const w = drainWindow(subjLon, subjLat, d)
        if (w) out.push(w)
      }
      setDrains(out)
    }, 0)
    return () => {
      alive = false
      window.clearTimeout(t)
    }
  }, [stripOpen, subjLon, subjLat, firstDayMs, lastDayMs, groundTick, checks, forecast])
  const cellDrains = useDeferredValue(drains)

  // the picked hour's detail
  const detail = useMemo(() => {
    if (detailMs == null || !f || !subject) return null
    const h = hourAt(f, detailMs)
    if (!h) return null
    // the ground's own air around the hour: the window it sits in, else the next one
    const { now: airNow, next: airNext } = groundAirAround(subject.lon, subject.lat, detailMs)
    const airWin = airNow ?? airNext
    const air = airWin ? `${airNow ? `till ${clockShort(airNow.endMs)}` : `from ${clockShort(airWin.startMs)}`} ${REGIME_TIP[airWin.regime]}` : null
    const dayIdx = f.daily.date.findIndex((d) => new Date(`${d}T00:00`).getTime() === startOfDayMs(detailMs))
    return { ms: detailMs, h, air, score: scoreByMs.get(detailMs) ?? null, dayIdx }
    // groundTick and checks: the model's inputs, which change what groundAirAround returns
  }, [detailMs, f, subject, scoreByMs, groundTick, checks])

  const quarryRef = useRef<HTMLSpanElement>(null)
  useTapOff(quarryRef, quarryOpen, () => setQuarryOpen(false))

  // ⋯ while its menu is open: the menu's tap-off closes it on the same
  // tap, so the button must not open it again. What it was at finger-down
  // decides (the tap-off may have re-rendered before the click lands).
  const dotsWasOpen = useRef(false)
  const dots = {
    onPointerDown: () => {
      dotsWasOpen.current = menuOpen
    },
    onClick: () => {
      const was = dotsWasOpen.current
      dotsWasOpen.current = false
      if (!was) setMenuOpen(true)
    },
  }

  const temp = (c: number) => tempIn(units, c)
  const wind = (k: number) => windIn(units, k)

  const tapHour = (ms: number) => {
    if (ms === activeHourMs) setDetailMs((d) => (d === ms ? null : ms))
    else setPlanTime(ms === floorNow ? null : ms)
  }

  const refresh = () => {
    if (refreshing) return
    setRefreshing(true)
    void refreshWeather('strip', true)
      .then(() => loadSubject(true))
      .then((r) => {
        setSubject(r.subject)
        setForecast(r.forecast)
        setStale(r.stale)
      })
      .finally(() => setRefreshing(false))
  }

  const emptyText = online ? 'Fetching the outlook…' : 'No outlook cached'

  const quarryRow = (t: Target) => (
    <button
      key={t}
      className="menu-row"
      role="menuitemradio"
      aria-checked={t === target}
      onClick={() => {
        setQuarryOpen(false)
        pickTarget(t)
      }}
    >
      {TARGET_NAMES[t]}
      {t === target && (
        <span className="wx-menu-check">
          <IconCheck size={16} />
        </span>
      )}
    </button>
  )

  // the head, folded or open: what you are after, the heat map for it, Now
  // while the planning time is not now, ⋯; folded, a chevron opens the days
  // and the rest
  const head = (
    <div className={`wx-head${{ normal: '', large: ' wx-head-lg', xlarge: ' wx-head-xl' }[stripButtons]}`}>
      <span className="wx-quarry" ref={quarryRef}>
        <button className="wx-chip" onClick={() => setQuarryOpen((o) => !o)} aria-haspopup="menu" aria-expanded={quarryOpen}>
          {TARGET_NAMES[target]} <span className="dim">▾</span>
        </button>
        {quarryOpen && (
          <div className="menu-pop" role="menu" aria-label="What you are after">
            {HUNT_TARGETS.map(quarryRow)}
            <div className="wx-menu-rule" />
            {FISH_TARGETS.map(quarryRow)}
          </div>
        )}
      </span>
      <span className="wx-quarry" ref={heatRef}>
        <button
          className={`wx-heat${heat ? ' on' : ''}${heatMenu ? ' held' : ''}`}
          {...heatHold.bind}
          onClick={heatHold.tap(() => setHeat(!heat))}
          aria-pressed={heat}
          aria-label="Heat map · hold for its colouring"
        >
          <IconHeat size={ico} />
        </button>
        {heatMenu && (
          <div className="menu-pop wx-heatmenu" role="menu" aria-label="Heat map colouring">
            <div className="hd-title">
              <IconHeat size={16} />
              Heat map
            </div>
            <div className="hd-row">
              <span>Colour by</span>
              <div className="seg" role="radiogroup" aria-label="Colour by">
                <button className={heatScale === 'day' ? 'seg-on' : ''} role="radio" aria-checked={heatScale === 'day'} onClick={() => setHeatScale('day')}>
                  Day's best
                </button>
                <button className={heatScale === 'fixed' ? 'seg-on' : ''} role="radio" aria-checked={heatScale === 'fixed'} onClick={() => setHeatScale('fixed')}>
                  Fixed
                </button>
              </div>
            </div>
            <div className="wx-heathint">{heatScale === 'day' ? 'The best of this day lights up, even a poor one. The scores stay as they are.' : 'Only stands that score well light up; a poor day can be dark.'}</div>
            <div className="hd-row">
              <span>
                Strength <span className="numeral dim">· {Math.round(heatStrength * 100)}%</span>
              </span>
              <input type="range" min={50} max={150} step={10} value={Math.round(heatStrength * 100)} onChange={(e) => setHeatStrength(Number(e.target.value) / 100)} aria-label="Strength" />
            </div>
          </div>
        )}
      </span>
      <button className={`wx-heat wx-theme${outdoor ? ' on' : ''}`} onClick={() => setOutdoor(!outdoor)} aria-pressed={outdoor} aria-label="Outdoor · light chrome for sun">
        <IconSun size={ico} />
      </button>
      <button className={`wx-heat wx-theme${hotHidden ? ' on' : ''}`} onClick={() => setHotHidden(!hotHidden)} aria-pressed={hotHidden} aria-label={hotHidden ? 'Show the map buttons' : 'Hide the map buttons'}>
        {hotHidden ? <IconGridOff size={ico} /> : <IconGrid size={ico} />}
      </button>
      <span className="wx-quarry" ref={marksRef}>
        <button
          className={`wx-heat wx-theme${marksOn ? ' on' : ''}${marksMenu ? ' held' : ''}`}
          {...marksHold.bind}
          onClick={marksHold.tap(tapMarks)}
          aria-pressed={marksOn}
          aria-label={`${marksOn ? 'Hide' : 'Show'} your marks · hold to pick which`}
        >
          <IconPin size={ico} />
        </button>
        {marksMenu && (
          <div className="menu-pop wx-marksmenu" role="menu" aria-label="Marks on the map">
            <div className="hd-title">
              <IconPin size={16} />
              Marks on the map
            </div>
            {MARK_KINDS.map((k) => (
              <button key={k} className="menu-row" role="menuitemcheckbox" aria-checked={marks[k]} onClick={() => setMark(k, !marks[k])}>
                {MARK_NAMES[k]}
                {marks[k] && (
                  <span className="wx-menu-check">
                    <IconCheck size={16} />
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </span>
      {f ? <span className="wx-spacer" /> : <span className="wx-spacer wxstrip-empty">{emptyText}</span>}
      {planTimeMs != null && (
        <button className="wx-now" onClick={() => setPlanTime(null)}>
          Now
        </button>
      )}
      {!stripOpen && (
        <button className="wx-open" onClick={() => setStripOpen(true)} aria-label="Open the strip">
          <IconChevronDown size={18} />
        </button>
      )}
      <button className={`wxfold-dots${newMaps ? ' has-new' : ''}`} {...dots} aria-label="More">
        <IconDots />
      </button>
      <AppMenu open={menuOpen} onClose={() => setMenuOpen(false)} />
    </div>
  )

  return (
    <div className="wxstrip glass">
      {stale && <span className="wxstrip-stale" />}
      {load.visible && (
        <span
          className={`wxstrip-load${load.done ? ' wxstrip-load-done' : ''}${load.known ? '' : ' wxstrip-load-unknown'}`}
          style={load.known ? { width: `${load.pct}%` } : undefined}
          aria-hidden
        />
      )}
      {head}
      {f && (
        <>
          {stripOpen && (
          <div className="wxstrip-days">
            {days.map((d) => {
              const plan = plansByDay.get(d.start)
              const act = plan && plan.best ? (plan[plan.best]?.activity ?? 0) : 0
              return (
                <button
                  key={d.start}
                  className={`wxday${d.start === selDayMs ? ' wxday-on' : ''}${d.start === viewDayMs && d.start !== selDayMs ? ' wxday-view' : ''}`}
                  onClick={() => setPlanTime(d.start === todayMs ? null : d.start + DAY_FROM_H * H)}
                >
                  <span className="wxday-name">
                    {dayLabel(d.start)}
                    {d.pop != null && d.pop >= 30 && <em className="wxday-pop">{d.pop}%</em>}
                  </span>
                  <span className="wxday-wx">
                    <SkyGlyph code={d.code} />
                    <b>{temp(d.hi)}°</b>
                    <span>{temp(d.lo)}°</span>
                  </span>
                  <span className="wxbar" style={bar(activityBar(target, act))} />
                </button>
              )
            })}
          </div>
          )}
          <div className={`wxstrip-cells${cellDrains.length ? ' wx-drains' : ''}`} ref={cellsRef}>
            {cellHours.map((h) => {
              const ms = h.time.getTime()
              const sc = cellScores.get(ms)
              const dr = drainAt(cellDrains, ms, floorNow)
              return (
                <HourCell
                  key={ms}
                  h={h}
                  units={units}
                  active={ms === activeHourMs}
                  night={isNight(ms)}
                  warn={!!sc && sc.warnings.length > 0}
                  activity={sc ? activityBar(target, sc.activity) : null}
                  drainL={dr?.l ?? null}
                  drainR={dr?.r ?? null}
                  drainLabel={!!dr?.label}
                  actions={cellActions}
                />
              )
            })}
          </div>
          {detail && subject && (
            <div className="wxdetail">
              <span>
                {hourAmPm(detail.ms)} <span className="dim">{subject.name === 'Here' ? 'here' : `at ${subject.name.toLowerCase()}`}</span>
              </span>
              <span>
                Gusts {wind(detail.h.gustKmh)} <span className="dim">·</span> feels {temp(detail.h.feelsC)}°
                {detail.score && (
                  <>
                    {' '}
                    <span className="dim">·</span>{' '}
                    <span className={`wx-grade-${detail.score.grade}`}>
                      {TARGET_NAMES[target].toLowerCase()}: {detail.score.grade}
                    </span>
                  </>
                )}
              </span>
              {detail.air && (
                <span>
                  <span className="wx-ground">Ground air</span> {detail.air}
                </span>
              )}
              {detail.score?.warnings.map((w, i) => (
                <span key={i} className="wx-warn">
                  {w}
                </span>
              ))}
              <DetailRest f={f} ms={detail.ms} h={detail.h} dayIdx={detail.dayIdx} subject={subject} stale={stale} online={online} refreshing={refreshing} onRefresh={refresh} wind={wind} />
            </div>
          )}
        </>
      )}
      {stripOpen && (
        <button className="wxfold-handle" onClick={() => setStripOpen(false)} aria-label="Fold the strip">
          <IconChevronUp size={16} />
        </button>
      )}
    </div>
  )
}

/** The rest of the hour's detail, always out (no more/less, 2026-10-03):
 *  the sun, legal light, the moon, the day's wind, any rain or snow that
 *  hour, and where the forecast came from, when, and when the next HD
 *  (HRDPS) run lands, so nobody refreshes for nothing. Refresh shows only
 *  once a newer run is in. */
function DetailRest({
  f,
  ms,
  h,
  dayIdx,
  subject,
  stale,
  online,
  refreshing,
  onRefresh,
  wind,
}: {
  f: PointForecast
  ms: number
  h: HourRow
  dayIdx: number
  subject: Subject
  stale: boolean
  online: boolean
  refreshing: boolean
  onRefresh: () => void
  wind: (k: number) => number
}) {
  const sun = dayIdx >= 0 ? { sunriseMs: Date.parse(f.daily.sunrise[dayIdx]), sunsetMs: Date.parse(f.daily.sunset[dayIdx]) } : sunTimes(ms, subject.lat, subject.lon)
  const moon = moonPhase(ms)
  // the next HRDPS run after this forecast was fetched; landed already (or the copy is stale), a refresh is worth it
  const now = Date.now()
  const next = nextHrdpsRunMs(forecastBasisMs(f))
  const newer = stale || next <= now
  return (
    <div className="wxdetail-more">
      {sun.sunriseMs != null && sun.sunsetMs != null && (
        <>
          <span>
            Sunrise {clockShort(sun.sunriseMs)} · Sunset {clockShort(sun.sunsetMs)}
          </span>
          <span>
            Legal light {clockShort(sun.sunriseMs - LEGAL_MS)}–{clockShort(sun.sunsetMs + LEGAL_MS)}
          </span>
        </>
      )}
      <span>
        Moon {moon.name} · {Math.round(moon.illumination * 100)}% lit
      </span>
      {dayIdx >= 0 && <span>Day: wind to {wind(f.daily.windMaxKmh[dayIdx])}</span>}
      {h.precipMm > 0 && <span>Rain {h.precipMm.toFixed(1)} mm</span>}
      {h.snowCm > 0 && <span>Snow {h.snowCm.toFixed(1)} cm</span>}
      <span>
        {h.hrdps ? 'HRDPS 2.5 km' : 'Open-Meteo blend'} · {h.sat && f.sat ? `by satellite ${agoLabel(now - f.sat.at)}` : agoLabel(now - f.fetchedAt)}
        {newer ? (
          <>
            {' · '}
            <span className="wx-newer">a newer HD forecast is in</span>
            <button className="linklike" onClick={onRefresh} disabled={refreshing || !online}>
              {refreshing ? 'Refreshing…' : online ? 'Refresh' : 'fetches with signal'}
            </button>
            {!online && (
              <>
                {' or '}
                <button className="linklike" onClick={() => useAppStore.getState().openSheet({ kind: 'sat' })}>
                  by satellite
                </button>
              </>
            )}
          </>
        ) : (
          ` · next HD ~${isToday(next) ? '' : `${dayShort(next)} `}${hourMinShort(next)}`
        )}
      </span>
    </div>
  )
}
