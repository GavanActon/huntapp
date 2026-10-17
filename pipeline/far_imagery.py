"""The far band: the country's imagery zoomed out, one archive for every
area, read from R2 (data/far/far-imagery-ca.pmtiles) wherever the map is.

Zoomed out past an area's box the map used to be the province's imagery
service, asked for at every notch of zoom: Quebec's answers a tile in half
a second to a second, six at a time, with the dark ground under it until
they land (Gavan, 2026-10-17: "quebec sat doesn't seem to pull when zoomed
out"). Nobody publishes an open photo of the whole country, so this bakes
one from Sentinel-2 at the zooms where 10 m pictures look the same as
anyone's: tiles z0 to z11 (a z11 pixel is 76 m on the Mercator grid, 50 m
on the ground at 49° N). From map zoom 11 the province's service takes over
(sources.ts FAR_HANDOFF), the baked archive inside the box as before.

The composite is s2_imagery.py's, coarse: for each z9 block (1024 px of the
z11 grid, 78 km at the equator's scale) the leaf-on Sentinel-2 L2A scenes
(20 June to 31 August, 2023 to 2025) from Earth Search (AWS, no login), the
least cloudy per MGRS tile; each read from the COG's overviews at 40 m (a
tenth of a per-cent of a scene's bytes), masked by its scene classification,
and the per-pixel median of the clear pixels in red, green and blue. Pixels
no scene ever saw clear take the nearest seen; pixels no scene covers (the
open sea past the 20 km Sentinel-2 flies offshore) are left dark water.
Tiles with nothing are not written. The reflectance goes to 8 bits with the
same white and gamma as the areas' Sentinel-2 bakes. JPEG tiles.

Blocks go into a sqlite scratch (pipeline/raw/far/<name>.mbtiles) as they
finish, so a run picks up where it stopped, and several processes can share
the blocks (--part r/k, each to its own scratch). --assemble builds the
pyramid z8 down to z0 from the stored z9 tiles and writes the PMTiles;
--upload puts it on R2.

    py -3.14 pipeline/far_imagery.py --box -71,48.5,-68,50.5 --name far-test     a test box (16 blocks)
    py -3.14 pipeline/far_imagery.py --part 0/3                                   the country, one of three processes
    py -3.14 pipeline/far_imagery.py --assemble [--name far-imagery-ca]           the pyramid and the archive
    py -3.14 pipeline/far_imagery.py --upload   [--name far-imagery-ca]           to r2://groundwind-data/data/far/

Licence: Copernicus Sentinel data, free and open, commercial use allowed;
the credit "Contains modified Copernicus Sentinel data" is the archive's
attribution (the Sentinel data legal notice).
"""

from __future__ import annotations

import argparse
import io
import math
import sqlite3
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import from_origin
from rasterio.warp import Resampling, reproject, transform_bounds
from rasterio.windows import from_bounds
from scipy.ndimage import distance_transform_edt

ROOT = Path(__file__).resolve().parent.parent
SCRATCH = ROOT / "pipeline" / "raw" / "far"

# ---- the grid --------------------------------------------------------------
Z = 11  # the deepest tile
BLOCK_Z = 9  # one block = one z9 tile = 1024 px of the z11 grid
BLOCK_PX = 256 * 2 ** (Z - BLOCK_Z)
WORLD = 2 * math.pi * 6378137.0
PX_M = WORLD / (2**Z * 256)  # a z11 pixel in Mercator metres (76.4)
# Canada's land: the Yukon's border to Newfoundland, the US line to the Arctic
# coast of the mainland (the islands past 70° N are nobody's hunt yet)
CANADA = (-141.0, 41.7, -52.6, 70.0)
TILE_JPEG_QUALITY = 82

