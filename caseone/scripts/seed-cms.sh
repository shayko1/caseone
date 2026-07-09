#!/usr/bin/env bash
# Seeds the CASEONE Wix CMS (Wix Data v2): styles (12), designs (48), gallery (8).
# Re-runnable: skips collection-create if the collection already exists, and skips
# a collection's bulk-insert if it already holds >= the expected item count.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CASEONE_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ARTIFACTS_DIR="$CASEONE_DIR/seed-artifacts"

# shellcheck disable=SC1091
source "$ARTIFACTS_DIR/env.sh"

BASE="https://www.wixapis.com/wix-data/v2"
AUTH_HEADERS=(-H "Authorization: Bearer $TOKEN" -H "wix-site-id: $SITE_ID" -H "Content-Type: application/json")

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

log() { echo "[seed-cms] $*"; }

# ---------------------------------------------------------------------------
# STEP 0: build the item payloads from media-map.json + this script's data
# ---------------------------------------------------------------------------
python3 - "$ARTIFACTS_DIR/media-map.json" "$TMP_DIR" <<'PYEOF'
import json, sys

media_map_path, out_dir = sys.argv[1], sys.argv[2]
media_map = json.load(open(media_map_path))

STYLES = [
    ("Cyberpunk", "cyberpunk", "#D627E0",
     "Neon-lit circuitry, holographic chrome, and glitching data streams for a high-voltage digital edge."),
    ("Minimal Luxury", "minimal-luxury", "#C9A24B",
     "Brushed gold arcs, embossed lines, and quiet negative space for understated elegance."),
    ("Anime", "anime", "#F2A3C0",
     "Cel-shaded skies, sakura petals, and stylized cityscapes with soft painterly warmth."),
    ("Streetwear", "streetwear", "#FF5A47",
     "Torn-paper collage, halftone dots, and spray-stencil textures with raw urban edge."),
    ("Marble", "marble", "#2E6B5A",
     "Carrara, emerald, and Marquina stone veining polished to a luxe high-gloss finish."),
    ("Floral", "floral", "#C4526B",
     "Botanical blooms, watercolor wildflowers, and pressed petals in moody-to-airy palettes."),
    ("Abstract", "abstract", "#1FB6A6",
     "Flowing gradients, translucent glass shapes, and Bauhaus geometry in soft saturated tones."),
    ("Graffiti", "graffiti", "#FF3D8A",
     "Wildstyle spray bursts, drippy splashes, and bubble throw-ups straight off the wall."),
    ("Vintage", "vintage", "#C86A3C",
     "70s sunset stripes, faded wallpaper florals, and tea-stained retro geometry."),
    ("Y2K", "y2k", "#B48CF0",
     "Chrome liquid blobs, iridescent sparkle, and jelly-shine plastic in candy pastels."),
    ("Futuristic", "futuristic", "#3FBFD0",
     "Concentric light rings, parametric mesh, and brushed titanium sci-fi calm."),
    ("Photo Collage", "photo-collage", "#7A8BA3",
     "Analog film grain, Polaroid frames, and scrapbook textures in warm nostalgic layers."),
]

