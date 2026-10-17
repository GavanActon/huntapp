"""Compare two scenario runs at the text level, or print one run compactly.

    py -3.14 scripts/headless/compare.py out/baseline out/after [scenario ...]    what a code change can change (exit status 1 if anything differs)
    py -3.14 scripts/headless/compare.py out/after [scenario ...]                 one run: each scenario's notes, last facts and console problems

A run is its folder or its results.json (scenarios.py writes them). Pixels differ run to run (wind streaks move, the forecast changes), so
this compares what a code cut can change: which sheet/popup/card/menu is up and its words (digits blanked), button states, click or sheet
failures, page errors and the kinds of console problem. Look at the shots themselves for anything visual.

The app's own words move with the hour ('scent goes E till 4:15a' at 04:02, 'scent goes NE till 12a' at 07:55 on the same code): compare runs
made at the same time of day, or hold the page's clock in both (--clock, clock.py). Runs with different clocks are named at the top.
"""
import json
import os
import re
import sys

for _s in (sys.stdout, sys.stderr):  # the facts carry · › ; a pipe on Windows defaults to cp1252
    if hasattr(_s, 'reconfigure'):
        _s.reconfigure(encoding='utf-8', errors='replace')

STABLE = ['popups', 'sheet', 'sheetText', 'bottombar', 'topcard', 'topbar', 'menu', 'viewMenu', 'pill', 'grade', 'hot', 'locate', 'mapLoaded', 'streakCanvases', 'cellsOk', 'toparea', 'heat']
HEAT_SCENARIOS = ('heat', 'digin')  # heatLayer must be 'visible' there (it is None/'none' elsewhere depending on timing)
# console kinds that come and go run to run: Open-Meteo's daily quota, SwiftShader read-back warnings, MapLibre aborting range requests
BENIGN = re.compile(r'Too Many Requests|open-meteo|GPU stall|ERR_ABORTED')
BAD = ('CLICK FAILED', 'LOG NOT SEEN', 'SHEET NOT READY', 'SCENARIO ERROR', 'EMPTY after', 'NO .pp-digin', 'no rows or note', 'heat NOT visible')
SHOW = ['popups', 'popup', 'sheet', 'sheetText', 'bottombar', 'topcard', 'topbar', 'toparea', 'menu', 'viewMenu', 'pill', 'heat', 'heatLayer', 'spotPins', 'locate', 'mapLoaded', 'streakCanvases']


def blank(v):
    return re.sub(r'\d+', '#', json.dumps(v, ensure_ascii=False, sort_keys=True)) if v is not None else None


def kinds(rec):
    out = set()
    for p in rec['problems']:
        if BENIGN.search(p['line']):
            continue
        out.add(re.sub(r'0x[0-9a-f]+|\d+', '#', re.sub(r'\?.*', '?', p['line']))[:110])
    return out


def load_run(p):
    f = os.path.join(p, 'results.json') if os.path.isdir(p) else p
    with open(f, encoding='utf-8') as fh:
        return json.load(fh)


def summarize(run, want):
    for name, v in run.items():
        if want and name not in want:
            continue
        print(f'\n=== {name}  {v["seconds"]} s  pageLoads={v["pageLoads"]}  error={v["error"]}  srcChanged={v["srcChangedDuringRun"]}  fp={v["fingerprint"][0]["sha"]}->{v["fingerprint"][1]["sha"]}')
        print('  shots:', ', '.join(v['shots']))
        print('  perf :', v['perf'], ' http429:', v.get('http429'), ' ready:', v.get('ready'), ' clock:', v.get('clock'))
        om = v.get('omcache')
        if om is not None:
            print('  replay:', {k: om.get(k) for k in ('hit', 'donor', 'aborted')})
        if v['viteReloadLines']:
            print('  VITE :', v['viteReloadLines'])
        for n in v['notes']:
            print('  note :', n[:230])
        last = list(v['facts'].values())[-1] if v['facts'] else {}
        print('  facts(last shot):', json.dumps({k: last.get(k) for k in SHOW if last.get(k) not in (None, '')}, ensure_ascii=False)[:900])
        for p in v['problems']:
            print(f'  problem x{p["count"]}: {p["line"][:170]}')


def compare(a, b, want):
    diffs = 0
    ca = {r.get('clock') for r in a.values()}
    cb = {r.get('clock') for r in b.values()}
    if ca != cb:
        print(f'note: the runs held different clocks (before {sorted(map(str, ca))}, after {sorted(map(str, cb))}): words that move with the hour will differ\n')
    for name in sorted(set(a) | set(b)):
        if want and name not in want:
            continue
        if name not in a or name not in b:
            print(f'{name}: only in {"before" if name in a else "after"}')
            diffs += 1
            continue
        ra, rb = a[name], b[name]
        for shot in sorted(set(ra['facts']) | set(rb['facts'])):
            fa, fb = ra['facts'].get(shot), rb['facts'].get(shot)
            if fa is None or fb is None:
                print(f'{name}/{shot}: shot only in {"before" if fb is None else "after"}')
                diffs += 1
                continue
            for k in STABLE + (['heatLayer'] if name in HEAT_SCENARIOS else []):
                if k not in fa or k not in fb:
                    continue  # a key one run did not record
                if blank(fa.get(k)) != blank(fb.get(k)):
                    print(f'{name}/{shot}: {k}\n    before: {str(fa.get(k))[:200]}\n    after : {str(fb.get(k))[:200]}')
                    diffs += 1
        for tag, rec in (('before', ra), ('after', rb)):
            bad = [n for n in rec['notes'] if any(x in n for x in BAD)]
            if bad and (tag == 'after' or not any(x in ' '.join(ra['notes']) for x in BAD)):
                print(f'{name}: {tag} has problems: {bad[:3]}')
                diffs += 1
        if ra['pageLoads'] != rb['pageLoads'] or rb['srcChangedDuringRun']:
            print(f'{name}: pageLoads {ra["pageLoads"]} -> {rb["pageLoads"]}, src changed during the after run: {rb["srcChangedDuringRun"]} (a hot reload may have disturbed it; re-run)')
            diffs += 1
        if rb.get('http429', 0) > 20 or any(f.get('cellsOk') is False for f in rb['facts'].values()):
            print(f'{name}: AFTER RUN LOOKS THROTTLED (Open-Meteo 429 x{rb.get("http429")}, or a strip with no forecast): not valid (replay it: omcache.py)')
            diffs += 1
        ka, kb = kinds(ra), kinds(rb)
        if ka != kb:
            print(f'{name}: console problem kinds differ\n    only before: {sorted(ka - kb)}\n    only after : {sorted(kb - ka)}')
            diffs += 1
        if any('[pageerror]' in p['line'] for p in rb['problems']):
            print(f'{name}: PAGE ERRORS after')
            diffs += 1
    print(f'\n{diffs} difference(s)')
    return diffs


def main(argv):
    argv = list(argv)
    runs = []
    while argv and len(runs) < 2 and os.path.exists(argv[0]):
        runs.append(argv.pop(0))
    if not runs:
        print(__doc__)
        return 2
    if len(runs) == 1:
        summarize(load_run(runs[0]), argv)
        return 0
    return 1 if compare(load_run(runs[0]), load_run(runs[1]), argv) else 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
