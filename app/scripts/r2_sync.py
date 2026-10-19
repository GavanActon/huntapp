"""Copy the app's baked data to R2, so the app can read it from
https://data.groundwind.app/data/ (VITE_DATA_BASE) instead of its own dist
(docs/AREAS.md and docs/SD-HD-PLAN.md, Hosting).

    py -3.14 app/scripts/r2_sync.py [--dry-run] [--size-only] [--manifests DIR | --no-manifests]
                                    [--only PATH] [--prefix data/] [--verify N] [--jobs N]

What goes up, at the same relative paths under data/ (so a file's URL is
<base>/data/areas/<id>/<file>, as it is on the app's own host):

  - every file under app/public/data that git does not ignore. The ignored
    ones are bake inputs the app never reads, and some may never ship (the
    Quebec hunting zones state no licence: .gitignore). Untracked files that
    are not ignored go up, so an area baked on request needs no commit.
  - then the manifests the app build writes (data/manifest.json,
    data/areas/index.json, data/areas/<id>/manifest.json), from DIST/data,
    by default app/dist/data. They go last, so a phone never reads a
    manifest naming bytes not there yet. They are checked against the files
    first (every listed size and hash); a stale build is refused: run
    `npm run build` (with VITE_DATA_BASE set, the build is a few MB) again.
    Entries for files that do not go up (ignored ones on this disk) are left
    out of the uploaded manifests.

An object already there with the same size and the same ETag (MD5, or the
multipart ETag this script would make) is skipped; --size-only skips on size
alone. Nothing on R2 is deleted: objects under data/ with no file here are
listed at the end. Keys come from R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY in
the environment, else from the user's registry environment (Windows); they
are never printed.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / 'app' / 'public' / 'data'
DIST_DATA = ROOT / 'app' / 'dist' / 'data'
ENDPOINT = 'https://ebcafd8e3dbdaad405e17dfb174c0f0f.r2.cloudflarestorage.com'
BUCKET = 'groundwind-data'
PUBLIC = 'https://data.groundwind.app/'
# the app's paths under data/, so VITE_DATA_BASE is https://data.groundwind.app/data/
# (--prefix '' puts them at the bucket's root, for a base of https://data.groundwind.app/)
PREFIX = 'data/'

# one PUT per file up to this size, so the ETag is the file's MD5; larger
# files go in parts of PART bytes (the ETag is then md5(part md5s)-N)
MULTIPART_AT = 512 * 1024 * 1024
PART = 64 * 1024 * 1024

TYPES = {
    '.pmtiles': 'application/octet-stream',
    '.hab': 'application/octet-stream',
    '.geojson': 'application/geo+json',
    '.json': 'application/json',
}
# as GitHub Pages serves them (max-age=600); the manifests are asked past
# every cache by the app anyway, and revalidate here
CACHE_DATA = 'public, max-age=600'
CACHE_MANIFEST = 'no-cache'

# Gavan, 2026-10-19, the machines on the road: "pause any uploading on xevo and xonix for now.
# Building is fine, uploading not." This file on XEVO's share holds every upload from the machines
# (this script, wind_tiles.py's tiles, the ops page, the stations): what was built waits on disk and
# the first upload after it is removed sends it. GitHub's dev run has no such file and uploads as ever.
HOLD = [ROOT / 'pipeline' / 'raw' / 'windcfd' / 'HOLD-UPLOADS', Path(r'\\XEVO\windcfd2\HOLD-UPLOADS')]


def held() -> Path | None:
    """The hold file when uploads are held, else None."""
    for p in HOLD:
        try:
            if p.exists():
                return p
        except OSError:
            pass
    return None


def secret(name: str) -> str:
    v = os.environ.get(name)
    if not v and sys.platform == 'win32':
        import winreg

        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, 'Environment') as k:
                v = winreg.QueryValueEx(k, name)[0]
        except OSError:
            v = None
    if not v:
        sys.exit(f'{name} is not set (environment or HKCU\\Environment)')
    return v.strip()


def client():
    import boto3
    from botocore.config import Config

    return boto3.client(
        's3',
        endpoint_url=ENDPOINT,
        aws_access_key_id=secret('R2_ACCESS_KEY_ID'),
        aws_secret_access_key=secret('R2_SECRET_ACCESS_KEY'),
        region_name='auto',
        # R2 takes the plain checksums, not boto3's default trailing ones
        config=Config(signature_version='s3v4', request_checksum_calculation='when_required', response_checksum_validation='when_required', retries={'max_attempts': 6, 'mode': 'standard'}, max_pool_connections=16),
    )


def local_files(only: str | None) -> list[tuple[str, Path]]:
    """(key, path) for every data file git does not ignore."""
    out = subprocess.run(
        ['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', 'app/public/data'],
        cwd=ROOT, capture_output=True, check=True,
    ).stdout.decode('utf8')
    files = []
    for rel in sorted(set(filter(None, out.split('\0')))):
        p = ROOT / rel
        if not p.is_file() or p.stat().st_size == 0 or p.suffix in ('.part', '.tmp'):
            continue  # deleted, empty or still being written
        sub = p.relative_to(DATA).as_posix()
        if p.name == 'manifest.json':
            continue  # the build writes these
        if only and not sub.startswith(only):
            continue
        files.append((PREFIX + sub, p))
    return files


def digests(path: Path) -> tuple[str, str]:
    """The ETag R2 gives this file as this script uploads it, and the
    manifest's hash (sha1, first 16 hex)."""
    size = path.stat().st_size
    sha = hashlib.sha1()
    whole = hashlib.md5()
    parts = []
    part = hashlib.md5()
    in_part = 0
    with path.open('rb') as f:
        while chunk := f.read(4 << 20):
            sha.update(chunk)
            if size < MULTIPART_AT:
                whole.update(chunk)
                continue
            # chunks are 4 MiB, PART a multiple of it: parts end on chunk edges
            part.update(chunk)
            in_part += len(chunk)
            if in_part == PART:
                parts.append(part.digest())
                part, in_part = hashlib.md5(), 0
    if size < MULTIPART_AT:
        etag = whole.hexdigest()
    else:
        if in_part:
            parts.append(part.digest())
        etag = f'{hashlib.md5(b"".join(parts)).hexdigest()}-{len(parts)}'
    return etag, sha.hexdigest()[:16]


