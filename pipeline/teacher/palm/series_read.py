r"""Read a PALM series run (build_case.py `series`: the averaged field every avg_s) as a clock: every
window converted with palm_to_fields --slice, then, per window, the head-height wind at the box's test
points and over the whole core against the wind 10 m above and the forcing (Hunter-Jay, 2026-10-17).

  py -3.14 pipeline/teacher/palm/series_read.py pickle-slot pickle-slot_dusk288t_4m --tag 4m
  py -3.14 pipeline/teacher/palm/series_read.py pickle-slot pickle-slot_dusk288t_4m --tag 4m --no-convert   # slices already in fields/series/

Prints, per window: its end time (model minutes), the box's ambient, the share of moving core cells within
45° of the wind above, the still share (head under 0.5 km/h), the reversed share; and at each test point
the head-height direction, how far it sits from the wind above and from the forcing, its speed in km/h,
and whether it is still. The drainage question reads off the table: the window where a point leaves the
wind above by more than 45° and stays, and the one where it goes still.
"""

from __future__ import annotations

import argparse
import json
import math
import subprocess
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
FIELDS = ROOT / "pipeline" / "raw" / "teacher" / "palm" / "fields"
SERIES = FIELDS / "series"
RUNS = ROOT / "pipeline" / "raw" / "windcfd" / "raw" / "teacher" / "palm" / "runs"
STILL_MS = 0.5 / 3.6


def n_slices(run: str, output: Path | None) -> int:
    from netCDF4 import Dataset
    folder = output or (RUNS / run / "OUTPUT")
    hits = sorted(folder.glob(f"{run}_av_3d*.nc"))
    if not hits:
        raise SystemExit(f"no {run}_av_3d*.nc in {folder}")
    with Dataset(hits[-1]) as nc:
        nc.set_auto_mask(False)
        t = np.asarray(nc["time"][:], np.float64)
    # PALM sizes the axis for every planned window; a run that stopped early leaves zeros
    n = 1 if t.size and t[0] > 0 else 0
    while n < t.size and t[n] > t[n - 1]:
        n += 1
    return n


def convert_all(case: str, run: str, tag: str, output: Path | None) -> list[Path]:
    output = output or (RUNS / run / "OUTPUT")   # the share's copy: the local JOBS folder holds inputs only
    n = n_slices(run, output)
    out = []
    print(f"{run}: {n} windows written; converting", flush=True)
    for k in range(n):
        cmd = [sys.executable, str(HERE / "palm_to_fields.py"), "convert", case, run, "--tag", tag, "--slice", str(k), "--output", str(output)]
        p = subprocess.run(cmd, capture_output=True, text=True)
        if p.returncode:
            print(p.stdout[-800:], p.stderr[-800:])
            raise SystemExit(f"slice {k} failed")
        line = [ln for ln in p.stdout.splitlines() if "->" in ln]
        out.append(Path(line[-1].split("->", 1)[1].strip()))
    return out


def wrap(d: np.ndarray | float) -> np.ndarray | float:
    return (d + 180.0) % 360.0 - 180.0


def points_for(box: str, case: str, tag: str, run: str) -> list[dict]:
    """The box's test points (testset.json, keyed by pid, each naming its scent source and height) at the
    source's UTM position from the case json's run entry (name = '<source> <h> m')."""
    ts = json.loads((HERE / "testset.json").read_text(encoding="utf-8"))
    info = json.loads((HERE / case / f"case-{tag}.json").read_text(encoding="utf-8"))
    scent = info["runs"].get(run, {}).get("scent") or next(iter(info["runs"].values())).get("scent") or []
    by_name = {v["name"]: v for v in scent}
    out = []
    for pid, p in ts["points"].items():
        if p.get("box") != box:
            continue
        name = f"{p['source']} m"
        v = by_name.get(name) or by_name.get(p["source"]) or by_name.get(f"{p['source']}.0 m")
        if not v:  # a point named by the source's start ("bay, over the water" for "bay, over the water 30 m S of the shore 1.5 m")
            cands = [x for x in scent if x["name"].startswith(p["source"]) and abs(float(x.get("h", 1.5)) - float(p.get("h", 1.5))) < 0.01]
            v = cands[0] if cands else None
        if not v or "utm" not in v:
            continue
        out.append(dict(pid=pid, x=v["utm"][0], y=v["utm"][1]))
    return out


