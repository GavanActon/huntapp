"""The momentum solve's progress page (pipeline/build_windcfd.py): status.html
in the kit, rewritten every 30 s from the kit's own files (claims, done.txt,
the runs' logs). No server: open it on this machine, or from another over the
kit's share (\\\\XEVO\\windcfd2\\status.html); it reloads itself.

    py -3.14 pipeline/windcfd/status.py            (once)
    py -3.14 pipeline/windcfd/status.py --loop     (every 30 s)
"""

from __future__ import annotations

import html
import json
import math
import os
import re
import sys
import time
from datetime import datetime
from pathlib import Path

KIT = Path(os.environ.get("WINDCFD_KIT", Path(__file__).resolve().parent.parent / "raw" / "windcfd"))
# run.ps1's order, so the page lists jobs as the runners take them
ORDER = [0, 8, 4, 12, 2, 10, 6, 14, 1, 9, 5, 13, 3, 11, 7, 15]
# where an hour goes, from the first finished Lac Bailey job: meshing 476 s,
# setup 78, the solve 2698, sampling 721
PHASES = [("mesh", 0.12), ("setup", 0.02), ("solve", 0.68), ("sample", 0.18)]
DEFAULT_MIN = 66.0


def dir_name(d: float) -> str:
    return f"d{d:05.1f}"


def progress(log: Path) -> tuple[float, str]:
    """How far a run is, 0..1, and the phase in words, from its log's last lines."""
    try:
        lines = log.read_text(errors="replace").splitlines()
    except OSError:
        return 0.0, "starting"
    text = "\n".join(lines[-40:])
    last = lines[-1].replace("Run 0: ", "") if lines else "starting"
    start = {k: sum(w for _, w in PHASES[:i]) for i, (k, _) in enumerate(PHASES)}
    weight = dict(PHASES)
    if "Run number 0 done" in text:
        return 1.0, "done"
    if re.search(r"Writing output files|Output writing", text):
        return 0.99, "writing"
    if "Sampling at requested output height" in text:
        return start["sample"] + 0.5 * weight["sample"], "sampling to 10 m (one core)"
    m = re.findall(r"Solver: (\d+)% complete", text)
    if m:
        p = int(m[-1]) / 100
        return start["solve"] + p * weight["solve"], f"solving {m[-1]}%"
    if re.search(r"Initializ|applyInit|potentialFoam", text):
        return start["setup"], "setting up the flow"
    m = re.findall(r"\((moveDynamicMesh|refineMesh|renumberMesh)\) (\d+)% complete", text)
    if m:
        step, p = m[-1]
        frac = {"moveDynamicMesh": (0.0, 0.6), "refineMesh": (0.6, 0.35), "renumberMesh": (0.95, 0.05)}[step]
        return start["mesh"] + (frac[0] + frac[1] * int(p) / 100) * weight["mesh"], f"meshing ({step} {p}%)"
    if re.search(r"blockMesh|Decomposing|Generating mesh", text):
        return 0.01, "meshing"
    return 0.0, last[:60]


def scan() -> dict:
    areas = sorted(p.name for p in KIT.iterdir() if (p / "meta.json").exists())
    jobs = []
    for a in areas:
        meta = json.loads((KIT / a / "meta.json").read_text())
        for k, d in enumerate(meta["directions"]):
            p = KIT / a / dir_name(d)
            job = {"area": a, "dir": d, "k": k, "state": "waiting", "who": "", "minutes": None, "frac": 0.0, "phase": "", "started": None}
            if p.exists():
                files = [f.name for f in p.iterdir()]
                claims = [f for f in files if f.startswith("claim")]
                if "done.txt" in files:
                    words = (p / "done.txt").read_text().split()
                    job.update(state="done", who=words[0] if words else "", frac=1.0)
                    try:
                        job["minutes"] = float(words[1])
                    except (IndexError, ValueError):
                        pass
                elif claims:
                    c = claims[0]
                    who = c[len("claim-"):-len(".txt")]
                    logs = sorted(p.glob(f"run-{who}.log"))
                    frac, phase = progress(logs[0]) if logs else (0.0, "starting")
                    job.update(state="running", who=who, frac=frac, phase=phase, started=(p / c).stat().st_mtime)
                elif any(f.startswith("failed") for f in files):
                    job.update(state="failed", who=next(f for f in files if f.startswith("failed"))[len("failed-"):-4])
            jobs.append(job)
    return {"areas": areas, "jobs": jobs}


def machine(who: str) -> str:
    return re.sub(r"-\d+$", "", who) or "?"


