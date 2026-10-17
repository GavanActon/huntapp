import { useEffect, useRef, useState, type JSX, type PointerEvent } from 'react'
import { formatDistance, type Units } from '../measure/measureMath'
import { useMeasureStore } from '../measure/measureStore'
import { useMeasureProfile, type LegProfile, type Profile } from '../measure/profile'
import { useAppStore } from '../state/appStore'
import '../measure/profile.css'

/**
 * The elevation trace under the Measure card (measure/profile.ts): the
 * ground along the line, and with sight on, the trees over it and each
 * leg's sight line from eye height. Brief first: the climb, the drop, the
 * steepest grade; a finger along it reads the height there and shows the
 * place on the map.
 */

const H = 96
const PAD = { l: 44, r: 4, t: 6, b: 4 }

const elevText = (m: number, units: Units) => (units === 'imperial' ? `${Math.round(m * 3.28084)} ft` : `${Math.round(m)} m`)
const pct = (g: number) => `${Math.round(Math.abs(g) * 100)}%`

/** One leg's sight line in words. */
function sightWords(leg: LegProfile, units: Units): string {
  if (leg.sight === 'rise') return `the ground blocks it ${formatDistance((leg.blockD ?? leg.startD) - leg.startD, units)} out`
  if (leg.sight === 'trees') return `through the trees for ${formatDistance(leg.treesM, units)}`
  if (leg.sight === 'clear') return 'clear'
  return 'no heights here'
}

/** The runs of the line that have a height, as SVG path pieces. */
function runs(p: Profile, x: (d: number) => number, y: (z: number) => number, top: (i: number) => number): { line: string; area: string; band: string } {
  let line = ''
  let area = ''
  let band = ''
  let run: number[] = []
  const flush = () => {
    if (run.length > 1) {
      const pts = run.map((i) => `${x(p.samples[i].d).toFixed(1)},${y(p.samples[i].z).toFixed(1)}`)
      line += `M${pts.join('L')}`
      const x0 = x(p.samples[run[0]].d).toFixed(1)
      const x1 = x(p.samples[run[run.length - 1]].d).toFixed(1)
      area += `M${x0},${H - PAD.b}L${pts.join('L')}L${x1},${H - PAD.b}Z`
      const tops = run.map((i) => `${x(p.samples[i].d).toFixed(1)},${y(top(i)).toFixed(1)}`)
      band += `M${tops.join('L')}L${[...pts].reverse().join('L')}Z`
    }
    run = []
  }
  p.samples.forEach((s, i) => (Number.isFinite(s.z) ? run.push(i) : flush()))
  flush()
  return { line, area, band }
}

