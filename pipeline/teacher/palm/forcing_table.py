"""The test set's forecast-equivalent forcing (docs/SCENT-TESTSET.md, v4): the 10 m wind the app is
forced to for each PALM run, in the units the app lives in. PALM's own 10 m ambient (the box's mean at
10 m, in or near the canopy over 12-15 m stands) reads about half a forecast's 10 m for the same air
above (G1: 4.4 against HRDPS's 8.7; dusk288: 1.2 against 5), so every speed threshold scored under it
came out about 2x too strict. huntapp-c4's ruling, 2026-10-16:

- a run that stands for a real hour (REAL below, from its case's why): HRDPS's 10 m speed and
  direction at the case's point for that hour (Open-Meteo historical forecast, gem_hrdps_continental);
- an idealised run: its wind at 80 m (stable runs are forced there; a neutral or convective run's
  neutral log profile through zref, 30 m by default, with z0 1 m as build_case.profile has it) x HRDPS's
  median 10 m / 80 m speed for that stability at the case's point over 1 Sep-15 Oct 2026, the run's own
  direction (PALM has no Coriolis turn, omega 0, so its 10 m and 80 m run the same way).
  Stability by the hour: stable = sun under -6 deg and cloud under 30%; convective = sun over 20 deg and
  cloud under 30%; neutral = cloud over 80%.

    py -3.14 pipeline/teacher/palm/forcing_table.py           # print
    py -3.14 pipeline/teacher/palm/forcing_table.py --write   # into testset.json "forcing"

PALM's ambient stays on the card as a diagnostic, not the forcing.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import build_case as B  # noqa: E402

TESTSET = HERE / "testset.json"
FIELDS = HERE.parents[2] / "pipeline" / "raw" / "teacher" / "palm" / "fields"
API = "https://historical-forecast-api.open-meteo.com/v1/forecast"
VARS = "wind_speed_10m,wind_direction_10m,wind_speed_80m,wind_direction_80m,cloud_cover"
# the hour each real run stands for, UTC (its case's why)
REAL = {
    ("pickle-slot", "dusk288"): "2026-09-28T23:00",
    ("pickle-bogstrip", "dusk288"): "2026-09-28T23:00",
    ("pickle-bogs", "dusk288"): "2026-09-28T23:00",
    ("pickle-bogs", "dawn175"): "2026-09-29T12:00",
    ("pickle-bogs", "nw305"): "2026-10-02T22:00",
    ("pickle-bogstrip", "b190"): "2026-09-29T22:00",
    ("pickle-bogstrip", "b232"): "2026-09-30T22:00",
    ("lacbailey-spot", "d326"): "2026-10-16T00:00",
}


def hourly(lat: float, lon: float, start: str, end: str) -> dict:
    q = f"{API}?latitude={lat:.5f}&longitude={lon:.5f}&start_date={start}&end_date={end}&hourly={VARS}&timezone=GMT&models=gem_hrdps_continental"
    for attempt in range(5):
        try:
            with urllib.request.urlopen(q, timeout=60) as r:
                return json.loads(r.read())["hourly"]
        except Exception:  # noqa: BLE001
            time.sleep(10 * (attempt + 1))
    raise SystemExit(f"HRDPS at {lat},{lon} {start}..{end} did not answer")


def sun_elev(t: datetime, lat: float, lon: float) -> float:
    doy = t.timetuple().tm_yday
    hr = t.hour + t.minute / 60
    g = 2 * math.pi / 365 * (doy - 1 + (hr - 12) / 24)
    decl = 0.006918 - 0.399912 * math.cos(g) + 0.070257 * math.sin(g) - 0.006758 * math.cos(2 * g) + 0.000907 * math.sin(2 * g)
    eqt = 229.18 * (0.000075 + 0.001868 * math.cos(g) - 0.032077 * math.sin(g) - 0.014615 * math.cos(2 * g) - 0.040849 * math.sin(2 * g))
    ha = math.radians(((hr * 60 + eqt + 4 * lon) / 4) - 180)
    la = math.radians(lat)
    return math.degrees(math.asin(math.sin(la) * math.sin(decl) + math.cos(la) * math.cos(decl) * math.cos(ha)))


def ratios(lat: float, lon: float) -> dict:
    """HRDPS's median 10 m / 80 m speed by stability at a point, 1 Sep-15 Oct 2026 (80 m at 5 km/h or more)."""
    h = hourly(lat, lon, "2026-09-01", "2026-10-15")
    out: dict[str, list[float]] = {"stable": [], "neutral": [], "convective": []}
    for t, s10, s80, cc in zip(h["time"], h["wind_speed_10m"], h["wind_speed_80m"], h["cloud_cover"]):
        if None in (s10, s80, cc) or s80 < 5:
            continue
        el = sun_elev(datetime.fromisoformat(t).replace(tzinfo=timezone.utc), lat, lon)
        k = "stable" if el < -6 and cc < 30 else "convective" if el > 20 and cc < 30 else "neutral" if cc > 80 else None
        if k:
            out[k].append(s10 / s80)
    return {k: (round(float(np.median(v)), 3), len(v)) for k, v in out.items() if v}


