"""Bake one area end to end, or start a new area from a point.

    py -3.14 pipeline/bake_area.py --area lac-bailey                    # every step, in order
    py -3.14 pipeline/bake_area.py --area lac-bailey --from habitat     # that step and the ones after it
    py -3.14 pipeline/bake_area.py --area lac-bailey --only satellite --only historical
    py -3.14 pipeline/bake_area.py --area lac-bailey --list             # the plan, nothing run
    py -3.14 pipeline/bake_area.py --area pickle-lake --only coverage   # just the coverage report

Each step runs as its own process, under the interpreter it needs (py -3.13
has pyogrio for the file geodatabases, py -3.14 has rasterio, scipy and
laspy), with the area in HUNTAPP_AREA. Separate processes also matter
because the scripts fix the area in module constants when imported. Output
goes to the console and to pipeline/bake-<id>.log.

The sources come from the province's adapters, named in the area's bake
object: Ontario's are build_vectors.py (LIO), build_forest.py (FRI) and
fetch_pointcloud.py (FRI leaf-on); Quebec's are qc_vectors.py,
qc_forest.py and qc_pointcloud.py. Steps a province has no source for are
skipped with the reason: the lake survey sheets, lake depths and lake
facts are Ontario's.

A failed step does not stop the bake. The steps that need its output are
skipped and the rest run. At the end the coverage report goes into the area
file ("coverage"): for each layer the file, its size, source, licence and
vintage, or why it is missing.

Pickle Lake is published and in use in the field, so its files are not
rebaked unless HUNTAPP_OUT points the bake at a scratch folder, or
--overwrite-published says so.

A new area from a point:

    py -3.14 pipeline/bake_area.py --new --lat 49.40955 --lon -69.55349 --name "Lac Bailey" --jurisdiction QC [--bake]

writes app/src/areas/<id>.json: Pickle Lake's region and core sizes centred
on the point (--core-km / --region-km for half-widths of your own), the
province's adapters, the NTS sheets and HRDEM projects that cover it, and
the compass declination (WMM through pygeomag when it is installed, else
null).
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
import unicodedata
from collections import deque
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Callable

import habfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent

# kind (bake.<kind>) -> adapter -> (interpreter, script and arguments)
ADAPTERS: dict[str, dict[str, tuple[str, list[str]]]] = {
    "vectors": {
        "on.lio": ("3.14", ["build_vectors.py", "bake"]),
        "qc": ("3.13", ["qc_vectors.py", "--area", "{id}"]),  # pyogrio: the TRQ territories are a file geodatabase
        "yt": ("3.14", ["yt_vectors.py", "--area", "{id}"]),
        "bc": ("3.14", ["bc_vectors.py", "--area", "{id}"]),  # the BC Geographic Warehouse's open WFS
    },
    "forest": {
        "on.fri": ("3.13", ["build_forest.py"]),  # pyogrio: the FRI is a file geodatabase
        "qc.ecoforestier": ("3.14", ["qc_forest.py", "--area", "{id}"]),
        # anywhere in Canada with no provincial stands: inferred from the CFS's national 30 m maps
        "ca.scanfi": ("3.14", ["ca_forest.py", "--area", "{id}"]),
        "bc.vri": ("3.14", ["bc_forest.py", "--area", "{id}"]),  # the province's Vegetation Resources Inventory
    },
    "pointcloud": {
        # the index read needs pyogrio once; it is cached after
        "on.fri_leafon": ("3.13", ["fetch_pointcloud.py", "--radius-km", "{radiusKm}", "--max-gb", "{maxGb}"]),
        "qc.mrnf_laz": ("3.14", ["qc_pointcloud.py", "--area", "{id}"]),
    },
}
POINTCLOUD_DEFAULTS = {"radiusKm": 2, "maxGb": 15}
MNR_SHEETS = "Lake survey sheets © Ontario Ministry of Natural Resources"

# summaries some scripts still write straight into pipeline/ (Pickle Lake's,
# committed): another area's run must not overwrite them (area.summary_path)
SHARED_SUMMARIES = ("habitat", "vegstructure", "going")


@dataclass
class Step:
    name: str
    py: str  # "3.13" or "3.14"
    cmds: list[list[str]]  # pipeline scripts and their arguments, run in turn
    skip: str | None = None  # why this area has no such step
    needs: tuple[str, ...] = ()  # steps whose failure makes this one pointless
    check: Callable[[], str | None] | None = None  # what is missing before it can run


def adapter_step(name: str, kind: str, a: dict) -> Step:
    """The step that runs the area's adapter for one kind of source."""
    from area import adapter, options

    bake = a.get("bake") or {}
    which = adapter(bake, kind)
    if not which:
        return Step(name, "3.14", [], skip=f"no {kind} source for this area (bake.{kind})")
    if which not in ADAPTERS[kind]:
        return Step(name, "3.14", [], skip=f"no adapter called {which!r} for {kind}")
    py, cmd = ADAPTERS[kind][which]
    fill = {"id": a["id"], **POINTCLOUD_DEFAULTS, **options(bake, kind)}
    return Step(name, py, [[c.format(**fill) for c in cmd]])


