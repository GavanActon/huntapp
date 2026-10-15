import { useEffect, useState, type JSX } from 'react'
import { ACTIVE_AREA } from '../areas'
import { bushMeasured, CORE, FINE_RELIEF, GRADE, HD_PMTILES, hasSdWind, SD_HIDDEN, SD_PREVIEW, sdWindOn, windSolved, areaGrade } from '../config'
import { getMap } from '../map/mapController'
import { useAppStore, type LayerVisibility } from '../state/appStore'
import { switchGrade, takeFlipped } from '../state/grade'
import { DEV_SITE } from './DevBadge'
import './grade.css'

/**
 * HD and SD on the map (docs/SD-HD-PLAN.md). One mark says HD everywhere:
 * the small HD tab, filled on what the HD bake powers here, outlined on
 * what HD would add where the map is SD. No locks: an SD map works in full,
 * and the outlined tab opens what HD gives (ui/sheets/GradeSheet.tsx). The
 * grade tile by the view pill says which the map is. On the dev site (and
 * the dev server) it is a switch: an HD area shown as SD to see what HD
 * adds, a reload either way (state/grade.ts).
 */

/** The switch is offered for testing only: hunt-dev and the dev server. */
export const GRADE_SWITCH = DEV_SITE || import.meta.env.DEV

/** One thing HD gives at this spot, as the grade sheet lists it. */
export interface HdItem {
  id: 'wind' | 'shade' | 'contours' | 'lanes' | 'bush'
  /** the hot button it powers, which wears the HD tab */
  hot?: string
  /** the map layer that shows it */
  layer?: keyof LayerVisibility
  title: string
  line: string
  /** where it came from, from the bake's coverage report */
  source?: string
  /** how it stands while the map is shown as SD */
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
      { id: 'wind', title: 'Wind solved for your ground', line: 'WindNinja runs the full solve over the box. It finds the lee behind rises and the bend round hills.' },
      { id: 'shade', title: 'Old roads under the trees', line: 'A 1 m LiDAR shade, where LiDAR has been flown. Old logging roads and trails show through the canopy.' },
      { id: 'contours', title: 'Contours every metre', line: 'The draws cold air drains down and the benches a moose beds on.' },
      { id: 'lanes', hot: 'lanes', layer: 'lanes', title: 'Shooting lanes', line: 'Where you can see and shoot, measured from the LiDAR point cloud.' },
      { id: 'bush', title: 'Bush measured at eye level', line: 'Bush thickness from the point cloud, where SD has the national model.' },
    ]
  }
  const out: HdItem[] = []
  if (windSolved()) {
    out.push({
      id: 'wind',
      hot: 'windflow',
      layer: 'windFlow',
      title: 'Wind solved for this ground',
      line: 'WindNinja ran the full solve here. It finds the lee behind rises and the bend round hills, at head height.',
      source: 'WindNinja momentum solve, under the HRDPS forecast',
      sdNote: hasSdWind() ? 'On the SD wind model now.' : 'Stays HD: no SD wind was baked for this area.',
    })
  }
  if (has('hillshadeLidar')) {
    out.push({
      id: 'shade',
      layer: 'hillshade',
      title: ARCTIC ? 'Every bench and draw' : 'Old roads under the trees',
      line: ARCTIC ? `${FINE_RELIEF.name} shade, far sharper than the 30 m national relief.` : `${FINE_RELIEF.name} shade. Old logging roads and trails show through the canopy.`,
      source: sourceOf('hillshadeLidar') ?? FINE_RELIEF.attribution,
      sdNote: 'Off. SD draws the 30 m shade.',
    })
  }
  if (has('contours')) {
    out.push({
      id: 'contours',
      hot: 'contours',
      layer: 'contours',
      title: 'Contours every metre',
      line: `From ${FINE_RELIEF.name}. The draws cold air drains down and the benches a moose beds on.`,
      source: sourceOf('contours'),
      sdNote: 'SD draws the 30 m contours.',
    })
  }
  if (has('lanes')) {
    out.push({
      id: 'lanes',
      hot: 'lanes',
      layer: 'lanes',
      title: 'Shooting lanes',
      line: point('lanes') ? 'Where you can see and shoot, measured from the LiDAR point cloud.' : "Where you can see and shoot, from this area's own bush model at 10 m.",
      source: sourceOf('lanes'),
      sdNote: 'Off. SD has no lanes.',
    })
  }
  if (bushMeasured()) {
    out.push({
      id: 'bush',
      hot: 'understory',
      layer: 'understory',
      title: point('understory') ? 'Bush measured at eye level' : 'Bush mapped for this ground',
      line: point('understory') ? 'Bush thickness from the LiDAR point cloud.' : 'Bush thickness from a model trained on this ground.',
      source: sourceOf('understory'),
      sdNote: "Off. SD's modelled bush was not baked here.",
    })
  }
  return out
}

