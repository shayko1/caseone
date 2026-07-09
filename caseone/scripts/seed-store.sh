#!/usr/bin/env bash
# Seeds the CASEONE "Custom Case" Stores product (Catalog V3), per
# references/inline-recipes/setup-online-store.md.
#
# Usage:
#   source caseone/seed-artifacts/env.sh   # provides $TOKEN, $SITE_ID
#   bash caseone/scripts/seed-store.sh
#
# Steps (mirrors the recipe's mandatory order):
#   1. Clean  — query existing products, bulk-delete the install's sample
#      products so they never linger next to ours.
#   2. Create — POST one product to the bulk create-with-inventory endpoint:
#      options "iPhone Model" (15 / 15 Pro / 16 / 16 Pro / 16 Pro Max) x
#      "Finish" (Matte / Glossy / Leather) = 15 variants, base $59.00, all
#      Leather variants $79.00. Also defines one FREE_TEXT modifier ("Design
#      Notes") so the Studio checkout flow (Task 11) can carry the generated
#      design + personalization on the cart line item. Catalog V3 generates
#      modifiers[].freeTextSettings.key from the title verbatim — as of this
#      writing that resolves to the literal string "Design notes" (confirmed
#      live against productId e70e8dde-caef-4001-a980-f44ebe1ee6ac via GET
#      product); re-verify after any re-run before wiring
#      catalogReference.options.customTextFields to it. Text-only at create
#      time (media added next).
#   3. Images — GET the product for revision+options+variantsInfo, echo them
#      back in a PATCH that sets media.itemsInfo.items to 3 image URLs
#      (futuristic-01, marble-01, y2k-02). Confirm via media.main, since
#      itemsInfo is write-only and reads back null (expected).
#   4. Verify — GET the product and assert 15 variants with the right prices.
#
# Writes caseone/seed-artifacts/product.json =
#   { "productId": "<id>", "optionNames": { "model": "iPhone Model", "finish": "Finish" } }

set -euo pipefail

: "${TOKEN:?TOKEN not set - source caseone/seed-artifacts/env.sh first}"
: "${SITE_ID:?SITE_ID not set - source caseone/seed-artifacts/env.sh first}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ARTIFACTS_DIR="$(cd "$SCRIPT_DIR/../seed-artifacts" && pwd)"
MEDIA_MAP="$ARTIFACTS_DIR/media-map.json"
PRODUCT_JSON="$ARTIFACTS_DIR/product.json"

PRODUCTS_API="https://www.wixapis.com/stores/v3/products"
QUERY_API="https://www.wixapis.com/stores/v3/products/query"
BULK_DELETE_API="https://www.wixapis.com/stores/v3/bulk/products/delete"
BULK_CREATE_API="https://www.wixapis.com/stores/v3/bulk/products-with-inventory/create"

PRODUCT_NAME="CASEONE Custom Case"
OPTION_MODEL_NAME="iPhone Model"
OPTION_FINISH_NAME="Finish"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

curl_json() {
  # curl_json <method> <url> [body-file]
  # Writes body to $TMP_DIR/resp.json, returns the HTTP status on stdout.
  local method="$1" url="$2" body_file="${3:-}"
  local args=(-sS -X "$method" "$url" \
    -H "Authorization: Bearer $TOKEN" \
    -H "wix-site-id: $SITE_ID" \
    -H "Content-Type: application/json" \
    -o "$TMP_DIR/resp.json" \
    -w '%{http_code}')
  if [[ -n "$body_file" ]]; then
    args+=(--data-binary "@$body_file")
  fi
  curl "${args[@]}"
}

echo "== STEP 1: clean pre-existing (sample) products =="
list_body="$TMP_DIR/list.json"
echo '{"query":{"paging":{"limit":50}}}' > "$list_body"
status=$(curl_json POST "$QUERY_API" "$list_body")
if [[ "$status" != "200" ]]; then
  echo "Query products failed (HTTP $status):" >&2
  cat "$TMP_DIR/resp.json" >&2
  exit 1
fi
existing_ids=$(jq -r '.products[].id' "$TMP_DIR/resp.json")
if [[ -z "$existing_ids" ]]; then
  echo "No pre-existing products — clean no-op."
