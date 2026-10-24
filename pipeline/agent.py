r"""The bake agent: areas asked for from the app or the site, baked on this PC
unattended and put in the data store (docs/SD-HD-PLAN.md, The loop: Bake).

    py -3.14 pipeline/agent.py --watch [--poll 60]   # take requests as they come, until stopped
    py -3.14 pipeline/agent.py --once                 # take one request, if one is waiting, and stop
    py -3.14 pipeline/agent.py --approve 42           # ship request 42, parked at review, as it was baked
    py -3.14 pipeline/agent.py --reject 42 --why "…"  # mark request 42 failed instead
    py -3.14 pipeline/agent.py --requeue 42           # put request 42 back in the queue, to bake again
    py -3.14 pipeline/agent.py --at-logon             # start --watch at every sign-in (a scheduled task)

It asks the groundwind.app Worker for the oldest queued request
(GET /api/bake/next, which claims it), the way the WindNinja runners watch
the kit for jobs, so nothing has to reach in to this PC. For each one:

1. An SD area file round the point, or round the box drawn in Explore
   (bake_area.py --new --sd; the core is the box, the region 5 km more each
   way), kept out of the app's list in pipeline/raw/requests/areas/. Its id
   is the pack's (docs/REQUESTS.md, The model): sd- and ten characters no
   one can guess without the bake key (pack_id), the same on every machine
   and every try; requests begun before 2026-10-24 keep their slug-and-number
   ids (white-river-r42). The
   province comes from the point: Natural Earth's polygons where
   coverage.py has cached them, else rough boxes. ON, QC, YT and BC bake
   with their adapters, anywhere else the national layers only. In Ontario
   the stands come from the FRI package over the point when it is on this
   PC (pipeline/raw/fri), else from SCANFI.
2. The bake (bake_area.py --area <id>) with the SD steps: everything but
   the point cloud, the bush and lanes from it and the 1 m contours (the
   --sd area file skips them too; its hillshade step makes the core's
   elevation grid from the 30 m MRDEM, and WindNinja is no step of
   bake_area's). wind-sd and micro carry the surrogate's wind: an SD area's
   one micro grid has it, so micro-sd is skipped by design. It bakes into
   pipeline/raw/requests/out/<id>/ (HUNTAPP_AREAS_DIR, HUNTAPP_OUT), so the
   repo and the published areas are untouched; each step is posted as the
   request's progress.
3. The gate: area_checklist.py's checks of the baked folder (not its
   deploy check, which is about git). A step that failed, or any check
   short of ok but the two warnings every SD area has by design (LET_PASS:
   the 30 m terrain, the satellite bush model), parks the request at
   review with what was flagged; the files stay here until --approve
   ships them or --reject drops them.
4. The pack (the files the area's coverage lists) and its manifest.json go
   to R2 under data/areas/<id>/, beside the areas app/scripts/r2_sync.py
   puts there, so the app reads them where it reads any area's
   (VITE_DATA_BASE https://data.groundwind.app/data/ and the area's base
   areas/<id>/). Files a rebake no longer makes are removed, and the
   request is done with the area file and the manifest, which the Worker
   hands to a phone that has the pack's id (/areas/<id>/area.json): the
   location it was asked for opens on it, with no app build.

Any exception marks the request failed with the traceback's tail, and the
loop goes on. One agent per PC (a lock file); a request it was baking when
it stopped is handed back by the Worker and baked again when it starts.

Environment: BAKE_KEY (the Worker's secret, `npx wrangler secret put
BAKE_KEY`), GROUNDWIND_API (default https://groundwind.app),
R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY, AGENT_NAME (default the PC's
name), AGENT_R2_PREFIX (put before areas/<id>/: data/, or _test/ for a
trial). Each
is read from HKCU\Environment when the process does not have it, so a new
setx needs no new shell. AGENT_DRY_RUN=1 proves the loop with no bake: a
tiny fake area goes to R2 under _test/ (review or fail in place of 1 take
those paths). The agent's own log is pipeline/agent.log; each bake's whole
output is pipeline/raw/requests/logs/<request>.log.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import json
import math
import mimetypes
import os
import re
import shutil
import socket
import struct
import subprocess
import sys
import time
import traceback
import urllib.error
import urllib.request
from datetime import date, datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(HERE))

from bake_area import km_size, slug  # noqa: E402  (no side effects: it imports area.py only when baking)

REQ = HERE / "raw" / "requests"
AREAS = REQ / "areas"
OUT = REQ / "out"
LOGS = REQ / "logs"
LOG = HERE / "agent.log"
LOCK = REQ / "agent.lock"
CATALOGUES = HERE / "raw" / "coverage" / "catalogues"  # coverage.py's cache: Natural Earth provinces, the FRI packages
FRI_DIR = HERE / "raw" / "fri"

R2_ENDPOINT = "https://ebcafd8e3dbdaad405e17dfb174c0f0f.r2.cloudflarestorage.com"
R2_BUCKET = "groundwind-data"
DEFAULT_API = "https://groundwind.app"

# what an SD bake leaves out (--sd skips them as well; named here so a change
# to the area file's form can never slip the point cloud back in)
SD_LEAVE_OUT = {"pointcloud", "vegstructure", "contours"}
# the box drawn is the core; the region (the wider map, and the ground the
# wind and the distances see past the core's edge) is this much more each
# way, as Searchmont's was
REGION_MARGIN_KM = 5.0
# the checklist's warnings every SD area raises by design, let through the
# gate: (group, label, how the detail starts). Any other warning, or one of
# these worded otherwise (the bush layer missing outright), parks the request
# for Gavan.
LET_PASS: tuple[tuple[str, str, str], ...] = (
    # no 1 m LiDAR: SD's relief, contours and core elevation are the 30 m MRDEM's
    ("Data", "Terrain", "30 m national model (MRDEM) only"),
    # no point cloud: the bush layer is the satellite bush model's, and there are no lanes
    ("Data", "Bush and lanes", "bush from the satellite bush model"),
    # outside Ontario and Quebec no province flies imagery: Esri's sharp streams over the box (live.sharp)
    ("Data", "Imagery", "not in this area's maps"),
    # every area starts on Ontario's leaf dates until its own are set: a note for the editor, not a flaw in the bake
    ("Wind", "Leaf calendar", "Ontario's default dates"),
    # the moose rules were written for boreal Ontario: true of every area outside it, said once in the file
    ("Model", "Moose model", "rules written for boreal Ontario"),
    # a US area's terrain is 3DEP's 30 m, not the MRDEM's, and its stands LANDFIRE's (us_stage.py)
    ("Data", "Terrain", "30 m national"),
    ("Data", "Forest stands", "inferred from the national maps"),
)


# the US states, by their two letters (bake_area.py US_STATES): their areas stage US rasters first (new_area)
def is_us(code: str) -> bool:
    try:
        from bake_area import US_STATES

        return code in US_STATES
    except Exception:  # noqa: BLE001
        return False


def let_pass(c) -> bool:
    return any(c.group == g and c.label == lab and c.detail.startswith(d) for g, lab, d in LET_PASS)
# the provinces with adapters (bake_area.py ADAPTERS); elsewhere the national layers
ADAPTED = {"ON", "QC", "YT", "BC"}
# rough boxes (west, south, east, north), for when the polygons are not on
# this PC: tried in order, so eastern Ontario comes before Quebec's box
BOXES = [
    ("YT", (-141.0, 60.0, -124.3, 69.7)),
    ("BC", (-139.1, 48.2, -114.0, 60.0)),
    ("ON", (-79.52, 41.6, -74.34, 45.4)),
    ("ON", (-95.16, 41.6, -79.52, 56.9)),
    ("QC", (-79.52, 45.0, -57.1, 62.6)),
    ("MB", (-102.0, 49.0, -95.16, 60.0)),
    ("SK", (-110.0, 49.0, -102.0, 60.0)),
    ("AB", (-120.0, 49.0, -110.0, 60.0)),
    ("NB", (-69.1, 44.6, -63.7, 48.1)),
    ("NS", (-66.4, 43.4, -59.7, 47.1)),
    ("NL", (-67.8, 46.6, -52.6, 60.4)),
]
CONTENT_TYPES = {".pmtiles": "application/octet-stream", ".hab": "application/octet-stream", ".geojson": "application/geo+json", ".json": "application/json"}


# ---- settings and the log ----------------------------------------------------


def setting(name: str, default: str | None = None) -> str | None:
    """An environment value, else the user's saved one (HKCU\\Environment):
    a task started at sign-in, or a shell older than the setx, still finds
    it. Trimmed: the saved R2 secret has a stray character at an end."""
    v = os.environ.get(name)
    if not v and os.name == "nt":
        try:
            import winreg

            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment") as k:
                v = str(winreg.QueryValueEx(k, name)[0])
        except OSError:
            v = None
    v = (v or "").strip().strip('"').strip()
    return v or default


def log(msg: str) -> None:
    line = f"{datetime.now():%Y-%m-%d %H:%M:%S} {msg}"
    print(line, flush=True)
    with LOG.open("a", encoding="utf-8") as f:
        f.write(line + "\n")


def dry_run() -> str | None:
    """AGENT_DRY_RUN: '1' (clean), 'review' or 'fail', else None."""
    v = (os.environ.get("AGENT_DRY_RUN") or "").strip().lower()
    return None if v in ("", "0", "no", "false") else ("1" if v in ("1", "yes", "true") else v)


# ---- the Worker ----------------------------------------------------------------


class Api:
    """The Worker's bake endpoints, with the shared secret."""

    def __init__(self, base: str, key: str, agent: str):
        self.base, self.key, self.agent = base.rstrip("/"), key, agent

    def call(self, method: str, path: str, body: dict | None = None, tries: int = 1) -> tuple[int, dict]:
        data = json.dumps(body).encode() if body is not None else None
        # our own name: Cloudflare answers Python's default User-Agent with a 403 on groundwind.app
        headers = {"X-Bake-Key": self.key, "User-Agent": f"groundwind-agent/1 {self.agent}", "Accept": "application/json"}
        if data is not None:
            headers["Content-Type"] = "application/json"
        for attempt in range(tries):
            if attempt:
                time.sleep(min(60, 5 * 2 ** (attempt - 1)))
            try:
                req = urllib.request.Request(self.base + path, data=data, method=method, headers=headers)
                with urllib.request.urlopen(req, timeout=60) as r:
                    return r.status, json.loads(r.read() or b"{}")
            except urllib.error.HTTPError as e:
                try:
                    answer = json.loads(e.read() or b"{}")
                except ValueError:
                    answer = {}
                if e.code < 500 or attempt == tries - 1:  # a refusal is an answer, not a hiccup
                    return e.code, answer
            except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
                if attempt == tries - 1:
                    raise ConnectionError(f"{method} {path}: {e}") from e
        raise AssertionError("unreachable")

    def next(self) -> dict | None:
        status, answer = self.call("GET", f"/api/bake/next?agent={self.agent}&kinds=sd", tries=3)
        if status != 200:
            raise RuntimeError(f"/api/bake/next answered {status}: {answer}")
        return answer.get("request")

    def post(self, rid: int, stage: str, must: bool = True, **fields) -> dict:
        """A stage for the request. Progress (must=False) is best effort: a
        missed one only leaves the phone a step behind."""
        try:
            status, answer = self.call("POST", f"/api/bake/{rid}", {"stage": stage, "agent": self.agent, **fields}, tries=6 if must else 2)
        except ConnectionError:
            if must:
                raise
            log(f"#{rid}: progress {stage} {fields.get('step', '')} not sent (no answer)")
            return {}
        if status != 200:
            if must:
                raise RuntimeError(f"/api/bake/{rid} {stage} answered {status}: {answer}")
            log(f"#{rid}: progress {stage} {fields.get('step', '')} refused ({status} {answer})")
        return answer

    def status(self, rid: int) -> dict:
        status, answer = self.call("GET", f"/api/request?id={rid}", tries=3)
        if status != 200:
            raise RuntimeError(f"/api/request?id={rid} answered {status}: {answer}")
        return answer


