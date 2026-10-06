# Usage stats: who uses the app, and what they use

Which parts of the app get used, by how many phones, how often and for how
long. The data is ours, in our own D1 database: raw events you can query
with SQL, pull as CSV, or read on a dashboard at groundwind.app/stats.

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

## The events

Every event row has `install`, `session`, `seq`, `ts`, `name`, `area`,
`build`, `online` (1: the phone had signal), `country`, `received`, and
`props` as JSON. The props by event:

### Lifecycle

| Event | When | Props |
|---|---|---|
| `first_open` | the first launch with stats on | `known` (the app was on the phone before the stats: not a new user), `via` (spot / area link), `ref` (referrer host), `utm_source`, `utm_medium`, `utm_campaign` |
| `launch` | every cold start | `platform` (ios, android, windows, mac), `os` (major), `browser`, `standalone` (home screen), `vp`, `dpr`, `lang`, `tz`, `mem`, `launches`, `age_d` (days since first open), `queued` (left unsent by the last run) |
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
   the `events` table (the existing `requests` table is untouched: IF NOT
   EXISTS).
2. `npx wrangler secret put STATS_KEY` and paste a long random key. That
   key opens the dashboard and the export.
3. `npx wrangler deploy`: the endpoints, the dashboard, the FAQ text.
4. The app: merge to main. GitHub Pages builds it and the phones pick it
   up on their next update. Until then nothing is sent; events made by a
   build that reaches the Worker before step 1 wait on the phone and
   arrive on a later try.
5. Open `groundwind.app/stats`, then put your own phone's id in
   **Leave out phones**.

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
