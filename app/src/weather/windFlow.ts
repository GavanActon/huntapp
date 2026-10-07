import type { CanvasSource, Map as MlMap } from 'maplibre-gl'
import { getMap, onEachMap, onFirstIdle, withMap } from '../map/mapController'
import { devlog } from '../devlog'
import { useAppStore, type WindStyle } from '../state/appStore'
import { lodOf, meanLod, onQuality, qualityProfile, reportFrame } from './flowQuality'
import { centrePoint, compose, FrameAnchor, IDENTITY, invert, isIdentity, same, type Affine } from './frameAffine'
import { ensureWeatherGrid, onWeatherGrid, onWeatherTick, windGridInfo, windSampler } from './windGrid'
import { currentProfile, ensureProfile, onProfile } from './boundaryLayer'
import { groundSampler, loadMicro, microGrid, onMicro } from './micro/model'
import { useWindChecks } from './micro/windChecks'
import { currentTextStop } from '../ui/textScale'

/**
 * Wind made visible: particles advected by the forecast grid at the
 * app-wide planning time, drawn as fading streaks on a canvas over the map.
 * The boat app's ambient wind layer, without the briefing and the run
 * corridor: switched on in Layers, it runs for as long as it is on, with a
 * strength slider in Settings.
 *
 * The particle field is sampled in screen space and PINNED to the map
 * (frameAffine): every frame the pinned frame is carried to wherever the
 * camera went, trails and all, so a pan or a pinch slides the wind WITH the
 * map. When the camera settles the engine re-pins itself there and
 * resamples the wind under the new view. Stops for prefers-reduced-motion
 * and a hidden tab.
 */

const FIELD_STEP = 28 // css px between wind samples
const ALPHA_BANDS = 12
/**
 * The streaks' looks, picked under Look in the wind button's drawer.
 * - standard: as they have been.
 * - bold: the faintest at 40% where they were 22%, and the inks pushed
 *   apart. Light air all but vanished on busy imagery (Gavan, 2026-10-07:
 *   "our wind needs a higher contrast still"); he picked this from a
 *   comparison and kept it a choice for now. A dark edge under each streak
 *   was tried too: every frame's new stretch laid its edge over the last
 *   one's ink, and the streaks came out beaded, the map dimmed.
 * - contrast: white streaks over a wash coloured by the wind's speed, as
 *   windy.com draws it (paintWash); the Wind view's look.
 * floor and span: a streak's opacity from the slowest air to the fastest,
 * before the strength setting. ink: the inks' lightness, %, the light one
 * over dark ground, the brighter over mid, the dark over pale. white: one
 * white ink on every ground.
 */
interface Look {
  floor: number
  span: number
  ink: { light: number; bright: number; dark: number }
  white: boolean
  wash: boolean
}
const LOOKS: Record<WindStyle, Look> = {
  standard: { floor: 0.22, span: 0.4, ink: { light: 62, bright: 80, dark: 24 }, white: false, wash: false },
  bold: { floor: 0.4, span: 0.5, ink: { light: 74, bright: 88, dark: 16 }, white: false, wash: false },
  contrast: { floor: 0.35, span: 0.5, ink: { light: 100, bright: 100, dark: 100 }, white: true, wash: true },
}
const lookOf = (): Look => LOOKS[useAppStore.getState().flowTuning.windStyle] ?? LOOKS.standard

// ---------------------------------------------------------------- wash

/** The Contrast look's wash: the wind's speed under the view, coloured on
 *  windy.com's scale, drawn in the map above the imagery and the shade and
 *  under the contours, roads, labels and pins. It covers half a screen
 *  round the view, so a pan does not run off it before the streaks' field
 *  is redrawn, which redraws it. */
const WASH_SRC = 'wind-wash'
/** css px between the wash's samples (the map blends between them) */
const WASH_STEP = 32
const WASH_PAD = 0.5
/** its opacity at full strength (the Strength slider scales it) */
const WASH_ALPHA = 0.6
/** windy.com's wind colours, by speed in km/h (its scale runs in m/s: 0, 1, 3, 5 ...) */
const WASH_STOPS: readonly [number, readonly [number, number, number]][] = [
  [0, [98, 113, 183]],
  [3.6, [57, 97, 159]],
  [10.8, [74, 148, 169]],
  [18, [77, 141, 123]],
  [25.2, [83, 165, 83]],
  [32.4, [53, 159, 53]],
  [39.6, [167, 157, 81]],
  [46.8, [159, 127, 58]],
  [54, [161, 108, 92]],
  [61.2, [129, 58, 78]],
  [68.4, [175, 80, 136]],
  [75.6, [117, 74, 147]],
]

function washRgb(kmh: number, d: Uint8ClampedArray, o: number) {
  let k = 1
  while (k < WASH_STOPS.length - 1 && WASH_STOPS[k][0] < kmh) k++
  const [s0, c0] = WASH_STOPS[k - 1]
  const [s1, c1] = WASH_STOPS[k]
  const t = Math.min(1, Math.max(0, (kmh - s0) / (s1 - s0)))
  d[o] = c0[0] + (c1[0] - c0[0]) * t
  d[o + 1] = c0[1] + (c1[1] - c0[1]) * t
  d[o + 2] = c0[2] + (c1[2] - c0[2]) * t
  d[o + 3] = 255
}

let washCanvas: HTMLCanvasElement | null = null

function washOpacity(): number {
  return WASH_ALPHA * useAppStore.getState().windFlowOpacity
}

/** Paint the wash for the view as it is now, at the air of `atMs`: the
 *  ground model's head-height wind, or the forecast's, as the streaks are. */
