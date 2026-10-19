# Plan: a wind model that learns

Status: proposed 2026-10-11, nothing in it built beyond what each layer
says exists. Gavan asked what world class looks like for the wind after
a Searchmont evening the app got backwards. This plan joins the pieces
already planned elsewhere:
- [SCALE-PLAN.md](SCALE-PLAN.md): the engine and the floor under the trees;
- [GPU-SOLVER.md](GPU-SOLVER.md): the GPU engine;
- [SURROGATE.md](SURROGATE.md): the net;
- [MICRO-WIND.md](MICRO-WIND.md) §8: the wind checks.

It doesn't repeat their designs. Other threads working on the wind should
build toward the layers below.

## What set it off

Searchmont, 2026-10-10, Gavan's shared checks (D1 `checks`), times EDT:

| Time | Where | Felt or seen | Forecast | The app's call there |
|---|---|---|---|---|
| 17:33 | 46.7774, −84.0482, valley floor, 233 m | from 308°, light, two puffs (303, 313) | from 152°, 15 km/h | from 156°, 2.3 km/h, ±88° |
| 18:24 | treetops 500 m SE, seen from the same spot | from 180°, light | from 152° | — |
| 18:25 | the same spot | calm | from 152° | from 301° (the local blend had taken the 17:33 check) |

The treetops agreed with the forecast; the floor ran nearly backwards,
steadily.
- **The place:** the Goulais valley floor runs NE–SW here. The ski hill
  rises toward 152° (236 m at 0.75 km to 387 m at 1.5 km); another wall
  rises to the NW.
- **The likely cause:** an SSE wind across the valley sets up a rotor,
  with the air at the floor reversed. Sunset (~18:55) helps, as the
  valley's cooling air decouples from the wind above.
- **The SD wind** calls the spot from 166° at 0.84 of the ambient. It
  reverses under 0.2% of the area for SSE winds: neutral WindNinja at
  30 m smooths rotors away, and the net learned from it.

The next morning (2026-10-11, 10:58–11:57 EDT) Gavan walked from the
valley floor to the top, with a forecast of 190° at 11 km/h:
- **The valley floor (235 m)** read from 249°, along the valley, not
  reversed. A southerly wind both times, the floor backwards at dusk and
  channelled at midday: what differs is the time of day (stability), so a
  lesson has to be filed by it.
- **The top (330–420 m)**, five felt checks: 180–237° and one 299°, mean
  215°.
  - Scored puff by puff, the median miss was 11° for the forecast and
    28° for the app.
  - Scored on the mean, it reverses: the forecast was 25° off, the app's
    calls (mean ~202°) 13°.
  - The nearest public wind, MNRF's Ranger Lake fire weather station
    (35 km ENE, 507 m), read 224–234° at 7–14 km/h, gusts to 29, during
    the walk. That points to a SW ambient, with the forecast too far
    south.
  - The two scorings disagree because the puffs are a spread. Score
    checks as samples of a distribution, not one by one.
- **The app chased the puffs.** Each check takes 90% of the call within
  ~100 m for an hour: after a 236° puff at 11:30 it called 234° at 11:33,
  where he then felt 180°. The region-wide bias lesson was small (1–16°,
  ×1.2–1.4).

A third visit (2026-10-18, 13:47–14:27 EDT, build f392094): eight checks
(11 puffs and the treetops once) on a 700 m walk NE along the foot of the
ski hill's W/NW face, 25–50 m above the floor, 1.1–1.7 km E of the 10-10
spot. Forecast 215° at 18 km/h; Ranger Lake 229°, the Sault airport 226°:
a SW ambient the forecast had right.
- **The air came from the W.** Puffs and the treetops read 264–284°, ~50°
  right of the ambient. The hill's spurs rise 4–17° within 60–240 m to
  the SW; to the W the ground falls open to the valley. So the wind bends
  round the hill's foot and comes in off the valley: with 10-11's 249° on
  the floor, two days of a S–SW ambient reading WSW–W low in this valley.
- **Reversals behind the nearest bank.** Where a 17° bank stands 60 m SW
  (13:57–13:59), puffs from 127° and 139° came between puffs from 282–284°;
  500 m on (14:12) one from 57° a minute after one from 241°.
- **Replay** (replay.py --loo, a5f99fa, the 20 Searchmont checks): the raw
  map (no checks) had 4 of 7 felt within 45°, the forecast 4 of 7. Its
  good calls were very good (14:11 9°, 14:27 1°, the turn toward W at the
  foot already in the SD wind) and it called the bank's lee calm (306°,
  347°) where he felt breezy W with the SE puffs. The checks helped each
  other for the first 15 minutes (13:47: 41° → 18°) and then hurt: the W
  checks pulled 14:11 and 14:20 another 40° W (9° → 47–71°, 52° → 77–94°)
  where the air was SW–S. Distance can't tell the hill's foot from the
  ground 300–500 m on; likeness has to (layer 4). Lessons from 10-10/10-11
  barely reach these spots (1+ km away): across all 20, other days' checks
  moved the blend 56 → 62% within 45°, median 40° → 34°, mostly on 10-11.
- **A fold that invents a direction.** The 13:59 check folded two puffs
  143° apart (139°, 282°) and saved their mean, 210°: no puff came from
  there, and it lands on the forecast, so it scores as a hit. A check whose
  puffs part by more than ~90° should keep the steadier side or save as
  swinging, not the mean (windChecks.ts fold).

One evening and one morning are a hypothesis, not a proof. They are also a
clean test case for everything below.

## The principle

Physics teaches the model. Each hunter's checks steer it on the spot.
Everyone's checks correct it over time.

A learned overlay trained on checks alone comes last, not first:
- **There's too little data.** There are 7 shared checks, all from one
  phone (since 2026-10-08).
- **The checks are skewed.** They are sparse, noisy and taken where
  hunters stand.
- **Checks can't teach the physics.** A rotor depends on stability and
  on the terrain in 3D; physics runs supervise every cell, direction and
  stability.

Checks are what judge each release, and they are the steering on the day.

## Five layers

Each layer does one job. The phone holds 3 and 4; the server holds 1, 2
and 5.

### 1. The physics teacher

- **Job:** get the hard cases into the base: rotors, night drainage,
  sun-warmed slopes, canopy drag.
- **What:** solves with stability (stable, neutral, convective) and trees
  in them, on the surrogate's seed sites plus test cases like the
  Searchmont valley under an SSE wind. The candidates are PALM with
  canopy drag, or the GPU engine of GPU-SOLVER.md once it has stability.
  This is SCALE-PLAN's phase 4 with stability added to its brief.
- **Exists:** WindNinja momentum, neutral, terrain only. The seed set is
  480 runs (312 done on 2026-10-11, the rest due that evening on xonix
  ×10 + XEVO ×2); it stays neutral. Its kits' DEMs can serve a stability
  teacher as they are. SURROGATE.md §1 states the current net's limits
  (no stability, drainage or rotors) and points here.
