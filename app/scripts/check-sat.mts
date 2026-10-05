// node scripts/check-sat.mts — weather by satellite's text format
// (src/weather/satCodec.ts), checked without a browser: what the phone asks
// reads back from a message full of other words; a reply fits one text,
// reads back within the steps it is packed to, says so when it is cut
// short or changed, and carries the hours, the run and the camp it is for.
import { decodeSatReply, encodeSatHours, readSatRequest, satPointHash, satReply, satRequest, satSummary, type SatHours } from '../src/weather/satCodec.ts'

let bad = 0
function check(ok: boolean, what: string, got?: unknown) {
  if (!ok) bad++
  console.log(ok ? 'ok  ' : 'BAD ', what, ok || got === undefined ? '' : `=> ${JSON.stringify(got)}`)
}

const HOUR = 3_600_000
const START = Date.UTC(2026, 9, 5, 16)
const CAMP = { lat: 48.926, lon: -85.599 }
const turn = (a: number, b: number) => Math.abs(((b - a + 540) % 360) - 180)

/** A made-up 48 h: a diurnal wind, a front swinging it from SW to NW on the
 *  second afternoon, cold clear nights with an inversion, rain at the front. */
function sample(n = 48, seed = 1): SatHours {
  let s = seed
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647 - 0.5)
  const h: SatHours = { startMs: START, runMs: START - 4 * HOUR, pointHash: satPointHash(CAMP.lat, CAMP.lon), windKmh: [], windDir: [], gustKmh: [], tempC: [], t80C: [], w80Kmh: [], cloudPct: [], precipMm: [], ensDirSd: [] }
  for (let i = 0; i < n; i++) {
    const local = (i + 12) % 24
    const day = Math.max(0, Math.sin(((local - 6) / 12) * Math.PI))
    const front = 1 / (1 + Math.exp(-(i - 30) / 2))
    const w = 4 + 10 * day + 8 * front * Math.exp(-((i - 30) ** 2) / 40) + rnd() * 2
    h.windKmh.push(Math.max(0, w))
    h.windDir.push((225 + 90 * front + rnd() * 20 + 360) % 360)
    h.gustKmh.push(w * (1.4 + day * 0.8))
    const t = 3 + 9 * day - 4 * front + rnd()
    h.tempC.push(t)
    h.t80C.push(t - 0.6 + (1 - day) * 3 * (1 - front))
    h.w80Kmh.push(w * (1.3 + (1 - day) * 1.5))
    h.cloudPct.push(Math.min(100, Math.max(0, 20 + 70 * Math.exp(-((i - 30) ** 2) / 30) + rnd() * 20)))
    h.precipMm.push(Math.max(0, 1.5 * Math.exp(-((i - 31) ** 2) / 6) - 0.1))
    h.ensDirSd.push(10 + i / 3)
  }
  return h
}

console.log('---- the request')
const req = satRequest(CAMP.lat, CAMP.lon, 48)
check(req === 'GW1 48.926 -85.599 48', `as written: ${req}`, req)
for (const msg of [req, `Hi from the stand ${req} - Mat View the location or send a reply to Mat: https://inreachlink.com/3GQKX7Z`, 'gw1 48.926, -85.599', 'GW 48.926 -85.599 24']) {
  const r = readSatRequest(msg)
  check(!!r && r.lat === 48.926 && r.lon === -85.599 && (r.hours === 48 || r.hours === 24), `read from: ${msg.slice(0, 50)}`, r)
}
check(readSatRequest('weather please') === null && readSatRequest('GW1 91.0 -85.6') === null, 'not a request, or off the globe: nothing')
check(satPointHash(48.926, -85.599) === satPointHash(48.9260001, -85.5990004), 'the camp hash ignores float noise past 3 decimals')

