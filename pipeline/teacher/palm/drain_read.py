"""Does the floor drain or follow the wind? PALM's head-height direction against the downslope way and
the downwind way, per run, for the drainage fade (model.ts setThermalTune: the slope's mixS0/mixSScale
and the flat's mix0/mixScale, docs/SCENT-TESTSET.md's question table).

    py -3.14 pipeline/teacher/palm/drain_read.py pickle-bogs_dawn175_4m lacbailey-spot_d326_4m_scent ...
    py -3.14 pipeline/teacher/palm/drain_read.py --stable            # every stable run in fields/

Per run, from fields/<run>.npz alone (no app, no forecast archive):
- the box's core cells, slope (over --slope degrees, from PALM's own 4 m ground, smoothed over
  --smooth m) and flat (under 2 degrees); downwind is the box's ambient way, downslope the fall line;
- on slopes, only cells where the two ways part by 60 degrees or more (a fall line along the wind
  says nothing): the share of head-height ways nearer the fall line than the wind ("drains"), the
  share within 45 degrees of each, the median turn off the wind toward the fall line, by head speed;
- on the flat, the median turn off the wind and the share within 45 of it (no fall line to speak of);
- at the scent test points of the run's box (testset.json), the head way, the fall line, the wind.
The forcing table's forecast-equivalent 10 m (testset.json "forcing") is printed beside the ambient,
so the curve is read in the app's units.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from scipy import ndimage as ndi

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import palm_to_fields as P  # noqa: E402

FIELDS = HERE.parents[2] / "pipeline" / "raw" / "teacher" / "palm" / "fields"


def wrap(a):
    return (np.asarray(a) + 180) % 360 - 180


def read(run: str, slope_min: float, smooth_m: float, ts: dict) -> dict:
    fd = P.load_field(run)
    m = fd["meta"]
    cell = float(m["cell"])
    dem = fd["dem"].astype(float)
    k = max(1, int(round(smooth_m / cell / 2)))
    dems = ndi.uniform_filter(dem, size=2 * k + 1, mode="nearest")
    gr, gc = np.gradient(dems, cell)
    # row 0 north: the fall line's toward-bearing (grid) from -grad, east -dz/dx = -gc, north -dz/dy = +gr
    fall_to = (np.degrees(np.arctan2(-gc, gr)) + 360) % 360
    slope = np.degrees(np.arctan(np.hypot(gr, gc)))
    uH, vH = fd["uHead"][0], fd["vHead"][0]
    # every way on the grid (the field's u, v and the ground share it); true only for the printout
    gam = float(m.get("gridConvergenceDeg", 0.0))
    head_to = (np.degrees(np.arctan2(uH, vH)) + 360) % 360
    spd = np.hypot(uH, vH)
    amb_from = float(fd["directions"][0])
    wind_to = (float(m["ambient"]["fromGrid"]) + 180) % 360
    core = fd["core"].astype(bool) if "core" in fd else np.ones_like(spd, bool)
    valid = core & np.isfinite(spd)
    off_wind = wrap(head_to - wind_to)
    off_fall = wrap(head_to - fall_to)
    part = np.abs(wrap(fall_to - wind_to))
    sl = valid & (slope >= slope_min) & (part >= 60) & (spd > 0.02)
    flat = valid & (slope < 2) & (spd > 0.02)
    out = dict(run=run, stability=m.get("stability"), ambient=round(float(fd["ambientKph"]), 1), amb_from=round(amb_from),
               forcing=(ts.get("forcing") or {}).get(run, {}).get("kph"), slope_cells=int(sl.sum()), flat_cells=int(flat.sum()))
    if sl.any():
        drains = np.abs(off_fall[sl]) < np.abs(off_wind[sl])
        # the turn off the wind toward the fall line, signed so toward is positive
        toward = np.sign(wrap(fall_to - wind_to))[sl] * off_wind[sl]
        out["slope"] = dict(drains=round(float(drains.mean()), 3), within45_wind=round(float((np.abs(off_wind[sl]) <= 45).mean()), 3),
                            within45_fall=round(float((np.abs(off_fall[sl]) <= 45).mean()), 3), turn_toward_fall=round(float(np.median(toward)), 1),
                            by_speed={f"{lo}-{hi}": round(float(drains[(spd[sl] >= lo) & (spd[sl] < hi)].mean()), 3) if ((spd[sl] >= lo) & (spd[sl] < hi)).any() else None
                                      for lo, hi in ((0, 0.15), (0.15, 0.3), (0.3, 0.6), (0.6, 9))})
    if flat.any():
        out["flat"] = dict(within45_wind=round(float((np.abs(off_wind[flat]) <= 45).mean()), 3), median_turn=round(float(np.median(off_wind[flat])), 1))
    # the box's scent test points
    box = next((b for b, v in ts.get("boxes", {}).items() if run.startswith(b + "_")), None)
    pts = []
    sj = FIELDS / f"{run}_scent.json"
    if box and sj.exists():
        src = json.loads(sj.read_text(encoding="utf-8"))["sources"]
        x0, y0 = m["bounds"][0], m["bounds"][1]
        for pid, p in ts["points"].items():
            if p["box"] != box or p["h"] > 2:
                continue
            s = next((v for v in src.values() if v["source"]["name"].startswith(p["source"])), None)
            if not s:
                continue
            r = int((m["bounds"][3] - (y0 + s["source"]["y"])) / cell)
            c = int(s["source"]["x"] / cell)
            if 0 <= r < dem.shape[0] and 0 <= c < dem.shape[1]:
                pts.append(dict(pid=pid, head_from=round(float((head_to[r, c] + 180 + gam) % 360)), head_kmh=round(float(spd[r, c] * 3.6), 2),
                                fall_to=round(float((fall_to[r, c] + gam) % 360)), slope=round(float(slope[r, c]), 1),
                                off_wind=round(float(off_wind[r, c])), off_fall=round(float(off_fall[r, c]))))
    out["points"] = pts
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("runs", nargs="*")
    ap.add_argument("--stable", action="store_true", help="every stable run in fields/")
    ap.add_argument("--slope", type=float, default=5.0)
    ap.add_argument("--smooth", type=float, default=24.0, help="m: the ground's smoothing before the fall line")
    ap.add_argument("--json")
    a = ap.parse_args()
    ts = json.loads((HERE / "testset.json").read_text(encoding="utf-8"))
    runs = list(a.runs)
    if a.stable:
        for f in sorted(FIELDS.glob("*.npz")):
            n = f.stem
            if n.endswith(("_particles", "_appcone")) or "_scent_" in n or n.startswith("searchmont"):
                continue
            try:
                with np.load(f, allow_pickle=True) as z:
                    if "meta" in z.files and json.loads(str(z["meta"])).get("stability") == "stable":
                        runs.append(n)
            except Exception:
                continue
    res = []
    for r in dict.fromkeys(runs):
        o = read(r, a.slope, a.smooth, ts)
        res.append(o)
        s, f = o.get("slope", {}), o.get("flat", {})
        print(f"{r:36s} amb {o['ambient']:4.1f} (fcst {o['forcing'] if o['forcing'] is not None else '-':>4}) from {o['amb_from']:3d} | "
              f"slope n {o['slope_cells']:5d}: drains {s.get('drains', float('nan')):.2f}, within45 wind {s.get('within45_wind', float('nan')):.2f} / fall {s.get('within45_fall', float('nan')):.2f}, "
              f"turn toward fall {s.get('turn_toward_fall', float('nan')):5.1f} | flat n {o['flat_cells']:5d}: within45 wind {f.get('within45_wind', float('nan')):.2f}, turn {f.get('median_turn', float('nan')):5.1f}")
        if s.get("by_speed"):
            print(f"{'':36s} drains by head speed (m/s): {s['by_speed']}")
        for p in o["points"]:
            print(f"{'':36s} {p['pid']:4s} head from {p['head_from']:3d} {p['head_kmh']:4.2f} km/h, slope {p['slope']:4.1f} fall to {p['fall_to']:3d}: off wind {p['off_wind']:4d}, off fall {p['off_fall']:4d}")
    if a.json:
        Path(a.json).write_text(json.dumps(res, indent=1), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
