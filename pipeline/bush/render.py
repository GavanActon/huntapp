"""The modelled bush layer for an area with no point cloud: the bush model's
understory NRD (build_habitat.modelled_bush, kept in
pipeline/raw/bushmodel-<id>.npz) drawn as understory-<id>.pmtiles, the
same colours as an HD area's LiDAR layer (build_vegstructure.RAMP), so
"thick" looks the same everywhere.

What differs is the doubt. Each cell is faded by the model's spread (its
80th minus 20th percentile): a cell the model is sure of is drawn solid,
one it is unsure of fades towards nothing, so the layer never looks like a
10 m measurement. Water is cut at the area's waterbodies. No lanes layer:
shooting lanes are a 10 m LiDAR measure a 30 m prediction cannot make.

    py -3.14 pipeline/bush/render.py --area highland-lake

Reads  pipeline/raw/bushmodel-<id>.npz (from the habitat bake; made here when missing),
       <out>/waterbody-<id>.geojson
Writes <out>/understory-<id>.pmtiles and its source note
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import numpy as np
import rasterio
from rasterio.features import rasterize
from rasterio.transform import from_bounds
from rasterio.warp import Resampling, reproject, transform_geom

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(ROOT))

from area import cached, note_source  # noqa: E402
from common import CORE, OUT_DIR, REGION, lat_to_tile, lon_to_tile, tile_bounds_3857, write_raster_pmtiles  # noqa: E402

MINZOOM = 10  # build_vegstructure.FAR_MINZOOM: the app draws bush from here
SPREAD_FADE = 0.45  # a spread this wide (on the NRD scale) fades a cell to FADE_FLOOR of its colour
FADE_FLOOR = 0.3


def model_grid():
    # an area's own model (bush/local.py), at 10 m, before the general one on the habitat lattice
    loc = cached(f"bushlocal-{REGION['id']}.npz")
    if loc.exists():
        z = np.load(loc, allow_pickle=True)
        return {"nrd": z["nrd"], "spread": z["spread"], "transform": z["transform"], "crs": z["crs"], "notes": z["notes"]}
    p = cached(f"bushmodel-{REGION['id']}.npz")
    if not p.exists():
        print(f"no {p.name} yet: running the bush model on the habitat lattice ...")
        import build_habitat as bh
        import features as F
        import predict as P

        out = P.modelled(F.Grid("EPSG:4326", bh.TRANSFORM, bh.COLS, bh.ROWS))
        np.savez_compressed(p, nrd=out["nrd"], q20=out["q20"], q80=out["q80"], transform=np.array(bh.TRANSFORM)[:6], crs=np.array("EPSG:4326"), notes=np.array(json.dumps(out["notes"]["bushModel"])))
    z = np.load(p, allow_pickle=True)
    return {k: z[k] for k in z.files}


def water_shapes():
    p = OUT_DIR / f"waterbody-{REGION['id']}.geojson"
    if not p.exists():
        print(f"  (no {p.name}: the layer is not cut at the shore)")
        return []
    fc = json.loads(p.read_text(encoding="utf-8"))
    return [transform_geom("EPSG:4326", "EPSG:3857", f["geometry"]) for f in fc["features"] if f.get("geometry")]


def main(argv=None) -> None:
    import build_vegstructure as bv

    t0 = time.time()
    z = model_grid()
    nrd = z["nrd"].astype(np.float32)
    spread = (z["spread"] if "spread" in z else z["q80"] - z["q20"]).astype(np.float32)
    tr = rasterio.Affine(*z["transform"])
    crs = str(z["crs"])
    notes = json.loads(str(z["notes"])) if "notes" in z else {}
    # the fade: 1 where the model is sure, FADE_FLOOR where its spread is SPREAD_FADE or more
    fade = np.where(np.isfinite(nrd), 1 - (1 - FADE_FLOOR) * np.clip(np.nan_to_num(spread) / SPREAD_FADE, 0, 1), 0).astype(np.float32)
    water = water_shapes()
    ok = np.isfinite(nrd)
    print(f"bush model layer for {REGION['id']}: {ok.sum()} cells, NRD mean {np.nanmean(nrd):.3f}, spread median {np.nanmedian(spread):.3f}, fade median {np.median(fade[ok]):.2f}")

    def in_core(zz, x, y):
        return lon_to_tile(CORE["west"], zz) <= x <= lon_to_tile(CORE["east"] - 1e-9, zz) and lat_to_tile(CORE["north"], zz) <= y <= lat_to_tile(CORE["south"] + 1e-9, zz)

    def tile(zz, x, y, ramp=None):
        if not in_core(zz, x, y):
            return None
        b = tile_bounds_3857(zz, x, y)
        dst_tr = from_bounds(*b, 256, 256)
        value = np.full((256, 256), np.nan, np.float32)
        alpha = np.zeros((256, 256), np.float32)
        rs = Resampling.bilinear if zz > 12 else Resampling.average
        reproject(nrd, value, src_transform=tr, src_crs=crs, src_nodata=np.nan, dst_transform=dst_tr, dst_crs="EPSG:3857", dst_nodata=np.nan, resampling=rs)
        if not np.isfinite(value).any():
            return None
        reproject(fade, alpha, src_transform=tr, src_crs=crs, dst_transform=dst_tr, dst_crs="EPSG:3857", resampling=rs)
        rgba = bv.colourise(value, ramp or bv.RAMP)
        if water:
            lake = rasterize(water, out_shape=(256, 256), transform=dst_tr, fill=0, default_value=1, dtype=np.uint8)
            alpha = alpha * (1 - lake)
        rgba[..., 3] = np.clip(rgba[..., 3] * alpha, 0, 255).astype(np.uint8)
        return rgba if rgba[..., 3].any() else None

    local = bool(notes.get("local"))
    attribution = (
        "Bush mapped from satellite imagery (Copernicus Sentinel-2, JAXA ALOS PALSAR) and NRCan's SCANFI, CanLaD and MRDEM by a model of the area's own, trained on labels tapped on the photo"
        if local
        else "Bush modelled from satellite imagery (Copernicus Sentinel-2, JAXA ALOS PALSAR) and NRCan's SCANFI, CanLaD and MRDEM; trained on Ontario FRI leaf-on LiDAR"
    )
    path = OUT_DIR / f"understory-{REGION['id']}.pmtiles"
    stats = write_raster_pmtiles(path, f"understory-{REGION['id']}", attribution, MINZOOM, CORE["maxzoom"], tile, metadata={"bushModel": notes})
    size = path.stat().st_size
    print(f"wrote {path.name}: {size / 1e6:.1f} MB, " + ", ".join(f"z{k} {v[0]}" for k, v in sorted(stats.items())) + f" · {time.time() - t0:.0f} s")
    sc = notes.get("scores", {})
    note_source(
        path.name,
        source=(
            f"The area's own bush model (bush/local.py, docs/BUSH-MODEL.md): open, low shrub, tall bush or dense trees at 10 m from Sentinel-2 seasons, PALSAR, SCANFI, CanLaD and the MRDEM, learned from {notes.get('labels', '?')} labels tapped on the photo; held out a patch at a time, {round(100 * sc.get('accuracy', 0))}% right and thick-or-not {round(100 * sc.get('thickRight', 0))}%; faded where it is unsure. Modelled, not measured"
            if local
            else f"Bush model (docs/BUSH-MODEL.md): the eye-level understory predicted at 30 m from Sentinel-2 seasons, PALSAR, SCANFI, CanLaD and the MRDEM, trained on {notes.get('plots', '?')} plots of Ontario leaf-on LiDAR; faded where the model is unsure. Modelled, not measured"
        ),
        licence="Copernicus Sentinel data; JAXA ALOS PALSAR mosaic (free, attribution); OGL-Canada; CanLaD CC BY 4.0",
        vintage=f"imagery 2023-2025, model trained {notes.get('trained', '?')}",
    )

    # The shooting lanes (the Bow view's Lanes, Gavan's "range"): the same 10 m
    # map drawn for a bow, open and light ground left clear, thicker bush
    # shaded darker (build_vegstructure.LANES_RAMP), faded where the model is
    # unsure. Only from an area's own model: its 10 m map can draw a lane; the
    # general model's 30 m cells cannot (Gavan, 2026-10-09, Blanchard River:
    # "make sure the range system works in this location")
    if local:
        lp = OUT_DIR / f"lanes-{REGION['id']}.pmtiles"
        ls = write_raster_pmtiles(lp, f"lanes-{REGION['id']}", attribution, MINZOOM, CORE["maxzoom"], lambda zz, x, y: tile(zz, x, y, bv.LANES_RAMP), metadata={"bushModel": notes})
        print(f"wrote {lp.name}: {lp.stat().st_size / 1e6:.1f} MB, " + ", ".join(f"z{k} {v[0]}" for k, v in sorted(ls.items())))
        note_source(
            lp.name,
            source=f"The shooting lanes from the area's own bush model at 10 m (bush/local.py): open and light ground clear, thicker bush shaded darker; learned from {notes.get('labels', '?')} labels tapped on the photo. Modelled, not measured",
            licence="Copernicus Sentinel data; JAXA ALOS PALSAR mosaic (free, attribution); OGL-Canada; CanLaD CC BY 4.0",
            vintage=f"imagery 2023-2025, model trained {notes.get('trained', '?')}",
        )


if __name__ == "__main__":
    main()
