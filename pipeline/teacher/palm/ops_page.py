"""The ops page: what runs on which machine, in one look from a phone (Gavan, 2026-10-16: "a site to show
me what's running on what system"). XEVO writes it every minute (the scheduled task "Groundwind ops page",
pyw, so no window) and puts it on R2 at an unlisted link, data.groundwind.app/ops/<token>/index.html. Once the live
freeze lifts it moves behind the /stats key (his call: "when the live freeze is over, /stats keyed").

    py -3.14 pipeline/teacher/palm/ops_page.py            # write it and upload it once; prints the link
    py -3.14 pipeline/teacher/palm/ops_page.py --local    # write pipeline/raw/ops/index.html only

It reads only what's already on XEVO's disk: the job queue and the slots' status files on the share
(docs/SCENT-TESTSET.md, the service section), the SD bake's log, xonix's batch logs, the PALM runs landed.
No keys and no file paths go on the page.
"""

from __future__ import annotations

import argparse
import ctypes
import html
import json
import re
import secrets
import subprocess
import sys
import time
import traceback
import urllib.request
from ctypes import wintypes
from pathlib import Path

HERE = Path(__file__).resolve().parent
PIPE = HERE.parents[1]
ROOT = PIPE.parent
sys.path.insert(0, str(HERE))
import palm_status as ps  # noqa: E402  (Q, RUNS)

OPS = PIPE / "raw" / "ops"
TILES = PIPE / "raw" / "windtiles"
SDX = PIPE / "raw" / "windcfd" / "sdtiles" / "xonix"
REPORTS = PIPE / "raw" / "teacher" / "palm" / "loop" / "reports"
STALE_MIN = 5  # a slot's status older than this: the runner or the machine is down (they write every minute)
SLOT_NAMES = {
    "xonix-1": "PALM (22 cores)",
    "xonix-gpu": "GPU: SD wind tiles",
    "xonix-product": "Product (jumps the queue)",
    "xevo-1": "PALM (7 cores)",
}
RANK = {"product": 0, "validation": 1, "backfill": 2, "explore": 3}
NO_WINDOW = 0x08000000


def ago_s(t: float) -> str:
    s = max(0, time.time() - t)
    if s < 90:
        return f"{s:.0f} s ago"
    if s < 5400:
        return f"{s / 60:.0f} min ago"
    return f"{s / 3600:.1f} h ago" if s < 172800 else f"{s / 86400:.0f} d ago"


def nice_job(name: str) -> str:
    """'090-whitefish_ne045_4m.job.xonix' -> 'whitefish_ne045_4m'"""
    n = re.sub(r"\.job(\.\w+)?$", "", name)
    return re.sub(r"^\d{3}-", "", n)


def job_lines(p: Path) -> dict:
    t = p.read_text(encoding="utf-8", errors="replace").replace("\r", "")
    get = lambda k: (re.search(rf"^{k}:\s*(.+)$", t, re.M) or [None, ""])[1].strip()  # noqa: E731
    return dict(priority=get("priority") or "validation", host=get("host"), needs=get("needs"),
                why=get("# why"), cmd=bool(get("cmd")))


# ---- the slots (status-<host>-<slot>.txt, rewritten every minute by palm_runner.sh)
def slots() -> list[dict]:
    out = []
    for f in sorted(ps.Q.glob("status-*.txt")):
        key = f.stem[7:]
        lines = f.read_text(encoding="utf-8", errors="replace").splitlines()
        m = re.match(r"^(\S+) (\S+) slot (\S+) \(([^)]*)\), mode (\w+): (.*)$", lines[0] if lines else "")
        text = m.group(6) if m else (lines[0] if lines else "")
        load = next((ln.split(":", 1)[1].strip() for ln in lines[1:] if ln.startswith("load:")), "")
        age = time.time() - f.stat().st_mtime
        s = dict(key=key, host=key.split("-")[0], name=SLOT_NAMES.get(key, key), mode=m.group(5) if m else "?",
                 written=f.stat().st_mtime, load=load, text=text, job="", prio="", mins=None, tail="")
        r = re.match(r"running (\S+) \((\w+)\) for (\d+) min;?\s*(.*)$", text)
        if age > STALE_MIN * 60:
            s["state"] = "stale"
        elif r:
            s.update(state="busy", job=r.group(1), prio=r.group(2), mins=int(r.group(3)), tail=r.group(4))
        elif text.startswith(("paused", "off")):
            s["state"] = "paused"
        else:
            s["state"] = "idle"
        out.append(s)
    return out


