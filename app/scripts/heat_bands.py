"""Where an area's heat lands: score its core in the running dev app for
each hunt target on a day, and print where the top tenth of the cells sits
against the area's treeline and by cover, with the top cell's reasons and
the verdict's season lines. The check for a new area's profile
(docs/PLACE-RULES.md): moose's top cells should sit mostly in the treeline
band (250 m below to 50 m above it) wherever there is a treeline.

    python scripts/heat_bands.py <area> [YYYY-MM-DD] [--port 5176]

Needs the dev server (npm run dev:phone) and Playwright (python).
"""
import sys
import time

from playwright.sync_api import sync_playwright

JS = r"""
async ({ when }) => {
  const hg = await import('/src/spots/habitatGrid.ts')
  const hr = await import('/src/spots/huntRules.ts')
  const pr = await import('/src/spots/profile.ts')
  const pl = await import('/src/spots/placeRules.ts')
  const wt = await import('/src/spots/weights.ts')
  const cfg = await import('/src/config.ts')
  const h = await hg.loadHabitat()
  if (!h) return { error: 'no habitat grid' }
  const b = hr.huntBands(h)
  const r0 = Math.max(0, Math.floor((h.north - cfg.CORE.north) / h.dLat)), r1 = Math.min(h.rows, Math.ceil((h.north - cfg.CORE.south) / h.dLat))
  const c0 = Math.max(0, Math.floor((cfg.CORE.west - h.west) / h.dLon)), c1 = Math.min(h.cols, Math.ceil((cfg.CORE.east - h.west) / h.dLon))
  const d = new Date(when)
  const doy = Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 1)) / 86400000) + 1
  // a still, cool first-light hour: the place decides, not the weather
  const c = { lon: cfg.HOME.center[0], lat: cfg.HOME.center[1], timeMs: d.getTime(), dayOfYear: doy, month: d.getMonth() + 1, windKmh: 8, gustKmh: 15, windDir: 225, windPersistH: 6, windShiftDeg: 10, tempC: 2, snowDepthCm: 0, cloudPct: 50, precipMmH: 0, weatherCode: 2, pressureTrend6h: 0, tempDrop24h: 0, sunriseMs: null, sunsetMs: null, sinceSunriseH: 1, toSunsetH: 8, isDay: true, moonIllum: 0.5, waterTempC: 6, waterTempNote: '', hrdps: true, warmRun: 0, dayHigh: 6, prevHigh: 6 }
  const w = { ...wt.DEFAULT_WEIGHTS, access: 0, log: 0 }
  const bands = [[-1e9, -500, 'T-500 and below'], [-500, -250, 'T-500..-250'], [-250, 50, 'T-250..+50'], [50, 150, 'T+50..+150'], [150, 1e9, 'T+150 and up']]
  const out = { treeline: pr.PROFILE.treeline, north: pr.PROFILE.north, results: [] }
  for (const t of ['moose', 'bear', 'grouse', 'deer']) {
    if (!pr.targetStanding(t).show) { out.results.push({ t, hidden: true }); continue }
    const ctx = pl.huntCtx(t, c)
    const sc = []
    for (let r = r0; r < r1; r += 2) for (let cc = c0; cc < c1; cc += 2) {
      const i = r * h.cols + cc
      const hs = hr.habitatScore(t, b, i, ctx, w)
      if (hs > 0) sc.push([i, hs * hr.siteFactor(t, b, h, i, c, undefined, w)])
    }
    sc.sort((a, z) => z[1] - a[1])
    const top = sc.slice(0, Math.max(1, Math.round(sc.length / 10)))
    const tally = (f) => { const o = {}; for (const [i] of top) { const k = f(i); o[k] = (o[k] || 0) + 1 } return Object.fromEntries(Object.entries(o).sort((a, z) => z[1] - a[1]).map(([k, v]) => [k, Math.round((100 * v) / top.length)])) }
    out.results.push({
      t, members: ctx.members,
      band: b.dz ? tally((i) => bands.find(([lo, hi]) => b.dz[i] >= lo && b.dz[i] < hi)[2]) : null,
      cover: tally((i) => h.coverNames[b.cover[i]]),
      best: hr.describeCell(t, b, h, top[0][0], c),
      verdict: hr.activityVerdict(t, c, wt.DEFAULT_WEIGHTS),
    })
  }
  return out
}
"""

if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    port = sys.argv[sys.argv.index('--port') + 1] if '--port' in sys.argv else '5176'
    if not args:
        sys.exit(__doc__)
    area = args[0]
    when = (args[1] if len(args) > 1 else time.strftime('%Y-%m-%d')) + 'T08:00:00'
    with sync_playwright() as p:
        br = p.chromium.launch(headless=True)
        page = br.new_page()
        page.goto(f'http://localhost:{port}/?area={area}', wait_until='load', timeout=90000)
        time.sleep(6)
        res = page.evaluate(JS, {'when': when})
        br.close()
    if 'error' in res:
        sys.exit(res['error'])
    tl = res['treeline']
    print(f"{area} on {when[:10]}: {'treeline ' + str(tl['m']) + ' m' if tl else 'no treeline'}; {'the north' if res['north'] else 'boreal'} calendars")
    for r in res['results']:
        if r.get('hidden'):
            print(f"  {r['t']}: not here, or no season (hidden)")
            continue
        print(f"  {r['t']} ({', '.join(r['members'])}): {r['verdict']['headline']}")
        if r['band']:
            print(f"    top tenth by height: {r['band']}")
        print(f"    top tenth by cover:  {r['cover']}")
        print(f"    top cell: {'; '.join(r['best'][:8])}")
        for line in r['verdict']['warnings']:
            print(f"    WARNING {line}")
    moose = next((r for r in res['results'] if r['t'] == 'moose' and r.get('band')), None)
    if moose:
        share = moose['band'].get('T-250..+50', 0)
        print(f"moose in the treeline band: {share}% of the top tenth ({'ok' if share >= 50 else 'LOW: look at the profile and the rules'})")
