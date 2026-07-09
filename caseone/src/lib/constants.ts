// Platform + seed-time constants shared across CASEONE pages and API routes.
// PRODUCT_ID is sourced from seed-artifacts/product.json (Task 5's output).

export const PRODUCT_ID = "e70e8dde-caef-4001-a980-f44ebe1ee6ac";

// Exact Stores option names as seeded — must match scripts/seed-store.sh verbatim,
// since cart line items are built by option-name + choice-value.
export const OPTION_MODEL = "iPhone Model";
export const OPTION_FINISH = "Finish";

// Wix Stores app definition id (static platform constant, not seed output).
export const STORES_APP_ID = "215238eb-22a5-4c36-9e7b-e7c08025e04e";

// Live choice values seeded onto the product's variants (scripts/seed-store.sh).
// These are the exact strings the cart/checkout must send — no "iPhone" prefix.
export const MODELS = ["15", "15 Pro", "16", "16 Pro", "16 Pro Max"];
export const FINISHES = ["Matte", "Glossy", "Leather"];

// Display-only labels for MODELS — pages show these, but always pass the
// corresponding MODELS value (the key) to the cart, never the label.
export const UI_MODEL_LABELS: Record<string, string> = {
  "15": "iPhone 15",
  "15 Pro": "iPhone 15 Pro",
  "16": "iPhone 16",
  "16 Pro": "iPhone 16 Pro",
  "16 Pro Max": "iPhone 16 Pro Max",
};
