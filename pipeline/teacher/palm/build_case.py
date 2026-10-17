"""Build a PALM case for the stability teacher (docs/TEACHER.md, Track A):
the static driver (terrain, plant canopy, roughness) and one _p3d namelist
per run, laid out as PALM's JOBS folders so palmrun can take them as they are.

    py -3.14 pipeline/teacher/palm/build_case.py searchmont              # 10 m, 5.12 km
    py -3.14 pipeline/teacher/palm/build_case.py searchmont --dx 20 --nest 10:3000 --npe 8,16
                                                                         # the layout to run: a 20 m root,
                                                                         # a 10 m child over the 3 km core
    py -3.14 pipeline/teacher/palm/build_case.py searchmont --dx 5       # the 5 m box (185 M cells: too big)
    py -3.14 pipeline/teacher/palm/build_case.py searchmont --dx 20 --tag t20 --hours 0.25
                                                                         # a quick test case
    py -3.14 pipeline/teacher/palm/build_case.py pickle-slot --dx 2 --tag 2m   # the Pickle slot, 1 km at 2 m
    py -3.14 pipeline/teacher/palm/build_case.py pickle-slot --dx 4 --tag 4m   # the same box at 4 m, a first look
    py -3.14 pipeline/teacher/palm/check_driver.py searchmont            # validate what it wrote

Out: pipeline/teacher/palm/<case>/JOBS/<case>_<run>[_<tag>]/INPUT/
        <name>_static   NetCDF static driver (PIDS), the same for every run
        <name>_p3d      the namelist
     pipeline/teacher/palm/<case>/case-<tag>.json   what was built, for palm_to_fields.py
     pipeline/raw/teacher/palm/<case>-1m.npz        the 1 m DTM and canopy height cache

THE GRID. UTM (the case's zone), north-up, aligned to the WindNinja trial's
10 m lattice so a PALM field and a WindNinja field compare cell for cell.
rotation_angle is 0: the grid's north is UTM grid north, which is not true
north (the meridian convergence, +2.2 deg at Searchmont). Coriolis is off
(omega = 0, as in WindNinja) and there is no radiation, so the angle has no
physics to act on; the forecast's true direction is turned onto the grid
here, the way pipeline/surrogate/fields.py does (from d true = from d - gamma
in grid axes), and palm_to_fields.py turns it back.

THE BOUNDARIES. Cyclic both ways, the wind held by the volume flow of the
initial profile (conserve_volume_flow). One static driver then serves every
direction and stability, which is what a teacher needs (16 directions x 3
stabilities per seed site). The price: terrain must be periodic, so the
outer ring (taper_m) is blended to a constant height, and the hill's wake
re-enters upwind after one domain length (5.1 km at Searchmont). The scored
core is the middle 3 km. A non-cyclic inflow with synthetic turbulence is
the alternative (one driver per direction, rotated grid); see TEACHER.md.

TERRAIN. HRDEM 1 m LiDAR DTM (NRCan, OGL-Canada), averaged to the cell.
Fallback (--terrain mrdem): the area's 30 m MRDEM, bilinear.

SCENT (docs/SCENT-TEACHER.md). Every run also releases scent: up to ten
passive particle groups (PALM's Lagrangian particle model), one per source,
from chest height (1.5 m) or a stand (5 m) over the local ground, for the
15 minutes before the averaging window and through it, written every 20 s
with their origin and group (OUTPUT/<run>_prt_bin/). The sources: a case's
own list (`scent.sources`, lat/lon or UTM xy), then the point at both
heights, then a ring round the point at `scent.radius_m` (default a fifth of
the core), on land and inside the core. `scent=False` on a run turns it off.
palm_to_scent.py reads the particles back into the app's how-often bands.

CANOPY. Leaf area density on PALM's terrain-following levels (zlad):
- where a tree is, and how tall: HRDEM's 1 m DSM minus DTM (the canopy
  height model), small crown gaps closed (3x3 grey closing), trees = pixels
  over 2 m; Fallback (--canopy forest): the habitat grid's FRI stand height
  and crown closure;
- how much leaf a crown carries: the habitat grid's conifer and hardwood
  shares (FRI) at the cell, a closed crown's plant area index of 4.0 for
  conifer, 1.0 for bare hardwood (stems and branches) plus 3.5 more in full
  leaf, times --leaf (the share of hardwood leaves still on; 0.5 for
  10 Oct in Algoma maple country, a guess for the checks to move);
- where in the crown: a beta profile on z/h per pixel, conifer mode 0.4 h
  (alpha 1.8, beta 2.2: foliage to the ground in spruce and fir), hardwood
  mode 0.75 h (alpha 4, beta 2: an open trunk space under the crowns);
- each cell's LAD at level k is the mean over its 1 m pixels of the leaf
  area in [(k-1) dz, k dz] above the ground, over dz.

ROUGHNESS (z0 in the driver, the surface under the resolved canopy): water
0.0002 m, open wetland 0.03, rock and road 0.01, everything else 0.1 (the
forest floor and its shrubs; the trees are the LAD, not z0).
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
PIPE = ROOT / "pipeline"
CACHE = PIPE / "raw" / "teacher" / "palm"
HRDEM = "https://canelevation-dem.s3.ca-central-1.amazonaws.com/hrdem-lidar/"
sys.path.insert(0, str(PIPE))

# ---------------------------------------------------------------- the cases

# Searchmont, WIND-LEARNING.md "What set it off": the valley floor felt from
# 308 deg under a 152 deg forecast at dusk on 2026-10-10, treetops 500 m SE
# seen from 180; channelled along the valley (249) at midday on 2026-10-11.
CASES = {
    "searchmont": dict(
        area="searchmont",
        point=(46.77744, -84.04824),  # lat, lon: the valley-floor check, 17:33 EDT
        epsg=32616,
        hrdem=["ON-Sault_SteMarie_UTM16_2024-1m", "ON-Sault_SteMarie_UTM17_2024-1m"],
        size_m=5120.0,
        core_m=3000.0,
        taper_m=640.0,
        # the domain's centre 400 m toward 152 deg from the point: the ski hill
        # (crest 1.5 km SSE) and its plateau to 3 km are upwind in the box
        shift=(152.0, 400.0),
        lattice=(721690.0, 5179850.0),  # C:/tmp/wn-trial/searchmont10/dem.tif's corner
        trial_dem="C:/tmp/wn-trial/searchmont10/dem.tif",
        runs={
            # the dusk forecast (HRDPS 17:30 EDT, as trial.py had it): from 151-152, 16.2 km/h
            "neutral": dict(direction=152.0, speed_kph=16.2, stability="neutral",
                            hours=3.0, average_s=3600.0,
                            why="control: the same wind with no stratification; WindNinja's physics with resolved turbulence and canopy"),
            "stable": dict(direction=152.0, speed_kph=16.2, stability="stable",
                           hours=2.5, average_s=1800.0,
                           theta_surface=291.8,  # 17.6 C at the floor (233 m) as potential temperature
                           # an evening inversion over the floor (N ~ 0.025 /s), a stable free atmosphere above
                           theta_gradients=[(0.0, 2.0), (300.0, 0.5)],  # (level m, K per 100 m)
                           # The ground cools at a rate (GABLS's way): each surface starts at the air's
                           # temperature at its height and falls 1 K/h, and the flux follows the
                           # turbulence. Tried 2026-10-11 at 20 m (TEACHER.md): a fixed -0.02 K m/s
                           # flux runs but doubles the cost (PALM's stability iteration at every
                           # surface element).
                           surface="rate", heating_rate=-1.0,
                           surface_heatflux=-0.02,  # K m/s, about -24 W/m2, with --surface flux
                           # the crowns radiate at dusk: canopy-top cooling, KINEMATIC (K m/s). PALM
                           # v25's docs give cthf in W/m2, but its code adds cthf * d(exp(-a LAI))/dz
                           # to the temperature tendency in K/s: the -25 first written here was
                           # -25 K m/s and blew the run up in 10 min. -0.02 K m/s is about -24 W/m2.
                           cthf=-0.02,
                           why="the case: does stable air under the same SSE wind reverse the floor?"),
            # the midday forecast (11:00 EDT 2026-10-11): from 186, 10.4 km/h, clear
            "midday": dict(direction=186.0, speed_kph=10.4, stability="convective",
                           hours=2.5, average_s=1800.0,
                           theta_surface=292.4,
                           theta_gradients=[(0.0, 0.0), (800.0, 1.0)],  # a mixed layer to 800 m, capped
                           surface_heatflux=0.06,  # K m/s, about 70 W/m2 on open ground
                           cthf=0.09,  # K m/s (about 110 W/m2): an October noon's sensible heat at the crowns
                           why="the other half of the test: a southerly by day must channel along the valley (felt 249), not reverse"),
        },
    ),
    # The slot at Pickle Lake: a 170 m water channel through a strip of trees,
    # 26-40 m wide between 8-15 m walls, running 043/223 at the foot of the
    # north shore's rise (to 406 m, 68 m over the water within 200 m), open
    # water at its NE end and wetland at its SW. Gavan felt a southerly funnel
    # NE through it at midday on 2026-09-29 (no check logged); HRDPS had 176-194
    # deg, 9-16 km/h, sunny. At 10 m the slot is three cells wide and the
    # Searchmont runs smeared slots like it, so this case is 2 m (4 m to look
    # first), neutral: the funnelling is the ground's and the trees', and a
    # 1 km box cannot hold the afternoon's thermals anyway.
    "pickle-slot": dict(
        area="pickle-lake",
        point=(48.94641, -85.57629),  # lat, lon: the middle of the slot
        epsg=32616,
        hrdem=["ON-SPL_ON_White_Lake_UTM16_2021-1m"],
        size_m=1024.0,
        core_m=700.0,
        taper_m=160.0,
        # 60 m toward the wind: the open water and wetland upwind in the box,
        # the rise's crest (200 m N) still clear of the tapered ring
        shift=(186.0, 60.0),
        lattice=(0.0, 0.0),
        fine_water=True,  # water at 1 m (the area's lake mask), not the habitat's 30 m cells
        taper_percentile=5.0,  # the ring blended to about the water's level, not the high ground's median
        # fine cells to 40 m over the highest ground, then to 16 m by about 220 m
        # more, a 600 m top (eight times the rise): a neutral canopy flow needs
        # no 1.6 km column, and at 2 m that column would be 300 levels
        vertical=dict(const_m=40.0, dz_top_m=16.0, top_m=600.0),
        # scent sources (SCENT-TEACHER.md): the showcase's hunter on the throat's west bank,
        # the exit, the bay's north shore from over the water; then the point and a ring
        scent=dict(radius_m=120.0, sources=[
            dict(name="throat west bank", xy=(604231.6, 5422480.0), heights=[1.5, 5.0]),
            dict(name="the exit", xy=(604287.0, 5422529.0)),
            dict(name="bay, over the water 30 m S of the shore", xy=(604400.0, 5422261.0), over_water=True),
        ]),
        runs={
            # 13:00 EDT 2026-09-29 (HRDPS, archived): from 186, 11.5 km/h, 37 deg off the slot
            "s186": dict(direction=186.0, speed_kph=11.5, stability="neutral", hours=1.0, average_s=1200.0,
                         # 3D snapshots for the site's pictures: 480 m round the slot at 4 m, to 48 m
                         # over the water, every 2 s for the last 2 min (about 250 MB at 2 m)
                         viz=dict(box_m=480.0, stride_m=4.0, top_m=48.0, dt_s=2.0, last_s=120.0),
                         why="the case: a southerly 37 deg off the slot; Gavan felt it funnel NE through"),
            # the same wind turned toward square across, to find where the funnel stops
            "s160": dict(direction=160.0, speed_kph=11.5, stability="neutral", hours=1.0, average_s=1200.0,
                         why="63 deg off the slot: does it still funnel?"),
            # the booked drag question (docs/SCENT-TESTSET.md, 2026-10-16): PALM's box comes out at about half
            # its forcing and its floor slower than the towers' for the same forecast 10 m; s186 again at
            # PALM's own default drag says how much of that is our 0.2
            "s186d15": dict(direction=186.0, speed_kph=11.5, stability="neutral", hours=1.0, average_s=1200.0, drag=0.15,
                            why="s186 at canopy drag 0.15 (PALM's default) against 0.2: how much of PALM's slow floor is the drag"),
            "s135": dict(direction=135.0, speed_kph=11.5, stability="neutral", hours=1.0, average_s=1200.0,
                         why="88 deg off, square across from the SE: the return eddy and the drift, not a funnel"),
            # the rest of the compass (Gavan, 2026-10-13: "from West as well"): W, NW and N bring
            # the air over the 68 m hill and down into the narrows, where WindNinja drew a lee wake
            # for W-NW-N (field data, 2026-10-07); SW and NE run straight along it from each end
            "w270": dict(direction=270.0, speed_kph=11.5, stability="neutral", hours=1.0, average_s=1200.0,
                         why="47 deg off, over the hill: the lee of the rise, or the slot"),
            "nw315": dict(direction=315.0, speed_kph=11.5, stability="neutral", hours=1.0, average_s=1200.0,
                          why="88 deg off, square across from the hill side: the deepest lee"),
            "n000": dict(direction=0.0, speed_kph=11.5, stability="neutral", hours=1.0, average_s=1200.0,
                         why="43 deg off from the N, over the hill's shoulder and the NE lake"),
            "sw225": dict(direction=225.0, speed_kph=11.5, stability="neutral", hours=1.0, average_s=1200.0,
                          why="straight up the lake arm and through: the funnel at its strongest"),
            "ne045": dict(direction=45.0, speed_kph=11.5, stability="neutral", hours=1.0, average_s=1200.0,
                          why="straight along from the NE lake: the same channel the other way"),
            # the W lee with the air layered (Gavan, 2026-10-14: the backflow up the hill at
            # other times of day). Dusk: HRDPS 2026-09-28 23Z at Pickle, the bogs' dusk288. A
            # sunny morning: heated ground; the heating is the same on every surface here (no
            # radiation model), so the east-facing slope gets no more morning sun than the rest
            "dusk288": dict(direction=288.0, speed_kph=11.2, zref_m=80.0, stability="stable", hours=2.0, average_s=1800.0,
                            theta_surface=293.5,
                            theta_gradients=[(0.0, 1.5), (80.0, 0.5)],  # +1.2 K over 2-80 m
                            surface="rate", heating_rate=-1.0,
                            surface_heatflux=-0.02, cthf=-0.02,
                            why="dusk, 2026-09-28 23Z (282 at 5 km/h, 80 m 294 at 11 km/h): cold air down the lee slope against the backflow"),
            "am270": dict(direction=270.0, speed_kph=11.5, stability="convective", hours=1.5, average_s=1200.0,
                          theta_surface=285.0,
                          theta_gradients=[(0.0, 0.0), (250.0, 1.0)],  # a morning mixed layer, capped at 250 m
                          surface_heatflux=0.04, cthf=0.05,  # K m/s: about 50 and 60 W/m2
                          why="a sunny morning under a west wind: heated ground with the lee's backflow"),
        },
    ),
    # The spots for rules (2026-10-13, Gavan: "all those are fine", and Lac Bailey's bank
    # for its LiDAR): one kind of place each, anchored where he felt or logged the wind. 4 m
    # first (a few angles), 2 m where the 4 m answer needs checking; boxes cyclic, tapered to
    # the water's level.
    #
    # The bog strip NE of Pickle Lake: a 60 m open strip between 14 m walls running 120/300
    # (MICRO-WIND.md 5). 2026-09-29 18:00 EDT under 190 at 15 km/h he logged it toward W, W,
    # NW, breezy (three checks); 2026-09-30 18:00 under 232 at 13 km/h toward SE, E, E: the
    # same strip both ways along it, each time the way the wind's along-strip part points.
    "pickle-bogstrip": dict(
        area="pickle-lake",
        point=(48.95406, -85.55121),
        epsg=32616,
        hrdem=["ON-SPL_ON_White_Lake_UTM16_2021-1m"],
        size_m=1024.0, core_m=700.0, taper_m=160.0,
        shift=(0.0, 0.0),
        lattice=(0.0, 0.0),
        fine_water=True,
        taper_percentile=5.0,
        vertical=dict(const_m=40.0, dz_top_m=16.0, top_m=600.0),
        # scent (SCENT-TEACHER.md): 30 Sep 2026 18:00, forecast 232 at 13 km/h, Gavan sat here (position 3
        # of three) and a bull to the south winded them (2026-10-14). The b232 run's floor air at this cell
        # went E/NE in 93% of its 30 s samples at 2 m, S in 5%: the now-and-then band. Then the point, a ring.
        scent=dict(radius_m=140.0, sources=[
            dict(name="Gavan's sit 30 Sep, winded, bull S", latlon=(48.95393, -85.55057), heights=[1.5, 5.0]),
            # the other two that evening (Gavan's pins at Pickle, 2026-10-14 23:12): 2 at his coordinates, in
            # 12 m canopy 92 m W of 3; 1 from the picture's geometry, 10 m W and 45 m N of 2, open 2 m scrub at
            # the lake's edge. They heard the bull to their south. In b232 the floor air at 1 went S in 52%
            # of the 2 m samples (mean toward 152), at 2 S 18% and W 30%: 1 is the one the bull winded
            dict(name="position 2, 30 Sep", latlon=(48.95390, -85.55183), heights=[1.5]),
            dict(name="position 1, 30 Sep", latlon=(48.95419, -85.55213), heights=[1.5]),   # under the trees at the bog's edge (Gavan), 12 m SW of the picture's pin
        ]),
        runs={
            "b190": dict(direction=190.0, speed_kph=15.1, stability="neutral", hours=1.0, average_s=1200.0,
                         why="2026-09-29 22Z (HRDPS 190, 15.1 km/h, 2-80 m near neutral): felt toward W, W, NW"),
            "b232": dict(direction=232.0, speed_kph=13.3, stability="neutral", hours=1.0, average_s=1200.0,
                         why="2026-09-30 22Z (HRDPS 232, 13.3 km/h, overcast): felt toward SE, E, E"),
            "b150": dict(direction=150.0, speed_kph=13.0, stability="neutral", hours=1.0, average_s=1200.0,
                         why="30 deg off the strip from the SE side: the along-strip part strong, toward NW"),
            # the scent test set's stable cell (docs/SCENT-TESTSET.md): the same dusk as the slot's and the
            # bogs' dusk288, so the three Pickle boxes share one evening
            "dusk288": dict(direction=288.0, speed_kph=11.2, zref_m=80.0, stability="stable", hours=2.0, average_s=1800.0,
                            theta_surface=293.5,
                            theta_gradients=[(0.0, 1.5), (80.0, 0.5)],  # +1.2 K over 2-80 m
                            surface="rate", heating_rate=-1.0,
                            surface_heatflux=-0.02, cthf=-0.02,
                            why="dusk, 2026-09-28 23Z (282 at 5 km/h, 80 m 294 at 11 km/h): does the cooling strip send its scent along the floor and into the walls"),
        },
    ),
    # The bog SW of camp (26 of the GPX checks round 48.9250, -85.6006) and the flat bog
    # 700 m S of camp (48.9198, -85.5881, a cold-air pool), in one 2 km box at 4 m. The
    # mornings: under a southerly forecast and a 2-4 K inversion over the lowest 80 m the
    # floor was calm, then drifted from NW and NE (09-27, 09-29): "a southerly forecast came
    # as a NE-E drift" (field data). HRDPS's own profile here: the 10 m wind 6-7 km/h, 80 m
    # 17-20 km/h from 180-190, so these runs hold the wind at 80 m.
    "pickle-bogs": dict(
        area="pickle-lake",
        point=(48.92240, -85.59440),  # between the bog and the pool
        epsg=32616,
        hrdem=["ON-SPL_ON_White_Lake_UTM16_2021-1m"],
        size_m=2048.0, core_m=1500.0, taper_m=240.0,
        shift=(0.0, 0.0),
        lattice=(0.0, 0.0),
        fine_water=True,
        taper_percentile=5.0,
        vertical=dict(const_m=40.0, dz_top_m=16.0, top_m=900.0),
        # scent (SCENT-TEACHER.md): where Gavan stood for his checks, the bog (26 of them, a
        # stand at 5 m too) and the pool S of camp; then the point and a ring
        scent=dict(radius_m=300.0, sources=[
            dict(name="the bog (the checks)", latlon=(48.92500, -85.60060), heights=[1.5, 5.0]),
            dict(name="the pool S of camp", latlon=(48.91980, -85.58812)),
        ]),
        runs={
            "dawn175": dict(direction=175.0, speed_kph=19.0, zref_m=80.0, stability="stable", hours=2.0, average_s=1800.0,
                            theta_surface=284.5,  # 8.8 C at 337 m
                            theta_gradients=[(0.0, 4.0), (80.0, 0.5)],  # HRDPS 2026-09-29 12Z: +3.9 K over 2-80 m
                            surface="rate", heating_rate=-0.5,  # the last of the night's cooling
                            surface_heatflux=-0.01, cthf=-0.01,
                            why="dawn 2026-09-29 12Z: forecast from 162 (10 m) / 182 (80 m); felt drifting toward SE and SW"),
            "dusk288": dict(direction=288.0, speed_kph=11.2, zref_m=80.0, stability="stable", hours=2.0, average_s=1800.0,
                            theta_surface=293.5,  # 17.8 C
                            theta_gradients=[(0.0, 1.5), (80.0, 0.5)],  # HRDPS 2026-09-28 23Z: +1.2 K over 2-80 m
                            surface="rate", heating_rate=-1.0,
                            surface_heatflux=-0.02, cthf=-0.02,
                            why="dusk 2026-09-28 23Z: forecast 282 at 5 km/h (80 m 294, 11 km/h); felt drifts toward S, W, SE, E, then calm"),
            "nw305": dict(direction=305.0, speed_kph=7.6, stability="neutral", hours=1.0, average_s=1200.0,
                          why="dusk 2026-10-02 22Z, near neutral: forecast 305 at 7.6 km/h; felt drifting toward SE, steady, treetops moving"),
            # the loop's first question run (docs/SCENT-TESTSET.md, 2026-10-15, huntapp-ba): under dawn175 the
            # bog's floor came from ~245 while the 10 m wind was 182 and the app kept ~187. The same dawn
            # with the wind from the W says which turns the floor: the drainage line (still ~245) or the wind
            "dawn270": dict(direction=270.0, speed_kph=19.0, zref_m=80.0, stability="stable", hours=2.0, average_s=1800.0,
                            theta_surface=284.5,
                            theta_gradients=[(0.0, 4.0), (80.0, 0.5)],
                            surface="rate", heating_rate=-0.5,
                            surface_heatflux=-0.01, cthf=-0.01,
                            why="dawn175's profile with the wind from 270: does the floor's turn follow the drainage or the wind"),
            # the drainage fade on flat ground (booked 2026-10-16 with lacbailey-spot d326u06/u12): dawn175 at a
            # third of its wind (~2 km/h forecast 10 m), where the bog's cold air should pool and drift on its own
            "dawn175u06": dict(direction=175.0, speed_kph=6.5, zref_m=80.0, stability="stable", hours=2.0, average_s=1800.0,
                               theta_surface=284.5, theta_gradients=[(0.0, 4.0), (80.0, 0.5)],
                               surface="rate", heating_rate=-0.5, surface_heatflux=-0.01, cthf=-0.01,
                               why="drainage fade, flat ground: dawn175 at 6.5 km/h at 80 m (~2 km/h forecast 10 m): pooling and drift or the wind"),
        },
    ),
    # Lac Bailey's north bank (Quebec): the 1 m LiDAR flown 2024 (QC-600023), a bank rising
    # 88 m in 300 m from the lake's north shore, 12 m regrowth on the 1991 burn. No checks
    # here: the rule this teaches is the bank's (lee and reversal over the shore with the
    # wind off the land, the lift with it off the lake, cold air down the bank at dusk).
    "lacbailey-bank": dict(
        area="lac-bailey",
        point=(49.409495, -69.548267),  # MICRO-WIND-LIDAR.md's bank, at the shore
        epsg=32619,
        hrdem=["QC-600023_29_LacAuBrochet_MTM7_2023-1m", "QC-600015_24_LidarDIF_Cote_Nord_MTM7_2015_17-1m"],
        size_m=1024.0, core_m=700.0, taper_m=160.0,
        shift=(0.0, 0.0),
        lattice=(0.0, 0.0),
        fine_water=True,
        taper_percentile=5.0,
        vertical=dict(const_m=40.0, dz_top_m=16.0, top_m=700.0),
        # scent: the shore (the point, by default) and 150 m up the bank, where the N wind's
        # lee runs back uphill and the dusk air drains down
        scent=dict(sources=[
            dict(name="up the bank 150 m", xy=(460228.0, 5473273.0), heights=[1.5, 5.0]),
        ]),
        runs={
            "n000": dict(direction=0.0, speed_kph=12.0, stability="neutral", hours=1.0, average_s=1200.0,
                         why="off the land, over the bank's crest: the lee and the reversal at the shore"),
            "s180": dict(direction=180.0, speed_kph=12.0, stability="neutral", hours=1.0, average_s=1200.0,
                         why="off the lake, up the bank: the lift and the speed-up over the brow"),
            "w270": dict(direction=270.0, speed_kph=12.0, stability="neutral", hours=1.0, average_s=1200.0,
                         why="along the shore: does the bank turn it"),
            # the rest of the compass (Gavan, 2026-10-16: "yea - queue"): the wind surrogate's first PALM
            # training cases (the self-improving plan's checkpoint, memory huntapp-compute-service) and held-out
            # cells the card can take on later; explore priority, xonix's CPU slot when nothing else wants it
            "ne045": dict(direction=45.0, speed_kph=12.0, stability="neutral", hours=1.0, average_s=1200.0,
                          why="surrogate set: quartering off the land from the NE, over the crest at an angle"),
            "e090": dict(direction=90.0, speed_kph=12.0, stability="neutral", hours=1.0, average_s=1200.0,
                         why="surrogate set: along the shore from the E (w270 the other way)"),
            "se135": dict(direction=135.0, speed_kph=12.0, stability="neutral", hours=1.0, average_s=1200.0,
                          why="surrogate set: quartering off the lake from the SE, up the bank at an angle"),
            "sw225": dict(direction=225.0, speed_kph=12.0, stability="neutral", hours=1.0, average_s=1200.0,
                          why="surrogate set: quartering off the lake from the SW"),
            "nw315": dict(direction=315.0, speed_kph=12.0, stability="neutral", hours=1.0, average_s=1200.0,
                          why="surrogate set: quartering off the land from the NW, the lee at an angle"),
            "dusk000": dict(direction=0.0, speed_kph=8.0, zref_m=80.0, stability="stable", hours=2.0, average_s=1800.0,
                            theta_surface=284.0,
                            theta_gradients=[(0.0, 0.7), (300.0, 0.5)],  # Searchmont's HRDPS evening start
                            surface="rate", heating_rate=-1.0,
                            surface_heatflux=-0.02, cthf=-0.02,
                            why="a dusk with a light wind off the land: the cold air down the bank and out over the water"),
        },
    ),
    # Whitefish Lake (request #7 near Timmins, HD): the scent test set's second held-out box
    # (docs/SCENT-TESTSET.md), picked 2026-10-15 and approved by Gavan with two points he added (W9,
    # W10). The NE arm of the lake (314.6 m) under a bank rising 31 m to the S, the east pond (326.6 m)
    # with its marsh bay, a creek trough from the S pond, and the logged cut to the N (0-3 m in the
    # 2023-24 LiDAR; the 2011/2014 inventory still calls it hardwood, so only its conifer share is old).
    # No bog and no long strip here. W7 (the S pond's marsh basin) was dropped for W9/W10: ten sources
    # at most, and the taper cut its basin open. The ring tapers to the pond's level (p25), not the
    # lake's: p5 put a 25 m ramp 300 m upwind of W5 under 210.
    "whitefish": dict(
        area="whitefish-lake",
        point=(48.154859, -80.798419),
        epsg=32617,
        hrdem=["ON-SPL_ON_Kirkland_Lake_UTM17_2024-1m", "ON-SPL_ON_Timmins_UTM17_2023-1m"],
        size_m=1024.0, core_m=700.0, taper_m=160.0,
        shift=(0.0, 0.0),
        lattice=(0.0, 0.0),
        fine_water=True,
        taper_percentile=25.0,
        vertical=dict(const_m=40.0, dz_top_m=16.0, top_m=600.0),
        scent=dict(sources=[
            dict(name="W1 lakeshore under the bank", latlon=(48.154722, -80.802345), heights=[1.5]),
            dict(name="W2 marsh edge under trees", latlon=(48.155034, -80.795998), heights=[1.5, 5.0]),
            dict(name="W3 the cut, its S tree line", latlon=(48.157645, -80.797090), heights=[1.5]),
            dict(name="W4 marsh bay between walls", latlon=(48.155060, -80.795043), heights=[1.5]),
            dict(name="W5 lee slope of the bank", latlon=(48.155158, -80.799655), heights=[1.5]),
            dict(name="W6 creek trough floor", latlon=(48.153937, -80.795921), heights=[1.5]),
            dict(name="W8 over the water off the S shore", latlon=(48.155404, -80.801536), over_water=True),
            # Gavan's two (2026-10-15): the arm's head in 10-12 m trees, 16 m from the water with the
            # arm's 150 m of open water to the SW-W (the tree line facing the water under 210); and a
            # 20 m clearing on the neck between the arm's head and the east pond, 10 m above the lake
            dict(name="W9 head of the arm, trees facing the water", latlon=(48.156867, -80.799402)),
            dict(name="W10 clearing on the neck between two waters", latlon=(48.156493, -80.796726)),
        ]),
        runs={
            "s210": dict(direction=210.0, speed_kph=12.0, stability="neutral", hours=1.0, average_s=1200.0,
                         why="the prevailing SSW (Matachewan 12 Sep-14 Oct 2026: SSW 16%, SW 12%, the top bins): the bank's lee at W5/W1/W8, up the arm's fetch into W9"),
            "n000": dict(direction=0.0, speed_kph=12.0, stability="neutral", hours=1.0, average_s=1200.0,
                         why="the N: W3's tree line after 240 m of open cut, W8's after 150 m of water; the bank windward (W1, W5), up the trough (W6), across the neck (W10)"),
            # the rest of the compass (Gavan, 2026-10-16: "yea - queue"): the wind surrogate's first PALM
            # training cases and held-out cells the card can take on later; explore priority
            "ne045": dict(direction=45.0, speed_kph=12.0, stability="neutral", hours=1.0, average_s=1200.0,
                          why="surrogate set: from the NE down the arm's long axis, over the neck (W10) and the pond's bay"),
            "e090": dict(direction=90.0, speed_kph=12.0, stability="neutral", hours=1.0, average_s=1200.0,
                         why="surrogate set: from the E across the east pond onto the marsh edge (W2, W4)"),
            "se135": dict(direction=135.0, speed_kph=12.0, stability="neutral", hours=1.0, average_s=1200.0,
                          why="surrogate set: from the SE over the bank's shoulder and down the trough (W6)"),
            "w270": dict(direction=270.0, speed_kph=12.0, stability="neutral", hours=1.0, average_s=1200.0,
                         why="surrogate set: from the W along the arm's open water into its head (W9)"),
            "nw315": dict(direction=315.0, speed_kph=12.0, stability="neutral", hours=1.0, average_s=1200.0,
                          why="surrogate set: from the NW across the cut (W3) and the arm"),
            "dusk210": dict(direction=210.0, speed_kph=8.0, zref_m=80.0, stability="stable", hours=2.0, average_s=1800.0,
                            theta_surface=284.0,
                            theta_gradients=[(0.0, 0.7), (300.0, 0.5)],  # Lac Bailey's dusk000 start
                            surface="rate", heating_rate=-1.0,
                            surface_heatflux=-0.02, cthf=-0.02,
                            why="dusk under a light SSW: cold air down the bank (W5, W1, W8) and down the trough (W6) to the east pond's bay (W4, W2)"),
        },
    ),
    # Gavan's spot at Lac Bailey, 2026-10-15 (via huntapp-ba): "add to your palm validation for 8pm today.
    # 4m is fine. Scent runs 271 meters - am curious." 1.7 km S of the bank box. At 20:00 EDT the app has
    # a NW 10 m wind (326 at 8.7 km/h, 80 m ~20 km/h), clear, -1.5 C, +3.8 K over 2-80 m; its ground air
    # from 229 at ~4 km/h (drainage, +-38 deg, ~100 deg off the wind) and the cone NE (66%), some-minutes
    # reach 226 m, now-and-then ~450 m. The question: does the cold air really drain NE against the NW
    # wind, and how far does the scent go. The box's centre sits 300 m NE of the spot so the core holds
    # ~650 m toward the NE. An explore run (Gavan's ask), and a candidate for the site's visuals.
    "lacbailey-spot": dict(
        area="lac-bailey",
        point=(49.39427, -69.55677),
        epsg=32619,
        hrdem=["QC-600023_29_LacAuBrochet_MTM7_2023-1m", "QC-600015_24_LidarDIF_Cote_Nord_MTM7_2015_17-1m"],
        size_m=1024.0, core_m=700.0, taper_m=160.0,
        shift=(45.0, 300.0),
        lattice=(0.0, 0.0),
        fine_water=True,
        # 140 m of relief in the box, the high ground W and S and the spot itself 86 m over the lake:
        # tapered to the lake (p5) the ring would be a moat the night's cold air drains into; at the
        # middle height (p50) the real lake stays the lowest ground
        taper_percentile=50.0,
        # check_driver: a case with a vertical spec wants five times its relief over the highest ground
        vertical=dict(const_m=40.0, dz_top_m=16.0, top_m=900.0),
        scent=dict(sources=[
            dict(name="Gavan's spot 15 Oct 20:00", latlon=(49.39427, -69.55677), heights=[1.5, 5.0]),
        ]),
        runs={
            "d326": dict(direction=326.0, speed_kph=20.0, zref_m=80.0, stability="stable", hours=2.0, average_s=1800.0,
                         theta_surface=271.0,  # at the box's floor (361 m): with +3.8 K up to the spot's 447 m, -1.5 C there (274.8 K pot.)
                         theta_gradients=[(0.0, 4.75), (80.0, 0.5)],  # +3.8 K over 2-80 m, then a stable free air
                         surface="rate", heating_rate=-1.0,
                         surface_heatflux=-0.02, cthf=-0.02,
                         why="20:00 EDT 2026-10-15 (00Z 16th), the app's forecast at the spot: NW 8.7 km/h at 10 m, ~20 at 80 m, clear, -1.5 C"),
            # the drainage fade (docs/SCENT-TESTSET.md, booked 2026-10-16, Gavan: "Yes" to accuracy that scales):
            # d326 said the floor follows a 6.5 km/h forecast wind (10 m equivalent), not the slope. The same night
            # at a third and two thirds of the wind brackets where the cold air takes over on steep ground: one
            # threshold for every tile, not a place's fix
            "d326u06": dict(direction=326.0, speed_kph=6.0, zref_m=80.0, stability="stable", hours=2.0, average_s=1800.0,
                            theta_surface=271.0, theta_gradients=[(0.0, 4.75), (80.0, 0.5)],
                            surface="rate", heating_rate=-1.0, surface_heatflux=-0.02, cthf=-0.02,
                            why="drainage fade: d326's night at 6 km/h at 80 m (~2 km/h forecast 10 m): does the cold air drain down the slope"),
            "d326u12": dict(direction=326.0, speed_kph=12.0, zref_m=80.0, stability="stable", hours=2.0, average_s=1800.0,
                            theta_surface=271.0, theta_gradients=[(0.0, 4.75), (80.0, 0.5)],
                            surface="rate", heating_rate=-1.0, surface_heatflux=-0.02, cthf=-0.02,
                            why="drainage fade: d326's night at 12 km/h at 80 m (~4 km/h forecast 10 m): drainage or the wind"),
        },
    ),
    # Not here: Searchmont's climb. A cyclic box small enough for 4 m (1.5 km) holds 194 m
    # between the valley floor and the plateau, and blending its edges to one height puts a
    # cliff upwind of the climb. It wants a small box driven by the 10 m run (offline nesting).
}

# PAI of a closed crown column (leaf + wood per ground area under the crown)
PAI_CONIFER = 4.0
PAI_HARDWOOD_BARE = 1.0
PAI_HARDWOOD_LEAVES = 3.5
SHAPE = {"conifer": (1.8, 2.2), "hardwood": (4.0, 2.0)}  # beta(alpha, beta) on z/h
TREE_M = 2.0  # a DSM-DTM pixel over this is a crown
DRAG = 0.2  # canopy_drag_coeff (Cescatti and Marcolla 2004; PALM's default is 0.15)

# habitat cover classes (build_habitat.py coverNames)
WATER, OPEN_WET, TREED_WET, CON_DENSE, CON_OPEN, MIXED, HARD, SHRUB, REGEN, ROCK, ROAD = range(1, 12)
Z0 = {WATER: 0.0002, OPEN_WET: 0.03, ROCK: 0.01, ROAD: 0.01}
Z0_DEFAULT = 0.1


# ---------------------------------------------------------------- the grid

def meridian_convergence(epsg: int, lon: float, lat: float) -> float:
    """Degrees from grid north to true north, pyproj's sign (as fields.py)."""
    from pyproj import CRS, Proj
    return float(Proj(CRS.from_epsg(epsg)).get_factors(lon, lat).meridian_convergence)


