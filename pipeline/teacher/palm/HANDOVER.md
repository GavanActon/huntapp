# Handover: the PALM owner, referee and compute-service seat (from huntapp-c4, 2026-10-17 ~00:00; taken over by huntapp-jay, address huntapp-0a, ~00:20 on Gavan's word)

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

## jay's night (2026-10-17, from 00:20)

- **XEVO PALM on** (Gavan). The five explore runs 140-180 lost their `host: xonix` so XEVO's 7-core slot takes them (~3 h each); 205, 210, 220 and sdst stay on xonix.
- **Queued 220 lacbailey-bank am000** (validation, xonix): the loop's convective water-in-a-lee ask; booked in SCENT-TESTSET.md. Its inputs were built with `build_case.py lacbailey-bank --dx 4 --tag 4m` (the tag matters: without it the build lands untagged and rewrites case.json) and copied to the share with `cp -r` (robocopy from the sandbox did nothing).
- **SD v2 trial scored** (c4's chain, 00:26-00:49): v2t fails on misses, v2t2 a wash; HEAD moved under the chain and the bogstrip tiles were missing. A like-for-like rerun pinned to f264cc8 is armed in this session's background (waits for t-630-410/411 in v2t and v2t2 on R2; asked of 88 at ~00:58); logs land as `scores/trial-logs/trial2-*.log`. If this session is gone, run the three `scorecard.py --ref f264cc8 --label trial2-<v> --grid both|sd --sd-version <v>` by hand once the tiles are up.
- **floor_learn.py** (new): the PALM-taught floor as a tabular LOBO model; result and the lee-over-water rule finding in SCENT-TESTSET.md "The seat's night of 2026-10-17"; sent to ba.
- **docs/CHECK-INSTRUMENT.md** (new): the check redesign + Winded for Gavan's morning discussion.
- **~01:40, Gavan: "accuracy of the wind and scent; XEVO and xonix are yours to schedule; download data if needed."** Done on it: the trial-tile bake retried (PAUSE on XEVO's v1 bake, two bogstrip tiles into v2t and v2t2, PAUSE lifted); xonix reordered to 200 u12 → **202 am000** (convective, 40 min) → **203 dusk288t** (new: the dusk as a 3.5 h cooling series on the slot, `series` in build_case.py, ~3 h; needs `palm_to_fields.py --slice` to read, not yet built) → 210 dawn175u06 (9 h) → 212 wntest (2 h) → sdst → explore. ba's eff536b (lee water knob) on the cards: checks card passes (direction unchanged, honest 64 → 62%); PALM card running (label lee-water).
- **02:18, SD v2 trial decided like for like** (the seat baked the bogstrip tiles with v1 paused; all three on f264cc8): v1 0.50/0.59 misses 16, v2t 0.50/0.56 misses 19, v2t2 0.51/0.56 misses 17. Recommendation to Gavan: no national re-bake. SCENT-TESTSET.md has the table.
- **02:44, 200 u12 landed** (not 05:15), processed, forcing rows written (50; u06 2.7, u12 5.5 km/h), ba told. drain_read: the slope drains 0.42 at 2.7, 0.47 at 5.5, 0.22 at 6.5: a step between 5.5 and 6.5, not an e-fold from 5. ba proposes; I score.
- **Also queued on XEVO's slot:** 220 whitefish dusk210t (the held-out dusk series, ~7 h on 7 cores), after 140.
- **Optimus** (Gavan's code audit, the session that was 88) makes simplification commits on main with my conditions: behaviour-neutral in model.ts/scent.ts, hashes to me for the card, the FORCE_TILES hunk untouched, ba told.
- **03:30-07:15:** ba's slope fade (s55_1) passed the cards without a gain and ba held it (palm_compare down on the two runs it touches). Optimus's a225e55 exposed the card's load-state flaw; fixed by 04:30, settled (0 of 79 sits differ run to run); a225e55 neutral, the lee-water rows reproduce. am000 landed 05:13 (processed, forcing 11.8 km/h): the rule, not the slot; ba's two water gates (98293b1, waterAna / waterShelter) on the card: wa0ws05 the best so far, wa0ws1 fails SD misses; ws1 alone + checks cards pending. The 05:30 loop crashed at 05:51 (its 5251 server gone at the Lac Bailey switch); re-run by hand at 07:17 behind the lock. xonix: 203 dusk288t running since 05:13 (~08:00); XEVO: 140 still running (7 cores, ~6 h), then 220 whitefish dusk210t. series_read.py (new) reads a series run window by window.
- **07:30-08:30:** wa0ws05 shipped (67c59f8, hunt-dev); ws1's true row fails on SD misses (19); hunt-dev's base reads SD 19 at Whitefish W2/W2s against the variant's 17 (the default path or 22a12d3: a 22a12d3-only card is queued, ba checks the defaults). dusk288t read (series_read.py, the booked-questions row): the floor fades as the local wind dies; ba's station check says the evening forecast is honest in the fade window. The loop (patched to hold the lock) wrote reports/2026-10-17.md at 08:14: 0.61 / 0.62, misses 10, FA 79; the card is the new reference.
- **13:00, Gavan:** the ops page carries the seat's objectives paragraph (pipeline/teacher/palm/OBJECTIVES.md, rendered by ops_page.py; keep it current), and the SD bake queue drops tiles that are all water unless a neighbour has land (pipeline/water_tiles.py --apply: 112 of 10,576 queued skipped, 138 kept beside land; 92 all-water tiles with no land next door were already baked on R2, e.g. t-617..619-415..421; re-run after hunt_priority.py rewrites the queue).
- **Waiting on:** the 22a12d3 card; 210 dawn175u06 (xonix, ~16:00: waiter processes it, writes the forcing row and runs drain_read); 220 whitefish dusk210t (XEVO, afternoon: waiter converts and prints the series table); ba's read of both for the fade → `forcing_table.py --write` → tell ba; the 05:30 loop report; 205's `wn_fine.py score` after ~07:30.
- Nothing committed. Gavan's word for any commit or push stands.

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
- **A bash waiter that greps process command lines for a name matches itself** (its own command line holds the name): filter on `$_.Name -like 'python*'` as well, or it never sees the job end (2026-10-17, the trial-tile bake sat 25 min behind a paused v1 bake).
- **The auto-mode classifier refuses shared-resource commands** (a PAUSE on XEVO's bake, R2 writes, Stop-Process) unless Gavan has just said the machines are the seat's; stop your own background tasks with TaskStop, never Stop-Process.
- **The HD card scored a load state until 2026-10-17 ~04:20** (found by Optimus): CONE_JS awaited microReadyFor only, which loads the two momentum directions of the hour's FORECAST wind, not the forced one, and never awaited loadRestOfMicro, which is also what asks for the relief (riseUpwind, waterAt). Rows before the fix agreed in total per commit and differed by up to 12 sits run to run; palm_compare and replay always awaited the rest. Fixed by 04:30 (loadRestOfMicro, the going grid and the habitat awaited by name, the first sit read until it settles); 0271e10 twice: 0 of 79 sits differ. A refactor that only changes speed can move a card that samples mid-load.
- **palm_loop.py never took the worktree lock** (it called sc.prepare and sc.serve directly) until 2026-10-17 ~08:00: its checkout, its `npm ci` and its long-lived server (kept up for palm_compare and the checks) collided with every card beside it (05:51 crash, 07:11 EPERM, ws1's half-installed row, the 07:30 run stuck 'not ready'). It now holds the lock from prepare to kill. `npm ci` in prepare() retries five times: a just-killed vite can hold a native binary for a few seconds.
- **The SD column's two-state sits (W2/W2s: 17 or 19 SD misses, 2026-10-17):** windTiles.ts fetchTile caches a failed fetch as a blank tile for the page's life, so a transient R2 failure leaves one block tile on default stands for a whole card (every variant consistent, the next card different). The card now records each block tile's fetch status (sd_route) and reloads when one is not 200; Optimus fixed the app (2e4ff4b). **But the two-state outlived it** (every tile 200 on both sides): page-internal, one sit, never inside a card; ba's `window.__micro` (233dbaf) is logged per sit by the card: both states show identical momentum/turbulence/stand/going/relief at W2, and ba's fuller handle (40c8c6c) named it: `leeRiseCached` 6.18 vs 4.72 m at W2's cell and sector (the lee's rise cached by sector, filled by whichever bearing came first: the page's forecast wind at load or the card's forced air). ba fixed it in 2a30c8e (the lee's rise keyed by the going grid's 10 m cell; its first try, the 30 m centre, failed card 2): passes the four cards; SD deterministic sit by sit from its push. Reference after the push: HD 0.61 / 0.62, 10, 77, 26; SD 0.54 / 0.57, 19, 79, 32. The card saves `micro` (ba's window.__micro, the call taken apart) per sit in the score JSON.
- **The checks card and ba's palm_compare share the quiet server on 5195**: run together, a replay's page.goto times out (the Pickle set of checks-leerise.json, 2026-10-17 ~12:40). Sequence them: card 2 first, then card 3.
- **build_case.py needs `--tag 4m`** to rebuild a 4 m case; without it the build lands untagged (JOBS/<run>/ and case.json) beside the real one. Rebuild the whole case (no --runs), or case-4m.json keeps only the runs built.
