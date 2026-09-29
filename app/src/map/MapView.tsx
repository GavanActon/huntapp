import maplibregl from 'maplibre-gl'
import { useEffect, useRef, useState } from 'react'
import { devlog } from '../devlog'
import { BASE_GEO, baseGeoFile, DATA_BASE, DATA_FILES, GEO_THEMES, geoFile, HOME, MAX_BOUNDS } from '../config'
import { getStoredFile } from '../offline/fileStore'
import { useAppStore, type LayerOpacity, type LayerVisibility } from '../state/appStore'
import { usePlacesStore } from '../state/placesStore'
import { geoUrls, setMap, withMap } from './mapController'
import { useMeasureStore } from '../measure/measureStore'
import { explainPoint } from '../spots/scoring'
import { useSpotsStore } from '../state/spotsStore'
import { TARGET_NAMES } from '../spots/types'
import { buildMapStyle, contourFilters } from './mapStyle'
import { offlineComplete, registerAllDataFiles, sourceModes } from './pmtilesRegistry'
import { attachTapWeather } from './tapWeather'
import { attachTapGround } from './tapGround'
import { closeOnTapOff } from './tapPopup'
import { useScent } from '../weather/micro/scent'
import { useLogForm } from '../ui/LogCard'
import { openRoutes, useRoutes } from '../routes/routeStore'

import type { FeatureCollection } from 'geojson'
import 'maplibre-gl/dist/maplibre-gl.css'

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

const PLACE_COLORS: Record<string, string> = {
  camp: '#ffb454',
  lake: '#3fc8ff',
  landing: '#59e0b8',
  stand: '#ff8a80',
  trail: '#c9a227',
}

