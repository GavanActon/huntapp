import { useEffect, useRef } from 'react'
import MapView from './map/MapView'
import './map/mapBearing' // keeps the rotate listener registered: the compass and the wind arrows read it
import { useAppStore } from './state/appStore'
import { useCompass } from './tracking/compass'
import { useGpsStore } from './tracking/gpsStore'
import { compass } from './weather/openMeteo'
import { initTextScale } from './ui/textScale'
import { initTheme } from './ui/theme'
import { releaseArmed, useTool } from './ui/tools'
import WeatherStrip from './ui/WeatherStrip'
import LiveCard from './ui/LiveCard'
import TopCardHost from './ui/TopCardHost'
import HotColumn from './ui/HotColumn'
import ToolColumn from './ui/ToolColumn'
import SheetHost from './ui/sheets/SheetHost'
import MeasureCard from './ui/MeasureCard'
import PathCard from './ui/PathCard'
import RouteCard from './ui/RouteCard'
import { initRoutes } from './routes/routeStore'
import { initRouteLayer } from './routes/routeLayer'
import { initScentLayer } from './weather/micro/scent'
import { initCheckLayer } from './weather/micro/checkLayer'
import { initLayerArrive } from './map/layerArrive'
import { initTerrain3d } from './map/terrain3d'
import WindKey from './ui/WindKey'
import { initPartyLayer } from './party/partyLayer'
import { initMapUpdates } from './offline/updates'
import { initAppUpdate, reloadApp, useAppUpdate } from './offline/appUpdate'
import { warmStart } from './offline/warmStart'
import { loadMicro } from './weather/micro/model'
import { initLive } from './hunting/hunting'
import { initMoveLayer } from './hunting/moveLayer'
import HeardCard, { useHeardForm } from './ui/HeardCard'
import WindCheckCard, { useCheckForm } from './ui/WindCheckCard'
import { initMeasureLayer } from './measure/measureLayer'
import { initPathLayer } from './paths/pathLayer'
import { initBushLabels } from './bushLabels/labelLayer'
import BushLabelCard from './ui/BushLabelCard'
import { initWindFlow } from './weather/windFlow'
import { initWeatherRefresh } from './weather/refresh'
import { initPositionLayer } from './tracking/positionLayer'
import { initTrackLayer } from './tracking/trackLayer'
import { initTrackRecording } from './tracking/trackStore'
import { resumeLocation } from './tracking/gpsService'
import { initPlanTime } from './weather/planTime'
import { initLogLayer } from './log/logLayer'
import LogCard, { useLogForm } from './ui/LogCard'
import ViewPill from './ui/ViewPill'
import { initDepthLayer } from './map/depthLayer'
import { initTilePrefetch } from './map/prefetch'
import { initSpotsLayer } from './spots/spotsLayer'
import { initAreaArrival } from './areas/arrive'
import AreaLook from './ui/AreaLook'
import { initStatsWatch } from './stats/watch'
import BoxCard from './explore/BoxCard'
import { startAskChecks } from './explore/requests'
import { startAccountSync } from './account/sync'
import { takeLoadedNow } from './areas/load'
import { useExplore } from './explore/store'
import { toast } from './ui/Toast'
import WhereTo from './explore/WhereTo'
import DevBadge from './ui/DevBadge'

/** What has gone wrong (offline with maps missing, no location), and with
 *  the map turned the way you face, the heading: the way that is up. */
