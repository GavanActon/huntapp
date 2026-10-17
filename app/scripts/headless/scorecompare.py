"""Diff the 'before' and 'after' scorer dumps field by field: numbers bit-exact (so -0 against 0 counts, NaN equals NaN), labels and text exact.

    py -3.14 scripts/headless/scorecompare.py [--area pickle-lake|blanchard-river|highland-lake|all] [--max 20] [--after-prefix after]
                                              [--dir <folder>] [--before X.json --after Y.json]

Reads before*.json and after*.json from the dump folder (scripts/headless/out/scoredump/ unless --dir; scoredump.py writes them): one pair per
area, before.json / after.json for Pickle Lake, before.<area>.json / after.<area>.json for the others. Prints the preconditions that decide
whether a difference can be the edit's (same ground-wind state, same frozen conditions, the files that changed between the two runs), the hash
table (hs / sf sha256 per target, condition, weights), then the first N differing fields (an array counts as one field: how many of its
cells differ, the first, the largest gap) and a verdict. --after-prefix control compares 'before' with a 'control' dump (the harness
checking itself: it must find nothing).
Exit code 0 identical, 1 differences, 2 identical but a precondition failed (so the comparison proves less than it should), or nothing to compare.
"""
import gzip
import json
import os
import re
import struct
import sys
from array import array

for _s in (sys.stdout, sys.stderr):
    if hasattr(_s, 'reconfigure'):
        _s.reconfigure(encoding='utf-8', errors='replace')

HERE = os.path.dirname(os.path.abspath(__file__))


