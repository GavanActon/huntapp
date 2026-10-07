#!/usr/bin/env bash
# After a deploy: purge Cloudflare's cache for hunt.groundwind.app (when a
# token is given) and fetch the cold-open files through it, so the first
# phone to open the app finds the bundle and the area grids already at the
# edge. Cloudflare caches per data centre; with Smart Tiered Cache on, a warm
# from anywhere fills the upper tier for a region. The map's tiles are not
# fetched: they are range-read and too many.
#   CF_CACHE_TOKEN   a token with Cache Purge on the zone (optional)
#   CF_ZONE_ID       the zone (optional with the token; groundwind.app's by default)
set -u
HOST="${WARM_HOST:-https://hunt.groundwind.app}"
ZONE="${CF_ZONE_ID:-c22ad859df4f4831b2b935792ada8ce4}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

if [ -n "${CF_CACHE_TOKEN:-}" ]; then
  r=$(curl -s -X POST -H "Authorization: Bearer $CF_CACHE_TOKEN" -H "Content-Type: application/json" \
    "https://api.cloudflare.com/client/v4/zones/$ZONE/purge_cache" --data '{"purge_everything":true}')
  case "$r" in *'"success":true'*) echo "purged the zone's cache";; *) echo "purge failed: $r";; esac
  sleep 5
else
  echo "no CF_CACHE_TOKEN: not purging, warming only"
fi

fetch() {
  local url="$1"
  local out
  out=$(curl -s -o /dev/null -w "%{http_code} %{size_download} %{time_total}" -D - "$url" | awk 'BEGIN{cf="-"} tolower($1)=="cf-cache-status:"{cf=$2} /^[0-9]+ [0-9]+ [0-9.]+$/{code=$1; size=$2; t=$3} END{printf "%s %9s B %6.2fs %s\n", code, size, t, cf}')
  echo "  $out  $url"
}

echo "warming $HOST"
index=$(curl -s "$HOST/")
fetch "$HOST/"
for p in $(printf '%s' "$index" | grep -o -E '(src|href)="/[^"]+"' | cut -d'"' -f2 | sort -u); do
  fetch "$HOST$p"
done
for p in /manifest.webmanifest /sw.js; do
  fetch "$HOST$p"
done
for a in "$ROOT"/app/src/areas/*.json; do
  id=$(grep -o -E '"id": *"[^"]+"' "$a" | head -1 | cut -d'"' -f4)
  base=$(grep -o -E '"base": *"[^"]*"' "$a" | head -1 | cut -d'"' -f4)
  for g in micro habitat going; do
    fetch "$HOST/data/${base}${g}-${id}.hab"
  done
done
