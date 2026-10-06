// groundwind.app: www goes to the bare domain, /app to the app, /api/request
// keeps area requests (D1, schema.sql), /api/sms and /api/wx answer weather
// requests sent by satellite text (satbot.js), /api/events takes the app's
// usage stats and /api/stats and /api/export read them back (stats.js), and
// everything else is the static site in this folder (wrangler.toml).

import { smsWebhook, wxQuery } from './satbot.js'
import { eventsExport, eventsIngest, statsQuery } from './stats.js'

// where the app lives for now: links, the QR code and shares all go through
// groundwind.app/app, so moving the app is this one line
const APP = 'https://gavanacton.github.io/huntapp/'
// pages that may send a request: the site, and later the app's own button
const ORIGINS = ['https://groundwind.app', 'https://gavanacton.github.io']
const GAME = new Set(['moose', 'deer', 'bear', 'grouse'])

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.hostname === 'www.groundwind.app') {
      url.hostname = 'groundwind.app'
      return Response.redirect(url.toString(), 301)
    }
    if (url.pathname === '/app' || url.pathname.startsWith('/app/')) return Response.redirect(APP + url.search, 302)
    if (url.pathname === '/api/request') return areaRequest(request, env)
    if (url.pathname === '/api/sms') return smsWebhook(request, env)
    if (url.pathname === '/api/wx') return wxQuery(request)
    if (url.pathname === '/api/events') return eventsIngest(request, env)
    if (url.pathname === '/api/stats') return statsQuery(request, env)
    if (url.pathname === '/api/export') return eventsExport(request, env)
    let res = await env.ASSETS.fetch(request)
    if (url.pathname.endsWith('.mp4')) res = await byteRange(request, res)
    return withHeaders(res, url.pathname)
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

async function areaRequest(request, env) {
  const origin = request.headers.get('Origin')
  const cors = ORIGINS.includes(origin) ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: { ...cors, 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Max-Age': '86400' },
    })
  }
  if (request.method !== 'POST') return json({ error: 'post' }, 405, cors)
  let body
  try {
    body = await request.json()
  } catch {
    return json({ error: 'json' }, 400, cors)
  }
  // a bot fills every field, the hidden one too: thank it and keep nothing
  if (body?.website) return json({ ok: true }, 200, cors)

  const email = String(body?.email ?? '').trim().slice(0, 200)
  const place = String(body?.where ?? '').trim().slice(0, 500)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'email' }, 400, cors)
  if (!place) return json({ error: 'where' }, 400, cors)
  const game = (Array.isArray(body.game) ? body.game : []).map(String).filter((g) => GAME.has(g)).join(',')
  const [lat, lon] = pointOf(body, place)
  const source = body.source === 'app' ? 'app' : 'site'

  // a hash of the sender's address, kept only to slow a flood
  const who = await hashOf(request.headers.get('CF-Connecting-IP') ?? '')
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM requests WHERE who = ? AND at > datetime('now', '-1 hour')").bind(who).first('n')
  if (recent >= 5) return json({ error: 'busy' }, 429, cors)

  await env.DB.prepare('INSERT INTO requests (email, place, lat, lon, game, source, country, who) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(email, place, lat, lon, game, source, request.cf?.country ?? null, who)
    .run()
  return json({ ok: true }, 200, cors)
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
  const inCanada = lat > 41 && lat < 84 && lon > -142 && lon < -52
  return inCanada ? [lat, lon] : [null, null]
}

async function hashOf(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('groundwind:' + s))
  return [...new Uint8Array(d).slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function json(data, status, headers) {
  return new Response(JSON.stringify(data), { status, headers: { ...headers, 'content-type': 'application/json' } })
}