function paintWash(map: MlMap, atMs: number) {
  const el = map.getContainer()
  const x0 = -el.clientWidth * WASH_PAD
  const y0 = -el.clientHeight * WASH_PAD
  const cols = Math.ceil((el.clientWidth * (1 + 2 * WASH_PAD)) / WASH_STEP)
  const rows = Math.ceil((el.clientHeight * (1 + 2 * WASH_PAD)) / WASH_STEP)
  const ground = useAppStore.getState().windLevel === 'ground' && microGrid() ? groundSampler(atMs) : null
  const wind = ground ? null : windSampler(atMs)
  if (!ground && !wind) return removeWash(map)
  const c = (washCanvas ??= document.createElement('canvas'))
  if (c.width !== cols || c.height !== rows) {
    c.width = cols
    c.height = rows
  }
  const g = c.getContext('2d', { willReadFrequently: true })
  if (!g) return
  const img = g.createImageData(cols, rows)
  const out = new Float32Array(4)
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) {
      const ll = map.unproject([x0 + (k + 0.5) * WASH_STEP, y0 + (r + 0.5) * WASH_STEP])
      let kmh = NaN
      if (ground) {
        if (ground(ll.lng, ll.lat, out)) kmh = Math.hypot(out[0], out[1]) * 3.6
      } else if (wind?.(ll.lng, ll.lat, out)) kmh = out[0]
      if (Number.isFinite(kmh)) washRgb(kmh, img.data, (r * cols + k) * 4)
    }
  }
  g.putImageData(img, 0, 0)
  const corner = (x: number, y: number): [number, number] => {
    const p = map.unproject([x, y])
    return [p.lng, p.lat]
  }
  const x1 = x0 + cols * WASH_STEP
  const y1 = y0 + rows * WASH_STEP
  const coordinates: [[number, number], [number, number], [number, number], [number, number]] = [corner(x0, y0), corner(x1, y0), corner(x1, y1), corner(x0, y1)]
  const src = map.getSource(WASH_SRC) as (CanvasSource & { play?: () => void; pause?: () => void }) | undefined
  if (!src) {
    map.addSource(WASH_SRC, { type: 'canvas', canvas: c, animate: false, coordinates })
    // over the imagery and the shade, under the first line, label or dot
    const before = map.getStyle().layers.find((l) => l.type === 'line' || l.type === 'symbol' || l.type === 'circle')?.id
    map.addLayer({ id: WASH_SRC, type: 'raster', source: WASH_SRC, paint: { 'raster-opacity': washOpacity(), 'raster-resampling': 'linear', 'raster-fade-duration': 0 } }, before)
    return
  }
  src.setCoordinates(coordinates)
  map.setPaintProperty(WASH_SRC, 'raster-opacity', washOpacity())
  // a canvas source that does not animate needs a nudge to read it again
  src.play?.()
  requestAnimationFrame(() => src.pause?.())
}

function removeWash(map: MlMap) {
  try {
    if (map.getLayer(WASH_SRC)) map.removeLayer(WASH_SRC)
    if (map.getSource(WASH_SRC)) map.removeSource(WASH_SRC)
  } catch {
    /* the style is going (a lost context, the map removed): the wash goes with it */
  }
}

/** The streaks fade out below zoom 15: in close the eddies and the slots
 *  read; far out the sheet of them only hides the map. */
function zoomFade(z: number): number {
  return Math.min(1, Math.max(0.3, (z - 13) / 2))
}

/** Streak width by the size setting, css px; auto follows the text size (Settings). */
const STREAK_PX = { standard: 1.2, large: 2, larger: 2.8 } as const
let streakPx: number = STREAK_PX.standard
function sizeStreaks() {
  const s = useAppStore.getState().flowTuning.windSize
  // the phone's text size is read off the page: worked out when a setting changes, not every frame
  streakPx = STREAK_PX[s === 'auto' || !s ? currentTextStop() : s]
}

interface FieldGrid {
  step: number
  cols: number
  rows: number
  vx: Float32Array // css px/s
  vy: Float32Array
  live: boolean
  /** the map as drawn under each cell, 0 black to 1 white; null until the next render fills it */
  lum: Float32Array | null
  /** lum averaged over its neighbours (INK_BLUR): what picks a streak's ink; null with it */
  inkLum: Float32Array | null
  /** how hard the eddies turn in each cell, css px/s; 0 where the air runs straight */
  swirl: Float32Array | null
}

// ---------------------------------------------------------------- swirl

/**
 * Where the ground model says the air swirls (a tree-line eddy, a small
 * opening, a slot across the wind, the tumbling lee of a hill or ridge) the mean alone draws a slow straight
 * drift: the opposite of what is going on. So those cells get an eddy field
 * on top of the mean, and settled or calm air a gentler one (scent hangs
 * and spreads every way). The spread alone is not the cue: at head height
 * under a light gusty wind it is wide nearly everywhere, and the whole map
 * would turn. The eddies are curl noise (the rotated gradient of a smooth noise
 * potential, so they turn without piling up anywhere), a fixed size on the
 * screen, cross-faded between two slices every SWIRL_PERIOD ms so they turn
 * over. An idiom for "it swirls here", not a map of where the rotor sits.
 */
/** the eddies in settled or calm air, as a share of a swirl cell's */
const SWIRL_CALM = 0.6
/** the eddy's wavelength on the screen, css px */
const SWIRL_SCALE = 56
/** the swirl grid's step, css px (finer than the wind's, so an eddy has a few nodes across) */
const SWIRL_STEP = 14
const SWIRL_PERIOD = 4000
/** the slowest swirl, in near calm, css px/s; faster air eddies faster */
const SWIRL_FLOOR = 14

/** How far the eddy strength is averaged, in cells: the model marks a cell
 *  as swirling or not, and taken as it was the eddies stopped dead at a
 *  cell's edge, drawing straight lines and boxes across open water off a
 *  treed shore (Gavan, 2026-10-05, Sault). Averaged and read between cells,
 *  they die away over a couple of cells instead. */
const SWIRL_BLUR = 2
/** The eddy strength for a cell: the sampler's swirl mark (1 swirls, 0.5 settled, 0 straight) and the mean's speed. */
function swirlAmp(mark: number, pxps: number): number {
  const k = mark >= 1 ? 1 : mark > 0 ? SWIRL_CALM : 0
  return k * (0.9 * pxps + SWIRL_FLOOR)
}