# 3 comma-separated tag words per design, drawn from its manifest prompt.
TAGS = {
    "cyberpunk-01": "neon, circuitry, cyan",
    "cyberpunk-02": "chrome, holographic, neon",
    "cyberpunk-03": "glitch, ultraviolet, data",
    "cyberpunk-04": "koi, digital, neon",
    "minimal-luxury-01": "gold, minimal, ivory",
    "minimal-luxury-02": "embossed, champagne, elegant",
    "minimal-luxury-03": "matte, wave, minimal",
    "minimal-luxury-04": "travertine, gold, texture",
    "anime-01": "anime, sunset, clouds",
    "anime-02": "sakura, pastel, petals",
    "anime-03": "cityscape, retro, dusk",
    "anime-04": "wave, ukiyo, ocean",
    "streetwear-01": "collage, coral, raw",
    "streetwear-02": "halftone, concrete, monochrome",
    "streetwear-03": "skate, teal, layered",
    "streetwear-04": "stencil, spray, industrial",
    "marble-01": "carrara, veining, gold",
    "marble-02": "emerald, veins, polished",
    "marble-03": "marquina, lightning, gloss",
    "marble-04": "rose, pearl, copper",
    "floral-01": "botanical, moody, blooms",
    "floral-02": "watercolor, wildflowers, airy",
    "floral-03": "tropical, hibiscus, painterly",
    "floral-04": "pressed, dried, linen",
    "abstract-01": "gradient, coral, silky",
    "abstract-02": "glass, translucent, pastel",
    "abstract-03": "bauhaus, geometry, muted",
    "abstract-04": "ink, pigment, plumes",
    "graffiti-01": "wildstyle, spray, chrome",
    "graffiti-02": "drippy, splashes, marker",
    "graffiti-03": "bubble, throw-up, outlines",
    "graffiti-04": "paste-up, urban, patina",
    "vintage-01": "70s, stripes, grainy",
    "vintage-02": "wallpaper, faded, aged",
    "vintage-03": "geometric, retro, terracotta",
    "vintage-04": "map, compass, parchment",
    "y2k-01": "chrome, blobs, glossy",
    "y2k-02": "iridescent, butterfly, sparkle",
    "y2k-03": "jelly, bubblegum, plastic",
    "y2k-04": "pixel, hearts, chrome",
    "futuristic-01": "concentric, silver, sleek",
    "futuristic-02": "parametric, mesh, sci-fi",
    "futuristic-03": "titanium, brushed, glow",
    "futuristic-04": "orbital, sphere, matte",
    "photo-collage-01": "analog, collage, ocean",
    "photo-collage-02": "polaroid, travel, washed",
    "photo-collage-03": "double-exposure, forest, stars",
    "photo-collage-04": "scrapbook, denim, nostalgic",
}

GALLERY = [
    ("cyberpunk-02", "Maya", "Holographic chrome shards over a rain-slick surface, pink and teal neon reflections."),
    ("anime-01", "Kenji", "Dramatic anime sky with towering cumulus clouds at sunset, pink-orange gradient."),
    ("marble-03", "Sofia", "Black Marquina marble with dramatic white lightning veins, high gloss."),
    ("streetwear-04", "Jordan", "Distressed stencil shapes and spray textures, industrial grey with orange hits."),
    ("floral-02", "Elena", "Watercolor wildflowers scattered on warm cream, airy and soft."),
    ("y2k-01", "Zoe", "Chrome liquid blobs on a baby-pink gradient, glossy 2000s cyber aesthetic."),
    ("futuristic-02", "Omar", "Parametric mesh landscape, fine luminous lines, quiet sci-fi elegance."),
    ("photo-collage-01", "Lucas", "Dreamy analog photo collage: ocean, film grain skies, handwritten-feel edges."),
]


ACRONYMS = {"y2k": "Y2K"}


def human_title(slug, num):
    words = slug.split("-")
    name = " ".join(ACRONYMS.get(w, w.capitalize()) for w in words)
    return f"{name} {num}"


styles_items = []
for title, slug, accent, desc in STYLES:
    cover = media_map[f"{slug}-01"]["url"]
    styles_items.append({
        "data": {
            "title": title,
            "slug": slug,
            "description": desc,
            "coverImage": cover,
            "accentColor": accent,
        }
    })

designs_items = []
for basename in sorted(media_map.keys()):
    style_slug, num = basename.rsplit("-", 1)
    designs_items.append({
        "data": {
            "title": human_title(style_slug, num),
            "image": media_map[basename]["url"],
            "styleSlug": style_slug,
            "tags": TAGS[basename],
        }
    })

