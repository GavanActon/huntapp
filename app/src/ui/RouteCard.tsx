import { useEffect, useState } from 'react'
import { useAppStore } from '../state/appStore'
import { useSpotsStore } from '../state/spotsStore'
import { TARGET_NAMES } from '../spots/types'
import { formatDistance } from '../measure/measureMath'
import { clearRoutes, closeRoutes, huntBlocked, ROUTE_COLOURS, ROUTE_LETTERS, useRoutes, type RouteMode } from '../routes/routeStore'
import { approachText, endName, height, lidarText, routeFacts, routeLine, routeTag, routeTime, timeParts } from '../routes/routeText'
import { IconMinus, IconPlus, IconSwap } from './icons'

/**
 * Route mode's card, in the bottom bar like the ruler's. First the three
 * routes, a line each: the time, the distance and climb, and what sets it
 * apart ("+4 min · driest"). The picked one says what it is like underfoot
 * and how the wind sits coming in. "why" opens where its time goes, how
 * much of the bush was measured, and the knobs: pace, stay dry. The
 * right column's Routes button closes the card (so does Escape), keeping
 * the picked route on the map.
 */

const MODES: { m: RouteMode; name: string }[] = [
  { m: 'easy', name: 'Easiest' },
  { m: 'hunt', name: 'Hunt' },
]

export default function RouteCard() {
  const from = useRoutes((s) => s.from)
  const to = useRoutes((s) => s.to)
  const mode = useRoutes((s) => s.mode)
  const status = useRoutes((s) => s.status)
  const routes = useRoutes((s) => s.routes)
  const pick = useRoutes((s) => s.pick)
  const oneWay = useRoutes((s) => s.oneWay)
  const stayDry = useRoutes((s) => s.stayDry)
  const { setMode, setPick, setStayDry, swap } = useRoutes.getState()
  const units = useAppStore((s) => s.units)
  const paceKmh = useAppStore((s) => s.paceKmh)
  const setPaceKmh = useAppStore((s) => s.setPaceKmh)
  const target = useSpotsStore((s) => s.target)
  // what the hunt route waits on
  useSpotsStore((s) => s.status)
  const [more, setMore] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRoutes()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const blocked = mode === 'hunt' ? huntBlocked() : null
  const r = routes[pick]
  const toName = to ? endName(from, to, units) : ''
  const pace = units === 'imperial' ? `${(paceKmh * 0.621371).toFixed(1)} mph` : `${paceKmh.toFixed(1)} km/h`
  // grouse do not wind you: the way the wind sits coming in is for big game
  const approach = r && !(mode === 'hunt' && target === 'grouse') ? approachText(r.approach) : null
  const game = TARGET_NAMES[target].toLowerCase()

  // with no end yet the card is just its head and From: the next map tap sets it
  let msg: string | null = null
  if (!to) msg = ''
  else if (status === 'outside') msg = 'Both ends must be within 4 km of camp.'
  else if (status === 'water') msg = 'That end is out on the water.'
  else if (status === 'no-way') msg = 'No way there on foot.'
  else if (status === 'no-grid') msg = 'Download the maps in Settings first.'
  else if (!routes.length) msg = 'Finding the ways…'

  return (
    <div className="tripbuilder glass route-card">
      <div className="tb-head">
        <span className="tb-title">Routes</span>
        <div className="seg rt-mode" role="radiogroup" aria-label="What the route is for">
          {MODES.map((o) => (
            <button key={o.m} className={mode === o.m ? 'seg-on' : ''} role="radio" aria-checked={mode === o.m} onClick={() => setMode(o.m)}>
              {o.name}
            </button>
          ))}
        </div>
        <button className="icon-btn" onClick={swap} disabled={!to} aria-label="Swap the ends: the way back">
          <IconSwap size={16} />
        </button>
      </div>
      <div className="rt-ends">
        From <b>{from?.name ?? '…'}</b>
        {to ? (
          <>
            {' '}
            to <b>{toName}</b>{stayDry ? ' · staying dry' : ''}
            <button className="linklike rt-clear" onClick={clearRoutes}>
              Clear
            </button>
          </>
        ) : null}
      </div>
      {blocked && <div className="rt-note">{blocked}</div>}
      {msg != null ? (
        msg && <div className="tb-hint">{msg}</div>
      ) : (
        <>
          <div className="rt-rows" role="radiogroup" aria-label="Routes">
            {routes.map((x, k) => (
              <button key={k} className={`rt-row${k === pick ? ' on' : ''}`} role="radio" aria-checked={k === pick} onClick={() => setPick(k)}>
                <i className="rt-dot" style={{ background: ROUTE_COLOURS[k] }}>
                  {ROUTE_LETTERS[k]}
                </i>
                <b className="numeral">{routeTime(x.timeS)}</b>
                <span className="numeral rt-dist">{routeLine(x, units)}</span>
                <em>{routeTag(routes, k, mode)}</em>
              </button>
            ))}
          </div>
          {oneWay && routes.length < 3 && <div className="rt-note">{routes.length === 1 ? 'Only the one real way through here.' : 'Only two real ways through here.'}</div>}
          {r && (
            <div className="rt-facts">
              {routeFacts(r, units).join(' · ')}
              {mode === 'hunt' && r.nearM != null && (
                <>
                  {' · '}
                  {formatDistance(r.nearM, units)} beside good {game} ground
                </>
              )}
            </div>
          )}
          {r && (
            <div className="rt-facts rt-last">
              {approach && <span className={approach.warn ? 'rt-warn' : undefined}>{approach.text}</span>}
              <button className="linklike rt-why" onClick={() => setMore(!more)} aria-expanded={more}>
                {more ? 'less' : 'why ▸'}
              </button>
            </div>
          )}
          {r && more && <RouteWhy />}
        </>
      )}
      {more && r && (
        <div className="rt-knobs">
          <span className="numeral speed-step">
            pace on the flat
            <button className="nudge" onClick={() => setPaceKmh(Math.max(1, Math.round((paceKmh - 0.5) * 2) / 2))} aria-label="Slower">
              <IconMinus size={11} />
            </button>
            <b>{pace}</b>
            <button className="nudge" onClick={() => setPaceKmh(Math.min(8, Math.round((paceKmh + 0.5) * 2) / 2))} aria-label="Faster">
              <IconPlus size={11} />
            </button>
          </span>
          <button className={`chip chip-pick${stayDry ? ' chip-on' : ''}`} onClick={() => setStayDry(!stayDry)} aria-pressed={stayDry}>
            Stay dry
          </button>
        </div>
      )}
    </div>
  )
}

