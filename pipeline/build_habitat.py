"""The habitat grid: everything the Spots scorer needs about a place, on a
30 m lon/lat lattice over the region, in one small file the phone keeps.

Inputs (all already on disk after rasters.py and the area's vector and
forest adapters: build_vectors.py and build_forest.py in Ontario,
qc_vectors.py and qc_forest.py in Quebec):
  raw/mrdem-<region>.npz         NRCan MRDEM 30 m DTM (EPSG:3979)
  raw/landcover-<region>.npz     NRCan 2020 land cover 30 m (EPSG:3979)
  data/forest-<region>.geojson   forest stands: species, age, height, closure
  data/waterbody-…, watercourse-…, wetland-…, roads-…, fire-…, ara-… (Ontario only)
  raw/vegstructure-<region>.npz  the point cloud, where one was fetched: stand height
                                 and closure wherever it measured (measured_canopy),
                                 and the understory for an area whose bake.habitatBush
                                 is "pointcloud" (measured_bush)

Output: app/public/data/habitat-<region>.hab — gzip of
  [u32 header length][JSON header][band 0][band 1]…
each band a row-major array over the grid (rows north→south). The header
lists every band with its dtype, scale and meaning, plus the lakes and
what the Aquatic Resource Area survey knows about them. The browser side
(app/src/spots/habitatGrid.ts) reads the header and never hard-codes
offsets.

Everything a rule in docs/HUNT-FISH-SCIENCE.md needs is precomputed here
as a static feature; the weather, the hour and the season are applied in
the browser. Estimated lake depth is a shape model (distance from shore,
calibrated to the survey's mean and maximum depth) because the camp lakes
have no digitised contours; it is labelled as an estimate everywhere.

    python pipeline/build_habitat.py
"""

from __future__ import annotations

import gzip
import json
import sys
import math
import struct
import time
from datetime import date
from pathlib import Path

import numpy as np
import rasterio
import shapely
from habfile import write_hab
from habfile import write_hab
from rasterio import features
from rasterio.transform import from_origin
from rasterio.warp import Resampling, reproject
from scipy import ndimage

from area import BAKE, LAKE_SHEETS, adapter, cached, note_source, summary_path
from common import CORE, OUT_DIR, REGION
from rasters import fetch

D_LON = 0.0004  # ≈ 29 m at 48.9° N
D_LAT = 0.00027  # ≈ 30 m
YEAR = date.today().year

W, S, E, N = REGION["west"], REGION["south"], REGION["east"], REGION["north"]
COLS = int(round((E - W) / D_LON))
ROWS = int(round((N - S) / D_LAT))
TRANSFORM = from_origin(W, N, D_LON, D_LAT)
LAT_MID = (S + N) / 2
DX_M = D_LON * 111_320 * math.cos(math.radians(LAT_MID))
DY_M = D_LAT * 110_574

# cover classes (band `cover`)
NODATA, WATER, OPEN_WET, TREED_WET, CONIFER_DENSE, CONIFER_OPEN, MIXED, HARDWOOD, SHRUB, REGEN, BARREN, ROAD = range(12)
COVER_NAMES = ["nodata", "water", "open wetland", "treed wetland", "dense conifer", "open conifer", "mixedwood", "hardwood", "shrub / alder", "young regen", "rock / barren", "road"]
# landform classes (band `landform`)
LF_FLAT, LF_RIDGE, LF_VALLEY, LF_SADDLE, LF_BENCH, LF_PEAK, LF_SLOPE = range(7)
LANDFORM_NAMES = ["flat", "ridge", "valley", "saddle", "bench", "peak", "slope"]

# NRCan 2020 land cover codes we use
LC_WATER = 18
LC_WETLAND = 14
LC_SHRUB = (8, 11)
LC_GRASS = 10
LC_BARREN = (13, 16)

CONIFER_LEAD = {"Sb", "Sw", "Bf", "Pj", "Pw", "Pr", "Cw", "La"}

# What the area's forest map already knows (bake.forest in its area file).
# Ontario's FRI is a 2010 photo inventory nobody has updated: cuts since then
# show only as shrub or bare ground in the 2020 land cover (the inferred
# cuts in main), and the fire layer adds the burns it lacks. Quebec's carte
# écoforestière carries every cut, burn and outbreak to its last update, and
# its stand ages already count the burns (qc_forest.py). There the land
# cover is not second-guessed, and a fire counts only where the map has no
# polygon at all: the map marks the burns on the ground it covers, stand or
# not (its open wetland, alder and rock carry them where they burned), and
# qc_forest lays the later ones over it. An old burn under a younger stand,
# under the survivors the photo shows, or round a fen the map left
# unburned, is not a disturbance.
FOREST_SOURCE = adapter(BAKE, "forest")
# a map that names every polygon, stand or not, and carries its own burns: Quebec's, and BC's VRI (bc_forest.py)
FOREST_UPDATED = FOREST_SOURCE in ("qc.ecoforestier", "bc.vri")
INVENTORY = {"on.fri": "FRI", "qc.ecoforestier": "carte écoforestière", "bc.vri": "VRI"}.get(FOREST_SOURCE or "", "forest map")

# Where the bush band (thick) comes from. By default the estimate from the
# forest map (bush_thickness). An area whose bake.habitatBush is
# "pointcloud" takes the point cloud's measure wherever it has one, and puts
# the estimate on the same scale elsewhere (measured_bush): at Lac Bailey
# the estimate called two thirds of the cells thick, most of them the 1991
# burn's 35-year-old regrowth, where the LiDAR finds mostly light to
# moderate bush.
BUSH_FROM_POINTCLOUD = BAKE.get("habitatBush") == "pointcloud"
# With no point cloud, the bush-thickness model (pipeline/bush, docs/BUSH-MODEL.md)
# predicts the understory from what is seen from space wherever it has been
# trained, unless the area says bake.habitatBush: "estimate". The estimate
# stays on roads and water, and where the imagery never saw the cell.
BUSH_FROM_MODEL = not BUSH_FROM_POINTCLOUD and BAKE.get("habitatBush") != "estimate"

# Stand height and closure (bands height and crown) are the point cloud's
# wherever it measured, in every area that has one (measured_canopy). A
# stand the point cloud finds open, under GAP_HEIGHT_M with under GAP_COVER
# of its returns over 2 m, is a gap the forest map cannot show: a cutline, a
# skidder trail, a blowdown, a cut since the inventory. Only the upland
# stand classes: a treed wetland's type is the map's word, and the going
# grid reads it as swamp.
STAND_CLASSES = (CONIFER_DENSE, CONIFER_OPEN, MIXED, HARDWOOD)
GAP_HEIGHT_M = 3.0
GAP_COVER = 0.2


def load_geo(theme: str) -> list[dict]:
    p = OUT_DIR / f"{theme}-{REGION['id']}.geojson"
    if not p.exists():
        print(f"  (no {p.name}, skipping)")
        return []
    return json.loads(p.read_text(encoding="utf-8"))["features"]


def geoms(feats: list[dict]) -> list[shapely.Geometry]:
    return [shapely.geometry.shape(f["geometry"]) for f in feats]


def burn(shapes, dtype=np.uint8, fill=0, all_touched=False) -> np.ndarray:
    shapes = [(g, v) for g, v in shapes if g is not None and not g.is_empty]
    if not shapes:
        return np.full((ROWS, COLS), fill, dtype=dtype)
    return features.rasterize(shapes, out_shape=(ROWS, COLS), transform=TRANSFORM, fill=fill, dtype=dtype, all_touched=all_touched)


