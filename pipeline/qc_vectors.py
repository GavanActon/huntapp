"""Quebec's vector layers for an area, in the normal forms the app and the
bakes read: the same file and property names the Ontario adapter
(build_vectors.py) takes straight off LIO.

  waterbody-<id>.geojson    GRHQ water surfaces: WATERBODY_TYPE Lake | Pond |
                            River …, OFFICIAL_NAME_LABEL, PERMANENCY
  watercourse-<id>.geojson  GRHQ flow lines: WATERCOURSE_TYPE Stream | Virtual Flow
  wetland-<id>.geojson      potential wetlands (MELCCFP): WETLAND_TYPE Marsh |
                            Swamp | Fen | Bog | Unknown
  roads-<id>.geojson        AQréseau roads, the multi-use forest roads included
  fire-<id>.geojson         the carte écoforestière's burns: FIRE_YEAR
  parks-<id>.geojson        TRQ territories (ZECs, outfitters, wildlife reserves,
                            parks): PROTECTED_AREA_NAME_ENG, KIND

and, only when asked for by name, never into the area's folder:

  pipeline/raw/wmu-<id>.geojson   the hunting zone(s): OFFICIAL_NAME ('18')

    py -3.13 pipeline/qc_vectors.py --area lac-bailey              # every layer (not wmu)
    py -3.13 pipeline/qc_vectors.py --area lac-bailey roads parks  # just these
    py -3.13 pipeline/qc_vectors.py --area lac-bailey wmu          # the zones, kept local
    py -3.13 pipeline/qc_vectors.py --area lac-bailey --lakes 5    # also list named lakes within 5 km as presets

py -3.13 for pyogrio: the TRQ territories are a file geodatabase. Every
layer is CC BY 4.0 © Gouvernement du Québec except the hunting zones, whose
service states no licence (wmu() below): only open data goes in an area's
pack, so the zones stay out of it, and the area file's zone field names
the zone instead. A layer whose server is down is reported and the rest
are still written; the run then exits 1, and a rerun fetches only what is
missing (qc_common.py keeps every answer).
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import zipfile
from pathlib import Path

import shapely
from shapely.ops import polylabel

sys.path.insert(0, str(Path(__file__).resolve().parent))
import area  # noqa: E402  (before argparse: it takes --area out of argv)
from qc_common import (  # noqa: E402
    AQRESEAU,
    GRHQ,
    SHARED,
    SMARTFAUNE,
    TRQ_ZIP,
    WETLANDS,
    arcgis,
    box_of,
    download,
    ecofor,
    feature,
    fetch_json,
    tidy,
    write_geojson,
    year_of,
)

CC_BY = "CC BY 4.0"
# Water, wetlands and fire are cut a little outside the region, so nothing
# the bakes or the map read ends at the region's edge; the territories and
# the zone are kept whole, since their outlines are drawn and a cut would
# draw a boundary that is not there.
MARGIN = 0.02  # deg, about 1.5-2 km

# ---- water ------------------------------------------------------------------------

# GRHQ TYPECE for surfaces. A reservoir is a lake to a moose or an angler,
# and build_habitat only makes lakes (shore distance, fetch) of Lake and Pond.
WATERBODY_TYPE = {10: "River", 21: "Lake", 22: "Pond", 23: "Lake", 42: "Canal", 48: "River", 51: "Ocean", 52: "Ocean", 53: "Ocean", 67: "River", 68: "River", 71: "River"}
PERMANENCY = {"P": "Permanent", "ZP": "Permanent", "I": "Intermittent", "ZI": "Intermittent"}


def _name(v) -> str | None:
    v = (v or "").strip()
    return v or None


def _vintage(feats: list[dict], field: str) -> str | None:
    """'updated 2017-03-23' from GRHQ's DATE_MAJ (20170323), the date most
    features carry, and the latest when some are newer."""
    dates = [str(f["properties"].get(field) or "")[:8] for f in feats]
    dates = [f"{d[:4]}-{d[4:6]}-{d[6:]}" for d in dates if len(d) == 8 and d.isdigit()]
    if not dates:
        return None
    most, last = max(set(dates), key=dates.count), max(dates)
    return f"updated {most}" + (f", some to {last}" if last != most else "")


def _clipped(g, box, simplify_deg: float = 0.0):
    if g is None or g.is_empty:
        return None
    if shapely.get_dimensions(g) == 2 and not g.is_valid:
        g = shapely.make_valid(g)
    return tidy(shapely.clip_by_rect(g, *box), simplify_deg)


def grhq_lakes() -> list[dict]:
    """GRHQ's water surfaces touching the region, whole (as served)."""
    return arcgis("grhq-surfaces", f"{GRHQ}/23", box_of(), fields="TYPECE,PERENNITE,TOPONYME,SUP_HA,DATE_MAJ")


