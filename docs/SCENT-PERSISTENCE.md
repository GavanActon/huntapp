# Scent over time: sits, walks, old tracks and rain

How long does a hunter's scent last, in the air and on the ground, and
what should the scent cone do with time? Gavan's field notes of
2026-10-19 asked three things:

- "Gord wondered about learning for dogs and scent and how tracks stick
  around."
- "Length of time - and its impact. Right now it's just 20 minutes.
  Active/sit/stuck."
- "Crazy but historical scent lines. How long will your scent stay from
  the previous day. Rain washed it out."

This doc reads what the cone does with time today
(`app/src/weather/micro/scent.ts`, `scentTune.ts`, `hunting/hunting.ts`,
`tracking/trackStore.ts`), gathers the evidence on track scent, rain,
sit length, game reactions and dogs, and makes three proposals. Nothing
here is built. PALM and the scent test set are huntapp-c5's; this doc
touches neither. Compiled 2026-10-19.

Evidence tags as in docs/HUNT-FISH-SCIENCE.md and docs/ELK-SCIENCE.md:
**[S]** peer-reviewed or agency science, **[G]** agency guidance,
standards or training manuals, **[H]** handler, hunter and guide lore
(lower weight), **[I]** inference from the evidence or this app's code,
not measured, plus **[D]** a number derived here from physics or
arithmetic. **(unverified)** marks a number seen only in a search snippet
or a secondary write-up. The worked cases come from the calculator
`trackfade.py` and `trackfade_more.py` in this session's scratchpad
(kept there, not in the repo).

## 1. Bottom line

- **The model has no 20-minute clock.** The cone is scent up to 15
  minutes old from a 10-minute release, drawn as a sit that has been going
  for some time. How long you have sat, whether you are walking, and a
  long stay at one spot do not enter it (§2).
- **In a breeze, sitting longer does not lengthen the cone.** It fills
  in a few minutes (the travel time out, x/U) and then holds steady [S].
  What grows is the chance that an animal downwind meets it, and the scent
  left on the ground. **In still air it does build up**: near the forest
  floor at dawn and dusk and in hollows and cold pools, air takes 30
  minutes to 2 hours to clear [S]. The 15-minute horizon drops that (§5).
- **Walking gives off about 2–2.5 times a sitter's scent on an easy walk
  and 3–6 times on a hard one** [S]. Sweat keeps coming for 15–30 minutes
  after you sit, longer after a climb [S] (§5).
- **No study gives a decay curve for human scent on any natural ground**
  (§3). Dogs give the anchors:
  - untrained dogs lost tracks past 2 h (1913 trials) [S, secondary];
  - search-and-rescue dogs solved 93% of 1–3 h trails [S];
  - blood-tracking tests are run at 20 h and 40 h [G];
  - veteran bloodhounds ran 24–48 h trails 96% of the time [S].

  A two-part fade fits these: strong for the first hour or two, fading
  over a day, faint for two or three days in cool, damp shade. Hot sun and
  bare or hard ground cut it to hours.
- **Rain does both** (§4):
  - **dew and light rain revive a track briefly**, for 20 minutes to an
    hour, by pushing bound scent off dry surfaces [S];
  - **heavy rain washes it out** and carries it downhill [S].

  No tracking-dog study has tested rain itself.
- **No study separates how long game reacts to scent alone** (§6). Deer
  ignore human urine [S]. Every duration below is from human presence,
  where sight, sound and scent arrive together [S]:

  | Species | After one pass | At a stand or sit |
  |---|---|---|
  | White-tailed deer | flushed deer resume within hours | a hunted stand is avoided for days, more so with each hunt |
  | Moose | raised movement for 1–3 h; they often shift about 2 km | no data |
  | Brown bear | day and night pattern changed for 1–2 days | no data |
- **Dogs teach** (§7):
  - the cone is patchy, scent there about a fifth of the time [S];
  - a steady 2–4 m/s wind gives the longest, narrowest reach [S];
  - calm air makes a pool [S];
  - a track is a corridor about 10 m wide [S];
  - carbon suits did not stop dogs finding people [S].
- **Proposals** (§8):
  - **(a) Active, Sit and Stuck** set the release, the follow time and the
    strength from what the phone already knows.
  - **(b) Old track lines** fade by hours, temperature, sun, rain, snow
    and ground, in the cone's own three bands.
  - **(c)** One plain line each.

| Part | Lands in | § |
|---|---|---|
| Active, Sit, Stuck | `scent.ts` `simulatePlume` (release points, `releaseMin`, `followMin`), the strength (NOSE) scaling, `hunting/hunting.ts` (sit timer) | 8a |
| Old track lines | a new layer beside `tracking/trackLayer.ts`, reading `trackStore` points, the going grid's `GROUND`, the habitat grid's closure, and an hourly past-weather fetch | 8b |
| Words | `ScentCard.tsx`, `LiveCard.tsx`, the track line's tap popup | 8c |

## 2. What the model does with time today (read in code 2026-10-19)

There is no 20-minute constant. The nearest things:

| What | Value | Where |
|---|---|---|
| Release: how long particles leave the sit | **10 min** (knob "Giving off scent", 1–15; its hint says "a stalk is a minute or two") | `scentTune.ts` `releaseMin`; `scent.ts` `RELEASE = T.releaseMin * 60` |
| Follow: when the run stops | **15 min** from the first release (knob "Followed for", 5–30) | `followMin`; `TOTAL = T.followMin * 60` |
| A puff's age | 5–15 min at most: a puff released at minute t0 is followed until minute 15 | the particle loop, `t0 = rnd() * RELEASE` |
| The picture | a sit "going on for hours": each cell counts the minutes from the typical age of the scent that lands there to that age plus the release | `oftenGrid` |
| The particle view and PALM's particles | 15 minutes; PALM `particle_maximum_age = 900`, "the cone's own horizon" | `TOTAL_S = 900`; SCENT-TEACHER.md |
| The one real 20 min | the live card asks for a new wind check when the last one missed and 20 min have passed | `LiveCard.tsx` |

So "20 minutes" is best read as the release and follow window together.
The cone shows scent up to 15 minutes old from a sit that has been going
on for some time. That is enough in moving air: at 1 m/s a puff reaches
the 700 m grid's edge in under 12 minutes. It is not enough in near-calm
air: at 0.2 m/s a 15-minute puff has gone 180 m, and older scent, the
part that pools, is dropped.

**How a sit, a walk or a long stay enters it:**

- **Sit length is not an input.** Every cone is the same steady sit
  however long the hunter has been there. The release knob changes only
  the window `oftenGrid` counts.
