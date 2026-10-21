import type { Map as MlMap } from 'maplibre-gl'

/**
 * Many screen points to the ground under them, on a 3D map, for one read of
 * the GPU. MapLibre answers `unproject` on terrain by reading one pixel of its
 * coords framebuffer back from the GPU, a stall each: the wind's fields asked
 * it hundreds of times at a 3D pan's end and held a phone's screen for over a
 * second, 1.2 s of 1.6 in `readPixels` (profiled 2026-10-21). This reads the
 * whole framebuffer once and decodes each point the way MapLibre's own
 * `Terrain.pointCoordinate` does (maplibre-gl 5.24). Its internals: if any is
 * missing (another MapLibre), there is no picker and the callers unproject.
 * Flat, there is none either: a flat unproject is arithmetic.
 */

export interface GroundPicker {
  /** The ground under css pixel (x, y), or null where there is none (the sky past the horizon). */
  at(x: number, y: number): { lng: number; lat: number } | null
}

interface TerrainInternals {
  painter: {
    context: { gl: WebGLRenderingContext; bindFramebuffer: { set: (fb: unknown) => void } }
    width: number
    height: number
    pixelRatio: number
    maybeDrawDepth?: (b: boolean) => void
    maybeDrawCoords?: () => void
  }
  getFramebuffer: (k: 'coords') => { framebuffer: unknown }
  coordsIndex: unknown[]
  _coordsTextureSize: number
  tileManager?: { getTileByID: (id: unknown) => { tileID: { canonical: { x: number; y: number; z: number }; wrap: number } } | undefined }
  sourceCache?: TerrainInternals['tileManager']
}

const lngOf = (x: number) => x * 360 - 180
const latOf = (y: number) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI

export function groundPicker(map: MlMap): GroundPicker | null {
  if (!map.getTerrain()) return null
  const t = (map as unknown as { terrain?: TerrainInternals }).terrain
  const tm = t?.tileManager ?? t?.sourceCache
  if (!t || !tm || !t.painter?.context?.gl || typeof t.getFramebuffer !== 'function' || !Array.isArray(t.coordsIndex) || !t._coordsTextureSize) return null
  try {
    const painter = t.painter
    painter.maybeDrawDepth?.(true)
    painter.maybeDrawCoords?.()
    const { gl, bindFramebuffer } = painter.context
    const dpr = devicePixelRatio
    const fbW = Math.round(painter.width / dpr)
    const fbH = Math.round(painter.height / dpr)
    const buf = new Uint8Array(fbW * fbH * 4)
    bindFramebuffer.set(t.getFramebuffer('coords').framebuffer)
    gl.readPixels(0, 0, fbW, fbH, gl.RGBA, gl.UNSIGNED_BYTE, buf)
    bindFramebuffer.set(null)
    const size = t._coordsTextureSize
    const scale = painter.pixelRatio / dpr
    return {
      at(x, y) {
        const px = Math.round(x * scale)
        const row = fbH - Math.round(y * scale) - 1
        if (px < 0 || px >= fbW || row < 0 || row >= fbH) return null
        const o = (row * fbW + px) * 4
        const tx = buf[o] + ((buf[o + 2] >> 4) << 8)
        const ty = buf[o + 1] + ((buf[o + 2] & 15) << 8)
        const id = t.coordsIndex[255 - buf[o + 3]]
        const tile = id ? tm.getTileByID(id) : undefined
        if (!tile) return null
        const c = tile.tileID.canonical
        const world = (1 << c.z) * size
        return { lng: lngOf((c.x * size + tx) / world + tile.tileID.wrap), lat: latOf((c.y * size + ty) / world) }
      },
    }
  } catch {
    return null
  }
}
