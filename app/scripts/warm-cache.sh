#!/usr/bin/env bash
# After a deploy: purge Cloudflare's cache for hunt.groundwind.app (when a
# token is given) and fetch the cold-open files through it, so the first
# phone to open the app finds the bundle and the area grids already at the
# edge. Cloudflare caches per data centre; with Smart Tiered Cache on, a warm
# from anywhere fills the upper tier for a region. The map's tiles are not
# fetched: they are range-read and too many.
#   CF_CACHE_TOKEN   a token with Cache Purge on the zone (optional)
#   CF_ZONE_ID       the zone (optional with the token; groundwind.app's by default)
#   WARM_DATA        where the area data is served, as the build's
#                    VITE_DATA_BASE less its trailing slash: R2's
#                    https://data.groundwind.app/data once the app reads it
#                    there; the app's own $HOST/data by default. It is in the
#                    same zone, so the purge above clears it too. The data
#                    host's edge keeps a file only with a cache rule for it
#                    (cf-cache-status DYNAMIC means it fetched from R2 again).
set -u
HOST="${WARM_HOST:-https://hunt.groundwind.app}"
DATA="${WARM_DATA:-$HOST/data}"
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
# the grids the first view reads (the HD and SD wind, the habitat), then the going grid
echo "warming $DATA"
for a in "$ROOT"/app/src/areas/*.json; do
  id=$(grep -o -E '"id": *"[^"]+"' "$a" | head -1 | cut -d'"' -f4)
  base=$(grep -o -E '"base": *"[^"]*"' "$a" | head -1 | cut -d'"' -f4)
  grids=$(tr -d '\n\r' < "$a" | grep -o -E '"grids": *\[[^]]*\]' | head -1)
  for g in micro micro-sd habitat going; do
    case "$grids" in *"\"$g\""*) fetch "$DATA/${base}${g}-${id}.hab";; esac
  done
done
