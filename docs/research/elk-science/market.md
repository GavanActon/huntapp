# Elk hunting app market and how competitors handle wind, thermals and scent (notes as of 2026-10-05)

Scope: market size for elk (US + Canada) compared with Ontario/Quebec moose; competing apps' wind/thermal/scent features, prices, offline behaviour and reported shortcomings; what hunters say; satellite messaging and weather by text; earlier attempts at terrain-aware wind. Each fact has a source link. "User opinion" marks forum content. "Snippet" marks a figure seen only in a search-result summary, where the page itself couldn't be opened (403/402/JS); treat those as weaker.

Access limits during research: Reddit was blocked to the crawler. Rokslide and Bowsite returned 403, and ArcheryTalk returned 402 (paywall for bots). CPW's 2024/2025 elk harvest PDFs sit behind a JavaScript-only asset viewer. The session's web-search budget ran out near the end, so a few gaps below are access gaps, not "doesn't exist".

---

## Key question 1: How big is the elk hunter market (US and Canada), what share is nonresident, what do hunters spend, and how does it compare with Ontario and Quebec moose?

### Takeaway
About 0.7 to 0.8 million Americans hunt elk in a year (national survey, 2006 and 2016). They're concentrated in Colorado (~220k), Montana (~112k), Oregon (~110k), Idaho (~90–100k), Washington (~68k) and Wyoming (~59k active, 81k licences). Nonresidents are about 18–25% of hunters in Montana and Wyoming but spend roughly 12× as much per trip. In Canada, Alberta alone sold ~53k resident elk licences in 2025, and that number is growing. Ontario and Quebec moose together come to ~209k licences/permits (2025): about the size of Colorado's elk hunt alone, and roughly a quarter to a third of the US elk market.

### Cited Findings

