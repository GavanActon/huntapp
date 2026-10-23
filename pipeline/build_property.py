"""Property lines for an area: whose land it is, as far as open data can say,
and the lot lines, for the map's land layers. One script for every province,
because the federal sources (NRCan's reserves and national parks) are shared.

  land-<id>.geojson  polygons, one per holding or designation:
      CLASS  private | other-gov | federal | municipal | reserve |
             settlement-a | settlement-b | settlement-fs | crown-lease |
             closed | restricted | likely-private
      HUNT   no | permission | rules | open | ask (fixed by the class: HUNT_OF)
      NAME   a short name, or ""
      SRC    a short source tag: "LIO patent", "ParcelMap BC", "GeoYukon",
             "ATS+green/white", "NRCan" ...
  lots-<id>.geojson  lot and parcel outlines: LABEL ("Lot 5, Con 3, Jarvis", a
      BC PID or plan, a Yukon parcel designator, an Alberta "NE 12-36-8-W5")
      and SRC, and ACC "100 m" on Ontario's lot fabric

Crown land open to hunt on is what is left: nothing is drawn there.

  ON  LIO (OGL-Ontario): Patent Land split by title holder, provincial parks,
      conservation reserves, Crown game preserves, federal land, Crown
      leases, licences of occupation and land use permits; lots from Lot
      Fabric Improved (within 100 m)
  BC  the BC Geographic Warehouse (OGL-BC): ParcelMap BC parcels by owner
      type (and as lots), parks, conservancies, wildlife management areas,
      Crown tenures
  YT  GeoYukon (OGL-Yukon; the parcels and settlement land are also credited
      OGL-Canada): First Nation settlement land, the Wildlife Act sanctuaries,
      territorial parks, leases; lots from the surveyed parcels. A BC box
      that runs north of 60° (Blanchard River) gets these north of the line.
  AB  geospatial.alberta.ca (OGL-Alberta): parks and protected areas, Métis
      settlements, and the White Area quarter sections no public layer
      covers, as likely private; lots are the ATS v4.1 quarter sections
  QC  the TRQ territories (CC BY 4.0) read for hunting: ZECs, outfitters
      with exclusive rights, wildlife reserves and the rest; no lots
  all NRCan's Aboriginal Lands and National Parks (OGL-Canada)

Only open data, and never an owner: not Quebec's cadastre (no licence),
Clearwater County's parcels or anything else from AltaLIS, or Alberta's
grazing leases (licence unclear), and no holder's or site's name off a
disposition. The research behind every choice is the property-lines
report (2026-10-18).

Every feature is cut to the region box (NRCan's service answers with
features outside the envelope it was asked for) and simplified to about a
metre. A source that cannot be fetched fails the run and nothing is
written, so a bake never ships half the land; the answers are cached
(pipeline/raw/property/<id>/, and the province adapters' own caches), so a
rerun asks only for what failed.

    py -3.14 pipeline/build_property.py --area searchmont
"""

from __future__ import annotations

import hashlib
import json
import math
import re
import sys
import time
import urllib.parse
import urllib.request
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

import shapely
import shapely.geometry

sys.path.insert(0, str(Path(__file__).resolve().parent))
import area  # noqa: E402  (first: it takes --area out of argv)
from common import CACHE_DIR, OUT_DIR, REGION  # noqa: E402

ID = area.ID
J = area.JURISDICTION
W, S, E, N = REGION["west"], REGION["south"], REGION["east"], REGION["north"]
SIMPLIFY_DEG = 0.00001  # about a metre
CACHE = CACHE_DIR / "property" / ID
UA = {"User-Agent": "huntapp-pipeline/1.0 (area bake)"}
YT_LINE = 60.0  # the BC-Yukon border

OGL_ON, OGL_BC, OGL_YT, OGL_AB, OGL_CA, CC_BY = "OGL-Ontario", "OGL-BC", "OGL-Yukon", "OGL-Alberta", "OGL-Canada", "CC BY 4.0"

HUNT_OF = {
    "private": "permission",
    "other-gov": "ask",
    "federal": "ask",
    "municipal": "ask",
    "reserve": "permission",
    "settlement-a": "permission",
    "settlement-b": "ask",
    "settlement-fs": "permission",
    "crown-lease": "ask",
    "closed": "no",
    "restricted": "rules",
    "likely-private": "permission",
}


@dataclass(frozen=True)
class Src:
    tag: str  # SRC on the features
    source: str  # the provenance note's words
    licence: str


