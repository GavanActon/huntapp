import maplibregl from 'maplibre-gl'
import { useEffect, useRef, useState } from 'react'
import { devlog } from '../devlog'
import { BASE_GEO, baseGeoFile, DATA_BASE, DATA_FILES, GEO_THEMES, geoFile, HOME, MAX_BOUNDS } from '../config'
import { getStoredFile } from '../offline/fileStore'
import { useAppStore, type LayerOpacity, type LayerVisibility } from '../state/appStore'
import { placeColour } from '../state/pinColours'
import { usePlacesStore } from '../state/placesStore'
import { geoUrls, onFirstIdle, setMap, withMap } from './mapController'
import { useMeasureStore } from '../measure/measureStore'
import { explainPoint } from '../spots/scoring'
import { spotGrade, spotGradeWords } from '../spots/grades'
import { useSpotsStore } from '../state/spotsStore'
import { TARGET_NAMES } from '../spots/types'
import { baseTone, buildMapStyle, CONTOUR_INK, contourFilters, flushDeferredGeo, groundColour } from './mapStyle'
import { offlineComplete, registerAllDataFiles, sourceModes } from './pmtilesRegistry'
import { attachTapWeather } from './tapWeather'
import { closeOnTapOff } from './tapPopup'
import { DROPPED_NAME, showPlacePopup } from './placePopup'
import { useScent } from '../weather/micro/scent'
import { useRoutes } from '../routes/routeStore'
import { useHeardForm } from '../ui/HeardCard'
import { useCheckForm } from '../ui/WindCheckCard'
import { showLogPopup } from '../log/logLayer'
import { useHuntLog } from '../log/huntLog'

import type { FeatureCollection } from 'geojson'
import 'maplibre-gl/dist/maplibre-gl.css'
// the tap popup's score circle (the rest of the popup is in ui.css)
import '../ui/sheets/digin.css'

const VIEW_KEY = 'huntapp.lastView'

interface SavedView {
  center: [number, number]
  zoom: number
  bearing: number
}

function loadView(): SavedView | null {
  try {
    const raw = localStorage.getItem(VIEW_KEY)
    return raw ? (JSON.parse(raw) as SavedView) : null
  } catch {
    return null
  }
}


/** The pins' three layers, shown or hidden together (the strip's toggle). */
const PIN_LAYERS = ['pins-halo', 'pins-pt', 'pins-label']
function applyPins(m: maplibregl.Map, on: boolean) {
  for (const id of PIN_LAYERS) if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none')
}

function placesGeoJson(): FeatureCollection {
  const s = usePlacesStore.getState()
  return {
    type: 'FeatureCollection',
    features: s.places.map((p) => ({
      type: 'Feature',
      id: p.id,
      geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
      properties: { id: p.id, name: p.name, kind: p.kind, color: placeColour(p), selected: p.id === s.selectedId },
    })),
  }
}

/** Where each baked vector theme can be read from: the phone's copy as a
 *  blob URL, else the server's file, else nothing (the style falls back to
 *  the live query). */
export const geoModes = new Map<string, 'local' | 'network'>()

async function resolveGeo(): Promise<Map<string, string>> {
  const geo = new Map<string, string>()
  geoModes.clear()
  const themes = [...GEO_THEMES.map((t) => [t, geoFile(t)] as const), ...BASE_GEO.map((t) => [t, baseGeoFile(t)] as const)]
  await Promise.all(
    themes.map(async ([t, file]) => {
      const blob = await getStoredFile(file)
      if (blob) {
        geoModes.set(t, 'local')
        return void geo.set(t, URL.createObjectURL(blob))
      }
      if (!navigator.onLine) return
      try {
        // the dev server answers every path with index.html: only JSON counts
        const r = await fetch(DATA_BASE + file, { method: 'HEAD' })
        if (r.ok && /json/i.test(r.headers.get('content-type') ?? '')) {
          geoModes.set(t, 'network')
          geo.set(t, DATA_BASE + file)
        }
      } catch {
        /* not baked */
      }
    }),
  )
  return geo
}

