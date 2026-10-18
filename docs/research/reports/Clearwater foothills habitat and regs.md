# Clearwater: what the heat map needs in the Alberta foothills

Researched 2026-10-17 for the Clearwater area (`app/src/areas/clearwater.json`, centre 52.278114, −115.250061). The notes behind every number are in [docs/research/research_notes/Clearwater foothills habitat and regs/](../research_notes/Clearwater%20foothills%20habitat%20and%20regs/). Nothing here is built.

## Bottom line

**The place.**
- The spot is in **WMU 326 Baseline**. The box also covers **WMU 324 Prairie Creek**: 53% of the region and 36% of the core. The two are divided by the North Fork Road and Hwy 752.
- It is the Lower (60%) and Upper (40%) Foothills at 1,014–1,372 m. That is 600 m below treeline, and the nearest alpine is 38 km away.
- 92% is public Green Area. A fifth of it has been logged since 1985, with almost no fire.
- Roads reach everywhere: no point is more than 1.7 km from one, and mapped cutlines add 3.6 km/km².

**The game.**
- **White-tailed deer** are the main game: 787 were taken in the two WMUs in 2025.
- Moose are thin (0.14–0.15/km² in mid-winter) and hunted only by draw: 13 resident bull licences.
- Elk are legal but rare: 2–11 a year per WMU at 1–7% hunter success, and none were seen on two mid-winter surveys.
- Grizzlies are present. The box is grizzly Secondary Zone. They are protected.
- Black bears, ruffed and spruce grouse, wolves and coyotes are open. There are no dusky grouse, ptarmigan or sharp-tailed grouse to speak of.

**The profile.** `build_profile.py` has written it into the area file as boreal Ontario: no treeline, `north: false`, CEC 5.4.2. That is right for the terrain.

**The app as it stands tonight.** It gets Clearwater wrong in five ways; the first was fixed during the research:
1. **It would not have loaded the area.** `zone.name` was null, and `areas/check.ts` drops an area file without a string zone; the build refuses it too. The bake session set `{ "label": "WMU", "name": "326" }` during this research, and `bake_area.py` now writes `""` for new areas. **Keep it 326.**
2. **The bake has no Alberta inputs.** It has no forest or vectors adapter for AB, so the grid has no cut ages, roads or streams. The 5–14-yr cutblocks, which the 2020 land cover calls "grassland", score **zero** for every target. Bake with `ca.scanfi` and an AB vectors adapter, and give fields and young-cut grass a cover class.
3. **The deer rules miss the main game.** They are Ontario's marginal-whitetail rules: half the moose score, plus +0.3 on any south slope, with no rut. Foothills whitetails want young cuts (≤10 yr), field and bush edges within about 140 m, and a rut that peaks around 15–25 Nov. Under the current rules, dense conifer on a south slope outscores an aspen edge on the flat.
4. **The bear rule's date is a month late.** The Ontario rule switches to "berries done" on 15 Oct. Here buffaloberry is over by mid-September, black bears den from late September to early November, and grizzlies stay active into November. The grizzly kill-site card should show, and it will not, because without the `north` flag or a table entry the app assumes no grizzlies.
5. **There are no season lines, and they would differ by side of the road.** On the friend's days (18–19 Oct), rifle white-tailed deer of either sex are open in 326 but bow-only in 324. Elk are bow-only on both sides. Moose and rifle mule deer need a drawn licence.

**Smaller changes.** The rest are reorderings: a foothills moose cut curve with a pine-cut tail and a stream term, the spruce grouse in lodgepole pine, and road-traffic factors by road class.

**Elk.** Clearwater is the range gate's "rare" case. It is not the place to build the first elk target.

**Evidence tags,** as in `docs/HUNT-FISH-SCIENCE.md` and `docs/ELK-SCIENCE.md`:
- **[S]** peer-reviewed or agency science;
- **[G]** agency guidance or regulation;
- **[H]** hunter, guide or press;
- **[I]** inference from the sources or from the repo's code, not measured.