def plan(a: dict) -> list[Step]:
    """The area's steps in an order that respects every dependency. The
    point cloud comes before the habitat, which reads its bush from it
    where the area says so (bake.habitatBush); the point cloud's own bake
    needs the LiDAR DTM and the lakes (hillshade, vectors)."""
    bake = a.get("bake") or {}
    ontario = a["jurisdiction"] == "ON"
    # no 1 m LiDAR over the core (bake.lidar "none", set by --new when NRCan
    # has no survey there): the hillshade step makes the core's elevation grid
    # from the 30 m MRDEM instead, for the DEM and the going grid, and the
    # MRDEM's contours (contours-wide) stand in for the LiDAR's
    no_lidar = bake.get("lidar") == "none"
    sheets = list(bake.get("lakeSheets") or [])
    bathy = HERE / "raw" / "bathy"
    # the 30 m MRDEM hillshade only where the area's maps use it: one with a
    # DEM shades its relief from that (mapStyle.ts), and the WMS is slow
    topo = ["topo", *(["hillshade-mrdem"] if "hillshade" in (a.get("files") or {}).get("pmtiles", []) else [])]

    def sheets_fitted() -> str | None:
        unfit = [s for s in sheets if not (bathy / f"{s}_geo.tif").exists()]
        if unfit:
            return "fit each sheet to its lake by hand first (georef_lake_sheet.py raw/bathy/<id>.jpg \"<lake>\"): " + ", ".join(unfit)
        return None

    def inputs(*themes: str) -> Callable[[], str | None]:
        """A check that the adapters' GeoJSON a grid is made from is on disk.
        Not all of it is committed (Lac Bailey's forest, wetlands and
        streams are not), and the grids' bakes skip a missing input with a
        line in the log: a fresh clone would bake a habitat with no stands,
        wetlands or streams and exit 0."""

        def check() -> str | None:
            import area  # the area being baked, imported by bake() already

            step = {"forest": "forest", "wetland": "vectors", "watercourse": "vectors"}
            missing = [t for t in themes if area.adapter(bake, step[t]) and not (area.OUT_DIR / f"{t}-{a['id']}.geojson").exists()]
            if not missing:
                return None
            names = ", ".join(f"{t}-{a['id']}.geojson" for t in missing)
            run = list(dict.fromkeys(step[t] for t in missing))
            return f"{names} not in {area.OUT_DIR}: run the {' and '.join(run)} step{'s' if len(run) > 1 else ''} first"

        return check

    return [
        Step("rasters", "3.14", [["rasters.py"]]),
        adapter_step("vectors", "vectors", a),
        adapter_step("forest", "forest", a),
        Step("topo", "3.14", [["build_tiles.py", *topo]]),
        Step(
            "satellite",
            "3.14",
            # a province's tile service (build_tiles.IMAGERY), or where none covers the area
            # the Sentinel-2 leaf-on composite (s2_imagery.py, adapter ca.s2summer)
            [["s2_imagery.py"] if str(bake.get("imagery") or "").startswith("ca.s2") else ["build_tiles.py", "satellite"]],
            skip=None if bake.get("imagery") else "no imagery source for this area (bake.imagery)",
        ),
        Step("historical", "3.14", [["build_historical.py"]], skip=None if bake.get("nts") else "no NTS sheets listed (bake.nts)"),
        Step("hillshade", "3.14", [["build_hillshade.py"]], needs=("vectors",)),
        Step("dem", "3.14", [["build_dem.py"]]),
        Step("contours", "3.14", [["build_contours.py"]], skip="no 1 m LiDAR here: the MRDEM's contours stand in" if no_lidar else None),
        Step("contours-wide", "3.14", [["build_contours_wide.py"]], needs=("dem",)),
        adapter_step("pointcloud", "pointcloud", a),
        Step("vegstructure", "3.14", [["build_vegstructure.py"]], skip=None if bake.get("pointcloud") else "no point cloud for this area", needs=("pointcloud",)),
        Step("habitat", "3.14", [["build_habitat.py"]], needs=("rasters", "vectors", "forest"), check=inputs("forest", "wetland", "watercourse")),
        # the area's habitat profile (treeline, ecoregion, what the stand map is good for) into its file
        Step("profile", "3.14", [["build_profile.py"]], needs=("habitat",)),
        Step(
            "bush",
            "3.14",
            [["bush/render.py"]],
            skip="the point cloud's own bush layer (vegstructure)" if bake.get("pointcloud") else ("bake.habitatBush is estimate" if bake.get("habitatBush") == "estimate" else None),
            needs=("habitat",),
        ),
        Step(
            "lake-sheets",
            "3.14",
            [
                ["survey_depth.py", "--all"],
                ["build_habitat.py"],  # again: it picks the survey depths up
                ["build_raster.py", "bathysheets", *[str(bathy / f"{s}_geo.tif") for s in sheets], "--minz", "12", "--maxz", "17", "--all", "--attribution", MNR_SHEETS],
            ],
            skip=None if sheets else "no lake survey sheets for this area (bake.lakeSheets; Ontario MNR only)",
            needs=("habitat",),
            check=sheets_fitted,
        ),
        Step("depth-bands", "3.14", [["build_depth_bands.py"]], skip=None if ontario else "lake depths are Ontario only (ARA and the MNR sheets)", needs=("habitat",)),
        Step("micro", "3.14", [["build_microclimate.py"]], needs=("habitat",)),
        Step("going", "3.14", [["build_going.py"]], needs=("hillshade", "habitat", "vectors"), check=inputs("wetland", "watercourse")),
        Step("vector-tiles", "3.14", [["build_vector_tiles.py"]]),
    ]


def interpreter(version: str) -> list[str]:
    """The command for a Python version: HUNTAPP_PY313 / HUNTAPP_PY314 when
    set, else this interpreter when it is that version, else the py
    launcher (Windows) or pythonX.Y on the PATH."""
    env = os.environ.get(f"HUNTAPP_PY{version.replace('.', '')}")
    if env:
        return env.split()
    if f"{sys.version_info.major}.{sys.version_info.minor}" == version:
        return [sys.executable]
    if shutil.which("py"):
        return ["py", f"-{version}"]
    if exe := shutil.which(f"python{version}"):
        return [exe]
    raise SystemExit(f"no Python {version} found: set HUNTAPP_PY{version.replace('.', '')}")


class Log:
    """Everything a run prints, to the console and the area's log."""

    def __init__(self, path: Path):
        self.f = open(path, "a", encoding="utf-8")

    def __call__(self, line: str = "") -> None:
        sys.stdout.write(line + "\n")
        sys.stdout.flush()
        self.f.write(line + "\n")
        self.f.flush()


