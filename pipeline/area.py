"""The area a bake is for: app/src/areas/<id>.json, the one description of an
area that the app and the pipeline both read (docs/AREAS.md).

Every bake script gets the area through common.py, which takes its names
from here. The id comes from `--area <id>` (or `--area=<id>`) on the command
line, else the HUNTAPP_AREA environment variable, else Pickle Lake. The flag
is taken out of sys.argv when this module is imported: several scripts read
argv as layer names or a URL, and the argparse ones would reject a flag they
do not know.

    py -3.14 pipeline/build_contours.py --area lac-bailey
    HUNTAPP_AREA=lac-bailey py -3.14 pipeline/build_contours.py

OUT_DIR is the area's bake.outDir: Pickle Lake's files stay flat in
app/public/data under their old names, other areas' go in
app/public/data/areas/<id>/. HUNTAPP_OUT points it somewhere else for a
scratch run, for example to compare a rebake with the published files
without touching them. CACHE_DIR (pipeline/raw) is shared by every area: its
files already carry the area id in their names. A scratch run keeps the
caches it makes from its own inputs in OUT_DIR as well (the point cloud's
vegstructure npz, the 1 m lake mask, the microclimate's debug grids), and
the steps after read them from there (cached()).

Standard library only, so the py -3.13 scripts (pyogrio, no rasterio) can
import it as well as the py -3.14 ones.
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
AREAS_DIR = ROOT / "app" / "src" / "areas"
CACHE_DIR = ROOT / "pipeline" / "raw"
DEFAULT_AREA = "pickle-lake"
ID_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")

# Pickle Lake's boxes as app/src/config.ts held them before areas. Every
# published Pickle file was baked from these, so if its area file drifts,
# a rebake would quietly move the grids under phones that already have the
# maps: stop instead.
PICKLE_LAKE = {
    "region": (-85.72, 48.86, -85.46, 49.0),
    "core": (-85.65, 48.895, -85.535, 48.967),
    "maxzoom": 16,
    "regionMaxzoom": 13,
    "outDir": "app/public/data",
}
WSEN = ("west", "south", "east", "north")


def take_area_flag(argv: list[str]) -> str | None:
    """The id from --area X or --area=X, removed from argv in place."""
    found = []
    i = 1
    while i < len(argv):
        a = argv[i]
        if a == "--area":
            if i + 1 >= len(argv):
                raise SystemExit("--area needs an area id")
            found.append(argv[i + 1])
            del argv[i : i + 2]
        elif a.startswith("--area="):
            found.append(a.split("=", 1)[1])
            del argv[i]
        else:
            i += 1
    if len(set(found)) > 1:
        raise SystemExit(f"--area given more than once: {', '.join(found)}")
    return found[0] if found else None


def area_path(area_id: str) -> Path:
    return AREAS_DIR / f"{area_id}.json"


def load(area_id: str) -> dict:
    """An area file, checked enough that a bad one fails here and not halfway
    through a bake."""
    if not ID_RE.match(area_id):
        raise SystemExit(f"bad area id {area_id!r}: lower-case letters, digits and hyphens only")
    p = area_path(area_id)
    if not p.exists():
        have = ", ".join(sorted(q.stem for q in AREAS_DIR.glob("*.json"))) or "none"
        raise SystemExit(f"no area {area_id!r}: {p} is missing (areas: {have})")
    a = json.loads(p.read_text(encoding="utf-8"))
    if a.get("id") != area_id:
        raise SystemExit(f"{p.name} says its id is {a.get('id')!r}: the file name and the id must match")
    r, c = a["region"], a["core"]
    if not (r["west"] < r["east"] and r["south"] < r["north"]):
        raise SystemExit(f"{p.name}: the region box is inside out")
    if not (r["west"] <= c["west"] < c["east"] <= r["east"] and r["south"] <= c["south"] < c["north"] <= r["north"]):
        # the going grid is cut out of the habitat grid, the core out of the region
        raise SystemExit(f"{p.name}: the core must lie inside the region")
    return a


def adapter(bake: dict, kind: str) -> str | None:
    """The source adapter for one kind of input (vectors, forest, imagery,
    pointcloud), whether the area gives it as a name or as {adapter: ...}."""
    v = bake.get(kind)
    if isinstance(v, dict):
        return v.get("adapter")
    return v or None


def options(bake: dict, kind: str) -> dict:
    """The settings that go with an adapter given as an object, else {}."""
    v = bake.get(kind)
    return v if isinstance(v, dict) else {}


def hrdem_project(url: str) -> str:
    """ON-SPL_ON_White_Lake_UTM16_2021-1m out of an HRDEM DTM's URL."""
    return url.rsplit("/", 1)[-1].removesuffix("-dtm.tif")


def hrdem_years(url: str) -> str:
    """The survey year(s) an HRDEM project is named for: 2021, or 2015-17."""
    m = re.search(r"_((?:19|20)\d\d)(?:_(\d\d))?-\d+m", hrdem_project(url))
    return (m.group(1) + (f"-{m.group(2)}" if m.group(2) else "")) if m else ""


