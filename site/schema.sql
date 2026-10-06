-- Area requests from the site's form (and later the app's own button), and
-- the app's usage stats (events, below).
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
  status TEXT NOT NULL DEFAULT 'new'
);
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
