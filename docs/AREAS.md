# Areas: more than one place on the map

An **area** is one place the app knows in full detail: its bounds, its camp,
its compass correction and hunting zone, and the layers baked for it
(relief, forest stands, water, roads, and the habitat, wind and going
grids). Pickle Lake, Ontario, was the only one, and it was compiled into the
app. This doc covers three things: how the app holds several areas, how a
new one is baked from a single point, and where that is heading. The goal is
that a user asks for a location, we dig up every layer we can for it, and it
appears on their map.

The first area added this way is **Lac Bailey**, Quebec (49.40955,
−69.55349). It is a friend's moose spot, sent from a Garmin inReach on
2026-10-03.

## Why it had to change

- `REGION`, `CORE`, `HOME` and the camp were constants in
  `app/src/config.ts`, read by 16 files. Those files cover the map's fence,
  the GPS and weather pull-ins, the wind grid, the habitat, wind and going
  grids, and the route core. A point in Quebec was pulled into the Pickle Lake
  box, so even its weather came from the box's corner, 1,170 km away.
- The compass correction was fixed at −6° for Pickle Lake. At Lac Bailey it
  is −16.1° (WMM2025).
- The pipeline read the region out of config.ts with a regex. Half of its
  sources only exist in Ontario: LIO, the FRI forest inventory and point
  clouds, and the Ontario imagery.
- All 130 MB of baked data is committed to git and shipped inside the Pages
  build. That works for one or two areas, but not for areas made on request:
  each rebake adds to the repo's history, and Pages caps a site at 1 GB.

## The area file

Each area is one JSON file, `app/src/areas/<id>.json`. It is the one
description of the area that both the app and the pipeline read, as
config.ts was before:

```jsonc
{
  "id": "lac-bailey",
  "name": "Lac Bailey",
  "jurisdiction": "QC",                      // which source adapters bake it
  "centre": [-69.55349, 49.40955],           // lon, lat
  "home": { "center": [-69.55349, 49.40955], "zoom": 13 },
  "region": { "west": -69.693, "south": 49.329, "east": -69.414, "north": 49.49 },
  "core": { "west": -69.623, "south": 49.364, "east": -69.484, "north": 49.455, "maxzoom": 16 },
  "regionMaxzoom": 13,
  "declination": -16.1,                      // degrees, west negative, WMM2025 at the centre
  "timezone": "America/Toronto",
  "zone": { "label": "Zone", "name": "18" }, // "WMU 21B" at Pickle Lake
  "relief": [300, 500],                      // the core's elevation range for the relief colours
  "base": "areas/lac-bailey/",               // where its files live under data/ ("" = flat)
  "live": { "lio": false, "satellite": "qc" },
  "presets": [{ "name": "Shared spot", "lon": -69.55349, "lat": 49.40955, "kind": "stand" }],
  "files": { "pmtiles": ["topo", "satellite", "…"], "geo": ["wmu", "…"], "grids": ["habitat", "micro", "going"] },
  "bake": { "hrdem": ["…2023…", "…2015_17…"], "vectors": "qc", "forest": { "adapter": "qc.ecoforestier" }, "…": "…" },
  "coverage": {}                             // written by the bake (below)
}
```

- **Region and core**: the region is the wider map, baked to
  `regionMaxzoom`. The core is the full-detail block where the 1 m LiDAR
  and the habitat, wind and going grids live. At Pickle Lake that is about
  4 km around the camp. At Lac Bailey it is **5 km each way from the shared
  spot**, 10 × 10 km. That size takes in the loop Gavan drew west of the lake
  (3.6 km north to 2.5 km south of the spot, and 2.5 km west), with room to
  spare.
- **Presets**: the area's fixed pins. The first one is "home", which is what
  the strip and the routes start from when there is no GPS fix.
- **Files**: which layers the area has, so the app never asks for one that
  was not made.