// 2D gradient noise (Perlin's lattice, a fixed permutation): smooth, zero-mean, about ±0.7
const PERM = new Uint8Array(512)
{
  let s = 0x2f6e2b1
  const p = Array.from({ length: 256 }, (_, i) => i)
  for (let i = 255; i > 0; i--) {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    const j = s % (i + 1)
    const x = p[i]
    p[i] = p[j]
    p[j] = x
  }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255]
}
const GRAD = [1, 1, -1, 1, 1, -1, -1, -1, 1, 0, -1, 0, 0, 1, 0, -1]
const fade = (u: number) => u * u * u * (u * (u * 6 - 15) + 10)
function noise2(x: number, y: number): number {
  const X = Math.floor(x)
  const Y = Math.floor(y)
  const fx = x - X
  const fy = y - Y
  const xi = X & 255
  const yi = Y & 255
  const g = (h: number, dx: number, dy: number) => {
    const k = (h & 7) * 2
    return GRAD[k] * dx + GRAD[k + 1] * dy
  }
  const a = PERM[xi] + yi
  const b = PERM[xi + 1] + yi
  const u = fade(fx)
  const v = fade(fy)
  const n00 = g(PERM[a], fx, fy)
  const n10 = g(PERM[b], fx - 1, fy)
  const n01 = g(PERM[a + 1], fx, fy - 1)
  const n11 = g(PERM[b + 1], fx - 1, fy - 1)
  return (n00 + u * (n10 - n00)) * (1 - v) + (n01 + u * (n11 - n01)) * v
}

interface SwirlGrid {
  cols: number
  rows: number
  /** two slices of the eddy field, unit RMS, each (cols × rows) × (x, y) */
  ux0: Float32Array
  uy0: Float32Array
  ux1: Float32Array
  uy1: Float32Array
  t0: number
  seed: number
}

/** One slice: the curl of the noise potential on the grid, normalised to unit RMS. */
function swirlSlice(g: SwirlGrid, seed: number, ux: Float32Array, uy: Float32Array) {
  const n = g.cols * g.rows
  const psi = new Float32Array(n)
  // each slice looks at its own patch of the noise, so a new one is unrelated to the last
  const ox = (seed * 977) % 4096
  const oy = (seed * 1409) % 4096
  for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) psi[r * g.cols + c] = noise2((c * SWIRL_STEP + ox) / SWIRL_SCALE, (r * SWIRL_STEP + oy) / SWIRL_SCALE)
  let ss = 0
  for (let r = 0; r < g.rows; r++) {
    for (let c = 0; c < g.cols; c++) {
      const i = r * g.cols + c
      const l = psi[r * g.cols + Math.max(0, c - 1)]
      const rt = psi[r * g.cols + Math.min(g.cols - 1, c + 1)]
      const up = psi[Math.max(0, r - 1) * g.cols + c]
      const dn = psi[Math.min(g.rows - 1, r + 1) * g.cols + c]
      // v = (dpsi/dy, -dpsi/dx): along the potential's contours
      ux[i] = dn - up
      uy[i] = -(rt - l)
      ss += ux[i] * ux[i] + uy[i] * uy[i]
    }
  }
  const rms = Math.sqrt(ss / n) || 1
  for (let i = 0; i < n; i++) {
    ux[i] /= rms
    uy[i] /= rms
  }
}

function makeSwirl(w: number, h: number, now: number): SwirlGrid {
  const cols = Math.ceil(w / SWIRL_STEP) + 2
  const rows = Math.ceil(h / SWIRL_STEP) + 2
  const n = cols * rows
  const g: SwirlGrid = { cols, rows, ux0: new Float32Array(n), uy0: new Float32Array(n), ux1: new Float32Array(n), uy1: new Float32Array(n), t0: now, seed: (now / 1000) | 0 }
  swirlSlice(g, g.seed, g.ux0, g.uy0)
  swirlSlice(g, g.seed + 1, g.ux1, g.uy1)
  return g
}

/** Roll the slices on when the period is up: the second becomes the first, a fresh one comes in. */
function rollSwirl(g: SwirlGrid, now: number) {
  // back from a long sleep: one roll, not one per period missed
  if (now - g.t0 >= 2 * SWIRL_PERIOD) g.t0 = now - ((now - g.t0) % SWIRL_PERIOD) - SWIRL_PERIOD
  while (now - g.t0 >= SWIRL_PERIOD) {
    g.ux0.set(g.ux1)
    g.uy0.set(g.uy1)
    g.seed++
    swirlSlice(g, g.seed + 1, g.ux1, g.uy1)
    g.t0 += SWIRL_PERIOD
  }
}

/** The eddy at a point, both slices cross-faded by the phase, into out[0..1]. */
function sampleSwirl(g: SwirlGrid, x: number, y: number, phase: number, out: Float32Array): void {
  const fx = Math.min(g.cols - 1.001, Math.max(0, x / SWIRL_STEP))
  const fy = Math.min(g.rows - 1.001, Math.max(0, y / SWIRL_STEP))
  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const tx = fx - x0
  const ty = fy - y0
  const i = y0 * g.cols + x0
  const bi = (a: Float32Array) => (a[i] * (1 - tx) + a[i + 1] * tx) * (1 - ty) + (a[i + g.cols] * (1 - tx) + a[i + g.cols + 1] * tx) * ty
  // a smooth cross-fade; the two slices are unrelated, so the mix dips a
  // little in the middle, which reads as the eddies breathing
  const m = phase * phase * (3 - 2 * phase)
  out[0] = bi(g.ux0) * (1 - m) + bi(g.ux1) * m
  out[1] = bi(g.uy0) * (1 - m) + bi(g.uy1) * m
}

