#!/usr/bin/env bash
# Seeds the CASEONE "Partnerships & Enterprise" inquiry form via the Wix Forms
# Form Schemas v4 API, per references/inline-recipes/setup-forms.md, with the
# TEXT_AREA identifier fix from
# caseone/node_modules/@wix/agent-skills/skills/wix-headless/references/astro/forms/CONTACT_FORM.md
# (lines ~85-98) for the paragraph field.
#
# Usage:
#   source caseone/seed-artifacts/env.sh   # provides $TOKEN, $SITE_ID
#   bash caseone/scripts/seed-form.sh
#
# Steps (mirrors the recipe's mandatory order):
#   1. Clean  — list forms in namespace wix.form_app.form, delete only ones
#      named exactly "CASEONE — Partnerships & Enterprise" (never every form
#      in the namespace — a shared namespace may hold unrelated forms).
#   2. Create — POST one form with 4 INPUT fields + a SUBMIT_BUTTON DISPLAY
#      field + a steps layout placing all of them. Retries on
#      UNSUPPORTED_FORM_NAMESPACE (namespace propagation lag) up to 3 times,
#      waiting 10s between attempts, per CONTACT_FORM.md.
#   3. Verify — GET the namespace list to confirm the form + its field
#      targets persisted, then GET the form's /summary to check how many
#      fields the Wix dashboard actually renders.
#
# Writes caseone/seed-artifacts/form.json = { "formId": "<id>" }.

set -euo pipefail

: "${TOKEN:?TOKEN not set - source caseone/seed-artifacts/env.sh first}"
: "${SITE_ID:?SITE_ID not set - source caseone/seed-artifacts/env.sh first}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ARTIFACTS_DIR="$(cd "$SCRIPT_DIR/../seed-artifacts" && pwd)"
FORM_JSON="$ARTIFACTS_DIR/form.json"

API="https://www.wixapis.com/form-schema-service/v4/forms"
NAMESPACE="wix.form_app.form"
FORM_NAME="CASEONE — Partnerships & Enterprise"

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

lc() { uuidgen | tr 'A-Z' 'a-z'; }

echo "== STEP 1: clean pre-existing \"$FORM_NAME\" forms (namespace=$NAMESPACE) =="
status=$(curl_json GET "$API?namespace=$NAMESPACE")
if [[ "$status" != "200" ]]; then
  echo "List forms failed (HTTP $status):" >&2
  cat "$TMP_DIR/resp.json" >&2
  exit 1
fi
existing_ids=$(jq -r --arg name "$FORM_NAME" '.forms[] | select(.name == $name) | .id' "$TMP_DIR/resp.json")
if [[ -z "$existing_ids" ]]; then
  echo "No pre-existing \"$FORM_NAME\" form — clean no-op."
else
  while IFS= read -r fid; do
    [[ -z "$fid" ]] && continue
    echo "Deleting pre-existing \"$FORM_NAME\" form $fid"
    del_status=$(curl_json DELETE "$API/$fid")
    if [[ "$del_status" != "200" ]]; then
      echo "Delete of $fid failed (HTTP $del_status):" >&2
      cat "$TMP_DIR/resp.json" >&2
      exit 1
    fi
  done <<< "$existing_ids"
fi

echo "== STEP 2: create form \"$FORM_NAME\" =="

F_NAME=$(lc)     # Name (required)
F_EMAIL=$(lc)    # Email (required, email)
F_COMPANY=$(lc)  # Company
F_PROJECT=$(lc)  # What do you want to build? (paragraph)
SUBMIT=$(lc)     # submit button
STEP=$(lc)       # layout step

create_body="$TMP_DIR/create.json"
jq -n \
  --arg name "$FORM_NAME" \
  --arg namespace "$NAMESPACE" \
  --arg fName "$F_NAME" \
  --arg fEmail "$F_EMAIL" \
  --arg fCompany "$F_COMPANY" \
  --arg fProject "$F_PROJECT" \
  --arg submit "$SUBMIT" \
  --arg step "$STEP" \
  '{
    form: {
      name: $name,
      namespace: $namespace,
      formFields: [
        { id: $submit, hidden: false, identifier: "SUBMIT_BUTTON", fieldType: "DISPLAY",
          displayOptions: { displayFieldType: "PAGE_NAVIGATION",
            pageNavigationOptions: { nextPageText: "Next", previousPageText: "Back", submitText: "Submit" } } },
        { id: $fName, hidden: false, identifier: "CONTACTS_FIRST_NAME", fieldType: "INPUT",
          inputOptions: { target: "name", pii: true, required: true, inputType: "STRING", readOnly: false,
            stringOptions: { validation: { format: "UNKNOWN_FORMAT", enum: [] },
              componentType: "TEXT_INPUT", textInputOptions: { label: "Name", showLabel: true } } } },
        { id: $fEmail, hidden: false, identifier: "CONTACTS_EMAIL", fieldType: "INPUT",
          inputOptions: { target: "email", pii: true, required: true, inputType: "STRING", readOnly: false,
            stringOptions: { validation: { format: "EMAIL", enum: [] },
              componentType: "TEXT_INPUT", textInputOptions: { label: "Email", showLabel: true } } } },
        { id: $fCompany, hidden: false, identifier: "CONTACTS_COMPANY", fieldType: "INPUT",
          inputOptions: { target: "company", pii: false, required: false, inputType: "STRING", readOnly: false,
            stringOptions: { validation: { format: "UNKNOWN_FORMAT", enum: [] },
              componentType: "TEXT_INPUT", textInputOptions: { label: "Company", showLabel: true } } } },
        { id: $fProject, hidden: false, identifier: "TEXT_AREA", fieldType: "INPUT",
          inputOptions: { target: "project_details", pii: false, required: false, inputType: "STRING", readOnly: false,
            stringOptions: { validation: { format: "UNKNOWN_FORMAT", enum: [] },
              componentType: "TEXT_INPUT", textInputOptions: { label: "What do you want to build?", showLabel: true } } } }
      ],
      steps: [
        { id: $step, name: "Page 1", layout: { large: { items: [
          { fieldId: $fName, row: 0, column: 0, width: 12, height: 1 },
          { fieldId: $fEmail, row: 1, column: 0, width: 12, height: 1 },
          { fieldId: $fCompany, row: 2, column: 0, width: 12, height: 1 },
          { fieldId: $fProject, row: 3, column: 0, width: 12, height: 1 },
          { fieldId: $submit, row: 4, column: 0, width: 12, height: 1 }
        ], sections: [] } } }
      ],
      enabled: true
    }
  }' > "$create_body"

