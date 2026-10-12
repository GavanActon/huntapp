# Public data for calibrating the wind-regime classifier

Research note, 2026-10-12. Question: which public datasets let us label and calibrate the
classes the phone's classifier chooses between (coupled terrain wind, decoupled floor,
drainage, slope eddy or rotor, channelling, lake breeze, upslope), with a reference wind
above, some stability, near the surface, in relief or under trees? Builds on
[canopy-wind-sites.md](canopy-wind-sites.md) (towers for the floor ratio),
[WIND-LEARNING.md](../WIND-LEARNING.md) ("Data, the bottleneck") and SURROGATE.md §5 (the
Idaho campaigns). Data fetched for it are under `pipeline/raw/regimes/`, each with a README.

## 1. Short answer

- **Access tightened in 2026.** NEON needs a login or API token since 2026-06-30 (licence
  now CC BY 4.0); EDI (the LTER archive) needs sign-in since 2026-07-30, though the DataONE
  mirror (`gmn.lternet.edu`) still serves its files; every NCAR EOL campaign is an email
  order form (no account, but an email address); AmeriFlux needs a free account. Synoptic
  (RAWS) is internal, non-commercial use only without a paid contract; WRCC charges for RAWS
  history older than 30 days. The free ones are Gavan's call because they carry his identity.
