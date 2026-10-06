// Wind checks shared from the app (app/src/weather/micro/checkShare.ts,
// docs/ANALYTICS.md "Wind checks"): /api/checks takes a phone's checks into
// D1 (schema.sql, checks) and /api/checks/export hands them back as JSON,
// behind STATS_KEY like the stats. A check sent again (another puff folded
// in, or replaced by a newer one) updates its row.

const CID = /^[a-z0-9]{4,40}$/i
const STRENGTHS = new Set(['calm', 'drift', 'light', 'breezy', 'windy'])
const MAX_BODY = 200_000
const MAX_CHECKS = 200
const MAX_DATA = 4000
const DAY = 86_400_000

/** A batch from a phone: { i: install, now: the phone's clock, a: area, b: build, c: [WindCheck] }.
 *  Sent as text/plain like /api/events: a simple request, no preflight. */
export async function checksIngest(request, env) {
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
  if (!/^[a-f0-9]{16}$/.test(install) || !Array.isArray(body.c)) return json({ error: 'shape' }, 400, cors)

  const now = Date.now()
  // the phone's clock can be off: every time in the batch moves by the difference
  const phoneNow = Number(body.now)
  const skew = Number.isFinite(phoneNow) && Math.abs(now - phoneNow) > 5000 ? now - phoneNow : 0
  const area = typeof body.a === 'string' ? body.a.slice(0, 40) : null
  const build = typeof body.b === 'string' ? body.b.slice(0, 40) : null
  const rows = []
  for (const c of body.c.slice(0, MAX_CHECKS)) {
    if (!c || typeof c !== 'object' || !CID.test(c.id) || !STRENGTHS.has(c.strength)) continue
    if (!Number.isFinite(c.ts) || !Number.isFinite(c.lat) || !Number.isFinite(c.lon) || Math.abs(c.lat) > 90 || Math.abs(c.lon) > 180) continue
    // nothing that names anyone, whatever the phone sent
    const { by: _by, note: _note, ...rest } = c
    const ts = Math.round(c.ts + skew)
    const data = JSON.stringify({ ...rest, ts, ...(Number.isFinite(c.until) ? { until: Math.round(c.until + skew) } : {}) })
    if (data.length > MAX_DATA) continue
    rows.push({ cid: c.id, ts, lat: c.lat, lon: c.lon, data })
  }
  if (!rows.length) return json({ ok: true, n: 0 }, 200, cors)
  // `WHERE true` lets SQLite read ON CONFLICT as the upsert, not a join's ON
  const r = await env.DB.prepare(
    `INSERT INTO checks (install, cid, ts, lat, lon, area, build, data, country, received, updated)
     SELECT ?1, json_extract(value, '$.cid'), json_extract(value, '$.ts'), json_extract(value, '$.lat'), json_extract(value, '$.lon'),
            ?2, ?3, json_extract(value, '$.data'), ?4, ?5, ?5
     FROM json_each(?6) WHERE true
     ON CONFLICT (install, cid) DO UPDATE SET ts = excluded.ts, lat = excluded.lat, lon = excluded.lon, area = excluded.area,
       build = excluded.build, data = excluded.data, country = excluded.country, updated = excluded.updated`,
  )
    .bind(install, area, build, request.cf?.country ?? null, now, JSON.stringify(rows))
    .run()
  return json({ ok: true, n: r.meta?.changes ?? rows.length }, 200, cors)
}

function authorized(request, env, url) {
  if (!env.STATS_KEY) return false
  const auth = request.headers.get('Authorization') ?? ''
  const key = auth.startsWith('Bearer ') ? auth.slice(7) : (url.searchParams.get('key') ?? '')
  return key.length > 0 && key === env.STATS_KEY
}

/** Every shared check made in the window (?days=, default 400) as JSON, one
 *  object each: the row's columns and the check itself. ?area= keeps one area. */
export async function checksExport(request, env) {
  const url = new URL(request.url)
  if (!authorized(request, env, url)) return json({ error: 'key' }, 401)
  const days = Math.min(4000, Math.max(1, Number(url.searchParams.get('days')) || 400))
  const area = url.searchParams.get('area')
  const { results } = await env.DB.prepare(
    `SELECT install, cid, ts, datetime(ts / 1000, 'unixepoch') AS utc, lat, lon, area, build, data, country, received, updated
     FROM checks WHERE ts >= ?1 AND (?2 IS NULL OR area = ?2) ORDER BY ts`,
  )
    .bind(Date.now() - days * DAY, area)
    .all()
  const out = results.map(({ data, ...row }) => ({ ...row, check: JSON.parse(data) }))
  return new Response(JSON.stringify(out), {
    headers: { 'content-type': 'application/json', 'content-disposition': `attachment; filename="groundwind-checks-${days}d.json"`, 'cache-control': 'no-store' },
  })
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...headers, 'content-type': 'application/json', 'cache-control': 'no-store' } })
}
