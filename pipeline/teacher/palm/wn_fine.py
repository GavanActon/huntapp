r"""WindNinja finer than 30 m (Gavan, 2026-10-16: "Can't we fool wind ninja into giving it higher density data
then scale down?" ... "Yea. I want better."). WindNinja isn't tuned to 30 m: HD's bake feeds it the 30 m
MRDEM and asks for ~31 m ground cells (build_windcfd.py). This is the test before spending days on it:

  - the momentum solve on the Pickle slot's 1 m LiDAR DTM averaged to 10 m (slot10), against the production
    HD solve (the 30 m MRDEM; the two nearest of its 16 directions blended, as the app does);
  - round the slot's PALM box plus build_windcfd's 2.5 km inflow buffer;
  - at the 8 neutral directions PALM ran there;
  - scored against PALM's 10 m wind (fields/pickle-slot_<run>_4m.npz u10, v10) over the box's core: the
    turn from each model's own ambient, cell by cell.

    py -3.14 pipeline/teacher/palm/wn_fine.py kit      # writes the test kit, \\XEVO\windcfd2\wntest
    py -3.14 pipeline/teacher/palm/wn_fine.py score    # once xonix has run it (a queue job, run-test.ps1)

The test kit is apart from the main one, so XEVO's watching WindNinja runners and xonix's drain file
leave it alone. Its run.ps1 is the main kit's with the output resolution read from meta.json (outM).
"""

from __future__ import annotations

import argparse
import json
import math
import re
import shutil
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
KIT = ROOT / "pipeline" / "raw" / "windcfd"
TEST = KIT / "wntest"
FIELDS = ROOT / "pipeline" / "raw" / "teacher" / "palm" / "fields"
HRDEM = "https://canelevation-dem.s3.ca-central-1.amazonaws.com/hrdem-lidar/ON-SPL_ON_White_Lake_UTM16_2021-1m-dtm.tif"
BUFFER_M = 2500.0  # build_windcfd.BUFFER_M
SPEED_KPH = 22.0
# PALM's neutral runs at the slot (build_case.py pickle-slot), the direction each was forced from
RUNS = {"n000": 0.0, "ne045": 45.0, "s135": 135.0, "s160": 160.0, "s186": 186.0, "sw225": 225.0, "w270": 270.0, "nw315": 315.0}
VARIANTS = {"slot10": 10.0}
# the baseline is the production HD solve (build_windcfd.py: the 30 m MRDEM, ~31 m cells, every 22.5 deg); a
# 30 m run of this small box cannot be had (WindNinja's smallest mesh gives ~19 m cells here)
HD = KIT / "pickle-lake"


def mesh_count(dx: float, dy: float, dz: float, target: float) -> tuple[int, float, int]:
    """build_windcfd.mesh_count, copied (importing build_windcfd parses --area): the smallest WindNinja mesh
    count whose ground cells are no bigger than target. Returns (count, resolution, ground cells)."""
    bdz = max(0.1 * max(dx, dy), dz + 0.1 * dz)
    volume = dx * dy * 0.95 * bdz
    for count in range(100_000, 40_000_000, 2_000):
        side = (volume / (0.5 * count)) ** (1 / 3)
        lowest = int(dx / side) * int(dy / side)
        refined, rounds = 0, 0
        while refined < 0.5 * count:
            add = lowest * 8
            refined += add - lowest
            lowest = add // 2
            rounds += 1
        res = side / (rounds * 2.0)
        if res <= target:
            return count, res, lowest
    raise ValueError("no mesh count reaches the target resolution")


def box() -> tuple[int, list[float]]:
    c = json.loads((HERE / "pickle-slot" / "case-4m.json").read_text(encoding="utf-8"))
    return int(c["epsg"]), [float(v) for v in c["bounds"]]


