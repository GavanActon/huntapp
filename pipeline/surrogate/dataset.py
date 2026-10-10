"""The training set for a net that stands in for WindNinja's momentum solver
(build_windcfd.py): per kit, the DEM and the 16 finished runs on the
DEM's own 30 m UTM grid, with no resampling between them, so a net can learn
terrain to wind where the runs are and give it where they are not, without
an hour of OpenFOAM a direction.

Beside it, today's SD wind on the same grid: the mass-consistent layer solve
(build_microclimate.solve_basis) the app uses where no momentum run exists,
neutral and stable, so the surrogate is judged against what it would replace.

And the solver's own noise floor. Highland Lake, Lac Bailey and Pickle Lake
were run twice for every direction (the d folders first; the t folders later,
with the turbulence, on other machines and thread counts), Sault for two
directions. Where both are done they are compared over the core: the turn
between the two winds and the gap in their speeds. A surrogate that comes
closer to one run than the two runs come to each other is fitting noise, so
those numbers go in the report for the model's evaluation.

    py -3.14 pipeline/surrogate/dataset.py build --area blanchard-river   # one kit, in either folder
    py -3.14 pipeline/surrogate/dataset.py build --all                    # every kit with all 16 finished
    py -3.14 pipeline/surrogate/dataset.py build --all --check            # read and check every run, write nothing
    py -3.14 pipeline/surrogate/dataset.py baseline --all

Kits. The areas' kits are in pipeline/raw/windcfd (build_windcfd.prepare);
the seed set's (seed.py) are made in pipeline/raw/windcfd-seed and moved into
the shared kit as their runs are queued, so a kit is looked for in both, and
where an id is in both (mid-move) the copy with more directions finished is
read, the shared one on a tie. --all takes every kit with all 16 directions
finished (a t or d job with done.txt and its u and v grids) and lists the
rest as skipped with how many are. The runners keep working while a build
reads, so a kit whose runs change under it (a direction unfinished since
discovery, a grid gone or half written) is skipped with one line and the
reason, the build goes on to the next, and the report's skipped lists both
kinds; --area stops on it instead. Files are written under a temporary name
and renamed, so none is ever left half written. An id is the kit's folder name; the npz
and the report carry the same name whichever folder it came from.

build:    pipeline/raw/surrogate/<area>.npz
            dem         float32 (R, C)      m, the kit's dem.tif; row 0 north, col 0 west
            u, v        float32 (16, R, C)  east, north wind at 10 m / 22 km/h
            turb        float32 (16, R, C)  colMax velocity fluctuation / 22, NaN where none
            directions  float32 (16,)       wind FROM, degrees clockwise from north
            core        bool (R, C)         the cell's centre inside the core: the area
                                            file's box, or with no area file (the seed
                                            kits) the domain inset by 2500 m a side
            valid       bool (R, C)         more than 20 cells from the domain edge
            meta        str, JSON           area, epsg, bounds, cell, the kit folder,
                                            the core and where it came from, the job per
                                            direction, the directions with turbulence,
                                            how the sources were lined up, the grid
                                            convergence, and the kit's seed block if any
          A uniform ambient from d would be u = -sin d, v = -cos d in
          true-north axes; u and v are WindNinja's, along the UTM grid's
          axes (see Grid north). u and v come from the t job where it is
          done, else the d job, as collect() reads them, put on the DEM's
          cell centres (see Lining up).
baseline: pipeline/raw/surrogate/baseline-<area>.npz
            neutral_ue, neutral_ve, neutral_un, neutral_vn,
            stable_ue,  stable_ve,  stable_un,  stable_vn    float32 (R, C)
          (ue, ve) the local wind for a unit wind toward the east, (un, vn)
          for one toward the north, in units of the ambient. The solve is
          linear in the ambient, so a wind from d is
              ex = -sin d, ey = -cos d
              u = ex*ue + ey*un;  v = ex*ve + ey*vn
          Neutral: lid 250 m over terrain smoothed by 100 cells; stable: 50 m
          and 35 cells, as build_microclimate.main() solves them. No roughness
          ratio is put on (s = 1): the app multiplies it in afterwards, while
          WindNinja's runs carry one uniform roughness (vegetation = trees),
          so the baseline's speeds sit near 1 where the runs' sit near 0.9.
both:     pipeline/raw/surrogate/report-dataset.json, each command filling its
          own part of an area's entry.

Lining up. WindNinja's ascii grids (*_u.asc, *_v.asc) carry one row and one
column more than dem.tif, with the same lower-left corner and 30 m cells: the
extra row is at the top (the asc's top edge is 30 m above the DEM's) and the
extra column at the right, so the DEM's grid is asc[1:, :-1]. Every header is
checked against meta.json before it is cropped. The turbulence is a lon/lat
GeoTIFF of its own (WindNinja's Google Earth side), reprojected onto the DEM
grid bilinearly; 0 there is outside the solve.

The crop is right to the cell but not within it. Correlating the mean speed
and turbulence over the 16 directions with the DEM's local relief at sub-cell
shifts (2026-10-09): the turbulence lines up with the DEM in all five areas,
while cell (i, j) of the cropped u/v holds the wind at about the north-east
corner of DEM cell (i, j), half a cell (~21 m) off, as if the ascii header's
corner were 15 m too far south-west. So u and v are put on the cell centres
as the mean of each cell's four corners (on_centres): a half-cell shift east
and north, with a light 2x2 smoothing (the speed's spread drops under 0.5%).
It turns the wind by 0.5° median, 2.8° p90 at Blanchard River.

Checked again after it, with the search shifting by a Fourier phase: a
bilinear shift blurs most at half a cell and drags the peak toward it (on a
synthetic field known to be centred it read +0.375 rows, -0.31 cols). The
peak moved by half a cell in each axis (0.44 to 0.5), and now sits, in
cells, at Pickle Lake (+0.06, -0.125) against the turbulence and (0, -0.125)
against the relief; at Blanchard River (+0.125, 0) against the turbulence
and (+0.31, 0) against the relief, where the untouched turbulence itself
reads (+0.25, +0.06) against the relief. The averaged values are off the
runs' 0.01 km/h steps, so the files compress less (Pickle 60 to 74 MB).

build_windcfd.py's collect() still reads the grids as their headers say, so
the app's momentum bands carry the original offset, ~21 m south-west of the
terrain.

Grid north. WindNinja's u and v are along the UTM grid's east and north,
which are turned from true north by the meridian convergence g: grid north
lies g clockwise of true north (positive east of the zone's central
meridian; at the domain centre about +1.06° at Pickle Lake, +1.82° at Sault,
-1.51° at Blanchard River). So "u = -sin d, v = -cos d" for a wind from d
holds in true-north axes only; in the file's grid axes the ambient is
u = -sin(d - g), v = -cos(d - g). The runs bear it out: the median flow at
Pickle and Sault turns from the true-north ambient by about -g. The data
are not rotated here; the training code turns them from the epsg and the
bounds. g at the domain centre (pyproj) is in meta and the report.

Turbulence. Two runs finishing at once on one machine can collide on
WindNinja's fixed-name scratch file (colMax_10mColHeightAGL_raw_proj.tif), so
a job can end with done.txt and good u and v but another run's turbulence.
Three checks per direction, and a grid that fails any is left out (its slab
NaN, the reason in meta's turbulenceDropped and the report): its bounds must
be the kit's domain (colmax_fit: within a cell short and 3 over; clean runs
sit at -0.4 to +1, another kit's misses by kilometres), it must cover 99% of
the valid cells (clean ones cover all; whitefish-lake t067.5 was written for
its top 98 rows of 517 only), and its turbulence must follow its own flow (turbulence_owner: the Pearson r with each
direction's speed; it is taken for another run's when some other
direction's r beats its own by more than SWAP_MARGIN). On the six kits
finished by 2026-10-09 the own direction is the best match in every
direction, by 0.064 to 0.168 over the best other, always a neighbour, and by
0.16 or more over any direction further off; filing one run's turbulence
under another direction is caught in every pair 45° or more apart, and in
all 192 neighbouring pairs at the margin of 0.05 (170 at 0.1). The
failed-, stuck- and stopped- notes runners leave beside earlier attempts go
in the report for the record; a job is finished by its done.txt and grids.

The core is exact: each cell centre is taken back to lon/lat and tested
against the box, since over a core's width a parallel bends by several
metres in UTM and the box is turned by the grid convergence.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import date
from pathlib import Path

import numpy as np
import rasterio
from pyproj import Proj, Transformer
from rasterio.errors import RasterioError
from rasterio.transform import from_origin
from rasterio.warp import Resampling, reproject

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT))
# The line as typed. A kit need not be an area: the seed kits have no area
# file, and area.py (which the bakes below import) loads whatever --area
# names on import and stops when there is no such file. So the flag, --area X
# or --area=X as take_area_flag reads it, comes off sys.argv first, and
# area.py loads its default, which nothing here reads.
ARGV = list(sys.argv)
_i = 1
while _i < len(sys.argv):
    if sys.argv[_i] == "--area":
        del sys.argv[_i : _i + 2]
    elif sys.argv[_i].startswith("--area="):
        del sys.argv[_i]
    else:
        _i += 1

import area  # noqa: E402
import build_microclimate as mc  # noqa: E402
from build_windcfd import BUFFER_M, DIRECTIONS, KIT, SPEED_KPH  # noqa: E402

# the shared kit first: the seed kits move into it as their runs are queued,
# so during a move one id can be in both
KIT_DIRS = (KIT, ROOT / "raw" / "windcfd-seed")
OUT = ROOT / "raw" / "surrogate"
REPORT = OUT / "report-dataset.json"
CELL_M = 30.0
# the outermost 600 m carries the solver's boundary conditions more than the
# terrain's; prepare()'s 2.5 km buffer leaves the core well inside it
EDGE = 20
# a colMax grid is this kit's when it covers the domain to within a cell of
# its own and runs no more than 3 past it (clean runs: -0.4 to +1, colmax_fit)
FIT_SHORT, FIT_OVER = 1.0, 3.0
# a direction's turbulence is taken for another run's when the speed of some
# other direction matches it better than its own by more than this (Pearson
# r). On the six kits finished by 2026-10-09 the own direction wins by 0.064
# at the least, so 0.05 drops nothing clean, and it catches all 192 simulated
# swaps between neighbouring directions where 0.1 caught 170
SWAP_MARGIN = 0.05
# a grid that covers less of the valid cells than this is a partial write
# (whitefish-lake t067.5: values in the top 98 of 517 rows); clean ones cover 100%
MIN_COVER = 0.99
FAILED = ("failed-", "stuck-", "stopped-")
ALIGNMENT = ("WindNinja's u/v ascii grids are one row and one column larger than dem.tif with the same "
             "lower-left corner and 30 m cells; the extra row is at the top, the extra column at the right, "
             "so u, v = asc[1:, :-1] / 22, headers checked against meta.json. turb: the colMax GeoTIFF "
             "(EPSG:4326, km/h, <= 0 outside the solve) reprojected bilinearly onto the dem grid, / 22. "
             "Sub-cell correlation of the 16-direction mean speed and turbulence with the dem's local relief "
             "(2026-10-09): turb lines up with the dem, while cropped u/v cell (i, j) holds the wind at about "
             "the NE corner of dem cell (i, j), half a cell (~21 m) off. Corrected: u, v are the mean of each "
             "cell's four corners, the 2x2 block of crop cells (i..i+1, j-1..j), edge values standing in for "
             "the bottom row and left column. Rechecked with a Fourier-phase shift search (a bilinear one is "
             "biased toward half cells): the peak moved half a cell in each axis and sits at (rows, cols) "
             "pickle-lake (+0.06, -0.125) vs turb, (0, -0.125) vs relief; blanchard-river (+0.125, 0) vs turb, "
             "(+0.31, 0) vs relief, where turb itself reads (+0.25, +0.06) vs relief. build_windcfd.collect() "
             "still carries the original offset for the app's momentum bands. "
             "Axes: u, v are along the UTM grid's east and north, turned from true north by the meridian "
             "convergence g (grid north lies g clockwise of true north; gridConvergenceDeg, pyproj, at the "
             "domain centre), so u = -sin d, v = -cos d holds in true-north axes only; in grid axes the "
             "ambient from d is u = -sin(d - g), v = -cos(d - g). Not rotated here.")


class KitNotReady(Exception):
    """A kit that cannot be built as it stands: a run unfinished or requeued
    since discovery, a grid missing, unreadable or off the DEM's grid. The
    runners keep working while a build reads, so --all skips such a kit and
    goes on; --area stops on it."""


def tag(d: float) -> str:
    return f"{d:05.1f}"


def read_asc(path: Path) -> tuple[dict, np.ndarray]:
    """An ESRI ascii grid: its six header lines and the values, row 0 north.
    build_windcfd.read_asc's np.loadtxt is several times slower, and a build
    reads up to 64 of these."""
    *head, body = path.read_text().split("\n", 6)
    hdr = {k.lower(): float(v) for k, v in (line.split() for line in head)}
    a = np.array(body.split(), dtype=np.float32)
    return hdr, a.reshape(int(hdr["nrows"]), int(hdr["ncols"]))


def job_for(kit: Path, d: float) -> Path | None:
    """The finished run for a direction: the t job (with the turbulence)
    when it has done.txt and its u and v grids, else the d job on the same
    terms, else None."""
    for j in (kit / f"t{tag(d)}", kit / f"d{tag(d)}"):
        if (j / "done.txt").exists() and any(j.glob("*_u.asc")) and any(j.glob("*_v.asc")):
            return j
    return None


def finished(kit: Path) -> list[float]:
    return [d for d in DIRECTIONS if job_for(kit, d) is not None]


def kit_folders() -> dict[str, list[Path]]:
    """Every kit (a folder with a meta.json) in either kit folder, by id."""
    found: dict[str, list[Path]] = {}
    for base in KIT_DIRS:
        if base.is_dir():
            for k in sorted(base.iterdir()):
                if (k / "meta.json").is_file():
                    found.setdefault(k.name, []).append(k)
    return found


def pick(copies: list[Path]) -> Path:
    """Of an id's copies, the one with the most directions finished; the
    shared kit's on a tie (copies come in KIT_DIRS order, and max keeps the
    first of equals)."""
    return max(copies, key=lambda k: len(finished(k)))


def discover() -> tuple[list[Path], list[tuple[Path, int]]]:
    """The kits with all 16 directions finished, and the rest with how many
    are."""
    complete, skipped = [], []
    for copies in kit_folders().values():
        k = pick(copies)
        n = len(finished(k))
        (complete.append(k) if n == len(DIRECTIONS) else skipped.append((k, n)))
    return complete, skipped


def rel(p: Path) -> str:
    return p.resolve().relative_to(area.ROOT).as_posix() if area.ROOT in p.resolve().parents else str(p)


def read_wind(job: Path, meta: dict) -> tuple[np.ndarray, np.ndarray, int]:
    """u and v (east, north, km/h at 10 m) on the DEM's grid, and how many
    nodata cells the full ascii grids held."""
    x0, y0 = meta["bounds"][:2]
    out = []
    holes = 0
    for comp in ("u", "v"):
        f = sorted(job.glob(f"*_{comp}.asc"))[0]
        hdr, a = read_asc(f)
        if (hdr["cellsize"] != CELL_M or hdr["xllcorner"] != x0 or hdr["yllcorner"] != y0
                or a.shape != (meta["rows"] + 1, meta["cols"] + 1)):
            raise KitNotReady(f"{f}: header {hdr} is not dem.tif's grid with a row on top and a column on the right")
        holes += int((a == hdr.get("nodata_value", -9999)).sum() + (~np.isfinite(a)).sum())
        a = on_centres(a[1:, :-1])
        assert a.shape == (meta["rows"], meta["cols"]), a.shape
        out.append(a)
    return out[0], out[1], holes


def on_centres(crop: np.ndarray) -> np.ndarray:
    """The wind at the DEM's cell centres from the cropped ascii grid, whose
    cell (i, j) holds the wind at the north-east corner of DEM cell (i, j),
    not its centre (see Lining up). A cell's four corners are the NE corners
    of itself (i, j), of the cell to its west (i, j-1), of the cell below
    (i+1, j) and of the one below and west (i+1, j-1), so its centre is the
    mean of that 2x2 block. The bottom row has no row below it and the left
    column no column west of it: their edge values stand in, inside the
    20-cell edge mask either way."""
    p = np.pad(crop, ((0, 1), (1, 0)), mode="edge")  # p[r, c] = crop[r, c-1]
    return (0.25 * (p[:-1, :-1] + p[:-1, 1:] + p[1:, :-1] + p[1:, 1:])).astype(np.float32)


def colmax_fit(src, meta: dict) -> np.ndarray:
    """How far a colMax grid reaches past the kit's domain on each side (W,
    E, S, N), in the grid's own cells. WindNinja writes it as the domain's
    lon/lat box, so on a clean run each side is between about -0.4 and +1;
    one from another kit misses by kilometres. The domain's edges are
    densified, since a UTM edge bows in lon/lat."""
    x0, y0, x1, y1 = meta["bounds"]
    t = np.linspace(0, 1, 65)
    xs = np.concatenate([x0 + (x1 - x0) * t, np.full_like(t, x1), x1 - (x1 - x0) * t, np.full_like(t, x0)])
    ys = np.concatenate([np.full_like(t, y0), y0 + (y1 - y0) * t, np.full_like(t, y1), y1 - (y1 - y0) * t])
    lon, lat = Transformer.from_crs(f"EPSG:{meta['epsg']}", "EPSG:4326", always_xy=True).transform(xs, ys)
    b = src.bounds
    return np.array([lon.min() - b.left, b.right - lon.max(), lat.min() - b.bottom, b.top - lat.max()]) / abs(src.res[0])


def read_turbulence(job: Path, meta: dict, shape: tuple[int, int], transform, crs: str) -> tuple[np.ndarray | None, list[float] | None]:
    """WindNinja's most velocity fluctuation in the lowest 10 m (km/h) on the
    DEM's grid, NaN outside the solve; None for a run without it, or for one
    whose grid is not this kit's domain (then with its fit, colmax_fit)."""
    ks = sorted(job.glob("*colMax*.tif"))
    if not ks:
        return None, None
    with rasterio.open(ks[0]) as src:
        fit = colmax_fit(src, meta)
        if fit.min() < -FIT_SHORT or fit.max() > FIT_OVER:
            return None, [round(float(f), 2) for f in fit]
        k = src.read(1).astype(np.float64)
        bad = ~np.isfinite(k) | (k <= 0)
        if src.nodata is not None:
            bad |= k == src.nodata
        k[bad] = np.nan
        dst = np.full(shape, np.nan, np.float64)
        reproject(k, dst, src_transform=src.transform, src_crs=src.crs, src_nodata=np.nan,
                  dst_transform=transform, dst_crs=crs, dst_nodata=np.nan, resampling=Resampling.bilinear)
    return dst, None


