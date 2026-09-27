import { Fragment } from 'react'
import { sourceModes } from '../../map/pmtilesRegistry'
import { geoModes } from '../../map/MapView'
import { LIVE_RASTER, LIVE_VECTOR } from '../../sources'
import { useAppStore, type LayerOpacity, type LayerVisibility } from '../../state/appStore'

interface LayerDef {
  key: keyof LayerVisibility
  name: string
  desc: string
  opacity?: keyof LayerOpacity
  /** the pmtiles key this layer is baked into, for the status word */
  data?: string
  live?: keyof typeof LIVE_RASTER | keyof typeof LIVE_VECTOR
}

const GROUPS: { title: string; defs: LayerDef[] }[] = [
  {
    title: 'Terrain',
    defs: [
      { key: 'topo', name: 'Topographic', desc: 'Contour lines and spot elevations (NRCan Toporama)', opacity: 'topo', data: 'topo', live: 'topo' },
      { key: 'hillshade', name: 'Hillshade', desc: 'Relief · 1 m LiDAR (2021) near camp, 30 m MRDEM around', opacity: 'hillshade', data: 'hillshade', live: 'hillshade' },
      { key: 'contours', name: 'LiDAR contours', desc: 'Every metre near camp, from the 2021 LiDAR · interval in Settings', data: 'contours' },
      { key: 'satellite', name: 'Imagery', desc: 'Ontario orthophoto mosaic', opacity: 'satellite', data: 'satellite', live: 'satellite' },
    ],
  },
  {
    title: 'Bush & water',
    defs: [
      { key: 'forest', name: 'Forest cover', desc: 'Stands by species and age, burns, cuts (Ontario FRI 2010)', opacity: 'forest', data: 'forest' },
      {
        key: 'understory',
        name: 'Bush thickness',
        desc: 'How thick the 0.5–3 m layer is, from the Sept 2021 LiDAR point cloud · pale open, deep red thicket · 2 km around camp so far · zoom in',
        opacity: 'understory',
        data: 'understory',
      },
      { key: 'fire', name: 'Burns', desc: 'Fire perimeters by year (MNRF)', data: 'places', live: 'fire' },
      { key: 'bathy', name: 'Lake depths', desc: 'MNR survey sheets for Pickle, Ketchup and McGill (1978–79), estimated depths elsewhere', data: 'bathySheets', live: 'bathy' },
    ],
  },
  {
    title: 'History',
    defs: [{ key: 'historical', name: 'Historical topo', desc: 'Old NTS sheets 042C13 / 042C14, georeferenced', opacity: 'historical', data: 'historical', live: 'historical' }],
  },
  {
    title: 'Land',
    defs: [
      { key: 'camps', name: 'Camps', desc: 'Outpost and recreation camp land use permits, cottages', data: 'places', live: 'camps' },
      { key: 'wmu', name: 'WMU boundaries', desc: 'Wildlife Management Units · here 21B', data: 'places', live: 'wmu' },
      { key: 'crown', name: 'Private land', desc: 'Patented parcels · the rest is Crown', data: 'places', live: 'crown' },
      { key: 'parks', name: 'Parks', desc: 'Provincial parks and conservation reserves', data: 'places', live: 'parks' },
      { key: 'roads', name: 'Bush roads', desc: 'MNRF forest access roads · 9,400 segments, baked only', data: 'places' },
    ],
  },
  {
    title: 'Weather',
    defs: [
      { key: 'windFlow', name: 'Wind flow', desc: 'Wind streaming over the map at the picked hour: at head height (terrain, trees, cold-air drainage) or the HRDPS forecast at 10 m', live: 'radar' },
      { key: 'weather', name: 'Radar', desc: 'Rain rate, latest sweep (ECCC)', live: 'radar' },
    ],
  },
]

function status(d: LayerDef): string {
  const pm = d.data ? sourceModes.get(d.data) : undefined
  const mode = pm && pm !== 'missing' ? pm : geoModes.get(d.key)
  if (mode === 'local') return 'on this phone'
  if (mode === 'network') return 'baked · online'
  if (d.live && (d.live in LIVE_RASTER || d.live in LIVE_VECTOR)) return 'live'
  return 'not built yet'
}

export default function LayersPanel() {
  const layers = useAppStore((s) => s.layers)
  const setLayer = useAppStore((s) => s.setLayer)
  const opacity = useAppStore((s) => s.opacity)
  const setOpacity = useAppStore((s) => s.setOpacity)
  const windLevel = useAppStore((s) => s.windLevel)
  const setWindLevel = useAppStore((s) => s.setWindLevel)

  return (
    <div className="panel">
      {GROUPS.map((g, gi) => (
        <Fragment key={g.title}>
          <div className={`panel-section${gi === 0 ? ' panel-section-first' : ''}`}>{g.title}</div>
          {g.defs.map((d) => {
            const st = status(d)
            const dead = st === 'not built yet'
            return (
              <Fragment key={d.key}>
                <label className="row">
                  <div className="row-text">
                    <span className="row-title">{d.name}</span>
                    <span className="row-desc">
                      {d.desc} · <em>{st}</em>
                    </span>
                  </div>
                  <input type="checkbox" className="switch" checked={layers[d.key] && !dead} disabled={dead} onChange={(e) => setLayer(d.key, e.target.checked)} />
                </label>
                {d.key === 'windFlow' && layers.windFlow && (
                  <div className="row layer-opacity">
                    <div className="row-text">
                      <span className="row-desc">{windLevel === 'ground' ? 'Head height: the ground model' : 'HRDPS 2.5 km at 10 m'}</span>
                    </div>
                    <div className="seg">
                      <button className={windLevel === 'ground' ? 'seg-on' : ''} onClick={() => setWindLevel('ground')}>
                        Ground
                      </button>
                      <button className={windLevel === 'forecast' ? 'seg-on' : ''} onClick={() => setWindLevel('forecast')}>
                        Forecast
                      </button>
                    </div>
                  </div>
                )}
                {d.opacity && layers[d.key] && !dead && (
                  <div className="row layer-opacity">
                    <div className="row-text">
                      <span className="row-desc">Opacity · {Math.round(opacity[d.opacity] * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min={10}
                      max={100}
                      step={5}
                      value={Math.round(opacity[d.opacity] * 100)}
                      onChange={(e) => setOpacity(d.opacity!, Number(e.target.value) / 100)}
                    />
                  </div>
                )}
              </Fragment>
            )
          })}
        </Fragment>
      ))}
    </div>
  )
}
