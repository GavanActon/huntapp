// node scripts/check-links.mts — the app's own links, checked without a browser:
// share/link.ts (read and write, odd names, lengths, the message), areas/start.ts
// (which area a start opens on, the address, the arrival) and map/coords.ts
// (what a link or a message sends reads back as the same point; whole
// messages pasted into Go to coordinates; never a different point than the
// parser before parsePlace gave).
import { decideStart, linkMark, type StartIn } from '../src/areas/start.ts'
import { isLink, parseCoords, parsePlace, placeWords, type PlaceForm } from '../src/map/coords.ts'
import { areaLink, areaMessage, coordWords, mapsLink, readLink, spotLink, spotMessage } from '../src/share/link.ts'

const APP = 'https://gavanacton.github.io/huntapp/'
const B = { lat: 49.40955, lon: -69.55349 } // Lac Bailey's shared spot
const CAMP = { lat: 48.9262, lon: -85.59872 } // Pickle Lake's camp
const NOWHERE = { lat: 49.6, lon: -70.2 }
const near = (a: { lat: number; lon: number } | null | undefined, b: { lat: number; lon: number }, tol = 1e-5) =>
  !!a && Math.abs(a.lat - b.lat) <= tol && Math.abs(a.lon - b.lon) <= tol

let bad = 0
function check(ok: boolean, what: string, got?: unknown) {
  if (!ok) bad++
  console.log(ok ? 'ok  ' : 'BAD ', what, ok || got === undefined ? '' : `=> ${JSON.stringify(got)}`)
}

// ---- share/link.ts: a spot's link reads back as itself, odd names and all
console.log('---- links')
const names = ["Mat's stand", 'Stand 2 (east) & ridge', 'Lac Laïc pointe', '🦌 bull spot', 'a'.repeat(60), '  spaced\tname  ', 'x'.repeat(39) + '🦌']
for (const n of names) {
  const href = spotLink(APP, { ...B, area: 'lac-bailey', name: n })
  const r = readLink(href)
  const want = n.replace(/\s+/g, ' ').trim().slice(0, 40).replace(/[\ud800-\udbff]$/, '')
  check(near(r.at, B) && r.area === 'lac-bailey' && r.pin === want && href.length >= 91 && href.length <= 130, `${href.length} ${href}`, r)
}
const mat = spotLink(APP, { ...B, area: 'lac-bailey', name: "Mat's stand" })
check(mat === APP + '?area=lac-bailey#at=49.40955,-69.55349&pin=Mat%27s+stand', 'the design\'s example link, exactly', mat)
check(spotLink(APP, { ...NOWHERE }) === APP + '#at=49.60000,-70.20000', 'a point in no area: no area, no name', spotLink(APP, { ...NOWHERE }))
check(spotLink(APP, { ...B, area: 'lac-bailey', name: '   ' }) === APP + '?area=lac-bailey#at=49.40955,-69.55349', 'a blank name is left out')
const al = areaLink(APP, 'lac-bailey')
check(al === APP + '?area=lac-bailey' && readLink(al).area === 'lac-bailey' && !readLink(al).at, `area link ${al}`)
check(readLink(APP + '?start=lac-bailey').start === 'lac-bailey' && !readLink(APP + '?start=lac-bailey').area, 'the seed reads as start, not area')
const hand = readLink(APP + '?area=lac-bailey&at=49.40955,-69.55349&z=16&pin=Hand+made')
check(near(hand.at, B) && hand.z === 16 && hand.pin === 'Hand made', 'a spot written in the query by hand', hand)
const wild = readLink(APP + '?area=../../x#at=91,0&pin=x')
check(!wild.area && !wild.at && !wild.pin, 'a bad id and a point off the globe are left out', wild)
check(readLink(APP + '#at=49.40955,-69.55349&z=3').z === undefined, 'a zoom out of range is left out')
check(JSON.stringify(readLink('not a link')) === '{}', 'not a link: nothing')
const m = spotMessage({ ...B, name: "Mat's stand", areaName: 'Lac Bailey' })
check(m.title === "Mat's stand" && m.text === "Mat's stand · Lac Bailey\n49.40955, -69.55349\nhttps://maps.google.com/?q=49.40955,-69.55349\n", 'the spot message', m)
const un = spotMessage({ ...NOWHERE })
check(un.title === 'Spot' && un.text.startsWith('Spot\n49.60000, -70.20000\n'), 'an unnamed spot in no area', un)
const am = areaMessage('Lac Bailey')
check(am.title === 'Lac Bailey' && am.text === 'Lac Bailey on the hunt map\n', 'the area message', am)