export default function MeasureProfile(): JSX.Element | null {
  const profile = useMeasureProfile((s) => s.profile)
  const sight = useMeasureStore((s) => s.sight)
  const setScrub = useMeasureStore((s) => s.setScrub)
  const units = useAppStore((s) => s.units)
  const box = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(320)
  const [at, setAt] = useState<number | null>(null)

  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => setW(Math.max(160, el.clientWidth)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  // a finger lifted off, or the measurement gone: nothing marked on the map
  useEffect(() => () => setScrub(null), [setScrub])

  if (!profile) return <div className="mprof" ref={box} />
  const p = profile
  const zs = p.samples.filter((s) => Number.isFinite(s.z))
  if (zs.length < 2) {
    return (
      <div className="mprof" ref={box}>
        <div className="mprof-read dim">No heights along this line</div>
      </div>
    )
  }
  const top = (i: number) => p.samples[i].z + (sight ? p.samples[i].tree : 0)
  let zmin = Infinity
  let zmax = -Infinity
  p.samples.forEach((s, i) => {
    if (!Number.isFinite(s.z)) return
    zmin = Math.min(zmin, s.z)
    zmax = Math.max(zmax, top(i))
  })
  if (sight) for (const l of p.legs) if (Number.isFinite(l.eyeZ)) zmax = Math.max(zmax, l.eyeZ, l.targetZ)
  const pad = Math.max(2, (zmax - zmin) * 0.08)
  zmin -= pad
  zmax += pad
  const total = Math.max(1, p.flatM)
  const x = (d: number) => PAD.l + (d / total) * (w - PAD.l - PAD.r)
  const y = (z: number) => PAD.t + ((zmax - z) / (zmax - zmin)) * (H - PAD.t - PAD.b)
  const { line, area, band } = runs(p, x, y, top)

  // a finger along it: the nearest sample to it
  const pick = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const d = ((e.clientX - r.left - PAD.l) / (w - PAD.l - PAD.r)) * total
    let lo = 0
    let hi = p.samples.length - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (p.samples[mid].d < d) lo = mid
      else hi = mid
    }
    const i = Math.abs(p.samples[lo].d - d) <= Math.abs(p.samples[hi].d - d) ? lo : hi
    setAt(i)
    setScrub([p.samples[i].lon, p.samples[i].lat])
  }
  const off = () => {
    setAt(null)
    setScrub(null)
  }

  const s = at != null ? p.samples[at] : null
  const localGrade = (() => {
    if (at == null) return null
    const a = p.samples[Math.max(0, at - 2)]
    const b = p.samples[Math.min(p.samples.length - 1, at + 2)]
    const g = (b.z - a.z) / Math.max(1, b.d - a.d)
    return Number.isFinite(g) ? g : null
  })()

  return (
    <div className="mprof" ref={box}>
      <div className="mprof-read numeral">
        {s ? (
          <>
            <span>
              <b>{formatDistance(s.d, units)}</b> along
            </span>
            {Number.isFinite(s.z) && (
              <span>
                <b>{elevText(s.z, units)}</b>
                {localGrade != null && Math.abs(localGrade) >= 0.01 ? ` · ${pct(localGrade)} ${localGrade > 0 ? 'up' : 'down'}` : ''}
              </span>
            )}
            {sight && s.tree >= 3 && <span>trees {elevText(s.tree, units)}</span>}
          </>
        ) : (
          <>
            <span>
              ↑ <b>{elevText(p.climbM, units)}</b> ↓ <b>{elevText(p.descentM, units)}</b>
            </span>
            <span>
              steepest <b>{pct(p.steepest)}</b>
            </span>
            {p.missing > 0.05 && <span className="dim">no heights for part of it</span>}
          </>
        )}
      </div>
      <svg width={w} height={H} onPointerDown={(e) => (e.currentTarget.setPointerCapture(e.pointerId), pick(e))} onPointerMove={(e) => (e.buttons || e.pointerType === 'touch' ? pick(e) : undefined)} onPointerUp={off} onPointerCancel={off} onPointerLeave={off} role="img" aria-label={`Elevation along the line: up ${elevText(p.climbM, units)}, down ${elevText(p.descentM, units)}`}>
        {sight && <path className="t-band" d={band} />}
        <path className="g-area" d={area} />
        <path className="g-line" d={line} />
        {p.legs.slice(0, -1).map((l, i) => (
          <line key={i} className="tick" x1={x(l.endD)} x2={x(l.endD)} y1={PAD.t} y2={H - PAD.b} />
        ))}
        {sight &&
          p.legs.map((l, i) =>
            Number.isFinite(l.eyeZ) ? (
              <g key={`s${i}`}>
                <line className="s-line" x1={x(l.startD)} y1={y(l.eyeZ)} x2={x(l.endD)} y2={y(l.targetZ)} />
                {l.sight === 'rise' && l.blockD != null && <circle className="s-block" cx={x(l.blockD)} cy={y(p.samples.find((q) => q.d >= (l.blockD as number))?.z ?? l.eyeZ)} r={4} />}
              </g>
            ) : null,
          )}
        <text className="ylab" x={2} y={PAD.t + 9}>
          {elevText(zmax - pad, units)}
        </text>
        <text className="ylab" x={2} y={H - PAD.b - 2}>
          {elevText(zmin + pad, units)}
        </text>
        {s && (
          <>
            <line className="cross" x1={x(s.d)} x2={x(s.d)} y1={PAD.t} y2={H - PAD.b} />
            {Number.isFinite(s.z) && <circle className="cross-dot" cx={x(s.d)} cy={y(s.z)} r={4} />}
          </>
        )}
      </svg>
      {sight && (
        <div className="mprof-sight">
          {p.legs.length === 1 ? (
            <span>Sight line: {sightWords(p.legs[0], units)}</span>
          ) : (
            p.legs.slice(-3).map((l, i, arr) => (
              <span key={i}>
                Leg {p.legs.length - arr.length + i + 1}: {sightWords(l, units)}
              </span>
            ))
          )}
        </div>
      )}
    </div>
  )
}
