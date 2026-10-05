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

- **One active area at a time.** The active area is settled when the app
  starts, before config.ts is read: a link's, else the id saved on the
  phone, else Pickle Lake (see Links and sharing). Every export (`REGION`,
  `CORE`, `HOME`, `PLACES`, the file names) then comes from it, so the files
  that import them do not change.
- **Switching loads the new area.** The active id is saved, the map view to
  open on is saved, and the page loads the new area's address. Every module
  then starts clean on the new area. This leaves no source swaps or caches
  to carry over, which is the safe choice while the app is in use in the
  field. It costs a second or two, which is fine for something done once
  per trip.
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

## Links and sharing

The app's own links, so an area or a spot can be sent to someone: Mat's
stand to Gavan, or Lac Bailey to Mat's buddy.

**The links** (`app/src/share/link.ts`; `node scripts/check-links.mts` in
`app/` checks them):

- An area: `https://gavanacton.github.io/huntapp/?area=lac-bailey`.
- A spot:
  `https://gavanacton.github.io/huntapp/?area=lac-bailey#at=49.40955,-69.55349&pin=Mat%27s+stand`.
  The area rides in the query, where index.html's head script reads it
  before the app loads. The point and its name ride in the fragment, which
  GitHub, link previews and server logs never see.
- A point in no area: `https://gavanacton.github.io/huntapp/#at=49.60000,-70.20000`.
- `at` is lat,lon to 5 decimals (about 1 m). `pin` is the name, at most 40
  characters, left out when there is none or the pin is still called Pin.
  `z` is read but never written. Reading is lenient: a bad id or a point
  off the globe is left out.
- Links are built on the deployed address (`VITE_SHARE_BASE` overrides it),
  never the page's own, so a share from the dev server does not send a LAN
  address.
- A share is text and the link: the name and area, the coordinates as Copy
  coordinates writes them, and a Google Maps link, then the app's link.
  Satellite messages carry text only, so in the bush the coordinates line
  is what works.

**Landing.** One decision at startup (`app/src/areas/start.ts`), never a
question: opening a link is the choice.

- Which area opens, first match wins: the area whose region holds the
  spot; the link's area; the area saved on the phone; an iPhone install's
  seed (`?start=`, only while nothing is saved); Pickle Lake. An area that
  comes from a link is saved as the link opens; a reload or a back of it
  is not saved again, so a tab left on a link does not undo a later switch.
- A spot in an area opens there at zoom 15 (or the link's `z`), north up.
  It is shown, not kept: a ring with its name (on a place, the place's own
  label), and the map's tap popup at the point, titled with the name (or
  the coordinates). It becomes a pin only when Pin is tapped (Gavan,
  2026-10-04). A pin of yours already there under the same name (within
  25 m) is shown instead. Location stays on, but follow is held, so the
  first fix does not take the map off it. A link to an area other than the
  phone's own holds follow the same way.
- A point in no area opens Go to coordinates holding it: "No detail here
  yet", with the coordinates.
- Every arrival goes into Go to coordinates' Recent (`huntapp-goto-recent`,
  the last 5).
- The arrival happens once per tab and link: `huntapp-link-done` in
  sessionStorage is written once the spot is up, so a reload or a back
  opens on the last moved view, not the spot again, while a reload of a
  load that never got that far (weak signal, an old build the update
  replaced) still shows it. With no sessionStorage, a reload or a back
  counts as shown. A switch forgets the mark, so the link tapped again
  later shows the spot again.