// ---- map/coords.ts: what a share sends reads back as the same point in Go to coordinates
console.log('---- coords round trips')
for (const p of [B, CAMP, NOWHERE, { lat: -33.8688, lon: 151.2093 }]) {
  const msg = spotMessage({ ...p, name: 'Stand' })
  const lines = msg.text.trim().split('\n')
  check(near(parseCoords(coordWords(p)), p), `coordinates line ${coordWords(p)}`, parseCoords(coordWords(p)))
  check(near(parseCoords(mapsLink(p)), p), `Maps link ${mapsLink(p)}`, parseCoords(mapsLink(p)))
  check(near(parseCoords(lines[1]), p) && near(parseCoords(lines[2]), p), 'the message\'s coordinate and Maps lines')
  for (const area of [null, 'lac-bailey']) {
    const link = spotLink(APP, { ...p, area, name: "Mat's stand" })
    check(near(parseCoords(link), p), `app link ${link}`, parseCoords(link))
  }
}
check(parseCoords(areaLink(APP, 'lac-bailey')) === null, 'an area link has no point in it')
for (const p of [B, CAMP, NOWHERE]) {
  // the whole message as Android joins it (text + ' ' + url), and as the clipboard gets it (text + url)
  const msg = spotMessage({ ...p, name: "Mat's stand", areaName: 'Lac Bailey' })
  const url = spotLink(APP, { ...p, area: p === B ? 'lac-bailey' : null, name: "Mat's stand" })
  for (const whole of [msg.text + ' ' + url, msg.text + url]) {
    const got = parsePlace(whole)
    check(!!got && got.lon != null && got.complete && near(got, p) && got.name === "Mat's stand", `the whole share, pasted: ${JSON.stringify(whole).slice(0, 60)}…`, got)
    // Go to coordinates' box is one line: the lines side by side read the same
    const flat = parsePlace(whole.replace(/\s*[\r\n]+\s*/g, ' '))
    check(JSON.stringify(flat) === JSON.stringify(got), 'the same message on one line reads the same', flat)
  }
}