def read_dtm(epsg: int, b: list[float], cell: float) -> np.ndarray:
    """The 1 m LiDAR DTM averaged onto a cell-sized grid in the case's UTM, north row first; gaps filled."""
    import rasterio
    from rasterio.enums import Resampling
    from rasterio.transform import from_origin
    from rasterio.vrt import WarpedVRT
    from scipy import ndimage

    w, s, e, n = b[0] - BUFFER_M, b[1] - BUFFER_M, b[2] + BUFFER_M, b[3] + BUFFER_M
    cols, rows = int(round((e - w) / cell)), int(round((n - s) / cell))
    tr = from_origin(w, n, cell, cell)
    with rasterio.open(HRDEM) as src:
        with WarpedVRT(src, crs=f"EPSG:{epsg}", transform=tr, width=cols, height=rows, resampling=Resampling.average,
                       src_nodata=src.nodata, nodata=np.nan, dtype="float32") as vrt:
            z = vrt.read(1).astype(np.float32)
    bad = ~np.isfinite(z)
    if bad.mean() > 0.02:
        raise SystemExit(f"the LiDAR covers only {100 * (1 - bad.mean()):.1f}% of the {cell:g} m domain")
    if bad.any():
        idx = ndimage.distance_transform_edt(bad, return_distances=False, return_indices=True)
        z = z[tuple(idx)]
    return z, tr


def write_kit() -> None:
    import rasterio

    epsg, b = box()
    TEST.mkdir(parents=True, exist_ok=True)
    for name, cell in VARIANTS.items():
        z, tr = read_dtm(epsg, b, cell)
        d = TEST / name
        d.mkdir(exist_ok=True)
        with rasterio.open(d / "dem.tif", "w", driver="GTiff", width=z.shape[1], height=z.shape[0], count=1, dtype="float32",
                           crs=f"EPSG:{epsg}", transform=tr, compress="deflate") as dst:
            dst.write(z, 1)
        dx, dy = z.shape[1] * cell, z.shape[0] * cell
        count, res, ground = mesh_count(dx, dy, float(z.max() - z.min()), cell + 1.0)
        meta = dict(area=name, epsg=epsg, bounds=[tr.c, tr.f - dy, tr.c + dx, tr.f], cols=z.shape[1], rows=z.shape[0],
                    meshCount=count, groundCellM=round(res, 1), groundCells=ground, speedKph=SPEED_KPH,
                    directions=sorted(set(RUNS.values())), priority=0, outM=cell,
                    why="wn_fine.py: WindNinja at 10 m against 30 m on the same LiDAR DTM, scored against PALM at the Pickle slot")
        (d / "meta.json").write_text(json.dumps(meta, indent=1), encoding="utf-8")
        print(f"{name}: {z.shape[1]} x {z.shape[0]} cells of {cell:g} m, relief {z.max() - z.min():.0f} m, mesh count {count} -> {res:.1f} m ground cells")
    # the runner, its output resolution from meta.json (main kit: 30 m fixed)
    t = (KIT / "run.ps1").read_text(encoding="utf-8")
    t = t.replace("Speed = [double]$a.Meta.speedKph;", "Speed = [double]$a.Meta.speedKph; OutM = $(if ($a.Meta.outM) { [double]$a.Meta.outM } else { 30.0 });")
    t = t.replace("'ascii_out_resolution = 30.0',", "\"ascii_out_resolution = $($j.OutM)\",")
    t = t.replace("'goog_out_resolution = 30.0',", "\"goog_out_resolution = $($j.OutM)\",")
    t = t.replace("$zip = Join-Path $kit 'windninja-app.zip'", "$zip = Join-Path (Split-Path $kit) 'windninja-app.zip'  # the main kit's (wntest sits in it)")
    if t.count("$j.OutM") != 2 or "OutM = " not in t:
        raise SystemExit("run.ps1 changed: the output resolution lines were not found")
    (TEST / "run.ps1").write_text(t, encoding="utf-8")
    print(f"kit -> {TEST}")


