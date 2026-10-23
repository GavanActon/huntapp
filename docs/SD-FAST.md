# SD in minutes: bake the wind, stream the pictures

Status: plan, 2026-10-13. Nothing built. It builds on
[SD-HD-PLAN.md](SD-HD-PLAN.md) (the request loop), [TILES.md](TILES.md)
and [SURROGATE.md](SURROGATE.md) §7 (the SD wind step), and doesn't
repeat them.

## The finding

An SD request takes 34–76 minutes today (Searchmont 34, request 7 76).
The wind takes 1–2 of them. The rest is map pictures cut down to z16 and
the satellite bush model, and the ground wind reads neither.

- The ground wind reads one file, `micro-<id>.hab` (`model.ts` `loadMicro`).
  Without it the streaks fall back to the 10 m forecast.
- The plan still runs the wind near the end:
  - `wind-sd` waits for the whole dem step (309–732 s) just to read
    `mrdem-wide`, which takes 3–16 s.
  - `micro` waits for the whole habitat step, which includes the bush
    model (about 4 min). Micro uses none of the bush model's output.
- Most of the pictures already have a live source in the app, or are
  never drawn.

So: bake the grids, stream the pictures, and run the wind first.

## Each file: bake, stream or drop

Sizes are Searchmont's (291 km² region). "Live today" means `mapStyle.ts`
already draws a streamed layer when the area has no file.

| File | MB | What reads it | Live today | SD plan |
| --- | --- | --- | --- | --- |
| micro.hab | 6.9 | ground wind, streaks, scent, heat-map wind | none | **bake, pass 1** |
| habitat.hab | 2.7 | heat map, scores, scent column (defaults without) | none | bake, pass 2 |
| going.hab | 1.1 | routes, moose swing, scent relief | none | bake, pass 2 |
| dem pmtiles | 7.2 | elevation colours, DEM shade, blue lakes, bog tint | none | **stream: Mapterhorn** |
| hillshade pmtiles | 7.8 | nothing while a DEM is baked | MRDEM WMS | drop |
| topo pmtiles | 7.3 | Topo | Toporama WMS | stream |
| satellite pmtiles | 9.6 | imagery views | LIO imagery (Ontario) | stream; outside ON/QC the relief stand-in |
| historical pmtiles | 15.7 | Historical | none | drop for SD |
| contoursWide pmtiles | 1.0 | 10 m contours | none | stream: maplibre-contour on Mapterhorn |
| understory pmtiles | 9.4 | Bush view | none | bake, pass 2 (bush model, ~4 min) |
| forest pmtiles | 1.5 | forest fill and type | none | bake, pass 2 |
| places pmtiles | 0.1 | WMU, crown, parks, burns, roads | LIO for 5 themes (no roads) | bake, pass 2 |
| bathy, depth GeoJSON | 6.3 | lake depth lines and fills | LIO bathy | bake, pass 2 |
| waterbody GeoJSON | 2.0 | blue lakes over the elevation colours | none | bake, pass 2 |

Never drawn by the app: ara, bma, fmz (10.4 MB), rail, trails, trapline,
watercourse, wetland, fishing_access and bathy_index (bake inputs). The
place GeoJSON (wmu, camps, crown, parks, fire, roads) and the forest
GeoJSON are also never drawn when their archives exist, but the Offline
save still bundles them.

The pass-1 pack is about 7–10 MB (micro for a 10 × 10 km box plus its 5 km
margin). The whole SD pack is 87–114 MB today.

## What the SD wind needs

```
MRDEM window (3–16 s) ──> wind-sd: the net, 16 directions ──> windsd npz
                                                                 │
MRDEM + land cover windows ─┐                                    │
stands (FRI or SCANFI) ─────┼─> cover, height, crown, conifer, ──┴─> micro.hab
lakes (ids and areas) ──────┘   hardwood, lead, lakeId, fetch
```