def turbulence_owner(u: np.ndarray, v: np.ndarray, turb: np.ndarray, valid: np.ndarray, have: list[float]) -> dict[str, dict]:
    """Whose turbulence each direction's grid is. Two runs finishing at once
    on one machine can collide on WindNinja's fixed-name scratch file
    (colMax_10mColHeightAGL_raw_proj.tif), leaving a job with its own u and v
    but another run's turbulence. The fluctuation follows the run's own flow,
    so per direction: the Pearson r of its turbulence with the speed of every
    direction over the valid cells, its own r, the best other direction's,
    and the best that is not a neighbour (22.5° either side), whose field is
    nearly the same and so can never be told apart."""
    sp = np.hypot(u[:, valid], v[:, valid]).astype(np.float64)
    out: dict[str, dict] = {}
    for d in have:
        i = DIRECTIONS.index(d)
        t = turb[i][valid].astype(np.float64)
        ok = np.isfinite(t)
        rs = {tag(e): float(np.corrcoef(t[ok], sp[k][ok])[0, 1]) for k, e in enumerate(DIRECTIONS)}
        others = [e for e in DIRECTIONS if e != d]
        far = [e for e in others if abs((e - d + 180) % 360 - 180) > 22.5 + 1e-6]
        best = max(others, key=lambda e: rs[tag(e)])
        best_far = max(far, key=lambda e: rs[tag(e)])
        out[tag(d)] = {"own": round(rs[tag(d)], 4), "bestOther": tag(best), "bestOtherR": round(rs[tag(best)], 4),
                       "bestFar": tag(best_far), "bestFarR": round(rs[tag(best_far)], 4),
                       "r": {k: round(x, 4) for k, x in rs.items()}}
    return out


