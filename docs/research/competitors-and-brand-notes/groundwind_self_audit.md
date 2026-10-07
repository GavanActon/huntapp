# Groundwind self-audit: how the brand looks and sounds today, and what it already owns

Scope: a local-file audit of C:/dev/huntapp (site/, app/, docs/, README.md), the founder's session memory (C:/Users/gavan/.claude/projects/c--dev-huntapp/memory/), the field-data folder, and the live site on 2026-10-06. Line numbers are from the files as they stood on 2026-10-06. "Visible text" means what a visitor reads, not aria-labels or code.

## 1. What do the site and app say today, and how do they say it?

### Takeaway
The live site leads with a two-beat imperative, "The forecast is a guess. Sharpen it.", and then runs 13 feature rows built to the same template. It is plain, numerate, second-person Canadian English with no hype, and it is very consistent. The app that the "Open the beta" button opens still calls itself "Pic River", and its copy is terse instrument language ("Wind sharpened", "Which way does the powder go?").

### Cited Findings
**Live equals local**
- On 2026-10-06 the live homepage was byte-identical to the local file: curl returned 39,542 bytes and an empty diff. guide.html (33,873 B) and hunting-thermals.html (16,069 B) also matched. Every site quote below is therefore what is live. — [groundwind.app](https://groundwind.app); [site/index.html](file:///C:/dev/huntapp/site/index.html)

**Title, meta and hero**
- Page title: "Groundwind · Hunting wind and scent app for the Canadian bush". Meta description: "A hunting app for moose and deer: the wind at head height and your scent cone, from Environment Canada's HD forecast over LiDAR terrain. Works offline." — [site/index.html:6-7](file:///C:/dev/huntapp/site/index.html)
- OG title: "Groundwind: the forecast is a guess. Sharpen it." OG description: "Head-height wind and scent for hunting the Canadian bush, on your phone with no service, sharpened by your own wind checks." — [site/index.html:17-18](file:///C:/dev/huntapp/site/index.html)
- Eyebrow: "Made to order for your ground · on the stand and on the move". — [site/index.html:70](file:///C:/dev/huntapp/site/index.html)
- H1: "The forecast is a guess. *Sharpen it.*" ("Sharpen it." is set in the cyan wind colour). — [site/index.html:71](file:///C:/dev/huntapp/site/index.html); [site/site.css:90](file:///C:/dev/huntapp/site/site.css)
- Lede: "Groundwind is a hunting app that runs a real wind model at ground level: Environment Canada's high-resolution forecast, worked over the LiDAR terrain and through the trees and the season's leaves. Puff your powder and tap where it went, and your check corrects the model around you. Your scent cone shows where your scent is really going, with or without bars." — [site/index.html:72](file:///C:/dev/huntapp/site/index.html)
- CTAs: "Open the beta" (primary) and "Request your spot" (quiet). QR line: "It's made for your phone. Point the camera here to open it there, then add it to your home screen." — [site/index.html:74-79](file:///C:/dev/huntapp/site/index.html)
- Hero caption under the loop: "Forecast toward E, 14 km/h · powder toward N / One check, and the cone follows." — [site/index.html:88](file:///C:/dev/huntapp/site/index.html)

**Section structure: H2s in order, with their mono tag labels**
1. "Every forecast is off where you sit." (no tag)
2. "A wind model, not an arrow." (The wind model)
3. "Not an app for everywhere. Built for your spot." (Made to order)
4. "A forecast that works with no bars." (Forecast)
5. "No bars? Doesn't matter. The HD forecast comes by text." (By text)
6. "Sharpen the wind. Trust the cone." (Wind checks)
7. "Where they'll be, day by day." (Habitat and weather)
8. "A warm week beds them. The first cold morning moves them." (Behaviour)
9. "See the bush before you're in it." (Bush and range)
10. "Tonight, two of you." (Party scent)
11. "Up a tree, your scent lands further out." (Stand height)
12. "What's the wind doing over that bluff?" (On the move)
13. "Behind the summit, the wind comes back." (In the mountains)
14. Then "Also in the beta", "Built so far.", "Request your spot.", "Questions" and "Field notes".
— [site/index.html:94-486](file:///C:/dev/huntapp/site/index.html)

**Proof tiles**
- "10 m: The height a wind forecast is made for, over open ground." / "1.5 m: Where your scent leaves you, under the trees." and "10×10 km: Built around your spot" / "48 h: From your request to the map on your phone." — [site/index.html:98-99, 135-136](file:///C:/dev/huntapp/site/index.html)

**Coverage and the request form**
- "Ontario and Québec: Today. Elsewhere in Canada, ask: a new province takes us longer, because its forest and LiDAR come from different places." — [site/index.html:144](file:///C:/dev/huntapp/site/index.html)
- "Built so far." lists only "Pickle Lake: Near White River, ON · WMU 21B" and "Lac Bailey: Québec · zone 18". — [site/index.html:410-413](file:///C:/dev/huntapp/site/index.html)
- Request form: "Tell us where you hunt. We build a 10 × 10 km block around it and email you when it's on the map: within 48 hours in Ontario and Québec." Success message: "Got it. We'll build it and email you when it's ready, within 48 hours." Rate limit: "Lots of requests from here just now. Try again in an hour." — [site/index.html:425, 539, 542](file:///C:/dev/huntapp/site/index.html)

**FAQ (verbatim questions)**
- "What does it cost?" ("Nothing during the beta."), "iPhone or Android?", "Does it work with no service?", "Where does it work?", "Why not everywhere?", "What happens to my data?" and "How right is the ground wind?" — [site/index.html:455-481](file:///C:/dev/huntapp/site/index.html)
- Two key answers. "Where we've built it, on purpose." / "We'd rather do your spot properly than the whole country badly." / "It's a model, and every model is wrong somewhere. That's why the checks exist: a puff of powder at your spot beats any forecast…" — [site/index.html:468-480](file:///C:/dev/huntapp/site/index.html)
- The iPhone answer: "No app store and no account." — [site/index.html:460](file:///C:/dev/huntapp/site/index.html)

**Footer, guide, articles and 404**
- Footer, on all five public pages: "Groundwind is a beta. The wind at your head is a model, so keep checking it yourself. That's what the checks are for." — [site/index.html:509](file:///C:/dev/huntapp/site/index.html); [site/hunting-thermals.html:205](file:///C:/dev/huntapp/site/hunting-thermals.html)
- Guide H1: "From the kitchen table to the bull." Lede: "Twelve steps, each a few taps." Its steps include "Heard him? Two taps.", "Put both of you where your scent works." and "The log keeps itself." — [site/guide.html:55-56, 293, 226, 336](file:///C:/dev/huntapp/site/guide.html)
- Article H1s:
  - "Hunting thermals: scent follows the sun, not the clock." — [site/hunting-thermals.html:70](file:///C:/dev/huntapp/site/hunting-thermals.html)
  - "Calling moose: the bull circles for your wind." — [site/moose-calling-wind.html:70](file:///C:/dev/huntapp/site/moose-calling-wind.html)
  - "When moose move: watch the thermometer, not the barometer." — [site/moose-weather.html:70](file:///C:/dev/huntapp/site/moose-weather.html)
  - Bylines read "Groundwind · 5 October 2026". There is no person's name.
- 404 page: "Off the trail." / "There's nothing at this address. The way back is behind you." — [site/404.html](file:///C:/dev/huntapp/site/404.html)

**App copy**
- Card and sheet strings include "Heard a moose", "Tap the map where you heard it", "Wind sharpened", "Which way does the powder go?", "There is signal: no text needed.", "Weather updated" and "Nothing to score yet". — [app/src/ui/](file:///C:/dev/huntapp/app/src/ui/) (HeardCard.tsx, WindCheckCard.tsx, sheets/SatSheet.tsx)
- Empty states: "Your sounds, sightings, wind checks and outings land here as you hunt" and "Nothing heard or checked". — [app/src/ui/sheets/HuntLogSheet.tsx:263](file:///C:/dev/huntapp/app/src/ui/sheets/HuntLogSheet.tsx); [app/src/ui/OutingCard.tsx:256](file:///C:/dev/huntapp/app/src/ui/OutingCard.tsx)
- The area switch chip: "You're at {area.name} · Switch". — [app/src/ui/AreaOffer.tsx:54](file:///C:/dev/huntapp/app/src/ui/AreaOffer.tsx)
- Hot-button names: "Sharpen the wind", "Scent cone", "Heard", "Routes", "Measure" and "Pin". — [app/src/ui/hotButtons.tsx:79-137](file:///C:/dev/huntapp/app/src/ui/hotButtons.tsx)
- The Wind sharpened card in the poster image reads: "The map was close · it said toward E at 10, you felt toward S, breezy … Plain wind: agreed 0, close 1, missed 0 this season … Check again in about 40 min, or the moment it shifts". — [site/media/sharpen-card.jpg](file:///C:/dev/huntapp/site/media/sharpen-card.jpg)

**How it is said**
- No em dashes on any of the six site pages. The only en dashes are in licence names.
- No exclamation marks in visible copy. The five "!" on the homepage are JavaScript operators in the form script.
- No "whether you're…" anywhere.
- "real" and "really" appear twice: "a real wind model" and "where your scent is really going".
- Spelling is Canadian (colour, behaviour, metres). — grep over [site/*.html](file:///C:/dev/huntapp/site/)

**Internal inconsistencies on the live site**
- The mountains section uses "Highland Lake in the Yukon, Monday 5 October, 5 pm". But "Built so far" and the FAQ name only Pickle Lake and Lac Bailey ("…so far"), and the coverage line says "Ontario and Québec. Today." — [site/index.html:384, 412-413, 468, 144](file:///C:/dev/huntapp/site/index.html)
- The FAQ says the beta costs nothing. The founder decided on 2026-10-05 that HD is "paid per area" and text weather is paid "in bundles", and the site does not say so yet. — [memory: huntapp-monetization.md](file:///C:/Users/gavan/.claude/projects/c--dev-huntapp/memory/huntapp-monetization.md)

### Inferences
- The message hierarchy is clear and right for the product: the forecast is wrong at your spot → the wind check fixes it → made to order. But 13 feature rows means the homepage reads like a full product tour more than a pitch, and the strongest proof (a real miss that was corrected) never appears.
- The copy is unusually careful and factual for a hunting app: numbers, sources, no bravado. That builds credibility, but it also gives the site one even, measured tone from top to bottom.

### Gaps
- The MP4 loops were not watched frame by frame. Only the posters for groundwind, sharpen-card, eddy and bushview, plus og.png, were viewed.
- stats.html (noindex, the analytics dashboard) was not audited for copy.

## 2. What are the palette, type stack, components and imagery?

### Takeaway
The site is "dark first, like the app": a forest black (#0a100b) with a light camo-sage accent (#d3dfb4), cyan for wind (#4fc7ff) and orange for scent (#ff9d4d). Headlines are in Sofia Sans Extra Condensed 800 caps ("trail-sign condensed caps"), with IBM Plex Mono readouts. There are no photographs at all; every picture is an app screen in a phone frame. The app shares the colour tokens but uses the system font, and its home-screen icon is a different mark.

### Cited Findings
**Site design intent and colours**
- The design intent, in a CSS comment: "The app's own screens are the pictures; the type is trail-sign condensed caps over a quiet body, with instrument readouts in mono. Dark first, like the app; the light theme is the app's Outdoor palette." — [site/site.css:1-4](file:///C:/dev/huntapp/site/site.css)
- Dark tokens: --bg #0a100b, --raised #141c15, --ink #f3f8ef, --dim #bccbb7, --faint #879b85, --accent #d3dfb4, --on-accent #121709, --wind #4fc7ff, --scent #ff9d4d, --good #86d97a. Lines are rgba(190,214,182,0.18/0.38). — [site/site.css:6-26](file:///C:/dev/huntapp/site/site.css)
- Light tokens, applied automatically under `prefers-color-scheme: light`: --bg #f3f0e7 (bone/cream), --raised #fbfaf6, --ink #121a10, --accent #5a6b3e (olive), --wind #0b6fae, --scent #b9561a (burnt orange), --good #2f7d2a. — [site/site.css:28-47](file:///C:/dev/huntapp/site/site.css)

**Site type**
- `--f-display: 'Sofia Sans Extra Condensed'` (weight 800, uppercase, h1 at clamp(3rem, 11vw, 5.75rem) with line-height 0.88).
- `--f-body: 'Sofia Sans'` (400/500/600).
- `--f-mono: 'IBM Plex Mono'` (400/500), uppercase with 0.07em tracking, used for the eyebrow, tags and readouts.
- All three load from Google Fonts. — [site/site.css:21-23, 80-98](file:///C:/dev/huntapp/site/site.css); [site/index.html:26](file:///C:/dev/huntapp/site/index.html)

**Site components**
- Pill buttons (border-radius 999px) and a "Beta" pill in mono caps. — [site/site.css:106-135](file:///C:/dev/huntapp/site/site.css)
- Mono tag labels, each led by a 9px coloured dot whose colour is the feature's meaning (wind, scent or good). — [site/site.css:218-219](file:///C:/dev/huntapp/site/site.css)
- Stat tiles (.heights, radius 10px), a request form card (radius 18px), and phone bezels (radius 42px with a 33px screen). — [site/site.css:143-160, 200-208, 273-275](file:///C:/dev/huntapp/site/site.css)
- `<details>` "How it works" disclosures with a hairline above, an SVG step chart of moose activity by temperature, chips on the request form, and a 3-up "Also in the beta" grid. — [site/index.html:154-156, 221-267, 390-406, 437-442](file:///C:/dev/huntapp/site/index.html)
- site.css has 21 `border-top: 1px solid var(--line)` hairlines. Every section and row is divided by one. — [site/site.css](file:///C:/dev/huntapp/site/site.css)

**Marks and icons**
- The site mark is a small round dot (you, in ink) with an orange wedge opening to the right (your scent cone). It appears in the header SVG, icon.svg and apple-touch-icon.png. — [site/index.html:59](file:///C:/dev/huntapp/site/index.html); [site/icon.svg](file:///C:/dev/huntapp/site/icon.svg); [site/apple-touch-icon.png](file:///C:/dev/huntapp/site/apple-touch-icon.png)
- og.png (1200×630) shows the dot-and-cone wordmark, "THE FORECAST IS A GUESS. SHARPEN IT." in condensed caps with "SHARPEN IT." in cyan, a mono line "HEAD-HEIGHT WIND AND SCENT · FOR HUNTING THE CANADIAN BUSH", and a phone with the Wind sharpened card over satellite imagery. — [site/og.png](file:///C:/dev/huntapp/site/og.png)

**Imagery**
- site/img/ is empty. — [site/img/](file:///C:/dev/huntapp/site/img/)
- site/media/ (about 66 MB) holds app-qr.svg plus stills and loops named bush, bushview, digin, eddy, evening2, forecast, groundwind, heard, heat, holds, layers, log, plan, setup, sharpen, species, stalk, stand and thermals (each a .jpg poster and an .mp4 loop). satellite.jpg, screen.jpg and sharpen-card.jpg are stills only. — [site/media/](file:///C:/dev/huntapp/site/media/)
- The homepage has 12 phone frames. — [site/index.html](file:///C:/dev/huntapp/site/index.html)
- What the posters show:
  - groundwind.jpg: cyan wind streaks pouring off a lake over satellite imagery, with orange contour lines.
  - sharpen-card.jpg: an orange scent blob on a blue dot, with the check card below.
  - eddy.jpg: grey topo around a 1700 m summit, with streaks curling in its lee.
  - bushview.jpg: a red-to-orange bush-thickness raster along a road.
  — [site/media/](file:///C:/dev/huntapp/site/media/)
- The loops are real app output, captured at 30 fps on a stepped clock, using historical weather for past days. The thermals loop is Pickle Lake on Mon 28 Sept 2026 at 2 pm: "4 km/h, 20 °C, clear… the land 9° warmer than the lake". — [memory: huntapp-site-loops.md](file:///C:/Users/gavan/.claude/projects/c--dev-huntapp/memory/huntapp-site-loops.md)

**App theme**
- Same base: --c-bg #0a100b, --c-accent #d3dfb4 ("a light camo sage, the Bow view's own tones"), --c-wind #4fc7ff ("cyan is for air and water only"), --c-good #86d97a.
- Added: --c-fair #cfccb4, --c-track #59e0b8, --c-warn #e2845a ("a warning is clay, never a yellow") and --c-danger #ff6b6b.
- The Outdoor theme is bone #f3f0e7. Radii are 6/10/18 px. — [app/src/theme.css:6-52, 77-108](file:///C:/dev/huntapp/app/src/theme.css)
- The founder drove the palette. He rejected amber with "I hate the yellow tones" and asked for light camo like the Bow view. — [memory: huntapp-chrome-theme.md](file:///C:/Users/gavan/.claude/projects/c--dev-huntapp/memory/huntapp-chrome-theme.md)

**App type, colour and icon**
- The app font is the system stack: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto…". None of the site's three fonts are used. — [app/src/theme.css:69-71](file:///C:/dev/huntapp/app/src/theme.css)
- The splash is also -apple-system, and the app's theme-color is #0f1a12, where the site uses #0a100b. — [app/index.html:13, 22](file:///C:/dev/huntapp/app/index.html)
- The app's home-screen icon is a different mark: an orange-and-bone compass needle over a cyan ellipse inside green concentric arcs (sonar-like). favicon.svg has #78c878 rings and a #3fc8ff ellipse. — [app/public/icons/icon-192.png](file:///C:/dev/huntapp/app/public/icons/icon-192.png); [app/public/favicon.svg](file:///C:/dev/huntapp/app/public/favicon.svg)

### Inferences
- The dark forest base, sage, cyan wind and orange scent form a coherent, meaning-coded system: cyan always means air, orange always means scent. That is more distinctive than a generic SaaS palette, and it comes out of the product's own map.
- The condensed caps headline face plus mono "instrument" labels is a recognisable 2024-26 tech-landing look, so it is less ownable than the colours.
- The app icon and app font break the system at the most frequent touchpoint, the home screen. The compass-and-sonar icon looks inherited from the founder's earlier boat app ("Sandies"; the README says the app has the "Same shape as the Sandies boat app").

### Gaps
- No brand guidelines document exists in the repo. Nothing records why Sofia Sans was chosen.
- It is not known what share of visitors see the light (cream) theme. The analytics in docs/ANALYTICS.md were not queried.

## 3. Which sentences and design choices carry AI or generic tells?

### Takeaway
The most obvious tells (em dashes, "whether you're", hype, exclamation marks) have been scrubbed. What remains is structural, and it is consistent enough to read as one hand:
- "X, not Y" contrasts in headlines
- two-beat period-split headlines
- a colon after nearly every lead clause
- repeated triads
- one feature template stamped nine times, under mono eyebrow tags and hairlines

On design, the site avoids the serif and clay default in dark mode, but light-mode phones get a cream page.

### Cited Findings
**Copy tells (counts are visible text on the six public site pages)**
- **Em dashes: 0.** No page has one. The only en dashes are in licence names ("Open Government Licence – Canada"). The app's own title has one: "Pic River — hunt & fish maps". — grep over [site/](file:///C:/dev/huntapp/site/); [app/index.html:19](file:///C:/dev/huntapp/app/index.html)
- **"X, not Y" or "Not X. Y." contrasts: about 10 instances, at the top of the hierarchy.**
  - Homepage H2s: "A wind model, not an arrow." and "Not an app for everywhere. Built for your spot."
  - Body: "Eye-level cover isn't the canopy" (twice), "rough air, not a smooth curve", "Scent follows the sun, not the clock". — [site/index.html:111, 132, 319, 366, 384, 490](file:///C:/dev/huntapp/site/index.html)
  - Two of the three article H1s: "scent follows the sun, not the clock" and "watch the thermometer, not the barometer". — [site/hunting-thermals.html:70](file:///C:/dev/huntapp/site/hunting-thermals.html); [site/moose-weather.html:70](file:///C:/dev/huntapp/site/moose-weather.html)
  - Also "about the sun, not the clock" (thermals:98), "more active in rain, not less" (moose-weather:102) and "not the canopy overhead" (guide:260).
- **Two-beat, period-split headlines: the H1 plus 4 of 13 feature H2s.** "The forecast is a guess. Sharpen it.", "Not an app for everywhere. Built for your spot.", "No bars? Doesn't matter. The HD forecast comes by text." (three beats), "Sharpen the wind. Trust the cone." and "A warm week beds them. The first cold morning moves them." The guide adds "Tap to use it. Hold for its drawer." and "Heard him? Two taps." — [site/index.html:71-212](file:///C:/dev/huntapp/site/index.html); [site/guide.html:132, 293](file:///C:/dev/huntapp/site/guide.html)
- **Sentence-fragment headlines:** "Tonight, two of you.", "Built so far.", "Where they'll be, day by day." and "One screen, everything on it." — [site/index.html:193, 328, 410](file:///C:/dev/huntapp/site/index.html); [site/guide.html:99](file:///C:/dev/huntapp/site/guide.html)
- **Colon-elaboration as the default sentence shape:** 35 lines of the homepage's visible text contain ": ". Examples:
  - the lede, "a real wind model at ground level: Environment Canada's…"
  - "Bush thickness at eye level, from the LiDAR point cloud: open, light, thick or thicket."
  - "A lot of moose hunting is moving: angling in on a bull…"
  - all three article H1s use "Topic: claim."
  — [site/index.html:72, 310, 357](file:///C:/dev/huntapp/site/index.html)
- **Triads, and the same triads repeated:**
  - "angling in on a bull, working round a bluff, still-hunting an edge" (line 96) comes back reordered as "angling in on a bull you've heard, still-hunting an edge, working round a bluff" (line 357).
  - The #built paragraph "The wind at your head depends on your ridge, your stands and your shoreline, and getting it right takes 1 m LiDAR, the forest inventory and a wind model solved over that exact ground" (line 133) is repeated almost word for word in the FAQ "Why not everywhere?" ("…and modelling that takes 1 m LiDAR, the forest inventory and a wind solve over that exact ground", line 472).
  - Also "how far you'll see, how loud the walk is, and where a moose can stand unseen" (line 310).
  — [site/index.html:96, 133, 310, 357, 472](file:///C:/dev/huntapp/site/index.html)
- **Repeated paragraph shape:** the homepage has 12 mono dot-tags, 9 "How it works" disclosures, 9 mono readout lines and 12 phone frames. Nine rows follow the same order: tag, two-beat caps H2, one paragraph, mono readout, "How it works", phone loop. The rows alternate sides (.row / .row.flip), the standard SaaS zigzag. — [site/index.html:148-388](file:///C:/dev/huntapp/site/index.html); [site/site.css:215](file:///C:/dev/huntapp/site/site.css)
- **Calm, hedged register, repeated:**
  - the footer line ("The wind at your head is a model, so keep checking it yourself. That's what the checks are for.") on all five pages
  - "It's a model, and every model is wrong somewhere."
  - the thermals article: "Every rule here, and every model, is a guess until you check it."
  — [site/index.html:480, 509](file:///C:/dev/huntapp/site/index.html); [site/hunting-thermals.html:173](file:///C:/dev/huntapp/site/hunting-thermals.html)
- **Tidy, slightly literary idioms:** "the scoring tells you in so many words", "every which way" and "far inside the forecast's own error". — [site/index.html:213, 376, 170](file:///C:/dev/huntapp/site/index.html)
- **The same CTA block on every article:** a mono "Groundwind" tag, an H2 ("See the thermals on your own ground." / "Follow him as he talks." / "Where they'll be, hour by hour."), one "Groundwind is a hunting app that…" paragraph, then "Open the beta" and "Request your spot". — [site/hunting-thermals.html:177-181](file:///C:/dev/huntapp/site/hunting-thermals.html); [site/moose-weather.html:123-130](file:///C:/dev/huntapp/site/moose-weather.html)

**Design tells, checked against the list given**
- **Cream background:** not the default, but present. Any visitor whose phone or OS is in light mode gets #f3f0e7 cream with an olive accent (#5a6b3e) and burnt-orange scent (#b9561a), because the light theme is keyed to `prefers-color-scheme`. — [site/site.css:28-47](file:///C:/dev/huntapp/site/site.css)
- **Serif display face:** absent. The display face is a condensed sans (Sofia Sans Extra Condensed). — [site/site.css:21](file:///C:/dev/huntapp/site/site.css)
- **Clay accent:** not on the dark site. The light-mode scent #b9561a reads as clay, and the app's warning colour is literally "clay" (#e2845a). — [site/site.css:41](file:///C:/dev/huntapp/site/site.css); [app/src/theme.css:42-43](file:///C:/dev/huntapp/app/src/theme.css)
- **Rounded cards:** moderate. Buttons and chips are pills; cards are 10px and 18px. The 3-up "Also in the beta" grid of h3 plus one line is the generic three-features block. — [site/site.css:124, 204, 275](file:///C:/dev/huntapp/site/site.css); [site/index.html:390-406](file:///C:/dev/huntapp/site/index.html)
- **Hairlines:** heavy, with 21 section and row hairline borders. — [site/site.css](file:///C:/dev/huntapp/site/site.css)
- **Eyebrow labels:** heavy. There are 12 mono uppercase tags with coloured dots and 1 eyebrow on the homepage, a mono eyebrow on every article ("Field notes · Hunting thermals"), and "Beta" and "Notes" pills in the header. — [site/index.html](file:///C:/dev/huntapp/site/index.html); [site/hunting-thermals.html](file:///C:/dev/huntapp/site/hunting-thermals.html)

### Inferences
- The house style is recognisable as one writer's: colon-led clauses, "X, not Y", two-beat headlines and quiet hedges. That writer is Claude across the code comments, docs and site, and the app's code comments use the same cadence ("Only offers: the phone is glanced at and pocketed…", AreaOffer.tsx:31-33). A reader who has seen other Claude-written landing pages in 2026 will likely feel the rhythm even with the em dashes gone.
- The worst offenders are the H2s that Claude reshaped. "A wind model, not an arrow." and "Not an app for everywhere. Built for your spot." are aphorisms that could sit on any product's page. Lines with a place or a number ("What's the wind doing over that bluff?", "Up a tree, your scent lands further out.") could not.
- The nine-row template is the biggest design tell. A competitor's site built with the same tools would have the same skeleton.

### Gaps
- No automated tell-scoring tool was run. The counts are greps and hand reading of six pages.
- No reader testing exists, so it is not known whether hunters perceive this as AI-written.

## 4. Which parts could only have come from this founder and this place, and which are under-used?

### Takeaway
The truly uncopyable material is real: a named camp (Pickle Lake near White River, WMU 21B), a bull that circled downwind on 27 Sept 2026, a bog slot where the model was 65° out and was fixed, real dated loops, a working satellite text bot, and a field guide written "for how we hunt here". The site uses it only as captions and one third-person paragraph in an article. Gavan is never named, there are no photographs, and the best proof stories are missing.

### Cited Findings
**Already on the site and distinctive**
- Dated, placed captions:
  - "Pickle Lake, Mon 28 Sept, 2 pm / The lake breeze, as the app drew it" — [site/index.html:116](file:///C:/dev/huntapp/site/index.html)
  - "Highland Lake in the Yukon, Monday 5 October, 5 pm, 17 km/h from the south" — [site/index.html:384](file:///C:/dev/huntapp/site/index.html)
  - "Pickle Lake: Near White River, ON · WMU 21B" and "Lac Bailey: Québec · zone 18" — [site/index.html:412-413](file:///C:/dev/huntapp/site/index.html)
- The near miss, told in the third person in paragraph 2 of an article: "It's what happened at our camp near White River on 27 September 2026. Through two and a half hours of cow calls a bull grunted on and off and drew the hunter off the calling spot toward him. When a last cow call set him going, he ran to get downwind." — [site/moose-calling-wind.html:76](file:///C:/dev/huntapp/site/moose-calling-wind.html)
- In memory, the hunter is Gavan, "archery, in thick woods… caught flat-footed and ran out of room", and the night's hunting mode was built from this. — [memory: huntapp-hunting-mode.md](file:///C:/Users/gavan/.claude/projects/c--dev-huntapp/memory/huntapp-hunting-mode.md)
- The camp inversion: "One clear evening in late September at our camp near White River, the forecast had 13 km/h at 80 m and 5 at 10 m. By midnight the air at head height was 2 °C colder than the air above it…" — [site/hunting-thermals.html:76](file:///C:/dev/huntapp/site/hunting-thermals.html)
- Hunting-camp vernacular:
  - "No bars", "Puff your powder", "Move them until neither of you is on the way he'll come in"
  - "The old rule still holds: put the caller 40 to 50 m upwind of the shooter, so a bull circling downwind of the calls walks into the shooter."
  - "Our working numbers: full range under 10 km/h…"
  — [site/index.html:72, 329, 333](file:///C:/dev/huntapp/site/index.html); [site/moose-calling-wind.html:131](file:///C:/dev/huntapp/site/moose-calling-wind.html)
- The guide H1, "From the kitchen table to the bull." — [site/guide.html:55](file:///C:/dev/huntapp/site/guide.html)
- The app's own lines, quoted on the site:
  - "warm spell, day 3: bedded through the heat, moving at night" — [site/index.html:276-277](file:///C:/dev/huntapp/site/index.html)
  - "Bull NNE 300 m · 12 min · swings SE" and "Wind at your back coming in: your scent gets there first" — [site/guide.html:302, 259](file:///C:/dev/huntapp/site/guide.html)
  - "GW1 48.926 -85.599 48" — [site/guide.html:183](file:///C:/dev/huntapp/site/guide.html)
  - "1's scent drifts over you" — [site/index.html:333](file:///C:/dev/huntapp/site/index.html)
- Technical moat stated plainly: WindNinja ("the US Forest Service's wind model for wildfire, in 16 directions"), HRDPS 48 h in "one 160-character text", 1 m LiDAR, Ontario FRI and Québec MRNF data. — [site/index.html:121, 167, 384, 510](file:///C:/dev/huntapp/site/index.html)
- Primary-source lists at the foot of each article, for example "Renecker and Hudson 1986: heat stress in moose", "Pypker 2007" and "Crosman and Horel 2010". — [site/moose-weather.html](file:///C:/dev/huntapp/site/moose-weather.html); [site/hunting-thermals.html](file:///C:/dev/huntapp/site/hunting-thermals.html)
- The mark, a dot (you) and a wedge (your scent cone), is the product's core idea drawn in 24 px. — [site/icon.svg](file:///C:/dev/huntapp/site/icon.svg)

**Under-used or absent**
- **The founder is invisible.** Bylines are "Groundwind · 5 October 2026". The site never says who builds it, that it is one hunter in Ontario, or that the camp is his. The only "we" is the build team ("We build it"). — [site/hunting-thermals.html](file:///C:/dev/huntapp/site/hunting-thermals.html); [site/index.html:142](file:///C:/dev/huntapp/site/index.html)
- **The bog-slot correction is the best proof story, and it is not on the site.**
  - On 2026-09-29 at a 60 m slot between 14 m tree walls, 80 m off Pickle Lake, HRDPS said from 191° at 17 km/h gusting to 44.
  - Gavan felt the wind "lots of, to the 306".
  - The old model said toward N at 2 km/h ("about 65° out"). The new slot rule says 4.8 km/h toward 288° ("18° out").
  - The doc is honest about the limits: "One evening, one cell: that is all the validation there is."
  — [docs/MICRO-WIND.md:323-333](file:///C:/dev/huntapp/docs/MICRO-WIND.md); [memory: huntapp-field-notes-2026-09-29.md](file:///C:/Users/gavan/.claude/projects/c--dev-huntapp/memory/huntapp-field-notes-2026-09-29.md)
- **The origin story is not on the site.** "Why it exists (Gavan, 2026-09-25): in a bog at dusk the wind 'wasn't in the direction of the forecast, it had calmed down, felt the down draft was the cause'." — [docs/MICRO-WIND.md:12-14](file:///C:/dev/huntapp/docs/MICRO-WIND.md)
- **No real check statistics.** The site promises "the hunt log keeps score of how often the forecast and the model matched what you felt", but it shows no tallies from the founder's own checks. Memory records "~60 checks" and "tons" that have not been uploaded. — [site/index.html:480](file:///C:/dev/huntapp/site/index.html); [memory: huntapp-field-data.md](file:///C:/Users/gavan/.claude/projects/c--dev-huntapp/memory/huntapp-field-data.md); [memory: huntapp-wind-learning-vision.md](file:///C:/Users/gavan/.claude/projects/c--dev-huntapp/memory/huntapp-wind-learning-vision.md)
- **HuntOS, "how we hunt here", is in the app but not on the site.** It has [us] tags for lines learned on the founder's own hunts, and camp-voice passages such as:
  - "The app is one phone; the hunt is the party."
  - "Up at 4:30 on a sit morning, boat by 5, in place by first light. Back for a late breakfast. Out again at 3. Supper after dark, the plan, bed. The week is won on the mornings nobody wanted to get up for."
  — [docs/HUNTOS.md:1-12, 295-328](file:///C:/dev/huntapp/docs/HUNTOS.md)
- **The satellite feature is buried.** Gavan "calls it the closer: lead with it when selling", but it sits fifth among the feature rows. — [memory: huntapp-sat-forecast.md](file:///C:/Users/gavan/.claude/projects/c--dev-huntapp/memory/huntapp-sat-forecast.md); [site/index.html:162-174](file:///C:/dev/huntapp/site/index.html)
- **The made-to-order origin.** Lac Bailey is "a friend's moose spot, sent from a Garmin inReach on 2026-10-03". In it, 74% of the ground within 3 km is "the 1991 burn, birch and jack pine". The site shows the result but not the story. — [docs/AREAS.md:12-14, 484-489](file:///C:/dev/huntapp/docs/AREAS.md)
- **Local history:** the 1978-79 MNR survey sheets for Pickle, Ketchup and McGill lakes are fitted to the shoreline in the app. — [README.md](file:///C:/dev/huntapp/README.md)
- **No photographs** of the camp, bush, powder bottle, bog strip or a bull: site/img/ is empty. — [site/img/](file:///C:/dev/huntapp/site/img/)

### Inferences
- Most of what is distinctive lives in docs/ and memory, not on the site. The site states the claim ("Every forecast is off where you sit") but leaves out the evidence that only Groundwind has: the felt-vs-forecast-vs-model triple at a named spot on a named evening.
- Telling the near miss in the first person, as "I", with the founder named, would be hard for any competitor or AI-written page to copy, because it has to be true.
- Honest limits ("One evening, one cell") are themselves distinctive if surfaced. They match the site's "it's a model" stance but make it concrete.

### Gaps
- No photos or video from the hunts exist in the repo or the field-data folder, so it is unknown whether Gavan has any on his phone.
- The founder's ~60 wind checks have not been exported. Accuracy numbers (agreed, close and missed) cannot be quoted yet.

## 5. How does "Pic River" in the app vs "Groundwind" on the site affect brand coherence?

### Takeaway
It breaks at the handoff. Every "Open the beta" click leaves groundwind.app for a page titled "Pic River — hunt & fish maps", with a "Pic River / White Lake · Manitouwadge" splash, a compass-and-sonar icon and the system font. The site promises "No app store and no account", so that home-screen icon and name are the brand people live with, and today they say Pic River.

### Cited Findings
- `/app` returns a 302 to https://gavanacton.github.io/huntapp/, whose live title on 2026-10-06 is "Pic River — hunt & fish maps". The URL also exposes the developer's personal GitHub handle. — live curl of [groundwind.app/app](https://groundwind.app/app); [memory: huntapp-monetization.md](file:///C:/Users/gavan/.claude/projects/c--dev-huntapp/memory/huntapp-monetization.md)
- In app/index.html:
  - `apple-mobile-web-app-title` "Pic River" (line 12)
  - `<title>Pic River — hunt & fish maps</title>` (line 19)
  - splash `<b>Pic River</b><span>White Lake · Manitouwadge</span>` (line 78)
  - an area manifest replaces the title with the area's name ("— hunt maps"), so a Lac Bailey install says neither name
  — [app/index.html:12, 19, 66-67, 78](file:///C:/dev/huntapp/app/index.html)
- The PWA manifest:
  - `name: 'Pic River — hunt & fish maps'`, `short_name: 'Pic River'`
  - description "Offline topo, LiDAR, forest cover, lake depths, historical maps and weather for White Lake and the Pic River country"
  - the description pitches lake depths and historical maps, not wind or scent
  — [app/vite.config.ts:181-183](file:///C:/dev/huntapp/app/vite.config.ts)
- Exported GPX files carry `creator="Pic River"`, and the README is titled "# Pic River — hunt & fish maps". — [app/src/tracking/trackStore.ts:304](file:///C:/dev/huntapp/app/src/tracking/trackStore.ts); [README.md:1](file:///C:/dev/huntapp/README.md)
- Meanwhile, app strings say Groundwind: "The Groundwind number is not set up yet…" and "That reply is from a newer Groundwind. Update the app with signal." — [app/src/ui/sheets/SatSheet.tsx:121](file:///C:/dev/huntapp/app/src/ui/sheets/SatSheet.tsx); [app/src/weather/satForecast.ts:115](file:///C:/dev/huntapp/app/src/weather/satForecast.ts)
- A third name lives inside the app: the field guide is "HuntOS · how we hunt here". — [docs/HUNTOS.md:1](file:///C:/dev/huntapp/docs/HUNTOS.md); [memory: huntapp-field-notes-2026-09-30.md](file:///C:/Users/gavan/.claude/projects/c--dev-huntapp/memory/huntapp-field-notes-2026-09-30.md)
- The app icon (compass needle, cyan ellipse, green arcs) is not the site's dot-and-cone. — [app/public/icons/icon-192.png](file:///C:/dev/huntapp/app/public/icons/icon-192.png); [site/apple-touch-icon.png](file:///C:/dev/huntapp/site/apple-touch-icon.png)
- Name history and risks:
  - "Downwind" was proposed for the app on 2026-09-30, with Groundwind as the engine name. The switch came on 2026-10-04 after Gavan said "groundwind.app is available".
  - Risks flagged then: "ground wind" is "an existing sailing/aviation term, so the mark could be refused as descriptive"; @groundwind is taken (hence @groundwindapp); groundwind.com belongs to a web-design shop running since 2002; CIPO was not checked.
  — [memory: huntapp-name-and-competitors.md](file:///C:/Users/gavan/.claude/projects/c--dev-huntapp/memory/huntapp-name-and-competitors.md)
- Search: "groundwind" is close to "ground wind", so Google may correct it at first. — [memory: huntapp-seo.md](file:///C:/Users/gavan/.claude/projects/c--dev-huntapp/memory/huntapp-seo.md)

### Inferences
- A first-time user who installs from the site ends up with a home-screen icon named "Pic River" (or "Pickle Lake"/"Lac Bailey") with a boat-app-style icon. They will not connect it to Groundwind when telling a hunting buddy. That weakens the word-of-mouth loop the plan depends on ("Mat's buddy is the referral loop").
- "Pic River" is itself a real, local place name (the Pic River country north of Lake Superior). It is authentic, but it ties the app to one region, which conflicts with "Request your spot" anywhere in Canada.
- Three names (Groundwind, Pic River, HuntOS) plus a fourth proposed one (Downwind) suggest the brand has not been locked yet. That is the cheapest time to fix it.

### Gaps
- It was not checked what the iPhone home-screen label actually shows after install for each area. That would need a device test.
- No trademark search was done in this audit.

## 6. How does Gavan's own voice differ from the site's voice?

### Takeaway
Gavan writes like a hunter texting from camp: short, lowercase, run-on, concrete, bearings as numbers, slang. The site writes like a careful field manual: full sentences, colon-led, balanced and hedged. The site's best lines are his, or are close restatements of his ("No bars? Doesn't matter…", "What's the wind doing over that bluff?", "Sharpen"). Its most generic lines are Claude's reshapings of his ideas into aphorisms.

### Cited Findings
**Gavan's verbatim phrases (from memory notes and docs)**
- On the forecast: "The forecast isn't what you have" — [memory: huntapp-monetization.md](file:///C:/Users/gavan/.claude/projects/c--dev-huntapp/memory/huntapp-monetization.md)
- On hunting on the move: "What's the wind doing over the bluff, around this corner, will I be able to see" — [memory: huntapp-monetization.md](file:///C:/Users/gavan/.claude/projects/c--dev-huntapp/memory/huntapp-monetization.md)
- On made to order: "not an app you can run anywhere and everywhere. High quality means being deliberate, you request specific spots, we custom build it for you." — [memory: huntapp-monetization.md](file:///C:/Users/gavan/.claude/projects/c--dev-huntapp/memory/huntapp-monetization.md)
- On pricing: "it's Quick and HD. You pay for HD packs for an area. You pay for txt weather - some bundles" and "live mode plus sd plus hd" — [memory: huntapp-monetization.md](file:///C:/Users/gavan/.claude/projects/c--dev-huntapp/memory/huntapp-monetization.md); [docs/AREAS.md:309](file:///C:/dev/huntapp/docs/AREAS.md)
- The satellite headline: "No bars? Doesn't matter. The HD forecast comes by text." The memory records this as "Gavan's words", and he calls it "the closer". — [memory: huntapp-sat-forecast.md](file:///C:/Users/gavan/.claude/projects/c--dev-huntapp/memory/huntapp-sat-forecast.md)
- The origin, from the bog at dusk: "wasn't in the direction of the forecast, it had calmed down, felt the down draft was the cause" — [docs/MICRO-WIND.md:12-14](file:///C:/dev/huntapp/docs/MICRO-WIND.md)
- From the slot on 09-29: "lots of, to the 306" — [docs/MICRO-WIND.md:329](file:///C:/dev/huntapp/docs/MICRO-WIND.md)
- From the field, on gusts: "big breezy blows, then it dies down" — [memory: huntapp-gust-lull.md](file:///C:/Users/gavan/.claude/projects/c--dev-huntapp/memory/huntapp-gust-lull.md)
- How he uses the phone in the field: "take it out, check the situation, put it away" — [memory: huntapp-hunting-mode.md](file:///C:/Users/gavan/.claude/projects/c--dev-huntapp/memory/huntapp-hunting-mode.md)
- "I might be turning it on and off as I'm hunting, viewing the different layers, even planning tomorrow's hunt as I'm bored in the woods." — [memory: huntapp-hunt-stages.md](file:///C:/Users/gavan/.claude/projects/c--dev-huntapp/memory/huntapp-hunt-stages.md)
- On the compass: "I can't use the orientation of the phone" (and the earlier "dial freaks out") — [memory: huntapp-field-notes-2026-09-29.md](file:///C:/Users/gavan/.claude/projects/c--dev-huntapp/memory/huntapp-field-notes-2026-09-29.md)
- On naming "Sharpen": "aspirational, something that says you're making it better". He rejected "Tune". — [memory: huntapp-field-notes-2026-09-30.md](file:///C:/Users/gavan/.claude/projects/c--dev-huntapp/memory/huntapp-field-notes-2026-09-30.md)
- Also: "I don't want weather → nothing; I want weather → all there" and, on party checks, "data size wins, tell them". — [memory: huntapp-field-notes-2026-09-30.md](file:///C:/Users/gavan/.claude/projects/c--dev-huntapp/memory/huntapp-field-notes-2026-09-30.md)
- On the palette: "I hate the yellow tones" — [memory: huntapp-chrome-theme.md](file:///C:/Users/gavan/.claude/projects/c--dev-huntapp/memory/huntapp-chrome-theme.md)
- On the Yukon screenshot: a "solid example of how the wind curls around in the mountains". On the lake-breeze loop: "super impressive". — [memory: huntapp-lee-eddy-showcase.md](file:///C:/Users/gavan/.claude/projects/c--dev-huntapp/memory/huntapp-lee-eddy-showcase.md); [memory: huntapp-monetization.md](file:///C:/Users/gavan/.claude/projects/c--dev-huntapp/memory/huntapp-monetization.md)
- On the first loops: "wind movement not at all like it is in app (FPS is low)". His copy steer: "say the wind modelling is hardcore, not 'the map turns'" (recorded as a steer, possibly paraphrased). — [memory: huntapp-site-loops.md](file:///C:/Users/gavan/.claude/projects/c--dev-huntapp/memory/huntapp-site-loops.md); [memory: huntapp-monetization.md](file:///C:/Users/gavan/.claude/projects/c--dev-huntapp/memory/huntapp-monetization.md)
- Product principle: "Only present the level information needed. Brief by default with the ability to dig in." — memory, progressive-disclosure note (quoted via grep of [memory/](file:///C:/Users/gavan/.claude/projects/c--dev-huntapp/memory/))
- The founder's stated worry, from this research brief: "if everyone looks and sounds like Claude, we won't stand out."

**Site counterparts**
- The site's version of the bluff line: "What's the wind doing over that bluff?" — [site/index.html:356](file:///C:/dev/huntapp/site/index.html)
- The site's version of made to order: "Not an app for everywhere. Built for your spot." and "So we don't fake it everywhere. You send us your spot, and we build it." — [site/index.html:132-133](file:///C:/dev/huntapp/site/index.html)
- The site's version of the forecast line: "The forecast is a guess. Sharpen it." and "Every forecast is off where you sit." — [site/index.html:71, 94](file:///C:/dev/huntapp/site/index.html)
- His word "hardcore" does not appear. The site says "runs a real wind model" and "WindNinja's full 3D flow solve". — [site/index.html:72, 121](file:///C:/dev/huntapp/site/index.html)

### Inferences
- Where the site kept his phrasing (the bluff question, "No bars? Doesn't matter."), the line has texture and a speaker. Where Claude compressed his idea into a balanced contrast ("A wind model, not an arrow."; "Not an app for everywhere. Built for your spot."), it lost the speaker and gained the tell.
- Gavan's voice has things the site lacks: numbers as a hunter says them ("to the 306"), admitted feelings ("felt the down draft"), boredom and humour ("bored in the woods"), bluntness ("I hate the yellow tones"), and the first person. These are the raw ingredients of a voice that would not read as AI-written.
- The risk on the other side: his raw voice is loose (typos, run-ons). A brand voice built on it needs a light edit that keeps the bluntness and the specifics, not a polish that brings back the colon-and-contrast cadence.

### Gaps
- Memory holds paraphrases as well as quotes. Only text in quotation marks attributed to Gavan is treated as verbatim here. Some quoted fragments may have been lightly normalised when the notes were written.
- No long-form writing by Gavan (an email, a post, a field journal) was found to calibrate a full voice.

## 7. What raw material is available for a stronger brand?

### Takeaway
There is plenty of authentic material:
- three named, real areas with dated weather
- a near-miss bull story
- a measured model miss and fix
- four logged heard bulls with the model's scores
- about 60 unexported wind checks
- a field guide in camp voice
- 4,700 lines of sourced science docs
- 20 real app loops

What is missing is photography and the founder's face and name.

### Cited Findings
**Field data**
- The folder is not at C:/dev/field-data (that path does not exist). It is at C:/Users/gavan/.claude/projects/c--dev-huntapp/field-data/, and it holds one file, hunt-log-2026-10-04.csv: a header plus 4 rows.
- All four rows are heard bull moose: two on 27 Sep, one on 29 Sep (bearing 180°, 400 m) and one on 1 Oct.
- The rows record temperature 10.7–19.7 °C, wind 8–10 km/h, model score 0.000–0.403, model percentile 0–0.926 and day activity 0.105–0.680.
- Positions are in the file and are not reproduced here.
- Two notable values: one 27 Sep bull was heard where the model scored 0.000, at 19.7 °C with a day activity of 0.128. The 1 Oct bull sat at the 93rd percentile.
— [field-data/hunt-log-2026-10-04.csv](file:///C:/Users/gavan/.claude/projects/c--dev-huntapp/field-data/hunt-log-2026-10-04.csv); [memory: huntapp-field-data.md](file:///C:/Users/gavan/.claude/projects/c--dev-huntapp/memory/huntapp-field-data.md)
- Wind checks: "~60 checks" on Gavan's phone, needing a re-export with the fixed CSV. Memory also says "tons" not uploaded. — [memory: huntapp-field-data.md](file:///C:/Users/gavan/.claude/projects/c--dev-huntapp/memory/huntapp-field-data.md); [memory: huntapp-wind-learning-vision.md](file:///C:/Users/gavan/.claude/projects/c--dev-huntapp/memory/huntapp-wind-learning-vision.md)

**Places**
- The camp on Pickle, McGill and Ketchup lakes, "~25 km north of Pic Mobert / White Lake, ~25 km south-east of Manitouwadge", in WMU 21B, FMZ 7 and FMU 060 White River Forest. Camp has "internet only morning and night". — [memory: huntapp-region-and-sources.md](file:///C:/Users/gavan/.claude/projects/c--dev-huntapp/memory/huntapp-region-and-sources.md)
- The bog strip slot 80 m off Pickle Lake. — [docs/MICRO-WIND.md:323-333](file:///C:/dev/huntapp/docs/MICRO-WIND.md)
- Lac Bailey, Québec: zone 18, on the 1991 burn, a friend's spot sent by inReach. — [docs/AREAS.md:484-489](file:///C:/dev/huntapp/docs/AREAS.md)
- Highland Lake, Yukon: a 1700 m summit with lee eddies, from a screenshot Gavan sent. — [docs/AREAS.md:527](file:///C:/dev/huntapp/docs/AREAS.md); [site/index.html:384-387](file:///C:/dev/huntapp/site/index.html)
- A fourth test area exists near the founder's home and is flagged never to commit or deploy without asking. It is not brand material. — [memory: MEMORY.md index](file:///C:/Users/gavan/.claude/projects/c--dev-huntapp/memory/MEMORY.md)

**Field notes and stories**
- The 27 Sep near miss and the hunting mode built that night. — [memory: huntapp-hunting-mode.md](file:///C:/Users/gavan/.claude/projects/c--dev-huntapp/memory/huntapp-hunting-mode.md)
- The 29 Sep slot check, and the compass that "freaks out" with the phone held up. — [memory: huntapp-field-notes-2026-09-29.md](file:///C:/Users/gavan/.claude/projects/c--dev-huntapp/memory/huntapp-field-notes-2026-09-29.md)
- Gavan's dad brushing the screen, which led to the two-tap popup rule. — [memory: huntapp-field-notes-2026-09-29.md](file:///C:/Users/gavan/.claude/projects/c--dev-huntapp/memory/huntapp-field-notes-2026-09-29.md)
- The 09-30 note dump: "Sharpen", the hot-button layout. — [memory: huntapp-field-notes-2026-09-30.md](file:///C:/Users/gavan/.claude/projects/c--dev-huntapp/memory/huntapp-field-notes-2026-09-30.md)

**Science and craft docs (4,734 lines in docs/*.md)**
- HUNT-FISH-SCIENCE.md (511 lines; evidence tags [S], [G] and [H]; "Compiled 2026-09-25 for the camp on Pickle Lake")
- MICRO-WIND.md (719 lines; the six-layer ground wind, with a "Limits" section)
- MICRO-WIND-LIDAR.md (596)
- AREAS.md (650; Live, SD and HD)
- SAT-FORECAST.md (181; "Weather by satellite: the newest forecast with no signal")
- HUNTOS.md (355; "how we hunt here", [us] tags)
- ROUTES.md (227), ELK-SCIENCE.md (1100), DATA-SOURCES.md (160) and ANALYTICS.md (235)
— [docs/](file:///C:/dev/huntapp/docs/)

**Video and stills**
- 20 MP4 loops and their posters, all real app captures over real terrain, some with historical weather for the date shown. Four guide loops (setup, holds, log, layers) are "still the old keyframe style". — [site/media/](file:///C:/dev/huntapp/site/media/); [memory: huntapp-site-loops.md](file:///C:/Users/gavan/.claude/projects/c--dev-huntapp/memory/huntapp-site-loops.md)

**Historical maps**
- The MNR lake survey sheets for Pickle (1978), Ketchup (1978) and McGill (1979), fitted to the shoreline (misses of 13, 19 and 8 m). — [README.md](file:///C:/dev/huntapp/README.md)

**Photographs**
- None in the repo: site/img/ is empty, and the field-data folder holds only the CSV. — [site/img/](file:///C:/dev/huntapp/site/img/)

### Inferences
- The strongest unused proof asset is a felt-vs-forecast-vs-model scorecard from Gavan's own ~60 checks at Pickle Lake. The app already computes it ("agreed 0, close 1, missed 0 this season"), so it needs only an export.
- The heard-bull log includes a case where the model scored a bull's spot at zero on a warm day. Published candidly, it would match the site's "every model is wrong somewhere" stance and would be impossible to fake.
- Camp photography (the powder puff, the bog strip, the tree walls, the boat at 5 am, the inReach) would fill the biggest visual gap. Today every image is a screen, which is part of why the site reads as a software product, not a hunting camp.

### Gaps
- Whether Gavan has photos, voice memos or video from the 2026 hunts is unknown. None were found locally.
- The wind-check export, and so any accuracy figures, does not exist yet.
- Permission to name the friend at Lac Bailey ("Mat's buddy" in the memory notes) or to show Gavan's family has not been asked for.