// ---- map/coords.ts parsePlace: what a paste or a typed line holds
console.log('---- parsePlace')
type Want = 'B' | null | 'area' | 'rough' | { lat: number; lon: number }
const cases: [string, Want, string?][] = [
  // read before parsePlace, and still
  ['N 49.409550° W 69.553490°', 'B'],
  ['N 49.409550 W 69.553490', 'B'],
  ['49.40955, -69.55349', 'B'],
  ['49.40955 -69.55349', 'B'],
  ['Lat 49.409550 Lon -69.553490', 'B'],
  ['Mat: at the stand N 49.409550° W 69.553490° see you at 6', 'B'],
  ['N 49.409550 W 69.553490 https://inreachlink.com/3GQKX7Z', 'B'],
  ['N49 24.573 W69 33.209', 'B'],
  ['49,40955 -69,55349', 'B'],
  ['https://maps.apple.com/?ll=49.40955,-69.55349&q=Pin', 'B'],
  ["https://www.google.com/maps/place/49%C2%B024'34.4%22N+69%C2%B033'12.6%22W/@49.40955,-69.55349,17z", 'B'],
  ['https://gavanacton.github.io/huntapp/?q=49.40955,-69.55349', 'B'],
  ['Lac Bailey · Shared spot · 49.40955, -69.55349', 'B'],
  ['Stand 2: N 49.40955 W 69.55349', 'B'],
  ['Meet at the stand at 5:30 N 49.40955 W 69.55349', 'B'],
  ['East ridge 49.40955, -69.55349', 'B'],
  ['18T 0532000 5473000', null],
  ['4', null],
  ['49.4', null],
  // read only now
  ["Mat's stand N 49.40955 W 69.55349", 'B'],
  ['Mat’s stand N 49.40955 W 69.55349', 'B'],
  ["Mat's stand: 49.40955, -69.55349", 'B'],
  ['Stand 2: 49.40955, -69.55349', 'B'],
  ['Lac Bailey, Zone 18: 49.40955, -69.55349', 'B'],
  ['49.40955,-69.55349 ±5 m', 'B'],
  ['Lat 49.409550 Lon -69.553490 https://inreachlink.com/3GQKX7Z', 'B'],
  ['Hi from the stand - Mat View the location or send a reply to Mat: https://inreachlink.com/3GQKX7Z', null],
  ['Shared spot 49.40955, -69.55349 https://gavanacton.github.io/huntapp/?ll=49.40955,-69.55349', 'B'],
  ['49.40955, -69.55349 https://gavanacton.github.io/huntapp/?ll=49.40955,-69.55349', 'B'],
  ['Shared spot\n49.40955, -69.55349\nhttps://gavanacton.github.io/huntapp/?ll=49.40955,-69.55349', 'B'],
  ['https://gavanacton.github.io/huntapp/#ll=49.40955,-69.55349', 'B'],
  ['https://gavanacton.github.io/huntapp/?area=lac-bailey', 'area'],
  ['Lac Bailey on the hunt map\nhttps://gavanacton.github.io/huntapp/?area=lac-bailey', 'area'],
  ['https://gavanacton.github.io/huntapp/?area=lac-bailey#at=49.40955,-69.55349&pin=Mat%27s+stand', 'B', "Mat's stand"],
  ['http://192.168.1.20:5176/?area=lac-bailey#at=49.40955,-69.55349&pin=Mat%27s+stand', 'B', "Mat's stand"],
  ["Mat's stand · Lac Bailey\n49.40955, -69.55349\nhttps://maps.google.com/?q=49.40955,-69.55349\n https://gavanacton.github.io/huntapp/?area=lac-bailey#at=49.40955,-69.55349&pin=Mat%27s+stand", 'B', "Mat's stand"],
  ['See https://maps.apple.com/?ll=49.40955,-69.55349.', 'B'],
  ['(https://gavanacton.github.io/huntapp/?area=lac-bailey#at=49.40955,-69.55349&pin=Mat%27s+stand)', 'B', "Mat's stand"],
  ['12:30 49.40955, -69.55349', 'B'],
  // typed, still coming: read, but not complete
  ['49.40955, -69', 'rough'],
  ['49.40955, -69.5', 'rough'],
  ['49.40955, -69.553', { lat: 49.40955, lon: -69.553 }],
  ['N 49 24 W 69 33', 'rough'],
  ['N 49 24.5 W 69 33.2', { lat: 49 + 24.5 / 60, lon: -(69 + 33.2 / 60) }],
  ['N 49.4 W 69.55349', 'rough'],
  // kept as nothing
  ['Spot E 49.40955, -69.55349', null],
  ['https://maps.app.goo.gl/abc123', null],
  ['hello', null],
  ['', null],
]
for (const [text, want, name] of cases) {
  const got = parsePlace(text)
  const pt = got && got.lon != null ? got : null
  let ok: boolean
  if (want === null) ok = got === null
  else if (want === 'area') ok = !!got && got.lon == null && got.area === 'lac-bailey'
  else if (want === 'rough') ok = !!pt && !pt.complete
  else if (want === 'B') ok = !!pt && pt.complete && near(pt, B, 2e-5) && (name == null || pt.name === name)
  else ok = !!pt && pt.complete && near(pt, want, 2e-5)
  check(ok, `${JSON.stringify(text).slice(0, 86)} → ${want === null ? 'nothing' : typeof want === 'string' ? want : 'the point'}`, got)
}
check(isLink('see https://inreachlink.com/3GQKX7Z') && !isLink('N 49.40955 W 69.55349') && isLink('maps.google.com/?q=x'), 'isLink: a link anywhere in it')
check(isLink('a https://x.y/') === isLink('a https://x.y/'), 'isLink asked twice answers the same (no regex state left over)')
check(parsePlace("https://gavanacton.github.io/huntapp/?area=lac-bailey#at=49.40955,-69.55349&pin=" + encodeURIComponent('x'.repeat(60)))?.name === 'x'.repeat(40), 'a long name from a link: the pin field\'s 40')
check(parsePlace('https://example.com/?area=Not%20an%20id') === null, 'a link whose area is no id: nothing')

