import { useEffect, useState, type JSX } from 'react'
import { ACTIVE_AREA } from '../areas'
import { goLook, takeLookCame, useAreaLook } from '../areas/lookSwitch'
import { devlog } from '../devlog'
import { getMap } from '../map/mapController'
import { fmtBytes } from '../offline/downloads'
import { useMapsNudge } from '../offline/mapsNudge'
import { useAppStore } from '../state/appStore'
import './areas.css'

/** How long the streaming word stays up on arrival (the ⋯ menu's row and the strip's line stay after). */
const STREAMING_MS = 20_000

/**
 * The chips of looking at another area (areas/lookSwitch.ts). Before: the
 * view is in another area's box and going by itself would lose something,
 * so it is offered. After: the app came here by a look and the area's maps
 * are not on the phone, so it says it is streaming and offers the download
 * (Gavan, 2026-10-17: "If it's not downloaded. Say it's streaming. Suggest
 * downloading it"), as what is so, never as a fault.
 */
export default function AreaLook(): JSX.Element | null {
  const offer = useAreaLook((s) => s.offer)
  const [came] = useState(takeLookCame)
  const [up, setUp] = useState(came)
  const nudge = useMapsNudge()
  const openSheet = useAppStore((s) => s.openSheet)
  const streaming = up && nudge.show
  useEffect(() => {
    if (!up) return
    const t = window.setTimeout(() => setUp(false), STREAMING_MS)
    return () => window.clearTimeout(t)
  }, [up])
  useEffect(() => {
    if (streaming) devlog('area', `came by a look · streaming, ${nudge.files.length} files not saved${nudge.bytes ? ` (${fmtBytes(nudge.bytes)})` : ''}`)
    // once, when the word goes up
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming])

  if (offer) {
    const go = () => {
      const m = getMap()
      if (m) goLook(m, offer)
    }
    return (
      <span className="chip chip-ok chip-offer">
        <button onClick={go}>{offer.name} · Open</button>
        <button className="chip-x" aria-label="Not now" onClick={() => useAreaLook.setState({ offer: null, waved: offer.id })}>
          ×
        </button>
      </span>
    )
  }
  if (!streaming) return null
  return (
    <span className="chip chip-ok chip-offer">
      <button
        onClick={() => {
          setUp(false)
          openSheet({ kind: 'offline' })
        }}
      >
        Streaming {ACTIVE_AREA.name} · Download{nudge.bytes ? ` ${fmtBytes(nudge.bytes)}` : ''} ›
      </button>
      <button className="chip-x" aria-label="Not now" onClick={() => setUp(false)}>
        ×
      </button>
    </span>
  )
}