LIO_PATENT = Src("LIO patent", "Patent Land External (Crown vs patent, by title holder type), LIO", OGL_ON)
LIO_PARKS = Src("LIO parks", "Provincial Park Regulated, LIO", OGL_ON)
LIO_CR = Src("LIO conservation reserves", "Conservation Reserve Regulated, LIO", OGL_ON)
LIO_CGP = Src("LIO game preserves", "Crown Game Preserve, LIO", OGL_ON)
LIO_FED = Src("LIO federal land", "Federal Land Other, National Wildlife Area and Federal Protected Area, LIO", OGL_ON)
LIO_DISP = Src("LIO dispositions", "Crown Land, MNR Non-Freehold Dispositions (leases, licences of occupation, land use permits; no holders), LIO", OGL_ON)
LIO_LOTS = Src("LIO lot fabric", "Lot Fabric Improved (original Crown survey lots, within 100 m), LIO", OGL_ON)
NRCAN = Src("NRCan", "Aboriginal Lands of Canada and National Parks legislative boundaries, NRCan Surveyor General (CLSS)", OGL_CA)
PMBC = Src("ParcelMap BC", "ParcelMap BC parcel fabric, public view (owner type only, no names), LTSA via DataBC", OGL_BC)
BC_PARKS = Src("BC parks", "Parks, ecological reserves, protected areas, conservancies and wildlife management areas (TANTALIS), Province of British Columbia", OGL_BC)
BC_TENURES = Src("BC tenures", "Crown tenures: leases and site licences (TANTALIS; no holders), Province of British Columbia", OGL_BC)
GY_SETTLEMENT = Src("GeoYukon", "First Nation Settlement Lands, GeoYukon", f"{OGL_YT}; {OGL_CA}")
GY_SANCTUARY = Src("GeoYukon", "Orders in Council under the Wildlife Act (wildlife sanctuaries), GeoYukon", OGL_YT)
GY_PARKS = Src("GeoYukon", "Parks and Protected Areas 250k, GeoYukon", OGL_YT)
GY_LEASES = Src("GeoYukon", "Land Dispositions: leases and agreements for sale (no holders), GeoYukon", OGL_YT)
GY_PARCELS = Src("GeoYukon", "Land Parcels Polygon - Surveyed, GeoYukon", f"{OGL_YT}; {OGL_CA}")
AB_PARKS = Src("AB parks", "Parks and Protected Areas of Alberta", OGL_AB)
AB_METIS = Src("AB Metis settlements", "Metis Settlements, Government of Alberta", OGL_AB)
AB_LIKELY = Src("ATS+green/white", "White Area quarter sections no public layer covers (ATS v4.1 and Green/White Area), Government of Alberta", OGL_AB)
AB_ATS = Src("ATS v4.1", "Alberta Township System v4.1 quarter sections, Government of Alberta", OGL_AB)
QC_TRQ = Src("TRQ", "Territoires récréatifs du Québec (TRQ), MRNF", CC_BY)


# ---- what the files collect ---------------------------------------------------


class Collect:
    def __init__(self) -> None:
        self.land: list[tuple[shapely.Geometry, dict]] = []
        self.lots: list[tuple[shapely.Geometry, dict]] = []
        self.land_src: dict[str, str] = {}
        self.lots_src: dict[str, str] = {}

    def add_land(self, g, cls: str, name: str | None, src: Src) -> None:
        if g is None:
            return
        self.land.append((g, {"CLASS": cls, "HUNT": HUNT_OF[cls], "NAME": name or "", "SRC": src.tag}))
        self.land_src[src.source] = src.licence

    def add_lot(self, g, label: str | None, src: Src, acc: str | None = None) -> None:
        if g is None:
            return
        p = {"LABEL": label or "", "SRC": src.tag}
        if acc:
            p["ACC"] = acc
        self.lots.append((g, p))
        self.lots_src[src.source] = src.licence


OUT = Collect()


def polygonal(g):
    """The polygons in g (a cut or make_valid can leave lines and points), or None."""
    if g is None or g.is_empty:
        return None
    if g.geom_type in ("Polygon", "MultiPolygon"):
        return g
    parts = [p for p in shapely.get_parts(g) if p.geom_type in ("Polygon", "MultiPolygon")]
    return shapely.union_all(parts) if parts else None


def cut(geometry, box: tuple[float, float, float, float]):
    """A GeoJSON geometry (or a shapely one) made valid, cut to the box,
    simplified to about a metre, on a 1e-6° grid; None when nothing
    polygonal is left."""
    if not geometry:
        return None
    g = geometry if isinstance(geometry, shapely.Geometry) else shapely.geometry.shape(geometry)
    if g.is_empty:
        return None
    if not g.is_valid:
        g = shapely.make_valid(g)
    g = polygonal(shapely.clip_by_rect(g, *box))
    if g is None:
        return None
    g = shapely.simplify(g, SIMPLIFY_DEG, preserve_topology=True)
    g = shapely.set_precision(g, 0.000001)
    if not g.is_valid:
        g = shapely.make_valid(g)
    g = polygonal(g)
    return None if g is None or g.area < 1e-10 else g  # under about a square metre


