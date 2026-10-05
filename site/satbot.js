// Weather by satellite, the server's side (docs/SAT-FORECAST.md): a text
// from an inReach or an iPhone on satellite asks for a camp's forecast with
// the line the app wrote ("GW1 48.926 -85.599 48"), and the answer is the
// newest HRDPS hours there, packed into one text by the app's own codec.
//
//   POST /api/sms   Twilio's webhook for the Groundwind number: the answer
//                   goes back as TwiML. Signed requests only (the auth token
//                   is the TWILIO_AUTH_TOKEN secret).
//   GET  /api/wx?q= the same answer as plain text, for trying a request
//                   with signal and for the site.

import { readSatRequest, satPointHash, satReply } from '../app/src/weather/satCodec.ts'

const HOUR = 3600_000
const HOURLY = ['wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m', 'temperature_2m', 'temperature_80m', 'wind_speed_80m', 'cloud_cover', 'precipitation']
const HELP = 'Groundwind: send GW1 then the camp and the hours, e.g. GW1 48.926 -85.599 48. The app writes it for you under Weather by satellite.'
const FAILED = 'Groundwind: no forecast just now. Try again in a few minutes.'

async function getJson(url, ms = 8000) {
  const r = await fetch(url, { signal: AbortSignal.timeout(ms) })
  if (!r.ok) throw new Error(`${new URL(url).hostname} ${r.status}`)
  return r.json()
}

/** The ensemble's direction spread by hour (unix seconds), as the app works
 *  it out (weather/boundaryLayer.ts): calm members left out. */
async function ensembleSpread(lat, lon) {
  const q = new URLSearchParams({
    latitude: lat.toFixed(3),
    longitude: lon.toFixed(3),
    hourly: 'wind_speed_10m,wind_direction_10m',
    wind_speed_unit: 'kmh',
    timeformat: 'unixtime',
    forecast_days: '3',
    models: 'gem_global_ensemble',
  })
  const j = await getJson(`https://ensemble-api.open-meteo.com/v1/ensemble?${q}`)
  const h = j.hourly
  const dirKeys = Object.keys(h).filter((k) => k.startsWith('wind_direction_10m'))
  const spdKeys = Object.keys(h).filter((k) => k.startsWith('wind_speed_10m'))
  const out = new Map()
  h.time.forEach((t, i) => {
    const pairs = dirKeys.map((k, m) => [h[k][i], h[spdKeys[m]]?.[i]]).filter(([d, s]) => d != null && s != null && s >= 3)
    if (pairs.length < 5) return
    let sn = 0
    let cs = 0
    for (const [d] of pairs) {
      sn += Math.sin((d * Math.PI) / 180)
      cs += Math.cos((d * Math.PI) / 180)
    }
    const R = Math.min(1, Math.hypot(sn, cs) / pairs.length)
    out.set(t, R <= 1e-6 ? 180 : Math.min(180, (Math.sqrt(-2 * Math.log(R)) * 180) / Math.PI))
  })
  return out
}

/** The run the HRDPS hours are from: Open-Meteo says, else the last one due
 *  to have landed (runs every 6 h, on Open-Meteo about 3 h 40 later). */
async function hrdpsRun(now) {
  try {
    const m = await getJson('https://api.open-meteo.com/data/cmc_gem_hrdps/static/meta.json', 5000)
    if (Number.isFinite(m.last_run_initialisation_time)) return m.last_run_initialisation_time * 1000
  } catch {
    /* the estimate below */
  }
  const land = (3 * 60 + 40) * 60_000
  return Math.floor((now - land) / (6 * HOUR)) * 6 * HOUR
}

