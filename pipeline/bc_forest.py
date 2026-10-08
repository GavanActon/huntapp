"""British Columbia's forest stands for an area -> forest-<id>.geojson, in
exactly the normal form build_forest.py writes from Ontario's FRI: group,
species, year, ht, cc, sc, conif, hard, poly, dep, deptype, eco. The source
is the Vegetation Resources Inventory (VRI, the province's photo-interpreted
forest cover, projected to the current year), layer
WHSE_FOREST_VEGETATION.VEG_COMP_LYR_R1_POLY on the open WFS (bc_common.py),
Open Government Licence - British Columbia.

The VRI maps every polygon of the province, stand or not, with the BC Land
Cover Classification Scheme (BCLCS): vegetated or not, treed or not, upland,
wetland or alpine, and the cover class (conifer, broadleaf, mixed, tall or
low shrub, herb, bryoid; rock, snow, lake, river). So, like Quebec's map, it
says what each piece of ground with no stand is, and build_habitat.py takes
its word for it (FOREST_UPDATED). A stand's species are up to six codes
with their crown shares; its height, crown closure and age are projected to
PROJECTED_DATE.

Disturbance: the stand's own HARVEST_DATE and earliest non-logging
disturbance (burn, beetle, windthrow), and the province's fire perimeters
newer than the stand's photo laid over it (the piece inside the fire takes
the fire's year), the way qc_forest.py lays Quebec's later burns over its
map. Only an event within DEP_YEARS counts as a disturbance (dep); an older
one only dates the stand (year).

    py -3.14 pipeline/bc_forest.py --area blanchard-river

Answers are cached under pipeline/raw/bc/<id>/, so a rerun asks nothing.
"""

from __future__ import annotations

import sys
from collections import Counter
from datetime import date
from pathlib import Path

import shapely

sys.path.insert(0, str(Path(__file__).resolve().parent))
import area  # noqa: E402  (first: it takes --area out of argv)
from bc_common import box_of, feature, name_of, shapes, wfs, write, year_of  # noqa: E402
from common import REGION  # noqa: E402

if area.JURISDICTION != "BC":
    raise SystemExit(f"{REGION['name']} is in {area.JURISDICTION}: these are British Columbia's sources")

VRI = "WHSE_FOREST_VEGETATION.VEG_COMP_LYR_R1_POLY"
FIRES = "WHSE_LAND_AND_NATURAL_RESOURCE.PROT_HISTORICAL_FIRE_POLYS_SP"
YEAR = date.today().year
# as in qc_forest.py: a stand-replacing event at most this many years back
# is a disturbance; older ones only date the stand
DEP_YEARS = 40
MIN_PIECE_M2 = 500

FIELDS = ",".join(
    [
        "FEATURE_ID",
        "BCLCS_LEVEL_1",
        "BCLCS_LEVEL_2",
        "BCLCS_LEVEL_3",
        "BCLCS_LEVEL_4",
        "BCLCS_LEVEL_5",
        *(f"SPECIES_CD_{i}" for i in range(1, 7)),
        *(f"SPECIES_PCT_{i}" for i in range(1, 7)),
        "PROJ_AGE_1",
        "PROJ_HEIGHT_1",
        "CROWN_CLOSURE",
        "SITE_INDEX",
        "REFERENCE_YEAR",
        "PROJECTED_DATE",
        "HARVEST_DATE",
        "EARLIEST_NONLOGGING_DIST_TYPE",
        "EARLIEST_NONLOGGING_DIST_DATE",
        "NON_PRODUCTIVE_DESCRIPTOR_CD",
        "BEC_ZONE_CODE",
        "BEC_SUBZONE",
        "BEC_VARIANT",
        "SHRUB_HEIGHT",
        "SHRUB_CROWN_CLOSURE",
    ]
)

