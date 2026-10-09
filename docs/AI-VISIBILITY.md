# Getting named when someone asks an AI for hunting apps

2026-10-09. When someone asks ChatGPT, Claude, Perplexity or Gemini for "the best hunting apps", it searches the web, reads the top roundups and Reddit threads, and names the apps that keep coming up. What the model learned in training lags by months. So the work is mostly getting Groundwind named in the pages those searches find, and aiming at the questions we can win ("best app for hunting wind", "scent cone app", "app for thermals") rather than "best hunting app", where onX, HuntStand and HuntWise will be named for a long time.

## On the site

- AI crawlers are already let in. robots.txt only blocks /api/ and /stats, and GPTBot, OAI-SearchBot, ClaudeBot, Claude-SearchBot and PerplexityBot all get the pages.
- The pages are plain HTML, so crawlers that don't run JavaScript read everything, closed `<details>` included.
- `site/llms.txt` gives a plain summary: what it is, cost, phones, where, what it does, beside other apps, pages, data.
- The homepage's structured data now describes the app (`WebApplication`: free in the beta, iOS and Android in the browser, a feature list). It has no rating on purpose: we don't have real ones.
- Three new homepage questions, each answer standing on its own when quoted: What is Groundwind? How is it different from onX, HuntWise or Windy? What's a scent cone?
- /compare (another session) is the page for "best hunting wind app".
- Visits from AI answers show on /stats, Site tab: visit.js keeps the referrer and `utm_source`, and ChatGPT adds `utm_source=chatgpt.com` to its links.

## Dashboards (Gavan's)

1. **Bing Webmaster Tools.** ChatGPT search and Copilot lean largely on Bing. Sign in, choose import from Google Search Console, and the site and sitemap come over.
2. **Cloudflare, Caching, Crawler Hints:** on since 2026-10-09. It may not fire for pages a Worker serves, so the Worker also pings IndexNow itself: once an hour it hashes the sitemap's pages and sends the ones that changed or left (site/indexnow.js, the `indexnow` table in schema.sql, the key at /9ce481267d778256561352784d78cd1f.txt).
3. **Cloudflare, AI Crawl Control.** Check nothing is set to block the search and assistant bots. It also shows which AI bots come and how often.

## Where the answers come from

A search on 2026-10-09 for these questions turned up:

| Question | What comes up |
|---|---|
| best hunting apps 2026 | [Hook & Barrel, hunting and fishing apps 2026](https://www.hookandbarrel.com/gear/hunting-and-fishing-apps-2026); [Petersen's Hunting, best smartphone apps for hunters](https://www.petersenshunting.com/editorial/best-smartphone-apps-for-hunters/537716); [Let's Go Hunting, top-rated mobile apps for hunters in 2025](https://www.letsgohunting.org/resources/articles/big-game/hunt-smarter-top-rated-mobile-apps-for-hunters-in-2025) |
| best hunting wind app scent cone | Vendor pages only: HuntWise WindCast, and old Mossy Oak pages for ScoutLook, which merged into HuntStand in 2019 and is gone. The live scent cones are HuntStand's HuntZone and HuntWise's WindCast. Nobody independent has compared wind apps, which is the gap /compare fills. |
| best apps for moose hunting Canada | Moose-call apps, iHunter, BC Moose Tracker. No Canadian moose roundup. |
| best app for wind direction and thermals | The Let's Go Hunting roundup again: Windy, onX, HuntWise |

Who to pitch, in order:

1. **Let's Go Hunting.** Their 2025 roundup is due a 2026 update, and its Windy blurb is about "how wind flows through ridgelines", which is exactly our claim.
2. **Hook & Barrel** and **Petersen's Hunting**: the two big 2026 roundups.
3. **Canadian outlets with no moose-app roundup yet:** Ontario OUT of DOORS (OFAH) and Outdoor Canada. Not yet checked for an existing app piece.
4. **The wind-app gap:** pitch any of the above a "hunting wind apps compared" piece, with /compare as the background.

## The pitch

Send it to the writer named on the roundup, not a general inbox. Change the first line for each one.

> **Subject:** A wind app for your hunting-apps roundup
>
> Hi [name],
>
> I read your [article], and [one line about something specific in it].
>
> I'm Gavan. I hunt moose out of a camp near White River, Ontario, and I built Groundwind (groundwind.app). It's meant to be your active hunt partner on the spot you're hunting, beside onX and Windy rather than instead of them. It takes the 2.5 km HD forecast down to head height over 1 m LiDAR terrain and the trees, so the scent cone bends round the ridge, drains downhill at dusk and slows in the spruce. A puff of powder at your stand corrects it.
>
> It's free in the beta, runs on iPhone and Android, and works with no signal. Tell me where you hunt and I'll build your spot, so you can try it on ground you know. Clips of it on real ground are at groundwind.app.
>
> Happy to answer anything.
>
> Gavan
> Groundwind · hello@groundwind.app

## Reddit and forums

AI answers quote r/Hunting, r/moosehunting, r/Elkhunting, r/bowhunting, Rokslide and Archery Talk. Answer wind and thermals questions there with something useful first, say you made the app whenever you mention it, and keep to each subreddit's self-promotion rules. One honest thread that gets upvoted is worth more than ten posts.

Also list Groundwind on AlternativeTo as an alternative to onX Hunt, HuntWise and HuntStand.

## The app stores

AI "best apps" lists almost always name apps you can download from a store, and store pages get crawled too. The Capacitor wrap (see the app store plan) is the biggest single step after being named in the roundups.

## Checking it, monthly

Ask these in ChatGPT (with search), Claude, Perplexity, Gemini and Copilot, and note whether Groundwind is named and whether what's said about it is right:

1. What are the best hunting apps?
2. What's the best app for hunting wind and scent?
3. Is there a hunting app that shows thermals?
4. What are the best apps for moose hunting in Canada?
5. What is Groundwind? (checks the description is right)

Then look at /stats, Site tab, for visits from chatgpt.com, perplexity.ai, claude.ai, gemini.google.com and copilot.microsoft.com.
