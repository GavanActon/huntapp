// groundwind.app: www goes to the bare domain, /app to the app, /api/request
// keeps area requests (D1, schema.sql) and tells a phone how its own is
// getting on, /api/bake is the bake agent's queue and /areas/ the areas
// baked for requests (bake.js), /api/sms and /api/wx answer weather
// requests sent by satellite text (satbot.js), /api/requests lists every
// area request for Gavan's viewer (requests.html, behind STATS_KEY),
// /api/events takes the app's usage stats and /api/stats and /api/export
// read them back (stats.js),
// /api/visits takes the site's own and /api/site-stats and
// /api/visits/export read them back (sitestats.js),
// /api/checks takes the wind checks hunters share and /api/checks/export
// reads them back (checks.js), /api/party is a hunting party's sealed
// mailbox (party.js), and everything else is the static site in this folder
// (wrangler.toml). Once an hour the pages that changed go to IndexNow, and
// /<key>.txt proves the key is ours (indexnow.js).

import { areasApi, bakeApi } from './bake.js'
import { readyMail, requestMail } from './mail.js'
import { checksExport, checksIngest } from './checks.js'
import { INDEXNOW_KEY, indexNowKey, indexNowSweep } from './indexnow.js'
import { partyApi } from './party.js'
import { smsWebhook, wxQuery } from './satbot.js'
import { siteStatsQuery, visitsExport, visitsIngest } from './sitestats.js'
import { authorized, eventsExport, eventsIngest, statsQuery } from './stats.js'

// where the app lives for now: links, the QR code and shares all go through
// groundwind.app/app, so moving the app is this one line
const APP = 'https://hunt.groundwind.app/'
// pages that may send a request: the site, the app's own button, and the app's dev
// site (app/dev-site; its requests are real ones, into the same queue)
const ORIGINS = ['https://groundwind.app', 'https://hunt.groundwind.app', 'https://gavanacton.github.io', 'https://hunt-dev.groundwind.app', 'https://groundwind-hunt-dev.gavan-acton.workers.dev']
// the app's dev server, on the PC or the phone over the LAN (HTTPS_DEV=1)
const DEV_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3})(:\d{2,5})?$/
const GAME = new Set(['moose', 'elk', 'deer', 'bear', 'grouse'])
const INSTALL = /^[a-f0-9]{16}$/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
// the SD lattice (pipeline/tiles.py, app/src/explore/lattice.ts): habitat cells and tiles
const D_LON = 0.0004
const D_LAT = 0.00027
const TILE_COLS = 375
const TILE_ROWS = 370
// the longest side one ask may have, km (app/src/explore/box.ts SD_MAX_KM, HD_MAX_SIDE_KM)
const MAX_SIDE_KM = { sd: 20, hd: 15 }

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    if (url.hostname === 'www.groundwind.app') {
      url.hostname = 'groundwind.app'
      return Response.redirect(url.toString(), 301)
    }
    if (url.pathname === '/app' || url.pathname.startsWith('/app/')) return Response.redirect(APP + url.search, 302)
    if (url.pathname === '/api/request') return areaRequest(request, env, ctx)
    if (url.pathname === '/api/requests') return requestsList(request, env, url)
    if (url.pathname === '/api/requests/act') return requestsAct(request, env, url)
    if (url.pathname.startsWith('/api/bake/')) return bakeApi(request, env, url, ctx)
    if (url.pathname.startsWith('/areas/')) return areasApi(request, env, url, corsFor(request))
    if (url.pathname === '/api/sms') return smsWebhook(request, env)
    if (url.pathname === '/api/wx') return wxQuery(request)
    if (url.pathname === '/api/events') return eventsIngest(request, env)
    if (url.pathname === '/api/stats') return statsQuery(request, env)
    if (url.pathname === '/api/export') return eventsExport(request, env)
    if (url.pathname === '/api/visits') return visitsIngest(request, env)
    if (url.pathname === '/api/site-stats') return siteStatsQuery(request, env)
    if (url.pathname === '/api/visits/export') return visitsExport(request, env)
    if (url.pathname === '/api/checks') return checksIngest(request, env)
    if (url.pathname === '/api/checks/export') return checksExport(request, env)
    if (url.pathname === '/api/party') return partyApi(request, env)
    if (url.pathname === `/${INDEXNOW_KEY}.txt`) return indexNowKey()
    let res = await env.ASSETS.fetch(request)
    if (url.pathname.endsWith('.mp4')) res = await byteRange(request, res)
    return withHeaders(res, url.pathname)
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(indexNowSweep(env))
  },
}