def waterbody() -> str:
    raw = grhq_lakes()
    box = box_of(MARGIN)
    feats = []
    for f in raw:
        p = f["properties"]
        g = _clipped(shapely.geometry.shape(f["geometry"]) if f.get("geometry") else None, box, 0.00001)
        if g is None:
            continue
        feats.append(
            feature(
                g,
                {
                    "WATERBODY_TYPE": WATERBODY_TYPE.get(int(p.get("TYPECE") or 0), "Other"),
                    "OFFICIAL_NAME_LABEL": _name(p.get("TOPONYME")),
                    "PERMANENCY": PERMANENCY.get(p.get("PERENNITE") or ""),
                    "AREA_HA": round(float(p["SUP_HA"]), 1) if p.get("SUP_HA") is not None else None,  # the whole lake's
                },
            )
        )
    name = f"waterbody-{area.ID}.geojson"
    write_geojson("waterbody", feats, "GRHQ water surfaces")
    area.note_source(name, source="GRHQ water surfaces (MRNF), 1:20 000", licence=CC_BY, vintage=_vintage(raw, "DATE_MAJ"))
    return f"{_count(feats, 'WATERBODY_TYPE')}, {sum(1 for x in feats if x['properties']['OFFICIAL_NAME_LABEL'])} named"


# GRHQ flow lines: a mapped channel (a stream, a canal, a ditch) on its own
# main or secondary line is a Stream, which is what build_going charges a
# crossing for. The lines through lakes and rivers (the centre and connector
# lines, FONCTION 2-4), inferred flow paths (theoretical, diffuse through a
# wetland or underground) and structures (dams, beaver dams, culverts) are
# Virtual Flow, as in Ontario's OHN. Intermittent streams stay streams, as
# they do there: a dry bed in October is still a cut in the ground.
CHANNELS = {10, 42, 43, 44, 45}  # cours d'eau, canal, agricultural and road drainage, straightened
REAL_LINE = {1, 8}  # FONCTION: main line, secondary line


def watercourse() -> str:
    raw = arcgis("grhq-lines", f"{GRHQ}/15", box_of(), fields="TYPECE,FONCTION,PERENNITE,TOPONYME,DATE_MAJ")
    box = box_of(MARGIN)
    feats = []
    for f in raw:
        p = f["properties"]
        g = _clipped(shapely.geometry.shape(f["geometry"]) if f.get("geometry") else None, box)
        if g is None:
            continue
        stream = int(p.get("TYPECE") or 0) in CHANNELS and int(p.get("FONCTION") or 0) in REAL_LINE
        feats.append(
            feature(
                g,
                {
                    "WATERCOURSE_TYPE": "Stream" if stream else "Virtual Flow",
                    "OFFICIAL_NAME_LABEL": _name(p.get("TOPONYME")),
                    "PERMANENCY": PERMANENCY.get(p.get("PERENNITE") or ""),
                },
            )
        )
    name = f"watercourse-{area.ID}.geojson"
    write_geojson("watercourse", feats, "GRHQ flow lines")
    area.note_source(name, source="GRHQ flow lines (MRNF), 1:20 000", licence=CC_BY, vintage=_vintage(raw, "DATE_MAJ"))
    streams = [x for x in feats if x["properties"]["WATERCOURSE_TYPE"] == "Stream"]
    return f"{_count(feats, 'WATERCOURSE_TYPE')}, streams {_count(streams, 'PERMANENCY')}"


