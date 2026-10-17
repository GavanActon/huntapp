import type { JSX } from 'react'
import type { Map as MlMap } from 'maplibre-gl'
import type { FeatureCollection } from 'geojson'
import { create } from 'zustand'
import { ACTIVE_AREA, AREA_LIST, areaAt, type AreaDef } from '../areas'
import { bushMeasured, CORE, FINE_RELIEF, GRADE, hasSdWind, hdFiles, SD_HIDDEN, SD_OFFLINE, SD_PREVIEW, windSolved, areaGrade } from '../config'
import { setExplore } from '../explore'
import { boxAround, boxOfBounds, hdFits, parseBoxId, sizeKm, unionBox } from '../explore/box'
import { useExplore, type Selected } from '../explore/store'
import { getMap, onEachMap } from '../map/mapController'
import { deleteStoredFile } from '../offline/fileStore'
import { useAppStore, type LayerVisibility } from '../state/appStore'
import { hdInstalled, setHdInstalled } from '../state/grade'
import { useHdOrders, type HdOrder } from '../state/hdOrders'
import { terrainWind } from '../state/terrainWind'
import { flushTrackSave } from '../tracking/trackStore'
import { carryPlaced } from '../weather/micro/scent'
import { DEV_SITE } from './DevBadge'
import './grade.css'

/**
 * HD on the map (docs/SD-HD-PLAN.md; Gavan, 2026-10-15). One rule: gold
 * means what you are looking at is HD. The action buttons HD powers wear a
 * gold ring and the weather strip a gold outline while the middle of the
 * view is inside an HD box, and fade off outside it; each HD box on the
 * phone is edged in gold on the map. SD shows no upgrade highlights.
 * Every HD area is yours for now (state/grade.ts), so its HD streams in;
 * the install that downloaded it first, with its rings and progress, went
 * with that (2026-10-17). The grade word in the view pill is gold or tan to
 * match and opens the grade sheet: what HD gives here, what HD adds and Get
 * HD for an SD one, an order made from this phone, and every area; the dev
 * builds can take an HD area's HD off and put it back, to see it as SD side
 * by side. A tap on ground outside the HD box offers Get HD here, or Extend
 * next to the box (hdOffer).
 */

/** Dev builds: hunt-dev and the dev server (orders are simulated there, Remove HD is offered). */
export const GRADE_SWITCH = DEV_SITE || import.meta.env.DEV

/** One thing HD gives at this spot, as the grade sheet lists it. */
export interface HdItem {
  id: 'wind' | 'shade' | 'contours' | 'lanes' | 'bush'
  /** the file key it comes in (config.ts hdFiles): what Install fetches for it */
  key: string
  /** the hot button it powers, which wears the ring */
  hot?: string
  /** the map layer that shows it */
  layer?: keyof LayerVisibility
  title: string
  line: string
  /** where it came from, from the bake's coverage report */
  source?: string
  /** how it stands while HD is not installed here */
  sdNote?: string
}

const point = (key: string) => /LiDAR|point cloud/i.test(ACTIVE_AREA.coverage?.pmtiles[key]?.source ?? '')
const sourceOf = (key: string) => {
  // the bake's words without its asides (file names, method notes in brackets)
  const s = ACTIVE_AREA.coverage?.pmtiles[key]?.source?.replace(/\s*\([^)]*\)/g, '')
  return s ? (s.length > 110 ? `${s.slice(0, 108).replace(/[ ,;:]+\S*$/, '')}…` : s) : undefined
}
const ARCTIC = ACTIVE_AREA.fineRelief != null
const has = (k: string) => ACTIVE_AREA.files.pmtiles.includes(k)
/** How an HD item stands while the map is SD: taken off (the dev builds' Remove), or not here with no signal. */
const OFF = SD_OFFLINE ? 'Not on this phone' : 'Taken off (dev)'