def batch_progress(stem: str) -> dict | None:
    """An SD batch job's progress from its log (copied to the queue folder every minute)."""
    log = ps.Q / f"log-{stem}.txt"
    if not log.exists():
        return None
    t = log.read_text(encoding="utf-8", errors="replace")
    ok = re.findall(r"^\[\d+\] t-\S+: ([\d.]+) s,", t, re.M)
    bad = len(re.findall(r"^\[\d+\] t-\S+: .*(exited|Error)", t, re.M))
    b = re.search(r"(batch-\d{4})\.txt", t)
    done = len(list(SDX.glob("batch-*.done"))) if SDX.exists() else 0
    total = done + (len(list(SDX.glob("batch-*.txt"))) if SDX.exists() else 0)
    return dict(batch=b.group(1) if b else "", baked=len(ok), failed=bad,
                avg=(sum(map(float, ok)) / len(ok)) if ok else None, batches_done=done, batches=total,
                upload_failed="upload failed" in t[-4000:])


# ---- XEVO itself
class FILETIME(ctypes.Structure):
    _fields_ = [("lo", wintypes.DWORD), ("hi", wintypes.DWORD)]


def _times():
    i, k, u = FILETIME(), FILETIME(), FILETIME()
    ctypes.windll.kernel32.GetSystemTimes(ctypes.byref(i), ctypes.byref(k), ctypes.byref(u))
    v = lambda f: (f.hi << 32) | f.lo  # noqa: E731
    return v(i), v(k), v(u)


def xevo_cpu() -> float | None:
    try:
        a = _times()
        time.sleep(1.0)
        b = _times()
        idle, kern, user = (b[0] - a[0]), (b[1] - a[1]), (b[2] - a[2])
        return 100.0 * (1 - idle / (kern + user)) if kern + user else None
    except Exception:  # noqa: BLE001
        return None


def xevo_mem() -> tuple[float, float] | None:
    class MS(ctypes.Structure):
        _fields_ = [("len", wintypes.DWORD), ("load", wintypes.DWORD), ("total", ctypes.c_ulonglong),
                    ("avail", ctypes.c_ulonglong), ("a", ctypes.c_ulonglong), ("b", ctypes.c_ulonglong),
                    ("c", ctypes.c_ulonglong), ("d", ctypes.c_ulonglong), ("e", ctypes.c_ulonglong)]
    try:
        m = MS()
        m.len = ctypes.sizeof(MS)
        ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(m))
        return m.avail / 2**30, m.total / 2**30
    except Exception:  # noqa: BLE001
        return None


def count_procs(image: str) -> int:
    try:
        r = subprocess.run(["tasklist", "/FI", f"IMAGENAME eq {image}", "/FO", "CSV", "/NH"], capture_output=True,
                           text=True, timeout=20, creationflags=NO_WINDOW)
        return sum(1 for ln in r.stdout.splitlines() if ln.lower().startswith(f'"{image.lower()}"'))
    except Exception:  # noqa: BLE001
        return -1


