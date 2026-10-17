# Handover: the PALM owner, referee and compute-service seat (from huntapp-c4, 2026-10-17 ~00:00)

Gavan is handing this seat to a new session as a test. Read this first, then `docs/SCENT-TESTSET.md`
(the roles, the service, the test set, the score, the booked questions) and the memory files it names.
Until you confirm you've taken over, c4 keeps the seat; after that, c4 makes no queue edits and sends no messages.

## The seat

- **You own** the PALM work, the scent test set and its scorecard, and the job queue on xonix and XEVO
  (one queue, priorities product > validation > backfill > explore).
- **You referee** every rule change on the four-card bar:
  - PALM v2 card: misses don't rise.
  - palm_compare direction: no worse.
  - checks_card: no worse, honest coverage within 1 sd at 60–80%.
  - Towers: within 2× held out.
  - Tie-break: the gentler change.
- **Peers** (message by name):
  - **huntapp-ba** builds rules in model.ts and scent.ts. It reads PALM runs from fields (drain_read.py) and pushes main to hunt-dev under Gavan's standing "take actions to improve accuracy", only what passes your bar.
  - **huntapp-88** owns the SD tile bake, wind_tiles.py, the surrogate net and the wetland adapters.
- **Gavan's word** is needed for:
  - any commit or push of yours;
  - anything to live: the live freeze is ON (no push to `live`, no site Worker deploy, no remote D1 writes);
  - pausing XEVO;
  - new initiatives.

  Questions from him are not requests. Commit or build only on an explicit ask.

## Gavan's steers that decide calls

- Accuracy over speed, **but scalable**. Fix rules, not places. Score SD against PALM as well as HD
  (memory `accuracy-over-speed`).
- Wind checks are the product. The models feed the check loop (memory `wind-checks-are-the-point`).
- Fewer initiatives. Every PALM run is booked against an outcome (`SCENT-TESTSET.md` "Questions the loop has booked").
- XEVO is kept for his product work. Its PALM slot is off. Heavy work goes to xonix through the queue.

## The service in one look

- **Queue:** `pipeline/raw/windcfd/raw/teacher/palm/queue/` (= `\\XEVO\windcfd2\raw\teacher\palm\queue`):
  - `todo/`, `taken/`, `done/`, `failed/`;
  - `status-<host>-<slot>.txt`;
  - `mode-<host>`, `quiet-<host>`.
- **Status:** `py -3.14 pipeline/teacher/palm/palm_status.py`.
- **Ops page for Gavan:** https://data.groundwind.app/ops/-ZAXPA3-Vz36WpNLNLohlCx4/index.html. XEVO's task "Groundwind ops page" rewrites it every minute (ops_page.py). The link is unlisted: never put it in git.
- **Slots on xonix:**
  - `1`: CPU, PALM on 22 cores, cmd jobs too;
  - `gpu`: needs: gpu;
  - `product`: preempts.
- **Jobs:**
  - **PALM jobs:** `palm_status.py --add "<run> [--name X]" --why ... --priority ... --host xonix`.
  - **cmd jobs:** write the file by hand. The first line is `cmd: ...`, then `priority:`, `host:`, `needs: gpu`, `pause-file:` and `# why:`. **LF line endings only, no BOM.**
  - **Never** `--add` a cmd job: its first plain line becomes a PALM run name.
- **The scorecard:**
  - `pipeline/teacher/palm/scorecard.py` scores a commit in the worktree `C:/dev/huntapp-score` on port 5251.
  - It takes `scores/worktree.lock`, so a second run waits.
  - `--grid hd|sd|both` and `--sd-version v1|v2t|v2t2` (the SD column). SD needs the dev-only `?tiles=force` in windTiles.ts: in the app since 9d6e96a; for an older ref, add `--patch pipeline/teacher/palm/sd-tiles.diff`.
- **The nightly loop:** `palm_loop.py`, Windows task "Groundwind PALM loop" at 05:30, reports to `pipeline/raw/teacher/palm/loop/reports/<date>.md`. Today's defaults (f08 + r51all) are its new baseline.

## In flight (times EDT, 2026-10-17)

