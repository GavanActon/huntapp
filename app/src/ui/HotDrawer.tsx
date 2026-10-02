import { useEffect, type JSX, type ReactNode, type RefObject } from 'react'
import { inRegion } from '../config'
import { heardThisHunt } from '../hunting/moveLayer'
import { useHuntLog, type LogSpecies } from '../log/huntLog'
import { snapshot } from '../log/snapshot'
import { useMeasureStore } from '../measure/measureStore'
import { campEnd, clearRoutes, useRoutes, youEnd } from '../routes/routeStore'
import { isFish } from '../spots/types'
import { CONTOUR_INTERVALS, useAppStore, type HotId, type LayerOpacity } from '../state/appStore'
import { useSpotsStore } from '../state/spotsStore'
import { useGpsStore } from '../tracking/gpsStore'
import { clearPlaced, SCENT_HEIGHTS, useScent } from '../weather/micro/scent'
import { useWindChecks } from '../weather/micro/windChecks'
import { useTapOff } from './tapOff'

/**
 * A hot button's drawer: a press and hold slides it out beside the button,
 * toward the map, with the things that button rarely needs — its knobs,
 * an undo, the way to its sheet. The far column's drawers carry more, the
 * thumb's side stays thin. Map buttons, the editor, is the ⋯ menu's, not
 * a row in every drawer. A tap off closes it; a row that goes somewhere
 * closes it first.
 */

type Opt<T> = readonly [T, string]

function Act({ children, onTap, disabled, on }: { children: ReactNode; onTap: () => void; disabled?: boolean; on?: boolean }) {
  return (
    <button className={`hd-act${on ? ' on' : ''}`} onClick={onTap} disabled={disabled}>
      {children}
    </button>
  )
}

function Seg<T extends string | number>({ label, value, options, onPick, off }: { label: string; value: T | null; options: readonly Opt<T>[]; onPick: (v: T) => void; off?: T[] }) {
  return (
    <div className="hd-row">
      <span>{label}</span>
      <div className="seg" role="radiogroup" aria-label={label}>
        {options.map(([v, name]) => (
          <button key={String(v)} className={value === v ? 'seg-on' : ''} role="radio" aria-checked={value === v} disabled={off?.includes(v)} onClick={() => onPick(v)}>
            {name}
          </button>
        ))}
      </div>
    </div>
  )
}

function Slider({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <div className="hd-row">
      <span>
        {label} <span className="numeral dim">· {value}%</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label} />
    </div>
  )
}

function Switch({ label, on, onChange }: { label: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="hd-row">
      <span>{label}</span>
      <input type="checkbox" className="switch" checked={on} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )
}

/** Your fix, while location is on and it falls in the region. */
function youHere(): { lon: number; lat: number } | null {
  const g = useGpsStore.getState()
  const fix = g.fix
  return g.locating && fix && inRegion(fix.lon, fix.lat) ? { lon: fix.lon, lat: fix.lat } : null
}

const HEIGHTS: readonly Opt<number>[] = SCENT_HEIGHTS.map((h, i) => [h, i === 0 ? 'Ground' : `${h} m`] as const)

interface RowsProps {
  /** close the drawer, then do the thing */
  go: (f: () => void) => () => void
}

function WindFlowRows({ go }: RowsProps) {
  const level = useAppStore((s) => s.windLevel)
  const setLevel = useAppStore((s) => s.setWindLevel)
  const op = useAppStore((s) => s.windFlowOpacity)
  const setOp = useAppStore((s) => s.setWindFlowOpacity)
  const lowPower = useAppStore((s) => s.lowPower)
  const setLowPower = useAppStore((s) => s.setLowPower)
  const openSheet = useAppStore((s) => s.openSheet)
  return (
    <>
      <Seg label="Wind at" value={level} options={[['ground', 'Ground'], ['forecast', 'Forecast']] as const} onPick={setLevel} />
      <Slider label="Strength" value={Math.round(op * 100)} min={10} max={100} step={5} onChange={(v) => setOp(v / 100)} />
      <Switch label="Low power" on={lowPower} onChange={setLowPower} />
      <Act onTap={go(() => openSheet({ kind: 'settings' }))}>
        Settings <span className="dim">›</span>
      </Act>
    </>
  )
}

