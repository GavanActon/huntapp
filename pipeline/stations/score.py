"""The station scoreboard (docs/WIND-LEARNING.md, "Stations"): the wind every
public station measured, hour by hour, against what we would have called
there: HRDPS as the phone has it (hrdps.py), and HRDPS turned and scaled by
the SD terrain wind at the station (surrogate_at.py).

    py -3.14 pipeline/stations/score.py [--run seed2-all]

Each station's reading on the hour (the 10-minute mean ending then where it
has one, else the nearest within 10 minutes), quality flag 100, against the
forecast for that hour. Direction is scored where the station measured
5 km/h or more (an anemometer's vane wanders below that); speed as the
ratio to what was measured. Grouped by the ground round the station
(terrain.py: the relief within 3 km, valley floor or ridge within 1 km),
the sun (night, low sun, day) and the network. A station inside an area the
net trained on is left out of the SD column's headline.

Writes pipeline/raw/stations/score-stations.csv (one row a station) and
score.md (the tables), and prints them.
"""

from __future__ import annotations

import csv
import gzip
import json
import math
import statistics
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

OUT = Path(__file__).resolve().parents[1] / "raw" / "stations"
MIN_KMH = 5.0


def wrap(d: float) -> float:
    return (d + 180) % 360 - 180


def sun_elev(t: datetime, lat: float, lon: float) -> float:
    """NOAA's simple solar position: elevation in degrees, good to a fraction."""
    doy = t.timetuple().tm_yday
    hour = t.hour + t.minute / 60
    g = 2 * math.pi / 365 * (doy - 1 + (hour - 12) / 24)
    decl = 0.006918 - 0.399912 * math.cos(g) + 0.070257 * math.sin(g) - 0.006758 * math.cos(2 * g) + 0.000907 * math.sin(2 * g) - 0.002697 * math.cos(3 * g) + 0.00148 * math.sin(3 * g)
    eqt = 229.18 * (0.000075 + 0.001868 * math.cos(g) - 0.032077 * math.sin(g) - 0.014615 * math.cos(2 * g) - 0.040849 * math.sin(2 * g))
    tst = hour * 60 + eqt + 4 * lon
    ha = math.radians(tst / 4 - 180)
    la = math.radians(lat)
    cz = math.sin(la) * math.sin(decl) + math.cos(la) * math.cos(decl) * math.cos(ha)
    return math.degrees(math.asin(max(-1.0, min(1.0, cz))))


def sd_call(resp: dict, fdir: float, fspd: float, damp: float = 1.0) -> tuple[float, float]:
    """HRDPS through the station's terrain response: the local wind for a unit
    wind from fdir, between the two directions either side, scaled. `damp`
    softens the speed contrast as the SD bake does (build_windsd.py --damp,
    2026-10-11: |V| -> 1 + damp (|V| - 1), the direction untouched)."""
    k = (fdir % 360) / 22.5
    i0 = int(math.floor(k)) % 16
    i1 = (i0 + 1) % 16
    f = k - math.floor(k)
    u = (1 - f) * resp["u"][i0] + f * resp["u"][i1]
    v = (1 - f) * resp["v"][i0] + f * resp["v"][i1]
    return (math.degrees(math.atan2(-u, -v)) + 360) % 360, fspd * (1 + damp * (math.hypot(u, v) - 1))


def load_obs() -> dict[tuple[str, str], tuple[float, float]]:
    """(station, hour) -> (dir, spd): the reading on the hour."""
    best: dict[tuple[str, str], tuple[int, float, float]] = {}
    for p in sorted((OUT / "obs").glob("*/obs-*.csv.gz")):
        with gzip.open(p, "rt", encoding="utf-8") as fh:
            for r in csv.DictReader(fh):
                if r["qa"] not in ("100", ""):
                    continue
                t = r["t"]
                mm = int(t[14:16])
                # the reading nearest the hour, within 10 minutes either side
                if mm <= 10:
                    hour, off = t[:13], mm
                elif mm >= 50:
                    h = datetime.fromisoformat(t[:16]).timestamp() + 3600
                    hour, off = datetime.fromtimestamp(h, timezone.utc).strftime("%Y-%m-%dT%H"), 60 - mm
                else:
                    continue
                rank = off * 2 + (0 if r["avg"] == "10m" else 1)
                key = (r["id"], hour)
                if key not in best or rank < best[key][0]:
                    best[key] = (rank, float(r["dir"]), float(r["spd"]))
    return {k: (v[1], v[2]) for k, v in best.items()}


