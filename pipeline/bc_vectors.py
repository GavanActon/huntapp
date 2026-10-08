"""British Columbia's vector layers for an area, in the normal forms the
app and the bakes read: the same file and property names the Ontario
adapter (build_vectors.py) takes straight off LIO. Everything comes from
the BC Geographic Warehouse's open WFS (bc_common.py), under the Open
Government Licence - British Columbia.

  waterbody-<id>.geojson    Freshwater Atlas lakes and rivers (double-line
                            rivers as polygons): WATERBODY_TYPE Lake | River,
                            OFFICIAL_NAME_LABEL, PERMANENCY
  watercourse-<id>.geojson  Freshwater Atlas stream network, the single-line
                            streams only (edge types 1000-1199; the skeleton
                            lines drawn through lakes and double-line rivers
                            are left out, the waterbodies have them):
                            WATERCOURSE_TYPE Stream, OFFICIAL_NAME_LABEL
  wetland-<id>.geojson      Freshwater Atlas wetlands: WETLAND_TYPE Unknown
                            (the atlas does not class them; the going bake
                            reads Unknown as swamp)
  roads-<id>.geojson        the Digital Road Atlas (every road, the resource
                            roads included): ROAD_NAME, KIND = class, surface;
                            and TRIM's trails (feature code DA25150000):
                            KIND trail
  fire-<id>.geojson         historical fire perimeters: FIRE_YEAR, FIRE_FINAL_SIZE
  wmu-<id>.geojson          wildlife management units: OFFICIAL_NAME '6-29'
  parks-<id>.geojson        parks, conservancies, ecological reserves and
                            protected areas: PROTECTED_AREA_NAME_ENG,
                            PROVINCIAL_PARK_CLASS_ENG (the designation), KIND
  crown-<id>.geojson        the map's "Private land": ParcelMap BC parcels
                            with a private (or mixed) owner, and Indian
                            reserves: OWNER_TYPE, PARCEL_NAME

    py -3.14 pipeline/bc_vectors.py --area blanchard-river           # every layer
    py -3.14 pipeline/bc_vectors.py --area blanchard-river fire wmu  # just these

Answers are cached under pipeline/raw/bc/<id>/, so a rerun asks nothing.
"""

from __future__ import annotations

import sys
from collections import Counter
from pathlib import Path

import shapely

sys.path.insert(0, str(Path(__file__).resolve().parent))
import area  # noqa: E402  (first: it takes --area out of argv)
from bc_common import box_of, feature, name_of, shapes, wfs, write, year_of  # noqa: E402
from common import REGION  # noqa: E402

if area.JURISDICTION != "BC":
    raise SystemExit(f"{REGION['name']} is in {area.JURISDICTION}: these are British Columbia's sources")

L = {
    "lakes": "WHSE_BASEMAPPING.FWA_LAKES_POLY",
    "rivers": "WHSE_BASEMAPPING.FWA_RIVERS_POLY",
    "streams": "WHSE_BASEMAPPING.FWA_STREAM_NETWORKS_SP",
    "wetlands": "WHSE_BASEMAPPING.FWA_WETLANDS_POLY",
    "dra": "WHSE_BASEMAPPING.DRA_DGTL_ROAD_ATLAS_MPAR_SP",
    "trim": "WHSE_BASEMAPPING.TRIM_TRANSPORTATION_LINES",
    "fire": "WHSE_LAND_AND_NATURAL_RESOURCE.PROT_HISTORICAL_FIRE_POLYS_SP",
    "wmu": "WHSE_WILDLIFE_MANAGEMENT.WAA_WILDLIFE_MGMT_UNITS_SVW",
    "parks": "WHSE_TANTALIS.TA_PARK_ECORES_PA_SVW",
    "parcels": "WHSE_CADASTRE.PMBC_PARCEL_FABRIC_POLY_SVW",
    "reserves": "WHSE_ADMIN_BOUNDARIES.CLAB_INDIAN_RESERVES",
}
# TRIM transportation feature codes that are a way through the bush and
# not in the road atlas: the trail code. (DA25xxxxxx roads are the atlas's
# ground; DD08/DD09/DD93 are pipelines, transmission lines and cut lines.)
TRIM_TRAILS = {"DA25150000": "trail"}
# the owner types that are not Crown land open to hunt on
PRIVATE_OWNERS = ("Private", "Mixed Ownership", "Federal", "Municipal")

