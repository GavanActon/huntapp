import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import MapView from './map/MapView'
import { withMap } from './map/mapController'
import { useAppStore, type SheetTab } from './state/appStore'
import { useGpsStore } from './tracking/gpsStore'
import { afterRecording, startGps, toggleLocate } from './tracking/gpsService'
import { initTextScale } from './ui/textScale'
import BottomSheet from './ui/BottomSheet'
import WeatherStrip from './ui/WeatherStrip'
import { IconCompass, IconEar, IconLayers, IconLocate, IconPlaces, IconRuler, IconScent, IconSliders, IconTarget, IconWind } from './ui/icons'
import MeasureCard from './ui/MeasureCard'
import GroundCard from './ui/GroundCard'
import { initScentLayer, useScent } from './weather/micro/scent'
import { initHunting, useHunting } from './hunting/hunting'
import { initMoveLayer } from './hunting/moveLayer'
import HeardCard, { useHeardForm } from './ui/HeardCard'
import { initMeasureLayer } from './measure/measureLayer'
import { useMeasureStore } from './measure/measureStore'
import { initWindFlow } from './weather/windFlow'
import { initWeatherRefresh } from './weather/refresh'
import { initPositionLayer } from './tracking/positionLayer'
import { initTrackLayer } from './tracking/trackLayer'
import { initTrackRecording, useTrackStore } from './tracking/trackStore'
import { initLogLayer } from './log/logLayer'
import LogCard, { useLogForm } from './ui/LogCard'
import ViewPill from './ui/ViewPill'
import { initDepthLayer } from './map/depthLayer'
import { initSpotsLayer } from './spots/spotsLayer'

const LayersPanel = lazy(() => import('./ui/panels/LayersPanel'))
const PlacesPanel = lazy(() => import('./ui/panels/PlacesPanel'))
const SpotsPanel = lazy(() => import('./ui/panels/SpotsPanel'))
const WeatherPanel = lazy(() => import('./ui/panels/WeatherPanel'))
const SettingsPanel = lazy(() => import('./ui/panels/SettingsPanel'))

// Five doors, the boat app's shape plus one: where · where to be · what's drawn · conditions · the knobs
const TABS: { id: SheetTab; name: string; icon: typeof IconLayers }[] = [
  { id: 'places', name: 'Places', icon: IconPlaces },
  { id: 'spots', name: 'Spots', icon: IconTarget },
  { id: 'layers', name: 'Layers', icon: IconLayers },
  { id: 'weather', name: 'Weather', icon: IconWind },
  { id: 'settings', name: 'Settings', icon: IconSliders },
]

function TopBar() {
  const online = useAppStore((s) => s.online)
  const offlineReady = useAppStore((s) => s.offlineReady)
  const gpsStatus = useGpsStore((s) => s.status)
  const gpsError = useGpsStore((s) => s.lastError)
  return (
    <div className="topbar">
      {/* offline with every map saved is the normal state at camp: nothing to say */}
      {!online && !offlineReady && <span className="chip chip-warn">Offline · some maps not saved</span>}
      {gpsStatus === 'acquiring' && <span className="chip">Acquiring GPS…</span>}
      {gpsStatus === 'denied' && <span className="chip chip-warn">Location denied</span>}
      {gpsStatus === 'insecure' && <span className="chip chip-warn">No location over plain http</span>}
      {gpsStatus === 'error' && <span className="chip chip-warn">{gpsError ? `No GPS fix · ${gpsError}` : 'No GPS fix'}</span>}
    </div>
  )
}

