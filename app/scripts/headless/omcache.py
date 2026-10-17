"""Open-Meteo capture and replay for the headless scripts.

    py -3.14 scripts/headless/omcache.py capture --url http://localhost:5199/    ONCE: record what the app asks Open-Meteo, and the answers
    py -3.14 scripts/headless/omcache.py capture --url ... --refresh              again over what is there (a fresher forecast)
    py -3.14 scripts/headless/omcache.py probe                                    one live request: has the daily limit been spent?
    py -3.14 scripts/headless/omcache.py urls                                     what the capture holds (when, how big)
    import omcache; omcache.install(ctx, stats)                                   the replay itself (scenarios.py and the rest do this)

THE TRAP. A cold open of the app asks Open-Meteo for about twenty things at once (two of them 25-point wind grids), and the free API has a
daily limit. Test loads spend it, yours and any other session's on the same IP: after a day of them every request answers 429 'Daily API
request limit exceeded. Please try again tomorrow.' and the app sits on 'Fetching the outlook...': no hour cells in the strip, no wind streaks,
no heat, no Dig in score, and a run of the scenarios that compares nothing. It can start earlier than that, from the burst alone, while a
single request still answers 200: a probe that says 200 does not promise the app will be fed. So the test loads never go to the real API:

  capture   one page load with every Open-Meteo request logged and ABORTED (no quota spent) lists what the app asks for; then those requests
            are made once, paced (4 s apart), and stored in omcache/. Do it on a day the limit is intact. A minutely 429 waits and retries; an
            hourly or daily one stops the capture with what it has (run it again later: what is recorded is kept, unless --refresh).
  replay    install(ctx) answers every Open-Meteo request of a context from the capture and sends nothing live. The app's own code runs; only the
            answers are replayed. Exact URL first; else a DONOR: the recorded answer to the same request for other coordinates (same host, path
            and parameters, latitude, longitude and timezone blanked, then the model and past days blanked too: the view lattice asks the wind
            grid's question of another model); else the request is aborted and listed in stats['missed']. A donor makes a plausible forecast for
            a place that was not captured (another area gets this one's weather: wrong for the place, the same for every run, which is all a
            regression needs). Nothing is ever sent live, so a run cannot spend quota and a before and an after see the same forecast.
  ageing    a capture is a forecast from the day it was taken (about a week ahead of it, a day behind). Later than that the strip has no hours
            and the runs say 'NOT READY': hold the page's clock at the capture's time (--clock auto, readiness.hold_clock) or capture again. Do not
            capture between a scoredump 'before' and its 'after': they must see the same forecast.

OMCACHE=<folder> names another capture folder.
"""
import base64
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.environ.get('OMCACHE') or os.path.join(HERE, 'omcache')
RE = re.compile(r'^https://([a-z0-9-]+\.)?open-meteo\.com/')
PROBE = 'https://api.open-meteo.com/v1/forecast?latitude=48.9262&longitude=-85.5987&current=temperature_2m'
ENTRY = re.compile(r'^[0-9a-f]{20}\.json$')  # a recorded answer's file; urls.json (what the app asked) sits beside them


def key(url):
    return hashlib.sha1(url.encode()).hexdigest()[:20]


def path(url):
    return os.path.join(CACHE, key(url) + '.json')


def sig(url, relaxed=False):
    """The request with its coordinates and timezone blanked: what a donor must match. Relaxed: the model and the past days blanked too."""
    s = re.sub(r'(latitude|longitude|timezone)=[^&]*', lambda m: m.group(1) + '=X', url)
    if relaxed:
        s = re.sub(r'(models|past_days)=[^&]*', lambda m: m.group(1) + '=X', s)
    return s


def entries():
    """(file name, entry) for every recorded answer."""
    if not os.path.isdir(CACHE):
        return
    for f in sorted(os.listdir(CACHE)):
        if not ENTRY.match(f):
            continue
        try:
            with open(os.path.join(CACHE, f), encoding='utf-8') as fh:
                yield f, json.load(fh)
        except Exception:  # noqa: BLE001
            continue