def grid_for(case: dict, dx: float) -> dict:
    from pyproj import Transformer
    lat, lon = case["point"]
    to = Transformer.from_crs(4326, case["epsg"], always_xy=True)
    back = Transformer.from_crs(case["epsg"], 4326, always_xy=True)
    px, py = to.transform(lon, lat)
    b, d = case["shift"]
    cx, cy = px + d * math.sin(math.radians(b)), py + d * math.cos(math.radians(b))
    n = int(round(case["size_m"] / dx))
    lx0, ly0 = case["lattice"]
    # the corner on a 20 m lattice through the trial's 10 m one, so the 5, 10
    # and 20 m grids nest and share one 1 m cache
    step = 20.0
    x0 = lx0 + step * round((cx - case["size_m"] / 2 - lx0) / step)
    y0 = ly0 + step * round((cy - case["size_m"] / 2 - ly0) / step)
    olon, olat = back.transform(x0, y0)
    gamma = meridian_convergence(case["epsg"], *back.transform(x0 + n * dx / 2, y0 + n * dx / 2))
    return dict(dx=dx, nx=n, ny=n, x0=x0, y0=y0, x1=x0 + n * dx, y1=y0 + n * dx,
                point_xy=(px, py), origin_lonlat=(olon, olat), gamma=gamma)