def arg(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


MAX = int(arg('--max', 20))
AFTER = arg('--after-prefix', 'after')
DIR = os.path.abspath(arg('--dir') or os.path.join(HERE, 'out', 'scoredump'))


def is_num(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool)


def b64_to_list(s):
    import base64
    a = array('d')
    a.frombytes(base64.b64decode(s))
    return list(a)


def f32_to_list(s):
    import base64
    a = array('f')
    a.frombytes(base64.b64decode(s))
    return list(a)


def attach_texts(J, path):
    """The interned texts scoredump.py keeps in <name>.text.json.gz go back where they came from (a file from before the split has them inline)."""
    if not os.path.exists(path):
        return
    with gzip.open(path, 'rt', encoding='utf-8') as f:
        tx = json.load(f)
    for t, cs in tx.items():
        for cn, parts in cs.items():
            u = J['targets'][t][cn]
            u['describe'].update(parts['describe'])
            u['site']['labelsByCell'] = parts['labelsByCell']
            for k, v in parts.items():
                if '.' in k:
                    wn, fld = k.split('.', 1)
                    u['grid'][wn][fld] = v


def normalize(o):
    """base64 float64 blobs become lists; {tab, idx} interned text becomes a list of strings."""
    if isinstance(o, dict):
        if 'tab' in o and 'idx' in o and isinstance(o['tab'], list) and isinstance(o['idx'], list):
            rest = {k: normalize(v) for k, v in o.items() if k not in ('tab', 'idx')}
            rest['text'] = [o['tab'][j] for j in o['idx']]
            return rest
        out = {}
        for k, v in o.items():
            if k == 'ms' and is_num(v):
                continue  # how long a unit took: the harness's, not the scorer's
            if k.endswith('B64') and isinstance(v, str):
                out[k[:-3]] = b64_to_list(v)
            elif k.endswith('F32') and isinstance(v, str):
                out[k] = f32_to_list(v)
            elif k == 'b64' and isinstance(v, dict):
                out['arrays'] = {kk: b64_to_list(vv) for kk, vv in v.items()}
            else:
                out[k] = normalize(v)
        return out
    if isinstance(o, list):
        return [normalize(v) for v in o]
    return o


class Diffs:
    def __init__(self):
        self.items = []  # (path, kind, detail)
        self.cells = 0

    def add(self, path, kind, detail):
        self.items.append((path, kind, detail))


def short(x, n=170):
    s = x if isinstance(x, str) else json.dumps(x, ensure_ascii=False)
    return s if len(s) <= n else s[: n - 3] + '...'


def cmp_numlist(path, a, z, d):
    if len(a) != len(z):
        d.add(path, 'length', f'{len(a)} cells before, {len(z)} after')
        return
    A = array('d', [float(v) for v in a])
    Z = array('d', [float(v) for v in z])
    if A.tobytes() == Z.tobytes():
        return
    nd, bits, first, maxabs = 0, 0, None, 0.0
    for k in range(len(A)):
        x, y = A[k], Z[k]
        if struct.pack('<d', x) == struct.pack('<d', y):
            continue
        nd += 1
        if x == y:
            bits += 1
        else:
            if x != x or y != y:
                gap = float('inf')
            else:
                gap = abs(x - y)
            maxabs = max(maxabs, gap)
        if first is None:
            first = (k, x, y)
    kind = 'bits' if bits == nd else 'number'
    d.add(path, kind, f'{nd} of {len(A)} cells differ{" (only the sign of zero / NaN bits)" if bits == nd else ""}; max gap {maxabs:.3g}; first at [{first[0]}]: before {first[1]!r}, after {first[2]!r}')
    d.cells += nd


def first_line_diff(x, y):
    xs, ys = x.split('\n'), y.split('\n')
    for k in range(max(len(xs), len(ys))):
        l, r = (xs[k] if k < len(xs) else '<missing>'), (ys[k] if k < len(ys) else '<missing>')
        if l != r:
            return k, l, r
    return 0, x, y


def cmp_textlist(path, a, z, d):
    if len(a) != len(z):
        d.add(path, 'length', f'{len(a)} entries before, {len(z)} after')
        return
    nd, first = 0, None
    for k in range(len(a)):
        if a[k] != z[k]:
            nd += 1
            if first is None:
                first = (k, a[k], z[k])
    if nd:
        ln, l, r = first_line_diff(first[1], first[2])
        multi = '\n' in first[1] or '\n' in first[2]
        d.add(path, 'text', f'{nd} of {len(a)} entries differ; first at [{first[0]}]' + (f', line {ln}' if multi else '') + ':\n        before: ' + short(l) + '\n        after:  ' + short(r))
        d.cells += nd


def cmp(path, a, z, d):
    if isinstance(a, dict) and isinstance(z, dict):
        for k in a:
            if k not in z:
                d.add(f'{path}.{k}', 'structure', 'only in before')
            else:
                cmp(f'{path}.{k}', a[k], z[k], d)
        for k in z:
            if k not in a:
                d.add(f'{path}.{k}', 'structure', 'only in after')
        return
    if isinstance(a, list) and isinstance(z, list):
        if a and all(is_num(v) for v in a) and (not z or all(is_num(v) for v in z)):
            return cmp_numlist(path, a, z, d)
        if a and all(isinstance(v, str) for v in a) and (not z or all(isinstance(v, str) for v in z)):
            return cmp_textlist(path, a, z, d)
        if len(a) != len(z):
            d.add(path, 'length', f'{len(a)} entries before, {len(z)} after')
            return
        for k in range(len(a)):
            cmp(f'{path}[{k}]', a[k], z[k], d)
        return
    if is_num(a) and is_num(z):
        if struct.pack('<d', float(a)) != struct.pack('<d', float(z)):
            kind = 'bits' if (a == z) else 'number'
            d.add(path, kind, f'before {a!r}, after {z!r}')
            d.cells += 1
        return
    if type(a) != type(z) or a != z:
        d.add(path, 'text' if isinstance(a, str) else 'value', f'before {short(a)} | after {short(z)}')
        d.cells += 1


def pairs():
    fb, fa = arg('--before'), arg('--after')
    if fb and fa:
        return [('custom', fb, fa)]
    want = arg('--area', 'all')
    out = []
    if not os.path.isdir(DIR):
        return out
    for fn in sorted(os.listdir(DIR)):
        m = re.match(r'^before(\.[a-z0-9-]+)?\.json$', fn)
        if not m or (m.group(1) or '') in ('.manifest', '.hashes', '.console'):
            continue
        sfx = m.group(1) or ''
        area = sfx[1:] if sfx else 'pickle-lake'
        if want != 'all' and want != area:
            continue
        out.append((area, os.path.join(DIR, fn), os.path.join(DIR, f'{AFTER}{sfx}.json')))
    return out


def manifests(area):
    sfx = '' if area == 'pickle-lake' else f'.{area}'
    try:
        with open(os.path.join(DIR, f'before{sfx}.manifest.json'), encoding='utf-8') as f:
            b = json.load(f)
        with open(os.path.join(DIR, f'{AFTER}{sfx}.manifest.json'), encoding='utf-8') as f:
            a = json.load(f)
    except Exception:  # noqa: BLE001
        return None
    chg = {'src': [], 'data': []}
    for k in sorted(set(b['start']['src']) | set(a['end']['src'])):
        if b['start']['src'].get(k) != a['end']['src'].get(k):
            chg['src'].append(k)
    for k in sorted(set(b['start']['data']) | set(a['end']['data'])):
        if b['start']['data'].get(k) != a['end']['data'].get(k):
            chg['data'].append(k)
    return chg


def main():
    rc = 0
    ps = pairs()
    if not ps:
        print(f'no before*.json found in {DIR} (scoredump.py before ...)')
        return 2
    for area, fb, fa in ps:
        print('=' * 100)
        print(f'AREA {area}: {os.path.basename(fb)}  vs  {os.path.basename(fa)}')
        if not os.path.exists(fa):
            print('  no after file for this area (the AFTER dump has not been taken)')
            rc = max(rc, 2)
            continue
        with open(fb, encoding='utf-8') as f:
            B = json.load(f)
        with open(fa, encoding='utf-8') as f:
            A = json.load(f)
        attach_texts(B, fb[:-len('.json')] + '.text.json.gz')
        attach_texts(A, fa[:-len('.json')] + '.text.json.gz')
        notes, fails = [], []
        # ---- preconditions
        rb, ra = B['run'], A['run']
        if rb.get('probe') != ra.get('probe'):
            fails.append(f'the ground-wind state fingerprint differs between the runs (before {rb.get("probe")} / after {ra.get("probe")}): a difference below may not be the edit')
        else:
            notes.append(f'ground-wind state fingerprint identical across the runs ({rb["probe"]["n"]} reads, {rb["probe"]["nul"]} none)')
        if B.get('conditionB') != A.get('conditionB'):
            fails.append('condition B differs between the dumps (it should be the frozen literal)')
        if ra.get('condLiveEqualsFrozenB') is False:
            notes.append('the app\'s own conditions at AFTER time differ from the frozen B literal (the clock moved); the frozen one was used, as intended')
        if not rb.get('probeUnchanged', True) or not ra.get('probeUnchanged', True):
            fails.append('the ground-wind state moved during one of the dumps')
        chg = manifests(area)
        if chg is not None:
            others = [f for f in chg['src'] if not f.startswith('spots/')]
            notes.append(f'files under app/src changed between the BEFORE start and the AFTER end: {len(chg["src"])} ({", ".join(chg["src"][:12])}{" ..." if len(chg["src"]) > 12 else ""})')
            if others:
                msg = f'files outside src/spots changed between the dumps (they may feed the scorer): {", ".join(others[:15])}'
                if rb.get('probe') == ra.get('probe'):
                    notes.append(msg + ' (the ground-wind fingerprint is identical, so the ground model reads the same where probed)')
                else:
                    fails.append(msg)
            if B.get('git', {}).get('head') != A.get('git', {}).get('head'):
                notes.append(f'git HEAD moved between the dumps: {B["git"]["head"][:8]} -> {A["git"]["head"][:8]} (commits by other sessions; see the file lists)')
            if chg['data']:
                fails.append(f'data files changed between the dumps: {", ".join(chg["data"])}')
        for tag, r in (('before', rb), ('after', ra)):
            if r.get('manifestChangedDuringRun', {}).get('src') or r.get('manifestChangedDuringRun', {}).get('data'):
                fails.append(f'{tag}: files changed DURING the dump run: {r["manifestChangedDuringRun"]}')
            if r.get('pageLoads', 1) != 1:
                fails.append(f'{tag}: the page loaded {r["pageLoads"]} times in the final attempt')
            if r.get('omcache', {}).get('missed'):
                notes.append(f'{tag}: {len(r["omcache"]["missed"])} Open-Meteo request(s) had no recorded answer (aborted)')
        for tag, J in (('before', B), ('after', A)):
            if J.get('harnessWarnings'):
                fails.append(f'{tag}: harness warnings: {J["harnessWarnings"][:3]}')
            noreset = [f'{t}/{cn}' for t, cs in J['targets'].items() for cn, u in cs.items() if u.get('leeReset') != 'ok']
            if noreset:
                fails.append(f'{tag}: the ground model lee/slot cache was not emptied before {len(noreset)} unit(s) (e.g. {noreset[0]}): the words of terrain cells can then depend on what the app streaks asked first')
        mu_b, mu_a = B['meta'].get('moduleUrls', {}), A['meta'].get('moduleUrls', {})
        both = [k for k in mu_a if k in mu_b]
        stamped = [mu_a[k].split('?')[0].split('/')[-1] for k in both if mu_b[k] != mu_a[k]]
        if stamped:
            notes.append(f'modules the scorer imports under a new HMR stamp (URL): {", ".join(stamped)} (re-imported by the app: expected for files that were edited)')
        for tag, J in (('before', B), ('after', A)):
            vv = {p.split('/')[-1]: n for p, n in J['meta'].get('moduleVariants', {}).items() if n != 1}
            if vv:
                notes.append(f'{tag}: more than one URL (stamp) of {vv} was requested in the page; the dump follows scoring.ts\'s own import chain, so it reads the scorer\'s instances either way')
        print('  pinned modules: before=%s after=%s' % (B.get('pin'), A.get('pin')))
        for n in notes:
            print('  note:', n)
        for f in fails:
            print('  PRECONDITION FAILED:', f)
        # ---- hash table
        rows, bad = 0, []
        for t, cs in B['targets'].items():
            for cn, ub in cs.items():
                ua = A['targets'].get(t, {}).get(cn)
                for wn, gb in ub['grid'].items():
                    rows += 1
                    if not ua or wn not in ua['grid']:
                        bad.append(f'{t}/{cn}/{wn}: missing in after')
                        continue
                    ga = ua['grid'][wn]
                    diff = [k for k in ('hsSha', 'sfSha', 'sfWarmSha', 'revHsSha', 'revSfSha') if gb[k] != ga[k]]
                    if diff:
                        bad.append(f'{t}/{cn}/{wn}: {", ".join(diff)} differ  (before hs={gb["hsSha"][:12]} sf={gb["sfSha"][:12]}; after hs={ga["hsSha"][:12]} sf={ga["sfSha"][:12]})')
        print(f'\n  sha256 of hs / sf / sfWarm / reverse-order passes: {rows - len(bad)} of {rows} (target, condition, weights) rows identical')
        for line in bad[:MAX]:
            print('   ', line)
        # ---- the field-by-field diff
        d = Diffs()
        nb, na = normalize({k: B[k] for k in ('meta', 'conditionB', 'targets', 'pure')}), normalize({k: A[k] for k in ('meta', 'conditionB', 'targets', 'pure')})
        for J in (nb, na):  # harness metadata: reported above, not diffed
            for k in ('uncoveredLeft', 'moduleUrls', 'moduleVariants'):
                J['meta'].pop(k, None)
        cmp('', nb, na, d)
        print(f'\n  field-by-field: {len(d.items)} differing field(s), {d.cells} differing cells/values in all')
        for k, (path, kind, detail) in enumerate(d.items[:MAX], 1):
            print(f'  {k:2}. [{kind}] {path.lstrip(".")}\n      {detail}')
        if len(d.items) > MAX:
            print(f'  ... and {len(d.items) - MAX} more')
        if d.items:
            rc = max(rc, 1)
            print(f'  VERDICT {area}: DIFFERENT')
        elif fails:
            rc = max(rc, 2)
            print(f'  VERDICT {area}: identical, but a precondition failed (see above)')
        else:
            print(f'  VERDICT {area}: IDENTICAL: every number bit-for-bit, every label')
    return rc


if __name__ == '__main__':
    sys.exit(main())
