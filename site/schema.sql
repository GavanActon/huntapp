-- Area requests from the site's form and the app's Explore card, the areas
-- baked for them (areas), the app's usage stats (events, below), the site's
-- own (site_events), the wind checks hunters share (checks) and a hunting
-- party's sealed mailbox (party_items).
-- Apply with: npx wrangler d1 execute groundwind --remote --file schema.sql
-- Read with:  npx wrangler d1 execute groundwind --remote --command "SELECT * FROM requests ORDER BY at DESC"
--             or on groundwind.app/requests (requests.html, behind STATS_KEY)
-- A column added here never reaches a table that exists: each change comes
-- with its ALTER TABLE statements in migrations/, applied by hand (then
-- check with PRAGMA table_info(<table>) on --remote).
CREATE TABLE IF NOT EXISTS requests (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  email TEXT NOT NULL,
  place TEXT NOT NULL,   -- what they typed: coordinates or a place name
  lat REAL,              -- parsed from place (or sent by the app), Canada only
  lon REAL,
  game TEXT,             -- moose,deer,bear,grouse
  source TEXT,           -- site or app
  country TEXT,          -- Cloudflare's guess from the connection
  who TEXT,              -- a hash of the sender's address, only to slow a flood
  status TEXT NOT NULL DEFAULT 'new',
  tile TEXT,             -- Explore: the box drawn (b-<x0>-<y0>-<x1>-<y1>, habitat-cell indices, app/src/explore/box.ts), or the SD lattice cell (t-<i>-<j>) before 2026-10-09
  kind TEXT,             -- sd or hd
  -- the bake loop (docs/SD-HD-PLAN.md; worker.js /api/bake, pipeline/agent.py)
  box TEXT,              -- JSON {west, south, east, north}: sent, or worked out from tile
  install TEXT,          -- the asking phone's install id (16 hex, as in events)
  name TEXT,             -- the area's name as asked for
  stage TEXT,            -- queued, claimed, baking, review, done, failed, cancelled; NULL: left to a person (no point, or from before the loop)
  step TEXT,             -- the bake step under way (habitat, wind-sd …), for the phone
  area_id TEXT,          -- the area it became (areas.id)
  error TEXT,            -- failed: the traceback's tail; review: what the checklist flagged
  claimed_at TEXT,
  done_at TEXT,
  updated_at TEXT,       -- the stage's last change
  agent TEXT,            -- the machine baking it (XEVO)
  progress REAL,         -- 0 to 1: how far the bake is, by its steps' measured times (2026-10-24)
  token TEXT,            -- the status page's key (status.html at /l/<token>; 2026-10-24)
  account INTEGER        -- the account that asked, when signed in (account.js)
);
-- a table made before 2026-10-08 needs the two columns added:
--   ALTER TABLE requests ADD COLUMN tile TEXT; ALTER TABLE requests ADD COLUMN kind TEXT;
-- and one made before 2026-10-11 the bake loop's: migrations/2026-10-11-requests-bake.sql,
-- before 2026-10-24 the packs': migrations/2026-10-24-packs.sql, and the accounts':
-- migrations/2026-10-24-accounts.sql
CREATE INDEX IF NOT EXISTS requests_who_at ON requests (who, at);

