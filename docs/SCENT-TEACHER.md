# PALM as the scent cone's teacher

Status: 2026-10-14, wired in: every run build_case.py makes now carries the particle block (README, "Scent in every run"); `palm_to_scent.py read | bands` turns the output into the how-often bands. Nothing is typed after a run: `run_case.sh` marks it DONE and `postprocess.py` (XEVO's scheduled task "Groundwind PALM post", every 15 min, or run_case.sh itself on XEVO) converts the field, makes the bands and keeps `fields/RUNS.md`. The reruns are queued as `scent-chain.sh` on the share. No run with particles has been made yet: the 4 m slot is rebuilt and checked, its rerun on xonix is Gavan's call. The harness (the cone on PALM's field) is not built. Gavan's steer: "two birds with one stone", improve the wind
modelling and the scent together. The PALM runs that teach the wind surrogate ([TEACHER.md](TEACHER.md))
get scent releases added to them; the same run then writes the field the surrogate learns from and the
plumes the cone's rules are fitted to.

## What the cone gets by rule today, and what PALM measures

The app's cone ([MICRO-WIND.md §7](MICRO-WIND.md), `app/src/weather/micro/scent.ts`) is a Lagrangian
particle-puff plume on the ground-wind field, scored as *how often* a nose gets noticeable scent. Its
knobs are rules. PALM resolves the real plume at 2 m and 2 s with the trees in it, so each rule can be
measured in the situations the app cares about.

| factor | the cone's rule | what PALM gives |
|---|---|---|
| where it goes | advected on the app's field | plume bearing with distance; separates field error from cone error (see harness) |
| meander | 12° + 70°·exp(−U/0.6) plus adders: canopy +8°, swirl +40°, slot +25°, lee tumble, gusts | lateral spread σy(x) per situation; each adder becomes a fitted number |
| upward mixing | Briggs rural σz by stability, +1 m body wake | σz(x) in the open, under canopy, across a windward edge (the lift that takes scent over the first trees), in the lee |
| under the trees | slower wind, same rules | residence time under canopy and the drift toward openings |
| stable air | σz toward class F, ground-hugging, drainage | the Searchmont stable runs: does scent hug the floor, does it drain |
| how often | NOSE 0.055 of the core, Langevin 20 s, meander 2.5 min, six realisations | concentration time series at fixed points 10–300 m out: true intermittency by distance and situation |

The last row is the cleanest calibration available and the first to do.

## Integration: particle groups in the existing runs

PALM v25.10.1's Lagrangian particle model (`&particle_parameters`) allows **10 particle groups per run**,
each with its own release box, so one run carries up to ten scent sources. Particles ride the resolved
flow plus a subgrid random walk, reflect at the ground, and die at a set age. Checked in the installed
source (`lagrangian_particle_model_mod.f90`, `mod_particle_attributes.f90`: `max_number_of_particle_groups = 10`).

`build_case.py` gets a `scent` block per run, like the existing `viz` block, and emits:

```
&particle_parameters
    number_of_particle_groups = 8,
    ! one group per source: a 1 m box at chest height (psb/pst over the lowest ground, see note)
    psl(1) = 1023.5, psr(1) = 1024.5, pss(1) = 1574.5, psn(1) = 1575.5, psb(1) = <z_ground+1.0>, pst(1) = <z_ground+1.5>,
    pdx(1) = 0.5, pdy(1) = 0.5, pdz(1) = 0.5,
    ... (2)..(8)
    dt_prel = 2.0,                        ! a release every 2 s: 9 particles per source per release (3 x 3 on the 1 m box)
    particle_advection_start = <end - avg - 900>,   ! 15 min before the averaging window, so the plume is established
    end_time_prel = <end>,
    particle_maximum_age = 900.0,         ! 15 min, the cone's own horizon
    use_sgs_for_particles = .T.,          ! the subgrid walk: the part a 2 m grid does not resolve
    density_ratio = 0.0, radius = 0.0,    ! passive, no inertia
    bc_par_b = 'reflect', bc_par_t = 'absorb', bc_par_lr = 'cyclic', bc_par_ns = 'cyclic',
    seed_follows_topography = .T.,        ! psb/pst are heights over the cell's own ground (checked in the source)
    dt_write_particle_data = 20.0,        ! positions, origin and group every 20 s
/
```

Notes.
- `seed_follows_topography = .T.` adds the cell's stair-stepped ground to psb/pst (lpm_init_particles,
  `zw(k_surf)`), which is what a release "1.5 m over the ground" means in the model.
- Also add `'pc'` and `'pc_av'` to `data_output` (particle concentration per cell, all groups): the
  total plume for pictures, and a sanity check on the per-group reconstruction.
- Cost: 10 sources × 9 particles / 2 s × 900 s alive ≈ 40 k particles, 8 MB a write, about 0.8 GB for
  the slot's hour at a write every 20 s. Small against the 2 m slot run (5 h on xonix). The 4 m boxes
  (25 min on xonix) are the place to iterate.
- Output: PALM writes the particle data as Fortran unformatted records per rank
  (`lpm_data_output_particles`): per cell, `prt_count`, then each particle's attribute record
  (x, y, z, origin_x/y/z, age, group, id, weight, ...). A reader in `palm_to_scent.py` (numpy
  structured dtype, record markers) turns them into per-source positions by `group`. No Fortran needed.
  If the layout fights back, the fallback is the user module writing per-group counts, which does need
  the Fortran user interface.

### Which runs

Existing cases, reused as they are (same terrain, canopy, forcing), rerun with the block added:

| case | situation it teaches | sources |
|---|---|---|
| pickle-slot (2 and 4 m) | slot, exit turn, edge lift at the bay shore | west bank of the throat, both banks 60 m up the arm, the exit, the bay's north shore, the hill top, under canopy 40 m in |
| pickle-bogstrip, pickle-bogs | open bog, bog edge, scent across a clearing | bog centre, bog edge both sides, 30 m into the trees |
| lacbailey-bank | shoreline, bank lift | the bank, 50 m back, over the water |
| searchmont stable / neutral / midday | stable floor, drainage, lee rotor, the sit rule | the floor check, the climb, the lee of the hill, the river reach |

Two release heights where it matters: 1.5 m (standing) and 5 m (a stand), as separate groups.

## The harness: same metric, same grid

1. **PALM → how-often bands.** From the particle positions, for each source: nose-height
   (1 m, reflected) concentration on the app's 10 m grid every minute over the window, then the
   share of minutes above `NOSE` × the core's steady value, in the app's three bands. Also: bearing of
   the plume centroid with distance, σy(x), σz(x), the share under the canopy, and the concentration
   time series at the fixed points.
2. **The cone, twice.** Run `scent.ts` for the same sources (a) on the app's own field for that hour,
   (b) on PALM's mean 2 m field converted to the micro grid (`palm_to_fields.py convert` already does
   this for the surrogate). (b) isolates the cone's rules from the field; (a) − (b) is the field's share
   of the error. `scent.ts` is wired to the map, so this runs in the browser through the replay
   harness (`app/scripts/replay.py`), the field injected as the micro grid.
