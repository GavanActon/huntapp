"""After a PALM run: everything a finished run owes, without anyone typing it.

For every run folder under the runs roots (this machine's and the share's)
whose output is complete and not yet processed:
  1. palm_to_fields.py convert   the surrogate's field npz (fields/<name>.npz)
  2. palm_to_scent.py read+bands the scent sources' how-often bands, if the
                                 run carried particles (fields/<name>_scent*)
  3. fields/RUNS.md              one line per run: what it was, what it gave
State lives in <run>/OUTPUT/.post.json; a step that failed is retried on the
next pass from another host or with --force. A log goes to <run>/post.log.

    py -3.14 pipeline/teacher/palm/postprocess.py --once             # one pass (the scheduled task, every 15 min)
    py -3.14 pipeline/teacher/palm/postprocess.py --watch 10         # loop, every 10 min
    py -3.14 pipeline/teacher/palm/postprocess.py --once --run pickle-slot_s186_4m_scent --force

run_case.sh writes <run>/run.json (case, run, name, host, times) and <run>/DONE
when it has copied the output home (ship_run.sh after a lean ship from xonix).
Only a run marked DONE is processed, and a DONE newer than its state (a run
shipped again) redoes it. A run is processed where its output can be read: the
scheduled task on XEVO ("Groundwind PALM post") covers xonix's runs through
the share.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import socket
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
PIPE = HERE.parents[1]
ROOTS = [PIPE / "raw" / "teacher" / "palm" / "runs", PIPE / "raw" / "windcfd" / "raw" / "teacher" / "palm" / "runs"]
FIELDS = PIPE / "raw" / "teacher" / "palm" / "fields"
PY = [sys.executable]
HOST = socket.gethostname()


def log(run_dir: Path, msg: str) -> None:
    line = f"{time.strftime('%Y-%m-%d %H:%M:%S')} {msg}"
    print(line)
    try:
        with open(run_dir / "post.log", "a", encoding="utf-8") as fh:
            fh.write(line + "\n")
    except OSError:
        pass


def resolve(run_dir: Path) -> dict | None:
    """case, run key, tag, name and the output files' prefix for a run folder."""
    name = run_dir.name
    out = run_dir / "OUTPUT"
    if not out.is_dir():
        return None
    man = {}
    if (run_dir / "run.json").exists():
        try:
            man = json.loads((run_dir / "run.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            man = {}
    av = sorted(out.glob("*_av_3d*.nc"))
    prefix = re.sub(r"_av_3d.*$", "", av[-1].name) if av else name
    case = man.get("case") or name.split("_")[0]
    cdir = HERE / case
    if not cdir.is_dir():
        return None
    best = None
    for cj in sorted(cdir.glob("case*.json")):
        try:
            info = json.loads(cj.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        tag = info.get("tag", "")
        for key in info.get("runs", {}):
            if man.get("run") == key or name == key or name.startswith(key + "_"):
                if best is None or len(key) > len(best["run"]):
                    best = dict(run=key, tag=tag, case=case)
    if best is None:
        return None
    return dict(best, name=name, prefix=prefix, out=out, has_av=bool(av),
                has_prt=any(p.is_dir() and ("_prt_bin" in p.name or p.name == "PARTICLE_DATA") for p in out.iterdir()),
                # ship_run.sh --ship lean: the particles already read on the machine that ran it (xonix), so the
                # raw binary never crosses the link; preferred over any (perhaps half-copied) prt_bin beside it
                npz=run_dir / f"{name}_particles.npz" if (run_dir / f"{name}_particles.npz").exists() else None)


def finished(run_dir: Path, r: dict) -> bool:
    """Only a run marked DONE (run_case.sh, ship_run.sh, the sweeper). Until 2026-10-15 a run whose files had
    settled for ten minutes counted too, and a copy stalled by the link to xonix looked settled: half of
    pickle-bogs_dusk288_4m's particles were taken for the run. Every run before then is already processed."""
    return (run_dir / "DONE").exists()


def run_step(run_dir: Path, args: list[str]) -> tuple[bool, str]:
    cmd = PY + [str(HERE / args[0])] + args[1:]
    log(run_dir, "$ " + " ".join(args))
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=3600, cwd=str(PIPE.parent))
    except (OSError, subprocess.TimeoutExpired) as e:
        log(run_dir, f"  failed to start: {e}")
        return False, str(e)
    tail = (p.stdout + p.stderr).strip().splitlines()[-12:]
    for line in tail:
        log(run_dir, "  " + line)
    return p.returncode == 0, "\n".join(tail)


def process(run_dir: Path, r: dict, force: bool) -> dict:
    state_path = r["out"] / ".post.json"
    state = {}
    # a DONE newer than the state: the run was shipped again (ship_run.sh, lean), so everything is redone
    done = run_dir / "DONE"
    if state_path.exists() and done.exists() and done.stat().st_mtime > state_path.stat().st_mtime:
        force = True
    if state_path.exists() and not force:
        try:
            state = json.loads(state_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            state = {}
    name, case, run, tag = r["name"], r["case"], r["run"], r["tag"]
    tagargs = ["--tag", tag] if tag else []
    changed = False

    def have(step: str) -> bool:
        """The products exist in this machine's fields folder (another host may have made them elsewhere)."""
        if step == "fields":
            return (FIELDS / f"{name}.npz").exists()
        if step == "picture":
            return (FIELDS / f"{name}_wind.png").exists()
        return (not r["has_prt"] and not r["npz"]) or (FIELDS / f"{name}_scent.json").exists()

    def need(step: str) -> bool:
        st = state.get(step)
        if st is None:
            return True
        if st.get("ok") and (st.get("host") == HOST or have(step)):
            return False
        return st.get("host") != HOST or force   # done or failed elsewhere (xonix, over the share) is redone here

    if need("fields"):
        if (FIELDS / f"{name}.npz").exists() and not force:
            state["fields"] = dict(ok=True, host=HOST, when=time.strftime("%Y-%m-%d %H:%M"), note="already converted")
        else:
            ok, tail = run_step(run_dir, ["palm_to_fields.py", "convert", case, run, "--output", str(r["out"]),
                                          "--prefix", r["prefix"], "--as", name] + tagargs)
            state["fields"] = dict(ok=ok, host=HOST, when=time.strftime("%Y-%m-%d %H:%M"), tail=tail if not ok else "")
        changed = True
    if need("picture"):
        if not (FIELDS / f"{name}.npz").exists():
            state["picture"] = dict(ok=False, host=HOST, when=time.strftime("%Y-%m-%d %H:%M"), tail="no field npz")
        else:
            ok, tail = run_step(run_dir, ["draw_wind.py", name])
            state["picture"] = dict(ok=ok, host=HOST, when=time.strftime("%Y-%m-%d %H:%M"), tail=tail if not ok else "")
        changed = True
    if need("scent"):
        if r["npz"]:
            dst = FIELDS / f"{name}_particles.npz"
            try:
                if not dst.exists() or dst.stat().st_size != r["npz"].stat().st_size:
                    shutil.copyfile(r["npz"], dst)
                ok, tail = run_step(run_dir, ["palm_to_scent.py", "bands", case, run, "--as", name] + tagargs)
            except OSError as e:
                ok, tail = False, f"copying the shipped particles: {e}"
            state["scent"] = dict(ok=ok, host=HOST, when=time.strftime("%Y-%m-%d %H:%M"), note="shipped npz",
                                  tail=tail if not ok else "")
        elif not r["has_prt"]:
            state["scent"] = dict(ok=True, host=HOST, when=time.strftime("%Y-%m-%d %H:%M"), note="no particles in this run")
        else:
            ok, tail = run_step(run_dir, ["palm_to_scent.py", "read", case, run, "--output", str(r["out"]),
                                          "--prefix", r["prefix"], "--as", name] + tagargs)
            if ok:
                ok, tail = run_step(run_dir, ["palm_to_scent.py", "bands", case, run, "--as", name] + tagargs)
            state["scent"] = dict(ok=ok, host=HOST, when=time.strftime("%Y-%m-%d %H:%M"), tail=tail if not ok else "")
        changed = True
    if changed:
        try:
            state_path.write_text(json.dumps(state, indent=1), encoding="utf-8")
        except OSError as e:
            log(run_dir, f"  could not write {state_path}: {e}")
    return state


def index() -> None:
    """fields/RUNS.md: every run folder, what it is and what it gave."""
    rows = []
    for root in ROOTS:
        if not root.is_dir():
            continue
        for run_dir in sorted(root.iterdir()):
            r = resolve(run_dir) if run_dir.is_dir() else None
            if r is None:
                continue
            st = {}
            if (r["out"] / ".post.json").exists():
                try:
                    st = json.loads((r["out"] / ".post.json").read_text(encoding="utf-8"))
                except (OSError, ValueError):
                    st = {}
            man = {}
            if (run_dir / "run.json").exists():
                try:
                    man = json.loads((run_dir / "run.json").read_text(encoding="utf-8"))
                except (OSError, ValueError):
                    man = {}
            scent = ""
            sj = FIELDS / f"{r['name']}_scent.json"
            if sj.exists():
                try:
                    s = json.loads(sj.read_text(encoding="utf-8"))["sources"]
                    far = max((max(v["0.15"] for v in src["reach_by_sector"].values()) for src in s.values()), default=0)
                    scent = f"{len(s)} sources, some-minutes reach to {far:.0f} m"
                except (OSError, ValueError, KeyError):
                    scent = "summary unreadable"
            mark = lambda k: ("ok" if st.get(k, {}).get("ok") else ("FAILED" if k in st else "pending")) + ("" if not st.get(k, {}).get("note") else f" ({st[k]['note']})")
            pics = " ".join(f"[{k}]({r['name']}{sfx})" for k, sfx in (("wind", "_wind.png"), ("scent", "_scent.png")) if (FIELDS / f"{r['name']}{sfx}").exists())
            rows.append(f"| {r['name']} | {r['case']} | {r['run']} | {r['tag'] or '-'} | {man.get('host', '-')} | {man.get('finished', '-')} "
                        f"| {mark('fields')} | {mark('scent')} | {scent} | {pics} | {root.name if root == ROOTS[0] else 'share'} |")
    FIELDS.mkdir(parents=True, exist_ok=True)
    (FIELDS / "RUNS.md").write_text(
        "# PALM runs and what they gave\n\nWritten by pipeline/teacher/palm/postprocess.py on every pass.\n\n"
        "| folder | case | run | tag | host | finished | fields | scent | scent summary | where |\n|---|---|---|---|---|---|---|---|---|---|\n"
        + "\n".join(rows) + "\n", encoding="utf-8")


def one_pass(only: str | None, force: bool) -> int:
    n = 0
    for root in ROOTS:
        if not root.is_dir():
            continue
        for run_dir in sorted(root.iterdir()):
            if not run_dir.is_dir() or (only and run_dir.name != only):
                continue
            r = resolve(run_dir)
            if r is None or not finished(run_dir, r):
                continue
            st_path = r["out"] / ".post.json"
            if st_path.exists() and not force:
                try:
                    st = json.loads(st_path.read_text(encoding="utf-8"))
                    steps = ("fields", "picture", "scent")
                    if all(k in st and st[k].get("host") == HOST and st[k].get("ok") for k in steps):
                        continue
                except (OSError, ValueError):
                    pass
            log(run_dir, f"== {r['name']}: {r['case']} {r['run']} tag '{r['tag']}' prefix {r['prefix']}, particles {'shipped npz' if r['npz'] else 'yes' if r['has_prt'] else 'no'}")
            process(run_dir, r, force)
            n += 1
    index()
    return n


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--once", action="store_true")
    ap.add_argument("--watch", type=float, default=0.0, help="minutes between passes")
    ap.add_argument("--run", help="only this run folder")
    ap.add_argument("--force", action="store_true", help="redo the steps even where they are marked done")
    args = ap.parse_args()
    if args.watch > 0:
        while True:
            n = one_pass(args.run, args.force)
            print(f"{time.strftime('%H:%M:%S')} pass done, {n} run(s) processed; next in {args.watch:g} min")
            time.sleep(args.watch * 60)
    else:
        n = one_pass(args.run, args.force)
        print(f"{n} run(s) processed; index at {FIELDS / 'RUNS.md'}")


if __name__ == "__main__":
    main()
