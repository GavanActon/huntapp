#!/usr/bin/env bash
# The kit on the share is what every runner runs (docs/SCENT-TESTSET.md): after editing the scripts or
# building a case here, send them there. Run in WSL on XEVO:
#
#   bash pipeline/teacher/palm/sync_kit.sh                    # the runner's scripts only
#   bash pipeline/teacher/palm/sync_kit.sh pickle-bogstrip    # and that case's builds (case*.json, grid*.npz, JOBS/*/INPUT)
#
# A runner copies bin/ and a run's INPUT to its own disk when it takes a job, so syncing while runs
# are going is safe. Never the old surrogate/palm/run_case.sh: an old chain on xonix may still read it.
set -euo pipefail
{
R="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
K="${PALM_KIT:-/mnt/c/dev/huntapp/pipeline/raw/windcfd/surrogate/palm}"
mkdir -p "$K/bin"
cp "$R/run_case.sh" "$R/ship_run.sh" "$R/palm_runner.sh" "$R/ship_today.sh" "$R/pause_lib.sh" "$K/bin/"
cp "$R/xonix_start.sh" "$K/xonix-start.sh"
cp "$R/palm_to_scent.py" "$K/palm_to_scent.py"
echo "scripts -> $K/bin"
for c in "$@"; do
  [[ -d "$R/$c/JOBS" ]] || { echo "no builds for $c in $R/$c"; exit 1; }
  mkdir -p "$K/$c"
  cp "$R/$c"/case*.json "$K/$c/"
  cp "$R/$c"/grid*.npz "$K/$c/" 2>/dev/null || true
  for j in "$R/$c/JOBS"/*/; do
    n=$(basename "$j")
    [[ -d "$j/INPUT" ]] || continue
    mkdir -p "$K/$c/JOBS/$n/INPUT"
    cp "$j/INPUT/"* "$K/$c/JOBS/$n/INPUT/"
  done
  echo "$c -> $K/$c ($(ls "$R/$c/JOBS" | wc -l) runs)"
done
exit
}