/** Safari won't play a video from a server that ignores Range, and the
 *  assets binding does: cut the asked-for bytes out here. The loops are
 *  a few MB each, so reading one whole is fine. */
async function byteRange(request, res) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('Range') ?? '')
  if (res.status !== 200 || !m || (m[1] === '' && m[2] === '')) {
    const r = new Response(res.body, res)
    r.headers.set('Accept-Ranges', 'bytes')
    return r
  }
  const buf = await res.arrayBuffer()
  const size = buf.byteLength
  const start = m[1] === '' ? Math.max(0, size - Number(m[2])) : Number(m[1])
  const end = m[1] === '' || m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1)
  if (start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
  const headers = new Headers(res.headers)
  headers.set('Accept-Ranges', 'bytes')
  headers.set('Content-Range', `bytes ${start}-${end}/${size}`)
  headers.set('Content-Length', String(end - start + 1))
  return new Response(buf.slice(start, end + 1), { status: 206, headers })
}

function withHeaders(res, path) {
  const r = new Response(res.body, res)
  r.headers.set('X-Content-Type-Options', 'nosniff')
  r.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  r.headers.set('X-Frame-Options', 'DENY')
  // loops get recut under the same names, so a phone asks each time; the
  // ETag makes that a 304 when nothing changed
  if (path.startsWith('/media/') && res.ok) r.headers.set('Cache-Control', 'public, no-cache')
  return r
}

/** CORS for the site, the app and the app's dev server. Vary: Origin always,
 *  so a cached answer for one origin is never handed to another. */
function corsFor(request) {
  const origin = request.headers.get('Origin')
  const ok = origin && (ORIGINS.includes(origin) || DEV_ORIGIN.test(origin))
  return ok ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : { Vary: 'Origin' }
}

async function areaRequest(request, env, ctx) {
  const cors = corsFor(request)
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: { ...cors, 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Max-Age': '86400' },
    })
  }
  if (request.method !== 'POST' && request.method !== 'GET') return json({ error: 'post' }, 405, cors)
  if (env.EVENTS_LIMIT) {
    // like the stats: a phone polls its request's status every minute or so at most
    const { success } = await env.EVENTS_LIMIT.limit({ key: `req:${request.headers.get('CF-Connecting-IP') ?? 'none'}` })
    if (!success) return json({ error: 'busy' }, 429, cors)
  }
  try {
    return request.method === 'GET' ? await requestStatus(request, env, cors) : await takeRequest(request, env, cors, ctx)
  } catch (e) {
    // Cloudflare's own 500 carries no CORS header, so the page sees only
    // "Failed to fetch" (a D1 column missing did that, 2026-10-09): answer here
    console.error('api/request', e)
    return json({ error: 'server' }, 500, cors)
  }
}

