// Email from the Worker (docs/REQUESTS.md "Email"; Gavan, 2026-10-20: "I need an email for
// requests"). Two bindings in wrangler.toml, each a no-op until it is there:
//
//   NOTIFY  Email Routing's sending, free on every plan, to verified destination addresses only:
//           Gavan's own inbox (the OWNER_EMAIL secret; the repo is public, so not in the toml).
//           A note on every new request.
//   MAIL    Email Sending (Workers Paid, groundwind.app onboarded): any address, from
//           noreply@groundwind.app. "We have your request" and "your area is ready" to the one
//           who asked. Nothing they typed is echoed back (anyone can put any address in the
//           form: their own words must not go out from groundwind.app); the five-an-hour limit
//           per sender (worker.js takeRequest) caps the rest.
//
// A send never holds up the answer (ctx.waitUntil) and a failure is only logged.

const FROM = { email: 'noreply@groundwind.app', name: 'Groundwind' }

export function mail(ctx, binding, msg) {
  if (!binding || !msg?.to) return
  const sent = binding.send({ from: FROM, ...msg }).catch((e) => console.error('mail', e?.code ?? '', e?.message ?? e))
  if (ctx?.waitUntil) ctx.waitUntil(sent)
}

const KIND = { sd: 'SD', hd: 'HD' }

/** The two notes a new request sends: Gavan's (everything he needs to act on it) and the asker's. */
export function requestMail(ctx, env, r) {
  const kind = KIND[r.kind] ?? 'SD'
  mail(ctx, env.NOTIFY, {
    to: env.OWNER_EMAIL,
    subject: `Groundwind request #${r.id} · ${kind}`,
    text: [
      `Request #${r.id} · ${kind} · ${r.source ?? 'app'} · ${r.country ?? '?'}`,
      `From: ${r.email}`,
      `Where: ${r.place ?? ''}`,
      r.lat != null && r.lon != null ? `Map: https://hunt.groundwind.app/?area=${r.tile ?? ''}#at=${Number(r.lat).toFixed(5)},${Number(r.lon).toFixed(5)}` : '',
      'All requests: https://groundwind.app/requests',
    ]
      .filter(Boolean)
      .join('\n'),
  })
  mail(ctx, env.MAIL, {
    to: r.email,
    subject: 'We have your Groundwind request',
    text: `Your ${kind} request (#${r.id}) is in the queue. We'll write again when your area is ready.\n\nGroundwind`,
  })
}

/** "Your area is ready", to the one who asked, when the bake is done (bake.js report). */
export function readyMail(ctx, env, r) {
  mail(ctx, env.MAIL, {
    to: r.email,
    subject: 'Your Groundwind area is ready',
    text: `Request #${r.id} is ready. Open it here:\nhttps://hunt.groundwind.app/?area=${encodeURIComponent(r.areaId)}\n\nGroundwind`,
  })
}