REGION_BOX = shapely.box(*box_of())


def _title(s: str | None) -> str | None:
    s = name_of(s)
    return s.title().replace("'S ", "'s ") if s else None


def waterbody() -> None:
    out = []
    for g, p in shapes(wfs(L["lakes"], "GNIS_NAME_1,WATERBODY_TYPE,AREA_HA")):
        out.append(feature(g, {"WATERBODY_TYPE": "Lake", "OFFICIAL_NAME_LABEL": name_of(p.get("GNIS_NAME_1")), "PERMANENCY": "Permanent"}))
    for g, p in shapes(wfs(L["rivers"], "GNIS_NAME_1,WATERBODY_TYPE,AREA_HA")):
        out.append(feature(g, {"WATERBODY_TYPE": "River", "OFFICIAL_NAME_LABEL": name_of(p.get("GNIS_NAME_1")), "PERMANENCY": "Permanent"}))
    write("waterbody", out, "Freshwater Atlas lakes and rivers (BC)", "Freshwater Atlas lakes and rivers, Province of British Columbia")


def watercourse() -> None:
    out = []
    kinds: Counter = Counter()
    for g, p in shapes(wfs(L["streams"], "GNIS_NAME,EDGE_TYPE,FEATURE_SOURCE,STREAM_ORDER")):
        et = int(p.get("EDGE_TYPE") or 0)
        if not 1000 <= et < 1200:  # the skeletons through lakes, rivers and wetlands are not streams
            kinds["skeleton"] += 1
            continue
        kinds[et] += 1
        out.append(feature(g, {"WATERCOURSE_TYPE": "Stream", "OFFICIAL_NAME_LABEL": name_of(p.get("GNIS_NAME")), "PERMANENCY": "Intermittent" if et == 1100 else "Permanent", "STREAM_ORDER": p.get("STREAM_ORDER")}))
    print(f"  by edge type: {dict(kinds)}")
    write("watercourse", out, "Freshwater Atlas streams (BC)", "Freshwater Atlas stream network, single-line streams, Province of British Columbia")


def wetland() -> None:
    out = [feature(g, {"WETLAND_TYPE": "Unknown", "DOMINANT_VEG_FORM": None}) for g, p in shapes(wfs(L["wetlands"], "WATERBODY_TYPE,AREA_HA"))]
    write("wetland", out, "Freshwater Atlas wetlands (BC)", "Freshwater Atlas wetlands, Province of British Columbia; not classed (bog, fen, swamp alike)")


def roads() -> None:
    out = []
    kinds: Counter = Counter()
    for g, p in shapes(wfs(L["dra"], "ROAD_NAME_FULL,ROAD_CLASS,ROAD_SURFACE,FEATURE_TYPE")):
        kind = ", ".join(x for x in (name_of(p.get("ROAD_CLASS")), name_of(p.get("ROAD_SURFACE"))) if x and x != "unknown") or "road"
        kinds[kind] += 1
        out.append(feature(g, {"ROAD_NAME": name_of(p.get("ROAD_NAME_FULL")), "KIND": kind, "SURFACE_TYPE": name_of(p.get("ROAD_SURFACE"))}))
    for g, p in shapes(wfs(L["trim"], "FCODE")):
        kind = TRIM_TRAILS.get(p.get("FCODE") or "")
        if kind:
            kinds[kind] += 1
            out.append(feature(g, {"ROAD_NAME": None, "KIND": kind, "SURFACE_TYPE": None}))
    print(f"  by kind: {dict(kinds)}")
    write("roads", out, "Digital Road Atlas and TRIM trails (BC)", "Digital Road Atlas (every road, resource roads included) and TRIM trails, Province of British Columbia")


