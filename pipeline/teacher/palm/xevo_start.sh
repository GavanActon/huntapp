#!/usr/bin/env bash
# XEVO joins the one queue (docs/SCENT-TESTSET.md; 2026-10-15). Run once in WSL on XEVO:
#
#   bash pipeline/teacher/palm/xevo_start.sh
#
# 1. the old queue file's waiting lines become jobs in the queue folder, and the old runners
#    (xevo_runner.sh A and B) stop after the runs in hand (xevo-queue.stop);
# 2. XEVO's mode starts at idle unless one is set (queue/mode-xevo: off | idle | on);
# 3. the two slot runners are started by PowerShell (Start-Process wsl.exe, one per slot), see
#    the end of this script's output for the lines.
set -uo pipefail
{
P=/mnt/c/dev/huntapp/pipeline
OLD=$P/raw/teacher/palm
Q=$P/raw/windcfd/raw/teacher/palm/queue
mkdir -p "$Q/todo"
flock "$OLD/xevo-queue.txt.lock" bash -c '
  OLD="$1"; Q="$2"; n=40
  grep -v -E "^[[:space:]]*(#|$)" "$OLD/xevo-queue.txt" 2>/dev/null | while read -r line; do
    name=$(grep -oE -- "--name +[^ ]+" <<< "$line" | awk "{print \$2}"); name=${name:-${line%% *}}
    printf "%s\n%s\n" "$line" "# why: moved from the old XEVO queue, 2026-10-15" > "$Q/todo/0${n}-${name}.job"
    echo "moved: $line"; n=$((n + 1))
  done
  : > "$OLD/xevo-queue.txt"' _ "$OLD" "$Q"
touch "$OLD/xevo-queue.stop"
echo "old runners: stop after the runs in hand ($OLD/xevo-queue.stop)"
[[ -s "$Q/mode-xevo" ]] || echo idle > "$Q/mode-xevo"
echo "XEVO mode: $(cat "$Q/mode-xevo")"
exit
}