/** What the HD bake gave this area, or, for an SD area, what HD adds where it is baked. */
export function hdItems(): HdItem[] {
  if (areaGrade() !== 'hd') {
    return [
      { id: 'wind', key: 'micro', title: 'Wind solved for your ground', line: 'WindNinja runs the full solve over the box. It finds the lee behind rises and the bend round hills.' },
      { id: 'shade', key: 'hillshadeLidar', title: 'Old roads under the trees', line: 'A 1 m LiDAR shade, where LiDAR has been flown. Old logging roads and trails show through the canopy.' },
      { id: 'contours', key: 'contours', title: 'Contours every metre', line: 'The draws cold air drains down and the benches a moose beds on.' },
      { id: 'lanes', key: 'lanes', hot: 'lanes', layer: 'lanes', title: 'Shooting lanes', line: 'Where you can see and shoot, measured from the LiDAR point cloud.' },
      { id: 'bush', key: 'understory', title: 'Bush measured at eye level', line: 'Bush thickness from the point cloud, where SD has the national model.' },
    ]
  }
  const out: HdItem[] = []
  if (windSolved()) {
    out.push({
      id: 'wind',
      key: 'micro',
      hot: 'windflow',
      layer: 'windFlow',
      title: 'Wind solved for this ground',
      line: 'WindNinja ran the full solve here. It finds the lee behind rises and the bend round hills, at head height.',
      source: 'WindNinja momentum solve, under the HRDPS forecast',
      sdNote: hasSdWind() ? `${OFF}: the SD wind model runs here.` : 'Runs here already: no SD wind was baked for this area.',
    })
  }
  if (has('hillshadeLidar')) {
    out.push({
      id: 'shade',
      key: 'hillshadeLidar',
      layer: 'hillshade',
      title: ARCTIC ? 'Every bench and draw' : 'Old roads under the trees',
      line: ARCTIC ? `${FINE_RELIEF.name} shade, far sharper than the 30 m national relief.` : `${FINE_RELIEF.name} shade. Old logging roads and trails show through the canopy.`,
      source: sourceOf('hillshadeLidar') ?? FINE_RELIEF.attribution,
      sdNote: `${OFF}: the 30 m shade draws here.`,
    })
  }
  if (has('contours')) {
    out.push({
      id: 'contours',
      key: 'contours',
      hot: 'contours',
      layer: 'contours',
      title: 'Contours every metre',
      line: `From ${FINE_RELIEF.name}. The draws cold air drains down and the benches a moose beds on.`,
      source: sourceOf('contours'),
      sdNote: `${OFF}: the 30 m contours draw here.`,
    })
  }
  if (has('lanes')) {
    out.push({
      id: 'lanes',
      key: 'lanes',
      hot: 'lanes',
      layer: 'lanes',
      title: 'Shooting lanes',
      line: point('lanes') ? 'Where you can see and shoot, measured from the LiDAR point cloud.' : "Where you can see and shoot, from this area's own bush model at 10 m.",
      source: sourceOf('lanes'),
      sdNote: `${OFF}: no lanes yet.`,
    })
  }
  if (bushMeasured()) {
    out.push({
      id: 'bush',
      key: 'understory',
      hot: 'understory',
      layer: 'understory',
      title: point('understory') ? 'Bush measured at eye level' : 'Bush mapped for this ground',
      line: point('understory') ? 'Bush thickness from the LiDAR point cloud.' : 'Bush thickness from a model trained on this ground.',
      source: sourceOf('understory'),
      sdNote: `${OFF}: no bush layer yet.`,
    })
  }
  return out
}

/** What the map leaves out this run while HD is not installed, by item. */
export function offInSd(it: HdItem): boolean {
  if (!SD_PREVIEW) return false
  if (it.id === 'wind') return hasSdWind()
  return SD_HIDDEN.includes(it.key)
}

/** The buttons HD powers here, by hot button id (an HD area only, installed or not). */
const HD_HOT: Map<string, HdItem> = new Map(areaGrade() === 'hd' ? hdItems().filter((i) => i.hot).map((i) => [i.hot!, i]) : [])

/** What a hot button's tap does, and a layer row's tab: `hd`, the HD bake
 *  powers it here; `want`, HD would add it and a tap opens what HD gives
 *  (no mark shows for it: SD has no upgrade highlights). */
export type HdMark = 'hd' | 'want' | null

