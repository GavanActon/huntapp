# Scent scorecard history

Written by scorecard.py (docs/SCENT-TESTSET.md). A dirty score ran on a working tree with uncommitted app/src changes, so it is not a baseline.

| when | commit | label | variant | tune set | held out | misses | false alarms | pending |
|---|---|---|---|---|---|---|---|---|
| 2026-10-15 14:57 | 4f1d212 | baseline | base | 0.53 | 0.46 | 5 | 66 | 6 |
| 2026-10-15 15:01 | 7a49182 | pre-trees | base | 0.53 | 0.52 | 5 | 63 | 6 |
| 2026-10-15 15:05 | 4f1d212 + spread_swing.diff@d1f5c3c | spread_swing | base | 0.51 | 0.50 | 7 | 63 | 6 |
| 2026-10-15 15:09 | 6ed949f + spread_only.diff@26a39b9 | spread_only | base | 0.50 | 0.54 | 10 | 58 | 6 |
| 2026-10-15 15:12 | 6ed949f + spread_swing.diff@d1f5c3c | spread-swing-trial | base | 0.50 | 0.54 | 10 | 57 | 6 |