function ScentRows({ go }: RowsProps) {
  const height = useScent((s) => s.height)
  const setHeight = useScent((s) => s.setHeight)
  const view = useScent((s) => s.view)
  const setView = useScent((s) => s.setView)
  const placed = useScent((s) => s.people.some((p) => !p.live))
  const strength = useScent((s) => s.strength)
  const setStrength = useScent((s) => s.setStrength)
  const setTopCard = useAppStore((s) => s.setTopCard)
  return (
    <>
      <Slider label="Strength" value={Math.round(strength * 100)} min={10} max={100} step={5} onChange={(v) => setStrength(v / 100)} />
      <Seg label="Height" value={height} options={HEIGHTS} onPick={setHeight} />
      <Seg label="View" value={view === 'people' ? 'cloud' : view} options={[['cloud', 'Cloud'], ['particles', 'Particles']] as const} onPick={setView} />
      <Act onTap={go(() => useScent.getState().setAdding(true))}>+ Person</Act>
      <Act disabled={!placed} onTap={go(clearPlaced)}>
        Clear sitters
      </Act>
      <Act onTap={go(() => setTopCard({ kind: 'scent' }))}>
        Scent card <span className="dim">›</span>
      </Act>
    </>
  )
}

const INTERVALS: readonly Opt<(typeof CONTOUR_INTERVALS)[number]>[] = CONTOUR_INTERVALS.map((m) => [m, `${m} m`] as const)

/** The contour lines' interval, the lines redrawing as it is picked; the lines come on so the pick can be seen. */
function ContourRows({ go }: RowsProps) {
  const m = useAppStore((s) => s.contourInterval)
  const setInterval = useAppStore((s) => s.setContourInterval)
  const openSheet = useAppStore((s) => s.openSheet)
  useEffect(() => {
    useAppStore.getState().setLayer('contours', true)
  }, [])
  return (
    <>
      <Seg label="Lines every" value={m} options={INTERVALS} onPick={setInterval} />
      <Act onTap={go(() => openSheet({ kind: 'layers' }))}>
        Layers <span className="dim">›</span>
      </Act>
    </>
  )
}

function HeardRows({ go }: RowsProps) {
  const entries = useHuntLog((s) => s.entries)
  const locating = useGpsStore((s) => s.locating)
  const fix = useGpsStore((s) => s.fix)
  const openSheet = useAppStore((s) => s.openSheet)
  const here = locating && fix && inRegion(fix.lon, fix.lat) ? fix : null
  const es = entries.length ? heardThisHunt() : []
  const last = es[es.length - 1]
  const blankSit = () => {
    const at = youHere()
    if (!at) return
    const t = useSpotsStore.getState().target
    const species: LogSpecies = isFish(t) ? 'other' : t
    const e = useHuntLog.getState().add({ ts: Date.now(), lon: at.lon, lat: at.lat, species, what: 'nothing' })
    void snapshot(species, at.lon, at.lat)
      .then((snap) => useHuntLog.getState().update(e.id, snap))
      .catch(() => {})
  }
  return (
    <>
      <Act disabled={!here} onTap={go(blankSit)}>
        Blank sit here
      </Act>
      <Act disabled={!last} onTap={() => last && useHuntLog.getState().remove(last.id)}>
        Undo last sound
      </Act>
      <Act onTap={go(() => openSheet({ kind: 'huntlog' }))}>
        Hunt log <span className="dim">›</span>
      </Act>
    </>
  )
}

function WindCheckRows({ go }: RowsProps) {
  const checks = useWindChecks((s) => s.checks)
  const openSheet = useAppStore((s) => s.openSheet)
  const last = checks[checks.length - 1]
  return (
    <>
      <Act disabled={!last} onTap={() => last && useWindChecks.getState().remove(last.id)}>
        Undo last check
      </Act>
      <Act onTap={go(() => openSheet({ kind: 'huntlog' }))}>
        Hunt log <span className="dim">›</span>
      </Act>
    </>
  )
}