def failed_attempts(kit: Path) -> dict[str, list[str]]:
    """The jobs where a runner left failed-, stuck- or stopped- notes beside
    the outputs: earlier attempts, for the record; a job is finished by its
    done.txt and grids whatever else is there."""
    out = {}
    for j in sorted(p for p in kit.iterdir() if p.is_dir() and p.name[:1] in "dt"):
        notes = sorted(f.name for f in j.iterdir() if f.name.startswith(FAILED))
        if notes:
            out[j.name] = notes
    return out


def grid_convergence(epsg: int, bounds: list[float]) -> float:
    """Degrees grid north lies clockwise of true north at the domain's
    centre: the turn between WindNinja's u/v axes and true north."""
    x0, y0, x1, y1 = bounds
    lon, lat = Transformer.from_crs(f"EPSG:{epsg}", "EPSG:4326", always_xy=True).transform((x0 + x1) / 2, (y0 + y1) / 2)
    return round(float(Proj(f"EPSG:{epsg}").get_factors(lon, lat).meridian_convergence), 4)


def core_mask(kit_id: str, meta: dict, transform, shape: tuple[int, int]) -> tuple[np.ndarray, dict]:
    """The cells whose centre is in the core, and where the core came from:
    the area file's lon/lat box when the kit is an area, else the domain
    inset by prepare()'s buffer on every side, which is how a seed kit's
    core was laid out (seed.py)."""
    rr, cc = np.mgrid[0 : shape[0], 0 : shape[1]]
    x, y = transform * (cc + 0.5, rr + 0.5)
    if area.area_path(kit_id).exists():
        box = area.load(kit_id)["core"]
        lon, lat = Transformer.from_crs(f"EPSG:{meta['epsg']}", "EPSG:4326", always_xy=True).transform(x, y)
        inside = (lon >= box["west"]) & (lon <= box["east"]) & (lat >= box["south"]) & (lat <= box["north"])
        return inside, {"source": f"app/src/areas/{kit_id}.json", **{k: box[k] for k in area.WSEN}}
    x0, y0, x1, y1 = meta["bounds"]
    inset = [x0 + BUFFER_M, y0 + BUFFER_M, x1 - BUFFER_M, y1 - BUFFER_M]
    inside = (x >= inset[0]) & (x <= inset[2]) & (y >= inset[1]) & (y <= inset[3])
    return inside, {"source": f"domain bounds inset {BUFFER_M:.0f} m (no area file)", "bounds": inset}