def to_grid(src: dict, resampling: Resampling, dtype) -> np.ndarray:
    a, b, c, d, e, f = src["transform"].tolist()
    out = np.zeros((ROWS, COLS), dtype=dtype)
    nodata = float(src["nodata"]) if np.isfinite(float(src["nodata"])) else None
    reproject(
        source=src["data"],
        destination=out,
        src_transform=rasterio.Affine(a, b, c, d, e, f),
        src_crs=str(src["crs"]),
        src_nodata=nodata,
        dst_transform=TRANSFORM,
        dst_crs="EPSG:4326",
        dst_nodata=nodata if nodata is not None else 0,
        resampling=resampling,
    )
    return out


def edt_m(mask: np.ndarray) -> np.ndarray:
    """Distance in metres from every cell to the nearest True cell."""
    if not mask.any():
        return np.full(mask.shape, 1e6, dtype=np.float32)
    return ndimage.distance_transform_edt(~mask, sampling=(DY_M, DX_M)).astype(np.float32)


def q8(values: np.ndarray, step: float) -> np.ndarray:
    return np.clip(np.round(values / step), 0, 255).astype(np.uint8)


def fetch_cells(water: np.ndarray, lake_id: np.ndarray) -> dict[str, np.ndarray]:
    """For each compass direction the wind blows FROM, how many water cells
    lie upwind of every water cell before land: the fetch, in cells. The
    run stops at a lake boundary, so a channel into the next lake does not
    lend its neighbour a fetch it does not have."""
    w = water.astype(np.uint16)
    lid = np.where(water, lake_id.astype(np.int32), -1)
    out: dict[str, np.ndarray] = {}
    # (dr, dc) is the step toward where the wind comes from; row 0 is north
    steps = {"N": (-1, 0), "NE": (-1, 1), "E": (0, 1), "SE": (1, 1), "S": (1, 0), "SW": (1, -1), "W": (0, -1), "NW": (-1, -1)}

    def shifted(arr: np.ndarray, dr: int, dc: int, fill) -> np.ndarray:
        outp = np.full_like(arr, fill)
        rs = slice(max(0, -dr), arr.shape[0] - max(0, dr))
        rd = slice(max(0, dr), arr.shape[0] - max(0, -dr))
        cs = slice(max(0, -dc), arr.shape[1] - max(0, dc))
        cd = slice(max(0, dc), arr.shape[1] - max(0, -dc))
        outp[rd, cd] = arr[rs, cs]
        return outp

    for name, (dr, dc) in steps.items():
        same = lid == shifted(lid, -dr, -dc, -2)  # the upwind neighbour is the same lake
        f = np.zeros_like(w)
        if dr != 0:
            rows = range(ROWS) if dr < 0 else range(ROWS - 1, -1, -1)
            for r in rows:
                rr = r + dr
                prev = np.zeros(COLS, dtype=np.uint16)
                if 0 <= rr < ROWS:
                    src = f[rr]
                    if dc > 0:
                        prev[:-1] = src[1:]
                    elif dc < 0:
                        prev[1:] = src[:-1]
                    else:
                        prev = src
                f[r] = w[r] * (1 + prev * same[r])
        else:
            cols = range(COLS - 1, -1, -1) if dc > 0 else range(COLS)
            for c in cols:
                cc = c + dc
                prev = f[:, cc] if 0 <= cc < COLS else 0
                f[:, c] = w[:, c] * (1 + prev * same[:, c])
        out[name] = np.clip(f, 0, 255).astype(np.uint8)
    return out


def species_keys(summary: str | None) -> list[str]:
    if not summary:
        return []
    m = {
        "Walleye": "walleye",
        "Northern Pike": "pike",
        "Lake Trout": "laketrout",
        "Brook Trout": "brooktrout",
        "Lake Whitefish": "whitefish",
        "Yellow Perch": "perch",
        "Cisco": "cisco",
        "Herrings": "cisco",
        "Burbot": "burbot",
        "Smallmouth Bass": "bass",
    }
    out = []
    for s in summary.split(","):
        k = m.get(s.strip())
        if k and k not in out:
            out.append(k)
    return out


# Lead species codes, as burnt into f_lead above
LEAD_SB, LEAD_PJ, LEAD_SW, LEAD_BF, LEAD_CW, LEAD_LA, LEAD_PT, LEAD_BW = range(1, 9)


def modelled_bush(est: np.ndarray, cover: np.ndarray, map_says: np.ndarray | None = None) -> tuple[np.ndarray, np.ndarray | None, np.ndarray | None, dict]:
    """The bush band from the bush-thickness model (pipeline/bush/predict.py)
    for an area with no point cloud: the understory NRD predicted from
    satellite imagery, radar and the national rasters on this lattice, on
    the estimate's scale by the fixed curve the model documents, with the
    model's spread (80th minus 20th percentile) beside it. The estimate
    stays on water and roads and where no leaf-on imagery saw the cell. The
    header carries that curve as bushCalib, so the going grid reads the NRD
    back exactly. Returns the band, its source per cell (0 water, 2 the
    estimate, 3 the model), the spread and the header; with no model
    trained yet, the estimate as it is.

    `map_says` marks the cells where the forest map names the ground
    outright (open herb, lichen, rock, ice, open fen, a tall-shrub thicket:
    a map that knows every polygon, FOREST_UPDATED) and the model, trained
    on Ontario's boreal, has nothing to add: those keep the estimate (the
    map's word, thickSrc 2). Gavan 2026-10-08: "some layered approach with
    other inputs"."""
    sys.path.insert(0, str(Path(__file__).resolve().parent / "bush"))
    import features as F
    import predict as P

    if not P.available():
        print("  no bush model trained yet (pipeline/bush/train.py): bush from the forest-map estimate alone")
        return est, None, None, {"thickFrom": "the forest-map estimate: no bush model trained yet"}
    print("  bush from the bush model (satellite imagery, radar, national rasters) ...")
    out = P.modelled(F.Grid("EPSG:4326", TRANSFORM, COLS, ROWS))
    # kept for the map layer (pipeline/bush/render.py), so it need not pull the imagery again
    np.savez_compressed(cached(f"bushmodel-{REGION['id']}.npz"), nrd=out["nrd"], q20=out["q20"], q80=out["q80"], transform=np.array(TRANSFORM)[:6], crs=np.array("EPSG:4326"), cover=cover.astype(np.uint8), notes=np.array(json.dumps(out["notes"]["bushModel"])))
    ok = np.isfinite(out["nrd"]) & ~np.isin(cover, (WATER, ROAD))
    if map_says is not None and map_says.any():
        print(f"  the {INVENTORY} names the ground on {100 * map_says[cover != WATER].mean():.0f}% of the land (open herb, lichen, rock, fen, tall shrub): its word, not the model's, there")
        ok &= ~map_says
    thick = np.where(ok, P.to_estimate(np.nan_to_num(out["nrd"])), est).astype(np.float32)
    spread = np.where(ok, P.to_estimate(np.nan_to_num(out["q80"])) - P.to_estimate(np.nan_to_num(out["q20"])), 0).astype(np.float32)
    src = np.where(cover == WATER, 0, np.where(ok, 3, 2)).astype(np.uint8)
    print(f"  bush from the model on {100 * ok.sum() / max(1, (cover != WATER).sum()):.0f}% of the land: thick (0.7) on {100 * (thick[ok] >= 0.7).mean():.0f}% of it, the estimate said {100 * (est[ok] >= 0.7).mean():.0f}%")
    header = {
        "thickFrom": "the bush model's NRD (satellite imagery, radar, SCANFI, CanLaD, terrain; docs/BUSH-MODEL.md) on the estimate's scale where thickSrc is 3; the forest-map estimate on water, roads, cells no leaf-on imagery saw, and ground the map names outright (open herb, lichen, rock, fen, tall shrub) (thickSrc 2)",
        "bushCalib": P.calib_header(thick),
        "bushModel": out["notes"]["bushModel"],
    }
    return thick, src, spread, header


