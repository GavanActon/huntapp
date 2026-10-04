"""NRCan HRDEM 1 m LiDAR → hillshade PMTiles for the area's core.

Each area lists its HRDEM LiDAR projects (bake.hrdem in its area file),
newest survey first: for Pickle Lake that is the single-photon project
ON-SPL_ON_White_Lake_UTM16_2021-1m (Oct 2021). An area without a list gets
whatever projects a STAC search of the hrdem-lidar collection finds over
its core, newest first. The DTMs are COGs on S3. Windowed reads through
GDAL's /vsicurl work but are slow from here (minutes per request), so the
core is read ONCE at full resolution in the newest survey's own CRS, cached
to pipeline/raw/lidar-<area>.npz, and every tile is rendered from that
array in memory. An older survey only fills the cells the newer ones have
no data for, on the same grid (the HRDEM projects share EPSG:3979 at 1 m),
and is blended into the newer one over FEATHER_M at their seam (feather).
A cache that exists is used as it is. Only the core comes from LiDAR; the
wider region's low zooms keep the MRDEM hillshade from build_tiles.py.

The lakes are left unshaded (lakes.py): the LiDAR ground model is not
flattened on water here, and its 0.2-1 m of noise drew as texture on the
lakes over the imagery (Gavan, 2026-09-28, in the Bow view).

    py -3.14 pipeline/build_hillshade.py [--area <id>] [dtm-url ...]
"""

from __future__ import annotations

import sys
import time

import numpy as np
import rasterio
from rasterio.transform import from_bounds
from rasterio.warp import Resampling, reproject, transform_bounds
from rasterio.windows import Window, from_bounds as window_from_bounds
from scipy.ndimage import distance_transform_edt

from area import BAKE, hrdem_project as project, hrdem_years as survey_years, note_source
from common import CACHE_DIR, CORE, OUT_DIR, REGION, REGION_MAXZOOM, grid_covers, hillshade, lat_to_tile, lon_to_tile, tile_bounds_3857, write_raster_pmtiles
from lakes import lake_mask_1m

STAC_SEARCH = "https://datacube.services.geo.ca/stac/api/search"
MARGIN_DEG = 0.004  # a few hundred metres past the core, so edge tiles shade cleanly
OVERSAMPLE = 2
FEATHER_M = 30.0  # an older survey filling a newer one's gaps is blended into it over this far

GDAL_ENV = dict(
    GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR",
    CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif",
    CPL_VSIL_CURL_CHUNK_SIZE="16777216",
    CPL_VSIL_CURL_CACHE_SIZE="400000000",
    GDAL_HTTP_MULTIRANGE="YES",
    GDAL_HTTP_MERGE_CONSECUTIVE_RANGES="YES",
    GDAL_HTTP_MAX_RETRY="6",
    GDAL_HTTP_RETRY_DELAY="5",
)


def stac_search(box: dict) -> list[str]:
    """The DTMs of every HRDEM LiDAR project that meets a lon/lat box,
    newest survey first. Each project's box is coarse, so an older one may
    have nothing inside; it then costs only the reads of the blocks still
    empty when its turn comes (fetch_core)."""
    import requests

    bbox = ",".join(str(box[k]) for k in ("west", "south", "east", "north"))
    for attempt in range(5):
        try:
            r = requests.get(STAC_SEARCH, params={"collections": "hrdem-lidar", "bbox": bbox, "limit": 100}, timeout=60)
            r.raise_for_status()
            items = r.json().get("features", [])
            break
        except Exception as e:  # noqa: BLE001
            print(f"  STAC search retry {attempt + 1}: {str(e)[:80]}")
            time.sleep(3 * (attempt + 1))
    else:
        raise SystemExit("the HRDEM STAC search failed: list the area's DTMs in bake.hrdem instead")
    items.sort(key=lambda f: f.get("properties", {}).get("datetime") or "", reverse=True)
    urls = [f["assets"]["dtm"]["href"] for f in items if "dtm" in f.get("assets", {})]
    if not urls:
        raise SystemExit(f"no HRDEM LiDAR project meets the core ({bbox})")
    print("HRDEM projects over the core, newest first: " + ", ".join(project(u) for u in urls))
    return urls