- The net depends only on the DEM. A later micro rebake (better stands,
  say) reuses the windsd npz and takes seconds.
- Micro reads eight kinds of habitat band. It doesn't read `thick`, the
  distance bands or anything else from the bush model.
- Every input is a window read from a national COG, except the stands and
  lakes. Those come from FRI and LIO vectors in Ontario, and from SCANFI
  and land cover anywhere.

**Can the phone make micro's bands itself?** Some of them, but not the
expensive ones:

- **Pure DEM-and-water arithmetic:** drainage, pooling, upslope, `rel`,
  lake breeze and canopy. That's about 1.5 MB of the 6.9.
- **Needs a solve or the net:** the neutral and stable lids (a sparse
  Poisson solve), and momentum and turbulence (the net).

The phone-side bands bake in seconds, so moving them saves little for the
work it takes. **Keep micro baked whole.**

## The fast path, in order

### 1. A wind-first request (server, 1–2 days)

A new SD plan that ships the wind and nothing else, then keeps going.

- **Pass 1:**
  1. rasters
  2. `mrdem-wide` as its own step, with the hole fixed (see below)
  3. stands and water
  4. habitat without the bush model
  5. `wind-sd`
  6. micro
  7. upload micro and the area file, and mark the request ready

  With today's code reordered, that's about 4–8 min (the forest step is
  most of it). With step 2 below, it's about 1–2 min.
- **Pass 2**, as a later stage of the same request: the rest of the
  vectors, the bush model, going, the forest and places tiles, the depth
  layers, then micro again in seconds. Upload and update the manifest.
  The phone's kept copy already refreshes when the server's hash changes.
- **Drop from every SD plan:** topo, satellite, historical, hillshade, the
  dem tiles and contours-wide.
