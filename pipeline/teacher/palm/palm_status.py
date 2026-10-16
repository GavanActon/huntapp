"""What PALM is doing, in one look (docs/SCENT-TESTSET.md), and the switches. Any session runs it when
Gavan asks "what's PALM doing" or "put XEVO on PALM":

    py -3.14 pipeline/teacher/palm/palm_status.py                    # queue, each slot, the last results
    py -3.14 pipeline/teacher/palm/palm_status.py --xevo on          # off | idle | on | pause
    py -3.14 pipeline/teacher/palm/palm_status.py --xonix pause      # freeze PALM on xonix now; --xonix on resumes
    py -3.14 pipeline/teacher/palm/palm_status.py --quiet xonix "2026-10-16 09:00 12:30"   # frozen in that window
    py -3.14 pipeline/teacher/palm/palm_status.py --add "pickle-bogs_nw305_4m --name pickle-bogs_nw305_4m_scent" \
        --why "P8-P10 neutral" [--host xonix] [--order 050]

A job must name the test-set cell it fills (--why); a run that fills none needs Gavan's OK and the
word explore in --why.
"""

from __future__ import annotations

import argparse
import re
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
PIPE = HERE.parents[1]
Q = PIPE / "raw" / "windcfd" / "raw" / "teacher" / "palm" / "queue"
RUNS = [PIPE / "raw" / "windcfd" / "raw" / "teacher" / "palm" / "runs", PIPE / "raw" / "teacher" / "palm" / "runs"]
OLDQ = PIPE / "raw" / "teacher" / "palm" / "xevo-queue.txt"


def ago(p: Path) -> str:
    m = (time.time() - p.stat().st_mtime) / 60
    return f"{m:.0f} min ago" if m < 120 else f"{m / 60:.1f} h ago"