# ---- what to bake ------------------------------------------------------------------


def jurisdiction(lat: float, lon: float) -> str:
    """The province or territory under the point, by its two-letter code:
    Natural Earth's 50 m polygons where coverage.py has cached them, else
    the rough boxes. 'CA' where neither knows (offshore, the far north)."""
    ne = CATALOGUES / "ne-admin1.json"
    if not ne.exists():
        # another machine (xonix) without coverage.py's cache: the same Natural Earth file, fetched once (~3 MB);
        # without it Michigan would read as ON from the rough boxes
        try:
            import urllib.request

            CATALOGUES.mkdir(parents=True, exist_ok=True)
            with urllib.request.urlopen("https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_1_states_provinces.geojson", timeout=120) as r:
                ne.write_bytes(r.read())
            log(f"fetched the provinces and states ({ne.name})")
        except Exception as e:  # noqa: BLE001
            log(f"no provinces file and none fetched ({str(e)[:80]}); using the rough boxes")
    if ne.exists():
        try:
            import shapely

            pt = shapely.Point(lon, lat)
            for f in json.loads(ne.read_text(encoding="utf-8"))["features"]:
                p = f.get("properties") or {}
                if p.get("adm0_a3") in ("CAN", "USA") and f.get("geometry") and shapely.geometry.shape(f["geometry"]).covers(pt):
                    return str(p.get("postal") or (p.get("iso_3166_2") or "CA-CA")[3:])
        except Exception as e:  # noqa: BLE001  (a bad cache: the boxes still answer)
            log(f"provinces from {ne.name} failed ({e}); using the rough boxes")
    for code, (w, s, e, n) in BOXES:
        if w <= lon <= e and s <= lat <= n:
            return code
    return "CA"


