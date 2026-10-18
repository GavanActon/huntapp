# Views: what each map view draws, from where, and what it costs

Status: measured 2026-10-17 on the dev server (main at 6a113d9, app/src
unchanged). It describes the views as they are, as the input to
huntapp-50's proposal (one base map at a time, picked by radio, plus a few
curated views), and proposes nothing. Measured at Pickle Lake (Ontario, the
richest area) and Lac Bailey (Quebec). The scripts, JSON and shots are in
`app/scripts/headless/out/views/` (ignored).

## In short

- **Nine views, one style.** Every view's layers are in every style (about
  50 map layers); picking a view flips their visibility. Each view stands
  on one ground: the imagery (Sat, Hunt, Bush, Scout, Lake), the elevation
  colours (Topo), the wind's colours (Wind), the shade (Terrain), or the
  base map under the Toporama lines (Chart).
- **On a weak link** (2 Mbit/s, 200 ms, the app itself already on the
  phone) the home view settled in 7.6–8.3 s in Sat and Wind, 9–12 s in
  Hunt, Bush, Scout and Terrain, 13.6–14.5 s in Lake and Chart, and 24.8 s
  in Topo at Pickle Lake (11.8 s at Lac Bailey), held back by its lakes
  GeoJSON. Scout's heat came at 29 s (Pickle Lake) and 66 s (Lac Bailey),
  after the grids.
- **Bytes.** A cold open's map tiles were 0.7–2.0 MB at Pickle Lake and
  1.1–2.6 MB at Lac Bailey, Sat's the least. Every view also pulled the
  grids (wind, habitat, going): 10.5 MB at Pickle Lake, 19.5 MB at Lac
  Bailey. A notch of zoom in cost at most 0.4 MB in Sat and Wind, and up
  to 1.6 MB in Terrain (the 1 m LiDAR shade).
- **Drawn for nothing inside the box:** the far band under the imagery
  (0.000% visible in all five imagery views); the live base map in Bush,
  Scout, Terrain and Lake (no pixel moved by more than 8 levels; 130–270 KB
  at a cold open, 116–301 KB more read ahead, 12–61 KB a notch); the
  province's live photo under the same service's photo baked at 0.8 in
  Bush, Scout and Lake (284–372 KB at a cold open, up to 359 KB a notch);
  Chart's Toporama lines, drawn twice, live and baked.
- **Historical** holds one edition per NTS sheet (1973–1995); nothing
  picks a year. Highland Lake's archive is flat grey.
- **The Toporama sheet** cannot be had in the box: it is no layer in Edit
  this view, and it draws only past an area's box.

## How a view becomes a map

- **A view is a set of switches.** `BUILT_IN`
  (`app/src/state/viewsStore.ts:48`) gives each view the `LayerVisibility`
  switches it turns on (`app/src/state/appStore.ts:106`), its strengths
  (`LayerOpacity`, :134, over `DEFAULT_OPACITY`, :173), the heat map on or
  off and a `detail` (:207). `apply()` (viewsStore.ts:157) writes them. The
  wind flow keeps its button's state (on for a fresh phone). The pill names
  the view whose switches match, leaving out `VIEW_LOOSE_KEYS` (:87: wind
  flow, bush, lanes, depths, radar).
- **Detail** (`fineDetail`, appStore.ts:212). `light`: no 1 m LiDAR shade,
  and the elevation colours count as cover (the base map and the MRDEM shade
  go off under them in the box). `auto`: light until the area's maps are
  saved on the phone, read when the map starts. `full` (unset): everything.
- **One style for every view.** `buildMapStyle`
  (`app/src/map/mapStyle.ts:355`) puts every layer the area can draw into
  the style, each tagged with its switch. A view change only flips
  visibility (`applyLayerState`, `app/src/map/MapView.tsx:464`). A hidden
  layer fetches nothing.
- **Four kinds of source:**
  - baked archives, `pmtiles://<key>`, range-read from the area's folder
    (`app/public/data/` on the dev server, R2 on hunt-dev);
  - live services (`app/src/sources.ts`): `LIVE_RASTER` (:134) everywhere,
    `LIVE_VECTOR` (:226) in Ontario;
  - the far band, `satellite-far` (sources.ts:127, mapStyle.ts:415): one
    Sentinel-2 archive for the country, z0–11, under the photo on its switch
    and slider and stretched past z11. With it the province's photo starts
    at z11 (`FAR_HANDOFF`). Locally only Lac Bailey's test box is served
    (71.0–67.5° W, 48.5–50.7° N, z11 tiles about 10 KB); the national one
    is baking;
  - GeoJSON (`geoData`, mapStyle.ts:371, filled once its switch is on) and
    the app's canvases (the wind's colours, the heat).

  The streamed-pictures trial (`?pictures=stream`,
  `app/src/map/streamPictures.ts`: Mapterhorn terrain and the live photo in
  place of the picture archives) is off by default and was not measured.
- **Live under baked.** Where a picture layer is baked, its live service
  sits under the archive on the same switch, so past the archive's outer
  tiles the live one shows. `syncUnderlays` (mapStyle.ts:178) hides four
  live layers where they can't show, on every move:
  - the Toporama sheet (`toposheet`): inside the box always, and anywhere
    the imagery is whole;
  - the base map (`base`): under whole imagery, and in the box under light
    elevation colours or the wind's colours;
  - the province's photo (`satellite-live`): in the box under whole imagery;
  - the MRDEM shade (`hillshade-live`): in the box under whole imagery, light
    elevation colours or the wind's colours.

  Whole means the imagery at 0.99 or more: Sat and Hunt (1.0), not Bush,
  Scout or Lake (0.8). The Toporama hypsography (`topo-live`) and the far
  band are not in the list.
- **The opening** (`openFromFurtherOut`, MapView.tsx:131): the map starts
  two zooms out (z11), then eases in to z13 once the coarse view is idle or
  1.2 s after its first frame. A 430 × 860 phone at z11 sees past every
  area's box (Pickle Lake's is 19 × 15.6 km), so every cold open asks the
  live services for the ground past the box.
