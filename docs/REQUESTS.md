# Requests, locations and accounts

Status: design decided 2026-10-24 (Gavan's six calls, below). Step 1
(locations own their builds) is built and tested, and waits for the Worker
deploy: "Step 1, as built" below. It replaces this doc's 2026-10-13 plan
(sign-in by email link, Google and Apple from the start). What ran before
it is under "Before step 1". The SD bake itself is [SD-FAST.md](SD-FAST.md);
the box and Explore are [EXPLORE.md](EXPLORE.md).

## Decided

Gavan, 2026-10-24: "We keep circling the account creation process ...
ideally locations are tied to you, so you request a location, we let you
know its done. You can see the build is in the queue and potentially how
far it's done ... Builds aren't tied to bakes ... a location requested
doesn't become populated for everyone."

| Question | Answer |
| --- | --- |
| Does Load start the build | Yes, by itself; one build at a time per phone |
| Sign-in | An email and a 6-digit code, no password. Google and Apple wait for the app-store build |
| An email for a build | Optional for SD, required for HD |
| The areas everyone sees | Pickle Lake, Lac Bailey, Clearwater, Blanchard River, Luther: one per kind of country ("Need different biomes") |
| The asker's emails | On: Workers Paid ($5 a month) and Email Sending |
| A pack that already covers a new ask | It serves the ask at once, and nobody is told whose build it was |

Still standing from 2026-10-13: one account per email; many machines
bake (the cloud later), nothing tied to one PC; Cloudflare's own email
sending.

## Before step 1 (2026-10-24)

- The bake agent (`pipeline/agent.py --watch` on XEVO, xonix joining)
  bakes queued SD requests, puts the files on R2 under
  `data/areas/<id>/` and reports done with the area file; D1's `areas`
  keeps it. `groundwind.app/areas/index.json` (site/bake.js `areaIndex`)
  lists every done one with its centre, to anyone, under ids anyone can
  guess (`area-r10` at 46.791, -83.743 on 10-24).
- The app opens only the areas built into it (`app/src/areas/*.json`) and
  boxes loaded over the national SD tiles (`areas/runtime.ts`). So a done
  request opens nowhere until a developer commits its area file and
  promotes. The ready email (`site/mail.js readyMail`) links
  `?area=<id>`, which falls back to Pickle Lake today.
- All 12 built-in areas are in every phone's Locations.
- A phone's asks live in its own storage (`explore/store.ts` `requested`),
  each with the email typed into it. An iPhone's Safari and its Home
  Screen app keep separate storage, so one phone is two people.
- Request #10's SD bake took 4,543 s, 85% of it map pictures the app
  streams anyway: topo 1,308 s, dem 2,299 s, satellite 223 s, historical
  38 s. The grids (vectors, property, forest, habitat, bush, wind-sd,
  micro, going) took about 9 minutes.

## The model: the hunter's location, our pack

- **Location** (the hunter's): a box with a name, on their list. Its id is
  the box's (`b-x0-y0-x1-y1`, `explore/box.ts`) from the moment it is
  loaded, and never changes, so pins, notes, checks and saved views (keyed
  by area id, `areas/index.ts areaKey`) stay with it through every
  upgrade. Nobody else sees it unless they are sent its link.
- **Pack** (ours): the built data for some ground, SD or HD: a row of D1's
  `areas` and R2's `data/areas/<pack>/`. A new pack's id can't be guessed
  (`sd-` or `hd-` and ten random characters), and the id is the only way
  to it.

A location points at the best pack covering it, or at none yet (the
national tiles and the forecast alone). One pack serves any number of
locations: two people asking for the same lake get one build, and neither
sees the other. When a better pack lands (SD to HD, or a rebake), the
location's pointer moves; the phone keeps using the old pack's files until
the new one is whole on the phone, so nothing changes under a hunter in
the bush.

**No release per build.** The phone keeps a location's pack area file with
the location (`huntapp-locations`, `areas/runtime.ts`), read before the
active area is settled, as loaded boxes are today. The area made for the
location is the pack's area file under the location's id and name. A done
build is: fetch the pack's area file, keep it, reload into it. Only the
demo areas are built into the app.

## Layers: five routes, four states

Every layer reaches the hunter one of five ways, and that decides when:

| Route | Layers | Reaches the hunter |
| --- | --- | --- |
| Streamed, national | Topo, imagery (the far band, the province's or Esri's), relief, shade and 10 m contours from the DEM, the forecast, lakes (the national archive, booked), coverage | On browse with signal; the box's slice saved for no signal |
| National tiles baked ahead | SD ground wind (Ontario and Québec done, the rest under way), the stand bands | At Load where baked; else with the build |
| Built per location, SD (minutes) | Heat map and spots, routes, the province's water, roads, lots and WMUs for no signal, inventory stands, the bush estimate | Minutes after Load |
| Built per location, HD (hours) | WindNinja's wind, 1 m shade and contours, the point cloud's bush, shooting lanes, sight lines, 10 m routes | After Make it HD; all but the wind need LiDAR |
| The hunter's own | Pins, paths, checks, the hunt log | Made on the phone; with an account on every device; shared with the party |

At any location each layer is shown in one of four states: **Here** ·
**Arriving** (the build under way brings it) · **HD** (from data that
exists here) · **Not possible here**, with why (no LiDAR flown, no
inventory published). `ui/layersHere.ts` already reads have / ask / hd /
none; `ask` becomes "arriving" because the build starts by itself. A
button for a layer that is not here stays, dimmed, and a tap says which of
the four and why.

Two grades, named by the wind: SD and HD. A location on the national tiles
alone is SD with layers arriving, not a grade of its own. HD with no LiDAR
under it (Clearwater) is HD wind, and the sheet says the bush and lanes
stay SD there.

The direction is up the table: per-location builds become national tiles
(habitat, the walking grid, the bush model by province), as lakes and the
far band did. The states and the journeys don't change while that
happens; things arrive sooner.

## The SD build, cut to the data

The agent's SD bake drops the steps a loaded box already lives without,
because the app streams them (topo, satellite, historical, dem and its
hillshade; SD-FAST.md), and keeps vectors, property, forest, habitat,
profile, bush, depth-bands, wind-sd, micro, going, vector-tiles and
coverage: about 9 minutes on #10's log, the bush model's ~2 the first to
go national. Short enough to watch in the app, which is why SD needs no
email.

## The journeys

1. **SD tiles under the box.** Load: the ground wind is on at once (the
   national tiles) and the build starts. The heat map, routes and the
   pack for no signal arrive minutes later; their buttons say "arriving"
   until then.
2. **No SD tiles yet** (the US, Canada outside Ontario and Québec). The
   same Load: the forecast's wind until the build lands with the ground
   wind in it. A wait longer than a few minutes offers "Email me when
   it's ready" (optional) and "See what you'll get" (a demo area).
3. **A second Load while one builds** waits on the phone, "next after
   Black Lake", and goes when the first is done. A Load with no signal
   goes when signal comes. A Load over ground a pack already covers opens
   it, no build (Reuse, below).
4. **Make it HD.** From the location's row or the SD | HD pill. The card
   says what HD changes here (the layers table), the size and "about a
   day", and takes the email and its code. Ready, Install HD downloads
   with the rings turning gold as the files land.
5. **Another device, or the Home Screen app.** Settings, Sign in, the
   email, the code: the locations come; their packs download on open or
   Save.
6. **Share.** A location's link adds it to the friend's list, on the same
   pack. HD across a party waits for payments (Locks).
7. **Remove.** Off the list. The pack stays while any location uses it.

## Status: in line, how far, and telling them

- **In line:** "2nd in line", the queued builds ahead that a running
  machine can take.
- **Time:** only while a bake machine has called in within the last 10
  minutes: the median of the last builds of that kind, times the place in
  line. With none: "in line · builds pick up when our machines are
  back". Never a clock made up.
- **How far:** the agent reports each step already; each kind of build
  gets its steps weighted by their measured times (from the bake logs),
  so the bar moves as the work does.
- **Where:** the Locations row, the box on the map (dashed while in line,
  filling while it builds) and the pill. For HD also a page on the site,
  `groundwind.app/l/<token>`, which the emails link to: the box on a map,
  how far, what HD adds, Open in the app. It works on the computer the
  ask came from. The app and the page read one answer.
- **The answer:** `GET /api/request?id=` (or `?t=<token>`) gains `ahead`,
  `minutes` (null with no machine in), and `done` (0 to 1). The token is
  new and random; the request's number is easy to guess, so the page uses
  the token.
- **A snag:** "We hit a snag on this one; we're on it", nothing red;
  Gavan is told.

## Accounts

Asked for only when something has to find the hunter later or follow
them: HD, an optional SD "email me", their locations on another device,
or the Home Screen app. Never to browse, load or use anything on one
phone.

1. `POST /api/auth/start {email}`: a 6-digit code by email, good for 15
   minutes and 5 tries; at most 5 codes an hour per address and per
   sender.
2. `POST /api/auth/verify {email, code, install}`: a session: a random
   token kept hashed in D1 and on the phone, one per install, good for a
   season and renewed while used.
3. The phone sends the session with its asks and its location changes.

**Why a code.** On an iPhone a link in an email always opens in Safari,
never in the Home Screen app, whose storage is separate: a sign-in link
would sign in the wrong place. Google's and Apple's redirects have the
same trouble in a Home Screen app. A typed code works in both, and in the
store build later. Email alone also stays clear of the App Store's rule
that an app offering Google sign-in must offer Sign in with Apple
(guideline 4.8).

**Locations with an account:** `GET /api/me/locations` (the list, each
with its pack and grade) and `POST` (add, rename, remove). At sign-in the
phone's own locations go up and merge by box id; from then on the list
follows the account. With no account the list stays on the phone, as
today. An HD ask needs the session; an SD ask carries the install, and
the session when there is one.

## Access

- **A pack:** anyone with its id, which only its links carry.
  `/areas/<pack>/area.json` answers by id; `/areas/index.json` lists the
  demo areas alone.
- **HD files, later:** on a private prefix through the Worker, which
  checks the unlock (Locks).

## The demo areas

Pickle Lake (Ontario boreal), Lac Bailey (Québec), Clearwater (Alberta
foothills), Blanchard River (northern BC mountains) and Luther (Michigan
hardwoods): built in, listed for everyone, fully open as the shop window.

The other built-in areas (Searchmont, Whitefish Lake, Duhamel, Clearwater
East, Highland Lake, Emerald Lake, sault-test) become packs: their area
files leave `app/src/areas` for rows of D1's `areas`, reachable by link.
They keep their ids, since moving their R2 folders would break the maps
phones have saved; unguessable ids are for new packs. A phone that has
opened one, or saved its maps, keeps it as a location on its pack, so
nothing is taken from a phone that uses it; a new phone never sees them.
Their owners are set once accounts exist (Gavan's own asks; Clearwater
East is Austin's).

## Reuse

At a new ask the Worker looks for a done pack whose core holds the whole
box, of the grade asked for or better (an HD pack serves an SD ask). If
one does, the request is done at once on that pack and the phone opens
it. Nobody is told it was another person's build. HD over ground only an
SD pack covers is a new build.

## Locks: SD against HD (2026-10-13, unchanged)

Gavan, 2026-10-13: "better locks for content that's SD vs HD". One table
in the app (`tiers.ts`) says each layer's tier; HD files move to a private
prefix on R2 served by the Worker (`/api/data/<pack>/<file>`, ranges
passed through), which checks the account's unlock or a party's share; a
phone that saved a pack keeps it after a pass lapses (the lock is on the
download, not on what was saved, the keep-the-bake rule of 2026-10-09);
`/api/me` gives the phone a signed list of its unlocks with an expiry for
no signal; a locked layer keeps its place and a tap says what HD adds
here, or that HD isn't possible here. The demo areas stay open. HD is
everyone's until payments (Gavan, 2026-10-16).

## Runners

Today one shared `BAKE_KEY` and `GET /api/bake/next?agent=&kinds=sd`
(site/bake.js), one agent per PC. The plan stands: a key per runner
(`runners`, kept hashed), claims by what a runner can do (`gpu`, `cpu`,
`lidar`, `fri-on`), leases a runner renews as it reports, a lapsed lease
back in the queue (three tries, then a snag). The `runners` row's last
call is what "a machine is in" reads. HD's WindNinja directions go on the
R2 queue (`pipeline/r2_queue.py`), the many-machine pattern the SD tiles
use.

## Email

- **NOTIFY** (on since 2026-10-23): Email Routing's free sending to
  Gavan's inbox (the `OWNER_EMAIL` secret): a note on every request.
- **MAIL** (Workers Paid and Email Sending, Gavan's yes 2026-10-24): from
  `noreply@groundwind.app` to the asker: "we have it", "it's ready", and
  the sign-in code. The binding goes on with step 1, not before:
  `readyMail`'s link only opens once the app keeps packs. Its links go to
  the status page (`/l/<token>`), which has Open in the app.

## Data (D1)

| Table | Holds | |
| --- | --- | --- |
| requests | + token (the status page's), account | exists; new columns |
| areas (the packs) | + visibility (demo, link), grade | exists; new columns |
| accounts | id, email, created | new |
| sessions | hashed token, account, install, created, last seen | new |
| codes | email, hashed code, created, tries, used | new |
| locations | account, id (the box's), name, pack, added, removed | new |
| runners | name, last call; later a hashed key and what it can do | new |
| unlocks | account or party, pack, until, how | with payments |

New columns are `ALTER TABLE`, run by hand: `CREATE TABLE IF NOT EXISTS`
never adds a column to a table that exists. Check the remote `PRAGMA
table_info` after.

## Order

| | Piece | Effort | Gavan's part |
| --- | --- | --- | --- |
| 1 | Locations own packs: the phone keeps a pack's area file; Load starts the build (one per phone, email optional for SD); in line, time, how far; upgrade in place; reuse; the list to the demos; unguessable pack ids; the demo split | built 2026-10-24 | the Worker deploy and D1 columns; MAIL on with it |
| 2 | The SD build cut to the data | 1–2 days | none |
| 3 | Accounts: the code, sessions, `/api/me/locations`, the status page | 3–4 days | the Worker deploy, D1 tables |
| 4 | HD through the agent: WindNinja on the R2 queue, Install HD | about a week | none |
| later | Payments, unlocks, HD across a party; Google and Apple with the store build | | |

## Gavan's part

- **Done 2026-10-24:** Workers Paid, and Email Sending for groundwind.app
  (hello@ the sender). The `MAIL` binding in `site/wrangler.toml` is on.
- **Each step:** `npx wrangler deploy` from `site/` and the D1 changes;
  the safety check stops a session doing either.

## Step 1, as built (2026-10-24)

Gavan's "yes" to step 1. Built in the app, the Worker and the agent;
tested against a local Worker and database and the real `area-r10` pack
on R2. The app reaches hunt-dev with the push; the Worker parts wait for
Gavan's deploy, and the app holds what needs them until then.

**The phone** (app/src):

- `areas/runtime.ts`: a location keeps `pack` and the pack's area file
  (`def`). `locationArea` opens it on the pack (`packArea`: the pack's
  file under the location's id and name, `loaded: 'pack'`, `stem` the
  pack's id) with signal, or with none when the pack's wind grid is on
  the phone or nothing of the box's is (`packFirst`); else the box.
  A link's `p=` names the pack (`addressLocation`).
- `areas/index.ts`: `stemOf(a)` is the name files go by (config.ts
  `REGION.id`, `dataFiles`, the bundle), so a location on a pack reads
  `micro-<pack>.hab` while its pins and views stay under its own id.
  `DEMO_AREAS` (Pickle Lake, Lac Bailey, Clearwater, Blanchard River,
  Luther) are every phone's; any other built-in area is kept only by a
  phone that has been in it (a saved view or the saved area), or whose
  address names it (`keptBuiltIn`, `huntapp-kept-areas`), and Locations
  can remove it (`dropKept`). `locationWords` puts `name`, `j` and `p` in
  links and the address.
- `explore/requests.ts`: each location's build (`builds` in
  `explore/store.ts`, an old SD ask moved there): Load keeps it as
  `waiting` (areas/load.ts), and it is sent from the next start, one at a
  time per phone, when there is signal (`sendNext`); a location opened
  with no build gets one then (`startAskChecks`). The Worker's word comes
  back every few minutes (`ahead`, `minutes`, `progress`); done, the
  pack's area file is fetched (`/areas/<pack>/area.json`) and kept, and
  the location the app is in says "<name> is built · Open" (a toast with
  a button, ui/Toast.tsx); Open reloads it onto the pack, never by
  itself. A build turned away for now (busy, or a Worker that still wants
  an email) waits and goes again; Remove or Move cancels it
  (`dropBuild`).
- `ui/sheets/LocationsSheet.tsx`: a location's row says "next in line ·
  about 20 min", "building · 40%" with a bar, "Built · SD"; with no
  machine in, "our machines are off for now". In Explore a box still
  building is dashed (explore/boxLayer.ts).
- `explore/BoxCard.tsx`: one Load. Where there are no SD tiles the card
  says Load builds the ground wind too, with "Email me when it's ready
  (optional)".

**The Worker** (site/):

- `POST /api/request`: an SD build needs no email when the phone sends
  its install (HD still does). A done pack whose core holds the whole box
  serves it at once (`coveringPack`: same grade first, then the
  smallest; an HD pack serves SD). A build of the same box still in line
  or baking is joined, not repeated (`joined`). Cancel by the email or by
  the install.
- `GET /api/request?id=`: `ahead`, `progress`, and `minutes` (the median
  of the last builds of that kind; null with no machine in the last 10
  minutes, left out before the `runners` table).
- `bake.js`: each `/api/bake/next` notes the machine (`runners`); a step
  carries `progress`; resumed bakes get their `area_id` back; the ready
  email links the location (`?area=<box>&p=<pack>`, mail.js
  `requestLink`); `/areas/index.json` names no pack.
- `mail.js`: from hello@groundwind.app; the asker only when they gave an
  address; Gavan's note says when a pack served an ask.
- `migrations/2026-10-24-packs.sql`: `runners` and `requests.progress`.
  The Worker works before and after it.

**The agent** (pipeline/agent.py, in 7f04a42): new requests bake as
`pack_id` (`sd-` and ten characters of an HMAC of the request number
under the bake key); a request begun before keeps its old id. Each step
posts `progress`, weighted by #10's measured step times (`STEP_S`). It
takes effect when the scheduled task restarts.

**Tested** (scratchpad scripts, a local `wrangler dev` with its own D1,
the app's quiet dev server with R2 passed through on the same origin):
27 Worker checks (asks with and without email, in line, claim, progress,
done, the area file by id, the empty index, 20 min once a machine is in
and a bake is done, none with the machine away, reuse, join, cancel by
install), the Worker on the database as it is today (no `progress`, no
`runners`), and in the app: a waiting build served by `area-r10`, kept,
"Test Lake is built · Open", reopened on the pack (`micro-area-r10.hab`
read from R2), Locations "Built · SD"; a Load over ground with no pack
sent from the next start and "next in line"; a location from before
builds gets one when opened; a fresh phone lists the five demos alone, a
phone that has been in Searchmont keeps it, a Duhamel link opens and
keeps it. `tsc -b` clean.

**To go live** (Gavan, from `site/`):

1. `npx wrangler d1 execute groundwind --remote --file migrations/2026-10-24-packs.sql`
2. `npx wrangler deploy` (it carries d7fd0ee's requests-page levers too).
3. Check Email Routing sends hello@groundwind.app to your inbox, or a
   reply to the emails bounces.
4. Restart the "Groundwind bake agent" task between bakes, for pack ids
   and progress.
5. Promote the app to `live` when hunt-dev reads right.

**Not done in step 1:** the site status page (`/l/<token>`, step 3); the
SD build cut (step 2, so builds still take an hour or so); a joined
ask's email is not kept, so only the first asker is written to.
