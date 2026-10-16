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
| pickle-bogs dawn270 (queued 2026-10-15, xonix, about 8 h) | Under dawn175 the bog's stable floor came from ~245 while the 10 m wind was 182 and the app kept ~187. Does the floor's turn follow the drainage line or the wind? | the floor's direction at P8–P10 with the wind from 270: still ~245 means drainage, swung by ~90 means the wind | huntapp-ba's stable-floor turning rule: keyed to the drainage line or to the wind (the loop's second direction item) |

The loop's working order (huntapp-ba and huntapp-c4, 2026-10-15): **direction before width**. The
width knobs (gustSize, meander, spread.swing) trade false alarms for misses one for one, so they hide
direction error. The loop ranks the head-height direction gap by situation from palm_compare (PALM
against the app under forced air); ba takes the top one or two each round.

**The order, revised 2026-10-16 (twice):**
1. **Drainage against a real wind (one cell: G1).** At Gavan's Lac Bailey spot, mech10 was about
   3.2 km/h and the app's drainage (1.97 km/h) beat the head-height wind (0.46). PALM's floor follows
   the wind, but the app's fade only starts at 5 km/h. Scoring is under way (huntapp-ba's drain-floor,
   with the towers' floor rule, on Gavan's "go with the data").
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

## Order

1. Gavan approves the points and the winds.
2. The owner writes `testset.json` from the tables, builds `scorecard.py` and scores the baseline on the cells
   already run.
3. The owner builds the service on xonix first, then XEVO's modes.
4. The 7 runs go in as jobs naming their cells. Whitefish's points go to Gavan before its runs.
5. Rule changes get scored against the card (scent and wind-field fixes alike).

Related: docs/SCENT-TEACHER.md (the ledger and the strategy by biome), docs/TEACHER.md, docs/MICRO-WIND.md
§5b, pipeline/teacher/palm/README.md.