# ---- the scenes --------------------------------------------------------------
STAC = "https://earth-search.aws.element84.com/v1"
YEARS = (2023, 2024, 2025)
LEAF_ON = ("06-20", "08-31")
CLOUD_MAX = 75
CANDIDATES_PER_TILE = 10  # the least cloudy scenes of an MGRS tile whose masks are read
SCENES_PER_TILE = 6  # the clearest of those that go into the median
MIN_CLEAR = 0.15  # a scene's share of its own footprint in the block that must be clear
READ_M = 40.0  # the overview the bands are read at: finer than the z11 pixel anywhere in Canada
CLEAR = (4, 5, 6, 7)  # SCL: vegetation, bare, water, unclassified
SNOW = 11  # summer snowfields are ground here, not a mask
S2_SCALE = 1e-4
THREADS = 16
# reflectance to 8 bits (s2_imagery.py): full white at this reflectance, lifted by the gamma
WHITE = 0.28
GAMMA = 1.0 / 1.5
WATER = np.array([9, 18, 30], np.uint8)  # the open sea no scene covers
# a scene whose footprint covers less of the block than this is not worth its reads
MIN_FOOTPRINT = 0.02

GDAL_ENV = dict(
    GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR",
    CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif,.TIF",
    GDAL_HTTP_MULTIRANGE="YES",
    GDAL_HTTP_MERGE_CONSECUTIVE_RANGES="YES",
    GDAL_HTTP_MAX_RETRY="6",
    GDAL_HTTP_RETRY_DELAY="2",
    VSI_CACHE="TRUE",
    VSI_CACHE_SIZE="50000000",
)


# ---- tiles -------------------------------------------------------------------
def lon_to_tile(lon: float, z: int) -> int:
    return int((lon + 180) / 360 * 2**z)


def lat_to_tile(lat: float, z: int) -> int:
    r = math.radians(lat)
    return int((1 - math.asinh(math.tan(r)) / math.pi) / 2 * 2**z)


def tile_bounds_3857(z: int, x: int, y: int) -> tuple[float, float, float, float]:
    n = 2**z
    minx = -WORLD / 2 + x * WORLD / n
    maxy = WORLD / 2 - y * WORLD / n
    return minx, maxy - WORLD / n, minx + WORLD / n, maxy


def tiles_in(box: tuple[float, float, float, float], z: int) -> list[tuple[int, int]]:
    """The tiles over the box, south to north: the hunting latitudes first, so a
    part-way assembly already serves the areas."""
    w, s, e, n = box
    x0, x1 = lon_to_tile(w, z), lon_to_tile(e - 1e-9, z)
    y0, y1 = lat_to_tile(n, z), lat_to_tile(s + 1e-9, z)
    return [(x, y) for y in range(y1, y0 - 1, -1) for x in range(x0, x1 + 1)]


@dataclass
class Grid:
    crs: str
    transform: rasterio.Affine
    width: int
    height: int

    @property
    def shape(self):
        return (self.height, self.width)

    def bounds(self):
        t = self.transform
        return (t.c, t.f + t.e * self.height, t.c + t.a * self.width, t.f)

    def lonlat_box(self, pad: float = 0.0):
        b = transform_bounds(self.crs, "EPSG:4326", *self.bounds(), densify_pts=21)
        return (b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad)


def block_grid(x: int, y: int) -> Grid:
    minx, _, _, maxy = tile_bounds_3857(BLOCK_Z, x, y)
    return Grid("EPSG:3857", from_origin(minx, maxy, PX_M, PX_M), BLOCK_PX, BLOCK_PX)