def m2(g) -> float:
    """A lon/lat area in square metres, near enough at the region's latitude."""
    lat = math.radians((S + N) / 2)
    return g.area * 111_320 * math.cos(lat) * 110_574


def text(v) -> str | None:
    if v is None:
        return None
    v = str(v).strip()
    return v if v and v.lower() not in ("null", "none", "nan") else None


def title(s: str | None) -> str | None:
    """'WABOS NORTH CONSERVATION RESERVE' -> 'Wabos North Conservation Reserve'."""
    if not s:
        return s
    t = s.title()
    t = re.sub(r"'S\b", "'s", t)
    return re.sub(r"(?<=\s)(Of|And|The|De|Du|Des|La|Le)\b", lambda m: m.group(1).lower(), t)


# ---- a plain ArcGIS fetch, cached (NRCan, Alberta) --------------------------------


def get_json(name: str, url: str, params: dict) -> dict:
    key = hashlib.sha1((url + "?" + urllib.parse.urlencode(sorted(params.items()))).encode()).hexdigest()[:12]
    path = CACHE / f"{name}-{key}.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    full = url + "?" + urllib.parse.urlencode(params)
    for wait in (5, 15, 30, 60, 120, None):
        try:
            with urllib.request.urlopen(urllib.request.Request(full, headers=UA), timeout=240) as r:
                body = r.read()
            j = json.loads(body)
            if "error" in j:
                raise RuntimeError(j["error"])
            CACHE.mkdir(parents=True, exist_ok=True)
            path.write_bytes(body)
            return j
        except Exception as e:  # noqa: BLE001
            if wait is None:
                raise SystemExit(f"{name}: the server would not answer ({str(e)[:160]})") from e
            print(f"  {name}: {str(e)[:100]}; again in {wait} s")
            time.sleep(wait)
    raise AssertionError("unreachable")


def arcgis(name: str, layer_url: str, fields: str = "*", where: str = "1=1", page: int = 1000) -> list[dict]:
    """Every feature of an ArcGIS layer touching the region, as GeoJSON in
    lon/lat, page by page."""
    feats: list[dict] = []
    offset = 0
    while True:
        j = get_json(
            f"{name}-{offset}",
            f"{layer_url}/query",
            {
                "where": where,
                "geometry": f"{W},{S},{E},{N}",
                "geometryType": "esriGeometryEnvelope",
                "inSR": "4326",
                "spatialRel": "esriSpatialRelIntersects",
                "outFields": fields,
                "outSR": "4326",
                "orderByFields": "OBJECTID",
                "f": "geojson",
                "resultOffset": str(offset),
                "resultRecordCount": str(page),
            },
        )
        got = j.get("features") or []
        feats.extend(got)
        more = (j.get("properties") or {}).get("exceededTransferLimit") or j.get("exceededTransferLimit")
        if not got or not more:
            break
        offset += len(got)
    print(f"  {name}: {len(feats)} features")
    return feats


# ---- federal, every province --------------------------------------------------------

CLSS = "https://proxyinternet.nrcan-rncan.gc.ca/arcgis/rest/services/CLSS-SATC/CLSS_Administrative_Boundaries/MapServer"


def federal(box) -> None:
    """Indian reserves and the other Aboriginal lands (Cree-Naskapi 1A,
    Sechelt, the NWT claims) as reserve, and national parks as closed.
    Yukon settlement land comes from GeoYukon instead, which has the
    category and the unsurveyed parcels this layer leaves out."""
    for f in arcgis("nrcan-aboriginal", f"{CLSS}/0", "adminAreaNameEng,distributionType,distributionTypeEng,jurisdiction", page=500):
        p = f.get("properties") or {}
        if p.get("distributionType") == "YFN":
            continue
        OUT.add_land(cut(f.get("geometry"), box), "reserve", title(text(p.get("adminAreaNameEng"))), NRCAN)
    # hunting is barred in national parks (some allow it to Indigenous harvesters only)
    for f in arcgis("nrcan-parks", f"{CLSS}/1", "adminAreaNameEng", page=500):
        OUT.add_land(cut(f.get("geometry"), box), "closed", title(text((f.get("properties") or {}).get("adminAreaNameEng"))), NRCAN)


# ---- Ontario ------------------------------------------------------------------------

PATENT_CLASS = {
    "Private": "private",
    "Other Provincial Government Agency": "other-gov",  # highways, hydro, other ministries: not MNR Crown land, not private
    "Federal Government": "federal",
    "Municipal Government": "municipal",
}
# Non-freehold dispositions kept as leases: an easement (a hydro line, a
# road across Crown land) does not keep anyone off the ground around it
DISPOSITION_KEEP = ("lease", "licence of occupation", "land use permit")


def park_name(s: str | None) -> str | None:
    """'GOULAIS RIVER PROVINCIAL PARK (WATERWAY CLASS)' -> 'Goulais River Provincial Park'."""
    return title(re.sub(r"\s*\([^)]*CLASS\)\s*$", "", s or "", flags=re.I)) or None


