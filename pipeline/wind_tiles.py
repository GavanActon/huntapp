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
# the surrogate run a tile's wind comes from (pipeline/raw/surrogate/runs/<run>); --run for a trial
SD_RUN = "all"
# the province's own wetlands in habitat-lite (habitat_lite.wetland_grid); --wetlands for a trial
WETLANDS = False


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
        "bake": {"outDir": str((WORK / tid).relative_to(ROOT)).replace("\\", "/"), "lidar": "none", "pointcloud": None, "wind": "sd", "sdRun": SD_RUN, "wetlands": WETLANDS,
                 "forest": {"adapter": "ca.scanfi", "vintage": "SCANFI 2025; CanLaD 1985-2025"}, "vectors": None, "imagery": None, "hrdem": [], "nts": []},
    }


# the stand the towers' floor rule and the scent's closure read off the grid (model.ts standBands,
# 2026-10-16, Gavan "Go yes"): % as uint8, 255 no data, under the habitat grid's own names
STAND = ("crown", "conifer", "hardwood")


def stand_bands(tid: str) -> list:
    """habitat-lite's stand bands cut to the tile, 255 where the land cover has no ground at all
    (outside Canada, where SCANFI's 0 is no data, not open). [] when the tile's habitat-lite is gone."""
    import numpy as np

    src = CACHE / f"habitat-lite-{tid}.hab"
    if not src.exists():
        return []
    h, raw = habfile.read_hab_raw(src)
    m, R, C = WIND_MARGIN, lattice.TILE_ROWS, lattice.TILE_COLS
    meaning = {b["name"]: b.get("meaning", "") for b in h["bands"]}
    gone = raw["landcover"][m : m + R, m : m + C] == 0 if "landcover" in raw else None
    out = []
    for name in STAND:
        a = raw[name][m : m + R, m : m + C].astype(np.uint8)
        if gone is not None:
            a = np.where(gone, 255, a).astype(np.uint8)
        out.append((name, a, 1, f"{meaning.get(name, name)}; 255 no data"))
    return out


def pack(tid: str, h: dict, bands: list, margin: int) -> dict:
    """Bands written as out/<tid>.hab, the preview made again; `h` the header they came with, its
    corner moved in by `margin` cells (the micro grid's margin, or 0 for a tile already cut)."""
    C, R = lattice.TILE_COLS, lattice.TILE_ROWS
    header = {k: v for k, v in h.items() if k not in ("bands", "codec", "first", "preview", "previewEnd")}
    header |= {"region": tid, "cols": C, "rows": R, "west": round(h["west"] + margin * h["dLon"], 9), "north": round(h["north"] - margin * h["dLat"], 9),
               "tile": {"lattice": [lattice.LON0, lattice.LAT0, lattice.D_LON, lattice.D_LAT, C, R], "margin": WIND_MARGIN, "version": VERSION}}
    late = [b[0] for b in bands if b[0][:2] in ("mU", "mV", "mT")]
    # the stand stays out of the preview: the tiles' mosaic reads only the full bands
    header, bands, early = habfile.with_preview(header, bands, skip=late + list(STAND))
    w = habfile.write_hab(OUT / f"{tid}.hab", header, bands, late=late, early=early)
    return {"bytes": w["size"], "bands": w["bands"], "stand": any(b[0] == "crown" for b in bands)}


def cut(tid: str) -> dict:
    """The tile's micro grid with its margin, cut back to the tile, with habitat-lite's stand."""
    src = WORK / tid / f"micro-{tid}.hab"
    h, raw = habfile.read_hab_raw(src)
    keep = [b for b in h["bands"] if not b["name"].startswith(habfile.PREVIEW_PREFIX)]
    m, R, C = WIND_MARGIN, lattice.TILE_ROWS, lattice.TILE_COLS
    bands = [(b["name"], raw[b["name"]][m : m + R, m : m + C], b["scale"], b.get("meaning", "")) for b in keep]
    return pack(tid, h, bands + stand_bands(tid), m)


