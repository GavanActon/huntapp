# Usage stats: who uses the app, and what they use

Which parts of the app get used, by how many phones, how often and for how
long; and what visitors to the site see and do ([The site](#the-site)).
The data is ours, in our own D1 database: raw events you can query with
SQL, pull as CSV, or read on a dashboard at groundwind.app/stats.

Built 2026-10-05. Tested end to end against a local Worker. Going live
takes a schema push, a secret and two deploys: see [Going live](#going-live).

## How it works

```
phone (app/src/analytics.ts, stats/watch.ts)
  └─ events queue in localStorage (up to 1,500, survives a week offline)
       └─ POST /api/events, a batch of up to 100, text/plain, keepalive
            └─ groundwind.app Worker (site/stats.js) → D1 groundwind.events
                 ├─ GET /api/stats   (dashboard: groundwind.app/stats)
                 └─ GET /api/export  (every row as CSV)
```

- **A phone** is an install: a random 16-hex id made once
  (`huntapp-install`, shared with the dev log). On iOS the home-screen app
  and Safari keep separate storage, so one person who uses both counts as
  two phones; `launch.standalone` tells them apart. Clearing site data
  makes a new phone.
- **A session** is a run of use with no 30-minute gap (the GA
  definition). A sit with the phone pulled out every few minutes is one
  session; morning and evening are two.
- **Sending**: every 30 s while the app is in front, at once when the
  queue reaches 30, and when the phone is put away (hidden, with
  `keepalive`). No signal: the queue waits, and the retry backs off from
  15 s to 5 min. A batch sent twice (the answer lost on a weak signal) is
  stored once, because `(install, seq)` is unique.
- **Time**: each event carries the phone's clock; the batch carries the
  phone's "now", and the Worker moves every event by the difference, so a
  phone with its clock off still lands on the right day. `received - ts`
  is how long an event waited on the phone.
- **Not sent**: from a dev server (the console shows `[stats] …` instead)
  unless `VITE_EVENTS_API` is set, and never from a browser driven by a
  script (`navigator.webdriver`: the site's video loops, the screenshot
  scripts).

## Privacy

- Never a position, a pin's name, a note, a track, initials or anything
  typed. A button's label is scrubbed before it goes. Every name you gave
  something (pins, views, tracks, initials, log and check notes) is
  replaced with `[name]`, numbers become `#`, and labels are cut at 40
  characters. The map's zoom is sent, the centre is not.
- The coarse "where" is the area id the app runs in, the phone's time
  zone, and Cloudflare's country for the upload.
- **On by default, off in Settings → Sharing → Usage stats.** Off clears
  the queue and sends nothing, not even the fact it was switched off. The
  row shows the phone's id (first 8 hex) while on.
- The site's FAQ ("What happens to my data?") says this, 2026-10-05.
- The wind checks are not usage stats: they hold a position, so they are
  asked for apart and go apart. See [Wind checks](#wind-checks).

## The events

Every event row has `install`, `session`, `seq`, `ts`, `name`, `area`,
`build`, `online` (1: the phone had signal), `country`, `received`, and
`props` as JSON. The props by event:

### Lifecycle

| Event | When | Props |
|---|---|---|
| `first_open` | the first launch with stats on | `known` (the app was on the phone before the stats: not a new user), `via` (spot / area link), `ref` (referrer host), `utm_source`, `utm_medium`, `utm_campaign`, `site` (the site visit that sent it: [Into the app](#into-the-app)) |
| `launch` | every cold start | `platform` (ios, android, windows, mac), `os` (major), `browser`, `standalone` (home screen), `vp`, `dpr`, `lang`, `tz`, `mem`, `launches`, `age_d` (days since first open), `queued` (left unsent by the last run), `site` (opened from the site's "Open the app") |
| `session_start` | first event after 30 min quiet | `n` (the phone's session count), `gap_h` |
| `show` / `hide` | the app comes to the front / is put away | hide: `fg_s` (seconds in front), `taps` (map), `pans`, `zooms`, `clicks` |
| `app_updated` | first launch on a new build | `from` |
| `area_switch` | a launch in another area than the last | `from` |
| `update_ready` | a new build is downloaded | `latest` |
| `stats_on` | switched back on in Settings | |

### What was done

| Event | Props |
|---|---|
| `click` | `el` (label: data-track, aria-label, title or text, scrubbed), `where` (sheet:settings, popup, menu, strip, hot, tools, views, bar, live, card:scent, topbar), `kind`, `cls` |
| `map_tap` | `z` (zoom, to 0.5) |
| `sheet` / `sheet_close` | `sheet` (digin, scoring, pins, huntlog, settings, guide, buttons, views, offline, layers, coords, locations, sat); close: `s` (seconds open) |
| `card` / `card_close` | `card` (scent, outing), `s` |
| `tool` / `tool_close` | `tool` (measure, routes), `s`, measure: `pts` |
| `form` / `form_close` | `form` (log, heard, check), `s` |
| `arm` | `what`: heard, check, check_ahead, scent (waiting for a map tap) |
| `strip` / `live_card` | `open` / `folded` |
| `layer` | `layer`, `on` (one or two switched at once; a view applied is `view`) |
| `setting` | `key`, `value`; sliders settle 1.5 s first. Keys: units, paceKmh, windFlowOpacity, windLevel, leaves, textSize, outdoor, leftHanded, buttonLabels, hotHidden, stripButtons, marksHidden, pastHunts, contourInterval, historicalYear, follow, who (true/false only), opacity.*, saturation.*, flow.*, marks.*, starred, spots.*, scent.* |
| `hot_layout` | `mode`, `near`, `far` (the button ids) |
| `plan_time` | `ahead_h` (0 = now) |
| `mode` / `view` | `mode`; `view` (built-in id, or `custom`) |
| `view_save` / `view_delete` | `n` |
| `quarry` / `heat` | `target`; `on`, `target` |
| `cone` | `on` (the scent cone on you) |
| `scent_people` | `n`, `live` |
| `location` / `heading_up` | `on` |
| `gps` | `status`: denied, error, insecure |
| `gps_fix` | `ms` from location on to the first fix, `acc` |
| `track_start` / `track_stop` | stop: `min`, `pts` |
| `wind_check` | `strength`, `calm`, `swing`, `aloft`, `held`, `note` (true/false) |
| `wind_puff` / `checks_merged` | `puffs` / `n` (a partner's) |
| `log_entry` | `species`, `what`, `kind`, `sound`, `count`, `from_you`, `note` (true/false) |
| `pin_add` / `pin_remove` | `kind` |
| `route` / `route_keep` | `status`, `mode`, `dry`, `n`, `one_way` / `mode` |
| `download_start` / `download` | `area`, `files`, `mb`; done: `done`, `ok`, `skipped` |
| `share` | `what` (spot, area), `result` (shared, copied, cancelled, failed), `named` / `area` |
| `sat_paste` | `ok`, `hours`, `changed`; or `why` (first clause of the reason) |

### Health

| Event | Props |
|---|---|
| `perf` | `what`: map_ready, map_idle (first full draw), wind_grid (wind field fetched), heat_scored (first heat map); `ms` from page open. Once per page load. |
| `error` | `kind` (uncaught, rejection), `msg` (decimals → #.#, 160 chars), `at` (file:line); five different ones per page load at most |

Adding one: `track('name', { … })` from `app/src/analytics.ts` anywhere,
or a store diff in `app/src/stats/watch.ts`. Names are `snake_case`, 40
characters; props are flat, strings cut at 60, the whole under 1 KB. Add
it to the tables here, and to `KEY_PROP` in `site/stats.js` if it has a
"which one" prop worth breaking down.

## Reading it

### The dashboard

`https://groundwind.app/stats`. Not linked from anywhere and kept out
of search (robots.txt). It asks once for the stats key and keeps it in
that browser.

- Window: 7, 30, 90 days or a year. Days are cut in the browser's time
  zone.
- **Leave out phones**: your own (and testers'), by the 8-hex id that
  Settings → Usage stats shows. It applies to everything, the CSV too.
- Tiles: active phones (24 h, 7 d, 30 d), phones and new phones in the
  window, sessions, median time in front per session, share of events made
  with no signal.
- Active phones and minutes per day; feature adoption (share of the
  window's phones that did each thing at least once); when (weekday × hour
  of sessions and returns); session length; retention (day 1, 7, 14, 30,
  and weekly cohorts); every event; each event broken down by its "which"
  prop with time open for sheets, cards, tools and forms; every tap by
  label and where; phones, areas, builds, countries; load times; errors;
  the latest 60 events.

### SQL

```sh
cd site
npx wrangler d1 execute groundwind --remote --command "SELECT name, COUNT(*) n, COUNT(DISTINCT install) phones FROM events WHERE ts > (strftime('%s','now') - 7*86400) * 1000 GROUP BY name ORDER BY phones DESC"
```

Some to start from (`ts` is ms; `json_extract` reads props):

```sql
-- daily active phones, Toronto time
SELECT date(ts/1000, 'unixepoch', '-240 minutes') AS day, COUNT(DISTINCT install) AS phones
FROM events GROUP BY day ORDER BY day;

-- which sheets, how often, how long open
SELECT json_extract(props, '$.sheet') AS sheet, COUNT(*) AS opens, ROUND(AVG(json_extract(props, '$.s')), 1) AS avg_s
FROM events WHERE name = 'sheet_close' GROUP BY sheet ORDER BY opens DESC;

-- the path inside a session: what comes after a map tap
SELECT b.name, COUNT(*) AS n FROM events a JOIN events b ON b.session = a.session AND b.seq = a.seq + 1
WHERE a.name = 'map_tap' GROUP BY b.name ORDER BY n DESC;

-- funnel per phone: launched → tapped the map → dug in → made a wind check
SELECT COUNT(DISTINCT install) AS launched,
       COUNT(DISTINCT CASE WHEN name = 'map_tap' THEN install END) AS tapped,
       COUNT(DISTINCT CASE WHEN name = 'sheet' AND json_extract(props, '$.sheet') = 'digin' THEN install END) AS dug_in,
       COUNT(DISTINCT CASE WHEN name = 'wind_check' THEN install END) AS checked
FROM events;

-- one phone's whole story (by the 8-hex id from its Settings)
SELECT datetime(ts/1000, 'unixepoch') AS utc, name, props FROM events WHERE install LIKE 'a1b2c3d4%' ORDER BY ts;
```

### CSV

The dashboard's **Download CSV**, or
`curl -H "Authorization: Bearer $KEY" "https://groundwind.app/api/export?days=90" > events.csv`.
One row per event, props as a JSON column. It loads into pandas, a
notebook or Excel as is.

## The site

What visits to groundwind.app see and do: which parts of each page come on
screen and for how long, the loops watched, what gets tapped and opened, the
request form's steps, how fast the page comes up, where the visit came from,
and whether it went on into the app. Built 2026-10-08, tested end to end
against a local Worker. Kept in its own table, `site_events`, so a passing
visitor isn't counted as a phone in the app's numbers.

```
browser (site/visit.js, on every page)
  └─ events in memory, sent every 15 s, at 40, and when the page is put away (sendBeacon)
       └─ POST /api/visits, text/plain, the site's own pages only
            └─ groundwind.app Worker (site/sitestats.js) → D1 groundwind.site_events
                 ├─ GET /api/site-stats     (dashboard: groundwind.app/stats, The site)
                 └─ GET /api/visits/export  (every row as CSV)
```

- **A visitor** is a browser: a random 16-hex id made on its first page
  (`gw-visitor` in localStorage). Another browser or a cleared one is
  another visitor.
- **A visit** (`session`) is a run of pages with no 30-minute gap, shared
  by the site's tabs (`gw-visit`). A tab come back to after the gap starts
  a new one, with a `view` marked `again` so its referrer isn't counted
  twice.
- **A page load** (`view`, 12 hex) is one page opened. Each event carries
  the load's counter, and `(view, seq)` is unique, so a batch sent twice is
  stored once.
- **Seen**: a part of the page is on screen when it fills half the screen,
  or most of itself when it is short, sampled every half second. A second
  of that makes it `seen`, so a part flicked past doesn't count. The parts
  are `main > section` on the homepage and the guide (by id, else class:
  the hero is `hero`, the closing quote `coda`, the form's block `beta`),
  and on an article the stretch under each `h2` (`top` above the first).
- **Time** counts only while the page is in front and in use: after 90 s
  with no scroll, tap or key it stops, so a tab left open on a section
  doesn't run up minutes.

### What stays out

- Never what is typed in the form, never a position: the form reports only
  the box first used, how sending went and the game boxes ticked. Labels
  come from the page's own text.
- **Nothing is sent** from a browser with Global Privacy Control on (the
  Worker also drops anything arriving with `Sec-GPC: 1`), one driven by a
  script (`navigator.webdriver`: the loops' recordings, the screenshot
  scripts), a crawler (by its user agent, in the browser and again in the
  Worker), or one switched off: a browser that has opened the dashboard
  sets `gw-site-off`, and so does any page opened with `?notrack` (for a
  phone you don't want to sign in to the dashboard on).
- The coarse "where" is Cloudflare's country for the upload. The site's
  FAQ ("What happens to my data?") says this, 2026-10-08.

### Into the app

A tap on any "Open the app" link adds `?v=<visitor>` as it goes
(groundwind.app/app passes the query on to the app). The app reads it once
at start (`app/src/analytics.ts`), puts it on `first_open` and `launch` as
`site`, and takes it out of the address, so a reload or a shared link
doesn't carry it. The dashboard joins the two: phones whose first open came
from a visit in the window, and what those phones went on to do. On iOS the
home-screen app keeps its own storage, so a phone added to the home screen
after opening from the site makes a second first open with no `site`.

### The site's events

Every row has `visitor`, `session`, `view`, `seq`, `ts`, `page` (the path:
`/`, `/guide`, `/moose-weather` …, `/404` for a page not found), `name`,
`props` as JSON, `country` and `received`.

| Event | When | Props |
|---|---|---|
| `view` | a page opened | `new` (the browser's first page), `visits` (its visit count), `ref` (the linking site's host) or `from` (the site's own page before), `utm_source`, `utm_medium`, `utm_campaign`, `hash`, `vp`, `dpr`, `platform`, `browser`, `lang`, `tz`, `conn`, `reduced` (reduced motion), `nav` (navigate, reload, back_forward), `again`, `path` (on /404) |
| `seen` | a part first on screen for a second | `sec`, `i` (its place on the page), `t` (seconds after the page opened) |
| `dwell` | the page put away | `sec`, `s` (seconds on screen since the last time it was put away) |
| `hide` / `show` | put away / back | hide: `fg_s` (seconds in front and in use), `depth` (% of the page reached, the most so far), `at` (the part most on screen); show: `gap_s` |
| `click` | a link or a button | `el` (label), `sec`, `kind` (link, button …), `to` (`/app`, a path, `#request`, another site's host, `mailto`), `tab` (middle click) |
| `dead_click` | a tap on something that does nothing | `what` (tag and its text or alt, 50 characters), `sec`. Twenty per page load at most |
| `dig` / `dig_close` | a details opened / closed | `el` (its summary: How, As a table, an FAQ question), `sec`; close: `s` |
| `loop_play` | a loop first played on screen | `loop` (the file's name), `sec` |
| `watch` | the page put away | `loop`, `s` (seconds it played on screen) |
| `loop_tap` | a tap on a loop | `loop`, `act` (pause, play) |
| `loop_wait` | a loop on screen behind its play button | `loop`, `sec`, `reduced` (Low Power Mode or reduced motion) |
| `form_start` | the request form's first box used | `field` |
| `request` | a send tried | `result` (sent, no_email, no_where, busy, failed), `game` |
| `vitals` | the first time the page is put away | `lcp`, `fcp`, `ttfb`, `dom`, `load` (ms from the page's start), `cls` (the worst burst), `inp` (the slowest tap answered, ms). Safari reports only some |
| `error` / `asset_error` | a script error (five per page load) / a loop or photo that didn't load | `msg`, `at` / `what`, `name` |

Adding one: `gwTrack('name', { … })` from a page's own script
(`window.gwTrack` is there when `visit.js` is sending), or a line in
`visit.js`. Add it to the table here.

### Reading the site's

The dashboard's **The site** tab (the window and **Leave out** apply as on
the app's; an 8-hex id there leaves out a phone or a browser): visitors,
median time a visit, the share of visits that opened the app, new phones
from the site, spots requested; visitors per day; where visits came from
(utm source, else the linking site, else direct) with each source's share
to the app; **What they see**: for a page, each part in page order with the
share of loads that saw it and the seconds it held them; **Where they
left**; pages with time and depth; taps; what was opened; the loops; taps
on nothing; into the app (visits, then the phones and what they did); the
request form; devices, countries, speed, errors and the latest events.

```sql
-- the homepage, part by part: share of loads that saw it, seconds each
WITH v AS (SELECT COUNT(DISTINCT view) AS n FROM site_events WHERE page = '/' AND name = 'view')
SELECT json_extract(props, '$.sec') AS sec, MIN(json_extract(props, '$.i')) AS i,
       ROUND(100.0 * COUNT(DISTINCT CASE WHEN name = 'seen' THEN view END) / (SELECT n FROM v)) AS pct,
       ROUND(SUM(CASE WHEN name = 'dwell' THEN json_extract(props, '$.s') ELSE 0 END) / MAX(1, COUNT(DISTINCT CASE WHEN name = 'seen' THEN view END))) AS s_each
FROM site_events WHERE page = '/' AND name IN ('seen', 'dwell') GROUP BY sec ORDER BY i;

-- one visit's whole story, in order
SELECT datetime(ts/1000, 'unixepoch') AS utc, page, name, props FROM site_events WHERE session = '…' ORDER BY ts, seq;
```

`curl -H "Authorization: Bearer $KEY" "https://groundwind.app/api/visits/export?days=30" > site.csv`
for every row.

### The site's limits

A homepage read top to bottom is 35 to 45 events (a `seen` and a `dwell`
per part, the loops, the view, the hide), a glance at the hero 5. Each
event is three rows written (the row and two indexes), out of the same
100,000 a day as the app's, so about 800 full homepage reads a day before
the $5 plan. `/api/visits` shares the `EVENTS_LIMIT` rate limit under its
own key (`site:<address>`): 30 batches a minute per address.

## Wind checks

The hunters' wind checks are the ground model's lessons: where it is wrong
and under which conditions (docs/MICRO-WIND.md). They come through the same
Worker, but apart from the stats, because a check is a position: where
someone hunts.

```
phone (app/src/weather/micro/checkShare.ts)
  └─ the checks in the store (windChecks.ts), each remembered by a fingerprint of what was sent
       └─ POST /api/checks, a batch of up to 100, text/plain, keepalive
            └─ groundwind.app Worker (site/checks.js) → D1 groundwind.checks
                 └─ GET /api/checks/export  (JSON, behind STATS_KEY)
```

- **Asked once.** After a phone's first check is saved, the card asks
  "Share your wind checks?" with **Share** and **Not now**. That is the only
  time: answered or not (the card closed without a tap), it is not put
  again, and only **Settings → Sharing → Share wind checks** changes it.
  Unanswered, nothing goes. Putting the question is a `check_share_ask`
  event and the answer a `check_share` event (`on`, `via`: ask or
  settings), so the dashboard shows how many of those asked say yes.
- **Anonymous.** A check goes whole (place, time, what was felt, every
  puff, the two optional answers, what the map and the forecast said) under
  the phone's random id. Never `by` (initials) or `note`: the phone leaves
  them out and the Worker drops them again. A partner's check taken in from
  their file (marked `taken` by the store's merge) is never sent.
- **Never shown to another hunter.** Only what the checks teach goes back
  into the wind, never a check itself.
- **Switched on, the season goes too:** every check still on the phone (the
  store keeps 500), not only the ones made after.
- **Changes are sent again.** A check changes after it is made: another
  puff folds in within 6 minutes, or a newer check within 100 m sets its
  `until`. The phone keeps a fingerprint of what it sent per check and
  sends one again when it has moved; the Worker updates the row
  (`(install, cid)` is unique). A change is sent 15 s after the last one,
  then every minute in front, when the phone is put away and when signal
  comes back. A week with no signal waits and goes whole.
- **Off** stops the sending. What has gone stays in D1.
- The site FAQ ("What happens to my data?") says this, 2026-10-06.

Pull them with
`curl -H "Authorization: Bearer $KEY" "https://groundwind.app/api/checks/export?days=400" > checks.json`
(`&area=pickle-lake` for one area). Each object has the row's columns
(`install`, `cid`, `ts`, `utc`, `lat`, `lon`, `area`, `build`, `country`,
`received`, `updated`) and `check`, the WindCheck as the phone kept it.
`/api/checks` shares the stats' rate limit (`EVENTS_LIMIT`): 30 batches a
minute per address, 200 checks and 200 KB a batch.

## Limits and costs

- D1 free tier: 100,000 rows written a day. Each event writes the row plus
  two index entries, so about 33,000 events a day. A heavy session is
  50 to 150 events, which makes 200+ active phones a day before the $5
  Workers plan is needed (50 M rows a month). Size on disk is about 250
  bytes an event, and a free database holds 500 MB.
- `/api/stats` scans the window; retention scans everything. Fine into
  the hundreds of thousands of rows. Past that, roll the old days up into
  a daily table and prune the raw clicks.
- `/api/events` takes 30 batches a minute per address (the `EVENTS_LIMIT`
  binding), 200 events and 200 KB a batch. It is a public write endpoint:
  anyone can post made-up events. Treat outliers with suspicion, and leave
  out an install that looks wrong.

## Going live

From `site/`:

1. `npx wrangler d1 execute groundwind --remote --file schema.sql` adds
   the `events` and `checks` tables (the tables already there are
   untouched: IF NOT EXISTS).
2. `npx wrangler secret put STATS_KEY` and paste a long random key. That
   key opens the dashboard and the export.
3. `npx wrangler deploy`: the endpoints, the dashboard, the FAQ text.
4. The app: merge to main. GitHub Pages builds it and the phones pick it
   up on their next update. Until then nothing is sent; events made by a
   build that reaches the Worker before step 1 wait on the phone and
   arrive on a later try.
5. Open `groundwind.app/stats`, then put your own phone's id in
   **Leave out**.

The site's stats (2026-10-08) need step 1 again (it adds `site_events`)
and step 3; the app's half (`site` on `first_open` and `launch`) goes with
the app's next build. Open the dashboard once in each browser you use, or
any page with `?notrack` on a phone, so your own visits stay out.

## Local testing

`wrangler dev` from `site/` reloads in a loop: the assets folder is
`site/` itself, and wrangler writes its bundle under `site/.wrangler`. Run
it from a scratch folder instead, with a `wrangler.toml` whose `main` is
`C:/dev/huntapp/site/worker.js` and whose assets are a copy of the pages
in a subfolder. Then:

```sh
npx wrangler d1 execute groundwind --local --file C:/dev/huntapp/site/schema.sql
npx wrangler dev --port 8799 --var STATS_KEY:devkey
# in app/
VITE_EVENTS_API=http://localhost:8799 npx vite --port 5191
```

A browser driven by Playwright sends nothing unless the test hides
`navigator.webdriver`
(`Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false })`).

For the site, give the browser its user agent at launch
(`args=[f'--user-agent={UA}']`), not only the context's: a page leaving for
another site (Open the app) sends its last batch from outside the tab,
with the stock "HeadlessChrome" agent, and the Worker drops it as a bot.
Don't `route()` either: with a route on, Playwright holds every request,
and the leaving beacon can die with the tab. To keep the real app from
loading, point its host at nothing:
`--host-resolver-rules=MAP hunt.groundwind.app 127.0.0.1:9`.