def ontario(box) -> None:
    from build_vectors import fetch_layer

    def lio(service: str, layer: int, fields: str, where: str = "1=1") -> list[dict]:
        return fetch_layer(service, layer, where, fields)["features"]

    holders: Counter = Counter()
    for f in lio("LIO_Open08", 35, "TITLE_HOLDER_TYPE"):
        h = text((f.get("properties") or {}).get("TITLE_HOLDER_TYPE"))
        holders[h] += 1
        OUT.add_land(cut(f.get("geometry"), box), PATENT_CLASS.get(h or "", "private"), "", LIO_PATENT)  # patent land with no holder type is still patent land
    print(f"  patent land by title holder: {dict(holders)}")

    # Hunting is barred in a provincial park unless O. Reg. 663/98 (Fish and
    # Wildlife Conservation Act) opens the park or part of it: some are
    # opened, so a park's name should be checked against the regulation's
    # list before a hunter is told no. Not yet done for any park here
    # (Goulais River at Searchmont, White Lake Peatlands at Pickle Lake).
    for f in lio("LIO_Open03", 4, "PROTECTED_AREA_NAME_ENG,PROVINCIAL_PARK_CLASS_ENG"):
        OUT.add_land(cut(f.get("geometry"), box), "closed", park_name((f.get("properties") or {}).get("PROTECTED_AREA_NAME_ENG")), LIO_PARKS)
    # hunting is allowed in conservation reserves (Provincial Parks and
    # Conservation Reserves Act): marked so their own rules get a look
    for f in lio("LIO_Open03", 2, "PROTECTED_AREA_NAME_ENG"):
        OUT.add_land(cut(f.get("geometry"), box), "restricted", title(text((f.get("properties") or {}).get("PROTECTED_AREA_NAME_ENG"))), LIO_CR)
    for f in lio("LIO_Open05", 7, "OFFICIAL_NAME"):
        n = title(text((f.get("properties") or {}).get("OFFICIAL_NAME")))
        OUT.add_land(cut(f.get("geometry"), box), "closed", n if not n or "preserve" in n.lower() else f"{n} Crown Game Preserve", LIO_CGP)
    # federal land: other federal land, national wildlife areas, federal protected areas (canals, historic sites)
    for service, layer in (("LIO_Open06", 0), ("LIO_Open03", 9), ("LIO_Open03", 10)):
        for f in lio(service, layer, "OFFICIAL_NAME"):
            OUT.add_land(cut(f.get("geometry"), box), "federal", title(text((f.get("properties") or {}).get("OFFICIAL_NAME"))), LIO_FED)
    # leases, licences of occupation and land use permits on Crown land,
    # named by their purpose: the site name is often the holder's
    kinds: Counter = Counter()
    for f in lio("LIO_Open08", 33, "CLASS_SUBTYPE,PURPOSE_OF_DISPOSITION"):
        p = f.get("properties") or {}
        sub = text(p.get("CLASS_SUBTYPE")) or ""
        kinds[sub] += 1
        if any(k in sub.lower() for k in DISPOSITION_KEEP):
            purpose = text(p.get("PURPOSE_OF_DISPOSITION"))
            what = re.sub(r"^Crown Disposition\s*", "", sub)
            OUT.add_land(cut(f.get("geometry"), box), "crown-lease", purpose or what, LIO_DISP)
    print(f"  dispositions by kind: {dict(kinds)} (easements left out)")

    # the original Crown survey's lots and concessions (and sections in the
    # sectional townships), within 100 m: "Lot 5, Con 3, Jarvis"
    for f in lio("LIO_Open06", 2, "LOT_IDENT,CONCESSION_IDENT,GEOGRAPHIC_TOWNSHIP_NAME,LOCATION_ACCURACY"):
        p = f.get("properties") or {}
        parts = [title(text(p.get("LOT_IDENT"))), title(text(p.get("CONCESSION_IDENT"))), title(text(p.get("GEOGRAPHIC_TOWNSHIP_NAME")))]
        label = ", ".join(x for x in parts if x)
        m = re.search(r"(\d+)\s*met", text(p.get("LOCATION_ACCURACY")) or "")
        OUT.add_lot(cut(f.get("geometry"), box), label, LIO_LOTS, f"{m.group(1)} m" if m else "100 m")


# ---- British Columbia -----------------------------------------------------------------