3. **Score.** Band overlap (IoU per band), reach error at the "some minutes" band, bearing error,
   share of noticeable minutes by sector, and intermittency vs distance.
4. **Fit by situation.** The meander adders, the σz modifiers (canopy, edge lift, lee), the Langevin
   and meander time scales and `NOSE`, by situation (slot, shoreline, canopy edge, open, lee, stable
   floor), leave-one-out across cases. Same logic as WIND-LEARNING.md's lessons by situation.

## What to watch

- The slot run's forcing came out low (5.6 vs 11.5 km/h). Compare in scaled terms: distance over
  U·T, ratios against the open-ground plume in the same run.
- Six cases is a small sample; the deliverable is the shape of each rule by situation, not constants.
- PALM's canopy is leaf area density drag, not trees; filaments under 2 m are not resolved. The metric
  is minute-scale noticeability, which the grid resolves.
- Stable dusk matters most for the sit rule and is the hardest for PALM. Do Searchmont stable early.
- Particles see no deposition: scent that would stick to wet leaves does not. Note it, do not model it.

## First step

Add the block to `pickle-slot_s186_4m` with eight sources, rerun on xonix (about 25 min), write the
reader, compute the bands for the throat source, run the cone on the same mean field, put the two maps
side by side. One comparison says whether the rules are close and which knob is farthest off before the
full grid is committed. Then the 2 m slot and the Searchmont stable run.

