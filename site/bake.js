// The bake loop's Worker side (docs/SD-HD-PLAN.md, The loop: Queue and
// Bake). The bake agent on the pipeline PC (pipeline/agent.py) polls
// /api/bake/next for the oldest queued request, bakes it, puts the files in
// R2 (data.groundwind.app/data/areas/<id>/) and reports each stage to
// /api/bake/<id>; both are behind the BAKE_KEY secret, sent as X-Bake-Key
// (`npx wrangler secret put BAKE_KEY` from site/, and the same value in the
// agent's environment). A finished area goes into D1's `areas` (schema.sql),
// which /areas/index.json and /areas/<id>/area.json are built from, so a
// new area reaches phones with no app build.

import { readyMail } from './mail.js'
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_BODY = 1_000_000
// where the app reads area files (its VITE_DATA_BASE): R2's data/ folder,
// which app/scripts/r2_sync.py fills and pipeline/agent.py adds to; a file's
// address is <data><base><name>, the manifest's <data><manifest>
const DATA_BASE = 'https://data.groundwind.app/data/'
// what each stage may follow. An agent moves its request through claimed,
// baking and on to review, done or failed; review → done is Gavan letting a
// flagged area out (agent.py --approve), anything → queued bakes it again
// (agent.py --requeue)
const FROM = {
  claimed: ['queued'],
  baking: ['claimed', 'baking'],
  review: ['claimed', 'baking'],
  failed: ['queued', 'claimed', 'baking', 'review'],
  done: ['claimed', 'baking', 'review'],
  queued: ['claimed', 'baking', 'review', 'failed', 'done'],
}
// the columns the agent is handed: what to bake, never who asked
// (step: where a bake handed back stopped, so the agent can go on from there)
const TASK = 'id, at, place, name, lat, lon, IFNULL(kind, \'sd\') AS kind, box, tile, game, source, stage, step, agent'

/** The shared secret, compared in constant time: a hash of each side, so
 *  the lengths match whatever was sent. No BAKE_KEY set: nobody gets in. */
export async function bakeAuthorized(request, env) {
  const want = (env.BAKE_KEY ?? '').trim()
  const got = (request.headers.get('X-Bake-Key') ?? '').trim()
  if (!want || !got) return false
  const [a, b] = await Promise.all([want, got].map((s) => crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))))
  return crypto.subtle.timingSafeEqual(a, b)
}

/** /api/bake/next (GET) and /api/bake/<id> (POST), for the agent only. */
export async function bakeApi(request, env, url, ctx) {
  if (!(await bakeAuthorized(request, env))) return json({ error: 'key' }, 401)
  try {
    if (url.pathname === '/api/bake/next') {
      if (request.method !== 'GET') return json({ error: 'get' }, 405)
      return await nextRequest(env, url)
    }
    const m = /^\/api\/bake\/(\d{1,9})$/.exec(url.pathname)
    if (!m) return json({ error: 'path' }, 404)
    if (request.method !== 'POST') return json({ error: 'post' }, 405)
    return await report(request, env, Number(m[1]), ctx)
  } catch (e) {
    console.error('api/bake', e)
    return json({ error: 'server', detail: String(e?.message ?? e).slice(0, 300) }, 500)
  }
}

/** The agent's next job: first one of its own left claimed or baking (it
 *  stopped mid-bake: the PC went off, the process was killed), else the
 *  oldest queued request of a kind it bakes (?kinds=sd, the default),
 *  claimed in the same statement so two agents never take the same one. */
async function nextRequest(env, url) {
  const agent = agentName(url.searchParams.get('agent'))
  const kinds = (url.searchParams.get('kinds') ?? 'sd').split(',').filter((k) => k === 'sd' || k === 'hd')
  if (!agent || !kinds.length) return json({ error: 'agent' }, 400)
  const own = await env.DB.prepare(`SELECT ${TASK} FROM requests WHERE stage IN ('claimed', 'baking') AND agent = ? ORDER BY id LIMIT 1`).bind(agent).first()
  if (own) {
    await env.DB.prepare("UPDATE requests SET updated_at = datetime('now') WHERE id = ?").bind(own.id).run()
    return json({ request: { ...own, resumed: true } }, 200)
  }
  const got = await env.DB.prepare(
    `UPDATE requests SET stage = 'claimed', agent = ?1, claimed_at = datetime('now'), updated_at = datetime('now'), step = NULL, error = NULL
     WHERE id = (SELECT id FROM requests WHERE stage = 'queued' AND IFNULL(kind, 'sd') IN (SELECT value FROM json_each(?2)) ORDER BY id LIMIT 1)
       AND stage = 'queued'
     RETURNING ${TASK}`,
  )
    .bind(agent, JSON.stringify(kinds))
    .first()
  return json({ request: got ?? null }, 200)
}

