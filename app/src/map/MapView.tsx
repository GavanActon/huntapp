import maplibregl from 'maplibre-gl'
import { useEffect, useRef, useState } from 'react'
import { devlog } from '../devlog'
import { fileUrl, loadView, saveView } from '../areas'
import { peekSwitchThen } from '../areas/handoff'
import { BASE_GEO, baseGeoFile, DATA_FILES, GEO_THEMES, geoFile, HOME, MAX_BOUNDS } from '../config'
import { getStoredFile } from '../offline/fileStore'
import { bootManifest } from '../offline/updates'
import { markShown, useAppStore, type LayerOpacity, type LayerVisibility } from '../state/appStore'
import { placeColour } from '../state/pinColours'
import { usePlacesStore } from '../state/placesStore'
import { geoUrls, holdOpening, setMap, withMap } from './mapController'
import { useMeasureStore } from '../measure/measureStore'
import { baseTone, BOG_TUFT, bogTuftImage, buildMapStyle, CONTOUR_INK, contourFilters, flushDeferredGeo, groundColour } from './mapStyle'
import { offlineComplete, registerAllDataFiles, registerDataFile, sourceModes } from './pmtilesRegistry'
import { showInfoPopup } from './infoPopup'
import { showPlacePopup } from './placePopup'
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
import { EXPLORE, exploreMoved, exploreTap } from '../explore'
import { COVERAGE_FILE, COVERAGE_KEY, syncCoverageState } from '../explore/coverage'
import { useExplore } from '../explore/store'