else
  echo "Deleting pre-existing product ids: $(echo "$existing_ids" | tr '\n' ' ')"
  del_body="$TMP_DIR/delete.json"
  jq -n --argjson ids "$(jq -R -s -c 'split("\n") | map(select(length > 0))' <<< "$existing_ids")" \
    '{productIds: $ids}' > "$del_body"
  status=$(curl_json POST "$BULK_DELETE_API" "$del_body")
  if [[ "$status" != "200" ]]; then
    echo "Bulk delete failed (HTTP $status):" >&2
    cat "$TMP_DIR/resp.json" >&2
    exit 1
  fi
fi

echo "== STEP 2: create \"$PRODUCT_NAME\" (5 models x 3 finishes = 15 variants) =="

create_body="$TMP_DIR/create.json"
jq -n \
  --arg name "$PRODUCT_NAME" \
  --arg optModel "$OPTION_MODEL_NAME" \
  --arg optFinish "$OPTION_FINISH_NAME" \
  --argjson models '["15", "15 Pro", "16", "16 Pro", "16 Pro Max"]' \
  --argjson finishes '["Matte", "Glossy", "Leather"]' \
  '{
    products: [
      {
        name: $name,
        productType: "PHYSICAL",
        physicalProperties: {},
        visible: true,
        visibleInPos: true,
        description: {
          nodes: [
            { type: "PARAGRAPH", id: "caseone-desc-p1",
              nodes: [{ type: "TEXT", textData: { text: "Your design, engineered to last. Every CASEONE Custom Case is precision-molded from durable polycarbonate and a shock-absorbing TPU liner, rated for drop protection up to 6 feet — so the one-of-a-kind case you designed stays exactly the way you made it." } }],
              paragraphData: { textStyle: { textAlignment: "AUTO" } } },
            { type: "PARAGRAPH", id: "caseone-desc-p2",
              nodes: [{ type: "TEXT", textData: { text: "Built-in MagSafe magnets snap instantly into your charger and mounts. Choose a matte, glossy, or premium leather finish to match how you designed it." } }],
              paragraphData: { textStyle: { textAlignment: "AUTO" } } },
            { type: "PARAGRAPH", id: "caseone-desc-p3",
              nodes: [{ type: "TEXT", textData: { text: "Made to order, just for you — ships in 3-5 business days." } }],
              paragraphData: { textStyle: { textAlignment: "AUTO" } } }
          ],
          metadata: { version: 1, id: "caseone-desc-001" }
        },
        options: [
          { name: $optModel, optionRenderType: "TEXT_CHOICES",
            choicesSettings: { choices: [ $models[] | { choiceType: "CHOICE_TEXT", name: . } ] } },
          { name: $optFinish, optionRenderType: "TEXT_CHOICES",
            choicesSettings: { choices: [ $finishes[] | { choiceType: "CHOICE_TEXT", name: . } ] } }
        ],
        modifiers: [
          {
            name: "Design Notes",
            modifierRenderType: "FREE_TEXT",
            mandatory: false,
            freeTextSettings: { title: "Design notes", maxCharCount: 200 }
          }
        ],
        variantsInfo: {
          variants: [
            $models[] as $m | $finishes[] as $f | {
              choices: [
                { optionChoiceNames: { optionName: $optModel, choiceName: $m, renderType: "TEXT_CHOICES" } },
                { optionChoiceNames: { optionName: $optFinish, choiceName: $f, renderType: "TEXT_CHOICES" } }
              ],
              price: { actualPrice: { amount: (if $f == "Leather" then "79.00" else "59.00" end) } },
              visible: true,
              inventoryItem: { quantity: 50, preorderInfo: { enabled: false } },
              physicalProperties: {}
            }
          ]
        }
      }
    ],
    returnEntity: true
  }' > "$create_body"

status=$(curl_json POST "$BULK_CREATE_API" "$create_body")
if [[ "$status" != "200" ]]; then
  echo "Bulk create failed (HTTP $status); retrying once..." >&2
  cat "$TMP_DIR/resp.json" >&2
  sleep 2
  status=$(curl_json POST "$BULK_CREATE_API" "$create_body")
  if [[ "$status" != "200" ]]; then
    echo "Bulk create failed again (HTTP $status):" >&2
    cat "$TMP_DIR/resp.json" >&2
    exit 1
  fi
fi
cp "$TMP_DIR/resp.json" "$TMP_DIR/created.json"

create_success=$(jq -r '.productResults.results[0].itemMetadata.success' "$TMP_DIR/created.json")
if [[ "$create_success" != "true" ]]; then
  echo "Product create reported failure:" >&2
  cat "$TMP_DIR/created.json" >&2
  exit 1
