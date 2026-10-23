"""A work queue kept in R2, for any machine on any network (Gavan, 2026-10-23: "instead of reading a
file list, why not just queue everything in r2?", and "one day we'll use this approach for HD bakes as
well").

Lists cut by hand for each machine baked ~3,000 SD tiles twice while XEVO and xonix were apart (10-19 to
22), and a queue on XEVO's share needs both machines on one network. R2 is wherever the uploads are, and it
refuses a write that loses a race: a PUT with If-None-Match: * fails (412) when the key is there already,
and one with If-Match: <etag> fails when the object changed since it was read. Those two make a claim safe.

    queue/<name>/meta.json       {"leaseSeconds": ...}: how long a claim holds without a renewal
    queue/<name>/order.txt       the items, best first, one id a line (anything after a tab is a note)
    queue/<name>/claims/<id>     held by the machine that wrote it, until the lease runs out
    queue/<name>/done/<id>       finished: never handed out again
    queue/<name>/PAUSE           while it is there, nothing new is handed out

A machine claims an item by creating its claim (If-None-Match: *). A claim past its lease is taken over by
replacing it with If-Match on the ETag the listing showed, so two machines can't both take it over. Long
work renews its claim (If-Match on its own last ETag). Done writes done/<id>, then rewrites the claim as
done: a claim is never deleted when its item is finished, so a machine working from an older listing
can't create it afresh (deleting it handed one item out nine times over in the first test). An item that
keeps failing is left to its lease: after that another machine, or the same one, tries it again.

    py -3.14 pipeline/r2_queue.py order sd-v1 FILE... [--lease 3600] [--skip-present data/sd/v1/{id}.hab]
    py -3.14 pipeline/r2_queue.py status sd-v1
    py -3.14 pipeline/r2_queue.py pause sd-v1          (and resume)

The SD tiles: wind_tiles.py bake --r2-queue sd-v1 (docs/SD-FAST.md). A WindNinja direction or a PALM run
takes hours: the same queue with a longer lease and renew() as it goes.
"""

from __future__ import annotations

import argparse
import json
import os
import socket
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "app" / "scripts"))
import r2_sync  # noqa: E402  (the R2 client and keys)

LEASE = 3600  # seconds a claim holds when the queue's meta.json names none
REFRESH = 120  # seconds between listings of the claims and the done items
ORDER_EVERY = 600  # seconds between reads of the order, so a re-ranking takes hold while machines run


def _refused(e: Exception) -> bool:
    """R2 turned the write away because someone else got there first (412), or because others are
    writing the same key that very moment (503, "Reduce your concurrent request rate for the same
    object", seen with 16 threads on one item): either way it is not ours."""
    r = getattr(e, "response", None) or {}
    code = r.get("Error", {}).get("Code")
    return code in ("PreconditionFailed", "412", "ServiceUnavailable", "SlowDown") or r.get("ResponseMetadata", {}).get("HTTPStatusCode") in (412, 503)


def host_name() -> str:
    return (os.environ.get("COMPUTERNAME") or socket.gethostname()).lower()