def remote_objects(s3) -> dict[str, tuple[int, str]]:
    out = {}
    for page in s3.get_paginator('list_objects_v2').paginate(Bucket=BUCKET, Prefix=PREFIX):
        for o in page.get('Contents', []):
            out[o['Key']] = (o['Size'], o['ETag'].strip('"'))
    return out


def content_type(name: str) -> str:
    return TYPES.get(Path(name).suffix.lower(), 'application/octet-stream')


def fmt(n: float) -> str:
    return f'{n / 1e9:.2f} GB' if n >= 1e9 else f'{n / 1e6:.1f} MB' if n >= 1e6 else f'{n / 1e3:.0f} KB'


def manifests(dist: Path, sent: dict[str, tuple[int, str]]) -> tuple[list[tuple[str, bytes]], list[str]]:
    """The build's manifests as they should go up, and what is wrong with
    them. `sent`: key -> (size, hash) of every data file that goes up (or is
    up), for the whole tree, --only or not."""
    problems: list[str] = []
    out: list[tuple[str, bytes]] = []
    index_p = dist / 'areas' / 'index.json'
    if not (dist / 'manifest.json').is_file() or not index_p.is_file():
        return [], [f'no manifests in {dist}: build the app first']
    index = json.loads(index_p.read_text(encoding='utf8'))
    by_base = {a['base']: a for a in index.get('areas', [])}
    if '' not in by_base:
        problems.append('areas/index.json has no area with the flat base (Pickle Lake)')
    changed_index = False
    for base, area in by_base.items():
        mp = dist / base / 'manifest.json'
        if not mp.is_file():
            problems.append(f'{base or "data/"}manifest.json missing from the build')
            continue
        m = json.loads(mp.read_text(encoding='utf8'))
        files = m.get('files', {})
        dropped = []
        for name, e in list(files.items()):
            key = PREFIX + base + name
            if key not in sent:
                p = DATA / base / name
                if p.is_file():
                    dropped.append(name)  # on this disk, but ignored by git: not sent, not listed
                    del files[name]
                else:
                    problems.append(f'{base}{name}: in the build\'s manifest, no such file now (rebuild)')
                continue
            size, sha = sent[key]
            if e.get('size') != size or e.get('hash') != sha:
                problems.append(f'{base}{name}: the build\'s manifest is behind the file (rebuild)')
        # every file of the area's folder (or Pickle's flat root) is listed
        for key in sent:
            rest = key[len(PREFIX):]
            if base and rest.startswith(base):
                name = rest[len(base):]
            elif not base and '/' not in rest:
                name = rest
            else:
                continue
            if name not in files:
                problems.append(f'{rest}: not in the build\'s manifest (rebuild)')
        body = json.dumps(m, separators=(',', ':'), ensure_ascii=False) if dropped else mp.read_text(encoding='utf8')
        if dropped:
            print(f'  {base or "data/"}manifest.json: left out {len(dropped)} ignored file(s): {", ".join(dropped)}')
            area['hash'] = hashlib.sha1(body.encode('utf8')).hexdigest()[:16]
            changed_index = True
        out.append((PREFIX + base + 'manifest.json', body.encode('utf8')))
    index_body = json.dumps(index, separators=(',', ':'), ensure_ascii=False) if changed_index else index_p.read_text(encoding='utf8')
    out.append((PREFIX + 'areas/index.json', index_body.encode('utf8')))
    return out, problems