/** Streak tones: light over the dark imagery, brighter still over a mid base
 *  (a lake in the elevation colours), dark ink over a pale one (the grey
 *  LiDAR shade, the topo sheet, the relief's land). */
const TONES = 3
const TONE_LIGHT = 0
const TONE_BRIGHT = 1
const TONE_DARK = 2
const toneOf = (lum: number) => (lum < 0.3 ? TONE_LIGHT : lum < 0.45 ? TONE_BRIGHT : TONE_DARK)
/**
 * A streak's ink is picked from the map under the field averaged over
 * INK_BLUR cells around, read between cells at the streak's own place and
 * nudged by its own INK_JITTER: a stretch of ground takes one ink, and
 * where it changes the edge is a smooth line with the inks mixed across it.
 * Read cell by cell, shallow water or a beach sitting at a threshold
 * flipped neighbours between inks and drew a checkerboard of blocks over
 * the water (Gavan, 2026-10-05, the Sault shore in the Bow view). A real
 * edge (a lake beside the land) moves a cell or two at most.
 */
const INK_BLUR = 2
/** Each streak's own nudge to the ink thresholds, ± this: where two inks
 *  meet they mix over a band instead of meeting at a line */
const INK_JITTER = 0.03

/** A cols×rows grid averaged over a (2·radius+1)² box of cells (fewer at the edges). */
function boxBlur(a: Float32Array, cols: number, rows: number, radius: number, out: Float32Array | null): Float32Array {
  const n = cols * rows
  const across = new Float32Array(n)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let sum = 0
      let k = 0
      for (let d = -radius; d <= radius; d++) {
        const cc = c + d
        if (cc < 0 || cc >= cols) continue
        sum += a[r * cols + cc]
        k++
      }
      across[r * cols + c] = sum / k
    }
  }
  const blur = out && out.length === n ? out : new Float32Array(n)
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      let sum = 0
      let k = 0
      for (let d = -radius; d <= radius; d++) {
        const rr = r + d
        if (rr < 0 || rr >= rows) continue
        sum += across[rr * cols + c]
        k++
      }
      blur[r * cols + c] = sum / k
    }
  }
  return blur
}

/** A field grid's value at a point, between its cells. */
function cellLerp(f: FieldGrid, grid: Float32Array, fx: number, fy: number): number {
  const gx = Math.min(f.cols - 1.001, Math.max(0, fx / f.step))
  const gy = Math.min(f.rows - 1.001, Math.max(0, fy / f.step))
  const c = gx | 0
  const r = gy | 0
  const tx = gx - c
  const ty = gy - r
  const i = r * f.cols + c
  const top = grid[i] * (1 - tx) + grid[i + 1] * tx
  const bottom = grid[i + f.cols] * (1 - tx) + grid[i + f.cols + 1] * tx
  return top * (1 - ty) + bottom * ty
}

let lumCanvas: HTMLCanvasElement | null = null

/**
 * Read the map under the field, one luminance per cell, so each streak can
 * take the tone that shows against what it crosses: a lake and the land
 * beside it, in the same view, want different inks. The GL canvas can only
 * be read while it is being drawn: inside a 'render' event, never after.
 */