function FabStack() {
  const follow = useAppStore((s) => s.follow)
  const locating = useGpsStore((s) => s.locating)
  const headingUp = useGpsStore((s) => s.headingUp)
  const measuring = useMeasureStore((s) => s.active)
  const recording = useTrackStore((s) => s.recordingId != null)
  const hunting = useHunting((s) => s.on)
  const coneOn = useScent((s) => s.people.some((p) => p.live))
  const coneWanted = useHunting((s) => s.cone)
  const [offNorth, setOffNorth] = useState(false)
  const compassBtn = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    withMap((map) => {
      const apply = () => {
        const b = map.getBearing()
        const svg = compassBtn.current?.querySelector('svg')
        if (svg) svg.style.transform = `rotate(${-b}deg)`
        setOffNorth(Math.abs(b) > 0.5)
      }
      map.on('rotate', apply)
      apply()
    })
  }, [])
  return (
    <div className="fabstack">
      {hunting && (
        <>
          {/* out hunting: your scent cone, on until this hides it, and a moose heard */}
          <button
            className={`fab ${coneWanted ? 'active' : ''}`}
            onClick={() => useHunting.getState().setCone(!coneWanted)}
            aria-pressed={coneWanted}
            aria-label={coneWanted ? 'Hide your scent cone' : 'Show your scent cone'}
            style={coneWanted && !coneOn ? { opacity: 0.7 } : undefined}
          >
            <IconScent />
          </button>
          <button className="fab" onClick={() => useHeardForm.getState().show()} aria-label="Heard a moose">
            <IconEar />
          </button>
        </>
      )}
      <button
        className={`fab ${measuring ? 'active' : ''}`}
        onClick={() => {
          if (measuring) return useMeasureStore.getState().stop()
          useAppStore.getState().setSheetTab(null)
          useMeasureStore.getState().start()
        }}
        aria-label="Measure distance"
      >
        <IconRuler />
      </button>
      <button
        ref={compassBtn}
        className="fab"
        style={{ opacity: offNorth ? 1 : 0.55 }}
        onClick={() => {
          useGpsStore.getState().setHeadingUp(false)
          withMap((m) => m.easeTo({ bearing: 0, pitch: 0 }))
        }}
        aria-label="Reset north"
      >
        <IconCompass />
      </button>
      {!hunting && (
        <button
          className={`fab fab-rec ${recording ? 'active' : ''}`}
          onClick={() => {
            if (recording) {
              useTrackStore.getState().stop()
              return afterRecording()
            }
            startGps()
            useTrackStore.getState().start()
          }}
          aria-label={recording ? 'Stop recording the track' : 'Record a track'}
        >
          <span className={`rec-dot${recording ? ' on' : ''}`} />
        </button>
      )}
      <button
        className={`fab ${locating && follow ? 'active' : ''}${headingUp ? ' fab-heading' : ''}`}
        style={locating && !follow ? { opacity: 0.8, outline: '1.5px solid var(--c-accent)' } : undefined}
        onClick={toggleLocate}
        aria-label={!locating ? 'Show my position' : !follow ? 'Follow my position' : headingUp ? 'Turn location off' : 'Turn the map the way I face'}
      >
        <IconLocate />
      </button>
    </div>
  )
}

export default function App() {
  const sheetTab = useAppStore((s) => s.sheetTab)
  const setSheetTab = useAppStore((s) => s.setSheetTab)
  const setOnline = useAppStore((s) => s.setOnline)
  const measuring = useMeasureStore((s) => s.active)
  const logging = useLogForm((s) => s.at != null)
  const hearing = useHeardForm((s) => s.open)
  const barRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = barRef.current
    if (!el) return
    const ro = new ResizeObserver(() => document.documentElement.style.setProperty('--barh', `${Math.round(el.offsetHeight)}px`))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
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
    initMoveLayer()
    initHunting()
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

  const title = TABS.find((t) => t.id === sheetTab)?.name ?? ''

  return (
    <div className="app">
      <MapView />
      <div className="toparea">
        <TopBar />
        <WeatherStrip />
      </div>
      <FabStack />
      {!measuring && <ViewPill />}
      <div className="bottombar" ref={barRef}>
        {measuring && <MeasureCard />}
        {!measuring && logging && <LogCard />}
        {!measuring && !logging && hearing && <HeardCard />}
        {!measuring && !logging && !hearing && <GroundCard />}
        <nav className="tabdock glass">
          {TABS.map((t) => {
            const Icon = t.icon
            const on = sheetTab === t.id
            return (
              <button key={t.id} className={`tab${on ? ' tab-on' : ''}`} onClick={() => setSheetTab(on ? null : t.id)} aria-pressed={on}>
                <Icon size={20} />
                <span>{t.name}</span>
              </button>
            )
          })}
        </nav>
      </div>
      {sheetTab && (
        <BottomSheet title={title} halfPct={sheetTab === 'places' ? 42 : sheetTab === 'spots' ? 60 : 52}>
          <Suspense fallback={<div className="empty">…</div>}>
            {sheetTab === 'places' && <PlacesPanel />}
            {sheetTab === 'spots' && <SpotsPanel />}
            {sheetTab === 'layers' && <LayersPanel />}
            {sheetTab === 'weather' && <WeatherPanel />}
            {sheetTab === 'settings' && <SettingsPanel />}
          </Suspense>
        </BottomSheet>
      )}
    </div>
  )
}