- **Kit fact:** WindNinja writes its turbulence scratch file under a fixed
  name in the working folder. `run.ps1` starts each run in its own folder
  (1e5f5e3), and any new runner or variant must keep that, or two runs
  finishing together swap turbulence.
- **Measured evidence** (the surrogate thread, 2026-10-11; Zenodo 8226638,
  `pipeline/surrogate/idaho.py`, SURROGATE.md §5):
  - **Big Southern Butte, 55 sensors.** WindNinja's speed-ratio r is 0.40,
    against 0.15 for the mass-consistent layer (0.46 against 0.16 on
    exposed ground; 0.67–0.78 in the SW–W sectors).
  - But it over-contrasts both ways. Predicted speed-ups over 1.3 measure
    1.11 at the median, and predicted lee shelter under 0.5 measures
    0.57, so its absolute error is no better than a uniform wind.
  - The turning can't be tested there: the vanes carry fixed offsets of
    13–95°.
  - **Salmon River Canyon:** no skill for any model. Its strong winds are
    night-time drainage down the canyon, decoupled from the wind above:
    stable air a neutral solver cannot have.
  - So today's teacher gets the shape of synoptic speed-up and shelter
    and nothing thermal. **The canyon's 27 sensors at night are a ready
    test set for a stability teacher.**
- **Gate:** the teacher reproduces the Searchmont reversal (or whatever
  stations there show), and wins SCALE-PLAN's tier scoreboard.

### 2. The surrogate, v2

- **Job:** the teacher's physics anywhere in seconds, with its own doubt.
- **What:** stability (and canopy height) as inputs. Outputs the wind,
  the turbulence and a spread per cell, trained on layer 1 plus the
  WindNinja runs.
  - The grid gains bands per stability class, so watch the phone's
    budget.
  - The on-phone student in SURROGATE.md is the way past it.
- **Exists:** v1 (neutral, WindNinja's teacher), serving every SD area.

### 3. The backwards solve, on the phone

- **Job:** what the air above the trees is doing right now: the fast
  state.
- **What:** the unknowns per sit are the ambient direction, speed and
  stability class. The forward model is the area's grid (the 16
  momentum directions, interpolated). The prior is the HRDPS forecast.
  - Each check is weighed by what it can see. Treetops, open ground and
    ridges pin the ambient; a floor check in a slot or a lee mostly
    tests the place.
  - The answer is the ambient's posterior, and which candidate dynamic
    (rotor, drainage, channelling, speed-up) explains the checks.
