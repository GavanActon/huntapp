"""Readiness for the headless scripts: wait for what the page is doing, never for the clock.

Nothing to run; the scripts import it:  import readiness as R

Why: SwiftShader on a busy machine (other sessions' bakes and browsers at 100% CPU) took 14-24 s to boot a page that boots in 2 s on a
quiet one, so 'wait 8 s, then act' acts on a page that is not there yet. Every wait here polls the page for the thing the next step needs
and gives up at a cap, saying so (None), instead of acting anyway.

  Console(page)                 the page's console, page errors, failed requests, 4xx/5xx answers and load count, each with its time
  wait_js(page, js, cap_s)      poll a page function until it is truthy: seconds waited, None at the cap
  wait_ready(page, console)     map loaded + the strip's hour cells + the first '[spots] ... scored in' line
  wait_heat(page)               the heat layer visible with pins on it (and at least 20 s: the colours settle)
  wait_quiet(page, console)     no console line matching a pattern for a few seconds (the passes are done)
  hold_clock(ctx, 'HH:MM')      the page's Date held still (see clock.py for why)
  other_headless()              how many headless browsers other sessions have open (a busy machine: timings do not compare)
"""
import re
import subprocess
import time
from datetime import datetime

# map loaded and the strip has its hour cells: the app has a forecast and drew it
READY_JS = "() => { const m = window.__map; return !!(m && m.loaded() && document.querySelectorAll('.wxcell').length > 20) }"

# the heat layer is on and the scorer's pins are drawn
HEAT_READY_JS = """() => { const m = window.__map; if (!m || !m.getLayer('spots-heat')) return false
  if ((m.getLayoutProperty('spots-heat', 'visibility') || 'visible') !== 'visible') return false
  return m.getLayer('spots-pin') ? m.queryRenderedFeatures({ layers: ['spots-pin'] }).length > 0 : false }"""

# a sheet is up and no lazy chunk is still loading (SheetHost's Suspense fallback is <div class="empty">…</div>)
SHEET_READY_JS = r"""
() => {
  if (!document.querySelector('.sheet')) return false
  return ![...document.querySelectorAll('.sheet .empty')].some((x) => x.textContent.trim() === '…')
}
"""

# routes compute in a worker: the rows (.rt-rows) or a note (.rt-note) say it answered
ROUTES_READY_JS = "() => !!(document.querySelector('.rt-rows') || document.querySelector('.rt-note'))"

# the info popup's weather line is filled
POPUP_WX_JS = "() => (document.querySelector('.depth-popup-wx')?.innerText || '').trim().length > 0"


class Console:
    """What a page says, with seconds since the page was made: (seconds, '[type] text') pairs.

    Records console messages ('[log]', '[debug]', '[error]'...), '[pageerror]', '[requestfailed] url reason', '[http 429] url' for every
    answer of 400 or more, and counts the page's load events (a hot reload from another session's edit shows as loads > 1)."""

    def __init__(self, page):
        self.t0 = time.monotonic()
        self.items = []
        self.loads = 0
        page.on('console', lambda m: self.add(f'[{m.type}] {m.text}'))
        page.on('pageerror', lambda e: self.add(f'[pageerror] {e}'))
        page.on('requestfailed', lambda r: self.add(f'[requestfailed] {r.url[:150]} {r.failure}'))
        page.on('response', lambda r: self.add(f'[http {r.status}] {r.url[:150]}') if r.status >= 400 else None)
        page.on('load', lambda _p: setattr(self, 'loads', self.loads + 1))

    def add(self, text):
        self.items.append((time.monotonic() - self.t0, text))

    def lines(self):
        return [t for _, t in self.items]

    def count(self, pattern):
        rx = re.compile(pattern)
        return sum(1 for _, t in self.items if rx.search(t))

    def last(self, pattern):
        """When (seconds) the latest line matching the pattern came, None if none did."""
        rx = re.compile(pattern)
        hits = [ts for ts, t in self.items if rx.search(t)]
        return hits[-1] if hits else None

    def stamped(self):
        return [f'{ts:7.1f}s {t}' for ts, t in self.items]

    def save(self, path):
        with open(path, 'w', encoding='utf-8') as f:
            f.write('\n'.join(self.stamped()) + '\n')


