"""The fast SD pass, the sd-wind job (docs/REQUESTS.md, docs/SD-FAST.md):
an area's ground wind and nothing else, from national data, in minutes.

    py -3.14 pipeline/sd_wind.py --area <id> [--no-tta] [--device cpu]

  1. habitat_lite.py   cover, stands and lakes from the land cover and SCANFI
                       (the rasters step's MRDEM and land cover windows come
                       with it, rasters.fetch)
  2. the wide MRDEM    the region and 4.5 km more, for the net's domain (the
                       dem step's window is cut for map tiles and can fall
                       short of it)
  3. build_windsd.py   the net, 16 directions
  4. build_microclimate.py --wind sd --habitat <the lite grid>
                       -> micro-<id>.hab in the area's out folder

Every map picture streams (the app draws them from Mapterhorn and the live
services), so this is the whole of what the area needs to open with its
ground wind. The full pass (sd-full) follows: the vectors and stands, the
real habitat grid, going, the bush, and micro again on them.

Each step runs in its own process (area.py reads --area at import), with
the same environment, so HUNTAPP_AREAS_DIR and HUNTAPP_OUT carry through.
A summary of the steps' times goes to <out>/sd-wind.json.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
WIDE_PAD_M = 4500


def run(name: str, argv: list[str], times: dict) -> None:
    t = time.time()
    print(f"-- {name}: {' '.join(argv[1:])}", flush=True)
    rc = subprocess.call(argv, cwd=ROOT, env=os.environ | {"PYTHONIOENCODING": "utf-8"})
    times[name] = round(time.time() - t, 1)
    if rc:
        raise SystemExit(f"{name} exited {rc}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--area", required=True)
    ap.add_argument("--no-tta", action="store_true", help="the net once per direction, not its eight-way average (CPU: 8x faster)")
    ap.add_argument("--device", default=None, help="cuda or cpu (default: cuda where there is one)")
    args = ap.parse_args()
    py = sys.executable
    a = ["--area", args.area]
    times: dict[str, float] = {}
    t0 = time.time()

    run("habitat-lite", [py, str(HERE / "habitat_lite.py"), *a], times)

    # the wide MRDEM, read here wide enough for the net (build_dem's own read is cut for tiles)
    wide = (
        f"import sys, math; sys.argv = ['x'] + sys.argv[1:]; sys.path.insert(0, {str(HERE)!r})\n"
        "import build_dem\n"
        "from common import REGION\n"
        f"pad = {WIDE_PAD_M}\n"
        "lat = (REGION['south'] + REGION['north']) / 2\n"
        "dlat, dlon = pad / 110574, pad / (111320 * math.cos(math.radians(lat)))\n"
        "build_dem.fetch_mrdem('mrdem-wide', (REGION['west'] - dlon, REGION['south'] - dlat, REGION['east'] + dlon, REGION['north'] + dlat), 1)\n"
    )
    run("mrdem-wide", [py, "-c", wide, *a], times)

    windsd = [py, str(HERE / "build_windsd.py"), *a] + ([] if args.no_tta else ["--tta"]) + (["--device", args.device] if args.device else [])
    run("wind-sd", windsd, times)

    import area as _a  # noqa: F401  (for the paths: after the steps, so its --area parse sees ours)
    lite = _a.CACHE_DIR / f"habitat-lite-{args.area}.hab"
    run("micro", [py, str(HERE / "build_microclimate.py"), *a, "--wind", "sd", "--habitat", str(lite)], times)

    times["total"] = round(time.time() - t0, 1)
    out = _a.OUT_DIR / "sd-wind.json"
    out.write_text(json.dumps({"area": args.area, "seconds": times, "tta": not args.no_tta}, indent=1), encoding="utf-8")
    print(f"sd-wind {args.area}: {times}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