def run_cmd(cmd: list[str], py: str, area_id: str, log: Log) -> tuple[int, str]:
    """One pipeline script in its own process: (exit code, its last words)."""
    argv = [*interpreter(py), str(HERE / cmd[0]), *cmd[1:]]
    log(f"   $ {' '.join(argv)}")
    env = {**os.environ, "HUNTAPP_AREA": area_id, "PYTHONIOENCODING": "utf-8", "PYTHONUNBUFFERED": "1"}
    tail: deque[str] = deque(maxlen=12)
    with subprocess.Popen(argv, cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace") as p:
        for line in p.stdout:
            line = line.rstrip("\r\n")
            log("   " + line)
            if line.strip():
                tail.append(line.strip())
        rc = p.wait()
    return rc, (tail[-1] if tail else "")


class KeepSharedSummaries:
    """Around a step of another area (or a scratch run): a summary a script
    wrote over Pickle Lake's committed one goes to the area's own path
    (area.summary_path) and Pickle Lake's is put back."""

    def __init__(self, area_mod):
        self.area = area_mod
        self.active = area_mod.ID != area_mod.DEFAULT_AREA or area_mod.SCRATCH

    def __enter__(self):
        self.before = {}
        if self.active:
            for name in SHARED_SUMMARIES:
                p = HERE / f"bake-{name}-summary.json"
                self.before[name] = p.read_bytes() if p.exists() else None
        return self

    def __exit__(self, *exc):
        for name, old in self.before.items():
            p = HERE / f"bake-{name}-summary.json"
            now = p.read_bytes() if p.exists() else None
            if now == old:
                continue
            if now is not None:
                self.area.summary_path(name).write_bytes(now)
            if old is None:
                p.unlink(missing_ok=True)
            else:
                p.write_bytes(old)
        return False


def bake(args) -> int:
    import area  # the area being baked: HUNTAPP_AREA is set by now

    a = area.AREA
    steps = plan(a)
    names = [s.name for s in steps] + ["coverage"]
    for n in [*(args.only or []), *([args.start] if args.start else [])]:
        if n not in names:
            raise SystemExit(f"no step {n!r}; the steps are: {', '.join(names)}")
    chosen = set(args.only) if args.only else set(names[names.index(args.start) :] if args.start else names)

    if args.list:
        print(f"{a['name']} ({a['id']}, {a['jurisdiction']}) into {area.OUT_DIR}")
        for s in steps:
            mark = "  " if s.name in chosen else "- "
            if s.skip:
                print(f"{mark}{s.name:14} skipped: {s.skip}")
            else:
                print(f"{mark}{s.name:14} py {s.py}: " + " ; ".join(" ".join(c) for c in s.cmds))
        print(f"{'  ' if 'coverage' in chosen else '- '}{'coverage':14} written into {area.area_path(a['id']).relative_to(ROOT)}")
        return 0

    published = a["id"] == area.DEFAULT_AREA and not area.SCRATCH
    if published and not args.overwrite_published and chosen - {"coverage"}:
        raise SystemExit(
            "Pickle Lake is published and in use in the field: bake it into a scratch folder (HUNTAPP_OUT=<dir>) "
            "to compare, or pass --overwrite-published to replace its files"
        )

    log = Log(HERE / f"bake-{a['id']}.log")
    log(f"== {datetime.now():%Y-%m-%d %H:%M} bake {a['id']} into {area.OUT_DIR}: {', '.join(n for n in names if n in chosen)}")
    results: dict[str, str] = {}
    t_all = time.time()
    for s in steps:
        if s.name not in chosen:
            continue
        if s.skip:
            results[s.name] = f"skipped: {s.skip}"
            log(f"-- {s.name}: skipped, {s.skip}")
            continue
        failed = [n for n in s.needs if results.get(n, "").startswith("failed")]
        if failed:
            results[s.name] = f"skipped: {', '.join(failed)} failed"
            log(f"-- {s.name}: skipped, {', '.join(failed)} failed")
            continue
        missing = [c[0] for c in s.cmds if not (HERE / c[0]).exists()]
        why = f"pipeline/{', '.join(missing)} is not written yet" if missing else (s.check() if s.check else None)
        if why:
            results[s.name] = f"failed: {why}"
            log(f"-- {s.name}: cannot run, {why}")
            continue
        log(f"-- {s.name} (py {s.py})")
        t = time.time()
        with KeepSharedSummaries(area):
            for cmd in s.cmds:
                rc, last = run_cmd(cmd, s.py, a["id"], log)
                if rc:
                    results[s.name] = f"failed: {last or f'exit {rc}'}"
                    break
            else:
                results[s.name] = "ok"
        log(f"-- {s.name}: {results[s.name]} ({time.time() - t:.0f} s)")

    if "coverage" in chosen:
        cov = coverage(area, results)
        have = sum(1 for g in ("pmtiles", "geo", "baseGeo", "grids") for e in cov[g].values() if "file" in e)
        if area.SCRATCH:  # describes the scratch folder, not the area's files
            dest = area.OUT_DIR / f"coverage-{a['id']}.json"
            dest.write_text(json.dumps(cov, indent=1, ensure_ascii=False), encoding="utf-8")
        else:
            area.set_area_values(a["id"], {"coverage": cov})
            dest = area.area_path(a["id"])
            if found := unknowns(area):
                area.set_area_values(a["id"], found)
                log(f"-- filled in from the bake: {found}")
            if isinstance(a.get("zone"), dict) and a["zone"].get("name") is None and "zone.name" not in found:
                log(
                    "-- zone.name is still unknown, and the app leaves the area out until it is set: write it into the area file, "
                    f"or in Quebec fetch the zones for local use (qc_vectors.py --area {a['id']} wmu) and run the coverage step again"
                )
        log(f"-- coverage: {have} layers baked, written into {dest.name}")

    log(f"== done in {time.time() - t_all:.0f} s")
    for n, r in results.items():
        log(f"   {n:14} {r}")
    # what the area still lacks, said out loud (a step outside this bake,
    # like the momentum solve, is otherwise easy to miss)
    if not area.SCRATCH:
        from area_checklist import print_warnings
        print_warnings(a["id"])
    return 1 if any(r.startswith("failed") for r in results.values()) else 0


# ---- the coverage report --------------------------------------------------

OGL_ON, OGL_CA, CC_BY, OGL_YT, OGL_BC = "OGL-Ontario", "OGL-Canada", "CC BY 4.0", "OGL-Yukon", "OGL-BC"
DERIVED = "derived from the layers above"
PGC = "ArcticDEM: free, cite PGC (NSF OPP awards)"
# The app's layer keys (the "files" of an area file) and, for each, the
# file's name before "-<id>" and the step that makes it (to say why a layer
# is missing).
PMTILES = {
    "basemap": ("basemap", None),
    "topo": ("topo", "topo"),
    "satellite": ("satellite", "satellite"),
    "hillshade": ("hillshade", "topo"),
    "hillshadeLidar": ("hillshade-lidar", "hillshade"),
    "dem": ("dem", "dem"),
    "contours": ("contours", "contours"),
    "contoursWide": ("contours-wide", "contours-wide"),
    "forest": ("forest", "vector-tiles"),
    "understory": ("understory", "vegstructure"),  # or the bush step, for an area with no point cloud (coverage below)
    "lanes": ("lanes", "vegstructure"),
    "bathy": ("bathy", None),
    "historical": ("historical", "historical"),
    "bathySheets": ("bathysheets", "lake-sheets"),
    "places": ("places", "vector-tiles"),
}
GEO = {"wmu": "vectors", "camps": "vectors", "crown": "vectors", "parks": "vectors", "bathy": "vectors", "fire": "vectors", "roads": "vectors", "forest": "forest", "depth": "depth-bands"}
BASE_GEO = {"waterbody": "vectors"}
GRIDS = {"habitat": "habitat", "micro": "micro", "going": "going"}
NEVER_BAKED = {
    ("pmtiles", "basemap"): "not baked: the map draws the live NRCan base map",
    ("pmtiles", "bathy"): "not baked: lake depths are drawn from GeoJSON (depth)",
}
NOT_IN = {  # layers a province has no source for, or none open
    "QC": {
        ("geo", "wmu"): "not in the maps: the hunting zones' only source (SmartFaune) states no licence, so the area file names the zone instead",
        ("geo", "camps"): "Ontario only: Crown land camps come from LIO",
        ("geo", "crown"): "Ontario only: Crown land comes from LIO",
        ("geo", "bathy"): "Ontario only: lake bathymetry comes from LIO",
        ("geo", "depth"): "Ontario only: lake depths need the ARA lake facts and the MNR sheets",
        ("pmtiles", "bathySheets"): "Ontario only: MNR lake survey sheets",
        ("pmtiles", "bathy"): "Ontario only: lake depths need the ARA lake facts and the MNR sheets",
    },
    "YT": {
        ("geo", "camps"): "Ontario only: Crown land camps come from LIO",
        ("geo", "parks"): "none baked for the Yukon yet",
        ("geo", "bathy"): "Ontario only: lake bathymetry comes from LIO",
        ("geo", "depth"): "Ontario only: lake depths need the ARA lake facts and the MNR sheets",
        ("pmtiles", "bathySheets"): "Ontario only: MNR lake survey sheets",
        ("pmtiles", "bathy"): "Ontario only: lake depths need the ARA lake facts and the MNR sheets",
        ("pmtiles", "hillshadeLidar"): "no 1 m LiDAR here: the nearest HRDEM survey is tens of km away",
        ("pmtiles", "contours"): "no 1 m LiDAR here: the MRDEM's contours stand in",
        ("pmtiles", "understory"): "no LiDAR point cloud here",
        ("pmtiles", "lanes"): "no LiDAR point cloud here",
    },
    "BC": {
        ("geo", "camps"): "Ontario only: Crown land camps come from LIO",
        ("geo", "bathy"): "Ontario only: lake bathymetry comes from LIO",
        ("geo", "depth"): "Ontario only: lake depths need the ARA lake facts and the MNR sheets",
        ("pmtiles", "bathySheets"): "Ontario only: MNR lake survey sheets",
        ("pmtiles", "bathy"): "Ontario only: lake depths need the ARA lake facts and the MNR sheets",
        ("pmtiles", "lanes"): "no point-cloud adapter for BC yet (LidarBC where it has flown); the bush layer (understory) is the bush model's",
    },
}
# Why a layer the area leaves out of its files (its pack) is not in its
# maps, whatever the bake has left on disk, where there is more to say.
LEFT_OUT = {
    ("pmtiles", "hillshade"): "not baked: the map shades the relief from the DEM",
    ("geo", "forest"): "not in the maps as GeoJSON: the map reads the stands from the forest tiles, and the GeoJSON stays the bake's input",
}


def known_sources(a: dict, lidar: list[str], pc_years: str | None) -> dict[tuple[str, str], dict]:
    """Where each layer comes from by default, from the area's adapters. The
    adapters' own notes (area.note_source) replace these field by field."""
    from area import hrdem_project, hrdem_years, options

    bake = a.get("bake") or {}
    names = [hrdem_project(u) for u in lidar]
    years = [y for y in (hrdem_years(u) for u in lidar) if y]
    lidar_txt = names[0] + (f", gaps filled from {', '.join(names[1:])}" if len(names) > 1 else "") if names else "the area's HRDEM projects"
    lidar_v = (years[0] + (f", gaps {', '.join(years[1:])}" if len(years) > 1 else "")) if years else None
    if bake.get("lidar") == "arcticdem":
        lidar_txt, lidar_v = "ArcticDEM 2 m mosaic v4.1 (a satellite-stereo surface model, voids filled from the MRDEM), Polar Geospatial Center", "2 m, 2007-2022 imagery"
    forest_v = options(bake, "forest").get("vintage")
    forest_v = str(forest_v) if forest_v is not None else None
    out = {
        ("pmtiles", "topo"): {"source": "Toporama hypsography (contours and spot heights), NRCan WMS", "licence": OGL_CA},
        ("pmtiles", "hillshade"): {"source": "MRDEM 30 m hillshade, NRCan WMS", "licence": OGL_CA},
        ("pmtiles", "hillshadeLidar"): {"source": lidar_txt if bake.get("lidar") == "arcticdem" else f"HRDEM 1 m LiDAR DTM, NRCan: {lidar_txt}", "licence": PGC if bake.get("lidar") == "arcticdem" else OGL_CA, "vintage": lidar_v},
        ("pmtiles", "dem"): {"source": f"MRDEM 30 m, NRCan, with {lidar_txt} over the core" if bake.get("lidar") == "arcticdem" else f"MRDEM 30 m, with HRDEM 1 m LiDAR over the core ({lidar_txt}), NRCan", "licence": OGL_CA, "vintage": lidar_v},
        ("pmtiles", "contours"): {"source": lidar_txt if bake.get("lidar") == "arcticdem" else f"HRDEM 1 m LiDAR DTM, NRCan: {lidar_txt}", "licence": PGC if bake.get("lidar") == "arcticdem" else OGL_CA, "vintage": lidar_v},
        ("pmtiles", "contoursWide"): {"source": "MRDEM 30 m DTM, NRCan", "licence": OGL_CA},
        ("pmtiles", "historical"): {"source": "CanMatrix2 1:50 000 NTS scans, NRCan: " + ", ".join(bake.get("nts") or []), "licence": OGL_CA},
        ("grids", "habitat"): {
            "source": "derived: MRDEM, NRCan 2020 land cover, forest stands, water, wetlands, roads and burns"
            + ("; bush from the LiDAR point cloud where it was measured" if bake.get("habitatBush") == "pointcloud" else ""),
            "licence": DERIVED,
        },
        ("grids", "micro"): {"source": "derived: the habitat grid and the MRDEM", "licence": DERIVED},
        ("grids", "going"): {"source": "derived: HRDEM LiDAR, point-cloud bush or the forest-map estimate, water, wetlands and roads", "licence": DERIVED},
    }
    if a["jurisdiction"] == "ON":
        fri = {"source": "Forest Resources Inventory (FRI FIMv2) stands, OMNRF", "licence": OGL_ON, "vintage": forest_v}
        spl = {"source": "FRI leaf-on single-photon LiDAR point clouds, OMNRF", "licence": OGL_ON, "vintage": pc_years}
        out |= {
            ("pmtiles", "satellite"): {"source": "Ontario Imagery, LIO web map service", "licence": OGL_ON},
            ("pmtiles", "forest"): fri,
            ("pmtiles", "places"): {"source": "LIO: WMUs, Crown land camps, Crown land, parks, burns and roads", "licence": OGL_ON},
            ("pmtiles", "understory"): spl,
            ("pmtiles", "lanes"): spl,
            ("pmtiles", "bathySheets"): {"source": "MNR historic lake survey sheets", "licence": OGL_ON, "vintage": "1978-79"},
            ("geo", "wmu"): {"source": "Wildlife Management Units, LIO", "licence": OGL_ON},
            ("geo", "camps"): {"source": "Crown land dispositions: camps, cottages and lodges, LIO", "licence": OGL_ON},
            ("geo", "crown"): {"source": "Crown land, LIO", "licence": OGL_ON},
            ("geo", "parks"): {"source": "Provincial parks, LIO", "licence": OGL_ON},
            ("geo", "bathy"): {"source": "Lake bathymetry lines, LIO", "licence": OGL_ON},
            ("geo", "fire"): {"source": "Fire disturbance areas, LIO", "licence": OGL_ON},
            ("geo", "roads"): {"source": "MNRF roads, LIO", "licence": OGL_ON},
            ("geo", "forest"): fri,
            ("geo", "depth"): {"source": "depth bands: the MNR survey sheets where a lake was surveyed, else a shore-distance model", "licence": OGL_ON},
            ("baseGeo", "waterbody"): {"source": "Ontario Hydro Network waterbodies, LIO", "licence": OGL_ON},
        }
    elif a["jurisdiction"] == "YT":
        out |= {
            ("pmtiles", "satellite"): {"source": "Yukon SPOT 1.5 m colour composite, Geomatics Yukon ImageServer", "licence": OGL_YT, "vintage": "2013-2022"},
            ("pmtiles", "places"): {"source": "GeoYukon: game management subzones, First Nation settlement land, burns and roads", "licence": OGL_YT},
            ("geo", "wmu"): {"source": "Game Management Areas 250k (subzones), GeoYukon; generalised, not for legal use", "licence": OGL_YT},
            ("geo", "crown"): {"source": "First Nation Settlement Lands, GeoYukon", "licence": OGL_YT},
            ("geo", "fire"): {"source": "Yukon fire history, Wildland Fire Management, GeoYukon", "licence": OGL_YT},
            ("geo", "roads"): {"source": "Yukon Road Network and surface disturbance lines (access roads, trails), GeoYukon", "licence": OGL_YT},
            ("baseGeo", "waterbody"): {"source": "CanVec 1:50 000 waterbodies, via GeoYukon", "licence": OGL_CA},
        }
    elif a["jurisdiction"] == "BC":
        vri = {"source": "Vegetation Resources Inventory (VRI) forest cover, Province of British Columbia, with later fire perimeters laid over", "licence": OGL_BC, "vintage": forest_v}
        out |= {
            ("pmtiles", "satellite"): {"source": "Sentinel-2 L2A leaf-on median composite, 10 m (Earth Search, AWS); the province's orthos stop east of 134° W", "licence": "Copernicus Sentinel data: free and open, credit required"},
            ("pmtiles", "forest"): vri,
            ("pmtiles", "places"): {"source": "BC Geographic Warehouse: wildlife management units, parks, private parcels and reserves, fire perimeters, roads and trails", "licence": OGL_BC},
            ("geo", "wmu"): {"source": "Wildlife Management Units, Province of British Columbia", "licence": OGL_BC},
            ("geo", "crown"): {"source": "ParcelMap BC parcels not Crown, and Indian reserves", "licence": OGL_BC},
            ("geo", "parks"): {"source": "Parks, conservancies, ecological reserves and protected areas (TANTALIS), Province of British Columbia", "licence": OGL_BC},
            ("geo", "fire"): {"source": "Fire perimeters, historical, BC Wildfire Service", "licence": OGL_BC},
            ("geo", "roads"): {"source": "Digital Road Atlas (resource roads included) and TRIM trails, Province of British Columbia", "licence": OGL_BC},
            ("geo", "forest"): vri,
            ("baseGeo", "waterbody"): {"source": "Freshwater Atlas lakes and rivers, Province of British Columbia", "licence": OGL_BC},
        }
    elif a["jurisdiction"] == "QC":
        eco = {"source": "Carte écoforestière (MRNF), with later cuts, burns and outbreaks laid over", "licence": CC_BY, "vintage": forest_v}
        laz = {"source": "MRNF LiDAR point clouds (LAZ)", "licence": CC_BY, "vintage": pc_years}
        out |= {
            ("pmtiles", "satellite"): {"source": "Imagerie_GQ WMTS, MRNF: the 20 cm ortho", "licence": CC_BY, "vintage": "flown Aug-Oct 2023"},
            ("pmtiles", "forest"): eco,
            # no hunting zones: their service states no licence (qc_vectors.wmu, build_vector_tiles.WITHHELD)
            ("pmtiles", "places"): {"source": "TRQ territories, the carte écoforestière's burns and AQréseau roads, MRNF", "licence": CC_BY},
            ("pmtiles", "understory"): laz,
            ("pmtiles", "lanes"): laz,
            ("geo", "parks"): {"source": "Territoires récréatifs du Québec (TRQ): ZECs, outfitters, wildlife reserves and parks", "licence": CC_BY},
            ("geo", "fire"): {"source": "Burns from the carte écoforestière, MRNF", "licence": CC_BY},
            ("geo", "roads"): {"source": "AQréseau+ roads, forest roads included, MRNF", "licence": CC_BY},
            ("geo", "forest"): eco,
            ("baseGeo", "waterbody"): {"source": "GRHQ lakes, MRNF", "licence": CC_BY},
        }
    return out


def hab_generated(path: Path) -> str | None:
    """The date a .hab grid's header says it was made."""
    return habfile.read_header(path).get("generated")


def coverage(area, results: dict[str, str]) -> dict:
    """The coverage report: every layer the app knows, with what was baked
    for it or why there is nothing."""
    import numpy as np

    a, out_dir, area_id = area.AREA, area.OUT_DIR, area.ID
    bake = a.get("bake") or {}
    lidar = list(bake.get("hrdem") or [])
    cache = area.CACHE_DIR / f"lidar-{area_id}.npz"
    if cache.exists():
        z = np.load(cache, allow_pickle=True)
        if "sources" in z.files:
            lidar = [str(s) for s in z["sources"]]
    tiles = area.CACHE_DIR / "pointcloud" / f"tiles-{area_id}.json"
    pc_years = None
    if tiles.exists():
        ys = sorted({str(r["year"]) for r in json.loads(tiles.read_text(encoding="utf-8")) if r.get("year")})
        pc_years = ", ".join(ys) or None
    known = known_sources(a, lidar, pc_years)
    notes = area.read_sources()
    not_here = NOT_IN.get(a["jurisdiction"], {})
    files = a.get("files") or {}

    def entry(group: str, key: str, file: str, step: str | None) -> dict:
        path = out_dir / file
        in_pack = key in files.get(group, [])
        if in_pack and path.exists() and path.stat().st_size > 0:  # empty: a step stopped while writing it
            e = {"file": file, "bytes": path.stat().st_size, **known.get((group, key), {}), **notes.get(file, {})}
            if group == "grids" and "vintage" not in notes.get(file, {}):
                e["vintage"] = f"generated {hab_generated(path)}"
            return {k: v for k, v in e.items() if v is not None}
        # the province's own reason first: Lac Bailey has no depth GeoJSON
        # for "drawn from GeoJSON" to point at
        why = not_here.get((group, key)) or NEVER_BAKED.get((group, key))
        if not why and not in_pack:
            why = LEFT_OUT.get((group, key), "not in this area's maps")
        if not why and step in results and not results[step].startswith("ok"):
            why = f"{step} step {results[step]}"
        if not why and key == "lanes" and not bake.get("pointcloud"):
            why = "no point cloud for this area: lanes are a 10 m LiDAR measure"
        if not why and key == "understory" and not bake.get("pointcloud"):
            why = "no point cloud for this area and no bush model layer baked (bush step)"
        if not why and key == "bathySheets" and not bake.get("lakeSheets"):
            why = "no lake survey sheets for this area"
        return {"missing": why or "not baked yet"}

    cov: dict = {"checked": date.today().isoformat()}
    groups = (
        ("pmtiles", {k: (f"{stem}-{area_id}.pmtiles", step) for k, (stem, step) in PMTILES.items()}),
        ("geo", {t: (f"{t}-{area_id}.geojson", step) for t, step in GEO.items()}),
        ("baseGeo", {t: (f"{t}-{area_id}.geojson", step) for t, step in BASE_GEO.items()}),
        ("grids", {g: (f"{g}-{area_id}.hab", step) for g, step in GRIDS.items()}),
    )
    for group, layers in groups:
        ext = {"pmtiles": "pmtiles", "grids": "hab"}.get(group, "geojson")
        for key in files.get(group, []):  # a layer the app has added since
            layers.setdefault(key, (f"{key}-{area_id}.{ext}", None))
        cov[group] = {key: entry(group, key, file, step) for key, (file, step) in layers.items()}
    return cov


def relief_of(area) -> list[int] | None:
    """The elevation range to stretch the relief colours over: the core
    from about its lowest lake (the 0.5th percentile) to its highest
    ground, from the LiDAR, else the 30 m MRDEM. That gives Pickle Lake's
    hand-set 325-466 m within a metre."""
    import numpy as np
    import rasterio
    from rasterio.warp import transform_bounds

    for name, key in ((f"lidar-{area.ID}.npz", "elev"), (f"mrdem-{area.ID}.npz", "data")):
        p = area.CACHE_DIR / name
        if not p.exists():
            continue
        with np.load(p, allow_pickle=True) as z:
            t, crs, nd = rasterio.Affine(*z["transform"][:6]), str(z["crs"]), float(z["nodata"])
            w, s, e, n = transform_bounds("EPSG:4326", crs, *(area.CORE[k] for k in ("west", "south", "east", "north")))
            c0, r0 = ~t * (w, n)
            c1, r1 = ~t * (e, s)
            g = z[key][max(0, int(r0)) : int(math.ceil(r1)), max(0, int(c0)) : int(math.ceil(c1))]
        v = g[(g != nd) & np.isfinite(g)]
        if v.size:
            return [int(math.floor(np.percentile(v, 0.5))), int(math.ceil(v.max()))]
    return None


def zone_of(area) -> str | None:
    """The hunting zone the area's centre is in, from its baked zone layer
    (wmu-<id>.geojson, OFFICIAL_NAME in the normal form), without the word
    the app puts in front (WMU 21B, Zone 18). Where the zones are not open
    data they are not baked into the area's folder, but a copy fetched on
    request is kept with the caches (qc_vectors.py wmu)."""
    import shapely

    p = next((q for q in (area.OUT_DIR / f"wmu-{area.ID}.geojson", area.CACHE_DIR / f"wmu-{area.ID}.geojson") if q.exists()), None)
    if p is None:
        return None
    here = shapely.Point(*area.HOME)
    for f in json.loads(p.read_text(encoding="utf-8")).get("features", []):
        name = (f.get("properties") or {}).get("OFFICIAL_NAME")
        if name and f.get("geometry") and shapely.geometry.shape(f["geometry"]).covers(here):
            label = (area.AREA.get("zone") or {}).get("label") or ""
            return str(name).removeprefix(f"{label} ").strip() if label else str(name).strip()
    return None


def unknowns(area) -> dict:
    """What a new area's file left open (bake_area.py --new writes null
    for what only the bake can know) and the bake has found out since.
    Only nulls are filled: a value someone set is never touched."""
    a, found = area.AREA, {}
    if a.get("relief") is None and (relief := relief_of(area)):
        found["relief"] = relief
    if isinstance(a.get("zone"), dict) and a["zone"].get("name") is None and (zone := zone_of(area)):
        found["zone.name"] = zone
    if a.get("declination") is None and (d := declination(area.HOME[1], area.HOME[0])) is not None:
        found["declination"] = d
    return found


# ---- a new area from a point ------------------------------------------------


def slug(name: str) -> str:
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    return "-".join("".join(c if c.isalnum() else " " for c in s).split())


def km_size(box: dict) -> tuple[float, float]:
    """(width, height) of a lon/lat box in km."""
    lat = (box["south"] + box["north"]) / 2
    return (box["east"] - box["west"]) * 111.32 * math.cos(math.radians(lat)), (box["north"] - box["south"]) * 110.574


def box_around(lon: float, lat: float, width_km: float, height_km: float) -> dict:
    dlon = width_km / 2 / (111.32 * math.cos(math.radians(lat)))
    dlat = height_km / 2 / 110.574
    return {"west": round(lon - dlon, 3), "south": round(lat - dlat, 3), "east": round(lon + dlon, 3), "north": round(lat + dlat, 3)}


def declination(lat: float, lon: float) -> float | None:
    """Compass declination (degrees, west negative) from the World Magnetic
    Model, when pygeomag is installed."""
    try:
        from pygeomag import GeoMag

        today = date.today()
        year = today.year + (today.timetuple().tm_yday - 1) / (366 if today.year % 4 == 0 else 365)
        return round(float(GeoMag().calculate(glat=lat, glon=lon, alt=0, time=year).d), 1)
    except Exception:  # noqa: BLE001  (not installed, or a model too old for the date)
        return None


def new_area(args) -> str:
    import area  # its helpers; which area is active does not matter here
    from georef_sheet import nts_50k_sheets

    j = args.jurisdiction.upper()
    area_id = args.id or slug(args.name)
    if not area.ID_RE.match(area_id):
        raise SystemExit(f"cannot make an id out of {args.name!r}: pass --id")
    path = Path(args.out).resolve() if args.out else area.area_path(area_id)
    if path.exists() and not args.force:
        raise SystemExit(f"{path} exists (--force to replace it)")
    lon, lat = args.lon, args.lat
    pickle = area.load(area.DEFAULT_AREA)
    rw, rh = (2 * args.region_km,) * 2 if args.region_km else km_size(pickle["region"])
    cw, ch = (2 * args.core_km,) * 2 if args.core_km else km_size(pickle["core"])
    region = box_around(lon, lat, rw, rh)
    core = {**box_around(lon, lat, cw, ch), "maxzoom": pickle["core"]["maxzoom"]}
    no_lidar = False
    try:
        from build_hillshade import stac_search

        hrdem = stac_search(core)
    except (SystemExit, Exception) as e:  # noqa: BLE001  (offline: the bake searches again)
        # the catalogue answered and has no survey there: the core goes without
        no_lidar = str(e).startswith("no HRDEM LiDAR project")
        print(f"no 1 m LiDAR over the core ({e})" if no_lidar else f"no HRDEM list yet ({e}); the bake will search for it")
        hrdem = []

    arctic: list[str] = []
    if no_lidar:
        try:
            from build_hillshade import arcticdem_search

            arctic = arcticdem_search(core)
        except (SystemExit, Exception) as e:  # noqa: BLE001
            print(f"no ArcticDEM list yet ({e})")
        if arctic:
            print("ArcticDEM 2 m covers the core: the relief, shade and contours come from it (bake.lidar arcticdem)")
            no_lidar = False
    # what the province's adapters make, and the app fields that go with them,
    # taken from the area already baked there
    example = {"ON": area.DEFAULT_AREA, "QC": "lac-bailey"}.get(j)
    ex = area.load(example) if example and area.area_path(example).exists() else {}
    # elsewhere only the national layers: relief, topo and the old sheets
    national = {"pmtiles": ["topo", "hillshade", "hillshadeLidar", "dem", "contours", "contoursWide", "historical"], "geo": [], "baseGeo": [], "grids": []}
    files = json.loads(json.dumps(ex.get("files") or national))
    if j == "ON":  # never baked (basemap, bathy) or Pickle Lake's own survey sheets
        files["pmtiles"] = [k for k in files.get("pmtiles", []) if k not in ("bathySheets", "basemap", "bathy")]
    if j == "YT":  # the Yukon adapters' layers, and the national stands (ca_forest.py)
        files = {
            "pmtiles": ["topo", "satellite", "hillshade", "hillshadeLidar", "dem", "contours", "contoursWide", "forest", "historical", "places"],
            "geo": ["wmu", "crown", "fire", "roads"],
            "baseGeo": ["waterbody"],
            "grids": ["habitat", "micro", "going"],
        }
    if j == "BC":  # the BC adapters' layers (bc_vectors.py, bc_forest.py); no open imagery in the north-west
        files = {
            "pmtiles": ["topo", "satellite", "hillshade", "hillshadeLidar", "dem", "contours", "contoursWide", "forest", "understory", "historical", "places"],
            "geo": ["wmu", "crown", "parks", "fire", "roads"],
            "baseGeo": ["waterbody"],
            "grids": ["habitat", "micro", "going"],
        }
    if no_lidar:  # the MRDEM's relief alone: its hillshade and its contours
        files["pmtiles"] = [k for k in files["pmtiles"] if k not in ("hillshadeLidar", "contours", "understory", "lanes")]
    bake_by = {
        "ON": {"vectors": "on.lio", "forest": {"adapter": "on.fri", "gdb": None, "crs": None, "vintage": None}, "imagery": "on.oiwms", "pointcloud": "on.fri_leafon"},
        "YT": {
            "vectors": "yt",
            "forest": {
                "adapter": "ca.scanfi",
                "vintage": "SCANFI 2025; CanLaD 1985-2025",
                "attribution": "Forest inferred from SCANFI and CanLaD © Natural Resources Canada",
            },
            "imagery": "yt.spot",
            "pointcloud": None,
        },
        "BC": {
            "vectors": "bc",
            "forest": {"adapter": "bc.vri", "vintage": None},
            "imagery": "ca.s2summer",  # no provincial imagery in the north-west: a Sentinel-2 leaf-on composite
            "pointcloud": None,
        },
        "QC": {
            "vectors": "qc",
            "forest": {"adapter": "qc.ecoforestier", "vintage": "4th inventory, with cuts, burns and outbreaks to 2025"},
            "imagery": "qc.imagerie_gq",
            # about the Spots radius round the point: the province's LAZ is ~2 GB for 3 km
            "pointcloud": {"adapter": "qc.mrnf_laz", "bbox": box_around(lon, lat, 6, 6)},
        },
    }
    zone_label = {"ON": "WMU", "QC": "Zone", "YT": "GMS", "BC": "MU"}.get(j, "Zone")
    a = {
        "id": area_id,
        "name": args.name,
        "jurisdiction": j,
        "centre": [lon, lat],
        "home": {"center": [lon, lat], "zoom": 13},
        "region": region,
        "core": core,
        "regionMaxzoom": pickle["regionMaxzoom"],
        "declination": declination(lat, lon),
        "timezone": {"YT": "America/Whitehorse", "BC": "America/Vancouver"}.get(j) or ("America/Winnipeg" if j == "ON" and lon < -90 else "America/Toronto"),
        "zone": {"label": zone_label, "name": None},
        "relief": None,  # the bake fills it in from the core's elevations
        "base": f"areas/{area_id}/",
        "surveyedLakes": [],
        "live": {"lio": j == "ON", "satellite": {"ON": "lio", "QC": "qc"}.get(j)},
        "attribution": ex.get("attribution")
        or {
            "YT": {"vectors": "© Government of Yukon", "lakes": "CanVec © Natural Resources Canada", "bush": ""},
            "BC": {"vectors": "© Province of British Columbia", "lakes": "Freshwater Atlas © Province of British Columbia", "bush": ""},
        }.get(j)
        or {"vectors": "", "lakes": "", "bush": ""},
        "presets": [{"name": "Requested spot", "lon": lon, "lat": lat, "kind": "stand", "note": f"Area requested {date.today().isoformat()}"}],
        "bundle": {
            "description": (
                f"Topo, imagery, LiDAR relief and contours, forest stands, water, roads, and the habitat, wind and going grids "
                f"around {args.name}; full detail within {min(cw, ch) / 2:.0f} km of the spot."
            )
        },
        "files": files,
        "bake": {
            "outDir": f"app/public/data/areas/{area_id}",
            "hrdem": hrdem,
            **({"lidar": "arcticdem", "arcticdem": arctic} if arctic else {"lidar": "none"} if no_lidar else {}),
            **bake_by.get(j, {"vectors": None, "forest": None, "imagery": None, "pointcloud": None}),
            "nts": nts_50k_sheets(region["west"], region["south"], region["east"], region["north"]),
        },
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(area.dumps(a) + "\n", encoding="utf-8", newline="\n")
    print(f"wrote {path}: region {rw:.1f} x {rh:.1f} km, core {cw:.1f} x {ch:.1f} km, sheets {', '.join(a['bake']['nts'])}, declination {a['declination']}")
    if not args.out:
        print(f"bake it: py -3.14 pipeline/bake_area.py --area {area_id}")
    return area_id


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--area", help="the area's id (app/src/areas/<id>.json)")
    ap.add_argument("--from", dest="start", help="start at this step; the ones before are taken as done")
    ap.add_argument("--only", action="append", help="run just this step (repeatable)")
    ap.add_argument("--list", action="store_true", help="print the plan and stop")
    ap.add_argument("--overwrite-published", action="store_true", help="really rebake Pickle Lake's published files")
    ap.add_argument("--new", action="store_true", help="write a new area file around --lat/--lon")
    ap.add_argument("--lat", type=float)
    ap.add_argument("--lon", type=float)
    ap.add_argument("--name")
    ap.add_argument("--jurisdiction", help="ON, QC, YT or BC (with adapters); others get the national layers only")
    ap.add_argument("--id", help="--new: the area's id (default: from the name)")
    ap.add_argument("--core-km", type=float, help="--new: the core's half-width (default: Pickle Lake's size)")
    ap.add_argument("--region-km", type=float, help="--new: the region's half-width (default: Pickle Lake's size)")
    ap.add_argument("--out", help="--new: write the file here instead of app/src/areas/<id>.json")
    ap.add_argument("--force", action="store_true", help="--new: replace an existing file")
    ap.add_argument("--bake", action="store_true", help="--new: bake the area straight after")
    args = ap.parse_args()

    if args.new:
        if None in (args.lat, args.lon, args.name, args.jurisdiction):
            ap.error("--new needs --lat, --lon, --name and --jurisdiction")
        area_id = new_area(args)
        if not args.bake or args.out:
            return 0
        # a fresh process: this one imported area.py with another area active
        return subprocess.call([sys.executable, __file__, "--area", area_id])
    if not args.area:
        ap.error("--area <id>, or --new")
    os.environ["HUNTAPP_AREA"] = args.area
    return bake(args)


if __name__ == "__main__":
    sys.exit(main())