class Queue:
    def __init__(self, name: str, host: str | None = None):
        self.name = name
        self.p = f"queue/{name}/"
        self.host = host or host_name()
        self.s3 = r2_sync.client()
        self.bucket = r2_sync.BUCKET
        try:
            meta = json.loads(self._get("meta.json"))
        except Exception:  # noqa: BLE001  (no meta: the default lease)
            meta = {}
        self.lease = int(meta.get("leaseSeconds", LEASE))
        self._order: list[str] = []
        self._order_at = 0.0
        self._claims: dict[str, tuple[str, float]] = {}  # id: (ETag, written at)
        self._done: set[str] = set()
        self._seen_at = 0.0
        self._paused = False
        self.mine: dict[str, str] = {}  # id: the ETag of this machine's claim

    # ---- R2
    def _get(self, rel: str) -> bytes:
        return self.s3.get_object(Bucket=self.bucket, Key=self.p + rel)["Body"].read()

    def _list(self, sub: str) -> dict[str, tuple[str, float]]:
        out = {}
        for page in self.s3.get_paginator("list_objects_v2").paginate(Bucket=self.bucket, Prefix=self.p + sub):
            for o in page.get("Contents", []):
                out[o["Key"][len(self.p + sub):]] = (o["ETag"], o["LastModified"].timestamp())
        return out

    def _body(self) -> bytes:
        return json.dumps({"host": self.host, "at": round(time.time())}).encode()

    # ---- what there is
    def order(self) -> list[str]:
        if not self._order or time.time() - self._order_at > ORDER_EVERY:
            text = self._get("order.txt").decode("utf-8")
            self._order = [ln.split("\t")[0].strip() for ln in text.splitlines() if ln.strip() and not ln.startswith("#")]
            self._order_at = time.time()
        return self._order

    def refresh(self, force: bool = False) -> None:
        if not force and time.time() - self._seen_at < REFRESH:
            return
        self._claims = self._list("claims/")
        self._done = set(self._list("done/"))
        try:
            self.s3.head_object(Bucket=self.bucket, Key=self.p + "PAUSE")
            self._paused = True
        except Exception:  # noqa: BLE001  (no PAUSE object)
            self._paused = False
        self._seen_at = time.time()

    def paused(self) -> bool:
        self.refresh()
        return self._paused

    def held(self, item: str) -> bool:
        """Someone's claim on it is still within its lease."""
        c = self._claims.get(item)
        return c is not None and c[1] + self.lease > time.time()

    # ---- taking, keeping, finishing
    def claim(self, item: str) -> bool:
        key = self.p + "claims/" + item
        cur = self._claims.get(item)
        if cur is not None and cur[1] + self.lease <= time.time():
            # a lapsed claim: finished since the listing? (done/ is written before the claim is rewritten)
            try:
                self.s3.head_object(Bucket=self.bucket, Key=self.p + "done/" + item)
                self._done.add(item)
                return False
            except Exception:  # noqa: BLE001  (not done: take it over)
                pass
        try:
            if cur is None:
                r = self.s3.put_object(Bucket=self.bucket, Key=key, Body=self._body(), ContentType="application/json", IfNoneMatch="*")
            elif cur[1] + self.lease <= time.time():
                r = self.s3.put_object(Bucket=self.bucket, Key=key, Body=self._body(), ContentType="application/json", IfMatch=cur[0])
            else:
                return False
        except Exception as e:  # noqa: BLE001
            if _refused(e):  # another machine was first: it is theirs now
                self._claims[item] = ("", time.time())
                return False
            raise
        self.mine[item] = r["ETag"]
        self._claims[item] = (r["ETag"], time.time())
        return True

    def renew(self, item: str) -> bool:
        """Keep a long item: False when the claim ran out and another machine took it over."""
        try:
            r = self.s3.put_object(Bucket=self.bucket, Key=self.p + "claims/" + item, Body=self._body(), ContentType="application/json", IfMatch=self.mine[item])
        except Exception as e:  # noqa: BLE001
            if _refused(e):
                self.mine.pop(item, None)
                return False
            raise
        self.mine[item] = r["ETag"]
        return True

    def done(self, item: str) -> None:
        try:
            self.s3.put_object(Bucket=self.bucket, Key=self.p + "done/" + item, Body=self._body(), ContentType="application/json", IfNoneMatch="*")
        except Exception as e:  # noqa: BLE001
            if not _refused(e):  # done already, by another machine too: fine
                raise
        self._done.add(item)
        etag = self.mine.pop(item, None)
        if etag is not None:
            # the claim stays, rewritten as done (never deleted: see the module's note)
            body = json.dumps({"host": self.host, "at": round(time.time()), "done": True}).encode()
            try:
                self.s3.put_object(Bucket=self.bucket, Key=self.p + "claims/" + item, Body=body, ContentType="application/json", IfMatch=etag)
            except Exception as e:  # noqa: BLE001
                if not _refused(e):
                    raise

    def release(self, item: str) -> None:
        """Give an item back at once, unfinished (the claim dropped). Only this machine's own claim."""
        if self.mine.pop(item, None) is not None:
            try:
                self.s3.delete_object(Bucket=self.bucket, Key=self.p + "claims/" + item)
            except Exception:  # noqa: BLE001  (its lease runs out instead)
                pass
            self._claims.pop(item, None)

    def next(self, skip=lambda item: False) -> str | None:
        """The best item nobody holds or has finished, claimed for this machine; None when there is
        none (or the queue is paused). `skip` leaves out what the caller knows is done already."""
        if self.paused():
            return None
        for item in self.order():
            if item in self._done or self.held(item) or skip(item):
                continue
            if self.claim(item):
                return item
        return None


