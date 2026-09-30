import { Fragment, useMemo, useState, type JSX } from 'react'
import { sourceModes } from '../../map/pmtilesRegistry'
import { geoModes } from '../../map/MapView'
import { LIVE_RASTER, LIVE_VECTOR } from '../../sources'
import { useAppStore, type LayerOpacity, type LayerVisibility } from '../../state/appStore'
import { useSpotsStore } from '../../state/spotsStore'
import { baseView, useViews } from '../../state/viewsStore'
import { TARGET_NAMES } from '../../spots/types'
import { IconStar } from '../icons'
import './layers.css'

/**
 * Edit this view: the layers you starred at the top, on or off, then the
 * ones the map is drawing now under `On`, each with its switch (a name with
 * a strength opens its strength and colour sliders in place), the rest
 * folded away in four groups, and at the foot a way to keep the result as a
 * view of its own, put it back on a saved one, or reset to the view the
 * map was set to. The wind flow is not here: it has its own button on the
 * map.
 */

interface LayerDef {
  key: keyof LayerVisibility
  name: string
  opacity?: keyof LayerOpacity
  /** the pmtiles key this layer is baked into, for the status word */
  data?: string
  live?: keyof typeof LIVE_RASTER | keyof typeof LIVE_VECTOR
}

const GROUPS: { title: string; defs: LayerDef[] }[] = [
  {
    title: 'Terrain',
    defs: [
      { key: 'topo', name: 'Topographic', opacity: 'topo', data: 'topo', live: 'topo' },
      { key: 'hillshade', name: 'Hillshade', opacity: 'hillshade', data: 'hillshade', live: 'hillshade' },
      { key: 'relief', name: 'Elevation colours', opacity: 'relief', data: 'dem' },
      { key: 'contours', name: 'LiDAR contours', data: 'contours' },
      { key: 'satellite', name: 'Imagery', opacity: 'satellite', data: 'satellite', live: 'satellite' },
    ],
  },
  {
    title: 'Bush & water',
    defs: [
      { key: 'forest', name: 'Forest cover', opacity: 'forest', data: 'forest' },
      { key: 'understory', name: 'Bush thickness', opacity: 'understory', data: 'understory' },
      { key: 'lanes', name: 'Shooting lanes', opacity: 'lanes', data: 'lanes' },
      { key: 'fire', name: 'Burns', data: 'places', live: 'fire' },
      { key: 'bathy', name: 'Lake depths', data: 'bathySheets', live: 'bathy' },
    ],
  },
  {
    title: 'Land',
    defs: [
      { key: 'camps', name: 'Camps', data: 'places', live: 'camps' },
      { key: 'wmu', name: 'WMU boundaries', data: 'places', live: 'wmu' },
      { key: 'crown', name: 'Private land', data: 'places', live: 'crown' },
      { key: 'parks', name: 'Parks', data: 'places', live: 'parks' },
      { key: 'roads', name: 'Bush roads', data: 'places' },
    ],
  },
  {
    title: 'Old maps & radar',
    defs: [
      { key: 'historical', name: 'Historical topo', opacity: 'historical', data: 'historical', live: 'historical' },
      { key: 'weather', name: 'Radar', live: 'radar' },
    ],
  },
]

const DEFS: Record<string, LayerDef> = Object.fromEntries(GROUPS.flatMap((g) => g.defs).map((d) => [d.key, d]))

/** The `On` list's order, roughly the draw order from the ground up; the
 *  heat map sits among the bush layers (Layers.dc.html). */
const ON_ORDER: (keyof LayerVisibility | 'heat')[] = [
  'satellite',
  'topo',
  'hillshade',
  'relief',
  'forest',
  'understory',
  'lanes',
  'heat',
  'contours',
  'fire',
  'bathy',
  'historical',
  'camps',
  'wmu',
  'crown',
  'parks',
  'roads',
  'weather',
]

function status(d: LayerDef): string {
  const pm = d.data ? sourceModes.get(d.data) : undefined
  const mode = pm && pm !== 'missing' ? pm : geoModes.get(d.key)
  if (mode === 'local') return 'on this phone'
  if (mode === 'network') return 'baked · online'
  if (d.live && (d.live in LIVE_RASTER || d.live in LIVE_VECTOR)) return 'live'
  return 'not built yet'
}