export function hotMark(id: string): HdMark {
  if (GRADE === 'hd') return HD_HOT.has(id) ? 'hd' : null
  if (GRADE === 'sd') {
    if (id === 'lanes') return 'want'
    if (id === 'understory' && SD_HIDDEN.includes('understory')) return 'want'
  }
  return null
}

/** A layer row's tab (ui/sheets/LayersSheet.tsx): the Hillshade row is HD where the LiDAR shade draws in it. */
export function layerMark(key: keyof LayerVisibility): HdMark {
  if (GRADE === 'hd') {
    if (key === 'hillshade') return has('hillshadeLidar') ? 'hd' : null
    if (key === 'contours') return has('contours') ? 'hd' : null
    if (key === 'lanes') return has('lanes') ? 'hd' : null
    if (key === 'understory') return bushMeasured() ? 'hd' : null
    return null
  }
  if (GRADE === 'sd') {
    if (key === 'lanes') return 'want'
    if (key === 'understory' && SD_HIDDEN.includes('understory')) return 'want'
  }
  return null
}

/** The HD tab itself, on a layer row: HD only. */
export function HdTab({ mark, className = '' }: { mark: HdMark; className?: string }): JSX.Element | null {
  if (mark !== 'hd') return null
  return (
    <span className={`grade-tab grade-tab-hd ${className}`} aria-label="HD">
      HD
    </span>
  )
}

// ---- what is live: the view in HD or not ----------------------------------

/** The middle of the view is inside this area's HD box, drawn at HD. */
export const useHdLive = create<{ inView: boolean }>(() => ({ inView: false }))

const inBox = (b: { west: number; south: number; east: number; north: number }, lon: number, lat: number) => lon >= b.west && lon <= b.east && lat >= b.south && lat <= b.north

// the page's root says it, for the weather strip's outline (grade.css)
useHdLive.subscribe((s) => {
  if (GRADE === 'hd' && s.inView) document.documentElement.dataset.hdview = '1'
  else delete document.documentElement.dataset.hdview
})

// ---- the map: the view followed, every HD box edged in gold --------------

const EDGE_SRC = 'hd-edges'
const GOLD = '#dcaa3c'

/** The HD boxes on this phone: the area in use's while installed, and every other area installed here. */
function edges(): FeatureCollection {
  const own = (a: AreaDef) => (a.id === ACTIVE_AREA.id ? GRADE === 'hd' : areaGrade(a) === 'hd' && hdInstalled(a.id))
  return {
    type: 'FeatureCollection',
    features: AREA_LIST.filter((a) => !a.virtual && own(a)).map((a) => {
      const c = a.core
      return {
        type: 'Feature',
        properties: { label: `HD · ${a.name}` },
        geometry: {
          type: 'LineString',
          coordinates: [
            [c.west, c.north],
            [c.east, c.north],
            [c.east, c.south],
            [c.west, c.south],
            [c.west, c.north],
          ],
        },
      }
    }),
  }
}

function ensureEdges(m: MlMap) {
  if (m.getSource(EDGE_SRC)) return
  m.addSource(EDGE_SRC, { type: 'geojson', data: edges() })
  m.addLayer({ id: 'hd-edge-casing', type: 'line', source: EDGE_SRC, paint: { 'line-color': 'rgba(10,20,12,0.55)', 'line-width': 4 } })
  m.addLayer({ id: 'hd-edge', type: 'line', source: EDGE_SRC, paint: { 'line-color': GOLD, 'line-width': 1.75 } })
  m.addLayer({
    id: 'hd-edge-label',
    type: 'symbol',
    source: EDGE_SRC,
    maxzoom: 13.5,
    layout: {
      'symbol-placement': 'line',
      'symbol-spacing': 420,
      'text-field': ['get', 'label'],
      'text-font': ['Noto Sans Medium'],
      'text-size': 11.5,
      'text-offset': [0, -0.8],
      'text-letter-spacing': 0.04,
    },
    paint: { 'text-color': GOLD, 'text-halo-color': 'rgba(10,20,12,0.85)', 'text-halo-width': 1.4 },
  })
}

