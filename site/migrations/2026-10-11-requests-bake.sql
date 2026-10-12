-- 2026-10-11: the SD-on-request loop (docs/SD-HD-PLAN.md, The loop: Queue
-- and Bake). A request now carries what the bake agent needs and how far it
-- has got (pipeline/agent.py, worker.js /api/bake), and a finished area is
-- kept in `areas`, which /areas/index.json and /areas/<id>/area.json are
-- built from, so a new area needs no app build.
--
-- schema.sql's CREATE TABLE IF NOT EXISTS never adds a column to a table
-- that is already there, so the live database takes these by hand, once:
--
--   npx wrangler d1 execute groundwind --remote --file migrations/2026-10-11-requests-bake.sql
--   npx wrangler d1 execute groundwind --remote --command "PRAGMA table_info(requests)"
--
-- (from site/). Run twice, the first ALTER fails on its duplicate column
-- and the rest of the file is not applied: nothing is lost.
--
-- `kind` (sd, hd) is not here: it came with Explore's `tile` on 2026-10-08.
-- Rows from before keep stage NULL, so the agent never picks up a request
-- that was already handled by hand.

ALTER TABLE requests ADD COLUMN box TEXT;          -- JSON {west, south, east, north}: sent, or worked out from tile
ALTER TABLE requests ADD COLUMN install TEXT;      -- the asking phone's install id (16 hex, as in events)
ALTER TABLE requests ADD COLUMN name TEXT;         -- the area's name as asked for
ALTER TABLE requests ADD COLUMN stage TEXT;        -- queued, claimed, baking, review, done, failed, cancelled; NULL: left to a person
ALTER TABLE requests ADD COLUMN step TEXT;         -- the bake step under way (habitat, wind-sd …), for the phone
ALTER TABLE requests ADD COLUMN area_id TEXT;      -- the area it became (areas.id)
ALTER TABLE requests ADD COLUMN error TEXT;        -- failed: the traceback's tail; review: what the checklist flagged
ALTER TABLE requests ADD COLUMN claimed_at TEXT;
ALTER TABLE requests ADD COLUMN done_at TEXT;
ALTER TABLE requests ADD COLUMN updated_at TEXT;   -- the stage's last change
ALTER TABLE requests ADD COLUMN agent TEXT;        -- the machine baking it (XEVO)

CREATE TABLE IF NOT EXISTS areas (
  id TEXT PRIMARY KEY,         -- the area's id: its files are <layer>-<id>.<ext> under areas/<id>/ in R2
  name TEXT NOT NULL,
  lat REAL,                    -- the area's centre
  lon REAL,
  kind TEXT,                   -- sd or hd
  stage TEXT NOT NULL,         -- done: in /areas/index.json; anything else (withdrawn) keeps it out
  area_json TEXT NOT NULL,     -- the area file as the bake wrote it (app/src/areas/<id>.json's form)
  files_json TEXT NOT NULL,    -- areas/<id>/manifest.json in R2, byte for byte: {files: {name: {size, hash, z?, bounds?}}}
  size_bytes INTEGER,          -- the pack: what a phone saves for it
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  request_id INTEGER           -- requests.id it was baked for
);
