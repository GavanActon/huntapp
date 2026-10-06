"""The momentum solve: WindNinja's conservation of mass and momentum solver
(OpenFOAM, RNG k-epsilon) run over the area for 16 wind directions, for the
ground wind's neutral terrain layer (build_microclimate.py, MICRO-WIND.md §2).

Checked against WindNinja on 10 km tiles at Lac Bailey and Pickle Lake
(2026-10-04): no lid or smoothing of the 2D mass-consistent layer comes near
the momentum solver (turn r <= 0.55), while its fields are converged at 300
iterations, the same pattern at 8 km/h as at 22, and interpolate between
directions 45° apart to 2.5° (median). So it is solved once per direction,
at one speed, and the app turns and blends the two nearest.

The runs are long (an hour or more a direction at 31 m on a laptop), so
they go through a kit folder any machine can work from: the DEM per area, a
job per (area, direction), and windcfd/run.ps1, which claims the next job
nobody has claimed, runs it, and keeps the u and v grids. Share the kit's
folder on the home network and start run.ps1 on as many machines as you
like; one takes the list from the front, another with -Reverse from the
back. The kit wants windninja-app.zip beside run.ps1 for a machine without
WindNinja: the CLI folder of the 4.0.0 Windows release, which carries its
own OpenFOAM 2.2 (unpacked from the installer with 7-Zip, no install).

    py -3.14 pipeline/build_windcfd.py prepare --area lac-bailey
    py -3.14 pipeline/build_windcfd.py collect --area lac-bailey

prepare: <kit>/<area>/dem.tif (MRDEM 30 m in UTM over the core and 2.5 km
         round it, so the inflow settles before it reaches the core) and
         meta.json (the mesh count for ~31 m cells at the ground).
collect: the finished directions resampled onto the habitat lattice, as
         unit vectors per regional 10 m wind: raw/windcfd-<region>.npz,
         which build_microclimate.py reads. With them, from the runs since
         2026-10-05 (job folders t<dir>), the turbulence: WindNinja's most
         velocity fluctuation in the lowest 10 m (its turbulence output, a
         GeoTIFF beside the Google Earth file, COLMAX_HEIGHT_AGL=10), per
         regional 10 m wind, as s<dir>. Left out until all 16 have it.

The kit is WINDCFD_KIT, else pipeline/raw/windcfd.
"""

from __future__ import annotations

import json
import math
import os
import shutil
import sys
from pathlib import Path

import numpy as np
import rasterio
from pyproj import Transformer
from rasterio.transform import Affine, from_origin
from rasterio.warp import Resampling, reproject

import build_habitat as hb
from area import cached
from common import REGION

KIT = Path(os.environ.get("WINDCFD_KIT", Path(__file__).resolve().parent / "raw" / "windcfd"))
HERE = Path(__file__).resolve().parent
# every 22.5°: 45° apart interpolates to 2.5° median, 8.5° p90; this halves it
DIRECTIONS = [k * 22.5 for k in range(16)]
SPEED_KPH = 22.0  # the pattern is the same at any speed (8 and 22 km/h checked)
BUFFER_M = 2500.0
CELL_M = 30.0
# the checks ran at WindNinja's fine mesh on a 10 km tile, 31 m at the
# ground; at 85 m the wall at the Lac Bailey pin was lost (-5° against -9°)
GROUND_CELL_M = 31.0


def mesh_count(dx: float, dy: float, dz: float, target: float = GROUND_CELL_M) -> tuple[int, float, int]:
    """The smallest mesh count WindNinja turns into ground cells no bigger
    than target: its own sizing (NinjaFoam::SetMeshResolutionAndResampleDem),
    cubes filling a box 0.1 of the domain tall, half the count for them and
    half for rounds of refinement at the ground, the resolution the cube's
    side over twice the rounds. Returns (count, resolution, ground cells)."""
    bdz = max(0.1 * max(dx, dy), dz + 0.1 * dz)
    volume = dx * dy * 0.95 * bdz
    for count in range(100_000, 10_000_000, 2_000):
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


