"""The inverse replay's data: every wind check we hold, with the parameters
the class priors read (docs/INVERSE.md).

    py -3.14 pipeline/inverse/build_params.py            # from the saved D1 pull
    py -3.14 pipeline/inverse/build_params.py --pull     # pull D1 again first

Sources:
- D1 `checks` (the shared checks): `npx wrangler d1 execute groundwind
  --remote --json` from site/, saved raw to pipeline/raw/inverse/checks.raw.json
  and as a plain list to checks.json.
- Gavan's hunt-log GPX of 2026-10-06 (60 Pickle Lake checks, 8-point
  directions, no forecast saved) and the app replays of it, kept outside the
  repo in FIELD (they hold real positions).
- The app's own replay (app/scripts/replay.py --loo) of each set:
  pipeline/raw/replay/replay-new4-*.csv for D1, FIELD/replay-2026-10-09-loo-local.csv
  (raw, blend, fit) and replay-2026-10-07-baseline.csv (the forecast it had,
  the raw spread) for the GPX.
- The archived HRDPS (Open-Meteo historical-forecast API, gem_hrdps_continental)
  at each check's point and hour: 2 m / 80 m temperature and wind, shortwave,
  cloud, gusts. Cached in pipeline/raw/inverse/profiles/.
- The area's micro and habitat grids (.hab): the cell's drainage, slope,
  shore, canopy, the momentum solve's 16 directions; the terrain round it
  (upwind horizon per direction, the valley's axis); the slot rule.
- PALM's Searchmont stable run (pipeline/raw/teacher/palm/fields/), read at
  the dusk checks' cells.

Writes pipeline/raw/inverse/params.json: one record per check.
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import os
import re
import subprocess
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "pipeline"))
from habfile import read_hab  # noqa: E402

RAW = ROOT / "pipeline" / "raw" / "inverse"
REPLAY = ROOT / "pipeline" / "raw" / "replay"
PALM = ROOT / "pipeline" / "raw" / "teacher" / "palm" / "fields"
FIELD = Path(os.environ.get("GW_FIELD_DATA", "C:/Users/gavan/.claude/projects/c--dev-huntapp/field-data"))
TZ = ZoneInfo("America/Toronto")
ARCHIVE = "https://historical-forecast-api.open-meteo.com/v1/forecast"
VARS = ["temperature_2m", "temperature_80m", "wind_speed_10m", "wind_direction_10m", "wind_speed_80m", "wind_direction_80m", "wind_gusts_10m", "shortwave_radiation", "cloud_cover"]

AREAS = {
    "pickle-lake": ROOT / "app/public/data",
    "searchmont": ROOT / "app/public/data/areas/searchmont",
    "sault-test": ROOT / "app/public/data/areas/sault-test",
}
POINTS = {"N": 0, "NE": 45, "E": 90, "SE": 135, "S": 180, "SW": 225, "W": 270, "NW": 315}
# windChecks.ts
STRENGTH_KMH = {"calm": 0.3, "drift": 1.5, "light": 5, "breezy": 12, "windy": 22}
DIR_SIGMA = {"calm": 90, "drift": 50, "light": 35, "breezy": 28, "windy": 25}
SEEN_KMH = {"still": 3, "leaves": 12, "branches": 24, "sway": 33, "bend": 45}
# replay.py's named places
PLACES = {"bog": (48.9250, -85.6006, 120), "camp": (48.9262, -85.59872, 200), "lake strip": (48.95406, -85.55121, 150), "searchmont floor": (46.7755, -84.0450, 450), "searchmont top": (46.7668, -84.0400, 450), "sault test": (46.4700, -84.5040, 800)}


# ---------------------------------------------------------------- small helpers

def metres(lat1, lon1, lat2, lon2) -> float:
    dy = (lat2 - lat1) * 111_320.0
    dx = (lon2 - lon1) * 111_320.0 * math.cos(math.radians((lat1 + lat2) / 2))
    return math.hypot(dx, dy)


def wrap180(a: float) -> float:
    return (a + 180.0) % 360.0 - 180.0


def from_of(e: float, n: float) -> float:
    """Bearing the air comes FROM, for an east/north vector of the air's motion."""
    return (math.degrees(math.atan2(e, n)) + 180.0) % 360.0