def _check_pickle(region: dict, core: dict, region_maxzoom: int, bake: dict) -> None:
    got = {
        "region": tuple(region[k] for k in WSEN),
        "core": tuple(core[k] for k in WSEN),
        "maxzoom": core["maxzoom"],
        "regionMaxzoom": region_maxzoom,
        "outDir": bake.get("outDir"),
    }
    bad = [f"{k} {got[k]} (baked with {want})" for k, want in PICKLE_LAKE.items() if got[k] != want]
    if bad:
        raise SystemExit(
            "pickle-lake.json no longer matches the boxes every published Pickle Lake file was baked from: "
            + "; ".join(bad)
            + ". Put it back, or rebake and republish every Pickle Lake layer on purpose."
        )


# ---- the active area ------------------------------------------------------

ID = take_area_flag(sys.argv) or os.environ.get("HUNTAPP_AREA") or DEFAULT_AREA
os.environ["HUNTAPP_AREA"] = ID  # a script that starts another bakes the same area
AREA = load(ID)
REGION = {"id": AREA["id"], "name": AREA["name"], **{k: float(AREA["region"][k]) for k in WSEN}}
CORE = {**{k: float(AREA["core"][k]) for k in WSEN}, "maxzoom": int(AREA["core"]["maxzoom"])}
REGION_MAXZOOM = int(AREA["regionMaxzoom"])
HOME = (float(AREA["centre"][0]), float(AREA["centre"][1]))  # lon, lat
JURISDICTION = AREA["jurisdiction"]
BAKE = AREA.get("bake") or {}
LAKE_SHEETS: list[str] = list(BAKE.get("lakeSheets") or [])  # MNR survey sheet ids (survey_depth.py)

if ID == DEFAULT_AREA:
    _check_pickle(REGION, CORE, REGION_MAXZOOM, BAKE)

_out = os.environ.get("HUNTAPP_OUT")
SCRATCH = bool(_out)  # baking somewhere other than the area's own folder
OUT_DIR = Path(_out).resolve() if _out else ROOT / BAKE.get("outDir", f"app/public/data/areas/{ID}")
if not SCRATCH and ROOT not in OUT_DIR.resolve().parents:
    raise SystemExit(f"{ID}: bake.outDir {BAKE.get('outDir')!r} must be inside the repo")
OUT_DIR.mkdir(parents=True, exist_ok=True)
CACHE_DIR.mkdir(parents=True, exist_ok=True)


def cached(name: str) -> Path:
    """A cache file a step reads that an earlier step makes
    (vegstructure-<id>.npz): on a scratch run the copy that run wrote into
    OUT_DIR, when it wrote one, so the run is checked on what it baked
    itself; else pipeline/raw's."""
    p = OUT_DIR / name
    return p if SCRATCH and p.exists() else CACHE_DIR / name


def summary_path(name: str) -> Path:
    """Where a bake's human-readable summary goes (build_going.py and kin):
    pipeline/bake-<name>-summary.json for Pickle Lake as before, with the id
    added for other areas, and into OUT_DIR on a scratch run so the
    committed ones stay as they are."""
    if SCRATCH:
        return OUT_DIR / f"bake-{name}-summary.json"
    if ID == DEFAULT_AREA:
        return ROOT / "pipeline" / f"bake-{name}-summary.json"
    return ROOT / "pipeline" / f"bake-{name}-summary-{ID}.json"


# ---- provenance: where each baked file came from --------------------------

# Never in OUT_DIR for a real bake: Pickle Lake's OUT_DIR is the published
# data folder, and every file in it is hashed into the app's manifest.
PROVENANCE = (OUT_DIR if SCRATCH else CACHE_DIR) / f"provenance-{ID}.json"


def note_source(file: str, **fields) -> None:
    """Record where a baked file in OUT_DIR came from, for the coverage
    report bake_area.py writes into the area file. Fields: source, licence,
    vintage, note (any of them; a later note replaces a field, None drops
    it). For example

        note_source(f"waterbody-{ID}.geojson", source="GRHQ lakes (MRNF)", licence="CC BY 4.0", vintage="2024")
    """
    notes = json.loads(PROVENANCE.read_text(encoding="utf-8")) if PROVENANCE.exists() else {}
    entry = notes.get(file, {})
    for k, v in fields.items():
        if v is None:
            entry.pop(k, None)
        else:
            entry[k] = v
    notes[file] = entry
    PROVENANCE.write_text(json.dumps(notes, indent=1, ensure_ascii=False), encoding="utf-8")


def read_sources() -> dict:
    return json.loads(PROVENANCE.read_text(encoding="utf-8")) if PROVENANCE.exists() else {}


# ---- writing back to an area file -------------------------------------------
#
# The area files are hand-formatted (short objects on one line) and the app's
# side of them is edited by hand too, so a value is written by replacing
# just its own text: the rest of the file keeps its bytes.


