"""SD tiles: the habitat, ground-wind and going grids on one national lattice.

An SD area (docs/AREAS.md, Live, SD and HD) is cut from fixed tiles rather
than drawn around a point, so two hunters asking about the same valley share
the same files and the cost grows with land, not users. A tile is
TILE_COLS x TILE_ROWS cells of the habitat lattice (D_LON x D_LAT, anchored
at 180 W, 90 N): 0.15 x 0.0999 degrees, about 11 x 11 km at 49 N. Every
tile's grids line up cell for cell with its neighbours', so the app can
stitch any block of them into one grid.

Each tile is baked as a small area of its own (pipeline/raw/tiles/areas/,
outside the app's list): its core is the tile and its region the tile plus
MARGIN cells each way, so the wind solve and the distances (to water, to an
edge) see the ground around it. The habitat and micro grids are then cut
back to the tile; the going grid is the core's already. Only the SD inputs
are read: the staged national rasters (stage.py), SCANFI and CanLaD stands
(ca_forest.py), LIO's water, wetlands, roads and burns, and the MRDEM for
the core's elevation. No LiDAR, no point cloud, no WindNinja.

    py -3.14 pipeline/tiles.py plan --around 48.930948 -85.593408 --n 3
    py -3.14 pipeline/tiles.py bake t-629-411 t-630-411 --jobs 3
    py -3.14 pipeline/tiles.py seams t-628-410 ... (every tile of a block)
    py -3.14 pipeline/tiles.py stitch --out pilot t-628-410 ...

Outputs: pipeline/raw/tiles/out/<tile>/{habitat,micro,going}.hab and a
tile.json with each step's time, the sizes and the checks. The bake's own
working files stay in pipeline/raw/tiles/work/<tile>/.
"""

from __future__ import annotations

import argparse
import gzip
import json
import math
import os
import shutil
import struct
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
TILES = HERE / "raw" / "tiles"
AREAS = TILES / "areas"
WORK = TILES / "work"
OUT = TILES / "out"

D_LON, D_LAT = 0.0004, 0.00027  # build_habitat.py's lattice
LON0, LAT0 = -180.0, 90.0
TILE_COLS, TILE_ROWS = 375, 370  # 0.15 x 0.0999 degrees
MARGIN = 90  # cells each way: about 2.6 km east-west and 2.4 km north-south at 49 N
NUDGE = 1e-7  # degrees: keeps build_going.py's floor/ceil on the cell it means

# the SD bake: script and arguments, in order (bake_area.py's steps, cut down)
STEPS = [
    ("rasters", ["rasters.py"]),
    ("vectors", ["build_vectors.py", "waterbody", "watercourse", "wetland", "ara", "roads", "fire"]),
    ("forest", ["ca_forest.py"]),
    ("core-dem", ["build_hillshade.py"]),  # no LiDAR: the core's elevation grid from the MRDEM
    ("habitat", ["build_habitat.py"]),
    ("micro", ["build_microclimate.py"]),
    ("going", ["build_going.py"]),
]
# steps that read a server, tried again after a wait: LIO's front end drops
# TLS now and then, and two tiles asking at once both lost it (2026-10-06)
NET_STEPS = {"vectors"}
NET_TRIES = 4
# with LIO's province-wide packages staged (on_vectors_local.py), the
# vectors come from disk; ara (lake depths, for fishing) is not among them
LOCAL_THEMES = ["waterbody", "watercourse", "wetland", "roads", "fire"]
LIO_CODES = {"waterbody": "OHNWBDY", "watercourse": "OHNWCRS", "wetland": "WETLAND", "roads": "MNRRDSEG", "fire": "FIREDSTB"}


def lio_staged() -> bool:
    if os.environ.get("HUNTAPP_LIO_REST"):
        return False
    lio = HERE / "raw" / "stage" / "lio"
    return all((lio / LIO_CODES[t] / "Non_Sensitive.gdb").exists() for t in LOCAL_THEMES)


# ---- the lattice -----------------------------------------------------------

def tile_of(lat: float, lon: float) -> tuple[int, int]:
    return math.floor((lon - LON0) / (TILE_COLS * D_LON)), math.floor((LAT0 - lat) / (TILE_ROWS * D_LAT))