- **standIn** (mapStyle.ts:347) gives a view that wants imagery the Topo
  look where an area has none. Every area has a baked imagery archive
  today, so it never fires.

## The views

The nine built-in views (`viewsStore.ts:48–77`), in the pill's order. The
fishing two are offered only in Ontario (`FISH_HERE`,
`app/src/spots/profile.ts:42`). "Draws" is what the style had visible at
the home view, inside the box, measured at both areas (the layer cost
below gives each layer's share of the picture).

| View | Switches on (strength) | Detail | Heat | Draws in the box at z13, bottom to top | From z14 on | Also asked at the z11 opening |
| --- | --- | --- | --- | --- | --- | --- |
| Topo | Elevation colours 0.9, Hillshade 0.7, Contours, Roads | light | off | elevation colours (dem); DEM shade (dem); lakes (waterbody GeoJSON); bogs and marsh tufts (forest); 10 m contours (contoursWide); roads (places) | LiDAR contours (contours) from z13.5 | Toporama sheet, base map, MRDEM shade |
| Sat | Imagery 1.0, Roads | light | off | far band; imagery (satellite); roads | — | the province's photo |
| Hunt | Imagery 1.0, Hillshade 0.35, Shooting lanes 0.9, Contours, Roads | auto | off | far band; imagery; DEM shade drawn hard over it; lanes (from the first idle, `openLanesOut`); 10 m contours; roads | LiDAR contours | the province's photo, MRDEM shade |
| Bush | Imagery 0.8, Bush 0.7, Contours, Roads | full | off | base map; far band; the province's photo; imagery; bush (understory); 10 m contours; roads | LiDAR contours | Toporama sheet, base map, the province's photo |
| Wind | Hillshade 0.7, Wind colours, Wind flow; the Contrast look | light | off | the wind's colours (canvas from the forecast and the wind grid); DEM shade; white streaks (canvas) | — | Toporama sheet, base map, MRDEM shade |
| Scout | Imagery 0.8, Forest 0.55, Burns, Contours, Roads | full | on | base map; far band; the province's photo; imagery; heat; 10 m contours; forest fill and wood-type names (forest); burns (places); roads | LiDAR contours; stand labels from z15 | Toporama sheet, base map, the province's photo |
| Terrain | Hillshade 0.9, Contours, Roads | full | off | base map; MRDEM shade (live); DEM shade; 10 m contours; roads | LiDAR shade (hillshadeLidar) from z13.5; LiDAR contours | Toporama sheet, base map, MRDEM shade |
| Lake | Imagery 0.8, Lake depths | full | on | base map; far band; the province's photo; imagery; heat; depth bands (depth GeoJSON); survey sheets (bathySheets, z12+); depth lines (bathy GeoJSON, empty at Pickle) | — | Toporama sheet, base map, the province's photo |
| Chart | Lake depths, Topographic 1.0 | full | on | base map; Toporama hypsography (live); the same lines baked (topo); heat; depth bands; survey sheets; depth lines | — | Toporama sheet, base map, hypsography |

Every view also has the wind streaks while the Wind flow button is on (a
fresh phone: on), the camp and pins, and the gold HD outline of the core.

The detail changes what is drawn in three views only: Topo and Wind (light:
no LiDAR shade, and under Topo's elevation colours no base map or MRDEM
shade in the box) and Terrain (full: the LiDAR shade from z13.5, the only
view that draws it). In Hunt, `auto` changes nothing: the LiDAR shade stays
off over the imagery at 0.35 either way (`lidarShadeShown`,
mapStyle.ts:119). Bush, Scout, Lake and Chart have no shade to change.

The overlays a view's buttons reach are the mode's, not the view's
(`DEFAULT_HOT`, `appStore.ts:77`; `app/src/ui/hotButtons.tsx:79–158`):
hunting's columns hold Wind flow, Shooting lanes and Contours (the "LiDAR
contours" button is the same switch) among the tools, the strip holds the
heat map, and Map buttons' tray adds Bush thickness, Lake depths and
Radar; fishing's hold Lake depths and Wind flow.

Where each layer comes from:

| Layer (style id) | Source |
| --- | --- |
| base map (`base`) | NRCan Canada Base Map, `maps-cartes.services.geo.ca` (CBMT_CBCT_GEOM_3857), bounded to the box with signal |
| Toporama sheet (`toposheet`) | NRCan Toporama WMS layer `WMS-Toporama`, `maps.geogratis.gc.ca`, z7–17, on white |
| Toporama hypsography (`topo-live`) | the same WMS, layer `hypsography` (contour lines and spot heights on transparent) |
| MRDEM shade (`hillshade-live`) | NRCan MRDEM 30 m hillshade WMS, `datacube.services.geo.ca`, to z16 |
| the province's photo (`satellite-live`) | Ontario: LIO imagery, `ws.lioservices.lrc.gov.on.ca`; Quebec: Imagerie_GQ, `servicesmatriciels.mern.gouv.qc.ca`; to z18; none in BC or the Yukon |
| sharper photo (`satellite-sharp`) | Esri World Imagery through `sharp://` (the area's saved pack, else `server.arcgisonline.com`), over the box at Highland Lake and Blanchard River only |
| far band (`satellite-far`) | `data/far/far-imagery-ca.pmtiles` (R2 on hunt-dev), z0–11 |
| imagery, DEM (`relief-colour`, `relief-shade`), LiDAR shade, contours, forest (fill, names, bogs), places (roads, burns, zones, private land, parks, camps), bush, lanes, topo, historical, survey sheets | the area's baked archives, `<stem>-<area>.pmtiles` |
| lakes (`relief-lakes`) | `waterbody-<area>.geojson` |
| depth bands (`depth-est-*`) | `depth-<area>.geojson`, else the habitat grid (`app/src/map/depthLayer.ts`) |
| depth lines (`bathy-*`) | `bathy-<area>.geojson`, else LIO's live query (Ontario) |
| the wind's colours (`wind-wash`), heat (`spots-heat`) | canvases drawn on the phone from the forecast and the grids |

## Base-map candidates

What each could be as one base under a radio, as the app has it today.
"Alone" means the only ground layer on (roads, contours and the streaks may
stay). Taps are counted from a fresh phone on Sat; Edit this view is three
taps in (the pill, More, Edit this view), and a folded group is one more.

| Base | What is drawn | Areas | Baked or live | Zooms | Past the box | Offline (the saved pack) | Taps to see it alone today |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Sat | the area's imagery archive; the province's live photo under it; the far band under both | baked in all 8: LIO in Ontario (4), the MRNF 20 cm ortho in Quebec (2), Yukon SPOT 1.5 m at Highland, Sentinel-2 10 m at Blanchard; live photo in Ontario and Quebec; Esri over the box at Highland and Blanchard | baked + live + far band | baked z9–16 (Highland z9–15, Blanchard z9–14); live to z18 (Esri z17); far band z0–11, stretched beyond | past the archive's outer tiles, the live photo in Ontario and Quebec; the far band (z ≤ 11) nationally once baked; BC and the Yukon: dark ground | yes: the baked archive, and at Highland and Blanchard Esri's tiles saved as a pack; the far band is not in the pack | 0 (a fresh phone opens on Sat); 2 from another view (pill, Sat) |
| Topo | elevation colours from the DEM, its shade at 0.7, blue lakes, bogs, the 10 m and LiDAR contours | all 8 (no bogs at the Sault test and Highland: national stands carry no wetland class) | baked | dem z8–16 (z8–15 at Blanchard and Highland); 10 m contours z8–14; LiDAR contours z14–16 (z14–15), not at Searchmont | no: the DEM stops at the box's outer tiles (a few km past it at z11–12); past them the Topo view shows the Toporama sheet under the MRDEM shade | yes | 2 (pill, Topo) |
| Toporama sheet | NRCan's whole Toporama map on white: lakes and shores, creeks, woods, contours, roads, names | national | live only | z7–17 | only past the box | no (the worker's `live-tiles` cache keeps tiles already seen, 1,000 at most, 120 days) | none: it is not in Edit this view; `syncUnderlays` draws it only past a box, and never under whole imagery |
| Historical | CanMatrix2 scans of the 1:50 000 NTS sheets (below) | all 8; Highland's is flat grey | baked | z9–15 | no | yes | 6 (pill, More, Edit this view, Imagery off, Wind, radar & old maps, Historical topo) |
| Shade | in the box the DEM-drawn shade, and at full detail the 1 m LiDAR (2 m ArcticDEM in the north) shade from z13.5; the live MRDEM shade under them; the baked 30 m hillshade archive is never drawn | DEM shade all 8; LiDAR or ArcticDEM 7 (not Searchmont); MRDEM national; the 30 m archive baked in 6 (not Lac Bailey or Duhamel) | baked + live | dem z8–16; LiDAR z14–16 (z14–15); MRDEM to z16 | the MRDEM shade | the DEM and LiDAR shades; not the MRDEM | 2 for Terrain (shade, contours, roads, full detail); 6 for the shade alone (light: no LiDAR shade) |
| Elevation colours | `relief-colour` from the dem archive (the Topo view without its shade, contours and bogs) | all 8 | baked | z8–16 (z8–15) | no (only with `?pictures=stream`: Mapterhorn) | yes | 6 (pill, More, Edit this view, Imagery off, Terrain, Elevation colours) |
| Depths | Pickle: the MNR survey sheets (bathySheets) and depth bands; the Sault test, Searchmont and Whitefish: depth bands; LIO depth lines at Searchmont and Whitefish | the 4 Ontario areas; fishing is offered only there | baked GeoJSON and sheets; LIO live only where nothing is baked (none of the four) | sheets z12–17; GeoJSON any zoom | no | yes | 2 for Lake (the quarry chip, a fish: imagery, depths and the heat); 4 for Chart (no imagery); 6 for depths alone from the hunting side |

### Each base alone, measured

The bases that are not views of their own, as a fresh phone reaches them
from Sat through Edit this view (so the detail stays Sat's, light, and the
strengths are Sat's: Historical 0.8, Elevation colours 0.9, Hillshade 0.6,
Topographic 1.0), with nothing else on but the wind. A cold open of each,
measured as the views were; three views alongside. KB.

| Ground | Pickle: tiles (live of it) | its GeoJSON | read ahead | a notch: z14 · z15 · z16 | weak link: settled (other) | Lac Bailey: tiles (live) | its GeoJSON | read ahead | a notch | weak link |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Sat (the view, with roads) | 707 (90) | — | 0 | 266 · 193 · 0 | 7.7 s (7.8) | 1,065 (220) | — | 0 | 205 · 374 · 1 | 7.8 s (7.9) |
| Historical alone | 1,303 (203) | — | 116 | 424 · 20 · 16 | 9.2 s (9.3) | 2,588 (240) | — | 301 | 576 · 15 · 26 | 12.2 s (12.7) |
| Elevation colours alone (with their lakes and bogs) | 1,325 (175) | lakes 2,261 | 0 | 230 · 108 · 5 | 24.2 s (24.4) | 2,269 (243) | lakes 527 | 0 | 224 · 291 · 23 | 11.6 s (11.8) |
| Shade alone (light: the DEM shade over the MRDEM, no LiDAR) | 1,120 (531) | — | 116 | 477 · 200 · 24 | 8.9 s (8.9) | 1,820 (822) | — | 301 | 466 · 487 · 18 | 10.8 s (13.6) |
| Topographic alone (the Toporama lines, baked and live) | 609 (321) | — | 116 | 148 · 83 · 36 | 10.3 s (12.7) | 1,914 (861) | — | 301 | 327 · 326 · 73 | 10.0 s (10.8) |
| Lake depths alone | 256 (136) | depth bands 785 | 116 | 186 · 286 · 292 | 11.8 s (12.2) | — | | | | |
| Topo (the view) | 1,207 (96) | lakes 2,261 | 0 | 297 · 138 · 10 | 24.8 s (24.8) | 2,482 (311) | lakes 527 | 0 | 314 · 437 · 95 | 11.8 s (12.0) |
| Terrain (the view, full detail) | 1,954 (1,251) | — | 116 | 1,338 · 674 · 29 | 9.1 s (9.1) | 2,087 (855) | — | 301 | 1,112 · 1,580 · 98 | 10.8 s (11.1) |

- With the imagery off and no elevation colours, the live base map comes on
  in the box under each base alone, and its read-ahead with it (116 KB and
  301 KB). The "live" share is mostly that, plus the MRDEM under the shade,
  the Toporama hypsography under the baked lines and the opening's z11 asks.
- The elevation colours carry their lakes: the same 2.26 MB GeoJSON at
  Pickle Lake as Topo's.

## Historical: one edition per sheet, no picker

`historical-<area>.pmtiles` (z9–15, every area) is cut by
`pipeline/build_historical.py` from NRCan's CanMatrix2 scans of the area's
1:50 000 NTS sheets (`bake.nts` in the area file): one scan per sheet, the
biggest TIF in the sheet's zip (`scan()`, line 29). The archive's metadata
holds a name and the credit only. The year is in each zip's metadata
(`canmatrix2_<sheet>_1_x_pna.xml`, kept in `pipeline/raw/sheets/`), which
names the paper sheet the scan was made from (`TOPO-<sheet>-<edition>`) and
its publication year:

| Area | Sheets: edition, year | Archive |
| --- | --- | --- |
| Pickle Lake | 042C13 ed. 2, 1979 · 042C14 ed. 2, 1979 | 11.2 MB |
| Lac Bailey | 022F05 ed. 2, 1980 · 022F06 ed. 2, 1980 | 25.4 MB |
| Duhamel | 031J03 ed. 3, 1994 | 19.1 MB |
| Whitefish Lake | 042A02 ed. 3, 1989 | 4.1 MB |
| Searchmont | 041J12 ed. 4, 1994 · 041J13 ed. 4, 1995 · 041K09 ed. 5, 1995 · 041K16 ed. 4, 1994 | 15.7 MB |
| Sault test | 041K08 ed. 3, 1994 · 041K09 ed. 5, 1995 · 041K10 ed. 4, 1994 | 4.4 MB |
| Highland Lake | 105M07 ed. 1, 1973 | 0.03 MB: all 300 tiles are flat grey (RGB 185–193); the georeferenced sheet (`105m07_geo.tif`) is 695 bytes |
| Blanchard River | 114P15 ed. 3, 1984 · 115A02 ed. 2, 1985 | 6.6 MB (159 of its 548 tiles flat) |

- One scan per sheet: no archive holds two years of the same ground, so
  there is nothing to pick between today.
- `historicalYear` (`appStore.ts:311`, "which historical map year to show,
  when more than one is available") is persisted and counted by the
  settings stats (`app/src/stats/watch.ts:67`). Nothing else reads or sets
  it: no picker in the UI, and `mapStyle.ts` draws the one archive. Grep of
  `app/src`, 2026-10-17.
- No live source: `LIVE_RASTER.historical` is in the type but not set
  (`sources.ts:134`), so the old sheets stop at the box and come with the
  saved pack.

## Layers that draw and show nothing

Each visible layer hidden in turn at the home view, z13 and z15, both
areas (method below). The numbers are the share of the picture that
changed: *any* change, then *visible* (more than 8 of 255). A layer at
0.000% is covered or empty there; one at 0.000% visible tints the picture
by a few levels at most. Only the layers that draw something and cost
bytes are listed; the bytes are the cold open, then the 12 s after it (the
idle read-ahead, `app/src/map/prefetch.ts`), then the three notches.

| View | Layer (source) | Pickle z13 · z15 | Lac Bailey z13 · z15 | What it costs: Pickle; Lac Bailey |
| --- | --- | --- | --- | --- |
| Sat, Hunt | far band, under the imagery at 1.0 | 0.000 · 0.000 | 0.000 · 0.000 | 35 KB (headers, and one z4 tile stretched: the local archive covers only Lac Bailey's box); 102 KB (headers, six z11 tiles at the opening, nothing more on a zoom in) |
| Bush | base map, under three photos at 0.8 | 80 any, 0.000 visible · 99 any, 0.000 | 82 any, 0.000 · 70 any, 0.000 | 130 + 116 read ahead + 61/12/16; 203 + 301 + 58/15/18 KB |
| Bush | far band | 99.6 any, 0.000 · 0.000 | 97 any, 0.000 · 89 any, 0.000 | as Sat |
| Bush | the province's photo, under the baked one at 0.8 | 12.6 visible · 0.3 | 2.8 · 2.8 | 338 + 279/210/151; 284 + 196/359/270 KB |
| Bush | the baked photo, over the province's | 13.3 visible · 4.2 | 3.3 · 3.3 | 382 + 265/193/0; 312 + 204/373/0 KB |
| Scout | base map | 73 any, 0.000 · 97 any, 0.000 | 60 any, 0.000 · 49 any, 0.000 | 130 + 116 + 61/12/16; 226 + 301 + 58/15/18 KB |
| Scout | far band | 98 any, 0.000 · 0.000 | 88 any, 0.000 · 77 any, 0.000 | as Sat |
| Scout | the province's photo | 18.4 visible · 0.19 | 0.15 · 0.39 | 341 + 279/210/151; 284 + 196/359/270 KB |
| Scout | the baked photo, under forest 0.55 and burns | 19.0 visible · 3.4 | 0.19 · 0.38 | 382 + 265/193/0; 485 + 204/373/0 KB |
| Terrain | base map, under the MRDEM shade at 0.9 | 99.5 any, 0.000 · 98.8 any, 0.000 | 98 any, 0.000 · 88 any, 0.000 | 137 + 116 + 61/12/24; 270 + 301 + 58/15/26 KB |
| Lake (Pickle) | base map | 92 any, 0.000 · 99.9 any, 0.000 | — | 129 + 116 + 61/12/16 KB |
| Lake (Pickle) | far band | 99.8 any, 0.000 · 0.000 | — | as Sat |
| Chart (Pickle) | Toporama hypsography live (`topo-live`) under the same lines baked (`topo`) | 2.5 visible · 0.6, and the baked lines the same 2.5 · 0.6: the lines are drawn twice, and hiding either lightens them | — | 148 + 41/33/20 KB |
| every view with contours | 10 m contours (contoursWide) in the LiDAR core from z13.5 (filtered out, `core` = 1) | z15: 0.000 | z15: 0.000 | 1–5 KB a notch (z14 tiles stretched) |

- **Sat, Hunt, Topo and Wind draw nothing that does not show.** In them
  `syncUnderlays` already turns the base map, the province's photo, the
  Toporama sheet and the MRDEM shade off in the box; only the far band is
  left under the whole imagery.
- **The rest is what `syncUnderlays` leaves on.** Bush, Scout and Lake set
  the imagery at 0.8, so it is not "whole": the base map, the far band and
  the province's live photo all stay on under the baked one. The live and
  baked photos are close to the same picture: in Bush, either one hidden
  changes 2.8–13% of the picture visibly at z13 and 0.3–4% at z15. Terrain
  has no imagery or elevation colours, so the base map and the live MRDEM
  shade stay on in the box, and the MRDEM is most of Terrain's look (89–96%
  visible at z13, 77–96% at z15; the DEM-drawn shade over it 13–32% and
  4–14%). `topo-live` is not managed at all.
- **The base map's read-ahead.** Wherever the base map is on in the box
  (Bush, Scout, Terrain, Lake, Chart), the idle read-ahead fetched 116 KB
  (Pickle) or 301 KB (Lac Bailey) of its ring within 12 s of the first
  paint, for a layer that changed no pixel visibly in four of those five
  views.
- **Free to drop:** layers drawn with nothing in view at the home view also
  showed 0.000%: the box outline (the edge is off screen), the pin halo (no
  pin picked), the burns at Pickle (none in view), the depth labels and the
  LIO depth lines at Pickle (its `bathy` GeoJSON is an empty 67 bytes).
  They cost nothing or a GeoJSON already loaded.

### At the opening's z11, past the box

The opening's z11 view at the home centre runs 2.6–3.4 km past Pickle
Lake's box (north and south) and 1.8 km past Lac Bailey's. The ground
layers only, one load each, the same test:

| View | Layer | Pickle z11 | Lac Bailey z11 |
| --- | --- | --- | --- |
| Topo | Toporama sheet | 0.000 | — |
| Topo | base map | 92 any, 0.000 visible | — |
| Topo | MRDEM shade, under the elevation colours | 0.47 visible | — |
| Sat | far band | 0.000 | 0.000 |
| Sat | the province's photo | 0.000 | 10.6 visible |
| Sat | the baked photo | 0.59 visible (the live photo under it is the same picture) | 0.36 visible |
| Bush | Toporama sheet | 0.000 | 0.15 visible |
| Bush | base map | 95 any, 0.000 visible | 71 any, 0.000 visible |
| Bush | far band | 99 any, 0.000 visible | 10.3 visible |
| Bush | the province's photo | 58 visible | 10.7 visible |
| Terrain | Toporama sheet | 0.000 | 0.37 visible |
| Terrain | base map | 87 visible | 47 visible |
| Terrain | MRDEM shade | 93 visible | 86 visible |

- The archives' outer tiles reach past the box (at z11 the map draws
  256 px tiles at z12, about 6 km across here), and so does the base map
  (bounded to the box, by whole tiles). At the opening they still cover
  the near ground past the box: at Pickle Lake the province's photo showed
  0.000% in Sat, and the Toporama sheet 0.000% in every view tested. Lac
  Bailey's z11 view reaches past the outer tiles: there the province's
  photo is about a tenth of the picture, and the sheet 0.15–0.37%.
- What a cold open's z11 pass asked of the live services past the box:
  the Toporama sheet 32–155 KB at Pickle Lake and 30–213 KB at Lac Bailey,
  in every view without whole imagery; the province's photo 90 and 122 KB
  in Sat and Hunt at Pickle Lake (220 and 250 KB at Lac Bailey).
- At z11 the base map shows in Terrain (87% and 47% of the picture
  visibly), where at z13 and z15 it showed nothing under the MRDEM shade.

## What each view loads

### A cold open, to the settled home view (z13)

Fresh phone, no saved maps, signal at full speed. Map tiles are the
archives, the live services and the far band; the opening's z11 pass is in
them (live services past the box). KB.

| View | Pickle: settled | tiles | baked · live · far | biggest parts | Lac Bailey: settled | tiles | baked · live · far | biggest parts |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Topo | 7.4 s | 1,207 | 1,078 · 96 · 33 | dem 739, forest 224, contours 87, CBMT 59, Toporama sheet 37; and the lakes GeoJSON 2,261 | 8.5 s | 2,482 | 2,138 · 311 · 33 | dem 1,373, forest 533, Toporama sheet 213, contours 192, CBMT 97; and the lakes GeoJSON 527 |
| Sat | 7.5 s | 707 | 582 · 90 · 35 | satellite 554, LIO photo 90, places 28 | 7.5 s | 1,065 | 744 · 220 · 102 | satellite 702, Quebec photo 220, far band 102, places 42 |
| Hunt | 6.6 s | 1,768 | 1,611 · 122 · 35 | dem 704, satellite 554, lanes 238, LIO photo 122, contours 87 | 7.6 s | 2,575 | 2,223 · 250 · 102 | dem 1,012, satellite 702, lanes 277, Quebec photo 250, contours 192 |
| Bush | 7.1 s | 1,463 | 873 · 556 · 35 | satellite 382, understory 377, LIO photo 338, CBMT 130, Toporama sheet 88 | 7.6 s | 1,492 | 918 · 518 · 56 | understory 372, satellite 312, Quebec photo 284, CBMT 203, contours 192 |
| Wind | 8.0 s | 964 | 863 · 69 · 33 | dem 863, CBMT 38, Toporama sheet 32 | 7.1 s | 1,912 | 1,569 · 310 · 33 | dem 1,569, Toporama sheet 213, CBMT 97 |
| Scout | 5.7 s | 1,343 | 720 · 587 · 35 | satellite 382, LIO photo 341, forest 224, CBMT 130, Toporama sheet 116 | 8.2 s | 2,042 | 1,252 · 688 · 102 | forest 533, satellite 485, Quebec photo 284, CBMT 226, contours 192 |
| Terrain | 7.1 s | 1,954 | 670 · 1,251 · 33 | MRDEM 958, dem 556, Toporama sheet 155, CBMT 137, contours 87 | 8.6 s | 2,087 | 1,199 · 855 · 33 | dem 965, MRDEM 506, CBMT 270, contours 192, Toporama sheet 78 |
| Lake | 6.4 s | 1,127 | 469 · 624 · 35 | satellite 382, LIO photo 372, CBMT 129, Toporama sheet 122, survey sheets 87; and the depth bands 785 | — | | | |
| Chart | 9.4 s | 802 | 362 · 408 · 33 | topo 274, Toporama hypsography 148, CBMT 137, Toporama sheet 122, survey sheets 87; and the depth bands 785 | — | | | |

"contours" is the 10 m archive (contoursWide); the LiDAR contours start at
z13.5. The far band's 33–35 KB at Pickle and in the views without imagery
is its header and directories: it is registered at every open with signal
(`MapView.tsx:218`). Requests cancelled before they finished (the
opening's z11 asks dropped at its zoom-in, and some between notches: 5 to
42 a view, live tiles and archive reads alike) are not counted.

**The same in every view** (a cold open, either area):

| | Pickle | Lac Bailey |
| --- | --- | --- |
| the grids: micro (wind), habitat, going | 10,535 KB (6,847 · 2,056 · 1,631) | 19,463 KB (12,696 · 3,366 · 3,401) |
| Open-Meteo (replayed; the real answers' size) | 242–318 KB, 25–26 asks | 320–395 KB, 37–38 asks |
| the coverage index's header (`explore/coverage-ca.pmtiles`, Explore off) | 33 KB | 33 KB |
| manifests and version | 7 KB | 4 KB |
| the app's JS and CSS | dev server: about 14 MB in 210 requests; production: 0.65 MB gzipped, from the service worker once installed | the same |

The grids did not all land before the settle in every run (Scout at Pickle:
5,353 KB before it, the rest in the next 12 s), so they are given whole.

### A notch of zoom in

`jumpTo` at the home centre, z13 → z14 → z15 → z16, each to its settle. A
256 px archive is drawn one zoom deeper than the map (MapLibre takes a
256 px raster at the map's zoom + 1), so at map z15 the z16 tiles are in and
z15 → z16 asks for little. KB.

| View | Pickle z14 · z15 · z16 | biggest at z14 | Lac Bailey z14 · z15 · z16 | biggest at z15 |
| --- | --- | --- | --- | --- |
| Topo | 297 · 138 · 10 | dem 209, LiDAR contours 62 | 314 · 437 · 95 | dem 268, LiDAR contours 140 |
| Sat | 266 · 193 · 0 | satellite 265 | 205 · 374 · 1 | satellite 373 |
| Hunt | 751 · 413 · 5 | satellite 265, lanes 210, dem 209 | 594 · 895 · 72 | satellite 373, dem 268, contours 140, lanes 107 |
| Bush | 930 · 557 · 172 | LIO photo 279, satellite 265, understory 259 | 686 · 1,043 · 360 | satellite 373, Quebec photo 359, understory 150 |
| Wind | 209 · 96 · 0 | dem 209 | 201 · 268 · 0 | dem 268 |
| Scout | 692 · 456 · 177 | LIO photo 279, satellite 265, contours 62, CBMT 61 | 570 · 916 · 383 | satellite 373, Quebec photo 359, contours 140 |
| Terrain | 1,338 · 674 · 29 | LiDAR shade 793, dem 209, MRDEM 207 | 1,112 · 1,580 · 98 | LiDAR shade 951, dem 268, MRDEM 200 |
| Lake | 729 · 688 · 436 | LIO photo 279, satellite 265, survey sheets 125 | — | |
| Chart | 273 · 357 · 305 | survey sheets 125, CBMT 61, topo 47, hypsography 41 | — | |

- In Bush, Scout and Lake the province's live photo still asks at z16
  (151 KB at Pickle Lake, 270 KB at Lac Bailey), where the baked imagery
  has stopped: it serves to z18.
- The base map's 16–26 KB at z16 are 404s: it has no tiles past z15 there
  (Found on the way).

## Time to a settled first paint on a weak link

Fresh phone, the view seeded, a weak LTE: 2 Mbit/s down, 0.8 Mbit/s up,
200 ms, one link shared by every request but the app's own files (method
below). Times from navigation, the better of two loads with the other
beside it. *First tiles* is when the source of the view's ground delivered
its first tile; *settled* is the first idle at z13 with every tile in. The
bytes are the map's (archives, live services, far band, and a GeoJSON a
layer waits on) that came before the settle.

| View | Pickle: map made | first tiles | settled (other) | heat | map KB | Lac Bailey: map made | first tiles | settled (other) | heat | map KB |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Topo | 3.2 s | 5.7 s dem | **24.8 s** (24.8) | | 2,723, the lakes GeoJSON 2,261 of it | 3.1 s | 7.4 s dem | **11.8 s** (12.0) | | 1,238, the lakes 527 |
| Sat | 3.1 s | 4.5 s photo | **7.7 s** (7.8) | | 464 | 3.0 s | 5.4 s photo | **7.8 s** (7.9) | | 438 |
| Hunt | 3.2 s | 5.5 s photo | **11.0 s** (11.0) | | 990 | 3.1 s | 5.5 s photo | **12.1 s** (12.1) | | 1,210 |
| Bush | 3.1 s | 5.8 s photo | **10.7 s** (10.8) | | 1,085 | 3.0 s | 6.4 s photo | **11.6 s** (11.8) | | 1,323 |
| Wind | 3.1 s | 5.3 s dem, colours 6.8 s | **7.6 s** (7.7) | | 455 | 3.0 s | 5.7 s dem, colours 6.6 s | **8.3 s** (8.3) | | 564 |
| Scout | 3.0 s | 6.5 s photo | **9.1 s** (9.2) | 29.0 s | 765 | 3.0 s | 7.4 s photo | **10.0 s** (10.9) | 66.2 s | 971 |
| Terrain | 3.1 s | 6.5 s MRDEM | **9.1 s** (9.1) | | 854 | 3.0 s | 7.6 s MRDEM | **10.8 s** (11.1) | | 1,265 |
| Lake | 3.0 s | 5.8 s photo | **14.5 s** (14.8) | not timed (below) | 1,728, the depth bands 785 of it | — | | | | |
| Chart | 3.0 s | 3.6 s base map | **13.6 s** (13.6) | not timed | 1,441, the depth bands 785 | — | | | | |

- **The map is made at 3.0–3.2 s in every view.** The app's files load at
  full speed (the load event at about 1.8 s). Then the area's manifest
  (0.3 s), and, awaited one after the other before the style is built,
  the coverage index's header (Explore's grid, with Explore off: two
  16 KB reads, 0.43 s) and the far band's (two 16 KB reads, 0.42 s;
  `MapView.tsx:216–218`).
