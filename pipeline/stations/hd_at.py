"""The HD wind at the stations it covers: WindNinja's own momentum solve
(the teacher, terrain only, neutral; docs/SURROGATE.md) read at every
collected station inside one of its 36 boxes (the five areas, Whitefish
Lake, the 30 seed sites), and scored beside the SD net on the same hours.

    py -3.14 pipeline/stations/hd_at.py [--run seed2-all] [--margin 1000]

For each box (pipeline/raw/surrogate/<id>.npz: u, v for the 16 directions
on the kit's 30 m grid, in the grid's axes, in units of the 22 km/h ambient;
meta: epsg, bounds, gridConvergenceDeg), each station more than --margin m
inside it on a solved cell gets WindNinja's response at its cell, turned to
true north (surrogate_at.to_true_north), the format surrogate_at.py writes.
Then the scoreboard's measures over the station-hours (score.py: the reading
on the hour, quality 100) for:
  - HRDPS alone;
  - HRDPS through HD, as the app's HD bands carry it (no speed damping);
  - HRDPS through the SD net (surrogate-<run>.json), damped 0.6 as the SD
    bake ships it, and undamped.
Direction where the station measured 5 km/h or more; speed both ways, as
score.py does (the 5 km/h hours) and over every hour, calms included
((call + 1) / (measured + 1), correct.py).

The net trained on these very boxes, so its column here is in-sample: it
says how closely the net copies its teacher at instruments, not how it
does somewhere new (score.py's headline is that).

Writes pipeline/raw/stations/hd-at-stations.json and hd-score.md.
"""

from __future__ import annotations

import argparse
import csv
import gzip
import json
import math
import sys
from pathlib import Path

import numpy as np
from pyproj import Transformer

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from score import MIN_KMH, OUT, load_obs, sd_call  # noqa: E402
from surrogate_at import to_true_north  # noqa: E402

FIELDS = HERE.parent / "raw" / "surrogate"


def boxes() -> list[Path]:
    return sorted(p for p in FIELDS.glob("*.npz") if not p.name.startswith(("baseline-", "pred-")))


def hd_responses(stations: dict, margin: float) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for p in boxes():
        z = np.load(p, allow_pickle=False)
        meta = json.loads(str(z["meta"]))
        x0, y0, x1, y1 = meta["bounds"]
        cell = float(meta.get("cell", 30.0))
        tr = Transformer.from_crs(4326, int(meta["epsg"]), always_xy=True)
        valid = z["valid"]
        R, C = valid.shape
        hits = []
        for sid, s in stations.items():
            x, y = tr.transform(s["lon"], s["lat"])
            if not (x0 + margin <= x <= x1 - margin and y0 + margin <= y <= y1 - margin):
                continue
            r, c = int((y1 - y) / cell), int((x - x0) / cell)
            if 0 <= r < R and 0 <= c < C and valid[r, c]:
                hits.append((sid, r, c))
        if not hits:
            continue
        u, v = z["u"], z["v"]
        g = float(meta.get("gridConvergenceDeg", 0.0))
        for sid, r, c in hits:
            tu, tv = to_true_north(u[:, r, c].astype(np.float64), v[:, r, c].astype(np.float64), g)
            out[sid] = {"box": p.stem, "u": [round(float(a), 4) for a in tu], "v": [round(float(a), 4) for a in tv]}
        print(f"  {p.stem}: {len(hits)} station(s) · {', '.join(stations[h[0]].get('name') or h[0] for h in hits)}", flush=True)
    return out


def summary(rows: list[dict], key: str) -> dict | None:
    vane = [r for r in rows if r["obsSpd"] >= MIN_KMH]
    if len(vane) < 30:
        return None
    miss = np.array([abs((r[f"{key}Dir"] - r["obsDir"] + 180) % 360 - 180) for r in vane])
    rv = np.array([r[f"{key}Spd"] / r["obsSpd"] for r in vane])
    ra = np.array([(r[f"{key}Spd"] + 1) / (r["obsSpd"] + 1) for r in rows])
    return {"n": len(vane), "hours": len(rows), "dir45": float(100 * np.mean(miss <= 45)), "dirMed": float(np.median(miss)),
            "spd2": float(100 * np.mean((rv >= 0.5) & (rv <= 2))), "spdMed": float(np.median(rv)),
            "spd2All": float(100 * np.mean((ra >= 0.5) & (ra <= 2))), "spdMedAll": float(np.median(ra))}


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--run", default="seed2-all")
    ap.add_argument("--margin", type=float, default=1000.0, help="m inside a box's edge (its buffer is 2.5 km)")
    args = ap.parse_args()
    stations = json.loads((OUT / "stations.json").read_text(encoding="utf-8"))
    print(f"{len(stations)} stations against {len(boxes())} WindNinja boxes", flush=True)
    hd = hd_responses(stations, args.margin)
    (OUT / "hd-at-stations.json").write_text(json.dumps(hd))
    sur = json.loads((OUT / f"surrogate-{args.run}.json").read_text())
    obs = load_obs()
    methods = {"hrdps": "HRDPS", "hd": "HD (WindNinja)", "sd": "SD net, damped 0.6", "sdRaw": "SD net, undamped"}
    per: dict[str, list[dict]] = {sid: [] for sid in hd if sid in sur}
    for p in sorted((OUT / "hrdps").glob("hrdps-2*.csv.gz")):
        with gzip.open(p, "rt", encoding="utf-8") as fh:
            for r in csv.DictReader(fh):
                sid = r["id"]
                if sid not in per:
                    continue
                o = obs.get((sid, r["t"][:13]))
                if not o:
                    continue
                fdir, fspd = float(r["dir"]), float(r["spd"])
                row = {"obsDir": o[0], "obsSpd": o[1], "hrdpsDir": fdir, "hrdpsSpd": fspd}
                row["hdDir"], row["hdSpd"] = sd_call(hd[sid], fdir, fspd, 1.0)
                row["sdDir"], row["sdSpd"] = sd_call(sur[sid], fdir, fspd, 0.6)
                row["sdRawDir"], row["sdRawSpd"] = sd_call(sur[sid], fdir, fspd, 1.0)
                per[sid].append(row)
    rows = [r for rs in per.values() for r in rs]

    def line(label: str, rs: list[dict]) -> list[str]:
        out = []
        for k, name in methods.items():
            s = summary(rs, k)
            if s:
                out.append(f"| {label} | {name} | {s['n']:,} / {s['hours']:,} | {s['dir45']:.0f}% | {s['dirMed']:.0f}° | "
                           f"{s['spd2']:.0f}% · ×{s['spdMed']:.2f} | {s['spd2All']:.0f}% · ×{s['spdMedAll']:.2f} |")
        return out

    head = ["| station | call | hours (5 km/h+ / all) | dir within 45° | median miss | speed within ×2 · median, 5 km/h+ hours | the same, every hour |",
            "|---|---|---|---|---|---|---|"]
    md = [f"# The HD wind at the stations inside its boxes (net {args.run})", "",
          f"{len(per)} stations more than {args.margin:.0f} m inside one of the {len(boxes())} WindNinja boxes, "
          f"{len(rows):,} station-hours. The SD net trained on these boxes: its rows are in-sample.", "",
          "## All of them together", "", *head, *line("all", rows), "", "## Station by station", "", *head]
    for sid, rs in sorted(per.items(), key=lambda kv: hd[kv[0]]["box"]):
        md += line(f"{(stations[sid].get('name') or sid)} ({hd[sid]['box']})", rs)
    text = "\n".join(md)
    print(text)
    (OUT / "hd-score.md").write_text(text + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