def summary(rows: list[dict], method: str) -> dict:
    d = [abs(wrap(r[f"{method}Dir"] - r["obsDir"])) for r in rows if r["obsSpd"] >= MIN_KMH]
    sgn = [wrap(r[f"{method}Dir"] - r["obsDir"]) for r in rows if r["obsSpd"] >= MIN_KMH]
    ratio = [r[f"{method}Spd"] / r["obsSpd"] for r in rows if r["obsSpd"] >= MIN_KMH]
    if not d:
        return {}
    return {
        "n": len(d),
        "dir45": 100 * sum(x <= 45 for x in d) / len(d),
        "dirMed": statistics.median(d),
        "bias": float(np.mean(sgn)),
        "spd2": 100 * sum(0.5 <= x <= 2 for x in ratio) / len(ratio),
        "spdMed": statistics.median(ratio),
    }


def line(label: str, rows: list[dict]) -> str:
    """HRDPS on every hour; then HRDPS and the SD terrain on the same hours
    (the stations the net has been run at, none it trained on)."""
    a = summary(rows, "hrdps")
    if not a:
        return ""
    same = [r for r in rows if r.get("sdDir") is not None and not r["inSample"]]
    h, b = summary(same, "hrdps"), summary(same, "sd")
    cells = [label, f"{a['n']:,}", f"{a['dir45']:.0f}% / {a['dirMed']:.0f}°", f"{a['spd2']:.0f}% / ×{a['spdMed']:.2f}"]
    if b:
        cells += [f"{b['n']:,}", f"{h['dir45']:.0f}% → {b['dir45']:.0f}%", f"{h['dirMed']:.0f}° → {b['dirMed']:.0f}°", f"{h['spd2']:.0f}% → {b['spd2']:.0f}%"]
    else:
        cells += ["–", "–", "–", "–"]
    return "| " + " | ".join(cells) + " |"


