"""Vegetation structure from the area's LiDAR point cloud: canopy height,
canopy cover and understory density ("bush thickness") on a 10 m grid,
plus a coloured understory raster for the map and its shooting-lanes twin.

Input:  pipeline/raw/pointcloud/tiles-<region>.json, the tiles the area's
        point-cloud adapter lists, and the files it fetched. Whatever tiles
        are on disk are used; cells of tiles not fetched are nodata (no
        returns: under the density floor). Each row gives its tile's CRS
        and bounds (one CRS per area, each tile a whole number of 10 m
        cells), how heights are found in it and which classes to drop.
        Two kinds so far:
        - Ontario (fetch_pointcloud.py): FRI leaf-on single-photon LiDAR,
          project White Lake 2021, flown late Sept 2021, ~35 pts/m² and 2-4x
          that where flight lines overlap. 1 km COPC tiles in UTM 16N
          (EPSG:3160), whole (<tile>.copc.laz) or a band of one
          (<tile>.band.laz, fetch_pointcloud.py --band, the points of a
          shore band or a circle only; a band's other cells are nodata),
          each with the provider's 0.5 m DEM (dem/<tile>_DEM.tif).
        - Quebec (qc_pointcloud.py): MRNF linear-mode LiDAR (RIEGL), flown
          leaf-on in summer 2024 at Lac Bailey, 2.5 pts/m² nominal and 5-8
          returns/m² measured, up to 7 returns a pulse. Plain LAZ 1.4 in
          1 km tiles in MTM (EPSG:2949 there), with no DEM.
        <area data>/waterbody-<region>.geojson for the water where there is no lidar.
        <area data>/forest-<region>.geojson for the sanity check.

Returns, Ontario. The provider classifies by height above ground: 2 ground,
3 low veg (0-0.3 m), 4 medium (0.3-2 m), 5 high (>2 m), 7/18 noise, and 12,
which Ontario lists among its vegetation classes but which here sits within
0.2 m of the DEM (ground-level returns, dense where flight lines overlap).
Noise (7, 18) is dropped; everything else, 12 included, is binned by its
own height, so the classes only matter for the noise. Dropping 12 would
thin the ground layer alone and push the understory ratio up. Heights are
z minus the provider's 0.5 m DEM of the same tile (bilinear); returns below
-1 m or above 45 m are dropped as residual noise, -1..0 m counts as 0.
SPL (Leica SPL100) splits each pulse into 100 beamlets, each counting
single photons; 95 % of returns here are "single returns" and return numbers
do not mean what they do for linear-mode lidar, so every metric uses ALL
returns, each one an independent sample of where the beam was intercepted.

Returns, Quebec. Classes 1 unclassified (every return above the ground,
the vegetation among them, not split by height), 2 ground, 7 noise,
9 water, 17 bridge decks; 7 and 17 are dropped. Heights are z minus a
ground model made from the tile's own ground returns: a TIN, linear inside
each triangle, on 1 m pixels, taking in the neighbouring tiles' ground
returns within EDGE_M so the tile edges have no seams. Not HRDEM's DTM:
where it comes from these same returns (the 2023 Lac au Brochet project)
it is the same ground but in CGVD2013, and the LAZ is in CGVD28, 0.38 m
apart all over Lac Bailey: enough to lift every ground return most of the
way to the 0.5 m understory floor. Under the 2024 Rivière aux Outardes
flight (the core's north edge) HRDEM has only the 2015-17 survey, 0.3-0.7 m
off these returns and over a metre in places. The tile's own ground shares
the returns' datum, flight and georeferencing. Water: calm water sends most
pulses away, so a lake is a speckle of water returns over a gap in the
cloud. Water at 1 m is the pixels with water returns and no ground ones,
joined by the empty pixels that touch them. Water returns, and anything
else over the water, are dropped, as in Ontario. Some tiles have no water
class at all, and their ponds are bare gaps: a 10 m cell half or more gap
is water if it joins the lidar's water across a tile edge, and otherwise
unmeasured (water_frac nodata), so the area's waterbodies decide, here and
in build_going.py. The ratios below were defined on linear-mode lidar,
where every return is a sample as each SPL return is, so Quebec's returns
are binned the same way, all of them.

Metrics per 10 m cell (a block of cells per tile, aligned to the tiles):
  density        returns per m² of land (cells under the floor are nodata)
  canopy_height  95th percentile height of returns above 2 m (m); 0 when
                 fewer than 10 returns are above 2 m (White et al. 2013's
                 2 m threshold; p95 is the usual robust top height)
  canopy_cover   share of returns above 2 m (0-1); all returns in place of
                 first returns, as above
  understory     returns 0.5-3 m / returns 0-3 m (0-1): of what reached
                 the top of the shrub layer, the share intercepted in it.
                 Normalising by the returns that reached the layer, not by
                 all returns, is the occlusion correction: this is the
                 normalised relative density (NRD) of Campbell et al. 2018,
                 the understory lidar cover density of Wing et al. 2012.
  understory_pad Beer-Lambert version of the same ratio, plant area density
                 in the layer (m²/m³): ln(N<3 / N<0.5) / (G dz) with G 0.5
                 (spherical leaf angles) and dz 2.5 m, the MacArthur-Horn
                 (1969) gap-fraction inversion. Linear in "how much stuff
                 per cubic metre" where the ratio saturates.
  n_reach        returns 0-3 m (how many samples the understory rests on;
                 understory is nodata below the reach floor; the cell's
                 own, also where its understory was pooled, see Floors)
  strata         return counts in height bands STRATA_EDGES, so other
                 thresholds (browse height 0.5-2 m, say) need no rerun
  water_frac     share of the cell that is water (the DEM's flattened water
                 in Ontario, the returns' in Quebec; returns there are
                 dropped; cells under MIN_LAND land are nodata); nodata
                 outside the fetched tiles, and over a gap that cannot be
                 told from water (Quebec, above)
  water          water_frac >= 0.5 where there is lidar, else the cell
                 centre is in one of the area's waterbodies

Floors. A cell needs the survey's density floor in returns per m² of land
for any value, and MIN_REACH returns below 3 m for an understory value.
MIN_REACH is statistics, the same in every area: the understory value is a
share of those returns, and 50 keeps its standard error under 0.07, half a
colour class. The density floor is the survey's own: MIN_DENSITY 5 for
Ontario's SPL (a seventh of its ~35, so only band edges and gaps fall
under it); a Quebec row carries its own (qc_pointcloud.py: 1 for the
2.5 pts/m² surveys, a hundred returns a cell). A sparse survey (a row's
poolReach) gets five times fewer returns below 3 m than the SPL (median
320 a cell at Lac Bailey, 1500 at Pickle Lake), and under a closed canopy
3 % of its land cells fall short, in patches up to whole stands (20 ha at
Lac Bailey) that would draw as open shooting lanes. Such a cell takes the
returns of the 3x3 cells round it: its value still rests on MIN_REACH
returns, but describes 30 m, not 10. A cell still short stays unmeasured,
as does every cell under the density floor.

One scale in every area. The colour classes (RAMP, LANES_RAMP) are
absolute values set on Pickle Lake's SPL, and no area is recalibrated to
its own spread: a share of returns does not depend on how many returns
there are, both surveys are leaf-on, and recalibrating would make "thick"
mean "thick for here". Lac Bailey against Pickle Lake (medians): by mapped
stand type its mature stands read thicker (closed conifer 0.47 against
0.39, hardwood 0.71 against 0.59, under more open canopies) and its 1991
burn lighter than Pickle's young cuts (0.37 against 0.71); cells of the
same canopy height and cover read 0.05-0.15 lighter. Some of that may be
the survey (a linear-mode pulse can lose a low shrub's echo in the
ground's, which SPL's photons resolve) and some the forest; nothing is
corrected until someone has walked it. The check below is the stand-type
comparison.

Output: pipeline/raw/vegstructure-<region>.npz  (grids, transform, crs, nodata)
        <area data>/understory-<region>.pmtiles  (z14-16, the core only)
        <area data>/lanes-<region>.pmtiles  (the same, drawn for a bow: open clear)
        pipeline/bake-vegstructure-summary.json  (the stand-type check; area.summary_path)
On a scratch run (HUNTAPP_OUT) the npz is written there too, so the one
build_going.py reads is never touched.

    py -3.14 pipeline/build_vegstructure.py [--area <id>]   # metrics + tiles + check (~10-20 s a tile)
    py -3.14 pipeline/build_vegstructure.py --workers 6      # tiles measured six at a time (default 4)
    py -3.14 pipeline/build_vegstructure.py --tiles          # re-render tiles from the npz
    py -3.14 pipeline/build_vegstructure.py --lanes          # re-render only the lanes tiles

The tiles stop at the water on the 1 m lake edge (lakes.py), not in the
10 m cells' steps.
"""