function TopBar() {
  const online = useAppStore((s) => s.online)
  const offlineReady = useAppStore((s) => s.offlineReady)
  const gpsStatus = useGpsStore((s) => s.status)
  const gpsError = useGpsStore((s) => s.lastError)
  const devMode = useAppStore((s) => s.devMode)
  const headingUp = useGpsStore((s) => s.headingUp)
  // whole degrees: the compass reads many times a second, the chip redraws when the degree changes
  const heading = useCompass((s) => (s.heading == null ? null : Math.round(s.heading) % 360))
  const steady = useCompass((s) => s.steady)
  const updateReady = useAppUpdate((s) => s.ready)
  return (
    <div className="topbar">
      {updateReady && (
        <button className="chip chip-ok" onClick={reloadApp}>
          New version ready · Reload
        </button>
      )}
      {headingUp && heading != null && (
        <span className={`chip chip-heading${steady ? '' : ' chip-dim'}`}>
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <path d="M5 0.5 L9 9.5 L5 7.5 L1 9.5 Z" fill="currentColor" />
          </svg>
          {compass(heading)} · {heading}°
        </span>
      )}
      {/* another area: the view in its box waiting on a download, or the fix in it while the map is looked at elsewhere (offered, never switched on a fix alone) */}
      <AreaLook />
      {/* offline with every map saved is the normal state at camp: nothing to say */}
      {!online && !offlineReady && <span className="chip chip-warn">Offline · some maps not saved</span>}
      {gpsStatus === 'denied' && <span className="chip chip-warn">Location denied</span>}
      {/* the rest says nothing a hunter can act on (Gavan, 2026-10-19): dev mode's, and the dev log's (tracking/gpsLog.ts) */}
      {devMode && gpsStatus === 'insecure' && <span className="chip chip-warn">No location over plain http</span>}
      {devMode && gpsStatus === 'error' && <span className="chip chip-warn">{gpsError ? `No GPS fix · ${gpsError}` : 'No GPS fix'}</span>}
    </div>
  )
}

/**
 * One screen. Read at the top: the strip, then the live card or a top card
 * in its slot. Touch at the bottom: the far column's buttons over the view
 * pill on one side, the near column (your high-use buttons and My location)
 * under the thumb on the other, mirrored for a left hand, and the bottom bar
 * for whichever tool or form is up. A sheet or a tall form takes the
 * columns away; a top card never does.
 */
