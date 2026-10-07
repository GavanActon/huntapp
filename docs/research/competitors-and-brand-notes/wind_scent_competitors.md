# Wind, scent and stand-planning hunting apps: competitor sheet (as of 2026-10-06)

Scope: apps that sell wind, scent, thermals, stand placement or movement prediction to hunters. Researched 2026-10-06. Caveat on sources: Reddit is blocked to the research crawler, and ArcheryTalk, Bowsite, Rokslide and bowhunting.com returned 402/403 on fetch (The Hunting Beast reset the connection). User sentiment below therefore comes mainly from App Store review text, plus forum lines seen only as search-result snippets (flagged "snippet").

## 1. What does each app claim about wind and scent, and how sophisticated is the model really?

### Takeaway
Nearly every app draws a cone or arrow from forecast or station wind at a pin, with 72 h to 7 day lookahead and an "ideal wind per stand" alert. Only Contors (whitetail, US only, public launch 2026-09-24) clearly claims a wind field solved over LiDAR terrain, with a plume that bends and a wind-driven / thermal / mixed call at dawn and dusk. Two tiny 2025-26 apps (Fur Ledger, XHUNT) claim terrain-aware or bounded plumes. No hunting app discloses its solver, resolution or any canopy/forest effect, and none claims CFD or WindNinja.

### Cited Findings

