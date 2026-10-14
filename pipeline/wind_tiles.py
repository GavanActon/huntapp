"""SD wind tiles: the ground wind on the national lattice, baked once, for
anyone (docs/SD-FAST.md, "SD wind for anyone"; Gavan, 2026-10-13: "SD wind
then becomes something anyone can have right away").

Each tile is tiles.py's 11 km cell of the habitat lattice. It is baked by the
fast pass (sd_wind.py: habitat_lite, the wide MRDEM, the net, micro) as a
small area of its own, the tile plus WIND_MARGIN cells each way so the net,
the drainage and the lakes see the ground around it, then cut back to the
tile. The tiles line up cell for cell, so the app stitches any block of them
into one grid.

    py -3.14 pipeline/wind_tiles.py plan --box -85.8 47.95 -84.3 48.95
    py -3.14 pipeline/wind_tiles.py bake --box -85.8 47.95 -84.3 48.95 [--jobs 2] [--keep]
    py -3.14 pipeline/wind_tiles.py seams --box ...
    py -3.14 pipeline/wind_tiles.py index

Outputs: pipeline/raw/windtiles/out/<tile>.hab (the app's micro grid form,
with its preview bands), out/<tile>.json (times, sizes), and out/index.json.
The tile's own working folder (with its margin) is kept under work/<tile>/
for the seams check unless the bake is told otherwise; the big caches (the
net's raw field, the windows) are cleared as each tile finishes.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))
import habfile  # noqa: E402
import tiles as lattice  # noqa: E402

BASE = HERE / "raw" / "windtiles"
AREAS, WORK, OUT = BASE / "areas", BASE / "work", BASE / "out"
CACHE = HERE / "raw"
WIND_MARGIN = 150  # cells each way: about 4.4 km east-west, 4 km north-south at 49 N
VERSION = "v1"


def area_file(i: int, j: int) -> dict:
    tid = lattice.tile_id(i, j)
    t = lattice.tile_box(i, j)
    region = lattice.tile_box(i, j, WIND_MARGIN)
    n = lattice.NUDGE
    centre = [round((t["west"] + t["east"]) / 2, 6), round((t["south"] + t["north"]) / 2, 6)]
    return {
        "id": tid,
        "name": f"Wind tile {i}/{j}",
        "jurisdiction": "ON",
        "centre": centre,
        "home": {"center": centre, "zoom": 12},
        "region": region,
        "core": {"west": t["west"] + n, "south": t["south"] + n, "east": t["east"] - n, "north": t["north"] - n, "maxzoom": 13},
        "regionMaxzoom": 13,
        "declination": None,
        "timezone": "America/Toronto",
        "zone": {"label": "WMU", "name": None},
        "relief": None,
        "base": "",
        "live": {"lio": False},
        "presets": [],
        "files": {"pmtiles": [], "geo": [], "grids": ["micro"]},
        "bake": {"outDir": str((WORK / tid).relative_to(ROOT)).replace("\\", "/"), "lidar": "none", "pointcloud": None, "wind": "sd", "sdRun": "all",
                 "forest": {"adapter": "ca.scanfi", "vintage": "SCANFI 2025; CanLaD 1985-2025"}, "vectors": None, "imagery": None, "hrdem": [], "nts": []},
    }


def cut(tid: str) -> dict:
    """The tile's micro grid with its margin, cut back to the tile, its preview made again."""
    src = WORK / tid / f"micro-{tid}.hab"
    h, raw = habfile.read_hab_raw(src)
    keep = [b for b in h["bands"] if not b["name"].startswith(habfile.PREVIEW_PREFIX)]
    m, R, C = WIND_MARGIN, lattice.TILE_ROWS, lattice.TILE_COLS
    bands = [(b["name"], raw[b["name"]][m : m + R, m : m + C], b["scale"], b.get("meaning", "")) for b in keep]
    header = {k: v for k, v in h.items() if k not in ("bands", "codec", "first", "preview", "previewEnd")}
    header |= {"region": tid, "cols": C, "rows": R, "west": round(h["west"] + m * h["dLon"], 9), "north": round(h["north"] - m * h["dLat"], 9),
               "tile": {"lattice": [lattice.LON0, lattice.LAT0, lattice.D_LON, lattice.D_LAT, C, R], "margin": m, "version": VERSION}}
    late = [b[0] for b in bands if b[0][:2] in ("mU", "mV", "mT")]
    header, bands, early = habfile.with_preview(header, bands, skip=late)
    out = OUT / f"{tid}.hab"
    w = habfile.write_hab(out, header, bands, late=late, early=early)
    return {"bytes": w["size"], "bands": w["bands"]}


def clean(tid: str) -> None:
    """The per-tile caches the fast pass leaves in pipeline/raw: the net's raw field alone is 70 MB."""
    for name in (f"windsd-{tid}.npz", f"mrdem-{tid}.npz", f"mrdem-wide-{tid}.npz", f"landcover-{tid}.npz", f"habitat-lite-{tid}.hab", f"micro-debug-{tid}.npz", f"provenance-{tid}.json"):
        (CACHE / name).unlink(missing_ok=True)
    shutil.rmtree(CACHE / "ca" / tid, ignore_errors=True)
    for p in (WORK / tid).glob("micro-debug-*.npz"):
        p.unlink()


