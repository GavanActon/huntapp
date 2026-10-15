#!/usr/bin/env bash
# xonix's runners on the shared queue (docs/SCENT-TESTSET.md). Paste once in a new Ubuntu tab and leave
# the tab open (it shows the runners' log):
#
#   bash /mnt/z/surrogate/palm/xonix-start.sh
#
# Safe to run again at any time: it retires any runner already here without stopping the job in hand
# (that job runs to its end and is filed done or failed afterwards), then starts three slots:
#   1        PALM runs and CPU jobs, 22 cores (18 once SD tiles share the machine)
#   product  product jobs only; freezes a lower-priority job here while one runs (preemption)
#   gpu      jobs that need the GPU (SD tile batches), 4 cores
# The first time (2026-10-15) it also retired the old chains and the sweeper and shipped the stranded
# bogs runs (ship_today.sh). Pause: palm_status.py --xonix pause, a quiet window, or touch ~/palm/PAUSE.
set -uo pipefail
{
SHARE=/mnt/z
KIT=$SHARE/surrogate/palm
Q=$SHARE/raw/teacher/palm/queue
[[ -d "$KIT/bin" ]] || { echo "no $KIT/bin: mount the share first (sudo mount -t drvfs Z: /mnt/z)"; exit 1; }
mkdir -p "$HOME/palm"
BIN="$HOME/palm/bin.start"
rm -rf "$BIN" && mkdir -p "$BIN" && cp "$KIT/bin/"*.sh "$BIN/" || { echo "cannot copy $KIT/bin"; exit 1; }

# the old chains and the sweeper, if any are left
pkill -f pickle-rules2-chain.sh && echo "== the old chain is stopped"
pkill -f xonix-sweeper.sh && echo "== the old sweeper is stopped"
pkill -f "rsync -r --size-only --append-verify" 2>/dev/null

# runners already here: stop the runner processes only; their jobs carry on and are adopted below
old=$(pgrep -f "bin/palm_runner.sh xonix" || true)
if [[ -n "$old" ]]; then
  kill $old 2>/dev/null && echo "== retired the runner(s) here: $old (their jobs carry on)"
  for t in "$Q/taken/"*.xonix; do
    [[ -e "$t" ]] || continue
    job=$(basename "$t" .xonix); args=$(grep -v -E '^[[:space:]]*(#|[a-z]+:|$)' "$t" | head -1)
    run=${args%% *}; name=$(grep -oE -- '--name +[^ ]+' <<< "$args" | awk '{print $2}'); name=${name:-$run}
    pid=$(pgrep -f "run_case.sh $run" | head -1)
    if [[ -z "$pid" ]]; then mv "$t" "$Q/todo/$job" && echo "== $job had no run going: back to todo"; continue; fi
    echo "== adopting $job (run_case $pid): filed when it ends"
    nohup bash -c "while kill -0 $pid 2>/dev/null; do sleep 60; done
      if [[ -e '$SHARE/raw/teacher/palm/runs/$name/DONE' ]]; then mv '$t' '$Q/done/$job'; else mv '$t' '$Q/failed/$job'; fi
      echo \"== \$(date -Is) xonix/adopt: filed $job\" >> '$Q/runner-xonix.log'" > /dev/null 2>&1 &
  done
fi

# first run only (2026-10-15): the stranded bogs runs and the 2 m strip ship lean
if [[ ! -e "$HOME/palm/.shipped-today" ]]; then
  touch "$HOME/palm/.shipped-today"
  nohup bash "$BIN/ship_today.sh" "$KIT" > "$HOME/palm/ship-today.log" 2>&1 &
fi

rm -f "$Q/stop-xonix"
cd "$HOME/palm" || exit 1
nohup bash "$KIT/bin/palm_runner.sh" xonix 22 1 >> "$HOME/palm/runner-xonix-1.out" 2>&1 &
PALM_ONLY=product PALM_PREEMPT=1 nohup bash "$KIT/bin/palm_runner.sh" xonix 22 product >> "$HOME/palm/runner-xonix-product.out" 2>&1 &
PALM_KIND=gpu nohup bash "$KIT/bin/palm_runner.sh" xonix 4 gpu >> "$HOME/palm/runner-xonix-gpu.out" 2>&1 &
sleep 3
echo "== three slots up; leave this tab open. The runners' log (the runners carry on if this view stops):"
# the share drops now and then ("Input/output error", 2026-10-15): the view picks up again
while :; do tail -n 20 -F "$Q/runner-xonix.log" 2>/dev/null; sleep 15; done
}
