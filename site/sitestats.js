// The site's own stats (visit.js, docs/ANALYTICS.md "The site"): /api/visits
// takes a page's batches into D1 (schema.sql, site_events); /api/site-stats
// answers the dashboard's Site tab (stats.html) and /api/visits/export hands
// over the rows as CSV, both behind STATS_KEY like the app's.

import { authorized, params } from './stats.js'

const NAME = /^[a-z][a-z0-9_]{0,39}$/
const PAGE = /^\/[a-z0-9\-/]{0,60}$/
const MAX_BODY = 200_000
const MAX_EVENTS = 200
const DAY = 86_400_000
// crawlers that run scripts: visit.js keeps quiet for them, and this is the second net
const BOT = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|facebookexternalhit|embedly/i

/** A batch from one page load: { i: visitor, v: the load, p: the page, now: the browser's clock, e: [{ s, q, t, n, p }] }.
 *  Sent as text/plain from the site's own pages only. A batch sent twice
 *  is stored once: (view, seq) is unique. */
export async function visitsIngest(request, env) {
  if (request.method !== 'POST') return json({ error: 'post' }, 405)
  const origin = request.headers.get('Origin')
  if (origin && origin !== new URL(request.url).origin) return json({ error: 'origin' }, 403)
  // Global Privacy Control, and the bots: thanked, nothing kept
  if (request.headers.get('Sec-GPC') === '1' || BOT.test(request.headers.get('User-Agent') ?? '')) return json({ ok: true, n: 0 })
  if (env.EVENTS_LIMIT) {
    const { success } = await env.EVENTS_LIMIT.limit({ key: `site:${request.headers.get('CF-Connecting-IP') ?? 'none'}` })
    if (!success) return json({ error: 'busy' }, 429)
  }
  const text = await request.text()
  if (text.length > MAX_BODY) return json({ error: 'size' }, 413)
  let body
  try {
    body = JSON.parse(text)
  } catch {
    return json({ error: 'json' }, 400)
  }
  const visitor = String(body?.i ?? '')
  const view = String(body?.v ?? '')
  const page = String(body?.p ?? '')
  if (!/^[a-f0-9]{16}$/.test(visitor) || !/^[a-f0-9]{12}$/.test(view) || !PAGE.test(page) || !Array.isArray(body.e)) return json({ error: 'shape' }, 400)

  const now = Date.now()
  // the browser's clock put right, as the app's are (stats.js)
  const theirNow = Number(body.now)
  const skew = Number.isFinite(theirNow) && Math.abs(now - theirNow) > 5000 ? now - theirNow : 0
  const rows = []
  for (const e of body.e.slice(0, MAX_EVENTS)) {
    if (!e || !NAME.test(e.n) || !/^[a-f0-9]{12}$/.test(e.s) || !Number.isInteger(e.q) || e.q < 0 || !Number.isFinite(e.t)) continue
    const p = e.p && typeof e.p === 'object' ? JSON.stringify(e.p) : null
    rows.push({ s: e.s, q: e.q, t: Math.round(e.t + skew), n: e.n, p: p && p.length <= 1000 ? p : null })
  }
  if (!rows.length) return json({ ok: true, n: 0 })
  const r = await env.DB.prepare(
    `INSERT OR IGNORE INTO site_events (visitor, session, view, seq, ts, page, name, props, country, received)
     SELECT ?1, json_extract(value, '$.s'), ?2, json_extract(value, '$.q'), json_extract(value, '$.t'), ?3,
            json_extract(value, '$.n'), json_extract(value, '$.p'), ?4, ?5
     FROM json_each(?6)`,
  )
    .bind(visitor, view, page, request.cf?.country ?? null, now, JSON.stringify(rows))
    .run()
  return json({ ok: true, n: r.meta?.changes ?? rows.length })
}