from __future__ import annotations

import json
import sys
import time
from collections import deque
from concurrent.futures import ProcessPoolExecutor
from itertools import islice

import laspy
import numpy as np
import rasterio
from rasterio.features import rasterize
from rasterio.transform import from_bounds, from_origin
from rasterio.warp import Resampling, reproject, transform_geom
from scipy.interpolate import LinearNDInterpolator
from scipy.ndimage import convolve, distance_transform_edt, label, maximum_filter, minimum_filter
from scipy.spatial import Delaunay

import lakes
from area import JURISDICTION, SCRATCH, note_source, summary_path
from common import CACHE_DIR, CORE, OUT_DIR, REGION, REGION_MAXZOOM, lat_to_tile, lon_to_tile, tile_bounds_3857, write_raster_pmtiles

PC_DIR = CACHE_DIR / "pointcloud"
INDEX = PC_DIR / f"tiles-{REGION['id']}.json"
NPZ = (OUT_DIR if SCRATCH else CACHE_DIR) / f"vegstructure-{REGION['id']}.npz"
SUMMARY = summary_path("vegstructure")

CELL = 10.0  # m
NOISE = (7, 18)  # Ontario's noise classes
H_MIN, H_MAX = -1.0, 45.0
BIN = 0.1  # m, height histogram resolution
NBIN = int(H_MAX / BIN)
CANOPY_H = 2.0
UNDER_LO, UNDER_HI = 0.5, 3.0
G_PROJ = 0.5  # leaf projection, spherical
MIN_CANOPY_RETURNS = 10
MIN_REACH = 50  # returns reaching 3 m for an understory value: its standard error under 0.07
MIN_DENSITY = 5.0  # returns per m² of land for any value, Ontario's SPL (a Quebec row brings its own)
MIN_LAND = 0.25  # share of a cell that must be land (not water)
WATER_MIN_M2 = 100.0  # zero-relief DEM patches this big are water
CHUNK_POINTS = 8_000_000
STRATA_EDGES = np.array([0.0, 0.5, 1.0, 2.0, 3.0, 5.0, 10.0, 15.0, 20.0, 25.0, H_MAX], dtype=np.float32)
NODATA = -1.0
UTM_EPSG = {15: 3159, 16: 3160, 17: 2958}  # NAD83(CSRS) / UTM zone n: Ontario's FRI tiles
GROUND_PX = 1.0  # m, the ground model made from a tile's own ground returns
EDGE_M = 30.0  # m of the neighbouring tiles' ground returns that go into a tile's ground model
POOL = 3  # cells a side whose returns a sparse survey's short cell takes in
WORKERS = 4  # tiles measured at a time (each its own process)

# Ontario's FRI index rows (fetch_pointcloud.py) say nothing about themselves.
ONTARIO_SOURCE = "Ontario MNR FRI leaf-on SPL LiDAR, White Lake 2021 (flown late Sept 2021)"
ONTARIO_ATTRIBUTION = "Understory from Ontario FRI SPL LiDAR 2021 · contains information licensed under the Open Government Licence – Ontario"


def tiles() -> list[dict]:
    """The area's tiles in one form, whichever adapter listed them: name,
    laz, crs, bounds (x0, y0, x1, y1 in m), how heights are found ("dem":
    the provider's DEM of the tile; "class": the tile's own ground
    returns), the classes to drop and the floors."""
    out = []
    for r in json.loads(INDEX.read_text(encoding="utf-8")):
        if "Tilename" in r:  # Ontario FRI leaf-on: 1 km tiles named by their SW corner, each with a DEM
            name = r["Tilename"]
            laz = PC_DIR / "laz" / f"{name}.copc.laz"
            if not laz.exists():
                laz = laz.with_name(f"{name}.band.laz")
            out.append(
                {
                    "name": name,
                    "laz": laz,
                    "crs": f"EPSG:{UTM_EPSG[r['zone']]}",
                    "bounds": (r["x0"], r["y0"], r["x0"] + 1000, r["y0"] + 1000),
                    "ground": "dem",
                    "dem": PC_DIR / "dem" / f"{name}_DEM.tif",
                    "drop": NOISE,
                    "water": (),
                    "minDensity": MIN_DENSITY,
                    "poolReach": False,
                    "year": r.get("year"),
                }
            )
            continue
        out.append(
            {
                "name": r["name"],
                "laz": PC_DIR / r["file"],
                "crs": r["crs"],
                "bounds": tuple(r["bounds"]),
                "ground": r["ground"],
                "dem": PC_DIR / r["dem"] if r.get("dem") else None,  # with "ground": "dem"
                "groundClasses": tuple(r.get("groundClasses", (2,))),
                "drop": tuple(r.get("drop", NOISE)),
                "water": tuple(r.get("water", ())),
                "minDensity": float(r.get("minDensity", MIN_DENSITY)),
                "poolReach": bool(r.get("poolReach", False)),
                "year": r.get("year"),
                "days": r.get("days") or [],
                "source": r.get("source"),
                "attribution": r.get("attribution"),
                "licence": r.get("licence"),
            }
        )
    return out