def _pkg_key(name: str) -> str:
    """An FRI package's name as both the catalogue and the folder spell it:
    pp_FRI_FIMv2_TimiskamingForest(280)_2014_2D and
    pp_FRI_FIMv2_TimiskamingForest_2014_2D.gdb are one package."""
    s = name.lower().removesuffix(".zip").removesuffix(".gdb").removeprefix("pp_fri_fimv2_")
    return re.sub(r"[^a-z0-9]", "", re.sub(r"\(\d+\)", "", s))


def ontario_stands(region: dict, lat: float, lon: float) -> dict | None:
    """The FRI packages on this PC over an Ontario region, as the area
    file's bake.forest; None when the forest unit under the point has none
    here (the FRI per request is not built: SD-HD-PLAN.md), so SCANFI."""
    cat = CATALOGUES / "fri-v2-boundaries.json"
    if not cat.exists():
        return None
    import shapely

    local = {_pkg_key(p.name): p for p in FRI_DIR.glob("*.gdb")}
    box = shapely.box(region["west"], region["south"], region["east"], region["north"])
    pt = shapely.Point(lon, lat)
    hits, centre_ok = [], False
    for f in json.loads(cat.read_text(encoding="utf-8")).get("features", []):
        p = f.get("properties") or {}
        m = re.search(r"Packages/([^\"/]+?\.zip)", str(p.get("Data_2D") or ""))
        if not m or not f.get("geometry"):
            continue
        g = shapely.geometry.shape(f["geometry"])
        if not g.intersects(box):
            continue
        gdb = local.get(_pkg_key(m.group(1)))
        if gdb and gdb not in [h[0] for h in hits]:
            hits.append((gdb, p.get("FMU_NAME"), p.get("Year")))
        if g.covers(pt):
            centre_ok = centre_ok or gdb is not None
    if not centre_ok:
        return None
    return {
        "adapter": "on.fri",
        "gdb": [h[0].relative_to(HERE).as_posix() for h in hits],
        "crs": None,
        "vintage": ", ".join(f"{y} ({n})" for _, n, y in hits),
    }


SCANFI = {"adapter": "ca.scanfi", "vintage": "SCANFI 2025; CanLaD 1985-2025", "attribution": "Forest inferred from SCANFI and CanLaD © Natural Resources Canada"}
COORDS = re.compile(r"-?\d{1,3}\.\d+\s*[,\s]\s*-?\d{1,3}\.\d+")