# ---- reading a scene ---------------------------------------------------------
def read_decimated(href: str, grid: Grid, px_m: float, categorical: bool):
    """A scene's asset over the block, read from the overview nearest px_m
    (the COG's, so a fraction of the file), onto the block's grid: average
    for reflectance, nearest for classes. None when the scene does not reach,
    or covers too little of the block to be worth it."""
    with rasterio.Env(**GDAL_ENV), rasterio.open(href) as ds:
        b = transform_bounds(grid.crs, ds.crs, *grid.bounds(), densify_pts=21)
        w = from_bounds(*b, ds.transform).round_offsets().round_lengths()
        k = max(1, int(round(px_m / abs(ds.transform.a))))
        pad = 2 * k
        c0, r0 = max(0, int(w.col_off) - pad), max(0, int(w.row_off) - pad)
        c1, r1 = min(ds.width, int(w.col_off + w.width) + pad), min(ds.height, int(w.row_off + w.height) + pad)
        if c1 - c0 < k or r1 - r0 < k:
            return None
        win = rasterio.windows.Window(c0, r0, c1 - c0, r1 - r0)
        oh, ow = max(1, (r1 - r0) // k), max(1, (c1 - c0) // k)
        a = ds.read(1, window=win, out_shape=(oh, ow), resampling=Resampling.nearest if categorical else Resampling.average).astype(np.float32)
        if ds.nodata is not None:
            a[a == ds.nodata] = np.nan
        elif not categorical:
            a[a == 0] = np.nan  # Sentinel-2's zero is "no data" even when the file does not say
        tr = ds.window_transform(win) * rasterio.Affine.scale((c1 - c0) / ow, (r1 - r0) / oh)
        src_crs = ds.crs
    out = np.full(grid.shape, np.nan, np.float32)
    reproject(a, out, src_transform=tr, src_crs=src_crs, dst_transform=grid.transform, dst_crs=grid.crs, src_nodata=np.nan, dst_nodata=np.nan, resampling=Resampling.nearest if categorical else Resampling.bilinear)
    return out


def stac_items(grid: Grid) -> list:
    import pystac_client

    cat = pystac_client.Client.open(STAC)
    box = list(grid.lonlat_box(0.005))
    items = []
    for y in YEARS:
        s = cat.search(collections=["sentinel-2-l2a"], bbox=box, datetime=f"{y}-{LEAF_ON[0]}/{y}-{LEAF_ON[1]}", query={"eo:cloud_cover": {"lt": CLOUD_MAX}}, max_items=400)
        items.extend(s.items())
    return items


def composite(grid: Grid, ex: ThreadPoolExecutor, log) -> tuple[np.ndarray, np.ndarray, int] | None:
    """(rgb reflectance (3, H, W) with NaN where never clear, covered (H, W) bool, scenes used), or None when no scene reaches."""
    for attempt in range(3):
        try:
            items = stac_items(grid)
            break
        except Exception as e:  # noqa: BLE001
            if attempt == 2:
                raise
            log(f"    stac: {str(e)[:80]}, again")
            time.sleep(5)
    if not items:
        return None
    by_tile: dict[str, list] = {}
    for it in items:
        by_tile.setdefault(it.properties.get("grid:code", "?"), []).append(it)
    cand = []
    for tile_items in by_tile.values():
        tile_items.sort(key=lambda it: it.properties.get("eo:cloud_cover", 100))
        cand.extend(tile_items[:CANDIDATES_PER_TILE])

    def mask_of(it):
        for attempt in range(3):
            try:
                scl = read_decimated(it.assets["scl"].href, grid, READ_M * 2, categorical=True)
                if scl is None:
                    return None
                covered = np.isfinite(scl)
                if covered.mean() < MIN_FOOTPRINT:
                    return None
                clear = (np.isin(scl, CLEAR) | (scl == SNOW)) & covered
                return clear, covered, float(clear.sum() / max(covered.sum(), 1))
            except Exception as e:  # noqa: BLE001
                if attempt == 2:
                    log(f"    {it.id} scl: {str(e)[:80]}")
                    return None
                time.sleep(2)

    masks = list(ex.map(mask_of, cand))
    kept: dict[str, list] = {}
    for it, m in zip(cand, masks):
        if m is None or m[2] < MIN_CLEAR:
            continue
        kept.setdefault(it.properties.get("grid:code", "?"), []).append((m[2], it, m[0], m[1]))
    scenes = []
    for tile_scenes in kept.values():
        tile_scenes.sort(key=lambda t: -t[0])
        scenes.extend(tile_scenes[:SCENES_PER_TILE])
    if not scenes:
        covered_any = np.zeros(grid.shape, bool)
        for m in masks:
            if m is not None:
                covered_any |= m[1]
        return (np.full((3,) + grid.shape, np.nan, np.float32), covered_any, 0) if covered_any.any() else None

    def band_of(job):
        i, b = job
        it = scenes[i][1]
        for attempt in range(3):
            try:
                a = read_decimated(it.assets[b].href, grid, READ_M, categorical=False)
                return None if a is None else a * S2_SCALE
            except Exception as e:  # noqa: BLE001
                if attempt == 2:
                    log(f"    {it.id} {b}: {str(e)[:80]}")
                    return None
                time.sleep(2)

    bands = ("red", "green", "blue")
    jobs = [(i, b) for i in range(len(scenes)) for b in bands]
    reads = list(ex.map(band_of, jobs))
    stack = np.full((len(scenes), 3) + grid.shape, np.nan, np.float32)
    for (i, b), a in zip(jobs, reads):
        if a is not None:
            a[~scenes[i][2]] = np.nan
            stack[i, bands.index(b)] = a
    with np.errstate(all="ignore"):
        rgb = np.nanmedian(stack, axis=0)
    covered_any = np.zeros(grid.shape, bool)
    for m in masks:
        if m is not None:
            covered_any |= m[1]
    return rgb, covered_any, len(scenes)


def to_rgb8(rgb: np.ndarray, covered: np.ndarray) -> np.ndarray:
    """(H, W, 3) uint8: the seen pixels toned, the gaps filled from the
    nearest seen, the uncovered left as dark water."""
    seen = np.isfinite(rgb[0])
    if not seen.any():
        return np.broadcast_to(WATER, rgb.shape[1:] + (3,)).copy()
    if not seen.all():
        _, (iy, ix) = distance_transform_edt(~seen, return_indices=True)
        rgb = rgb[:, iy, ix]
    v = np.clip(np.nan_to_num(rgb) / WHITE, 0, 1) ** GAMMA
    out = np.moveaxis((v * 255 + 0.5).astype(np.uint8), 0, -1).copy()
    out[~covered] = WATER
    return out


# ---- the scratch -------------------------------------------------------------
class Scratch:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path, timeout=60)
        self.db.executescript(
            "CREATE TABLE IF NOT EXISTS tiles (z INTEGER, x INTEGER, y INTEGER, data BLOB, PRIMARY KEY (z, x, y));"
            "CREATE TABLE IF NOT EXISTS blocks (x INTEGER, y INTEGER, status TEXT, scenes INTEGER, took REAL, PRIMARY KEY (x, y));"
        )

    def done(self) -> set[tuple[int, int]]:
        return {(x, y) for x, y in self.db.execute("SELECT x, y FROM blocks")}

    def put_block(self, x: int, y: int, status: str, scenes: int, took: float, tiles: list[tuple[int, int, int, bytes]]):
        with self.db:
            self.db.executemany("INSERT OR REPLACE INTO tiles VALUES (?, ?, ?, ?)", tiles)
            self.db.execute("INSERT OR REPLACE INTO blocks VALUES (?, ?, ?, ?, ?)", (x, y, status, scenes, took))

    def tile(self, z: int, x: int, y: int) -> bytes | None:
        r = self.db.execute("SELECT data FROM tiles WHERE z=? AND x=? AND y=?", (z, x, y)).fetchone()
        return r[0] if r else None

    def tiles_at(self, z: int) -> list[tuple[int, int]]:
        return [(x, y) for x, y in self.db.execute("SELECT x, y FROM tiles WHERE z=?", (z,))]

    def put_tiles(self, tiles: list[tuple[int, int, int, bytes]]):
        with self.db:
            self.db.executemany("INSERT OR REPLACE INTO tiles VALUES (?, ?, ?, ?)", tiles)

    def counts(self) -> dict[int, tuple[int, int]]:
        return {z: (n, b) for z, n, b in self.db.execute("SELECT z, COUNT(*), SUM(LENGTH(data)) FROM tiles GROUP BY z ORDER BY z")}


