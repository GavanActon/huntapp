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
  const sample = s.cellSampler(ms)
  const out = []
  for (const p of sits) {
    const g = m.groundWind(p.lon, p.lat, ms)
    const r = s.simulatePlume(p.lon, p.lat, ms, height, sample)
    out.push(r ? { name: p.name, grid: Array.from(r.grid), sigma: g ? g.sigmaDeg : null, kmh: g ? g.kmh : null, from: g ? g.dirFrom : null } : { name: p.name, grid: null })
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
        subprocess.run("npm ci --no-audit --no-fund", cwd=app, shell=True, check=True)
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
            air = {"kmh": float(f["ambientKph"]), "dir": float(f["directions"][0]), "lay": lay, "sunElev": sun}
            sits, missing = [], []
            for pid, p in pts:
                src = next((s for s in P.values() if s["source"]["name"].startswith(p["source"])), None)
                if src is None:
                    missing.append(pid)
                    continue
                lon, lat = tr.transform(x0 + src["source"]["x"], y0 + src["source"]["y"])
                sits.append(dict(pid=pid, lat=lat, lon=lon, h=p["h"], situation=p["situation"], palm=src["reach_by_sector"]))
            jobs.append(dict(run=run, box=box, area=b["area"], held=b["held_out"], stab=stab, air=air, sits=sits, missing=missing))
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
    args = ap.parse_args()
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
        st = prepare(args.ref, args.patch)
        server, url = serve(), f"http://localhost:{PORT}/"
    print(f"testset v{ts['version']}, commit {st['commit']}{' + ' + ', '.join(st['patches']) if st['patches'] else ''}"
          f"{' DIRTY (' + str(len(st['dirty'])) + ' files in app/src)' if st['dirty'] else ''}; "
          f"{len(jobs)} runs, pending: {', '.join(pending) or 'none'}", flush=True)
    for j in jobs:
        if j["missing"]:
            print(f"  {j['run']}: no source for {', '.join(j['missing'])} (left out)")
    try:
        results = score(jobs, variants, url, band, trace, reach)
    finally:
        if server:
            server.kill()
    summary(results, variants, st, pending, ts, args)
    return 0


# Since 6ed949f ("HD you install") a dev server treats HD as not installed (grade.ts HD_DEFAULT =
# !DEV_BUILD) and runs on the SD files; an explicit true per area in huntapp-hd wins, before the page loads.
# The card scores the HD app: scores before the pin on 6ed949f or later ran SD and do not compare.
HD_PIN_JS = ("try { localStorage.setItem('huntapp-hd', JSON.stringify(%s)) } catch (e) {}"
             % json.dumps({json.loads(p.read_text(encoding="utf-8"))["id"]: True for p in (APP / "src" / "areas").glob("*.json")}))


def score(jobs, variants, url, band, trace, reach) -> list[dict]:
    results = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
        for area in dict.fromkeys(j["area"] for j in jobs):
            when = datetime.fromisoformat(f"{DAY}T13:00").replace(tzinfo=TZ)
            ctx = browser.new_context(ignore_https_errors=True, viewport={"width": 430, "height": 900})
            ctx.add_init_script(HD_PIN_JS)
            page = ctx.new_page()
            page.set_default_timeout(240000)
            page.route("**/api.open-meteo.com/**", lambda route, request: fulfil(route, request, when.date()))
            page.route("**/ensemble-api.open-meteo.com/**", lambda route, request: route.abort())
            page.clock.install(time=when - timedelta(minutes=5))
            page.goto(f"{url}?area={area}", wait_until="load", timeout=240000)
            try:
                page.clock.resume()
            except Exception:
                pass
            sd = page.evaluate("async () => { try { return (await import('/src/config.ts')).SD_PREVIEW === true } catch (e) { return false } }")
            if sd:
                raise SystemExit(f"{area}: the app is on the SD files (SD_PREVIEW): the HD pin did not take")
            home = page.evaluate("async () => { const a = await import('/src/areas/index.ts'); return a.ACTIVE_AREA.presets[0] }")
            print(area, "ready:", wait_ready(page, int(when.timestamp() * 1000), home), flush=True)
            page.evaluate(REST_JS)
            for j in (j for j in jobs if j["area"] == area):
                ms = int(datetime.fromisoformat(f"{DAY}T{HOUR[j['stab']]}").replace(tzinfo=TZ).timestamp() * 1000)
                print(f"== {j['run']} ({j['stab']}, PALM 10 m from {j['air']['dir']:.0f} at {j['air']['kmh']:.1f} km/h)", flush=True)
                for vname, v in variants.items():
                    for h in sorted({s["h"] for s in j["sits"]}):
                        group = [s for s in j["sits"] if s["h"] == h]
                        res = page.evaluate(CONE_JS, {"sits": [{"name": s["pid"], "lat": s["lat"], "lon": s["lon"]} for s in group], "ms": ms,
                                                      "height": h, "air": j["air"], "floor": v.get("floor"), "tune": v.get("tune"), "thermal": v.get("thermal"),
                                                      "spread": v.get("spread"), "lee": v.get("lee"), "slot": v.get("slot")})
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
                            results.append(dict(run=j["run"], box=j["box"], held=j["held"], stab=j["stab"], variant=vname, pid=s["pid"],
                                                situation=s["situation"], sectors=sect, marks=marks, app=rs, palm=s["palm"],
                                                sigma=r["sigma"], kmh=r["kmh"], frm=r["from"]))
                            sig = f"{r['sigma']:.0f}" if r["sigma"] is not None else "-"
                            print(f"  {vname:8s} {s['pid']:3s} {' '.join(marks)}  sigma {sig} {r['kmh'] or 0:.1f} km/h from {r['from'] or 0:.0f}", flush=True)
            ctx.close()
        browser.close()
    return results


def summary(results, variants, st, pending, ts, args) -> None:
    """Tune set and held out, per situation, the misses by name; saved unless --no-save."""
    lines = []
    for vname in variants:
        rr = [r for r in results if r["variant"] == vname]
        for held in (False, True):
            h, m, f, t = threat([x for r in rr if r["held"] == held for x in r["marks"]])
            lines.append(f"{vname:10s} {'held out' if held else 'tune set':9s} threat {t:.2f}  hits {h:3d} misses {m:3d} false alarms {f:3d}")
        by_sit = {}
        for r in rr:
            by_sit.setdefault(r["situation"], []).extend(r["marks"])
        lines.append(f"{vname:10s} by situation: " + "; ".join(f"{k} {threat(v)[3]:.2f}" for k, v in sorted(by_sit.items())))
        miss = [f"{r['pid']} {r['run'].split('_', 1)[1]} {s}" for r in rr for s, mk in zip(r["sectors"], r["marks"]) if mk == "M"]
        lines.append(f"{vname:10s} misses: " + (", ".join(miss) or "none"))
    print()
    print("\n".join(lines))

    if args.no_save or not results:
        return
    tag = f"{time.strftime('%Y-%m-%d_%H%M')}_{st['commit']}{'-dirty' if st['dirty'] else ''}{'-patched' if st['patches'] else ''}_{args.label}"
    out = SCORES / f"{tag}.json"
    out.write_text(json.dumps(dict(testset=ts["version"], stamp=st, variants=variants, pending=pending, results=results), indent=1), encoding="utf-8")
    new = not HISTORY.exists()
    with open(HISTORY, "a", encoding="utf-8") as fh:
        if new:
            fh.write("# Scent scorecard history\n\nWritten by scorecard.py (docs/SCENT-TESTSET.md). A dirty score ran on a working tree "
                     "with uncommitted app/src changes, so it is not a baseline.\n\n"
                     "| when | commit | label | variant | tune set | held out | misses | false alarms | pending |\n|---|---|---|---|---|---|---|---|---|\n")
        for vname in variants:
            rr = [r for r in results if r["variant"] == vname]
            ht, mt, ft, tt = threat([x for r in rr if not r["held"] for x in r["marks"]])
            hh, mh, fh_, th = threat([x for r in rr if r["held"] for x in r["marks"]])
            ref = st['commit'] + (' dirty' if st['dirty'] else '') + ''.join(f' + {p}' for p in st['patches'])
            fh.write(f"| {time.strftime('%Y-%m-%d %H:%M')} | {ref} | {args.label} | {vname} | "
                     f"{tt:.2f} | {th:.2f} | {mt + mh} | {ft + fh_} | {len(pending)} |\n")
    print(f"\n-> {out}\n-> {HISTORY}")


if __name__ == "__main__":
    sys.exit(main())