def place_of(lat, lon) -> str:
    for name, (la, lo, r) in PLACES.items():
        if metres(lat, lon, la, lo) <= r:
            return name
    return "other"


def sun_position(ms: float, lat: float, lon: float) -> tuple[float, float]:
    """Solar elevation and azimuth (from north, clockwise), degrees: the
    low-precision almanac (Astronomical Almanac / NOAA), good to ~0.1 deg."""
    n = ms / 86_400_000.0 + 2440587.5 - 2451545.0
    L = (280.460 + 0.9856474 * n) % 360.0
    g = math.radians((357.528 + 0.9856003 * n) % 360.0)
    lam = math.radians(L + 1.915 * math.sin(g) + 0.020 * math.sin(2 * g))
    eps = math.radians(23.439 - 0.0000004 * n)
    ra = math.atan2(math.cos(eps) * math.sin(lam), math.cos(lam))
    dec = math.asin(math.sin(eps) * math.sin(lam))
    gmst = (18.697374558 + 24.06570982441908 * n) % 24.0
    ha = math.radians(gmst * 15.0 + lon) - ra
    phi = math.radians(lat)
    el = math.asin(math.sin(phi) * math.sin(dec) + math.cos(phi) * math.cos(dec) * math.cos(ha))
    az = math.degrees(math.atan2(math.sin(ha), math.cos(ha) * math.sin(phi) - math.tan(dec) * math.cos(phi))) + 180.0
    return math.degrees(el), az % 360.0


def sunset_ms(ms: float, lat: float, lon: float) -> float:
    """The evening's sunset (elevation -0.83 deg) on the check's local day, ms."""
    local = datetime.fromtimestamp(ms / 1000, TZ)
    t = datetime(local.year, local.month, local.day, 15, 0, tzinfo=TZ).timestamp() * 1000
    prev = sun_position(t, lat, lon)[0]
    while t < datetime(local.year, local.month, local.day, 23, 0, tzinfo=TZ).timestamp() * 1000:
        t += 60_000
        el = sun_position(t, lat, lon)[0]
        if prev >= -0.83 > el:
            return t
        prev = el
    return float("nan")


# ---------------------------------------------------------------- the checks

def pull_d1() -> None:
    out = RAW / "checks.raw.json"
    cmd = 'npx wrangler d1 execute groundwind --remote --json --command "SELECT id, ts, lat, lon, area, data FROM checks ORDER BY ts"'
    r = subprocess.run(cmd, cwd=ROOT / "site", shell=True, capture_output=True, text=True, encoding="utf-8")
    if r.returncode:
        raise SystemExit(f"wrangler failed: {r.stderr[-800:]}")
    out.write_text(r.stdout, encoding="utf-8")


def load_d1() -> list[dict]:
    raw = json.loads((RAW / "checks.raw.json").read_text(encoding="utf-8"))
    rows = raw[0]["results"]
    plain = []
    for r in rows:
        c = json.loads(r["data"])
        plain.append({"dbId": r["id"], "ts": r["ts"], "lat": r["lat"], "lon": r["lon"], "area": r["area"], "check": c})
    (RAW / "checks.json").write_text(json.dumps(plain, indent=1), encoding="utf-8")
    out = []
    for p in plain:
        c = p["check"]
        f = c.get("forecast") or {}
        m = c.get("model") or {}
        out.append(
            {
                "id": f"d1-{p['dbId']}",
                "set": "d1",
                "ts": p["ts"],
                "lat": p["lat"],
                "lon": p["lon"],
                "dirFrom": None if (c.get("dirFrom") is None or c.get("strength") == "calm") else float(c["dirFrom"]),
                "strength": c.get("strength", "calm"),
                "seen": c.get("seen") or "",
                "seenFrom": c.get("seenFrom"),
                "aloft": c.get("aloft"),
                "puffs": c.get("puffs") or 1,
                "dirs": c.get("dirs"),
                "swingDeg": c.get("swingDeg") or 0,
                "quantDeg": 0,
                "forecastDir": f.get("dirFrom"),
                "forecastKmh": f.get("kmh"),
                "forecastSrc": "saved",
                "loggedDir": m.get("dirFrom"),
                "loggedKmh": m.get("kmh"),
                "loggedRegime": m.get("regime", ""),
                "loggedSigma": m.get("sigmaDeg"),
                "loggedBias": m.get("bias"),
            }
        )
    return out