export default function App() {
  const setOnline = useAppStore((s) => s.setOnline)
  const leftHanded = useAppStore((s) => s.leftHanded)
  const sheetOpen = useAppStore((s) => s.sheets.length > 0)
  const sheetFull = useAppStore((s) => s.sheetFull)
  const topCard = useAppStore((s) => s.topCard != null)
  const viewMenuOpen = useAppStore((s) => s.viewMenuOpen)
  // the tool with the map's taps and the bar (ui/tools.ts): the ruler, a path being drawn,
  // the route card, or the bush-label tool (a link with ?label=bush)
  const tool = useTool()
  const logging = useLogForm((s) => s.at != null)
  const hearing = useHeardForm((s) => s.open)
  const checking = useCheckForm((s) => s.at != null)
  const EXPLORE = useAppStore((s) => s.exploreMode)
  // a spot being placed to load (explore/BoxCard.tsx): the map and the box, the buttons away (Gavan, 2026-10-20:
  // "hide everything that's non essential to let the user select what they want to see")
  const placing = useExplore((s) => !!s.selected && !s.selected.extend && s.selected.purpose !== 'hd')
  const barRef = useRef<HTMLDivElement>(null)
  const topRef = useRef<HTMLDivElement>(null)
  // a tall form in the bar (a moose heard, a wind check, an entry) would
  // ride the columns up over the strip and the live card: they wait for it
  const formUp = logging || hearing || checking

  // --barh: what the columns sit above; --toph: the strip and the cards at the top,
  // what a button's drawer must stay under (ui.css .hotdrawer); both published for the CSS
  useEffect(() => {
    const bar = barRef.current
    const top = topRef.current
    if (!bar || !top) return
    const ro = new ResizeObserver(() => {
      document.documentElement.style.setProperty('--barh', `${Math.round(bar.offsetHeight)}px`)
      document.documentElement.style.setProperty('--toph', `${Math.round(top.offsetHeight)}px`)
    })
    ro.observe(bar)
    ro.observe(top)
    return () => ro.disconnect()
  }, [])

  // a sheet over the map: nothing waits for a map tap any more
  useEffect(() => {
    if (sheetOpen) releaseArmed()
  }, [sheetOpen])

  // a tool taking the map's taps the same: Game pressed and then the ruler opened stayed
  // armed under it and fired on the first tap after Done
  useEffect(() => {
    if (tool) releaseArmed()
  }, [tool])

  useEffect(() => {
    // the grids and the weather first: nothing of the first view waits for the map
    warmStart()
    initTheme()
    initTextScale()
    initPathLayer()
    initBushLabels()
    initWindFlow()
    initScentLayer()
    // how this phone's asks for HD are getting on (the Locations sheet)
    startAskChecks()
    // signed in: this phone's locations and the account's merged (account/sync.ts)
    startAccountSync()
    // arrived by a Load: the name it was given and where to change it, a moment longer than a toast
    const loaded = takeLoadedNow()
    if (loaded) window.setTimeout(() => toast(`Loaded ${loaded} · rename it in Locations`, 5000), 1500)
    initWeatherRefresh()
    initPositionLayer()
    initTrackRecording()
    initTrackLayer()
    initDepthLayer()
    initSpotsLayer()
    initTilePrefetch()
    initLogLayer()
    initCheckLayer()
    // a layer that comes on blends in, and the strip's hairline runs while its tiles load
    initLayerArrive()
    initTerrain3d()
    initPartyLayer()
    initMapUpdates()
    // the worker's install fetches the bundle again for its cache: after the
    // wind is up (its base bands in, a few seconds for the rest), not beside it
    const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms))
    initAppUpdate(Promise.race([loadMicro().then(() => wait(6000)), wait(25_000)]))
    initMoveLayer()
    initLive()
    initRoutes()
    initRouteLayer()
    // after the route layer, so the ruler draws over a kept route (measure/measureLayer.ts says so;
    // the layers go on the map in the order they are wired)
    initMeasureLayer()
    initPlanTime()
    // what an area switch asked for once the app is there: a pin, a place, an outing
    initAreaArrival()
    // what gets used: the sheets, layers, settings and tools, read off the stores
    initStatsWatch()
    // last: location comes back on if it was on at the last look, and recording with it
    resumeLocation()
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    document.getElementById('splash')?.classList.add('gone')
    setTimeout(() => document.getElementById('splash')?.remove(), 400)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [setOnline])

  return (
    <div className={`app${leftHanded ? ' app-lefty' : ''}`}>
      <MapView />
      {/* hidden, not taken away, under a full-screen sheet: the strip keeps its state and --toph its height */}
      <div className={`toparea${sheetFull ? ' toparea-hidden' : ''}`} ref={topRef} aria-hidden={sheetFull || undefined}>
        <TopBar />
        {/* sharpening the wind: the map and the rose, nothing else up top (Gavan, 2026-10-08) */}
        {!checking && <WeatherStrip />}
        {!EXPLORE && !checking && !placing && (topCard ? <TopCardHost /> : <LiveCard />)}
        {/* Explore: Where to and the cell card sit up here under the strip, so the pill and My location keep the foot (Gavan, 2026-10-08) */}
        {EXPLORE && <WhereTo />}
        <BoxCard />
      </div>
      {!sheetOpen && !formUp && !placing && (
        <div className="leftstack">
          {!viewMenuOpen && !EXPLORE && <HotColumn side="far" />}
          {tool !== 'measure' && tool !== 'path' && (
            <div className="leftfoot">
              <ViewPill />
            </div>
          )}
        </div>
      )}
      {!sheetOpen && !formUp && !placing && <ToolColumn />}
      {/* in 3D, which streaks are which height */}
      {!sheetOpen && !formUp && <WindKey />}
      <div className="bottombar" ref={barRef}>
        {/* the tool's card, else the form that is up: an entry, a moose heard, a wind check */}
        {tool === 'labels' && <BushLabelCard />}
        {tool === 'measure' && <MeasureCard />}
        {tool === 'path' && <PathCard />}
        {tool === 'routes' && <RouteCard />}
        {!tool && logging && <LogCard />}
        {!tool && !logging && hearing && <HeardCard />}
        {!tool && !logging && !hearing && checking && <WindCheckCard />}
      </div>
      <SheetHost />
      <DevBadge />
    </div>
  )
}
