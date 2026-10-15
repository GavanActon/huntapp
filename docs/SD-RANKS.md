# Where the SD wind tiles go next: hunting units by harvest and hunters

Gavan, 2026-10-15: national and US SD should be ordered "based on hunting
harvest numbers and where hunters will be this fall". Ontario and Québec are
already queued (`pipeline/raw/windtiles/ranks.json`, docs/SD-FAST.md, "The
order"). This is the first draft for everywhere else.

- **The data:** `pipeline/raw/windtiles/ranks-next.json`. It has the
  provinces' and states' order, their units best first with the reason for
  each, and where each jurisdiction's unit outlines come from (URL, code
  field, licence).
- **What's built:** nothing yet. `hunt_priority.py` reads only ON and QC
  outlines.
- **Before any US bake:** the bake's inputs are Canada-only (MRDEM, NRCan
  land cover, SCANFI, CanLaD). The US needs adapters first: 3DEP, Annual
  NLCD, LANDFIRE EVT/EVH or a canopy height map, and MTBS. The surrogate
  also has to be checked on US ground.

Sources were gathered by research agents on 2026-10-15. Hunter-survey
harvests are estimates everywhere. Every figure in ranks-next.json carries
its year.

## The order

**Canada.** Score = 0.5 × harvest share + 0.5 × hunter or licence share,
both relative to Alberta.

| # | | Big-game harvest | Hunters or licences | Score |
|---|---|---|---|---|
| 1 | AB | 69,289 (2025, residents + outfitted) | 159,498 resident hunters (2025) | 1.00 |
| 2 | BC | 39,450 (2024) | 107,364 resident basic licences (2024/25) | 0.62 |
| 3 | SK | 26,495 (2025) | 74,645 big-game licences (2025) | 0.43 |
| 4 | NB | 17,231 (deer and moose 2025, bear 2021) | 46,638 deer + 4,823 moose licences (2025) | 0.27 |
| 5 | MB | ~17,500 (estimate: none published) | 49,350 big-game licences (2025/26) | 0.28 |
| 6 | NS | 12,079 (2025) | 46,077 deer licences (2025) | 0.23 |
| 7 | NL | ~16,855 island moose (estimate) | 29,692 moose + caribou quota (2026) | 0.22 |
| 8 | YT | not published | 5,777 licences (2023-24) | small |
| 9 | NT | not published | none found | small |

- **NB goes ahead of MB:** MB's number is an estimate, and NB's hunting is
  packed into 73,000 km².
- **Left out:** PEI has no deer, moose or bear season. Nunavut has no
  hunting units: harvest is set by herd limits through the communities.

**US.** Score = 0.5 × share of US paid hunting licence holders + 0.5 × share
of a harvest index, where the index is deer + 3 × elk + 3 × moose + bear.

- **Why 3×:** each elk or moose stands for 2–2.5 times the hunters a deer
  does (Montana and Colorado hunters per animal).
- **The order holds without the 3×:** with every species at 1× the top 15
  are the same.
- **Top 15:** TX, PA, MI, WI, GA, AL, MO, TN, NC, NY, LA, MN, OH, MS, OK.
- **Then:** AR, VA, CO, IL, KY, SC, MT, OR, IN, ID, WV, FL, IA, AZ, UT, KS,
  WY, CA, ME, and the rest.
- **The elk and moose states sit lower on hunter numbers:** Colorado 18,
  Montana 22, Idaho 25, Wyoming 32, Maine 34. To put them in the top 10,
  elk and moose would have to count about 10× a deer. That's a judgement
  for Gavan.
- **Licence holders** are USFWS "2023 data" as compiled by Stacker. The
  official dashboard, tracs.fws.gov, refused this network (HTTP 451).
- **Deer harvest** is the National Deer Association's 2026 Deer Report
  (2024-25 season): https://deerassociation.com/wp-content/uploads/2026/01/DR2026.pdf
- **The West** uses each agency's own 2025 totals.

**Units inside each jurisdiction** are ranked by total harvest, with
hunters where they're published. Units vary hugely in size: BC 5-2 is about
115 tiles, while BC 4-3 is 1,665 km². So when this is wired in, the tiles
should go by harvest (or hunters) per km², not by unit totals. And the
rounds should be weighted by these scores rather than one unit a turn for
each jurisdiction, which would put Yukon in the same rounds as Alberta.

## Canada: sources