# MELCCFP classes -> the OHN wetland types. Only build_going reads the type
# (Marsh: marsh; Fen and Bog: open peatland; anything else: swamp, the
# treed wet ground). So a treed peatland ('Tourbière boisée': black spruce
# and tamarack on peat) is a Swamp: it walks like one, slow and hummocky
# under trees, not like an open fen. Shallow water and wet meadow go with
# the marshes.
WETLAND_TYPE = {
    "Marais": "Marsh",
    "Eau peu profonde": "Marsh",
    "Prairie humide": "Marsh",
    "Marécage": "Swamp",
    "Tourbière boisée": "Swamp",
    "Tourbière ouverte ombrotrophe": "Bog",
    "Tourbière ouverte minérotrophe": "Fen",
    "Tourbière ouverte indifférenciée": "Fen",
    "Complexe palsique": "Bog",
    "Milieu humide": "Unknown",
}
WETLAND_BY_TYPE = {"Marais": "Marsh", "Marécage": "Swamp", "Tourbière": "Fen", "Eau peu profonde": "Marsh"}  # a class not listed above


def wetland() -> str:
    raw = arcgis("wetlands", WETLANDS, box_of(), fields="CLASSE,TYPE,PHYSIONOMIE,SOURCE")
    box = box_of(MARGIN)
    feats = []
    for f in raw:
        p = f["properties"]
        g = _clipped(shapely.geometry.shape(f["geometry"]) if f.get("geometry") else None, box)
        if g is None:
            continue
        cls = (p.get("CLASSE") or "").strip()
        kind = WETLAND_TYPE.get(cls) or WETLAND_BY_TYPE.get((p.get("TYPE") or "").strip(), "Unknown")
        feats.append(feature(g, {"WETLAND_TYPE": kind, "DOMINANT_VEG_FORM": _name(p.get("PHYSIONOMIE")), "CLASSE": cls or None}))
    name = f"wetland-{area.ID}.geojson"
    write_geojson("wetland", feats, "Milieux humides potentiels")
    sources = sorted({str(f["properties"].get("SOURCE")) for f in raw if f["properties"].get("SOURCE")})
    sources = [{"IEQM": "the forest map (IEQM)"}.get(s, s) for s in sources]
    area.note_source(
        name,
        source="Milieux humides potentiels (MELCCFP)" + (f", drawn from {', '.join(sources)}" if sources else ""),
        licence=CC_BY,
        vintage="2023",
    )
    return _count(feats, "WETLAND_TYPE")


# ---- roads ------------------------------------------------------------------------

# AQréseau's full-detail layer of each road class. The multi-use forest
# roads are 'Autre route'. Not asked for: pedestrian streets, the Route
# Verte (cycling), the Route Blanche (winter ice roads), rail.
ROAD_LAYERS = {
    23: "Autoroute",
    26: "Bretelle (autoroute)",
    31: "Nationale",
    34: "Bretelle (nationale)",
    38: "Régionale",
    41: "Bretelle (régionale)",
    46: "Collectrice",
    49: "Bretelle (collectrice)",
    52: "Accès aux ressources",
    54: "Bretelle (accès aux ressources)",
    58: "Locale",
    62: "Autre route",
}
ROAD_FIELDS = ("ClsRte", "Cls_CheFor", "CarRte", "CaractRte")