def hrdem_sources() -> list[str]:
    """The area's 1 m DTMs, newest survey first: bake.hrdem, else a STAC search."""
    return list(BAKE.get("hrdem") or []) or stac_search(CORE)


def checkpoint_tags(sources: list[str]) -> list[str]:
    """What each survey's resumable checkpoints are called after the area id:
    nothing for a single survey (the names Pickle Lake's read used), else
    the survey's year where that is unique, else its place in the list."""
    if len(sources) == 1:
        return [""]
    years = [survey_years(s)[:4] for s in sources]
    return [f"-{y}" if y and years.count(y) == 1 else f"-{i}" for i, y in enumerate(years)]


def read_survey(source: str, tag: str, need: np.ndarray | None = None, onto=None):
    """One survey over the core plus MARGIN_DEG: (array, transform, crs,
    nodata). Block by block with retries, checkpointed: the link drops
    often. Blocks wholly off the survey are left nodata unread. `need` marks
    the cells still empty on the grid `onto` (transform, shape, crs); on
    that same grid only the blocks with such a cell are read."""
    t = time.time()
    with rasterio.Env(**GDAL_ENV):
        with rasterio.open(f"/vsicurl/{source}") as src:
            nodata = src.nodata if src.nodata is not None else -32767.0
            wb = transform_bounds(
                "EPSG:4326", src.crs, CORE["west"] - MARGIN_DEG, CORE["south"] - MARGIN_DEG, CORE["east"] + MARGIN_DEG, CORE["north"] + MARGIN_DEG
            )
            w = window_from_bounds(*wb, transform=src.transform).round_offsets().round_lengths()
            W, H = int(w.width), int(w.height)
            transform = src.window_transform(w)
            crs = src.crs.to_string()
            if need is not None and not (onto[2] == crs and onto[1] == (H, W) and tuple(onto[0])[:6] == tuple(transform)[:6]):
                need = None  # another grid: read it all, fetch_core warps it over
            print(f"reading {W}x{H} px at {src.res[0]} m from {project(source)} in blocks …")
            part = CACHE_DIR / f"lidar-{REGION['id']}{tag}-partial.npy"
            done = CACHE_DIR / f"lidar-{REGION['id']}{tag}-done.npy"
            BS = 1024
            nbx, nby = -(-W // BS), -(-H // BS)
            if part.exists() and done.exists():
                elev = np.load(part)
                flags = np.load(done)
            else:
                elev = np.full((H, W), nodata, dtype=np.float32)
                flags = np.zeros((nby, nbx), dtype=bool)
            todo = int((~flags).sum())
            n = reads = 0
            for by in range(nby):
                for bx in range(nbx):
                    if flags[by, bx]:
                        continue
                    x0, y0 = bx * BS, by * BS
                    bw, bh = min(BS, W - x0), min(BS, H - y0)
                    win = Window(w.col_off + x0, w.row_off + y0, bw, bh)
                    c0, r0 = win.col_off, win.row_off
                    on_survey = c0 < src.width and r0 < src.height and c0 + bw > 0 and r0 + bh > 0
                    did_read = on_survey and (need is None or need[y0 : y0 + bh, x0 : x0 + bw].any())
                    if did_read:
                        edge = c0 < 0 or r0 < 0 or c0 + bw > src.width or r0 + bh > src.height
                        for attempt in range(8):
                            try:
                                elev[y0 : y0 + bh, x0 : x0 + bw] = src.read(1, window=win, boundless=edge, fill_value=nodata)
                                break
                            except Exception as e:  # noqa: BLE001
                                print(f"  block {by},{bx} retry {attempt + 1}: {str(e)[:80]}")
                                time.sleep(5 * (attempt + 1))
                        else:
                            raise SystemExit("gave up on a block; rerun to resume")
                        reads += 1
                    flags[by, bx] = True
                    n += 1
                    if did_read and reads % 4 == 0:
                        np.save(part, elev)
                        np.save(done, flags)
                        print(f"  {n}/{todo} blocks ({reads} read) · {time.time() - t:.0f} s")
            if todo:
                np.save(part, elev)
                np.save(done, flags)
                print(f"  {todo} blocks, {reads} read · {time.time() - t:.0f} s")
    return elev, transform, crs, float(nodata)


def gap_distance(gap: np.ndarray, cell_m: float) -> tuple[tuple[slice, slice], np.ndarray]:
    """Metres from each cell to the nearest gap cell, over the gaps' box
    widened by FEATHER_M (the rest is further than that): (the box, the
    distances in it)."""
    reach = int(np.ceil(FEATHER_M / cell_m)) + 1
    rows = np.flatnonzero(gap.any(axis=1))
    cols = np.flatnonzero(gap.any(axis=0))
    box = (slice(max(0, rows[0] - reach), rows[-1] + reach + 1), slice(max(0, cols[0] - reach), cols[-1] + reach + 1))
    return box, (distance_transform_edt(~gap[box]) * cell_m).astype(np.float32)


def feather(elev: np.ndarray, older: np.ndarray, older_ok: np.ndarray, gap: np.ndarray, cell_m: float) -> int:
    """Blend an older survey into the newer one where it is about to fill the
    newer one's gaps. Two surveys meet with a step of their own: at Lac
    Bailey the 2023 survey's edge sits about 0.1 m over the 2015-17 one, a
    straight hairline across a 1 m shade and a jog in every contour. So the
    newer heights within FEATHER_M of a gap go over to the older ones, all
    older at the gap's edge and all newer FEATHER_M in, and the seam is a
    slope of a few millimetres a metre. In place; returns the cells blended."""
    box, d = gap_distance(gap, cell_m)
    band = ~gap[box] & (d < FEATHER_M) & older_ok[box]
    w = d[band] / FEATHER_M
    e = elev[box]  # a view: written through
    e[band] = w * e[band] + (1 - w) * older[box][band]
    return int(band.sum())


def fetch_core(sources: list[str] | None = None):
    """The core's elevation grid in the newest survey's CRS: (array,
    transform, crs, nodata). From the cache when there is one; else read
    from the area's surveys (hrdem_sources), each older one filling only
    the cells the ones before it left empty, feathered in at the seam."""
    cache = CACHE_DIR / f"lidar-{REGION['id']}.npz"
    if cache.exists():
        z = np.load(cache, allow_pickle=True)
        elev, transform, crs, nodata = z["elev"], rasterio.Affine(*z["transform"]), str(z["crs"]), float(z["nodata"])
        print(f"cached {cache.name} {elev.shape}")
        if not grid_covers(transform, elev.shape, crs, CORE):
            raise SystemExit(f"{cache.name} does not reach over this area's core (moved or grown since it was read?): delete it to read the LiDAR again")
        return elev, transform, crs, nodata
    sources = sources or hrdem_sources()
    tags = checkpoint_tags(sources)
    t = time.time()
    elev, transform, crs, nodata = read_survey(sources[0], tags[0])
    used = [sources[0]]
    for source, tag in zip(sources[1:], tags[1:]):
        gap = elev == nodata
        if not gap.any():
            break
        print(f"  {gap.mean() * 100:.2f}% of the window has no data: filling it from {project(source)}")
        # the gaps, and the newer data near enough to them to be feathered
        need = np.zeros_like(gap)
        box, d = gap_distance(gap, abs(transform.a))
        need[box] = d < FEATHER_M
        older, t2, crs2, nd2 = read_survey(source, tag, need=need, onto=(transform, elev.shape, crs))
        del need, d
        if crs2 == crs and older.shape == elev.shape and tuple(t2)[:6] == tuple(transform)[:6]:
            ok = older != nd2
            fill = gap & ok
        else:
            warped = np.full(elev.shape, np.nan, dtype=np.float32)
            reproject(
                source=older,
                destination=warped,
                src_transform=t2,
                src_crs=crs2,
                src_nodata=nd2,
                dst_transform=transform,
                dst_crs=crs,
                dst_nodata=np.nan,
                resampling=Resampling.bilinear,
            )
            older = warped
            ok = np.isfinite(older)
            fill = gap & ok
        blended = feather(elev, older, ok, gap, abs(transform.a))
        elev[fill] = older[fill]
        del older
        used.append(source)
        print(f"  filled {int(fill.sum())} px, feathered {blended} px at the seam")
    print(f"  read in {time.time() - t:.0f} s · nodata px {(elev == nodata).sum()} ({(elev == nodata).mean() * 100:.2f}% of the window)")
    np.savez_compressed(cache, elev=elev, transform=np.array(transform)[:6], crs=crs, nodata=nodata, sources=np.array(used), feather_m=FEATHER_M)
    for tag in tags:
        for kind in ("partial", "done"):
            (CACHE_DIR / f"lidar-{REGION['id']}{tag}-{kind}.npy").unlink(missing_ok=True)
    return elev, transform, crs, nodata


def core_share(elev: np.ndarray, transform, crs: str, nodata: float) -> float:
    """The share of the core (not the margin) the LiDAR has data for."""
    w, s, e, n = transform_bounds("EPSG:4326", crs, CORE["west"], CORE["south"], CORE["east"], CORE["north"])
    c0, r0 = ~transform * (w, n)
    c1, r1 = ~transform * (e, s)
    win = elev[max(0, int(r0)) : int(np.ceil(r1)), max(0, int(c0)) : int(np.ceil(c1))]
    return float((win != nodata).mean()) if win.size else 0.0


def main(sources: list[str] | None = None):
    elev, transform, crs, nodata = fetch_core(sources)
    share = core_share(elev, transform, crs, nodata)
    print(f"LiDAR over {share * 100:.1f}% of the core")
    note_source(f"hillshade-lidar-{REGION['id']}.pmtiles", note=f"LiDAR over {share * 100:.0f}% of the core")
    elev = np.where(elev == nodata, np.nan, elev)
    wet, _, _ = lake_mask_1m(elev, transform, crs)
    fill = np.nanmean(elev)
    lat = (CORE["south"] + CORE["north"]) / 2

    def in_core(z, x, y):
        return (
            lon_to_tile(CORE["west"], z) <= x <= lon_to_tile(CORE["east"] - 1e-9, z)
            and lat_to_tile(CORE["north"], z) <= y <= lat_to_tile(CORE["south"] + 1e-9, z)
        )

    def render(z, x, y):
        if not in_core(z, x, y):
            return None
        b = tile_bounds_3857(z, x, y)
        size = 256 * OVERSAMPLE
        dst = np.full((size, size), np.nan, dtype=np.float32)
        reproject(
            source=np.nan_to_num(elev, nan=nodata),
            destination=dst,
            src_transform=transform,
            src_crs=crs,
            src_nodata=nodata,
            dst_transform=from_bounds(*b, size, size),
            dst_crs="EPSG:3857",
            dst_nodata=np.nan,
            resampling=Resampling.bilinear,
        )
        valid = ~np.isnan(dst)
        if valid.mean() < 0.01:
            return None
        # the lakes, bilinear so the cut at the shore is soft
        lake = np.zeros((size, size), dtype=np.float32)
        reproject(
            source=wet,
            destination=lake,
            src_transform=transform,
            src_crs=crs,
            dst_transform=from_bounds(*b, size, size),
            dst_crs="EPSG:3857",
            resampling=Resampling.bilinear,
        )
        cell_m = ((b[2] - b[0]) / size) * np.cos(np.radians(lat))
        sh = hillshade(np.where(valid, dst, fill), cell_m)
        sh = sh.reshape(256, OVERSAMPLE, 256, OVERSAMPLE).mean(axis=(1, 3))
        v = (valid * (1 - lake)).reshape(256, OVERSAMPLE, 256, OVERSAMPLE).mean(axis=(1, 3))
        shade = (sh - 0.5) * 2
        rgb = np.where(shade[..., None] < 0, 0, 255).astype(np.uint8).repeat(3, axis=-1)
        alpha = (np.abs(shade) * 0.85 * 255 * v).astype(np.uint8)
        return np.dstack([rgb, alpha])

    write_raster_pmtiles(
        OUT_DIR / f"hillshade-lidar-{REGION['id']}.pmtiles",
        f"hillshade-lidar-{REGION['id']}",
        "HRDEM LiDAR © Natural Resources Canada",
        REGION_MAXZOOM + 1,
        CORE["maxzoom"],
        render,
    )


if __name__ == "__main__":
    main(sys.argv[1:] or None)
