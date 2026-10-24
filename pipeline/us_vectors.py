"""A US area's vector layers, in the forms the app and the bakes read: the same
file and property names the Ontario adapter (build_vectors.py) takes off LIO.
Everything comes from open ArcGIS feature services, public domain or the
state's open data, read page by page over the region (build_property.arcgis)
and cached under pipeline/raw/property/<id>/.

  waterbody-<id>.geojson    NHDPlus HR waterbodies (lakes, ponds, reservoirs) and NHD areas
                            (double-line rivers): WATERBODY_TYPE Lake | Pond | River,
                            OFFICIAL_NAME_LABEL, PERMANENCY (intermittent from the FCode)
  watercourse-<id>.geojson  NHDPlus HR network flowlines, streams and rivers only (the
                            artificial paths through lakes are left out): WATERCOURSE_TYPE
                            Stream, OFFICIAL_NAME_LABEL, PERMANENCY
  wetland-<id>.geojson      National Wetlands Inventory: WETLAND_TYPE Swamp (forested and
                            shrub wetland), Marsh (emergent), Unknown (the rest); the open
                            water and pond classes are left out, the waterbodies have them
  roads-<id>.geojson        the state's framework roads (every public road) and the DNR's
                            forest roads: ROAD_NAME, KIND (highway | paved | road | trail by
                            class and surface; a forest access route is a trail),
                            SURFACE_TYPE, ORV (the DNR's open/closed word)
  wmu-<id>.geojson          the deer management unit: OFFICIAL_NAME 'DMU 043 Lake County'
  parks-<id>.geojson        PAD-US fee lands and the DNR's managed lands: state forest,
                            national forest, parks, game areas: PROTECTED_AREA_NAME_ENG, KIND
  land-<id>.geojson         who holds the land, the way build_property.py writes it (CLASS,
                            HUNT, NAME, SRC): Michigan has no open parcel layer, so the
                            region outside PAD-US and DNR lands is drawn as likely private
                            (HUNT permission); the public lands are left undrawn, as open
                            Crown land is

Michigan first (2026-10-23); the services are the state's where it has
them, so a second state adds its own entries to SERVICES.

    py -3.14 pipeline/us_vectors.py --area luther           # every layer
    py -3.14 pipeline/us_vectors.py --area luther roads wmu  # just these
"""
from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

import shapely
import shapely.ops

sys.path.insert(0, str(Path(__file__).resolve().parent))
import area  # noqa: E402  (first: it takes --area out of argv)
from build_property import E, N, S, W, arcgis, get_json  # noqa: E402
from common import OUT_DIR, REGION  # noqa: E402

ID = area.ID
J = area.JURISDICTION
PD = "public domain (US Government work)"
MI_OPEN = "Michigan open data (as is, no warranty)"

NWI = "https://fwspublicservices.wim.usgs.gov/wetlandsmapservice/rest/services/Wetlands/MapServer/0"
PADUS = "https://services.arcgis.com/v01gqwM5QqNysAAi/arcgis/rest/services/Fee_Managers_PADUS/FeatureServer/0"
MI = "https://services3.arcgis.com/Jdnp1TjADvSDxMAX/arcgis/rest/services"
SERVICES = {
    "MI": {
        "roads": "https://portal1-geo.sabu.mtu.edu/server/rest/services/Hosted/All_Roads__v17a_/FeatureServer/0",
        "dnr_roads": f"{MI}/DNR_ROADS/FeatureServer/0",
        "dmu": f"{MI}/WILDGameSpeciesManagementUnitsAndZonesOPENDATA/FeatureServer/3",
        "dnr_lands": f"{MI}/DNRLOTSParcelsOPENDATA/FeatureServer/2",
        "roads_attr": "USGS National Hydrography Dataset; Michigan Framework All Roads v17a (Michigan Tech), Michigan DNR roads",
    },
}
# a state with no services of its own gets the national fallbacks: TIGER's roads (every public road, by MTFCC
# class), PAD-US public land, and no hunting unit (name the zone in the area file by hand)
TIGER_ROADS = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Transportation/MapServer/8"
NATIONAL = {"roads": None, "dnr_roads": None, "dmu": None, "dnr_lands": None, "roads_attr": "US Census TIGER/Line roads"}
SVC = SERVICES.get(J, NATIONAL)
if J not in SERVICES:
    print(f"  {J}: no state services yet (us_vectors.py SERVICES): TIGER roads, PAD-US land, no hunting unit")
