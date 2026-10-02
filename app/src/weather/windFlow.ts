import type { Map as MlMap } from 'maplibre-gl'
import { getMap, onEachMap, onFirstIdle, withMap } from '../map/mapController'
import { useAppStore } from '../state/appStore'
import { lodOf, meanLod, onQuality, qualityProfile, reportFrame } from './flowQuality'
import { centrePoint, compose, FrameAnchor, IDENTITY, invert, isIdentity, same, type Affine } from './frameAffine'
import { ensureWeatherGrid, onWeatherGrid, onWeatherTick, windSampler } from './windGrid'
import { ensureProfile, onProfile } from './boundaryLayer'
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
 * resamples the wind under the new view. Stops for prefers-reduced-motion,
 * a hidden tab and low power.
 */

const FIELD_STEP = 28 // css px between wind samples
const ALPHA_BANDS = 12

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
  /** how hard the eddies turn in each cell, css px/s; 0 where the air runs straight */
  swirl: Float32Array | null
}

// ---------------------------------------------------------------- swirl

/**
 * Where the ground model says the air swirls (a tree-line eddy, a small
 * opening, a slot across the wind) the mean alone draws a slow straight
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
  } catch {
    f.lum = null
  }
}

/** A first reading for a fresh field, on the next render. */
function sampleLuminance(map: MlMap, f: FieldGrid) {
  map.once('render', () => readLuminance(map, f))
  map.triggerRepaint()
}

/** Renders at least this far apart are read again while the map is still
 *  drawing (an archive that never idles): a fallback, since every read is a
 *  GPU sync. The usual re-read is one per 'idle', when the tiles have landed. */
const LUM_EVERY_MS = 2000
/** Reads asked for by the map going idle are at least this far apart. */
const LUM_MIN_GAP_MS = 1000

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
  const f: FieldGrid = { step: FIELD_STEP, cols, rows, vx, vy, live, lum: null, swirl: ground ? swirl : null }
  if (live) sampleLuminance(map, f)
  return f
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
  if (!field.live) return { stop: () => {}, rebase: () => {}, dead: true }
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
    dpr = d
    canvas.width = carrier.width = Math.round(w * d)
    canvas.height = carrier.height = Math.round(h * d)
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
    }
    lod = lodOf(map, h)
    sizeActive()
    const d = wantDpr()
    if (d !== dpr) setDpr(d)
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
    const lum = field.lum
    for (let i = 0; i < active; i++) {
      age[i] += dt
      const fx = px[i] - fieldOff.x
      const fy = py[i] - fieldOff.y
      sampleField(field, fx, fy, vel)
      let vx = vel[0]
      let vy = vel[1]
      if (amps) {
        const sc = Math.min(field.cols - 1, Math.max(0, (fx / field.step) | 0))
        const sr = Math.min(field.rows - 1, Math.max(0, (fy / field.step) | 0))
        const amp = amps[sr * field.cols + sc]
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
      if (lum) {
        const fc = Math.min(field.cols - 1, Math.max(0, ((px[i] - fieldOff.x) / field.step) | 0))
        const fr = Math.min(field.rows - 1, Math.max(0, ((py[i] - fieldOff.y) / field.step) | 0))
        tone = toneOf(lum[fr * field.cols + fc])
      }
      const path = bands[tone * ALPHA_BANDS + band]
      path.moveTo(px[i], py[i])
      path.lineTo(nx, ny)
      px[i] = nx
      py[i] = ny
    }
    ctx.lineWidth = streakPx
    // the same hue in three inks: light, brighter, and a dark one that
    // reads on pale ground
    for (let tone = 0; tone < TONES; tone++) {
      const light = tone === TONE_DARK ? 24 : tone === TONE_BRIGHT ? 80 : 62
      const sat = tone === TONE_DARK ? 90 : tone === TONE_BRIGHT ? Math.round(tune.windSat * 0.7) : tune.windSat
      const boost = tone === TONE_DARK ? 1.25 : tone === TONE_BRIGHT ? 1.1 : 1
      for (let b = 0; b < ALPHA_BANDS; b++) {
        const alpha = (0.22 + ((b + 0.5) / ALPHA_BANDS) * 0.4) * level * boost
        ctx.strokeStyle = `hsla(${tune.windHue}, ${sat}%, ${light}%, ${Math.min(1, alpha)})`
        ctx.stroke(bands[tone * ALPHA_BANDS + b])
      }
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    raf = requestAnimationFrame(frame)
  }
  raf = requestAnimationFrame(frame)
  const offQuality = onQuality(() => rebase())
  // the map drawn again while the frame still matches the screen (tiles
  // landing, a view's layers switched): read what is under the field again
  let lumAt = 0
  const onRender = () => {
    const now = performance.now()
    if (now - lumAt < LUM_EVERY_MS || !same(anchor.current(map), IDENTITY)) return
    lumAt = now
    readLuminance(map, field)
  }
  // the map settled (every tile in): one read on the next render, which
  // is when the GL canvas can be read. While tiles are landing the map
  // renders continuously, so the render clock alone read it every half
  // second through the whole load, each a GPU stall.
  let ownIdle = false
  let lumTimer = 0
  const readNext = () => {
    lumAt = performance.now()
    ownIdle = true
    map.once('render', () => readLuminance(map, field))
    map.triggerRepaint()
  }
  const onIdle = () => {
    // the repaint asked for in readNext ends in an idle of its own: skip
    // that one (a clock would not do: a read slower than the gap loops)
    if (ownIdle) {
      ownIdle = false
      return
    }
    if (!same(anchor.current(map), IDENTITY)) return
    // while tiles land the idles come in bursts: a read a second at most,
    // the last burst's read kept so the settled map is what was read
    const wait = LUM_MIN_GAP_MS - (performance.now() - lumAt)
    if (wait <= 0) readNext()
    else if (!lumTimer)
      lumTimer = window.setTimeout(() => {
        lumTimer = 0
        if (same(anchor.current(map), IDENTITY)) readNext()
      }, wait)
  }
  map.on('render', onRender)
  map.on('idle', onIdle)

  return {
    dead: false,
    rebase,
    stop: () => {
      cancelAnimationFrame(raf)
      offQuality()
      map.off('render', onRender)
      map.off('idle', onIdle)
      clearTimeout(lumTimer)
      canvas.remove()
    },
  }
}