console.log('---- a reply')
for (const seed of [1, 2, 3, 4, 5]) {
  const h = sample(48, seed)
  const text = satReply(h, -4 * 3600)
  const d = decodeSatReply(text)
  check(text.length <= 160 && /^[A-Za-z0-9 ,.\-]+$/.test(text), `fits one text in plain letters (${text.length}): ${text.slice(0, 40)}…`, text)
  if (!d.ok) {
    check(false, 'reads back', d)
    continue
  }
  const g = d.hours
  const n = g.windKmh.length
  let dirMax = 0
  let spdMax = 0
  let tMax = 0
  for (let i = 0; i < n; i++) {
    if (h.windKmh[i] >= 5) dirMax = Math.max(dirMax, turn(g.windDir[i], h.windDir[i]))
    spdMax = Math.max(spdMax, Math.abs(g.windKmh[i] - h.windKmh[i]))
    tMax = Math.max(tMax, Math.abs(g.tempC[i] - h.tempC[i]))
  }
  check(n >= 36 && g.startMs === START && g.runMs === START - 4 * HOUR && g.pointHash === h.pointHash, `seed ${seed}: ${n} h, the start, the run and the camp`, { n, start: g.startMs, run: g.runMs })
  check(dirMax <= 25 && spdMax <= 2.5 && tMax <= 1.6, `seed ${seed}: within the steps (dir ${dirMax.toFixed(1)}°, speed ${spdMax.toFixed(1)} km/h, temp ${tMax.toFixed(1)}°)`)
  check(g.precipMm.every((p) => p >= 0) && g.cloudPct.every((c) => c >= 0 && c <= 100) && g.gustKmh.every((x, i) => x >= g.windKmh[i]), `seed ${seed}: rain, cloud and gusts in range`)
}
const one = sample(48, 1)
const sum = satSummary(one, -4 * 3600)
check(/^(calm|[NESW]{1,2} \d+(g\d+)?)(, .+)?$/.test(sum), `the readable line: ${sum}`, sum)

console.log('---- edges')
const wrap = { ...sample(6, 9), windKmh: [12, 12, 12, 12, 12, 12], windDir: [350, 355, 0, 5, 10, 15] }
const wd = decodeSatReply(encodeSatHours(wrap))
check(wd.ok && wd.hours.windDir.every((d, i) => turn(d, wrap.windDir[i]) <= 6), 'a wind turning through north', wd.ok && wd.hours.windDir)
const calm = { ...sample(12, 3), windKmh: new Array(12).fill(0.2) }
const cd = decodeSatReply(encodeSatHours(calm))
check(cd.ok && cd.hours.windKmh.every((s) => s < 1.5), 'dead calm stays calm', cd.ok && cd.hours.windKmh)
const single = sample(1, 4)
const sd = decodeSatReply(encodeSatHours(single))
check(sd.ok && sd.hours.windKmh.length === 1, 'one hour', sd)
const noEns = { ...sample(24, 5), ensDirSd: new Array(24).fill(null) }
const ed = decodeSatReply(encodeSatHours(noEns))
check(ed.ok && ed.hours.ensDirSd.every((e) => e === null), 'no ensemble: the spread unknown, not made up', ed.ok && ed.hours.ensDirSd.slice(0, 3))

console.log('---- damage')
const good = satReply(sample(48, 2), -4 * 3600)
const code = good.slice(good.indexOf('GW1.'))
check(decodeSatReply(`From Groundwind:\n${good}\n- sent from a phone`).ok, 'a reply among other words reads')
check(!decodeSatReply(good.slice(0, -5)).ok && (decodeSatReply(good.slice(0, -5)) as { why: string }).why === 'cut', 'cut short: cut')
const flipped = code.slice(0, 20) + (code[20] === 'a' ? 'b' : 'a') + code.slice(21)
check(!decodeSatReply(flipped).ok, 'one letter changed: caught')
check(!decodeSatReply('hello').ok && (decodeSatReply('hello') as { why: string }).why === 'none', 'no code: none')
check((decodeSatReply(code.replace('GW1.', 'GW2.')) as { why: string }).why === 'version', 'a newer format: version')

console.log(bad ? `\n${bad} BAD` : '\nall ok')
process.exit(bad ? 1 : 0)
