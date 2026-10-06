# Hunting and fishing spot science

The research behind the Spots tab: what the literature and experienced
guides say predicts where moose, grouse, bear and walleye are on a given
day, turned into the numeric rules in `app/src/spots/huntRules.ts` and
`app/src/spots/fishRules.ts`. Compiled 2026-09-25 for the camp on Pickle
Lake (WMU 21B, FMZ 7, Boreal Shield). Evidence tags: **[S]** peer-reviewed
or agency science, **[G]** agency or extension guidance, **[H]** hunting and
angling press consensus (used at lower weight).

## Hunting

### Moose (primary target, Ontario rut late Sept to mid Oct)

**Browse and disturbance age.** MNRF's moose habitat guide calls burns and
cutovers **5–20 years old** plus open mixedwood (<60 % crown closure) the
prime fall foraging habitat [G] (ontario.ca guide-moosehabitat.pdf; MNRF
"factors that affect moose survival" gives 5–30 yr mixed with mature
forest). BC and Alberta reviews put use at a peak **10–25 yr** after
disturbance, then declining to 90 yr [S]. Moose largely avoid cuts under 5
yr until lateral cover regrows. Score curve used: 0–4 yr 0.2; 5–9 yr 0.7;
10–20 yr 1.0; 21–30 yr 0.6; 31–60 yr 0.3; mature 0.4 (cover value).
Aspen, birch, willow, mountain maple, red-osier, hazel and alder-rich
stands score high for browse; pure conifer low for browse, high for cover.

**Edge.** In a northern Ontario clearcut study **95 % of browsing was
within 80 m of cover**, extending to about 260 m in a second year [S]
(Hamilton et al. 1980, Can. J. Zool. 58). The 1988 MNRF guidelines were
built on it: residual cover so animals are never more than 200–400 m from
it [G]. Rule: browse cells score 1.0 within 80 m of a conifer edge, 0.6 at
80–200 m, 0.3 at 200–400 m, 0.1 beyond. The cover side within 100 m of a
browse edge scores the same way. Cover (MNRF): conifer or conifer-dominated
mixedwood, ≥6 m tall, ≥60 % crown closure.

**Water.** Aquatic feeding is a sodium strategy that peaks June–July and
largely ends by fall; lick use peaks May–June [S] (Fraser et al. 1982,
1984; Fraser & Hristienko 1981). In fall treat licks as low weight and
aquatic beds as travel and cow-concentration features. Cows and calves
concentrate near lakes, beaver ponds and marsh margins and rutting bulls
come down to them [H]. Rule: bonus within 200 m of a lake, pond or wetland
shore, strongest where the water meets a 5–20 yr cut or burn. Boreal GPS
work: conifer forest is for resting, shrubland for foraging [S] (Current
Zoology 64, 2018).

**Heat.** Renecker & Hudson: thermal panting starts at **14 °C** in summer,
open-mouth panting at 20 °C, winter threshold −5 °C [S]. GPS studies show
reduced travel and canopy-seeking from about 15 °C in spring and 20 °C in
summer [S] (Melin et al. 2014; Street et al. 2015; Broders et al. 2012).
Fall rule: above 14 °C shift daytime weight to dense conifer and forested
wetland and halve open-cutover weight; above 20 °C discount midday hard;
below 10 °C full activity; frost mornings are prime.

**Rut.** Peak breeding last week of September to first week of October,
centred about 1 Oct; peak calling response roughly 25 Sept–5 Oct [H,
consistent across Outdoor Canada, ProXpedition, trail.cam]. Calling
effectiveness curve used: 15–22 Sept 0.5; 23 Sept–8 Oct 1.0; 9–15 Oct 0.7;
16–25 Oct 0.4; after 0.2. Bulls hear a call well over 1 km in calm air.

