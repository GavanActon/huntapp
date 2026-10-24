// Accounts (docs/REQUESTS.md, Accounts; Gavan, 2026-10-24: "an email and a 6-digit code, no
// password"). Asked for only when something must find a hunter later or follow them: HD, their
// locations on another device or the Home Screen app. A code, not a link: on an iPhone a link in
// an email opens in Safari, never the Home Screen app, so it would sign in the wrong place.
//
//   POST /api/auth/start   {email}               a code by email: 6 digits, 15 minutes, 5 tries
//   POST /api/auth/verify  {email, code, install} a session: {token, email}
//   POST /api/auth/out                            the session ends
//   GET  /api/me                                  {email}
//   GET  /api/me/locations                        the account's locations
//   POST /api/me/locations {locations, removed}   the phone's list merged in, the list back
//
// The session rides as `Authorization: Bearer <token>`; D1 keeps only hashes of tokens and codes.
// Tables: migrations/2026-10-24-accounts.sql. Before it has run every route answers 503 'accounts'.

import { mail } from './mail.js'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const ID = /^b-\d{1,7}-\d{1,7}-\d{1,7}-\d{1,7}$/
const PACK = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const INSTALL = /^[a-f0-9]{16}$/
const CODE_MIN = 15
const CODE_TRIES = 5
// codes asked for one address an hour, and from one sender: enough for a typo or two, not a flood
const CODES_PER_EMAIL = 5
const CODES_PER_SENDER = 10
// a season and the next; each use pushes it on
const SESSION_DAYS = 400
const MAX_LOCATIONS = 200

const bytes = (n) => crypto.getRandomValues(new Uint8Array(n))
const b64url = (b) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
export const randomToken = (n = 32) => b64url(bytes(n))

async function sha(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function same(a, b) {
  const x = new TextEncoder().encode(a)
  const y = new TextEncoder().encode(b)
  return x.length === y.length && crypto.subtle.timingSafeEqual(x, y)
}

function json(data, status, headers) {
  return new Response(JSON.stringify(data), { status, headers: { ...headers, 'content-type': 'application/json', 'Cache-Control': 'no-store' } })
}

const normal = (e) => String(e ?? '').trim().toLowerCase().slice(0, 200)

/** The account a request's session names, or null (none sent, unknown, lapsed, or no tables yet). */
export async function sessionOf(request, env) {
  const m = /^Bearer\s+([A-Za-z0-9_-]{20,100})$/.exec(request.headers.get('Authorization') ?? '')
  if (!m) return null
  try {
    const hash = await sha(m[1])
    const row = await env.DB.prepare(
      `SELECT s.account, a.email, s.last_seen FROM sessions s JOIN accounts a ON a.id = s.account
       WHERE s.token_hash = ? AND s.last_seen > datetime('now', ?)`,
    )
      .bind(hash, `-${SESSION_DAYS} days`)
      .first()
    if (!row) return null
    // pushed on at most once a day: a session in use never lapses
    if (Date.now() - Date.parse(`${row.last_seen.replace(' ', 'T')}Z`) > 86_400_000) {
      await env.DB.prepare("UPDATE sessions SET last_seen = datetime('now') WHERE token_hash = ?").bind(hash).run()
    }
    return { account: row.account, email: row.email, hash }
  } catch {
    return null
  }
}

/** /api/auth/* and /api/me/*. `who` is the sender's hashed address (worker.js hashOf). */
export async function accountApi(request, env, url, cors, ctx, who) {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: { ...cors, 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'content-type, authorization', 'Access-Control-Max-Age': '86400' },
    })
  }
  try {
    switch (url.pathname) {
      case '/api/auth/start':
        return request.method === 'POST' ? await start(request, env, cors, ctx, who) : json({ error: 'post' }, 405, cors)
      case '/api/auth/verify':
        return request.method === 'POST' ? await verify(request, env, cors) : json({ error: 'post' }, 405, cors)
      case '/api/auth/out':
        return request.method === 'POST' ? await signOut(request, env, cors) : json({ error: 'post' }, 405, cors)
      case '/api/me': {
        const s = await sessionOf(request, env)
        return s ? json({ email: s.email }, 200, cors) : json({ error: 'session' }, 401, cors)
      }
      case '/api/me/locations':
        return await locations(request, env, cors)
      default:
        return json({ error: 'path' }, 404, cors)
    }
  } catch (e) {
    // a database without the accounts tables (migrations/2026-10-24-accounts.sql not run)
    if (/no such table/i.test(String(e?.message ?? e))) return json({ error: 'accounts' }, 503, cors)
    console.error('account', e)
    return json({ error: 'server' }, 500, cors)
  }
}

