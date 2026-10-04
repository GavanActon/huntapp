"""Quebec's forest stands for an area -> forest-<id>.geojson, in exactly the
normal form build_forest.py writes from Ontario's FRI: group, species, year,
ht, cc, sc, conif, hard, poly, dep, deptype, eco. The source is the MRNF
carte écoforestière (CC BY 4.0) on the geoegl services:

  the stands   WFS ms:ori_pee_close_scale, the map as photo-interpreted: the
               4th inventory, and the 5th where it is out (2012 and 2023-24
               photos at Lac Bailey). The WFS leaves out the terrain code of
               the polygons with no stand (water, open wetland, alder, rock
               …), so those few are asked one by one of the WMS, which
               serves every attribute (GetFeatureInfo).
  what came    ms:ca_interv_for_close_scale (cuts, plantations),
  after        ms:ca_feu_close_scale (burns) and ms:ca_perturb_autre_close_scale
               (outbreaks, blowdown). A stand-replacing event after a stand's
               photo, or in its year where the stand does not show it, takes
               over the part of the stand it covers, the newest on top, as in
               the MRNF's own updated map (the 'MAJ' download); open wetland,
               rock and cleared ground keep what they are and take its date.
               The same layers date a stand-replacing origin the map left
               without a year (date_origin).

    py -3.14 pipeline/qc_forest.py --area lac-bailey

Every answer is cached under pipeline/raw/qc/<id>/ (qc_common.py). The first
run asks the WMS once per polygon with no stand (about 1,600 at Lac Bailey,
a few minutes); a rerun asks nothing.

The code tables below turn the map's codes into the normal form, and each
says where its numbers come from. The codes are the MRNF's (Dictionnaire de
la carte écoforestière, programmes 4 and 5).
"""

from __future__ import annotations

import json
import math
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path

import shapely

sys.path.insert(0, str(Path(__file__).resolve().parent))
import area  # noqa: E402  (first: it takes --area out of argv)
from common import REGION  # noqa: E402
from qc_common import CACHE, ECOFOR, box_of, decode, ecofor, feature, get, tidy, write_geojson, year_of  # noqa: E402

YEAR = date.today().year

# A stand-replacing origin at most this many years back is a disturbance
# (dep), as the FRI's depletions are; an older one only dates the stand
# (year). 40 is where the habitat bake's bush model hands a stand over from
# the regrowth curve to its type (build_habitat.young_thickness), and the
# moose rules halve the browse of anything with a disturbance age, so a
# 1916 burn under a mature stand must not count as one.
DEP_YEARS = 40
MIN_PIECE_M2 = 500  # an overlay piece smaller than this (half a habitat cell) is a sliver of two maps' outlines

# ---- code tables -----------------------------------------------------------------