# VRI species codes -> (the normal form's code, Ontario's where there is
# one; conifer?). Subalpine fir goes in as Bf: the habitat rules treat fir
# as the eastern balsam fir, which it stands in for here (thermal cover,
# browse of last resort). Hybrid and white spruce are Sw; lodgepole pine Pl.
SPECIES: dict[str, tuple[str, bool]] = {
    # conifers
    "BL": ("Bf", True),  # subalpine fir
    "BA": ("Bf", True),  # amabilis fir
    "BG": ("Bf", True),  # grand fir
    "B": ("Bf", True),
    "SX": ("Sw", True),  # hybrid white spruce
    "SXW": ("Sw", True),
    "SW": ("Sw", True),  # white spruce
    "SE": ("Sw", True),  # Engelmann spruce
    "SXE": ("Sw", True),
    "S": ("Sw", True),
    "SB": ("Sb", True),  # black spruce
    "SS": ("Sx", True),  # Sitka spruce
    "SXS": ("Sx", True),
    "PL": ("Pl", True),  # lodgepole pine
    "PLI": ("Pl", True),
    "PLC": ("Pl", True),
    "PJ": ("Pj", True),  # jack pine
    "PW": ("Pw", True),  # western white pine
    "PY": ("Py", True),  # ponderosa pine
    "PA": ("Px", True),  # whitebark pine
    "PF": ("Px", True),  # limber pine
    "P": ("Px", True),
    "FD": ("Fd", True),  # Douglas-fir
    "FDI": ("Fd", True),
    "FDC": ("Fd", True),
    "HW": ("He", True),  # western hemlock
    "HM": ("He", True),  # mountain hemlock
    "H": ("He", True),
    "CW": ("Cw", True),  # western redcedar
    "YC": ("Cw", True),  # yellow-cedar
    "LW": ("La", True),  # western larch
    "LT": ("La", True),  # tamarack
    "LA": ("La", True),  # alpine larch
    "L": ("La", True),
    "J": ("Cx", True),  # juniper
    "JR": ("Cx", True),
    "T": ("Cx", True),  # yew
    "X": ("Cx", True),  # unknown conifer
    "XC": ("Cx", True),
    # hardwoods
    "AT": ("Pt", False),  # trembling aspen
    "ACT": ("Pb", False),  # black cottonwood
    "ACB": ("Pb", False),  # balsam poplar
    "AC": ("Pb", False),
    "A": ("Po", False),
    "EP": ("Bw", False),  # paper birch
    "EA": ("Bw", False),  # Alaska paper birch
    "E": ("Bw", False),
    "MB": ("Mx", False),  # bigleaf maple
    "DR": ("Hx", False),  # red alder
    "D": ("Hx", False),
    "W": ("Hx", False),  # willow
    "WS": ("Hx", False),
    "RA": ("Hx", False),  # arbutus
    "XH": ("Hx", False),  # unknown hardwood
    "GP": ("Ox", False),  # Garry oak
    "Q": ("Ox", False),
}

# Non-logging disturbance types -> the FRI's depletion types (stand-replacing
# ones only; a partial kill leaves the stand standing)
DISTURBANCE = {"B": "FIRE", "IBM": "INSECTS", "IBS": "INSECTS", "IBD": "INSECTS", "IB": "INSECTS", "W": "BLOWDOWN", "F": "OTHER", "S": "OTHER", "L": "OTHER"}

REGION_BOX = shapely.box(*box_of())