def count():
    """How many answers (status 200) the capture holds."""
    return sum(1 for _, d in entries() if d.get('status') == 200)


def captured_at():
    """When the newest recorded answer was taken (an aware datetime, this machine's zone), None for no capture."""
    best = None
    for _, d in entries():
        try:
            t = datetime.strptime(d['saved'], '%Y-%m-%d %H:%M:%S').astimezone()
        except Exception:  # noqa: BLE001
            continue
        if best is None or t > best:
            best = t
    return best


_donors = None
_donors_relaxed = None


def donors(relaxed=False):
    global _donors, _donors_relaxed
    if _donors is None:
        _donors, _donors_relaxed = {}, {}
        for _, d in entries():
            if d.get('status') == 200:
                _donors.setdefault(sig(d['url']), d)
                _donors_relaxed.setdefault(sig(d['url'], True), d)
    return _donors_relaxed if relaxed else _donors


def donor_for(url):
    return donors().get(sig(url)) or donors(True).get(sig(url, True))


def load(url):
    p = path(url)
    if not os.path.exists(p):
        return None
    try:
        with open(p, encoding='utf-8') as f:
            return json.load(f)
    except Exception:  # noqa: BLE001
        return None


def save(url, status, ctype, body):
    os.makedirs(CACHE, exist_ok=True)
    with open(path(url), 'w', encoding='utf-8') as f:
        json.dump({'url': url, 'status': status, 'ctype': ctype, 'saved': time.strftime('%Y-%m-%d %H:%M:%S'), 'body_b64': base64.b64encode(body).decode()}, f)


def headers(ctype):
    return {'content-type': ctype or 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'cache-control': 'no-store'}


def install(ctx, stats=None):
    """Replay: every open-meteo.com request of this context is answered from the capture (or aborted); none goes live.
    stats: hit (exact), donor (another point's answer), aborted, missed (the aborted URLs)."""
    stats = stats if stats is not None else {}
    for k in ('hit', 'donor', 'aborted'):
        stats.setdefault(k, 0)
    stats.setdefault('missed', [])

    def handler(route, request):
        url = request.url
        hit = load(url)
        if hit and hit['status'] == 200:
            stats['hit'] += 1
            return route.fulfill(status=200, headers=headers(hit['ctype']), body=base64.b64decode(hit['body_b64']))
        donor = donor_for(url)
        if donor:
            stats['donor'] += 1
            return route.fulfill(status=200, headers=headers(donor['ctype']), body=base64.b64decode(donor['body_b64']))
        stats['aborted'] += 1
        stats['missed'].append(url[:160])
        return route.abort()

    ctx.route(RE, handler)
    return stats


# ---------------------------------------------------------------- capture

def probe():
    """One live request (one call of the quota). Prints and returns the HTTP status."""
    try:
        with urllib.request.urlopen(PROBE, timeout=20) as r:
            print(f'{r.status}: Open-Meteo answers (that does not promise a cold open of the app will be fed: see the top of this file)')
            return r.status
    except urllib.error.HTTPError as e:
        print(f'{e.code}: {e.read()[:200].decode("utf-8", "replace")}')
        return e.code
    except Exception as e:  # noqa: BLE001
        print(f'no answer: {type(e).__name__} {e}')
        return 0


def discover(pw, wait_s=50):
    """The URLs the app asks Open-Meteo for, in first-seen order: one page load with every such request logged and ABORTED (no quota spent).
    The app retries a failed ask, so the page is left for wait_s: the sweep, the strip, the scorer, the wind grid and the profile all ask. Then
    a tap on the ground (the popup's own weather ask), the heat on, a tap again."""
    import scenarios as B  # noqa: PLC0415  (scenarios imports this module; only needed here, once the options are read)
    urls = []

    def handler(route, request):
        if request.url not in urls:
            urls.append(request.url)
        route.abort()

    sess = B.Session(pw, replay=False, dpr=1)
    try:
        sess.ctx.route(RE, handler)
        page = sess.page
        page.goto(B.CFG.url, wait_until='load', timeout=90000)
        page.wait_for_timeout(wait_s * 1000)
        page.mouse.click(130, 330)
        page.wait_for_timeout(8000)
        try:
            page.locator(B.HEAT).first.click(timeout=5000)
        except Exception as e:  # noqa: BLE001
            print('heat click failed', str(e)[:80])
        page.wait_for_timeout(10000)
        page.mouse.click(130, 330)
        page.wait_for_timeout(8000)
    finally:
        sess.close()
    return urls