def xevo_bake() -> dict:
    """The SD bake on XEVO, from the queue's front (wind_tiles.py bake --queue, huntapp-88)."""
    log = TILES / "bake.log"
    d = dict(state="not running", tiles=0, rate=None, last="", paused=(TILES / "PAUSE").exists())
    if not log.exists():
        return d
    lines = log.read_text(encoding="utf-8", errors="replace").splitlines()
    tiles = [ln for ln in lines if re.match(r"^\[\d+\] t-", ln)]
    age = time.time() - log.stat().st_mtime
    if tiles:
        m = re.match(r"^\[(\d+)\] (t-\S+): (.*?)\s*[·Â]+\s*([\d.]+) s in all", tiles[-1])
        if m:
            n, secs = int(m.group(1)), float(m.group(4))
            d.update(tiles=n, rate=secs / n if n else None, last=m.group(2))
    if d["paused"]:
        d["state"] = "paused"
    elif lines and lines[-1].startswith("queue empty"):
        d["state"] = "finished"
    elif age < 600:
        d["state"] = "running"
    d["written"] = log.stat().st_mtime
    return d


def r2_count() -> int | None:
    """The tiles on R2 (every machine's), read at most every 10 min."""
    cache = OPS / "r2.json"
    try:
        c = json.loads(cache.read_text())
        if time.time() - c["t"] < 600:
            return c["n"]
    except Exception:  # noqa: BLE001
        pass
    try:
        req = urllib.request.Request(f"https://data.groundwind.app/data/sd/v1/index.json?t={time.time():.0f}",
                                     headers={"User-Agent": "groundwind-ops-page"})
        with urllib.request.urlopen(req, timeout=30) as r:
            n = len(json.loads(r.read())["tiles"])
        cache.write_text(json.dumps(dict(t=time.time(), n=n)))
        return n
    except Exception:  # noqa: BLE001
        return None


# ---- the queue and what landed
def queue() -> dict:
    todo = []
    for p in (ps.Q / "todo").glob("*.job"):
        j = job_lines(p)
        todo.append(dict(name=nice_job(p.name), file=p.name, **j))
    todo.sort(key=lambda j: (RANK.get(j["priority"], 1), j["file"]))
    fin = []
    for part in ("done", "failed"):
        for p in (ps.Q / part).glob("*"):
            fin.append(dict(name=nice_job(p.name), part=part, t=p.stat().st_mtime))
    fin.sort(key=lambda j: -j["t"])
    modes = {h: ((ps.Q / f"mode-{h}").read_text().strip() if (ps.Q / f"mode-{h}").exists() else "on") for h in ("xonix", "xevo")}
    quiet = {h: [ln.strip() for ln in (ps.Q / f"quiet-{h}").read_text().splitlines() if ln.strip()]
             for h in ("xonix", "xevo") if (ps.Q / f"quiet-{h}").exists()}
    return dict(todo=todo, finished=fin[:8], modes=modes, quiet=quiet)


def landed() -> list[dict]:
    runs = [d for root in ps.RUNS if root.exists() for d in root.iterdir() if (d / "DONE").exists()]
    runs.sort(key=lambda d: -(d / "DONE").stat().st_mtime)
    return [dict(name=d.name, t=(d / "DONE").stat().st_mtime, processed=(d / "OUTPUT" / ".post.json").exists()) for d in runs[:8]]


def loop_report() -> dict | None:
    reps = sorted(REPORTS.glob("*.md")) if REPORTS.exists() else []
    return dict(name=reps[-1].stem, t=reps[-1].stat().st_mtime) if reps else None


def gather() -> dict:
    q = queue()
    sl = slots()
    for s in sl:
        if s["job"].startswith("sdx-"):
            s["batch"] = batch_progress(s["job"].removesuffix(".job"))
    total = sum(1 for ln in (TILES / "queue.txt").read_text(encoding="utf-8").splitlines() if ln.strip()) if (TILES / "queue.txt").exists() else None
    mem = xevo_mem()
    return dict(t=time.time(), slots=sl, queue=q, landed=landed(), loop=loop_report(),
                xevo=dict(cpu=xevo_cpu(), mem=mem, bake=xevo_bake(), windninja=count_procs("WindNinja_cli.exe")),
                sd=dict(total=total, r2=r2_count(), xonix=next((s.get("batch") for s in sl if s.get("batch")), None)))