def main() -> int:
    import argparse

    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--run", default="seed2-all", help="the net whose SD terrain to score (surrogate-<run>.json)")
    ap.add_argument("--damp", type=float, default=0.6, help="the speed-contrast damping the SD bake ships with (build_windsd.py --damp); 1 = the raw net")
    args = ap.parse_args()
    terrain = {r["id"]: r for r in csv.DictReader(open(OUT / "terrain.csv", encoding="utf-8"))}
    stations = json.loads((OUT / "stations.json").read_text(encoding="utf-8"))
    sp = OUT / f"surrogate-{args.run}.json"
    sur = json.loads(sp.read_text()) if sp.exists() else {}
    print(f"SD terrain from {sp.name}: {len(sur)} stations", flush=True)
    obs = load_obs()
    print(f"{len(obs):,} station-hours on the hour", flush=True)
    rows: list[dict] = []
    for p in sorted((OUT / "hrdps").glob("hrdps-*.csv.gz")):
        with gzip.open(p, "rt", encoding="utf-8") as fh:
            for r in csv.DictReader(fh):
                key = (r["id"], r["t"][:13])
                o = obs.get(key)
                if not o:
                    continue
                s = stations.get(r["id"]) or {}
                te = terrain.get(r["id"])
                fdir, fspd = float(r["dir"]), float(r["spd"])
                row = {"id": r["id"], "t": r["t"], "obsDir": o[0], "obsSpd": o[1], "hrdpsDir": fdir, "hrdpsSpd": fspd,
                       "provider": s.get("provider") or "?", "lat": s.get("lat"), "lon": s.get("lon"),
                       "relief": int(te["relief3"]) if te else None, "tpi": int(te["tpi1"]) if te else None,
                       "inSample": bool((sur.get(r["id"]) or {}).get("inSample"))}
                if r["id"] in sur:
                    row["sdDir"], row["sdSpd"] = sd_call(sur[r["id"]], fdir, fspd, args.damp)
                else:
                    row["sdDir"] = row["sdSpd"] = None
                t = datetime.fromisoformat(r["t"].replace("Z", "+00:00"))
                el = sun_elev(t, float(s.get("lat") or 0), float(s.get("lon") or 0))
                row["sun"] = "night" if el < -6 else "low sun" if el < 8 else "day"
                rows.append(row)
    print(f"{len(rows):,} station-hours with a forecast", flush=True)

    def relief_class(r):
        x = r["relief"]
        return "?" if x is None else "flat (<50 m)" if x < 50 else "gentle (50–150 m)" if x < 150 else "hilly (150–400 m)" if x < 400 else "mountain (400 m+)"

    def position(r):
        if r["tpi"] is None or r["relief"] is None or r["relief"] < 150:
            return None
        return "valley floor" if r["tpi"] <= -15 else "ridge" if r["tpi"] >= 15 else "slope"

    head = ("| | hours | HRDPS: dir within 45° / median miss | HRDPS: speed within ×2 / median ratio | hours with SD "
            "| dir within 45°: HRDPS → SD | median miss: HRDPS → SD | speed within ×2: HRDPS → SD |"
            + "\n" + "|---|---|---|---|---|---|---|---|")
    out = ["### All stations", head, line("all", rows)]
    out += ["", "### By the ground round the station", head]
    for k in ("flat (<50 m)", "gentle (50–150 m)", "hilly (150–400 m)", "mountain (400 m+)"):
        out.append(line(k, [r for r in rows if relief_class(r) == k]))
    out += ["", "### Hills and mountains, by position (within 1 km)", head]
    for k in ("valley floor", "slope", "ridge"):
        for sun in (None, "night", "low sun", "day"):
            sel = [r for r in rows if position(r) == k and (sun is None or r["sun"] == sun)]
            out.append(line(k + (f", {sun}" if sun else ""), sel))
    out += ["", "### By the sun, all stations", head]
    for k in ("night", "low sun", "day"):
        out.append(line(k, [r for r in rows if r["sun"] == k]))
    out += ["", "### By network", head]
    for k, n in sorted(defaultdict(int, {p: sum(1 for r in rows if r["provider"] == p) for p in {r["provider"] for r in rows}}).items(), key=lambda kv: -kv[1])[:8]:
        out.append(line(k, [r for r in rows if r["provider"] == k]))
    text = "\n".join(x for x in out if x)
    print(text)
    (OUT / f"score-{args.run}.md").write_text(text + "\n", encoding="utf-8")

    # per station, for the pairs and the worst and best
    per: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        per[r["id"]].append(r)
    with open(OUT / f"score-stations-{args.run}.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["id", "name", "provider", "lat", "lon", "relief3", "tpi1", "n", "hrdps_dir45", "hrdps_dirMed", "hrdps_bias", "hrdps_spdMed", "sd_dir45", "sd_dirMed", "sd_spdMed", "inSample"])
        for sid, rs in sorted(per.items()):
            a = summary(rs, "hrdps")
            b = summary([r for r in rs if r.get("sdDir") is not None], "sd")
            if not a:
                continue
            te = terrain.get(sid) or {}
            w.writerow([sid, (stations.get(sid) or {}).get("name"), rs[0]["provider"], rs[0]["lat"], rs[0]["lon"], te.get("relief3"), te.get("tpi1"), a["n"],
                        round(a["dir45"]), round(a["dirMed"]), round(a["bias"]), round(a["spdMed"], 2),
                        round(b["dir45"]) if b else "", round(b["dirMed"]) if b else "", round(b["spdMed"], 2) if b else "", rs[0]["inSample"]])
    print(f"\nper station: {OUT / f'score-stations-{args.run}.csv'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