def verify(keys: list[str], n: int) -> None:
    """HEAD a few through the public domain, and one ranged read."""
    if n <= 0 or not keys:
        return
    pick = sorted(keys, key=lambda k: (k.endswith('.json'), k))
    step = max(1, len(pick) // n)
    sample = pick[::step][:n]
    print(f'verify through {PUBLIC}:')
    # Cloudflare turns away Python's own User-Agent (403)
    ua = {'User-Agent': 'groundwind-r2-sync/1'}
    for k in sample:
        req = urllib.request.Request(PUBLIC + k, method='HEAD', headers={**ua, 'Origin': 'https://hunt.groundwind.app'})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                h = r.headers
                print(f'  {r.status} {h.get("content-length"):>10} {h.get("content-type"):<24} acao={h.get("access-control-allow-origin")} cf={h.get("cf-cache-status")}  {k}')
        except Exception as e:  # noqa: BLE001
            print(f'  FAIL {k}: {e}')
    rng = next((k for k in sample if k.endswith('.pmtiles') or k.endswith('.hab')), None)
    if rng:
        req = urllib.request.Request(PUBLIC + rng, headers={**ua, 'Range': 'bytes=0-126', 'Origin': 'http://localhost:5176'})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                print(f'  range: {r.status} {r.headers.get("content-range")} {len(r.read())} bytes  {rng}')
        except Exception as e:  # noqa: BLE001
            print(f'  range FAIL {rng}: {e}')


def main() -> None:
    global PREFIX
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--dry-run', action='store_true', help='say what would go up, send nothing')
    ap.add_argument('--size-only', action='store_true', help='skip an object of the same size without comparing its ETag')
    ap.add_argument('--manifests', type=Path, default=DIST_DATA, help='the built data/ folder with the manifests (default app/dist/data)')
    ap.add_argument('--no-manifests', action='store_true', help='data files only')
    ap.add_argument('--only', help='only keys under this path below data/ (e.g. areas/blanchard-river/)')
    ap.add_argument('--verify', type=int, default=4, help='HEAD this many objects through the public domain after (0: none)')
    ap.add_argument('--jobs', type=int, default=4, help='uploads at once')
    if (h := held()) and '--dry-run' not in sys.argv:
        sys.exit(f'uploads held ({h}): nothing sent; remove the file to send')
    ap.add_argument('--prefix', default='data/', help="the keys' folder in the bucket, ending in / or empty (default data/)")
    a = ap.parse_args()
    PREFIX = a.prefix if not a.prefix or a.prefix.endswith('/') else a.prefix + '/'

    from boto3.s3.transfer import TransferConfig

    t0 = time.time()
    files = local_files(a.only)
    every = files if not a.only else local_files(None)
    print(f'{len(files)} data files here, {fmt(sum(p.stat().st_size for _, p in files))}; hashing...')
    with ThreadPoolExecutor(max(2, a.jobs)) as ex:
        dig = dict(zip([k for k, _ in every], ex.map(lambda kp: digests(kp[1]), every)))
    s3 = client()
    remote = remote_objects(s3)
    todo, skip = [], []
    for key, p in files:
        size = p.stat().st_size
        etag, _ = dig[key]
        have = remote.get(key)
        same = have is not None and have[0] == size and (a.size_only or have[1] == etag)
        (skip if same else todo).append((key, p, size, 'new' if have is None else 'changed'))

    man, problems = ([], []) if a.no_manifests else manifests(a.manifests, {k: (p.stat().st_size, dig[k][1]) for k, p in every})
    man_todo = []
    for key, body in man:
        have = remote.get(key)
        if have is None or have[1] != hashlib.md5(body).hexdigest():
            man_todo.append((key, body))

    up_bytes = sum(s for _, _, s, _ in todo)
    print(f'to send: {len(todo)} files, {fmt(up_bytes)} | already there: {len(skip)} files, {fmt(sum(s for _, _, s, _ in skip))}')
    for key, _, size, why in todo[:40]:
        print(f'  {why:<7} {fmt(size):>9}  {key}')
    if len(todo) > 40:
        print(f'  ... and {len(todo) - 40} more')
    if not a.no_manifests:
        if problems:
            print(f'manifests NOT sent: {len(problems)} problem(s) with {a.manifests}:')
            for p in problems[:20]:
                print(f'  {p}')
        else:
            print(f'manifests: {len(man_todo)} of {len(man)} to send' + (f' ({", ".join(k[len(PREFIX):] for k, _ in man_todo)})' if man_todo else ''))
    local_keys = {k for k, _ in every} | {k for k, _ in man}
    stale = sorted(k for k in remote if k not in local_keys and (not a.only or k.startswith(PREFIX + a.only)))
    if stale:
        print(f'on R2 with no file here (left alone): {len(stale)}')
        for k in stale[:20]:
            print(f'  {k}')

    if a.dry_run:
        print('dry run: nothing sent')
        return

    cfg = TransferConfig(multipart_threshold=MULTIPART_AT, multipart_chunksize=PART, max_concurrency=4)
    done_bytes = 0
    failed = []

    def send(item):
        key, p, size, _ = item
        s3.upload_file(str(p), BUCKET, key, ExtraArgs={'ContentType': content_type(key), 'CacheControl': CACHE_DATA, 'Metadata': {'sha16': dig[key][1]}}, Config=cfg)
        return key, size

    with ThreadPoolExecutor(max(1, a.jobs)) as ex:
        futs = {ex.submit(send, it): it for it in todo}
        for i, f in enumerate(as_completed(futs), 1):
            key = futs[f][0]
            try:
                _, size = f.result()
                done_bytes += size
                print(f'  [{i}/{len(todo)}] {fmt(done_bytes)} / {fmt(up_bytes)}  {key}', flush=True)
            except Exception as e:  # noqa: BLE001
                failed.append(key)
                print(f'  FAILED {key}: {e}', flush=True)

    if failed:
        print(f'{len(failed)} uploads failed; manifests held back. Run again.')
        sys.exit(1)
    if not a.no_manifests and not problems:
        for key, body in man_todo:
            s3.put_object(Bucket=BUCKET, Key=key, Body=body, ContentType='application/json', CacheControl=CACHE_MANIFEST)
            print(f'  manifest {key}')
    secs = time.time() - t0
    print(f'sent {len(todo)} files ({fmt(done_bytes)}) and {0 if problems else len(man_todo)} manifests in {secs:.0f} s; {len(skip)} already there')
    verify([k for k, _ in every] + [k for k, _ in man], a.verify)
    if problems and not a.no_manifests:
        sys.exit(2)


if __name__ == '__main__':
    main()
