"""Lake depth bands as smooth polygons, for the map's Lake depths layer.

The app used to draw depth straight from the habitat grid: one rectangle
per run of 30 m cells, so every lake was a staircase. This contours the
depth instead and clips it to the real shoreline:

  1. depth on a ~7 m grid: the habitat grid's depthEst (shape model, or the
     survey where build_habitat.py had one) interpolated bilinearly with the
     land at 0, then the 5 m survey rasters (raw/bathy/*_depth.tif) pasted
     over their lakes at full detail, and a light blur to take the grid out;
  2. filled contours at the app's band edges (2, 4, 6, 8, 10, 14 m: the
     sheets' own contours, so the fills sit between the drawn lines);
  3. each band clipped to the waterbody polygons and simplified to ~2 m.

Output: app/public/data/depth-<region>.geojson, polygons with
  band (0 shallowest), lo, hi (m), survey (true on a surveyed lake).

    python pipeline/build_depth_bands.py
"""

from __future__ import annotations

import gzip
import json
import struct
from functools import reduce
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import rasterio  # noqa: E402
import shapely  # noqa: E402
from rasterio.transform import from_origin  # noqa: E402
from rasterio.warp import Resampling, reproject  # noqa: E402
from scipy import ndimage  # noqa: E402

from area import LAKE_SHEETS  # noqa: E402
from common import OUT_DIR, REGION  # noqa: E402

EDGES = [2, 4, 6, 8, 10, 14]  # the sheets' 2 m contours; app/src/map/depthLayer.ts BANDS must match
FINE = 4  # fine cells per habitat cell
SURVEY_DIR = Path(__file__).parent / "raw" / "bathy"


def read_hab():
    raw = gzip.open(OUT_DIR / f"habitat-{REGION['id']}.hab", "rb").read()
    n = struct.unpack("<I", raw[:4])[0]
    h = json.loads(raw[4 : 4 + n])

    def band(name):
        b = next(b for b in h["bands"] if b["name"] == name)
        return np.frombuffer(raw, dtype=np.dtype(b["dtype"]), count=h["cols"] * h["rows"], offset=4 + n + b["offset"]).reshape(h["rows"], h["cols"]), b["scale"]

    return h, band


def rings_to_geom(rings) -> shapely.Geometry:
    """Even-odd fill of a path's rings: holes come out as holes."""
    polys = [shapely.Polygon(r) for r in rings if len(r) >= 4]
    polys = [p.buffer(0) for p in polys if p.area > 0]
    if not polys:
        return shapely.Polygon()
    return reduce(lambda a, b: a.symmetric_difference(b), polys)


def main():
    h, band = read_hab()
    depth_q, scale = band("depthEst")
    lake_id, _ = band("lakeId")
    rows, cols = h["rows"], h["cols"]
    d30 = np.where((lake_id > 0) & (depth_q != 255), depth_q * scale, 0.0).astype(np.float32)

    # fine grid, cell centres; the land stays 0 so the shore grades to it
    fine = ndimage.zoom(d30, FINE, order=1, mode="nearest", grid_mode=True)
    fr, fc = fine.shape
    dlon, dlat = h["dLon"] / FINE, h["dLat"] / FINE
    tr = from_origin(h["west"], h["north"], dlon, dlat)
    survey_names = []
    # only this area's sheets: the folder is shared, and a survey there would
    # mark a same-named lake in another area as surveyed
    for tif in sorted(p for p in (SURVEY_DIR / f"{sid}_depth.tif" for sid in LAKE_SHEETS) if p.exists()):
        with rasterio.open(tif) as ds:
            grid = np.full((fr, fc), np.nan, dtype=np.float32)
            reproject(rasterio.band(ds, 1), grid, dst_transform=tr, dst_crs="EPSG:4326", resampling=Resampling.average, src_nodata=np.nan, dst_nodata=np.nan)
            survey_names.append(ds.tags().get("lake", "").lower())
        ok = np.isfinite(grid)
        fine[ok] = grid[ok]
    fine = ndimage.gaussian_filter(fine, sigma=1.0)

    lons = h["west"] + (np.arange(fc) + 0.5) * dlon
    lats = h["north"] - (np.arange(fr) + 0.5) * dlat
    cs = plt.contourf(lons, lats, fine, levels=[-1, *EDGES, 1000])

    # the real shorelines: every lake and pond polygon
    wb = json.loads((OUT_DIR / f"waterbody-{REGION['id']}.geojson").read_text())["features"]
    lakes = [f for f in wb if f["properties"].get("WATERBODY_TYPE") in ("Lake", "Pond")]
    water = shapely.union_all([shapely.geometry.shape(f["geometry"]).buffer(0) for f in lakes])
    surveyed = shapely.union_all(
        [shapely.geometry.shape(f["geometry"]).buffer(0) for f in lakes if (f["properties"].get("OFFICIAL_NAME_LABEL") or "").lower() in survey_names]
    )

    features = []
    lo_hi = [(0, EDGES[0])] + [(EDGES[i], EDGES[i + 1]) for i in range(len(EDGES) - 1)] + [(EDGES[-1], None)]
    for k, path in enumerate(cs.get_paths()):
        rings = path.to_polygons(closed_only=True)
        if not rings:
            continue
        g = rings_to_geom(rings).intersection(water)
        if g.is_empty:
            continue
        g = shapely.simplify(g, 0.00002, preserve_topology=True)
        for part_geom, is_survey in ((g.intersection(surveyed), True), (g.difference(surveyed), False)):
            if part_geom.is_empty or part_geom.area < 1e-9:
                continue
            gj = shapely.geometry.mapping(shapely.set_precision(part_geom, 1e-6))
            lo, hi = lo_hi[k]
            features.append({"type": "Feature", "geometry": gj, "properties": {"band": k, "lo": lo, "hi": hi, "survey": is_survey}})

    out = OUT_DIR / f"depth-{REGION['id']}.geojson"
    out.write_text(json.dumps({"type": "FeatureCollection", "features": features}, separators=(",", ":")))
    print(f"wrote {out.name}: {len(features)} band polygons · {out.stat().st_size / 1e6:.2f} MB · surveyed: {', '.join(survey_names) or 'none'}")


if __name__ == "__main__":
    main()
