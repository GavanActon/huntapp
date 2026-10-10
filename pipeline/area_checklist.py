r"""The areas' checklist: for every area, what it is built from, what is
missing or stale, and a thumbnail of each layer and grid, so a gap shows at
a glance: no momentum bands, no LiDAR, Ontario's leaf dates at 63° N, a blank
tile, a grid baked before the one it is made from.

    py -3.14 pipeline/area_checklist.py [--online] [--area <id> ...] [--out <dir>] [--loop [seconds]]

Writes <out>/index.html (default pipeline/raw/windcfd/areas, inside the
WindNinja kit's share, so any machine on it can open
\\XEVO\windcfd2\areas\index.html) with its thumbnails beside it. Each area
shows its WindNinja directions live (pipeline/windcfd/status.py's rose).
--online also asks Open-Meteo whether HRDPS covers each area. --loop
rewrites the page every 60 s (or the seconds given) and the page reloads
itself; a thumbnail is drawn again only when the file behind it changes.
bake_area.py calls print_warnings(<id>) at the end of every bake, so a step
that did not run is said out loud there too.

It reads only the area files (app/src/areas/<id>.json, with the coverage
report bake_area.py writes into them), the baked files and the WindNinja kit
(pipeline/raw/windcfd); it changes nothing.
"""

from __future__ import annotations

import argparse
import gzip
import html
import io
import json
import math
import struct
import subprocess
import sys
import time
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path

import habfile
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "pipeline" / "windcfd"))
AREAS = ROOT / "app" / "src" / "areas"
KIT = ROOT / "pipeline" / "raw" / "windcfd"
THUMB_W = 260

# the moose model's rules come from Ontario's MNRF guides; how far each
# jurisdiction is from what they were written for
MODEL_FIT = {
    "ON": ("ok", "Rules written for boreal Ontario"),
    "QC": ("warn", "Rules from Ontario's guides; the same boreal, not checked against Québec sightings"),
    "BC": ("warn", "Rules from Ontario's guides with the place's profile (treeline band, northern regrowth, grizzly, ptarmigan); not checked against BC sightings"),
    "YT": ("warn", "Rules from Ontario's guides with the place's profile (treeline band, northern regrowth, grizzly, ptarmigan); not checked against Yukon sightings"),
}
REGS_TS = ROOT / "app" / "src" / "spots" / "regs.ts"


def regs_zones() -> set[tuple[str, str]]:
    """(jurisdiction, zone) pairs the species table (spots/regs.ts) has a book read in for."""
    import re

    out: set[tuple[str, str]] = set()
    text = REGS_TS.read_text(encoding="utf-8") if REGS_TS.exists() else ""
    for j, zones in re.findall(r"jurisdiction: '([A-Z]+)',\s*zones: \[([^\]]*)\]", text):
        out.update((j, z) for z in re.findall(r"'([^']+)'", zones))
    return out
LEAF_LAT = 52.0  # north of this, the default leaf dates (Ontario's boreal) run late
HRDPS_EVERY_S = 6 * 3600  # how often --online asks again
_HRDPS: dict[str, tuple[float, tuple[str, str]]] = {}


@dataclass
class Check:
    group: str
    label: str
    status: str  # ok, warn, fail, na, info
    detail: str


@dataclass
class Area:
    id: str
    a: dict
    out: Path
    checks: list[Check] = field(default_factory=list)
    thumbs: list[tuple[str, str, str]] = field(default_factory=list)  # (file, caption, note)

    def add(self, group: str, label: str, status: str, detail: str) -> None:
        self.checks.append(Check(group, label, status, detail))


# ---------------------------------------------------------------- reading

def read_hab(path: Path, want: tuple[str, ...] = ()) -> tuple[dict, dict[str, np.ndarray]]:
    return habfile.read_hab(path, want)


def git(*args: str) -> tuple[int, str]:
    p = subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True)
    return p.returncode, p.stdout.strip()


def rel(p: Path) -> str:
    return str(p.relative_to(ROOT)).replace("\\", "/")


# the grids every area has, then any the area file adds (micro-sd, the
# surrogate's terrain wind beside WindNinja's)
GRID_LABELS = {"micro-sd": "Micro SD"}


def grid_names(ar: Area) -> list[str]:
    return list(dict.fromkeys(("habitat", "going", "micro", *((ar.a.get("files") or {}).get("grids") or []))))


# ---------------------------------------------------------------- checks

def check_files(ar: Area) -> None:
    cov = ar.a.get("coverage") or {}
    if not cov:
        ar.add("Files", "Coverage report", "fail", "none in the area file: run bake_area.py --only coverage")
        return
    have = missing = absent = 0
    gone = []
    for group in ("pmtiles", "geo", "baseGeo", "grids"):
        for name, e in (cov.get(group) or {}).items():
            if "file" in e:
                if (ar.out / e["file"]).exists():
                    have += 1
                else:
                    absent += 1
                    gone.append(e["file"])
            else:
                missing += 1
    ar.add("Files", "Coverage report", "ok", f"checked {cov.get('checked', '?')}: {have} layers baked, {missing} not available here")
    if gone:
        ar.add("Files", "Files on disk", "fail", "listed but not found: " + ", ".join(gone))
    else:
        ar.add("Files", "Files on disk", "ok", "every listed file is there")