| where | what | when | who reads it |
|---|---|---|---|
| xonix CPU | 200 lacbailey-spot d326u12 (drainage fade, steep, ~4 km/h) | until ~05:15 | ba (drain_read), you referee |
| xonix CPU | 205 wntest-slot10: WindNinja at 10 m on the slot's LiDAR DTM (`\\XEVO\windcfd2\wntest`, run-test.ps1) | ~05:15–07:30 | you: `py -3.14 pipeline/teacher/palm/wn_fine.py score` (against PALM's 10 m wind; baseline the HD 30 m solve) |
| xonix CPU | 210 pickle-bogs dawn175u06 (drainage fade, flat, ~2 km/h) | ~07:30–16:30 | ba, you |
| xonix CPU | sdst chain: the SD tiles' stand backfill (5,213 tiles, sdtiles/stands_batch.ps1) | after 210, ~4–5 h | 88 |
| xonix CPU | 140–180: surrogate-set explore runs (whitefish, lacbailey-bank) | last | the surrogate checkpoint |
| xonix GPU | lee3-train (88's lee-weighted net, two kit jobs ~12 min each), then the sdx chain (SD tiles from the queue's end) | now | 88 |
| XEVO | 88's trial script: waits for lee3, evals it, bakes the 12 box tiles as sd/v2t (lee) and sd/v2t2 (lee + provincial wetlands), then resumes v1 | ~01:00–02:00 | you |
| XEVO | `pipeline/teacher/palm/score_trials.ps1`: waits for v2t and v2t2 on R2, then scores HD+v1, v2t and v2t2 (logs in `scores/trial-logs/`). c4 runs it in the background from this repo copy (restarted 2026-10-17 ~00:15 without the patch, since 9d6e96a carries the switch). **If c4's session is gone and no `scores/trial-logs/` appear after the trial tiles land, start it again** (`powershell -ExecutionPolicy Bypass -File pipeline\teacher\palm\score_trials.ps1`, in the background) | after the trial tiles | you, then the v2 re-bake call goes to Gavan |
| XEVO | three idle WindNinja runners in -Watch on the main kit (from the Duhamel bake) | idle | leave them |

## Where things stand (the night of 10-16)

- **On hunt-dev, not live:**
  - FLOOR f08 (the towers' floor ×0.8) and THERMAL r51all (drainage fade at 5 km/h over 1, slope and flat, keyed to U): ba's 09d8e85.
  - Card misses 16 → 10 against base. The fade is provisional on the drainage runs.
- **SD column** (`SCENT-TESTSET.md`):
  - HD 0.53 / 0.62 (10 misses); SD with the stand bands 0.50 / 0.59 (16).
  - Fixes on the way: habitatAligned (2ac1df7), standBands (c2d2cef), tile stand bands (dbd189e), the tile fetch's missing `.hab` (6822795).
- **SD v2 trial** (Gavan: "trial, then decide"):
  - v2t is the lee-weighted retrain. ba found the net 30–55% fast in a bank's lee.
  - v2t2 adds provincial wetlands. **Gavan picked provincial layers:** ON's LIO wetland units, QC's CMHPQ, others by the SD ranks.
  - The national re-bake is his call after both scores.
- **WindNinja finer than 30 m** (Gavan: "I want better"): the slot test above. It helps slots, banks and ridges.
- **Whitefish:** what Gavan raised last ("the HD wind isn't very exciting, the checks don't add value"). PALM at 4 m in Whitefish's woods:
  - 43–57% of head-height cells are nearly still (< 0.5 km/h).
  - Where the air moves, it's a median 14–22° off the wind, and 13–20% of moving cells are > 45° off (edges, the cut, the arm).
  - WindNinja HD shows ±2°.

  So flat forest's value is the canopy-driven floor (still against moving, the turned edges), not terrain resolution. That points at the PALM-taught floor (the surrogate checkpoint), pulled forward. c4 put it to Gavan as the next build. **Not yet decided.**

## c4's work: committed on Gavan's word (2026-10-17)

- **9d6e96a and its follow-up, local only (not pushed; a push is Gavan's word, or ba's dev push under its standing instruction, which carries them):**
  - scorecard.py: --grid, --sd-version, the lock;
  - build_case.py runs;
  - testset.json, SCORES.md;
  - ops_page.py, wn_fine.py, score_trials.ps1, sd-tiles.diff, HANDOVER.md;
  - docs/SCENT-TESTSET.md, docs/SCENT-TEACHER.md;
  - windTiles.ts `FORCE_TILES` (dev-only).
- **Not in git** (pipeline/raw is ignored): `pipeline/raw/windcfd/sdtiles/{xonix_batch,stands_batch,xonix_keycheck,xonix_cpu,xonix_cpu_trace}.ps1` and `pipeline/raw/windcfd/wntest/`.

## Gotchas learned the hard way

- **PowerShell 5.1:**
  - `[IO.File]` with a relative path uses .NET's cwd. A failed read followed by WriteAllText($null) once emptied a file. Use absolute paths and guard with `if ($t)`.
  - `Set-Content -Encoding utf8` adds a BOM.
- **Queue files must be LF.** A CR broke claims and quiet windows.
- **xonix is reached only through queue cmd jobs.** py.exe and powershell.exe are called from WSL; R2 keys are read from its registry. Never print the keys; compare them by hash (xonix_keycheck.ps1).
- **Before any push, check `git status -sb` "ahead N".** A push carries other sessions' local commits.
- **`?tiles=force`** needs the map at zoom ≥ 9 and a moveend (scorecard TILES_JS does a jumpTo at z12).
- **Open-Meteo's archive** has a per-IP daily limit (it refused XEVO for most of 10-16). forcing_table.py caches its answers.
- **Two scorecards on one worktree** fight over port 5251. The lock prevents it now; don't bypass it.