def show() -> None:
    print(f"queue {Q}")
    for host in ("xonix", "xevo"):
        mf = Q / f"mode-{host}"
        print(f"  mode {host}: {mf.read_text().strip() if mf.exists() else 'on (no mode file)'}")
        qf = Q / f"quiet-{host}"
        if qf.exists() and qf.read_text().strip():
            print(f"  quiet {host}: " + "; ".join(ln for ln in qf.read_text().splitlines() if ln.strip()))
    def pr(p: Path) -> str:
        m = re.search(r"^priority:\s*(\w+)", p.read_text(encoding="utf-8", errors="replace"), re.M)
        return m.group(1) if m else "validation"
    for part in ("taken", "todo"):
        jobs = sorted((Q / part).glob("*"), key=lambda p: p.name) if (Q / part).exists() else []
        print(f"  {part}: " + (", ".join(f"{p.name} [{pr(p)}]" for p in jobs) if jobs else "none"))
    for part in ("done", "failed"):
        jobs = sorted((Q / part).glob("*"), key=lambda p: p.stat().st_mtime)[-5:] if (Q / part).exists() else []
        print(f"  {part} (last 5): " + (", ".join(f"{p.name} ({ago(p)})" for p in jobs) if jobs else "none"))
    print("slots:")
    for s in sorted(Q.glob("status-*.txt")):
        lines = s.read_text(encoding="utf-8", errors="replace").splitlines()
        print(f"  {s.stem[7:]} (written {ago(s)}): {lines[0] if lines else ''}")
        for ln in lines[1:]:
            print(f"      {ln}")
    for log in sorted(Q.glob("runner-*.log")):
        tail = log.read_text(encoding="utf-8", errors="replace").splitlines()[-3:]
        print(f"  {log.name}:")
        for ln in tail:
            print(f"      {ln}")
    if OLDQ.exists() and any(ln.strip() and not ln.startswith("#") for ln in OLDQ.read_text().splitlines()):
        print(f"  the OLD XEVO queue still has lines: {OLDQ}")
    print("runs landed (last 6):")
    landed = [d for root in RUNS if root.exists() for d in root.iterdir() if (d / "DONE").exists()]
    for d in sorted(landed, key=lambda d: (d / "DONE").stat().st_mtime)[-6:]:
        post = (d / "OUTPUT" / ".post.json").exists()
        print(f"  {d.name}: DONE {ago(d / 'DONE')}, {'processed' if post else 'not processed yet'}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--xevo", choices=["off", "idle", "on", "pause"], help="XEVO's mode (pause also freezes a run going)")
    ap.add_argument("--xonix", choices=["off", "idle", "on", "pause"], help="xonix's mode (normally on; pause freezes a run going)")
    ap.add_argument("--quiet", nargs=2, metavar=("HOST", "WINDOW"), help='a quiet window: xonix "2026-10-16 09:00 12:30" (the machine\'s clock); PALM is frozen in it')
    ap.add_argument("--quiet-clear", metavar="HOST", help="drop every quiet window of this host")
    ap.add_argument("--add", help='a job: "<run> [run_case.sh options]"')
    ap.add_argument("--why", help="the test-set cell it fills (or 'explore: ...', with Gavan's OK)")
    ap.add_argument("--host", choices=["xonix", "xevo"], help="only this machine may take it")
    ap.add_argument("--order", default="", help="three digits; lower runs first within a priority (default: after the last)")
    ap.add_argument("--priority", choices=["product", "validation", "backfill", "explore"], default="validation",
                    help="with --add: product jumps the queue (and preempts on xonix), backfill/explore wait")
    ap.add_argument("--bump", nargs=2, metavar=("JOB", "PRIORITY"), help="re-prioritise a waiting job: a part of its name and the new priority")
    args = ap.parse_args()
    for host in ("xevo", "xonix"):
        v = getattr(args, host)
        if v:
            (Q / f"mode-{host}").write_text(v + "\n", encoding="utf-8", newline="\n")
            print(f"{host} mode -> {v}")
    if args.quiet:
        host, win = args.quiet
        if not re.fullmatch(r"\d{4}-\d\d-\d\d \d\d:\d\d \d\d:\d\d", win.strip()):
            raise SystemExit('--quiet: the window is "YYYY-MM-DD HH:MM HH:MM"')
        with open(Q / f"quiet-{host}", "a", encoding="utf-8", newline="\n") as fh:  # LF: bash reads it (a CR broke the window, 2026-10-15)
            fh.write(win.strip() + "\n")
        print(f"{host} quiet {win.strip()}")
    if args.quiet_clear:
        (Q / f"quiet-{args.quiet_clear}").unlink(missing_ok=True)
        print(f"{args.quiet_clear}: no quiet windows")
    if args.add:
        if not args.why:
            raise SystemExit("--why: name the test-set cell this run fills (no cell, no run)")
        run = args.add.split()[0]
        m = re.search(r"--name +(\S+)", args.add)
        name = m.group(1) if m else run
        nums = [int(p.name[:3]) for part in ("todo", "taken", "done", "failed") for p in (Q / part).glob("*") if p.name[:3].isdigit()]
        order = args.order or f"{(max(nums, default=0) // 10 + 1) * 10:03d}"
        body = args.add + "\n" + f"priority: {args.priority}\n" + (f"host: {args.host}\n" if args.host else "") + f"# why: {args.why}\n"
        (Q / "todo").mkdir(parents=True, exist_ok=True)
        (Q / "todo" / f"{order}-{name}.job").write_text(body, encoding="utf-8", newline="\n")  # LF: the runners are bash
        print(f"queued {order}-{name}.job")
    if args.bump:
        part, pr = args.bump
        if pr not in ("product", "validation", "backfill", "explore"):
            raise SystemExit("--bump: product, validation, backfill or explore")
        hits = [p for p in (Q / "todo").glob("*.job") if part in p.name]
        if len(hits) != 1:
            raise SystemExit(f"--bump: {len(hits)} waiting jobs match {part!r}")
        lines = [ln for ln in hits[0].read_text(encoding="utf-8").splitlines() if not ln.startswith("priority:")]
        hits[0].write_text("\n".join(lines[:1] + [f"priority: {pr}"] + lines[1:]) + "\n", encoding="utf-8", newline="\n")
        print(f"{hits[0].name} -> {pr}")
    show()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
