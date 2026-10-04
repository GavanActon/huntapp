"""Ontario FRI leaf-on single-photon LiDAR point clouds (COPC LAZ) for the core.

The White Lake 2021 SPL project behind the HRDEM DTM (build_hillshade.py)
is NOT in NRCan's CanElevation point-cloud bucket
(canelevation-lidar-point-clouds, whose project index has nothing within
200 km of the camp). Ontario serves it through the Forest Resources
Inventory leaf-on LiDAR download service, no login:

  tile index  https://download.fri.mnrf.gov.on.ca/api/api/Download/tile-index/
              FRI_Leaf_On_Tile_Index_GeoPackage/FRI_Leaf_On_Tile_Index_GeoPackage.gpkg
              (335 MB, EPSG:3857, layer FRI_Tile_Index; queried remotely with a
              bbox through GDAL /vsicurl, so only a few MB are read)
  per tile    Download_LAZ  .../Download/laz/utm16/<Tilename>.copc.laz
              Download_DEM  .../Download/geohub_compressed_dem/utm16/<Tilename>_DEM.tif
              (also _DSM, _Canopy (CHM) GeoTIFFs and a _HAG.copc.laz)

Tiles are 1 km squares in NAD83(CSRS) / UTM 16N (EPSG:3160), heights
CGVD2013, named 1kmZ16EEEENNNNNYYYYL: EEEE and NNNNN are the SW corner in
units of 100 m. The download endpoint 302s to a signed Azure blob URL that
honours Range, so every file is pulled with ranged GETs and resumed from its
.part file after a drop; finished files are skipped. The DEM GeoTIFF
(0.5 m, same tile) is fetched with each LAZ: build_vegstructure.py
normalises heights against it.

Size: ~42 M points and ~270 MB per tile (6.4 bytes per point in COPC); the
whole core is 90 tiles, about 26 GB. The COPC octree's coarse levels are
3-D voxel-thinned (PDAL writers.copc), which biases return ratios, so there
is no cheap low-resolution read. There is a cheap PARTIAL read: --band
fetches only the octree nodes meeting a piece of ground (a shore band, a
circle round a point), at every level, so the points there are complete,
and keeps the points of the 10 m cells wholly inside it, as a plain LAZ
(<Tilename>.band.laz) that build_vegstructure.py reads like a whole tile
(cells with no points come out nodata). Every level's nodes that touch the
ground are read whole, so a band costs more than its share of the tile
(a 150 m shore band round Pickle Lake: about a quarter of its tiles'
bytes). The tile's DEM is fetched whole either way. --list prints the
exact bytes first, from the tiles' indexes alone (a few hundred KB each).

Reading the index needs GDAL (pyogrio), which on this machine is only in
Python 3.13; the result is cached, so later runs need only the stdlib and
requests:

    py -3.13 pipeline/fetch_pointcloud.py --list              # sizes only
    py -3.13 pipeline/fetch_pointcloud.py --radius-km 2       # tiles within 2 km of the area's centre
    py -3.13 pipeline/fetch_pointcloud.py --tile 598/5417     # add a tile (km E / km N)
    py -3.13 pipeline/fetch_pointcloud.py --all --max-gb 30   # the whole core
    python pipeline/fetch_pointcloud.py --band --lake "Pickle Lake" --band-m 150 --around 48.95951,-85.55590,300 --list
                                                              # the shore band and a circle: sizes only; without --list, fetch

Output: pipeline/raw/pointcloud/laz/*.copc.laz (whole tiles) and *.band.laz (bands, with
        a .band.json saying what was kept), pipeline/raw/pointcloud/dem/*_DEM.tif,
        pipeline/raw/pointcloud/tiles-<region>.json (index rows + sizes).
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import numpy as np
import requests

from area import BAKE, HOME, adapter
from common import CACHE_DIR, CORE, OUT_DIR, REGION

INDEX_URL = (
    "https://download.fri.mnrf.gov.on.ca/api/api/Download/tile-index/"
    "FRI_Leaf_On_Tile_Index_GeoPackage/FRI_Leaf_On_Tile_Index_GeoPackage.gpkg"
)
PC_DIR = CACHE_DIR / "pointcloud"
LAZ_DIR = PC_DIR / "laz"
DEM_DIR = PC_DIR / "dem"
INDEX_CACHE = PC_DIR / f"tiles-{REGION['id']}.json"
NAME_RE = re.compile(r"^1kmZ(\d\d)(\d{4})(\d{5})(\d{4})L$")
UTM_EPSG = {15: 3159, 16: 3160, 17: 2958}  # NAD83(CSRS) / UTM zone n


def parse_name(name: str) -> dict:
    m = NAME_RE.match(name)
    if not m:
        raise ValueError(f"unexpected tile name {name}")
    zone, e, n, year = (int(g) for g in m.groups())
    return {"zone": zone, "x0": e * 100, "y0": n * 100, "year": year}


def query_index() -> list[dict]:
    """Tiles whose footprint meets the core's bbox, from the remote GeoPackage."""
    if INDEX_CACHE.exists():
        return json.loads(INDEX_CACHE.read_text())
    try:
        os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
        os.environ.setdefault("CPL_VSIL_CURL_ALLOWED_EXTENSIONS", ".gpkg")
        os.environ.setdefault("CPL_VSIL_CURL_CHUNK_SIZE", "1048576")
        import pyogrio
        from pyproj import Transformer
    except ImportError:
        raise SystemExit("reading the tile index needs pyogrio: run once with py -3.13 (the result is cached)")
    t = Transformer.from_crs("EPSG:4326", "EPSG:3857", always_xy=True)
    x0, y0 = t.transform(CORE["west"], CORE["south"])
    x1, y1 = t.transform(CORE["east"], CORE["north"])
    print("querying the FRI leaf-on tile index …")
    meta, _, _, fields = pyogrio.raw.read(f"/vsicurl/{INDEX_URL}", layer="FRI_Tile_Index", bbox=(x0, y0, x1, y1))
    names = list(meta["fields"])
    rows = []
    for i in range(len(fields[0])):
        row = {n: fields[j][i] for j, n in enumerate(names)}
        row |= parse_name(row["Tilename"])
        rows.append(row)
    rows.sort(key=lambda r: r["Tilename"])
    PC_DIR.mkdir(parents=True, exist_ok=True)
    INDEX_CACHE.write_text(json.dumps(rows, indent=1))
    print(f"  {len(rows)} tiles, cached to {INDEX_CACHE.name}")
    return rows