/** What the map leaves out this run while shown as SD, by item. */
export function offInSd(it: HdItem): boolean {
  if (!SD_PREVIEW) return false
  if (it.id === 'wind') return hasSdWind()
  const key = { shade: 'hillshadeLidar', contours: 'contours', lanes: 'lanes', bush: 'understory' }[it.id]
  return SD_HIDDEN.includes(key)
}

/** The HD tab on a hot button or a layer row: `hd` filled, the HD bake
 *  draws it here; `want` outlined, HD would add it (the tap opens what HD
 *  gives); null for the rest. */
export type HdMark = 'hd' | 'want' | null

const HD_HOT: Set<string> = new Set(GRADE === 'hd' ? hdItems().filter((i) => i.hot && !(i.id === 'wind' && sdWindOn())).map((i) => i.hot!) : [])
const WANT_HOT: Set<string> = new Set(GRADE === 'sd' ? ['lanes', ...(SD_HIDDEN.includes('understory') ? ['understory'] : [])] : [])

export function hotMark(id: string): HdMark {
  return HD_HOT.has(id) ? 'hd' : WANT_HOT.has(id) ? 'want' : null
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

/** The tab itself. */
export function HdTab({ mark, className = '' }: { mark: HdMark; className?: string }): JSX.Element | null {
  if (!mark) return null
  return (
    <span className={`grade-tab grade-tab-${mark} ${className}`} aria-label={mark === 'hd' ? 'HD' : 'Comes with HD'}>
      HD
    </span>
  )
}

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
  const inCore = c.lng >= CORE.west && c.lng <= CORE.east && c.lat >= CORE.south && c.lat <= CORE.north
  const z = m.getZoom()
  if (inCore && z >= 14) return
  m.easeTo({ center: inCore ? c : [(CORE.west + CORE.east) / 2, (CORE.south + CORE.north) / 2], zoom: Math.max(z, 14.5), duration: 900 })
}

/**
 * The grade tile by the view pill: HD filled in the brand's gold, SD plain.
 * A tap opens what HD gives here. With the switch on (the dev site), both
 * halves show: the lit one opens the sheet, the other switches the map.
 */
export function GradeTile(): JSX.Element | null {
  const explore = useAppStore((s) => s.exploreMode)
  if (GRADE === 'live' || explore) return null
  const native = areaGrade()
  if (!GRADE_SWITCH) {
    return (
      <button type="button" className={`grade-tile grade-${GRADE} glass`} onClick={() => openGrade()} aria-label={GRADE === 'hd' ? 'This area is HD' : 'This area is SD: what HD adds'}>
        {GRADE === 'hd' ? 'HD' : 'SD'}
      </button>
    )
  }
  const half = (g: 'sd' | 'hd') => {
    const lit = GRADE === g
    const can = native === 'hd'
    return (
      <button
        type="button"
        className={`grade-half${lit ? ` grade-lit grade-${g}` : ''}${!lit && !can ? ' grade-none' : ''}`}
        aria-pressed={lit}
        aria-label={lit ? `Shown as ${g.toUpperCase()}: what HD gives here` : can ? `Show as ${g.toUpperCase()}` : 'No HD bake here: what HD adds'}
        onClick={() => (lit || !can ? openGrade() : switchGrade(g))}
      >
        {g.toUpperCase()}
      </button>
    )
  }
  return (
    <div className="grade-split glass" role="group" aria-label="Map grade">
      {half('sd')}
      {half('hd')}
    </div>
  )
}

/** Just switched: a few seconds of what came on or went, in the top bar. */
export function GradeFlipChip(): JSX.Element | null {
  const [g] = useState(takeFlipped)
  const [up, setUp] = useState(g != null)
  useEffect(() => {
    if (!up) return
    const t = window.setTimeout(() => setUp(false), 8000)
    return () => window.clearTimeout(t)
  }, [up])
  if (!up || !g) return null
  const words = hdItems().filter((i) => (g === 'hd' ? true : offInSd(i)))
  const names: Record<HdItem['id'], string> = { wind: 'wind solve', shade: ARCTIC ? '2 m shade' : 'LiDAR shade', contours: '1 m contours', lanes: 'lanes', bush: 'measured bush' }
  const list = words.map((i) => names[i.id]).join(', ')
  return (
    <button type="button" className={`chip grade-chip grade-chip-${g}`} onClick={() => openGrade()}>
      <b>{g === 'hd' ? 'HD' : 'SD'}</b>
      {g === 'hd' ? (list ? ` · ${list}` : ' on') : list ? ` · off: ${list}` : ' · nothing HD here to turn off'}
    </button>
  )
}

/** For devlog and the sheet: which HD layers the area has at all. */
export const HD_LAYERS_HERE = HD_PMTILES.filter((k) => has(k))
