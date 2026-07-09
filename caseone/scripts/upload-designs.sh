#!/usr/bin/env bash
# Uploads the 48 design PNGs (assets/designs/) to Wix Media via the
# generate-upload-url flow, recording each file's permanent wixstatic URL in
# seed-artifacts/media-map.json. Idempotent: re-running skips any basename
# already present in the map, so a partial/interrupted run can be resumed.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CASEONE_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(dirname "$CASEONE_DIR")"

DESIGNS_DIR="$REPO_ROOT/assets/designs"
SEED_ARTIFACTS_DIR="$CASEONE_DIR/seed-artifacts"
MEDIA_MAP="$SEED_ARTIFACTS_DIR/media-map.json"

if [[ -z "${TOKEN:-}" || -z "${SITE_ID:-}" ]]; then
  # shellcheck disable=SC1091
  source "$SEED_ARTIFACTS_DIR/env.sh"
fi

if [[ ! -f "$MEDIA_MAP" ]]; then
  echo '{}' > "$MEDIA_MAP"
fi

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

failures=0

for filepath in "$DESIGNS_DIR"/*.png; do
  filename="$(basename "$filepath")"
  basename="${filename%.png}"

  if jq -e --arg k "$basename" 'has($k)' "$MEDIA_MAP" > /dev/null; then
    echo "skip (already uploaded): $basename"
    continue
  fi

  size_in_bytes=$(stat -f%z "$filepath" 2>/dev/null || stat -c%s "$filepath")

  gen_response="$WORK_DIR/gen.json"
  http_status=$(curl -sS -X POST 'https://www.wixapis.com/site-media/v1/files/generate-upload-url' \
    -H "Authorization: Bearer $TOKEN" \
    -H "wix-site-id: $SITE_ID" \
    -H 'Content-Type: application/json' \
    --data-raw "{\"mimeType\":\"image/png\",\"fileName\":\"$filename\",\"sizeInBytes\":\"$size_in_bytes\",\"private\":false}" \
    -o "$gen_response" -w '%{http_code}')

  if [[ "$http_status" != "200" ]]; then
    echo "ERROR: generate-upload-url failed for $basename (HTTP $http_status): $(cat "$gen_response")" >&2
    failures=$((failures + 1))
    continue
  fi

  upload_url=$(jq -r '.uploadUrl' "$gen_response")
  if [[ -z "$upload_url" || "$upload_url" == "null" ]]; then
    echo "ERROR: no uploadUrl returned for $basename: $(cat "$gen_response")" >&2
    failures=$((failures + 1))
    continue
  fi

  put_response="$WORK_DIR/put.json"
  http_status=$(curl -sS -X PUT "${upload_url}?filename=${filename}" \
    -H 'Content-Type: image/png' \
    --data-binary "@$filepath" \
    -o "$put_response" -w '%{http_code}')

  if [[ "$http_status" != "200" ]]; then
    echo "ERROR: upload failed for $basename (HTTP $http_status): $(cat "$put_response")" >&2
    failures=$((failures + 1))
    continue
  fi

  file_url=$(jq -r '.file.url' "$put_response")
  if [[ -z "$file_url" || "$file_url" == "null" ]]; then
    echo "ERROR: no file.url returned for $basename: $(cat "$put_response")" >&2
    failures=$((failures + 1))
    continue
  fi

  tmp_map="$WORK_DIR/media-map.json"
  jq --arg k "$basename" --arg url "$file_url" '.[$k] = {"url": $url}' "$MEDIA_MAP" > "$tmp_map"
  mv "$tmp_map" "$MEDIA_MAP"

  echo "uploaded: $basename -> $file_url"
done

if [[ "$failures" -gt 0 ]]; then
  echo "Completed with $failures failure(s). Re-run the script to retry the missing basenames." >&2
  exit 1
fi

echo "All designs uploaded successfully."
