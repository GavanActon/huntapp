import type { Map as MlMap } from 'maplibre-gl'
import { trackTask } from '../offline/loadProgress'
import { onEachMap } from './mapController'

/**
 * Layers cross-fade: one that comes on (a switch, a view, its file arriving) runs up from nothing over
 * IN_MS, and one that goes off runs down to nothing over OUT_MS, starting OUT_DELAY_MS later so a new
 * base is in before the old one leaves and the ground never shows through, and only then is hidden. A
 * view changes in about a third of a second with no hard frame (Gavan, 2026-10-19: "changing a view
 * should smoothly transition from one to the other ... fast yet smooth"). Until then a layer going off
 * vanished in one frame while the new ones faded in over it: up to 20 layers at once leaving Scout,
 * 376 hard frames over the 42 switches between the seven views (scratchpad views2.py). While its tiles
 * load, a layer coming on also runs the weather strip's hairline (loadProgress trackTask), the one sign
 * of loading ("I just want a small line moving across the bottom of the weather strip loading each
 * layer"); one from the phone's own files is in before the line's 300 ms: no line.
 *
 * Caught at the switch: the map's own setLayoutProperty (visibility) and addLayer are wrapped, so every
 * caller is covered. The zero (in) and the run down (out) are set in a microtask, after the caller has
 * set the layer up (the Layers sheet writes its strength after its visibility) and before the next frame.
 * Read off the style after a draw (styledata, until 2026-10-19), a layer was drawn whole first and then
 * dipped: "with range, I see it load, then it unloads and fades in". A layer turned on and off again
 * before a frame (a view turns satellite-live on, the underlay rule off) just hides. A shade layer has no
 * opacity: its exaggeration fades. An opacity that is an expression (a bog's by its own data) cannot be
 * transitioned by the map, so it is stepped by hand, × k each frame. The map's first draw is not faded.
 *
 * Cost: for OUT_DELAY_MS + OUT_MS the old and the new layers draw together, a few hundred ms of one more
 * pass; their tiles are cached either way, so no memory; a timer and the props to put back per layer.
 */

const IN_MS = 300
const OUT_MS = 250
const OUT_DELAY_MS = 100
/** the longest the line waits on one layer's tiles */
const TRACK_MAX_MS = 20_000

/** Each layer type's fading paint properties: its opacities, or a shade's exaggeration. */
const FADE: Record<string, string[]> = {
  raster: ['raster-opacity'],
  fill: ['fill-opacity'],
  line: ['line-opacity'],
  symbol: ['text-opacity', 'icon-opacity'],
  circle: ['circle-opacity', 'circle-stroke-opacity'],
  heatmap: ['heatmap-opacity'],
  hillshade: ['hillshade-exaggeration'],
  'color-relief': ['color-relief-opacity'],
  'fill-extrusion': ['fill-extrusion-opacity'],
}

/** A paint value as set: a number, the default (undefined), or an expression. */
type Val = number | undefined | unknown[]
const isExpr = (v: Val): v is unknown[] => Array.isArray(v)

/** Resolves when the source's tiles are in: once it has started loading (a tile asked for within QUIET_MS
 *  of the layer coming on; none, and it was in already), when it says it is loaded; or it is gone, or after
 *  TRACK_MAX_MS. Asked at once, a source just switched on reads loaded: its tiles are asked for at the next draw. */
const QUIET_MS = 250
function sourceLoaded(map: MlMap, source: string): Promise<void> {
  return new Promise((resolve) => {
    let started = false
    const done = () => {
      map.off('dataloading', onLoading)
      map.off('sourcedata', onData)
      window.clearTimeout(t)
      window.clearTimeout(q)
      resolve()
    }
    const loadedNow = () => {
      try {
        return !map.getSource(source) || map.isSourceLoaded(source)
      } catch {
        return true
      }
    }
    const onLoading = (e: { sourceId?: string }) => {
      if (e.sourceId === source) started = true
    }
    const onData = (e: { sourceId?: string }) => {
      if (e.sourceId !== source) return
      started = true
      if (loadedNow()) done()
    }
    const t = window.setTimeout(done, TRACK_MAX_MS)
    const q = window.setTimeout(() => {
      if (!started || loadedNow()) done()
    }, QUIET_MS)
    map.on('dataloading', onLoading)
    map.on('sourcedata', onData)
  })
}

/** whether the map in use has a layer fading in or out (set per map below) */
let fading: () => boolean = () => false