fi
PRODUCT_ID=$(jq -r '.productResults.results[0].item.id' "$TMP_DIR/created.json")
PRODUCT_SLUG=$(jq -r '.productResults.results[0].item.slug' "$TMP_DIR/created.json")
created_variant_count=$(jq -r '.productResults.results[0].item.variantsInfo.variants | length' "$TMP_DIR/created.json")
echo "Created product id: $PRODUCT_ID (slug: $PRODUCT_SLUG, variants: $created_variant_count)"

if [[ "$created_variant_count" != "15" ]]; then
  echo "Expected 15 variants at create time, got $created_variant_count" >&2
  exit 1
fi

echo "== STEP 3: attach images (futuristic-01, marble-01, y2k-02) =="

FUTURISTIC_URL=$(jq -r '."futuristic-01".url' "$MEDIA_MAP")
MARBLE_URL=$(jq -r '."marble-01".url' "$MEDIA_MAP")
Y2K_URL=$(jq -r '."y2k-02".url' "$MEDIA_MAP")
if [[ -z "$FUTURISTIC_URL" || "$FUTURISTIC_URL" == "null" || -z "$MARBLE_URL" || "$MARBLE_URL" == "null" || -z "$Y2K_URL" || "$Y2K_URL" == "null" ]]; then
  echo "Missing one or more image URLs in $MEDIA_MAP" >&2
  exit 1
fi

# 428-prevention: GET the product for revision + options + variantsInfo and
# echo all three back in the PATCH body (no field mask — the validator runs
# before masking).
status=$(curl_json GET "$PRODUCTS_API/$PRODUCT_ID")
if [[ "$status" != "200" ]]; then
  echo "Pre-patch GET failed (HTTP $status):" >&2
  cat "$TMP_DIR/resp.json" >&2
  exit 1
fi
cp "$TMP_DIR/resp.json" "$TMP_DIR/pre-patch.json"
REVISION=$(jq -r '.product.revision' "$TMP_DIR/pre-patch.json")

patch_body="$TMP_DIR/patch.json"
jq -n \
  --arg id "$PRODUCT_ID" \
  --arg revision "$REVISION" \
  --arg futuristicUrl "$FUTURISTIC_URL" \
  --arg marbleUrl "$MARBLE_URL" \
  --arg y2kUrl "$Y2K_URL" \
  --slurpfile pre "$TMP_DIR/pre-patch.json" \
  '{
    product: {
      id: $id,
      revision: $revision,
      options: $pre[0].product.options,
      variantsInfo: $pre[0].product.variantsInfo,
      media: {
        itemsInfo: {
          items: [
            { url: $futuristicUrl, altText: "CASEONE Custom Case — futuristic AI design" },
            { url: $marbleUrl, altText: "CASEONE Custom Case — marble AI design" },
            { url: $y2kUrl, altText: "CASEONE Custom Case — Y2K AI design" }
          ]
        }
      }
    }
  }' > "$patch_body"

status=$(curl_json PATCH "$PRODUCTS_API/$PRODUCT_ID" "$patch_body")
if [[ "$status" != "200" ]]; then
  echo "Image-attach PATCH failed (HTTP $status):" >&2
  cat "$TMP_DIR/resp.json" >&2
  exit 1
fi
echo "Image-attach PATCH succeeded (HTTP 200)."

echo "== STEP 4: verify (15 variants, correct prices, media.main set) =="

# media.main is populated asynchronously right after the PATCH: immediately
# after, it may only carry the raw external "url" (mediaType UNKNOWN_MEDIA_TYPE);
# once Wix finishes importing the image into Media Manager it gains the
# nested "image" object. Poll briefly rather than failing on the race.
main_image_url=""
for attempt in 1 2 3 4 5; do
  status=$(curl_json GET "$PRODUCTS_API/$PRODUCT_ID")
  if [[ "$status" != "200" ]]; then
    echo "Verify GET failed (HTTP $status):" >&2
    cat "$TMP_DIR/resp.json" >&2
    exit 1
  fi
  cp "$TMP_DIR/resp.json" "$TMP_DIR/final.json"
  main_image_url=$(jq -r '.product.media.main.image.url // .product.media.main.url // empty' "$TMP_DIR/final.json")
  [[ -n "$main_image_url" ]] && break
  echo "media.main not yet populated (attempt $attempt/5) — retrying in 2s..."
  sleep 2
done