gallery_items = []
for basename, creator, prompt in GALLERY:
    style_slug, num = basename.rsplit("-", 1)
    gallery_items.append({
        "data": {
            "title": human_title(style_slug, num),
            "image": media_map[basename]["url"],
            "creatorName": creator,
            "promptText": prompt,
            "styleSlug": style_slug,
            "approved": True,
        }
    })

payloads = {
    "styles": {"dataCollectionId": "styles", "dataItems": styles_items, "returnEntity": True},
    "designs": {"dataCollectionId": "designs", "dataItems": designs_items, "returnEntity": True},
    "gallery": {"dataCollectionId": "gallery", "dataItems": gallery_items, "returnEntity": True},
}

for name, payload in payloads.items():
    with open(f"{out_dir}/{name}-items.json", "w") as f:
        json.dump(payload, f)

print(f"styles={len(styles_items)} designs={len(designs_items)} gallery={len(gallery_items)}")
PYEOF

log "built item payloads in $TMP_DIR"

# ---------------------------------------------------------------------------
# STEP 1: create collections (idempotent — skip if already present)
# ---------------------------------------------------------------------------

collection_exists() {
  local id="$1" status
  status=$(curl -s -o /dev/null -w "%{http_code}" -X GET "$BASE/collections/$id" "${AUTH_HEADERS[@]}")
  [[ "$status" == "200" ]]
}

create_collection() {
  local id="$1" body_file="$2" out status
  if collection_exists "$id"; then
    log "collection '$id' already exists — skipping create"
    return 0
  fi
  out="$TMP_DIR/create-$id.json"
  status=$(curl -s -X POST "$BASE/collections" "${AUTH_HEADERS[@]}" -d @"$body_file" -o "$out" -w "%{http_code}")
  if [[ "$status" != "200" && "$status" != "201" ]]; then
    log "create '$id' failed (status $status) — retrying once after a brief pause"
    sleep 3
    status=$(curl -s -X POST "$BASE/collections" "${AUTH_HEADERS[@]}" -d @"$body_file" -o "$out" -w "%{http_code}")
  fi
  if [[ "$status" != "200" && "$status" != "201" ]]; then
    log "ERROR: create '$id' failed (status $status)"
    cat "$out"
    exit 1
  fi
  log "created collection '$id' (status $status)"
}

cat > "$TMP_DIR/create-styles.json" <<'EOF'
{
  "collection": {
    "id": "styles",
    "displayName": "Styles",
    "fields": [
      { "key": "title", "displayName": "Title", "type": "TEXT" },
      { "key": "slug", "displayName": "Slug", "type": "TEXT" },
      { "key": "description", "displayName": "Description", "type": "TEXT" },
      { "key": "coverImage", "displayName": "Cover Image", "type": "TEXT" },
      { "key": "accentColor", "displayName": "Accent Color", "type": "TEXT" }
    ],
    "permissions": { "insert": "ADMIN", "update": "ADMIN", "remove": "ADMIN", "read": "ANYONE" }
  }
}
EOF

cat > "$TMP_DIR/create-designs.json" <<'EOF'
{
  "collection": {
    "id": "designs",
    "displayName": "Designs",
    "fields": [
      { "key": "title", "displayName": "Title", "type": "TEXT" },
      { "key": "image", "displayName": "Image", "type": "TEXT" },
      { "key": "styleSlug", "displayName": "Style Slug", "type": "TEXT" },
      { "key": "tags", "displayName": "Tags", "type": "TEXT" }
    ],
    "permissions": { "insert": "ADMIN", "update": "ADMIN", "remove": "ADMIN", "read": "ANYONE" }
  }
}
EOF