/** "51.47312, -90.18844": lat, lon to five places, for Copy coordinates. */
export function fmtCoord(lon: number, lat: number): string {
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`
}

export default function MapView() {
  const containerRef = useRef<HTMLDivElement>(null)
  const [noGl, setNoGl] = useState(false)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    let map: maplibregl.Map | null = null
    let cancelled = false

    void (async () => {
      const [available, geo] = await Promise.all([registerAllDataFiles(), resolveGeo()])
      if (cancelled) return
      geoUrls.clear()
      for (const [k, v] of geo) geoUrls.set(k, v)
      const missing = DATA_FILES.filter((d) => sourceModes.get(d.key) === 'missing').map((d) => d.label)
      useAppStore.getState().setMissingData(missing)
      useAppStore.getState().setOfflineReady(offlineComplete())
      devlog('map', `sources · ${[...sourceModes].map(([k, m]) => `${k}:${m}`).join(' ')} · geo ${[...geo.keys()].join(',') || 'none'}`)

      const { layers, opacity, contourInterval } = useAppStore.getState()
      const style = buildMapStyle({ base: import.meta.env.BASE_URL, layers, opacity, contourInterval, available, geo })
      const saved = loadView()

      try {
        map = new maplibregl.Map({
          container: el,
          style,
          center: saved?.center ?? HOME.center,
          zoom: saved?.zoom ?? HOME.zoom,
          bearing: saved?.bearing ?? 0,
          maxBounds: MAX_BOUNDS,
          minZoom: 7,
          maxZoom: 18,
          // a tap whose finger drifts a little is still a tap (the default 3 px loses thumbs)
          clickTolerance: 6,
          // the credits are under Settings → Map credits, off the map
          attributionControl: false,
          pitchWithRotate: false,
        })
      } catch {
        setNoGl(true)
        return
      }
      const m = map
      if (import.meta.env.DEV) (window as unknown as { __map?: unknown }).__map = m

      // the controller hands the map to the layer modules once the style is
      // parsed ('style.load'), not 'load': a live tile source that never
      // finishes would otherwise hold every layer back
      setMap(m)
      // the GeoJSON of the layers that are off waits for the first settled frame
      onFirstIdle(m, () => flushDeferredGeo(m))
      withMap((map) => {
        if (map !== m || m.getSource('pins')) return
        // saved / preset places ride on top of everything. The source is
        // 'pins': 'places' is the baked archive's (camps, WMUs, roads), and
        // sharing its name left the pins unadded and every drop throwing.
        m.addSource('pins', { type: 'geojson', data: placesGeoJson() })
        m.addLayer({
          id: 'pins-halo',
          type: 'circle',
          source: 'pins',
          filter: ['==', ['get', 'selected'], true],
          paint: { 'circle-radius': 12, 'circle-color': 'rgba(63,200,255,0.25)' },
        })
        m.addLayer({
          id: 'pins-pt',
          type: 'circle',
          source: 'pins',
          paint: { 'circle-radius': 6, 'circle-color': ['get', 'color'], 'circle-stroke-color': '#0f1a12', 'circle-stroke-width': 2 },
        })
        m.addLayer({
          id: 'pins-label',
          type: 'symbol',
          source: 'pins',
          layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Medium'], 'text-size': 12, 'text-offset': [0, 1.1], 'text-anchor': 'top' },
          paint: { 'text-color': '#eef5ea', 'text-halo-color': 'rgba(10,20,12,0.95)', 'text-halo-width': 1.4 },
        })
        applyPins(m, useAppStore.getState().showPins)
      })

      m.on('moveend', () => {
        const c = m.getCenter()
        try {
          localStorage.setItem(VIEW_KEY, JSON.stringify({ center: [c.lng, c.lat], zoom: m.getZoom(), bearing: m.getBearing() }))
        } catch {
          /* ignore */
        }
      })
      m.on('dragstart', () => useAppStore.getState().setFollow(false))

      // tap a place: your own pin says what it is, with Delete (placePopup);
      // the camp and the lakes are presets and open Dig in on themselves.
      // Tap the map: a three-line popup, Dig in behind it. A double tap
      // zooms (MapLibre's own, 500 ms and 30 px), so the popup waits
      // TAP_WAIT_MS for a second tap before it opens, and a zoom starting
      // under the finger cancels it. A brush of the screen is not a tap: two
      // fingers, a palm-sized contact, a press longer than a tap, or a touch
      // right after a pan or a pinch all pass (Gavan's dad, 2026-10-02). The
      // armed tools above still take their one tap, at once.
      const TAP_WAIT_MS = 350
      const PRESS_MS = 350
      const PALM_PX = 22
      const SETTLE_MS = 400
      type TouchGesture = { downAt: number; multi: boolean; palm: boolean }
      let touching: TouchGesture | null = null
      let lastTouch: (TouchGesture & { upAt: number }) | null = null
      let movedAt = 0
      let tapTimer = 0
      let lastTapAt = 0
      m.on('touchstart', (e) => {
        const ts = e.originalEvent.touches
        if (!touching) touching = { downAt: performance.now(), multi: false, palm: false }
        if (ts.length > 1) touching.multi = true
        for (const t of Array.from(ts)) if (Math.max(t.radiusX || 0, t.radiusY || 0) > PALM_PX) touching.palm = true
      })
      m.on('touchend', (e) => {
        if (e.originalEvent.touches.length || !touching) return
        lastTouch = { ...touching, upAt: performance.now() }
        touching = null
      })
      m.on('touchcancel', () => (touching = null))
      for (const ev of ['dragend', 'zoomend', 'rotateend', 'pitchend'] as const)
        m.on(ev, (e) => {
          if (e.originalEvent) movedAt = performance.now()
        })
      // a zoom starting under the finger is the double tap: nothing opens
      m.on('zoomstart', (e) => {
        if (e.originalEvent) {
          window.clearTimeout(tapTimer)
          tapTimer = 0
        }
      })
      /** A tap meant as one: not a brush, not a palm, not a press, not the tail of a pan. */
      const deliberate = (now: number) => {
        if (now - movedAt < SETTLE_MS) return false
        const t = lastTouch
        // a mouse click has no touch of its own; a touch's click follows its touchend within a moment
        if (!t || now - t.upAt > 700) return true
        return !t.multi && !t.palm && t.upAt - t.downAt <= PRESS_MS
      }
      const tapped = (lngLat: maplibregl.LngLat) => {
        const now = performance.now()
        if (!deliberate(now)) return
        window.clearTimeout(tapTimer)
        tapTimer = 0
        // the second tap of a double: the map zooms, nothing opens
        if (now - lastTapAt < TAP_WAIT_MS) {
          lastTapAt = 0
          return
        }
        lastTapAt = now
        tapTimer = window.setTimeout(() => openInfo(lngLat), TAP_WAIT_MS)
      }
      m.on('click', 'pins-pt', (e) => {
        // the ruler, a person being placed and the route card each own the tap
        if (useMeasureStore.getState().active || useScent.getState().adding || useRoutes.getState().open) return
        const id = e.features?.[0]?.properties?.id as string | undefined
        const p = id ? usePlacesStore.getState().places.find((q) => q.id === id) : undefined
        if (!p) return
        if (p.savedAt > 0) return showPlacePopup(m, p)
        // a preset: never selected (the heat and the strip stay where they are)
        useAppStore.getState().openSheet({ kind: 'digin', lon: p.lon, lat: p.lat })
      })
      m.on('click', (e) => {
        if (useMeasureStore.getState().active) return // the ruler owns the tap
        if (useRoutes.getState().open) return // so does the route card (routes/routeLayer)
        const scent = useScent.getState()
        // placing another person: the tap is where they sit
        if (scent.adding) return scent.add(e.lngLat.lng, e.lngLat.lat)
        // Heard pressed: the tap is where it was; what it was comes next
        if (useHeardForm.getState().placing) return useHeardForm.getState().show({ lon: e.lngLat.lng, lat: e.lngLat.lat })
        // "ahead" armed on the wind check: the tap is what is in front of you
        const cf = useCheckForm.getState()
        if (cf.at && cf.aim) return cf.mapTap(e.lngLat.lng, e.lngLat.lat)
        // a place, a numbered pin, a wind check or a kept route has its own tap
        const hit = m.queryRenderedFeatures(e.point, { layers: ['pins-pt', 'spots-pin', 'windchecks-hit', 'routes-hit', 'huntlog-dot'].filter((id) => m.getLayer(id)) })
        if (hit.length) return
        tapped(e.lngLat)
      })
      /** The info popup at a point: the weather there, the score while the heat is on, then the actions. */
      const openInfo = (lngLat: maplibregl.LngLat) => {
        const { lng, lat } = lngLat
        const el = document.createElement('div')
        // one glance: the weather there, the game score, then Scent, Pin and
        // Dig in. Everything else is the sheet's.
        const sp = useSpotsStore.getState()
        // the score only while the heat map is on: with it off the tap is about the weather; Dig in has the whole case either way
        const why = sp.heat && sp.conditions ? explainPoint(sp.target, lng, lat, sp.conditions, sp.weights) : null
        const esc = (t: string) => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] ?? c)
        const gameHtml = why
          ? `<div class="pp-game"><b class="pp-score pp-${spotGrade(why.score)}">${Math.round(why.score * 100)}</b><span>${esc(TARGET_NAMES[sp.target])} · ${esc(spotGradeWords(sp.target, why.score))}</span></div>`
          : ''
        const sitting = useScent.getState().people.length > 0
        el.innerHTML = `<div class="depth-popup-wx"></div>${gameHtml}<div class="pp-acts"><button class="pp-scent">${sitting ? '+ Person' : 'Scent'}</button><button class="pp-heard">Heard</button><button class="pp-save">Pin</button><button class="pp-digin">Dig in ›</button></div>`
        const popup = new maplibregl.Popup({ className: 'depth-popup', closeButton: false, closeOnClick: false, offset: 8, maxWidth: '260px' })
          .setLngLat([lng, lat])
          .setDOMContent(el)
          .addTo(m)
        // no ×: tap again, anywhere off it, and it goes
        closeOnTapOff(m, popup)
        // wind, temperature and sky at the planning time
        const stopWx = attachTapWeather(el.querySelector('.depth-popup-wx') as HTMLElement, lng, lat)
        popup.on('close', stopWx)
        // with people already sitting, Scent adds the next one here
        el.querySelector('.pp-scent')?.addEventListener('click', () => {
          const sc = useScent.getState()
          if (sc.people.length) sc.add(lng, lat)
          else sc.show(lng, lat)
          popup.remove()
        })
        // a pin: its own popup takes over, the name and colour right there
        el.querySelector('.pp-save')?.addEventListener('click', () => {
          const sp = usePlacesStore.getState().add({ name: DROPPED_NAME, lon: lng, lat, kind: 'stand' })
          popup.remove()
          showPlacePopup(m, sp)
        })
        el.querySelector('.pp-digin')?.addEventListener('click', () => {
          popup.remove()
          useAppStore.getState().openSheet({ kind: 'digin', lon: lng, lat })
        })
        // a moose heard, placed here rather than from where you stand
        el.querySelector('.pp-heard')?.addEventListener('click', () => {
          popup.remove()
          useHeardForm.getState().show({ lon: lng, lat })
        })
      }
      // a log entry (a moose heard, a sighting): what and when, Delete, and press-and-hold to move it
      m.on('click', 'huntlog-dot', (e) => {
        if (useMeasureStore.getState().active || useScent.getState().adding || useRoutes.getState().open) return
        const id = e.features?.[0]?.properties?.id as string | undefined
        const entry = id ? useHuntLog.getState().entries.find((x) => x.id === id) : undefined
        if (entry) showLogPopup(m, entry)
      })
      m.on('mouseenter', 'pins-pt', () => (m.getCanvas().style.cursor = 'pointer'))
      m.on('mouseleave', 'pins-pt', () => (m.getCanvas().style.cursor = ''))
      m.on('webglcontextlost', () => devlog('map', 'webgl context lost'))
      m.on('error', (e) => devlog('map', `error · ${(e as { error?: Error }).error?.message ?? String(e)}`))
    })()

    // the sheet's switches: visibility by metadata.group, opacity by key
    const unsubLayers = useAppStore.subscribe((s, prev) => {
      if (!map || (s.layers === prev.layers && s.opacity === prev.opacity && s.saturation === prev.saturation)) return
      applyLayerState(map, s.layers, s.opacity, s.saturation)
    })
    const unsubPins = useAppStore.subscribe((s, prev) => {
      if (map && s.showPins !== prev.showPins) applyPins(map, s.showPins)
    })
    // the contour interval is a filter on the three contour layers
    const unsubContours = useAppStore.subscribe((s, prev) => {
      if (!map || s.contourInterval === prev.contourInterval || !map.getLayer('contour-line')) return
      const [keep, index, labelled] = contourFilters(s.contourInterval)
      map.setFilter('contour-line', keep)
      map.setFilter('contour-index', index)
      map.setFilter('contour-label', labelled)
    })
    const unsubPlaces = usePlacesStore.subscribe(() => {
      const src = map?.getSource('pins')
      if (src && 'setData' in src) (src as maplibregl.GeoJSONSource).setData(placesGeoJson())
    })

    return () => {
      cancelled = true
      unsubLayers()
      unsubPins()
      unsubContours()
      unsubPlaces()
      setMap(null)
      map?.remove()
    }
  }, [])

  if (noGl) return <div className="map-nogl">This browser has no WebGL. The map cannot draw.</div>
  // inline: maplibre-gl.css loads after ui.css and would reset the container
  return <div ref={containerRef} className="map-root" style={{ position: 'absolute', inset: 0 }} />
}

/** The saturation a raster is shot at, before the slider: the imagery and the old sheets are toned down. */
const BASE_SATURATION: Partial<Record<keyof LayerOpacity, number>> = { satellite: -0.3, historical: -0.2 }

export function applyLayerState(map: maplibregl.Map, layers: LayerVisibility, opacity: LayerOpacity, saturation: Partial<Record<keyof LayerOpacity, number>> = {}) {
  if (!map.isStyleLoaded() && !map.getStyle()) return
  for (const l of map.getStyle().layers) {
    // the ground under everything follows the base the view puts on it
    if (l.type === 'background') map.setPaintProperty(l.id, 'background-color', groundColour(layers))
    const meta = (l as { metadata?: { group?: keyof LayerVisibility; opacityKey?: keyof LayerOpacity } }).metadata
    if (!meta?.group) continue
    const on = layers[meta.group]
    map.setLayoutProperty(l.id, 'visibility', on ? 'visible' : 'none')
    if (meta.opacityKey && l.type === 'raster') {
      map.setPaintProperty(l.id, 'raster-opacity', opacity[meta.opacityKey])
      const sat = saturation[meta.opacityKey]
      if (sat != null) map.setPaintProperty(l.id, 'raster-saturation', Math.max(-1, Math.min(1, sat)))
      else if (BASE_SATURATION[meta.opacityKey] != null || l.id === meta.opacityKey) map.setPaintProperty(l.id, 'raster-saturation', BASE_SATURATION[meta.opacityKey] ?? 0)
    }
    if (meta.opacityKey && l.type === 'color-relief') map.setPaintProperty(l.id, 'color-relief-opacity', opacity[meta.opacityKey])
    if (meta.opacityKey === 'forest' && l.type === 'fill') map.setPaintProperty(l.id, 'fill-opacity', opacity.forest)
  }
  // a switch gone on before the first idle: its source gets its file now
  flushDeferredGeo(map, layers)
  // the contour ink follows the base the view puts under it
  if (map.getLayer('contour-line')) {
    const ink = CONTOUR_INK[baseTone(layers)]
    map.setPaintProperty('contour-line', 'line-color', ink.line)
    map.setPaintProperty('contour-index', 'line-color', ink.index)
    map.setPaintProperty('contour-label', 'text-color', ink.text)
    map.setPaintProperty('contour-label', 'text-halo-color', ink.halo)
  }
}