async function start(request, env, cors, ctx, who) {
  const body = await request.json().catch(() => null)
  const email = normal(body?.email)
  if (!EMAIL.test(email)) return json({ error: 'email' }, 400, cors)
  const recent = await env.DB.prepare(
    "SELECT SUM(email = ?1) AS mine, SUM(who = ?2) AS sender FROM codes WHERE created_at > datetime('now', '-1 hour')",
  )
    .bind(email, who)
    .first()
  if ((recent?.mine ?? 0) >= CODES_PER_EMAIL || (recent?.sender ?? 0) >= CODES_PER_SENDER) return json({ error: 'busy' }, 429, cors)
  // six digits, every one as likely (a rejection draw, so 000000-999999 are even)
  let n
  do n = new Uint32Array(bytes(4).buffer)[0]
  while (n >= 4_294_000_000)
  const code = String(n % 1_000_000).padStart(6, '0')
  await env.DB.prepare('INSERT INTO codes (email, hash, who) VALUES (?, ?, ?)').bind(email, await sha(`${email}:${code}`), who).run()
  mail(ctx, env.MAIL, {
    to: email,
    subject: `Your Groundwind code: ${code}`,
    text: `Your Groundwind code is ${code}.\n\nType it into the app within ${CODE_MIN} minutes. If you didn't ask for it, ignore this email: nothing happens without the code.\n\nGroundwind`,
  })
  // the same answer for an address with an account or none: no list of who has one
  return json({ ok: true, minutes: CODE_MIN }, 200, cors)
}

async function verify(request, env, cors) {
  const body = await request.json().catch(() => null)
  const email = normal(body?.email)
  const code = String(body?.code ?? '').replace(/\D/g, '')
  if (!EMAIL.test(email) || code.length !== 6) return json({ error: 'code' }, 400, cors)
  const row = await env.DB.prepare(
    `SELECT id, hash, tries FROM codes WHERE email = ? AND used = 0 AND created_at > datetime('now', ?) ORDER BY id DESC LIMIT 1`,
  )
    .bind(email, `-${CODE_MIN} minutes`)
    .first()
  if (!row) return json({ error: 'expired' }, 400, cors)
  if (row.tries >= CODE_TRIES) return json({ error: 'tries' }, 400, cors)
  if (!same(row.hash, await sha(`${email}:${code}`))) {
    await env.DB.prepare('UPDATE codes SET tries = tries + 1 WHERE id = ?').bind(row.id).run()
    return json({ error: 'code', left: Math.max(0, CODE_TRIES - row.tries - 1) }, 400, cors)
  }
  await env.DB.prepare('UPDATE codes SET used = 1 WHERE id = ?').bind(row.id).run()
  await env.DB.prepare('INSERT INTO accounts (email) VALUES (?) ON CONFLICT(email) DO NOTHING').bind(email).run()
  const account = await env.DB.prepare('SELECT id FROM accounts WHERE email = ?').bind(email).first('id')
  const token = randomToken()
  const install = INSTALL.test(String(body?.install ?? '')) ? String(body.install) : null
  await env.DB.prepare('INSERT INTO sessions (token_hash, account, install) VALUES (?, ?, ?)').bind(await sha(token), account, install).run()
  return json({ ok: true, token, email }, 200, cors)
}

