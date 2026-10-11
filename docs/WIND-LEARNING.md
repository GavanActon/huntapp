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
  - The answer is the ambient's posterior. Where the ambient fits and a
    floor check still misses, it gives a named likely cause ("a valley
    rotor: SSE across the valley, hill upwind").
  - It also names the next useful check: the spot whose puff would
    shrink the doubt most for this sit.
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
  again, on any day, and the card says so with the reason.
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

Stations don't train the surrogate: it learns whole fields from physics
runs, and a 10 m reading in a clearing says little about a field. They
do four other jobs:
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

### The first step needs no bake

**Score the forecast itself.** Compare HRDPS at every station with what
it measured: by region, hour and weather type. That is layer 3's
forecast prior, and how wrong the forecast runs in each place. To check:
Open-Meteo's historical-forecast API keeps past HRDPS runs.

## What world class means, measured

- **Honest doubt.** When the card says ±30°, it holds about 70% of the
  time. Scored as a reliability curve per release.
- **Every release scored** on checks it never saw: `app/scripts/replay.py
  --loo` per day, and leaving whole places out. The score goes in the
  area checklist.
- **A second visit beats the first.** Score a place under a wind it has
  seen before, against its first time.
- **It explains** the likely cause, and asks for the check that would
  settle it.

## Order and size

| Step | What | Size | Layer |
|---|---|---|---|
| 0 | Get the checks off the phones: find the install that holds them, a "send all" with counts in Settings | ½ day | data |
| 1 | The rule: when ambient-seeing checks agree with the forecast, a floor miss is a lesson about the place, not a turn of the map; on exposed ground a puff is a sample of the gusts' spread, so one puff stops taking 90% of the call | ½–1 day | 3 |
| 2 | Place memory by situation, shown on the card | 1 day | 4 |
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