def load_gpx() -> list[dict]:
    path = FIELD / "hunt-log-2026-10-06.gpx"
    if not path.exists():
        print(f"no GPX at {path}: the D1 checks only")
        return []
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
        ts = int(dt.timestamp() * 1000)
        out.append(
            {
                "id": f"gpx-{ts}",
                "set": "gpx",
                "ts": ts,
                "lat": float(lat),
                "lon": float(lon),
                "dirFrom": (POINTS[toward] + 180) % 360 if toward in POINTS else None,
                "strength": strength,
                "seen": "",
                "seenFrom": None,
                "aloft": None,
                "puffs": 1,
                "dirs": None,
                "swingDeg": 0,
                # 8-point directions: the felt bearing is known to a 45 deg sector
                "quantDeg": 13.0,
                "forecastDir": None,
                "forecastKmh": None,
                "forecastSrc": "",
                "loggedDir": POINTS[lm.group(1)] if lm and lm.group(1) in POINTS else None,
                "loggedKmh": float(lm.group(2)) if lm else None,
                "loggedRegime": lm.group(3) if lm else "",
                "loggedSigma": None,
                "loggedBias": None,
            }
        )
    out.sort(key=lambda r: r["ts"])
    return out


def num(v):
    try:
        x = float(v)
        return x if math.isfinite(x) else None
    except (TypeError, ValueError):
        return None


def join_replays(checks: list[dict]) -> None:
    """The app's replay of each check: raw rules, local blend, fit + blend (and for
    the GPX the forecast the replay had and the raw spread)."""
    by_ts: dict[int, dict] = {}
    for f in list(REPLAY.glob("replay-new4-*.csv")) + [FIELD / "replay-2026-10-09-loo-local.csv"]:
        if not f.exists():
            continue
        for r in csv.DictReader(open(f, encoding="utf-8")):
            by_ts.setdefault(int(r["ts"]), {}).update({"rawDir": num(r["rawDir"]), "rawKmh": num(r["rawKmh"]), "rawRegime": r["rawRegime"], "blendDir": num(r["blendDir"]), "fitDir": num(r["fitDir"]), "treeHreplay": num(r.get("treeH")), "replayFile": f.name})
    base = FIELD / "replay-2026-10-07-baseline.csv"
    if base.exists():
        for r in csv.DictReader(open(base, encoding="utf-8")):
            by_ts.setdefault(int(r["ts"]), {}).update({"baseRegionalDir": num(r["regionalDir"]), "baseRegionalKmh": num(r["regionalKmh"]), "baseSigma": num(r["newSigma"]), "baseStable": num(r["stable"])})
    for c in checks:
        c.update(by_ts.get(c["ts"], {}))


# ---------------------------------------------------------------- the archived HRDPS

def fetch_profile(lat: float, lon: float, d0: str, d1: str) -> dict:
    key = f"{lat:.2f}_{lon:.2f}_{d0}_{d1}"
    cache = RAW / "profiles" / f"{key}.json"
    if cache.exists():
        return json.loads(cache.read_text())
    q = {"latitude": f"{lat:.4f}", "longitude": f"{lon:.4f}", "hourly": ",".join(VARS), "models": "gem_hrdps_continental", "start_date": d0, "end_date": d1, "timezone": "GMT"}
    url = f"{ARCHIVE}?{urllib.parse.urlencode(q)}"
    with urllib.request.urlopen(url, timeout=60) as resp:
        j = json.loads(resp.read())
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(j))
    return j


