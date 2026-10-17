# Headless harness

Playwright (python 3.14, sync API) drives the dev app in headless Chromium on SwiftShader: a 430x860 mobile touch context with geolocation at the camp, as in `../shot.py` and `../profile.py`. Run from `app/`: `py -3.14 scripts/headless/<script>.py ...` (the scripts find their own folder). Windows only for the browser-count line in the results.

| script | what it does |
| --- | --- |
| `scenarios.py` | 15 fresh-open scenarios (cold open, menus, sheets, popups, heat, Dig in, scent, ruler, routes, view pill, offline). Shots, console, and the page's words in `out/<name>/results.json` |
| `compare.py` | two runs at the text level (which sheet/popup/card is up and its words, button states, failures, console kinds); or one run compactly |
| `targeted.py` | `L1` heat on/off/on, Dig in, hunt-log pull, heat races; `L2` armed buttons, ruler over a route, route card, Sharpen the wind, grade sheet; `L3` heat tapped at once after load |
| `tracks.py` | `A` old tracks value migrates, `B` a 25-step walk and its writes, `C` reopen / rename / delete |
| `clock.py` | holds the page's clock and reads the three things that move with the hour: the Camp sheet, Settings' forecast run, Dig in |
| `scoredump.py`, `scorecompare.py` | an exact dump of the Spots scorer, taken before and after a scoring change, and a bit-for-bit diff of the two |
| `omcache.py` | the Open-Meteo capture and replay (below) |
| `readiness.py` | the waits (map + strip hours + first scoring pass, heat, sheets), a console recorder, the clock hold. A library |

## Dev server

Start your own, never use somebody else's (their edits and hot reloads land in your run). Pick a free port (`Get-NetTCPConnection -State Listen` shows the taken ones), from `app/`:

    npx vite --port 5199 --strictPort

Pass it as `--url http://localhost:5199/` (or `BASE=`). There is no default on purpose. Stop it when you are done. One run at a time: two headless sessions at once slow each other and the timings stop meaning anything (`otherHeadless` in the results says if there were others).

## Open-Meteo: capture once, replay always, mind the daily limit

A cold open asks Open-Meteo for about twenty things (two of them 25-point wind grids). A day of test loads from one IP, yours and any other session's, spends the free daily limit; after that every request answers 429 "Daily API request limit exceeded" and the app sits on "Fetching the outlook...": no strip hours, no wind, no heat, no Dig in score, a run that compares nothing. A probe can still say 200 while the app is being refused.

So the test loads never reach the real API. `omcache.py` answers the app's Open-Meteo requests from a capture (nothing goes live; a request with no recording gets another point's answer, else it is aborted and counted). `omcache/` holds one: 17 answers, about 260 KB, taken 2026-10-17 03:54. It is a week-long forecast from that day, so later than about a week hold the clock at the capture (`--clock auto`) or capture again:

    py -3.14 scripts/headless/omcache.py probe                                   one live call: is the limit spent?
    py -3.14 scripts/headless/omcache.py capture --url http://localhost:5199/    on a day it is not (one page load with the requests aborted, then the 20-odd calls paced 4 s apart; --refresh to redo)
    py -3.14 scripts/headless/omcache.py urls                                    what the capture holds

Do not capture between a `scoredump` before and its after. `--live` (scenarios, targeted, tracks, clock) sends the requests to the real API instead: read `omcache.py`'s top first. The data is Open-Meteo.com's (CC BY 4.0).

## Baseline, after-run, compare

    py -3.14 scripts/headless/scenarios.py --url http://localhost:5199/ --name baseline     (about ten minutes; or name scenarios: cold-open settings)
    ... change the code ...
    py -3.14 scripts/headless/scenarios.py --url http://localhost:5199/ --name after
    py -3.14 scripts/headless/compare.py scripts/headless/out/baseline scripts/headless/out/after

Take the baseline from the unedited tree. The compare prints each difference and `N difference(s)`, and exits 1 if there are any. A scenario that shows `pageLoads` above 1 or `src changed during the run` had another session's edit hot-reload under it: run it again. `targeted.py` and `tracks.py` take the same options and write their numbers to `out/<name>/L1.json`, `TR-B-walk.json` and so on. `compare.py out/after` alone prints a run compactly.

## Scorer dump, before and after a scoring change

    py -3.14 scripts/headless/scoredump.py pin    --url http://localhost:5199/     optional, from the unedited tree: keeps the old src/spots/*.ts for the before dump (pin again for each change)
    py -3.14 scripts/headless/scoredump.py before --url http://localhost:5199/     (--areas pickle-lake alone: a minute on a quiet machine, five when busy; all three areas, three to four times that)
    ... edit app/src/spots/*.ts ...
    py -3.14 scripts/headless/scoredump.py after  --url http://localhost:5199/
    py -3.14 scripts/headless/scorecompare.py

`IDENTICAL` means every number bit for bit and every label; otherwise the first differences are listed with how many cells moved and by how much. Preconditions (same ground-wind state, same frozen conditions, nothing else changed under `app/src` or the data) are printed first. `scoredump.py control --pin` re-dumps the old code: `scorecompare.py --after-prefix control` must find nothing. Output is in `out/scoredump/` (`before.json` is about 36 MB).

## Hold the clock

The app's own words move with the hour (the Camp's wind line, Settings' forecast run, a Dig in score), so two runs hours apart differ with no code change. Hold the page's Date at the same time in both:

    py -3.14 scripts/headless/clock.py --url http://localhost:5199/ 04:02                       reads the three things at 04:02 on the capture's day
    py -3.14 scripts/headless/scenarios.py --url http://localhost:5199/ --clock 04:02 --name after

`HH:MM` is that time on the day of the capture, `auto` is the moment it was taken, or give an ISO time. Not for locate or tracks (the app drops a GPS fix older than 20 s by that clock).

## Notes

- `out/` is ignored. The selectors are listed at the top of `scenarios.py` with the date they were found; fix them there when the UI moves.
- Dev builds only: `window.__map`, `window.__gps`. The scorer dump follows the app's own module instances (Vite stamps hot-updated files with `?t=`).
