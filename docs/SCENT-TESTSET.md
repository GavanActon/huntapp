# The scent test set and the PALM service

From 2026-10-15 this is the front page for PALM work. Gavan: "too many initiatives with PALM and
scent across xonix and XEVO; it's confusing to you and me." PALM's job is now one thing: **score the
app's scent cone against PALM at fixed points in the HD areas**, and let that score decide every rule
change. The wind side comes free from the same runs.

Gavan, 2026-10-15: "I'd prefer xonix to be working on the scent validation today. If 2 m is part of
it that's fine." The Pickle and Lac Bailey runs are queued (see the winds table). Whitefish's points go
to him on a map before its runs.

## Who does what

Roles, not session names: names get reused (huntapp-d1 was the scent thread on 2026-10-14 and the
map UI thread the next day).

| role | held by (2026-10-15) | does | does not |
|---|---|---|---|
| **PALM owner** (the referee), and from 2026-10-18 the **bake seat** | Hunter-Jay (was huntapp-jay / huntapp-0a), named by Gavan 2026-10-17 ~00:20; the bakes on his "Go" 2026-10-18 ~06:30 (vacant since huntapp-88 became Optimus); huntapp-c4 until then | the service, the cases, `pipeline/teacher/palm/`, the queue, the test set, the scorecard; the area bakes (HD: `bake_area.py`, the WindNinja kits; SD: `wind_tiles.py`, the national queue) and their publish | change app rules |
| **Rule builder** | huntapp-ba | the app's wind (`model.ts`) and scent (`scent.ts`) changes, each scored on the card as a `--patch`; from 2026-10-16 also the wind data around them: the station collector (`pipeline/stations/collect.py`, daily 07:00 on XEVO) and the tower work (`pipeline/towers/`) | edit the PALM kit, the queue or the card |

**Handover:** only Gavan names the PALM owner. The outgoing owner updates the table above and the
memory note `palm-runs-need-outcomes`, and leaves the queue in a stated state (`palm_status.py`). If
the named session is gone, any session asks Gavan before touching the kit. To check who holds a role,
ask the session, and don't trust its name alone.

Everyone else reads `fields/RUNS.md`, `SCORES.md` and `palm_status.py`, and asks the owner for runs.
They don't edit the kit, queue runs or score their own changes as baselines. The 3D brief
(docs/PALM-3D.md) is parked.

**No cell, no run.** Every job names the test-set cell it fills. A run that fills no cell needs Gavan's
OK and carries the tag `explore`.

## The service

xonix does the PALM work. XEVO takes PALM work only when it's idle or when Gavan says so.

**Running from 2026-10-15:** one queue, both machines.
- **Look and steer:** `py -3.14 pipeline/teacher/palm/palm_status.py` shows the queue, each machine's
  slots (rewritten every minute) and the runs that landed. `--xevo off|idle|on` sets XEVO's mode, and
  `--add "<run> [options]" --why "<cell>"` queues a job. No `--why`, no job.
- **The queue is a folder on the share:** `pipeline/raw/windcfd/raw/teacher/palm/queue/` on XEVO, which
  is `/mnt/z/raw/teacher/palm/queue/` on xonix. A job is one file in `todo/` named `<order>-<name>.job`.
  Its first line is the run_case.sh arguments. An optional `host: xonix` line restricts it to one
  machine, and a `# why:` line names its test cell. A runner claims a job by renaming it into `taken/`,
  then files it in `done/` or `failed/`. The job's log is `log-<job>.txt` next to it.
- **The runner** is `palm_runner.sh`, in `surrogate/palm/bin/` on the share, with one process per
  slot. Each job runs from a fresh local copy of bin/; PALM runs ship lean. To stop a machine's
  slots, `touch queue/stop-<host>`.
