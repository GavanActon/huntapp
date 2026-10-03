"""Screenshot the dev app with Playwright (python): python scripts/shot.py <url> <out.png> [actions]
actions: "click:<selector>;wait:<ms>;text:<button text>;hold:<selector>" separated by ;"""
import sys, time
from playwright.sync_api import sync_playwright

url = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:5176/'
out = sys.argv[2] if len(sys.argv) > 2 else 'app.png'
actions = sys.argv[3] if len(sys.argv) > 3 else ''
init_js = sys.argv[4] if len(sys.argv) > 4 else ''  # e.g. localStorage presets, run before the app loads
logs = []
with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'])
    ctx = b.new_context(viewport={'width': 430, 'height': 860}, device_scale_factor=2, is_mobile=True, has_touch=True, geolocation={'latitude': 48.9309, 'longitude': -85.5934}, permissions=['geolocation'])
    page = ctx.new_page()
    if init_js: page.add_init_script(init_js)
    page.on('console', lambda m: logs.append(f'[{m.type}] {m.text}'))
    page.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
    page.goto(url, wait_until='load', timeout=90000)
    time.sleep(8)
    for act in [a for a in actions.split(';') if a]:
        verb, _, arg = act.partition(':')
        try:
            if verb == 'click': page.click(arg, timeout=5000)
            elif verb == 'text': page.get_by_text(arg, exact=True).first.click(timeout=5000)
            elif verb == 'wait': time.sleep(int(arg) / 1000)
            elif verb == 'scroll':
                page.mouse.move(215, 700); page.mouse.wheel(0, int(arg))
            elif verb == 'key': page.keyboard.press(arg)
            elif verb == 'tap':
                x, y = [int(v) for v in arg.split(',')]
                page.mouse.click(x, y)
            elif verb == 'dbl':
                # two quick taps at x,y css px
                x, y = [int(v) for v in arg.split(',')]
                page.mouse.click(x, y); time.sleep(0.15); page.mouse.click(x, y)
            elif verb == 'hold':
                # a press and hold on an element: pointer down, 700 ms, up
                bb = page.locator(arg).first.bounding_box()
                page.mouse.move(bb['x'] + bb['width'] / 2, bb['y'] + bb['height'] / 2); page.mouse.down(); time.sleep(0.7); page.mouse.up()
        except Exception as e:
            logs.append(f'[actfail] {act}: {str(e)[:120]}')
        time.sleep(1.5)
    page.screenshot(path=out)
    b.close()
print('\n'.join(l for l in logs if 'favicon' not in l and 'manifest' not in l)[-3000:])
print('SCREENSHOT_OK', out)