let ambient: Engine | null = null

function reducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

function syncAmbient(map: MlMap) {
  const s = useAppStore.getState()
  const want = s.layers.windFlow && !s.lowPower && !reducedMotion() && document.visibilityState === 'visible'
  const wasLive = !!ambient
  if (ambient) {
    ambient.stop()
    ambient = null
  }
  if (!want) return
  void Promise.all([ensureWeatherGrid(), useAppStore.getState().windLevel === 'ground' ? Promise.all([loadMicro(), ensureProfile()]) : null]).then(() => {
    if (ambient) return
    if (!useAppStore.getState().layers.windFlow) return
    const eng = startEngine(map, { warm: wasLive, level: () => useAppStore.getState().windFlowOpacity })
    if (eng.dead) return // no grid yet: onWeatherGrid retries
    ambient = eng
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
    onFirstIdle(map, () => syncAmbient(map))
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
    useAppStore.subscribe((s, prev) => {
      if (
        s.layers.windFlow !== prev.layers.windFlow ||
        s.lowPower !== prev.lowPower ||
        s.planTimeMs !== prev.planTimeMs ||
        s.flowTuning.windDensity !== prev.flowTuning.windDensity ||
        s.flowTuning.windSpeed !== prev.flowTuning.windSpeed ||
        s.windLevel !== prev.windLevel
      )
        cur()
    })
    onWeatherGrid(cur)
    // at "now" the air drifts between hours; a planned time stands still
    onWeatherTick(() => {
      if (useAppStore.getState().planTimeMs == null) cur()
    })
    onMicro(cur)
    onProfile(cur)
    useWindChecks.subscribe(cur)
  })
}