async function takeRequest(request, env, cors, ctx) {
  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: 'json' }, 400, cors)
  }
  // a bot fills every field, the hidden one too: thank it and keep nothing
  if (body?.website) return json({ ok: true }, 200, cors)
  // Explore: an ask taken back (docs/EXPLORE.md), or a location's build (a location removed or
  // moved: app/src/explore/requests.ts dropBuild): by the email it went with or the phone that
  // sent it, and its box (or cell), only while still waiting; one being baked just is not sent
  if (body?.cancel) {
    const email = String(body.email ?? '').trim().slice(0, 200)
    const tile = askedGround(body.tile)
    const install = INSTALL.test(String(body.install ?? '')) ? String(body.install) : null
    const byEmail = EMAIL.test(email) ? email : null
    if ((!byEmail && !install) || !tile) return json({ error: 'cancel' }, 400, cors)
    const r = await beforeMigration(
      () =>
        env.DB.prepare(
          `UPDATE requests SET status = 'cancelled', stage = 'cancelled', updated_at = datetime('now')
           WHERE tile = ?1 AND ((?2 IS NOT NULL AND email = ?2) OR (?3 IS NOT NULL AND install = ?3)) AND status = 'new' AND (stage IS NULL OR stage = 'queued')`,
        )
          .bind(tile, byEmail, install)
          .run(),
      () => env.DB.prepare("UPDATE requests SET status = 'cancelled' WHERE email = ? AND tile = ? AND status = 'new'").bind(byEmail ?? '', tile).run(),
    )
    return json({ ok: true, cancelled: r.meta?.changes ?? 0 }, 200, cors)
  }

  const email = String(body?.email ?? '').trim().slice(0, 200)
  const place = String(body?.where ?? '').trim().slice(0, 500)
  const kind = body?.kind === 'hd' ? 'hd' : 'sd'
  const install = INSTALL.test(String(body?.install ?? '')) ? String(body.install) : null
  // an email is how HD is told it is ready; an SD build is followed by the phone that sent it, so
  // its email is optional (docs/REQUESTS.md: Gavan, 2026-10-24). Neither: nobody could hear of it
  if (email ? !EMAIL.test(email) : kind === 'hd' || !install) return json({ error: 'email' }, 400, cors)
  if (!place) return json({ error: 'where' }, 400, cors)
  const game = (Array.isArray(body.game) ? body.game : []).map(String).filter((g) => GAME.has(g)).join(',')
  const source = body.source === 'app' ? 'app' : 'site'
  // Explore: the box drawn (or, before boxes, the cell) asked for, and SD or HD (docs/EXPLORE.md)
  const tile = askedGround(body.tile)
  // the ground to bake: a box sent as {west, south, east, north}, else the one Explore's tile names
  let box = null
  if (body.box != null) {
    box = boxOf(body.box, kind)
    if (!box) return json({ error: 'box' }, 400, cors)
  } else if (tile) {
    box = boxOfTile(tile)
  }
  let [lat, lon] = pointOf(body, place)
  if (lat === null && box) [lat, lon] = inCanada((box.south + box.north) / 2, (box.west + box.east) / 2)
  const name = String(body.name ?? '').trim().slice(0, 80) || null
  // a pack already baked that holds the whole box serves it at once, and nobody is told whose
  // build it was (docs/REQUESTS.md, Reuse; Gavan, 2026-10-24)
  const served = box && lat !== null ? await coveringPack(env, box, kind) : null
  // with a point the agent can bake it; without one (a place name typed on
  // the site) it waits for a person, as every request did before the loop
  const stage = lat === null ? null : served ? 'done' : 'queued'

  // a build of the same box already under way (a friend's phone opening a shared location before its
  // pack is done): this ask follows that one, one build for both (docs/REQUESTS.md, Reuse)
  if (!served && tile && stage === 'queued') {
    const open = await env.DB.prepare(
      "SELECT id, stage FROM requests WHERE tile = ? AND IFNULL(kind, 'sd') = ? AND stage IN ('queued', 'claimed', 'baking') ORDER BY id LIMIT 1",
    )
      .bind(tile, kind)
      .first()
      .catch(() => null)
    if (open) return json({ ok: true, id: open.id, stage: open.stage, joined: true }, 200, cors)
  }

  // a hash of the sender's address, kept only to slow a flood
  const who = await hashOf(request.headers.get('CF-Connecting-IP') ?? '')
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM requests WHERE who = ? AND at > datetime('now', '-1 hour')").bind(who).first('n')
  if (recent >= 5) return json({ error: 'busy' }, 429, cors)

  const country = request.cf?.country ?? null
  const id = await beforeMigration(
    () =>
      env.DB.prepare(
        `INSERT INTO requests (email, place, lat, lon, game, source, country, who, tile, kind, box, install, name, stage, area_id, done_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, CASE WHEN ?15 IS NOT NULL THEN datetime('now') END, datetime('now')) RETURNING id`,
      )
        .bind(email, place, lat, lon, game, source, country, who, tile, kind, box && JSON.stringify(box), install, name, stage, served)
        .first('id'),
    () =>
      env.DB.prepare('INSERT INTO requests (email, place, lat, lon, game, source, country, who, tile, kind) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id')
        .bind(email, place, lat, lon, game, source, country, who, tile, kind)
        .first('id'),
  )
  // the note to Gavan, and to the asker when they gave an address (mail.js): after the row is in, never before;
  // one served by a pack at once is ready now, and says so
  if (id != null) requestMail(ctx, env, { id, kind, email, place, lat, lon, tile, source, country, served })
  if (id != null && served && email) readyMail(ctx, env, { id, email, areaId: served, tile, lat, lon })
  return json({ ok: true, id, ...(served ? { stage: 'done', area_id: served } : {}) }, 200, cors)
}

