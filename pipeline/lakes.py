"""The lakes at 1 m, for cutting the LiDAR layers cleanly at the water.

The 1 m HRDEM LiDAR ground model is not flattened on water here: it has
0.2-1 m of noise on the lakes, which a hillshade draws as texture over the
imagery. So the water is the province's lake outlines (OHN in Ontario,
GRHQ in Quebec: waterbody-<region>.geojson), grown up to GROW_M over
ground at the lake's own level where the outline falls short of the LiDAR
shore (a beaver flood, or a line drawn a little inside the water). The
shoreline's own slope stays outside, so the banks keep their shade.

Used by build_hillshade.py (the grey 1 m shade) and build_vegstructure.py
(the bush and shooting-lanes tiles, whose 10 m cells would otherwise stop
in steps at the shore). Cached as pipeline/raw/lakes-1m-<region>.npz on the
grid of the LiDAR cache build_hillshade.py writes; a scratch run (HUNTAPP_OUT)
makes its own from its own waterbody file and keeps it in its folder.
"""

from __future__ import annotations

import json

import numpy as np
import rasterio
from rasterio.features import rasterize
from rasterio.warp import transform_geom
from scipy.ndimage import binary_dilation, find_objects, label

from area import SCRATCH
from common import CACHE_DIR, OUT_DIR, REGION

GROW_M = 15  # how far past a lake's drawn outline water at its own level is still lake
LEVEL_TOL_M = 0.3  # "at its own level": within this of the lake's median height
LIDAR_NPZ = CACHE_DIR / f"lidar-{REGION['id']}.npz"
# never the shared one on a scratch run: it was made from the published waterbody file
MASK_NPZ = (OUT_DIR if SCRATCH else CACHE_DIR) / f"lakes-1m-{REGION['id']}.npz"


def water_mask(elev: np.ndarray, transform, crs: str) -> np.ndarray:
    """The lakes on an elevation grid (NaN for nodata), True for water."""
    path = OUT_DIR / f"waterbody-{REGION['id']}.geojson"
    if not path.exists():
        raise SystemExit(f"{path} missing: bake the area's vectors first (bake_area.py --only vectors)")
    fc = json.loads(path.read_text(encoding="utf-8"))
    shapes = [(transform_geom("EPSG:4326", crs, f["geometry"]), i + 1) for i, f in enumerate(fc["features"]) if f.get("geometry")]
    ids = rasterize(shapes, out_shape=elev.shape, transform=transform, fill=0, dtype="int32")
    water = ids > 0
    grow = max(1, int(round(GROW_M / abs(transform.a))))
    for i, sl in enumerate(find_objects(ids)):
        if sl is None:
            continue
        # the lake's box, widened by the growth allowed
        sl = tuple(slice(max(0, a.start - grow), min(n, a.stop + grow)) for a, n in zip(sl, ids.shape))
        lake = ids[sl] == i + 1
        z = elev[sl]
        if np.isnan(z[lake]).all():
            continue
        level = np.nanmedian(z[lake])
        near = binary_dilation(lake, iterations=grow) & ~lake
        at_level = near & (np.abs(z - level) < LEVEL_TOL_M)
        # only ground at level that joins the lake, not a bog pool nearby
        lab, _ = label(at_level | lake)
        keep = np.isin(lab, np.unique(lab[lake]))
        water[sl] |= keep & at_level
    print(f"  water: {water.mean() * 100:.1f}% of the grid ({(ids > 0).mean() * 100:.1f}% drawn, grown to the LiDAR shore)")
    return water


def lake_mask_1m(elev: np.ndarray | None = None, transform=None, crs: str | None = None):
    """(mask as float32 1.0 water / 0.0, transform, crs) on the LiDAR grid,
    from the cache when it is there. Pass the elevation grid to skip loading it."""
    if MASK_NPZ.exists():
        z = np.load(MASK_NPZ, allow_pickle=True)
        return z["water"].astype(np.float32), rasterio.Affine(*z["transform"]), str(z["crs"])
    if elev is None:
        z = np.load(LIDAR_NPZ, allow_pickle=True)
        transform, crs = rasterio.Affine(*z["transform"]), str(z["crs"])
        elev = np.where(z["elev"] == float(z["nodata"]), np.nan, z["elev"]).astype(np.float32)
    water = water_mask(elev, transform, crs)
    np.savez_compressed(MASK_NPZ, water=water, transform=np.array(transform)[:6], crs=crs)
    return water.astype(np.float32), transform, crs