**Contors (contors.com), the closest rival**
- Taglines: "Scout Smarter. Hunt Smarter." and "Scout AI knows your ground — your stands, your wind, today's conditions"; "built for Whitetail, and nothing else"; "U.S. properties only"; "42 states of rut timing"; "160M parcels mapped" — [contors.com](https://contors.com)
- Scent claims: "The plume bends into draws, runs ridges and spreads where the air is unsettled"; "Not a cone drawn at wind-plus-180"; "Where the air is barely moving it shows scent creeping and spreading"; "Contors solves the forecast wind over the terrain of your property"; "Contors classifies the air as wind-driven, thermal or mixed" — [Contors features](https://contors.com/features)
- Method claims: "A weather station tells you it is 8 mph out of the southeast. That is not what the air does in your creek bottom at last light." "Contors takes the forecast wind and solves it over the terrain of your property, then shows you where your scent actually travels from any stand." "The wind field running over bare lidar terrain — you can see it bend around the ridges." Thermals: "Cold air falls downhill in the morning and rises as the ground warms in the evening, and on the wrong slope that reverses everything." — [Contors wind/scent/thermals](https://contors.com/features/wind-scent-thermals/)
- Stated limits: "It says so on the map when the field is uncalibrated for your area, when the air is too still to claim a direction, and when a plume runs past the edge of the loaded data." and "This is a model, not a measurement." The page gives no solver, grid resolution or canopy/forest treatment — [Contors wind/scent/thermals](https://contors.com/features/wind-scent-thermals/)
- Launch press release (2026-09-24) lists "4 industry firsts": wind and scent modelled across terrain; Scout, "an AI assistant that runs the app"; the Buck Refuge Model (a heat map grading how secure each acre is for mature bucks); Scout Mode / Hunt Mode landscape dashboards with a red night theme. The model "solves the wind field across the shape of the ground, draws it on the map, and renders the hunter's scent as a plume moving through it — spilling into draws, wrapping points, pooling where the air goes slack". The plume runs from every stand, from live positions and from recorded tracks. Also: USGS 3DEP bare-earth LiDAR offline in all 50 states, a 16-day forecast with movement ratings, Buck Score photo aging. Founder Orry Moody, Madison, Alabama — [EIN Presswire](https://www.einpresswire.com/article/944773435/contors-hunting-map-app-launches-on-ios-android-and-web-with-4-industry-firsts)
- Hunt Mode is framed for sitting: "it goes red in the dark so it never costs you your night vision. Wind speed and gusts, which way your scent is blowing right now, whether the thermals have switched, temperature and pressure trend, movement by hour". Scout Mode is for "working the ground" — [Contors field-first interface](https://contors.com/features/field-first-interface/)
- Scout AI can "Rank your stands for a chosen date and hour"; "It does not claim to know where a specific deer is." Ranking inputs are not disclosed — [Contors Scout AI](https://contors.com/features/scout-ai/)
- Deer Movement Index: "A movement rating out of 100 for each day, with the strong days flagged PRIME" — [Contors features](https://contors.com/features)
- App Store: subtitle "Hunting Maps Property Lines AI", seller Contors LLC, v1.0 on July 29 then v1.1–1.4 through Sept 28; 4.7 stars from 13 ratings; listed as iPhone only (iOS 15+) — [App Store](https://apps.apple.com/app/id6790434038). Conflict: the press release says iOS, Android and web (app.contors.com) — [EIN Presswire](https://www.einpresswire.com/article/944773435/contors-hunting-map-app-launches-on-ios-android-and-web-with-4-industry-firsts)

**HuntStand (GSM Outdoors), which absorbed ScoutLook/ScentCone**
- Subtitle "The Only Hunting App You Need"; "HuntZone Wind Forecasting: Predict scent impact with hour-by-hour forecasts up to 72 hours ahead"; "Advanced Game Forecasts: Exclusive 15-day activity forecasts for whitetail, elk, mule deer, and blacktail"; LiDAR terrain maps added in v8.0.58; 4.6 stars from 59K ratings (US) — [App Store US](https://apps.apple.com/us/app/huntstand-gps-maps-tools/id778772892)
- HuntZone "displays a hunter's projected scent cone at given treestand locations, blind locations, etc., and where scent is expected to travel and disperse"; "Check scent cone projections up to 72 hours out". No thermals or method given (2026-07-31) — [HuntStand field notes](https://www.huntstand.com/fieldnotes/deer/a-detailed-guide-to-huntstand-app-tools-for-deer-hunters/)
- Older coverage calls HuntZone "patent-pending" and says it shows wind speed, direction and time together (2022, snippet) — [Bowhunters United](https://bowhuntersunited.com/2022/10/25/up-your-whitetail-hunting-game-with-this-new-popular-app-tier)
- HuntStand Ultimate (2026-05-21) adds a Whitetail Activity Forecast, "a tailored, unique, biologically driven model" that "weighs these things in a mathematical model that has hundreds of thousands of combinations". It also adds a Rut Map (43 states, 4,240 counties), a Habitat Map, crop history and national aerial imagery — [HuntStand field notes](https://www.huntstand.com/fieldnotes/next-level-deer-hunting-with-new-huntstand-ultimate/)
- ScoutLook merged into HuntStand on 2019-06-20, with ScoutLook accounts moved onto HuntStand — [Grand View Outdoors](https://www.grandviewoutdoors.com/news/huntstand-scoutlook-merge-under-huntstand-brand). ScoutLook's ScentCone claim: "shows where your scent will blow hour by hour, for 7 days" (older Mossy Oak/ScoutLook copy, snippet) — [Mossy Oak](https://www.mossyoak.com/our-obsession/blogs/gear-spotlight/mossy-oak-hunting-weather-app-from-scoutlook). Some 2026 listicles still list ScoutLook as a standalone app ("ScoutLook built its reputation on scent cone and wind visualization features… see how your scent is likely to travel across terrain"), which looks stale — [The Outdoor Hunter, 2026-06-03](https://theoutdoorhunter.com/best-hunting-apps-for-2026-top-mapping-weather-and-tracker-tools-for-every-hunter/)

**HuntWise (Sportsman Tracker)**
- Taglines: "Master the Wind. Own the Hunt." and "Stay invisible in the field with real-time wind direction, speed, and stand-specific strategy." It uses "dynamic wind cone displays", explained only by direction ("With a north wind, your scent drifts south"). No data source, resolution, terrain or thermals are given. The page names whitetail and waterfowl — [HuntWise WindCast](https://huntwise.com/features/windcast)
- WindCast "tracks wind speed and direction at all of your tree stands and pinpoints the best spot to hunt each time you head to the woods" — [App Store CA](https://apps.apple.com/ca/app/huntwise-a-better-hunting-app/id645518545)
- Elite's Ideal Wind Report cross-references all stand pins with their ideal-wind settings and highlights the best stand for a day or range of days (snippet) — [HuntWise field guide](https://huntwise.com/field-guide/hunting-tips/how-to-use-windcast-for-scent-control)
- HuntCast 2.0 (2020-10-26): "the most powerful deer prediction algorithm the market has ever seen", with "peak movement times for over a dozen North American species" — [Hunting Life](https://huntinglife.com/nations-leading-hunting-app-launches-huntcast-2-0/)

**Spartan Forge**
- Taglines: "The Only Mapping App You Need"; "The ONLY hunting app that uses artificial intelligence to predict deer movement"; "Combined thousands of years of GPS deer collar data from trusted universities"; "the industry's only neural network to predict deer movement based upon conditions and terrain"; "Industry leading LiDAR imagery allows users to see through the tree canopy"; veteran-owned — [spartanforge.ai](https://spartanforge.ai/)
- App Store: a "deer movement prediction model, built using GPS-collared deer data and environmental conditions from across the U.S."; "historical wind and weather conditions"; the BattleMap tool can "visualize thermals, plan stalks"; "See terrain beneath the canopy with high-resolution LiDAR"; offline downloads; 4.3 stars from 637 ratings — [App Store](https://apps.apple.com/us/app/spartan-forge-hunt/id1562873100?see-all=reviews)
- "1-meter LiDAR covering roughly two-thirds of the lower 48" (a competitor's blog, 2026-07-17) — [Trail Pro Intel](https://www.trailprointel.com/blog/best-hunting-apps-2026)
- The AI's inputs are weather forecast, wind speed and direction, pressure, humidity, sunrise/sunset and moon position; it is trained on "more than 2,000 collective years of collared deer studies" (updated 2021-10-28) — [Outdoor Life](https://www.outdoorlife.com/hunting/spartan-forge-hunting-app/)

**DeerCast (Drury Outdoors)**
- Taglines: "Get Ahead of Your Game" and "Prep. Predict. Pursue.™"; "hour-by-hour, real-time, algorithm-driven deer movement forecast out to 14 days" — [deercast.com](https://www.deercast.com/)
- Forecast inputs: "temperature, cloud cover, barometric pressure, wind, rainfall, time of the rut". Wind feeds the movement score; there is no scent model — [App Store](https://apps.apple.com/us/app/deercast-prep-predict-pursue/id1425879996)
- Wind is used as a movement trigger: 8–15 mph is the "sweet spot" and 12–14 mph ideal; below 5 mph deer "are totally wigged out" (2021-09-10) — [MeatEater](https://www.themeateater.com/wired-to-hunt/whitetail-hunting/how-mark-drury-predicts-buck-movement-based-on-wind)

**onX Hunt**
- Wind comes from Weather Underground plus NOAA stations, with "nearly 10 times the number of weather stations" than the old airport-only feed. By default it shows the closest station (2019-12-04) — [onX blog](https://www.onxmaps.com/hunt/blog/wind-weather-has-arrived)
- "Wind Calendars for stand locations"; "set Optimal Wind conditions on any Markup"; "Deer Movement Forecast" — [App Store CA](https://apps.apple.com/ca/app/onx-hunt-gps-hunting-maps/id672902340)
- Deer Movement Forecast: "100+ million anonymized trail camera images with 50+ environmental factors"; "No single trail cam photo is ever used on its own" — [onX](https://www.onxmaps.com/hunt/app/features/deer-movement-forecast). An onX–Moultrie partnership was announced July 2025 (snippet) — [Deer & Deer Hunting](https://www.deeranddeerhunting.com/onx-hunt)

**BaseMap**
- "HUNTWIND™ & WEATHER CENTER" shows wind direction and scent drift relative to the hunter, and a "wind cone" against stands (snippet) — [Deer & Deer Hunting](https://www.deeranddeerhunting.com/content/articles/what-you-can-do-with-basemap). v7.1 added terrain analysis and viewshed — [App Store](https://apps.apple.com/us/app/basemap-3d-hunting-gps-maps/id1305237481)

**Trail-camera ecosystems**
- Moultrie: "Stay downwind and undetected. Set ideal wind direction for your stands or blinds, and get real-time and 7-day wind forecasts for smarter planning." "Game Plan predicts high-activity periods using local trail camera sightings and weather data." — [App Store](https://apps.apple.com/us/app/moultrie/id1099295160)
- Tactacam Reveal Bluetooth Wind Sensor: a measured wind at a fixed point, 0–55 mph, read in the Reveal app as an on-demand "Wind Check" or a history timeline (Outdoor Life, 2026-08-04) — [Outdoor Life](https://www.outdoorlife.com/gear/tactacam-wind-sensor-review/)

**New entrants, 2025–2026**
- ProHunt (developer Marco Svikovic, released 2026-06-20, one rating): "AI-Powered Hunting Companion"; "Real-time scent cone visualization on map"; "Thermal zone predictions (morning/evening drafts)"; a 16-day "HuntCast" built on a "proprietary multi-factor formula — confirmed inputs include wind conditions, moon phase, and barometric pressure, plus additional undisclosed variables"; "22 Countries with regulations"; "11 Languages" — [prohunt.app](https://prohunt.app/); [MWM listing](https://mwm.ai/apps/prohunt/6760622685)
- Fur Ledger (coyote; Daniel Goodwin): "Scent cone on the map so you can see exactly where your wind is going"; update note: "Scent Cone is now terrain aware. It bends and curves with the land features". 5.0 stars from 10 ratings; listing dates are inconsistent (v1.0 shown as 2025-09-20, v2.5.1 as Sept 9) — [App Store](https://apps.apple.com/app/id6749603003)
- XHUNT (Eric German, iPhone): "bounded animated plume"; "scent displays are approximate orientation aids, not animal-detection predictions"; AI guidance for "access, timing, setup and risk" — [App Store](https://apps.apple.com/bf/app/xhunt/id6744701432)
- CoHunt (Diamondback Consulting LLC): "Scent analysis models how your scent disperses with wind direction and thermals so you can position your stand or plan your stalk to stay downwind."; "Offline-first" — [App Store](https://apps.apple.com/us/app/cohunt-hunting-maps-gps/id6744847191)
- Trail Pro Intel (Michigan, "Built by one hunter"): "3D terrain with live wind vectors and your scent cone drawn right on the map"; a hunt score "built from published research" — [trailprointel.com](https://www.trailprointel.com/)
- BuckVisionAI (web app; "Native iPhone release coming soon"): "Know when to hunt. Know where to sit. Know why." Its PressurePrint™ feature uses "NOAA/NWS wind provenance for modeled drift" and separates "GPS-confirmed travel from modeled route/ground pressure and modeled airborne scent drift" — [buckvisionai.com](https://buckvisionai.com/)
- GameSearch AI: AI land analysis giving "wind strategy suggestions with each analysis" for whitetail, elk, mule deer, turkey and bear; reviews date from Aug 2026 — [gamesearch-ai.com](https://gamesearch-ai.com/)
- HuntScout (Plentisoft, launched 2026-09-03): land/Crown land/WMU/season maps; the release mentions no wind or scent features — [Newsfile](https://www.newsfilecorp.com/release/312588)

**CFD / WindNinja precedent outside hunting**
- WindNinja Mobile (USFS, free): "Upgraded to CFD solver for the wind simulation" (2020); last version 2.0.2 on 2022-10-21; 2.6 stars from 9 ratings; registration failures reported — [App Store](https://apps.apple.com/us/app/windninja-mobile/id1086703676)
- Scentline: a hackathon search-and-rescue dog planner using WindNinja over 3DEP/GLO-30, HRRR 3 km forecasts and a particle scent model at 0.6 m nose height. It warns "Every model is a tunable heuristic… not research-grade" and "Not for operational use." — [GitHub](https://github.com/Chr1spu/scentline)

### Inferences
- Sophistication tiers:
  - (1) Forecast or station wind at a pin, plus an ideal-wind match: onX, Moultrie, HuntWise, DeerCast, iHunter.
  - (2) Straight scent cone from forecast wind: HuntStand HuntZone/ScentCone, BaseMap, ProHunt, CoHunt, Trail Pro Intel.
  - (3) A terrain-bending plume with a thermal-state call: Contors (the most explicit and polished), Fur Ledger and XHUNT (thin claims).
  - Nobody claims head-height wind under canopy, forest-structure effects, lee eddies or wind bending round lake points. Nobody claims a named CFD solver (WindNinja/OpenFOAM) or 1 m LiDAR wind. Groundwind's model description is unmatched in public claims.
- Contors' "uncalibrated for your area" flag suggests some regional calibration step, but nothing says the hunter can correct it.
- Most "thermal" features (ProHunt, CoHunt, Spartan Forge BattleMap) look like time-of-day rules or a user's own reading of terrain, not modelled fields. Contors is the exception, by its own description.

### Gaps
- No app discloses grid resolution, solver type, forecast model (HRRR/NAM/GFS) or update cadence for its scent product. Contors' engine is a black box.
- I couldn't confirm whether HuntStand's HuntZone does any terrain adjustment. Its 2026 docs say nothing about terrain or thermals.

## 2. What does each app charge (USD and CAD), and how is it gated?

### Takeaway
Most apps sit between US$25 and US$120 a year, gated by feature tier (forecast length, LiDAR, ideal-wind reports, AI), with onX also gating by number of states. Canadian App Store prices run about 10–35% higher in CAD for HuntStand and HuntWise, while onX keeps the same numbers in CAD. Nobody sells per area or per 10×10 km block, and nobody sells weather by satellite. Contors puts wind and scent in the free tier.

### Cited Findings
- **Contors:**
  - Free $0 (1 property, limited Scout); Pro $4.99/mo or $39.99/yr; Unlimited $9.99/mo or $79.99/yr; 7-day trial — [contors.com](https://contors.com); [App Store](https://apps.apple.com/app/id6790434038)
  - "The wind, scent and live weather tools are part of every plan, free included." — [Contors](https://contors.com/features/wind-scent-thermals/)
  - Offline saved areas: Free none, Pro 1, Unlimited unlimited; Buck Refuge Model is Unlimited only — [Contors features](https://contors.com/features)
- **HuntStand:**
  - US: Pro $29.99/yr, Ultimate $99.99/yr, Unlimited Parcels $11.99–$19.99, Ad-free $5.99 — [App Store US](https://apps.apple.com/us/app/huntstand-gps-maps-tools/id778772892)
  - CAD: Pro $32.99–$49.99, Pro Whitetail $89.99, Ultimate $129.99, Unlimited Parcels $15.99, Ad-free $7.99 — [App Store CA](https://apps.apple.com/ca/app/huntstand-gps-maps-tools/id778772892)
  - Conflict: a July 2026 blog gives Pro as $34.99/yr — [Trail Pro Intel](https://www.trailprointel.com/blog/best-hunting-apps-2026)
  - Older: Pro Whitetail MSRP $69.99/yr (2022, snippet) — [Bowhunters United](https://bowhuntersunited.com/2022/10/25/up-your-whitetail-hunting-game-with-this-new-popular-app-tier)
  - HuntZone is referenced under both Pro and Ultimate — [HuntStand](https://www.huntstand.com/fieldnotes/deer/a-detailed-guide-to-huntstand-app-tools-for-deer-hunters/)
- **HuntWise:**
  - US: Pro $59.99/yr or $19.99/mo; Elite $119.99/yr or $39.99/mo. Elite adds LiDAR, an "upgraded wind report" and 15-day HuntCast (Pro gets 7-day) — [HuntWise review page](https://huntwise.com/field-guide/hunting-tips/huntwise-app-review); [huntwise.com/elite](https://huntwise.com/elite)
  - CAD: Pro $26.49/mo or $79.99/yr; Elite $52.99/mo or $159.99/yr — [App Store CA](https://apps.apple.com/ca/app/huntwise-a-better-hunting-app/id645518545)
- **Spartan Forge:** monthly $7.99–$12.99; yearly $39.99–$79.99; Outfitter $29.99 (US) — [App Store](https://apps.apple.com/us/app/spartan-forge-hunt/id1562873100?see-all=reviews); $79.99/yr or $12.99/mo — [Trail Pro Intel](https://www.trailprointel.com/blog/best-hunting-apps-2026). A reviewer complains there is "no free trial", while the site mentions a 7-day trial — [spartanforge.ai](https://spartanforge.ai/)
- **DeerCast:** Pro $9.99, Elite $29.99, Elite+ $49.99, Unlimited $74.99 per year (snippet) — [App Store](https://apps.apple.com/US/app/id1425879996). LiDAR is at Elite+ — [Trail Pro Intel](https://www.trailprointel.com/blog/best-hunting-apps-2026). onX Elite members reportedly get DeerCast Elite (snippet; the onX blog page I fetched did not confirm it) — [onX blog](https://www.onxmaps.com/blog/onx-hunt-teams-up-with-deercast)
- **onX Hunt:**
  - US: Premium 1 state $34.99/yr, 2 states $49.99/yr, Elite $99.99/yr or $14.99/mo (50 states + Canada). Optimal Wind on waypoints and the Deer Movement Forecast are Elite; unlimited offline maps on all plans — [onX pricing](https://www.onxmaps.com/hunt/app/pricing)
  - CAD: Elite Monthly $14.99/$19.99/$22.99, Premium Yearly $34.99, Two State $49.99, Elite Yearly $99.99 — [App Store CA](https://apps.apple.com/ca/app/onx-hunt-gps-hunting-maps/id672902340)
- **BaseMap:** Pro $39.99/yr, Pro Advantage $69.99, Pro Ultimate $99.99 — [App Store](https://apps.apple.com/us/app/basemap-3d-hunting-gps-maps/id1305237481)
- **Moultrie:** Hunt Planning Plus $4.99 — [App Store](https://apps.apple.com/us/app/moultrie/id1099295160)
- **Tactacam wind sensor:** $60 hardware plus $5/month subscription — [Outdoor Life](https://www.outdoorlife.com/gear/tactacam-wind-sensor-review/)
- **New entrants:**
  - ProHunt Pro: $79.99/yr or $12.99/mo — [prohunt.app](https://prohunt.app/)
  - CoHunt Pro: $1.99/wk, $4.99/mo, $24.99/yr — [App Store](https://apps.apple.com/us/app/cohunt-hunting-maps-gps/id6744847191)
  - Fur Ledger: $10.99/mo or $99.99/yr — [App Store](https://apps.apple.com/app/id6749603003)
  - XHUNT: Basic $4.99, Pro $9.99/mo — [App Store](https://apps.apple.com/bf/app/xhunt/id6744701432)
  - Trail Pro Intel: free, or Pro $1.99/mo — [trailprointel.com](https://www.trailprointel.com/)
  - BuckVisionAI (founder pricing): $49.99/$74.99/$99.99 per year, plus "dossiers" at $39.99–$249.99 — [buckvisionai.com](https://buckvisionai.com/)
  - GameSearch AI: $8.99/mo or $71.49 one-time, or credits (5 per land analysis) — [gamesearch-ai.com](https://gamesearch-ai.com/)
- **iHunter (Canada):** regional Pro subscriptions CA$4.99–$44.99 — [App Store CA](https://apps.apple.com/ca/app/ihunter/id570558600); ON Pro $34.99 (snippet) — [App Store](https://apps.apple.com/app/id570558600)
- **Garmin inReach (adjacent: satellite weather):** basic, premium and marine forecasts; premium and extended forecasts count as 1 text; the unlimited plan is cited at $49.99/mo (snippet) — [HikingGuy](https://hikingguy.com/garmin-inreach-subscription-cost/); [The Next Summit](https://thenextsummit.org/garmin-inreach-subscription-plans-2025/)

### Inferences
- The common gate is a feature tier (forecast days, LiDAR, AI, best-stand reports), not geography. onX alone gates by state, and none gates by an LiDAR area you buy. Groundwind's "free Live/SD, paid HD per area" model is unusual. It is easy to explain against onX's per-state model and Contors' "1 property free".
- Contors giving wind and scent away free makes the scent cone itself table stakes. A paid wind product has to sell something past a terrain plume: head-height/forest wind, checks that correct the forecast, the party's combined scent.
- In Canada the reference point is iHunter (cheap, provincial) and onX Elite at CA$99.99. HuntWise Elite at CA$159.99 is the ceiling.

### Gaps
- No CAD prices found for Contors (it may not be in the Canadian store: the CA App Store URL returned 404), Spartan Forge (CA store URL also 404), DeerCast or BaseMap.
- The current (2026) DeerCast tier prices come from a search snippet, not a fetched pricing page.

## 3. Who is each app for?

### Takeaway
The category is built for the US whitetail stand hunter on private or leased land: property lines, stands, trail cams and rut maps. Western coverage is mostly mapping (onX, goHUNT), plus game forecasts for elk and mule deer (HuntStand). Canada gets mapping (onX Elite Crown land, iHunter, HuntScout), but no wind or scent product is built for Canadian bush or moose.

### Cited Findings
- **Contors:** whitetail only, US properties only; parcel-centric; hunt clubs share stands, cameras and sign (snippet) — [contors.com](https://contors.com); [App Store](https://apps.apple.com/app/id6790434038)
- **Spartan Forge:** whitetail-centric AI trained on US collar data; LiDAR covers about two-thirds of the lower 48; review: "All the UAV images are in the Midwest. Virtually none of the west is photographed" — [App Store](https://apps.apple.com/us/app/spartan-forge-hunt/id1562873100?see-all=reviews); [Trail Pro Intel](https://www.trailprointel.com/blog/best-hunting-apps-2026)
- **HuntStand:** stand and land-management focus; 15-day forecasts for whitetail, elk, mule deer and blacktail; parcels for "all 50 states and most of Canada" — [App Store US](https://apps.apple.com/us/app/huntstand-gps-maps-tools/id778772892)
- **onX Elite:** 50 states + Canada, including "Crown Lands, Yukon and British Columbia Outfitting Areas, Alberta and British Columbia Special Draw Zones, Saskatchewan Furblock Units" — [App Store CA](https://apps.apple.com/ca/app/onx-hunt-gps-hunting-maps/id672902340)
- **DeerCast, Moultrie, Tactacam, BuckVisionAI, Trail Pro Intel:** whitetail stand hunters on private land — [deercast.com](https://www.deercast.com/); [Moultrie](https://apps.apple.com/us/app/moultrie/id1099295160); [buckvisionai.com](https://buckvisionai.com/); [trailprointel.com](https://www.trailprointel.com/)
- **goHUNT Maps (Western, elk):** layers for ownership, units, burns, water, species distribution; no wind layer turned up in search — [goHUNT](https://www.gohunt.com/browse/tips-and-tricks/how-to-plan-an-elk-hunt-part-one-gohunt-maps-basics-every-hunter-should-know)
- **iHunter:** "Canada's" hunting app (BC, AB, SK, MB, ON, QC, NB, NS, Yukon). Zones and seasons, legal-light calculator, "Wind and weather display (internet required)"; 4.7 stars from 30K ratings (CA) — [App Store CA](https://apps.apple.com/ca/app/ihunter/id570558600)
- **HuntScout:** US + Canada Crown land, WMUs and seasons (ON, BC, AB, SK, QC, NB). Tagline: "Whether you're on BLM land in the West or Crown land in the North, the answer should be one tap away." No wind features — [Newsfile](https://www.newsfilecorp.com/release/312588); [huntscout.app](https://www.huntscout.app/)
- **Moose:** iHUNT Calls Moose sells call sounds with a "Weather Forecaster that helps you never get caught downwind" (snippet) — [App Store](https://apps.apple.com/us/app/-/id1098667612). In Québec, Sépaq points moose hunters to Avenza PDF Maps for geolocation; I found no Québec wind/scent app — [Sépaq guide](https://www.sepaq.com:443/resources/docs/rf/rf-guide-sejour-chasse-orignal.pdf)
- **Coyote / predator:** Fur Ledger — [App Store](https://apps.apple.com/app/id6749603003). **International:** ProHunt (22 countries), CoHunt (US, Norway, Sweden, Finland, NZ parcels) — [prohunt.app](https://prohunt.app/); [CoHunt](https://apps.apple.com/us/app/cohunt-hunting-maps-gps/id6744847191)

### Inferences
- Groundwind's ground (Ontario and Québec moose, Crown land, the mobile caller and still-hunter) is unoccupied by any wind or scent product. The Canadian incumbents (iHunter, onX Canada, HuntScout) sell legal and land answers, not wind.
- Contors' whitetail-and-US-only focus is a deliberate niche. Expanding to Canada or moose would mean new LiDAR (3DEP doesn't cover Canada), so the moat holds for now.

### Gaps
- No elk-specific app with a terrain or thermal wind model turned up. Western hunters seem to use onX/HuntStand forecasts plus Windy (see section 4).

## 4. What do reviews say is missing or wrong (wind accuracy, offline, Canada, mobile hunting)?

### Takeaway
The recurring complaints are:
- forecast wind that doesn't match the stand, with thermals blamed;
- apps that need signal or GPS despite offline maps;
- Canada treated as an afterthought ("App should say 'USA Only'"; "Nothing for Canada and big games/Moose hunting");
- price creep and paywalls.

Praise goes to hourly wind accuracy in open, flat country and to LiDAR for reading terrain.

### Cited Findings
- **Wind accuracy:**
  - Forum users report the onX wind indicator "seems more wrong than right", and say thermals often beat the prevailing wind (snippet; page blocked) — [ArcheryTalk "OnX Wind"](https://www.archerytalk.com/threads/onx-wind.6277919/)
  - Hunters find an app showing wind from one direction from a station 30 miles away, then a different wind at the stand (snippet) — [ArcheryTalk](https://www.archerytalk.com/threads/what-app-do-you-guys-use-to-figure-out-wind-direction.5748759/)
  - HuntStand wind predictions were "pretty much right on" (review, 2023-10-20) — [App Store](https://apps.apple.com/us/app/huntstand-gps-maps-tools/id778772892?see-all=reviews)
  - ScoutLook forecasts were praised as "very accurate including slight wind shifts", and Windy and ScoutLook are the forum favourites (snippet) — [ArcheryTalk](https://www.archerytalk.com/threads/what-app-do-you-guys-use-to-figure-out-wind-direction.5748759/)
  - Windy is pitched to hunters for showing wind "across complex terrain" (2025) — [Let's Go Hunting](https://www.letsgohunting.org/resources/articles/big-game/hunt-smarter-top-rated-mobile-apps-for-hunters-in-2025/)
- **Measured local wind fails in exactly the hard places:** in a creek bottom with ridges and pines, the Tactacam sensor "read 0 mph when there was some wind movement". The reviewer's advice: "The best place to put these is in open areas like fields, open hardwoods, or wide trail intersections" — [Outdoor Life, 2026-08-04](https://www.outdoorlife.com/gear/tactacam-wind-sensor-review/)
- **Offline and GPS:**
  - HuntStand "Bad Update" (2025-01-04): "It's always looking to connect when you open the app, even if you have maps downloaded" — [App Store](https://apps.apple.com/us/app/huntstand-gps-maps-tools/id778772892?see-all=reviews)
  - HuntStand "Obsessed with my location" (2020): GPS required to open Hunt Zone, which blocked checking the wind for a distant spot days ahead — [App Store](https://apps.apple.com/us/app/huntstand-gps-maps-tools/id778772892?see-all=reviews)
  - HuntWise "doesn't work without wifi .... always logging me off" — [App Store CA](https://apps.apple.com/ca/app/huntwise-a-better-hunting-app/id645518545)
  - XHUNT: "AI guidance and new live data require an internet connection" — [App Store](https://apps.apple.com/bf/app/xhunt/id6744701432)
  - Trail Pro Intel "Does not offer downloadable offline map regions for unseen areas" — [Trail Pro Intel](https://www.trailprointel.com/blog/best-hunting-apps-2026)
  - iHunter's wind needs internet — [App Store CA](https://apps.apple.com/ca/app/ihunter/id570558600)
  - onX's offline use is consistently praised ("Battery usage in offline mode is very reasonable") — [App Store](https://apps.apple.com/us/app/onx-hunt-gps-hunting-maps/id672902340?see-all=reviews)
- **Canada:**
  - HuntWise CA review: "Nothing for Canada and big games/Moose hunting", with "potential, but it remains to be developed" — [App Store CA](https://apps.apple.com/ca/app/huntwise-a-better-hunting-app/id645518545)
  - onX CA reviews (older): "App should say 'USA Only'"; "if you want to save anymore you have to upgrade but no Canadian option" — [App Store CA](https://apps.apple.com/ca/app/onx-hunt-gps-hunting-maps/id672902340)
  - HuntStand CA: "Please make a Canadian version so the land parcel section is usable." — [App Store CA](https://apps.apple.com/ca/app/huntstand-gps-maps-tools/id778772892)
- **Price and paywalls:**
  - Spartan Forge "won't let you even preview the app without a subscription" (2025-03-14); its price is also praised as "less than half the price of competitors" (2023) — [App Store](https://apps.apple.com/us/app/spartan-forge-hunt/id1562873100?see-all=reviews)
  - DeerCast reviewers complain of price rises after an acquisition by GSM Outdoors (a reviewer's claim, unverified) and call the ~$80/yr tier costly — [App Store](https://apps.apple.com/us/app/deercast-prep-predict-pursue/id1425879996)
  - HuntWise: "This year I am opting out of the subscription...I can't justify that kind of money" — [App Store CA](https://apps.apple.com/ca/app/huntwise-a-better-hunting-app/id645518545)
  - HuntStand added a new paid tier after users had bought one — [App Store](https://apps.apple.com/us/app/huntstand-gps-maps-tools/id778772892?see-all=reviews)
- **Mobile hunting and navigation:** HuntStand review "It needs a 'Go To' function" (2023), asking for navigation to waypoints with a compass heading — [App Store](https://apps.apple.com/us/app/huntstand-gps-maps-tools/id778772892?see-all=reviews). Contors' Hunt Mode is explicitly "when you are sitting" — [Contors](https://contors.com/features/field-first-interface/)
- **Praise for LiDAR and thermals:** "LiDAR also allows you to be able to predict thermal activity very well." (Spartan Forge review, 2024-08-19) — [App Store](https://apps.apple.com/us/app/spartan-forge-hunt/id1562873100?see-all=reviews)
- **ScoutLook migration:** when HuntStand absorbed ScoutLook, some features (stand photos, best-wind notes) did not carry over (snippet) — [bowhunting.com forum](https://forums.bowhunting.com/threads/best-hunting-app.98892/)

### Inferences
- The top unmet complaint, "the app's wind isn't the wind at my stand", is exactly what head-height modelling plus hunter wind checks answer. The Tactacam test shows that even a measured point wind misleads in creek bottoms and timber. That argues for a model that knows the forest and the terrain, with the hunter's checks as corrections, not raw readings.
- Offline gaps are common even in leaders (HuntStand, HuntWise, iHunter wind). Groundwind's offline wind plus satellite weather fixes a real, stated pain, especially beyond cell coverage in the Canadian bush.

### Gaps
- No Reddit text could be retrieved (domain blocked to the crawler). Reddit sentiment on r/Hunting, r/bowhunting, r/whitetail, r/elkhunting and r/canadahunting is unverified here.
- Contors has only 13 App Store ratings, all positive and generic ("I wish I had this years ago! This is a deer hunter's dream"), so there is no field criticism of its plume yet — [App Store](https://apps.apple.com/app/id6790434038)
- I found no podcast or YouTube review (MeatEater, Hunting Beast, The Hunting Public) assessing app wind accuracy in 2025-26. MeatEater/Wired to Hunt episodes on wind exist, but I didn't find one evaluating apps — [Wired to Hunt ep. 960](https://www.themeateater.com/listen/wired-to-hunt/ep-960-mastering-wind-to-kill-mature-bucks-with-mark-drury)

## 5. Has anyone published validation of their wind or scent predictions?

### Takeaway
No. I found no published or independent validation of any app's wind or scent output against measured wind, smoke or other tracers. The only accuracy numbers are old, vendor-stated movement-prediction figures: DeerCast "close to 95%" (2021) and Spartan Forge 65% (founder, 2021). Newer apps hedge instead: Contors "This is a model, not a measurement"; XHUNT "approximate orientation aids".

### Cited Findings
- DeerCast's algorithm claims to "predict deer movement with close to 95% accuracy" (2021-09-10), with no study cited — [MeatEater](https://www.themeateater.com/wired-to-hunt/whitetail-hunting/how-mark-drury-predicts-buck-movement-based-on-wind)
- Spartan Forge's founder says it was "65 percent accurate at predicting movement of wild whitetails in a collared deer study". The writer cautions that "no app, artificial intelligence, or algorithm can fully predict the behavior of a wild whitetail buck" (updated 2021-10-28) — [Outdoor Life](https://www.outdoorlife.com/hunting/spartan-forge-hunting-app/). The current site gives no accuracy figure — [spartanforge.ai](https://spartanforge.ai/)
- onX argues accuracy from scale: "By analyzing more than 100 million trail cam images alongside real-time weather and environmental conditions" — [onX](https://www.onxmaps.com/hunt/app/features/deer-movement-forecast)
- Contors: "This is a model, not a measurement"; it flags uncalibrated areas and still air — [Contors](https://contors.com/features/wind-scent-thermals/)
- XHUNT: "scent displays are approximate orientation aids, not animal-detection predictions" — [App Store](https://apps.apple.com/bf/app/xhunt/id6744701432)
- BuckVisionAI "Does not claim to measure exact scent concentration" and labels AI output "for review and verification" — [buckvisionai.com](https://buckvisionai.com/)
- The only hands-on wind test I found is Outdoor Life's anecdotal Tactacam sensor review: it matched a Vortex reading at 4 mph and missed light wind in a creek bottom — [Outdoor Life](https://www.outdoorlife.com/gear/tactacam-wind-sensor-review/)
- The non-hunting precedent, Scentline (WindNinja + scent), says it is "not research-grade" — [GitHub](https://github.com/Chr1spu/scentline)
- Search for a formal comparison of hunting app wind against anemometers found none — [search context: HuntWise HuntCast vs weather apps](https://huntwise.com/field-guide/hunting-tips/huntcast-vs-weather-apps)

### Inferences
- Validation is an open field. Groundwind's WindNinja momentum checks (internal), plus field wind checks that log forecast against observed wind, could become the first public accuracy claim in the category: "we score our wind against your checks". That would separate it sharply from Contors' unvalidated black box.

### Gaps
- I couldn't verify whether HuntStand's "patent-pending" HuntZone application was ever published or granted, or what method it describes.

## 6. Which of Groundwind's angles does each competitor already cover?

### Takeaway
Contors covers the most: a terrain-aware plume, thermal-state calls, offline LiDAR, a plume from live positions and tracks. It does so only for US whitetail, with no head-height or forest model, no correction from the hunter's own checks, no combined party scent and no satellite weather. Everyone else covers at most a forecast cone plus "ideal wind per stand". Canada-based mapping exists (onX, iHunter, HuntScout), but not Canadian wind or moose. Nobody offers made-to-order areas or satellite text weather.

### Cited Findings
- Contors' plume runs "from every stand, live positions, and recorded tracks" — [EIN Presswire](https://www.einpresswire.com/article/944773435/contors-hunting-map-app-launches-on-ios-android-and-web-with-4-industry-firsts). Hunt Mode is for sitting — [Contors](https://contors.com/features/field-first-interface/). Hunt-club sharing exists — [contors.com/features](https://contors.com/features). US only — [contors.com](https://contors.com)
- Old ScoutLook let hunting buddies log sightings, weather and wind to a shared camp account (snippet) — [Mossy Oak](https://www.mossyoak.com/node/1870). Spartan Forge's "Blue Force Tracker" shares pins and positions within a team — [spartanforge.ai](https://spartanforge.ai/)
- Measured wind: Tactacam sensor "Wind Check" readings in-app — [Outdoor Life](https://www.outdoorlife.com/gear/tactacam-wind-sensor-review/)
- Canadian land data: onX Elite Crown land — [App Store CA](https://apps.apple.com/ca/app/onx-hunt-gps-hunting-maps/id672902340); iHunter — [App Store CA](https://apps.apple.com/ca/app/ihunter/id570558600); HuntScout — [Newsfile](https://www.newsfilecorp.com/release/312588)
- Satellite weather already exists on the device side: Garmin inReach basic/premium forecasts (snippet) — [HikingGuy](https://hikingguy.com/garmin-inreach-subscription-cost/)

### Inferences
Coverage matrix. This is my reading of the cited findings: Y = covered, P = partial, N = not found.

| Groundwind angle | Contors | HuntStand | onX | HuntWise | Spartan Forge | DeerCast | BaseMap | Moultrie / Tactacam | New small apps (ProHunt, CoHunt, Fur Ledger, XHUNT, Trail Pro Intel) | iHunter / HuntScout |
|---|---|---|---|---|---|---|---|---|---|---|
| Terrain-aware wind/scent (beyond a straight cone) | Y (method undisclosed) | N (72 h cone) | N (station wind) | N (cone) | P (LiDAR + thermals left to the user) | N | N (cone) | N | P (Fur Ledger, XHUNT claims) | N |
| Head-height / under-canopy / forest-structure wind | N | N | N | N | N | N | N | N | N | N |
| Lee eddies, lake-point bending, CFD-class solver | N (none claimed) | N | N | N | N | N | N | N | N | N |
| Thermals | Y (wind/thermal/mixed) | N | N | N | P ("visualize thermals") | N | N | N | P (ProHunt, CoHunt time-of-day) | N |
| Hunter wind checks that correct the forecast | N (has an "uncalibrated" flag) | N | N | N | N | N | N | P (Tactacam measured point wind, no model correction) | N | N |
| Combined party scent (several cones) | P (plume per stand; club sharing) | N | N | N | P (team pins only) | N | N | N | N | N |
| Active / mobile hunter mode (live cone while moving) | P (plume from live position; Hunt Mode for sitting) | N | N | N | P (stalk planning) | N | N | N | P (CoHunt "plan your stalk") | N |
| Canadian moose / Crown land | N (US only) | P (most of Canada parcels; no moose forecast) | P (Crown land; no moose) | N ("Nothing for Canada… Moose") | N | N | N | N | N | P (land/zones/seasons; iHunter wind needs internet) |
| Offline wind/scent | P (offline LiDAR; whether wind works offline is unclear) | P (complaints about connecting) | Y maps / ? wind | N (needs wifi complaint) | P | N | P | N | P (CoHunt offline-first) | N (wind needs internet) |
| Satellite (inReach) weather | N | N | N | N | N | N | N | N | N | N |
| Made-to-order areas (48 h build) | N (automatic for any US parcel) | N | N | N | N | N | N | N | N | N |
| Game heatmaps (moose, deer, grouse, bear) | P (whitetail Buck Refuge) | P (whitetail habitat; elk/mule forecasts) | P (deer forecast) | P (HuntCast, many species) | P (whitetail) | P (whitetail) | N | P (cam-based) | P (GameSearch AI multi-species) | N |
| Hunt-weighted off-trail routes | N found | N | N | N | N | N | N | N | N | N |

- Groundwind's clearest unique claims, given the public record:
  - (1) Head-height wind under forest from a published solver (WindNinja momentum) over 1 m LiDAR.
  - (2) Hunter wind checks that tune the model at the spot.
  - (3) Combined party scent.
  - (4) Offline wind with satellite-text weather for no-signal bush.
  - (5) Ontario/Québec moose on Crown land.
  - (6) Made-to-order areas.
- Contors is the one to watch. Its copy already says "terrain", "thermals", "not a cone at wind-plus-180", so Groundwind should not lead with "terrain-aware scent" alone. It should lead with what Contors can't say: head height under canopy, eddies and lake points, correctable by your own checks, moose and the moving hunter, Canada, works with no signal.

### Gaps
- I couldn't confirm whether Contors' wind and plume run offline, or only its LiDAR basemap. The press release stresses offline LiDAR only.
- I couldn't confirm whether any app layers several hunters' cones into one view. HuntStand and Contors share stands within a group, but no source describes combined cones.