/** A pack already baked (D1 `areas`, done) whose core holds the whole box, of the grade asked for
 *  or better (an HD pack serves an SD ask): the same grade first, then the smallest. Null for none,
 *  or with no `areas` table yet. */
async function coveringPack(env, box, kind) {
  let rows
  try {
    rows = (await env.DB.prepare("SELECT id, kind, area_json FROM areas WHERE stage = 'done'").all()).results ?? []
  } catch {
    return null
  }
  const EPS = 1e-5
  const fits = []
  for (const r of rows) {
    if (kind === 'hd' && r.kind !== 'hd') continue
    try {
      const c = JSON.parse(r.area_json)?.core
      if (!c) continue
      if (c.west <= box.west + EPS && c.east >= box.east - EPS && c.south <= box.south + EPS && c.north >= box.north - EPS) {
        fits.push({ id: r.id, same: (r.kind ?? 'sd') === kind, size: (c.east - c.west) * (c.north - c.south) })
      }
    } catch {
      /* a row that is not JSON serves nobody */
    }
  }
  fits.sort((a, b) => Number(b.same) - Number(a.same) || a.size - b.size)
  return fits[0]?.id ?? null
}

/** A Worker deployed before migrations/2026-10-11-requests-bake.sql has run
 *  on the database still takes requests and cancels, the way it did before
 *  the bake loop (a missing column cost the site's form a day on
 *  2026-10-09), and says so in the log. */
async function beforeMigration(now, before) {
  try {
    return await now()
  } catch (e) {
    if (!/no such column|has no column named/i.test(String(e?.message ?? e))) throw e
    console.error('api/request: the bake loop columns are missing: run site/migrations/2026-10-11-requests-bake.sql', e)
    return await before()
  }
}

/** GET /api/request?id=: how a request is getting on, for the phone that
 *  sent it: its stage, the bake step under way, the area it became and,
 *  when it failed or waits for review, the reason's last line. Never the
 *  email, the place or the point: an id is a small number anyone can try.
 *  And how long (docs/REQUESTS.md, Status): `ahead`, the queued requests of
 *  its kind before it; `progress`, 0 to 1, as the agent reports it;
 *  `minutes` to go, from the median of the last builds of its kind, but
 *  only while a machine that bakes that kind has called in within 10
 *  minutes (null when none has: never a clock made up; left out before the
 *  `runners` table exists). */
async function requestStatus(request, env, cors) {
  const id = Number(new URL(request.url).searchParams.get('id'))
  if (!Number.isInteger(id) || id <= 0) return json({ error: 'id' }, 400, cors)
  const cols = "id, IFNULL(kind, 'sd') AS kind, stage, step, area_id, error, IFNULL(updated_at, at) AS updated"
  // `progress` came with the packs (migrations/2026-10-24-packs.sql): a database without it answers without
  const row = await beforeMigration(
    () => env.DB.prepare(`SELECT ${cols}, progress FROM requests WHERE id = ?`).bind(id).first(),
    () => env.DB.prepare(`SELECT ${cols} FROM requests WHERE id = ?`).bind(id).first(),
  )
  if (!row) return json({ error: 'no such request' }, 404, cors)
  const out = { ...row, error: shortError(row.error) }
  if (row.stage === 'queued' || row.stage === 'claimed' || row.stage === 'baking') Object.assign(out, await howLong(env, row))
  if (out.progress != null) out.progress = Math.max(0, Math.min(1, Number(out.progress) || 0))
  return json(out, 200, { ...cors, 'Cache-Control': 'no-store' })
}

