import { useEffect, useRef } from 'react'
import MapView from './map/MapView'
import './map/mapBearing' // keeps the rotate listener registered: the compass and the wind arrows read it
import { useAppStore } from './state/appStore'
import { useCompass } from './tracking/compass'
import { useGpsStore } from './tracking/gpsStore'
import { compass } from './weather/openMeteo'
import { initTextScale } from './ui/textScale'
import { initTheme } from './ui/theme'
import { releaseArmed } from './ui/tools'
import WeatherStrip from './ui/WeatherStrip'
import LiveCard from './ui/LiveCard'
import TopCardHost from './ui/TopCardHost'
import HotColumn from './ui/HotColumn'
import ToolColumn from './ui/ToolColumn'
import SheetHost from './ui/sheets/SheetHost'
import MeasureCard from './ui/MeasureCard'
import RouteCard from './ui/RouteCard'
import { initRoutes, useRoutes } from './routes/routeStore'
import { initRouteLayer } from './routes/routeLayer'
import { initScentLayer } from './weather/micro/scent'
import { initCheckLayer } from './weather/micro/checkLayer'
import { initPartyLayer } from './party/partyLayer'
import { initMapUpdates } from './offline/updates'
import { initAppUpdate, reloadApp, useAppUpdate } from './offline/appUpdate'
import { initLive } from './hunting/hunting'
import { initMoveLayer } from './hunting/moveLayer'
import HeardCard, { useHeardForm } from './ui/HeardCard'
import WindCheckCard, { useCheckForm } from './ui/WindCheckCard'
import { initMeasureLayer } from './measure/measureLayer'
import { useMeasureStore } from './measure/measureStore'
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
import { initSpotsLayer } from './spots/spotsLayer'
import { initAreaArrival } from './areas/arrive'
import AreaOffer from './ui/AreaOffer'
import { initStatsWatch } from './stats/watch'

/** What has gone wrong (offline with maps missing, no location), and with
 *  the map turned the way you face, the heading: the way that is up. */
function TopBar() {
  const online = useAppStore((s) => s.online)
  const offlineReady = useAppStore((s) => s.offlineReady)
  const gpsStatus = useGpsStore((s) => s.status)
  const gpsError = useGpsStore((s) => s.lastError)
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
      {/* the fix in another area's box: offered, never switched on a fix alone */}
      <AreaOffer />
      {/* offline with every map saved is the normal state at camp: nothing to say */}
      {!online && !offlineReady && <span className="chip chip-warn">Offline · some maps not saved</span>}
      {gpsStatus === 'denied' && <span className="chip chip-warn">Location denied</span>}
      {gpsStatus === 'insecure' && <span className="chip chip-warn">No location over plain http</span>}
      {gpsStatus === 'error' && <span className="chip chip-warn">{gpsError ? `No GPS fix · ${gpsError}` : 'No GPS fix'}</span>}
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
  const topCard = useAppStore((s) => s.topCard != null)
  const viewMenuOpen = useAppStore((s) => s.viewMenuOpen)
  const measuring = useMeasureStore((s) => s.active)
  const routing = useRoutes((s) => s.open)
  const logging = useLogForm((s) => s.at != null)
  const hearing = useHeardForm((s) => s.open)
  const checking = useCheckForm((s) => s.at != null)
  const barRef = useRef<HTMLDivElement>(null)
  // a tall form in the bar (a moose heard, a wind check, an entry) would
  // ride the columns up over the strip and the live card: they wait for it
  const formUp = logging || hearing || checking

  // --barh: what the columns sit above, published for the CSS
  useEffect(() => {
    const el = barRef.current
    if (!el) return
    const ro = new ResizeObserver(() => document.documentElement.style.setProperty('--barh', `${Math.round(el.offsetHeight)}px`))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // a sheet over the map: nothing waits for a map tap any more
  useEffect(() => {
    if (sheetOpen) releaseArmed()
  }, [sheetOpen])

  useEffect(() => {
    initTheme()
    initTextScale()
    initMeasureLayer()
    initWindFlow()
    initScentLayer()
    initWeatherRefresh()
    initPositionLayer()
    initTrackRecording()
    initTrackLayer()
    initDepthLayer()
    initSpotsLayer()
    initLogLayer()
    initCheckLayer()
    initPartyLayer()
    initMapUpdates()
    initAppUpdate()
    initMoveLayer()
    initLive()
    initRoutes()
    initRouteLayer()
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
      <div className="toparea">
        <TopBar />
        <WeatherStrip />
        {topCard ? <TopCardHost /> : <LiveCard />}
      </div>
      {!sheetOpen && !formUp && (
        <div className="leftstack">
          {!viewMenuOpen && <HotColumn side="far" />}
          {!measuring && (
            <div className="leftfoot">
              <ViewPill />
            </div>
          )}
        </div>
      )}
      {!sheetOpen && !formUp && <ToolColumn />}
      <div className="bottombar" ref={barRef}>
        {measuring && <MeasureCard />}
        {!measuring && routing && <RouteCard />}
        {!measuring && !routing && logging && <LogCard />}
        {!measuring && !routing && !logging && hearing && <HeardCard />}
        {!measuring && !routing && !logging && !hearing && checking && <WindCheckCard />}
      </div>
      <SheetHost />
    </div>
  )
}
