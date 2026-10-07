# Party: hunting together

A party is a few phones that share what they know while they hunt. Each phone
draws everyone's: where each member is, their wind checks, what they heard or
saw, and their scent. Built 2026-10-06 as phase 1 (sharing with signal).
Phases 2 and 3 are below.

## What a member sees

- **Dots on the map.** Each member with a position is a dot in their colour
  with their initials, and how long ago the position was placed under it
  ("now", "12m", "3h"). A dot fades as it ages and becomes a ring after two
  hours. A dot is where a phone last said, never where someone surely is:
  never use it to clear a shot.
- **Their scent in yours.** Whenever the scent card is in use (your cone on,
  or anyone placed), members placed in the last two hours sit in it too,
  labelled by initials, at the height they chose on their phone. The card's
  lines name them: "GA's scent drifts over you". Tap a member's dot, then
  **Their scent**, to start the card from them.
- **Their wind checks** are taken in (marked `taken`, with `by` and
  `member`) and sharpen your ground wind exactly as your own do: the model
  blends every check nearby, and says when people disagree. A partner's check
  never supersedes yours, and never goes up with yours to the shared checks
  (checkShare.ts sends only your own).
- **Their sounds and sightings** land in your hunt log with their initials,
  and pull the heat map like your own.

## Joining

- **Start a party** (⋯ › Party). Your initials are what the others see, so
  the sheet asks for them first.
- **The invite** is a QR code on the sheet (scan it with the camera at camp),
  **Share invite** (a link), or **Copy code** (`GW-PARTY <id>.<key>`).
- **A link** opens the app with the Party sheet asking to Join. The code rides
  in the link's fragment, which no server sees, and the app takes it out of
  the address bar.
- **iPhone with the app on the home screen:** a link opens in Safari, which
  keeps its own storage. The sheet there offers **Copy the code**; in the home
  screen app, ⋯ › Party, paste.
- **Leave** sends a goodbye; the others drop you from their list. Their checks
  and sightings stay in your log.
- One party at a time. Joining another leaves the first.

## What goes, and how

```
phone (app/src/party/party.ts)
  ├─ outbox (localStorage): hello, pos, check, log, del, bye
  │    └─ sealed (seal.ts: AES-GCM, the party's key, iv per item,
  │       party|member|seq as associated data)
  │         └─ POST /api/party   → Worker (site/party.js) → D1 party_items
  └─ GET /api/party?p=&after=   ← the mailbox from where this phone left off
```

- **The key never leaves the phones.** The invite carries it; the Worker
  stores a random party id, a random member id per phone, a counter and the
  sealed bytes. Sealing binds each item to its sender and counter, so the
  Worker cannot pass one member's item off as another's.
- **Positions** go on their own while in a party: when the phone gets a fix
  (the locate button on) and has moved 25 m or 3 minutes have passed, at most
  every 20 s, and on each look at the phone. A web app has no position in a
  pocket, so a dot is as fresh as its owner's last look. A position carries
  the height from your scent card, the fix's accuracy and whether you were
  walking.
- **Share my position** off sends a "position off" that takes your dot off
  the others' maps.
- **Slots.** `pos` and `hello` keep only a member's newest on the Worker, so a
  phone joining late reads where everyone is now, not every fix of the trip.
- **Your checks and log entries** go as they are made and again when they
  change (a puff folding in), by a fingerprint per item; on joining, the last
  day's go too. One you remove is removed from the others' (`del`).
- **No signal:** the outbox waits and goes when there is signal, at the next
  look or when the phone comes back online.
- **Reading:** every 20 s while the app is in front, on each look, and when
  signal comes back. Items from yourself are skipped.
- **Lifetime:** items older than 14 days are deleted on the Worker, and a
  phone says hello again every 12 hours while in the party.

## Privacy

Exact positions are the point of a party, so they are shared only with the
party, and only sealed. Groundwind's Worker never holds the key. Anyone with
the invite can join, which is why the sheet says to send it to the party only.
Leaving stops everything; Share my position off hides your dot. Nothing of a
party goes into the usage stats, apart from `party` events (start, join,
leave) with no ids.

## Limits

- Positions only while the app is looked at, until the native app
  (Capacitor, background location) exists.
- One party per phone; up to about 8 people is what it is designed for (no
  hard cap yet).
- Clocks: a position's age uses the sender's clock.
- The Worker's rate limit (30 posts a minute per address, shared with the
  stats) is per address, and a camp on Starlink shares one.

## Next

- **Phase 2, no signal.** Phone to phone by QR at camp (everything a phone
  holds, as a few codes), and a **Text the party** button: your position and
  latest check in about 50 characters (a readable line and a code, like the
  satellite forecast's GW1), sent by iPhone satellite messaging or copied into
  an inReach, and pasted in by the others. Every item keeps (member, seq), so
  one arriving by text and later by the Worker is taken once.
- **Phase 3.** Crossed bearings: a bull heard by two members, from two places,
  placed where the bearings cross. Shared setups (who sits where for the
  evening). Alerts ("GA's scent now reaches MT's stand"). Game down / a hand
  needed, with the spot.
- **HD for the party.** One member buys HD for an area and everyone in the
  party gets it for the season: a signed unlock (party, area, until) each phone
  checks offline, picked up when joining with signal. Waits on payments.

## Files

- app/src/party/party.ts: the store, the outbox, the mailbox, positions,
  taking items in, the scent sync.
- app/src/party/partyCode.ts: ids, keys, the invite link and code, colours.
- app/src/party/seal.ts: AES-GCM.
- app/src/party/partyLayer.ts: the dots (markers, over the scent's cloud) and a member's popup.
- app/src/ui/sheets/PartySheet.tsx, ui/party.css: the sheet.
- site/party.js, site/schema.sql (party_items): the mailbox.
- Touched: weather/micro/scent.ts (party sitters: `party`, `who`,
  `setParty`, `sitterName`), ui/ScentCard.tsx, weather/micro/windChecks.ts
  and log/huntLog.ts (`takeIn`, `member`, `taken`, `by`), hunting/moveLayer.ts
  (a sound this version does not know reads as heard), ui/sheets/HuntLogSheet.tsx
  (initials on a member's rows), AppMenu.tsx (⋯ › Party).
