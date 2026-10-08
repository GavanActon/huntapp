# Plan: SD everywhere, HD to order, asked for from the app

Status: proposed 2026-10-07, not approved, nothing built. It settles the
SD / HD back-and-forth into one build order with effort by order of
magnitude. It builds on [AREAS.md](AREAS.md) (Live, SD and HD; Requests),
[TILES.md](TILES.md) and [SCALE-PLAN.md](SCALE-PLAN.md); it does not
repeat their designs.

The one rule: **nothing already baked is baked again.** The four areas
move to the data store as they are. SD on request and SD tiles write the
same three grids the app reads today. HD is the bake that exists.

## What stands today

- Four HD areas (Pickle Lake, Lac Bailey, Highland Lake, Sault test), compiled
  into the app, served by GitHub Pages at hunt.groundwind.app: 440 MB of
  the 1 GB cap. Phones keep them offline in OPFS.
- `bake_area.py --new --lat --lon` bakes any point. Adapters for Ontario,
  Quebec and the Yukon. Elsewhere in Canada: terrain, topo, SCANFI stands,
  but **no water or roads**, so the habitat grid does not bake there.
- SD tiles: the lattice, staged rasters, LIO's province packages and the
  3 × 3 pilot. The app reads no tiles. The province run has not started.
- The Worker keeps the site form's requests in D1 (`requests`: email,
  place, lat, lon, game, source, status). The app has no request button.
- WindNinja: a kit on a share, runners on XEVO and xonix that claim jobs
  by file and watch for new ones (`run.ps1 -Watch`).
- `area_checklist.py` is the gate, with a live page per area.
- Not there: email sending, R2, payments, accounts, a Live mode (the map
  is fenced to the active area), an area list fetched at run time.

## The shape

| | What | Made by | Ready in | Price |
| --- | --- | --- | --- | --- |
| Live | The map anywhere, forecast wind, no bake | nothing | now | free |
| SD | Stands, habitat heat, going grid, routes, 30 m ground wind, offline topo and imagery | `bake_area.py` with the SD steps; or cut from pre-baked tiles where a province has been run | ~15 min on request, seconds from tiles | free |
| HD | 1 m LiDAR relief and contours, bush and lanes from the point cloud, WindNinja momentum | the full `bake_area.py` plus the WindNinja kit | 3–4 h unattended; the site promises 48 h | paid per area, shared with the party |

SD is the same pack as HD with the LiDAR, point cloud and WindNinja steps
left out: the same area file, the same files, the same app. That is why
nothing needs rebaking and why an SD area can later be upgraded to HD in
place (the LiDAR steps add files; habitat and micro are baked again on
them, 10–20 s each).

## The loop: explore, ask, bake, email