# ---------------------------------------------------------------- inputs

def fetch_1m(case_id: str, case: dict, g: dict, refresh: bool = False) -> dict:
    """The 1 m DTM and canopy height over the domain on its own UTM lattice,
    from HRDEM's COGs (EPSG:3979) warped onto it; cached in pipeline/raw."""
    import rasterio
    from rasterio.enums import Resampling
    from rasterio.transform import from_origin
    from rasterio.vrt import WarpedVRT

    CACHE.mkdir(parents=True, exist_ok=True)
    out = CACHE / f"{case_id}-1m.npz"
    bounds = [g["x0"], g["y0"], g["x1"], g["y1"]]
    if out.exists() and not refresh:
        z = np.load(out)
        if list(z["bounds"]) == bounds:
            return dict(dtm=z["dtm"], chm=z["chm"].astype(np.float32) / 10.0, sources=list(z["sources"]))
    w, h = int(round(g["x1"] - g["x0"])), int(round(g["y1"] - g["y0"]))
    tr = from_origin(g["x0"], g["y1"], 1.0, 1.0)
    dtm = np.full((h, w), np.nan, np.float32)
    dsm = np.full((h, w), np.nan, np.float32)
    used = []
    env = dict(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif",
               GDAL_HTTP_MAX_RETRY="4", GDAL_HTTP_RETRY_DELAY="2", VSI_CACHE="TRUE")
    with rasterio.Env(**env):
        for proj in case["hrdem"]:
            for kind, arr in (("dtm", dtm), ("dsm", dsm)):
                if not np.isnan(arr).any():
                    continue
                t0 = time.time()
                with rasterio.open(f"/vsicurl/{HRDEM}{proj}-{kind}.tif") as src:
                    with WarpedVRT(src, crs=f"EPSG:{case['epsg']}", transform=tr, width=w, height=h,
                                   resampling=Resampling.bilinear, src_nodata=src.nodata, nodata=np.nan) as vrt:
                        a = vrt.read(1, out_dtype="float32")
                a[(a < -1000) | (a > 9000)] = np.nan
                fill = np.isnan(arr) & np.isfinite(a)
                arr[fill] = a[fill]
                print(f"  {proj} {kind}: {fill.mean():.1%} of the box filled · {time.time() - t0:.0f} s", flush=True)
                if fill.any():
                    used.append(f"{proj}-{kind}")
    gap = np.isnan(dtm)
    if gap.mean() > 0.001:
        raise SystemExit(f"HRDEM leaves {gap.mean():.2%} of the box without ground: use --terrain mrdem")
    if gap.any():
        # a hairline seam between two surveys (Whitefish: Kirkland Lake 2024 against Timmins 2023): the nearest ground
        from scipy import ndimage
        idx = ndimage.distance_transform_edt(gap, return_distances=False, return_indices=True)
        dtm = dtm[tuple(idx)]
        print(f"  {int(gap.sum())} cells on a seam between surveys filled from the nearest ground", flush=True)
    chm = np.where(np.isfinite(dsm), np.clip(dsm - dtm, 0, 60), 0).astype(np.float32)
    np.savez_compressed(out, dtm=dtm, chm=np.round(chm * 10).astype(np.uint16), bounds=np.array(bounds), sources=np.array(used))
    return dict(dtm=dtm, chm=chm, sources=used)


