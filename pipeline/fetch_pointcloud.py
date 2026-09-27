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
is no cheap partial read: a tile is fetched whole or not at all. Hence the
selection options and the --max-gb guard.

Reading the index needs GDAL (pyogrio), which on this machine is only in
Python 3.13; the result is cached, so later runs need only the stdlib and
requests:

    py -3.13 pipeline/fetch_pointcloud.py --list              # sizes only
    py -3.13 pipeline/fetch_pointcloud.py --radius-km 2       # tiles within 2 km of HOME
    py -3.13 pipeline/fetch_pointcloud.py --tile 598/5417     # add a tile (km E / km N)
    py -3.13 pipeline/fetch_pointcloud.py --all --max-gb 30   # the whole core

Output: pipeline/raw/pointcloud/laz/*.copc.laz, pipeline/raw/pointcloud/dem/*_DEM.tif,
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

import requests

from common import APP, CACHE_DIR, CORE, REGION

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


def home() -> tuple[float, float]:
    """HOME.center (lon, lat) out of config.ts."""
    src = (APP / "src" / "config.ts").read_text(encoding="utf-8")
    m = re.search(r"export const HOME = \{.*?center:\s*\[\s*(-?[\d.]+),\s*(-?[\d.]+)\s*\]", src, re.S)
    if not m:
        raise SystemExit("HOME.center not found in app/src/config.ts")
    return float(m.group(1)), float(m.group(2))


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


def select(rows: list[dict], args) -> list[dict]:
    by_name = {r["Tilename"]: r for r in rows}
    if args.all:
        chosen = set(by_name)
    elif args.radius_km is not None:
        from pyproj import Transformer

        lon, lat = home()
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
    ap.add_argument("--radius-km", type=float, help="tiles within this distance of HOME")
    ap.add_argument("--tile", action="append", help="Tilename or 'EEE/NNNN' (SW corner, km); repeatable")
    ap.add_argument("--max-gb", type=float, default=15.0, help="refuse a selection bigger than this")
    ap.add_argument("--list", action="store_true", help="print sizes, download nothing")
    ap.add_argument("--workers", type=int, default=4)
    args = ap.parse_args(argv)

    rows = query_index()
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
