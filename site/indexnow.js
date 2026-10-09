// IndexNow (indexnow.org): tells Bing, and the engines that share its pings,
// when a page of the site changes, so AI search that leans on Bing reads it
// soon after a deploy (docs/AI-VISIBILITY.md). Once an hour (wrangler.toml)
// the worker reads the pages in sitemap.xml from its own assets, hashes each
// and sends the ones that are new, changed or gone since the last send
// (D1, schema.sql, indexnow). Whoever deploys, however, nothing to remember.
// The key is public by design: an engine fetches /<KEY>.txt to check the
// sender owns the site.

export const INDEXNOW_KEY = '9ce481267d778256561352784d78cd1f'
const HOST = 'groundwind.app'
const ENDPOINTS = ['https://www.bing.com/indexnow', 'https://api.indexnow.org/indexnow']

export function indexNowKey() {
  return new Response(INDEXNOW_KEY, { headers: { 'content-type': 'text/plain; charset=utf-8' } })
}

export async function indexNowSweep(env) {
  const map = await env.ASSETS.fetch(`https://${HOST}/sitemap.xml`)
  if (!map.ok) return console.log('indexnow: no sitemap', map.status)
  const urls = [...(await map.text()).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1])
  const now = new Map()
  for (const u of urls) {
    const r = await env.ASSETS.fetch(u)
    // a page in the sitemap that won't load is left as it was, not sent as gone
    if (r.ok) now.set(u, await hashOf(await r.arrayBuffer()))
  }
  const { results } = await env.DB.prepare('SELECT url, hash FROM indexnow').all()
  const sent = new Map(results.map((r) => [r.url, r.hash]))
  const changed = [...now].filter(([u, h]) => sent.get(u) !== h).map(([u]) => u)
  const gone = [...sent.keys()].filter((u) => !urls.includes(u))
  if (!changed.length && !gone.length) return

  // api.indexnow.org turned the Worker away with a 429 (2026-10-09) while the
  // same ping from a desktop was taken: it throttles Cloudflare's shared way
  // out. Bing's own door first, then the shared one; any engine passes it on.
  const body = JSON.stringify({ host: HOST, key: INDEXNOW_KEY, keyLocation: `https://${HOST}/${INDEXNOW_KEY}.txt`, urlList: [...changed, ...gone] })
  let ok = false
  for (const door of ENDPOINTS) {
    const res = await fetch(door, { method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8' }, body })
    // 200 taken, 202 taken while the key is checked
    if (res.status === 200 || res.status === 202) {
      ok = true
      break
    }
    console.log('indexnow:', door, res.status, (await res.text()).slice(0, 200))
  }
  // turned away everywhere: nothing is marked sent, so next hour tries again
  if (!ok) return
  const at = Date.now()
  await env.DB.batch([
    ...changed.map((u) =>
      env.DB.prepare('INSERT INTO indexnow (url, hash, sent) VALUES (?, ?, ?) ON CONFLICT (url) DO UPDATE SET hash = excluded.hash, sent = excluded.sent').bind(u, now.get(u), at),
    ),
    ...gone.map((u) => env.DB.prepare('DELETE FROM indexnow WHERE url = ?').bind(u)),
  ])
  console.log('indexnow: sent', changed.length, 'changed,', gone.length, 'gone')
}

async function hashOf(buf) {
  const d = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(d).slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