def young_thickness(age: np.ndarray) -> np.ndarray:
    """Eye-level density of regrowth by years since a cut, burn or stand
    origin (docs/HUNT-FISH-SCIENCE.md, "Bush thickness"): slash and
    raspberry first, then the stem-exclusion thicket, then self-thinning
    as the canopy lifts. NaN past 40 years: the stand type decides."""
    t = np.full(age.shape, np.nan, dtype=np.float32)
    t[age <= 40] = 0.75
    t[age <= 25] = 0.95
    t[age <= 8] = 0.7
    t[age <= 3] = 0.35
    return t


def bush_thickness(cover, stand_age, dist_age, f_cc, f_lead, f_poly, f_ht=None) -> np.ndarray:
    """Eye-level bush thickness per cell, 0 (open: see and walk) to 1 (a
    wall). An estimate from what the stand is and how old, not a
    measurement: the forest inventory describes the canopy, and the brush
    under it follows the stand's development stage (Oliver & Larson).
    Calibrate on the ground; LiDAR returns would measure it directly."""
    T = np.full(cover.shape, 0.3, dtype=np.float32)
    # mature stands by type: the understory under a closed canopy
    T[cover == CONIFER_DENSE] = 0.55  # black spruce: many small stems, low dead branches
    T[cover == CONIFER_OPEN] = 0.4
    T[cover == MIXED] = 0.5
    T[cover == HARDWOOD] = 0.45  # aspen with a hazel and maple layer
    T[cover == TREED_WET] = 0.5
    known = (f_poly == 1) & (stand_age > 0)
    old = known & (stand_age > 80)
    # understory reinitiation: the canopy opens, fir and hazel come back
    T[old & (cover == MIXED)] = 0.65
    T[old & (cover == HARDWOOD)] = 0.55
    # lead species: jack pine floors stay open (lichen and blueberry);
    # fir and cedar keep branches to the ground. That floor is the crowns'
    # share of the cell: an open subalpine fir stand at 15 % closure (BC's
    # SWB) is fir thickets with lichen flats between, not a wall, so where
    # the map gives a closure the floor runs from 0.4 at 10 % up to 0.75 at
    # 50 % and above (Gavan 2026-10-08: the estimate called 62 % of
    # Blanchard River thick where the imagery model found 5 %)
    forest = np.isin(cover, (CONIFER_DENSE, CONIFER_OPEN, MIXED, HARDWOOD, TREED_WET))
    T[forest & (f_lead == LEAD_PJ)] -= 0.15
    branchy = forest & np.isin(f_lead, (LEAD_BF, LEAD_CW))
    floor = np.where(f_cc > 0, 0.4 + 0.35 * np.clip((f_cc - 10) / 40, 0, 1), 0.75).astype(np.float32)
    T[branchy] = np.maximum(T[branchy], floor[branchy])
    # canopy closure moves the understory the other way: light makes brush
    mid = known & (stand_age > 40) & (f_cc > 0)
    T[mid & (f_cc < 40)] += 0.1
    T[mid & (f_cc >= 80)] -= 0.08
    # young stands and disturbances follow the regrowth curve, whatever the type
    yt = young_thickness(np.where(dist_age < 255, dist_age, np.where(known, stand_age, 255)).astype(np.int32))
    young = np.isfinite(yt) & (forest | (cover == REGEN) | (dist_age < 255))
    T[young] = yt[young]
    # the classes with no stand
    T[cover == SHRUB] = 0.85  # alder runs
    if f_ht is not None:  # a map that gives the shrub layer a height (BC's VRI: tall shrub 2 m+, low shrub under): knee-high scrub is not a wall
        T[(cover == SHRUB) & (f_ht > 0) & (f_ht < 2)] = 0.4
    T[cover == OPEN_WET] = 0.15  # sedge and leatherleaf, knee high
    T[cover == BARREN] = 0.1
    T[cover == ROAD] = 0.05
    T[cover == WATER] = 0.0
    T[cover == NODATA] = 0.3
    return np.clip(T, 0, 1)