# ---- the command line
def cmd_order(a) -> None:
    seen, items = set(), []
    for f in a.files:
        for ln in Path(f).read_text(encoding="utf-8").splitlines():
            item = ln.split("\t")[0].strip()
            if item and not item.startswith("#") and item not in seen:
                seen.add(item)
                items.append(ln.rstrip())
    s3 = r2_sync.client()
    if a.skip_present:
        # what is on R2 already is not work: the listing of the folder the template points into
        folder = a.skip_present.split("{id}")[0]
        have = set()
        for page in s3.get_paginator("list_objects_v2").paginate(Bucket=r2_sync.BUCKET, Prefix=folder):
            have.update(o["Key"] for o in page.get("Contents", []))
        before = len(items)
        items = [ln for ln in items if a.skip_present.replace("{id}", ln.split("\t")[0].strip()) not in have]
        print(f"{before - len(items)} already on R2 left out")
    p = f"queue/{a.name}/"
    s3.put_object(Bucket=r2_sync.BUCKET, Key=p + "order.txt", Body=("\n".join(items) + "\n").encode(), ContentType="text/plain; charset=utf-8", CacheControl="no-cache")
    s3.put_object(Bucket=r2_sync.BUCKET, Key=p + "meta.json", ContentType="application/json",
                  Body=json.dumps({"leaseSeconds": a.lease, "orderFrom": [Path(f).name for f in a.files], "by": host_name(), "at": round(time.time())}).encode())
    print(f"queue {a.name}: {len(items)} items in order, a claim holds {a.lease} s")


def cmd_status(a) -> None:
    q = Queue(a.name)
    q.refresh(force=True)
    order = q.order()
    live = {k: v for k, v in q._claims.items() if k not in q._done and v[1] + q.lease > time.time()}
    lapsed = sum(1 for k, v in q._claims.items() if k not in q._done and v[1] + q.lease <= time.time())
    by: dict[str, int] = {}
    for k in live:
        try:
            h = json.loads(q._get("claims/" + k)).get("host", "?")
        except Exception:  # noqa: BLE001  (finished between the listing and the read)
            continue
        by[h] = by.get(h, 0) + 1
    left = sum(1 for i in order if i not in q._done and i not in live)
    print(f"queue {a.name}: {len(order)} in order, {len(q._done)} done, {len(live)} held {by or ''}, "
          f"{lapsed} lapsed claims, {left} left{' · PAUSED' if q._paused else ''} (a claim holds {q.lease} s)")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    o = sub.add_parser("order", help="write the queue's order (and its lease) from one or more list files, best first")
    o.add_argument("name")
    o.add_argument("files", nargs="+")
    o.add_argument("--lease", type=int, default=LEASE)
    o.add_argument("--skip-present", help="an R2 key with {id}: items whose key is there already are left out")
    for c in ("status", "pause", "resume"):
        sub.add_parser(c).add_argument("name")
    a = ap.parse_args()
    if a.cmd == "order":
        cmd_order(a)
    elif a.cmd == "status":
        cmd_status(a)
    elif a.cmd in ("pause", "resume"):
        s3, key = r2_sync.client(), f"queue/{a.name}/PAUSE"
        if a.cmd == "pause":
            s3.put_object(Bucket=r2_sync.BUCKET, Key=key, Body=f"paused by {host_name()} {time.ctime()}".encode())
        else:
            s3.delete_object(Bucket=r2_sync.BUCKET, Key=key)
        print(f"queue {a.name}: {a.cmd}d")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
