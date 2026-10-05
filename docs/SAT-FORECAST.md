# Weather by satellite: the newest forecast with no signal

With no cell signal, the forecast on the phone ages: HRDPS runs every six
hours, and at a camp with signal only morning and night, or on a trip with
none at all, the ground wind, the scent cone and the heat keep working from
an old run. Weather by satellite gets the newest run in one text message,
sent from an iPhone on satellite or an inReach, and answered by the
Groundwind number.

Built 2026-10-05. The app side and the bot are done and tested against
live HRDPS. The Groundwind number is +1 867 988 4457 (Twilio, in the app
as `SAT_NUMBER`); the webhook, the auth token secret and a deploy are
what is left before it works for real. See [Going live](#going-live).

## Using it

- **Open**: ⋯ → **Weather by satellite**, always there (it took Go to
  coordinates' place, 2026-10-05). With signal the sheet says so and offers
  Refresh, the steps still under it. The weather detail's "a newer HD
  forecast is in · fetches with signal" adds **or by satellite** when
  offline.
- **1 · Send this**: the app writes the request for the camp, for
  example `GW1 48.926 -85.599 48`: the camp's forecast point (3 decimals,
  about 100 m) and the hours wanted.
  - **Text it** (iPhone on satellite, or any phone with satellite
    texting): opens Messages with the number and the request filled in.
    Tap Send.
  - **Copy** (inReach): in Garmin Messenger, start a message to the
    number, paste, send. The request for an area never changes, so it can
    also be saved once as an inReach preset.
- **2 · Paste the answer**: the whole reply, as it came. Pasting is the
  update, with no button after it. The sheet says "Weather updated", the
  run and the hours under it, and how the wind at the coming dusk changed
  ("At dusk (7:13): NW 6, was NW 5"). A reply for a run the phone already
  has (fetched with signal) says "Weather updated" too and leaves the
  fetched numbers alone: they are a little finer than the text's.
- The request is remembered. Close the sheet and pocket the phone; when it
  opens again it says when you asked. An answer takes a few minutes. With
  Apple's satellite you stay connected for it. On an inReach, check for
  messages.
- What goes wrong says so: no code in the text, part of it missing or
  changed, or a reply for another area.

## What the reply holds

One text, at most 160 characters, letters, digits and a few marks only
(one character outside the texting alphabet would halve what a text
holds):

```
NW 11g40, calm by 9p GW1.cy3pKme2UAnxXGC4rvpIrfaR9gV2zZZuViQdA2xAgij…
```

The words are for a person reading it on the inReach's screen: the wind
now, its first big change in the next day, the first rain. The code after
`GW1.` is for the app ([satCodec.ts](../app/src/weather/satCodec.ts)):

| Part | What | Packed as |
|---|---|---|
| header | first hour (UTC), the run's age, the hours, an 8-bit hash of the camp | 41 bits |
| wind | the 10 m wind as an east/north vector at its turning points, straight lines between | 1 km/h steps, 1.5 km/h tolerance |
| blocks | every 6 h: gust factor, 80 m over 10 m wind (the shear), ensemble direction spread | 3 bits each, linear between blocks |
| air | 2 m temperature, 80 m − 2 m potential temperature, cloud, rain, each as turning points | 1 °C, 0.5 K, 12.5 %, 0.25 mm |
| check | a hash of the rest | 12 bits |

Steps and deltas are Rice-coded with the parameter picked per stream, and
the bits written in base 62. The bot sends as many hours as fit, 48 at
most (HRDPS's horizon), dropping six at a time.

Measured on twelve days of camp HRDPS (2026-09-25 to 10-06): every 48 h
fits, the wind comes back 2.3° and 0.4 km/h off on average (19° at worst,
at 5 km/h, where direction matters least), temperature 0.4 °C. The
forecast's own error is several times that. Sending only the change from
the phone's older copy was tried and is no smaller: the change is choppier
than the forecast, so it needs as many turning points.

## Where the hours go

[satForecast.ts](../app/src/weather/satForecast.ts) puts them where a
fetch would have, so the ground model, the scent cone and the heat read
them as HRDPS hours:

- **The camp's forecast**, marked as satellite hours (`sat` on the cached
  forecast: when, the run, which hours). The weather detail says "by
  satellite 20 min ago". Days the hours touch get their highs, lows, wind
  and rain again from the hours. Rain chance is left empty (HRDPS has
  none) and pressure keeps what it had.
- **Every saved place in the area** that has a forecast, at its own spot
  in the turned wind field.
- **The wind field** ([windGrid.ts](../app/src/weather/windGrid.ts)): a
  text carries the camp's wind alone, so each hour of the 5×5 field is
  turned and scaled to it, each cell keeping its own turn and strength
  against the camp (the lakes' lee stays). An hour past the field's end
  borrows the pattern of the field's hour whose camp wind blew most nearly
  the same way.
- **The air's layering** ([boundaryLayer.ts](../app/src/weather/boundaryLayer.ts)):
  temperatures, winds, cloud and the ensemble spread. Sunshine is worked
  out from the sun's height and the cloud, as the estimate does.

Each copy keeps its `fetchedAt`, so the first signal still brings a full
fetch and replaces it all.

Also fixed on the way: past the wind field's last hour the ground model
used to hold that hour, so after about three days without signal its
wind froze. It now falls back to the camp's forecast there
(`windGridCovers`). The map's streaks still hold the last hour.

## The bot

[site/satbot.js](../site/satbot.js), on the groundwind.app Worker:

- `POST /api/sms`: Twilio's webhook for the Groundwind number. It reads
  the request out of whatever came with it (an inReach adds its sender's
  name and a link), fetches HRDPS at the point (the same variables the
  app asks for), the GEPS ensemble's spread and the run time from
  Open-Meteo's metadata, and answers with TwiML. Only requests signed with
  the account's auth token are answered. A text that is not a request
  gets a line of help.
- `GET /api/wx?q=GW1 48.926 -85.599 48`: the same answer as plain text,
  for trying a request with signal.

It keeps nothing. The camp's position is in the request, so there are no
accounts and no sign-up.

## Going live

1. A Twilio account, upgraded (a trial adds its own words to every reply
   and that breaks the 160), and a Canadian number that can send and
   receive texts.
2. The number's "A message comes in" webhook: `https://groundwind.app/api/sms`, POST.
3. The auth token as a secret: `cd site && npx wrangler secret put TWILIO_AUTH_TOKEN`.
4. Deploy the site (`npx wrangler deploy` in `site/`).
5. The number in the app: `SAT_NUMBER` in
   [config.ts](../app/src/config.ts), E.164 (`+1807…`). The sheet then
   shows **Text it** and the number.
6. Check with the real devices: text the request from the iPhone on
   satellite and from the inReach, and paste each reply.

Each forecast is two messages on an inReach plan, one out and one back.

## Checking it

- `node scripts/check-sat.mts` (in `app/`): the request read from a
  message full of other words; replies that fit one text and read back
  within their steps; a wind turning through north, calm, one hour, no
  ensemble; a reply cut short, changed, missing or from a newer format.
- 2026-10-05, from a phone with signal: the text reached the bot through
  Twilio, the answer came back in half a second, and the reply (149
  characters, HRDPS 12Z, 43 h) arrived whole and decodes. The first try
  failed on the signature: the token on the server was not the live one.
  The check now also takes the address with the port, as Twilio's own
  libraries do, and logs the token's length when it fails.
- Not yet checked from an inReach or an iPhone on satellite. Things to watch:
  - whether the reply from a Twilio number reaches the inReach
  - whether a carrier's satellite texting sends to an ordinary number
  - how Garmin Messenger shows a 160-character reply, and whether it copies whole

## Not done

- One-tap loading in the native app: a link in the reply opening the app
  (Universal Links, App Links), and on Android reading Garmin Messenger's
  notification so the forecast loads with the phone in a pocket.
- A limit on texts per number. Every reply costs a Twilio message.
- The site's own page for a request, for someone without the app.