// ---- the read-out: said back in the form it was written, and read back as the same point
console.log('---- read-out forms')
const forms: [string, PlaceForm, string][] = [
  ['49.40955, -69.55349', 'dec', '49.40955, -69.55349'],
  ['N 49.409550° W 69.553490°', 'nw', 'N 49.40955° W 69.55349°'],
  ['49.40955 N 69.55349 W', 'nw', 'N 49.40955° W 69.55349°'],
  ['N49 24.573 W69 33.209', 'dm', "N 49° 24.573' W 69° 33.209'"],
  [`49°24'34.4"N 69°33'12.6"W`, 'dms', `N 49° 24' 34.4" W 69° 33' 12.6"`],
  ['S 33.8688 E 151.2093', 'nw', 'S 33.86880° E 151.20930°'],
  ['https://maps.google.com/?q=49.40955,-69.55349', 'dec', '49.40955, -69.55349'],
]
for (const [text, form, said] of forms) {
  const got = parsePlace(text)
  const pt = got && got.lon != null ? got : null
  const words = pt ? placeWords(pt, pt.form) : ''
  const back = parsePlace(words)
  check(!!pt && pt.form === form && words === said && !!back && back.lon != null && near(back, pt, 1e-4), `${text} → ${form} → ${said}`, { got, words })
}
// minutes and seconds that round up carry into the next minute or degree
check(placeWords({ lat: 48.9999999, lon: -85.99999999 }, 'dm') === "N 49° 0.000' W 86° 0.000'", 'minutes rounding to 60 carry', placeWords({ lat: 48.9999999, lon: -85.99999999 }, 'dm'))
check(placeWords({ lat: 48.99999999, lon: -85.5 }, 'dms') === `N 49° 0' 0.0" W 85° 30' 0.0"`, 'seconds rounding to 60 carry', placeWords({ lat: 48.99999999, lon: -85.5 }, 'dms'))