- **What the hunter sees** (Gavan, 2026-10-11, via the surrogate thread:
  "they just need to see the right output, or be told to sample a few
  more times, and when to sharpen the wind"). The candidates are the
  model's own state, not something the card explains. The loop's
  outputs are three:
  - the wind it believes;
  - "check again", when the top candidates can't be told apart by the
    checks it has;
  - a prompt to Sharpen the wind, when one more check would settle it.

  The reasons go to the devlog, and to Dig in at the most. This replaces
  the 2026-10-08 wording, "the card says the most likely reason".
- **Exists:** `ambientFit.ts` (MICRO-WIND §8), one turn and ratio over
  2.5 km. It can't tell a wrong forecast from an odd spot. With a second
  floor check at Searchmont it could have turned the air ~150° for 2.5 km
  round, against the treetops.

### 4. Place memory, on the phone

- **Job:** "the last times the wind was SSE at dusk, the floor here ran
  backwards": the slow state.
- **What:** a lesson is filed by situation, not distance:
  - the place (a cell and the connected ground like it);
  - the ambient's sector (one of 16);
  - a speed band;
  - stability, or time from sunset;
  - the turn and ratio seen, and how often.

  It applies whenever the forecast puts the wind in that situation
  again, on any day. The reason line ("Remembered from 10 Oct in the
  evening…") is internal, like layer 3's.
- **Spread by likeness, not rings:** to cells with the same landform
  (floor, slope, ridge) and the same shelter from that direction (the
  upwind horizon angle over 300–1000 m, baked per direction), within the
  same valley or slope.
- **Exists:** the local blend: 90% at a check, fading over 400 m and an
  hour, forgotten after.
- **Sharing:** lessons go up with the checks. Only learned corrections
  come down to other phones, never raw checks (decided 2026-10-06).

### 5. The pooled correction, on the server

- **Job:** what every place like this does under that wind, learned
  from everyone. This is the learned overlay.
- **What:** the residual of each check against the layer 3+4 call,
  modelled on physical inputs:
  - shelter by direction;
  - the valley's angle to the wind;
  - slope and aspect;
  - canopy;
  - stability;
  - speed;
  - time from sunset.

  Start with gradient boosting and monotone constraints. A neural net
  only when it beats that on places it never saw. Its output reaches the
  phones as per-area priors in the bake (SCALE-PLAN phase 5).
- **Gate:** better on checks from places left out of training. A few
  thousand checks from twenty-plus phones, or stations, before it's
  worth fitting.

## Data, the bottleneck

- **The missing checks.** Gavan's ~500 older checks never reached the
  server. With sharing on, every check on the phone goes, so they're
  likely in another install: on iOS the home-screen app and Safari keep
  separate storage. Check Settings → Sharing's counts in each; Export CSV
  is the fallback.
- **Field data on disk:** `field-data/` (60 Pickle checks, GPX).
- **Stations** ([WIND-STATION.md](WIND-STATION.md); ultrasonic, the
  no-solder Ecowitt WS90 kit). One on the Searchmont valley floor and
  one on the ridge would test the rotor every evening, without anyone
  standing there.
- **Public towers** for the floor under the trees (SCALE-PLAN phase 1).
- **Public stations, free and live.** They are open-ground checks of the
  ambient every 10 minutes, for layer 3's prior and for scoring the
  forecast. All come through Environment Canada's Datamart, SWOB-ML:
  - Ontario MNRF's fire weather network: 123 stations, wind at 10 m
    (`dd.weather.gc.ca/today/observations/swob-ml/partners/on-firewx/`);
  - the other provinces' networks (ab, nb, nl, ns, yt, pc-firewx; bc and
    sk forestry);
  - MTO road weather (`on-mto`), though some report no wind. NR-12P
    "Searchmont – Pilot" on Hwy 556 (232 m) gives temperature only.

  The Datamart folders keep today only, but MSC GeoMet's OGC API
  (`swob-realtime`) keeps 30 days of ECCC's and most partners'
  stations. **Collected from 2026-10-11** by `pipeline/stations/collect.py`
  (a daily task on XEVO, "Groundwind stations", 7 am, run late when the PC
  was off):
  - a whole day is ~455,000 readings from ~1,170 stations, 3.8 MB
    compressed, about 6 minutes;
  - it is kept in `pipeline/raw/stations/` and on R2 under `stations/`.

  Not in the API: the Yukon's fire weather and avalanche networks and
  most of BC's (the Datamart folders have them, today only).
- **A summit station at Searchmont** (seen by Gavan 2026-10-11, probably
  the resort's own; not in any public feed found). With its history it
  would be the ridge's ambient, the reference for the rotor, and a
  scoring set. Ask the resort.
- **Better checks, not just more.** Layer 3's "next useful check", and
  logging the checks that matched, not only the misses.

## Stations: the referee, and the next WindNinja runs

Stations don't train the surrogate's direction: it learns whole fields
from physics runs, and a 10 m reading in a clearing says little about a
field. They do teach speed, once the trees round each station are known.
See "The station correction" below (2026-10-12). They do four other jobs:
1. referee every layer;
2. train the forecast correction, layer 3's prior;
3. train the pooled correction (layer 5) on their misses;
4. **choose WindNinja's next parameters** (below).

**What they hold** (`pipeline/stations/terrain.py` →
`raw/stations/terrain.csv`, from the 30 m MRDEM): of 1,089 stations
reporting on 2026-10-10, 356 stand on flat ground (relief under 50 m
within 3 km), 503 on gentle ground, 160 in hills (150–400 m) and 70 in
mountains (400 m+).

### The starter set

| Group | Stations (msc_id) | Why |
|---|---|---|
| Pairs | Baie-Comeau airport `7040442` (20 m, flat shore) + Baie-Comeau ridge `704S001` (129 m, +52 m on its surroundings), 14 km apart. Nelson `1145M29` (valley floor, 534 m) + Norns `BC_WMB_408` (2,397 m) + Baker `BC_WMB_503` (2,182 m) ridge wind stations | One weather system on a floor and a ridge at once: the Searchmont question, every 10 minutes |
| Twins | North Mountain, Cape Breton: `NS-DLF_8217` + `8204161`, side by side. Sault airport: `6057593` + `6057591` | The noise floor: how close two instruments on one spot agree, so how good any model can look |
| Hilly valley floors, east | L'Étape `7015791` (Laurentides, 785 m), Mont-Tremblant `7045335`, Barrage Témiscamingue `7080468`, Edmundston `8101303`, Corner Brook `8401298` | Where night drainage and rotors should show |
| Ridges, east | North Mountain, Norman Tower `NS-DLF_8216`, Baie-Comeau ridge | The wind above the terrain |
| Mountains, west | Valley floors: Lytton `1114746`, Callaghan Valley `1101300`, Nordegg `3054843`, MacMillan Pass `2100693`. Ridges: Nakiska Ridgetop `305MGFF`, Tabernacle `BC_WMB_376`, Norns, Baker | The hard cases for any terrain model |
| Bush country | Ontario MNRF fire weather (130), Saskatchewan (86), Nova Scotia (31) | Clearings in the forest, the closest to hunting ground; hourly |
| Near our areas | Ranger Lake `ON-MNRF-AFFES_RAN` and Dixon Lake `…_DIX` (Searchmont, Sault); Manitouwadge `…_MAN` and North Crocker Lake `…_NCL` (Pickle); Matachewan `…_MTC` and Lost Lake `…_LLK` (Whitefish); the Baie-Comeau pair (Lac Bailey, ~60 km) | 15–60 km off: each needs its own box; they don't score our areas directly |

**Rules for using them:**
- **Hold out by region, never at random:** neighbours share weather.
- **Clean readings only:** quality flag 100 and the 10-minute means.
- **The twins first:** they set the noise floor.
- **No station speaks for the floor under the trees:** every one stands
  in the open.

### WindNinja's new parameters, chosen at the stations

Checked in the 4.0.0 CLI (`C:/tmp/windninja/app`) on 2026-10-11:

- **`diurnal_winds`.** Slope flows from the sun, with upslope by day and
  downslope at night, worked out from the date, time, air temperature
  and cloud cover.
  - It runs with the momentum solver: WindNinja's own example is
    `cli_momentumSolver_diurnal.cfg`.
  - It is the cheapest step toward the dusk and night cases.
  - It is a slope-flow scheme, though: whether it makes a valley rotor
    is for the test below to say.
- **`non_neutral_stability`, `alpha_stability`.** In the CLI, but no
  example pairs them with the momentum solver. Try them on a small DEM
  before planning around them.
- **`pointInitialization`** starts a run from station readings instead
  of one domain wind, with `match_points` to honour them. Each station
  is one CSV: name, lat/lon, height, speed, direction, temperature,
  cloud, radius of influence and time; see
  `etc/windninja/example-files/WXSTATIONS-*`.
  - `fetch_station` uses the US Mesonet API, so for Canada we write the
    files from `pipeline/raw/stations/`.
- `vegetation` (grass, brush, trees) and the output height, as now.

The trial, with the decision rule fixed before it runs:

1. **The station pairs.** Pick observed evenings and middays from the
   collected days. Start WindNinja from the ridge station
   (`pointInitialization`, the ridge's reading at that hour) and predict
   the valley station.
   - Run the neutral momentum (today's teacher), the momentum with
     `diurnal_winds`, and stability if it runs with the momentum solver.
   - **Adopt a setting for the next teacher runs if it lifts the valley
     stations' within-45° share by 10 points or more without losing on
     the ridges** (the rule of SCALE-PLAN phase 4).
2. **Searchmont, both ways.** The 2026-10-10 17:30 EDT case (SSE 15 km/h,
   near sunset) should reverse the valley floor. The 2026-10-11 11:00 case
   (S–SW 11 km/h, midday) should channel along the valley, not reverse.
   A setting has to get both right.
3. **If one passes, it becomes a new axis of the seed set and the
   surrogate's training:** time of day and sky as inputs, starting from
   about four directions × three times (afternoon, dusk, night) × two
   skies per site. If none passes, PALM or the GPU engine (layer 1) is
   the way to the night cases.

### First trial, Searchmont (2026-10-11)

The setup:
- A 12 × 12 km grid of 30 m MRDEM round the valley spot and the hill,
  in UTM 16N, with trees.
- Each case started from HRDPS's wind, temperature and cloud for the
  hour (Open-Meteo's past forecasts).
- Scripts in `C:/tmp/wn-trial/` (`trial.py`).
- Run times: about 30 s a case for the mass solver; 15–18 min for the
  momentum solver on XEVO beside the seed runners.

**WindNinja 4.0 refuses `momentum_flag` with `non_neutral_stability`.**
The two can't share a config file, even with momentum set false.
Stability exists only in the mass solver.

| Check (what Gavan felt) | mass | mass + slope flows + stability | momentum | momentum + slope flows |
|---|---|---|---|---|
| Dusk, valley floor (308°) | 150°, 158° off | 149°, 159° off | 158°, 150° off | 156°, 152° off |
| Dusk, treetops seen (180°) | 150°, 30° off | 149°, 31° off | 169°, 11° off | 158°, 22° off |
| Midday, valley floor (249°) | 187°, 62° off | 184°, 65° off | 202°, 47° off | 206°, 43° off |
| Midday, the top, 5 checks (180–299°) | 182–187° | 183–185° | 175–186° | 170–180° |

- **No setting makes the rotor.** Every one keeps the dusk valley floor
  within 8° of the forecast, about 150° off what was felt.
- **The momentum solver's terrain turning helps a little.** It turns the
  midday floor toward the valley's line (202–206° against 249°), and it
  reads the dusk treetops best.
- **Slope flows change little at the check spots.**

**On the 2024 LiDAR at 10 m** (HRDEM Sault Ste. Marie, both UTM projects,
8 × 8 km, mesh 1.1 M, 43–48 min a run on XEVO), the dusk case:
- Momentum gives the valley floor 151° (157° off what was felt) and the
  treetops 152°.
- Momentum + slope flows gives 152° and 149°.
- Small pockets of reversed air appear: 1.3% of cells turned past 90°
  from the ambient (about 0.2% at 30 m), 0.17% with slope flows. None is
  on the floor.

**So a sharper hill alone doesn't make the rotor: it is stability.** That
matches the Salmon River canyon above.

**First PALM run, 2026-10-12** (the surrogate thread, TEACHER.md Track A;
10 m, stable, 3.3 h on xonix; `pipeline/raw/teacher/palm/`). It is a
diagnostic, not a verdict:
- **Reversal appears.** Over the last half hour the floor under the 17:33
  check turns 118° from the ambient at 0.19 of its speed, and is
  reversed 43% of the time. A reversed patch of 810 ha spans the valley.
  The treetops come out from 138° (felt: 180°).
- **But the floor reads 36°, not 308°,** and the run fails its own gate.
  The low layer collapsed to 1.6 km/h against the forecast's 16, with
  27 km/h left at 600 m.
- **Why:** the cooling (1 K an hour for 2.5 h) made an inversion far
  stronger than a windy dusk does. Decoupling and reversal are in the
  physics; the dose is wrong.
- **Next:** the neutral run as a baseline, then stable again with milder
  cooling.

By the rule fixed above, nothing here passes. That points the night
cases at the other routes:
- PALM or the GPU engine, with stability resolved rather than
  parameterised;
- stations on the floor and the ridge, to confirm the rotor is real
  and how often.

### The scoreboard, first run (2026-10-11)

`pipeline/stations/`:
- `collect.py`: the station readings, 29 days, 12 Sep – 10 Oct 2026.
- `hrdps.py`: Open-Meteo's archive of past HRDPS forecasts at 1,154
  stations inside its domain.
- `surrogate_at.py`: the net on a 15 km box of 30 m MRDEM round each
  station, read at the station's cell for the 16 directions.
- `score.py`: each station's reading on the hour (quality flag 100),
  where it measured 5 km/h or more, against HRDPS as the phone has it,
  and against HRDPS turned and scaled by the SD terrain wind. Both on the
  same hours; stations inside an area the net trained on are left out.

Net `seed1-hold-blanchard-river` (17 areas); 548,613 station-hours. The serving net, `seed2-all` (all 35 areas, the same evening), scores the same within a point in every row: valley floors 74% → 79% (night 72% → 77%), mountains 70% → 73%, hilly 83% → 84%, ridges 78% → 77% with speed 70% → 73%. Only 2 of the 1,200 stations sit inside an area either net trained on. With the speed damping the SD bake ships with since 2026-10-11 (`build_windsd.py --damp 0.6`: |V| → 1 + 0.6 (|V| − 1), direction untouched; `score.py --damp`), direction is unchanged and speed within ×2 rises a point in most rows (all 85%, hilly 80%, valley floors 66%, slopes 74%), ridges 72%.

| | within 45°: HRDPS → SD | median miss | speed within ×2 |
|---|---|---|---|
| all | 88% → 88% | 14° → 14° | 85% → 84% |
| flat (relief < 50 m within 3 km) | 91% → 91% | 13° → 13° | 90% → 89% |
| gentle (50–150 m) | 89% → 89% | 14° → 14° | 87% → 86% |
| hilly (150–400 m) | 83% → 83% | 17° → 16° | 79% → 79% |
| mountain (400 m+) | 70% → 73% | 26° → 22° | 50% → 48% |
| valley floor (hills, 15 m+ below the 1 km mean) | 74% → 79% | 25° → 19° | 66% → 65% |
| valley floor, night | 72% → 77% | 26° → 20° | 66% → 67% |
| slope | 81% → 82% | 18° → 17° | 74% → 73% |
| ridge | 78% → 77% | 19° → 19° | 70% → 72% |

Read it with three things in mind:
- **HRDPS has a home advantage at the airports.** Environment Canada's
  and NAV CANADA's readings go into its analysis, and the archive is
  each run's first hours. At the provincial fire weather stations it is
  as good on direction (89% within 45° in Ontario) but runs too strong
  (×1.31 on the median).
- **The SD terrain earns its keep on valley floors and in mountains**,
  by day and by night, by turning the forecast along the valley. On flat
  and gentle ground it changes nothing. On ridges it gives back a point
  of direction for two of speed. It shaves a little speed accuracy at
  the fire weather stations, where HRDPS already runs high.
- **These are 10 m anemometers in the open:** the forecast and the
  terrain layer, never the head-height air under the trees.

**Next:** WindNinja at the pairs, and a stability teacher scored here,
on the valley floors at night.

### The station correction, first fit (2026-10-12)

The scoreboard's stations, used to learn rather than to referee, as Wind-Topo
did with 261 Swiss stations (Dujardin & Lehning 2022, 50 m fields from
station readings).

`pipeline/stations/`:
- `hrdps.py --extra`: the forecast's own air at each station-hour. That
  is the wind at 80 and 120 m, the temperature at 2, 80 and 120 m (the
  120 m less the 2 m is its inversion), cloud and sunshine.
- `cover.py`: the ground cover round each station, from NRCan land cover
  2020 and SCANFI. That is the forest, water, crop and urban shares within
  300 m and 1 km, the distance to the forest, tree height and closure, and
  the forest share upwind in 16 directions.
- `correct.py`: LightGBM learns the turn and the speed left over from the
  SD call. Its inputs exist on any cell in Canada: the forecast's air, the
  sun, the terrain, the net's response, and the trees. No station id,
  network or position goes in.

The test is strict. Each fit is scored on regions it never saw (five folds
of 3° × 5° blocks), and on hours from 1 October, having been fitted on
hours before. Speed counts every hour, calms included, as
(call + 1) / (measured + 1) km/h. Scoring only the 5 km/h hours, as the
scoreboard does, picks hours by what was measured, and so marks down any
call that has learned the calms.

| | dir within 45°: HRDPS / SD / learned + trees | speed within ×2: HRDPS / SD / app / learned / learned + trees | median speed ratio: HRDPS / app / learned + trees |
|---|---|---|---|
| all | 89% / 89% / 88% | 79% / 78% / 78% / 81% / 87% | ×1.09 / ×1.14 / ×0.93 |
| flat (relief < 50 m) | 91% / 91% / 91% | 84% / 83% / 83% / 85% / 90% | ×1.09 / ×1.20 / ×0.94 |
| night | 88% / 88% / 88% | 74% / 73% / 74% / 77% / 84% | ×1.20 / ×1.18 / ×0.92 |
| night, strong inversion (2 °C+) | 80% / 80% / 79% | 67% / 66% / 69% / 71% / 78% | ×1.23 / ×1.00 / ×0.91 |
| valley floor, night | 73% / 79% / 79% | 57% / 59% / 54% / 61% / 70% | ×1.34 / ×0.71 / ×0.99 |
| slope | 83% / 84% / 83% | 70% / 70% / 68% / 74% / 80% | ×1.00 / ×0.96 / ×0.92 |
| ridge | 78% / 77% / 71% | 71% / 71% / 70% / 79% / 82% | ×0.84 / ×0.94 / ×0.89 |
| mountain (400 m+) | 70% / 73% / 67% | 61% / 60% / 52% / 67% / 68% | ×0.75 / ×0.58 / ×0.88 |
| Ontario fire weather (bush clearings) | 90% / 89% / 89% | 68% / 66% / 71% / 84% / 91% | ×1.56 / ×1.54 / ×1.03 |
| NAV CANADA (airports) | 88% / 88% / 88% | 84% / 84% / 83% / 83% / 88% | ×0.90 / ×0.95 / ×0.86 |

"app" is the phone's own 10 m call, rebuilt at each station: the SD call,
through the bake's roughness speed ratio (z0 by cover class, from the
land-cover shares within 300 m and SCANFI height), and then the phone's
night cut. That cut is (1 − 0.3 s)(1 − 0.7 s · lowness), with s worked out
from the same HRDPS hour exactly as `boundaryLayer.ts` does. Two parts are
approximated: the stable lid is taken as the net's call, and the pool depth
as none. Its direction is the SD call's.

What it says:
- **Direction: the net is the call.** A learned turn on top of it gains
  nothing on flat ground, and loses on ridges (77% → 71%) and in
  mountains (73% → 67%) by fitting the quirks of the regions it saw. The
  rest of the direction miss is the forecast's own error, which no input
  about the place can learn.
- **Speed: the forecast runs strong at night, and the trees say where.**
  Over every hour, HRDPS is about 20–25% fast at night, and 56% fast at
  Ontario's fire weather stations in the bush. Without the trees the fit
  can't tell a clearing from an airport: it helps one and hurts the other.
  With them, every row improves.
- **The trees carry the weight.** By gain, the forecast's 10 m speed
  comes first (23%), SCANFI closure within 300 m second (11%), and the
  forecast's inversion third (7%). SCANFI is weak cell by cell against
  LiDAR (Pickle), but as a 300 m mean round a station it carries the
  signal.
- **Every input exists everywhere in Canada,** so the SD grade can take it.

What it isn't:
- **10 m anemometers in the open,** mostly airports and clearings. It is
  the 10 m wind over the local cover, not head height under the trees,
  which is the towers' job.
- **It does the job of two rules the app already has, and does it better.**
  Those are the bake's roughness speed ratio and the phone's night cut.
  - The app's call runs fast on open flat ground (×1.20), where the
    roughness ratio speeds up a station in a clearing or by water.
  - It runs slow on valley floors at night (×0.71) and in mountains
    (×0.58).
  - On strong-inversion nights it is about right overall (×1.00), but
    within ×2 still trails the learned speed by 9 points.

  The learned speed would replace both rules. Stacking it on them would
  count the same thing twice.
- **30 days of one autumn,** at 1,131 stations.

**Next:**
1. More autumns, from ECCC's hourly archive and the HRDPS archive, and the
   US fire weather stations for mountains.
2. Check that the learned speed holds at the hunters' checks: the
   stations are 10 m and open, the checks are head height.
3. Then decide whether it replaces the roughness ratio and the night cut
   in the bake and on the phone, as one band of speed factors by stability
   class, or as a small model the phone runs.

### HD at the stations inside its boxes (2026-10-13)

Gavan asked how accurate HD is at the weather sites. HD means WindNinja's
momentum field at the station's 30 m cell, turning and scaling the
forecast. The same 29 days, scored as score.py does.
- **Canadian stations:** `pipeline/stations/hd_at.py`. Only 3 of the 1,209
  ECCC stations fall inside any of the 36 boxes: the two at Sault, and
  McCreary at Riding Mountain. All are flat.
- **US stations:** `pipeline/stations/us_hd.py`. Six stations with wind,
  from IEM (Iowa Environmental Mesonet: ASOS, RWIS and HADS DCP), inside
  the 17 US boxes. The forecast is HRRR, and HRDPS at Poker Creek.
- **None stands in the butte's lee or the Salmon canyon.** The only station
  in the Salmon box, near Riggins, stopped reporting in 2021.
- **The SD net trained on all these boxes,** so its rows are in-sample.

| station (relief within 3 km, slope) | dir within 45°: forecast → HD → SD | median miss | speed within ×2 (5 km/h+ hours): forecast → HD → SD | median speed ratio: forecast → HD |
|---|---|---|---|---|
| Lily Lake road weather, CO (1,035 m, 7.8°, a hollow) | 51% → 55% → 57% | 44° → 36° → 35° | 43% → 52% → 57% | ×2.05 → ×1.59 |
| Poker Creek RAWS, AK (512 m, 9.9°) | 90% → 89% → 90% | 15° → 16° → 18° | 90% → 91% → 92% | ×0.90 → ×1.07 |
| Compton RAWS, Ozarks (446 m, on a rise) | 85% → 86% → 86% | 20° → 17° → 17° | 69% → 44% → 47% | ×1.61 → ×2.16 |
| Hood River airport, Columbia Gorge (251 m) | 57% → 57% → 57% | 34° → 33° → 34° | 62% → 63% → 62% | ×1.02 → ×1.00 |
| Hunt, Texas Hill Country (127 m) | 87% → 87% → 88% | 14° → 14° → 14° | 88% → 85% → 86% | ×1.06 → ×1.20 |
| Pittsfield airport, IL (48 m, flat) | 94% → 94% → 94% | 11° → 11° → 11° | 95% → 94% → 95% | ×1.07 → ×1.09 |
| the 3 Canadian stations (flat) | 90% → 90% → 90% | 13° → 13° → 13° | 85% → 81% → 84% | ×1.19 → ×1.28 |

What it says:
- **HD earns its keep in real mountains, on both counts.** At Lily Lake,
  in a hollow at 2,700 m, it turns the forecast toward what was measured:
  4 points more within 45°, and the median miss 8° smaller. It also takes
  speed down where the forecast runs double. It is the one station of the
  nine in steep ground.
- **On flat and gentle ground it changes nothing in direction.**
- **On a rise or a hill it can cost speed.** It speeds up the high ground,
  where a station in a clearing reads slow: at Compton, ×1.61 becomes
  ×2.16. That is the same over-contrast the butte showed, and the reason
  for the SD bake's 0.6 damping.
- **It doesn't fix the Gorge.** At Hood River the forecast misses direction
  by a median 34°, and the 30 m terrain turning doesn't correct it.
  Channelling on the scale of the Gorge, and stability, are beyond a
  neutral solve.
- **The net copies its teacher closely at instruments:** within 0–6° of
  turn, and speed ×0.72–1.12 of HD's.

**The honest number:** across all nine stations HD equals the forecast in
direction, and is a point or two worse in speed. Its value is the pattern
at a hunter's scale, which stations rarely sample, and the one mountain
station agrees. A firmer mountain number needs more stations in steep
boxes: BC's fire weather network (licence to ask) and RAWS through
Synoptic (a free key).

### The check tuner's numbers, measured at the stations (2026-10-13)

Gavan asked for more weight on a tuning algorithm: can a few checks
correct the outcome? `ambientFit.ts` already reads a sit's checks the right
way round. The forecast's error is the unknown, a turn and a speed ratio;
the fit has a prior on each, scores each check's likelihood through the
ground model, takes the best candidate, and fades it with time and
distance. But every number in it was set by hand.

`pipeline/stations/tune.py` measures those numbers at the 1,131 stations
(HRDPS through the SD net, 29 days); results in
`pipeline/raw/stations/tune.md`.

**How wrong the forecast runs, one sigma** (the fit's prior):

| Forecast 10 m wind | Turn | Speed (ln ratio) |
|---|---|---|
| under 8 km/h | 37° | 0.70 |
| 8–20 km/h | 20° | 0.47 |
| over 20 km/h | 13° | 0.32 |

Stable nights run 29° and 0.73; mountains 32° and 0.81. The app had
40° and 0.45 for every wind.

**How much of a check's offset still holds later, at the same station:**
- **The turn:** 0.64 an hour on, 0.49 at two, 0.41 at three, 0.30 at six,
  and about a quarter through the next day (the place's own).
- **The speed:** 0.77, 0.67, 0.60, 0.47, and about two-fifths. The stations'
  own means are 37% of the speed's error: shelter and siting, which last.
- **At another station the same hour:** 0.64 within 10 km, 0.20 at 10–25 km.
  The app's 2.5 km reach is safe.

**Virtual hunters.** A check is a station's reading plus a puff's noise.
Real puffs at one sit differ by about ±47°, light ones more (27 pairs in
the replay). At ±60°, today's settings made direction worse with 2–4 puffs,
because they read a puff at ±25–35°:

| Puffs | Direction within 45° | Median miss |
|---|---|---|
| none (the call alone) | 88% | 14° |
| 2, today's settings | 81% | 23° |
| 2, measured settings | 91% | 13° |
| 4, measured settings | 93% | 12° |
| 8, measured settings | 96% | 11° |

With the measured settings, speed within ×2 went 88% → 96–98% right
after. The gain fades to the call's own skill by about three hours. With
steadier checks (±30°: the treetops, a puff watched for long) both
settings help.

**What changed in ambientFit.ts:**
- The prior by the forecast's speed the checks logged (`priorFor`).
- The fit's puff sigma at the puffs' measured noise: 40–55° by strength,
  `FIT_DIR_SIGMA`. The local blend keeps `DIR_SIGMA`.
- The turn and the speed fade apart: a quick part (1.6 h and 2.8 h) plus a
  lasting quarter and two-fifths, all of it gone a day after the last check
  (`fitWeightsAt`). model.ts applies the two weights apart.

**On Gavan's 76 checks** (`app/scripts/replay.py --loo --all-days`), no
change:
- Pickle fit + blend 40% within 45° both ways, median miss 64° → 63°,
  speed 72%.
- Searchmont 78% and Sault 25% unchanged: the fit reached none of them.

The fit only reaches 10–11 of the 60 Pickle checks, and the misses there
are the place's and the regime's (drainage, the canopy, a rotor), which an
offset on the forecast can't take out. That is what the classes in
INVERSE.md and the place's memory (layer 4) are for. The speed's lasting
part, once a sit has measured it, belongs there.

**The rules for several checks, the same day** (`tune.py --part3`;
`pipeline/raw/stations/tune-multi.md`):
- **The gate was the reason the fit so seldom reached a check.** fitMatters
  also asked that the checks prefer the fit by e to one per check. Puffs as
  noisy as real ones cleared that in 4–7% of sits. With four puffs at ±60°
  it held direction at 90% within 45° against 94% without it, and put a
  far-off forecast right in 18% of sits against 58%. Dropped; the 8° or
  one-fifth size bar stays (it costs nothing).
- **A tail on the prior.** `PRIOR_TAIL` 6% is spread evenly over every turn
  and ratio. The forecast is now and then far off (4–8% of station-hours
  past three of its usual turn), and with the tail eight puffs that agree
  put it right in 83% of those sits against 70%, at no cost elsewhere.
- **Older checks in a sit count longer: `FIT_TAU` 2 h → 4 h.** Each is read
  against the forecast of its own minute, so it still says how far off the
  forecast runs. On four checks over three hours, counting them all alike
  did best: a far-off call put right in 36% of sits, against 28% at 2 h.
- **How many checks settle it** (`puffsToSettle`): enough for the fit to go
  half way from the forecast to the checks, (50° / the forecast's usual
  turn)². That is 2 in light air, about 7 in a moderate wind, and about 15
  in a breeze, where the forecast is seldom far off. The card says so
  (`nextPuff`, from the forecast speed the check logged).

On Gavan's checks, the fit now reaches 47 of the 60 Pickle checks, against
11:
- **Pickle:** fit + blend 40% → 49% within 45°, median miss 63° → 51°.
  Speed is unchanged (72%).
- **Searchmont:** 7 of 9 → 6 of 9, but that is one check going from 37° to
  46°, just over the line. Four others came closer (28→24°, 20→11°, 25→17°,
  17→7°), and the summed miss went down.
- **Sault:** unchanged.
- **All 66 with a direction:** 44% → 50%. It is the first change to the
  fit that clearly helps on the field checks.

**Hunting hours** (`tune.py --part4`; `pipeline/raw/stations/tune-hours.md`).
Gavan: "we need to optimise for the right hours."
- **Legal light:** the sun at −5° or higher. Dawn and dusk are the first
  and last three legal hours of each station's day: 55% and 26% of the
  station-hours.
- **The forecast's direction misses are the same in legal light.** They
  run 36°, 19° and 13° against 37°, 20° and 13°, and dawn and dusk run like
  midday. The speed misses are a little tighter (0.65, 0.41, 0.30), since
  nights add the slack. Priors fitted to these hours did no better on the
  virtual hunters than the all-hours ones, so `PRIOR_AT` stays.
- **The virtual hunters are the same in every scope.** In legal light, 2,
  4 and 8 puffs give 92%, 94% and 97% within 45°, and a far-off call is put
  right in 38%, 57% and 83% of sits. At dawn and dusk it is 91%, 94% and
  97%, and 35%, 61% and 79%.
- **A speed offset fades faster in the hunt than overnight.** In legal
  light it holds 0.72, 0.57, 0.47 and 0.35 at 1, 2, 3 and 6 h, against
  0.77, 0.67, 0.60 and 0.47 over all hours. At dawn and dusk it holds 0.70,
  0.48, 0.31 and 0.26. The turn holds 0.60, 0.45, 0.36 and 0.27. So
  `LN_KEEP` 0.4 → 0.3, `LN_TAU` 2.8 → 2.2 h and `TURN_TAU` 1.6 → 1.5 h,
  which fit legal light to within 0.03.

**The field checks by hour.** Gavan's hours, with the sun worked out at
each check's place and minute:
- **Legal light:** the multi-check rules take fit + blend from 44% to 48%
  within 45° (64 checks).
- **Dawn and dusk:** nothing, 46% both ways (26 checks). Midday gains
  most.
- **Where dusk fails:** light air at the Pickle lake strip on 30 Sept swung
  315, 270, 135, 270 and 45 inside 85 minutes. The local blend averaged
  that into an east wind and turned three 50–70° raw calls into 143–174°
  misses.
- **Tried and not shipped:** the checks' mean direction counted by R² (how
  far they agree). At dawn and dusk four checks came closer and two went
  further. At midday three went further, one of them 61° → 148°. Overall
  that is one more check within 45°.
- **Why it can't be read yet: the replay's inputs drift between runs.**
  The raw calls on 29 Sept's near-calm midday moved 15–20° with no code
  change (the archived forecast or the ensemble's grace). That is a check
  or two of noise either way, so a rule this small needs both versions
  scored inside one page load before it can be judged.

The Searchmont floor checks (17:33 and 18:24 EDT on 10 Oct, sun 13° and
5° up, sunset about 19:00) were inside legal light.

**Quiet dusk on flat ground: lean back toward the air above? Tried, not
shipped (2026-10-13).** huntapp-1f's lead from the PALM work: on Gavan's 11
quiet dusk and night checks (powder calm, drift or light; the sun under 5°
or within an hour of sunset; all Pickle), the forecast's own direction is
within 45° on 6. Today's model gets 4 alone and 5 with the day's other
checks. On the other 55 the model leads (24–27 against 19).

The test, gated in the model and scored by `replay.py --ab` (every check
under each setting in one page load, today's rules beside it): the model's
own way pulled toward the air above, wholly or half way.
- **Gated by the forecast and the sun** (under 10 km/h, sun under 9°,
  slope under 1°): it moved 5 calls.
- **Gated by the model's regime** (draining, pooled or calm): it moved
  9–14 calls, mostly near-calm middays.

Neither gate is worth shipping:
- **Quiet checks:** 4 → 5 of 11 alone, still 5 with the day's checks.
- **All 66:** 32 → 33 at best, inside the replay's noise.

The forecast's lead is two checks, and they differ:
- **28 Sept 19:06 at the bog:** still air at 5 km/h, stable. The model's
  calm rules turned 43° and the forecast was 6° off. Leaning fixes it
  (49° → 5°) but costs a dawn check.
- **30 Sept 18:27–18:56 on the lake strip:** a 13 km/h forecast that the
  model reads as wind, not stable. It turns about 100° along the shore
  while the powder swings every way. No quiet-air gate reaches it; it is
  a question for the shore rules at sunset (SHORE-WIND.md).

The knobs went back out of the model; `replay.py --ab` stays for the next
small rule. Gavan's next dusk sits are the test that can settle either case.

### The first step needs no bake

**Score the forecast itself.** Compare HRDPS at every station with what
it measured: by region, hour and weather type. That is layer 3's
forecast prior, and how wrong the forecast runs in each place. To check:
Open-Meteo's historical-forecast API keeps past HRDPS runs.

## Towers: the floor under the trees (2026-10-12)

Flux towers measure the wind at several heights from the forest floor up
past the treetops, for years. They tell us what head height does under the
air above the trees, which stations in the open can't.

**The line that matters most for SD everywhere: the floor needs no LiDAR.**
At these towers, the canopy inputs a map has everywhere (ETH 10 m canopy
height, Hansen 30 m tree cover) predict the floor as well as NEON's 1 m
airborne LiDAR does, on all three targets. The tree data the terrain model
needs is available on every cell.

**Who calls what:** whether the floor follows the wind above stays with the
regime classifier's split (INVERSE v2). Calm and the floor's speed go to the
learned floor model, which beats that split on both.

**The set:** 29 forest towers, September to November, 2017–2025. That is
25 NEON towers, plus Morgan-Monroe, Poker Flat and Fairbanks from AmeriFlux,
and SMEAR II in Finland: 743,000 half-hours with the wind above the trees at
1 m/s or more.
- **Wind** at every level, and **air temperature** at two levels above the
  canopy. Stability is read from the temperature pair (zeroed per site-year
  on the windiest hours, × 1.5 for the layer just above the crowns). It
  agrees with eddy covariance 72–90% of the time; very stable is caught only
  about 1 in 4.
- **NEON's 1 m airborne LiDAR** round each tower, for tree height, closure,
  edge distance and the fetch through trees in 16 directions (HD grade).
  Beside it, the inputs a map has everywhere: ETH 10 m canopy height and
  Hansen 30 m tree cover (SD grade).
- **Scripts:** `pipeline/towers/` (`neon.py`, `neon_look.py`,
  `canopy_sites.py`, `rows.py`, `floor.py`). **Results:**
  `pipeline/raw/towers/floor.md`, `pipeline/raw/regimes/neon/first_look.md`.

**What the floor does** (NEON, median of 25 forests, wind above the trees
1.5 m/s or more):

| Air above the trees | Floor follows the top (within 45°) | Floor calm (< 0.3 m/s) | Floor / top speed |
|---|---|---|---|
| unstable | 88% | 1% | 0.32 |
| neutral | 94% | 1% | 0.28 |
| stable | 83% | 10% | 0.24 |
| very stable | 83% | 25% | 0.22 |

- **The terrain decides what a stable night does.** On stable nights, flat
  floors (under 2°) go calm 50% of the time. Valley bottoms are calm 7% of
  the time and drain: the floor comes from uphill 70% of the time.
- **Drainage under the trees:** Bonanza Creek and Bartlett drain at the
  floor while the air above doesn't (80% and 82% of stable nights
  downslope). At Great Smoky and Rocky Mountain the whole layer drains,
  treetops included. Scarce: only 2 towers stand on 5°+ by 3DEP, and 2 in
  valleys.

**The app's canopy rule at the towers:** the bake's `in_stand` curve, the
leaf fall, and model.ts's × (1 − 0.3 s).
- **It calls the floor 2.3× too slow,** and in every stability class:
  0.12 of the air above against 0.27 measured. Only 39% of half-hours land
  within 2×. It calls the floor calm 60% of the time; the towers measure 17%.
- **It isn't the sensor height.** Most NEON floors sit at 3–11 m in the
  trunk space. But at the 11 towers with a sensor at head height
  (1.4–3.1 m), the curve is 2.5× slow (median).
- **This clashes with the checks.** `in_stand` was set between the
  2026-10-07 tower fit and Gavan's 60 checks, because the tower fit
  over-called those checks 2×.
- **The likely reason.** The station correction above finds HRDPS 1.5×
  fast in Ontario's bush clearings. A forecast that runs fast in the bush,
  times a floor curve that runs slow, lands near what was felt. The
  hand-set curve has been absorbing the forecast's error.
- **So the two fixes go together or not at all.** Those are the learned
  10 m speed from the stations and the floor from the towers. Fixing only
  the floor would over-call head height; fixing only the 10 m speed would
  under-call it.

**The learned floor model** (`floor.py`, LightGBM, each tower scored by a
fit that never saw it):

| | follows the top: log-loss | calm: log-loss | floor/top within 2× |
|---|---|---|---|
| learned model | 0.436 | **0.379** | **89%** |
| SMEAR split (INVERSE v2) | **0.401** | 0.417 | 71% |
| lookup by class | 0.407 | 0.416 | – |
| the app's rule | 0.659 | 2.27 | 39% |

- **Speed and calm: the learned model wins.** The ratio is within 2× 89%
  of the time against 71%, and it wins at 22 of 29 towers.
- **Whether the floor follows: nothing beats the base rate (88%).** What
  little varies is the place (tree height, sensor heights) more than the
  air. On stable nights the lookup by class does best.
- **No skill is lost without LiDAR at these towers.** The SD grade (ETH 10 m
  height, Hansen cover) equals or beats the 1 m LiDAR grade on all three.
  So the net can take only inputs it can be fed everywhere.

**Limits:**
- Towers stand in uniform stands on purpose, so no edges, slots or
  shores. Those stay with the checks and stations.
- Only 11 towers measure at head height.
- None is Canadian with a profile, and none is in Ontario.
- Hunting season only.

**Next:** the test that settles it. At Gavan's checks, score the app's
head-height call three ways:
1. today's call;
2. the station-learned 10 m speed with today's floor curve;
3. both learned: the 10 m speed from the stations, and the floor from the
   towers.

If the third lands on the checks, both rules are replaced together.

**The replay, 2026-10-12: the pair doesn't ship yet.** Scored on 74 felt
checks in `replay_inverse.py`'s `pair_speed()`, with the per-check input
from `pipeline/stations/at_checks.py`. Full table in INVERSE.md, "The
speed-fix pair".

| Within one felt band / exact | Score |
|---|---|
| app, logged | 92% / 47% |
| app, fit + blend | 89% / 34% |
| pair, wind above the trees from the open-ground speed × roughness ratio | 89% / 38% |
| pair, wind above the trees from the speed as a mast in a clearing would read it | 84% / 35% |

- **The two choices of the wind above the trees bracket the truth.** The
  first never calls calm and runs a band high at Pickle; the second runs a
  band low there, but is best at Searchmont and Sault (93% / 53%).
- **The app's lead is flattered.** The GPX logged whole km/h, mostly
  1 km/h, and drift is the commonest felt word.
- **Not refuted either.** What would settle it:
  - exact-valued checks from D1 rather than the GPX;
  - more calm and breezy checks;
  - one convention for the wind above the trees: the roughness ratio where
    the spot stands inside the stand, the mast reading where it stands in an
    opening ringed by trees;
  - a canopy read at the spot itself. ETH's 100 m p90 reads 5 m+ at every
    check, because the trees round an opening count.

## What world class means, measured

- **Honest doubt.** When the card says ±30°, it holds about 70% of the
  time. Scored as a reliability curve per release.
- **Every release scored** on checks it never saw: `app/scripts/replay.py
  --loo` per day, and leaving whole places out. The score goes in the
  area checklist.
- **A second visit beats the first.** Score a place under a wind it has
  seen before, against its first time.
- **It asks for the check that would settle it.** It says "check again"
  when it can't tell, and keeps the cause to itself.

## Order and size

| Step | What | Size | Layer |
|---|---|---|---|
| 0 | Get the checks off the phones: find the install that holds them, a "send all" with counts in Settings | ½ day | data |
| 1 | The rule: when ambient-seeing checks agree with the forecast, a floor miss is a lesson about the place, not a turn of the map; on exposed ground a puff is a sample of the gusts' spread, so one puff stops taking 90% of the call. **Built 2026-10-11** (MICRO-WIND.md §8, last subsection) | ½–1 day | 3 |
| 2 | Place memory by situation, shown on the card. **Built 2026-10-11** (in the reasons; not yet field-tested) | 1 day | 4 |
| 3 | Shelter per direction baked into the grid; lessons spread by likeness | 1 day | 4 |
| 4 | The backwards solve proper: the ambient and stability posterior, the likely cause, the next useful check; scored on replay | 2–3 days | 3 |
| 5 | Stations at Searchmont, floor and ridge | Gavan's buy | data |
| 5b | Score HRDPS at the stations (no bake) | 1 day | 3 |
| 5c | WindNinja's new parameters tried at the station pairs and Searchmont (diurnal, stability), by the rule above | 2–3 days + xonix | 1 |
| 6 | The stability teacher: the setting that passed as a new seed-set axis; else the bake-off of SCALE-PLAN phase 4 with stability in the brief | weeks, xonix | 1 |
| 7 | Surrogate v2 on it | ~1 week | 2 |
| 8 | The pooled correction | when the data is there | 5 |

Steps 1–4 make the app right about last night's kind of evening with no
new physics. Steps 6–7 make the base right before anyone checks.

## Decisions for Gavan

- Two WS90 stations at Searchmont, on the valley floor and the ridge?
- Stability in the teacher: is it PALM, or the GPU engine's spike first?
  (SCALE-PLAN phase 4 already has the rule for choosing.)
- Lessons shared by default as corrections, the way checks are?