# ---- the page
CSS = """
:root{--bg:#f6f4ee;--card:#fff;--ink:#1d2a22;--soft:#5d6b62;--line:#e2ddd0;--busy:#2f7d4f;--idle:#8a948d;
--warn:#b7791f;--bad:#b4402f;--chip:#eef0ea;--bar:#2f7d4f}
@media (prefers-color-scheme:dark){:root{--bg:#121714;--card:#1b221d;--ink:#e6ebe6;--soft:#9aa69e;--line:#2b342e;
--busy:#5cc489;--idle:#7d877f;--warn:#e0a84a;--bad:#e2725f;--chip:#243028;--bar:#5cc489}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:760px;margin:0 auto;padding:16px}
h1{font-size:20px;margin:4px 0 2px}h2{font-size:15px;margin:22px 0 8px;color:var(--soft);text-transform:uppercase;letter-spacing:.06em}
.sub{color:var(--soft);font-size:13px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin:0 0 10px}
.mach{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:6px}
.mach b{font-size:17px}.row{display:flex;gap:10px;align-items:flex-start;padding:7px 0;border-top:1px solid var(--line)}
.row:first-of-type{border-top:0}.dot{width:10px;height:10px;border-radius:50%;margin-top:6px;flex:none}
.busy{background:var(--busy)}.idle{background:var(--idle)}.paused{background:var(--warn)}.stale{background:var(--bad)}
.what{flex:1;min-width:0}.what .t{font-weight:600}.what .d{color:var(--soft);font-size:13px;overflow-wrap:anywhere}
.chip{display:inline-block;background:var(--chip);border-radius:999px;padding:1px 8px;font-size:12px;margin-left:4px;color:var(--soft)}
.p-product{color:#fff;background:var(--bad)}.p-validation{color:#fff;background:var(--busy)}
.bar{height:8px;background:var(--chip);border-radius:6px;overflow:hidden;margin:6px 0 2px}.bar i{display:block;height:100%;background:var(--bar)}
ul{list-style:none;margin:0;padding:0}li{padding:5px 0;border-top:1px solid var(--line);display:flex;justify-content:space-between;gap:10px}
li:first-child{border-top:0}li .n{overflow-wrap:anywhere}li .a{color:var(--soft);font-size:13px;white-space:nowrap}
.bad{color:var(--bad)}.warn{color:var(--warn)}
"""


def e(s) -> str:
    return html.escape(str(s))


def slot_row(s: dict) -> str:
    st = s["state"]
    if st == "busy":
        title = f"{e(nice_job(s['job']))} <span class='chip p-{e(s['prio'])}'>{e(s['prio'])}</span>"
        d = f"for {s['mins']} min"
        b = s.get("batch")
        if b:
            d = (f"{e(b['batch'])}: {b['baked']} tiles baked" + (f", {b['avg']:.0f} s each" if b["avg"] else "")
                 + (f", {b['failed']} tries failed" if b["failed"] else "") + f" · batch {b['batches_done'] + 1} of {b['batches']} · for {s['mins']} min"
                 + ("<br><span class='warn'>uploads failed in this batch: its tiles wait on xonix for the next upload</span>" if b["upload_failed"] else ""))
        elif (m := re.match(r"== \S+ on (\d+) cores, \d{4}-\d\d-\d\dT(\d\d:\d\d)", s["tail"])):
            d = f"on {m.group(1)} cores, started {m.group(2)} · for {s['mins']} min"
        elif s["tail"]:
            d += " · " + e(s["tail"][:140])
    elif st == "stale":
        title, d = "no word", f"last heard {ago_s(s['written'])}: the runner or the machine is down or asleep"
    elif st == "paused":
        title, d = ("off" if s["text"].startswith("off") else "paused"), e(s["text"][:140])
    else:
        title, d = "waiting for work", f"mode {e(s['mode'])}"
    return (f"<div class='row'><span class='dot {st}'></span><div class='what'><div class='t'>{e(s['name'])}: {title}</div>"
            f"<div class='d'>{d}</div></div></div>")


