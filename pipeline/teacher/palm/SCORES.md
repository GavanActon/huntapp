# Scent scorecard history

Written by scorecard.py (docs/SCENT-TESTSET.md). A dirty score ran on a working tree with uncommitted app/src changes, so it is not a baseline.

| when | commit | label | variant | tune set | held out | misses | false alarms | pending |
|---|---|---|---|---|---|---|---|---|
| 2026-10-15 14:57 | 4f1d212 | baseline | base | 0.53 | 0.46 | 5 | 66 | 6 |
| 2026-10-15 15:01 | 7a49182 | pre-trees | base | 0.53 | 0.52 | 5 | 63 | 6 |
| 2026-10-15 15:05 | 4f1d212 + spread_swing.diff@d1f5c3c | spread_swing | base | 0.51 | 0.50 | 7 | 63 | 6 |
| 2026-10-15 15:09 | 6ed949f + spread_only.diff@26a39b9 | spread_only (ran SD before the HD pin: void) | base | 0.50 | 0.54 | 10 | 58 | 6 |
| 2026-10-15 15:12 | 6ed949f + spread_swing.diff@d1f5c3c | spread-swing-trial (ran SD before the HD pin: void) | base | 0.50 | 0.54 | 10 | 57 | 6 |
| 2026-10-15 15:36 | 41b3a97 + split.diff@c1d2409 | spread-split (ran SD before the HD pin: void) | base | 0.53 | 0.57 | 7 | 57 | 6 |
| 2026-10-15 15:41 | 0ef365b | baseline-hd | base | 0.53 | 0.50 | 4 | 66 | 9 |
| 2026-10-15 15:45 | d547878 + split.diff@c1d2409 | spread-split-hd | base | 0.54 | 0.48 | 6 | 59 | 9 |
| 2026-10-15 15:53 | d547878 + split2.diff@01ca26d | spread-split-envelope | base | 0.51 | 0.42 | 2 | 79 | 9 |
| 2026-10-15 15:55 | d547878 + split_q2.diff@77fa404 | spread-split-env-q2 | base | 0.54 | 0.50 | 5 | 60 | 9 |
| 2026-10-15 15:57 | d547878 + split_q3.diff@ab20e3a | spread-split-env-q3 | base | 0.53 | 0.57 | 8 | 55 | 9 |
| 2026-10-15 16:00 | d547878 + split_q2_w50.diff@15f458e | spread-split-q2-swing050 | base | 0.53 | 0.48 | 5 | 63 | 9 |
| 2026-10-15 16:02 | d547878 + split_q2_w55.diff@1bba96a | spread-split-q2-swing055 | base | 0.53 | 0.48 | 5 | 63 | 9 |

## Measure v2 (from 2026-10-15)

The tongue is drawn as scent, the pale shade round it as doubt (Gavan's option 3). Misses count where neither covers PALM's scent; false alarms count the tongue only; the tongue's threat is tongue hits / (tongue hits + shade only + misses + false alarms). v1 (the whole cone) is kept beside it.

| when | commit | label | variant | tongue threat, tune | tongue threat, held out | misses | false alarms (tongue) | shade only | v1 tune / held out | pending |
|---|---|---|---|---|---|---|---|---|---|---|
| 2026-10-15 17:16 | 8d50465 | baseline-v2 | base | 0.50 | 0.65 | 5 | 44 | 10 | 0.54 / 0.50 | 9 |
| 2026-10-15 18:16 | 6fd801b + narrow_lee_final.diff@9425bd0 | narrow-tongue-lee-eddy | base | 0.53 | 0.72 | 5 | 29 | 14 | 0.54 / 0.45 | 9 |
| 2026-10-15 21:54 | 058c7e1 | nightly | base | 0.51 | 0.64 | 9 | 50 | 19 | 0.50 / 0.47 | 4 |
| 2026-10-15 22:02 | 058c7e1 | nightly | base | 0.51 | 0.68 | 9 | 50 | 18 | 0.50 / 0.47 | 4 |
| 2026-10-16 05:33 | a0dae4c | nightly | base | 0.54 | 0.60 | 15 | 87 | 27 | 0.52 / 0.53 | 0 |
| 2026-10-16 09:10 | b62ffcb + hooks.diff@1173614 | drain-floor | base | 0.54 | 0.58 | 17 | 91 | 27 | 0.52 / 0.51 | 0 |
| 2026-10-16 09:10 | b62ffcb + hooks.diff@1173614 | drain-floor | d2s2 | 0.54 | 0.60 | 15 | 89 | 27 | 0.51 / 0.53 | 0 |
| 2026-10-16 09:10 | b62ffcb + hooks.diff@1173614 | drain-floor | d2s1 | 0.54 | 0.59 | 15 | 89 | 28 | 0.51 / 0.52 | 0 |
| 2026-10-16 09:10 | b62ffcb + hooks.diff@1173614 | drain-floor | d15s1 | 0.54 | 0.59 | 15 | 89 | 28 | 0.51 / 0.52 | 0 |
| 2026-10-16 09:10 | b62ffcb + hooks.diff@1173614 | drain-floor | floor | 0.54 | 0.59 | 15 | 77 | 35 | 0.53 / 0.53 | 0 |
| 2026-10-16 09:10 | b62ffcb + hooks.diff@1173614 | drain-floor | floor+d2s1 | 0.54 | 0.60 | 13 | 75 | 36 | 0.53 / 0.54 | 0 |