| | Units (outline field) | Harvest by unit | Hunters | Notes |
|---|---|---|---|---|
| AB | WMUs, `WMUNIT_CODE` "00357" | 2025 resident reports by species, e.g. moose https://open.alberta.ca/dataset/b6104543-ef82-46e1-9f1b-6cf9dc41fb0e (and deer, elk, bear, the outfitted reports) | 159,498 residents (mywildalberta.ca annual sales); none by unit, estimated as harvest ÷ success | The reports say "357"; pad to 5. Some elk is reported for unit groups and was split evenly. |
| BC | WMUs, `WILDLIFE_MGMT_UNIT_ID` "5-2" | Big Game Harvest Statistics 1976–2024, the WMU CSV on catalogue.data.gov.bc.ca (dataset f2303645…), with hunters, days and kills | Hunting sales statistics 2005–2025 CSV | The CSV codes units as 502; convert to 5-2. Limited-entry draw data is "Access Only". |
| SK | WMZs, `ZONE_NUM` "45W" | 2025 Hunter Harvest Survey (publications.saskatchewan.ca 128485): **only draw and management licences by zone**, about 37% | 74,645 licences; 2026 draw quotas | The white-tailed deer zones are under-ranked as a result. Fold "33A" into 33. The licence says no resale. |
| MB | GHAs, `GHA` "29A" | **None published.** Stand-in: chronic wasting disease (CWD) samples from harvested animals by area (2024–26), plus the 2026 elk and moose draws | 49,350 resident big-game licences (2026 guide) | CWD sampling is mandatory in only 25 areas. |
| NB | WMZs, `wmz` | 2025 big game report (deer, moose), 2021 report (bear), gnb.ca | 2026 moose and antlerless permits by zone | Deer is closed in WMZ 4, 5 and 9. |
| NS | DMZs, `deer_zone` "101.0" | deer-harvest-2025.pdf by zone (novascotia.ca/natr/hunt) | 46,077 deer licences | Bear is reported by county. There is no moose hunt 2024–26. |
| NL | Moose areas, `mmu` "39A" | Published by area only to 2020, so 2024 is quota × success (the province's own method) | 2026 quotas: 28,705 island moose | Unsold licences make the estimate high. |
| YT | GMZ subzones, `GAME_MGMT_AREA_ID` (zone = id // 100) | By subzone it would need an access-to-information request; zones 4 and 11 (2022) are public | 5,777 licences, 3,815 moose seals | The 2026-27 regulations couldn't be fetched (yukon.ca blocks it). |
| NT | No official zone polygons; the regions are a stand-in | None | Hunted-or-fished counts by region (2023 community survey) | The zones would have to be digitized from the regulations map. |

**Fall 2026 seasons.** Archery opened in late August or September almost
everywhere.
- **Rifle:** AB moose and elk run September to November; SK deer from
  October or November.
- **Moose:** NB Sept 22–26; NL island moose Sept 12–Dec 31.
- **Deer firearms:** NS Oct 30–Dec 12; NB Oct 26–Nov 22; MB Nov 9–29.

## US: sources

| | Units (outline field) | Harvest by unit | Notes |
|---|---|---|---|
| TX | 44 white-tailed DMUs, `UnitNumber` "07 North" (TPWD MapServer) | **Only 2017-18** (pwd_rp_w7000_0718b.pdf, Table 15); TPWD offers newer tables by email | Public domain. "Urban Houston" is "U Houston". |
| PA | 22 WMUs, `wmu_id` "2D" | Deer 2025-26 by WMU (PGC deer harvest estimates report); bear 2025 | "Public Use". |
| MI | DMUs, `DeerManagementUnit` "332" | 2024 survey estimates (the report URL is now 404; an archived copy was used) | Units overlap; use 311/312/332 rather than the counties they cover. |
| WI | DMUs (counties + northern 101–126), `DEER_MGMT_UNIT_ID` | 2025 registered counts (DNR Deer Metrics) | Ask for outSR=4326. |
| GA | Counties | 2025-26 checked and adjusted counts, from the WRD layer that also holds the outlines | The same service holds live 2026 harvest records. |
| AL | Counties (TIGER) | Only an **unofficial** Esri layer (~2023-24 Game Check) | No zone polygons exist. |
| MO | Counties (TIGER) | Final 2025-26 Telecheck counts (MDC) | Map MDC's county names to TIGER's. |
| TN | Counties (TIGER, or the TWRA DMU layer) | 2025-26 check-ins (report 180) | Excludes 11,703 deer taken on WMAs. |
| NC | Counties (TIGER) | 2025-26 reported harvest (NCWRC) | Bear by unit too (Coastal 2,952). |
| NY | WMUs, `UNIT` "9H" | 2025 by WMU (DEC 2025deerrpt.pdf); the rows sum to the state total | |
| MN | Deer Permit Areas, `dpa` | 2025 deer report, Table 3 | The layer carries the 2026 season dates. There is no moose season. |
| CO | GMUs, `GMUID` | **2024 is the latest by-GMU year** (2025 reports are by DAU) | CPW data, as is. |
| MT | Hunting districts, `DISTRICT` (one layer per species) | 2025 estimates as CSV (myfwp.mt.gov harvest reports) | 411E/W etc. become 411. |
| ID | GMUs, `NAME` "10A" | 2025 estimates (IDFG hunt planner) | The names match the outlines exactly. |
| WY | Hunt areas per species, `HUNTAREA` (written "elk:7") | 2025 elk, deer and moose reports (wgfd.wyo.gov) | Not to be used at scales finer than 1:100,000. |
| ME | WMDs, `IDENTIFIER` | Moose and bear by WMD, 2025; deer by WMD estimated from town points | **No redistribution without written permission**, so local use only, as with Québec's zones. |

**Fall 2026 gun openers**, when hunters peak:
- **Oct 17–24:** GA and eastern NC (Oct 17), the NY Northern Zone (Oct 24),
  MT (Oct 24). CO rifle seasons from Oct 14 and ID Oct 10–27 fall in this
  stretch too.
- **Oct 31–Nov 2:** ME.
- **Nov 7–15:** TX (Nov 7), MN (Nov 7), MO (Nov 14), MI (Nov 15).
- **Nov 21–28:** WI, TN and the NY Southern Zone (Nov 21), PA (Nov 28).

If tiles are timed to the season, that's the order.
