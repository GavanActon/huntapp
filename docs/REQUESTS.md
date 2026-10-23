# Requests, accounts and the bake queue

Status: plan, 2026-10-13. Nothing built except what [SD-HD-PLAN.md](SD-HD-PLAN.md)
records as built (the request table, the Worker's claim endpoints,
`pipeline/agent.py`). This doc replaces that plan's single agent with any
number of runners, and adds accounts and email. The SD bake itself is
[SD-FAST.md](SD-FAST.md).

## Decided (Gavan, 2026-10-13)

| Question | Answer |
| --- | --- |
| Who opens an SD area | The owner, and anyone with the link |
| Sign-in | An email link, Google and Apple, all from the start |
| Email | Cloudflare's own email sending, from the Worker |
| Who bakes | Many machines, the cloud later: nothing tied to one PC |

## The flow

1. **Ask.** In the app (the box you draw) or on the site: the box, SD or
   HD, and the account. Someone not signed in gives an email address, which
   becomes their account.
2. **Queue.** The Worker writes the request and its jobs, and emails "we
   have it".
3. **Bake.** Any runner that can do a job claims it (see Runners).
   - An SD request has two jobs:
     - `sd-wind`, the fast one: the wind file only, in about 1–2 minutes;
     - `sd-full`, which follows: heat, routes, bush, stands, places, and
       the wind file again on the better stands.
4. **Ready.** When `sd-wind` is done, the area is registered and the
   account gets "your ground wind is ready" with the link. `sd-full` lands
   later without an email; the app picks it up on its next open.
5. **Open.** The link opens the app there. The app fetches the area's file
   from the registry (it no longer has to be built into the app), streams
   the pictures, reads the grids from R2, and lists the area under the
   account's areas.

