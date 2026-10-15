#!/usr/bin/env bash
# xonix, 2026-10-15 (xonix_start.sh runs this in the background; log ~/palm/ship-today.log): the two
# bogs runs whose copy step was lost ship lean, then the 2 m strip ships lean the moment its PALM ends,
# its old run_case.sh's slow copy over /mnt/z stopped first. A file of its own, not bash -c: pgrep -f
# would find the pattern in a bash -c command line and wait on itself.
set -uo pipefail
{
KIT="${1:-/mnt/z/surrogate/palm}"
BIN="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bash "$BIN/ship_run.sh" pickle-bogs_dawn175_4m --case pickle-bogs --run pickle-bogs_dawn175_4m --tag 4m --here "$KIT"
bash "$BIN/ship_run.sh" pickle-bogs_dusk288_4m --case pickle-bogs --run pickle-bogs_dusk288_4m --tag 4m --here "$KIT"
echo "== $(date -Is) waiting for the 2 m strip's PALM to end"
while pgrep -f "palmrun -r pickle-bogstrip_b190_2m" >/dev/null; do sleep 60; done
pid=$(pgrep -f "run_case.sh pickle-bogstrip_b190_2m" | head -1)
if [[ -n "$pid" ]]; then pkill -P "$pid"; kill "$pid"; echo "== its old copy step stopped"; fi
for try in 1 2 3 4 5 6; do
  bash "$BIN/ship_run.sh" pickle-bogstrip_b190_2m --case pickle-bogstrip --run pickle-bogstrip_b190_2m --tag 2m --here "$KIT" && break
  sleep 600
done
echo "== $(date -Is) shipping done"
exit
}