def stand_one(tid: str) -> dict:
    """A tile baked before it carried its stand: habitat-lite run again for it (CPU, a few
    seconds) and its three bands added. A tile this machine lacks comes from R2 (the S3 API, not
    the public host, whose edge may hold an older copy)."""
    out = OUT / f"{tid}.hab"
    if not out.exists():
        sys.path.insert(0, str(ROOT / "app" / "scripts"))
        import r2_sync  # noqa: E402

        OUT.mkdir(parents=True, exist_ok=True)
        body = r2_sync.client().get_object(Bucket=r2_sync.BUCKET, Key=f"data/sd/{VERSION}/{tid}.hab")["Body"].read()
        out.write_bytes(body)
    h, raw = habfile.read_hab_raw(out)
    if "crown" in raw:
        return {"tile": tid, "skipped": "has its stand"}
    i, j = lattice.parse_id(tid)
    AREAS.mkdir(parents=True, exist_ok=True)
    (WORK / tid).mkdir(parents=True, exist_ok=True)
    (AREAS / f"{tid}.json").write_text(json.dumps(area_file(i, j), indent=1), encoding="utf-8")
    env = os.environ | {"HUNTAPP_AREAS_DIR": str(AREAS), "HUNTAPP_OUT": str(WORK / tid), "PYTHONIOENCODING": "utf-8", "PYTHONUNBUFFERED": "1"}
    env.pop("HUNTAPP_AREA", None)
    t = time.time()
    log = WORK / tid / "stand.log"
    with open(log, "w", encoding="utf-8") as f:
        rc = subprocess.call([sys.executable, str(HERE / "habitat_lite.py"), "--area", tid], cwd=ROOT, env=env, stdout=f, stderr=subprocess.STDOUT)
    if rc:
        clean(tid)
        tail = log.read_text(encoding="utf-8", errors="replace").splitlines()[-3:]
        return {"tile": tid, "error": f"habitat_lite exited {rc}: {' | '.join(tail)}"}
    keep = [b for b in h["bands"] if not b["name"].startswith(habfile.PREVIEW_PREFIX)]
    bands = [(b["name"], raw[b["name"]], b["scale"], b.get("meaning", "")) for b in keep]
    info = pack(tid, h, bands + stand_bands(tid), 0)
    clean(tid)
    shutil.rmtree(WORK / tid, ignore_errors=True)
    done = OUT / f"{tid}.json"
    rec = json.loads(done.read_text()) if done.exists() else {"tile": tid, "from": "r2"}
    rec |= {"bytes": info["bytes"], "bands": info["bands"], "stand": info["stand"], "standSeconds": round(time.time() - t, 1)}
    done.write_text(json.dumps(rec), encoding="utf-8")
    return rec


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

    if h := r2_sync.held():
        print(f"  uploads held ({h}): the tiles stay in {OUT}", flush=True)
        return 0, 0
    s3 = r2_sync.client()
    prefix = f"data/sd/{VERSION}/"
    have, sizes, when = {}, {}, {}
    for page in s3.get_paginator("list_objects_v2").paginate(Bucket=r2_sync.BUCKET, Prefix=prefix):
        for o in page.get("Contents", []):
            have[o["Key"]] = o["ETag"].strip('"')
            sizes[o["Key"]] = o["Size"]
            when[o["Key"]] = o["LastModified"].timestamp()
    # a tile R2 holds from the other machine stays: both baked ~3,000 of the same tiles while apart
    # (2026-10-19 to 22) and each upload put its own bytes back over the other's, 1,565 at once on
    # 2026-10-23. Only a tile baked here after R2's copy replaces it (a deliberate re-bake).
    def theirs(key: str, mtime: float) -> bool:
        return key in when and when[key] >= mtime
    sent = skipped = 0
    # what was compared before (name: size, mtime, md5), so a tile unchanged since and still the
    # same on R2 isn't read and hashed again: every upload read every tile, 180 GB in a day by
    # 2026-10-16. A lost entry (two processes writing it) only costs one hash.
    seen_path = OUT / "sent.json"
    try:
        seen = json.loads(seen_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        seen = {}
    for p in sorted(OUT.glob("t-*.hab")):
        key = prefix + p.name
        st = p.stat()
        rec = seen.get(p.name)
        if rec and rec[0] == st.st_size and rec[1] == st.st_mtime_ns and (have.get(key) == rec[2] or theirs(key, st.st_mtime)):
            skipped += 1
            continue
        body = p.read_bytes()
        md5 = hashlib.md5(body).hexdigest()
        if have.get(key) != md5 and not theirs(key, st.st_mtime):
            s3.put_object(Bucket=r2_sync.BUCKET, Key=key, Body=body, ContentType="application/octet-stream", CacheControl="public, max-age=86400")
            sent += 1
        else:
            skipped += 1
        seen[p.name] = [st.st_size, st.st_mtime_ns, md5]
    tmp = seen_path.with_suffix(f".{os.getpid()}.tmp")
    tmp.write_text(json.dumps(seen), encoding="utf-8")
    os.replace(tmp, seen_path)
    # the index names every tile on R2, not just this machine's: with two machines baking
    # (2026-10-15, xonix beside XEVO) one's index would otherwise drop the other's tiles
    idx = json.loads((OUT / "index.json").read_text(encoding="utf-8"))
    for k, size in sizes.items():
        name = k[len(prefix):]
        if name.startswith("t-") and name.endswith(".hab"):
            idx["tiles"].setdefault(name[:-4], size)
    idx["tiles"] = dict(sorted(idx["tiles"].items()))
    (OUT / "index.json").write_text(json.dumps(idx), encoding="utf-8")
    s3.put_object(Bucket=r2_sync.BUCKET, Key=prefix + "index.json", Body=json.dumps(idx).encode(), ContentType="application/json", CacheControl="no-cache")
    return sent, skipped


def r2_tiles() -> set[str]:
    """The tiles R2's index names: every machine's, as each upload merges them."""
    import urllib.request

    sys.path.insert(0, str(ROOT / "app" / "scripts"))
    import r2_sync  # noqa: E402  (the public host)

    # a named agent: the host turns away Python's default one (403)
    req = urllib.request.Request(f"{r2_sync.PUBLIC}data/sd/{VERSION}/index.json?t={time.time():.0f}", headers={"User-Agent": "groundwind-wind-tiles"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return set(json.loads(r.read())["tiles"])


def batches(queue: Path, size: int, dest: Path, reverse: bool = False, stands: bool = False) -> tuple[int, int]:
    """The queue cut into files of `size` tiles that neither R2 nor this machine has yet, in the
    queue's order, or from its end with `reverse`: each a job any machine can take (`bake --queue
    <batch file>`; 2026-10-15, the job system for xonix and XEVO). A second machine takes batches
    from the end while the first bakes the queue from the front, as WindNinja's -Reverse runners
    do; where they meet, each skips what the other has sent (queue_bake reads R2's index).
    Returns (batches, tiles)."""
    done = r2_tiles() | {p.stem for p in OUT.glob("t-*.json") if "error" not in json.loads(p.read_text())}
    queued = [ln for ln in queue.read_text(encoding="utf-8").splitlines() if ln.strip()]
    if stands:
        # the stand backfill (2026-10-16): the tiles baked so far, in the queue's order and then
        # any it doesn't name (the pilot), less those this machine knows carry their stand
        has = {p.stem for p in OUT.glob("t-*.json") if json.loads(p.read_text()).get("stand")}
        named = {ln.split("\t")[0].strip() for ln in queued}
        lines = [ln for ln in queued if ln.split("\t")[0].strip() in done - has] + sorted(done - has - named)
    else:
        lines = [ln for ln in queued if ln.split("\t")[0].strip() not in done]
    if reverse:
        lines.reverse()
    dest.mkdir(parents=True, exist_ok=True)
    for old in dest.glob("batch-*.txt"):
        old.unlink()
    n = 0
    for k in range(0, len(lines), size):
        n += 1
        (dest / f"batch-{n:04d}.txt").write_text("\n".join(lines[k : k + size]) + "\n", encoding="utf-8")
    return n, len(lines)


def stands_run(path: Path, jobs: int, upload_every: int) -> None:
    """The stand bands added to the tiles a file names (one id a line: `batches --stands` cuts
    them), `jobs` at a time, sent to R2 every `upload_every` and at the end. A tile that has its
    stand is skipped, so a file can be run again for the ones that failed; PAUSE beside it waits."""
    import threading

    ids = [ln.split("\t")[0].strip() for ln in path.read_text(encoding="utf-8").splitlines() if ln.strip()]
    lock = threading.Lock()
    todo = iter(ids)
    n = [0]
    t0 = time.time()
    pause = path.parent / "PAUSE"

    def send() -> None:
        try:
            index()
            print(f"  uploaded {upload()[0]} to R2", flush=True)
        except Exception as e:  # noqa: BLE001  a failed upload waits for the next one
            print(f"  upload failed: {e}", flush=True)

    def worker() -> None:
        while True:
            while pause.exists():
                time.sleep(15)
            with lock:
                tid = next(todo, None)
            if tid is None:
                return
            try:
                info = stand_one(tid)
            except Exception as e:  # noqa: BLE001  one tile's trouble never stops the rest
                info = {"tile": tid, "error": f"{type(e).__name__}: {e}"}
            with lock:
                n[0] += 1
                said = info.get("error") or info.get("skipped") or f"{info.get('standSeconds')} s, {info['bytes'] / 1e6:.1f} MB"
                print(f"[{n[0]}/{len(ids)}] {tid}: {said} · {time.time() - t0:.0f} s in all", flush=True)
                if upload_every and n[0] % upload_every == 0:
                    send()

    threads = [threading.Thread(target=worker) for _ in range(jobs)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    send()
    print(f"stands done: {n[0]} tiles, {time.time() - t0:.0f} s", flush=True)


RETRIES, RETRY_WAIT = 3, 600  # queue_bake: tries a tile gets, seconds between them
REMOTE_EVERY = 600  # queue_bake: seconds between reads of R2's index


def queue_bake(path: Path, jobs: int, upload_every: int) -> None:
    """Tiles from a queue file (hunt_priority.py: one id a line, best first), read again
    before every tile, so the order can be changed while it runs; resumable (a tile done
    is skipped), the tiles sent to R2 every `upload_every`, and once more at the end.

    A file named PAUSE beside the queue pauses it (Gavan, 2026-10-14: "I might want to
    pause it at some point"): each job finishes its tile and waits, the tiles done so far
    go to R2, and taking the file away carries on."""
    import threading

    lock = threading.Lock()
    taken: set[str] = set()
    done_n = [0]
    t0 = time.time()

    # a tile that fails (a GPU shared with another job, the network gone for a minute: 2026-10-14
    # and 15) goes back in the queue in its place RETRY_WAIT on, up to RETRIES tries in all
    tries: dict[str, int] = {}
    retry_at: dict[str, float] = {}
    # tiles another machine has sent (xonix from the queue's end, 2026-10-16): skipped here,
    # R2's index read again every REMOTE_EVERY seconds
    remote: set[str] = set()
    remote_at = [0.0]

    def next_tile() -> str | None:
        while True:
            waiting = False
            with lock:
                now = time.time()
                if now - remote_at[0] > REMOTE_EVERY:
                    remote_at[0] = now
                    try:
                        got = r2_tiles()
                        remote.clear()
                        remote.update(got)
                    except Exception as e:  # noqa: BLE001  the last list holds until the next read
                        print(f"  R2 index not read: {e}", flush=True)
                for line in path.read_text(encoding="utf-8").splitlines():
                    tid = line.split("\t")[0].strip()
                    if not tid or tid in taken or tid in remote or (OUT / f"{tid}.json").exists():
                        continue
                    if retry_at.get(tid, 0) > now:
                        waiting = True
                        continue
                    taken.add(tid)
                    return tid
            if not waiting:
                return None
            time.sleep(30)  # only failed tiles left, waiting for their next try

    pause = path.parent / "PAUSE"
    sent_at_pause = [False]

    def wait_if_paused() -> None:
        if not pause.exists():
            return
        with lock:
            if not sent_at_pause[0]:
                sent_at_pause[0] = True
                print(f"  paused ({pause}): each job stops after its tile", flush=True)
                try:
                    index()
                    print(f"  uploaded {upload()[0]} to R2", flush=True)
                except Exception as e:  # noqa: BLE001
                    print(f"  upload failed: {e}", flush=True)
        while pause.exists():
            time.sleep(15)
        with lock:
            if sent_at_pause[0]:
                sent_at_pause[0] = False
                print("  resumed", flush=True)

    def worker() -> None:
        while (wait_if_paused() is None) and (tid := next_tile()) is not None:
            try:
                info = bake_one(*lattice.parse_id(tid), False)
            except Exception as e:  # noqa: BLE001  one tile's trouble never stops the night
                info = {"tile": tid, "error": f"{type(e).__name__}: {e}"}
            with lock:
                if "error" in info and not (OUT / f"{tid}.json").exists():
                    tries[tid] = tries.get(tid, 0) + 1
                    if tries[tid] < RETRIES:
                        taken.discard(tid)
                        retry_at[tid] = time.time() + RETRY_WAIT
                        info["error"] += f" (try {tries[tid]} of {RETRIES}: again in {RETRY_WAIT // 60} min)"
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
    # a failed last upload ends the run all the same (2026-10-16, xonix with a wrong R2 key): the
    # tiles stay in out/ and the next upload that works sends them, as for the periodic ones
    try:
        sent, _ = upload()
    except Exception as e:  # noqa: BLE001
        print(f"  upload failed: {e} (the tiles stay in {OUT} for the next upload)", flush=True)
        sent = 0
    print(f"queue empty: {done_n[0]} tiles this run, {sent} sent at the end, {time.time() - t0:.0f} s")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("cmd", choices=["plan", "bake", "seams", "index", "upload", "batches", "stands"])
    ap.add_argument("--box", nargs=4, type=float, metavar=("W", "S", "E", "N"))
    ap.add_argument("--jobs", type=int, default=2)
    ap.add_argument("--keep", action="store_true", help="keep each tile's working folder (with its margin) for the seams check")
    ap.add_argument("--queue", help="bake the tiles of this file in order (hunt_priority.py), read again before each tile")
    ap.add_argument("--upload-every", type=int, default=50)
    ap.add_argument("--size", type=int, default=50, help="batches: tiles a batch file")
    ap.add_argument("--out-dir", help="batches: where the batch files go")
    ap.add_argument("--reverse", action="store_true", help="batches: from the queue's end (a second machine)")
    ap.add_argument("--stands", action="store_true", help="batches: the baked tiles still without their stand bands")
    ap.add_argument("--version", default=None, help="a trial version: out-<version>/ and data/sd/<version>/ on R2 (default v1)")
    ap.add_argument("--run", default=None, help="the surrogate run for the wind (default all)")
    ap.add_argument("--wetlands", action="store_true", help="habitat-lite reads the province's own wetlands (a trial)")
    a = ap.parse_args()
    # a trial version (2026-10-17, SD v2: "trial, then decide"): its own out-<version> folder, its own
    # R2 prefix data/sd/<version>/ and index, never v1's; --run names the net its wind comes from
    global VERSION, OUT, SD_RUN, WETLANDS
    if a.version and a.version != VERSION:
        VERSION, OUT = a.version, BASE / f"out-{a.version}"
    if a.run:
        SD_RUN = a.run
    WETLANDS = a.wetlands
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
    if a.cmd == "stands":
        stands_run(Path(a.queue), a.jobs, a.upload_every)
        return 0
    if a.cmd == "batches":
        n, k = batches(Path(a.queue), a.size, Path(a.out_dir), a.reverse, a.stands)
        print(f"{n} batch files of up to {a.size} tiles in {a.out_dir}: {k} tiles {'without their stand' if a.stands else 'not yet baked'}")
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