export async function siteStatsQuery(request, env) {
  const url = new URL(request.url)
  if (!authorized(request, env, url)) return json({ error: 'key' }, 401)
  const { days, tz, since, now, x } = params(url)
  const NOT_X = `substr(visitor, 1, 8) NOT IN (SELECT value FROM json_each(?2))`
  const W = `ts >= ?1 AND ${NOT_X}`
  const P = (k) => `json_extract(props, '$.${k}')`
  const TO_APP = `name = 'click' AND ${P('to')} = '/app'`
  const q = (sql, ...extra) => env.DB.prepare(sql).bind(since, x, ...extra)

  const [totals, daily, sessions, sources, pages, sections, exits, clicks, dead, digs, loops, form, app, devices, countries, vitals, errors, recent, total] = await env.DB.batch([
    q(`SELECT COUNT(DISTINCT visitor) AS visitors, COUNT(DISTINCT session) AS sessions, COUNT(DISTINCT view) AS views,
              COUNT(DISTINCT CASE WHEN name = 'view' AND ${P('new')} = 1 THEN visitor END) AS new_visitors,
              COUNT(DISTINCT CASE WHEN ${TO_APP} THEN session END) AS app_sessions,
              COUNT(DISTINCT CASE WHEN ${TO_APP} THEN visitor END) AS app_visitors,
              SUM(name = 'request' AND ${P('result')} = 'sent') AS requests, COUNT(*) AS events
       FROM site_events WHERE ${W}`),
    q(`SELECT date(ts / 1000, 'unixepoch', ?3) AS day, COUNT(DISTINCT visitor) AS visitors, COUNT(DISTINCT session) AS sessions, COUNT(DISTINCT view) AS views,
              COUNT(DISTINCT CASE WHEN name = 'view' AND ${P('new')} = 1 THEN visitor END) AS new_visitors,
              COUNT(DISTINCT CASE WHEN ${TO_APP} THEN visitor END) AS to_app,
              ROUND(SUM(CASE WHEN name = 'hide' THEN ${P('fg_s')} ELSE 0 END) / 60.0, 1) AS fg_min
       FROM site_events WHERE ${W} GROUP BY day ORDER BY day`, tz),
    // each session: time in front and in use, pages, and whether it went to the app
    q(`SELECT SUM(CASE WHEN name = 'hide' THEN ${P('fg_s')} ELSE 0 END) AS fg, COUNT(DISTINCT view) AS pages, MAX(${TO_APP}) AS app
       FROM site_events WHERE ${W} GROUP BY session`),
    // where sessions came from: the first page of each, and what came of it
    q(`WITH l AS (SELECT session, MIN(ts) AS t FROM site_events WHERE ${W} AND name = 'view' GROUP BY session),
            a AS (SELECT DISTINCT session FROM site_events WHERE ${W} AND ${TO_APP}),
            r AS (SELECT DISTINCT session FROM site_events WHERE ${W} AND name = 'request' AND ${P('result')} = 'sent')
       SELECT CASE WHEN json_extract(e.props, '$.again') = 1 THEN '(a tab come back to)'
                   ELSE COALESCE(json_extract(e.props, '$.utm_source'), json_extract(e.props, '$.ref'), '(direct)') END AS src,
              json_extract(e.props, '$.utm_campaign') AS campaign, e.page AS landing,
              COUNT(*) AS sessions, COUNT(DISTINCT e.visitor) AS visitors, COUNT(a.session) AS to_app, COUNT(r.session) AS requests
       FROM site_events e JOIN l ON e.session = l.session AND e.ts = l.t AND e.name = 'view'
       LEFT JOIN a ON a.session = e.session LEFT JOIN r ON r.session = e.session
       GROUP BY src, campaign, landing ORDER BY sessions DESC LIMIT 100`),
    // each page: loads, time, and how far down
    q(`WITH v AS (SELECT page, view, visitor, MAX(CASE WHEN name = 'hide' THEN ${P('depth')} END) AS depth,
                         SUM(CASE WHEN name = 'hide' THEN ${P('fg_s')} ELSE 0 END) AS fg
                  FROM site_events WHERE ${W} GROUP BY view)
       SELECT page, COUNT(*) AS views, COUNT(DISTINCT visitor) AS visitors, ROUND(AVG(fg), 1) AS avg_s,
              ROUND(AVG(depth)) AS depth, SUM(depth >= 90) AS bottom, SUM(depth IS NOT NULL) AS measured
       FROM v GROUP BY page ORDER BY views DESC`),
    // what's seen: each part of each page, in page order
    q(`SELECT page, ${P('sec')} AS sec, MIN(${P('i')}) AS i,
              COUNT(DISTINCT CASE WHEN name = 'seen' THEN view END) AS seen,
              ROUND(SUM(CASE WHEN name = 'dwell' THEN ${P('s')} ELSE 0 END)) AS s,
              ROUND(AVG(CASE WHEN name = 'seen' THEN ${P('t')} END)) AS t
       FROM site_events WHERE ${W} AND name IN ('seen', 'dwell') GROUP BY page, sec`),
    // where they left: the part on screen when each session last put the page away
    q(`WITH h AS (SELECT session, MAX(ts) AS t FROM site_events WHERE ${W} AND name = 'hide' GROUP BY session)
       SELECT e.page, json_extract(e.props, '$.at') AS at, COUNT(*) AS n
       FROM site_events e JOIN h ON e.session = h.session AND e.ts = h.t AND e.name = 'hide'
       GROUP BY e.page, at ORDER BY n DESC LIMIT 80`),
    q(`SELECT page, ${P('sec')} AS sec, ${P('el')} AS el, ${P('to')} AS href, ${P('kind')} AS kind, COUNT(*) AS n, COUNT(DISTINCT visitor) AS visitors
       FROM site_events WHERE ${W} AND name = 'click' GROUP BY page, sec, el, href ORDER BY n DESC LIMIT 200`),
    q(`SELECT page, ${P('sec')} AS sec, ${P('what')} AS what, COUNT(*) AS n, COUNT(DISTINCT visitor) AS visitors
       FROM site_events WHERE ${W} AND name = 'dead_click' GROUP BY page, sec, what ORDER BY n DESC LIMIT 100`),
    q(`SELECT page, ${P('sec')} AS sec, ${P('el')} AS el, SUM(name = 'dig') AS opens,
              COUNT(DISTINCT CASE WHEN name = 'dig' THEN view END) AS views,
              ROUND(AVG(CASE WHEN name = 'dig_close' THEN ${P('s')} END)) AS avg_s
       FROM site_events WHERE ${W} AND name IN ('dig', 'dig_close') GROUP BY page, sec, el ORDER BY views DESC`),
    q(`SELECT page, ${P('loop')} AS loop,
              COUNT(DISTINCT CASE WHEN name = 'loop_play' THEN view END) AS plays,
              ROUND(SUM(CASE WHEN name = 'watch' THEN ${P('s')} ELSE 0 END)) AS s,
              SUM(name = 'loop_tap' AND ${P('act')} = 'pause') AS pauses,
              SUM(name = 'loop_tap' AND ${P('act')} = 'play') AS played,
              COUNT(DISTINCT CASE WHEN name = 'loop_wait' THEN view END) AS waits
       FROM site_events WHERE ${W} AND name IN ('loop_play', 'watch', 'loop_tap', 'loop_wait') GROUP BY page, loop ORDER BY plays DESC`),
    q(`SELECT name, ${P('result')} AS result, ${P('field')} AS field, ${P('game')} AS game, COUNT(*) AS n, COUNT(DISTINCT visitor) AS visitors
       FROM site_events WHERE ${W} AND name IN ('form_start', 'request') GROUP BY name, result, field, game`),
    // the app's side (events, stats.js): phones whose first open (or any launch) came from a visit in the window
    q(`WITH sv AS (SELECT DISTINCT visitor FROM site_events WHERE ${W}),
            fi AS (SELECT DISTINCT install FROM events WHERE ts >= ?1 AND name = 'first_open' AND json_extract(props, '$.site') IN (SELECT visitor FROM sv)),
            ev AS (SELECT install, name, props, ts FROM events WHERE ts >= ?1 AND install IN (SELECT install FROM fi))
       SELECT (SELECT COUNT(*) FROM fi) AS new_phones,
              (SELECT COUNT(DISTINCT install) FROM events WHERE ts >= ?1 AND name = 'launch' AND json_extract(props, '$.site') IN (SELECT visitor FROM sv)) AS launches,
              (SELECT COUNT(DISTINCT install) FROM ev WHERE name = 'map_tap') AS tapped,
              (SELECT COUNT(DISTINCT install) FROM ev WHERE name = 'sheet' AND json_extract(props, '$.sheet') = 'digin') AS dug_in,
              (SELECT COUNT(DISTINCT install) FROM ev WHERE name = 'wind_check') AS checked,
              (SELECT COUNT(*) FROM (SELECT install FROM ev GROUP BY install HAVING MAX(ts) - MIN(ts) > ${DAY})) AS returned`),
    q(`SELECT ${P('platform')} AS platform, ${P('browser')} AS browser,
              CASE WHEN CAST(${P('vp')} AS INT) < 600 THEN 'phone' WHEN CAST(${P('vp')} AS INT) < 1100 THEN 'tablet' ELSE 'desktop' END AS screen,
              COUNT(DISTINCT visitor) AS visitors
       FROM site_events WHERE ${W} AND name = 'view' GROUP BY platform, browser, screen ORDER BY visitors DESC`),
    q(`SELECT country, COUNT(DISTINCT visitor) AS visitors, COUNT(DISTINCT session) AS sessions FROM site_events WHERE ${W} GROUP BY country ORDER BY visitors DESC`),
    q(`SELECT page, ${P('lcp')} AS lcp, ${P('fcp')} AS fcp, ${P('cls')} AS cls, ${P('inp')} AS inp, ${P('ttfb')} AS ttfb
       FROM site_events WHERE ${W} AND name = 'vitals' ORDER BY ts DESC LIMIT 3000`),
    q(`SELECT name, COALESCE(${P('msg')}, ${P('name')}) AS msg, COALESCE(${P('at')}, ${P('what')}) AS at, COUNT(*) AS n, COUNT(DISTINCT visitor) AS visitors, MAX(ts) AS last
       FROM site_events WHERE ${W} AND name IN ('error', 'asset_error') GROUP BY name, msg, at ORDER BY visitors DESC LIMIT 40`),
    q(`SELECT ts, substr(visitor, 1, 8) AS visitor, page, name, props FROM site_events WHERE ${W} ORDER BY ts DESC LIMIT 60`),
    q(`SELECT COUNT(DISTINCT visitor) AS visitors, MIN(ts) AS first FROM site_events WHERE ${NOT_X} AND ?1 IS NOT NULL`),
  ])

  return json({
    days,
    tz,
    at: now,
    total: total.results[0],
    totals: totals.results[0],
    daily: daily.results,
    sessions: sessions.results,
    sources: sources.results,
    pages: pages.results,
    sections: sections.results,
    exits: exits.results,
    clicks: clicks.results,
    dead: dead.results,
    digs: digs.results,
    loops: loops.results,
    form: form.results,
    app: app.results[0],
    devices: devices.results,
    countries: countries.results,
    vitals: vitals.results,
    errors: errors.results,
    recent: recent.results,
  })
}

/** Every row in the window as CSV. */
export async function visitsExport(request, env) {
  const url = new URL(request.url)
  if (!authorized(request, env, url)) return json({ error: 'key' }, 401)
  const { since, x, days } = params(url)
  const { results } = await env.DB.prepare(
    `SELECT id, visitor, session, view, seq, ts, datetime(ts / 1000, 'unixepoch') AS utc, page, name, props, country, received
     FROM site_events WHERE ts >= ?1 AND substr(visitor, 1, 8) NOT IN (SELECT value FROM json_each(?2)) ORDER BY ts`,
  )
    .bind(since, x)
    .all()
  const cols = ['id', 'visitor', 'session', 'view', 'seq', 'ts', 'utc', 'page', 'name', 'props', 'country', 'received']
  const cell = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))
  const csv = [cols.join(','), ...results.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n') + '\n'
  return new Response(csv, {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="groundwind-site-${days}d.csv"`, 'cache-control': 'no-store' },
  })
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
}