- **The grids share the line from the first second.** The page's head asks
  for the wind grid's preview at 0 s (415 KB at Pickle Lake, in at 1.9 s;
  605 KB at Lac Bailey, in at 3.0 s). The app asks for its base bands at
  2.0 s (2.36 MB at Pickle Lake; in Topo's runs, with the lakes on the line
  too, in at 22.7 s), then the habitat and going grids. Every view's tiles
  came in beside them. The heat waits on them: Scout's showed at 29 s at
  Pickle Lake and 66 s at Lac Bailey, whose wind grid is 12.7 MB.
- **The opening's coarse pass is cut short on a weak link.** The zoom-in
  goes 1.2 s after the first frame whether z11 is in or not, so much of the
  z11 pass was cancelled, and every view took fewer map bytes to its first
  paint than with full signal (Pickle Lake: Sat 464 KB against 707, Terrain
  854 against 1,954).
- **What held the settles back:** Topo's lakes, one GeoJSON (2.26 MB at
  Pickle Lake: its first tile at 24.4 s, the elevation colours drawn from
  5.7 s); the depth bands in Lake and Chart (785 KB, first drawn at 12–14 s);
  the lanes in Hunt, asked again when they open out at the first idle
  (`openLanesOut`: their first tile at 9.4 s and 10.2 s).