**National (US)**
- 2016 National Survey of Fishing, Hunting and Wildlife-Associated Recreation: about **700,000 elk hunters**, against ~8 million deer, ~2 million turkey and ~200,000 bear hunters. This is a secondary article citing the 2016 survey — [Outdoor Empire](https://outdoorempire.com/most-hunted-game-animals-us/)
- 2006 National Survey, as reported in NSSF's "Today's Hunter" (2008): **794,602 elk hunters** spent an average of **$1,201/year** each, **$954.4 million** in total. Per hunter, elk hunters were the second-highest spenders, $37 behind deer hunters — [HuntingLife](https://huntinglife.com/elk-hunting-adds-nearly-1-billion-a-year-to-economy/)
- 2016 survey: 11.5 million hunters in total, 9.2 million of them big game — [The Wildlife Society](https://wildlife.org/usfws-releases-report-on-national-wildlife-related-recreation/)
- 2022 survey: 14.4 million hunters spent $45.2 billion. "11.5 million hunters pursuing deer and elk over 135 million days" (the summary gives no elk-only figure). The 2022 methodology isn't comparable with earlier surveys — [RMEF, 2023-10-13](https://rmef.org/media/survey-americans-spent-384-billion-on-hunting-other-outdoor-pursuits-in-2022/); [Outdoor Life](https://www.outdoorlife.com/conservation/national-hunting-fishing-survey-results/)
- Caution: one search aggregator labelled "211,000–224,000 elk hunters per year, 2010–2016" as a **US** figure. That matches Colorado's statewide count (223,745 in 2016, below), so it's a misattribution and shouldn't be used as a national number.

**Top states (most recent figure I could reach; years differ)**

| State | Elk hunters | Year | Harvest | Success | Nonresident share / rules | Source |
|---|---|---|---|---|---|---|
| Colorado | 223,745 | 2016 | 39,306 | 18% | NR allocation cut from 35% to **25%** of most hunt codes (20% for high-demand codes) from 2024. Unlimited NR OTC archery elk ended; ~**13,000** NR OTC archery licences sold in 2024, the lowest since 2012 (−10% vs 2023) | [goHUNT (2017)](https://www.gohunt.com/browse/tips-and-tricks/insider/breakdown-of-elk-populations-and-statistics-by-state); [Colorado Outdoors 2024](https://coloradooutdoorsmag.com/2024/02/29/2024-colorado-big-game-hunting-what-is-new/) |
| Montana | **111,969** (91,903 R + 20,066 NR) | 2024 | 28,188 (NR 6,342) | — | NR = **17.9%** of hunters, 22.5% of harvest. NR hunter-days 153,834 vs resident 946,480. NR hunters up from 16,357 in 2014 | [KTVH (FWP data)](https://www.ktvh.com/news/montana-news/looking-at-non-resident-hunter-numbers) |
| Idaho | not stated for 2024 (101,912 in 2016) | 2024 | 20,996 | 24% (general 19%, controlled 42%) | NR general elk tag quota 12,815, sold out by 2024-09-26 | [IDFG 2025-04-10](https://idfg.idaho.gov/article/hunter-harvest-report-idaho-deer-and-elk-hunters-go-3-3-2024); [goHUNT (2017)](https://www.gohunt.com/browse/tips-and-tricks/insider/breakdown-of-elk-populations-and-statistics-by-state); [IDFG returned tag sale](https://idfg.idaho.gov/licenses/tag/returns/sept-26-2024-event) (snippet) |
| Wyoming | **81,445 licences; 58,524 active hunters** (43,663 R / 14,861 NR) | 2024 | 30,744 | 52.5% | NR = **20.6%** of licences (16,779) and **25.4%** of active hunters. 585,346 recreation days. Licences rose from 72,238 (2015) to 81,445 (2024) | [WGFD 2024 Elk Harvest Report, 2025-02-27](https://wgfd.wyo.gov/media/32051/download) |
| Oregon | 110,489 | 2016 | 17,446 | 15% | NR capped at 5% of unit permits | [goHUNT (2017)](https://www.gohunt.com/browse/tips-and-tricks/insider/breakdown-of-elk-populations-and-statistics-by-state) |
| Washington | 68,012 | 2015 | 7,829 | 12% | NR draw at same odds as residents | same |
| New Mexico | 28,820 | 2015 | 14,555 | 51% | NR 6% (10% with outfitter) | same |
| Arizona | 15,946 | 2015 | 11,633 | 41% (as published) | NR up to 5% of permits | same |
| Utah | not found | — | — | — | NR 10% of limited-entry tags | same |

- Wyoming's 2023 season: ~29,000 elk, 53.5% success (residents 52.9%, nonresidents 55.6%), 77,647 tags sold. Idaho 2023: 18,568 elk, 21% success — [Outdoor Life, 2024-03-26](https://www.outdoorlife.com/hunting/wyoming-vs-idaho-elk-harvest-stats/)
- Colorado, Idaho, Oregon, Utah and Washington sell general over-the-counter elk licences. California, Nevada and New Mexico have no OTC elk — [Backcountry Chronicles](https://www.backcountrychronicles.com/western-states-over-the-counter-elk-tags-non-residents/) (snippet)

**Canada**
- Alberta resident elk licences: 45,662 (2021), 45,893 (2022), 49,301 (2023), 50,941 (2024), **52,950 (2025)**. Over the same years, Alberta resident moose licences fell from 20,704 to **16,104**. The page doesn't list nonresident elk licences — [My Wild Alberta, annual sales statistics](https://mywildalberta.ca/buy-licences/annual-sales-statistics.aspx)
- Ontario elk, 2025: **9 tag holders**, 4 elk reported harvested (3 bulls, 1 cow) — [Ontario 2025 Mandatory Elk Hunter Report Summary](https://www.ontario.ca/files/2026-03/mnr-2025-elk-hunter-report-summary-en.pdf)
- Saskatchewan: unlimited antlerless elk licences in WMZ 1–55 (Nov 20–27, $30). No total count found — [CBC](https://www.cbc.ca/1.7651702) (snippet)
- Manitoba: draw-based (landowner draw, then general draw). Licences were cut in 4 of 62 game hunting areas. No count found — [CBC](https://amp.cbc.ca/news/canada/manitoba/results-of-moose-elk-draws-friday-1.7261302) (snippet)
- BC: huntable elk in every region except Kamloops; Peace and Kootenay lead the harvest. No hunter count found — [Outdoor Canada 2022 forecast](https://www.outdoorcanada.ca/2022biggameforecast/2/) (snippet)

**Moose comparison (Groundwind's current market)**
- Ontario 2025: **39,830 moose licence holders**, of whom 34,999 (88%) hunted. 228,804 hunter-days, 6.5 days per hunter, harvest 2,857 (1,678 bulls) — [Ontario 2025 Mandatory Moose Hunter Report Summary](https://www.ontario.ca/files/2026-03/mnr-2025-moose-hunter-report-summary-en.pdf). The 2024 figures were 42,209 holders, 37,166 hunting and 246,442 days — [Ontario 2024 summary](https://www.ontario.ca/files/2025-03/mnr-2024-moose-hunter-report-summary-en-2025-03-13.pdf) (snippet)
- Quebec 2025: **168,919 moose permits**, harvest 24,858, success 14.7% per permit — [Québec.ca, 2026-02-17](https://www.quebec.ca/nouvelles/actualites/details/statistiques-de-chasse-2025-une-annee-a-succes-pour-la-chasse-a-lorignal-68586). Quebec 2024: 167,618 permits ("the lowest since 2008" for similar methods), harvest 20,431, 12.2% success — [Québec.ca 2024 statistics](https://www.quebec.ca/nouvelles/actualites/details/statistiques-de-chasse-2024-une-excellente-annee-pour-la-recolte-dorignaux-de-dindons-sauvages-et-dours-noirs-60708) (snippet)

**Spending**
- Montana elk hunter profile (survey data 1988–1998, published March 2001). Resident hunters travelled 104 miles and spent **$142 per trip**, hunted 11 days a year and earned $35–40k. Nonresidents travelled 1,224 miles and spent **$1,659 per trip**, hunted 7 days a year and earned $50–75k. Willingness to pay beyond actual spend: $311 (resident) vs $931 (nonresident) per trip — [Montana FWP Research Summary No. 6](https://fwp.mt.gov/binaries/content/assets/fwp/conservation/elk/research/human-dimension-surveys/2001-profile-elk-hunter.pdf)
- New Mexico 2023: nonresident guided elk hunters generated $125.9M in direct spending and supported 5,395 jobs — [NM Legislature handout](https://www.nmlegis.gov/(X(1)S(1sqs2glx2451axjo2pnao12i))/handouts/WNR%20092826%20Item%2015%20NMCOG%20EPLUS%20Economic%20Impact%20Study%20summary.pdf) (snippet)
- Wyoming big game hunters contribute more than $303.5M and support 3,100 jobs (Southwick Associates; year not confirmed) — [Powell Tribune](https://powelltribune.com/stories/big-game-hunting-in-wyoming-a-300-million-industry,1359) (snippet)

### Inferences
- Adding the latest available counts for the eight states with a figure gives ≈ 720k (mixed years, 2015–2024, Utah missing). That's consistent with the national 0.7–0.8M, but people who hunt more than one state are counted more than once, so unique hunters are fewer.
- The US elk hunt (~700k) is about 3.4× the Ontario + Quebec moose pool (~209k). Colorado alone is about the size of both provinces' moose hunts together.
- Nonresidents are a minority (18–25% where measured) but spend about 12× as much per trip, have higher incomes and hunt fewer, more expensive days on ground they don't know. A model that substitutes for local knowledge of how the air moves pays off most for this group, and it is the group most likely to pay for an "HD per area" purchase.
- In Canada, elk is a bigger and growing market than Ontario moose. Alberta's 53k resident elk licences outnumber Ontario's 40k moose licence holders, and Alberta elk rose 16% from 2021 to 2025 while Alberta moose fell 22%. Ontario elk (9 tags) is negligible.
- Wyoming's licences and nonresident share are both rising (NR licences up 28% from 2015 to 2024). Colorado is moving the other way, cutting nonresident allocation and OTC archery from 2024. Western nonresident access is being squeezed state by state.

### Gaps
- Colorado's 2023–2025 statewide totals (hunters, NR split) exist in CPW harvest reports but are behind a JavaScript-only asset viewer. The 2016 figure is the latest I could cite.
- Recent (2022–2025) statewide hunter counts for Oregon, Washington, Utah, New Mexico and Arizona weren't found. The table uses goHUNT's 2015/2016 compilation.
- No elk-only figure from the 2022 National Survey was found.
- No hunter counts were found for BC, Saskatchewan or Manitoba elk, and no Alberta nonresident elk figure.
- No unique-hunter (deduplicated across states) estimate was found.
- No Southwick/RMEF study more recent than 2006 on per-hunter elk spending was found.

---

## Key question 2: What do competing apps actually do for wind, thermals and scent, how do they work offline, what do they cost, and how big are they?

### Takeaway
Every major multi-species app (onX Hunt, HuntWise, HuntStand, BaseMap, Gaia GPS) shows **forecast or station wind**, and some draw a **straight scent cone** from it. None publicly claims to solve wind over terrain or to model thermals; the most onX claims is a terrain-adjusted *point* forecast. goHUNT, the elk-research leader, has no wind tool found at all. The only app claiming a terrain-solved wind field with a scent plume and thermal regimes is **Contors** (launched Aug–Sep 2026), and it is **whitetail-only**. **ProHunt** claims "thermal zone predictions" but doesn't say how.

### Cited Findings

**onX Hunt** (onXmaps, Missoula; the market leader)
- Wind & Weather: tap any spot for "hyper-local forecasts that account for terrain features like elevation, slope aspect, and water effect". "Show Current Wind". "Set Optimal Wind" per location, with green/yellow/red indicators. A 7-day Wind Calendar (sunrise, midday, sunset) to compare locations. Radar, temperature gradient, and Deer Movement Forecast (Elite only). The page doesn't mention scent cones or thermals — [onX capabilities: Wind & Weather](https://www.onxmaps.com/hunt/learn/capabilities/weather)
- The data is station-based. A December 2019 update added Weather Underground personal stations ("nearly 10 times the number of weather stations"), shown as grey circles on the map; users can switch station — [onX blog, 2019-12-04](https://www.onxmaps.com/hunt/blog/wind-weather-has-arrived)
- onX teaches thermals in its content ("thermal hubs", "how prevailing winds, topography, microclimates, and dense vegetation affect thermal wind") but has no thermal tool — [onX Wind & Weather topic](https://www.onxmaps.com/hunt/blog/topic/wind-and-weather)
- Prices (web, 2026): Premium single state $34.99/yr, Premium two-state $49.99/yr, Elite $99.99/yr or $14.99/mo (all states plus Canada, Deer Movement Forecasts, TerrainX). Offline maps and Wind & Weather are in every paid tier; 7-day trial — [onX pricing](https://www.onxmaps.com/hunt/app/pricing). The App Store lists Premium from **$29.99/yr**, which conflicts with the web price, plus onX SOS at $49.99/yr — [App Store](https://apps.apple.com/app/id672902340)
- Scale: 4.9★ from **274,000 ratings**, "Trusted by 5,000 game wardens" — [App Store](https://apps.apple.com/app/id672902340). Says "millions of hunters"; raised venture funding from TCV and Cross Creek in Nov 2025 (amount undisclosed) — [Preqin/TechCrunch via search](https://www.preqin.com/data/profile/asset/onxmaps--inc-/264565) (snippet). onX Hunt works over T-Mobile T-Satellite (Starlink) data since Oct 2025 — [T-Mobile](https://www.t-mobile.com/news/network/t-satellite-data-ready-app-expansion)

**HuntWise**
- WindCast shows real-time and forecast wind direction and speed over the map, updated hourly, with "dynamic wind cone displays" and "ideal wind directions for every stand". Its examples are whitetail and waterfowl — [HuntWise WindCast](https://huntwise.com/features/windcast)
- HuntWise's own thermals article (2025-07-02) *teaches* thermals and suggests WindCast plus topo layers "to help you prepare for where thermals may become more of a factor". It doesn't claim the app models thermals or adjusts for terrain — [HuntWise field guide](https://huntwise.com/field-guide/deer/hunting-thermals-how-to-understand-them)
- HuntCast gives animal-specific hunt predictions: 7-day on Pro, 15-day on Elite. Pro costs $59.99/yr, Elite $119.99/yr — [HuntWise Pro page](https://get.huntwise.com/pro) (snippet)

**HuntStand**
- HuntZone: patent-pending, shows the "projected scent cone" at stand or blind locations, hour by hour up to **72 hours** ahead — [HuntStand guide](https://www.huntstand.com/fieldnotes/deer/a-detailed-guide-to-huntstand-app-tools-for-deer-hunters/) (snippet)
- The App Store listing says HuntZone is in the **free tier** and every paid one: Pro $29.99/yr, Ultimate $99.99/yr. It's rated 4.6★ from 59,000+ ratings and claims over 9 million downloads. One reviewer: the wind tool "is crucial and I find HuntStand is pretty much right on" (user opinion) — [App Store](https://apps.apple.com/us/app/huntstand-gps-maps-tools/id778772892)
- The Pro Whitetail tier (launched 2022) costs $69.99 — [HuntingLife](https://huntinglife.com/huntstand-announces-powerful-new-app-tier-focused-on-whitetail-deer) (snippet)

**goHUNT** (the western/elk research and draw-odds leader)
- Insider costs $149.99 (annual) or $169.99, Insider+ $499.99. Map layers cover land ownership, species distribution, roads and trails, elevation bands, water, wildfire and road density. **No wind layer found** — [goHUNT shop](https://shop.gohunt.com/products/insider-subscription); [App Store](https://apps.apple.com/us/app/1500630352) (snippet)
- Forums argue over whether Insider is worth the price ("GoHunt Insider worth it?") — [Rokslide](https://rokslide.com/forums/threads/gohunt-insider-worth-it.296645); [HuntTalk](https://www.hunttalk.com/threads/is-the-go-hunt-insider-worth-the-price.270232/post-2531625) (titles only; not read)

**BaseMap**
- A "wind cone" shows wind direction against your stands and scent drift. PRO $39.99/yr (800+ layers, unlimited offline). PRO ADVANTAGE $69.99 (adds Global Rescue). PRO ULTIMATE $99.99 (adds hunt planner, draw odds, harvest data) — [App Store](https://apps.apple.com/us/app/basemap-3d-hunting-gps-maps/id1305237481); [Deer & Deer Hunting](https://www.deeranddeerhunting.com/content/articles/what-you-can-do-with-basemap) (snippet)

**Spartan Forge**
- AI whitetail movement prediction "using GPS collar data and neural network technology". LiDAR, UAV imagery, team pin sharing. **Whitetail only**. No scent or thermal tool found — [spartanforge.ai](https://spartanforge.ai)
- The App Store description mentions "historical wind and weather patterns nationwide". Released 2021-10-01; ranked #21 top-grossing in Navigation on 2026-03-12 — [App Pricing Lab](https://apppricinglab.com/app/apple/1562873100)

**Gaia GPS**
- Premium shows weather overlays (temperature, precipitation, wind speed, radar) and 250+ maps and overlays including hunting land ownership. Premium $59.90; with Outside+ $89.90. No scent or thermal tool — [App Store](https://apps.apple.com/US/app/id1201979492) (snippet)

**Contors** (closest conceptual rival; whitetail-only)
- Contors LLC, founded by Orry Moody, Madison, Alabama. iOS August 2026, Android September 2026, web 2026-09-24 — [EIN Presswire](https://www.einpresswire.com/article/944773435/contors-hunting-map-app-launches-on-ios-android-and-web-with-4-industry-firsts)
- It claims "terrain-aware wind and scent modeling" as an industry first: it "solves the wind field across the shape of the ground, draws it on the map, and renders the hunter's scent as a plume moving through it — spilling into draws, wrapping points, pooling where the air goes slack". At dawn and dusk "it identifies the air as wind-driven, thermal or mixed and follows whichever governs". The solver type and resolution aren't disclosed. Other "firsts": an AI assistant (Scout), a Buck Refuge Model heat map, and landscape dashboards with a red night theme — same source
- The website gives a scent cone off every stand, and thermal arrows "downhill at dawn, uphill at dusk — on your actual terrain". "Built for Whitetail, and nothing else". Free (1 property), Pro $39.99/yr, Unlimited $79.99/yr. Offline areas are limited on Free/Pro and unlimited on Unlimited — [contors.com](https://contors.com)
- Note: a search summary described Contors as covering "elk and deer". Contors' own site and press release say whitetail only.

**ProHunt** (prohunt.app)
- "Real-time scent cone visualization on map", "Thermal zone predictions (morning/evening drafts)", wind arrows, LiDAR/slope layers. Global, with regulations for 22 countries. Offline downloads on Pro. $79.99/yr or $12.99/mo. It doesn't say whether thermals are terrain-modelled or rule-based, and gives no company or launch date — [prohunt.app](https://prohunt.app/)

**ScoutLook / Mossy Oak Hunting Weather**
- ScentCone® Wind Map: "where your scent will blow hour by hour, for 7 days". Saves the ideal wind per stand and shows colour-coded indicators. Free. Long-standing; a North American Hunting Club partnership dates to 2011 — [Mossy Oak](https://www.mossyoak.com/our-obsession/blogs/gear-spotlight/mossy-oak-hunting-weather-app-from-scoutlook); [AmmoLand 2011](https://www.ammoland.com/2011/07/north-american-hunting-club-partners-with-scoutlook-weather/) (snippet)

**Elk Finder** (elkfinder.com, 2026; elk-specific but no wind)
- Jon Olson (McCall, Idaho) ranks the top 5 zones per GMU across 11 western states from feed (satellite vegetation moisture), bedding cover (LANDFIRE), slope and road pressure. **No wind, thermal or scent tools**. $79/yr, web only, offline "planned" — [elkfinder.com](https://elkfinder.com/)

**General weather apps used by western hunters**
- Windy is the favourite in a HuntTalk "Wind apps" thread (Aug 2024): "I use it for wind, radar, satellite, and just about everything now!" Windy can plan a route and give the wind "at that time of the day and along the route". The free version is considered enough (user opinion) — [HuntTalk](https://www.hunttalk.com/threads/wind-apps.325836/)

### Inferences
- The product grid splits in two. (a) Elk/western research tools (goHUNT, Elk Finder, onX's land data) have no wind modelling. (b) Wind and scent tools (HuntZone, WindCast, ScentCone, BaseMap cone) are whitetail-oriented forecast cones that assume the forecast wind blows straight across the map. A terrain-aware wind and thermal model aimed at elk sits in the gap between them.
- Price anchors: $30–35/yr (onX Premium, HuntStand Pro), $40/yr (BaseMap, Contors Pro), $60/yr (HuntWise Pro, Gaia), $80/yr (Contors Unlimited, ProHunt, Elk Finder), $100–120/yr (onX Elite, HuntStand Ultimate, HuntWise Elite), $150–500/yr (goHUNT Insider). Elk hunters already pay for several of these at once. A per-area HD purchase sits outside the usual annual-subscription pattern.
- Contors is the real threat. It already markets the exact claim (terrain-solved wind, scent plume, thermal regime) to whitetail hunters. Moving into elk would mainly mean bigger terrain areas and western DEMs. Neither the company nor the solver has a public validation record.
- onX's "terrain-adjusted" point forecast is built on personal weather stations. Hunters in the forums call those stations unreliable for wind (see question 3), which leaves room for a model-based field.

### Gaps
- No public technical description, validation or independent review of the Contors or ProHunt wind/thermal models was found.
- Spartan Forge's current prices weren't found (App Pricing Lab lists no in-app purchases).
- User counts for HuntWise, BaseMap, goHUNT and Gaia weren't found. onX gives only a rating count and "millions".
- HuntStand's App Store page showed a last update of 2025-09-22, which may be stale. I didn't check whether HuntZone gained terrain logic in 2026.
- I couldn't check whether goHUNT added a wind layer in 2026; search budget ran out.

---

## Key question 3: What do elk hunters say about wind and thermal tools: accuracy, swirling winds, what they wish existed?

### Takeaway
Western hunters treat thermals as learnable but treat swirl and the switchover hours as the real problem. They manage it with powder bottles and experience, not apps. Forum threads are titled around apps being wrong ("OnX Wind Direction Wrong") and are sceptical of station data. The expert framing (forecast wind vs "air currents" after terrain) describes exactly the layer the apps leave out. I found no thread asking for a terrain wind model by name. The unmet need shows up as complaints and workarounds.

### Cited Findings
- Elk101, "How do you check thermals?" (July 2015): hunters use powder or cornstarch bottles, thread on the bow, milkweed seeds and smoke, and check constantly ("through a bottle in 3 days"). "That's the worst feeling when the wind swirls and hits you from behind." "wind..now that is a crap-shoot". Thermals are "kinda predictable day after day". No apps mentioned (user opinion) — [Elk101](https://forums.elk101.com/threads/how-do-you-check-thermals.5881/)
- HuntTalk, "Thermals" (Aug–Oct 2020): "Sun goes up. Shade goes down. Stream bottoms almost always have a down thermal" (Gerald Martin). On one ridge the thermal "changes 90 degrees right at first light…and 180 degrees by the time the sun hits it" (Chase McGill). Transitions are "swirly and trade wind effect sometimes" (WyoDoug). Checked with powder; no apps named (user opinion) — [HuntTalk](https://www.hunttalk.com/threads/thermals.300560/)
- Elk101, "Contra Thermals in Colorado High Country" (June 2013): at 11,000–12,000 ft "the elk generally bed low and feed high — moving exactly the opposite of the change in thermals". Advice: approach from the same elevation, or perpendicular to the elk's route (user opinion) — [Elk101](https://forums.elk101.com/threads/contra-thermals-in-colorado-high-country.1244/)
- HuntTalk, "What is your favorite mobile weather application?" (Feb 2024): users cross-reference several sources in the mountains. "Some of those [weather stations] are really terrible for accurate wind readings" (brocksw). NOAA's graphical point forecast is valued for wind and gusts "at any point on a map" (WanderWoman) (user opinion) — [HuntTalk](https://www.hunttalk.com/threads/what-is-your-favorite-mobile-weather-application.323653/)
- Threads about onX wind being wrong exist: "OnX Wind Direction Wrong" (Bowsite) and "OnX Wind", "Best app for wind direction", "Apps that show wind" (ArcheryTalk). The pages were blocked. The search summary said users reported onX wind readings stuck showing days-old data, and that "depending on the area and terrain, most wind apps are relatively useless" because hillsides and tree lines create shear (user opinion, snippet) — [Bowsite](https://forums.bowsite.com/tf/bgforums/thread.cfm?threadid=503693&forum=2); [ArcheryTalk](https://www.archerytalk.com/threads/onx-wind.6277919/)
- Rokslide threads "Understanding Mountain Thermals", "Hunting Bad Wind" and "What are some apps you use besides onX" were blocked. The search summary: "wind/air movement in the mountains is probably one of the biggest differences between western and eastern hunting… it's so tough to predict out west", and "if wind and thermals are just plain bad" some won't hunt a spot (user opinion, snippet) — [Rokslide: Understanding Mountain Thermals](https://rokslide.com/forums/threads/understanding-mountain-thermals.121825/); [Rokslide: Hunting Bad Wind](https://rokslide.com/forums/threads/hunting-bad-wind.331356/)
- Expert view, MeatEater "Wired to Hunt" ep. 243 (Ryan Furrer): weather apps show wind direction, but "air currents" are "what happens after" the wind hits ridges and other features, creating eddies like water around rocks. North slopes stay coldest and shift thermal timing. On low-pressure "heavy air" days scent pools around the hunter; on high-pressure days thermals "stove pipe" it upward. Furrer maps wind at his stands with smoke from fires — [MeatEater](https://www.themeateater.com/listen/wired-to-hunt/ep-243-wind-thermals-w-ryan-furrer)
- Positive view: a HuntStand reviewer says HuntZone "is pretty much right on" (whitetail context, user opinion) — [App Store](https://apps.apple.com/us/app/huntstand-gps-maps-tools/id778772892)

### Inferences
- The complaint is consistent: the forecast wind is "right" aloft but wrong at head height in broken terrain, and wrong in time around the thermal switch. Groundwind's head-height model, thermal timing and wind checks target exactly that.
- Elk hunters trust their powder bottle over any app. A product that **takes in** powder-bottle checks and corrects the model (Groundwind's wind checks) fits how they already work, instead of asking them to trust a black box. That difference matters against Contors and ProHunt, which present answers with no feedback loop.
- The "contra thermal" problem (elk move against the thermal) suggests elk features should combine thermal timing with bed and feed elevation, not only draw the scent plume.

### Gaps
- Reddit (r/elkhunting, r/Hunting) couldn't be reached. Rokslide and ArcheryTalk thread bodies couldn't be read (403/402).
- No forum posts reviewing Contors or ProHunt were found; they're too new or too small.
- No podcast or episode specifically about wind apps for elk was found.

---

## Key question 4: How common are satellite messengers among backcountry elk hunters, and is weather by text already served?

### Takeaway
Weather by satellite text is already **commoditised as a generic point forecast**: inReach and ZOLEO have built-in forecasts, plus free and paid email-to-text services. Phones now have native satellite texting (iPhone 14+ in the US/Canada) and, on T-Mobile, satellite data for onX Hunt itself. No existing service delivers a terrain or head-height wind update. I found no survey of how many elk hunters carry a messenger, only strong anecdotal norms (outfitters requiring them).

### Cited Findings
- Garmin inReach: a basic forecast (3 days, 6-hour steps, temperature, precipitation, wind speed and direction, pressure) "counts as one text message". A premium 7-day forecast costs **$1 per request**; marine $1 — [Garmin manual](https://www8.garmin.com/manuals/webhelp/gpsmap86/EN-US/GUID-771A9318-FDF4-48D0-ABB8-09221D49CAD1.html) (snippet)
- ZOLEO: a forecast for the current or any other location costs one message per request, from Xweather (AerisWeather) at "100 meters of spatial resolution" — [ZOLEO support](https://support.zoleo.com/hc/en-us/articles/42175093092884-How-To-Request-a-Weather-Forecast); [ZOLEO–AerisWeather press release](https://www.zoleo.com/en-au/newsroom/zoleo-partners-with-aerisweather) (snippet; pages returned 403)
- Third-party text weather: sending "wx now" to wx2inreach@gmail.com is free apart from message fees. OCENS SpotCast charges $6/$7/$8 a month for 24/48/72-hour forecasts by coordinates, with land forecasts from Meteoblue adjusted for location and elevation — [BackpackingLight](https://backpackinglight.com/forums/topic/92891/); [OCENS SpotCast setup](https://www.ocens.com/documents/SpotCast_Setup.pdf) (snippet)
- Apple Messages via satellite: iPhone 14 or later, iOS 18+ in the US, Canada and Japan (Mexico 18.4+). Sends **SMS and iMessage**, free for two years after activation, through the built-in Messages app only — [Apple Support](https://support.apple.com/en-us/120930)
- T-Mobile T-Satellite (650+ Starlink direct-to-cell satellites) gave data to apps from 2025-10-01, including AccuWeather, AllTrails, CalTopo, **onX Hunt**, onX Backcountry and onX Offroad — [T-Mobile newsroom](https://www.t-mobile.com/news/network/t-satellite-data-ready-app-expansion); [Business Wire](https://www.businesswire.com/news/home/20251001482979/en)
- Anecdotal hunter norms: "Several of our outfitters require one, and our consultants recommend it for every backcountry trip" — [Outdoors International](https://outdoors-international.com/garmin-inreach-mini/) (snippet). An inReach Mini was used to call a rescue on a Colorado elk hunt in the Eagles Nest Wilderness — [HuntingLife](https://huntinglife.com/having-connection/) (snippet). goHUNT's pack-tech list — [goHUNT](https://www.gohunt.com/browse/gear-lists-and-reviews/the-technology-i-carry-in-my-pack)
- The only ownership survey found is of backpackers, not hunters (older survey): **17.9%** carried a SPOT, inReach or PLB, and 93% carried a phone even without coverage — [SectionHiker](https://sectionhiker.com/backpacker-delorme-inreach-spot-plbs-cell-phone-survey/)

### Inferences
- A forecast over satellite is no longer a differentiator on its own. inReach and ZOLEO include it, and T-Satellite lets onX and AccuWeather fetch data directly. Groundwind's text weather is only distinct if it **feeds the on-phone terrain and head-height model** (the HD wind for the coming days at your ground), not if it's sold as "a forecast by text".
- Apple's satellite SMS reaches ordinary phone numbers through Messages, so a GW1-style SMS request bot might be usable from an iPhone 14+ with no inReach. This is untested: whether satellite SMS to a non-contact or bot number works should be checked. If it does, the addressable base is far larger than inReach owners.
- T-Satellite data support for onX means onX could later refresh its own wind data in the backcountry, which erodes the "offline + satellite" edge in the US for T-Mobile customers.

### Gaps
- No survey of satellite-messenger ownership among elk or western hunters was found.
- I couldn't confirm whether Apple satellite SMS works with automated or short-code numbers, or what message-length limits apply.
- Exact ZOLEO forecast contents and pricing per request weren't confirmed (403).

---

## Key question 5: Have there been earlier attempts at terrain-aware wind for hunters, and how did they fare?

### Takeaway
For more than a decade, hunting "wind" products have been forecast cones: ScoutLook ScentCone (~2011 onwards), then HuntStand HuntZone, HuntWise WindCast and BaseMap. onX added a terrain-adjusted *point* forecast. The first public claim of a terrain-solved wind field for hunters I found is **Contors (Aug–Sep 2026, whitetail)**. ProHunt's thermal zones and a hobby GitHub project are rule-based or undisclosed. WindNinja, the USFS terrain wind model Groundwind bakes from, has no hunting product built on it that I could find. None of these has published field validation.

### Cited Findings
- ScoutLook ScentCone: hour-by-hour scent direction for 7 days and ideal-wind flags per stand. A forecast cone, no terrain — [Mossy Oak](https://www.mossyoak.com/our-obsession/blogs/gear-spotlight/mossy-oak-hunting-weather-app-from-scoutlook)
- HuntStand HuntZone: patent-pending forecast scent cone, 72 h — [HuntStand](https://www.huntstand.com/fieldnotes/deer/a-detailed-guide-to-huntstand-app-tools-for-deer-hunters/)
- onX: a point forecast adjusted for "elevation, slope aspect, and water effect", built on stations — [onX](https://www.onxmaps.com/hunt/learn/capabilities/weather)
- Contors: "solves the wind field across the shape of the ground", scent plume, thermal/mixed regime. Launched Aug–Sep 2026; whitetail only; method undisclosed — [EIN Presswire](https://www.einpresswire.com/article/944773435/contors-hunting-map-app-launches-on-ios-android-and-web-with-4-industry-firsts); [contors.com](https://contors.com)
- ProHunt: "Thermal zone predictions (morning/evening drafts)", method undisclosed — [prohunt.app](https://prohunt.app/)
- "Wind Scout" (GitHub, React Native, 12 commits, 0 stars): thermals come from a stand the user labels "above / level / below" the game, plus rules for rising, sinking and transitioning air. No terrain model — [GitHub](https://github.com/carsonschroeder21-del/wind-app)
- WindNinja (USFS Missoula Fire Sciences Lab) simulates mechanical terrain effects on wind, includes parameterisations for local thermal effects, and is used operationally for wildland fire. No hunting product built on it was found — [Joint Fire Science Program](https://digitalcommons.unl.edu/jfspresearch/49); [Frames](https://www.frames.gov/event/424452) (snippets)
- "Thermal Scout" is described in search results as predicting morning updrafts and evening downdrafts from weather data and elevation. Its page didn't load, so I couldn't confirm it's a real product — [HuntFishSport](https://huntfishsport.com/guide/thermal-scout)

### Inferences
- Groundwind's moat isn't "terrain wind" in the abstract, because Contors now claims that. It's the combination: WindNinja momentum-solver bakes (a published, fire-validated model) + canopy and slope flows at head height + **user wind checks that tune the model** + elk/moose-scale backcountry areas offline + satellite updates. No competitor shows a feedback or validation loop.
- Since no earlier attempt has a public accuracy record, publishing a simple validation (model vs powder-bottle checks at named spots) would be a credible differentiator with sceptical western hunters.

### Gaps
- No reviews, retention data or failure post-mortems exist for any terrain-wind hunting product. Contors is too new and nothing older was found.
- The Thermal Scout product couldn't be verified.

---

## Key question 6 (the objective): Is terrain-aware wind a real gap for elk hunters?

### Takeaway
Yes, today. No elk- or western-focused app models how terrain and thermals bend the wind. The big platforms (onX: 274k App Store ratings; HuntStand: 9M+ downloads claimed) offer station or forecast wind and straight cones. Hunters describe swirl, 90–180° thermal flips and station-wind errors, and solve them with powder bottles. The window is probably short: Contors shipped the same pitch for whitetail in Aug–Sep 2026, and onX now has satellite data and the distribution.

### Cited Findings
- Elk tools have no wind model: goHUNT (no wind layer found) — [goHUNT shop](https://shop.gohunt.com/products/insider-subscription); Elk Finder ("no wind, thermals, scent") — [elkfinder.com](https://elkfinder.com/)
- The wind tools are forecast or station cones: [onX](https://www.onxmaps.com/hunt/learn/capabilities/weather), [HuntWise](https://huntwise.com/features/windcast), [HuntStand](https://apps.apple.com/us/app/huntstand-gps-maps-tools/id778772892), [BaseMap](https://apps.apple.com/us/app/basemap-3d-hunting-gps-maps/id1305237481), [ScoutLook](https://www.mossyoak.com/our-obsession/blogs/gear-spotlight/mossy-oak-hunting-weather-app-from-scoutlook)
- The only terrain-solved claim is whitetail-only: [contors.com](https://contors.com)
- Hunters' own accounts of thermal flips and swirl: [HuntTalk Thermals](https://www.hunttalk.com/threads/thermals.300560/), [Elk101](https://forums.elk101.com/threads/how-do-you-check-thermals.5881/)
- Market: ~700k US elk hunters vs ~209k Ontario+Quebec moose licences — [Outdoor Empire](https://outdoorempire.com/most-hunted-game-animals-us/), [Ontario](https://www.ontario.ca/files/2026-03/mnr-2025-moose-hunter-report-summary-en.pdf), [Québec](https://www.quebec.ca/nouvelles/actualites/details/statistiques-de-chasse-2025-une-annee-a-succes-pour-la-chasse-a-lorignal-68586)

### Inferences
- The fit is strongest for **nonresident and DIY public-land elk hunters**: high spend per trip, ground they don't know, a satellite messenger often carried, and a hunt planned around bugles (Groundwind's "route to a heard animal with a downwind swing" maps directly onto calling and chasing bugling bulls).
- Expansion would need western DEM and LiDAR coverage (3DEP), bigger "areas" (elk hunts cover more ground than a moose camp's 3 km core), and US hunt-unit/GMU context. Those are buildable; the costlier risk is credibility, and a visible validation story addresses that.
- Watch Contors: if it adds elk or western terrain it becomes a direct competitor with an AI-assistant and stand-ranking story. If onX adds a terrain wind layer, its distribution would dominate. Speed to the western market and proof of accuracy are the levers.

### Gaps
- No direct evidence of willingness to pay for a terrain wind feature among elk hunters (no surveys or pricing tests found).
- No data on how many elk hunters already use onX's or HuntStand's wind features, or how satisfied they are beyond forum anecdotes.
