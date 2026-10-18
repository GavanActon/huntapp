import time, sys
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'])
    page = b.new_context(viewport={'width': 430, 'height': 860}, device_scale_factor=2, is_mobile=True, has_touch=True).new_page()
    page.goto("https://hunt.groundwind.app/?area=clearwater&pictures=stream", wait_until='load', timeout=90000)
    time.sleep(90)
    tile = page.evaluate("(() => { const t = [...document.querySelectorAll('button, span, div')].find(e => /^(HD|SD)$/.test(e.innerText?.trim()) && e.getBoundingClientRect().top > 700); return t ? t.innerText.trim() : '?' })()")
    micro = page.evaluate("performance.getEntriesByType('resource').filter(r => r.name.includes('micro-clearwater')).map(r => r.name.split('/').pop() + ' ' + r.transferSize)")
    print("grade tile:", tile, "| grids fetched:", micro)
    page.screenshot(path=sys.argv[1]); b.close()
