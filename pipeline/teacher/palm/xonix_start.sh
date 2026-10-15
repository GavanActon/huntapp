#!/usr/bin/env bash
# xonix, 2026-10-15: from the old chains to the runner (docs/SCENT-TESTSET.md). Paste once in a new
# Ubuntu tab and leave the tab open:
#
#   bash /mnt/z/surrogate/palm/xonix-start.sh
#
# 1. the old rules2 chain stops, so nothing follows the run in hand (the 2 m strip carries on);
# 2. the old sweeper and its slow rsync stop;
# 3. in the background: the two stranded bogs runs ship lean, then the 2 m strip ships lean the
#    moment its PALM ends (its own slow copy step is stopped); log ~/palm/ship-today.log;
# 4. the runner takes over in this tab: the scent test set's jobs from the queue on the share.
set -uo pipefail
{
KIT=/mnt/z/surrogate/palm
[[ -d "$KIT/bin" ]] || { echo "no $KIT/bin: mount the share first (sudo mount -t drvfs Z: /mnt/z)"; exit 1; }
BIN="$HOME/palm/bin.start"
rm -rf "$BIN" && mkdir -p "$BIN" && cp "$KIT/bin/"*.sh "$BIN/" || { echo "cannot copy $KIT/bin"; exit 1; }

pkill -f pickle-rules2-chain.sh && echo "== the old chain is stopped; the run in hand carries on"
pkill -f xonix-sweeper.sh && echo "== the old sweeper is stopped"
pkill -f "rsync -r --size-only --append-verify" 2>/dev/null

nohup bash "$BIN/ship_today.sh" "$KIT" > "$HOME/palm/ship-today.log" 2>&1 &
echo "== shipping in the background: tail -f ~/palm/ship-today.log"

exec bash "$KIT/bin/palm_runner.sh" xonix 22
}
