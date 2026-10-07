# Elk range and hunting in Canada, an app-area check, and machine-readable range and season data

Researched 2026-10-05. Web search ran out partway through, so the later findings come from fetching primary pages and from direct API checks: GBIF, NatureServe Explorer, Ontario LIO, the CKAN catalogues of BC, Alberta, Ontario, Quebec and Yukon, and Quebec's official range GeoPackage. Each API result gives the call it came from, so the numbers can be checked again. Scratch files from the checks are in the session scratchpad and are not committed.

## 1. Where elk live in each province and territory, rough numbers, and open seasons

### Takeaway
Wild elk with real hunting are a western-prairie story. Alberta has about 26,000, BC about 40,000, Saskatchewan 10,000–15,000 and Manitoba about 8,000 (figures as of Feb 2025). Ontario has a few hundred restored elk with one tiny draw: 12 tags, Bancroft–North Hastings only. Yukon has two small introduced herds (Takhini about 270, and a smaller Braeburn herd that is closed or at 0 permits for 2026). Quebec, the Maritimes and Newfoundland have no wild elk (extirpated). In the NWT elk are only vagrants.

### Cited Findings
**National numbers**
- The Saskatchewan elk management plan (Feb 2025) gives these estimates: Saskatchewan "likely ranges from 10,000 to 15,000"; neighbouring Alberta 26,000, Manitoba 8,000, British Columbia 40,000, Montana more than 160,000. The plan calls Saskatchewan's elk "some of the northernmost extent of their North American range". — [Management Plan for Elk in Saskatchewan 2025-2034, p.10](https://swf.sk.ca/wp-content/uploads/2025/10/Elk-MP.pdf)
- NatureServe subnational ranks for *Cervus canadensis* (API, retrieved 2026-10-05): Canada N5; AB S5, BC S5, MB S4, SK S4, **QC SX (extirpated)**, **YT SU (unrankable)**. Ontario, NB, NS, PE, NL, NT and NU are **not listed at all**. Ontario is missing even though it has a restored, hunted population. — [NatureServe Explorer API, ELEMENT_GLOBAL.2.1353292](https://explorer.natureserve.org/api/data/taxon/ELEMENT_GLOBAL.2.1353292)
- GBIF occurrence counts of elk in Canada (taxonKey 4262380, *Cervus elaphus canadensis* in the GBIF backbone, 2026-10-05) by province text: Alberta 3,865, BC 1,693, Saskatchewan 320, Yukon 221, Ontario 196, Manitoba 100 (+20 as "Manitoba (Prov.)"), Québec 2, NWT 1. 6,551 in total. These count records, not animals. — [GBIF occurrence API, facet stateProvince](https://api.gbif.org/v1/occurrence/search?country=CA&taxonKey=4262380&limit=0&facet=stateProvince)

**Alberta**
- In the 2026 regulations, Mountain WMUs 400 and 402 have **general** (non-draw) antlered elk seasons (3-point or larger, S1–S16 then S17–N30), and so does WMU 429 (3-point or larger, S1–O31 then N1–N30). WMUs 436–446 have general seasons for 6-point or larger bulls (A25–S16 then S17–N30). WMUs 404, 406, 408, 412–434 are **special licence (draw) only** for antlered elk. — [albertaregulations.ca, Mountain WMUs 400 series (2026)](https://www.albertaregulations.ca/huntingregs/wmu400.html)
- Alberta has antlered and antlerless elk special licence draws, a WMU 300 antlered elk special licence, and Minister's draws. — [2025 Alberta Hunting Draws](https://albertaregulations.ca/2025-Alberta-Hunting-Draws.pdf) (seen in search results only, not opened)
- CFB Suffield is a known prairie hotspot. One report put the herd at 6,600–8,000 and a later one at about 5,400, with tags rising from 200 (2012) to 2,100. — [Western Producer](https://www.producer.com/livestock/hunter-access-to-army-base-expands-to-reduce-elk/) (search snippet; article dates not verified, so treat as historical)

**British Columbia**
- The BC synopsis covering July 1, 2026 to June 30, 2028 is split by region. — [BC Hunting & Trapping Regulations Synopsis page](https://www2.gov.bc.ca/gov/content/sports-culture/recreation/fishing-hunting/hunting/regulations-synopsis)
- Region 4 (Kootenay) has general elk seasons, mostly 6-point bulls, in MUs 4-1 to 4-7, 4-20 to 4-26, 4-34 to 4-36 and 4-40 (Sept 10–Oct 20), plus bow-only seasons from Sept 1. Elk heads must be submitted for CWD testing in high-risk areas. — [BC synopsis, Region 4 Kootenay (2026-2028)](https://www2.gov.bc.ca/assets/gov/sports-recreation-arts-and-culture/outdoor-recreation/fishing-and-hunting/hunting/regulations/hunting-trapping-synopsis-region-4-kootenay.pdf)
- Region 7B (Peace) has general elk seasons: 6-point bulls in MUs 7-42 and 7-57 Aug 15–Oct 31; 3-point bulls in 7-20, 7-21, 7-32 to 7-35, 7-43 to 7-46 and 7-58 Sept 1–Oct 31; antlerless Sept 15–Oct 15 in several MUs. — [BC synopsis, Region 7B Peace](https://www2.gov.bc.ca/assets/gov/sports-recreation-arts-and-culture/outdoor-recreation/fishing-and-hunting/hunting/regulations/hunting-trapping-synopsis-region-7b-peace.pdf)
- The Region 1 (Vancouver Island, Roosevelt elk) synopsis lists **no general elk season**. The only elk mention in its text is CWD sampling, so Roosevelt elk hunting must be Limited Entry only. — [BC synopsis, Region 1](https://www2.gov.bc.ca/assets/gov/sports-recreation-arts-and-culture/outdoor-recreation/fishing-and-hunting/hunting/regulations/hunting-trapping-synopsis-region-1-vancouver-island.pdf) (my text search of the PDF)
- Vancouver Island Roosevelt elk roughly doubled from 2,700 (1981) to an estimated 5,300–6,300 (2024). A small introduced Rocky Mountain elk population lives on Graham Island, Haida Gwaii. — [The Narwhal](https://thenarwhal.ca/bob-the-elk-youbou-bc/) (search snippet). The BC Species & Ecosystems Explorer gives the provincial elk population as 10,000–100,000 (a rank band). — [BC Species & Ecosystems Explorer](https://a100.gov.bc.ca/pub/eswp/esr.do?id=16144) (search snippet)

**Saskatchewan**
- Elk occur in "relatively discrete populations" in the Cypress Upland, Mixed Grassland and Aspen Parkland, more continuously through the Boreal Transition and Mid-Boreal Upland, and in island forests: Fort à la Corne, Moose Mountain PP, Cypress Hills. Licensed elk hunting resumed in 1958. — [SK Elk Management Plan, p.10](https://swf.sk.ca/wp-content/uploads/2025/10/Elk-MP.pdf)
- Recent survey figures: Moose Mountain (WMZ 33) 1,293 (2023-24); Duck Mountain PP (WMZ 37) 393 (2019-20); WMZ 50 at least 460 (2021-22). An April 2025 aerial survey of WMZ 39 expected about 1,200 elk. — [SK Elk MP Table 1, p.12](https://swf.sk.ca/wp-content/uploads/2025/10/Elk-MP.pdf); [SK publication](https://publications.saskatchewan.ca/api/v1/products/127214/formats/149987/download) (search snippet)
- 2026: "Elk hunting opportunities remain available throughout much of the province". There are resident-only draws (either-sex and antlerless) in the agricultural WMZs, and CWD testing is mandatory for elk taken on **draw and regular licences** in WMZ 43, 47, 49, 50, 53 and 55. So the forest zones also have regular, over-the-counter elk licences. Tentative 2026 antlerless quotas include 39A (625), 41A (225) and 54A (250). — [2026 Saskatchewan Resident Big Game Draw Supplement](https://publications.saskatchewan.ca/api/v1/products/68828/formats/76502/download)
- An extra antlerless season ran Nov 20–27, 2025 in the southern half of the province ($30 licence, one WMZ per hunter, no licence cap) because of crop damage. — [Global News, 2 Oct 2025](https://globalnews.ca/news/11461304/saskatchewan-allowing-hunt-of-antlerless-elk)

**Manitoba**
- The 2026 guide (licence year Apr 1, 2026 to Mar 31, 2027) says elk are **Manitoba-resident only and by draw**: a general (rifle) draw, an archery draw and a landowner draw. Licences are $67.20. — [Manitoba Hunting Guide 2026, p.42](https://www.manitoba.ca/nrnd/fish-wildlife/pubs/fish_wildlife/huntingguide.pdf)
- 2026 elk GHAs: 13, 13A, 14 (parts), 18, 18A, 18B, 18C, 19, 19A, 20, 21, 22 (new for 2026), 23, 23A, 25, 25A, 28, 31A, 29, 29A, 30 (excluding CFB Shilo), and 35A (new archery). Rifle seasons run roughly Sept 28–Oct 18 and Dec 14–20, with late seasons into January in 23/23A. Archery runs Aug 31–Sept 20 (to Nov 8 in 23/23A). GHAs 28/31A tags rose from 40 to 50 for each rifle season and from 80 to 100 for archery. — [Manitoba Hunting Guide 2026](https://www.manitoba.ca/nrnd/fish-wildlife/pubs/fish_wildlife/huntingguide.pdf)
- Herds are concentrated around Riding Mountain, Duck Mountain, Porcupine and Turtle Mountain. Riding Mountain elk are counted by aerial survey every winter. — [Elk Abundance – Riding Mountain (open data)](https://donnees.iriu.ca/dataset/3c3ca771-06b3-4a98-bce3-abc9f622e7a2); [Outdoor Canada 2021 forecast](https://www.outdoorcanada.ca/2021-canadian-big-game-hunting-forecast-hot-spots-for-deer-moose-elk-bear-and-more/5) (search snippets)

**Ontario** (detail in section 2)
- 443 elk were released at four sites in 1998–2001. The first modern licensed hunt was at Bancroft in 2011. Only Ontario residents may get elk licences. — [ontario.ca, Elk in Ontario](https://www.ontario.ca/page/elk-ontario)

**Yukon**
- Elk were introduced to southern Yukon in the 1950s, with more releases in the 1990s, mostly from Elk Island National Park. The Takhini herd ranges west of Whitehorse, with its core between the Takhini River bridge and Mendenhall. A Nov–Dec 2024 drone survey found 270 elk and estimated the herd at **about 270 (upper bound about 300)**. — [Takhini Elk Herd Survey, Early-winter 2024 (Government of Yukon, Dec 2025)](https://open.yukon.ca/information/b6a1f544-a9cc-4289-ab1e-ce867965f711/resource/1fd10c65-7c19-4040-8a6e-d74c2dbdf555/download/env-takhini-elk-early-winter-survey-2024-full-report.pdf)
- 2026 Yukon elk permit hunts:
  - Braeburn: EL14 (cow) **CLOSED**; EL15 (bull) **0 permits**.
  - Takhini core: EL20/EL21 **CLOSED**.
  - Takhini cow buffer: EL22 **CLOSED**.
  - Takhini buffer bulls: EL23, 4 permits (Sept 1–Mar 31); EL24 Wildlife Act permits, 8 for bulls with 5 points or fewer.

  The inset map shows almost all of Yukon as an "**Elk exclusion area (Wildlife Act permit required)**". The parts shown "Closed to elk hunting" are GMZ 10 and 11, Kluane NP and Wildlife Sanctuary, Ivvavik and Vuntut NPs, Ddhaw Ghro HPA and GMS 4-51. — [Yukon Elk Permit Hunt Area 2026 map](https://open.yukon.ca/information/663bc543-91b8-4a91-83c3-3436c70d23a0/resource/62e27fe8-a4c1-4e17-900a-242b21b531d0/download/env-elk-pha-2026.pdf); [2026 PHA data sheet](https://open.yukon.ca/information/663bc543-91b8-4a91-83c3-3436c70d23a0/resource/8c583d0c-2da4-45fc-87d2-1d34d20ea110/download/env-2026-permit-hunt-authorization-data-sheet.pdf)
- "Bull and cow elk in the exclusion area can be hunted at any time of year". Most exclusion-area elk are taken along the Alaska Highway toward Haines Junction or in the North Klondike Highway farm area: 12 bulls and 2 cows since 2009. — [Takhini survey report](https://open.yukon.ca/information/b6a1f544-a9cc-4289-ab1e-ce867965f711/resource/1fd10c65-7c19-4040-8a6e-d74c2dbdf555/download/env-takhini-elk-early-winter-survey-2024-full-report.pdf). The exclusion-area permit is open to any Yukon resident, season April 1 to March 31. — [yukon.ca, Hunting elk in the Yukon](https://yukon.ca/en/elk-hunt) (search snippet; yukon.ca blocked fetching)
- The Braeburn elk hunt was closed for 2025–26 "to protect and support the recovery of the local elk". — [yukon.ca news, 2025–26 licensing changes](https://yukon.ca/en/news/government-yukon-announces-key-changes-2025-26-hunting-and-fishing-licensing-year) (search snippet). One older figure put Braeburn at about 100 elk. — [Yukon News](https://www.yukon-news.com/news/elk-hunting-season-premieres/) (search snippet, old)

**Quebec**
- NatureServe ranks elk **SX (extirpated)** in Quebec. — [NatureServe API](https://explorer.natureserve.org/api/data/taxon/ELEMENT_GLOBAL.2.1353292)
- Quebec's official range layer (69 terrestrial mammals, CC-BY 4.0, updated 2026-03-16) has no wapiti or *Cervus* range. — [Aires de répartition (Données Québec)](https://www.donneesquebec.ca/recherche/dataset/aires-de-repartition-faune) (my check of the GeoPackage)
- Quebec's historical big-game harvest statistics cover only caribou, deer, wild turkey, moose and black bear. — [Statistiques historiques de chasse (Données Québec)](https://www.donneesquebec.ca/recherche/dataset/statistiques-historiques-de-chasse-et-piegeage-au-quebec)
- Elk "historically inhabited southern Quebec and central Ontario" and were gone from the region by the early 1900s. — [Canadian Field-Naturalist, History of Elk Restoration in Ontario](https://canadianfieldnaturalist.ca/index.php/cfn/article/view/1842) (search snippet; site would not resolve when fetched)

**NWT**
- General status: **Vagrant**, found only in the extreme southwest (Nahanni NP Reserve, Liard/Dehcho). Records: a Nahanni sighting in 2003, elk heard and seen south of Trout Lake in the rut, and one bull harvested Sept 23, 2005 at 62.305 N, 123.725 W. Changed from "undetermined" to "vagrant" in 2020; page updated Feb 14, 2024. — [NWT Species Search, Elk (Wapiti)](https://www.gov.nt.ca/species-search/node/419819)

**Maritimes and Newfoundland**
- NatureServe lists no NB, NS, PE or NL record for elk, and GBIF has 0 elk records there. — [NatureServe API](https://explorer.natureserve.org/api/data/taxon/ELEMENT_GLOBAL.2.1353292); [GBIF facet](https://api.gbif.org/v1/occurrence/search?country=CA&taxonKey=4262380&limit=0&facet=stateProvince)
- Nova Scotia's historical elk is recorded as extinct. — [Canadian Field-Naturalist wolf history article](https://www.canadianfieldnaturalist.ca/index.php/cfn/article/view/1775) (search snippet)

### Inferences
- Gate state by jurisdiction:
  - **AB, BC, SK, MB:** present and hunted. Gate at WMU/MU/WMZ/GHA level, because many units have no elk or are draw-only.
  - **ON:** present; hunted only in WMUs 57, 58, 60–62 and 63A (12 tags). Elsewhere, present at small herds or absent, with no open season.
  - **YT:**
    - The Takhini and Braeburn ranges have permit hunts (Braeburn effectively closed in 2026).
    - Everywhere else (the exclusion area), the legal season is open but elk are absent or vagrant. The open season exists to remove dispersers, not because there are elk to hunt.
  - **QC, NB, NS, PE, NL, NU:** absent.
  - **NT:** vagrant only, no regular season known.
- NatureServe's S-ranks can't be the only gate: they leave out Ontario and rank Yukon "SU". Sanity-check them against provincial regulations.

### Gaps
- No single, dated, Canada-wide elk total. The figures above are the ones the Saskatchewan plan cites (Feb 2025); Alberta's and BC's own current estimates weren't confirmed from their own documents.
- I didn't open the Alberta and BC general-versus-draw details beyond the sampled WMUs and regions. The Roosevelt elk LEH hunt codes and quotas (separate LEH synopsis) weren't checked.
- Whether the NWT has any open elk season wasn't found.
- The Manitoba elk population wasn't confirmed from a Manitoba source (8,000 is the Saskatchewan plan's figure).

## 2. Ontario: restored herds, current numbers, and which WMUs have an elk hunt

### Takeaway
As of 2025–2026 Ontario's only elk hunt is a tiny resident draw in Bancroft–North Hastings: WMUs 57, 58, 60, 61, 62 and 63A, 8 harvest areas, 12 tags in 2026 (3 areas with 2 bulls and 2 cows each). In 2025, 4 elk were taken. There has been **no expansion**. The 2014 proposal for Lake Huron North Shore population objectives was formally dropped in March 2023. The LHNS (Blind River–Thessalon–Bruce Mines) and Nipissing–French River herds are small, roughly 100 each by a 2024 account, and unhunted under licence. Indigenous harvest and farm-conflict removals happen there.

### Cited Findings
- 2026 elk tag quotas, by harvest area (all in Bancroft–North Hastings, WMUs 57–63A):
  - Areas 2 (WMU 57 east), 5 (WMU 61 north) and 6 (WMU 61 south): 2 bulls and 2 cows each.
  - Areas 1, 3, 4, 7 and 8 (WMUs 57 west, 58, 60, 62, 63A): 0.

  A successful applicant can't get another elk tag for 5 years. — [ontario.ca, Elk tag quotas](https://www.ontario.ca/page/elk-tag-quotas)
- The 2026 resident elk season runs **Sept 21–Oct 4** in WMUs 57, 58, 60–62 and 63A. 12 tags; bull or cow assigned at random; groups of up to 4. — [Ontario Hunting Regulations Summary: Elk](https://ontario.ca/document/ontario-hunting-regulations-summary/elk). The 2025 season was reported as Sept 16–29 in the same WMUs, with the same 2+2 quotas in areas 2, 5 and 6. — [same page, via search snippet for 2025]
- 2025 Mandatory Elk Hunter Report: 9 tag holders, 8 reported (89%), 100% of tag holders hunted. Harvest: Area 2 none, Area 5 one bull, Area 6 two bulls and one cow, **4 in total**. — [2025 Mandatory Elk Hunter Report Summary (Mar 2026)](https://www.ontario.ca/files/2026-03/mnr-2025-elk-hunter-report-summary-en.pdf)
- Ontario elk harvest CSV (harvest areas 57-01…63-08, 2011–2025). Totals: 2011: 20, 2012: 22, 2013: 23, 2014: 7, 2015: 15, 2016: 11, 2017: 10, 2018: 7, 2019: 13, 2020: 6, 2021: 4, 2022: 6, 2023: 4, 2024: 5, 2025: 4. — [data.ontario.ca, Elk harvests (OGL-Ontario)](https://data.ontario.ca/dataset/elk-harvests)
- Releases, 1998–2001: 443 elk from Elk Island NP to Bancroft–North Hastings, Nipissing–French River, Lake Huron North Shore and Lake of the Woods. — [ontario.ca, Elk in Ontario](https://www.ontario.ca/page/elk-ontario). By site: about 170 at Burwash (Nipissing–French River), 120 on the north shore of Lake Huron, 200 at Bancroft and "a smaller herd" at Lake of the Woods. — [CBC Sudbury, 1 May 2024](https://www.cbc.ca/news/canada/sudbury/elk-restoration-northern-ontario-1.7186287). Lake of the Woods got 104. — [Lakehead University thesis record](https://knowledgecommons.lakeheadu.ca/handle/2453/4943?show=full) (search snippet)
- Provincial population was "about 800 elk" by 2013. — [Canadian Field-Naturalist, History of Elk Restoration in Ontario](https://canadianfieldnaturalist.ca/index.php/cfn/article/view/1842) (search snippet). Bancroft was estimated at 293–476 in 2012, "as much as half" the provincial total. — (search-result snippet; the original page wasn't identified, possibly an [Ottawa Citizen 2013 piece](https://www.pressreader.com/canada/ottawa-citizen/20131009/281552288578623). Treat as unverified)
- 2024: "The latest provincial surveys show the herds haven't grown much since the original 440". Retired biologist Josef Hamr said "recent aerial surveys by the Ministry of Natural Resources showed about 100 elk in each herd". Elk are hit by cars and trains, eaten by wolves and shot by hunters. Farmers along the north shore "are not allowed to shoot the protected species" but many invite First Nations hunters in, for example a Thessalon-area farmer. — [CBC Sudbury, 1 May 2024](https://www.cbc.ca/news/canada/sudbury/elk-restoration-northern-ontario-1.7186287). Overall estimates in other coverage range from "500 to 1,000" to a "best estimate … just over 700". — (search snippets; dates and attribution uncertain)
- Lake Huron North Shore objectives (ERO 012-2541): a proposed objective of 300 elk (240–360). The herd was "growing at a rate of about 10–15% per year" and had "quadrupled in size since the initial release" (2014 text). **Decision 30 Mar 2023: the ministry "will no longer proceed with this proposal"**, calling the objectives "an outdated perspective". No hunt was proposed. — [ERO 012-2541](https://ero.ontario.ca/notice/012-2541)
- Nipissing–French River (Sudbury) herd: "have not grown substantially", with mortality that keeps it from becoming self-sustaining. — [ERO 012-0370](https://ero.ontario.ca/notice/012-0370) (search snippet)
- Lake of the Woods: a camera-trap mark–recapture study (2013–2021) gave only a biased minimum estimate but suggested increase. — [Henderson 2022, Lakehead](https://knowledgecommons.lakeheadu.ca/items/02ff7145-30c1-4967-9e0f-c9e6e99307f6/full)
- The 2010 Ontario Elk Management Plan places the release sites in Cervid Ecological Zones D1 (Lake of the Woods) and D2 (the other three). It says only "consider implementation of an elk harvest" and names no areas. — [Elk management plan (2010)](https://ontario.ca/page/elk-management-plan-0)
- My point checks against LIO's WMU layer: Bancroft is WMU 57; Burwash/Sudbury 42; Kenora 7B; Desbarats and Bruce Mines **36**; Thessalon, Iron Bridge and Blind River **37**. — [LIO WMU MapServer layer 5](https://ws.lioservices.lrc.gov.on.ca/arcgis2/rest/services/LIO_OPEN_DATA/LIO_Open05/MapServer/5)

### Inferences
- The LHNS herd's range spans at least WMUs 36 (Desbarats, Bruce Mines, Echo Bay) and 37 (Thessalon to Blind River), from GBIF records joined to WMU polygons (section 3). Neither WMU has a licensed elk season.
- A recent Ontario expansion to WMUs 36/37/41/42 was the specific thing to check. Nothing in the 2026 regulations, the 2026 quotas or ERO shows one, and the only related ERO posting was withdrawn.

### Gaps
- No ministry-published current herd estimates for LHNS, Nipissing–French River or Lake of the Woods were found. The "about 100 each" is a retired biologist quoting MNR surveys (2024).
- The original source for the 2012 Bancroft 293–476 figure wasn't confirmed.
- The 8 elk harvest-area polygons were found only as a PDF map, not as open data.

## 3. The app's areas: elk presence and seasons, and deer presence

### Takeaway
- **Sault test (WMU 36):** elk are **present at the edge**. The LHNS herd's western fringe has GBIF records 28–60 km east, many inside WMU 36, but there is **no elk season**. "Great elk territory" would be wrong.
- **Pickle Lake (WMU 21B):** elk **absent**. Nearest herd about 315–335 km; no season.
- **Lac Bailey (QC zone 18):** elk **absent**. Extirpated in Quebec; no season.
- **Highland Lake (YT GMS 4-09):** elk **absent**. Nearest herd range about 170–220 km. **Legally** the area is inside the territory-wide elk exclusion area where a Wildlife Act permit allows year-round elk hunting.
- White-tailed deer: abundant at Sault; sparse but in season near White River; just outside the official range at Lac Bailey, with a first season in zone 18 from fall 2026; none in Yukon. Mule deer in Yukon are rare near Highland Lake but under a territory-wide 6-permit hunt.

### Cited Findings
**Method:** GBIF occurrence API (`geoDistance`, `hasGeospatialIssue=false`). Nearest record and counts per radius, retrieved 2026-10-05. GBIF records are presence-only and cluster near roads and towns; [GBIF API](https://api.gbif.org/v1/occurrence/search).

**(a) Sault test, 46.47 N, 84.49 W, WMU 36**
- WMU confirmed as **36** — [LIO WMU layer](https://ws.lioservices.lrc.gov.on.ca/arcgis2/rest/services/LIO_OPEN_DATA/LIO_Open05/MapServer/5)
- Elk GBIF records: 0 within 25 km, 67 within 50 km, 98 within 100 km. Nearest 28 km at 46.360, −84.160 (iNaturalist, 2021); newest 2026. Of the 98 within 100 km, **65 fall in WMU 36**, 24 in WMU 37 and 8 in WMU 45. By year, 2023: 23, 2024: 13, 2025: 10, 2026: 5. — [GBIF API](https://api.gbif.org/v1/occurrence/search?taxonKey=4262380&geoDistance=46.47,-84.49,100km) joined to the LIO WMU layer
- Distances to the LHNS herd: Desbarats 45 km, Bruce Mines 57 km, Thessalon 76 km, Iron Bridge 100 km, Blind River 122 km (my haversine). The nearest licensed elk hunt (Bancroft, WMU 57) is about 540 km away.
- Local report: an elk herd in the Kent Family Farms sunflower field at the St. Joseph Island turnoff on Hwy 17. A reader said the elk came from a restoration project (SJI Hunters and Anglers with the MNR) "maybe 20 years ago". — [SooToday, 12 Mar 2023](https://sootoday.com/local-news/photos-have-you-herd-about-these-elk-6687397)
- No elk season in WMU 36: elk open only in WMUs 57, 58, 60–62, 63A. — [Ontario regs: Elk](https://ontario.ca/document/ontario-hunting-regulations-summary/elk)
- White-tailed deer in WMU 36:
  - 2026 rifle/shotgun/muzzleloader/bow season Nov 2–15 for residents and non-residents, with extra bow-only seasons. — [Ontario regs: White-tailed deer](https://www.ontario.ca/document/ontario-hunting-regulations-summary/white-tailed-deer)
  - Estimated harvest 2019–2025 of 247–400 a year from about 1,500–1,700 active hunters (2025: 301 deer, 1,588 hunters). — [data.ontario.ca, White-tailed deer hunting activity and harvest](https://data.ontario.ca/dataset/white-tailed-deer-hunting-activity-and-harvest)
  - GBIF: 18 deer records within 5 km; moose and black bear also within 1–2 km.
- Mule deer: none within 450 km (one 2022 Detroit-area record, probably captive or misidentified).

**(b) Pickle Lake near White River, 48.93 N, 85.59 W, WMU 21B**
- WMU confirmed as **21B** — [LIO WMU layer](https://ws.lioservices.lrc.gov.on.ca/arcgis2/rest/services/LIO_OPEN_DATA/LIO_Open05/MapServer/5)
- Elk: 0 GBIF records within 250 km. Nearest 302 km at 46.410, −84.063 (LHNS herd, 2020). Distance to LHNS towns 314–363 km, to Lake of the Woods (Kenora) about 650 km. No elk season.
- White-tailed deer:
  - 2026 WMU 21B deer season: residents Oct 10–Dec 15, non-residents Oct 12–Nov 15. — [Ontario regs: White-tailed deer](https://www.ontario.ca/document/ontario-hunting-regulations-summary/white-tailed-deer)
  - Harvest estimates for 21B appear only through 2018. Most years 0; 17 in 2017 from 51 hunters; 0 in 2018 from 35 hunters. — [data.ontario.ca deer harvest CSV](https://data.ontario.ca/dataset/white-tailed-deer-hunting-activity-and-harvest)
  - GBIF: 0 deer records within 50 km, 9 within 100 km, nearest 60 km at 48.733, −86.370 (near Marathon, 2025).
- Moose nearest record 17 km, black bear 21 km, ruffed grouse 14 km, spruce grouse 16 km (GBIF).

**(c) Lac Bailey, Quebec, 49.41 N, 69.55 W, zone 18**
- Elk: absent. QC is SX in NatureServe; no wapiti in Quebec's official range layer; no wapiti harvest statistics (see section 1). GBIF has 1 record within 150 km, at 146 km (48.119, −69.165, iNaturalist 2011, south shore of the St. Lawrence; probably a farmed or escaped animal, unverified). The nearest wild herd (Bancroft, Ontario) is about 790 km away.
- White-tailed deer:
  - Quebec's official deer range polygon **does not contain** Lac Bailey; its edge is about 54 km away (my point-in-polygon test). The same layer **does** contain Lac Bailey for moose (*Alces americanus*), black bear, wolf and caribou. — [Aires de répartition des mammifères terrestres, MELCCFP (CC-BY 4.0)](https://www.donneesquebec.ca/recherche/dataset/aires-de-repartition-faune)
  - Zone 18 opens to deer hunting **from fall 2026**, under the rules for zones with marginal deer numbers: a youth bow and crossbow weekend, 6 days of bow/crossbow, then 3 days of muzzleloader/shotgun, **antlered males only**. The reason given is that "Le cerf de Virginie était très rare sur la Côte-Nord au début des années 2000" but is now present enough. — [Plan de gestion du cerf de Virginie: changements (MELCCFP FAQ, 2026)](https://cdn-contenu.quebec.ca/cdn-contenu/faune/documents/gestion-especes/Plans-gestion/plan-gestion-cerf-virginie-changements.pdf)
  - Quebec's deer harvest CSV records zone 18 harvests only in 1971–1982 (1–3 deer a year) and none since, through 2025. — [Statistiques historiques de chasse – cerf (CC-BY 4.0)](https://www.donneesquebec.ca/recherche/dataset/statistiques-historiques-de-chasse-et-piegeage-au-quebec)
  - GBIF: nearest deer record 72 km (48.820, −69.152, 2024, north shore near Forestville).
- The app's own area file says the Quebec hunting zone layer is missing because "the hunting zones' only source (SmartFaune) states no licence". — `C:\dev\huntapp\app\src\areas\lac-bailey.json` (line 140)

**(d) Highland Lake, Yukon, 63.36 N, 134.76 W, GMS 4-09**
- The app's area file records GMS 4-09, taken from the GeoYukon Game Management Areas 250k layer. — `C:\dev\huntapp\app\src\areas\highland-lake.json`
- Elk:
  - Nearest Yukon Elk Wildlife Key Area is **169 km** away (the Braeburn herd range at its northern end; other Braeburn polygons Montague Mountain 182 km, Cone Hill 191 km). All 13 elk key areas belong to the Braeburn or Takhini herds. — [Yukon Wildlife Key Areas 250k (OGL-Yukon)](https://open.yukon.ca/data/elk-wildlife-key-area-250k) (my distance check on the shapefile)
  - GBIF: 0 elk within 100 km, 21 within 250 km, nearest 202 km at 61.623, −135.879 (2023). Takhini core about 286 km away.
- The legal side: the 2026 inset map shades all of GMZ 4 except GMS 4-03 and 4-51 as "Elk exclusion area (Wildlife Act permit required)". — [Yukon Elk Permit Hunt Area 2026](https://open.yukon.ca/information/663bc543-91b8-4a91-83c3-3436c70d23a0/resource/62e27fe8-a4c1-4e17-900a-242b21b531d0/download/env-elk-pha-2026.pdf). Exclusion-area elk can be hunted year-round. — [Takhini survey report](https://open.yukon.ca/information/b6a1f544-a9cc-4289-ab1e-ce867965f711/resource/1fd10c65-7c19-4040-8a6e-d74c2dbdf555/download/env-takhini-elk-early-winter-survey-2024-full-report.pdf)
- Mule deer:
  - Arrived from BC about 1900; now "found as far north as Dawson, with most sightings along the highways of southern Yukon"; "only a few permits for hunting deer issued each year". — [yukon.ca, Mule deer](https://Yukon.ca/en/mule-deer) (search snippet; fetching blocked)
  - 2026: hunt code **DE 604 (periphery)** covers GMZs 2, 3 and 4 (except 4-03 and 4-51), 10, 11 and parts of zone 1, Aug 1–Nov 30, **6 permits**. DE 603 (core) covers GMZ 5, 7, 8 and 9 with 10 permits. DE 602 is a youth hunt with 4 permits. — [2026 PHA data sheet](https://open.yukon.ca/information/663bc543-91b8-4a91-83c3-3436c70d23a0/resource/8c583d0c-2da4-45fc-87d2-1d34d20ea110/download/env-2026-permit-hunt-authorization-data-sheet.pdf); [Deer 2026 PHA map](https://open.yukon.ca/information/663bc543-91b8-4a91-83c3-3436c70d23a0/resource/1d0ba04f-1c48-4cf7-a9e8-235e48ce31ba/download/env-deer-pha-2026.pdf)
  - The nearest mule deer Wildlife Key Area is 155 km away (Carmacks winter range). GBIF has its nearest mule deer record at 107 km (62.837, −136.546, near Pelly Crossing, 2024) and 0 within 100 km.
  - NatureServe ranks mule deer YT **S3S4**. — [NatureServe API](https://explorer.natureserve.org/api/data/taxon/ELEMENT_GLOBAL.2.101365)
- White-tailed deer: "A few … occur in the Yukon … too few to support a hunting season". — [yukon.ca, Mule deer](https://Yukon.ca/en/mule-deer) (search snippet). GBIF has 0 records within 600 km of Highland Lake, NatureServe lists no YT rank, and Yukon has no white-tailed deer key area.
- Moose: nearest Moose Wildlife Key Area 12 km (Mayo Lake south, late-winter range, survey). Black bear GBIF nearest 63 km. Spruce grouse: 112 records within 100 km.

### Inferences
Proposed range-gate states, using the four states in the brief.

| Area | Elk | White-tailed deer | Mule deer | Moose | Black bear | Ruffed / spruce grouse |
|---|---|---|---|---|---|---|
| Sault test (ON 36) | **present, no open season** (edge of LHNS herd, 28+ km) | present & hunted | absent | present & hunted | present & hunted | present & hunted |
| Pickle Lake (ON 21B) | **absent** (~300 km) | **rare / edge, season open** | absent | present & hunted | present & hunted | present & hunted |
| Lac Bailey (QC 18) | **absent** (extirpated) | **rare / edge** (outside official range by ~54 km; first antlered-only season fall 2026) | absent | present & hunted | present & hunted | present & hunted |
| Highland Lake (YT 4-09) | **absent** (~170–220 km to Braeburn range); the exclusion-area permit makes it *legal* but unlikely | absent | **rare / edge, permit hunt (6 permits, DE 604)** | present & hunted | present & hunted | present & hunted (grouse records sparse) |

- For elk at Sault, the app could say something like "elk wander east of here; no elk season in WMU 36". It should not score elk spots.
- At Highland Lake the gate needs a "legal but no animals" path. Driving the gate from regulations alone would let the exclusion-area permit read as "elk season open".
- Moose, bear and grouse states come from GBIF proximity plus provincial ranges. The season half of "present and hunted" for those was not checked area by area here.

### Gaps
- iNaturalist records near Sault weren't vetted for farmed elk. St. Joseph Island has bison and elk farming history (SooToday).
- The Yukon exclusion-area season dates (Apr 1–Mar 31) come from a search snippet of yukon.ca, which blocked fetching.
- Ontario's moose, bear and grouse seasons in 21B and 36, and Quebec zone 18 moose and bear seasons, weren't re-checked here.
- The Michigan elk herd (northern Lower Peninsula, roughly 140 km south of the Sault across the Straits) wasn't verified this session.

## 4. Machine-readable range data for elk, moose, deer, black bear and grouse

### Takeaway
No national, openly licensed, game-species range layer covers all of Canada. The best route is a stack:
- provincial layers where they exist (Quebec's CC-BY ranges are excellent; Yukon's Wildlife Key Areas, BC's UWR and Ontario's CEZ/LIO are partial);
- NatureServe subnational ranks via the CC BY API as a coarse per-province switch;
- GBIF counts by distance as a check that the animals are actually nearby.

IUCN ranges can't be used commercially without permission. Most GBIF elk and deer records are CC BY-NC (iNaturalist), which matters for a paid app.

### Cited Findings
**National and global**
- **NatureServe Explorer:** data is CC BY, commercial use allowed with attribution. But "commercial use of select biodiversity mapping resources" and precise at-risk locations need separate licences. The open API returns national and subnational ranks per species (results in sections 1 and 3, for example mule deer: AB S5, BC S5, MB S3, SK S4, YT S3S4). — [NatureServe use guidelines](https://natureserve.org/nsexplorer/about-the-data/use-guidelines-citation); [API species search](https://explorer.natureserve.org/api/data/speciesSearch). The Canadian subnational lists aren't complete: no ON entry for elk, no YT entry for white-tailed deer.
- **IUCN Red List** spatial data (polygons, shapefile): "Neither (a) IUCN Red List Data nor (b) any work derived from or based upon IUCN Red List Data … may be put to Commercial Use without the prior written permission of IUCN". This includes "use by any individual or non-profit entity for the purposes of revenue generation". The terms also forbid reposting or redistribution. — [IUCN Red List Terms of Use](https://www.iucnredlist.org/terms/terms-of-use). A third-party portal's "CC-BY-4.0" label for IUCN data contradicts IUCN's own terms. — [ponderful portal](https://dataportal.ponderful.eu/dataset/iucn-red-list)
- **GBIF:** presence-only points through a free REST API (`geoDistance`, `country`, `taxonKey`, licence facets). Licences are per record. Of 6,551 Canadian elk records, 5,384 are CC BY-NC 4.0, 806 CC BY 4.0 and 361 CC0; 6,019 come from iNaturalist research-grade, whose GBIF dataset licence is CC BY-NC 4.0. For white-tailed deer in Canada: 40,356 records, 33,437 CC BY-NC. — [GBIF API licence facet](https://api.gbif.org/v1/occurrence/search?country=CA&taxonKey=4262380&limit=0&facet=license); [iNaturalist dataset](https://api.gbif.org/v1/dataset/50c9509d-22c7-4a22-a47d-8c48425ef4a7). Local absence of records means nothing: GBIF shows 0 moose within 50 km of Lac Bailey, which is inside Quebec's official moose range.
- **ABMI** (Alberta only): the Biodiversity Browser has species profiles and model results for mammals including moose and white-tailed deer (camera-based relative abundance). — [ABMI Biodiversity Browser, mammals](https://abmi.ca/biobrowser/species-group/mammals-intro.html) (search snippet). Licence not confirmed.

**Quebec**
- **Aires de répartition des mammifères terrestres:** 69 species range polygons (orignal, cerf de Virginie, ours noir, caribou, loup, lynx…), EPSG:32198, DATE_MAJ 2021, dataset updated 2026-03-16, **CC-BY 4.0**, in GeoJSON, GPKG, SHP, FGDB and SQLite. Presence/range only, no density. **No wapiti layer.** Grouse aren't in it (birds are excluded). — [Données Québec: aires-de-repartition-faune](https://www.donneesquebec.ca/recherche/dataset/aires-de-repartition-faune); [GPKG download](https://diffusion.mffp.gouv.qc.ca/Diffusion/DonneeGratuite/Faune/Aires_repartition/Mammifere_Terrestre/GPKG/Aires_repartition_MT.gpkg)
- **Habitats fauniques:** legally protected habitats, including deer yards (aires de confinement du cerf de Virginie) and caribou areas. **CC-BY 4.0**; SHP, GeoJSON, GPKG, WFS and WMS (updated 2026-06-22). — [Données Québec: habitats-fauniques](https://www.donneesquebec.ca/recherche/dataset/habitats-fauniques)

**Yukon**
- **Wildlife Key Areas 250k:** 4,564 polygons for 81 key-area types, including **Elk (13, all Braeburn/Takhini), Mule Deer (19), Moose (410)**, Sharp-tailed Grouse, bears and more. Attributes give season (e.g. "winter (Oct-Apr)"), function, population and info type (survey 3,158 / anecdotal 1,102). **OGL-Yukon**; SHP, FGDB and KMZ (files dated 12 May 2025). — [open.yukon.ca, Elk Wildlife Key Area 250k](https://open.yukon.ca/data/elk-wildlife-key-area-250k); [files](https://map-data.service.yukon.ca/GeoYukon/Biological/Wildlife_Key_Areas_250k/)

**British Columbia**
- **Ungulate Winter Range – Approved** (WHSE_WILDLIFE_MANAGEMENT.WCP_UNGULATE_WINTER_RANGE_SP): fields include SPECIES_1, SPECIES_2, APPROVAL_DATE and HECTARES. **OGL-BC**; WMS, KML and custom download; modified 2026-09-01. Legal winter-range polygons, not full range. A "Proposed" UWR set is also OGL-BC. — [BC Data Catalogue: UWR Approved](https://catalogue.data.gov.bc.ca/dataset/ungulate-winter-range-approved)
- Elk layers: "Elk Corridors Merritt TSA" and "Elk Connectivity Corridors Merritt TSA" are OGL-BC. "Elk Winter Range Southern Interior", "Roosevelt Elk Population Units – South Coast" and the elk telemetry database are **Access Only** (not open). — [BC Data Catalogue search: elk](https://catalogue.data.gov.bc.ca/dataset?q=elk)

**Ontario**
- **Cervid Ecological Zones** (OGL-Ontario, LIO GeoHub) are built on Ontario's Ecological Land Classification "with consideration given to cervid species ranges". They're a management zoning, not a range map. — [data.ontario.ca: cervid-ecological-zones](https://data.ontario.ca/dataset/cervid-ecological-zones)
- **Wildlife Values Area / Site** (LIO, OGL-Ontario) holds features such as deer wintering areas and moose aquatic feeding areas. — [data.ontario.ca: wildlife-values-area](https://data.ontario.ca/dataset/wildlife-values-area)
- **Harvest-by-WMU CSVs** (OGL-Ontario) work as "hunted and present" evidence: white-tailed deer by WMU and year (2008–2025), elk by harvest area (2011–2025), moose tag allocation by WMU. — [Deer](https://data.ontario.ca/dataset/white-tailed-deer-hunting-activity-and-harvest); [Elk](https://data.ontario.ca/dataset/elk-harvests); [Moose TAP summary](https://data.ontario.ca/dataset/moose-tag-allocation-process-results-summary)

**Alberta and Saskatchewan**
- Alberta publishes WMU aerial ungulate survey reports per WMU as PDFs (e.g. WMU 102, 116, 118, 124, 302 for 2025) under OGL-Alberta. These are density estimates, but not machine-readable. — [open.alberta.ca search: ungulate survey](https://open.alberta.ca/dataset?q=ungulate+survey)
- Saskatchewan's elk plan has survey estimates and densities per km² by WMZ (Table 1), PDF only. — [SK Elk MP](https://swf.sk.ca/wp-content/uploads/2025/10/Elk-MP.pdf)

### Inferences
- A commercial app's sensible order of preference:
  1. provincial open layers (QC ranges, YT key areas, BC UWR, ON CEZ and harvest CSVs);
  2. NatureServe S-ranks for a per-province default;
  3. GBIF counts within radius as a presence boost, preferring CC0 and CC BY records or using only derived counts (check the CC BY-NC terms first);
  4. a hand-curated `range.json` per jurisdiction for elk, because elk ranges in Canada are few and well documented (prairie provinces, BC, the Ontario restored herds, two Yukon herds).
- For grouse, no provincial range layers were found except Yukon's sharp-tailed grouse key areas. Ruffed and spruce grouse are S4–S5 across all forested jurisdictions (NatureServe), so a per-jurisdiction "present" default plus a habitat model is enough. GBIF finds both within 5–25 km of all four areas (ruffed grouse near Highland Lake only as 1980 records within 25 km).

### Gaps
- No CWS or ECCC national game-species range dataset was found. The Open Canada CKAN API didn't return JSON when queried, so the federal "Wild Species" general-status CSV (per-province ranks) wasn't verified this session.
- The ABMI data licence and the existence of downloadable raster abundance maps for elk weren't confirmed.
- I didn't check whether NatureServe's downloadable range maps for these species exist and what licence they carry; only ranks were pulled.
- No Alberta "key wildlife and biodiversity zones" open dataset was found by catalogue search.

## 5. Machine-readable hunting zones and seasons

### Takeaway
Every jurisdiction checked publishes its hunting-unit polygons openly (ON WMU, BC MU, AB WMU, SK WMZ, MB GHA, YT GMZ/GMS) except **Quebec's hunting zones**, which have no openly licensed layer. **No jurisdiction publishes seasons as structured data.** Seasons live in HTML or PDF regulation summaries; the nearest thing is semi-structured tables: Ontario's HTML WMU tables, Alberta's HTML WMU pages, Yukon's PHA data sheet PDF. BC's LEH zone polygons (OGL-BC) and Ontario's and Quebec's harvest CSVs are the most usable structured proxies for "a season exists here".

### Cited Findings
- **Ontario WMU:** LIO "Wildlife Management Unit", OGL-Ontario; FGDB, SHP and ESRI REST. Boundaries are set by O. Reg. 663/98. The app already uses it (`LIO_Open05/MapServer/5`, field OFFICIAL_NAME). — [open.canada.ca record](https://open.canada.ca/data/en/dataset/852767c1-d6be-424b-b53e-48276e0d0db5); [LIO REST](https://ws.lioservices.lrc.gov.on.ca/arcgis2/rest/services/LIO_OPEN_DATA/LIO_Open05/MapServer/5)
- **Ontario seasons:** data.ontario.ca links to "Ontario white-tailed deer seasons 2025" as a **WEB** resource pointing to the HTML regulations summary, not a CSV. The regulations summary has per-species WMU season tables in HTML (e.g. elk, white-tailed deer). — [data.ontario.ca deer dataset](https://data.ontario.ca/dataset/white-tailed-deer-hunting-activity-and-harvest); [Regs: white-tailed deer](https://www.ontario.ca/document/ontario-hunting-regulations-summary/white-tailed-deer)
- **Quebec:**
  - 28 hunting zones (1–24, 26–29), subdivided per species. — [quebec.ca, Cartes des zones de chasse](https://www.quebec.ca/tourisme-et-loisirs/activites-sportives-et-de-plein-air/chasse-sportive/cartes-zones/) (PDF maps; search snippet)
  - A Données Québec search for "zones de chasse" (47 hits) turned up no hunting-zone boundary dataset.
  - **TFS (zecs, réserves fauniques, pourvoiries)** are CC-BY-**NC-ND** 4.0.
  - Fish & wildlife protection districts are CC-BY 4.0 but aren't hunting zones.
  - The **harvest CSVs by zone and year** (deer, moose, black bear, caribou, turkey since 1971) are **CC-BY 4.0**.

  — [Données Québec CKAN search](https://www.donneesquebec.ca/recherche/dataset?q=zones+de+chasse); [TFS](https://www.donneesquebec.ca/recherche/dataset/territoires-fauniques-structures); [Statistiques de chasse](https://www.donneesquebec.ca/recherche/dataset/statistiques-historiques-de-chasse-et-piegeage-au-quebec)
- **BC:**
  - **Wildlife Management Units** (WAA_WILDLIFE_MGMT_UNITS_SVW; 225 MUs in 9 regions; fields include GAME_MANAGEMENT_ZONE_NAME) and **Game Management Zones** are OGL-BC.
  - **LEH Zones – Current Opportunities Polygon** (WAA_LTD_HNT_ZONE_CURR_YEAR_SVW) is OGL-BC, modified 2026-08-27. Its fields are LIMITED_ENTRY_HUNTING_ZONE, MANAGEMENT_UNITS, EFFECTIVE_DATE, EXPIRY_DATE and LEH_HUNT_AREA_ID. Species, quotas and dates are only in the LEH synopsis.
  - "Hunting Sales Statistics 2005–2025" is OGL-BC CSV. The LEH draw reports and hunter sample harvest surveys are **Access Only**.

  — [BC WMU](https://catalogue.data.gov.bc.ca/dataset/wildlife-management-units); [LEH zones](https://catalogue.data.gov.bc.ca/dataset/limited-entry-hunting-leh-zones-current-opportunities-polygon); [GMZ](https://catalogue.data.gov.bc.ca/dataset/game-management-zones)
- **Alberta:**
  - "Wildlife Management Unit" (ESRI REST, **OGL-Alberta**, modified 2026-09-06), under the Wildlife Act (Alta Reg 143/79).
  - "Special Hunting Licence Draw Boundaries" (SHP, OGL-Alberta) holds the draw-unit polygons.
  - "Elk allocations for the hunting season" is a PDF.
  - Seasons are published as HTML tables per WMU series on albertaregulations.ca.

  — [open.alberta.ca WMU](https://open.alberta.ca/opendata/gda-937714ca-daad-4b7b-be9f-35a4b9cbd3c0); [Draw boundaries](https://open.alberta.ca/opendata/gda-7383f3fd-bc20-4448-8f15-d9969c291a73); [Elk allocations](https://open.alberta.ca/dataset/elk-allocations-hunting-season); [albertaregulations.ca](https://www.albertaregulations.ca/huntingregs/wmu400.html)
- **Saskatchewan:** "Wildlife Management Zones" on gis.saskatchewan.ca (layer 0, also layer 4 WMUs), ESRI REST, with a federal geo.ca mirror (SHP, GeoJSON, GPKG). Boundaries are set by the WMZ and Special Areas Boundaries Regulations, 1990. Seasons and quotas are in the annual draw supplement PDF. — [gis.saskatchewan.ca WildlifeManagement](https://gis.saskatchewan.ca/arcgis/rest/services/WildlifeManagement/MapServer/layers?f=pjson); [geo.ca record](https://app.geo.ca/en-ca/map-browser/record/7c5faae6-63c5-fed2-f5bc-000671bdcab6)
- **Manitoba:** "Game Hunting Areas" (Hunting Areas and Zones Regulation 220/86), Manitoba open data licence, available as CSV, SHP, GeoJSON, GPKG and ESRI REST. A dataset titled "**GHA Hunting Season Table**" turns out to contain only OBJECTID, GHA and shape fields, no dates (updated 2026-04-17). Seasons are in the annual Hunting Guide PDF. — [Game Hunting Areas (open.canada.ca)](https://open.canada.ca/data/en/dataset/f57d2d37-d794-e67f-a602-df0d52063078); [GHA Hunting Season Table](https://donnees.iriu.ca/dataset/9bce5772-c4fc-91b7-730d-888dfe0bd693); [MB metadata](https://mli.gov.mb.ca/adminbnd/meta_files/bdy_big_game_hunting_areas_metadata.html)
- **Yukon:**
  - "Game Management Areas – 250k": 443 GMAs in 11 zones (zone plus subzone), **OGL-Yukon**, SHP and AGOL. The app already uses it, "generalised, not for legal use".
  - Permit hunts are listed in the **PHA data sheet PDF**, which tabulates species, hunt code, subzones, season dates and permit counts (e.g. DE 604, EL23/EL24).

  — [Game Management Areas 250k](https://open.yukon.ca/data/game-management-areas-250k); [2026 PHA data sheet](https://open.yukon.ca/information/663bc543-91b8-4a91-83c3-3436c70d23a0/resource/8c583d0c-2da4-45fc-87d2-1d34d20ea110/download/env-2026-permit-hunt-authorization-data-sheet.pdf)

### Inferences
- The season half of the gate must be hand-curated per jurisdiction per year (species × unit → open / draw / closed). It can be bootstrapped from the HTML tables (Ontario, Alberta), PDFs (BC, SK, MB, QC) and the Yukon PHA sheet. Harvest CSVs (Ontario deer and elk, Quebec five species) can confirm "hunted here recently" automatically: for example, Quebec zone 18 deer shows 0 harvest since 1982 until the 2026 opening.
- Ontario elk is simple to encode: open only in WMUs 57, 58, 60, 61, 62 and 63A (draw), closed everywhere else.
- Yukon elk needs three classes: permit areas (Takhini EL23/24, Braeburn EL14/15), the exclusion area (legal year-round with a Wildlife Act permit), and closed areas (GMZ 10, 11, parks).

### Gaps
- No machine-readable seasons API or CSV was found for any province or territory, nor any national compilation.
- Quebec hunting-zone polygons with an open licence: none found (consistent with the app's existing note on SmartFaune).
- I didn't confirm the licence text of the Saskatchewan WMZ layer or Manitoba's exact licence name ("mb-omb" in the federal mirror).
