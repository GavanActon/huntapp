#!/usr/bin/env bash
# Send a finished PALM run home lean (docs/SCENT-TESTSET.md, the service; 2026-10-15). The raw
# particles (1.5-13 GB) are read into <name>_particles.npz (20-55 MB) on the machine that ran
# them, and only that, OUTPUT without the particles, MONITORING, the log and the namelist cross the
# link. The raw particles stay in ~/palm/v25.10.1/JOBS/<name>. postprocess.py on XEVO takes the npz
# for the bands. Before this, xonix's WSL copies over /mnt/z ran at about 0.5 MB/s and broke off
# when the link dropped.
#
#   bash ship_run.sh <name> --case <case> --run <run> [--tag 4m] [--here <kit>] [--prefix <palm>] [--out <dir>]
#
# Reading: the first Python with numpy of py.exe -3.14, py.exe -3, python3. None: the raw
# particles go too. Copying: robocopy.exe (Windows, restartable, retries) when WSL can call it, a
# /mnt/z path sent to $PALM_SHARE_UNC (default \\XEVO\windcfd2); else cp. run.json and DONE are
# written only when every copy landed, so postprocess.py never reads half a run.
set -uo pipefail
{
NAME="${1:?usage: ship_run.sh <name> --case <case> --run <run> [--tag t] [--here kit] [--prefix palm] [--out dir]}"
shift
CASE=""; RUN=""; TAG=""; STARTED=""; FINISHED=""
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PREFIX="$HOME/palm/v25.10.1"
OUT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --case) CASE="$2"; shift ;;
    --run) RUN="$2"; shift ;;
    --tag) TAG="$2"; shift ;;
    --here) HERE="$2"; shift ;;
    --prefix) PREFIX="$2"; shift ;;
    --out) OUT="$2"; shift ;;
    --started) STARTED="$2"; shift ;;
    --finished) FINISHED="$2"; shift ;;
    *) echo "unknown option $1"; exit 2 ;;
  esac
  shift
done
[[ -n "$CASE" && -n "$RUN" ]] || { echo "ship_run.sh: --case and --run are needed"; exit 2; }
JOB="$PREFIX/JOBS/$NAME"
OUT="$(readlink -m "${OUT:-$HERE/../../raw/teacher/palm/runs/$NAME}")"
say() { echo "== $(date -Is) ship $NAME: $*"; }

