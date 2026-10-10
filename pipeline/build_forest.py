"""Ontario FRI (FIMv2, White River Forest 2010) stands for the region → GeoJSON.

The packaged product is a file geodatabase; reading it needs GDAL's
OpenFileGDB driver, which on this machine is only installed for Python
3.13 (pyogrio). So this one script runs under that interpreter:

    py -3.13 pipeline/build_forest.py

Input:  the area's FRI geodatabase and its CRS (bake.forest gdb and crs in
        the area file; Pickle Lake's is
        pipeline/raw/fri/pp_FRI_FIMv2_WhiteRiverForest_2010_2D.gdb in UTM 16N,
        downloaded with pipeline/fetch_resume.py, see docs/DATA-SOURCES.md).
        An area across a forest unit's line gives gdb as a list, one package
        per unit (Whitefish Lake: Abitibi River and Timiskaming); each
        package's stand layer and CRS are read from the file where not given
        (the layer is named Polygon_Forest, Polygon_Forest_2D,
        Polygon_Forest_Updated<date>, or after the forest, as Algoma's
        Algoma_Forest_2D).
        Ontario only: Quebec's stands come from qc_forest.py.
Output: app/public/data/forest-<region>.geojson with the fields the map
        style and the habitat bake read: group, species, year, ht, cc, sc,
        conif, hard, poly, dep, deptype, eco.

Species composition (OSPCOMP) looks like "Sb 70Pj 20Bw 10". Conifer codes
Sb Sw Bf Pj Pw Pr Cw La Ce He; the rest (Pt Po Bw Ab Mh Ms Bd Ow…) are
hardwood. `group` is what the forest fill colours by: conifer (≥70 %
conifer), hardwood (≤30 %), mixed, wetland (open/treed muskeg), brush,
water, burn or cut (depletion type with a year), other.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import numpy as np
import pyogrio
import shapely
from pyproj import Transformer
from shapely.ops import transform as shp_transform

sys.path.insert(0, str(Path(__file__).resolve().parent))
from area import BAKE, JURISDICTION, options  # noqa: E402
from common import OUT_DIR, REGION  # noqa: E402

FRI = options(BAKE, "forest")
_gdb = FRI.get("gdb") or "raw/fri/pp_FRI_FIMv2_WhiteRiverForest_2010_2D.gdb"
GDBS = [Path(__file__).resolve().parent / g for g in ([_gdb] if isinstance(_gdb, str) else _gdb)]
CRS = FRI.get("crs")  # else each package's own
CONIFER = {"Sb", "Sw", "Bf", "Pj", "Pw", "Pr", "Cw", "La", "Ce", "He", "Sx", "Pl", "Ps"}
COLUMNS = ["POLYTYPE", "DEVSTAGE", "YRDEP", "DEPTYPE", "OYRORG", "OSPCOMP", "OLEADSPC", "OAGE", "OHT", "OCCLO", "OSC", "PRI_ECO"]
SPC_RE = re.compile(r"([A-Z][a-z]?)\s*(\d+)")


def parse_comp(s: str) -> list[tuple[str, int]]:
    return [(m.group(1), int(m.group(2))) for m in SPC_RE.finditer(s or "")]


def main() -> None:
    if JURISDICTION != "ON":
        raise SystemExit(f"{REGION['name']} is in {JURISDICTION}: the FRI is Ontario's, use the area's own forest adapter (bake_area.py)")
    missing = [g for g in GDBS if not g.exists()]
    if missing:
        raise SystemExit(f"missing {', '.join(map(str, missing))}; download the FRI package first (see docs/DATA-SOURCES.md)")
    feats = []
    for gdb in GDBS:
        feats += stands(gdb)
    out = OUT_DIR / f"forest-{REGION['id']}.geojson"
    fc = {"type": "FeatureCollection", "name": "FRI FIMv2 " + ", ".join(g.stem.removeprefix("pp_FRI_FIMv2_").removesuffix("_2D") for g in GDBS), "features": feats}
    out.write_text(json.dumps(fc, separators=(",", ":")), encoding="utf-8")
    groups = {}
    for f in feats:
        groups[f["properties"]["group"]] = groups.get(f["properties"]["group"], 0) + 1
    print(f"wrote {out.name} ({out.stat().st_size / 1e6:.2f} MB, {len(feats)} stands) {groups}")
    _ = np  # keep the import honest for type checkers that flag unused numpy


def stand_layer(gdb: Path) -> str:
    names = [n for n, _ in pyogrio.list_layers(str(gdb))]
    if "Polygon_Forest" in names:
        return "Polygon_Forest"
    found = sorted(n for n in names if n.lower().startswith("polygon_forest"))
    # some packages name it after the forest: Algoma_Forest_2D
    found = found or sorted(n for n in names if n.lower().endswith("_forest_2d"))
    if not found:
        raise SystemExit(f"{gdb.name} has no Polygon_Forest layer: {', '.join(names)}")
    return found[-1]


def stands(gdb: Path) -> list[dict]:
    """One package's stands in the region, in the normal form."""
    layer = FRI.get("layer") or stand_layer(gdb)
    crs = CRS or pyogrio.read_info(str(gdb), layer=layer)["crs"]
    to_utm = Transformer.from_crs("EPSG:4326", crs, always_xy=True)
    to_wgs = Transformer.from_crs(crs, "EPSG:4326", always_xy=True)
    x0, y0 = to_utm.transform(REGION["west"], REGION["south"])
    x1, y1 = to_utm.transform(REGION["east"], REGION["north"])
    meta, _, wkbs, fields = pyogrio.raw.read(str(gdb), layer=layer, bbox=(x0, y0, x1, y1), columns=COLUMNS)
    col = {n: f for n, f in zip(meta["fields"], fields)}
    print(f"{len(wkbs)} stands in the region from {gdb.name} ({layer})")

    feats = []
    for i, wkb in enumerate(wkbs):
        g = shapely.from_wkb(wkb)
        if g is None or g.is_empty:
            continue
        g = shp_transform(to_wgs.transform, g)
        g = shapely.set_precision(shapely.simplify(g, 0.00003), 0.000001)
        if g.is_empty:
            continue
        poly = str(col["POLYTYPE"][i]).strip()
        comp = parse_comp(str(col["OSPCOMP"][i]))
        conif = sum(p for s, p in comp if s in CONIFER)
        hard = sum(p for s, p in comp if s not in CONIFER)
        year = int(col["OYRORG"][i] or 0)
        dep = int(col["YRDEP"][i] or 0)
        deptype = str(col["DEPTYPE"][i]).strip()
        if poly == "WAT":
            group = "water"
        elif poly in ("OMS", "TMS"):
            group = "wetland"
        elif poly == "BSH":
            group = "brush"
        elif deptype == "FIRE" and dep:
            group = "burn"
        elif deptype == "HARVEST" and dep:
            group = "cut"
        elif poly == "FOR" and comp:
            group = "conifer" if conif >= 70 else "hardwood" if conif <= 30 else "mixed"
        else:
            group = "other"
        species = " ".join(f"{s}{p}" for s, p in sorted(comp, key=lambda t: -t[1])[:3])
        feats.append(
            {
                "type": "Feature",
                "geometry": json.loads(shapely.to_geojson(g)),
                "properties": {
                    "group": group,
                    "species": species,
                    "year": year or None,
                    "ht": float(col["OHT"][i] or 0) or None,
                    "cc": int(col["OCCLO"][i] or 0) or None,
                    "sc": int(col["OSC"][i]) if col["OSC"][i] is not None else None,
                    "conif": conif,
                    "hard": hard,
                    "poly": poly,
                    "dep": dep or None,
                    "deptype": deptype or None,
                    "eco": str(col["PRI_ECO"][i]).strip() or None,
                },
            }
        )
    return feats


if __name__ == "__main__":
    main()