def head_size(url: str) -> int:
    for attempt in range(6):
        try:
            r = requests.head(url, timeout=60, allow_redirects=True)
            r.raise_for_status()
            return int(r.headers["content-length"])
        except Exception as e:  # noqa: BLE001
            print(f"  HEAD retry {attempt + 1}: {str(e)[:80]}")
            time.sleep(3 * (attempt + 1))
    raise SystemExit(f"cannot size {url}")


def ensure_sizes(rows: list[dict], sel: list[dict]) -> None:
    missing = [r for r in sel if "laz_bytes" not in r or "dem_bytes" not in r]
    if not missing:
        return
    print(f"sizing {len(missing)} tiles …")
    with ThreadPoolExecutor(8) as ex:
        futs = {ex.submit(head_size, r["Download_LAZ"]): (r, "laz_bytes") for r in missing}
        futs |= {ex.submit(head_size, r["Download_DEM"]): (r, "dem_bytes") for r in missing}
        for f in as_completed(futs):
            r, k = futs[f]
            r[k] = f.result()
    INDEX_CACHE.write_text(json.dumps(rows, indent=1))


def signed_url(url: str) -> str:
    """The API answers 400 to a Range header; the blob it redirects to takes one."""
    r = requests.get(url, allow_redirects=False, timeout=60)
    if r.status_code in (301, 302, 303, 307, 308):
        return r.headers["location"]
    r.raise_for_status()
    return url