REGION_BOX = shapely.box(W, S, E, N)


def tiled(name: str, layer_url: str, fields: str = "*", n: int = 3, page: int = 500) -> list[dict]:
    """Every feature of an ArcGIS layer touching the region, the region asked as an n x n grid
    of envelopes (a server that errors past an offset, like the wetlands' at 2000, answers each
    small box whole), the features deduplicated by OBJECTID."""
    feats: dict = {}
    dw, dh = (E - W) / n, (N - S) / n
    for i in range(n):
        for j in range(n):
            w, s_, e, n_ = W + i * dw, S + j * dh, W + (i + 1) * dw, S + (j + 1) * dh
            offset = 0
            while True:
                jj = get_json(
                    f"{name}-{i}{j}-{offset}",
                    f"{layer_url}/query",
                    {
                        "where": "1=1",
                        "geometry": f"{w},{s_},{e},{n_}",
                        "geometryType": "esriGeometryEnvelope",
                        "inSR": "4326",
                        "spatialRel": "esriSpatialRelIntersects",
                        "outFields": fields,
                        "outSR": "4326",
                        "f": "geojson",
                        "resultOffset": str(offset),
                        "resultRecordCount": str(page),
                    },
                )
                got = jj.get("features") or []
                for f in got:
                    pr = f.get("properties") or {}
                    oid = f.get("id") or pr.get("OBJECTID") or pr.get("ObjectID") or pr.get("objectid") or pr.get("fid")
                    feats[oid if oid is not None else len(feats)] = f
                more = (jj.get("properties") or {}).get("exceededTransferLimit") or jj.get("exceededTransferLimit")
                if not got or not more:
                    break
                offset += len(got)
    print(f"  {name}: {len(feats)} features")
    return list(feats.values())


def shapes(feats: list[dict]):
    for f in feats:
        g = f.get("geometry")
        if not g:
            continue
        try:
            geom = shapely.geometry.shape(g)
        except Exception:  # noqa: BLE001
            continue
        if geom.is_empty:
            continue
        if not geom.is_valid:
            geom = shapely.make_valid(geom)
        yield geom, f.get("properties") or {}


def feature(g, props: dict) -> dict:
    return {"type": "Feature", "geometry": json.loads(shapely.to_geojson(g)), "properties": props}


