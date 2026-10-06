// Usage stats (app/src/analytics.ts, docs/ANALYTICS.md): /api/events takes
// the app's batches into D1 (schema.sql, events); /api/stats answers the
// dashboard (stats.html) and /api/export hands over the raw rows as CSV,
// both behind STATS_KEY (`npx wrangler secret put STATS_KEY`).

const NAME = /^[a-z][a-z0-9_]{0,39}$/
const HEX = /^[a-f0-9]{6,16}$/
const MAX_BODY = 200_000
const MAX_EVENTS = 200
const DAY = 86_400_000

/** A batch from a phone: { i: install, now: the phone's clock, e: [{ s, q, t, n, p, a, b, o }] }.
 *  Sent as text/plain (a simple request, no preflight); any origin, no
 *  credentials. A batch sent twice is stored once: (install, seq) is unique. */
export async function eventsIngest(request, env) {
  const cors = { 'Access-Control-Allow-Origin': '*' }
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Max-Age': '86400' } })
  }
  if (request.method !== 'POST') return json({ error: 'post' }, 405, cors)
  if (env.EVENTS_LIMIT) {
    const { success } = await env.EVENTS_LIMIT.limit({ key: request.headers.get('CF-Connecting-IP') ?? 'none' })
    if (!success) return json({ error: 'busy' }, 429, cors)
  }
  const text = await request.text()
  if (text.length > MAX_BODY) return json({ error: 'size' }, 413, cors)
  let body
  try {
    body = JSON.parse(text)
  } catch {
    return json({ error: 'json' }, 400, cors)
  }
  const install = String(body?.i ?? '')
  if (!/^[a-f0-9]{16}$/.test(install) || !Array.isArray(body.e)) return json({ error: 'shape' }, 400, cors)

  const now = Date.now()
  // a phone's clock can be off by minutes or days: the batch says what it
  // reads now, and every event moves by the difference
  const phoneNow = Number(body.now)
  const skew = Number.isFinite(phoneNow) && Math.abs(now - phoneNow) > 5000 ? now - phoneNow : 0
  const rows = []
  for (const e of body.e.slice(0, MAX_EVENTS)) {
    if (!e || !NAME.test(e.n) || !HEX.test(e.s) || !Number.isInteger(e.q) || !Number.isFinite(e.t)) continue
    const p = e.p && typeof e.p === 'object' ? JSON.stringify(e.p) : null
    rows.push({
      s: e.s,
      q: e.q,
      t: Math.round(e.t + skew),
      n: e.n,
      p: p && p.length <= 1000 ? p : null,
      a: typeof e.a === 'string' ? e.a.slice(0, 40) : null,
      b: typeof e.b === 'string' ? e.b.slice(0, 40) : null,
      o: e.o ? 1 : 0,
    })
  }
  if (!rows.length) return json({ ok: true, n: 0 }, 200, cors)
  const r = await env.DB.prepare(
    `INSERT OR IGNORE INTO events (install, session, seq, ts, name, props, area, build, online, country, received)
     SELECT ?1, json_extract(value, '$.s'), json_extract(value, '$.q'), json_extract(value, '$.t'), json_extract(value, '$.n'),
            json_extract(value, '$.p'), json_extract(value, '$.a'), json_extract(value, '$.b'), json_extract(value, '$.o'), ?2, ?3
     FROM json_each(?4)`,
  )
    .bind(install, request.cf?.country ?? null, now, JSON.stringify(rows))
    .run()
  return json({ ok: true, n: r.meta?.changes ?? rows.length }, 200, cors)
}

function authorized(request, env, url) {
  if (!env.STATS_KEY) return false
  const auth = request.headers.get('Authorization') ?? ''
  const key = auth.startsWith('Bearer ') ? auth.slice(7) : (url.searchParams.get('key') ?? '')
  return key.length > 0 && key === env.STATS_KEY
}

/** What every query shares: the window, the time zone the days are cut in,
 *  and the phones left out (yours, by the 8-hex id Settings shows). */
function params(url) {
  const days = Math.min(400, Math.max(1, Number(url.searchParams.get('days')) || 30))
  // minutes east of UTC, as the dashboard's browser has it (Toronto in summer: -240)
  const tzMin = Math.max(-840, Math.min(840, Math.round(Number(url.searchParams.get('tz')) || 0)))
  const tz = `${tzMin >= 0 ? '+' : ''}${tzMin} minutes`
  const exclude = (url.searchParams.get('x') ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase().slice(0, 8))
    .filter((s) => /^[a-f0-9]{8}$/.test(s))
  const now = Date.now()
  return { days, tz, since: now - days * DAY, now, x: JSON.stringify(exclude) }
}

// the dashboard's breakdowns: each event by the prop that says which
const KEY_PROP = {
  sheet: 'sheet',
  card: 'card',
  tool: 'tool',
  form: 'form',
  arm: 'what',
  layer: 'layer',
  setting: 'key',
  view: 'view',
  mode: 'mode',
  quarry: 'target',
  heat: 'on',
  cone: 'on',
  location: 'on',
  heading_up: 'on',
  share: 'what',
  log_entry: 'species',
  wind_check: 'strength',
  route: 'status',
  download: 'ok',
  sat_paste: 'ok',
  gps: 'status',
  strip: 'open',
  plan_time: 'ahead_h',
}

