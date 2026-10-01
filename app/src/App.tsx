import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties, type ReactNode, type Ref } from 'react'
import MapView from './map/MapView'
import { withMap } from './map/mapController'
import { useAppStore, type SheetTab } from './state/appStore'
import { useGpsStore } from './tracking/gpsStore'
import { toggleLocate } from './tracking/gpsService'
import { initTextScale } from './ui/textScale'
import BottomSheet from './ui/BottomSheet'
import WeatherStrip from './ui/WeatherStrip'
import { IconCompass, IconEar, IconHeat, IconLayers, IconLocate, IconPlaces, IconPuff, IconRoute, IconRuler, IconScent, IconSliders, IconTarget, IconWind } from './ui/icons'
import MeasureCard from './ui/MeasureCard'
import RouteCard from './ui/RouteCard'
import { closeRoutes, initRoutes, openRoutes, useRoutes } from './routes/routeStore'
import { initRouteLayer } from './routes/routeLayer'
import GroundCard from './ui/GroundCard'
import { initScentLayer, useScent } from './weather/micro/scent'
import { initCheckLayer } from './weather/micro/checkLayer'
import { initMapUpdates, useMapUpdates } from './offline/updates'
import { initHunting, useHunting } from './hunting/hunting'
import { heardThisHunt, initMoveLayer } from './hunting/moveLayer'
import { useHuntLog } from './log/huntLog'
import { useSpotsStore } from './state/spotsStore'
import { useUsableFix } from './tracking/hereFix'
import { checkReachM, useWindChecks } from './weather/micro/windChecks'
import { useCheckForm } from './ui/WindCheckCard'
import { releaseTools } from './ui/tools'
import { haptic } from './ui/haptics'
import HeardCard, { useHeardForm } from './ui/HeardCard'
import { initMeasureLayer } from './measure/measureLayer'
import { useMeasureStore } from './measure/measureStore'
import { initWindFlow } from './weather/windFlow'
import { initWeatherRefresh } from './weather/refresh'
import { initPositionLayer } from './tracking/positionLayer'
import { initTrackLayer } from './tracking/trackLayer'
import { initTrackRecording } from './tracking/trackStore'
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
  const newMaps = useMapUpdates((s) => s.pending)
  const gpsStatus = useGpsStore((s) => s.status)
  const gpsError = useGpsStore((s) => s.lastError)
  return (
    <div className="topbar">
      {/* offline with every map saved is the normal state at camp: nothing to say */}
      {!online && !offlineReady && <span className="chip chip-warn">Offline · some maps not saved</span>}
      {/* a rebake on the server: said while there is a connection to fetch it, one tap to the downloads */}
      {online && newMaps.length > 0 && (
        <button
          className="chip chip-accent"
          onClick={() => {
            useAppStore.getState().setSheetTab('settings')
            useAppStore.getState().setSheetTall(true)
            let tries = 0
            const find = () => {
              const el = document.getElementById('maps-offline')
              if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
              else if (tries++ < 20) setTimeout(find, 100)
            }
            find()
          }}
        >
          New maps to download · {newMaps.length}
        </button>
      )}
      {gpsStatus === 'acquiring' && <span className="chip">Acquiring GPS…</span>}
      {gpsStatus === 'denied' && <span className="chip chip-warn">Location denied</span>}
      {gpsStatus === 'insecure' && <span className="chip chip-warn">No location over plain http</span>}
      {gpsStatus === 'error' && <span className="chip chip-warn">{gpsError ? `No GPS fix · ${gpsError}` : 'No GPS fix'}</span>}
    </div>
  )
}

/** FAB size and gap (theme.css .fab, ui.css .fabstack): one button's share of a column. */
const FAB_PITCH = 46 + 12

/** How many buttons fit in one column between the top strip and the bottom bar with its card. */
function useFabRoom(): number {
  const [room, setRoom] = useState(99)
  useEffect(() => {
    const top = document.querySelector('.toparea')
    const bar = document.querySelector('.bottombar')
    if (!top || !bar) return
    const measure = () => {
      const avail = bar.getBoundingClientRect().top - top.getBoundingClientRect().bottom - 24
      setRoom(Math.max(1, Math.floor((avail + 12) / FAB_PITCH)))
    }
    const ro = new ResizeObserver(measure)
    ro.observe(top)
    ro.observe(bar)
    window.addEventListener('resize', measure)
    measure()
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])
  return room
}

