"""The USGS 3DEP point cloud for an area, in the index build_vegstructure.py
reads (the shape qc_pointcloud.py writes): one row per LAZ tile with its CRS,
bounds in metres, year and how its ground is told.

  pipeline/raw/pointcloud/tiles-<id>.json
  pipeline/raw/pointcloud/<id>/laz/<tile>.laz

The LAZ tiles are listed and downloaded beforehand into
pipeline/raw/us3dep/<stage>/lpc/ (the TNM list beside them gives each tile's
project and date). 3DEP tiles are classified (ASPRS: 2 ground, 7 and 18
noise, 9 water), so the ground comes from the classes, as Quebec's does.

    py -3.14 pipeline/us_pointcloud.py --area cadillac
"""
from __future__ import annotations

import json
import re
import shutil
import sys
from pathlib import Path

import laspy
import shapely
import shapely.ops
from pyproj import Transformer

sys.path.insert(0, str(Path(__file__).resolve().parent))
import area  # noqa: E402  (first: it takes --area out of argv)
from common import CORE, ROOT  # noqa: E402

BAKE = area.load(area.ID).get("bake") or {}
STAGE_NAME = (BAKE.get("us3dep") or {}).get("stage") or area.ID
RAW = ROOT / "pipeline" / "raw" / "us3dep" / STAGE_NAME
PC_DIR = ROOT / "pipeline" / "raw" / "pointcloud"
INDEX = PC_DIR / f"tiles-{area.ID}.json"
LAZ_DIR = PC_DIR / area.ID / "laz"

GROUND = [2]
DROP = [7, 18]  # low and high noise
WATER = [9]
# 3DEP QL2 is 2 points/m² nominal; a tile thinner than a third of that is left out, as Quebec's are
NOMINAL = 2.0
DENSITY_FLOOR = 0.33


def tnm() -> dict[str, dict]:
    """The TNM list's items by file name: project, dates."""
    out = {}
    for p in RAW.glob("tnm-*lpc*.json"):
        for i in json.loads(p.read_text(encoding="utf-8")):
            out[Path(i["downloadURL"]).name] = i
    return out


def in_feet(crs) -> bool:
    try:
        au = (crs.axis_info[0].unit_name if crs.axis_info else "").lower()
        return "foot" in au or "feet" in au
    except Exception:  # noqa: BLE001
        return False


def metres_of(src: Path, dst: Path, crs, target: str) -> None:
    """A tile in a state plane in feet rewritten in the DEM's CRS in metres (x, y projected;
    z from US survey feet), so build_vegstructure's heights and bounds are metres as everywhere."""
    import numpy as np
    from pyproj import Transformer

    t = Transformer.from_crs(crs, target, always_xy=True)
    with laspy.open(src) as f:
        las = f.read()
    x, y = t.transform(las.x, las.y)
    # the plane's own foot: Michigan's state planes use the international foot (0.3048), most others the US survey foot
    try:
        ft = float(crs.axis_info[0].unit_conversion_factor)
    except Exception:  # noqa: BLE001
        ft = 0.3048
    z = np.asarray(las.z, dtype=np.float64) * ft
    h = laspy.LasHeader(point_format=las.header.point_format, version=las.header.version)
    h.offsets = [float(np.floor(x.min())), float(np.floor(y.min())), float(np.floor(z.min()))]
    h.scales = [0.01, 0.01, 0.01]
    h.add_crs(pyproj_crs(target))
    out = laspy.LasData(h)
    for dim in las.point_format.dimension_names:
        if dim not in ("X", "Y", "Z"):
            try:
                out[dim] = las[dim]
            except Exception:  # noqa: BLE001
                pass
    out.x, out.y, out.z = x, y, z
    out.write(dst)


def pyproj_crs(s: str):
    from pyproj import CRS

    return CRS.from_user_input(s)


def dem_crs() -> str:
    """The CRS the area's 1 m DEM tiles are in (us_terrain.py's core), the cloud's target: NAD83 UTM, metres."""
    import rasterio

    tifs = sorted((RAW / "dem1m").glob("*.tif"))
    if tifs:
        with rasterio.open(tifs[0]) as s:
            return s.crs.to_string()
    return "EPSG:26916"


