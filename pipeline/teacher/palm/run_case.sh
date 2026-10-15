#!/usr/bin/env bash
# Run one run of a case built by build_case.py under WSL2 (XEVO or xonix),
# then copy its OUTPUT and MONITORING home to pipeline/raw/teacher/palm/runs/.
#
#   bash run_case.sh searchmont_stable                    # all cores
#   bash run_case.sh searchmont_stable --cores 22
#   bash run_case.sh searchmont_stable --end 120 --name timing10   # a timing test: 120 s of model time
#
# Needs PALM built by install-palm.sh (its palm-env.sh). On xonix, stop the
# WindNinja runners first: PALM is memory-bandwidth bound and shares badly.
# A run that stops (power, Windows update) restarts from scratch; for runs
# over ~6 h, add restarts (palmrun -a "d3# restart", see README.md).
set -euo pipefail
# The whole body in one block, so bash parses the file before it runs a line: a run of many hours
# reads nothing more from this file afterwards, so an SMB handle gone stale (xonix lost
# pickle-bogs_dawn175_4m's copy step to one, 2026-10-15) or an edit made mid-run cannot hurt it.
{

RUN="${1:?usage: run_case.sh <case>_<run>[_tag] [--cores N] [--end seconds] [--name name] [--prefix dir] [--here kit] [--ship copy|lean]}"
shift
CORES=$(nproc)
PREFIX="$HOME/palm/v25.10.1"
END=""
NAME=""
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN="$HERE"
SHIP=copy
while [[ $# -gt 0 ]]; do
  case "$1" in
    --cores) CORES="$2"; shift ;;
    --end) END="$2"; shift ;;
    --name) NAME="$2"; shift ;;
    --prefix) PREFIX="$2"; shift ;;
    # the kit (the cases' folders; output goes two folders up) when this script runs from a local copy
    --here) HERE="$2"; shift ;;
    # lean: ship_run.sh reads the particles here and sends home the small files (palm_runner.sh on xonix)
    --ship) SHIP="$2"; shift ;;
    *) echo "unknown option $1"; exit 1 ;;
  esac
  shift
done
CASE="${RUN%%_*}"
SRC="$HERE/$CASE/JOBS/$RUN/INPUT"
NAME="${NAME:-$RUN}"
[[ -f "$SRC/${RUN}_p3d" ]] || { echo "no $SRC/${RUN}_p3d: run build_case.py first"; exit 1; }

DST="$PREFIX/JOBS/$NAME/INPUT"
rm -rf "$PREFIX/JOBS/$NAME"
mkdir -p "$DST"
# the root's files and a nested child's (_N02), renamed to the run's name
for f in "$SRC/${RUN}"_static* "$SRC/${RUN}"_p3d*; do
  cp "$f" "$DST/${NAME}${f##*/${RUN}}"
done
if grep -q "domain_layouts" "$DST/${NAME}_p3d"; then
  # nested: the ranks are fixed per domain in the namelist; palmrun takes their sum
  CORES=$(grep -oE "'[a-z]+', *[0-9]+, *-?[0-9]+, *[0-9]+" "$DST/${NAME}_p3d" | awk -F, '{s += $4} END {print s}')
  echo "== nested run: $CORES ranks from domain_layouts"
fi
if [[ -n "$END" ]]; then
  # a short run: the given model time, no averaged or masked output, no scent particles
  for f in "$DST/${NAME}"_p3d*; do
    sed -i -E "s/^(\s*end_time\s*=\s*)[0-9.eE+]+/\1${END}.0/" "$f"
    sed -i -E "s/^(\s*skip_time_(data_output_av|domask\(1\))\s*=\s*)[0-9.eE+]+/\1999999.0/" "$f"
    sed -i -E "/^&particle_parameters/,/^\//d" "$f"
    sed -i -E "s/ *'pc_av',//; s/ *'pc',//" "$f"
  done
fi

# shellcheck disable=SC1091
source "$PREFIX/palm-env.sh"
cd "$PREFIX"
echo "== $NAME on $CORES cores, $(date -Is)"
T0=$(date +%s)
palmrun -r "$NAME" -c default -a "d3#" -X "$CORES" -T "$CORES" -v -z < /dev/null > "$PREFIX/JOBS/$NAME.palmrun.log" 2>&1 || true
T1=$(date +%s)
MON="$PREFIX/JOBS/$NAME/MONITORING"
echo "== palmrun finished in $((T1 - T0)) s (log $PREFIX/JOBS/$NAME.palmrun.log)"
if ls "$MON"/*_cpu* >/dev/null 2>&1; then
  sed -n '1,12p' "$MON"/*_cpu*
else
  echo "== no cpu measures: the run failed; the end of the log:"
  tail -40 "$PREFIX/JOBS/$NAME.palmrun.log"
  grep -h -A3 -i "error\|PAC[0-9]\|PA[0-9][0-9][0-9][0-9]" "$MON"/*_stdout* "$PREFIX/JOBS/$NAME.palmrun.log" 2>/dev/null | head -40
  exit 1
fi
if [[ "$SHIP" == lean ]]; then
  TAG="${RUN#"$CASE"_}"; TAG="${TAG#*_}"; [[ "$TAG" == "${RUN#"$CASE"_}" ]] && TAG=""
  bash "$BIN/ship_run.sh" "$NAME" --case "$CASE" --run "$RUN" --tag "$TAG" --here "$HERE" --prefix "$PREFIX" \
    --started "$(date -Is -d @$T0)" --finished "$(date -Is -d @$T1)"
  exit $?
fi
OUT="$HERE/../../raw/teacher/palm/runs/$NAME"
mkdir -p "$OUT"
cp -r "$PREFIX/JOBS/$NAME/OUTPUT" "$MON" "$OUT/" 2>/dev/null || true
cp "$PREFIX/JOBS/$NAME.palmrun.log" "$OUT/"
mkdir -p "$OUT/INPUT" && cp "$DST"/*_p3d* "$OUT/INPUT/" 2>/dev/null || true   # the namelist this run actually used
# the manifest and the DONE mark: postprocess.py (the scheduled task on XEVO, or the line below) takes it from here
cat > "$OUT/run.json" <<EOF
{"case": "$CASE", "run": "$RUN", "name": "$NAME", "host": "$(hostname)", "cores": $CORES,
 "started": "$(date -Is -d @$T0)", "finished": "$(date -Is -d @$T1)", "seconds": $((T1 - T0))}
EOF
touch "$OUT/DONE"
echo "== output copied to $(readlink -f "$OUT")"
# post-process here and now when this machine has the Windows Python with the packages (XEVO);
# anywhere else the scheduled task on XEVO picks the run up from the share within 15 min
if [[ "$(hostname)" == "XEVO" ]] && command -v py.exe >/dev/null 2>&1 && py.exe -3.14 -c "import numpy, netCDF4, scipy" >/dev/null 2>&1; then
  echo "== post-processing (fields, scent) ..."
  py.exe -3.14 "$(wslpath -w "$HERE/postprocess.py")" --once --run "$NAME" || echo "== post-processing failed; the scheduled task will retry"
else
  echo "== no Windows Python with numpy here: the scheduled task on XEVO will post-process $NAME"
fi
exit
}
