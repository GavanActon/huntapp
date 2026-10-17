# The check as an instrument

Status: design for discussion, 2026-10-17 (huntapp-jay, on Gavan's "design the right approach for this and
we can discuss tomorrow"). Nothing built. It covers the wind check, the treetop check and the **Winded**
hot button (Gavan: "could teach us lots").

## Why

The field score has not moved in a week: on the 67 scored checks every method sits at 38–48% within 45°
(forecast 38, app 42–48, classifier 42–45; docs/INVERSE.md). Two things cause it, and neither is a model:

- **One puff is a 63° instrument.** Two readings five minutes apart at the same spot agree within 45° only
  half the time (INVERSE.md). PALM's head-height wind in a stand meanders 40–60° on a one-to-two-minute
  scale (gustSpreadHead), and 40–70% of head-height cells are nearly still at any moment; a single puff
  samples one gust. The rule differences the loop is chasing are 10–20°. The instrument is noisier than the
  thing it measures.
- **The forecast's own error is invisible to the model.** At Pickle the felt wind was a median 75° off
  HRDPS. The app can only learn that from a check that sees the air above the trees, and today no check
  kind does.

So the check needs to (1) average the meander, (2) separate the floor from the air above, and (3) record
what it saw well enough that the checks card, the replay and the place memory can use it. The scent side
has no field truth at all today except two logged nights; **Winded** gives it one.

## What a check is today

One tap → `dirFrom`, `strength`, `puffs` (an array of bearings), `dirs`, plus the forecast and the model's
call at that moment, in the check's `data` JSON (D1 `checks`, shared through the Worker). The GPX hunt log
of 2026-09/10 rounds speed to whole km/h. The puffs array exists, but the UI makes one puff the norm.

## The design

### 1. The floor check: three puffs, timed

- The hot button opens one screen: a compass dial turned to the phone's heading. The hunter lets a puff go
  and taps where it went. The app asks for the next one after ~10 s, three times (a fourth and fifth if the
  three disagree by more than 60°). Long-press on the dial = **calm** (nothing moved).
- Saved per check: each puff's bearing and time, the heading source (compass or GPS track), the observation
  length, the **mean bearing** and the **spread** (circular sd of the puffs), and a strength band.
- Strength is a band, never a number: `calm / drifts / light / breezy / strong` (under 1, 1–3, 3–7, 7–15,
  15+ km/h as a guide, shown as what you feel, not what to measure). Field checks are direction, not
  strength (memory `field-checks-direction-not-strength`); the band is for the still-share and the towers'
  floor, not for scoring speed.
- Time: about 30 s with gloves on. Three taps.

What it buys: the mean of three puffs has about 63/√3 ≈ 36° of noise, five about 28°. The spread is data in
its own right: a tight spread in a stand says the floor is coupled; a wide one says it is wandering
(the near-calm wander Gavan logged, "drifts toward S, W, SE, E"), which is exactly what the shade should show.

### 2. The treetop check: what the air above is doing

- A second chip on the same screen: **Tops**. One tap on the dial for the direction the canopy tops or the
  clouds' lower edge are moving, plus `still / moving / strong`. Also from an opening: the lake's ripples.
- Saved as its own kind (`tops`), scored against the 10 m / forecast wind, never against the floor.

What it buys: this is the only field observation of the ambient. It pins the forecast's error for the next
hours (the fast state of the inverse), separates a floor miss from a forecast miss (WIND-LEARNING step 1,
"when ambient-seeing checks agree with the forecast, a floor miss is a lesson about the place"), and it is
the observation the Searchmont dusk (floor backwards, tops with the forecast) needed. Gavan already makes
these ("seen leaves 500 m SE"); they just have nowhere to go.

### 3. Winded: the scent truth

- A hot button beside Heard / Move: **Winded**. One screen: the dial for the animal's bearing (where it was
  when it reacted), a distance band (`under 50 / 50–150 / 150–400 / over 400 m`), what happened
  (`winded and gone / winded, hung up / came in downwind, no reaction / not sure`), species, and whether
  the hunter was sitting or moving. Saved with the model's cone, the forced air and the last check at that
  moment, like a wind check.
- **The negative case matters as much**: "came in from downwind and did not react" is a scent miss the cone
  can be scored against (the cone said scent there, the animal said no). The hunt log's two winded nights
  taught more than any run; a season of these is the scent card from the field.
- Later, a `Seen` variant for a sighting with no reaction (a sit's hit list), but Winded first.

### 4. Where it goes

- **No schema change.** All of it fits in the check's `data` JSON (`kind: floor | tops | calm | winded`,
  `puffs[]`, `puffTimes[]`, `spread`, `obsSeconds`, `band`, `animal {bearing, distBand, reaction, species}`).
  The Worker passes JSON through, so nothing touches D1 under the freeze; hunt-dev first.
- **The checks card** scores a floor check by its mean bearing, weighted by 1/spread; checks with one puff
  keep scoring as today so history compares. Honest-spread coverage uses the puff spread as the observation's
  own error. `tops` checks get their own line against the forecast (the forecast-error table by station
  class, WIND-LEARNING). Winded events get a scent line: the cone's band at the animal's bearing and distance
  (hit / shade / miss / false alarm), the same marks as the PALM card, so the two cards read alike.
- **The learning loop:** a `tops` check updates the ambient (direction and a speed band) for the next hours;
  a floor check becomes the place lesson it is today, but with its spread as its weight. The classifier's
  "check again" fires when the puffs disagree, not on a timer.
- **Step 0 stays:** get Gavan's ~500 unshared checks off the other install (a "send all" with counts in
  Settings, WIND-LEARNING "Order and size"). They are the only pre-season baseline.

### 5. How we'd know it worked

- The same-spot repeat test: two three-puff checks five minutes apart agree within 45° more than 50% of the
  time (the one-puff number today). Target 75%.
- The checks card within 45° moves off 43% at Pickle with the new checks only, scored leave-one-out.
- Honest spread stays in the 60–80% band with the puff spread as the error.
- Winded: ten events by the end of the season, each scored.

## Cost and who

About two days of app work (the check screen, the three kinds, Winded, the card lines), no compute. ba or
a UI session builds; I score it on the checks card and the replay before it goes to hunt-dev. The freeze
keeps it off live until Gavan lifts it.

## Open for Gavan

- Three puffs or five? (Three with a fourth on disagreement is the suggestion.)
- Is `tops` a chip on the same screen or its own hot button?
- The strength bands' words.
- Winded's reaction choices, and whether a sighting with no reaction is in the first cut.
- Sharing: Winded events shared like checks by default, or private?