/**
 * Run cb once the layers in flight have settled (next frame when none are), at most maxMs on: for heavy
 * work that would freeze a fade (Scout's heat painted in the frame the view switched; Gavan, 2026-10-19:
 * "just the scout layer that feels harsh in the transition").
 */
export function afterFades(cb: () => void, maxMs = 900): void {
  const t0 = performance.now()
  const tick = () => {
    if (!fading() || performance.now() - t0 > maxMs) cb()
    else requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

// once: a second listener (React's dev double start) would read the first one's zero as the layer's opacity
let wired = false

export function initLayerArrive(): void {
  if (wired) return
  wired = true
  onEachMap((map) => {
    // the first draw comes in as it always has
    let ready = false
    map.once('idle', () => (ready = true))
    const setLayout = map.setLayoutProperty.bind(map)

    const props = (id: string) => FADE[map.getLayer(id)?.type ?? ''] ?? []
    const valOf = (id: string, prop: string): Val => map.getPaintProperty(id, prop) as Val
    const setNow = (id: string, prop: string, v: Val) => {
      map.setPaintProperty(id, `${prop}-transition`, { duration: 0, delay: 0 })
      map.setPaintProperty(id, prop, v)
    }
    /** an expression's value times k (k 1: the expression itself) */
    const scaled = (e: unknown[], k: number): unknown[] => (k >= 0.999 ? e : ['*', e, k])
    /** Step an expression from k0 to k1 by hand, frame by frame, while live() holds; then done(). */
    const ramp = (id: string, prop: string, e: unknown[], k0: number, k1: number, ms: number, delay: number, live: () => boolean, done: () => void) => {
      // the clock starts at the first frame, not the call: a busy main thread (Scout's heat) would eat the run
      let t0 = 0
      const step = () => {
        if (!live() || !map.getLayer(id)) return done()
        if (!t0) t0 = performance.now() + delay
        const f = Math.min(1, Math.max(0, (performance.now() - t0) / ms))
        setNow(id, prop, scaled(e, k0 + (k1 - k0) * f))
        if (f < 1) requestAnimationFrame(step)
        else done()
      }
      requestAnimationFrame(step)
    }

    /** layers on their way out: the props to put back where the caller left them, ramps still running, due to hide */
    interface Leave {
      restore: [string, Val][]
      ramps: number
      due: boolean
      timer: number
    }
    const leaving = new Map<string, Leave>()
    /** come on this tick, their zero not yet set: gone again before a frame, they just hide */
    const arriving = new Set<string>()
    /** zeroed, the run up under way: their true values, should they leave first */
    const rising = new Map<string, [string, Val][]>()
    // a run up's last frames: IN_MS after its rise is let go of
    let risingUntil = 0
    fading = () => leaving.size > 0 || rising.size > 0 || arriving.size > 0 || performance.now() < risingUntil

    const fadeIn = (ids: string[]) => {
      const ends: [string, string, Val][] = []
      for (const id of ids) {
        const mine: [string, Val][] = []
        for (const prop of props(id)) {
          const v = valOf(id, prop)
          setNow(id, prop, isExpr(v) ? scaled(v, 0) : 0)
          ends.push([id, prop, v])
          mine.push([prop, v])
        }
        if (mine.length) rising.set(id, mine)
      }
      if (!ends.length) return
      let open = ends.length
      const finished = () => {
        if (--open > 0) return
        for (const [id] of ends) rising.delete(id)
        risingUntil = Math.max(risingUntil, performance.now() + IN_MS)
      }
      // the zero drawn first, then the run up to where it was
      requestAnimationFrame(() => {
        for (const [id, prop, to] of ends) {
          // left meanwhile: its leaving has the values
          if (!map.getLayer(id) || !rising.has(id)) {
            finished()
            continue
          }
          if (isExpr(to)) {
            ramp(id, prop, to, 0, 1, IN_MS, 0, () => rising.has(id), finished)
            continue
          }
          map.setPaintProperty(id, `${prop}-transition`, { duration: IN_MS, delay: 0 })
          map.setPaintProperty(id, prop, to)
          finished()
        }
      })
    }

    const arrive = (ids: string[]) => {
      if (!ready || !ids.length) return
      for (const id of ids) arriving.add(id)
      queueMicrotask(() => {
        const now = ids.filter((id) => arriving.delete(id) && map.getLayer(id) && map.getLayoutProperty(id, 'visibility') !== 'none' && !leaving.has(id))
        fadeIn(now)
      })
      const sources = new Set<string>()
      for (const id of ids) {
        const src = (map.getLayer(id) as { source?: string } | undefined)?.source
        if (src) sources.add(src)
      }
      for (const src of sources) void trackTask(`layer:${src}`, sourceLoaded(map, src))
    }

    /** Hidden once it is due, its hand ramps done, and a frame drawn at the end (a heavy frame, Scout's heat
     *  working out, would otherwise leave the last frame shown at a fifth and hide it from there). */
    const tryHide = (id: string, e: Leave) => {
      if (leaving.get(id) !== e || !e.due || e.ramps > 0) return
      let gone = false
      const hide = () => {
        if (gone || leaving.get(id) !== e) return
        gone = true
        leaving.delete(id)
        if (!map.getLayer(id)) return
        setLayout(id, 'visibility', 'none')
        for (const [p, v] of e.restore) setNow(id, p, v)
      }
      map.once('render', hide)
      map.triggerRepaint()
      window.setTimeout(hide, 500)
    }

    /** Run a layer down, then hide it. */
    const leave = (id: string) => {
      const e: Leave = { restore: [], ramps: 0, due: false, timer: 0 }
      leaving.set(id, e)
      // after the caller is through, so what it set is what comes back next time; caught mid-rise, the
      // values it was rising to (what is set now is the rise's zero)
      queueMicrotask(() => {
        if (leaving.get(id) !== e || !map.getLayer(id)) return
        const rose = rising.get(id)
        rising.delete(id)
        for (const p of props(id)) {
          const was = rose?.find((r) => r[0] === p)
          const v = was ? was[1] : valOf(id, p)
          e.restore.push([p, v])
          if (isExpr(v)) {
            e.ramps++
            ramp(id, p, v, 1, 0, OUT_MS, OUT_DELAY_MS, () => leaving.get(id) === e, () => {
              e.ramps--
              tryHide(id, e)
            })
            continue
          }
          map.setPaintProperty(id, `${p}-transition`, { duration: OUT_MS, delay: OUT_DELAY_MS })
          map.setPaintProperty(id, p, 0)
        }
      })
      // timed from the first frame drawn after the switch, when the map starts the run down: from the call,
      // a busy main thread (Scout's heat, up to 0.8 s) let the timer land before the run had begun
      map.once('render', () => {
        if (leaving.get(id) !== e) return
        e.timer = window.setTimeout(() => {
          e.due = true
          tryHide(id, e)
        }, OUT_DELAY_MS + OUT_MS + 20)
      })
      map.triggerRepaint()
    }

    /** Back on while still leaving: no hiding, and up again to where it was. */
    const stay = (id: string) => {
      const e = leaving.get(id)
      if (!e) return
      leaving.delete(id)
      window.clearTimeout(e.timer)
      for (const [p, v] of e.restore) {
        if (isExpr(v)) {
          setNow(id, p, v)
          continue
        }
        map.setPaintProperty(id, `${p}-transition`, { duration: IN_MS, delay: 0 })
        map.setPaintProperty(id, p, v)
      }
    }

    map.setLayoutProperty = ((id: string, name: string, value: unknown, options?: object) => {
      if (name !== 'visibility' || !map.getLayer(id)) return setLayout(id, name, value, options)
      const wasOn = map.getLayoutProperty(id, 'visibility') !== 'none'
      if (value === 'none') {
        // already going: nothing more to do
        if (leaving.has(id)) return map
        // on and off again before a frame (a view turns it on, the underlay rule off): it just hides
        if (arriving.delete(id)) return setLayout(id, name, value, options)
        if (ready && wasOn && props(id).length) {
          leave(id)
          return map
        }
        return setLayout(id, name, value, options)
      }
      if (leaving.has(id)) {
        stay(id)
        return map
      }
      const r = setLayout(id, name, value, options)
      if (!wasOn) arrive([id])
      return r
    }) as typeof map.setLayoutProperty

    const addLayer = map.addLayer.bind(map)
    map.addLayer = ((layer: Parameters<MlMap['addLayer']>[0], before?: string) => {
      const r = addLayer(layer, before)
      const id = (layer as { id?: string }).id
      if (id && map.getLayer(id) && map.getLayoutProperty(id, 'visibility') !== 'none') arrive([id])
      return r
    }) as typeof map.addLayer

    // a layer taken out while leaving or rising: nothing left to hide or raise
    const removeLayer = map.removeLayer.bind(map)
    map.removeLayer = ((id: string) => {
      const e = leaving.get(id)
      if (e) {
        window.clearTimeout(e.timer)
        leaving.delete(id)
      }
      rising.delete(id)
      arriving.delete(id)
      return removeLayer(id)
    }) as typeof map.removeLayer
  })
}