(The brief glossed S/H/G as strong/hypothesis/guess; this report keeps the science docs' meanings and adds [I] for inference.) Box shares are my own measurements on the province's open layers, on 2026-10-17.

## 1. Where it is and who runs it

**WMUs.** The centre is in **WMU 326 Baseline**, and the box also covers **WMU 324 Prairie Creek** [G] ([Alberta WMU layer, OGL-Alberta](https://open.alberta.ca/opendata/gda-937714ca-daad-4b7b-be9f-35a4b9cbd3c0); point and polygon queries).

| | WMU 326 Baseline | WMU 324 Prairie Creek |
|---|---|---|
| Region | 47% | 53% |
| Core | 64% | 36% |
| 5 km ring round the spot | 71% | 29% |

- **The boundary.** Inside the box it is two paved roads: the North Fork Road, which runs north-west to south-east, and Secondary Road 752. 326 is the wedge west of the North Fork Road and north of Hwy 752; 324 is north-east and south of them [G] (legal descriptions, [324](https://www.albertaregulations.ca/huntingregs/wmu/324.html), [326](https://www.albertaregulations.ca/huntingregs/wmu/326.html)). The spot is 2.7 km from the boundary.
- Both are Foothills (300-series) WMUs, run from the Rocky Mountain House Fish and Wildlife office.
- **The name.** "Clearwater" is the county (Clearwater County, MD 0377). WMU 420 "Clearwater" is a mountain unit further west. The Clearwater River is 22 km south-east; the box drains to it through Prairie Creek, which joins it about 4–5 km above Rocky Mountain House.

**Land.** It is public land almost throughout (place-land-status-and-zones.md):
- 92% Green Area (97% of the core) and 8% White Area, the settled, mostly private land on the east edge.
- The western third is in the Rocky Mountain Forest Reserve, judging by the province's rangeland-zone layer (a proxy, not the legal line).
- Grazing dispositions cover 13% of the box: leases 4.5%, a forest grazing licence 8.7%.
- The whole box needs the Public Lands Camping Pass to camp.
- **There are three Provincial Recreation Areas inside it, where hunting is not allowed:** Prairie Creek (37 ha), Prairie Creek Group Camp (13 ha) and Strachan (28 ha). They are 4.5–5.6 km from the spot.
- There is no Public Land Use Zone; the nearest, Kiska/Willson, is 25 km west. There is no reserve. It is Treaty 6 territory, inside West Fraser's Sundre FMA.

**Wildlife zones.** The box is 77% **grizzly Secondary Zone** and 23% Support Zone; the Core Zone is 10 km from the spot. Key Wildlife and Biodiversity Zones cover 6% of it, 70% of that within 500 m of Prairie Creek or North Prairie Creek [G] ([Alberta wildlife sensitivity layers](https://geospatial.alberta.ca/titan/rest/services/biota/wildlife_sensitivity_mammals_10tm_nad83_aep/MapServer)).

## 2. The 2026 regulations

**Sources.** Dates are from the *2026 Alberta Guide to Hunting Regulations*: PDF of 31 July 2026, modified 14 Sept 2026, checked against the online tables and the rendered pages 52, 53, 58 and 63 [G] ([guide](https://www.albertaregulations.ca/2026-Alberta-Hunting-Regulations.pdf); [Foothills seasons](https://www.albertaregulations.ca/huntingregs/wmu300.html); [bear and cougar](https://www.albertaregulations.ca/huntingregs/bear-cougar-seasons.html); [game birds](https://www.albertaregulations.ca/huntingregs/bird-seasons.html)). Licence counts are from the June 2026 allocation reports [G] (regs-alberta-allocations-2026.md).

**Terms.** "Archery" means archery-only: bow and arrow, no crossbow. "General" means firearm, crossbow or bow. "Draw" means a special licence.

| Residents | WMU 326 Baseline (the spot) | WMU 324 Prairie Creek | On 18–19 Oct 2026 |
|---|---|---|---|
| White-tailed deer, either sex, general licence | archery 25 Aug–16 Sept; general 17 Sept–30 Nov | archery 1 Sept–31 Oct; general 1–30 Nov | 326 rifle; 324 bow only |
| Mule deer | bucks by bow 25 Aug–16 Sept on the general licence; general 17 Sept–30 Nov by draw (5 licences); no does | bucks by draw only (5): archery 1 Sept–31 Oct, general 1–30 Nov; no does | draw only |
| Moose | bulls by draw only: archery 25 Aug–23 Sept, general 24 Sept–31 Oct (6 licences) and 1–30 Nov (4); no cows or calves | bulls by draw only: archery 1 Sept–31 Oct, general 1–30 Nov (3 licences); no cows or calves | draw only |
| Elk | 3-point or larger bulls, general licence: archery 1 Sept–31 Oct, general 1–30 Nov; no antlerless | the same bulls, plus antlerless by bow 1 Sept–31 Oct; 4 antlerless draws (1–25 Nov, 26 Nov–31 Dec, Jan, Feb) | bow only |
| Black bear | archery 25–31 Aug; general 1 Sept–30 Nov; spring 1 Apr–15 June 2027; no bait | general 1 Sept–30 Nov; spring 1 Apr–15 June; bait only in mapped parts | open |
| Grizzly | no season (see below) | none | protected |
| Cougar | 1 Dec–31 Mar, quota: call 1-800-661-3729 each day | same | not open |
| Wolf | residents need no licence, from 25 Aug (the first big-game opener) to 15 June 2027 | 1 Sept–15 June | open |
| Coyote | Green Area public land from the first opener to 15 June; private and White Area land all year | same | open |
| Ruffed, spruce and blue (dusky) grouse | 1 Sept–15 Jan, 5 a day and 15 in possession of each | same | open |
| Sharp-tailed grouse | no season: 324 and 326 are not on its list | none | closed |
| Ptarmigan | legally 1 Sept–15 Jan; no habitat | same | n/a |

**Definitions.**
- A "three-point elk" has an antler with "a main beam from which project not fewer than two tines, each of which is at least 7.6 cm (3 in.) in length".
- "Antlered" means an antler longer than 10.2 cm.
- A general mule deer licence is "valid during the archery-only season" but "not valid during a season in which a special licence is required" [G] (guide pp. 42 and 68).

**Where you may not hunt or shoot** [G] ([general regulations](https://www.albertaregulations.ca/huntingregs/genregs.html)):
- outside half an hour before sunrise to half an hour after sunset;
- from, along or across a provincial highway or "a road that is paved, oiled, graded or regularly maintained" (with no ditch or fence, the roadway runs 20 feet past the travelled edge);
- within 183 m of an occupied building without consent;
- on private or occupied land without permission to enter and express consent to hunt;
- on grazing-lease land without contacting the leaseholder;
- in provincial recreation areas, where hunting and discharge are "in general … prohibited". None of the box's three is among the exceptions.

**Other rules.**
- Sundays are open here; Sunday big-game hunting is closed only in WMUs 102–160, 624, 728, 730 and 936.
- **Deer heads from 324 (not 326) must go in for CWD testing within 30 days.** Alberta has found CWD in 5,982 mule deer, 1,200 white-tailed deer, 78 elk and 29 moose (guide p. 66). In 2025–26, 25% of mule deer tested positive against 3.7% of white-tailed deer, and CWD was newly found in WMU 320 next door [G] ([CWD updates](https://www.alberta.ca/chronic-wasting-disease-updates); deer-alberta-cwd-2025-26.md).

**Grizzly.**
- Licensed hunting ended in 2006, and the grizzly has been listed as Threatened since 2010 [G] ([Recovery Plan 2020](https://open.alberta.ca/publications/9781460147917)).
- Since 17 June 2024, Ministerial Order 43/2024 (Wildlife Regulation s. 53.1) lets Fish and Wildlife have one specific conflict grizzly without cubs killed by a lottery-drawn resident "responder". The 2026 draw booklet calls this "not a recreational hunting opportunity".
- The guide says it will be used "rarely, if ever" in the Recovery Zone, which covers the box's Secondary part [G] ([MO 43/2024](https://kings-printer.alberta.ca/Documents/MinOrders/2024/Forestry_and_Parks/2024_043_Forestry_and_Parks.pdf); [authorization guide](https://open.alberta.ca/dataset/34e66137-22a8-448b-9308-76fea7e12f92/resource/472b5c27-c5a9-494f-a816-5d27f1383616/download/fp-grizzly-bear-management-authorization-guide.pdf)).
- The 2013 handout puts the maximum penalty for shooting one at $100,000 and two years in jail. Whether that figure is current is unconfirmed.

**The friend's two days.** What is legal depends on which side of the North Fork Road and Hwy 752 he stands.
- Around the spot (326): rifle white-tailed deer of either sex are open.
- Across the road (324): bow only until 31 Oct.
- Elk: bow only everywhere until 1 Nov.
- Moose and rifle mule deer: drawn licence only.
- Open everywhere: black bear, wolves, coyotes and forest grouse.
- Creeks are catch-and-release (section 7).

### Proposed species-table entries for `app/src/spots/regs.ts`

These are a **proposal, not in the code**. They copy the shape of the BC 6-28 and YT 4-09 entries and need two type changes:
- `Quarry` gains `'elk' | 'cougar'`, speak-only like caribou, sheep, goat and wolf, with words in `QUARRY_NAMES`.
- `deer` means white-tailed deer here, with mule deer in the note, until the table can tell the two apart.

Elk carries `'hunted'` until `QuarryStatus` gains the "rare" state (section 6).

```ts
// PROPOSAL. Read 2026-10-17 from the 2026 guide (pp. 52-53, 58, 63) and the 2026 allocation reports.
const AB_GROUSE: QuarryRule = { status: 'hunted', seasons: [{ from: '09-01', to: '01-15', what: 'ruffed, spruce and dusky (blue) grouse, 5 a day of each; no sharp-tailed season here' }] }
const AB_GRIZZLY: QuarryRule = { status: 'noSeason', note: 'No grizzly hunting in Alberta (ended 2006; Threatened since 2010).' }
const AB_COUGAR: QuarryRule = { status: 'hunted', seasons: [{ from: '12-01', to: '03-31', what: 'quota: call 1-800-661-3729 before each day out' }] }
const AB_PLACES = 'No hunting in the Prairie Creek, Prairie Creek Group Camp or Strachan recreation areas.'
const AB_ROADS = 'No shot from, along or across Hwy 752 or any graded road, or within 183 m of an occupied building; half an hour before sunrise to half an hour after sunset.'

  {
    jurisdiction: 'AB',
    zones: ['326'],
    edition: 'Alberta Guide to Hunting Regulations 2026',
    checked: '2026-10-17',
    url: 'https://www.albertaregulations.ca/2026-Alberta-Hunting-Regulations.pdf',
    quarry: {
      moose: {
        status: 'draw',
        seasons: [
          { from: '08-25', to: '09-23', what: 'bulls, bow only, drawn licence' },
          { from: '09-24', to: '10-31', what: 'bulls, drawn early-season licence' },
          { from: '11-01', to: '11-30', what: 'bulls, drawn late-season licence' },
        ],
        note: 'Moose by draw only here (10 resident bull licences in 2026); no cows or calves.',
      },
      deer: {
        status: 'hunted',
        seasons: [
          { from: '08-25', to: '09-16', what: 'white-tailed deer of either sex, bow only' },
          { from: '09-17', to: '11-30', what: 'white-tailed deer of either sex' },
        ],
        note: 'Mule deer: bucks by bow on the general licence 25 Aug–16 Sept, by draw after; no does.',
      },
      blackBear: {
        status: 'hunted',
        seasons: [
          { from: '04-01', to: '06-15' },
          { from: '08-25', to: '08-31', what: 'bow only' },
          { from: '09-01', to: '11-30' },
        ],
        note: 'Two a year with the supplemental licence; no cubs under a year or sows with them; no bait in 326.',
      },
      grizzly: AB_GRIZZLY,
      grouse: AB_GROUSE,
      ptarmigan: { status: 'absent' }, // legal 1 Sept–15 Jan, but no alpine within 30 km
      elk: {
        status: 'hunted', // the range gate's 'rare' when QuarryStatus has it
        seasons: [
          { from: '09-01', to: '10-31', what: '3-point or larger bulls, bow only' },
          { from: '11-01', to: '11-30', what: '3-point or larger bulls' },
        ],
        note: 'Elk are scarce here: 2–6 taken a year in 326 (1–6% of elk hunters); steadier in WMU 320 Bearberry to the south-east.',
      },
      cougar: AB_COUGAR,
      wolf: { status: 'hunted', seasons: [{ from: '08-25', to: '06-15', what: 'residents need no licence' }] },
      caribou: { status: 'absent' },
      sheep: { status: 'absent' },
      goat: { status: 'absent' },
    },
    notes: ['East of the North Fork Road and south of Hwy 752 is WMU 324: deer by bow only until 31 Oct.', AB_PLACES, AB_ROADS],
  },
  {
    jurisdiction: 'AB',
    zones: ['324'],
    edition: 'Alberta Guide to Hunting Regulations 2026',
    checked: '2026-10-17',
    url: 'https://www.albertaregulations.ca/2026-Alberta-Hunting-Regulations.pdf',
    quarry: {
      moose: {
        status: 'draw',
        seasons: [
          { from: '09-01', to: '10-31', what: 'bulls, bow only, drawn licence' },
          { from: '11-01', to: '11-30', what: 'bulls, drawn licence' },
        ],
        note: 'Moose by draw only here (3 resident bull licences in 2026); no cows or calves.',
      },
      deer: {
        status: 'hunted',
        seasons: [
          { from: '09-01', to: '10-31', what: 'white-tailed deer of either sex, bow only' },
          { from: '11-01', to: '11-30', what: 'white-tailed deer of either sex' },
        ],
        note: 'Mule deer bucks by draw only; no does. Deer heads from 324 go in for CWD testing within 30 days.',
      },
      blackBear: {
        status: 'hunted',
        seasons: [
          { from: '04-01', to: '06-15' },
          { from: '09-01', to: '11-30' },
        ],
        note: 'Bait only in the mapped parts of 324; two a year with the supplemental licence; no cubs under a year or sows with them.',
      },
      grizzly: AB_GRIZZLY,
      grouse: AB_GROUSE,
      ptarmigan: { status: 'absent' },
      elk: {
        status: 'hunted',
        seasons: [
          { from: '09-01', to: '10-31', what: '3-point or larger bulls, or antlerless, bow only' },
          { from: '11-01', to: '11-30', what: '3-point or larger bulls; antlerless by draw' },
          { from: '12-01', to: '02-28', what: 'antlerless by draw only' },
        ],
        note: 'Elk are scarce here: 4–11 taken a year in 324 in 2021–25 (2–7% of elk hunters); steadier in WMU 320 Bearberry to the south-east.',
      },
      cougar: AB_COUGAR,
      wolf: { status: 'hunted', seasons: [{ from: '09-01', to: '06-15', what: 'residents need no licence' }] },
      caribou: { status: 'absent' },
      sheep: { status: 'absent' },
      goat: { status: 'absent' },
    },
    notes: ['West of the North Fork Road and north of Hwy 752 is WMU 326: deer by rifle from 17 Sept.', AB_PLACES, AB_ROADS],
  },
```

**What the entries do in the app.**
- With `zone.name` "326", `REGS_HERE` is the 326 entry.
- Moose shows as "permit only". Bear shows as "black bear", and grizzlies' `noSeason` turns the kill-site card on.
- The grouse target drops ptarmigan.
- On 18 Oct no target carries a warning, since all have an open season.
- The 324 entry is ready for per-cell zones (change 10).

## 3. The place

**Height and treeline.** The ground runs 1,014–1,372 m, median 1,176 m (MRDEM-30), and is gentle: median slope 4°, 90th percentile 11°, 6.6% of cells at 12° or more. **No treeline comes near it.**
- Alberta's Alpine subregion "includes all areas above tree line" from "as low as 1900 m in the north" [S] ([Natural Regions Committee 2006](https://www.albertaparks.ca/media/2942026/nrsrcomplete_may_06.pdf)).
- The nearest Alpine polygon is 38 km SSW, with its edge at about 1,960 m. The nearest Subalpine is 18 km SW, at about 1,700 m.
- `build_profile.py`'s own test fails: the 98th percentile of treed elevation is 1,320 m, and only 2.0% of land lies above it, 17% of that open, against the 5% and 60% it needs. The profile will say "forest to the tops", and every treeline rule stays off [I] (place-elevation-landcover-cuts-stands.md).

**Forest.** The Lower Foothills here has "the most diverse forests in Alberta": aspen, balsam poplar, lodgepole pine, white and black spruce, balsam fir and tamarack, "as pure stands or as mixtures". Pure deciduous stands grow on all aspects, and black spruce–tamarack fens sit on low wet sites. The Upper Foothills is "closed-canopy conifer stands of lodgepole pine, black spruce and white spruce", with pure aspen "generally restricted to southerly aspects" [S] (same source).

| Map | Shares |
|---|---|
| 2020 land cover | needleleaf 52%, mixed 13%, shrubland 17%, grassland 6%, wetland 5%, cropland 3%, built-up 2% |
| SCANFI v2, share of crown closure | lodgepole pine 30%, "other conifer" (mostly white spruce here) 34%, broadleaf 26%, black spruce 7%, tamarack 3% |

The median SCANFI stand is 19 m tall, 67% closed and 104 years old [S] ([NRCan land cover](https://datacube-prod-data-public.s3.ca-central-1.amazonaws.com/store/land/landcover/landcover-2020-classification.tif); [SCANFI v2](https://ftp.maps.canada.ca/pub/nrcan_rncan/Forests_Foret/SCANFI/v2/)).

**Disturbance is logging.** CanLaD puts harvest since 1985 on **23% of the region**, against 0.02% burned. The province's fire perimeters show one 5 ha fire in ten years [S] ([CanLaD v1.1](https://ftp.maps.canada.ca/pub/nrcan_rncan/Forests_Foret/canlad_including_insect_defoliation/v1.1/)). The WMU 326 survey report says "Cut-blocks comprise about 35% of the unit." Cut ages in fall 2026, as a share of the land:

| 0–4 yr | 5–9 yr | 10–20 yr | 21–30 yr | 31–41 yr |
|---|---|---|---|---|
| 2.7% | 4.2% | 6.1% | 8.1% | 1.9% |

**The 2020 land cover misreads them:**
- 54% of the 5–9-yr cuts and 45% of the 10–14-yr cuts are mapped "grassland";
- 60% of the 15–20-yr cuts are "shrubland";
- cuts made after 2020 still show as forest (84% "needleleaf");
- read the other way, 58% of the "grassland" class is cutblock, while only 4% of "cropland" is.

**Water.** The box has no river:
- Prairie Creek runs 30 km inside it, 2 km from the spot; North Prairie Creek 22 km and Lick Creek 7.5 km.
- Rat Lake is a stocked pothole.
- Lakes are 0.1% of the land and wetlands, mostly fens, 5%.
- The North Saskatchewan is 13 km north and the Ram 15 km north-west.

**Roads and lines** [G] (place-roads-alberta-access-layer.md; access-alberta-access-layers-box-footprint.md; [Access and Facility Roads, OGL-Alberta](https://geospatial.alberta.ca/titan/rest/services/transportation/access_facility_roads/FeatureServer/0)):
- **Density.** Alberta's authoritative road layer has **1.04 km/km²**: one-lane gravel 0.69, dry-weather 0.18, two-lane paved 0.10 (Hwy 752 and the North Fork Road), driveways 0.04 and two-lane gravel 0.02. All-weather roads come to 0.82 km/km². The driveways are mostly farmyard approaches in the White Area.
- **Distance.** 44% of the box is within 250 m of a road, 73% within 500 m and 96% within 1 km. **No point is more than 1.7 km from a road**; only 10.7% is more than 1 km from an all-weather road.
- **Cutlines.** The province's Base Features "cutline-trail" layer adds **918 km (3.58 km/km²)**. It does not separate seismic lines, pipelines and quad trails. 79% of the box is within 150 m of a road or cutline.
- **Wells.** There are about 155 well sites, roughly 0.6 per km².
- **The region.** The Foothills Natural Region averages about 4.2 km/km² of linear features (an ABMI figure seen only as a search snippet). Seismic density ran to 4.4 km/km² "near Rocky Mountain House" in the central east-slopes wolf work [S] ([McKenzie et al. 2012](https://www.ebi.ac.uk/europepmc/webservices/rest/PMC3293201/fullTextXML)).
- **Traffic.** Hwy 752 carried 1,000–1,460 vehicles a day in 2025 at Range Road 91, inside the box near its east edge, and 140–150 at its south-west end [G] ([Alberta highway traffic volumes](https://open.alberta.ca/opendata/traffic-volumes-at-points-on-the-highway)).

**Animals and hunters, from the province's own counts** [S] ([326 survey 2020](https://open.alberta.ca/dataset/0f127e10-1495-43ff-9304-4ecc58664cb7/resource/d7e165e9-b97a-4d97-a4a3-7d5d5ace6614/download/aep-awsr-wmu-326-aerial-ungulate-survey-moose-2019-2020.pdf); [318/324 survey 2018](https://open.alberta.ca/dataset/bc9fef0e-8dd8-4681-873e-661c41ed8608/resource/a411940b-028c-41a9-bda5-3ba746450cc9/download/wmu318-324moosesurvey-2018.pdf); [harvest reports](https://open.alberta.ca/dataset/f9fa700a-e40f-4b14-92ff-287bada5b14c)):
- Mid-winter surveys found 0.14 moose/km² in 326 in 2020, against 0.40 in 2010, though the survey method changed between them. 324 had 0.15/km² in 2018.
- **"No elk were observed"** on either survey, and deer were too few to estimate.

| 2025 resident harvest | 324 | 326 |
|---|---|---|
| White-tailed deer | 527 (46% success) | 260 (34%) |
| Mule deer | 4 | 1 |
| Moose | 2 | 6 |
| Elk | 4 (2%) | 2 (1%) |
| Black bear | 28 (22%) | 7 (6%) |

- Harvest ÷ success gives about 1,150 deer hunters in 324 and 770 in 326 over the season, roughly one per km², and 100–200 elk hunters per unit [I].
- Montana elk hunters averaged 267 m from the nearest road, and only 3 of 96 went more than 1 km from one [S] ([Lyon & Burcham 1998](https://www.fs.usda.gov/rm/pubs/rmrs_rp003.pdf)). So in this box nearly all the pressure lands within a few hundred metres of a road [I].

**This is a roaded, hunted forest whose game is white-tailed deer.**

## 4. What the app will make of it as baked tonight

The bake log (`pipeline/bake-clearwater.log`, local and gitignored) started 20:53. It records "vectors: skipped, no vectors source for this area (bake.vectors)", "forest: skipped, no forest source for this area (bake.forest)" and "satellite: skipped". `bake_area.py`'s per-province defaults (`bake_by`) cover ON, YT, BC and QC only. The habitat grid will therefore come from the 2020 land cover and the MRDEM alone [I]:
- **No cut ages.** `disturbAge` comes from fire vectors, forest-map depletions and FRI-inferred cuts, and all three are empty.
- **Holes on the young cuts.** `build_habitat.py` gives NRCan class 10 (grassland) a cover class only under an updated forest map (QC, BC). It gives 15 (cropland) and 17 (built-up) none at all. All three become `nodata`, which `habitatScore` scores 0. That is 11.4% of the region and 8.4% of the 5 km ring, and most of the grassland is 5–14-yr cuts.
- **Cuts read as forest.** The 0–4-yr cuts read as dense conifer. Every needleleaf cell is `coniferDense`, whatever its closure.
- **No roads, streams, lake polygons or wetland vectors.** The road-traffic factor stays at 1, the riparian terms never fire, and every cell has the same carry-out.
- **The profile** will read `treeline: null`, `north: false`, CEC 5.4.2 "Clear Hills and Western Alberta Uplands" (Level I 5 Northern Forests), with `shrubHeight: false` and `leadSpecies: false` [S] ([CEC Level III service](https://services7.arcgis.com/oF9CDB4lUYF7Um9q/ArcGIS/rest/services/NA_Terrestrial_Ecoregions_Level_3/FeatureServer/3)).
- **The rules** will then be boreal Ontario's unchanged:
  - the Ontario cut curve and moose rut;
  - the Ontario black bear rule, with its jack-pine bonus and the 15 Oct switch;
  - `presence('grizzly')` and `presence('ptarmigan')` both 'absent', so no grizzly card;
  - no species-table entry, so every target shows with no season lines.

**The app would not have loaded the area.** `areas/check.ts` needs `zone.name` to be a string and `relief` to be numbers. `areas/index.ts` leaves out a file that fails, "and the build refuses one anyway (vite.config.ts)". The bake fills `relief`, but it fills `zone.name` only from a baked `wmu-<id>.geojson`, which nothing writes for AB, and its own log line says "the app leaves the area out until it is set" [I].

The bake session fixed this during the research:
- the area file now has `zone: { label: 'WMU', name: '326' }` and `relief: [1070, 1328]`;
- the profile it wrote is the one predicted above: `treeline: null`, CEC 5.4.2, `north: false`, both stands flags false;
- `bake_area.py` now gives AB the label "WMU" and new areas `name: ""`.

`bake.forest` and `bake.vectors` were still null when last read, at 22:50 EDT.

The session also made a second area, `clearwater-east` (WMU 324, centre 52.256, −114.968). Its region is 96% WMU 324 and 4% WMU 322. **It is 91.5% White Area**, the reverse of Clearwater's 92% Green.
- The 324 entry above serves it.
- The field class (change 3) and the private-land permission line matter more there than here.

**Two more pipeline gaps.**
- SCANFI's species codes in this box are Pl, Cx and Hx. `build_habitat.py`'s `lead_code` has none of them, so with `ca.scanfi` about 92% of treed cells would get lead 0. Lodgepole pine is then not a pine for spruce grouse; jack pine was the Ontario stand-in.
- `area_checklist.py` would print "ok, surveyed inventory (?, ?)" for Forest stands. When `bake.forest` is null, the check falls into its "surveyed inventory" branch, so it is a false ok.

**What the profile gets right and what it cannot say.** Once the bake is fixed, the profile is right: `north: false` at 52° N in the Boreal Plains (the Yukon and Alaska burn and rut calendars don't belong), and no treeline. What it cannot say today is the subject of section 5:
- grizzlies are present and protected;
- the deer are foothills whitetails and the main game;
- fields and young cuts are forage;
- the regulations change across a road.

## 5. The species

### Moose: right shape, wrong tails, and roads matter more than access

The evidence:
- **[S] Moose are few.** 0.14–0.15/km² in mid-winter (survey-and-harvest-wmu-324-326.md).
  - The 2010-to-2020 drop in 326 is partly a change of survey method: random blocks in 2010, 25% strip transects in 2020 with no sightability correction. Sightability on transects in west-central Alberta is 46–67% (Peters et al. 2014, via moose-wmu326-decline-records.md).
  - [I] The true 2020 density was probably 0.2/km² or more, still a decline. Bulls-only harvest of 6–21 a year is an unlikely main cause. A 1996–2005 cut cohort closing over by 2020 fits the timing.
- **[S] Thirty-two years of foothills cuts near Hinton (Stelfox 1988):**
  - "big game abundance increased up to Year 17 but then declined sharply by Year 26."
  - Upland pine cuts at 1,350 m held moose through year 32. They became winter cover at 15–20 yr; spruce and mixedwood cuts did so only at 25–30 yr.
  - Access "caused an almost complete evacuation of the area by elk, and to a lesser extent by deer, within a week of the opening of the fall big game season".
  - There was "negligible big game sign within 335 m of gravel pit activities" ([Stelfox 1988](https://www.archive.org/download/forestsuccession00stel/forestsuccession00stel.pdf)).
- **[S] Camera traps in 117 west-central Alberta harvest blocks** ([McKay & Finnegan 2023](https://www.cclmportal.ca/sites/default/files/2024-02/Ecol%20Sol%20and%20Evidence%20-%202023%20-%20McKay%20-%20Ungulate%20occurrence%20in%20forest%20harvest%20blocks%20is%20influenced%20by%20forage%20availability%20.pdf)):
  - From April to 7 Nov, moose use followed willow (β +0.268), horsetail (+0.290) and bluejoint (+0.175). It fell with road density within 1 km (−0.188). Block age had no effect.
  - In winter, blocks ≤25 yr (+0.649), deciduous saplings (+0.667) and highbush cranberry (+0.467) carried it.
- **[S] Central BC pine country** ([BC moose project 2023](https://www2.gov.bc.ca/assets/gov/environment/plants-animals-and-ecosystems/wildlife-wildlife-habitat/moose/ten_year_provincial_moose_project_report_2023.pdf)): moose avoided cuts 1–8 yr old, selected 9–24 yr and avoided 25–40 yr.
- **[S] Seven GPS-collared foothills moose** ([Finnegan et al. 2023](https://www.cclmportal.ca/sites/default/files/2023-08/Ecosphere%20-%202023%20-%20Finnegan.pdf)):
  - 13–17% of locations were within 50 m of seismic lines, against 3–5% for roads.
  - They chose wet areas and wet shrub, and as a population were indifferent to roads.
  - Calving moose in north-east Alberta moved toward riparian features ([Dickie et al. 2020](https://pmc.ncbi.nlm.nih.gov/articles/PMC7028095/)).
- **[S] Hiding cover.** Where human activity is high, moose stay within 60–80 m of hiding cover (Tomm et al. 1981, via moose-tomm-1981-cover-and-alberta-classics.md).
- **[S] Heat.** Renecker & Hudson's 14 °C and 20 °C heat-stress thresholds come from central Alberta. At the Prairie Creek station (1,173 m), days topped 14 °C on 67–76% of 1–15 Sept and about 40% of 1–15 Oct (moose-heat-stress-and-rut-timing.md).
- **[S/H] Rut.** North Dakota conceptions average 2 Oct ± 8 days. An Edmonton guide puts the peak at 27 Sept–4 Oct.

**What the rules get right [I].** The 10–20-yr cut peak, the 80 m edge, dense conifer as cover, the 14/20 °C thresholds, the rut curve and the slope factor.

**What they get wrong here [I]:**
- 5–9-yr cuts score 0.7, where pine-country moose avoid cuts under about 9 yr.
- 21–30 yr is one flat 0.6, and pine cuts are not told from spruce.
- **Streams earn nothing.** The "willow creek draw" term needs `b.dz`, a treeline.
- Seismic lines are missing.
- The road-traffic "0.85 on a road or trail" stacks with access 0.85 within 150 m, which counts the same thing twice. Neither separates cells here.

**Changes** (numbers [I]; change 7 below):

| Cut age | 0–4 yr | 5–8 yr | 9–20 yr | 21–25 yr | 26–30 yr | 31–60 yr | older |
|---|---|---|---|---|---|---|---|
| Moose browse | 0.2 | 0.5 | 1.0 | 0.75 | 0.4 | 0.3 | 0.2 |

- **Pine-led cuts.** Floor at 0.5 from 21 to 35 yr. Count them as hiding cover from 15 yr, and spruce or mixedwood cuts from 25 yr.
- **Streams.** +0.15 within 100 m of a mapped stream for shrub, hardwood, mixed and wetland cells, with no treeline needed.
- **Edge.** 80–200 m 0.5 and 200–400 m 0.2, against 0.6 and 0.3 now.
- **Road presence in open season**, replacing the flat 0.85:

  | Distance from an open road | <100 m | 100–300 m | 300–500 m |
  |---|---|---|---|
  | Factor | ×0.7 | ×0.85 | ×0.95 |

  Keep ×0.6 within 250 m of Hwy 752.
- **Warm threshold.** 12 °C for 16–30 Sept, 10 °C in October and 5 °C from 1 Nov.
- Keep the rut curve.
- **Caption.** Say that moose are scarce and the map is relative.

### White-tailed deer (and mule deer): the main game, with the least-fitted rules

The evidence:
- **[S] Alberta breeding dates.** Fetuses from WMU 234 (east-central Alberta, n = 227 white-tailed deer) put about 70% of conceptions on 16–30 Nov, median about 22 Nov. "Eighty percent of the white-tailed deer had conceived by 30 November." Mule deer bred mostly in early December ([North Border Deer Study 2013](https://open.alberta.ca/dataset/4fc0a791-6ade-441c-a2d9-e750ff55da5e/resource/ab3a3905-f238-465e-8645-0dc038add2fa/download/2013-cwdnorthborderdeerstudyreport-apr2013.pdf)).
- **[G] Agencies agree.** North Dakota puts the peak at 15–20 Nov, and Hinterland Who's Who puts most breeding in "the last three weeks of November". Observable rutting peaks about two weeks before the mean breeding date (MDWFP).
- **[S] Foothills cut blocks** ([McKay & Finnegan 2023](https://www.cclmportal.ca/sites/default/files/2024-02/Ecol%20Sol%20and%20Evidence%20-%202023%20-%20McKay%20-%20Ungulate%20occurrence%20in%20forest%20harvest%20blocks%20is%20influenced%20by%20forage%20availability%20.pdf)):
  - White-tailed and mule deer used blocks ≤10 yr old most (β +0.379 and +0.394). Use dropped about tenfold after 8 Nov.
  - Dense planted lodgepole pine lowered use (−0.274).
  - More cut area within 1 km slightly lowered white-tailed deer use, and they were found farther from seismic lines.
  - Mule deer sat on steeper, higher ground, farther from roads (+0.653).
- **[S] Pressure.** In the Hinton cuts, deer "had vacated the clear-cuts" within a week of the September opener. A valley closed to vehicles held 6–12 whitetails, against fewer than 6 next to an active gravel pit (deer-stelfox-1988-hinton-clearcuts.md).
- **[G] Edge distances.** The Foothills Model Forest models: "Most white-tailed deer habitat use is within 180 metres of cover/open area edges." Food scores fully within 140 m of cover and zero beyond 220 m. The models are untested ([FMF 1999](https://friresearch.ca/data/null/HSP_1999_10_Rpt_WhiteTailedDeerWinterHabitat.pdf)).
- **[S] Fields.** Alberta parkland whitetails sat where a fifth to a third of the 100 m around them was cropland and 55–66% woody (North Border study). In Idaho, deer were 6.4–6.8× more likely at a field edge than 2.7 km away from half an hour before sunset to 1.5 h after ([Groth 2020](https://objects.lib.uidaho.edu/etd/pdf/Groth_idaho_0089N_12011.pdf)).
- **[S] Activity.** Fall Alberta whitetails are crepuscular, with midday movement about 0.2–0.3 of the peaks; bucks also move at night. Wisconsin buck movement doubled from mid-October to the peak ([Hunsaker et al. 2025](https://doi.org/10.1002/ece3.71589)).
- **[S] Range.** Winter limits the boreal range edge, not Clearwater in fall. At 52.3° N the box is core range (deer-winter-severity-dawe-boutin-laurent.md).

**What the rules get right [I].** Forage next to cover, hardwood and mixedwood valued highly, and hour weights with midday at 0.3.

**What they get wrong [I]:**
- **The cut curve.** Deer get half the moose score, so their cuts peak at 10–20 yr where deer peak at ≤10 yr.
- **Cover distances don't discriminate.** "Cover within 500 m" holds nearly everywhere.
- **The south-slope term dominates.** +0.3 on any slope ≥3° facing 135–225° is added after halving. It reaches 16.6% of the box. Dense conifer on a south slope scores about 0.66, an aspen edge on the flat about 0.59.
- **Fields score zero.**
- **There is no rut.** `activityVerdict` applies `rutFactor` to moose only.
- **There is no pressure term**, and the shore bonus is a moose rule.

**Changes** (a deer branch of its own; numbers [I]; change 5):

| Cover | Hardwood | Mixed, ≥40% hardwood | Mixed, <40% | Shrub | Open conifer | Dense conifer | Treed wetland | Open wetland |
|---|---|---|---|---|---|---|---|---|
| White-tailed deer browse | 0.85 | 0.9 | 0.7 | 0.8 | 0.4 | 0.3 | 0.35 | 0.3 |

| Cut age | 0–2 yr | 3–10 yr | 11–20 yr | 21–30 yr | 31–60 yr |
|---|---|---|---|---|---|
| Deer | 0.6 | 1.0 | 0.8 | 0.5 | 0.35 |

- Planted pine regeneration ×0.7.
- **Edge,** both ways (food to cover, cover to food): ≤140 m 1.0, 140–180 m 0.6, 180–220 m 0.3, beyond 0.
- **Fields** (the new field class): 0.8 within 50 m of woody cover, 0.6 to 140 m, 0.3 to 220 m, 0.1 beyond. A woody cell within 100 m of a field gets +0.2.
- **Shore.** +0.05, not 0.15.
- **Aspect.** +0.1 for white-tailed deer on slopes ≥5° facing 135–270°, only from 1 Nov or with snow on the ground. The mule deer note says broken south and west slopes.
- **From 8 Nov or 30 cm of snow.** Open cells more than 140 m from conifer ×0.6; conifer cover near food ×1.2.
- **Pressure,** in open season and legal light: ×0.5 within 100 m of a drivable road and ×0.8 at 100–300 m.
- **Rut factor** f, with mult = 0.6 + 0.4·f as for moose:

  | Dates | to 20 Oct | 21–31 Oct | 1–7 Nov | 8–28 Nov | 29 Nov–7 Dec | 8–20 Dec | after |
  |---|---|---|---|---|---|---|---|
  | f | 0.2 | 0.4 | 0.7 | 1.0 | 0.7 | 0.4 | 0.2 |

- **Hours.** Midday 0.5 when f ≥ 0.7. Field cells ×1.3 at last light and ×0.6 at midday.

The 324 rifle season (1–30 Nov) covers the whole rut. Archery is pre-rut, when young cuts, field edges and last light matter most.

### Black bear and grizzly: earlier for black bears, later for grizzlies, and the card

The evidence:
- **[S] Foothills grizzly fall diet** ([Munro et al. 2006](https://sites.ualberta.ca/~scottn/documents/MunroEtAl2006.pdf), west-central Alberta foothills bears):
  - Fruit, led by buffaloberry, was 42–63% from early August to early September. "Berries were consumed until mid-September."
  - Sweetvetch roots then took over: 46% in late September, 79% in early October. Ungulates stayed at 8–12%.
- **[G] Alberta's own season split.** The BMA 4 summaries use berry 16 July–15 Sept and post-berry 16 Sept to den-up (bear-bma4-clearwater-grizzly-2018.md).
- **[G] Black bear denning.** In Alberta, black bears enter dens "between late September to early November", earlier in poor food years, pregnant females first. They den mostly in mature conifer or mixedwood ([black bear plan 2016](https://open.alberta.ca/publications/9781460119297)).
- **[S] Grizzly denning.** In west-central Alberta, grizzlies enter dens at a mean of **12 Nov** (20 Oct–19 Dec), reaching den areas from 14 Oct. Good berry years delay entry ([fRI 2022](https://friresearch.ca/wp-content/uploads/2023/10/GBP_2022_03_DenningWCAlberta_Final.pdf)).
- **[S] BMA 4 Clearwater** ([fRI 2020](https://friresearch.ca/sites/default/files/GBP_2020_12_BMA%204%202018%20Population%20Inventory%20Report.pdf)):
  - About 88 grizzlies in 2018 (59–130), rising about 6% a year, with females spreading east.
  - Density in the Secondary zone is 5.8 per 1,000 km², against 11.6 in Core.
  - [I] That is roughly one home-range centre in the box, with several ranges overlapping it.
- **[G] Mortality.** Human-caused grizzly deaths in BMA 4 run at 5.3% of the population a year, above the plan's 4%. Self-defence kills are "usually by hunters", and black bear hunters misidentifying grizzlies are a top-four cause ([Recovery Plan 2020](https://open.alberta.ca/publications/9781460147917)). 19 of 22 deaths were within 500 m of a road ([Boulanger & Stenhouse 2014](https://pmc.ncbi.nlm.nih.gov/articles/PMC4274100/)).
- **[S] Carcasses.** Grizzlies buried 75.9% of carcasses and stayed 24–40 h on average, up to 249 h ([Cristescu et al. 2014](https://sci-northernalberta.ca/wp-content/uploads/2022/01/Cristescu-et-al.-2014_ANIM-BEHAV.pdf)).
- **[H] Recent incidents.** A hunter was mauled south of Cochrane in BMA 4 on 30 Oct 2025.
- **[S/G] Cuts.**
  - Buffaloberry fruit is "stable until canopy cover reached more than 50%". In fall, grizzlies neither favoured nor avoided cuts ([Nielsen et al. 2004](https://sites.ualberta.ca/~scottn/documents/NielsenPhDa.pdf)).
  - Black bears avoid regeneration under 5 years and select 5–24-yr stands; that evidence is from outside Alberta.
  - At Cold Lake, aspen was the best food habitat and muskeg the worst.

**What the Ontario rule gets right [I].** Berries in regenerating cuts, and thick conifer for late fall.

**What it gets wrong [I]:**
- The berry switch comes a month late: 15 Oct against about 15 Sept.
- Nothing dens the black bears.
- The jack-pine bonus has no meaning here, where lodgepole pine is not even coded.
- Fens get too much weight for black bears.
- No grizzly card.

**Changes** (numbers [I]; change 6):
- **Dates.**
  - From **15 Sept**: cuts 5–25 yr, regen and shrub ×0.7 (not ×0.5); upland conifer ×1.3; aspen and mixedwood ×1.1. Verdict: "Buffaloberries are done: bears are on the last fruit, roots and carcasses."
  - **Black bear presence**: ×0.7 from 1 Oct, ×0.4 from 20 Oct, ×0.2 from 5 Nov. Upland conifer and mixedwood ×1.6 for den cover from 1 Oct.
  - **Grizzlies**: no den down-weight before about 1 Nov.
- **Berry cut curve:**

  | Cut age | 0–4 yr | 5–20 yr | 21–25 yr | 26–30 yr | older |
  |---|---|---|---|---|---|
  | Bear | 0.5 | 1.0 | 0.8 | 0.6 | the stand |

- **Stand values.** Lodgepole-led ≤25 yr or under 50% canopy 0.6 (0.4 after 15 Sept), replacing the jack-pine terms. Aspen and mixedwood 0.6; treed wetland 0.25 and open wetland 0.2 for black bears.
- **Cover.** +0.2 within 200 m, tapering to 0 at 400 m.
- **Roads.** Black bears ×0.7 within 250 m of an open road in season.
- **Grizzly kill-site card, 1 Sept–30 Nov.** The app's three lines already match Alberta's wording. Add Alberta's own lines ([Bears and hunters](https://www.alberta.ca/bears-and-hunters)):
  - spray first;
  - hang meat 3.5 m up and 1.5 m out from trees, where it can be seen from a distance;
  - get the meat out fast;
  - never drag it to camp, and keep it at least 100 m from camp;
  - if the kill has been moved or buried, leave and call 310-0000;
  - calls, decoys and cover scents draw bears too.

  The black bear verdict should carry an ID line: hump, short round ears and long pale claws tell a grizzly, colour does not.

### Grouse: ruffed in aspen, spruce in pine, and no dusky grouse or ptarmigan

The evidence:
- **[S] Ruffed grouse dominate.** About 61,000 ruffed grouse were taken in Alberta in 2020, against about 6,900 spruce grouse ([ACA 2025](https://www.ab-conservation.com/downloads/report_series/aca_project_report_2025_forest_grouse_monitoring_initiative_final.pdf)). Within 30 km of the spot, GBIF holds 149 ruffed and 24 spruce grouse records (grouse-presence-dusky-ptarmigan-sharptail-records.md).
- **[S] ABMI's Alberta ruffed grouse model** (breeding-season data) ([ABMI](https://abmi.ca/species/ruffed-grouse)):

  | Stand | Value |
  |---|---|
  | Deciduous cutblock, 0 / 10 / 20 / 40 / 60 yr | 0.59 / 1.0 / 0.88 / 0.64 / 0.54 |
  | Mixedwood cuts, 10–20 yr | 0.78–0.80 |
  | White spruce cuts | 0.63–0.71 |
  | Lodgepole | 0.10–0.26 |
  | Shrub | 0.17 |
  | Crop | 0.05 |

  Seismic lines raise the value by 33% and pipelines by 30%.
- **[S] Fall and winter feeding.** Alberta grouse feed in older aspen: 36 yr on average (20–80). Fall foods are highbush cranberry, red-osier dogwood and rose ([FRI 1999](https://friresearch.ca/data/null/HSP_1999_10_Rpt_RuffedGrouseWinterForagingHabitat.pdf)).
- **[S] Spruce grouse in pine.** In the Hinton cuts, spruce grouse appeared in pine clearcuts at 17–27 yr and were "abundant in both pine clear-cuts" by year 32 (Stelfox 1988). South-west Alberta lodgepole held 24 birds per 100 ha at 30 yr (secondary source).
  - In mid-October they migrate between summer and winter sites, females arriving at a median of 14 Oct ([Condor 1980](https://digitalcommons.usf.edu/condor/vol82/iss4/2)).
- **[S] Absent species.**
  - **Dusky grouse.** Alberta fall records have a median elevation of 1,867 m in September and 2,042 m in October. The nearest record of any season is on Baseline Mountain at 1,902 m; the box tops out at 1,372 m.
  - **Ptarmigan.** Regional records are at 2,081–2,294 m.
  - **Sharp-tailed grouse.** None within 30 km, and no season (grouse-presence-dusky-ptarmigan-sharptail-records.md).
- **[S, secondary] Roadsides.** Hunters shoot near-road birds: 48% of banded males shot were within 100 m of a road, falling to 1% beyond 300 m (Fischer & Keith 1974, via a habitat model).

**What the rule gets right [I].** Aspen 6–25 yr as the core, roadside grit, and the hardwood–conifer edge.

**What it gets wrong [I]:**
- Shrub at 0.8 is too high.
- Lodgepole pine is invisible as a pine lead.
- Spruce grouse in 15–40-yr pine regeneration are not scored.
- The aspen gate at ≥40% hardwood misses the mixedwoods.
- Treed fen is too high for ruffed grouse.

**Changes** (numbers [I]; change 8):

| Ruffed grouse | Value |
|---|---|
| Aspen-ish gate | hardwood ≥30% |
| Aspen 0–4 yr | 0.6 |
| Aspen 5–25 yr | 1.0 |
| Aspen 26–50 yr | 0.7 |
| Aspen 51–80 yr | 0.55 |
| Aspen older | 0.4 |
| Mixedwood | 0.8 × aspen |
| White spruce cut 5–25 yr | 0.65 |
| Lodgepole | 0.2 |
| Shrub | 0.45, +0.2 within 100 m of aspen ≥20 yr |
| Water within 50 m | +0.1 |
| Seismic line or pipeline within 30 m, in aspen or mixedwood | +0.1 |

| Spruce grouse, conifer ≥70% led by lodgepole, white or black spruce | Value |
|---|---|
| 0–10 yr | 0.1 |
| 10–15 yr | 0.25 |
| 15–30 yr | 0.4 rising to 0.8 |
| 30–40 yr | 0.8 |
| 40–100 yr | falling to 0.45 |
| Older | 0.4 |
| Spruce or fir mixed into pine | +0.1 |

- **Combined.** Grouse score = max(ruffed, 0.8 × spruce).
- **Roadside.** Keep +0.25, widen it to 60 m and make it a dawn, dusk and frost term. Halve it within 100 m of a drivable road after the season's first three weeks.
- **Absent.** Ptarmigan and dusky grouse 0. No cycle multiplier: no source gives Alberta's 2025–26 phase.

### Roads, lines and hunters (the site factors)

The evidence:
- **[S] Elk vigilance.** Elk switched to vigilance at "at least 1 vehicle every 2 hours". Herds were 67.7% vigilant within 250 m of a road and 54.8% beyond 1 km ([Ciuti et al. 2012](https://pmc.ncbi.nlm.nih.gov/articles/PMC3509092/)).
- **[S] Grizzlies.** They avoided roads carrying over 100 vehicles a day at all times (Northrup 2012, abstract).
- **Hwy 752** carries 1,000+ vehicles a day in the east of the box.
- **[S] Wolves.** They travel 2–3× faster on conventional seismic lines, pipelines and roads ([Dickie 2017](https://doi.org/10.1111/1365-2664.12732)). In the foothills, wolves moved faster near lines with vegetation under 0.7 m, and 75% of lines still had vegetation under 1 m decades after cutting ([Finnegan 2018](https://pmc.ncbi.nlm.nih.gov/articles/PMC5901995/)).

**Changes** [I] (change 9):
- **Classify Alberta's roads** from FEATURE_TYPE and ROAD_CLASS:

  | Class | Codes |
  |---|---|
  | highway | 3, 6–9, or ROAD_CLASS PRIMARY/SECONDARY (which catches gravel numbered highways) |
  | road | 4, 5, 14 |
  | trail | 2, 12 |
  | dropped from access | 1, 10 (driveways become a 183 m "occupied building" ring) |

- **Traffic factors by class:**

  | Class | Factor |
  |---|---|
  | highway | keep ×0.6 within 250 m, rising to 1 by 1 km |
  | road | ×0.8 to 150 m, ×0.9 to 400 m, ×0.95 to 700 m |
  | trail | ×0.9 to 100 m |

  Keep only one of the access 0.85 and the traffic 0.85 within 150 m.
- **Cutlines** never go into the traffic factor: they would hit 79% of the box. Use them, once ABMI's Human Footprint Inventory separates seismic lines from pipelines and trails, for the moose seismic term and the predator note.
- **Quiet pockets.** ×1.1 more than 1 km from an all-weather road (10.7% of the box).
- **Recreation areas.** Mask the three PRAs.

## 6. Elk: legal, but rare here

**Range-gate status: present and hunted, but rare.** In ELK-SCIENCE.md's four states this is "edge or rare", the case it defines as "a season with near-zero harvest". The evidence:
- **[G] The season.** Bulls of 3 points or more are a general season in both WMUs (bow to 31 Oct, rifle in November). Antlerless elk are open only in 324, with 4 late draw licences. The managers are not trying to cut elk numbers here.
- **[S] The harvest.** 2016–25 averaged 4.4 elk a year in 324 and 3.5 in 326, 0.3–0.4 per 100 km² a year, at 1–7% success.

  | 2016–25 | Elk a year | Per 100 km² | Success |
  |---|---|---|---|
  | 324 | 4.4 | 0.43 | 2–7% |
  | 326 | 3.5 | 0.33 | 1–6% |
  | 318 James | 13.5 | 1.17 | |
  | 322 Horseguard | 10.8 | 0.75 | |
  | 320 Bearberry | 49.7 | 5.66 | 9–17% |
  | 305 South Porcupine Hills | 352 | about 16.7 | |

  Over the 256 km² box that is about one elk a year (elk-ab-harvest-draws-2010-2025.md). Alberta's resident elk harvest was 9,781 in 2025.
- **[S/G] Surveys and records.**
  - Mid-winter surveys of 324 (2018), 318 (2018) and 326 (2020) saw no elk. The same design found 167 in 320 and 57 in 322 in December 2018.
  - GBIF has no elk record within 25 km of the spot and 5 within 50 km (elk-ab-aerial-surveys-gbif.md).
- **[S] Where the elk are.** The nearest herds are the farmland-edge elk to the east and north (322, 332, 336), Bearberry–Sundre to the south-east (320), and the Ya Ha Tinda herd 64 km SSW. That herd fell from about 2,200 in the early 1990s to 330–400. Its "eastern migrants" summer in industrial forest round the Dogrib burn and WMUs 316/318, more than 13 km south of the box ([Ya Ha Tinda final report 2021](https://www.umt.edu/yahatinda/files/ya-ha-tinda-elk_final-report_2017-2021_small.pdf)).
- **[S] Why so few.**
  - Roads: the box's 1.04 km/km² is twice the ≤0.5 km/km² at which hunted elk were most likely to occur, and inside the 1–1.5 km/km² band where road effects "saturate the landscape". Roads beside clearcuts cost "50–75%" of the cuts' forage value ([Frair et al. 2008](https://doi.org/10.1111/j.1365-2664.2008.01526.x)).
  - Wolves: they run 9.7–22.3 per 1,000 km², and seismic density peaks "near Rocky Mountain House". Wolf encounter rates rise with line density, "most pronounced at low prey densities" ([McKenzie et al. 2012](https://www.ebi.ac.uk/europepmc/webservices/rest/PMC3293201/fullTextXML)).
  - Cougars, bears and hunters add to it.
  - Feral horses outnumber elk on cameras in the Sundre zone next door: summer occupancy 0.80 against 0.19 ([Boyce & McLoughlin 2025](https://www.frontiersin.org/journals/conservation-science/articles/10.3389/fcosc.2025.1585546/pdf)). They are not a factor in the box itself: 16 were counted across WMU 326 in January 2020, but the province's 2025 and 2026 counts logged none inside the box, though the 2026 flights crossed it (elk-feral-horses-sundre.md).

**What the planned elk rules would get wrong here [I]:**
- **The cut curve peaks late.** The planned curve, from Starkey, peaks at 10–20 yr. Foothills forage peaks at about 9 yr after felling ([Visscher & Merrill 2009](https://doi.org/10.1016/j.foreco.2008.08.018), snippet), elk avoid the first 5 years (Stelfox 1976), and lured cameras found elk most in blocks under 10 yr. A foothills curve: 0–2 yr 0.4, 3–5 yr 0.7, 6–12 yr 1.0, 13–17 yr 0.8, 18–25 yr 0.5, 26–33 yr 0.3, older 0.2, plus up to +0.15 for deciduous regeneration or deciduous forest within 1 km.
- **Roads should multiply the forage, not add to it**, and they should bite in season and by day. Outside the hunt, Ya Ha Tinda residents used people as a shield from wolves.
- **The road ramp saturates here.** The planned 1.5 km (rifle) and 2.8 km (archery) stretch would flatten a box where no point is 1.7 km from a road. Give the area a "low security" flag from its linear density, good at ≤0.5 km/km² and saturated above 1.5, and rank cells within it by distance to open roads.
- **Large cuts score at the edge, not the middle.** Elk "stayed near the edges of larger" cuts (FRIAA summary in elk-frair-central-foothills.md). The edge rule from ≥40% cover saturates in a box that is 65% forest, so decay value inside a cut with distance from its edge: 0–50 m 1.0, 50–150 m 0.6, beyond 0.3.
- **By day in season, open cuts are worth 0.1–0.2, not 0.3.**
- **The November rifle season is post-rut.** It gets rut weight 0.1 and a "still-hunt cover" verdict, not calling.
- **"Grassland" is not meadow.** In this box it is 5–14-yr cuts. Elk occupancy in the Sundre zone followed native rangeland.

**What an elk target would take (none of it built):**
1. **`types.ts`.** `HuntTarget` gains `'elk'`, with `HUNT_TARGETS` and `TARGET_NAMES`.
2. **`regs.ts`.** `Quarry` gains `'elk'`, and `QuarryStatus` gains `'rare'`. A testable rule would set it: a 5-year mean under 1 elk per 100 km² a year, with success under 5% or no elk on the latest winter survey. 324, 326 and 322 come out rare; 320, 332 and 305 come out hunted.
3. **`profile.ts`.** `TARGET_MEMBERS.elk = ['elk']`. `targetStanding` gives "rare here", and the habitat score is capped (for example ×0.5, with no "good spot" headline).
4. **`huntRules.ts` and `placeRules.ts`.** An elk branch with a day/night flag in `HuntCtx` (from `sinceSunriseH` and `toSunsetH`). It needs the foothills cut curve, ≥40% cover from `crown` and `distThick`, the edge, water near 0, and pressure from motorized routes multiplied in during the season.
5. **`activityVerdict`.** The elk rut and hours, no moose-style heat penalty, wind as hearing.
6. **Hunting mode.** Elk sounds, and the wider downwind sector.
7. **`heat_bands.py`.** Add `'elk'`.
8. **Alberta presence.** No open elk range layer was found, so the gate would read the WMU harvest reports (OGL-Alberta) and the aerial survey PDFs.

**Clearwater is not the right first elk area [I]:**
- It has about one elk a year to check a map against.
- The elk security distances (about 1.5 km from motorized routes in rifle season and 2.8 km in archery; Ranglack et al. 2017 in ELK-SCIENCE.md) are met nowhere in the box.
- It has no open lidar: no HRDEM item intersects the box (elk-ab-harvest-draws-2010-2025.md).

**Better first areas:**
- Outside Alberta, ELK-SCIENCE.md's Colorado Flat Tops or BC Bull River.
- In Alberta, a **WMU 320 Bearberry** box. 320 takes about 50 elk a year at 9–17% success, and 167 were counted there in December 2018. The best 16 × 16 km box, centred near 51.975 N, 114.55 W, is 82% covered by open 1 m HRDEM lidar. Its land status (likely partly White Area) was not checked.
- The Porcupine Hills (305) have far more elk, but almost no open lidar.

**For Clearwater now:** carry elk as one line in the zone notes, as in the proposed entries. Draw no elk heat.

## 7. Fishing

`FISH_HERE` is Ontario-only, so fishing stays off here by code, and it should: the app's lake species, depths and FMZ 7 seasons are Ontario's.

The box is in Alberta's **ES2** zone, the Red Deer and North Saskatchewan watersheds [G] ([ES2 rules](https://www.albertaregulations.ca/fishingregs/es2.html); [ES2 rivers table](https://www.albertaregulations.ca/fishingregs/ES2-Rivers.pdf)):
- **Species.** Prairie Creek and its tributaries held brook trout (introduced), mountain whitefish, burbot, longnose sucker and longnose dace in 1965 museum samples taken inside the box. Brown trout are recorded only about 15 km downstream. Bull trout records are all in the upper Clearwater and the North Saskatchewan, and any bull trout caught must be released.
- **Bait.** ES2 streams are bait-banned.
- **Seasons.** Prairie Creek above the North Fork Road crossing (52.261 N, 115.169 W) and its tributaries, which include North Prairie and Lick creeks, are open 1 Apr–31 Aug with 2 trout. From 1 Sept to 31 Oct they are **zero trout and zero whitefish**, and they close 1 Nov–31 Mar. Below the road the creek is open 1 Apr–31 Oct at zero trout.
- **Lakes.** Rat Lake, inside the box, is put-and-take: open all year, bait allowed, 5 trout. It was stocked with 2,500 brook trout in May and 700 catchable tiger trout on 1 Oct 2026 ([stocking report 2026](https://open.alberta.ca/dataset/be2e3289-2f94-461d-b4b9-ef50216b8157/resource/0390841a-ae35-4d1c-b6bb-fe04927984ce/download/fp-alberta-fish-stocking-report-2026.pdf)). Cow Lake, 8 km east, holds stocked rainbows, walleye, pike and perch.

On 18–19 Oct the creeks are catch-and-release only (fish-prairie-creek-rat-lake-es2-2026.md).

## 8. Rule and profile changes, in order

All numbers are [I] unless the species sections say otherwise. "Area" means `app/src/areas/clearwater.json`, which another session owns tonight: these are proposals for it.

### Tier 0: before the map means anything

1. **Let the app load the area.**
   - Area: `"zone": { "label": "WMU", "name": "326" }`. Done by the bake session; keep it.
   - `pipeline/bake_area.py`: `zone_label['AB'] = 'WMU'`, also done. Still to do: an AB zone lookup from the WMU service (`fishwild_wildlife_mgmt_unit_public`), so `zone_of` fills the name itself.
2. **Alberta bake inputs.**
   - `pipeline/bake_area.py` `bake_by['AB']`: `forest: ca.scanfi` (CanLaD cut years), `imagery: ca.s2summer`, and `vectors:` from a new `pipeline/ab_vectors.py`. That adapter would take Alberta Access and Facility Roads (OGL-Alberta), CanVec/NHN or provincial streams, lakes and wetlands, the WMU polygons and the Provincial Recreation Areas.
   - `pipeline/build_habitat.py`: `road_kind` gains Alberta's FEATURE_TYPE/ROAD_CLASS words (section 5). `lead_code` gains `Pl → 2` (pine), `Cx → 3` (white spruce) and `Hx → 7` (aspen), as `habitat_lite.py` already maps Hx. `Cx → 3` fits the Alberta foothills; elsewhere SCANFI's "other conifer" may be fir, so key that one on the province.
   - Rebake Clearwater's habitat, profile and the grids after it.
3. **Fields and young-cut grass are forage, not nodata.**
   - `pipeline/build_habitat.py`, `app/src/spots/habitatGrid.ts` (`COVER`, names) and `huntRules.ts`/`placeRules.ts`: a `field` cover class for NRCan 15, and for 10 outside CanLaD cuts. Inside cuts, 10 takes the cut's own class.
   - Values: moose 0.15, deer by the distance-to-cover table, bear 0.3, grouse 0.1 within 100 m of aspen, else 0.05.
   - The bush, lanes and going grids treat it as open ground.
4. **The species table.**
   - `app/src/spots/regs.ts`: the AB 326 and 324 entries in section 2, with `Quarry` gaining `'elk' | 'cougar'`.
   - `app/src/spots/profile.ts`: `QUARRY_NAMES`.
   - The grizzly `noSeason` turns on the kill-site card.

### Tier 1: rules that move the hottest cells

5. **Deer for foothills whitetails** (`huntRules.ts` deer branch, new helpers in `placeRules.ts`, `rutFactor` for deer): its own browse and cut curves, the 140/180/220 m edge, fields, aspect only in November or snow, shore +0.05, in-season pressure, the white-tailed deer rut curve and rut hours.
6. **Bears on Alberta's calendar** (`huntRules.ts` bear branch, `profile.ts` `regsLines` card text):
   - berries done 15 Sept;
   - black bear den ramp 1 Oct, 20 Oct, 5 Nov;
   - grizzlies active to November;
   - berry cut curve;
   - lodgepole in place of jack pine;
   - fens lower;
   - the Alberta kill-site lines and the black bear ID line.

   **Key it on the profile**, for example a `profile.calendar: 'foothills'` from CEC 5.4.2 or 6.2.x and the province, so Ontario keeps its rule until it is checked there.
7. **Moose foothills tweaks** (`huntRules.ts`, `placeRules.ts`; keyed the same way):
   - the cut curve with its 5–8 and 21–30-yr changes;
   - the pine-cut floor and pine-cut cover from 15 yr;
   - **the stream term without a treeline**;
   - the tighter edge;
   - the in-season road-presence factor replacing the flat 0.85;
   - date-stepped warm thresholds.
8. **Grouse** (`huntRules.ts` grouse branch, plus the `lead_code` change in 2):
   - the aspen curve and the 30% gate;
   - shrub lower;
   - the spruce grouse pine curve;
   - max(ruffed, 0.8 × spruce);
   - roadside timing.

### Tier 2: pressure, zones and data

9. **Pressure by road class** (`placeRules.ts` `roadPressure`, `siteCore`):
   - class factors;
   - no double 0.85;
   - cutlines kept out of the traffic factor;
   - quiet-pocket ×1.1;
   - PRA mask.
10. **Per-cell WMU.** Bake the WMU polygons, look up `regsFor` at the tapped cell, and grey or mark the heat where the target's weapon or season differs. Today one area means one zone, and 36% of this core is the other WMU.
11. **Elk gate** (`regs.ts` `QuarryStatus` gains `'rare'`; `profile.ts` `targetStanding`): the harvest-based rare rule, with the elk line in the zone notes. No elk heat here.
12. **Checklist and profile plumbing.**
    - `pipeline/area_checklist.py`:
      - add `MODEL_FIT['AB']`;
      - fail on `bake.forest` null instead of the false "surveyed inventory (?, ?)";
      - warn on `bake.vectors` null;
      - fail on `zone.name` null, and say the app drops the area;
      - add grid rows: nodata share of land, `disturbAge` share.
    - `pipeline/build_profile.py`: a `species` field from provincial range layers (Alberta's grizzly zones), so `presence('grizzly')` stops hanging on `north`.
    - Area: `leaves`. The boreal defaults (fall 20 Sept–15 Oct) run late at 52.3° N; a guess is 12 Sept–8 Oct, not sourced.

## 9. Checks after the bake

**`pipeline/area_checklist.py clearwater`** should show the following.

| Row | Expected |
|---|---|
| Model / Profile | ok, "5.4.2 Clear Hills and Western Alberta Uplands; forest to the tops; boreal calendars". **A treeline or `north: true` means the profile is wrong.** |
| Model / Species and seasons | "info … AB 326 is not in the species table" until change 4, then ok. "AB None" means `zone.name` was never set, and then the app has dropped the area. |
| Model / Moose model | warn, "rules written for boreal Ontario, not checked in AB's country" (until change 12) |
| Data / Forest stands | today a false "ok (?, ?)"; with `ca.scanfi`, warn "inferred from the national maps" |
| Data / Terrain | warn, MRDEM 30 m only |
| Data / Imagery | warn, none |
| Wind / Leaf calendar | warn |

**Grid sanity** (from the habitat file; no script does this yet):

| Check | Today | After the fixes |
|---|---|---|
| `nodata` share of core land | about 9% | under 2% with change 3 |
| Core cells with `disturbAge` < 255 | 0 | about 22% (CanLaD) |
| Cells within 250 m of `distRoad` | none | about 44% |
| `distHighway` | none | about 5% within 250 m and 10% within 500 m (Hwy 752 and the North Fork Road) |
| `distStream` | none | Prairie, North Prairie and Lick creeks present |

**`python app/scripts/heat_bands.py clearwater 2026-10-18`**, with the dev server up, should print "no treeline; boreal calendars". It prints no band lines, because the treeline share appears only when `dz` exists. Look for:
- **Moose** (top tenth by cover):
  - mostly cuts of about 9–25 yr (classed regen, open conifer or mixed once `ca.scanfi` is in) within 80 m of standing conifer;
  - shrub and hardwood along Prairie and North Prairie creeks (with change 7);
  - few dense-conifer cells and no nodata.
  - With the regs entry: "Post-peak" calling under the Ontario curve, notes "Moose to 31 Oct: bulls, drawn early-season licence", "by draw or permit only", the WMU 324 line and the grizzly card.
- **Deer.**
  - Today: expect a south-slope stripe (16.6% of the box carries the +0.3).
  - After change 5: young cuts (≤10 yr) and field and bush edges at the east side, and nothing on open cut interiors more than 220 m from cover.
  - Verdict: "Deer to 30 Nov: white-tailed deer of either sex."
- **Bear.**
  - Today, on 18 Oct, the Ontario late-fall switch puts the top tenth in thick conifer.
  - After change 6: a much lower black bear map in late October (×0.4 from 20 Oct), upland conifer and mixedwood.
  - Verdict: "black bear", with the grizzly card.
- **Grouse.**
  - Aspen and mixedwood, roadsides at dawn, and pine regeneration 15–40 yr (with change 8).
  - "Grouse to 15 Jan: ruffed, spruce and dusky (blue) grouse, 5 a day of each; no sharp-tailed season here."
- **No WARNING lines** on 18 Oct.

**On the map:**
- Heat should sit on the 1996–2016 cut mosaic next to standing timber and along the creek bottoms.
- Little should fall on the 0–4-yr cuts, nothing on the three recreation areas, and heat should be lower within 250 m of Hwy 752, most in the east, where traffic passes 1,000 a day.
- **No holes on the 5–14-yr cuts.** Holes there mean the forest adapter or change 3 is missing.
- With the deer rule changed, the White Area fields' edges should light for deer but not for moose.

## 10. Open questions and what could not be confirmed

**Regulations.**
- Any in-season correction after the guide's 14 Sept revision: none was found.
- The 2013 figure of up to $100,000 and two years for shooting a grizzly may not be current.
- The legal Rocky Mountain Forest Reserve line: no open layer was found; the zone layer is a proxy.
- Which White Area parcels are cultivated or posted.
- The fishing table's "North Fork Road" was matched to the OSM road of that name.

**Moose.**
- No Alberta conception-date study.
- No Alberta study of moose and well sites.
- No wolf, tick or calf data for 324/326 to explain the decline.
- Whether West Fraser sprays herbicide in the Sundre FMA.
- No fall foothills browse-diet study.

**Deer.**
- ABMI's camera habitat models were unreachable (HTTP 521).
- No Alberta GPS study of buck movement in the rut or of field use by hour.
- The WMU 234 conception figures were read off a figure.
- Several older Alberta deer papers were seen only as citations.

**Bears.**
- No foothills black bear den dates: the original Tietje & Ruff and Fuller & Keith papers were blocked.
- No foothills fall black bear diet study.
- The 5–24-yr cut selection is from outside Alberta.
- Whether the box lies inside the 2018 BMA 4 survey grid.

**Grouse.**
- Alberta's ruffed grouse cycle phase for 2025–26.
- Boag & Schroeder and Fischer & Keith were read only through secondary sources.
- Grit use is unmeasured in Alberta.

**Elk.**
- Visscher & Merrill 2009 was read as a snippet, and Frair's papers as abstracts.
- No fall survey of elk in 324/326.
- Land status of the WMU 320 candidate box.

**Access.**
- The Base Features cutline layer carries "Copyright Government of Alberta" with no licence.
- ABMI HFI and AER data have no explicit commercial licence: ask before shipping geometry in paid HD packs.
- ABMI's Foothills statistics were seen only as snippets.
- There is no traffic data on gravel roads or the North Fork Road.

**Place.**
- October–November snow depth and leaf-fall dates for the box: no normals were pulled, and the app reads live snow from Open-Meteo anyway.
- The claim that Alberta's linear-feature density is "the highest in Canada" was not found stated with numbers.

**How this was done.** The web-search budget shared by the research agents ran out late in the session. After that, only primary sources at known URLs were read; the notes say where a claim rests on an abstract or a snippet.

**Calibration.** Every rule number in sections 5 and 8 is a reasoned starting point, not fitted. The hunt log's percentile report card is the check, once there are ten or more Clearwater sightings per species.