// ---- parsePlace against the parser before it, on more formats: the same point, or one read where none was
console.log('---- old against new')
const was: [string, [number, number] | null][] = [
  [`49°24'34.4"N 69°33'12.6"W`, [49.409555555555556, -69.5535]],
  [`49°24'34.4"N 69°33'12.6"O`, [49.409555555555556, -69.5535]],
  ['49 24 34.4 N 69 33 12.6 W', [49.409555555555556, -69.5535]],
  [`N49°24.573' W69°33.209'`, [49.40955, -69.55348333333333]],
  [`49°24.573'N 69°33.209'W`, [49.40955, -69.55348333333333]],
  ['S 33.8688 E 151.2093', [-33.8688, 151.2093]],
  ['-33.8688, 151.2093', [-33.8688, 151.2093]],
  ['-69.55349, 49.40955', [-69.55349, 49.40955]],
  ['[-69.55349, 49.40955]', [-69.55349, 49.40955]],
  ['49.40955;-69.55349', [49.40955, -69.55349]],
  ['49.40955/-69.55349', [49.40955, -69.55349]],
  ['lat: 49.40955, lng: -69.55349', [49.40955, -69.55349]],
  ['Latitude 49.40955 Longitude -69.55349', [49.40955, -69.55349]],
  ['49.40955°, -69.55349°', [49.40955, -69.55349]],
  ['49.40955 N 69.55349 W', [49.40955, -69.55349]],
  ['N 49° 24.573 W 69° 33.209', [49.40955, -69.55348333333333]],
  ['+49.40955 -069.55349', [49.40955, -69.55349]],
  ['48.9262, -85.59872', [48.9262, -85.59872]],
  ['N 48 55.572 W 85 35.923', [48.9262, -85.59871666666666]],
  ['12:30 at 49.40955, -69.55349', null],
  ['geo:49.40955,-69.55349?z=15', [49.40955, -69.55349]],
  ['https://www.openstreetmap.org/?mlat=49.40955&mlon=-69.55349#map=15/49.40955/-69.55349', [49.40955, -69.55349]],
  ['https://www.google.com/maps/search/?api=1&query=49.40955%2C-69.55349', [49.40955, -69.55349]],
  ['https://www.google.com/maps/@49.40955,-69.55349,15z', [49.40955, -69.55349]],
  ['https://maps.google.com/?q=49.40955,-69.55349', [49.40955, -69.55349]],
  ['maps.google.com/?q=49.40955,-69.55349', [49.40955, -69.55349]],
  ['49.40955 , -69.55349 (±3 m, 12:41)', null],
  ['Alt 312 m Lat 49.40955 Lon -69.55349', null],
  ['My location: 49.40955, -69.55349 — sent via satellite', [49.40955, -69.55349]],
  ['12:30 49.40955, -69.55349', null],
  ['49.40955, -69.55349, 5', null],
]
for (const [text, old] of was) {
  const got = parseCoords(text)
  const same = old ? !!got && Math.abs(got.lat - old[0]) < 1e-9 && Math.abs(got.lon - old[1]) < 1e-9 : true
  check(same, `${old ? 'same ' : 'newly'} ${JSON.stringify(text).slice(0, 80)}${old || !got ? '' : ` → ${coordWords(got)}`}`, got)
}