- **Bake**: the sources the pipeline uses, which only the pipeline reads.
- **Coverage**: the bake writes what it made for each layer: the file, its
  bytes, its source, its licence and its date (for example "LiDAR flown
  2024-07-27"). For each missing layer it writes why it is missing. The app
  shows this under the area's About.

Baked files are named `<layer>-<id>.<ext>`, for example
`dem-lac-bailey.pmtiles` and `habitat-lac-bailey.hab`. Pickle Lake's files
stay flat in `app/public/data` with the names and URLs they have always
had, so installed phones and saved maps keep working. New areas' files go
in `app/public/data/areas/<id>/`. The phone stores files by name, and the
names already carry the area id, so two areas sit side by side.
`data/manifest.json` stays as it is for Pickle Lake. Each new area gets
`data/areas/<id>/manifest.json`, and the list of areas is
`data/areas/index.json`.

## In the app

- **One active area at a time.** config.ts resolves the active area when the
  app starts: the id saved on the phone, else Pickle Lake. Every export
  (`REGION`, `CORE`, `HOME`, `PLACES`, the file names) then comes from it, so
  the files that import them do not change.
- **Switching reloads the app.** The active id is saved, the map view to
  open on is saved, and the page reloads. Every module then starts clean on
  the new area. This leaves no source swaps or caches to carry over, which is
  the safe choice while the app is in use in the field. It costs a second or
  two, which is fine for something done once per trip.
- **Going to a place in another area switches to it.** That covers a pin, a
  pasted coordinate, or a GPS fix inside another area's box. A place in no
  area at all gets "No detail here yet", with the coordinates.
- **Coordinates go in.** A box (in the ⋯ menu) takes "N 49.409550° W
  69.553490°" as Garmin writes it, "49.40955, -69.55349", or degrees and
  minutes. It goes there, switching area if it needs to, and offers to drop a
  pin.
- **Pins work anywhere.** Pins are just positions. The Pins sheet lists them
  all; picking one in another area switches to that area.
- **Area-specific stores are keyed by area.** That covers the saved map view,
  the wind grid cache and anything else that only makes sense in one place.
  The hunt log, wind checks and tracks keep their own positions and stay as
  they are.
- **The compass** takes the area's declination.
- **Offline**: Settings → Maps on this phone lists each area, with its own
  download, size and remove. A phone only fetches the areas it is asked for.

## Hosting

For now, area files are built into the app, and baked data is served from
the same site by the Pages build. Pickle Lake's data stays flat in
`app/public/data`, and other areas' data goes in
`app/public/data/areas/<id>/`. That is fine for two areas.

Before areas are made on request, the data moves to object storage
(Cloudflare R2, where the Sandies server already runs) with range requests
and CORS for PMTiles. `VITE_DATA_BASE` already points the app at another
address. At that point the area list itself is fetched (`data/areas.json`)
rather than built in. The built-in areas stay as the fallback when there is
no signal.

## Baking an area

`python pipeline/bake_area.py --lat 49.40955 --lon -69.55349 --name "Lac Bailey"`
writes the area file (bounds, declination, jurisdiction, zone) and then runs
the bakes for it. Every script reads the area through `common.py` (from
`--area <id>` or `HUNTAPP_AREA`), so none of them read config.ts any more.

Each layer has a **normal form**: the file name and the property names that
the app and the downstream bakes read. For example, the forest stands carry
`group`, `species`, `year`, `ht`, `cc`, `conif`, `hard`, `poly`, `dep` and
`deptype` (`pipeline/build_forest.py`). Behind each normal form sit **source
adapters**, and each adapter says where it covers. The bake picks the best
adapter that covers the area for each layer:

| Layer | Ontario | Quebec | National / anywhere |
| --- | --- | --- | --- |
| 1 m LiDAR (relief, contours, DEM) | HRDEM | HRDEM | HRDEM, project found by STAC search |
| 30 m elevation, 10 m contours | — | — | MRDEM |
| Forest stands and their age | FRI FIMv2 | Carte écoforestière (4th inventory) plus later cuts, fires and outbreaks | (SCANFI, not checked) |
| Burns | LIO fire | `ca_feu` layer | (NBAC, not checked) |
| Lakes, streams | OHN (LIO) | GRHQ | NHN, OSM |
| Wetlands | LIO wetlands | Milieux humides potentiels | land cover |
| Roads | MNRF roads (LIO) | AQréseau, forest roads included | OSM |
| Hunting zone, territories | WMU, parks, Crown land, camps (LIO) | Hunting zones, TRQ territories | — |
| Imagery | Ontario Imagery | Quebec 2023 20 cm ortho / `Imagerie_GQ` | — |
| Topo, historical sheets | — | — | Toporama, CanMatrix |
| Bush thickness, shooting lanes | FRI SPL point clouds (COPC) | MRNF point clouds (LAZ) | canopy height from HRDEM surface minus ground |
| Land cover | — | — | NRCan 2020 |

The derived bakes, `build_habitat.py`, `build_microclimate.py`,
`build_going.py` and `build_vegstructure.py`, run unchanged on the normal
forms. The Spots score, the ground wind, the routes and the scent cone
therefore work the same in any area that has its layers.

Lake depths, lake survey sheets and fish species are Ontario-only and are
for fishing. An area without them simply has no Lake depths layer.

## Requests: where this is heading

1. **Ask**: "Request this area" (on the "No detail here yet" card) sends the
   point and a name to the Sandies server, where it waits in a queue.
2. **Bake**: in a province that already has adapters (Ontario, Quebec), the
   bake runs unattended: a point goes in and an area pack comes out.
3. **Dig in**: a new province needs one round of research, like the
   2026-10-03 Quebec check. It establishes which sources cover the point,
   their licences, field names and quirks, and then the adapters get
   written. After that, every point in that province is automatic. An agent
   working from this doc's table could do most of that research.
4. **Ship**: the pack is uploaded to the data store and added to
   `areas.json`, and the phone that asked sees it next time it is online.

A national baseline would make any request in Canada useful on the first
day. The Canadian Forest Service publishes national 30 m forest
attributes and disturbance history (SCANFI, CanLaD), which could feed a
coarser moose score where no province is wired up yet. These have **not
been checked**.

Bakes run on the PC that has the pipeline (Python 3.13/3.14, GDAL, and
gigabytes of point cloud), then later on a cloud machine. Whether requests
are open to every user or by invitation is still to be decided. A full area
is 120–200 MB: Pickle Lake's pack is 120 MB, and Lac Bailey's is 198 MB
because its core is 10 × 10 km. The 1 m LiDAR hillshade is the largest
part, at 62 MB.

## Licences

Only openly licensed data goes into an area pack, and each layer's
attribution travels in the area file:

- Ontario: OGL-Ontario.
- NRCan: OGL-Canada.
- Quebec: CC BY 4.0.

Quebec's "Territoires fauniques structurés" file (ZECs, outfitters,
wildlife reserves) is CC BY-NC-ND. It is not used. The "Territoires
récréatifs du Québec" (TRQ) layer has the same boundaries under CC BY 4.0.