def check_tier(ar: Area) -> None:
    a, b = ar.a, ar.a.get("bake") or {}
    cov = (ar.a.get("coverage") or {}).get("pmtiles") or {}
    lidar = cov.get("hillshadeLidar", {})
    if "file" in lidar and b.get("lidar") == "arcticdem":
        ar.add("Data", "Terrain", "ok", f"ArcticDEM 2 m surface model (canopy top over trees, ground in the open): {lidar.get('source', '')}")
    elif "file" in lidar:
        ar.add("Data", "Terrain", "ok", f"1 m LiDAR ({lidar.get('vintage', '?')}): {lidar.get('source', '')}")
    else:
        ar.add("Data", "Terrain", "warn", "30 m national model (MRDEM) only: " + lidar.get("missing", "no 1 m LiDAR"))
    under = cov.get("understory", {})
    if "file" in under and not b.get("pointcloud") and "own bush model" in str(under.get("source", "")):
        ar.add("Data", "Bush and lanes", "warn", "bush and lanes from the area's own model (labels tapped on the photo, bush/local.py), not a point cloud; field notes would check it")
    elif "file" in under and not b.get("pointcloud"):
        ar.add("Data", "Bush and lanes", "warn", "bush from the satellite bush model (trained on Ontario and northern BC LiDAR plots), no lanes: no point cloud here")
    elif "file" in under:
        ar.add("Data", "Bush and lanes", "ok", "measured from the LiDAR point cloud")
    else:
        ar.add("Data", "Bush and lanes", "warn", "no point cloud: no Bush view or Bow lanes; sight lines and routes use the stand estimate")
    f = b.get("forest") or {}
    adapter = f.get("adapter", "?")
    if adapter == "ca.scanfi":
        extra = " The SCANFI readme warns accuracy is lower in the Yukon." if a.get("jurisdiction") == "YT" else ""
        ar.add("Data", "Forest stands", "warn", f"inferred from the national maps ({f.get('vintage', '')}); all broadleaf one class.{extra}")
    else:
        ar.add("Data", "Forest stands", "ok", f"surveyed inventory ({adapter}, {f.get('vintage', '?')})")
    sat = cov.get("satellite", {})
    ar.add("Data", "Imagery", "ok" if "file" in sat else "warn", (sat.get("source", "") + (f" ({sat['vintage']})" if sat.get("vintage") else "")) or sat.get("missing", "none"))


