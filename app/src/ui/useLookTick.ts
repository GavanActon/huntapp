import { useEffect, useState } from 'react'
import { useHuntLog } from '../log/huntLog'

/** Re-render every half minute and on each look, for "min ago" and a sound going stale. */
export function useLookTick(): void {
  const [, tick] = useState(0)
  useEffect(() => {
    const bump = () => tick((x) => x + 1)
    const t = window.setInterval(bump, 30_000)
    const onLook = () => document.visibilityState === 'visible' && bump()
    document.addEventListener('visibilitychange', onLook)
    return () => {
      window.clearInterval(t)
      document.removeEventListener('visibilitychange', onLook)
    }
  }, [])
  useHuntLog((s) => s.entries)
}