function readLuminance(map: MlMap, f: FieldGrid) {
  const c = (lumCanvas ??= document.createElement('canvas'))
  try {
    c.width = f.cols
    c.height = f.rows
    // not willReadFrequently: that keeps this canvas on the CPU, and then
    // drawImage has to read the whole GL frame back to scale it down (a
    // full-screen readback and a pipeline stall on every call). On the GPU
    // the scale is a texture copy and only the cols×rows pixels are read.
    const g = c.getContext('2d')
    if (!g) return
    g.imageSmoothingEnabled = true
    g.imageSmoothingQuality = 'high'
    g.drawImage(map.getCanvas(), 0, 0, f.cols, f.rows)
    const d = g.getImageData(0, 0, f.cols, f.rows).data
    const lum = f.lum ?? new Float32Array(f.cols * f.rows)
    for (let i = 0; i < lum.length; i++) lum[i] = (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255
    f.lum = lum
    f.inkLum = boxBlur(lum, f.cols, f.rows, INK_BLUR, f.inkLum)
  } catch {
    f.lum = null
    f.inkLum = null
  }
}

/** Luminance from an RGBA readout, one per pixel; null for a blank one (a frame the browser would not give up). */
function lumOf(d: Uint8ClampedArray, n: number): Float32Array | null {
  const lum = new Float32Array(n)
  let seen = false
  for (let i = 0; i < n; i++) {
    lum[i] = (0.2126 * d[i * 4] + 0.7152 * d[i * 4 + 1] + 0.0722 * d[i * 4 + 2]) / 255
    if (d[i * 4 + 3]) seen = true
  }
  return seen ? lum : null
}

/** The bitmap road (lumBitmap) while this browser keeps it working. */
let bitmapRoad = typeof createImageBitmap === 'function'
let bitmapCanvas: HTMLCanvasElement | null = null

/**
 * The map under a cols×rows field, read the slow-to-ask, quick-to-wait way:
 * the frame taken as a bitmap (a copy on the GPU, at once, while the frame
 * is there to take: call it inside a 'render'), scaled down off the main
 * thread, and read once it is ready. readLuminance's getImageData waits
 * for the GPU to finish the frame it has just been given, and while the
 * map loads that was 50–200 ms of the main thread a reading. Null when the
 * road fails, and it is not tried again: readLuminance takes over.
 */
async function lumBitmap(map: MlMap, cols: number, rows: number): Promise<Float32Array | null> {
  let bmp: ImageBitmap
  try {
    bmp = await createImageBitmap(map.getCanvas(), { resizeWidth: cols, resizeHeight: rows, resizeQuality: 'high' })
  } catch {
    bitmapRoad = false
    return null
  }
  try {
    const c = (bitmapCanvas ??= document.createElement('canvas'))
    c.width = cols
    c.height = rows
    // on the CPU: the bitmap is already small, and this is the only read
    const g = c.getContext('2d', { willReadFrequently: true })
    if (!g) throw new Error('no 2d')
    g.imageSmoothingEnabled = true
    g.imageSmoothingQuality = 'high'
    // a browser that ignored the resize hands a full frame: scaled here
    g.drawImage(bmp, 0, 0, cols, rows)
    const lum = lumOf(g.getImageData(0, 0, cols, rows).data, cols * rows)
    if (!lum) throw new Error('blank frame')
    return lum
  } catch (e) {
    bitmapRoad = false
    devlog('flow', `inks · the bitmap read failed (${(e as Error).message}): reading the canvas`)
    return null
  } finally {
    bmp.close()
  }
}

/** A map still drawing this long after the last read (an archive that
 *  never idles) is read anyway: a fallback, since a read while the GPU is
 *  busy waits on it. The usual re-read is once the map has settled and
 *  gone quiet (QUIET_MS). It was 2 s, and every launch's tiles kept the map
 *  drawing that long: a stalled read two seconds into the streaks. */
const LUM_EVERY_MS = 6000
/** Reads asked for by the map settling are at least this far apart. */
const LUM_MIN_GAP_MS = 1000
/** How long the map must go without drawing, after it settles, before it
 *  is read: with nothing else queued on the GPU a read is a millisecond,
 *  with tiles still landing 50–200 ms on a phone. */
const QUIET_MS = 400

function buildField(map: MlMap, w: number, h: number, atMs: number): FieldGrid {
  const cols = Math.ceil(w / FIELD_STEP) + 1
  const rows = Math.ceil(h / FIELD_STEP) + 1
  const vx = new Float32Array(cols * rows)
  const vy = new Float32Array(cols * rows)
  const swirl = new Float32Array(cols * rows)
  let live = false
  const speedMul = useAppStore.getState().flowTuning.windSpeed
  // at ground level: the head-height model (drainage, shelter, breezes),
  // slow air drawn a little faster so a creeping drainage still reads
  const ground = useAppStore.getState().windLevel === 'ground' && microGrid() ? groundSampler(atMs) : null
  const wind = windSampler(atMs)
  const out = new Float32Array(4)
  // a map turned heading up turns the screen: a true bearing shows turned back by the map's
  const turn = (map.getBearing() * Math.PI) / 180
  const cb = Math.cos(turn)
  const sb = Math.sin(turn)
  if (ground) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const ll = map.unproject([c * FIELD_STEP, r * FIELD_STEP])
        if (!ground(ll.lng, ll.lat, out)) continue
        const kmh = Math.hypot(out[0], out[1]) * 3.6
        if (kmh < 0.05) continue
        const pxps = Math.min(220, Math.max(6, kmh * 0.54 * 4.5 * 2.2 * speedMul))
        const ue = out[0] / (kmh / 3.6)
        const un = out[1] / (kmh / 3.6)
        vx[r * cols + c] = (ue * cb - un * sb) * pxps
        vy[r * cols + c] = -(ue * sb + un * cb) * pxps
        swirl[r * cols + c] = swirlAmp(out[3], pxps)
        live = true
      }
    }
  } else if (wind) {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const ll = map.unproject([c * FIELD_STEP, r * FIELD_STEP])
        if (!wind(ll.lng, ll.lat, out)) continue
        // blows TOWARD dir+180; screen y grows downward, the map's bearing is up.
        // out[0] is km/h (the boat app's was knots): scaled to the same px/s
        const rad = ((out[1] + 180) * Math.PI) / 180 - turn
        const pxps = Math.min(220, Math.max(8, out[0] * 0.54 * 4.5 * speedMul))
        vx[r * cols + c] = Math.sin(rad) * pxps
        vy[r * cols + c] = -Math.cos(rad) * pxps
        live = true
      }
    }
  }
  // the forecast field carries no spread, so no eddies at that level
  return { step: FIELD_STEP, cols, rows, vx, vy, live, lum: null, inkLum: null, swirl: ground ? boxBlur(swirl, cols, rows, SWIRL_BLUR, null) : null }
}

function sampleField(f: FieldGrid, x: number, y: number, out: Float32Array): void {
  const fx = Math.min(f.cols - 1.001, Math.max(0, x / f.step))
  const fy = Math.min(f.rows - 1.001, Math.max(0, y / f.step))
  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const tx = fx - x0
  const ty = fy - y0
  const i = y0 * f.cols + x0
  out[0] = (f.vx[i] * (1 - tx) + f.vx[i + 1] * tx) * (1 - ty) + (f.vx[i + f.cols] * (1 - tx) + f.vx[i + f.cols + 1] * tx) * ty
  out[1] = (f.vy[i] * (1 - tx) + f.vy[i + 1] * tx) * (1 - ty) + (f.vy[i + f.cols] * (1 - tx) + f.vy[i + f.cols + 1] * tx) * ty
}

interface EngineOpts {
  level: () => number
  warm?: boolean
}

interface Engine {
  stop: () => void
  rebase: () => void
  /** Resample the wind under the view, keeping the trails and the
   *  particles. False when there is no wind to sample any more. */
  refield: () => boolean
  dead: boolean
}

const LONG_MOVE_MS = 4000
const SETTLED_MS = 2500