def tile_id(i: int, j: int) -> str:
    return f"t-{i}-{j}"


def parse_id(tid: str) -> tuple[int, int]:
    _, i, j = tid.split("-")
    return int(i), int(j)


def tile_box(i: int, j: int, margin: int = 0) -> dict:
    """The tile's west, south, east and north, `margin` cells wider each way."""
    c0, c1 = i * TILE_COLS - margin, (i + 1) * TILE_COLS + margin
    r0, r1 = j * TILE_ROWS - margin, (j + 1) * TILE_ROWS + margin
    return {
        "west": round(LON0 + c0 * D_LON, 9),
        "east": round(LON0 + c1 * D_LON, 9),
        "north": round(LAT0 - r0 * D_LAT, 9),
        "south": round(LAT0 - r1 * D_LAT, 9),
    }


def tiles_in(box: tuple[float, float, float, float]) -> list[tuple[int, int]]:
    w, s, e, n = box
    i0, j0 = tile_of(n, w)
    i1, j1 = tile_of(s, e)
    return [(i, j) for j in range(j0, j1 + 1) for i in range(i0, i1 + 1)]


# ---- a tile as an area ----------------------------------------------------

def area_file(i: int, j: int) -> dict:
    tid = tile_id(i, j)
    region = tile_box(i, j, MARGIN)
    t = tile_box(i, j)
    # the core a hair inside the tile, so build_going's floor/ceil of
    # (core - region) / cell lands on MARGIN and MARGIN + TILE exactly
    core = {"west": t["west"] + NUDGE, "south": t["south"] + NUDGE, "east": t["east"] - NUDGE, "north": t["north"] - NUDGE, "maxzoom": 15}
    centre = [round((t["west"] + t["east"]) / 2, 6), round((t["south"] + t["north"]) / 2, 6)]
    return {
        "id": tid,
        "name": f"Tile {i}/{j}",
        "jurisdiction": "ON",
        "centre": centre,
        "home": {"center": centre, "zoom": 13},
        "region": region,
        "core": core,
        "regionMaxzoom": 13,
        "declination": None,
        "timezone": "America/Toronto",
        "zone": {"label": "WMU", "name": None},
        "relief": None,
        "base": "",
        "live": {"lio": True},
        "presets": [],
        "files": {"pmtiles": [], "geo": [], "grids": ["habitat", "micro", "going"]},
        "bake": {
            "outDir": str((WORK / tid).relative_to(ROOT)).replace("\\", "/"),
            "hrdem": [],
            "lidar": "none",
            "vectors": "on.lio",
            "forest": {"adapter": "ca.scanfi", "vintage": "SCANFI 2025; CanLaD 1985-2025"},
            "pointcloud": None,
            "imagery": None,
            "nts": [],
        },
    }


def check_lattice(a: dict) -> None:
    """The cuts build_habitat and build_going will make, worked out here
    first: a tile that comes out one cell off would not stitch."""
    r, c = a["region"], a["core"]
    cols = int(round((r["east"] - r["west"]) / D_LON))
    rows = int(round((r["north"] - r["south"]) / D_LAT))
    hc0 = math.floor((c["west"] - r["west"]) / D_LON)
    hc1 = math.ceil((c["east"] - r["west"]) / D_LON)
    hr0 = math.floor((r["north"] - c["north"]) / D_LAT)
    hr1 = math.ceil((r["north"] - c["south"]) / D_LAT)
    want = (TILE_COLS + 2 * MARGIN, TILE_ROWS + 2 * MARGIN, MARGIN, MARGIN + TILE_COLS, MARGIN, MARGIN + TILE_ROWS)
    if (cols, rows, hc0, hc1, hr0, hr1) != want:
        raise SystemExit(f"{a['id']}: the lattice cuts come out {(cols, rows, hc0, hc1, hr0, hr1)}, not {want}")


# ---- .hab files -----------------------------------------------------------

def read_hab(path: Path) -> tuple[dict, bytes]:
    raw = path.read_bytes()
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    hlen = struct.unpack("<I", raw[:4])[0]
    return json.loads(raw[4 : 4 + hlen]), raw[4 + hlen :]