def roads() -> str:
    box = box_of()
    feats, used, versions, winter = [], [], set(), 0
    for lid, label in ROAD_LAYERS.items():
        raw = arcgis(f"aqreseau-{lid}", f"{AQRESEAU}/{lid}", box)  # most are empty out here: one short answer each
        if raw:
            used.append(f"{label} ({len(raw)})")
        for f in raw:
            p = f["properties"]
            # a winter road is frozen ground and muskeg in October, not a road
            if (p.get("Cls_CheFor") or "") == "HI":
                winter += 1
                continue
            g = tidy(shapely.geometry.shape(f["geometry"]) if f.get("geometry") else None)
            if g is None:
                continue
            if p.get("Version"):
                versions.add(str(p["Version"]))
            # impassable to a truck (CarRte IMP) is still a cut line to walk, so it stays
            feats.append(feature(g, {"ROAD_NAME": _name(p.get("NomRte")), **{k: _name(p.get(k)) for k in ROAD_FIELDS}}))
    name = f"roads-{area.ID}.geojson"
    write_geojson("roads", feats, "AQréseau roads")
    v = max(versions) if versions else ""  # AQ20260701: the quarterly release
    area.note_source(
        name,
        source="AQréseau (Adresses Québec, MRNF): " + (", ".join(used) or "no roads in the region"),
        licence=CC_BY,
        vintage=f"release {v[2:6]}-{v[6:8]}-{v[8:10]}" if len(v) == 10 and v[2:].isdigit() else (v or None),
    )
    km = sum(_length_m(shapely.geometry.shape(x["geometry"])) for x in feats) / 1000
    return f"{len(feats)} segments, {km:.0f} km ({', '.join(used) or 'none'}; {winter} winter-road segments left out)"


# ---- fire, hunting zone, territories ---------------------------------------------------


def fire() -> str:
    """Every burn on the forest map over the region, for the map's Burns
    layer. The habitat bake reads it too, but in Quebec the stand ages
    already carry the burns (build_habitat.py), so an old fire does not
    make a younger stand look burnt."""
    raw = ecofor("ms:ca_feu_close_scale", box_of())
    box = box_of(MARGIN)
    feats, years = [], []
    for f in raw:
        p = f["properties"]
        y = year_of(p.get("an_origine"))
        if p.get("origine") not in ("BR", "BRD") or y is None:
            continue
        g = _clipped(shapely.geometry.shape(f["geometry"]) if f.get("geometry") else None, box, 0.00003)
        if g is None:
            continue
        years.append(y)
        size = p.get("superficie")
        feats.append(feature(g, {"FIRE_YEAR": y, "FIRE_TYPE_CODE": p["origine"], "FIRE_FINAL_SIZE": round(float(size), 1) if size is not None else None}))
    name = f"fire-{area.ID}.geojson"
    write_geojson("fire", feats, "Feux (carte écoforestière)")
    upto = max((year_of(f["properties"].get("exercice")) or 0 for f in raw), default=0)
    area.note_source(name, source="Burns from the carte écoforestière (ca_feu), MRNF", licence=CC_BY, vintage=f"burns to {upto}" if upto else None)
    by_year = {y: years.count(y) for y in sorted(set(years))}
    return f"{len(feats)} burns by year {by_year}"


