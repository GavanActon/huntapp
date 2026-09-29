"""The going grid: what the ground is like to walk over, on a 10 m lon/lat
lattice over the core, for the route finder (app/src/routes/). One small
gzipped band file the phone keeps with the maps, so routes work at camp
with no signal.

The lattice is the habitat grid's (build_habitat.py) cut three ways, 3×3
going cells to each 30 m habitat cell and aligned to it, so a route can
read the Spots scores under it without resampling. It covers the CORE box
in config.ts, where the 1 m LiDAR is.

Bands, and where each comes from:
  elev     metres (0.1 m steps). The 1 m HRDEM LiDAR DTM (build_hillshade.py's
           cache), area-averaged to 10 m; MRDEM 30 m where the LiDAR stops.
           The app works the grade of every step from it, uphill and down.
  bush     LiDAR normalised relative density of returns 0.5-3 m over 0-3 m
           (build_vegstructure.py), 0 open to 1 a wall: the measure Campbell
           et al. (2017) found best predicts walking speed (their best
           band was 0.15-2.75 m). Where the point cloud has not been
           fetched, the habitat bake's stand-type estimate stands in,
           mapped onto the LiDAR scale by the medians where both exist.
  bushSrc  0 none (water), 1 LiDAR, 2 the forest-map estimate
  rough    ground roughness, mm: the mean |DTM - its 5 m focal mean| over the
           cell, Campbell et al.'s measure (theirs on a 0.25 m DTM with a
           2.5 m-radius kernel; ours on the 1 m DTM, which smooths it a
           little, so it errs low). Rock, root-mounds, boulders, cut banks.
  ground   0 upland, 1 water, 2 marsh, 3 open peatland (fen, bog, open
           muskeg), 4 swamp / treed muskeg, 5 road, 6 stream
           Water: the LiDAR's hydro-flattened water where there is LiDAR,
           else the LIO OHN waterbodies. Roads (LIO MNRF roads) win over
           water and streams: a road over a creek is a culvert or bridge.
           Streams are the OHN "Stream" lines (not the virtual flow lines
           through lakes), burnt all-touched so a diagonal step cannot slip
           between two cells of one.

Output: app/public/data/going-<region>.hab (same format as the habitat grid)
        pipeline/bake-going-summary.json

    py -3.14 pipeline/build_going.py
"""

from __future__ import annotations

import gzip
import json
import math
import struct
import time
from datetime import date
from pathlib import Path

import numpy as np
import rasterio
import shapely
from rasterio import features
from rasterio.transform import from_origin
from rasterio.warp import Resampling, reproject
from scipy import ndimage

from common import CACHE_DIR, CORE, OUT_DIR, REGION

# the habitat lattice (build_habitat.py), and this one inside it
H_DLON, H_DLAT = 0.0004, 0.00027
K = 3
D_LON, D_LAT = H_DLON / K, H_DLAT / K
HC0 = math.floor((CORE["west"] - REGION["west"]) / H_DLON)
HC1 = math.ceil((CORE["east"] - REGION["west"]) / H_DLON)
HR0 = math.floor((REGION["north"] - CORE["north"]) / H_DLAT)
HR1 = math.ceil((REGION["north"] - CORE["south"]) / H_DLAT)
WEST = REGION["west"] + HC0 * H_DLON
NORTH = REGION["north"] - HR0 * H_DLAT
COLS = (HC1 - HC0) * K
ROWS = (HR1 - HR0) * K
TRANSFORM = from_origin(WEST, NORTH, D_LON, D_LAT)
LAT_MID = NORTH - ROWS * D_LAT / 2
DX_M = D_LON * 111_320 * math.cos(math.radians(LAT_MID))
DY_M = D_LAT * 110_574

UPLAND, WATER, MARSH, OPEN_PEAT, SWAMP, ROAD, STREAM = range(7)
GROUND_NAMES = ["upland", "water", "marsh", "open peatland", "swamp", "road", "stream"]
WETLAND_CLASS = {"Marsh": MARSH, "Fen": OPEN_PEAT, "Bog": OPEN_PEAT, "Swamp": SWAMP, "Unknown": SWAMP}
# habitat cover classes (build_habitat.py COVER_NAMES)
HC_WATER, HC_OPEN_WET, HC_TREED_WET, HC_ROAD = 1, 2, 3, 11