def check_wind(ar: Area, online: bool) -> None:
    a = ar.a
    lat = a["centre"][1]
    micro = ar.out / f"micro-{ar.id}.hab"
    if not micro.exists():
        ar.add("Wind", "Ground-wind grid", "fail", "no micro grid: the ground wind falls back to the forecast")
        return
    h, _ = read_hab(micro)
    mom = (h.get("model") or {}).get("momentum")
    dirs = [b["name"] for b in h["bands"] if b["name"].startswith("mU")]
    if mom and len(dirs) >= 16:
        ar.add("Wind", "Momentum solve (WindNinja)", "ok", f"{len(dirs)}/16 directions in the grid")
    elif dirs:
        ar.add("Wind", "Momentum solve (WindNinja)", "warn", f"only {len(dirs)}/16 directions: the app needs all 16, so it uses the older solve")
    else:
        ar.add("Wind", "Momentum solve (WindNinja)", "fail", "no momentum bands: the day wind uses the older 2D solve, which is weakest in steep ground")
    if (sd := ar.out / f"micro-sd-{ar.id}.hab").exists():
        m = (habfile.read_header(sd).get("model") or {}).get("momentum") or {}
        ar.add("Wind", "Surrogate wind (SD)", "ok" if m.get("source") == "sd" else "warn", m.get("solver") or "the SD grid has no momentum bands")
    # the solve's turbulence (MICRO-WIND.md §2): the lee of hills and ridges
    # tumbles, swirls on the map and widens the scent. Without it only trees do
    turb = [b["name"] for b in h["bands"] if b["name"].startswith("mT")]
    ref = (mom or {}).get("spreadRef")
    kit = KIT / ar.id
    # t<dir>: the runs with the turbulence (run.ps1, 2026-10-05 on)
    tdone = len(list(kit.glob("t*/done.txt"))) if kit.exists() else 0
    if len(turb) >= 16 and ref is not None:
        ar.add("Wind", "Turbulence (WindNinja)", "ok", f"{len(turb)}/16 directions, ordinary spread ±{ref:.0f}°: the lee of hills and ridges swirls and widens the scent")
    elif tdone >= 16:
        ar.add("Wind", "Turbulence (WindNinja)", "warn", "solved for all 16 directions but not in the grid yet: build_windcfd.py collect, then rebake micro")
    elif mom or dirs:
        ar.add("Wind", "Turbulence (WindNinja)", "warn", f"not in the grid: only trees make the air swirl, so the lee of a hill draws smooth and the scent there stays narrow ({tdone}/16 directions rerun with it)")
    else:
        ar.add("Wind", "Turbulence (WindNinja)", "fail", "no momentum solve, so no turbulence: only trees make the air swirl")
    if kit.exists():
        running = [p.parent.name for p in kit.glob("t*/claim-*.txt") if "HOLD" not in p.name and not (p.parent / "done.txt").exists()]
        held = len(list(kit.glob("t*/claim-HOLD.txt")))
        note = f"{tdone}/16 directions solved with the turbulence"
        if running:
            note += f", running {', '.join(sorted(running))}"
        if held:
            note += f", {held} held back"
        ar.add("Wind", "WindNinja kit", "ok" if tdone >= 16 else "info", note + ("" if tdone < 16 else ": collect and rebake micro if the grid lacks them"))
    if "leaves" in a:
        ar.add("Wind", "Leaf calendar", "ok", f"the area's own dates: {a['leaves']}")
    elif abs(lat) > LEAF_LAT:
        ar.add("Wind", "Leaf calendar", "warn", f"Ontario's default dates (bare 20 Sept–15 Oct) at {lat:.1f}° N: the hardwoods here go bare earlier; set 'leaves' in the area file")
    else:
        ar.add("Wind", "Leaf calendar", "ok", "the boreal default dates")
    if online:
        # asked once every few hours, not on every pass of --loop
        hit = _HRDPS.get(ar.id)
        if not hit or time.time() - hit[0] > HRDPS_EVERY_S:
            try:
                url = (f"https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={a['centre'][0]}"
                       "&hourly=wind_speed_10m&models=gem_hrdps_continental&forecast_days=1")
                d = json.loads(urllib.request.urlopen(url, timeout=20).read())
                n = sum(v is not None for v in d["hourly"]["wind_speed_10m"])
                hit = (time.time(), ("ok", f"{n}/24 hours of HRDPS here") if n else ("fail", "HRDPS doesn't reach here: the 7-day blend stands in"))
            except Exception as e:  # offline, or the API refused
                hit = (time.time() - HRDPS_EVERY_S + 600, ("na", f"couldn't ask Open-Meteo: {e}"))
            _HRDPS[ar.id] = hit
        ar.add("Wind", "HRDPS forecast", *hit[1])


def check_grids(ar: Area) -> None:
    gen = {}
    for g in grid_names(ar):
        p = ar.out / f"{g}-{ar.id}.hab"
        label = GRID_LABELS.get(g, g.capitalize())
        if not p.exists():
            ar.add("Grids", label, "fail", "missing" + (": bake_area.py --only wind-sd --only micro-sd" if g == "micro-sd" else ""))
            continue
        h, _ = read_hab(p)
        gen[g] = h.get("generated", "")
        extra = ""
        if g == "habitat":
            names = [b["name"] for b in h["bands"]]
            extra = "; canopy from the LiDAR" if "canopySrc" in names else "; canopy from the stand estimate"
        if g == "going" and h.get("bushFrom"):
            extra = f"; bush from {h['bushFrom']}"
        ar.add("Grids", label, "ok", f"baked {gen[g][:16] or '?'}, {p.stat().st_size / 1e6:.1f} MB{extra}")
    for g in ("micro", "micro-sd"):
        if gen.get(g) and gen.get("habitat") and gen[g] < gen["habitat"]:
            ar.add("Grids", "Order", "warn", f"the {g} grid is older than the habitat grid it's made from: rebake {g}")


def check_model(ar: Area) -> None:
    j = ar.a.get("jurisdiction", "?")
    st, why = MODEL_FIT.get(j, ("warn", f"rules written for boreal Ontario, not checked in {j}'s country"))
    ar.add("Model", "Moose model", st, why)
    # the place's profile (pipeline/build_profile.py) and its zone in the species table (spots/regs.ts)
    p = ar.a.get("profile")
    if not p:
        ar.add("Model", "Profile", "warn", "no habitat profile: scored as boreal Ontario; bake_area.py --only profile")
    else:
        tl = p.get("treeline")
        eco = p.get("ecoregion") or {}
        words = [f"{eco.get('cec3', '?')} {eco.get('name', '')}".strip(), f"treeline {tl['m']} m" if tl else "forest to the tops", "the north's calendars" if p.get("north") else "boreal calendars"]
        if not p.get("stands", {}).get("leadSpecies", True):
            words.append("lead species inferred")
        ar.add("Model", "Profile", "ok", f"{'; '.join(words)} (worked out {p.get('checked', '?')})")
    zone = (ar.a.get("zone") or {}).get("name", "?")
    if (j, zone) in regs_zones():
        ar.add("Model", "Species and seasons", "ok", f"{j} {zone} is in the species table")
    else:
        ar.add("Model", "Species and seasons", "info", f"{j} {zone} is not in the species table (app/src/spots/regs.ts): every target shown, no season lines")


