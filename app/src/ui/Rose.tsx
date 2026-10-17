import { useRef, type ReactNode } from 'react'
import { compass } from '../weather/openMeteo'

/**
 * Eight arrows round a middle, for picking a way: the powder's in a wind
 * check, a moose's in HeardCard. It turns by `turn`: the map's bearing in
 * the wind check, so it reads against the map as turned (the live compass
 * heading moved the arrows under a finger and taps went missing,
 * 2026-10-08); the phone's heading where a card still passes that. A picked bearing lights its nearest arrow.
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
  onPick,
  label,
  children,
}: {
  turn: number
  value: number | null
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
  const isOn = (b: number) => on === b
  return (
    <div className="gc-rose">
      {ROSE.map((b) => (
        <button
          key={b}
          className={`gc-dir${isOn(b) ? ' gc-on' : ''}${b === 0 ? ' gc-north' : ''}`}
          style={{ ['--a' as string]: `${b - t}deg` }}
          // picked on the press: nothing that happens between a press and
          // its release (a focus scroll, a style, a re-render) can lose it
          // (Gavan, 2026-10-08, on a PC: "icon moves, nothing happens");
          // the click still picks, for a keyboard, and picking twice is
          // the same pick
          onPointerDown={(e) => {
            if (e.button === 0 || e.pointerType !== 'mouse') {
              e.preventDefault()
              onPick(b)
            }
          }}
          onClick={() => onPick(b)}
          aria-label={label(b)}
          aria-pressed={isOn(b)}
        >
          <Arrow toward={b - t} size={16} />
          <span>{compass(b)}</span>
        </button>
      ))}
      <div className="gc-rose-mid">{children}</div>
    </div>
  )
}