- **Sat and Wind came first in both areas** (7.6–8.3 s): the ground of each
  is one baked archive (the photo, the DEM), a few tiles at a time, with
  nothing live in the box.
- **The fishing heat** (Lake, Chart) was not timed. With signal at full
  speed its canvas was painted within 5 s (48,125 pixels), but lake trout
  puts no numbered pins down, and the harness's heat wait
  (`readiness.py` `HEAT_READY_JS`) waits for pins.

## How it was measured (2026-10-17)

- **Harness:** `app/scripts/headless/out/views/views_measure.py` on
  `scenarios.py`'s `Session`: Playwright 1.58, Chromium 145 headless on the
  laptop's GPU (`--gl d3d11`: ANGLE, Intel Graphics, Direct3D 11), a
  430 × 860 touch context at DPR 2, Open-Meteo answered from the capture of
  2026-10-17 03:54 (`omcache.py`; nothing went to the real API). The dev
  server on localhost:5199 (default env, data from `app/public/data`), main
  at 6a113d9 with app/src unchanged. Every bytes and weak-link load counted
  one page load (no hot reload under it).
- **A view:** a fresh context each time (empty storage and cache), with the
  view written into localStorage before the app ran (`huntapp`,
  `huntapp-views`, `huntapp-spots`), as a phone left on that view. The pill
  read the view's name in every load. Geolocation at the area (the Pickle
  camp 48.9309, −85.5934; Lac Bailey 49.40955, −69.55349), Lac Bailey by
  `?area=lac-bailey`. HD on (the default), no maps saved, so `auto` drew
  light. Fishing views at Pickle Lake only: Lac Bailey offers none.
