import { useRef, type ReactNode } from 'react'
import { compass } from '../weather/openMeteo'

/**
 * Eight arrows round a middle, for picking a way: the powder's in a wind
 * check, a moose's in HeardCard. It turns by `turn` (the phone's compass
 * heading) so the top arrow points where the phone does, and the arrow to
 * tap is the one pointing at the thing itself, not a compass point to work
 * out in the bush. A picked bearing lights its nearest arrow, and a second
 * one (a wind that swings) lights too, with the shorter arc between them
 * faintly shaded.
 *
 * The turn is unwrapped as it comes in — each reading moves the ring the
 * shorter way round — so passing north is two degrees on, not 358 back the
 * other way, and the ease only ever has a few degrees to cover.
 */

const ROSE = [0, 45, 90, 135, 180, 225, 270, 315]

export function Arrow({ toward, size = 18 }: { toward: number; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" style={{ transform: `rotate(${toward}deg)` }} aria-hidden>
      <path d="M7 1.5 L10 10 L7 8 L4 10 Z" fill="currentColor" />
    </svg>
  )
}

export const sector = (deg: number) => (Math.round((((deg % 360) + 360) % 360) / 45) * 45) % 360

/** The shorter way round from a to b, signed. */
const delta = (a: number, b: number) => (((b - a + 540) % 360) - 180)

export default function Rose({
  turn,
  value,
  lit,
  inward = false,
  swing = null,
  onPick,
  label,
  children,
}: {
  turn: number
  value: number | null
  /** several arrows lit at once (a stand's good winds), besides `value` */
  lit?: number[]
  /** arrows point in at the middle: a wind blowing FROM each point, not a way to go */
  inward?: boolean
  /** the other end of a swinging wind, lit with the first */
  swing?: number | null
  onPick: (deg: number) => void
  label: (b: number) => string
  children: ReactNode
}) {
  const un = useRef(turn)
  const seen = useRef(turn)
  if (turn !== seen.current) {
    un.current += delta(seen.current, turn)
    seen.current = turn
  }
  const t = un.current
  const on = value == null ? null : sector(value)
  const swung = swing == null ? null : sector(swing)
  const isOn = (b: number) => on === b || swung === b || (lit?.some((d) => sector(d) === b) ?? false)
  const arc = on == null || swung == null || swung === on ? null : { from: (delta(on, swung) >= 0 ? on : swung) - t, sweep: Math.abs(delta(on, swung)) }
  return (
    <div className="gc-rose">
      {arc && <div className="gc-arc" style={{ ['--from' as string]: `${arc.from}deg`, ['--sweep' as string]: `${arc.sweep}deg` }} aria-hidden />}
      {ROSE.map((b) => (
        <button
          key={b}
          className={`gc-dir${isOn(b) ? ' gc-on' : ''}${b === 0 ? ' gc-north' : ''}`}
          style={{ ['--a' as string]: `${b - t}deg` }}
          onClick={() => onPick(b)}
          aria-label={label(b)}
          aria-pressed={isOn(b)}
        >
          <Arrow toward={b - t + (inward ? 180 : 0)} size={16} />
          <span>{compass(b)}</span>
        </button>
      ))}
      <div className="gc-rose-mid">{children}</div>
    </div>
  )
}
