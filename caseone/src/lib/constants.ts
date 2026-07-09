// Platform + seed-time constants shared across CASEONE pages and API routes.
// PRODUCT_ID is sourced from seed-artifacts/product.json (Task 5's output).

export const PRODUCT_ID = "e70e8dde-caef-4001-a980-f44ebe1ee6ac";

// Exact Stores option names as seeded — must match scripts/seed-store.sh
// verbatim. NOT used to build cart line items (see VARIANT_ID_BY_MODEL_FINISH
// below) — Catalog V3's eCommerce-integration doc reserves
// catalogReference.options.options (name -> choice-value matching) for
// TEXT_CHOICES *modifier* selections only; Product *options* that create
// variants (this pair) must be selected via options.variantId instead. Kept
// here as display/labeling metadata for pages that show the option names.
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

// The product's one FREE_TEXT modifier (scripts/seed-store.sh), used to carry
// the AI Studio's generated design + personalization onto the cart line item
// via catalogReference.options.customTextFields. Catalog V3 generates
// modifiers[].freeTextSettings.key from the modifier's freeTextSettings.title
// verbatim (not a slug) — confirmed live against productId
// e70e8dde-caef-4001-a980-f44ebe1ee6ac via GET product. If the product is
// ever recreated with a different title, re-verify and update this constant.
export const DESIGN_NOTES_MODIFIER_KEY = "Design notes";

// Live variantId per (model, finish) pair — required for cart line items.
// Per Catalog V3's eCommerce-integration doc, catalogReference.options.variantId
// (not options.options name-matching) is how a Product-Options-driven variant
// is selected on add-to-cart: "Always include the variantId." Resolved from a
// live GET on the product, matching each variantsInfo.variants[].choices[]
// .optionChoiceIds.choiceId back to options[].choicesSettings.choices[].name
// — the same choiceId-resolution approach scripts/seed-store.sh's verify step
// already uses for the Leather-price assertion. Key format: `${model}|${finish}`
// using the exact MODELS/FINISHES string values above.
// Re-derive if the product is ever recreated (new variant IDs) —
// scripts/seed-store.sh writes this same map into seed-artifacts/product.json
// on every run, so that file stays the source of truth; this constant should
// mirror it.
export const VARIANT_ID_BY_MODEL_FINISH: Record<string, string> = {
  "15|Matte": "7eb96788-4acb-4450-aea0-d2cf35df897f",
  "15|Glossy": "b75e4abd-1c2f-4f0e-a54f-eed4f85d85c9",
  "15|Leather": "3449c766-bb3e-4ab9-9049-3c6b93f2e49d",
  "15 Pro|Matte": "27cdba6b-36a7-4327-b9e1-4815b9a73026",
  "15 Pro|Glossy": "6ba7392d-44ca-40b1-9493-fb35dad3d588",
  "15 Pro|Leather": "4fb48b15-b3e8-433d-bad6-dea9466e6b47",
  "16|Matte": "e128171d-50a0-4a0d-838e-e0a79e8b3efb",
  "16|Glossy": "899fcc87-e4c9-42bc-b1c1-4b74424f5aff",
  "16|Leather": "d43d3aef-866c-4f82-bb59-4b1f7839afd0",
  "16 Pro|Matte": "a6f6a8e1-1a08-4445-b434-10932caed2bb",
  "16 Pro|Glossy": "84ab7c5d-f592-47d6-8ebd-b5807b1c4071",
  "16 Pro|Leather": "1a0485cd-cfdb-43f5-991d-6fb7ba44ce7c",
  "16 Pro Max|Matte": "2ecf4af3-7bde-4a49-bfa0-fc92d93551ef",
  "16 Pro Max|Glossy": "9b129e97-2509-42e2-a9b7-fa4279a248e4",
  "16 Pro Max|Leather": "e5d86c89-9f4f-4b91-8559-4d177a2253be",
};