/** A build's place in line and its minutes to go (requestStatus). */
async function howLong(env, row) {
  const out = {}
  if (row.stage === 'queued') {
    out.ahead = await env.DB.prepare("SELECT COUNT(*) AS n FROM requests WHERE stage = 'queued' AND IFNULL(kind, 'sd') = ? AND id < ?").bind(row.kind, row.id).first('n')
  }
  let machines
  try {
    machines = await env.DB.prepare("SELECT COUNT(*) AS n FROM runners WHERE last_seen > datetime('now', '-10 minutes') AND (',' || kinds || ',') LIKE ?")
      .bind(`%,${row.kind},%`)
      .first('n')
  } catch {
    return out // no runners table yet: nothing to say about time
  }
  if (!machines) {
    out.minutes = null
    return out
  }
  // the bakes the agents did themselves (claimed, then done), not ones served by a pack or marked by hand
  const { results } = await env.DB.prepare(
    `SELECT (julianday(done_at) - julianday(claimed_at)) * 1440 AS m FROM requests
     WHERE stage = 'done' AND IFNULL(kind, 'sd') = ? AND claimed_at IS NOT NULL AND done_at IS NOT NULL AND agent IS NOT NULL
     ORDER BY id DESC LIMIT 15`,
  )
    .bind(row.kind)
    .all()
  const ms = (results ?? []).map((r) => Number(r.m)).filter((m) => m > 0.5 && m < 48 * 60).sort((a, b) => a - b)
  if (!ms.length) {
    out.minutes = null
    return out
  }
  const typical = ms[Math.floor(ms.length / 2)]
  const left = row.stage === 'queued' ? typical * ((out.ahead ?? 0) / machines + 1) : typical * (1 - Math.max(0, Math.min(1, Number(row.progress) || 0)))
  out.minutes = Math.max(1, Math.round(left))
  return out
}

/** GET /api/requests: every request, newest first, for Gavan's viewer
 *  (requests.html), behind STATS_KEY like the stats: who asked, what for,
 *  the ground, how the bake is getting on and the area it became. A row
 *  from before boxes were sent gets its box from the tile it names. */
async function requestsList(request, env, url) {
  if (request.method !== 'GET') return json({ error: 'get' }, 405)
  if (!authorized(request, env, url)) return json({ error: 'key' }, 401)
  const { results } = await env.DB.prepare(
    `SELECT r.id, r.at, r.email, r.place, r.lat, r.lon, r.game, r.source, r.country, r.status, r.tile, r.kind, r.box,
            r.install, r.name, r.stage, r.step, r.area_id, r.error, r.claimed_at, r.done_at, r.updated_at, r.agent,
            a.name AS area_name, a.size_bytes AS area_bytes, a.stage AS area_stage
     FROM requests r LEFT JOIN areas a ON a.id = r.area_id
     ORDER BY r.id DESC LIMIT 500`,
  ).all()
  const requests = results.map((r) => {
    let box = null
    try {
      box = r.box ? JSON.parse(r.box) : null
    } catch {
      /* a box that isn't JSON: fall back to the tile */
    }
    return { ...r, box: box ?? (r.tile ? boxOfTile(r.tile) : null) }
  })
  return json({ now: new Date().toISOString(), requests }, 200, { 'Cache-Control': 'no-store' })
}

/** POST /api/requests/act {id, action, area_id?}: the requests page's levers, behind STATS_KEY
 *  (Gavan, 2026-10-24: "can I cancel entries? Want to prioritize bakes that aren't from me").
 *  cancel: out of the agent's way (a bake under way is cancelled too: the agent's next post finds
 *  it so and stops); requeue: back in the queue, to bake again; done: served by the area named
 *  (one baked by hand, or one that already covers the box). */
async function requestsAct(request, env, url) {
  if (request.method !== 'POST') return json({ error: 'post' }, 405)
  if (!authorized(request, env, url)) return json({ error: 'key' }, 401)
  const body = await request.json().catch(() => null)
  const id = Number(body?.id)
  const action = String(body?.action || '')
  if (!Number.isInteger(id) || id <= 0) return json({ error: 'id' }, 400)
  let r
  if (action === 'cancel') {
    r = await env.DB.prepare("UPDATE requests SET status = 'cancelled', stage = 'cancelled', step = NULL, updated_at = datetime('now') WHERE id = ? AND stage IS NOT 'done'").bind(id).run()
  } else if (action === 'requeue') {
    r = await env.DB.prepare("UPDATE requests SET status = 'new', stage = 'queued', step = NULL, error = NULL, agent = NULL, claimed_at = NULL, updated_at = datetime('now') WHERE id = ?").bind(id).run()
  } else if (action === 'done') {
    const area = String(body?.area_id || '').trim()
    if (!/^[a-z0-9-]{1,40}$/.test(area)) return json({ error: 'area_id' }, 400)
    r = await env.DB.prepare("UPDATE requests SET status = 'new', stage = 'done', step = NULL, error = NULL, area_id = ?, done_at = datetime('now'), updated_at = datetime('now') WHERE id = ?").bind(area, id).run()
  } else return json({ error: 'action' }, 400)
  return json({ ok: true, changed: r?.meta?.changes ?? 0 }, 200, { 'Cache-Control': 'no-store' })
}