Related: the showcase's smoke ([PALM-3D.md](PALM-3D.md), `pipeline/teacher/palm/pickle-slot/viz/sim_smoke.py`)
is the offline version of step 1 on the saved snapshots; the in-run particles replace it.

## First run with particles: the 4 m slot at 186°, 2026-10-14

`pickle-slot_s186_4m_scent`, 40 min on xonix (22 ranks), 3.0 GB of particle output (104 writes, up to
40,500 alive), read and banded by `postprocess.py` without a hand on it. Products in
`pipeline/raw/teacher/palm/fields/pickle-slot_s186_4m_scent_scent.{json,png}`, `_scent_<k>.npz`.

| source | some-minutes reach | toward (10–30 / 60–120 / 120–240 m) | intermittency at 20 / 50 / 100 / 200 m | σy, σz at 30–60 m |
|---|---|---|---|---|
| throat west bank 1.5 m | 236 m | 045 / 052 / 046 | 0.95 / 1.00 / 0.92 / 0.71 | 7.5 m (9°), 2.0 m |
| throat west bank 5 m | 417 m | 040 / 045 / 040 | 0.88 / 0.95 / 0.88 / 0.90 | 10.8 m (13°), 5.4 m |
| the exit 1.5 m | 166 m | 055 / 042 / 034 | 1.00 / 1.00 / 1.00 / 0.24 | 6.5 m (8°), 1.0 m |
| bay, over water 30 m S of the shore, 1.5 m | 623 m | 020 / 023 / 016 | 0.81 / 0.02 / 0.14 / 0.00 | 14.3 m (18°), 4.0 m |

Read with care:
- **Cyclic lateral boundaries sent particles round the box again**: about half the rows. PALM shifts a
  wrapped particle's `origin_x/y` by the box, so `bands` now drops every row whose origin is not at its
  source (the table below is after that), and later builds absorb at the edges (`bc_par_lr/ns = 'absorb'`).
  The 2 m run queued the same afternoon still has cyclic edges; the filter covers it.
- The large σz first seen near the sources was the wrapped particles; filtered, a head-height release
  in the channel has σz 0.9 m at 10–30 m, 2 m at 30–60, 5.7 m at 60–120, 11 m at 120–240 and 23 m at
  240–480 m, close to Briggs rural D (3, 5.5, 10, 17 m at 50/100/200/400 m).
- The channel does what the field said: scent from the west bank runs toward 045–056° out of the throat,
  and from 5 m it carries twice as far as from head height.

### What the 4 m run says about the cone's rules (one neutral run, wind 6.5 km/h in the box)

1. **A slot narrows the cone; the rule widens it.** Lateral spread at head height in the channel is
   9–13° (1σ of the crosswind scatter over the distance), and it does not grow with distance. The cone's
   spread at this wind would be about 16° before adders, then +8° canopy and +25° slot. The slot adder has
   the wrong sign here. Over the open bay the near spread is 18–20°, narrowing to 8° by 200 m.
2. **Upward mixing in the channel follows Briggs D.** σz 2 / 5.7 / 11 / 23 m at 45 / 90 / 180 / 360 m
   against Briggs' 3 / 5.5 / 10 / 17 m. The rule holds where the air runs clear.
3. **The shore lift takes scent over the noses at once.** From the bay source, 81% of writes carry scent
   at nose height 20 m out, 2% at 50 m, 0% at 200 m: the air lifts at the shore and the plume rides over
   the first trees (mean height 6 m at 30–60 m, 9 m at 60–120 m). The cone's edge handling piles scent
   up at the edge; this says the opposite, and matches PALM-3D.md's lift.
4. **Scent stays in the trees near the source.** 90% of the particles are under the canopy within
   30 m, 70% at 30–60 m, 40% at 200 m, 20% at 400 m. The cone's +8° for canopy is a direction knob;
   the effect to model is retention and slow drift toward the channel.
5. **How often, at head height, in the channel**: 95–100% of minutes out to 50 m, 92% at 100 m,
   71% at 200 m. The "most minutes" band reaches about 200 m at 6.5 km/h; "some minutes" 236 m.
6. **A stand doubles the reach.** From 5 m: 417 m against 236 m, 88–90% of minutes all the way to
   200 m, at the cost of a lower share at 20 m (88% against 95%).

Not yet a fit: one run, one stability, forcing at half the forecast's speed, a 4 m grid, and the cone
has not been run on this field (the harness). The 2 m run will test 2 and the near-source numbers.