def bake_one(i: int, j: int, keep: bool) -> dict:
    tid = lattice.tile_id(i, j)
    done = OUT / f"{tid}.json"
    if done.exists():
        return json.loads(done.read_text())
    AREAS.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    (WORK / tid).mkdir(parents=True, exist_ok=True)
    clean(tid)  # windows cached by an earlier bake of this tile (tiles.py's, a narrower margin) would be refused
    (AREAS / f"{tid}.json").write_text(json.dumps(area_file(i, j), indent=1), encoding="utf-8")
    env = os.environ | {"HUNTAPP_AREAS_DIR": str(AREAS), "HUNTAPP_OUT": str(WORK / tid), "PYTHONIOENCODING": "utf-8", "PYTHONUNBUFFERED": "1"}
    env.pop("HUNTAPP_AREA", None)
    t = time.time()
    log = WORK / tid / "bake.log"
    with open(log, "w", encoding="utf-8") as f:
        rc = subprocess.call([sys.executable, str(HERE / "sd_wind.py"), "--area", tid], cwd=ROOT, env=env, stdout=f, stderr=subprocess.STDOUT)
    if rc:
        clean(tid)
        tail = log.read_text(encoding="utf-8", errors="replace").splitlines()[-3:]
        return {"tile": tid, "error": f"sd_wind exited {rc}: {' | '.join(tail)}"}
    steps = json.loads((WORK / tid / "sd-wind.json").read_text())["seconds"]
    info = {"tile": tid, "seconds": round(time.time() - t, 1), "steps": steps, **cut(tid)}
    clean(tid)
    if not keep:
        shutil.rmtree(WORK / tid, ignore_errors=True)
    OUT.mkdir(parents=True, exist_ok=True)
    done.write_text(json.dumps(info), encoding="utf-8")
    return info


def index() -> dict:
    OUT.mkdir(parents=True, exist_ok=True)
    tiles = sorted((json.loads(p.read_text()) for p in OUT.glob("t-*.json")), key=lambda t: t["tile"])
    good = [t for t in tiles if "error" not in t]
    idx = {"version": VERSION, "lattice": {"lon0": lattice.LON0, "lat0": lattice.LAT0, "dLon": lattice.D_LON, "dLat": lattice.D_LAT,
                                            "cols": lattice.TILE_COLS, "rows": lattice.TILE_ROWS},
           "tiles": {t["tile"]: t["bytes"] for t in good}}
    (OUT / "index.json").write_text(json.dumps(idx), encoding="utf-8")
    return idx


def seams(ids: list[str]) -> list[dict]:
    """Where a tile's margin overlaps its neighbour's own cells: how far the
    tile's answer at its edge drifts from the neighbour's (the truth there)."""
    import numpy as np

    have = {lattice.parse_id(t): t for t in ids}
    rows = []
    m, R, C = WIND_MARGIN, lattice.TILE_ROWS, lattice.TILE_COLS
    for (i, j), tid in sorted(have.items()):
        for di, dj, side in ((1, 0, "east"), (0, 1, "south")):
            nb = have.get((i + di, j + dj))
            wa_path = WORK / tid / f"micro-{tid}.hab"
            if not nb or not wa_path.exists():
                continue
            _, wa = habfile.read_hab(wa_path)
            _, na = habfile.read_hab(OUT / f"{nb}.hab")
            for name in ("mU270.0", "mV270.0", "nUe", "sUe", "pool", "katSpd", "onshore", "canopy"):
                if name not in wa or name not in na:
                    continue
                a, b = wa[name].astype(float), na[name].astype(float)
                if side == "east":
                    edge_a, edge_b = a[m : m + R, m + C : m + C + 3], b[:, :3]
                else:
                    edge_a, edge_b = a[m + R : m + R + 3, m : m + C], b[:3, :]
                d = np.abs(edge_a - edge_b)
                rows.append({"pair": f"{tid}|{nb}", "band": name, "medAbs": round(float(np.median(d)), 4), "p95Abs": round(float(np.percentile(d, 95)), 4),
                             "spread": round(float(np.std(b)), 4)})
    return rows


def upload() -> tuple[int, int]:
    """The tiles and their index to R2, data/sd/<version>/ (the app's DATA_BASE + sd/<version>/),
    each tile only when R2 does not already hold the same bytes; the index last."""
    import hashlib

    sys.path.insert(0, str(ROOT / "app" / "scripts"))
    import r2_sync  # noqa: E402  (its R2 client and keys)

    s3 = r2_sync.client()
    prefix = f"data/sd/{VERSION}/"
    have = {}
    for page in s3.get_paginator("list_objects_v2").paginate(Bucket=r2_sync.BUCKET, Prefix=prefix):
        for o in page.get("Contents", []):
            have[o["Key"]] = o["ETag"].strip('"')
    sent = skipped = 0
    for p in sorted(OUT.glob("t-*.hab")):
        key = prefix + p.name
        body = p.read_bytes()
        if have.get(key) == hashlib.md5(body).hexdigest():
            skipped += 1
            continue
        s3.put_object(Bucket=r2_sync.BUCKET, Key=key, Body=body, ContentType="application/octet-stream", CacheControl="public, max-age=86400")
        sent += 1
    s3.put_object(Bucket=r2_sync.BUCKET, Key=prefix + "index.json", Body=(OUT / "index.json").read_bytes(), ContentType="application/json", CacheControl="no-cache")
    return sent, skipped