**Time of day.** Bimodal crepuscular [S]; rut activity spills into
daylight, bulls about 13 % more active by day than night overall [S]
(Klassen & Rea 2008). Hour weight used: 1.0 from 30 min before sunrise to
3 h after and from 3 h before sunset to 30 min after; 0.5 mid-morning; 0.3
midday (0.5 in peak rut when below 10 °C).

### Ruffed grouse

Best densities in **aspen 6–25 yr with an alder understory**; aspen without
alder or over 25 yr holds a fraction of the birds (14.3 vs 0.8–3.3 birds per
40 ha) [S] (Wisconsin Sandhill study). Fall foods: aspen buds and catkins,
hazel, cherries, willow, alder, mountain ash, rose hips [G]. Alder creek
bottoms and mature-forest edges hold birds in the boreal [H]. Bush roads
through such stands (grit, clover) at dawn and dusk are a bonus. Birds sit
tight in high wind and rain: calm, cool mornings and the two hours before
dark are best; after a hard frost birds shift to edges and roadside gravel
[H].

### Spruce grouse

Dense young to mid-age **jack pine and black spruce** (15–30 yr, 6–15 m,
branches to the ground) and black spruce–tamarack swamps [S/G]. Fall and
winter diet is conifer needles; berries (Vaccinium) in early fall. Bush
roads through those stands at dawn and dusk add grit-seeking birds.

### Black bear (fall)

Logged boreal bears **select regenerating stands 6–20 yr** (highest berry
biomass) and avoid mature conifer [S] (Brodeur et al. 2008); blueberry and
raspberry in scats correlate with young cuts and lake shores [S] (Mosnier
et al.). Northern Ontario fall diet: blueberry, raspberry, pin cherry,
mountain ash, hazelnut [S] (Romain et al.). Rule: burns 3–15 yr and cuts
6–20 yr on dry jack-pine sites 1.0 in September; hazel and mountain-ash
mixedwood edges 0.7; within 300 m of bedding cover +0.2; lake shores of
cuts +0.2; mature closed conifer 0.2. After mid October the berry weight
collapses toward denning cover. Crepuscular, but feed midday in cool
September weather.

### White-tailed deer (marginal this far north)

Northern limit set by winter snow depth; at 48.9 °N inland presence tracks
south-facing aspen and hazel mixedwood and cutover edges near lakes and
roads [S] (Kennedy-Slaney et al. 2018). Scored as half the moose browse
layer plus a bonus for aspects 135–225° and dense conifer within 500 m.
(Fixed 2026-10-05: the habitat bake's `aspect` band holds the uphill
bearing, and the bonus read it as the facing, so it went to north slopes.
The app now adds 180°; the band is unchanged, no rebake.)

### Weather effects (all species)

- **Temperature** is the only weather variable with a consistent GPS
  effect on deer movement [S] (Mississippi State). Moose multiplier used:
  1.0 at ≤10 °C, 0.8 at 10–14 °C, 0.5 at 14–20 °C, 0.3 above 20 °C; bear
  and grouse less sensitive.
- **Wind**: moose rest more as wind rises (weak, consistent) [S]; calling
  range collapses in wind, "calm and cold carries sound farthest" [H].
  Calling multiplier: ≤10 km/h 1.0; 10–20 0.7; 20–30 0.4; >30 0.2 (ambush
  on lee slopes and in dense conifer instead). Grouse >25 km/h 0.4.
- **Rain**: moose are more active in rain in GPS data [S]; light rain
  quietens the woods for still-hunting; heavy rain (>3 mm/h) kills calling
  and visibility. Multiplier: 0–1 mm/h 1.0 (calling 0.9); 1–3 mm/h 0.8
  movement, 0.5 calling; >3 mm/h 0.5 / 0.2.
- **Pressure and fronts**: no peer-reviewed evidence of barometric effects
  on moose or deer [S]. "Rising after a front" is used only as a proxy for
  the temperature drop and clearing that do matter: +0.15 when the 24 h
  temperature drop is ≥5 °C and the wind is easing.