def wind80(run: dict) -> float:
    """The run's forcing at 80 m, km/h."""
    z = run.get("zref_m", 30.0)
    if z == 80.0:
        return float(run["speed_kph"])
    return float(run["speed_kph"]) * math.log((80 + 1) / 1) / math.log((z + 1) / 1)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--write", action="store_true", help="write the table into testset.json")
    a = ap.parse_args()
    ts = json.loads(TESTSET.read_text(encoding="utf-8"))
    sys.path.insert(0, str(HERE.parents[2] / "app" / "scripts"))
    from palm_compare import runs_all  # the runs palm_compare scores (no app cones, no Searchmont trials)
    runs = sorted({r for b in ts["boxes"].values() for r in b["runs"]} | set(runs_all()))
    cache: dict[str, dict] = {}
    table = {}
    for name in runs:
        case = next((c for c in sorted(B.CASES, key=len, reverse=True) if name.startswith(c + "_")), None)
        if not case:
            continue
        key = name[len(case) + 1:].split("_")[0]
        run = B.CASES[case]["runs"].get(key)
        if not run:
            continue
        lat, lon = B.CASES[case]["point"]
        if (case, key) in REAL:
            t = REAL[(case, key)]
            h = hourly(lat, lon, t[:10], t[:10])
            i = h["time"].index(t)
            table[name] = dict(kph=round(float(h["wind_speed_10m"][i]), 1), **{"from": round(float(h["wind_direction_10m"][i]))},
                               source=f"HRDPS {t[:10]} {t[11:13]}Z", kph80=round(float(h["wind_speed_80m"][i]), 1))
        else:
            if case not in cache:
                cache[case] = ratios(lat, lon)
            st = run.get("stability", "neutral")
            r, n = cache[case].get(st, cache[case].get("neutral", (0.6, 0)))
            table[name] = dict(kph=round(wind80(run) * r, 1), **{"from": round(float(run["direction"]))},
                               source=f"80 m x ratio ({st} {r}, n {n})", kph80=round(wind80(run), 1))
        amb = FIELDS / f"{name}.npz"
        if amb.exists():
            f = np.load(amb, allow_pickle=True)
            table[name]["palmAmbientKph"] = round(float(f["ambientKph"]), 1)
        print(f"{name:40s} {table[name]}", flush=True)
    if a.write:
        # by text, so the file keeps its hand layout: the version, a note, and the table one run a line
        raw = TESTSET.read_text(encoding="utf-8")
        nl = "\r\n" if "\r\n" in raw else "\n"
        s = raw.replace("\r\n", "\n")
        if '"forcing"' in s:
            s = s[: s.index(',\n "forcing"')] + "\n}\n"
        s = s.replace('"version": 3,', '"version": 4,', 1)
        note = ('  "v4 (2026-10-16): the app is forced to a forecast-equivalent 10 m per run (forcing below, '
                'pipeline/teacher/palm/forcing_table.py: HRDPS at the hour a run stands for, else its 80 m wind x HRDPS\'s 10/80 '
                'for the stability), not PALM\'s ambient (palmAmbientKph, a diagnostic); v3 numbers do not compare."')
        if "v4 (2026-10-16)" not in s:
            k = s.rindex('"\n ]\n}')
            s = s[: k + 1] + ",\n" + note + s[k + 1:]
        rows = ",\n".join(f'  {json.dumps(n)}: {json.dumps(v, ensure_ascii=False)}' for n, v in table.items())
        k = s.rindex("\n}")
        s = s[:k] + ',\n "forcing": {\n' + rows + "\n }" + s[k:]
        json.loads(s)
        TESTSET.write_text(s.replace("\n", nl), encoding="utf-8")
        print(f"wrote {len(table)} runs into {TESTSET}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
