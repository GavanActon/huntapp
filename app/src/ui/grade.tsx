import { useEffect, useState, type JSX } from 'react'
import type { Map as MlMap } from 'maplibre-gl'
import type { FeatureCollection } from 'geojson'
import { create } from 'zustand'
import { ACTIVE_AREA, AREA_LIST, areaAt, fileUrl, type AreaDef } from '../areas'
import { bushMeasured, CORE, FINE_RELIEF, GRADE, hasSdWind, hdFiles, SD_HIDDEN, SD_PREVIEW, windSolved, areaGrade } from '../config'
import { devlog } from '../devlog'
import { setExplore } from '../explore'
import { boxAround, boxOfBounds, hdFits, parseBoxId, sizeKm, unionBox } from '../explore/box'
import { useExplore, type Selected } from '../explore/store'
import { getMap, onEachMap } from '../map/mapController'
import { deleteStoredFile, downloadToStore, listStored, requestPersistence } from '../offline/fileStore'
import { serverManifest } from '../offline/updates'
import { useAppStore, type LayerVisibility } from '../state/appStore'
import { hdInstalled, markFlip, setHdInstalled, takeFlipped } from '../state/grade'
import { orderStage, useHdOrders, type HdOrder } from '../state/hdOrders'
import { terrainWind } from '../state/terrainWind'
import { flushTrackSave } from '../tracking/trackStore'
import { carryPlaced } from '../weather/micro/scent'
import { DEV_SITE } from './DevBadge'
import './grade.css'

/**
 * HD on the map (docs/SD-HD-PLAN.md; Gavan, 2026-10-15). One rule: gold
 * means what you are looking at is HD. The action buttons HD powers wear a
 * gold ring and the weather strip a gold outline while the middle of the
 * view is inside an installed HD box, and fade off outside it; each HD box
 * on the phone is edged in gold on the map. SD shows no upgrade highlights.
 * The grade circle by the view pill is gold or tan to match and opens the
 * grade sheet: Install for an HD area not installed (the files really
 * download, a ring lighting as each lands, then one reload), what HD adds
 * and Get HD for an SD one, an order's stages, and every area. A tap on
 * ground outside the HD box offers Get HD here, or Extend next to the box
 * (hdOffer).
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
      sdNote: hasSdWind() ? 'Not installed: the SD wind model runs here.' : 'Runs here already: no SD wind was baked for this area.',
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
      sdNote: 'Not installed: the 30 m shade draws here.',
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
      sdNote: 'Not installed: the 30 m contours draw here.',
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
      sdNote: 'Not installed: no lanes yet.',
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
      sdNote: 'Not installed: no bush layer yet.',
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
export type HotDotMark = HdMark

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

// ---- what is live: the view in HD or not, an install running ------------

interface HdLive {
  /** the middle of the view is inside this area's HD box, and it is installed */
  inView: boolean
  installing: boolean
  /** the items whose files have landed in this install */
  done: HdItem['id'][]
  /** the item whose file is coming now */
  now: HdItem['id'] | null
  /** bytes of the whole install, landed and in all */
  loaded: number
  total: number
  /** everything in: gold all round for a moment, then the reload */
  finishing: boolean
  error: string | null
}

export const useHdLive = create<HdLive>(() => ({ inView: false, installing: false, done: [], now: null, loaded: 0, total: 0, finishing: false, error: null }))

const inBox = (b: { west: number; south: number; east: number; north: number }, lon: number, lat: number) => lon >= b.west && lon <= b.east && lat >= b.south && lat <= b.north

// the page's root says it, for the weather strip's outline (grade.css)
useHdLive.subscribe((s) => {
  if ((GRADE === 'hd' && s.inView) || s.finishing) document.documentElement.dataset.hdview = '1'
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
 *  in the HD box, and as its file lands during an install; nothing in SD. */
export function HotDot({ id }: { id: string }): JSX.Element | null {
  const it = HD_HOT.get(id)
  const lit = useHdLive((s) => {
    if (!it) return false
    if (s.finishing || s.done.includes(it.id)) return true
    // the wind's ring stays off while Settings runs the SD wind by choice
    return GRADE === 'hd' && s.inView && !(it.id === 'wind' && terrainWind() === 'sd')
  })
  if (!it) return null
  return <span className={`grade-ring grade-ring-hd${lit ? ' on' : ''}`} aria-label={lit ? 'HD' : undefined} />
}

// ---- install and remove ---------------------------------------------------

const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms))

/** About how much an install fetches, bytes: the bake's own count of each file. */
export function installBytes(a: AreaDef = ACTIVE_AREA): number {
  const cov = a.coverage
  return hdFiles(a).reduce((n, f) => n + (f.key === 'micro' ? (cov?.grids.micro?.bytes ?? 0) : (cov?.pmtiles[f.key]?.bytes ?? 0)), 0)
}

const ITEM_OF: Record<string, HdItem['id']> = { micro: 'wind', hillshadeLidar: 'shade', contours: 'contours', lanes: 'lanes', understory: 'bush' }

/** The reload that brings the new grade in, with the placed people and the walk kept (offline/downloads.ts afterChange). */
function restart(f: 'installed' | 'removed') {
  markFlip(f)
  carryPlaced()
  flushTrackSave()
  window.location.reload()
}

/** Install HD here: each HD file downloaded to the phone (one already on it
 *  counts at once), its ring lit as it lands, then gold all round and the
 *  reload that draws it. */
