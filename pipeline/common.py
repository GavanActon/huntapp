"""Shared pipeline bits: the region (read from app/src/config.ts so there is
one definition), web-mercator tile maths, and a raster → PMTiles writer."""

from __future__ import annotations

import io
import math
import re
from pathlib import Path

import numpy as np
from PIL import Image
from pmtiles.tile import Compression, TileType, zxy_to_tileid
from pmtiles.writer import Writer

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "app"
OUT_DIR = APP / "public" / "data"
CACHE_DIR = ROOT / "pipeline" / "raw"
OUT_DIR.mkdir(parents=True, exist_ok=True)
CACHE_DIR.mkdir(parents=True, exist_ok=True)


def read_region() -> dict:
    """REGION = { id, name, west, south, east, north } out of config.ts."""
    src = (APP / "src" / "config.ts").read_text(encoding="utf-8")
    m = re.search(r"export const REGION = \{(.*?)\}", src, re.S)
    if not m:
        raise SystemExit("REGION not found in app/src/config.ts")
    body = m.group(1)
    region: dict = {}
    for key in ("id", "name"):
        km = re.search(rf"{key}:\s*'([^']*)'", body)
        region[key] = km.group(1) if km else key
    for key in ("west", "south", "east", "north"):
        km = re.search(rf"{key}:\s*(-?[\d.]+)", body)
        region[key] = float(km.group(1))
    return region


def read_block(name: str) -> dict:
    src = (APP / "src" / "config.ts").read_text(encoding="utf-8")
    m = re.search(rf"export const {name} = \{{(.*?)\}}", src, re.S)
    if not m:
        raise SystemExit(f"{name} not found in app/src/config.ts")
    out: dict = {}
    for km in re.finditer(r"(\w+):\s*(-?[\d.]+)", m.group(1)):
        out[km.group(1)] = float(km.group(2)) if "." in km.group(2) else int(km.group(2))
    return out


REGION = read_region()
CORE = read_block("CORE")
_rm = re.search(r"REGION_MAXZOOM = (\d+)", (APP / "src" / "config.ts").read_text(encoding="utf-8"))
REGION_MAXZOOM = int(_rm.group(1)) if _rm else 11


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


def hillshade(elev: np.ndarray, cell_m: float, az_deg: float = 315.0, alt_deg: float = 45.0) -> np.ndarray:
    """0..1 hillshade of an elevation grid in metres with square cells."""
    gy, gx = np.gradient(elev, cell_m)
    slope = np.arctan(np.hypot(gx, gy))
    aspect = np.arctan2(-gx, gy)
    az = math.radians(360.0 - az_deg + 90.0)
    alt = math.radians(alt_deg)
    shade = math.sin(alt) * np.cos(slope) + math.cos(alt) * np.sin(slope) * np.cos(az - aspect)
    return np.clip(shade, 0, 1)
