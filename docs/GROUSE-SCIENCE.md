# Grouse spot science

Which grouse live in the app's areas, where they sit in fall, and how to
score that from the baked layers. This doc builds on three sources and
repeats them only where a rule needs the number:
- the grouse parts of `docs/HUNT-FISH-SCIENCE.md`;
- the Clearwater notes
  (`docs/research/research_notes/Clearwater foothills habitat and regs/grouse-*.md`);
- the northern notes
  (`docs/research/research_notes/Mountain hunt habitat rules/upland_birds_north.md`).

The rules land in the grouse branch of `habitatScore`, `activityVerdict`
and `siteCore` in `app/src/spots/huntRules.ts`, in `forestGrouseBand` and
`ptarmigan` in `placeRules.ts`, and in the species table in `regs.ts`.
Compiled 2026-10-18.

Evidence tags as in docs/ELK-SCIENCE.md:
- **[S]** peer-reviewed or agency science;
- **[G]** agency guidance or an agency web page;
- **[H]** hunter press (lower weight);
- **[I]** inference from the sources or from this app's code, not measured.

**(unverified)** marks a number seen only in a search summary or a
secondary source. **[spring]** marks drumming or brood data applied to fall:
most stand numbers come from spring counts, because fall telemetry is
scarce.

The shared web-search budget ran out partway through the research. After
that, only agency and journal URLs already found were read. Section 12
lists what is still open.

## 1. Bottom line

- **The grouse map treats grouse as one bird; it should be four.**
  - Today ruffed and spruce grouse share one score: aspen scores 1.0,
    conifer 0.3.
  - Spruce grouse are nearly the opposite bird. Deciduous cover is what
    keeps them out (Minnesota occupancy, 2019–22).
  - Split the target into members, as bear already is: ruffed, spruce,
    sharp-tailed and dusky grouse, plus ptarmigan. Each is scored by its
    own rules, and the map takes the best one present and in season.
- **The top class barely exists on the ground.**
  - The rule's 1.0 (aspen 6–25 yr) covers 0.1% of Pickle Lake's land, 0% of
    Whitefish Lake's, 1.7% of the Sault test's and 2.8% of Duhamel's (table
    in §3).
  - 90% of Pickle's aspen stands are over 80 yr old.
  - So what the map draws there is the +0.25 roadside band and the 0.8
    shrub class. Mature aspen (0.35 today) and the roadside term shape the
    map more than the peak does. They need the most care.
- **The roadside bonus mostly measures the hunter, not the bird.**
  - In Wisconsin, 74% of banded grouse shot were within 400 m of a drivable
    road, a band covering 43% of the area.
  - Birds within 1 km of a road or trail lived 9.1 months on average,
    against 16.3 months farther away.
  - Road-hunting from a truck found 0.14 flushes an hour, against 0.4–0.6
    on foot.
  - Keep a small trail term for first and last light, and let roadsides
    lose value as the season goes on.
- **Three weather rules in the verdict have no support:**
  - "birds sit tight in wind": the 13 km/h cut-offs in the literature are
    about surveyors hearing drumming;
  - the dawn window: it is the drumming-count protocol, and the evening
    feeding peak is the larger one;
  - the overcast-midday bonus.

  The cold-and-snow side is missing: with 20 cm or more of soft snow,
  grouse spend most of the day in snow roosts.
- **The scent part should not apply to grouse.** `siteCore` scores a grouse
  cell by the wind against the moose's feeding side, which can cut it to
  0.12. A grouse hides and flushes by sight and sound. The wind matters
  only to a dog's nose. [I]
- **The other grouse are edge cases here, and the app should say so.**
  - Sharp-tails are legal in all three Ontario zones but rare in the boxes.
    They live in fens and young cuts.
  - Dusky and sooty grouse are rare at Blanchard River and possible at
    Highland Lake.
  - Ptarmigan matter at Blanchard River and Highland Lake. They also matter
    at Lac Bailey in irruption winters, December to March. The app calls
    them absent there because Lac Bailey has no treeline.
- **The cycle is the biggest swing, and no one publishes it in Canada.**
  - From low to peak, numbers rise 2–3× at the southern edge of the boreal
    and 5–12× in the Yukon.
  - In 2026 the Great Lakes ruffed grouse are two years past a 2024 peak.
  - The Yukon's grouse are at or just past their peak, along with the hares.
  - Ontario has no survey at all.
- **Regulations.**
  - The app's table holds only BC and the Yukon, and both match the 2026
    books.
  - Ontario, Quebec and Alberta entries are in §9. So are the rules a grouse
    hunter is most likely to break:
    - hunter orange: in Ontario during the gun moose and deer seasons, and
      in Quebec at all times;
    - no shooting on or across roads, in every province.

| Part | Lands in | § |
|---|---|---|
| Members (ruffed, spruce, sharp-tailed, dusky, ptarmigan) | `profile.ts` `TARGET_MEMBERS`; `regs.ts` `Quarry` | 2 |
| Ruffed grouse: stand curve, interspersion, conifer share | grouse branch of `habitatScore` (keys `browse`, `edge`, `shore`) | 3, 10 |
| Spruce grouse | a new `spruceGrouse()` in `placeRules.ts` | 4, 10 |
| Sharp-tailed, dusky, ptarmigan | `placeRules.ts`, beside `ptarmigan()` | 5, 10 |
| Time, weather, snow | grouse rows of `activityVerdict` (`light`, `wind`, `rain`, `temp`, `front`) | 6 |
| Roads, trails, hunters, dogs | `siteCore` (`scent`, `access`, `pressure`) | 7 |
| Cycle phase | a region-year table and a verdict line | 8 |
| Seasons and legal lines | `regs.ts` | 9 |

## 2. Which birds, where

**Presence and season by area.** Presence is from atlases, the existing
notes and a GBIF query per area and species. GBIF records are
opportunistic and bunch along roads. Seasons are from §9.

- "Pickle Lake" is the camp's lake, about 44 km north-west of White River.
  It is not the town of Pickle Lake (51.5° N). The Ontario range evidence is
  for the White River–Hornepayne–Manitouwadge country.
- "Rare" means legal and recorded nearby, but not a bird to plan a hunt
  around.

| Area | Ruffed | Spruce | Sharp-tailed | Dusky / sooty | Ptarmigan |
|---|---|---|---|---|---|
| Pickle Lake, ON 21B | present, main | present | **rare**: atlas squares 40–60 km away; White River 2005; shot near White River in the 1967–68 irruption. Open 15 Sept–31 Dec | absent | absent; no season |
| Whitefish Lake, ON 29 | present, main | present | **rare**: nearest record 33 km; Timmins clay-belt birds mostly Nov–Feb. Open | absent | accidental (winter irruptions, nearest 63 km); no season |
| Searchmont and Sault test, ON 36 | present, main | present, uncommon (Southern Shield) | **rare in the boxes**; common on farmland 25–45 km south (Echo Bay, Laird). Open, 2 a day | absent | absent; no season |
| Lac Bailey, QC 18 | present | present (black spruce domain) | absent: the range ends near Chibougamau, about 350 km west | absent | **willow ptarmigan in irruption winters, Dec–Mar**: 100 at Labrieville (12 km) in 1991, 300 at Pipmuacan (59 km) in 2011. Open to 31 Mar |
| Duhamel, QC 10 | present, main | uncommon (maple–birch country; 0.3% black spruce lead in the grid) | absent; a stray 72 km away | absent | vagrant only |
| Clearwater, AB 324/326 | present, main (about 6 records to 1 spruce) | present | absent; no season | absent from the box (fall dusky above about 1,850 m) | absent from the box; open by law |
| Blanchard River, BC 6-28 | possible only in poplar (none in the grid) | probable, in open white spruce | absent; no BC Region 6 season | **dusky rare** (nearest 37 km); **sooty rare**, toward Chilkat Pass (17 km) | **willow abundant**, rock and white-tailed present |
| Highland Lake, YT 4-09 | in aspen of the burns (records old) | present, probably the main forest grouse | rare: Yukon records lie in valley bottoms at 458–735 m; the box starts at 920 m | dusky possible (Keno Hill, Aug 2022) | willow and rock probable, white-tailed possible |

**What the app does with this [I]:**
- **Members.** Split the grouse target into members (M1, §10).
- **Rare species.** Give "rare" species the elk doc's "edge or rare" state:
  dimmed and capped, with a line saying so.
- **Lac Bailey ptarmigan.** Add a `regs.ts` ptarmigan entry with status
  `hunted` and a note: "willow ptarmigan come south in some winters,
  mostly December to March". The app's own presence rule calls ptarmigan
  absent wherever there is no treeline.

## 3. Ruffed grouse

### What the baked areas hold today [I]

These are shares of land cells in each area's habitat grid, read
2026-10-18 with `pipeline/habfile.py`. "Aspen-ish" is the grouse rule's
own gate: hardwood or mixed, led by aspen or birch, or ≥40% hardwood.

| Area | Aspen-ish | of it 6–25 yr | Aspen-ish age, most common | Shrub | Within 40 m of a road or trail |
|---|---|---|---|---|---|
| Pickle Lake (FRI 2010) | 16.7% | 0.1% | 80–100 yr (66%) | 3.6% | 4.0% |
| Whitefish Lake (FRI) | 22.9% | 0% | 40 yr and over (93%) | 0% | 8.7% |
| Searchmont (FRI) | 74.1% | 16.7% | over 80 yr (62%) | 0.1% | 5.2% |
| Sault test (SCANFI) | 62.4% | 1.7% | 60–80 yr (91%) | 4.1% | 2.5% |
| Duhamel (écoforestier) | 64.7% | 2.8% | over 100 yr (50%) | 0.8% | 23.8% |
| Lac Bailey (écoforestier) | 22.6% | 0.9% | 25–40 yr (78%) | 5.3% | 4.7% |
| Highland Lake (SCANFI) | 18.1% | 17.7% | 15–25 yr (98%, the burns) | 12.5% | 0% |
| Blanchard River (VRI) | 0.0% | 0% | — | 29.1% | 1.1% |
| Clearwater (no forest bake) | 0% | 0% | — | 19.5% | 0% |

What this shows:
- In the Ontario and Quebec areas, the value given to mature and old aspen
  (26 yr and up) decides most of the ruffed grouse map.
- So does the roadside band. At Duhamel a quarter of the land gets the
  +0.25.
- Some land is hardwood or mixed at 30–39% hardwood and not led by aspen or
  birch, so the ≥40% gate leaves it out of the aspen class:
  - Lac Bailey 21%;
  - Duhamel 14%;
  - Highland Lake 12%;
  - Sault test 5%.

### Stand age: the aspen curve

**The existing doc's Sandhill numbers are misread.**
`HUNT-FISH-SCIENCE.md` says aspen 6–25 yr with alder holds 14.3 birds per
40 ha, against 0.8–3.3 for aspen without alder or over 25 yr. The source is
Kubisiak, Moulton & McCaffery 1980 (WDNR Technical Bulletin 118; the text
was checked here). [S, spring]
- **Units:** drumming males per 40 ha (100 acres) in spring, not birds and
  not fall.
- **The alder comparison** runs across the cycle, not across ages:
  - aspen-alder went from 14.3 at the 1970–71 high to 4.3 at the low;
  - aspen of all ages without alder went from 3.3 to 0.8.
- **The age effect** is separate. Sandhill means, 1969–77:
  - 0–5 yr: 1.7 drummers per 40 ha;
  - 6–25 yr: "nearly seven" (6.7);
  - over 25 yr: 3.5.

  That is 0.25 : 1 : 0.52.
- **Oak:** 0.7–0.9.

**Cloquet, Minnesota** (Gullion & Svoboda 1972, GTR NC-1). [S/G]
- **0–10 yr:** brood cover from the first summer after a cut, lasting
  "perhaps as long as a decade".
- **About 10 yr:** after the first self-thinning the stand is 7.6–10.7 m
  tall with under 19,800 stems/ha. This is wintering and breeding cover.
  8–12 yr stands held 0.62 breeding birds/ha.
- **13–25 yr:** 0.82/ha, the best of any age.
- **About 25 yr:** once stems thin below about 4,900/ha, coverts "rather
  abruptly become devoid of breeding ruffed grouse". From this age the male
  flower buds become winter food.

**Northern Minnesota by stand age** (Gullion 1967, via USFS FEIS). [S]

| Stand | Birds/km² | Mean survival |
|---|---|---|
| Hardwood 12–25 yr | 81 | 22.3 months |
| Hardwood 7–12 yr | 41 | 11 months |
| Hardwood 40–60 yr | 27 | 19.2 months (40–80 yr) |
| Hardwood under 7 yr | — | under 5 months |

**Elsewhere, the same shape: a peak in young stands, a long shoulder in
mature ones.**
- **Alberta, ABMI 2023** [S, spring]. Relative abundance:
  - harvested deciduous: 1.0 at 10 yr, 0.88 at 20, 0.64 at 40, 0.54 at 60;
  - natural deciduous: about 0.5 at 20–60 yr, falling to 0.23 by 140 yr;
  - pine: 0.10–0.26;
  - black spruce: 0.05.

  The full table is in the Clearwater note.
