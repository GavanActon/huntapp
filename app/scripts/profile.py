"""Profile the map's start-up headless: python scripts/profile.py <url> [opfs] [label]

Prints the map's milestones (created, first render, load, idle: needs the
dev server, which exposes window.__map), when each source finished
loading, a CPU profile by function, the long tasks, and the requests by
group. With `opfs` every bundle file is first downloaded into the
browser's OPFS from the server (the phone at camp), then a fresh load is
measured. STEADY_S=<seconds> keeps the profiler running that long after
the first idle, for what runs once the map is up. Chromium runs on
SwiftShader, so anything on the GPU is slow and the numbers are for
comparing runs, not for the phone; never run two at once.

The pass of 2026-10-01 took the phone case from 9.7 s to 2.7 s to 'load':
the wind streaks' canvas read-back, the spot scoring running five times
and the 5 MB forest GeoJSON were the three costs.
"""
import sys, time, json, re
from collections import defaultdict
from playwright.sync_api import sync_playwright

url = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:5190/'
opfs = len(sys.argv) > 2 and sys.argv[2] == 'opfs'
label = sys.argv[3] if len(sys.argv) > 3 else ''
WAIT_S = 40
import os
STEADY_S = float(os.environ.get('STEADY_S', '1'))  # how long after idle the profiler keeps running

INIT = r"""
window.__perf = { long: [], map: {}, t0: performance.timeOrigin };
try {
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__perf.long.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ entryTypes: ['longtask'] });
} catch {}
const poll = setInterval(() => {
  const m = window.__map;
  if (!m) return;
  clearInterval(poll);
  const P = window.__perf.map;
  P.created = Math.round(performance.now());
  const stamp = (k) => { if (P[k] == null) P[k] = Math.round(performance.now()); };
  m.once('style.load', () => stamp('styleLoad'));
  P.sources = {};
  m.on('sourcedata', (e) => { if (e.isSourceLoaded && e.sourceId && P.sources[e.sourceId] == null) P.sources[e.sourceId] = Math.round(performance.now()); });
  m.once('load', () => stamp('load'));
  m.once('idle', () => stamp('idle'));
  let renders = 0;
  m.on('render', () => { renders++; if (renders === 1) stamp('firstRender'); });
  m.on('error', (e) => { (P.errors = P.errors || []).push(String(e.error && e.error.message || e)); });
  if (m.isStyleLoaded()) stamp('styleLoad');
}, 5);
"""

def group(u, rt, headers):
    if '/data/' in u and u.endswith('.pmtiles'):
        f = re.search(r'/data/([^?]+)', u).group(1)
        return 'pmtiles ' + f.replace('-pickle-lake.pmtiles', '')
    if '/data/' in u and u.endswith('.geojson'): return 'geojson'
    if '/data/' in u and u.endswith('.hab'): return 'hab grid'
    if '/data/manifest.json' in u: return 'manifest'
    if '/fonts/' in u: return 'glyphs'
    if '/sprites/' in u: return 'sprite'
    if 'open-meteo' in u: return 'open-meteo'
    if 'localhost' in u and ('/src/' in u or '/node_modules/' in u or '/assets/' in u or '/@' in u): return 'js/css'
    if 'localhost' in u: return 'page'
    return 'external: ' + re.sub(r'^https?://([^/]+).*', r'\1', u)

reqs = []
logs = []
T0 = [time.time()]
with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    ctx = b.new_context(viewport={'width': 430, 'height': 860}, device_scale_factor=2, is_mobile=True, has_touch=True, ignore_https_errors=True)
    page = ctx.new_page()
    page.add_init_script(INIT)
    page.on('console', lambda m: logs.append(f'{(time.time()-T0[0])*1000:6.0f} [{m.type}] {m.text}'))
    page.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
    t_nav = None
    def on_finished(req):
        try:
            resp = req.response()
            sizes = req.sizes()
            t = req.timing
            reqs.append({
                'url': req.url, 'rt': req.resource_type, 'status': resp.status if resp else 0,
                'bytes': sizes.get('responseBodySize', 0), 'start': t['startTime'], 'dur': t['responseEnd'],
                'range': req.headers.get('range', ''),
            })
        except Exception as e:
            logs.append(f'[reqfail] {req.url[:80]} {e}')
    page.on('requestfinished', on_finished)
    page.on('requestfailed', lambda r: logs.append(f'[failed] {r.url[:100]} {r.failure}'))

    if opfs:
        # fill OPFS first in a throwaway load, then measure a fresh one
        page.goto(url, wait_until='load', timeout=90000)
        time.sleep(3)
        n = page.evaluate("""async () => {
          const c = await import('/src/config.ts'); const fs = await import('/src/offline/fileStore.ts');
          const files = c.BUNDLES[0].files; let n = 0;
          for (const f of files) { if (fs.manifestGet(f)) { n++; continue; } try { await fs.downloadToStore(c.DATA_BASE + f, f); n++; } catch (e) { console.log('dl fail ' + f + ' ' + e.message); } }
          return n; }""")
        print('opfs files stored:', n)
        reqs.clear(); logs.clear()

    cdp = ctx.new_cdp_session(page)
    cdp.send('Profiler.enable'); cdp.send('Profiler.setSamplingInterval', {'interval': 500}); cdp.send('Profiler.start')
    T0[0] = time.time()
    page.goto(url, wait_until='commit', timeout=90000)
    nav_t0 = page.evaluate('performance.timeOrigin')
    deadline = time.time() + WAIT_S
    while time.time() < deadline:
        mp = page.evaluate('window.__perf.map')
        if mp.get('idle'):
            break
        time.sleep(0.25)
    time.sleep(STEADY_S)
    prof = cdp.send('Profiler.stop')['profile']
    perf = page.evaluate('window.__perf')
    nav = page.evaluate("JSON.stringify(performance.getEntriesByType('navigation')[0])")
    nav = json.loads(nav)
    page.screenshot(path=label and f'profile-{label}.png' or 'profile.png')
    b.close()