/** Your pins and the preset places, each as the strip's marks say. */
function placesGeoJson(): FeatureCollection {
  const s = usePlacesStore.getState()
  const app = useAppStore.getState()
  const pins = markShown(app, 'pins')
  const places = markShown(app, 'places')
  return {
    type: 'FeatureCollection',
    features: s.places.filter((p) => (p.savedAt > 0 ? pins : places)).map((p) => ({
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

/** `known`: the files the server lists (bootManifest), which spares a HEAD per theme. */
async function resolveGeo(known: Set<string> | null): Promise<Map<string, string>> {
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
      if (known) {
        if (known.has(file)) {
          geoModes.set(t, 'network')
          geo.set(t, fileUrl(file))
        }
        return
      }
      try {
        // the dev server answers every path with index.html: only JSON counts
        const url = fileUrl(file)
        const r = await fetch(url, { method: 'HEAD' })
        if (r.ok && /json/i.test(r.headers.get('content-type') ?? '')) {
          geoModes.set(t, 'network')
          geo.set(t, url)
        }
      } catch {
        /* not baked */
      }
    }),
  )
  return geo
}

/** Whether the view sits against one side and one end of the box at once
 *  (and spans neither: a view zoomed out over the whole box is not in a
 *  corner), within a hundredth of the box. */
function pressedIntoCorner(m: maplibregl.Map): boolean {
  const b = m.getBounds()
  const [[w, s], [e, n]] = MAX_BOUNDS
  const tx = (e - w) * 0.01
  const ty = (n - s) * 0.01
  const atW = b.getWest() - w < tx
  const atE = e - b.getEast() < tx
  const atS = b.getSouth() - s < ty
  const atN = n - b.getNorth() < ty
  return atW !== atE && atS !== atN
}

/** The opening: how many zoom levels further out the map starts, the
 *  furthest out it starts (every area's imagery and topo reach 11), how
 *  long it waits for the coarse view to draw, and the zoom in. */
const OPEN_OUT = 2
const OPEN_MIN_ZOOM = 11
const OPEN_WAIT_MS = 1200
const OPEN_IN_MS = 700

/**
 * The map opens further out than its view, where a handful of coarse tiles
 * fill the screen at once, and zooms in once they have drawn. MapLibre keeps
 * the coarse tiles up under the view as stand-ins while its own stream in,
 * so the map comes up blurred and sharpens instead of blank and filling in
 * a tile at a time (Gavan, 2026-10-07: "start zoomed out and stream in").
 * A hand on the map ends it where it is, and so does anything else that
 * sets its own zoom first (an outing fitting itself). A follow easing to
 * the dot moves only the middle: the zoom in still lands. Resolves once
 * the map is at its view, or left to the hand.
 */
function openFromFurtherOut(m: maplibregl.Map): Promise<void> {
  const zoom = m.getZoom()
  const center = m.getCenter()
  const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  if (zoom - Math.max(OPEN_MIN_ZOOM, zoom - OPEN_OUT) < 0.5) return Promise.resolve()
  m.jumpTo({ zoom: Math.max(OPEN_MIN_ZOOM, zoom - OPEN_OUT) })
  // where it really starts: a tall screen out at 11 sees past the box, and
  // MapLibre holds the zoom in (and shifts the middle) to keep the view inside it
  const from = m.getZoom()
  const fromCenter = m.getCenter()
  if (zoom - from < 0.5) {
    m.jumpTo({ zoom, center })
    return Promise.resolve()
  }
  return new Promise((done) => {
    let touched = false
    const onMove = (e: { originalEvent?: unknown }) => {
      if (e.originalEvent) touched = true
    }
    m.on('movestart', onMove)
    const finish = () => {
      m.off('movestart', onMove)
      done()
    }
    let went = false
    const zoomIn = () => {
      if (went) return
      went = true
      if (touched || Math.abs(m.getZoom() - from) > 0.01) return finish()
      // back to the view's own middle, unless something moved it meanwhile (the dot, followed)
      const to = m.getCenter().distanceTo(fromCenter) < 1 ? { zoom, center } : { zoom }
      if (still) {
        m.jumpTo(to)
        return finish()
      }
      m.easeTo({ ...to, duration: OPEN_IN_MS })
      m.once('moveend', () => {
        // cut short by an easing of the middle alone (the dot, followed): the zoom still lands
        if (!touched && m.getZoom() < zoom - 0.05) m.jumpTo({ zoom })
        finish()
      })
    }
    m.once('idle', zoomIn)
    m.once('render', () => window.setTimeout(zoomIn, OPEN_WAIT_MS))
  })
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
    // read now, before the app takes it (App's effects run after this one's)
    const arrival = peekSwitchThen()

    void (async () => {
      // the server's file list first (one small request, often cached): with
      // it the archives and themes need no probing before the style is built
      const listing = await bootManifest()
      const known = listing ? new Set(Object.keys(listing.files)) : null
      const [available, geo] = await Promise.all([registerAllDataFiles(known), resolveGeo(known)])
      // Explore: the coverage index's archive, kept out of every area's list (explore/coverage.ts)
      if (EXPLORE && (await registerDataFile(COVERAGE_KEY, COVERAGE_FILE)) !== 'missing') available.add(COVERAGE_KEY)
      if (cancelled) return
      geoUrls.clear()
      for (const [k, v] of geo) geoUrls.set(k, v)
      const missing = DATA_FILES.filter((d) => sourceModes.get(d.key) === 'missing').map((d) => d.label)
      useAppStore.getState().setMissingData(missing)
      useAppStore.getState().setOfflineReady(offlineComplete())
      devlog('map', `sources · ${[...sourceModes].map(([k, m]) => `${k}:${m}`).join(' ')} · geo ${[...geo.keys()].join(',') || 'none'}`)

      const { layers, opacity, contourInterval } = useAppStore.getState()
      const style = buildMapStyle({ base: import.meta.env.BASE_URL, layers, opacity, contourInterval, available, geo })
      // the last view in this area (a switch saves the one to open on)
      const saved = loadView()

      try {
        map = new maplibregl.Map({
          container: el,
          style,
          center: saved?.center ?? HOME.center,
          zoom: saved?.zoom ?? HOME.zoom,
          bearing: saved?.bearing ?? 0,
          maxBounds: MAX_BOUNDS,
          minZoom: EXPLORE ? 4 : 7,
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
      if (EXPLORE) {
        // the tile picked and the ones asked for, as feature state on the grid
        let was = { picked: null as string | null, requested: [] as string[] }
        const sync = () => {
          const st = useExplore.getState()
          was = syncCoverageState(m, st.selected?.tile.id ?? null, st.requested, was)
        }
        m.on('load', () => {
          exploreMoved(m)
          sync()
        })
        useExplore.subscribe(sync)
      }
      // the bogs' marsh tufts (the Topo view), made the first time a layer asks for them
      m.on('styleimagemissing', (e: { id: string }) => {
        if (e.id === BOG_TUFT && !m.hasImage(BOG_TUFT)) m.addImage(BOG_TUFT, bogTuftImage(), { pixelRatio: 2 })
      })
      // A view saved before VIEW_V and pressed into a corner of the box is
      // the old follow's doing, an out-of-area fix dragged to the nearest
      // corner, not a place anyone looked: it opens on the middle instead,
      // once (the next move saves a marked view)
      if (saved && !saved.v && pressedIntoCorner(m)) {
        devlog('map', `a corner view from an out-of-area fix · opened on the middle`)
        m.jumpTo({ center: HOME.center, zoom: HOME.zoom, bearing: 0 })
      }
      // the opening: from further out, unless a switch or a link opened the
      // app on something to show (its view is the point, at once)
      if (!arrival || arrival === 'look') holdOpening(openFromFurtherOut(m))

      // the controller hands the map to the layer modules once the style is
      // parsed ('style.load'), not 'load': a live tile source that never
      // finishes would otherwise hold every layer back
      setMap(m)
      // the GeoJSON of the layers that are off waits for its switch
      // (flushDeferredGeo in the layer sync below)
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
      })

      m.on('moveend', () => {
        const c = m.getCenter()
        saveView({ center: [c.lng, c.lat], zoom: m.getZoom(), bearing: m.getBearing() })
        if (EXPLORE) exploreMoved(m)
      })
      m.on('dragstart', () => useAppStore.getState().setFollow(false))

      // tap a place: your own pin says what it is, with Delete (placePopup);
      // the camp and the lakes are presets and open Dig in on themselves.
      // Tap the map: a three-line popup, Dig in behind it. One plain tap:
      // a wait for a double tap and filters for brushes of the screen were
      // tried on 2026-10-02 and made the popup unreliable in the hand.
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
        // Explore: the tap picks the cell under it (explore/index.ts)
        if (EXPLORE) return exploreTap(m, e)
        // a place, a numbered pin, a wind check or a kept route has its own tap
        const hit = m.queryRenderedFeatures(e.point, { layers: ['pins-pt', 'spots-pin', 'windchecks-hit', 'routes-hit', 'huntlog-dot'].filter((id) => m.getLayer(id)) })
        if (hit.length) return
        // the weather there, the score while the heat is on, then the actions (map/infoPopup.ts)
        showInfoPopup(m, e.lngLat)
      })
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
      if (markShown(s, 'pins') === markShown(prev, 'pins') && markShown(s, 'places') === markShown(prev, 'places')) return
      const src = map?.getSource('pins')
      if (src && 'setData' in src) (src as maplibregl.GeoJSONSource).setData(placesGeoJson())
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
  // a switch gone on: its source gets its file now
  flushDeferredGeo(map, layers)
  // the contour ink follows the base the view puts under it: the 1 m LiDAR
  // lines and the region's 10 m ones alike (only the LiDAR ones followed, so
  // zoomed out the Bow kept the Topo view's umber, near black on the bush:
  // Gavan, 2026-10-03)
  const ink = CONTOUR_INK[baseTone(layers)]
  for (const p of ['contour', 'contour-wide']) {
    if (!map.getLayer(`${p}-line`)) continue
    map.setPaintProperty(`${p}-line`, 'line-color', ink.line)
    map.setPaintProperty(`${p}-index`, 'line-color', ink.index)
    map.setPaintProperty(`${p}-label`, 'text-color', ink.text)
    map.setPaintProperty(`${p}-label`, 'text-halo-color', ink.halo)
  }
}