def check_deploy(ar: Area) -> None:
    path = AREAS / f"{ar.id}.json"
    code, _ = git("ls-files", "--error-unmatch", rel(path))
    if code:
        ar.add("Deploy", "Committed", "warn", "the area file isn't in git: local only")
        return
    code, _ = git("cat-file", "-e", f"origin/main:{rel(path)}")
    ar.add("Deploy", "On the live app", "ok" if code == 0 else "info", "on origin/main" if code == 0 else "not on origin/main yet")
    if code:
        return
    stale, new = [], []
    for g in grid_names(ar):
        p = ar.out / f"{g}-{ar.id}.hab"
        if not p.exists():
            continue
        c1, live = git("rev-parse", f"origin/main:{rel(p)}")
        _, here = git("hash-object", rel(p))
        if c1:
            new.append(g)
        elif live != here:
            stale.append(g)
    if stale or new:
        ar.add("Deploy", "Live grids", "warn", "; ".join(
            ([f"the live app has older {', '.join(stale)} grids than this machine"] if stale else [])
            + ([f"no {', '.join(new)} grid on the live app yet"] if new else [])))
    else:
        ar.add("Deploy", "Live grids", "ok", "the live grids match this machine's")


# ---------------------------------------------------------------- thumbnails

def tile_xy(lon: float, lat: float, z: int) -> tuple[float, float]:
    n = 2 ** z
    x = (lon + 180) / 360 * n
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    return x, y


def pmtiles_thumb(path: Path, box: dict) -> Image.Image | None:
    from pmtiles.reader import MmapSource, Reader
    with open(path, "rb") as f:
        r = Reader(MmapSource(f))
        h = r.header()
        zmin, zmax = h.get("min_zoom", 0), h.get("max_zoom", 14)
        z = zmax
        while z > zmin:
            x0, _ = tile_xy(box["west"], box["north"], z)
            x1, _ = tile_xy(box["east"], box["north"], z)
            if x1 - x0 <= 4:
                break
            z -= 1
        x0, y0 = tile_xy(box["west"], box["north"], z)
        x1, y1 = tile_xy(box["east"], box["south"], z)
        tiles, size = {}, None
        for tx in range(int(x0), int(x1) + 1):
            for ty in range(int(y0), int(y1) + 1):
                data = r.get(z, tx, ty)
                if not data:
                    continue
                try:
                    im = Image.open(io.BytesIO(data)).convert("RGBA")
                except Exception:
                    return None  # vector tiles
                size = im.width
                tiles[(tx, ty)] = im
        if not size:
            return Image.new("RGB", (THUMB_W, THUMB_W), (60, 20, 20))
        cols, rows = int(x1) - int(x0) + 1, int(y1) - int(y0) + 1
        canvas = Image.new("RGBA", (cols * size, rows * size), (235, 235, 235, 255))
        for (tx, ty), im in tiles.items():
            canvas.alpha_composite(im, ((tx - int(x0)) * size, (ty - int(y0)) * size))
        crop = canvas.crop((int((x0 - int(x0)) * size), int((y0 - int(y0)) * size), int((x1 - int(x0)) * size), int((y1 - int(y0)) * size)))
        return crop.convert("RGB").resize((THUMB_W, max(1, round(crop.height * THUMB_W / crop.width))), Image.LANCZOS)


def ramp(a: np.ndarray, lo: float, hi: float, cmap: str) -> Image.Image:
    import matplotlib
    c = matplotlib.colormaps[cmap]
    v = np.clip((a - lo) / max(hi - lo, 1e-6), 0, 1)
    rgb = (c(v)[..., :3] * 255).astype(np.uint8)
    rgb[~np.isfinite(a)] = (40, 40, 40)
    return Image.fromarray(rgb)


def grid_img(arr: np.ndarray, lo: float, hi: float, cmap: str, h: dict, core: dict) -> Image.Image:
    im = ramp(arr, lo, hi, cmap)
    im = im.resize((THUMB_W, max(1, round(im.height * THUMB_W / im.width))), Image.NEAREST)
    d = ImageDraw.Draw(im)
    sx, sy = THUMB_W / h["cols"], im.height / h["rows"]
    x0 = (core["west"] - h["west"]) / h["dLon"] * sx
    x1 = (core["east"] - h["west"]) / h["dLon"] * sx
    y0 = (h["north"] - core["north"]) / abs(h["dLat"]) * sy
    y1 = (h["north"] - core["south"]) / abs(h["dLat"]) * sy
    d.rectangle([x0, y0, x1, y1], outline=(255, 255, 255), width=1)
    return im


