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
| **PALM owner** (the referee) | huntapp-c4, named by Gavan | the service, the cases, `pipeline/teacher/palm/`, the queue, the test set, the scorecard | change app rules |
| **Rule builder** | huntapp-ba | the app's wind (`model.ts`) and scent (`scent.ts`) changes, each scored on the card as a `--patch` | edit the PALM kit, the queue or the card |

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
- **The runner** is `palm_runner.sh`, in `surrogate/palm/bin/` on the share. There's one per slot:
  xonix has one (22 cores, always on) and XEVO two (7 cores each). Each job runs from a fresh local
  copy of bin/ with `--ship lean`. To stop a machine's slots, `touch queue/stop-<host>`.
- **XEVO's mode** is `queue/mode-xevo`: `off` takes nothing, `idle` (the default) takes one run when
  Windows' CPU has averaged under 25% for 15 minutes on mains power, and `on` takes two. XEVO's slots
  start with `xevo_slot.sh 1` and `2` (Start-Process wsl.exe, in its header). The old `xevo-queue.txt`
  and `xevo_runner.sh` are retired: they stopped after their last runs on 2026-10-15.
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
| W1–W8 | whitefish (new case) | to pick | one per situation in its core: a shore, a bog's edge, a windward tree line, a cut between walls, a lee slope, a drainage floor, a 5 m stand | none yet |

The ring sources in each run are scored too, as extras, outside the headline. The owner picks Whitefish's
points from its 1 m LiDAR and habitat and shows them to Gavan on a map before any Whitefish run.

### Winds per box: two neutral and one stable

| box | neutral 1 | neutral 2 | stable | to run |
|---|---|---|---|---|
| pickle-slot | s186 ✓ (4 m and 2 m) | w270 (XEVO, running) | dusk288 ✓ | none once w270 lands |
| pickle-bogstrip | b232 ✓ (`_sit2`, true positions) | b190 at 4 m (`_test`, queued) | dusk288 (XEVO, running) | 2 |
| pickle-bogs | nw305 (xonix, running) | | dawn175 ✓, dusk288 (shipping lean) | 1 |
| lacbailey-bank | n000 ✓ | s180 (queued) | dusk000 ✓ | 1 |
| whitefish | the prevailing W | N | dusk | case + 3 |

Where they run, 2026-10-15 at 15:20:
- **xonix:** bogs nw305 (since 14:43), then the next job in the queue.
- **XEVO:** slot w270 and the strip's dusk288 on its last old runners. Its new slots wait in `idle`.
- **Queued:** Lac Bailey s180 and strip b190 `_test`, taken by whichever machine is free first.
- **The 2 m strip b190 never ran:** the old chain's run script failed to start it, so the 4 m `_test`
  run fills that cell.

Whitefish follows once Gavan has seen its points.

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

## Order

1. Gavan approves the points and the winds.
2. The owner writes `testset.json` from the tables, builds `scorecard.py` and scores the baseline on the cells
   already run.
3. The owner builds the service on xonix first, then XEVO's modes.
4. The 7 runs go in as jobs naming their cells. Whitefish's points go to Gavan before its runs.
5. Rule changes get scored against the card (scent and wind-field fixes alike).

Related: docs/SCENT-TEACHER.md (the ledger and the strategy by biome), docs/TEACHER.md, docs/MICRO-WIND.md
§5b, pipeline/teacher/palm/README.md.