function placesGeoJson(): FeatureCollection {
  const s = usePlacesStore.getState()
  return {
    type: 'FeatureCollection',
    features: s.places.map((p) => ({
      type: 'Feature',
      id: p.id,
      geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
      properties: { id: p.id, name: p.name, kind: p.kind, color: PLACE_COLORS[p.kind] ?? '#ffb454', selected: p.id === s.selectedId },
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

function fmtCoord(lon: number, lat: number): string {
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
          attributionControl: { compact: true },
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
      withMap((map) => {
        if (map !== m || m.getSource('places')) return
        // saved / preset places ride on top of everything
        m.addSource('places', { type: 'geojson', data: placesGeoJson() })
        m.addLayer({
          id: 'places-halo',
          type: 'circle',
          source: 'places',
          filter: ['==', ['get', 'selected'], true],
          paint: { 'circle-radius': 12, 'circle-color': 'rgba(63,200,255,0.25)' },
        })
        m.addLayer({
          id: 'places-pt',
          type: 'circle',
          source: 'places',
          paint: { 'circle-radius': 6, 'circle-color': ['get', 'color'], 'circle-stroke-color': '#0f1a12', 'circle-stroke-width': 2 },
        })
        m.addLayer({
          id: 'places-label',
          type: 'symbol',
          source: 'places',
          layout: { 'text-field': ['get', 'name'], 'text-font': ['Noto Sans Medium'], 'text-size': 12, 'text-offset': [0, 1.1], 'text-anchor': 'top' },
          paint: { 'text-color': '#eef5ea', 'text-halo-color': 'rgba(10,20,12,0.95)', 'text-halo-width': 1.4 },
        })
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

      // tap a place: select it; tap the map: a popup with the spot and Save
      m.on('click', 'places-pt', (e) => {
        // the ruler, a person being placed and the route card each own the tap
        if (useMeasureStore.getState().active || useScent.getState().adding || useRoutes.getState().open) return
        const id = e.features?.[0]?.properties?.id as string | undefined
        if (id) {
          usePlacesStore.getState().select(id)
          useAppStore.getState().setSheetTab('places')
        }
      })
      m.on('click', (e) => {
        if (useMeasureStore.getState().active) return // the ruler owns the tap
        if (useRoutes.getState().open) return // so does the route card (routes/routeLayer)
        const scent = useScent.getState()
        // placing another person: the tap is where they sit
        if (scent.adding) return scent.add(e.lngLat.lng, e.lngLat.lat)
        // a place, a wind check or a kept route has its own tap
        const hit = m.queryRenderedFeatures(e.point, { layers: ['places-pt', 'windchecks-hit', 'routes-hit'].filter((id) => m.getLayer(id)) })
        if (hit.length) return
        const { lng, lat } = e.lngLat
        const el = document.createElement('div')
        // glance first: the weather there, the game score, Scent and Pin.
        // Everything else — the ground air's reasons, the score's reasons,
        // the coordinates, logging the wind — waits behind "more".
        const sp = useSpotsStore.getState()
        const why = sp.conditions && sp.heat ? explainPoint(sp.target, lng, lat, sp.conditions, sp.weights) : null
        const esc = (t: string) => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] ?? c)
        const grade = (v: number) => (v >= 0.75 ? 'top' : v >= 0.55 ? 'good' : v >= 0.35 ? 'fair' : 'poor')
        const nReasons = sp.detail === 'full' ? 8 : 4
        // with people already sitting, the scent button adds the next one here
        const sitting = scent.people.length
        const scentBtn = sitting ? `+ Person ${sitting + 1}` : 'Scent cone'
        const gameHtml = why
          ? `<div class="pp-game"><b class="pp-score pp-${grade(why.score)}">${Math.round(why.score * 100)}</b><span>${esc(TARGET_NAMES[sp.target])} · ${grade(why.score)}</span></div>`
          : ''
        const gameMore = why
          ? `<div class="pp-more-h">${esc(TARGET_NAMES[sp.target])}${sp.result?.verdict.headline ? ` · ${esc(sp.result.verdict.headline)}` : ''}</div><ul class="pp-reasons">${why.reasons
              .slice(0, nReasons)
              .map((r) => `<li>${esc(r)}</li>`)
              .join('')}<li><button class="pp-details linklike" type="button">the arithmetic and the knobs ▸</button></li></ul>`
          : ''
        el.innerHTML =
          `<div class="depth-popup-wx"></div>${gameHtml}` +
          `<div class="pp-acts"><button class="pp-scent">${scentBtn}</button><button class="pp-route">Route</button><button class="pp-log">Log</button><button class="pp-save">Pin</button><button class="pp-more-btn" aria-expanded="false">more</button></div>` +
          `<div class="pp-more" hidden><div class="depth-popup-ground"></div>${gameMore}<div class="pp-coord">${fmtCoord(lng, lat)}</div></div>`
        const popup = new maplibregl.Popup({ className: 'depth-popup', closeButton: false, closeOnClick: false, offset: 8, maxWidth: '260px' })
          .setLngLat([lng, lat])
          .setDOMContent(el)
          .addTo(m)
        // no ×: tap again, anywhere off it, and it goes
        closeOnTapOff(m, popup)
        // wind, temperature, sky and rain chance at the planning time
        const stopWx = attachTapWeather(el.querySelector('.depth-popup-wx') as HTMLElement, lng, lat)
        popup.on('close', stopWx)
        // the air at head height there, and logging what it really does
        const stopGround = attachTapGround(el.querySelector('.depth-popup-ground') as HTMLElement, lng, lat, () => popup.remove())
        popup.on('close', stopGround)
        el.querySelector('.pp-more-btn')?.addEventListener('click', (ev) => {
          const more = el.querySelector('.pp-more') as HTMLElement
          more.hidden = !more.hidden
          const b = ev.currentTarget as HTMLElement
          b.textContent = more.hidden ? 'more' : 'less'
          b.setAttribute('aria-expanded', String(!more.hidden))
        })
        el.querySelector('.pp-scent')?.addEventListener('click', () => {
          const sc = useScent.getState()
          if (sc.people.length) sc.add(lng, lat)
          else sc.show(lng, lat)
          popup.remove()
        })
        el.querySelector('.pp-route')?.addEventListener('click', () => {
          openRoutes({ lon: lng, lat })
          popup.remove()
        })
        el.querySelector('.pp-log')?.addEventListener('click', () => {
          useLogForm.getState().open(lng, lat)
          popup.remove()
        })
        el.querySelector('.pp-details')?.addEventListener('click', () => {
          usePlacesStore.getState().select(null)
          useSpotsStore.getState().setProbe({ lon: lng, lat, name: 'Tapped point' })
          useAppStore.getState().setSheetTab('spots')
          popup.remove()
        })
        el.querySelector('.pp-save')?.addEventListener('click', () => {
          const p = usePlacesStore.getState().add({ name: 'Pin', lon: lng, lat, kind: 'stand' })
          usePlacesStore.getState().select(p.id)
          useAppStore.getState().setSheetTab('places')
          popup.remove()
        })
      })
      m.on('mouseenter', 'places-pt', () => (m.getCanvas().style.cursor = 'pointer'))
      m.on('mouseleave', 'places-pt', () => (m.getCanvas().style.cursor = ''))
      m.on('webglcontextlost', () => devlog('map', 'webgl context lost'))
      m.on('error', (e) => devlog('map', `error · ${(e as { error?: Error }).error?.message ?? String(e)}`))
    })()

    // the sheet's switches: visibility by metadata.group, opacity by key
    const unsubLayers = useAppStore.subscribe((s, prev) => {
      if (!map || (s.layers === prev.layers && s.opacity === prev.opacity)) return
      applyLayerState(map, s.layers, s.opacity)
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
      const src = map?.getSource('places') as maplibregl.GeoJSONSource | undefined
      src?.setData(placesGeoJson())
    })

    return () => {
      cancelled = true
      unsubLayers()
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

export function applyLayerState(map: maplibregl.Map, layers: LayerVisibility, opacity: LayerOpacity) {
  if (!map.isStyleLoaded() && !map.getStyle()) return
  for (const l of map.getStyle().layers) {
    const meta = (l as { metadata?: { group?: keyof LayerVisibility; opacityKey?: keyof LayerOpacity } }).metadata
    if (!meta?.group) continue
    const on = layers[meta.group]
    map.setLayoutProperty(l.id, 'visibility', on ? 'visible' : 'none')
    if (meta.opacityKey && l.type === 'raster') map.setPaintProperty(l.id, 'raster-opacity', opacity[meta.opacityKey])
    if (meta.opacityKey && l.type === 'color-relief') map.setPaintProperty(l.id, 'color-relief-opacity', opacity[meta.opacityKey])
    if (meta.opacityKey === 'forest' && l.type === 'fill') map.setPaintProperty(l.id, 'fill-opacity', opacity.forest)
  }
}