def download(url: str, dest: Path, total: int) -> str:
    """Ranged, resumable GET into dest (.part until complete)."""
    if dest.exists() and dest.stat().st_size == total:
        return "have"
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_name(dest.name + ".part")
    have = part.stat().st_size if part.exists() else 0
    if have > total:
        part.unlink()
        have = 0
    attempt = 0
    blob = None
    while have < total:
        try:
            blob = blob or signed_url(url)
            r = requests.get(blob, headers={"Range": f"bytes={have}-"}, stream=True, timeout=(30, 120))
            if r.status_code == 200 and have:
                have = 0  # range ignored: start over
                part.unlink(missing_ok=True)
            elif r.status_code not in (200, 206):
                r.raise_for_status()
            with open(part, "ab") as f:
                for chunk in r.iter_content(1 << 20):
                    f.write(chunk)
                    have += len(chunk)
            attempt = 0
        except Exception as e:  # noqa: BLE001
            attempt += 1
            if attempt > 10:
                raise SystemExit(f"gave up on {dest.name} at {have / 1e6:.0f} MB; rerun to resume")
            print(f"  {dest.name}: retry {attempt} at {have / 1e6:.0f} MB ({str(e)[:60]})")
            time.sleep(3 * attempt)
            have = part.stat().st_size if part.exists() else 0
            blob = None  # the signature is short-lived: ask again
    if have != total:
        raise SystemExit(f"{dest.name}: got {have} bytes, expected {total}")
    part.replace(dest)
    return "got"


# ---- a band of a tile, not the whole tile --------------------------------

BAND_SUFFIX = ".band.laz"
BAND_HEADER_KB = 400  # about what reading a tile's COPC index costs


def band_area(args):
    """The ground wanted, in the tiles' CRS: land within --band-m of the named
    lakes (and 20 m into them, so the shore cells are whole), plus a circle
    round each --around point. Shapely geometry."""
    from pyproj import Transformer
    from shapely.geometry import Point, shape
    from shapely.ops import transform, unary_union

    zone = {r["zone"] for r in query_index()}
    if len(zone) != 1:
        raise SystemExit("the band fetch expects one UTM zone")
    t = Transformer.from_crs("EPSG:4326", f"EPSG:{UTM_EPSG[zone.pop()]}", always_xy=True)
    parts = []
    if args.lake:
        fc = json.loads((OUT_DIR / f"waterbody-{REGION['id']}.geojson").read_text(encoding="utf-8"))
        for name in args.lake:
            polys = [shape(f["geometry"]) for f in fc["features"] if f["properties"].get("OFFICIAL_NAME_LABEL") == name]
            if not polys:
                raise SystemExit(f"no waterbody named {name!r} in waterbody-{REGION['id']}.geojson")
            lake = transform(t.transform, unary_union(polys))
            parts.append(lake.buffer(args.band_m).difference(lake.buffer(-20)))
    for a in args.around or []:
        lat, lon, *rad = (float(v) for v in a.split(","))
        parts.append(Point(*t.transform(lon, lat)).buffer(rad[0] if rad else 300.0))
    if not parts:
        raise SystemExit("--band needs --lake and/or --around")
    return unary_union(parts)


def band_plan(r: dict, area) -> dict:
    """Which COPC nodes of a tile meet the area, and the 10 m cells wholly
    inside it, from the tile's index alone (a few hundred KB read)."""
    import laspy.copc as copc
    from laspy import CopcReader
    from shapely.geometry import box
    from shapely.prepared import prep

    for attempt in range(6):
        try:
            url = signed_url(r["Download_LAZ"])
            rd = CopcReader.open(url, _http_strategy="executor")
            nodes = copc.load_octree_for_query(rd.source, rd.copc_info, rd.root_page, None, None)
            break
        except Exception as e:  # noqa: BLE001
            print(f"  index retry {attempt + 1} for {r['Tilename']} ({str(e)[:60]})", flush=True)
            time.sleep(5 * (attempt + 1))
    else:
        raise SystemExit(f"cannot read the index of {r['Tilename']}")
    here = area.intersection(box(r["x0"], r["y0"], r["x0"] + 1000, r["y0"] + 1000))
    pg = prep(here)
    want = [n for n in nodes if pg.intersects(box(n.bounds.mins[0], n.bounds.mins[1], n.bounds.maxs[0], n.bounds.maxs[1]))]
    cells = np.zeros((100, 100), bool)
    for ri in range(100):
        for ci in range(100):
            x = r["x0"] + ci * 10
            y = r["y0"] + 1000 - (ri + 1) * 10
            cells[ri, ci] = pg.contains(box(x, y, x + 10, y + 10))
    return {"url": url, "reader": rd, "nodes": want, "cells": cells, "bytes": sum(n.byte_size for n in want), "points": sum(n.point_count for n in want)}


