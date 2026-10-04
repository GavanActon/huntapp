-- Area requests from the site's form (and later the app's own button).
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