def measured_bush(est: np.ndarray, cover: np.ndarray) -> tuple[np.ndarray, np.ndarray | None, dict]:
    """The bush band from the point cloud, for an area whose
    bake.habitatBush is "pointcloud": where the LiDAR measured at least half
    of a land cell, its understory (the share of the returns 0-3 m caught
    0.5-3 m, build_vegstructure.py) averaged over the cell and put on the
    estimate's scale, which is the one the Spots scorer reads (sight
    distance, thick hiding cover at 0.7). Elsewhere, and on water and roads,
    the estimate.

    The scale is the going grid's: build_going.py's calibration of the
    estimate against the LiDAR (the median NRD of each estimate value), run
    here on the estimate before it is replaced, and read backwards. So the
    habitat's bush and the going grid's are one measure, and the going grid
    takes the same calibration from this header (bushCalib) rather than
    calibrating on a band that is now partly the LiDAR's. It is read
    backwards by a fit weighted by each class's cells (going.monotone_fit),
    not the running maximum the going grid maps forwards by: one class small
    enough to be noise must not decide where thick falls.

    The cells the point cloud did not measure go onto the same scale: each
    estimate value is taken to what the LiDAR measured for it (its class's
    median) and read back the same way. Otherwise the band changes scale at
    the edge of the LiDAR: at Lac Bailey the raw estimate called 74 % of the
    land within 600 m past it thick, against 14 % inside.

    Returns the band, its source per cell (0 water, 1 the LiDAR, 2 the
    estimate) and what the header says of it. With no point cloud measured
    yet, the estimate as it is."""
    import build_going as going  # the going lattice and its calibration

    vpath = cached(f"vegstructure-{REGION['id']}.npz")
    lidar = going.lidar_layers(vpath)
    if lidar is None:
        print(f"  bake.habitatBush is pointcloud, but there is no {vpath.name} yet: bush from the forest-map estimate alone")
        return est, None, {"thickFrom": f"the forest-map estimate: no point cloud measured yet ({vpath.name})"}
    calib = going.calibration(going.crop(est), going.crop(cover), lidar[0])
    curve = going.curve_of(calib)
    own = curve is not going.PICKLE_CALIB
    back = going.monotone_fit(calib) if own else curve  # Pickle Lake's medians come without their cells

    # the 10 m cells averaged into each 30 m one: the understory over its land, and
    # how much of the cell the point cloud saw at all (land measured, or its water)
    v = np.load(vpath, allow_pickle=True)
    water10 = v["water"].astype(bool)
    land10 = (v["understory"] >= 0) & ~water10
    src = {"src_transform": rasterio.Affine(*v["transform"]), "src_crs": str(v["crs"]), "dst_transform": TRANSFORM, "dst_crs": "EPSG:4326"}
    under = np.full((ROWS, COLS), np.nan, dtype=np.float32)
    reproject(source=np.where(land10, v["understory"], np.nan).astype(np.float32), destination=under, src_nodata=np.nan, dst_nodata=np.nan, resampling=Resampling.average, **src)
    seen = np.zeros((ROWS, COLS), dtype=np.float32)
    reproject(source=(land10 | water10).astype(np.float32), destination=seen, resampling=Resampling.average, **src)
    ok = (seen >= 0.5) & np.isfinite(under) & (cover != WATER) & (cover != ROAD)

    thick = np.where(ok, going.estimate_from_lidar(under, back), est).astype(np.float32)
    thick_src = np.where(cover == WATER, 0, np.where(ok, 1, 2)).astype(np.uint8)
    rest = (thick_src == 2) & (cover != ROAD)
    if own:
        # through the class medians themselves (interpolated between classes), not the fit:
        # the fit pools half the classes into one level, which would read back as one value
        xs, meds = np.array([c[0] for c in calib]), np.array([c[1] for c in calib])
        thick[rest] = going.estimate_from_lidar(np.interp(est[rest], xs, meds), back)
        by = "reading backwards a monotone fit of bushCalib's medians weighted by their cells (pool adjacent violators)"
    else:
        by = "Pickle Lake's calibration, too little point cloud here to calibrate on"
    t = going.estimate_from_lidar(np.linspace(0, 1, 1001), back) >= 0.7 - 1e-6
    at = f"NRD {np.argmax(t) / 1000:.2f} up" if t.any() else "no NRD"
    print(f"  bush from the point cloud on {ok.sum()} cells ({100 * ok.sum() / (cover != WATER).sum():.0f}% of the land), by {by}: " + ", ".join(f"{a:.2f}->{b:.2f}" for a, b in back) + f"; thick (0.7) is {at}")
    if ok.any():
        print(f"  in those cells the estimate called {100 * (est[ok] >= 0.7).mean():.0f}% thick, the point cloud {100 * (thick[ok] >= 0.7).mean():.0f}%")
    if own and rest.any():
        print(f"  the estimate's land cells through their classes' LiDAR medians: {100 * (thick[rest] >= 0.7).mean():.0f}% thick, was {100 * (est[rest] >= 0.7).mean():.0f}%")
    if own:
        thick_from = (
            f"LiDAR NRD where the point cloud measured the cell (thickSrc 1), on the estimate's scale by {by}. Elsewhere (thickSrc 2; roads "
            "keep theirs) the forest-map estimate taken to its class's LiDAR median in bushCalib and read back the same way, so both are on "
            "one scale; an estimate cell carries only its class's median, not the spread the LiDAR finds within a class, which the forest "
            "map cannot resolve, so fewer estimate cells read thick"
        )
    else:
        thick_from = f"LiDAR NRD where the point cloud measured the cell (thickSrc 1), on the estimate's scale by {by}; elsewhere the forest-map estimate (thickSrc 2)"
    header = {"thickFrom": thick_from, "bushCalib": [[a, b, n] for a, b, n in calib]}
    return thick, thick_src, header


def measured_canopy(f_ht: np.ndarray, f_cc: np.ndarray, cover: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray | None, dict]:
    """Stand height and crown closure from the point cloud wherever it
    measured the cell, the forest map's elsewhere (docs/MICRO-WIND-LIDAR.md,
    phase 2). The map gives a polygon one height and closure out to its
    edge, as they were at the inventory. The point cloud's 10 m cells
    (build_vegstructure.py: canopy_height, the p95 of the returns over 2 m,
    and canopy_cover, their share of all returns) find the cutlines, trails
    and gaps inside it, and the growth and harvest since. A 30 m cell takes
    their average over the 10 m cells with a value, where those cover half
    of it or more.

    The cover class stays the map's: species and wetland type come from it,
    and the LiDAR cannot tell spruce from poplar. The exception is a gap
    (one of STAND_CLASSES under GAP_HEIGHT_M and GAP_COVER), made young
    regen in place so that the Spots scorer and the wind both read it as
    open. The distances and browse the habitat derives from the cover
    afterwards see the gaps; the bush estimate does not (main says why).

    Returns the height and crown bands, canopySrc (0 the map, 1 the point
    cloud; None with no point cloud, and then no band is written) and what
    the header and the summary say of it."""
    vpath = cached(f"vegstructure-{REGION['id']}.npz")
    if not vpath.exists():
        print(f"  (no vegstructure: {INVENTORY} heights)")
        return f_ht, f_cc, None, {}
    v = np.load(vpath, allow_pickle=True)
    have10 = v["canopy_height"] != float(v["nodata"])  # canopy_cover has its values in the same cells
    src = {"src_transform": rasterio.Affine(*v["transform"]), "src_crs": str(v["crs"]), "dst_transform": TRANSFORM, "dst_crs": "EPSG:4326"}

    def averaged(key: str) -> np.ndarray:
        out = np.full((ROWS, COLS), np.nan, dtype=np.float32)
        reproject(source=np.where(have10, v[key], np.nan).astype(np.float32), destination=out, src_nodata=np.nan, dst_nodata=np.nan, resampling=Resampling.average, **src)
        return out

    ch, cc = averaged("canopy_height"), averaged("canopy_cover")
    # the share of each cell under 10 m cells with a value. GDAL averages only the source cells a cell
    # overlaps, so a cell half off the edge of the point cloud's grid would read as wholly measured: a
    # ring of empty cells round the grid counts the part beyond the edge as no value
    ring = 4
    valid = np.zeros((ROWS, COLS), dtype=np.float32)
    beyond = {**src, "src_transform": src["src_transform"] * rasterio.Affine.translation(-ring, -ring)}
    reproject(source=np.pad(have10, ring).astype(np.float32), destination=valid, resampling=Resampling.average, **beyond)
    lidar = (valid >= 0.5) & np.isfinite(ch) & np.isfinite(cc)
    height = np.where(lidar, np.clip(np.round(np.nan_to_num(ch)), 0, 255), f_ht).astype(np.uint8)
    crown = np.where(lidar, np.clip(np.round(np.nan_to_num(cc) * 100), 0, 100), f_cc).astype(np.uint8)

    # the two against each other, on the map's classes before any gap is taken out
    def mean(a: np.ndarray, m: np.ndarray) -> float | None:
        return round(float(a[m].mean()), 1) if m.any() else None

    land = cover != WATER
    stood = np.isin(cover, (*STAND_CLASSES, TREED_WET))
    stands = lidar & stood & (f_ht > 0)  # the map's stands and treed wetlands with a height: like against like
    print(
        f"  stand height and closure from the point cloud on {lidar.sum()} cells ({100 * (lidar & land).sum() / land.sum():.0f}% of the land): "
        f"height {mean(f_ht, lidar)} m by the {INVENTORY}, {mean(height, lidar)} m by the LiDAR; closure {mean(f_cc, lidar)}% and {mean(crown, lidar)}%"
    )
    print(f"  under the {INVENTORY}'s stands with a height ({stands.sum()} cells): height {mean(f_ht, stands)} m against {mean(height, stands)} m, closure {mean(f_cc, stands)}% against {mean(crown, stands)}%")
    by_cover = {}
    for k in (*STAND_CLASSES, TREED_WET):
        m = stands & (cover == k)
        if m.any():
            by_cover[COVER_NAMES[k]] = {"cells": int(m.sum()), "heightM": [mean(f_ht, m), mean(height, m)], "closurePct": [mean(f_cc, m), mean(crown, m)]}

    # the gaps
    gap = lidar & np.isin(cover, STAND_CLASSES) & (ch < GAP_HEIGHT_M) & (cc < GAP_COVER)
    gap_from = {COVER_NAMES[k]: int((gap & (cover == k)).sum()) for k in STAND_CLASSES}
    cover[gap] = REGEN
    print(f"  {gap.sum()} stand cells the point cloud finds open (under {GAP_HEIGHT_M:g} m, under {GAP_COVER:g} of the returns over 2 m) are young regen now: " + ", ".join(f"{n} {k}" for k, n in gap_from.items() if n))

    # the wind's tree-line and slot rules take a stand of 6 m or more for a wall (app/src/weather/micro/model.ts)
    c0, c1 = math.floor((CORE["west"] - W) / D_LON), math.ceil((CORE["east"] - W) / D_LON)
    r0, r1 = math.floor((N - CORE["north"]) / D_LAT), math.ceil((N - CORE["south"]) / D_LAT)
    core = np.zeros((ROWS, COLS), dtype=bool)
    core[r0:r1, c0:c1] = True
    stands_now = np.isin(cover, (*STAND_CLASSES, TREED_WET))
    opened = core & stood & (f_ht >= 6) & ~(stands_now & (height >= 6))
    walled = core & stood & (f_ht > 0) & (f_ht < 6) & stands_now & (height >= 6)
    print(f"  in the core, {opened.sum()} cells of 6 m stands or more by the {INVENTORY} are under 6 m or gaps by the LiDAR, open to the wind's tree-line and slot rules; {walled.sum()} the other way")

    source = str(v["source"]) if "source" in v.files else "the area's point cloud"
    summary = {
        "from": source,
        "lidarCells": int(lidar.sum()),
        "lidarShareOfLand": round(float((lidar & land).sum() / land.sum()), 3),
        "lidarShareOfCoreLand": round(float((lidar & land & core).sum() / (land & core).sum()), 3),
        "meanHeightM": {"inventory": mean(f_ht, lidar), "lidar": mean(height, lidar)},
        "meanClosurePct": {"inventory": mean(f_cc, lidar), "lidar": mean(crown, lidar)},
        "inStands": {"cells": int(stands.sum()), "meanHeightM": {"inventory": mean(f_ht, stands), "lidar": mean(height, stands)}, "meanClosurePct": {"inventory": mean(f_cc, stands), "lidar": mean(crown, stands)}},
        "byCover": by_cover,
        "gapsToRegen": int(gap.sum()),
        "gapsFrom": gap_from,
        "coreUnder6m": {"opened": int(opened.sum()), "walled": int(walled.sum())},
    }
    return height, crown, lidar.astype(np.uint8), {"source": source, "summary": summary}