def area_habitat(area_id: str):
    """The area's habitat grid (habfile) and its lon/lat lattice, found the
    way area.py finds an area's files (bake.outDir, else areas/<id>)."""
    import habfile
    a = json.loads((ROOT / "app" / "src" / "areas" / f"{area_id}.json").read_text(encoding="utf-8"))
    out_dir = ROOT / (a.get("bake") or {}).get("outDir", f"app/public/data/areas/{area_id}")
    header, bands = habfile.read_hab(out_dir / f"habitat-{area_id}.hab")
    return header, bands


def sample_habitat(header: dict, bands: dict, lon: np.ndarray, lat: np.ndarray, names: list[str]) -> dict:
    c = np.floor((lon - header["west"]) / header["dLon"]).astype(int)
    r = np.floor((header["north"] - lat) / header["dLat"]).astype(int)
    inside = (c >= 0) & (c < header["cols"]) & (r >= 0) & (r < header["rows"])
    if not inside.all():
        raise SystemExit(f"{(~inside).mean():.1%} of the domain is outside the area's habitat grid")
    return {k: bands[k][r, c] for k in names}


def water_fraction(case: dict, g: dict) -> tuple:
    """The share of each cell that is water, from the area's 1 m lake mask
    (pipeline/raw/lakes-1m-<area>.npz, pipeline/lakes.py) when there is one,
    else its lake outlines (waterbody-<area>.geojson) burnt in at 1 m."""
    import rasterio
    from rasterio.enums import Resampling
    from rasterio.features import rasterize
    from rasterio.transform import from_origin
    from rasterio.warp import reproject, transform_geom
    dx, nx, ny = g["dx"], g["nx"], g["ny"]
    npz = PIPE / "raw" / f"lakes-1m-{case['area']}.npz"
    if npz.exists():
        z = np.load(npz)
        wet = np.zeros((ny, nx), np.float32)
        reproject(z["water"].astype(np.float32), wet, src_transform=rasterio.Affine(*z["transform"]), src_crs=str(z["crs"]),
                  dst_transform=from_origin(g["x0"], g["y1"], dx, dx), dst_crs=f"EPSG:{case['epsg']}",
                  resampling=Resampling.average)
        return wet, f"1 m lake mask of area {case['area']} (pipeline/lakes.py)"
    a = json.loads((ROOT / "app" / "src" / "areas" / f"{case['area']}.json").read_text(encoding="utf-8"))
    out_dir = ROOT / (a.get("bake") or {}).get("outDir", f"app/public/data/areas/{case['area']}")
    fc = json.loads((out_dir / f"waterbody-{case['area']}.geojson").read_text(encoding="utf-8"))
    geoms = [transform_geom("EPSG:4326", f"EPSG:{case['epsg']}", f["geometry"]) for f in fc["features"] if f.get("geometry")]
    block = int(round(dx))
    w1 = rasterize(geoms, out_shape=(ny * block, nx * block), transform=from_origin(g["x0"], g["y1"], 1.0, 1.0),
                   fill=0, default_value=1, dtype="uint8")
    wet = w1.reshape(ny, block, nx, block).mean(axis=(1, 3)).astype(np.float32)
    return wet, f"lake outlines of area {case['area']} (waterbody-{case['area']}.geojson) at 1 m"


