import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import MapView from './map/MapView'
import { withMap } from './map/mapController'
import { useAppStore, type SheetTab } from './state/appStore'
import { useGpsStore } from './tracking/gpsStore'
import { locateAndFollow, startGps } from './tracking/gpsService'
import { initTextScale } from './ui/textScale'
import BottomSheet from './ui/BottomSheet'
import WeatherStrip from './ui/WeatherStrip'
import { IconCompass, IconLayers, IconLocate, IconPlaces, IconRuler, IconSliders, IconTarget, IconWind } from './ui/icons'
import MeasureCard from './ui/MeasureCard'
import { initMeasureLayer } from './measure/measureLayer'
import { useMeasureStore } from './measure/measureStore'
import { initWindFlow } from './weather/windFlow'
import { initWeatherRefresh } from './weather/refresh'
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
      {!online && <span className={`chip ${offlineReady ? 'chip-ok' : 'chip-warn'}`}>{offlineReady ? 'Offline · maps ready' : 'Offline · live layers only'}</span>}
      {gpsStatus === 'acquiring' && <span className="chip">Acquiring GPS…</span>}
      {gpsStatus === 'denied' && <span className="chip chip-warn">Location denied</span>}
      {gpsStatus === 'insecure' && <span className="chip chip-warn">No location over plain http</span>}
      {gpsStatus === 'error' && <span className="chip chip-warn">{gpsError ? `No GPS fix · ${gpsError}` : 'No GPS fix'}</span>}
    </div>
  )
}

function FabStack() {
  const follow = useAppStore((s) => s.follow)
  const measuring = useMeasureStore((s) => s.active)
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
      <button ref={compassBtn} className="fab" style={{ opacity: offNorth ? 1 : 0.55 }} onClick={() => withMap((m) => m.easeTo({ bearing: 0, pitch: 0 }))} aria-label="Reset north">
        <IconCompass />
      </button>
      <button className={`fab ${follow ? 'active' : ''}`} onClick={() => (follow ? useAppStore.getState().setFollow(false) : locateAndFollow())} aria-label={follow ? 'Stop following' : 'My position'}>
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
    initWeatherRefresh()
    initSpotsLayer()
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    // a fix is useful from the first second; the OS asks once
    startGps()
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
      <div className="bottombar" ref={barRef}>
        {measuring && <MeasureCard />}
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