- **Recent days** (moose and deer, weight key `recent`) [S/H]:
  - Fall heat stress starts near 14 °C (Renecker & Hudson 1986), and moose
    cut daytime movement and seek thermal cover in warm spells (McCann et
    al. 2013; Street et al. 2016).
  - The multi-day part is hunter experience, not measured [H]. A warm spell
    beds them, and the first cool day after one moves them.
  - Daily highs come from the Open-Meteo record for past days and the
    forecast for today on.
  - Warm spell, third day or later of highs ≥ 18 °C: × 0.85.
  - First cool day after two or more warm ones (high 5 °C lower, or under
    14 °C): × 1.15. This replaces the 24 h front factor, so the same drop
    is not counted twice.
- **Your log** (weight key `log`, `app/src/log/huntLog.ts`):
  - Sightings, sounds, sign and call-ins pull the heat map toward them:
    +25 % at the spot, e-folding 250 m and 7 days, gone past 800 m or
    21 days.
  - Blank sits push it down: −10 %, e-folding 150 m and 2 days.
  - An animal seen is an animal living there this week. A rutting bull
    covers a few km², and cow groups hold for days.
  - Each entry also saves where the spot sat on the model's own map
    (without the log's pull), as a percentile of the scored cells within
    3 km. The Places tab averages those per species: 50 is chance. That is
    the model's report card, meaningful after ten or more sightings.
- **Cloud**: overcast cool days extend morning activity into midday
  (thermal relief): +0.1 midday when cloud ≥80 % and below 14 °C.
- **Moon**: GPS studies find no moon-phase effect on deer; nothing
  published for moose. Weight 0, display only.

### Bush thickness (eye-level cover)

What a hunter calls thick bush is the layer at eye level: saplings,
alder, low conifer branches. It decides two things the canopy does not:
how far you see from a stand, and where an animal can hide.

**Why not the canopy numbers.** The forest inventory's crown closure is
the overhead layer, and the brush under it often runs the other way: a
closed canopy shades the understory out, an opening lets it in. The brush
follows the stand's development stage [S] (Oliver & Larson 1996, *Forest
Stand Dynamics*): stand initiation after a cut or burn (slash, raspberry,
suckers), stem exclusion (a dense sapling thicket that self-thins as the
canopy lifts), then understory reinitiation in old stands as gaps open and
shade-tolerant fir and hazel come back. Horizontal cover is what cover
boards measure in the field [S] (Nudds 1977, Wildl. Soc. Bull. 5).

**The model** (`bush_thickness` in `pipeline/build_habitat.py`; the numbers
are this app's estimates on that sequence, not measurements, and want
checking on the ground). Thickness runs 0 (open) to 1 (a wall):

| What | Thickness |
|---|---|
| Regrowth 0–3 yr after a cut or burn | 0.35 |
| 4–8 yr | 0.7 |
| 9–25 yr (the thicket) | 0.95 |
| 26–40 yr | 0.75 |
| Mature dense conifer (black spruce) | 0.55 |
| Mature open conifer | 0.4 |
| Mature mixedwood / hardwood | 0.5 / 0.45 |
| Old (>80 yr) mixedwood / hardwood | 0.65 / 0.55 |
| Jack pine lead | −0.15 (open lichen and blueberry floor) |
| Balsam fir or cedar lead | at least 0.75 |
| Canopy under 40 % / over 80 % (stands past 40 yr) | +0.1 / −0.08 |
| Alder and shrub | 0.85 |
| Open bog, rock, road, water | 0.15, 0.1, 0.05, 0 |

Sight distance through it: 5 + 75·(1 − thickness)^1.5 m, so about 80 m in
open woods, 30 m in mature spruce, 5 m in a thicket. Across water, bog,
rock and road the view is taken as 400 m.