def on_disk(t: dict) -> bool:
    return t["laz"].exists() and (t["ground"] != "dem" or bool(t["dem"] and t["dem"].exists()))


def grid_frame(rows: list[dict]) -> tuple[float, float, int, int]:
    """The 10 m grid: the union of the area's tiles (x0, ytop, W, H)."""
    x0 = min(t["bounds"][0] for t in rows)
    y0 = min(t["bounds"][1] for t in rows)
    x1 = max(t["bounds"][2] for t in rows)
    y1 = max(t["bounds"][3] for t in rows)
    return x0, y1, int((x1 - x0) / CELL), int((y1 - y0) / CELL)


def grid_crs(rows: list[dict]) -> str:
    crs = {t["crs"] for t in rows}
    if len(crs) != 1:
        raise SystemExit(f"the tiles are in {len(crs)} CRSs ({', '.join(sorted(crs))}); one grid needs one")
    ox, oy = rows[0]["bounds"][:2]
    for t in rows:
        x0, y0, x1, y1 = t["bounds"]
        if any((v - o) % CELL for v, o in ((x0, ox), (x1, ox), (y0, oy), (y1, oy))):
            raise SystemExit(f"{t['name']} is not on the {CELL:.0f} m grid: {t['bounds']}")
    return crs.pop()


def describe(rows: list[dict]) -> dict:
    """Where the tiles came from: for the npz, the tiles' attribution and the
    coverage report (area.note_source; Ontario's rows say nothing, so its
    strings are fixed above)."""
    if not any(t.get("source") for t in rows):
        return {"source": ONTARIO_SOURCE, "attribution": ONTARIO_ATTRIBUTION, "own": False}
    days: dict[str, set] = {}
    for t in rows:
        days.setdefault(t["source"], set()).update(t["days"])

    def flown(d) -> str:
        d = sorted(d)
        return "flown " + (d[0] if len(d) == 1 else f"{d[0]} to {d[-1]}") if d else "flight dates unknown"

    years = ", ".join(sorted({str(t["year"]) for t in rows if t.get("year")}))
    credit = " · ".join(sorted({t["attribution"] for t in rows if t.get("attribution")}))
    licence = ", ".join(sorted({t["licence"] for t in rows if t.get("licence")}))
    return {
        "source": "; ".join(f"{s}, {flown(d)}" for s, d in sorted(days.items())) + "; heights above the tiles' own ground returns",
        "attribution": f"Understory from LiDAR flown {years} · {credit}" + (f", {licence}" if licence else ""),
        "licence": licence,
        "vintage": flown(set().union(*days.values())),
        "own": True,
    }


# ---- one tile ---------------------------------------------------------------


def read_dem(dem_path):
    """The tile DEM (NaN for nodata) and its hydro-flattened water: the DEM
    sets lakes and rivers to one exact elevation, so any patch of 100 m² or
    more with zero relief is water. Water returns sit 0.5-1 m above that
    flattened level and would read as shrubs, so they are dropped."""
    with rasterio.open(dem_path) as s:
        dem = s.read(1).astype(np.float32)
        tr = s.transform
        nod = s.nodata
    if nod is not None:
        dem[dem == nod] = np.nan
    flat = (maximum_filter(dem, 3) - minimum_filter(dem, 3)) == 0
    lab, _ = label(flat)
    sizes = np.bincount(lab.ravel())
    sizes[0] = 0
    min_px = int(WATER_MIN_M2 / abs(tr.a * tr.e))
    water = (sizes >= min_px)[lab]
    return dem, water, tr


def dem_heights(x: np.ndarray, y: np.ndarray, z: np.ndarray, dem: np.ndarray, water: np.ndarray, tr) -> tuple[np.ndarray, np.ndarray]:
    """z minus the ground model (bilinear), and whether each point is over water."""
    fc = (x - tr.c) / tr.a - 0.5
    fr = (y - tr.f) / tr.e - 0.5
    c0 = np.clip(np.floor(fc).astype(np.int32), 0, dem.shape[1] - 2)
    r0 = np.clip(np.floor(fr).astype(np.int32), 0, dem.shape[0] - 2)
    wc = np.clip(fc - c0, 0, 1).astype(np.float32)
    wr = np.clip(fr - r0, 0, 1).astype(np.float32)
    g = (
        dem[r0, c0] * (1 - wc) * (1 - wr)
        + dem[r0, c0 + 1] * wc * (1 - wr)
        + dem[r0 + 1, c0] * (1 - wc) * wr
        + dem[r0 + 1, c0 + 1] * wc * wr
    )
    on_water = water[np.clip(np.round(fr).astype(np.int32), 0, dem.shape[0] - 1), np.clip(np.round(fc).astype(np.int32), 0, dem.shape[1] - 1)]
    return (z - g).astype(np.float32), on_water