-- The packs baked on request (pipeline/agent.py posts each one when it is
-- in R2): /areas/<id>/area.json hands over the file to a phone that has the
-- id (docs/REQUESTS.md: a location keeps it, so a new pack needs no app
-- build); /areas/index.json lists none. The files themselves are in R2
-- under areas/<id>/ (data.groundwind.app).
CREATE TABLE IF NOT EXISTS areas (
  id TEXT PRIMARY KEY,         -- the area's id: its files are <layer>-<id>.<ext> under areas/<id>/ in R2
  name TEXT NOT NULL,
  lat REAL,                    -- the area's centre
  lon REAL,
  kind TEXT,                   -- sd or hd
  stage TEXT NOT NULL,         -- done: served by /areas/<id>/area.json and to new asks it covers; anything else (withdrawn) keeps it out
  area_json TEXT NOT NULL,     -- the area file as the bake wrote it (app/src/areas/<id>.json's form)
  files_json TEXT NOT NULL,    -- areas/<id>/manifest.json in R2, byte for byte: {files: {name: {size, hash, z?, bounds?}}}
  size_bytes INTEGER,          -- the pack: what a phone saves for it
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  request_id INTEGER           -- requests.id it was baked for
);

-- The bake machines: when each last asked for work (bake.js nextRequest), so
-- a phone is told minutes to go only while one is in (worker.js requestStatus).
CREATE TABLE IF NOT EXISTS runners (
  name TEXT PRIMARY KEY,
  kinds TEXT,
  last_seen TEXT NOT NULL
);

-- The app's usage stats (app/src/analytics.ts → /api/events, stats.js;
-- every event and the queries in docs/ANALYTICS.md). No position, no names:
-- a random id per phone, what it did and when.
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  install TEXT NOT NULL,      -- 16 hex, made once per install (the phone; a home-screen app on iOS is a phone of its own)
  session TEXT NOT NULL,      -- 12 hex, new after 30 min with nothing done
  seq INTEGER NOT NULL,       -- the install's counter: a batch sent twice is stored once
  ts INTEGER NOT NULL,        -- when it happened, ms, the phone's clock put right by the batch's skew
  name TEXT NOT NULL,         -- what happened: click, sheet, layer, wind_check … (docs/ANALYTICS.md)
  props TEXT,                 -- JSON, small: which sheet, which layer, the button's label …
  area TEXT,                  -- the area the app was running in
  build TEXT,                 -- the app's build (git sha)
  online INTEGER,             -- 1: the phone had signal when it happened
  country TEXT,               -- Cloudflare's guess from the upload
  received INTEGER NOT NULL   -- when it reached us, ms (received - ts: how long it waited on the phone)
);
CREATE UNIQUE INDEX IF NOT EXISTS events_install_seq ON events (install, seq);
CREATE INDEX IF NOT EXISTS events_ts ON events (ts);

-- The site's own stats (site/visit.js → /api/visits, sitestats.js; the
-- events and the queries in docs/ANALYTICS.md "The site"): which parts of a
-- page came on screen and for how long, the loops watched, what was tapped
-- and opened, and where the visit came from. A random id per browser, never
-- what's typed in the request form. Kept apart from the app's events, so a
-- passing visitor isn't counted as a phone.
CREATE TABLE IF NOT EXISTS site_events (
  id INTEGER PRIMARY KEY,
  visitor TEXT NOT NULL,      -- 16 hex, made once per browser (localStorage gw-visitor)
  session TEXT NOT NULL,      -- 12 hex, new after 30 min with nothing done
  view TEXT NOT NULL,         -- 12 hex, one page load
  seq INTEGER NOT NULL,       -- the page load's counter: a batch sent twice is stored once
  ts INTEGER NOT NULL,        -- when it happened, ms, the browser's clock put right by the batch's skew
  page TEXT NOT NULL,         -- the path: /, /guide, /moose-weather … (/404 for a page not found)
  name TEXT NOT NULL,         -- what happened: view, seen, dwell, click, dig, loop_play … (docs/ANALYTICS.md)
  props TEXT,                 -- JSON, small: which section, which button, how long …
  country TEXT,               -- Cloudflare's guess from the upload
  received INTEGER NOT NULL   -- when it reached us, ms
);
CREATE UNIQUE INDEX IF NOT EXISTS site_events_view_seq ON site_events (view, seq);
CREATE INDEX IF NOT EXISTS site_events_ts ON site_events (ts);