/** The answer to a request: the readable line and the code, one text. */
export async function satAnswer(req, now = Date.now()) {
  const q = new URLSearchParams({
    latitude: req.lat.toFixed(3),
    longitude: req.lon.toFixed(3),
    hourly: HOURLY.join(','),
    wind_speed_unit: 'kmh',
    timezone: 'auto',
    timeformat: 'unixtime',
    forecast_days: '3',
    models: 'gem_hrdps_continental',
  })
  const [j, runMs, ens] = await Promise.all([
    getJson(`https://api.open-meteo.com/v1/forecast?${q}`),
    hrdpsRun(now),
    ensembleSpread(req.lat, req.lon).catch(() => new Map()),
  ])
  const h = j.hourly
  // from this hour, while HRDPS has the wind and the layering
  const from = Math.floor(now / HOUR) * HOUR
  const pick = []
  for (let i = 0; i < h.time.length && pick.length < req.hours; i++) {
    if (h.time[i] * 1000 < from) continue
    if (['wind_speed_10m', 'wind_direction_10m', 'temperature_2m', 'temperature_80m', 'wind_speed_80m'].some((k) => h[k][i] == null)) break
    pick.push(i)
  }
  if (!pick.length) throw new Error('no HRDPS hours')
  const col = (k, dflt) => pick.map((i) => h[k][i] ?? dflt)
  const hours = {
    startMs: h.time[pick[0]] * 1000,
    runMs,
    pointHash: satPointHash(req.lat, req.lon),
    windKmh: col('wind_speed_10m'),
    windDir: col('wind_direction_10m'),
    gustKmh: pick.map((i) => h.wind_gusts_10m[i] ?? h.wind_speed_10m[i]),
    tempC: col('temperature_2m'),
    t80C: col('temperature_80m'),
    w80Kmh: col('wind_speed_80m'),
    cloudPct: col('cloud_cover', 50),
    precipMm: col('precipitation', 0),
    ensDirSd: pick.map((i) => ens.get(h.time[i]) ?? null),
  }
  return satReply(hours, j.utc_offset_seconds ?? 0)
}

/** What a text gets back: the forecast, the help for a text that is not a
 *  request, a short sorry when the forecast cannot be had. */
export async function satText(body) {
  const req = readSatRequest(body ?? '')
  if (!req) return HELP
  try {
    return await satAnswer(req)
  } catch (e) {
    console.log('satbot', String(e))
    return FAILED
  }
}

function xml(s) {
  return s.replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c])
}

/** The address as Twilio may have signed it: with the port and without
 *  (its own libraries try both; a request reaching here has lost it). */
function signedForms(url) {
  const u = new URL(url)
  const port = u.port || (u.protocol === 'https:' ? '443' : '80')
  return [`${u.protocol}//${u.hostname}${u.pathname}${u.search}`, `${u.protocol}//${u.hostname}:${port}${u.pathname}${u.search}`]
}

/** Twilio signs each webhook: HMAC-SHA1 of the URL and the sorted fields. */
async function twilioSigned(token, url, params, sig) {
  if (!sig) return false
  const fields = [...params.keys()].sort().map((k) => k + params.get(k)).join('')
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(token), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'])
  for (const form of signedForms(url)) {
    const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(form + fields)))
    const want = btoa(String.fromCharCode(...mac))
    if (want.length !== sig.length) continue
    let diff = 0
    for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ sig.charCodeAt(i)
    if (diff === 0) return true
  }
  return false
}

export async function smsWebhook(request, env) {
  if (request.method !== 'POST') return new Response('post', { status: 405 })
  // a pasted token can carry a space or a line end
  const token = (env.TWILIO_AUTH_TOKEN ?? '').trim()
  if (!token) return new Response('not set up', { status: 503 })
  const params = new URLSearchParams(await request.text())
  if (!(await twilioSigned(token, request.url, params, request.headers.get('X-Twilio-Signature')))) {
    // what to check, without the token itself: Twilio's tokens are 32 characters
    console.log('satbot: signature mismatch', JSON.stringify({ url: request.url, tokenLength: token.length, fields: [...params.keys()].length }))
    return new Response('forbidden', { status: 403 })
  }
  const answer = await satText(params.get('Body'))
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${xml(answer)}</Message></Response>`, {
    headers: { 'Content-Type': 'text/xml; charset=utf-8' },
  })
}

export async function wxQuery(request) {
  const cors = { 'Access-Control-Allow-Origin': '*' }
  const q = new URL(request.url).searchParams.get('q') ?? ''
  return new Response(await satText(q), { headers: { ...cors, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } })
}