## The outcomes ledger (Gavan, 2026-10-14: "CPU time is heavy, I want clear outcomes on both")

A run is booked before it starts: the question it settles for the wind and for the scent, the number
that settles it, and the change in the app that follows. A run that cannot fill the last column is not
run. `postprocess.py` gives the numbers; this table gives them a verdict.

| run | wind question | scent question | settles when | app change |
|---|---|---|---|---|
| pickle-slot s186 **4 m** (done) | does the slot lock the head-height air on the channel (049–053°)? yes | does a slot narrow or widen the cone? **narrows: 9–13°** | the 2 m run agrees within 5° | drop the +25° slot adder; a slot *locks* direction (`micro/model.ts`, `scent.ts`) |
| pickle-slot s186 **2 m** (running) | same jet and turn at 2 m: the 4 m answer is not a grid artefact | Briggs D in the channel; near-source σz; lift at the bay shore | σz within 30% of 4 m; shore intermittency at 50 m under 10% | keep Briggs; add the shore-lift rule: scent crosses a windward tree line over the first trees, not into them (replaces the edge pile-up) |
| pickle-slot **w270 / nw315** 4 m | the lee of the 68 m hill: reversal at the floor, or the slot? (WindNinja drew a wake) | where does scent go from a stand in the lee: back up the hill? | reversal share at head height by Sx class | the lee tumble adder's size; the backwards cone (Blanchard) |
| pickle-slot **dusk288** 4 m, stable | cold air down the lee slope against the backflow | does scent hug the ground and drain (σz, under-canopy share at dusk)? | ground-hugging share vs the neutral run | the stable σz blend (toward class F) and the drainage rule for the sit |
| pickle-bogstrip b190 / b232 4 m | a 60 m strip between 14 m walls: along-strip steering both ways (logged) | the cone in a clearing between walls: spread, reach, retention in the walls | strip steering within 15° of the logs | the strip rule's width/direction terms |
| lacbailey-bank n000 / dusk000 4 m | the bank's lee at the shore and the lift | scent from a stand on the bank: over the water or down the bank? | arrival at the shore, lift height | the shoreline rules (SHORE-WIND.md) carried into the cone |
| searchmont stable (10 m) | the floor reversal at dusk (felt 308) | does dusk scent pool on the floor; how far along the valley | reversal share; pooled area | the sit rule's "below while air drains" with a cone that follows it |

Cost: a 4 m box is 25–40 min on xonix; the 2 m slot about 5 h; Searchmont at 10 m hours. Order by
decision value: the 2 m slot (running), then w270 and dusk288 on the slot, then the bog strip, then
Lac Bailey, then Searchmont stable with particles.

**The piece that turns runs into app changes is the harness**: the app's cone run on PALM's mean field
for the same sources, scored against the bands above. Until it exists every row's "app change" is a
judgement; with it, each is a measured gap. Build it before the next long run.