def _skip_ws(t: str, i: int) -> int:
    while t[i] in " \t\r\n":
        i += 1
    return i


def _value_end(t: str, i: int) -> int:
    """The index just past the JSON value that starts at t[i]."""
    if t[i] == '"':
        j = i + 1
        while t[j] != '"':
            j += 2 if t[j] == "\\" else 1
        return j + 1
    if t[i] in "{[":
        depth, j, in_str = 0, i, False
        while True:
            ch = t[j]
            if in_str:
                if ch == "\\":
                    j += 1
                elif ch == '"':
                    in_str = False
            elif ch == '"':
                in_str = True
            elif ch in "{[":
                depth += 1
            elif ch in "}]":
                depth -= 1
                if depth == 0:
                    return j + 1
            j += 1
    j = i
    while t[j] not in ",}] \t\r\n":
        j += 1
    return j


def _members(t: str, i: int) -> tuple[list[tuple[str, int, int]], int]:
    """The members of the object whose '{' is at t[i], as (key, value start,
    value end), and the index of its closing '}'."""
    out = []
    i += 1
    while True:
        i = _skip_ws(t, i)
        if t[i] == "}":
            return out, i
        if t[i] == ",":
            i += 1
            continue
        k1 = _value_end(t, i)
        key = json.loads(t[i:k1])
        i = _skip_ws(t, k1)
        if t[i] != ":":
            raise ValueError(f"expected ':' after {key!r}")
        v0 = _skip_ws(t, i + 1)
        v1 = _value_end(t, v0)
        out.append((key, v0, v1))
        i = v1


def _key(k: str) -> str:
    return json.dumps(k, ensure_ascii=False)


def dumps(v, level: int = 0, prefix: int = 0, width: int = 150) -> str:
    """JSON in the area files' style: an object or list on one line when it
    fits, else one member per line, two-space indents. `level` is the indent
    of the line the value starts on, `prefix` the length of the key before
    it there."""
    if isinstance(v, (dict, list)) and v:
        if isinstance(v, dict):
            flat = "{ " + ", ".join(f"{_key(k)}: {dumps(x, width=10**9)}" for k, x in v.items()) + " }"
        else:
            flat = "[" + ", ".join(dumps(x, width=10**9) for x in v) + "]"
        if 2 * level + prefix + len(flat) + 1 <= width:
            return flat
        pad = "  " * (level + 1)
        if isinstance(v, dict):
            body = [f"{pad}{_key(k)}: {dumps(x, level + 1, len(_key(k)) + 2, width)}" for k, x in v.items()]
            return "{\n" + ",\n".join(body) + "\n" + "  " * level + "}"
        return "[\n" + ",\n".join(pad + dumps(x, level + 1, 0, width) for x in v) + "\n" + "  " * level + "]"
    return json.dumps(v, ensure_ascii=False)


def _set_in_text(t: str, path: list[str], value) -> str:
    """t with the member at path (["bake", "lakeSheets"]) set to value:
    replaced where it is, or added as the object's last member."""
    i = _skip_ws(t, 0)
    for depth, key in enumerate(path):
        if t[i] != "{":
            raise ValueError(f"{'.'.join(path[:depth])} is not an object")
        members, close = _members(t, i)
        hit = next((m for m in members if m[0] == key), None)
        if depth == len(path) - 1:
            text = dumps(value, depth + 1, len(_key(key)) + 2)
            if hit:
                return t[: hit[1]] + text + t[hit[2] :]
            pad = "  " * (depth + 1)
            if members:
                end = members[-1][2]
                return t[:end] + f",\n{pad}{_key(key)}: {text}" + t[end:]
            return t[: i + 1] + f"\n{pad}{_key(key)}: {text}\n" + "  " * depth + t[close:]
        if not hit:
            raise ValueError(f"no {'.'.join(path[: depth + 1])} to write into")
        i = hit[1]
    raise ValueError("empty path")


def set_area_values(area_id: str, values: dict[str, object]) -> None:
    """Write values into an area file, keyed by dotted path ("coverage",
    "bake.lakeSheets"). Only those values' text changes. The file is read
    again just before writing and the edit redone if someone changed it in
    between (the app's fields are edited by hand), and the result must parse
    to exactly the old content plus these values."""
    p = area_path(area_id)
    for _ in range(5):
        before = p.read_text(encoding="utf-8")
        want = json.loads(before)
        t = before
        for dotted, v in values.items():
            path = dotted.split(".")
            t = _set_in_text(t, path, v)
            node = want
            for k in path[:-1]:
                node = node[k]
            node[path[-1]] = v
        if json.loads(t) != want:
            raise SystemExit(f"{p.name}: the edit did not come out as intended; nothing written")
        if p.read_text(encoding="utf-8") != before:
            continue  # changed under us: redo the edit on the new text
        p.write_text(t, encoding="utf-8", newline="\n")
        return
    raise SystemExit(f"{p.name} kept changing while being written; try again")
