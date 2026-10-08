"""Replay the hunt log's wind checks through the ground model as it is now.

    python scripts/replay.py <hunt-log.gpx> [--url http://localhost:5195/] [--out replay.csv] [--days 2026-09-29,...]

For each day with checks the app is opened headless with its clock set to
that day, every api.open-meteo.com call rerouted to the historical-forecast
API with matching dates (the archived HRDPS and blend, so the forecast is
the one the phone had), the ensemble left to miss (the model carries on
after its grace). Once the wind grid, the profile and the micro grid are in,
each check's place and minute go through `groundWind` (weather/micro/model.ts),
the call the check card makes, with no lessons applied: the raw rules. The
CSV holds the felt wind, the call the phone logged at the time, and the
call the model makes now; the summary scores direction within 45° and
speed within 2× by place, cover, regime and hour. The GPX holds real
positions, so keep the CSV out of the repo (field-data/).

Needs the quiet dev server (vite.quiet.config.ts): hot reload off, so the
module imported from page.evaluate is the app's own instance.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import re
import statistics
import sys
import time
from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit
from zoneinfo import ZoneInfo

from playwright.sync_api import sync_playwright

TZ = ZoneInfo("America/Toronto")
POINTS = {"N": 0, "NE": 45, "E": 90, "SE": 135, "S": 180, "SW": 225, "W": 270, "NW": 315}
# windChecks.ts STRENGTH_KMH
STRENGTH = {"calm": 0.3, "drift": 1.5, "light": 5, "breezy": 12, "windy": 22}
# the archive runs a day or so behind
LAST_ARCHIVE_DAY = date.today() - timedelta(days=1)
# named places, for the summary (m)
PLACES = {"bog": (48.9250, -85.6006, 120), "camp": (48.9262, -85.59872, 200), "lake strip": (48.95406, -85.55121, 150)}

ARCHIVE = "https://historical-forecast-api.open-meteo.com"


def parse_gpx(path: Path) -> list[dict]:
    txt = path.read_text(encoding="utf-8")
    out = []
    for lat, lon, body in re.findall(r'<wpt lat="([-\d.]+)" lon="([-\d.]+)">(.*?)</wpt>', txt, re.S):
        if "<type>windcheck</type>" not in body:
            continue
        t = re.search(r"<time>([^<]+)</time>", body).group(1)
        name = re.search(r"<name>(.*?)</name>", body).group(1)
        dm = re.search(r"<desc>(.*?)</desc>", body, re.S)
        desc = dm.group(1) if dm else ""
        dt = datetime.fromisoformat(t.replace("Z", "+00:00"))
        m = re.search(r"toward (\w+), (\w+)", name)
        toward, strength = (m.group(1), m.group(2)) if m else (None, "calm")
        lm = re.search(r"from (\w+) ([\d.]+) km/h, (\w+) · (\w+)", desc)
        out.append(
            {
                "ts": int(dt.timestamp() * 1000),
                "local": dt.astimezone(TZ),
                "lat": float(lat),
                "lon": float(lon),
                "feltToward": toward,
                "feltStrength": strength,
                "feltKmh": STRENGTH.get(strength, 0.3),
                "feltDirFrom": (POINTS[toward] + 180) % 360 if toward in POINTS else None,
                "loggedDirFrom": (POINTS[lm.group(1)] if lm and lm.group(1) in POINTS else None),
                "loggedKmh": float(lm.group(2)) if lm else None,
                "loggedRegime": lm.group(3) if lm else "",
                "loggedVerdict": lm.group(4) if lm else "",
            }
        )
    out.sort(key=lambda r: r["ts"])
    return out


def rewrite(url: str, day: date) -> str:
    """The app's forecast request as the archive takes it: the same point(s),
    hours and model, with the days it asked for turned into dates."""
    u = urlsplit(url)
    q = dict(parse_qsl(u.query))
    past = int(q.pop("past_days", "0"))
    fwd = int(q.pop("forecast_days", "1"))
    start = day - timedelta(days=past)
    end = min(day + timedelta(days=fwd - 1), LAST_ARCHIVE_DAY)
    q["start_date"] = start.isoformat()
    q["end_date"] = end.isoformat()
    return f"{ARCHIVE}{u.path}?{urlencode(q)}"


READY_JS = """
async ({ ms, lon, lat }) => {
  const m = await import('/src/weather/micro/model.ts')
  const w = await import('/src/weather/windGrid.ts')
  const b = await import('/src/weather/boundaryLayer.ts')
  const o = await import('/src/weather/openMeteo.ts')
  const p = b.currentProfile()
  // HRDPS's own hours must be in (the profile and the point forecast both
  // carry a count): a run where the archive was slow would be the blend's
  const pOk = !!p && p.hrdpsHours > 0 && p.time.length > 0 && ms >= Date.parse(p.time[0]) && ms <= Date.parse(p.time[p.time.length - 1]) + 3600000
  const f = o.cachedPointForecast(lon, lat)
  return { micro: !!m.microGrid(), grid: w.windGridCovers(ms), profile: pOk, point: !!f && f.hrdpsHours > 0, now: Date.now() }
}
"""

CHECK_JS = """
async ({ lon, lat, ms }) => {
  const m = await import('/src/weather/micro/model.ts')
  await m.microReadyFor(ms, 20000)
  // the shoreline rules off and on, on the same air
  m.setShoreRules(false)
  const g0 = m.groundWind(lon, lat, ms)
  m.setShoreRules(true)
  const g = m.groundWind(lon, lat, ms)
  const c = m.microCell(lon, lat, ms)
  return { g, g0, c }
}
"""

# every momentum direction in before the day's checks, so a direction
# landing late never changes a sample between runs
REST_JS = """
async () => {
  const m = await import('/src/weather/micro/model.ts')
  await Promise.race([m.loadRestOfMicro(), new Promise((r) => setTimeout(r, 30000))])
}
"""


def wrap(d: float) -> float:
    return (d + 180) % 360 - 180


def place_of(lat: float, lon: float) -> str:
    for name, (plat, plon, r) in PLACES.items():
        dx = (lon - plon) * 111320 * math.cos(math.radians(lat))
        dy = (lat - plat) * 110540
        if math.hypot(dx, dy) <= r:
            return name
    return "other"


def hour_band(local: datetime) -> str:
    h = local.hour + local.minute / 60
    if h < 9:
        return "dawn"
    if h < 16:
        return "day"
    if h < 20:
        return "dusk"
    return "night"


def run(args) -> list[dict]:
    checks = parse_gpx(Path(args.gpx))
    if args.days:
        want = set(args.days.split(","))
        checks = [c for c in checks if c["local"].date().isoformat() in want]
    by_day: dict[date, list[dict]] = defaultdict(list)
    for c in checks:
        by_day[c["local"].date()].append(c)
    print(f"{len(checks)} checks over {len(by_day)} days", flush=True)
    rows: list[dict] = []
    home = None
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
        for day, todays in sorted(by_day.items()):
            t0 = time.time()
            ctx = browser.new_context(ignore_https_errors=True, viewport={"width": 430, "height": 900})
            page = ctx.new_page()
            page.route("**/api.open-meteo.com/**", lambda route, request, day=day: fulfil(route, request, day))
            page.route("**/ensemble-api.open-meteo.com/**", lambda route, request: route.abort())
            first = todays[0]
            page.clock.install(time=first["local"] - timedelta(minutes=30))
            page.goto(args.url, wait_until="load")
            try:
                page.clock.resume()
            except Exception:
                pass
            # the camp: the profile and the point forecast are asked there
            if home is None:
                home = page.evaluate("async () => { const a = await import('/src/areas/index.ts'); return a.ACTIVE_AREA.presets[0] }")
            ready = wait_ready(page, first["ts"], home)
            if not (ready and ready["micro"] and ready["grid"] and ready["profile"]):
                print(f"  {day}: not ready after 120 s: {ready}", flush=True)
                ctx.close()
                continue
            page.evaluate(REST_JS)
            print(f"  {day}: ready in {time.time() - t0:.0f} s ({len(todays)} checks)", flush=True)
            for n, c in enumerate(todays):
                t1 = time.time()
                r = page.evaluate(CHECK_JS, {"lon": c["lon"], "lat": c["lat"], "ms": c["ts"]})
                if time.time() - t1 > 5:
                    print(f"    check {n + 1}/{len(todays)} took {time.time() - t1:.0f} s", flush=True)
                g, g0, cell = r["g"], r["g0"], r["c"] or {}
                row = {k: v for k, v in c.items() if k != "local"}
                row["timeLocal"] = c["local"].strftime("%Y-%m-%d %H:%M")
                row["place"] = place_of(c["lat"], c["lon"])
                row["hourBand"] = hour_band(c["local"])
                if g:
                    row.update(
                        newKmh=round(g["kmh"], 2),
                        newDirFrom=round(g["dirFrom"]),
                        newRegime=g["regime"],
                        newSigma=round(g["sigmaDeg"]),
                        swirl=g["swirl"],
                        gusty=g["gusty"],
                        gustKmh=round(g["gustKmh"], 1),
                        regionalKmh=round(g["regionalKmh"], 1),
                        regionalDir=round(g["regionalDir"]),
                        local10Kmh=round(g["local10Kmh"], 1),
                        inSlot=g["inSlot"],
                        inWoods=g["inWoods"],
                        decoupled=g["decoupled"],
                        stable=round(g["layering"].get("stable", float("nan")), 2) if isinstance(g.get("layering"), dict) else "",
                        headline=g["headline"],
                        reasons=" | ".join(g["reasons"]),
                    )
                if g0:
                    row.update(rulesOffKmh=round(g0["kmh"], 2), rulesOffDirFrom=round(g0["dirFrom"]))
                row["treeH"] = cell.get("treeH")
                row["canopy"] = cell.get("canopy")
                rows.append(row)
            page.unroute_all(behavior="ignoreErrors")
            ctx.close()
    return rows


def wait_ready(page, ms: int, home: dict, tries: int = 3, each_s: int = 45) -> dict | None:
    """Poll until the grids and the archived forecast are in; a page that is
    still short after each_s (an archive call that timed out) is reloaded."""
    ready = None
    for attempt in range(tries):
        for _ in range(each_s):
            ready = page.evaluate(READY_JS, {"ms": ms, "lon": home["lon"], "lat": home["lat"]})
            if ready["micro"] and ready["grid"] and ready["profile"] and ready["point"]:
                return ready
            time.sleep(1)
        if attempt + 1 < tries:
            print(f"  not ready after {each_s} s ({ready}); reloading", flush=True)
            page.reload(wait_until="load")
    return ready


def fulfil(route, request, day: date) -> None:
    try:
        url = rewrite(request.url, day)
        resp = route.fetch(url=url)
        # the archive allows few requests at once and the app opens with a
        # burst of them: wait and ask again, so no forecast silently misses
        for wait in (0.5, 1, 2, 3, 5):
            if resp.status != 429:
                break
            time.sleep(wait)
            resp = route.fetch(url=url)
        if resp.status != 200:
            print(f"  archive {resp.status} for {url[:160]}… · {resp.text()[:200]}", flush=True)
        route.fulfill(response=resp)
    except Exception as e:  # noqa: BLE001
        # a request still out when the day's context closes is not a miss
        if "has been closed" not in str(e):
            print(f"  forecast miss: {str(e).splitlines()[0]}", flush=True)
        try:
            route.abort()
        except Exception:  # noqa: BLE001
            pass


def score(rows: list[dict], label: str, kmh: str = "newKmh", dir_: str = "newDirFrom") -> None:
    withdir = [r for r in rows if r.get("feltDirFrom") is not None and r.get(dir_) is not None]
    calm = [r for r in rows if r["feltStrength"] == "calm" and r.get(kmh) is not None]
    nc = [r for r in rows if r["feltStrength"] != "calm" and r.get(kmh) is not None]
    if not rows:
        return
    parts = [f"{label:<18} n={len(rows):2d}"]
    if withdir:
        d = [abs(wrap(r[dir_] - r["feltDirFrom"])) for r in withdir]
        parts.append(f"dir≤45° {100 * sum(x <= 45 for x in d) / len(d):3.0f}% (med {statistics.median(d):3.0f}°, n={len(d)})")
    if nc:
        ratio = [r[kmh] / r["feltKmh"] for r in nc]
        parts.append(f"speed 2× {100 * sum(0.5 <= x <= 2 for x in ratio) / len(ratio):3.0f}% (med ×{statistics.median(ratio):.2f}, under {100 * sum(x < 0.5 for x in ratio) / len(ratio):.0f}%)")
    if calm:
        parts.append(f"calm agreed {100 * sum(r[kmh] < 2.5 for r in calm) / len(calm):.0f}% (n={len(calm)})")
    print("  " + " · ".join(parts))


def forecast_miss(r: dict) -> bool:
    """Felt harder than the model's own 10 m wind over the spot: the forecast
    was short there, and no rule at head height can reach it."""
    return r["feltStrength"] != "calm" and r.get("local10Kmh") is not None and r["feltKmh"] > r["local10Kmh"]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("gpx")
    ap.add_argument("--url", default="http://localhost:5195/")
    ap.add_argument("--out")
    ap.add_argument("--days", help="local days to run, comma separated")
    args = ap.parse_args()
    rows = run(args)
    if not rows:
        print("nothing replayed")
        return 1
    out = Path(args.out) if args.out else Path(args.gpx).with_name(f"replay-{date.today().isoformat()}.csv")
    keys = sorted({k for r in rows for k in r}, key=lambda k: (k not in ("timeLocal", "lat", "lon", "place"), k))
    with out.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=keys)
        w.writeheader()
        w.writerows(rows)
    print(f"wrote {out} ({len(rows)} rows)")

    if any("rulesOffKmh" in r for r in rows):
        print("\nThe shoreline rules off, then on, on the same air:")
        score(rows, "all, rules off", "rulesOffKmh", "rulesOffDirFrom")
        score(rows, "all, rules on")
        ok = [r for r in rows if not forecast_miss(r)]
        score(ok, "no fcst miss, off", "rulesOffKmh", "rulesOffDirFrom")
        score(ok, "no fcst miss, on")
        for key, val in (("place", "bog"), ("hourBand", "dusk")):
            sel = [r for r in ok if r.get(key) == val]
            score(sel, f"{val}, off", "rulesOffKmh", "rulesOffDirFrom")
            score(sel, f"{val}, on")
        print(f"  ({len(rows) - len(ok)} checks felt harder than the 10 m wind over the spot: forecast misses, no floor rule reaches them)")
    print("\nThe model now, against what was felt:")
    score(rows, "all")
    for key in ("place", "hourBand", "newRegime"):
        for v in sorted({r.get(key, "") for r in rows}):
            score([r for r in rows if r.get(key, "") == v], f"{key}={v}")
    score([r for r in rows if (r.get("treeH") or 0) >= 6], "in a stand")
    score([r for r in rows if (r.get("treeH") or 0) < 6], "open ground")
    score([r for r in rows if r.get("inSlot")], "slot cells")
    # the phone's own call at the time, for the drift since
    logged = [r for r in rows if r.get("loggedDirFrom") is not None and r.get("newDirFrom") is not None]
    if logged:
        d = [abs(wrap(r["newDirFrom"] - r["loggedDirFrom"])) for r in logged]
        rr = [r["newKmh"] / max(r["loggedKmh"], 0.1) for r in logged if r.get("loggedKmh")]
        print(f"\nAgainst the call the phone logged: direction med {statistics.median(d):.0f}° apart, speed med ×{statistics.median(rr):.2f} (n={len(logged)})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
