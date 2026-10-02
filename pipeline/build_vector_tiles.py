"""Bake the baked GeoJSON themes into vector PMTiles, so the map reads
tiles for the view instead of fetching, parsing and indexing whole files
at start-up (the forest stands alone are 5 MB of GeoJSON, which held the
map's load back by seconds on the phone, 2026-10-01).

  forest-<region>.pmtiles   layer `forest`   from forest-<region>.geojson (build_forest.py)
  places-<region>.pmtiles   layers wmu, camps, crown, parks, fire, roads
                            from <theme>-<region>.geojson (build_vectors.py)

The app's style (mapStyle.ts) already prefers these archives when they
exist (DATA_FILES keys `forest` and `places`, one source-layer per theme)
and keeps the GeoJSON as the fallback. Geometry is simplified per zoom
at half a pixel, clipped to each tile with a buffer, and the property
values are kept as they are (nulls dropped: MVT has no null).

    py -3.14 pipeline/build_vector_tiles.py [forest] [places]
"""

from __future__ import annotations

import gzip
import json
import math
import sys
import time

import mapbox_vector_tile
import shapely
from mapbox_vector_tile.encoder import on_invalid_geometry_make_valid
from rasterio.warp import transform_geom

from common import OUT_DIR, REGION, region_tiles, tile_bounds_3857
from pmtiles.tile import Compression, TileType, zxy_to_tileid
from pmtiles.writer import Writer

MINZOOM = 7  # the map's own minimum zoom
MAXZOOM = 14  # overzoomed above: 0.4 m per MVT unit at z14 here, plenty for z18
EXTENT = 4096
TILE_BUFFER_PX = 64

ARCHIVES: dict[str, list[str]] = {
    "forest": ["forest"],
    "places": ["wmu", "camps", "crown", "parks", "fire", "roads"],
}
ATTRIBUTION = {
    "forest": "FRI © Ontario Ministry of Natural Resources",
    "places": "© Ontario MNRF",
}


def load_theme(theme: str) -> tuple[list[shapely.Geometry], list[dict]]:
    """A theme's features in EPSG:3857, with their properties (nulls dropped)."""
    path = OUT_DIR / f"{theme}-{REGION['id']}.geojson"
    if not path.exists():
        print(f"  {theme}: no {path.name}, skipped")
        return [], []
    fc = json.loads(path.read_text(encoding="utf-8"))
    geoms: list[shapely.Geometry] = []
    props: list[dict] = []
    for f in fc.get("features", []):
        g = f.get("geometry")
        if not g:
            continue
        try:
            m = shapely.from_geojson(json.dumps(transform_geom("EPSG:4326", "EPSG:3857", g)))
        except Exception as e:  # a ring the projection cannot take
            print(f"  {theme}: a feature skipped · {e}")
            continue
        if m is None or m.is_empty:
            continue
        if not m.is_valid:
            m = shapely.make_valid(m)
        geoms.append(m)
        props.append({k: v for k, v in (f.get("properties") or {}).items() if v is not None})
    print(f"  {theme}: {len(geoms)} features")
    return geoms, props


def write_archive(name: str, themes: list[str]) -> None:
    out = OUT_DIR / f"{name}-{REGION['id']}.pmtiles"
    loaded = {t: load_theme(t) for t in themes}
    loaded = {t: v for t, v in loaded.items() if v[0]}
    if not loaded:
        print(f"{name}: nothing to bake")
        return
    trees = {t: shapely.STRtree(g) for t, (g, _) in loaded.items()}
    count, total = 0, 0
    t0 = time.time()
    with open(out, "wb") as f:
        writer = Writer(f)
        for z in range(MINZOOM, MAXZOOM + 1):
            px_m = 2 * math.pi * 6378137.0 / (2**z * 256)
            tol = px_m * 0.5
            simplified = {t: [shapely.simplify(g, tol, preserve_topology=True) for g in geoms] for t, (geoms, _) in loaded.items()}
            for _, x, y in region_tiles(z):
                minx, miny, maxx, maxy = tile_bounds_3857(z, x, y)
                buf = (maxx - minx) * TILE_BUFFER_PX / EXTENT
                layers = []
                for t, (geoms, props) in loaded.items():
                    idx = trees[t].query(shapely.box(minx - buf, miny - buf, maxx + buf, maxy + buf))
                    feats = []
                    for i in idx:
                        g = shapely.clip_by_rect(simplified[t][i], minx - buf, miny - buf, maxx + buf, maxy + buf)
                        if g.is_empty:
                            continue
                        # a sliver under a pixel across at this zoom is noise
                        if g.geom_type in ("Polygon", "MultiPolygon") and g.area < px_m * px_m:
                            continue
                        feats.append({"geometry": g, "properties": props[i]})
                    if feats:
                        layers.append({"name": t, "features": feats})
                if not layers:
                    continue
                pbf = mapbox_vector_tile.encode(
                    layers,
                    default_options={
                        "quantize_bounds": (minx, miny, maxx, maxy),
                        "extents": EXTENT,
                        "on_invalid_geometry": on_invalid_geometry_make_valid,
                    },
                )
                data = gzip.compress(pbf, 6)
                writer.write_tile(zxy_to_tileid(z, x, y), data)
                count += 1
                total += len(data)
            print(f"  z{z}: {count} tiles, {total / 1e6:.1f} MB so far")
        writer.finalize(
            {
                "tile_type": TileType.MVT,
                "tile_compression": Compression.GZIP,
                "min_lon_e7": int(REGION["west"] * 1e7),
                "min_lat_e7": int(REGION["south"] * 1e7),
                "max_lon_e7": int(REGION["east"] * 1e7),
                "max_lat_e7": int(REGION["north"] * 1e7),
                "min_zoom": MINZOOM,
                "max_zoom": MAXZOOM,
                "center_zoom": 11,
                "center_lon_e7": int((REGION["west"] + REGION["east"]) / 2 * 1e7),
                "center_lat_e7": int((REGION["south"] + REGION["north"]) / 2 * 1e7),
            },
            {
                "name": out.stem,
                "attribution": ATTRIBUTION[name],
                # every theme asked for, even one with nothing in it (crown
                # land here): the style names them all as source-layers,
                # and MapLibre reports a layer the metadata does not list
                "vector_layers": [{"id": t, "minzoom": MINZOOM, "maxzoom": MAXZOOM, "fields": {}} for t in themes],
            },
        )
    print(f"wrote {out.name} ({out.stat().st_size / 1e6:.1f} MB, {count} tiles, {time.time() - t0:.0f} s)")


def main(names: list[str]) -> None:
    for name in names or list(ARCHIVES):
        if name not in ARCHIVES:
            raise SystemExit(f"unknown archive {name}; one of {', '.join(ARCHIVES)}")
        print(f"{name}:")
        write_archive(name, ARCHIVES[name])


if __name__ == "__main__":
    main(sys.argv[1:])
