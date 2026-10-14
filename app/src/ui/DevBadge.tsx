import type { JSX } from 'react'
import { STREAM_PICTURES } from '../map/streamPictures'

/**
 * The dev site (dev.hunt.groundwind.app, a build with VITE_DEV_SITE=1):
 * a badge that says so, which build it is, and whether the map's pictures
 * are streamed or baked, a tap switching between them (map/streamPictures.ts).
 */
export const DEV_SITE = !!import.meta.env.VITE_DEV_SITE

export default function DevBadge(): JSX.Element | null {
  if (!DEV_SITE) return null
  const flip = () => {
    const u = new URL(window.location.href)
    u.searchParams.set('pictures', STREAM_PICTURES ? 'baked' : 'stream')
    window.location.replace(u.toString())
  }
  return (
    <button
      type="button"
      onClick={flip}
      title="Switch the map's pictures between streamed and baked"
      style={{
        position: 'fixed',
        left: '50%',
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 6px)',
        transform: 'translateX(-50%)',
        zIndex: 30,
        font: '600 11px/1 system-ui, sans-serif',
        letterSpacing: '0.04em',
        color: '#16301f',
        background: 'rgba(210, 168, 92, 0.92)',
        border: 'none',
        borderRadius: 999,
        padding: '5px 10px',
        pointerEvents: 'auto',
      }}
    >
      DEV · {__BUILD__.sha} · {STREAM_PICTURES ? 'streamed' : 'baked'}
    </button>
  )
}