function RouteWhy() {
  const routes = useRoutes((s) => s.routes)
  const pick = useRoutes((s) => s.pick)
  const mode = useRoutes((s) => s.mode)
  const units = useAppStore((s) => s.units)
  const paceKmh = useAppStore((s) => s.paceKmh)
  const target = useSpotsStore((s) => s.target)
  const r = routes[pick]
  if (!r) return null
  const { flatMin, parts } = timeParts(r, paceKmh)
  const game = TARGET_NAMES[target].toLowerCase()
  return (
    <div className="rt-why-box">
      <div>
        <b className="numeral">{routeTime(flatMin * 60)}</b> on the flat
        {parts.map(([label, m]) => (
          <span key={label} className="numeral">
            , {m >= 0 ? '+' : '−'}
            {Math.abs(m) < 9.5 ? Math.abs(m).toFixed(1).replace(/\.0$/, '') : Math.round(Math.abs(m))} min {label}
          </span>
        ))}
        ; climbs {height(r.climbM, units)}, drops {height(r.descentM, units)}.
      </div>
      {mode === 'hunt' && r.nearM != null && (
        <div>
          Good {game} ground in sight for {formatDistance(r.nearM, units)} of it, as today's scores rank it.{' '}
          {target === 'grouse'
            ? 'Grouse routes walk the cover, to flush birds.'
            : r.scentM
              ? `It skirts the best of it, but your scent drifts onto good ground for ${formatDistance(r.scentM, units)}.`
              : 'It skirts the best of it, and your scent stays off it.'}
        </div>
      )}
      <div>
        {lidarText(r.lidarShare)} <span className="rt-src">Speeds from LiDAR-timed walks and GPS-tracked hikers (Campbell et al. 2017, 2019); not yet checked on this ground.</span>
      </div>
    </div>
  )
}