def fetch_range(url: str, offset: int, size: int) -> bytes:
    """One byte range, retried; the server's signature can lapse, so the url is re-signed on a 403."""
    for attempt in range(10):
        try:
            rr = requests.get(url, headers={"Range": f"bytes={offset}-{offset + size - 1}"}, timeout=(30, 120))
            if rr.status_code == 206 and len(rr.content) == size:
                return rr.content
            rr.raise_for_status()
            raise RuntimeError(f"status {rr.status_code}, {len(rr.content)} of {size} bytes")
        except Exception as e:  # noqa: BLE001
            print(f"  range retry {attempt + 1} at {offset / 1e6:.0f} MB ({str(e)[:60]})", flush=True)
            time.sleep(3 * (attempt + 1))
    raise SystemExit("gave up on a byte range; rerun to resume")


def fetch_band(r: dict, plan: dict, dest: Path, workers: int) -> int:
    """The planned nodes of a tile into dest, a plain LAZ of the points in the
    planned cells, decompressed a batch at a time so memory stays flat.
    Resumable: each batch's compressed bytes are kept beside dest until the
    tile is done, so a rerun after a drop fetches only what it has not got."""
    import lazrs
    import laspy
    from laspy.point.record import PackedPointRecord, ScaleAwarePointRecord
    from operator import attrgetter

    rd = plan["reader"]
    hdr = laspy.LasHeader(point_format=rd.header.point_format, version=rd.header.version)
    hdr.scales = rd.header.scales
    hdr.offsets = rd.header.offsets
    wkt = rd.header.vlrs.get("WktCoordinateSystemVlr")
    if wkt:
        hdr.vlrs.append(wkt[0])
    # contiguous nodes fetched as one range; ranges batched to ~3 M points
    nodes = sorted(plan["nodes"], key=attrgetter("offset"))
    groups: list[list] = []
    for n in nodes:
        if groups and groups[-1][-1].offset + groups[-1][-1].byte_size == n.offset and sum(m.point_count for m in groups[-1]) < 1_000_000:
            groups[-1].append(n)
        else:
            groups.append([n])
    batches: list[list[list]] = [[]]
    for g in groups:
        if batches[-1] and sum(m.point_count for gg in batches[-1] for m in gg) + sum(m.point_count for m in g) > 3_000_000:
            batches.append([])
        batches[-1].append(g)
    cells = plan["cells"]
    got = 0
    kept = 0
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_name(dest.name + ".part")
    with laspy.open(part, mode="w", header=hdr, do_compress=True) as w:
        for bi, batch in enumerate(batches):
            want = sum(m.byte_size for g in batch for m in g)
            keep_bin = dest.with_name(f"{dest.name}.b{bi}.bin")
            if keep_bin.exists() and keep_bin.stat().st_size == want:
                comp = keep_bin.read_bytes()
            else:
                with ThreadPoolExecutor(workers) as ex:
                    blobs = list(ex.map(lambda g: fetch_range(plan["url"], g[0].offset, sum(m.byte_size for m in g)), batch))
                comp = bytes(bytearray().join(blobs))
                keep_bin.write_bytes(comp)
            table = [(m.point_count, m.byte_size) for g in batch for m in g]
            npts = sum(c for c, _ in table)
            arr = np.zeros(npts * rd.header.point_format.size, np.uint8)
            lazrs.decompress_points_with_chunk_table(comp, rd.laszip_vlr.record_data, arr, table, rd.decompression_selection)
            rec = PackedPointRecord.from_buffer(arr, rd.header.point_format)
            pts = ScaleAwarePointRecord(rec.array, rec.point_format, rd.header.scales, rd.header.offsets)
            ci = np.clip(((np.asarray(pts.x) - r["x0"]) // 10).astype(np.int64), 0, 99)
            ri = np.clip(((r["y0"] + 1000 - np.asarray(pts.y)) // 10).astype(np.int64), 0, 99)
            keep = cells[ri, ci]
            if keep.any():
                w.write_points(pts[keep])
            got += len(comp)
            kept += int(keep.sum())
            print(f"  {dest.name}: batch {bi + 1}/{len(batches)} · {got / 1e6:.0f} of {plan['bytes'] / 1e6:.0f} MB · {kept / 1e6:.1f} M points kept", flush=True)
    part.replace(dest)
    for bi in range(len(batches)):
        dest.with_name(f"{dest.name}.b{bi}.bin").unlink(missing_ok=True)
    dest.with_suffix(".json").write_text(json.dumps({"tile": r["Tilename"], "bytes": got, "points": kept, "cells": int(cells.sum())}))
    return got


def main_band(args, rows: list[dict]) -> None:
    from shapely.geometry import box

    area = band_area(args)
    sel = [r for r in rows if box(r["x0"], r["y0"], r["x0"] + 1000, r["y0"] + 1000).intersects(area)]
    todo = []
    for r in sel:
        whole = LAZ_DIR / f"{r['Tilename']}.copc.laz"
        band = LAZ_DIR / f"{r['Tilename']}{BAND_SUFFIX}"
        if whole.exists() and "laz_bytes" in r and whole.stat().st_size == r["laz_bytes"]:
            continue
        if band.exists() and not args.redo:
            print(f"  {r['Tilename']} has a band already (--redo to fetch it again)")
            continue
        todo.append(r)
    print(f"{len(sel)} tiles meet the area, {len(sel) - len(todo)} on disk, {len(todo)} to fetch in part")
    if not todo:
        return
    ensure_sizes(rows, todo)
    print(f"reading {len(todo)} tile indexes (about {len(todo) * BAND_HEADER_KB / 1000:.1f} MB) …")
    plans = {r["Tilename"]: band_plan(r, area) for r in todo}
    total = sum(p["bytes"] for p in plans.values()) + sum(r["dem_bytes"] for r in todo)
    for r in todo:
        p = plans[r["Tilename"]]
        print(f"  {r['Tilename']}  {r['x0'] // 1000}/{r['y0'] // 1000}  {p['bytes'] / 1e6:5.0f} MB of {r['laz_bytes'] / 1e6:.0f} · {p['cells'].sum()} cells · DEM {r['dem_bytes'] / 1e6:.0f} MB")
    print(f"to fetch: {total / 1e6:.0f} MB (points {sum(p['bytes'] for p in plans.values()) / 1e6:.0f} MB, DEMs {sum(r['dem_bytes'] for r in todo) / 1e6:.0f} MB)")
    if args.list:
        return
    if total / 1e9 > args.max_gb:
        raise SystemExit(f"{total / 1e9:.2f} GB is over --max-gb {args.max_gb}")
    t0 = time.time()
    got = 0
    for r in todo:
        download(r["Download_DEM"], DEM_DIR / f"{r['Tilename']}_DEM.tif", r["dem_bytes"])
        got += fetch_band(r, plans[r["Tilename"]], LAZ_DIR / f"{r['Tilename']}{BAND_SUFFIX}", args.workers)
        print(f"  {r['Tilename']} done · {got / 1e6:.0f} MB so far · {time.time() - t0:.0f} s", flush=True)
    print(f"done: {got / 1e6:.0f} MB of points in {time.time() - t0:.0f} s")


def select(rows: list[dict], args) -> list[dict]:
    by_name = {r["Tilename"]: r for r in rows}
    if args.all:
        chosen = set(by_name)
    elif args.radius_km is not None:
        from pyproj import Transformer

        lon, lat = HOME
        centre = {z: Transformer.from_crs("EPSG:4326", f"EPSG:{UTM_EPSG[z]}", always_xy=True).transform(lon, lat) for z in {r["zone"] for r in rows}}
        chosen = set()
        for r in rows:
            cx, cy = centre[r["zone"]]
            dx = max(r["x0"] - cx, 0, cx - (r["x0"] + 1000))
            dy = max(r["y0"] - cy, 0, cy - (r["y0"] + 1000))
            if math.hypot(dx, dy) < args.radius_km * 1000:
                chosen.add(r["Tilename"])
    else:
        chosen = set()
    for t in args.tile or []:
        if t in by_name:
            chosen.add(t)
            continue
        m = re.match(r"^(\d{3})/(\d{4})$", t)  # "598/5417": SW corner in km
        hits = [r["Tilename"] for r in rows if m and r["x0"] == int(m.group(1)) * 1000 and r["y0"] == int(m.group(2)) * 1000]
        if not hits:
            raise SystemExit(f"no tile {t} in the index")
        chosen.update(hits)
    if not chosen:
        raise SystemExit("nothing selected: pass --all, --radius-km or --tile (see the docstring)")
    return [by_name[n] for n in sorted(chosen)]


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--all", action="store_true", help="every tile in the core")
    ap.add_argument("--radius-km", type=float, help="tiles within this distance of the area's centre")
    ap.add_argument("--tile", action="append", help="Tilename or 'EEE/NNNN' (SW corner, km); repeatable")
    ap.add_argument("--max-gb", type=float, default=15.0, help="refuse a selection bigger than this")
    ap.add_argument("--list", action="store_true", help="print sizes, download nothing")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--band", action="store_true", help="fetch only the ground named by --lake / --around, from tiles not on disk whole")
    ap.add_argument("--lake", action="append", help="--band: OFFICIAL_NAME_LABEL of a waterbody in waterbody-<region>.geojson; repeatable")
    ap.add_argument("--band-m", type=float, default=150.0, help="--band: how far from the lake the shore band reaches, m")
    ap.add_argument("--around", action="append", help="--band: 'lat,lon[,radius_m]' for a circle of ground (300 m by default); repeatable")
    ap.add_argument("--redo", action="store_true", help="--band: fetch a tile's band again even if one is on disk")
    args = ap.parse_args(argv)
    if adapter(BAKE, "pointcloud") != "on.fri_leafon":
        # the index cache is named by area: an empty Ontario one would hide the area's own
        raise SystemExit(f"{REGION['name']}'s point cloud is not Ontario FRI leaf-on ({adapter(BAKE, 'pointcloud')}): bake it with bake_area.py")

    rows = query_index()
    if args.band:
        return main_band(args, rows)
    sel = select(rows, args)
    ensure_sizes(rows, sel)
    core_gb = sum(r.get("laz_bytes", 0) for r in rows) / 1e9
    total = sum(r["laz_bytes"] + r["dem_bytes"] for r in sel)
    have = sum(
        r["laz_bytes"] for r in sel if (LAZ_DIR / f"{r['Tilename']}.copc.laz").exists() and (LAZ_DIR / f"{r['Tilename']}.copc.laz").stat().st_size == r["laz_bytes"]
    )
    print(f"selected {len(sel)} of {len(rows)} core tiles: {total / 1e9:.2f} GB ({have / 1e9:.2f} GB already here)")
    if all("laz_bytes" in r for r in rows):
        print(f"  (the whole core would be {core_gb:.2f} GB)")
    if args.list:
        for r in sel:
            print(f"  {r['Tilename']}  {r['x0'] // 1000}/{r['y0'] // 1000}  {r['laz_bytes'] / 1e6:6.0f} MB")
        return
    if total / 1e9 > args.max_gb:
        raise SystemExit(f"{total / 1e9:.1f} GB is over --max-gb {args.max_gb}; narrow the selection or raise the cap")

    t0 = time.time()
    jobs = []
    for r in sel:
        jobs.append((r["Download_DEM"], DEM_DIR / f"{r['Tilename']}_DEM.tif", r["dem_bytes"]))
        jobs.append((r["Download_LAZ"], LAZ_DIR / f"{r['Tilename']}.copc.laz", r["laz_bytes"]))
    done = 0
    got = 0
    with ThreadPoolExecutor(args.workers) as ex:
        futs = {ex.submit(download, *j): j for j in jobs}
        for f in as_completed(futs):
            url, dest, size = futs[f]
            status = f.result()
            done += 1
            if status == "got":
                got += size
            if dest.suffix == ".laz" or done == len(jobs):
                rate = got / 1e6 / max(time.time() - t0, 1e-6)
                print(f"  {done}/{len(jobs)} files · {dest.name} {status} · {got / 1e9:.2f} GB new · {rate:.0f} MB/s", flush=True)
    print(f"done in {time.time() - t0:.0f} s")


if __name__ == "__main__":
    sys.exit(main())