def wait_js(page, js, cap_s, poll=None):
    """Poll a page function until it is truthy. Seconds waited (1 decimal), or None when cap_s ran out (or the page went away)."""
    t = time.monotonic()
    try:
        page.wait_for_function(js, timeout=cap_s * 1000, polling=poll)
        return round(time.monotonic() - t, 1)
    except Exception:  # noqa: BLE001  (a timeout, or a page that was closed or navigated: not ready either way)
        return None


def wait_ready(page, console, map_cap_s=150, pass_cap_s=120):
    """After the load event: wait for the map and the strip's hour cells, then for the first scoring pass.
    Returns {'mapAndStripS': seconds|None, 'firstPassS': seconds|None}; None means the cap ran out (no forecast, usually)."""
    ready = {'mapAndStripS': wait_js(page, READY_JS, map_cap_s, poll=500)}
    t = time.monotonic()
    while time.monotonic() - t < pass_cap_s and not console.count(r'scored in'):
        page.wait_for_timeout(500)
    ready['firstPassS'] = round(time.monotonic() - t, 1) if console.count(r'scored in') else None
    return ready


def wait_heat(page, min_s=20, cap_s=150):
    """At least min_s, and until the heat layer is visible with pins (at most cap_s). Seconds until visible, None if it never was."""
    t = time.monotonic()
    got = wait_js(page, HEAT_READY_JS, cap_s, poll=500)
    rest = min_s - (time.monotonic() - t)
    if rest > 0:
        page.wait_for_timeout(int(rest * 1000))
    return got


QUIET_PAT = r'scored in|\[wind\]|\[routes\]|\[spots\]|\[wx\]'  # the app's own work lines: passes, wind, routes, spots, weather


def wait_quiet(page, console, secs=8, cap_s=60, pat=QUIET_PAT):
    """Until no console line matching pat has come for `secs` seconds (cap_s at most). True when it went quiet."""
    t = time.monotonic()
    while time.monotonic() - t < cap_s:
        last = console.last(pat)
        since = (console.t0 + last) if last is not None else t  # no such line yet: quiet from when we began to wait
        if time.monotonic() - since >= secs:
            return True
        page.wait_for_timeout(500)
    return False


def clock_time(spec):
    """A clock spec as an aware datetime: 'auto' (when the capture was taken), 'HH:MM' (that time on the capture's day, today if there is
    no capture) or an ISO time ('2026-10-17T04:02:00-04:00'; no offset = this machine's zone)."""
    import omcache  # noqa: PLC0415  (omcache imports nothing from here; only needed for the capture's time)
    spec = spec.strip()
    if spec == 'auto':
        t = omcache.captured_at()
        if t is None:
            raise SystemExit('--clock auto: there is no capture to take the time from (see omcache.py)')
        return t
    m = re.fullmatch(r'(\d{1,2}):(\d{2})', spec)
    if m:
        day = (omcache.captured_at() or datetime.now().astimezone()).date()
        return datetime(day.year, day.month, day.day, int(m[1]), int(m[2])).astimezone()
    t = datetime.fromisoformat(spec)
    return t if t.tzinfo else t.astimezone()


def hold_clock(ctx, spec):
    """Hold the page's Date at `spec` for every page of this context (before it loads): Date.now() and new Date() stay put, the timers
    keep running. Returns the time held. Not for runs that depend on a GPS fix's age: the app drops a fix older than 20 s by that clock."""
    t = clock_time(spec)
    ctx.clock.set_fixed_time(t)
    return t


def other_headless():
    """Top-level headless browsers that are not ours (a script has none open between its loads). -1 when it cannot be told (not Windows)."""
    try:
        out = subprocess.run(['powershell', '-NoProfile', '-Command',
                              "(Get-CimInstance Win32_Process -Filter \"Name='chrome-headless-shell.exe'\" | Where-Object { $_.CommandLine -notmatch '--type=' } | Measure-Object).Count"],
                             capture_output=True, text=True, timeout=30).stdout.strip()
        return int(out or 0)
    except Exception:  # noqa: BLE001
        return -1