- **Jobs and priorities** (Gavan's compute plan, 2026-10-15, memory `huntapp-compute-service`):
  - A job is a PALM run (its first plain line) or `cmd: <bash>`.
  - Optional lines: `priority: product | validation | backfill | explore` (default validation),
    `host:`, `needs: gpu` and `pause-file: <path>`. The pause file is for a job that pauses itself,
    such as the SD bake's `PAUSE`, which a Windows process needs because a freeze can't reach it.
  - Slots take the best priority first. `palm_status.py --add ... --priority product` queues a job,
    and `--bump <job> <priority>` re-prioritises one waiting.
- **The slots:**
  - **xonix:** `1` (PALM and CPU jobs, 22 cores), `product` (product jobs only; it freezes a
    lower-priority job there while one runs) and `gpu` (`needs: gpu` jobs). `xonix-start.sh` starts
    all three and is safe to rerun: it retires an older runner without stopping its job and files that
    job when it ends.
  - **XEVO:** one slot, mode `on`, 7 cores, no GPU jobs. Gavan, 2026-10-15: "best if I just tell you
    to pause as needed", so `--xevo pause` goes on his word. `PALM_MODE` gives one slot its own mode:
    a GPU slot on XEVO would run `idle` and bake only while XEVO is quiet.
  - Tested on stubs: priority order, GPU-only claims, a product job freezing a backfill job (a freeze,
    or its pause file) and letting it go after.
- **XEVO's modes** (`queue/mode-xevo`): `off` takes nothing new. `idle` takes one run when Windows' CPU
  has averaged under 25% for 15 minutes on mains power. `on` takes up to its slots. `pause` also
  freezes what runs. XEVO's slot starts with `xevo_slot.sh 1` (Start-Process wsl.exe, in its header).
  The old `xevo-queue.txt` and `xevo_runner.sh` are retired.
- **Pause and quiet windows** (`pause_lib.sh`, 2026-10-15, for Gavan's interview on xonix):
  - `palm_status.py --xonix pause` freezes PALM on xonix now, and `--xonix on` resumes. The freeze is
    SIGSTOP to the run's own process group: its CPU comes back, its memory is held, and it carries on
    where it was.
  - `--quiet xonix "YYYY-MM-DD HH:MM HH:MM"` sets a window ahead of time. The machine caches its mode
    and windows from the share each time it reads them, so a window set the night before holds even
    if XEVO is asleep.
  - On the machine itself, `touch ~/palm/PAUSE` pauses without the share; delete the file to resume.
  - Each job's run_case.sh carries the watcher, so even xonix's first-version runner picks it up from
    its next job. The run going when it was added (bogs nw305) can't be frozen.
  - Tested with a stand-in run: parent and child froze for the pause and resumed.
- **XEVO's other tenant** is the national SD wind tile bake (`pipeline/wind_tiles.py bake --queue`,
  huntapp-88). It uses about 6–8 of the GPU's 8 GB and 2–4 cores, and it's paused by Gavan
  (`pipeline/raw/windtiles/PAUSE`). In `idle`, PALM yields to it: the bake's cores keep Windows' CPU
  over the line. In `on`, the bake runs 2–4× slower beside PALM (seen 2026-10-14). So when Gavan
  resumes the bake, `idle` or `off` is the mode for XEVO.
- **The ops page** (2026-10-16, Gavan: "a site to show me what's running on what system"):
  - `pipeline/teacher/palm/ops_page.py` writes one self-refreshing page: each machine's slots and the job in hand, XEVO's CPU, memory, SD bake and WindNinja, SD tiles on R2, the queue, recent finishes and the PALM runs landed.
  - XEVO's scheduled task "Groundwind ops page" runs it every minute (pyw, no window). The page goes to an unlisted R2 link, `data.groundwind.app/ops/<token>/index.html`, with the token in `pipeline/raw/ops/token.txt` (never in git).
  - When the live freeze lifts, it moves behind the /stats key (Gavan's call).
- **xonix's GPU slot bakes SD tiles from the queue's end** (2026-10-16, Gavan's "maximise the GPUs"):
  - The batches come from `wind_tiles.py batches --reverse --size 250` in `\\XEVO\windcfd2\sdtiles\xonix`.
  - Each batch is one backfill job, `sdtiles/xonix_batch.ps1`. It:
    - pulls xonix's code, reads the R2 keys from the registry and checks the packages;
    - takes the lowest `batch-NNNN.txt` left and bakes it with `--jobs 3`;
    - renames it `.done` and queues the next job, so only one job is in the queue at a time.
  - It pauses through `sdtiles/xonix/PAUSE` (the runner's `pause-file`). `sdtiles/xonix/STOP` ends the chain after the batch in hand.
  - XEVO bakes from the front, and each skips the tiles the other has sent to R2.
- **Edits reach the runners through the share:** after changing the scripts or building a case on
  XEVO, run `bash pipeline/teacher/palm/sync_kit.sh [case ...]`. It never touches the old
  `surrogate/palm/run_case.sh`.
- **Lean shipping:** `ship_run.sh` reads the particles on the machine that ran them
  (`palm_to_scent.py read --to`), cutting 1.5–13 GB to 20–55 MB. Only that file, OUTPUT without the
  raw particles, MONITORING, the log and the namelist cross the link, by robocopy over
  `\\XEVO\windcfd2`. run.json and DONE are written only after every copy has landed. The raw particles
  stay in xonix's `~/palm/v25.10.1/JOBS/<name>`. `postprocess.py` takes the shipped npz for the bands.
  Tested 2026-10-15 on `_sit2`: 2.3 GB became 23 MB, identical to the npz made from the raw files, and
  the run went home as 222 MB in 10 s. The read through Windows Python took 5.5 min.
- **Starting it on xonix:** `bash /mnt/z/surrogate/palm/xonix-start.sh` in a new Ubuntu tab, left
  open. It stops the old rules2 chain (the run in hand carries on) and the old sweeper. It ships the
  stranded bogs runs and the 2 m strip lean (`ship_today.sh`), then runs the runner in that tab.
- **Safe processing:** `postprocess.py` takes only a run marked DONE, and a newer DONE redoes it.
  `palm_to_scent.py read` refuses a particle set with fewer rank files than PEs. On 2026-10-15 a
  half-copied run (4 of 22 rank files) was nearly read as whole.

**Not built:** the queue on R2, so XEVO can travel without stranding xonix, and leases that return a
dead runner's job by themselves. Until then a job stuck in `taken/` after a reboot is moved back to
`todo/` by hand. The design below is that later version.

**Jobs.** One small JSON file per job: case, run, tag, name, the cells it fills, what it needs (RAM,
box size, grid), priority, who added it. A job is `todo`, then `taken` (a lease: host, start,
heartbeat), then `done` (run.json, DONE, the scent bands, the fields) or `failed`.

**Where the queue lives.** Recommended: R2 (bucket groundwind-data, prefix `palm/`). Neither machine
depends on the other being on or reachable. A claim is a create-if-absent write. Results land next to
the app's data. The particle files stay on the worker's disk, and run.json records where. Fallback: a
folder on xonix shared to XEVO, with xonix running locally and XEVO the only network client. **Not on
XEVO:** it's a laptop that travels, and the xonix-to-XEVO link dropped twice on 2026-10-15 (both
bogs runs lost their copy step).

**Workers.** One runner script, the same on both machines, started once and left running.

| | xonix | XEVO |
|---|---|---|
| takes | any job | jobs that fit 16 GB WSL: 1 km boxes at 4 m |
| slots | 2 (8 ranks each; measure the first night) | 1, or 2 in `on` mode |
| when | always | by mode, below |
| priority | normal | `nice 19`, so XEVO stays usable |

XEVO's modes are `off`, `idle` and `on`, with `idle` the default. In `idle` it takes a job when the
15-minute CPU average is under about 25%, it's on mains power and no other bake is running. In `on` it
takes jobs now ("put XEVO on PALM"). In `off` it takes nothing new.

**Gavan's controls,** which any session runs when he asks: `palm status` (queue, who runs what, ETA,
last results), `palm xevo on|idle|off`, `palm add <cell>`, `palm hold`.

**The rules that fix this week's failures:**
- A worker copies the job's kit (case files and a frozen run_case.sh) to its own disk when it claims.
  It never runs a script off the network. That fixes the bash-reads-by-offset and stale-handle losses.
- A heartbeat every 5 minutes. A lease 30 minutes stale (a reboot) goes back to `todo`.
- A job carries its own source list (the run's namelist), never the case's current one. That fixes
  b190's mislabelled bands.
- Post-processing runs on the worker, which uploads only the small results.
- `fields/RUNS.md` is generated from the store.

## The test set (v1)

Points sit where PALM sources already exist wherever possible, so finished runs count. **Pickle is the
tune set. Lac Bailey and Whitefish Lake are held out:** rules are tuned on Pickle and must not get
worse on the other two, the way Searchmont was held out for the lee rule.

The test set covers three of the five HD areas. Highland and Blanchard are mountains, and PALM's
cyclic boxes can't hold their relief. They wait for a non-cyclic method (SCENT-TEACHER.md, by biome).

### Points

| id | box | source (as named in the runs) | situation | anchored on |
|---|---|---|---|---|
| P1 | pickle-slot | throat west bank 1.5 m | a slot between waters | the felt funnel, 09-29 midday |
| P2 | pickle-slot | throat west bank 5 m | a 5 m stand at a slot | |
| P3 | pickle-slot | bay, over the water 30 m S of the shore | a windward tree line seen from water | |
| P4 | pickle-slot | ring 000 120 m | the lee slope of the 68 m hill | |
| P5 | pickle-bogstrip | Gavan's sit 30 Sep, winded, bull S 1.5 m | a strip's edge under 13 m canopy | winded, 30 Sep |
| P6 | pickle-bogstrip | position 2, 30 Sep | an open strip between 14 m walls | bull heard S, 30 Sep; logs 29 Sep |
| P7 | pickle-bogstrip | position 1, 30 Sep | a bog's edge under trees | the one the bull winded |
| P8 | pickle-bogs | the bog (the checks) 1.5 m | open bog | 26 GPX checks; 6 dusk checks 10-02 |
| P9 | pickle-bogs | the bog (the checks) 5 m | a 5 m stand at a bog | |
| P10 | pickle-bogs | the pool S of camp | a cold-air pool | the "too much plume" spot, 10-09 |
| L1 | lacbailey-bank | the point 1.5 m | a lake's shore under a bank | |
| L2 | lacbailey-bank | up the bank 150 m 1.5 m | a bank slope in 12 m regrowth | |
| L3 | lacbailey-bank | up the bank 150 m 5 m | a 5 m stand on a bank | |
| W1 | whitefish | W1 lakeshore under the bank | a shore under a 31 m bank | |
| W2 | whitefish | W2 marsh edge under trees (1.5 m and 5 m) | a marsh edge under trees; a 5 m stand | |
| W3 | whitefish | W3 the cut, its S tree line | a tree line seen from an open cut | |
| W4 | whitefish | W4 marsh bay between walls | a 65 m bay between tree walls | |
| W5 | whitefish | W5 lee slope of the bank | a lee slope (7°, 17 m trees) | |
| W6 | whitefish | W6 creek trough floor | a drainage floor | |
| W8 | whitefish | W8 over the water off the S shore | a tree line seen from water | |
| W9 | whitefish | W9 head of the arm | trees facing the arm's water under the prevailing SSW | Gavan's pick |
| W10 | whitefish | W10 clearing on the neck | a 20 m clearing on the neck between two waters | Gavan's pick |

The ring sources in each run are scored too, as extras, outside the headline. **Whitefish**
(approved by Gavan 2026-10-15 with W9 and W10 added): the box is centred on 48.154859, -80.798419,
around the lake's NE arm, the east pond and the logged cut. It has no bog and no long strip. W7, the S
pond's marsh basin, was dropped for W9 and W10, since a run carries ten sources at most and the taper
cut the basin open. The ring tapers to the pond's level (p25). The map is
`pipeline/raw/teacher/palm/whitefish/whitefish-box-proposed.png`.

### Winds per box: two neutral and one stable

| box | neutral 1 | neutral 2 | stable | to run |
|---|---|---|---|---|
| pickle-slot | s186 ✓ (4 m and 2 m) | w270 (XEVO, running) | dusk288 ✓ | none once w270 lands |
| pickle-bogstrip | b232 ✓ (`_sit2`, true positions) | b190 at 4 m (`_test`, queued) | dusk288 (XEVO, running) | 2 |
| pickle-bogs | nw305 (xonix, running) | | dawn175 ✓, dusk288 (shipping lean) | 1 |
| lacbailey-bank | n000 ✓ | s180 (queued) | dusk000 ✓ | 1 |
| whitefish | s210, the prevailing SSW (queued) | n000 (queued) | dusk210 (queued) | 3 |

Where they run, 2026-10-15 at 15:20:
- **xonix:** bogs nw305 (since 14:43), then the next job in the queue.
- **XEVO:** slot w270 and the strip's dusk288 on its last old runners. Its new slots wait in `idle`.
- **Queued:** Lac Bailey s180, strip b190 `_test`, then Whitefish s210, n000 and dusk210, taken
  by whichever machine is free first.
- **The 2 m strip b190 never ran:** the old chain's run script failed to start it, so the 4 m `_test`
  run fills that cell.
That's **7 new runs**, about one night on xonix and two at most. Of the 7 runs held on 2026-10-15
(`pipeline/raw/teacher/palm/xevo-queue.held.txt`), only lacbailey-bank s180 fills a cell. The other 6
are dropped unless Gavan wants them as `explore`.

xonix's old chain (`pickle-rules2-chain.sh`) ended without running its 2 m strip or 2 m Lac Bailey
runs; its run script most likely failed to read off the share. `xonix-start.sh` retired it on
2026-10-15. The strip's b190 cell is filled at 4 m instead.

## The score

One script, `pipeline/teacher/palm/scorecard.py`. It reads PALM's side from the scent bands
(`fields/<run>_scent.json`, from palm_to_scent.py) and the app's side from `app/scripts/cone_export.py`,
both in the same measure (reach by 45° sector in the 50/15/3% bands, NOSE 0.055).

- **The app's cone runs under the run's own air:** the run's forecast wind forced with `setForcedAir`,
  at the run's stability and hour of day, from the same point and height.
- **A sector is scented** when the 15% band ("some minutes") reaches 40 m or more. The 40 m clears the
  source's own cells. It's fixed in v1 and doesn't change without a version bump.
- **Hit:** both scented. **Miss:** PALM scented, the app not. That's the winding error, the 30 Sep
  lesson. **False alarm:** the app scented where PALM hasn't even a trace (its 3% band under 40 m).
- **Headline: the threat score**, hits / (hits + misses + false alarms), over all points, winds and
  sectors. It's reported for the tune set and the held-out set separately, with the misses on their own
  line under it.
- **Diagnostics:** the main lobe's bearing error, the app/PALM reach ratio at 15% in hit sectors, and
  scores per situation and per area. The point's head-height wind against PALM (palm_compare.py's
  measure) is on the same line.
- **Later:** the app's cone on PALM's own head-height field, which splits each miss into wind error
  and cone error. It needs a hook that feeds a PALM field into scent.ts (not built).

Each score is saved with the commit it scored, so scores compare over time. The first score is the
**baseline**: today's app (with the lee and slot rules) on the cells already run.

**How a score is taken** (built 2026-10-15 from huntapp-ba's trial card):
- The points, the runs and the measure are in `pipeline/teacher/palm/testset.json` (v1, frozen).
  Runs that haven't landed are listed as pending and left out.
- `pipeline/teacher/palm/scorecard.py` scores **commits, not the shared working tree**, which other
  sessions edit mid-change. On 2026-10-15 a half-written `swingTune` in model.ts broke a score.
- `--ref` (default `HEAD`) is checked out in a scoring worktree, `C:/dev/huntapp-score`. It has its own
  `npm ci` and its own quiet server on port 5251, and it reads the main checkout's `public/` data
  without links.
- **A candidate is a diff of its own files,** applied on top:
  `git diff -- app/src/weather/micro/scent.ts app/src/weather/micro/model.ts > swing.diff`, then
  `scorecard.py --label swing --patch swing.diff`. Nothing needs committing to be scored.
- `--tree --url ...` scores the working tree. It's marked dirty: fine for a quick look, never a baseline.
- **The output:** the full sector-by-sector result goes to
  `pipeline/raw/teacher/palm/scores/<when>_<commit>[-patched]_<label>.json`. A summary line goes to
  `pipeline/teacher/palm/SCORES.md`: the threat score for the tune set and the held-out set, misses,
  false alarms and pending runs. The printout adds the score by situation and every miss by point, run
  and sector.

**The bar for a scent change:** the tune-set threat score goes up, misses don't, the held-out score
doesn't drop, and the checks are no worse (`scripts/replay.py`). Commit and deploy only on Gavan's
word.

**Measure v2, from 2026-10-15** (testset.json version 2). Gavan, on huntapp-ba's comparison page: on
the ground he expects PALM-narrow with a clearer error, and the tongue plus pale shade look stays. The
shade is drawn as doubt, not scent, so:
- **A miss** is PALM's scent reached by neither the tongue nor the shade. Narrowing can never hide scent.
- **A false alarm** is the tongue alone claiming scent where PALM has not even a trace.
- **The tongue's threat score** is tongue hits / (tongue hits + shade only + misses + false alarms),
  so scent covered only by the shade counts against the tongue.
- **The bar:** misses don't rise, the tongue's threat rises on the tune set and holds held out, and
  the checks' coverage within 1 sd stays honest at 60–80%. That keeps the shade from growing to hide
  misses.
- v1 (the whole cone) stays in every row beside it.
- **Baseline v2** on 8d50465 (with q2): tongue threat 0.50 tune and 0.65 held out, 5 misses, 44 tongue
  false alarms, 10 shade-only.

**The forcing, v4 (ruled 2026-10-16, c4; testset.json `forcing` from huntapp-ba):** the app is forced
with the forecast 10 m of the hour each run stands for (HRDPS; an idealised run uses its 80 m wind × HRDPS's
10/80 for that stability). That is the wind it gets in use. Until v4 the card and palm_compare forced
PALM's own 10 m ambient, which sits in or near a 12–15 m canopy and reads about half the forecast (G1 4.4
against 8.7, dusk288 1.2 against 5). So every speed threshold tuned on them came out about 2× strict: the
deep lee's gate (2/5), the drainage fade d2s1, and the scaled floor rule. They're re-scored on v4 before
live. v3 numbers don't compare with v4. c4 had steered palm_compare to the ambient on 2026-10-15; that
was the mistake.

**Which source rules what (c4, 2026-10-16, on Gavan's "go with the data"):** under-canopy wind speed goes
with the towers, which are direct measurements (26 NEON towers held out, tied to a forecast U10 by
huntapp-ba's ref_wind). Head-height direction and the scent's pattern go with PALM. PALM's realised winds
run low from canopy drag in this setup: its box comes out at about half its forcing, with drag 0.2
against PALM's default 0.15. So the app running faster than PALM under trees (1.38× at base, 2.05× with the
towers' floor rule) is a known divergence, not a fail. One PALM run at drag 0.15 would size how much of it
is drag; it's booked as a later question.

**The card's noise** (2026-10-15): two identical rounds on 058c7e1 differed in 1 cell of 44, the
Lac Bailey shore (L1, n000) toward 180, where the tongue reached 35 m on one run and 43 m on the other,
either side of the 40 m line. Tune set and misses were the same; held out moved 0.64 to 0.68. So a
held-out change of one sector (about ±0.04) is noise, and a ruling looks at which sectors moved, not
the second decimal.

**The bar is the gate to live.** A change that misses it can still go to hunt-dev as a trial on
Gavan's word. The referee reports which part failed, and the change stays off live until that part
passes. First case, 2026-10-15: the q2 spread (option 3) passed every part but one. Its misses went
4 → 5, the new one at P1 am270 toward 090: the app's sunny-morning floor at the slot's west bank runs
180° wrong, and only the old over-wide spread had covered it by accident.

**Two cards, because the card can't see forecast error** (huntapp-ba's finding, 2026-10-15). PALM's
air is forced to a perfect forecast. A cone that honestly covers the forecast's own error (the checks
put the felt wind a median 75° off the forecast at Pickle) scores false alarms here. So the cone's
spread is two parts: **σ² = σ_place² + σ_forecast²**.
- **σ_place** is the meander and turbulence at the spot for that air. PALM measures it, and this card
  scores it: under `setForcedAir` the air is the truth, so σ_forecast is 0.
- **σ_forecast** is the forecast's error by area, hour and regime. The checks measure it, and a check
  at the sit collapses it (`sitAir`, `checkTighten`). `replay.py` scores the total against the checks.
- **A spread change passes both:**
  - this card: misses don't rise, the threat score holds or rises, and held out doesn't drop;
  - the checks: the share of felt directions within 1σ moves toward 68% (51% at Pickle on 2026-10-15)
    and never drops.

  A PALM-fitted cap on σ alone took the checks from 51% to 43%, so it fails.

**What the cone draws** (Gavan, 2026-10-15: option 3 of three). The tongue is drawn bold: where the
scent goes if the forecast is right (σ_place and σ_model, the part this card scores). Around it goes a
faint envelope, the honest spread with σ_forecast added (the part the checks score). Each wind check at
the sit shrinks the envelope toward the tongue. huntapp-ba builds it. σ_model is the app's own
direction error by situation (palm_compare's dirApart). It stays under forced air, so the spread is
σ² = σ_place² + σ_model² + σ_forecast².

## Questions the loop has booked

Runs outside the test set that settle a rule question, booked the way docs/SCENT-TESTSET.md's
ledger books runs: the question, the number that settles it, and the app change that follows.

| run | question | settles when | app change |
|---|---|---|---|
| lacbailey-spot d326 (Gavan's ask, 2026-10-15, `explore`, product priority on xonix) | At 49.39427, -69.55677 under 20:00's NW 10 m wind (326, 8.7 km/h; clear, -1.5 C, +3.8 K over 2–80 m) the app has the ground air from 229 (drainage, about 100° off the wind) and the cone NE, some-minutes reach 226 m (Gavan saw 271 m), now-and-then about 450 m. Does the cold air really drain NE against the wind, and how far does the scent go? | PALM's floor direction and scent reach from the spot (1.5 m and a 5 m stand) against the app's 229 / 226 m / 450 m | the drainage rule on steep ground under a crossing wind, and a candidate picture for the site. **Answered 2026-10-16 (huntapp-ba):** the floor follows the wind, not drainage. Head height from 307 at 0.24 m/s, 10 m from 311 (ambient 4.4 km/h from 329, half the forecast's 8.7). PALM's pull downslope is about 25°, where the app's is about 100°. Scent at 1.5 m runs toward 117–143: some minutes 115 m, now and then 143 m, above the canopy past 120 m. From the 5 m stand, 350 m toward 122–144. The app had NE at 226 / 450 m, about 90° off and twice as long. The spot joins the test set as G1/G1s (v3) |
| pickle-slot s186d15 (queued 2026-10-16, xonix, about 1 h) | PALM's box comes out at about half its forcing, and its floor runs slower than the NEON towers' for the same forecast 10 m (the app is 1.38× PALM at base, 2.05× with the towers' floor rule). How much of that is our canopy drag of 0.2 against PALM's default 0.15? | the head-height and 10 m speeds under trees and in the open against s186 at 0.2, same sources | whether the towers' floor rule (f08) stands against PALM on speed, or PALM's drag is retuned before its speeds count. **Answered 2026-10-16 (huntapp-c4; landed 14:35):** drag is a small part of it. At 0.15 the head-height wind under trees rises ×1.22 (cell median; 1.10–1.36), 10 m under trees ×1.16, and the open and over-canopy winds don't move (×1.02). The box's ambient is 6.49 → 6.62 km/h against a forecast 11.5, so the half-forcing isn't drag. Under trees PALM's head-height over its over-canopy wind goes 0.10 → 0.12, where NEON's towers sit at 0.15–0.40 (a constant 0.28 does best), so PALM's floor stays about 2.3× slow. Head-height direction moves a median 5.7° (90% under 20°). The bands move a little more than a run's own scatter: halves of the 20-minute window overlap 0.53–0.58 within a run and 0.44–0.51 across the two drags. **Ruling:** the towers' floor rule stands for speed under trees, and PALM's speeds there don't count. PALM keeps direction and the scent pattern. The test set stays at drag 0.2, since all 41 runs use it; retuning would mean running them all again for ×1.2 |
| pickle-bogs dawn270 (queued 2026-10-15, xonix, about 8 h; landed 2026-10-16, processed). **Answered (huntapp-ba):** the floor swings with the wind, not along a drainage line. A ~76° swing of the 10 m wind moved the head-height air ~45° at P8–P10 (dawn175 from 241–259; dawn270 from 285–306). What's left is a clockwise offset from the 10 m wind: +49 to +106° under 175, +17 to +39° under 270. That's the box's own terrain and canopy steering (PALM has no Coriolis), so it's a place's turn, which the checks and place memory learn. **No new rule.** At the dawn bog the app already follows the wind and misses only that offset. | Under dawn175 the bog's stable floor came from ~245 while the 10 m wind was 182 and the app kept ~187. Does the floor's turn follow the drainage line or the wind? | the floor's direction at P8–P10 with the wind from 270: still ~245 means drainage, swung by ~90 means the wind | huntapp-ba's stable-floor turning rule: keyed to the drainage line or to the wind (the loop's second direction item) |
| the drainage fade: lacbailey-spot d326u06 and d326u12 (steep ground), pickle-bogs dawn175u06 (flat bog). Gavan, 2026-10-16: "Yes" to accuracy that scales; `validation`, xonix, ~4.5 h, 4.5 h, ~9 h, queued 190–210 | d326 (6.5 km/h forecast 10 m) and dawn175 (6.1) both said the stable floor follows the wind, not the slope. The app's drainage fade only starts at 5 km/h, so it let drainage win at G1. At what forecast wind does the cold air take over, on steep ground and on flat? The same nights at a third and two thirds of the wind (80 m 6 and 12 km/h at the spot, about 2 and 4 km/h at 10 m; 6.5 at the bog, about 2) | PALM's head-height direction at the spot and the bog points: downslope (katDir) or with the wind, and the share of each, at 2 / 4 / 6.5 km/h, plus where the scent goes | one fade curve (thermalTune mix0/mixScale, the slope and the flat) fitted to PALM. It applies in every tile, SD and HD alike, and goes on the four-card bar |
| the surrogate set: whitefish and lacbailey-bank ne045, e090, se135, nw315, plus whitefish w270 and lacbailey-bank sw225 (Gavan, 2026-10-16: "yea - queue"; `explore`, xonix's CPU slot, about 1 h each, queued 090–180) | Not a rule question. These are the wind surrogate's first PALM training cases (the self-improving plan's checkpoint, memory huntapp-compute-service), filling in the rest of the compass at the two held-out boxes: neutral, 12 km/h, the boxes' own scent sources | 10 runs landed and processed | the prototype re-trains the SD U-Net on PALM's head-height wind and is scored held out against the rules. The runs can also join the card as held-out cells once ba's forcing table covers them (forcing = the run's own 12 km/h at 10 m) |
| lacbailey-bank am000 (booked 2026-10-17 by huntapp-jay, Gavan: "Go"; `validation`, xonix, ~40 min) | The nightly loop's own ask, twice (10-15, 10-16): "convective, water in a lee >10°" is the app's worst class against PALM (27% within 45°, 108 points, all from the slot's am270, where the app's sunny upslope floor runs 180° off PALM). Is that the slot or the convective rule? A sunny morning off the land at the bank (N, 12 km/h, am270's mixed layer and fluxes) puts the lake in a 50-90 m bank's lee, a different place and wind | palm_compare's within-45° and reversal recall for "convective, water in a lee >10°" and "convective, forest" on am000 beside am270: the same miss (the app's upslope/thermal floor against PALM's lee return) means the rule; a pass means the slot. Read it fairly: PALM heats the water like the land (no land-surface model), so the app's lakeBreeze cells (73 of am270's 108 water-in-a-lee points) are not a miss PALM can judge; score the cells where the app's regime is wind, calm or upslope | the convective floor rule in model.ts (the upslope share under a wind, its gate) if both runs miss the same way; otherwise the slot's lee only. **Answered 2026-10-17 05:45 (Hunter-Jay): the rule.** PALM's floor over the lee water follows the wind above at the bank too: am000 94% within 45° of the wind 10 m up, reversed 0.16, head/top 1.0 (am270 98% / 0.23; the neutral n000 88% / 0.26); under forest in the same lee it reverses (0.75 / 0.64 / 0.73). The app with water 0.2 (0271e10): am000 water-in-a-lee 62% (regimes wind 47, upslope 16), n000 47% (wind 51, calm 19), am270 43% (lakeBreeze 54, wind 51: PALM cannot judge the breeze). So three mechanisms put the app's floor off over water in a lee: the lee eddy (now 0.2), the convective upslope share and the lee's calm. Next gate for ba: over open water the floor is the wind above; no upslope, no calm, no eddy there |
| pickle-slot dusk288t and whitefish dusk210t (booked 2026-10-17 by Hunter-Jay; Gavan: accuracy first, the machines are the seat's; `validation`; the slot on xonix ~3 h as 203, Whitefish on XEVO's slot ~7 h as 220, its W6/W9/W10 the held-out half of the dusk misses) | Nine of the card's ten misses are stable dusk (P2-P5 dusk288, W6/W9/W10 dusk210), and floor_learn.py found the stable floor's turn is not in the geometry (stable 53 → 56% with a fall-line feature). The app's fade is keyed to wind speed alone. The missing axis is the clock: how long the ground has been cooling. The same evening as dusk288, started an hour before the inversion with a neutral low layer, cooling 1 K/h for 3.5 h, the averaged field every 10 min from 20 min in (build_case.py `series`) | at P2-P5 (and every window), the time and the surface cooling at which the head-height direction leaves the wind above by more than 45°, and at which the still share passes 0.5; read with `palm_to_fields.py --slice` (to build) and floor_learn.py on the slices | the drainage fade keyed to time-since-sunset × forecast wind (thermalTune), replacing the speed-only fade; scored on the four cards; if the turn comes at a cooling the forecast's 2 m / 80 m profile shows, the app reads it from HRDPS, which every SD tile has. **First read, dusk288t (landed 07:26, 19 windows, `series_read.py`):** the box's own 10 m wind dies with the cooling (3.2 → 0.9 km/h over 3 h under an 11.2 km/h forcing at 80 m) and the floor changes with it, not by a step in time: on the slopes where the fall line parts from the wind, the moving floor drains 13% at 30 min, 25% at 60, 37% at 100, 49% at 210, while the share with the wind falls 53 → 39% and the still share rises 45 → 71%; drainage overtakes the wind at ~100-120 min (PALM ambient ~1.4 km/h, about a forecast-equivalent 5 by the stable ratio). At the points: P1/P2 (the bank) go still (0.3-0.5 km/h) by 40 min and drift from ~330, 40-50° right of the forcing, for the rest of the evening; P3 (the bay) runs with the wind at 2.9 km/h at 30 min, reverses by 50 min to come off the land (from ~60-75, 1 km/h) and stays reversed; P4 (120 m N) is still throughout. Reading: in this box time and local wind speed are one axis, so a fade keyed to the local 10 m wind (HRDPS hour by hour) carries the clock, and the soft rise in time (e-fold over ~1 h of cooling) is consistent with r51all's e-fold where u12's step in speed is what a fast-dying wind looks like. Caveat: PALM's cooled cyclic box over-stills the low layer (the Searchmont lesson), so the timing is a lower bound. **The condition checked by ba (08:20) at 130 open ECCC stations, 924k station-hours, falls 2023-26:** in the fade window (forecast 4-6 km/h) the evening forecast is honest on average (obs/fcst 1.02 at dusk and dawn, 0.93 at night, 1.16 → 0.82 as the 80-2 m inversion goes from under 0 to over 3 K), with a third of the '5 km/h' nights calm at 10 m: the U-keyed fade carries the clock, the scatter is the case for the soft e-fold, and a stability shift of the fade's start (+0.5-1 km/h under strong inversions) is parked unless dawn175u06 or Whitefish's series move the crossover off 5. **Whitefish's series, the held-out check (landed 14:05, read 17:50):** a lighter forcing (210 at 8 km/h at 80 m, a forecast-equivalent 3.5 at 10 m, under the fade's 5 from the start). The box is flat forest: still share 71 → 84% (the slot: 52 → 55%); on the slopes the moving floor drains 15% at 30 min, 30% at 60, 41% at 100, 52% at 180, while the share with the wind falls 67 → 13%; drainage overtakes the wind at ~70-80 min (ambient 2.1 of its 3.2 start; the slot at 100-120 min, 1.4 of 3.2). Points: W4 (the marsh bay) keeps the wind all evening at 0.6-0.8 km/h; W1 (the arm's bank) sits 60° left of the forcing at 0.5 from the start; W2 (the marsh edge under trees) is still by 40 min and drifts ~40° left; W3 reverses by 40 min (+60..+100 off the forcing) at 0.3; W5 still, 50° left; W6 still and with the forcing. **What it says for the fade:** at a forecast-equivalent 3.5 km/h the app's fade is whole from the first minute, but PALM's floor follows the wind for the first hour of cooling and drains only once the inversion has built (~1 K); in a cyclic box started neutral that first hour is partly the setup, but the physical gate is real: drainage needs a built inversion, and HRDPS's 80 m − 2 m temperature says that hour by hour in every SD tile. Sent to ba as a candidate: the flat's drainage gated on the forecast inversion as well as the wind |
| pickle-bogstrip dusk288t, lacbailey-bank dusk000t, pickle-bogs dawn175t (booked 2026-10-17 15:30 by Hunter-Jay, on Gavan's "why are XEVO and xonix nearly idle"; `validation`, xonix and XEVO's slot, ~3 h, ~3 h, ~7 h) | The clock at the other boxes: the slot's series put the dusk crossover near a forecast-equivalent 5 and the learned floor lost the stable classes for want of cooling windows outside the slot. The strip holds three of the card's ten misses (P5 dusk288); the bank is the held-out box's shore under a cooling floor; the bog's dawn is the morning's transition the card has never seen (the night's +3.9 K inversion warming 1 K/h) | per window: the time and cooling (or warming) at which each point leaves or rejoins the wind, the still share, the slopes' drain share (series_read.py); the learned floor retrained with every box's windows | the drainage fade's clock across boxes (reopened only if a crossover sits well off 5); the dawn rule (when the pooled floor rejoins the wind); the learned floor's stable classes against the rules, held out. **Strip and bank read 2026-10-18 (Hunter-Jay; series_read.py, 19 windows each). The crossover is not one clock.** Strip dusk288t (288 at 11.2, ambient 4.1 → 1.0): the floor goes still fast (71 → 90%) and what moves drains early: slopes' drain 10% at 30 min, 43% at 50 (overtaking the wind's 42%), 62% at 120, 72% at 180, so the crossover is ~50 min at an ambient of 3.1 of 4.1; P5 leaves the wind by 40 min (282 → 24-58, +100..+130 off the forcing, 0.1-0.3 km/h still) and P6/P7 at the 60 m opening settle from 180-200 (-100 off the forcing) at 0.3: the three P5 misses are the app holding the wind an hour too long there. Bank dusk000t (N at 8, ambient 2.9 → 0.6): no crossover in 3.5 h: drain 5% → 39% by 110 min and flat after, the wind's share 71 → 58%, still 56 → 75%; L1 keeps the wind all evening (+9..+40 off the forcing, 0.2-0.7, still from 130 min), L2/L3 reverse at 40-60 min then sit 30-60° left of the forcing at 0.1-0.3, still throughout. So the ambient at which drainage overtakes the wind runs strip 3.1 > Whitefish 2.1 > slot 1.4 > bank never (down to 0.6): ordered by shelter, not by the forecast wind. A fade keyed to the forecast 10 m alone (the app's) is an hour late at the strip and over-calls drainage at the bank. **Candidate for ba:** key the fade's onset to the app's own local floor wind (the sheltered head-height speed it already computes), not the forecast 10 m: the strip's floor is near still at a forecast-equivalent 5 and drains; the bank's floor keeps a wind. Testable on the four cards. **Bog dawn175t read 2026-10-18 17:30 (landed 16:59 after a night frozen on xonix; 19 windows):** under 175 at 19 km/h at 80 m, warming 1 K/h from the night's +3.9 K, there is no pooled floor to rejoin: the wind owns the floor from the first window (within 45° of the wind above 88-91% throughout, slopes' drain 3-5%, wind 85-89%), the still share falls 29 → 17% as the ground warms, P8/P9 under the edge trees sit 10-25° left of the forcing at 1.3-2.0 km/h (the place's offset, the other way from dawn175's +49..+106 at its lighter wind) and P10 on the open bog runs with the forcing at 5-7. The shipped 80 m fade reads 19 at 80 m as no drainage, which is what PALM shows. So no dawn rule from this run; the morning transition needs a lighter dawn (8 at 80 m, the pool held) to show when the pool lets go. **ba, same afternoon:** the floor-keyed fade (ref 2 on mechG) fails G1 (53 → 31-41%: on the treed slope the sheltered floor is slow, so it drains again, undoing the G1 fix) for +1-6 at the strip and the bog. What separates the strip (drains) from G1 (wind) is the 80 m wind, 10.4 against 16.9, at near-equal 10 m forecasts (5.4 / 6.5); the bank, Whitefish and the slot drain at 8-11 at 80 m. So ref 3: the fade keyed to the forecast's 80 m wind (`lay.w80`, U where the profile has none), variants w11_2 / w12_2 / w13_3 on palm_compare; scorecard.py's forced air now carries the run's kph80 so the card can see it. **Card 1 (Hunter-Jay, 16:53, 25daf99, scores/2026-10-18_1653_25daf99_fade-w80.json):** HD tune set threat / misses / FA: base 0.61 / 15 / 37, w11_2 0.61 / 13 / 37, w12_2 0.60 / 14 / 38, w13_3 0.60 / 14 / 38; HD held out: 0.62 / 11 / 40, 0.61 / 11 / 41, 0.61 / 11 / 41, 0.62 / 10 / 40; SD tune set misses 19 → 18 / 18 / 19, held out 13 → 13 / 12 / 13. Misses bar passes for all three; but the strip's three P5 misses stay M under every variant and P6 gains one at 315, and G1 picks up a false alarm at one sector under w11_2 and w12_2. Card 2 (ba, above): w12_2 all 62.4 vs 62.3, G1 +7, its series +22, strip +4, bank series -3.5, bog dawn -4. **Card 3 (checks, 17:01, 5195 at 25daf99):** Pickle within45 0.434 for all; honest 1 sd base 0.660, w11_2 0.604, w12_2 0.623, w13_3 0.623; Searchmont 0.571 / 0.714 unchanged. Card 4 (towers) cannot move on a fade change (its app side is not built). **Ruling (Hunter-Jay, 17:05): w12_2 passes the bar and ships** — misses don't rise on either grid, direction no worse in aggregate with G1 +7 and its series +22, checks within45 equal and honest 1 sd 0.623 in the 60-80 band (the f08 precedent took 0.679 → 0.642). Its costs are one false alarm at G1's sector 5 on card 1 and the bank's series −3.5 on card 2, both inside unchanged aggregates. w13_3 is the gentler change but gives back G1 (−2.6); the tie-break only applies when the cards tie. ba sets ref 3 w12_2 (mix0 12, mixScale 2, mixS0 12, mixSScale 2) as the default; the reference row moves to w12_2's rows on the shipped commit. The strip's P5 stays the near-still cone's item (#2). **Reference row from 17:24 (5e933a7, scores/2026-10-18_1724_5e933a7_reference-5e933a7.json, identical to w12_2's rows on 25daf99): HD 0.60 / 0.61, misses 14 / 11, FA (tongue) 38 / 41; SD 0.55 / 0.57, misses 18 / 12, FA 35 / 43.** Every later `--patch` reads against it |
| lacbailey-spot d326t, pickle-slot am270t (4 m series), pickle-slot dusk288t at 2 m, pickle-bogstrip b190 at 2 m (booked 2026-10-17 16:00 by Hunter-Jay; Gavan: never idle, forward plan; `validation`; the 4 m ones unpinned, the 2 m ones on xonix; ~3, ~3, ~8, ~5 h) | Four questions the day's results left: (1) Gavan's own spot at dusk as a clock (d326 at 6.5 km/h was wind; when does the steep floor leave it on the real evening); (2) the morning transition at the slot under W (the am270 misses: when the pooled floor rejoins the wind and the lee's backflow sets in); (3) is 4 m coarse for the still-and-drift answer: the slot's dusk series again at 2 m; (4) the cone at the strip's 60 m opening (P6/P7, where SD and HD differ most) at 2 m against the 4 m b190 | (1)-(2) series_read.py's clock tables; (3) the 2 m series' crossover, still share and drain share against the 4 m's window by window; (4) the P6/P7 bands at 2 m against 4 m on the card's measure | (1) the fade at Gavan's spot and a Dig-in note; (2) a dawn rule (the floor rejoining the wind as the ground warms); (3) whether stable runs must go to 2 m; (4) whether the strip's cone needs the 1 m water and walls or the 4 m answer holds |
| pickle-slot dusk288tp (booked 2026-10-17 18:10 by Hunter-Jay on ba's caveat; `validation`, ~3 h) | The dusk series' onset (drainage overtaking the wind at 100-120 min at the slot, 70-80 at Whitefish) rides a neutral start and a prescribed 1 K/h: real slopes cool 2-4 K/h in the first hour after sunset, so the onset may be PALM's spin-up. ba's inversion gate (6a113d9, setThermalTune inv0/inv1 on the forecast's 80-2 m θ) is parked until that is known | the same series with 1 K already built over 2-80 m at t0: drainage in the first windows (the onset was setup) or at the same clock (physical) | if physical: a series harness (palm_compare per slice with the app's layering from each slice's own θ(80)−θ(2)) to fit inv0/inv1; if setup: the gate stays parked and the fade stays keyed to the wind |
| pickle-bogs dawn175tl (booked 2026-10-18 17:45 by Hunter-Jay; `validation`, xonix after 280-300, ~7 h; order 310) | dawn175t at 19 km/h at 80 m never pooled, so it answered nothing about the morning transition. The same night profile (+3.9 K) and warming (1 K/h for 3.5 h) under a light morning wind, 8 at 80 m (a forecast-equivalent ~3.5), where the shipped 80 m fade keeps the pool whole | series_read.py's clock: the window and the surface warming at which P8-P10 leave the night's drift and rejoin the wind above, and the still share's fall | the dawn rule: how the app lets the pooled floor go as the ground warms (today it has no morning clock at all), keyed to the forecast's warming and the 80 m wind |

The loop's working order (huntapp-ba and huntapp-c4, 2026-10-15): **direction before width**. The
width knobs (gustSize, meander, spread.swing) trade false alarms for misses one for one, so they hide
direction error. The loop ranks the head-height direction gap by situation from palm_compare (PALM
against the app under forced air); ba takes the top one or two each round.

**The order, revised 2026-10-16 (twice):**
1. **Drainage against a real wind (one cell: G1).** At Gavan's Lac Bailey spot, mech10 was about
   3.2 km/h and the app's drainage (1.97 km/h) beat the head-height wind (0.46). PALM's floor follows
   the wind, but the app's fade only starts at 5 km/h. Scoring is under way (huntapp-ba's drain-floor,
   with the towers' floor rule, on Gavan's "go with the data").
   **2026-10-16 night (c4's calls):**
   - **f08 (the towers' floor ×0.8, c0 0.168) passes the bar against base.** Card misses 16 → 11, false alarms 95 → 87, held out 0.57 → 0.59, tune 0.53 → 0.52 (within ±0.04). palm_compare 65.1 → 64.5, all on stable runs, mostly dawn175's place offset. Checks within45 unchanged, honest 1 sd 0.679 → 0.642 (in band).
   - **The fade:** ba's drain_read (66b1a5d) on the stable runs says drainage holds to ~5.4 km/h forecast 10 m and is gone by 6.1–6.5, on slope and flat alike. The r-fades are re-scored with slope and flat both set (r51all / r5all), and the tie-break goes to the softer scale.
   - **fit-drain** stays off: turn plus ratio already lets checks beat drainage.
   - **The SD column, first numbers** (`scorecard.py --grid both --patch pipeline/teacher/palm/sd-tiles.diff`, HEAD 09d8e85 with f08 + r51all). The national tile at the same points as HD:

     | | tune | held out | misses | false alarms |
     |---|---|---|---|---|
     | HD | 0.53 | 0.62 | 10 | 83 |
     | SD | 0.51 | 0.57 | 18 | 87 |
     | SD with the stand bands (88's dbd189e + 6822795, ba's c2d2cef; a29dee0) | 0.50 | 0.59 | 16 | 79 |

     SD loses most at the bog edge under trees, the cold-air pool, the bank slope, the slot's am270 and the gap between two waters. With the stand bands (the towers' floor and the scent's closure on national tiles), held out is within the noise of HD (0.59 against 0.62). What's left is mostly what 30 m can't see: the bog strip's 60 m opening (P6/P7 b190), the slot's lee (P3 nw315), the cold-air pool (0.50 → 0.33) and the bank slope (0.62 → 0.50).
   - **Found on the way:** the scent read the area's habitat by the mosaic's index, so every puff came out NaN at Whitefish. ba fixed it in 2ac1df7 (habitatAligned). The same guard means the towers' floor (f08) and the scent's closure and bush **don't apply on SD tiles**, because the tiles carry no crown, conifer or hardwood bands, so SD runs on the old baked share and default stands. Part of the SD gap is that. The fix is the bands in the tiles (habitat-lite already makes them from SCANFI), which is 88's bake and Gavan's call.
2. **The cone at near-calm stable sits** (the dusk288 misses at P2–P5). This is not drainage: there the
   app's drainage direction is within about 30° of PALM's floor (huntapp-ba's per-point diagnostic). So
   it's the cone's width or reach. c4 had first put these misses down to drainage, wrongly.
3. **The am270 sunny floor.**
4. **Drainage direction at Whitefish** (W3, W10 run opposite to PALM's floor): the baked katDir
   against PALM's 4 m terrain. A separate item.

The deep lee shipped to dev (narrow-tongue-lee-eddy).

The order before that, 2026-10-15, after the narrow-tongue patches:
1. **The deep lee's return flow** (nw315 at the slot: the app's floor is dead calm while PALM runs the
   eddy back up the slope at about 0.25 of the wind).
2. **The am270 sunny floor** at the narrows.
3. **The slot's stable dusk** (dusk288).
4. **The bog's stable turn** (dawn175, settled by dawn270).

First pass on v2 (2026-10-15): **narrow-tongue-lee-eddy** (patch B's kicks; the deep lee's gate 2/5 km/h and a return speed of 0.1 of the wind, which is PALM's 0.09-0.125; the scent column following the floor in an eddy; the shade at q=1) took the tongue's threat from 0.50 to 0.53 on tune and 0.65 to 0.72 held out, misses 5 to 5, tongue false alarms 44 to 29, checks coverage 68% / 71%. It passes; live is Gavan's word. Watch: the cold-air pool (P10) fell 0.40 to 0.25. Harness: palm_compare moves to PALM's 10 m ambient, as the card uses.

Before that, a narrow tongue (huntapp-ba's patch B: kicks from the wind above, 0.02 + a·U10·(1 + 0.35·tumbling),
fitted to PALM's turbulence at ratio 1.0) is ready but fails on misses: 5 → 11, all wind. It goes
back on the card after each wind fix.

## The seat's night of 2026-10-17 (huntapp-jay)

**SD v2 trial, scored 00:26-00:49 by c4's score_trials.ps1, provisional.** Two faults in the chain: HEAD moved under it
(v1 on 19443bf, v2t on b4f7b5d, v2t2 on f264cc8; model.ts and scent.ts changed between), and the 12-tile list
had no bogstrip tiles (t-630-410/411), so v2t and v2t2 scored 15 runs where v1 scored 18. On the same 15 runs
(from the saved score JSONs):

| SD version | tune | held out | misses | false alarms |
|---|---|---|---|---|
| v1 | 0.52 | 0.59 | 11 | 73 |
| v2t (lee3 retrain) | 0.52 | 0.56 | 14 | 75 |
| v2t2 (lee3 + provincial wetlands) | 0.53 | 0.56 | 11 | 77 |
| HD, same runs | 0.53 | 0.62 | 7 | 79 |

v2t's misses rise (11 → 14, the 5 m stand 2 → 4 and the bog edge 0 → 1), so the lee retrain alone fails the
bar; its expected gain at the bank (bank slope 0.50, shore under a bank 0.65) does not show. v2t2 holds the
misses, lifts the cold-air pool 0.33 → 0.43 (88's read: the wetland opens the bog cells, crown 41 → 0, share
0.12 → 0.24 against HD's 0.72) and loses the bog edge under trees 0.55 → 0.38 and the open strip 0.70 → 0.58.
**Like for like, 02:07-02:18** (the bogstrip tiles baked into both trial folders by the seat with v1 paused; all three
scored on f264cc8, 18 runs):

| SD version | tune | held out | misses | false alarms |
|---|---|---|---|---|
| v1 | 0.50 | 0.59 | 16 | 79 |
| v2t (lee3 retrain) | 0.50 | 0.56 | 19 | 81 |
| v2t2 (lee3 + provincial wetlands) | 0.51 | 0.56 | 17 | 83 |
| HD, same runs | 0.53 | 0.62 | 10 | 82 |

**Neither trial passes the bar**: misses rise (16 → 19, 16 → 17) and held out falls 0.59 → 0.56 on both. v2t2's one
gain is the cold-air pool (0.33 → 0.43, the wetland opening the bog cells) against the bog edge under trees (0.47 →
0.38) and a new miss at P2 am270. The lee retrain's expected gain at the bank does not show (bank slope 0.50, shore
under a bank 0.65 → 0.61). **The seat's recommendation to Gavan: no national v2 re-bake; v1 stays.** What the pool
still lacks is the stand round it (SCANFI 9 m / 41% against the FRI's 6 m / 18%), a stand-attribute source question
for the bake seat (provincial FRI where it is open, as the wetlands were), not a net retrain.

**A PALM-taught floor, first pass** (`pipeline/teacher/palm/floor_learn.py`; Gavan: "Yes"). Every 4 m run
(33, one per case and wind) pooled to 20 m windows; targets the head-height turn from PALM's own wind 10 m
over the canopy, the head/top share and the still share; features an SD tile has (canopy height, cover, LAI,
water, slope and its parts along and across the wind, Winstral shelter at 100 and 300 m, relief, edge
distance, upwind fetch, the top wind's own share and turn, stability, forcing); LightGBM, leave one box out.
Windows where the floor is mostly still (head under 0.5 km/h; 52% of them) are left out: there is no
direction to learn.

- **It does not beat the rules.** At the loop's points, moving windows: app 78% within 45°, follow-the-wind-above
  76%, learned 74%. The app is strongest in stable forest (61–88%), where the learned floor is 30–40%: the
  drainage work carries there and the features do not.
- **It wins in the lees, and the reason is a rule:** over open water in a lee (Sx ≥ 10°) PALM's floor follows the
  wind above (|turn| median 9–23°, 88–100% within 45° on the neutral runs, reversed 0.01–0.5), where the app
  reverses it (slot w270: app 145° off the forecast, appRev 0.80, PALM 68° and 0.06; nw315 0.65 vs 0.47; the
  bank's n000 0.60 vs 0.13). Under forest in the same lees PALM does reverse (0.4–0.9). So the deep-lee return
  flow is right under trees and wrong over water. Sent to ba as a rule fix (gate the return flow off over
  water, or scale it by canopy), not as a model. Caveat: am270's water-in-a-lee miss is the app's lakeBreeze
  regime, which PALM cannot judge (the water is heated like the land).
- **Speed:** the learned head/top share is within 2× on 89% of windows against 38% for a constant, with
  ambient speed, the top wind's share and shelter as the drivers. That is the towers' story again from PALM
  (and PALM's floor runs slow, so the level is not to be trusted; the pattern is).

**ba's lee-over-water knob, eff536b (setLeeTune `water`, open's 0.6 by default), refereed 01:42.** Four cards:
PALM HD base 0.53 / 0.62, misses 10, FA 82 → water 0.2: 0.59 / 0.61, misses 10, FA 80 (the 5 m stand 0.60 → 0.69,
lee slope 0.55 → 0.59); water 0: 0.59 / 0.61, 10, 79. SD 0.50 / 0.59, 16 → 0.52 / 0.59, 17 (the new miss is P2 am270's
lakeBreeze cell, which PALM cannot judge) → water 0: 0.49 / 0.57, 17. Checks card: direction unchanged, honest 1 sd
64.2 → 62.3% Pickle (in band), Searchmont 71.4%. palm_compare (ba): water in a deep lee 42.8 → 46%, reversals 0.42 →
0.12, land and trees unmoved. Towers untouched. **Passes at water 0.2** (tie-break the gentler; water 0 loses on SD);
ba sets the default and pushes to hunt-dev. Watch P2 am270 on SD when am000 lands.

**The drainage fade at u12 (02:44) and ba's slope-only variants, refereed 03:29-03:50.** drain_read: the slope drains
0.42 at a forecast 2.7, 0.47 at 5.5, 0.22 at 6.5 (G1 from 211 / 236 / 307): a step between 5.5 and 6.5, where the
shipped r51all fades from 5 (0.61 at 5.5). Variants at 0271e10, slope only (the flat waits for dawn175u06): s55_1
(mixS0 5.5, scale 1), s55_05 (scale 0.5), s6_05. PALM card HD base 0.59 / 0.61, misses 10 → s55_1 0.59 / 0.62, 10 →
s55_05 0.59 / 0.61, 10 → s6_05 0.59 / 0.62, 10; SD 0.52 / 0.59, 17 → 0.52 / 0.58, 17 → 0.52 / 0.59, **18** → 0.52 /
0.58, 17. s55_05 fails on the SD miss; s55_1 takes the tie-break. palm_compare 63.8 → 63.7 (the spot runs −2..3, all
else unchanged); checks unchanged. **Passes, with no measurable gain**: the only slope point at 5-6 km/h is G1, already
fixed. Recommended to ba as the physics-backed default; **ba held it** (03:55): palm_compare falls on exactly the two runs
it touches (d326 53 → 50, u12 49 → 47), so with no card gain the shipped 5 / 1 stays. Slope and flat get fitted together
once dawn175u06 and the two dusk series are in, and the question becomes whether the step moves with the clock.

**The card scored a load state (found 03:40-04:10, Optimus's behaviour-neutral hour-stamp commit a225e55 moved the HD
row).** scorecard.py's CONE_JS awaited microReadyFor only, which loads the two momentum directions of the hour's
*forecast* wind; the card forces another direction, so momentumAt asked for its own two and the lids stood in until they
landed mid-run, and ensureRelief (the going grid: riseUpwind, waterAt) is only asked by loadRestOfMicro, which the card
never awaited (palm_compare and replay always did). The HD rows varied run to run with the main thread's speed (0271e10:
10 misses at 03:29, 11 at 03:52, Whitefish sit speeds halving between runs); the SD column, without momentum, did not.
Fixed by 04:30 in two steps: loadRestOfMicro resolves at once when a prior call started it, so the card now also awaits
the going grid (routes/goingGrid.ts loadGoing) and the habitat (spots/habitatGrid.ts loadHabitat) by name, and reads the
first sit until two reads 1 s apart agree; it prints "waits: going habitat settled" per evaluate. **Deterministic from 04:33:
0271e10 scored twice, 0 of 79 sits differ.** Every HD row before that is a load-state row (per commit they agreed in total
and differed by up to 12 sits); the night's verdicts (lee-water, a225e55's neutrality) are re-scored on the settled card.
The nightly loop runs the same scorecard.py, so its 10-17 round is the new reference and does not compare with 10-16.
**Re-scored on the settled card, 04:52-05:45:** a225e55 identical to 0271e10 on all 79 sits (Optimus's hold lifted); the
lee-water rows reproduce exactly (base 0.53 / 0.62, 10, 82, 34 → water 0.2: 0.59 / 0.61, 10, 80, 28; SD 0.50 / 0.59, 16 →
0.52 / 0.59, 17), so the night's shipped change stands as scored.

**ba's two water gates, 98293b1 (thermal.waterAna: the sun's upslope over open water; floor.waterShelter: the least
shelter a tree line leaves over open water), refereed 07:08-07:35 on the settled card.** HD base 0.59 / 0.61, misses
10, FA 80, shade 28 → wa0 same → ws05 0.59 / 0.62, 10, 79, 27 → **wa0ws05 0.61 / 0.62, 10, 79, 24** → wa0ws1 0.58 /
0.61, 10, 81 → ws1 0.59 / 0.62, **11**. SD base 0.52 / 0.59, 17 → wa0 16 → ws05 16 → wa0ws05 17 → wa0ws1 **19**. Checks:
ws05 honest 66.0%, wa0ws05 62.3%, direction unchanged. palm_compare (ba, 84k points): water in a deep lee 46.4 → ws05 47.4
/ wa0ws05 48.4 / ws1 49.6; convective water 84.4 → 88.3 / 90.8 / 93.4; land 59.6 unmoved; calm share over lee water 0.27 →
0.17 (ws05) / 0.08 (ws1); app head/10 m 0.31 → 0.43 (ws1) against PALM's 0.46. **Verdict: wa0ws05 passes all four cards;
ws1 fails on misses (HD 11, with wa0 SD 19).** ws05 alone also passes; ba chooses, sets, pushes to hunt-dev. **Shipped 07:50: wa0ws05 is the default, 67c59f8 on hunt-dev**
(the push carried Optimus's 13 simplification commits on Gavan's OK). ws1's 07:29 row was scored on a half-installed
worktree (the loop's 07:11 re-run broke it: npm ci EPERM on a native binary the previous card still held; prepare()
now retries) and is re-scored. hunt-dev's base is now f08 + r51all + lee water 0.2 + waterAna 0 + waterShelter 0.5. **ws1's true row (08:14, sound
worktree): HD 0.59 / 0.61, misses 9 (one fewer); SD 0.54 / 0.58, misses 19 (two more): fails on SD.** hunt-dev's HEAD
67c59f8 scored as base: HD identical to the wa0ws05 variant on all 79 sits; SD misses 19, with Whitefish W2/W2s shade →
miss (2.64 → 2.86 km/h) against the variant's 17. **22a12d3 cleared** (identical to its parent 67c59f8 on all 158 sits);
the tiles on R2 are unchanged since 10-16 21:23; so the 17 is the variant scored fourth in a five-variant card and the
19 the same values scored alone as defaults. ba's discriminating test (09:17, 67c59f8, SD only, the same defaults as three variants a/b/c): all three 0.53 / 0.58,
misses 17, identical on every sit. So the shipped defaults read SD 17 (= the variant, = base): wa0ws05 holds the SD bar.
The two 19 readings were both `--grid both` cards, where the SD pass follows the HD pass in one browser; every SD-only
card reads 17. **Pinned down 09:40:** windTiles.ts fetchTile cached a failed tile fetch as a blank tile for the page's
life (one transient R2 failure → a block tile on default stands for a whole card). Optimus's 2e4ff4b drops the null from
the cache; the card records each block tile's fetch status and reloads when one is not 200. **hunt-dev's reference row
(67c59f8, a browser per grid): HD 0.61 / 0.62, misses 10, FA 79, shade 24; SD 0.53 / 0.58, misses 17, FA 77, shade 35.**
But two later `both` cards at 67c59f8 and at Optimus's 2e4ff4b (the tile-cache fix, HD identical to its parent) read SD
19 with every block tile fetched 200, so the two-state is not a failed fetch: it is an ordering inside the page (the
area grid's late loads against the mosaic's adoption), now awaited uncapped before the jump and logged (block, centre)
per run. Four Whitefish-only SD cards (10:19-10:25, 67c59f8, the same block 660/418, the same centre, every tile 200,
with and without the area's loads awaited) read Whitefish's misses 5, 7, 7, 5: W2 in the two states (2.64 km/h / σ 41.2 and 2.86 / 39.2), so the cause is inside the
page and unseen from outside; the shape (σ and speed at a stand under trees) says the momentum/turbulence source at that
cell differs at sampling time. ba's dev handle (233dbaf, window.__micro) is logged per sit; twelve Whitefish s210 SD cards (microA-L) show both
states (eight "17", four "19") with __micro identical at W2 every time (mosaic in, momentum and turbulence 16/16, the
forced direction's pair in, turbAt 14.5, stand from the grid, going grid in, relief readable, W2 not water). What is
left was a cached derived value, and ba's fuller handle (40c8c6c: the call taken apart) named it (callA-F, 2:4):
**at.leeRiseCached 6.18 against 4.72 m at W2's cell and sector**, with spread.model 70 → 40 (the lee class), kmh 2.64 →
2.86 and sigma following, every other field equal. The lee's rise is cached by cell and sector, so whichever bearing
first fills the slot (the page's own forecast wind in the load-time heat pass, or the card's forced 210) sets it.
ba's reading: not the bearing but the scan's origin, the exact point that first asked for the cell and sector (a heat-pass
sample a few metres off scans a different line on the 10 m going grid). First fix 4b2731c (scan from the 30 m cell's centre)
failed card 2 (deep lee 55.3 → 48.8: the going grid's detail lost); **2a30c8e keys the lee's rise by the going grid's
10 m cell** and passes all four: HD 0.61 / 0.62, misses 10, FA 79 → 77, shade 26; SD 0.54 / 0.57, misses 19 (W2/W2s now
deterministically the fresh-rise state, 2.86 km/h / σ 39.2, twice identical), FA 79; checks Pickle 43.4% / honest 66.0%,
Searchmont unchanged; palm_compare deep lee 55.3 → 56.6, all 63.8. **The SD column is deterministic sit by sit from here;
hunt-dev's reference after ba's push: HD 0.61 / 0.62, 10, 77, 26; SD 0.54 / 0.57, 19, 79, 32.**

**Booked:** lacbailey-bank am000 (the loop's convective water-in-a-lee ask), queue 202, validation; pickle-slot
dusk288t (the dusk as a cooling series), queue 203, validation; whitefish dusk210t, the same at the held-out box, queue 220
on XEVO's slot. Order on xonix: 200 → 202 → 203 → 210 → 212 → sdst → explore; XEVO: 140 → 220 → explore.

**WindNinja at 10 m on the slot's LiDAR DTM (212 wntest, landed 11:55; `wn_fine.py score`, against PALM's 10 m wind
over the box's core, 8 neutral directions):** the 10 m solve beats the 30 m HD solve a little in every direction
(median |turn − PALM's| 6.5–17.3° against 6.8–18.2°; within 10°: +1 to +7 points; within 20°: +1 to +5), but the
lee directions stay where they were (w270 17.0°, nw315 17.3°, 27–33% within 10°, against 6.5° / 69% along the
channel). Finer terrain is not the lee's problem; a steady neutral RANS solve is. **Verdict: not worth moving HD's
bake to 10 m for this; the gain is a degree.** The lee needs stability and a return flow, which the rules carry.

**The fade, closed by ba 14:30:** dawn175u06 (flat, forecast-equivalent 2.6) follows neither the wind (within 45°
0.52 → 0.33) nor a fall line: near-still and wandering, as the slot series' bank points; the app already calls that
pooled or calm with a wide spread. r51all stands as shipped (mix0 / mixS0 5, e-fold 1); reopened only if Whitefish's
series puts its crossover well off a forecast-equivalent 5.

**The decisive test, 14:50 (Gavan 13:30: no sunk cost, incremental against holistic, decided by test): a floor learned
from PALM on HD's own inputs.** floor_learn.py with the LiDAR leaf-area profile by layer (the PALM static drivers'
LAD: 0-2, 2-6, 6-14, 14+ m), 1 m water, shelter at 100 and 300 m, edge distance, upwind fetch, the fall line, stability,
and the clock (the slot's 19 cooling windows as rows with t_cool); 90k windows from 57 runs, 51k moving; LightGBM,
leave one box out; against the rules at the loop's points (wind-2026-10-17.csv, c54733f):

| within 45° of PALM's floor | app (rules) | follow the wind above | learned |
|---|---|---|---|
| all points | 76% | 74% | **78%** |
| neutral | 90-96% in forest/tree line/water | 92-98% | 91-99% |
| convective | 66-100% | 80-100% | 80-100% |
| stable forest | **59%** | 37% | 46% |
| stable forest in a lee >10° | **68%** | 35% | 34% |
| stable tree line in a lee | **75-77%** | 46-53% | 50-58% |
| neutral tree line in a lee >10° | 54% | 52% | **70%** |
| neutral water in a lee >10° | 46% (before the water gates) | 91% | **98%** |

Last night's SD-grade version read app 78 / learned 74; the canopy profile and the clock moved the learned floor +4,
and it now edges the rules by two points overall. **But it loses where the misses are**: in stable air the rules beat
it by 10-30 points in forest, in lees and at tree lines (the drainage and lee work), and it wins only the geometric
classes the rules have just fixed or can fix (lees in neutral air, water). By stability it beats follow-the-top
everywhere (stable 42 → 48%), so there is signal; what it lacks on the stable floor is data with the clock: only the
slot has cooling windows, and held out, the slot's are not in its training. **Verdict: no clear win for the holistic
path at this data; the rules keep the stable floor; the learned floor is not wired in.** The holistic path is not
dead: it needs stable series across boxes (Whitefish's lands today; a second box's clock is the next data point) and,
at scale, the run program of "more compute". Score to beat for it: the rules at 2a30c8e on the four cards, held out
by box, with stable dusk the class that decides.
Retrained 18:15 with Whitefish's 19 cooling windows (two boxes with a clock, 48k stable windows): the same picture:
78 vs the rules' 76 overall; stable 45% against follow-the-top's 42; stable forest 50 (rules 59), stable tree line 57
(59), stable forest in a lee >10° 30 (68); Whitefish held out 48 against 49. A second box's clock did not move it: the
stable floor is not learnable from these runs' geometry and clock at this size.

### Backlog, ranked (the queue is kept a day deep from here; Gavan 2026-10-17: never idle)

1. A PALM run with a land-surface and radiation model at one box (am270's lake breeze, the sunlit slope): can the
   teacher judge the convective and lake classes at all? Needs PALM's modules in the build and build_case support;
   a day of the seat's work before a run.
2. PALM's floor level scaled to the towers' before the speed-gated rules are read (post-processing, no compute).
3. The scent threshold's sensitivity (NOSE 5.5% is a guess): the card at 4, 5.5, 7, 10% (minutes).
4. The slot's dusk from 225 and 180 (does the crossover depend on the wind's angle to the slot).
5. Whitefish's dawn series; Lac Bailey's bank dawn.
6. The strip's dusk at 2 m if (3) above says stable runs need it.
7. The neutral surrogate-set runs (held/150-180) only if a terrain net is wanted again.

## Order

1. Gavan approves the points and the winds.
2. The owner writes `testset.json` from the tables, builds `scorecard.py` and scores the baseline on the cells
   already run.
3. The owner builds the service on xonix first, then XEVO's modes.
4. The 7 runs go in as jobs naming their cells. Whitefish's points go to Gavan before its runs.
5. Rule changes get scored against the card (scent and wind-field fixes alike).

Related: docs/SCENT-TEACHER.md (the ledger and the strategy by biome), docs/TEACHER.md, docs/MICRO-WIND.md
§5b, pipeline/teacher/palm/README.md.