def utm_epsg() -> int:
    lon = (REGION["west"] + REGION["east"]) / 2
    lat = (REGION["south"] + REGION["north"]) / 2
    return (32600 if lat >= 0 else 32700) + int((lon + 180) // 6) + 1


def area_dir() -> Path:
    return KIT / REGION["id"]


def prepare() -> None:
    epsg = utm_epsg()
    tr = Transformer.from_crs("EPSG:4326", f"EPSG:{epsg}", always_xy=True)
    xs, ys = tr.transform(
        [REGION["west"], REGION["east"], REGION["west"], REGION["east"]],
        [REGION["south"], REGION["south"], REGION["north"], REGION["north"]],
    )
    x0 = math.floor((min(xs) - BUFFER_M) / CELL_M) * CELL_M
    x1 = math.ceil((max(xs) + BUFFER_M) / CELL_M) * CELL_M
    y0 = math.floor((min(ys) - BUFFER_M) / CELL_M) * CELL_M
    y1 = math.ceil((max(ys) + BUFFER_M) / CELL_M) * CELL_M
    cols, rows = int((x1 - x0) / CELL_M), int((y1 - y0) / CELL_M)
    z = np.load(cached(f"mrdem-wide-{REGION['id']}.npz"), allow_pickle=True)
    dst = np.full((rows, cols), -9999, np.float32)
    dst_t = from_origin(x0, y1, CELL_M, CELL_M)
    reproject(
        z["data"].astype(np.float32), dst,
        src_transform=Affine(*z["transform"][:6]), src_crs=str(z["crs"]), src_nodata=float(z["nodata"]),
        dst_transform=dst_t, dst_crs=f"EPSG:{epsg}", dst_nodata=-9999, resampling=Resampling.bilinear,
    )
    holes = int((dst == -9999).sum())
    if holes:
        raise SystemExit(f"the wide MRDEM leaves {holes} cells of the domain empty: fetch it wider first")
    out = area_dir()
    out.mkdir(parents=True, exist_ok=True)
    with rasterio.open(out / "dem.tif", "w", driver="GTiff", height=rows, width=cols, count=1, dtype="float32",
                       crs=f"EPSG:{epsg}", transform=dst_t, nodata=-9999, compress="deflate") as d:
        d.write(dst, 1)
    area_m2 = (x1 - x0) * (y1 - y0)
    mesh, res, ground = mesh_count(x1 - x0, y1 - y0, float(dst.max() - dst.min()))
    meta = {"area": REGION["id"], "epsg": epsg, "bounds": [x0, y0, x1, y1], "cols": cols, "rows": rows,
            "meshCount": mesh, "groundCellM": round(res, 1), "groundCells": ground, "speedKph": SPEED_KPH, "directions": DIRECTIONS}
    (out / "meta.json").write_text(json.dumps(meta, indent=1))
    for f in ("run.ps1", "start-runners.ps1", "README.txt"):
        shutil.copy(HERE / "windcfd" / f, KIT / f)
    print(f"{REGION['id']}: {cols}×{rows} cells of {CELL_M:.0f} m in EPSG:{epsg}, "
          f"{area_m2 / 1e6:.0f} km², mesh count {mesh}: {ground} cells of {res:.1f} m at the ground · {out}")


def read_asc(path: Path) -> tuple[dict, np.ndarray]:
    with open(path) as f:
        hdr = {}
        for _ in range(6):
            k, v = f.readline().split()
            hdr[k.lower()] = float(v)
        a = np.loadtxt(f, dtype=np.float32)
    return hdr, a


def collect() -> None:
    meta = json.loads((area_dir() / "meta.json").read_text())
    tr = Transformer.from_crs("EPSG:4326", f"EPSG:{meta['epsg']}", always_xy=True)
    rr, cc = np.mgrid[0:hb.ROWS, 0:hb.COLS]
    lon = hb.W + (cc + 0.5) * hb.D_LON
    lat = hb.N - (rr + 0.5) * hb.D_LAT
    x, y = tr.transform(lon, lat)
    bands: dict[str, np.ndarray] = {}
    done = []
    turb = []
    for d in meta["directions"]:
        # t<dir>: the runs with the turbulence (2026-10-05 on); d<dir>: the
        # first pass, u and v only, still read where a t run is not in yet
        job = area_dir() / f"t{d:05.1f}"
        if not (job / "done.txt").exists():
            job = area_dir() / f"d{d:05.1f}"
        us, vs = sorted(job.glob("*_u.asc")), sorted(job.glob("*_v.asc"))
        if not us or not vs:
            continue
        hdr, u = read_asc(us[0])
        _, v = read_asc(vs[0])
        cs = hdr["cellsize"]
        x0, ytop = hdr["xllcorner"], hdr["yllcorner"] + hdr["nrows"] * cs
        # bilinear on cell centres
        fc = (x - x0) / cs - 0.5
        fr = (ytop - y) / cs - 0.5
        c0 = np.clip(np.floor(fc).astype(int), 0, u.shape[1] - 2)
        r0 = np.clip(np.floor(fr).astype(int), 0, u.shape[0] - 2)
        tx = np.clip(fc - c0, 0, 1)
        ty = np.clip(fr - r0, 0, 1)

        def at(a: np.ndarray) -> np.ndarray:
            return ((a[r0, c0] * (1 - tx) + a[r0, c0 + 1] * tx) * (1 - ty)
                    + (a[r0 + 1, c0] * (1 - tx) + a[r0 + 1, c0 + 1] * tx) * ty)

        # in units of the regional 10 m wind, as the mass-consistent basis is
        bands[f"u{d:05.1f}"] = (at(u) / meta["speedKph"]).astype(np.float32)
        bands[f"v{d:05.1f}"] = (at(v) / meta["speedKph"]).astype(np.float32)
        done.append(d)
        # the turbulence: the most velocity fluctuation in the lowest 10 m,
        # km/h, on a lon/lat grid of its own (WindNinja's Google Earth side)
        ks = sorted(job.glob("*colMax*.tif"))
        if ks:
            with rasterio.open(ks[0]) as src:
                k = src.read(1).astype(np.float32)
                # 0 is outside the solve: the UTM domain's corners in the lon/lat grid
                bad = ~np.isfinite(k) | (k <= 0) | ((k == src.nodata) if src.nodata is not None else False)
                k[bad] = np.nan
                kc, kr = ~src.transform * (lon, lat)
            kc0 = np.clip(np.floor(kc - 0.5).astype(int), 0, k.shape[1] - 2)
            kr0 = np.clip(np.floor(kr - 0.5).astype(int), 0, k.shape[0] - 2)
            tx = np.clip(kc - 0.5 - kc0, 0, 1)
            ty = np.clip(kr - 0.5 - kr0, 0, 1)
            ks_ = ((k[kr0, kc0] * (1 - tx) + k[kr0, kc0 + 1] * tx) * (1 - ty)
                   + (k[kr0 + 1, kc0] * (1 - tx) + k[kr0 + 1, kc0 + 1] * tx) * ty)
            ks_ = np.where(np.isfinite(ks_), ks_, np.nanmedian(k))
            bands[f"s{d:05.1f}"] = (ks_ / meta["speedKph"]).astype(np.float32)
            turb.append(d)
    missing = [d for d in meta["directions"] if d not in done]
    if missing:
        raise SystemExit(f"{REGION['id']}: {len(missing)} directions not run yet: {missing}")
    if turb and len(turb) < len(done):
        # all or nothing, as the browser reads it: a half set is dropped
        print(f"  turbulence for only {len(turb)}/{len(done)} directions: left out until the rest are in")
        for d in turb:
            del bands[f"s{d:05.1f}"]
    out = cached(f"windcfd-{REGION['id']}.npz")
    np.savez_compressed(out, directions=np.array(done, np.float32), **bands)
    sp = np.hypot(bands[f"u{done[0]:05.1f}"], bands[f"v{done[0]:05.1f}"])
    tn = f" · turbulence {np.percentile(bands[f's{done[0]:05.1f}'], 50):.2f} of the regional wind (median)" if f"s{done[0]:05.1f}" in bands else " · no turbulence"
    print(f"{REGION['id']}: {len(done)} directions onto {hb.COLS}×{hb.ROWS} · speed {np.percentile(sp, 5):.2f}–{np.percentile(sp, 95):.2f} of the regional wind{tn} · {out}")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "prepare"
    {"prepare": prepare, "collect": collect}[cmd]()