ROUGH_KERNEL = 5  # px of the 1 m DTM: a 5 m window, ~Campbell's 2.5 m radius
SUMMARY = Path(__file__).resolve().parent / "bake-going-summary.json"


def load_geo(theme: str) -> list[dict]:
    p = OUT_DIR / f"{theme}-{REGION['id']}.geojson"
    if not p.exists():
        print(f"  (no {p.name})")
        return []
    return json.loads(p.read_text(encoding="utf-8"))["features"]


def burn(shapes, dtype=np.uint8, all_touched=False) -> np.ndarray:
    shapes = [(g, v) for g, v in shapes if g is not None and not g.is_empty]
    if not shapes:
        return np.zeros((ROWS, COLS), dtype=dtype)
    return features.rasterize(shapes, out_shape=(ROWS, COLS), transform=TRANSFORM, fill=0, dtype=dtype, all_touched=all_touched)


def to_lattice(data: np.ndarray, transform, crs: str, nodata: float | None, resampling: Resampling) -> np.ndarray:
    out = np.full((ROWS, COLS), np.nan, np.float32)
    reproject(
        source=data.astype(np.float32, copy=False),
        destination=out,
        src_transform=transform,
        src_crs=crs,
        src_nodata=nodata,
        dst_transform=TRANSFORM,
        dst_crs="EPSG:4326",
        dst_nodata=np.nan,
        resampling=resampling,
    )
    return out


def read_hab(path: Path) -> dict[str, np.ndarray]:
    """The habitat grid's bands, cropped to this lattice and cut 3×3."""
    raw = gzip.decompress(path.read_bytes())
    hlen = struct.unpack("<I", raw[:4])[0]
    h = json.loads(raw[4 : 4 + hlen])
    base = 4 + hlen
    n = h["cols"] * h["rows"]
    out = {}
    for b in h["bands"]:
        if b["name"] not in ("thick", "cover"):
            continue
        dt = np.dtype(b["dtype"])
        a = np.frombuffer(raw, dtype=dt, count=n, offset=base + b["offset"]).reshape(h["rows"], h["cols"])
        a = a[HR0:HR1, HC0:HC1].astype(np.float32) * b["scale"]
        out[b["name"]] = np.repeat(np.repeat(a, K, axis=0), K, axis=1)
    return out