def pack_id(rid: int, kind: str = "sd") -> str:
    """A request's pack id (docs/REQUESTS.md, Access: the id is the only way
    to a pack): its kind and ten characters of an HMAC of its number under
    the bake key, so no one can guess it from the request numbers, and every
    machine and every try of it lands in the same folder."""
    key = (setting("BAKE_KEY") or "").strip().encode()
    d = hmac.new(key, f"pack:{rid}".encode(), hashlib.sha256).digest()
    return f"{kind}-{base64.b32encode(d).decode().lower().rstrip('=')[:10]}"


# How long each step of an SD bake took on request #10 (Algoma, ON, a 9.9 x 10 km box, 2026-10-24:
# pipeline/raw/requests/logs/10.log, 4,543 s in all; #13 in Alberta agrees), the dem as step 2 bakes it
# (to z12: 73 s for #10's box again, the same day): the weights of the progress a phone is shown
# (docs/REQUESTS.md, Status). A step the plan skips weighs nothing (plan_of); one not here counts
# STEP_DEFAULT_S. The area file and the US staging come before, the checklist and the upload after.
STEP_S = {
    "area file": 30, "rasters": 1, "vectors": 35, "property": 13, "forest": 17, "topo": 1308, "satellite": 223,
    "historical": 38, "hillshade": 2, "dem": 73, "contours-wide": 65, "habitat": 299, "profile": 2, "bush": 101,
    "depth-bands": 7, "wind-sd": 27, "micro": 35, "going": 4, "vector-tiles": 67, "checklist": 10, "upload": 35,
}
STEP_DEFAULT_S = 30


def plan_of(steps: list[str], skipped: list[str] | tuple[str, ...] = ()) -> list[str]:
    """Every step a request goes through, in order, for its progress; the ones the plan skips weigh nothing."""
    return ["area file", *[s for s in steps if s not in skipped], "checklist", "upload"]


def progress_at(plan: list[str] | None, step: str) -> float | None:
    """How far a request is as `step` starts: the weights of the steps before it over all of them."""
    if not plan or step not in plan:
        return None
    w = [STEP_S.get(s, STEP_DEFAULT_S) for s in plan]
    return round(sum(w[: plan.index(step)]) / sum(w), 3)


def what(req: dict) -> dict:
    """The area a request asks for: its name and id, the point, the box
    (None: Pickle Lake's sizes round the point) and the province."""
    rid = int(req["id"])
    box = json.loads(req["box"]) if req.get("box") else None
    lat, lon = req.get("lat"), req.get("lon")
    if box:
        lat, lon = (box["south"] + box["north"]) / 2, (box["west"] + box["east"]) / 2
    if lat is None or lon is None:
        raise ValueError("the request has no point to bake round")
    name = (req.get("name") or "").strip()
    place = (req.get("place") or "").strip()
    # a place name typed on the site, but not coordinates or Explore's box in words
    if not name and place and not COORDS.search(place) and not re.match(r"^[bt]-\d", place):
        name = place[:60]
    stem = slug(name)[:32].strip("-") if name else ""
    # a request taken up again keeps the id it was baking under (the Worker hands it back), and one
    # begun before pack ids its slug-and-number one (its folder and area file are there)
    legacy = f"{stem or 'area'}-r{rid}"
    kind = "hd" if req.get("kind") == "hd" else "sd"
    if req.get("resumed") and req.get("area_id"):
        area_id = str(req["area_id"])
    elif (AREAS / f"{legacy}.json").exists():
        area_id = legacy
    else:
        area_id = pack_id(rid, kind)
    return {
        "rid": rid,
        "name": name or f"Area near {lat:.3f}, {lon:.3f}",
        "id": area_id,
        "lat": round(float(lat), 6),
        "lon": round(float(lon), 6),
        "box": box,
        "jurisdiction": jurisdiction(float(lat), float(lon)),
    }


# ---- baking ------------------------------------------------------------------------


def py_env(*, scratch: bool) -> dict:
    """The environment for bake_area.py: with the request folders for the
    bake itself, without them (and without an area) for --new, which reads
    Pickle Lake's file from the app's list for its sizes and adapters."""
    env = {k: v for k, v in os.environ.items() if k not in ("HUNTAPP_AREA", "HUNTAPP_AREAS_DIR", "HUNTAPP_OUT")}
    env |= {"PYTHONIOENCODING": "utf-8", "PYTHONUNBUFFERED": "1"}
    if scratch:
        env |= {"HUNTAPP_AREAS_DIR": str(AREAS)}
    return env


