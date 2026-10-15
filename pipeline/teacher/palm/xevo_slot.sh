#!/usr/bin/env bash
# One of XEVO's two slot runners on the shared queue (docs/SCENT-TESTSET.md). From PowerShell:
#
#   Start-Process wsl.exe -WindowStyle Hidden -ArgumentList '-e','bash','/mnt/c/dev/huntapp/pipeline/teacher/palm/xevo_slot.sh','1'
#   (and '2')
#
# The mode (queue/mode-xevo: off | idle | on) decides what they take; palm_status.py --xevo sets it.
# Output: ~/palm/runner-xevo-<slot>.out, and queue/runner-xevo.log on the share.
export PALM_SHARE=/mnt/c/dev/huntapp/pipeline/raw/windcfd
export PALM_SLOTS=2
mkdir -p "$HOME/palm"
exec bash "$PALM_SHARE/surrogate/palm/bin/palm_runner.sh" xevo 7 "${1:-1}" >> "$HOME/palm/runner-xevo-${1:-1}.out" 2>&1
