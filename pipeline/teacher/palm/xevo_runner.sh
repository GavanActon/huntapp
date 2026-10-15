#!/usr/bin/env bash
# XEVO's PALM queue runner (2026-10-14). Takes the first line of
# pipeline/raw/teacher/palm/xevo-queue.txt (a run name and run_case.sh options, e.g.
# "pickle-slot_w270_4m --name pickle-slot_w270_4m_scent"), runs it, and takes the next.
# Two of these run at once with 7 ranks each (PALM stops scaling at about 8 ranks here, so
# two runs keep the CPU near full); an empty queue is polled every 2 minutes, so either
# thread can append work at any time. Lines starting with # are skipped.
#
#   wsl -e bash /mnt/c/dev/huntapp/pipeline/teacher/palm/xevo_runner.sh A 7
#
# Each run executes a private copy of run_case.sh next to it (bash reads a running script
# by offset, so editing run_case.sh under a running run corrupts its last steps).
# Log: pipeline/raw/teacher/palm/xevo-queue.log. Stop: create xevo-queue.stop (a runner
# finishes its current run first).
set -u
ID="${1:-A}"
CORES="${2:-7}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
Q="$HERE/../../raw/teacher/palm/xevo-queue.txt"
LOG="$HERE/../../raw/teacher/palm/xevo-queue.log"
STOP="$HERE/../../raw/teacher/palm/xevo-queue.stop"
touch "$Q"
while [[ ! -e "$STOP" ]]; do
  line=$(flock "$Q.lock" bash -c '
    q="$1"
    l=$(grep -m1 -v -E "^[[:space:]]*(#|$)" "$q" || true)
    if [[ -n "$l" ]]; then
      n=$(grep -n -m1 -x -F "$l" "$q" | cut -d: -f1)
      sed -i "${n}d" "$q"
      echo "$l"
    fi' _ "$Q")
  if [[ -z "$line" ]]; then sleep 120; continue; fi
  echo "== $(date -Is) runner $ID takes: $line" >> "$LOG"
  tmp="$HERE/.run_case_${ID}_$$.sh"
  cp "$HERE/run_case.sh" "$tmp"
  # shellcheck disable=SC2086
  if bash "$tmp" $line --cores "$CORES" >> "$LOG.$ID" 2>&1; then
    echo "== $(date -Is) runner $ID done: $line" >> "$LOG"
  else
    echo "== $(date -Is) runner $ID FAILED: $line (see xevo-queue.log.$ID)" >> "$LOG"
  fi
  rm -f "$tmp"
done
echo "== $(date -Is) runner $ID stopped (xevo-queue.stop)" >> "$LOG"