# ParcelMap BC's OWNER_TYPE: Crown Provincial and Untitled Provincial are
# Crown land (not drawn), Unclassified says nothing either way (left out of
# the land, kept as a lot). "Local Government" is the municipal value
# (bc_vectors.py's "Municipal" matches nothing), and First Nations parcels
# are treaty land, permission needed (the treaty layer itself is Access Only).
BC_OWNER_CLASS = {
    "Private": "private",
    "Mixed Ownership": "private",
    "Local Government": "municipal",
    "Federal": "federal",
    "Crown Agency": "other-gov",
    "First Nations": "reserve",
}
BC_NOT_LOTS = ("interest", "air space", "covenant", "right of way", "road")
# A Crown lease or a site licence (a hunt camp, a lodge) is ground someone
# holds. The extensive commercial-recreation licences that cover whole
# valleys (heli-skiing, guiding, "multiple use") hold nobody off the land
# and would paint the region; nor do rights-of-way and reserve notations.
BC_EXTENSIVE_HA = 100
# The public view is reloaded every Sunday, and while it loads the WFS
# answers from a part of it: 139 thousand parcels of 2.6 million on
# 2026-10-18, none at Blanchard River. bc_common caches whatever it gets,
# so the parcels are not asked for until the whole province is back.
PMBC_LAYER = "WHSE_CADASTRE.PMBC_PARCEL_FABRIC_POLY_SVW"
PMBC_WHOLE = 2_000_000


def parcelmap_loaded() -> None:
    from bc_common import WFS

    q = {"service": "WFS", "version": "2.0.0", "request": "GetFeature", "typeName": f"pub:{PMBC_LAYER}", "resultType": "hits"}
    for wait in (5, 15, 30, None):
        try:
            with urllib.request.urlopen(urllib.request.Request(f"{WFS}?{urllib.parse.urlencode(q)}", headers=UA), timeout=120) as r:
                m = re.search(r'numberMatched="(\d+)"', r.read().decode("utf-8", "replace"))
            break
        except Exception as e:  # noqa: BLE001
            if wait is None:
                raise SystemExit(f"ParcelMap BC: the server would not answer ({str(e)[:120]})") from e
            time.sleep(wait)
    have = int(m.group(1)) if m else 0
    if have < PMBC_WHOLE:
        raise SystemExit(f"ParcelMap BC holds {have:,} parcels just now, not the province's 2.6 million: it is being reloaded (Sundays); run this again later")


def bc(box) -> None:
    from bc_common import wfs

    parcelmap_loaded()
    owners: Counter = Counter()
    for f in wfs(PMBC_LAYER, "OWNER_TYPE,PARCEL_CLASS,PARCEL_STATUS,PARCEL_NAME,PLAN_NUMBER,PID_FORMATTED"):
        p = f.get("properties") or {}
        if (text(p.get("PARCEL_STATUS")) or "Active") != "Active":
            continue
        g = cut(f.get("geometry"), box)
        if g is None:
            continue
        o = text(p.get("OWNER_TYPE")) or ""
        owners[o] += 1
        if o in BC_OWNER_CLASS:
            OUT.add_land(g, BC_OWNER_CLASS[o], "", PMBC)
        cls = (text(p.get("PARCEL_CLASS")) or "").lower()
        if any(k in cls for k in BC_NOT_LOTS):
            continue
        pid, plan, pin = text(p.get("PID_FORMATTED")), text(p.get("PLAN_NUMBER")), text(p.get("PARCEL_NAME"))
        OUT.add_lot(g, f"PID {pid}" if pid else f"Plan {plan}" if plan else f"PIN {pin}" if pin else None, PMBC)
    print(f"  parcels by owner type: {dict(owners)}")

    # BC parks are not closed to hunting as such (Tatshenshini-Alsek allows it
    # in season): their own rules. Ecological reserves are closed.
    for f in wfs("WHSE_TANTALIS.TA_PARK_ECORES_PA_SVW", "PROTECTED_LANDS_NAME,PROTECTED_LANDS_DESIGNATION"):
        p = f.get("properties") or {}
        des = (text(p.get("PROTECTED_LANDS_DESIGNATION")) or "").upper()
        OUT.add_land(cut(f.get("geometry"), box), "closed" if "ECOLOGICAL RESERVE" in des else "restricted", title(text(p.get("PROTECTED_LANDS_NAME"))), BC_PARKS)
    for layer, field in (("WHSE_TANTALIS.TA_CONSERVANCY_AREAS_SVW", "CONSERVANCY_AREA_NAME"), ("WHSE_TANTALIS.TA_WILDLIFE_MGMT_AREAS_SVW", "WILDLIFE_MANAGEMENT_AREA_NAME")):
        for f in wfs(layer, field):
            OUT.add_land(cut(f.get("geometry"), box), "restricted", title(text((f.get("properties") or {}).get(field))), BC_PARKS)

    kept: Counter = Counter()
    for f in wfs("WHSE_TANTALIS.TA_CROWN_TENURES_SVW", "TENURE_STAGE,TENURE_TYPE,TENURE_PURPOSE,TENURE_SUBPURPOSE,TENURE_AREA_IN_HECTARES"):
        p = f.get("properties") or {}
        kind, purpose = text(p.get("TENURE_TYPE")) or "", text(p.get("TENURE_PURPOSE")) or ""
        ha = float(p.get("TENURE_AREA_IN_HECTARES") or 0)
        if text(p.get("TENURE_STAGE")) != "TENURE" or kind not in ("LEASE", "LICENCE"):
            kept[f"{kind.lower()} (left out)"] += 1
            continue
        if kind == "LICENCE" and purpose == "COMMERCIAL RECREATION" and ha > BC_EXTENSIVE_HA:
            kept["extensive commercial recreation (left out)"] += 1
            continue
        kept[kind.lower()] += 1
        what = (text(p.get("TENURE_SUBPURPOSE")) or purpose).capitalize()
        OUT.add_land(cut(f.get("geometry"), box), "crown-lease", f"{what} {kind.lower()}", BC_TENURES)
    print(f"  Crown tenures: {dict(kept)}")