onEachMap((m) => {
  ensureEdges(m)
  let raf = 0
  const look = () => {
    raf = 0
    const c = m.getCenter()
    const inView = GRADE === 'hd' && inBox(CORE, c.lng, c.lat)
    if (inView !== useHdLive.getState().inView) useHdLive.setState({ inView })
  }
  m.on('move', () => {
    if (!raf) raf = requestAnimationFrame(look)
  })
  look()
})

// ---- the ring on an action button ----------------------------------------

/** The ring round an action button HD powers here: gold while the view is
 *  in the HD box; nothing in SD. */
export function HotDot({ id }: { id: string }): JSX.Element | null {
  const it = HD_HOT.get(id)
  // the wind's ring stays off while Settings runs the SD wind by choice
  const lit = useHdLive((s) => !!it && GRADE === 'hd' && s.inView && !(it.id === 'wind' && terrainWind() === 'sd'))
  if (!it) return null
  return <span className={`grade-ring grade-ring-hd${lit ? ' on' : ''}`} aria-label={lit ? 'HD' : undefined} />
}

// ---- the dev builds' compare: HD off, and back on --------------------------

/** The reload that brings the other grade in, with the placed people and the walk kept (offline/downloads.ts afterChange). */
function restart() {
  carryPlaced()
  flushTrackSave()
  window.location.reload()
}

/** Take HD off the phone for this area (dev builds): its files go, and the map is SD again. */
export async function removeHd(): Promise<void> {
  for (const f of hdFiles()) await deleteStoredFile(f.file)
  setHdInstalled(ACTIVE_AREA.id, false)
  restart()
}

/** Put it back (dev builds): HD streams in again with signal, as for everyone. */
export function showHdAgain(): void {
  setHdInstalled(ACTIVE_AREA.id, true)
  restart()
}

// ---- Get HD here: a tap on the ground outside the HD box ------------------

/** km from a point to a box's nearest edge (0 inside). */
function kmToBox(b: { west: number; south: number; east: number; north: number }, lon: number, lat: number): number {
  const dx = Math.max(b.west - lon, 0, lon - b.east) * 111.32 * Math.cos((lat * Math.PI) / 180)
  const dy = Math.max(b.south - lat, 0, lat - b.north) * 111.32
  return Math.hypot(dx, dy)
}

/** An extension takes ground within this of the box. */
const EXTEND_KM = 2.5

/** The box an SD area was asked for: its id rides in the preset's note. */
function askedBox() {
  const id = /b-\d+-\d+-\d+-\d+/.exec(ACTIVE_AREA.presets.map((p) => p.note ?? '').join(' '))?.[0]
  return id ? parseBoxId(id) : null
}

function openBox(sel: Selected) {
  useAppStore.getState().closeSheet()
  setExplore(true)
  useExplore.getState().select(sel)
}

/** What the tap popup offers on the ground at a point, if anything: Extend
 *  just past an installed HD box; Get HD here elsewhere in an area. Nothing
 *  inside an installed box, nor outside every area (a tap there puts the box
 *  down itself, explore/index.ts). Nor where the area's HD is here but not
 *  installed: Install is the grade circle's, not every tap's (Gavan,
 *  2026-10-15). */
export function hdOffer(lon: number, lat: number): { label: string; run: () => void } | null {
  if (GRADE === 'live' || areaAt(lon, lat)?.id !== ACTIVE_AREA.id) return null
  if (areaGrade() === 'hd') {
    if (GRADE === 'sd' || inBox(CORE, lon, lat)) return null
    const core = boxOfBounds(CORE.west, CORE.south, CORE.east, CORE.north)
    const grown = unionBox(core, boxAround(lon, lat, 2.5, 2.5))
    if (kmToBox(CORE, lon, lat) <= EXTEND_KM && hdFits(grown)) {
      return {
        label: `Extend ${ACTIVE_AREA.name}'s HD`,
        run: () => openBox({ box: grown, lon, lat, extend: { areaId: ACTIVE_AREA.id, name: ACTIVE_AREA.name, baseKm2: sizeKm(core).km2 } }),
      }
    }
    return { label: 'Get HD here', run: () => openBox({ box: boxAround(lon, lat), lon, lat }) }
  }
  // an SD area: the box it was asked for, where the tap is in its core, else one round the tap
  const asked = askedBox()
  return { label: 'Get HD here', run: () => openBox({ box: asked && inBox(CORE, lon, lat) ? asked : boxAround(lon, lat), lon, lat }) }
}

