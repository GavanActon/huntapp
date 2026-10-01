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

/** What the things drawn on the map mean: kept off the cards (which say only what is so right now) and folded up here. */
const ABOUT: { title: string; body: string[] }[] = [
  {
    title: 'Scent cone',
    body: [
      "Scent at a deer's nose over a ten-minute sit: deep orange is strong, the pale wash only a trace. It follows the ground model at head height (terrain, trees, cold air draining, lake breezes), not the forecast arrow, so it bends down a drainage and pools in a hollow.",
      "Cloud shows everyone's scent together: where cones overlap it adds up. Particles shows each puff drifting off you, widening as it goes; the dashed line is where it stops being noticeable. By person draws each person's noticeable edge in their own colour over the cloud.",
      'With several people: drag a number to move them, or Move and tap. Distances draws the metres between them. The card can be minimised; the Scent button then carries a mark, and a long press brings the card back. Tapping the Scent button hides and shows every cone at once.',
    ],
  },
  {
    title: 'Sharpening the wind',
    body: [
      'A check of what the air really does: a puff of powder, which way it goes and how hard. Each one corrects the ground model near it for the next hour or two (half the wind where it was made, less farther out, fading over about forty minutes) and scores the model, so over a season the app can say how often it gets a stand right. The Weather tab keeps the tally.',
      'On the map a check is an arrow the way the powder went (a ring for calm) with a dashed ring as far as it still counts; the ring shrinks as it ages and goes when it is spent. Tap the arrow for what it says and to remove it. A new check within 100 m replaces the earlier ones there, so one arrow shows.',
      'On the card the rose turns with the phone while its compass is steady, and stops at the first pick. The compass is not to be trusted held up to point, so the map is the reference: "ahead" then a tap on the map in front of you turns the rose to face that way, and a tap on the map where the powder went is the direction itself. A second arrow or tap is the arc the wind swung through.',
      "A party's checks combine: share yours from the Weather tab and take in a partner's; every check counts the same, so the side with more checks nearby carries the direction, and checks that disagree widen the spread rather than average to a wind nobody felt.",
    ],
  },
  {
    title: 'The moose on the map',
    body: [
      'Each sound you log is a dot where it came from, with the time and what it was, and a faint line back to where you stood. The sounds join up in order into his route, so the way he is moving shows; with two sounds in half an hour an arrow draws the way he is heading.',
      'The red dashed line is his likeliest way round to your scent: through cover, off open ground in your sight, holding off at the range where bulls hang up, ending where your scent is noticeable at his nose. A bull on a call often circles to wind the caller before he shows. Watch where it meets your scent, and put the shooter on that side.',
      'Dots drag: a finger down on one and a slide moves it, and the bearing and distance from where you stood follow it.',
    ],
  },
  {
    title: 'The hunt log on the map',
    body: [
      'A dot per entry, coloured by what happened: seen and called in bright, heard and sign softer, blank sits hollow, with the species\' first letter, fading over three weeks.',
      'A sighting, a sound, sign or a call-in pulls the Spots heat toward it for about two weeks (an animal seen is an animal living there this week); a blank sit nudges its surroundings down for a few days. Each entry also saves where the spot sat on the model\'s own map, which is the model\'s report card in Places.',
    ],
  },
  {
    title: 'Heat map',
    body: [
      'Where the picked animal is likely at the planned time: the three bands are good, better and best within 3 km. Tap anywhere for the score and its reasons; the arithmetic and the knobs are a tap deeper in Spots.',
    ],
  },
  {
    title: 'Routes and the ruler',
    body: [
      'Routes draws the three best ways on foot over a 10 m LiDAR going grid: Easiest, and in hunt mode a way that keeps to cover and off open ground. From is you when the fix is good, else camp; the chip cycles to camp or a tap on the map. Tap a kept route to clear it.',
      'The ruler measures from you when the fix is good, else from the first tap; drag either end.',
    ],
  },
]

const GROUPS: { title: string; defs: LayerDef[] }[] = [
  {
    title: 'Terrain',
    defs: [
      { key: 'topo', name: 'Topographic', desc: 'Contour lines and spot elevations (NRCan Toporama)', opacity: 'topo', data: 'topo', live: 'topo' },
      { key: 'hillshade', name: 'Hillshade', desc: 'Grey relief · the crisp 1 m LiDAR (2021) near camp shows old skid trails and ditches · 30 m around', opacity: 'hillshade', data: 'hillshade', live: 'hillshade' },
      { key: 'relief', name: 'Elevation colours', desc: 'Low ground green to high ridges pale brown, lakes as water · put Hillshade over it', opacity: 'relief', data: 'dem' },
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
      {
        key: 'lanes',
        name: 'Shooting lanes',
        desc: 'The same bush drawn for a bow: open and light ground left clear, thicker bush shaded darker · the Bow view · zoom in',
        opacity: 'lanes',
        data: 'lanes',
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
      <div className="panel-section">About what is drawn</div>
      {ABOUT.map((a) => (
        <details key={a.title} className="about-sec">
          <summary>{a.title}</summary>
          {a.body.map((t, i) => (
            <p key={i} className="row-desc">
              {t}
            </p>
          ))}
        </details>
      ))}
    </div>
  )
}