// ---- areas/start.ts: which area opens, what the address becomes, the arrival
console.log('---- startup')
const areas = [
  { id: 'lac-bailey', region: { west: -69.693, south: 49.329, east: -69.414, north: 49.49 } },
  { id: 'pickle-lake', region: { west: -85.72, south: 48.86, east: -85.46, north: 49.0 } },
]
const base: Omit<StartIn, 'href'> = { saved: null, areas, defaultId: 'pickle-lake', done: null, sessionOk: true, navType: 'navigate' }
const LB = '#at=49.40955,-69.55349&pin=Mat%27s+stand'
type Out = ReturnType<typeof decideStart>
const rows: [string, Partial<StartIn> & { href: string }, (o: Out) => boolean][] = [
  ['fresh phone, bare address: Pickle, nothing written, address untouched', { href: APP }, (o) => o.areaId === 'pickle-lake' && !o.save && o.href === null && !o.arrival && !o.mark],
  ['Pickle phone (saved), bare: unchanged', { href: APP, saved: 'pickle-lake' }, (o) => o.areaId === 'pickle-lake' && !o.save && o.href === null && !o.arrival && !o.mark],
  ['Pickle phone reloaded: unchanged', { href: APP, saved: 'pickle-lake', navType: 'reload' }, (o) => o.areaId === 'pickle-lake' && !o.save && o.href === null && !o.arrival],
  ['area link, fresh: Lac Bailey, saved, address keeps ?area', { href: APP + '?area=lac-bailey' }, (o) => o.areaId === 'lac-bailey' && o.save && o.href === null && !o.arrival],
  ['area link, Pickle saved: Lac Bailey (the link is the choice, no prompt)', { href: APP + '?area=lac-bailey', saved: 'pickle-lake' }, (o) => o.areaId === 'lac-bailey' && o.save],
  ['area address reloaded (a download, an update): still Lac Bailey', { href: APP + '?area=lac-bailey', saved: 'lac-bailey', navType: 'reload' }, (o) => o.areaId === 'lac-bailey' && o.href === null],
  ['a tab left on an area link, reloaded after a switch to Pickle: the tab stays on Lac Bailey, nothing saved', { href: APP + '?area=lac-bailey', saved: 'pickle-lake', navType: 'reload' }, (o) => o.areaId === 'lac-bailey' && !o.save],
  ['the same, restored by a back: nothing saved', { href: APP + '?area=lac-bailey', saved: 'pickle-lake', navType: 'back_forward' }, (o) => o.areaId === 'lac-bailey' && !o.save],
  ['a tab left on a spot link, reloaded after a switch to Pickle: nothing saved, no arrival', { href: APP + '?area=lac-bailey' + LB, saved: 'pickle-lake', done: linkMark(B, "Mat's stand"), navType: 'reload' }, (o) => o.areaId === 'lac-bailey' && !o.save && !o.arrival],
  ['Lac Bailey saved, bare address (an old icon, a typed address): Lac Bailey, the address gains ?area', { href: APP, saved: 'lac-bailey' }, (o) => o.areaId === 'lac-bailey' && !o.save && o.href === APP + '?area=lac-bailey'],
  ['spot link: Lac Bailey, the arrival with its name, address untouched', { href: APP + '?area=lac-bailey' + LB }, (o) => o.areaId === 'lac-bailey' && o.save && !!o.arrival && o.arrival.inArea && o.arrival.name === "Mat's stand" && o.arrival.z === 15 && near(o.arrival, B) && o.href === null && o.mark === "49.40955,-69.55349|Mat's stand"],
  ['the same spot link reloaded in the tab: no second arrival', { href: APP + '?area=lac-bailey' + LB, done: "49.40955,-69.55349|Mat's stand", navType: 'reload' }, (o) => o.areaId === 'lac-bailey' && !o.arrival && !o.mark],
  ['the same spot link opened again in the tab (not a reload): no second arrival', { href: APP + '?area=lac-bailey' + LB, done: linkMark(B, "Mat's stand") }, (o) => !o.arrival],
  ['reload with no mark (sessionStorage blocked): no arrival', { href: APP + '?area=lac-bailey' + LB, navType: 'reload', sessionOk: false }, (o) => !o.arrival],
  ['back with sessionStorage blocked: no arrival', { href: APP + '?area=lac-bailey' + LB, navType: 'back_forward', sessionOk: false }, (o) => !o.arrival],
  ['first open with sessionStorage blocked: it arrives', { href: APP + '?area=lac-bailey' + LB, sessionOk: false }, (o) => !!o.arrival && o.arrival.name === "Mat's stand"],
  ['back to a spot link this tab showed: no arrival', { href: APP + '?area=lac-bailey' + LB, done: linkMark(B, "Mat's stand"), navType: 'back_forward' }, (o) => !o.arrival],
  ['a reload of a link this tab never showed (its first load never ran this build): it arrives, the area not saved again', { href: APP + '?area=lac-bailey' + LB, navType: 'reload' }, (o) => o.areaId === 'lac-bailey' && !o.save && !!o.arrival && o.arrival.inArea && o.arrival.name === "Mat's stand" && o.mark === "49.40955,-69.55349|Mat's stand"],
  ['the update reload after an old build opened the link (it saved the area and took ?area off): it arrives, the address gains ?area', { href: APP + LB, saved: 'lac-bailey', navType: 'reload' }, (o) => o.areaId === 'lac-bailey' && !o.save && !!o.arrival && o.href === APP + '?area=lac-bailey' + LB],
  ['a reload of another link than the one shown: it arrives', { href: APP + '?area=lac-bailey#at=49.41000,-69.56000', done: linkMark(B, "Mat's stand"), navType: 'reload' }, (o) => !!o.arrival],
  ['another spot in the same tab: it arrives', { href: APP + '?area=lac-bailey#at=49.41000,-69.56000', done: linkMark(B, "Mat's stand") }, (o) => !!o.arrival && o.arrival.inArea && !o.arrival.name],
  ['spot link with no area word: the point decides, the address gains it', { href: APP + '#at=49.40955,-69.55349' }, (o) => o.areaId === 'lac-bailey' && o.save && o.href === APP + '?area=lac-bailey#at=49.40955,-69.55349'],
  ['spot link naming the wrong area: the point decides, the address follows', { href: APP + '?area=lac-bailey#at=48.92620,-85.59872' }, (o) => o.areaId === 'pickle-lake' && o.href === APP + '#at=48.92620,-85.59872'],
  ['Pickle spot, Lac Bailey saved: Pickle, saved', { href: APP + '?area=pickle-lake#at=48.92620,-85.59872&pin=Camp', saved: 'lac-bailey' }, (o) => o.areaId === 'pickle-lake' && o.save && o.href === null && !!o.arrival],
  ['spot in no area, area word known: that area, the arrival not in an area', { href: APP + '?area=lac-bailey#at=49.60000,-70.20000' }, (o) => o.areaId === 'lac-bailey' && o.save && !!o.arrival && !o.arrival.inArea],
  ['spot in no area, no area word, Pickle saved: stays Pickle, nothing saved', { href: APP + '#at=49.60000,-70.20000', saved: 'pickle-lake' }, (o) => o.areaId === 'pickle-lake' && !o.save && !!o.arrival && !o.arrival.inArea && o.href === null],
  ['unknown area: the saved one, the word goes', { href: APP + '?area=nowhere', saved: 'pickle-lake' }, (o) => o.areaId === 'pickle-lake' && !o.save && o.href === APP],
  ['unknown area, nothing saved: Pickle, the word goes', { href: APP + '?area=nowhere' }, (o) => o.areaId === 'pickle-lake' && !o.save && o.href === APP],
  ['start seed, fresh install: Lac Bailey, saved, start becomes area', { href: APP + '?start=lac-bailey' }, (o) => o.areaId === 'lac-bailey' && o.save && o.href === APP + '?area=lac-bailey'],
  ['start seed, something saved: the saved one wins, the seed goes', { href: APP + '?start=lac-bailey', saved: 'pickle-lake' }, (o) => o.areaId === 'pickle-lake' && !o.save && o.href === APP],
  ['start seed with storage blocked (nothing reads as saved): the seed', { href: APP + '?start=lac-bailey', saved: null }, (o) => o.areaId === 'lac-bailey'],
  ['hand-made query spot: read, left where it came', { href: APP + '?at=49.40955,-69.55349&pin=x' }, (o) => o.areaId === 'lac-bailey' && !!o.arrival && o.href === APP + '?at=49.40955,-69.55349&pin=x&area=lac-bailey'],
  ['explicit ?area=pickle-lake stays', { href: APP + '?area=pickle-lake', saved: 'lac-bailey' }, (o) => o.areaId === 'pickle-lake' && o.save && o.href === null],
  ['zoom from the link', { href: APP + '?area=lac-bailey#at=49.40955,-69.55349&z=17' }, (o) => o.arrival?.z === 17],
  ['no areas known at all: the default id, for the caller to refuse', { href: APP, areas: [] }, (o) => o.areaId === 'pickle-lake'],
]
for (const [what, inp, ok] of rows) {
  const o = decideStart({ ...base, ...inp })
  check(ok(o), what, o)
}

console.log('----', bad ? `${bad} BAD` : 'all ok')
process.exitCode = bad ? 1 : 0