- **Maine** (Allen 1985, in the 2001 state assessment) [G]. Relative to
  aspen–birch saplings:
  - aspen–birch pole stands 0.39, saw-log stands 0.28;
  - spruce–fir saplings 0.39, pole 0.28, saw-log 0.06.
- **BC sub-boreal spruce** (Pojar 1995, via FEIS) [S]:
  - sapling aspen held the most birds, 1.26/ha;
  - mature aspen and mixed stands held 0.84–1.0/ha, about 0.7–0.8 of the
    peak;
  - stands under 6 yr held the fewest.
- **Boreal fire** (Schieck & Song 2006 meta-analysis, via FEIS) [S]:
  - common in 11–30 yr burns, in aspen and mixedwood 76–125 yr after fire,
    and in mixedwood over 125 yr;
  - uncommon at 31–75 yr;
  - rare in burns of 10 yr or less with no live trees.
- **Alberta mixedwood** (Schieck & Nietfeld 1995) [S, spring]: more birds
  in 20–30 yr stands than at 50–65 yr or over 120 yr.
- **Quebec** [S]:
  - **Broods** (Giroux et al. 2007, JWM 71:87) selected 2–20 yr stands and
    11–20 yr clearcuts. They avoided 60–100 yr stands, uneven-aged stands,
    partial cuts and conifer (P < 0.0001).
  - **Winter** (Blanchette, Bourgeois & St-Onge 2007, JWM 71:1758; 23
    radio-tagged females, Portneuf). Late November to mid-April, females
    used mixed stands over 17 m tall and 61–120 yr old, with about 50%
    conifer in several layers.
  - **Western Quebec boreal** (Potvin et al. 1999, CJFR 29:1120): no
    short-term grouse response to clearcutting.
- **Ontario** [G/S]:
  - OMNR's 2003 mixedwood silviculture guide: grouse use every stage of
    aspen–birch–spruce mixedwood, and prefer the early stem-exclusion stage
    of aspen- or birch-led stands.
  - Algonquin (Martin 1960): 6 males per 40 ha both in young birch–aspen
    and in fir–spruce with hardwoods.

**What the evidence says about the app's curve [I].**
- **The peak is right.** 10–25 yr is the best age. 6–9 yr is good, not
  full value.
- **The fall from 25 yr is right too**, but too steep for the oldest
  stands. Across the sources, mature and old aspen and mixedwood hold about
  0.45–0.55 of the peak, and 0.7–0.8 in BC's sub-boreal.
- **The current 0.35 past 40 yr is too low**, and it is the value most of
  Pickle Lake is scored at. It sits barely above conifer at 0.3, which no
  source supports for ruffed grouse.
- **From mid-October, mature aspen is the food** (bud season, below). So
  in late season the 26–60 yr stands should rise, not fall.

### Stems, height and bush thickness [S, spring]

- **Wisconsin** (TB 118): occupancy "increased dramatically" once saplings
  reached 3 m and aspen stems ran 2,000–12,000/ha. At Stone Lake birds
  began using cut aspen after age 10.
- **Pennsylvania cuts** (via FEIS):
  - active drumming sites had 7,462 stems/ha (2.6–12.5 cm dbh), against
    3,312 at inactive sites and 1,857 at random points;
  - brood sites averaged 21,400 stems/ha.
- **North vs south** (Rusch et al. 2000 review, via FEIS): drumming-site
  understory runs about 3,000–5,000 stems/ha in Alberta and Ontario, against
  30,000–33,000 in the Great Lakes states. Northern birds accept sparser
  cover.
- **Vertical cover, not horizontal** (Gullion & Svoboda 1972; 446 males
  over 11 years):
  - The longest-lived males used dense vertical stems under 15 cm thick:
    sapling aspen, hazel, mountain maple, alder. From there a bird can watch
    15–18 m of ground.
  - Brush piles, slash, windfalls and low conifer boughs are "horizontal
    cover", where predators ambush.
- **Alberta** (Boag 1976, via FEIS): where shrubs were thinned, occupancy
  and recruitment fell.

**[I] The app's eye-level bush thickness is a usable proxy for stem
density, not a measure of it.** Thickness 0.5–0.85 is the "thick" band. The
bush model and the LiDAR's 0.5–3 m returns could be calibrated to stems/ha
on a few cruise plots. Thickness also counts slash and blowdown, which
Gullion calls bad cover. So the thickest band should not score higher than
the middle.

### Interspersion: the activity centre [S, spring]

- **Drumming sites sit next to mature aspen:**
  - at Sandhill, 98% of 175 were within 40 m of at least one mature aspen;
  - at Stone Lake, 91%, against 66% of random points;
  - 92% of the Stone Lake sites in alder were within 20 m of a mature
    aspen (TB 118).
- **At Cloquet**, over 98% of 341 persistently used drumming logs were
  within sight of a mature male aspen.
  - Every activity centre where the aspen was cut was abandoned, even with
    the hazel, birch and logs left.
  - Centres were reoccupied 7–13 yr later.
- **Broods** (Kubisiak 1978, TB 108): 94% of all broods, and every adult,
  were flushed in aspen or within 100 m of an aspen stand.
- **Gullion's management unit** is a 4 ha activity centre holding 3–4 aspen
  age classes, each within about 91 m of the others: 0–10, 11–20 and 31–40+
  yr (Gullion 1984, via the Beltrami County plan [G]).
- **Winter food:**
  - one male aspen over 13 cm dbh gives 8–9 grouse-days of buds;
  - so a grouse needs 20–23 trees for a 180-day winter;
  - Wisconsin keeps ≥12 mature aspen/ha in large cuts (TB 118).
- **Against:** Gullion found birds survived better in pure stands than in
  similar stands with edge. On his reading, edges matter only in poor
  habitat. Good aspen gives food and cover in the same stand.

The app has no "distance to mature aspen" band, but one can be baked from
the bands it already has (stand age, lead, hardwood %), the same way
`distCover` is. [I]

### Conifer: a little helps, a lot hurts

- **Pine** (Gullion & Alm 1983, via Kubisiak & Rolley 1998) [S]:
  - Minnesota pine held 1.1 drummers per 40 ha, against 7.3 in 15–20 yr
    aspen.
  - 14–18 yr pine plantations with aspen saplings throughout held 4.5
    (Gullion 1990).
- **Survival** [S, via FEIS]:
  - males in pure hardwood lived 19.3 months, against 12.6 in closed pine
    (P < 0.025);
  - canopy over about 60%, especially conifer, may raise raptor kills.
- **Fir with aspen is fine** [S]. Stone Lake's balsam fir habitats held the
  most drummers, and about half of that fir had aspen in it (TB 118).
- **Northern Wisconsin** [G] (Dorney 1959): ground without conifer still
  held 5.8 cocks per 40 ha, against 5.4 with conifer.
- **In winter, mixedwood with about 50% conifer is good habitat**
  (Blanchette et al. 2007, above).
- **Black spruce and open marsh** were "essentially unused" (TB 118).
  ABMI gives black spruce 0.05.
- **Alberta pine cuts** [S]: no ruffed grouse were seen in the unscarified
  pine clearcut in any of 32 years (Stelfox 1988).

[I] So the conifer share is a multiplier:
- full value to about 30%;
- slightly less from 30% to 60%;
- sharply less above 60%.

Pure black spruce and tamarack are near zero for ruffed grouse. They belong
to the spruce grouse.

### Alder, hazel and the wet edge [S]

- **Aspen-alder was the best Wisconsin type** (TB 118).
  - "Use of alder was always near an adjacent forest type."
  - At Stone Lake, alder was second best, at 1.8 drummers per 40 ha.
- **Brood cover:**
  - a Wisconsin study had broods in lowland alder "almost exclusively";
  - Minnesota brood sites were usually dense alder (via FEIS);
  - in summer, Wisconsin birds used lowlands 67% of the time, where
    lowlands made up 16% of the area (Small & Rusch 1989).
- **Heat:** on hot mornings, broods fed on the upland and moved into alder
  for the heat of the day (Dorney 1959) [G].
- **Alder is cover, not food.** No source found ranks alder catkins as a
  meaningful grouse food.
  - Hazel catkins do rank: second to aspen in Minnesota, and first in
    deep, crusted snow (Gullion & Svoboda 1972).
  - The FRI 1999 model reaches the same view.
- **Correction:** `HUNT-FISH-SCIENCE.md` lists alder among the fall foods.
- **Riparian buffers in Alberta** (Hannon et al. 2002, via FEIS): breeding
  evidence in 200 m buffers, none in narrower ones.
- **BC** (BC atlas): nests are usually near water, in forest with some
  deciduous trees.

### Fall food, movement and the shuffle

- **Food by date:**
  - **September:** soft fruit and green leaves. Alaska lists blueberry,
    highbush cranberry and rose hips [G, ADF&G]. Alberta lists highbush
    cranberry, red-osier dogwood and rose (FRI 1999). On Appalachian forest
    roads, crops held clover, cinquefoil and strawberry leaves (Harper et
    al.; March data) [G].
  - **Switch to buds:** in Minnesota, aspen buds and catkins are the top
    food from mid-October (FEIS). Alaska birds switch "by late October"
    (ADF&G) [G].
  - **Earliest bud feeding:** 30 September, by a 13-week-old male. Buds
    from preferred clones had 14.2% protein, against 10.9% in clones never
    used (Gullion & Svoboda 1972).
  - **Feeding trees:** Alberta trees averaged 36 yr (20–80; Doerr et al.
    1974), and the best winter food is deciduous trees over 10 m tall (FRI
    1999).
- **Fall ranges are bigger** [S]:
  - Missouri fall–winter home ranges were 104 ha, against 67 ha in spring
    and summer;
  - daily movement was 392 m against 263 m;
  - survival fell as movement rose (Thompson & Fritzell 1989, via FRI and
    FEIS).
- **Adults stay put** [S]:
  - of 60 Alberta males taken in fall, only one was over 800 m from its
    breeding site (Rusch & Keith 1971, via FEIS);
  - Maine males stay within 400 m [G].
- **The fall shuffle** (Small & Rusch 1989, Auk 106:72; central Wisconsin)
  [S]:
  - Juveniles disperse "primarily from late September to mid-October":
    males start 25 Sept ± 2 days, females 4 Oct ± 4 days.
  - Net distance: females 4.82 km, males 2.14 km. Paths are 9.56 and 6.36
    km, over 17 and 21 days.
  - 29% moved in more than one step, and direction was random.
  - Habitat selection was "substantially less" while dispersing.
  - Broods start breaking up about 7–8 Sept, and juveniles are over 80% of
    the fall population (Kubisiak 1985, WDNR Report 136) [G].
- **Fall drumming:** males drum again in autumn as the young disperse
  (Hinterland Who's Who; ADF&G) [G]. Time of day and weather are not
  documented.
- **Fall density is several times spring's** [S, FEIS Table 4]. In the
  boreal: 1.4–10 birds per 40 ha in spring, against 25–29 in fall, and 55
  or more at cycle peaks.

### Region notes

- **BC** [S] (BC atlas, Chutter 2015):
  - elevation 5–1,697 m, "highest abundance between 750 and 1,250 m";
  - most abundant in Sub-Boreal Pine–Spruce, then Sub-Boreal Spruce;
  - riparian forest loss is the main concern.
- **Cottonwood** [S, via FEIS]:
  - in Idaho and Montana, grouse were most common in cottonwood/aspen and
    riparian shrub;
  - in western Washington, 70% of drumming logs had a black cottonwood
    within 50 m.
- **Yukon** [S] (Martin et al. 2001, Kluane):
  - ruffed grouse were "confined to patchily distributed aspen-dominated
    stands";
  - they made up 9% of forest-grouse detections;
  - they nearly vanished at the cycle low (1991–93).

  Score them only where aspen or balsam poplar is mapped (already in the
  northern note).
- **Alberta foothills:** see the Clearwater notes:
  - ABMI's stand table;
  - FRI's winter model;
  - Stelfox's 32 yr of clearcuts;
  - roughly 9 ruffed grouse taken for each spruce grouse.

## 4. Spruce grouse

### Jack pine against black spruce [S unless marked]

- **Ontario: young jack pine holds the most birds on the continent.**
  - Szuba & Bendell 1983 and Keppie 1995, via the AFWA Spruce Grouse
    Continental Conservation Plan (Williamson et al. 2008) [G reviewing S]:
    - jack pine 11–32 yr: 12–80 birds per 100 ha;
    - jack pine 10–25 yr: 40–80;
    - black spruce: 0–30.
  - The plan's own words: "Highest population densities (9–80 adults in
    summer/100 ha) are found in Ontario in jack pine plantations specially
    where trees are 10–25 years old and 4–10 m tall."
  - The densest are aerially seeded jack pine flats in east-central
    Ontario, with trees only 3–8 m tall.
- **Ontario Breeding Bird Atlas** (account by K. Szuba) [S]:
  - densities are greatest "in young Jack Pine forests about 4–7 m tall
    with a thick carpet of blueberries, Trailing Arbutus, and other
    ericaceous plants";
  - up to 50 birds/km² or more;
  - "Populations of the Spruce Grouse do not cycle" (Sandilands 2005).
