import time, sys
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'])
    page = b.new_context(viewport={'width': 430, 'height': 860}, device_scale_factor=2, is_mobile=True, has_touch=True).new_page()
    page.goto("https://hunt-dev.groundwind.app/?area=searchmont", wait_until='load', timeout=90000)
    time.sleep(30)
    page.evaluate("(() => { const b = [...document.querySelectorAll('button')].filter(e => /Sat/.test(e.innerText) && e.getBoundingClientRect().top > 700); if (b.length) b[0].click(); })()"); time.sleep(2)
    page.get_by_text("More", exact=True).first.click(); time.sleep(2)
    page.evaluate("(() => { const b = [...document.querySelectorAll('button[role=menuitem]')].find(e => /^Edit this view/.test((e.innerText||'').trim())); if (b) b.click(); })()"); time.sleep(4)
    page.get_by_text("Land", exact=True).first.click(); time.sleep(2)
    txt = page.evaluate("document.body.innerText")
    print("Property lines row:", "Property lines" in txt, "| Private land row:", "Private land" in txt)
    if "Property lines" in txt:
        page.get_by_text("Property lines", exact=False).first.click(); time.sleep(6)
        n = page.evaluate("performance.getEntriesByType('resource').filter(r => /places-searchmont/.test(r.name)).length")
        print("places archive requests:", n)
    page.screenshot(path=sys.argv[1]); b.close()