def label_img(text: str, w: int = THUMB_W, h: int = 180) -> Image.Image:
    im = Image.new("RGB", (w, h), (70, 24, 24))
    try:
        f = ImageFont.truetype("C:/Windows/Fonts/segoeui.ttf", 15)
    except OSError:
        f = ImageFont.load_default()
    d = ImageDraw.Draw(im)
    y = h // 2 - 20
    for line in text.split("\n"):
        tw = d.textlength(line, font=f)
        d.text(((w - tw) / 2, y), line, font=f, fill=(255, 220, 210))
        y += 22
    return im


def vectors_thumb(ar: Area, box: dict) -> Image.Image | None:
    W = THUMB_W
    lat0 = (box["north"] + box["south"]) / 2
    kx = math.cos(math.radians(lat0))
    H = max(1, round(W * (box["north"] - box["south"]) / ((box["east"] - box["west"]) * kx)))
    im = Image.new("RGB", (W, H), (245, 243, 236))
    d = ImageDraw.Draw(im)

    def px(c):
        return ((c[0] - box["west"]) / (box["east"] - box["west"]) * W, (box["north"] - c[1]) / (box["north"] - box["south"]) * H)

    def rings(geom):
        t, cs = geom["type"], geom["coordinates"]
        if t == "Polygon":
            yield from cs
        elif t == "MultiPolygon":
            for p in cs:
                yield from p
        elif t == "LineString":
            yield cs
        elif t == "MultiLineString":
            yield from cs

    drawn = False
    for name, fill, line in (("forest", (150, 190, 140), None), ("fire", (240, 170, 120), (200, 110, 60)), ("waterbody", (130, 180, 225), (90, 140, 200)),
                             ("wetland", (170, 210, 200), None), ("roads", None, (60, 60, 60)), ("wmu", None, (150, 70, 170))):
        p = ar.out / f"{name}-{ar.id}.geojson"
        if not p.exists():
            continue
        try:
            fc = json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            continue
        for ft in fc.get("features", []):
            g = ft.get("geometry")
            if not g:
                continue
            for ring in rings(g):
                pts = [px(c) for c in ring]
                if len(pts) < 2:
                    continue
                if fill and g["type"].endswith("Polygon") and len(pts) > 2:
                    d.polygon(pts, fill=fill, outline=line)
                else:
                    d.line(pts, fill=line or fill, width=1)
                drawn = True
    return im if drawn else None