def fetch_all(urls, gap=4.0, wait429=30, tries=12, refresh=False):
    """Paced live fetch of every URL into the capture; what is there already is kept unless refresh. A minutely 429 waits and retries; an
    hourly or daily one stops here (it will not clear for a while). Returns (ok, not_ok, why it stopped or None)."""
    ok = 0
    for i, u in enumerate(urls, 1):
        if not refresh and (load(u) or {}).get('status') == 200:
            print(f'{i}/{len(urls)} already captured')
            ok += 1
            continue
        done = False
        for k in range(tries):
            try:
                with urllib.request.urlopen(u, timeout=60) as r:
                    body = r.read()
                    save(u, r.status, r.headers.get('content-type'), body)
                print(f'{i}/{len(urls)} 200 {len(body)} B  {u[:110]}', flush=True)
                ok += 1
                done = True
                break
            except urllib.error.HTTPError as e:
                reason = e.read()[:200].decode('utf-8', 'replace')
                print(f'{i}/{len(urls)} HTTP {e.code} (try {k + 1}): {reason!r}  {u[:80]}', flush=True)
                if e.code == 429:
                    if re.search(r'daily|hourly', reason, re.I):
                        return ok, len(urls) - ok, reason
                    time.sleep(wait429)
                    continue
                break
            except Exception as e:  # noqa: BLE001
                print(f'{i}/{len(urls)} {type(e).__name__} {e} (try {k + 1})', flush=True)
                time.sleep(10)
        if not done:
            print(f'{i}/{len(urls)} not captured: {u[:110]}')
        time.sleep(gap)
    return ok, len(urls) - ok, None


def show_urls():
    n = 0
    for _, d in entries():
        n += 1
        print(d['status'], len(d['body_b64']) * 3 // 4, d['saved'], d['url'][:130])
    print(n, 'recorded in', CACHE)
    t = captured_at()
    if t:
        print('newest answer taken', t.strftime('%Y-%m-%d %H:%M:%S %z'), '(hold the page clock there with --clock auto)')
    up = os.path.join(CACHE, 'urls.json')
    if os.path.exists(up):
        with open(up, encoding='utf-8') as f:
            asked = json.load(f)
        have = sum(1 for u in asked if (load(u) or {}).get('status') == 200)
        print(f'{have} of the {len(asked)} requests the app made at capture time are recorded; the others are answered by a donor')


def main(argv):
    for s in (sys.stdout, sys.stderr):
        if hasattr(s, 'reconfigure'):
            s.reconfigure(encoding='utf-8', errors='replace')
    cmd = argv[0] if argv else 'urls'
    if cmd == 'probe':
        return 0 if probe() == 200 else 1
    if cmd == 'urls':
        show_urls()
        return 0
    if cmd == 'capture':
        import scenarios as B  # noqa: PLC0415
        from playwright.sync_api import sync_playwright  # noqa: PLC0415
        rest = B.configure(argv[1:], default_name='capture', need_capture=False, need_out=False)
        if probe() == 429:
            print('the limit is spent: capture on a day it is not (nothing was loaded, nothing was changed)')
            return 1
        with sync_playwright() as pw:
            urls = discover(pw)
        print(len(urls), 'requests the app asks Open-Meteo for')
        os.makedirs(CACHE, exist_ok=True)
        with open(os.path.join(CACHE, 'urls.json'), 'w', encoding='utf-8') as f:
            json.dump(urls, f, indent=1)
        ok, bad, why = fetch_all(urls, refresh='--refresh' in rest)
        print(f'captured {ok} of {len(urls)}' + (f' ({bad} not)' if bad else '') + (f'; stopped: {why}' if why else ''))
        show_urls()
        return 1 if bad else 0
    print(__doc__)
    return 2


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