# ---------------------------------------------------------------- canopy

def beta_cdf(x: np.ndarray, a: float, b: float) -> np.ndarray:
    from scipy.special import betainc
    return betainc(a, b, np.clip(x, 0.0, 1.0))


def lad_levels(chm: np.ndarray, pai_crown: np.ndarray, conifer_share: np.ndarray, dz: float, nlev: int,
               block: int) -> np.ndarray:
    """LAD (m2/m3) on PALM's levels k = 1..nlev (layer [(k-1) dz, k dz] above
    the ground), each cell the mean over its block x block pixels of the 1 m
    crowns. chm in m at 1 m; pai_crown, conifer_share per cell."""
    ny, nx = pai_crown.shape
    h = chm.reshape(ny, block, nx, block)
    tree = h > TREE_M
    hh = np.where(tree, h, 1.0)
    out = np.zeros((nlev + 1, ny, nx), np.float32)
    cs = conifer_share[:, None, :, None]
    pai = pai_crown[:, None, :, None]
    for k in range(1, nlev + 1):
        lo, hi = (k - 1) * dz / hh, k * dz / hh
        frac = (cs * (beta_cdf(hi, *SHAPE["conifer"]) - beta_cdf(lo, *SHAPE["conifer"]))
                + (1 - cs) * (beta_cdf(hi, *SHAPE["hardwood"]) - beta_cdf(lo, *SHAPE["hardwood"])))
        leaf = np.where(tree, pai * frac, 0.0)  # m2 of plant area per m2 of ground in the layer
        out[k] = (leaf.mean(axis=(1, 3)) / dz).astype(np.float32)
    out[0] = out[1]  # zlad = 0: PALM integrates through it, applies no drag there
    return out


def lad_from_forest(height: np.ndarray, crown: np.ndarray, pai_crown: np.ndarray, conifer_share: np.ndarray,
                    dz: float, nlev: int) -> np.ndarray:
    """The fallback: the FRI stand height and crown closure, one crown per cell."""
    cover = np.clip(crown / 100.0, 0, 1) * (height > TREE_M)
    hh = np.where(height > TREE_M, height, 1.0)
    out = np.zeros((nlev + 1,) + height.shape, np.float32)
    for k in range(1, nlev + 1):
        lo, hi = (k - 1) * dz / hh, k * dz / hh
        frac = (conifer_share * (beta_cdf(hi, *SHAPE["conifer"]) - beta_cdf(lo, *SHAPE["conifer"]))
                + (1 - conifer_share) * (beta_cdf(hi, *SHAPE["hardwood"]) - beta_cdf(lo, *SHAPE["hardwood"])))
        out[k] = (cover * pai_crown * frac / dz).astype(np.float32)
    out[0] = out[1]
    return out


# ---------------------------------------------------------------- the vertical grid

def vertical_grid(dz: float, relief: float, spec: dict | None = None) -> dict:
    """dz up to the relief plus 270 m (the stable layer, the lee and the wake
    resolved), stretched to 4 dz over the next 500 m (40 dz when coarser, to
    keep PALM's stretch factor under 1.12), 4 dz on to about 1.6 km above the
    lowest ground. Returns PALM's dz / stretch parameters and nz.

    A case's `vertical` (const_m, dz_top_m, top_m) sets a shallow column for a
    fine grid instead: dz to const_m over the highest ground, stretched to
    dz_top_m over the height a 1.08 stretch needs (and a quarter more), to top_m."""
    if spec:
        start = dz * math.ceil((relief + spec["const_m"]) / dz)
        dz2 = max(dz, spec["dz_top_m"])
        end = start + 1.25 * dz * (dz2 / dz - 1) / 0.08
        end = dz2 * math.ceil(end / dz2)
        top = max(spec["top_m"], end + 3 * dz2)
    else:
        start = dz * math.ceil((relief + 270.0) / dz)
        # PALM warns past a stretch factor of 1.12: dz to 4 dz needs about 40 dz of height
        end = start + max(500.0, 40.0 * dz)
        top = max(1600.0, end + 300.0)
        dz2 = 4 * dz
    # PALM's levels, approximately: constant, then geometric to dz2 by `end`, then constant
    zs, z, d = [], dz / 2, dz
    while z < top:
        zs.append(z)
        if z >= end:
            d = dz2
        elif z >= start:
            d = min(dz2, d * 1.08)
        z += d
    return dict(dz=[dz, dz2], start=start, end=end, nz=len(zs), top=round(zs[-1]))


def child_vertical(dz_child: float, parent_vg: dict) -> dict:
    """The child: dz_child up to two root cells under where the root starts
    to stretch. PALM wants the root's dz over the child's a whole number at
    every child level (PMC0018), and a top on the stretch line failed it."""
    top = parent_vg["start"] - 2 * parent_vg["dz"][0]
    return dict(dz=[dz_child], start=None, end=None, nz=int(round(top / dz_child)), top=round(top))


def child_grid(g: dict, dx: float, size_m: float, case: dict) -> dict:
    """A child box of size_m centred on the root's centre, its corner and
    size on the root's lattice (PALM's nesting needs both)."""
    from pyproj import Transformer
    pdx = g["dx"]
    size = pdx * round(size_m / pdx)
    cx, cy = (g["x0"] + g["x1"]) / 2, (g["y0"] + g["y1"]) / 2
    x0 = g["x0"] + pdx * round((cx - size / 2 - g["x0"]) / pdx)
    y0 = g["y0"] + pdx * round((cy - size / 2 - g["y0"]) / pdx)
    n = int(round(size / dx))
    back = Transformer.from_crs(case["epsg"], 4326, always_xy=True)
    return dict(dx=dx, nx=n, ny=n, x0=x0, y0=y0, x1=x0 + size, y1=y0 + size, point_xy=g["point_xy"],
                origin_lonlat=back.transform(x0, y0), gamma=g["gamma"], llx=x0 - g["x0"], lly=y0 - g["y0"])


# ---------------------------------------------------------------- the namelists

def profile(speed_ms: float, from_grid_deg: float, z0_eff: float = 1.0, zref: float = 30.0) -> tuple:
    """A neutral log profile through speed_ms at zref above the lowest ground
    (canopy top + 10 m over 20 m trees, WindNinja's 10 m over vegetation),
    held above 500 m: the initial wind and the volume flow kept."""
    ustar = 0.4 * speed_ms / math.log((zref + z0_eff) / z0_eff)
    hs = [0.0, 10.0, 30.0, 60.0, 100.0, 200.0, 300.0, 500.0, 3000.0]
    sp = [0.0] + [ustar / 0.4 * math.log((min(z, 500.0) + z0_eff) / z0_eff) for z in hs[1:]]
    ex, ey = -math.sin(math.radians(from_grid_deg)), -math.cos(math.radians(from_grid_deg))
    return hs, [round(s * ex, 3) for s in sp], [round(s * ey, 3) for s in sp]


def fmt(xs) -> str:
    return ", ".join(f"{x:g}" if isinstance(x, (int, float)) else str(x) for x in xs)


SCENT_RELEASE_S = 900.0     # particles alive this long (the cone's own 15 min horizon), released from this long before the window
SCENT_DT_PREL = 2.0         # a release every 2 s: 3 x 3 particles on a 1 m box per source
SCENT_DT_WRITE = 20.0       # positions written every 20 s (three samples a minute for the how-often bands)


def scent_sources(case: dict, g: dict, f: dict, run: dict) -> list[dict]:
    """Up to ten scent sources for a run: the case's own list first, then the
    point at 1.5 and 5 m, then a ring round the point, all on land inside the
    core. Coordinates in the namelist are metres from the domain's SW corner."""
    from pyproj import Transformer
    if run.get("scent") is False:
        return []
    spec = dict(case.get("scent") or {})
    spec.update(run.get("scent") or {})
    dx, nx, ny = g["dx"], g["nx"], g["ny"]
    x0, y0, y1 = g["x0"], g["y0"], g["y1"]
    water, dtm, canopy_h = f["water"], f["dtm"], f["canopy_h"]   # row 0 north
    to_xy = Transformer.from_crs(4326, case["epsg"], always_xy=True)
    core = case["core_m"] / 2
    cx, cy = (g["x0"] + g["x1"]) / 2, (g["y0"] + g["y1"]) / 2

    def cell(x, y):
        c, r = int((x - x0) / dx), int((y1 - y) / dx)
        return (r, c) if 0 <= r < ny and 0 <= c < nx else None

    def snap_land(x, y, max_m):
        """The nearest land cell centre within max_m (a hunter stands on the bank, not in the slot)."""
        rc = cell(x, y)
        if rc is None or not water[rc]:
            return x, y
        n = int(math.ceil(max_m / dx))
        best = None
        for dr in range(-n, n + 1):
            for dc in range(-n, n + 1):
                r, c = rc[0] + dr, rc[1] + dc
                if 0 <= r < ny and 0 <= c < nx and not water[r, c]:
                    xx, yy = x0 + (c + 0.5) * dx, y1 - (r + 0.5) * dx
                    d = math.hypot(xx - x, yy - y)
                    if d <= max_m and (best is None or d < best[0]):
                        best = (d, xx, yy)
        return (best[1], best[2]) if best else (None, None)

    def place(name, x, y, h, must_land=True, snap_m=0.0):
        if must_land and snap_m > 0:
            x, y = snap_land(x, y, snap_m)
            if x is None:
                return None
        if abs(x - cx) > core or abs(y - cy) > core:
            return None
        rc = cell(x, y)
        if rc is None or (must_land and water[rc]):
            return None
        if any(math.hypot(o["utm"][0] - x, o["utm"][1] - y) < 3.0 and abs(o["h"] - h) < 0.1 for o in out):
            return None  # the same spot twice (the point snapped onto a listed bank)
        return dict(name=name, x=round(x - x0, 1), y=round(y - y0, 1), h=float(h), utm=[round(x, 1), round(y, 1)],
                    ground_m=round(float(dtm[rc]), 1), canopy_m=round(float(canopy_h[rc]), 1), water=bool(water[rc]))

    out = []
    for src in spec.get("sources", []):
        if "latlon" in src:
            x, y = to_xy.transform(src["latlon"][1], src["latlon"][0])
        else:
            x, y = src["xy"]
        for h in src.get("heights", [1.5]):
            sv = place(f"{src['name']} {h:g} m", x, y, h, must_land=not src.get("over_water"), snap_m=max(15.0, 3 * dx))
            if sv:
                out.append(sv)
    px, py = g["point_xy"]
    for h in (1.5, 5.0):
        sv = place(f"the point {h:g} m", px, py, h, snap_m=60.0)   # a point in a slot or on a lake: its nearest bank
        if sv:
            out.append(sv)
    radius = float(spec.get("radius_m", case["core_m"] / 5))
    for k in range(8):
        if len(out) >= 10:
            break
        a = math.radians(k * 45.0)
        for rr in (radius, radius * 0.7, radius * 1.3):      # slide the point if it lands on water
            sv = place(f"ring {k * 45:03d} {rr:.0f} m", px + rr * math.sin(a), py + rr * math.cos(a), 1.5, snap_m=2 * dx)
            if sv:
                out.append(sv)
                break
    return out[:10]