# Species and species-group codes -> (the code the normal form uses, which
# is Ontario's FRI code where there is one; conifer?). Matching is
# case-sensitive, and some codes mean another tree than the same letters in
# Ontario: Quebec SB is balsam fir (Ontario Sb, black spruce, is EN here),
# PB white pine, PL a poplar, ES sugar maple. The groups with no species
# (RX any conifer, FI shade-intolerant hardwoods, FN non-commercial ones
# such as mountain maple and pin cherry, FX any hardwood …) get codes Ontario
# does not use: they label the stand and lead nothing, so the habitat bake's
# species tweaks leave them alone.
SPECIES: dict[str, tuple[str, bool]] = {
    # conifers
    "EN": ("Sb", True),  # épinette noire
    "EB": ("Sw", True),  # épinette blanche
    "EU": ("Sr", True),  # épinette rouge
    "EP": ("Sx", True),  # épinettes
    "EV": ("Sx", True),  # épinette de Norvège
    "SB": ("Bf", True),  # sapin baumier
    "SE": ("Bf", True),  # sapin et/ou épinette blanche: the fir leads
    "PG": ("Pj", True),  # pin gris
    "PB": ("Pw", True),  # pin blanc
    "PR": ("Pr", True),  # pin rouge
    "PS": ("Ps", True),  # pin sylvestre
    "PI": ("Px", True),  # pins
    "PC": ("Px", True),  # pin rigide
    "ML": ("La", True),  # mélèze laricin
    "ME": ("La", True),  # mélèze européen
    "MH": ("La", True),  # mélèze hybride
    "MJ": ("La", True),  # mélèze japonais
    "TO": ("Cw", True),  # thuya
    "PU": ("He", True),  # pruche
    "RX": ("Cx", True),  # résineux indéterminés
    "RZ": ("Cx", True),  # résineux plantés, species not given
    # hardwoods
    "BP": ("Bw", False),  # bouleau à papier
    "BJ": ("By", False),  # bouleau jaune
    "BG": ("Bg", False),  # bouleau gris
    "PT": ("Pt", False),  # peuplier faux-tremble
    "PE": ("Po", False),  # peupliers
    "PA": ("Pb", False),  # peuplier baumier
    "PD": ("Po", False),  # peuplier à grandes dents
    "PH": ("Po", False),  # peuplier hybride
    "PL": ("Po", False),  # peuplier deltoïde
    "PO": ("Po", False),  # peupliers
    "ES": ("Mh", False),  # érable à sucre
    "EO": ("Mr", False),  # érable rouge
    "EA": ("Ms", False),  # érable argenté
    "EI": ("Mh", False),  # érable noir
    "ER": ("Mx", False),  # érables
    "FA": ("Aw", False),  # frêne d'Amérique
    "FO": ("Ab", False),  # frêne noir
    "FP": ("Ag", False),  # frêne de Pennsylvanie
    "FR": ("Ax", False),  # frênes
    "HG": ("Be", False),  # hêtre
    "TA": ("Bd", False),  # tilleul
    "OA": ("Ew", False),  # orme d'Amérique
    "OO": ("Er", False),  # orme liège
    "OR": ("Ex", False),  # orme rouge
    "OT": ("Ex", False),  # ormes
    "OV": ("Iw", False),  # ostryer
    "CB": ("Ow", False),  # chêne blanc
    "CG": ("Ob", False),  # chêne à gros fruits
    "CH": ("Ox", False),  # chênes
    "CI": ("Ox", False),  # chênes
    "CR": ("Or", False),  # chêne rouge
    "CT": ("Cb", False),  # cerisier tardif
    "NC": ("Bn", False),  # noyer cendré
    "NN": ("Wb", False),  # noyer noir
    "CC": ("Hx", False),  # caryers
    "CF": ("Hx", False),  # caryers
    "FI": ("Hi", False),  # feuillus intolérants à l'ombre
    "FN": ("Hn", False),  # feuillus non commerciaux
    "FT": ("Ht", False),  # feuillus tolérants
    "FH": ("Hw", False),  # feuillus de milieux humides
    "FX": ("Hx", False),  # feuillus indéterminés
    "FZ": ("Hx", False),  # feuillus plantés
}

# type_couv is the stand's cover type by basal area: R conifers 75 % or more,
# F hardwoods 75 % or more, M in between. The normal form wants one number,
# so a class gives its middle: 90 % conifer for R (the class runs 75-100,
# and pure stands are common), 10 for F, and 65 for the leading type of an
# M stand (the type of its first species), 35 for the other. That keeps a
# mixed stand inside build_habitat's mixedwood band (31-69 % conifer), and
# puts a hardwood-led one over its 40 % hardwood browse line and a
# conifer-led one under it, as the map's measured compositions do.
COVER_CONIF = {"R": 90, "F": 10}
MIXED_LEAD = 65
# Within a type, its share goes to the species the code names for it, in
# order: one species takes it all, two split it 60/40, three 50/30/20.
SPLITS = {1: (1.0,), 2: (0.6, 0.4), 3: (0.5, 0.3, 0.2)}

# cl_haut: the height of the codominant trees in classes; each class's middle
# (class 1 is open-ended, 21.5 m and up, and few boreal stands top 25 m).
HEIGHT_M = {"1": 23.0, "2": 19.0, "3": 14.0, "4": 9.0, "5": 5.0, "6": 2.5, "7": 1.0}
# cl_dens: crown cover in classes (A over 80 %, B 60-80, C 40-60, D 25-40);
# each class's middle. H and I rate regeneration by stocking, not crown
# cover, so they give none.
CLOSURE = {"A": 90, "B": 70, "C": 50, "D": 32}
# cl_age: even-aged classes are 20-year bands named by their middle (10 is
# 0-20 years, 120 over 100). A two-storey stand (12030: 120 over 30) takes
# its upper storey's. Uneven-aged or irregular stands: young (JIN, JIR, an
# origin under 80 years ago) 60, old (VIN, VIR) 100.
AGE_CLASS = {"10": 10, "30": 30, "50": 50, "70": 70, "90": 90, "110": 110, "120": 120, "130": 130, "JIN": 60, "JIR": 60, "VIN": 100, "VIR": 100}

