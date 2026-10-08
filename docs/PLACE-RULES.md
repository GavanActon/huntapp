# Rules that know the place

The hunt heat map's rules were written for boreal Ontario (Pickle Lake,
48.9° N). In the mountains they went wrong. The alpine dwarf shrub at
Highland Lake scored as prime moose browse. The north's slow regrowth was
missed, and there was no grizzly, no ptarmigan, no treeline and no season.
The research is in
[docs/research/reports/Mountain hunt habitat rules.md](research/reports/Mountain%20hunt%20habitat%20rules.md),
with its notes beside it.

The fix is a standard, not a mountain branch. Each place has a **profile**.
The rules read the profile, and nothing else about where they are. A new
area plugs in by having a profile and a zone in the species table. It
needs no edit to the rules. An area with neither scores as boreal Ontario
did.

## The three parts

| Part | Where | What it says | Who keeps it |
|---|---|---|---|
| Profile | the area file's `profile` | the treeline (and on north and south faces), the CEC ecoregion, whether the north's calendars apply, whether the stand map measures shrub height and maps lead species | `pipeline/build_profile.py`, a bake step after `habitat` |
| Species table | `app/src/spots/regs.ts` | for a jurisdiction and zone: who is there (hunted, asked not to, draw only, no season, absent), the seasons, what is legal, the zone's own lines, the edition and the day it was read | by hand, from the regulation book |
| The day | `Conditions` | the date, the heat, live snow on the ground (Open-Meteo `snow_depth`) | the forecast |

`app/src/spots/profile.ts` puts them together for the rules. The rules that
depend on the place are in `app/src/spots/placeRules.ts`, and
`huntRules.ts` calls them.

## What the profile changes

These are the research report's fixes, by number. Most of the numbers are
reasoned starting points that no one has field-checked.

- **Height over the treeline** (`dz`, per cell): elevation minus the
  treeline. The treeline is the line of the way the slope faces where north
  and south faces were measured apart.
  - **Moose band (fix 2):** full from 250 m below the treeline to 50 m
    above it in the rut. After 15 Oct it is full from 200 m below to 100 m
    above. It tapers to 0.6 by 500 m below; willow on a creek is exempt.
    Above the band it falls to 0.4 at 150 m over and to 0.2 beyond. With
    40 cm of snow or more, the high ground empties.
  - **Shrub (fix 1):** above the treeline, shrub is dwarf birch and heath:
    0.1, not 0.9, unless the stand map measured it tall. Where the map
    measures height, 1 m shrub is 0.55.
  - **Open country** (from 300 m below the treeline up):
    - a weak cover-edge term (fix 6);
    - a lake bonus of 0.05, and 0.1 for a willow creek draw (fix 7);
    - funnels at a third (fix 18).
  - **Forest grouse** thin out toward the treeline (fix 12).
- **Steep ground**, everywhere: 1 under 12°, 0.75 at 20°, 0.45 at 30°,
  0.25 from 40°. On the Shield it rarely bites.
- **The north** (CEC Level I Tundra, Taiga or Northwestern Forested
  Mountains, or north of 57°):
  - burns peak at 11–30 yr, not 10–20 (fix 5);
  - the rut climbs from 1 Sept and calling is done by 11 Oct (fix 14);
  - the black bear dens from about 1 Oct (fix 10).
- **Species:**
  - **Bear** is black bear plus grizzly where grizzlies are hunted (fix 8).
    In BC there is no grizzly season, so the bear map there is black bear,
    and black bears give way on the grizzlies' high berry ground.
  - **Grouse** is grouse plus ptarmigan where there is ground above the
    trees (fix 11).
  - A target's heat is the best of its species that are in season that
    day.
- **The menu:** a target none of whose species is here or may be hunted
  is hidden (deer at Blanchard).
- **The verdict** carries:
  - the season and what is legal (Blanchard's antler restriction);
  - the zone's lines (Ethel Lake caribou, settlement land);
  - the grizzly kill-site card wherever grizzlies are.
- **Access (fix 3):** the carry back to a road, a boat lake (20 ha up, or
  `bake.transport.lakeHa`) or a camp or landing pin. It counts every 100 m
  of climb as a km on the flat. The band is `packOut` in the habitat grid.
  A fresh phone has the Roads and landings knob off.
- **Road traffic (fix 16):** ×0.6 within 250 m of a paved highway, back
  to 1 by a kilometre, and 0.85 on a road or trail. It has its own knob,
  "Road traffic".
- **Heat:** moose feel it from 14 °C until mid-September and from 10 °C
  once the winter coat is in (1 Oct). The ramp between is inference.

Two new knobs come with this: **Height and slope** (habitat) and **Road
traffic** (site).

## Adding an area or a zone

1. **Bake:** `bake_area.py` runs `profile` after `habitat`. The habitat
   grid gains `packOut`, `distHighway` and `distStream`. Road kinds come
   from each province's own words (`build_habitat.road_kind`).
2. **The species table:** if the zone isn't in `regs.ts`, add it from
   the current synopsis, naming the edition and the day it was read. Until
   then every target shows and there are no season lines; the area
   checklist says so.
3. **Check:** run `python app/scripts/heat_bands.py <area> <date>` with
   the dev server up. Wherever there is a treeline, half or more of
   moose's top tenth should sit in the treeline band. The area checklist
   shows the profile and whether the zone has a species entry.

## Still to come

These are the next axes. Each one is a field in the profile and a reader in
`placeRules.ts`.

- **Climate normals** (AdaptWest ClimateNA, 1 km, CC-BY): degree-days
  for berry timing and regrowth speed, and the October temperature for the
  heat threshold, in place of the north flag. Also a climate treeline
  (Paulsen & Körner) to bound the measured one.
- **Provincial zones over the CEC ecoregion:** BC's BEC zones (WFS) and
  the Yukon's bioclimate zones.
- **Tall and dwarf shrub from NALCMS** (class 8 against 11–13) where the
  stand map has no shrub height. Highland Lake's shrub height comes from
  SCANFI and isn't trusted.
- **Snow by elevation:** the forecast point's snow, lapsed up to the
  treeline band.
- **Not built:**
  - salmon reaches for the grizzly (Blanchard: chinook to early Sept,
    sockeye and coho into Oct);
  - the vantage (glassing) layer;
  - the kill-site plume on the scent cone;
  - a closure mask for the Yukon land west of the Haines Highway (game
    birds, unconfirmed).
- **Fish** gated the same way: the walleye, pike and lake trout targets still show at Blanchard.
- **Explore:** the same profile per 11 km tile, with the zone found from
  the hunting-unit polygons.