def read(slices: list[Path], box: str, case: str, tag: str, run: str) -> None:
    pts = points_for(box, case, tag, run)
    first = None
    rows = []
    for f in slices:
        d = np.load(f, allow_pickle=True)
        m = json.loads(str(d["meta"]))
        if first is None:
            first = m
            x0, y0, x1, y1 = m["bounds"]
            dx = m["cell"]
            for p in pts:
                p["c"], p["r"] = int((p["x"] - x0) / dx), int((y1 - p["y"]) / dx)
        gam = m["gridConvergenceDeg"]
        amb = m["ambient"]["speedMs"]
        u, v = d["u"][0], d["v"][0]
        uh, vh = d["uHead"][0], d["vHead"][0]
        core = d["core"] & d["valid"]
        top_dir = np.degrees(np.arctan2(u, v))
        head_dir = np.degrees(np.arctan2(uh, vh))
        head_sp = np.hypot(uh, vh) * amb
        forcing_to = (m["forecast"]["fromTrue"] - gam + 180.0) % 360.0
        turn = wrap(head_dir - top_dir)
        moving = core & (head_sp >= STILL_MS)
        t_min = m["averaged_until_s"] / 60.0
        line = dict(t=t_min, amb=amb * 3.6, within45=float(np.mean(np.abs(turn[moving]) <= 45)) if moving.any() else float("nan"),
                    still=float(np.mean(head_sp[core] < STILL_MS)), reversed=float(np.nanmean(d["reversedHead"][0][core])) if "reversedHead" in d.files else float("nan"))
        # drain_read's question per window: on slopes (>= 3 deg) where the fall line parts from the forcing by 60 deg or
        # more, the moving floor's share within 45 of the fall line (drains) and within 45 of the forcing (wind)
        if first is m:
            dem = d["dem"].astype(np.float64)
            gy, gx = np.gradient(dem, dx)
            gy = -gy
            slope = np.degrees(np.arctan(np.hypot(gx, gy)))
            fall_to = np.degrees(np.arctan2(-gx, -gy))          # toward, grid, clockwise from north
            apart = np.abs(wrap(fall_to - forcing_to))
            slope_cells = core & (slope >= 3.0) & (apart >= 60.0)
        head_to = np.degrees(np.arctan2(uh, vh))
        sm = slope_cells & (head_sp >= STILL_MS)
        line["n_slope"] = int(sm.sum())
        line["drains"] = float(np.mean(np.abs(wrap(head_to[sm] - fall_to[sm])) <= 45)) if sm.any() else float("nan")
        line["wind"] = float(np.mean(np.abs(wrap(head_to[sm] - forcing_to)) <= 45)) if sm.any() else float("nan")
        line["slope_still"] = float(np.mean(head_sp[slope_cells] < STILL_MS)) if slope_cells.any() else float("nan")
        for p in pts:
            r, c = p["r"], p["c"]
            if not (0 <= r < u.shape[0] and 0 <= c < u.shape[1]):
                continue
            sl = (slice(max(0, r - 2), r + 3), slice(max(0, c - 2), c + 3))
            uu, vv = np.nanmean(uh[sl]), np.nanmean(vh[sl])
            hd = (math.degrees(math.atan2(uu, vv)) + gam + 180.0) % 360.0  # FROM, true
            sp = math.hypot(uu, vv) * amb * 3.6
            td = (math.degrees(math.atan2(np.nanmean(u[sl]), np.nanmean(v[sl]))) + gam + 180.0) % 360.0
            line[p["pid"]] = dict(frm=hd, off_top=float(wrap(hd - td)), off_forcing=float(wrap(hd - m["forecast"]["fromTrue"])), kmh=sp,
                                  still=float(np.mean(head_sp[sl] < STILL_MS)))
        rows.append(line)
    pids = [p["pid"] for p in pts if "r" in p]
    print(f"{first['run']}: {len(rows)} windows, forcing from {first['forecast']['fromTrue']:.0f} at {first['forecast']['kph']:g} km/h; "
          f"per point: head FROM (off the wind above / off the forcing) speed km/h, * = mostly still")
    print(f"{'min':>5s} {'amb':>5s} {'w45':>4s} {'still':>5s} {'rev':>4s} | slopes: drain wind still | " + " | ".join(f"{p:^22s}" for p in pids))
    for ln in rows:
        cells = []
        for p in pids:
            q = ln.get(p)
            if not q:
                cells.append(" " * 22)
                continue
            cells.append(f"{q['frm']:3.0f} ({q['off_top']:+4.0f}/{q['off_forcing']:+4.0f}) {q['kmh']:4.1f}{'*' if q['still'] > 0.5 else ' '}")
        print(f"{ln['t']:5.0f} {ln['amb']:5.1f} {ln['within45']:4.0%} {ln['still']:5.0%} {ln['reversed']:4.0%} | "
              f"{ln['drains']:5.0%} {ln['wind']:4.0%} {ln['slope_still']:5.0%} (n {ln['n_slope']:4d}) | " + " | ".join(cells))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("case")
    ap.add_argument("run")
    ap.add_argument("--tag", default="4m")
    ap.add_argument("--output", help="the run's OUTPUT folder (default the share's runs/<run>/OUTPUT)")
    ap.add_argument("--no-convert", action="store_true", help="read the slices already under fields/series/")
    a = ap.parse_args()
    if a.no_convert:
        slices = sorted(SERIES.glob(f"{a.run}_*min.npz"))
    else:
        slices = convert_all(a.case, a.run, a.tag, Path(a.output) if a.output else None)
    if not slices:
        raise SystemExit("no slices")
    read(slices, a.case, a.case, a.tag, a.run)
    return 0


if __name__ == "__main__":
    sys.exit(main())
