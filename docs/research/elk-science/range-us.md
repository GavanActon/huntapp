# US elk range, seasonal range, hunt units and harvest data (for a species range gate)

Researched 2026-10-05. Many findings below come from querying the agencies' live ArcGIS REST endpoints directly (layer names, fields, attribute values and last-edit dates were read from the services, not from summaries). Where a figure comes from an aggregator or a search snippet rather than the primary source, it is flagged.

## 1. Which states have wild elk and an open season, rough populations, and draw vs over-the-counter (OTC)

### Takeaway
About 29 states hold free-ranging elk. All ten big western states (CO, MT, OR, ID, WY, NM, UT, WA, AZ, NV) plus CA have large hunted herds, from about 13k to about 290k each, about 1.1M in all. Restored eastern and plains herds are small (about 100 to 13k) and are hunted only through small lotteries, if at all. North Carolina's first season is legislated for 2027. West Virginia has no season that I could find. OTC tags exist mainly in CO (residents), ID, MT, OR, WA, UT and WY (residents). AZ, NM, NV, CA and every eastern state are draw-only.

### Cited Findings
**Statewide population table (aggregator, "best available estimates as of January 2024", citing Wildlife Informer and Rugged Gear, not agencies):** CO 290,000; MT 135,000; OR 133,000; ID 120,000; WY 112,900; NM 80,000; UT 74,000; WA 60,000; AZ 40,000; NV 17,750; KY 13,100; CA 13,000; SD 7,500; OK 5,000; NE 2,750; TX 1,600; PA 1,350; AK 1,300; MI 1,000; ND 850; AR 450; TN 450; WI 400; KS 350; VA 250; MN 240; MO 200; NC 175; WV 100; US total 1,112,715. — [World Population Review](https://worldpopulationreview.com/state-rankings/elk-population-by-state)
- HuntWise (Jan 27, 2025) gives slightly different figures: CO "over 280,000", MT "about 150,000", ID "estimated 125,000", WY "110,000". It describes CO as having OTC licences, MT as a mix of OTC and draw, ID as OTC, WY as a preference-point draw for nonresidents, AZ as a limited-entry draw, UT as general seasons plus premium permits on bonus points, and NM as a lottery. — [HuntWise](https://huntwise.com/field-guide/elk/best-states-for-elk-hunting)

**Western agency figures (primary):**
- Oregon (ODFW, by Wildlife Management Unit (WMU), 2021–2025): Rocky Mountain elk total 71,894 in 2025 against a management objective (MO) of 73,450 (2024: 62,977). Roosevelt elk total 52,507 in 2025 against an MO of 70,850. That makes about 124,400 combined, against the aggregator's 133,000. The tables give population, bulls:100 cows and calves:100 cows per unit, e.g. Starkey 7,502, Ukiah 5,050, Heppner 5,200, Tioga 7,000, Saddle Mountain 7,000. — [ODFW Rocky Mtn elk 2021–2025 PDF](https://www.dfw.state.or.us/resources/hunting/big_game/controlled_hunts/docs/hunt_statistics/25/Rocky%20Mountain%20Elk%20Population%20Estimates%20and%20Herd%20Composition%202021%20-%202025%20.pdf); [ODFW Roosevelt elk 2021–2025 PDF](https://www.dfw.state.or.us/resources/hunting/big_game/controlled_hunts/docs/hunt_statistics/25/Roosevelt%20Elk%20Population%20Estimate%20and%20Herd%20Composition%202021-2025.pdf)
- Wyoming 2025 harvest report (WGFD with WYSAC, dated Feb 25, 2026): 84,088 licences (66,164 resident, 17,924 nonresident), 64,014 active hunters, 30,568 elk harvested (13,188 bulls, 1,300 spikes, 14,064 cows, 2,016 calves), 47.8% active-hunter success, 19.4 days per harvest. The ten-year table runs from 25,852 harvested in 2016 to 30,744 in 2024. The report tabulates harvest by hunt area (Table 3), by herd unit (Table 4) and by weapon type. — [WGFD Elk 2025 Harvest Report PDF](https://wgfd.wyo.gov/es/media/33482/download)
- Wyoming licence structure: the hunt-area map in the report marks "Limited Quota Areas — Nonresident Region General and Resident General Licenses are not valid", and Eastern and Southern Nonresident Regions. In other words residents hold a general (OTC) licence, nonresidents draw a region-general licence, and limited-quota areas are draw-only. — [WGFD Elk 2025 Harvest Report PDF](https://wgfd.wyo.gov/es/media/33482/download)
- Idaho (IDFG, Oct 16, 2025): 2024 harvest was 20,996 (12,610 antlered, 8,390 antlerless; 24% success), and 18,568 in 2023. General-season (OTC) tags had 19% success and controlled-hunt (draw) tags 42%, with 7,830 elk taken on controlled hunts. Elk zones use "A" and "B" tags. The statewide population is "healthy and relatively stable". — [IDFG](https://idfg.idaho.gov/article/quick-and-dirty-guide-elk-hunting-year)
- Montana: FWP maps elk counts by hunting district (HD), averaged over 3–5 years, against the 2023 Elk Management Plan population goals. These "are available in tabular form" on the FWP elk populations page. — [MT FWP Elk Population Status Maps 2024 PDF](https://fwp.mt.gov/binaries/content/assets/fwp/conservation/wildlife-reports/elk/2024/elkobjective2024_number-combined.pdf)
- Colorado: CPW publishes yearly "Population Estimates Reports" with elk population and sex-ratio estimates by management unit for 2019–2025, plus harvest reports for 2019–2025, all as PDFs. — [CPW elk statistics](https://cpw.state.co.us/hunting/big-game/elk/statistics)
- Arizona: the San Francisco Peaks herd (GMUs 7 and 9) was estimated at 5,200 in 2019. About 4,000 elk lived in GMU 8 (south of I-40) in 2021. — [USGS data catalog](https://data.usgs.gov/datacatalog/data/USGS:620e4a72d34e6c7e83baa338) (search snippet)
- South Dakota: most elk are in the Black Hills, where the winter population objective is 6,000–8,000. In 2005, 17,530 hunters applied for 3,029 licences. Elk are recolonising the western prairie, which has prompted proposals for prairie seasons. — [SD GFP Elk Status Report 2018](https://gfp.sd.gov/userdocs/docs/Elk_Status_Report_2018.pdf); [SD News Watch](https://www.sdnewswatch.org/new-elk-hunting-season-proposed-to-reduce-feed-loss-and-property-damage-on-s-d-prairies/)

**Eastern and restored herds (current-year where found):**
- Kentucky: "more than 10,000" elk, the largest herd east of Kansas City. 2025 had 500 permits (140 bull firearm, 164 cow firearm, 170 either-sex archery/crossbow, 26 youth). No more than 10% go to nonresidents: 50 nonresidents of 500 were drawn, and 23,010 of the 44,921 applicants were nonresidents. The draw is random with no preference points. — [goHUNT KY 2025](https://www.gohunt.com/browse/application-strategies/application-strategy-2025-kentucky-elk); [KDFWR 2025 drawn hunters](https://fw.ky.gov/Hunt/Documents/Elk/2025_Elk_US_Canada_Drawn_Hunters.pdf)
- Pennsylvania 2025–26: archery Sept 13–27, general Nov 3–8, late Dec 27–Jan 3. The snippet says "140 elk licenses comprising 65 antlered and 65 antlerless", which adds to 130, so the figure is internally inconsistent. — [PGC elk hunting](https://pa.gov/agencies/pgc/huntingandtrapping/get-started-hunting/elk-hunting) (search snippet)
- Pennsylvania 2026: the PGC "Elk Hunt Zones" GIS layer carries per-zone licence allocations, e.g. EHZ-301 Bull 9 / Cow 6; EHZ-308 Bull 10 / Cow 14; EHZ-300 and EHZ-310 "No Licenses Issued". — [PGC_Hunting_Boundaries layer 301](https://services1.arcgis.com/k8yxvICm95iIFicb/arcgis/rest/services/PGC_Hunting_Boundaries/FeatureServer/301)
- Tennessee 2025: archery Sept 27–Oct 3 and gun/muzzleloader/archery Oct 4–10, 9 quota permits each, plus a youth hunt Oct 11–17 with 1 permit. — [TWRA season summary](https://www.tn.gov/twra/hunting/tennessee-hunting-seasons-summary.html) (search snippet)
- Wisconsin 2025: season opened Oct 18, the 8th since reintroduction and the first with antlerless harvest. Clam Lake has an 8-bull quota, 4 to state hunters and 4 declared by the Ojibwe tribes under treaty rights. Black River has 5 antlerless and 4 bull licences. — [WSAW](https://www.wsaw.com/2025/10/16/2025-elk-season-set-open-hunters-october-18/)
- Michigan: hunters took 153 elk in 2025. — [Yahoo News](https://www.yahoo.com/news/articles/michigan-elk-harvest-numbers-many-174734554.html)
- Minnesota 2026: 3 either-sex and 11 antlerless licences, all in Kittson County (zones 10, 20, 30). It is a once-in-a-lifetime hunt for residents. Seasons run Sept 12–20, except Zone G Sept 26–Oct 4. — [MN DNR elk](https://www.dnr.state.mn.us/hunting/elk/index.html)
- Missouri 2026: archery Oct 17–25 and firearms Dec 12–20. The tag is one elk with at least one antler of 6 in or more, issued by application (Peck Ranch area). — [MDC elk](https://mdc.mo.gov/hunting-trapping/species/elk)
- Virginia 2025–26: hunt Oct 11–17 with 5 antlered licences by lottery. The application fee is $15 for residents and $20 for nonresidents, so nonresidents can apply. — [VA DWR press release](https://dwr.virginia.gov/media/press-release/virginia-elk-hunt-lottery-open-until-march-31-2025/)
- North Carolina: NCWRC estimates about 250 elk in a few southern Appalachian counties ([WFAE, Mar 2025](https://www.wfae.org/2025-03-25/elk-hunting-season-nc-raffle-auction)). Governor Stein signed a law on July 7, 2026 for the first hunt, in 2027, with 2 permits: one resident raffle ($20 tickets) and one conservation-group auction ([Carolina Sportsman, Oct 5, 2026](https://www.carolinasportsman.com/?p=210047)).
- Older (2019–2020) eastern figures: PA 1,350 (164 tags); KY 11,000 (594 tags); MI 1,200 (260 tags); TN 450 (15); WI 400 (10); MN 250 (40–50); VA 250 (no core-zone hunt then; elk legal during deer season outside the core zone); MO 200 (5 tags, first season 2020); AR 450 (26 public-land tags plus private-land tags). — [Outdoor Life, Oct 21, 2020](https://www.outdoorlife.com/story/hunting/complete-guide-to-hunting-eastern-elk/)

### Inferences
- Gate categories by state as of October 2026:
  - Present and hunted, large: CO, MT, OR, ID, WY, NM, UT, WA, AZ, NV, CA.
  - Present and hunted, small lottery: KY, PA, MI, WI, TN, VA, AR, MO, MN, SD, ND, NE, OK, KS, AK (Afognak/Raspberry).
  - Present, no season: NC until 2027, WV.
  - Absent: the rest. Texas is a special case: it is listed at 1,600 elk, but I did not verify its legal status.
- In the small eastern states the hunted area is a few counties, not the state. The gate must work by zone, using PA elk hunt zones, KY elk zone and units, and MI elk management units (see section 4), not by state.
- Population figures vary by 5–15% between sources (MT 135k vs 150k; OR 133k aggregator vs about 124k ODFW 2025). Use agency per-unit numbers where they exist and treat statewide aggregator totals as rough.

### Gaps
- No agency-sourced 2025–26 population figures for CO (the PDF exists but could not be text-extracted), NM, AZ, UT, WA, NV, CA, AR, WV, OK, NE, KS, TX or AK. Those rely on the January 2024 aggregator.
- Current OTC status was not verified per state for 2026. My web-search budget ran out before I could confirm recent rule changes (e.g. Colorado nonresident archery, Idaho nonresident general tags). HuntWise (Jan 2025) is the only cited source on OTC vs draw.
- Pennsylvania nonresident eligibility: Outdoor Life's summary said "resident-only", which may be the summarising model's error. Not verified.
- Arkansas, Oklahoma, Nebraska, Kansas, North Dakota and Texas: no current season, quota or zone data was gathered beyond GIS layer discovery.

## 2. National range data: GAP, NatureServe, IUCN, USGS migration corridors, RMEF

### Takeaway
The only free national elk range layer is USGS GAP's 2001-condition HUC12 range (mELK1x), which has no seasonal split, plus a 30 m habitat model. It is coarse and dated but public. It codes each subwatershed as known/extant, possibly present or extirpated, with origin native, introduced, reintroduced or vagrant. That is a natural first-pass "present / edge / absent" gate. Seasonal detail comes only from the USGS Corridor Mapping Team herd layers (six volumes, 237 herds, about 69 elk layers across WY, AZ, CA, NM, WA, ID and NV) and from state layers.

### Cited Findings
- USGS GAP elk range ("Elk (Cervus elaphus) mELK1x_CONUS_2001v1 Range Map"): the known range in CONUS based on 2001 ground conditions, built by attributing HUC12 subwatershed polygons with presence, origin, season and reproductive use. Published 2018-08-15 (work 2008–2014), DOI 10.5066/F7RB73MV. The download is a 6.3 MB zip with a shapefile and a CSV. — [ScienceBase 59f5e1e6e4b063d5d307db71](https://www.sciencebase.gov/catalog/item/59f5e1e6e4b063d5d307db71)
- Contents of that zip, from my own inspection of the CSV (59,288 HUC12 rows):
  - Presence: Known/extant 16,200; Possibly present 2,311; Extirpated/historical 40,777.
  - Origin: Native 57,601; Introduced 585; Reintroduced 556; Vagrant 546.
  - Season: "Year-round" on all rows. Reproduction: "Both breeding and nonbreeding" on all rows.
  - The shapefile is NAD83 Albers (EPSG 5070-style), dissolved on Origin, Presence, Repro and Season.
  - — [ScienceBase file mELK1x_CONUS_Range_2001v1.zip](https://www.sciencebase.gov/catalog/item/59f5e1e6e4b063d5d307db71)
- GAP companion habitat map ("mELK1x_CONUS_2001v1 Habitat Map"): a deductive habitat model applied to remotely sensed layers inside the range. — [ScienceBase 58fa6797e4b0b7ea5452585e](https://www.sciencebase.gov/catalog/item/58fa6797e4b0b7ea5452585e); [USGS data page](https://www.usgs.gov/data/elk-cervus-elaphus-melk1xconus2001v1-habitat-map)
- GAP range maps are "a coarse representation of the total areal extent of a species", meant to constrain distribution models. — [data.usgs.gov](https://data.usgs.gov/datacatalog/data/USGS:620e4aadd34e6c7e83baa35e)
- Cross-walk IDs on the GAP item: ITIS TSN 180695, NatureServe ID 102257, IUCN ID 56003281. — [ScienceBase 59f5e1e6e4b063d5d307db71](https://www.sciencebase.gov/catalog/item/59f5e1e6e4b063d5d307db71)
- USGS Corridor Mapping Team (CMT), set up in 2018 under DOI Secretarial Order 3362: it maps bison, elk, moose, mule deer and pronghorn migrations from existing GPS data with 11 state agencies and Tribal partners. Each report volume has its own ScienceBase data release. — [ScienceBase parent 66dee5dcd34eef5af66da144](https://www.sciencebase.gov/catalog/item/66dee5dcd34eef5af66da144)
- Volume 1 (2020) covered AZ, ID, NV, UT and WY. Volume 2 (2022) added 65 migrations in 9 states plus Tribal lands. — [USGS SIR 2020-5101](https://pubs.usgs.gov/publication/sir20205101); [USGS SIR 2022-5008](https://pubs.usgs.gov/publication/sir20225008)
- Volume 6 was published Mar 25, 2026 and revised Aug 26, 2026. It covers 23 herds, bringing the series to 237 unique herds. Its data release is [doi:10.5066/P1ETBSYE](https://doi.org/10.5066/P1ETBSYE). "Raw GPS data are not shared", and because of agency data-sharing constraints, "not all the files … have been released". Downloads come as one zipped shapefile per herd or range. — [USGS SIR 2026-5123](https://pubs.usgs.gov/publication/sir20265123); [ScienceBase vol 6](https://www.sciencebase.gov/catalog/item/68dbf660d4be0204610b5ed7)
- Elk layers per data release (my count of child items with "elk" in the title):
  - Vol 1: 10 (AZ Interstate 17 routes, corridors, stopovers and winter range; WY Jackson, Clarks Fork, Cody, South Wind River, Fossil Butte and Piney routes).
  - Vol 2: 28 (WY South Bighorn, Wiggins Fork, Gooseberry, North Bighorn and Medicine Lodge routes; CA Egg Lake, East Shasta Valley and West Goose Lake corridors, stopovers and winter ranges; NM Jemez and Pueblo of Santa Ana; AZ North of I-40 and San Francisco Peaks).
  - Vol 3: 7 (WA Pend Oreille corridors, stopovers, routes and winter range; WY Sierra Madre and South Rock Springs routes; CA Marble Mountain annual range). Title matches on "Selkirk" white-tailed deer layers and a WY "Elk Mountain" pronghorn layer (vol 5) were excluded.
  - Vol 4: 12 (AZ South of I-40; WA Colockum; Wind River Reservation Owl Creek and Wind River; NM Jemez; Tesuque Pueblo).
  - Vol 5: 12 (ID/NV Inside Desert, Y P Desert and Bruneau–Diamond A; NV Southern Owyhee; AZ SR 260).
  - Vol 6: 0 elk-titled items (its herd naming may not put the species in the title; not checked further). Total about 69.
  - — ScienceBase child listings for [vol 1](https://www.sciencebase.gov/catalog/item/5f80c88d82cebef40f0fefc5), [vol 2](https://www.sciencebase.gov/catalog/item/61fd7f6ed34e622189cf3fb9), [vol 3](https://www.sciencebase.gov/catalog/item/63598d30d34ebe442503eb3f), [vol 4](https://www.sciencebase.gov/catalog/item/651f150bd34e44db0e2dd484), [vol 5](https://www.sciencebase.gov/catalog/item/6729962bd34e338a476a38ef)
- The NV "Inside Desert" elk migration layers were built from 51 migration sequences of 23 GPS-collared animals. — [USGS data catalog](https://data.usgs.gov/datacatalog/data/USGS:67917581d34ea6a4002bfaac) (search snippet)
- A community mirror of habitat-corridor data exists on Source Cooperative. — [source.coop habitat-corridors](https://s2.source.coop/cboettig/habitat-corridors) (not inspected)

### Inferences
- GAP is the fallback gate for anywhere not covered by state data:
  - Known/extant: present.
  - Possibly present or Vagrant: edge/rare.
  - Extirpated/historical: absent.

  But it reflects 2001 knowledge. Herds restored or expanded after 2001 (e.g. WI Black River, MO, VA, the SD and ND prairie spread) may be mis-coded, so state layers should override it. A HUC12 averages roughly 90–100 km², which is too coarse for a 3–5 km area core. Use it only as a regional gate.
- GAP has no seasonal information (all "Year-round"). September–December seasonal weighting must come from state layers (CO, WY, UT, NV, MT winter range, OR winter range, CA CWHR season field) or from USGS corridor and winter-range polygons.
- USGS data releases are normally US federal public domain, which would make them the safest data for a commercial app. I did not see an explicit licence statement on the items I opened (see Gaps).

### Gaps
- NatureServe and IUCN elk range polygons: I could not reach the NatureServe Explorer API (a 404 on the ID I tried). My search budget ran out before I could check the IUCN Red List spatial-data terms. IUCN spatial data is commonly licensed for non-commercial use only, but that is unverified here. Treat both as unverified and probably unnecessary given GAP plus state data.
- RMEF: no Rocky Mountain Elk Foundation GIS or downloadable range data was found. RMEF appeared only as a news and restoration source.
- The GAP habitat-map raster (30 m) was not downloaded or inspected. File size, format and season handling are unconfirmed.
- The licence text on the GAP and CMT ScienceBase items was not explicitly read.

## 3. State seasonal-range GIS for elk (URL, format, licence, vintage)

### Takeaway
Seven western states publish machine-readable elk seasonal range with a season attribute, all as public ArcGIS REST feature services (queryable as GeoJSON, so bakeable offline): Colorado (the richest, 12 elk layers), Wyoming, Utah, Nevada, Montana (winter range plus general distribution), Oregon (eastern winter range only) and California (CWHR range with a season field, CC BY 4.0). Washington, Idaho, New Mexico and Arizona publish hunt units but no public elk range layer that I could find. For those, use GAP plus the USGS corridor layers.

### Cited Findings
**Colorado (CPW)**
- `CPWSpeciesData` FeatureServer (ArcGIS Online item 50322b83e815436aadf588757822e72f, modified 2026-05-07, public). Elk layers:
  - 33 Elk Migration Patterns (polyline)
  - 34 Elk Highway Crossings
  - 35 Elk Summer Concentration Area
  - 36 Elk Summer Range
  - 37 Elk Production Area
  - 38 Elk Limited Use Area
  - 39 Elk Resident Population Area
  - 40 Elk Migration Corridors
  - 41 Elk Severe Winter Range
  - 42 Elk Winter Concentration Area
  - 43 Elk Winter Range
  - 44 Elk Overall Range

  Fields are ACTIVITYCO, INPUT_DATE and EDIT_DATE. The licence text reads: "This wildlife distribution map is a product and property of Colorado Parks and Wildlife … should not replace field studies". — [CPWSpeciesData FeatureServer](https://services5.arcgis.com/ttNGmDvKQA7oeDQ3/ArcGIS/rest/services/CPWSpeciesData/FeatureServer)
- High Priority Habitat (HPH) subsets: `CPWHPHTerrestrialData` layers 20–23 (Elk Migration Corridor, Production Area, Severe Winter Range, Winter Concentration Area), last edited 2025-12-23. The same four layers appear in `CPWSB181TerrestrialData`.
  - Severe winter range is defined as "that part of the overall range of elk where 90% of the individuals are located when the annual snowpack is at its maximum and/or temperatures are at a minimum in the two worst winters out of ten".
  - It was mapped by field personnel on 1:50,000 mylar overlays and by SmartBoard digitising.
  - — [CPWHPHTerrestrialData/22](https://services5.arcgis.com/ttNGmDvKQA7oeDQ3/ArcGIS/rest/services/CPWHPHTerrestrialData/FeatureServer/22)
- Species activity data is updated on a 4-year regional rotation, not statewide each year (last regional updates NE 2022, SE 2021, SW 2024, NW 2023). Colorado's ECMC republishes a yearly snapshot (High_Priority_Habitat_2024, _2025, _2026 MapServers). — [gisdnr ECMC HPH 2024 iteminfo](https://gisdnr.state.co.us/arcgis/rest/services/ECMC_Public/High_Priority_Habitat_2024/MapServer/28/iteminfo) (search snippet); [HPH 2026](https://gisdnr.state.co.us/arcgis/rest/services/ECMC_Public/High_Priority_Habitat_2026/MapServer/29/iteminfo)

**Wyoming (WGFD)**
- `Elk_Seasonal_Range` FeatureServer has a RANGE field with codes CRUSWR, CRUWIN, CRUWYL, OUT, SSF, SWR, UND, WIN, WYL and YRL. Other fields are Acres and SQMiles.
  - The service description says these are the "2016 elk seasonal range boundaries", while the ArcGIS Online item description says "2018". The data was last edited 2021-11-23.
  - Ranges are digitised at 1:100,000 from long-term observation, research and professional judgement. Definitions come from a 1990 Wyoming Chapter of The Wildlife Society document.
  - Licence: provided "as is", no warranty.
  - — [Elk_Seasonal_Range/0](https://services6.arcgis.com/cWzdqIyxbijuhPLw/ArcGIS/rest/services/Elk_Seasonal_Range/FeatureServer/0)
- `Elk_Crucial_Range` is the subset of seasonal range where RANGE LIKE '%CRU%' (CRUSWR, CRUWIN, CRUWYL). — [Elk_Crucial_Range/0](https://services6.arcgis.com/cWzdqIyxbijuhPLw/ArcGIS/rest/services/Elk_Crucial_Range/FeatureServer/0)
- `Elk_Parturition_Areas` (2016) maps "seasonally high concentrations of birthing animals". — [Elk_Parturition_Areas/0](https://services6.arcgis.com/cWzdqIyxbijuhPLw/ArcGIS/rest/services/Elk_Parturition_Areas/FeatureServer/0)
- The same organisation also hosts Jackson elk layers: `JacksonElk_crucialwinter` and migration layers `Jxn_short_migr`, `Jxn_med_migr`, `Jxn_long_migr` and `Jxn_GV_migr`. — [WGFD services directory](https://services6.arcgis.com/cWzdqIyxbijuhPLw/ArcGIS/rest/services)

**Montana (FWP)**
- `wild/bigGameDistribution` MapServer:
  - Layer 11, Elk Winter Range: "areas where populations of this species tend to concentrate during the winter season, commonly December through April … Not all populations concentrate on specific ranges during the winter".
  - Layer 12, Elk General Distribution: "areas predictably occupied by this species for part or all of its year-long range".
  - Geometry only (fields OBJECTID and SHAPE), with no licence or date in the service.
  - — [MT bigGameDistribution MapServer](https://fwp-gis.mt.gov/arcgis/rest/services/wild/bigGameDistribution/MapServer)

**Utah (UDWR)**
- `Utah_Elk_Habitat` FeatureServer (owner dwrdata, modified 2023-04-04):
  - SEASON values: spring/fall, summer, summer/fall, transition, winter, winter/spring, year-long.
  - VALUE values: crucial, substantial.
  - COMMENTS include "This area is NOT managed for elk as per Wildlife Board decision", "Elk population not established yet. Polygon represents anticipated range and value", and calving notes.
  - The description says biologists set distribution and season from observations, surveys and radio/satellite data, "for use in large-scale planning".
  - Licence: "None, but the UDWR provides no warranty".
  - — [Utah_Elk_Habitat FeatureServer](https://services.arcgis.com/ZzrwjTRez6FJiOq4/arcgis/rest/services/Utah_Elk_Habitat/FeatureServer/0); found via [Utah open data hub](https://opendata.gis.utah.gov)
- An older version (2001, updated to 2007, crucial/substantial since 2006, acquired 2011) is on Data Basin. — [Data Basin Elk use areas, Utah](https://databasin.org/datasets/68cbf165104044a5ad307b1f7e7b088e)

**Nevada (NDOW)**
- `Occupied_Elk_Distributions` FeatureServer (last edit 2026-08-28):
  - HABITAT values: Agricultural, Crucial Summer, Crucial Winter, Limited Use, Summer Range, Transition Range, Winter Range, Year-round.
  - Other fields: Herd_Name, UNIT_GROUP and Carrying_C (carrying capacity).
  - — [Occupied_Elk_Distributions](https://services.arcgis.com/RyxlXSfFi87rAosq/arcgis/rest/services/Occupied_Elk_Distributions/FeatureServer/1)
- The same schema is published in `NDOWBigGameDistributions` layer 2 (last edit 2025-04-04). — [NDOWBigGameDistributions](https://services.arcgis.com/RyxlXSfFi87rAosq/arcgis/rest/services/NDOWBigGameDistributions/FeatureServer)
- NDOW has collected elk GPS-collar data and says it "will inform the creation of updated habitat distribution layers". — [USGS data catalog](https://data.usgs.gov/datacatalog/data/USGS:67917581d34ea6a4002bfaac) (search snippet)

**Oregon (ODFW)**
- ODFW Elk Winter Range for eastern Oregon, east of the Cascade crest: winter range is the "area normally occupied by elk from December through April". Assembled in 2009, with updates for The Dalles District in 2012. Field CLASS_NAME. — [ODFW_WinterRanges_DeerElk_EasternOR MapServer](https://nrimp.dfw.state.or.us/arcgis/rest/services/Compass/ODFW_WinterRanges_DeerElk_EasternOR/MapServer/0)

**California (CDFW BIOS)**
- ds945 "Elk Range – CWHR M177": vector range with a `Season` field. Range maps show the "maximum, current geographic extent", originally drawn at 1:5,000,000 and revised at 1:1,000,000. Item modified 2026-05-21. Licence CC BY 4.0. — [biosds945 FeatureServer](https://services2.arcgis.com/Uq9r85Potqm3MfRV/arcgis/rest/services/biosds945_fpu/FeatureServer/0); [data.gov ds945](https://catalog.data.gov/dataset/elk-range-cwhr-m177-ds945)
- ds2624 "Elk Predicted Habitat – CWHR M177" is a raster ImageServer. Many herd datasets also exist: Elk Home Range (Elk Creek, Marble Mountain, Scott Valley, Dixie Valley, Lone Pine, Sams Neck, North Warners …), Elk Migration Lines (East Shasta Valley, West Goose Lake, Egg Lake), and ds2889 Big-Game SO3362 Priority Areas. — [CDFW open data hub](https://data-cdfw.opendata.arcgis.com); [ds2624 ImageServer](https://tiledimageservices2.arcgis.com/Uq9r85Potqm3MfRV/arcgis/rest/services/biosds2624_cru/ImageServer)

**North Dakota**
- `NDGISHUB_Elk_Range` has a RANGE field whose only value is "Isolated-Primary" (2022-01-10). `NDGISHUB_Elk_Units` holds the hunt units. — [NDGISHUB_Elk_Range](https://services1.arcgis.com/GOcSXpzwBHyk2nog/arcgis/rest/services/NDGISHUB_Elk_Range/FeatureServer/0); [NDGISHUB_Elk_Units](https://services1.arcgis.com/GOcSXpzwBHyk2nog/ArcGIS/rest/services/NDGISHUB_Elk_Units/FeatureServer)

**Washington, Idaho, New Mexico, Arizona**
- WDFW's public `geodataservices.wdfw.wa.gov` folders hold hunt boundaries, hunt planner and elk hoof disease layers, but no elk range layer (folders checked: MapServices, ApplicationServices, WP_ElkHD, WP_HuntPlanner, WP_Statewide).
  - The `WP_ElkHD/ElkHoofDisease_IncidentalObservations_View` layer holds public elk sightings from 2012–2018.
  - An ArcGIS Online service titled "ElkWinterRange / ElkSummerRange" (`FinalRangeButtons_WFL1`) that turned up in a WDFW search is actually Wyoming's 2018 seasonal range, per its own description and copyright.
  - — [WDFW services root](https://geodataservices.wdfw.wa.gov/arcgis/rest/services); [FinalRangeButtons_WFL1/6](https://services1.arcgis.com/KNdRU5cN6ENqCTjk/ArcGIS/rest/services/FinalRangeButtons_WFL1/FeatureServer/6)
- IDFG's open data page offers "generalized game animal distributions" alongside GMUs and elk zones. — [IDFG press release](https://idfg.idaho.gov/press/updated-hunt-planner-open-data-page-available-online)

### Inferences
- A season-code crosswalk for a Sept–Dec gate:

  | State | Summer-type codes | Transition codes | Winter codes | Year-round codes |
  |---|---|---|---|---|
  | CO | Summer Range, Summer Concentration | Migration Corridors | Winter Range, Winter Concentration, Severe Winter | Resident Population Area (Overall Range = presence) |
  | WY | SSF | — | WIN, WYL, CRUWIN, CRUWYL, SWR, CRUSWR | YRL |
  | UT | summer, summer/fall | transition, spring/fall | winter, winter/spring | year-long |
  | NV | Summer Range, Crucial Summer | Transition Range | Winter Range, Crucial Winter | Year-round |
  | MT | General Distribution minus winter range | — | Winter Range (Dec–Apr) | — |
  | OR | — | — | Winter Range, east side only (Dec–Apr) | — |
  | CA | CWHR `Season` field (values not read) | | | |

  The WY code expansions (SSF = spring-summer-fall, WYL = winter-yearlong, SWR = severe winter relief, OUT = out of range, UND = undetermined) are the standard WGFD meanings as I recall them. They were not confirmed in the fetched metadata, so verify before baking.
- Edge/rare signals from attributes: CO "Limited Use Area", NV "Limited Use" and "Agricultural", the UT comments "NOT managed for elk" and "population not established yet", and WY "OUT" and "UND".
- Licences, for a commercial offline app:
  - CA is explicitly CC BY 4.0 (attribution).
  - WY, UT, ID and MT state "as is / no warranty" with no restriction on use.
  - CO calls the data "product and property of CPW". Ask CPW before redistributing baked CO tiles, or at least credit it.

### Gaps
- No public WA, ID, NM or AZ elk seasonal-range polygons were found. WDFW Priority Habitats and Species elk concentrations may be restricted. IDFG's "generalized game animal distributions" item was not located by service URL.
- The CO SAM per-layer definitions (overall vs resident vs summer concentration) were not readable from the service descriptions, which are empty for these layers. Only the severe-winter-range definition was confirmed.
- The values of the CA ds945 Season field and the size of the ds2624 raster were not read.

## 4. Hunt-unit boundaries, machine-readable seasons and quotas, and harvest as a density proxy

### Takeaway
Every elk state publishes hunt-unit polygons as public ArcGIS services, mostly current to 2025–2026. Seasons and quotas, however, are mostly locked in regulation PDFs or web apps. Partial exceptions:
- Pennsylvania's zone layer carries yearly licence counts.
- Utah's boundary service has a hunt-info table.
- New Mexico's GMU layer has hunt-info and licensing fields.
- Montana's district layer links to per-district elk pages.

Harvest by unit is published by WY, CO and ID (PDF or web tables) and population by unit by OR, CO and MT. Population per unit area is the better density proxy. Raw harvest per unit area is distorted by quotas and OTC hunting pressure.

### Cited Findings
**Hunt-unit GIS (all ArcGIS REST, public):**
- **WY**: `ElkHuntAreas` holds the 2025 elk hunt areas, herd units and regions (fields HUNTAREA, HERDUNIT, HERDNAME, HUNTNAME, Region; data last edited 2026-03-19). There are also `ElkHerdUnits`, `2025_Elk_HAs`, `2025_elk_herd_units`, `ElkNonresidentRegions`, and CWD priority elk hunt-area layers for 2025 and 2026. It is digitised at 1:100,000, and "hunt area boundary descriptions are part of hunting regulations … published annually". — [ElkHuntAreas/0](https://services6.arcgis.com/cWzdqIyxbijuhPLw/ArcGIS/rest/services/ElkHuntAreas/FeatureServer/0); [WGFD services](https://services6.arcgis.com/cWzdqIyxbijuhPLw/ArcGIS/rest/services)
- **CO**: `CPWAdminData` layer 6 "CPW GMU Boundary (Big Game)" and layer 23 "DAU Boundary (Elk)", service regenerated 2026-08-27. — [CPWAdminData FeatureServer](https://services5.arcgis.com/ttNGmDvKQA7oeDQ3/ArcGIS/rest/services/CPWAdminData/FeatureServer)
- **MT**: `admbnd/huntingDistricts` MapServer layers 11 "Deer Elk Lion Hunting Districts" (fields DISTRICT, ELKWEBPAGE, REGYEAR, AREA_KM …), 14 "Elk Portions" and 15 "Elk Restricted Areas". There is also a separate Elk Management Units layer built from the HDs. — [MT huntingDistricts MapServer](https://fwp-gis.mt.gov/arcgis/rest/services/admbnd/huntingDistricts/MapServer); [MT EMU metadata](https://fwp-gis.mt.gov/arcgis/rest/directories/arcgisoutput/webResources/metadata/wild/managementUnitsElk2016.htm)
- **ID**: the `Hunting` MapServer has layers 0 All Hunt Areas, 1 Elk Zones, 3 Game Units and 4 Controlled Hunts. The Elk Zones layer is a 1:24k build from the GMU legal descriptions. The `ElkManagementZones` FeatureServer (modified 2025-10-03) is licensed "for public-use for informational purposes only". — [IDFG Hunting MapServer](https://gisportal-idfg.idaho.gov/hosting/rest/services/Hunting/MapServer); [ElkManagementZones](https://services.arcgis.com/FjJI5xHF2dUPVrgK/arcgis/rest/services/ElkManagementZones/FeatureServer/0); [Controlled Hunts – All Species](https://services.arcgis.com/FjJI5xHF2dUPVrgK/arcgis/rest/services/ControlledHunts_All/FeatureServer)
- **UT**: the `hunt/Boundaries_and_Tables` MapServer has layer 0 `DWR_Hunt_Boundaries_combined` and table 1 `HUNT_INFO_MOBILE`. — [Utah DWR MapServer](https://dwrmapserv.utah.gov/dwrarcgis/rest/services/hunt/Boundaries_and_Tables/MapServer?f=pjson); [DWR maps page](https://wildlife.utah.gov/hunting/maps.html)
- **OR**: the Wildlife Management Units FeatureServer is offered as CSV, FGDB, GeoJSON, KML and SHP. Boundaries match the Big Game Regulations and were updated in July 2016. — [ODFW WMU FeatureServer](https://nrimp.dfw.state.or.us/arcgis/rest/services/ODFW_Admin/WildlifeManagementUnits/FeatureServer/0); [data.gov](https://catalog.data.gov/dataset/wildlife-management-units-db49a)
- **WA**: the `SharedReferenceLayers` MapServer has GMU Boundary, GMU Generalized, and "EA Boundary"/"EA Legal" (Elk Areas, per WAC 232-28-337). `WP_HuntPlanner/Harvest` and `/Regulation` MapServers each expose a "UnitSpatial" layer. — [WDFW SharedReferenceLayers](https://geodataservices.wdfw.wa.gov/arcgis/rest/services/MapServices/SharedReferenceLayers/MapServer); [WDFW WP_HuntPlanner](https://geodataservices.wdfw.wa.gov/arcgis/rest/services/WP_HuntPlanner)
- **NM**: the NMDGF GMU FeatureServer (owner dgf.nm.gov) has fields GMU, HUNT_INFO, GMU_PDF, Licensing, BearZone and Cougar_Zone, with data last edited 2026-09-25, plus a sub-units layer. It is based on NMAC 19.30.4. — [NMDGF GMU FeatureServer](https://services2.arcgis.com/CjbW1bVhK4dB3WOa/arcgis/rest/services/NMDGF_Game_Management_Units_I_E__v2_WFL1/FeatureServer); [NMDGF GMU maps](https://wildlife.dgf.nm.gov/hunting/maps/big-game-unit-maps-pdfs/)
- **AZ**: "AGFD – Management Unit Boundaries". AGFD GMUs are set by the Commission "for … the setting of hunting seasons". — [AGFD HabiMap GMU MapServer](https://arcgis.azgfdportal.com/arcgis/rest/services/HabiMap/GMU/MapServer); [BLM metadata](https://www.az.blm.gov/GIS/lsfo-sdmn-drmp/Metadata/Affected-Environment/azgf_units.htm)
- **NV**: NDOW Game Management Units and Hunt Units. — [NDOWGameMgmtUnits](https://services.arcgis.com/RyxlXSfFi87rAosq/arcgis/rest/services/NDOWGameMgmtUnits/FeatureServer); [NDOW_Hunt_Units](https://services.arcgis.com/RyxlXSfFi87rAosq/arcgis/rest/services/NDOW_Hunt_Units/FeatureServer)
- **CA**: ds786 Elk Hunt Zones (fields NAME, FORMALNAME, BIGDIGEST_NUMBERID; licence CC BY 4.0; "boundaries are approximate … Title 14 CCR §364") and ds2905 Elk Management Units. — [biosds786](https://services2.arcgis.com/Uq9r85Potqm3MfRV/arcgis/rest/services/biosds786_fpu/FeatureServer/0); [data.gov ds2905](https://catalog.data.gov/dataset/elk-management-units-cdfw-ds2905)
- **PA**: `PGC_Hunting_Boundaries` layer 301 "PGC Elk Hunt Zones" (fields ehz_id_year, elk_hunt_zone, ehz_license_allocation, ehz_status, ehz_active_date, ehz_inactive_date; 2026 rows present) and layer 302 "PGC Elk Management Area". — [PGC_Hunting_Boundaries](https://services1.arcgis.com/k8yxvICm95iIFicb/arcgis/rest/services/PGC_Hunting_Boundaries/FeatureServer)
- **KY**: "Elk Hunting Units in Kentucky" (Kentucky_DGI, modified 2026-09-17; fields AreaName, UnitNumb, Use_) and "Restricted Hunting Areas within Elk Zones". — [Ky_KDFWR_ElkHuntingUnits](https://services3.arcgis.com/ghsX9CKghMvyYjBU/arcgis/rest/services/Ky_KDFWR_ElkHuntingUnits_WM_gdb/FeatureServer/0)
- **MI**: `WILDGameSpeciesManagementUnitsAndZonesOPENDATA` layer 4 "ElkManagementUnits", with 2026 records. — [MI DNR FeatureServer/4](https://services3.arcgis.com/Jdnp1TjADvSDxMAX/arcgis/rest/services/WILDGameSpeciesManagementUnitsAndZonesOPENDATA/FeatureServer/4)
- **SD**: GFP "Hunt Units Elk and Turkey" and an "Elk Harvest" map layer (proxied through utility.arcgis.com). — [SD GFP Hunt_Units_Elk_and_Turkey](https://utility.arcgis.com/usrsvcs/servers/eaa0dffa413a418d8694ae0c2096680c/rest/services/Public_Lands/Hunt_Units_Elk_and_Turkey/FeatureServer)

**Harvest and population by unit:**
- WY: the yearly PDF report tabulates harvest, active hunters, success and days by hunt area and by herd unit, with confidence intervals by herd unit. It is based on a voluntary survey (25,355 responses from 60,925 surveyed, extrapolated to 84,088 licences). — [WGFD Elk 2025 Harvest Report](https://wgfd.wyo.gov/es/media/33482/download)
- CO: harvest reports for 2019–2025 and population and sex-ratio estimates by unit for 2019–2025, as PDFs hosted on Widen (e.g. 2025 harvest: https://cpw.widencollective.com/assets/share/asset/8uno656mtu). — [CPW elk statistics](https://cpw.state.co.us/hunting/big-game/elk/statistics)
- ID: Hunt Planner pages show per-hunt harvest tables by year, method and unit (harvest, hunters, success, days). No CSV export was found. — [IDFG Hunt Planner example](https://idfg.idaho.gov/ifwis/huntplanner/hunt/80743) (search-result description)
- MT: per-HD elk counts against plan goals, in tabular form on FWP's elk page. Regional reports exist, e.g. Region 1 harvested an estimated 995 elk in 2022. Check-station counts are samples; full HD harvest comes from telephone surveys. — [MT 2024 objective maps](https://fwp.mt.gov/binaries/content/assets/fwp/conservation/wildlife-reports/elk/2024/elkobjective2024_number-combined.pdf); [MT R1 2022 elk report](https://fwp.mt.gov/binaries/content/assets/fwp/aboutfwp/regions/r1/other/r1_elk_annual_report_2022_final.pdf)
- OR: population, bull:cow and calf:cow ratios per WMU for 2021–2025, as PDFs (see section 1). — [ODFW Rocky Mtn elk PDF](https://www.dfw.state.or.us/resources/hunting/big_game/controlled_hunts/docs/hunt_statistics/25/Rocky%20Mountain%20Elk%20Population%20Estimates%20and%20Herd%20Composition%202021%20-%202025%20.pdf)

### Inferences
- Unit polygons are easy to bake. Seasons and quotas are not. A practical pipeline:
  1. Bake unit polygons per area with the unit ID.
  2. Hand-curate, or scrape once a year, a small `elk_seasons.json` per state/unit (open?, weapon windows, OTC/draw), sourced from regulation PDFs.
  3. Show "check regs" rather than claim legality. PA (licence allocation per zone) and UT (HUNT_INFO_MOBILE table) are the easiest to automate.
- Density proxy ranking:
  1. Agency population by unit divided by unit area: OR WMU, CO DAU, MT HD counts, NV `Carrying_C`.
  2. Harvest by unit normalised by area and success rate: WY, CO, ID, WA.
  3. GAP plus state range only (presence, not density).

  Harvest per km² understates elk in limited-entry units, where the quota caps harvest, and overstates them in OTC units, where pressure is high. Success rate partly corrects for this but mixes in access and weather. Use harvest only as a coarse 3–5 class weight, never as a count.
- The OR figures (e.g. Starkey 7,502 elk in 2025) with WMU areas would give about elk per km² per unit. That is a cheap, defensible density layer for one state.

### Gaps
- No machine-readable (CSV or API) harvest tables were confirmed for any western state. All harvest sources found are PDFs or web pages. A Montana harvest-report URL (fwp.mt.gov/hunt/harvestreports) returned 404, so I could not confirm Montana's tool. The WDFW `WP_HuntPlanner/Harvest` MapServer probably joins harvest to GMUs, but its fields were not inspected.
- Field schemas of the UT `HUNT_INFO_MOBILE` table and the NM `HUNT_INFO`/`Licensing` fields were not read, so how much season data they actually carry is unknown.
- AR, OK, NE, KS, TX and AK elk zone GIS were not located.

## 5. How commercial apps present elk range, units and seasons, and where they source them

### Takeaway
The commercial leaders are built on exactly the state-agency layers catalogued above. onX shows state species-range layers (e.g. a WY Species Ranges layer with an Elk sublayer) sourced agency by agency, and admits the data differs between states. goHUNT and BaseMap sell research built on agency draw odds and harvest statistics per unit. HuntWise sells a weather-driven movement score. None, as far as found, offers a unified national seasonal elk range or a wind- or terrain-aware elk score. Seasonal range plus ground wind is open ground for Groundwind.

### Cited Findings
- onX gets elk range datasets from individual state agencies, with variation "between states due to data inconsistencies". Example: WY → "WY Species Ranges" layer → Elk sublayer. North Dakota elk range comes from ND Game and Fish. — [onX map layer legends (support)](https://support.onxmaps.com/hc/en-us/sections/4408666762125-Map-Layer-Folders-and-Map-Layer-Legends); [Eastmans on onX 4.0](https://blog.eastmans.com/4-0-app-onxmaps) (search snippets; pages not fetched; the Rokslide thread on onX winter/summer range returned 403)
- goHUNT "Filtering 2.0" filters units by draw odds, harvest success, public land percentage, trophy potential, bull:cow ratio and percentage of 6-point bulls. Unit profiles carry maps, terrain photos, private-land percentage, access, weather trends and historical harvest data. — [goHUNT filtering](https://www.gohunt.com/learn/filtering); [goHUNT Filtering 2.0 article](https://gohunt.com/browse/tips-and-tricks/skills/finding-hunts-with-filtering-20)
- HuntWise "HuntCast" combines barometric pressure, wind direction and speed, temperature swings, moon phase and historical movement data into a 1–10 "Huntability" score. It offers 11 base maps and 450+ layers. — [HuntWise Pro](https://huntwise.com/pro); [HuntWise vs onX](https://huntwise.com/field-guide/hunting-tips/huntwise-vs-onx-hunt-app-comparison) (search snippets)
- BaseMap's hunt finder lets a user ask for, say, OTC elk in a western state by rifle or bow and returns where that is possible, with harvest statistics, highest success rates and elk migration patterns. — [AgInfo: Base Map Hunting App](https://www.aginfo.net/report/34169//Base-Map-Hunting-App) (search snippet)
- National Geographic publishes a "Seasonal Elk Range NEW" ArcGIS Online layer (2023), owner unknown and not inspected. — [Seasonal_Elk_Range_NEW](https://services3.arcgis.com/AdYB7LvDmN7hzWUb/arcgis/rest/services/Seasonal_Elk_Range_NEW/FeatureServer)

### Inferences
- Groundwind can match onX's range coverage in the main states for free by baking the CO, WY, UT, NV, MT, OR and CA layers above per area. Its difference would be fusing season (Sept: summer and transition; Oct–Nov: transition and corridors, snow-driven; Dec: winter and concentration ranges) with head-height wind and scent, which none of the four competitors appear to do.
- The suggested range-gate model per area:
  1. Is the point in an elk hunt unit with an open elk season this year? (unit GIS plus curated season JSON)
  2. Is it in state elk range? (state layer, else GAP Known/extant HUC12)
  3. Is it edge? (GAP Possibly present or Vagrant, or state Limited Use, OUT, UND, or "not managed for elk")
  4. Is it absent? (GAP Extirpated or nothing)

  Results map to: present and hunted / present, no open season / rare-edge / absent. Weight by month-appropriate seasonal range and by a unit density class from per-unit population (OR, CO, MT) or harvest (WY, ID, CO).

### Gaps
- Exact onX, goHUNT, HuntWise and BaseMap data-source statements and licensing deals were not verified from primary pages, because the search budget ran out and Rokslide blocked fetches. Whether onX shows seasonal (winter or summer) elk range outside WY is unconfirmed.
- No evidence was found either way on whether goHUNT computes its own elk density surfaces.