# Namespace propagation retry (CONTACT_FORM.md): UNSUPPORTED_FORM_NAMESPACE
# right after an app install means the namespace hasn't propagated yet — wait
# 10s and retry, up to 3 attempts total.
max_attempts=3
attempt=1
status=""
while (( attempt <= max_attempts )); do
  status=$(curl_json POST "$API" "$create_body")
  if [[ "$status" == "200" ]]; then
    break
  fi
  if grep -q "UNSUPPORTED_FORM_NAMESPACE" "$TMP_DIR/resp.json" 2>/dev/null && (( attempt < max_attempts )); then
    echo "Create form failed with UNSUPPORTED_FORM_NAMESPACE (attempt $attempt/$max_attempts, HTTP $status) — namespace not yet propagated, waiting 10s..." >&2
    sleep 10
    attempt=$((attempt + 1))
    continue
  fi
  echo "Create form failed (HTTP $status):" >&2
  cat "$TMP_DIR/resp.json" >&2
  exit 1
done
cp "$TMP_DIR/resp.json" "$TMP_DIR/created.json"
FORM_ID=$(jq -r '.form.id' "$TMP_DIR/created.json")
echo "Created form id: $FORM_ID"

echo "== STEP 3: verify =="

status=$(curl_json GET "$API?namespace=$NAMESPACE")
if [[ "$status" != "200" ]]; then
  echo "List forms (verify) failed (HTTP $status):" >&2
  cat "$TMP_DIR/resp.json" >&2
  exit 1
fi
found_targets=$(jq -r --arg id "$FORM_ID" '.forms[] | select(.id == $id) | .fields[].target | select(. != null)' "$TMP_DIR/resp.json" | sort)
steps_count=$(jq -r --arg id "$FORM_ID" '.forms[] | select(.id == $id) | (.steps // []) | length' "$TMP_DIR/resp.json")
echo "Persisted targets: $found_targets"
echo "Persisted steps count: $steps_count"

expected_targets=$(printf '%s\n' name email company project_details | sort)
if [[ "$found_targets" != "$expected_targets" ]]; then
  echo "Field targets mismatch! Expected:" >&2
  echo "$expected_targets" >&2
  echo "Got:" >&2
  echo "$found_targets" >&2
  exit 1
fi
if [[ "$steps_count" -lt 1 ]]; then
  echo "steps did not persist (steps: [])." >&2
  exit 1
fi

status=$(curl_json GET "$API/$FORM_ID/summary")
if [[ "$status" != "200" ]]; then
  echo "Get form summary failed (HTTP $status):" >&2
  cat "$TMP_DIR/resp.json" >&2
  exit 1
fi
cp "$TMP_DIR/resp.json" "$TMP_DIR/summary.json"
summary_field_count=$(jq -r '(.formSummary.fields // []) | length' "$TMP_DIR/summary.json")
summary_targets=$(jq -r '(.formSummary.fields // [])[].target' "$TMP_DIR/summary.json" | sort | tr '\n' ' ')
echo "Dashboard summary field count: $summary_field_count"
echo "Dashboard summary targets: $summary_targets"

if [[ "$summary_field_count" == "4" ]]; then
  echo "PASS: TEXT_AREA identifier materialized — all 4 fields (name, email, company, project_details) render in the Wix dashboard."
elif [[ "$summary_field_count" == "3" ]]; then
  echo "NOTE: TEXT_AREA did NOT materialize in formFields/summary — project_details is still dropped from the dashboard (only 3 fields render). Data is still captured via fields[]/target regardless. See summary.json evidence below." >&2
  jq . "$TMP_DIR/summary.json" >&2
else
  echo "UNEXPECTED summary field count: $summary_field_count (expected 3 or 4)" >&2
  jq . "$TMP_DIR/summary.json" >&2
fi

jq -n --arg formId "$FORM_ID" '{ formId: $formId }' > "$FORM_JSON"
echo "Wrote $FORM_JSON"
cat "$FORM_JSON"