- **Settled:** the first map `idle` at the home zoom (z13, after the
  opening's z11 → z13) with `areTilesLoaded()` and no tile asked for in the
  1.5 s after it. Times are the page's own, from navigation.
- **Bytes:** `request.sizes().responseBodySize` for every finished request:
  the body as received, headers left out. The dev server does not compress,
  so a range read counts its length. "Cold open" is every request started
  before the settle; a notch, those from the `jumpTo` to its settle.
  Requests the opening started and its zoom-in cancelled are not counted.
- **Layer cost** (the 2026-10-08 layercost method): the UI and the streaks'
  canvas hidden by CSS and the heat off, each visible in-range layer of the
  style was hidden in turn and the map's 860 × 1720 px shot diffed against
  the whole view shot just before. *any* is the share of pixels with any
  channel changed, *visible* those changed by more than 8 of 255. Two shots
  of the whole view a second apart matched exactly (0.000%) in every case.
  The app's tool layers (paths, tracks, routes, the ruler, the log, wind
  checks, Explore's box) are empty on a fresh phone and were left out.
- **Weak link:** `Network.emulateNetworkConditionsByRule` over CDP, without
  `Network.enable` (that stalls the module worker). The app's own files
  (HTML, JS, CSS, glyphs, sprites, icons) at full speed, as an installed
  phone has them from its service worker; every other request (manifests,
  grids, archives, the far band, the live services) through one shared
  link: 2 Mbit/s down (250,000 B/s), 0.8 Mbit/s up, 200 ms. Checked first: a
  1.1 MB fetch took 4.6 s, two at once shared the link (1.5 MB in 6.4 s),
  and a fetch from a worker was held too. The replayed Open-Meteo answers
  were not on the link (about 240 KB on a real open). Two loads a view; the
  better is given.
- **The machine was busy:** five Sentinel-2 far-band bakes
  (`pipeline/far_imagery.py --part 0/5` to `4/5`) ran at below-normal
  priority throughout, and a wind-tiles bake (`pipeline/wind_tiles.py bake
  --jobs 2`) at normal priority. Neither was touched. Absolute times carry
  that noise; the comparison between views is what holds.
- **The app's JavaScript is left out of the per-view numbers.** The dev
  server serves it unbundled: about 14 MB in about 210 requests before the
  settle, every view alike. The production build (dist of 2026-10-12) is
  2.2 MB of JS and CSS, 0.65 MB gzipped, and an installed phone has it from
  the service worker.

## What this says

Observations only.

- Every view's ground inside the box comes from the area's own archives
  but for two: Terrain's grey is the live MRDEM shade (89–96% of the
  picture visibly at z13), and Chart's ground is the live base map (99%).