- **Open with no identity:** SMEAR II (Finland, boreal pine, SmartSMEAR API), ICOS
  (licence-accept cookie), H.J. Andrews (its file cache), Hubbard Brook (DataONE mirror),
  Harvard Forest, Zenodo (Idaho, i-Box, PIANO, SEECAP, SPLASH's ARL tower), NOAA PSL
  (SPLASH), MADIS (public RAWS, heavy), SNOTEL/SCAN, USCRN, ECCC (GeoMet).
- **Fetched:** SMEAR II Sep–Nov 2019–2025 (the best quick win, in place of NEON), SPLASH
  Kettle Ponds Oct 2022 plus the 10 m tower 2021–23, and two fallbacks fetched before the
  survey landed: Harvard Forest's 2 m sonic and 29 m tower, and Idaho's Birch Creek campaign.
- **First look (SMEAR II, 4 autumns):** under neutral air above the canopy the 3 m floor
  follows the top within 45° 84% of the time and is calm 6%; under stable air 54% and 24%;
  very stable 18% and 60%. That is the shape of the likelihood the phone needs, and it
  turns on stability above the trees, not at the floor.
- **Gaps:** lake breeze has no open labelled set; rotors only in EOL campaigns (T-REX,
  Perdigão) behind the order form.

## 2. Ranked table (value per day of work)

Classes: **C** coupled, **D** decoupled floor, **Dr** drainage onset and direction, **R**
slope eddy or rotor, **Ch** channelling, **LB** lake breeze, **U** upslope. Cost = days to
parse, label and fit, not counting access.

| # | Dataset | Where, what | When, size | Access, licence | Classes | Cost |
|---|---|---|---|---|---|---|
| 1 | **SMEAR II, Hyytiälä** (fetched) | Boreal Scots pine ~18–20 m, gentle relief. Sonic wind 4.2 (2019+), 8.4, 16.8, 33.6, 67.2, 125 m; **subcanopy EC at 3 m with its own z/L**; EC at 27 m (u*, H, L); T profile 4.2–67.2 m (to 2024) | 3 m EC 2003–2022, rest to now; 30-min Sep–Nov ×7 = 4.5 MB | Open API, no login; CC BY 4.0 | C, D (floor vs above by stability, speed ratio) | 1 (done for 2019–22) |
| 2 | **NEON 2D wind + T profiles** (DP1.00001/00002, DP4.00200) | 47 towers, wind at every level; boreal BONA, DEJU; hardwood BART, HARV, UNDE; mixedwood TREE; relief at GRSM, MLBS, TEAK, WREF, ABBY, NIWO | 2017–now; few MB per site-month | **Free token** (since 2026-06-30); CC BY 4.0. `pipeline/raw/regimes/neon/fetch_neon.py` ready | C, D, Ch (sloped sites) | 2–3 |
| 3 | **SPLASH Kettle Ponds** ASFS-30 (+ ASFS-50 Avery Picnic) + ARL 10 m tower (fetched: Oct 2022, tower 2021–23) | East River valley floor, CO, 2,856 m, meadow under forested walls. Sonic 4.62 m with z/L, u*, ε, skin T, longwave; 10 m EC (u*, H, wind) | 2021-09 → 2023-07, 10-min; 1.5 GB in all | Open HTTPS + Zenodo; CC BY 4.0 | D, Dr (onset by z/L, time from sunset), Ch | 2–3 |
| 4 | **Idaho: Salmon River Canyon (held) + Birch Creek** (fetched) | SRC 27 sensors on canyon walls; Birch Creek 75 sensors in a valley and its mouth onto the Snake River Plain; 3 m cup-vane, 30 s | 2011 / 2013 Jun–Oct; 2.1 GB sqlite | Zenodo 8226638, CC BY 4.0 | Dr (direction, onset, strength), Ch; no stability | 0.5–1 (idaho.py) |
| 5 | **EOL order bundle**: SOS 633.001 (5-min, 233 MB), Perdigão 536.011 (503 MB), METCRAX II 386.001 (29 MB), SCP 5-min (90 MB), T-REX ISFF 92.086 (67 MB) + DRI 92.062 | SOS: 20 m tower sonics 1–20 m, T every 1 m (Kettle Ponds). Perdigão: forested double ridge, ~50 towers, sonics 2–100 m. METCRAX II: crater katabatics. SCP: 12 m-deep draw (bog-hollow analogue). T-REX: Sierra lee rotors | 2006–2023 | **Email order** form, no account; CC BY 4.0 by UCAR default (no EULA on these) | R (Perdigão, T-REX IOPs 6, 13), Dr (METCRAX II, SCP), D (SOS), U and Ch (Perdigão) | 8–10 for all |
| 6 | **i-Box Inn Valley** (+ PIANO, SEECAP) | Austria: valley floor (sonics 4–17 m, T 2–17 m), slope foot, 10° and 25° slopes, plateau; 5-min. PIANO: foehn breakthrough stations; SEECAP: basin cold pool | 2014–2020; 2.6 GB at 5-min | Zenodo 7846064 etc., open, CC BY 4.0 | U, Dr onset on slopes, Ch, D; foehn as a coupling label | 3–5 |
| 7 | **ECCC hourly via GeoMet** | Whistler transect 2005–10 (Nesters 659 m, Low 933, Mid 1320, High 1640, High Remote Wind 1690), Nakiska Ridgetop 2,543 m, any valley/ridge pair | 2005–now, hourly | `api.weather.gc.ca/collections/climate-hourly`, no key; OGL-Canada | D, Ch at the valley scale (stability only as the lapse between stations) | 1–2 |
| 8 | **Harvard Forest** HF288-03 + HF004-01 (fetched) | Hardwood ~23 m on a gentle hill: 2 m CSAT3 vs 29 m sonic, T profile, u*, H | 2010-11 → 2012-02 | Direct CSV, CC0 | D, Ch (floor runs one way; orientation unverified) | 0.5 (done) |
| 9 | **AmeriFlux BASE** (US-Prr, US-Uaf, US-x** NEON mirrors, CA-Gro, CA-TP) | Black spruce with 1.5–3 m levels (Prr, Uaf); Ontario stands | 2003–2024 | Free account; CC BY 4.0 | C, D under spruce | 1–2 per site |
| 10 | **H.J. Andrews** MS049 wind (6 stations, prop + sonic 1.5–12 m), MS001 T at 0.5/1.5/2.5/3.5/4.5 m, MS036 cold-air drainage (34 under-canopy T sites on 4 valley transects) | Old-growth Douglas-fir valleys, Oregon; PRIMET valley floor 430 m to UPLMET ridge 1,294 m | 1973–2025, 5–15 min; MS049 1.25 GB, MS001 3.9 GB | **Direct, no login** via `andrewsforest.oregonstate.edu/sites/default/files/lter/fsdbdata/cache/MS04914_v10.txt` (same for MS00111_v12, MS03602_v1); CC BY 4.0 | Dr in forest (onset, direction), D, Ch, U | 3–4 |
| 10b | **ICOS forest stations** (e.g. CH-Lae, CZ-BK1, CH-Dav, IT-Ren on hills; terrain not checked) | FLUXES L2: `ZL`, `MO_LENGTH`, `USTAR`, `WS`, `WD`, sigmas; METEOSENS T profiles (DE-Tha 12 levels, one wind level) | multi-year, 30-min; ~40 MB per site | Anonymous after `data.icos-cp.eu/licence_accept`; CC BY 4.0 | C, D (stability above; few in-canopy wind levels) | 2–3 |
| 10c | **Hubbard Brook** (knb-lter-hbr.337, .322, .333) | NH forested valley: 15-min wind at HQ and 2 sites, T in 6 clearings, 1.5 m under-canopy T across the valley | 2012–2025, ~40 MB | DataONE mirror, no login; CC BY | D, Dr (from T), weak Ch | 2 |
| 11 | **Marmot Creek / Wolf Creek** | Kananaskis forest vs clearing, ridge to valley; Yukon alpine, shrub, forest | 2005–16 / 1993–2014 | FRDR, CC BY 4.0; zip paused, Globus login | D, Dr, Ch in Canadian mountains | 2–3 |
| 12 | **PCAPS** (EOL order) | Salt Lake Valley floor, 7 stations | 2010-11 → 2011-02 | Email order | LB (Great Salt Lake fronts, IOPs 1 and 3), D | 3–4 |
| 13 | **WFIP2** (Wind Data Hub) | Columbia Gorge: 21 m tower sonics 3/10/21 m | 2015-10 → 2017-03 | Free account; CC BY 4.0 | Ch (gap flow), D | 6–10 |
| 14 | MATERHORN (EOL, EULA), CASES-99 (flat), Askervein, Bolund (neutral hills) | | | | U, Dr / D / speed-up only | 2–6 each, later |
| 15 | SNOTEL/SCAN, USCRN, ASOS 1-min | Mountain clearings (hourly wind + T, ~420 sites); USCRN 1.5 m speed (no direction) + IR skin T (inversion strength) | years, small | No login, public domain | D, Ch, Dr (weak) | 1–2 each |
| 16 | MADIS public mesonet archive (RAWS among them) | Hourly netCDF of all public mesonets since 2001 | ~29 MB per hour file | No login | C, Ch, Dr | 4–6 |
| 17 | BCWS data mart (BC fire weather) | Hourly wind, T, RH since 1987; station file gives slope, aspect, anemometer height (9–12 m) | ~220 MB a year | Direct, **no licence stated**: ask BCWS | Ch, Dr, D in BC valleys | 2 |
| 18 | Quebec RSCQ | 302 stations, 10 m wind, σθ, a second temperature in a forest clearing | **rolling 30 days only** | CC BY 4.0; archive it daily, like SWOB | D, Ch | 1 + a daily task |
| — | US RAWS via Synoptic; WRCC history | 10-min / hourly, rugged | | Synoptic: internal non-commercial use without a contract; WRCC: fee past 30 days | C, Ch | — |

Not found as files: Turkey Lakes (Algoma) met, Forêt Montmorency, SNOW-V10 extras, Ontario
MNRF fire weather history beyond 30 days, Great Lakes lake-breeze day lists (ELBOW 2001,
BAQS-Met), Alberta chinook lists, cold-pool, drainage-onset and rotor catalogues. Ready-made
labels that do exist: MeteoSwiss's 10-min foehn index (39 stations, CC BY, direct CSV),
Austrian daily foehn labels (Zenodo 13903799, 10478610), one month of Lake Michigan
lake-breeze labels (Zenodo 21458900). Regime labels in the campaigns are tables in papers (T-REX IOPs: Grubišić et al. 2008 BAMS;
PCAPS: Lareau et al. 2013 BAMS; METCRAX II: Lehner et al. 2016), about half a day each to
transcribe.

## 3. First look

### SMEAR II: a flat boreal pine floor

`pipeline/raw/regimes/smear-ii/first_look.py`. Floor = 3 m subcanopy EC; top = 33.6 m
sonic; stability above = 27 m EC, z/L with z − d ≈ 14 m. Sep–Nov 2019–2022, half-hours
with the top at 1.5 m/s or more (13,073). Calm floor = under 0.25 m/s. Decoupled = calm, or
the floor over 90° off the top. In winds over 4 m/s the floor backs 9° from the top (IQR
−21 to +7°).

| | half-hours | calm floor | floor within 45° | floor > 90° off | decoupled | floor/top speed |
|---|---|---|---|---|---|---|
| day, neutral | 3,614 | 5% | 85% | 0% | 6% | 0.19 |
| day, unstable | 341 | 10% | 74% | 0% | 11% | 0.22 |
| night, neutral | 4,537 | 7% | 83% | 0% | 7% | 0.18 |
| night, stable (0.1 < z/L < 1) | 1,383 | 23% | 55% | 4% | 27% | 0.13 |
| night, very stable (z/L > 1) | 176 | **61%** | **18%** | 13% | **74%** | 0.09 |
| night, top 1.5–3 m/s | 2,740 | 20% | 59% | 2% | 22% | 0.18 |
| night, top 3–5 m/s | 3,218 | 6% | 85% | 1% | 8% | 0.17 |
| night, top > 5 m/s | 686 | 0% | 99% | 1% | 1% | 0.17 |

Stability measured **at the floor** predicts nothing: the trunk space is unstable at night
under a crown that cools (calm 18% when the floor reads unstable, 4% when it reads stable).
The classifier's stability input should be the air above the trees, which the phone can
estimate from the forecast's wind, cloud and time from sunset.

### Harvard Forest: a hardwood floor on a hill

`pipeline/raw/regimes/harvard-forest/first_look.py`. Floor = 2 m CSAT3, top = 29 m sonic,
hourly, Sep–Nov 2011 (1,288 hours) and all 15 months.

| | hours | calm floor | floor within 45° | decoupled | floor/top speed |
|---|---|---|---|---|---|
| Sep–Nov, day, neutral | 397 | 7% | 29% | 54% | 0.17 |
| Sep–Nov, night, neutral | 339 | 12% | 21% | 58% | 0.17 |
| Sep–Nov, night, stable | 157 | **55%** | 1% | **86%** | 0.13 |
| leaf-on (Jun–Sep), night | 472 | **47%** | 7% | 88% | 0.13 |
| leaf-off (Nov–Apr), night | 2,134 | 10% | 16% | 62% | 0.17 |

- **Same calm-floor response as SMEAR II:** 7–12% under neutral air, about 55% under
  stable air, and leaves double it at night.
- **Not the same direction behaviour.** Here the floor blows from 144–239° whatever the
  top's sector (mean resultant 0.84–0.98 within each sector). Staebler & Fitzjarrald (2005)
  found the understory here aligned with the air aloft only 33% of the time, flowing from
  the up-slopes to the north. That supports a channelled floor on a hill, against SMEAR II's
  flat one that follows. But our floor's favoured direction is the opposite of theirs, so
  the 2 m sonic may be 180° out. Use its calm share and speed ratio, not its direction,
  until that is settled.

**What it yields:** P(floor follows | stability above, top speed, leaf state, terrain). On
flat ground that is the SMEAR II table. On a hill the floor takes its own direction, slope
and gaps deciding it, and only a sloped tower set (NEON's, Andrews) can say how often.

## 4. Order of wiring

1. **SMEAR II in full** (1 day): every month of 2003–2022 for the 3 m EC, plus stability
   from the 27 m and 23.3 m systems. It sets the flat-canopy table for C and D by z/L, top
   speed, hour and leaf-off birch.
2. **NEON with a token** (2–3 days): the same table at BONA and DEJU (black spruce), TREE
   and STEI (mixedwood, aspen), BART (hardwood), and the sloped towers (GRSM, MLBS, WREF,
   TEAK), which say how terrain moves the floor's direction. This is the main prior for D.
3. **SPLASH Kettle Ponds, two winters** (2 days): drainage onset and decoupling on a valley
   floor by z/L and time from sunset, against the 10 m tower.
4. **Idaho at night** (1 day): Salmon River and Birch Creek down-valley flows, onset time
   and direction against the plain or ridge reference; the test set for any stability
   teacher (WIND-LEARNING layer 1).
5. **One EOL email order** (8–10 days of work): SOS, Perdigão, METCRAX II, SCP, T-REX, with
   their IOP tables as labels. Perdigão and T-REX carry the rotor class; nothing open does.
6. **H.J. Andrews** (3–4 days): drainage onset and direction under old growth, valley floor
   against ridge, with the 0.5–4.5 m temperature profiles; the forested counterpart of
   step 4, open now.
7. **i-Box** for upslope onset and slope drainage; **ECCC Whistler/Nakiska** for valley-ridge
   coupling in Canadian mountains; start archiving Quebec's RSCQ daily (30-day window).
8. **Lake breeze last:** our own SWOB shore stations and the shoreline transects of
   SHORE-WIND.md; PCAPS's two fronts are the only labelled public cases found.

## 5. What each class would rest on

| Class | Rests on | Strength |
|---|---|---|
| Coupled terrain wind | SMEAR II and NEON under neutral air (floor follows ~84%, speed 0.17–0.19 of the top); Big Southern Butte for terrain speed-up | strong |
| Decoupled floor | SMEAR II and NEON by stability above, leaf state; SPLASH and SOS on a valley floor; Harvard as a hill case | strong after step 2 |
| Drainage (onset, direction) | Salmon River, Birch Creek, SPLASH, Andrews (forest, open), METCRAX II, SCP | medium; Andrews and the EOL order make it strong |
| Slope eddy or rotor | Perdigão, T-REX IOPs (order form); Searchmont stations once bought | weak until the order |
| Channelling | Salmon River, Birch Creek, i-Box, ECCC valley stations, Harvard's floor | medium |
| Upslope | i-Box slopes, SPLASH by day, Perdigão; MATERHORN later | medium |
| Lake breeze | own shore stations and transects; PCAPS IOPs | weak |

## 6. Access asks for Gavan

All free; each needs his identity, so none was done here:
- a NEON account and API token (unblocks step 2);
- one EOL order with his email (step 5);
- an AmeriFlux account (spruce floor levels at US-Prr and US-Uaf);
- optionally an Earthdata login (BOREAS jack pine) and an ARM account (SAIL).

## Sources

- NEON login and licence change: https://www.neonscience.org/impact/observatory-blog/logins-required-and-data-licensing-updated
- SmartSMEAR API and variables: https://smear-backend.2.rahtiapp.fi/search/variable?table=HYY_META (and HYY_EDDYSUB, HYY_EDDYMAST); licence per https://smear.avaa.csc.fi/
- Harvard Forest HF288 and HF004: https://harvardforest1.fas.harvard.edu/exist/apps/datasets/showData.html?id=HF288, …?id=HF004
- Staebler & Fitzjarrald 2005, "Measuring canopy structure and the kinematics of subcanopy flows in two forests", J. Appl. Meteorol. (abstract: https://ameriflux.lbl.gov/?p=5387)
- SPLASH: https://downloads.psl.noaa.gov/Observations/Campaigns/SPLASH/ and Zenodo 10.5281/zenodo.10558503 (ARL 10 m tower)
- Idaho campaigns: Zenodo 10.5281/zenodo.8226638
- NCAR EOL metadata: https://data.eol.ucar.edu/zinc/dataset/536.011?format=text (Perdigão); order form https://data.eol.ucar.edu/cgi-bin/codiac/fgr_form/id=<ID>
- i-Box: Zenodo 10.5281/zenodo.7846064; PIANO 10.5281/zenodo.5795431; SEECAP 10.5281/zenodo.13838143
- ECCC: https://api.weather.gc.ca/collections/climate-hourly
- Andrews MS049: https://andlter.forestry.oregonstate.edu/data/abstract.aspx?dbcode=MS049 (CC BY 4.0)
- Marmot Creek: Fang et al. 2019, ESSD 11:455, data 10.20383/101.09
