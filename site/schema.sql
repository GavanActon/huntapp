-- Area requests from the site's form (and later the app's own button), the
-- app's usage stats (events, below), the site's own (site_events), the wind
-- checks hunters share (checks) and a hunting party's sealed mailbox
-- (party_items).
-- Apply with: npx wrangler d1 execute groundwind --remote --file schema.sql
-- Read with:  npx wrangler d1 execute groundwind --remote --command "SELECT * FROM requests ORDER BY at DESC"
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
  tile TEXT,             -- Explore: the SD lattice cell asked for (t-<i>-<j>, docs/EXPLORE.md)
  kind TEXT              -- sd or hd
);
-- a table made before 2026-10-08 needs the two columns added:
--   ALTER TABLE requests ADD COLUMN tile TEXT; ALTER TABLE requests ADD COLUMN kind TEXT;
CREATE INDEX IF NOT EXISTS requests_who_at ON requests (who, at);

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