- **TTA knob:** `wind-sd --tta` runs 8 passes (7–80 s on XEVO's GPU).
  Score 1 and 2 passes against the five areas' WindNinja grids before
  choosing.

### 2. Stands and water from national rasters (server, about 1 day)

Write the eight habitat bands micro reads straight onto the lattice, with
no polygons:

- cover and lakes from land cover 2020;
- height, closure and broadleaf share from SCANFI;
- disturbance from CanLaD.

This is TILES.md's to-do 1. It makes pass 1 seconds, gives SD wind
anywhere in Canada without the vector adapters, and is the core of the
tiles in step 5. FRI stays the Ontario upgrade in pass 2.

### 3. The app streams the pictures (1–2 days)

- **Relief from Mapterhorn** (`tiles.mapterhorn.com/{z}/{x}/{y}.webp`,
  Terrarium encoding, 512 px tiles), as the `raster-dem` source wherever an
  area has no dem archive, and outside every area. That gives elevation
  colours and DEM shade anywhere.
  - Probed 2026-10-13: z15 tiles (about 1.6 m a pixel) at Pickle,
    Lac Bailey, Whitefish and Searchmont, so the HRDEM LiDAR is in it.
    z13 at Blanchard. Copernicus 30 m at z12 everywhere else.
  - No usage terms are published, and it's a community project. Mirror
    the Canadian archives to R2 before leaning on it. Attribution:
    Copernicus and the national sources.
- **Contours anywhere:** `maplibre-contour` on the same DEM.
- **Already live:** topo, satellite and hillshade fall back to their
  live layers today; nothing to build.
- **Historical:** no live source; SD goes without it.

### 4. The app opens areas it wasn't built with (about 2 days)

- A runtime area list: read `/areas/index.json` (the Worker already serves
  it from D1) and fetch `area.json` for an unknown id.
- Poll the request's status, then "Your ground wind is ready", then open
  it.
- Prerequisites:
  - uncomment the R2 switch in `.github/workflows/pages.yml` (still
    commented on 2026-10-13);
  - `BAKE_KEY` on the Worker and on XEVO;
  - the agent running at logon.

**After 1–4** (about a week of sessions): draw a box, wait 2–4 minutes,
and get SD ground wind on a map whose pictures stream. Heat, routes and
bush follow a few minutes later.

### 5. SD wind with no request: tiles (1–2 weeks)

- **The tiles:** wind-only tiles on the TILES.md lattice, from step 2's
  rasters plus the net.
  - About 30–60 s a tile on XEVO's GPU and about 3 MB each.
  - Northern Ontario is 3,600 tiles: 1–2 PC-days and about 11 GB on R2.
- **When they're baked:**
  - lazily, the first time someone looks at a tile (the same queue and
    agent), then kept on R2;
  - pre-warmed in road-density order.
- **App work:** `model.ts` takes a grid swapped in while it runs, for the
  tile under the view. Today it's one grid per run, so this is the bigger
  piece.

### 6. Later: the net on the phone

WebGPU is on by default in iOS 26 Safari and WKWebView. A width-halved
student net would need no wind bake at all, only the DEM and canopy
inputs (about 0.6 MB an area). That's weeks of work, not part of this
push.

## Offline

Streaming needs signal. Saving an SD box offline means the phone pulls
that box's tiles into its store: Mapterhorn to z13–15, Toporama and LIO
imagery. That fits the paid Save moment. All of those sources are open
licences (OGL, Copernicus); Esri's imagery is not.

## Trial: how streamed looks (2026-10-13)

Built behind a flag, uncommitted: `?pictures=stream` (kept on the phone;
`?pictures=baked` turns it off). With it on, the picture archives are
left out of the style. Relief, shade and contours come from Mapterhorn,
with contours cut on the phone by `maplibre-contour`. Topo and imagery
come from the live services. The code is in `app/src/map/streamPictures.ts`
plus two hooks, one in `mapStyle.ts` and one in `MapView.tsx`. With the
flag off, nothing changes.

Shot headless at four areas, five views (Topo, Sat, Hunt, Terrain, Wind)
and four zooms (11, 13, 15, 16.5), baked and streamed:

| Area | Streamed vs baked |
| --- | --- |
| Searchmont (SD) | Streamed is sharper from z13: Mapterhorn has the LiDAR, and the baked SD relief is 30 m, blocky in Terrain at z15+. |
| Pickle Lake (HD) | Nearly identical: the same HRDEM at the same 1.6 m. Baked adds the 1 m LiDAR shade in Terrain. |
| Blanchard River (HD) | Matches to z13. Mapterhorn stops there, against the baked ArcticDEM 2 m, so streamed is softer from z15. |
| Lac Bailey (HD) | Matches at every zoom. |

Three bugs found and fixed in the trial:

- **Contours went nearly empty past the deepest tile.** Mapterhorn
  answers 404 past its deepest zoom. The app now probes 13–15 once per
  area (three HEADs) and sets the source's max zoom to the deepest found.
- **No contour labels past z14.** Lines cut from LiDAR wander, so labels
  on streamed lines now allow 75°.
- **The live 30 m shade washed the live photo grey.** It now sits under
  the live imagery, as it already did under the baked imagery.

Gavan tried it on the dev server (2026-10-13): "Ontario works great.
Blanchard - weird." Past the box, BC has no province imagery service, so
streamed Sat showed the Toporama sheet round the photo, with the treeless
mountains black. Three changes followed:

- **Esri past the box (behind the flag).** Where no province publishes
  imagery, streamed uses Esri's photo, the one the area's sharp layer
  already streams over its box, as the imagery everywhere, as Ontario's
  service is used. Esri's terms want an ArcGIS key before this ships.
- **Toporama on white paper (for everyone, not only the flag).** The sheet
  leaves open ground and rock unfilled, which read as black over the map's
  dark ground. It now asks for an opaque sheet.
- **The address keeps `pictures=stream`.** An area switch loads a fresh
  address; the setting itself was never lost.

Zoomed out at Blanchard, streamed now looks better than baked: the photo,
the elevation colours and the contours run past the box, where baked
stops at its edge.

**The view's own look** (`app/src/map/viewLook.ts`, behind the flag). Gavan,
on Blanchard's mountains: "can we be smart about it? based on height?",
then "normalized by the view". The map library can't vary the shade by
height, and a dark veil above the treeline only muddied the photo, so the
look is set per view instead. Once the map settles, the app reads the
streamed heights under the view and sets two things:

- **Colours:** the elevation colours run from the view's 2nd to its 98th
  percentile height, snapped to round metres, and change only when the
  view's span moves by more than a sixth. On flat ground the span is at
  least 100 m from the low ground up; a 40 m floor turned a z15 view at
  Pickle all mid-ramp tan.
- **Shade:** the lit side of the shade over the photo fades as the view's
  share above the area's treeline grows: full below 10%, 15% at 60% or
  more.

Results:

- Blanchard: a mountain slope (22% alpine) gets the lit side at 0.79, the
  peaks (73%) at 0.15, and the valley at full strength. The wash is gone,
  the snow stays white, and the colours run on past the box.
- Pickle and Searchmont: about as before.

Not tested yet: load speed and bytes on a phone, and offline (streamed
needs signal). `maplibre-contour` is imported at the top level, so it
ships even with the flag off; import it lazily before this goes live.

## The fast pass, built (2026-10-13)

`pipeline/sd_wind.py --area <id>` makes the sd-wind job (docs/REQUESTS.md):
the area's ground wind and nothing else.

1. `pipeline/habitat_lite.py` writes the habitat bands the wind reads
   (cover, height, crown, conifer, hardwood, lead, the lakes) pixel by
   pixel from the 2020 land cover and SCANFI/CanLaD, with no polygons and
   no vectors.
2. The wide MRDEM window is read 4.5 km past the region, so the net's
   domain is never short.
3. `build_windsd.py` runs the net.
4. `build_microclimate.py --wind sd --habitat <the lite grid>` writes the
   wind file.

Measured on a new 20 × 20 km region near Wawa (inputs staged on XEVO):

| Step | Seconds |
| --- | --- |
| Lite habitat | 1.4 |
| Wide MRDEM | 1.9 |
| The net, 16 directions, 8-way averaged, XEVO's GPU | 21.6 |
| The wind file | 12.6 |
| **Total** | **37.5** |

Outside the staged boxes add about a minute for SCANFI's windows over the
network. The wind file is 9.2 MB.

Against Searchmont's published wind file (baked on the full habitat, FRI
stands), rebuilt this way:

- **Terrain wind:** the 16 directions turn a median 0.36° apart (0.43° at
  worst), and the speed comes out at 0.98 of the full bake's.
- **The canopy band (head-height fraction):** the same median (0.092), but
  10% of cells differ by 0.5 or more, where SCANFI and the FRI disagree on
  open ground against stand (the ski runs among them).
- **Tree height:** a median 17 m against 19 m.

The full pass that follows bakes the wind file again on the real habitat,
so those cells settle within minutes.

## SD wind for anyone: the national tiles (2026-10-13)

Gavan: "SD wind then becomes something anyone can have right away." Then
"Go." on a pilot block.

- **The bake:** `pipeline/wind_tiles.py` bakes the fast pass for each 11
  km tile of the national lattice (tiles.py's), with a 150-cell margin
  (about 4.4 km), and cuts the result back to the tile: the app's micro
  grid form with its preview bands, about 2.2 MB a tile.
  - `bake --box W S E N --jobs 2` bakes; `seams --box` checks;
    `upload` sends to R2 at `data/sd/v1/` with an `index.json`.
- **The pilot:** 121 tiles (11 × 11, t-628-410 to t-638-420) round White
  River, Wawa and Pickle Lake, about 20 s a tile two at a time on XEVO.
- **Seams:** across 73 tile edges every band checked (momentum, lids,
  drainage, pooling, lake bearing, canopy) matches the neighbour at the
  median. The worst 5% of the lids' cells differ by one storage step
  (1/60).
- **In the app** (`app/src/weather/micro/windTiles.ts`, behind the
  streamed-pictures flag):
  - Past the active area's box, the 2 × 2 tiles round the view are fetched
    from R2, unpacked and stitched into one grid on the same lattice.
  - `model.ts` `useMosaic` puts that grid in the area grid's place, and
    `useAreaGrid` restores the area's grid back over its box, so HD wins
    where it exists.
  - The block is rebuilt only when the view's centre comes within half a
    tile of its edge, and a tile not yet baked is filled with the plain
    wind.
- **Checked on the dev site:** 50 km east of Pickle Lake the block
  stitched in 0.8–0.9 s. Along a 4 km line the ground wind went from the
  forecast's flat 1.2–1.3 km/h to 0.1–0.3 km/h, calm under the closed
  forest and up at the openings.

### The order: where the most is hunted (2026-10-14)

Gavan: "Focus in around WMUs with the most moose tags, deer harvest
numbers. Same with Quebec."

- **The queue:** `pipeline/hunt_priority.py` writes it from a ranks file,
  `pipeline/raw/windtiles/ranks.json`, with each province's units best
  first:
  - Ontario's moose WMUs by 2025 harvest, alternating with its deer WMUs.
  - Québec's moose zones by the 2024–25 harvest, alternating with its deer
    zones.
  - The provinces alternate rank by rank, and each unit's tiles come in a
    row.
- **Outlines:**
  - Ontario's come from LIO's WILDADMU, staged.
  - Québec's come from SmartFaune's WFS. They are fetched one outline at a
    time (the server drops big answers), for ranked zones only, and kept in
    `pipeline/raw` only, because their licence is not stated.
- **Staged first:** a tile whose maps `stage.py` has copied to the PC
  bakes in about 55 s; one reading SCANFI over the network takes 140–180 s.
  So tiles inside a staged box (on-north, on-south, qc-south) go first,
  each group in the hunting order.
- **`bake --queue`:**
  - It reads the queue file again before every tile, so the order can
    change while it runs.
  - A tile already done is skipped, so a stopped run picks up where it
    left off.
  - It uploads to R2 every 50 tiles.
- **The first night on XEVO** (two at a time, 00:20 to 05:51):
  - 621 tiles with no errors, about 113 an hour.
  - Whole units: Ontario 15B, 92, 4 and 43B.
  - Partly done: Québec 01 (90 of 265 tiles) and 10 (55 of 229).
  - 742 tiles on R2 with the pilot, 1.5 GB in all.
  - Windows Update's restart ended it. The two tiles it cut off left
    nothing behind, so they are redone.
  - To carry on: `py -3.14 pipeline/wind_tiles.py bake --queue
    pipeline/raw/windtiles/queue.txt --jobs 2 --upload-every 50`.
- **Pause:** a file named `PAUSE` beside the queue (`pause-bake.cmd` and
  `resume-bake.cmd` there make and remove it). Each job finishes its tile
  and the tiles so far go to R2, then it waits until the file is gone.
- **Retries (2026-10-15):** a tile that fails goes back in its place 10
  minutes on, up to 3 tries. The first day lost 10 tiles this way: one to
  a GPU shared with another job, and nine in one minute when the
  elevation server's name would not resolve.
- **More maps staged (2026-10-15):** qc-north (Québec 19, 29, 28, 18:
  2,674 tiles) and on-farnorth (Ontario 1C, 2: 795 tiles), so only 82
  scattered tiles still read over the network.
- **One queue in R2 (2026-10-23; Gavan: "why not just queue everything in r2?"):** hand-cut lists baked ~3,000 tiles twice while XEVO and xonix were apart. `pipeline/r2_queue.py` keeps the order and the claims in R2 (queue/sd-v1/): a machine claims the next tile with a write R2 refuses if another got there first (If-None-Match), a lapsed claim (1 h) is taken over with If-Match, and a finished tile is marked done and never handed out again. `wind_tiles.py bake --r2-queue sd-v1 --jobs N` on any machine, any network; `r2_queue.py status sd-v1`, `pause` and `resume` from anywhere; `r2_queue.py order sd-v1 <lists, best first> --skip-present "data/sd/v1/{id}.hab"` re-ranks it. Built for the HD bakes too (WindNinja directions, PALM runs: a longer lease and renew()).
- **More than one machine (2026-10-15):** the bake moves to xonix as GPU jobs
  in the shared job system (docs/SCENT-TESTSET.md, the service section).
  - `wind_tiles.py batches --queue Q --size 50 --out-dir D` cuts the queue
    into batch files of tiles neither R2 nor this machine has yet.
  - A batch file is itself a queue: `bake --queue <batch> --jobs 3
    --upload-every 0`. It exits when the batch is done, and PAUSE beside
    it freezes it.
  - `upload` now writes an index of every tile on R2, so one machine's
    upload doesn't drop another's tiles.
- **Left:** 9,923 tiles, about 6,400 staged and 3,550 over the network,
  roughly 130 hours on XEVO alone.

## The dev site (2026-10-13)

A place to try builds on the phone without touching the live app:
https://hunt-dev.groundwind.app (also
https://groundwind-hunt-dev.gavan-acton.workers.dev). The domain is
attached in the dashboard, on the Worker's Domains page. dev.hunt.groundwind.app
was tried first and never got a certificate: Cloudflare's free one covers
a single level under groundwind.app.

- **What it is:** a Worker named `groundwind-hunt-dev` holding only the
  built app (`app/dev-site/wrangler.toml`): no code, bindings, routes or
  cron.
- **Deploy (2026-10-14, docs/DEPLOY.md):**
  - Every push to `main` puts main's build here.
  - `app/scripts/deploy-dev.ps1` now sends a working tree to a preview
    address, https://try-groundwind-hunt-dev.gavan-acton.workers.dev.
  - The live app moves only with the `live` branch.
- **Data:** read from R2 (`VITE_DATA_BASE`), which this forces first; the
  script syncs R2's manifests. R2's CORS allows the dev origins.
- **On the page:** a DEV badge shows the build and whether pictures are
  streamed or baked; tapping it switches them. Usage stats are off
  (`VITE_DEV_SITE`). Shared wind checks still send, since they're real
  observations.
- **Not yet:** area requests from the dev site. The live Worker's
  request endpoint lists the dev origin in `site/worker.js` (4f2b48d), but
  that change isn't deployed yet.
- **Before the live app reads R2:** dev and live share R2's `data/`, so
  give the dev site a prefix of its own first.
- **What went wrong first:** `wrangler pages project create` run from
  `site/` made a copy of the live site's Worker that took groundwind.app's
  domains for about half an hour (Gavan moved them back in the dashboard).
  Wrangler is now never run from `site/` for anything but the site.

## To measure on the first runs

- TTA 8, 2 and 1 against WindNinja on the five areas: time and turn error.
- Predict time on a CPU. It has never been timed, and it decides whether a
  cheap always-on box can bake SD without a GPU.
- Mapterhorn relief against the MRDEM tiles at z13–15 (faceting on
  overzoom).

## Found on the way

- `pipeline/tiles.py` calls `habfile` without importing it, a NameError
  since 194dc05. No tile has been baked since 2026-10-06.
- `wind-sd` stops when `mrdem-wide`'s z10 window falls short of the
  region plus 2.5 km.
- Searchmont's area file lists habitat, micro and going as missing, but
  all three are on disk.
- The Offline save bundles place GeoJSON the app never draws.