def p3d(name: str, case_id: str, run: dict, g: dict, vg: dict, hours: float, nz_do3d: int,
        nest: dict | None = None, child: bool = False, scent: list[dict] | None = None) -> str:
    """The namelist of the root domain, or with child=True of the nested
    child (<name>_p3d_N02): its own grid, the multigrid solver (no FFT
    without cyclic boundaries), its boundaries from the root. `scent`: the
    run's particle sources (scent_sources), root only."""
    dx = g["dx"]
    from_grid = run["direction"] - g["gamma"]
    hs, us, vs = profile(run["speed_kph"] / 3.6, from_grid, zref=run.get("zref_m", 30.0))
    end = hours * 3600.0
    avg = min(run["average_s"], end / 2)
    st = run["stability"]
    lines = [
        f"! {name}{' (nested child, N02)' if child else ''}: PALM {case_id}, {st}, wind from {run['direction']:g} deg true "
        f"({from_grid:.2f} on the UTM grid),",
        f"! {run['speed_kph']:g} km/h at {run.get('zref_m', 30.0):g} m over the lowest ground. Built by pipeline/teacher/palm/build_case.py.",
        f"! {run['why']}",
    ]
    if nest and not child:
        lines += [
            "&nesting_parameters",
            f"    domain_layouts = 'root',  1, -1, {nest['npe'][0]}, 0.0, 0.0, 0.0,",
            f"                     'core',  2,  1, {nest['npe'][1]}, {nest['llx']:g}, {nest['lly']:g}, 0.0,",
            "    nesting_mode = 'one-way',             ! the root sets the core's boundaries; nothing fed back over the terrain",
            "/",
            "",
        ]
    lines += [
        "&initialization_parameters",
        f"    nx = {g['nx'] - 1}, ny = {g['ny'] - 1}, nz = {vg['nz']},",
        f"    dx = {dx:g}, dy = {dx:g}, dz = {fmt(vg['dz'])},",
    ]
    if not child:
        lines += [
            f"    dz_stretch_level_start = {vg['start']:g},",
            f"    dz_stretch_level_end = {vg['end']:g},",
        ]
    lines += [
        "    topography = 'read_from_file',",
        "    initializing_actions = 'set_constant_profiles',",
    ]
    if not child:
        lines += ["    bc_lr = 'cyclic', bc_ns = 'cyclic',"]
    lines += [
        "    omega = 0.0,                          ! no Coriolis, as WindNinja; the grid's rotation does not matter then",
        f"    uv_heights = {fmt(hs)},",
        f"    u_profile  = {fmt(us)},",
        f"    v_profile  = {fmt(vs)},",
        "    roughness_length = 0.1,               ! where the driver's z0 has no value",
    ]
    if child:
        lines += [
            "    psolver = 'multigrid',",
            "    cycle_mg = 'w',",
            "    mg_cycles = -1,                       ! iterate to residual_limit: 2 cycles left divergence over the terrain and jets at the edge",
        ]
    else:
        lines += [
            "    conserve_volume_flow = .T.,",
            "    conserve_volume_flow_mode = 'initial_profiles',",
            f"    rayleigh_damping_height = {vg['end'] + 100:g},",
            "    rayleigh_damping_factor = 0.01,",
            "    psolver = 'poisfft',",
            "    fft_method = 'fftw',",
        ]
    if st == "neutral":
        lines += ["    neutral = .T.,"]
    else:
        lv, gr = zip(*run["theta_gradients"])
        lines += [
            "    neutral = .F.,",
            f"    pt_surface = {run['theta_surface']:g},",
            f"    pt_vertical_gradient = {fmt(gr)},",
            f"    pt_vertical_gradient_level = {fmt(lv)},",
        ]
        surface = run.get("surface", "flux")
        if surface == "rate":
            lines += [
                "    bc_pt_b = 'dirichlet',",
                f"    pt_surface_heating_rate = {run['heating_rate']:g},   ! K/h: the ground's temperature falls; the flux follows the turbulence",
            ]
        elif surface == "none":
            lines += [
                "    bc_pt_b = 'neumann',",
                "    surface_heatflux = 0.0,               ! stable air from the profile alone: lee waves and rotors, no cold pool",
            ]
        else:
            f = run["surface_heatflux"]
            lines += [
                "    bc_pt_b = 'neumann',",
                f"    surface_heatflux = {f:g},              ! K m/s, the model's bottom (the lowest ground)",
                f"    wall_heatflux = {f:g}, 0.0, 0.0, 0.0, 0.0, 0.0,   ! raised ground: upward faces only, so a stair-stepped slope is not counted twice",
            ]
    lines += [
        "/",
        "",
        "&runtime_parameters",
        f"    end_time = {end:g},",
    ]
    if child and nest:
        # the multigrid wants equal subdomains: the child's rank grid, set (pe_grid checked it divides)
        lines += [f"    npex = {nest['pe_grid'][0]}, npey = {nest['pe_grid'][1]},"]
    lines += [
        "    create_disturbances = .T.,",
        "    dt_disturb = 150.0,",
        "    disturbance_energy_limit = 0.01,",
        "    dt_run_control = 60.0,",
        "    netcdf_data_format = 2,",
        "    interpolate_to_grid_center = .T.,     ! u, v, w on the cell centres: the DEM's lattice",
        "",
        "    ! the field the teacher gives: the mean over the last stretch, near the ground",
        "    data_output = 'u_av', 'v_av', 'w_av', 'e_av',"
        + (" 'theta_av'," if st != "neutral" else "") + (" 'pc_av'," if scent else ""),
        f"    nz_do3d = {nz_do3d},",
        f"    averaging_interval = {avg:g},",
        f"    dt_data_output_av = {avg:g},",
        f"    skip_time_data_output_av = {end - avg:g},",
        "    dt_averaging_input = 10.0,",
        "",
        "    ! gusts and lulls: the lowest four levels over the ground, every 30 s over the same stretch",
        "    data_output_masks(1,:) = 'u', 'v', 'w'," + (" 'pc'," if scent else ""),
        "    mask_k_over_surface(1,:) = 1, 2, 3, 4,",
        "    dt_domask(1) = 30.0,",
        f"    skip_time_domask(1) = {end - avg:g},",
        "",
    ]
    viz = run.get("viz")
    if viz and not child:
        # snapshots of the whole air round the point, for the pictures: the gusts
        # themselves, not the mean (a box viz box_m across at stride_m, the ground
        # to top_m over the lowest ground, every dt_s over the last last_s)
        cx, cy = g["point_xy"][0] - g["x0"], g["point_xy"][1] - g["y0"]
        hb = viz["box_m"] / 2
        lines += [
            "    ! 3D snapshots round the point for the pictures (pipeline/teacher/palm, viz)",
            "    data_output_masks(2,:) = 'u', 'v', 'w',",
            f"    mask_x_loop(2,:) = {cx - hb:.0f}.0, {cx + hb:.0f}.0, {viz['stride_m']:g},",
            f"    mask_y_loop(2,:) = {cy - hb:.0f}.0, {cy + hb:.0f}.0, {viz['stride_m']:g},",
            f"    mask_z_loop(2,:) = {dx / 2:g}, {viz['top_m']:g}, {dx:g},",
            f"    dt_domask(2) = {viz['dt_s']:g},",
            f"    skip_time_domask(2) = {max(0.0, end - viz['last_s']):g},",
            "",
        ]
    lines += [
        "    data_output_pr = '#u', '#v', 'w', 'e', 'w\"u\"', 'w\"v\"'" + (", '#theta', 'w\"theta\"'" if st != "neutral" else "") + ",",
        "    dt_dopr = 600.0,",
        "    averaging_interval_pr = 600.0,",
        "    dt_dots = 60.0,",
        "/",
        "",
        "&plant_canopy_parameters",
        "    canopy_mode = 'read_from_file',",
        f"    canopy_drag_coeff = {run.get('drag', DRAG):g},",
    ]
    if st != "neutral" and run.get("cthf"):
        lines += [f"    cthf = {run['cthf']:g},                    ! K m/s at the canopy top (the code's unit; the docs say W/m2)"]
    lines += ["/", ""]
    if scent and not child:
        start = max(0.0, end - avg - SCENT_RELEASE_S)
        lines += [
            "&particle_parameters",
            "    ! scent (docs/SCENT-TEACHER.md): one passive particle group per source, released on a 1 m box",
            "    ! at its height over the local ground, carried by the resolved flow plus the subgrid walk,",
            "    ! reflected at the ground, 15 min of life. palm_to_scent.py reads OUTPUT/<run>_prt_bin.",
            f"    number_of_particle_groups = {len(scent)},",
        ]
        for i, sv in enumerate(scent, 1):
            lines += [
                f"    ! {i}: {sv['name']} (ground {sv['ground_m']:g} m, canopy {sv['canopy_m']:g} m{', water' if sv['water'] else ''})",
                f"    psl({i}) = {sv['x'] - 0.5:.1f}, psr({i}) = {sv['x'] + 0.5:.1f}, pss({i}) = {sv['y'] - 0.5:.1f}, psn({i}) = {sv['y'] + 0.5:.1f}, "
                f"psb({i}) = {sv['h']:g}, pst({i}) = {sv['h']:g}, pdx({i}) = 0.5, pdy({i}) = 0.5, pdz({i}) = 1.0,",
            ]
        lines += [
            "    seed_follows_topography = .T.,        ! psb/pst are heights over the cell's ground",
            f"    particle_advection_start = {start:g},",
            f"    end_time_prel = {end:g},",
            f"    dt_prel = {SCENT_DT_PREL:g},",
            f"    particle_maximum_age = {SCENT_RELEASE_S:g},",
            "    use_sgs_for_particles = .T.,",
            "    density_ratio = 0.0, radius = 0.0,    ! passive: no inertia, no settling",
            "    bc_par_b = 'reflect', bc_par_t = 'absorb', bc_par_lr = 'absorb', bc_par_ns = 'absorb',   ! a particle that leaves the box is gone: cyclic edges sent them round again (the first run)",
            f"    dt_write_particle_data = {SCENT_DT_WRITE:g},",
            "    write_particle_statistics = .F.,",
            "/",
            "",
        ]
    return "\n".join(lines)