def profile_at(j: dict, ms: float) -> dict:
    h = j["hourly"]
    times = [datetime.fromisoformat(t).replace(tzinfo=timezone.utc).timestamp() * 1000 for t in h["time"]]
    k = max(0, min(len(times) - 2, int((ms - times[0]) // 3_600_000)))
    t = (ms - times[k]) / 3_600_000

    def lin(name):
        a, b = h[name][k], h[name][k + 1]
        if a is None or b is None:
            return a if a is not None else b
        return a + (b - a) * t

    def circ(name):
        a, b = h[name][k], h[name][k + 1]
        if a is None or b is None:
            return a if a is not None else b
        return (a + wrap180(b - a) * t) % 360

    out = {n: lin(n) for n in VARS if not n.startswith("wind_direction")}
    out["wind_direction_10m"] = circ("wind_direction_10m")
    out["wind_direction_80m"] = circ("wind_direction_80m")
    # the 7 days of air before the check, for the lake (conditions.ts estimateWaterTemp)
    lo = max(0, k - 24 * 8)
    hi = max(lo + 1, k - 24 * 1)
    t2s = [v for v in h["temperature_2m"][lo:hi] if v is not None]
    out["t2mean7"] = sum(t2s) / len(t2s) if t2s else None
    return out


def water_temp(ms: float, t2mean7: float | None) -> float:
    """conditions.ts estimateWaterTemp: 2 + 0.85 x the 7-day air mean, in the seasonal envelope."""
    doy = datetime.fromtimestamp(ms / 1000, TZ).timetuple().tm_yday
    pts = [(1, 0, 1), (120, 0, 3), (130, 4, 8), (150, 9, 14), (175, 15, 20), (215, 19, 24), (245, 16, 21), (260, 13, 17), (280, 9, 13), (300, 5, 9), (320, 1, 5), (335, 0, 2), (366, 0, 1)]
    lo, hi = 0.0, 1.0
    for i in range(1, len(pts)):
        if doy <= pts[i][0]:
            d0, lo0, hi0 = pts[i - 1]
            d1, lo1, hi1 = pts[i]
            f = (doy - d0) / (d1 - d0)
            lo, hi = lo0 + (lo1 - lo0) * f, hi0 + (hi1 - hi0) * f
            break
    if t2mean7 is None:
        return (lo + hi) / 2
    return min(hi, max(lo, 2 + 0.85 * t2mean7))


def layering(p: dict) -> dict:
    """boundaryLayer.ts layeringAt, with the profile (MICRO-WIND.md section 1)."""
    t2, t80, w10, w80, sw = p["temperature_2m"], p["temperature_80m"], p["wind_speed_10m"], p["wind_speed_80m"], p["shortwave_radiation"] or 0.0
    dtheta = t80 - t2 + 0.0098 * 78
    du = max(0.6, (w80 - w10) / 3.6)
    ri = (9.81 / (273.15 + t2)) * dtheta * 78 / (du * du)
    clamp = lambda v, a, b: min(b, max(a, v))  # noqa: E731
    stable = clamp((ri - 0.1) / 0.9, 0, 1) * clamp(dtheta / 0.8, 0, 1) if dtheta > 0 else 0.0
    convective = clamp((-dtheta - 0.2) / 1.5, 0, 1) * clamp(sw / 400, 0, 1) if dtheta < -0.2 else 0.0
    return {"dTheta": dtheta, "ri": ri, "stable": stable, "convective": convective, "inversion": clamp(dtheta / 2.5, 0, 1.5)}


def pasquill(cloud: float, w10: float, sun_el: float) -> dict:
    """boundaryLayer.ts's fallback without a profile: labelled an estimate."""
    clear = 1 - cloud / 100
    night = sun_el < 3
    calmish = math.exp(-max(0, w10 - 5) / 8)
    stable = min(1, max(0, clear * calmish * 1.1)) if night else 0.0
    convective = min(1, max(0, clear * math.sin(math.radians(sun_el)) * calmish)) if (not night and sun_el > 15) else 0.0
    return {"stable": stable, "convective": convective}


# ---------------------------------------------------------------- the ground

class Grids:
    def __init__(self, area: str):
        d = AREAS[area]
        self.h, self.m = read_hab(d / f"micro-{area}.hab")
        hh, self.hab = read_hab(d / f"habitat-{area}.hab", want=["elev", "landform", "cover", "slope", "tpi"])
        assert hh["cols"] == self.h["cols"] and hh["rows"] == self.h["rows"], "habitat and micro lattices differ"
        self.landforms = hh.get("landformNames", [])
        self.covers = hh.get("coverNames", [])
        self.dirs = self.h["model"]["momentum"]["directions"] if self.h.get("model", {}).get("momentum") else []
        self.solver = (self.h.get("model", {}).get("momentum") or {}).get("solver", "")
        self.rows, self.cols = self.h["rows"], self.h["cols"]
        self.dx, self.dy = self.h["cellM"]

    def contains(self, lat, lon) -> bool:
        c = (lon - self.h["west"]) / self.h["dLon"]
        r = (self.h["north"] - lat) / self.h["dLat"]
        return 0 <= c < self.cols and 0 <= r < self.rows

    def cell(self, lat, lon) -> tuple[int, int]:
        return int((self.h["north"] - lat) / self.h["dLat"]), int((lon - self.h["west"]) / self.h["dLon"])

    def offset(self, r, c, brg, dist) -> tuple[int, int] | None:
        rr = int(round(r - dist * math.cos(math.radians(brg)) / self.dy))
        cc = int(round(c + dist * math.sin(math.radians(brg)) / self.dx))
        if 0 <= rr < self.rows and 0 <= cc < self.cols:
            return rr, cc
        return None

    def band(self, name, r, c):
        return float(self.m[name][r, c])

    def bearing_band(self, name, r, c):
        raw = self.m[name][r, c]
        # 255 (none) x 1.44 = 367.2
        return None if raw > 360.5 else float(raw)

    def momentum(self, r, c) -> list[tuple[float, float]] | None:
        if not self.dirs:
            return None
        out = []
        for d in self.dirs:
            n = f"{d:05.1f}"
            out.append((float(self.m[f"mU{n}"][r, c]), float(self.m[f"mV{n}"][r, c])))
        return out

    def turb(self, r, c) -> list[float] | None:
        if not self.dirs or f"mT{self.dirs[0]:05.1f}" not in self.m:
            return None
        return [float(self.m[f"mT{d:05.1f}"][r, c]) for d in self.dirs]

    def terrain(self, r, c) -> dict:
        """The upwind horizon angle and the rise for 36 directions (10 deg), and
        the valley's axis (24 bearings, 15 deg): the ground round the cell out
        to 1.5 km, on 5 deg bearings."""
        z = self.hab["elev"]
        z0 = float(z[r, c])
        dists = np.arange(90.0, 1501.0, 30.0)
        ang72, rise72 = [], []
        for k in range(72):
            brg = k * 5.0
            best_a, best_r = -90.0, -1e9
            for dd in dists:
                o = self.offset(r, c, brg, dd)
                if o is None:
                    break
                dz = float(z[o]) - z0
                best_a = max(best_a, math.degrees(math.atan2(dz, dd)))
                best_r = max(best_r, dz)
            ang72.append(best_a)
            rise72.append(best_r)
        h_up = ang72[::2]
        rise = rise72[::2]
        r24 = rise72[::3]
        # the valley: the line through the cell with the least rise along it
        # and the most across it
        best = None
        for k in range(12):
            along = (max(0.0, r24[k]) + max(0.0, r24[k + 12])) / 2
            across = (max(0.0, r24[(k + 6) % 24]) + max(0.0, r24[(k + 18) % 24])) / 2
            if best is None or across - along > best[0]:
                best = (across - along, k * 15.0, along, across)
        return {"elev": z0, "hUp": h_up, "rise": rise, "valleyAxis": best[1], "valleyAlong": best[2], "valleyAcross": best[3], "valleyDepth": best[0]}

    def slot(self, r, c) -> dict | None:
        """model.ts slotAt: an open cell with a long narrow opening between stands."""
        th = self.m["treeH"]
        if th[r, c] > 0:
            return None
        step, cap, n = 15.0, 300.0, 24
        fetch = []
        for k in range(n):
            f = cap
            for x in np.arange(step, cap + 1, step):
                o = self.offset(r, c, k * step, x)
                if o is None:
                    f = cap
                    break
                if th[o] >= 6:
                    f = x
                    break
            fetch.append(f / step)
        half = n // 2
        k0, long = 0, -1
        for k in range(half):
            l = fetch[k] + fetch[k + half]
            if l > long:
                long, k0 = l, k
        kp = (k0 + half // 2) % half
        across = fetch[kp] + fetch[kp + half]
        wall = 0.0
        for k in (kp, kp + half):
            o = self.offset(r, c, k * step, fetch[k] * step)
            hj = float(th[o]) if o is not None else 0.0
            if hj >= 6:
                wall = max(wall, hj)
        if not wall:
            wall = 13.0
        if long < 2.5 * across or across * step >= 6 * wall + 30:
            return None
        return {"axis": k0 * step, "width": across * step, "wall": wall, "long": long * step}


# ---------------------------------------------------------------- PALM

def palm_at(lat, lon) -> dict | None:
    """PALM's stable Searchmont run (10 m, 2.5 h) at the cell, and the 10-minute
    neutral test for contrast: the floor's share of time reversed, its head
    speed, where its mean and its gusts come from."""
    from pyproj import Transformer

    out = {}
    for run in ("searchmont_stable", "searchmont_neutral_t20"):
        f = PALM / f"{run}.npz"
        if not f.exists():
            continue
        z = np.load(f, allow_pickle=False)
        meta = json.loads(str(z["meta"]))
        x, y = Transformer.from_crs(4326, meta["epsg"], always_xy=True).transform(lon, lat)
        x0, y0, x1, y1 = meta["bounds"]
        if not (x0 <= x < x1 and y0 <= y < y1):
            continue
        r, c = int((y1 - y) // meta["cell"]), int((x - x0) // meta["cell"])
        g = meta["gridConvergenceDeg"]
        amb = meta["ambient"]["speedKph"]
        u, v = float(z["uHead"][0, r, c]), float(z["vHead"][0, r, c])
        rec = {
            "run": run,
            "ambientKph": amb,
            "headKph": math.hypot(u, v) * amb,
            "headFrom": (from_of(u, v) + g) % 360,
            "reversedShare": float(z["reversedHead"][0, r, c]),
            "turnFromAmbient": wrap180((from_of(u, v) + g) - meta["ambient"]["fromTrue"]),
        }
        if "gustFromHead" in z.files:
            rec["gustFrom"] = float(z["gustFromHead"][0, r, c])
            rec["gustKph"] = float(z["gustHead"][0, r, c]) * amb
        out[run] = rec
    return out or None


# ---------------------------------------------------------------- build

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--pull", action="store_true", help="pull the D1 checks again first")
    args = ap.parse_args()
    RAW.mkdir(parents=True, exist_ok=True)
    if args.pull or not (RAW / "checks.raw.json").exists():
        pull_d1()
    checks = load_d1() + load_gpx()
    join_replays(checks)
    grids = {a: Grids(a) for a in AREAS}

    # one archive fetch per area-point (HRDPS is 2.5 km; 0.02 deg rounding)
    by_pt: dict[tuple, list[dict]] = {}
    for c in checks:
        by_pt.setdefault((round(c["lat"] / 0.02) * 0.02, round(c["lon"] / 0.02) * 0.02), []).append(c)
    for (la, lo), cs in by_pt.items():
        ts = [c["ts"] for c in cs]
        d0 = (datetime.fromtimestamp(min(ts) / 1000, timezone.utc) - timedelta(days=9)).date().isoformat()
        d1 = datetime.fromtimestamp(max(ts) / 1000, timezone.utc).date().isoformat()
        j = fetch_profile(la, lo, d0, d1)
        for c in cs:
            c["_prof"] = profile_at(j, c["ts"])

    out = []
    for c in checks:
        area = next(a for a, g in grids.items() if g.contains(c["lat"], c["lon"]))
        g = grids[area]
        r, col = g.cell(c["lat"], c["lon"])
        p = c.pop("_prof")
        el, az = sun_position(c["ts"], c["lat"], c["lon"])
        ss = sunset_ms(c["ts"], c["lat"], c["lon"])
        lay = layering(p)
        lay_est = pasquill(p["cloud_cover"] or 50, p["wind_speed_10m"], el)
        local = datetime.fromtimestamp(c["ts"] / 1000, TZ)
        fsrc = c["forecastSrc"]
        if c["forecastDir"] is None:
            # the GPX saved no forecast: the archive's HRDPS 10 m at the point and minute
            c["forecastDir"], c["forecastKmh"], fsrc = p["wind_direction_10m"], p["wind_speed_10m"], "archive"
        gust = p["wind_gusts_10m"]
        rec = dict(c)
        rec.update(
            {
                "area": area,
                "place": place_of(c["lat"], c["lon"]),
                "local": local.strftime("%Y-%m-%d %H:%M"),
                "forecastSrc": fsrc,
                "archiveDir10": p["wind_direction_10m"],
                "archiveKmh10": p["wind_speed_10m"],
                "archiveDir80": p["wind_direction_80m"],
                "archiveKmh80": p["wind_speed_80m"],
                "t2": p["temperature_2m"],
                "t80": p["temperature_80m"],
                "sw": p["shortwave_radiation"] or 0.0,
                "cloud": p["cloud_cover"] if p["cloud_cover"] is not None else 50.0,
                "gf": min(3.0, max(1.0, gust / p["wind_speed_10m"])) if gust and p["wind_speed_10m"] > 0.5 else 1.0,
                "waterC": water_temp(c["ts"], p["t2mean7"]),
                "sunEl": el,
                "sunAz": az,
                "minFromSunset": (c["ts"] - ss) / 60_000 if math.isfinite(ss) else None,
                **lay,
                "pasquillStable": lay_est["stable"],
                "pasquillConvective": lay_est["convective"],
                "cell": [r, col],
                "solver": g.solver,
                "katDir": g.bearing_band("katDir", r, col),
                "katSpd": g.band("katSpd", r, col),
                "pool": g.band("pool", r, col),
                "thSlope": g.band("thSlope", r, col),
                "thAspect": g.bearing_band("thAspect", r, col),
                "onshore": g.bearing_band("onshore", r, col),
                "shoreDist": g.band("shoreDist", r, col),
                "breezeMax": g.band("breezeMax", r, col),
                "rel": g.band("rel", r, col),
                "canopy": g.band("canopy", r, col),
                "treeH": g.band("treeH", r, col),
                "water": g.band("water", r, col) if "water" in g.m else 0.0,
                "lidNeutral": [[g.band("nUe", r, col), g.band("nVe", r, col)], [g.band("nUn", r, col), g.band("nVn", r, col)]],
                "lidStable": [[g.band("sUe", r, col), g.band("sVe", r, col)], [g.band("sUn", r, col), g.band("sVn", r, col)]],
                "momentum": g.momentum(r, col),
                "momentumTurb": g.turb(r, col),
                "momentumDirs": g.dirs,
                "spreadRef": (g.h.get("model", {}).get("momentum") or {}).get("spreadRef"),
                "landform": g.landforms[int(g.hab["landform"][r, col])] if g.landforms else "",
                "cover": g.covers[int(g.hab["cover"][r, col])] if g.covers else "",
                "terrain": g.terrain(r, col),
                "slot": g.slot(r, col),
                "palm": palm_at(c["lat"], c["lon"]) if area == "searchmont" else None,
            }
        )
        out.append(rec)

    # the treetops near each felt check: seen checks within 1 km, by minutes apart
    for rec in out:
        rec["seenNear"] = [
            {"id": s["id"], "dirFrom": s["dirFrom"], "seen": s["seen"], "minApart": (rec["ts"] - s["ts"]) / 60_000, "m": metres(rec["lat"], rec["lon"], s["lat"], s["lon"])}
            for s in out
            if s["seen"] and s is not rec and s["dirFrom"] is not None and metres(rec["lat"], rec["lon"], s["lat"], s["lon"]) <= 1000 and abs(rec["ts"] - s["ts"]) <= 90 * 60_000
        ]
    out.sort(key=lambda r: r["ts"])
    (RAW / "params.json").write_text(json.dumps(out, indent=1, default=float), encoding="utf-8")
    n_seen = sum(1 for r in out if r["seen"])
    print(f"{len(out)} checks ({sum(r['set'] == 'd1' for r in out)} D1, {sum(r['set'] == 'gpx' for r in out)} GPX; {n_seen} seen) -> {RAW / 'params.json'}")


if __name__ == "__main__":
    main()
