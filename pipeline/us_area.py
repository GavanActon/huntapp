"""A US area end to end, the standard way (Gavan, 2026-10-24: "a standardized
process ... each location we write adaptors for becomes something we can
re-use"): the area file, every download, the staged rasters, the bake.

    py -3.14 pipeline/us_area.py --lat 43.7868 --lon -85.2374 --jurisdiction MI --sd [--name "Evart"] [--id evart]
    py -3.14 pipeline/us_area.py --lat 43.96765 --lon -85.70444 --jurisdiction MI --name Luther   # HD: 1 m, point cloud, WindNinja

In order, each step skipped when its result is there:
  1. bake_area.py --new (the area file; US states get the US adapters, --sd no LiDAR or cloud)
  2. us_fetch.py (3DEP tiles, NLCD, LANDFIRE, NHDPlus; the cloud for HD)
  3. us_terrain.py (the 30 m stage; the 1 m core for HD)
  4. us_stage.py (land cover and stands as the national layers)
  5. bake_area.py --area (vectors, forest, dem, hillshade, contours, habitat, going, the SD wind …)
  6. HD: wind_finish.py is the next command (WindNinja's sixteen directions), printed at the end
A state the vectors adapter has no services for (us_vectors.py SERVICES) gets the national
fallbacks: TIGER roads, PAD-US public land, no hunting unit (name the zone by hand).
The name: --name, else the nearest GNIS populated place or lake (us_names.py) if that is
wired, else the id. The id: --id, else from the name.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
PY = [sys.executable]


def run(cmd: list[str]) -> None:
    print("$ " + " ".join(cmd), flush=True)
    rc = subprocess.call(cmd, cwd=str(ROOT))
    if rc:
        raise SystemExit(f"step failed ({rc}): {' '.join(cmd[-4:])}")


def slug(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return s or "spot"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--lat", type=float, required=True)
    ap.add_argument("--lon", type=float, required=True)
    ap.add_argument("--jurisdiction", required=True, help="the state's two letters (MI)")
    ap.add_argument("--name")
    ap.add_argument("--id")
    ap.add_argument("--sd", action="store_true", help="SD: the 30 m ground and the surrogate wind, no LiDAR, cloud or WindNinja")
    ap.add_argument("--radius-km", type=float, default=3.2, help="HD: point-cloud tiles within this of the spot")
    ap.add_argument("--core-km", type=float, help="the core's half-width, km (default: Pickle Lake's)")
    ap.add_argument("--region-km", type=float, help="the region's half-width, km")
    ap.add_argument("--from", dest="start", choices=["new", "fetch", "terrain", "stage", "bake"], default="new")
    args = ap.parse_args()
    name = args.name or f"Spot {args.lat:.3f} {args.lon:.3f}"
    aid = args.id or slug(name)
    area_file = ROOT / "app" / "src" / "areas" / f"{aid}.json"
    order = ["new", "fetch", "terrain", "stage", "bake"]
    todo = order[order.index(args.start) :]

    if "new" in todo and not area_file.exists():
        cmd = PY + [str(HERE / "bake_area.py"), "--new", "--lat", str(args.lat), "--lon", str(args.lon), "--name", name, "--jurisdiction", args.jurisdiction.upper(), "--id", aid, "--stage", aid]
        if args.sd:
            cmd.append("--sd")
        if args.core_km:
            cmd += ["--core-km", str(args.core_km)]
        if args.region_km:
            cmd += ["--region-km", str(args.region_km)]
        run(cmd)
    elif "new" in todo:
        print(f"{area_file.name} is there already")
    a = json.loads(area_file.read_text(encoding="utf-8"))
    sd = args.sd or (a.get("bake") or {}).get("wind") == "sd"

    if "fetch" in todo:
        run(PY + [str(HERE / "us_fetch.py"), "--area", aid] + (["--sd"] if sd else ["--radius-km", str(args.radius_km)]))
    if "terrain" in todo:
        run(PY + [str(HERE / "us_terrain.py"), "--area", aid] + (["--only", "wide"] if sd else []))
    if "stage" in todo:
        run(PY + [str(HERE / "us_stage.py"), "--area", aid])
    if "bake" in todo:
        run(PY + [str(HERE / "bake_area.py"), "--area", aid])
    print(f"\n{name} ({aid}): {'SD area baked' if sd else 'baked through the vector tiles'}.")
    if not sd:
        print(f"the wind next: py -3.14 pipeline/wind_finish.py --area {aid}")
    print(f"then: commit app/src/areas/{aid}.json and app/public/data/areas/{aid}/ before the push (the dev build syncs R2 from the commit), and app/scripts/deploy-dev.ps1")
    return 0


if __name__ == "__main__":
    sys.exit(main())