/** A failure's last line, with the PC's paths taken out: the full traceback
 *  stays in D1 for Gavan. */
function shortError(e) {
  if (!e) return null
  const last = String(e).trim().split('\n').filter((l) => l.trim()).pop() ?? ''
  return last.replace(/[A-Za-z]:[\\/][^\s'"]*/g, '…').replace(/(\/[\w.-]+){2,}/g, '…').slice(0, 200)
}

/** A box sent as {west, south, east, north}: in Canada, the right way out,
 *  and no longer a side than one ask may have. Rounded to about 10 cm. */
function boxOf(v, kind) {
  const b = {}
  for (const k of ['west', 'south', 'east', 'north']) {
    b[k] = Number(v?.[k])
    if (!Number.isFinite(b[k])) return null
    b[k] = Math.round(b[k] * 1e6) / 1e6
  }
  if (!(b.west < b.east && b.south < b.north)) return null
  if (inCanada(b.south, b.west)[0] === null || inCanada(b.north, b.east)[0] === null) return null
  const lat = (b.south + b.north) / 2
  const wKm = (b.east - b.west) * 111.32 * Math.cos((lat * Math.PI) / 180)
  const hKm = (b.north - b.south) * 110.57
  return wKm <= MAX_SIDE_KM[kind] + 0.5 && hKm <= MAX_SIDE_KM[kind] + 0.5 ? b : null
}

/** The ground an Explore tile names, as a box: b-<x0>-<y0>-<x1>-<y1> in
 *  habitat cells, or a lattice tile t-<i>-<j> (app/src/explore/box.ts). */
function boxOfTile(tile) {
  const lon = (x) => Math.round((-180 + x * D_LON) * 1e6) / 1e6
  const lat = (y) => Math.round((90 - y * D_LAT) * 1e6) / 1e6
  let m = /^b-(\d+)-(\d+)-(\d+)-(\d+)$/.exec(tile)
  if (m) {
    const [x0, y0, x1, y1] = m.slice(1).map(Number)
    return { west: lon(x0), south: lat(y1), east: lon(x1), north: lat(y0) }
  }
  m = /^t-(\d+)-(\d+)$/.exec(tile)
  if (m) {
    const [i, j] = m.slice(1).map(Number)
    return { west: lon(i * TILE_COLS), south: lat((j + 1) * TILE_ROWS), east: lon((i + 1) * TILE_COLS), north: lat(j * TILE_ROWS) }
  }
  return null
}

/** What Explore asks for: a box (b-<x0>-<y0>-<x1>-<y1>, habitat-cell
 *  indices of the SD lattice, app/src/explore/box.ts) no bigger than one
 *  ask may be, or a lattice cell (t-<i>-<j>) from before there were boxes. */
function askedGround(v) {
  const s = String(v ?? '')
  if (/^t-\d{1,4}-\d{1,4}$/.test(s)) return s
  const m = /^b-(\d{1,7})-(\d{1,7})-(\d{1,7})-(\d{1,7})$/.exec(s)
  if (!m) return null
  const [x0, y0, x1, y1] = m.slice(1).map(Number)
  // 20 km a side is ~1320 cells east at 70° N and ~670 north anywhere
  return x1 > x0 && y1 > y0 && x1 - x0 <= 1400 && y1 - y0 <= 700 ? s : null
}

/** The point asked for: the app sends lat/lon; on the site it is whatever
 *  coordinates the "where" box holds ("49.2, -84.8"), if they land in Canada. */
function pointOf(body, place) {
  let lat = Number(body.lat)
  let lon = Number(body.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    const m = place.match(/(-?\d{1,2}(?:\.\d+)?)\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)/)
    lat = m ? Number(m[1]) : NaN
    lon = m ? Number(m[2]) : NaN
  }
  return inCanada(lat, lon)
}

function inCanada(lat, lon) {
  return lat > 41 && lat < 84 && lon > -142 && lon < -52 ? [lat, lon] : [null, null]
}

async function hashOf(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('groundwind:' + s))
  return [...new Uint8Array(d).slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function json(data, status, headers) {
  return new Response(JSON.stringify(data), { status, headers: { ...headers, 'content-type': 'application/json' } })
}
