-- 2026-10-24: locations own their builds (docs/REQUESTS.md, step 1). A phone
-- is told its build's place in line, how far the bake is and about how long
-- is left (worker.js requestStatus): `progress` is what the agent reports
-- with each step, and `runners` keeps when each bake machine last called in,
-- so the minutes are said only while one has (bake.js nextRequest).
--
-- The Worker runs without either (it answers without the minutes and the
-- progress), so this can go in before or after the deploy. By hand, once,
-- from site/:
--
--   npx wrangler d1 execute groundwind --remote --file migrations/2026-10-24-packs.sql
--   npx wrangler d1 execute groundwind --remote --command "PRAGMA table_info(requests)"
--
-- The table first: run twice, the ALTER fails on its duplicate column, and
-- nothing is lost.

CREATE TABLE IF NOT EXISTS runners (
  name TEXT PRIMARY KEY,        -- the machine, as the agent names itself (XEVO, xonix)
  kinds TEXT,                   -- what it bakes: sd, or sd,hd
  last_seen TEXT NOT NULL       -- its last call to /api/bake/next
);

ALTER TABLE requests ADD COLUMN progress REAL;   -- 0 to 1: how far the bake is, by its steps' measured times