ms = lambda t: f'{t:7.0f}'
print(f'\n=== {url} {"OPFS" if opfs else "network"} {label}')
print(f'DOMContentLoaded {ms(nav["domContentLoadedEventEnd"])}   load {ms(nav["loadEventEnd"])}')
mp = perf['map']
print('map:', ' '.join(f'{k}={v}' for k, v in mp.items() if k not in ('errors', 'sources')))
print('sources loaded:', ' '.join(f'{k}={v}' for k, v in sorted((mp.get('sources') or {}).items(), key=lambda kv: kv[1])))
# CPU profile: self time by function
nodes = {n['id']: n for n in prof['nodes']}
self_t = defaultdict(int)
deltas = prof['timeDeltas']; samples = prof['samples']
for i, nid in enumerate(samples):
    n = nodes[nid]; cf = n['callFrame']
    key = f"{cf['functionName'] or '(anon)'} {cf['url'].split('/')[-1].split('?')[0]}:{cf['lineNumber']+1}:{cf['columnNumber']}"
    self_t[key] += deltas[i] if i < len(deltas) else 0
tot = sum(self_t.values())/1000
print()
print("cpu profile: %.0f ms sampled; top self time:" % tot)
for k, v in sorted(self_t.items(), key=lambda kv: -kv[1])[:28]:
    print(f'  {v/1000:7.0f} ms  {k}')
if mp.get('errors'): print('map errors:', mp['errors'][:5])
long = perf['long']
print(f'long tasks: {len(long)} · {sum(d for _, d in long)} ms total · biggest {sorted(long, key=lambda x: -x[1])[:6]}')

# requests by group, relative to navigation start
by = defaultdict(lambda: {'n': 0, 'bytes': 0, 'first': 1e9, 'last': 0, 'dur': 0})
for r in reqs:
    g = group(r['url'], r['rt'], None)
    s = (r['start'] - nav_t0)
    e = s + r['dur']
    d = by[g]
    d['n'] += 1; d['bytes'] += r['bytes']; d['first'] = min(d['first'], s); d['last'] = max(d['last'], e); d['dur'] += r['dur']
print(f'\n{"group":34} {"n":>4} {"KB":>8} {"first":>7} {"last":>7} {"sum ms":>7}')
for g, d in sorted(by.items(), key=lambda kv: kv[1]['first']):
    print(f'{g:34} {d["n"]:4} {d["bytes"]/1024:8.0f} {d["first"]:7.0f} {d["last"]:7.0f} {d["dur"]:7.0f}')
print(f'total requests {len(reqs)} · {sum(r["bytes"] for r in reqs)/1024/1024:.1f} MB')

print('\nslowest 12:')
for r in sorted(reqs, key=lambda r: -r['dur'])[:12]:
    print(f'  {r["dur"]:6.0f} ms  start {r["start"]-nav_t0:6.0f}  {r["bytes"]/1024:7.0f} KB  {r["url"][-70:]} {r["range"]}')
print('\nfirst 25 in order:')
for r in sorted(reqs, key=lambda r: r['start'])[:25]:
    print(f'  start {r["start"]-nav_t0:6.0f}  {r["dur"]:6.0f} ms  {r["bytes"]/1024:7.0f} KB  {r["url"][-80:]} {r["range"]}')
print('\nlog:')
print('\n'.join(l for l in logs if 'favicon' not in l and 'Download the React DevTools' not in l)[-2500:])
