"""Shared pipeline bits: the area being baked (area.py reads it from
app/src/areas/<id>.json, the file the app reads too), web-mercator tile
maths, and a raster → PMTiles writer.

PIL and pmtiles are imported where they are used, so the py -3.13 scripts
(build_forest.py and the pyogrio adapters) can import this as well."""

from __future__ import annotations

import io
import math
from pathlib import Path

import numpy as np

# the names every script has always imported from here
from area import CACHE_DIR, CORE, OUT_DIR, REGION, REGION_MAXZOOM, ROOT  # noqa: F401

APP = ROOT / "app"


def lon_to_tile(lon: float, z: int) -> int:
    return int((lon + 180) / 360 * 2**z)


def lat_to_tile(lat: float, z: int) -> int:
    r = math.radians(lat)
    return int((1 - math.asinh(math.tan(r)) / math.pi) / 2 * 2**z)


def tile_bounds_3857(z: int, x: int, y: int) -> tuple[float, float, float, float]:
    """(minx, miny, maxx, maxy) of a tile in EPSG:3857 metres."""
    n = 2**z
    size = 2 * math.pi * 6378137.0
    minx = -size / 2 + x * size / n
    maxx = minx + size / n
    maxy = size / 2 - y * size / n
    miny = maxy - size / n
    return minx, miny, maxx, maxy


def region_tiles(z: int):
    from pmtiles.tile import zxy_to_tileid

    x0 = lon_to_tile(REGION["west"], z)
    x1 = lon_to_tile(REGION["east"] - 1e-9, z)
    y0 = lat_to_tile(REGION["north"], z)
    y1 = lat_to_tile(REGION["south"] + 1e-9, z)
    return sorted((zxy_to_tileid(z, x, y), x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1))


def write_raster_pmtiles(
    path: Path, name: str, attribution: str, minz: int, maxz: int, render_tile, fmt: str = "PNG", metadata: dict | None = None
) -> dict[int, tuple[int, int]]:
    """Write a raster PMTiles archive. `render_tile(z, x, y)` returns an RGBA
    numpy array (256×256×4), or RGB (256×256×3) for PNG/WEBP, or None to skip
    an empty tile. fmt is PNG, JPEG (quality 82) or WEBP (lossless, for data
    tiles such as elevation). `metadata` adds keys to the archive's JSON
    metadata. Returns {zoom: (tiles, bytes)}."""
    from PIL import Image
    from pmtiles.tile import Compression, TileType
    from pmtiles.writer import Writer

    count = 0
    stats: dict[int, tuple[int, int]] = {}
    with open(path, "wb") as f:
        writer = Writer(f)
        for z in range(minz, maxz + 1):
            zn = zb = 0
            for tileid, x, y in region_tiles(z):
                img = render_tile(z, x, y)
                if img is None:
                    continue
                buf = io.BytesIO()
                mode = "RGB" if img.shape[-1] == 3 else "RGBA"
                if fmt == "PNG":
                    Image.fromarray(img, mode).save(buf, format="PNG", optimize=True)
                elif fmt == "WEBP":
                    Image.fromarray(img, mode).save(buf, format="WEBP", lossless=True, quality=100, method=6, exact=True)
                else:
                    Image.fromarray(img[..., :3], "RGB").save(buf, format="JPEG", quality=82)
                writer.write_tile(tileid, buf.getvalue())
                count += 1
                zn += 1
                zb += buf.tell()
            stats[z] = (zn, zb)
            print(f"z{z}: done ({count} tiles total)")
        writer.finalize(
            {
                "tile_type": {"PNG": TileType.PNG, "WEBP": TileType.WEBP}.get(fmt, TileType.JPEG),
                "tile_compression": Compression.NONE,
                "min_lon_e7": int(REGION["west"] * 1e7),
                "min_lat_e7": int(REGION["south"] * 1e7),
                "max_lon_e7": int(REGION["east"] * 1e7),
                "max_lat_e7": int(REGION["north"] * 1e7),
                "center_zoom": 11,
                "center_lon_e7": int((REGION["west"] + REGION["east"]) / 2 * 1e7),
                "center_lat_e7": int((REGION["south"] + REGION["north"]) / 2 * 1e7),
            },
            {"name": name, "attribution": attribution, **(metadata or {})},
        )
    print(f"wrote {path.name} ({path.stat().st_size / 1e6:.1f} MB, {count} tiles)")
    return stats


def grid_covers(transform, shape: tuple[int, int], crs: str, box: dict) -> bool:
    """True when a cached grid (affine transform, (rows, cols), CRS) reaches
    over a lon/lat box. The caches are reused by name, so this is what tells
    a grid read for a box that has since moved or grown."""
    from rasterio.warp import transform_bounds

    rows, cols = shape
    x0, y0 = transform * (0, 0)
    x1, y1 = transform * (cols, rows)
    w, s, e, n = transform_bounds("EPSG:4326", crs, box["west"], box["south"], box["east"], box["north"], densify_pts=21)
    return min(x0, x1) <= w and max(x0, x1) >= e and min(y0, y1) <= s and max(y0, y1) >= n


def hillshade(elev: np.ndarray, cell_m: float, az_deg: float = 315.0, alt_deg: float = 45.0) -> np.ndarray:
    """0..1 hillshade of an elevation grid in metres with square cells."""
    gy, gx = np.gradient(elev, cell_m)
    slope = np.arctan(np.hypot(gx, gy))
    aspect = np.arctan2(-gx, gy)
    az = math.radians(360.0 - az_deg + 90.0)
    alt = math.radians(alt_deg)
    shade = math.sin(alt) * np.cos(slope) + math.cos(alt) * np.sin(slope) * np.cos(az - aspect)
    return np.clip(shade, 0, 1)
