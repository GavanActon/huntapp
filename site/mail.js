// Email from the Worker (docs/REQUESTS.md "Email"; Gavan, 2026-10-20: "I need an email for
// requests"). Two bindings in wrangler.toml, each a no-op until it is there:
//
//   NOTIFY  Email Routing's sending, free on every plan, to verified destination addresses only:
//           Gavan's own inbox (the OWNER_EMAIL secret; the repo is public, so not in the toml).
//           A note on every new request.
//   MAIL    Email Sending (Workers Paid, groundwind.app onboarded 2026-10-24): any address, from
//           hello@groundwind.app (Gavan: the site's contact address, so a reply reaches him).
//           "We have your request" and "it's ready" to the one who asked, when they gave an
//           address (an SD build's is optional: the phone follows it). Nothing they typed is
//           echoed back (anyone can put any address in the form: their own words must not go
//           out from groundwind.app), so the ready link names the box and the pack, never the
//           name; the five-an-hour limit per sender (worker.js takeRequest) caps the rest.
//
// A send never holds up the answer (ctx.waitUntil) and a failure is only logged.

const FROM = { email: 'hello@groundwind.app', name: 'Groundwind' }
// the app the links open (worker.js APP)
const APP = 'https://hunt.groundwind.app/'

export function mail(ctx, binding, msg) {
  if (!binding || !msg?.to) return
  const sent = binding.send({ from: FROM, ...msg }).catch((e) => console.error('mail', e?.code ?? '', e?.message ?? e))
  if (ctx?.waitUntil) ctx.waitUntil(sent)
}

const KIND = { sd: 'SD', hd: 'HD' }

/** A request's status page (status.html, served at /l/<token> by worker.js): what the emails link to,
 *  read on any phone or computer, with Open in the app. */
export const statusLink = (token) => `https://groundwind.app/l/${token}`

/** Where a request opens in the app: the location its box makes, on the pack baked for it once
 *  there is one (app/src/areas/runtime.ts addressLocation reads area and p), else its point. */
export function requestLink(r) {
  if (/^b-\d+-\d+-\d+-\d+$/.test(r.tile ?? '')) {
    const q = new URLSearchParams({ area: r.tile, ...(r.areaId ? { p: r.areaId } : {}) })
    return `${APP}?${q}`
  }
  return r.lat != null && r.lon != null ? `${APP}#at=${Number(r.lat).toFixed(5)},${Number(r.lon).toFixed(5)}` : APP
}

/** The notes a new request sends: Gavan's (everything he needs to act on it) and the asker's. */
export function requestMail(ctx, env, r) {
  const kind = KIND[r.kind] ?? 'SD'
  mail(ctx, env.NOTIFY, {
    to: env.OWNER_EMAIL,
    subject: `Groundwind request #${r.id} · ${kind}${r.served ? ` · served by ${r.served}` : ''}`,
    text: [
      `Request #${r.id} · ${kind} · ${r.source ?? 'app'} · ${r.country ?? '?'}`,
      `From: ${r.email || 'no email (the phone follows it)'}`,
      `Where: ${r.place ?? ''}`,
      r.served ? `Served at once by the pack ${r.served}: nothing to bake` : '',
      r.lat != null && r.lon != null ? `Map: ${APP}?area=${r.tile ?? ''}#at=${Number(r.lat).toFixed(5)},${Number(r.lon).toFixed(5)}` : '',
      'All requests: https://groundwind.app/requests',
    ]
      .filter(Boolean)
      .join('\n'),
  })
  // the asker only when they gave an address, and not for one ready already (readyMail says that)
  if (!r.email || r.served) return
  const follow = r.token ? `\n\nSee how it's getting on: ${statusLink(r.token)}` : ''
  mail(ctx, env.MAIL, {
    to: r.email,
    subject: kind === 'HD' ? 'We have your Groundwind HD request' : "We're building your Groundwind spot",
    text:
      kind === 'HD'
        ? `Your HD request (#${r.id}) is in the queue. We'll write again when it's ready.${follow}\n\nGroundwind`
        : `We're building your spot (#${r.id}): its heat map, routes and its own ground wind. We'll write again when it's ready.${follow}\n\nGroundwind`,
  })
}

/** "It's ready", to the one who asked, when the bake is done (bake.js report) or a pack served it at once. */
export function readyMail(ctx, env, r) {
  mail(ctx, env.MAIL, {
    to: r.email,
    subject: 'Your Groundwind spot is ready',
    text: `Your spot is built (#${r.id}). Open it here:\n${r.token ? statusLink(r.token) : requestLink(r)}\n\nGroundwind`,
  })
}
