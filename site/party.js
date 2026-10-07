// A party's mailbox (app/src/party/, docs/PARTY.md): the phones in a hunting
// party post what they share (where each one is, their wind checks, what
// they heard or saw) and read each other's. Everything is sealed on the
// phone with the party's key, which travels only in the invite (a QR code
// or a link's fragment) and never comes here: the Worker keeps a random
// party id, a random member id, a counter and the sealed bytes.
//
//   POST /api/party   { p: party, m: member, i: [{ q: seq, s?: slot, b: sealed }] }
//   GET  /api/party?p=party&after=id   → { i: [{ id, m, q, s, b }], last }
//
// A slot ('pos', 'hello') keeps only a member's newest item of its kind: a
// position replaces the last one, so a phone joining late reads where
// everyone is now, not every fix of the trip. Anything else is kept, and a
// copy sent twice is stored once ((party, member, seq) is unique). A party
// lives while it is used: items older than 14 days go.

const PARTY = /^[A-Za-z0-9_-]{12,32}$/
const MEMBER = /^[a-f0-9]{8,16}$/
const SEALED = /^[A-Za-z0-9_-]{16,12000}$/
const SLOTS = new Set(['pos', 'hello'])
const MAX_BODY = 200_000
const MAX_ITEMS = 50
const PAGE = 500
const KEEP_MS = 14 * 86_400_000

const CORS = { 'Access-Control-Allow-Origin': '*' }

export async function partyApi(request, env) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { ...CORS, 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Max-Age': '86400' } })
  }
  if (request.method === 'GET') return read(request, env)
  if (request.method === 'POST') return post(request, env)
  return json({ error: 'method' }, 405)
}

async function read(request, env) {
  const url = new URL(request.url)
  const party = url.searchParams.get('p') ?? ''
  if (!PARTY.test(party)) return json({ error: 'party' }, 400)
  const after = Math.max(0, Math.floor(Number(url.searchParams.get('after')) || 0))
  const { results } = await env.DB.prepare(`SELECT id, member AS m, seq AS q, slot AS s, body AS b FROM party_items WHERE party = ?1 AND id > ?2 ORDER BY id LIMIT ${PAGE}`)
    .bind(party, after)
    .all()
  const last = results.length ? results[results.length - 1].id : after
  return json({ i: results, last, more: results.length === PAGE })
}

async function post(request, env) {
  if (env.EVENTS_LIMIT) {
    const { success } = await env.EVENTS_LIMIT.limit({ key: request.headers.get('CF-Connecting-IP') ?? 'none' })
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
  const party = String(body?.p ?? '')
  const member = String(body?.m ?? '')
  if (!PARTY.test(party) || !MEMBER.test(member) || !Array.isArray(body.i)) return json({ error: 'shape' }, 400)
  const now = Date.now()
  const stmts = []
  for (const it of body.i.slice(0, MAX_ITEMS)) {
    if (!it || !Number.isInteger(it.q) || it.q < 0 || typeof it.b !== 'string' || !SEALED.test(it.b)) continue
    const slot = typeof it.s === 'string' && SLOTS.has(it.s) ? it.s : null
    // a slot holds the newest only: the old one goes, and the new one gets a new id so readers past it see it
    if (slot) stmts.push(env.DB.prepare('DELETE FROM party_items WHERE party = ?1 AND member = ?2 AND slot = ?3 AND seq < ?4').bind(party, member, slot, it.q))
    stmts.push(env.DB.prepare('INSERT OR IGNORE INTO party_items (party, member, seq, slot, body, received) VALUES (?1, ?2, ?3, ?4, ?5, ?6)').bind(party, member, it.q, slot, it.b, now))
  }
  if (!stmts.length) return json({ ok: true, n: 0 })
  // now and then, the parties nobody has used in two weeks
  if (Math.random() < 0.02) stmts.push(env.DB.prepare('DELETE FROM party_items WHERE received < ?1').bind(now - KEEP_MS))
  await env.DB.batch(stmts)
  return json({ ok: true, n: stmts.length })
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'content-type': 'application/json', 'cache-control': 'no-store' } })
}