**The doors (2026-10-23).** The site's form no longer sends a request: "Where do you
hunt?" turns coordinates or a place name (NRCan's geographical names, the service
the app's Where to searches) into a link into the app, `#at=lat,lon&ask=sd|hd`
(`app/src/share/link.ts askLink`; a QR code on a computer). The app lands with
the box round the point (`areas/arrive.ts askHere`): Load where the SD tiles
are; where none are baked yet (the rest of Canada, the US) the load card asks
for the ground wind, an SD request with the box and an email, which the runners
bake (`agent.py`, kinds=sd); `ask=hd` opens the HD card. From a loaded SD spot
the path to HD is the HD button on its Locations row, the grade sheet's Get HD,
or Get HD here from a tap on the ground. So every request now has a box and a
kind; the stage-NULL rows (#15, #16) were the last of the text form's.

**Watching them come in:** groundwind.app/requests (site/requests.html), behind
the stats key. It lists every request newest first, with a map of the boxes,
counts by stage, a "new since you last looked" banner and a desktop notice
for a new one, a finished bake, a failure or one waiting for review. Tap a
request for its email, ground, bake progress and traceback. The page reads
`GET /api/requests` (worker.js) and checks again every 30 s while it is on
screen.

## Access

- **SD: the link is the key.** A requested area gets an id that can't be
  guessed (`sd-` and ten random characters), so the link is the access,
  and the files on R2 are no easier to find than the link.
- **The public index lists only the demo areas.** An account's own areas
  come from `/api/me/areas`.
- **HD (later):** its files are served through the Worker, which checks the
  account's unlock.

## Locks: SD against HD

Gavan, 2026-10-13: "One thing that needs to be there is better locks for
content that's SD vs HD." A lock has three parts: the server keeps HD's
files to those who unlocked them, the app shows what is locked and why,
and one table says which is which.

**Which is which.** Each layer and feature says its tier, in one place in
the app (`tiers.ts`):

| Free (SD, and Live) | HD |
| --- | --- |
| Streamed relief, shade and contours; topo; imagery | 1 m LiDAR shade and contours |
| The net's ground wind (30 m) | WindNinja's wind (and the teacher's later) |
| Heat map and stands; the bush model's thickness from satellite | The point cloud's bush and shooting lanes; sight lines |
| Routes on the 30 m going grid | Routes on the 10 m LiDAR grid |
| Scent, checks, the hunting tools | Saving the full pack offline |

**The server lock.** HD files move from the public `data/` on R2 to a
private prefix, served only through the Worker (`/api/data/<area>/<file>`,
range requests passed through for the archives). The Worker checks the
account's unlock or a party's share before it answers. A phone that saved
an area keeps it after a pass lapses: the lock is on the download, not on
using what was saved (the keep-the-bake rule, 2026-10-09).

**Offline.** `/api/me` gives the phone a signed list of its unlocks with an
expiry, so the app can show the right locks with no signal.

**In the app.** A locked layer or button keeps its place and shows a lock.
A tap says what HD adds here, with a sample:

- "Shooting lanes come with HD here", with a patch of the real thing;
- the wind card's "SD wind", or "HD would sharpen this spot a lot / a little"
  from the net's own spread;
- "HD isn't possible here" where no LiDAR exists, so nobody pays for
  nothing.

The demo areas stay fully open as the shop window.

**Data.** `unlocks` (account, area, tier, until, how: card, by hand,
party) beside the tables below.

## Runners

A runner is `pipeline/agent.py` on any machine that has the bake setup:
XEVO now, xonix next, and a container image for a cloud box later. All of
them talk only to the Worker and R2, so adding a machine is installing the
runner and giving it a key.

- **Keys:** each runner has its own (`runners` table, stored hashed),
  replacing the one shared `BAKE_KEY`. A runner can be switched off
  without touching the others.
- **Claim:** `POST /api/jobs/claim` with the runner's capabilities (`gpu`,
  `cpu`, `fri-on` for the cached Ontario inventory, `lidar`). It gets the
  oldest queued job it can do, or nothing.
- **Lease:** a claim holds a job for 10 minutes. The runner extends the
  lease each time it reports a step. A machine that dies lets the lease
  run out, and the job goes back to the queue (three tries, then failed).
- **Safe to repeat:** a re-run job writes the same R2 keys and registers
  the same area. Nothing breaks when two runs overlap.
- **Splitting work:** jobs name what they need, so a GPU box can take the
  wind while a CPU box takes the full pass.

## Email (Cloudflare Email Service)

- **Sending:** from `noreply@groundwind.app` through the Worker's email
  binding. Three messages: "we have your request", "your area is ready"
  and the sign-in link.
- **Catch:** sending to any address needs the Workers Paid plan ($5 a
  month). The service is in public beta (April 2026).

## Sign-in

- **Email link:** `POST /api/auth/email` sends a link that is good for 15
  minutes. The app trades it for a long-lived session kept on the phone.
- **Google:** OpenID Connect through a Google Cloud OAuth client (free).
- **Apple:** Sign in with Apple through a Services ID and a private key,
  which needs the Apple Developer Program ($99 a year; the App Store needs
  it anyway).
- **One account per verified email.** Google and Apple join the email
  account with the same address. Apple's private relay address makes an
  account of its own, which can be linked later.
- **Requests carry the session.** An area's owner is the account that
  asked.

## Data (D1)

| Table | Holds |
| --- | --- |
| accounts | id, email, created_at |
| identities | account, provider (email, google, apple), the provider's subject id |
| sessions | a hashed token, account, install, created, last seen |
| login_links | a hashed token, email, created, used |
| requests | + account |
| jobs | request, kind (`sd-wind`, `sd-full`, HD later), needs, stage, runner, lease_until, attempts, step, error |
| runners | name, hashed key, capabilities, last seen |
| areas | + owner account, visibility (link, demo) |
| account_areas | account, area, role (owner, saved) |

## Order

| | Piece | Who | Effort |
| --- | --- | --- | --- |
| 1 | The fast SD bake (`sd-wind`: national rasters to the wind file) | me | 1–2 days |
| 2 | The app opens areas it wasn't built with; pictures stream where an area has none baked | me | 1–2 days |
| 3 | Jobs, leases and per-runner keys (Worker + `agent.py`) | me; live Worker deploys and D1 migrations: Gavan | 2 days |
| 4 | Email through Cloudflare | me; Workers Paid and Email Service on: Gavan | half a day |
| 5 | Email-link accounts, the account's areas, link access | me | 2–3 days |
| 6 | Google and Apple sign-in | me; the Google OAuth client and the Apple Services ID and key: Gavan | 1–2 days |

About two weeks of sessions. The order puts something usable at the end
of each step: after 1–2, a request baked by hand opens on the dev site
from a link; after 3–4, the queue runs itself and emails.

## Gavan's part

- **Cloudflare:** Workers Paid if not already on it; turn on Email Service
  for groundwind.app.
- **Google Cloud:** an OAuth client (web) with the redirect
  `https://groundwind.app/api/auth/google/callback`. Steps to follow when
  step 6 starts.
- **Apple Developer Program:** a Services ID, a key and a domain check file
  on groundwind.app. Steps to follow.
- **Live deploys:** I can't deploy the live Worker or migrate the live
  database (the safety check calls both production changes). Run them
  yourself, or add a permission rule that lets me run `npx wrangler
  deploy` and `wrangler d1 execute --remote` in `site/`.