def row(laz: Path, meta: dict | None) -> dict | None:
    with laspy.open(laz) as f:
        h = f.header
        crs = h.parse_crs()
        if crs is None:
            raise SystemExit(f"{laz.name}: no CRS in the LAZ header")
        epsg = crs.to_epsg()
        crs_s = f"EPSG:{epsg}" if epsg else crs.to_wkt()
        bounds = [round(h.mins[0]), round(h.mins[1]), round(h.maxs[0]), round(h.maxs[1])]
        n = h.point_count
    if in_feet(crs):
        # Michigan's tiles are NAD83(2011) Michigan Central in US survey feet: rewritten in the DEM's UTM metres
        target = dem_crs()
        dst = LAZ_DIR / laz.name
        if not dst.exists():
            print(f"  {laz.name}: {crs.name} is in feet; rewriting in {target} metres")
            metres_of(laz, dst, crs, target)
        with laspy.open(dst) as f:
            h = f.header
            bounds = [round(h.mins[0]), round(h.mins[1]), round(h.maxs[0]), round(h.maxs[1])]
            n = h.point_count
        crs_s = target
    area_m2 = max(1.0, (bounds[2] - bounds[0]) * (bounds[3] - bounds[1]))
    density = n / area_m2
    m = re.search(r"(20\d\d|19\d\d)", (meta or {}).get("title", "") + " " + laz.name)
    year = int(m.group(1)) if m else None
    pub = (meta or {}).get("publicationDate") or ""
    project = (meta or {}).get("title", laz.stem).replace("USGS Lidar Point Cloud ", "").rsplit(" ", 1)[0]
    return {
        "name": laz.stem,
        "file": f"{area.ID}/laz/{laz.name}",
        "crs": crs_s,
        "bounds": bounds,
        "year": year,
        "days": [pub[:10]] if pub else [],
        "project": project,
        "source": f"USGS 3DEP lidar point cloud, {project}",
        "attribution": "USGS 3D Elevation Program",
        "licence": "public domain (US Government work)",
        "url": (meta or {}).get("downloadURL"),
        "points": n,
        "density": round(density, 2),
        "ground": "class",
        "groundClasses": GROUND,
        "drop": DROP,
        "water": WATER,
        "minDensity": round(DENSITY_FLOOR * NOMINAL, 2),
        "poolReach": True,
    }


def main() -> int:
    lazs = sorted((RAW / "lpc").glob("*.laz"))
    if not lazs:
        raise SystemExit(f"no LAZ tiles in {RAW / 'lpc'}: download them first")
    meta = tnm()
    LAZ_DIR.mkdir(parents=True, exist_ok=True)
    rows = []
    for laz in lazs:
        r = row(laz, meta.get(laz.name))
        if r is None:
            continue
        rows.append(r)
    # only the tiles that touch the core, in the core's own CRS
    cores = {}
    for crs in {r["crs"] for r in rows}:
        t = Transformer.from_crs("EPSG:4326", crs, always_xy=True)
        cores[crs] = shapely.ops.transform(t.transform, shapely.box(CORE["west"], CORE["south"], CORE["east"], CORE["north"]).segmentize(0.001))
    keep = [r for r in rows if shapely.box(*r["bounds"]).intersection(cores[r["crs"]]).area > 0]
    for r in keep:
        dst = LAZ_DIR / Path(r["file"]).name
        if not dst.exists():
            shutil.copy2(RAW / "lpc" / Path(r["file"]).name, dst)
        r["bytes"] = dst.stat().st_size
    keep.sort(key=lambda r: (r["crs"], r["bounds"][0], r["bounds"][1]))
    INDEX.write_text(json.dumps(keep, indent=1, ensure_ascii=False), encoding="utf-8")
    thin = [r["name"] for r in keep if r["density"] < r["minDensity"]]
    print(f"{area.ID}: {len(keep)} of {len(rows)} tiles touch the core, {sum(r['bytes'] for r in keep) / 1e6:.0f} MB, "
          f"{min(r['density'] for r in keep):.2f}–{max(r['density'] for r in keep):.2f} pts/m² -> {INDEX.name}")
    if thin:
        print(f"  thin (under {DENSITY_FLOOR * NOMINAL} pts/m², left out by the bake): {', '.join(thin)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
