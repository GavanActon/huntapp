import maplibregl, { type GeoJSONSource, type Map as MlMap, type MapLayerMouseEvent, type MapLayerTouchEvent } from 'maplibre-gl'
import type { FeatureCollection } from 'geojson'
import { onEachMap } from '../map/mapController'
import { closeOnTapOff } from '../map/tapPopup'
import { fmtCoord } from '../map/MapView'
import { agoLabel, hourMinShort } from '../time'
import { SOUND_NAMES, SPECIES_NAMES, useHuntLog, WHAT_NAMES, type LogEntry } from './huntLog'

/**
 * The hunt log on the map: a dot per entry, coloured by what happened
 * (seen and called in bright, heard and sign softer, blank sits hollow),
 * with the species' first letter, fading over three weeks as its pull on
 * the Spots map fades. A tap on a dot says what and when (showLogPopup,
 * from MapView's click); a press and hold picks it up to move it.
 */

const SRC = 'huntlog'
const DAY = 86_400_000
const HOLD_MS = 350
const SLOP_PX = 8

function features(entries: LogEntry[]): FeatureCollection {
  const now = Date.now()
  return {
    type: 'FeatureCollection',
    features: entries.map((e) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [e.lon, e.lat] },
      properties: {
        id: e.id,
        what: e.what,
        letter: SPECIES_NAMES[e.species][0],
        // 1 fresh … 0.35 three weeks old and after
        fresh: Math.max(0.35, 1 - (now - e.ts) / (21 * DAY)),
      },
    })),
  }
}

function ensure(map: MlMap) {
  const data = features(useHuntLog.getState().entries)
  const src = map.getSource(SRC) as GeoJSONSource | undefined
  if (src) return src.setData(data)
  map.addSource(SRC, { type: 'geojson', data })
  map.addLayer({
    id: 'huntlog-dot',
    type: 'circle',
    source: SRC,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 4, 15, 8],
      'circle-color': ['match', ['get', 'what'], 'seen', '#ff6b4a', 'called', '#ff3d7f', 'heard', '#ffb347', 'sign', '#d8b36a', 'rgba(0,0,0,0)'],
      'circle-stroke-color': ['match', ['get', 'what'], 'nothing', '#c9d1d9', '#1a0f06'],
      'circle-stroke-width': ['match', ['get', 'what'], 'nothing', 2, 1.5],
      'circle-opacity': ['get', 'fresh'],
      'circle-stroke-opacity': ['get', 'fresh'],
    },
  })
  map.addLayer({
    id: 'huntlog-letter',
    type: 'symbol',
    source: SRC,
    minzoom: 13,
    layout: { 'text-field': ['get', 'letter'], 'text-font': ['Noto Sans Medium'], 'text-size': 10, 'text-allow-overlap': true },
    paint: { 'text-color': '#1a0f06', 'text-opacity': ['get', 'fresh'] },
  })
}

function esc(t: string): string {
  return t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c] ?? c)
}

/** What an entry was: `Bull grunt`, `Moose seen`, `Blank sit · moose`. */
export function entryTitle(e: LogEntry): string {
  if (e.what === 'nothing') return `Blank sit · ${SPECIES_NAMES[e.species].toLowerCase()}`
  const who = `${SPECIES_NAMES[e.species]}${e.count && e.count > 1 ? ` ×${e.count}` : ''}`
  if (e.sound) return `${SOUND_NAMES[e.sound]}${e.kind && e.sound !== 'bull' && e.sound !== 'cow' ? ` · ${e.kind}` : ''}`
  return `${who} ${WHAT_NAMES[e.what].toLowerCase()}`
}