## Lac Bailey, Quebec

Centre 49.40955, −69.55349. This is sheet 22F05NE "Rivière au Brochet",
hunting zone 18, on unorganised Crown land; Zec Labrieville is 5.1 km away.
Lac Bailey (82 ha) is 253 m from the pin. Within 3 km, 74% of the ground is
the 1991 burn, birch and jack pine, and nothing has been cut since 2009. The
nearest young cuts (2012–13) start 3.4 km out. All of the following was
checked live at the point on 2026-10-03:

- **LiDAR**: HRDEM `QC-600023_29_LacAuBrochet_MTM7_2023-1m`, flown
  2024-07-27; the MRNF derived MNT, canopy height (MHC) and slope are on
  sheet 22F05NE. MRNF heights are CGVD28 and HRDEM's are CGVD2013, so they
  differ by 0.2–0.5 m; don't mix them.
- **Point cloud**: MRNF LAZ 1.4 (not COPC), 2.5 points/m² nominal, ground
  classified and vegetation not. The download index is the WFS
  `servicesvecto3.mern.gouv.qc.ca/geoserver/Index_Telechargement_Lidar_Pub/wfs`.
- **Forest**: WFS `geoegl.msp.gouv.qc.ca/ws/mffpecofor.fcgi`. Layer
  `ms:ori_pee_close_scale` has the original stands. Later disturbances are in
  `ms:ca_interv_for_close_scale`, `ms:ca_feu_close_scale` and
  `ms:ca_perturb_autre_close_scale`. Use WFS **1.0.0** with a lon/lat bbox
  and exactly `outputFormat=application/json; subtype=geojson;
  charset=iso-8859-1`. Shorter format names return an error or XML.
- **Water**: GRHQ REST
  `servicescarto.mrnf.gouv.qc.ca/pes/rest/services/Territoire/GRHQ_WMS/MapServer`
  (layer 23 is lakes, layer 15 is streams).
- **Wetlands**:
  `geo.environnement.gouv.qc.ca/donnees/rest/services/Biodiversite/MH_potentiels/MapServer/0`.