ls "$JOB"/MONITORING/*_cpu* >/dev/null 2>&1 || { say "no cpu measures in $JOB/MONITORING: the run did not finish"; exit 1; }

# a WSL path as Windows sees it: the share by its UNC name (a mapped letter may not exist for this process)
win() {
  local p; p="$(readlink -m "$1")"
  if [[ "$p" == /mnt/z/* || "$p" == /mnt/z ]]; then
    local rest="${p#/mnt/z}"
    echo "${PALM_SHARE_UNC:-\\\\XEVO\\windcfd2}${rest//\//\\}"
  else
    wslpath -w "$p"
  fi
}

# 1. the particles, read here
PRT=$(find "$JOB/OUTPUT" -maxdepth 1 -type d -name "${NAME}_prt_bin*" 2>/dev/null | head -1)
NPZ="$JOB/${NAME}_particles.npz"
LEAN=0
if [[ -n "$PRT" ]]; then
  if [[ -s "$NPZ" ]]; then
    LEAN=1; say "particles already read ($(du -h "$NPZ" | cut -f1))"
  else
    for py in "python3" "py.exe -3.14" "py.exe -3"; do   # WSL's own reads ext4 fastest; Windows' through \\wsl.localhost (~7 MB/s on XEVO)
      exe=${py%% *}
      command -v "$exe" >/dev/null 2>&1 || continue
      $py -c "import numpy" >/dev/null 2>&1 || continue
      if [[ "$exe" == py.exe ]]; then
        script="$(win "$HERE/palm_to_scent.py")"; o="$(win "$JOB/OUTPUT")"; to="$(win "$JOB")"
      else
        script="$HERE/palm_to_scent.py"; o="$JOB/OUTPUT"; to="$JOB"
      fi
      say "reading the particles with $py ($(du -sh "$PRT" | cut -f1))"
      tagargs=(); [[ -n "$TAG" ]] && tagargs=(--tag "$TAG")
      if $py "$script" read "$CASE" "$RUN" "${tagargs[@]}" --output "$o" --prefix "$NAME" --as "$NAME" --to "$to" && [[ -s "$NPZ" ]]; then
        LEAN=1; say "particles read: $(du -h "$NPZ" | cut -f1)"; break
      fi
      say "$py could not read them"
    done
  fi
  [[ $LEAN == 1 ]] || say "no Python with numpy read the particles: the raw particles go too (slow)"
fi

# 2. the copies
mkdir -p "$OUT" || { say "cannot make $OUT (the link?)"; exit 1; }
T0=$(date +%s)
OK=1
if command -v robocopy.exe >/dev/null 2>&1; then
  rc() {  # robocopy: 0-7 is success, 8 and up a failure
    robocopy.exe "$@" /Z /R:30 /W:20 /NP /NFL /NDL /NJH /NJS >/dev/null 2>&1
    local s=$?; (( s < 8 )) || { say "robocopy $1 -> $2 failed ($s)"; return 1; }
  }
  xd=(); [[ $LEAN == 1 && -n "$PRT" ]] && xd=(/XD "$(basename "$PRT")")
  rc "$(win "$JOB/OUTPUT")" "$(win "$OUT/OUTPUT")" /E "${xd[@]}" || OK=0
  rc "$(win "$JOB/MONITORING")" "$(win "$OUT/MONITORING")" /E || OK=0
  rc "$(win "$JOB/INPUT")" "$(win "$OUT/INPUT")" "${NAME}_p3d*" || OK=0
  [[ -e "$PREFIX/JOBS/$NAME.palmrun.log" ]] && { rc "$(win "$PREFIX/JOBS")" "$(win "$OUT")" "$NAME.palmrun.log" || OK=0; }
  [[ $LEAN == 1 ]] && { rc "$(win "$JOB")" "$(win "$OUT")" "${NAME}_particles.npz" || OK=0; }
  HOW=robocopy
else
  mkdir -p "$OUT/OUTPUT" "$OUT/INPUT"
  for f in "$JOB/OUTPUT"/*; do
    [[ $LEAN == 1 && "$f" == "$PRT" ]] && continue
    cp -r "$f" "$OUT/OUTPUT/" || OK=0
  done
  cp -r "$JOB/MONITORING" "$OUT/" || OK=0
  cp "$JOB/INPUT/${NAME}"_p3d* "$OUT/INPUT/" || OK=0
  [[ -e "$PREFIX/JOBS/$NAME.palmrun.log" ]] && { cp "$PREFIX/JOBS/$NAME.palmrun.log" "$OUT/" || OK=0; }
  [[ $LEAN == 1 ]] && { cp "$NPZ" "$OUT/" || OK=0; }
  HOW=cp
fi
T1=$(date +%s)
SENT=$(du -sm --exclude="*_prt_bin*" "$OUT" 2>/dev/null | cut -f1)
[[ $LEAN == 1 ]] || SENT=$(du -sm "$OUT" 2>/dev/null | cut -f1)
say "copied with $HOW in $((T1 - T0)) s (about ${SENT:-?} MB at the far end)"
[[ $OK == 1 ]] || { say "a copy broke off: no DONE; run this again to finish it"; exit 1; }

# 3. the mark: a half-copied raw particle folder from an older copy step is dropped (the npz replaces it)
[[ $LEAN == 1 ]] && rm -rf "$OUT/OUTPUT/${NAME}"_prt_bin* 2>/dev/null
cat > "$OUT/run.json" <<EOF
{"case": "$CASE", "run": "$RUN", "name": "$NAME", "host": "$(hostname)",
 "started": "${STARTED}", "finished": "${FINISHED}", "shipped": "$(date -Is)",
 "particles": "$([[ $LEAN == 1 ]] && echo npz || { [[ -n "$PRT" ]] && echo raw || echo none; })",
 "particles_raw_at": "$([[ -n "$PRT" ]] && echo "$(hostname):$PRT")"}
EOF
touch "$OUT/DONE"
say "home at $OUT"
exit 0
}