1. **Ask** (app). A "Get this area" card from the "No detail here yet"
   state (Go to coordinates, a pin, a tap in no area): the point, SD or HD
   (HD offered only where NRCan's STAC finds 1 m LiDAR, with its year), a
   name, an email. It posts to `/api/request` and gets an id. Locations
   shows "Requested · SD · in the queue" and polls while online. The site
   form posts the same.
2. **Queue** (Worker, D1). `requests` gains `kind` (sd, hd), `box`,
   `install`, `stage`, `area_id`, `error`, `done_at`. Endpoints:
   `POST /api/request` (exists), `GET /api/request?id=` (the phone's
   status), `GET /api/bake/next` and `POST /api/bake/<id>` (the agent's
   claim, progress and done, behind a shared secret),
   `GET /areas/index.json` and `/areas/<id>/area.json` built from D1 so the
   list needs no app build.
3. **Bake** (XEVO, `pipeline/agent.py --watch`). Claims a request, bakes
   under `HUNTAPP_AREAS_DIR` and `HUNTAPP_OUT` in pipeline/raw/requests so
   the repo is untouched:
   - SD: `bake_area.py --new … --bake` with the SD steps (no LiDAR, point
     cloud or WindNinja). Where the tiles under the box exist, `tiles.py
     stitch` for the grids and only the display layers are baked.
   - HD: the full bake, then `build_windcfd.py prepare`; the watching
     runners do the 16 directions; `collect`, then micro and coverage
     again. The agent keeps a stage per request and moves on to the next
     while WindNinja runs.
   - `area_checklist.py` as the gate: clean uploads and registers itself;
     a warning parks it at `review` and emails Gavan.
   - Upload to R2, register the area (`POST /api/bake/<id>` with the area
     file), mark done.
4. **Ship** (email). "Your area is ready" with the link
   `hunt.groundwind.app/?area=<id>#at=lat,lon`. The app's link start meets
   an id it was not built with, fetches `areas/<id>/area.json` from the
   data store, caches it on the phone and opens there. The Offline sheet
   saves it as it saves any area.
5. **Pay** (HD). First by hand: an HD request emails Gavan, he sends a
   Stripe payment link or takes an e-transfer, and marks it paid in D1,
   which starts the bake. Later: Stripe Checkout from the card, a webhook
   into an `unlocks` table (email or install, area, until, party), a
   signed unlock on the phone, shared through the party's mailbox
   ([PARTY.md](PARTY.md) "HD for the party"), and the Worker serving HD
   files from R2 only with it.

## Hosting

- R2 bucket `groundwind-data`, custom domain `data.groundwind.app`
  (Cloudflare's own edge: Range and CORS work; the "never proxy" rule was
  for GitHub Pages behind the proxy). Check PMTiles range reads with the
  headless script before switching the app over.
- Copy the four areas as they are. `VITE_DATA_BASE=https://data.groundwind.app/`
  in the Pages build; `warm-cache.sh` warms that host. The app's dist
  falls from 351 MB to a few MB and the 1 GB cap stops mattering.
- Cost: $0.015 a GB-month, no egress fee. 450 MB now; 15 GB with
  northern Ontario's tiles; 100 GB for the country is $1.50 a month.
- The compiled area files stay in the app as the fallback with no signal.

## SD widely available: two stages

**Stage 1, on request anywhere in Canada.** The loop above with the SD
steps. What is missing for "anywhere": a national vectors adapter (CanVec
or NHN water, NRN roads, OSM trails; the Yukon adapter is the template) so
the habitat grid bakes outside Ontario, Quebec and the Yukon. Stands come
from SCANFI there, which the pilot showed weak; in Ontario the FRI's 2D
package should be fetched per request (100–500 MB, cached) where one
covers the box.

**Stage 2, pre-baked by province.** The tile run from TILES.md, northern
Ontario first. An Ontario SD request then stitches in seconds, two hunters
in one valley share one set of files, and later the app can stream SD
under the view with no request at all. The run needs the TILES.md to-do
list first (the forest step, work-folder clearing, distance bands at the
margin, the index, runners on both PCs). Pre-baking the whole country at
the pilot's rate is 2,500 tile-hours, so it stays by province, where the
requests are; the cloud runner of SCALE-PLAN phase 3 is the way past that.

## Effort, by order of magnitude

Dev is sessions with Claude; compute is the PCs' time, unattended.

| Piece | Dev | Compute | Needed for |
| --- | --- | --- | --- |
| Data to R2, `VITE_DATA_BASE`, range check | half a day | an upload | everything on request |
| Worker: request fields, claim/status endpoints, area index from D1 | 1–2 days | | the loop |
| Email (Cloudflare Email Service binding, or Resend's free tier) | half a day | | the loop |
| Bake agent: watch, claim, SD bake, checklist gate, R2 upload, register | 2–3 days | SD ~15 min an area | SD on request |
| App: request card with email, runtime area registry, Requested row | 2–3 days | | the loop |
| National vectors adapter | 2–3 days | | SD outside ON/QC/YT |
| FRI package per request (Ontario stands in SD) | 1–2 days | | SD stands worth having |
| HD through the agent: WindNinja hand-off, stages, review parking | 1–2 days | 3–4 h an area on both PCs | HD on request |
| Payments by hand (payment link, a paid flag) | 0 | | the first customers |
| Stripe Checkout, unlocks, party share, Worker gate on HD files | 3–4 days | | HD at scale |
| SD tiles: the TILES.md to-dos, then the run | 3–5 days | 1–2 days of both PCs for the managed forest, as much again for the Far North; 15 GB | instant SD in Ontario |
| Live mode: the map with no area | 1–2 weeks | | exploring before asking; not needed for v1 |
| Streamed SD under the view, no request | 1–2 weeks | | later |

Measured, for the compute column: Highland Lake's SD-grade bake was 16 min,
two thirds of it the topo, imagery and MRDEM tile fetches. Sault's full
HD bake was 52 min (the point cloud 27 of them) and Lac Bailey's about
1.2 h on a 10 × 10 km core (the 1 m DEM and hillshade 18 min each);
WindNinja's 16 directions take 1.5–2 h with both PCs. The pilot's SD tile
was 4–6 min.

## The order

1. **Week 1: the loop, SD free.** R2; the Worker's endpoints and email;
   the agent with the SD steps; the request card and the runtime area
   registry. Ship: anyone can ask for an SD area in Ontario, Quebec or the
   Yukon from the app or the site and get an email in about 20 minutes.
2. **Week 2: HD to order, paid by hand.** The WindNinja hand-off and the
   review parking; HD offered where LiDAR exists; Gavan gets the request
   email and invoices. The FRI package per request. Ship: the 48 h promise
   is real and unattended.
3. **Then, in parallel as the PCs allow:** the national vectors adapter
   (SD anywhere); the tile to-dos and the northern Ontario run in the
   background whenever WindNinja is idle.
4. **When a stranger wants HD:** Stripe, unlocks, the party share, the
   Worker gate.
5. **After the season's demand gate (SCALE-PLAN):** Live mode, streamed
   SD, the cloud runner.

Roughly two weeks of sessions to a working loop with SD free and HD by
hand; four to six more for payments, Live mode and the province tiles.

## What could still force a rebake, and why it does not

- FRI stands in SD: only new SD bakes and tiles; the HD areas keep the
  FRI they have.
- The momentum bands split out of micro for staged loading (the wind-load
  notes): a micro-only rebake, 10 s an area, whenever that is built.
- A tile lattice change: the areas are not cut from tiles, so none.

## Decisions for Gavan

- The SD request's size: Pickle Lake's sizes around the point (26 × 16 km
  region, 8.5 × 8 km core), or the user's dragged 10 × 10 km square.
- Requests open to everyone, or by invitation while the PCs are the farm.
- The PCs as the farm: the agent runs at logon like the runners, and the
  48 h promise holds only while XEVO is on. A small always-on box or the
  cloud runner is the fix, not for now.
- HD price, one-off or a season (open since 2026-10-05).
- Whether the northern Ontario tile run starts now or after the loop ships
  (it is a day or more of both PCs either way).