**Where it counts.**
1. *The view from a stand* (the site's visibility part): the expected view
   along three bearings across the downwind arc (a circling animal passes
   through it), each 30 m step passing the share of light its bush lets
   through, summed out to 240 m. Multiplier 0.6 with no view to 1.0 at
   100 m. For grouse, the view all round and a softer 0.82–1.0: the grouse
   hunter walks the thick and flushes birds out of it.
2. *Hiding cover* for the moose, deer and bear edge terms: the nearer of
   tall dense conifer and any thick patch (thickness ≥ 0.7, half a hectare
   up). A moose beds in a young thicket or an alder run as readily as in
   spruce, and 5–20 yr cuts are both its browse and its cover. Heat still
   looks for canopy (shade), which is conifer.

The net effect: the spots move to the edge of the thick, where the view
opens onto what comes out of it, not into the middle of it.

**Next** (not built): the walk in, since thick bush is slow and loud and
should cost the route, not the spot; and LiDAR, whose first and last
returns would measure canopy height and gaps at 1 m, and whose point cloud
would measure the brush at 0.5–3 m directly.

### Wind and scent (stand and calling-site geometry) [H/G]

1. A responding bull circles to the **downwind side** of the caller. Score
   a site by whether its downwind arc is open, visible and shootable (how
   far you see through the bush there: see Bush thickness).
2. Ideal geometry: wind from the expected animal location (browse, water,
   bedding) across the hunter into dead ground (open lake, big bog you can
   see across). Crosswind (60–120° off the approach line) 1.0; hunter
   straight downwind of the approach 0.9; hunter upwind (scent into the
   cover) 0.1.
3. Put the call 40–50 m upwind of the shooter so the circling bull passes
   in the crosswind.
4. If the forecast direction swings more than 30° in the sit, downgrade the
   site and prefer still-hunting.
5. **Thermals** (valid when the synoptic wind is ≤8 km/h and the sky is
   clear): from 30–60 min after sunrise until mid-afternoon air and scent
   rise upslope; from about an hour before sunset through the night they
   drain downslope and pool in hollows, creek bottoms, low corners of
   cutovers and over lake surfaces. Scent goes where the air goes, so sit
   on the side it flows away to. While it drains (evening, night, and the
   morning until the sun is on that slope): sit below or level with the
   target, across-slope, never above it. While it rises (sun on the
   slope): sit level with or above the target. The switch follows the sun
   on each slope: under 30 min after sunrise on an open east face, hours
   later on west faces, valley floors and under dense conifer
   (docs/ELK-SCIENCE.md §5). (Corrected 2026-10-05: this rule had the
   positions reversed.)
   The ground-wind model computes this per spot and minute from the
   forecast's own layering (docs/MICRO-WIND.md).
6. Drainages are scent highways: evening scent flows down every gully to
   the lake, fouling the shoreline below.
7. Lake shores in calm clear weather: a weak land-to-lake drift at night and
   morning, onshore on warm afternoons. Morning calling from a point pushes
   scent over the water (good); afternoon lake breeze carries it inland.
8. Lee slopes below crests eddy scent unpredictably in wind over 20 km/h;
   animals bed there on windy days.
9. Never sit in a bowl or saddle in the evening: scent pools there.

### Out hunting: the moose you hear (hunting mode)

Hunting mode (the mode pill → Go hunting) follows you, records the track,
and draws your scent cone from where you stand. It is made for the phone
coming out of a pocket for a look and going back: the screen sleeps as
usual, each look starts a fresh fix, and the cone and the moose catch up
at once. A web app gets no fixes with the screen off, so the track is
stretches joined by faint dotted lines across the times it was away. The
**Bow** view it puts on is the imagery at full strength with the Shooting
lanes layer over it: the same 0.5–3 m bush thickness from the LiDAR point
cloud as the Bush view, but with open and light ground left clear (the
imagery shows through where an arrow would go) and thicker bush shaded
darker (ratio 0.30–0.45 faint, up to near-black at a thicket). The first
Bow view drew the Bush colour scale at 40 % over dimmed imagery and read as
washed out (Gavan, 2026-09-28): even open ground got a pale wash. The grey
1 m LiDAR shade sits over it at 35 % for the old skid trails and ditches
through the thick stuff.

Each moose you hear goes on the map from where you stand: what it was
(cow call, bull grunt, thrashing, walking, splash, seen), the way (the rose
turns with the phone), about how far, and when (now, or up to 20 minutes
ago, since the phone comes out after the grunt). The card's one line on
each look is his last sound, where, how long ago, which way he is going
and his likely swing. The sounds join up in order into
his route, with a faint line back to where you heard each from. With two
sounds in half an hour the map also draws the way he is heading.

From his last spot it draws his likely swing round to wind you, routed
over the ground rather than drawn as an arc (`hunting/swing.ts`, run in
the route worker on the same 10 m LiDAR going grid as Route mode). It is a
least-cost path over a resistance surface, the usual way movement ecology
puts an animal's likely route across a landscape, with a moose's costs,
not a walker's:

- **Slope**: the walking curve (see `docs/ROUTES.md`), square-rooted. Four
  long legs take a grade better than a person, but he still takes the easy
  line, and a rock face stays a rock face. Topography and forest cover
  shape moose movement far more than roads, rivers or power lines do
  (Bartzke et al. 2015, Ecosphere 6(4), 151 GPS-collared moose in Norway).
- **Bush** hardly slows him (1 − 0.2 × NRD). **Wet ground** is his: bog,
  fen and marsh cost a little (0.8–0.9 of the going). **Open water** he
  swims, at a quarter of the going, so a narrow channel is crossed and a
  bay is walked round.
- **Open ground in your sight** (bog, road, water, bush thinner than NRD
  0.35) costs up to three times as much within 250 m of you, fading out
  with distance. A wary bull working in to a call keeps to cover; moose
  step length grows with distance from cover, that is they move through
  the open rather than use it (Brown et al. 2018, Ecosphere 9:e02405).
- **Close in** costs more, up to five times at 25 m, from 80 m in, and
  nothing inside 25 m is crossed. Guides put the hang-up at 50–80 yards
  (45–75 m), "while they're still concealed by the cover of heavy timber"
  (Outdoor Canada, "Pro tips for calling in big bull moose").

The path ends at the first ground where your scent is noticeable at his
nose, 40 m or more from you: the live cone as drawn (it follows drainage
and the terrain, so the end moves with it), or, with the cone hidden, a
60° sector downwind on the ground wind out to 450 m. It is searched both
ways round, each walled off from the other along the line through you that
halves them, and the way he has been moving round wins if his heading
says; otherwise the cheaper. Off the going grid, or before it has loaded
for the first time, the plain arc round you at his distance stands in.

This is rule 1 above, and it is what happened on 2026-09-27 at Pickle
Lake: 2.5 hours of cow calls with the odd bull grunt, the bull pulled the
hunter off the calling spot, then ran to get downwind once a last cow call
set him going. The costs are judgment built on those sources, not fitted
to collar data, and nothing is field-checked: he may come straight in or
leave. The heard log is what to check it against. What beats the swing is
rule 3: a caller 40–50 m upwind of the shooter, placed with the scent
card's second person, so the swing passes the shooter in the crosswind.

### Terrain features flagged

- Saddles on ridges between drainages: rut travel funnels (0.8 in the rut).
- Isthmus or land bridge between two lakes or lake and bog ≤300 m wide:
  1.0; the ends of long narrow lakes 0.8.
- Beaver-dam outlets, beaver-pond shorelines, stream inlets to shallow
  bays: 0.9.
- Points and narrows on lakes: crossings and calling amphitheatres (sound
  carries over water) 0.7.
- Benches (slope <8° inside 15–30° slopes) and lower slopes above wetlands:
  bedding 0.6; morning stands below them.
- Ridge and esker crests: bear berries and grouse; moose travel the toe of
  the esker where it meets wetland (30–80 m band, 0.7).
- Cut or burn to conifer edges, and cut edges touching water: the highest
  moose composite.
- South and south-west aspects: more browse and berries, but on warm days
  moose bed on north aspects and in dense conifer; weight aspect by hourly
  temperature.

## Fishing

### Water temperature and thermocline

Ontario models predict water temperature from a **lagged 5–7 day air
temperature mean**, not the instantaneous value [S] (Can. J. Fish. Aquat.
Sci. 2021; MDPI Water 2024). Working rule for a small Shield lake:
`Ts ≈ 2 + 0.85 × mean(air T, last 7 days)`, clamped to the seasonal
envelope: ice-out (early–mid May) 4–8 °C; late May 10–14; late June 17–20;
late July peak 20–23; mid-Sept 14–16; turnover when Ts falls to 10–12 °C
(late Sept–mid Oct); ice-up Nov. Shuter et al. 1983 and Sharma et al. 2007
give lake-specific regressions if calibration is ever wanted.

Thermocline depth from fetch (Hanna 1990, Ontario lakes) [S]:
`log10(Zt) = 0.336 × log10(fetch m) − 0.245`, so 1 km → 5.8 m, 2 km →
7.3 m, 5 km → 9.9 m. Brown, tea-stained lakes stratify 1–3 m shallower
(Fee et al. 1996, ELA) [S]. Stratification sets once Ts >10 °C and firms
by mid-June; deepest just before turnover. Fall turnover: one strong wind
mixes the lake once Ts nears the hypolimnion (8–11 °C); a tough bite for
2–3 days, then fish scatter through an isothermal column.

Pickle Lake (ARA): walleye, pike, whitefish, cisco, perch; max 17.6 m, mean
3.6 m, longest fetch about 2 km, so a summer thermocline near 7 m and a
weak stratification that turns over early. McGill: max 15.1 m, Secchi
1.8 m (stained: fish shallower, daytime bite better). Ketchup: max 12.9 m,
mean 2.5 m. No lake trout in the camp lakes (White and Ravine Lakes have
them). No brook trout recorded.

### Thermal preferences [S] (OMNR CCRR-17, Hasnain, Minns & Shuter 2010)

| Species | Preferred °C | Spawn °C | Avoids |
| --- | --- | --- | --- |
| Walleye | 18–22 feeding optimum, comfortable 13–21 | 6–10 at ice-out | >24 |
| Northern pike | 10–18, best bite 13–17; big fish avoid >21 | 4–11 after ice-out | >24 |
| Lake trout | 8–12 | 9–14 falling, Sept–Oct | >15 |
| Brook trout | 13–17 | 4.5–9.5, Oct–Nov on seeps | ≥20 |
| Lake whitefish | 12–13 | 3–6, Nov, rocky shoals | >18 |
| Yellow perch | 20–23 | 7–12, late May | — |

### Walleye by period

- **Ice-out and spawn** (Ts 4–10, May, season closed): 1–3 m on inlet
  mouths, rocky and gravel shores with wash; shallow at night.
- **Post-spawn / opener** (3rd Sat May–mid June, Ts 10–16): males 1.5–4 m
  near spawning sites, females on the first break off spawning bays 3–6 m;
  inlets and wind-warmed north and north-east bays score highest.
- **Early summer** (mid June–early July, Ts 16–19): 3–7 m on points,
  reefs, sand-rock transitions, developing weed edges; 1–3 m in low light.
- **Mid-summer stratified** (July–Aug, Ts 19–23): structure that meets the
  top of the thermocline, 5–10 m, target the 3 m band above Zt [H/S]; in a
  small Shield lake daytime is the deep edge of structure, dusk to night is
  1–4 m on wind-blown rock points, shoals and weed flats. Telemetry shows
  walleye stay epilimnetic (13–21 °C) [S] (Lake Erie bathythermal study).
- **Late summer** (late Aug–mid Sept, Ts 18→14): deep weed edges and
  main-lake structure 5–9 m; increasingly active in daylight.
- **Fall turnover** (Ts 10–12, late Sept–mid Oct): scattered for 2–3 days;
  then sharp breaks beside the deepest water in the basin, necked-down
  channels with wind current, 8–12 m holes [H] (Outdoor Canada, Shield
  fall walleye).
- **Late fall** (Ts 4–9, mid Oct–ice): big fish deep and tight, 8–15 m on
  the fastest-dropping breaks where structure meets basin, plus 2–5 m rock
  points after dark.
- **Ice** (Dec–Apr 14): first ice 2–5 m off weedlines and points;
  mid-winter 8–15 m on humps and basin edges, up onto the 3–6 m shelf at
  dusk; late ice back to 2–6 m near inlets.

### Northern pike by period

Ice-out spawn in flooded marsh and back bays <1 m; post-spawn (Ts 10–15)
first weeds 1–3 m and warming north shores; early summer (15–19) 1–4 m
cabbage, weedy points, bay mouths, inlets; mid-summer (>20) small pike stay
in weeds, big pike move to deep weed edges 3–6 m, rock points and humps at
the thermocline, or suspend with cisco 6–10 m; late summer and turnover:
main-lake and island points dropping to deep water with a 3–6 m flat;
late fall (<10) 3–6 m outside edges of green weeds and rock points, big
fish shallow again; ice: 1–3 m weed flats early, 3–6 m edges mid-winter,
backs of bays late. Wind matters less than for walleye; post-frontal skies
push pike to the first break and thick cover [H].

### Lake trout and brook trout

Lake trout (White Lake, Ravine Lake): shallow 1–6 m along rocky shores at
ice-out; below the thermocline in 10–12 °C water (12–25 m) in summer;
rising as Ts drops below 15 °C and onto 2–8 m rock structure when Ts
≤10–12 °C, staging near spawning shoals [S/H]. Spawn at night in about 2 m
(0.5–12 m) on clean angular cobble on the wind-facing edge of shoals that
end in a drop [S] (Callaghan, Blanchfield & Cott 2015). **Season closes
30 Sept in FMZ 7.** Brook trout prefer 13–17 °C, avoid ≥20; spring within
2 m of shore at inlets and outlets; summer at the thermocline or on
groundwater seeps; fall back to shorelines and inlet mouths. **Season
closes Labour Day in FMZ 7** (Superior tributaries from the Pic River east
differ).

### Wind [H] (In-Fisherman "Principles of wind and walleyes")

- Wind ≥10 km/h for half a day sets a surface current onto the windward
  shore and a return current below; baitfish and walleye stack on the
  windward side of points, reefs and shoreline lips, on the upwind-facing
  side of a point and the inside turn that meets the current. Surface
  current is deflected 10–20° right of the wind.
- Turbulence reaches about twice the wave height; walleye hold just under
  it: 0.3 m waves → 0.6–1.2 m; 0.6 m waves → 1.2–1.8 m. Mud lines on
  wind-blown clay shores hold walleye in daylight.
- Inactive cold-water fish (early spring, late fall) sit on the lee side of
  the point tip. A wind of a day or more from the same direction beats a
  fresh wind; a shift resets the pattern. Calm bright days push walleye to
  the deep edge; chop lets them feed shallow all day.
- Fall lake trout: wind-swept rocky points and shoals facing the wind.
- Boat safety (14–16 ft aluminum): whitecaps start 15–19 km/h; under 16
  fine; 16–24 needs care and lee shores; sustained >24 km/h or gusts >32
  km/h stay in. Wave height depends on fetch along the wind.

### Light, time, moon, pressure

- Low light is the strongest environmental effect on walleye catch:
  Escanaba Lake 2003–2015 (PLOS ONE 2021) [S] trip-success odds dusk 0.47 >
  dawn 0.34 > day 0.26; 10–15 % more success at dawn and dusk. Ryder 1977:
  the rate of change of light is the trigger; the 30 min before sunset
  dominates, in every season including under ice [S]. Preferred light 8–68
  lux; foraging continues to 0.05 lux (Lester et al. 2004) [S]. Secchi
  2–5 m lets walleye feed in daylight. Rule: score 1 h before to 2 h after
  sunset and 1 h either side of sunrise; add daytime score with cloud ≥70 %
  or chop; subtract on clear calm midday.
- Moon: the only repeatable lunar signal is walleye, and small (10–12 %
  more success near full and moon overhead or underfoot) [S]; muskie about
  5 %; solunar apps failed independent tests. Used as a ≤10 % modifier.
- Pressure: low importance in the Escanaba model [S]. The angling rule
  (falling before a front = aggressive and shallow; rapid rise after = slow
  and deep) is really front passage, light, wind and temperature. Used as a
  6–12 h trend modifier only.
- Post-frontal: after a cold front (clearing, NW wind, temperature drop,
  rising pressure) fish move deeper and tighter for 1–2 days and feed in
  shorter windows [H]. Rule: 24 h air temperature drop ≥6 °C with cloud
  <30 % and rising pressure → −20–30 % activity for 36–48 h, preferred
  depth one band deeper, dusk window boosted. Stained bays and wind-blown
  shores recover first.

### FMZ 7 regulations (ontario.ca fishing regulations summary, verify each year)

- Walleye: Jan 1–Apr 14 and 3rd Sat May–Dec 31; S-4, C-2; ≤1 over 46 cm.
- Northern pike: all year; S-6 (≤2 over 61 cm, ≤1 over 86), C-2.
- Lake trout: Jan 1–Sept 30; S-2, C-1.
- Brook trout: Jan 1–Labour Day; S-5 (≤2 over 30 cm, ≤1 over 40), C-2.
- Lake whitefish all year S-25 C-12; yellow perch all year S-50 C-25.
- White Lake sanctuaries (no fishing Mar 15–Jun 15): the bay south of Regan
  Point and the White River to the Mobert Road bridge; Shabotik Bay at
  Olga Creek plus 2 km of Olga Creek and 1 km of McGill Creek; Shabotik Bay
  at the Shabotik River plus the Shabotik and Kwinkwaga rivers.
- Central Bait Management Zone: no moving live bait in or out.

## Key sources

Moose: ontario.ca/files/2025-06/guide-moosehabitat.pdf; Hamilton et al. 1980
doi:10.1139/z80-194; Fraser et al. 1984 doi:10.1139/z84-014; Renecker &
Hudson (Alces); Current Zoology 64(4) 2018 (boreal GPS); Melin et al. 2014
doi:10.1111/gcb.12405; Street et al. 2015; Klassen & Rea 2008;
outdoorcanada.ca/the-best-time-to-call-moose. Bush thickness: Oliver &
Larson 1996, Forest Stand Dynamics (Wiley); Nudds 1977, Wildl. Soc. Bull.
5:113–117. Grouse: Wisconsin Sandhill
study; MN DNR ruffed grouse woodland guide; Birds of the World (spruce
grouse). Bear: Brodeur et al. 2008 doi:10.1139/Z08-118; Mosnier et al.
(Écoscience); Romain et al. (Can. Field-Nat.). Deer: Kennedy-Slaney et al.
2018 (Wildlife Research 45). Wind and thermals: realtree.com/bowhunting/
how-to-hunt-thermals; adfg.alaska.gov moose hunting. Fishing: Hasnain,
Minns & Shuter 2010 (OMNR CCRR-17); Hanna 1990 doi:10.1139/f90-108; Fee et
al. 1996; Shuter et al. 1983 doi:10.1139/f83-213; Escanaba Lake PLOS ONE
2021 (PMC8483380); Ryder 1977; Callaghan, Blanchfield & Cott 2015;
in-fisherman.com principles-of-wind-and-walleyes; outdoorcanada.ca
how-to-catch-fall-walleye-in-canadian-shield-lakes;
ontario.ca/document/ontario-fishing-regulations-summary/fisheries-management-zone-7.