-- Wind checks the hunters chose to share (app/src/weather/micro/checkShare.ts
-- → /api/checks, checks.js; docs/ANALYTICS.md "Wind checks"). Asked once, at
-- a phone's first check, and off in Settings. A position, a time, what was
-- felt and what the map and the forecast said: the ground model's lessons by
-- place and conditions. Never a name or a note, never shown to another
-- hunter. A check that changes on the phone (another puff folded in, or
-- replaced by a newer one) is sent again and updated: (install, cid) is unique.
CREATE TABLE IF NOT EXISTS checks (
  id INTEGER PRIMARY KEY,
  install TEXT NOT NULL,      -- the phone's random id, as in events
  cid TEXT NOT NULL,          -- the check's own id on the phone
  ts INTEGER NOT NULL,        -- when it was made, ms, the phone's clock put right by the batch's skew
  lat REAL NOT NULL,
  lon REAL NOT NULL,
  area TEXT,                  -- the area the app was running in when it was sent
  build TEXT,                 -- the app's build (git sha) that sent it
  data TEXT NOT NULL,         -- the check as the phone keeps it (windChecks.ts WindCheck), JSON, less `by` and `note`
  country TEXT,               -- Cloudflare's guess from the upload
  received INTEGER NOT NULL,  -- first reached us, ms
  updated INTEGER NOT NULL    -- last sent, ms
);
CREATE UNIQUE INDEX IF NOT EXISTS checks_install_cid ON checks (install, cid);
CREATE INDEX IF NOT EXISTS checks_ts ON checks (ts);

-- A hunting party's mailbox (party.js, app/src/party/, docs/PARTY.md): what
-- the phones in a party share, sealed on the phone with the party's key,
-- which never comes here. A slot ('pos', 'hello') keeps a member's newest
-- item of its kind only; the rest are kept 14 days. (party, member, seq) is
-- unique, so a copy sent twice is stored once.
CREATE TABLE IF NOT EXISTS party_items (
  -- the readers' cursor (GET ?after=id): AUTOINCREMENT, so an id is never
  -- reused. A slot's replacement deletes the newest row and inserts again,
  -- and a reused id would sit behind every reader's cursor, unseen.
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  party TEXT NOT NULL,        -- the party's random id, from its invite
  member TEXT NOT NULL,       -- the sender's random id in the party
  seq INTEGER NOT NULL,       -- the sender's counter
  slot TEXT,                  -- pos or hello: newest only; NULL: kept
  body TEXT NOT NULL,         -- sealed (AES-GCM, base64url): iv and ciphertext
  received INTEGER NOT NULL   -- ms
);
CREATE UNIQUE INDEX IF NOT EXISTS party_items_seq ON party_items (party, member, seq);
CREATE INDEX IF NOT EXISTS party_items_read ON party_items (party, id);
CREATE INDEX IF NOT EXISTS party_items_slot ON party_items (party, member, slot);
CREATE INDEX IF NOT EXISTS party_items_received ON party_items (received);

-- What IndexNow was last told about each page of the sitemap (indexnow.js):
-- the hourly sweep sends a page whose hash changed, and one that left the
-- sitemap, then marks it here.
CREATE TABLE IF NOT EXISTS indexnow (
  url TEXT PRIMARY KEY,       -- as in sitemap.xml
  hash TEXT NOT NULL,         -- 24 hex of the page's SHA-256 when it was sent
  sent INTEGER NOT NULL       -- ms
);

-- Accounts (account.js; docs/REQUESTS.md, Accounts): an email and a 6-digit
-- code, the session a long random token; only hashes of codes and tokens.
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  account INTEGER NOT NULL,
  install TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS codes (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL,
  hash TEXT NOT NULL,
  who TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  tries INTEGER NOT NULL DEFAULT 0,
  used INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS codes_email_at ON codes (email, created_at);
CREATE TABLE IF NOT EXISTS locations (
  account INTEGER NOT NULL,
  id TEXT NOT NULL,
  name TEXT,
  j TEXT,
  pack TEXT,
  at INTEGER,
  edited INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  removed_at TEXT,
  removed_ms INTEGER,
  PRIMARY KEY (account, id)
);
CREATE INDEX IF NOT EXISTS requests_token ON requests (token);