/** Held for this long, a button does its other thing (a long press). */
const LONG_MS = 450

/**
 * One hot button. A tap does the thing; a long press (where there is one)
 * opens what sits behind it, the card or the tab; a mark at the corner says
 * something is set behind it (people placed, a check in effect, a route
 * kept) while the card is away. The press cancels on a slide, so a drag
 * across the map that starts on a button is not a press.
 */
function Fab({
  icon,
  label,
  active,
  mark,
  onTap,
  onLong,
  className = '',
  style,
  btnRef,
}: {
  icon: ReactNode
  label: string
  active?: boolean
  mark?: boolean
  onTap: () => void
  onLong?: () => void
  className?: string
  style?: CSSProperties
  btnRef?: Ref<HTMLButtonElement>
}) {
  const timer = useRef<number | null>(null)
  const fired = useRef(false)
  const clear = () => {
    if (timer.current != null) window.clearTimeout(timer.current)
    timer.current = null
  }
  return (
    <button
      ref={btnRef}
      className={`fab${active ? ' active' : ''}${className ? ` ${className}` : ''}`}
      style={style}
      aria-pressed={active}
      aria-label={label}
      onPointerDown={() => {
        fired.current = false
        if (!onLong) return
        clear()
        timer.current = window.setTimeout(() => {
          fired.current = true
          haptic('confirm')
          onLong()
        }, LONG_MS)
      }}
      onPointerUp={clear}
      onPointerLeave={clear}
      onPointerCancel={clear}
      onContextMenu={(e) => e.preventDefault()}
      onClick={() => {
        // the long press has done its thing: the tap that ends it is not another
        if (fired.current) return void (fired.current = false)
        onTap()
      }}
    >
      {icon}
      {mark && <span className="fab-mark" />}
    </button>
  )
}

/**
 * The hot buttons, two columns above the dock. Right, top to bottom: Heard
 * (out hunting), Sharpen the wind, Scent, Wind flow, Compass, Location. Left,
 * above the view pill: Heat, Measure, Route. The two columns share the
 * same rows. A tab sheet covers them; a card that takes the map's tap
 * (measure, route, a check, a moose, a log entry) puts the left column
 * away and the right one steps out beside the card when it runs short of
 * room under the strip.
 */