- **Walking is a sit moved.** With location on, the live cone jumps to
  the new spot after 10 m of walking (`hunting/hunting.ts` `syncCone`).
  Each new spot gets the full steady-sit cone. Nothing trails behind the
  walker, in the air or on the ground. The "stalk cone" (release as long
  as you've been there) was noted on 2026-10-09 as not built.
- **A long stay is the same as a short one.** Still air builds up
  nothing beyond 15 minutes, and the sit keeps no reservoir.
- **Scent the trees take out is lost.** Deposition removes scent from the
  air and keeps no record of where it went:
  - `vd` is 0.2–1.1 cm/s, set by closure, conifer, leaves and bush;
  - each step applies `kept *= exp(−vd·DT/max(2, 2.5σz))`.

  That loss is the hook for a ground reservoir.
- **Time does fade the checks.** A wind check's say in the cone halves in
  about 1.4 h (`SIT_TAU_MS` 2 h e-folding, cut at 4 h, `sitAir`). This is
  the wind, not the scent.

**What the phone already keeps for proposal (b):**

- **Tracks** (`tracking/trackStore.ts`) keep every walk in localStorage,
  as points with a time stamp:
  - a point is kept only once the phone has moved more than 6 m and more
    than the fix's own wander, so standing adds no points;
  - a sit shows as a long gap between two points in the same place;
  - the web app gets no fixes with the screen off, so a gap can also be a
    walk the phone did not see. Its two ends then lie far apart and the
    line between them is a guess.
- **Ground** (`routes/walkModel.ts` `GROUND`, the going grid, 10 m)
  classes upland, water, marsh, open peat (bog, fen), swamp, road and
  stream. With the habitat grid's closure and conifer share and
  `leavesDown`, that gives forest floor under conifer or hardwood, moss,
  wet sedge, gravel and water.
- **Weather** (`weather/openMeteo.ts`) has hourly precipitation,
  snowfall, snow depth, temperature, cloud and wind. It has **no past
  hours** for the point forecast and **no humidity**. Both are one request
  away: Open-Meteo's forecast API takes `past_days` 0–92 and serves
  `relative_humidity_2m`, `dew_point_2m`, `soil_moisture_0_to_1cm` and
  `sunshine_duration` hourly. Watch the archive's daily quota (memory:
  open-meteo-daily-quota).

## 3. Ground and track scent

### What a track is made of

A walked track carries three kinds of scent:

- **The person.** Skin flakes, skin oils, sweat and their bacterial
  products, pressed into the ground by each step and shed from clothes
  [S].
- **Crushed plants.** Green-leaf volatiles start within 1–2 s of
  wounding and last minutes on a living plant (Fall et al. 1999)
  (unverified), but days on cut, drying tissue: cut alfalfa kept emitting
  for 3 days, and more after a rainstorm (Warneke et al. 2002)
  (unverified).
- **Disturbed soil.** Dogs do not take direction from disturbance
  alone. When the person's odour was removed and the disturbance left,
  they failed (Hepper & Wells 2005) [S]. On a bicycle track they were at
  chance (Steen & Wilsson 1990) [S].

So direction comes from what each footfall leaves. Syrotuck's handler
account matches [H]:
- crushed plants are intense for under 30 minutes;
- human scent leads for about 2 hours;
- plant odour leads for about 16 hours more;
- after that human scent is "almost non-existent".

Skin oils also change with age. Ozone reacts with squalene on the skin
and on anything it touches, giving off new carbonyls such as 6-MHO and
4-OPA (Wisthaler & Weschler 2010) [S]. At an outdoor 37 ppb ozone that
roughly doubles a seated person's emissions (Wang et al. 2022) [S]. Old
scent is different scent, not just less of it.

### Track age: the anchors

| Track age | Result | Source | Tag |
|---|---|---|---|
| 3 min on concrete, 20 min on grass | 10/10 right direction each; the ages were chosen as handlers' practical limits, so hard ground fades roughly 5–10× sooner | Thesen, Steen & Døving 1993 | [S]; the ratio [I] |
| 1 s apart, 5 footsteps | direction read from 5 steps, not 3; footstep odour changes enough in 1–2 s to give direction | Hepper & Wells 2005 | [S] |
| under 2 h | no dog followed an older track; none on dry sand, stone or asphalt | Prussian official tests 1913–14, via Hale 2015 | [S], secondary |
| 1–3 h, open grass, 800 m | 14/15 found (93%); dogs mostly within 10 m of the trail | Jinn, Connor & Jacobs 2020 | [S] |
| 20 h and 40 h, forest, ≤0.25 L blood per 1,000 m | routine pass/fail tests; no test tracks on snow | JGHV blood-tracking rules, §10 | [G] |
| 24–48 h (the source and a citing paper disagree) | veteran bloodhounds 96%, novices 53% | Harvey & Harvey 2003 | [S], age disputed |
| days to months | courts have weighed trails 11 days to 4.5 months old; how long trails last "remains unclear" for lack of data | Woidtke et al. 2023 | [S] |
| objects, same day to 6 months | perfect same day, a drop at 2 weeks, then no further decline to 6 months | Schoon 2005 | [S] (unverified) |
| samples outdoors | winter samples matched at 3–6 months, summer samples at none; sun the main factor | Czech outdoor study, NUSL 260846 | (unverified) |

**A caution.** In a 2026 double-blind test, 70 operational
mantrailing teams chose the target's trail at chance (Volmary 2026) [S].
Handler claims about old trails often fail controlled tests. The dog
numbers are also a dog's threshold: a trained dog working the track. A
moose crossing it is not trained and is not looking for it.

### What speeds the fade and what slows it

**The ranking, best supported** [S where marked, else I]:

- **Ground, most to least lasting:**
  1. moist grass or herbs;
  2. moist soil or forest floor (litter and moss untested, inferred
     here);
  3. bare moist soil;
  4. dry sand;
  5. dry rock, gravel, concrete or asphalt [S, Thesen; 1913 trials].
- **Weather, best to worst:**
  1. cool, humid, calm and overcast [S, Jinn; Silvestri et al. 2026];
  2. dawn dew, or light rain on dry ground (a short boost) [S, Sargisson
     2012];
  3. mild and dry;
  4. windy [S, Jinn];
  5. hot, dry and sunny [S, Czech study; Hudson 2009; H, Syrotuck].

**Each factor:**

- **Temperature** cuts both ways [D]. Vapour pressure rises about 2–2.4×
  per 10 °C for compounds with ΔHvap 50–60 kJ/mol (Clausius–Clapeyron;
  2–3× for 50–80 kJ/mol), so warmth gives off more now and empties the
  track sooner. Cold keeps the deposit and gives off little; frost holds
  it until the thaw [H, Xenophon via Hale].
- **Humidity and soil water** decide how tightly scent is held [S]:
  - in dry soil, water and organic vapours compete for the same mineral
    surfaces (Petersen et al. 1995);
  - drying a surface raised sorption "several orders of magnitude" in the
    top few cm, and both drying and re-wetting gave sharp release peaks
    (J Environ Qual 25:1054, 1996);
  - moisture changed nothing until the soil dried below about one
    molecular layer of water (Spencer & Cliath 1970).

  So dry ground holds scent bound, and wetting lets it go. For dogs each
  +1% humidity tightened the search by about 0.1 m (Jinn 2020) [S].
  Greatbatch et al. 2015 found no weather effect in area search [S].
  Cablk et al. 2008 found humidity shortened detection, but temperature
  and humidity moved together there [S].