export async function statsQuery(request, env) {
  const url = new URL(request.url)
  if (!authorized(request, env, url)) return json({ error: 'key' }, 401)
  const { days, tz, since, now, x } = params(url)
  const NOT_X = `substr(install, 1, 8) NOT IN (SELECT value FROM json_each(?2))`
  const W = `ts >= ?1 AND ${NOT_X}`
  const keyCase = `CASE name ${Object.entries(KEY_PROP)
    .map(([n, p]) => `WHEN '${n}' THEN CAST(json_extract(props, '$.${p}') AS TEXT)`)
    .join(' ')} END`
  const q = (sql, ...extra) => env.DB.prepare(sql).bind(since, x, ...extra)

  const [active, daily, features, breakdown, dwell, clicks, phones, builds, areas, countries, hours, perf, errors, offline, sessions, recent, retention, dayRet, total] = await env.DB.batch([
    // the last 24 h, 7 and 30 days whatever the window, and the window's own
    q(`SELECT COUNT(DISTINCT CASE WHEN ts >= ?3 THEN install END) AS dau, COUNT(DISTINCT CASE WHEN ts >= ?4 THEN install END) AS wau,
              COUNT(DISTINCT CASE WHEN ts >= ?5 THEN install END) AS mau, COUNT(DISTINCT CASE WHEN ts >= ?1 THEN install END) AS users,
              COUNT(DISTINCT CASE WHEN ts >= ?1 THEN session END) AS sessions, SUM(ts >= ?1) AS events
       FROM events WHERE ts >= min(?1, ?5) AND ${NOT_X}`, now - DAY, now - 7 * DAY, now - 30 * DAY),
    q(`SELECT date(ts / 1000, 'unixepoch', ?3) AS day, COUNT(DISTINCT install) AS users, COUNT(DISTINCT session) AS sessions, COUNT(*) AS events,
              SUM(name = 'first_open' AND IFNULL(json_extract(props, '$.known'), 0) = 0) AS new_users,
              ROUND(SUM(CASE WHEN name = 'hide' THEN json_extract(props, '$.fg_s') ELSE 0 END) / 60.0, 1) AS fg_min
       FROM events WHERE ${W} GROUP BY day ORDER BY day`, tz),
    q(`SELECT name, COUNT(*) AS n, COUNT(DISTINCT install) AS users, COUNT(DISTINCT session) AS sessions
       FROM events WHERE ${W} GROUP BY name ORDER BY users DESC, n DESC`),
    q(`SELECT name, ${keyCase} AS k, COUNT(*) AS n, COUNT(DISTINCT install) AS users
       FROM events WHERE ${W} AND name IN (${Object.keys(KEY_PROP).map((n) => `'${n}'`).join(',')})
       GROUP BY name, k ORDER BY name, users DESC, n DESC`),
    q(`SELECT substr(name, 1, length(name) - 6) AS name, COALESCE(json_extract(props, '$.sheet'), json_extract(props, '$.card'), json_extract(props, '$.tool'), json_extract(props, '$.form')) AS k,
              COUNT(*) AS n, ROUND(AVG(json_extract(props, '$.s')), 1) AS avg_s
       FROM events WHERE ${W} AND name IN ('sheet_close', 'card_close', 'tool_close', 'form_close') GROUP BY name, k ORDER BY n DESC`),
    q(`SELECT json_extract(props, '$.where') AS area, json_extract(props, '$.el') AS el, COUNT(*) AS n, COUNT(DISTINCT install) AS users
       FROM events WHERE ${W} AND name = 'click' GROUP BY area, el ORDER BY n DESC LIMIT 150`),
    q(`SELECT json_extract(props, '$.platform') AS platform, json_extract(props, '$.browser') AS browser, json_extract(props, '$.standalone') AS installed, COUNT(DISTINCT install) AS users
       FROM events WHERE ${W} AND name = 'launch' GROUP BY platform, browser, installed ORDER BY users DESC`),
    q(`SELECT build, COUNT(DISTINCT install) AS users, MAX(ts) AS last FROM events WHERE ${W} GROUP BY build ORDER BY last DESC LIMIT 20`),
    q(`SELECT area, COUNT(DISTINCT install) AS users, COUNT(DISTINCT session) AS sessions FROM events WHERE ${W} GROUP BY area ORDER BY users DESC`),
    q(`SELECT country, COUNT(DISTINCT install) AS users FROM events WHERE ${W} GROUP BY country ORDER BY users DESC`),
    q(`SELECT CAST(strftime('%w', ts / 1000, 'unixepoch', ?3) AS INT) AS dow, CAST(strftime('%H', ts / 1000, 'unixepoch', ?3) AS INT) AS hour, COUNT(*) AS n
       FROM events WHERE ${W} AND name IN ('session_start', 'show') GROUP BY dow, hour`, tz),
    q(`SELECT name, json_extract(props, '$.what') AS what, json_extract(props, '$.ms') AS ms FROM events
       WHERE ${W} AND (name = 'perf' OR name = 'gps_fix') AND json_extract(props, '$.ms') IS NOT NULL ORDER BY ms`),
    q(`SELECT json_extract(props, '$.msg') AS msg, json_extract(props, '$.at') AS at, COUNT(*) AS n, COUNT(DISTINCT install) AS users, MAX(build) AS build, MAX(ts) AS last
       FROM events WHERE ${W} AND name = 'error' GROUP BY msg, at ORDER BY users DESC, n DESC LIMIT 40`),
    q(`SELECT online, COUNT(*) AS n, COUNT(DISTINCT install) AS users, ROUND(AVG((received - ts) / 60000.0), 1) AS lag_min FROM events WHERE ${W} GROUP BY online`),
    q(`SELECT (MAX(ts) - MIN(ts)) / 1000 AS dur, COUNT(*) AS n,
              SUM(CASE WHEN name = 'hide' THEN json_extract(props, '$.fg_s') ELSE 0 END) AS fg
       FROM events WHERE ${W} GROUP BY session ORDER BY dur`),
    q(`SELECT ts, substr(install, 1, 8) AS install, name, props, area, build, online FROM events WHERE ${W} ORDER BY ts DESC LIMIT 60`),
    // retention, all time: phones by the week they were first seen (Monday),
    // and how many came back in each week after (week 0 is the first 7 days)
    q(`WITH f AS (SELECT install, MIN(ts) AS t0 FROM events WHERE ${NOT_X} AND ?1 IS NOT NULL GROUP BY install)
       SELECT date(f.t0 / 1000, 'unixepoch', ?3, '-6 days', 'weekday 1') AS cohort, CAST((e.ts - f.t0) / ${7 * DAY} AS INT) AS wk, COUNT(DISTINCT e.install) AS users
       FROM events e JOIN f ON e.install = f.install GROUP BY cohort, wk HAVING wk <= 12`, tz),
    // day-N retention: of the phones first seen at least N+1 days ago, how
    // many were back on day N (24 h blocks from their first event)
    q(`WITH f AS (SELECT install, MIN(ts) AS t0 FROM events WHERE ${NOT_X} AND ?1 IS NOT NULL GROUP BY install),
            d AS (SELECT DISTINCT e.install, CAST((e.ts - f.t0) / ${DAY} AS INT) AS dn FROM events e JOIN f ON e.install = f.install)
       SELECT n.dn, (SELECT COUNT(*) FROM f WHERE f.t0 <= ?3 - (n.dn + 1) * ${DAY}) AS eligible,
              (SELECT COUNT(*) FROM d JOIN f ON d.install = f.install WHERE d.dn = n.dn AND f.t0 <= ?3 - (n.dn + 1) * ${DAY}) AS back
       FROM (SELECT 1 AS dn UNION ALL SELECT 7 UNION ALL SELECT 14 UNION ALL SELECT 30) n`, now),
    q(`SELECT COUNT(DISTINCT install) AS installs, MIN(ts) AS first FROM events WHERE ${NOT_X} AND ?1 IS NOT NULL`),
  ])

  return json({
    days,
    tz,
    at: now,
    total: total.results[0],
    active: active.results[0],
    daily: daily.results,
    features: features.results,
    breakdown: breakdown.results,
    dwell: dwell.results,
    clicks: clicks.results,
    phones: phones.results,
    builds: builds.results,
    areas: areas.results,
    countries: countries.results,
    hours: hours.results,
    perf: perf.results,
    errors: errors.results,
    offline: offline.results,
    sessions: sessions.results,
    recent: recent.results,
    retention: retention.results,
    dayRet: dayRet.results,
  })
}

/** Every row in the window as CSV, for a spreadsheet or a notebook. */
export async function eventsExport(request, env) {
  const url = new URL(request.url)
  if (!authorized(request, env, url)) return json({ error: 'key' }, 401)
  const { since, x, days } = params(url)
  const { results } = await env.DB.prepare(
    `SELECT id, install, session, seq, ts, datetime(ts / 1000, 'unixepoch') AS utc, name, props, area, build, online, country, received
     FROM events WHERE ts >= ?1 AND substr(install, 1, 8) NOT IN (SELECT value FROM json_each(?2)) ORDER BY ts`,
  )
    .bind(since, x)
    .all()
  const cols = ['id', 'install', 'session', 'seq', 'ts', 'utc', 'name', 'props', 'area', 'build', 'online', 'country', 'received']
  const cell = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))
  const csv = [cols.join(','), ...results.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\n') + '\n'
  return new Response(csv, {
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="groundwind-events-${days}d.csv"`, 'cache-control': 'no-store' },
  })
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...headers, 'content-type': 'application/json', 'cache-control': 'no-store' } })
}
