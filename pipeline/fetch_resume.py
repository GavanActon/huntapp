"""Resumable HTTP download: this network drops long transfers, so a big file
is pulled in 4 MB Range requests with retries until the byte count matches."""

from __future__ import annotations

import sys
import time
from pathlib import Path

import requests

CHUNK = 4 * 1024 * 1024


def download(url: str, dest: Path, chunk: int = CHUNK) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    head = requests.head(url, timeout=60, allow_redirects=True)
    head.raise_for_status()
    total = int(head.headers["content-length"])
    if dest.exists() and dest.stat().st_size == total:
        return dest
    part = dest.with_suffix(dest.suffix + ".part")
    have = part.stat().st_size if part.exists() else 0
    with open(part, "ab") as f:
        while have < total:
            end = min(have + chunk, total) - 1
            for attempt in range(8):
                try:
                    r = requests.get(url, headers={"Range": f"bytes={have}-{end}"}, timeout=120)
                    r.raise_for_status()
                    f.write(r.content)
                    have += len(r.content)
                    break
                except Exception as e:  # noqa: BLE001
                    print(f"  retry {attempt + 1} at {have / 1e6:.0f} MB: {e}")
                    time.sleep(2 * (attempt + 1))
            else:
                raise SystemExit("download failed")
            print(f"  {have / 1e6:.0f} / {total / 1e6:.0f} MB")
    part.rename(dest)
    return dest


if __name__ == "__main__":
    download(sys.argv[1], Path(sys.argv[2]))
