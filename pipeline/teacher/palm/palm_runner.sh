#!/usr/bin/env bash
# The compute service's runner (docs/SCENT-TESTSET.md; v0 2026-10-15, modes and status, then priorities,
# GPU slots and preemption the same day). One process per slot, started once and left running; it takes
# jobs from the queue folder on the share:
#
#   <queue>/todo/<order>-<name>.job   the first plain line: "<run> [run_case.sh options]" (a PALM run), or a
#                                     "cmd: <bash command>" line for any other job; optional lines
#                                       priority: product | validation | backfill | explore   (validation)
#                                       host: xonix        only that machine
#                                       needs: gpu         only a GPU slot takes it (no GPU slot: never)
#                                       pause-file: <path> a cmd job that pauses itself by a file (a Windows
#                                                          process, e.g. the SD bake's PAUSE): made and removed
#                                                          instead of freezing the job
#                                       # why: <the test-set cell or the product reason>
#   <queue>/taken/<job>.<host>        claimed by a rename, so two runners never take the same job
#   <queue>/done/, <queue>/failed/    afterwards; the job's own log is <queue>/log-<job>.txt
#   <queue>/mode-<host>               off | idle | on | pause (no file: on). idle takes one run at a time and
#                                     only when Windows' CPU has averaged under PALM_IDLE_CPU % (25) for 15
#                                     min on mains power; on takes up to PALM_SLOTS PALM runs. pause, a window
#                                     in <queue>/quiet-<host> or ~/palm/PAUSE freeze what runs (pause_lib.sh)
#   <queue>/hold-<job>                freezes that one job (written by a product slot that preempts it)
#   <queue>/status-<host>-<slot>.txt  what this slot is doing, rewritten every minute
#
# A slot is PALM_KIND=cpu (PALM runs and cpu cmd jobs; the default) or gpu (needs: gpu jobs only).
# PALM_MODE gives one slot its own mode under the machine's (XEVO's GPU slot: idle, so tiles bake only
# while XEVO is quiet); the machine's off and pause still win.
# PALM_ONLY=product makes a slot take product jobs only, and PALM_PREEMPT=1 lets it start one while
# the machine is full: it holds (freezes) the lower-priority jobs running here, and lets them go after.
#
#   bash /mnt/z/surrogate/palm/bin/palm_runner.sh xonix 18 1                         # xonix's PALM slot
#   PALM_KIND=gpu bash .../palm_runner.sh xonix 4 gpu                                # xonix's GPU slot
#   PALM_ONLY=product PALM_PREEMPT=1 bash .../palm_runner.sh xonix 18 product        # xonix's product slot
#   (xonix_start.sh starts all three; xevo_slot.sh XEVO's one)
#
# Each job runs from a fresh local copy of bin/ (run_case.sh, ship_run.sh, pause_lib.sh), so nothing is
# read off the share while it runs and bin/ can be updated between jobs. PALM runs ship lean. Stop:
# touch <queue>/stop-<host> (each slot finishes the job in hand first).
set -uo pipefail
{
HOSTID="${1:?usage: palm_runner.sh <host> [cores] [slot]}"
CORES="${2:-$(nproc)}"
SLOT="${3:-1}"
SHARE="${PALM_SHARE:-/mnt/z}"
KIT="${PALM_KIT:-$SHARE/surrogate/palm}"
Q="$SHARE/raw/teacher/palm/queue"
SLOTS="${PALM_SLOTS:-1}"
KIND="${PALM_KIND:-cpu}"
ONLY="${PALM_ONLY:-}"
PREEMPT="${PALM_PREEMPT:-0}"
mkdir -p "$Q/todo" "$Q/taken" "$Q/done" "$Q/failed" "$HOME/palm"
STATUS="$Q/status-$HOSTID-$SLOT.txt"
say() { local l="== $(date -Is) $HOSTID/$SLOT: $*"; echo "$l"; echo "$l" >> "$Q/runner-$HOSTID.log" 2>/dev/null; }
status() { printf '%s\n' "$(date -Is) $HOSTID slot $SLOT ($KIND${ONLY:+, $ONLY only}), mode $(mode): $*" \
  "palm runs here: $(pgrep -fc "${PALM_BUSY:-palmrun -r}" 2>/dev/null)" "load: $(cut -d' ' -f1-3 /proc/loadavg)" > "$STATUS" 2>/dev/null; }
mode() {  # the machine's mode, or this slot's own (PALM_MODE) unless the machine is off or paused
  local m; m=$(tr -d '[:space:]' 2>/dev/null < "$Q/mode-$HOSTID"); m="${m:-on}"
  [[ -n "${PALM_MODE:-}" && "$m" != off && "$m" != pause ]] && m="$PALM_MODE"
  echo "$m"
}
prio() { local p; p=$(tr -d '\r' < "$1" 2>/dev/null | grep -m1 -E '^priority:' | awk '{print $2}'); echo "${p:-validation}"; }
rank() { case "$1" in product) echo 0 ;; validation) echo 1 ;; backfill) echo 2 ;; explore) echo 3 ;; *) echo 1 ;; esac; }

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

