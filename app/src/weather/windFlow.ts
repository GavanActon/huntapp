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
    const g = c.getContext('2d', { willReadFrequently: true })
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

/** Renders at least this far apart are read again, for tiles landing after the field was built. */
const LUM_EVERY_MS = 500

function buildField(map: MlMap, w: number, h: number, atMs: number): FieldGrid {
  const cols = Math.ceil(w / FIELD_STEP) + 1
  const rows = Math.ceil(h / FIELD_STEP) + 1
  const vx = new Float32Array(cols * rows)
  const vy = new Float32Array(cols * rows)
  let live = false
  const speedMul = useAppStore.getState().flowTuning.windSpeed
  // at ground level: the head-height model (drainage, shelter, breezes),
  // slow air drawn a little faster so a creeping drainage still reads
  const ground = useAppStore.getState().windLevel === 'ground' && microGrid() ? groundSampler(atMs) : null
  const wind = windSampler(atMs)
  const out = new Float32Array(3)
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
  const f: FieldGrid = { step: FIELD_STEP, cols, rows, vx, vy, live, lum: null }
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

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.globalCompositeOperation = 'destination-in'
    ctx.fillStyle = `rgba(0, 0, 0, ${tune.windTrail})`
    ctx.fillRect(0, 0, w, h)
    ctx.globalCompositeOperation = 'source-over'
    ctx.setTransform(dpr * M.a, dpr * M.b, dpr * M.c, dpr * M.d, dpr * M.e, dpr * M.f)

    const level = opts.level() * Math.min(1, (now - born) / 900)
    for (let b = 0; b < ALPHA_BANDS * TONES; b++) bands[b] = new Path2D()
    // until the map under the field has been read: dark ink on a pale base
    // (topo, the elevation colours, the shade alone), light over the rest
    const ly = useAppStore.getState().layers
    const pale = !ly.satellite && (ly.topo || ly.relief || ly.hillshade)
    const fallback = pale ? TONE_DARK : TONE_LIGHT
    const lum = field.lum
    for (let i = 0; i < active; i++) {
      age[i] += dt
      sampleField(field, px[i] - fieldOff.x, py[i] - fieldOff.y, vel)
      const vx = vel[0]
      const vy = vel[1]
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
  map.on('render', onRender)

  return {
    dead: false,
    rebase,
    stop: () => {
      cancelAnimationFrame(raf)
      offQuality()
      map.off('render', onRender)
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
