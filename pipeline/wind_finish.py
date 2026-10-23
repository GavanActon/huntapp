"""Finish an area's wind, end to end: whatever is missing is made, then it waits
for WindNinja and bakes the grids.

    py -3.14 pipeline/wind_finish.py --area luther            # start this machine's runners, wait, finish
    py -3.14 pipeline/wind_finish.py --area luther --reverse  # this machine takes the job list from the back
    py -3.14 pipeline/wind_finish.py --area luther --no-runners   # only wait and finish (another machine solves)
    py -3.14 pipeline/wind_finish.py --area luther --dry      # say what it would do

In order:
  1. the wide DEM cache (bake_area.py --only dem) and the kit's dem.tif and
     meta.json (build_windcfd.py prepare), if either is missing;
  2. every drain-<machine>.txt in the kit is lifted (a runner stops at one),
     and this machine's runners are started unless --no-runners or a
     WindNinja is already running here;
  3. a wait, a line a minute, until every direction's done.txt is there;
  4. build_windcfd.py collect, then bake_area.py --only wind-sd --only micro
     --only micro-sd --only coverage, and the checklist's warnings.
The kit is WINDCFD_KIT, else pipeline/raw/windcfd; on a machine that sees
it over the network, point WINDCFD_KIT at the share.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
KIT = Path(os.environ.get("WINDCFD_KIT", HERE / "raw" / "windcfd"))
PY = [sys.executable]


def run(cmd: list[str], dry: bool) -> int:
    print("  $ " + " ".join(cmd), flush=True)
    if dry:
        return 0
    return subprocess.call(cmd, cwd=str(ROOT))


def windninja_running() -> bool:
    try:
        out = subprocess.run(["tasklist", "/FI", "IMAGENAME eq WindNinja_cli.exe"], capture_output=True, text=True, timeout=30).stdout
        return "WindNinja_cli.exe" in out
    except Exception:  # noqa: BLE001
        return False


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--area", required=True)
    ap.add_argument("--reverse", action="store_true", help="this machine's runners take the job list from the back")
    ap.add_argument("--no-runners", action="store_true", help="do not start runners here: only wait and finish")
    ap.add_argument("--dry", action="store_true")
    args = ap.parse_args()
    a = args.area
    area_dir = KIT / a
    t0 = time.time()
    print(f"{a}: the kit is {KIT}")

    # 1. what the solve needs
    if not (HERE / "raw" / f"mrdem-wide-{a}.npz").exists():
        print("the wide DEM cache is missing: the dem step makes it")
        if run(PY + [str(HERE / "bake_area.py"), "--area", a, "--only", "dem"], args.dry):
            return 1
    if not (area_dir / "meta.json").exists() or not (area_dir / "dem.tif").exists():
        print("the kit has no DEM for the area: preparing it")
        if run(PY + [str(HERE / "build_windcfd.py"), "prepare", "--area", a], args.dry):
            return 1
    meta = json.loads((area_dir / "meta.json").read_text(encoding="utf-8")) if (area_dir / "meta.json").exists() else {"directions": [k * 22.5 for k in range(16)]}
    dirs = [float(d) for d in meta["directions"]]
    job = lambda d: area_dir / f"t{d:05.1f}"  # noqa: E731  (run.ps1 Job-Dir: t000.0, t022.5 …)

    # 2. runners
    for drain in KIT.glob("drain-*.txt"):
        print(f"lifting {drain.name} ({drain.read_text(encoding='utf-8', errors='replace').strip()[:80]})")
        if not args.dry:
            drain.unlink()
    if not args.no_runners:
        if windninja_running():
            print("a WindNinja is running here already: not starting more runners")
        else:
            cmd = ["powershell", "-ExecutionPolicy", "Bypass", "-File", str(KIT / "start-runners.ps1")] + (["-Reverse"] if args.reverse else [])
            if run(cmd, args.dry):
                print("  (the runners did not start; the wait goes on in case another machine solves)")

    # 3. the wait
    last = None
    while True:
        done = [d for d in dirs if (job(d) / "done.txt").exists()]
        claimed = [d for d in dirs if d not in done and job(d).exists() and any(job(d).glob("claim-*.txt"))]
        state = (len(done), len(claimed))
        if state != last:
            who = sorted({p.name.split("-")[1] for d in claimed for p in job(d).glob("claim-*.txt")})
            print(f"  {time.strftime('%H:%M')} · {len(done)}/{len(dirs)} directions done, {len(claimed)} under way{' on ' + ', '.join(who) if who else ''}", flush=True)
            last = state
        if len(done) == len(dirs) or args.dry:
            break
        time.sleep(60)
    if args.dry:
        print("  (dry: would wait here for every direction's done.txt)")

    # 4. the grids
    steps = [
        PY + [str(HERE / "build_windcfd.py"), "collect", "--area", a],
        PY + [str(HERE / "bake_area.py"), "--area", a, "--only", "wind-sd", "--only", "micro", "--only", "micro-sd", "--only", "coverage"],
    ]
    for cmd in steps:
        if run(cmd, args.dry):
            print("  failed: see the log above")
            return 1
    print(f"{a}: the wind is in ({(time.time() - t0) / 60:.0f} min). Next: the area's folder to R2 and the build (docs/SD-HD-PLAN.md Hosting).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