**The bigger option, noted, not chosen**: the PALM cones read better than the app's. Rather than tune
rules, a scent surrogate (the wind surrogate's flywheel: terrain + canopy + the local field in, the
how-often footprint out) could replace the cone in HD areas. It needs hundreds of sources, not ten per
run (PALM's group cap), so either the Eulerian scalar with a user module or the offline tracer on saved
3D fields. Decide after the harness shows how far the tuned rules get.

## Run strategy (2026-10-14): by biome, spin up once, release many

Gavan: wind and scent are interlinked and the CPU is expensive, so be strategic about which tests and
how; prefer biome by biome (do Ontario well, then Quebec, the foothills, the mountains) over the hard
one-off (Searchmont's 235 m valley is harder to solve and comes later).

### Principles, in order of CPU saved

1. **Spin up once, release many times.** The cost of a run is the flow settling; particles are nearly
   free. PALM restarts from a settled run: one spin-up per case and direction, then 20-minute restart runs
   each carrying ten new sources, about a third of the cost per source set. This is how the ten-group cap
   stops mattering. `run_case.sh` needs `--restart-from <run>` (palmrun `-a "d3r"`, the restart data kept)
   with a fresh `&particle_parameters`. Build it before the next batch.
2. **Sources by situation, not by ring.** Each run's ten sources placed on purpose for the biome's
   situations (a clearing's centre and both edges, 30 m into the trees, a stand at 5 m, the lee slope,
   the bank, over the water), so one wind run tests four or five cone rules. The ring stays only as the
   default where nothing is listed.
3. **Breadth at 4 m, confirmation at 2 m, never discovery at 2 m.** A situation needs about two
   directions, plus one stable case where the sit rule applies: about two hours of xonix per situation at
   4 m. 2 m only where a 4 m answer hangs on a feature narrower than about eight cells (the slot).
4. **The harness decides where the money goes.** The app's cone on PALM's field and on the app's own
   field, same sources: field error against cone error, per situation. Field-dominated situations send the
   next spend to wind (surrogate, stations); cone-dominated to rules or a scent surrogate. No CPU on xonix.
5. **Anchor on a field check.** Prefer runs where the wind was felt or logged (the slot, the strip both
   ways, the bogs' evenings, the Lac Bailey bank): the wind side validates for free, the scent side sits
   on a known field.
6. **Stop when two runs agree** on a rule's sign and size within tolerance.
7. **Stability where the sit rule lives** (floors, banks, bogs), one stable run per situation; not for slots.

### By biome

| biome | areas (cases) | situations that decide a hunt there | state | method |
|---|---|---|---|---|
| **Ontario boreal shield** (lakes, bogs, slots, low hills, 70% canopy) | Pickle Lake (`pickle-slot`, `pickle-bogstrip`, `pickle-bogs`), Whitefish Lake, Searchmont's bogs | slots between waters; bog edges and strips between walls; a calm floor's drift and pooling at dusk; stands in mixed canopy | 4 m runs done for the slot (8 winds), the strip (3), the bogs (1); scent on the slot only (s186) | cyclic 1–2 km boxes at 4 m; restarts for sources; 2 m to confirm the slot |
| **Quebec shield lakes with banks** (bigger relief at the shore, the Bailey LiDAR) | Lac Bailey (`lacbailey-bank`) | the bank's lee at the shore, the lift, cold air down the bank at dusk, a stand on the bank | 4 m runs done for 4 winds, no scent yet | same boxes; the bank is 50–90 m so a 1 km cyclic box holds it |
| **Foothills** (long slopes, valleys with 200+ m of relief, hardwood-conifer mix) | Searchmont (`searchmont`); the Sault test area | the dusk floor reversal, drainage down the valley, the lee rotor, the climb | 10 m runs done (stable, neutral, midday); the climb needs offline nesting; no scent | cyclic 5 km at 10 m works for the floor; the climb and anything steeper wait for offline nesting or the GPU solver. **Later**, after Ontario and Quebec |
| **Mountains** (subalpine, treeline, 500+ m of relief) | Blanchard River, Highland (ArcticDEM), the Yukon eddies, the elk areas (CO GMU 24, BC 4-22) | thermals and slope winds, treeline edges, lee eddies, basins | nothing in PALM; the bush model fails north of Ontario | cyclic boxes cannot hold the relief: non-cyclic nested PALM or the GPU engine (TEACHER.md Track B). Scoped, not scheduled |

Order: Ontario to a verdict on every row of its ledger, then Quebec, then the foothills, then the
mountains once a non-cyclic method exists.

### Booked next, in order

1. **Harness** (no CPU): the cone on PALM's mean field and on the app's field for the slot's ten sources;
   the per-situation split of field vs cone error.
2. **Restarts in run_case.sh** (no CPU): spin-up kept, scent-only restart runs.
3. **Ontario, one night at 4 m, sources designed per situation:** the slot's lee (w270, nw315), the
   strip both ways (b190, b232), the bogs' dusk (dusk288, stable). Each booked in the ledger with its
   wind and scent question. Reads with the slot's 2 m run (running) for the slot verdicts.
4. **Quebec, half a night:** Lac Bailey n000 and dusk000 with sources on the bank, back from it, over the
   water.
5. **Decide**: rules tuned by situation, or a scent surrogate, from the harness's split.
6. Foothills (Searchmont with particles, one stable run) only after 1–5; mountains when a method exists.

### The night they were winded: bog strip, 30 Sep 2026, b232 (2026-10-14)

Three sat in the strip at 18:00 under a forecast from 232° at 13 km/h: Gavan at position 3
(48.95393, -85.55057, under 13 m canopy at the strip's east edge, in a slight hollow), 2 at 73 m west
of him in the open strip, 1 at 87 m west and 49 m north at the north-west wall (from the party
picture: 1-2 49 m, 2-3 73 m, 1-3 99 m). 1 and 2 heard a bull to their south; Gavan never did; the bull
winded them.

The b232 run (neutral, box wind from 233° at 7.9 km/h over the trees against the forecast's 13.3):
the floor air at 2 m over the last 20 minutes, 40 samples 30 s apart:

| | canopy | mean toward | N | E | S | W |
|---|---|---|---|---|---|---|
| 3, Gavan | 13 m | 058°, 1.8 km/h | 38% | 55% | 5% | 2% |
| 2 | open | 101°, 1.2 km/h | 30% | 38% | **28%** | 5% |
| 1 | 3 m | 099°, 1.2 km/h | 30% | 48% | **20%** | 2% |

Verdict: in the open strip the floor air went south in a quarter of the samples, the app's "some
minutes" band (>= 15%), while the mean said east. A bull south of 1 and 2 was in that band; Gavan's
scent under the canopy went south one sample in twenty. The mean cone would have called 1 and 2 safe;
the how-often picture would not. This is the clearest field case so far for scoring the cone on
minutes, not on the mean. All three positions are now scent sources of the case; `pickle-bogstrip_b232_4m_sit`
is queued on XEVO to give their plumes directly. The stable version of this evening is the next booked
question: does the pooled, cooling floor send more or less of the strip's scent south.

### The other evening: bog strip, 29 Sep 2026, b190 (processed 2026-10-14 23:xx)

Forecast from 190° at 15 km/h, 70° off the strip's 300/120 line; Gavan logged the air toward W, W, NW.
From the point in the strip at head height the run's scent runs toward 338–353°, the forecast alone
would run toward 010°: the strip steers the plume about 30° toward its line, in the sense he logged,
short of the W–NW he felt by 30–60°. From the strip's south-west wall (the old ring sources at 180–270)
the scent runs W to SW for the first 60 m, under the canopy, before turning north: closest to his logs.
Both evenings now say the same two things: the strip steers in the right sense but the neutral run
steers less than the man felt, and the floor under the walls drifts sideways.

Lesson for the tooling (huntapp-ba, 23:01): a case rebuilt while its run waited in the queue
relabelled b190's groups. `bands` now takes each group's source from the particles' own origins (the
most common origin, since wrapped rows carry shifted ones; origin_z is the release height) and uses the
case list only for names; `run_case.sh` keeps the namelist a run used in `<run>/INPUT/`.

The true positions (Gavan's pins at Pickle, 23:12): 2 at 48.95390, -85.55183, in 12 m canopy 92 m west
of 3; 1 under the trees at the bog's edge (Gavan), 48.95419, -85.55213, 10 m canopy, 12 m south-west of the
picture's pin. With those, b232's floor air at 1 went **south in 42% of the samples (mean toward 187°
at 0.9 km/h)**, at 2 south 18% and west 30%, at 3 south 5%. The corrected verdict: 1, under the trees
at the bog's edge, had the mean cone itself on the bull; the earlier numbers were for spots 15–20 m off, which is how far a
position can be wrong before the answer changes in a strip. `pickle-bogstrip_b232_4m_sit2` is queued
with the true spots (the first `_sit` rerun carries the approximate ones).

### The harness, first half (2026-10-15 00:10)

`app/scripts/cone_export.py` runs the app's own cone for named sits on a past hour (the clock set, the
archived forecast, `simulatePlume` as the phone calls it) and writes its how-often grid and reach by
sector in PALM's bands; `pipeline/teacher/palm/compare_cones.py` puts it beside `palm_to_scent.py`'s
bands for the same sits and draws the pair of roses. `app/scripts/sit_shot.py` gives the app's picture
of the same evening for the stories. For the 30 Sep strip at 18:00 the app's cones: 1 toward 135° (28%
of minutes, some-minutes reach 107 m, 107 m south), 2 toward 135° (27%, 93 m, 83 m south), 3 toward
045° (26%, 129 m, 76 m south): rings with a south-east lean at 1 and 2. Against PALM's air at the sits
(1 south 42%, 2 south 18%, 3 south 5%) the app has the sense but not the contrast between the sits.
The second half, the cone on PALM's own field, is not built; it needs the converted field injected
as the micro grid.

### The 2 m slot run against the 4 m: the ledger's verdicts (2026-10-15 00:53)

`pickle-slot_s186_2m_scent`, 7.2 h on xonix, 13 GB of particles, post-processed by itself in 4 min.

| | 4 m | 2 m | verdict |
|---|---|---|---|
| throat, chest height: toward at 10–30 / 30–60 / 60–120 m | 045 / 050 / 052 | 044 / 040 / 045 | **agrees within 5°: settled.** A slot locks direction; drop the +25° slot adder |
| throat, chest height: some-minutes reach | 236 m | 237 m | settled |
| lateral spread σy at 30–60 m | 7.5 m (9°) | 11.8 m (15°) | 9–15°, against the rule's ~49°: a slot narrows the cone |
| σz at 45 / 90 / 180 / 360 m | 2.0 / 5.7 / 11 / 23 | 3.3 / 7.2 / 12.3 / 20.7 | **Briggs D (3 / 5.5 / 10 / 17) holds within 30%: keep** |
| stand at 5 m: reach | 417 m | 478 m | a stand doubles the reach: settled |
| the exit: reach, toward at 120–240 m | 166 m, 034 | 212 m, 032 | the turn toward the open water: settled |
| bay source, nose-height share at 20 / 50 / 100 / 200 m | 0.81 / 0.02 / 0.14 / 0.00 | 0.80 / 0.73 / 0.78 / 0.28 | **not confirmed.** At 2 m the scent crosses the bay's north shore at nose height most of the time; the 4 m "lift takes it over the noses at once" was the coarse grid's shore (8 m trees in two cells). The lift is real in the mean height but does not clear the noses. The edge rule stays as it is until the bank runs (Lac Bailey) say otherwise |
| throat, nose-height share at 200 m | 0.71 | 0.37 | the "most minutes" band at chest height ends nearer 100–150 m than 200 m |

App changes that are now settled from two runs: the slot adder's sign (a slot locks and narrows), the
Briggs mixing curve kept, a stand's reach. Open: the shore lift (bank runs), the canopy-edge drift
(the strip's sit runs), stable air (dusk288, the bogs).

### The true-spot rerun of the winded night (`pickle-bogstrip_b232_4m_sit2`, landed 04:24, 2026-10-15)

Plumes from where they sat (neutral run, box wind 60% of the forecast's):

| sit | reach south, most / some / now | toward (10–30 / 30–60 / 60–120 m) | nose-height share at 20 / 50 / 100 m |
|---|---|---|---|
| 1, under the trees at the bog's edge | 12 / 32 / 47 m | 212 / 079 / 064 | 0.22 / 0.15 / 0.05 |
| 2, in 12 m canopy | 37 / 46 / 73 m | 104 / 089 / 070 | 1.00 / 0.93 / 0.62 |
| 3, Gavan, the east edge | 0 / 0 / 0 m | 057 / 058 / 056 | 0.63 / 0.35 / 0.13 |

Reading: the air's rose at 1 (south 42% of samples) and the plume from 1 (a pool, 30–50 m, drifting
south-west then taken east) are both true: in near-calm air under the edge the scent does not travel
with the floor's direction, it pools and leaks. The app's cones there were 100 m rings with a
south-east lean. A bull further than ~50–70 m south of 1 and 2 was not in this neutral run's scent.
What decides it: the bull's distance when heard (Gavan asks 2026-10-15) and the stable evening run
(cooling air in 1's hollow). Harness picture: `site/media/winded-strip-compare.png` (compare_cones.py).

Note (huntapp-ba, 2026-10-15 morning): an uncommitted terrain-lee rule in `micro/model.ts` (MICRO-WIND.md
§5b, waiting on Gavan) changes the app's head-height field in the lee of 5–15° rises, and so the app's
cone there. `pickle-bogstrip_b232_appcone.json` was exported before it (the strip has no rise over 5°
within 300 m, so it should not move). Re-export app cones after that rule is decided, and record the
app commit in the json. `model.ts` has script-only `setForcedAir` and `setLeeTune`; the harness can use
`setForcedAir` to run the cone on the forecast each PALM run was forced with. Its own score
(`app/scripts/palm_compare.py`): 68 → 72% within 45° over 18 Pickle and Lac Bailey runs, 38 → 60% where
the rise is over 10°, Searchmont held out 69 → 75%.