# origine: the stand-replacing event the stand grew from (with an_origine its
# year) -> the FRI's depletion types. A plantation counts as the cut before
# it, dated by the planting. The partial events in perturb (partial cut or
# burn or blowdown, precommercial thinning, release, light outbreak, partial
# dieback) leave the stand standing, so they date nothing, as partial
# depletions do not reset an FRI stand.
STAND_REPLACING = {
    "BR": "FIRE",  # brûlis total
    "BRD": "FIRE",  # brûlage dirigé
    "CT": "HARVEST",  # coupe totale
    "CPR": "HARVEST",  # coupe avec protection de la régénération
    "CPRS": "HARVEST",
    "CPRS_U": "HARVEST",  # … et des sols, uniforme
    "CRS": "HARVEST",  # coupe avec réserve de semenciers
    "CMO": "HARVEST",  # coupe en mosaïque
    "P": "HARVEST",  # plantation
    "PL": "HARVEST",
    "ENS": "HARVEST",  # ensemencement
    "CHT": "BLOWDOWN",  # chablis total
    "ES": "INSECTS",  # épidémie grave
    "DT": "DIEBACK",  # dépérissement total
    "RIA": "OTHER",  # an abandoned road, camp or pit grown back
}
# Two events in the same year on the same ground (at Lac Bailey the 2023
# fire burned through nearly all of that year's outbreak): the one that
# leaves least standing is the one the ground shows.
SAME_YEAR_ORDER = {"FIRE": 0, "HARVEST": 1, "BLOWDOWN": 2, "INSECTS": 3, "DIEBACK": 4, "OTHER": 5}

# co_ter, the terrain code of a polygon with no stand -> the FRI's POLYTYPE.
# The habitat bake gives FOR, OMS, TMS, BSH, WAT, GRS, ISL and UCL a code of
# their own and lets the land cover decide anything else (DAL, ''). On this
# map's UCL and RCK it takes the ground as open (build_habitat.py), so UCL is
# only for ground kept open; and the point cloud agrees: over Lac Bailey's
# core the power lines read a median 0.01 of understory (the share of
# returns 0-3 m caught 0.5-3 m) under 0.02 canopy cover, the dénudé sec 0.14
# under 0.08, against 0.43 under 0.26 for the alder, which stays brush.
POLYTYPE = {
    "EAU": "WAT",  # étendue d'eau
    "DH": "OMS",  # dénudé humide: open fen or bog
    "INO": "OMS",  # site inondé: a beaver flood, or a drained one not yet grown back
    "AL": "BSH",  # aulnaie: alder
    "LTE": "UCL",  # ligne de transport d'énergie: a right-of-way kept cut to grass and low shrub, with the roads and pits below
    "IMP": "BSH",  # improductive forest or shrub (TMS when wet and organic, below)
    "DS": "RCK",  # dénudé sec: rock and lichen
    "ILE": "ISL",  # island under 1 ha
    "A": "DAL",  # farmland
    "AF": "DAL",
    "ANT": "UCL",  # opened up by people (non boisé): roads, pits, camps, dumps, landings (and power lines, above)
    "GR": "UCL",
    "RO": "UCL",
    "CFO": "UCL",
    "AEP": "UCL",
    "DEP": "UCL",
    "NF": "",  # touched lightly by people but still wooded (boisé): the land cover decides
    "NX": "",  # an unharvestable patch inside a treatment, as a rule left standing: the land cover decides
}
# A stand on organic ground (7E thick, 7T thin peat) with poor or very poor
# drainage is a treed bog or fen: the FRI's treed muskeg, TMS.
WET_DRAINAGE = {"50", "51", "60", "61"}


def organic(dep_sur: str) -> bool:
    return dep_sur.startswith("7") or dep_sur.startswith("R7")


