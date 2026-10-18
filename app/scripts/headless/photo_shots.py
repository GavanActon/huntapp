"""Clearwater photo view, clean: every switch off but the photo, no heat; shots at the two points."""
import sys, time, json
from playwright.sync_api import sync_playwright
mode = sys.argv[1]
shots = [("west", 52.278114, -115.250061, 15.5), ("east", 52.2559605, -114.9684001, 16)]
with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'])
    page = b.new_context(viewport={'width': 430, 'height': 860}, device_scale_factor=2, is_mobile=True, has_touch=True).new_page()
    page.goto(f"http://localhost:5177/?area=clearwater&pictures={mode}", wait_until='load', timeout=90000)
    for _ in range(40):
        time.sleep(1)
        if page.evaluate("!!window.__map"): break
    time.sleep(5)
    page.evaluate("""async () => {
      const a = await import('/src/state/appStore.ts'); const L = {...a.useAppStore.getState().layers};
      for (const k of Object.keys(L)) L[k] = false; L.satellite = true; a.useAppStore.setState({ layers: L });
      try { const s = await import('/src/state/spotsStore.ts'); s.useSpotsStore.setState({ heat: false }); } catch (e) {}
    }""")
    for name, lat, lon, z in shots:
        page.evaluate(f"window.__map.jumpTo({{center:[{lon},{lat}], zoom:{z}}})")
        for _ in range(45):
            time.sleep(1); page.evaluate('1')
            if _ > 8 and page.evaluate("window.__map.areTilesLoaded() && window.__map.loaded()"): break
        time.sleep(2)
        info = page.evaluate("""() => { const res = performance.getEntriesByType('resource').map(r => r.name);
          return {esri: res.filter(n => n.includes('arcgisonline')).length, sharpProto: res.filter(n => /sharp\//.test(n)).length,
                  vis: window.__map.getStyle().layers.filter(l => /satellite/.test(l.id)).map(l => l.id + ':' + ((l.layout||{}).visibility||'?'))}; }""")
        print(name, json.dumps(info))
        page.screenshot(path=f"{sys.argv[2]}/cw-{mode}-{name}.png")
    b.close()