def run(argv: list[str], env: dict, logf, on_line=None) -> int:
    """A pipeline script, its output into the request's log line by line."""
    logf.write(f"$ {' '.join(argv)}\n")
    logf.flush()
    with subprocess.Popen(argv, cwd=ROOT, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace") as p:
        for line in p.stdout:
            logf.write(line)
            logf.flush()
            if on_line:
                on_line(line.rstrip("\r\n"))
        return p.wait()


def new_area(job: dict, logf) -> Path:
    """The area file: bake_area.py --new --sd, then the box and the stands."""
    path = AREAS / f"{job['id']}.json"
    AREAS.mkdir(parents=True, exist_ok=True)
    argv = [sys.executable, str(HERE / "bake_area.py"), "--new", "--sd", "--lat", str(job["lat"]), "--lon", str(job["lon"]),
            "--name", job["name"], "--id", job["id"], "--jurisdiction", job["jurisdiction"], "--out", str(path), "--force"]
    box = job["box"]
    if box:
        # a square at least the box's size, so --new's NTS sheets cover the region set below
        w, h = km_size(box)
        core_km = max(w, h) / 2
        argv += ["--core-km", f"{core_km:.3f}", "--region-km", f"{core_km + REGION_MARGIN_KM:.3f}"]
    us = is_us(job["jurisdiction"])
    if us:
        argv += ["--stage", job["id"]]
    rc = run(argv, py_env(scratch=False), logf)
    if rc or not path.exists():
        raise RuntimeError(f"bake_area.py --new exited {rc}: see {LOGS.relative_to(ROOT).as_posix()}/{job['rid']}.log")
    a = json.loads(path.read_text(encoding="utf-8"))
    if box:
        # the core is the box as drawn; the region rounds outward, so it always holds it
        dlat = REGION_MARGIN_KM / 110.574
        dlon = REGION_MARGIN_KM / (111.32 * math.cos(math.radians(job["lat"])))
        a["core"] = {**{k: round(box[k], 5) for k in ("west", "south", "east", "north")}, "maxzoom": a["core"]["maxzoom"]}
        a["region"] = {
            "west": math.floor((box["west"] - dlon) * 1000) / 1000,
            "south": math.floor((box["south"] - dlat) * 1000) / 1000,
            "east": math.ceil((box["east"] + dlon) * 1000) / 1000,
            "north": math.ceil((box["north"] + dlat) * 1000) / 1000,
        }
    if job["jurisdiction"] == "ON":
        stands = ontario_stands(a["region"], job["lat"], job["lon"])
        a["bake"]["forest"] = stands or SCANFI
        logf.write(f"-- stands: {stands['vintage'] if stands else 'SCANFI (no FRI package for this forest unit on this PC)'}\n")
    a["request"] = {"id": job["rid"], "baked": date.today().isoformat(), "by": "pipeline/agent.py"}
    path.write_text(json.dumps(a, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
    if us:
        # a US area's national rasters are staged from US sources under the Canadian names (docs/US-AREAS.md):
        # the downloads, the 30 m stage, the land cover and stands; then the ordinary SD steps run unchanged
        for script, more in (("us_fetch.py", ["--sd"]), ("us_terrain.py", ["--only", "wide"]), ("us_stage.py", [])):
            logf.write(f"-- {script}\n")
            rc = run([sys.executable, str(HERE / script), "--area", job["id"], *more], py_env(scratch=True), logf)
            if rc:
                raise RuntimeError(f"{script} exited {rc}: see {LOGS.relative_to(ROOT).as_posix()}/{job['rid']}.log")
    return path


def sd_steps(job: dict, logf) -> list[str]:
    """The steps of the area's plan (bake_area.py --list), less what SD leaves out."""
    lines: list[str] = []
    rc = run([sys.executable, str(HERE / "bake_area.py"), "--area", job["id"], "--list"], py_env(scratch=True) | {"HUNTAPP_OUT": str(OUT / job["id"])}, logf, lines.append)
    if rc:
        raise RuntimeError(f"bake_area.py --list exited {rc}")
    names = [m.group(1) for line in lines[1:] if (m := re.match(r"^[ -] ([a-z0-9-]+)\s", line))]
    if "wind-sd" not in names or "coverage" not in names:
        raise RuntimeError(f"the plan has no wind-sd or coverage step: {names}")
    # the steps the plan skips for this area (no source, not in its maps): no weight in its progress
    job["skipped"] = [m.group(1) for line in lines[1:] if (m := re.match(r"^[ -] ([a-z0-9-]+)\s+skipped:", line))]
    return [n for n in names if n not in SD_LEAVE_OUT]


def bake(job: dict, api: Api, logf, start: str | None = None) -> dict[str, str]:
    """bake_area.py --area <id> --only <the SD steps>, each step posted as it
    starts. The steps' results, as the bake's own summary says them.

    `start`: a bake taken up again (the PC went off, the agent was killed)
    goes on from the step it was in, keeping the files of the steps before,
    each of which had finished; the topo and DEM tiles alone are most of an
    hour. Past the steps (checklist, upload) nothing is baked again."""
    out = OUT / job["id"]
    steps = sd_steps(job, logf)
    job["plan"] = plan_of(steps, job.get("skipped", ()))
    if start in ("checklist", "upload") and out.is_dir():
        log(f"#{job['rid']} taken up after the bake ({start}): nothing to bake again")
        return {}
    if start in steps and out.is_dir():
        log(f"#{job['rid']} going on from {start}, keeping {', '.join(steps[: steps.index(start)]) or 'nothing'}")
        steps = steps[steps.index(start) :]
    else:  # a fresh bake starts clean: no file of an earlier try is passed off as this one's
        shutil.rmtree(out, ignore_errors=True)
        out.mkdir(parents=True)
    results: dict[str, str] = {}
    started = time.time()

    def on_line(line: str) -> None:
        if m := re.match(r"^-- ([a-z0-9-]+) \(py [\d.]+\)$", line):
            api.post(job["rid"], "baking", must=False, step=m.group(1), area_id=job["id"], progress=progress_at(job["plan"], m.group(1)))
        elif m := re.match(r"^-- ([a-z0-9-]+): (ok|failed: .*|skipped.*|cannot run, .*?)(?: \((\d+) s\))?$", line):
            results[m.group(1)] = m.group(2)
            if m.group(2) != "ok" or m.group(3):
                log(f"#{job['rid']} {m.group(1)}: {m.group(2)[:120]}" + (f" ({m.group(3)} s)" if m.group(3) else ""))

    argv = [sys.executable, str(HERE / "bake_area.py"), "--area", job["id"]] + [x for s in steps for x in ("--only", s)]
    rc = run(argv, py_env(scratch=True) | {"HUNTAPP_OUT": str(out)}, logf, on_line)
    log(f"#{job['rid']} bake exited {rc} after {time.time() - started:.0f} s")
    return results


def gate(job: dict, results: dict[str, str]) -> list[str]:
    """What keeps the area from shipping by itself: steps that failed, and
    the checklist's lines short of ok (not its git deploy check: these areas
    are never in git)."""
    import area_checklist as ck

    flagged = [f"Bake / {n}: {r}" for n, r in results.items() if r.startswith(("failed", "cannot run"))]
    a = json.loads((AREAS / f"{job['id']}.json").read_text(encoding="utf-8"))
    ar = ck.Area(job["id"], a, OUT / job["id"])
    for check in (ck.check_files, ck.check_tier, lambda x: ck.check_wind(x, False), ck.check_grids, ck.check_model):
        try:
            check(ar)
        except Exception as e:  # noqa: BLE001  (a check that cannot read the bake is a flag, not a crash)
            ar.add("Checklist", getattr(check, "__name__", "check"), "fail", f"could not run: {e}")
    flagged += [f"{c.group} / {c.label}: {c.status}, {c.detail}" for c in ar.checks if c.status in ("fail", "warn") and not (c.status == "warn" and let_pass(c))]
    return flagged


def fake_bake(job: dict, api: Api) -> dict[str, str]:
    """AGENT_DRY_RUN: a tiny area in place of the bake, so the loop (the
    claim, the stages, R2 and the done report) is proven in seconds."""
    out = OUT / job["id"]
    shutil.rmtree(out, ignore_errors=True)
    out.mkdir(parents=True)
    hab = f"habitat-{job['id']}.hab"
    topo = f"topo-{job['id']}.pmtiles"
    (out / hab).write_bytes(b"not a grid: agent.py dry run\n")
    # a PMTiles v3 header, so the manifest's zoom and bounds are read as for a real one
    head = bytearray(127)
    head[0:8] = b"PMTiles\x03"
    head[100], head[101] = 0, 14
    w, s, e, n = (job["lon"] - 0.1, job["lat"] - 0.05, job["lon"] + 0.1, job["lat"] + 0.05)
    struct.pack_into("<iiii", head, 102, *(round(v * 1e7) for v in (w, s, e, n)))
    (out / topo).write_bytes(bytes(head))
    region = {"west": round(w, 3), "south": round(s, 3), "east": round(e, 3), "north": round(n, 3)}
    a = {
        "id": job["id"], "name": job["name"], "jurisdiction": job["jurisdiction"], "centre": [job["lon"], job["lat"]],
        "home": {"center": [job["lon"], job["lat"]], "zoom": 13}, "region": region, "core": {**region, "maxzoom": 16},
        "regionMaxzoom": 13, "base": f"areas/{job['id']}/",
        "files": {"pmtiles": ["topo"], "geo": [], "baseGeo": [], "grids": ["habitat"]},
        "coverage": {"checked": date.today().isoformat(), "pmtiles": {"topo": {"file": topo, "bytes": 127}}, "geo": {}, "baseGeo": {},
                     "grids": {"habitat": {"file": hab, "bytes": (out / hab).stat().st_size}}},
        "request": {"id": job["rid"], "dryRun": True},
    }
    AREAS.mkdir(parents=True, exist_ok=True)
    (AREAS / f"{job['id']}.json").write_text(json.dumps(a, indent=2) + "\n", encoding="utf-8")
    for step in ("rasters", "vectors", "forest", "habitat", "wind-sd", "micro", "going", "coverage"):
        api.post(job["rid"], "baking", must=False, step=step, area_id=job["id"])
        time.sleep(0.2)
    if dry_run() == "fail":
        raise RuntimeError("AGENT_DRY_RUN=fail: a failure on purpose, to see the failed path")
    return {"habitat": "ok", "coverage": "ok"}


# ---- shipping ------------------------------------------------------------------------


def r2_client():
    import boto3

    key, secret = setting("R2_ACCESS_KEY_ID"), setting("R2_SECRET_ACCESS_KEY")
    if not key or not secret:
        raise RuntimeError("R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY are not set")
    return boto3.client("s3", endpoint_url=R2_ENDPOINT, aws_access_key_id=key, aws_secret_access_key=secret, region_name="auto")


def r2_prefix() -> str:
    """What goes before areas/<id>/ in the bucket: AGENT_R2_PREFIX, by
    default data/, where the app's data folder is (r2_sync.py); always
    _test/ on a dry run, so a trial can never land among real areas."""
    p = setting("AGENT_R2_PREFIX", "data/") or ""
    if dry_run():
        p = "_test/"
    if p and not p.endswith("/"):
        p += "/"
    return p


def archive_range(path: Path) -> dict:
    """A PMTiles v3 archive's zoom range and bounds from its header, as the
    app's build puts them in a manifest (vite.config.ts archiveRange)."""
    if path.suffix != ".pmtiles":
        return {}
    b = path.open("rb").read(127)
    if len(b) < 127 or b[:7] != b"PMTiles" or b[7] != 3:
        return {}
    deg = [round(v / 1e7, 7) for v in struct.unpack_from("<iiii", b, 102)]
    return {"z": [b[100], b[101]], "bounds": deg}


def sha16(path: Path) -> str:
    h = hashlib.sha1()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()[:16]


def pack_files(area_id: str) -> list[Path]:
    """The files a phone reads for the area: those its coverage found, in
    the groups of its files lists. The bake's inputs and working files in
    the folder (stands as GeoJSON, provenance, summaries) stay here."""
    a = json.loads((AREAS / f"{area_id}.json").read_text(encoding="utf-8"))
    cov = a.get("coverage") or {}
    names = sorted({e["file"] for g in ("pmtiles", "geo", "baseGeo", "grids") for e in (cov.get(g) or {}).values() if "file" in e})
    out = OUT / area_id
    missing = [n for n in names if not (out / n).is_file()]
    if missing:
        raise RuntimeError(f"the coverage lists files the folder lacks: {', '.join(missing)}")
    if not names:
        raise RuntimeError("the coverage lists no files: nothing to ship")
    return [out / n for n in names]


def ship(rid: int, area_id: str, api: Api, progress: bool = True, at: float | None = None) -> None:
    """The pack and its manifest into R2, then done with the area file. `at`:
    how far the request is as the upload starts, for the phone."""
    files = pack_files(area_id)
    manifest = {"files": {p.name: {"size": p.stat().st_size, "hash": sha16(p), **archive_range(p)} for p in files}}
    # the Worker hashes these very bytes for the index, as the app's build hashes its manifests
    body = json.dumps(manifest, separators=(",", ":"), ensure_ascii=False)
    size = sum(p.stat().st_size for p in files)
    prefix = f"{r2_prefix()}areas/{area_id}/"
    if progress:  # not from review (--approve): that stage stays until done
        api.post(rid, "baking", must=False, step="upload", area_id=area_id, progress=at)
    s3 = r2_client()
    t = time.time()
    for p in files:
        s3.upload_file(str(p), R2_BUCKET, prefix + p.name, ExtraArgs={
            "ContentType": CONTENT_TYPES.get(p.suffix) or mimetypes.guess_type(p.name)[0] or "application/octet-stream",
            # a rebake keeps the names: the manifest (no-cache) is what tells a phone a file changed
            "CacheControl": "public, max-age=300",
        })
    s3.put_object(Bucket=R2_BUCKET, Key=prefix + "manifest.json", Body=body.encode("utf-8"), ContentType="application/json", CacheControl="public, no-cache")
    # what is there now: every file at its size, and nothing a rebake left behind
    keys = {o["Key"]: o["Size"] for page in s3.get_paginator("list_objects_v2").paginate(Bucket=R2_BUCKET, Prefix=prefix) for o in page.get("Contents", [])}
    short = [p.name for p in files if keys.get(prefix + p.name) != p.stat().st_size]
    if short:
        raise RuntimeError(f"R2 does not hold these as uploaded: {', '.join(short)}")
    stale = [k for k in keys if k[len(prefix):] not in manifest["files"] and k != prefix + "manifest.json"]
    for k in stale:
        s3.delete_object(Bucket=R2_BUCKET, Key=k)
    log(f"#{rid} {len(files)} files, {size / 1e6:.1f} MB to r2://{R2_BUCKET}/{prefix} in {time.time() - t:.0f} s" + (f", {len(stale)} stale removed" if stale else ""))
    area_json = (AREAS / f"{area_id}.json").read_text(encoding="utf-8")
    api.post(rid, "done", area_id=area_id, area_json=area_json, files_json=body, size_bytes=size)


# ---- one request ----------------------------------------------------------------------


def handle(req: dict, api: Api) -> str:
    """Bake one claimed request through to done, review or failed. Never
    raises: whatever goes wrong is the request's failure, not the loop's."""
    rid = int(req["id"])
    LOGS.mkdir(parents=True, exist_ok=True)
    t = time.time()
    try:
        job = what(req)
        log(f"#{rid} {'taken up again' if req.get('resumed') else 'claimed'}: {job['name']!r} as {job['id']}, {job['jurisdiction']}, "
            f"{job['lat']:.5f}, {job['lon']:.5f}" + (f", box {km_size(job['box'])[0]:.1f} x {km_size(job['box'])[1]:.1f} km" if job["box"] else "")
            + (f" (dry run: {dry_run()})" if dry_run() else ""))
        api.post(rid, "baking", step="area file", area_id=job["id"], progress=0.0)
        if dry_run():
            results = fake_bake(job, api)
            flagged = ["Dry run / review: a warning on purpose, to see the review path"] if dry_run() == "review" else []
        else:
            with (LOGS / f"{rid}.log").open("a", encoding="utf-8") as logf:
                logf.write(f"== {datetime.now():%Y-%m-%d %H:%M} request {rid}: {json.dumps(job)}\n")
                # taken up again: the area file as the bake left it (its profile and coverage) and the step it was in
                start = req.get("step") if req.get("resumed") and (AREAS / f"{job['id']}.json").exists() else None
                if start in (None, "area file"):
                    start = None
                    new_area(job, logf)
                results = bake(job, api, logf, start)
            api.post(rid, "baking", must=False, step="checklist", area_id=job["id"], progress=progress_at(job.get("plan"), "checklist"))
            flagged = gate(job, results)
        if flagged:
            api.post(rid, "review", area_id=job["id"], error="\n".join(flagged))
            log(f"#{rid} parked at review after {time.time() - t:.0f} s: " + "; ".join(flagged))
            return "review"
        ship(rid, job["id"], api, at=progress_at(job.get("plan"), "upload"))
        log(f"#{rid} done in {time.time() - t:.0f} s")
        return "done"
    except Exception:  # noqa: BLE001  (the loop outlives any one request)
        tail = traceback.format_exc()[-3000:]
        log(f"#{rid} failed after {time.time() - t:.0f} s: {tail.strip().splitlines()[-1]}")
        try:
            api.post(rid, "failed", error=tail)
        except Exception as e:  # noqa: BLE001  (the Worker unreachable: it hands the request back next start)
            log(f"#{rid} could not be marked failed ({e})")
        return "failed"


# ---- the loop and the commands -------------------------------------------------------------


class Lock:
    """One agent per PC: two would take each other's requests back as
    their own (the Worker hands a machine its unfinished ones). The lock is
    the OS's, so it goes with the process however that ends."""

    def __enter__(self):
        REQ.mkdir(parents=True, exist_ok=True)
        self.f = LOCK.open("a+")
        try:
            if os.name == "nt":
                import msvcrt

                self.f.seek(0)
                msvcrt.locking(self.f.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl

                fcntl.flock(self.f, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            raise SystemExit(f"another agent is running on this PC ({LOCK})") from None
        return self

    def __exit__(self, *exc):
        self.f.close()
        return False


def watch(api: Api, poll: int, once: bool) -> int:
    log(f"agent {api.agent} on {api.base}, polling every {poll} s" + (" (once)" if once else "") + (f", dry run: {dry_run()}" if dry_run() else ""))
    while True:
        try:
            req = api.next()
        except Exception as e:  # noqa: BLE001  (no signal, the Worker down: wait and ask again)
            log(f"queue: {e}")
            if once:
                return 1
            time.sleep(poll)
            continue
        if not req:
            if once:
                log("nothing queued")
                return 0
            time.sleep(poll)
            continue
        outcome = handle(req, api)
        if once:
            return 0 if outcome in ("done", "review") else 1


def at_logon() -> int:
    """A scheduled task that starts --watch at every sign-in, in a hidden
    PowerShell window (the steps' own Python processes share its console,
    so none pops up), as start-runners.ps1 -AtLogon does for the runners."""
    py = shutil.which("py")
    cmd = f"& '{py}' -3.14 '{HERE / 'agent.py'}' --watch" if py else f"& '{sys.executable}' '{HERE / 'agent.py'}' --watch"

    def q(s: str) -> str:  # a PowerShell single-quoted string
        return "'" + s.replace("'", "''") + "'"

    ps = (
        f"$a = New-ScheduledTaskAction -Execute 'powershell.exe' "
        f"-Argument {q(f'-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command \"{cmd}\"')} -WorkingDirectory {q(str(ROOT))}; "
        "$t = New-ScheduledTaskTrigger -AtLogOn -User \"$env:USERDOMAIN\\$env:USERNAME\"; "
        "$s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero); "
        "Register-ScheduledTask -TaskName 'Groundwind bake agent' -Action $a -Trigger $t -Settings $s -Force | Out-Null; "
        "Write-Host \"Registered 'Groundwind bake agent' to start at sign-in. Start it now: Start-ScheduledTask -TaskName 'Groundwind bake agent'. "
        "Remove it: Unregister-ScheduledTask -TaskName 'Groundwind bake agent'\""
    )
    return subprocess.call(["powershell.exe", "-NoProfile", "-Command", ps])


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--watch", action="store_true", help="take requests as they come, until stopped")
    g.add_argument("--once", action="store_true", help="take one request, if one is waiting, and stop")
    g.add_argument("--approve", type=int, metavar="ID", help="ship a request parked at review, as it was baked")
    g.add_argument("--reject", type=int, metavar="ID", help="mark a request at review failed (--why says why)")
    g.add_argument("--requeue", type=int, metavar="ID", help="put a request back in the queue, to bake again")
    g.add_argument("--at-logon", action="store_true", help="register a scheduled task that starts --watch at sign-in")
    ap.add_argument("--poll", type=int, default=60, help="seconds between looks at an empty queue (default 60)")
    ap.add_argument("--why", default="rejected at review", help="--reject: the reason, kept with the request")
    args = ap.parse_args()
    if args.at_logon:
        return at_logon()

    key = setting("BAKE_KEY")
    if not key:
        raise SystemExit("BAKE_KEY is not set: the Worker's secret (npx wrangler secret put BAKE_KEY), the same value here (setx BAKE_KEY ...)")
    agent = re.sub(r"[^A-Za-z0-9._-]", "-", setting("AGENT_NAME") or socket.gethostname())[:40]
    api = Api(setting("GROUNDWIND_API", DEFAULT_API), key, agent)
    try:
        if args.watch or args.once:
            with Lock():
                return watch(api, max(5, args.poll), args.once)
        if args.requeue:
            api.post(args.requeue, "queued")
            log(f"#{args.requeue} back in the queue")
            return 0
        st = api.status(args.approve or args.reject)
        if st.get("stage") != "review" or not st.get("area_id"):
            raise SystemExit(f"request {st.get('id')} is at {st.get('stage')}, not review")
        if args.reject:
            api.post(args.reject, "failed", error=args.why)
            log(f"#{args.reject} rejected: {args.why}")
            return 0
        ship(args.approve, st["area_id"], api, progress=False)
        log(f"#{args.approve} approved and shipped as {st['area_id']}")
        return 0
    except KeyboardInterrupt:
        log("stopped (a request being baked is taken up again at the next start)")
        return 130


if __name__ == "__main__":
    sys.exit(main())