cat > "$TMP_DIR/create-gallery.json" <<'EOF'
{
  "collection": {
    "id": "gallery",
    "displayName": "Gallery",
    "fields": [
      { "key": "title", "displayName": "Title", "type": "TEXT" },
      { "key": "image", "displayName": "Image", "type": "TEXT" },
      { "key": "creatorName", "displayName": "Creator Name", "type": "TEXT" },
      { "key": "promptText", "displayName": "Prompt Text", "type": "TEXT" },
      { "key": "styleSlug", "displayName": "Style Slug", "type": "TEXT" },
      { "key": "approved", "displayName": "Approved", "type": "BOOLEAN" }
    ],
    "permissions": { "insert": "ADMIN", "update": "ADMIN", "remove": "ADMIN", "read": "ANYONE" }
  }
}
EOF

create_collection "styles" "$TMP_DIR/create-styles.json"
create_collection "designs" "$TMP_DIR/create-designs.json"
create_collection "gallery" "$TMP_DIR/create-gallery.json"

# ---------------------------------------------------------------------------
# STEP 2: bulk-insert items (idempotent — skip if collection already has >= expected count)
# ---------------------------------------------------------------------------

item_count() {
  local id="$1" out
  out="$TMP_DIR/count-$id.json"
  curl -s -X POST "$BASE/items/query" "${AUTH_HEADERS[@]}" \
    -d "{\"dataCollectionId\":\"$id\",\"query\":{\"paging\":{\"limit\":200}}}" -o "$out"
  python3 -c "
import json
d = json.load(open('$out'))
print(len(d.get('dataItems', d.get('items', []))))
"
}

bulk_insert() {
  local id="$1" body_file="$2" expected="$3" out status current
  current=$(item_count "$id")
  if [[ "$current" -ge "$expected" ]]; then
    log "collection '$id' already has $current items (expected $expected) — skipping insert"
    return 0
  fi
  out="$TMP_DIR/insert-$id.json"
  status=$(curl -s -X POST "$BASE/bulk/items/insert" "${AUTH_HEADERS[@]}" -d @"$body_file" -o "$out" -w "%{http_code}")
  if [[ "$status" != "200" ]]; then
    log "insert '$id' failed (status $status) — retrying once after a brief pause"
    sleep 3
    status=$(curl -s -X POST "$BASE/bulk/items/insert" "${AUTH_HEADERS[@]}" -d @"$body_file" -o "$out" -w "%{http_code}")
  fi
  if [[ "$status" != "200" ]]; then
    log "ERROR: insert '$id' failed (status $status)"
    cat "$out"
    exit 1
  fi
  local failures
  failures=$(python3 -c "import json; print(json.load(open('$out')).get('bulkActionMetadata', {}).get('totalFailures', 0))")
  if [[ "$failures" != "0" ]]; then
    log "ERROR: insert '$id' had $failures failures"
    cat "$out"
    exit 1
  fi
  log "inserted items into '$id' (status $status, 0 failures)"
}

bulk_insert "styles" "$TMP_DIR/styles-items.json" 12
bulk_insert "designs" "$TMP_DIR/designs-items.json" 48
bulk_insert "gallery" "$TMP_DIR/gallery-items.json" 8

# ---------------------------------------------------------------------------
# STEP 3: verify counts and write seed-artifacts/cms.json
# ---------------------------------------------------------------------------

STYLES_COUNT=$(item_count "styles")
DESIGNS_COUNT=$(item_count "designs")
GALLERY_COUNT=$(item_count "gallery")

log "verified counts — styles=$STYLES_COUNT designs=$DESIGNS_COUNT gallery=$GALLERY_COUNT"

if [[ "$STYLES_COUNT" != "12" || "$DESIGNS_COUNT" != "48" || "$GALLERY_COUNT" != "8" ]]; then
  log "ERROR: counts do not match expected 12/48/8"
  exit 1
fi

cat > "$ARTIFACTS_DIR/cms.json" <<EOF
{"collections":["styles","designs","gallery"],"counts":{"styles":$STYLES_COUNT,"designs":$DESIGNS_COUNT,"gallery":$GALLERY_COUNT}}
EOF

log "wrote $ARTIFACTS_DIR/cms.json"
log "done."