def bands_of(header: dict, payload: bytes):
    import numpy as np

    n = header["cols"] * header["rows"]
    for b in header["bands"]:
        a = np.frombuffer(payload, dtype=np.dtype(b["dtype"]), count=n, offset=b["offset"]).reshape(header["rows"], header["cols"])
        yield b, a


def write_hab(path: Path, header: dict, bands: list[tuple[dict, "object"]]) -> None:
    import numpy as np

    header = {**header, "bands": []}
    payload = bytearray()
    for b, a in bands:
        a = np.ascontiguousarray(a)
        header["bands"].append({**b, "offset": len(payload)})
        payload += a.tobytes()
    hj = json.dumps(header, separators=(",", ":")).encode("utf-8")
    path.write_bytes(gzip.compress(struct.pack("<I", len(hj)) + hj + bytes(payload), 9))


def crop_hab(src: Path, dst: Path, tid: str, r0: int, c0: int, rows: int, cols: int) -> None:
    header, payload = read_hab(src)
    bands = [(b, a[r0 : r0 + rows, c0 : c0 + cols]) for b, a in bands_of(header, payload)]
    h = {**header, "region": tid, "cols": cols, "rows": rows, "west": round(header["west"] + c0 * header["dLon"], 9), "north": round(header["north"] - r0 * header["dLat"], 9)}
    h["tile"] = {"lattice": [LON0, LAT0, D_LON, D_LAT, TILE_COLS, TILE_ROWS], "margin": MARGIN}
    write_hab(dst, h, bands)


# ---- baking ---------------------------------------------------------------

