// What a visit to the site sees and does (docs/ANALYTICS.md "The site"):
// which sections came on screen and for how long, the loops watched, what was
// tapped and opened, the request form's steps, how fast the page came up and
// where the visit came from, under a random id for the browser. Never what is
// typed in the form. Batches go to /api/visits (sitestats.js), and a tap on
// "Open the app" carries the id (?v=) so the app's first open can say it came
// from here.
//
// Nothing goes from a browser with Global Privacy Control on, one driven by a
// script (the loops' recordings), a crawler, or one switched off: a browser
// that has opened the dashboard (stats.html), or any page opened with ?notrack.
;(() => {
  const nav = navigator
  const get = (k) => {
    try {
      return localStorage.getItem(k)
    } catch {
      return null
    }
  }
  const set = (k, v) => {
    try {
      localStorage.setItem(k, v)
    } catch {
      /* private window: this page's visit only */
    }
  }
  if (new URLSearchParams(location.search).has('notrack')) set('gw-site-off', '1')
  const BOT = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|facebookexternalhit|embedly/i
  if (nav.globalPrivacyControl === true || nav.webdriver || BOT.test(nav.userAgent) || get('gw-site-off') === '1') return

  const URL_ = '/api/visits'
  const GAP = 30 * 60_000 // a session ends after 30 min with nothing done, as in the app
  const TICK = 500
  const IDLE = 90_000 // a tab left open on a section stops counting after this
  const FLUSH = 15_000
  const MAX = 400 // events a page load may send, so a stuck loop can't flood
  const hex = (n) => [...crypto.getRandomValues(new Uint8Array(n / 2))].map((b) => b.toString(16).padStart(2, '0')).join('')
  const t0 = Date.now()

  // the browser, the session, this page load
  let visitor = get('gw-visitor')
  let isNew = false
  if (!/^[a-f0-9]{16}$/.test(visitor ?? '')) {
    visitor = hex(16)
    isNew = true
    set('gw-visitor', visitor)
  }
  // the session, shared by the site's tabs: { s: id, last: ms, n: sessions so far }
  let vs = { s: '', last: 0, n: 0 }
  const readSession = () => {
    try {
      const o = JSON.parse(get('gw-visit') ?? '')
      if (o && typeof o.s === 'string' && o.last >= vs.last) vs = o
    } catch {
      /* none yet */
    }
  }
  /** Something done now: the session goes on, or a new one starts (true). */
  const touch = (t) => {
    readSession()
    const fresh = !vs.s || t - vs.last > GAP
    vs = fresh ? { s: hex(12), last: t, n: (vs.n || 0) + 1 } : { ...vs, last: t }
    set('gw-visit', JSON.stringify(vs))
    return fresh
  }
  const view = hex(12)
  const lost = !!document.querySelector('main.lost')
  const page = lost ? '/404' : location.pathname.replace(/\.html$/, '').replace(/\/index$/, '/').toLowerCase() || '/'

  let queue = []
  let seq = 0
  // measured, not done: they belong to the session they measure, and never start one
  const PASSIVE = new Set(['dwell', 'watch', 'hide', 'vitals', 'error', 'asset_error'])
  function track(n, p) {
    if (seq >= MAX) return
    const t = Date.now()
    // a new session begun on this page (a tab come back to after a while) lands here
    if ((!PASSIVE.has(n) || !vs.s) && touch(t) && n !== 'view') landing(true)
    queue.push({ s: vs.s, q: seq++, t, n, p: clean(p) })
    if (queue.length >= 40) flush()
  }
  function clean(p) {
    if (!p) return null
    const out = {}
    for (const [k, v] of Object.entries(p)) {
      if (v == null || v === '') continue
      out[k] = typeof v === 'string' ? v.slice(0, k === 'msg' ? 160 : 60) : typeof v === 'boolean' ? (v ? 1 : 0) : v
    }
    return out
  }

  function flush(leaving) {
    if (!queue.length) return
    const batch = queue.splice(0, 150)
    if (leaving && queue.length) flush(true)
    const body = JSON.stringify({ i: visitor, v: view, p: page, now: Date.now(), e: batch })
    // leaving: the beacon outlives the page
    if (leaving && nav.sendBeacon && body.length < 60_000 && nav.sendBeacon(URL_, new Blob([body], { type: 'text/plain' }))) return
    fetch(URL_, { method: 'POST', headers: { 'content-type': 'text/plain' }, body, keepalive: body.length < 60_000 })
      .then((r) => {
        // a 4xx is a batch the server will never take
        if (r.status >= 500) throw new Error(String(r.status))
      })
      .catch(() => {
        if (!leaving) queue = [...batch, ...queue].slice(0, 300)
      })
  }

  function platform() {
    const ua = nav.userAgent
    const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && nav.maxTouchPoints > 1)
    const android = /Android/.test(ua)
    const browser = /SamsungBrowser/.test(ua) ? 'samsung' : /EdgA?\//.test(ua) ? 'edge' : /FxiOS|Firefox/.test(ua) ? 'firefox' : /CriOS|Chrome/.test(ua) ? 'chrome' : /Safari/.test(ua) ? 'safari' : 'other'
    return { platform: ios ? 'ios' : android ? 'android' : /Windows/.test(ua) ? 'windows' : /Mac/.test(ua) ? 'mac' : /CrOS/.test(ua) ? 'chromeos' : /Linux/.test(ua) ? 'linux' : 'other', browser }
  }
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches

  /** The page opened: where from, on what. `again`: a session begun on a
   *  tab come back to, so the referrer and the tags are not counted twice. */
  function landing(again) {
    // the session first, so the count below is this one's
    if (!again) touch(Date.now())
    let navType
    try {
      navType = performance.getEntriesByType('navigation')[0]?.type
    } catch {
      /* no timing */
    }
    const p = {
      new: isNew,
      visits: vs.n,
      vp: `${innerWidth}x${innerHeight}`,
      dpr: Math.round(devicePixelRatio * 100) / 100,
      ...platform(),
      lang: nav.language,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
      conn: nav.connection?.effectiveType,
      reduced,
      nav: navType,
    }
    isNew = false
    if (again) p.again = 1
    else {
      try {
        const r = document.referrer ? new URL(document.referrer) : null
        if (r && r.host !== location.host) p.ref = r.hostname.replace(/^www\./, '')
        else if (r) p.from = r.pathname
      } catch {
        /* a referrer that isn't a URL */
      }
      const q = new URLSearchParams(location.search)
      for (const k of ['utm_source', 'utm_medium', 'utm_campaign']) p[k] = q.get(k)
      if (location.hash) p.hash = location.hash.slice(0, 40)
      if (lost) p.path = location.pathname
    }
    track('view', p)
  }

  // ---------------------------------------------------------------- what's on screen

  // The page in parts: the sections of the homepage and the guide; an
  // article's stretch under each heading. A part is in view when it fills
  // half the screen, or most of itself when it's short.
  function parts() {
    const art = document.querySelector('main > article')
    if (art) {
      const heads = [...art.querySelectorAll('h2')]
      const marks = [{ id: 'top', el: null }, ...heads.map((h) => ({ id: h.id || h.parentElement.className.split(' ')[0] || 'h2', el: h }))]
      return marks.map((m, i) => ({
        id: m.id,
        i,
        rect: () => {
          const a = art.getBoundingClientRect()
          const next = marks[i + 1]
          return { top: m.el ? m.el.getBoundingClientRect().top : a.top, bottom: next ? next.el.getBoundingClientRect().top : a.bottom }
        },
      }))
    }
    return [...document.querySelectorAll('main > section')].map((s, i) => ({ id: s.id || s.className.split(' ')[0] || `s${i}`, i, rect: () => s.getBoundingClientRect() }))
  }
  const regs = parts().map((r) => ({ ...r, t: 0, acc: 0, seen: false }))
  const secOf = (el) => {
    if (el.closest('header')) return 'header'
    if (el.closest('footer')) return 'footer'
    const b = el.getBoundingClientRect()
    const y = (b.top + b.bottom) / 2
    for (const r of regs) {
      const { top, bottom } = r.rect()
      if (y >= top && y < bottom) return r.id
    }
    return null
  }

  const loopName = (v) => (v.getAttribute('src') ?? '').split('/').pop().replace(/\.\w+$/, '') || 'video'
  const loops = [...document.querySelectorAll('video[data-loop]')].map((v) => ({ v, id: loopName(v), acc: 0, played: false, waited: false }))

  let lastAct = Date.now()
  for (const e of ['scroll', 'pointerdown', 'keydown', 'wheel', 'touchstart']) addEventListener(e, () => (lastAct = Date.now()), { passive: true, capture: true })
  let fg = 0 // seconds in front and in use since the last show
  let depth = 0 // how far down, % of the page, the most so far
  let at = null // the part most on screen

  setInterval(() => {
    if (document.visibilityState !== 'visible' || hidden) return
    if (Date.now() - lastAct > IDLE) return
    const step = TICK / 1000
    fg += step
    const vh = innerHeight
    let most = 0
    for (const r of regs) {
      const { top, bottom } = r.rect()
      const vis = Math.min(bottom, vh) - Math.max(top, 0)
      if (vis < 40 || vis < Math.min(vh * 0.5, (bottom - top) * 0.6)) continue
      r.t += step
      r.acc += step
      if (vis > most) {
        most = vis
        at = r.id
      }
      // a second on screen: seen, not flicked past
      if (!r.seen && r.t >= 1) {
        r.seen = true
        track('seen', { sec: r.id, i: r.i, t: Math.round((Date.now() - t0) / 1000) })
      }
    }
    const h = document.documentElement.scrollHeight
    if (h > 0) depth = Math.max(depth, Math.min(100, Math.round((100 * (scrollY + vh)) / h)))
    for (const l of loops) {
      const b = l.v.getBoundingClientRect()
      if (b.bottom < 0 || b.top > vh || b.width === 0) continue
      // on screen behind the play button: Low Power Mode, or reduced motion
      if (!l.waited && l.v.parentElement.classList.contains('wait')) {
        l.waited = true
        track('loop_wait', { loop: l.id, sec: secOf(l.v), reduced })
      }
      if (l.v.paused || l.v.ended || l.v.readyState < 3) continue
      l.acc += step
      if (!l.played) {
        l.played = true
        track('loop_play', { loop: l.id, sec: secOf(l.v) })
      }
    }
  }, TICK)

  // ---------------------------------------------------------------- taps

  const label = (el) =>
    (el.dataset?.track || el.getAttribute('aria-label') || el.querySelector?.('h3, b')?.textContent || el.dataset?.tip || el.textContent || el.getAttribute('title') || el.tagName.toLowerCase())
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 40)
  let dead = 0
  function onClick(e) {
    const t = e.target instanceof Element ? e.target : null
    if (!t) return
    // the loops: the whole phone is the button (site.js); this runs first, so paused is the state before the tap
    const phone = t.closest('.phone')
    const v = phone?.querySelector('video')
    if (v) return track('loop_tap', { loop: loopName(v), act: v.paused || phone.classList.contains('wait') ? 'play' : 'pause' })
    // a details' summary: the toggle below has it
    if (t.closest('summary')) return
    const a = t.closest('a[href]')
    const el = a ?? t.closest('button, [role=button], [tabindex], label, input, select, textarea')
    if (!el) {
      // a tap on something that does nothing: a photo, a list, a heading
      if (dead >= 20 || e.type !== 'click') return
      dead += 1
      const w = t.closest('img, video, svg, figure, h1, h2, h3, li, blockquote, p') ?? t
      const what = w.tagName.toLowerCase() + (w.tagName === 'IMG' ? `: ${w.alt || w.getAttribute('src')}` : w.textContent?.trim() ? `: ${w.textContent.trim()}` : '')
      return track('dead_click', { what: what.replace(/\s+/g, ' ').slice(0, 50), sec: secOf(t) })
    }
    // the request form's own steps are form_start and request
    if (!a && el.closest('form')) return
    const p = { el: label(el), sec: secOf(el), kind: a ? 'link' : el.tagName.toLowerCase() }
    if (a) {
      let u
      try {
        u = new URL(a.href, location.href)
      } catch {
        return
      }
      if (u.protocol === 'mailto:') p.to = 'mailto'
      else if (u.origin !== location.origin) p.to = u.hostname
      else if (u.pathname === '/app' || u.pathname.startsWith('/app/')) {
        p.to = '/app'
        // the app's first open says which visit sent it (app/src/analytics.ts)
        const was = a.getAttribute('href')
        u.searchParams.set('v', visitor)
        a.href = u.toString()
        setTimeout(() => a.setAttribute('href', was), 1000)
      } else p.to = u.pathname === location.pathname && u.hash ? u.hash : u.pathname + u.hash
      if (e.type === 'auxclick') p.tab = 1
    }
    track('click', p)
  }
  document.addEventListener('click', onClick, { capture: true, passive: true })
  document.addEventListener('auxclick', (e) => e.button === 1 && onClick(e), { capture: true, passive: true })

  // a "How", the table under the chart, an FAQ: opened, and how long it stayed open
  const opened = new WeakMap()
  document.addEventListener(
    'toggle',
    (e) => {
      const d = e.target
      if (!(d instanceof HTMLDetailsElement)) return
      const s = d.querySelector('summary')
      const p = { el: s ? label(s) : 'details', sec: secOf(d) }
      if (d.open) {
        opened.set(d, Date.now())
        track('dig', p)
      } else if (opened.has(d)) {
        track('dig_close', { ...p, s: Math.round((Date.now() - opened.get(d)) / 1000) })
        opened.delete(d)
      }
    },
    true,
  )

  // the request form: begun (which box first), then the page's own submit
  // reports how it went (index.html: gwTrack('request', …)). Never a value.
  const form = document.getElementById('request')
  let begun = false
  form?.addEventListener('focusin', (e) => {
    if (begun) return
    begun = true
    track('form_start', { field: e.target.name || e.target.id || e.target.tagName.toLowerCase() })
  })
  window.gwTrack = track

  // ---------------------------------------------------------------- speed and errors

  const vit = {}
  const watch = (type, fn, opts) => {
    try {
      new PerformanceObserver((l) => fn(l.getEntries())).observe({ type, buffered: true, ...opts })
    } catch {
      /* not in this browser */
    }
  }
  watch('largest-contentful-paint', (es) => es.length && (vit.lcp = Math.round(es[es.length - 1].startTime)))
  watch('paint', (es) => {
    for (const e of es) if (e.name === 'first-contentful-paint') vit.fcp = Math.round(e.startTime)
  })
  // layout shift: the worst burst (shifts under 1 s apart, a burst at most 5 s), not after a tap
  let burst = 0
  let burstStart = 0
  let burstLast = 0
  watch('layout-shift', (es) => {
    for (const e of es) {
      if (e.hadRecentInput) continue
      if (e.startTime - burstLast > 1000 || e.startTime - burstStart > 5000) {
        burst = 0
        burstStart = e.startTime
      }
      burst += e.value
      burstLast = e.startTime
      vit.cls = Math.max(vit.cls ?? 0, Math.round(burst * 1000) / 1000)
    }
  })
  // the slowest answer to a tap or a key
  watch(
    'event',
    (es) => {
      for (const e of es) if (e.interactionId) vit.inp = Math.max(vit.inp ?? 0, Math.round(e.duration))
    },
    { durationThreshold: 40 },
  )
  let vitalsSent = false
  function vitals() {
    if (vitalsSent) return
    vitalsSent = true
    try {
      const n = performance.getEntriesByType('navigation')[0]
      if (n) {
        vit.ttfb = Math.round(n.responseStart)
        vit.dom = Math.round(n.domContentLoadedEventEnd) || null
        vit.load = Math.round(n.loadEventEnd) || null
      }
    } catch {
      /* no timing */
    }
    track('vitals', vit)
  }

  let errors = 0
  addEventListener(
    'error',
    (e) => {
      const t = e.target
      // a loop or a photo that didn't load
      if (t && t !== window && t.tagName) {
        if (t.tagName === 'VIDEO' || t.tagName === 'IMG' || t.tagName === 'SOURCE')
          track('asset_error', { what: t.tagName.toLowerCase(), name: (t.getAttribute('src') ?? '').split('/').pop() })
        return
      }
      if (errors++ < 5) track('error', { msg: String(e.message ?? e.error ?? ''), at: e.filename ? `${e.filename.split('/').pop()}:${e.lineno}` : null })
    },
    true,
  )

  // ---------------------------------------------------------------- away and back

  let hidden = false
  let hiddenAt = 0
  function onHide() {
    if (hidden) return
    hidden = true
    hiddenAt = Date.now()
    for (const r of regs) {
      if (r.acc > 0) track('dwell', { sec: r.id, s: Math.round(r.acc * 10) / 10 })
      r.acc = 0
    }
    for (const l of loops) {
      if (l.acc > 0) track('watch', { loop: l.id, s: Math.round(l.acc * 10) / 10 })
      l.acc = 0
    }
    vitals()
    track('hide', { fg_s: Math.round(fg), depth, at })
    fg = 0
    flush(true)
  }
  function onShow() {
    if (!hidden) return
    hidden = false
    lastAct = Date.now()
    track('show', { gap_s: Math.round((Date.now() - hiddenAt) / 1000) })
  }
  document.addEventListener('visibilitychange', () => (document.visibilityState === 'hidden' ? onHide() : onShow()))
  addEventListener('pagehide', onHide)
  addEventListener('pageshow', (e) => e.persisted && onShow())

  landing(false)
  // a bounce still counts: the view goes soon, not only when the page is left
  setTimeout(() => flush(), 3000)
  setInterval(() => {
    if (document.visibilityState === 'visible') flush()
  }, FLUSH)
})()
