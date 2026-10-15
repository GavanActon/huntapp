#!/usr/bin/env bash
# The PALM service's runner (docs/SCENT-TESTSET.md; v0 2026-10-15, modes and status the same day). One
# per slot, started once and left running; it takes jobs from the queue folder on the share:
#
#   <queue>/todo/<order>-<name>.job   one line: "<run> [run_case.sh options]"; optional lines
#                                     "host: xonix" (only that machine) and "# why: <test-set cell>"
#   <queue>/taken/<job>.<host>        claimed by a rename, so two runners never take the same job
#   <queue>/done/, <queue>/failed/    afterwards; the run's own log is <queue>/log-<job>.txt
#   <queue>/mode-<host>               off | idle | on (no file: on). idle takes one run at a time, and
#                                     only when Windows' CPU has averaged under PALM_IDLE_CPU % (25)
#                                     for 15 min on mains power; on takes up to PALM_SLOTS runs
#   <queue>/status-<host>-<slot>.txt  what this slot is doing, rewritten every minute
#
#   bash /mnt/z/surrogate/palm/bin/palm_runner.sh xonix 22                    # xonix: one slot, always on
#   PALM_SHARE=/mnt/c/dev/huntapp/pipeline/raw/windcfd PALM_SLOTS=2 \
#     bash .../palm_runner.sh xevo 7 1                                         # XEVO slot 1 (xevo_start.sh)
#
# Each job runs from a fresh local copy of bin/ (run_case.sh, ship_run.sh), so nothing is read off the
# share while PALM runs and bin/ can be updated between jobs. Runs ship lean (ship_run.sh). Stop:
# touch <queue>/stop-<host> (each slot finishes the run in hand first).
set -uo pipefail
{
HOSTID="${1:?usage: palm_runner.sh <host> [cores] [slot]}"
CORES="${2:-$(nproc)}"
SLOT="${3:-1}"
SHARE="${PALM_SHARE:-/mnt/z}"
KIT="${PALM_KIT:-$SHARE/surrogate/palm}"
Q="$SHARE/raw/teacher/palm/queue"
SLOTS="${PALM_SLOTS:-1}"
mkdir -p "$Q/todo" "$Q/taken" "$Q/done" "$Q/failed" "$HOME/palm"
STATUS="$Q/status-$HOSTID-$SLOT.txt"
say() { local l="== $(date -Is) $HOSTID/$SLOT: $*"; echo "$l"; echo "$l" >> "$Q/runner-$HOSTID.log" 2>/dev/null; }
status() { printf '%s\n' "$(date -Is) $HOSTID slot $SLOT, mode $(mode): $*" \
  "palm runs here: $(pgrep -fc "${PALM_BUSY:-palmrun -r}" 2>/dev/null)" "load: $(cut -d' ' -f1-3 /proc/loadavg)" > "$STATUS" 2>/dev/null; }
mode() { local m; m=$(tr -d '[:space:]' < "$Q/mode-$HOSTID" 2>/dev/null); echo "${m:-on}"; }

CPU=()   # Windows' CPU %, one sample a loop (2 min): the last 8 make the 15-min average
win_ok() {  # idle mode: Windows quiet for 15 min and on mains power
  command -v powershell.exe >/dev/null 2>&1 || return 0
  local c ac
  c=$(powershell.exe -NoProfile -Command '[int](Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average' 2>/dev/null | tr -dc '0-9')
  ac=$(powershell.exe -NoProfile -Command '$b = Get-CimInstance Win32_Battery; if (-not $b -or $b.BatteryStatus -eq 2) { 1 } else { 0 }' 2>/dev/null | tr -dc '0-9')
  CPU+=("${c:-100}"); (( ${#CPU[@]} > 8 )) && CPU=("${CPU[@]: -8}")
  local s=0 n=${#CPU[@]}; for v in "${CPU[@]}"; do s=$((s + v)); done
  (( n >= 8 && s / n < ${PALM_IDLE_CPU:-25} )) && [[ "${ac:-1}" == 1 ]]
}

say "runner up: $CORES cores, slot $SLOT of $SLOTS, queue $Q, kit $KIT"
while [[ ! -e "$Q/stop-$HOSTID" ]]; do
  m=$(mode)
  case "$m" in
    off) status "off: takes nothing new"; CPU=(); sleep 120; continue ;;
    idle) max=1 ;;
    *) max=$SLOTS ;;
  esac
  if [[ "$m" == idle ]] && ! win_ok; then status "idle: waiting for a quiet Windows (cpu ${CPU[*]})"; sleep 120; continue; fi
  # claim under a local lock, so two slots on one machine count the runs going before either starts one.
  # The pattern goes in by the environment: on a command line pgrep -f would count this very process.
  job=$(
    BUSY_PAT="${PALM_BUSY:-palmrun -r}" flock "$HOME/palm/.claim.lock" bash -c '
      Q="$1"; HOSTID="$2"; max="$3"
      (( $(pgrep -fc "$BUSY_PAT") < max )) || exit 0
      for f in $(ls "$Q/todo" 2>/dev/null | grep "\.job$" | sort); do
        h=$(grep -m1 -E "^host:" "$Q/todo/$f" 2>/dev/null | awk "{print \$2}")
        [[ -z "$h" || "$h" == "$HOSTID" ]] || continue
        mv "$Q/todo/$f" "$Q/taken/$f.$HOSTID" 2>/dev/null && { echo "$f"; exit 0; }
      done' _ "$Q" "$HOSTID" "$max")
  if [[ -z "$job" ]]; then status "waiting ($m, at most $max PALM runs here)"; sleep 120; continue; fi
  args=$(grep -v -E '^[[:space:]]*(#|host:|$)' "$Q/taken/$job.$HOSTID" | head -1)
  bin="$HOME/palm/bin.$HOSTID.$SLOT"
  rm -rf "$bin" && mkdir -p "$bin" && cp "${PALM_BIN:-$KIT/bin}/"*.sh "$bin/" \
    || { say "cannot copy bin (the link?)"; mv "$Q/taken/$job.$HOSTID" "$Q/todo/$job"; sleep 300; continue; }
  say "takes $job: $args"
  log="$HOME/palm/log-${job%.job}.txt"
  # shellcheck disable=SC2086
  bash "$bin/run_case.sh" $args --cores "$CORES" --here "$KIT" --ship lean > "$log" 2>&1 &
  pid=$!
  t0=$(date +%s)
  while kill -0 "$pid" 2>/dev/null; do
    status "running $job for $(( ($(date +%s) - t0) / 60 )) min; $(tail -1 "$log" 2>/dev/null | cut -c1-160)"
    cp "$log" "$Q/" 2>/dev/null
    sleep 60
  done
  wait "$pid"; s=$?
  # PALM finished but the shipping broke off (the link): try again every 10 min for 2 h, not run again
  run=${args%% *}; name=$(grep -oE -- '--name +[^ ]+' <<< "$args" | awk '{print $2}'); name=${name:-$run}
  case_=${run%%_*}; tag=${run#"$case_"_}; tag2=${tag#*_}; [[ "$tag2" == "$tag" ]] && tag2=""
  for try in 1 2 3 4 5 6 7 8 9 10 11 12; do
    [[ $s == 0 ]] && break
    ls "$HOME/palm/v25.10.1/JOBS/$name/MONITORING/"*_cpu* >/dev/null 2>&1 || break
    say "$name ran but did not ship ($s); shipping again in 10 min (try $try)"
    status "shipping $name again (try $try)"
    sleep 600
    bash "$bin/ship_run.sh" "$name" --case "$case_" --run "$run" --tag "$tag2" --here "$KIT" >> "$log" 2>&1
    s=$?
  done
  cp "$log" "$Q/" 2>/dev/null
  if [[ $s == 0 ]]; then
    mv "$Q/taken/$job.$HOSTID" "$Q/done/$job"; say "done $job"
  else
    mv "$Q/taken/$job.$HOSTID" "$Q/failed/$job"; say "FAILED $job ($s; log-${job%.job}.txt)"
  fi
done
status "stopped (stop-$HOSTID)"
say "stopped (stop-$HOSTID)"
exit
}