def bake_one(tid: str, keep_caches: bool) -> dict:
    i, j = parse_id(tid)
    a = area_file(i, j)
    check_lattice(a)
    AREAS.mkdir(parents=True, exist_ok=True)
    (AREAS / f"{tid}.json").write_text(json.dumps(a, indent=1), encoding="utf-8")
    work, out = WORK / tid, OUT / tid
    work.mkdir(parents=True, exist_ok=True)
    out.mkdir(parents=True, exist_ok=True)
    env = {**os.environ, "HUNTAPP_AREAS_DIR": str(AREAS), "HUNTAPP_AREA": tid, "HUNTAPP_OUT": str(work), "PYTHONIOENCODING": "utf-8"}
    log_path = work / "bake.log"
    report = {"id": tid, "box": tile_box(i, j), "started": time.strftime("%Y-%m-%d %H:%M:%S"), "steps": {}}
    t_all = time.time()
    with log_path.open("w", encoding="utf-8") as log:
        for name, cmd in STEPS:
            t = time.time()
            run = [sys.executable, str(HERE / cmd[0]), *cmd[1:]]
            if name == "vectors" and lio_staged():  # the province-wide packages on disk: no server
                run = ["py", "-3.13", str(HERE / "on_vectors_local.py"), *LOCAL_THEMES]
            for attempt in range(NET_TRIES if name in NET_STEPS else 1):
                if attempt:
                    log.write(f"\n-- {name}: try {attempt + 1} after a {60 * attempt} s wait\n")
                    log.flush()
                    time.sleep(60 * attempt)
                p = subprocess.run(run, env=env, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT)
                if not p.returncode:
                    break
            report["steps"][name] = round(time.time() - t, 1)
            if p.returncode:
                report["failed"] = f"{name} (exit {p.returncode}; see {log_path.relative_to(ROOT)})"
                break
    report["seconds"] = round(time.time() - t_all, 1)
    if "failed" not in report:
        for g in ("habitat", "micro"):
            crop_hab(work / f"{g}-{tid}.hab", out / f"{g}.hab", tid, MARGIN, MARGIN, TILE_ROWS, TILE_COLS)
        going_h, going_p = read_hab(work / f"going-{tid}.hab")
        write_hab(out / "going.hab", {**going_h, "region": tid}, list(bands_of(going_h, going_p)))
        report["bytes"] = {g: (out / f"{g}.hab").stat().st_size for g in ("habitat", "micro", "going")}
        report["checks"] = checks(out)
        if not keep_caches:  # all of it made again from the staged inputs in a minute
            for p in [HERE / "raw" / f"{k}-{tid}.npz" for k in ("mrdem", "landcover", "lidar")]:
                p.unlink(missing_ok=True)
            shutil.rmtree(HERE / "raw" / "ca" / tid, ignore_errors=True)
    (out / "tile.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
    status = report.get("failed") or f"{report['seconds']:.0f} s, {sum(report.get('bytes', {}).values()) / 1e6:.1f} MB"
    print(f"{tid}: {status}  {report['steps']}", flush=True)
    return report


def checks(out: Path) -> dict:
    """What a person would look at first: is there land, are there stands,
    did the wind solve give numbers everywhere."""
    import numpy as np

    h, p = read_hab(out / "habitat.hab")
    b = {x["name"]: a for x, a in bands_of(h, p)}
    res: dict = {}
    if "cover" in b:
        cover = b["cover"]
        names = h.get("coverNames") or []
        res["water"] = round(float((cover == 1).mean()), 3)
        res["nodata"] = round(float((cover == 0).mean()), 3)
        res["cover"] = {names[k] if k < len(names) else str(k): round(float((cover == k).mean()), 3) for k in np.unique(cover)}
    mh, mp = read_hab(out / "micro.hab")
    bad = {}
    for x, a in bands_of(mh, mp):
        if np.dtype(x["dtype"]).kind == "f":
            n = int((~np.isfinite(a)).sum())
            if n:
                bad[x["name"]] = n
    res["microNonFinite"] = bad
    res["microBands"] = len(mh["bands"])
    return res


# ---- the seams: does a tile agree with its neighbour's margin --------------

def seams(ids: list[str]) -> dict:
    """For each pair of side-by-side tiles, the micro and habitat bands in the
    strip where one tile's margin covers the other's cells. The neighbour's
    own value is the truth there; the margin's is what the tile saw. The
    difference near the seam says how far a tile's edge drifts."""
    import numpy as np

    have = {parse_id(t): t for t in ids}
    rows = []
    for (i, j), tid in have.items():
        for di, dj, side in ((1, 0, "east"), (0, 1, "south")):
            nb = have.get((i + di, j + dj))
            if not nb:
                continue
            for g in ("micro", "habitat"):
                wa_h, wa_p = read_hab(WORK / tid / f"{g}-{tid}.hab")  # the tile with its margin
                nb_h, nb_p = read_hab(OUT / nb / f"{g}.hab")  # the neighbour, cut back
                wa = {x["name"]: (x, a) for x, a in bands_of(wa_h, wa_p)}
                for x, a_nb in bands_of(nb_h, nb_p):
                    if x["name"] not in wa or np.dtype(x["dtype"]).kind not in "fiu":
                        continue
                    a_wa = wa[x["name"]][1]
                    if side == "east":  # the margin's columns past the tile are the neighbour's first ones
                        strip_wa = a_wa[MARGIN : MARGIN + TILE_ROWS, MARGIN + TILE_COLS :]
                        strip_nb = a_nb[:, :MARGIN]
                        near_wa, near_nb = strip_wa[:, :10], strip_nb[:, :10]
                    else:
                        strip_wa = a_wa[MARGIN + TILE_ROWS :, MARGIN : MARGIN + TILE_COLS]
                        strip_nb = a_nb[:MARGIN, :]
                        near_wa, near_nb = strip_wa[:10, :], strip_nb[:10, :]
                    s = float(x.get("scale") or 1)
                    d = (near_wa.astype(np.float64) - near_nb.astype(np.float64)) * s
                    ok = np.isfinite(d)
                    if not ok.any():
                        continue
                    spread = float(np.nanstd(near_nb.astype(np.float64) * s)) or 1.0
                    rows.append(
                        {
                            "pair": f"{tid}|{nb}",
                            "grid": g,
                            "band": x["name"],
                            "same": round(float((d[ok] == 0).mean()), 3),
                            "medAbs": round(float(np.median(np.abs(d[ok]))), 4),
                            "p95Abs": round(float(np.percentile(np.abs(d[ok]), 95)), 4),
                            "spread": round(spread, 4),
                        }
                    )
    return {"pairs": len({r["pair"] for r in rows}), "rows": rows}


# ---- stitching: a block of tiles as one grid --------------------------------

def stitched(ids: list[str], grid: str) -> tuple[dict, dict]:
    """A block of tiles' grid as one: the header, and each band's array
    (the tiles' own dtype, unscaled). A tile missing from the block is 0."""
    import numpy as np

    ij = [parse_id(t) for t in ids]
    i0, i1 = min(i for i, _ in ij), max(i for i, _ in ij)
    j0, j1 = min(j for _, j in ij), max(j for _, j in ij)
    first = None
    blocks: dict[str, np.ndarray] = {}
    for t, (i, j) in zip(ids, ij):
        h, p = read_hab(OUT / t / f"{grid}.hab")
        if first is None:
            first, tr, tc = h, h["rows"], h["cols"]
            for x in h["bands"]:
                blocks[x["name"]] = np.zeros(((j1 - j0 + 1) * tr, (i1 - i0 + 1) * tc), dtype=np.dtype(x["dtype"]))
        for x, a in bands_of(h, p):
            blocks[x["name"]][(j - j0) * tr : (j - j0 + 1) * tr, (i - i0) * tc : (i - i0 + 1) * tc] = a
    # the block's corner from the lattice, whichever tiles are in it
    west = round(LON0 + i0 * TILE_COLS * D_LON, 9)
    north = round(LAT0 - j0 * TILE_ROWS * D_LAT, 9)
    rows, cols = next(iter(blocks.values())).shape
    return {**first, "cols": cols, "rows": rows, "west": west, "north": north}, blocks


def stitch(ids: list[str], out_path: Path, grid: str) -> None:
    header, blocks = stitched(ids, grid)
    header["region"] = out_path.stem
    write_hab(out_path, header, [(x, blocks[x["name"]]) for x in header["bands"]])
    print(f"wrote {out_path} ({header['cols']} x {header['rows']})")


# ---- SD against HD: the same ground baked both ways --------------------------

def compare(ids: list[str], area_id: str) -> dict:
    """The SD tiles against an HD area's own habitat and micro grids, cell by
    cell over the HD region (and its core, where the LiDAR is): the stands,
    the canopy, and the wind each would draw for eight directions. HD's day
    wind is WindNinja's momentum solve where the grid has it."""
    import numpy as np

    sys.path.insert(0, str(HERE))
    a = json.loads((ROOT / "app" / "src" / "areas" / f"{area_id}.json").read_text(encoding="utf-8"))
    hd_dir = ROOT / a["bake"].get("outDir", f"app/public/data/areas/{area_id}")
    core = a["core"]
    res: dict = {"area": area_id, "tiles": ids}

    def load_hd(g):
        h, p = read_hab(hd_dir / f"{g}-{area_id}.hab")
        return h, {x["name"]: a_.astype(np.float64) * float(x.get("scale") or 1) for x, a_ in bands_of(h, p)}

    def sample_sd(g, hd_h):
        sh, sb = stitched(ids, g)
        scale = {x["name"]: float(x.get("scale") or 1) for x in sh["bands"]}
        r = np.arange(hd_h["rows"])
        c = np.arange(hd_h["cols"])
        lon = hd_h["west"] + (c + 0.5) * hd_h["dLon"]
        lat = hd_h["north"] - (r + 0.5) * hd_h["dLat"]
        cs = np.floor((lon - sh["west"]) / sh["dLon"]).astype(int)
        rs = np.floor((sh["north"] - lat) / sh["dLat"]).astype(int)
        okc = (cs >= 0) & (cs < sh["cols"])
        okr = (rs >= 0) & (rs < sh["rows"])
        RR, CC = np.meshgrid(np.clip(rs, 0, sh["rows"] - 1), np.clip(cs, 0, sh["cols"] - 1), indexing="ij")
        inside = np.outer(okr, okc)
        lonG, latG = np.meshgrid(lon, lat)
        in_core = (lonG >= core["west"]) & (lonG <= core["east"]) & (latG >= core["south"]) & (latG <= core["north"])
        return {k: v[RR, CC].astype(np.float64) * scale[k] for k, v in sb.items()}, inside, in_core

    # -- habitat
    hh, hb = load_hd("habitat")
    sb, inside, in_core = sample_sd("habitat", hh)
    names = hh.get("coverNames") or []
    land = inside & (hb["cover"] != 1) & (sb["cover"] != 1) & (hb["cover"] != 0) & (sb["cover"] != 0)
    hab = {}
    for zone, m in (("region", inside), ("core", inside & in_core)):
        z = {"cells": int(m.sum())}
        z["coverSame"] = round(float((hb["cover"][m] == sb["cover"][m]).mean()), 3)
        z["waterSame"] = round(float(((hb["cover"][m] == 1) == (sb["cover"][m] == 1)).mean()), 3)
        ml = m & land
        pairs = {}
        for hc, sc in zip(hb["cover"][ml].astype(int), sb["cover"][ml].astype(int)):
            pairs[(hc, sc)] = pairs.get((hc, sc), 0) + 1
        top = sorted(pairs.items(), key=lambda kv: -kv[1])[:8]
        z["landPairs"] = [{"hd": names[h_] if h_ < len(names) else h_, "sd": names[s_] if s_ < len(names) else s_, "share": round(n / max(1, ml.sum()), 3)} for (h_, s_), n in top]
        for band in ("elev", "conifer", "height", "crown", "thick", "age", "distRoad", "distWetland"):
            if band in hb and band in sb:
                x, y = hb[band][ml], sb[band][ml]
                ok = np.isfinite(x) & np.isfinite(y)
                if ok.sum() > 10 and x[ok].std() > 0 and y[ok].std() > 0:
                    z[band] = {"r": round(float(np.corrcoef(x[ok], y[ok])[0, 1]), 3), "hdMed": round(float(np.median(x[ok])), 2), "sdMed": round(float(np.median(y[ok])), 2)}
        hab[zone] = z
    res["habitat"] = hab

    # -- micro: the wind each would draw by day, neutral air, for 8 directions
    mh, mb = load_hd("micro")
    sm, inside_m, core_m = sample_sd("micro", mh)
    mom = all(f"mU{k * 22.5:05.1f}" in mb for k in range(16))
    wind = {}
    for zone, m in (("region", inside_m), ("core", inside_m & core_m)):
        rows = []
        for d_from in range(0, 360, 45):
            to = math.radians(d_from + 180)
            ue, un = math.sin(to), math.cos(to)
            se = sm["nUe"] * ue + sm["nUn"] * un
            sn_ = sm["nVe"] * ue + sm["nVn"] * un
            ne_ = mb["nUe"] * ue + mb["nUn"] * un
            nn_ = mb["nVe"] * ue + mb["nVn"] * un
            row = {"from": d_from}

            def turn_diff(e1, n1, e2, n2):
                d = (np.degrees(np.arctan2(e1, n1)) - np.degrees(np.arctan2(e2, n2)) + 180) % 360 - 180
                return np.abs(d[m])

            def speed_ratio(e1, n1, e2, n2):
                s1, s2 = np.hypot(e1, n1)[m], np.hypot(e2, n2)[m]
                return s1 / np.maximum(s2, 1e-6)

            t = turn_diff(se, sn_, ne_, nn_)
            row["sdVsHdNeutral"] = {"turnMed": round(float(np.median(t)), 1), "turnP90": round(float(np.percentile(t, 90)), 1), "speedRatioMed": round(float(np.median(speed_ratio(se, sn_, ne_, nn_))), 3)}
            if mom:
                k = int(round(d_from / 22.5)) % 16
                me, mn = mb[f"mU{k * 22.5:05.1f}"], mb[f"mV{k * 22.5:05.1f}"]
                t2 = turn_diff(se, sn_, me, mn)
                t3 = turn_diff(ne_, nn_, me, mn)
                # the regional wind itself: how far each turns it
                reg_e, reg_n = np.full_like(se, ue), np.full_like(sn_, un)
                row["sdVsHdMomentum"] = {"turnMed": round(float(np.median(t2)), 1), "turnP90": round(float(np.percentile(t2, 90)), 1), "speedRatioMed": round(float(np.median(speed_ratio(se, sn_, me, mn))), 3)}
                row["hdNeutralVsMomentum"] = {"turnMed": round(float(np.median(t3)), 1), "turnP90": round(float(np.percentile(t3, 90)), 1)}
                tr_ = turn_diff(reg_e, reg_n, me, mn)
                row["forecastVsHdMomentum"] = {"turnMed": round(float(np.median(tr_)), 1), "turnP90": round(float(np.percentile(tr_, 90)), 1)}
                ts_ = turn_diff(reg_e, reg_n, se, sn_)
                row["forecastVsSd"] = {"turnMed": round(float(np.median(ts_)), 1), "turnP90": round(float(np.percentile(ts_, 90)), 1)}
            rows.append(row)
        z = {"cells": int(m.sum()), "byDirection": rows}
        for band in ("canopy", "treeH", "pool", "katSpd", "breezeMax"):
            if band in mb and band in sm:
                x, y = mb[band][m], sm[band][m]
                ok = np.isfinite(x) & np.isfinite(y)
                if ok.sum() > 10 and x[ok].std() > 0 and y[ok].std() > 0:
                    z[band] = {"r": round(float(np.corrcoef(x[ok], y[ok])[0, 1]), 3), "hdMed": round(float(np.median(x[ok])), 3), "sdMed": round(float(np.median(y[ok])), 3)}
        wind[zone] = z
    res["micro"] = wind
    res["hdHasMomentum"] = mom
    return res


# ---- the command line -------------------------------------------------------

def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("plan")
    p.add_argument("--around", type=float, nargs=2, metavar=("LAT", "LON"))
    p.add_argument("--n", type=int, default=3, help="--around: an n x n block")
    p.add_argument("--box", type=float, nargs=4, metavar=("W", "S", "E", "N"))
    b = sub.add_parser("bake")
    b.add_argument("ids", nargs="+")
    b.add_argument("--jobs", type=int, default=2)
    b.add_argument("--keep-caches", action="store_true")
    s = sub.add_parser("seams")
    s.add_argument("ids", nargs="+")
    st = sub.add_parser("stitch")
    st.add_argument("ids", nargs="+")
    st.add_argument("--out", required=True)
    cp = sub.add_parser("compare")
    cp.add_argument("ids", nargs="+")
    cp.add_argument("--area", required=True, help="the HD area to hold the tiles against")
    args = ap.parse_args()

    if args.cmd == "plan":
        if args.around:
            ci, cj = tile_of(*args.around)
            k = args.n // 2
            ijs = [(i, j) for j in range(cj - k, cj - k + args.n) for i in range(ci - k, ci - k + args.n)]
        elif args.box:
            ijs = tiles_in(tuple(args.box))
        else:
            ap.error("plan needs --around or --box")
        ids = [tile_id(i, j) for i, j in ijs]
        boxes = [tile_box(i, j) for i, j in ijs]
        w, s_, e, n = min(x["west"] for x in boxes), min(x["south"] for x in boxes), max(x["east"] for x in boxes), max(x["north"] for x in boxes)
        print(f"{len(ids)} tiles over {w:.4f} {s_:.4f} {e:.4f} {n:.4f}")
        print(" ".join(ids))
        return 0
    if args.cmd == "bake":
        t = time.time()
        with ThreadPoolExecutor(args.jobs) as ex:
            reports = list(ex.map(lambda tid: bake_one(tid, args.keep_caches), args.ids))
        bad = [r["id"] for r in reports if "failed" in r]
        print(f"{len(reports) - len(bad)}/{len(reports)} tiles in {time.time() - t:.0f} s" + (f"; failed: {', '.join(bad)}" if bad else ""))
        return 1 if bad else 0
    if args.cmd == "seams":
        res = seams(args.ids)
        (TILES / "seams.json").write_text(json.dumps(res, indent=1), encoding="utf-8")
        print(f"{res['pairs']} pairs, {len(res['rows'])} band comparisons -> {TILES / 'seams.json'}")
        return 0
    if args.cmd == "stitch":
        d = TILES / "stitched"
        d.mkdir(parents=True, exist_ok=True)
        for g in ("habitat", "micro", "going"):
            stitch(args.ids, d / f"{g}-{args.out}.hab", g)
        return 0
    if args.cmd == "compare":
        res = compare(args.ids, args.area)
        dest = TILES / f"compare-{args.area}.json"
        dest.write_text(json.dumps(res, indent=1, ensure_ascii=False), encoding="utf-8")
        print(f"-> {dest}")
        return 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