SURVEY_DIR = Path(__file__).parent / "raw" / "bathy"


def apply_survey_depths(depth_est: np.ndarray, lake_id: np.ndarray, lakes: list[dict]) -> int:
    """Where survey_depth.py has turned a lake's MNR sheet into a depth
    raster (raw/bathy/<id>_depth.tif, tagged with the lake name), its
    depths replace the shape model on that lake: averaged into each 30 m
    cell, and carried by nearest neighbour to lake cells the sheet's
    outline just misses. Only the area's own sheets (bake.lakeSheets), so
    another area's lake of the same name is never given them. Returns how
    many lakes were replaced."""
    by_name = {(l.get("name") or "").lower(): l for l in lakes}
    n = 0
    for tif in sorted(p for p in (SURVEY_DIR / f"{s}_depth.tif" for s in LAKE_SHEETS) if p.exists()):
        with rasterio.open(tif) as ds:
            name = ds.tags().get("lake", "")
            lk = by_name.get(name.lower())
            if not lk:
                print(f"  {tif.name}: lake {name!r} not in this grid, skipped")
                continue
            grid = np.full((ROWS, COLS), np.nan, dtype=np.float32)
            reproject(
                source=rasterio.band(ds, 1),
                destination=grid,
                dst_transform=TRANSFORM,
                dst_crs="EPSG:4326",
                resampling=Resampling.average,
                src_nodata=np.nan,
                dst_nodata=np.nan,
            )
            tags = ds.tags()
        cells = lake_id == lk["id"]
        have = cells & np.isfinite(grid)
        if have.sum() < 0.5 * cells.sum():
            print(f"  {tif.name}: covers only {have.sum()}/{cells.sum()} cells of {name}, skipped")
            continue
        _, (iy, ix) = ndimage.distance_transform_edt(~have, return_indices=True)
        fill = grid[iy, ix]
        depth_est[cells] = np.clip(np.round(fill[cells] * 4), 0, 254).astype(np.uint8)
        lk["depthSurvey"] = {"sheet": tags.get("source", tif.name).replace("_geo.tif", ""), "max": float(tags.get("max_m") or 0) or None}
        n += 1
    return n