# ---------------------------------------------------------------- the driver

def write_static(path: Path, g: dict, zt: np.ndarray, lad: np.ndarray, z0: np.ndarray, dz: float,
                 epsg: int, meta: dict) -> None:
    from netCDF4 import Dataset
    from pyproj import Transformer
    ny, nx = zt.shape
    nzl = lad.shape[0]
    back = Transformer.from_crs(epsg, 4326, always_xy=True)
    xs = (np.arange(nx) + 0.5) * g["dx"]
    ys = (np.arange(ny) + 0.5) * g["dx"]
    E, N = np.meshgrid(g["x0"] + xs, g["y0"] + ys)
    lon, lat = back.transform(E, N)
    path.parent.mkdir(parents=True, exist_ok=True)
    with Dataset(path, "w", format="NETCDF4") as nc:
        nc.Conventions = "CF-1.7"
        nc.title = f"PALM static driver: {meta['case']} ({g['dx']:g} m)"
        nc.institution = "Groundwind"
        nc.source = "; ".join(meta["sources"])
        nc.history = f"pipeline/teacher/palm/build_case.py {time.strftime('%Y-%m-%d %H:%M')}"
        nc.comment = ("UTM grid north (rotation_angle 0); true north is "
                      f"{g['gamma']:+.3f} deg from it (meridian convergence). Terrain tapered to a constant "
                      f"over the outer {meta['taper_m']:g} m for cyclic boundaries.")
        nc.origin_lat = np.float32(g["origin_lonlat"][1])
        nc.origin_lon = np.float32(g["origin_lonlat"][0])
        nc.origin_x = np.float32(g["x0"])
        nc.origin_y = np.float32(g["y0"])
        nc.origin_z = np.float32(meta["origin_z"])
        nc.rotation_angle = np.float32(0.0)
        nc.origin_time = "2026-10-10 21:30:00 +00"
        nc.createDimension("x", nx)
        nc.createDimension("y", ny)
        nc.createDimension("zlad", nzl)
        v = nc.createVariable("x", "f4", ("x",)); v[:] = xs; v.units = "m"; v.long_name = "distance to origin in x-direction"; v.axis = "X"
        v = nc.createVariable("y", "f4", ("y",)); v[:] = ys; v.units = "m"; v.long_name = "distance to origin in y-direction"; v.axis = "Y"
        v = nc.createVariable("zlad", "f4", ("zlad",)); v[:] = np.r_[0.0, (np.arange(1, nzl) - 0.5) * dz]; v.units = "m"; v.long_name = "height above ground of the canopy levels"; v.axis = "Z"
        v = nc.createVariable("zt", "f4", ("y", "x"), fill_value=-9999.0); v[:] = zt; v.units = "m"; v.long_name = "terrain height above origin_z"; v.res_orig = np.float32(g["dx"])
        v = nc.createVariable("lad", "f4", ("zlad", "y", "x"), fill_value=-9999.0); v[:] = lad; v.units = "m2 m-3"; v.long_name = "leaf area density"
        v = nc.createVariable("z0", "f4", ("y", "x"), fill_value=-9999.0); v[:] = z0; v.units = "m"; v.long_name = "roughness length for momentum"
        v = nc.createVariable("E_UTM", "f8", ("y", "x")); v[:] = E; v.units = "m"; v.long_name = f"easting, EPSG:{epsg}"
        v = nc.createVariable("N_UTM", "f8", ("y", "x")); v[:] = N; v.units = "m"; v.long_name = f"northing, EPSG:{epsg}"
        v = nc.createVariable("lat", "f8", ("y", "x")); v[:] = lat; v.units = "degrees_north"; v.long_name = "latitude"
        v = nc.createVariable("lon", "f8", ("y", "x")); v[:] = lon; v.units = "degrees_east"; v.long_name = "longitude"


def taper(a: np.ndarray, width_cells: int, value: float) -> np.ndarray:
    """Blend a toward value over the outer width_cells cells (cosine), so
    the field is periodic at the edges."""
    ny, nx = a.shape
    def w1(n):
        # cells from the edge: the outer two exactly at value, then a cosine to 1
        d = np.minimum(np.arange(n), n - 1 - np.arange(n)).astype(np.float64)
        ramp = 0.5 - 0.5 * np.cos(np.pi * np.clip(d - 2, 0, None) / (width_cells - 2))
        return np.where(d < 2, 0.0, np.where(d >= width_cells, 1.0, ramp))
    w = np.minimum.outer(w1(ny), w1(nx))
    return value + w * (a - value)


def cell_fields(case: dict, g: dict, args, one: dict | None, root: dict) -> dict:
    """Terrain, canopy and roughness on grid g, a box inside the root's
    (the 1 m cache covers the root)."""
    dx, nx, ny = g["dx"], g["nx"], g["ny"]
    block = int(round(dx))
    sources = []
    if one is not None:
        r0, c0 = int(round(root["y1"] - g["y1"])), int(round(g["x0"] - root["x0"]))
        h, w = int(round(g["y1"] - g["y0"])), int(round(g["x1"] - g["x0"]))
        dtm1, chm1 = one["dtm"][r0:r0 + h, c0:c0 + w], one["chm"][r0:r0 + h, c0:c0 + w]
        sources += [f"HRDEM 1 m LiDAR ({', '.join(one['sources'])}), NRCan, OGL-Canada"]
    if args.terrain == "hrdem":
        dtm = dtm1.reshape(ny, block, nx, block).mean(axis=(1, 3))
    else:
        import rasterio
        from rasterio.enums import Resampling
        from rasterio.transform import from_origin
        from rasterio.warp import reproject
        z = np.load(PIPE / "raw" / f"mrdem-{case['area']}.npz")
        dtm = np.zeros((ny, nx), np.float32)
        reproject(z["data"], dtm, src_transform=rasterio.Affine(*z["transform"]), src_crs=str(z["crs"]),
                  dst_transform=from_origin(g["x0"], g["y1"], dx, dx), dst_crs=f"EPSG:{case['epsg']}",
                  resampling=Resampling.bilinear, src_nodata=float(z["nodata"]))
        sources += ["MRDEM 30 m, NRCan, OGL-Canada"]

    # the habitat at each cell centre (FRI composition, cover class)
    from pyproj import Transformer
    back = Transformer.from_crs(case["epsg"], 4326, always_xy=True)
    xs = g["x0"] + (np.arange(nx) + 0.5) * dx
    ys = g["y1"] - (np.arange(ny) + 0.5) * dx  # north row first
    E, N = np.meshgrid(xs, ys)
    lon, lat = back.transform(E, N)
    header, bands = area_habitat(case["area"])
    hab = sample_habitat(header, bands, lon, lat, ["cover", "height", "crown", "conifer", "hardwood"])
    sources += [f"habitat grid of area {case['area']} (FRI stands, OMNRF, OGL-Ontario)"]
    cover = hab["cover"].astype(int)
    con, hw = hab["conifer"].astype(np.float32), hab["hardwood"].astype(np.float32)
    tot = con + hw
    # no composition from the map: half and half, or the class's lean
    lean = np.select([cover == CON_DENSE, cover == CON_OPEN, cover == TREED_WET, cover == HARD],
                     [0.9, 0.9, 0.9, 0.1], 0.5)
    conifer_share = np.where(tot > 0, con / np.maximum(tot, 1), lean).astype(np.float32)
    pai_crown = (conifer_share * PAI_CONIFER
                 + (1 - conifer_share) * (PAI_HARDWOOD_BARE + args.leaf * PAI_HARDWOOD_LEAVES)).astype(np.float32)
    water = cover == WATER
    if case.get("fine_water"):
        # at a few metres the habitat's 30 m water cells would take the trees off a
        # narrow channel's walls or a lake's bank: water at 1 m, a cell wet when most
        # of its pixels are
        wet, how = water_fraction(case, g)
        water = wet > 0.5
        cover = np.where(water, WATER, np.where(cover == WATER, OPEN_WET, cover))
        sources += [how]

    if args.canopy == "chm":
        import warnings
        from scipy.ndimage import grey_closing
        chm = grey_closing(chm1, size=(3, 3))
        hmax = float(np.percentile(chm[chm > TREE_M], 99.9)) if (chm > TREE_M).any() else 0.0
        nlev = max(1, int(math.ceil(min(hmax, 45.0) / dx)))
        chm = np.minimum(chm, nlev * dx)
        lad = lad_levels(chm, pai_crown, conifer_share, dx, nlev, block)
        cover_frac = (chm > TREE_M).reshape(ny, block, nx, block).mean(axis=(1, 3))
        tree_h = np.where(chm > TREE_M, chm, np.nan).reshape(ny, block, nx, block)
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)  # cells with no tree
            canopy_h = np.nan_to_num(np.nanpercentile(tree_h.transpose(0, 2, 1, 3).reshape(ny, nx, -1), 90, axis=2))
    else:
        height, crown = hab["height"].astype(np.float32), hab["crown"].astype(np.float32)
        nlev = max(1, int(math.ceil(min(float(height.max()), 45.0) / dx)))
        lad = lad_from_forest(np.minimum(height, nlev * dx), crown, pai_crown, conifer_share, dx, nlev)
        cover_frac = np.clip(crown / 100, 0, 1) * (height > TREE_M)
        canopy_h = np.where(height > TREE_M, height, 0.0)
    lad[:, water] = 0.0

    # roughness under the canopy
    z0 = np.full((ny, nx), Z0_DEFAULT, np.float32)
    for k, v in Z0.items():
        z0[cover == k] = v
    return dict(dtm=dtm.astype(np.float64), lad=lad, z0=z0, cover_frac=cover_frac, canopy_h=canopy_h, water=water,
                conifer_share=conifer_share, nlev=nlev, sources=sources, dx=dx)


def canopy_summary(fd: dict) -> dict:
    lai = fd["lad"][1:].sum(axis=0) * fd["dx"]
    ch = fd["canopy_h"]
    return dict(cover_mean=float(fd["cover_frac"].mean()), lai_mean=float(lai.mean()), lai_p90=float(np.percentile(lai, 90)),
                height_p90_mean=float(ch[ch > 0].mean()) if (ch > 0).any() else 0.0)