export default function LayersSheet(): JSX.Element {
  const layers = useAppStore((s) => s.layers)
  const setLayer = useAppStore((s) => s.setLayer)
  const opacity = useAppStore((s) => s.opacity)
  const setOpacity = useAppStore((s) => s.setOpacity)
  const saturation = useAppStore((s) => s.saturation)
  const setSaturation = useAppStore((s) => s.setSaturation)
  const starred = useAppStore((s) => s.starred)
  const toggleStar = useAppStore((s) => s.toggleStar)
  const closeSheet = useAppStore((s) => s.closeSheet)
  const mode = useViews((s) => s.mode)
  const saved = useViews((s) => s.saved)
  const lastViewId = useViews((s) => s.lastViewId)
  const apply = useViews((s) => s.apply)
  const saveCurrent = useViews((s) => s.saveCurrent)
  const update = useViews((s) => s.update)
  const heat = useSpotsStore((s) => s.heat)
  const setHeat = useSpotsStore((s) => s.setHeat)
  const target = useSpotsStore((s) => s.target)
  /** the layer whose strength slider is open */
  const [slider, setSlider] = useState<keyof LayerVisibility | null>(null)
  const [unfolded, setUnfolded] = useState<Set<string>>(() => new Set())

  const base = useMemo(() => baseView(), [mode, saved, lastViewId])
  const name = base?.name ?? 'Custom'
  const dead = useMemo(() => new Set(Object.values(DEFS).filter((d) => status(d) === 'not built yet').map((d) => d.key)), [])

  const isOn = (k: keyof LayerVisibility) => layers[k] === true && !dead.has(k)

  function toggleGroup(title: string) {
    setUnfolded((s) => {
      const n = new Set(s)
      if (n.has(title)) n.delete(title)
      else n.add(title)
      return n
    })
  }

  /** A name tap: the strength slider for a layer that has one and is on;
   *  otherwise the switch. */
  function tapName(d: LayerDef) {
    if (d.opacity && isOn(d.key)) setSlider(slider === d.key ? null : d.key)
    else if (!dead.has(d.key)) setLayer(d.key, !layers[d.key])
  }

  function row(d: LayerDef): JSX.Element {
    const on = isOn(d.key)
    const off = dead.has(d.key)
    const open = slider === d.key && on && d.opacity != null
    const star = starred.includes(d.key)
    const sat = d.opacity ? (saturation[d.opacity] ?? 0) : 0
    return (
      <Fragment key={d.key}>
        <div className={`layers-row${off ? ' layers-dead' : ''}`}>
          <button className="layers-name" onClick={() => tapName(d)} disabled={off} aria-expanded={d.opacity && on ? open : undefined}>
            <span>{d.name}</span>
          </button>
          <button className={`layers-star${star ? ' on' : ''}`} onClick={() => toggleStar(d.key)} aria-pressed={star} aria-label={star ? `Unstar ${d.name}` : `Star ${d.name}`}>
            <IconStar size={16} />
          </button>
          <input
            type="checkbox"
            className="switch"
            checked={on}
            disabled={off}
            onChange={(e) => {
              setLayer(d.key, e.target.checked)
              if (!e.target.checked && slider === d.key) setSlider(null)
            }}
          />
        </div>
        {open && d.opacity && (
          <div className="layers-slider layer-opacity">
            <input
              type="range"
              min={10}
              max={100}
              step={5}
              value={Math.round(opacity[d.opacity] * 100)}
              onChange={(e) => setOpacity(d.opacity!, Number(e.target.value) / 100)}
              aria-label={`${d.name} strength`}
            />
            <span className="numeral dim">{Math.round(opacity[d.opacity] * 100)}%</span>
          </div>
        )}
        {open && d.opacity && (
          <div className="layers-slider layer-opacity">
            <input
              type="range"
              min={-100}
              max={100}
              step={10}
              value={Math.round(sat * 100)}
              onChange={(e) => setSaturation(d.opacity!, Number(e.target.value) / 100)}
              aria-label={`${d.name} colour`}
            />
            <span className="numeral dim">{sat === 0 ? 'colour' : `${sat > 0 ? '+' : ''}${Math.round(sat * 100)}`}</span>
          </div>
        )}
      </Fragment>
    )
  }

  // the heat map has no group to fold into, so its row stays under On
  // either way; the swatches show while it draws
  const heatRow = (
    <label className="layers-row" key="heat">
      <span className="layers-name">
        <span>{TARGET_NAMES[target]} heat map</span>
        {heat && (
          <span className="spots-legend" aria-hidden="true">
            <i className="b1" />
            <i className="b2" />
            <i className="b3" />
          </span>
        )}
      </span>
      <input type="checkbox" className="switch" checked={heat} onChange={(e) => setHeat(e.target.checked)} />
    </label>
  )

  // starred layers sit at the top, on or off, and nowhere else
  const starRows = ON_ORDER.filter((k): k is keyof LayerVisibility => k !== 'heat' && starred.includes(k)).map((k) => row(DEFS[k]))
  const onRows = ON_ORDER.map((k) => (k === 'heat' ? heatRow : isOn(k) && !starred.includes(k) ? row(DEFS[k]) : null))

  return (
    <div className="layers">
      <div className="sheet-head">
        <h2>{name} layers</h2>
        <button className="sheet-done" onClick={closeSheet}>
          Done
        </button>
      </div>

      {starRows.length > 0 && (
        <>
          <div className="layers-sec">Starred</div>
          <div className="layers-list">{starRows}</div>
        </>
      )}
      <div className="layers-sec">On</div>
      <div className="layers-list">{onRows}</div>

      <div className="layers-groups">
        {GROUPS.map((g) => {
          const offDefs = g.defs.filter((d) => !isOn(d.key) && !starred.includes(d.key))
          if (offDefs.length === 0) return null
          const open = unfolded.has(g.title)
          return (
            <Fragment key={g.title}>
              <button className="layers-row layers-group" onClick={() => toggleGroup(g.title)} aria-expanded={open}>
                <span>{g.title}</span>
                <span className={`dim layers-chev${open ? ' open' : ''}`}>›</span>
              </button>
              {open && <div className="layers-list layers-sub">{offDefs.map(row)}</div>}
            </Fragment>
          )
        })}
      </div>

      <div className="layers-foot">
        <button
          className="layers-link"
          onClick={() => {
            const n = prompt('Name this view', base ? `${base.name} 2` : 'My view')?.trim()
            if (n) saveCurrent(n)
          }}
        >
          Save as new view
        </button>
        {base && !base.builtIn && (
          <button className="layers-link" onClick={() => update(base.id)}>
            Update {base.name}
          </button>
        )}
        {base && (
          <button className="layers-link dim" onClick={() => apply(base)}>
            Reset {base.name}
          </button>
        )}
      </div>
    </div>
  )
}