def main() -> None:
    t0 = time.time()
    print(f"going grid {COLS}x{ROWS} cells of {DX_M:.1f}x{DY_M:.1f} m over the core (habitat cols {HC0}-{HC1}, rows {HR0}-{HR1})")

    # ---- elevation and roughness from the 1 m LiDAR DTM ----
    z = np.load(CACHE_DIR / f"lidar-{REGION['id']}.npz", allow_pickle=True)
    dtm = z["elev"].astype(np.float32)
    ltr = rasterio.Affine(*z["transform"])
    lcrs = str(z["crs"])
    lnod = float(z["nodata"])
    dtm[dtm <= lnod + 1] = np.nan
    elev = to_lattice(dtm, ltr, lcrs, np.nan, Resampling.average)
    # |z - focal mean|: bumps and pits against the broader ground. NaN edges stay NaN.
    rough1 = np.abs(dtm - ndimage.uniform_filter(np.nan_to_num(dtm, nan=0.0), ROUGH_KERNEL, mode="nearest"))
    edge = ndimage.uniform_filter(np.isnan(dtm).astype(np.float32), ROUGH_KERNEL) > 0
    rough1[edge] = np.nan
    del dtm
    rough = to_lattice(rough1, ltr, lcrs, np.nan, Resampling.average)
    del rough1
    print(f"  LiDAR elevation and roughness - {time.time() - t0:.0f}s")

    m = np.load(CACHE_DIR / f"mrdem-{REGION['id']}.npz", allow_pickle=True)
    mr = to_lattice(m["data"], rasterio.Affine(*m["transform"]), str(m["crs"]), float(m["nodata"]), Resampling.bilinear)
    lidar_elev = np.isfinite(elev)
    elev = np.where(lidar_elev, elev, mr)
    elev = np.where(np.isfinite(elev), elev, np.nanmedian(elev))
    rough = np.where(np.isfinite(rough), rough, 0.0)

    # ---- bush: LiDAR NRD, the forest-map estimate where the point cloud is not fetched ----
    v = np.load(CACHE_DIR / f"vegstructure-{REGION['id']}.npz", allow_pickle=True)
    vtr = rasterio.Affine(*v["transform"])
    vcrs = str(v["crs"])
    under = np.where(v["understory"] >= 0, v["understory"], np.nan).astype(np.float32)
    lidar_bush = to_lattice(under, vtr, vcrs, np.nan, Resampling.bilinear)
    wf = np.where(v["water_frac"] >= 0, v["water_frac"], np.nan).astype(np.float32)
    lidar_water = to_lattice(wf, vtr, vcrs, np.nan, Resampling.bilinear)

    hab = read_hab(OUT_DIR / f"habitat-{REGION['id']}.hab")
    thick = hab["thick"]
    cover = np.round(hab["cover"]).astype(np.uint8)

    # the estimate onto the LiDAR scale: median NRD for each estimate value where both exist
    # (not the road class: a 30 m road cell is mostly the bush beside it, and roads are burnt in below)
    both = np.isfinite(lidar_bush) & (cover != HC_WATER) & (cover != HC_ROAD)
    keys = np.round(thick[both] * 20) / 20
    calib = []
    for k in np.unique(keys):
        sel = lidar_bush[both][keys == k]
        if sel.size >= 300:
            calib.append((float(k), float(np.median(sel)), int(sel.size)))
    xs = np.array([c[0] for c in calib])
    ys = np.maximum.accumulate(np.array([c[1] for c in calib]))  # a thicker estimate never maps thinner
    est = np.interp(thick, xs, ys).astype(np.float32)
    have = np.isfinite(lidar_bush)
    bush = np.where(have, lidar_bush, est)
    bush_src = np.where(have, 1, 2).astype(np.uint8)
    print("  estimate -> LiDAR NRD: " + ", ".join(f"{a:.2f}->{b:.2f}" for a, b, _ in calib))
    print(f"  bush from LiDAR on {have.mean() * 100:.0f}% of cells - {time.time() - t0:.0f}s")

    # ---- ground classes ----
    wb = load_geo("waterbody")
    wet = load_geo("wetland")
    wc = load_geo("watercourse")
    roads = load_geo("roads")
    shp = lambda f: shapely.geometry.shape(f["geometry"]) if f.get("geometry") else None  # noqa: E731
    ohn_water = burn([(shp(f), 1) for f in wb]).astype(bool)
    has_lidar_water = np.isfinite(lidar_water)
    water = np.where(has_lidar_water, lidar_water >= 0.5, ohn_water)
    # wettest class wins where wetlands overlap
    ground = np.zeros((ROWS, COLS), np.uint8)
    for cls in (SWAMP, OPEN_PEAT, MARSH):
        polys = [(shp(f), 1) for f in wet if WETLAND_CLASS.get(f["properties"].get("WETLAND_TYPE") or "Unknown", SWAMP) == cls]
        ground[burn(polys).astype(bool)] = cls
    # the forest map's muskeg where OHN has no wetland
    ground[(ground == UPLAND) & (cover == HC_OPEN_WET)] = OPEN_PEAT
    ground[(ground == UPLAND) & (cover == HC_TREED_WET)] = SWAMP
    streams = [(shp(f), 1) for f in wc if (f["properties"].get("WATERCOURSE_TYPE") or "") == "Stream"]
    stream = burn(streams, all_touched=True).astype(bool)
    road = burn([(shp(f), 1) for f in roads], all_touched=True).astype(bool)
    ground[stream & ~water] = STREAM
    ground[water] = WATER
    ground[road] = ROAD
    # the tread of a road is open and smooth whatever grows on its shoulders
    # (its cell reads rough: the 5 m window takes in the crown and the ditch)
    bush = np.where(road, np.minimum(bush, 0.2), bush)
    rough = np.where(road, np.minimum(rough, float(np.median(rough[ground == UPLAND]))), rough)
    bush = np.where(ground == WATER, np.nan, bush)
    bush_src[ground == WATER] = 0
    print(f"  ground classes - {time.time() - t0:.0f}s")

    # ---- write ----
    bands = [
        ("elev", np.clip(np.round(elev * 10), 0, 65535).astype(np.uint16), 0.1, "elevation m (×0.1)"),
        ("bush", np.where(np.isfinite(bush), np.round(np.clip(bush, 0, 1) * 250), 255).astype(np.uint8), 1 / 250, "bush 0.5-3 m, LiDAR NRD 0 open to 1 a wall (255 water)"),
        ("bushSrc", bush_src, 1, "0 none, 1 LiDAR, 2 forest-map estimate on the LiDAR scale"),
        ("rough", np.clip(np.round(rough * 1000), 0, 255).astype(np.uint8), 0.001, "ground roughness m (mean |DTM - 5 m focal mean|, ×0.001)"),
        ("ground", ground, 1, "ground class, see groundNames"),
    ]
    header = {
        "region": REGION["id"],
        "generated": date.today().isoformat(),
        "cols": COLS,
        "rows": ROWS,
        "west": WEST,
        "north": NORTH,
        "dLon": D_LON,
        "dLat": D_LAT,
        "cellM": [round(DX_M, 2), round(DY_M, 2)],
        "groundNames": GROUND_NAMES,
        # this lattice inside the habitat grid's: going (r, c) is habitat (r0 + r // k, c0 + c // k)
        "habitat": {"c0": HC0, "r0": HR0, "k": K},
        "coverNames": [],
        "landformNames": [],
        "lakes": [],
        "bands": [],
    }
    payload = bytearray()
    for name, arr, scale, meaning in bands:
        arr = np.ascontiguousarray(arr)
        header["bands"].append({"name": name, "dtype": str(arr.dtype), "scale": scale, "offset": len(payload), "meaning": meaning})
        payload += arr.tobytes()
    hj = json.dumps(header, separators=(",", ":")).encode("utf-8")
    raw = struct.pack("<I", len(hj)) + hj + bytes(payload)
    out = OUT_DIR / f"going-{REGION['id']}.hab"
    out.write_bytes(gzip.compress(raw, 9))
    print(f"wrote {out.name}: {len(raw) / 1e6:.1f} MB raw, {out.stat().st_size / 1e6:.2f} MB gzipped - {time.time() - t0:.0f}s")

    land = ground != WATER
    pct = lambda a, qs=(10, 25, 50, 75, 90, 99): {str(q): round(float(np.percentile(a, q)), 3) for q in qs}  # noqa: E731
    summary = {
        "cells": [COLS, ROWS],
        "cell_m": [round(DX_M, 2), round(DY_M, 2)],
        "elevation_from_lidar": round(float(lidar_elev.mean()), 3),
        "bush_from_lidar_of_land": round(float((bush_src[land] == 1).mean()), 3),
        "estimate_to_lidar": [{"estimate": a, "lidar_median": b, "cells": n} for a, b, n in calib],
        "bush_land_percentiles": pct(bush[land & np.isfinite(bush)]),
        "rough_m_land_percentiles": pct(rough[land]),
        "ground": {GROUND_NAMES[i]: int((ground == i).sum()) for i in range(len(GROUND_NAMES))},
    }
    SUMMARY.write_text(json.dumps(summary, indent=1), encoding="utf-8")
    print(json.dumps({k: summary[k] for k in ("bush_land_percentiles", "rough_m_land_percentiles", "ground")}))


if __name__ == "__main__":
    main()
