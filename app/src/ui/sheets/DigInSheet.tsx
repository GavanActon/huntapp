import { useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { fmtCoord } from '../../map/MapView'
import { DROPPED_NAME } from '../../map/placePopup'
import { useMeasureStore } from '../../measure/measureStore'
import { openRoutes } from '../../routes/routeStore'
import { useAppStore } from '../../state/appStore'
import { homePlace, usePlacesStore } from '../../state/placesStore'
import { useSpotsStore } from '../../state/spotsStore'
import { bestWindow, type WindowScore } from '../../spots/dayPlan'
import { spotGrade } from '../../spots/grades'
import { bestWindowHere, fromHome, pointCase, sightLines } from '../../spots/scoring'
import { isFish, TARGET_NAMES } from '../../spots/types'
import { dayShort, isToday, startOfDayMs } from '../../time'
import { ensureProfile, onProfile } from '../../weather/boundaryLayer'
import { groundDay, loadMicro, onMicro, REGIME_CLASS, REGIME_LABEL, type Regime, type Window } from '../../weather/micro/model'
import { useScent } from '../../weather/micro/scent'
import { useWindChecks } from '../../weather/micro/windChecks'
import { compass } from '../../weather/openMeteo'
import { ensureWeatherGrid, onWeatherGrid } from '../../weather/windGrid'
import { IconCrew, IconDots, IconRoute } from '../icons'
import { useTapOff } from '../tapOff'
import './digin.css'

/**
 * Dig in: the tapped spot, one sheet. Where it is from camp, its score
 * with the three reasons that made it (Scoring › for the arithmetic and
 * the knobs), what the wind does to scent there through the day and how
 * far you see each way, each opened in place, then Set up here and Route
 * in. The point is the store's `digIn` (the white ring), never a place
 * selection, so the heat, the pins and the strip stay where they are.
 */

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

/** "9a", "6:30p": an hour the way the strip says it, minutes only when they are not zero. */
function hr(ms: number): string {
  const d = new Date(ms)
  const h = d.getHours()
  const m = d.getMinutes()
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''}${h < 12 ? 'a' : 'p'}`
}

/** What scent does in a regime, as a verb. */
function verb(r: Regime): string {
  return r === 'drainage' || r === 'pooled' ? 'sinks' : r === 'calm' ? 'hangs' : 'goes'
}

/** The way scent goes in a window: "S", or nothing in a calm. */
function toward(w: Window): string {
  return w.regime === 'calm' ? '' : compass((w.dirFrom + 180) % 360)
}

/** "scent sinks S" / "scent hangs". */
function scentWords(w: Window): string {
  const t = toward(w)
  return `scent ${verb(w.regime)}${t ? ` ${t}` : ''}`
}

/** ", then SE" / ", then hangs": where the next window takes it. */
function thenWords(next: Window | null): string {
  if (!next) return ''
  return `, then ${next.regime === 'calm' ? 'hangs' : toward(next)}`
}

/** The bar's one-word label for a window. */
function barWord(r: Regime): string {
  return r === 'drainage' || r === 'pooled' ? 'drains' : r === 'wind' ? 'wind' : r === 'upslope' ? 'upslope' : r === 'calm' ? 'calm' : 'breeze'
}

/** The heading: a place tapped on itself (the camp, a lake, a pin) goes by
 *  its name; anywhere else is "650 m NE of Camp". */
function title(lon: number, lat: number): string {
  const home = homePlace()
  const kx = 111_320 * Math.cos((lat * Math.PI) / 180)
  const on = usePlacesStore.getState().places.find((p) => Math.hypot((p.lon - lon) * kx, (p.lat - lat) * 110_574) < 30)
  return on && on.name ? on.name : fromHome(lon, lat, home)
}

/** Local midnight after `dayStartMs` (DST-safe). */
function nextDayStart(dayStartMs: number): number {
  const d = new Date(dayStartMs)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime()
}

export default function DigInSheet({ lon, lat }: { lon: number; lat: number }): JSX.Element {
  const target = useSpotsStore((s) => s.target)
  const conditions = useSpotsStore((s) => s.conditions)
  const weights = useSpotsStore((s) => s.weights)
  const plans = useSpotsStore((s) => s.plans)
  const result = useSpotsStore((s) => s.result)
  const status = useSpotsStore((s) => s.status)
  const setDigIn = useSpotsStore((s) => s.setDigIn)
  const planTimeMs = useAppStore((s) => s.planTimeMs)
  const units = useAppStore((s) => s.units)
  const pushSheet = useAppStore((s) => s.pushSheet)
  const closeSheet = useAppStore((s) => s.closeSheet)
  const checks = useWindChecks((s) => s.checks)
  const [menu, setMenu] = useState(false)
  const [windOpen, setWindOpen] = useState(false)
  const [seeOpen, setSeeOpen] = useState(false)
  // the ground model, the layering profile and the wind grid arrive on their own time
  const [tick, setTick] = useState(0)
  const menuRef = useRef<HTMLDivElement>(null)
  useTapOff(menuRef, menu, () => setMenu(false))

  // the white ring, for as long as the sheet is on this point
  useEffect(() => {
    setDigIn({ lon, lat })
    return () => setDigIn(null)
  }, [lon, lat, setDigIn])

  useEffect(() => {
    const bump = () => setTick((t) => t + 1)
    void Promise.all([loadMicro(), ensureProfile(), ensureWeatherGrid()]).then(bump)
    const offs = [onMicro(bump), onProfile(bump), onWeatherGrid(bump)]
    return () => offs.forEach((o) => o())
  }, [])

  const fish = isFish(target)
  const name = TARGET_NAMES[target].toLowerCase()
  const pc = useMemo(() => (conditions ? pointCase(target, lon, lat, conditions, weights) : null), [target, lon, lat, conditions, weights])
  const best = useMemo<WindowScore | null>(() => (pc ? (bestWindowHere(target, lon, lat, plans, weights) ?? bestWindow(plans)?.win ?? null) : null), [pc, target, lon, lat, plans, weights])

  // ---- the wind through the day at this point
  const atMs = planTimeMs ?? Date.now()
  const dayMs = startOfDayMs(atMs)
  // groundDay is memoised by the model; tick and checks are here to re-read it when its inputs move
  const windows = useMemo(() => groundDay(lon, lat, dayMs), [lon, lat, dayMs, tick, checks])
  const curIdx = windows.findIndex((w) => atMs >= w.startMs && atMs < w.endMs)
  const cur = curIdx >= 0 ? windows[curIdx] : null
  const next = curIdx >= 0 ? (windows[curIdx + 1] ?? null) : null
  const spd = (k: number) => `${Math.round(units === 'imperial' ? k * 0.621371 : k)}`
  const dayLen = nextDayStart(dayMs) - dayMs

  /** "Until 9a · Cold air draining: scent sinks S" / "9a–6p · NW 8 reaches the ground: scent goes SE". */
  const windLine = (w: Window, k: number) => {
    const when = k === 0 ? `Until ${hr(w.endMs)}` : `${hr(w.startMs)}–${hr(w.endMs)}`
    const what = w.regime === 'wind' ? `${compass(w.dirFrom)} ${spd(w.kmh)} reaches the ground` : REGIME_LABEL[w.regime]
    return (
      <span key={w.startMs} className="digin-line">
        <b>{when}</b> <span className="dim">·</span> {what}: {scentWords(w)}
      </span>
    )
  }

  // ---- how far you see (tick: the grid may land after the sheet opens)
  const lines = useMemo(() => (fish ? null : sightLines(lon, lat)), [fish, lon, lat, tick])
  const open = lines?.filter((l) => l.m >= 80).map((l) => compass(l.bearing)) ?? []
  const thick = lines?.filter((l) => l.m < 35).map((l) => compass(l.bearing)) ?? []
  const dist = (m: number) => (units === 'imperial' ? `${Math.round(m * 1.0936)} yd` : `${Math.round(m)} m`)
  const seeWords = lines
    ? [open.length ? `open ${open.join(', ')}` : '', thick.length ? `thick ${thick.join(', ')}` : ''].filter(Boolean).join(' · ') ||
      `${dist(Math.min(...lines.map((l) => l.m)))}–${dist(Math.max(...lines.map((l) => l.m)))}`
    : ''

  // ---- the ⋯ menu
  const pin = () => {
    // dropped and left alone: nothing selected, no sheet (Pins lists it)
    usePlacesStore.getState().add({ name: DROPPED_NAME, lon, lat, kind: 'stand' })
    setMenu(false)
  }
  const copy = () => {
    void navigator.clipboard?.writeText(fmtCoord(lon, lat))
    setMenu(false)
  }
  const measure = () => {
    useMeasureStore.getState().start([lon, lat])
    closeSheet()
  }

  // ---- the actions
  const setUp = () => {
    const sc = useScent.getState()
    if (sc.people.length) sc.add(lon, lat)
    else sc.show(lon, lat)
    closeSheet()
  }
  const routeIn = () => openRoutes({ lon, lat, name: title(lon, lat) })

  const bestWords = best ? `best ${isToday(best.atMs) ? 'today' : dayShort(best.atMs)} ${hr(best.atMs)}` : ''

  const windRow = (opened: boolean) =>
    cur && (
      <button className="digin-row" aria-expanded={opened} onClick={() => setWindOpen(!opened)}>
        <span>
          <b>Wind</b> <span className="dim">·</span> {scentWords(cur)} till {hr(cur.endMs)}
          {thenWords(next)}
        </span>
        <span className="dim">{opened ? '⌄' : '›'}</span>
      </button>
    )
  const seeRow = (opened: boolean) => (
    <button className="digin-row" aria-expanded={opened} onClick={() => setSeeOpen(!opened)}>
      <span>
        <b>See</b> <span className="dim">·</span> {seeWords}
      </span>
      <span className="dim">{opened ? '⌄' : '›'}</span>
    </button>
  )

  return (
    <div className="digin">
      <div className="sheet-head">
        <span className="sheet-title">{title(lon, lat)}</span>
        <div className="sheet-actions" ref={menuRef}>
          <button className="sheet-dots" aria-label="More" aria-expanded={menu} onClick={() => setMenu(!menu)}>
            <IconDots />
          </button>
          {menu && (
            <div className="menu-pop" role="menu">
              <button className="menu-row" role="menuitem" onClick={pin}>
                Pin
              </button>
              <button className="menu-row" role="menuitem" onClick={copy}>
                Copy coordinates
              </button>
              <button className="menu-row" role="menuitem" onClick={measure}>
                Measure from here
              </button>
            </div>
          )}
        </div>
      </div>

      {pc ? (
        <div className="digin-top">
          <span className={`digin-score ${spotGrade(pc.score)}`}>{Math.round(pc.score * 100)}</span>
          <div className="digin-case">
            <span className="digin-grade">
              {cap(spotGrade(pc.score))} {fish ? 'spot' : 'stand'} for {name}
              {bestWords && <span className="dim"> · {bestWords}</span>}
            </span>
            {pc.reasons.slice(0, 3).map((r, k) => (
              <span key={k} className="digin-reason">
                {cap(r)}
              </span>
            ))}
            {result?.verdict.warnings.map((w) => (
              <span key={w} className="digin-warn">
                {w}
              </span>
            ))}
            <button className="digin-more" onClick={() => pushSheet({ kind: 'scoring', lon, lat })}>
              Scoring ›
            </button>
          </div>
        </div>
      ) : (
        <div className="digin-empty">
          {status === 'no-grid' ? 'No habitat grid on this phone' : status === 'no-forecast' ? 'No forecast cached' : status === 'ready' ? 'Off the habitat grid' : '…'}
        </div>
      )}

      <div className="digin-rows">
        {/* ---- Wind: what scent does here now, and through the day ---- */}
        {!cur ? (
          <div className="digin-row">
            <span>
              <b>Wind</b> <span className="dim">·</span> no forecast yet
            </span>
          </div>
        ) : !windOpen ? (
          windRow(false)
        ) : (
          <div className="digin-open">
            {windRow(true)}
            <div className="digin-barwrap" aria-hidden="true">
              <div className="digin-bar">
                {windows.map((w) => {
                  const drains = w.regime === 'drainage' || w.regime === 'pooled'
                  const cls = `${drains ? 'drains ' : ''}${REGIME_CLASS[w.regime] ?? (w.regime === 'calm' ? 'gd-calm' : '')}`.trim()
                  return (
                    <span key={w.startMs} className={cls || undefined} style={{ flexGrow: w.endMs - w.startMs, flexBasis: 0 }}>
                      {barWord(w.regime)}
                    </span>
                  )
                })}
              </div>
              <span className="digin-tick" style={{ left: `${Math.max(0, Math.min(100, ((atMs - dayMs) / dayLen) * 100))}%` }} />
            </div>
            <div className="digin-hours" aria-hidden="true">
              <span>12a</span>
              <span>6a</span>
              <span>12p</span>
              <span>6p</span>
              <span>12a</span>
            </div>
            {windLine(cur, curIdx)}
            {next && windLine(next, curIdx + 1)}
          </div>
        )}

        {/* ---- See: how far, each way ---- */}
        {lines &&
          (!seeOpen ? (
            seeRow(false)
          ) : (
            <div className="digin-open">
              {seeRow(true)}
              <div className="digin-see">
                {lines.map((l) => (
                  <span key={l.bearing} className={l.m >= 80 ? 'open' : l.m < 35 ? 'thick' : undefined}>
                    <b>{compass(l.bearing)}</b>
                    {dist(l.m)}
                  </span>
                ))}
              </div>
            </div>
          ))}
      </div>

      <div className="digin-acts">
        <button className="digin-pri" onClick={setUp}>
          <IconCrew size={18} />
          Set up here
        </button>
        <button onClick={routeIn}>
          <IconRoute size={16} />
          Route in
        </button>
      </div>
    </div>
  )
}