def poly_of(p: dict) -> str:
    """The FRI's POLYTYPE for a VRI polygon, from its land cover classes."""
    l1, l2, l3, l4 = (p.get(k) or "" for k in ("BCLCS_LEVEL_1", "BCLCS_LEVEL_2", "BCLCS_LEVEL_3", "BCLCS_LEVEL_4"))
    if l1 == "N":  # non-vegetated: water, or land (rock, snow and ice, exposed soil, talus)
        return "WAT" if l2 == "W" or l4 in ("LA", "RE", "RI", "OC") else "RCK"
    if l2 == "T":  # treed
        return "TMS" if l3 == "W" else "FOR"
    if l3 == "W":  # a non-treed wetland: open fen, bog or marsh
        return "OMS"
    if l4 in ("ST", "SL"):  # tall or low shrub: willow, alder, birch scrub
        return "BSH"
    if l4 in ("HE", "HF", "HG"):  # herb, forb, graminoid
        return "GRS"
    if l4 in ("BY", "BL", "BM"):  # bryoid: moss and lichen (alpine heath, lichen flats)
        return "GRS"
    return ""


def composition(p: dict) -> tuple[str, int, int]:
    """(species label, conifer %, hardwood %) from the stand's species and shares."""
    shares: dict[str, float] = {}
    conif = hard = 0.0
    for i in range(1, 7):
        code, pct = (p.get(f"SPECIES_CD_{i}") or "").strip().upper(), p.get(f"SPECIES_PCT_{i}")
        if not code or not pct:
            continue
        norm, is_conif = SPECIES.get(code) or SPECIES.get(code[:2]) or SPECIES.get(code[:1]) or ("Hx", False)
        shares[norm] = shares.get(norm, 0.0) + float(pct)
        if is_conif:
            conif += float(pct)
        else:
            hard += float(pct)
    if not shares:
        return "", 0, 0
    total = conif + hard
    conif_pct = int(round(100 * conif / total)) if total else 0
    parts = sorted(((c, int(5 * round(v / 5))) for c, v in shares.items()), key=lambda cv: -cv[1])
    return " ".join(f"{c}{v}" for c, v in parts[:4] if v > 0), conif_pct, 100 - conif_pct


def group_of(poly: str, deptype: str | None, dep: int | None, conif: int, hard: int) -> str:
    """The forest fill's group, by build_forest.py's rule."""
    if poly == "WAT":
        return "water"
    if poly in ("OMS", "TMS"):
        return "wetland"
    if poly == "BSH":
        return "brush"
    if deptype == "FIRE" and dep:
        return "burn"
    if deptype == "HARVEST" and dep:
        return "cut"
    if poly == "FOR" and (conif or hard):
        return "conifer" if conif >= 70 else "hardwood" if conif <= 30 else "mixed"
    return "other"


def disturbance(p: dict) -> tuple[int | None, str | None, int | None]:
    """(dep, deptype, origin year) from the stand's own history: the newest
    stand-replacing event, a disturbance when recent enough."""
    events: list[tuple[int, str]] = []
    if (y := year_of(p.get("HARVEST_DATE"))) is not None:
        events.append((y, "HARVEST"))
    kind = DISTURBANCE.get((p.get("EARLIEST_NONLOGGING_DIST_TYPE") or "").strip().upper())
    if kind and (y := year_of(p.get("EARLIEST_NONLOGGING_DIST_DATE"))) is not None:
        events.append((y, kind))
    if not events:
        return None, None, None
    y, kind = max(events)
    return (y, kind, y) if YEAR - y <= DEP_YEARS else (None, None, y)