function RoutesRows({ go }: RowsProps) {
  const mode = useRoutes((s) => s.mode)
  const setMode = useRoutes((s) => s.setMode)
  const stayDry = useRoutes((s) => s.stayDry)
  const setStayDry = useRoutes((s) => s.setStayDry)
  const from = useRoutes((s) => s.from)
  const setFrom = useRoutes((s) => s.setFrom)
  const drawn = useRoutes((s) => s.kept != null || s.routes.length > 0)
  // the fix is read at the tap, so the chip follows location on and off
  useGpsStore((s) => s.locating)
  const you = youEnd()
  const fromKind = from?.kind === 'you' ? 'you' : from?.kind === 'camp' ? 'camp' : null
  return (
    <>
      <Seg label="Route" value={mode} options={[['easy', 'Easiest'], ['hunt', 'Hunt']] as const} onPick={setMode} />
      <Switch label="Stay dry" on={stayDry} onChange={setStayDry} />
      <Seg label="From" value={fromKind} options={[['you', 'You'], ['camp', 'Camp']] as const} off={you ? [] : ['you']} onPick={(v) => setFrom(v === 'you' && you ? you : campEnd())} />
      <Act disabled={!drawn} onTap={go(clearRoutes)}>
        Clear route
      </Act>
    </>
  )
}

function MeasureRows({ go }: RowsProps) {
  const pace = useAppStore((s) => s.paceKmh)
  const setPace = useAppStore((s) => s.setPaceKmh)
  const units = useAppStore((s) => s.units)
  useGpsStore((s) => s.locating)
  const you = youHere()
  const start = (p?: [number, number]) => () => {
    useAppStore.getState().closeSheet()
    useMeasureStore.getState().start(p, p ? 'you' : undefined)
  }
  const paceText = units === 'imperial' ? `${(pace * 0.621371).toFixed(1)} mph` : `${pace.toFixed(1)} km/h`
  return (
    <>
      <Act disabled={!you} onTap={go(start(you ? [you.lon, you.lat] : undefined))}>
        From you
      </Act>
      <Act onTap={go(start())}>From a tap</Act>
      <div className="hd-row">
        <span>
          Pace <span className="numeral dim">· {paceText}</span>
        </span>
        <div className="hd-step">
          <button onClick={() => setPace(Math.max(1, Math.round((pace - 0.5) * 2) / 2))} aria-label="Slower">
            −
          </button>
          <button onClick={() => setPace(Math.min(8, Math.round((pace + 0.5) * 2) / 2))} aria-label="Faster">
            +
          </button>
        </div>
      </div>
    </>
  )
}

const LAYER_OPACITY: Partial<Record<HotId, keyof LayerOpacity>> = { understory: 'understory', lanes: 'lanes' }

function LayerRows({ go, id }: RowsProps & { id: HotId }) {
  const key = LAYER_OPACITY[id]
  const op = useAppStore((s) => (key ? s.opacity[key] : 1))
  const setOpacity = useAppStore((s) => s.setOpacity)
  const openSheet = useAppStore((s) => s.openSheet)
  return (
    <>
      {key && <Slider label="Strength" value={Math.round(op * 100)} min={10} max={100} step={5} onChange={(v) => setOpacity(key, v / 100)} />}
      <Act onTap={go(() => openSheet({ kind: 'layers' }))}>
        Layers <span className="dim">›</span>
      </Act>
    </>
  )
}

function PinRows({ go }: RowsProps) {
  const openSheet = useAppStore((s) => s.openSheet)
  return (
    <Act onTap={go(() => openSheet({ kind: 'pins' }))}>
      Pins <span className="dim">›</span>
    </Act>
  )
}

function rows(id: HotId, go: RowsProps['go']): JSX.Element | null {
  switch (id) {
    case 'windflow':
      return <WindFlowRows go={go} />
    case 'scent':
      return <ScentRows go={go} />
    case 'contours':
      return <ContourRows go={go} />
    case 'heard':
      return <HeardRows go={go} />
    case 'windcheck':
      return <WindCheckRows go={go} />
    case 'routes':
      return <RoutesRows go={go} />
    case 'measure':
      return <MeasureRows go={go} />
    case 'understory':
    case 'lanes':
    case 'bathy':
    case 'radar':
      return <LayerRows go={go} id={id} />
    case 'pin':
      return <PinRows go={go} />
    default:
      return null
  }
}

/** The drawer beside a held hot button. `within` is the element a tap must land outside of to close it (the button and the drawer). */
export default function HotDrawer({ id, within, onClose }: { id: HotId; within: RefObject<HTMLElement | null>; onClose: () => void }): JSX.Element {
  useTapOff(within, true, onClose)
  const go = (f: () => void) => () => {
    onClose()
    f()
  }
  return (
    <div className="hotdrawer" role="menu">
      {rows(id, go)}
    </div>
  )
}
