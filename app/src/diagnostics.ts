/**
 * What the app is, for the top of an uploaded dev log: the build, the
 * phone, the viewport, the area it is in, the view and layers on, the maps
 * on the phone and the storage, the weather's age, the GPS, the sheet up,
 * and the last errors the console saw. Assembled only when the log is
 * uploaded or shared; nothing here phones home on its own.
 */
import { ACTIVE_AREA } from './areas'
import { devlog, devlogCount, devlogOn, lastUpload } from './devlog'
import { listStored, storageEstimate } from './offline/fileStore'
import { useAppStore } from './state/appStore'
import { currentView, useViews } from './state/viewsStore'
import { useSpotsStore } from './state/spotsStore'
import { agoLabel } from './time'
import { useGpsStore } from './tracking/gpsStore'
import { campForecast, weatherStatus } from './weather/refresh'

export const BUILD: { sha: string; at: string } = __BUILD__

// ---------- error ring buffer ----------

type Level = 'error' | 'warn' | 'uncaught' | 'rejection'
interface LogEntry {
  at: number
  level: Level
  text: string
}

const LOG_MAX = 20
const SNAP_MAX = 8
const ENTRY_CHARS = 160
const log: LogEntry[] = []

function describe(v: unknown): string {
  if (v instanceof Error) {
    const where = v.stack?.split('\n')[1]?.trim()
    return `${v.name}: ${v.message}${where ? ` @ ${where}` : ''}`
  }
  if (typeof v === 'string') return v
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

function push(level: Level, args: unknown[]) {
  const text = args.map(describe).join(' ').slice(0, ENTRY_CHARS)
  log.push({ at: Date.now(), level, text })
  if (log.length > LOG_MAX) log.shift()
  devlog(level, text)
}

let installed = false

/** Wire the window's uncaught errors and the console's error/warn calls
 *  into the ring buffer. Call once, before the app renders. */
export function installErrorLog() {
  if (installed) return
  installed = true
  window.addEventListener('error', (e) => push('uncaught', [e.message, e.filename ? `${e.filename}:${e.lineno}` : '']))
  window.addEventListener('unhandledrejection', (e) => push('rejection', [e.reason]))
  const error = console.error.bind(console)
  const warn = console.warn.bind(console)
  console.error = (...a: unknown[]) => {
    push('error', a)
    error(...a)
  }
  console.warn = (...a: unknown[]) => {
    push('warn', a)
    warn(...a)
  }
}

// ---------- the snapshot ----------

const yn = (v: boolean) => (v ? 'yes' : 'no')

function fmtBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`
  if (n >= 1e6) return `${(n / 1e6).toFixed(0)} MB`
  return `${(n / 1e3).toFixed(0)} KB`
}

function standalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean }
  return nav.standalone === true || matchMedia('(display-mode: standalone)').matches
}

export async function buildSnapshot(): Promise<string> {
  const app = useAppStore.getState()
  const gps = useGpsStore.getState()
  const views = useViews.getState()
  const spots = useSpotsStore.getState()
  const wx = weatherStatus()
  const now = Date.now()
  const quota = await storageEstimate().catch(() => null)

  const fix = gps.fix
  const gpsLine = fix
    ? `${gps.status} · ${fix.lat.toFixed(4)}, ${fix.lon.toFixed(4)} ±${Math.round(fix.sigma ?? fix.accuracy)} m · fix ${agoLabel(now - fix.ts)}`
    : `${gps.status} · no fix`
  const layersOn = Object.entries(app.layers)
    .filter(([, on]) => on)
    .map(([k]) => k)
    .join(', ')
  const stored = listStored()
  const camp = campForecast()
  const vv = window.visualViewport
  const recent = log.slice(-SNAP_MAX)
  const last = lastUpload()

  return [
    `Huntapp snapshot`,
    `Build: ${BUILD.sha} · ${BUILD.at}`,
    `Page: ${location.origin}${location.pathname} · installed ${yn(standalone())}`,
    `Device: ${navigator.userAgent}`,
    `Screen: ${screen.width}×${screen.height} @${devicePixelRatio} · viewport ${innerWidth}×${innerHeight}${vv ? ` · visual ${Math.round(vv.width)}×${Math.round(vv.height)}` : ''}`,
    `Time: ${new Date(now).toString()}`,
    `Online: ${yn(app.online)} · service worker ${yn(!!navigator.serviceWorker?.controller)}`,
    `Area: ${ACTIVE_AREA.id} · ${ACTIVE_AREA.name}`,
    ``,
    `GPS: ${gpsLine}${gps.lastError ? ` · last error: ${gps.lastError}` : ''}`,
    `Mode: ${views.mode} · view ${currentView()?.name ?? 'custom'} · quarry ${spots.target} · heat ${yn(spots.heat)}`,
    `Layers: ${layersOn || 'none'}`,
    `Chrome: outdoor ${yn(app.outdoor)} · text ${app.textSize} · thumb ${app.leftHanded ? 'left' : 'right'} · labels ${yn(app.buttonLabels)}`,
    `Strip: ${app.stripOpen ? 'open' : 'folded'} · plan time ${app.planTimeMs ? new Date(app.planTimeMs).toString() : 'now'}`,
    `Sheets: ${app.sheets.length ? app.sheets.map((s) => s.kind).join(' › ') : 'none'} · top card ${app.topCard?.kind ?? 'none'}`,
    ``,
    `Maps on the phone: ${stored.length ? stored.map((s) => s.name).join(', ') : 'none'} · offline ready ${yn(app.offlineReady)} · missing ${app.missingData.length ? app.missingData.join(', ') : 'none'}`,
    `Storage: ${quota ? `${fmtBytes(quota.usage)} of ${fmtBytes(quota.quota)}` : 'unknown'}`,
    `Weather: ${camp ? `camp forecast ${agoLabel(now - camp.fetchedAt)}${camp.hrdpsHours ? ` · HRDPS ${camp.hrdpsHours} h` : ''}` : 'no camp forecast'}${wx.lastError ? ` · last error ${wx.lastFailAt ? agoLabel(now - wx.lastFailAt) : ''}: ${wx.lastError}` : ''}`,
    `Dev log: ${devlogOn() ? `${devlogCount()} lines` : 'off'}${last ? ` · uploaded ${last.url}` : ''}`,
    ``,
    `Recent errors (${log.length} logged, last ${recent.length}):`,
    ...(recent.length ? recent.map((e) => `  ${agoLabel(now - e.at)} [${e.level}] ${e.text}`) : ['  none']),
  ].join('\n')
}