/** Get HD for the area as a whole (an SD area's grade sheet). */
export function askHdForArea(): void {
  const lon = (CORE.west + CORE.east) / 2
  const lat = (CORE.south + CORE.north) / 2
  openBox({ box: askedBox() ?? boxOfBounds(CORE.west, CORE.south, CORE.east, CORE.north), lon, lat })
}

// ---- orders in the grade sheet -------------------------------------------

/** The order the grade sheet shows: this area's newest (an extension of it, or HD asked for over it). */
export function useAreaOrder(): HdOrder | null {
  const orders = useHdOrders((s) => s.orders)
  return (
    Object.values(orders)
      .filter((o) => o.areaId === ACTIVE_AREA.id)
      .sort((a, b) => b.at - a.at)[0] ?? null
  )
}

// ---- the sheet and the pill's word ---------------------------------------

/** What HD gives here, on top of whatever sheet is up (a layer row's tab), or alone. */
export function openGrade(focus?: string, over = false): void {
  const st = useAppStore.getState()
  if (over && st.sheets.length) st.pushSheet({ kind: 'grade', focus })
  else st.openSheet({ kind: 'grade', focus })
}

/** Show one of HD's layers: on, and the map in to where it draws (the core, z14+). */
export function showHdLayer(it: HdItem): void {
  const st = useAppStore.getState()
  if (it.layer) st.setLayer(it.layer, true)
  st.closeSheet()
  const m = getMap()
  if (!m || it.id === 'wind') return
  const c = m.getCenter()
  const inCore = inBox(CORE, c.lng, c.lat)
  const z = m.getZoom()
  if (inCore && z >= 14) return
  m.easeTo({ center: inCore ? c : [(CORE.west + CORE.east) / 2, (CORE.south + CORE.north) / 2], zoom: Math.max(z, 14.5), duration: 900 })
}

/**
 * The map's grade, the view pill's last word past a thin rule (ViewPill):
 * "Sat ▾ | HD", one pill, each part its own tap (Gavan, 2026-10-15, after a
 * round button beside the pill and a tab under the strip: "Integrate into
 * the pill with a | separator - tap on it and it bring up the goods. You'll
 * do it once by accident but generally I don't think it will be bad"). The
 * word is gold while the view is in HD, tan in SD. A tap opens the grade
 * sheet. (The loading ring that turned before it for an install or an
 * order's stages went with the install, 2026-10-17: an order's stages were
 * never readable from the phone, and the ring turned for the app's life.)
 */
export function GradeTile(): JSX.Element | null {
  const explore = useAppStore((s) => s.exploreMode)
  const inView = useHdLive((s) => s.inView)
  const order = useAreaOrder()
  if (GRADE === 'live' || explore) return null
  const gold = GRADE === 'hd' && inView
  return (
    <>
      <span className="viewpill-sep" aria-hidden="true" />
      <button type="button" className={`grade-tag ${gold ? 'grade-hd' : 'grade-sd'}`} onClick={() => openGrade()} aria-label={gold ? 'HD here: what it gives' : order ? 'HD ordered' : 'SD here: what HD adds'}>
        <span>{gold ? 'HD' : 'SD'}</span>
      </button>
    </>
  )
}

/** For the sheet: every area, the one in use first, with its grade on this phone. */
export function areaGrades(): { a: AreaDef; grade: 'hd' | 'hd-off' | 'sd' }[] {
  return AREA_LIST.filter((a) => !a.virtual).map((a) => {
    const on = a.id === ACTIVE_AREA.id ? GRADE === 'hd' : hdInstalled(a.id)
    return { a, grade: areaGrade(a) !== 'hd' ? 'sd' : on ? 'hd' : 'hd-off' }
  })
}

/** The HD ground of the box asked for, past what the area has: what an extension adds, km². */
export function addedKm2(sel: Selected): number | null {
  return sel.extend ? Math.max(0, sizeKm(sel.box).km2 - sel.extend.baseKm2) : null
}