export async function installHd(): Promise<void> {
  const live = useHdLive
  if (live.getState().installing || !SD_PREVIEW) return
  if (!window.isSecureContext) {
    live.setState({ error: 'Installing needs a secure page: open the app over https.' })
    return
  }
  live.setState({ installing: true, done: [], now: null, loaded: 0, total: 0, finishing: false, error: null })
  try {
    await requestPersistence()
    const files = hdFiles()
    const stored = new Set(listStored().map((x) => x.name))
    const manifest = await serverManifest(ACTIVE_AREA.id)
    const size = (file: string) => manifest?.files[file]?.size ?? 0
    const total = files.reduce((n, f) => n + (stored.has(f.file) ? 0 : size(f.file)), 0) || installBytes()
    live.setState({ total })
    let before = 0
    for (const f of files) {
      const item = ITEM_OF[f.key]
      live.setState({ now: item })
      if (stored.has(f.file)) {
        await wait(450)
      } else if (manifest && !manifest.files[f.file]) {
        devlog('hd', `install: ${f.file} not on the server, skipped`)
        await wait(300)
      } else {
        await downloadToStore(fileUrl(f.file), f.file, (loaded) => live.setState({ loaded: before + loaded }), undefined, manifest?.files[f.file]?.hash)
        before += size(f.file)
      }
      live.setState({ done: [...live.getState().done, item], loaded: Math.max(before, live.getState().loaded) })
    }
    setHdInstalled(ACTIVE_AREA.id, true)
    live.setState({ finishing: true, now: null })
    devlog('hd', `installed for ${ACTIVE_AREA.id} · ${files.length} files`)
    await wait(1800)
    restart('installed')
  } catch (e) {
    live.setState({ installing: false, now: null, error: `The install stopped${e instanceof Error && e.message ? ` (${e.message})` : ''}. Try again with signal.` })
  }
}

/** Take HD off the phone for this area (dev builds): its files go, and the map is SD again. */
export async function removeHd(): Promise<void> {
  for (const f of hdFiles()) await deleteStoredFile(f.file)
  setHdInstalled(ACTIVE_AREA.id, false)
  restart('removed')
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

// ---- orders on the grade circle ------------------------------------------

/** The order the grade circle shows: this area's newest (an extension of it, or HD asked for over it). */
export function useAreaOrder(): HdOrder | null {
  const orders = useHdOrders((s) => s.orders)
  return (
    Object.values(orders)
      .filter((o) => o.areaId === ACTIVE_AREA.id)
      .sort((a, b) => b.at - a.at)[0] ?? null
  )
}

/** A clock for an order's stages: a tick a second while one is being built. */
export function useOrderTick(o: HdOrder | null): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!o || orderStage(o).stage === 'ready') return
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [o])
  return now
}

// ---- the sheet, the circle, the chip -------------------------------------

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
 * word is gold while the view is in HD, tan in SD. A gold loading ring turns
 * before it while HD installs or is being built (Gavan: "Instead of a bar it
 * should be a loading"); built and waiting to install, the word breathes.
 * A tap opens the grade sheet.
 */
export function GradeTile(): JSX.Element | null {
  const explore = useAppStore((s) => s.exploreMode)
  const inView = useHdLive((s) => s.inView)
  const finishing = useHdLive((s) => s.finishing)
  const installing = useHdLive((s) => s.installing)
  const order = useAreaOrder()
  const now = useOrderTick(order)
  if (GRADE === 'live' || explore) return null
  const gold = (GRADE === 'hd' && inView) || finishing
  const st = order ? orderStage(order, now) : null
  const loading = (installing && !finishing) || (!gold && st != null && st.stage !== 'ready')
  return (
    <>
      <span className="viewpill-sep" aria-hidden="true" />
      <button
        type="button"
        className={`grade-tag ${gold ? 'grade-hd' : 'grade-sd'}${st?.stage === 'ready' && !gold ? ' grade-ready' : ''}`}
        onClick={() => openGrade()}
        aria-label={gold ? 'HD here: what it gives' : installing ? 'Installing HD' : order ? 'HD being built' : 'SD here: what HD adds'}
      >
        {loading && <i className="grade-spin" aria-hidden="true" />}
        <span>{gold ? 'HD' : 'SD'}</span>
      </button>
    </>
  )
}

/** Just installed or removed: a few seconds of what came on or went, in the top bar. */
export function GradeFlipChip(): JSX.Element | null {
  const [f] = useState(takeFlipped)
  const [up, setUp] = useState(f != null)
  useEffect(() => {
    if (!up) return
    const t = window.setTimeout(() => setUp(false), 8000)
    return () => window.clearTimeout(t)
  }, [up])
  if (!up || !f) return null
  const names: Record<HdItem['id'], string> = { wind: 'wind solve', shade: ARCTIC ? '2 m shade' : 'LiDAR shade', contours: '1 m contours', lanes: 'lanes', bush: 'bush' }
  const list = hdItems()
    .map((i) => names[i.id])
    .join(', ')
  return (
    <button type="button" className={`chip grade-chip grade-chip-${f === 'installed' ? 'hd' : 'sd'}`} onClick={() => openGrade()}>
      <b>{f === 'installed' ? 'HD installed' : 'HD removed'}</b>
      {list ? ` · ${list}` : ''}
    </button>
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