function startEngine(map: MlMap, opts: EngineOpts): Engine {
  const container = map.getContainer()
  const w = container.clientWidth
  const h = container.clientHeight
  const atMs = () => useAppStore.getState().planTimeMs ?? Date.now()

  let field = buildField(map, w, h, atMs())
  if (!field.live) return { stop: () => {}, rebase: () => {}, refield: () => false, dead: true }
  // A reading of the map under the field, inside a render (the GL canvas
  // can only be read then), into whichever field is current when it lands.
  // By the bitmap road it lands a moment later: a reading of a view the
  // camera has since left (viewGen moved on) is dropped, and the next idle
  // reads the new one. Read straight off the canvas, every reading is a GPU
  // sync: on the phone 50–200 ms while the map loads.
  let viewGen = 0
  let bitmapBusy = false
  let stopped = false
  const readNow = () => {
    // one white ink: nothing to read the map for
    if (lookOf().white) return
    if (!bitmapRoad) return readLuminance(map, field)
    if (bitmapBusy) return
    bitmapBusy = true
    const gen = viewGen
    void lumBitmap(map, field.cols, field.rows).then((lum) => {
      bitmapBusy = false
      if (stopped || gen !== viewGen) return
      if (!lum) return readSoon()
      field.lum = lum
      field.inkLum = boxBlur(lum, field.cols, field.rows, INK_BLUR, field.inkLum)
    })
  }
  let readPending = false
  const readSoon = () => {
    if (readPending) return
    readPending = true
    map.once('render', () => {
      readPending = false
      readNow()
    })
    map.triggerRepaint()
  }
  // the Contrast look's wash, drawn with every new field (a pan's slide keeps it: it sits in the map)
  const syncWash = () => {
    if (lookOf().wash) paintWash(map, atMs())
    else removeWash(map)
  }
  syncWash()
  const fieldOff = { x: 0, y: 0 }
  const swirl = makeSwirl(w, h, performance.now())
  const eddy = new Float32Array(2)

  const canvas = document.createElement('canvas')
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:2;'
  const carrier = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!
  const cctx = carrier.getContext('2d')!
  let dpr = 0
  const wantDpr = () => Math.min(qualityProfile().trailDpr, window.devicePixelRatio || 1)
  const setDpr = (d: number) => {
    // a resize clears a canvas: the trails go through the carrier
    const keep = dpr > 0
    if (keep) {
      cctx.setTransform(1, 0, 0, 1, 0, 0)
      cctx.clearRect(0, 0, carrier.width, carrier.height)
      cctx.drawImage(canvas, 0, 0)
    }
    dpr = d
    canvas.width = Math.round(w * d)
    canvas.height = Math.round(h * d)
    if (keep) {
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.drawImage(carrier, 0, 0, canvas.width, canvas.height)
    }
    carrier.width = canvas.width
    carrier.height = canvas.height
    ctx.lineCap = 'round'
  }
  setDpr(wantDpr())
  container.appendChild(canvas)

  const N = Math.max(20, Math.round(useAppStore.getState().flowTuning.windDensity))
  const px = new Float32Array(N)
  const py = new Float32Array(N)
  const vel = new Float32Array(2)
  const bands: Path2D[] = new Array(ALPHA_BANDS * TONES)
  const age = new Float32Array(N)
  const life = new Float32Array(N)
  const jitter = Float32Array.from({ length: N }, () => (Math.random() * 2 - 1) * INK_JITTER)

  let anchor = new FrameAnchor(map, centrePoint(map))
  let M: Affine = IDENTITY
  let Mprev: Affine = IDENTITY
  let Minv: Affine = IDENTITY
  let lod = lodOf(map, h)
  let active = N
  const sizeActive = () => {
    active = Math.max(20, Math.min(N, Math.round(N * qualityProfile().particles * meanLod(lod, h))))
  }
  sizeActive()

  const spawn = (i: number) => {
    let x = Math.random() * w
    let y = Math.random() * h
    for (let t = 0; t < 4 && Math.random() > lod(y); t++) {
      x = Math.random() * w
      y = Math.random() * h
    }
    px[i] = Minv.a * x + Minv.c * y + Minv.e
    py[i] = Minv.b * x + Minv.d * y + Minv.f
    age[i] = 0
    life[i] = 1.6 + Math.random() * 2.2
  }
  for (let i = 0; i < N; i++) {
    spawn(i)
    age[i] = Math.random() * life[i]
  }

  const born = performance.now() - (opts.warm ? 900 : 0)
  let last = performance.now()
  let drawnAt = last
  let movedAt = 0
  let movingSince = 0
  let raf = 0

  const carry = (delta: Affine) => {
    cctx.setTransform(1, 0, 0, 1, 0, 0)
    cctx.clearRect(0, 0, carrier.width, carrier.height)
    cctx.drawImage(canvas, 0, 0)
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.setTransform(delta.a, delta.b, delta.c, delta.d, delta.e * dpr, delta.f * dpr)
    ctx.drawImage(carrier, 0, 0)
  }

  const rebase = () => {
    const now = anchor.current(map)
    if (!same(now, Mprev)) carry(compose(now, invert(Mprev)))
    if (!isIdentity(now)) {
      for (let i = 0; i < N; i++) {
        const x = px[i]
        const y = py[i]
        px[i] = now.a * x + now.c * y + now.e
        py[i] = now.b * x + now.d * y + now.f
      }
    }
    anchor = new FrameAnchor(map, centrePoint(map))
    M = Mprev = Minv = IDENTITY
    movedAt = 0
    movingSince = 0
    const slid = Math.abs(now.a - 1) < 1e-3 && Math.abs(now.d - 1) < 1e-3 && Math.abs(now.b) < 1e-3 && Math.abs(now.c) < 1e-3
    if (slid && Math.hypot(fieldOff.x + now.e, fieldOff.y + now.f) < FIELD_STEP) {
      fieldOff.x += now.e
      fieldOff.y += now.f
    } else {
      field = buildField(map, w, h, atMs())
      fieldOff.x = 0
      fieldOff.y = 0
      viewGen++
      // a new view under the field: what it crosses has to be read again
      if (field.live) readSoon()
      syncWash()
    }
    lod = lodOf(map, h)
    sizeActive()
    const d = wantDpr()
    if (d !== dpr) setDpr(d)
  }

  // the air changed, not the view (a grid landed, the planning time moved,
  // the level switched): a new field under the particles already flying,
  // their trails kept. A restart would clear the canvas and fade in again.
  // The map under the field is the same map, so the last reading of it
  // carries over: on load the grid, the profile, the ground model and the
  // ensemble land a second or so apart, and each used to read it again.
  const refield = () => {
    if (!isIdentity(anchor.current(map))) rebase()
    const f = buildField(map, w, h, atMs())
    if (!f.live) return false
    // a field slid under a small pan was read where it was: a cell out at most, read again
    const slid = fieldOff.x !== 0 || fieldOff.y !== 0
    f.lum = field.lum
    f.inkLum = field.inkLum
    field = f
    fieldOff.x = 0
    fieldOff.y = 0
    if (!f.lum || slid) armQuiet()
    syncWash()
    return true
  }

  const frame = (now: number) => {
    reportFrame(now - last, now)
    last = now
    const q = qualityProfile()

    M = anchor.current(map)
    const moved = !same(M, Mprev)
    if (moved) {
      carry(compose(M, invert(Mprev)))
      Mprev = M
      Minv = invert(M)
      movedAt = now
      movingSince ||= now
    }
    if (!isIdentity(M)) {
      if ((!moved && now - movedAt > SETTLED_MS) || now - movingSince > LONG_MOVE_MS) rebase()
    }
    if (q.wind30 && !moved && now - drawnAt < 28) {
      raf = requestAnimationFrame(frame)
      return
    }
    const dt = Math.min(0.05, (now - drawnAt) / 1000)
    drawnAt = now
    const tune = useAppStore.getState().flowTuning
    const amps = tune.windSwirl ? field.swirl : null
    if (amps) rollSwirl(swirl, now)
    const phase = (now - swirl.t0) / SWIRL_PERIOD

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.globalCompositeOperation = 'destination-in'
    ctx.fillStyle = `rgba(0, 0, 0, ${tune.windTrail})`
    ctx.fillRect(0, 0, w, h)
    ctx.globalCompositeOperation = 'source-over'
    ctx.setTransform(dpr * M.a, dpr * M.b, dpr * M.c, dpr * M.d, dpr * M.e, dpr * M.f)

    const level = opts.level() * Math.min(1, (now - born) / 900) * zoomFade(map.getZoom())
    for (let b = 0; b < ALPHA_BANDS * TONES; b++) bands[b] = new Path2D()
    // until the map under the field has been read: dark ink on a pale base
    // (topo, the elevation colours, the shade alone), light over the rest
    const ly = useAppStore.getState().layers
    const pale = !ly.satellite && (ly.topo || ly.relief || ly.hillshade)
    const fallback = pale ? TONE_DARK : TONE_LIGHT
    const inks = field.inkLum
    for (let i = 0; i < active; i++) {
      age[i] += dt
      const fx = px[i] - fieldOff.x
      const fy = py[i] - fieldOff.y
      sampleField(field, fx, fy, vel)
      let vx = vel[0]
      let vy = vel[1]
      if (amps) {
        const amp = cellLerp(field, amps, fx, fy)
        if (amp > 0.5) {
          sampleSwirl(swirl, fx, fy, phase, eddy)
          vx += amp * eddy[0]
          vy += amp * eddy[1]
        }
      }
      const nx = px[i] + vx * dt
      const ny = py[i] + vy * dt
      const sx = M.a * nx + M.c * ny + M.e
      const sy = M.b * nx + M.d * ny + M.f
      const gone = age[i] > life[i] || sx < 0 || sx > w || sy < 0 || sy > h || (vx === 0 && vy === 0)
      if (gone) {
        spawn(i)
        continue
      }
      const spd = Math.hypot(vx, vy)
      const band = Math.min(ALPHA_BANDS - 1, ((spd / 130) * ALPHA_BANDS) | 0)
      let tone = fallback
      if (inks) tone = toneOf(cellLerp(field, inks, px[i] - fieldOff.x, py[i] - fieldOff.y) + jitter[i])
      const path = bands[tone * ALPHA_BANDS + band]
      path.moveTo(px[i], py[i])
      path.lineTo(nx, ny)
      px[i] = nx
      py[i] = ny
    }
    ctx.lineWidth = streakPx
    // the same hue in three inks: light, brighter, and a dark one that
    // reads on pale ground; the Contrast look's one white
    const look = LOOKS[tune.windStyle] ?? LOOKS.standard
    for (let tone = 0; tone < TONES; tone++) {
      const light = tone === TONE_DARK ? look.ink.dark : tone === TONE_BRIGHT ? look.ink.bright : look.ink.light
      const sat = look.white ? 0 : tone === TONE_DARK ? 90 : tone === TONE_BRIGHT ? Math.round(tune.windSat * 0.7) : tune.windSat
      const boost = look.white ? 1 : tone === TONE_DARK ? 1.25 : tone === TONE_BRIGHT ? 1.1 : 1
      for (let b = 0; b < ALPHA_BANDS; b++) {
        const alpha = (look.floor + ((b + 0.5) / ALPHA_BANDS) * look.span) * level * boost
        ctx.strokeStyle = `hsla(${tune.windHue}, ${sat}%, ${light}%, ${Math.min(1, alpha)})`
        ctx.stroke(bands[tone * ALPHA_BANDS + b])
      }
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    raf = requestAnimationFrame(frame)
  }
  raf = requestAnimationFrame(frame)
  const offQuality = onQuality(() => rebase())
  // When to read the map under the field again: once it has settled (every
  // tile in, a view's layers switched) and then gone QUIET_MS without
  // drawing, so the read waits on nothing else the GPU has queued. While
  // tiles land the idles come in bursts, each followed by more drawing:
  // only the last, quiet one is read. The clock starts with the streaks.
  let lumAt = performance.now()
  let quietTimer = 0
  /** our own repaint for a read, and the idle that follows it */
  let reading = false
  let ownIdle = false
  const readNext = () => {
    lumAt = performance.now()
    reading = true
    ownIdle = true
    map.once('render', () => {
      reading = false
      readNow()
    })
    map.triggerRepaint()
  }
  function armQuiet() {
    clearTimeout(quietTimer)
    const wait = Math.max(QUIET_MS, LUM_MIN_GAP_MS - (performance.now() - lumAt))
    quietTimer = window.setTimeout(() => {
      quietTimer = 0
      if (same(anchor.current(map), IDENTITY)) readNext()
    }, wait)
  }
  // The streaks start as the map settles, often with tiles still landing:
  // a reading then would wait on all of them and be of a half-drawn map.
  // The inks take the base's guess till the map has gone quiet.
  armQuiet()
  const onRender = () => {
    if (reading) return
    // drawing again: not quiet (the next idle waits again)
    if (quietTimer) {
      clearTimeout(quietTimer)
      quietTimer = 0
    }
    const now = performance.now()
    if (now - lumAt < LUM_EVERY_MS || !same(anchor.current(map), IDENTITY)) return
    lumAt = now
    readNow()
  }
  const onIdle = () => {
    // the repaint asked for in readNext ends in an idle of its own: skip
    // that one, or every read would ask for the next
    if (ownIdle) {
      ownIdle = false
      return
    }
    if (same(anchor.current(map), IDENTITY)) armQuiet()
  }
  map.on('render', onRender)
  map.on('idle', onIdle)

  return {
    dead: false,
    rebase,
    refield,
    stop: () => {
      stopped = true
      removeWash(map)
      cancelAnimationFrame(raf)
      offQuality()
      map.off('render', onRender)
      map.off('idle', onIdle)
      clearTimeout(quietTimer)
      canvas.remove()
    },
  }
}

let ambient: Engine | null = null

function reducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

/**
 * What the streaks wait for: the ground model's file and, only when the
 * phone has none, the forecast. An old forecast draws at once and the new
 * one is fetched behind it (onWeatherGrid, onProfile resample the streaks
 * when it lands). Opened after a while, the wind used to sit until every
 * request was back.
 */
function airReady(ground: boolean): Promise<unknown> {
  const g = ensureWeatherGrid()
  const p = ground ? ensureProfile() : null
  return Promise.all([windGridInfo() ? null : g, ground ? Promise.all([loadMicro(), currentProfile() ? null : p]) : null])
}

/** The map whose first settled frame has been drawn (or OPEN_MS after its
 *  style, if the tiles take longer): the streaks start no sooner, and only
 *  once. The wind's data landing before then used to start them early, in
 *  the thick of the load, and the first idle then started them over: the
 *  trails wiped a second after they appeared. */
let openedMap: MlMap | null = null
/** The longest the streaks wait for the map to settle. The spot scoring's
 *  own wait is longer (spotsLayer), so the wind has a second to itself. */
const OPEN_MS = 1500

function syncAmbient(map: MlMap) {
  const s = useAppStore.getState()
  const want = s.layers.windFlow && !reducedMotion() && document.visibilityState === 'visible'
  const wasLive = !!ambient
  if (ambient) {
    ambient.stop()
    ambient = null
  }
  if (!want || openedMap !== map) return
  void airReady(useAppStore.getState().windLevel === 'ground').then(() => {
    if (ambient) return
    if (!useAppStore.getState().layers.windFlow) return
    const eng = startEngine(map, { warm: wasLive, level: () => useAppStore.getState().windFlowOpacity })
    if (eng.dead) return // no grid yet: onWeatherGrid retries
    ambient = eng
  })
}

/** The wind data changed under a running layer: resample it in place.
 *  Without this every grid landing on load restarted the engine, and the
 *  streaks faded in three times a second apart. */
function refreshAmbient(map: MlMap) {
  const eng = ambient
  if (!eng) {
    syncAmbient(map)
    return
  }
  const ground = useAppStore.getState().windLevel === 'ground'
  void airReady(ground).then(() => {
    if (ambient !== eng) return
    if (!eng.refield()) syncAmbient(map)
  })
}

let wired = false
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload())