async function signOut(request, env, cors) {
  const s = await sessionOf(request, env)
  if (s) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(s.hash).run()
  return json({ ok: true }, 200, cors)
}

/** A location as the phone keeps it (app/src/areas/runtime.ts), checked; null for one that is not. */
function locationOf(v) {
  const id = String(v?.id ?? '')
  if (!ID.test(id)) return null
  const pack = typeof v.pack === 'string' && PACK.test(v.pack) ? v.pack : null
  return {
    id,
    name: String(v.name ?? '').trim().slice(0, 60) || 'Spot',
    j: String(v.jurisdiction ?? v.j ?? '').slice(0, 3).toUpperCase() || null,
    pack,
    at: Number.isFinite(Number(v.at)) ? Math.round(Number(v.at)) : Date.now(),
    edited: Number.isFinite(Number(v.edited)) ? Math.round(Number(v.edited)) : 0,
  }
}

/** The account's list, and the phone's merged into it: a location the phone has is added, or
 *  takes the phone's name when the phone renamed it later (`edited`) and its pack when the
 *  account's has none; one the phone removed is marked so, and a location removed on any device
 *  stays removed for a phone that loaded it before (`at` older than the removal). Back: the list,
 *  and the ids removed, for the phone to drop. */
async function locations(request, env, cors) {
  const s = await sessionOf(request, env)
  if (!s) return json({ error: 'session' }, 401, cors)
  if (request.method === 'POST') {
    const body = await request.json().catch(() => null)
    const mine = (Array.isArray(body?.locations) ? body.locations : []).slice(0, MAX_LOCATIONS).map(locationOf).filter(Boolean)
    const gone = (Array.isArray(body?.removed) ? body.removed : []).map(String).filter((id) => ID.test(id)).slice(0, MAX_LOCATIONS)
    const stmts = mine.map((l) =>
      env.DB.prepare(
        `INSERT INTO locations (account, id, name, j, pack, at, edited) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(account, id) DO UPDATE SET
           name = CASE WHEN excluded.edited > locations.edited THEN excluded.name ELSE locations.name END,
           edited = MAX(locations.edited, excluded.edited),
           j = IFNULL(locations.j, excluded.j),
           pack = IFNULL(locations.pack, excluded.pack),
           removed_at = CASE WHEN locations.removed_at IS NOT NULL AND excluded.at > locations.removed_ms THEN NULL ELSE locations.removed_at END,
           removed_ms = CASE WHEN locations.removed_at IS NOT NULL AND excluded.at > locations.removed_ms THEN NULL ELSE locations.removed_ms END,
           updated_at = datetime('now')`,
      ).bind(s.account, l.id, l.name, l.j, l.pack, l.at, l.edited),
    )
    for (const id of gone) {
      stmts.push(
        env.DB.prepare("UPDATE locations SET removed_at = datetime('now'), removed_ms = ?3, updated_at = datetime('now') WHERE account = ?1 AND id = ?2 AND removed_at IS NULL").bind(
          s.account,
          id,
          Date.now(),
        ),
      )
    }
    if (stmts.length) await env.DB.batch(stmts)
  }
  const { results } = await env.DB.prepare('SELECT id, name, j, pack, at, edited, removed_at FROM locations WHERE account = ? ORDER BY at').bind(s.account).all()
  const rows = results ?? []
  return json(
    {
      email: s.email,
      locations: rows.filter((r) => !r.removed_at).map((r) => ({ id: r.id, name: r.name, jurisdiction: r.j, pack: r.pack, at: r.at, edited: r.edited })),
      removed: rows.filter((r) => r.removed_at).map((r) => r.id),
    },
    200,
    cors,
  )
}
