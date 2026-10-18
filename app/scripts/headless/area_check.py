import time, json
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'])
    page = b.new_context(viewport={'width': 430, 'height': 860}, is_mobile=True, has_touch=True).new_page()
    page.goto("http://localhost:5177/?area=clearwater&pictures=stream", wait_until='load', timeout=90000)
    time.sleep(10)
    print(page.evaluate("""async () => {
      const a = await import('/src/areas/index.ts'); const ck = await import('/src/areas/check.ts');
      const cw = (await import('/src/areas/clearwater.json')).default;
      const out = {ids: Object.keys(a.AREAS), bad: ck.badAreaField ? ck.badAreaField(cw) : Object.keys(ck), saved: localStorage.getItem('huntapp-area'), href: location.href};
      try { const c = await import('/src/config.ts'); out.live = c.LIVE; out.files = c.DATA_FILES.map(d=>d.key); out.areaId = c.AREA_ID ?? (c.AREA && c.AREA.id); } catch (e) { out.cfgErr = String(e); }
      try { const st = await import('/src/map/streamPictures.ts'); const ms = await import('/src/map/mapStyle.ts'); out.stream = st.STREAM_PICTURES; out.streamed = !!st.streamedImagery(); out.no_imagery = ms.NO_IMAGERY; } catch (e) { out.msErr = String(e); }
      return out;
    }"""))
    b.close()
