# Pic River — hunt & fish maps

Offline-first map PWA for the camp on Pickle Lake, north-west of White
River, Ontario (with McGill, Ketchup and Line Lakes; WMU 21B). Same shape as the Sandies boat app: full-bleed map, outlook strip on
top, a bottom sheet with Places · Spots · Layers · Weather · Settings.

**Spots** answers "where should we be today": pick moose, grouse, bear,
deer, walleye, pike or lake trout and it scores every 30 m cell of the
region from a baked habitat grid (FRI stands and their age, burns and
cuts, LiDAR-derived landform, lake shores, wetlands, estimated depth,
fetch) against the hour's HRDPS wind, temperature, light and the season,
then lists the best few spots near camp with reasons, a verdict card for
the day, a heat map, and a scent cone from your pin. The rules and their
sources are in [docs/HUNT-FISH-SCIENCE.md](docs/HUNT-FISH-SCIENCE.md).

Layers: contours and spot heights (NRCan Toporama), LiDAR hillshade, imagery, forest
cover (Ontario FRI), lake depths (MNR surveys), historical NTS sheets,
camps (Crown land use permits), WMU boundaries, private land, parks,
burns, bush roads, weather radar, wind-flow particles (HRDPS wind at the
picked hour, the boat app's engine), and a seven-day forecast whose first
two days are ECCC's HRDPS 2.5 km by name. The ruler on the map stack
measures range and bearing leg by leg, with time on foot at a set pace. Where the pipeline has not baked a layer yet the app
draws it from the live service instead; see [docs/DATA-SOURCES.md](docs/DATA-SOURCES.md).

## Spots: progressive disclosure

The rule for the whole app: the high level first, the detail one tap
deeper, never all at once.

- **Tap the map** in a target mode: a score and the day's headline. `why`
  unfolds the reasons. `the arithmetic and the knobs` hands the point to
  the Spots tab as a probe.
- **Spots tab**: the week's morning and evening windows (one suggested),
  the day's verdict at the planning time, the case for the pin or probe
  (score → reasons → arithmetic: habitat parts, site parts, the day's
  factors, each with its raw value and its weight), the best spots, and
  the scoring knobs folded at the bottom.
- **Knobs**: every component has a weight, 0 (off) to 2 (double), persisted.
  Turn off `Roads and landings` to ignore roads. The heat map, the spots
  and the week follow. The rules themselves are in `app/src/spots/` and
  documented in `docs/HUNT-FISH-SCIENCE.md`.
- **Windows and hours**: the week view scores legal-light windows (half an
  hour before sunrise to three hours after; three hours before sunset to
  half an hour after) and picks the best hour in each; the outlook strip
  still plans any single hour.

## Layout

- `app/` — the PWA (Vite + React + TypeScript, MapLibre GL, PMTiles)
- `pipeline/` — Python scripts that bake the region into `app/public/data/`
  - `build_vectors.py` — LIO ArcGIS layers → GeoJSON (camps, WMU, roads, bathy…)
  - `build_tiles.py` — a live tile service (imagery, MRDEM hillshade) → raster PMTiles
  - `build_hillshade.py` — NRCan HRDEM 1 m LiDAR → hillshade PMTiles
  - `build_raster.py` — any georeferenced GeoTIFF (Toporama 50k, CanMatrix2
    historical sheets) → raster PMTiles
  - `georef_sheet.py` — pins a CanMatrix2 scan's neatline to its NTS sheet bounds
  - `gen_icons.py` — app icons

Two boxes drive every bake, both in `app/src/config.ts`: `CORE` (about
4 km around the camp on Pickle Lake, baked to z16) and `REGION` (about
12 km around it, baked to z13; the map does not pan beyond it). Camp has signal only
morning and night, so offline is the product: the Settings tab downloads
the whole bundle to the phone.
- `docs/DATA-SOURCES.md` — every source, endpoint and licence

## Develop

```
cd app
npm install
npm run dev
```

`npm run dev:phone` serves over self-signed HTTPS on port 5176 so a phone on
the same Wi-Fi gets location.

## Bake the region

```
pip install numpy pillow rasterio pmtiles requests shapely
python pipeline/build_vectors.py
python pipeline/build_tiles.py satellite hillshade-mrdem
python pipeline/build_hillshade.py                  # replaces the MRDEM hillshade with 1 m LiDAR
python pipeline/build_tiles.py topo   # Toporama hypsography (contours) via WMS
python pipeline/georef_sheet.py pipeline/raw/sheets/042c13_02.tif 042C13   # CanMatrix2 scans have no georef
python pipeline/georef_sheet.py pipeline/raw/sheets/042c14_02.tif 042C14
python pipeline/build_raster.py historical pipeline/raw/sheets/042c13_geo.tif pipeline/raw/sheets/042c14_geo.tif --minz 9 --maxz 15
```

The sheets come from `https://ftp.maps.canada.ca/pub/nrcan_rncan/raster/`
(`toporama/50k_utm_tif/042/c/` and `canmatrix2/50k_tif/042/c/`), unzipped
into `pipeline/raw/sheets/`.

Region bounds live in `app/src/config.ts` (`REGION`) and are read by the
pipeline from there.