def rose(area: str, jobs: list[dict]) -> str:
    """16 wedges, the direction the wind comes FROM, north up."""
    cx = cy = 110
    r0, r1 = 34, 96
    out = [f'<svg viewBox="0 0 220 220" class="rose" role="img" aria-label="{html.escape(area)} directions">']
    for j in jobs:
        a0 = math.radians(j["dir"] - 11.25 + 1.2)
        a1 = math.radians(j["dir"] + 11.25 - 1.2)
        rr = r0 + (r1 - r0) * (j["frac"] if j["state"] == "running" else 1.0)
        def pt(a, r):
            return f"{cx + r * math.sin(a):.1f},{cy - r * math.cos(a):.1f}"
        path = lambda r: f"M{pt(a0, r0)} L{pt(a0, r)} A{r},{r} 0 0 1 {pt(a1, r)} L{pt(a1, r0)} A{r0},{r0} 0 0 0 {pt(a0, r0)} Z"
        tip = f'{j["dir"]:g}° · {j["state"]}' + (f' · {j["who"]}' if j["who"] else "") + (f' · {j["phase"]}' if j["phase"] else "")
        if j["state"] == "running":
            out.append(f'<path d="{path(r1)}" class="w-track"><title>{html.escape(tip)}</title></path>')
        out.append(f'<path d="{path(rr)}" class="w-{j["state"]}"><title>{html.escape(tip)}</title></path>')
    for lab, deg in (("N", 0), ("E", 90), ("S", 180), ("W", 270)):
        a = math.radians(deg)
        out.append(f'<text x="{cx + 106 * math.sin(a):.1f}" y="{cy - 106 * math.cos(a) + 4:.1f}" class="cardinal">{lab}</text>')
    done = sum(j["state"] == "done" for j in jobs)
    out.append(f'<text x="{cx}" y="{cy - 2}" class="count">{done}</text><text x="{cx}" y="{cy + 14}" class="of">of {len(jobs)}</text></svg>')
    return "".join(out)