def queue_bake(path: Path, jobs: int, upload_every: int) -> None:
    """Tiles from a queue file (hunt_priority.py: one id a line, best first), read again
    before every tile, so the order can be changed while it runs; resumable (a tile done
    is skipped), the tiles sent to R2 every `upload_every`, and once more at the end."""
    import threading

    lock = threading.Lock()
    taken: set[str] = set()
    done_n = [0]
    t0 = time.time()

    def next_tile() -> str | None:
        with lock:
            for line in path.read_text(encoding="utf-8").splitlines():
                tid = line.split("\t")[0].strip()
                if tid and tid not in taken and not (OUT / f"{tid}.json").exists():
                    taken.add(tid)
                    return tid
        return None

    def worker() -> None:
        while (tid := next_tile()) is not None:
            try:
                info = bake_one(*lattice.parse_id(tid), False)
            except Exception as e:  # noqa: BLE001  one tile's trouble never stops the night
                info = {"tile": tid, "error": f"{type(e).__name__}: {e}"}
            with lock:
                done_n[0] += 1
                n = done_n[0]
                print(f"[{n}] {tid}: {info.get('error') or f'{info['seconds']} s, {info['bytes'] / 1e6:.1f} MB'} · {time.time() - t0:.0f} s in all", flush=True)
                if upload_every and n % upload_every == 0:
                    try:
                        index()
                        sent, _ = upload()
                        print(f"  uploaded {sent} to R2", flush=True)
                    except Exception as e:  # noqa: BLE001  a failed upload waits for the next one
                        print(f"  upload failed: {e}", flush=True)

    threads = [threading.Thread(target=worker) for _ in range(jobs)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    index()
    sent, _ = upload()
    print(f"queue empty: {done_n[0]} tiles this run, {sent} sent at the end, {time.time() - t0:.0f} s")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("cmd", choices=["plan", "bake", "seams", "index", "upload"])
    ap.add_argument("--box", nargs=4, type=float, metavar=("W", "S", "E", "N"))
    ap.add_argument("--jobs", type=int, default=2)
    ap.add_argument("--keep", action="store_true", help="keep each tile's working folder (with its margin) for the seams check")
    ap.add_argument("--queue", help="bake the tiles of this file in order (hunt_priority.py), read again before each tile")
    ap.add_argument("--upload-every", type=int, default=50)
    a = ap.parse_args()
    cells = lattice.tiles_in(tuple(a.box)) if a.box else []
    if a.cmd == "plan":
        print(f"{len(cells)} tiles: {lattice.tile_id(*cells[0])} .. {lattice.tile_id(*cells[-1])}")
        return 0
    if a.cmd == "index":
        idx = index()
        print(f"{len(idx['tiles'])} tiles, {sum(idx['tiles'].values()) / 1e6:.0f} MB")
        return 0
    if a.cmd == "upload":
        idx = index()
        sent, skipped = upload()
        print(f"R2 data/sd/{VERSION}/: {sent} tiles sent, {skipped} already there, index of {len(idx['tiles'])}")
        return 0
    if a.cmd == "seams":
        import numpy as np

        rows = seams([lattice.tile_id(*c) for c in cells])
        (OUT / "seams.json").write_text(json.dumps(rows, indent=0), encoding="utf-8")
        for band in sorted({r["band"] for r in rows}):
            rs = [r for r in rows if r["band"] == band]
            print(f"{band:9s} {len(rs)} seams · edge drift median {np.median([r['medAbs'] for r in rs]):.4f} · p95 {np.median([r['p95Abs'] for r in rs]):.4f} · spread {np.median([r['spread'] for r in rs]):.4f}")
        return 0
    if a.cmd == "bake" and a.queue:
        queue_bake(Path(a.queue), a.jobs, a.upload_every)
        return 0
    t0 = time.time()
    n = len(cells)
    with ThreadPoolExecutor(a.jobs) as ex:
        for k, info in enumerate(ex.map(lambda c: bake_one(*c, a.keep), cells), start=1):
            print(f"[{k}/{n}] {info['tile']}: {info.get('error') or f'{info['seconds']} s, {info['bytes'] / 1e6:.1f} MB'} · {time.time() - t0:.0f} s in all", flush=True)
    idx = index()
    print(f"done: {len(idx['tiles'])} tiles, {sum(idx['tiles'].values()) / 1e6:.0f} MB, {time.time() - t0:.0f} s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