- 5 of 9 views (Sat, Hunt, Bush, Scout, Lake) draw the far band under the
  baked imagery, where it moved no pixel visibly at z13 or z15 in either
  area.
- 4 of 9 views (Bush, Scout, Terrain, Lake) draw the live base map in the
  box, where it moved no pixel by more than 8 of 255 in either area; it and
  its read-ahead were 246–571 KB of a cold open's first 20 s.
- 3 of 9 views (Bush, Scout, Lake) draw the province's live photo in the box
  under the same service's photo baked at 0.8. With either one hidden the
  picture hardly moved at Lac Bailey (0.2–3% of it visibly) and moved
  13–58% at Pickle Lake at z13 (0.2–14% at z15): the two pictures differ
  more there. The live one was 284–372 KB of their cold opens and 151–359 KB
  of each notch in.
- Chart draws the Toporama hypsography twice, live and baked: 148 KB of
  its cold open for lines that hiding either one only lightens.
- `syncUnderlays` covers the imagery at 1.0, the light elevation colours and
  the wind's colours. The views with underlays drawn for nothing are the
  ones it leaves alone: the imagery at 0.8, the shade alone, the
  hypsography.
- At the opening's z11 the archives' and the base map's outer tiles still
  cover the first few km past the box, so the live layers asked for the
  ground past it mostly showed nothing at the home view: at Pickle Lake the
  Toporama sheet 0.000% in Topo, Bush and Terrain and the province's photo
  0.000% in Sat. At Lac Bailey, whose z11 view reaches past those tiles,
  the province's photo was a tenth of Sat's picture.