def make_thumbs(ar: Area, out: Path) -> None:
    core = ar.a["core"]
    cov = (ar.a.get("coverage") or {}).get("pmtiles") or {}
    tdir = out / "thumbs"
    tdir.mkdir(parents=True, exist_ok=True)
    area_file = AREAS / f"{ar.id}.json"

    def thumb(key: str, caption: str, note: str, srcs: list[Path], draw) -> None:
        """Draw it only when it is missing or older than what it shows."""
        f = tdir / f"{ar.id}-{key}.png"
        newest = max((p.stat().st_mtime for p in srcs + [area_file] if p.exists()), default=0)
        if not f.exists() or f.stat().st_mtime < newest:
            try:
                im = draw()
            except Exception as ex:
                im = label_img(f"{caption}\ncouldn't read: {type(ex).__name__}")
            if im is None:
                return
            im.save(f, optimize=True)
        ar.thumbs.append((f"thumbs/{f.name}", caption, note))

    for key, caption in (("satellite", "Imagery"), ("hillshadeLidar", "LiDAR shade"), ("hillshade", "Hillshade"), ("understory", "Bush thickness"),
                         ("lanes", "Shooting lanes"), ("topo", "Topo"), ("historical", "Historical topo")):
        e = cov.get(key, {})
        if "file" not in e:
            if key in ("hillshadeLidar", "understory", "lanes"):
                thumb(key, caption, e.get("missing", ""), [], lambda c=caption: label_img(f"{c}\nnot available here"))
            continue
        src = ar.out / e["file"]
        thumb(key, caption, e.get("source", ""), [src], lambda src=src: pmtiles_thumb(src, core))
    vec = [ar.out / f"{n}-{ar.id}.geojson" for n in ("forest", "fire", "waterbody", "wetland", "roads", "wmu")]
    thumb("vectors", "Vectors", "stands, burns, water, wetlands, roads, zones (core)", vec, lambda: vectors_thumb(ar, core))

    hab = ar.out / f"habitat-{ar.id}.hab"
    if hab.exists():
        h, b = read_hab(hab, ("cover", "thick"))
        if "cover" in b:
            thumb("hab-cover", "Habitat: cover class", "region; the box is the core", [hab],
                  lambda: grid_img(b["cover"], 0, max(1, len(h.get("coverNames", [])) - 1), "tab20", h, core))
        if "thick" in b:
            thumb("hab-thick", "Habitat: bush thickness", "open → thicket", [hab], lambda: grid_img(b["thick"], 0, 1, "YlOrRd", h, core))
    going = ar.out / f"going-{ar.id}.hab"
    if going.exists():
        def bush_src():
            gh, gb = read_hab(going, ("bushSrc",))
            # 0 water, 1 measured by the LiDAR, 2 the forest-map estimate (build_going.py)
            src = np.full(gb["bushSrc"].shape, np.nan, np.float32)
            src[gb["bushSrc"] == 1] = 0.25
            src[gb["bushSrc"] == 2] = 0.75
            return grid_img(src, 0, 1, "RdYlGn_r", gh, core)
        thumb("going-bushsrc", "Going: where bush is measured", "green: LiDAR · red: estimated · grey: water", [going], bush_src)
    micro = ar.out / f"micro-{ar.id}.hab"
    if micro.exists():
        mh, mb = read_hab(micro, ("canopy", "nUe", "nVe", "mU270.0", "mV270.0", "mT270.0"))
        if "canopy" in mb:
            thumb("micro-canopy", "Wind: canopy at head height", "how much the trees slow it", [micro], lambda: grid_img(mb["canopy"], 0, 1, "Greens", mh, core))
        if "nUe" in mb and "nVe" in mb:
            thumb("micro-neutral", "Wind from the W: older solve", "speed against the open forecast", [micro],
                  lambda: grid_img(np.hypot(mb["nUe"], mb["nVe"]), 0, 1.6, "magma", mh, core))
        if "mU270.0" in mb and "mV270.0" in mb:
            thumb("micro-momentum", "Wind from the W: WindNinja", "speed against the open forecast", [micro],
                  lambda: grid_img(np.hypot(mb["mU270.0"], mb["mV270.0"]), 0, 1.6, "magma", mh, core))
        else:
            thumb("micro-momentum", "Wind from the W: WindNinja", "no momentum bands in the grid", [micro],
                  lambda: label_img("Wind from the W: WindNinja\nnot solved yet"))
        # the tumble for a west wind: the solve's spread past the area's ordinary
        ref = ((mh.get("model") or {}).get("momentum") or {}).get("spreadRef")
        if "mT270.0" in mb and ref is not None:
            thumb("micro-turbulence", "Wind from the W: turbulence", f"spread past the ordinary ±{ref:.0f}°, 0 to 40°+ (it swirls from 25°)", [micro],
                  lambda: grid_img(np.maximum(0, mb["mT270.0"] - ref), 0, 40, "inferno", mh, core))
        else:
            thumb("micro-turbulence", "Wind from the W: turbulence", "no turbulence bands in the grid", [micro],
                  lambda: label_img("Wind from the W: turbulence\nnot in the grid yet"))


# ---------------------------------------------------------------- the page

ICON = {"ok": ("✓", "Done"), "warn": ("!", "Check"), "fail": ("✗", "Missing"), "na": ("–", "n/a"), "info": ("i", "Note")}
SUMMARY = [("Data", "Terrain"), ("Data", "Bush and lanes"), ("Data", "Forest stands"), ("Wind", "Momentum solve (WindNinja)"),
           ("Wind", "Turbulence (WindNinja)"), ("Wind", "Leaf calendar"), ("Wind", "HRDPS forecast"), ("Model", "Moose model"), ("Deploy", "Live grids")]


def badge(status: str) -> str:
    i, word = ICON[status]
    return f'<span class="b b-{status}"><i aria-hidden="true">{i}</i>{word}</span>'


