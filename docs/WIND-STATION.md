# Wind station: an ultrasonic logger on a stick

Status: 2026-10-08, spec only. Nothing bought, printed or written yet.
Set aside the same day: Gavan wants plug and play, no soldering, and this
build is hand-wired. Three ways were offered instead, his pick still open:
(1, recommended) Ecowitt GW3001 (WS90 + GW3000) with two WN31s and a
Voltaic V50; (2) METER ATMOS 22 + ZL6; (3) a plug-together ESP32 build
(XIAO ESP32-S3, Grove RS485), its parts not checked. Kept for the targets,
the sensor research and the field checks, which hold whichever is bought.
Gavan's call (2026-10-08): ultrasonic, not cups or a Kestrel, for the low
winds under the trees; all in one (wind, logger, battery); ultra portable;
built here on an ESP32 with a 3D-printed case. The thermal pair (air
temperature at 0.3 m and 2 m) is in v1 (Gavan, 2026-10-08).

Why: the puff checks are moments. The 60 GPX checks say the model calls the
head-height speed 3–4× too low, and a check cannot say how the air at a
stand moves over a whole evening. A station left at a stand for a week gives
the speed, the direction, the gusts and lulls and the dusk settle-down every
second, at the height the model answers for (2 m, MICRO-WIND.md). It replaces
the two Kestrels in SCALE-PLAN.md "Stations"; the camp reference stays an
Ecowitt WS90 + GW3000.

## What it must do

| | Target |
|---|---|
| Wind | Speed and direction at 2.0 m, 1 Hz, reading down to 0.25 m/s (about 1 km/h) |
| Temperature | Air temperature and humidity at 0.3 m and 2 m every 10 s, the two matched to 0.1 °C |
| Run time | 7 days logging every second at −10 °C, 14+ days in hunt-hours mode |
| Weight | Under 350 g for the stick with sensor, under 650 g with the pole |
| Size | Fits a pack's side pocket: about 40 mm across, 34 cm long with the sensor |
| Weather | Rain, frost, a night at −20 °C, a drop in a puddle |
| Set-up | Under 5 minutes, one person, no phone app needed (a phone browser helps) |
| Data | CSV on a microSD card, UTC times, wind direction FROM in degrees |
| Cost | About CA$550 a station in parts; about CA$1,000 for the first, with the charger, spare cells and supplies |

## The form: one stick, no loose cables

The sensor sits on top of a printed tube that holds the battery and the
electronics; the tube's bottom cap screws onto any pole. That is how
anemometers are mounted anyway (the Gill WindSonic stands on a 44 mm tube),
so the tube under the head does not spoil the reading, and it means there is
one thing to carry and one seal to open.

```
      ┌──────────┐        sensor head, 66 mm × 64 mm, 53 g
      └────┬─────┘
       ┌───┴───┐  ≡≡≡    top cap: both cables through one gland, potted, glued on
       │  GPS  │──≡≡≡    high shield on a 10 cm arm, about 1.9 m
       │ ESP32 │         patch faces up (the sensor is plastic, the signal passes)
       │  SD   │         electronics stack on a printed sled
       │ cell  │         two 21700 cells end to end
       │ cell  │
       │      ○│         M8 socket for the low sensor, on the fixed tube
       ├───────┤         service cap: threaded, face O-ring, vent, reed switch spot
       └───┬───┘         1/4"-20 brass insert (camera thread)
           │             pole to 1.8 m, guyed
           │
          ≡≡≡            low shield at 0.3 m, its cable taped up the pole
           │
```

Tube: about 40 mm across (36 mm inside), about 270 mm long. The inside width
is set by the GPS board: the PA1010D is 25.4 mm square and must lie flat with
its patch facing up, which needs a 36 mm circle. The stacked Feather boards
(22.8 × 20 mm, a 30 mm diagonal) fit easily. The length is two 76 mm
protected cells plus contacts (about 160 mm), the board stack (55 mm), the GPS
and both caps. With a smaller board and the 18 mm BN-180 GPS (below) it could
drop to about 30 mm across.

## The sensor

The pick for a first buy is the **BGT-CF1(H4)**. It is the only one found
that is tiny and draws little power.