def score() -> None:
    """Each variant's turn from its own ambient against PALM's, over the PALM box's core, by direction."""
    from scipy.ndimage import map_coordinates

    epsg, b = box()
    print("variant  run     cells  median |turn - PALM's|  within 10 / 20 deg   (PALM's own turn: median |turn|)")
    for run, d in RUNS.items():
        f = FIELDS / f"pickle-slot_{run}_4m.npz"
        z = np.load(f, allow_pickle=True)
        meta = json.loads(str(z["meta"]))
        amb = meta["ambient"]["fromTrue"]
        gam = meta.get("gridConvergenceDeg", 0.0)
        u, v = z["u10"][0], z["v10"][0]
        core = z["core"] & z["valid"]
        # PALM's turn: the way it blows toward against its ambient's (true bearings; grid +gamma)
        tow = (np.degrees(np.arctan2(u, v)) + gam) % 360
        p_turn = (tow - (amb + 180) % 360 + 540) % 360 - 180
        cell = meta["cell"]
        x0, y1 = meta["bounds"][0], meta["bounds"][3]
        rr, cc = np.nonzero(core)
        xs, ys = x0 + (cc + 0.5) * cell, y1 - (rr + 0.5) * cell
        for name in [*VARIANTS, "hd30"]:
            got = grids(name, d)
            if got is None:
                print(f"{name:8s} {run:6s} not run yet")
                continue
            U, V, hu = got
            # the ascii grid: lower-left corner, north row first
            col = (xs - hu["xllcorner"]) / hu["cellsize"] - 0.5
            row = (hu["yllcorner"] + hu["nrows"] * hu["cellsize"] - ys) / hu["cellsize"] - 0.5
            uu = map_coordinates(U, [row, col], order=1)
            vv = map_coordinates(V, [row, col], order=1)
            w_tow = (np.degrees(np.arctan2(uu, vv)) + gam) % 360  # UTM grid north to true
            w_turn = (w_tow - (d + 180) % 360 + 540) % 360 - 180
            diff = np.abs((w_turn - p_turn[rr, cc] + 540) % 360 - 180)
            print(f"{name:8s} {run:6s} {diff.size:6d}  {np.median(diff):6.1f}               "
                  f"{100 * (diff <= 10).mean():4.0f}% / {100 * (diff <= 20).mean():4.0f}%   ({np.median(np.abs(p_turn[rr, cc])):.1f})")


def grids(name: str, d: float):
    """u, v and the ascii header for a direction: the test's own run, or HD's two nearest blended."""
    def one(root: Path, dd: float):
        f = root / f"d{dd:05.1f}"
        uf, vf = sorted(f.glob("*_u.asc")), sorted(f.glob("*_v.asc"))
        if not uf or not vf:
            return None
        U, h = read_asc(uf[0])
        V, _ = read_asc(vf[0])
        return U, V, h
    if name != "hd30":
        return one(TEST / name, d)
    lo = math.floor(d / 22.5) * 22.5 % 360
    hi = (lo + 22.5) % 360
    w = (d % 22.5) / 22.5
    a, b = one(HD, lo), one(HD, hi) if w > 0 else None
    if a is None or (w > 0 and b is None):
        return None
    if w == 0:
        return a
    return (1 - w) * a[0] + w * b[0], (1 - w) * a[1] + w * b[1], a[2]


def read_asc(p: Path) -> tuple[np.ndarray, dict]:
    hdr = {}
    with open(p, encoding="ascii") as fh:
        for _ in range(6):
            k, val = fh.readline().split()
            hdr[k.lower()] = float(val)
        a = np.loadtxt(fh, dtype=np.float32)
    hdr["nrows"] = int(hdr["nrows"])
    return a, hdr


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("cmd", choices=["kit", "score"])
    a = ap.parse_args()
    write_kit() if a.cmd == "kit" else score()
    return 0


if __name__ == "__main__":
    sys.exit(main())
