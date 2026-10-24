"""An SD area made HD in place (Gavan, 2026-10-24: "start with the SD bake, get
that, then we push the HD when it's completed"): the same id, the same box,
the HD layers added on top and the wind solved.

    py -3.14 pipeline/hd_upgrade.py --area sd-ddia6sn2in            # a request's pack (raw/requests)
    py -3.14 pipeline/hd_upgrade.py --area emerald-lake --compiled   # an area in app/src/areas
    py -3.14 pipeline/hd_upgrade.py --area <id> --no-wind            # everything but WindNinja
    py -3.14 pipeline/hd_upgrade.py --area <id> --dry                # say what it would do

In order:
  1. the area file turned HD: bake.lidar (us3dep for a US state; the HRDEM search for Canada,
     refused where no LiDAR was flown), the point cloud adapter where there is one (3DEP; Ontario's
     FRI leaf-on; Quebec's MRNF), bake.wind "sd" dropped (WindNinja's grid becomes micro, the
     surrogate's micro-sd beside it), the HD files listed (hillshadeLidar, contours, lanes), and a
     note of the upgrade (bake.upgraded)
  2. US: us_fetch.py (the 1 m tiles and the LAZ within --radius-km), us_terrain.py core
  3. bake_area.py --only hillshade dem contours pointcloud vegstructure habitat profile bush going
     vector-tiles: the SD files these steps wrote are replaced, the rest (vectors, forest, stands)
     stay as they were
  4. wind_finish.py: the kit prepared, this machine's runners started, the sixteen directions
     awaited, collected, the HD and SD wind grids and the coverage baked
  5. the publish, which depends on where the area lives: a pack goes back up through the agent
     (agent.py --reship <id>, once the Worker takes an "hd" report); a compiled area is committed
     and deployed (app/scripts/deploy-dev.ps1). Printed, not done here.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
PY = [sys.executable]
REQ = HERE / "raw" / "requests"
US_STATES = set("AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC".split())
POINTCLOUD_BY = {"ON": "on.fri_leafon", "QC": {"adapter": "qc.mrnf_laz"}}
HD_PMTILES = ["hillshadeLidar", "contours", "lanes"]
STEPS = ["hillshade", "dem", "contours", "pointcloud", "vegstructure", "habitat", "profile", "bush", "going", "vector-tiles"]


def run(cmd: list[str], env: dict, dry: bool) -> None:
    print("$ " + " ".join(cmd), flush=True)
    if dry:
        return
    rc = subprocess.call(cmd, cwd=str(ROOT), env=env)
    if rc:
        raise SystemExit(f"step failed ({rc}): {' '.join(cmd[-4:])}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--area", required=True)
    ap.add_argument("--compiled", action="store_true", help="the area is one of the app's (app/src/areas), not a request's pack")
    ap.add_argument("--radius-km", type=float, default=3.2, help="US: point-cloud tiles within this of the spot")
    ap.add_argument("--no-wind", action="store_true", help="stop before WindNinja")
    ap.add_argument("--dry", action="store_true")
    args = ap.parse_args()
    aid = args.area
    if args.compiled:
        path = ROOT / "app" / "src" / "areas" / f"{aid}.json"
        env = {k: v for k, v in os.environ.items() if k not in ("HUNTAPP_AREA", "HUNTAPP_AREAS_DIR", "HUNTAPP_OUT")}
    else:
        path = REQ / "areas" / f"{aid}.json"
        env = {**os.environ, "HUNTAPP_AREAS_DIR": str(REQ / "areas"), "HUNTAPP_OUT": str(REQ / "out" / aid)}
    env |= {"PYTHONIOENCODING": "utf-8", "PYTHONUNBUFFERED": "1"}
    if not path.exists():
        raise SystemExit(f"no area file {path}")
    a = json.loads(path.read_text(encoding="utf-8"))
    bake = a.setdefault("bake", {})
    j = str(a.get("jurisdiction") or "")
    us = j in US_STATES
    if bake.get("wind") != "sd" and bake.get("lidar") not in ("none",) and not bake.get("upgraded"):
        print(f"{aid} is not an SD area (bake.wind {bake.get('wind')!r}, bake.lidar {bake.get('lidar')!r}): nothing to upgrade")
        return 0

    # 1. the area file turned HD
    if us:
        bake["lidar"] = "us3dep"
        bake.setdefault("us3dep", {})
        bake["us3dep"].setdefault("stage", aid)
        bake["pointcloud"] = "us.3dep"
        bake.setdefault("habitatBush", "model")  # a 3DEP cloud is flown leaf-off: the model's bush and lanes (docs/US-AREAS.md)
    else:
        bake.pop("lidar", None)  # the bake searches HRDEM; a core with no LiDAR fails the hillshade step and says so
        pc = POINTCLOUD_BY.get(j)
        if pc:
            bake["pointcloud"] = pc
    bake.pop("wind", None)
    files = a.setdefault("files", {})
    for k in HD_PMTILES:
        if k not in files.setdefault("pmtiles", []) and (k != "lanes" or bake.get("pointcloud") or bake.get("habitatBush") == "model"):
            files["pmtiles"].append(k)
    if "micro-sd" not in files.setdefault("grids", []):
        files["grids"].append("micro-sd")
    bake["upgraded"] = {"from": "sd", "at": date.today().isoformat(), "by": "pipeline/hd_upgrade.py"}
    print(f"{a.get('name')} ({aid}, {j}): HD in place{' (US)' if us else ''}; lidar {bake.get('lidar', 'HRDEM')}, point cloud {bake.get('pointcloud')}")
    if not args.dry:
        path.write_text(json.dumps(a, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")

    # 2. the US tiles and the 1 m core
    if us:
        run(PY + [str(HERE / "us_fetch.py"), "--area", aid, "--only", "dem1m,lpc", "--radius-km", str(args.radius_km)], env, args.dry)
        run(PY + [str(HERE / "us_terrain.py"), "--area", aid, "--only", "core", "--force"], env, args.dry)
    # 3. the HD layers
    run(PY + [str(HERE / "bake_area.py"), "--area", aid] + [x for s in STEPS for x in ("--only", s)], env, args.dry)
    # 4. the wind
    if args.no_wind:
        print(f"stopped before the wind: py -3.14 pipeline/wind_finish.py --area {aid}")
    else:
        run(PY + [str(HERE / "wind_finish.py"), "--area", aid], env, args.dry)
    # 5. the publish
    if args.compiled:
        print(f"{aid}: HD baked. Publish: commit app/src/areas/{aid}.json and app/public/data/areas/{aid}/, then app/scripts/deploy-dev.ps1")
    else:
        print(f"{aid}: HD baked in {REQ / 'out' / aid}. Publish: the agent's reship with an hd report (agent.py --reship {aid}) once the Worker takes it")
    return 0


if __name__ == "__main__":
    sys.exit(main())