/** A stage from the agent: {stage, agent, step?, error?, area_id?}, and for
 *  done {area_id, area_json, files_json, size_bytes}. Refused (409, with the
 *  stage it is at) when the request is not where that stage can follow, or
 *  another agent holds it. */
async function report(request, env, id, ctx) {
  const text = await request.text()
  if (text.length > MAX_BODY) return json({ error: 'size' }, 413)
  let body
  try {
    body = JSON.parse(text)
  } catch {
    return json({ error: 'json' }, 400)
  }
  const stage = String(body?.stage ?? '')
  if (!FROM[stage]) return json({ error: 'stage' }, 400)
  const agent = agentName(body.agent)
  const step = body.step == null ? null : String(body.step).slice(0, 60)
  const error = body.error == null ? null : String(body.error).slice(-4000)
  const areaId = body.area_id == null ? null : String(body.area_id)
  if (areaId !== null && !ID.test(areaId)) return json({ error: 'area_id' }, 400)
  const from = JSON.stringify(FROM[stage])
  // an agent may only move what it holds; a requeue (by hand) may move anything
  const mine = stage === 'claimed' || stage === 'queued' ? '1' : '(agent IS NULL OR agent = ?4)'

  if (stage === 'done') {
    const done = doneArea(body, areaId)
    if (typeof done === 'string') return json({ error: done }, 400)
    // the area first, on the same condition as the request's move, in one
    // transaction: a refused done leaves no area behind
    const [, moved] = await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO areas (id, name, lat, lon, kind, stage, area_json, files_json, size_bytes, request_id)
         SELECT ?1, ?2, ?3, ?4, IFNULL(kind, 'sd'), 'done', ?5, ?6, ?7, id FROM requests
         WHERE id = ?8 AND stage IN (SELECT value FROM json_each(?9)) AND (agent IS NULL OR agent = ?10)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, lat = excluded.lat, lon = excluded.lon, kind = excluded.kind, stage = 'done',
           area_json = excluded.area_json, files_json = excluded.files_json, size_bytes = excluded.size_bytes,
           request_id = excluded.request_id, updated_at = datetime('now')`,
      ).bind(areaId, done.name, done.lat, done.lon, done.areaJson, done.filesJson, done.size, id, from, agent),
      env.DB.prepare(
        `UPDATE requests SET stage = 'done', area_id = ?1, step = NULL, error = NULL, done_at = datetime('now'), updated_at = datetime('now')
         WHERE id = ?2 AND stage IN (SELECT value FROM json_each(?3)) AND (agent IS NULL OR agent = ?4)`,
      ).bind(areaId, id, from, agent),
    ])
    if (!moved.meta?.changes) return refused(env, id)
    // "your area is ready" to the one who asked (mail.js; the agent's task leaves the email out, so it is read here)
    const to = await env.DB.prepare('SELECT email FROM requests WHERE id = ?').bind(id).first('email')
    if (to) readyMail(ctx, env, { id, email: to, areaId })
    return json({ ok: true, id, stage, area_id: areaId }, 200)
  }

  const r = await env.DB.prepare(
    `UPDATE requests SET stage = ?1, step = ?5, error = ?6, area_id = IFNULL(?7, area_id), updated_at = datetime('now'),
       agent = CASE WHEN ?1 = 'claimed' THEN ?4 ELSE agent END,
       claimed_at = CASE WHEN ?1 = 'claimed' THEN datetime('now') ELSE claimed_at END
     WHERE id = ?2 AND stage IN (SELECT value FROM json_each(?3)) AND ${mine}`,
  )
    .bind(stage, id, from, agent, step, error, areaId)
    .run()
  if (!r.meta?.changes) return refused(env, id)
  return json({ ok: true, id, stage }, 200)
}

/** What a done report must carry, checked, or the reason it is refused. */
function doneArea(body, areaId) {
  if (!areaId) return 'area_id'
  const areaJson = typeof body.area_json === 'string' ? body.area_json : JSON.stringify(body.area_json ?? null)
  // kept as sent: the phone's manifest hash is of these very bytes
  const filesJson = typeof body.files_json === 'string' ? body.files_json : JSON.stringify(body.files_json ?? null)
  let a, f
  try {
    a = JSON.parse(areaJson)
    f = JSON.parse(filesJson)
  } catch {
    return 'json'
  }
  if (a?.id !== areaId || typeof a.name !== 'string' || typeof a.base !== 'string' || !a.region || !Array.isArray(a.centre) || !a.files) return 'area_json'
  if (!f || typeof f.files !== 'object' || Array.isArray(f.files)) return 'files_json'
  const size = Number(body.size_bytes)
  if (!Number.isFinite(size) || size < 0) return 'size_bytes'
  return { areaJson, filesJson, size: Math.round(size), name: a.name.slice(0, 120), lon: Number(a.centre[0]) || null, lat: Number(a.centre[1]) || null }
}

async function refused(env, id) {
  const row = await env.DB.prepare('SELECT stage, agent FROM requests WHERE id = ?').bind(id).first()
  if (!row) return json({ error: 'no such request' }, 404)
  return json({ error: 'stage', stage: row.stage, agent: row.agent }, 409)
}

/** A machine's name as the agent gives it (XEVO, xonix-2). */
function agentName(v) {
  const s = String(v ?? '').trim()
  return /^[A-Za-z0-9._-]{1,40}$/.test(s) ? s : null
}

// ---- the area list, for the app ---------------------------------------------

/** /areas/index.json and /areas/<id>/area.json: the areas baked on request,
 *  from D1. The index has the form the app's build writes for the areas it
 *  ships (vite.config.ts dataManifest: id, name, region, centre, base,
 *  manifest, hash, bytes, files), plus `data`, the host the files are on,
 *  and each area's kind and last bake. Short cache: a new area shows up
 *  within a minute. `cors` is the Worker's, for the app's origins. */
export async function areasApi(request, env, url, cors) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'GET, HEAD', 'Access-Control-Max-Age': '86400' } })
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') return json({ error: 'get' }, 405, cors)
  const headers = { ...cors, 'Cache-Control': 'public, max-age=60' }
  try {
    if (url.pathname === '/areas/index.json') return await areaIndex(env, headers)
    const m = /^\/areas\/([^/]{1,80})\/area\.json$/.exec(url.pathname)
    if (m) return await areaFile(env, m[1], headers)
    return json({ error: 'path' }, 404, headers)
  } catch (e) {
    console.error('areas', e)
    return json({ error: 'server' }, 500, cors)
  }
}

async function areaIndex(env, headers) {
  const { results } = await env.DB.prepare("SELECT id, name, kind, area_json, files_json, size_bytes, updated_at FROM areas WHERE stage = 'done' ORDER BY created_at, id").all()
  const areas = []
  for (const row of results ?? []) {
    try {
      const a = JSON.parse(row.area_json)
      const files = JSON.parse(row.files_json).files ?? {}
      areas.push({
        id: row.id,
        name: row.name,
        kind: row.kind,
        region: a.region,
        centre: a.centre,
        base: a.base,
        manifest: `${a.base}manifest.json`,
        hash: await sha16(row.files_json),
        bytes: row.size_bytes,
        files: Object.keys(files),
        updated: row.updated_at,
      })
    } catch (e) {
      console.error('areas/index.json', row.id, e) // one bad row never takes the list down
    }
  }
  return json({ data: DATA_BASE, areas }, 200, headers)
}

async function areaFile(env, id, headers) {
  if (!ID.test(id)) return json({ error: 'id' }, 404, headers)
  const row = await env.DB.prepare("SELECT area_json FROM areas WHERE id = ? AND stage = 'done'").bind(id).first()
  if (!row) return json({ error: 'no such area' }, 404, headers)
  return new Response(row.area_json, { status: 200, headers: { ...headers, 'content-type': 'application/json' } })
}

/** The hash the app's build gives a manifest: SHA-1, the first 16 hex. */
async function sha16(s) {
  const d = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s))
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16)
}

function json(data, status, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...headers, 'content-type': 'application/json' } })
}