- **Sun and UV** break scent down [S]: UV changed collected human scent
  in sealed glass (Hudson, Curran & Furton 2009), and sun was the main
  factor outdoors (the Czech study, unverified). Jinn's untested idea fits
  forest: sun strips the open stretches, shade keeps the rest, so an old
  trail becomes "connect-the-dots" [I].
- **Wind** dries the ground and pushes the track's air scent sideways.
  Each +1 m/s put dogs 0.65 m farther from the trail (Jinn 2020) [S]. No
  study gives wind's own effect on how long a track lasts.
- **Snow** buries and chills a track [I]. Odour does rise through snow
  from strong sources:
  - breath under 1 m of snow was found in 26/30 trials (Diverio et al.
    2017) [S];
  - scented articles under 30 cm were found after an hour (Schouweiler et
    al. 2016) [S].

  A track's weak source has not been tested. Blood-tracking rules forbid
  test tracks on snow [G].
- **Boots and clothing.** Paper glued over boot soles stopped a dog until
  it wore through, and a hound followed a man wearing the target's old
  boots (Romanes 1887; Budgett 1933, via Hale) [S, historical]. There is
  no modern study. Rubber boots are lore [H].

## 4. Rain: does it wash a track out or bring it back?

Both, by amount [S for the parts, I for a track]:

- **Dew and light rain revive scent briefly.**
  - Overnight dew pushes odour out of the soil to the surface. Mine dogs
    did best at dawn, and detection fell as the dew dried until about
    9 a.m. The window is "probably 20 minutes to 1 hour" (Sargisson et
    al. 2012, citing Phelan & Webb) [S].
  - Re-wetting dry soil gives a pulse of VOCs about 14× for a few hours
    (Rossabi et al. 2018) [S]. That is soil background, not track signal.
  - Light and moderate rain throws far more aerosol off the ground than
    heavy rain (Joung & Buie 2015) [S]. Applying that to tracks is an
    idea.
  - Handlers say the same: dew and light humidity raise scent (FEMA US&R
    canine manual; Syrotuck) [G/H].
- **Heavy rain washes scent out and moves it.**
  - Mine-dog detection fell from logit 1.23 in dry October to 0.03 in
    June after heavy spring rains. Heavy rain carried odour along drainage
    channels and gave false alarms downstream (Sargisson et al. 2012) [S].
  - Rain was the strongest factor for scat dogs (Reed et al. 2011) [S].
  - Handlers say heavy rain suppresses scent (FEMA) [G].
- **How much rain is "heavy"?** No track study says. The closest numbers
  come from residues on leaves:
  - the EU's FOCUS models assume a wash-off of 0.5 per cm of rain
    (0.05 per mm), and EFSA proposed 1.0 per cm (via a 2017 poster)
    (unverified);
  - 20 mm in an hour took about two thirds of a fungicide off tomato
    leaves (Fraunhofer ring test, 2023) (unverified);
  - about 5 mm took over half the fine particles off leaves, and about
    10 mm took them to background (urban forestry study) (unverified).

  Skin oils behave like the residue and skin flakes like the particles.
  Hence the proposal's 0.1 per mm: 5 mm leaves about 60%, 10 mm about
  37%, 25 mm about 8% [I].
- **After rain,** drying ground pulls some residue back up as it
  evaporates (UPRM soil-column work) (unverified). A track that rain has
  thinned can come back a little on the next dry, warm day [I].

No study has run tracking dogs on tracks before and after rain.
Harvey & Harvey's bloodhound trails sometimes had rain between laying and
running, and no effect was reported [S].

## 5. Airborne scent: sit length, walking, and the long sit

### A cone fills in minutes

For a steady source in moving air, the average scent at distance x stops
growing once the release has run longer than the travel time x/U.
After that the Gaussian answer C = Q/(πσyσzU) has no time in it [S, Turner
workbook; Seinfeld & Pandis]. So in a breeze:

- a 10-minute release is steady out to about U × 10 min: 600 m at 1 m/s,
  180 m at 0.3 m/s [D];
- a longer sit does not make the cone longer or stronger. It adds
  minutes in which a meandering plume can swing over an animal [D]. The
  app already counts that: a moose standing 5 minutes in the "some
  minutes" band (15%) is more likely than not to get a whiff
  (1 − 0.85⁵). The minutes are correlated, so this overstates the gain a
  little;
- the downwind scent is strongest in the first 15–30 minutes of a sit,
  while the sweat from the walk in is still coming off (below).

C ∝ 1/U is also why dispersion models give up in calm air. AERMOD's
default floor is 0.28 m/s (EPA LOWWIND white paper) (unverified).

### Where scent builds up: still air, the floor, hollows

Scent accumulates only where the air takes longer to clear than the time
already sat:

- **Near the forest floor**, air stays about 30 minutes (the median, in
  neutral air; simulated), against seconds in the upper canopy (Gerken,
  Chamecki & Fuentes 2017) (unverified). Stable nights would be longer
  [I].
- **Under a canopy draining at 1–2 m/s**, a tracer released below the
  trees took about 30 minutes to clear 600 m downstream after the release
  stopped. The canopy's CO₂ pool flushed only at 07:00–08:00, when sun
  reached the slopes (Pypker et al. 2007) [S].
- **Basins.**
  - Meteor Crater's cold pool took about 2 h to set up (Haiden et al.
    2011) [S].
  - In the Peter Sinks (Utah), drainage flows were under 2 m deep and
    weakened once the pool formed (Clements, Whiteman & Horel) [S].
  - Valley bottoms hold CO₂ on stable nights until mid-morning (de Araújo
    et al. 2008) (unverified).
- **Hunter-scale hollows (10–100 m)** have no measured flushing time. A
  box model gives C(t) = (E/Q)(1 − e^(−t/τ)), with τ = V/Q [D]:

  | Hollow 100 m across, 5 m deep | Drainage | τ |
  |---|---|---|
  | 0.3 m/s, 2 m deep | moving | 5–10 min |
  | 0.05 m/s, 1 m deep | barely moving | 1–2 h |

  The build-up stops at about 3τ.

