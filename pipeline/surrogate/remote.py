"""Send a surrogate training or prediction run to xonix and bring its results
back into pipeline/raw/surrogate/, as if it had run here.

xonix (XONIC: an RTX 5090 with 32 GB) trains a fold in well under the 25 min
it takes on XEVO's 5060 (SURROGATE.md §6), but it has no checkout, only the
WindNinja kit's share. So the surrogate has a kit of its own inside that one,
<kit>/surrogate (\\\\XEVO\\windcfd2\\surrogate from xonix), and
run-surrogate.ps1 there (its source is pipeline/windcfd/surrogate/) watches
it: it claims a job nobody has, runs code\\<script> with the job's arguments
on its own copy of data\\, and copies every file the run wrote or changed
into the job's out\\ folder. This is the XEVO side: it keeps code\\ and data\\
in step with this checkout, writes the jobs, waits on them, and collects
what comes back, so predict.py and eval.py find it where they always look.

    py -3.14 pipeline/surrogate/remote.py sync [--needs runs/foldA ...]
    py -3.14 pipeline/surrogate/remote.py run train.py -- --holdout sault-test --name foldC
    py -3.14 pipeline/surrogate/remote.py run predict.py -- --run foldC --area sault-test
    py -3.14 pipeline/surrogate/remote.py submit eval.py -- --run foldC --area sault-test --tta
    py -3.14 pipeline/surrogate/remote.py wait 20261010-0130-eval-foldC-sault-test
    py -3.14 pipeline/surrogate/remote.py status

or from the scripts themselves, the kit then from SURROGATE_KIT:

    py -3.14 pipeline/surrogate/train.py --remote --holdout sault-test --name foldC

sync    code\\ (every pipeline/surrogate/*.py, and code\\VERSION, a hash of
        them, so a runner can tell its copy is the latest), the runner's own
        files from pipeline/windcfd/surrogate/, every pipeline/raw/surrogate
        npz into data\\, and with --needs those runs' ckpt.pt and config.json.
        Copies only what differs in size or time, and never deletes data.
submit  sync, then jobs\\<id>\\job.json. predict.py and eval.py jobs take
        their run's checkpoint along without being told (from --run). The
        runner adds --data itself, so a job's arguments may not carry it.
wait    look at the job every 30 s and show its log's last line every 2 min;
        on done.txt copy out\\ into pipeline/raw/surrogate (a file here that
        is newer than the one that came back is kept). Exits 1 if it failed.
run     submit, then wait.
status  every job in the kit: who took it, when, how long, and whether its
        results have come back here.

The kit is --kit, else SURROGATE_KIT, else <WINDCFD_KIT>/surrogate, else
pipeline/raw/windcfd/surrogate (build_windcfd.py's KIT, plus surrogate).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import socket
import sys
import time
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
PIPE = HERE.parent
# fields.DATA, spelled out: importing fields would pull in scipy just to sync
DATA = PIPE / "raw" / "surrogate"
RUNNER = PIPE / "windcfd" / "surrogate"
SCRIPTS = ("train.py", "predict.py", "eval.py")
POLL_S = 30
SHOW_S = 120
STALE_S = 2 * 3600
# a copy over SMB can land with its time rounded; closer than this is the same
SLACK_S = 2.0
TAIL_BYTES = 65536


def default_kit() -> Path:
    if os.environ.get("SURROGATE_KIT"):
        return Path(os.environ["SURROGATE_KIT"])
    return Path(os.environ.get("WINDCFD_KIT", PIPE / "raw" / "windcfd")) / "surrogate"


def check_kit(kit: Path, make: bool = False) -> Path:
    # a typo or an unreachable share must not quietly grow a kit somewhere new
    if not (kit.is_dir() or (make and kit.parent.is_dir())):
        raise SystemExit(f"no kit at {kit} (is the share reachable? --kit or SURROGATE_KIT names it)")
    return kit


def mb(n: int) -> str:
    if n < 1024:
        return f"{n} B"
    return f"{n / 2**20:.1f} MB" if n >= 2**20 else f"{n / 1024:.0f} kB"


def differs(src: Path, dst: Path) -> bool:
    if not dst.exists():
        return True
    a, b = src.stat(), dst.stat()
    return a.st_size != b.st_size or abs(a.st_mtime - b.st_mtime) > SLACK_S


def copy(src: Path, dst: Path, label: str) -> int:
    """Copy src to dst if they differ, keeping its time; bytes copied, else 0.
    Through a .part file, so a runner reading the kit meanwhile never takes
    half an npz."""
    if not differs(src, dst):
        return 0
    dst.parent.mkdir(parents=True, exist_ok=True)
    tmp = dst.with_name(dst.name + ".part")
    shutil.copy2(src, tmp)
    os.replace(tmp, dst)
    n = src.stat().st_size
    print(f"  {label}  {mb(n)}", flush=True)
    return n


def code_files() -> list[Path]:
    return sorted(HERE.glob("*.py"), key=lambda p: p.name)


def code_hash(files: list[Path]) -> str:
    h = hashlib.sha256()
    for f in sorted(files, key=lambda p: p.name):
        h.update(f.name.encode() + b"\0" + f.read_bytes() + b"\0")
    return h.hexdigest()[:12]


def norm_need(need: str) -> str:
    need = need.replace("\\", "/").strip("/")
    return need if need.startswith("runs/") else f"runs/{need}"


def sync(kit: Path, needs: list[str] = ()) -> None:
    check_kit(kit, make=True)
    needs = list(dict.fromkeys(norm_need(n) for n in needs))
    for need in needs:
        if not (DATA / need / "ckpt.pt").exists():
            raise SystemExit(f"{need}: no {DATA / need / 'ckpt.pt'} here to send")
    print(f"sync to {kit}", flush=True)
    copied = nbytes = removed = 0

    files = code_files()
    code = kit / "code"
    for f in files:
        n = copy(f, code / f.name, f"code/{f.name}")
        copied, nbytes = copied + bool(n), nbytes + n
    names = {f.name for f in files}
    for old in code.glob("*.py"):
        if old.name not in names:
            old.unlink()
            removed += 1
            print(f"  code/{old.name}  removed (gone here)")
    # last, so a runner that sees a new VERSION finds the new files beside it;
    # only when the hash moves, so its date says when the code changed
    version = code_hash(files)
    vfile = code / "VERSION"
    old = vfile.read_text().split()[:1] if vfile.exists() else []
    if old != [version]:
        vfile.write_text(f"{version} {datetime.now():%Y-%m-%d %H:%M}\n")
        print(f"  code/VERSION  {version}")

    if RUNNER.is_dir():
        for f in sorted(RUNNER.glob("*.ps1")) + [RUNNER / "README.txt"]:
            if f.exists():
                n = copy(f, kit / f.name, f.name)
                copied, nbytes = copied + bool(n), nbytes + n

    data = kit / "data"
    # report-dataset.json too: eval.py folds it into its scoreboard
    for f in sorted(DATA.glob("*.npz")) + [DATA / "report-dataset.json"]:
        if f.exists():
            n = copy(f, data / f.name, f"data/{f.name}")
            copied, nbytes = copied + bool(n), nbytes + n
    for need in needs:
        for name in ("ckpt.pt", "config.json"):
            # config.json is written only when a run finishes; ckpt.pt carries it too
            f = DATA / need / name
            if f.exists():
                n = copy(f, data / need / name, f"data/{need}/{name}")
                copied, nbytes = copied + bool(n), nbytes + n
    print(f"sync: {copied} copied ({mb(nbytes)}), {removed} removed, code {version}", flush=True)


def arg_value(argv: list[str], flag: str) -> str | None:
    for i, a in enumerate(argv):
        if a == flag and i + 1 < len(argv):
            return argv[i + 1]
        if a.startswith(flag + "="):
            return a.split("=", 1)[1]
    return None


def has_flag(argv: list[str], flag: str) -> bool:
    return any(a == flag or a.startswith(flag + "=") for a in argv)


def slug_of(argv: list[str]) -> str:
    """The job's name in its id: the run's --name, else the --holdout (train
    names the run hold-<area> then), else --run and --area."""
    s = arg_value(argv, "--name") or arg_value(argv, "--holdout")
    if not s:
        s = "-".join(x for x in (arg_value(argv, "--run"), arg_value(argv, "--area")) if x)
    return re.sub(r"[^A-Za-z0-9._-]+", "-", s).strip("-") or "job"


def check_script(script: str) -> str:
    script = Path(script).name
    if script not in SCRIPTS:
        raise SystemExit(f"{script}: a job runs one of {', '.join(SCRIPTS)}")
    return script


def submit(kit: Path, script: str, argv: list[str], needs: list[str] = ()) -> str:
    script = check_script(script)
    if has_flag(argv, "--data"):
        raise SystemExit("the runner gives the script its own --data; leave it out of the job's arguments")
    if has_flag(argv, "--ckpt"):
        # a path here means nothing on xonix; --run sends runs/<run>/ckpt.pt along
        raise SystemExit("--ckpt names a file on this machine; use --run, whose checkpoint goes with the job")
    needs = [norm_need(n) for n in needs]
    run = arg_value(argv, "--run")
    if script in ("predict.py", "eval.py") and run:
        needs.append(f"runs/{run}")
    needs = list(dict.fromkeys(needs))
    sync(kit, needs)

    jobs = kit / "jobs"
    jobs.mkdir(exist_ok=True)
    base = f"{datetime.now():%Y%m%d-%H%M}-{Path(script).stem}-{slug_of(argv)}"
    job_id, k = base, 2
    while True:
        try:
            (jobs / job_id).mkdir()  # exclusive: two submits in a minute get -2, -3
            break
        except FileExistsError:
            job_id, k = f"{base}-{k}", k + 1
    job = {"id": job_id, "script": script, "argv": list(argv), "needs": needs,
           "created": datetime.now().astimezone().isoformat(timespec="seconds"),
           "from": socket.gethostname()}
    # whole or not at all, so a runner never reads half a job
    tmp = jobs / job_id / "job.json.part"
    tmp.write_text(json.dumps(job, indent=2) + "\n")
    os.replace(tmp, jobs / job_id / "job.json")
    print(job_id, flush=True)
    return job_id


def tail(log: Path | None, n: int) -> list[str]:
    """The last n non-blank lines of a runner's log, which may be UTF-16
    (PowerShell 5.1's redirection) or UTF-8."""
    if log is None:
        return []
    try:
        with open(log, "rb") as f:
            head = f.read(2)
            size = f.seek(0, 2)
            start = max(0, size - TAIL_BYTES)
            f.seek(start)
            b = f.read()
    except OSError:
        return []
    # UTF-16 text has a NUL in every other byte; which half, says where the
    # read began against the characters
    even0, odd0 = b[0::2].count(0), b[1::2].count(0)
    if head == b"\xff\xfe" or max(even0, odd0) > 0.2 * len(b):
        shift = start % 2 if head == b"\xff\xfe" else int(even0 > odd0)
        text = b[shift:].decode("utf-16-le", "replace")
    else:
        text = b.decode("utf-8", "replace")
    lines = [ln.rstrip() for ln in text.lstrip("﻿").replace("\r", "\n").split("\n")]
    if start > 0:
        lines = lines[1:]  # cut mid-line
    return [ln for ln in lines if ln.strip()][-n:]


def mtime(p: Path) -> float:
    try:
        return p.stat().st_mtime
    except OSError:
        return 0.0


def host_of(name: str) -> str:
    # claim-<HOST>-<pid>.txt, failed-<HOST>-<stamp>.txt, claim-HOLD.txt
    m = re.fullmatch(r"(?:claim|failed)-(.+?)(?:-\d[\d-]*)?\.txt", name)
    return m.group(1) if m else name


def job_state(d: Path) -> dict:
    """What the runner's files say about a job: state (waiting, running,
    done, failed), host, started and ended (epoch seconds), the newest log."""
    claims = sorted(d.glob("claim*.txt"), key=mtime)
    fails = sorted(d.glob("failed-*.txt"), key=mtime)
    logs = sorted(d.glob("run-*.log"), key=mtime)
    log = logs[-1] if logs else None
    done = d / "done.txt"
    # a failure renames the claim (keeping its time) or is written beside it;
    # either way a claim newer than every failure is a retry under way
    last_claim = mtime(claims[-1]) if claims else 0.0
    last_fail = mtime(fails[-1]) if fails else 0.0
    if done.exists():
        state = "done"
    elif fails and last_fail >= last_claim:
        state = "failed"
    elif claims:
        state = "running"
    else:
        state = "waiting"
    attempt = max(claims + fails, key=mtime, default=None)
    started = mtime(attempt) if attempt else None
    if state == "done":
        ended = mtime(done)
    elif state == "failed":
        ended = max(last_fail, mtime(log) if log else 0.0)
    else:
        ended = time.time()
    return {"state": state, "host": host_of(attempt.name) if attempt else None,
            "started": started, "ended": ended, "log": log,
            "quiet_since": max(mtime(log) if log else 0.0, last_claim)}


def collect(d: Path, into: Path = DATA) -> int:
    out = d / "out"
    files = sorted(p for p in out.rglob("*") if p.is_file()) if out.is_dir() else []
    came, kept, same = [], [], 0
    for src in files:
        rel = src.relative_to(out)
        dst = into / rel
        if dst.exists() and mtime(dst) > mtime(src) + SLACK_S:
            kept.append(rel.as_posix())
            print(f"  {rel.as_posix()}  kept: the one here is newer")
            continue
        if copy(src, dst, rel.as_posix()):
            came.append(rel.as_posix())
        else:
            same += 1
    if not files:
        print(f"  nothing came back in {out}")
    (d / "collected.txt").write_text(
        f"{socket.gethostname()} {datetime.now():%Y-%m-%d %H:%M} into {into}\n"
        + "".join(f"{r}\n" for r in came) + "".join(f"kept {r}\n" for r in kept))
    print(f"collected {len(came)} files into {into}" + (f", {same} already here" if same else "")
          + (f", {len(kept)} kept as newer here" if kept else ""))
    return 0


def stamp(t: float | None) -> str:
    return datetime.fromtimestamp(t).strftime("%m-%d %H:%M") if t else "-"


def wait(kit: Path, job_id: str, timeout: float | None = None) -> int:
    d = check_kit(kit) / "jobs" / job_id
    if not (d / "job.json").exists():
        raise SystemExit(f"no job {job_id} in {kit / 'jobs'}")
    t0 = time.time()
    shown, host, stale_warned = -1e18, None, False
    try:
        while True:
            st = job_state(d)
            now = time.time()
            if st["state"] == "done":
                mins = (st["ended"] - st["started"]) / 60 if st["started"] else None
                print(f"{job_id} done on {st['host'] or '?'}" + (f" in {mins:.1f} min" if mins is not None else ""))
                collect(d)
                for ln in tail(st["log"], 5):
                    print(f"  | {ln}")
                return 0
            if st["state"] == "failed":
                print(f"{job_id} FAILED on {st['host'] or '?'}; its log ({st['log'].name if st['log'] else 'none'}) ends:")
                for ln in tail(st["log"], 20):
                    print(f"  | {ln}")
                return 1
            if st["state"] == "running" and st["host"] != host:
                host = st["host"]
                print(f"{datetime.now():%H:%M} claimed by {host} at {stamp(st['started'])}", flush=True)
                shown = now  # the claim line stands for this round's news
            if now - shown >= SHOW_S:
                last = tail(st["log"], 1)
                if st["state"] == "waiting":
                    msg = f"waiting for a runner ({(now - t0) / 60:.0f} min)"
                else:
                    msg = last[0] if last else "claimed, no log yet"
                print(f"{datetime.now():%H:%M} {msg}", flush=True)
                shown = now
            if st["state"] == "running":
                quiet = now - st["quiet_since"]
                if quiet > STALE_S and not stale_warned:
                    print(f"{datetime.now():%H:%M} warning: {host} claimed it and its log has not moved for "
                          f"{quiet / 3600:.1f} h; if that machine is off, delete its claim file so another "
                          f"runner takes the job", flush=True)
                    stale_warned = True
                elif quiet <= STALE_S:
                    stale_warned = False
            if timeout is not None and now - t0 >= timeout:
                print(f"stopped waiting after {timeout:g} s; the job goes on: remote.py wait {job_id}")
                return 2
            time.sleep(POLL_S if timeout is None else max(0.0, min(POLL_S, timeout - (now - t0))))
    except KeyboardInterrupt:
        print(f"\nstopped waiting; the job goes on: remote.py wait {job_id}")
        return 130


def run(script: str, argv: list[str], needs: list[str] = (), kit: Path | None = None,
        timeout: float | None = None) -> int:
    """submit, then wait: what train.py and predict.py call with --remote."""
    kit = kit or default_kit()
    job_id = submit(kit, script, argv, list(needs))
    return wait(kit, job_id, timeout)


def status(kit: Path) -> int:
    jobs = check_kit(kit) / "jobs"
    files = code_files()
    here = code_hash(files)
    vfile = kit / "code" / "VERSION"
    there = vfile.read_text().strip() if vfile.exists() else "none"
    same = there.split()[:1] == [here]
    print(f"kit {kit}\ncode there {there}; here {here}" + ("" if same else "  (differs: run sync)"))
    dirs = sorted(p for p in jobs.glob("*") if (p / "job.json").exists()) if jobs.is_dir() else []
    if not dirs:
        print("no jobs")
        return 0
    rows = [("id", "script", "slug", "by", "started", "state", "min", "collected")]
    for d in dirs:
        try:
            job = json.loads((d / "job.json").read_text())
        except (OSError, ValueError):
            job = {}
        st = job_state(d)
        mins = f"{(st['ended'] - st['started']) / 60:.1f}" if st["started"] else "-"
        state = st["state"]
        if state == "running" and time.time() - st["quiet_since"] > STALE_S:
            state = "stale?"
        rows.append((d.name, job.get("script", "?"), slug_of(job.get("argv", [])),
                     st["host"] if st["state"] != "waiting" else "waiting",
                     stamp(st["started"]), state, mins,
                     "yes" if (d / "collected.txt").exists() else "no"))
    w = [max(len(r[i]) for r in rows) for i in range(len(rows[0]))]
    for r in rows:
        print("  ".join(c.ljust(w[i]) for i, c in enumerate(r)).rstrip())
    return 0


def main() -> int:
    # the job's own arguments follow "--", untouched by this parser
    args_in = sys.argv[1:]
    job_argv: list[str] = []
    if "--" in args_in:
        i = args_in.index("--")
        args_in, job_argv = args_in[:i], args_in[i + 1:]

    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--kit", type=Path, default=None, help="default: SURROGATE_KIT, else <WINDCFD_KIT>/surrogate")
    needs = argparse.ArgumentParser(add_help=False)
    needs.add_argument("--needs", nargs="*", default=[], metavar="runs/<name>",
                       help="runs whose ckpt.pt and config.json the job reads")
    timeout = argparse.ArgumentParser(add_help=False)
    timeout.add_argument("--timeout", type=float, default=None, help="stop waiting after this many seconds (exit 2)")

    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("sync", parents=[common, needs], help="bring the kit's code and data up to date")
    for name in ("submit", "run"):
        p = sub.add_parser(name, parents=[common, needs] + ([timeout] if name == "run" else []),
                           help="write a job" + (", then wait for it" if name == "run" else ""))
        p.add_argument("script", help=" | ".join(SCRIPTS))
    p = sub.add_parser("wait", parents=[common, timeout], help="wait for a job and collect what it wrote")
    p.add_argument("id")
    sub.add_parser("status", parents=[common], help="the kit's jobs")

    args, extra = ap.parse_known_args(args_in)
    if extra:
        ap.error(f"unrecognized arguments: {' '.join(extra)}"
                 + (" (the script's own arguments go after --)" if args.cmd in ("submit", "run") else ""))
    if job_argv and args.cmd not in ("submit", "run"):
        ap.error("only submit and run take arguments after --")
    kit = args.kit or default_kit()

    if args.cmd == "sync":
        sync(kit, args.needs)
        return 0
    if args.cmd == "submit":
        submit(kit, args.script, job_argv, args.needs)
        return 0
    if args.cmd == "run":
        return run(args.script, job_argv, args.needs, kit, args.timeout)
    if args.cmd == "wait":
        return wait(kit, args.id, args.timeout)
    return status(kit)


if __name__ == "__main__":
    sys.exit(main())