function FabStack() {
  const follow = useAppStore((s) => s.follow)
  const sheetTab = useAppStore((s) => s.sheetTab)
  const locating = useGpsStore((s) => s.locating)
  const headingUp = useGpsStore((s) => s.headingUp)
  const measuring = useMeasureStore((s) => s.active)
  const routing = useRoutes((s) => s.open)
  const kept = useRoutes((s) => s.kept != null)
  const windOn = useAppStore((s) => s.layers.windFlow)
  const hunting = useHunting((s) => s.on)
  const people = useScent((s) => s.people.length)
  const hidden = useScent((s) => s.hidden)
  const card = useScent((s) => s.card)
  const placing = useScent((s) => s.adding || s.moving != null)
  const checking = useCheckForm((s) => s.at != null || s.arming)
  const hearing = useHeardForm((s) => s.open)
  const logging = useLogForm((s) => s.at != null)
  const checks = useWindChecks((s) => s.checks)
  const planMs = useAppStore((s) => s.planTimeMs)
  const heat = useSpotsStore((s) => s.heat)
  const entries = useHuntLog((s) => s.entries)
  const hereNow = useUsableFix()
  const [offNorth, setOffNorth] = useState(false)
  const compassBtn = useRef<HTMLButtonElement>(null)
  const room = useFabRoom()
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
  // a tab sheet covers the buttons
  if (sheetTab) return null
  const checksOn = checks.some((c) => checkReachM(c, planMs ?? Date.now()) > 0)
  const heard = hunting && entries.length > 0 && heardThisHunt().length > 0
  const tool = measuring || routing || checking || hearing || logging || placing
  const openTab = (t: SheetTab) => useAppStore.getState().setSheetTab(t)

  const right = [
    hunting && (
      <Fab
        key="heard"
        icon={<IconEar />}
        label={hearing ? 'Close' : 'Heard a moose'}
        active={hearing}
        mark={heard && !hearing}
        onTap={() => {
          if (hearing) return useHeardForm.getState().close()
          releaseTools('heard')
          useHeardForm.getState().show()
        }}
        onLong={() => openTab('places')}
      />
    ),
    <Fab
      key="check"
      icon={<IconPuff />}
      label={checking ? 'Close' : 'Sharpen the wind: log what the air really does here'}
      active={checking}
      mark={checksOn && !checking}
      onTap={() => {
        if (checking) return useCheckForm.getState().close()
        releaseTools('check')
        if (hereNow) useCheckForm.getState().open(hereNow.lon, hereNow.lat, 'where you stand')
        else useCheckForm.getState().arm()
      }}
      onLong={() => openTab('weather')}
    />,
    <Fab
      key="scent"
      icon={<IconScent />}
      label={people ? (hidden ? 'Show the scent cones' : 'Hide the scent cones') : 'Scent cone'}
      active={people > 0 && !hidden}
      mark={people > 0 && !card}
      onTap={() => {
        const sc = useScent.getState()
        if (sc.people.length) return sc.setHidden(!sc.hidden)
        releaseTools('scent')
        if (hereNow) sc.show(hereNow.lon, hereNow.lat)
        else {
          sc.setAdding(true)
          sc.setCard(true)
        }
      }}
      onLong={() => {
        const sc = useScent.getState()
        if (!sc.people.length) return
        sc.setCard(true)
        sc.setHidden(false)
      }}
    />,
    // the wind over the map, on and off from here in any view (hunting keeps the track itself)
    <Fab key="wind" icon={<IconWind />} label={windOn ? 'Hide the wind flow' : 'Show the wind flow'} active={windOn} onTap={() => useAppStore.getState().setLayer('windFlow', !windOn)} />,
    <Fab
      key="compass"
      btnRef={compassBtn}
      icon={<IconCompass />}
      label="Reset north"
      style={{ opacity: offNorth ? 1 : 0.55 }}
      onTap={() => {
        useGpsStore.getState().setHeadingUp(false)
        withMap((m) => m.easeTo({ bearing: 0, pitch: 0 }))
      }}
    />,
    <Fab
      key="locate"
      icon={<IconLocate />}
      label={!locating ? 'Show my position' : !follow ? 'Follow my position' : headingUp ? 'Turn location off' : 'Turn the map the way I face'}
      active={locating && follow}
      className={headingUp ? 'fab-heading' : ''}
      style={locating && !follow ? { opacity: 0.8, outline: '1.5px solid var(--c-accent)' } : undefined}
      onTap={toggleLocate}
    />,
  ].filter(Boolean)

  const left = [
    <Fab key="heat" icon={<IconHeat />} label={heat ? 'Hide the heat map' : 'Show the heat map'} active={heat} onTap={() => useSpotsStore.getState().setHeat(!heat)} onLong={() => openTab('spots')} />,
    <Fab
      key="measure"
      icon={<IconRuler />}
      label="Measure distance"
      active={measuring}
      onTap={() => {
        if (measuring) return useMeasureStore.getState().stop()
        releaseTools('measure')
        useMeasureStore.getState().start()
      }}
    />,
    // the three best ways to a place on foot
    <Fab
      key="route"
      icon={<IconRoute />}
      label={routing ? 'Close routes' : 'Routes: the best ways there on foot'}
      active={routing}
      mark={kept && !routing}
      onTap={() => {
        if (routing) return closeRoutes()
        releaseTools('route')
        openRoutes()
      }}
    />,
  ]
  // a card up leaves less room than the right column needs: the top ones step out to a column
  // beside it rather than run up under the weather strip
  const split = Math.max(0, right.length - room)
  return (
    <>
      <div className="fabstack">
        {split > 0 && <div className="fabcol">{right.slice(0, split)}</div>}
        <div className="fabcol">{right.slice(split)}</div>
      </div>
      {!tool && (
        <div className="fabstack fabstack-left">
          <div className="fabcol">{left}</div>
        </div>
      )}
    </>
  )
}

export default function App() {
  const sheetTab = useAppStore((s) => s.sheetTab)
  const setSheetTab = useAppStore((s) => s.setSheetTab)
  const setOnline = useAppStore((s) => s.setOnline)
  const measuring = useMeasureStore((s) => s.active)
  const routing = useRoutes((s) => s.open)
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
    initCheckLayer()
    initMapUpdates()
    initMoveLayer()
    initHunting()
    initRoutes()
    initRouteLayer()
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
        {!measuring && routing && <RouteCard />}
        {!measuring && !routing && logging && <LogCard />}
        {!measuring && !routing && !logging && hearing && <HeardCard />}
        {!measuring && !routing && !logging && !hearing && <GroundCard />}
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