def cell_hist(x: np.ndarray, y: np.ndarray, h: np.ndarray, bounds, nx: int, ny: int) -> np.ndarray:
    """Points' heights binned by BIN into the tile's 10 m cells, row 0 north."""
    ci = np.clip(((x - bounds[0]) // CELL).astype(np.int64), 0, nx - 1)
    ri = np.clip(((bounds[3] - y) // CELL).astype(np.int64), 0, ny - 1)
    hb = np.clip((np.maximum(h, 0) / BIN).astype(np.int64), 0, NBIN - 1)
    return np.bincount((ri * nx + ci) * NBIN + hb, minlength=nx * ny * NBIN)


def tile_metrics_dem(t: dict) -> dict:
    """A tile with the provider's DEM → its cells' height histograms, reduced
    to metrics. Read in chunks so memory stays flat whatever the tile's
    point count."""
    dem, water, tr = read_dem(t["dem"])
    b = t["bounds"]
    nx, ny = int((b[2] - b[0]) / CELL), int((b[3] - b[1]) / CELL)
    hist = np.zeros(nx * ny * NBIN, np.int64)
    raw = noise = dropped = wet = 0
    with laspy.open(t["laz"]) as f:
        for pts in f.chunk_iterator(CHUNK_POINTS):
            cls = np.asarray(pts.classification)
            keep = ~np.isin(cls, t["drop"])
            raw += cls.size
            noise += int((~keep).sum())
            x = np.asarray(pts.x)[keep]
            y = np.asarray(pts.y)[keep]
            z = np.asarray(pts.z)[keep]
            h, on_water = dem_heights(x, y, z, dem, water, tr)
            ok = np.isfinite(h) & (h >= H_MIN) & (h < H_MAX)
            dropped += int((~ok & ~on_water).sum())
            wet += int(on_water.sum())
            ok &= ~on_water
            hist += cell_hist(x[ok], y[ok], h[ok], b, nx, ny)
    # water share of each 10 m cell, from the DEM's 0.5 m pixels
    k = int(round(CELL / abs(tr.a)))
    water_frac = water[: ny * k, : nx * k].reshape(ny, k, nx, k).mean(axis=(1, 3))
    out = reduce_hist(hist.reshape(nx * ny, NBIN), (ny, nx), land_m2=(1 - water_frac) * CELL * CELL)
    return out | {"water_frac": water_frac, "raw_points": raw, "noise": noise, "dropped": dropped, "water_points": wet}


def read_ground(t: dict) -> np.ndarray:
    """A tile's ground returns, (n, 3) x y z."""
    parts = [np.zeros((0, 3))]
    with laspy.open(t["laz"]) as f:
        for pts in f.chunk_iterator(CHUNK_POINTS):
            g = np.isin(np.asarray(pts.classification), t["groundClasses"])
            parts.append(np.column_stack([np.asarray(pts.x)[g], np.asarray(pts.y)[g], np.asarray(pts.z)[g]]))
    return np.concatenate(parts)


def ground_rim(t: dict) -> np.ndarray:
    """The tile's ground returns within EDGE_M of its edges, which its
    neighbours take into their ground models; float32 metres from the
    tile's SW corner, to halve what is kept of every tile."""
    g = read_ground(t)
    x0, y0, x1, y1 = t["bounds"]
    inner = (g[:, 0] >= x0 + EDGE_M) & (g[:, 0] < x1 - EDGE_M) & (g[:, 1] >= y0 + EDGE_M) & (g[:, 1] < y1 - EDGE_M)
    return (g[~inner] - (x0, y0, 0.0)).astype(np.float32)


def ground_model(pts: np.ndarray, tr, W: int, H: int) -> np.ndarray:
    """The ground on 1 m pixels: a TIN of the ground returns, linear inside
    each triangle, the way a provider's DTM is made; past the TIN's hull (a
    tile edge with no neighbour on disk) the nearest value. NaN everywhere
    with too few returns to triangulate (a tile of open water)."""
    dem = np.full((H, W), np.nan, np.float32)
    if len(pts) < 3:
        return dem
    try:
        # metres from the grid's corner: Qhull loses precision on raw MTM coordinates
        tri = Delaunay(np.column_stack([pts[:, 0] - tr.c, pts[:, 1] - tr.f]))
    except Exception:  # noqa: BLE001  (QhullError: the returns all on one line)
        return dem
    gx, gy = np.meshgrid((np.arange(W) + 0.5) * tr.a, (np.arange(H) + 0.5) * tr.e)
    dem = LinearNDInterpolator(tri, pts[:, 2])(gx, gy).astype(np.float32)
    gap = np.isnan(dem)
    if gap.any():
        _, (iy, ix) = distance_transform_edt(gap, return_indices=True)
        dem = dem[iy, ix]
    return dem


def point_water(n_any: np.ndarray, n_wet: np.ndarray, n_gnd: np.ndarray) -> np.ndarray:
    """Water on 1 m pixels from the returns alone: pixels with water returns
    and no ground ones, and the empty pixels that join them (calm water
    sends most pulses away, so a lake is a speckle of water returns over a
    gap). A gap that touches no water return here stays a gap, for
    settle_gaps to look at across the tiles."""
    seed = (n_wet > 0) & (n_gnd == 0)
    lab, n = label(seed | (n_any == 0), structure=np.ones((3, 3), bool))  # diagonal steps join too
    wet = np.zeros(n + 1, bool)
    wet[np.unique(lab[seed])] = True
    wet[0] = False
    return wet[lab]


def tile_metrics_class(t: dict, borrowed: np.ndarray) -> dict:
    """A tile with no DEM → the same metrics, heights above a ground model
    made from its own ground returns and its neighbours' rims (borrowed,
    absolute x y z). Read twice: the ground and the water, then the
    heights; in chunks, as above."""
    b = t["bounds"]
    nx, ny = int((b[2] - b[0]) / CELL), int((b[3] - b[1]) / CELL)
    k = int(round(CELL / GROUND_PX))
    W, H = nx * k + 2, ny * k + 2  # 1 m pixels and a one-pixel rim, for the bilinear reads at the edge
    tr = from_origin(b[0] - GROUND_PX, b[3] + GROUND_PX, GROUND_PX, GROUND_PX)

    def pixels(x, y):
        c = np.clip(((x - tr.c) / tr.a).astype(np.int64), 0, W - 1)
        r = np.clip(((y - tr.f) / tr.e).astype(np.int64), 0, H - 1)
        return r * W + c

    n_any = np.zeros(W * H, np.int64)
    n_wet = np.zeros(W * H, np.int64)
    n_gnd = np.zeros(W * H, np.int64)
    ground = [borrowed]
    with laspy.open(t["laz"]) as f:
        for pts in f.chunk_iterator(CHUNK_POINTS):
            cls = np.asarray(pts.classification)
            x, y = np.asarray(pts.x), np.asarray(pts.y)
            px = pixels(x, y)
            g = np.isin(cls, t["groundClasses"])
            n_any += np.bincount(px[~np.isin(cls, t["drop"])], minlength=W * H)
            n_wet += np.bincount(px[np.isin(cls, t["water"])], minlength=W * H)
            n_gnd += np.bincount(px[g], minlength=W * H)
            ground.append(np.column_stack([x[g], y[g], np.asarray(pts.z)[g]]))
    # the tile's own pixels: the rim round them is empty, and would join every gap at an edge
    inner = (slice(1, -1), slice(1, -1))
    n_any, n_wet, n_gnd = (a.reshape(H, W)[inner] for a in (n_any, n_wet, n_gnd))
    water = np.zeros((H, W), bool)
    water[inner] = point_water(n_any, n_wet, n_gnd)
    gap = (n_any == 0) & ~water[inner]  # no returns, and no water return joined to it here
    dem = ground_model(np.concatenate(ground), tr, W, H)
    n_ground = int(n_gnd.sum())
    del n_any, n_wet, n_gnd, ground

    hist = np.zeros(nx * ny * NBIN, np.int64)
    raw = noise = dropped = wet = 0
    with laspy.open(t["laz"]) as f:
        for pts in f.chunk_iterator(CHUNK_POINTS):
            cls = np.asarray(pts.classification)
            junk = np.isin(cls, t["drop"])
            wet_cls = np.isin(cls, t["water"])
            keep = ~(junk | wet_cls)
            raw += cls.size
            noise += int(junk.sum())
            x = np.asarray(pts.x)[keep]
            y = np.asarray(pts.y)[keep]
            z = np.asarray(pts.z)[keep]
            h, on_water = dem_heights(x, y, z, dem, water, tr)
            ok = np.isfinite(h) & (h >= H_MIN) & (h < H_MAX)
            dropped += int((~ok & ~on_water).sum())
            wet += int(wet_cls.sum()) + int(on_water.sum())
            ok &= ~on_water
            hist += cell_hist(x[ok], y[ok], h[ok], b, nx, ny)
    water_frac = water[inner].reshape(ny, k, nx, k).mean(axis=(1, 3))
    gap_frac = gap.reshape(ny, k, nx, k).mean(axis=(1, 3))
    out = reduce_hist(hist.reshape(nx * ny, NBIN), (ny, nx), land_m2=np.clip(1 - water_frac - gap_frac, 0, 1) * CELL * CELL)
    return out | {
        "water_frac": water_frac,
        "gap_frac": gap_frac,
        "raw_points": raw,
        "noise": noise,
        "dropped": dropped,
        "water_points": wet,
        "ground_points": n_ground,
    }


def measure(job: tuple[dict, np.ndarray | None]) -> dict:
    """One tile, in a worker process."""
    t, borrowed = job
    if t["ground"] == "dem":
        return tile_metrics_dem(t)
    if t["ground"] == "class":
        return tile_metrics_class(t, borrowed)
    raise ValueError(f"{t['name']}: no way to find heights from {t['ground']!r}")


def reduce_hist(hist: np.ndarray, shape: tuple[int, int], land_m2: np.ndarray) -> dict:
    """Per-cell histograms of height (BIN m) → the metric grids. Density is
    per m² of land, so a shoreline cell is not penalised for its water."""
    b = lambda m: int(round(m / BIN))  # noqa: E731
    n_all = hist.sum(1).astype(np.float64)
    n_low = hist[:, : b(UNDER_LO)].sum(1).astype(np.float64)
    n_reach = hist[:, : b(UNDER_HI)].sum(1).astype(np.float64)
    n_layer = n_reach - n_low
    above = hist[:, b(CANOPY_H) :]
    n_above = above.sum(1).astype(np.float64)
    # p95 of returns above 2 m, interpolated inside the 0.1 m bin
    cum = np.cumsum(above, axis=1)
    target = 0.95 * n_above
    k = np.argmax(cum >= target[:, None], axis=1)
    prev = np.where(k > 0, cum[np.arange(len(k)), k - 1], 0)
    inbin = above[np.arange(len(k)), k]
    frac = np.where(inbin > 0, (target - prev) / np.maximum(inbin, 1), 0)
    p95 = CANOPY_H + (k + frac) * BIN
    with np.errstate(divide="ignore", invalid="ignore"):
        density = np.where(land_m2.ravel() > 0, n_all / np.maximum(land_m2.ravel(), 1e-9), 0.0)
        cover = np.where(n_all > 0, n_above / n_all, np.nan)
        height = np.where(n_above >= MIN_CANOPY_RETURNS, p95, 0.0)
        under = np.where(n_reach > 0, n_layer / n_reach, np.nan)
        # an empty ground layer caps the gap fraction at half a return
        pad = np.where(n_reach > 0, np.log(n_reach / np.maximum(n_low, 0.5)) / (G_PROJ * (UNDER_HI - UNDER_LO)), np.nan)
    edges = np.round(STRATA_EDGES / BIN).astype(int)
    strata = np.stack([hist[:, edges[i] : edges[i + 1]].sum(1) for i in range(len(edges) - 1)])
    return {
        "density": density.reshape(shape),
        "canopy_height": height.reshape(shape),
        "canopy_cover": cover.reshape(shape),
        "understory": under.reshape(shape),
        "understory_pad": pad.reshape(shape),
        "n_reach": n_reach.reshape(shape),
        "strata": strata.reshape(len(edges) - 1, *shape),
    }


# ---- the area ---------------------------------------------------------------


def water_mask(transform, W: int, H: int, crs: str) -> np.ndarray:
    """The area's waterbodies on the grid, for the cells with no lidar."""
    src = OUT_DIR / f"waterbody-{REGION['id']}.geojson"
    if not src.exists():
        print(f"  (no {src.name} yet: cells with no lidar are not marked as water)")
        return np.zeros((H, W), bool)
    fc = json.loads(src.read_text(encoding="utf-8"))
    shapes = [(transform_geom("EPSG:4326", crs, f["geometry"]), 1) for f in fc["features"] if f.get("geometry")]
    return rasterize(shapes, out_shape=(H, W), transform=transform, fill=0, dtype="uint8").astype(bool)


def borrow(t: dict, rims: dict[str, np.ndarray], rows: list[dict]) -> np.ndarray | None:
    """The neighbours' rim returns within EDGE_M of a tile, absolute x y z."""
    if t["ground"] != "class":
        return None
    x0, y0, x1, y1 = t["bounds"]
    parts = [np.zeros((0, 3))]
    for n in rows:
        nb = n["bounds"]
        if n is t or n["name"] not in rims or nb[0] > x1 + EDGE_M or nb[2] < x0 - EDGE_M or nb[1] > y1 + EDGE_M or nb[3] < y0 - EDGE_M:
            continue
        p = rims[n["name"]].astype(np.float64) + (nb[0], nb[1], 0.0)
        near = (p[:, 0] >= x0 - EDGE_M) & (p[:, 0] < x1 + EDGE_M) & (p[:, 1] >= y0 - EDGE_M) & (p[:, 1] < y1 + EDGE_M)
        parts.append(p[near])
    return np.concatenate(parts)


def settle_gaps(water_frac: np.ndarray, gaps: np.ndarray) -> tuple[int, int]:
    """Cells half or more a gap in the cloud that touched no water return in
    their own tile (a pond in a tile with no water class, or a lake cut by a
    tile edge): water where they join the lidar's water across the tiles,
    as a gap does within a tile; else the lidar cannot tell water from a
    gap there, and the cell's water is left to the area's waterbodies
    (nodata). In place; how many of each."""
    gapped = gaps >= 0.5
    wet = water_frac >= 0.5
    lab, _ = label(gapped | wet, structure=np.ones((3, 3), bool))
    joined = gapped & np.isin(lab, np.unique(lab[wet]))
    water_frac[joined] = np.minimum(water_frac[joined] + gaps[joined], 1)
    water_frac[gapped & ~joined] = NODATA
    return int(joined.sum()), int((gapped & ~joined).sum())


def pool_short(grids: dict, strata: np.ndarray, may_pool: np.ndarray) -> int:
    """Understory for a sparse survey's cells with values but under MIN_REACH
    returns below 3 m of their own (closed canopy, where few pulses get
    down): the returns of the POOL x POOL cells round each, from the height
    strata, so the grid's tile edges make no difference. Cells still short
    stay unmeasured. How many cells took it."""
    lo, hi = np.searchsorted(STRATA_EDGES, (UNDER_LO, UNDER_HI))
    s = strata.astype(np.float64)
    k = np.ones((POOL, POOL))
    p_low = convolve(s[:lo].sum(0), k, mode="constant")
    p_layer = convolve(s[lo:hi].sum(0), k, mode="constant")
    p_reach = p_low + p_layer
    short = may_pool & (grids["density"] >= 0) & (grids["understory"] < 0) & (p_reach >= MIN_REACH)
    with np.errstate(divide="ignore", invalid="ignore"):
        grids["understory"][short] = (p_layer / p_reach)[short]
        grids["understory_pad"][short] = (np.log(p_reach / np.maximum(p_low, 0.5)) / (G_PROJ * (UNDER_HI - UNDER_LO)))[short]
    return int(short.sum())


def in_order(pool: ProcessPoolExecutor | None, fn, jobs, ahead: int):
    """fn over jobs, results in the jobs' order, in the pool when there is
    one; at most `ahead` jobs are made and queued at a time, so their
    arguments (a tile's borrowed rims) are not all held at once."""
    if pool is None:
        yield from map(fn, jobs)
        return
    jobs = iter(jobs)
    queue = deque(pool.submit(fn, j) for j in islice(jobs, ahead))
    while queue:
        done = queue.popleft().result()
        queue.extend(pool.submit(fn, j) for j in islice(jobs, 1))
        yield done


def build(workers: int = WORKERS) -> dict:
    rows = tiles()
    crs = grid_crs(rows)
    x0, ytop, W, H = grid_frame(rows)
    transform = from_origin(x0, ytop, CELL, CELL)
    grids = {k: np.full((H, W), NODATA, np.float32) for k in ("density", "canopy_height", "canopy_cover", "understory", "understory_pad", "water_frac")}
    n_reach = np.zeros((H, W), np.uint16)
    strata = np.zeros((len(STRATA_EDGES) - 1, H, W), np.uint16)
    may_pool = np.zeros((H, W), bool)
    gaps = np.zeros((H, W), np.float32)
    todo = [t for t in rows if on_disk(t)]
    if not todo:
        raise SystemExit("no tiles on disk: run the area's point-cloud adapter first (fetch_pointcloud.py, qc_pointcloud.py)")
    t0 = time.time()
    done = []
    stats = {"raw_points": 0, "noise": 0, "dropped": 0, "water_points": 0, "ground_points": 0}
    pool = ProcessPoolExecutor(workers) if workers > 1 else None
    try:
        # the tiles that make their own ground lend their neighbours its rim first
        lenders = [t for t in todo if t["ground"] == "class"]
        rims = dict(zip((t["name"] for t in lenders), in_order(pool, ground_rim, lenders, 2 * workers)))
        if lenders:
            print(f"  ground rims of {len(lenders)} tiles · {time.time() - t0:5.0f} s", flush=True)
        jobs = ((t, borrow(t, rims, todo)) for t in todo)
        for t, m in zip(todo, in_order(pool, measure, jobs, 2 * workers)):
            for k in stats:
                stats[k] += m.get(k, 0)
            ny, nx = m["density"].shape
            c0 = int((t["bounds"][0] - x0) / CELL)
            r0 = int((ytop - t["bounds"][3]) / CELL)
            win = (slice(r0, r0 + ny), slice(c0, c0 + nx))
            gap = m.get("gap_frac")
            if gap is None:
                ok = (m["density"] >= t["minDensity"]) & (m["water_frac"] <= 1 - MIN_LAND)
            else:  # a gap in the cloud is no more land to measure than water is
                ok = (m["density"] >= t["minDensity"]) & (m["water_frac"] + gap <= 1 - MIN_LAND)
                gaps[win] = gap
            for k in grids:
                if k == "water_frac":
                    grids[k][win] = m["water_frac"].astype(np.float32)
                    continue
                v = np.where(ok & np.isfinite(m[k]), m[k], NODATA)
                if k in ("understory", "understory_pad"):
                    v = np.where(m["n_reach"] >= MIN_REACH, v, NODATA)
                grids[k][win] = v.astype(np.float32)
            n_reach[win] = np.minimum(m["n_reach"], 65535).astype(np.uint16)
            strata[:, win[0], win[1]] = np.minimum(m["strata"], 65535).astype(np.uint16)
            may_pool[win] = t["poolReach"]
            done.append(t["name"])
            print(f"  {len(done):3d} {t['name']}{' (band)' if t['laz'].name.endswith('.band.laz') else ''}  {m['raw_points'] / 1e6:5.1f} M pts · {time.time() - t0:5.0f} s", flush=True)
    finally:
        if pool:
            pool.shutdown(cancel_futures=True)
    if gaps.any():
        joined, unknown = settle_gaps(grids["water_frac"], gaps)
        print(f"  gaps in the cloud: {joined} cells joined to the lidar's water, {unknown} left to the area's waterbodies")
    if may_pool.any():
        n = pool_short(grids, strata, may_pool)
        print(f"  understory from the 3x3 cells round {n} cells short of {MIN_REACH} returns below 3 m ({n / max(int((grids['density'] >= 0).sum()), 1):.1%} of those with values)")
    # water: the lidar's own where there is lidar, the area's waterbodies elsewhere
    have = grids["water_frac"] >= 0
    water = np.where(have, grids["water_frac"] >= 0.5, water_mask(transform, W, H, crs))
    np.savez_compressed(
        NPZ,
        **grids,
        n_reach=n_reach,
        strata=strata,
        strata_edges=STRATA_EDGES,
        water=water,
        transform=np.array(transform)[:6],
        crs=crs,
        nodata=NODATA,
        cell_m=CELL,
        tiles=np.array(done),
        source=describe(todo)["source"],
    )
    print(f"wrote {NPZ.name} ({NPZ.stat().st_size / 1e6:.1f} MB, {len(done)} tiles, {W}x{H} cells) in {time.time() - t0:.0f} s")
    print(
        f"  {stats['raw_points'] / 1e9:.2f} G points: {stats['noise']} noise, {stats['water_points']} on water, {stats['dropped']} out of height range"
        + (f", {stats['ground_points'] / 1e6:.0f} M ground returns for the ground models" if stats["ground_points"] else "")
    )
    return stats


def load() -> dict:
    z = np.load(NPZ, allow_pickle=True)
    return {k: z[k] for k in z.files}


# ---- display raster -----------------------------------------------------

# Understory ratio classes and colours (ColorBrewer YlOrRd; open ground
# faint). Upper bounds; the last is open-ended. Breaks sit near the land
# quantiles (5/25/50/75/90 % = 0.12/0.29/0.44/0.63/0.78) and the FRI
# classes: open muskeg ~0.12, mature conifer ~0.38, hardwood-leading ~0.59,
# alder brush and young stands ~0.7. Pickle Lake's, and every area's: the
# same values mean the same bush everywhere (see the docstring).
RAMP = [
    (0.15, (255, 255, 178, 60)),  # open: little between knee and head height
    (0.30, (254, 217, 118, 110)),  # light
    (0.45, (254, 178, 76, 145)),  # moderate
    (0.60, (253, 141, 60, 170)),  # thick
    (0.75, (240, 59, 32, 190)),  # very thick
    (9.99, (189, 0, 38, 205)),  # thicket: three quarters stopped by 3 m
]


# The same classes drawn for a bow (the app's Bow view): open and light
# ground left clear, so the imagery shows through where an arrow would, and
# thicker bush shaded ever darker, as it is to see into. Dark, not a colour,
# so it adds contrast instead of a wash, and leaves the warm colours to the
# scent cone.
LANES_RAMP = [
    (0.30, (0, 0, 0, 0)),  # open and light: a lane
    (0.45, (12, 16, 28, 70)),  # moderate
    (0.60, (12, 16, 28, 115)),  # thick
    (0.75, (12, 16, 28, 155)),  # very thick
    (9.99, (12, 16, 28, 190)),  # thicket
]


def colourise(v: np.ndarray, ramp=RAMP) -> np.ndarray:
    out = np.zeros((*v.shape, 4), np.uint8)
    lo = -np.inf
    valid = np.isfinite(v)
    for hi, rgba in ramp:
        m = valid & (v >= lo) & (v < hi)
        out[m] = rgba
        lo = hi
    return out


SHORE_FILL_CELLS = 3  # how far the land's values are carried out over the water before the 1 m cut


def extend_over_water(v: np.ndarray, water: np.ndarray, cells: int) -> np.ndarray:
    """The nearest land value carried up to `cells` cells out over the water,
    so the tiles' bilinear field runs on past the shore instead of stopping
    on the 10 m grid; the 1 m lake mask then cuts it at the water's edge."""
    gap = ~np.isfinite(v)
    dist, (iy, ix) = distance_transform_edt(gap, return_indices=True)
    fill = gap & water & (dist <= cells)
    out = v.copy()
    out[fill] = v[iy[fill], ix[fill]]
    return out


def render_tiles(d: dict, layers: tuple[str, ...] = ("understory", "lanes")) -> None:
    under = np.where((d["understory"] >= 0) & ~d["water"], d["understory"], np.nan).astype(np.float32)
    under = extend_over_water(under, d["water"], SHORE_FILL_CELLS)
    transform = rasterio.Affine(*d["transform"])
    crs = str(d["crs"])
    used = set(str(n) for n in d["tiles"])
    info = describe([t for t in tiles() if t["name"] in used])
    # the lakes at 1 m, taken to 2 m (the z16 tiles are 2.4 m a pixel): where the tiles stop at the shore
    wet = None
    if lakes.MASK_NPZ.exists() or (OUT_DIR / f"waterbody-{REGION['id']}.geojson").exists():
        wet, wtr, wcrs = lakes.lake_mask_1m()
        h, w = (wet.shape[0] // 2) * 2, (wet.shape[1] // 2) * 2
        wet = wet[:h, :w].reshape(h // 2, 2, w // 2, 2).mean(axis=(1, 3))
        wtr = wtr * rasterio.Affine.scale(2)
    else:
        print(f"  (no waterbody-{REGION['id']}.geojson yet: the tiles stop at the lidar's own 10 m water, not the 1 m shore)")

    def in_core(z, x, y):
        return (
            lon_to_tile(CORE["west"], z) <= x <= lon_to_tile(CORE["east"] - 1e-9, z)
            and lat_to_tile(CORE["north"], z) <= y <= lat_to_tile(CORE["south"] + 1e-9, z)
        )

    def render(z, x, y):
        if not in_core(z, x, y):
            return None
        b = tile_bounds_3857(z, x, y)
        dst = np.full((256, 256), np.nan, np.float32)
        reproject(
            source=under,
            destination=dst,
            src_transform=transform,
            src_crs=crs,
            src_nodata=np.nan,
            dst_transform=from_bounds(*b, 256, 256),
            dst_crs="EPSG:3857",
            dst_nodata=np.nan,
            resampling=Resampling.bilinear,
        )
        if not np.isfinite(dst).any():
            return None
        lake = np.zeros((256, 256), np.float32)
        if wet is not None:
            reproject(
                source=wet,
                destination=lake,
                src_transform=wtr,
                src_crs=wcrs,
                dst_transform=from_bounds(*b, 256, 256),
                dst_crs="EPSG:3857",
                resampling=Resampling.bilinear,
            )
        return dst, lake

    for name, ramp in (("understory", RAMP), ("lanes", LANES_RAMP)):
        if name not in layers:
            continue

        def tile(z, x, y, ramp=ramp):
            got = render(z, x, y)
            if got is None:
                return None
            dst, lake = got
            rgba = colourise(dst, ramp)
            # cut at the lake's edge, softly
            rgba[..., 3] = (rgba[..., 3] * (1 - lake)).astype(np.uint8)
            # a tile that is all lane is nothing to draw
            return rgba if rgba[..., 3].any() else None

        path = OUT_DIR / f"{name}-{REGION['id']}.pmtiles"
        write_raster_pmtiles(path, f"{name}-{REGION['id']}", info["attribution"], REGION_MAXZOOM + 1, CORE["maxzoom"], tile)
        if info["own"]:  # for the coverage report (Ontario's comes from bake_area.py's defaults)
            note_source(path.name, source=info["source"], licence=info["licence"] or None, vintage=info["vintage"])


# ---- sanity check against the forest map -------------------------------------


def fri_classes(p: dict) -> str | None:
    poly, yr, cc, conif, hard = p.get("poly"), p.get("year") or 0, p.get("cc") or 0, p.get("conif") or 0, p.get("hard") or 0
    if poly == "WAT":
        return "water (FRI WAT)"
    if poly == "OMS":
        return "open muskeg (OMS)"
    if poly == "TMS":
        return "treed muskeg (TMS)"
    if poly == "BSH":
        return "brush / alder (BSH)"
    if poly != "FOR":
        return None
    if p.get("group") in ("cut", "burn") or yr >= 1985:
        return "young forest, origin 1985+ or cut/burn"
    if conif >= 70 and 0 < yr <= 1945 and cc >= 70:
        return "mature closed conifer (origin <=1945, cc>=70)"
    if conif >= 70 and 0 < yr <= 1945 and cc < 60:
        return "mature open conifer (origin <=1945, cc<60)"
    if hard >= 50 and 0 < yr <= 1960:
        return "mature hardwood-leading (origin <=1960)"
    return None


def check(d: dict) -> dict:
    """Stand types of the area's forest map (the FRI normal form,
    build_forest.py; Quebec's map comes in the same form) against the
    lidar's values inside them."""
    src = OUT_DIR / f"forest-{REGION['id']}.geojson"
    if not src.exists():
        print(f"  (no {src.name} yet: nothing to check the lidar against)")
        return {}
    transform = rasterio.Affine(*d["transform"])
    crs = str(d["crs"])
    H, W = d["density"].shape
    fc = json.loads(src.read_text(encoding="utf-8"))
    feats = [(f, fri_classes(f["properties"])) for f in fc["features"]]
    feats = [(f, c) for f, c in feats if c]
    # stand id raster: cells whose centre is in a stand
    shapes = [(transform_geom("EPSG:4326", crs, f["geometry"]), i + 1) for i, (f, _) in enumerate(feats)]
    sid = rasterize(shapes, out_shape=(H, W), transform=transform, fill=0, dtype="int32") if shapes else np.zeros((H, W), np.int32)
    # only cells whose 8 neighbours are the same stand: no half-and-half edge cells
    interior = (minimum_filter(sid, size=3) == maximum_filter(sid, size=3)) & (sid > 0)
    valid = d["density"] >= 0
    out = {}
    names = sorted({c for _, c in feats})
    for name in names:
        ids = np.array([i + 1 for i, (_, c) in enumerate(feats) if c == name])
        m = interior & valid & np.isin(sid, ids)
        if m.sum() < 10:
            continue
        row = {"cells": int(m.sum()), "stands": int(len(np.unique(sid[m])))}
        for k in ("canopy_height", "canopy_cover", "understory", "understory_pad", "density"):
            v = d[k][m]
            v = v[v >= 0]
            if v.size:
                row[k] = {q: round(float(np.percentile(v, p)), 3) for q, p in (("p25", 25), ("median", 50), ("p75", 75))}
        out[name] = row
    # water: the lidar's water cells inside the fetched tiles; returns there are dropped
    m = d["water"] & (d["water_frac"] >= 0)
    if m.any():
        out["water (DEM-flattened)" if JURISDICTION == "ON" else "water (lidar)"] = {"cells": int(m.sum()), "share_with_any_value": round(float((d["density"][m] >= 0).mean()), 4)}
    # the forest map's stand height against the lidar's p95, stand medians
    pairs = []
    for i, (f, c) in enumerate(feats):
        ht = f["properties"].get("ht")
        if not ht or f["properties"].get("poly") != "FOR":
            continue
        m = interior & valid & (sid == i + 1)
        if m.sum() >= 10:
            pairs.append((ht, float(np.median(d["canopy_height"][m])), (f["properties"].get("cc") or 0), float(np.median(d["canopy_cover"][m]))))
    if len(pairs) >= 5:
        a = np.array(pairs)
        out["_fri_vs_lidar"] = {
            "stands": len(pairs),
            "height_r": round(float(np.corrcoef(a[:, 0], a[:, 1])[0, 1]), 3),
            ("height_median_diff_m (lidar2021 - fri2010)" if JURISDICTION == "ON" else "height_median_diff_m (lidar - forest map)"): round(
                float(np.median(a[:, 1] - a[:, 0])), 2
            ),
            "closure_vs_cover_r": round(float(np.corrcoef(a[:, 2], a[:, 3])[0, 1]), 3) if a[:, 2].std() > 0 else None,
        }
    return out


def main(argv: list[str]) -> None:
    workers = int(argv[argv.index("--workers") + 1]) if "--workers" in argv else WORKERS
    if "--lanes" in argv:
        return render_tiles(load(), ("lanes",))
    if "--tiles" not in argv:
        build(workers)
    d = load()
    render_tiles(d)
    summary = check(d)
    SUMMARY.write_text(json.dumps(summary, indent=1))
    for k, v in summary.items():
        if k.startswith("_"):
            print(k, v)
            continue
        med = lambda key: v.get(key, {}).get("median", float("nan"))  # noqa: E731
        if "canopy_height" not in v:
            print(f"{k:48s} {v}")
            continue
        print(f"{k:48s} {v['cells']:6d} cells  height {med('canopy_height'):5.1f} m  cover {med('canopy_cover'):.2f}  understory {med('understory'):.2f}  pad {med('understory_pad'):.2f}")


if __name__ == "__main__":
    main(sys.argv[1:])