def save_grid(path: Path, fd: dict, zt: np.ndarray, origin_z: float) -> None:
    """The cell properties palm_to_fields.py needs, row 0 north (the DEM's way)."""
    np.savez_compressed(path, dem=fd["dtm"].astype(np.float32), dem_model=(zt + origin_z).astype(np.float32),
                        canopy_h=fd["canopy_h"].astype(np.float32), cover=fd["cover_frac"].astype(np.float32),
                        z0=fd["z0"], water=fd["water"], lai=(fd["lad"][1:].sum(axis=0) * fd["dx"]).astype(np.float32))


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("case", choices=sorted(CASES))
    ap.add_argument("--dx", type=float, default=10.0, help="grid spacing, m (5, 10 or 20; 2 or 4 for pickle-slot); the root's with --nest")
    ap.add_argument("--nest", default="", help="dx:size of a nested child over the core, e.g. 10:3000 (with --dx 20)")
    ap.add_argument("--npe", default="8,16", help="MPI ranks for the root and the child with --nest (their sum is palmrun's -X)")
    ap.add_argument("--leaf", type=float, default=0.5, help="share of hardwood leaves still on (0 bare .. 1 full)")
    ap.add_argument("--terrain", choices=["hrdem", "mrdem"], default="hrdem")
    ap.add_argument("--canopy", choices=["chm", "forest"], default="chm")
    ap.add_argument("--runs", default="", help="comma list of the case's runs (default all)")
    ap.add_argument("--hours", type=float, default=0.0, help="override every run's length (a quick test)")
    ap.add_argument("--tag", default="", help="suffix for the run names and case-<tag>.json (test builds)")
    ap.add_argument("--refresh", action="store_true", help="fetch the 1 m HRDEM again")
    ap.add_argument("--surface", choices=["flux", "rate", "none"], default="",
                    help="the stratified runs' ground: a fixed heat flux (the runs' default), a cooling/heating rate, or none")
    ap.add_argument("--rate", type=float, default=-1.0, help="K/h with --surface rate")
    ap.add_argument("--cthf", default="", help="canopy-top heat flux, K m/s (kinematic, whatever PALM's docs say), or 'none'")
    ap.add_argument("--gradients", default="",
                    help="the stratified runs' initial potential-temperature profile, 'level:K/100m,...' "
                         "(e.g. 0:0.7,300:0.5, HRDPS's 2-80 m at 18:24 on 2026-10-10); default the case's")
    args = ap.parse_args()
    case = CASES[args.case]
    t0 = time.time()
    g = grid_for(case, args.dx)
    dx, nx, ny = g["dx"], g["nx"], g["ny"]
    print(f"{args.case}: {nx} x {ny} cells of {dx:g} m, EPSG:{case['epsg']} "
          f"[{g['x0']:.0f}, {g['y0']:.0f}, {g['x1']:.0f}, {g['y1']:.0f}], convergence {g['gamma']:+.3f} deg")

    one = fetch_1m(args.case, case, g, args.refresh) if (args.terrain == "hrdem" or args.canopy == "chm") else None
    f = cell_fields(case, g, args, one, g)
    dtm, lad, z0 = f["dtm"], f["lad"], f["z0"]

    # ---- periodic: the outer ring to a constant
    tw = int(round(case["taper_m"] / dx))
    ring = np.ones((ny, nx), bool); ring[tw:-tw, tw:-tw] = False
    # the level the ring is blended to: the ring's median, or a case's percentile
    # (low at Pickle: the median is the high ground's, and it would raise the
    # open water upwind into a bank in front of the slot)
    edge = float(np.percentile(dtm[ring], case.get("taper_percentile", 50.0)))
    dtm_t = taper(dtm, tw, edge)
    origin_z = float(dtm_t.min())
    zt = (dtm_t - origin_z).astype(np.float32)
    relief = float(zt.max())
    vg = vertical_grid(dx, relief, case.get("vertical"))
    nlev = f["nlev"]
    # 3d output up to the highest ground + the tallest canopy + 40 m
    nz_do3d = int(math.ceil((relief + nlev * dx + 40.0) / dx)) + 1
    meta = dict(case=args.case, sources=f["sources"], taper_m=case["taper_m"], origin_z=origin_z)

    # ---- the nested child over the core
    nest = None
    if args.nest:
        cdx, csize = (float(v) for v in args.nest.split(":"))
        gc = child_grid(g, cdx, csize, case)
        clear = case["taper_m"] + 4 * dx  # PALM wants 4 root cells clear of the root's edge; keep clear of the taper too
        if min(gc["x0"] - g["x0"], g["x1"] - gc["x1"], gc["y0"] - g["y0"], g["y1"] - gc["y1"]) < clear:
            raise SystemExit(f"the child box reaches into the root's tapered ring: keep it under {case['size_m'] - 2 * clear:g} m")
        fc = cell_fields(case, gc, args, one, g)
        zt_c = (fc["dtm"] - origin_z).astype(np.float32)
        if zt_c.min() < 0:
            raise SystemExit("the child's ground dips under the root's lowest: PALM would shift every domain")
        vgc = child_vertical(cdx, vg)
        if vgc["top"] < float(zt_c.max()) + 200:
            raise SystemExit(f"the child's top ({vgc['top']} m) is under 200 m over its highest ground")
        nz_do3d_c = int(math.ceil((float(zt_c.max()) + fc["nlev"] * cdx + 40.0) / cdx)) + 1
        npe = [int(v) for v in args.npe.split(",")]
        # PALM's multigrid refuses unequal subdomains: the child's ranks as a grid that divides its cells
        grids = [(a, npe[1] // a) for a in range(1, npe[1] + 1) if npe[1] % a == 0
                 and gc["nx"] % a == 0 and gc["ny"] % (npe[1] // a) == 0]
        if not grids:
            raise SystemExit(f"{npe[1]} ranks do not split the child's {gc['nx']} x {gc['ny']} cells evenly: pick another --npe")
        pe_grid = min(grids, key=lambda g2: abs(g2[0] - g2[1]))
        nest = dict(npe=npe, pe_grid=pe_grid, llx=gc["llx"], lly=gc["lly"], grid=gc, vertical=vgc, nz_do3d=nz_do3d_c, fields=fc, zt=zt_c)
        print(f"  child: {gc['nx']} x {gc['ny']} x {vgc['nz']} cells of {cdx:g} m at ({gc['llx']:g}, {gc['lly']:g}) in the root, "
              f"top {vgc['top']} m; ranks {npe[0]} + {npe[1]} = {sum(npe)}")

    # ---- write: PALM wants the south row first
    out_case = HERE / args.case
    tag = f"_{args.tag}" if args.tag else ""
    runs = [r for r in (args.runs.split(",") if args.runs else case["runs"])]
    names, run_infos = [], {}
    for r in runs:
        run = dict(case["runs"][r])
        if run["stability"] != "neutral":
            if args.surface:
                run["surface"] = args.surface
                run["heating_rate"] = args.rate
            if args.cthf:
                run["cthf"] = None if args.cthf == "none" else float(args.cthf)
            if args.gradients:
                # the first runs held 2 K/100 m over the lowest 300 m from the start, which put the
                # whole valley layer, canopy top included, to sleep whatever the ground did (0.4 and
                # 1 K/h of cooling gave the same 1.6 km/h); HRDPS had 0.7 K/100 m at 18:24
                run["theta_gradients"] = [tuple(float(x) for x in s.split(":")) for s in args.gradients.split(",")]
        name = f"{args.case}_{r}{tag}"
        inp = out_case / "JOBS" / name / "INPUT"
        scent = scent_sources(case, g, f, run)
        run["scent"] = scent
        for old in inp.glob(f"{name}_*_N02"):
            old.unlink()  # a child left from an earlier build would be run
        write_static(inp / f"{name}_static", g, zt[::-1].copy(), lad[:, ::-1].copy(), z0[::-1].copy(), dx, case["epsg"], meta)
        hours = args.hours or run["hours"]
        (inp / f"{name}_p3d").write_text(p3d(name, args.case, run, g, vg, hours, nz_do3d, nest, scent=scent), encoding="utf-8", newline="\n")
        if nest:
            fc, gc = nest["fields"], nest["grid"]
            write_static(inp / f"{name}_static_N02", gc, nest["zt"][::-1].copy(), fc["lad"][:, ::-1].copy(),
                         fc["z0"][::-1].copy(), gc["dx"], case["epsg"], dict(meta, taper_m=0.0))
            (inp / f"{name}_p3d_N02").write_text(
                p3d(name, args.case, run, gc, nest["vertical"], hours, nest["nz_do3d"], nest, child=True),
                encoding="utf-8", newline="\n")
        names.append(name)
        run_infos[name] = run

    sfx = f"-{args.tag}" if args.tag else ""
    info = dict(
        case=args.case, tag=args.tag, built=time.strftime("%Y-%m-%d %H:%M"), epsg=case["epsg"], dx=dx, nx=nx, ny=ny,
        bounds=[g["x0"], g["y0"], g["x1"], g["y1"]], gridConvergenceDeg=g["gamma"],
        origin_lonlat=list(g["origin_lonlat"]), origin_z=origin_z, relief_m=relief, taper_m=case["taper_m"],
        core_m=case["core_m"], centre=[(g["x0"] + g["x1"]) / 2, (g["y0"] + g["y1"]) / 2], point_xy=list(g["point_xy"]),
        point_latlon=list(case["point"]), vertical=vg, nz_do3d=nz_do3d, canopy_levels=nlev, leaf=args.leaf,
        terrain=args.terrain, canopy=args.canopy, sources=f["sources"], runs=run_infos,
        canopy_summary=canopy_summary(f), trial_dem=case.get("trial_dem"), shallow=bool(case.get("vertical")),
    )
    save_grid(out_case / f"grid{sfx}.npz", f, zt, origin_z)
    if nest:
        fc, gc = nest["fields"], nest["grid"]
        info["nest"] = dict(domain="N02", dx=gc["dx"], nx=gc["nx"], ny=gc["ny"], bounds=[gc["x0"], gc["y0"], gc["x1"], gc["y1"]],
                            llx=gc["llx"], lly=gc["lly"], vertical=nest["vertical"], nz_do3d=nest["nz_do3d"], npe=nest["npe"],
                            canopy_levels=fc["nlev"], canopy_summary=canopy_summary(fc),
                            centre=[(gc["x0"] + gc["x1"]) / 2, (gc["y0"] + gc["y1"]) / 2])
        save_grid(out_case / f"grid{sfx}-N02.npz", fc, nest["zt"], origin_z)
    (out_case / f"case{sfx}.json").write_text(json.dumps(info, indent=1), encoding="utf-8")
    cs = info["canopy_summary"]
    print(f"  terrain {dtm.min():.0f}-{dtm.max():.0f} m, relief in the model {relief:.0f} m (ring tapered to {edge:.0f} m over {case['taper_m']:g} m)")
    print(f"  canopy: cover {cs['cover_mean']:.0%}, LAI mean {cs['lai_mean']:.2f} (p90 {cs['lai_p90']:.2f}), "
          f"{nlev} levels of {dx:g} m; conifer share {f['conifer_share'].mean():.0%}, leaf {args.leaf:g}")
    print(f"  vertical: {vg['nz']} levels, {dx:g} m to {vg['start']:g} m, stretched to {vg['dz'][1]:g} m by {vg['end']:g} m, top ~{vg['top']} m")
    for name, run in run_infos.items():
        sc = run.get("scent") or []
        print(f"  scent {name}: {len(sc)} sources" + (": " + "; ".join(v["name"] for v in sc) if sc else " (off)"))
    print(f"  runs: {', '.join(names)} -> {out_case / 'JOBS'} · {time.time() - t0:.0f} s")


if __name__ == "__main__":
    main()
