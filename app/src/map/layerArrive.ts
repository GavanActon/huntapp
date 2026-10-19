import type { Map as MlMap } from 'maplibre-gl'
import { trackTask } from '../offline/loadProgress'
import { onEachMap } from './mapController'

/**
 * A layer that comes on, a switch or its file arriving (a streamed area's HD, the wind, a view's
 * layers), blends in rather than popping: its opacity runs up from nothing over FADE_MS. And while its
 * tiles load the weather strip's hairline runs (loadProgress trackTask), the one sign of loading
 * (Gavan, 2026-10-19: "a better job of both blending in new layers as they arrive, but also keep the
 * loading minimal - I just want a small line moving across the bottom of the weather strip loading
 * each layer"). A layer in from its own file on the phone is in before the line's 300 ms: no line.
 *
 * Caught at the moment a layer comes on: the map's own setLayoutProperty (visibility) and addLayer
 * are wrapped, so every caller is covered. The opacity goes to nothing in a microtask, after the
 * caller has set the layer up (the Layers sheet sets its strength after its visibility) and before the
 * next frame is drawn, then runs up from the frame after. Read off the style after a draw instead
 * (styledata, until 2026-10-19), the layer was drawn whole first and then dipped: "with range, I see
 * it load, then it unloads and fades in". The map's first draw is not faded; nor is a layer whose
 * opacity is an expression (a fade would end on a flat number): those come in as before.
 */

const FADE_MS = 450
/** the longest the line waits on one layer's tiles */
const TRACK_MAX_MS = 20_000

/** Each layer type's opacity paint properties. */
const OPACITY: Record<string, string[]> = {
  raster: ['raster-opacity'],
  fill: ['fill-opacity'],
  line: ['line-opacity'],
  symbol: ['text-opacity', 'icon-opacity'],
  circle: ['circle-opacity'],
  heatmap: ['heatmap-opacity'],
  'color-relief': ['color-relief-opacity'],
  'fill-extrusion': ['fill-extrusion-opacity'],
}

/** Fade these in: after the caller is through (a microtask), before the next frame. */
function fadeSoon(map: MlMap, ids: string[]) {
  queueMicrotask(() => fadeIn(map, ids.filter((id) => map.getLayer(id) && map.getLayoutProperty(id, 'visibility') !== 'none')))
}

function fadeIn(map: MlMap, ids: string[]) {
  const ends: [string, string, number][] = []
  for (const id of ids) {
    const l = map.getLayer(id)
    for (const prop of OPACITY[l?.type ?? ''] ?? []) {
      const target = map.getPaintProperty(id, prop)
      if (target != null && typeof target !== 'number') continue
      map.setPaintProperty(id, `${prop}-transition`, { duration: 0, delay: 0 })
      map.setPaintProperty(id, prop, 0)
      ends.push([id, prop, target ?? 1])
    }
  }
  if (!ends.length) return
  // the zero drawn first, then the run up to where it was
  requestAnimationFrame(() => {
    for (const [id, prop, to] of ends) {
      if (!map.getLayer(id)) continue
      map.setPaintProperty(id, `${prop}-transition`, { duration: FADE_MS, delay: 0 })
      map.setPaintProperty(id, prop, to)
    }
  })
}

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

// once: a second listener (React's dev double start) would read the first one's zero as the layer's opacity
let wired = false

export function initLayerArrive(): void {
  if (wired) return
  wired = true
  onEachMap((map) => {
    // the first draw comes in as it always has
    let ready = false
    map.once('idle', () => (ready = true))
    const arrive = (ids: string[]) => {
      if (!ready || !ids.length) return
      fadeSoon(map, ids)
      const sources = new Set<string>()
      for (const id of ids) {
        const src = (map.getLayer(id) as { source?: string } | undefined)?.source
        if (src) sources.add(src)
      }
      for (const src of sources) void trackTask(`layer:${src}`, sourceLoaded(map, src))
    }
    const setLayout = map.setLayoutProperty.bind(map)
    map.setLayoutProperty = ((id: string, name: string, value: unknown, options?: object) => {
      const on = name === 'visibility' && value !== 'none' && !!map.getLayer(id) && map.getLayoutProperty(id, 'visibility') === 'none'
      const r = setLayout(id, name, value, options)
      if (on) arrive([id])
      return r
    }) as typeof map.setLayoutProperty
    const addLayer = map.addLayer.bind(map)
    map.addLayer = ((layer: Parameters<MlMap['addLayer']>[0], before?: string) => {
      const r = addLayer(layer, before)
      const id = (layer as { id?: string }).id
      if (id && map.getLayer(id) && map.getLayoutProperty(id, 'visibility') !== 'none') arrive([id])
      return r
    }) as typeof map.addLayer
  })
}