def composition(gr_ess: str, type_couv: str) -> tuple[str, int, int]:
    """(species, conif %, hard %) from a stand's species group and cover type.
    gr_ess names up to three species, the leading type's first (the same
    code twice when one species carries it) and then the other type's main
    one: BPBPPG is 'bouleau à papier, bouleau à papier et pin gris'."""
    toks = [gr_ess[i : i + 2] for i in range(0, len(gr_ess), 2)]
    toks = [t for t in toks if t in SPECIES]
    if not toks and type_couv not in ("R", "M", "F"):
        return "", 0, 0
    tc = type_couv
    if tc not in ("R", "M", "F"):  # no cover type: from the codes
        kinds = {SPECIES[t][1] for t in toks}
        tc = "R" if kinds == {True} else "F" if kinds == {False} else "M"
    if tc == "M":
        conif = MIXED_LEAD if (SPECIES[toks[0]][1] if toks else True) else 100 - MIXED_LEAD
    else:
        conif = COVER_CONIF[tc]
    shares: dict[str, float] = {}
    for is_conif, share in ((True, conif), (False, 100 - conif)):
        mine = list(dict.fromkeys(t for t in toks if SPECIES[t][1] == is_conif))[:3]
        for t, w in zip(mine, SPLITS.get(len(mine), ())):
            code = SPECIES[t][0]
            shares[code] = shares.get(code, 0.0) + share * w
    # the label as the FRI writes it, to the nearest 5, largest first
    parts = sorted(((c, int(5 * math.floor(v / 5 + 0.5))) for c, v in shares.items()), key=lambda cv: -cv[1])
    return " ".join(f"{c}{v}" for c, v in parts[:3] if v > 0), conif, 100 - conif


def stand_age(cl_age: str) -> int | None:
    if cl_age in AGE_CLASS:
        return AGE_CLASS[cl_age]
    for k in ("120", "130", "110", "10", "30", "50", "70", "90"):  # two storeys: the upper one's
        if cl_age.startswith(k) and cl_age[len(k) :] in AGE_CLASS:
            return AGE_CLASS[k]
    return None


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


def disturbance(origine: str, an_origine) -> tuple[int | None, str | None]:
    """(dep, deptype) for a stand-replacing origin recent enough to count."""
    kind = STAND_REPLACING.get(origine)
    y = year_of(an_origine)
    if kind and y and YEAR - y <= DEP_YEARS:
        return y, kind
    return None, None


# The polygons later events are laid over. A stand, the alder and the ground
# the land cover decides give the event's piece over to the land cover (what
# grows there now is not on the map); open wetland, rock and cleared ground
# stay what they are and take the event's date, so a later burn still
# reaches them (the habitat bake reads no fire layer where the map has a
# polygon). Water, islands and farmland are left as they are.
OVERLAID = {"FOR", "TMS", "BSH", "", "OMS", "RCK", "UCL"}
DATED_ONLY = {"OMS", "RCK", "UCL"}


def shows(p: dict, event: tuple) -> bool:
    """Whether a stand photographed in the year of an event records it: it
    grew from an event of that kind, that year or undated, or it is under
    20 years old."""
    y, kind = event[0], event[1]
    grew_from = STAND_REPLACING.get(p.get("origine") or "") == kind and year_of(p.get("an_origine")) in (y, None)
    return grew_from or (p.get("cl_age") or "") == "10"


def date_origin(p: dict, g, props: dict, info: dict, photo: dict, events: list, tree) -> tuple[dict, str | None]:
    """A stand-replacing origin the map gives neither a year nor an age class
    to date it by: the year of the newest event of that kind under the
    polygon, up to its programme's last photo; failing one, the stand's photo
    year, the latest the origin can be. With dep, deptype and group to match,
    and how it was dated. At Lac Bailey this makes the 31 polygons the 5th
    inventory drew as fresh cuts (CPR, no stand described yet) the cut
    layer's 2022 and 2023 cuts, which the overlay takes as in their photos,
    rather than undisturbed ground."""
    kind = STAND_REPLACING[p["origine"]]
    _, hi, common = photo.get(p["no_prg"], (None, None, None))
    under = (events[i] for i in tree.query(g, predicate="intersects"))
    ys = [y for y, k, _, eg in under if k == kind and (hi is None or y <= hi) and area_m2(shapely.intersection(g, eg)) >= MIN_PIECE_M2]
    y, how = (max(ys), "the event under it") if ys else (year_of((info.get(p["geocode"]) or {}).get("an_pro_ori")) or common, "its photo year")
    if y is None:
        return props, None
    dep, deptype = disturbance(p["origine"], y)
    return {**props, "year": y, "dep": dep, "deptype": deptype, "group": group_of(props["poly"], deptype, dep, props["conif"], props["hard"])}, how