def objectives() -> str:
    """OBJECTIVES.md as HTML paragraphs: escaped, **bold** kept, paragraphs split on blank lines."""
    try:
        t = (HERE / "OBJECTIVES.md").read_text(encoding="utf-8").strip()
    except OSError:
        return ""
    if not t:
        return ""
    paras = []
    for para in re.split(r"\n\s*\n", t):
        h = html.escape(para.strip())
        h = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", h)
        paras.append(f"<p>{h}</p>")
    return "".join(paras)



def render(g: dict) -> str:
    q, x = g["queue"], g["xevo"]
    out = [f"<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
           f"<meta name=robots content=noindex><meta http-equiv=refresh content=60><title>Groundwind ops</title><style>{CSS}</style></head><body><main>",
           f"<h1>What's running</h1><div class=sub>Written by XEVO <span id=ago data-t='{g['t']:.0f}'>{ago_s(g['t'])}</span>; refreshes every minute</div>"]
    # the seat's objectives and why, one paragraph the PALM owner keeps current (Gavan, 2026-10-17: "add one paragraph at
    # the top with your current objectives and rationale, and keep that updated"): pipeline/teacher/palm/OBJECTIVES.md
    obj = objectives()
    if obj:
        out.append(f"<div class=card style='margin-bottom:14px'>{obj}</div>")

    # machines
    out.append("<h2>Machines</h2>")
    for host, label in (("xonix", "xonix · RTX 5090"), ("xevo", "XEVO")):
        sl = [s for s in g["slots"] if s["host"] == host]
        mode = q["modes"].get(host, "on")
        right = f"mode {e(mode)}"
        if host == "xevo":
            bits = []
            if x["cpu"] is not None:
                bits.append(f"CPU {x['cpu']:.0f}%")
            if x["mem"]:
                bits.append(f"{x['mem'][0]:.0f} of {x['mem'][1]:.0f} GB free")
            right = " · ".join(bits + [right])
        else:
            ld = next((s["load"] for s in sl if s["load"]), "")
            if ld:
                right = f"PALM load {e(ld.split()[0])} · {right}"
        qt = q["quiet"].get(host)
        out.append(f"<div class=card><div class=mach><b>{label}</b><span class=sub>{right}</span></div>")
        if qt:
            out.append(f"<div class='sub warn'>quiet windows: {e('; '.join(qt))}</div>")
        out += [slot_row(s) for s in sl]
        if host == "xevo":
            b = x["bake"]
            st = {"running": "busy", "paused": "paused", "finished": "idle"}.get(b["state"], "idle")
            d = (f"{b['tiles']} tiles this run" + (f", {b['rate']:.0f} s each" if b["rate"] else "") + (f" · last {e(b['last'])}" if b["last"] else "")
                 + (f" · log {ago_s(b['written'])}" if b.get("written") else ""))
            out.append(f"<div class='row'><span class='dot {st}'></span><div class='what'><div class='t'>GPU: SD wind tiles from the front: {e(b['state'])}</div><div class='d'>{d}</div></div></div>")
            if x["windninja"] and x["windninja"] > 0:
                out.append(f"<div class='row'><span class='dot busy'></span><div class='what'><div class='t'>WindNinja: {x['windninja']} running</div><div class='d'>HD wind bake, outside the queue</div></div></div>")
        out.append("</div>")

    # SD tiles
    sd = g["sd"]
    if sd["total"]:
        on = sd["r2"]
        pct = 100 * on / sd["total"] if on is not None else 0
        out.append("<h2>SD wind tiles, national</h2><div class=card>")
        out.append(f"<div class=t><b>{on if on is not None else '?'}</b> of {sd['total']:,} on R2 ({pct:.1f}%)</div><div class=bar><i style='width:{pct:.1f}%'></i></div>")
        out.append("<div class=sub>XEVO bakes from the front of the hunting-order queue, xonix from the end; each skips what the other has sent.</div></div>")

    # queue
    out.append(f"<h2>Up next ({len(q['todo'])})</h2><div class=card>")
    if q["todo"]:
        out.append("<ul>" + "".join(
            f"<li><span class=n>{e(j['name'])} <span class='chip p-{e(j['priority'])}'>{e(j['priority'])}</span></span>"
            f"<span class=a>{e(j['host'] or 'any')}{' · GPU' if 'gpu' in j['needs'] else ''}</span></li>" for j in q["todo"][:15]) + "</ul>")
        if len(q["todo"]) > 15:
            out.append(f"<div class=sub>and {len(q['todo']) - 15} more</div>")
    else:
        out.append("<div class=sub>nothing waiting</div>")
    out.append("</div>")

    # finished
    out.append("<h2>Finished lately</h2><div class=card><ul>" + "".join(
        f"<li><span class='n{' bad' if j['part'] == 'failed' else ''}'>{e(j['name'])}{' (failed)' if j['part'] == 'failed' else ''}</span><span class=a>{ago_s(j['t'])}</span></li>"
        for j in q["finished"]) + "</ul></div>")

    # PALM runs
    out.append("<h2>PALM runs landed</h2><div class=card><ul>" + "".join(
        f"<li><span class=n>{e(r['name'])}{'' if r['processed'] else ' <span class=warn>(not processed yet)</span>'}</span><span class=a>{ago_s(r['t'])}</span></li>"
        for r in g["landed"]) + "</ul>")
    if g["loop"]:
        out.append(f"<div class=sub style='margin-top:6px'>Nightly loop: last report {e(g['loop']['name'])}, {ago_s(g['loop']['t'])}</div>")
    out.append("</div>")

    out.append("<script>(function(){var s=document.getElementById('ago');function f(){var d=Date.now()/1000-+s.dataset.t;"
               "s.textContent=d<90?Math.round(d)+' s ago':Math.round(d/60)+' min ago';s.className=d>300?'bad':''}f();setInterval(f,5000)})()</script>")
    out.append("</main></body></html>")
    return "".join(out)


