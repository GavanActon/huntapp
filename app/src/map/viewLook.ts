import type { Map as MlMap } from 'maplibre-gl'
import { ACTIVE_AREA } from '../areas'
import { devlog } from '../devlog'
import { useAppStore } from '../state/appStore'
import { reliefRamp, reliefShadePaint, standIn } from './mapStyle'
import { demTileAt, setViewLit, STREAM_PICTURES, terrainDepth, viewLit } from './streamPictures'

/**
 * The view's own look, with the pictures streamed (a trial, docs/SD-FAST.md).
 * The elevation colours were stretched over the area's whole span and the
 * shade tuned on Ontario's bush, once, for the area. Streamed, the map runs
 * anywhere: a valley past the box went all one green, and on Blanchard
 * River's open alpine the shade's lit side whitened whole slopes (Gavan,
 * 2026-10-13: "can we be smart about it? based on height?", then "normalized
 * by the view"). So once the map settles, the heights under the view are
 * read (the streamed tiles, from the cache they are drawn from) and:
 *
 * - the colours run from the view's own low ground to its high (2nd to 98th
 *   percentile, snapped to round metres), changed only when the view's span
 *   has moved by more than a sixth, so a small pan never repaints the map.
 *   On flat ground the span is 100 m at least, from the low ground up:
 *   stretched over the 10 m of a z15 view at Pickle Lake the whole map went
 *   the ramp's middle tan, where the area's colours had it green;
 * - the lit side of the shade over the photo fades as the view's share
 *   above the area's treeline grows (none: as tuned; 60% or more: 15%).
 *
 * The contour labels carry the heights, since a colour no longer means one.
 */
const TREELINE = ACTIVE_AREA.profile?.treeline?.m ?? null
const MIN_SPAN = 100
const SETTLE_MS = 400
const MOVE_SHARE = 1 / 6
const MAX_TILES = 6

let span: [number, number] | null = null
let timer = 0
let run = 0

const tileX = (lon: number, n: number) => Math.floor(((lon + 180) / 360) * n)
const tileY = (lat: number, n: number) => {
  const r = (lat * Math.PI) / 180
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n)
}
const lonOf = (x: number, n: number) => (x / n) * 360 - 180
const latOf = (y: number, n: number) => (180 / Math.PI) * Math.atan(Math.sinh(Math.PI - (2 * Math.PI * y) / n))

/** The heights under the view, sorted: about 64 × 64 a tile, a zoom above the view's. */
async function heights(map: MlMap): Promise<Float32Array | null> {
  const b = map.getBounds()
  const [w, e, s, nth] = [b.getWest(), b.getEast(), b.getSouth(), b.getNorth()]
  let z = Math.max(4, Math.min(terrainDepth(), Math.floor(map.getZoom()) - 1))
  let n = 2 ** z
  for (; z > 4; z--) {
    n = 2 ** z
    if ((tileX(e, n) - tileX(w, n) + 1) * (tileY(s, n) - tileY(nth, n) + 1) <= MAX_TILES) break
  }
  n = 2 ** z
  const asks: Promise<{ t: { width: number; height: number; data: Float32Array }; x: number; y: number } | null>[] = []
  for (let x = tileX(w, n); x <= tileX(e, n); x++)
    for (let y = tileY(nth, n); y <= tileY(s, n); y++)
      asks.push(
        demTileAt(z, x, y)
          .then((t) => ({ t, x, y }))
          .catch(() => null),
      )
  const out: number[] = []
  for (const r of await Promise.all(asks)) {
    if (!r) continue
    const { t, x, y } = r
    const step = Math.max(1, Math.floor(t.width / 64))
    for (let py = step >> 1; py < t.height; py += step) {
      const lat = latOf(y + py / t.height, n)
      if (lat > nth || lat < s) continue
      for (let px = step >> 1; px < t.width; px += step) {
        const lon = lonOf(x + px / t.width, n)
        if (lon < w || lon > e) continue
        const v = t.data[py * t.width + px]
        if (Number.isFinite(v) && v > -500) out.push(v)
      }
    }
  }
  return out.length >= 50 ? Float32Array.from(out).sort() : null
}

async function settle(map: MlMap): Promise<void> {
  const mine = ++run
  const h = await heights(map)
  if (mine !== run || !h) return
  const at = (p: number) => h[Math.min(h.length - 1, Math.floor(p * (h.length - 1)))]
  let lo = at(0.02)
  let hi = at(0.98)
  if (hi - lo < MIN_SPAN) hi = lo + MIN_SPAN
  const step = hi - lo < 150 ? 5 : hi - lo < 600 ? 10 : 50
  lo = Math.floor(lo / step) * step
  hi = Math.ceil(hi / step) * step
  const moved = !span || Math.max(Math.abs(lo - span[0]), Math.abs(hi - span[1])) > MOVE_SHARE * (span[1] - span[0])
  let alpine = 0
  if (TREELINE != null) {
    let above = 0
    for (const v of h) if (v > TREELINE) above++
    alpine = above / h.length
  }
  const lit = 1 - 0.85 * Math.min(1, Math.max(0, (alpine - 0.1) / 0.5))
  if (moved) {
    span = [lo, hi]
    if (map.getLayer('relief-colour')) map.setPaintProperty('relief-colour', 'color-relief-color', reliefRamp(span))
  }
  if (Math.abs(lit - viewLit()) > 0.05) {
    setViewLit(lit)
    const s = useAppStore.getState()
    const { layers, opacity } = standIn(s.layers, s.opacity)
    if (map.getLayer('relief-shade')) for (const [k, v] of Object.entries(reliefShadePaint(layers, opacity))) map.setPaintProperty('relief-shade', k, v)
  }
  devlog('map', `view look · ${span?.[0]}–${span?.[1]} m${moved ? ' (new)' : ''} · alpine ${Math.round(alpine * 100)}% · lit ${viewLit().toFixed(2)}`)
  if (import.meta.env.DEV || import.meta.env.VITE_DEV_SITE) (window as unknown as { __viewLook?: unknown }).__viewLook = { span, alpine, lit: viewLit() }
}

/** From the map's first load: on every settle, once the view has stopped. */
export function initViewLook(map: MlMap): void {
  if (!STREAM_PICTURES) return
  const later = () => {
    window.clearTimeout(timer)
    timer = window.setTimeout(() => void settle(map), SETTLE_MS)
  }
  map.on('moveend', later)
  later()
}