def main() -> None:
    t0 = time.time()
    print(f"grid {COLS}×{ROWS} cells of {DX_M:.0f}×{DY_M:.0f} m over {REGION['name']}")

    # ---- rasters ----
    dem = to_grid(fetch("mrdem"), Resampling.bilinear, np.float32)
    lc = to_grid(fetch("landcover"), Resampling.nearest, np.uint8)
    dem = np.where(dem < -1000, np.nan, dem)
    if np.isnan(dem).any():
        dem = np.where(np.isnan(dem), np.nanmedian(dem), dem)

    # ---- vectors ----
    wb = load_geo("waterbody")
    wc = load_geo("watercourse")
    wet = load_geo("wetland")
    roads = load_geo("roads")
    fire = load_geo("fire")
    forest = load_geo("forest")
    ara = load_geo("ara")

    wb_geoms = geoms(wb)
    lake_idx = [i for i, f in enumerate(wb) if f["properties"].get("WATERBODY_TYPE") in ("Lake", "Pond")]
    lake_id = burn([(wb_geoms[i], k + 1) for k, i in enumerate(lake_idx)], dtype=np.uint16)
    water = burn([(g, 1) for g in wb_geoms]).astype(bool)
    water |= lc == LC_WATER
    stream = burn([(g, 1) for g in geoms(wc)], all_touched=True).astype(bool)
    wetland = burn([(g, 1) for g in geoms(wet)]).astype(bool)
    road = burn([(g, 1) for g in geoms(roads)], all_touched=True).astype(bool)
    fire_year = burn([(g, int(f["properties"].get("FIRE_YEAR") or 0)) for g, f in zip(geoms(fire), fire)], dtype=np.uint16)

    fg = geoms(forest)
    fp = [f["properties"] for f in forest]
    poly_code = {"FOR": 1, "OMS": 2, "TMS": 3, "BSH": 4, "WAT": 5, "GRS": 6, "ISL": 7, "UCL": 8}
    f_poly = burn([(g, poly_code.get(p["poly"], 0)) for g, p in zip(fg, fp)])
    f_year = burn([(g, int(p["year"] or 0)) for g, p in zip(fg, fp)], dtype=np.uint16)
    f_ht = burn([(g, int(round(p["ht"] or 0))) for g, p in zip(fg, fp)])
    f_cc = burn([(g, int(p["cc"] or 0)) for g, p in zip(fg, fp)])
    f_conif = burn([(g, int(p["conif"] or 0)) for g, p in zip(fg, fp)])
    f_hard = burn([(g, int(p["hard"] or 0)) for g, p in zip(fg, fp)])
    f_dep = burn([(g, int(p["dep"] or 0)) for g, p in zip(fg, fp)], dtype=np.uint16)
    lead_code = {"Sb": 1, "Pj": 2, "Sw": 3, "Bf": 4, "Cw": 5, "La": 6, "Pt": 7, "Bw": 8, "Po": 7}
    f_lead = burn([(g, lead_code.get((p["species"] or "  ")[:2], 0)) for g, p in zip(fg, fp)])
    # the FRI's rock polygons (none at Pickle Lake; Quebec's dénudé sec): no stand, so the
    # land cover speaks first, and what it leaves unnamed (at Lac Bailey mostly its
    # grassland class, which has no cover here) is barren rather than nodata
    f_rock = burn([(g, 1) for g, p in zip(fg, fp) if p["poly"] == "RCK"]).astype(bool)
    # every cell under a polygon of the map, stand or not (f_poly is 0 under poly ''), for a
    # map that knows its own burns (FOREST_UPDATED)
    f_mapped =burn([(g, 1) for g in fg]).astype(bool) if FOREST_UPDATED else np.zeros((ROWS, COLS), dtype=bool)
    print(f"  vectors burnt · {time.time() - t0:.0f}s")

    # ---- disturbance age: burns, the forest map's depletions, and (FRI) cuts the 2020 land cover shows on 2010 forest ----
    dist_age = np.full((ROWS, COLS), 255, dtype=np.uint8)
    fy = np.where(fire_year > 0, YEAR - fire_year.astype(int), 255)
    if FOREST_UPDATED:  # the map dates the burns on all the ground it covers
        fy = np.where(f_mapped, 255, fy)
    dy = np.where(f_dep > 0, YEAR - f_dep.astype(int), 255)
    inferred_cut = np.zeros((ROWS, COLS), dtype=bool)
    if not FOREST_UPDATED:
        inferred_cut = (f_poly == 1) & (f_year > 0) & (f_year < 2000) & (np.isin(lc, LC_SHRUB) | np.isin(lc, LC_BARREN)) & ~water & ~wetland
    ic = np.where(inferred_cut, YEAR - 2015, 255)
    dist_age = np.minimum(np.minimum(fy, dy), ic).clip(0, 255).astype(np.uint8)

    # ---- cover class ----
    cover = np.zeros((ROWS, COLS), dtype=np.uint8)
    is_for = f_poly == 1
    cover[is_for & (f_conif >= 70) & (f_cc < 60)] = CONIFER_OPEN
    cover[is_for & (f_conif >= 70) & (f_cc >= 60)] = CONIFER_DENSE
    cover[is_for & (f_conif < 70) & (f_conif > 30)] = MIXED
    cover[is_for & (f_conif <= 30) & (f_hard > 0)] = HARDWOOD
    cover[(f_poly == 0) & np.isin(lc, (1, 2))] = CONIFER_DENSE  # no stand on the forest map: land cover only
    cover[(f_poly == 0) & (lc == 6)] = MIXED
    cover[(f_poly == 0) & (lc == 5)] = HARDWOOD
    cover[f_poly == 4] = SHRUB
    cover[(cover == 0) & np.isin(lc, LC_SHRUB)] = SHRUB
    cover[f_poly == 3] = TREED_WET
    if FOREST_UPDATED:
        # Quebec's map says what each polygon with no stand is (qc_forest.POLYTYPE):
        # its UCL is ground kept open (power lines, roads, pits, camps) and its RCK
        # dry rock and lichen. Both are open ground, as the point cloud reads them,
        # whatever the 30 m land cover makes of a power line's strip (shrubland) or
        # the rock's scattered spruce (forest). The FRI's UCL is anything
        # unclassified, and stays the land cover's to read.
        cover[(f_poly == 8) | f_rock] = BARREN
    cover[(f_poly == 2) | ((cover == 0) & (lc == LC_WETLAND))] = OPEN_WET
    # Quebec's wetlands are drawn from the same forest map (MELCCFP, from the IEQM): where
    # the map has its own word for the ground, an alder swamp or a treed bog, the wetland is
    # that and not an open one (the point cloud: 4.7 m alder over 0.43 of understory, and
    # 9 m trees over 0.48 cover, at Lac Bailey). It still counts as wetland for distWetland.
    own_word = np.isin(f_poly, (3, 4)) if FOREST_UPDATED else np.zeros((ROWS, COLS), dtype=bool)
    cover[wetland & ~is_for & ~own_word] = OPEN_WET
    cover[np.isin(lc, LC_BARREN) & (cover == 0)] = BARREN
    cover[f_rock & (cover == 0)] = BARREN
    if FOREST_UPDATED:
        # what is still unnamed under a polygon of the map (mostly one with no stand
        # described) where the land cover says grassland, a class with no cover of its own:
        # at Lac Bailey the 1991 burn's open regrowth, which would otherwise score as no
        # habitat at all. Not under the map's water and islands, a case of their own.
        cover[f_mapped & ~np.isin(f_poly, (5, 7)) & (cover == 0) & (lc == LC_GRASS)] = SHRUB
    cover[(dist_age <= 5)] = REGEN
    cover[inferred_cut] = REGEN
    cover[water] = WATER
    cover[road & ~water] = ROAD

    stand_age = np.where(f_year > 0, YEAR - f_year.astype(int), 0)
    stand_age = np.where(dist_age < 255, dist_age, stand_age).clip(0, 255).astype(np.uint8)

    # ---- stand height and closure: the point cloud's where it measured, and the gaps it finds made regen ----
    # The classes above stay on the map's closure (the conifer split at 60 % is the map's own), and the
    # bush estimate below reads them as the map has them, gaps and all: it is the forest map's estimate,
    # and the point cloud's say on the bush is measured_bush's, where the area asks for it. Read as regen
    # of no known age, a gap would also land in a thin class of the going grid's calibration and move it:
    # at Pickle Lake 25 gaps moved the bush on a quarter of the going grid.
    map_cover = cover.copy()
    height, crown, canopy_src, canopy = measured_canopy(f_ht, f_cc, cover)

    # ---- terrain ----
    gy, gx = np.gradient(dem, DY_M, DX_M)
    slope = np.degrees(np.arctan(np.hypot(gx, gy)))
    # 0 = N, clockwise; gy is +south→ -gy is north. This is the gradient's bearing, so UPHILL, not the
    # way the slope faces (that is atan2(-gx, gy), as common.py's hillshade and build_microclimate.py
    # have it). Every baked file holds it so; the app adds 180° where it wants the facing (huntRules.ts,
    # the deer south-slope bonus, fixed 2026-10-05). Don't "fix" it here without changing the reader too.
    aspect = (np.degrees(np.arctan2(gx, -gy)) + 360) % 360
    aspect_q = np.where(slope < 1.5, 255, np.round(aspect / 360 * 250)).astype(np.uint8)
    smooth = ndimage.gaussian_filter(dem, 1.2)
    tpi300 = smooth - ndimage.uniform_filter(smooth, size=21)
    tpi100 = smooth - ndimage.uniform_filter(smooth, size=7)
    ring_slope = ndimage.uniform_filter(slope, size=11)
    landform = np.full((ROWS, COLS), LF_FLAT, dtype=np.uint8)
    landform[slope >= 6] = LF_SLOPE
    landform[(slope < 5) & (ring_slope > 8) & (np.abs(tpi300) < 3)] = LF_BENCH
    landform[tpi300 > 4] = LF_RIDGE
    landform[tpi300 < -4] = LF_VALLEY
    # saddle: a maximum along one axis and a minimum along the other, 3 cells out
    ex = np.pad(smooth, 3, mode="edge")
    cx = ex[3:-3, 3:-3]
    xmax = (cx > ex[3:-3, :-6] + 1.5) & (cx > ex[3:-3, 6:] + 1.5)
    xmin = (cx < ex[3:-3, :-6] - 1.5) & (cx < ex[3:-3, 6:] - 1.5)
    ymax = (cx > ex[:-6, 3:-3] + 1.5) & (cx > ex[6:, 3:-3] + 1.5)
    ymin = (cx < ex[:-6, 3:-3] - 1.5) & (cx < ex[6:, 3:-3] - 1.5)
    landform[(xmax & ymin) | (xmin & ymax)] = LF_SADDLE
    landform[(tpi300 > 8) & (smooth >= ndimage.maximum_filter(smooth, size=9) - 0.01)] = LF_PEAK
    landform[water] = LF_FLAT

    # ---- distances (m) ----
    lake_mask = lake_id > 0
    d_water = edt_m(water | stream)
    d_lake = edt_m(lake_mask)
    d_wetland = edt_m(wetland | (cover == OPEN_WET) | (cover == TREED_WET))
    d_road = edt_m(road)
    cover_mask = np.isin(cover, (CONIFER_DENSE, TREED_WET))
    d_cover = edt_m(cover_mask)
    # hiding cover: any thick bush (young thickets, alder, fir and cedar,
    # dense spruce), not only tall dense conifer. Patches of half a hectare up
    thick = bush_thickness(map_cover, stand_age, dist_age, f_cc, f_lead, f_poly, f_ht)
    thick_src, thick_header, thick_spread = None, {}, None
    # where a map that knows every polygon names open or non-vegetated ground,
    # or a tall-shrub thicket, its word stands over the model's guess
    map_says = FOREST_UPDATED & (np.isin(f_poly, (2, 6, 8)) | f_rock | ((f_poly == 4) & (f_ht >= 2)))
    if BUSH_FROM_POINTCLOUD:
        thick, thick_src, thick_header = measured_bush(thick, cover)
    elif BUSH_FROM_MODEL:
        thick, thick_src, thick_spread, thick_header = modelled_bush(thick, cover, map_says)
    thick_mask = thick >= 0.7
    tl, tn = ndimage.label(thick_mask)
    if tn:
        tsz = np.bincount(tl.ravel(), minlength=tn + 1)
        big = tsz >= int(round(5000 / (DX_M * DY_M)))
        big[0] = False
        thick_mask = big[tl]
    d_thick = edt_m(thick_mask)
    print(f"  bush thickness: {100 * (thick >= 0.7).mean():.0f}% of cells thick, {100 * (thick <= 0.35).mean():.0f}% open")
    browse_mask = np.isin(cover, (HARDWOOD, SHRUB, REGEN)) | ((cover == MIXED) & (f_hard >= 40)) | ((dist_age >= 5) & (dist_age <= 30) & ~water)
    d_browse = edt_m(browse_mask)
    if browse_mask.any():
        _, (ir, ic_) = ndimage.distance_transform_edt(~browse_mask, sampling=(DY_M, DX_M), return_indices=True)
        rr, cc = np.indices((ROWS, COLS))
        dxm = (ic_ - cc) * DX_M
        dym = (rr - ir) * DY_M  # +north
        bearing = (np.degrees(np.arctan2(dxm, dym)) + 360) % 360
        bear_q = np.where(browse_mask, 255, np.round(bearing / 360 * 250)).astype(np.uint8)
    else:
        bear_q = np.full((ROWS, COLS), 255, dtype=np.uint8)

    # inlets and outlets: stream ends within 60 m of a lake
    ends = []
    for g in geoms(wc):
        for part in getattr(g, "geoms", [g]):
            cs = list(part.coords)
            ends.append(shapely.Point(cs[0]))
            ends.append(shapely.Point(cs[-1]))
    end_mask = burn([(p, 1) for p in ends], all_touched=True).astype(bool)
    inlet_mask = end_mask & (d_lake <= 60)
    d_inlet = edt_m(inlet_mask)

    # ---- lake shape: shore distance, land fraction, estimated depth, fetch ----
    d_shore = edt_m(~water)  # for water cells: distance to land
    land_frac = ndimage.uniform_filter((~water).astype(np.float32), size=11)
    depth_est = np.full((ROWS, COLS), 255, dtype=np.uint8)
    lakes = []
    ara_by_name = {(f["properties"].get("OFFICIAL_WATERBODY_NAME") or "").lower(): f["properties"] for f in ara}
    ara_geoms = [(shapely.geometry.shape(f["geometry"]), f["properties"]) for f in ara]
    fetch_dirs = fetch_cells(water, lake_id)
    for k, i in enumerate(lake_idx):
        lid = k + 1
        cells = lake_id == lid
        n = int(cells.sum())
        if n < 4:
            continue
        name = wb[i]["properties"].get("OFFICIAL_NAME_LABEL")
        props = ara_by_name.get((name or "").lower())
        if props is None:
            rep = wb_geoms[i].representative_point()
            for g, p in ara_geoms:
                if g.contains(rep):
                    props = p
                    break
        area_ha = n * DX_M * DY_M / 1e4
        dmax_shore = float(d_shore[cells].max())
        fmax = max(int(fetch_dirs[d][cells].max()) for d in fetch_dirs)
        entry = {
            "id": lid,
            "name": name,
            "areaHa": round(area_ha, 1),
            "fetchMaxM": int(fmax * max(DX_M, DY_M)),
            "maxDepth": None,
            "meanDepth": None,
            "secchi": None,
            "species": [],
            "depthModel": None,
        }
        if props:
            rnd = lambda v: round(float(v), 1) if v is not None else None  # noqa: E731  (ArcGIS float32 noise)
            entry["maxDepth"] = rnd(props.get("MAXIMUM_DEPTH"))
            entry["meanDepth"] = rnd(props.get("MEAN_DEPTH"))
            entry["secchi"] = rnd(props.get("SECCHI_DEPTH"))
            entry["species"] = species_keys(props.get("FISH_SPECIES_SUMMARY"))
        dmax = entry["maxDepth"]
        if dmax and dmax_shore > 0:
            frac = d_shore[cells] / dmax_shore
            dmean = entry["meanDepth"]
            kexp = 1.0
            if dmean and 0 < dmean < dmax:
                lo, hi = 0.2, 6.0
                for _ in range(40):
                    kexp = (lo + hi) / 2
                    m = float((dmax * frac**kexp).mean())
                    if m > dmean:
                        lo = kexp
                    else:
                        hi = kexp
            depth = dmax * frac**kexp
            depth_est[cells] = np.clip(np.round(depth * 4), 0, 254).astype(np.uint8)
            entry["depthModel"] = {"k": round(kexp, 2), "shoreMaxM": round(dmax_shore)}
        lakes.append(entry)
    n_survey = apply_survey_depths(depth_est, lake_id, lakes)
    print(f"  {len(lakes)} lakes, {sum(1 for l in lakes if l['depthModel'])} with a depth model, {n_survey} from survey sheets · {time.time() - t0:.0f}s")

    # ---- assemble ----
    bands: list[tuple[str, np.ndarray, float, str]] = [
        ("elev", np.clip(np.round(dem), 0, 65535).astype(np.uint16), 1, "elevation m"),
        ("slope", q8(slope, 1), 1, "slope degrees"),
        ("aspect", aspect_q, 360 / 250, "uphill bearing degrees (0..250 → 0..360; 255 flat); the slope faces +180°"),
        ("tpi", np.clip(np.round(tpi300) + 128, 0, 255).astype(np.uint8), 1, "topographic position 300 m, m (value-128)"),
        ("tpi100", np.clip(np.round(tpi100 * 2) + 128, 0, 255).astype(np.uint8), 0.5, "topographic position 100 m, m ((value-128)/2)"),
        ("landform", landform, 1, "landform class, see landformNames"),
        ("cover", cover, 1, "cover class, see coverNames" + ("; young regen also where the point cloud finds a stand open (canopySrc 1)" if canopy_src is not None else "")),
        ("age", stand_age, 1, f"stand age years ({INVENTORY} origin, or years since disturbance)"),
        ("height", height, 1, f"stand height m ({INVENTORY})" if canopy_src is None else f"stand height m: the point cloud's p95 of the returns over 2 m where canopySrc is 1, else {INVENTORY}"),
        ("crown", crown, 1, f"crown closure % ({INVENTORY})" if canopy_src is None else f"crown closure %: the point cloud's share of returns over 2 m where canopySrc is 1, else {INVENTORY}"),
        ("conifer", f_conif, 1, f"conifer % of composition ({INVENTORY})"),
        ("hardwood", f_hard, 1, f"hardwood % of composition ({INVENTORY})"),
        ("lead", f_lead, 1, "leading species: 1 Sb 2 Pj 3 Sw 4 Bf 5 Cw 6 La 7 Pt 8 Bw"),
        ("disturbAge", dist_age, 1, "years since fire / cut (255 none)"),
        ("distWater", q8(d_water, 10), 10, "m to lake, pond, river or stream (×10)"),
        ("distLake", q8(d_lake, 10), 10, "m to a lake or pond (×10)"),
        ("distWetland", q8(d_wetland, 10), 10, "m to wetland (×10)"),
        ("distCover", q8(d_cover, 10), 10, "m to dense conifer / treed wetland cover (×10)"),
        (
            "thick",
            np.round(thick * 250).astype(np.uint8),
            1 / 250,
            "eye-level bush thickness, 0 open to 1 a wall ("
            + ("the LiDAR's where thickSrc is 1, else the " if BUSH_FROM_POINTCLOUD and thick_src is not None else "")
            + ("the bush model's from satellite imagery where thickSrc is 3, else the " if thick_src is not None and (thick_src == 3).any() else "")
            + "estimate from stand type, age, closure, disturbance)",
        ),
        ("distThick", q8(d_thick, 10), 10, "m to thick hiding cover, patches of 0.5 ha up (×10)"),
        ("distBrowse", q8(d_browse, 10), 10, "m to browse habitat (×10)"),
        ("bearBrowse", bear_q, 360 / 250, "compass bearing to nearest browse (255 = in browse)"),
        ("distRoad", q8(d_road, 20), 20, "m to a bush road (×20)"),
        ("distInlet", q8(d_inlet, 10), 10, "m to a stream inlet or outlet on a lake (×10)"),
        ("lakeId", lake_id, 1, "lake index into lakes[] (0 land)"),
        ("distShore", q8(d_shore, 10), 10, "water cells: m to land (×10)"),
        ("landFrac", np.round(land_frac * 255).astype(np.uint8), 1 / 255, "fraction of land within ~160 m"),
        ("depthEst", depth_est, 0.25, "estimated depth m (×0.25; 255 unknown)"),
    ]
    for d, arr in fetch_dirs.items():
        bands.append((f"fetch{d}", arr, 1, f"water cells: fetch in cells with wind from {d}"))
    if thick_src is not None:
        bands.append(("thickSrc", thick_src, 1, "where thick comes from: 0 water, 1 LiDAR, 2 forest-map estimate, 3 the bush model (satellite)"))
    if thick_spread is not None:
        bands.append(("thickSpread", np.round(np.clip(thick_spread, 0, 1) * 250).astype(np.uint8), 1 / 250, "the bush model's doubt: its 80th minus 20th percentile, on thick's scale"))
    if canopy_src is not None:
        # both surveys so far were flown in leaf (build_vegstructure.py), and a hunt is in the fall
        meaning = (
            f"where height and crown come from: 0 {INVENTORY} stand, 1 LiDAR point cloud: {canopy['source']}. Flown in leaf, "
            "so hardwood closure reads high for a November hunt, which a future canopy lesson would correct (docs/MICRO-WIND.md, Next steps 5)"
        )
        bands.append(("canopySrc", canopy_src, 1, meaning))

    header = {
        "region": REGION["id"],
        "generated": date.today().isoformat(),
        "cols": COLS,
        "rows": ROWS,
        "west": W,
        "north": N,
        "dLon": D_LON,
        "dLat": D_LAT,
        "cellM": [round(DX_M, 1), round(DY_M, 1)],
        "coverNames": COVER_NAMES,
        "landformNames": LANDFORM_NAMES,
        **thick_header,
        "lakes": lakes,
        "bands": [],
    }
    out = OUT_DIR / f"habitat-{REGION['id']}.hab"
    w = write_hab(out, header, bands)
    print(f"wrote {out.name}: {w['raw'] / 1e6:.1f} MB raw, {w['size'] / 1e6:.2f} MB packed, {w['bands']} bands · {time.time() - t0:.0f}s")
    # a human-readable summary next to it
    summary = {
        "cover": {COVER_NAMES[i]: int((cover == i).sum()) for i in range(len(COVER_NAMES))},
        "landform": {LANDFORM_NAMES[i]: int((landform == i).sum()) for i in range(len(LANDFORM_NAMES))},
        "disturbed": int((dist_age < 255).sum()),
        "inferredCuts": int(inferred_cut.sum()),
        "lakes": lakes,
    }
    if thick_src is not None:
        land = cover != WATER
        summary["thick"] = {
            "from": thick_header["thickFrom"],
            "lidarCells": int((thick_src == 1).sum()),
            "thickShareOfLand": round(float((thick[land] >= 0.7).mean()), 3),
            "thickShareWhereLidar": round(float((thick[thick_src == 1] >= 0.7).mean()), 3) if (thick_src == 1).any() else None,
            "estimateToLidar": [{"estimate": a, "lidar_median": b, "cells": n} for a, b, n in thick_header.get("bushCalib", [])],
            **thick_header.get("bushModel", {}),
        }
    if canopy_src is not None:
        summary["canopy"] = canopy["summary"]
    summary_path("habitat").write_text(json.dumps(summary, indent=1), encoding="utf-8")
    # the coverage report's line for the grid (bake_area.py) says where the stand heights came from
    share = canopy["summary"]["lidarShareOfCoreLand"] if canopy_src is not None else 0
    note_source(out.name, note=f"stand height and closure from the LiDAR point cloud over {100 * share:.0f}% of the core" if share else None)


if __name__ == "__main__":
    main()