final_variant_count=$(jq -r '.product.variantsInfo.variants | length' "$TMP_DIR/final.json")
echo "Final variant count: $final_variant_count"
if [[ "$final_variant_count" != "15" ]]; then
  echo "Expected 15 variants, got $final_variant_count" >&2
  exit 1
fi

# On read, variant choices reference option/choice IDs (not the names we
# wrote on create) — resolve the Finish choiceId -> name via product.options
# before checking prices.
leather_choice_id=$(jq -r --arg finish "$OPTION_FINISH_NAME" '.product.options[] | select(.name == $finish) | .choicesSettings.choices[] | select(.name == "Leather") | .choiceId' "$TMP_DIR/final.json")
leather_prices=$(jq -r --arg leatherId "$leather_choice_id" '[.product.variantsInfo.variants[] | select(any(.choices[]; .optionChoiceIds.choiceId == $leatherId)) | .price.actualPrice.amount] | unique | join(",")' "$TMP_DIR/final.json")
other_prices=$(jq -r --arg leatherId "$leather_choice_id" '[.product.variantsInfo.variants[] | select(any(.choices[]; .optionChoiceIds.choiceId == $leatherId) | not) | .price.actualPrice.amount] | unique | join(",")' "$TMP_DIR/final.json")
echo "Leather variant prices: $leather_prices (expect 79.00, may read back as \"79\")"
echo "Matte/Glossy variant prices: $other_prices (expect 59.00, may read back as \"59\")"
if [[ "$leather_prices" != "79.00" && "$leather_prices" != "79" ]]; then
  echo "Leather variants do not all price at 79.00!" >&2
  exit 1
fi
if [[ "$other_prices" != "59.00" && "$other_prices" != "59" ]]; then
  echo "Non-leather variants do not all price at 59.00!" >&2
  exit 1
fi

itemsinfo_readback=$(jq -r '.product.media.itemsInfo // "null"' "$TMP_DIR/final.json")
echo "media.main.image.url (or main.url pre-import): ${main_image_url:-<empty>}"
echo "media.itemsInfo on read: $itemsinfo_readback (expected null — write-only field)"
if [[ -z "$main_image_url" ]]; then
  echo "media.main did not persist — image attach did not take effect!" >&2
  exit 1
fi

echo "== STEP 5: resolve variantId per (model, finish) pair =="

# Product Options (unlike modifiers) are selected on add-to-cart via
# catalogReference.options.variantId, not name-matching (see
# about-product-options-and-variants + the eCommerce-integration doc) — so
# the cart-wiring code needs a live-resolved variantId per (model, finish).
# Same choiceId -> name resolution approach as the Leather-price assertion
# above: build a choiceId -> {optionName, choiceName} lookup from
# product.options, then walk each variant's choices through it.
variant_map=$(jq -r --arg optModel "$OPTION_MODEL_NAME" --arg optFinish "$OPTION_FINISH_NAME" '
  ( [ .product.options[] as $opt | $opt.choicesSettings.choices[] | { (.choiceId): { optionName: $opt.name, choiceName: .name } } ] | add ) as $lookup
  | [ .product.variantsInfo.variants[] |
      ( .choices | map( $lookup[.optionChoiceIds.choiceId] ) ) as $resolved |
      {
        key: ( ($resolved[] | select(.optionName==$optModel) | .choiceName) + "|" + ($resolved[] | select(.optionName==$optFinish) | .choiceName) ),
        value: .id
      }
    ] | from_entries
' "$TMP_DIR/final.json")

variant_map_count=$(echo "$variant_map" | jq 'length')
echo "Resolved $variant_map_count variantId entries (expect 15)."
if [[ "$variant_map_count" != "15" ]]; then
  echo "Expected 15 variantId map entries, got $variant_map_count" >&2
  exit 1
fi

jq -n --arg productId "$PRODUCT_ID" --arg model "$OPTION_MODEL_NAME" --arg finish "$OPTION_FINISH_NAME" \
  --argjson variantIdByModelFinish "$variant_map" \
  '{ productId: $productId, optionNames: { model: $model, finish: $finish }, variantIdByModelFinish: $variantIdByModelFinish }' > "$PRODUCT_JSON"
echo "Wrote $PRODUCT_JSON"
cat "$PRODUCT_JSON"
echo ""
echo "NOTE: if these variantIds differ from src/lib/constants.ts's VARIANT_ID_BY_MODEL_FINISH" >&2
echo "(e.g. after recreating the product), update that constant to match this file." >&2