# ---- the WMS, for what the WFS leaves out ----------------------------------------------

INFO_CACHE = CACHE / "featureinfo-ori_pee_close_scale.json"
INFO_KEYS = ("co_ter", "type_ter", "type_eco", "an_pro_ori", "toponyme")


def _info_at(x: float, y: float) -> list[dict]:
    """Every stand polygon the WMS has under a point, all attributes."""
    d = 0.0003  # a 61 px box this wide keeps the request inside the layer's close scales
    q = {
        "SERVICE": "WMS",
        "VERSION": "1.1.1",
        "REQUEST": "GetFeatureInfo",
        "LAYERS": "ori_pee_close_scale",
        "QUERY_LAYERS": "ori_pee_close_scale",
        "STYLES": "",
        "SRS": "EPSG:4326",
        "BBOX": f"{x - d},{y - d},{x + d},{y + d}",
        "WIDTH": "61",
        "HEIGHT": "61",
        "X": "30",
        "Y": "30",
        "INFO_FORMAT": "text/plain",
        "FEATURE_COUNT": "5",
    }
    txt = decode(get(ECOFOR, q, timeout=90))
    return [dict(re.findall(r"^\s+(\w+) = '(.*)'$", b, re.M)) for b in re.split(r"\n\s*Feature \d+:", txt)[1:]]


def feature_info(stands: list[tuple[dict, shapely.Geometry]]) -> dict[str, dict]:
    """The WMS attributes of these stands, by geocode, from the cache or asked
    for (four at a time, saved as it goes so an interrupted run resumes). A
    stand the WMS does not return under its own inside point gets {}."""
    info: dict[str, dict] = json.loads(INFO_CACHE.read_text(encoding="utf-8")) if INFO_CACHE.exists() else {}
    todo = [(p, g) for p, g in stands if p["geocode"] not in info]
    if not todo:
        return info
    print(f"  asking the WMS about {len(todo)} polygons ({len(info)} cached)")
    t0 = time.time()

    def one(pg):
        p, g = pg
        pt = g.representative_point()
        hit = next((r for r in _info_at(pt.x, pt.y) if r.get("geocode") == p["geocode"]), None)
        return p["geocode"], {k: hit.get(k, "") for k in INFO_KEYS} if hit else {}

    with ThreadPoolExecutor(max_workers=4) as pool:
        for i, (geo, rec) in enumerate(pool.map(one, todo), 1):
            info[geo] = rec
            if i % 200 == 0 or i == len(todo):
                INFO_CACHE.write_text(json.dumps(info, ensure_ascii=False), encoding="utf-8")
                print(f"  WMS: {i}/{len(todo)} ({time.time() - t0:.0f} s)")
    return info


def photo_years(stands: list[tuple[dict, shapely.Geometry]], info: dict[str, dict]) -> dict[str, tuple[int, int, int]]:
    """When each inventory programme's photos were taken here, as (first,
    last, most common) year, from the polygons the WMS was asked about; a
    programme with none of those gets a few of its stands asked."""
    by: dict[str, list[int]] = {}
    for p, _ in stands:
        y = year_of((info.get(p["geocode"]) or {}).get("an_pro_ori"))
        if y:
            by.setdefault(p["no_prg"], []).append(y)
    unseen = sorted({p["no_prg"] for p, _ in stands} - set(by))
    if unseen:
        sample = [pg for prg in unseen for pg in [pg for pg in stands if pg[0]["no_prg"] == prg][:8]]
        info.update(feature_info(sample))
        return photo_years(stands, info) if any(year_of((info.get(p["geocode"]) or {}).get("an_pro_ori")) for p, _ in sample) else _years(by)
    return _years(by)


def _years(by: dict[str, list[int]]) -> dict[str, tuple[int, int, int]]:
    return {prg: (min(ys), max(ys), max(set(ys), key=ys.count)) for prg, ys in by.items()}


# ---- the bake ------------------------------------------------------------------------


def area_m2(g) -> float:
    lat = math.radians((REGION["south"] + REGION["north"]) / 2)
    return g.area * 111_320 * math.cos(lat) * 110_574