def token() -> str:
    p = OPS / "token.txt"
    if not p.exists():
        p.write_text(secrets.token_urlsafe(18), encoding="utf-8")
    return p.read_text(encoding="utf-8").strip()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--local", action="store_true", help="write pipeline/raw/ops/index.html only, no upload")
    a = ap.parse_args()
    OPS.mkdir(parents=True, exist_ok=True)
    try:
        g = gather()
        page = render(g)
        (OPS / "index.html").write_text(page, encoding="utf-8")
        url = f"https://data.groundwind.app/ops/{token()}/index.html"  # R2 serves no folder index
        if not a.local:
            sys.path.insert(0, str(ROOT / "app" / "scripts"))
            import r2_sync  # noqa: E402

            # not held by HOLD-UPLOADS (Gavan, 2026-10-20: "standing rule, let's update the ops page"): a few KB a minute, his window on the machines
            r2_sync.client().put_object(Bucket=r2_sync.BUCKET, Key=f"ops/{token()}/index.html", Body=page.encode("utf-8"),
                                        ContentType="text/html; charset=utf-8", CacheControl="no-store")
        (OPS / "last.log").write_text(f"{time.strftime('%Y-%m-%d %H:%M:%S')} ok {len(page)} bytes -> {url}\n", encoding="utf-8")
        print(url if not a.local else OPS / "index.html")
        return 0
    except Exception:  # noqa: BLE001  pyw has no console: the trouble goes to the log
        (OPS / "last.log").write_text(f"{time.strftime('%Y-%m-%d %H:%M:%S')}\n{traceback.format_exc()}", encoding="utf-8")
        raise


if __name__ == "__main__":
    sys.exit(main())