def render(s: dict) -> str:
    now = time.time()
    jobs = s["jobs"]
    n = len(jobs)
    done = [j for j in jobs if j["state"] == "done"]
    running = [j for j in jobs if j["state"] == "running"]
    failed = [j for j in jobs if j["state"] == "failed"]
    waiting = n - len(done) - len(running) - len(failed)
    mins = [j["minutes"] for j in done if j["minutes"]]
    avg = sum(mins) / len(mins) if mins else DEFAULT_MIN
    # what's left, in jobs' worth, over how many run at once
    left = waiting + sum(1 - j["frac"] for j in running)
    lanes = max(1, len(running))
    eta_min = left * avg / lanes
    eta = datetime.fromtimestamp(now + eta_min * 60).strftime("%a %H:%M") if left > 0 else "—"
    pct = 100 * (len(done) + sum(j["frac"] for j in running)) / n if n else 0
    by_machine: dict[str, dict] = {}
    for j in jobs:
        if j["state"] in ("done", "running"):
            m = by_machine.setdefault(machine(j["who"]), {"done": 0, "running": 0, "minutes": []})
            m[j["state"]] += 1
            if j["minutes"]:
                m["minutes"].append(j["minutes"])
    roses = "".join(f'<figure>{rose(a, [j for j in jobs if j["area"] == a])}<figcaption>{html.escape(a.replace("-", " ").title())}</figcaption></figure>' for a in s["areas"])
    run_rows = "".join(
        f'<tr><td>{html.escape(j["area"].replace("-", " ").title())}</td><td class="num">{j["dir"]:g}°</td><td>{html.escape(j["who"])}</td><td class="phase">{html.escape(j["phase"])}</td>'
        f'<td class="bar"><span style="width:{100 * j["frac"]:.0f}%"></span></td><td class="num">{(now - j["started"]) / 60:.0f} min</td></tr>'
        for j in sorted(running, key=lambda j: -j["frac"])
    ) or '<tr><td colspan="6" class="dim">nothing running</td></tr>'
    mach_rows = "".join(
        f'<tr><td>{html.escape(k)}</td><td class="num">{v["running"]}</td><td class="num">{v["done"]}</td><td class="num">{(sum(v["minutes"]) / len(v["minutes"])):.0f} min</td></tr>' if v["minutes"]
        else f'<tr><td>{html.escape(k)}</td><td class="num">{v["running"]}</td><td class="num">{v["done"]}</td><td class="num dim">—</td></tr>'
        for k, v in sorted(by_machine.items())
    )
    fail_note = f'<p class="warn">{len(failed)} failed: ' + ", ".join(f'{j["area"]} {j["dir"]:g}° on {j["who"]}' for j in failed) + " (delete failed-*.txt to retry)</p>" if failed else ""
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="refresh" content="30"><title>Wind bake</title>
<style>
:root {{ --bg:#101612; --panel:#18211b; --line:#2a362e; --text:#e3e8e2; --dim:#8c998f; --done:#7fb88a; --run:#d7b25c; --wait:#323e35; --fail:#d0705f; --track:#232d26; }}
@media (prefers-color-scheme: light) {{ :root {{ --bg:#f4f2ec; --panel:#fffdf8; --line:#ddd8cc; --text:#1f2621; --dim:#6b756d; --done:#3f8a50; --run:#b48a2c; --wait:#dcd8cd; --fail:#b34f3f; --track:#ece8de; }} }}
* {{ box-sizing:border-box; }}
body {{ margin:0; padding:20px 16px 32px; background:var(--bg); color:var(--text); font:15px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }}
main {{ max-width:980px; margin:0 auto; }}
h1 {{ font-size:20px; margin:0 0 4px; font-weight:650; }}
.sub {{ color:var(--dim); margin:0 0 18px; }}
.stats {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:10px; margin-bottom:18px; }}
.stat {{ background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:10px 12px; }}
.stat b {{ display:block; font-size:22px; font-variant-numeric:tabular-nums; }}
.stat span {{ color:var(--dim); font-size:13px; }}
.overall {{ height:8px; background:var(--track); border-radius:4px; overflow:hidden; margin:-6px 0 20px; }}
.overall span {{ display:block; height:100%; background:var(--done); }}
.roses {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(240px,1fr)); gap:12px; margin-bottom:20px; }}
figure {{ margin:0; background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:10px; text-align:center; }}
figcaption {{ color:var(--dim); font-size:13px; margin-top:2px; }}
.rose {{ width:100%; max-width:260px; }}
.w-done {{ fill:var(--done); }} .w-running {{ fill:var(--run); }} .w-waiting {{ fill:var(--wait); }} .w-failed {{ fill:var(--fail); }} .w-track {{ fill:var(--wait); stroke:var(--run); stroke-width:1.5; }}
.cardinal {{ fill:var(--dim); font-size:11px; text-anchor:middle; }}
.count {{ fill:var(--text); font-size:26px; font-weight:650; text-anchor:middle; }}
.of {{ fill:var(--dim); font-size:11px; text-anchor:middle; }}
h2 {{ font-size:15px; margin:18px 0 8px; font-weight:650; }}
.tablewrap {{ overflow-x:auto; background:var(--panel); border:1px solid var(--line); border-radius:10px; }}
table {{ width:100%; border-collapse:collapse; font-size:14px; }}
th, td {{ text-align:left; padding:7px 10px; border-bottom:1px solid var(--line); white-space:nowrap; }}
th {{ color:var(--dim); font-weight:500; font-size:12px; }}
tr:last-child td {{ border-bottom:0; }}
.num {{ text-align:right; font-variant-numeric:tabular-nums; }}
.dim {{ color:var(--dim); }}
td.bar {{ width:30%; min-width:70px; }}
td.phase {{ white-space:normal; min-width:110px; }}
@media (max-width:560px) {{ th, td {{ padding:6px 7px; font-size:13px; }} }}
td.bar span {{ display:block; height:6px; border-radius:3px; background:var(--run); }}
.legend {{ display:flex; gap:14px; color:var(--dim); font-size:13px; margin:-8px 0 16px; flex-wrap:wrap; }}
.legend i {{ display:inline-block; width:10px; height:10px; border-radius:2px; margin-right:5px; vertical-align:-1px; }}
.warn {{ color:var(--fail); }}
</style></head><body><main>
<h1>Wind bake</h1>
<p class="sub">WindNinja momentum solve · 16 wind directions per area at 31 m · updated {datetime.fromtimestamp(now).strftime("%H:%M:%S")}, reloads every 30 s</p>
<div class="stats">
<div class="stat"><b>{len(done)}/{n}</b><span>directions done</span></div>
<div class="stat"><b>{len(running)}</b><span>running now</span></div>
<div class="stat"><b>{waiting}</b><span>waiting</span></div>
<div class="stat"><b>{eta}</b><span>≈ finish, at {avg:.0f} min a job</span></div>
</div>
<div class="overall" title="{pct:.0f}%"><span style="width:{pct:.1f}%"></span></div>
{fail_note}
<div class="roses">{roses}</div>
<div class="legend"><span><i style="background:var(--done)"></i>done</span><span><i style="background:var(--run)"></i>running (grows as it goes)</span><span><i style="background:var(--wait)"></i>waiting</span><span><i style="background:var(--fail)"></i>failed</span></div>
<h2>Running</h2>
<div class="tablewrap"><table><tr><th>Area</th><th class="num">From</th><th>Runner</th><th>Phase</th><th>Progress</th><th class="num">Elapsed</th></tr>{run_rows}</table></div>
<h2>Machines</h2>
<div class="tablewrap"><table><tr><th>Machine</th><th class="num">Running</th><th class="num">Done</th><th class="num">Avg job</th></tr>{mach_rows}</table></div>
</main></body></html>
"""


def write_once() -> None:
    out = KIT / "status.html"
    tmp = KIT / "status.html.part"
    tmp.write_text(render(scan()), encoding="utf-8")
    os.replace(tmp, out)


if __name__ == "__main__":
    if "--loop" in sys.argv:
        while True:
            try:
                write_once()
            except Exception as e:  # a log mid-write, a share hiccup: try again next round
                print(f"{datetime.now():%H:%M:%S} {e}", flush=True)
            time.sleep(30)
    else:
        write_once()
        print(KIT / "status.html")
