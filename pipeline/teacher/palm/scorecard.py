"""The scent test set's scorecard (docs/SCENT-TESTSET.md): the app's cone at every test point under each
finished PALM run's own air, against PALM's how-often bands, in one measure. Every rule change to the
cone or the ground wind is scored here before it ships. Promoted 2026-10-15 from huntapp-ba's trial card.

    py -3.14 pipeline/teacher/palm/scorecard.py --label baseline                       # main's HEAD, clean
    py -3.14 pipeline/teacher/palm/scorecard.py --label swing --patch swing.diff        # a candidate on HEAD
    py -3.14 pipeline/teacher/palm/scorecard.py --label t --variants '{"base": {}, "m5": {"tune": {"meander": 0.5}}}'
    py -3.14 pipeline/teacher/palm/scorecard.py --tree --url http://localhost:5195/ --no-save   # quick, dirty

It scores commits, not the shared working tree (other sessions edit that mid-change): --ref (default
HEAD) is checked out in a scoring worktree, C:/dev/huntapp-score, with its own node_modules (npm ci when
package-lock.json changes) and its own quiet dev server on port 5251, which reads the main checkout's
public/ data. A candidate is a diff of its own files (git diff -- <files> > x.diff) applied on top with
--patch, so nothing needs committing to be scored. --tree scores the working tree behind --url instead,
marked dirty: fine for a quick look, never a baseline.

The points, the runs and the measure come from testset.json. For each run the app's air is forced
(model.ts setForcedAir) to PALM's 10 m ambient wind and direction from fields/<run>.npz, layered by the
run's stability (palm_compare.py AIR), with the clock held on 2026-09-30 at 13:00 (neutral), 12:00
(convective) or 19:30 (stable). A variant is {floor, thermal, spread, lee, slot, tune}: model.ts's
set<Name>Tune for each (skipped where a ref lacks it) and scentTune knobs, all reset after each call.
knobs.json (huntapp-ba) lists every knob with its default, bounds and variant key, for sweeps.

--grid sd scores the national SD tile at the same points instead of the area's own grid (Gavan,
2026-10-16: accuracy, "but scalable"): the app opens with ?tiles=force (windTiles.ts, dev builds), the
map goes to each box and the 2 x 2 tiles round it stand in for the area's grid, read from R2 through the
page's routes. The area's sun, lakes and clock stay, so HD against SD is the grid alone: LiDAR and FRI
against SCANFI and land cover, WindNinja against the net. --grid both scores the two, SD's variants
named "<variant> SD". A box whose tile isn't on R2 yet is left out of SD, never scored on plain wind.

Writes pipeline/raw/teacher/palm/scores/<when>_<commit>[-dirty]_<label>.json (every sector of every
cell) and adds the summary to pipeline/teacher/palm/SCORES.md.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import subprocess
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
from pyproj import Transformer

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
APP = ROOT / "app"
FIELDS = ROOT / "pipeline" / "raw" / "teacher" / "palm" / "fields"
SCORES = ROOT / "pipeline" / "raw" / "teacher" / "palm" / "scores"
HISTORY = HERE / "SCORES.md"
sys.path.insert(0, str(APP / "scripts"))
from replay import REST_JS, TZ, fulfil, wait_ready  # noqa: E402
from cone_export import reach_by_sector  # noqa: E402
from palm_compare import AIR  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

HOUR = {"neutral": "13:00", "convective": "12:00", "stable": "19:30"}
DAY = "2026-09-30"

CONE_JS = """
async ({ sits, ms, height, air, floor, tune, thermal, spread, lee, slot }) => {
  const s = await import('/src/weather/micro/scent.ts')
  const m = await import('/src/weather/micro/model.ts')
  const st = await import('/src/weather/micro/scentTune.ts')
  const S = st.useScentTune.getState()
  S.reset()
  for (const [k, v] of Object.entries(tune || {})) S.set(k, v)
  if (m.setFloorTune) m.setFloorTune(floor || null)
  if (m.setThermalTune) m.setThermalTune(thermal || null)
  if (m.setSpreadTune) m.setSpreadTune(spread || null)
  if (m.setLeeTune) m.setLeeTune(lee || null)
  if (m.setSlotTune) m.setSlotTune(slot || null)
  m.setForcedAir(air)
  await m.microReadyFor(ms, 20000)
  // every momentum direction and the going grid before a sit is scored (2026-10-17): microReadyFor loads the two
  // directions of the hour's FORECAST wind, not the forced one, so momentumAt asked for its own and the lids stood in
  // until they landed; and the relief (the lee's riseUpwind, the water under the lee) only comes with the rest. What was
  // in at sampling time varied with the main thread's speed, so the HD rows moved run to run and a behaviour-neutral
  // commit moved them too (found by Optimus)
  await Promise.race([m.loadRestOfMicro(), new Promise((r) => setTimeout(r, 60000))])
  // loadRestOfMicro resolves at once when a prior call started it (restDone), so the rest can still be on its way:
  // the going grid and the habitat are awaited by name, and the first sit is read until two reads 1 s apart agree
  const waits = { going: false, habitat: false, settled: 0 }
  try {
    const gg = await import('/src/routes/goingGrid.ts')
    await Promise.race([gg.loadGoing(), new Promise((r) => setTimeout(r, 30000))])
    waits.going = !!gg.going()
  } catch (e) { console.warn('going grid not awaited', e) }
  try {
    const hg = await import('/src/spots/habitatGrid.ts')
    await Promise.race([hg.loadHabitat(), new Promise((r) => setTimeout(r, 30000))])
    waits.habitat = !!hg.habitat()
  } catch (e) { console.warn('habitat not awaited', e) }
  const p0 = sits[0]
  if (p0) {
    const key = () => { const g = m.groundWind(p0.lon, p0.lat, ms); return g ? `${g.dirFrom.toFixed(1)}|${g.kmh.toFixed(3)}|${g.sigmaDeg.toFixed(2)}` : 'none' }
    let last = key()
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 1000))
      const now = key()
      waits.settled = i + 1
      if (now === last) break
      last = now
    }
  }
  const sample = s.cellSampler(ms)
  const out = []
  const rl = await import('/src/weather/micro/relief.ts')
  const gg = await import('/src/routes/goingGrid.ts')
  const mic = (p) => {
    let o = null
    try { o = window.__micro ? window.__micro(p.lon, p.lat, air.dir, ms) : {} } catch (e) { o = { err: String(e) } }
    try { o = { ...(o || {}), going: !!gg.going(), water: rl.waterAt(p.lon, p.lat), relief: !!rl.reliefNear(p.lon, p.lat, 1, 1) } } catch (e) { o = { ...(o || {}), reliefErr: String(e) } }
    return o
  }
  for (const p of sits) {
    const g = m.groundWind(p.lon, p.lat, ms)
    p.micro = mic(p)
    const r = s.simulatePlume(p.lon, p.lat, ms, height, sample)
    out.push(r ? { name: p.name, grid: Array.from(r.grid), tongue: r.tongue ? Array.from(r.tongue) : null, sigma: g ? g.sigmaDeg : null, kmh: g ? g.kmh : null, from: g ? g.dirFrom : null, waits, micro: p.micro } : { name: p.name, grid: null, waits, micro: p.micro })
  }
  m.setForcedAir(null)
  if (m.setFloorTune) m.setFloorTune(null)
  if (m.setThermalTune) m.setThermalTune(null)
  if (m.setSpreadTune) m.setSpreadTune(null)
  if (m.setLeeTune) m.setLeeTune(null)
  if (m.setSlotTune) m.setSlotTune(null)
  S.reset()
  return out
}
"""


def mark(palm: dict, app: dict, band: str, trace: str, reach: float) -> str:
    """H hit, M miss, F false alarm, . neither, for one sector."""
    ps, pt, a = palm[band] >= reach, palm[trace] >= reach, app[band] >= reach
    return "H" if ps and a else "M" if ps else "F" if a and not pt else "."


def threat(marks: list[str]) -> tuple[int, int, int, float]:
    h, m, f = marks.count("H"), marks.count("M"), marks.count("F")
    return h, m, f, h / max(1, h + m + f)


def mark2(palm: dict, grid: dict, tongue: dict, band: str, trace: str, reach: float) -> str:
    """Measure v2 (Gavan's option 3: the tongue is drawn as scent, the pale shade round it as doubt):
    T the tongue covers PALM's scent, S only the shade does, M neither (a miss), F the tongue claims
    scent where PALM has not even a trace (a false alarm), . neither."""
    ps, pt = palm[band] >= reach, palm[trace] >= reach
    g, t = grid[band] >= reach, tongue[band] >= reach
    if ps:
        return "T" if t else "S" if g else "M"
    return "F" if t and not pt else "."


def threat2(marks: list[str]) -> tuple[int, int, int, int, float]:
    """Tongue hits, shade-only, misses, false alarms, and the tongue's threat score: T / (T + S + M + F)."""
    t, s, m, f = marks.count("T"), marks.count("S"), marks.count("M"), marks.count("F")
    return t, s, m, f, t / max(1, t + s + m + f)


WT = Path("C:/dev/huntapp-score")   # the scoring worktree: outside the repo, its own node_modules, no links
PORT = 5251


def git(*a, cwd=ROOT, check=False) -> str:
    p = subprocess.run(["git", *a], cwd=cwd, capture_output=True, text=True)
    if check and p.returncode:
        raise SystemExit(f"git {' '.join(a)}: {p.stderr.strip()}")
    return p.stdout.strip()


def stamp_tree() -> dict:
    dirty = [ln[3:] for ln in git("status", "--porcelain", "--", "app/src").splitlines() if ln.strip()]
    return dict(commit=git("rev-parse", "--short", "HEAD"), dirty=dirty, patches=[])


LOCK = SCORES / "worktree.lock"


def pid_alive(pid: int) -> bool:
    """Windows: the process is there and has not exited (never os.kill(pid, 0): on Windows that kills it)."""
    import ctypes

    h = ctypes.windll.kernel32.OpenProcess(0x1000, False, pid)  # PROCESS_QUERY_LIMITED_INFORMATION
    if not h:
        return False
    code = ctypes.c_ulong()
    ok = ctypes.windll.kernel32.GetExitCodeProcess(h, ctypes.byref(code))
    ctypes.windll.kernel32.CloseHandle(h)
    return bool(ok) and code.value == 259  # STILL_ACTIVE


def take_worktree(wait_min: float = 240.0) -> None:
    """One scorecard at a time in the scoring worktree and on its port (2026-10-16: c4's SD trial and ba's
    chain shared both): a second run waits for the first, and a lock left by a dead run is taken over."""
    import os

    SCORES.mkdir(parents=True, exist_ok=True)
    t0, said = time.time(), False
    while True:
        try:
            fd = os.open(LOCK, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(fd, f"{os.getpid()} {time.strftime('%Y-%m-%d %H:%M')} {' '.join(sys.argv[1:])[:300]}".encode("utf-8"))
            os.close(fd)
            return
        except FileExistsError:
            held = LOCK.read_text(encoding="utf-8", errors="replace").split(maxsplit=3)
            pid = int(held[0]) if held and held[0].isdigit() else 0
            if not pid_alive(pid):
                LOCK.unlink(missing_ok=True)
                continue
            if time.time() - t0 > wait_min * 60:
                raise SystemExit(f"the scoring worktree is still busy after {wait_min:.0f} min: {' '.join(held)}")
            if not said:
                print(f"waiting for the scoring worktree: {' '.join(held)}", flush=True)
                said = True
            time.sleep(30)


def free_worktree() -> None:
    import os

    try:
        if LOCK.read_text(encoding="utf-8", errors="replace").split(maxsplit=1)[0] == str(os.getpid()):
            LOCK.unlink()
    except (OSError, IndexError):
        pass


def prepare(ref: str, patches: list[str]) -> dict:
    """The scoring worktree at ref (+ patches), node_modules current, a score config reading the main public/."""
    sha = git("rev-parse", "--verify", f"{ref}^{{commit}}", check=True)
    if not (WT / ".git").exists():
        git("worktree", "add", "--detach", str(WT), sha, check=True)
    else:
        git("reset", "--hard", "-q", cwd=WT)
        git("clean", "-fdq", "-e", "node_modules", "-e", "vite.score.config.ts", cwd=WT)
        git("checkout", "--detach", "-q", "--force", sha, cwd=WT, check=True)
    marks = []
    for pf in patches:
        pf = Path(pf).resolve()
        p = subprocess.run(["git", "apply", "--whitespace=nowarn", str(pf)], cwd=WT, capture_output=True, text=True)
        if p.returncode:
            raise SystemExit(f"--patch {pf.name} does not apply on {sha[:7]}: {p.stderr.strip()}")
        marks.append(f"{pf.name}@{hashlib.sha1(pf.read_bytes()).hexdigest()[:7]}")
    app = WT / "app"
    lock = (app / "package-lock.json").read_bytes()
    stamp_file = app / "node_modules" / ".score-lock"
    h = hashlib.sha1(lock).hexdigest()
    if not stamp_file.exists() or stamp_file.read_text() != h:
        print("npm ci in the scoring worktree ...", flush=True)
        # the card just finished on this tree may still hold a native binary for a few seconds after its server is
        # killed (2026-10-17 07:11: EPERM unlinking rolldown's .node, and the next card ran on a half-installed tree)
        for attempt in range(5):
            p = subprocess.run("npm ci --no-audit --no-fund", cwd=app, shell=True)
            if p.returncode == 0:
                break
            if attempt == 4:
                raise SystemExit(f"npm ci failed {attempt + 1} times in the scoring worktree (exit {p.returncode})")
            print(f"  npm ci failed (exit {p.returncode}); again in 20 s", flush=True)
            time.sleep(20)
        stamp_file.write_text(h)
    pub = (APP / "public").as_posix()
    (app / "vite.score.config.ts").write_text(
        "// scorecard.py's server: the quiet config, the main checkout's public/ data (never linked)\n"
        "import { mergeConfig } from 'vite'\nimport quiet from './vite.quiet.config.ts'\n"
        f"export default mergeConfig(quiet, {{ publicDir: '{pub}', server: {{ fs: {{ allow: ['{WT.as_posix()}', '{pub}'] }} }} }})\n",
        encoding="utf-8")
    return dict(commit=sha[:7], dirty=[], patches=marks)


def serve() -> subprocess.Popen:
    import urllib.request
    app = WT / "app"
    log = open(SCORES / "server.log", "w", encoding="utf-8")
    proc = subprocess.Popen(["node", "node_modules/vite/bin/vite.js", "--config", "vite.score.config.ts", "--port", str(PORT), "--strictPort"],
                            cwd=app, stdout=log, stderr=subprocess.STDOUT)
    for _ in range(90):
        time.sleep(1)
        if proc.poll() is not None:
            raise SystemExit(f"the scoring server stopped: see {SCORES / 'server.log'}")
        try:
            urllib.request.urlopen(f"http://localhost:{PORT}/", timeout=3)
            return proc
        except OSError:
            continue
    proc.kill()
    raise SystemExit("the scoring server did not answer in 90 s")


def jobs_from(ts: dict, only: str | None) -> tuple[list[dict], list[str]]:
    jobs, pending = [], []
    for box, b in ts["boxes"].items():
        pts = [(pid, p) for pid, p in ts["points"].items() if p["box"] == box]
        for run in b["runs"]:
            if only and only not in run:
                continue
            bj, fz = FIELDS / f"{run}_scent.json", FIELDS / f"{run}.npz"
            if not bj.exists() or not fz.exists():
                pending.append(run)
                continue
            P = json.loads(bj.read_text(encoding="utf-8"))["sources"]
            f = np.load(fz, allow_pickle=True)
            meta = json.loads(str(f["meta"]))
            tr = Transformer.from_crs(meta["epsg"], 4326, always_xy=True)
            x0, y0 = meta["bounds"][0], meta["bounds"][1]
            stab = meta.get("stability", "neutral")
            lay, sun = AIR[stab]
            # v4 (2026-10-16): the app is forced with the forecast 10 m of the hour the run stands for, as it is in
            # use (testset.json "forcing"); PALM's own 10 m ambient sits in or near a 12-15 m canopy and reads about
            # half that, so thresholds tuned on it came out ~2x strict. A run without an entry falls back to it.
            fc = (ts.get("forcing") or {}).get(run)
            if fc:
                # the run's own 80 m wind over the settled layer (forcing_table kph80), as palm_compare sets it: under
                # forced air makeCtx keeps the held clock's real lay, so a rule keyed to w80 (ba's ref 3 fade) would
                # otherwise read 2026-09-30's camp forecast; neutral for every other rule (2026-10-18)
                if fc.get("kph80") is not None:
                    lay = {**lay, "w80": float(fc["kph80"])}
                air = {"kmh": float(fc["kph"]), "dir": float(fc["from"]), "lay": lay, "sunElev": sun}
                forcing = f"forecast ({fc.get('source', '?')})"
            else:
                air = {"kmh": float(f["ambientKph"]), "dir": float(f["directions"][0]), "lay": lay, "sunElev": sun}
                forcing = "PALM ambient"
            sits, missing = [], []
            for pid, p in pts:
                src = next((s for s in P.values() if s["source"]["name"].startswith(p["source"])), None)
                if src is None:
                    missing.append(pid)
                    continue
                lon, lat = tr.transform(x0 + src["source"]["x"], y0 + src["source"]["y"])
                sits.append(dict(pid=pid, lat=lat, lon=lon, h=p["h"], situation=p["situation"], palm=src["reach_by_sector"]))
            jobs.append(dict(run=run, box=box, area=b["area"], held=b["held_out"], stab=stab, air=air, sits=sits, missing=missing,
                             forcing=forcing, ambient=float(f["ambientKph"])))
    return jobs, pending


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--label", default="score", help="a word for this score (baseline, swing, ...)")
    ap.add_argument("--variants", default='{"base": {}}', help='JSON {name: {floor, thermal, tune}}')
    ap.add_argument("--ref", default="HEAD", help="the commit to score, in the scoring worktree")
    ap.add_argument("--patch", action="append", default=[], help="a diff applied on top of --ref (a candidate); repeatable")
    ap.add_argument("--tree", action="store_true", help="score the shared working tree behind --url instead (dirty)")
    ap.add_argument("--url", default="http://localhost:5195/", help="with --tree: the quiet dev server")
    ap.add_argument("--only", help="score only runs whose name contains this")
    ap.add_argument("--testset", default=str(HERE / "testset.json"))
    ap.add_argument("--no-save", action="store_true", help="print only: no scores/ file, no SCORES.md line")
    ap.add_argument("--grid", choices=["hd", "sd", "both"], default="hd",
                    help="hd: the area's own grid (the card as it was); sd: the national SD tiles at the same points; both")
    ap.add_argument("--sd-version", default="v1", help="with --grid sd/both: the tiles' version on R2 (v1, or a trial bake such as v2t)")
    args = ap.parse_args()
    global SD_BASE
    SD_BASE = f"https://data.groundwind.app/data/sd/{args.sd_version}/"
    ts = json.loads(Path(args.testset).read_text(encoding="utf-8"))
    ms_ = ts["measure"]
    band, trace, reach = ms_["band"], ms_["trace"], float(ms_["reach_m"])
    variants = json.loads(args.variants)
    jobs, pending = jobs_from(ts, args.only)
    SCORES.mkdir(parents=True, exist_ok=True)
    server = None
    if args.tree:
        st, url = stamp_tree(), args.url
    else:
        take_worktree()
        try:
            st = prepare(args.ref, args.patch)
            server, url = serve(), f"http://localhost:{PORT}/"
        except BaseException:
            free_worktree()
            raise
    print(f"testset v{ts['version']}, commit {st['commit']}{' + ' + ', '.join(st['patches']) if st['patches'] else ''}"
          f"{' DIRTY (' + str(len(st['dirty'])) + ' files in app/src)' if st['dirty'] else ''}; "
          f"{len(jobs)} runs, pending: {', '.join(pending) or 'none'}", flush=True)
    for j in jobs:
        if j["missing"]:
            print(f"  {j['run']}: no source for {', '.join(j['missing'])} (left out)")
    try:
        results = score(jobs, variants, url, band, trace, reach, ["hd", "sd"] if args.grid == "both" else [args.grid])
    finally:
        if server:
            server.kill()
        if not args.tree:
            free_worktree()
    summary(results, variants, st, pending, ts, args)
    return 0


# Since 6ed949f ("HD you install") a dev server treats HD as not installed (grade.ts HD_DEFAULT =
# !DEV_BUILD) and runs on the SD files; an explicit true per area in huntapp-hd wins, before the page loads.
# The card scores the HD app: scores before the pin on 6ed949f or later ran SD and do not compare.
HD_PIN_JS = ("try { localStorage.setItem('huntapp-hd', JSON.stringify(%s)) } catch (e) {}"
             % json.dumps({json.loads(p.read_text(encoding="utf-8"))["id"]: True for p in (APP / "src" / "areas").glob("*.json")}))


SD_BASE = "https://data.groundwind.app/data/sd/v1/"  # --sd-version swaps the version (a trial bake, e.g. v2t)
# the map to a box and the national tiles' 2 x 2 block round it in the area grid's place (windTiles.ts with
# ?tiles=force): done when the block the app built is the one asked for
TILES_JS = """
async ({ lat, lon, i0, j0 }) => {
  const m = await import('/src/weather/micro/model.ts')
  const map = window.__map
  if (!map) return 'no map (window.__map is a dev hook)'
  map.jumpTo({ center: [lon, lat], zoom: 12 })
  const t0 = Date.now()
  while (Date.now() - t0 < 90000) {
    const b = window.__windTiles && window.__windTiles.block
    if (m.onTiles() && b && b.i0 === i0 && b.j0 === j0) return 'ok'
    await new Promise((r) => setTimeout(r, 250))
  }
  return 'timeout: ' + JSON.stringify(window.__windTiles || null)
}
"""


def sd_index() -> dict:
    import urllib.request

    req = urllib.request.Request(f"{SD_BASE}index.json?t={time.time():.0f}", headers={"User-Agent": "groundwind-scorecard"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())


def sd_block(idx: dict, lat: float, lon: float) -> tuple[int, int, str, bool]:
    """windTiles.ts's block for a view centred here, the tiles R2 lacks in it, and whether all four are there.
    All four, not just the tile under the point: a missing one is stitched in as plain wind and blank cover,
    and Whitefish's first SD score (2026-10-16, one tile of four) lost nearly every cone that way."""
    L = idx["lattice"]
    fx = (lon - L["lon0"]) / (L["cols"] * L["dLon"])
    fy = (L["lat0"] - lat) / (L["rows"] * L["dLat"])
    i0, j0 = round(fx) - 1, round(fy) - 1
    lack = [f"t-{i0 + di}-{j0 + dj}" for dj in (0, 1) for di in (0, 1) if f"t-{i0 + di}-{j0 + dj}" not in idx["tiles"]]
    return i0, j0, ", ".join(lack) or "-", not lack


def box_point(box: str) -> tuple[float, float]:
    c = json.loads((HERE / box / "case-4m.json").read_text(encoding="utf-8"))
    return tuple(c["point_latlon"])


SD_FETCHED: dict[str, int] = {}   # tile id -> the last status R2 gave this card for it (the page caches a failed tile as blank)


def sd_route(route, request) -> None:
    """The app's sd/v1/ requests on the scoring server, answered from R2 (the tiles are not in public/)."""
    tail = request.url.split("/sd/v1/", 1)[1]
    try:
        resp = route.fetch(url=SD_BASE + tail)
    except Exception as e:  # noqa: BLE001  a failed fetch is a blank tile for the page's life (windTiles fetchTile caches null)
        if tail.startswith("t-"):
            SD_FETCHED[tail.split(".", 1)[0]] = -1
        print(f"  sd tile fetch failed: {tail}: {e}", flush=True)
        route.abort()
        return
    if tail.startswith("t-"):
        SD_FETCHED[tail.split(".", 1)[0]] = resp.status
    route.fulfill(response=resp)


def sd_block_tiles(idx: dict, i0: int, j0: int) -> list[str]:
    """The 2 x 2 block's tile ids (the ones the index has)."""
    sys.path.insert(0, str(ROOT / "pipeline"))
    import tiles as lattice  # noqa: E402  (the national lattice, as wind_tiles.py imports it)
    out = []
    for dj in (0, 1):
        for di in (0, 1):
            tid = lattice.tile_id(i0 + di, j0 + dj)
            if tid in idx["tiles"]:
                out.append(tid)
    return out


def score(jobs, variants, url, band, trace, reach, grids=("hd",)) -> list[dict]:
    results = []
    idx = sd_index() if "sd" in grids else None
    with sync_playwright() as p:
        launch = lambda: p.chromium.launch(headless=True, args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])  # noqa: E731
        browser, browser_grid = launch(), grids[0]
        for grid, area in ((g, a) for g in grids for a in dict.fromkeys(j["area"] for j in jobs)):
            sd = grid == "sd"
            if grid != browser_grid:
                # each grid in its own browser (2026-10-17): the SD pass after the HD pass in one browser read two
                # Whitefish sits differently from an SD-only card (19 misses against 17), and nothing inside a card did
                browser.close()
                browser, browser_grid = launch(), grid
            when = datetime.fromisoformat(f"{DAY}T13:00").replace(tzinfo=TZ)
            ctx = browser.new_context(ignore_https_errors=True, viewport={"width": 430, "height": 900})
            ctx.add_init_script(HD_PIN_JS)
            page = ctx.new_page()
            page.set_default_timeout(240000)
            page.route("**/api.open-meteo.com/**", lambda route, request: fulfil(route, request, when.date()))
            page.route("**/ensemble-api.open-meteo.com/**", lambda route, request: route.abort())
            if sd:
                page.route("**/sd/v1/**", sd_route)
            page.clock.install(time=when - timedelta(minutes=5))
            page.goto(f"{url}?area={area}{'&tiles=force' if sd else ''}", wait_until="load", timeout=240000)
            try:
                page.clock.resume()
            except Exception:
                pass
            preview = page.evaluate("async () => { try { return (await import('/src/config.ts')).SD_PREVIEW === true } catch (e) { return false } }")
            if preview:
                raise SystemExit(f"{area}: the app is on the SD files (SD_PREVIEW): the HD pin did not take")
            home = page.evaluate("async () => { const a = await import('/src/areas/index.ts'); return a.ACTIVE_AREA.presets[0] }")
            print(f"{area}{' (SD tiles)' if sd else ''}", "ready:", wait_ready(page, int(when.timestamp() * 1000), home), flush=True)
            page.evaluate(REST_JS)
            for j in (j for j in jobs if j["area"] == area):
                if sd:
                    lat, lon = box_point(j["box"])
                    i0, j0, tid, have = sd_block(idx, lat, lon)
                    if not have:
                        print(f"== {j['run']}: SD tiles not on R2 yet round {j['box']} ({tid}): left out of SD", flush=True)
                        continue
                    # the area grid's late loads land before the mosaic is adopted (2026-10-17): REST_JS races
                    # loadRestOfMicro against 30 s, and the mosaic (useMosaic) waits for loadMicro only, so the area's
                    # remaining directions could land in the block's place after the jump; here they are awaited uncapped
                    page.evaluate("""async () => {
  const m = await import('/src/weather/micro/model.ts')
  await m.microBaseReady()
  await m.loadRestOfMicro()
  const gg = await import('/src/routes/goingGrid.ts')
  await gg.loadGoing()
  const hg = await import('/src/spots/habitatGrid.ts')
  await hg.loadHabitat()
}""")
                    got = page.evaluate(TILES_JS, {"lat": lat, "lon": lon, "i0": i0, "j0": j0})
                    if got != "ok":
                        print(f"== {j['run']}: the SD tiles did not come in ({got}): left out of SD", flush=True)
                        continue
                    # every tile of the block fetched OK: a failed one is blank for the page's life (windTiles fetchTile
                    # caches null), which read two Whitefish sits differently card to card (2026-10-17); a reload clears it
                    try:
                        want = sd_block_tiles(idx, i0, j0)
                    except Exception as e:  # noqa: BLE001
                        want = []
                        print(f"  (block tiles not listed: {e})", flush=True)
                    bad = [t for t in want if SD_FETCHED.get(t, 0) != 200]
                    tries = 0
                    while bad and tries < 3:
                        tries += 1
                        print(f"  SD block {i0}/{j0}: {', '.join(f'{t}={SD_FETCHED.get(t, 'not asked')}' for t in bad)}: reloading the page ({tries})", flush=True)
                        page.reload(wait_until="load")
                        wait_ready(page, int(when.timestamp() * 1000), home)
                        page.evaluate(REST_JS)
                        got = page.evaluate(TILES_JS, {"lat": lat, "lon": lon, "i0": i0, "j0": j0})
                        bad = [t for t in want if SD_FETCHED.get(t, 0) != 200] if got == "ok" else want
                    if bad:
                        print(f"== {j['run']}: SD block tiles still missing ({', '.join(bad)}): left out of SD", flush=True)
                        continue
                    state = page.evaluate("() => ({ block: window.__windTiles && window.__windTiles.block, c: window.__map ? window.__map.getCenter() : null, z: window.__map ? window.__map.getZoom() : null })")
                    print(f"  SD block {i0}/{j0}: {len(want)} tiles fetched 200; the page's block {state.get('block')} at centre {state.get('c')} z {state.get('z')}", flush=True)
                ms = int(datetime.fromisoformat(f"{DAY}T{HOUR[j['stab']]}").replace(tzinfo=TZ).timestamp() * 1000)
                print(f"== {j['run']}{' SD' if sd else ''} ({j['stab']}, forced from {j['air']['dir']:.0f} at {j['air']['kmh']:.1f} km/h: {j['forcing']}; "
                      f"PALM's own 10 m {j['ambient']:.1f})", flush=True)
                if sd:
                    page.once("console", lambda msg: None)
                for vname0, v in variants.items():
                    vname = (f"{vname0} SD" + ("" if SD_BASE.endswith("/sd/v1/") else " " + SD_BASE.rstrip("/").rsplit("/", 1)[1])) if sd else vname0
                    for h in sorted({s["h"] for s in j["sits"]}):
                        group = [s for s in j["sits"] if s["h"] == h]
                        res = page.evaluate(CONE_JS, {"sits": [{"name": s["pid"], "lat": s["lat"], "lon": s["lon"]} for s in group], "ms": ms,
                                                      "height": h, "air": j["air"], "floor": v.get("floor"), "tune": v.get("tune"), "thermal": v.get("thermal"),
                                                      "spread": v.get("spread"), "lee": v.get("lee"), "slot": v.get("slot")})
                        if res and res[0].get("waits"):
                            w = res[0]["waits"]
                            print(f"  waits: going {w.get('going')} habitat {w.get('habitat')} settled after {w.get('settled')} s", flush=True)
                        for r in res:
                            s = next(x for x in group if x["pid"] == r["name"])
                            if r["grid"] is None:
                                print(f"  {vname:8s} {s['pid']}: no cone")
                                continue
                            g = np.array(r["grid"], np.float32)
                            n = int(round(math.sqrt(g.size)))
                            rs = reach_by_sector(g.reshape(n, n), 1400.0 / n)
                            sect = sorted(rs, key=int)
                            marks = [mark(s["palm"][k], rs[k], band, trace, reach) for k in sect]
                            # v2: the tongue alone (a ref before e42e181 has none: the whole cone stands for it)
                            if r.get("tongue"):
                                rt = reach_by_sector(np.array(r["tongue"], np.float32).reshape(n, n), 1400.0 / n)
                            else:
                                rt = rs
                            marks2 = [mark2(s["palm"][k], rs[k], rt[k], band, trace, reach) for k in sect]
                            results.append(dict(run=j["run"], box=j["box"], held=j["held"], stab=j["stab"], variant=vname, grid=grid, pid=s["pid"],
                                                situation=s["situation"], sectors=sect, marks=marks, marks2=marks2, app=rs, tongue=rt,
                                                palm=s["palm"], sigma=r["sigma"], kmh=r["kmh"], frm=r["from"], micro=r.get("micro")))
                            sig = f"{r['sigma']:.0f}" if r["sigma"] is not None else "-"
                            mic = r.get("micro")
                            micro = ""
                            if isinstance(mic, dict):
                                at = mic.get("at") or {}
                                micro = (f"  [micro: file {mic.get('file')} areaGrid {mic.get('areaGrid')} mom {sum(1 for x in mic.get('momIn') or [] if x)}/16 "
                                         f"turb {sum(1 for x in mic.get('momTIn') or [] if x)}/16 at k{at.get('k0')}/{at.get('k1')} mom {at.get('mom')} turb {at.get('turb')} stand {at.get('stand')}"
                                         f" | going {mic.get('going')} water {mic.get('water')} relief {mic.get('relief')}{(' ' + mic['reliefErr']) if mic.get('reliefErr') else ''}"
                                         + (f" | rise {at.get('leeRiseCached')} call " + json.dumps({k: (round(v, 3) if isinstance(v, float) else v) for k, v in (mic.get('call') or {}).items() if k not in ('parts', 'reasons')})[:400] if mic.get('call') else "") + "]")
                            elif mic:
                                micro = f"  [micro: {str(mic)[:80]}]"
                            print(f"  {vname:8s} {s['pid']:3s} {' '.join(marks2)}  (v1 {''.join(marks)})  sigma {sig} {r['kmh'] or 0:.1f} km/h from {r['from'] or 0:.0f}{micro}", flush=True)
            ctx.close()
        browser.close()
    return results


def summary(results, variants, st, pending, ts, args) -> None:
    """Tune set and held out, per situation, the misses by name; saved unless --no-save."""
    lines = []
    variants = list(dict.fromkeys(r["variant"] for r in results)) or list(variants)  # with --grid sd/both: "<variant> SD" too
    sd_left = sorted({j for j in variants if j.endswith(" SD")})
    if sd_left:
        hd_cells = {(r["run"], r["pid"]) for r in results if r.get("grid", "hd") == "hd"}
        sd_cells = {(r["run"], r["pid"]) for r in results if r.get("grid") == "sd"}
        if hd_cells and hd_cells - sd_cells:
            lines.append(f"(SD scores {len(sd_cells)} cells against HD's {len(hd_cells)}: the boxes without an SD tile yet are left out, so compare like with like)")
    for vname in variants:
        rr = [r for r in results if r["variant"] == vname]
        for held in (False, True):
            tt_, ss_, mm_, ff_, t2 = threat2([x for r in rr if r["held"] == held for x in r["marks2"]])
            h, m, f, t = threat([x for r in rr if r["held"] == held for x in r["marks"]])
            lines.append(f"{vname:10s} {'held out' if held else 'tune set':9s} v2 tongue threat {t2:.2f}  tongue {tt_:3d} shade only {ss_:3d} "
                         f"misses {mm_:3d} false alarms (tongue) {ff_:3d}   | v1 threat {t:.2f} (hits {h}, misses {m}, false alarms {f})")
        by_sit = {}
        for r in rr:
            by_sit.setdefault(r["situation"], []).extend(r["marks2"])
        lines.append(f"{vname:10s} by situation (v2): " + "; ".join(f"{k} {threat2(v)[4]:.2f}" for k, v in sorted(by_sit.items())))
        miss = [f"{r['pid']} {r['run'].split('_', 1)[1]} {s}" for r in rr for s, mk in zip(r["sectors"], r["marks2"]) if mk == "M"]
        lines.append(f"{vname:10s} misses: " + (", ".join(miss) or "none"))
    print()
    print("\n".join(lines))

    if args.no_save or not results:
        return
    tag = f"{time.strftime('%Y-%m-%d_%H%M')}_{st['commit']}{'-dirty' if st['dirty'] else ''}{'-patched' if st['patches'] else ''}_{args.label}"
    out = SCORES / f"{tag}.json"
    out.write_text(json.dumps(dict(testset=ts["version"], stamp=st, variants=variants, pending=pending, results=results), indent=1), encoding="utf-8")
    text = HISTORY.read_text(encoding="utf-8") if HISTORY.exists() else ""
    with open(HISTORY, "a", encoding="utf-8") as fh:
        if not text:
            fh.write("# Scent scorecard history\n\nWritten by scorecard.py (docs/SCENT-TESTSET.md). A dirty score ran on a working tree "
                     "with uncommitted app/src changes, so it is not a baseline.\n")
        if "## Measure v2" not in text:
            # from 2026-10-15 every row is v2 (with v1 beside it); the v1 table above stops here
            fh.write("\n## Measure v2 (from 2026-10-15)\n\nThe tongue is drawn as scent, the pale shade round it as doubt (Gavan's option 3). "
                     "Misses count where neither covers PALM's scent; false alarms count the tongue only; the tongue's threat is "
                     "tongue hits / (tongue hits + shade only + misses + false alarms). v1 (the whole cone) is kept beside it.\n\n"
                     "| when | commit | label | variant | tongue threat, tune | tongue threat, held out | misses | false alarms (tongue) | shade only "
                     "| v1 tune / held out | pending |\n|---|---|---|---|---|---|---|---|---|---|---|\n")
        for vname in variants:
            rr = [r for r in results if r["variant"] == vname]
            t2t = threat2([x for r in rr if not r["held"] for x in r["marks2"]])
            t2h = threat2([x for r in rr if r["held"] for x in r["marks2"]])
            v1t = threat([x for r in rr if not r["held"] for x in r["marks"]])[3]
            v1h = threat([x for r in rr if r["held"] for x in r["marks"]])[3]
            ref = st['commit'] + (' dirty' if st['dirty'] else '') + ''.join(f' + {p}' for p in st['patches'])
            fh.write(f"| {time.strftime('%Y-%m-%d %H:%M')} | {ref} | {args.label} | {vname} | {t2t[4]:.2f} | {t2h[4]:.2f} | "
                     f"{t2t[2] + t2h[2]} | {t2t[3] + t2h[3]} | {t2t[1] + t2h[1]} | {v1t:.2f} / {v1h:.2f} | {len(pending)} |\n")
    print(f"\n-> {out}\n-> {HISTORY}")


if __name__ == "__main__":
    sys.exit(main())
