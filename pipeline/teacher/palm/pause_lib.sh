# Sourced by run_case.sh and palm_runner.sh (docs/SCENT-TESTSET.md; 2026-10-15, for Gavan's interview on
# xonix): when may PALM use this machine? It may not when
#   ~/palm/PAUSE exists (local: works with the share down, e.g. XEVO asleep or away), or
#   <queue>/mode-<host> says pause, or
#   now falls in a window of <queue>/quiet-<host>, lines of "YYYY-MM-DD HH:MM HH:MM" (this machine's clock).
# The mode and the windows are cached in ~/palm the last time the share answered, so a window set the
# night before holds even if the share is gone in the morning. A paused run is frozen (SIGSTOP), not
# killed: its memory stays, its CPU goes back, and it carries on where it was (SIGCONT).

palm_host() {  # the queue's name for this machine
  case "$(hostname)" in
    XONIC|xonic) echo xonix ;;
    *) hostname | tr '[:upper:]' '[:lower:]' ;;
  esac
}

palm_should_pause() {  # $1 the queue folder, $2 the host; status 0 = pause now
  local q="$1" h="$2" m="" now today d a b
  [[ -e "$HOME/palm/PAUSE" ]] && return 0
  mkdir -p "$HOME/palm"
  if [[ -d "$q" ]]; then   # the share answers: refresh the caches (no file means none)
    m=$(tr -d '[:space:]' 2>/dev/null < "$q/mode-$h")
    printf '%s\n' "$m" > "$HOME/palm/.mode-$h"
    if [[ -e "$q/quiet-$h" ]]; then cp "$q/quiet-$h" "$HOME/palm/.quiet-$h" 2>/dev/null; else : > "$HOME/palm/.quiet-$h"; fi
  else
    m=$(tr -d '[:space:]' 2>/dev/null < "$HOME/palm/.mode-$h")
  fi
  [[ "$m" == pause ]] && return 0
  today=$(date +%F); now=$(date +%H%M)
  while read -r d a b _; do
    [[ "$d" == "$today" && -n "$a" && -n "$b" ]] || continue
    a=${a/:/}; b=${b/:/}
    (( 10#$now >= 10#$a && 10#$now < 10#$b )) && return 0
  done < <(grep -v -E '^[[:space:]]*(#|$)' "$HOME/palm/.quiet-$h" 2>/dev/null)
  return 1
}
