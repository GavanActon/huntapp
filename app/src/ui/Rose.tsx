import type { ReactNode } from 'react'
import { compass } from '../weather/openMeteo'

/**
 * Eight arrows round a middle, for picking a way: the powder's in a wind
 * check, a moose's in HeardCard. It turns by `turn` (the phone's compass
 * heading) so the top arrow points where the phone does, and the arrow to
 * tap is the one pointing at the thing itself, not a compass point to work
 * out in the bush. A picked bearing lights its nearest arrow.
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

export default function Rose({
  turn,
  value,
  lit,
  inward = false,
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
  onPick: (deg: number) => void
  label: (b: number) => string
  children: ReactNode
}) {
  const on = value == null ? null : sector(value)
  const isOn = (b: number) => on === b || (lit?.some((d) => sector(d) === b) ?? false)
  return (
    <div className="gc-rose">
      {ROSE.map((b) => (
        <button
          key={b}
          className={`gc-dir${isOn(b) ? ' gc-on' : ''}${b === 0 ? ' gc-north' : ''}`}
          style={{ ['--a' as string]: `${b - turn}deg` }}
          onClick={() => onPick(b)}
          aria-label={label(b)}
          aria-pressed={isOn(b)}
        >
          <Arrow toward={b - turn + (inward ? 180 : 0)} size={16} />
          <span>{compass(b)}</span>
        </button>
      ))}
      <div className="gc-rose-mid">{children}</div>
    </div>
  )
}