# ---- the Yukon ------------------------------------------------------------------------

GY = "https://mapservices.gov.yk.ca/arcgis/rest/services/GeoYukon"
SL_CLASS = {"A": "settlement-a", "B": "settlement-b", "FS": "settlement-fs"}
# Yukon parks whose outline comes from elsewhere: the sanctuaries from the
# Wildlife Act orders (the legal line), national parks from NRCan
GY_PARKS_ELSEWHERE = ("wildlife sanctuary", "national park")
GY_LEASE_TYPES = ("Lease", "Lease with purchase option", "Agreement for Sale")


def yukon(box) -> None:
    from yt_vectors import query

    # Category A: written permission from the First Nation to hunt any game;
    # B: needed for wood bison and elk only; crossing either is a right.
    # Fee simple is the First Nation's private land (not in the hunting
    # notice: treated as private). A parcel with no category: ask.
    cats: Counter = Counter()
    for f in query("settlement", "crown", "FIRST_NATION_NAME,FN_NAME_CODE,SL_CATEGORY,PARCEL_DESIGNATOR,SL_DESIGNATION"):
        p = f.get("properties") or {}
        cat = (text(p.get("SL_CATEGORY")) or "").split(" - ")[0].strip()
        cats[cat or "none"] += 1
        OUT.add_land(cut(f.get("geometry"), box), SL_CLASS.get(cat, "settlement-b"), text(p.get("FIRST_NATION_NAME")), GY_SETTLEMENT)
    print(f"  settlement land by category: {dict(cats)}")

    # the Wildlife Act's orders: the Kluane Wildlife Sanctuary (no hunting
    # but by special permit, none offered now); any other order, its rules
    for f in query("wildlife-act", f"{GY}/GY_LandTenure/MapServer/40", "DESCRIPTION,STATUS"):
        p = f.get("properties") or {}
        d = text(p.get("DESCRIPTION")) or ""
        OUT.add_land(cut(f.get("geometry"), box), "closed" if "sanctuary" in d.lower() else "restricted", d, GY_SANCTUARY)
    # territorial parks, habitat protection areas and the rest: hunting is
    # allowed in most (Kusawa), each by its own management plan
    for f in query("parks", f"{GY}/GY_ParksProtectedAreas/MapServer/3", "PARK_NAME,PARK_TYPE"):
        p = f.get("properties") or {}
        kind = text(p.get("PARK_TYPE")) or ""
        if any(k in kind.lower() for k in GY_PARKS_ELSEWHERE):
            continue
        name = text(p.get("PARK_NAME")) or ""
        OUT.add_land(cut(f.get("geometry"), box), "restricted", f"{name} {kind}".strip() if kind and kind.lower() not in name.lower() else name, GY_PARKS)
    for f in query("dispositions", f"{GY}/GY_LandTenure/MapServer/2", "TENURE_TYPE,TENURE_PURPOSE"):
        p = f.get("properties") or {}
        kind = text(p.get("TENURE_TYPE")) or ""
        if kind in GY_LEASE_TYPES:
            purpose = text(p.get("TENURE_PURPOSE"))
            OUT.add_land(cut(f.get("geometry"), box), "crown-lease", f"{purpose} {kind.lower()}" if purpose else kind, GY_LEASES)

    # the surveyed parcels: lines only, no title or owner
    for f in query("parcels", f"{GY}/GY_LandTenure/MapServer/27", "PARCEL_DESIGNATOR"):
        d = text((f.get("properties") or {}).get("PARCEL_DESIGNATOR"))
        OUT.add_lot(cut(f.get("geometry"), box), title(d) if d else None, GY_PARCELS)


# ---- Alberta ----------------------------------------------------------------------------