/** A tapped entry: what and when, its coordinates (a tap copies them), Delete. No ×: tap off. */
export function showLogPopup(map: MlMap, e: LogEntry): void {
  const el = document.createElement('div')
  const ago = agoLabel(Date.now() - e.ts)
  el.innerHTML =
    `<div class="lp-title">${esc(entryTitle(e))}</div>` +
    `<div class="lp-when">${esc(hourMinShort(e.ts))} · ${esc(ago)}${e.note ? ` · ${esc(e.note)}` : ''}</div>` +
    `<div class="pp-acts"><button class="lp-coord">${esc(fmtCoord(e.lon, e.lat))}</button><button class="lp-del">Delete</button></div>`
  const popup = new maplibregl.Popup({ className: 'depth-popup', closeButton: false, closeOnClick: false, offset: 10, maxWidth: '260px' })
    .setLngLat([e.lon, e.lat])
    .setDOMContent(el)
    .addTo(map)
  closeOnTapOff(map, popup)
  el.querySelector('.lp-coord')?.addEventListener('click', (ev) => {
    void navigator.clipboard?.writeText(fmtCoord(e.lon, e.lat))
    const b = ev.currentTarget as HTMLButtonElement
    b.textContent = 'Copied'
    window.setTimeout(() => popup.remove(), 600)
  })
  el.querySelector('.lp-del')?.addEventListener('click', () => {
    useHuntLog.getState().remove(e.id)
    popup.remove()
  })
}

// press and hold on a dot: after HOLD_MS with the finger still, the dot follows it; lifting saves
let lastTouchMs = 0
function beginHold(map: MlMap, e: MapLayerMouseEvent | MapLayerTouchEvent) {
  const id = e.features?.[0]?.properties?.id as string | undefined
  if (!id) return
  const touch = e.type === 'touchstart'
  if (touch) lastTouchMs = Date.now()
  else if (Date.now() - lastTouchMs < 700) return // the browser replaying a tap
  if ('points' in e && e.points.length > 1) return
  const container = map.getCanvasContainer()
  const start = { x: e.point.x, y: e.point.y }
  let held = false
  let moved = false
  let at: [number, number] | null = null
  const timer = window.setTimeout(() => {
    held = true
    map.dragPan.disable()
    map.getCanvas().style.cursor = 'grabbing'
    if (navigator.vibrate) navigator.vibrate(12)
  }, HOLD_MS)
  const move = (ev: MouseEvent | TouchEvent) => {
    const p = 'touches' in ev ? ev.touches[0] : ev
    if (!p) return
    const r = container.getBoundingClientRect()
    const x = p.clientX - r.left
    const y = p.clientY - r.top
    if (!held) {
      // the finger wandered before the hold: a pan, not a pick-up
      if (Math.hypot(x - start.x, y - start.y) > SLOP_PX) done()
      return
    }
    const ll = map.unproject([x, y])
    at = [ll.lng, ll.lat]
    moved = true
    const src = map.getSource(SRC) as GeoJSONSource | undefined
    const entries = useHuntLog.getState().entries.map((x) => (x.id === id ? { ...x, lon: ll.lng, lat: ll.lat } : x))
    src?.setData(features(entries))
  }
  const done = () => {
    window.clearTimeout(timer)
    window.removeEventListener('mousemove', move)
    window.removeEventListener('mouseup', up)
    window.removeEventListener('touchmove', move)
    window.removeEventListener('touchend', up)
    window.removeEventListener('touchcancel', up)
    if (held) {
      map.dragPan.enable()
      map.getCanvas().style.cursor = ''
    }
  }
  function up() {
    const wasHeld = held
    done()
    if (wasHeld && moved && at) useHuntLog.getState().update(id!, { lon: at[0], lat: at[1] })
    else if (wasHeld) ensure(map) // put back
  }
  if (touch) {
    window.addEventListener('touchmove', move, { passive: true })
    window.addEventListener('touchend', up)
    window.addEventListener('touchcancel', up)
  } else {
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }
}

let wired = false
export function initLogLayer() {
  if (wired) return
  wired = true
  let current: MlMap | null = null
  onEachMap((map) => {
    current = map
    const add = () => {
      try {
        ensure(map)
      } catch {
        // the style is still loading
      }
    }
    if (map.isStyleLoaded()) add()
    map.on('styledata', () => {
      if (!map.getSource(SRC)) add()
    })
    map.on('mousedown', 'huntlog-dot', (e) => beginHold(map, e))
    map.on('touchstart', 'huntlog-dot', (e) => beginHold(map, e))
    map.on('mouseenter', 'huntlog-dot', () => (map.getCanvas().style.cursor = 'pointer'))
    map.on('mouseleave', 'huntlog-dot', () => (map.getCanvas().style.cursor = ''))
  })
  useHuntLog.subscribe((s, p) => {
    if (s.entries !== p.entries && current) {
      try {
        ensure(current)
      } catch {
        /* not ready yet: styledata adds it */
      }
    }
  })
}