def page(areas: list[Area], when: str, refresh: int = 0, kit: dict | None = None) -> str:
    e = html.escape
    import status as wn
    kit = kit or {"areas": [], "jobs": []}
    head_cells = "".join(f"<th scope='col'>{e(l)}</th>" for _, l in SUMMARY)
    rows = []
    for ar in areas:
        cells = []
        for g, l in SUMMARY:
            c = next((c for c in ar.checks if c.group == g and c.label == l), None)
            cells.append(f"<td title='{e(c.detail) if c else ''}'>{badge(c.status) if c else '<span class=muted>—</span>'}</td>")
        rows.append(f"<tr><th scope='row'><a href='#{ar.id}'>{e(ar.a['name'])}</a><span class=muted> {e(ar.a.get('jurisdiction', ''))}</span></th>{''.join(cells)}</tr>")
    sections = []
    for ar in areas:
        groups = {}
        for c in ar.checks:
            groups.setdefault(c.group, []).append(c)
        gl = []
        for g, cs in groups.items():
            items = "".join(f"<li>{badge(c.status)}<b>{e(c.label)}</b><span class=d>{e(c.detail)}</span></li>" for c in cs)
            gl.append(f"<div class=group><h3>{e(g)}</h3><ul>{items}</ul></div>")
        thumbs = "".join(f"<figure><img src='{e(f)}' alt='{e(cap)}' loading='lazy'><figcaption><b>{e(cap)}</b>{('<span>' + e(n) + '</span>') if n else ''}</figcaption></figure>" for f, cap, n in ar.thumbs)
        bad = sum(c.status == "fail" for c in ar.checks)
        warn = sum(c.status == "warn" for c in ar.checks)
        jobs = [j for j in kit["jobs"] if j["area"] == ar.id]
        rose = ""
        if jobs:
            run = [j for j in jobs if j["state"] == "running"]
            line = ", ".join(f"{j['dir']:g}° {wn.machine(j['who'])} {round(j['frac'] * 100)}%" for j in run)
            rose = f"<figure class=wn>{wn.rose(ar.id, jobs)}<figcaption><b>WindNinja + turbulence</b><span>{e(line) if line else 'nothing running'}</span></figcaption></figure>"
        sections.append(f"""<section id="{ar.id}"><div class=sechead><div><h2>{e(ar.a['name'])} <span class=muted>{e(ar.a.get('jurisdiction', ''))} · {ar.a['centre'][1]:.3f}, {ar.a['centre'][0]:.3f}</span></h2>
<p class=tally>{bad} missing · {warn} to check</p></div>{rose}</div><div class=groups>{''.join(gl)}</div><div class=thumbs>{thumbs}</div></section>""")
    return f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Area Checklist</title>{f'<meta http-equiv="refresh" content="{refresh}">' if refresh else ''}<style>
