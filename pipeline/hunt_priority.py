"""The order the SD wind tiles are baked in: hunting units by how much is
hunted there (Gavan, 2026-10-13: "focus in around WMUs with the most moose
tags, deer harvest numbers. Same with Quebec").

    py -3.13 pipeline/hunt_priority.py --ranks pipeline/raw/windtiles/ranks.json --out pipeline/raw/windtiles/queue.txt

ranks.json: {"ON": [["21A", "why"], ...], "QC": [["2", "why"], ...]}, each
list best first. The units' outlines:

  Ontario   the Wildlife Management Units, LIO's WILDADMU package (staged,
            pipeline/raw/stage/lio/WILDADMU)
  Quebec    the hunting zones, the SmartFaune service (MFFP). Its licence is
            not stated, so the outlines are kept in pipeline/raw only and
            used here to pick tiles; nothing ships them (qc_vectors.py wmu).

The queue alternates the provinces rank by rank (Ontario's first, then
Quebec's first, ...), each unit's tiles in a row, a tile already queued
skipped, so a night's bake leaves both provinces' best ground done. One
tile id a line, with the unit after a tab.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

import pyogrio
import shapely
from shapely.ops import transform as reproject

HERE = Path(__file__).resolve().parent
WMU_GDB = HERE / "raw" / "stage" / "lio" / "WILDADMU" / "Non_Sensitive.gdb"
QC_CACHE = HERE / "raw" / "windtiles" / "qc-zones.geojson"
SMARTFAUNE = "https://servicesvecto3.mern.gouv.qc.ca/geoserver/SmartFaunePub/ows"
RANKS: Path | None = None  # the ranks file (main sets it): Quebec's outlines are fetched for its zones only
# tiles.py's lattice
D_LON, D_LAT, LON0, LAT0, TC, TR = 0.0004, 0.00027, -180.0, 90.0, 375, 370


def ontario() -> dict[str, shapely.Geometry]:
    _, _, geom, fields = pyogrio.raw.read(WMU_GDB, layer="WILDLIFE_MGMT_UNIT", columns=["OFFICIAL_NAME"], return_fids=False)
    out: dict[str, shapely.Geometry] = {}
    for name, wkb in zip(fields[0], geom):
        g = shapely.from_wkb(wkb)
        key = str(name).strip().upper()
        out[key] = shapely.union(out[key], g) if key in out else g
    return out  # NAD83 lon/lat: near enough to WGS84 for picking 11 km tiles


def quebec() -> dict[str, shapely.Geometry]:
    if not QC_CACHE.exists():
        # 9,503 features, most of them islets: the server sends at most 1,000 a request and drops
        # the connection on a big answer. So the attributes first (no geometry: quick), then the
        # outlines of the polygons of 1 km2 or more (the 50 largest are 99.99% of the area) by id
        typ = "SmartFaunePub:Zone_chasse_da3_sefaq"

        def get(q: dict) -> dict:
            for attempt in range(6):
                try:
                    with urllib.request.urlopen(f"{SMARTFAUNE}?{urllib.parse.urlencode(q)}", timeout=600) as r:
                        return json.loads(r.read())
                except Exception as e:  # noqa: BLE001
                    print(f"  zones: {e} (try {attempt + 1})", file=sys.stderr)
            raise SystemExit("the zone service would not answer")

        base = {"service": "WFS", "version": "2.0.0", "request": "GetFeature", "typeNames": typ, "outputFormat": "application/json", "srsName": "EPSG:4326"}
        attrs = []
        for start in range(0, 20_000, 1000):
            page = get(base | {"propertyName": "No_zone,Partie_zon,Shape_Area", "count": 1000, "startIndex": start, "sortBy": "Shape_Area DESC"})["features"]
            attrs += page
            if len(page) < 1000:
                break
        # only the ranked zones' polygons, the smallest first: the far north's giants (22, 23, 24),
        # none of them ranked, are what the server will not send
        ranked = {str(z[0]).lstrip("0") for z in json.loads(RANKS.read_text(encoding="utf-8")).get("QC", [])} if RANKS else set()
        keep = [f for f in attrs if (f["properties"].get("Shape_Area") or 0) >= 1e6
                and (not ranked or str(f["properties"].get("No_zone") or "").strip().lstrip("0") in ranked)]
        big = [f["id"] for f in sorted(keep, key=lambda f: f["properties"].get("Shape_Area") or 0)]
        print(f"  zones: {len(attrs)} features, {len(big)} of 1 km2 or more", file=sys.stderr)
        # one outline a request (a few big ones together is what the server drops), kept as
        # they come so a stopped run picks up where it was
        part = QC_CACHE.with_suffix(".part.jsonl")
        feats = [json.loads(x) for x in part.read_text(encoding="utf-8").splitlines()] if part.exists() else []
        have = {f["id"] for f in feats}
        for fid in big:
            if fid in have:
                continue
            try:
                got = get(base | {"resourceId": fid})["features"]
            except SystemExit:
                # one the server will not send (the far north's biggest, none of them ranked): left out
                print(f"  zones: {fid} would not come: left out", file=sys.stderr, flush=True)
                continue
            with open(part, "a", encoding="utf-8") as fh:
                for f in got:
                    fh.write(json.dumps(f) + "\n")
            feats += got
            print(f"  zones: {len(feats)} of {len(big)} outlines", file=sys.stderr, flush=True)
        QC_CACHE.parent.mkdir(parents=True, exist_ok=True)
        QC_CACHE.write_text(json.dumps({"type": "FeatureCollection", "features": feats}), encoding="utf-8")
    fc = json.loads(QC_CACHE.read_text(encoding="utf-8"))
    out: dict[str, shapely.Geometry] = {}
    for f in fc["features"]:
        p = f["properties"]
        zone = str(p.get("No_zone") or p.get("Zone") or "").strip()
        part = str(p.get("Partie_zon") or "").strip()
        g = shapely.make_valid(shapely.geometry.shape(f["geometry"]))
        for key in {zone, f"{zone} {part}".strip()}:  # a zone whole, and each of its parts
            out[key] = shapely.union(out[key], g) if key in out else g
    return out


def tiles_over(g: shapely.Geometry) -> list[str]:
    w, s, e, n = g.bounds
    i0, i1 = math.floor((w - LON0) / (TC * D_LON)), math.floor((e - LON0) / (TC * D_LON))
    j0, j1 = math.floor((LAT0 - n) / (TR * D_LAT)), math.floor((LAT0 - s) / (TR * D_LAT))
    shapely.prepare(g)
    out = []
    for j in range(j0, j1 + 1):
        for i in range(i0, i1 + 1):
            box = shapely.box(LON0 + i * TC * D_LON, LAT0 - (j + 1) * TR * D_LAT, LON0 + (i + 1) * TC * D_LON, LAT0 - j * TR * D_LAT)
            if g.intersects(box):
                out.append(f"t-{i}-{j}")
    return out


def staged_boxes() -> list[tuple[float, float, float, float]]:
    """The boxes stage.py has copied whole (every layer done): a tile inside one reads its maps from disk."""
    out = []
    for ix in (HERE / "raw" / "stage").glob("*/index.json"):
        j = json.loads(ix.read_text(encoding="utf-8"))
        if all((ix.parent / f"{k}.tif.done").exists() for k in j["layers"]):
            out.append(tuple(j["box"]))
    return out


def fast(tid: str, boxes) -> bool:
    """The tile with the wind bake's margin (150 cells) inside a staged box."""
    _, i, j = tid.split("-")
    i, j = int(i), int(j)
    w = LON0 + (i * TC - 150) * D_LON
    e = LON0 + ((i + 1) * TC + 150) * D_LON
    n = LAT0 - (j * TR - 150) * D_LAT
    s = LAT0 - ((j + 1) * TR + 150) * D_LAT
    return any(bw <= w and e <= be and bs <= s and n <= bn for bw, bs, be, bn in boxes)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--ranks", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--list-units", action="store_true", help="print the unit names each province's outlines carry, and stop")
    a = ap.parse_args()
    global RANKS
    RANKS = Path(a.ranks)
    ranks = json.loads(Path(a.ranks).read_text(encoding="utf-8"))
    units = {"ON": ontario(), "QC": quebec() if ranks.get("QC") or a.list_units else {}}
    if a.list_units:
        for prov, u in units.items():
            print(prov, len(u), sorted(u)[:200])
        return 0
    order: list[tuple[str, str]] = []
    for k in range(max(len(ranks.get("ON", [])), len(ranks.get("QC", [])))):
        for prov in ("ON", "QC"):
            if k < len(ranks.get(prov, [])):
                order.append((prov, str(ranks[prov][k][0]).strip().upper() if prov == "ON" else str(ranks[prov][k][0]).strip()))
    seen: set[str] = set()
    lines = []
    for prov, unit in order:
        g = units[prov].get(unit) or (units[prov].get(unit.lstrip("0")) if prov == "QC" else None)
        if g is None and prov == "ON":
            # the harvest is reported by the parent unit (92) where the outlines split it (92A to 92D)
            parts = [v for k, v in units["ON"].items() if re.fullmatch(re.escape(unit) + r"[A-Z](-\d)?", k)]
            g = shapely.union_all(parts) if parts else None
        if g is None:
            print(f"  {prov} {unit}: no outline by that name", file=sys.stderr)
            continue
        new = [t for t in tiles_over(g) if t not in seen]
        seen.update(new)
        lines += [f"{t}\t{prov} {unit}" for t in new]
        print(f"{prov} {unit:8s} {len(new):4d} tiles · {len(lines)} queued")
    # the tiles whose maps are on this PC first (a tile reading SCANFI over the network takes
    # 2-3 times as long), each group in the hunting order
    boxes = staged_boxes()
    quick = [ln for ln in lines if fast(ln.split("\t")[0], boxes)]
    slow = [ln for ln in lines if not fast(ln.split("\t")[0], boxes)]
    print(f"{len(quick)} tiles with their maps staged first, then {len(slow)} read over the network")
    Path(a.out).write_text("\n".join(quick + slow) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