| | BGT-CF1(H4) | Hongyuv HY-WDC2E | Calypso ULP STD 485 | Gill WindSonic (M) |
|---|---|---|---|---|
| Weight | 53 g | 280 g (ABS) | about 200 g (not confirmed) | 500 g (900 g in aluminium) |
| Size | 66 × 64 mm | 82 × 108 mm | about 70 mm | 142 × 163 mm |
| Power | 0.09 W, 5–12 V | 18 mA at 12 V (0.22 W), 3–30 V | under 0.25 mA at 1 Hz | 5.5 mA at 12 V (0.07 W), 5–30 V |
| Speed accuracy | ±4% | ±5% | ±0.1 m/s at 10 m/s | ±2% at 12 m/s |
| Threshold | **not stated**, 0.1 m/s resolution | 0.1 m/s (retailer's sheet; not in the 2018 manual) | **0.5 m/s** | 0.01 m/s |
| Cold | −40 °C | **−20 °C** operating (manual) | | −35 °C unheated |
| Output | RS485 Modbus or NMEA, IP65 (IP68 on order) | RS485 Modbus, RS232, SDI-12, IP65 | RS485 Modbus | RS485/RS232 ASCII, NMEA, up to 4 Hz |
| Price | about US$95 | about AU$700 at retail | about US$475 | about US$1,000 |

- Neither cheap sensor publishes how it behaves below 1 m/s, and no
  independent low-wind test of either was found. The one user report found
  says the HY-WDC2E "works exactly as it is written in the manual". So the walk test
  (Tests, below) decides, and the electronics, case and firmware are the same
  whichever sensor wins.
- The BGT is the light pick and the first buy. The HY-WDC2E is plan B: five
  times the weight, about twice the power (4–5 days at 1 Hz, about 9 in
  hunt-hours mode), but the starting speed it claims is the one we want.
  Its −20 °C rating is fine for October; check it again before any
  November sit.
- The BGT's sister, the H5 (56 g, 50 × 50 mm, IP67, 5–30 V, 15 mA at 12 V),
  is also an option; ask about it in the same message.
- The Calypso is out on its threshold, whatever its power draw.
- The Gill is the last resort, proven in low winds but ten times the weight
  and price. Campbell Scientific Canada sells it.
- How to read a sensor sheet: reject accuracy given as "%FS" (2% of a
  40 m/s full scale is ±0.8 m/s), reject a fixed "±0.5 m/s +" term, and reject
  a starting speed over 0.3 m/s. Two found this way and dropped:
  Renkeer RS-CFSFX (±(0.5 + 2%FS)) and SUCH-WS-CSM (±(0.5 + 0.02V), starts at 0.8 m/s).

Order the BGT with: RS485, Modbus RTU, IP68, a 0.3–0.5 m cable.

**Before paying, ask the seller** (send the same message to Hongyuv):
1. What is the starting wind speed?
2. Below it, does the sensor report real values, 0, or hold the last value?
   Can that cut-off be turned off over Modbus?
3. What is the zero offset in still air?
4. The output rate and the averaging window. Can it give 1 Hz with no
   averaging?
5. The warm-up time from power-on.
6. The Modbus register map, and whether it runs on 5 V.

A sensor that rounds anything under 0.5 m/s down to 0 is no use under the
canopy, however well it reads above that.

## Electronics

| Part | Pick | Why |
|---|---|---|
| Part | Pick | Why |
|---|---|---|
| Board | Adafruit ESP32-S3 Feather, 4 MB flash / 2 MB PSRAM (PID 5477) | MAX17048 battery gauge on board (0x36), two I²C controllers (`Wire`, `Wire1`), three UARTs, Arduino support |
| Logger | Adafruit Adalogger FeatherWing (PID 2922): microSD + PCF8523 clock (0x68), CR1220 backup cell | Stacks on the Feather with short headers; SD chip-select is GPIO10 on the S3 (`SD.begin(10)`); the GPS corrects the clock every day |
| Card | SanDisk High Endurance 32 GB, FAT32 | Made for constant small writes; rated −25 °C (an industrial card is −40 °C at four times the price) |
| RS485 | SparkFun SP3485 breakout (BOB-10124), 3.3 V | Speaks to the sensor on its own UART; direction pin on a GPIO |
| Sensor power | Pololu U1V11F5 5 V step-up (#2562), SHDN pin with true shutdown | Cuts the sensor's power in hunt-hours mode and at low battery, under 100 µA when off. Its SHDN is pulled up to the battery, so add a 4.7 kΩ pull-down and hold the pin low in deep sleep (`gpio_hold_en`), or the sensor stays on through a reset. For 9 V: the U3V70F9 (#2894). Not the U3V16F5: it has no enable pin. |
| GPS | Adafruit Mini GPS PA1010D (PID 4415), patch antenna on board, CR1220 backup | UART and I²C; read with TinyGPSPlus (it is MediaTek, not u-blox). Between fixes, put it in standby with the PMTK command. Measure its standby draw: over 0.5 mA, give it a load switch. |
| Wake | Moulded reed switch, normally open (Littelfuse 59050-1-S-00-0), a 10 mm N52 magnet on the lanyard | Turns it on without a hole in the case; rated −40 °C |
| Status | One LED behind a 0.6 mm thin spot in the tube wall | Shows the blink through the plastic, no window to seal |
| Case air | Adafruit BME280 (PID 2652, 0x77) | Logs damp and condensation in the case, the first sign of a leak |
| Cells | Two Fenix ARB-L21-5000 V2.0: protected 21700, 5,000 mAh, button top, **76 × 21.5 mm**, 72.5 g each, in parallel | 36 Wh, 145 g |

I²C on the main bus (SDA GPIO3, SCL GPIO4, shared with the STEMMA QT port,
whose power GPIO7 switches): the gauge 0x36, the clock 0x68, the high SHT45
0x44, the BME280 0x77, and the GPS 0x10 if it is read over I²C. They do not
clash. The low SHT45 goes on `Wire1` on two free pins. The GPS and the RS485
each take a UART.

The cells sit end to end on a printed sled, each with its own contacts
(Keystone 5209 leaf springs for the negatives, Keystone 228 snap-on buttons
for the positives), wired in parallel. Each cell has its own protection
circuit, so no separate board is needed. Charge both full before fitting
them so they meet at the same voltage, and carry a spare pair. Charge in an
XTAR VC4SL, which takes 76 mm cells (the Nitecore SC4 does not), and only above
0 °C: lithium cells must not be charged when frozen, though they discharge
fine to −20 °C with less capacity. The Feather's own charger is too slow for
10 Ah. Design the sled for 76 mm plus the springs' travel; a stock 21700
holder (Keystone 1121) is too short for protected cells.

Smaller build: a Seeed XIAO ESP32-S3 (21 × 18 mm) with a microSD breakout
and a DS3231 clock instead of the Feather stack. That fits a 28 mm tube but
means more wiring by hand.

### The thermal pair

Two Sensirion SHT45s, each in its own printed radiation shield. Use the
Adafruit breakout with the PTFE filter (PID 6174), which copes better with fog
and frost than the open one (5665), and buy both the same kind so their errors
match. Placement: one at about 1.9 m on a short arm off the stick, one at 0.3 m on the
pole.

What it is for: the difference between them is the stand's own inversion.
`dT = T_hi − T_lo`; above zero, the cold air is lying at the ground. The model judges the stable air from
HRDPS's 2 m against its 80 m at one point near camp (MICRO-WIND.md §1).
On a clear evening this shows the cold air pooling at the stand itself:
- when it starts;
- how strong it gets: 0.5–3 °C over 1.7 m is the expected range in a bog on
  a clear night;
- whether the wind slows and turns down the slope at the same moment.

That timing is what the thermal sit rule and the
drainage regime depend on, and the puff checks can only guess at it. The dry
adiabatic correction over 1.7 m is 0.017 K, so the raw difference is the
potential-temperature difference for this purpose.

- **Two buses.** Both breakouts answer at the same I²C address (0x44), so
  give each its own: the ESP32-S3 has two I²C controllers. The high one
  shares the Feather's bus (short lead). The low one gets the second bus on
  its own pins, run at 50 kHz on a twisted-pair cable with 2.2 kΩ pull-ups
  for the 1.7 m run.
- **Accuracy.** About ±0.1 °C typical from the datasheet, worse below 0 °C.
  The match between the two matters more than either's absolute value, so
  the offset between them is measured before every season (Tests).
- **Shields.** The two shields are the same: 5–6 stacked white ASA saucers,
  65 mm across, 10 mm apart, open at the sides, with the sensor in the middle
  of the stack. Use the same print for both, so their errors are alike and mostly
  cancel in `dT`. A passive shield in still air reads 1–2 °C warm in direct
  sun, so daytime readings in a sun fleck are suspect. The evening and night
  readings, the ones that matter, carry little of that error. Flag the
  minutes with a big jump of `T_hi` against `T_lo` as `sun`.
- **Fog and frost.** In saturated air (RH over 95%) the sensor can sit wet.
  Fire the SHT45's built-in heater for 1 s once an hour, and throw away the
  next minute of its readings.
- **The low cable.** The low sensor plugs into an M8 4-pin IP67 socket
  (NorComp 856-004-213R004, solder cups, −40 °C) on the tube's fixed wall,
  just above the service cap. Its lead is a 2 m moulded M8 male cable
  (Same Sky CDM815-04A-01MST-2M-67, 4 × 24 AWG) with the sensor soldered to
  the far end. The socket sits there so it unplugs for
  packing and the service cap still turns freely. Put a cap on the socket
  when it is unplugged. Tape the cable up the pole inside spiral wrap.
- About US$25 for the two breakouts, about US$10 for the M8 pair, about 75 g
  with the shields and cable.

## Power

| Load | Draw | Notes |
|---|---|---|
| Sensor | 0.10 W | 0.09 W through the boost at about 88% |
| ESP32-S3 | about 7 mW | Awake about 40 ms a second at 80 MHz, light sleep the rest, radios off |
| SD card idle | up to 3 mW | Depends on the card; measure it |
| RS485 | about 3 mW | Receiver on |
| GPS | under 1 mWh a day | 1–3 minutes on at boot and once a day |
| Thermal pair | under 0.1 mW | One 8 ms reading each every 10 s, plus the hourly heater pulse in fog |
| **Total** | **about 0.12 W, 2.9 Wh a day** | |

36 Wh × 85% (cut-off at 3.4 V) × 80% (cold) ≈ 24 Wh, so **about 8 days at
1 Hz**. If the sensor really draws 0.2 W, that drops to 4–5 days.

**Hunt-hours mode** stretches it to about two weeks. It logs every second from
1.5 h before sunrise to 3 h after, and from 3 h before sunset to 1.5 h after,
working out the sun's times from the GPS fix and the date. The rest of the day
it runs one minute at 1 Hz every 10 minutes, with the sensor's power cut in
between. Measure the sensor's warm-up time first and throw away the readings
from it.

No solar: under a canopy a panel small enough to carry does nothing.

## Weatherproofing a printed case

FDM prints leak in two places: between the layers and at the joins. Each
fix below closes one leak.

**Material.** ASA: it stands up to UV, stays tough in the cold and does not
soften in a hot truck. PETG will do in the shade. Not PLA: it goes brittle
in the cold and creeps in heat. Do not use carbon-filled filament either;
it is partly conductive and dulls the GPS and Wi-Fi.

**Print settings.** 4 perimeters (walls 1.6 mm or more), 5 top and bottom
layers, 0.2 mm layers (0.12–0.16 mm for the threads). Print 5–10 °C hotter
than usual with the fan low for ASA, so the layers fuse. Put the seam at the
back, never on a sealing face. Use solid infill around the screw bosses and
the camera-thread insert.

**Seal the walls.** Brush two thin coats of epoxy (XTC-3D, or a laminating
epoxy) on the outside of the tube and caps. For ASA, an acetone vapour bath
also works. This step stops water wicking in along the layer lines.

**The service cap seal.** Use a face seal, not a radial one. Put the O-ring
groove in the cap's flange and print the flange flat on the bed, so the face
it seals on is the smooth first layer. A radial O-ring sliding over the tube's
layer ridges does not seal.
- O-ring: silicone, from a metric kit. The KEZE kit on the buying list has
  28, 30 and 32 mm rings at 3.1 mm cross-section, rated −30 °C. Nitrile
  stiffens near −30 °C, so stick with silicone.
- Groove for 3.1 mm cord: about 2.4 mm deep and 4.0 mm wide, so it squeezes
  20–25% and does not overfill. Size the groove's diameter to the ring
  you have in hand.
- Thread: a coarse trapezoid, about 3 mm pitch, with a hard stop so it seats
  the same every time. A dab of silicone grease on the O-ring.

**The top cap.** It never opens. The sensor's cable and the high SHT45's
lead each come through their own PG7 nylon gland (3–6.5 mm range; no two-hole
PG7 insert was found). A STEMMA QT lead is thinner than 3 mm, so build it up
with a few layers of heat-shrink where the gland grips. Fill the gland with silicone or epoxy, then glue the cap to the tube
with epoxy. Adhesive heat-shrink goes over each cable where it leaves its
sensor.

**The low sensor's socket.** It is the only other way into the case. Put the
M8 panel socket on a flat boss printed on the tube wall, so its O-ring has a
flat face to seal on. Bed its thread in epoxy as well, and point it a little
downward so rain runs off it. Cap it whenever it is unplugged.

**Breathing.** As the case cools at night it pulls air in through any leak, and
the air brings water with it. A sticker vent (ePTFE membrane, 10 mm) over a 3 mm hole in
the service cap, facing down, evens the pressure out. Add a 5 g indicating silica gel sachet and
swap it when it turns.

**No holes for controls.** The reed switch turns it on, the LED shines
through a thin spot in the wall, and the data comes off over Wi-Fi or on the
card. There is no USB port on the outside: cells and card come out with the
service cap, indoors.

**Boards.** Conformal-coat them with MG Chemicals 422B, the silicone-modified
coating that has replaced 422C. Leave out the SD socket, the connectors, the GPS
antenna and the battery contacts.

**Cold ratings.** The SD card and the M8 cable are rated to −25 °C. The M8
socket, the reed switch, the cells (for discharge, to −20 °C) and the boards
go lower. That is fine for October; past −25 °C those parts are outside their
ratings.

**Test it empty first.** Put a dry tissue inside, close it, and hold it under
10 cm of water for 30 minutes, then hose it from every side. A dry tissue
is a pass. Repeat after a night in the freezer, because the cold shrinks the
O-ring.

Critters: the exposed cables at the head are a few centimetres long. The low
sensor's lead runs 1.7 m down the pole; tape it on inside spiral wrap,
because squirrels and porcupines chew wire.

## The mount

- A 1/4"-20 brass heat-set insert in the service cap (camera thread). It
  fits a monopod, a tripod, most shooting sticks with a camera adapter, or
  the station's own pole.
- The station's pole is any light pole that reaches about 1.8 m with a
  1/4"-20 stud. An aluminium spike goes into the ground, with three 2 mm
  reflective guy cords to tent pegs. Choices, lightest first:
  - aluminium tent-pole sections with a printed stud adapter, about 250 g;
  - a carbon telescoping camera pole (Insta360 3 m, or a cheaper copy). The
    top sections are thin, so guy it, and weigh it before taking it in;
  - a Benro MSD46C carbon monopod (1.83 m, 590 g). Solid and doubles as a
    camera monopod, but the heaviest.
- **The sensor's centre at 2.0 m**, the model's head height. Log the real
  height in the header.
- A 15 mm bullseye level glued to the sensor adapter; level the head before
  you leave it.
- Keep it at least 2 m from trunks and brush where the stand allows. It
  measures the air where a head would be, not the air in a gap.
- Orange flagging tape on the pole: it is a head-height stick in the bush in
  season.

## Firmware

Arduino-ESP32 (PlatformIO). Libraries: ModbusMaster, SdFat, RTClib, TinyGPSPlus
(or the SparkFun u-blox library), Adafruit SHT4x/BME280, WebServer. Each
sensor model gets a small driver with `read() → {speed, dir, ok}`, so a Gill
can replace the BGT without touching the rest.

**States**

| State | Entered by | Does |
|---|---|---|
| Off | Factory, low battery, magnet held 3 s | Deep sleep, sensor power cut |
| Deploy | Magnet swipe from Off | Wi-Fi network `GW-S1`, page at 192.168.4.1: live speed and direction, battery, card space, GPS fix, case damp. Enter the mark's bearing, the height and a label, then **Start**. Starts by itself after 10 minutes. |
| Log | Start | Radios off. Every second: wake, ask the sensor, store it, sleep. Writes to the card once a minute. LED blinks once every 10 s. |
| Download | Magnet swipe while logging | Wi-Fi on for 10 minutes: a file list and download links. Logging carries on underneath. |

**Temperatures.** Every 10 s it reads both SHT45s (high repeatability, about
8 ms each), keeps them in RAM, and writes the minute's means. Above 95% RH it
fires each SHT45's heater for 1 s once an hour and marks the next minute
`heat`. The offsets from the match test sit in a `cal.txt` on the card and go
into the header. They are not applied to the stored readings, so a later
match test can correct them.

On low battery (3.4 V under load) it flushes the files, writes a `LOWBATT`
line and goes to Off. A watchdog restarts it if it hangs, and it carries on
logging into the same day's file.

**Time and place.** At boot the GPS gets a fix (it gives up after 3 minutes under
heavy canopy) and sets the clock, and the fix goes in the header. It resyncs
once a day at midday. Everything is in UTC.

**Direction.** Store the sensor's own reading. Separately, record the
magnetic bearing of its north mark (sighted with a compass at set-up). True
direction = sensor + mark bearing + declination, worked out afterwards from
the GPS position. Direction is where the wind blows **from**, the same as the
checks. Components: u = −s·sin(dir), v = −s·cos(dir).

**Files**, one pair a day, named `S1_20261012_1hz.csv` and `S1_20261012_min.csv`:

```
# station=S1 fw=0.1 sensor=BGT-CF1H4 serial=… height_m=2.00
# mark_bearing_mag=12 lat=48.9312 lon=-85.5931 fix_utc=2026-10-12T10:41:07Z
# t_hi_m=1.90 t_lo_m=0.30 match_dT_c=0.04
# label="bog edge south" mode=1hz
t_utc,speed_ms,dir_sensor,ok
2026-10-12T10:45:00Z,0.42,187,1
```

```
t_utc,n,u_ms,v_ms,vec_speed,vec_dir,mean_speed,sd_speed,sd_dir,gust3s,lull3s,calm_frac,t_hi_c,t_lo_c,rh_hi,rh_lo,dT_c,t_flag,batt_v,case_rh
```

`dT_c` is `t_hi_c − t_lo_c`, stored raw. The true difference is
`dT_c − match_dT_c`, where `match_dT_c` is what the pair read side by side.
Above zero is an inversion. `t_flag` is empty, `sun` or `heat`.

- `sd_dir` is Yamartino's.
- `gust3s` and `lull3s` are the highest and lowest 3-second means in the
  minute. That is where the two winds taking turns will show.
- `calm_frac` is the share of seconds under 0.2 m/s.
- An `S1_events.csv` gets boots, fixes, card errors, sensor errors and low
  battery.
- Size: about 4 MB a day at 1 Hz, so a card holds years.

## Tests, before it goes in the bush

1. **Fan direction.** A fan blowing from the north mark reads about 0°. Turn the
   head 90° clockwise and it reads about 270°. This catches a flipped sign
   before it ruins a week (the aspect-band lesson).
2. **Zero.** Leave the sensor in a closed cooler for 30 minutes. Pass: mean
   speed under 0.05 m/s and spread under 0.05 m/s. Note the offsets. An offset
   over 0.1 m/s rejects the unit.
3. **Walk test, the one that matters.** Indoors in still air (a hall, an arena,
   a long garage), carry it on the pole at 2 m along a taped 20 m line at
   0.25, 0.5, 1.0 and 1.5 m/s (passes of 80, 40, 20 and 13 s, timed to a
   metronome). Go out and back, three times each, with the head at four
   headings. Pass: within ±(0.1 m/s + 5%) from 0.5 m/s up, and a non-zero
   reading at 0.25 m/s. Fail: back to the sensor table.
4. **Car.** On a calm morning on an empty road, with the head 0.5 m above the roof,
   drive 10, 20 and 30 km/h by GPS both ways. This checks the gain at
   moderate speeds.
5. **Twins.** Two stations 3 m apart for 24 h. Their minute means agree within
   0.1 m/s and 10°; that gap is the noise floor for comparing two stands.
6. **Camp.** 24–48 h beside the WS90 in the open.
7. **Thermal match.** Tie the two SHT45s together, without their shields, inside a
   closed cooler. Log an hour at room temperature, then an hour outside or in
   the fridge. `match_dT_c` is the mean difference. Pass: after taking it off,
   the two agree within 0.05 °C at both temperatures. If the offset changes
   with temperature by more than 0.1 °C, store one per temperature.
   Repeat before each season.
8. **A night in the yard.** On a calm, clear night in the open, `dT_c` should
   go positive within an hour or two of sunset. If it does not, look at the
   shields before the sensors.
9. **Case.** The dunk and hose test above, a night logging in the freezer
   (−18 °C) with the files checked after, and one full run-down at room
   temperature to check the power table.

## In the field

Set-up:
1. Swipe the magnet and wait for the LED.
2. Pole plumb, guys out, head level. Plug in the low sensor and set its shield
   0.3 m above the ground surface (the moss in a bog), then tape the lead.
3. Sight the mark's bearing with a compass.
4. On the phone page, enter the bearing, the height and a label, then wait
   for the fix.
5. Start.
6. Take four phone photos (N, E, S, W) named with the station and the date.
7. Flag tape on, walk away.

Pickup: swipe the magnet and download, or take the cap off indoors and pull
the card. The files go in `field-data/stations/S1/`.

## Cost and weight, one station

Canadian prices from the buying list below, 2026-10-08.

| Item | CA$ | g |
|---|---|---|
| BGT-CF1(H4), IP68, RS485 (about US$95 + shipping) | about 130 + shipping | 53 |
| ESP32-S3 Feather, Adalogger, headers | 43 | 15 |
| SP3485, U1V11F5 boost, reed switch, LED, BME280 | 57 | 10 |
| PA1010D GPS + CR1220s | 54 | 8 |
| Two Fenix 21700 cells + Keystone contacts | 73 | 148 |
| SanDisk High Endurance 32 GB | 37 | 1 |
| Thermal pair: two SHT45 (PTFE), M8 socket + 2 m cable, shields | 79 | 75 |
| Case share: ASA, O-ring, glands, vent, inserts, coatings, silica gel | about 20 | 100 |
| Pole, spike, guy cords | 55–135 | 250–590 |
| **Per station** | **about 550–630 + sensor shipping** | **about 660 with the lightest pole** |

The first station also buys the things that last: the charger (CA$40), two
spare cells (CA$70) and whole packs of supplies (about CA$200 of filament, coatings,
O-rings, glands, vents, magnets and inserts, enough for several stations).
That brings the first one to about CA$1,000. The DigiKey part of the order
ships free over CA$100.

Order the sensor first: its lead time is about 15 days.

## Buying (checked 2026-10-08)

**Step 1, costs nothing:** send the six questions under "The sensor" to BGT
Hydromet (admin@bgt-hydromet.com, WhatsApp +86 130 2126 6100) and to Hongyuv
(info@hongyuv.com). Buy the sensor that answers best.

**Step 2, the sensor.**
- BGT-CF1(H4), about US$95, order through the seller's page:
  https://gxhyholly01.en.made-in-china.com/product/VQyYXnRKZjrC/China-Bgt-Mini-Low-Price-Low-Power-Consumption-Ultrasonic-Wind-Speed-Direction-Sensor-Anemometer-for-Weather-Station.html
  (maker's page for the H5: https://www.bgt-hydromet.com/mini-uav-ultrasonic-anemometer-wind-speed-direction-sensor.html)
- Plan B, Hongyuv HY-WDC2E: https://www.instrumentchoice.com.au/products/hy-wdc2e-cost-effective-ultrasonic-anemometer
  (AU$700 at retail; ask Hongyuv for a direct price).
- Last resort, Gill WindSonic: Campbell Scientific Canada,
  https://campbellsci.ca/windsonic1-article

**Step 3, everything else.** All of it works with any of the sensors, so
it can be ordered alongside step 2.

DigiKey Canada, one cart (about CA$224):

| Part | Qty | CA$ | Link |
|---|---|---|---|
| Adafruit ESP32-S3 Feather 4/2 MB (5477) | 1 | 26.21 | https://www.digikey.ca/en/products/detail/adafruit-industries-llc/5477/16583982 |
| Adafruit Adalogger FeatherWing (2922) | 1 | 13.41 | https://www.digikey.ca/en/products/detail/adafruit-industries-llc/2922/5885911 |
| Short female headers (2940) | 1 | 2.25 | https://www.digikey.ca/en/products/detail/adafruit-industries-llc/2940/5848449 |
| Short male headers (3002) | 1 | 0.93 | https://www.digikey.ca/en/products/detail/adafruit-industries-llc/3002/6827172 |
| SparkFun RS-485 SP3485 (BOB-10124) | 1 | 19.96 | https://www.digikey.ca/en/products/result?keywords=1568-10124-ND |
| Adafruit Mini GPS PA1010D (4415) | 1 | 47.82 | https://www.digikey.ca/en/products/detail/adafruit-industries-llc/4415/10709724 |
| Adafruit SHT45 with PTFE filter (6174) | 2 | 21.56 ea | https://www.digikey.ca/en/products/result?keywords=1528-6174-ND |
| Adafruit BME280 (2652) | 1 | 22.39 | https://www.digikey.ca/en/products/detail/adafruit-industries-llc/2652/5604372 |
| STEMMA QT cable 100 mm (4210) | 1 | 1.42 | https://www.digikey.ca/en/products/result?keywords=1528-4210-ND |
| STEMMA QT cable 200 mm (4401) | 1 | 1.87 | https://www.digikey.ca/en/products/result?keywords=1528-4401-ND |
| STEMMA QT cable 300 mm (5384), the high SHT45's lead | 1 | 1.87 | https://www.digikey.ca/en/products/result?keywords=1528-5384-ND |
| Littelfuse reed switch 59050-1-S-00-0 | 1 (+1 spare) | 4.02 | https://www.digikey.ca/en/products/result?keywords=59050-1-S-00-0 |
| NorComp M8 4-pin panel socket 856-004-213R004 | 1 | 15.68 | https://www.digikey.ca/en/products/detail/norcomp-inc/856-004-213R004/22611926 |
| Same Sky M8 male cable, 2 m, CDM815-04A-01MST-2M-67 | 1 | 20.30 | https://www.digikey.ca/en/products/result?keywords=CDM815-04A-01MST-2M-67 |
| Keystone 5209 negative contact | 2 | 1.09 ea | https://www.digikey.ca/en/products/result?keywords=36-5209-ND |
| Keystone 228 positive contact | 2 | about 0.37 ea | https://www.digikey.ca/en/products/result?keywords=36-228-ND |

Pololu (DigiKey only lists it from the marketplace, in US$):

| Part | Qty | US$ | Link |
|---|---|---|---|
| U1V11F5 5 V step-up with SHDN (#2562) | 2 (one spare) | 7.95 ea | https://www.pololu.com/product/2562 |

Cells and charger:

| Part | Qty | CA$ | Link |
|---|---|---|---|
| Fenix ARB-L21-5000 V2.0, protected 21700 | 4 | 34.95 ea | https://www.911supply.ca/products/fenix-arb-l21-5000-v2-0-21700-li-ion-rechargeable-battery (only 5 were in stock) |
| XTAR VC4SL charger | 1 | 39.99 | https://www.amazon.ca/dp/B09MT1ZSKL |

Amazon.ca and others, case and supplies:

| Part | CA$ | Link |
|---|---|---|
| SanDisk High Endurance 32 GB microSD | 37.00 | https://www.amazon.ca/dp/B07P14QHB7 |
| CR1220 cells, Panasonic 10-pack | about 12 | https://www.amazon.ca/dp/B015JR3XVQ |
| White ASA 1 kg, Polymaker | about 30 | https://www.amazon.ca/dp/B09DKN3S9J |
| XTC-3D epoxy, 6.4 oz | 19.95 | https://www.sculpturesupply.com/products/xtc-3d-print-epoxy-coating |
| MG Chemicals 422B conformal coating, 55 ml (B&E Electronics, Calgary) | 30.78 | https://www.be-electronics.com/products/mg-chemicals-422b-55ml-silicone-modified-conformal-coating |
| Silicone O-ring kit (KEZE, 28/30/32 × 3.1 mm included) | 24.99 | https://www.amazon.ca/dp/B0BX9RV7HX |
| PG7 nylon glands, 40 pack | 11.99 | https://www.amazon.ca/dp/B07ZP7WQ36 |
| ePTFE vent stickers, about 12 mm | 8.24 | https://www.amazon.ca/dp/B0HLVQ2DWG (backup, a disc to cut down: https://www.amazon.ca/dp/B0HLN19C9M) |
| Indicating silica gel, 5 g × 20 | about 11 | https://www.amazon.ca/dp/B077ZQ74WM |
| 1/4"-20 brass heat-set inserts, 8 mm, 40 pack | | https://www.amazon.ca/dp/B0CZPD55C1 |
| M3 brass heat-set inserts, 100 pack | 10.99 | https://www.amazon.ca/dp/B0CS6VZYL8 |
| N52 magnets, 10 × 3 mm countersunk (a small pack from anywhere will do) | 43.37 for 50 | https://www.amazon.ca/dp/B0GF7HD1YZ |
| 15 mm bullseye levels, 5 pack | 10.99 | https://www.amazon.ca/dp/B0C372H8MQ |
| 2 mm reflective guy cord, 20 m | 17.95 | https://www.amazon.ca/dp/B0CM9T25MX |
| Pole: Insta360 3 m carbon | 115.99 | https://www.amazon.ca/dp/B08ZCTD6KW (cheaper copy: https://www.amazon.ca/dp/B0DL2BZD9C, 52.99) |
| or Benro MSD46C carbon monopod | 139.95 | https://hotrodcameras.com/en-ca/products/benro-msd46c-supadupa-carbon-fiber-monopod-72 |

Prices are as the pages showed them on 2026-10-08. A few Amazon prices came
from the search page, not the product page.

## Not in v1

- LoRa back to camp. A board with the radio built in (Heltec or LilyGO
  ESP32-S3 + SX1262) keeps the same firmware.
- Bluetooth to the Groundwind app, so a station reads like a stream of checks.
  This belongs with the native app (the app-store plan); the Wi-Fi page
  covers v1.
- A compass and tilt sensor in the head to log heading and lean by itself.
- A heater: rime on the transducers at dawn can blank the readings, and the
  `ok` column and the case log will show how often.
- A reader that joins station minutes to the model at the station's cell
  (`app/scripts/replay.py --stations`) and scores it like the checks.

## Open

- Does the BGT pass the walk test? Everything else waits on that.
- Stick or box? The stick is the spec. If the threads give trouble, the same
  parts fit a flat case hung on the pole with the sensor on a short cable
  through an M12 IP68 panel connector.
- Where the first one goes: the bog edge, where the speed under-call is
  biggest.

## Sources

- BGT-CF1(H4) listing (specs, price): https://gxhyholly01.en.made-in-china.com/product/VQyYXnRKZjrC/China-Bgt-Mini-Low-Price-Low-Power-Consumption-Ultrasonic-Wind-Speed-Direction-Sensor-Anemometer-for-Weather-Station.html
- Gill WindSonic M datasheet: https://observator.com/download/datasheet-windsonic-m
- Gill WindSonic (plastic) manual: https://about.caricoos.org/wp-content/uploads/2016/10/gill_windsonic-manual.pdf
- Calypso ULP STD manual: https://www.manualslib.com/manual/3451139/Calypso-Instruments-Ulp-Std.html
- Calypso ULP STD 485 price: https://citimarinestore.com/es/instrumentos-de-viento-calipso/15324-calypso-medidor-de-viento-ultrasonico-de-potencia-ultrabaja-ulp-std-45-ms-rs485-nmea0183-CMI1017.html
- Renkeer ultrasonic anemometers: https://www.renkeer.com/product/ultrasonic-anemometer/
- SUCH-WS-CSM: https://www.such.com/miniature-wind-speed-direction-sensor
- RS485 anemometer on an ESP32: https://forum.arduino.cc/t/rs485-anemometer-connected-to-an-esp32/1264203
- Ultrasonic anemometer with Arduino (wiring, Modbus): https://how2electronics.com/measure-wind-speed-direction-with-ultrasonic-anemometer-arduino/