def pct(a: np.ndarray, qs: tuple[int, ...] = (5, 50, 95)) -> dict[str, float]:
    return {f"p{q}": round(float(v), 4) for q, v in zip(qs, np.percentile(a, qs))}


def disagreement(u1: np.ndarray, v1: np.ndarray, u2: np.ndarray, v2: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Per cell: the turn between two winds (degrees, 0 to 180), the gap in
    their speed ratios, and the length of their vector difference."""
    turn = np.abs((np.degrees(np.arctan2(u1, v1) - np.arctan2(u2, v2)) + 180.0) % 360.0 - 180.0)
    return turn, np.abs(np.hypot(u1, v1) - np.hypot(u2, v2)), np.hypot(u1 - u2, v1 - v2)


def summary(turn: np.ndarray, dspeed: np.ndarray, dvec: np.ndarray) -> dict[str, float]:
    """The median and p90 asked for, and the mean, p99 and share of cells
    that agree exactly: the runs are written to 0.01 km/h and most cells of
    two runs come out the same, so the median and p90 alone read as 0."""
    out: dict[str, float] = {}
    for name, a, nd in (("turnDeg", turn, 3), ("speedRatio", dspeed, 5), ("vector", dvec, 5)):
        out |= {f"{name}P50": round(float(np.median(a)), nd), f"{name}P90": round(float(np.percentile(a, 90)), nd),
                f"{name}P99": round(float(np.percentile(a, 99)), nd), f"{name}Mean": round(float(a.mean()), nd),
                f"{name}Max": round(float(a.max()), nd)}
    out["identical"] = round(float((dvec == 0).mean()), 4)
    return out


def load_kit(kit: Path) -> tuple[dict, np.ndarray, object, str]:
    area_id = kit.name
    meta = json.loads((kit / "meta.json").read_text())
    if [float(d) for d in meta["directions"]] != DIRECTIONS or meta["speedKph"] != SPEED_KPH:
        raise KitNotReady(f"{area_id}: meta.json's directions or speed are not build_windcfd's")
    x0, y0, x1, y1 = meta["bounds"]
    with rasterio.open(kit / "dem.tif") as d:
        dem = d.read(1)
        transform, epsg = d.transform, d.crs.to_epsg()
    if epsg != meta["epsg"] or transform != from_origin(x0, y1, CELL_M, CELL_M) or dem.shape != (meta["rows"], meta["cols"]):
        raise KitNotReady(f"{area_id}: dem.tif does not match meta.json")
    holes = int((dem == -9999).sum() + (~np.isfinite(dem)).sum())
    if holes:
        raise KitNotReady(f"{area_id}: dem.tif has {holes} empty cells")
    return meta, dem.astype(np.float32), transform, f"EPSG:{epsg}"


def edge_mask(shape: tuple[int, int]) -> np.ndarray:
    valid = np.zeros(shape, bool)
    valid[EDGE:-EDGE, EDGE:-EDGE] = True
    return valid


def replace_atomically(out: Path, write) -> None:
    """write(file) into a temporary name beside out, then renamed over it: a
    build that stops halfway never leaves a half-written file under the real
    name for training to read."""
    tmp = out.with_name(out.name + ".part")
    try:
        with open(tmp, "wb") as f:
            write(f)
        os.replace(tmp, out)
    finally:
        tmp.unlink(missing_ok=True)


def save_npz(out: Path, **arrays: np.ndarray) -> None:
    # a file object, so np.savez adds no second .npz to the temporary name
    replace_atomically(out, lambda f: np.savez_compressed(f, **arrays))


def update_report(area_id: str | None, part: str, entry) -> None:
    """An area's part of the report, or with no area a top-level entry
    (skipped)."""
    rep = json.loads(REPORT.read_text()) if REPORT.exists() else {}
    if area_id is None:
        rep[part] = entry
    else:
        rep.setdefault("areas", {}).setdefault(area_id, {})[part] = entry
    rep["updated"] = date.today().isoformat()
    replace_atomically(REPORT, lambda f: f.write(json.dumps(rep, indent=1).encode()))


def build(kit: Path, write: bool = True) -> None:
    """The training set for one kit; with write False (--check) everything is
    read and checked and nothing is written."""
    t0 = time.perf_counter()
    area_id = kit.name
    meta, dem, transform, crs = load_kit(kit)
    R, C = dem.shape
    n = len(DIRECTIONS)
    u = np.empty((n, R, C), np.float32)
    v = np.empty((n, R, C), np.float32)
    turb = np.full((n, R, C), np.nan, np.float32)
    valid = edge_mask((R, C))
    core, core_from = core_mask(area_id, meta, transform, (R, C))
    cv = core & valid
    jobs: dict[str, str] = {}
    with_turb: list[float] = []
    bounds_fail: dict[str, list[float]] = {}
    cover_fail: dict[str, float] = {}
    holes = 0
    repeat: dict[str, dict] = {}
    pooled: list[list[np.ndarray]] = [[], [], []]
    missing = []
    for i, d in enumerate(DIRECTIONS):
        job = job_for(kit, d)
        if job is None:
            missing.append(d)
            continue
        jobs[tag(d)] = job.name
        try:
            uk, vk, h = read_wind(job, meta)
            k, fit = read_turbulence(job, meta, (R, C), transform, crs)
        except (OSError, ValueError, IndexError, RasterioError) as e:
            # a grid gone or half there: the job was requeued or is being rewritten
            raise KitNotReady(f"{area_id}: {job.name} could not be read ({type(e).__name__}: {e})") from e
        holes += h
        u[i], v[i] = uk / SPEED_KPH, vk / SPEED_KPH
        if fit is not None:
            bounds_fail[tag(d)] = fit
        if k is not None:
            cover = float(np.isfinite(k[valid]).mean())
            if cover < MIN_COVER:
                cover_fail[tag(d)] = round(cover, 4)
            else:
                turb[i] = k / SPEED_KPH
                with_turb.append(d)
        # the first pass of the same case, where there is one
        other = kit / f"d{tag(d)}"
        if job.name.startswith("t") and (other / "done.txt").exists() and any(other.glob("*_u.asc")):
            try:
                ud, vd, _ = read_wind(other, meta)
            except (OSError, ValueError, IndexError) as e:
                raise KitNotReady(f"{area_id}: {other.name} could not be read ({type(e).__name__}: {e})") from e
            parts = disagreement(u[i][cv], v[i][cv], ud[cv] / SPEED_KPH, vd[cv] / SPEED_KPH)
            repeat[tag(d)] = summary(*parts)
            for acc, p in zip(pooled, parts):
                acc.append(p)
    if missing:
        raise KitNotReady(f"{area_id}: {len(missing)} directions unfinished at build time: {missing}")
    if holes:
        raise KitNotReady(f"{area_id}: {holes} nodata cells in the wind grids")
    match = turbulence_owner(u, v, turb, valid, with_turb)
    swapped = {t: m for t, m in match.items() if max(m["r"].values()) - m["own"] > SWAP_MARGIN}
    for t in swapped:
        d = float(t)
        turb[DIRECTIONS.index(d)] = np.nan
        with_turb.remove(d)
    turb_cover = [float(np.isfinite(turb[DIRECTIONS.index(d)][valid]).mean()) for d in with_turb]
    speed = np.hypot(u[:, valid], v[:, valid])
    info = {
        "area": area_id, "epsg": meta["epsg"], "bounds": meta["bounds"], "cell": CELL_M, "speedKph": SPEED_KPH,
        "edgeCells": EDGE, "core": core_from, "kit": rel(kit),
        "gridConvergenceDeg": grid_convergence(meta["epsg"], meta["bounds"]),
        "jobs": jobs, "turbulence": with_turb, "alignment": ALIGNMENT,
    }
    dropped = ({t: "colMax grid is not this kit's domain" for t in bounds_fail}
               | {t: f"colMax grid covers {f:.1%} of the valid cells" for t, f in cover_fail.items()}
               | {t: "turbulence matches another direction's flow" for t in swapped})
    if dropped:
        info["turbulenceDropped"] = dropped
    if "seed" in meta:
        info["seed"] = meta["seed"]
    out = OUT / f"{area_id}.npz"
    if write:
        OUT.mkdir(parents=True, exist_ok=True)
        # a 0-d string array: np.load(allow_pickle=False) reads it, and str() of it is the JSON
        save_npz(out, dem=dem, u=u, v=v, turb=turb, directions=np.array(DIRECTIONS, np.float32),
                 core=core, valid=valid, meta=np.array(json.dumps(info)))
    tv = turb[:, valid]
    margins = [m["own"] - m["bestOtherR"] for m in match.values()]
    far = [m["own"] - m["bestFarR"] for m in match.values()]
    entry: dict = {
        "file": out.name, "mb": round(out.stat().st_size / 1e6, 1) if write else None, "kit": info["kit"],
        "coreSource": core_from["source"],
        "shape": {"dem": [R, C], "u": [n, R, C]}, "gridConvergenceDeg": info["gridConvergenceDeg"],
        "cells": {"valid": int(valid.sum()), "core": int(core.sum()), "coreValid": int(cv.sum())},
        "jobs": {"t": sum(j.startswith("t") for j in jobs.values()), "d": sum(j.startswith("d") for j in jobs.values())},
        "speedRatio": pct(speed),
        "turbulence": {"directions": len(with_turb),
                       "validCoverMin": round(min(turb_cover), 5) if turb_cover else 0.0,
                       "validCoverMean": round(float(np.mean(turb_cover)), 5) if turb_cover else 0.0,
                       "ratio": pct(tv[np.isfinite(tv)]) if with_turb else None,
                       "match": {t: {k: m[k] for k in ("own", "bestOther", "bestOtherR", "bestFar", "bestFarR")} for t, m in match.items()}},
        "turbulenceSwapSuspected": swapped or None,
        "turbulenceBoundsFail": bounds_fail or None,
        "turbulenceCoverageFail": cover_fail or None,
        "failedAttempts": failed_attempts(kit) or None,
        "repeatability": None,
    }
    sr = entry["speedRatio"]
    line = (f"{area_id}: {n} directions on {C}×{R} ({entry['jobs']['t']} t, {entry['jobs']['d']} d) · speed ratio "
            f"{sr['p5']:.2f} / {sr['p50']:.2f} / {sr['p95']:.2f} (p5/p50/p95) · turbulence for {len(with_turb)}, "
            f"{100 * entry['turbulence']['validCoverMin']:.2f}% of valid cells at the least")
    if match:
        owns = [m["own"] for m in match.values()]
        line += (f"\n  turbulence vs its own speed r {min(owns):.3f}–{max(owns):.3f}; own minus best other "
                 f"{min(margins):+.3f} at worst, own minus best non-neighbour {min(far):+.3f} at worst; "
                 f"own the best in {sum(x >= 0 for x in margins)}/{len(margins)}")
    if dropped:
        line += f"\n  turbulence dropped: {dropped}"
    if entry["failedAttempts"]:
        line += f"\n  failed/stuck/stopped notes in {len(entry['failedAttempts'])} jobs: {', '.join(entry['failedAttempts'])}"
    if repeat:
        entry["repeatability"] = {"directions": list(repeat), "cells": int(cv.sum()),
                                  "pooled": summary(*(np.concatenate(p) for p in pooled)), "byDirection": repeat}
        r = entry["repeatability"]["pooled"]
        line += (f"\n  two runs of the same case, {len(repeat)} directions over the core, {100 * r['identical']:.1f}% of cells the same: "
                 f"turn {r['turnDegP50']:.2f}° median, {r['turnDegP90']:.2f}° p90, {r['turnDegP99']:.2f}° p99, {r['turnDegMean']:.3f}° mean · "
                 f"speed ratio gap {r['speedRatioP50']:.4f} median, {r['speedRatioP90']:.4f} p90, {r['speedRatioP99']:.4f} p99, "
                 f"{r['speedRatioMean']:.5f} mean")
    entry["seconds"] = round(time.perf_counter() - t0, 1)
    if write:
        update_report(area_id, "build", entry)
        print(f"{line}\n  {out} · {entry['mb']} MB · {entry['seconds']:.0f}s")
    else:
        print(f"{line}\n  checked, nothing written · {entry['seconds']:.0f}s")


def baseline(kit: Path) -> None:
    area_id = kit.name
    _, dem, _, _ = load_kit(kit)
    # solve_basis reads the lattice from build_microclimate's globals
    mc.ROWS, mc.COLS = dem.shape
    mc.DX = mc.DY = CELL_M
    z = dem.astype(np.float64)
    ones = np.ones_like(z)
    bands: dict[str, np.ndarray] = {}
    secs: dict[str, float] = {}
    for name, lid, sigma in (("neutral", mc.LID_NEUTRAL, 100), ("stable", mc.LID_STABLE, 35)):
        print(f"{area_id}: {name} layer, lid {lid:.0f} m over the terrain smoothed by {sigma} cells")
        t = time.perf_counter()
        ue, ve, un, vn = mc.solve_basis(z, ones, lid, big_sigma=sigma)
        secs[name] = round(time.perf_counter() - t, 1)
        for k, a in zip(("ue", "ve", "un", "vn"), (ue, ve, un, vn)):
            bands[f"{name}_{k}"] = a.astype(np.float32)
    OUT.mkdir(parents=True, exist_ok=True)
    out = OUT / f"baseline-{area_id}.npz"
    save_npz(out, **bands)
    valid = edge_mask(dem.shape)
    # the speed for a wind from the north (ex = 0, ey = -1), as a check on the scale
    north = {name: pct(np.hypot(bands[f"{name}_un"], bands[f"{name}_vn"])[valid]) for name in ("neutral", "stable")}
    entry = {"file": out.name, "mb": round(out.stat().st_size / 1e6, 1), "shape": list(dem.shape),
             "seconds": secs, "speedFromNorth": north}
    update_report(area_id, "baseline", entry)
    print(f"  {out} · {entry['mb']} MB · neutral {secs['neutral']:.0f}s, stable {secs['stable']:.0f}s · "
          f"speed from the north {north['neutral']['p50']:.2f} neutral, {north['stable']['p50']:.2f} stable (median)")


def main() -> None:
    p = argparse.ArgumentParser(description="The surrogate's training set, and today's SD wind on the same grid.")
    p.add_argument("command", choices=("build", "baseline"))
    which = p.add_mutually_exclusive_group(required=True)
    # --area X or --area=X, as area.take_area_flag reads them
    which.add_argument("--area", metavar="ID", help="one kit, in " + " or ".join(rel(k) for k in KIT_DIRS))
    which.add_argument("--all", action="store_true", help="every kit with all 16 directions finished")
    p.add_argument("--check", action="store_true", help="build: read and check every run, write nothing")
    a = p.parse_args(ARGV[1:])
    if a.check and a.command != "build":
        p.error("--check goes with build")
    run = (lambda k: build(k, write=not a.check)) if a.command == "build" else baseline
    if a.area:
        copies = kit_folders().get(a.area)
        if not copies:
            raise SystemExit(f"no kit {a.area!r} (a folder with meta.json) in " + " or ".join(rel(k) for k in KIT_DIRS))
        kit = pick(copies)
        done = len(finished(kit))
        # the baseline wants only the DEM; the training set wants every run
        if a.command == "build" and done < len(DIRECTIONS):
            raise SystemExit(f"{a.area}: {done}/{len(DIRECTIONS)} directions finished in {rel(kit)} "
                             "(a t or d job with done.txt and its u and v grids); nothing built")
        try:
            run(kit)
        except KitNotReady as e:
            raise SystemExit(str(e)) from None
        return
    complete, skipped = discover()
    print(f"{len(complete)} kits with all {len(DIRECTIONS)} directions: " + ", ".join(f"{k.name} ({k.parent.name})" for k in complete))
    if skipped:
        print(f"skipped {len(skipped)}: " + ", ".join(f"{k.name} {n}/{len(DIRECTIONS)} ({k.parent.name})" for k, n in skipped))
    gone = {k.name: f"{n}/{len(DIRECTIONS)} directions finished at discovery" for k, n in skipped}
    for kit in complete:
        try:
            run(kit)
        except KitNotReady as e:
            print(f"skipped {kit.name}: {e}")
            gone[kit.name] = str(e)
    if a.command == "build" and not a.check:
        update_report(None, "skipped", gone)


if __name__ == "__main__":
    main()