def translate(p: dict) -> dict:
    poly = poly_of(p)
    species, conif, hard = composition(p) if poly in ("FOR", "TMS") else ("", 0, 0)
    dep, deptype, origin = disturbance(p)
    year = origin
    if year is None and poly in ("FOR", "TMS") and p.get("PROJ_AGE_1"):
        shot = year_of(p.get("PROJECTED_DATE")) or YEAR
        year = shot - int(p["PROJ_AGE_1"])
    bec = "".join(str(p.get(k) or "") for k in ("BEC_ZONE_CODE", "BEC_SUBZONE", "BEC_VARIANT")) or None
    # a shrub polygon's layer: its measured height and closure where the VRI
    # has them, else the class's (tall shrub is 2 m and up, low shrub under):
    # build_habitat's bush estimate reads a knee-high scrub as no wall
    ht = cc = None
    if poly in ("FOR", "TMS"):
        ht = round(float(p["PROJ_HEIGHT_1"]), 1) if p.get("PROJ_HEIGHT_1") else None
        cc = int(p["CROWN_CLOSURE"]) if p.get("CROWN_CLOSURE") is not None else None
    elif poly == "BSH":
        ht = round(float(p["SHRUB_HEIGHT"]), 1) if p.get("SHRUB_HEIGHT") else (3.0 if p.get("BCLCS_LEVEL_4") == "ST" else 1.0)
        cc = int(p["SHRUB_CROWN_CLOSURE"]) if p.get("SHRUB_CROWN_CLOSURE") is not None else None
    return {
        "group": group_of(poly, deptype, dep, conif, hard),
        "species": species,
        "year": year,
        "ht": ht,
        "cc": cc,
        "sc": None,  # the VRI's site index is in metres at 50 years, not the FRI's class (nothing reads it)
        "conif": conif,
        "hard": hard,
        "poly": poly,
        "dep": dep,
        "deptype": deptype,
        "eco": bec,
        "ref": year_of(p.get("REFERENCE_YEAR")),
    }


def area_m2(g) -> float:
    lat = (REGION["south"] + REGION["north"]) / 2
    import math

    return float(g.area) * 111_320 * 110_574 * math.cos(math.radians(lat))


def main() -> int:
    print("stands:")
    stands = [(g, translate(p)) for g, p in shapes(wfs(VRI, FIELDS), clip=REGION_BOX)]
    # the province's fires newer than a stand's photo: the burnt piece takes the fire
    print("later burns:")
    fires = []
    for g, p in shapes(wfs(FIRES, "FIRE_YEAR,FIRE_SIZE_HECTARES"), clip=REGION_BOX):
        y = year_of(p.get("FIRE_YEAR"))
        if y and YEAR - y <= DEP_YEARS:
            fires.append((y, g))
    fires.sort()
    out = []
    burnt = 0
    for g, props in stands:
        rest = g
        for y, fg in fires:
            if props["ref"] and y <= props["ref"]:
                continue  # the photo is newer: the stand already shows it
            if rest is None or not rest.intersects(fg):
                continue
            piece = rest.intersection(fg)
            if piece.is_empty or area_m2(piece) < MIN_PIECE_M2:
                continue
            q = {**props, "year": y, "dep": y, "deptype": "FIRE"}
            if q["poly"] not in ("WAT", "OMS", "RCK"):  # water, open fen and rock keep what they are
                q["group"] = group_of(q["poly"], "FIRE", y, q["conif"], q["hard"])
                burnt += 1
            out.append(feature(piece, {k: v for k, v in q.items() if k != "ref"}))
            rest = rest.difference(fg)
            if rest.is_empty:
                rest = None
        if rest is not None and not rest.is_empty:
            out.append(feature(rest, {k: v for k, v in props.items() if k != "ref"}))
    groups = Counter(f["properties"]["group"] for f in out)
    polys = Counter(f["properties"]["poly"] for f in out)
    leads = Counter((f["properties"]["species"] or "").split(" ")[0][:2] for f in out if f["properties"]["species"])
    refs = Counter(p["ref"] for _, p in stands)
    print(f"  groups: {dict(groups)}")
    print(f"  polygon types: {dict(polys)}")
    print(f"  lead species: {dict(leads.most_common())}")
    print(f"  photo years: {dict(sorted(refs.items()))}; {burnt} pieces burnt since")
    vintage = f"VRI, photos {min(refs)}-{max(refs)}, projected to {YEAR}" if refs else "VRI"
    write("forest", out, "VRI forest cover (BC)", "Vegetation Resources Inventory (VRI) forest cover, Province of British Columbia, with later fire perimeters laid over", vintage=vintage)
    return 0


if __name__ == "__main__":
    sys.exit(main())