# pause / quiet windows (pause_lib.sh): no new job while paused; a job going is frozen
# shellcheck disable=SC1091
source "${PALM_BIN:-$KIT/bin}/pause_lib.sh" 2>/dev/null || palm_should_pause() { return 1; }

# the next job for this slot, best priority first, claimed under a local lock so two slots on one machine
# count the PALM runs going before either starts one (the pattern goes in by the environment: on a command
# line pgrep -f would count this very process)
claim() {
  BUSY_PAT="${PALM_BUSY:-palmrun -r}" KIND="$KIND" ONLY="$ONLY" PREEMPT="$PREEMPT" \
  flock "$HOME/palm/.claim.lock" bash -c '
    Q="$1"; H="$2"; max="$3"
    if [[ "$KIND" == cpu && "$PREEMPT" != 1 ]]; then (( $(pgrep -fc "$BUSY_PAT") < max )) || exit 0; fi
    for f in $(ls "$Q/todo" 2>/dev/null | grep "\.job$"); do
      p=$(tr -d "\r" < "$Q/todo/$f" 2>/dev/null | grep -m1 -E "^priority:" | awk "{print \$2}"); p=${p:-validation}
      case "$p" in product) r=0 ;; validation) r=1 ;; backfill) r=2 ;; explore) r=3 ;; *) r=1 ;; esac
      echo "$r $p $f"
    done | sort -k1,1n -k3,3 | while read -r r p f; do
      [[ -z "$ONLY" || "$p" == "$ONLY" ]] || continue
      h=$(tr -d "\r" < "$Q/todo/$f" 2>/dev/null | grep -m1 -E "^host:" | awk "{print \$2}")
      [[ -z "$h" || "$h" == "$H" ]] || continue
      if grep -q -E "^needs:.*gpu" "$Q/todo/$f" 2>/dev/null; then [[ "$KIND" == gpu ]] || continue; else [[ "$KIND" == cpu ]] || continue; fi
      mv "$Q/todo/$f" "$Q/taken/$f.$H" 2>/dev/null && { echo "$f"; exit 0; }
    done' _ "$Q" "$HOSTID" "$1"
}

# freeze or free a cmd job's process group by pause / quiet / hold (PALM runs do this in run_case.sh)
watch_cmd() {  # $1 pid (its own process group), $2 the job's stem, $3 its pause file (none: freeze)
  local held=0 pf="${3:-}"
  while kill -0 "$1" 2>/dev/null; do
    if palm_should_pause "$Q" "$HOSTID" || [[ -e "$Q/hold-$2" ]]; then
      if [[ $held == 0 ]]; then
        if [[ -n "$pf" ]]; then touch "$pf" && { held=1; say "paused $2 ($pf)"; }
        else kill -STOP -- "-$1" 2>/dev/null && { held=1; say "froze $2"; }; fi
      fi
    elif [[ $held == 1 ]]; then
      if [[ -n "$pf" ]]; then rm -f "$pf"; else kill -CONT -- "-$1" 2>/dev/null; fi
      held=0; say "let $2 go on"
    fi
    sleep "${PALM_PAUSE_POLL:-30}"
  done
}