- **Roads**: AQréseau REST `…/Territoire/AQreseau_WMS/MapServer/62` ("Autre
  route"). These are the multi-use forest roads: one is 63 m from the pin,
  and there are 11.8 km within 3 km. OSM has none within 3 km.
- **Territories**: the TRQ file
  `diffusion.mern.gouv.qc.ca/diffusion/RGQ/Vectoriel/Theme/Regional/TRQ/FGDB/TRQ.gdb.zip`
  (34 MB). The hunting zone comes from WFS
  `servicesvecto3.mern.gouv.qc.ca/geoserver/SmartFaunePub/ows`, layer
  `Zone_chasse_da3_sefaq` (WFS 1.1.0, lat/lon bbox).
- **Imagery**: the 20 cm ortho, flown August–October 2023 (CC BY 4.0), and
  the WMTS
  `servicesmatriciels.mern.gouv.qc.ca/erdas-iws/ogc/wmts/Imagerie_Continue`,
  layer `Imagerie_GQ`.
- The MRNF and MERN GeoServers and geoegl refuse browser origins, so they
  are baked, never fetched live. The MRNF ArcGIS server is slow and often
  returns 503s, so retry.

## Status

Built on branch `areas` (2026-10-03/04). Not yet merged or deployed.

**App**
- The area is resolved once at startup, silently: `?area=<id>`, else the
  saved one, else Pickle Lake. There is never a picker or a question on
  load (Gavan's requirement).
- Switching saves the area and the view, then reloads. It is set off by a
  pin, a place, a hunt-log entry, an outing or a coordinate in another
  area.
- A GPS fix inside another area shows one small chip. It blocks nothing,
  and once dismissed with × it stays dismissed for that area.
- Go to coordinates (⋯ menu) reads Garmin's "N 49.409550° W 69.553490°",
  decimal degrees, degrees and minutes, DMS and map links.
- Maps on this phone has one block per area, with its own download and
  remove, and a "What's in it" list built from the coverage report.
- Another area's presets are folded at the bottom of the Pins list.
- Saving another area's maps with signal also fetches that area's weather.
- Wind-check lessons stay in their own area.
- Lac Bailey shows its 1 m contours only from z15
  (`"contours": {"fineFrom": 15}`), because its slopes run 35–37°.
- Pickle Lake is unchanged on an existing phone. Its map style dump is
  byte-identical to the one taken before the work, as are its data URLs
  and its saved view, profile and routes.

**Pipeline**
- `area.py` reads the area file, and `bake_area.py` bakes an area end to
  end.
- The 1 m LiDAR comes from NRCan's catalogue, newest survey first. Gaps
  are filled from older surveys, with a 30 m blend at the seam.
- Quebec adapters (`qc_vectors.py`, `qc_forest.py`, `qc_pointcloud.py`)
  write the same normal forms as Ontario's.
- Pickle Lake's rebakes into a scratch folder are byte-identical, and its
  grids are band-identical.

**Lac Bailey**: 18 files, 198 MB, all openly licensed.
- Toporama topo, the 2023 20 cm aerial imagery and the 1 m LiDAR relief
  and contours.
- 7,583 forest stands, with later cuts, burns and outbreaks laid over
  them.
- Lakes, wetlands, forest roads, burns since 1916 and Zec Labrieville.
- Bush thickness and shooting lanes from 128 point-cloud tiles over the
  whole core.
- The habitat, wind and going grids.

Decisions made along the way:
- The hunting-zone polygon is left out, because its only source
  (SmartFaune) states no licence. The area file names the zone instead.
- Lac Bailey's habitat takes its bush thickness from the point cloud
  wherever the LiDAR measured, using the going grid's own calibration
  (`bake.habitatBush: "pointcloud"`). Pickle Lake is not opted in.
- Power lines are open ground. Alder and treed muskeg keep their own
  classes.
- Old burns no longer age ground the forest map shows unburned.
- Bake-only GeoJSON (forest, streams, wetlands) is gitignored and never
  downloaded.

Still open:
- None of this has been field-checked. Lac Bailey's LiDAR bush may read a
  little light against Pickle Lake's single-photon survey.
- The pack is large for a phone. Smaller tiles, or leaving the historical
  sheets out, would bring it down.
- The request flow and the move to R2 are next. See Requests and Hosting.
- The national baseline (SCANFI, CanLaD) has not been checked.
