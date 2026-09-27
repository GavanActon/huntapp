import maplibregl from 'maplibre-gl'
import { useEffect, useRef, useState } from 'react'
import { devlog } from '../devlog'
import { DATA_BASE, DATA_FILES, GEO_THEMES, geoFile, HOME, MAX_BOUNDS } from '../config'
import { getStoredFile } from '../offline/fileStore'
import { useAppStore, type LayerOpacity, type LayerVisibility } from '../state/appStore'
import { usePlacesStore } from '../state/placesStore'
import { setMap, withMap } from './mapController'
import { useMeasureStore } from '../measure/measureStore'
import { explainPoint } from '../spots/scoring'
import { useSpotsStore } from '../state/spotsStore'
import { TARGET_NAMES } from '../spots/types'
import { buildMapStyle, contourFilters } from './mapStyle'
import { registerAllDataFiles, sourceModes } from './pmtilesRegistry'
import { attachTapWeather } from './tapWeather'
import { attachTapGround } from './tapGround'

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
  await Promise.all(
    GEO_THEMES.map(async (t) => {
      const file = geoFile(t)
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
      const missing = DATA_FILES.filter((d) => sourceModes.get(d.key) === 'missing').map((d) => d.label)
      useAppStore.getState().setMissingData(missing)
      useAppStore.getState().setOfflineReady(DATA_FILES.every((d) => sourceModes.get(d.key) === 'local'))
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
        if (useMeasureStore.getState().active) return
        const id = e.features?.[0]?.properties?.id as string | undefined
        if (id) {
          usePlacesStore.getState().select(id)
          useAppStore.getState().setSheetTab('places')
        }
      })
      m.on('click', (e) => {
        if (useMeasureStore.getState().active) return // the ruler owns the tap
        const hit = m.queryRenderedFeatures(e.point, { layers: ['places-pt'] })
        if (hit.length) return
        const { lng, lat } = e.lngLat
        const el = document.createElement('div')
        // the picked point's case, progressively: the score and the day's
        // headline first; "why" unfolds the reasons; "details" hands the
        // point to the Spots tab as the probe, where the arithmetic and the
        // knobs live. Only when the scorer has conditions and the grid.
        const sp = useSpotsStore.getState()
        const why = sp.conditions && sp.heat ? explainPoint(sp.target, lng, lat, sp.conditions, sp.weights) : null
        const esc = (t: string) => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] ?? c)
        const grade = (v: number) => (v >= 0.75 ? 'top' : v >= 0.55 ? 'good' : v >= 0.35 ? 'fair' : 'poor')
        // Brief shows the score alone; the reasons wait behind "why"
        const nReasons = sp.detail === 'brief' ? 3 : sp.detail === 'full' ? 8 : 4
        const whyHtml = why
          ? `<div class="pp-why"><div class="pp-why-head"><b class="pp-score pp-${grade(why.score)}">${Math.round(why.score * 100)}</b><span>${esc(TARGET_NAMES[sp.target])} · ${esc(sp.result?.verdict.headline ?? '')}</span><button class="pp-why-btn linklike" type="button">why</button></div><ul class="pp-reasons" hidden>${why.reasons
              .slice(0, nReasons)
              .map((r) => `<li>${esc(r)}</li>`)
              .join('')}<li><button class="pp-details linklike" type="button">the arithmetic and the knobs ▸</button></li></ul></div>`
          : ''
        el.innerHTML = `<button class="pp-close" aria-label="Close">×</button><div class="depth-popup-value">${fmtCoord(lng, lat)}</div><div class="depth-popup-wx"></div><div class="depth-popup-ground"></div>${whyHtml}<div class="pp-acts"><button class="pp-save">Save</button></div>`
        const popup = new maplibregl.Popup({ className: 'depth-popup', closeButton: false, offset: 8, maxWidth: '320px' }).setLngLat([lng, lat]).setDOMContent(el).addTo(m)
        // wind, temperature, sky and rain chance at the planning time
        const stopWx = attachTapWeather(el.querySelector('.depth-popup-wx') as HTMLElement, lng, lat)
        popup.on('close', stopWx)
        // the air at head height there: drainage, shelter, the scent cone
        const stopGround = attachTapGround(el.querySelector('.depth-popup-ground') as HTMLElement, lng, lat, () => popup.remove())
        popup.on('close', stopGround)
        el.querySelector('.pp-close')?.addEventListener('click', () => popup.remove())
        el.querySelector('.pp-why-btn')?.addEventListener('click', (ev) => {
          const ul = el.querySelector('.pp-reasons') as HTMLElement | null
          if (!ul) return
          ul.hidden = !ul.hidden
          ;(ev.currentTarget as HTMLElement).textContent = ul.hidden ? 'why' : 'less'
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
      const [keep, index] = contourFilters(s.contourInterval)
      map.setFilter('contour-line', keep)
      map.setFilter('contour-index', index)
      map.setFilter('contour-label', index)
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
    if (meta.opacityKey === 'forest' && l.type === 'fill') map.setPaintProperty(l.id, 'fill-opacity', opacity.forest)
  }
}