def fire() -> None:
    out = []
    for g, p in shapes(wfs(L["fire"], "FIRE_YEAR,FIRE_NUMBER,FIRE_SIZE_HECTARES,FIRE_CAUSE"), clip=REGION_BOX):
        y = year_of(p.get("FIRE_YEAR"))
        if y:
            out.append(feature(g, {"FIRE_YEAR": y, "FIRE_TYPE_CODE": None, "FIRE_FINAL_SIZE": round(float(p.get("FIRE_SIZE_HECTARES") or 0), 1)}))
    years = sorted({f["properties"]["FIRE_YEAR"] for f in out})
    print(f"  burns: {', '.join(map(str, years)) or 'none'}")
    write("fire", out, "Historical fire perimeters (BC Wildfire Service)", "Fire perimeters, historical, BC Wildfire Service, Province of British Columbia")


def wmu() -> None:
    out = []
    for g, p in shapes(wfs(L["wmu"], "WILDLIFE_MGMT_UNIT_ID,REGION_RESPONSIBLE_NAME,GAME_MANAGEMENT_ZONE_NAME")):
        if p.get("WILDLIFE_MGMT_UNIT_ID"):
            out.append(feature(g, {"OFFICIAL_NAME": str(p["WILDLIFE_MGMT_UNIT_ID"]), "REGION": name_of(p.get("REGION_RESPONSIBLE_NAME")), "GMZ": name_of(p.get("GAME_MANAGEMENT_ZONE_NAME"))}))
    print(f"  units: {', '.join(sorted(f['properties']['OFFICIAL_NAME'] for f in out))}")
    write("wmu", out, "Wildlife management units (BC)", "Wildlife Management Units, Province of British Columbia")


def parks() -> None:
    out = []
    for g, p in shapes(wfs(L["parks"], "PROTECTED_LANDS_NAME,PROTECTED_LANDS_CODE,PROTECTED_LANDS_DESIGNATION,PARK_CLASS"), clip=REGION_BOX):
        des = _title(p.get("PROTECTED_LANDS_DESIGNATION")) or "Protected area"
        out.append(feature(g, {"PROTECTED_AREA_NAME_ENG": _title(p.get("PROTECTED_LANDS_NAME")), "PROVINCIAL_PARK_CLASS_ENG": des + (f", class {p['PARK_CLASS']}" if p.get("PARK_CLASS") else ""), "KIND": des}))
    print("  " + (", ".join(f"{f['properties']['PROTECTED_AREA_NAME_ENG']} ({f['properties']['KIND']})" for f in out) or "none"))
    write("parks", out, "Parks, ecological reserves and protected areas (BC)", "Parks, conservancies, ecological reserves and protected areas (TANTALIS), Province of British Columbia")


def crown() -> None:
    out = []
    owners: Counter = Counter()
    for g, p in shapes(wfs(L["parcels"], "OWNER_TYPE,PARCEL_CLASS,PARCEL_NAME,PARCEL_STATUS"), clip=REGION_BOX):
        o = name_of(p.get("OWNER_TYPE")) or ""
        owners[o] += 1
        if o in PRIVATE_OWNERS:
            out.append(feature(g, {"OWNER_TYPE": o, "PARCEL_NAME": name_of(p.get("PARCEL_NAME"))}))
    for g, p in shapes(wfs(L["reserves"], "ENGLISH_NAME,CLAB_ID"), clip=REGION_BOX):
        owners["Indian reserve"] += 1
        out.append(feature(g, {"OWNER_TYPE": "Indian reserve", "PARCEL_NAME": name_of(p.get("ENGLISH_NAME"))}))
    print(f"  parcels by owner: {dict(owners)}; {len(out)} kept as not Crown")
    write("crown", out, "Private land: parcels not Crown, and Indian reserves (BC)", "ParcelMap BC parcels with a private, mixed, federal or municipal owner, and Indian reserves, Province of British Columbia")


THEMES = {"waterbody": waterbody, "watercourse": watercourse, "wetland": wetland, "roads": roads, "fire": fire, "wmu": wmu, "parks": parks, "crown": crown}


def main() -> int:
    asked = [a for a in sys.argv[1:] if not a.startswith("-")] or list(THEMES)
    for t in asked:
        if t not in THEMES:
            raise SystemExit(f"no layer {t!r}; the layers are {', '.join(THEMES)}")
    for t in asked:
        print(f"{t}:")
        THEMES[t]()
    return 0


if __name__ == "__main__":
    sys.exit(main())