say "runner up: $CORES cores, slot $SLOT ($KIND${ONLY:+, $ONLY only}${PREEMPT:+, preempt $PREEMPT}), queue $Q, kit $KIT"
while [[ ! -e "$Q/stop-$HOSTID" ]]; do
  if palm_should_pause "$Q" "$HOSTID"; then status "paused (mode pause, a quiet window or ~/palm/PAUSE)"; CPU=(); sleep 60; continue; fi
  m=$(mode)
  case "$m" in
    off) status "off: takes nothing new"; CPU=(); sleep 120; continue ;;
    idle) max=1 ;;
    *) max=$SLOTS ;;
  esac
  if [[ "$m" == idle && "$ONLY" != product ]] && ! win_ok; then status "idle: waiting for a quiet Windows (cpu ${CPU[*]})"; sleep 120; continue; fi
  job=$(claim "$max")
  if [[ -z "$job" ]]; then status "waiting ($m, at most $max PALM runs here)"; sleep "${PALM_POLL:-120}"; continue; fi
  stem="${job%.job}"
  jf="$Q/taken/$job.$HOSTID"
  pr=$(prio "$jf")
  bin="$HOME/palm/bin.$HOSTID.$SLOT"
  rm -rf "$bin" && mkdir -p "$bin" && cp "${PALM_BIN:-$KIT/bin}/"*.sh "$bin/" \
    || { say "cannot copy bin (the link?)"; mv "$jf" "$Q/todo/$job"; sleep 300; continue; }
  # a product slot holds the lower-priority jobs running on this machine while its job runs
  held=()
  if [[ "$PREEMPT" == 1 ]]; then
    for t in "$Q/taken/"*".$HOSTID"; do
      [[ -e "$t" && "$t" != "$jf" ]] || continue
      (( $(rank "$(prio "$t")") > $(rank "$pr") )) || continue
      ts=$(basename "$t" ".$HOSTID"); ts="${ts%.job}"
      touch "$Q/hold-$ts" && held+=("$ts") && say "holds $ts for $stem"
    done
  fi
  log="$HOME/palm/log-$stem.txt"
  cmd=$(tr -d '\r' < "$jf" | grep -m1 -E '^cmd:' | sed -E 's/^cmd:[[:space:]]*//')   # a CR from Windows would break the job
  if [[ -n "$cmd" ]]; then
    say "takes $job ($pr): cmd: $cmd"
    mkdir -p "$HOME/palm/work/$stem"
    ( cd "$HOME/palm/work/$stem" && PALM_JOB="$stem" PALM_HOST="$HOSTID" PALM_SHARE="$SHARE" PALM_CORES="$CORES" \
        exec setsid bash -c "$cmd" ) > "$log" 2>&1 &
    pid=$!
    pfile=$(tr -d '\r' < "$jf" | grep -m1 -E '^pause-file:' | sed -E 's/^pause-file:[[:space:]]*//')
    watch_cmd "$pid" "$stem" "$pfile" &
    wpid=$!
  else
    args=$(tr -d '\r' < "$jf" | grep -v -E '^[[:space:]]*(#|[a-z]+:|$)' | head -1)
    say "takes $job ($pr): $args"
    # shellcheck disable=SC2086
    PALM_HOST="$HOSTID" PALM_JOB="$stem" bash "$bin/run_case.sh" $args --cores "$CORES" --here "$KIT" --ship lean > "$log" 2>&1 &
    pid=$!
    wpid=""
  fi
  t0=$(date +%s)
  while kill -0 "$pid" 2>/dev/null; do
    status "running $job ($pr) for $(( ($(date +%s) - t0) / 60 )) min; $(tail -1 "$log" 2>/dev/null | cut -c1-160)"
    cp "$log" "$Q/" 2>/dev/null
    sleep 60
  done
  wait "$pid"; s=$?
  [[ -n "$wpid" ]] && kill "$wpid" 2>/dev/null
  if [[ -z "$cmd" ]]; then
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
  fi
  for ts in "${held[@]}"; do rm -f "$Q/hold-$ts" && say "lets $ts go on"; done
  cp "$log" "$Q/" 2>/dev/null
  if [[ $s == 0 ]]; then
    mv "$jf" "$Q/done/$job"; say "done $job"
  else
    mv "$jf" "$Q/failed/$job"; say "FAILED $job ($s; log-$stem.txt)"
  fi
done
status "stopped (stop-$HOSTID)"
say "stopped (stop-$HOSTID)"
exit
}