def wmu() -> str:
    """The hunting zone(s) over the region, whole: a zone cut at the region
    would draw a zone boundary along its edge. The GeoServer reads a bare
    bbox in its own Quebec Lambert, so the bbox says it is lon/lat.

    Licence: the SmartFaune service says use is subject to the MFFP's
    licence and names none, and no open-data copy of the zones was found
    (2026-10-03). The zones themselves are set by regulation. So this layer
    is fetched only when named on the command line, and written with the
    caches (pipeline/raw/wmu-<id>.geojson), where bake_area.py can read the
    zone's name for a new area's file and nothing ships it: not in the
    area's folder, so not in its pack, its manifest or the places tiles."""
    w, s, e, n = box_of()
    q = {
        "service": "WFS",
        "version": "1.1.0",
        "request": "GetFeature",
        "typeName": "SmartFaunePub:Zone_chasse_da3_sefaq",
        "outputFormat": "application/json",
        "srsName": "EPSG:4326",
        "bbox": f"{w},{s},{e},{n},EPSG:4326",
    }
    fc = fetch_json("hunting-zones", SMARTFAUNE, q)
    feats = []
    for f in fc.get("features") or []:
        p = f["properties"]
        g = tidy(shapely.geometry.shape(f["geometry"]) if f.get("geometry") else None)
        if g is None:
            continue
        zone = str(p.get("No_zone") or p.get("Zone") or "").strip()
        part = str(p.get("Partie_zon") or "").strip()
        feats.append(feature(g, {"OFFICIAL_NAME": f"{zone} {part}".strip()}))
    # no provenance note: those describe the area's folder, and this is not in it
    write_geojson("wmu", feats, "Zones de chasse (SmartFaune, MFFP; zones of 2022-03-23; licence not stated: local use only)", folder=area.CACHE_DIR)
    return ", ".join(sorted(x["properties"]["OFFICIAL_NAME"] for x in feats)) or "none"


# TRQ layers -> a short kind, for wording that does not call a ZEC a park
TRQ_KIND = {
    "Terzec_s": "zec",
    "Terpde_s": "outfitter",
    "Terref_s": "wildlife reserve",
    "Terpnq_s": "national park",
    "Terpnc_s": "national park of Canada",
    "Terpma_s": "marine park",
    "Terrec_s": "ecological reserve",
    "Terrfa_s": "wildlife refuge",
    "Terrnf_s": "national wildlife area",
    "Terrom_s": "migratory bird sanctuary",
    "Terafc_s": "community wildlife area",
    "Tertec_s": "exclusive hunting territory",
    "Terepa_s": "agreement with a First Nation",
    "Terpre_s": "regional park",
    "Terpla_s": "managed small lake",
    "Terfer_s": "teaching and research forest",
    "Tersfo_s": "forest station",
}


def parks() -> str:
    """The structured territories over the region, from the open TRQ file
    (CC BY 4.0; the 'Territoires fauniques structurés' file has the same
    outlines under CC BY-NC-ND, so it is not used). Kept whole and simplified
    to about 4 m. Its boundaries are NAD83, within a metre of the map's WGS 84
    here, and have no legal standing (TRQ_DE_NOT)."""
    import pyogrio

    zpath = download(TRQ_ZIP, SHARED / "TRQ.gdb.zip")
    gdb = next((n.split("/")[0] for n in zipfile.ZipFile(zpath).namelist() if n.split("/")[0].endswith(".gdb")), None)
    if not gdb:
        raise SystemExit(f"{zpath.name}: no file geodatabase inside")
    src = f"/vsizip/{zpath.as_posix()}/{gdb}"
    feats, kinds, version = [], {}, None
    for layer, _ in pyogrio.list_layers(src):
        meta, _, wkbs, cols = pyogrio.raw.read(src, layer=str(layer), bbox=box_of())
        col = dict(zip(meta["fields"], cols))
        for i, wkb in enumerate(wkbs):
            g = tidy(shapely.from_wkb(wkb), 0.00005)
            if g is None:
                continue
            get = lambda k: _name(str(col[k][i])) if k in col and col[k][i] is not None else None  # noqa: E731
            kind = TRQ_KIND.get(str(layer), "territory")
            kinds[kind] = kinds.get(kind, 0) + 1
            version = get("TRQ_CO_VER") or version
            feats.append(
                feature(
                    g,
                    {
                        "PROTECTED_AREA_NAME_ENG": get("TRQ_NM_TER"),
                        "PROVINCIAL_PARK_CLASS_ENG": get("TRQ_DE_IND"),
                        "KIND": kind,
                        "CODE": get("TRQ_CO_TER"),
                        "RIGHTS": get("TRQ_CO_DRO"),
                    },
                )
            )
    name = f"parks-{area.ID}.geojson"
    write_geojson("parks", feats, "Territoires récréatifs du Québec")
    area.note_source(name, source="Territoires récréatifs du Québec (TRQ), MRNF", licence=CC_BY, vintage=version)
    return ", ".join(f"{x['properties']['PROTECTED_AREA_NAME_ENG']} ({x['properties']['KIND']})" for x in feats) or "none"