- The address always names the area the app is in: `?area=<id>`, Pickle
  Lake's bare unless a link named it. A switch loads the new area's address
  instead of reloading, so the reloads that follow (a download's, an
  update's) stay in the area, and Safari's Share, Open in Safari and Add to
  Home Screen carry it.
- A link that changes only the fragment of a page already open (an Android
  install that had it open) is done in place, switching area if it has to.
- A Pickle phone opening the plain address: nothing is written, the address
  is left alone, and the map style is byte-identical.

**Installing.**

- iPhone: a tapped link always opens Safari (or an in-app browser), never
  the home-screen app, and an icon added from Safari starts at its
  manifest's `start_url` with storage of its own. WebKit keeps the first
  manifest link in the head, so the head script puts the area's own
  manifest ahead of the app's, only where `navigator.standalone` exists,
  and names the page and the icon for the area. It picks the area in the
  same order the app does (the spot's, the link's, the phone's, the
  seed), so the two never disagree. The build writes
  `manifest-<id>.webmanifest` for each area but Pickle Lake: "Lac Bailey —
  hunt maps", short name "Lac Bailey", `start_url` `./?start=lac-bailey`,
  no id (precached, so an icon added with no signal still gets it). The
  seed opens the area on the icon's first launch only; after that the app
  opens wherever it was last switched to. Icons added before keep opening
  Pickle Lake first. Not yet tried on a device.
- Android (Chrome): the installed app shares Chrome's storage, so the area
  and the view a link left are there, and links in its scope open the
  installed app. The app's own manifest is unchanged.
- A later spot link on an iPhone opens Safari. To get it into the icon,
  copy the link (Share › Copy, or a long press on it), then ⋯ › Paste in
  the app, which reads the app's own links.

**Sending.** Nothing is added to the map's own screen: Share is a level
down (`app/src/share/share.ts`).

- A pin: its popup's Delete · Share · Open. It goes with its name, unless
  it is still called Pin.
- Any tapped point, or a preset: Dig in's ⋯ › Share. A place tapped on
  itself goes with its name and its own point; "650 m NE of Camp" goes
  unnamed. The tap popup stays weather, score, Scent, Heard, Pin and Dig in.
- An area: ⋯ › Locations lists every area (the one the app is in first,
  each with its home place and whether its maps are saved); a tap goes
  there, and each row's Share sends that area's link. This is how an app
  on a home screen, with no address bar, sends itself.
- Share is called inside the tap, nothing awaited first, as iOS refuses it
  otherwise. Without a share sheet the whole message goes to the clipboard,
  and the button says "Copied" only once the clipboard has it, "Could not
  copy" when not. Dig in's Copy coordinates now says the same.

**Pasting** (Go to coordinates, `app/src/ui/sheets/CoordsSheet.tsx` and
`app/src/map/goto.ts`): the point on the map in two or three taps, with no
keyboard, and no signal needed, so it is the way for a position that came
by satellite or inReach.

- ⋯ › Go to coordinates has Paste at its end. It reads the clipboard inside
  the tap (iOS shows its own Paste bubble, Chrome asks once). A whole place
  goes straight there; anything else opens the sheet holding it: an area's
  link (with Go to Lac Bailey), words with no position, nothing, or no
  access. The menu stays up until the read is done.
- The sheet opens at 46% with Paste on top and the box unfocused, so no
  keyboard comes up and the map stays in view. A paste into the box by the
  phone (a long press, Gboard's chip) also goes straight there, so it works
  with clipboard access refused. Under the box: every area's home (Pickle
  Lake · Camp, Lac Bailey · Shared spot), this area first, then Recent.
- `parsePlace` (`app/src/map/coords.ts`) reads whole messages: the app's
  own links win (the area and the pin's name with them), links are taken
  out before numbers are read (an inReach short link no longer reads as
  3, 7), "Mat's stand" has no S for south, and "Stand 2:", "Zone 18:" and
  "±5 m" beside the pair no longer break it. On 31 more formats it gives
  the same point as the old parser, or reads one the old parser could not
  (`node scripts/check-links.mts` keeps both tables).
- Typed, a position counts only once both axes are good to about 200 m (3
  decimals, minutes to 0.1, or seconds): until then there is no read-out,
  no Go, and the go key waits, so "49.40955, -69.5" cannot send the map
  off. The read-out says it back the way it was written (N/W stays N/W).
  The text survives a tap off the sheet.
- A place in no area: "No detail here yet", with Copy, Maps (Google Maps at
  the point) and Pin; the go key puts the keyboard away.
- Recent is the last 5 places gone to, from links, pastes, typing and the
  rows themselves (`huntapp-goto-recent`), each with its name or
  coordinates, its area when not this one, and how long ago. A tap shows
  it again; it never brings back a pin you deleted.

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
| Forest stands and their age | FRI FIMv2 | Carte écoforestière (4th inventory) plus later cuts, fires and outbreaks | Inferred from SCANFI v2 (2025) and CanLaD (1985–2025): `ca_forest.py`, adapter `ca.scanfi` |
| Burns | LIO fire | `ca_feu` layer | CanLaD in the inferred stands; NBAC (WFS, 1972–2025) checked, not wired |
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

A national baseline makes any request in Canada useful on the first day.
`ca_forest.py` (adapter `ca.scanfi`) infers stands from the Canadian
Forest Service's national 30 m maps:
- **SCANFI v2:** each species' share of the crown, height, closure and
  median age, as of 2025.
- **CanLaD v1.1:** the latest cut or burn and its year, 1985–2025.

Both are national GeoTIFFs read by window, so a region takes about a minute
and nothing national is downloaded. The stands are a model's estimates:
- conifer against hardwood holds up;
- the lead species less so;
- broadleaf is one class (aspen, birch and maple alike);
- the readme warns accuracy is lower in the Yukon.

First used for the Sault test area (2026-10-04), where the Algoma Forest
FRI is FIMv1 only.

Tried and dropped there: telling hardwood from conifer by the leaf-off
against the leaf-on HRDEM surface models. Bare branches still hold the
surface up.

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

## Highland Lake, Yukon

Centre 63.3606, −134.7600 (a plus code Gavan sent), on Highland Lake
(Et'aghro, about 91 ha), sheet 105M/07. It is in game management subzone
4-09 and outfitting concession 7, in Na-Cho Nyäk Dun traditional territory.
It is not on settlement land: the nearest parcel is a 1 ha Category B site
on the shore. No road, trail or cut line in any open layer comes within
10 km, so this is fly-in country. Declination is +18.2°.

It is the first area with **no 1 m LiDAR**: the nearest HRDEM survey is
Mayo, at least 50 km away. `--new` sets `bake.lidar: "none"` when NRCan's
catalogue answers with nothing over the core. Then:
- the hillshade step makes the core's elevation grid from the 30 m MRDEM,
  bilinear onto 5 m, so the DEM tiles and the going grid bake unchanged;
- no LiDAR shade or 1 m contours are drawn: the MRDEM's hillshade and
  contours stand in;
- there is no point cloud, so no bush thickness or shooting lanes, and the
  habitat's bush comes from the stand estimate.

Its sources:
- **Yukon layers** (`yt_vectors.py`, OGL-Yukon, GeoYukon's ArcGIS services
  at `mapservices.gov.yk.ca/arcgis/rest/services/GeoYukon`):
  - fire history;
  - game management subzones (the layer holds only an id: 409 is 4-09);
  - First Nation settlement land, as the map's "Private land" layer;
  - the road network and the surface disturbance lines.
- **CanVec 1:50 000 water**, served by the same GeoYukon services.
- **Stands:** inferred from SCANFI and CanLaD (`ca_forest.py`).
- **Imagery:** the 1.5 m SPOT composite, exported tile by tile from
  `mapservices.gov.yk.ca/imagery/.../Yukon_Composite_150cm_WebMercator/ImageServer`.

Checked and not used yet:
- the Yukon Vegetation Inventory (1988–89 photos);
- NBAC burns;
- the ArcticDEM 2 m surface model (it includes the trees);
- moose key areas and caribou ranges.

The moose model was built for boreal Ontario. Yukon's subalpine country,
willow and big burns have not been checked against it.

## Status

Built on branch `areas` (2026-10-03/04). Not yet merged or deployed.

**App**
- The area is resolved once at startup, silently (`areas/start.ts`): a
  link's spot or area, else the saved one, else an iPhone install's seed,
  else Pickle Lake. There is never a picker or a question on load (Gavan's
  requirement). The address keeps naming the area.
- Switching saves the area and the view, then loads the area's address. It
  is set off by a pin, a place, a hunt-log entry, an outing or a coordinate
  in another area.
- Links: an area link and a spot link (Links and sharing). A spot is shown
  with its popup and a ring, not saved, until Pin is tapped. On an iPhone a
  page on another area carries that area's manifest, so an icon added from
  it opens there.
- A GPS fix inside another area shows one small chip. It blocks nothing,
  and once dismissed with × it stays dismissed for that area.
- Go to coordinates (⋯ menu) reads Garmin's "N 49.409550° W 69.553490°",
  decimal degrees, degrees and minutes, DMS, map links, the app's own
  links and whole messages holding any of them. ⋯ › Paste goes straight to
  a pasted place; the sheet adds Paste, every area's home and Recent.
- ⋯ › Locations: Pickle Lake and Lac Bailey a tap away, each with Share.
- Share: a pin's popup, Dig in's ⋯ and each row of ⋯ › Locations, by the
  phone's share sheet, else the clipboard.
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
- The iPhone area manifest rests on reading WebKit's source: add a Lac
  Bailey page to the Home Screen on a device and check the icon's name and
  first launch.
- Paste and Share are tried headless only (the share sheet stubbed): on
  the phones, check iOS's Paste bubble beside the ⋯ menu, a spot link
  copied in Safari and pasted in the home-screen app, the share sheet from
  a pin, and that Chrome asks for the clipboard only once.
- None of this has been field-checked. Lac Bailey's LiDAR bush may read a
  little light against Pickle Lake's single-photon survey.
- The pack is large for a phone. Smaller tiles, or leaving the historical
  sheets out, would bring it down.
- The request flow and the move to R2 are next. See Requests and Hosting.
- The inferred stands (`ca_forest.py`) are not field-checked; NBAC burns before 1985 are not wired in.