/** Call once at startup; wires the wind layer to its switches. */
export function initWindFlow() {
  if (wired) return
  wired = true
  sizeStreaks()
  useAppStore.subscribe((s, prev) => {
    if (s.flowTuning.windSize !== prev.flowTuning.windSize || s.textSize !== prev.textSize) sizeStreaks()
  })
  // the phone's text size can change while we are in the background
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') sizeStreaks()
  })
  onEachMap((map) => {
    onFirstIdle(
      map,
      () => {
        openedMap = map
        syncAmbient(map)
      },
      OPEN_MS,
    )
    map.on('moveend', () => {
      if (ambient) ambient.rebase()
      else syncAmbient(map)
    })
    map.on('resize', () => syncAmbient(map))
    map.once('remove', () => {
      ambient?.stop()
      ambient = null
    })
  })
  withMap(() => {
    const cur = () => {
      const m = getMap()
      if (m) syncAmbient(m)
    }
    document.addEventListener('visibilitychange', cur)
    const fresh = () => {
      const m = getMap()
      if (m) refreshAmbient(m)
    }
    useAppStore.subscribe((s, prev) => {
      // the switches and the particle count need a new engine
      if (s.layers.windFlow !== prev.layers.windFlow || s.flowTuning.windDensity !== prev.flowTuning.windDensity) cur()
      // the air under it only needs resampling
      else if (s.planTimeMs !== prev.planTimeMs || s.flowTuning.windSpeed !== prev.flowTuning.windSpeed || s.flowTuning.windStyle !== prev.flowTuning.windStyle || s.windLevel !== prev.windLevel) fresh()
      // the wash's strength follows the streaks'
      if (s.windFlowOpacity !== prev.windFlowOpacity) {
        const m = getMap()
        if (m?.getLayer(WASH_SRC)) m.setPaintProperty(WASH_SRC, 'raster-opacity', washOpacity())
      }
    })
    onWeatherGrid(fresh)
    // at "now" the air drifts between hours; a planned time stands still
    onWeatherTick(() => {
      if (useAppStore.getState().planTimeMs == null) fresh()
    })
    onMicro(fresh)
    onProfile(fresh)
    useWindChecks.subscribe(fresh)
  })
}