:root {{ --bg:#f6f5f0; --fg:#18200f; --dim:#4b5544; --line:#d9d6cb; --raised:#fff; --ok:#2f7d2a; --warn:#a8641b; --fail:#b8262c; --info:#2b5f9e; color-scheme: light }}
@media (prefers-color-scheme: dark) {{ :root:not([data-theme="light"]) {{ --bg:#0d130e; --fg:#eef3ea; --dim:#a9b8a4; --line:#2a3628; --raised:#151d16; --ok:#86d97a; --warn:#e2a35a; --fail:#ff7b7b; --info:#79b8ff; color-scheme: dark }} }}
:root[data-theme="dark"] {{ --bg:#0d130e; --fg:#eef3ea; --dim:#a9b8a4; --line:#2a3628; --raised:#151d16; --ok:#86d97a; --warn:#e2a35a; --fail:#ff7b7b; --info:#79b8ff; color-scheme: dark }}
body {{ margin:0; background:var(--bg); color:var(--fg); font:15px/1.45 system-ui, -apple-system, 'Segoe UI', sans-serif }}
main {{ max-width:1180px; margin:0 auto; padding:24px 16px 64px }}
h1 {{ font-size:1.6rem; margin:0 0 4px }} h2 {{ font-size:1.25rem; margin:0 }} h3 {{ font-size:.78rem; text-transform:uppercase; letter-spacing:.08em; color:var(--dim); margin:0 0 6px }}
.muted {{ color:var(--dim); font-weight:400 }} .lede {{ color:var(--dim); margin:0 0 20px; max-width:60em }}
.wrap {{ overflow-x:auto; border:1px solid var(--line); border-radius:10px; background:var(--raised) }}
table {{ border-collapse:collapse; width:100%; min-width:760px }} th, td {{ padding:8px 10px; border-bottom:1px solid var(--line); text-align:left; vertical-align:top; font-size:.9rem }}
thead th {{ font-size:.72rem; text-transform:uppercase; letter-spacing:.06em; color:var(--dim) }}
tbody tr:last-child > * {{ border-bottom:0 }} a {{ color:inherit }}
.b {{ display:inline-flex; align-items:center; gap:5px; font-weight:600; font-size:.8rem; white-space:nowrap }}
.b i {{ font-style:normal; display:inline-grid; place-items:center; width:18px; height:18px; border-radius:50%; color:var(--bg); font-size:.72rem }}
.b-ok {{ color:var(--ok) }} .b-ok i {{ background:var(--ok) }} .b-warn {{ color:var(--warn) }} .b-warn i {{ background:var(--warn) }}
.b-fail {{ color:var(--fail) }} .b-fail i {{ background:var(--fail) }} .b-info {{ color:var(--info) }} .b-info i {{ background:var(--info) }} .b-na {{ color:var(--dim) }} .b-na i {{ background:var(--dim) }}
section {{ margin-top:40px; padding-top:20px; border-top:1px solid var(--line) }} .tally {{ color:var(--dim); margin:4px 0 14px }}
.groups {{ display:grid; gap:14px 28px; grid-template-columns:repeat(auto-fit, minmax(min(100%, 520px), 1fr)) }}
.group ul {{ list-style:none; padding:0; margin:0 }} .group li {{ display:grid; grid-template-columns:5.6rem 11rem minmax(0, 1fr); gap:8px; padding:6px 0; border-top:1px solid var(--line); align-items:baseline }}
.group li .d {{ color:var(--dim); font-size:.88rem; min-width:0; overflow-wrap:anywhere }}
@media (max-width:560px) {{ .group li {{ grid-template-columns:5.6rem 1fr }} .group li .d {{ grid-column:2 }} }}
.thumbs {{ display:grid; gap:14px; grid-template-columns:repeat(auto-fill, minmax(min(100%, 200px), 1fr)); margin-top:18px }}
figure {{ margin:0 }} figure img {{ width:100%; height:auto; display:block; border-radius:6px; border:1px solid var(--line); background:#ddd }}
figcaption {{ font-size:.82rem; margin-top:5px; display:grid }} figcaption span {{ color:var(--dim); font-size:.76rem }}
.sechead {{ display:flex; justify-content:space-between; gap:16px; align-items:flex-start; flex-wrap:wrap }}
.wn {{ display:flex; gap:10px; align-items:center; margin:0 }} .wn figcaption {{ margin:0 }}
.rose {{ width:96px; height:96px }} .rose .cardinal {{ font:600 13px system-ui; fill:var(--dim); text-anchor:middle }}
.rose .count {{ font:700 22px system-ui; fill:var(--fg); text-anchor:middle }} .rose .of {{ font:11px system-ui; fill:var(--dim); text-anchor:middle }}
.w-done {{ fill:var(--ok) }} .w-running {{ fill:var(--info) }} .w-waiting {{ fill:var(--line) }} .w-held {{ fill:var(--line); opacity:.45 }}
.w-failed {{ fill:var(--fail) }} .w-track {{ fill:var(--line); stroke:var(--info); stroke-width:1.5 }}
</style></head><body><main>
<h1>Area checklist</h1>
<p class="lede">Every area, what it's built from, and what's missing or stale. Generated {e(when)} by pipeline/area_checklist.py from the area files, the baked grids and the WindNinja kit. Hover a cell for its detail.</p>
<div class="wrap"><table><thead><tr><th scope="col">Area</th>{head_cells}</tr></thead><tbody>{''.join(rows)}</tbody></table></div>
{''.join(sections)}
</main></body></html>"""


# ---------------------------------------------------------------- running

def load(area_id: str) -> Area:
    a = json.loads((AREAS / f"{area_id}.json").read_text(encoding="utf-8"))
    out = ROOT / (a.get("bake") or {}).get("outDir", f"app/public/data/areas/{area_id}")
    return Area(area_id, a, out)


def run_checks(ar: Area, online: bool = False) -> Area:
    check_files(ar)
    check_tier(ar)
    check_wind(ar, online)
    check_grids(ar)
    check_model(ar)
    check_deploy(ar)
    return ar


def print_warnings(area_id: str) -> None:
    """For bake_area.py: say out loud what is missing or worth a look."""
    try:
        ar = run_checks(load(area_id))
    except Exception as e:  # never fail a bake over its checklist
        print(f"-- checklist: couldn't run ({e})")
        return
    flagged = [c for c in ar.checks if c.status in ("fail", "warn")]
    if not flagged:
        print("-- checklist: nothing missing")
        return
    print(f"-- checklist for {area_id} (pipeline/area_checklist.py for the full page):")
    for c in flagged:
        print(f"   {'MISSING' if c.status == 'fail' else 'check  '} {c.group} / {c.label}: {c.detail}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--area", action="append", help="only these areas (default: every area file)")
    ap.add_argument("--online", action="store_true", help="also ask Open-Meteo whether HRDPS covers each area")
    ap.add_argument("--out", default=str(KIT / "areas"))
    ap.add_argument("--loop", nargs="?", const=60, type=int, help="rewrite the page every N seconds (default 60)")
    args = ap.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    import time
    from datetime import datetime
    import status as wn
    while True:
        try:
            ids = args.area or sorted(p.stem for p in AREAS.glob("*.json"))
            areas = []
            for i in ids:
                ar = run_checks(load(i), args.online)
                make_thumbs(ar, out)
                areas.append(ar)
                if not args.loop:
                    bad = [c.label for c in ar.checks if c.status == "fail"]
                    print(f"{i}: {len(ar.checks)} checks, {len(ar.thumbs)} thumbnails" + (f", missing: {', '.join(bad)}" if bad else ""))
            kit = wn.scan() if KIT.exists() else None
            tmp = out / "index.html.part"
            tmp.write_text(page(areas, datetime.now().strftime("%Y-%m-%d %H:%M:%S"), args.loop or 0, kit), encoding="utf-8")
            tmp.replace(out / "index.html")
            if not args.loop:
                print(f"wrote {out / 'index.html'}")
                return 0
        except Exception as e:  # a file mid-write, a share hiccup: try again next round
            print(f"{datetime.now():%H:%M:%S} {e}", flush=True)
            if not args.loop:
                raise
        time.sleep(args.loop)


if __name__ == "__main__":
    sys.exit(main())