- The view's own tiles are the smaller part of a cold open: the grids
  (10.5 MB at Pickle Lake, 19.5 MB at Lac Bailey) come with every view, and
  on the weak link the wind grid's bands shared the line with the tiles from
  the first second.
- On the weak link the views split by what their ground is made of: a
  photo or the DEM's tiles settled in 7.6–12.1 s; a view whose ground waits
  on one GeoJSON settled when the GeoJSON came (Topo's lakes: 24.8 s at
  Pickle Lake; the depth bands: 13.6–14.5 s).
- Per notch, the photo and the DEM cost 0.2–0.4 MB each; the 1 m LiDAR
  shade, drawn by Terrain alone among the views (Hunt keeps it off over the
  imagery at 0.35, saved maps or not: `lidarShadeShown`, mapStyle.ts:119),
  is the dearest layer at 0.44–0.95 MB a notch; the live photo under the
  baked one adds as much again in Bush, Scout and Lake.
- Of the bases with no view of their own, the Toporama lines and the depths
  are the lightest on a cold open (0.26–0.6 MB of tiles at Pickle Lake), the
  old sheets and the elevation colours the heaviest (1.3 MB, the colours
  with their 2.26 MB of lakes). Alone, each but the elevation colours brings
  the live base map back on in the box. On the weak link they settled in
  8.9–12.2 s, the elevation colours at Pickle Lake apart (24.2 s: the lakes
  again).