Handlers describe the same: in light or no wind scent pools in the lowest
spots and flows downhill "like water" (FEMA; SARBC handbook) [G/H]. That
matches the bog south of camp (SCENT-TEACHER.md, the true-spot rerun: "it
pools and leaks").

### Walking against sitting

**How much more a walker gives off:**

| Activity | Gases | × sitting | Source |
|---|---|---|---|
| Easy walk | CO₂ | 2.4× | Yang et al. 2024 [S] |
| Easy walk | ammonia (a skin gas) | 1.9× | Yang et al. 2024 [S] |
| Running | CO₂ / ammonia | 5.9× / 3.1× | Yang et al. 2024 [S] |
| Gym exercise | body VOCs | 3–5× | Finewax et al. 2021 (unverified) |
| Exercise | breath isoprene | about 11× in the first minute, about 3× after 15 min | King et al. 2009 [S] |
| Walking | coarse particles (skin flakes and dust kicked up) | 5–6× | Bhangar et al. 2016 (unverified) |

Walking also pumps air out through clothes, and wind more so (Ke, Li &
Havenith 2014) (unverified).

**How long a sitter takes to settle** [S]:
- **Breath** settles within minutes (King 2009).
- **Skin after an easy walk:** ammonia kept rising for about 15 minutes
  after stopping, then fell slowly, near baseline at about 30. CO₂ and
  skin temperature were back by 30 (Yang 2024).
- **Skin after running:** ammonia was still rising at 30 minutes (Yang
  2024).
- For a steep, loaded walk in, 30–60 minutes is inference [I].

**A walker's dose against a sitter's** [D]. A walker at speed v lays a
line of scent. The total an animal downwind gets from the walker passing
equals a sit of

T_eq = √(2π) · σy / v · (E_walk / E_sit).

At 100 m (σy 4–20 m), walking at 1.2 m/s and giving off 2–3× a sitter,
that is about 20–100 s. So a walker crossing upwind gives each animal
along the downwind front about a minute of a sitter's scent. It reaches
every one of them and leaves a track behind.

### Skin flakes and what stays behind

**Skin flakes** [S]:
- airborne skin flakes are about 20 µm across (median); 7–10% are under
  10 µm (Mackintosh et al. 1978);
- shedding during exercise differs about 1000-fold between people
  (Mackintosh et al. 1978);
- skin sheds about 0.03–0.09 g of flakes an hour (Weschler et al. 2011)
  (unverified).

**Syrotuck's "40,000 rafts a minute"** is lore [H]. Bhangar's counts give
about 5,000 a minute from a sitter's body and 75–90,000 a minute walking
(floor dust included) [D]. So 40,000 is the right size for a walker, not
for a sitter.

**Settling** [D, Stokes]:
- 10 µm flakes fall 0.3 cm/s, 20 µm flakes 1.2 cm/s;
- falling 1.5 m takes 2–8 minutes in still air;
- near-ground gusts (0.1–0.5 m/s) dwarf that in moving air, where flakes
  drift like gas;
- under a canopy in calm air they settle within metres to tens of metres.

Flakes mostly feed what is left at the site, not the long cone.

**Scent left at a place after the person leaves:**

- **Fallout without touch** [S]. Seven men held a hand 5 cm above
  cotton for 3 minutes without touching it. Two police dogs then matched
  all seven every time (Vyplelová et al. 2014). The delay before the dogs
  worked is not in the abstract.
- **Leaves as a sink** [S]. Leaves take up oxidised VOCs faster than
  models assume and break them down (Karl et al. 2010). Water-soluble
  oxidised compounds deposit to forest quickly (Nguyen et al. 2015). The
  cone's 0.2–1 cm/s fits those compounds by day; it is near zero for
  isoprene and acetone [I].
- **Touched surfaces** become weak sources (a seat, bark, a limb) [I].
  Ozone working on skin oil fades them over hours to days. No outdoor
  emission rate has been measured.

**How long the air at a vacated sit stays scented** [S, D]:
- minutes in moving air;
- about 30 minutes near the floor or under a draining canopy;
- until the morning flush in a pooled hollow.

**On the ground** it lasts longer, by the same fade as a track with a
bigger start (§8b).

## 6. How long game reacts to old human scent

**No peer-reviewed study measures how long deer, moose, elk or bears react
to a human scent trail on the ground, or to a stand after the hunter has
left, with scent separated from sight and sound.** Hunter-press claims of
"days to weeks" for ground scent trace back to no study, and the "7–10
days" figure comes from patents (unverified).

### Scent on its own

- **White-tailed deer did not avoid human urine** (Swihart et al. 1991)
  [S]. Bobcat and coyote urine cut browsing; human and rabbit urine did
  not.
- **Human hair gave weak, partial deterrence** in orchards over a winter
  (Conover & Kania 1987) [S]:
  - browsed buds fell to 0.5 a tree against 1.1 on controls;
  - 61% of trees were browsed against 83–89% on controls.

  The hair was a fresh, continuous source, so this says nothing about
  decay.
- **The repellent review** found fear odours (predator urine, meat
  protein) worked best (Wagner & Nolte 2001) [S]. Human odour was not
  rated.
- **A human-linked smell cut red deer feeding only where people are
  rare** (van Ginkel, Smit & Kuijper 2019) [S]. Soap in a dispenser for
  7 days at Białowieża cut foraging from 45% to 22% of the time. It did
  nothing in a park with 2 M visitors a year. Remote northern Ontario is
  the first case.
- **Moose learn their scent fears** (Berger, Swenson & Persson 2001) [S].
  Moose where predators were gone were about 6× less likely to respond to
  wolf and grizzly scent. Cows that lost calves to wolves became
  hypersensitive within one generation.

### Human presence (sight, sound and scent together)

**White-tailed deer** [S]:
- **One pass, hours.** Bucks fled 9 times in 23 approaches within 100 m
  of a hunter, about 257 m on average (max 550 m). They "resume[d]
  activities in the same location later", with no shift in home range
  (Karns et al. 2012).
- **Snowmobile trails, hours.** Deer came back beside them within hours
  of the traffic stopping (Dorrance, Savage & Huff 1975).
- **A hunted stand, days, worse each time.** The best "after the hunter
  leaves" data (Sullivan et al. 2018; read in the thesis):
  - 38 GPS-collared does, against hours since each stand was hunted;
  - at midday, when stands are usually empty, use of the stand's view
    zone rose with each day since the hunt, by roughly 1.1× a day (the
    thesis prints an odds ratio of 1.010 beside a CI of 1.045–1.149);
  - after a stand's fourth hunt, use was lowest the night after and rose
    daily, so deer escalate with repeated use;
  - aversion was still recovering at about 7 days [I].
- **Hunter press (lower weight).** Daytime movement was down 22–34% over
  a hunted weekend and back to normal 2–3 days later (Wiskirchen &
  Ditchkoff, preliminary, in *Deer & Deer Hunting* 2016) [H].
- **Season-long effects are small** [S]:
  - deer sat 420 m from roads in season against 367 m outside it, and
    moved more by night (Kilgo, Labisky & Fritzen 1998);
  - high hunter density cut movement over 36 days (Little et al. 2016);
  - deer kept their ranges (Marantz et al. 2016).

**Moose** [S, partly unverified]:
- **Skiers:** moose reacted at about 160 m and sped up for about an hour.
  They moved farther for about 3 h, and their daily range centres shifted
  about 2 km (Neumann, Ericsson & Dettki 2010) (the numbers unverified).
- **Hikers and snowmobiles:** movement stayed raised about 1 h after
  hiking and 2 h after snowmobiling (Neumann et al. 2011).
- **Dog hunting, approached from upwind** [S]: flight at a median 142 m;
  activity was back to baseline in a median 54 minutes, body temperature
  in 62; they travelled 4.1 km more that day and rested about 94 minutes
  longer the next (Græsli et al. 2020).
- No data on when moose come back to the spot.

**Elk** [S]:
- During 5 days of trail use they stayed 239–310 m from trails (Wisdom et
  al. 2018).
- They shifted back toward trails within 9 quiet days (Wisdom et al.
  2018). The exact lag is not given.
- Above 2 people an hour, elk avoided 50–400 m from trails (Rogala et al.
  2011).

**Bears** [S]:
- **Brown bears, approached from upwind** so they got the walkers' scent
  (Moen et al. 2012):
  - lying bears fled at a mean 69 m, active ones at 115 m;
  - they moved about 1.2 km.
- **The same project:** bears moved more by night and less by day
  afterward, "most visible in days 1 and 2" (Ordiz et al. 2013).
- **Grizzlies** avoided trails with motor use (Ladle et al. 2018).
- **Black and grizzly bears:** no delayed avoidance after hikers passed
  (Dimitriou et al. 2026, a preprint).

**Camera traps and reviews** [S]:
- **Recently used trails:** all 13 species avoided them, most for bikes
  and motors (Naidoo & Burton 2020).
- **Trails where dogs were allowed:** mule deer used the ground within
  100 m less, even when no dog was there (Lenth, Knight & Brennan 2008).
  That is the nearest thing to a lingering-scent result, but pellet counts
  cannot separate scent from presence.
- **Ungulate flight review:** hunted populations flee farther; people on
  foot provoke more flight than vehicles (Stankowich 2008).

### Best estimate for the app

| Species | One pass on a trail | A stand or sit after the hunter leaves, or repeated use | Confidence |
|---|---|---|---|
| White-tailed deer | hours: flushed deer resume the same day | days: at least 2–3, still recovering at 7; worse with each hunt | moderate for presence; **none for scent alone** |
| Moose | about 1–3 h of raised movement; often leave, about 2 km | no data | low–moderate; none for scent |
| Elk | hours to days | as long as the pressure lasts | moderate for presence; none for scent |
| Brown bear | 1–2 days of changed day and night pattern after one upwind encounter | no data | moderate |
| Black bear | about no delayed avoidance on trails | no data | low |

The app should treat **a one-off track as a short cue (hours)**, larger
in remote or hunted country (Stankowich; van Ginkel). It should treat **a
sit used again and again as a multi-day effect** that grows with each use
(Sullivan). Both are presence-derived [I].

## 7. What dogs teach

### The cone as handlers describe it [G/H]

- **A funnel downwind** (ASB Technical Report 025, the US forensic dog
  terms) [G]:
  - it widens with distance;
  - moving the source starts a new cone;
  - a "scent pool" is concentrated odour;
  - the "chimney effect" lifts scent so it is found away from the source.
- **Wind changes the cone** (US Army FM 7-40, Scout Dog, 1973):
  - strong wind narrows it, moderate steady wind widens it;
  - a light breeze makes scent "drift weakly";
  - gusty wind gives "ever changing scent patterns".
- **Ground and range** (FM 7-40):
  - on flat ground alerts at 300–400 m are common, up to 1,000 m;
  - in dense jungle 15–30 m is good;
  - a raised source's cone "may reach the ground some distance from the
    target, or even not at all", which bears on stands
    (MICRO-WIND-LIDAR.md, scent altitude).
- **Terrain and time of day** (SARBC handbook, compiled from Syrotuck and
  others):
  - scent holds at one height by night;
  - it comes down into valleys about 30 minutes after sunrise;
  - it loops by midday;
  - it lofts at sundown;
  - eddies form at meadow edges, and a lone tree "can act like a
    chimney".
- **Dogs alert where the scent comes out, not at the source** (FEMA US&R
  manual).

### Measured [S]

- **Patchy.** In the open, odour was present only about 20% of the time
  out to 20 m (10 m in forest), and gaps under trees were at least 3×
  longer (Murlis, Willis & Cardé 2000). Plumes are filaments of high and
  low concentration; dogs cast wide far out and localise near the source
  (Mejia et al. 2024). The app's "how often" bands already draw this.
- **Steady wind helps, swirl hurts:**
  - variable wind direction slowed dogs finding hidden people (Shivik
    2002);
  - steady one-way wind at dog height was "ideal", and calm to gusty
    swirl was not (Hoffmann et al. 2022);
  - foxes, skunks and raccoons foraged most at 2–4 m/s, and kept to the
    windward side of a dike in turbulent wind, since the lee breaks plumes
    up (Ruzicka & Conover 2011);
  - scavengers found food faster when cooler, calmer and more humid
    (Ruzicka & Conover 2012).
- **Ranges for small sources are short:**
  - tortoises: median 11 m, max 63 m (Cablk et al. 2008);
  - dead rats: about 0 beyond 20 m, effective sweep 16.8 m (Glen et al.
    2018);
  - scats: 75% within 10 m (Reed et al. 2011);
  - ants: 33% at 20 m (Hoffmann et al. 2022).

  A whole person on open ground carries hundreds of metres (FM 7-40). This
  supports keeping 500 m cones to open ground (memory: scent edge
  pile-up).
- **Calm makes a pool.** Without wind, scent spread as concentric rings,
  where wind gave a cone densest on its mid-line (Cablk 2008).
- **Carbon suits did not stop dogs** (Shivik 2002): 42 trials, "little
  effect". The app should not shrink cones for scent-control clothing.
- **A track is a corridor, and its air scent sits low** (Jinn 2020):
  - dogs stayed mostly within 10 m of a 1–3 h trail;
  - at 10–20 m they sampled the air fast, head up;
  - at 20–40 m they slowed and sniffed the ground more;
  - beyond about 40 m they lost it and looped.

  Weather during the search mattered; weather since the trail was laid did
  not. Syrotuck has trailing dogs sniffing leaves 2–3 ft up as far as
  30 yd from the steps [H].
- **How a nose samples:**
  - each nostril takes its own sample (Craven, Paterson & Settles 2010);
  - a dog sniffs about 5 times a second; its exhaled jets pull in air
    from tens of centimetres ahead, where inhaling alone reaches only
    1–2 cm (Staymates et al. 2016);
  - a pointing dog running head-high into the wind kept air flowing in
    for up to 40 s (Steen et al. 1996).

### Lessons the app can borrow

1. **A whiff is a chance, not a wall.** Keep the bands. High confidence.
2. **Steady moderate wind reaches farthest and narrowest; swirl makes a
   shorter, broader, flickering cone.** Medium-high. The cone already
   does this through the spread.
3. **Calm makes a pool that drains downhill.** Medium. That is the Stuck
   case (§8a).
4. **A track is a 10 m corridor that fades over hours to days, with a
   fresher end.** Medium for the corridor; low for the hours.
   Hepper & Wells say the fresher end is readable over seconds. Draw each
   piece by its own age, so the line brightens toward where you went.
5. **Hot, dry sun shortens everything; cool, damp and still keeps it.**
   Medium-low for the airborne cone (the effect was metres in Jinn, and
   Cablk found the opposite). Medium for tracks.
6. **Don't promise scent control.** Medium (Shivik).

## 8. Proposals

### (a) Active, Sit, Stuck: what each means in minutes and in the model

The phone already knows which one you are in. With location on, the time
since the last 10 m move is the sit's length. With the screen off there
are no fixes. A look that finds you within 15 m of the last fix counts
the whole gap as sat [I]. Never assume the screen is on. A choice on the
Scent tuning sheet overrides it.

| Mode | When | Release | Followed | Strength | Ground |
|---|---|---|---|---|---|
| **Active** (walking, stalking) | moved 10 m or more in the last 2 min | from the last 10 min of track points, each for its time there | 15 min (today) | ×2.5 on an easy walk, ×4 climbing or fast | the track line starts (b) |
| **Sit** | still for 0–45 min | 10 min (today) | 15 min (today) | ×(1 + 1.5·e^(−t/20 min)) from arrival; τ 40 min after a climb | the sit pool grows (b) |
| **Stuck** (a long stay) | still 45 min or more | the sit's length, up to 60 min | 15 min in moving air; the sit's length up to 60 min where the head wind is under 0.5 m/s or the air is stable | ×1 | the pool grows to its cap (b) |

**Active.** A moving source [S for the physics, I for the build]:

- Release particles along the last 10 minutes of track. Give each point
  the time stamps it held, instead of one spot.
- The cone then trails downwind of the path as a smear, short at the
  head because each spot had only seconds.
- The multiplier works through what is already there. The card's strength
  scales NOSE, and giving off m times the scent equals NOSE ÷ m.
- Evidence: Yang 2024, King 2009, Finewax 2021; the dose arithmetic is
  [D].
- Confidence medium for the shape and medium for ×2.5. The ×4 for a
  climb is low.
- Cost: the same 720 particles, spread over the path.

**Sit.** Keep today's cone: in moving air it is right after a few
minutes [S]. Add the warm-up, a stronger cone for the first 20–30 minutes
after the walk in, fading to the sit's own:

- From Yang 2024 [S]: the skin's ammonia peaked about 15 minutes after an
  easy walk and was near baseline by 30. After running it was still
  rising at 30.
- The e-folding of 20 minutes, and 40 after a climb, is fitted to that
  [I].
- The first 1.5 (×2.5 at arrival) is the walk's ratio.
- Confidence: medium that it happens, low on the numbers.

**Stuck.** A long stay is a sit in moving air: the cone is already full,
and only the chances grow. Where the air is still or stable, the
residence times in §5 (about 30 minutes on the floor, up to 2 hours in a
hollow) are longer than the 15-minute horizon. Let the scent age as long
as the sit, up to an hour:

- `followMin` = min(sit, 60) and `releaseMin` = min(sit, 60), only where
  the head wind is under 0.5 m/s or the air is stable;
- `oftenGrid` already counts minutes from the scent's age, so pooled
  scent then shows as a growing ring that leaks downhill.

What it rests on:
- **Evidence:** Gerken 2017, Pypker 2007, Haiden 2011, the box model
  [D], and the bog south of camp. Confidence: medium that it builds, low
  on how much.
- **Cost:** up to 4× the particle steps, in still air only. The puffs
  move slowly there, and the grid is 700 m, so most can stop early when
  they leave it.
- **A test for huntapp-c5, not booked here:** a stable PALM case with
  `particle_maximum_age` 3600 against 900 says whether the ring is real.

### (b) Old track lines: yesterday's scent as fading ground scent

**What is drawn.**
- Each 10 m piece of a track from the last 3 days, a 10 m-wide line
  shaded in the cone's own three bands:
  - fresh (most): 0.5 or more;
  - fading (some): 0.15 or more;
  - faint (now and then): 0.03 or more;
  - gone below that, and not drawn.
- Water and stream cells break the line.
- The joins across gaps the phone did not see are drawn dashed and
  fainter: a guess at the route.

**The fade, per piece, hour by hour.** Two stocks share the deposit D:
fast F = 0.7·D (fresh skin volatiles and crushed plants) and slow
S = 0.3·D (flakes, oils and their breakdown).

```
k_h  = Q10^((T_h − 10)/10) · c_ground · (1 + 1.0·sun_h) · (1 + 1.0·wet_h)
F   ← F · exp(−k_h / 1.5 h) · exp(−0.1 · rain_mm_h)
S   ← S · exp(−k_h / 24 h)  · exp(−0.1 · rain_mm_h)
wet_h = 1 in an hour of dew (RH ≥ 95%, or within 1 °C of the dew point
        on a calm night) or of light rain (0–1 mm); else wet_{h−1}·e^(−1)
level = (F + S) · (1 + wet_h) · exp(−new_snow_cm / 3)
```

| Number | Value | Where it comes from | Evidence or guess |
|---|---|---|---|
| Two stocks, 0.7 / 0.3 | fresh part about 2 h, then a weaker part for most of a day | Syrotuck's sequence; untrained dogs to 2 h; trained to 20–48 h | **guess**, shaped by [H] and fitted to [S] |
| Fast e-folding | 1.5 h at 10 °C | the 2-hour anchors (1913 trials; Jinn 1–3 h) | guess fitted to evidence |
| Slow e-folding | 24 h at 10 °C | blood-tracking tests at 20 and 40 h; bloodhounds at 24–48 h | guess fitted to evidence |
| Q10 | 2.2 per 10 °C | Clausius–Clapeyron, ΔHvap 50–60 kJ/mol | **evidence** [D] |
| Sun | full sun on open ground doubles the loss; sun_h = shortwave/800 W/m² × (1 − closure) | UV and sun break scent down (Hudson 2009; the Czech study) | **guess** on the size |
| Wash-off | 0.1 per mm | FOCUS 0.05/mm, EFSA 0.1/mm for leaf residues; leaf particles faster | evidence borrowed from leaves, **not tracks** |
| Wet boost | ×2, e-folding 1 h | dew window 20 min–1 h (Sargisson 2012); sorption (Petersen 1995) | the time is evidence; **the ×2 is a guess** |
| Ground | ×3 the loss on road, gravel, rock and bare sand; ×1 forest floor, moss, bog, marsh; water breaks the line | concrete 5–10× faster than grass (Thesen ages; 1913 trials) | the order is evidence; **×3 and ×1 are guesses** (litter and moss untested) |
| Snow | e-folding 3 cm of new snow | odour rises through snow from strong sources | **guess** |
| A walked pass | D = 1; passes add | — | definition |
| A stop | D = 1 + minutes/5, capped at 10 | flake counts give 1 + minutes/2 (Bhangar, via [D]); halved and capped until field-checked | **guess** |
| Bands | 0.5 / 0.15 / 0.03 | the cone's STRONG / NOTICE / TRACE | design choice |

The bands mean "as strong as a fresh walked track", not "a moose will
react". Wind is left out of the loss: no study gives its own effect, and
its drying is mostly the sun's.

**Worked cases** (`trackfade.py` and `trackfade_more.py`; hours after
the track was walked):

| Case | Fresh until | Fading until | Faint until |
|---|---|---|---|
| Cool, overcast forest, 8 °C | about 2 h | about 20 h | about 65 h |
| A mild fall day and night in forest (12 °C by day, 2 °C by night, a little sun through the canopy) | about 1 h | about 13 h | about 55 h |
| An open bog in sun (16 °C by day, 4 °C by night) | under 1 h | about 7 h | about 31 h |
| A gravel road, 8 °C overcast | under 1 h | about 7 h | about 22 h |
| Frozen, −8 °C | about 8 h | about 69 h | past 4 days |

**The mild fall day hour by hour:** 0.56 at 1 h, 0.37 at 2 h, 0.25 at
4 h, 0.19 at 8 h, 0.15 at 12 h, 0.12 at 24 h, 0.06 at 36 h, 0.04 at 48 h.

**Rain over 4 h, starting 6 h after the walk, at 8 °C** (dry, the same
track reads 0.20 at 12 h):

| Rain | Level at 12 h | Band | At 24 h |
|---|---|---|---|
| 3 mm | 0.14 | faint | 0.08 |
| 6 mm | 0.11 | faint | 0.07 |
| 12 mm | 0.06 | faint | 0.04 |
| 25 mm | 0.016 | gone | 0.010 |
| 40 mm | 0.004 | gone | 0.002 |

So 5 mm or more drops a band and 20–25 mm washes it out.

**Dew at dawn** (13–16 h after a 4 pm walk) lifts the track from 0.21 to
0.39 for 1–3 h. It then falls back slightly below the dry curve (0.14
against 0.16 at 25 h), because the boost spends the stock faster.

**New snow at −2 °C:** 2 cm leaves it fading (0.22), 5 cm faint (0.08),
10 cm gone (0.015).

**Sit spots** (the mild fall day):
- a 15-minute stop (D 4) stays fresh about 21 h, fading to 52 h and faint
  to 92 h;
- an hour or more (D 10, the cap) stays fresh about 44 h, fading to 75 h
  and faint to 114 h.

That lines up with deer avoiding a hunted stand for days (Sullivan),
but the size of the sit pool is the softest number in the doc.

**How to build it, cheaply:**
- Inputs:
  - hourly `precipitation`, `temperature_2m`, `relative_humidity_2m`,
    `dew_point_2m`, `shortwave_radiation` and `snowfall` for the area's
    point with `past_days=3`, asked once an hour;
  - the going grid's `GROUND` and the habitat grid's closure at each piece.
- Work: one pass per piece per hour since it was laid, a few thousand
  multiplies a day of tracks.
- Party members' tracks, once shared, would go through the same pass.
- **Later step:** feed the line back into the cone as a weak line
  source, its level times a share, so an old track's air scent drifts the
  10–30 m dogs find it at.

**Confidence:** medium that the shape is right (fast, then slow, faster
in sun and warmth, washed by heavy rain, briefly lifted by dew). Low on
every hour count.

### (c) What the hunter is told

These words follow Gavan's rules: short, plain, about the scent, never
about the forecast being wrong. There are no colon-led lines and no
"X, not Y". The default view gets one word or none; the reasons sit a tap
deeper (progressive disclosure).

**On the scent card or live card, one line, only when it changes
something:**
- Active: "Your scent trails behind you"
- Sit, first 20–30 min: "Settling in"
- Stuck, still air: "Still air keeps your scent close"
- Stuck in a breeze: no line (the cone is already full)

**On an old track line, tap:**
- "Your track from 6:40 am · fresh"
- "Yesterday's track · fading"
- "Faint now"
- "Rain washed it out" (Gavan's own words), when rain took it down two
  bands or to gone
- "Snow covered it"
- "Dew freshened it" (while the boost lasts)

**One tap deeper:** the hours, the rain since in millimetres, the ground
type and the two numbers (fresh part, lasting part).

Never say an animal will smell it or will spook. The evidence does not
reach that far (§6).

## 9. What is weakest, open questions and unverified numbers

- **Game reaction to scent alone is unmeasured.**
  - Every duration in §6 is from presence (sight, sound and scent
    together).
  - Deer ignored human urine, human hair was weak, and soap mattered only
    where people are rare.
  - The bands therefore describe the scent, not the animal.
- **There is no decay curve for human scent on any natural ground.**
  - Leaf litter, moss and bog are untested.
  - The 1.5 h and 24 h e-foldings are fitted to dogs, which are trained,
    searching and far more sensitive than a moose passing by.
  - The trials disagree with each other (Harvey's 24 against 48 h), and
    operational mantrailing failed a double-blind test (Volmary 2026).
- **Rain has not been tested on tracking dogs.**
  - The 0.1 per mm wash-off is borrowed from pesticide residues and
    particles on leaves.
  - The dew boost's size is a guess; its time window comes from mine dogs
    in Afghanistan.
- **The sit pool's size** (1 + minutes/5, capped at 10) rests on indoor
  flake counts (unverified) and a cut-down. It decides whether a sit spot
  reads for one day or five.
- **Pooling in hunter-scale hollows** is unmeasured. The 30-minute and
  2-hour residence times come from a forest floor simulation, a Douglas-fir
  watershed and a crater. A stable PALM case with long-lived particles
  would answer it (huntapp-c5's call).
- **The walk-in multipliers** come from indoor chambers at 24 °C in a
  T-shirt. Fall clothing and cold cut sweat. A loaded climb is
  inference.
- **Track gaps:** with the screen off the phone sees nothing, so a gap is
  a sit or an unseen walk. Only the gap's two ends tell which.
- **Unverified or secondary:**
  - Gerken 2017's 30 min;
  - Finewax 2021's 3–5×;
  - Bhangar 2016's particle counts;
  - the FOCUS/EFSA wash-off numbers;
  - the Fraunhofer and leaf-particle wash-off numbers;
  - the Czech outdoor samples;
  - Schoon 2005;
  - Neumann 2010's moose numbers;
  - the 1913 trials (via Hale);
  - Wiskirchen & Ditchkoff (hunter press);
  - the "7–10 days" patent claim;
  - Syrotuck (via the SARBC compilation).
- **Not read:**
  - Wells & Hepper 2003's trail ages;
  - Syrotuck 1972's original;
  - Conover 2007's book text;
  - Noble 1975;
  - Schoon & Moore 2023's chapter "Human Scent Dynamics" (Springer,
    *Olfactory Research in Dogs*), likely the best single review.
- **Sullivan 2018:** the per-day effect's printed odds ratio (1.010)
  contradicts its own CI. About 1.1 a day is the reading here; check the
  journal version.

## Key sources

**Tracks, ground and rain**
- Thesen, Steen & Døving 1993, *J Exp Biol* 180:247
- Steen & Wilsson 1990, *Acta Physiol Scand* 139:531
- Hepper & Wells 2005, *Chem Senses* 30:291
- [Jinn, Connor & Jacobs 2020](https://jacobs.berkeley.edu/wp-content/uploads/2022/11/Jinn-2020-ChemSenses.pdf), *Chem Senses* 45:625; [Jinn 2019 dissertation](https://escholarship.org/uc/item/60z2c1bp)
- Harvey & Harvey 2003, *J Forensic Sci* 48:811; [UW summary](https://faculty.washington.edu/chudler/bhound.html)
- Schoon 2005, *Forensic Sci Int* 147:43
- Hudson, Curran & Furton 2009, *J Forensic Sci* 54:1270
- Volmary 2026, *Forensic Sci Int: Synergy* 12:100682
- [Woidtke et al. 2023](https://pmc.ncbi.nlm.nih.gov/articles/PMC10570582/)
- [Czech outdoor scent ageing (NUSL 260846)](https://invenio.nusl.cz/record/260846)
- JGHV blood-tracking test rules (VSwPO/VFsPO), §10
- Silvestri et al. 2026, *Animals* 16:664
- [Petersen et al. 1995](https://agris.fao.org/search/en/records/65dee22763b8185d9ca9eb8f), *J Environ Qual* 24:752
- Spencer & Cliath 1970; *J Environ Qual* 25:1054 (1996)
- Sargisson, McLean, Brown & Bach 2012, *J ERW & Mine Action* 16(2):74
- Reed, Bidlack, Hurt & Getz 2011, *J Wildl Manage* 75:243
- Rossabi et al. 2018, *JGR Biogeosci* 123:1988
- Joung & Buie 2015, *Nat Commun* 6:6083
- Fall et al. 1999, *JGR* 104; Warneke et al. 2002, *JGR* 107
- [Wisthaler & Weschler 2010](https://pmc.ncbi.nlm.nih.gov/articles/PMC2872416), *PNAS* 107:6568
- Diverio et al. 2017; Schouweiler, Latsuo & Brusseau, ISSW 2016
- FOCUS surface water foliar wash-off default; [leaf particle wash-off](https://urbanforestrysouth.org/resources/nucfac/determining-the-fate-of-pm-2-5-particles-following-capture-by-leaves-05-dg-11233225-228/at_download/file)
- Schoon & Moore 2023, "Human Scent Dynamics", *Olfactory Research in Dogs* (Springer), not read

**Airborne scent and sit length**
- Yang et al. 2024, *ES&T* 58:1986
- King et al. 2009, *J Breath Res* 3:027006
- Finewax et al. 2021, *Indoor Air* 31:1323
- Wang et al. 2022, *ES&T*, doi 10.1021/acs.est.1c08764
- Bhangar et al. 2016, *Indoor Air*
- Mackintosh, Lidwell, Towers & Marples 1978, *J Hyg* 81:471
- Gerken, Chamecki & Fuentes 2017, *Boundary-Layer Meteorol*
- [Pypker et al. 2007](https://andrewsforest.oregonstate.edu/sites/default/files/lter/pubs/pdf/pub4223.pdf), *Agric For Meteorol* 145:149
- Haiden et al. 2011, *JAMC* 50
- Clements, Whiteman & Horel, Peter Sinks
- Vyplelová et al. 2014, *Forensic Sci Int* 234:13
- Karl et al. 2010, *Science* 330:816; Nguyen et al. 2015, *PNAS* 112:E392
- EPA AERMOD LOWWIND white paper

**Game**
- Swihart et al. 1991, *J Chem Ecol*, doi 10.1007/BF00994199
- [Conover & Kania 1987](https://digitalcommons.usu.edu/wdmconference/1987/all1987/11)
- Wagner & Nolte 2001, *Wildl Soc Bull* 29:322
- van Ginkel, Smit & Kuijper 2019, *PLoS ONE*, doi 10.1371/journal.pone.0223248
- Sullivan et al. 2018, *Wildlife Biology*, doi 10.2981/wlb.00455; [thesis](https://dnr.sc.gov/wildlife/deer/pdf/Sullivan_thesis.pdf)
- Karns et al. 2012, *Proc SEAFWA* 66:120
- Dorrance, Savage & Huff 1975, *J Wildl Manage* 39:563
- Kilgo, Labisky & Fritzen 1998, *Conserv Biol* 12:1359
- Little et al. 2016, *Basic Appl Ecol* 17:360
- Marantz et al. 2016, *Can J Zool* 94:853
- Neumann, Ericsson & Dettki 2010, *Eur J Wildl Res* 56:513
- Neumann et al. 2011, *Alces* 47:17
- Græsli et al. 2020, *Conserv Physiol* 8:coaa122
- Berger, Swenson & Persson 2001, *Science* 291:1036
- Wisdom et al. 2018, *For Ecol Manage* 411:223
- Naylor, Wisdom & Anthony 2009, *J Wildl Manage* 73:328
- Rogala et al. 2011, *Ecol Soc* 16(3):16
- Moen et al. 2012, *PLoS ONE* 7:e31699
- Ordiz et al. 2013, *J Appl Ecol*, doi 10.1111/1365-2664.12088
- Ladle et al. 2018, *J Appl Ecol*
- Naidoo & Burton 2020, *Conserv Sci Pract*, doi 10.1111/csp2.271
- Lenth, Knight & Brennan 2008, *Nat Areas J* 28:218
- Miller, Knight & Miller 2001, *Wildl Soc Bull* 29:124
- Stankowich 2008, *Biol Conserv* 141:2159
- Kays et al. 2017, *J Appl Ecol* 54:242
- Dimitriou et al. 2026, bioRxiv (preprint)

**Dogs**
- [ASB Technical Report 025 (2017)](https://www.aafs.org/sites/default/files/media/documents/025_TR_e1_2017.pdf)
- [US Army FM 7-40, Scout Dog (1973)](https://archive.org/details/FM7-40_201212)
- [FEMA US&R canine manual, Unit 5](https://www.ipwda.org/files/8e4n/SM_Unit_5_Scent)
- [SARBC Search Dog Handbook (Doyle 1992)](https://www.sarbc.org/sarbc/pdfs/sardog.pdf)
- [Cablk et al. 2008](https://pmc.ncbi.nlm.nih.gov/articles/PMC3673414/), *Sensors* 8:2208
- Shivik 2002, *Wildl Soc Bull* 30:721
- Glen et al. 2018, *Wildl Res* 45:500
- Hoffmann et al. 2022, *Ecol Evol*, doi 10.1002/ece3.8987
- Hofmann et al. 2025, *J Wildl Manage*, doi 10.1002/jwmg.70021
- Greatbatch, Gosling & Allen 2015, *Wilderness Environ Med* 26:327
- [Ruzicka & Conover 2011](https://canadianfieldnaturalist.ca/index.php/cfn/article/view/1196), *Can Field-Nat* 125:132
- Ruzicka & Conover 2012, *Ethology* 118:187
- Craven, Paterson & Settles 2010, *J R Soc Interface* 7:933
- Staymates et al. 2016, *Sci Rep* 6:36876
- Steen et al. 1996, *Acta Physiol Scand* 157:115
- Murlis, Willis & Cardé 2000, *Physiol Entomol* 25:211
- Vickers 2000, *Biol Bull* 198:203
- Mejia et al. 2024, *Sci Rep*, doi 10.1038/s41598-024-55323-y