- **Decline with height.**
  - Eastern jack pine loses value once trees reach 10–12 m, at about 30–45
    yr.
  - Spruce stands "can retain value longer because of persistent low live
    branches" (Keppie 1995, via the Vermont recovery plan [G]).
  - New York: pine is usable only while under about 12 m. Mature fir
    self-prunes and drops out, while mature spruce stays useful (NY DEC
    2025 assessment [S]).
- **Spruce mixed into pine helps.** Mixing 10–15% black spruce evenly into
  jack pine plantings keeps them in use longer (Szuba & Bendell 1983, via
  Michigan's MNFI [G]). In Alberta, "even a few shade-tolerant conifers"
  raise lodgepole's value (Schroeder & Boag 1991, in the Clearwater note).
- **Black spruce matters more outside Ontario's jack pine flats:**
  - **Wisconsin:** birds used mature black spruce–tamarack swamps and jack
    pine 16–29 yr. 18 of 25 nests were under black spruce (Anich et al.
    2013, via MN DNR).
  - **Minnesota:** jack pine uplands in winter, black spruce bogs for nests
    and summer. Where there was no jack pine, birds stayed in the black
    spruce lowland all year (Pietz & Tester 1982).
  - **Quebec:** the atlas ties the bird to black spruce and mature conifer.
    It was found in 28% of squares in the fir–birch and spruce–moss domains
    (2010–14). Ferron (pers. comm., via AFWA) thinks Quebec black spruce
    holds densities "perhaps at least as high as in jack pine" (expert
    opinion).
- **Lodgepole (Alberta):** use from 10 yr, a peak of 24 birds per 100 ha at
  30 yr, decline from 40 yr (Boag & Schroeder 1987; in the Clearwater
  note). Near Hinton, the first birds appeared in pine cuts at 17–27 yr
  (Stelfox 1988).

[I] **Ontario's spruce grouse rule should key on jack pine by height.**
- Peak at 3–8 m.
- Shoulder to 12 m.
- Low beyond 15 m.

Black spruce and tamarack hold a steadier, middling value at any age past
about 20 yr. In Quebec and the west, give black spruce more weight.

### Structure: dense, low branches, little hardwood [S]

- **Stem density and live crown:**
  - birds pick stands of 2,500–3,500 stems/ha with a well-developed
    midstory and live crown over 50% of tree height (Boag & Schroeder 1992,
    via AFWA [G]);
  - over half of Washington Franklin's grouse sites had their lowest live
    limbs at 1.5–4.5 m (Ratti et al. 1984);
  - New York defines cover as "live branches from 0–4 meters above ground
    level, or sufficient tree density".
- **Minnesota 2019–22** (107 radio-marked birds, pellet surveys, LiDAR):
  - Occupancy was best explained by LiDAR mid-canopy density at 5–15 m
    (positive) and deciduous land cover (negative).
  - Local extinction rose with deciduous cover and with road density.
  - "Forest structure may be a stronger determinant… than stand type"
    (Roy, Ponder & Aylward, MN DNR 2023).
- **Thinning:** Quebec commercially thinned stands had 39% occupancy
  against 60% in uncut stands. The authors put it down to lost lateral
  cover (Lycke, Imbeau & Drapeau 2011, CJFR 41:501; abstract).
- **Shrubs:**
  - female density rose with low shrub and herb cover, but fell where
    mid-to-tall shrubs topped 40% (Naylor & Bendell 1989, via AFWA);
  - dense deciduous shrub over 40 cm is poor habitat (Vermont plan).

### Clearcuts, strips and patch size [S]

- **Quebec residual strips** (Potvin & Courtois 2006):
  - Setting: strips 51–132 m wide in landscapes about 70% cut.
  - Males were absent from the clearcut patches and present in half the
    strips, at 3.3–15 males per 100 ha.
  - Occupied strips were wider, with a lower canopy and denser shrubs.
  - The authors recommend residual patches over 25 ha and strips over 80 m
    wide.
- **After cutting** (Turcotte et al. 2000):
  - birds moved less than 200 m into nearby residual forest;
  - home ranges grew from 13–33 ha to 23–41 ha;
  - survival fell from 0.75 to 0.44;
  - uncut black spruce–jack pine held 5 males per 100 ha.
- **Minnesota harvest response:** birds were rarely in stands due for
  harvest even before cutting, because mature stands lacked midstory. Their
  home-range overlap with harvest areas fell from 81% to 56% and from 41%
  to 16% (LCCMR final report).
- **Patch size:**
  - under 4 ha is too small; the smallest known occupied patch is 8 ha
    (Alberta HSI, in the Clearwater note);
  - patches over 11 ha were usually occupied (Maine, Whitcomb et al. 1996);
  - in 2017, occupied Maine stands averaged 82 ha and unoccupied ones 14 ha
    (Gilbert & Blomberg 2019);
  - in New York, occupancy fell sharply below 100 ha.
- **Edges (BC subalpine, winter pellets; Huggard 2003):**
  - use fell within 10 m of recent openings (0.1–10 ha) and within 20 m of
    older large openings;
  - near wetlands, use peaked 20–35 m from the edge;
  - birds preferred knolls.

### Fall food, grit, snow and tameness

- **Food:**
  - Central Ontario fall crops held about 51% jack pine needles, 36%
    tamarack needles, 8% blueberry leaves and 2% fungi by volume (Crichton
    1963, via MNFI [G]).
  - Tamarack needles are taken until they drop, as a bridge to the winter
    diet. Quebec's woodlot guide says to protect tamarack for that reason
    (FFQ fascicle 3 [G]).
  - Juveniles do not eat needles until October; by November needles are
    their main food (unverified, Animal Diversity Web).
- **Snow:**
  - with snow on the ground, needles are 99% of the diet (Pendergast &
    Boag 1971, in the Clearwater note);
  - snow roosts need at least 10–13 cm of snow (Kueber 1973, via the
    Vermont plan [G]).
- **Grit:**
  - From late August, birds come to "stream sides, lakeshores and roads in
    early morning to secure grit"; hunters target "clear frosty mornings"
    (ADF&G [G]).
  - In fall 2020, Minnesota researchers "marked 22 spruce grouse as they
    came to roads for grit" (LCCMR final report [S]).
  - One Kenai hunter took 273 birds in a season along roads (Ellison 1969,
    via AFWA).
  - No study times the grit visits by the hour.
- **Dispersal and migration:**
  - In central Ontario, 92% of females and 74% of males dispersed from the
    brood range (Beaudette & Keppie 1992, via AFWA).
  - Michigan juveniles moved 3.7–5 km (unverified).
  - Alberta migrants moved 0.5–9.5 km to winter sites, with females
    arriving around 14 Oct (Herzog & Keppie 1980, in the Clearwater note).
- **Tameness:** birds let people come within a few metres and freeze rather
  than flush ("fool hen"). They "are easily missed by hunters not using
  dogs" (AFWA).
- **Harvest:**
  - central Ontario estimates run 5–15% of the population (Bendell et al.
    1983), and hunters took 0.5–0.9 birds a day;
  - ruffed grouse outnumbered spruce grouse in mixed bags by 2–6 to 1
    (AFWA);
  - Alberta's reported harvest is about 9 ruffed grouse to 1 spruce grouse
    (ACA, in the Clearwater note).

### BC and the Yukon [S]

- **BC atlas** (Chutter 2015):
  - records span 293–1,738 m, and the bird is known to 2,500 m;
  - most likely in the Northern Boreal Mountains and Sub-Boreal Interior;
  - Canada subspecies in the north, Franklin's in the southern two-thirds;
  - BC takes 32,000–58,000 a year, 25–30% of its upland bird harvest.
- **Franklin's grouse** use lodgepole mixed with Engelmann spruce and
  subalpine fir. Dry lodgepole holds few birds (AFWA). Captive birds would
  not overwinter on spruce alone (unverified, Hohf et al. 1987).
- **Yukon:**
  - at Kluane, spruce grouse were about 85% of the forest-grouse biomass;
  - in winter they fed only on white spruce needles, from favoured trees
    (Martin et al. 2001);
  - harvest "largely occurs near towns, settlements, and close to roads"
    (AFWA).

## 5. Sharp-tailed grouse, dusky and sooty grouse, ptarmigan

### Sharp-tailed grouse

- **Ontario's northern birds are fen and cutover birds** [S]:
  - The Ontario atlas (Escott) calls them "permanent resident in the
    muskegs of northern Ontario… uncommon and local in the scattered fens
    of the Canadian Shield".
  - "In the Boreal Forest, cutovers and burns can provide temporary
    suitable habitat." Shield squares lost between the atlases were put
    down to forest regrowth.
- **Escott 2003** (Ontario Birds 21:2; Geraldton–Longlac) [S]:
  - fall birds appear "in clearcuts and upland areas… sporadic and do not
    occur every year";
  - a 1993 lek of 15 males stood in a jack pine plantation cut, until "the
    trees are now tall enough to make the site unsuitable";
  - fen leks have "few if any shrubs" and are ringed by black spruce,
    tamarack and cedar, and alarmed birds "fly back into the spruce woods";
  - upland birds feed on white birch buds and catkins;
  - irruptions came in 1896, 1932–33 and 1967–68, when birds were shot
    near White River and the season ran to the end of March.
- **Winter food:** dwarf birch buds and catkins were 90% of stomach
  contents at Winisk (Thomas 1984). Paper birch is the main winter food in
  Ontario and Wisconsin (FEIS) [S].
- **Quebec:** mainly in the Abitibi lowlands, east to Chapais–Chibougamau,
  in "tourbières, des brûlis et des zones de coupe forestière en
  régénération" (bogs, burns and regenerating cuts). Found in 12 atlas
  squares in 1984–89 and 35 in 2010–14 (Quebec atlas) [S].
- **BC, Columbian sharp-tail in clearcuts** (Ritcey & Jury 2004, BC
  Identified Wildlife) [S/G]:
  - "Roadsides and landings with abundant greens… are heavily used" in
    fall;
  - shrub fens with scrub birch are the winter habitat;
  - lek counts fell from 18 to 10 birds as regrowth closed the cutblocks
    (1993–2000);
  - most nests lie within 1.6 km of the lek.
- **Openness** [S]:
  - woody cover rarely tops 30% at leks (FEIS);
  - Michigan's best mix had about 20% woody cover and clearings of about 4
    ha (Ammann 1957, via MNFI) [G];
  - Minnesota managers want open blocks of 5 km² or more, disturbed every
    5–10 yr, with shrubs at 10–38% (Minnesota Sharp-tailed Grouse Society
    plan) [G].
- **Snow:** Wisconsin birds left their flocks to burrow once snow passed 18
  cm, and Montana birds moved into hardwood draws past 14 cm (FEIS) [S].
- **Fall:**
  - fall numbers run 100–300% above spring (Gregg 1990, Wisconsin) [S];
  - males display at leks in autumn too (FEIS);
  - fall birds near the Sault are pairs and small groups (median 2–3 a
    record in Sept–Nov, up to 30), with winter flocks to about 70 [D, GBIF];
  - Hanson 1953: fall movements are "seeking heavier timber cover in
    advance of the winter".
- **Cycles:** ADF&G says the swings are rarely the "classic 10-year cycle".
  Minnesota's lek counts were 15.3 birds a lek in 2024, 12.0 in 2025 and
  11.9 in 2026.

[I] In the app's areas the sharp-tail is an edge bird:
- a fen, a young cut or a burn of 2–10 yr with open ground;
- near spruce for escape;
- near birch for winter buds.

No source gives a years-since-cut threshold. The 8–12 yr cut-off below is
inferred from the regrowth reports.

### Dusky and sooty grouse

- **Dusky grouse go up for winter** [S]:
  - In Colorado, males moved a median 488 m upslope and 10.5 km, and both
    sexes reached winter range in mid to late October (Cade & Hoffman 1993,
    in the northern note).
  - Winter birds used Douglas-fir, preferring large trees of 20–90 cm dbh,
    in dense second growth and mature or open old growth (Cade & Hoffman
    1990, JWM 54:471).
  - Utah day roosts were in the largest Douglas-firs and night roosts in
    subalpine fir. "Wind speeds were reduced by 63 and 85%" at day and
    night roosts (Pekins 1988).
- **Early fall** [S]:
  - in Oregon, late August to September, birds used "bunchgrass ridges…
    dissected by draws that are timbered on the north-facing aspect";
  - grasshoppers were 46% of crops by frequency (Crawford et al. 1986).
- **Washington** [G] (Ware 1998):
  - birds keep the same winter sites year to year;
  - managers keep "mature, mistletoe-laden Douglas fir thickets near
    ridges".
- **Montana** (spring) [S]: use rose with trees 16–20 m tall and with
  Douglas-fir, and fell with trees 1–5 m tall (Leipold et al. 2024).
- **Alberta** [S]: juveniles were 40% of the fall population (Boag 1966).
  Chick survival sets fall numbers, not spring numbers (Zwickel & Bendell
  1967).
- **Blanchard River** [D, GBIF; CDEM elevation at each record]:
  - dusky records within 150 km had a median of 1,261 m in August and
    1,340 m in September (1,073–1,824 m);
  - the Yukon's few August records near Highland Lake were at 470–955 m,
    which does not fit an upslope-only model.
- **Sooty grouse** [S/G]:
  - coastal, from Haines south (ADF&G);
  - August–September on berries in "alpine meadows near timberline", and
    "by November" at slightly lower winter range;
  - on Vancouver Island, females and broods left the lowlands by the end of
    September (Fowle 1960);
  - in coastal clearcuts the birds persist "until forest canopy approaches
    75% coverage" (Zwickel & Bendell 1985).
- **Telling them apart** at Chilkat Pass is unreliable. Northern sooty
  grouse can show the red skin, and the sooty hoot carries about 1 km
  against about 100 m for the dusky (Schroeder et al. 2009) [S].

### Ptarmigan: what is new beyond the northern note

- **Blanchard River elevation by month** [D, GBIF; road-biased: the Haines
  Road runs at about 900–1,070 m]:
  - **willow:** median 1,222 m in September (886–1,685 m), 939 m in
    October, 896 m from December to March;
  - **rock:** about 1,550 m in August–September, 1,430 m in October;
  - **white-tailed:** 1,624 m in September, 1,141 m from December to March.
  - Willow flocks: median 4 in September (up to 169), 9 in October.
- **White-tailed in winter** [S]:
  - Colorado females wintered "near or at treeline where dense, tall stands
    of willow grow", and males in krummholz higher up; flocks were 20–30
    females, or under 15 males (Hoffman & Braun 1977);
  - at feeding sites, willow stood 8–28 cm above the snow;
  - snow there was 40 cm deep in March, against 85 cm at random sites,
    thinned by the wind (Giesen & Braun 1992).
- **Chilkat Pass swings** [G]: territorial willow cocks on the same 2 km²
  at Haines Road mile 75 numbered 75, 141, 150, 104 and 43 in 1960–64 (ADF&G
  1964).
- **Rock ptarmigan** (Eagle Creek, Alaska) [G]: hunters recovered 16% of
  banded cocks against 5% of hens, because hens "migrate to other areas in
  October" (ADF&G 1964).
- **Quebec irruptions** [S/G]:
  - The Quebec atlas reports regular winter incursions into the north-shore
    back country, "tous les 10 ans environ" (about every 10 years). Hunters
    "le traquent le long des routes forestières enneigées" (track it along
    snowy forest roads).
  - The species sheet says the migrants are mostly females and young, on an
    8–12-yr cycle, in flocks of several hundred.
  - Birds spend up to 17 h a day under the snow. They choose denser shrub
    out of the wind and avoid rocky ground and steep slopes.
  - Records within 250 km of Lac Bailey show big winters in 1990–91,
    1999–2000, 2010–11, 2023–24 and 2024–25, and almost none in 2025–26.
    The first birds came between 19 November and early December [D].
- **Hunting** [H] (Outdoor Canada): flushed ptarmigan "fly low… usually
  settle within a 100 metres or so", so the same group can be worked again.
  Birds near access points flush long before you are in range.

## 6. The day: time, weather and snow

### Time of day [S]

- **Radio-tagged hens** (Maxson 1977, Wilson Bull. 89:439; Minnesota,
  April–July):
  - activity began 30–60 min before sunrise and stopped 15–45 min after
    sunset;
  - "the evening peak was greater than the morning peak for all hens";
  - daytime activity "seldom fell below the 50% level".
- **November:** Pierson & Tester saw the same lower dawn peak in birds of
  both sexes (unpublished, cited by Maxson). The peaks are feeding bouts.
- **Winter:**
  - Without snow to burrow in, birds left the roost about 30 min before
    sunrise. They were "inactive from mid-morning until mid-afternoon",
    especially in March (Brander 1965, via Maxson).
  - Alberta birds fed for about 16 min before sunrise and 24 min near
    sunset (Doerr et al. 1974, via Heinrich 2017; the wording is garbled in
    the secondary source).
  - Virginia birds, short of food, were active over 5 h a day and "not
    strongly crepuscular" (Hewitt & Kirkpatrick 1997).
- **Weather in the Tennessee mountains** (Pelren 1991, thesis): "movement
  was depressed by high and low temperatures and heavy cloud cover".
- **Spruce grouse** fill the crop with needles at the end of the day
  (unverified, a secondary account).

[I] The app's grouse hours borrow the moose rule:
- 1.0 from 30 min before sunrise to 3 h after, and from 3 h before sunset;
- 0.6 mid-morning;
- 0.3 midday.

The dawn window matches the spring drumming-count protocol (Jones et al.
2005; Minnesota's routes run at sunrise), not fall feeding. The fall rule
should:
- weight the last 3 h of light highest;
- weight dawn a little lower;
- keep midday at about 0.75, falling to 0.4 only on snow-roost and hard-cold
  days.

### Wind, rain and cloud

- **The wind cut-offs in the literature are about hearing.**
  - Drumming counts are cancelled above 13 km/h because observers cannot
    hear well (Petraborg et al. 1953, in Jones et al. 2005) [S].
  - Minnesota runs routes "on days that had little wind and no
    precipitation" [G].
  - Kluane skipped censuses with "falling snow or moderate to high winds"
    [S].
- **What wind does to the birds:**
  - long cold, windy spells push birds into thick conifer (Hinterland Who's
    Who [G]);
  - in Quebec winters, snow burrows were more likely in moderate wind, and
    tree roosts in calm (Blanchette et al. 2007, Can. J. Zool. 85:497, via
    FEIS [S]).
- **Nothing found** measures wind's effect on how far grouse flush or how
  wild they are, or on a dog's scenting.
- **Rain:** the only measured data are spring incubation. Hens waited out
  storms and fed once the rain stopped (Maxson). Pelren's abstract does not
  list rain as slowing movement.
- **Cloud:** heavy cloud slowed movement in Tennessee (Pelren). This weakly
  contradicts the app's overcast-midday bonus.
- **Hunter press** [H] agrees that wind makes birds flush wild and hard to
  hear. That is a hunter's problem, not a change in where birds sit.

### Cold, first snow and snow roosts [S]

- **Lower critical temperature:**
  - −0.3 °C overall: −6.0 °C in February, +0.3 °C in March;
  - standard metabolism 46 kcal a day for a 644 g bird (Rasmussen &
    Brander 1973, Wilson Bull. 85:223).
- **Soft-snow depth for roosting:**
  - Gullion & Svoboda: grouse need 20 cm (8 in) of soft snow to roost in.
    Snow gets deep enough earliest in aspen and hardwoods, and may never do
    so under closed conifer.
  - The Ruffed Grouse Society says 25–30 cm [H].
  - Wisconsin stress hormones were "high when snow was shallow, but
    decreased rapidly as snow depth increased beyond 20 cm" (Shipley et al.
    2019, Oecologia 190:309).
- **Maine** (Heinrich 2017):
  - night roosts were 2–4 m up in dense conifer;
  - birds stayed in conifer through the first ~15 cm of snow;
  - "after 40 cm of snow depth, they dove into the snow in flight in open
    areas of deciduous forest";
  - they went back to conifer once the snow crusted.
- **Roost energetics** (Thompson & Fritzell 1988; unverified ratio): heat
  loss in conifer was about twice that in a snow roost, and about a third of
  that in open deciduous cover.
- **Without snow:** grouse "almost invariably roost in conifers" (Whitaker
  & Stauffer 2003; abstract).
- **Quebec roosts:** 36% in snow burrows, 41% in trees and 22% on the snow
  surface. Burrowing rose with snow depth (Blanchette et al. 2007).
- **Hard winters:** a good one has "soft, deep snow that lasts". A crust,
  or long cold and wind, pushes birds into thick conifer (Hinterland Who's
  Who [G]). A Fairbanks crash in the early 1990s was put down to no snow
  plus extreme cold (ADF&G [G]).
- **Spruce grouse** roost in snow from 10–13 cm, under spruce boughs or in
  burrows (§4).

### Sun, aspect and frost

- **Unsupported:** no source measured grouse on south slopes or sunning on
  roads on cold mornings. The one mention is in an industry HSI: "Grouse
  frequent roads to sun themselves on cool mornings and evenings"
  (Millar Western 2000, in the Clearwater note).
- **Pennsylvania** (Storm et al. 2003): fall flushes were higher on slopes
  and upper elevations, away from the grassy frost pockets beside the main
  road [S].
- **Quebec winter:** birds selected mid-slopes (Blanchette 2007).
- **The frost note:** "after a hard frost birds move to edges and roadside
  gravel" has no evidence either way. Keep it as [H].
- **The front factor:** `activityVerdict`'s ×1.15 for a 24 h temperature
  drop applies to grouse too. Nothing was found to support it for grouse.
  Set it to 1.

### The dispersal window

From about 10 September to 20 October, and most of all 25 Sept–15 Oct,
young birds are on the move. They turn up in odd places and choose habitat
less (Small & Rusch 1989). [I] Soften the habitat contrast in that window,
and say "young birds in odd places" in the verdict.

## 7. Roads, trails, hunters and dogs

### Where grouse are shot [S/G]

- **Wisconsin, banded birds** (Kubisiak 1985, WDNR Report 136):
  - 97% at Sandhill and 96% in Wood County were shot within 800 m of a
    drivable road;
  - in Wood County, 74% fell within 400 m of a road, a band covering 43% of
    the area;
  - beyond 800 m fell 5% of birds, from 21% of the area;
  - "little hunting occurred more than 800 m from driveable roads";
  - the estimated Sandhill harvest rate was 65%, and over 40% sustained for
    2+ years is expected to cut breeding numbers.
- **Alberta** (Fischer & Keith 1974, via Millar Western):
  - The source's figures are 48%, 13%, 5% and 1% for banded males within
    about 100 m of a road, at 100–200 m, at 200–300 m and beyond.
  - The four sum to 67%, so they read as the share of each band's males
    that were shot, not as a split of the bag [I]. On that reading, almost
    half the drumming males beside a road were shot, against 1 in 100 past
    300 m.
  - The original was not read.
  - Fischer & Keith found hunting had "little or no effect" on the next
    year's breeders (as summarised by Kubisiak 1985).
- **Survival:** grouse living within 1,000 m of a road or trail lived 9.1
  months, against 16.3 farther out (Gullion 1983, via McCaffery et al. 1996
  [G]).
- **Timing:**
  - about 75% of hunting effort came by the end of week 3, and 86% of the
    harvest by the end of week 4 (Stone Lake, Wisconsin);
  - at Mille Lacs, Minnesota, 68% of the harvest came in the first 4 weeks
    of a 14-week season (McCaffery et al. 1996, TB 189);
  - in Maine, October harvest was double that of November and December
    combined (Davis et al. 2018; via press).
- **Is harvest additive?**
  - New York: under 11% of radio-marked birds were shot; predators caused
    62–91% of deaths (Skrip et al. 2011).
  - North Carolina: hunting caused 11% of deaths (Jones et al. 2008).
  - Wisconsin: harvest was additive where it reached 28% of all deaths
    (Small, Holzwart & Rusch 1991, cited by Skrip).
  - So near-road depletion is real where pressure is heavy, and slight
    where it is light. [I]

### Walking, trails and dogs [G]

- **Flush rates by method** (McCaffery et al. 1996, TB 189; Stone Lake,
  1982):

  | Method | Flushes per party-hour | Birds bagged per hour |
  |---|---|---|
  | Road-hunting from a vehicle | 0.14 | — |
  | Walking, no dog | 0.50–0.61 | 0.03 |
  | Walking, with a dog | 0.37–0.52 | 0.12 |

  - With a dog, about 24% of flushes ended in the bag, against about 5%
    without (arithmetic from the bulletin's totals).
  - The low no-dog rate "may have been caused… by grouse flushing from
    trails well ahead of hunters".
- **Clover trails:**
  - exploitation was "disproportionately higher" in years when trails were
    seeded with clover and mowed;
  - road-hunters fell from 43–45% of hunters to 5–20% once walking trails
    were built (TB 189).
  - Minnesota's 49 Ruffed Grouse Management Areas carry 184 miles of
    walking trails, some mowed or seeded, and get "considerable hunting
    pressure" (MN DNR).
- **Grouse use roads and trails:**
  - Appalachian females selected roads and trails, more after poor mast
    years (Whitaker et al. 2006, via FEIS) [S];
  - in March, over 90% of 326 crops taken on Appalachian forest roads held
    herbaceous leaves (Harper et al.) [G];
  - Quebec broods were closer to roads than random points (Giroux 2007)
    [S];
  - but in Wisconsin, unseeded woods trails were unrelated to where males
    drummed (TB 118) [S].
- **Flush distance:** in a Kentucky spring strip census with leaves off, 32
  flushes ran 6–64 m, median about 15 m (Hardy 1952) [S]. No fall,
  early-against-late, or hunted-against-unhunted data were found.
- **Dogs double the rate:**
  - in Quebec's Portneuf network, hunters with dogs saw 0.44–1.31 grouse an
    hour, against 0.22–0.50 without (2013–18);
  - Michigan's 2025 cooperators: about 1.2 flushes an hour with dogs and
    1.0 without.

### What this means for the app [I]

- **The +0.25 within 40 m of any road or trail** combines three things:
  - a real bird effect: grit, clover and the trail edge at first and last
    light;
  - a sighting effect: a bird on a trail is seen, and one in the thick is
    heard;
  - the access effect, which the `access` part already scores.

  Cut it to a small term:
  - only beside young and mixed cover;
  - only on unpaved roads and trails;
  - mostly at first and last light, before snow.
- **Add a season-wear term:**
  - from week 4 after the opener, cells within 400 m of a drivable road
    lose a little;
  - cells beyond 800 m gain a little.

  This is the one place where a long walk in is worth it for grouse.
- **The scent part should be neutral for grouse.** Grouse are found by eye
  and ear, and a moose's feeding side means nothing to them. If the user
  hunts with a dog, the wind becomes advice ("work into the wind"), not a
  cell score. That needs a dog setting.

## 8. Cycles: a high year or a low year

### What cycles, and how much [S]

- **Ruffed grouse** cycle about every 10 yr (8–11) in Canada, Alaska and
  the Great Lakes states. They do not cycle in the south and east (FEIS;
  Keith 1963).
- **Mean peak years across the north** (Archibald 2014, Can. Field-Nat.):
  1950, 1960, 1971, 1980, 1989, 1998 and 2007.5, a period of about 9.4 yr.
- **Peaks in Minnesota** came in 2009, 2017 and 2024, and **lows** in 2005,
  2013 and 2021 (MN DNR).
- **Spruce grouse:**
  - no cycle in Ontario (Ontario atlas, Sandilands 2005);
  - no tracking with hares in northern Ontario (Bendell and Keppie, via
    Martin et al. 2001);
  - in the Yukon they cycle with the hares (Kluane).
- **Dusky and sooty grouse** "generally do not" cycle (Martin et al. 2001).
- **Ptarmigan:** 8–11-yr cycles in Canada, tracking the hares at Kluane and
  Chilkat Pass (r = 0.76–0.84). ADF&G calls 10-yr cycles "more legend than
  proven fact in Alaska".
- **The hare lead:**
  - At Kluane, forest grouse peaked about a season before the hares and
    declined a year ahead of them (r = 0.89). Willow ptarmigan lagged the
    hares by a year.
  - The mechanism is predators switching from hares to grouse. Grouse body
    condition and clutches did not fall (Martin et al. 2001).
  - Ruffed grouse declines in Alberta came from heavy summer predation on
    juveniles, a year ahead of the hares (Keith & Rusch, via Martin).
- **Swing from low to peak:**

  | Measure | Low | Peak | Ratio |
  |---|---|---|---|
  | Minnesota drums per stop | 0.8 (2005), 1.3 (2021) | 2.1 (2009), 2.3 (2024) | 1.8–2.6× |
  | Minnesota harvest | about 207,000 (2021) | about 340,000 (2023) | about 1.6× (unverified) |
  | Portneuf, Quebec, grouse seen per hour | 0.26 (2016) | 0.95 (2010) | 3.1–3.7× |
  | Kluane forest grouse per 10 ha | 0.28 | 3.33 | about 12× |
  | Kluane spruce grouse winter encounters | 1.9 per 100 h | 10.9 per 100 h | 6× in two winters |

### The 2026 phase, by region

| Region | 2026 phase (best guess) | Evidence | Confidence |
|---|---|---|---|
| NW Ontario (Pickle Lake) | Falling, two years past the 2024 peak, still mid to high | No Ontario data. Next door in Minnesota, the Northeast ran 2.7, 2.0, 1.9 drums per stop over 2024–26, and DNR calls it "clearly in the declining phase". Wisconsin's north peaked in 2024. | Low to medium |
| NE Ontario, Sault (Searchmont, Whitefish) | Falling or low | Michigan DNR says the state is "in a trough" (2025 cooperators, about 1.0–1.2 flushes an hour). Wisconsin statewide drumming fell 11% in 2026. | Low |
| Quebec (Lac Bailey, Duhamel) | Probably low, or early in the rise | Portneuf peaked in 2010 and hit "le bas du cycle" (the bottom) in 2016. A 9–10-yr period puts a peak around 2019–21 and a low around 2024–26. Provincial success has been flat since 2015. No current series. | Low |
| Alberta foothills (Clearwater) | Unknown; near peak or early decline if it follows the continent | ACA has no forest-grouse forecast. Alberta hare phase not found. | Low |
| NW BC (Blanchard River) | Grouse at or just past peak; ptarmigan high, falling from 2027 | Kluane hares rose from 2023, peak expected 2025–26. Boutin, May 2025: "one more summer of good breeding, and then, boom". Grouse lead the hares; ptarmigan lag them. | Medium |
| Central Yukon (Highland Lake) | As Kluane | Mayo hares "entered the increase phase" in 2023 with Kluane (CEMP 2023). | Medium to low |

Weather can override the phase for a year or two:
- **Wisconsin, 2023–24:** in 2023 the DNR said the state was "entering the
  down phase". Drumming then rose 57% in 2024 after two dry nesting
  seasons.
- **Quebec (Portneuf), 2002–16:** juveniles per adult hen in the bag rose
  with mean June temperature (R² = 0.66).
- **Minnesota:** heavy June rain cuts chick survival.

### Telling a high year from a low one

- **Spring drumming** (Minnesota method: 4 min per stop at sunrise, stops
  1.6 km apart, calm dry mornings, late April to mid-May):
  - under 1.0 drums per stop is low;
  - 2.0 or more is high.

  Minnesota says its link to the fall harvest "has weakened" in recent
  decades.
- **June weather:** warm and dry from late May to early July means a good
  hatch; a cold, wet June means a poor one (Portneuf R² = 0.66; Minnesota;
  ADF&G).
- **The bag's age ratio** (Portneuf labels):
  - 4 or more juveniles per adult hen, or 70%+ juveniles, is a good hatch;
  - 2.5 or fewer, or about 50% juveniles, is a poor one.

  Juveniles are up to 70% of a fall bag.
- **Flushes per hour** (programs differ in units, and dogs about double the
  rate):

  | Program | Flushes or birds seen per hour |
  |---|---|
  | Portneuf, Quebec, 2002–18 | 0.26–0.95 |
  | Portneuf, with dogs | 0.44–1.31 |
  | Portneuf, without dogs | 0.22–0.50 |
  | Michigan 2025 (a trough) | 1.0–1.2 |
  | New York, long-term mean | 0.90 |
  | Maryland 2015–16 | 0.86 |
  | Pennsylvania, long-term mean | 1.37–1.44 (unverified) |

- **Hares** (the Yukon, northern BC and boreal Alberta only): rising and
  high hares mean grouse at or near their peak. A hare crash means grouse
  already falling. Ptarmigan follow a year later.
- **The hunter's own log** is the best local index: flushes per hour
  against the user's own median, in the same cover, with the same dog
  status.

## 9. Regulations, 2026–27

Every season below was read from the current book on 2026-10-18. The book
is the law: the app should name the edition and say to check it.

| Province, zone | Species | Season | Daily / possession | Licence | Source |
|---|---|---|---|---|---|
| ON WMU 21B, 29, 36 | Ruffed and spruce grouse | 15 Sept–31 Dec | 5 / 15 combined | Outdoors Card + Small Game Licence | ON Hunting Regulations Summary 2026 (eff. 1 Apr 2026), p. 86 |
| ON WMU 21B, 29 | Sharp-tailed grouse | 15 Sept–31 Dec | 5 / 15 | same | same |
| ON WMU 36 | Sharp-tailed grouse | 15 Sept–31 Dec | 2 / 6 | same | same |
| ON WMU 21B, 29, 36 | Ptarmigan | no season (open only in WMUs 1–4, 16–18, 24–27) | — | — | same, p. 87 |
| QC zones 10, 18 | Ruffed, spruce, sharp-tailed grouse | 19 Sept 2026–15 Jan 2027 | 5 / 15 in all (with grey partridge) | Small game permit; residents also need the hunter's certificate | quebec.ca periods (5 May 2026) and limits (16 Jan 2026) |
| QC zones 10, 18 | Willow and rock ptarmigan | 19 Sept 2026–31 Mar 2027 | 10 / 30 in all | same | same |
| QC Papineau-Labelle reserve (zone 10 est) | Ruffed and spruce grouse | 7–20 Sept, 16 Oct–1 Nov, 22 Nov–15 Jan; no small game during the moose hunt, 21 Sept–8 Oct | 5 / 15 | permit + reserve access right | quebec.ca wildlife reserves (18 Aug 2026) |
| AB WMU 324, 326 | Ruffed, spruce and blue (dusky) grouse | 1 Sept–15 Jan | 5 / 15 each | WiN + Wildlife Certificate + game bird licence | 2026 Alberta Guide to Hunting Regulations, p. 63 |
| AB WMU 324, 326 | Ptarmigan | 1 Sept–15 Jan | 5 / 15 | same | same |
| AB WMU 324, 326 | Sharp-tailed grouse | no season (open 1–31 Oct in listed WMUs) | — | — | same |
| BC MU 6-28 | Sooty/dusky, spruce, ruffed grouse | 10 Sept–15 Nov; bow only 1–9 Sept | 10 / 30 aggregate | Resident hunting licence; non-residents also need a $50 upland game bird species licence | BC Synopsis 2026–2028 (eff. 1 July 2026), p. 50 |
| BC MU 6-28 | Ptarmigan | 15 Aug–28 Feb | 10 / 30 | same | same |
| BC MU 6-28 | Sharp-tailed grouse | no season in Region 6 | — | — | same |
| YT GMS 4-09 | Spruce and ruffed grouse | 1 Sept–30 Nov | 10 / 30 combined | Small game or big game licence | Yukon Hunting Regulations Summary 2026–27, p. 25 |
| YT GMS 4-09 | Dusky grouse | 1 Sept–30 Nov | 5 / 15 | same | same |
| YT GMS 4-09 | Sharp-tailed grouse | 1 Sept–30 Nov | 5 / 15 (Zone 5: 2 / 6) | same | same |
| YT GMS 4-09 | Ptarmigan, all species | 1 Sept–15 Mar | 10 / 30 | same | same |
| YT Zone 6, subzone 4-03 | All game birds | closed | — | — | same |

**Compared with `regs.ts`.**
- BC 6-28 and Yukon 4-09 match the 2026 books. The Yukon entry's
  "2026–27" edition is now confirmed.
- BC's non-resident upland bird licence is missing.
- Ontario, Quebec and Alberta have no entries. The Clearwater report has
  the proposed Alberta text.

**Rules a grouse app should say:**
- **Roads.** No province allows shooting on or across a road. The details
  differ:
  - **Ontario:** not from or across "a right of way for public vehicular
    traffic", which includes trails open to vehicles.
  - **Quebec zone 10:** no shooting from a public road, or within 10 m of
    the shoulder's outer edge, or across one. Some areas exempt small game
    with shot, but only on a map not read here. Zone 18 is under none of
    the road bans.
  - **BC:** not within the 15 m road allowance of numbered highways and
    ministry two-lane roads.
  - **Alberta:** not across a provincial highway. A licensed shotgun bird
    hunter may shoot across a graded road.
  - **Yukon:** not on or across the travelled road or its shoulder.
- **Orange:**
  - **Ontario:** small game hunters must wear hunter orange during any gun
    season for deer or moose. In 21B that runs from 10 Oct (deer) and 17
    Oct (moose), so nearly the whole grouse season. In 29 and 36 it runs
    from 17 Oct.
  - **Quebec:** the orange vest is required whenever you hunt.
  - **BC, Alberta and the Yukon:** no rule found.
- **Hours:**
  - **Ontario, Quebec and Alberta:** half an hour before sunrise to half an
    hour after sunset.
  - **BC and the Yukon:** one hour either side.
- **Ontario:** while a big-game season is open, a small game hunter may
  carry no shot larger than No. 2 and no centre-fire rifle, unless they
  hold that season's big game licence.
- **Quebec:** zecs need registration, fees and a catch declaration, and
  may close small game in a sector during the moose hunt. Outfitters with
  exclusive rights need their permission.

## 10. Scoring rules, made concrete

Each rule gives the layer, the threshold, the weight, the source and a
confidence. Values are stand scores on the app's 0–1 scale before the soft
ceiling (`1 − exp(−1.6 s)`); multipliers are marked ×. The weights are
judgment fitted to the sources' shapes [I], unless the row says otherwise.

### Members and how they combine

| # | Rule | Source | Confidence |
|---|---|---|---|
| M1 | The grouse target's members: ruffed, spruce, sharp-tailed, dusky (with sooty), ptarmigan. Each has its own `regs.ts` status and season. The cell takes the best member that is present and open (as bear does). | §2, §9 | high |
| M2 | Member factors for relative abundance: ruffed 1.0; spruce 0.8 in ON, QC and AB, 1.0 in the Yukon and northern BC; ptarmigan 1.0. Sharp-tailed and dusky grouse take their area priors instead (T1, D1). | ON bags 2–6:1, AB harvest 9:1, Kluane spruce 85% of biomass | medium |

### Ruffed grouse (replaces the grouse branch's stand values)

| # | Layer and threshold | Weight | Source | Confidence |
|---|---|---|---|---|
| R1 | Deciduous-led (cover hardwood or mixed, lead aspen or birch, or hardwood ≥30%), by years since disturbance where there is one, else stand age: 0–2 yr / 3–5 / 6–9 / 10–25 / 26–35 / 36–60 / over 60 | 0.2 / 0.35 / 0.75 / 1.0 / 0.65 / 0.55 / 0.5 (pure hardwood over 100 yr 0.4) | TB 118; Gullion & Svoboda 1972; Gullion 1967; ABMI; Pojar; Schieck & Song | high for shape, medium for values |
| R2 | Bud season (from 15 Oct, or the first day with ≥5 cm of lasting snow): aspen-led (lead 7) ≥25 yr and ≥10 m tall | raise to 0.75; birch-led 0.6 | Gullion & Svoboda (6× use, buds from 25 yr); FRI 1999 (36 yr, ≥10 m); ADF&G; FEIS | medium |
| R3 | Conifer share, on any ruffed cell: ≤30% / 31–60% / 61–80% / over 80% | ×1.0 / ×0.9 (×1.0 from 1 Nov with snow under 20 cm) / ×0.6 / ×0.35 | Gullion & Alm; survival 19.3 vs 12.6 months; TB 118; Blanchette 2007 | high for direction, medium for values |
| R4 | Conifer-led stands: white spruce or balsam fir lead with hardwood ≥30% / jack pine with hardwood ≥20% and age 14–30 / other pine / black spruce or tamarack | 0.65 / 0.5 / 0.15 / 0.05 | TB 118 (Stone Lake fir); ABMI white spruce cuts 0.63–0.71; Gullion 1990; Stelfox; ABMI black spruce 0.05 | medium |
| R5 | Regen (cover 9) not known to be deciduous: conifer ≥70% / unknown | as R4 at its age (pine regen 0.15) / 0.4 | Stelfox 1988 (no ruffed grouse in 32 yr of pine cuts) | medium |
| R6 | Shrub (alder): within 60 m of hardwood, mixed or regen and within 100 m of aspen-led stands / more than 150 m from upland forest | 0.85 / 0.45 (now 0.8 flat) | TB 118 ("always near an adjacent forest type"); ABMI open shrub 0.17 | medium |
| R7 | Interspersion: within 90 m there is both deciduous ≤20 yr (or a thick patch) and aspen ≥30 yr | +0.15 (`edge`) | Gullion 1984 activity centres; TB 118 (98% within 40 m) | medium-high |
| R8 | Isolation: deciduous ≤25 yr more than 100 m from any aspen ≥25 yr | ×0.7 | TB 108 (94% of broods within 100 m); Gullion (98% of logs in sight of male aspen) | medium-high [spring] |
| R9 | Eye-level thickness in deciduous and regen: under 0.2 / 0.2–0.5 / 0.5–0.85 / over 0.85 | ×0.6 / ×0.85 / ×1.0 / ×0.95 | stem thresholds 2,000–20,000/ha (TB 118, Gullion, Pennsylvania); Gullion on horizontal cover | medium |
| R10 | The wet edge, replacing "+0.2 within 50 m of water": shrub, mixed or hardwood within 50 m of open wetland, treed wetland or a stream; no bonus for an open lake shore | +0.15 (`shore`); ×1.15 more in September on days over 18 °C | TB 118; Dorney 1959; Small & Rusch (lowlands 67% of summer use); BC atlas | medium |
| R11 | Dense conifer within 60 m of hardwood or mixed (now +0.1 always), gated by the forecast: snow under 20 cm or crusted, and min temp below −10 °C or wind over 25 km/h / soft snow ≥20 cm / otherwise | +0.15 / 0 / +0.05 | Thompson & Fritzell 1988; Whitaker & Stauffer 2003; Hinterland Who's Who; Blanchette CJZ 2007 | medium-low |
| R12 | Burn or cut ≤10 yr with no residual canopy (crown under 10%) | cap 0.2 | Schieck & Song 2006 | medium |
| R13 | BC only, elevation: 750–1,250 m / under 500 / 1,250–1,500 / 1,500–1,700 / over 1,700 | ×1.0 / ×0.9 / ×0.85 / ×0.6 / ×0.25 (`terrain`; under the treeline band) | BC atlas | medium |
| R14 | Yukon and NW BC: ruffed grouse only where aspen or balsam poplar is mapped (lead 7, or hardwood ≥30% with no birch lead) | else 0 | Martin et al. 2001 | medium |

### Spruce grouse (new)

| # | Layer and threshold | Weight | Source | Confidence |
|---|---|---|---|---|
| S1 | Jack pine lead (lodgepole once coded), conifer ≥70%, by stand height, else age: under 2 m (under 8 yr) / 2–3 m (8–12) / 3–8 m (12–30) / 8–12 m (30–45) / 12–15 m (45–60) / over 15 m or over 60 yr | 0.05 / 0.4 / 1.0 / 0.7 / 0.4 / 0.2 | AFWA (Szuba & Bendell 1983; Keppie 1995); Ontario atlas (4–7 m); Vermont plan (decline from 10–12 m) | medium-high |
| S1b | Lodgepole (AB, BC, YT): use from 10 yr, peak 25–40 yr, 0.5 by 100 yr; +0.1 with spruce or fir mixed in | as the Clearwater curve | Boag & Schroeder 1987; Schroeder & Boag 1991; Stelfox 1988 | medium |
| S2 | Black spruce lead, upland: under 10 yr / 10–20 / 20–80 / over 80 | 0.05 / 0.4 / 0.6 / 0.45; ×1.3 in Quebec (cap 1.0) | AFWA; NY DEC; Wisconsin (Anich); Quebec atlas; Ferron pers. comm. | medium (Quebec factor low) |
| S3 | Treed wetland, or tamarack lead | 0.5 (now 0.35) | Anich 2013; Pietz & Tester 1982; NY; Maine | medium |
| S4 | Tamarack lead, or within 100 m of treed wetland, from 15 Aug until the needles drop (about late October) | +0.2 | Crichton 1963 (36% of fall crops); FFQ guide | medium (diet), low (the 100 m and the dates) |
| S5 | White spruce lead / balsam fir lead ≤12 m / fir over 12 m / cedar | 0.6 in the Yukon and N BC, 0.5 elsewhere / 0.5 / 0.2 / 0.3 | Kluane; NY (fir self-prunes); Vermont | low-medium |
| S6 | Mixed (conifer 50–70%) / hardwood-led or aspen, birch lead / regen under 10 yr / open wetland / shrub | 0.3 / 0.05 / 0.05 / 0.1 / 0.15 | MN occupancy (deciduous −); Potvin & Courtois (absent from cuts) | high that deciduous and fresh cuts are poor |
| S7 | Crown closure in conifer: ≥60% / 40–59% / under 40% | ×1.0 / ×0.8 / ×0.55 | Lycke 2011 (39 vs 60% occupancy); MN LiDAR mid-canopy | medium |
| S8 | Within 10 m of an opening under 15 yr old, or of a road clearing | ×0.75 | Huggard 2003 | medium (BC winter) |
| S9 | Eye-level thickness in conifer: ≥0.5 / under 0.2 | ×1.1 / ×0.85 | stem density 2,500–3,500/ha; lateral cover (Lycke) | low-medium |
| S10 | Grit, replacing the flat +0.25: an unpaved road or trail cell, or within 20 m of one, with spruce grouse habitat ≥0.4 within 100 m; snow-free; 25 Aug to the first lasting snow | +0.3 from sunrise to 3 h after; +0.15 in the last 2 h of light; +0.05 otherwise | ADF&G; MN LCCMR (22 birds caught at roads); Ellison 1969 | medium for use, low for the hours |
| S11 | Lasting snow ≥5 cm | ground cover (open wetland, shrub, regen, roads) ×0.4; conifer ×1.15; S4 and S10 off | Pendergast & Boag (99% needles); Crichton | medium-low |

### Sharp-tailed, dusky, sooty grouse and ptarmigan

| # | Layer and threshold | Weight | Source | Confidence |
|---|---|---|---|---|
| T1 | Sharp-tailed, area prior: Pickle Lake / Whitefish / Searchmont and Sault boxes / Highland / elsewhere | 0.25 / 0.2 / 0.15 / 0.1 / 0 (the "rare" state) | §2 | medium |
| T2 | Fen: open wetland with crown under 10% | 0.8; ×1.15 with treed wetland or dense black spruce, tamarack or cedar within 200 m | Ontario atlas; Escott 2003 | medium |
| T3 | Cut or burn (regen, shrub or barren) by years since disturbance: 2–8 / 9–12 / 13–20 / over 20 | 0.75 / 0.45 / 0.2 / 0.05; cap 0.15 where the stand is over 2.5 m or crown over 40% | Escott 2003; Ritcey & Jury 2004; MN plan | low (inferred thresholds) |
| T4 | Crown closure ≤25% / 25–50% / over 50% or dense conifer | ×1.0 / ×0.5 / ×0.1 | FEIS (woody cover under 30% at leks); Ammann 1957 | medium |
| T5 | From 15 Oct, or snow ≥10 cm: birch or aspen lead, or hardwood ≥30%, within 200 m | +0.15 | Thomas 1984; Escott; FEIS | medium |
| T6 | Snow ≥18 cm | open cells within 300 m of hardwood ×1.2 | FEIS (Wisconsin) | medium |
| T7 | Highland Lake only, elevation ≤800 / 800–1,000 / over 1,000 m | ×1 / ×0.5 / ×0.2 | GBIF elevations | low |
| D1 | Dusky, area prior: Highland / Blanchard / Clearwater box / elsewhere | 0.25 / 0.2 / 0 / 0 | §2 | medium |
| D2 | Dusky, September: open conifer or shrub on a ridge, bench or upper slope, within 100 m of conifer, dz −400 to +100 m | 0.6; ×1.2 on a ridge | Crawford 1986; Ware 1998 | low-medium |
| D3 | Dusky, from 1 Oct (males) or 15 Oct (all): conifer in the area's tallest third, crown 30–75%, within 300 m of a ridge or upper slope, dz −300 to 0 m | 0.7; regen with 1–5 m trees ×0.4 | Cade & Hoffman 1990, 1993; Leipold 2024 | medium in the south, low in the north |
| D4 | Dusky, wind ≥20 km/h | dense or lee conifer ×1.2; open ridge ×0.7 | Pekins 1988 (roosts cut wind 63–85%) | low-medium |
| Y1 | Sooty (Blanchard only, prior 0.05): treeline conifer and meadow, dz −150 to +100 m, Aug–Oct; from November dz −300 to −50 m | 0.5 | ADF&G; Fowle 1960 | low |
| P1 | Ptarmigan, Lac Bailey: willow ptarmigan, 15 Nov–31 Mar; open wetland, shrub or regen ≤8 yr | 0.6; ×1.2 within 100 m of a road; steep or rocky ×0.5; area prior 0.3, or 1.0 when recent records say an irruption is on | Quebec atlas and sheet; GBIF winters | low |
| P2 | Ptarmigan, Blanchard after 15 Oct: shrub or open wetland at dz −400 to −100 m in sheltered cells / exposed shrub above the trees with wind ≥15 km/h | ×1.3 / ×0.6 | Gruys 1993; GBIF elevations | medium |
| P3 | White-tailed ptarmigan: Sept–Oct barren, slope ≥25°, peak or ridge, dz ≥ +300 m / from November shrub basins at dz −100 to +100 m | 0.5 / 0.5 | Hoffman & Braun 1977; Giesen & Braun 1992; GBIF | medium |
| P4 | Ptarmigan, ≤ −15 °C or falling snow | flat open wetland and shrub ×1.2; note "they flush close from the snow" | Quebec sheet (17 h under snow) | low |

### The day (verdict), grouse rows

| # | Input and threshold | Weight | Source | Confidence |
|---|---|---|---|---|
| V1 | Hour, no snow roost: 45 min before sunrise to 2 h after / 2 h after sunrise to 3 h before sunset / 3 h before sunset to 20 min after / dark (outside legal hours: ON, QC, AB ±30 min; BC, YT ±1 h) | 0.9 / 0.75 / 1.0 / 0.1, with a line naming the legal hours (now 1.0 / 0.6–0.3 / 1.0 / 0.35) | Maxson 1977; Pierson & Tester (Nov); Hewitt & Kirkpatrick; §9 hours | medium for shape, low for values |
| V2 | Snow-roost day: soft snow ≥20 cm, or min temp below −10 °C after the bud switch: 45 min either side of sunrise and the last 90 min before sunset / midday | 1.0 / 0.4 | Gullion & Svoboda (20 cm); Shipley 2019; Heinrich 2017; Brander 1965 | medium |
| V3 | Wind: ≤13 / 13–25 / over 25 km/h | 1.0 / 0.85 / 0.7 (now 1.0 / 0.7 / 0.4); label "hard to hear flushes; birds in thick conifer and lee slopes" | survey cut-offs are about hearing (Jones 2005; MN DNR); HWW | low |
| V4 | Rain: under 1 / 1–3 / over 3 mm/h / the first 2 h of light after rain stops | 0.95 / 0.75 / 0.6 / 1.1 | Maxson (feeding after storms); judgment | low |
| V5 | Temperature: over 20 °C / under 0 °C | ×0.85 / no day cut; sharpen V1's dawn and dusk | Pelren 1991; Rasmussen & Brander (LCT −0.3 °C) | low-medium |
| V6 | Overcast and cool at midday | drop the ×1.1 for grouse | Pelren 1991 | low |
| V7 | 24 h temperature drop (front) | ×1.0 for grouse (now ×1.15) | no evidence found | medium that there is none |
| V8 | Dispersal window, 10 Sept–20 Oct (peak 25 Sept–15 Oct) | pull each cell's habitat 30% toward the area's mean; note "young birds in odd places" | Small & Rusch 1989; Kubisiak 1985 | low-medium |
| V9 | Cycle phase, from a region-year table (§8): peak / rising or falling / low / unknown | ×1.15 / ×1.0 / ×0.8 / ×1.0, with the source and date in the verdict | §8 | low-medium |
| V10 | June production (25 May–10 July, from the forecast archive): warmer and drier than normal / 150%+ of normal rain, or a 75 mm storm | one band up / one band down on V9 | Portneuf R² = 0.66; MN DNR; ADF&G | medium for direction, low for thresholds |

### The site, grouse rows

| # | Layer and threshold | Weight | Source | Confidence |
|---|---|---|---|---|
| A1 | Scent part for grouse | 1.0, neutral (now the moose geometry, down to 0.12) | grouse are found by eye and ear [I] | medium |
| A2 | Trail term, replacing +0.25 within 40 m: an unpaved road or trail within 40 m, beside hardwood, mixed, regen or shrub, before lasting snow | +0.1 in the first and last 2 h of light, 0 otherwise | Whitaker 2006; Giroux 2007; Harper; TB 118 (trails unrelated to drumming) | low-medium |
| A3 | Season wear, from week 4 after the opener: within 400 m of a drivable road / 400–800 m / over 800 m | ×0.9 / ×1.0 / ×1.1 (`pressure`) | Kubisiak 1985; Gullion 1983; McCaffery 1996 | medium |
| A4 | Paved highway within 100 m | ×0.5 (shooting is banned on and across it in every province) | §9 | high for the law, low for the birds |
| A5 | View all round (kept: 0.82–1.0) | keep | Gullion (15–18 m view from good cover) | medium |

### Rules that need a layer we don't have

| Rule | Layer needed | Where it could come from | Source |
|---|---|---|---|
| Distance to mature aspen (R7, R8) | `distAspenMature`: aspen-led stands ≥25 yr | baked from `age`, `lead`, `hardwood`, like `distCover`; no new data | TB 118; Gullion |
| Drivable road vs trail (A3) | `distDrivable` | the bake already burns a `drivable` mask for `packOut` | Kubisiak 1985 |
| Lodgepole pine (S1b) | a lead code for Pl (and Fd, Bl, Se for BC, AB, YT) | VRI, AVI, SCANFI's Pl, Cx | Boag & Schroeder; Clearwater report |
| Spruce grouse patch size | contiguous suitable conifer, ha | connected components of S1–S5 ≥0.5; under 4 ha → 0, 8–25 ha ramp | Alberta HSI; Whitcomb 1996; Potvin & Courtois |
| Mid-canopy density (spruce grouse) | LiDAR returns at 5–15 m | the point cloud the bush model already reads | MN DNR 2023 (best predictor) |
| Shrub species: alder, hazel, mountain maple | shrub type | écoforestier and VRI understory fields; else none | Gullion & Svoboda; TB 118 |
| Male aspen clones | none at map scale | only field notes | Gullion & Svoboda |
| Clover and seeded or mowed trails | trail surface and management | agency trail layers (MN RGMA style); none in our areas | TB 189 |
| Burn vs cut, and residual trees | a disturbance-type flag | CanLaD and the inventories carry the type | Schieck & Song |
| Snow crust | freeze–thaw history | the forecast archive the app already reads | Heinrich 2017; HWW |
| Dog or no dog | a user setting | the Spots tab | TB 189; Portneuf |
| Tamarack needle drop | a date by latitude | leaf calendar (`leaves`) | Crichton |
| Sharp-tail openings | open-patch size: blocks of 1.3–5 km², or clearings of about 4 ha in sparse second growth | connected components of open cover | MN plan; Ammann 1957 |
| Farm fields | cropland and hay | AAFC annual crop inventory | Ontario atlas (Sault birds on farmland) |
| Dwarf and bog birch, scrub birch | shrub type | VRI, écoforestier; NALCMS shrub classes | Thomas 1984; Quebec ptarmigan sheet |
| Shrub height above the snow | shrub height minus live snow depth | VRI or LiDAR shrub height and the forecast's snow | Gruys 1993 (1 m); Giesen & Braun (8–28 cm) |
| Douglas-fir, subalpine fir | lead codes Fd, Bl | VRI, AVI | Cade & Hoffman 1990; Pekins 1988 |
| Sharp-tail leks | point locations | none open; the hunt log could hold them | Ritcey & Jury (nests within 1.6 km) |
| Ptarmigan irruptions at Lac Bailey | a live flag | recent public eBird or iNaturalist counts (CC0/CC-BY only) | Quebec atlas; GBIF winters |

### The five strongest rules

1. **R1, the deciduous age curve, with mature aspen at 0.5–0.65 instead of
   0.35.** It is the best-replicated shape in the literature, from Wisconsin,
   Minnesota, Alberta, BC, Maine and Quebec. It is also the rule that moves
   the most land in the app's areas.
2. **R3 with R4, the conifer share.** Ruffed grouse lose value above about
   60% conifer, and pure black spruce is near zero. Five independent
   sources agree, and two of them measure survival.
3. **S1, spruce grouse in jack pine by height.** Ontario has the
   continent's densest spruce grouse at 3–8 m. This turns the grouse map's
   blind spot into its strongest call.
4. **R8 with R7, young cover within 100 m of mature aspen.** 94–98% of
   drumming sites and broods meet it, in three studies.
5. **A1 and A2, the scent part neutral and the road bonus cut to a trail
   term.** The current +0.25 and the moose-geometry scent part are the two
   biggest terms on grouse cells, and neither scores the bird.

## 11. Corrections to the app and the docs

1. **`HUNT-FISH-SCIENCE.md`, Ruffed grouse:** "14.3 vs 0.8–3.3 birds per 40
   ha" compares the cycle, not age, and counts spring drummers (§3). The
   age numbers are 1.7 / 6.7 / 3.5 drummers per 40 ha at 0–5 / 6–25 / over
   25 yr.
2. **Same section:** alder is cover, not a food. Hazel catkins and aspen
   buds are the food.
3. **Same section:** "birds sit tight in high wind and rain" has no support
   (§6). "Calm" helps the hunter hear, not the bird.
4. **Same section, Spruce grouse:** "15–30 yr, 6–15 m" is too tall for
   Ontario jack pine. The peak there is 3–8 m, falling from 10–12 m. Black
   spruce–tamarack swamps are core habitat, not an edge case. Tamarack
   needles are a main fall food.
5. **`huntRules.ts` grouse branch:**
   - one score for two opposite birds;
   - aspen over 40 yr at 0.35;
   - shrub 0.8 regardless of where it sits;
   - the ≥40% hardwood gate (30% is enough);
   - treed wetland 0.35;
   - regen 0.7 whatever it regrows as;
   - the "water within 50 m" bonus on lake shores.
6. **`huntRules.ts` `siteCore`:** grouse get the moose scent geometry.
7. **`huntRules.ts` `activityVerdict`:** grouse take the moose hour
   weights, the wind's "sit tight" 0.4, the overcast midday ×1.1 and the
   front's ×1.15. None is supported for grouse.
8. **`regs.ts`:** no Ontario, Quebec or Alberta entries, and BC lacks the
   non-resident upland bird licence.
9. **The Clearwater report and its Millar Western note** say "48% of
   banded males shot were within 100 m of a road, falling to 1% beyond 300
   m". The four figures sum to 67%, so they are more likely the share shot
   within each distance band (§7). That makes the roadside effect stronger
   than the report reads, not weaker.
10. **The Clearwater report** is consistent with this doc. Its spruce grouse
   curve is the lodgepole case (S1b), and its ruffed table is close to R1.
   Two differences:
   - its roadside rule (keep +0.25, widen it to 60 m) should become A2 and
     A3;
   - its "no cycle multiplier" stands for Alberta until a phase source
     exists.

## 12. Open questions and unverified numbers

- **Fall habitat.** Almost every stand number is from spring drumming or
  summer broods. No fall telemetry habitat-selection study was found for
  boreal Ontario or Quebec.
- **Primary texts not read:**
  - Cade & Sousa 1985 (the USFWS ruffed grouse HSI);
  - Szuba & Bendell 1983;
  - Anich et al. 2013;
  - Turcotte et al. 2000;
  - Small, Holzwart & Rusch 1991;
  - Fischer & Keith 1974;
  - Huempfner & Tester 1988;
  - Svoboda & Gullion 1972 (JWM);
  - Whitaker & Stauffer 2003.

  Their numbers here come from reviews (FEIS, AFWA, Wisconsin bulletins).
  The Quebec gélinotte guide (Fondation de la faune / MFFP) and Doyon et
  al. 2000 for ruffed grouse could not be reached.
- **Other species.**
  - No years-since-cut or years-since-burn threshold exists for
    sharp-tails. T3's 8–12 yr cut-off is inferred.
  - Escott 2003 was quoted from one reading; a second fetch failed.
  - Zwickel & Bendell's blue grouse monograph (2004) and Zwickel's
    Birds of North America account were not reached.
  - The dusky and sooty labels on Haines Road records may be wrong.
  - GBIF finding nothing within 50 km of Highland Lake means few observers,
    not no birds.
  - The Ontario third atlas (2021–25) text was not read.
- **Weather.** No study was found of:
  - wind and flush distance;
  - rain and where grouse sit;
  - the effect of a front;
  - sunning on south slopes or roads;
  - grit visits by the hour, for either species.
- **Cycle.** There is no current series for Ontario, Quebec, Alberta or BC.
  CEMP's 2024 and 2025 Yukon reports were not found. Whether the 2025–26
  hare peak and crash have happened is unconfirmed. The Minnesota harvest
  figures for 2021 and 2023 are from a snippet.
- **Regulations.**
  - Whether Lac Bailey lies in a zec or an outfitter's exclusive territory.
  - Whether Duhamel lies in Papineau-Labelle.
  - The extent of Quebec's small-game road exemption in zone 10.
  - Whether WMU 36 counts as north of the French and Mattawa rivers for
    Sunday gun hunting.
  - Which Alberta road-corridor sanctuaries fall in 324 and 326.
  - Whether Alberta has no orange rule (none was found).
- **The app's data.**
  - Pickle Lake's FRI ages: do they run from the inventory year (2010) or
    to today? Aged to today, more of the 80–100 yr aspen is over 100.
  - Clearwater was baked without a forest layer, so no grouse rule can work
    there until it is rebaked (Clearwater report, change 3).

## Key sources

**Ruffed grouse habitat**
- [Kubisiak, Moulton & McCaffery 1980, WDNR TB 118](https://asset.library.wisc.edu/1711.dl/3VIRIW6G2LDLT8P/E/file-b0061.pdf)
- [Kubisiak 1985, WDNR Research Report 136](https://asset.library.wisc.edu/1711.dl/GY6TG3ENOHANL8D/E/file-85ffb.pdf)
- [Kubisiak & Rolley 1998](https://asset.library.wisc.edu/1711.dl/5CI5TLPUY7CX48L/E/file-beb9e.pdf)
- [McCaffery et al. 1996, WDNR TB 189](https://asset.library.wisc.edu/1711.dl/73VXXUSABT7YK8F/E/file-07f78.pdf)
- [Dorney 1959, WDNR TB 18](https://asset.library.wisc.edu/1711.dl/XJVUNJ3VDXK4L82/E/file-3ee18.pdf)
- [Gullion & Svoboda 1972, USDA GTR NC-1](https://www.fs.usda.gov/nrs/pubs/gtr/gtr_nc001.pdf)
- [USFS FEIS, ruffed grouse](https://www.fs.usda.gov/database/feis/animals/bird/boum/all.html)
- [Beltrami County ruffed grouse plan (Gullion 1984)](https://www.beltramicountymn.gov/media/sz5hw1xv/three-island-ruffed-grouse-mgmt-plan.pdf)
- [Maine ruffed grouse assessment](https://www.maine.gov/ifw/docs/species_planning/birds/ruffedgrouse/assessment.pdf)
- [Blanchette, Bourgeois & St-Onge 2007, JWM](https://complete.bioone.org/journals/journal-of-wildlife-management/volume-71/issue-6/2006-253/Ruffed-Grouse-Winter-Habitat-Use-in-Mixed-SoftwoodHardwood-Forests-Qu%c3%a9bec/10.2193/2006-253.full)
- [Backs et al. 1985, Indiana](https://journals.indianapolis.iu.edu/index.php/ias/article/download/8349/8321/14493)
- [Storm et al. 2003, Pennsylvania SGL 176](https://www.pa.gov/content/dam/copapwp-pagov/en/pgc/documents/wildlife/wildlifespecies/documents/ruffed%20grouse%20research%20bulletin%20sgl176%20scotia%20barrens.pdf)
- [Harper et al., ruffed grouse habitats](https://dwr.ar.virginia.gov/wp-content/uploads/ruffed-grouse-habitats.pdf)
- [Zimmerman et al. 2009 (USGS summary)](https://www.umesc.usgs.gov/terrestrial/ruffed_grouse_habitat.html)
- [BC Breeding Bird Atlas, ruffed grouse](https://www.birdatlas.bc.ca/accounts/speciesaccount.jsp?sp=RUGR&lang=en)
- [FRI 1999 winter foraging HSI](https://friresearch.ca/data/null/HSP_1999_10_Rpt_RuffedGrouseWinterForagingHabitat.pdf)
- [ABMI ruffed grouse](https://abmi.ca/species/ruffed-grouse)

**Spruce grouse**
- [Williamson et al. 2008, AFWA Spruce Grouse Continental Conservation Plan](https://wdfw.wa.gov/sites/default/files/publications/01323/wdfw01323.pdf)
- [Atlas of the Breeding Birds of Ontario 2001–05](https://view.publitas.com/birds-canada-gykxaz9yrrpp/atlas-of-the-breeding-birds-of-ontario-2001-2005/page/76)
- [Michigan MNFI abstract](https://mnfi.anr.msu.edu/abstracts/zoology/Falcipennis_canadensis.pdf)
- [Roy & Ponder 2019, MN DNR](https://files.dnr.state.mn.us/wildlife/research/summaries/2019/upland/2019upland003.pdf)
- [Roy, Ponder & Aylward 2023, MN DNR](https://files.dnr.state.mn.us/wildlife/research/summaries/2023/roy-boreal.pdf)
- [MN LCCMR final report](https://www.lccmr.mn.gov/projects/2019/finals/2019_03e.pdf)
- [MN DNR spruce grouse survey 2016](https://files.dnr.state.mn.us/wildlife/research/summaries/forest/2016_spruce-grouse.pdf)
- [Lycke, Imbeau & Drapeau 2011](https://chaireafd.uqat.ca/publication/articlePDF/CanJForRes2011_41(3)_501-508.pdf)
- [Quebec breeding bird atlas, tétras du Canada](https://www.atlas-oiseaux.qc.ca/pdf/fr/050-(152-153)-TetrasCanada.pdf)
- [FFQ woodlot guide, fascicle 3](https://afm.qc.ca/docs/Guide-Fascicule3%20Tétras%20du%20Canada-FFQ.pdf)
- [Wisconsin DNR jack pine guidance](https://dnr.wisconsin.gov/sites/default/files/topic/ForestManagement/24315_33.pdf)
- [Gilbert & Blomberg 2019](https://eaglehill.us/NENAonline/articles/NENA-26-2/13-Gilbert.shtml)
- [NY DEC spruce grouse assessment 2025](https://extapps.dec.ny.gov/fs/programs/dfw/SWAP2025/Birds/Spruce%20grouse.pdf)
- [Vermont Spruce Grouse Recovery Plan](https://www.vtfishandwildlife.com/sites/fishandwildlife/files/documents/Learn%20More/Library/REPORTS%20AND%20DOCUMENTS/NONGAME%20AND%20NATURAL%20HERITAGE/RECOVERY%20PLANS/Vermont%20Spruce%20Grouse%20Recovery%20Plan.pdf)
- [Huggard 2003](https://agris.fao.org/search/en/records/65deee85b766d82b18ff3689)
- [BC Breeding Bird Atlas, spruce grouse](https://www.birdatlas.bc.ca/accounts/speciesaccount.jsp?sp=SPGR&lang=en)
- [Montana field guide, spruce grouse](https://fieldguide.mt.gov/speciesDetail.aspx?elcode=ABNLC09010)

**Sharp-tailed, dusky and sooty grouse, ptarmigan**
- [Atlas of the Breeding Birds of Ontario, sharp-tailed grouse](https://view.publitas.com/birds-canada-gykxaz9yrrpp/atlas-of-the-breeding-birds-of-ontario-2001-2005/page/78)
- [Escott 2003, Ontario Birds 21](https://digitalcommons.usf.edu/ontario_birds/vol21/iss1/1)
- [Quebec atlas, tétras à queue fine](https://www.atlas-oiseaux.qc.ca/pdf/fr/052-(156-157)-TetrasQueueFine.pdf)
- [Ritcey & Jury 2004, BC Identified Wildlife: Columbian sharp-tailed grouse](https://www.env.gov.bc.ca/wld/frpa/iwms/documents/Birds/b_columbiansharptailedgrouse.pdf)
- [USFS FEIS, sharp-tailed grouse](https://www.fs.usda.gov/database/feis/animals/bird/typh/all.html)
- [Michigan MNFI, sharp-tailed grouse](https://mnfi.anr.msu.edu/abstracts/zoology/Tympanuchus_phasianellus.pdf)
- [Minnesota Sharp-tailed Grouse Society plan 2022–32](https://www.sharptails.org/wp-content/uploads/2023/01/2022-_2032-MN-STGR-Mgt-Plan-by-MSGS-_Nov-18-2022-final.pdf)
- [Gregg 1990, WDNR Report 152](https://asset.library.wisc.edu/1711.dl/FXQWR4QNI66LS8W/E/file-602b5.pdf)
- [MN DNR sharp-tailed grouse survey 2026](https://files.dnr.state.mn.us/wildlife/grouse/reports/sharptail/stail-survey-2026.pdf)
- [ADF&G sharp-tailed grouse](https://www.adfg.alaska.gov/index.cfm?adfg=sharptailedgrouse.main)
- [Cade & Hoffman 1990 (USGS)](https://www.usgs.gov/publications/winter-use-douglas-fir-forests-blue-grouse-colorado)
- [Pekins 1988, thesis](https://digitalcommons.usu.edu/etd/4680)
- [Ware 1998, WDFW blue grouse](https://wdfw.wa.gov/sites/default/files/publications/00026/wdfw00026.pdf)
- [Crawford et al. 1986](https://www.fs.usda.gov/media/218731)
- [Leipold, Gower & McNew 2024](https://ace-eco.org/vol19/iss2/art7/)
- [ADF&G sooty grouse](https://www.adfg.alaska.gov/index.cfm?adfg=sootygrouse.main)
- [Quebec atlas, lagopède des saules](https://www.atlas-oiseaux.qc.ca/pdf/fr/051-(154-155)-LagopedeSaules.pdf)
- [Quebec species sheet, lagopède des saules](https://www.quebec.ca/agriculture-environnement-et-ressources-naturelles/faune/animaux-sauvages-quebec/fiches-especes-fauniques/lagopede-saules)
- [ADF&G Game Bird Report 1964](https://www.arlis.org/docs/vol1/ADFG/GameBirds/31108034/31108034-1964.pdf)
- [ADF&G white-tailed ptarmigan](https://www.adfg.alaska.gov/index.cfm?adfg=smallgamehunting.whitetailedptarmigan)
- [Giesen & Braun 1992, Wilson Bull.](https://archive.org/download/biostor-200522/biostor-200522.pdf)
- [Outdoor Canada, ptarmigan](https://www.outdoorcanada.ca/?p=3708)
- [GBIF occurrence API](https://api.gbif.org/v1/occurrence/search) (counts and elevations computed 2026-10-18)

**Time, weather and snow**
- [Maxson 1977, Wilson Bull.](https://archive.org/download/biostor-200224/biostor-200224.pdf)
- [Rasmussen & Brander 1973, Wilson Bull.](https://sora.unm.edu/sites/default/files/journals/wilson/v085n02/p0223-p0229.pdf)
- [Shipley et al. 2019, Oecologia](https://repository.lib.umassd.edu/esploro/outputs/journalArticle/Snow-roosting-reduces-temperature-associated-stress-in/9914470614201301)
- [Heinrich 2017, Northeastern Naturalist](https://www.eaglehill.us/NENAonline/articles/NENA-sp-7/14-Heinrich.shtml)
- [Hewitt & Kirkpatrick 1997](https://sora.unm.edu/sites/default/files/journals/jfo/v068n03/p0413-p0420.pdf)
- [Pelren 1991, thesis](https://trace.tennessee.edu/utk_gradthes/6963)
- [Jones et al. 2005, SEAFWA](https://seafwa.org/sites/default/files/journal-articles/jones-135-143.pdf)
- [Small & Rusch 1989, Auk](https://sora.unm.edu/sites/default/files/journals/auk/v106n01/p0072-p0079.pdf)
- [Hinterland Who's Who, ruffed grouse](https://www.hww.ca/en/wildlife/birds/ruffed-grouse.html)
- [ADF&G ruffed grouse](https://www.adfg.alaska.gov/index.cfm?adfg=ruffedgrouse.main)

**Hunting, roads and harvest**
- [Skrip et al. 2011](https://eaglehill.us/NENAonline/articles/NENA-18-4/10-Skrip.shtml)
- [Jones et al. 2008, SEAFWA](https://seafwa.org/sites/default/files/journal-articles/Jones-51-57.pdf)
- [Hardy 1952, SEAFWA](https://seafwa.org/sites/default/files/journal-articles/HARDY-518.pdf)
- [MN Ruffed Grouse Management Areas](https://www.dnr.state.mn.us/rgma/index.html)
- [Maryland cooperator survey](https://stg-dnr.maryland.gov/wildlife/Documents/Ruffed_Grouse_Cooperator_Survey_Results.pdf)

**Cycles**
- [MN DNR ruffed grouse survey 2026](https://files.dnr.state.mn.us/wildlife/grouse/reports/ruffed/rgrouse-survey-2026.pdf)
- [MN DNR ruffed grouse survey 2025](https://files.dnr.state.mn.us/wildlife/grouse/reports/ruffed/rgrouse-survey-2025.pdf)
- [MN small game survey 2025](https://files.dnr.state.mn.us/wildlife/research/smallgame/survey_2025.pdf)
- [WI DNR 2026 release](https://dnr.wisconsin.gov/newsroom/release/126096)
- [WI DNR 2025 release](https://dnr.wisconsin.gov/newsroom/release/110856)
- [Michigan 2025 cooperator survey (press)](https://www.outdoornews.com/?p=537282)
- [Portneuf hunter network reports, Quebec (2003 report; others in the same series)](https://diffusion.mern.gouv.qc.ca/Public/Biblio/Perio/0904595/2003.pdf)
- [Quebec small game plan, synthesis](https://cdn-contenu.quebec.ca/cdn-contenu/faune/documents/gestion-especes/Plans-gestion/plan-gestion-petit-gibier-synthese.pdf)
- [Quebec atlas, gélinotte huppée](https://www.atlas-oiseaux.qc.ca/pdf/fr/049-(150-151)-GelinotteHuppee.pdf)
- [Archibald 2014, Can. Field-Nat.](https://www.canadianfieldnaturalist.ca/index.php/cfn/article/view/1626)
- [Martin et al. 2001, Kluane chapter 11](https://www.zoology.ubc.ca/~krebs/downloads/Kluane%20Book%20-%20Ch11%20-%20Grouse%20and%20Ptarmigan.pdf)
- [CEMP 2023 annual report](https://www.zoology.ubc.ca/~krebs/downloads/2023_cemp_annual_report.pdf)
- [Kluane annual report 2019](https://www.zoology.ubc.ca/~krebs/downloads/kluane_annual_report_2019.pdf)
- [Mongabay, May 2025 (Boutin)](https://news.mongabay.com/2025/05/new-research-sheds-light-on-canada-lynx-snowshoe-hare-cycle-human-impacts/)
- [ADF&G small game summary 2026](https://www.adfg.alaska.gov/static/hunting/smallgamehunting/pdfs/status-small-game-small-game-summary-2026.pdf)
- [FEIS, ruffed grouse (cycles)](https://research.fs.usda.gov/feis/species-reviews/boum)
- [West Nile in Pennsylvania grouse (TWS)](https://wildlife.org/jwm-study-west-nile-could-be-impacting-pennsylvania-grouse/)
- [MN West Nile surveillance 2019](https://files.dnr.state.mn.us/recreation/hunting/grouse/west_nile_2019.pdf)

**Regulations**
- [Ontario Hunting Regulations Summary 2026](https://www.ontario.ca/files/2026-03/mnr-2026-ontario-hunting-regulations-summary-en-2026-03-10.pdf)
- [Ontario small game page](https://www.ontario.ca/document/ontario-hunting-regulations-summary/small-game-and-furbearing-mammals)
- [Quebec small game periods](https://www.quebec.ca/tourisme-loisirs-sport/activites-sportives-et-de-plein-air/chasse-sportive/periodes-limites/petit-gibier)
- [Quebec small game limits](https://www.quebec.ca/tourisme-loisirs-sport/activites-sportives-et-de-plein-air/chasse-sportive/gibier/petit-gibier)
- [BC Hunting and Trapping Synopsis 2026–2028](https://www2.gov.bc.ca/assets/gov/sports-recreation-arts-and-culture/outdoor-recreation/fishing-and-hunting/hunting/regulations/hunting-trapping-synopsis.pdf)
- [Alberta game bird seasons 2026](https://www.albertaregulations.ca/pdfs/hunting-regs/Game-Bird-Seasons.pdf)
- [Yukon Hunting Regulations Summary 2026–27](https://emrlibrary.gov.yk.ca/emrlibrary/environment/yukon-hunting-regulations-summary/2026-27.pdf)