- Of the base-map candidates, Sat, Topo and Terrain are two taps away;
  Historical, the elevation colours alone and the shade alone are six; the
  Toporama sheet has no tap path in the box; the depths are two (by the
  quarry chip, Ontario only).
- Offline today: every candidate but the Toporama sheet and the MRDEM shade
  is in the saved pack. The far band is not; with no signal the baked
  imagery is the photo.

## Found on the way

- **The base map stops at z15.** At both areas NRCan's base map answered
  404 to every z16 and z17 tile (about 1 KB each), though `sources.ts`
  gives it `maxzoom: 17`. The idle read-ahead asks its ring again after
  every idle, and a 404 is not kept: one Bush run at Pickle Lake made 800
  such asks.
- **Two archives are read before the map is made in every view.** The
  coverage index (Explore's grid, 15 MB; Explore off) and the far band each
  get two 16 KB reads, awaited in turn (`MapView.tsx:216–218`): 66 KB and,
  on the weak link, 0.85 s of the 3.1 s to the map.
- **The far band at Pickle Lake.** The local test archive covers Lac
  Bailey only, but its z0–z4 tiles take in Pickle Lake, so the far band
  draws one z4 tile stretched under the imagery there. And since the
  archive is served, every area gets the hand-off: the province's photo is
  not asked below z11 (`FAR_HANDOFF`), so zoomed out past Pickle Lake's
  box the photo would be that z4 tile (read from the code, not shot).
- **The baked 30 m hillshade is never drawn** (the style takes the DEM
  path wherever a dem archive exists: all 8 areas), yet it is in the saved
  pack of the 6 areas that have one (3.8–12.9 MB; 7.8 MB at Pickle
  Lake).
- **Pickle Lake's area file lists a `bathy` archive** that was never baked
  (its depths are GeoJSON); the manifest lacks it and the save skips it.
- **Highland Lake's Historical** is 300 tiles of flat grey (above).
- **`historicalYear`** is persisted and read by nothing (above).
