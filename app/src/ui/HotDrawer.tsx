import { useEffect, type JSX, type ReactNode, type RefObject } from 'react'
import { HOME_NAME, inRegion } from '../config'
import { heardThisHunt } from '../hunting/moveLayer'
import { useHuntLog, type LogSpecies } from '../log/huntLog'
import { openHuntLog } from '../log/logView'
import { snapshot } from '../log/snapshot'
import { useMeasureStore } from '../measure/measureStore'
import { campEnd, clearRoutes, useRoutes, youEnd } from '../routes/routeStore'
import { isFish } from '../spots/types'
import { CONTOUR_INTERVALS, useAppStore, type HotId, type LayerOpacity, type LeavesMode, type WindStyle } from '../state/appStore'
import { useSpotsStore } from '../state/spotsStore'
import { useViews } from '../state/viewsStore'
import { useGpsStore } from '../tracking/gpsStore'
import { leavesWord } from '../weather/micro/leaves'
import { coneSizeWord, drawnView, SCENT_HEIGHTS, useScent, type ScentView } from '../weather/micro/scent'
import { useWindChecks } from '../weather/micro/windChecks'
import { HOT_DEFS } from './hotButtons'
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

function Seg<T extends string | number>({ label, note, value, options, onPick, off }: { label: string; note?: string; value: T | null; options: readonly Opt<T>[]; onPick: (v: T) => void; off?: T[] }) {
  return (
    <div className="hd-row">
      <span>
        {label}
        {note && <span className="dim"> · {note}</span>}
      </span>
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
const VIEWS: readonly Opt<ScentView>[] = [
  ['cloud', 'Cloud'],
  ['particles', 'Particles'],
]
// with a party placed, each one's edge in their own colour as well
const PARTY_VIEWS: readonly Opt<ScentView>[] = [...VIEWS, ['people', 'By person']]

interface RowsProps {
  /** close the drawer, then do the thing */
  go: (f: () => void) => () => void
}

/** The streak widths the thickness choices draw, px in an 18 × 14 box (Auto follows the text size). */
const STREAK_SIZES = ['auto', 'standard', 'large', 'larger'] as const
const STREAK_W: Record<(typeof STREAK_SIZES)[number], number> = { auto: 0, standard: 1.5, large: 2.6, larger: 3.7 }

/** The wind's knobs, all of them here (moved out of Settings, 2026-10-03).
 *  Turbulence: the eddies the ground model finds behind tree lines, in small
 *  openings and slots, and in the lee of hills and ridges (the momentum
 *  solve's turbulence), drawn swirling; off, the straight drift. Leaves: the
 *  ground model's own, so it moves everything that reads the ground wind. */
function WindFlowRows() {
  const level = useAppStore((s) => s.windLevel)
  const setLevel = useAppStore((s) => s.setWindLevel)
  const op = useAppStore((s) => s.windFlowOpacity)
  const setOp = useAppStore((s) => s.setWindFlowOpacity)
  const swirl = useAppStore((s) => s.flowTuning.windSwirl)
  const size = useAppStore((s) => s.flowTuning.windSize)
  const style = useAppStore((s) => s.flowTuning.windStyle)
  const setFlowTuning = useAppStore((s) => s.setFlowTuning)
  return (
    <>
      <Seg label="Wind at" value={level} options={[['ground', 'Ground'], ['forecast', 'Forecast']] as const} onPick={setLevel} />
      <Seg
        label="Look"
        value={style}
        options={WIND_STYLES}
        onPick={(v) => {
          setFlowTuning({ windStyle: v })
          useViews.getState().keepLook()
        }}
      />
      <Switch label="Turbulence" on={swirl} onChange={(v) => setFlowTuning({ windSwirl: v })} />
      <Slider label="Strength" value={Math.round(op * 100)} min={10} max={100} step={5} onChange={(v) => setOp(v / 100)} />
      <div className="hd-row">
        <span>Line thickness</span>
        <div className="seg" role="radiogroup" aria-label="Line thickness">
          {STREAK_SIZES.map((t) => (
            <button key={t} className={size === t ? 'seg-on' : ''} role="radio" aria-checked={size === t} onClick={() => setFlowTuning({ windSize: t })} aria-label={t}>
              {t === 'auto' ? (
                'Auto'
              ) : (
                <svg className="streak-a" width="18" height="14" viewBox="0 0 18 14">
                  <line x1="3" y1="11" x2="15" y2="3" stroke="currentColor" strokeLinecap="round" strokeWidth={STREAK_W[t]} />
                </svg>
              )}
            </button>
          ))}
        </div>
      </div>
      <LeavesRow />
    </>
  )
}

/** The wind's looks (weather/windFlow.ts LOOKS): Contrast is white streaks over a wash coloured by speed. */
const WIND_STYLES: readonly Opt<WindStyle>[] = [
  ['standard', 'Standard'],
  ['bold', 'Bold'],
  ['contrast', 'Contrast'],
]

const LEAVES: readonly Opt<LeavesMode>[] = [
  ['auto', 'Auto'],
  ['on', 'On'],
  ['down', 'Down'],
]

/** The hardwoods' leaves in the ground wind, and so in the scent cone and
 *  the heat map (weather/micro/leaves.ts): by the date, or held on or down
 *  for a fall that comes early or late. Rarely touched, so last. Auto says
 *  what the date gives at the planning time; the words run about as long
 *  either way, so a pick doesn't move the choices out from under the thumb. */
function LeavesRow() {
  const leaves = useAppStore((s) => s.leaves)
  const setLeaves = useAppStore((s) => s.setLeaves)
  const planMs = useAppStore((s) => s.planTimeMs)
  const note = leaves === 'auto' ? `by date, ${leavesWord(planMs ?? Date.now())}` : `${leaves}, not by date`
  return <Seg label="Leaves" note={note} value={leaves} options={LEAVES} onPick={setLeaves} />
}

/** The cone's knobs only: + Person, Clear sitters and the card are the scent card's own (2026-10-02).
 *  Cone size first: smaller (only strong scent counts) to bigger (it counts sooner, the wind wanders more).
 *  With two or more placed, the view has By person too, as Your scent's has. */
function ScentRows() {
  const height = useScent((s) => s.height)
  const setHeight = useScent((s) => s.setHeight)
  const view = useScent((s) => s.view)
  const setView = useScent((s) => s.setView)
  const n = useScent((s) => s.people.length)
  const strength = useScent((s) => s.strength)
  const setStrength = useScent((s) => s.setStrength)
  const risk = useScent((s) => s.risk)
  const setRisk = useScent((s) => s.setRisk)
  return (
    <>
      <div className="hd-row">
        <span>
          Cone size <span className="dim">· {coneSizeWord(risk)}</span>
        </span>
        <div className="hd-range">
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={1 - risk}
            onChange={(e) => setRisk(1 - Number(e.target.value))}
            aria-label="Cone size, smaller to bigger"
            aria-valuetext={coneSizeWord(risk)}
          />
          <div className="hd-ends">
            <span>Smaller</span>
            <span>Bigger</span>
          </div>
        </div>
      </div>
      <Slider label="Strength" value={Math.round(strength * 100)} min={10} max={100} step={5} onChange={(v) => setStrength(v / 100)} />
      <Seg label="Height" value={height} options={HEIGHTS} onPick={setHeight} />
      <Seg label="View" value={drawnView(view, n)} options={n > 1 ? PARTY_VIEWS : VIEWS} onPick={setView} />
    </>
  )
}

const INTERVALS: readonly Opt<(typeof CONTOUR_INTERVALS)[number]>[] = CONTOUR_INTERVALS.map((m) => [m, `${m} m`] as const)

/** The contour lines' interval, the lines redrawing as it is picked; the lines come on so the pick can be seen. */
function ContourRows() {
  const m = useAppStore((s) => s.contourInterval)
  const setInterval = useAppStore((s) => s.setContourInterval)
  useEffect(() => {
    useAppStore.getState().setLayer('contours', true)
  }, [])
  return <Seg label="Lines every" value={m} options={INTERVALS} onPick={setInterval} />
}

function HeardRows({ go }: RowsProps) {
  const entries = useHuntLog((s) => s.entries)
  const locating = useGpsStore((s) => s.locating)
  const fix = useGpsStore((s) => s.fix)
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
      {/* the log opens on what was heard */}
      <Act onTap={go(() => openHuntLog('heard'))}>
        Hunt log <span className="dim">›</span>
      </Act>
    </>
  )
}

function WindCheckRows({ go }: RowsProps) {
  const checks = useWindChecks((s) => s.checks)
  const last = checks[checks.length - 1]
  return (
    <>
      <Act disabled={!last} onTap={() => last && useWindChecks.getState().remove(last.id)}>
        Undo last check
      </Act>
      {/* the log opens on the wind checks */}
      <Act onTap={go(() => openHuntLog('wind'))}>
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
      <Seg label="From" value={fromKind} options={[['you', 'You'], ['camp', HOME_NAME]] as const} off={you ? [] : ['you']} onPick={(v) => setFrom(v === 'you' && you ? you : campEnd())} />
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

/** A layer's strength where it has one. No way to the Layers sheet: that is the view pill's (2026-10-03). */
function LayerRows({ id }: { id: HotId }) {
  const key = LAYER_OPACITY[id]
  const op = useAppStore((s) => (key ? s.opacity[key] : 1))
  const setOpacity = useAppStore((s) => s.setOpacity)
  if (!key) return null
  return <Slider label="Strength" value={Math.round(op * 100)} min={10} max={100} step={5} onChange={(v) => setOpacity(key, v / 100)} />
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
      return <WindFlowRows />
    case 'scent':
      return <ScentRows />
    case 'contours':
      return <ContourRows />
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
      return <LayerRows id={id} />
    case 'pin':
      return <PinRows go={go} />
    default:
      return null
  }
}

/** The drawer beside a held hot button, headed by the button's full name
 *  and icon: someone learning the buttons can tell what this one is. `within`
 *  is the element a tap must land outside of to close it (the button and the drawer). */
export default function HotDrawer({ id, within, onClose }: { id: HotId; within: RefObject<HTMLElement | null>; onClose: () => void }): JSX.Element {
  useTapOff(within, true, onClose)
  const go = (f: () => void) => () => {
    onClose()
    f()
  }
  const d = HOT_DEFS[id]
  return (
    <div className="hotdrawer" role="menu" aria-label={d.name}>
      <div className="hd-title">
        <d.Icon size={16} />
        {d.name}
      </div>
      {rows(id, go)}
    </div>
  )
}