def translate(p: dict, info: dict, photo: dict[str, tuple[int, int, int]]) -> dict:
    """One stand's attributes in the normal form."""
    tc = p.get("type_couv") or ""
    rec = info.get(p["geocode"]) or {}
    if tc:
        poly = "TMS" if organic(p.get("dep_sur") or "") and (p.get("cl_drai") or "") in WET_DRAINAGE else "FOR"
    else:
        poly = POLYTYPE.get(rec.get("co_ter") or "") or {"EAU": "WAT", "ILE": "ISL"}.get(rec.get("type_ter") or "", "")
    species, conif, hard = composition(p.get("gr_ess") or "", tc) if tc else ("", 0, 0)
    year = year_of(p.get("an_origine"))
    if year is None and tc:
        age = stand_age(p.get("cl_age") or "")
        shot = year_of(rec.get("an_pro_ori")) or (photo.get(p["no_prg"]) or (None, None, None))[2]
        year = shot - age if age is not None and shot else None
    dep, deptype = disturbance(p.get("origine") or "", p.get("an_origine"))
    return {
        "group": group_of(poly, deptype, dep, conif, hard),
        "species": species,
        "year": year,
        "ht": HEIGHT_M.get(p.get("cl_haut") or "") if tc else None,
        "cc": CLOSURE.get(p.get("cl_dens") or "") if tc else None,
        "sc": None,  # the carte has no site class (nothing reads it)
        "conif": conif,
        "hard": hard,
        "poly": poly,
        "dep": dep,
        "deptype": deptype,
        "eco": rec.get("type_eco") or None,
    }