def write(theme: str, feats: list[dict], name: str, source: str, licence: str = PD, **more) -> Path:
    path = OUT_DIR / f"{theme}-{ID}.geojson"
    path.write_text(json.dumps({"type": "FeatureCollection", "name": name, "features": feats}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    area.note_source(f"{theme}-{ID}.geojson", source=source, licence=licence, **more)
    print(f"  {len(feats)} features -> {path.name}")
    return path


def name_of(s) -> str | None:
    s = (s or "").strip()
    return s or None


# ---- water ------------------------------------------------------------------------------
# NHDPlus HR, read from the basin's GeoPackage (prd-tnm S3: Hydrography/NHDPlusHR/VPU/Current/GPKG/
# NHDPLUS_H_<HU4>_HU4_GPKG.zip, ~180 MB), downloaded beforehand into raw/us3dep/<stage>/nhd/: the
# hydro.nationalmap.gov feature services were not answering (2026-10-23). bake.us3dep.hu4 names the
# basin (0406, Pere Marquette-White, for Luther).

NHD_DIR = Path(__file__).resolve().parent / "raw" / "us3dep" / ((area.BAKE.get("us3dep") or {}).get("stage") or ID) / "nhd"


def nhd_layer(layer: str, columns: list[str]):
    """(geometry, properties) for the GeoPackage layer's features in the region."""
    import zipfile

    import pyogrio
    import shapely

    zips = sorted(NHD_DIR.glob("NHDPLUS_H_*_GPKG.zip"))
    if not zips:
        raise SystemExit(f"no NHDPlus HR GeoPackage in {NHD_DIR}: download the basin's zip from prd-tnm first")
    # every basin the region touches (TNM lists one GeoPackage per HU4; a box on a divide has two)
    for z in zips:
        with zipfile.ZipFile(z) as zf:
            for n in zf.namelist():
                if n.lower().endswith(".gpkg") and not (NHD_DIR / Path(n).name).exists():
                    zf.extract(n, NHD_DIR)
                    if Path(n).name != n:
                        (NHD_DIR / n).replace(NHD_DIR / Path(n).name)
    gpkgs = sorted(NHD_DIR.glob("*.gpkg"))
    out = []
    for path in gpkgs:
        info = pyogrio.read_info(str(path), layer=layer)
        have = {f.lower(): f for f in info["fields"]}
        cols = [have[c.lower()] for c in columns if c.lower() in have]
        meta, _, wkb, fields = pyogrio.raw.read(str(path), layer=layer, columns=cols, bbox=(W, S, E, N))
        names = list(meta["fields"])
        n0 = len(out)
        for i, g in enumerate(wkb):
            if g is None:
                continue
            geom = shapely.from_wkb(g)
            if geom.is_empty:
                continue
            if not geom.is_valid:
                geom = shapely.make_valid(geom)
            props = {c: (fields[names.index(have[c.lower()])][i] if c.lower() in have else None) for c in columns}
            out.append((geom, props))
        print(f"  {layer}: {len(out) - n0} features in the region from {path.name}")
    return out


def pyval(v):
    try:
        return v.item() if hasattr(v, "item") else v
    except Exception:  # noqa: BLE001
        return v


# NHD FCodes: 390xx lakes and ponds, 436xx reservoirs, 460xx streams, 558xx artificial paths,
# 336xx canals; x01/x04 intermittent in each series
def permanency(fcode: int) -> str:
    return "Intermittent" if fcode in (39004, 39001, 46003, 46007) else "Permanent"


def waterbody() -> None:
    out = []
    kinds: Counter = Counter()
    for g, p in nhd_layer("NHDWaterbody", ["GNIS_Name", "FType", "FCode", "AreaSqKm"]):
        ft = int(pyval(p.get("FType")) or 0)
        if ft == 466:  # swamp/marsh: the wetlands have them
            kinds["swamp"] += 1
            continue
        big = float(pyval(p.get("AreaSqKm")) or 0) >= 0.08
        wt = "Lake" if ft in (390, 436) and big else "Pond" if ft in (390, 436) else None
        if not wt:
            kinds[ft] += 1
            continue
        kinds[wt] += 1
        out.append(feature(g, {"WATERBODY_TYPE": wt, "OFFICIAL_NAME_LABEL": name_of(pyval(p.get("GNIS_Name"))), "PERMANENCY": permanency(int(pyval(p.get("FCode")) or 0))}))
    for g, p in nhd_layer("NHDArea", ["GNIS_Name", "FType", "FCode"]):
        if int(pyval(p.get("FType")) or 0) != 460:  # stream/river areas only (not rapids, inundation areas)
            continue
        kinds["River area"] += 1
        out.append(feature(g, {"WATERBODY_TYPE": "River", "OFFICIAL_NAME_LABEL": name_of(pyval(p.get("GNIS_Name"))), "PERMANENCY": "Permanent"}))
    print(f"  by kind: {dict(kinds)}")
    write("waterbody", out, "NHDPlus HR waterbodies", "NHDPlus High Resolution waterbodies and river areas, USGS")


def watercourse() -> None:
    out = []
    kinds: Counter = Counter()
    for g, p in nhd_layer("NHDFlowline", ["GNIS_Name", "FType", "FCode", "LengthKM"]):
        ft = int(pyval(p.get("FType")) or 0)
        if ft != 460:  # 558 artificial paths through lakes, 336 canals, 428 pipelines: not streams
            kinds[ft] += 1
            continue
        kinds["Stream"] += 1
        out.append(feature(g, {"WATERCOURSE_TYPE": "Stream", "OFFICIAL_NAME_LABEL": name_of(pyval(p.get("GNIS_Name"))), "PERMANENCY": permanency(int(pyval(p.get("FCode")) or 0))}))
    print(f"  by kind: {dict(kinds)}")
    write("watercourse", out, "NHDPlus HR streams", "NHDPlus High Resolution network flowlines, streams and rivers, USGS")


# NWI Cowardin codes: P (palustrine) FO forested, SS scrub-shrub, EM emergent, UB unconsolidated bottom (open water), AB aquatic bed
def wetland() -> None:
    out = []
    kinds: Counter = Counter()
    for g, p in shapes(tiled("nwi", NWI, "OBJECTID,ATTRIBUTE,WETLAND_TYPE,ACRES", n=8, page=250)):
        code = str(p.get("ATTRIBUTE") or "")
        wtype = str(p.get("WETLAND_TYPE") or "")
        if code[:1] in ("L", "R") or code[1:3] in ("UB", "AB") or "Pond" in wtype or "Lake" in wtype or "Riverine" in wtype:
            kinds["open water"] += 1
            continue
        t = "Swamp" if code[1:3] in ("FO", "SS") else "Marsh" if code[1:3] == "EM" else "Unknown"
        kinds[t] += 1
        out.append(feature(g, {"WETLAND_TYPE": t, "DOMINANT_VEG_FORM": None, "NWI": code}))
    print(f"  by type: {dict(kinds)}")
    write("wetland", out, "National Wetlands Inventory", "National Wetlands Inventory, US Fish and Wildlife Service: forested and shrub wetland as swamp, emergent as marsh")


# ---- roads ----------------------------------------------------------------------------

# Michigan Framework NFC (national functional class): 1 interstate, 2 freeway, 3 principal arterial,
# 4 minor arterial, 5 major collector, 6 minor collector, 7 local; the framework carries no surface
def road_kind_mi(p: dict) -> tuple[str, str | None]:
    nfc = int(p.get("nfc") or 7)
    if nfc <= 2:
        return "highway", "Paved"
    if nfc <= 5:
        return "paved", "Paved"
    return "road", None


# TIGER MTFCC: S1100 primary, S1200 secondary, S1400 local, S1500 vehicular trail (4WD), S1630 ramp, S1740 private, S1780 parking
def road_kind_tiger(p: dict) -> tuple[str, str | None]:
    m = str(p.get("MTFCC") or "")
    if m == "S1100":
        return "highway", "Paved"
    if m in ("S1200", "S1630"):
        return "paved", "Paved"
    if m in ("S1500",):
        return "trail", None
    return "road", None


def roads() -> None:
    out = []
    kinds: Counter = Counter()
    seen = []
    if not SVC.get("roads"):
        for g, p in shapes(tiled("tiger-roads", TIGER_ROADS, "OBJECTID,FULLNAME,MTFCC", n=2, page=1000)):
            kind, surface = road_kind_tiger(p)
            kinds[kind] += 1
            out.append(feature(g, {"ROAD_NAME": name_of(p.get("FULLNAME")), "KIND": kind, "SURFACE_TYPE": surface}))
        print(f"  by kind: {dict(kinds)}")
        write("roads", out, "Roads (TIGER)", SVC["roads_attr"])
        return
    for g, p in shapes(tiled("roads", SVC["roads"], "fid,name,fetype,fcc,nfc,legalsyste", n=2, page=1000)):
        kind, surface = road_kind_mi(p)
        kinds[kind] += 1
        out.append(feature(g, {"ROAD_NAME": name_of(" ".join(str(p.get(k) or "") for k in ("name", "fetype")).strip()), "KIND": kind, "SURFACE_TYPE": surface}))
        seen.append(g)
    tree = shapely.STRtree(seen) if seen else None
    for g, p in shapes(arcgis("dnr-roads", SVC["dnr_roads"], "OBJECTID,RoadPrimary,RoadType,SurfaceType,ORVStatus,RoadORVUse", page=1000)) if SVC.get("dnr_roads") else []:
        rt = str(p.get("RoadType") or "")
        st = str(p.get("SurfaceType") or "")
        kind = "trail" if "Access Route" in rt or "Admin" in rt else "paved" if "Paved" in st or "Asphalt" in st else "road"
        # the framework has the public forest roads already: a DNR line within 15 m of one is the same road
        if tree is not None and kind != "trail":
            near = tree.query(g.buffer(0.00015))
            if any(seen[i].intersects(g.buffer(0.00015)) for i in near):
                kinds["dnr (in the framework)"] += 1
                continue
        kinds[f"dnr {kind}"] += 1
        out.append(feature(g, {"ROAD_NAME": None, "KIND": kind, "SURFACE_TYPE": st or None, "ORV": name_of(p.get("RoadORVUse")) or name_of(p.get("ORVStatus")), "DNR": name_of(p.get("RoadPrimary"))}))
    print(f"  by kind: {dict(kinds)}")
    write("roads", out, "Roads and forest roads", SVC["roads_attr"], MI_OPEN)


# ---- units and public land ------------------------------------------------------------------

def wmu() -> None:
    out = []
    if not SVC.get("dmu"):
        print("  no hunting-unit service for this state: no wmu file (set zone.name in the area file)")
        return
    for g, p in shapes(arcgis("dmu", SVC["dmu"], "OBJECTID,DeerManagementUnit,MangementUnitName,Year")):
        num = str(p.get("DeerManagementUnit") or p.get("DMU") or "").strip()
        nm = str(p.get("MangementUnitName") or p.get("DMU_Name") or "").strip()
        # the normal form the app and regs.ts read: 'DMU 043' (the zone's name is the number; its county rides along)
        label = f"DMU {num.zfill(3) if num.isdigit() else num}" if num else nm
        out.append(feature(g, {"OFFICIAL_NAME": label, "COUNTY": nm or None, "YEAR": p.get("Year")}))
    write("wmu", out, "Deer management units", "Deer Management Units, Michigan DNR", MI_OPEN)


def public() -> list[tuple[shapely.Geometry, dict]]:
    """PAD-US fee lands and the DNR's managed lands over the region: (geometry, name, kind, manager)."""
    out = []
    for g, p in shapes(arcgis("padus", PADUS, "Unit_Nm,Des_Tp,Mang_Name,Mang_Type,Own_Type,Pub_Access,GAP_Sts", page=1000)):
        out.append((g, {"name": p.get("Unit_Nm"), "kind": p.get("Des_Tp"), "manager": p.get("Mang_Name"), "access": p.get("Pub_Access"), "src": "PAD-US"}))
    for g, p in shapes(tiled("dnr-lands", SVC["dnr_lands"], "ObjectID,ParcelType,LandStatus,ProjectName,DivisionDepartment", n=2, page=1000)) if SVC.get("dnr_lands") else []:
        out.append((g, {"name": p.get("ProjectName"), "kind": p.get("ParcelType") or "DNR managed land", "manager": p.get("DivisionDepartment"), "access": None, "src": "Michigan DNR LOTS"}))
    return out


def parks() -> None:
    out = []
    for g, p in public():
        out.append(feature(g, {"PROTECTED_AREA_NAME_ENG": name_of(p["name"]) or p["kind"], "KIND": p["kind"], "MANAGER": p["manager"], "ACCESS": p["access"], "SRC": p["src"]}))
    write("parks", out, "Public lands", "PAD-US fee lands, USGS; DNR managed lands, Michigan DNR", f"{PD}; {MI_OPEN}")


def land() -> None:
    """Michigan has no open parcels: the region outside the public lands is likely private (ask
    permission), the way Alberta's White Area is drawn. Closed public land (no public access in
    PAD-US) is drawn as closed."""
    pub = []
    closed = []
    for g, p in public():
        if (p["access"] or "").startswith("Closed"):
            closed.append((g, p))
        pub.append(g)
    union = shapely.unary_union(pub) if pub else shapely.Polygon()
    private = REGION_BOX.difference(union)
    feats = []
    for g in (private.geoms if hasattr(private, "geoms") else [private]):
        if g.is_empty or g.area < 1e-8:
            continue
        feats.append(feature(g, {"CLASS": "likely-private", "HUNT": "permission", "NAME": None, "SRC": "outside PAD-US fee lands and DNR managed lands"}))
    for g, p in closed:
        feats.append(feature(g, {"CLASS": "closed", "HUNT": "no", "NAME": name_of(p["name"]), "SRC": p["src"]}))
    write("land", feats, "Who holds the land", "likely private: everything outside PAD-US fee lands and Michigan DNR managed lands; closed: PAD-US lands with no public access", f"{PD}; {MI_OPEN}")


THEMES = {"waterbody": waterbody, "watercourse": watercourse, "wetland": wetland, "roads": roads, "wmu": wmu, "parks": parks, "land": land}


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