def jpeg(img: np.ndarray) -> bytes:
    from PIL import Image

    buf = io.BytesIO()
    Image.fromarray(img, "RGB").save(buf, format="JPEG", quality=TILE_JPEG_QUALITY)
    return buf.getvalue()


def unjpeg(data: bytes) -> np.ndarray:
    from PIL import Image

    return np.asarray(Image.open(io.BytesIO(data)).convert("RGB"))


def halve(img: np.ndarray) -> np.ndarray:
    """A 2x box filter: (2h, 2w, 3) uint8 to (h, w, 3)."""
    a = img.astype(np.uint16)
    return ((a[0::2, 0::2] + a[1::2, 0::2] + a[0::2, 1::2] + a[1::2, 1::2] + 2) // 4).astype(np.uint8)


def block_tiles(x: int, y: int, img: np.ndarray, covered: np.ndarray) -> list[tuple[int, int, int, bytes]]:
    """The block's tiles at z11, z10 and z9: a tile with nothing covered is not written."""
    out = []
    cov = covered
    for z in range(Z, BLOCK_Z - 1, -1):
        n = 2 ** (z - BLOCK_Z)
        for j in range(n):
            for i in range(n):
                c = cov[j * 256 : (j + 1) * 256, i * 256 : (i + 1) * 256]
                if not c.any():
                    continue
                out.append((z, x * n + i, y * n + j, jpeg(np.ascontiguousarray(img[j * 256 : (j + 1) * 256, i * 256 : (i + 1) * 256]))))
        if z > BLOCK_Z:
            img = halve(img)
            cov = cov.reshape(cov.shape[0] // 2, 2, cov.shape[1] // 2, 2).any(axis=(1, 3))
    return out


# ---- the runs ----------------------------------------------------------------
def bake(box: tuple[float, float, float, float], scratch: Scratch, part: tuple[int, int], log) -> None:
    blocks = tiles_in(box, BLOCK_Z)
    r, k = part
    mine = [b for i, b in enumerate(blocks) if i % k == r]
    done = scratch.done()
    todo = [b for b in mine if b not in done]
    log(f"{len(blocks)} blocks in the box, {len(mine)} this part, {len(todo)} to do")
    t_all = time.time()
    n_done = 0
    with ThreadPoolExecutor(THREADS) as ex:
        for x, y in todo:
            t = time.time()
            g = block_grid(x, y)
            try:
                got = composite(g, ex, log)
            except Exception as e:  # noqa: BLE001
                log(f"  block {x},{y}: failed, {str(e)[:120]}; left for the next run")
                continue
            if got is None:
                scratch.put_block(x, y, "empty", 0, time.time() - t, [])
                n_done += 1
                continue
            rgb, covered, scenes = got
            # covered but never clear: cloud over the whole block every pass; left for a wider net later
            tiles = block_tiles(x, y, to_rgb8(rgb, covered), covered) if scenes else []
            took = time.time() - t
            scratch.put_block(x, y, "ok" if scenes else "cloudy", scenes, took, tiles)
            n_done += 1
            rate = (time.time() - t_all) / n_done
            log(f"  block {x},{y}: {scenes} scenes, {len(tiles)} tiles, {took:.0f} s · {n_done}/{len(todo)} · ~{rate * (len(todo) - n_done) / 60:.0f} min left")
    log(f"done in {(time.time() - t_all) / 60:.0f} min")


def assemble(name: str, scratches: list[Path], out: Path, log) -> None:
    """Every scratch's tiles into one, the pyramid z8..z0 over them, then the archive."""
    from pmtiles.tile import Compression, TileType, zxy_to_tileid
    from pmtiles.writer import Writer

    merged = Scratch(SCRATCH / f"{name}.assembled.mbtiles")
    for p in scratches:
        src = sqlite3.connect(p)
        rows = src.execute("SELECT z, x, y, data FROM tiles WHERE z >= ?", (BLOCK_Z,)).fetchall()
        merged.put_tiles(rows)
        log(f"  {p.name}: {len(rows)} tiles")
    with merged.db:
        merged.db.execute("DELETE FROM tiles WHERE z < ?", (BLOCK_Z,))
    for z in range(BLOCK_Z - 1, -1, -1):
        parents: dict[tuple[int, int], list] = {}
        for x, y in merged.tiles_at(z + 1):
            parents.setdefault((x // 2, y // 2), []).append((x, y))
        tiles = []
        for (px, py), kids in parents.items():
            canvas = np.empty((512, 512, 3), np.uint8)
            canvas[:] = WATER
            for x, y in kids:
                img = unjpeg(merged.tile(z + 1, x, y))
                i, j = x - px * 2, y - py * 2
                canvas[j * 256 : (j + 1) * 256, i * 256 : (i + 1) * 256] = img
            tiles.append((z, px, py, jpeg(halve(canvas))))
        merged.put_tiles(tiles)
        log(f"  z{z}: {len(tiles)} tiles")
    counts = merged.counts()
    total = sum(n for n, _ in counts.values())
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "wb") as f:
        w = Writer(f)
        for z in range(0, Z + 1):
            rows = sorted(((zxy_to_tileid(z, x, y), x, y) for x, y in merged.tiles_at(z)))
            for tid, x, y in rows:
                w.write_tile(tid, merged.tile(z, x, y))
        w.finalize(
            {
                "tile_type": TileType.JPEG,
                "tile_compression": Compression.NONE,
                "min_lon_e7": int(CANADA[0] * 1e7),
                "min_lat_e7": int(CANADA[1] * 1e7),
                "max_lon_e7": int(CANADA[2] * 1e7),
                "max_lat_e7": int(CANADA[3] * 1e7),
                "center_zoom": 5,
                "center_lon_e7": int((CANADA[0] + CANADA[2]) / 2 * 1e7),
                "center_lat_e7": int((CANADA[1] + CANADA[3]) / 2 * 1e7),
            },
            {
                "name": name,
                "attribution": f"Contains modified Copernicus Sentinel data {YEARS[0]}-{YEARS[-1]}",
                "description": f"Sentinel-2 L2A leaf-on median composite, Earth Search (AWS), tiles z0-z{Z}",
                "vintage": f"summers {YEARS[0]}-{YEARS[-1]}",
            },
        )
    log(f"wrote {out} ({out.stat().st_size / 1e6:.0f} MB, {total} tiles): " + " ".join(f"z{z}:{n}/{b / 1e6:.0f}MB" for z, (n, b) in counts.items()))


def upload(path: Path, log) -> None:
    sys.path.insert(0, str(ROOT / "app" / "scripts"))
    import r2_sync

    from boto3.s3.transfer import TransferConfig

    key = f"{r2_sync.PREFIX}far/{path.name}"
    s3 = r2_sync.client()
    t = time.time()
    s3.upload_file(str(path), r2_sync.BUCKET, key, ExtraArgs={"ContentType": r2_sync.content_type(key), "CacheControl": r2_sync.CACHE_DATA}, Config=TransferConfig(multipart_threshold=r2_sync.MULTIPART_AT, multipart_chunksize=r2_sync.PART, max_concurrency=8))
    head = s3.head_object(Bucket=r2_sync.BUCKET, Key=key)
    log(f"uploaded {key}: {head['ContentLength'] / 1e6:.0f} MB in {time.time() - t:.0f} s · {r2_sync.PUBLIC}{key}")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--name", default="far-imagery-ca", help="the archive's name (the scratch's too)")
    ap.add_argument("--box", help="west,south,east,north in degrees; the country by default")
    ap.add_argument("--part", default="0/1", help="r/k: this process takes every k-th block from r; its scratch is <name>.r-of-k.mbtiles")
    ap.add_argument("--assemble", action="store_true", help="the pyramid and the PMTiles from every part's scratch")
    ap.add_argument("--upload", action="store_true", help="the archive to R2 under data/far/")
    a = ap.parse_args(argv)

    def log(s: str):
        print(time.strftime("%H:%M:%S ") + s, flush=True)

    out = SCRATCH / f"{a.name}.pmtiles"
    if a.assemble:
        parts = sorted(SCRATCH.glob(f"{a.name}.*-of-*.mbtiles"))
        if not parts:
            raise SystemExit(f"no scratch for {a.name} in {SCRATCH}")
        assemble(a.name, parts, out, log)
    if a.upload:
        if not out.exists():
            raise SystemExit(f"{out} is not there: --assemble first")
        upload(out, log)
    if a.assemble or a.upload:
        return 0
    box = tuple(float(v) for v in a.box.split(",")) if a.box else CANADA
    r, k = (int(v) for v in a.part.split("/"))
    path = SCRATCH / f"{a.name}.{r}-of-{k}.mbtiles"
    scratch = Scratch(path)
    log(f"far band {a.name}: box {box}, part {r}/{k}, scratch {path}")
    bake(box, scratch, (r, k), log)
    return 0


if __name__ == "__main__":
    sys.exit(main())