def load_events(box) -> list[tuple[int, str, str, shapely.Geometry]]:
    """The stand-replacing events of the three disturbance layers, as (year,
    deptype, origine code, outline cut to the region)."""
    out = []
    for typename in ("ms:ca_interv_for_close_scale", "ms:ca_feu_close_scale", "ms:ca_perturb_autre_close_scale"):
        for f in ecofor(typename, box):
            p = f["properties"]
            kind, y = STAND_REPLACING.get(p.get("origine") or ""), year_of(p.get("an_origine"))
            if not kind or not y or not f.get("geometry"):
                continue
            g = shapely.geometry.shape(f["geometry"])
            g = shapely.clip_by_rect(g if g.is_valid else shapely.make_valid(g), *box)
            if not g.is_empty:
                out.append((y, kind, p["origine"], g))
    return out


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    t0 = time.time()
    box = box_of()
    print(f"{REGION['name']} ({area.ID}): carte écoforestière over {box}")

    raw = ecofor("ms:ori_pee_close_scale", box, tile_deg=0.1)
    stands: list[tuple[dict, shapely.Geometry]] = []
    for f in raw:
        if not f.get("geometry"):
            continue
        g = shapely.geometry.shape(f["geometry"])
        g = shapely.clip_by_rect(g if g.is_valid else shapely.make_valid(g), *box)
        if not g.is_empty:
            stands.append((f["properties"], g))
    codes = {(p.get("gr_ess") or "")[i : i + 2] for p, _ in stands for i in range(0, len(p.get("gr_ess") or ""), 2)}
    if unknown := sorted(codes - set(SPECIES)):
        print(f"  species codes not in the table (left out of the composition): {', '.join(unknown)}")

    no_stand = [(p, g) for p, g in stands if not p.get("type_couv")]
    info = feature_info(no_stand)
    photo = photo_years(stands, info)
    print("  photos: " + ", ".join(f"programme {k} {lo}" + (f"-{hi}" if hi != lo else "") for k, (lo, hi, _) in sorted(photo.items())))

    events = load_events(box)
    tree = shapely.STRtree([e[3] for e in events])
    print(f"  {len(events)} stand-replacing events: " + ", ".join(f"{k} {n}" for k, n in sorted(_tally(f"{e[2]} {e[0]}" for e in events).items())))

    # the events that came after each stand's photo
    plans, dated = [], {}
    for p, g in stands:
        props = translate(p, info, photo)
        if STAND_REPLACING.get(p.get("origine") or "") and props["year"] is None:
            props, how = date_origin(p, g, props, info, photo, events, tree)
            if how:
                key = f"{p['origine']} {props['year']} by {how}"
                dated[key] = dated.get(key, 0) + area_m2(g) / 1e4
        lo, hi, _ = photo.get(p["no_prg"], (None, None, None))
        cands = []
        if lo is not None and props["poly"] in OVERLAID:
            # an event before the first photo of the stand's programme is in the photo
            cands = [events[i] for i in tree.query(g, predicate="intersects") if events[i][0] >= lo]
        plans.append((p, g, props, cands))
    # an event in the programme's photo years (two summers, or the one): the stand's own
    # photo year decides
    unsure = [(p, g) for p, g, _, cands in plans if any(e[0] <= photo[p["no_prg"]][1] for e in cands)]
    if unsure:
        info = feature_info(unsure)

    feats, redated = [], {}
    for p, g, props, cands in plans:
        if cands and any(e[0] <= photo[p["no_prg"]][1] for e in cands):
            own = year_of((info.get(p["geocode"]) or {}).get("an_pro_ori")) or photo[p["no_prg"]][1]
            # one before the stand's own photo is in it; one that year only if the stand shows it
            cands = [e for e in cands if e[0] > own or (e[0] == own and not shows(p, e))]
        rest = g
        for y, kind, code, eg in sorted(cands, key=lambda e: (-e[0], SAME_YEAR_ORDER[e[1]])):  # the newest on top
            part = shapely.intersection(rest, eg)
            if area_m2(part) < MIN_PIECE_M2:
                continue
            dep = y if YEAR - y <= DEP_YEARS else None
            if props["poly"] in DATED_ONLY:  # the ground stays what the map says; the event dates it
                ev = {**props, "year": y, "dep": dep, "deptype": kind if dep else None}
                ev["group"] = group_of(props["poly"], ev["deptype"], dep, props["conif"], props["hard"])
            else:
                # what grows there now is not on the map: the land cover decides it
                ev = {**props, "species": "", "year": y, "ht": None, "cc": None, "conif": 0, "hard": 0, "poly": "", "dep": dep, "deptype": kind if dep else None}
                ev["group"] = group_of("", ev["deptype"], dep, 0, 0)
            feats.append((part, ev))
            redated[f"{code} {y}"] = redated.get(f"{code} {y}", 0) + area_m2(part) / 1e4
            rest = shapely.difference(rest, eg)
            if rest.is_empty:
                break
        if not rest.is_empty and (rest is g or area_m2(rest) >= MIN_PIECE_M2):
            feats.append((rest, props))

    out = []
    for g, props in feats:
        g = tidy(g, 0.00003)  # as build_forest.py simplifies the FRI
        if g is not None:
            out.append(feature(g, props))
    write_geojson("forest", out, "Carte écoforestière (MRNF), with later cuts, burns and outbreaks")

    last = max((e[0] for e in events), default=None)
    photos = "; ".join(f"programme {k} photos {lo}" + (f"-{hi}" if hi != lo else "") for k, (lo, hi, _) in sorted(photo.items()))
    area.note_source(
        f"forest-{area.ID}.geojson",
        source="Carte écoforestière (MRNF): the stands as photo-interpreted, with later cuts, plantations, burns and outbreaks laid over",
        licence="CC BY 4.0",
        vintage=photos + (f"; events to {last}" if last else ""),
    )
    print("  group: " + json.dumps(_tally(f["properties"]["group"] for f in out)))
    print("  poly: " + json.dumps(_tally(f["properties"]["poly"] for f in out)))
    print("  deptype: " + json.dumps(_tally(str(f["properties"]["deptype"]) for f in out)))
    print("  lead species: " + json.dumps(_tally((f["properties"]["species"] or "--")[:2] for f in out)))
    if redated:
        print("  re-dated by later events (ha): " + ", ".join(f"{k} {v:.0f}" for k, v in sorted(redated.items())))
    if dated:
        print("  undated origins dated (ha): " + ", ".join(f"{k} {v:.0f}" for k, v in sorted(dated.items())))
    here = shapely.Point(*area.HOME)
    at = next((f["properties"] for f in out if shapely.geometry.shape(f["geometry"]).covers(here)), None)
    print(f"  the stand at the centre: {at}")
    print(f"done in {time.time() - t0:.0f} s")
    return 0


def _tally(items) -> dict:
    out: dict = {}
    for v in items:
        out[v] = out.get(v, 0) + 1
    return dict(sorted(out.items(), key=lambda kv: -kv[1]))


if __name__ == "__main__":
    sys.exit(main())