TITAN = "https://geospatial.alberta.ca/titan/rest/services"
# Hunting is barred in provincial parks and provincial recreation areas
# (with listed exceptions the app does not know yet), in wilderness areas
# and ecological reserves. Wildland parks, Willmore, natural areas and
# heritage rangelands have their own rules. National parks come from NRCan.
AB_CLOSED = {"PP", "PRA", "WA", "ER"}
AB_ELSEWHERE = {"NP"}
AB_SLIVER_M2 = 10_000  # a White Area remnant under a hectare is the edge of something else
QS_RE = re.compile(r"QS-(\w+)\s+SEC-0*(\d+)\s+TWP-0*(\d+)\s+RGE-0*(\d+)\s+MER-0*(\d+)")


def quarter_label(p: dict) -> str | None:
    """'NE 12-36-8-W5' from the ATS fields, or the descriptor."""
    try:
        return f"{p['QS'].strip()} {int(p['SEC'])}-{int(p['TWP'])}-{int(p['RGE'])}-W{int(p['M'])}"
    except (KeyError, TypeError, ValueError, AttributeError):
        m = QS_RE.search(text(p.get("DESCRIPTOR")) or "")
        return f"{m.group(1)} {m.group(2)}-{m.group(3)}-{m.group(4)}-W{m.group(5)}" if m else None


def alberta(box) -> None:
    public = []  # land some public layer accounts for
    for f in arcgis("ab-parks", f"{TITAN}/boundary/parks_protected_areas_alberta/FeatureServer/0", "NAME,TYPE,OC_NAME", page=2000):
        p = f.get("properties") or {}
        g = cut(f.get("geometry"), box)
        if g is None:
            continue
        public.append(g)
        kind = (text(p.get("TYPE")) or "").upper()
        if kind not in AB_ELSEWHERE:
            OUT.add_land(g, "closed" if kind in AB_CLOSED else "restricted", text(p.get("OC_NAME")) or text(p.get("NAME")), AB_PARKS)
    for f in arcgis("ab-metis", f"{TITAN}/boundaries/municipal_metis_settlement_public/MapServer/0", "METIS_NAME"):
        g = cut(f.get("geometry"), box)
        if g is not None:
            public.append(g)
            n = title(text((f.get("properties") or {}).get("METIS_NAME")))
            # the settlement's own land, held by its General Council: permission, as private land
            OUT.add_land(g, "private", n if not n or "settlement" in n.lower() else f"{n} Métis Settlement", AB_METIS)
    public += [g for g, p in OUT.land if p["CLASS"] in ("reserve", "closed")]  # NRCan's, run first

    white = [cut(f.get("geometry"), box) for f in arcgis("ab-green-white", f"{TITAN}/boundary/asrd_administrative_area/MapServer/1", "GWA_NAME,GWA_CODE") if (f.get("properties") or {}).get("GWA_CODE") == "GLC_W"]
    white = shapely.union_all([g for g in white if g is not None]) if any(g is not None for g in white) else None
    taken = shapely.union_all(public) if public else None

    # The quarter section is most rural titles' unit. A White Area quarter
    # no public layer covers is most likely titled, private land: likely,
    # because the White Area has Crown pockets (lake beds, grazing leases,
    # which are not open data yet) and the Green Area has private inholdings
    # (about a quarter of Clearwater's) this cannot see.
    quarters = 0
    for f in arcgis("ab-ats-quarters", f"{TITAN}/base/alberta_township_system/MapServer/19", "DESCRIPTOR,M,RGE,TWP,SEC,QS,RA"):
        p = f.get("properties") or {}
        if text(p.get("RA")):  # the road allowance strips between quarters
            continue
        g = cut(f.get("geometry"), box)
        if g is None:
            continue
        label = quarter_label(p)
        OUT.add_lot(g, label, AB_ATS)
        quarters += 1
        if white is None:
            continue
        rest = polygonal(g.intersection(white))
        if rest is not None and taken is not None:
            rest = polygonal(rest.difference(taken))
        if rest is not None and m2(rest) >= AB_SLIVER_M2:
            OUT.add_land(cut(rest, box), "likely-private", label, AB_LIKELY)
    print(f"  {quarters} quarter sections")


# ---- Quebec -------------------------------------------------------------------------------

# The TRQ layers read for hunting: (class, the kind's word for the name).
# ZECs (register and pay), outfitters with exclusive rights (hunting only
# through the outfitter) and wildlife reserves (by draw or permit) are
# hunted under the territory's own rules; parks and ecological reserves are
# closed. National parks of Canada come from NRCan; the managed small lakes,
# teaching forests and forest stations say nothing about hunting.
TRQ_CLASS = {
    "Terzec_s": ("restricted", "Zec"),
    "Terpde_s": ("restricted", "Pourvoirie"),
    "Terref_s": ("restricted", "Réserve faunique"),
    "Terpnq_s": ("closed", "Parc national"),
    "Terrec_s": ("closed", "Réserve écologique"),
    "Terpma_s": ("restricted", "Parc marin"),
    "Terrfa_s": ("restricted", "Refuge faunique"),
    "Terrnf_s": ("restricted", "Réserve nationale de faune"),
    "Terrom_s": ("restricted", "Refuge d'oiseaux migrateurs"),
    "Terafc_s": ("restricted", "Aire faunique communautaire"),
    "Tertec_s": ("restricted", "Territoire exclusif de chasse"),
    "Terepa_s": ("restricted", "Entente autochtone"),
    "Terpre_s": ("restricted", "Parc régional"),
}


