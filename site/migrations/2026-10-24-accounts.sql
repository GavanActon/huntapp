-- 2026-10-24: accounts (docs/REQUESTS.md step 3; account.js). An email and a
-- 6-digit code, no password; the session a long random token. Only hashes of
-- codes and tokens are kept. A signed-in phone's locations follow the account
-- (`locations`), and every request gets a token for its status page
-- (status.html at /l/<token>) and the account that asked.
--
-- The Worker runs without these (it answers the account routes 503 and takes
-- requests as before), so this can go in before or after the deploy. By hand,
-- once, from site/:
--
--   npx wrangler d1 execute groundwind --remote --file migrations/2026-10-24-accounts.sql
--   npx wrangler d1 execute groundwind --remote --command "PRAGMA table_info(requests)"
--
-- The tables first: run twice, the first ALTER fails on its duplicate column,
-- and nothing is lost.

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,            -- lower case, as typed and checked by its code
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,           -- SHA-256 of the token the phone keeps
  account INTEGER NOT NULL,
  install TEXT,                          -- the phone that signed in (16 hex, as in events)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen TEXT NOT NULL DEFAULT (datetime('now'))   -- pushed on daily while used; lapses after 400 days unused
);

CREATE TABLE IF NOT EXISTS codes (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL,
  hash TEXT NOT NULL,                    -- SHA-256 of email:code
  who TEXT,                              -- the sender's hashed address, only to slow a flood
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  tries INTEGER NOT NULL DEFAULT 0,
  used INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS codes_email_at ON codes (email, created_at);

CREATE TABLE IF NOT EXISTS locations (
  account INTEGER NOT NULL,
  id TEXT NOT NULL,                      -- the box's id (b-x0-y0-x1-y1), the location's on every phone
  name TEXT,
  j TEXT,                                -- the province or state
  pack TEXT,                             -- the pack baked for it (areas.id), once there is one
  at INTEGER,                            -- loaded at, ms (the phone's)
  edited INTEGER NOT NULL DEFAULT 0,     -- renamed at, ms: the latest name wins
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  removed_at TEXT,                       -- removed on a phone: gone from every phone
  removed_ms INTEGER,                    -- the same, ms: a phone that loads it again later brings it back
  PRIMARY KEY (account, id)
);

ALTER TABLE requests ADD COLUMN token TEXT;      -- the status page's key (/l/<token>)
ALTER TABLE requests ADD COLUMN account INTEGER; -- the account that asked, when signed in
CREATE INDEX IF NOT EXISTS requests_token ON requests (token);