# ---- presets ------------------------------------------------------------------------


def _length_m(g) -> float:
    lat = math.radians((area.REGION["south"] + area.REGION["north"]) / 2)
    return shapely.length(shapely.transform(g, lambda c: c * [111_320 * math.cos(lat), 110_574]))


def lake_presets(km: float) -> list[dict]:
    """The named lakes within km of the area's centre, nearest first, as
    presets (the point most inside each lake, from GRHQ). Printed for the
    area file's presets, not written into it: those are picked by hand."""
    lon0, lat0 = area.HOME
    kx, ky = 111_320 * math.cos(math.radians(lat0)), 110_574
    to_m = lambda c: (c - [lon0, lat0]) * [kx, ky]  # noqa: E731  (metres from the centre)
    here = shapely.Point(0, 0)
    found = []
    for f in grhq_lakes():
        p = f["properties"]
        name = _name(p.get("TOPONYME"))
        if not name or WATERBODY_TYPE.get(int(p.get("TYPECE") or 0)) not in ("Lake", "Pond") or not f.get("geometry"):
            continue
        g = shapely.make_valid(shapely.geometry.shape(f["geometry"]))
        d = shapely.transform(g, to_m).distance(here)
        if d > km * 1000:
            continue
        poly = max(shapely.get_parts(g), key=lambda q: q.area) if g.geom_type != "Polygon" else g
        pt = polylabel(poly, 0.00002) if poly.geom_type == "Polygon" else poly.representative_point()
        found.append((d, {"name": name, "lon": round(pt.x, 4), "lat": round(pt.y, 4), "kind": "lake"}, p.get("SUP_HA")))
    found.sort(key=lambda t: t[0])
    for d, pr, ha in found:
        print(f"  {pr['name']}: {d:.0f} m from the centre, {ha or 0:.1f} ha")
    return [pr for _, pr, _ in found]


LAYERS = {"waterbody": waterbody, "watercourse": watercourse, "wetland": wetland, "roads": roads, "fire": fire, "wmu": wmu, "parks": parks}
LOCAL_ONLY = {"wmu"}  # not openly licensed: fetched only when named, and kept out of the area's folder


def _count(feats: list[dict], key: str) -> dict:
    out: dict = {}
    for f in feats:
        v = f["properties"].get(key)
        out[v] = out.get(v, 0) + 1
    return dict(sorted(out.items(), key=lambda kv: -kv[1]))


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("layers", nargs="*", help=f"any of {', '.join(LAYERS)} (default: all but {', '.join(sorted(LOCAL_ONLY))})")
    ap.add_argument("--lakes", type=float, metavar="KM", help="also print the named lakes within KM of the centre, as presets")
    args = ap.parse_args()
    names = args.layers or [n for n in LAYERS if n not in LOCAL_ONLY]
    bad = [n for n in names if n not in LAYERS]
    if bad:
        ap.error(f"no layer {', '.join(bad)}; the layers are {', '.join(LAYERS)}")
    print(f"{area.REGION['name']} ({area.ID}): {', '.join(names)}")
    failed = []
    for n in names:
        print(f"== {n}")
        try:
            print(f"   {n}: {LAYERS[n]()}")
        except (SystemExit, Exception) as e:  # noqa: BLE001  (one server down should not cost the other layers)
            failed.append(n)
            print(f"   {n}: FAILED, {e}")
    if args.lakes:
        print(f"== named lakes within {args.lakes:g} km")
        print(json.dumps(lake_presets(args.lakes), ensure_ascii=False, indent=1))
    if failed:
        print(f"failed: {', '.join(failed)} (rerun to fetch what is missing)")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