def quebec(box) -> None:
    """The TRQ file, read whole: the file geodatabase's spatial index misses
    features a bbox read should return (Pourvoirie Club des Douze at
    Duhamel, 2026-10-18), so each layer is read in full and cut here."""
    import warnings
    import zipfile

    import pyogrio
    from qc_common import SHARED, TRQ_ZIP, download

    warnings.filterwarnings("ignore", message="organizePolygons")  # the big wildlife reserves' many parts: slow, not wrong

    zpath = download(TRQ_ZIP, SHARED / "TRQ.gdb.zip")
    gdb = next((n.split("/")[0] for n in zipfile.ZipFile(zpath).namelist() if n.split("/")[0].endswith(".gdb")), None)
    if not gdb:
        raise SystemExit(f"{zpath.name}: no file geodatabase inside")
    src = f"/vsizip/{zpath.as_posix()}/{gdb}"
    region = shapely.box(*box)
    found = []
    for layer, _ in pyogrio.list_layers(src):
        layer = str(layer)
        if layer not in TRQ_CLASS:
            continue
        cls, word = TRQ_CLASS[layer]
        meta, _, wkbs, cols = pyogrio.raw.read(src, layer=layer, columns=["TRQ_NM_TER"])
        names = cols[0]
        for i, wkb in enumerate(wkbs):
            g = shapely.from_wkb(wkb)
            if g is None or not g.intersects(region):
                continue
            name = text(names[i]) or ""
            if not name.lower().startswith(word.lower().split()[0].lower()):
                name = f"{word} {name}".strip()
            found.append(name)
            OUT.add_land(cut(g, box), cls, name, QC_TRQ)
    print(f"  TRQ territories: {', '.join(found) or 'none'}")


# ---- the run ------------------------------------------------------------------------------

PROVINCES = {"ON": ontario, "BC": bc, "YT": yukon, "AB": alberta, "QC": quebec}


def parts() -> list[tuple[str, tuple[float, float, float, float]]]:
    """Each province's share of the region box: a box over 60° N runs both
    BC's and the Yukon's sources, each on its own side of the line."""
    whole = (W, S, E, N)
    if J in ("BC", "YT") and S < YT_LINE < N:
        return [("BC", (W, S, E, YT_LINE)), ("YT", (W, YT_LINE, E, N))]
    return [(J, whole)]


def write(theme: str, items: list[tuple[shapely.Geometry, dict]], name: str, sources: dict[str, str]) -> Path:
    path = OUT_DIR / f"{theme}-{ID}.geojson"
    feats = [{"type": "Feature", "geometry": json.loads(shapely.to_geojson(g)), "properties": p} for g, p in items]
    path.write_text(json.dumps({"type": "FeatureCollection", "name": name, "features": feats}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {path.name} ({path.stat().st_size / 1e3:.0f} KB, {len(feats)} features)")
    licences = list(dict.fromkeys(x.strip() for v in sources.values() for x in v.split(";")))
    area.note_source(path.name, source="; ".join(sources) or "none in the region", licence="; ".join(licences) or None)
    return path


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    plan = parts()
    print(f"{REGION['name']} ({ID}, {J}): " + ", ".join(f"{j} {b[1]:.3f}-{b[3]:.3f}° N" for j, b in plan))
    if area.JURISDICTION in ("MI",):  # a US state: us_vectors.py writes land-<id> from PAD-US and the state's lands
        print(f"  {area.JURISDICTION} is a US state: the land comes from us_vectors.py; NRCan's federal layers do not reach here")
        return 0
    print("== federal")
    federal((W, S, E, N))
    for j, box in plan:
        run = PROVINCES.get(j)
        print(f"== {j}")
        if run is None:
            print(f"  no provincial property sources for {j} yet: the federal layers only")
            continue
        run(box)

    # big first, so the small holdings inside a park or a ZEC draw on top in the GeoJSON fallback
    OUT.land.sort(key=lambda gp: -gp[0].area)
    classes = Counter(p["CLASS"] for _, p in OUT.land)
    print(f"land by class: {dict(classes)}")
    write("land", OUT.land, f"Land: who holds it, from open data ({REGION['name']})", OUT.land_src)
    write("lots", OUT.lots, f"Lot and parcel lines, approximate ({REGION['name']})", OUT.lots_src)
    return 0


if __name__ == "__main__":
    sys.exit(main())
